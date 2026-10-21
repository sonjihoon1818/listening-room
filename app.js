'use strict';
// Sohn's Listening Room — 정적 웹사이트 버전 (GitHub Pages)
// 방문자: catalog.json + reviews.json을 읽어 보여 준다(읽기 전용).
// 작성자: 이 저장소에 쓰기 권한이 있는 GitHub 토큰으로 로그인하면, 평가가 reviews.json에 커밋된다.
// 라우팅(공유 가능한 주소): #reviews · #artist.<id> · #release.<id>
(async () => {
const $ = (s) => document.querySelector(s);
const SITE = "Sohn's Listening Room";
const TOKEN_KEY = 'lr-gh-token';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function validate(d) {
  if (d?.version !== 2 || !d.reviews || typeof d.reviews !== 'object' || Array.isArray(d.reviews)) throw Error('형식 오류');
  const reviews = {};
  for (const [id, r] of Object.entries(d.reviews)) {
    if (!/^(track|release):[\w-]+$/.test(id) || !r || !(r.score === null || typeof r.score === 'number' && Number.isFinite(r.score) && r.score >= 0 && r.score <= 10) || typeof r.note !== 'string' || r.note.length > 4000 || typeof r.favorite !== 'boolean') throw Error('형식 오류');
    reviews[id] = { score: r.score, note: r.note, favorite: r.favorite, updatedAt: Number(r.updatedAt) || Date.now() };
  }
  return { version: 2, reviews };
}

// ── 데이터 불러오기 ───────────────────────────────────────
const fresh = (f) => fetch(f + '?v=' + Date.now(), { cache: 'no-store' });
let DATA, CONFIG = {};
try {
  DATA = await (await fresh('catalog.json')).json();
  CONFIG = await (await fresh('config.json')).json().catch(() => ({}));
} catch {
  $('#content').innerHTML = '<p class="muted pad">카탈로그를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>';
  return;
}
let state = { version: 2, reviews: {} };
try { state = validate(await (await fresh('reviews.json')).json()); } catch { /* 빈 리뷰로 시작 */ }

const artists = DATA.artists, artistMap = new Map(artists.map((a) => [a.id, a]));
const releases = DATA.releases, songs = DATA.tracks, releaseMap = new Map(releases.map((r) => [r.id, r]));
const releasesOf = (aid) => releases.filter((r) => r.collections.includes(aid));
const tracksOf = (aid) => [...new Set(releasesOf(aid).flatMap((r) => r.tracks))];
const artistsOfTrack = (tid) => new Set(releases.filter((r) => r.tracks.includes(tid)).flatMap((r) => r.collections));
const homeArtist = (r) => artistMap.get(r.collections[0]);
const artistNo = (aid) => String(artists.findIndex((a) => a.id === aid) + 1).padStart(3, '0');

let canEdit = false, editing = null, busy = false, token = null;
let ui = { artist: null, section: 'all', query: '', sort: 'new' };
let reviewFilter = { kind: 'all', artist: 'all' };

const entry = (kind, id) => state.reviews[kind + ':' + id] || { score: null, note: '', favorite: false };
const score = (kind, id) => entry(kind, id).score ?? null;
const hasScore = (kind, id) => score(kind, id) !== null;
const average = (vals) => vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2).replace(/\.?0+$/, '') : '—';
const ratedTracks = (ids) => ids.filter((id) => hasScore('track', id));
const yt = (title, artist) => 'https://music.youtube.com/search?q=' + encodeURIComponent(artist + ' ' + title);
const duration = (s) => s ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '—';
const isVisible = ([k, r]) => (r.score !== null || r.note || r.favorite) && (k.startsWith('track:') ? !!songs[k.slice(6)] : k.startsWith('release:') && releaseMap.has(k.slice(8)));
const PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#d9d7d1"/><circle cx="5" cy="5" r="2.2" fill="#bdbab2"/></svg>');
const cover = (path) => path || PLACEHOLDER;

function toast(s) { const t = $('#toast'); t.textContent = s; t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 5000); }

// ── GitHub 저장 ───────────────────────────────────────────
// reviews.json을 GitHub Contents API로 읽고 쓴다. 쓸 때는 항상 최신 파일 위에 변경분만 합쳐서 커밋한다.
const API = 'https://api.github.com';
const repoPath = () => `${API}/repos/${encodeURIComponent(CONFIG.owner)}/${encodeURIComponent(CONFIG.repo)}`;
const gh = (url, opts = {}) => fetch(url, { ...opts, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) } });
const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const branch = () => CONFIG.branch || 'main';

async function readRemote() {
  const res = await gh(`${repoPath()}/contents/reviews.json?ref=${encodeURIComponent(branch())}`);
  if (res.status === 404) return { data: { version: 2, reviews: {} }, sha: undefined };
  if (!res.ok) throw Object.assign(Error('read'), { status: res.status });
  const j = await res.json();
  return { data: validate(JSON.parse(b64decode(j.content))), sha: j.sha };
}
// change(최신 리뷰 객체) → 새 리뷰 객체. 충돌(다른 곳에서 먼저 저장)이면 최신본을 다시 읽어 한 번 더 시도한다.
async function commitReviews(change, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, sha } = await readRemote();
    const reviews = change({ ...data.reviews });
    const body = { message, content: b64encode(JSON.stringify({ version: 2, reviews }, null, 1) + '\n'), branch: branch(), ...(sha ? { sha } : {}) };
    const res = await gh(`${repoPath()}/contents/reviews.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { state = { version: 2, reviews }; return; }
    if ((res.status === 409 || res.status === 422) && attempt === 0) continue;
    throw Object.assign(Error('write'), { status: res.status });
  }
}
function saveError(e) {
  const s = e?.status;
  if (s === 401) { logout(); return '로그인이 만료됐어요(토큰이 만료되었거나 취소됨). 다시 로그인해 주세요.'; }
  if (s === 403 || s === 404) return '이 토큰으로는 저장할 수 없어요. 토큰의 저장소 선택과 Contents 쓰기 권한을 확인해 주세요.';
  if (s === 409 || s === 422) return '다른 곳에서 동시에 저장되어 충돌했어요. 다시 저장해 주세요.';
  return '저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
}
async function saveReviews(change, message, done) {
  if (!canEdit || busy) return false;
  busy = true;
  try { await commitReviews(change, message); render(); toast(done + ' 방문자 화면에는 1~2분 뒤에 반영돼요.'); return true; }
  catch (e) { toast(saveError(e)); return false; }
  finally { busy = false; }
}

// ── 공통 조각 ─────────────────────────────────────────────
const img = (url, alt, cls = '') => `<img class="${cls}" src="${esc(cover(url))}" alt="${esc(alt)}" loading="lazy">`;
const ymd = (d) => d.replaceAll('-', '.');
function reviewButton(kind, id, big = false) {
  const v = score(kind, id);
  if (!canEdit) return v === null ? '<span class="unrated">미평가</span>' : `<span class="score">${v}<small>/10</small></span>`;
  return `<button class="score-button${big ? ' big' : ''}" type="button" data-kind="${kind}" data-rate="${esc(id)}">${v === null ? '평가하기' : v + ' / 10 ✎'}</button>`;
}
function bindLinks(root = document) {
  root.querySelectorAll('[data-rate]').forEach((b) => (b.onclick = () => openReview(b.dataset.kind, b.dataset.rate)));
  root.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
}
function albumOfTrack(tid) {
  return releases.filter((a) => a.tracks.includes(tid)).sort((a, b) => (a.type === '싱글') - (b.type === '싱글') || a.date.localeCompare(b.date))[0];
}
function reviewRow([key, r]) {
  const [kind, id] = key.split(':'), item = kind === 'track' ? songs[id] : releaseMap.get(id);
  const album = kind === 'release' ? item : albumOfTrack(id), href = '#release.' + esc(album.id);
  const what = kind === 'track' ? `곡 · ${esc(album.title)} 수록` : esc(album.type);
  return `<article class="review-row"><a href="${href}" aria-label="${esc(album.title)} 보기">${img(album.cover, album.title + ' 커버')}</a><div><h3><a href="${href}">${esc(item.title)}</a>${r.favorite ? ' ♡' : ''}</h3><p class="by">by ${esc(item.artist)} · ${what} · ${album.date.slice(0, 4)}</p>${r.note ? `<blockquote>${esc(r.note)}</blockquote>` : ''}</div><div class="sc">${reviewButton(kind, id)}</div></article>`;
}
const visibleReviews = () => Object.entries(state.reviews).filter(isVisible).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
const facts = (rows) => `<ul class="facts">${rows.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('')}</ul>`;
function artistSide(a, after = false) {
  const t = tracksOf(a.id), rated = ratedTracks(t);
  return `<aside class="side${after ? ' side-after' : ''}">${img(a.image, a.name, 'photo')}<h3>${esc(a.name)}</h3><p>COLLECTION ${artistNo(a.id)}</p>${facts([['발매작', releasesOf(a.id).length], ['곡', t.length], ['평가한 곡', rated.length], ['평균', average(rated.map((id) => score('track', id)))]])}<div class="side-links">${after ? `<a href="#artist.${esc(a.id)}">전체 디스코그래피</a>` : ''}${a.source ? `<a href="${esc(a.source)}" target="_blank" rel="noopener">공식 페이지 ↗</a>` : ''}</div></aside>`;
}

// ── 아티스트 목록(홈) ─────────────────────────────────────
function homePage() {
  document.title = SITE;
  const rated = ratedTracks(Object.keys(songs)), recent = visibleReviews().slice(0, 3);
  const tiles = artists.map((a) => {
    const t = tracksOf(a.id), rt = ratedTracks(t);
    return `<li class="artist-tile"><a class="cover-link" href="#artist.${esc(a.id)}">${img(a.image, a.name)}<span class="t">${esc(a.name)}</span><span class="m">발매작 ${releasesOf(a.id).length} · ${t.length}곡</span></a><div class="s"><span class="prog">${rt.length}곡 평가 · 평균 ${average(rt.map((id) => score('track', id)))}</span></div></li>`;
  }).join('');
  $('#content').innerHTML = `<section class="banner"><h1>Sohn’s Listening Room</h1><p>아티스트 한 명씩, 앨범과 노래를 처음부터 끝까지 듣고 곡마다 점수와 감상을 남깁니다.</p></section>
<div class="cols"><div><div class="section-h first"><h2>아티스트</h2><span class="count">${artists.length}명</span></div><ul class="music-grid">${tiles}</ul>
${recent.length ? `<div class="section-h"><h2>최근 리뷰</h2><a href="#reviews">전체 보기</a></div><div class="reviews">${recent.map(reviewRow).join('')}</div>` : ''}</div>
<aside class="side home-side"><h3 class="first">Sohn</h3><p>Sohn이 기록하고, 함께 나누는 음악.</p>${facts([['아티스트', artists.length], ['발매작', releases.length], ['평가한 곡', rated.length], ['평균', average(rated.map((id) => score('track', id)))]])}</aside></div>`;
  bindLinks();
}

// ── 아티스트 페이지 ───────────────────────────────────────
function matches(r) {
  const q = ui.query.toLowerCase(), s = ui.section;
  return (!q || [r.title, r.artist, ...r.tracks.map((id) => songs[id].title)].join(' ').toLowerCase().includes(q))
    && (s === 'all' || s === 'album' && r.type === '정규' || s === 'ep' && r.type === 'EP' || s === 'single' && r.type === '싱글' || s === 'collab' && r.collaboration);
}
function albumCard(r) {
  const n = ratedTracks(r.tracks).length;
  return `<li><a class="cover-link" href="#release.${esc(r.id)}">${img(r.cover, r.title + ' 커버')}<span class="t">${esc(r.title)}</span><span class="m">${r.date.slice(0, 4)} · ${esc(r.type)}${r.collaboration ? ' · 공동 작업' : ''}</span></a><div class="s">${reviewButton('release', r.id)}<span class="prog">${n}/${r.tracks.length}곡 평가</span></div></li>`;
}
function renderGrid(aid) {
  const by = ui.sort === 'old' ? (a, b) => a.date.localeCompare(b.date)
    : ui.sort === 'rating' ? (a, b) => (score('release', b.id) ?? -1) - (score('release', a.id) ?? -1) || b.date.localeCompare(a.date)
    : (a, b) => b.date.localeCompare(a.date);
  const list = releasesOf(aid).filter(matches).sort(by), grid = $('#album-grid');
  grid.innerHTML = list.length ? list.map(albumCard).join('') : '<li class="empty">조건에 맞는 발매작이 없어요.</li>';
  bindLinks(grid);
}
function artistPage(aid) {
  const a = artistMap.get(aid);
  if (!a) { go(''); return; }
  if (ui.artist !== aid) ui = { artist: aid, section: 'all', query: '', sort: 'new' };
  document.title = `${a.name} · ${SITE}`;
  $('#content').innerHTML = `<section class="banner"><a class="back" href="#">← 아티스트</a><h1>${esc(a.name)}</h1><p>Sohn이 듣고 기록하는 ${esc(a.name)}의 음악.</p></section>
<div class="cols"><div><div class="tabbar"><div class="tabs" role="group" aria-label="발매 유형">${[['all', '전체'], ['album', '정규'], ['ep', 'EP'], ['single', '싱글'], ['collab', '공동 작업']].map(([k, v]) => `<button type="button" class="${ui.section === k ? 'active' : ''}" data-section="${k}">${v}</button>`).join('')}</div><input id="catalog-search" type="search" aria-label="발매작 또는 곡 검색" placeholder="앨범이나 곡 검색" value="${esc(ui.query)}"><select id="catalog-sort" aria-label="발매작 정렬"><option value="new">최신순</option><option value="old">오래된 순</option><option value="rating">점수순</option></select></div>
<ul class="music-grid" id="album-grid"></ul>
<p class="note">공식 Bandcamp 및 Apple Music에서 확인한 발매작 · ${esc(ymd(a.addedAt || DATA.updatedAt))} 기준. 정규판·디럭스·싱글에 반복 수록된 같은 곡은 평가를 공유하고, 데모 등 별도 버전은 구분합니다. 공동 작업 발매작에는 다른 참여자의 트랙도 포함될 수 있습니다.</p></div>
${artistSide(a)}</div>`;
  $('#catalog-sort').value = ui.sort;
  $('#catalog-search').oninput = (e) => { ui.query = e.target.value; renderGrid(aid); };
  $('#catalog-sort').onchange = (e) => { ui.sort = e.target.value; renderGrid(aid); };
  document.querySelectorAll('[data-section]').forEach((b) => (b.onclick = () => {
    ui.section = b.dataset.section;
    document.querySelectorAll('[data-section]').forEach((x) => x.classList.toggle('active', x === b));
    renderGrid(aid);
  }));
  bindLinks();
  renderGrid(aid);
}

// ── 발매작 페이지 ─────────────────────────────────────────
function releasePage(id) {
  const r = releaseMap.get(id);
  if (!r) { go(''); return; }
  const a = homeArtist(r), rev = entry('release', id), rated = ratedTracks(r.tracks);
  document.title = `${r.title} · ${SITE}`;
  const rows = r.tracks.map((tid, i) => {
    const t = songs[tid], v = entry('track', tid), appearances = releases.filter((x) => x.tracks.includes(tid)).length;
    const sub = [t.artist !== r.artist ? esc(t.artist) : '', appearances > 1 ? appearances + '개 발매작에서 평가 공유' : ''].filter(Boolean).join(' · ');
    return `<tr><td class="n">${i + 1}.</td><td class="ti">${esc(t.title)}${v.favorite ? ' ♡' : ''}${sub ? `<small>${sub}</small>` : ''}${v.note ? `<p>${esc(v.note)}</p>` : ''}</td><td class="d">${duration(t.duration)}</td><td class="sc">${reviewButton('track', tid)}</td><td class="yt"><a href="${yt(t.title, t.artist)}" target="_blank" rel="noopener" title="YouTube Music에서 찾기">듣기↗</a></td></tr>`;
  }).join('');
  $('#content').innerHTML = `<section class="banner"><a class="back" href="#artist.${esc(a.id)}">← ${esc(a.name)}</a><h1>${esc(a.name)}</h1></section>
<div class="cols"><div class="release"><div class="info"><p class="eyebrow">${esc(r.type)}${r.collaboration ? ' · 공동 작업' : ''}</p><h2>${esc(r.title)}</h2><p class="byline">by <a href="#artist.${esc(a.id)}">${esc(r.artist)}</a></p>
<div class="verdict"><div class="row"><span class="label">Sohn의 앨범 점수</span>${reviewButton('release', r.id, true)}</div>${rev.note ? `<blockquote>${esc(rev.note)}</blockquote>` : ''}</div>
<div class="listen"><a href="${yt(r.title, r.artist)}" target="_blank" rel="noopener">YouTube Music에서 듣기 ↗</a><a href="${esc(r.source)}" target="_blank" rel="noopener">발매 정보 ↗</a></div></div>
<div class="art">${img(r.cover, r.title + ' 커버')}</div>
<div class="tracks-wrap"><table class="track-table"><tbody>${rows}</tbody></table><p class="released">발매 ${ymd(r.date)} · ${r.tracks.length}곡 · ${rated.length}/${r.tracks.length}곡 평가</p></div></div>
${artistSide(a, true)}</div>`;
  bindLinks();
}

// ── 리뷰 모음 ─────────────────────────────────────────────
function reviewsPage() {
  document.title = `Sohn의 리뷰 · ${SITE}`;
  const all = visibleReviews();
  const list = all.filter(([key]) => {
    const [kind, id] = key.split(':');
    if (reviewFilter.kind !== 'all' && reviewFilter.kind !== kind) return false;
    if (reviewFilter.artist === 'all') return true;
    return kind === 'release' ? releaseMap.get(id).collections.includes(reviewFilter.artist) : artistsOfTrack(id).has(reviewFilter.artist);
  });
  const nRel = all.filter(([k]) => k.startsWith('release:')).length, scored = all.map(([, r]) => r.score).filter((v) => v !== null);
  const filters = all.length ? `<div class="tabbar"><div class="tabs" role="group" aria-label="리뷰 종류">${[['all', '전체'], ['release', '앨범'], ['track', '곡']].map(([k, v]) => `<button type="button" class="${reviewFilter.kind === k ? 'active' : ''}" data-kind-filter="${k}">${v}</button>`).join('')}</div>${artists.length > 1 ? `<select id="review-artist" aria-label="아티스트별 리뷰"><option value="all">모든 아티스트</option>${artists.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>` : ''}<span class="count">${list.length}개</span></div>` : '';
  $('#content').innerHTML = `<section class="banner"><h1>Sohn의 리뷰</h1><p>곡과 앨범의 점수, 그리고 그날의 감상.</p></section>
<div class="cols"><div>${filters}
${list.length ? `<div class="reviews">${list.map(reviewRow).join('')}</div>` : all.length ? '<p class="empty">조건에 맞는 리뷰가 없어요.</p>' : '<div class="empty"><p>아직 공개한 리뷰가 없어요.</p><a href="#">아티스트 둘러보기</a></div>'}</div>
<aside class="side home-side"><h3 class="first">리뷰</h3><p>점수와 감상은 모두 Sohn이 작성합니다.</p>${facts([['전체', all.length], ['앨범', nRel], ['곡', all.length - nRel], ['평균', average(scored)]])}</aside></div>`;
  document.querySelectorAll('[data-kind-filter]').forEach((b) => (b.onclick = () => { reviewFilter.kind = b.dataset.kindFilter; reviewsPage(); }));
  const sel = $('#review-artist');
  if (sel) { sel.value = reviewFilter.artist; sel.onchange = (e) => { reviewFilter.artist = e.target.value; reviewsPage(); }; }
  bindLinks();
}

// ── 라우팅 ────────────────────────────────────────────────
function render() {
  const path = decodeURIComponent(location.hash.slice(1));
  $('#home').classList.toggle('active', path !== 'reviews');
  $('#reviews').classList.toggle('active', path === 'reviews');
  if (path === 'reviews') reviewsPage();
  else if (path.startsWith('release.')) releasePage(path.slice(8));
  else if (path.startsWith('artist.')) artistPage(path.slice(7));
  else homePage();
}
function go(hash) { if (location.hash.slice(1) === hash) render(); else location.hash = hash; }
$('#home').onclick = () => go('');
$('#reviews').onclick = () => go('reviews');
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

// ── 작성자 로그인 ─────────────────────────────────────────
function setEditMode(on) {
  canEdit = on;
  $('#owner-chip').hidden = !on;
  $('#restore').hidden = !on;
  $('#backup').hidden = !on;
  $('#logout').hidden = !on;
  $('#login').hidden = on;
  $('#owner-status').textContent = on ? '작성자 모드 · 저장한 리뷰는 모든 방문자에게 공개됩니다.' : '방문자는 읽기 전용';
  render();
}
function logout() {
  token = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* 저장소 없음 */ }
  setEditMode(false);
}
// 토큰이 이 저장소에 쓰기(push) 권한이 있는지 확인. 맞으면 최신 리뷰를 GitHub에서 직접 읽어 온다(페이지 캐시보다 최신).
const NET_ERR = 'GitHub에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
async function tryLogin(t) {
  if (!CONFIG.owner || !CONFIG.repo) return 'config.json에 저장소 정보(owner, repo)가 없어요.';
  token = t;
  try {
    const res = await gh(repoPath());
    if (res.status === 401) throw Error('토큰이 올바르지 않거나 만료됐어요.');
    if (!res.ok) throw Error('이 토큰으로는 저장소를 볼 수 없어요. 토큰의 저장소 선택을 확인해 주세요.');
    const repo = await res.json();
    if (!repo.permissions?.push) throw Error('이 토큰에는 쓰기 권한이 없어요. Contents를 Read and write로 설정해 주세요.');
    const { data } = await readRemote();
    state = data;
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* 이 브라우저에서는 매번 로그인 */ }
    setEditMode(true);
    return null;
  } catch (e) {
    token = null;
    return e?.message && !/fetch/i.test(e.message) ? e.message : NET_ERR;
  }
}
$('#login').onclick = () => { $('#token').value = ''; $('#login-error').textContent = ''; $('#login-dialog').showModal(); };
$('#login-close').onclick = () => $('#login-dialog').close();
$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const t = $('#token').value.trim();
  if (!t) return;
  $('#login-ok').disabled = true; $('#login-ok').textContent = '확인 중…';
  const err = await tryLogin(t);
  $('#login-ok').disabled = false; $('#login-ok').textContent = '로그인';
  if (err) $('#login-error').textContent = err;
  else { $('#login-dialog').close(); toast('작성자 모드로 전환했어요.'); }
};
$('#logout').onclick = () => { logout(); toast('로그아웃했어요. 이 브라우저에서 토큰을 지웠어요.'); };

// ── 평가 작성 ─────────────────────────────────────────────
function openReview(kind, id) {
  if (!canEdit) return;
  const item = kind === 'release' ? releaseMap.get(id) : songs[id];
  if (!item) return;
  editing = { kind, id };
  const r = entry(kind, id);
  $('#review-kind').textContent = kind === 'release' ? 'ALBUM REVIEW' : 'TRACK REVIEW';
  $('#review-title').textContent = item.title;
  $('#review-sub').textContent = item.artist;
  $('#score').value = r.score ?? '';
  $('#note').value = r.note;
  $('#favorite').checked = r.favorite;
  $('#save').disabled = false; $('#save').textContent = '리뷰 공개 저장';
  $('#review').showModal();
}
$('#close').onclick = () => $('#review').close();
$('#review-form').onsubmit = async (e) => {
  e.preventDefault();
  if (!editing) return;
  const raw = $('#score').value.trim(), value = raw === '' ? null : Number(raw);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 10)) { toast('0~10점 사이의 숫자를 입력해주세요.'); return; }
  const key = editing.kind + ':' + editing.id, item = editing.kind === 'release' ? releaseMap.get(editing.id) : songs[editing.id];
  const next = { score: value, note: $('#note').value.trim(), favorite: $('#favorite').checked, updatedAt: Date.now() };
  $('#save').disabled = true; $('#save').textContent = '저장 중…';
  const ok = await saveReviews((rv) => ({ ...rv, [key]: next }), `리뷰: ${item.title}${value === null ? '' : ' ' + value}`, '평가를 저장했어요.');
  if (ok) $('#review').close();
  else { $('#save').disabled = false; $('#save').textContent = '리뷰 공개 저장'; }
};

// ── 백업 ──────────────────────────────────────────────────
$('#backup').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `listening-room-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
let pendingImport = null;
$('#restore').onclick = () => $('#file').click();
$('#file').onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10000000) throw Error();
    const incoming = validate(JSON.parse(await file.text())).reviews;
    const add = Object.entries(incoming).filter(([id]) => { const [kind, key] = id.split(':'); return !state.reviews[id] && (kind === 'track' ? !!songs[key] : releaseMap.has(key)); });
    if (!add.length) { toast('새로 가져올 평가가 없어요.'); return; }
    pendingImport = add;
    $('#confirm-title').textContent = `${add.length}개의 리뷰를 가져올까요?`;
    $('#confirm').showModal();
  } catch { toast('올바른 백업 파일(.json)을 선택해주세요.'); }
  finally { e.target.value = ''; }
};
const closeConfirm = () => { pendingImport = null; $('#confirm').close(); };
$('#confirm-close').onclick = closeConfirm;
$('#confirm-cancel').onclick = closeConfirm;
$('#confirm-ok').onclick = async () => {
  if (!pendingImport) return;
  const add = pendingImport;
  $('#confirm-ok').disabled = true;
  // 저장 직전의 최신본 기준으로도 없는 평가만 추가(덮어쓰지 않음)
  await saveReviews((rv) => { for (const [k, v] of add) if (!rv[k]) rv[k] = v; return rv; }, `백업에서 리뷰 ${add.length}개 가져오기`, `${add.length}개의 리뷰를 가져왔어요.`);
  $('#confirm-ok').disabled = false;
  closeConfirm();
};

// ── 시작 ──────────────────────────────────────────────────
$('#footer-note').textContent = `Sohn의 공개 음악 일기 · 카탈로그 ${DATA.updatedAt.replaceAll('-', '.')}`;
render();
let saved = null;
try { saved = localStorage.getItem(TOKEN_KEY); } catch { /* 저장소 없음 */ }
if (saved) {
  const err = await tryLogin(saved);
  if (err === NET_ERR) toast('GitHub에 연결하지 못해 읽기 전용으로 보여 드려요. 새로고침하면 다시 시도해요.');
  else if (err) { logout(); toast('작성자 로그인이 풀렸어요: ' + err); }
}
})();

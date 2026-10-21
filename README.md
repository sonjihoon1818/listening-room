# Sohn's Listening Room

Sohn이 아티스트 한 명씩 깊이 듣고 남기는 음악 리뷰 사이트. 정적 사이트(GitHub Pages)이며, 리뷰는 이 저장소의 `reviews.json`에 저장된다.

## 파일
- `index.html`, `app.css`, `app.js`: 화면. 빌드 과정 없음. 파일을 고치면 그대로 반영된다.
- `catalog.json`: `artists[]`(순서 = COLLECTION 번호) + `releases[]`(`collections: [아티스트ID]`) + 전역 `tracks{}`. 같은 곡의 정규/디럭스/싱글 수록은 같은 track ID를 써서 평가를 공유하고, 데모나 다른 녹음은 별도 ID를 쓴다. 기존 ID는 바꾸거나 지우지 말 것(리뷰 연결이 끊김).
- `covers/`: 커버·아티스트 이미지(320px JPEG). 원본 주소는 catalog의 `coverSource` / `imageSource`.
- `reviews.json`: 리뷰. `{"version":2,"reviews":{"track:<id>"|"release:<id>": {score(0~10 또는 null), note, favorite, updatedAt}}}`. 0점은 유효한 점수이고, null은 미평가.
- `config.json`: 작성 기능이 쓰는 저장소 정보(`owner`, `repo`, `branch`).
- `.nojekyll`: GitHub Pages의 Jekyll 처리를 끈다.

## 처음 배포 (한 번만)
1. GitHub에서 **Public** 저장소를 만든다(예: `listening-room`). 무료 계정에서 Pages를 쓰려면 Public이어야 한다. 리뷰는 원래 공개 콘텐츠라 문제없다.
2. `config.json`의 `owner`(GitHub 아이디)와 `repo`(저장소 이름)를 채운다.
3. 이 폴더의 파일을 전부 저장소에 올린다(웹에서 "Add file → Upload files"로 끌어다 놓기 가능. `.nojekyll`처럼 숨김 파일도 포함할 것).
4. 저장소 Settings → Pages → Source: **Deploy from a branch**, Branch: `main` / `(root)` → Save.
5. 1~2분 뒤 `https://<아이디>.github.io/<저장소>/`에서 열린다.

## 작성자 로그인 (Sohn만)
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Repository access: **Only select repositories** → 이 저장소만 선택.
3. Permissions → Repository permissions → **Contents: Read and write**. 다른 권한은 주지 않는다.
4. 만료일을 정하고 생성한 뒤, 사이트 하단의 "작성자 로그인"에 붙여 넣는다.
- 토큰은 그 브라우저의 localStorage에만 저장된다. 공용 PC에서는 다 쓰고 "로그아웃"할 것.
- 토큰이 새면 GitHub에서 그 토큰을 Revoke하면 된다. 이 저장소 밖에는 권한이 없다.
- 저장하면 `reviews.json`에 커밋이 하나 생긴다. 방문자 화면에는 Pages가 다시 배포된 뒤(보통 1~2분) 반영된다.
- 저장할 때는 항상 GitHub의 최신 파일 위에 바뀐 리뷰 하나만 합친다. 두 기기에서 동시에 저장해도 서로 지우지 않는다.

## 내 도메인 연결 (선택)
도메인을 산 뒤 Settings → Pages → Custom domain에 입력하고, 도메인 업체의 DNS에 GitHub이 안내하는 레코드를 추가한다. 그다음 "Enforce HTTPS"를 켠다. 주소가 바뀌어도 `config.json`은 그대로 두면 된다.

## 아티스트 추가 (Claude에게 맡길 때)
1. 공식 발매처(Bandcamp/Apple 등)에서 앨범·EP·싱글·공동 작업과 수록곡을 조사한다. Apple은 `https://itunes.apple.com/lookup?id=<앨범ID>&entity=song`으로 확인할 수 있다.
2. `catalog.json`에 아티스트·발매작·트랙을 추가한다. 이미 있는 발매작이면 `collections`에 아티스트 ID만 추가하고, 이미 있는 곡은 track ID를 재사용한다.
3. 커버를 320px JPEG로 `covers/<발매작ID>.jpg`에 넣고, `cover`에 그 경로를, `coverSource`에 원본 주소를 적는다.
4. `catalog.json`의 `updatedAt`을 갱신하고 커밋한다.

## 보안 메모
- 페이지에 CSP가 걸려 있다(스크립트는 자기 출처만, 네트워크는 자기 출처와 api.github.com만). 외부 스크립트를 추가하지 말 것.
- 모든 사용자 입력(감상 등)은 escape해서 출력한다. 토큰이 localStorage에 있으므로 XSS 방지가 곧 토큰 보호다.

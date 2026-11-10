# Quest 3 앱 설계·실현성 조사 (PLY + VR 영상·사진 뷰어)

작성: architect, 2026-11-10.
대상 독자: 이 저장소에서 Quest 앱을 만드는 app-dev, media-dev, sync-dev, reviewer와 커맨더.
범위: 설치 형태, 호스팅, 기기 파일 접근, PC 자동 연결, 구글 드라이브, VR 미디어 렌더, 디렉터리 구조, 사람 몫 단계.

## 0. 핵심 권고 요약

1. **앱은 웹앱(PWA) 하나로 만들고 GitHub Pages에서 배포한다.**
   Quest 3에서 앱 아이콘이 필요하므로 같은 웹앱을 Meta가 제공하는 Bubblewrap으로 감싼 TWA APK(2D 모드)를 한 번 사이드로드한다.
   APK는 Pages 주소를 여는 껍데기라서, 웹 코드를 고쳐도 APK를 다시 설치할 필요가 없다.
2. **호스팅 주소는 `https://shimanskim.github.io/sharp-gaussian-splatting-vr-toolkit/`이다.**
   저장소는 공개 상태이고 Pages는 아직 꺼져 있다(2026-11-10 `gh api .../pages` → 404).
   GitHub Actions 배포(`build_type=workflow`)로 켠다.
3. **기기 저장소 파일은 `<input type=file>`을 기본으로 열고, 목록 보관은 OPFS 복사본 + IndexedDB 메타데이터로 한다.**
   `showOpenFilePicker`는 Chromium 132부터 Android에 들어왔으므로 기능 감지해서 쓸 수 있으면 핸들을 저장한다.
4. **PC 연결은 "LAN 직접 HTTP + 고정 mDNS 이름 `sharp-vr.local`"을 1순위로 한다.**
   Quest Browser는 2026-10-30 기준 Chromium 154 기반이다.
   Chrome 142부터 들어간 Local Network Access(LNA)는 사설 IP 리터럴이나 `.local` 이름으로 가는 요청을 권한 프롬프트 한 번으로 허용하고 mixed content 차단에서도 뺀다.
   그래서 HTTPS 앱이 `http://sharp-vr.local:8787`에 붙을 수 있다.
   이 가정은 실기기에서 검증되지 않았으므로 **조기 실기기 프로브(9장)** 로 먼저 확인한다.
   실패하면 Cloudflare quick tunnel(HTTPS) + 1회 페어링 코드로 넘어간다.
5. **PC·드라이브 파일은 서비스 워커 프록시(`/__src/...`)를 거쳐 같은 출처 URL로 연다.**
   비디오 seek용 Range 요청, 드라이브 Bearer 토큰, WebGL 텍스처의 CORS 오염 문제를 한 곳에서 처리한다.
6. **구글 드라이브는 Google Picker + GIS 토큰(`drive.file` 범위)으로 연다.**
   사람이 Google Cloud 프로젝트, OAuth 클라이언트, API 키를 만들어야 한다(8장).
7. **VR 미디어는 Three.js 메시 방식(구·반구·평면 + 눈별 layers)으로 먼저 만든다.**
   WebXR Media Layers는 8K 화질·성능 최적화 단계에서 선택적으로 붙인다.
   기존 출력 `outputs/VR/*_quest3_8k_3D_FSBS.mp4`는 H.264 8192x2730이다.
   Quest Browser는 H.264를 4K까지만 지원하므로 이 파일은 재생이 안 되거나 끊길 가능성이 높다.
   앱은 MediaCapabilities로 미리 경고하고, HEVC 재인코딩 BAT를 함께 제공한다.

## 1. 설치 형태 비교와 권고

### 1.1 조사 결과

- Quest Browser에는 데스크톱 Chrome·Edge 같은 "앱 설치" 버튼이 없다.
  Meta 공식 문서는 PWA 설치 경로로 Bubblewrap APK(사이드로드 또는 Horizon Store)만 안내한다.
  2024년 Quest 3 사용자 포럼 글도 브라우저에 설치 버튼이 없다고 보고한다.
- Meta 문서의 PWA 패키징 절차는 다음과 같다.
  - `npm install --global @meta-quest/bubblewrap-cli` (문서 검증 버전 1.24.1, JDK 17)
  - `bubblewrap init --manifest=<공개 manifest URL> --metaquest` → 앱 모드 `2D` 또는 `immersive` 선택(`twa-manifest.json`의 `horizonOSAppMode`)
  - Gradle `targetSdk = 32` (Quest는 API 32 이하 대상 앱만 실행)
  - `bubblewrap build` → `app-release-signed.apk`
  - 개발자 모드 Quest에 `adb install` → 라이브러리의 **알 수 없는 출처(Unknown Sources)** 에서 실행
- Digital Asset Links(`/.well-known/assetlinks.json`)를 **출처 루트**에 둬야 한다.
  - immersive 모드는 검증에 실패하면 실행되지 않는다.
  - 2D 모드는 검증에 실패해도 실행되며, 위쪽에 주소 표시줄 같은 custom tab UI만 보인다.
- immersive 모드 PWA는 실행 직후 `requestSession('immersive-vr')`을 호출하는 구조다.
  아이콘 클릭이 사용자 제스처로 인정된다.
  2D UI(파일 선택, 목록)가 필요한 이 앱과는 맞지 않는다.
- 사이드로드에는 Quest 개발자 모드가 필요하다.
  개발자 모드를 켜려면 Meta Horizon 개발자 대시보드에서 조직을 만들고, 휴대폰 번호(SMS 2단계 인증) 또는 결제 수단으로 계정을 인증한 뒤, Meta Horizon 휴대폰 앱에서 토글을 켜야 한다.

### 1.2 비교

| 항목 | A. 웹앱만 (Pages URL + 북마크) | B. TWA APK 2D 사이드로드 (권고) | C. Horizon Store 배포 | D. 네이티브(Unity 등) |
|---|---|---|---|---|
| 앱 아이콘 | 없음(브라우저 북마크) | 있음(알 수 없는 출처) | 있음 | 있음 |
| 사람 준비 | 없음 | 개발자 모드 1회, USB 설치 1회 | 개발자 조직, 앱 등록, 업로드·심사 | 개발 환경 전체 |
| WebXR | Quest Browser 그대로 | Quest Browser 엔진 그대로 | 동일 | 해당 없음 |
| 업데이트 | Pages 배포 즉시 | Pages 배포 즉시(APK 재설치 불필요) | Pages 배포 즉시 | 빌드마다 재설치 |
| 유지보수 | 가장 쉬움 | 웹 코드 하나 + 서명 키 보관 | B + 스토어 관리 | 별도 코드베이스 |
| 성공 기준 ① | 불충족 | 충족 | 충족 | 충족 |

### 1.3 권고

- **B를 권고한다.**
  웹앱(A)을 먼저 완성하고, 같은 manifest로 TWA APK를 만들어 GitHub Release에 올린다.
- 앱 모드는 **`2D`** 로 한다.
  2D 모드에서도 버튼으로 immersive 세션에 들어갈 수 있는지는 문서에 명시가 없다.
  같은 엔진이므로 될 가능성이 높지만 프로브(9장)에서 확인한다.
- 주소 표시줄을 없애려면 `https://shimanskim.github.io/.well-known/assetlinks.json`이 필요하다.
  프로젝트 사이트(`/sharp-gaussian-splatting-vr-toolkit/`)는 출처 루트에 파일을 둘 수 없다.
  사람 계정에 사용자 사이트 저장소 `shimansKim/shimansKim.github.io`를 만들어 이 파일 하나만 두면 된다(사람 승인 필요).
  만들지 않아도 앱은 동작하고 주소 표시줄만 보인다.
- 서명 키(keystore)는 저장소 밖(`%USERPROFILE%\.sharp-quest\`)에 둔다.
  키를 잃으면 같은 패키지로 업데이트할 수 없으므로 사람에게 백업 위치를 알린다.
- APK 설치는 사람 PC에서 `install_quest_app.bat` 하나로 끝나게 만든다.
  BAT는 platform-tools(adb)가 없으면 내려받고, GitHub Release의 APK를 `adb install -r`한다.
  대안으로 Chrome/Edge에서 WebUSB를 쓰는 Quest Webloader(webloader.app)나 SideQuest도 안내한다.
- C(스토어 비공개 채널)는 개발자 모드 없이 설치하는 길이지만 대시보드 작업이 많다.
  사람이 원하면 2단계로 검토한다.

## 2. 호스팅: GitHub Pages

- 확인 결과(2026-11-10)
  - `shimansKim/sharp-gaussian-splatting-vr-toolkit`: **PUBLIC**, 기본 브랜치 `main`.
  - Pages: 미설정(`GET /repos/.../pages` → 404).
  - `gh`의 활성 계정은 `crayonsmilegames`이고 이 저장소에 push 권한이 없다.
    키링의 `shimansKim` 계정은 admin 권한이 있다.
- 공개 저장소이므로 무료 플랜에서도 Pages를 쓸 수 있다.
  HTTPS가 기본이라 WebXR secure context, 서비스 워커, LNA 권한 요청 조건을 모두 만족한다.
- 배포 방식: `.github/workflows/pages.yml`에서 `quest-app/`을 Vite로 빌드하고 `actions/upload-pages-artifact` + `actions/deploy-pages`로 올린다.
  트리거는 `main` push와 `workflow_dispatch`로 한다.
  Pages 활성화는 `gh api -X POST repos/shimansKim/sharp-gaussian-splatting-vr-toolkit/pages -f build_type=workflow`(admin 필요)로 한 번 한다.
- base 경로
  - Vite `base: '/sharp-gaussian-splatting-vr-toolkit/'` (환경 변수 `APP_BASE`로 덮어쓸 수 있게).
  - manifest `start_url`·`scope`는 `./`(manifest 기준 상대 경로)로 둔다.
  - 서비스 워커는 `public/sw.js`로 두고 `navigator.serviceWorker.register('./sw.js', { scope: './' })`로 등록한다.
  - 코드 안 경로는 `import.meta.env.BASE_URL`을 쓴다.
    기존 데모처럼 `/splats/...` 절대 경로를 쓰면 Pages에서 깨진다.
- 사람 파일은 Pages에 올리지 않는다.
  `quest-app/public/`에 `.ply`·`.mp4` 샘플을 넣지 않는다(`.gitignore`가 이미 `*.ply`, `*.mp4`를 막는다).
- 로컬 개발: `npm run dev`는 `@vitejs/plugin-basic-ssl`로 `https://<PC IP>:5173`을 띄운다(기존 데모와 같은 방식).

## 3. Quest 기기 저장소 파일 접근

### 3.1 API 지원

| API | Quest Browser 154 예상 | 쓰임 |
|---|---|---|
| `<input type=file multiple>` | 지원(Android 파일 선택기) | 기본 경로 |
| `showOpenFilePicker` | Chromium 132부터 Android 지원. 선택한 파일이 무시되는 버그 보고(Chrome Android 143·144)가 있다 | 기능 감지 후 사용, 실패 시 input으로 대체 |
| `showDirectoryPicker` | Android에서 폴더 안 파일 열기가 불완전하다는 지적이 있다 | 쓰지 않음(프로브에서만 확인) |
| OPFS `navigator.storage.getDirectory()` | Chromium 109부터 Android 지원 | 앱 보관함 |
| IndexedDB | 지원 | 목록 메타데이터, 파일 핸들 |
| `navigator.storage.persist()` / `estimate()` | 지원 | 보관함 유지, 용량 표시 |

### 3.2 설계

- **열기**: `<input type=file multiple>`로 고른다.
  `.ply`는 표준 MIME이 없어서 `accept`로 거르면 파일이 숨겨질 수 있다.
  PLY용 버튼은 `accept`를 비우고, 영상·사진용 버튼만 `accept="video/*,image/*"`로 둔다.
  선택한 `File`들은 "이번 세션" 목록에 올라가고, 이전/다음으로 전환할 수 있다.
- **보관**: 사용자가 "앱에 보관"을 누르면 파일을 OPFS에 스트림 복사한다(`file.stream().pipeTo(writable)`).
  메타데이터(`id, name, kind, size, layout, addedAt, source`)는 IndexedDB `library` 스토어에 둔다.
  처음 보관할 때 `navigator.storage.persist()`를 요청하고, 설정 화면에 `estimate()` 결과를 보여 준다.
  Chromium은 출처마다 디스크의 큰 비율을 허용하므로 66MB PLY 수십 개나 수백 MB 영상도 들어간다.
- **핸들 저장**: `showOpenFilePicker`가 동작하면 `FileSystemFileHandle`을 IndexedDB에 저장하고, 다음 실행 때 `requestPermission()`으로 다시 연다.
  복사 없이 목록을 유지하는 길이지만 Android 동작을 확신할 수 없으므로 보조 기능으로 둔다.
- **대용량 PLY**: SHARP 출력 PLY는 497개 표본 모두 66,061,086바이트(약 63MB)였다.
  Spark 2.0 `SplatMesh`는 `stream` + `streamLength` 옵션을 받는다.
  `File.stream()`이나 `fetch().body`를 그대로 넘겨 전체 `ArrayBuffer`를 한 번 더 만들지 않는다.
  `fileType`(또는 `fileName`)을 함께 넘겨 형식 판별을 확실히 한다.
- **Quest에 파일 넣는 방법**(사용자 안내용): USB로 PC에 연결해 `Quest 3\내부 공유 저장용량\Download`에 복사하거나, PC 연결 모드에서 "Quest에 보관"을 누른다.

## 4. HTTPS 앱 → PC 연결 (IP 입력 없이)

### 4.1 문제

- 앱은 `https://shimanskim.github.io`에서 실행된다.
  PC 서버는 LAN의 `http://`다.
  예전 Chromium 규칙에서는 HTTPS 페이지가 `http://` 리소스를 부르면 mixed content로 막혔다.
- PC에 HTTPS를 붙이면 자체 서명 인증서가 문제다.
  Quest에서 PC 주소로 직접 들어가 경고를 넘기는 방식(지금 방식)은 쓸 수 있지만, 다른 출처(Pages 앱)의 `fetch`는 인증서 예외를 공유하지 않으므로 실패하기 쉽다.
- 기존 `run_webxr_demo_tunnel.bat`는 localtunnel을 쓴다.
  `webxr-spark-demo/lt.err.log`에 `connection refused: localtunnel.me:29969`가 남아 있어 안정적이지 않다.

### 4.2 Local Network Access(LNA) 조사 결과

- Chrome 142부터 공개 사이트가 사설 IP·loopback·`.local`로 요청하면 "로컬 네트워크 기기 찾기·연결" 권한 프롬프트가 뜬다.
- 권한을 받은 로컬 네트워크 요청은 mixed content 검사에서 빠진다.
  조건은 호스트가 사설 IP 리터럴이거나, `.local` 이름이거나, `fetch(url, { targetAddressSpace: 'local' })`(Chrome 150부터 `local`/`loopback`으로 분리)를 쓴 경우다.
  공개 도메인이 사설 IP로 풀리는 경우(`nip.io` 같은 방식)는 이 옵션 없이는 빠지지 않는다.
- 권한 요청은 secure context에서만 할 수 있다.
  서비스 워커는 스스로 프롬프트를 띄우지 못하므로, 페이지가 먼저 한 번 요청해 권한을 받아야 한다.
- Chrome 154는 WebSocket에도 `targetAddressSpace`를 추가했다.
- Quest Browser 버전: 2026-03 144부터 Chromium 마일스톤 번호를 따르고, 2026-10-30 154.1이 최신이다.
  Meta 릴리스 노트는 LNA를 언급하지 않으므로 Quest 구현은 실기기에서 확인해야 한다.
- `.local` 해석: Chrome은 Android에서 `.local`을 OS `getaddrinfo()`에 맡긴다.
  Android DnsResolver는 2021-11(Android 12 이후 업데이트)부터 mDNS `.local` 해석을 지원한다.
  Horizon OS는 Android 14 계열이므로 될 가능성이 높지만 역시 프로브 대상이다.

### 4.3 방식 비교

| 방식 | IP 입력 | HTTPS 문제 | 외부 의존 | 위험 |
|---|---|---|---|---|
| L1. LAN HTTP + `sharp-vr.local` mDNS (권고 1순위) | 없음 | LNA로 해결(검증 필요) | 없음 | Quest LNA·mDNS 동작 미검증, Windows 방화벽 |
| L2. LAN HTTP + 마지막 성공 주소 기억 | 첫 연결만 L1·L3로 해결되면 없음 | LNA | 없음 | DHCP로 IP가 바뀌면 재탐색 |
| L3. 서브넷 탐색(192.168.0/1.x, 172.30.1.x 등) | 없음 | LNA | 없음 | 수백 요청, 느림, 공유기 대역 추측 |
| T1. Cloudflare quick tunnel + 1회 페어링 코드 (권고 2순위) | 6자리 코드 1회 | 없음(진짜 HTTPS) | trycloudflare.com, 중계 채널 | 동시 요청 200 제한, SSE 미지원, SLA 없음, 인터넷 노출 |
| T2. 기존 localtunnel 재사용 | URL 입력 | 없음 | loca.lt | 이미 연결 실패 기록, 경고 페이지 |
| P1. PC 자체서명 HTTPS | IP 입력 | 인증서 예외가 다른 출처에 안 통함 | 없음 | 지금 문제 그대로 |
| W1. WebRTC DataChannel | 페어링 필요 | 없음 | 시그널링 서버 | PC 쪽 구현 무거움, Chrome 146부터 WebRTC도 LNA 대상 |

### 4.4 권고 흐름 (사람은 BAT 하나만 실행)

PC 쪽 `run_quest_pc_server.bat`:

1. `.venv` Python으로 `scripts/quest_media_server.py`를 실행한다(포트 8787, `0.0.0.0` 바인드).
2. 공개 폴더: 기본은 `outputs\`(PLY·영상·사진 재귀 탐색).
   폴더를 BAT 위에 드래그하면 그 폴더를 추가하고, 목록은 `quest_server_folders.txt`에 기억한다.
3. `zeroconf`로 서비스 `_sharpvr._tcp.local.`을 등록하고 호스트 이름 `sharp-vr.local`을 PC의 LAN IPv4에 묶는다.
   `zeroconf`가 없으면 경고만 하고 계속 동작한다(L2·L3 경로 사용).
4. 콘솔에 "Quest 앱에서 [PC] 탭을 누르세요"와 백업용 주소·페어링 코드를 출력한다.
5. 처음 실행하면 Windows 방화벽 허용 창이 뜬다.
   사람은 "개인 네트워크 허용"을 눌러야 한다.

앱 쪽 연결 순서(sync-dev):

1. IndexedDB에 저장된 마지막 성공 주소(예: `http://192.168.0.23:8787`)
2. `http://sharp-vr.local:8787`
3. (설정에서 켠 경우) 서브넷 탐색
4. 터널 모드: 페어링된 경우 중계 채널에서 최신 터널 URL을 읽는다.
5. 모두 실패하면 "PC에서 run_quest_pc_server.bat를 실행했는지, 같은 Wi-Fi인지" 안내를 띄운다.
   고급 설정에 수동 주소 입력란을 숨겨 둔다(성공 기준과 무관한 비상용).

모든 LAN 요청은 `fetch(url, { targetAddressSpace: 'local' })`로 보낸다(옵션을 모르는 브라우저는 무시한다).
첫 요청은 사용자가 [PC] 버튼을 누른 클릭 핸들러 안에서 보내 LNA 프롬프트가 자연스럽게 뜨게 한다.

### 4.5 PC 서버 API 계약

| 요청 | 응답 |
|---|---|
| `GET /api/info` | `{ "app": "sharp-quest-server", "version": 1, "host": "<PC 이름>", "roots": [{ "id": "outputs", "label": "outputs" }] }` |
| `GET /api/list?root=<id>&path=<rel>` | `{ "items": [{ "name", "path", "type": "dir"|"file", "kind": "splat"|"video"|"image"|null, "size", "mtime" }] }` |
| `GET /api/recent?kind=splat&limit=200` | 전체 루트에서 최신순 파일 목록(현재 `refresh_splat_manifest.ps1`의 "최신 30개"를 대신함) |
| `GET /files/<root>/<rel>` | 파일 본문. `Range` 지원(206, `Content-Range`, `Accept-Ranges: bytes`), 정확한 `Content-Type` |
| `OPTIONS *` | CORS 사전 요청 응답 |

공통 헤더:

- `Access-Control-Allow-Origin`: 허용 목록(`https://shimanskim.github.io`, `https://localhost:5173`, `https://<LAN IP>:5173`) 중 요청 출처를 그대로 반사한다.
- `Access-Control-Allow-Headers: Range`, `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`
- `Access-Control-Allow-Private-Network: true` (구형 PNA 사전 요청 대비)
- 읽기 전용이다.
  루트 밖 경로(`..`, 심볼릭 링크 탈출)는 403으로 막는다.

Python 표준 `http.server`는 Range를 지원하지 않으므로 직접 구현한다(`ThreadingHTTPServer`, 1MiB 청크 전송).

### 4.6 터널 모드(2순위, 프로브 실패 시 구현)

- BAT 옵션 `--tunnel`이면 `cloudflared tunnel --url http://127.0.0.1:8787`을 함께 띄운다(계정 불필요).
  `cloudflared.exe`가 없으면 `winget install --id Cloudflare.cloudflared` 또는 GitHub 릴리스에서 내려받는다.
- 터널 URL은 매번 바뀌므로 중계 채널이 필요하다.
  PC가 처음 실행될 때 128비트 비밀값을 만들고 6자리 페어링 코드를 콘솔에 보여 준다.
  앱이 코드를 한 번 입력하면 비밀값을 받아 저장한다.
  이후 PC는 실행할 때마다 터널 URL을 비밀값으로 암호화해 ntfy.sh 같은 공개 pub/sub 토픽(토픽 이름 = 비밀값 해시)에 올린다.
- 터널은 인터넷에 열리므로 모든 요청에 비밀값 기반 토큰을 요구한다.
- 이 경로는 성공 기준 ③의 "IP 입력 없이"는 만족하지만 코드 입력이 한 번 생긴다.
  L1이 프로브에서 통과하면 구현하지 않는다.

### 4.7 서비스 워커 소스 프록시

- 앱은 PC·드라이브 파일을 `<base>/__src/<sourceId>/<encoded path>` 같은 **같은 출처 URL**로 연다.
- `sw.js`가 이 경로를 가로채 실제 원본(`http://sharp-vr.local:8787/files/...` 또는 `https://www.googleapis.com/drive/v3/files/<id>?alt=media`)으로 `Range` 헤더를 그대로 전달하고, 드라이브면 `Authorization: Bearer`를 붙인다.
- 효과
  - `<video>`가 seek할 때 보내는 Range 요청이 그대로 통한다.
  - 같은 출처라서 WebGL `VideoTexture`·이미지 텍스처의 CORS 오염이 없고, media 요소의 mixed content 자동 업그레이드 문제도 피한다.
  - WebXR Media Layers는 교차 출처 비디오에서 동작하지 않을 수 있는데 이 문제도 피한다.
- 주의
  - 서비스 워커의 LAN 요청은 페이지가 먼저 LNA 권한을 받은 뒤에만 된다.
  - 앱 셸 캐시 로직(app-dev)과 프록시 로직(sync-dev)을 `sw.js` 안에서 모듈로 나눈다(`sw/shell-cache.js`, `sw/source-proxy.js`를 `importScripts` 또는 빌드 단계에서 합침).
  - Spark PLY 로딩은 페이지에서 `fetch(proxyUrl).body`를 스트림으로 넘기면 된다.

## 5. 구글 드라이브

### 5.1 요건

- 웹앱용 Google Picker는 `https://www.googleapis.com/auth/drive.file` 범위 토큰을 쓴다.
  Picker로 고른 파일만 앱에 접근 권한이 생기므로 민감 범위 심사가 필요 없다.
- 필요한 값
  - OAuth 2.0 클라이언트 ID(유형: 웹 애플리케이션), 승인된 JavaScript 원본 `https://shimanskim.github.io`(개발용 `https://localhost:5173` 추가)
  - API 키(HTTP 리퍼러 `https://shimanskim.github.io/*` 제한, API는 Picker API로 제한)
  - Cloud 프로젝트 번호(`PickerBuilder.setAppId()`에 넣음. 빠지면 다운로드가 404/CORS 오류로 실패한다는 보고가 있다)
- 이 세 값은 브라우저에 노출되도록 설계된 값이라 `quest-app/src/config.js`에 커밋해도 된다.
  클라이언트 시크릿은 쓰지 않는다.
- 토큰은 Google Identity Services(GIS) `initTokenClient`로 받는다.
  토큰은 1시간 유효하고 리프레시 토큰이 없으므로 만료되면 다시 요청한다.
- 파일 내려받기: `GET https://www.googleapis.com/drive/v3/files/<id>?alt=media` + `Authorization: Bearer`.
  큰 영상은 서비스 워커 프록시(4.7)로 Range 스트리밍하고, 오프라인 보관은 OPFS 복사로 한다.

### 5.2 위험

- GIS 팝업이 Quest Browser와 TWA 안에서 정상 동작하는지 문서로 확인하지 못했다.
  프로브에서 확인하고, 막히면 리디렉트 방식(`ux_mode: 'redirect'`, 인증 코드 흐름이 아니라 토큰 흐름 유지)을 시도한다.
- OAuth 동의 화면을 "테스트" 상태로 두면 테스트 사용자로 등록한 계정만 로그인할 수 있다.
  사람 혼자 쓰므로 문제없다.

### 5.3 OAuth 없이 쓰는 대안(안내용)

Quest Browser에서 drive.google.com을 열어 파일을 내려받으면 `Download` 폴더에 저장된다.
그다음 앱의 [기기에서 열기]로 연다.
사람이 OAuth 설정을 미루면 이 방법을 안내 문서에 적는다.

## 6. VR 미디어 렌더 방식

### 6.1 형식과 Three.js 구현

| 형식 | 지오메트리 | 텍스처 매핑 |
|---|---|---|
| 360° mono (2:1) | `SphereGeometry(r=50, 64, 32)`, `scale(-1,1,1)` | 전체 |
| 360° stereo TB (1:1) | 구 2개 | 왼눈 v∈[0.5,1], 오른눈 v∈[0,0.5] |
| 360° stereo SBS (4:1) | 구 2개 | 왼눈 u∈[0,0.5], 오른눈 u∈[0.5,1] |
| VR180 SBS (2:1) | 반구 `SphereGeometry(r, 64, 32, phiStart, Math.PI)` 2개(`phiStart`는 아래 주의 참고) | 눈별 u 절반 |
| VR180 mono (1:1) | 반구 1개 | 전체 |
| 3D SBS 가상 스크린 (Full SBS 32:9, Half SBS 16:9) | `PlaneGeometry` 2개, 거리 3~5m | 눈별 u 절반, 화면 비율은 Full이면 (w/2):h, Half면 w:h |
| 2D 일반 | 평면 1개 | 전체 |

- 눈 분리는 Three.js WebXR 규칙을 쓴다.
  XR 왼눈 카메라는 layer 1, 오른눈 카메라는 layer 2를 켠다.
  왼눈 메시는 `mesh.layers.set(1)`, 오른눈 메시는 `layers.set(2)`로 둔다(three.js 예제 `webxr_vr_video`와 같은 방식).
  XR 밖 2D 미리보기에서는 `camera.layers.enable(1)`로 왼눈만 보여 준다.
- 반구의 `phiStart`는 Three.js `SphereGeometry`의 u=0 위치 때문에 화면 정면이 -Z가 되도록 맞춰야 한다.
  media-dev가 테스트 패턴 이미지(좌/우 눈에 다른 글자, 중앙 십자)로 방향과 눈 순서를 검증한다.
- 텍스처: 영상은 `THREE.VideoTexture`, 사진은 `ImageBitmap`(`createImageBitmap(blob)`) → `THREE.Texture`.
  `colorSpace = SRGBColorSpace`, `generateMipmaps = false`, `minFilter = LinearFilter`.
- 사진도 같은 지오메트리를 쓴다.
  8K 사진은 Quest 3 GPU(Adreno 740) `MAX_TEXTURE_SIZE` 안이면 그대로 쓰고, 넘으면 `createImageBitmap`의 `resizeWidth`로 줄인다.
- **WebXR Media Layers**(`XRMediaBinding.createEquirectLayer`/`createQuadLayer`, `layout: 'stereo-left-right' | 'stereo-top-bottom'`)는 Meta가 몰입형 영상에 가장 효율적이라고 권한다.
  Three.js 예제 `webxr_vr_layers`가 같은 방식을 쓴다.
  메시 방식을 먼저 완성하고, 8K 영상 화질·발열이 문제일 때 `layers` 기능을 지원하는 경우에만 켜는 선택 경로로 둔다.
  데스크톱 WebXR 에뮬레이터에서는 Media Layers가 없으므로 reviewer 검증은 메시 경로로 한다.

### 6.2 형식 자동 판별

1. 파일 이름 힌트: `_360`, `_180`, `VR180`, `_TB`, `_OU`, `_SBS`, `_LR`, `FSBS`, `HSBS`, `_3D`
2. 비율: 2:1 → 360 mono 또는 VR180 SBS(이름 힌트 없으면 360 mono), 1:1 → 360 TB, 32:9 이상 → Full SBS 스크린, 3:1 근처(이 저장소의 8192x2730) → Full SBS 스크린
3. (선택) MP4 `st3d`/`sv3d` 박스 파싱(Google Spatial Media 메타데이터, `make_youtube_vr180_canvas.bat`가 넣는 형태)
4. 사용자가 VR 패널에서 형식을 바꾸면 IndexedDB에 항목별로 기억한다.

### 6.3 Quest Browser 코덱·해상도 한계

- 컨테이너: MP4, WebM, Ogg.
  코덱: H.264, H.265, VP8, VP9, AV1.
- 모든 코덱이 4K까지 되고, **8K는 H.265와 AV1만** 된다.
  VP8은 Quest 3에서 하드웨어 디코드가 안 된다.
  고해상도 VP9도 하드웨어 디코드가 안 된다는 사용자 보고가 있다.
- 하드웨어 디코드 한계: 8192x4096@60 또는 5760x5760@60.
- 2D 전체 화면 재투영은 3840x2160으로 줄여 표시한다(앱은 WebXR이므로 해당 없음).
- 영상은 한 번에 하나만 재생한다.
- **이 저장소의 기존 VR 출력은 H.264 High, 8192x2730, 30fps, 약 37Mbps다**(`outputs/VR/DJAWA_Maruemon_02_quest3_8k_3D_FSBS.mp4`를 ffprobe로 확인).
  H.264 4K 한계를 넘으므로 Quest 앱에서는 재생 실패나 소프트웨어 디코드 끊김이 예상된다.
  - 앱: 열기 전에 `navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType, width, height, bitrate, framerate } })`로 `supported`·`powerEfficient`를 확인하고, 아니면 "HEVC로 변환하세요" 안내를 띄운다.
  - PC: `make_quest_app_video.bat`(media-dev, 선택)로 `hevc_nvenc`(RTX 4080) 재인코딩, 가로 8192 이하·세로 4096 이하, 30/60fps를 만든다.

## 7. 기존 webxr-spark-demo 구조와 새 앱 구조

### 7.1 기존 구조(재사용 지점)

- `webxr-spark-demo/src/main.js`(375줄) 하나에 모든 로직이 있다.
  Three.js 0.180 + `@sparkjsdev/spark` 2.0.0 + Vite 7, `VRButton`, `OrbitControls`.
- 재사용할 것
  - **Quest 품질 프리셋**: `?safe`(1~10단계 foveated), `?lite`, `?quest`, `?quality`, `?nosplat`, `?basic`.
    `SparkRenderer` 옵션(`focalAdjustment`, `maxStdDev`, `minAlpha`, `maxPixelRadius`, `minPixelRadius`, `minSortIntervalMs`, `enableLod`, `lodSplatScale`, `lodRenderScale`, `cone*`, `behindFoveate`)과 `setPixelRatio` 계산을 순수 함수 `getSplatPreset({ mode, level })`로 옮긴다.
    Quest Browser면 기본값이 `safe5`인 규칙도 유지한다.
  - **SHARP PLY 배치**: `splat.quaternion.set(1, 0, 0, 0)`(상하 뒤집힘 보정), `position(0, -0.2, -1.6)`.
  - **VR 컨트롤 매핑**: 왼쪽 스틱 이동, 오른쪽 스틱 회전, 그립 상하, 트리거 줌, X/A(primary) 이전/다음.
    영상 모드에서는 같은 버튼을 재생 컨트롤로 바꾼다(아래 7.3).
  - **renderer 설정**: `antialias: false`, `powerPreference: 'high-performance'`, `xr.enabled = true`.
- 버릴 것: `/splats/manifest.json` 고정 경로, 하드링크 복사(`refresh_splat_manifest.ps1`), 녹화 버튼 UI(필요하면 나중에).
- 기존 데모와 BAT는 그대로 둔다.
  새 앱이 안정되면 README에서 새 앱을 기본 경로로 안내한다.

### 7.2 새 디렉터리 구조와 담당

```text
quest-app/                         # 새 앱 (Vite)
  package.json                     # three 0.180.x, @sparkjsdev/spark 2.0.x 고정
  vite.config.js                   # base, dev https(basicSsl), build.outDir=dist
  index.html
  public/
    manifest.webmanifest           # app-dev (m5)
    icons/                         # 192, 512, maskable
    sw.js                          # 진입점: shell-cache + source-proxy 합침
  src/
    main.js                        # app-dev: 부트스트랩, 화면 전환
    config.js                      # 포트, 드라이브 키, 기능 플래그
    core/
      types.js                     # 공통 JSDoc 타입 (아래 계약) — architect 초안, app-dev 소유
      events.js                    # 작은 이벤트 버스
      xr-stage.js                  # app-dev: renderer/scene/camera/player, XR 세션, 컨트롤러 입력 이벤트
      library.js                   # app-dev: 목록 상태, 현재 항목, 이전/다음, 소스 등록
      store.js                     # app-dev: IndexedDB(library, settings, handles) + OPFS 유틸
    sources/
      device-source.js             # app-dev: input file, FS Access 핸들, OPFS 보관함
      pc-source.js                 # sync-dev: 탐색·연결 순서, /api 호출
      gdrive-source.js             # sync-dev: GIS 토큰, Picker
      proxy-url.js                 # sync-dev: __src URL 만들기, SW와 메시지 교환
    viewers/
      splat/
        splat-viewer.js            # app-dev
        quest-presets.js           # app-dev: 기존 main.js에서 이식
      media/
        media-viewer.js            # media-dev
        projections.js             # media-dev: 360/180/SBS/TB/스크린 메시 생성
        format-detect.js           # media-dev
        decode-check.js            # media-dev: MediaCapabilities
    ui/
      app-shell.js                 # app-dev: 2D 화면(소스 탭, 목록, 설정)
      vr-panel.js                  # app-dev: VR 안 캔버스 패널 + 컨트롤러 레이 선택 (media-dev가 재생 버튼 추가)
      styles.css
    sw/
      shell-cache.js               # app-dev
      source-proxy.js              # sync-dev
scripts/
  quest_media_server.py            # sync-dev
run_quest_pc_server.bat            # sync-dev (저장소 루트)
install_quest_app.bat              # app-dev (m5, APK 설치)
make_quest_app_video.bat           # media-dev (선택)
twa/                               # app-dev (m5): twa-manifest.json, 빌드 메모. keystore는 넣지 않음
.github/workflows/pages.yml        # app-dev (m5)
notes/quest-app-design.md          # 이 문서
notes/quest-app-install-ko.md      # app-dev (m5): 사람용 설치·사용 안내
```

### 7.3 모듈 계약 (병렬 작업용)

```js
/** 목록 항목 */
/** @typedef {{
 *   id: string,              // `${sourceId}:${path 또는 파일 id}`
 *   sourceId: 'session'|'library'|'pc'|'gdrive',
 *   name: string,
 *   kind: 'splat'|'video'|'image',
 *   size?: number,
 *   mime?: string,
 *   mtime?: number,
 *   layout?: MediaLayout,    // media 전용, 판별값 또는 사용자 지정
 * }} LibraryItem */

/** @typedef {'mono2d'|'mono360'|'tb360'|'sbs360'|'sbs180'|'mono180'|'sbsScreenFull'|'sbsScreenHalf'|'tbScreen'} MediaLayout */

/** 소스: 목록과 열기 */
/** @typedef {{
 *   id: string, label: string,
 *   list(path?: string): Promise<{ items: LibraryItem[], dirs?: string[] }>,
 *   open(item: LibraryItem): Promise<OpenedFile>,
 * }} Source */

/** 열린 파일: 뷰어는 필요한 것만 쓴다 */
/** @typedef {{
 *   url: string,             // blob: 또는 __src 프록시 URL (영상·사진)
 *   stream?: () => Promise<ReadableStream<Uint8Array>>, // PLY용, 호출할 때마다 새 스트림
 *   size?: number, name: string, mime?: string,
 *   release(): void,         // blob URL 해제 등
 * }} OpenedFile */

/** 뷰어: xr-stage 위에 붙는다 */
/** @typedef {{
 *   kinds: Array<LibraryItem['kind']>,
 *   mount(stage: XrStage): void,
 *   load(item: LibraryItem, file: OpenedFile): Promise<void>,
 *   unload(): void,
 *   update(dt: number, input: XrInput): void,   // 매 프레임
 *   panelActions?(): Array<{ id: string, label: string, run(): void }>, // VR 패널 버튼
 * }} Viewer */
```

- `xr-stage.js`는 renderer, scene, `player` 그룹, 카메라, XR 세션 시작·종료, 컨트롤러 입력 상태(`XrInput`: 스틱 축, 트리거, 그립, A/B/X/Y 눌림 에지)를 제공한다.
- `library.js`는 현재 항목이 바뀌면 `kind`에 맞는 뷰어를 골라 `unload()` → `load()`를 부른다.
  PLY와 영상을 오갈 때 같은 renderer와 XR 세션을 유지한다.
- 공통 VR 버튼 규칙: X/A = 이전/다음 항목, B/Y = VR 패널 열기/닫기.
  영상이 재생 중이면 오른쪽 트리거 = 재생/일시정지, 오른쪽 스틱 좌우 = 10초 이동으로 바꾼다(PLY 모드의 줌·회전과 겹치지 않게 뷰어가 입력을 가져감).
- 병렬 작업 순서
  - app-dev(m2)가 `core/`, `types.js`, `library.js`, `xr-stage.js`, `device-source.js`, `splat-viewer.js`를 먼저 만든다.
    계약을 바꾸면 이 문서 7.3을 같이 고친다.
  - media-dev(m3)는 계약만 보고 `viewers/media/`를 시작할 수 있다.
    테스트는 `session` 소스(input file)로 한다.
  - sync-dev(m4)는 `quest_media_server.py`와 `pc-source.js`, `sw/source-proxy.js`를 앱 골격과 독립적으로 만들 수 있다.
    PC 서버는 curl로 먼저 검증한다.

## 8. 사람 몫 단계

| # | 단계 | 언제 | 필요한 이유 | 대신할 수 있는 길 |
|---|---|---|---|---|
| H1 | GitHub Pages 활성화 승인 | m5 전 | 저장소 설정 변경(admin). 에이전트가 키링의 `shimansKim` 계정 토큰으로 `gh api`를 실행할 수 있으나 사람 계정으로 하는 설정 변경이므로 승인을 받는다 | 사람이 Settings → Pages → Source: GitHub Actions 선택 |
| H2 | 실기기 프로브 실행(9장) | m2 초기, 구현 전 | LNA·mDNS·파일 선택·2D TWA의 WebXR을 문서로 확정할 수 없음 | 없음. 결과에 따라 PC 연결 방식 결정 |
| H3 | PC에서 `run_quest_pc_server.bat` 첫 실행 시 Windows 방화벽 "개인 네트워크 허용" | m4 검증 때 | Python의 TCP 8787·UDP 5353 수신 허용 | 관리자 BAT로 방화벽 규칙 추가(UAC 승인 필요) |
| H4 | Windows 네트워크 프로필을 "개인"으로 확인 | m4 검증 때 | "공용"이면 수신 연결이 막힘 | 없음 |
| H5 | Meta 개발자 조직 생성·계정 인증(휴대폰 SMS 또는 결제 수단) | APK 설치 전 | 개발자 모드 전제 조건 | 스토어 비공개 채널(역시 개발자 조직 필요) |
| H6 | Meta Horizon 휴대폰 앱에서 Quest 개발자 모드 켜기 | APK 설치 전 | 사이드로드 | 없음 |
| H7 | Quest를 USB로 PC에 연결하고 헤드셋에서 "USB 디버깅 허용" → `install_quest_app.bat` 실행 | APK 설치 때 1회 | APK 설치 | Quest Webloader(webloader.app) 또는 SideQuest |
| H8 | (선택) 사용자 사이트 저장소 `shimansKim/shimansKim.github.io` 생성 승인 | APK 설치 전 | `/.well-known/assetlinks.json`으로 TWA 주소 표시줄 제거 | 생략하면 주소 표시줄이 보이지만 동작함 |
| H9 | 서명 키 백업 위치 확인 | APK 빌드 후 | 키를 잃으면 같은 앱으로 업데이트 불가 | 새 패키지 이름으로 다시 설치 |
| H10 | Google Cloud 설정: 프로젝트 생성 → Drive API·Picker API 사용 설정 → OAuth 동의 화면(외부, 테스트, 본인 계정을 테스트 사용자로, 범위 `drive.file`) → OAuth 클라이언트 ID(웹, 원본 `https://shimanskim.github.io`) → API 키(리퍼러·Picker API 제한) → 클라이언트 ID·API 키·프로젝트 번호를 커맨더에 전달 | m6 | 구글 정책상 계정 소유자만 가능 | 미루면 5.3 대안(드라이브에서 내려받아 기기에서 열기) |
| H11 | 실기기 체크리스트 확인(설치, 기기 PLY, PC 연결, 드라이브, VR180/360/SBS) | m9 | 성공 기준 ⑦ | WebXR 에뮬레이션 기록 + 사람의 결정 |
| H12 | (선택) 기존 8K H.264 영상을 HEVC로 재인코딩할지 결정 | m3 이후 | Quest Browser H.264 4K 한계 | 원본 그대로 두고 4K 이하 파일만 재생 |

## 9. 조기 실기기 프로브 (가장 큰 위험 먼저 확인)

PC 연결 방식과 TWA 모드는 문서만으로 확정할 수 없다.
app-dev와 sync-dev가 첫 PR에서 아래 프로브를 만들고, 커맨더가 사람에게 한 번 실행을 요청한다.

- `quest-app/public/probe.html`(Pages 배포) + `scripts/quest_media_server.py --probe`(최소 버전)
- 확인 항목과 판정
  1. `navigator.xr.isSessionSupported('immersive-vr')` → true
  2. 버튼 클릭 → `fetch('http://sharp-vr.local:8787/api/info', { targetAddressSpace: 'local' })` 성공 여부, LNA 프롬프트 표시 여부
  3. 같은 요청을 PC의 IP 리터럴로 보냈을 때 성공 여부(콘솔에 출력된 IP를 프로브 URL 쿼리로 미리 넣어 둠)
  4. `<video src="__src 프록시 URL">` 재생과 seek(서비스 워커 경유)
  5. `<input type=file>`로 `.ply` 선택 → 이름·크기 표시
  6. `showOpenFilePicker` 존재 여부와 실제 선택 결과
  7. `navigator.storage.persist()` 결과, `estimate()` 용량
  8. `MediaCapabilities.decodingInfo`: H.264 8192x2730, HEVC 8192x4096, AV1 5760x5760
  9. (APK 준비 후) TWA 2D 앱에서 1번과 VR 진입 재확인
- 프로브 페이지는 결과를 화면에 크게 보여 주고, "결과 복사" 버튼으로 JSON을 클립보드에 넣는다.
  사람이 결과를 PC 서버로 보내는 버튼(`POST /api/probe-result` → `outputs/quest_probe_<시각>.json`)도 두면 사람이 옮겨 적을 필요가 없다.
- 판정
  - 2 또는 3 성공 → L1/L2 방식 확정
  - 2·3 모두 실패 → 터널 모드(4.6)로 전환하고 커맨더에 보고

## 10. 작업·저장소 운영 메모

- 사람의 미커밋 변경(`scripts/tool_dashboard_server.py`, `tool_dashboard.html`)이 `main` 작업 트리에 있다.
  모든 멤버는 `git worktree add I:\06_SHARP_GaussianSplatting-wt\<role> -b <branch> origin/quest-app`으로 작업한다.
- `gh`의 기본 활성 계정 `crayonsmilegames`는 push 권한이 없다.
  그냥 `git push`를 하면 Git Credential Manager가 로그인 창을 기다리며 멈춘다.
  push와 PR은 `shimansKim` 토큰으로 한다.

```bash
TOK=$(gh auth token --user shimansKim)
GIT_TERMINAL_PROMPT=0 git -c credential.helper= \
  -c "http.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOK" | base64 -w0)" \
  push -u origin <branch>
GH_TOKEN=$TOK gh pr create --base quest-app ...
```

- 파일 규칙: UTF-8(BOM 없음), CRLF.
  `.gitattributes`가 없으므로 편집기 설정에 주의한다.
- 통합 브랜치: `quest-app`(이 문서 작성 시 `main`에서 만들어 push).

## 참고 자료

- Meta, Package a PWA for Meta Quest: https://developers.meta.com/horizon/documentation/web/pwa-packaging/
- Meta, Progressive Web Apps 개요: https://developers.meta.com/horizon/documentation/web/pwa-overview/
- Meta, Configure a 2D PWA: https://developers.meta.com/horizon/documentation/web/pwa-2d-support/
- Meta, Configure an immersive WebXR PWA: https://developers.meta.com/horizon/documentation/web/pwa-webxr/
- Meta, Browser Video Support: https://developers.meta.com/horizon/documentation/web/browser-video/
- Meta, Media requirements for streaming apps: https://developers.meta.com/vr/documentation/android-apps/media-requirements/
- Meta, Browser release notes: https://developers.meta.com/horizon/release-notes/web/
- Meta, Device Setup(개발자 모드): https://developers.meta.com/vr/documentation/native/android/mobile-device-setup/
- meta-quest/bubblewrap: https://github.com/meta-quest/bubblewrap
- Soft8Soft 포럼, Installing PWA on Meta Quest Browser: https://www.soft8soft.com/topic/installing-pwa-on-meta-quest-browser/
- Chrome, New permission prompt for Local Network Access: https://developer.chrome.com/blog/local-network-access
- Chrome 154 release notes: https://developer.chrome.com/release-notes/154
- Chromium, Android .local 해석 이슈 41127207: https://issues.chromium.org/issues/41127207
- AOSP, DNS Resolver(mDNS .local): https://source.android.com/docs/core/ota/modular-system/dns-resolver
- Chrome, File System Access on Android(Q1 2025): https://developer.chrome.com/blog/new-in-chrome-video-q1-2025
- Chromium Intent to Ship, File System Access on Android: https://groups.google.com/a/chromium.org/g/blink-dev/c/x3IcFv2jY6c
- Cloudflare, Quick Tunnels: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- Google, Drive 파일 다운로드: https://developers.google.com/workspace/drive/api/guides/manage-downloads
- Google, Picker(웹앱): https://developers.google.com/picker/docs
- Spark 2.0 `SplatMesh` 옵션: `webxr-spark-demo/node_modules/@sparkjsdev/spark/dist/types/SplatMesh.d.ts`(`fileBytes`, `fileType`, `fileName`, `stream`, `streamLength`)

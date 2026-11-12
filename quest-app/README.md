# quest-app

Quest 3용 PLY(Gaussian splat)·VR 영상·사진 뷰어 웹앱이다.
설계는 `notes/quest-app-design.md`를 따른다.

## 개발

```bash
cd quest-app
npm ci
npm run dev      # https://<PC IP>:5173 (자체 서명 인증서)
npm test         # 순수 로직 단위 테스트(node --test)
npm run build    # dist/ (base: /sharp-gaussian-splatting-vr-toolkit/, APP_BASE로 바꿀 수 있음)
```

- 배포: `.github/workflows/pages.yml`이 `main`·`quest-app` push에서 GitHub Pages로 올린다.
  PR에서는 빌드만 확인한다.
- 실기기 프로브: `public/probe.html` (설계 9장). PC에서 `run_quest_pc_probe.bat`를 실행하면 `?pc=<PC IP>`가 붙은 주소를 알려 준다.

## 모듈 계약

- 타입: `src/core/types.js` (`LibraryItem`, `Source`, `OpenedFile`, `Viewer`, `XrStage`, `XrInput`).
  소유자는 app-dev다. 바꿔야 하면 commander에게 먼저 알린다.
- 각 모듈은 팩토리 함수를 내보내고 `src/main.js`가 `src/core/registry.js`에 등록한다.
  - 뷰어: `registerViewer(createMediaViewer())`
  - 소스: `registerSource(createPcSource())`
- 코드 안 경로는 `import.meta.env.BASE_URL`(또는 `src/config.js`의 `BASE_URL`)로 만든다. `/`로 시작하는 절대 경로는 Pages에서 깨진다.
- 사람 파일(`.ply`, `.mp4` 등)을 `public/`에 넣지 않는다.

## 구조와 동작 (m2)

- `src/main.js`가 소스·뷰어를 만들어 `registry`에 등록하고 무대(`core/xr-stage.js`)·목록(`core/library.js`)·화면(`ui/app-shell.js`, `ui/vr-panel.js`)을 연결한다.
- 기기 파일: `[기기에서 파일 열기]`(`<input type=file>`, accept 없음) 또는 끌어놓기 → "이번에 연 파일" 목록. `[보관]`을 누르면 OPFS에 복사하고 IndexedDB에 메타데이터를 남겨 "보관함" 탭에 계속 보인다(OPFS가 없으면 IndexedDB blob).
- PLY는 `File.stream()`을 Spark `SplatMesh({ stream, streamLength })`에 넘긴다. Spark는 첫 PLY를 열 때 불러온다.
- 품질 프리셋(`viewers/splat/quest-presets.js`): 기존 데모의 `?safe[=1..10]`, `?lite`, `?quest`, `?quality`를 그대로 옮겼다. Quest 브라우저 기본값은 안전 5. 설정에서 바꾸면 localStorage에 저장하고 다시 시작한다.
- PLY VR 컨트롤: 그립으로 장면 잡아 이동·회전, 양손 그립으로 확대·축소, 왼쪽 스틱 이동, 오른쪽 스틱 30° 스냅 회전(좌우)·높이(위아래, 민 쪽으로 장면이 움직임), 오른쪽 스틱 누르기 크기·위치 맞춤(한 번 더: 1:1 몰입), 왼쪽 스틱 누르기 크기 초기화, X/A 이전·다음, B/Y 짧게 모든 UI 켜기·끄기(공용 VR 패널 포함: 목록·이전/다음·위치 초기화·여기로 옮기기·VR 종료), B/Y 길게 UI를 지금 보는 곳으로 옮기기(UI는 정면 아래쪽 한 자리에 고정되어 저절로 따라오지 않음). 열 때 PLY가 눈앞 적정 크기로 자동 맞춰지고 조작 안내 카드가 뜬다(코드: `src/viewers/splat/`). 패널은 레이를 맞추고 트리거로 선택한다.
- 다른 모듈이 쓰는 `stage` 내부 멤버(계약 밖): `controls`(2D OrbitControls), `controllers`(left/right 레이 공간), `input`(최신 XrInput), `setFrameHandler(fn)`(앱이 하나만 등록), `isVRSupported()`.
- 소스 탭 전용 UI: `shell.setSourcePanel(sourceId, render)`.

# quest-app

Quest 3용 PLY(Gaussian splat)·VR 영상·사진 뷰어 웹앱이다.
설계는 `notes/quest-app-design.md`를 따른다.

## 개발

```bash
cd quest-app
npm ci
npm run dev      # https://<PC IP>:5173 (자체 서명 인증서)
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

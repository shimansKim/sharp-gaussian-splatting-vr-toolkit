# 스토어판 배포 구조

> **폐기 결정:** 웹 앱·스토어 준비물은 폐기 결정됐으며 파일은 아직 남아 있다. 새 작업 대상이 아니다.
> Quest 네이티브 뷰어는 [Splatia](../quest-native/README.md)를 본다.

## 주소
- 앱 주소: `https://shimanskim.github.io/sharp-gaussian-splatting-vr-toolkit/` (설치된 앱 두 개 모두 이 주소를 연다. 바꾸지 않는다)
- 서명 증명: `https://shimanskim.github.io/.well-known/assetlinks.json`

## 누가 그 주소를 서비스하나
| 상태 | 서비스하는 쪽 | 내용 |
|---|---|---|
| 이 저장소가 공개(지금) | 이 저장소의 프로젝트 Pages(`pages.yml`) | 일반 빌드 |
| 이 저장소가 비공개(GitHub Free) | 사용자 사이트 `shimansKim/shimansKim.github.io`의 같은 경로(`store-deploy.yml`) | 스토어판 빌드(`VITE_STORE_BUILD=1`) |

2026-11-13 일회용 저장소로 시험했다.
- 프로젝트 Pages가 켜져 있으면 그 경로 전체를 프로젝트가 맡는다. 사용자 사이트를 그 뒤에 다시 빌드해도 그대로였다.
- 저장소를 비공개로 바꾸면 프로젝트 Pages가 내려가고, 약 20초 안에 사용자 사이트의 같은 경로가 열렸다.

## 배포 흐름(`.github/workflows/store-deploy.yml`)
1. main에 `quest-app/**` 또는 `store-site/**`가 바뀌면 스토어판으로 빌드한다.
2. 앱 파일은 사용자 사이트의 `/sharp-gaussian-splatting-vr-toolkit/`에 올린다.
3. `store-site/`의 파일(`.nojekyll`, `.well-known/assetlinks.json` 등)은 사용자 사이트 루트에 올린다.
4. 사용자 사이트에는 배포 키로 푸시한다. 그래서 이 저장소가 비공개여도 동작한다.
   - 개인 키는 이 저장소 시크릿 `USER_SITE_DEPLOY_KEY`에 있다.
   - 공개 키는 사용자 사이트 저장소의 Settings → Deploy keys에 쓰기 권한으로 등록되어 있다.

사용자 사이트 저장소를 직접 고치지 않는다. 다음 배포 때 덮어써진다.

## targetSdkVersion 32
- Meta Horizon Store는 targetSdkVersion 32를 요구한다.
- Android 프로젝트는 저장소에 없다. `bat\build_quest_apk.bat`(`scripts/quest_apk_tool.py`)가 빌드 때마다 Bubblewrap으로 `%USERPROFILE%\.sharp-quest\twa-build`(VR은 `twa-build-vr`)에 새로 만든다.
- `@meta-quest/bubblewrap-cli`는 `twa/twa-manifest*.json`의 `"isMetaQuest": true`를 보고 `app/build.gradle`에 `targetSdkVersion 32`를 넣는다.
- 그래도 생성물이 달라질 수 있어, `quest_apk_tool.py`가 빌드 직전에 32인지 확인한다. 아니면 32로 고친다(`ensure_target_sdk`).

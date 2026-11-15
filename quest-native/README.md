# Splatia (quest-native)

Splatia는 PC 데이터 생성 툴과 별개 프로젝트인 Quest 3 네이티브 앱이다. PLY(Gaussian splat), VR 영상, VR 사진을 본다.
Android NDK + OpenXR + Vulkan으로 만들고 Unity는 쓰지 않는다.

## 처음 쓰는 사람

그림이 있는 안내: **[docs/install-guide.md](docs/install-guide.md)**

| 더블클릭 | 하는 일 |
|---|---|
| `check_env.bat` | 새 PC에서 처음 한 번. 필요한 설치물을 확인하고 빠진 SDK 구성요소는 설치를 도와준다 |
| `build_and_install.bat` | 앱을 만들고 USB로 연결한 헤드셋에 설치·실행한다 |
| `build.bat` | 앱만 만든다. 출력: `%LOCALAPPDATA%\sharp-quest-native\<체크아웃 폴더>\app\outputs\apk\release\app-release.apk` |
| `install.bat` | 만든 앱을 헤드셋에 설치·실행한다(연결 없음, 허용 필요, 여러 대, 서명이 다른 앱 등을 안내) |
| `tools\diag_all.bat` | 디코더 진단 영상을 만들고 기기에서 측정한다 |
| `tools\encode\quest_encode.bat` | Quest용 영상을 인코딩한다 |
| `tools\collect_log.bat` | 헤드셋에서 무언가 안 될 때 로그를 파일로 저장한다 |
| `tools\run_all_tests.bat` | 헤드셋 없이 할 수 있는 시험을 모두 돌리고 보고서를 만든다 |

- 헤드셋에서 확인할 순서: [docs/device-checklist.md](docs/device-checklist.md)
- 서명·버전·R8 규칙: [docs/release.md](docs/release.md)
- 필요한 것: Android SDK(Platform android-36, NDK 28.1.13356709, CMake 3.22.1, Build-Tools, Platform-Tools), JDK 17 이상(Android Studio에 든 것). 로그인이나 라이선스 활성화는 필요 없다.

## 사진 형식 잠금

사진의 형식이 잘못 보이면 HUD에서 [형식]을 맞춘 뒤 바로 옆 [형식 잠금]을 켠다.
이전·다음 사진과 슬라이드쇼에도 같은 형식을 적용하며 앱을 다시 켜도 잠금이 유지된다.
잠긴 상태에서 형식을 바꾸면 잠긴 형식도 바뀐다.
잠금을 끄면 현재 파일의 요청 형식이나 기존에 기억한 형식을 우선하고, 없으면 자동 판별한다.
잠금 중 적용한 형식은 다른 파일의 개별 기억을 덮어쓰지 않는다.
서로 다른 형식의 사진을 볼 때는 잠금을 끈다.
파일 이름과 비율만으로 SBS와 HSBS를 확실히 구분할 수 없으므로 자동 판별이 틀릴 수 있다.

## 개발하는 사람

- 모듈을 붙이는 규칙: [docs/module-contract.md](docs/module-contract.md)
- 구성요소 라이선스: [docs/licenses.md](docs/licenses.md)(빌드가 7절 목록을 대조한다)
- 기존 웹 앱 기능 대조표: [docs/feature-parity.md](docs/feature-parity.md)
- 영상 인코딩 안내: [docs/encoding-guide.md](docs/encoding-guide.md)
- PC 연결: [docs/pc-source.md](docs/pc-source.md)
- 저장소 접근: [docs/storage-access.md](docs/storage-access.md)
- 디코더 진단: [docs/decoder-diagnostics.md](docs/decoder-diagnostics.md)
- 영상 재생기: [docs/video-player.md](docs/video-player.md)
- PLY 측정: [measure/splat/README.md](measure/splat/README.md)
- 로그: `adb logcat -s QuestNative`

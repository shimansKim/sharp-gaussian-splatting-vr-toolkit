# quest-native

Quest 3에 설치하는 네이티브 앱이다. PLY(Gaussian splat), VR 영상, VR 사진을 본다.
Android NDK + OpenXR + Vulkan으로 만들고 Unity는 쓰지 않는다.

## 처음 쓰는 사람

그림이 있는 안내: **[docs/install-guide.md](docs/install-guide.md)**

| 더블클릭 | 하는 일 |
|---|---|
| `check_env.bat` | 새 PC에서 처음 한 번. 필요한 설치물을 확인하고 빠진 SDK 구성요소는 설치를 도와준다 |
| `build_and_install.bat` | 앱을 만들고 USB로 연결한 헤드셋에 설치·실행한다 |
| `build.bat` | 앱만 만든다. 출력: `%LOCALAPPDATA%\sharp-quest-native\<체크아웃 폴더>\app\outputs\apk\release\app-release.apk` |
| `install.bat` | 만든 앱을 헤드셋에 설치·실행한다(연결 없음, 허용 필요, 여러 대, 서명이 다른 앱 등을 안내) |
| `tools\collect_log.bat` | 헤드셋에서 무언가 안 될 때 로그를 파일로 저장한다 |
| `tools\run_all_tests.bat` | 헤드셋 없이 할 수 있는 시험을 모두 돌리고 보고서를 만든다 |

- 헤드셋에서 확인할 순서: [docs/device-checklist.md](docs/device-checklist.md)
- 서명·버전·R8 규칙: [docs/release.md](docs/release.md)
- 필요한 것: Android SDK(Platform android-36, NDK 28.1.13356709, CMake 3.22.1, Build-Tools, Platform-Tools), JDK 17 이상(Android Studio에 든 것). 로그인이나 라이선스 활성화는 필요 없다.

## 개발하는 사람

- 모듈을 붙이는 규칙: [docs/module-contract.md](docs/module-contract.md)
- 구성요소 라이선스: [docs/licenses.md](docs/licenses.md)(빌드가 7절 목록을 대조한다)
- 기존 웹 앱 기능 대조표: [docs/feature-parity.md](docs/feature-parity.md)
- 영상 인코딩 안내: [docs/encoding-guide.md](docs/encoding-guide.md)
- 로그: `adb logcat -s QuestNative`

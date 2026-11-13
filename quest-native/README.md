# quest-native

Quest 3에 설치하는 네이티브 앱이다. PLY(Gaussian splat), VR 영상, VR 사진을 본다.
Android NDK + OpenXR + Vulkan으로 만들고 Unity는 쓰지 않는다.

- 빌드: `build.bat` 더블클릭. 출력은 `%LOCALAPPDATA%\sharp-quest-native\<체크아웃 폴더>\app\outputs\apk\release\app-release.apk`이다.
- 설치·실행: Quest를 USB로 연결하고 `install.bat`을 더블클릭한다. 로그는 `adb logcat -s QuestNative`로 본다.
- 모듈을 붙이는 규칙: [docs/module-contract.md](docs/module-contract.md)
- 구성요소 라이선스: [docs/licenses.md](docs/licenses.md)
- 기존 웹 앱 기능 대조표: [docs/feature-parity.md](docs/feature-parity.md)
- 영상 인코딩 안내: [docs/encoding-guide.md](docs/encoding-guide.md)

필요한 것: Android SDK(NDK 28.1.13356709, CMake 3.22.1, platform android-35, build-tools 35), JDK 17 이상(Android Studio에 든 것).
로그인이나 라이선스 활성화는 필요 없다.

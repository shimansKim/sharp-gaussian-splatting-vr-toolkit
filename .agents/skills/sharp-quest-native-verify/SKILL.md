---
name: sharp-quest-native-verify
description: SHARP 저장소의 quest-native 뷰어를 빌드, 시험, APK 설치하거나 로그를 모을 때 사용한다. Quest 네이티브 빌드, 헤드셋 없는 전체 시험, 기기 파일 전송과 서드파티 라이선스 고지 검증 요청에도 사용한다.
---

# Quest 네이티브 빌드와 검증

기준 경로는 `I:\06_SHARP_GaussianSplatting`이다.
실제 작업은 별도 `<worktree>`에서 한다.

## 환경과 빌드

- JDK 17 이상, Android SDK android-36, NDK 28.1.13356709, CMake 3.22.1, Build-Tools와 platform-tools가 필요하다.
- `quest-native/tools/qn_env.bat`은 기존 `JAVA_HOME`을 우선하고 Android Studio의 jbr과 Temurin을 차례로 찾는다.
  이 PC는 `Android Studio1\jbr`을 쓴다.
- 새 PC에서는 `cmd /c "<worktree>\quest-native\check_env.bat"`으로 환경을 확인한다.
  이 파일은 `nopause`를 지원하지 않고 마지막에 멈춘다.
  누락된 SDK 설치 여부도 물을 수 있으므로 비대화형 환경에서는 출력을 확인하고 설치를 임의 승인하지 않는다.
  스크립트의 종료 코드 0만으로 환경 정상을 판정하지 않는다.
- 빌드는 전체 경로로 `cmd /c "<worktree>\quest-native\build.bat" nopause`를 실행한다.
  상대 경로 호출은 Windows 설정에 따라 실패할 수 있다.
- 기본 APK는 `%LOCALAPPDATA%\sharp-quest-native\<체크아웃 폴더명>\app\outputs\apk\release\app-release.apk`에 있다.
  `QN_BUILD_ROOT`를 설정하면 위치가 바뀐다.
  서명 키는 기본적으로 `%USERPROFILE%\.sharp-quest-native`에 있다.

## 헤드셋 없는 전체 시험

`cmd /c "<worktree>\quest-native\tools\run_all_tests.bat" -Report "<report-file>"`을 실행한다.
빈 빌드 폴더에서 APK를 빌드하고 JVM 단위 시험, image·splat C++ PC 시험, `qnCheckLicenses`, APK 요약을 수행한다.
Visual Studio 2022 C++가 없으면 해당 시험의 SKIPPED를 그대로 보고한다.
인수가 없으면 마지막에 멈춘다.
`nopause`도 전달되지만 PowerShell 스크립트의 첫 위치 인수인 보고서 파일명으로 해석되므로 `-Report`와 명시적인 경로를 쓴다.
이 스크립트는 `quest-native/local.properties`를 쓰므로 기존 파일이 있으면 먼저 확인한다.
빌드 출력과 보고서는 저장소 밖에도 남는다.

## 기기 설치와 로그

기기 조작은 승인된 대상에만 한다.
`adb devices`에 여러 대가 보이면 대상을 추측하지 말고 사람에게 시리얼을 확인한다.
직접 adb를 실행할 때마다 `adb -s <serial>`로 지정한다.
설치는 기존 앱과 데이터를 바꿀 수 있으므로 사전에 승인받는다.

- `cmd /c "<worktree>\quest-native\install.bat" nopause`는 마지막 pause를 생략하지만 연결 없음, 기기 선택, 서명 불일치 등에서 추가 입력을 요구할 수 있다.
  여러 기기가 있으면 이 스크립트의 선택 화면에서 확인된 시리얼을 고른다.
  설치 과정의 기존 앱 삭제는 데이터가 사라질 수 있으므로 별도 승인 없이 진행하지 않는다.
- 시험 파일은 앱 전용 폴더에 넣는다.
  앱을 삭제하면 이 폴더도 삭제된다.

```bash
adb -s <serial> shell mkdir -p /sdcard/Android/data/com.sharp.questnative/files
adb -s <serial> push <sample-file> /sdcard/Android/data/com.sharp.questnative/files/<sample-name>
adb -s <serial> shell am start -n com.sharp.questnative/.core.QnActivity --es qn.open file:///sdcard/Android/data/com.sharp.questnative/files/<sample-name>
adb -s <serial> logcat -s QuestNative
```

공용 Download나 Movies 폴더의 `file://`은 접근 권한이 없어 실패할 수 있다.
`tools/collect_log.bat`은 `nopause`를 지원하지 않고 탐색기를 연다.
여러 기기 중 시리얼을 선택하는 기능도 없으므로 직접 `adb -s <serial> logcat`을 쓴다.
로그와 시험 파일을 공유하기 전 민감 정보가 있는지 확인한다.

## 의존성·서드파티 고지

APK에 GPL 또는 유료 구성요소를 넣지 않는다.
해당 구성요소를 발견하면 추가하지 말고 보고한다.
들여온 코드에는 저작권 줄을 포함한 LICENSE 원문을 `quest-native/app/src/main/cpp/<module>/third_party/<folder>/`에 둔다.
같은 PR에서 `quest-native/docs/licenses.md` 1절 표와 7절 목록을 갱신한다.
7절의 각 줄은 `maven <group:artifact>`, `native <module>/<folder>`, `own <module>/<folder>`, `text <filename>` 형식이다.
`native`는 LICENSE 파일이 필요하고 `own`은 자체 코드용이다.
전이 의존성도 `releaseRuntimeClasspath`와 목록이 일치해야 한다.

환경을 설정한 같은 셸에서 `cmd /c "<worktree>\quest-native\gradlew.bat" -p "<worktree>\quest-native" :app:qnCheckLicenses`를 실행하거나 전체 시험을 사용한다.
실패 메시지와 `quest-native/app/build.gradle`의 검사 규칙을 확인한다.

## 보고

빌드 결과, 시험 보고서 경로, APK 경로와 크기, 실패·SKIPPED 항목을 적는다.
실기기를 시험하지 않았다면 명시한다.
빌드나 PC 시험 성공을 실기기 동작 성공으로 보고하지 않는다.
`run_all_tests.ps1`은 Windows PowerShell 5.1 호환을 위해 ASCII를 유지한다.

@echo off
rem quest-native 공용 설정. 다른 bat이 call "%~dp0tools\qn_env.bat"로 부른다(직접 실행할 필요 없음).
rem 정하는 값: JAVA_HOME, ANDROID_HOME, QN_BUILD_ROOT, QN_ADB, QN_APK, QN_PKG, 필요한 SDK 구성요소 버전.

if not defined ANDROID_HOME if defined ANDROID_SDK_ROOT set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"

rem JDK 17 이상: 설정돼 있지 않으면 Android Studio에 든 jbr, 그다음 Temurin(Adoptium)을 찾는다.
if defined JAVA_HOME if not exist "%JAVA_HOME%\bin\java.exe" set "JAVA_HOME="
if not defined JAVA_HOME if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if not defined JAVA_HOME if exist "%ProgramFiles%\Android\Android Studio1\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio1\jbr"
if not defined JAVA_HOME if exist "%LOCALAPPDATA%\Programs\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%LOCALAPPDATA%\Programs\Android Studio\jbr"
if not defined JAVA_HOME for /d %%D in ("%ProgramFiles%\Eclipse Adoptium\jdk-2*" "%ProgramFiles%\Eclipse Adoptium\jdk-17*") do if exist "%%~D\bin\java.exe" set "JAVA_HOME=%%~D"

rem 빌드 출력은 저장소 밖, 체크아웃(quest-native를 담은 폴더) 이름마다 따로.
for %%I in ("%~dp0..\..") do set "QN_CHECKOUT=%%~nxI"
if not defined QN_BUILD_ROOT set "QN_BUILD_ROOT=%LOCALAPPDATA%\sharp-quest-native\%QN_CHECKOUT%"

set "QN_ROOT=%~dp0.."
set "QN_ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "QN_APK=%QN_BUILD_ROOT%\app\outputs\apk\release\app-release.apk"
set "QN_PKG=com.sharp.questnative"
set "QN_ACTIVITY=com.sharp.questnative/.core.QnActivity"
set "QN_PLATFORM=android-36"
set "QN_NDK=28.1.13356709"
set "QN_CMAKE=3.22.1"
set "QN_BUILD_TOOLS=35.0.0"
set "QN_KEY_DIR=%USERPROFILE%\.sharp-quest-native"
exit /b 0

@echo off
setlocal
rem Double-click build of quest-native (Android NDK + OpenXR + Vulkan, no Unity).
rem Needs: Android SDK with NDK 28.1.13356709, CMake 3.22.1, platform 35, and a JDK 17+.
rem Output: %LOCALAPPDATA%\sharp-quest-native\<checkout folder>\app\outputs\apk\release\app-release.apk
cd /d "%~dp0"

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined JAVA_HOME (
  if exist "%ProgramFiles%\Android\Android Studio1\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio1\jbr"
)
if not defined JAVA_HOME (
  if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
)
if not defined JAVA_HOME (
  echo [error] JDK not found. Install Android Studio or set JAVA_HOME.
  if "%~1"=="" pause
  exit /b 1
)
rem Build outputs stay on the user profile drive, not in the repo.
rem One build folder per checkout (the folder that holds quest-native), so worktrees can build at once.
for %%I in ("%~dp0..") do set "QN_CHECKOUT=%%~nxI"
if not defined QN_BUILD_ROOT set "QN_BUILD_ROOT=%LOCALAPPDATA%\sharp-quest-native\%QN_CHECKOUT%"
> local.properties echo sdk.dir=%ANDROID_HOME:\=/%

call "%~dp0gradlew.bat" --project-cache-dir "%QN_BUILD_ROOT%\gradle-project-cache" assembleRelease
if errorlevel 1 (
  echo [error] build failed
  if "%~1"=="" pause
  exit /b 1
)
echo.
echo APK: %QN_BUILD_ROOT%\app\outputs\apk\release\app-release.apk
if "%~1"=="" pause
exit /b 0

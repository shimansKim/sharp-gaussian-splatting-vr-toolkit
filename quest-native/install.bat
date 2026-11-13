@echo off
setlocal
rem Install and launch quest-native on a USB-connected Quest (developer mode on). Run build.bat first.
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
rem One build folder per checkout (the folder that holds quest-native), so worktrees can build at once.
for %%I in ("%~dp0..") do set "QN_CHECKOUT=%%~nxI"
if not defined QN_BUILD_ROOT set "QN_BUILD_ROOT=%LOCALAPPDATA%\sharp-quest-native\%QN_CHECKOUT%"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "APK=%QN_BUILD_ROOT%\app\outputs\apk\release\app-release.apk"
if not exist "%APK%" (
  echo [error] APK not found: %APK%
  if "%~1"=="" pause
  exit /b 1
)
"%ADB%" install -r -g "%APK%"
if errorlevel 1 (
  echo [error] install failed. Is the Quest connected and allowed for USB debugging?
  if "%~1"=="" pause
  exit /b 1
)
"%ADB%" shell am start -n com.sharp.questnative/.core.QnActivity
echo Log: "%ADB%" logcat -s QuestNative
if "%~1"=="" pause
exit /b 0

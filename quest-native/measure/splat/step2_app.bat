@echo off
rem App benchmark. Drag one SHARP PLY onto this file. Korean instructions: README.md.
rem Keep cmd control files ASCII: multibyte UTF-8 can break label/buffer offsets on Windows.
chcp 65001 >nul
setlocal
set PYTHONIOENCODING=utf-8
set "PAUSE=pause"
if not "%~2"=="" set "PAUSE=ver >nul"
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
for %%I in ("%~dp0..\..\..") do set "CHECKOUT=%%~nxI"
if not defined QN_BUILD_ROOT set "QN_BUILD_ROOT=%LOCALAPPDATA%\sharp-quest-native\%CHECKOUT%"
set "APK=%QN_BUILD_ROOT%\app\outputs\apk\release\app-release.apk"
set "PKG=com.sharp.questnative"
set "FILES=/sdcard/Android/data/%PKG%/files"
set "PLY=%~1"
rem Only overwrite this benchmark-owned filename; never delete other PLY files or the existing CSV.
set "PLYNAME=qnsplat_bench_scene.ply"
set "OUT=%~dp0measurements"
if "%PLY%"=="" (echo Drag a SHARP PLY onto this batch file. & %PAUSE% & exit /b 1)
if not exist "%PLY%" (echo File not found: %PLY% & %PAUSE% & exit /b 1)
"%ADB%" get-state 1>nul 2>nul || (echo Quest not connected. Allow USB debugging in the headset. & %PAUSE% & exit /b 1)
if not exist "%OUT%" mkdir "%OUT%"

if not exist "%APK%" (
  echo Building the missing APK...
  call "%~dp0..\..\build.bat" nopause || (%PAUSE% & exit /b 1)
)

echo [1/4] Install APK and copy the PLY...
"%ADB%" install -r -g "%APK%" || (echo Install failed. & %PAUSE% & exit /b 1)
"%ADB%" shell am force-stop %PKG%
"%ADB%" shell mkdir -p %FILES%/ply
"%ADB%" push "%PLY%" %FILES%/ply/%PLYNAME% >nul || (echo PLY copy failed. & %PAUSE% & exit /b 1)
for %%P in (budget scale fov key hz recenter measure stereo draw half probe minc acut sd2 maxpx pose benchpid) do "%ADB%" shell setprop debug.qnsplat.%%P "''"
rem Explicit reference knobs: no contribution cull, full support, shared sort. Not a quality preset.
for %%P in ("stereo=1" "draw=3" "half=0" "probe=0" "minc=0" "acut=1" "sd2=8" "maxpx=2048" "fov=0" "key=16" "hz=72") do for /f "tokens=1,2 delims==" %%K in ("%%~P") do "%ADB%" shell setprop debug.qnsplat.%%K %%L

echo [2/4] Open PLY. Put on the headset now; waiting 20 seconds...
"%ADB%" shell am start -n %PKG%/.core.QnActivity --es qn.open "file://%FILES%/ply/%PLYNAME%" >nul
powershell -NoProfile -Command "Start-Sleep -Seconds 20"
"%ADB%" shell setprop debug.qnsplat.recenter 1

echo [3/4] Measure each condition for 30 seconds. Slowly turn your head left and right.
call "%~dp0step2_measure.bat" 0 1.0 b0_s100
call "%~dp0step2_measure.bat" 600000 1.0 b600k_s100
call "%~dp0step2_measure.bat" 400000 1.0 b400k_s100
call "%~dp0step2_measure.bat" 200000 1.0 b200k_s100
call "%~dp0step2_measure.bat" 0 0.8 b0_s080
call "%~dp0step2_measure.bat" 0 0.6 b0_s060

echo [4/4] Collect CSV and logs...
"%ADB%" pull %FILES%/qnsplat_metrics.csv "%OUT%\app_metrics.csv" >nul 2>nul && echo   %OUT%\app_metrics.csv
"%ADB%" logcat -d -s QuestNative:* > "%OUT%\app_questnative_log.txt"
echo.
echo ===== Summary =====
findstr "QNSPLAT_SUMMARY" "%OUT%\app_b*.txt"
echo Raw logs: %OUT%\app_*.txt
echo After testing, clear debug.qnsplat overrides and restart the app. See README.md.
endlocal
if "%~2"=="" pause

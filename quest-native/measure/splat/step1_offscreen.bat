@echo off
rem 1단계: 앱 없이 Quest GPU 시간만 잰다(창·OpenXR 없이 Vulkan만 쓰는 offscreen_bench).
rem 사용: SHARP PLY 파일을 이 bat 위에 끌어다 놓는다. 또는 step1_offscreen.bat "C:\...\frame.ply"
rem 결과: measurements\offscreen_*.txt 와 화면 요약. 이 단계는 헤드셋을 쓰지 않아도 된다.
chcp 65001 >nul
setlocal
set PYTHONIOENCODING=utf-8
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
for %%I in ("%~dp0..\..\..") do set "CHECKOUT=%%~nxI"
if not defined QN_TOOLS_DIR set "QN_TOOLS_DIR=%LOCALAPPDATA%\sharp-quest-native\%CHECKOUT%\splat-tools"
set "PLY=%~1"
set "OUT=%~dp0measurements"
set "REMOTE=/data/local/tmp/qnsplat"
if "%PLY%"=="" (echo [안내] SHARP PLY 파일을 이 bat 위에 끌어다 놓으세요. & goto :end)
if not exist "%PLY%" (echo [오류] 파일이 없습니다: %PLY% & goto :end)
"%ADB%" get-state 1>nul 2>nul || (echo [오류] Quest가 연결돼 있지 않습니다. USB 디버깅을 허용했는지 확인하세요. & goto :end)
if not exist "%OUT%" mkdir "%OUT%"

if not exist "%QN_TOOLS_DIR%\offscreen_bench" call "%~dp0build_tools.bat" || goto :end

echo [1/3] 도구와 PLY를 기기에 복사합니다...
"%ADB%" shell mkdir -p %REMOTE%
"%ADB%" push "%QN_TOOLS_DIR%\offscreen_bench" "%QN_TOOLS_DIR%\sharp_pack_check" %REMOTE%/ >nul
"%ADB%" push "%PLY%" %REMOTE%/scene.ply >nul
"%ADB%" shell chmod 755 %REMOTE%/offscreen_bench %REMOTE%/sharp_pack_check
rem 헤드셋을 벗어 두어도 잠들지 않게(근접 센서 무시). 끝나면 되돌린다.
"%ADB%" shell am broadcast -a com.oculus.vrpowermanager.prox_close >nul 2>nul

echo [2/3] 불러오기 시간(CPU)...
"%ADB%" shell "cd %REMOTE% && ./sharp_pack_check scene.ply" > "%OUT%\offscreen_load.txt"
type "%OUT%\offscreen_load.txt" | findstr /b "file: OK FAIL"

echo [3/3] GPU 시간: 118만/60만/40만/20만 splat x 배율 1.0, 그리고 118만 x 배율 0.8 (각 20초)
for %%B in (0 600000 400000 200000) do (
  echo   - splat 상한 %%B ^(0 = 전체^)
  "%ADB%" shell "cd %REMOTE% && ./offscreen_bench scene.ply --budget %%B --seconds 20" > "%OUT%\offscreen_b%%B_s100.txt"
  findstr "QNSPLAT_SUMMARY FAIL" "%OUT%\offscreen_b%%B_s100.txt"
)
"%ADB%" shell "cd %REMOTE% && ./offscreen_bench scene.ply --budget 0 --scale 0.8 --seconds 20" > "%OUT%\offscreen_b0_s080.txt"
findstr "QNSPLAT_SUMMARY FAIL" "%OUT%\offscreen_b0_s080.txt"

"%ADB%" shell am broadcast -a com.oculus.vrpowermanager.automation_disable >nul 2>nul
echo.
echo 72Hz 예산은 13.9ms다. gpu_ms가 이보다 충분히 작아야(대략 11ms 이하) 앱에서 72fps를 지킬 여유가 있다.
echo 원본 기록: %OUT%\offscreen_*.txt
:end
endlocal
if "%~2"=="" pause

@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
rem 앱을 진단 모드로 켜고 시험 영상을 처음부터 끝까지 재생해 잰 뒤, 결과를 PC로 가져온다.
rem   먼저: install.bat(앱 설치), diag_push_videos.bat(시험 영상 넣기)
rem   18개 x 약 25초 = 8분 안팎. 그동안 헤드셋을 쓰고 있는 것이 가장 확실하다.
rem   (헤드셋을 안 써도 되게 근접 센서를 잠시 끄는 명령을 보내지만, 기기에 따라 안 들을 수 있다.)

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "DIR=/sdcard/Android/data/com.sharp.questnative/files/diagnostics"

"%ADB%" get-state >nul 2>&1
if errorlevel 1 (
  echo [오류] Quest가 연결돼 있지 않습니다.
  if "%~1"=="" pause
  exit /b 1
)
"%ADB%" shell rm -f %DIR%/last-run.txt
rem 근접 센서 끄기(헤드셋을 벗어도 화면 유지). 끝나면 되돌린다.
"%ADB%" shell am broadcast -a com.oculus.vrpowermanager.prox_close >nul 2>&1
"%ADB%" shell am start -S -n com.sharp.questnative/.core.QnActivity --es qn.open "qn-diag://run-all/decoder-diagnostics.qndiag"
if errorlevel 1 (
  echo [오류] 앱을 켜지 못했습니다. install.bat으로 먼저 설치하세요.
  goto :restore
)
echo 진단을 시작했습니다. 끝날 때까지 기다립니다(최대 40분). 헤드셋 안 HUD에 진행 상황이 보입니다.
set DONE=
set LINE=
for /l %%i in (1,1,240) do (
  if not defined DONE (
    timeout /t 10 /nobreak >nul
    for /f "delims=" %%L in ('"%ADB%" shell cat %DIR%/last-run.txt 2^>nul') do set "LINE=%%L"
    if defined LINE (
      echo !LINE! | findstr /b "done" >nul && set DONE=1
    )
    if not defined DONE <nul set /p "=."
  )
)
echo.
if defined DONE (echo 진단 끝: !LINE!) else (echo [주의] 40분 안에 끝나지 않았습니다. 지금까지의 결과를 가져옵니다.)

:restore
"%ADB%" shell am broadcast -a com.oculus.vrpowermanager.automation_disable >nul 2>&1
call "%~dp0diag_pull_results.bat" nopause
if "%~1"=="" pause
exit /b 0

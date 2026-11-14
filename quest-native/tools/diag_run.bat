@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
rem 앱을 진단 모드로 켜고 시험 영상을 처음부터 끝까지 재생해 잰 뒤, 결과를 PC로 가져온다.
rem   먼저: install.bat(앱 설치), diag_push_videos.bat(시험 영상 넣기)
rem   사용: diag_run.bat [T07 T08 ...] [초] [x2] [nopause]   (순서 무관)
rem     T07 T08 : 이 시험만 잰다(없으면 기기에 있는 시험 영상 전부)
rem     초      : 시험마다 첫 화면 뒤 이만큼만 잰다(없으면 영상 끝까지. 영상 길이는 diag_make_videos.bat이 정함)
rem     x2      : 쉬지 않고 두 번(x3은 세 번) 잰다. 열이 쌓인 상태를 보려면 x2.
rem     nopause : 끝에 멈추지 않는다(다른 bat·원격 실행용)
rem   환경 변수 QN_DIAG_TESTS(예: "T07 T08")도 시험 고르기로 읽는다.
rem   20초 영상 18개면 한 번에 8분 안팎. 그동안 헤드셋을 쓰고 있는 것이 가장 확실하다.
rem   (헤드셋을 안 써도 되게 근접 센서를 잠시 끄는 명령을 보내지만, 기기에 따라 안 들을 수 있다.)

set "NOPAUSE="
set "TESTS="
set "SECONDS="
set "ROUNDS=1"
for %%A in (%* %QN_DIAG_TESTS%) do call :arg "%%~A"

if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "DIR=/sdcard/Android/data/com.sharp.questnative/files/diagnostics"

"%ADB%" get-state >nul 2>&1
if errorlevel 1 (
  echo [오류] Quest가 연결돼 있지 않습니다.
  if not defined NOPAUSE pause
  exit /b 1
)
set "URI=qn-diag://run-all"
if defined TESTS set "URI=!URI!/tests=!TESTS!"
if defined SECONDS set "URI=!URI!/seconds=!SECONDS!"
set "URI=!URI!/decoder-diagnostics.qndiag"
echo 진단 주소: !URI!
if defined TESTS (echo 고른 시험: !TESTS!) else (echo 고른 시험: 기기에 있는 시험 영상 전부)
if defined SECONDS (echo 시험마다 잴 길이: 첫 화면 뒤 !SECONDS!초) else (echo 시험마다 잴 길이: 영상 끝까지)
echo 횟수: !ROUNDS!번 이어서

rem 근접 센서 끄기(헤드셋을 벗어도 화면 유지). 끝나면 되돌린다.
"%ADB%" shell am broadcast -a com.oculus.vrpowermanager.prox_close >nul 2>&1
set RC=0
for /l %%R in (1,1,!ROUNDS!) do (
  if "!RC!"=="0" call :round %%R
)
goto :restore

:round
echo.
echo [%1/!ROUNDS!번째] 진단을 시작합니다.
"%ADB%" shell rm -f %DIR%/last-run.txt
"%ADB%" shell am start -S -n com.sharp.questnative/.core.QnActivity --es qn.open "!URI!"
if errorlevel 1 (
  echo [오류] 앱을 켜지 못했습니다. install.bat으로 먼저 설치하세요.
  set RC=1
  exit /b 1
)
echo 끝날 때까지 기다립니다(최대 2시간). 헤드셋 안 HUD에 진행 상황이 보입니다.
set DONE=
set LINE=
rem timeout은 표준 입력이 리다이렉트된 셸(원격 실행)에서 실패하므로 ping으로 10초씩 기다린다.
rem 블록 안의 파이프는 !LINE!을 풀지 못하므로 앞 4글자를 바로 비교한다.
for /l %%i in (1,1,720) do (
  if not defined DONE (
    ping -n 11 127.0.0.1 >nul
    set LINE=
    for /f "delims=" %%L in ('"%ADB%" shell cat %DIR%/last-run.txt 2^>nul') do set "LINE=%%L"
    if defined LINE if "!LINE:~0,4!"=="done" set DONE=1
    if not defined DONE <nul set /p "=."
  )
)
echo.
if defined DONE (
  echo [%1/!ROUNDS!번째] 진단 끝: !LINE!
) else (
  echo [주의] 2시간 안에 끝나지 않았습니다. 지금까지의 결과를 가져옵니다.
  set RC=1
)
exit /b 0

:restore
"%ADB%" shell am broadcast -a com.oculus.vrpowermanager.automation_disable >nul 2>&1
call "%~dp0diag_pull_results.bat" nopause
if not defined NOPAUSE pause
exit /b %RC%

rem 인수 하나: nopause, Tnn, 숫자(초), xN(횟수). 빈 인수는 무시한다.
:arg
set "X=%~1"
if "%X%"=="" exit /b 0
if /i "%X%"=="nopause" (set "NOPAUSE=1" & exit /b 0)
echo %X%| findstr /r /i /x "T[0-9][0-9]" >nul
if not errorlevel 1 (
  if defined TESTS (set "TESTS=%TESTS%,%X%") else (set "TESTS=%X%")
  exit /b 0
)
echo %X%| findstr /r /x "[0-9][0-9]*" >nul
if not errorlevel 1 (set "SECONDS=%X%" & exit /b 0)
echo %X%| findstr /r /i /x "x[1-9]" >nul
if not errorlevel 1 (set "ROUNDS=%X:~1%" & exit /b 0)
echo [주의] 모르는 인수를 건너뜁니다: %X%
exit /b 0

@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem 시험 영상(T*.mp4, T*.mkv)을 Quest의 앱 전용 폴더로 보낸다(권한 필요 없음).
rem   사용: diag_push_videos.bat [영상 폴더] [T07 T08 ...] [초] [nopause]   (순서 무관)
rem     영상 폴더 : 기본 %LOCALAPPDATA%\sharp-quest-native\diag-videos (초가 20이 아니면 diag-videos-<초>s)
rem     T07 T08   : 이 시험만 보낸다(없으면 폴더의 시험 영상 전부)
rem     초        : diag_make_videos.bat에 준 영상 길이. 기본 폴더를 고르는 데만 쓴다. QN_DIAG_SECONDS도 같다.
rem   환경 변수 QN_DIAG_TESTS(예: "T07 T08")도 시험 고르기로 읽는다.
rem   대상: /sdcard/Android/data/com.sharp.questnative/files/diagnostics/tests/
rem   같은 이름의 파일은 크기·시각이 다르면 덮어쓴다(adb push --sync). 앱을 지우면 이 폴더도 지워진다.

set "SRC="
set "NOPAUSE="
set "SEL= "
set "DUR=20"
if defined QN_DIAG_SECONDS set "DUR=%QN_DIAG_SECONDS%"
for %%A in (%* %QN_DIAG_TESTS%) do call :arg "%%~A"
if not defined SRC (
  if "%DUR%"=="20" (set "SRC=%LOCALAPPDATA%\sharp-quest-native\diag-videos") else (set "SRC=%LOCALAPPDATA%\sharp-quest-native\diag-videos-%DUR%s")
)
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "DEV=/sdcard/Android/data/com.sharp.questnative/files/diagnostics/tests"

"%ADB%" get-state >nul 2>&1
if errorlevel 1 (
  echo [오류] Quest가 연결돼 있지 않습니다. USB로 연결하고 헤드셋 안에서 USB 디버깅을 허용하세요.
  if not defined NOPAUSE pause
  exit /b 1
)
if not exist "%SRC%\T*_*.*" (
  echo [오류] 시험 영상이 없습니다: %SRC%
  echo 먼저 diag_make_videos.bat을 실행하세요.
  if not defined NOPAUSE pause
  exit /b 1
)
"%ADB%" shell mkdir -p %DEV%
echo 영상 폴더: %SRC%
set SENT=0
for %%F in ("%SRC%\T*_*.mp4" "%SRC%\T*_*.mkv") do call :push "%%~fF" "%%~nxF"
if "%SENT%"=="0" echo [주의] 보낸 영상이 없습니다. 고른 시험:%SEL%
echo.
"%ADB%" shell ls -l %DEV%
echo.
echo 끝. 다음 단계: diag_run.bat
if not defined NOPAUSE pause
exit /b 0

:push
set "NAME=%~2"
set "ID=%NAME:~0,3%"
if not "%SEL%"==" " (
  call set "REST=%%SEL: %ID% =%%"
  call :skipcheck
  if defined SKIP exit /b 0
)
echo [보내는 중] %~2
"%ADB%" push --sync "%~1" "%DEV%/%~2" >nul
if errorlevel 1 (echo [실패] %~2) else (set /a SENT+=1)
exit /b 0

:skipcheck
set "SKIP="
if "%REST%"=="%SEL%" set "SKIP=1"
exit /b 0

rem 인수 하나: nopause, Tnn, 숫자(초), 그 밖은 영상 폴더. 빈 인수는 무시한다.
:arg
set "X=%~1"
if "%X%"=="" exit /b 0
if /i "%X%"=="nopause" (set "NOPAUSE=1" & exit /b 0)
echo %X%| findstr /r /i /x "T[0-9][0-9]" >nul
if not errorlevel 1 (set "SEL=%SEL%%X% " & exit /b 0)
echo %X%| findstr /r /x "[0-9][0-9]*" >nul
if not errorlevel 1 (set "DUR=%X%" & exit /b 0)
set "SRC=%X%"
exit /b 0

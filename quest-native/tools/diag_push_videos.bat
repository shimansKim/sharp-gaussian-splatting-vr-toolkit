@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem 시험 영상(T*.mp4, T*.mkv)을 Quest의 앱 전용 폴더로 보낸다(권한 필요 없음).
rem   사용: diag_push_videos.bat [영상 폴더]   기본: %LOCALAPPDATA%\sharp-quest-native\diag-videos
rem   대상: /sdcard/Android/data/com.sharp.questnative/files/diagnostics/tests/
rem   이미 같은 파일이 있으면 건너뛴다(adb push --sync). 앱을 지우면 이 폴더도 지워진다.

set "SRC=%~1"
if "%SRC%"=="" set "SRC=%LOCALAPPDATA%\sharp-quest-native\diag-videos"
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
set "DEV=/sdcard/Android/data/com.sharp.questnative/files/diagnostics/tests"

"%ADB%" get-state >nul 2>&1
if errorlevel 1 (
  echo [오류] Quest가 연결돼 있지 않습니다. USB로 연결하고 헤드셋 안에서 USB 디버깅을 허용하세요.
  if "%~2"=="" pause
  exit /b 1
)
if not exist "%SRC%\T*_*.*" (
  echo [오류] 시험 영상이 없습니다: %SRC%
  echo 먼저 diag_make_videos.bat을 실행하세요.
  if "%~2"=="" pause
  exit /b 1
)
"%ADB%" shell mkdir -p %DEV%
for %%F in ("%SRC%\T*_*.mp4" "%SRC%\T*_*.mkv") do (
  echo [보내는 중] %%~nxF
  "%ADB%" push --sync "%%~fF" "%DEV%/%%~nxF" >nul
  if errorlevel 1 echo [실패] %%~nxF
)
echo.
"%ADB%" shell ls -l %DEV%
echo.
echo 끝. 다음 단계: diag_run.bat
if "%~2"=="" pause
exit /b 0

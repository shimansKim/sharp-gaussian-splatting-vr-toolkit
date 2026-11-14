@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem 한 번에: 시험 영상 만들기 -> Quest에 넣기 -> 진단 실행 -> 결과 가져오기.
rem   먼저 build.bat, install.bat으로 앱을 설치해 두세요. Quest를 USB로 연결하고 헤드셋을 쓰세요.
rem   사용: diag_all.bat [T07 T08 ...] [초] [x2] [nopause]   (순서 무관, 인수는 세 bat에 그대로 넘긴다)
rem     예: diag_all.bat T07 T08 180 x2   → T07·T08을 180초 영상으로 만들어 넣고, 쉬지 않고 두 번 잰다
set "NOPAUSE="
for %%A in (%*) do if /i "%%~A"=="nopause" set "NOPAUSE=1"
set "MAKEARGS="
for %%A in (%*) do call :notx "%%~A"
call "%~dp0diag_make_videos.bat" nopause %MAKEARGS%
if errorlevel 1 (
  echo [오류] 시험 영상을 다 만들지 못했습니다. 만들어진 것만으로 계속합니다.
)
call "%~dp0diag_push_videos.bat" nopause %MAKEARGS% || goto :end
call "%~dp0diag_run.bat" nopause %*
:end
if not defined NOPAUSE pause
exit /b 0

rem 만들기·넣기에는 xN(횟수)을 넘기지 않는다(폴더로 오해함).
:notx
set "X=%~1"
if "%X%"=="" exit /b 0
echo %X%| findstr /r /i /x "x[1-9]" >nul
if not errorlevel 1 exit /b 0
set "MAKEARGS=%MAKEARGS% "%X%""
exit /b 0

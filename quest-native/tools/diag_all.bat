@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem 한 번에: 시험 영상 만들기 -> Quest에 넣기 -> 진단 실행 -> 결과 가져오기.
rem   먼저 build.bat, install.bat으로 앱을 설치해 두세요. Quest를 USB로 연결하고 헤드셋을 쓰세요.
call "%~dp0diag_make_videos.bat" "" nopause
if errorlevel 1 (
  echo [오류] 시험 영상을 다 만들지 못했습니다. 만들어진 것만으로 계속합니다.
)
call "%~dp0diag_push_videos.bat" "" nopause || goto :end
call "%~dp0diag_run.bat" nopause
:end
pause

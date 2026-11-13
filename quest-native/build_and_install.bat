@echo off
chcp 65001 >nul
setlocal
title quest-native 빌드하고 헤드셋에 설치
rem build.bat과 install.bat을 차례로 실행한다. 설명: docs/install-guide.md
call "%~dp0build.bat" nopause
if errorlevel 1 (
  echo.
  echo  빌드가 실패해서 설치하지 않았습니다.
  pause
  exit /b 1
)
call "%~dp0install.bat"
exit /b %ERRORLEVEL%

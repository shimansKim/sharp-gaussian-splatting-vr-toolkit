@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo Drag an image file or image folder onto this BAT file.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\predict.ps1" -InputPath "%~1"
echo.
pause

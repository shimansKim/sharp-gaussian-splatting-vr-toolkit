@echo off
setlocal
cd /d "%~dp0"
call "%~dp0scripts\with_cuda_env.bat" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\predict.ps1" -Render
echo.
pause

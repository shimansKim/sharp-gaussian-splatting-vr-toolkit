@echo off
setlocal
cd /d "%~dp0..\"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\check_env.ps1"
echo.
pause

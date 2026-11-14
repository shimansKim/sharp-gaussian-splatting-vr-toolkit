@echo off
setlocal
cd /d "%~dp0..\"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\refresh_splat_manifest.ps1"
echo.
pause

@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
    call "%~dp0scripts\with_cuda_env.bat" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\render_ply.ps1"
) else (
    call "%~dp0scripts\with_cuda_env.bat" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\render_ply.ps1" -InputPath "%~1"
)

echo.
pause

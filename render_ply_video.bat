@echo off
setlocal
cd /d "%~dp0"

set "TRAJECTORY=%~2"
if "%TRAJECTORY%"=="" set "TRAJECTORY=rotate_forward"

set "DURATION_SECONDS=%~3"
if "%DURATION_SECONDS%"=="" set "DURATION_SECONDS=2"

call "%~dp0scripts\with_cuda_env.bat" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\render_ply.ps1" -InputPath "%~1" -RenderTrajectory "%TRAJECTORY%" -RenderDurationSeconds "%DURATION_SECONDS%"

echo.
pause

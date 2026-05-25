@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
    echo Drag a video file onto this BAT, or run:
    echo video_to_vr_pipeline.bat path\to\input.mp4 --max-frames 5
    echo.
    pause
    exit /b 1
)

set "INPUT_VIDEO=%~f1"

if not exist "%INPUT_VIDEO%" (
    echo Input video was not found:
    echo "%INPUT_VIDEO%"
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0.venv\Scripts\python.exe" (
    echo Python was not found:
    echo "%~dp0.venv\Scripts\python.exe"
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0scripts\video_to_vr_pipeline.py" (
    echo Pipeline script was not found:
    echo "%~dp0scripts\video_to_vr_pipeline.py"
    echo.
    pause
    exit /b 1
)

echo Project:
echo "%~dp0"
echo Input:
echo "%INPUT_VIDEO%"
echo.

call "%~dp0scripts\with_cuda_env.bat" "%~dp0.venv\Scripts\python.exe" "%~dp0scripts\video_to_vr_pipeline.py" -i "%INPUT_VIDEO%"

echo.
pause

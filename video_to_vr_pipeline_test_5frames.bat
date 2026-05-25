@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
    set "INPUT_VIDEO=%~dp0inputs\clip_34_36.mp4"
) else (
    set "INPUT_VIDEO=%~f1"
)

if not exist "%INPUT_VIDEO%" (
    echo Input video was not found:
    echo "%INPUT_VIDEO%"
    echo.
    pause
    exit /b 1
)

echo Running 5-frame VR pipeline test.
echo Input:
echo "%INPUT_VIDEO%"
echo.

call "%~dp0scripts\with_cuda_env.bat" "%~dp0.venv\Scripts\python.exe" "%~dp0scripts\video_to_vr_pipeline.py" -i "%INPUT_VIDEO%" --start-seconds 30 --max-frames 5

echo.
pause

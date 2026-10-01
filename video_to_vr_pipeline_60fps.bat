@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
    echo Drag a 60fps video file onto this BAT, or run:
    echo video_to_vr_pipeline_60fps.bat path\to\input.mp4 [pipeline options]
    echo.
    echo This runs the full video-to-VR pipeline at 60fps and accepts resume/parallel options.
    echo.
    pause
    exit /b 1
)

set "INPUT_VIDEO=%~f1"
shift
set "PIPELINE_ARGS="

:collect_pipeline_args
if "%~1"=="" goto run_pipeline
set "PIPELINE_ARGS=%PIPELINE_ARGS% "%~1""
shift
goto collect_pipeline_args

:run_pipeline

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
echo FPS:
echo 60
echo.

call "%~dp0scripts\with_cuda_env.bat" "%~dp0.venv\Scripts\python.exe" "%~dp0scripts\video_to_vr_pipeline.py" -i "%INPUT_VIDEO%" --fps 60 %PIPELINE_ARGS%

echo.
pause

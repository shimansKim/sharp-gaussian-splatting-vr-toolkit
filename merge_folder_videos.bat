@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" (
    echo Drag a folder containing SHARP color MP4 files onto this BAT file.
    echo.
    pause
    exit /b 1
)

set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

"%PYTHON%" "%~dp0scripts\concat_folder_videos.py" "%~1"
echo.
pause

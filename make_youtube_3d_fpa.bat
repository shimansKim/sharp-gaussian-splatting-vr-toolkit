@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="" (
    echo Drag a side-by-side 3D MP4 file onto this BAT, or run:
    echo make_youtube_3d_fpa.bat path\to\input_sbs.mp4
    echo.
    echo This creates a YouTube/Quest-friendly 3D file using:
    echo - H.264 frame-packing=3
    echo - SAR 1:2
    echo - DAR 16:9
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

set "FFMPEG=C:\Program Files\ffmpeg\bin\ffmpeg.exe"
if not exist "%FFMPEG%" (
    set "FFMPEG=ffmpeg"
)

set "INPUT_DIR=%~dp1"
set "INPUT_NAME=%~n1"
set "OUTPUT_VIDEO=%INPUT_DIR%%INPUT_NAME%_youtube3d_fpa_dar16x9.mp4"

if exist "%OUTPUT_VIDEO%" (
    set /a INDEX=2
    :find_output_name
    set "OUTPUT_VIDEO=%INPUT_DIR%%INPUT_NAME%_youtube3d_fpa_dar16x9_!INDEX!.mp4"
    if exist "!OUTPUT_VIDEO!" (
        set /a INDEX+=1
        goto find_output_name
    )
)

echo YouTube 3D FPA conversion
echo Input:
echo "%INPUT_VIDEO%"
echo.
echo Output:
echo "%OUTPUT_VIDEO%"
echo.

"%FFMPEG%" -y -i "%INPUT_VIDEO%" -map 0 -c:v libx264 -x264opts "frame-packing=3" -vf "setsar=1/2" -aspect 16:9 -crf 18 -pix_fmt yuv420p -c:a copy -movflags +faststart "%OUTPUT_VIDEO%"

if errorlevel 1 (
    echo.
    echo Conversion failed.
    echo Check whether ffmpeg is installed or whether the input video path is valid.
    echo.
    pause
    exit /b 1
)

echo.
echo Done.
echo "%OUTPUT_VIDEO%"
echo.
pause

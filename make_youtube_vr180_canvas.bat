@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="" (
    echo Drag a side-by-side 3D MP4 file onto this BAT, or run:
    echo make_youtube_vr180_canvas.bat path\to\input_sbs.mp4
    echo.
    echo This creates a YouTube VR180-style test file using:
    echo - 7680x4320 left-right canvas
    echo - per-eye 3840x2160 video centered vertically in 3840x4320
    echo - Spatial Media V2 left-right equirectangular metadata
    echo - VR180-like left/right projection bounds
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

set "PYTHON=%~dp0.venv\Scripts\python.exe"
set "SPATIALMEDIA=%~dp0tools\spatial-media\spatialmedia"

if not exist "%PYTHON%" (
    echo Python was not found:
    echo "%PYTHON%"
    echo.
    pause
    exit /b 1
)

if not exist "%SPATIALMEDIA%" (
    echo Spatial Media tool was not found:
    echo "%SPATIALMEDIA%"
    echo.
    pause
    exit /b 1
)

set "INPUT_DIR=%~dp1"
set "INPUT_NAME=%~n1"
set "TEMP_VIDEO=%INPUT_DIR%%INPUT_NAME%_vr180_8k_canvas_preinject.mp4"
set "OUTPUT_VIDEO=%INPUT_DIR%%INPUT_NAME%_youtube_vr180_8k_canvas_lr.mp4"

if exist "%TEMP_VIDEO%" (
    set /a INDEX=2
    :find_temp_name
    set "TEMP_VIDEO=%INPUT_DIR%%INPUT_NAME%_vr180_8k_canvas_preinject_!INDEX!.mp4"
    if exist "!TEMP_VIDEO!" (
        set /a INDEX+=1
        goto find_temp_name
    )
)

if exist "%OUTPUT_VIDEO%" (
    set /a INDEX=2
    :find_output_name
    set "OUTPUT_VIDEO=%INPUT_DIR%%INPUT_NAME%_youtube_vr180_8k_canvas_lr_!INDEX!.mp4"
    if exist "!OUTPUT_VIDEO!" (
        set /a INDEX+=1
        goto find_output_name
    )
)

echo YouTube VR180-style canvas conversion
echo Input:
echo "%INPUT_VIDEO%"
echo.
echo Temporary:
echo "%TEMP_VIDEO%"
echo.
echo Output:
echo "%OUTPUT_VIDEO%"
echo.

set "FILTER=[0:v]crop=3840:2160:0:0,pad=3840:4320:0:1080:black[left];[0:v]crop=3840:2160:3840:0,pad=3840:4320:0:1080:black[right];[left][right]hstack=inputs=2[v]"

"%FFMPEG%" -y -i "%INPUT_VIDEO%" -filter_complex "%FILTER%" -map "[v]" -map "0:a?" -c:v libx264 -pix_fmt yuv420p -crf 18 -c:a copy -movflags +faststart "%TEMP_VIDEO%"

if errorlevel 1 (
    echo.
    echo Canvas conversion failed.
    echo.
    pause
    exit /b 1
)

"%PYTHON%" "%SPATIALMEDIA%" -i -2 -s left-right -p equirectangular -b "0:0:1073741824:1073741824" "%TEMP_VIDEO%" "%OUTPUT_VIDEO%"

if errorlevel 1 (
    echo.
    echo Metadata injection failed.
    echo Temporary file was kept:
    echo "%TEMP_VIDEO%"
    echo.
    pause
    exit /b 1
)

echo.
echo Done.
echo "%OUTPUT_VIDEO%"
echo.
echo Temporary canvas file was kept:
echo "%TEMP_VIDEO%"
echo.
pause

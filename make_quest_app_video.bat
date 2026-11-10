@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="" (
    echo Drag one or more video files onto this BAT, or run:
    echo make_quest_app_video.bat path\to\video.mp4 [more files...]
    echo.
    echo Re-encodes videos so the Quest 3 app can play them smoothly:
    echo - HEVC ^(H.265^) video, hvc1 tag, faststart
    echo - at most 8192x4096 ^(Quest 3 hardware decoder limit; H.264 stops at 4K^)
    echo - audio is copied when possible, otherwise AAC 192k
    echo Output: ^<name^>_quest_hevc.mp4 next to the input file ^(input is never modified^).
    echo.
    pause
    exit /b 1
)

set "FFMPEG=C:\Program Files\ffmpeg\bin\ffmpeg.exe"
if not exist "%FFMPEG%" (
    set "FFMPEG=ffmpeg"
)

set "SCALE=scale='min(8192,iw)':'min(4096,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
set "FAILED=0"

:next_file
if "%~1"=="" goto done

set "INPUT_VIDEO=%~f1"
if not exist "%INPUT_VIDEO%" (
    echo Input video was not found: "%INPUT_VIDEO%"
    set /a FAILED+=1
    shift
    goto next_file
)

set "OUTPUT_VIDEO=%~dp1%~n1_quest_hevc.mp4"
if exist "%OUTPUT_VIDEO%" (
    set /a INDEX=2
    :find_output_name
    set "OUTPUT_VIDEO=%~dp1%~n1_quest_hevc_!INDEX!.mp4"
    if exist "!OUTPUT_VIDEO!" (
        set /a INDEX+=1
        goto find_output_name
    )
)

echo.
echo === %~nx1
echo Encoding with hevc_nvenc ^(GPU^)...
"%FFMPEG%" -hide_banner -loglevel warning -stats -y -i "%INPUT_VIDEO%" -map 0:v:0 -map 0:a:0? -vf "%SCALE%" -c:v hevc_nvenc -preset p5 -rc vbr -cq 24 -b:v 0 -maxrate 80M -bufsize 160M -pix_fmt yuv420p -tag:v hvc1 -c:a copy -movflags +faststart "!OUTPUT_VIDEO!"
if errorlevel 1 (
    echo GPU encode failed. Retrying with libx265 ^(CPU, slower^)...
    "%FFMPEG%" -hide_banner -loglevel warning -stats -y -i "%INPUT_VIDEO%" -map 0:v:0 -map 0:a:0? -vf "%SCALE%" -c:v libx265 -preset medium -crf 24 -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 192k -movflags +faststart "!OUTPUT_VIDEO!"
    if errorlevel 1 (
        echo Encoding failed: "%INPUT_VIDEO%"
        set /a FAILED+=1
        shift
        goto next_file
    )
)
echo Done: "!OUTPUT_VIDEO!"
shift
goto next_file

:done
echo.
if not "%FAILED%"=="0" (
    echo %FAILED% file^(s^) failed.
    pause
    exit /b 1
)
echo All files were converted. Copy the *_quest_hevc.mp4 files to the Quest or the PC folder.
pause
exit /b 0

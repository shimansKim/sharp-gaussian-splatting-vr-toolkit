@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem Quest 디코더 진단용 시험 영상 T01~T18을 만든다(encoding-guide.md 3장).
rem   사용: diag_make_videos.bat [출력 폴더]   기본 출력: %LOCALAPPDATA%\sharp-quest-native\diag-videos
rem   이미 있는 파일은 건너뛴다. 18개 모두 약 2.7GB, 이 PC(RTX 4080)에서 20분 안팎.
rem   ffmpeg는 각자 설치한 것을 부르기만 한다(앱에 들어가지 않음). NVIDIA 그래픽카드(NVENC)가 필요하다.

set "OUT=%~1"
if "%OUT%"=="" set "OUT=%LOCALAPPDATA%\sharp-quest-native\diag-videos"
set "FF=ffmpeg"
where ffmpeg >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\ffmpeg\bin\ffmpeg.exe" (
    set "FF=%ProgramFiles%\ffmpeg\bin\ffmpeg.exe"
  ) else (
    echo [오류] ffmpeg를 찾지 못했습니다. ffmpeg를 설치하고 PATH에 넣어 주세요.
    if "%~2"=="" pause
    exit /b 1
  )
)
if not exist "%OUT%" mkdir "%OUT%"
echo 출력 폴더: %OUT%
echo.

set "N=noise=alls=12:allf=t+u"
rem QN_DIAG_SECONDS: 길이(초) 바꾸기, 빠른 시험용. 진단 판정은 20초 기준이다.
set "DUR=20"
if defined QN_DIAG_SECONDS set "DUR=%QN_DIAG_SECONDS%"
set "A=-f lavfi -i sine=frequency=440:sample_rate=48000 -t %DUR%"
set "AAC=-c:a aac -b:a 192k -movflags +faststart"
set FAILED=0

set "C=-c:v h264_nvenc -preset p4 -profile:v high -rc cbr -b:v 10M -maxrate 10M -bufsize 20M %AAC%"
call :make T01_h264_1920x1080_30_10M.mp4 "testsrc2=s=1920x1080:r=30,%N%,format=yuv420p"
set "C=-c:v h264_nvenc -preset p4 -profile:v high -rc cbr -b:v 40M -maxrate 40M -bufsize 80M %AAC%"
call :make T02_h264_3840x2160_60_40M.mp4 "testsrc2=s=3840x2160:r=60,%N%,format=yuv420p"
set "C=-c:v h264_nvenc -preset p4 -profile:v high -rc cbr -b:v 50M -maxrate 50M -bufsize 100M %AAC%"
call :make T03_h264_4096x2048_60_50M.mp4 "testsrc2=s=4096x2048:r=60,%N%,format=yuv420p"
rem NVENC는 가로 4096을 넘는 H.264를 못 만들어 CPU(libx264)를 쓴다.
set "C=-c:v libx264 -preset veryfast -profile:v high -level 6.1 -b:v 60M -maxrate 60M -bufsize 120M %AAC%"
call :make T04_h264_5760x2880_30_60M.mp4 "testsrc2=s=5760x2880:r=30,%N%,format=yuv420p"
set "C=-c:v hevc_nvenc -preset p4 -rc cbr -b:v 30M -maxrate 30M -bufsize 60M -tag:v hvc1 %AAC%"
call :make T05_hevc_3840x2160_60_30M.mp4 "testsrc2=s=3840x2160:r=60,%N%,format=yuv420p"
set "C=-c:v hevc_nvenc -preset p4 -rc cbr -b:v 50M -maxrate 50M -bufsize 100M -tag:v hvc1 %AAC%"
call :make T06_hevc_5760x2880_60_50M.mp4 "testsrc2=s=5760x2880:r=60,%N%,format=yuv420p"
set "C=-c:v hevc_nvenc -preset p4 -rc cbr -b:v 80M -maxrate 80M -bufsize 160M -tag:v hvc1 %AAC%"
call :make T07_hevc_7680x3840_60_80M.mp4 "testsrc2=s=7680x3840:r=60,%N%,format=yuv420p"
set "C=-c:v hevc_nvenc -preset p4 -rc cbr -b:v 100M -maxrate 100M -bufsize 200M -tag:v hvc1 %AAC%"
call :make T08_hevc_8192x4096_60_100M.mp4 "testsrc2=s=8192x4096:r=60,%N%,format=yuv420p"
call :make T09_hevc_5760x5760_60_100M.mp4 "testsrc2=s=5760x5760:r=60,%N%,format=yuv420p"
set "C=-c:v hevc_nvenc -preset p4 -profile:v main10 -rc cbr -b:v 100M -maxrate 100M -bufsize 200M -tag:v hvc1 %AAC%"
call :make T10_hevc10_8192x4096_60_100M.mp4 "testsrc2=s=8192x4096:r=60,%N%,format=p010le"
set "C=-c:v hevc_nvenc -preset p4 -rc cbr -b:v 150M -maxrate 150M -bufsize 300M -tag:v hvc1 %AAC%"
call :make T11_hevc_8192x4096_60_150M.mp4 "testsrc2=s=8192x4096:r=60,%N%,format=yuv420p"
set "C=-c:v hevc_nvenc -preset p4 -rc cbr -b:v 50M -maxrate 50M -bufsize 100M -tag:v hvc1 %AAC%"
call :make T12_hevc_3840x2160_120_50M.mp4 "testsrc2=s=3840x2160:r=120,%N%,format=yuv420p"
set "C=-c:v av1_nvenc -preset p4 -rc cbr -b:v 60M -maxrate 60M -bufsize 120M %AAC%"
call :make T13_av1_8192x4096_60_60M.mp4 "testsrc2=s=8192x4096:r=60,%N%,format=yuv420p"
set "C=-c:v av1_nvenc -preset p4 -rc cbr -b:v 40M -maxrate 40M -bufsize 80M %AAC%"
call :make T14_av1-10_5760x2880_60_40M.mp4 "testsrc2=s=5760x2880:r=60,%N%,format=p010le"
set "C=-c:v hevc_nvenc -preset p4 -rc cbr -b:v 30M -maxrate 30M -bufsize 60M -c:a libopus -b:a 160k"
call :make T15_hevc_3840x1920_30_30M_opus.mkv "testsrc2=s=3840x1920:r=30,%N%,format=yuv420p"
rem 추가 항목: HDR10(PQ, BT.2020 표시), 돌비 AC-3·E-AC-3 5.1 소리.
set "C=-c:v hevc_nvenc -preset p4 -profile:v main10 -rc cbr -b:v 40M -maxrate 40M -bufsize 80M -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc -color_range tv -tag:v hvc1 %AAC%"
call :make T16_hevc10-hdr10_3840x2160_60_40M.mp4 "testsrc2=s=3840x2160:r=60,%N%,format=p010le"
set "C=-c:v h264_nvenc -preset p4 -profile:v high -rc cbr -b:v 10M -maxrate 10M -bufsize 20M -c:a ac3 -ac 6 -b:a 448k -movflags +faststart"
call :make T17_h264_1920x1080_30_10M_ac3.mp4 "testsrc2=s=1920x1080:r=30,%N%,format=yuv420p"
set "C=-c:v h264_nvenc -preset p4 -profile:v high -rc cbr -b:v 10M -maxrate 10M -bufsize 20M -c:a eac3 -ac 6 -b:a 640k -movflags +faststart"
call :make T18_h264_1920x1080_30_10M_eac3.mp4 "testsrc2=s=1920x1080:r=30,%N%,format=yuv420p"

echo.
if "%FAILED%"=="0" (echo 끝. 다음 단계: diag_push_videos.bat) else (echo 끝. 실패 %FAILED%개. 위 오류를 보세요.)
if "%~2"=="" pause
exit /b %FAILED%

:make
if exist "%OUT%\%~1" (
  echo [있음] %~1
  exit /b 0
)
echo [만드는 중] %~1
"%FF%" -hide_banner -loglevel error -stats -f lavfi -i "%~2" %A% %C% -y "%OUT%\%~1"
if errorlevel 1 (
  echo [실패] %~1
  if exist "%OUT%\%~1" del "%OUT%\%~1"
  set /a FAILED+=1
)
exit /b 0

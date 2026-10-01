@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PYTHON=%~dp0.venv\Scripts\python.exe"
set "PIPELINE_PY=%~dp0scripts\sharp_pipeline.py"
set "WITH_CUDA=%~dp0scripts\with_cuda_env.bat"

if exist "%WITH_CUDA%" (
    call "%WITH_CUDA%" >nul 2>&1
)

if not exist "%PYTHON%" (
    echo [ERROR] Python environment was not found: "%PYTHON%"
    echo Please run 'run_setup_environment.bat' first.
    echo.
    pause
    exit /b 1
)

:: ---------------------------------------------------------
:: 1. Drag and Drop Mode
:: ---------------------------------------------------------
if not "%~1"=="" (
    set "TARGET_PATH=%~f1"
    echo ======================================================
    echo   SHARP Gaussian Splatting VR - Quick Launcher
    echo ======================================================
    echo Target: "!TARGET_PATH!"
    echo.
    echo Select an action:
    echo  [1] Auto Process (Recommended)
    echo  [2] 3D PLY Only (Batch size: 1000)
    echo  [3] 3D SBS Stereo Video (30 fps, 4.0s)
    echo  [4] 3D SBS Stereo Video (60 fps, 4.0s)
    echo  [5] Full Video to VR 3D Pipeline (Resume, 1 Worker, Batch: 1000)
    echo  [6] Full Video to VR 3D Pipeline (Fast: 2 Workers, Clean PLY)
    echo  [7] Convert SBS MP4 to YouTube 3D (FPA)
    echo  [8] Convert SBS MP4 to YouTube VR180 (8K Canvas)
    echo  [9] Export for Netgear Meural Canvas II (1080p 30fps H.264)
    echo  [10] Optimize/Resize SBS for Meta Quest 3 (Max 8K 8192x4320)
    echo.
    set /p "DRAG_CHOICE=Enter choice (1-10, Default: 1): "
    if "!DRAG_CHOICE!"=="" set "DRAG_CHOICE=1"

    if "!DRAG_CHOICE!"=="1" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode auto
    ) else if "!DRAG_CHOICE!"=="2" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode ply_only --ply-batch-size 1000
    ) else if "!DRAG_CHOICE!"=="3" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode video_stereo --fps 30 --duration 4.0
    ) else if "!DRAG_CHOICE!"=="4" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode video_stereo --fps 60 --duration 4.0
    ) else if "!DRAG_CHOICE!"=="5" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode video_vr --resume --render-workers 1 --ply-batch-size 1000
    ) else if "!DRAG_CHOICE!"=="6" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode video_vr --resume --render-workers 2 --ply-batch-size 1000 --clean-ply
    ) else if "!DRAG_CHOICE!"=="7" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode youtube_3d --yt-format fpa
    ) else if "!DRAG_CHOICE!"=="8" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode youtube_3d --yt-format vr180
    ) else if "!DRAG_CHOICE!"=="9" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --preset meural
    ) else if "!DRAG_CHOICE!"=="10" (
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode optimize_quest3
    ) else (
        echo Invalid choice. Running Auto mode...
        "%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_PATH!" --mode auto
    )

    echo.
    echo Execution finished.
    pause
    exit /b 0
)

:: ---------------------------------------------------------
:: 2. Interactive Menu Mode (Double Click)
:: ---------------------------------------------------------
:MENU
cls
echo ================================================================
echo      SHARP Gaussian Splatting VR Master Pipeline
echo ================================================================
echo  [1] inputs/ 이미지들 ➡️ 3D PLY 생성 (배치 크기 설정 지원)
echo  [2] inputs/ 이미지들 ➡️ 3D SBS 스테레오 영상 (궤적 렌더링)
echo  [3] PLY 파일/폴더 ➡️ SBS 스테레오 영상 렌더링 (병렬 워커 지원)
echo  [4] 비디오 ➡️ VR 3D SBS 전체 파이프라인 (워커/배치/디스크절약 설정)
echo  [5] 기존 SBS 영상 ➡️ YouTube 3D 메타데이터 주입 (FPA / VR180)
echo  [6] 넷기어 뮤럴 캔버스 II (27인치) 전용 프리셋 (1080p 30fps H.264)
echo  [7] 상세 옵션 직접 지정 실행 (FPS, 궤적, 시간, 워커, 배치 등)
echo  [8] 기존 SBS 영상 ➡️ 메타 퀘스트 3 규격 최적화 (최대 8K: 8192x4320)
echo  [9] 환경 진단 (check_env)
echo  [0] 종료
echo ================================================================
set /p "MENU_CHOICE=선택 번호를 입력하세요 (0-9): "

if "%MENU_CHOICE%"=="0" exit /b 0

if "%MENU_CHOICE%"=="1" (
    echo.
    echo [실행] inputs 폴더의 이미지들을 PLY로 변환합니다.
    set /p "USER_BATCH=PLY 생성 배치 크기 (기본값: 1000): "
    if "!USER_BATCH!"=="" set "USER_BATCH=1000"
    "%PYTHON%" "%PIPELINE_PY%" -i "%~dp0inputs" --mode ply_only --ply-batch-size !USER_BATCH!
    goto END_PAUSE
)

if "%MENU_CHOICE%"=="2" (
    echo.
    echo [실행] inputs 폴더 이미지 ➡️ 3D SBS 스테레오 영상 렌더링
    "%PYTHON%" "%PIPELINE_PY%" -i "%~dp0inputs" --mode video_stereo --fps 30 --duration 4.0 --trajectory rotate_forward
    goto END_PAUSE
)

if "%MENU_CHOICE%"=="3" (
    echo.
    set /p "USER_PLY_INPUT=PLY 파일 또는 폴더 경로를 입력하세요: "
    if "!USER_PLY_INPUT!"=="" (
        echo 경로가 입력되지 않았습니다.
        goto END_PAUSE
    )
    set /p "USER_DUR=PLY당 렌더링 시간(초) (기본값: 4.0): "
    if "!USER_DUR!"=="" set "USER_DUR=4.0"
    set /p "USER_FPS=FPS 설정 (30 또는 60, 기본값: 30): "
    if "!USER_FPS!"=="" set "USER_FPS=30"
    set /p "USER_WORKERS=동시 렌더 워커 수 (기본값: 1): "
    if "!USER_WORKERS!"=="" set "USER_WORKERS=1"

    "%PYTHON%" "%PIPELINE_PY%" -i "!USER_PLY_INPUT!" --mode video_stereo --fps !USER_FPS! --duration !USER_DUR! --render-workers !USER_WORKERS!
    goto END_PAUSE
)

if "%MENU_CHOICE%"=="4" (
    echo.
    set /p "USER_VID_INPUT=비디오 파일 경로를 입력하세요: "
    if "!USER_VID_INPUT!"=="" (
        echo 비디오 경로가 입력되지 않았습니다.
        goto END_PAUSE
    )
    set /p "USER_FPS=FPS 설정 (기본값: 30): "
    if "!USER_FPS!"=="" set "USER_FPS=30"
    set /p "USER_WORKERS=동시 SBS 렌더 워커 수 (기본값: 1): "
    if "!USER_WORKERS!"=="" set "USER_WORKERS=1"
    set /p "USER_BATCH=PLY 생성 배치 크기 (기본값: 1000): "
    if "!USER_BATCH!"=="" set "USER_BATCH=1000"
    set /p "USER_CLEAN=렌더 완료된 PLY 자동 삭제하여 디스크 절약? (Y/N, 기본: N): "
    set "CLEAN_ARG="
    if /i "!USER_CLEAN!"=="Y" set "CLEAN_ARG=--clean-ply"
    set /p "USER_RESUME=이어하기(Resume) 활성화? (Y/N, 기본: Y): "
    set "RESUME_ARG=--resume"
    if /i "!USER_RESUME!"=="N" set "RESUME_ARG="

    "%PYTHON%" "%PIPELINE_PY%" -i "!USER_VID_INPUT!" --mode video_vr --fps !USER_FPS! --render-workers !USER_WORKERS! --ply-batch-size !USER_BATCH! !CLEAN_ARG! !RESUME_ARG!
    goto END_PAUSE
)

if "%MENU_CHOICE%"=="5" (
    echo.
    set /p "USER_SBS_VID=SBS 3D 영상 경로를 입력하세요: "
    if "!USER_SBS_VID!"=="" (
        echo 경로가 입력되지 않았습니다.
        goto END_PAUSE
    )
    echo 포맷 선택:
    echo  [1] YouTube 3D FPA (Frame Packing - 추천)
    echo  [2] YouTube VR180 (8K Canvas)
    set /p "YT_CHOICE=선택 (1 또는 2, 기본값: 1): "
    set "YT_FMT=fpa"
    if "!YT_CHOICE!"=="2" set "YT_FMT=vr180"

    "%PYTHON%" "%PIPELINE_PY%" -i "!USER_SBS_VID!" --mode youtube_3d --yt-format !YT_FMT!
    goto END_PAUSE
)

if "%MENU_CHOICE%"=="6" (
    echo.
    echo ================================================================
    echo   넷기어 뮤럴 캔버스 II (27인치 MC327) 프리셋
    echo   - 규격: 1920x1080 FHD / 30fps / H.264 High@L4.1 / 12Mbps / 무음
    echo ================================================================
    set /p "MEURAL_IN=입력 대상 경로 (영상, 이미지, PLY 파일 또는 폴더): "
    if "!MEURAL_IN!"=="" (
        echo 경로가 입력되지 않았습니다.
        goto END_PAUSE
    )
    set /p "MEURAL_OUT=내보낼 출력 폴더 (비워두면 기본 outputs 폴더): "
    set "OUT_ARG="
    if not "!MEURAL_OUT!"=="" set "OUT_ARG=-o "!MEURAL_OUT!""
    set /p "MEURAL_DUR=재생/루프 시간(초) (기본값: 15.0): "
    if "!MEURAL_DUR!"=="" set "MEURAL_DUR=15.0"
    set /p "MEURAL_TRAJ=카메라 궤적 (기본값: rotate_forward): "
    if "!MEURAL_TRAJ!"=="" set "MEURAL_TRAJ=rotate_forward"

    "%PYTHON%" "%PIPELINE_PY%" -i "!MEURAL_IN!" !OUT_ARG! --preset meural --duration !MEURAL_DUR! --trajectory !MEURAL_TRAJ!
    goto END_PAUSE
)

if "%MENU_CHOICE%"=="7" (
    echo.
    set /p "CUSTOM_IN=입력 경로 (파일/폴더): "
    set /p "CUSTOM_OUT=내보낼 출력 폴더 (비워두면 기본 outputs 폴더): "
    set "CUSTOM_OUT_ARG="
    if not "!CUSTOM_OUT!"=="" set "CUSTOM_OUT_ARG=-o "!CUSTOM_OUT!""
    set /p "CUSTOM_MODE=모드 (auto/ply_only/video_mono/video_stereo/video_vr/youtube_3d/meural, 기본: auto): "
    if "!CUSTOM_MODE!"=="" set "CUSTOM_MODE=auto"
    set /p "CUSTOM_PRESET=프리셋 (default/meural, 기본: default): "
    if "!CUSTOM_PRESET!"=="" set "CUSTOM_PRESET=default"
    set /p "CUSTOM_FPS=FPS (기본: 30): "
    if "!CUSTOM_FPS!"=="" set "CUSTOM_FPS=30"
    set /p "CUSTOM_WORKERS=동시 SBS 렌더 워커 수 (기본: 1): "
    if "!CUSTOM_WORKERS!"=="" set "CUSTOM_WORKERS=1"
    set /p "CUSTOM_BATCH=PLY 생성 배치 크기 (기본: 1000): "
    if "!CUSTOM_BATCH!"=="" set "CUSTOM_BATCH=1000"
    set /p "CUSTOM_TRAJ=카메라 궤적 (rotate_forward/rotate/swipe/shake/static, 기본: rotate_forward): "
    if "!CUSTOM_TRAJ!"=="" set "CUSTOM_TRAJ=rotate_forward"
    set /p "CUSTOM_DUR=시간(초) (기본: 4.0): "
    if "!CUSTOM_DUR!"=="" set "CUSTOM_DUR=4.0"
    set /p "CUSTOM_IPD=양안 간격 IPD (기본: 0.064): "
    if "!CUSTOM_IPD!"=="" set "CUSTOM_IPD=0.064"
    set /p "CUSTOM_YT=YouTube 3D 포맷 (none/fpa/vr180, 기본: none): "
    if "!CUSTOM_YT!"=="" set "CUSTOM_YT=none"
    set /p "CUSTOM_DEPTH=Depth(깊이 맵) 비디오도 함께 생성? (Y/N, 기본: N): "
    set "DEPTH_ARG="
    if /i "!CUSTOM_DEPTH!"=="Y" set "DEPTH_ARG=--render-depth"

    "%PYTHON%" "%PIPELINE_PY%" -i "!CUSTOM_IN!" !CUSTOM_OUT_ARG! --mode !CUSTOM_MODE! --preset !CUSTOM_PRESET! --fps !CUSTOM_FPS! --render-workers !CUSTOM_WORKERS! --ply-batch-size !CUSTOM_BATCH! --trajectory !CUSTOM_TRAJ! --duration !CUSTOM_DUR! --ipd !CUSTOM_IPD! --yt-format !CUSTOM_YT! !DEPTH_ARG! --resume
    goto END_PAUSE
)

if "%MENU_CHOICE%"=="8" (
    echo.
    echo ================================================================
    echo   메타 퀘스트 3 (4XVR/4XLink) SBS 영상 최적화 ^& 리사이즈
    echo   최대 해상도 규격: 8K (8192x4320) 이하 종횡비 유지 변환
    echo ================================================================
    set /p "QUEST3_IN=최적화할 비디오 파일 경로를 입력하세요: "
    set "QUEST3_IN=!QUEST3_IN:"=!"
    if "!QUEST3_IN!"=="" (
        echo 파일 경로가 입력되지 않았습니다.
        goto END_PAUSE
    )
    if not exist "!QUEST3_IN!" (
        echo 비디오 파일을 찾을 수 없습니다: "!QUEST3_IN!"
        goto END_PAUSE
    )
    "%PYTHON%" "%PIPELINE_PY%" -i "!QUEST3_IN!" --mode optimize_quest3
    goto END_PAUSE
)

if "%MENU_CHOICE%"=="9" (
    call "%~dp0check_env.bat"
    goto END_PAUSE
)

:END_PAUSE
echo.
pause
goto MENU

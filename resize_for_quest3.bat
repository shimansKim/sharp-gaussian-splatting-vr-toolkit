@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ================================================================
echo   Meta Quest 3 (4XVR/4XLink) SBS Video Optimizer ^& Resizer
echo   최대 해상도 규격: 8K (8192x4320) 이하 종횡비 유지 변환
echo ================================================================
echo.

set "PYTHON=%~dp0.venv\Scripts\python.exe"
set "PIPELINE_PY=%~dp0scripts\sharp_pipeline.py"
set "WITH_CUDA=%~dp0scripts\with_cuda_env.bat"

if exist "%WITH_CUDA%" (
    call "%WITH_CUDA%" >nul 2>&1
)

if not exist "%PYTHON%" (
    echo [ERROR] Python 가상환경을 찾을 수 없습니다: "%PYTHON%"
    echo 'run_setup_environment.bat'를 먼저 실행해 주세요.
    echo.
    pause
    exit /b 1
)

if not "%~1"=="" (
    set "TARGET_VIDEO=%~f1"
    goto RUN_OPTIMIZE
)

echo 변환할 비디오 파일을 이 창에 드래그하거나 경로를 입력하세요.
set /p "TARGET_VIDEO=비디오 파일 경로: "
set "TARGET_VIDEO=!TARGET_VIDEO:"=!"

if "!TARGET_VIDEO!"=="" (
    echo [ERROR] 입력 파일이 지정되지 않았습니다.
    pause
    exit /b 1
)

:RUN_OPTIMIZE
if not exist "!TARGET_VIDEO!" (
    echo [ERROR] 비디오 파일을 찾을 수 없습니다: "!TARGET_VIDEO!"
    echo.
    pause
    exit /b 1
)

echo.
echo 대상 파일: "!TARGET_VIDEO!"
echo 메타 퀘스트 3 최적화 변환을 시작합니다...
echo.

"%PYTHON%" "%PIPELINE_PY%" -i "!TARGET_VIDEO!" --mode optimize_quest3

if errorlevel 1 (
    echo.
    echo [FAIL] 변환 중 오류가 발생했습니다.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo [완료] 메타 퀘스트 3 최적화 영상 생성이 완료되었습니다.
echo 4XVR 또는 4XLink를 통해 퀘스트 3에서 부드럽게 감상하실 수 있습니다.
echo ================================================================
echo.
pause

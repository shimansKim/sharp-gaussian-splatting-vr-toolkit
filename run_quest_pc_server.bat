@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
cd /d "%~dp0"
title SHARP Quest PC Server

rem Python: project venv first, then the main checkout venv, then system Python.
set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=%~dp0..\..\06_SHARP_GaussianSplatting\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

"%PYTHON%" -c "import sys" >nul 2>nul
if errorlevel 1 (
    echo Python을 찾지 못했습니다. bat\run_setup_environment.bat로 환경을 먼저 만드세요.
    pause
    exit /b 1
)

rem zeroconf lets the Quest find this PC as sharp-vr.local. Optional: the server still runs without it.
"%PYTHON%" -c "import zeroconf" >nul 2>nul
if errorlevel 1 (
    echo zeroconf 패키지를 설치합니다. 처음 한 번만 걸립니다...
    uv pip install --python "%PYTHON%" zeroconf >nul 2>nul
    "%PYTHON%" -c "import zeroconf" >nul 2>nul
    if errorlevel 1 "%PYTHON%" -m pip install --quiet zeroconf >nul 2>nul
    "%PYTHON%" -c "import zeroconf" >nul 2>nul
    if errorlevel 1 echo zeroconf 설치에 실패했습니다. sharp-vr.local 이름 없이 계속합니다.
)

"%PYTHON%" "%~dp0scripts\quest_media_server.py" %*

echo.
pause

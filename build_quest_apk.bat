@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
cd /d "%~dp0"
title SHARP Quest APK 빌드

rem Python: project venv first, then the main checkout venv, then system Python.
set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=%~dp0..\..\06_SHARP_GaussianSplatting\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

"%PYTHON%" -c "import sys" >nul 2>nul
if errorlevel 1 (
    echo Python을 찾지 못했습니다. run_setup_environment.bat로 환경을 먼저 만드세요.
    pause
    exit /b 1
)

"%PYTHON%" "%~dp0scripts\quest_apk_tool.py" build %*

echo.
pause

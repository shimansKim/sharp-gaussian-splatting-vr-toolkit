@echo off
setlocal
cd /d "%~dp0"

echo SHARP Gaussian Splatting Lab - Environment Setup
echo.
echo This setup checks the Windows tools, prepares .venv, installs SHARP dependencies,
echo updates submodules, applies the local SHARP stereo patch, and installs WebXR packages.
echo.
echo Some system installs may require administrator approval or a terminal restart.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup_environment.ps1"

echo.
pause

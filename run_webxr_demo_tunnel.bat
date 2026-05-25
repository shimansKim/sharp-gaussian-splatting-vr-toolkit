@echo off
setlocal
cd /d "%~dp0"

echo Refreshing splat list...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\refresh_splat_manifest.ps1"
if errorlevel 1 (
    echo.
    echo Failed to refresh splat list.
    pause
    exit /b 1
)

echo Stopping existing dev server on port 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_webxr_tunnel.ps1"
pause

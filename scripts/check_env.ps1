$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$Sharp = Join-Path $ProjectRoot ".venv\Scripts\sharp.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python venv not found: $Python"
}

if (-not (Test-Path -LiteralPath $Sharp)) {
    throw "SHARP CLI not found: $Sharp"
}

Write-Host "Project: $ProjectRoot"
Write-Host ""

& $Python -c "import sys, torch; print('python', sys.version); print('torch', torch.__version__); print('cuda available', torch.cuda.is_available()); print('cuda version', torch.version.cuda); print('device', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only')"
Write-Host ""
& $Sharp --help


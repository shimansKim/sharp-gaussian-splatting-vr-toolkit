param(
    [string]$InputPath,
    [string]$OutputPath,
    [ValidateSet("rotate_forward", "rotate", "swipe", "shake")]
    [string]$RenderTrajectory = "rotate_forward",
    [ValidateRange(0.1, 120.0)]
    [double]$RenderDurationSeconds = 2.0
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Sharp = Join-Path $ProjectRoot ".venv\Scripts\sharp.exe"

if (-not (Test-Path -LiteralPath $Sharp)) {
    throw "SHARP CLI not found: $Sharp"
}

if (-not $InputPath) {
    $latestPly = Get-ChildItem -Path (Join-Path $ProjectRoot "outputs") -Recurse -Filter *.ply |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $latestPly) {
        throw "No .ply files found under outputs."
    }

    $InputPath = $latestPly.FullName
}

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Input .ply not found: $InputPath"
}

if (-not $OutputPath) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputPath = Join-Path $ProjectRoot "outputs\render_$stamp"
}

New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null

Write-Host "Rendering SHARP video..."
Write-Host "Input:  $InputPath"
Write-Host "Output: $OutputPath"
Write-Host "Trajectory: $RenderTrajectory"
Write-Host "Length: $RenderDurationSeconds seconds per PLY"
Write-Host ""

& $Sharp render -i $InputPath -o $OutputPath --trajectory $RenderTrajectory --duration-seconds $RenderDurationSeconds --fps 30

Write-Host ""
Write-Host "Done. Output folder:"
Write-Host $OutputPath

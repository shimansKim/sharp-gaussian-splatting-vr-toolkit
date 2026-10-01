param(
    [string]$InputPath,
    [string]$OutputPath,
    [switch]$Render,
    [string]$CheckpointPath,
    [ValidateSet("rotate_forward", "rotate", "swipe", "shake")]
    [string]$RenderTrajectory = "rotate_forward",
    [ValidateRange(0.1, 120.0)]
    [double]$RenderDurationSeconds = 2.0
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Sharp = Join-Path $ProjectRoot ".venv\Scripts\sharp.exe"

if (-not $InputPath) {
    $InputPath = Join-Path $ProjectRoot "inputs"
}

if (-not $OutputPath) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputPath = Join-Path $ProjectRoot "outputs\$stamp"
}

if (-not (Test-Path -LiteralPath $Sharp)) {
    throw "SHARP CLI not found: $Sharp"
}

if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Input path not found: $InputPath"
}

if ($Render -and -not (Get-Command nvcc -ErrorAction SilentlyContinue)) {
    Write-Warning "Render requested, but CUDA Toolkit nvcc was not found in PATH."
    Write-Warning "SHARP .ply generation will continue without video rendering."
    Write-Warning "Install NVIDIA CUDA Toolkit and make nvcc available to enable .mp4 rendering."
    $Render = $false
}

New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null

$argsList = @(
    "predict",
    "-i", $InputPath,
    "-o", $OutputPath,
    "--device", "cuda"
)

if ($Render) {
    $argsList += @(
        "--render",
        "--render-trajectory", $RenderTrajectory,
        "--render-duration-seconds", $RenderDurationSeconds,
        "--render-fps", 30
    )
}

if ($CheckpointPath) {
    if (-not (Test-Path -LiteralPath $CheckpointPath)) {
        throw "Checkpoint not found: $CheckpointPath"
    }
    $argsList += @("-c", $CheckpointPath)
}

Write-Host "Running SHARP..."
Write-Host "Input:  $InputPath"
Write-Host "Output: $OutputPath"
if ($Render) {
    Write-Host "Trajectory: $RenderTrajectory"
    Write-Host "Duration: $RenderDurationSeconds seconds per image"
}
Write-Host ""

& $Sharp @argsList

Write-Host ""
Write-Host "Done. Output folder:"
Write-Host $OutputPath

param(
    [string]$InputPath,
    [string]$OutputPath,
    [double]$Ipd = 0.064,
    [ValidateSet("sbs", "eyes", "both")]
    [string]$Layout = "sbs",
    [ValidateRange(0.1, 120.0)]
    [double]$DurationSeconds = 4.0,
    [ValidateSet("rotate_forward", "rotate", "swipe", "shake")]
    [string]$Trajectory = "rotate_forward",
    [double]$Fps = 30.0
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
    $OutputPath = Join-Path $ProjectRoot "outputs\stereo_$stamp"
}

New-Item -ItemType Directory -Force -Path $OutputPath | Out-Null

Write-Host "Rendering SHARP stereo video..."
Write-Host "Input:  $InputPath"
Write-Host "Output: $OutputPath"
Write-Host "IPD:    $Ipd"
Write-Host "Layout: $Layout"
Write-Host "Trajectory: $Trajectory"
Write-Host "Length: $DurationSeconds seconds at $Fps fps"
Write-Host ""

& $Sharp render-stereo -i $InputPath -o $OutputPath --ipd $Ipd --layout $Layout --duration-seconds $DurationSeconds --trajectory $Trajectory --fps $Fps

Write-Host ""
Write-Host "Done. Output folder:"
Write-Host $OutputPath

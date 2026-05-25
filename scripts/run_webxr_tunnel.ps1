$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DemoRoot = Join-Path $ProjectRoot "webxr-spark-demo"

Write-Host "Starting local HTTP dev server for HTTPS tunnel..."
Write-Host "Demo root: $DemoRoot"
Write-Host ""

$existing = Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq "Listen" } |
    Select-Object -First 1

if (-not $existing) {
    Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev:http") -WorkingDirectory $DemoRoot -WindowStyle Hidden
    Start-Sleep -Seconds 4
}

Write-Host "Opening public HTTPS tunnel..."
Write-Host "Copy the https://... URL shown below into the Quest 3 browser."
Write-Host "Keep this window open while using the tunnel."
Write-Host ""

Set-Location $DemoRoot
& npx.cmd localtunnel --port 5174 --local-host 127.0.0.1

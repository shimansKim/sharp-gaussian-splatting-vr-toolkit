param(
    [int]$Limit = 30,
    [string[]]$PinnedNames = @()
)

$ErrorActionPreference = "Stop"

$PinnedNames = @($PinnedNames) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$OutputsRoot = Join-Path $ProjectRoot "outputs"
$SplatRoot = Join-Path $ProjectRoot "webxr-spark-demo\public\splats"

New-Item -ItemType Directory -Force $SplatRoot | Out-Null

$allFiles = Get-ChildItem -Recurse $OutputsRoot -Filter *.ply |
    Where-Object { $_.Length -gt 1024 }

$pinnedFiles = foreach ($pinnedName in $PinnedNames) {
    $allFiles |
        Where-Object { $_.Name -eq $pinnedName } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

$latestFiles = $allFiles |
    Sort-Object LastWriteTime -Descending

$files = @(@($pinnedFiles) + @($latestFiles)) |
    Where-Object { $_ } |
    Group-Object FullName |
    ForEach-Object { $_.Group[0] } |
    Select-Object -First $Limit

if (-not $files) {
    throw "No .ply files found under $OutputsRoot"
}

Get-ChildItem $SplatRoot -Filter *.ply |
    Where-Object { $_.Name -ne "sharp-output.ply" } |
    Remove-Item -Force

$index = 0
$manifest = foreach ($file in $files) {
    $safeBase = [System.IO.Path]::GetFileNameWithoutExtension($file.Name) -replace '[^0-9A-Za-z_\-]+', '_'
    if ([string]::IsNullOrWhiteSpace($safeBase) -or $safeBase -eq "_") {
        $safeBase = "splat"
    }
    $destName = "{0:D3}_{1}.ply" -f $index, $safeBase
    $destPath = Join-Path $SplatRoot $destName
    try {
        New-Item -ItemType HardLink -Path $destPath -Target $file.FullName -Force | Out-Null
    } catch {
        Copy-Item -LiteralPath $file.FullName -Destination $destPath -Force
    }

    [pscustomobject]@{
        name = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
        url = "/splats/$destName"
        bytes = $file.Length
        source = $file.FullName
    }

    $index++
}

$json = $manifest | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText(
    (Join-Path $SplatRoot "manifest.json"),
    $json,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Refreshed $($manifest.Count) splat entries:"
Write-Host (Join-Path $SplatRoot "manifest.json")

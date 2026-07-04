param(
    [switch]$CheckOnly,
    [switch]$Yes,
    [switch]$SkipSystemInstall
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VenvRoot = Join-Path $ProjectRoot ".venv"
$VenvPython = Join-Path $VenvRoot "Scripts\python.exe"
$WebxrRoot = Join-Path $ProjectRoot "webxr-spark-demo"
$SharpRoot = Join-Path $ProjectRoot "ml-sharp"
$StereoPatch = Join-Path $ProjectRoot "patches\ml-sharp-stereo-render.patch"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Info([string]$Message) {
    Write-Host "[INFO] $Message"
}

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Confirm-Action([string]$Message) {
    if ($Yes) {
        return $true
    }
    $answer = Read-Host "$Message [Y/N]"
    return $answer -match '^(y|yes|Y|YES)$'
}

function Invoke-External([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = $ProjectRoot) {
    Write-Info "$FilePath $($Arguments -join ' ')"
    if ($CheckOnly) {
        return
    }

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath"
        }
    } finally {
        Pop-Location
    }
}

function Install-WingetPackage([string]$Title, [string]$PackageId, [string[]]$ExtraArgs = @()) {
    if (Test-CommandExists ($Title.ToLower())) {
        Write-Ok "$Title command already exists."
        return
    }
    if ($SkipSystemInstall) {
        Write-Warn "$Title is missing. Skipping system install because -SkipSystemInstall was used."
        return
    }
    if (-not (Test-CommandExists "winget")) {
        Write-Warn "$Title is missing, and winget was not found. Install it manually, then run this setup again."
        return
    }
    if (-not (Confirm-Action "$Title is missing. Install with winget package '$PackageId'?")) {
        Write-Warn "$Title install skipped."
        return
    }

    $args = @(
        "install",
        "--id", $PackageId,
        "-e",
        "--accept-source-agreements",
        "--accept-package-agreements"
    ) + $ExtraArgs
    Invoke-External "winget" $args
}

function Resolve-BasePython {
    if (Test-CommandExists "py") {
        if ($CheckOnly) {
            return @{ File = "py"; Args = @("-3.13") }
        }
        & py -3.13 -c "import sys; print(sys.version)" | Out-Null
        if ($LASTEXITCODE -eq 0) {
            return @{ File = "py"; Args = @("-3.13") }
        }
    }
    if (Test-CommandExists "python") {
        return @{ File = "python"; Args = @() }
    }
    throw "Python was not found. Install Python 3.13, then run this setup again."
}

function Ensure-SystemTools {
    Write-Step "1. Windows tool check"
    Install-WingetPackage "git" "Git.Git"
    Install-WingetPackage "python" "Python.Python.3.13"
    Install-WingetPackage "node" "OpenJS.NodeJS.LTS"
    Install-WingetPackage "ffmpeg" "Gyan.FFmpeg"

    if (Test-CommandExists "nvcc") {
        Write-Ok "CUDA Toolkit nvcc found."
    } else {
        Write-Warn "CUDA Toolkit nvcc was not found. PLY generation can work, but SHARP/gsplat video rendering needs CUDA Toolkit 12.8."
        Write-Info "Install NVIDIA CUDA Toolkit 12.8 if you need MP4 rendering from PLY."
        Write-Info "After installing, make sure nvcc is available in PATH or use scripts\\with_cuda_env.bat."
    }

    $vcvars = @(
        "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if ($vcvars) {
        Write-Ok "Visual Studio C++ build environment found: $vcvars"
    } else {
        Write-Warn "Visual Studio 2022 C++ Build Tools were not found. gsplat CUDA extension builds may fail."
        if (-not $SkipSystemInstall -and (Test-CommandExists "winget") -and (Confirm-Action "Install Visual Studio 2022 Build Tools with C++ workload?")) {
            Invoke-External "winget" @(
                "install",
                "--id", "Microsoft.VisualStudio.2022.BuildTools",
                "-e",
                "--accept-source-agreements",
                "--accept-package-agreements",
                "--override", "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
            )
        }
    }
}

function Ensure-ProjectFolders {
    Write-Step "2. Project folder setup"
    foreach ($relative in @("inputs", "outputs")) {
        $path = Join-Path $ProjectRoot $relative
        if ($CheckOnly) {
            Write-Info "Would ensure folder: $path"
        } else {
            New-Item -ItemType Directory -Force -Path $path | Out-Null
        }
        Write-Ok "$relative folder ready."
    }
}

function Ensure-SubmodulesAndPatch {
    Write-Step "3. Submodule and SHARP patch setup"
    if (Test-CommandExists "git") {
        Invoke-External "git" @("submodule", "update", "--init", "--recursive")
    } else {
        Write-Warn "git was not found. Cannot update ml-sharp/spatial-media submodules."
    }

    if (-not (Test-Path -LiteralPath $StereoPatch)) {
        Write-Warn "Stereo patch not found: $StereoPatch"
        return
    }
    if (-not (Test-Path -LiteralPath $SharpRoot)) {
        Write-Warn "ml-sharp folder not found. Run git submodule update first."
        return
    }

    Push-Location $SharpRoot
    try {
        & git apply --reverse --check $StereoPatch 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "SHARP stereo patch is already applied."
            return
        }

        & git apply --check $StereoPatch 2>$null
        if ($LASTEXITCODE -eq 0) {
            Invoke-External "git" @("apply", $StereoPatch) $SharpRoot
            Write-Ok "Applied SHARP stereo patch."
        } else {
            Write-Warn "SHARP stereo patch could not be applied cleanly. Check ml-sharp local changes."
        }
    } finally {
        Pop-Location
    }
}

function Ensure-PythonEnvironment {
    Write-Step "4. Python venv and SHARP install"
    if (-not (Test-Path -LiteralPath $VenvPython)) {
        $basePython = Resolve-BasePython
        $args = @($basePython.Args + @("-m", "venv", $VenvRoot))
        Invoke-External $basePython.File $args
    } else {
        Write-Ok "Python venv already exists: $VenvPython"
    }

    Invoke-External $VenvPython @("-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")
    Invoke-External $VenvPython @(
        "-m", "pip", "install",
        "torch==2.8.0",
        "torchvision==0.23.0",
        "--index-url", "https://download.pytorch.org/whl/cu128"
    )
    Invoke-External $VenvPython @("-m", "pip", "install", "-r", (Join-Path $SharpRoot "requirements.txt"))
    Invoke-External $VenvPython @("-m", "pip", "install", "-e", $SharpRoot)
}

function Ensure-NodeEnvironment {
    Write-Step "5. WebXR dashboard and viewer Node install"
    if (-not (Test-CommandExists "npm")) {
        Write-Warn "npm was not found. Install Node.js LTS, then run this setup again for the WebXR viewer."
        return
    }
    Invoke-External "npm" @("install") $WebxrRoot
}

function Show-FinalCheck {
    Write-Step "6. Final check"
    if (Test-Path -LiteralPath $VenvPython) {
        Invoke-External $VenvPython @("-c", "import sys, torch; print('python', sys.version.split()[0]); print('torch', torch.__version__); print('cuda available', torch.cuda.is_available())")
    }
    if (Test-Path -LiteralPath (Join-Path $VenvRoot "Scripts\sharp.exe")) {
        Write-Ok "SHARP CLI is installed."
    } else {
        Write-Warn "SHARP CLI was not found after setup."
    }

    Write-Host ""
    Write-Host "Next step:"
    Write-Host "  1) Put images in inputs\\"
    Write-Host "  2) Run run_predict.bat"
    Write-Host "  3) Run run_webxr_demo.bat to inspect PLY files in Quest/WebXR"
}

Write-Host "SHARP Gaussian Splatting Lab - Environment Setup"
Write-Host "Project: $ProjectRoot"
if ($CheckOnly) {
    Write-Warn "CheckOnly mode: commands are printed but not executed."
}

Ensure-SystemTools
Ensure-ProjectFolders
Ensure-SubmodulesAndPatch
Ensure-PythonEnvironment
Ensure-NodeEnvironment
Show-FinalCheck

Write-Host ""
Write-Ok "Setup flow completed."

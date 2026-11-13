# Runs every quest-native check that works without a headset and writes one report file.
#   1. clean build from an empty build folder (assembleRelease, includes qnCheckLicenses)
#   2. JVM unit tests (testReleaseUnitTest)
#   3. image C++ PC tests (cpp/image/tests/run_tests.bat, needs Visual Studio 2022 C++)
#   4. splat C++ PC tests (cpp/splat/tools/tests, MSVC + the NDK's Vulkan headers)
#   5. qnCheckLicenses on its own
#   6. APK summary (size, ABI, version, permissions, .so files, assets/licenses, signer)
# Usage: tools\run_all_tests.bat [-Report <file>]   (default: <build root>\test-report.txt)
# ASCII only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 in the ANSI code page.
param([string]$Report = "")

$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Checkout = Split-Path (Split-Path $Root -Parent) -Leaf
$Sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
    foreach ($c in @("$env:ProgramFiles\Android\Android Studio\jbr", "$env:ProgramFiles\Android\Android Studio1\jbr",
                     "$env:LOCALAPPDATA\Programs\Android Studio\jbr")) {
        if (Test-Path (Join-Path $c "bin\java.exe")) { $env:JAVA_HOME = $c; break }
    }
}
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$CleanRoot = Join-Path $env:LOCALAPPDATA "sharp-quest-native\$Checkout-clean-$Stamp"
$Logs = Join-Path $CleanRoot "logs"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
if (-not $Report) { $Report = Join-Path $CleanRoot "test-report.txt" }
$Ndk = Join-Path $Sdk "ndk\28.1.13356709"
$CMake = Join-Path $Sdk "cmake\3.22.1\bin\cmake.exe"
$BuildTools = Get-ChildItem (Join-Path $Sdk "build-tools") -Directory | Sort-Object Name | Select-Object -Last 1
$Aapt2 = Join-Path $BuildTools.FullName "aapt2.exe"
$ApkSigner = Join-Path $BuildTools.FullName "apksigner.bat"
$Apk = Join-Path $CleanRoot "app\outputs\apk\release\app-release.apk"

$lines = New-Object System.Collections.Generic.List[string]
$failed = New-Object System.Collections.Generic.List[string]
function Add([string]$s) { $lines.Add($s); Write-Host $s }
function Section([string]$s) { Add ""; Add ("## " + $s) }

function Run-Gradle([string[]]$tasks, [string]$log) {
    $env:QN_BUILD_ROOT = $CleanRoot
    $local = Join-Path $Root "local.properties"
    Set-Content -Path $local -Value ("sdk.dir=" + ($Sdk -replace '\\', '/')) -Encoding ASCII
    $gargs = @("-p", $Root, "--project-cache-dir", (Join-Path $CleanRoot "gradle-project-cache")) + $tasks
    $sw = [Diagnostics.Stopwatch]::StartNew()
    & (Join-Path $Root "gradlew.bat") @gargs *> $log
    $code = $LASTEXITCODE
    $sw.Stop()
    return @($code, [int]$sw.Elapsed.TotalSeconds)
}

Add "# quest-native test report"
Add ("date: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
$dirty = if ((& git -C $Root status --porcelain -- . 2>$null) -ne $null) { " + uncommitted changes" } else { "" }
Add ("commit: " + (& git -C $Root rev-parse --short HEAD 2>$null) + " (" + (& git -C $Root rev-parse --abbrev-ref HEAD 2>$null) + ")" + $dirty)
Add ("clean build root: " + $CleanRoot)
Add "note: the build folder is empty; the Gradle dependency cache (%USERPROFILE%\.gradle) is reused, so no downloads"
Add ("JAVA_HOME: " + $env:JAVA_HOME)
Add ("ANDROID_HOME: " + $Sdk)

# 1. clean build
Section "1. Clean build (assembleRelease from an empty build folder)"
$r = Run-Gradle @("assembleRelease") (Join-Path $Logs "build.log")
Add ("exit=" + $r[0] + "  time=" + $r[1] + "s  log=" + (Join-Path $Logs "build.log"))
Select-String -Path (Join-Path $Logs "build.log") -Pattern "qnCheckLicenses:|BUILD SUCCESSFUL|BUILD FAILED|warning:" |
    Where-Object { $_.Line -notmatch "CategoryInfo|gradlew.bat :" } | ForEach-Object { Add ("  " + $_.Line.Trim()) }
Add "  (javac 'unknown enum constant Scope.LIBRARY_GROUP' comes from Media3 annotations; known, harmless)"
if ($r[0] -ne 0) { $failed.Add("clean build") }

# 2. JVM unit tests
Section "2. JVM unit tests (testReleaseUnitTest)"
$r = Run-Gradle @("testReleaseUnitTest", "--rerun-tasks") (Join-Path $Logs "jvm-tests.log")
Add ("exit=" + $r[0] + "  time=" + $r[1] + "s")
$results = Join-Path $CleanRoot "app\test-results\testReleaseUnitTest"
$tot = 0; $fail = 0; $skip = 0
if (Test-Path $results) {
    Get-ChildItem $results -Filter *.xml | ForEach-Object {
        $s = ([xml](Get-Content $_.FullName)).testsuite
        $tot += [int]$s.tests; $fail += [int]$s.failures + [int]$s.errors; $skip += [int]$s.skipped
        Add ("  " + $s.name + ": tests=" + $s.tests + " failures=" + $s.failures + " errors=" + $s.errors + " skipped=" + $s.skipped)
    }
}
Add ("  total: tests=" + $tot + " failed=" + $fail + " skipped=" + $skip)
if ($r[0] -ne 0 -or $fail -gt 0 -or $tot -eq 0) { $failed.Add("JVM unit tests") }

# 3. image C++ PC tests
Section "3. image C++ PC tests (cpp/image/tests/run_tests.bat)"
$imgLog = Join-Path $Logs "image-tests.log"
& cmd /c ('"' + (Join-Path $Root "app\src\main\cpp\image\tests\run_tests.bat") + '"') *> $imgLog
$code = $LASTEXITCODE
Add ("exit=" + $code)
Get-Content $imgLog | Select-Object -Last 2 | ForEach-Object { Add ("  " + $_) }
if ($code -eq 2) { Add "  SKIPPED: Visual Studio 2022 C++ tools not found" }
elseif ($code -ne 0) { $failed.Add("image PC tests") }

# 4. splat C++ PC tests
Section "4. splat C++ PC tests (cpp/splat/tools/tests: motion, quality, xr_camera, frame_log)"
$vs = $null
foreach ($e in @("Community", "Professional", "Enterprise", "BuildTools")) {
    $p = "$env:ProgramFiles\Microsoft Visual Studio\2022\$e"
    if (Test-Path $p) { $vs = $p; break }
}
if (-not $vs) {
    Add "  SKIPPED: Visual Studio 2022 not found"
} else {
    $out = Join-Path $CleanRoot "splat-pc-tests"
    $inc = Join-Path $CleanRoot "splat-pc-vkinc"
    New-Item -ItemType Directory -Force -Path $inc | Out-Null
    $sysinc = Join-Path $Ndk "toolchains\llvm\prebuilt\windows-x86_64\sysroot\usr\include"
    Copy-Item -Recurse -Force (Join-Path $sysinc "vulkan") $inc
    Copy-Item -Recurse -Force (Join-Path $sysinc "vk_video") $inc
    $cfgLog = Join-Path $Logs "splat-tests-build.log"
    & $CMake -S (Join-Path $Root "app\src\main\cpp\splat\tools") -B $out -G "Visual Studio 17 2022" -A x64 `
        "-DANDROID_NDK=$Ndk" "-DANDROID_NDK_HOST_SYSTEM_NAME=windows-x86_64" "-DCMAKE_CXX_FLAGS=/I$inc /EHsc" "-DCMAKE_C_FLAGS=/I$inc" *> $cfgLog
    & $CMake --build $out --config Release --target motion_test quality_test xr_camera_test frame_log_test *>> $cfgLog
    if ($LASTEXITCODE -ne 0) { Add ("  build failed, log=" + $cfgLog); $failed.Add("splat PC tests (build)") }
    foreach ($t in @("motion_test", "quality_test", "xr_camera_test", "frame_log_test")) {
        $exe = Join-Path $out "Release\$t.exe"
        if (-not (Test-Path $exe)) { Add ("  " + $t + ": not built"); $failed.Add("splat " + $t); continue }
        $o = & $exe 2>&1
        $c = $LASTEXITCODE
        Add ("  " + $t + ": exit=" + $c + "  " + ($o | Select-Object -Last 1))
        if ($c -ne 0) { $failed.Add("splat " + $t) }
    }
}

# 5. qnCheckLicenses
Section "5. Open-source notice check (gradlew :app:qnCheckLicenses)"
$r = Run-Gradle @(":app:qnCheckLicenses", "--rerun-tasks") (Join-Path $Logs "licenses.log")
Add ("exit=" + $r[0])
Select-String -Path (Join-Path $Logs "licenses.log") -Pattern "qnCheckLicenses:|notice check failed|not in licenses|lists a" | ForEach-Object { Add ("  " + $_.Line.Trim()) }
if ($r[0] -ne 0) { $failed.Add("qnCheckLicenses") }

# 6. APK summary
Section "6. APK summary"
if (-not (Test-Path $Apk)) {
    Add "  APK missing"
    $failed.Add("APK summary")
} else {
    Add ("  file: " + $Apk)
    Add ("  size: " + (Get-Item $Apk).Length + " bytes")
    & $Aapt2 dump badging $Apk 2>$null | Select-String -Pattern "^package:|^sdkVersion|^targetSdkVersion|^native-code|^uses-permission|^uses-feature|^launchable-activity" |
        ForEach-Object { Add ("  " + $_.Line) }
    Add "  native libraries and notice assets:"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Apk)
    try {
        $zip.Entries | Where-Object { $_.FullName -like "lib/*.so" -or $_.FullName -like "assets/licenses/*" } | Sort-Object FullName |
            ForEach-Object { Add ("    " + $_.FullName + "  " + $_.Length) }
    } finally { $zip.Dispose() }
    $sig = & cmd /c ('"' + $ApkSigner + '" verify --print-certs "' + $Apk + '"') 2>&1 | Select-Object -First 1
    Add ("  signer: " + $sig)
}

Section "Result"
if ($failed.Count -eq 0) { Add "ALL PASSED" } else { Add ("FAILED: " + ($failed -join ", ")) }
$lines | Set-Content -Path $Report -Encoding UTF8
Write-Host ""
Write-Host ("report: " + $Report)
if ($failed.Count -eq 0) { exit 0 } else { exit 1 }

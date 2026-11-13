# quest_encode.bat 시험 (test_quest_encode.bat이 UTF-8로 읽어 실행한다)
# 짧은 합성 영상(ffmpeg testsrc2)을 한글·공백 경로에 만들고, quest_encode.bat에 여러 개를 한 번에 끌어다 놓은 것처럼
# 넘긴 뒤 결과를 ffprobe로 검사한다: 코덱·프로필·해상도·fps·픽셀 형식·비트레이트 상한·hvc1·소리·faststart·
# SDR·출력 이름의 형식 재판별, 그리고 이미 권장 범위인 파일 건너뛰기와 강제 변환, 등급(안전) 선택.
# 종료 코드: 0 = 모두 통과

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$EncDir = Split-Path -Parent ([IO.Path]::GetFullPath($env:QE_TEST_DIR))
$Bat = Join-Path $EncDir 'quest_encode.bat'

# quest_encode.ps1의 함수(형식 판별·faststart·표 읽기)를 불러온다.
$env:QE_LIBONLY = '1'
. ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $EncDir 'quest_encode.ps1'), [Text.Encoding]::UTF8)))
$env:QE_LIBONLY = ''
$script:FFMPEG = Find-Tool 'ffmpeg'
$script:FFPROBE = Find-Tool 'ffprobe'
if (-not $script:FFMPEG) { Write-Host 'ffmpeg가 없어 시험할 수 없습니다.'; exit 2 }
$Presets = (Load-Presets (Join-Path $EncDir 'quest_presets.csv')).Map

$Work = Join-Path ([IO.Path]::GetTempPath()) ("qe 시험 폴더 " + (Get-Date -Format 'HHmmss'))
New-Item -ItemType Directory -Force -Path $Work | Out-Null
Write-Host "시험 폴더: $Work"

$T = @{ Pass = 0; Fail = 0 }
function Check([bool]$cond, [string]$what) {
    if ($cond) { $T.Pass++; Write-Host "  [통과] $what" }
    else { $T.Fail++; Write-Host "  [실패] $what" -ForegroundColor Red }
}

function Make([string]$name, [string]$vf, [string[]]$venc, [string[]]$audio) {
    $path = Join-Path $Work $name
    $a = @('-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', $vf)
    if ($audio) { $a += $audio }
    $a += @('-t', '1') + $venc + @($path)
    & $script:FFMPEG @a
    if ($LASTEXITCODE -ne 0) { throw "시험 영상을 만들지 못했습니다: $name" }
    return $path
}

$stereo = @('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:a', 'aac', '-b:a', '128k')
$six = @('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:a', 'aac', '-ac', '6', '-b:a', '256k')
$h264 = @('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p')

Write-Host '시험 영상 만드는 중…'
$src = [ordered]@{}
$src.flat = Make '평면 영상 2d.mp4' 'testsrc2=s=1920x1080:r=30' $h264 $six
$src.big = Make '큰 화면 4k.mp4' 'testsrc2=s=3840x2160:r=24' $h264 $stereo
$src.vr180 = Make '여행 vr180_sbs.mp4' 'testsrc2=s=4096x2048:r=60' $h264 $stereo
$src.hdr = Make 'hdr_360_tb.mkv' 'testsrc2=s=2048x2048:r=30,format=yuv420p10le' @('-c:v', 'libx265', '-preset', 'ultrafast',
    '-x265-params', 'log-level=error', '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084',
    '-colorspace', 'bt2020nc') $null
$src.sbs = Make 'movie_sbs.mp4' 'testsrc2=s=3840x1080:r=25' $h264 $stereo
$src.hfr = Make '고속 촬영.mp4' 'testsrc2=s=1280x720:r=120' $h264 $stereo
$src.ok = Make '이미 맞음_2d.mp4' 'testsrc2=s=1280x720:r=30' @('-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params',
    'log-level=error', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-b:v', '2M', '-movflags', '+faststart') $stereo

function Run-Encode([string[]]$paths, [hashtable]$envs) {
    $env:QE_NONINTERACTIVE = '1'; $env:QE_NOPAUSE = '1'
    $env:QE_TIER = ''; $env:QE_ENCODER = 'quality'; $env:QE_FORCE = ''; $env:QE_LAYOUT = ''
    foreach ($k in $envs.Keys) { Set-Item "env:$k" $envs[$k] }
    $quoted = ($paths | ForEach-Object { '"' + $_ + '"' }) -join ' '
    # 끌어다 놓기와 같은 모양(따옴표로 감싼 경로 여러 개)으로 bat을 부른다.
    # PowerShell 5.1은 따옴표가 든 인수를 cmd에 제대로 넘기지 못해 명령줄을 그대로 지정한다.
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $env:ComSpec
    $psi.Arguments = '/d /s /c ""' + $Bat + '" ' + $quoted + '"'
    $psi.UseShellExecute = $false
    $proc = [Diagnostics.Process]::Start($psi)
    $proc.WaitForExit()
    return $proc.ExitCode
}

function Output-For([string]$srcPath, [string]$layout) {
    return Join-Path $Work ((Get-OutputBase $srcPath $layout) + '.mp4')
}

function Verify([string]$label, [string]$out, [string]$layout, [string]$tier, [int]$w, [int]$h, [double]$fps, [bool]$audio) {
    Write-Host ''
    Write-Host "== $label → $([IO.Path]::GetFileName($out))"
    if (-not (Test-Path -LiteralPath $out)) { Check $false '출력 파일이 있음'; return }
    $p = Probe $out
    $v = @($p.streams | Where-Object { $_.codec_type -eq 'video' })[0]
    $a = @($p.streams | Where-Object { $_.codec_type -eq 'audio' })[0]
    $preset = $Presets["$(Get-Group $layout $w $h)/$tier"]
    Check ($v.codec_name -eq 'hevc' -and $v.profile -eq 'Main') "HEVC Main (지금 $($v.codec_name) $($v.profile))"
    Check ($v.codec_tag_string -eq 'hvc1') "hvc1 표시 (지금 $($v.codec_tag_string))"
    Check ($v.pix_fmt -eq 'yuv420p') "yuv420p 8bit (지금 $($v.pix_fmt))"
    Check ([int]$v.width -eq $w -and [int]$v.height -eq $h) "해상도 ${w}x${h} (지금 $($v.width)x$($v.height))"
    Check ([int]$v.width -le $preset.MaxW -and [int]$v.height -le $preset.MaxH) "권장 상자 $($preset.MaxW)x$($preset.MaxH) 안"
    $f = Parse-Rate $v.avg_frame_rate
    Check ([Math]::Abs($f - $fps) -lt 0.05) "fps $fps (지금 $([Math]::Round($f, 3)))"
    $mbps = Get-VideoMbps $p $v
    Check ($mbps -le $preset.MaxMbps) "비트레이트 $([Math]::Round($mbps, 2))Mbps ≤ $($preset.MaxMbps)Mbps"
    Check (-not (Is-Hdr $v)) "SDR (전달 특성 $($v.color_transfer))"
    Check (Test-FastStart $out) 'faststart(moov가 앞)'
    if ($audio) { Check ($a -and $a.codec_name -eq 'aac' -and [int]$a.channels -le 2) "소리 AAC 스테레오 (지금 $($a.codec_name) $($a.channels)ch)" }
    else { Check (-not $a) '소리 없음 유지' }
    $re = Detect-Layout $out ([int]$v.width) ([int]$v.height) $null
    Check ($re.Layout -eq $layout) "출력 이름으로 같은 형식 판별 ($layout, 지금 $($re.Layout))"
}

# 1) 여러 파일을 한 번에(권장 등급, 품질 우선)
$rc = Run-Encode @($src.flat, $src.big, $src.vr180, $src.hdr, $src.sbs, $src.hfr, $src.ok) @{}
Write-Host ''
Check ($rc -eq 0) "여러 파일 변환 종료 코드 0 (지금 $rc)"
Verify '평면 1080p30, 5.1 소리' (Output-For $src.flat 'mono2d') 'mono2d' 'rec' 1920 1080 30 $true
Verify '평면 4K24 → 1440p로 줄임, fps 그대로' (Output-For $src.big 'mono2d') 'mono2d' 'rec' 2560 1440 24 $true
Verify 'VR180 4096x2048@60 (키우지 않음)' (Output-For $src.vr180 'sbs180') 'sbs180' 'rec' 4096 2048 60 $true
Verify '360 TB HDR 10bit MKV → SDR 8bit MP4' (Output-For $src.hdr 'tb360') 'tb360' 'rec' 2048 2048 30 $false
Verify 'Full SBS 3D 3840x1080@25' (Output-For $src.sbs 'sbsScreenFull') 'sbsScreenFull' 'rec' 3840 1080 25 $true
Verify '120fps → 60fps' (Output-For $src.hfr 'mono2d') 'mono2d' 'rec' 1280 720 60 $true
Write-Host ''
Write-Host '== 이미 권장 범위인 파일'
Check (-not (Test-Path -LiteralPath (Output-For $src.ok 'mono2d'))) '건너뜀(출력 파일 없음)'

# 2) 강제 변환
$rc = Run-Encode @($src.ok) @{ QE_FORCE = '1' }
Check ($rc -eq 0) "강제 변환 종료 코드 0 (지금 $rc)"
Verify '이미 맞음 → 강제 변환' (Output-For $src.ok 'mono2d') 'mono2d' 'rec' 1280 720 30 $true

# 3) 안전 등급: 4K → 1080p, 같은 이름이 있으면 _2를 붙임
$rc = Run-Encode @($src.big) @{ QE_TIER = 'safe' }
Check ($rc -eq 0) "안전 등급 종료 코드 0 (지금 $rc)"
$second = Join-Path $Work ((Get-OutputBase $src.big 'mono2d') + '_2.mp4')
Verify '안전 등급 4K → 1080p' $second 'mono2d' 'safe' 1920 1080 24 $true

# 4) 빠르게(NVENC): 이 PC에 있을 때만
if (Test-NvencWorks) {
    $rc = Run-Encode @($src.vr180) @{ QE_ENCODER = 'fast' }
    Check ($rc -eq 0) "NVENC 종료 코드 0 (지금 $rc)"
    $nv = Join-Path $Work ((Get-OutputBase $src.vr180 'sbs180') + '_2.mp4')
    Verify 'VR180 NVENC' $nv 'sbs180' 'rec' 4096 2048 60 $true
} else { Write-Host '(NVENC 없음: 빠르게 시험은 건너뜀)' }

# 5) 없는 파일은 실패로 셈
$rc = Run-Encode @((Join-Path $Work '없는 파일.mp4')) @{}
Check ($rc -eq 1) "없는 파일이면 종료 코드 1 (지금 $rc)"

# 6) 판별 규칙 몇 가지(앱 FormatDetectTest와 같은 결과)
Write-Host ''
Write-Host '== 형식 판별'
$cases = @(
    @('a_360.mp4', 3840, 1920, 'mono360'), @('a_360.mp4', 3840, 3840, 'tb360'), @('a_vr180.mp4', 3840, 1920, 'sbs180'),
    @('a_180.mp4', 2048, 2048, 'mono180'), @('a_hsbs.mp4', 1920, 1080, 'sbsScreenHalf'), @('a_sbs.mp4', 3840, 1080, 'sbsScreenFull'),
    @('a_tb.mp4', 1920, 2160, 'tbScreen'), @('plain.mp4', 1920, 1080, 'mono2d'), @('plain.mp4', 4096, 2048, 'mono360'),
    @('plain.mp4', 4096, 1024, 'sbs360'))
foreach ($c in $cases) {
    $r = Detect-Layout $c[0] $c[1] $c[2] $null
    Check ($r.Layout -eq $c[3]) "$($c[0]) $($c[1])x$($c[2]) → $($c[3]) (지금 $($r.Layout))"
}

Write-Host ''
Write-Host "결과: 통과 $($T.Pass), 실패 $($T.Fail)   (시험 폴더: $Work)"
if ($T.Fail -eq 0) { Remove-Item -LiteralPath $Work -Recurse -Force; exit 0 }
exit 1

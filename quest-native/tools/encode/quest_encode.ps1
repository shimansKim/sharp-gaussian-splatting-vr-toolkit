# Quest 3 영상 변환 (quest_encode.bat이 부른다)
#
# 이 파일에는 한국어 문구가 있다. Windows PowerShell 5.1은 BOM 없는 .ps1을 ANSI로 읽으므로
# -File로 직접 실행하지 말고 quest_encode.bat으로 실행한다(bat이 UTF-8로 읽어 scriptblock으로 돌린다).
#
# 입력(환경 변수, bat이 채움)
#   QE_DIR      이 폴더 경로
#   QE_ARGS     끌어다 놓은 파일들(cmd의 %*, 공백 있는 경로는 "따옴표")
#   QE_TIER     safe | rec | best        비우면 물어봄(Enter = rec)
#   QE_ENCODER  quality | fast           비우면 물어봄(Enter = quality, libx265)
#   QE_FORCE    1이면 이미 권장 범위인 파일도 변환
#   QE_LAYOUT   형식을 강제(mono2d, sbs180 …). 비우면 자동 판별
#   QE_NONINTERACTIVE  1이면 아무것도 묻지 않음(시험용). 애매한 형식은 자동 판별 값을 씀
#   QE_PRESETS  다른 권장값 표(csv)를 쓸 때
# 종료 코드: 0 = 모두 성공 또는 건너뜀, 1 = 실패한 파일이 있음, 2 = 준비 오류(ffmpeg 없음 등)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$Dir = $env:QE_DIR
if (-not $Dir) { $Dir = (Get-Location).Path }
$NonInteractive = ($env:QE_NONINTERACTIVE -eq '1')

function Say([string]$s) { Write-Host $s }
function Warn([string]$s) { Write-Host $s -ForegroundColor Yellow }
function Fail([string]$s) { Write-Host $s -ForegroundColor Red }

# ------------------------------------------------------------------ 권장값 표

function Load-Presets([string]$path) {
    $status = '잠정'
    $rows = New-Object System.Collections.Generic.List[string]
    foreach ($line in [IO.File]::ReadAllLines($path, [Text.Encoding]::UTF8)) {
        if ($line -match '^#status=(.*)$') { $status = $Matches[1].Trim(); continue }
        if ($line.Trim() -eq '' -or $line.StartsWith('#')) { continue }
        $rows.Add($line)
    }
    $table = $rows | ConvertFrom-Csv
    $map = @{}
    foreach ($r in $table) {
        $map["$($r.group)/$($r.tier)"] = [pscustomobject]@{
            Group = $r.group; Tier = $r.tier
            MaxW = [int]$r.max_w; MaxH = [int]$r.max_h; MaxFps = [double]$r.max_fps
            MaxMbps = [double]$r.max_mbps; Crf = [int]$r.crf; Cq = [int]$r.cq; Basis = $r.basis
        }
    }
    return @{ Status = $status; Map = $map }
}

# ------------------------------------------------------------------ 형식 판별 (video/FormatDetect.java와 같은 규칙)

$Layouts = @('sbs180', 'mono180', 'mono360', 'tb360', 'sbs360', 'sbsScreenFull', 'sbsScreenHalf', 'tbScreen', 'mono2d')
$LayoutLabel = @{
    mono2d = '2D 일반 화면'; mono360 = '360° 모노'; tb360 = '360° 3D 위아래(TB)'; sbs360 = '360° 3D 좌우(SBS)'
    sbs180 = 'VR180 3D 좌우(SBS)'; mono180 = 'VR180 모노'; sbsScreenFull = '3D 스크린 Full SBS'
    sbsScreenHalf = '3D 스크린 Half SBS'; tbScreen = '3D 스크린 위아래(TB)'
}
# 출력 파일 이름에 붙이는 형식 표시. 앱의 FormatDetect가 이 이름으로 같은 형식을 다시 고른다.
$LayoutTag = @{
    mono2d = '2d'; mono360 = '360_mono'; tb360 = '360_tb'; sbs360 = '360_sbs'; sbs180 = 'vr180_sbs'
    mono180 = 'vr180_mono'; sbsScreenFull = 'fsbs'; sbsScreenHalf = 'hsbs'; tbScreen = 'tb'
}

function Get-BaseName([string]$name) {
    $file = [IO.Path]::GetFileName($name)
    $dot = $file.LastIndexOf('.')
    if ($dot -ge 0) { $file = $file.Substring(0, $dot) }
    return $file.ToLowerInvariant()
}

function Get-NameHints([string]$name) {
    $base = Get-BaseName $name
    $t = @($base -split '[^a-z0-9]+' | Where-Object { $_ -ne '' })
    $h = @{ Projection = $null; Stereo = $null; Half = $false; Full = $false; Hints = @() }
    function HasAny($keys) { foreach ($k in $keys) { if ($t -contains $k) { return $true } }; return $false }
    if ((HasAny @('360', 'vr360', 'equirect', 'equirectangular', 'spherical')) -or $base -match 'vr360|360vr') {
        $h.Projection = '360'; $h.Hints += '이름에 360'
    }
    if ((HasAny @('180', 'vr180', 'fisheye180')) -or $base -match 'vr180') {
        $h.Projection = '180'; $h.Hints += '이름에 180'
    }
    if ((HasAny @('hsbs', 'halfsbs', 'half-sbs')) -or $base -match 'half[-_ ]?sbs') {
        $h.Stereo = 'sbs'; $h.Half = $true; $h.Hints += '이름에 HSBS'
    } elseif ((HasAny @('fsbs', 'fullsbs')) -or $base -match 'full[-_ ]?sbs') {
        $h.Stereo = 'sbs'; $h.Full = $true; $h.Hints += '이름에 FSBS'
    } elseif ((HasAny @('sbs', 'lr', '3dh', 'leftright', 'sidebyside')) -or $base -match 'side[-_ ]?by[-_ ]?side') {
        $h.Stereo = 'sbs'; $h.Hints += '이름에 SBS/LR'
    } elseif ((HasAny @('tb', 'ou', 'htb', 'ftb', '3dv', 'topbottom', 'overunder')) -or $base -match 'over[-_ ]?under|top[-_ ]?bottom') {
        $h.Stereo = 'tb'; $h.Hints += '이름에 TB/OU'
    } elseif (HasAny @('mono', '2d')) {
        $h.Stereo = 'mono'; $h.Hints += '이름에 mono'
    }
    if (-not $h.Stereo -and ($t -contains '3d')) { $h.Hints += '이름에 3D(좌우/위아래 불명)' }
    return $h
}

function F2([double]$v) { return $v.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture) }

# spatial: @{ Stereo = 'sbs'|'tb'|'mono'|$null; Projection = '360'|'180'|$null } 또는 $null
function Detect-Layout([string]$name, [int]$w, [int]$h, $spatial) {
    $ratio = 0.0
    if ($w -gt 0 -and $h -gt 0) { $ratio = [double]$w / $h }
    $nh = Get-NameHints $name
    $reasons = New-Object System.Collections.Generic.List[string]
    $projection = $nh.Projection; $stereo = $nh.Stereo; $fromMeta = $false
    if ($spatial -and ($spatial.Projection -or $spatial.Stereo)) {
        if ($spatial.Projection) { $projection = $spatial.Projection }
        if ($spatial.Stereo) { $stereo = $spatial.Stereo }
        $fromMeta = $true; $reasons.Add('MP4 공간 메타데이터(st3d/sv3d)')
    } else { foreach ($x in $nh.Hints) { $reasons.Add($x) } }

    if ($projection -eq '360') {
        if ($stereo -eq 'mono') { $st = 'mono' }
        elseif ($stereo) { $st = $stereo }
        elseif ($ratio -gt 0) { if ($ratio -ge 3.2) { $st = 'sbs' } elseif ($ratio -le 1.25) { $st = 'tb' } else { $st = 'mono' } }
        else { $st = 'mono' }
        $layout = @{ sbs = 'sbs360'; tb = 'tb360'; mono = 'mono360' }[$st]
        $strong = $fromMeta -or $stereo -or $ratio -eq 0
        if (-not $stereo -and $ratio -gt 0) { $reasons.Add("비율 $(F2 $ratio):1로 입체 방식 추정") }
        return @{ Layout = $layout; Confidence = $(if ($strong) { 'high' } else { 'medium' }); Reasons = $reasons }
    }
    if ($projection -eq '180') {
        $st = $stereo
        if (-not $st -or $st -eq 'tb') {
            if ($ratio -gt 0 -and $ratio -ge 1.6) { $st = 'sbs' }
            elseif ($ratio -gt 0 -and $ratio -le 1.25) { $st = 'mono' }
            elseif ($st -eq 'tb') { $st = 'mono' } else { $st = 'sbs' }
        }
        return @{ Layout = $(if ($st -eq 'mono') { 'mono180' } else { 'sbs180' }); Confidence = 'high'; Reasons = $reasons }
    }
    if ($stereo -eq 'sbs') {
        if ($nh.Half) { return @{ Layout = 'sbsScreenHalf'; Confidence = 'high'; Reasons = $reasons } }
        if ($nh.Full) { return @{ Layout = 'sbsScreenFull'; Confidence = 'high'; Reasons = $reasons } }
        if ($ratio -ge 1.9 -and $ratio -le 2.15) {
            $reasons.Add("SBS 이름 + 비율 $(F2 $ratio):1 → VR180으로 추정")
            return @{ Layout = 'sbs180'; Confidence = 'medium'; Reasons = $reasons }
        }
        if ($ratio -ge 2.6) {
            $reasons.Add("SBS 이름 + 비율 $(F2 $ratio):1 → Full SBS")
            return @{ Layout = 'sbsScreenFull'; Confidence = 'medium'; Reasons = $reasons }
        }
        if ($ratio -gt 0) { $reasons.Add("SBS 이름 + 비율 $(F2 $ratio):1 → Half SBS") }
        return @{ Layout = 'sbsScreenHalf'; Confidence = 'medium'; Reasons = $reasons }
    }
    if ($stereo -eq 'tb') {
        if ($ratio -ge 0.95 -and $ratio -le 1.1) {
            $reasons.Add('비율 1:1 → 360 TB로 추정')
            return @{ Layout = 'tb360'; Confidence = 'medium'; Reasons = $reasons }
        }
        return @{ Layout = 'tbScreen'; Confidence = 'medium'; Reasons = $reasons }
    }
    if ($stereo -eq 'mono') {
        if ($ratio -ge 1.9 -and $ratio -le 2.15) {
            $reasons.Add('비율 2:1 → 360으로 추정')
            return @{ Layout = 'mono360'; Confidence = 'medium'; Reasons = $reasons }
        }
        return @{ Layout = 'mono2d'; Confidence = 'medium'; Reasons = $reasons }
    }
    if ($ratio -eq 0) { $reasons.Add('해상도 정보 없음'); return @{ Layout = 'mono2d'; Confidence = 'low'; Reasons = $reasons } }
    if ($ratio -ge 3.8 -and $ratio -le 4.2) { $reasons.Add("비율 $(F2 $ratio):1 → 360 SBS로 추정"); return @{ Layout = 'sbs360'; Confidence = 'low'; Reasons = $reasons } }
    if ($ratio -ge 2.6) { $reasons.Add("비율 $(F2 $ratio):1 → Full SBS 스크린으로 추정"); return @{ Layout = 'sbsScreenFull'; Confidence = 'low'; Reasons = $reasons } }
    if ($ratio -ge 1.9 -and $ratio -le 2.15) { $reasons.Add('비율 2:1 → 360 모노로 추정(VR180이면 형식을 바꾸세요)'); return @{ Layout = 'mono360'; Confidence = 'low'; Reasons = $reasons } }
    if ($ratio -ge 0.95 -and $ratio -le 1.05) { $reasons.Add('비율 1:1 → 360 TB로 추정'); return @{ Layout = 'tb360'; Confidence = 'low'; Reasons = $reasons } }
    $reasons.Add("일반 비율 $(F2 $ratio):1")
    return @{ Layout = 'mono2d'; Confidence = 'low'; Reasons = $reasons }
}

# 형식 → 권장값 묶음. Half SBS와 Half TB(가로가 넓은 TB)는 프레임이 평면 영상과 같아 flat을 쓴다.
function Get-Group([string]$layout, [int]$w, [int]$h) {
    switch ($layout) {
        'mono2d' { return 'flat' }
        'sbsScreenHalf' { return 'flat' }
        'sbsScreenFull' { return 'sbs3d' }
        'tbScreen' { if ($h -gt 0 -and ([double]$w / $h) -lt 1.2) { return 'tb3d' } else { return 'flat' } }
        'sbs180' { return 'vr180' }
        'mono180' { return 'vr180mono' }
        'mono360' { return 'mono360' }
        'tb360' { return 'tb360' }
        'sbs360' { return 'sbs360' }
    }
    return 'flat'
}

# 원래 이름에서 형식 단어를 빼고 새 형식 표시를 붙인다("여행 vr180_sbs.mp4" → "여행_q3_vr180_sbs.mp4").
function Get-OutputBase([string]$inputPath, [string]$layout) {
    $base = [IO.Path]::GetFileNameWithoutExtension($inputPath)
    $words = 'vr360|360vr|equirectangular|equirect|spherical|fisheye180|vr180|360|180|half[-_ ]?sbs|full[-_ ]?sbs|side[-_ ]?by[-_ ]?side|over[-_ ]?under|top[-_ ]?bottom|hsbs|halfsbs|fsbs|fullsbs|sbs|lr|3dh|leftright|sidebyside|htb|ftb|tb|ou|3dv|topbottom|overunder|mono|2d|3d'
    $clean = [regex]::Replace($base, "(?i)(?<![a-z0-9])($words)(?![a-z0-9])", '')
    $clean = [regex]::Replace($clean, '[ _.\-]{2,}', '_').Trim(' ', '_', '.', '-')
    if (-not $clean) { $clean = 'video' }
    return "${clean}_q3_$($LayoutTag[$layout])"
}

# ------------------------------------------------------------------ ffmpeg

function Find-Tool([string]$exe) {
    $fixed = Join-Path $env:ProgramFiles "ffmpeg\bin\$exe.exe"
    if (Test-Path $fixed) { return $fixed }
    $cmd = Get-Command $exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Probe([string]$path) {
    $json = & $script:FFPROBE -v error -print_format json -show_format -show_streams -i $path 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
    return ($json -join "`n") | ConvertFrom-Json
}

function Parse-Rate([string]$r) {
    if (-not $r -or $r -eq '0/0') { return 0.0 }
    $p = $r.Split('/')
    if ($p.Count -eq 2 -and [double]$p[1] -ne 0) { return [double]$p[0] / [double]$p[1] }
    return [double]$r
}

function Get-Spatial($vs) {
    $out = @{ Stereo = $null; Projection = $null }
    foreach ($sd in @($vs.side_data_list)) {
        if (-not $sd) { continue }
        if ($sd.side_data_type -eq 'Stereo 3D') {
            switch ($sd.type) { 'side by side' { $out.Stereo = 'sbs' } 'top and bottom' { $out.Stereo = 'tb' } '2D' { $out.Stereo = 'mono' } }
        } elseif ($sd.side_data_type -eq 'Spherical Mapping' -and $sd.projection -match 'equirect') {
            $l = 0.0; $r = 0.0
            if ($sd.bound_left) { $l = [double]$sd.bound_left / 4294967296.0 }
            if ($sd.bound_right) { $r = [double]$sd.bound_right / 4294967296.0 }
            if ($l + $r -ge 0.45) { $out.Projection = '180' } else { $out.Projection = '360' }
        }
    }
    if (-not $out.Stereo -and -not $out.Projection) { return $null }
    return $out
}

# MP4 맨 위 상자 순서로 faststart(moov가 mdat보다 앞)인지 본다.
function Test-FastStart([string]$path) {
    try {
        $fs = [IO.File]::OpenRead($path)
        try {
            $buf = New-Object byte[] 16; $pos = [long]0; $len = $fs.Length
            for ($i = 0; $i -lt 64 -and $pos + 8 -le $len; $i++) {
                $fs.Position = $pos
                if ($fs.Read($buf, 0, 16) -lt 8) { break }
                $size = [long](([uint32]$buf[0] -shl 24) -bor ([uint32]$buf[1] -shl 16) -bor ([uint32]$buf[2] -shl 8) -bor [uint32]$buf[3])
                $type = [Text.Encoding]::ASCII.GetString($buf, 4, 4)
                if ($size -eq 1) {
                    $size = [long]0
                    for ($k = 8; $k -lt 16; $k++) { $size = ($size -shl 8) -bor [long]$buf[$k] }
                } elseif ($size -eq 0) { $size = $len - $pos }
                if ($type -eq 'moov') { return $true }
                if ($type -eq 'mdat') { return $false }
                if ($size -lt 8) { break }
                $pos += $size
            }
        } finally { $fs.Dispose() }
    } catch { }
    return $false
}

function Test-NvencWorks {
    $null = & $script:FFMPEG -hide_banner -loglevel error -f lavfi -i 'color=black:s=256x256:d=0.1' -c:v hevc_nvenc -f null - 2>&1
    return ($LASTEXITCODE -eq 0)
}

# ------------------------------------------------------------------ 한 파일

# 해상도를 상자 안에 맞춘다(키우지 않음). 바꿀 때는 4의 배수로 맞춰 좌우·위아래 반쪽이 짝수가 되게 한다.
function Fit-Size([int]$w, [int]$h, [int]$maxW, [int]$maxH) {
    $s = [Math]::Min(1.0, [Math]::Min([double]$maxW / $w, [double]$maxH / $h))
    if ($s -ge 1.0 -and ($w % 2) -eq 0 -and ($h % 2) -eq 0) { return @($w, $h) }
    $nw = [int]([Math]::Floor($w * $s / 4) * 4); $nh = [int]([Math]::Floor($h * $s / 4) * 4)
    if ($s -ge 1.0) { $nw = $w - ($w % 2); $nh = $h - ($h % 2) }
    return @([Math]::Max(4, $nw), [Math]::Max(4, $nh))
}

function Get-VideoMbps($probe, $vs) {
    $b = 0.0
    if ($vs.bit_rate) { $b = [double]$vs.bit_rate }
    elseif ($probe.format.bit_rate) { $b = [double]$probe.format.bit_rate }
    return $b / 1e6
}

function Is-Hdr($vs) {
    return ($vs.color_transfer -eq 'smpte2084' -or $vs.color_transfer -eq 'arib-std-b67')
}

# 권장 범위 밖인 이유 목록(비면 변환이 필요 없음)
function Get-NonCompliance($probe, $vs, $as, $preset, [string]$path) {
    $why = New-Object System.Collections.Generic.List[string]
    $w = [int]$vs.width; $h = [int]$vs.height; $fps = Parse-Rate $vs.avg_frame_rate
    if ($fps -le 0) { $fps = Parse-Rate $vs.r_frame_rate }
    if ($vs.codec_name -ne 'hevc') { $why.Add("코덱 $($vs.codec_name) → HEVC") }
    elseif ($vs.profile -and $vs.profile -ne 'Main') { $why.Add("HEVC 프로필 $($vs.profile) → Main(8bit)") }
    if ($vs.pix_fmt -ne 'yuv420p') { $why.Add("픽셀 형식 $($vs.pix_fmt) → yuv420p") }
    if (Is-Hdr $vs) { $why.Add('HDR → SDR') }
    if ($w -gt $preset.MaxW -or $h -gt $preset.MaxH) { $why.Add("해상도 ${w}x${h} → 최대 $($preset.MaxW)x$($preset.MaxH)") }
    if ($fps -gt $preset.MaxFps + 0.5) { $why.Add("fps $([Math]::Round($fps, 2)) → $($preset.MaxFps)") }
    $mbps = Get-VideoMbps $probe $vs
    if ($mbps -gt $preset.MaxMbps * 1.1) { $why.Add("비트레이트 $([Math]::Round($mbps, 1))Mbps → 최대 $($preset.MaxMbps)Mbps") }
    if ($vs.codec_name -eq 'hevc' -and $vs.codec_tag_string -ne 'hvc1') { $why.Add('HEVC 표시 hev1 → hvc1') }
    if ($as -and $as.codec_name -ne 'aac') { $why.Add("소리 $($as.codec_name) → AAC") }
    if ($as -and [int]$as.channels -gt 2) { $why.Add("소리 $($as.channels)채널 → 스테레오") }
    $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
    if ($ext -ne '.mp4' -and $ext -ne '.m4v') { $why.Add("컨테이너 $ext → MP4") }
    elseif (-not (Test-FastStart $path)) { $why.Add('faststart 아님(앞부분에 색인 없음)') }
    return $why
}

function Ask-Layout([string]$detected) {
    Say '  형식을 고르세요:'
    for ($i = 0; $i -lt $Layouts.Count; $i++) {
        $mark = ''
        if ($Layouts[$i] -eq $detected) { $mark = '  ← 추정' }
        Say ("    {0}. {1}{2}" -f ($i + 1), $LayoutLabel[$Layouts[$i]], $mark)
    }
    while ($true) {
        $a = Read-Host "  번호 (Enter = 추정 '$($LayoutLabel[$detected])')"
        if (-not $a) { return $detected }
        $n = 0
        if ([int]::TryParse($a, [ref]$n) -and $n -ge 1 -and $n -le $Layouts.Count) { return $Layouts[$n - 1] }
    }
}

function Convert-One([string]$path) {
    Say ''
    Say "=== $([IO.Path]::GetFileName($path))"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail '  파일이 없습니다.'; return 'fail' }
    $probe = Probe $path
    if (-not $probe) { Fail '  영상 정보를 읽지 못했습니다(영상 파일이 아니거나 손상됨).'; return 'fail' }
    $vs = @($probe.streams | Where-Object { $_.codec_type -eq 'video' -and -not ($_.disposition.attached_pic -eq 1) })[0]
    $as = @($probe.streams | Where-Object { $_.codec_type -eq 'audio' })[0]
    if (-not $vs) { Fail '  영상 트랙이 없습니다.'; return 'fail' }
    $w = [int]$vs.width; $h = [int]$vs.height
    $fps = Parse-Rate $vs.avg_frame_rate
    if ($fps -le 0) { $fps = Parse-Rate $vs.r_frame_rate }
    Say ("  원본: {0} {1}x{2} {3}fps {4}{5} {6}Mbps, 소리 {7}" -f $vs.codec_name, $w, $h, [Math]::Round($fps, 2), $vs.pix_fmt,
        $(if (Is-Hdr $vs) { ' HDR' } else { '' }), [Math]::Round((Get-VideoMbps $probe $vs), 1),
        $(if ($as) { "$($as.codec_name) $($as.channels)ch" } else { '없음' }))

    # 형식
    if ($env:QE_LAYOUT) {
        if ($Layouts -notcontains $env:QE_LAYOUT) { Fail "  QE_LAYOUT 값이 틀렸습니다: $($env:QE_LAYOUT)"; return 'fail' }
        $layout = $env:QE_LAYOUT
        Say "  형식: $($LayoutLabel[$layout]) (지정)"
    } else {
        $d = Detect-Layout $path $w $h (Get-Spatial $vs)
        $layout = $d.Layout
        Say "  형식: $($LayoutLabel[$layout]) (근거: $($d.Reasons -join ', '))"
        if ($d.Confidence -eq 'low' -and -not $NonInteractive) {
            Warn '  형식이 확실하지 않습니다.'
            $layout = Ask-Layout $layout
            Say "  형식: $($LayoutLabel[$layout])"
        }
    }
    $group = Get-Group $layout $w $h
    $preset = $script:Presets.Map["$group/$($script:Tier)"]
    if (-not $preset) { Fail "  권장값 표에 $group/$($script:Tier) 줄이 없습니다."; return 'fail' }
    Say ("  권장({0}): 최대 {1}x{2}, {3}fps 이하, {4}Mbps 이하  [{5}]" -f $script:TierLabel, $preset.MaxW, $preset.MaxH,
        $preset.MaxFps, $preset.MaxMbps, $preset.Basis)

    $why = Get-NonCompliance $probe $vs $as $preset $path
    if ($why.Count -eq 0 -and $env:QE_FORCE -ne '1') {
        Say '  변환이 필요 없습니다(이미 권장 범위 안). 건너뜁니다. 그래도 변환하려면 QE_FORCE=1 또는 시작할 때 "강제"를 고르세요.'
        return 'skip'
    }
    if ($why.Count -gt 0) { Say "  바꿀 것: $($why -join ' / ')" } else { Say '  (강제 변환)' }

    # 크기·fps
    $size = Fit-Size $w $h $preset.MaxW $preset.MaxH
    $ow = $size[0]; $oh = $size[1]
    $outFps = $fps
    $filters = New-Object System.Collections.Generic.List[string]
    if (Is-Hdr $vs) {
        if ($script:HasZscale) {
            $filters.Add('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv')
        } else {
            Warn '  이 ffmpeg에는 zscale 필터가 없어 HDR 색을 제대로 바꾸지 못합니다(색이 바래 보일 수 있음).'
        }
    }
    if ($ow -ne $w -or $oh -ne $h) { $filters.Add("scale=${ow}:${oh}:flags=lanczos") }
    if ($fps -gt $preset.MaxFps + 0.5) { $filters.Add("fps=$($preset.MaxFps)"); $outFps = $preset.MaxFps }
    $filters.Add('format=yuv420p')
    $maxK = [int]($preset.MaxMbps * 1000)
    # 출력 화소가 디코더 한계(8192x4096@60)를 넘으면 경고만 한다(표 값이 한계 안이면 생기지 않음).
    if ($ow -gt 8192 -or $oh -gt 8192 -or ([double]$ow * $oh * $outFps) -gt (8192.0 * 4096 * 60 * 1.01)) {
        Warn "  주의: ${ow}x${oh}@$([Math]::Round($outFps, 2))는 Quest 3 하드웨어 디코더 한계를 넘습니다."
    }

    $outBase = Get-OutputBase $path $layout
    $folder = [IO.Path]::GetDirectoryName($path)
    $out = Join-Path $folder "$outBase.mp4"
    $n = 2
    while (Test-Path -LiteralPath $out) { $out = Join-Path $folder "${outBase}_$n.mp4"; $n++ }
    $tmp = "$out.part.mp4"

    $ffArgs = New-Object System.Collections.Generic.List[string]
    $ffArgs.AddRange([string[]]@('-hide_banner', '-loglevel', 'error', '-stats', '-y', '-i', $path, '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', ($filters -join ','), '-map_metadata', '-1', '-map_chapters', '-1'))
    if ($script:Encoder -eq 'fast') {
        $ffArgs.AddRange([string[]]@('-c:v', 'hevc_nvenc', '-preset', 'p6', '-tune', 'hq', '-profile:v', 'main', '-rc', 'vbr',
            '-cq', "$($preset.Cq)", '-b:v', '0', '-maxrate', "${maxK}k", '-bufsize', "$($maxK * 2)k"))
    } else {
        $ffArgs.AddRange([string[]]@('-c:v', 'libx265', '-preset', 'medium', '-profile:v', 'main', '-crf', "$($preset.Crf)",
            '-x265-params', "log-level=error:vbv-maxrate=${maxK}:vbv-bufsize=$($maxK * 2)"))
    }
    $ffArgs.AddRange([string[]]@('-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'))
    if (Is-Hdr $vs) { $ffArgs.AddRange([string[]]@('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709')) }
    if ($as) {
        if ($as.codec_name -eq 'aac' -and [int]$as.channels -le 2) { $ffArgs.AddRange([string[]]@('-c:a', 'copy')) }
        else { $ffArgs.AddRange([string[]]@('-c:a', 'aac', '-b:a', '192k', '-ac', '2')) }
    }
    $ffArgs.AddRange([string[]]@('-movflags', '+faststart', '-f', 'mp4', $tmp))

    Say ("  변환: HEVC {0}x{1} {2}fps, {3}, 최대 {4}Mbps → {5}" -f $ow, $oh, [Math]::Round($outFps, 2),
        $(if ($script:Encoder -eq 'fast') { "hevc_nvenc cq $($preset.Cq)" } else { "libx265 crf $($preset.Crf)" }),
        $preset.MaxMbps, [IO.Path]::GetFileName($out))
    $t0 = Get-Date
    $argv = $ffArgs.ToArray()
    & $script:FFMPEG @argv
    $rc = $LASTEXITCODE
    if ($rc -ne 0 -or -not (Test-Path -LiteralPath $tmp)) {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
        Fail "  변환 실패(ffmpeg 종료 코드 $rc)."
        if ($script:Encoder -eq 'fast') { Warn '  그래픽카드 인코딩이 안 되면 다시 실행해 "품질 우선"을 고르세요.' }
        return 'fail'
    }
    Move-Item -LiteralPath $tmp -Destination $out
    $op = Probe $out
    $ovs = @($op.streams | Where-Object { $_.codec_type -eq 'video' })[0]
    Say ("  완료: {0} {1}x{2} {3}fps {4} {5}Mbps, {6}초" -f $ovs.codec_name, $ovs.width, $ovs.height,
        [Math]::Round((Parse-Rate $ovs.avg_frame_rate), 2), $ovs.pix_fmt, [Math]::Round((Get-VideoMbps $op $ovs), 1),
        [int]((Get-Date) - $t0).TotalSeconds)
    return 'ok'
}

# ------------------------------------------------------------------ 시작

# 시험 스크립트가 함수만 쓰려고 불러올 때(QE_LIBONLY=1)는 여기서 멈춘다.
if ($env:QE_LIBONLY -eq '1') { return }

Say '================================================================'
Say '  Quest 3 영상 변환 (quest-native 인코딩 안내 권장값)'
Say '================================================================'

$script:FFMPEG = Find-Tool 'ffmpeg'
$script:FFPROBE = Find-Tool 'ffprobe'
if (-not $script:FFMPEG -or -not $script:FFPROBE) {
    Fail 'ffmpeg를 찾지 못했습니다.'
    Say '  설치 방법(둘 중 하나):'
    Say '   1) 명령 프롬프트에서:  winget install Gyan.FFmpeg'
    Say '   2) https://www.gyan.dev/ffmpeg/builds/ 에서 "release essentials"를 받아 C:\Program Files\ffmpeg 에 풀기'
    Say '      (C:\Program Files\ffmpeg\bin\ffmpeg.exe 가 되도록)'
    exit 2
}

$presetPath = $env:QE_PRESETS
if (-not $presetPath) { $presetPath = Join-Path $Dir 'quest_presets.csv' }
$script:Presets = Load-Presets $presetPath
if ($script:Presets.Status.StartsWith('확정')) { Say "권장값: $($script:Presets.Status)" }
else { Warn "권장값: $($script:Presets.Status)" }
Say "  (값 표: $presetPath)"

# 파일 목록: cmd의 %* ("공백 있는 경로" 그리고 따옴표 없는 경로)
$files = New-Object System.Collections.Generic.List[string]
foreach ($m in [regex]::Matches([string]$env:QE_ARGS, '"([^"]+)"|(\S+)')) {
    $p = $m.Groups[1].Value
    if (-not $p) { $p = $m.Groups[2].Value }
    if ($p -match '^(?i)/force$') { $env:QE_FORCE = '1'; continue }
    $files.Add($p)
}
if ($files.Count -eq 0) {
    Say ''
    Say '영상 파일(여러 개 가능)을 quest_encode.bat 위에 끌어다 놓으세요.'
    Say '변환된 파일은 원본 옆에 "<이름>_q3_<형식>.mp4"로 생깁니다. 원본은 바꾸지 않습니다.'
    exit 2
}

$filtersList = (& $script:FFMPEG -hide_banner -filters 2>$null) -join "`n"
$script:HasZscale = $filtersList -match '\szscale\s'

# 등급
$tier = $env:QE_TIER
if (-not $tier -and -not $NonInteractive) {
    Say ''
    Say '등급을 고르세요:'
    Say '  1. 안전  - 어디서나 잘 돌아가는 크기(파일이 작음)'
    Say '  2. 권장  - Quest 3에 맞춘 기본값'
    Say '  3. 최고  - 디코더 한계까지(파일이 큼)'
    $a = Read-Host '번호 (Enter = 2 권장)'
    $tier = @{ '1' = 'safe'; '2' = 'rec'; '3' = 'best' }[$a]
}
if (-not $tier) { $tier = 'rec' }
if (@('safe', 'rec', 'best') -notcontains $tier) { Fail "QE_TIER 값이 틀렸습니다: $tier"; exit 2 }
$script:Tier = $tier
$script:TierLabel = @{ safe = '안전'; rec = '권장'; best = '최고' }[$tier]

# 인코더
$enc = $env:QE_ENCODER
$nvenc = Test-NvencWorks
if (-not $enc -and -not $NonInteractive) {
    Say ''
    Say '인코더를 고르세요:'
    Say '  1. 품질 우선 - libx265(CPU). 느리지만 같은 크기에서 화질이 좋음'
    if ($nvenc) { Say '  2. 빠르게    - NVIDIA 그래픽카드(hevc_nvenc). 몇 배 빠름' }
    else { Say '  2. 빠르게    - (이 PC에서는 NVIDIA 그래픽카드 인코딩을 쓸 수 없습니다)' }
    $a = Read-Host '번호 (Enter = 1 품질 우선)'
    if ($a -eq '2') { $enc = 'fast' }
}
if (-not $enc) { $enc = 'quality' }
if ($enc -eq 'fast' -and -not $nvenc) { Warn 'NVIDIA 그래픽카드 인코딩을 쓸 수 없어 품질 우선(libx265)으로 바꿉니다.'; $enc = 'quality' }
if (@('quality', 'fast') -notcontains $enc) { Fail "QE_ENCODER 값이 틀렸습니다: $enc"; exit 2 }
$script:Encoder = $enc

if ($env:QE_FORCE -ne '1' -and -not $NonInteractive) {
    $a = Read-Host '이미 권장 범위인 파일도 다시 변환할까요? (Enter = 아니요, y = 강제)'
    if ($a -match '^(?i)y') { $env:QE_FORCE = '1' }
}

$ok = 0; $skip = 0; $bad = 0
foreach ($f in $files) {
    $r = 'fail'
    try { $r = Convert-One $f } catch { Fail "  오류: $($_.Exception.Message)" }
    switch ($r) { 'ok' { $ok++ } 'skip' { $skip++ } default { $bad++ } }
}
Say ''
Say "끝: 변환 ${ok}개, 건너뜀 ${skip}개, 실패 ${bad}개   (권장값: $($script:Presets.Status))"
if ($bad -gt 0) { exit 1 }
exit 0

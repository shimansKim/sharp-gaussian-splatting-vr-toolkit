# Quest 3 영상 인코딩 안내 (초안)

이 문서는 새 기기 설치형 앱(quest-native)에서 잘 돌아가는 영상 규격을 정리합니다.
앱은 브라우저를 거치지 않고 Quest 3의 하드웨어 디코더(Snapdragon XR2 Gen 2)로 영상을 풉니다.
그래서 이 문서의 한계 값은 브라우저 기준이 아니라 하드웨어 디코더 기준입니다.

- 상태: 초안(2026-11-13 웹 자료 확인). 앱의 진단 화면으로 실기기를 측정한 뒤 표를 확정합니다.
- 표의 "근거" 칸 표시: **공식** = Meta·Qualcomm·Google 문서, **실측보고** = 플레이어 업체·사용자의 보고, **추정** = 자료에서 미루어 본 값, **측정 예정** = 실기기 측정으로 정할 값(본문에서는 "미확인"으로도 적음).
- 출처 번호([M1] 등)는 문서 끝 "출처" 절에 있습니다.

## 이렇게 인코딩하면 됩니다

잘 모르겠으면 아래 표의 값 그대로 맞추세요(2장 "권장" 등급과 같음).
모든 형식에 공통으로 **HEVC(H.265) 8bit(yuv420p), MP4(`+faststart`), 소리 AAC 스테레오 192kbps**를 씁니다.

| 영상 종류 | 해상도 (전체) | fps | 비트레이트 | 근거 |
|---|---|---|---|---|
| 평면 2D 영화 | 2560x1440 (어려우면 1920x1080) | 원본 그대로 | 12~20Mbps | Meta "보통 1440p" 공식 [M1], 비트레이트는 추정 |
| 3D 좌우(SBS) 영화 | 5120x1440 (Full SBS) | 원본 그대로 | 25~40Mbps | 입체는 2D의 약 2배 공식 [M1], 값은 추정 |
| 3D 위아래(TB) 영화 | 2560x2880 | 원본 그대로 | 25~40Mbps | 위와 같음 |
| VR180 입체(좌우) | 7680x3840 | 60 | 60~80Mbps | 해상도 공식 [M1], 비트레이트 하한 35Mbps 공식 [M1] |
| 360 모노 | 5760x2880 | 60 | 50~60Mbps | 비트레이트 하한 50Mbps 공식 [M1], 해상도는 추정 |
| 360 입체(위아래) | 5760x5760 | 60 | 60~80Mbps | 해상도 공식 [M1] |

- 절대 넘으면 안 되는 선: **가로·세로 모두 8192 이하, 그리고 8192x4096을 60fps로 재생하는 양 이하**입니다 (공식 [M1][Q1]).
- **H.264는 4K(가로 3840~4096)까지만** 쓰세요. 8K는 HEVC나 AV1만 됩니다 (브라우저 기준 공식 [M2], 앱 기준은 측정 예정).
- **10bit·HDR은 아직 쓰지 마세요.** HDR 영상은 SDR(BT.709)로 바꿔 넣으세요 (측정 예정).
- **AV1**은 같은 화질에 파일이 약 25~30% 작지만 [R2], 앱에서 8K60이 되는지 측정 전까지는 선택지로만 둡니다.
- 원본 fps가 24·25·30이면 60으로 늘리지 마세요. 부드러워지지 않고 파일만 커집니다.
- 형식별 "안전·권장·최고" 3등급과 이유는 2장에, 변환 명령은 4장에 있습니다.

## 1. Quest 3 디코더 한계

### 1.1 화면 사양 (해상도를 정하는 기준)

| 항목 | 값 | 근거 |
|---|---|---|
| 패널 | LCD, 눈당 2064x2208 | 공식 [M3] |
| 화소 밀도 | 25 PPD(시야 1도당 화소 수, 렌즈 가운데 최고값) | 공식 [M3] |
| 시야각 | 가로 110°, 세로 96° | 공식 [M3] |
| 화면 주사율 | 72 / 80 / 90 / 120Hz | 공식 [M4] |
| 칩 | Snapdragon XR2 Gen 2 | 공식 [M3] |

가로 평균으로 따지면 2064 ÷ 110° ≈ 19 PPD입니다.
그래서 영상도 **눈 앞쪽에서 20~25 PPD**가 나오면 패널이 보여 줄 수 있는 만큼은 다 보입니다.
Meta도 VR180·360 영상에 30~60 PPD를 목표로 하되 디코더 한계에 맞춰 줄이라고 안내합니다 [M1].

### 1.2 코덱별 한계

| 항목 | H.264 (AVC) | HEVC 8bit | HEVC 10bit | AV1 |
|---|---|---|---|---|
| 하드웨어 디코드 | 됨 (공식 [Q1]) | 됨 (공식 [Q1][M1]) | 미확인. Meta가 앱용 HDR 선택 항목으로 HDR10을 적어 두어 Main10 디코딩은 될 것으로 봄 (추정 [M1][A1]) | 됨, Quest 3 이상만 (공식 [M1][M2]) |
| 최대 해상도 | 브라우저는 4K까지 (공식 [M2]). 앱에서는 미확인. 일반적인 H.264 Level 5.2 상한인 4096x2304 안팎으로 봄 (추정) | **8192x4096@60 또는 5760x5760@60** "hardware decode limit" (공식 [M1]) | 미확인 (8K60 되는지 측정 필요) | 브라우저 8K 지원 (공식 [M2]). 칩은 코덱 구분 없이 8K60 디코드 (공식 [Q1]). 앱에서 8K60 되는지는 미확인 |
| 최대 fps | 미확인 | 8K는 60fps (공식 [Q1][M1]). 4K 120fps는 미확인 | 미확인 | 8K 60fps (공식 [Q1], 코덱별 구분은 없음) |
| 비트레이트 | 상한 미확인 | 하한: 180은 35Mbps 초과, 360은 50Mbps 초과 (공식 [M1]). 상한은 공식 자료 없음. 100Mbps 이상 권장 (실측보고 [R1]) | 미확인 | HEVC보다 약 30% 적게 써도 됨 (실측보고 [R2]) |

- **8192x4096과 5760x5760은 화소 수가 거의 같습니다**(약 3,350만 화소).
  디코더 한계는 "가로·세로 최대값"과 "초당 화소 수" 두 가지로 보는 것이 맞습니다.
  가로세로 어느 쪽도 8192를 넘지 말고, 화소 수 × fps가 8192x4096x60을 넘지 않게 하세요.
- 칩이 지원하는 코덱은 AVC, HEVC, VP9, AV1입니다 [Q1].
  VP8은 Quest 3에서 하드웨어 디코드가 되지 않습니다 [M2].
  VP9는 권장하지 않습니다(이 PC에서 빠르게 만들 수단이 없고, HEVC·AV1보다 나은 점이 없음).
- **MV-HEVC**(애플 공간 동영상 방식)는 Meta가 3D 영상 1순위로 권하지만 [M1], 기기 하드웨어가 직접 푸는지는 확인되지 않았습니다.
  4XVR은 자체 소프트웨어 디코더로 1080p 8bit까지만 재생한다고 밝혔습니다 (실측보고 [R4]).
  새 앱의 첫 버전은 MV-HEVC를 다루지 않고, 좌우(SBS)·위아래(TB) 형식만 다룹니다.
- 이 PC의 NVENC는 **H.264를 가로 4096까지만 만듭니다**(5760x2880 시험 실패, 2026-11-13 확인).
  8K H.264가 필요하면 libx264(CPU)로만 만들 수 있지만, 기기에서 안 될 가능성이 높아 권하지 않습니다.

### 1.3 HDR

| 항목 | 내용 | 근거 |
|---|---|---|
| 화면 | LCD. Meta 사양표에 HDR 표시 기능이 없음 | 공식 [M3]에서 HDR 언급 없음 → 추정 |
| 앱용 HDR 형식 | 2D 영상에 HDR10, HDR10+, Dolby Vision 5·8을 "선택"으로 적어 둠 | 공식 [M1] |
| 실제 재생 | HDR 파일이 제 색으로 나오는지, 색이 바래 보이는지 | 미확인 |

권장: **HDR 영상은 SDR(BT.709)로 바꿔서** 넣으세요.
HDR이 Quest 3 LCD에서 더 좋아 보인다는 근거는 찾지 못했습니다.

### 1.4 소리

| 형식 | 상태 | 근거 |
|---|---|---|
| AAC-LC 스테레오·5.1 (MP4) | **권장.** Android가 모든 기기에 보장하는 형식 | 공식 [A1] |
| Opus (MP4·MKV·WebM) | Android 5.0 이상에서 디코드 지원 | 공식 [A1] |
| MP3 | 지원 (MP4는 Android 10 이상) | 공식 [A1] |
| AC-3·E-AC-3(돌비) | Meta가 스트리밍 앱에 돌비를 권하지만 [M1], Quest 기기에 돌비 디코더가 있는지는 미확인. 기존 웹앱에서는 AC-3 영상이 소리 없이 나왔음 | 미확인 / 저장소 기록 |
| DTS | 미확인. 기기 디코더가 없으면 앱이 FFmpeg 확장을 넣어야 함 [A2] | 미확인 |
| 공간음향(앰비소닉) | Meta XR Audio SDK는 **1차 앰비소닉(AmbiX, 4채널)만** 지원. 이 SDK는 v85에서 기능 개발을 멈춤 | 공식 [M5] |

권장: **AAC 스테레오 192kbps**로 넣으세요.
공간음향(머리를 돌리면 소리 방향이 바뀌는 것)은 앱이 지원할지 아직 정하지 않았습니다.

### 1.5 컨테이너

| 컨테이너 | 상태 | 근거 |
|---|---|---|
| **MP4** | **권장.** 앱 재생기(ExoPlayer)가 지원하고, 형식 판별용 메타데이터(st3d·sv3d)를 읽기 쉬움. `+faststart`로 만들면 PC에서 바로 재생할 때 시작이 빠름 | 공식 [A2], 저장소 기록 |
| MKV (Matroska) | ExoPlayer 지원. 영상 디코더는 MP4와 같음 | 공식 [A2] |
| WebM | ExoPlayer 지원. 안에 VP9·AV1·Opus만 들어감 | 공식 [A2] |

## 2. 형식별 권장값

공통 규칙:

- **fps**: VR180·360은 60fps를 권장합니다. Meta 권장은 48~60fps입니다 [M1].
  원본이 24·25·30fps이면 그대로 두세요(같은 장면을 복사해 60으로 늘려도 부드러워지지 않습니다).
- **비트 깊이**: 지금은 8bit(yuv420p)가 안전합니다.
  10bit는 하늘 같은 매끈한 면에서 계단 무늬가 줄지만, 실기기 측정(T10, T14) 뒤에 권장 여부를 정합니다.
- **AV1**: 같은 화질에서 HEVC보다 약 30% 적은 비트레이트로 됩니다 [R2].
  다만 앱에서 8K60이 되는지 측정(T13) 전까지는 "최고 등급의 선택지"로만 둡니다.
- **입체 비트레이트**: 좌우·위아래 입체는 같은 화질의 2D보다 약 2배가 필요합니다 [M1].

### 2.1 평면 2D (가상 스크린)

가상 스크린이 시야 가로 약 90°를 차지한다고 보고 계산했습니다(기존 웹앱 기본값).
1920 ÷ 90° ≈ 21 PPD, 2560 ÷ 90° ≈ 28 PPD입니다.
패널 최고값이 25 PPD이므로 2560x1440이면 패널을 다 씁니다.

| 등급 | 해상도 | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|
| 안전 | 1920x1080 | 원본 (24~60) | H.264 또는 HEVC | 8~12Mbps | 약 21 PPD. 어떤 경로로도 재생됨 |
| 권장 | 2560x1440 | 원본 | HEVC | 12~20Mbps | 약 28 PPD로 패널 최고값(25)을 넘음. Meta도 "보통 1440p"를 권함 [M1] |
| 최고 | 3840x2160 | 원본, 최대 60 | HEVC 또는 AV1 | 25~40Mbps | 스크린을 크게(시야 120° 이상) 놓고 볼 때만 차이가 남 |

### 2.2 3D 좌우(SBS) · 위아래(TB) 가상 스크린

눈당 해상도는 2D와 같게 보고, 좌우면 가로를, 위아래면 세로를 2배로 합니다 [M1].
Half SBS(1920x1080에 두 눈을 욱여넣은 것)는 눈당 가로가 960이라 흐립니다. 가능하면 Full SBS로 만드세요.

| 등급 | 좌우(SBS) | 위아래(TB) | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|---|
| 안전 | 3840x1080 | 1920x2160 | 원본 | H.264 또는 HEVC | 15~25Mbps | 눈당 1080p, 약 21 PPD. H.264로도 4K 안쪽 |
| 권장 | 5120x1440 | 2560x2880 | 원본 | HEVC | 25~40Mbps | 눈당 1440p로 패널 최고값을 넘음 |
| 최고 | 7680x2160 | 3840x4320 | 원본, 최대 60 | HEVC 또는 AV1 | 50~70Mbps | 눈당 4K. 디코더 한계(8192 이내) 안 |

### 2.3 VR180 입체 (좌우, 눈당 정사각형)

눈 하나가 가로 180°를 덮으므로 눈당 가로 해상도 ÷ 180 = PPD입니다.
눈당 2880은 16 PPD, 3840은 21 PPD, 4096은 23 PPD입니다.

| 등급 | 해상도 (전체) | 눈당 | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|---|
| 안전 | 5760x2880 | 2880x2880 | 60 | HEVC | 40~50Mbps | 16 PPD. 디코더 한계의 절반 정도라 여유가 큼 |
| 권장 | 7680x3840 | 3840x3840 | 60 | HEVC | 60~80Mbps | 21 PPD. Meta가 "현실적인 목표"로 든 값 [M1] |
| 최고 | 8192x4096 | 4096x4096 | 60 | HEVC (AV1이면 50~70Mbps) | 80~100Mbps | 23 PPD. 디코더 최대값 [M1] |

- H.264만 쓸 수 있으면 4096x2048(눈당 2048, 11 PPD)이 한계입니다. 흐리게 보입니다.
- VR180 모노(한 눈 그림)는 Meta가 4320x4320@60을 현실적인 목표로, 5760x5760을 최대로 듭니다 [M1].

### 2.4 360 모노 (2:1)

가로가 360°를 덮으므로 가로 해상도 ÷ 360 = PPD입니다.
3840은 11 PPD, 5760은 16 PPD, 7680은 21 PPD입니다.

| 등급 | 해상도 | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|
| 안전 | 3840x1920 | 30~60 | H.264(30fps) 또는 HEVC | 20~30Mbps | 11 PPD로 흐리지만 어디서나 재생됨 |
| 권장 | 5760x2880 | 60 | HEVC | 50Mbps | 16 PPD. Meta 하한(50Mbps 초과)에 맞춤 [M1] |
| 최고 | 7680x3840 (또는 8192x4096) | 60 | HEVC 또는 AV1 | 60~100Mbps | 21~23 PPD. Meta "현실적인 목표" 7680x3840 [M1] |

### 2.5 360 입체 (위아래, 1:1)

위아래 형식은 눈당 가로 해상도가 전체 가로와 같고, 세로는 절반입니다.

| 등급 | 해상도 | 눈당 | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|---|
| 안전 | 3840x3840 | 3840x1920 | 30~60 | HEVC | 40Mbps | 11 PPD. 화소 수가 한계의 절반 이하 |
| 권장 | 5760x5760 | 5760x2880 | 60 | HEVC | 60~80Mbps | 16 PPD. Meta "현실적인 목표"이자 디코더 최대값 [M1] |
| 최고 | 5760x5760 | 5760x2880 | 60 | HEVC 100Mbps 또는 AV1 60~70Mbps | — | 해상도는 더 올릴 수 없어 비트레이트로 화질을 올림 |

- 8192x4096 위아래(눈당 8192x2048)도 디코더 한계 안입니다.
  가로는 23 PPD로 선명하지만 세로가 11 PPD로 반밖에 안 되어 권장하지 않습니다.
- 360 좌우(4:1, 예: 8192x2048)는 흔하지 않아 표에서 뺐습니다.

## 3. 실기기 측정 계획 (앱 진단 화면용)

영상 재생기 담당은 아래 영상을 그대로 만들어 앱의 진단 화면에서 재생합니다.
측정 도구와 순서(더블클릭 bat, 결과 파일)는 [decoder-diagnostics.md](decoder-diagnostics.md)에 있습니다.
요약: `tools\diag_make_videos.bat`(만들기) → `tools\diag_push_videos.bat`(Quest에 넣기) → `tools\diag_run.bat`(재고 결과 가져오기).
영상은 모두 20초이고, 화면은 `testsrc2` 무늬에 잡음을 얹어 실제 영상처럼 압축이 어렵게 했습니다(잡음이 없으면 목표 비트레이트가 나오지 않음).
소리는 440Hz 사인파 AAC 192kbps입니다(T15만 Opus).
비트레이트는 CBR이라 파일이 목표값에 가깝게 나옵니다(2026-11-13 이 PC에서 3초 시험: T08 103Mbps, T13 64Mbps, T09 104Mbps).

### 3.1 시험 영상 목록

| 번호 | 파일 이름 | 코덱 | 해상도 | fps | 비트레이트 | 확인할 것 |
|---|---|---|---|---|---|---|
| T01 | `T01_h264_1920x1080_30_10M.mp4` | H.264 High | 1920x1080 | 30 | 10M | 기준선. 이것이 안 되면 재생기 문제 |
| T02 | `T02_h264_3840x2160_60_40M.mp4` | H.264 High | 3840x2160 | 60 | 40M | H.264 4K60 |
| T03 | `T03_h264_4096x2048_60_50M.mp4` | H.264 High | 4096x2048 | 60 | 50M | H.264 VR180 최대 후보 |
| T04 | `T04_h264_5760x2880_30_60M.mp4` | H.264 High L6.1 | 5760x2880 | 30 | 60M | H.264 4K 초과. 실패가 예상되며, 실패 방식(오류·검은 화면·소프트웨어 디코딩)을 기록 |
| T05 | `T05_hevc_3840x2160_60_30M.mp4` | HEVC Main | 3840x2160 | 60 | 30M | HEVC 기준선 |
| T06 | `T06_hevc_5760x2880_60_50M.mp4` | HEVC Main | 5760x2880 | 60 | 50M | VR180·360 안전 등급 |
| T07 | `T07_hevc_7680x3840_60_80M.mp4` | HEVC Main | 7680x3840 | 60 | 80M | VR180 권장 등급 |
| T08 | `T08_hevc_8192x4096_60_100M.mp4` | HEVC Main | 8192x4096 | 60 | 100M | 디코더 최대값 |
| T09 | `T09_hevc_5760x5760_60_100M.mp4` | HEVC Main | 5760x5760 | 60 | 100M | 360 위아래 최대값 |
| T10 | `T10_hevc10_8192x4096_60_100M.mp4` | HEVC Main10 | 8192x4096 | 60 | 100M | 10bit 8K60 |
| T11 | `T11_hevc_8192x4096_60_150M.mp4` | HEVC Main | 8192x4096 | 60 | 150M | 비트레이트 상한 |
| T12 | `T12_hevc_3840x2160_120_50M.mp4` | HEVC Main | 3840x2160 | 120 | 50M | 고fps (120Hz 화면) |
| T13 | `T13_av1_8192x4096_60_60M.mp4` | AV1 Main | 8192x4096 | 60 | 60M | AV1 8K60 |
| T14 | `T14_av1-10_5760x2880_60_40M.mp4` | AV1 Main 10bit | 5760x2880 | 60 | 40M | AV1 10bit |
| T15 | `T15_hevc_3840x1920_30_30M_opus.mkv` | HEVC Main + Opus | 3840x1920 | 30 | 30M | MKV 컨테이너와 Opus 소리 |
| T16 | `T16_hevc10-hdr10_3840x2160_60_40M.mp4` | HEVC Main10, BT.2020 + PQ | 3840x2160 | 60 | 40M | HDR10 표시(추가) |
| T17 | `T17_h264_1920x1080_30_10M_ac3.mp4` | H.264 High + AC-3 5.1 | 1920x1080 | 30 | 10M | 돌비 AC-3 소리(추가) |
| T18 | `T18_h264_1920x1080_30_10M_eac3.mp4` | H.264 High + E-AC-3 5.1 | 1920x1080 | 30 | 10M | 돌비 E-AC-3 소리(추가) |

### 3.2 진단 화면이 기록할 값

영상마다 아래 값을 기록하면 이 문서의 표를 확정할 수 있습니다.

- 고른 디코더 이름(예: `c2.qti.hevc.decoder`는 하드웨어, `c2.android.*`는 소프트웨어)
- 디코더가 밝힌 한계: `VideoCapabilities.getSupportedWidths()`·`getSupportedHeights()`, `areSizeAndRateSupported(w, h, fps)`, `getAchievableFrameRatesFor(w, h)`, 지원 프로필·레벨
- 파일을 연 뒤 첫 화면까지 걸린 시간
- 20초 재생 중 표시 프레임 수와 버린 프레임 수(ExoPlayer `DecoderCounters`의 `droppedBufferCount` 등)
- 소리가 실제로 디코딩되는지(오디오 디코더 이름, 출력 여부)
- 재생 실패 시 오류 코드와 메시지

통과 기준(초안): 하드웨어 디코더로 열리고, 20초 동안 버린 프레임이 원본 프레임의 1% 미만이면 "됨"으로 봅니다.
앱은 이 값을 모두 기록하고, 판정 세부(재생이 10초 미만만 진행하면 "안 됨", 헤드셋 화면이 꺼지면 "측정 무효")는 decoder-diagnostics.md 2.3절을 따릅니다.

### 3.3 시험 영상 만드는 명령

이 PC 환경(ffmpeg 6.1 gyan.dev essentials, RTX 4080)에서 15개 모두 실제로 만들어 확인했습니다(3초 길이 시험).
T04는 NVENC가 가로 4096을 넘는 H.264를 만들지 못하므로 libx264(CPU)를 씁니다.
`tools\diag_make_videos.bat`이 아래 명령을 그대로 실행합니다(T16~T18 포함, 이미 있는 파일은 건너뜀).
손으로 만들 때는 Windows 명령 프롬프트(cmd)에 한 줄씩 붙여 넣으면 됩니다.

```bat
set V=-f lavfi -i sine=frequency=440:sample_rate=48000 -t 20 -c:a aac -b:a 192k -movflags +faststart -y

ffmpeg -f lavfi -i "testsrc2=s=1920x1080:r=30,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v h264_nvenc -preset p4 -profile:v high -rc cbr -b:v 10M -maxrate 10M -bufsize 20M T01_h264_1920x1080_30_10M.mp4
ffmpeg -f lavfi -i "testsrc2=s=3840x2160:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v h264_nvenc -preset p4 -profile:v high -rc cbr -b:v 40M -maxrate 40M -bufsize 80M T02_h264_3840x2160_60_40M.mp4
ffmpeg -f lavfi -i "testsrc2=s=4096x2048:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v h264_nvenc -preset p4 -profile:v high -rc cbr -b:v 50M -maxrate 50M -bufsize 100M T03_h264_4096x2048_60_50M.mp4
ffmpeg -f lavfi -i "testsrc2=s=5760x2880:r=30,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v libx264 -preset veryfast -profile:v high -level 6.1 -b:v 60M -maxrate 60M -bufsize 120M T04_h264_5760x2880_30_60M.mp4
ffmpeg -f lavfi -i "testsrc2=s=3840x2160:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v hevc_nvenc -preset p4 -rc cbr -b:v 30M -maxrate 30M -bufsize 60M -tag:v hvc1 T05_hevc_3840x2160_60_30M.mp4
ffmpeg -f lavfi -i "testsrc2=s=5760x2880:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v hevc_nvenc -preset p4 -rc cbr -b:v 50M -maxrate 50M -bufsize 100M -tag:v hvc1 T06_hevc_5760x2880_60_50M.mp4
ffmpeg -f lavfi -i "testsrc2=s=7680x3840:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v hevc_nvenc -preset p4 -rc cbr -b:v 80M -maxrate 80M -bufsize 160M -tag:v hvc1 T07_hevc_7680x3840_60_80M.mp4
ffmpeg -f lavfi -i "testsrc2=s=8192x4096:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v hevc_nvenc -preset p4 -rc cbr -b:v 100M -maxrate 100M -bufsize 200M -tag:v hvc1 T08_hevc_8192x4096_60_100M.mp4
ffmpeg -f lavfi -i "testsrc2=s=5760x5760:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v hevc_nvenc -preset p4 -rc cbr -b:v 100M -maxrate 100M -bufsize 200M -tag:v hvc1 T09_hevc_5760x5760_60_100M.mp4
ffmpeg -f lavfi -i "testsrc2=s=8192x4096:r=60,noise=alls=12:allf=t+u,format=p010le" %V% -c:v hevc_nvenc -preset p4 -profile:v main10 -rc cbr -b:v 100M -maxrate 100M -bufsize 200M -tag:v hvc1 T10_hevc10_8192x4096_60_100M.mp4
ffmpeg -f lavfi -i "testsrc2=s=8192x4096:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v hevc_nvenc -preset p4 -rc cbr -b:v 150M -maxrate 150M -bufsize 300M -tag:v hvc1 T11_hevc_8192x4096_60_150M.mp4
ffmpeg -f lavfi -i "testsrc2=s=3840x2160:r=120,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v hevc_nvenc -preset p4 -rc cbr -b:v 50M -maxrate 50M -bufsize 100M -tag:v hvc1 T12_hevc_3840x2160_120_50M.mp4
ffmpeg -f lavfi -i "testsrc2=s=8192x4096:r=60,noise=alls=12:allf=t+u,format=yuv420p" %V% -c:v av1_nvenc -preset p4 -rc cbr -b:v 60M -maxrate 60M -bufsize 120M T13_av1_8192x4096_60_60M.mp4
ffmpeg -f lavfi -i "testsrc2=s=5760x2880:r=60,noise=alls=12:allf=t+u,format=p010le" %V% -c:v av1_nvenc -preset p4 -rc cbr -b:v 40M -maxrate 40M -bufsize 80M T14_av1-10_5760x2880_60_40M.mp4
ffmpeg -f lavfi -i "testsrc2=s=3840x1920:r=30,noise=alls=12:allf=t+u,format=yuv420p" -f lavfi -i sine=frequency=440:sample_rate=48000 -t 20 -c:v hevc_nvenc -preset p4 -rc cbr -b:v 30M -maxrate 30M -bufsize 60M -c:a libopus -b:a 160k -y T15_hevc_3840x1920_30_30M_opus.mkv
```

- 15개를 모두 만들면 약 2.3GB이고, 이 PC에서 8K 한 개에 1분 안팎 걸립니다(잡음 생성이 대부분).
- `set V=...` 줄은 소리·길이·출력 공통 옵션입니다. 명령 프롬프트 창을 닫으면 다시 실행해야 합니다.

## 4. 내 영상 변환 명령 (초안)

### 4.1 이 PC에서 쓸 수 있는 인코더 (2026-11-13 확인)

- ffmpeg: `C:\Program Files\ffmpeg\bin\ffmpeg.exe`, 버전 6.1 (gyan.dev essentials 빌드)
- 그래픽카드: NVIDIA GeForce RTX 4080 (16GB, 드라이버 621.01)
- 실제로 인코딩해 보고 된 것:

| 인코더 | 종류 | 메모 |
|---|---|---|
| `hevc_nvenc` | HEVC, 그래픽카드 | 8bit·10bit, 8192x4096까지 확인. **기본으로 씀** |
| `av1_nvenc` | AV1, 그래픽카드 | 8bit·10bit, 8192x4096까지 확인 |
| `h264_nvenc` | H.264, 그래픽카드 | **가로 4096까지만** 됨 |
| `libx265` | HEVC, CPU | 느리지만 화질이 조금 좋음. 그래픽카드 인코딩이 실패할 때 대신 씀 |
| `libx264` | H.264, CPU | 4K 이하 평면 영상용 |
| `libaom-av1` | AV1, CPU | 매우 느림. 쓰지 않음 |

- `libsvtav1`(빠른 CPU AV1)은 이 빌드에 없습니다. AV1은 `av1_nvenc`로 만듭니다.
- `ffmpeg -encoders` 목록에는 `hevc_amf`·`hevc_qsv`(AMD·인텔용)도 있지만 이 PC 그래픽카드와 맞지 않아 쓰지 않습니다.

### 4.2 변환 명령 예시

모두 이 PC에서 실제로 돌려 확인했습니다.
`입력.mp4`와 `출력.mp4`만 바꿔 쓰세요.
fps는 원본을 그대로 둡니다.

VR180 입체 권장 등급 (HEVC, 7680x3840):

```bat
ffmpeg -i 입력.mp4 -map 0:v:0 -map 0:a:0? -vf "scale=7680:3840:flags=lanczos" -c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 22 -b:v 0 -maxrate 100M -bufsize 200M -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 192k -movflags +faststart 출력_180_LR.mp4
```

같은 영상을 AV1로 (파일이 약 25% 작아짐, 기기에서 되는지는 T13 측정 뒤 확정):

```bat
ffmpeg -i 입력.mp4 -map 0:v:0 -map 0:a:0? -vf "scale=7680:3840:flags=lanczos" -c:v av1_nvenc -preset p6 -tune hq -rc vbr -cq 30 -b:v 0 -maxrate 70M -bufsize 140M -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart 출력_180_LR.mp4
```

그래픽카드 인코딩이 안 될 때 (CPU, libx265):

```bat
ffmpeg -i 입력.mp4 -map 0:v:0 -map 0:a:0? -vf "scale=7680:3840:flags=lanczos" -c:v libx265 -preset medium -crf 22 -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 192k -movflags +faststart 출력_180_LR.mp4
```

평면 2D 안전 등급 (H.264, 1080p 이하로 줄임):

```bat
ffmpeg -i 입력.mp4 -map 0:v:0 -map 0:a:0? -vf "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2" -c:v h264_nvenc -preset p6 -rc vbr -cq 21 -b:v 0 -maxrate 20M -bufsize 40M -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart 출력.mp4
```

- 다른 형식은 `scale=` 값을 2장 표의 해상도로, `-maxrate`를 표의 비트레이트 윗값으로 바꿉니다.
- `-cq`(품질 값)는 작을수록 화질이 좋고 파일이 큽니다. 20~24 사이를 권합니다.
- `-tag:v hvc1`은 HEVC를 여러 재생기가 알아보게 하는 표시입니다. 빼지 마세요.
- 파일 이름에 형식 힌트(`_180_LR`, `_360_TB`, `_360`, `_SBS`, `_TB`)를 붙이면 앱이 형식을 맞히기 쉽습니다.
  기존 웹앱 규칙이며, 새 앱의 판별 규칙은 실기기 측정 뒤 함께 확정합니다.
- 저장소에 이미 있는 변환 bat과의 관계:
  - `make_quest_app_video.bat`(기존 웹앱용)은 `hevc_nvenc -cq 24 -maxrate 80M`, 최대 8192x4096으로 바꿉니다. 이 문서의 VR180·360 권장 등급과 거의 같아서 지금 새 앱용으로 써도 됩니다.
  - `resize_for_quest3.bat`은 PC 스트리밍 플레이어(4XVR·4XLink)용이라 최대 8192x4320까지 둡니다. 세로가 4096을 넘으면 기기 디코더 한계를 넘을 수 있으니 새 앱용으로는 쓰지 마세요.
  - 등급을 골라 바로 변환하는 새 앱용 bat은 실기기 측정 뒤 `quest-native/` 안에 따로 만듭니다.

### 4.3 인코더 라이선스 메모

- 내 PC에서 ffmpeg로 내 영상을 변환하는 일은 **앱을 배포하는 라이선스와 관계가 없습니다.**
  변환은 내 PC 안에서 끝나고, 앱에는 인코더가 들어가지 않습니다.
- 앱은 영상을 풀 때 Quest 3에 들어 있는 디코더를 씁니다.
  이 디코더의 HEVC·AV1 특허 문제는 기기를 만든 Meta·Qualcomm 몫이고, 앱이 따로 사용료를 낼 일이 아닙니다.
- 이 PC의 ffmpeg 빌드는 GPL 조건입니다(`--enable-gpl`, libx264·libx265 포함).
  GPL 의무는 ffmpeg 프로그램을 **남에게 나눠 줄 때** 생깁니다. 내 PC에서 쓰기만 하면 의무가 없습니다.
  저장소의 bat 파일은 각자 설치한 ffmpeg를 부르기만 하고 ffmpeg를 담아 나눠 주지 않으므로 지금 방식이면 문제가 없습니다.
- NVENC는 NVIDIA 그래픽카드 드라이버에 들어 있는 기능이라 따로 라이선스가 필요 없습니다.
- AV1은 사용료가 없는 코덱입니다.
- 이 메모는 일반적인 설명이고 법률 자문이 아닙니다. 앱에 ffmpeg를 넣어 배포하게 되면 그때 다시 검토합니다.

## 5. 아직 모르는 것 (측정 예정)

| 질문 | 시험 영상 |
|---|---|
| 앱(MediaCodec)에서 H.264 최대 해상도는? 4K를 넘으면 어떻게 실패하는가? | T02, T03, T04 |
| HEVC 10bit가 8K60까지 되는가? | T10 |
| 비트레이트 상한은? 150Mbps에서 끊기는가? | T08, T11 |
| 4K 120fps가 되는가? | T12 |
| AV1 8K60, AV1 10bit가 앱에서 되는가? | T13, T14 |
| MKV·Opus가 문제없이 재생되는가? | T15 |
| HDR 파일은 어떻게 보이는가? | T16 |
| 돌비(AC-3·E-AC-3) 소리가 기기에서 나오는가? | T17, T18 |

## 출처

2026-11-13에 웹에서 직접 확인했습니다.

- [M1] Meta, Media requirements and guidelines for streaming apps (공식, 안드로이드 앱 대상): https://developers.meta.com/vr/documentation/android-apps/media-requirements/
- [M2] Meta, Browser Video Support (공식, 브라우저 대상): https://developers.meta.com/vr/documentation/web/browser-video/
- [M3] Meta, Compare devices (공식, 기기 사양): https://developers.meta.com/vr/resources/compare-devices/
- [M4] Meta, Device-specific optimization (Quest 3 vs Quest 2) (공식): https://developers.meta.com/vr/resources/device-optimization-comparison/
- [M5] Meta, Meta XR Audio SDK Features (공식): https://developers.meta.com/vr/documentation/unity/meta-xr-audio-sdk-features/
- [Q1] Qualcomm, Snapdragon XR2 Gen 2 Platform Product Brief (공식, 칩 제조사). Video 항목: "8K60 decode, 8K30 encode, low-latency slice-based decoding AVC, HEVC, VP9, and AV1 decode": https://docs.qualcomm.com/doc/87-73689-1/87-73689-1_REV_A_Snapdragon_XR2_Gen_2_Platform_Product_Brief.pdf
- [A1] Android Developers, Supported media formats (공식, Android 플랫폼): https://developer.android.com/media/platform/supported-formats
- [A2] Android Developers, ExoPlayer supported formats (공식, 앱 재생기): https://developer.android.com/media/media3/exoplayer/supported-formats
- [R1] DeoVR, Guide: Uploading VR content for Meta Quest 3 and Quest 3S (실측보고, 플레이어 업체): https://deovr.com/blog/202-guide-uploading-vr-content-for-meta-quest-3-and-quest-3s
- [R2] Bitmovin, Encoding VR and 360 Immersive Video for Meta Quest Headsets (실측보고, 인코딩 업체): https://bitmovin.com/blog/best-encoding-settings-meta-vr-360-headsets/
- [R3] Road to VR, Quest Now Natively Supports Spatial Video (보도): https://roadtovr.com/quest-spatial-video-support-vision-pro/
- [R4] 4XVR 공식 계정, MV-HEVC 소프트웨어 디코딩 설명 (실측보고): https://x.com/4XVR_Player/status/1862311619247943682
- 저장소 기록: `make_quest_app_video.bat`, `resize_for_quest3.bat`, `quest-app/src/viewers/media/README.md`, `quest-app/src/viewers/media/decode-check.js`, `notes/quest-app-design.md` (기존 웹앱에서 겪은 H.264 8K·AC-3 소리 문제)

# Quest 3 영상 인코딩 안내

이 문서는 새 기기 설치형 앱(quest-native)에서 잘 돌아가는 영상 규격을 정리합니다.
앱은 브라우저를 거치지 않고 Quest 3의 하드웨어 디코더(Snapdragon XR2 Gen 2)로 영상을 풉니다.
그래서 이 문서의 한계 값은 브라우저 기준이 아니라 하드웨어 디코더 기준입니다.

- 상태: **확정**(2026-11-14 Quest 3 실기기 디코더 진단, 18개 시험 모두 "됨"). 측정 조건과 한계는 5장에 있습니다.
  시험 영상은 20초씩이고 헤드셋을 책상에 둔 채 쟀습니다. 오래 볼 때(발열)는 아직 재지 않았습니다.
- 표의 "근거" 칸 표시: **실측 Tnn** = Quest 3에서 앱의 진단으로 잰 시험 번호(3장 목록, 괄호 안은 버린 프레임 비율), **공식** = Meta·Qualcomm·Google 문서, **실측보고** = 플레이어 업체·사용자의 보고, **추정** = 자료에서 미루어 본 값, **미확인** = 아직 재지 않은 것.
- 출처 번호([M1] 등)는 문서 끝 "출처" 절에 있습니다.

## 이렇게 인코딩하면 됩니다

잘 모르겠으면 아래 표의 값 그대로 맞추세요(2장 "권장" 등급과 같음).
모든 형식에 공통으로 **HEVC(H.265) 8bit(yuv420p), MP4(`+faststart`), 소리 AAC 스테레오 192kbps**를 씁니다.

| 영상 종류 | 해상도 (전체) | fps | 비트레이트 | 근거 |
|---|---|---|---|---|
| 평면 2D 영화 | 2560x1440 (어려우면 1920x1080) | 원본 그대로 | 12~20Mbps | Meta "보통 1440p" 공식 [M1]. 더 큰 4K60 30M이 버림 0 (실측 T05) |
| 3D 좌우(SBS) 영화 | 5120x1440 (Full SBS) | 원본 그대로 | 25~40Mbps | 입체는 2D의 약 2배 공식 [M1]. 더 큰 5760x2880@60 50M이 버림 0 (실측 T06) |
| 3D 위아래(TB) 영화 | 2560x2880 | 원본 그대로 | 25~40Mbps | 위와 같음 (실측 T06) |
| VR180 입체(좌우) | 7680x3840 | 60 | 60~80Mbps | 해상도 공식 [M1]. 80M 버림 1.00%로 기준 경계 (실측 T07, 5장 참고) |
| 360 모노 | 5760x2880 | 60 | 50~60Mbps | 비트레이트 하한 50Mbps 공식 [M1]. 50M 버림 0 (실측 T06) |
| 360 입체(위아래) | 5760x5760 | 60 | 60~80Mbps | 해상도 공식 [M1]. 100M 버림 0.50% (실측 T09) |

- 절대 넘으면 안 되는 선: **가로·세로 모두 8192 이하, 그리고 8192x4096을 60fps로 재생하는 양 이하**입니다 (공식 [M1][Q1]).
  Quest 3에서 8192x4096@60 HEVC 100M·150M은 20초 동안 버림 0이었습니다 (실측 T08, T11).
  다만 디코더가 스스로 밝힌 성능(7680x4320@60, 초당 약 19.9억 화소)을 1% 남짓 넘는 값이라, 이것이 최고 등급이고 그 위는 없습니다.
- **H.264도 앱에서는 4K를 넘어 재생됩니다**(5760x2880@30 버림 0, 실측 T04). 그래도 같은 화질에 파일이 크고 이 PC의 NVENC가 가로 4096까지만 만들므로 **HEVC를 쓰세요.**
- **10bit·HDR은 풀리긴 하지만 아직 권하지 않습니다.** HEVC 10bit 8K60, HDR10 4K60 모두 버림 0이었습니다(실측 T10, T16). 그러나 색이 제대로 보이는지는 사람 눈으로 확인하지 않았습니다. HDR 영상은 SDR(BT.709)로 바꿔 넣으세요.
- **AV1**은 8192x4096@60 60M과 10bit 5760x2880@60이 버림 0이었습니다(실측 T13, T14). 같은 화질에 파일이 약 25~30% 작습니다 [R2]. 지금 변환 bat은 HEVC만 만듭니다(AV1은 4.2절 명령으로 직접).
- 원본 fps가 24·25·30이면 60으로 늘리지 마세요. 부드러워지지 않고 파일만 커집니다.
- 형식별 "안전·권장·최고" 3등급과 이유는 2장에, 변환 명령은 4장에 있습니다.

### 이 bat에 끌어다 놓으세요

`quest-native\tools\encode\quest_encode.bat` 위에 영상 파일을 끌어다 놓으면(여러 개 가능) 위 표대로 바꿔 줍니다.

1. 등급을 묻습니다. 그냥 Enter를 누르면 **권장**입니다.
2. 인코더를 묻습니다. 그냥 Enter를 누르면 **품질 우선**(느림)입니다. NVIDIA 그래픽카드가 있으면 **빠르게**를 고를 수 있습니다.
3. 형식(평면·3D·VR180·360)은 파일 이름과 화면 비율로 스스로 알아냅니다. 확실하지 않을 때만 번호로 고르라고 묻습니다.
4. 결과는 원본 옆에 `<이름>_q3_<형식>.mp4`로 생깁니다(예: `여행_q3_vr180_sbs.mp4`). 원본은 그대로 둡니다.
   이미 권장 범위 안인 파일은 "변환이 필요 없습니다"라고 알리고 건너뜁니다.

bat의 값은 2026-11-14 Quest 3 실기기 측정으로 **확정**했습니다(`tools\encode\quest_presets.csv`, 줄마다 근거 시험 번호). 값을 바꿀 때는 그 파일 하나만 고치면 됩니다(4.2절).

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
| 하드웨어 디코드 | 됨, `c2.qti.avc.decoder` (실측 T01~T04) | 됨, `c2.qti.hevc.decoder` (실측 T05~T09, T11, T12) | 됨, 같은 디코더 (실측 T10, T16) | 됨, `c2.qti.av1.decoder` (실측 T13, T14) |
| 최대 해상도 | 디코더 신고 8192x8192 (실측 목록). 5760x2880@30 버림 0 (실측 T04). 브라우저는 4K까지 (공식 [M2]) | **8192x4096@60 또는 5760x5760@60** (공식 [M1]). 8192x4096@60 버림 0 (실측 T08), 5760x5760@60 버림 0.50% (실측 T09) | 8192x4096@60 버림 0 (실측 T10) | 8192x4096@60 버림 0 (실측 T13). 10bit 5760x2880@60 버림 0 (실측 T14) |
| 최대 fps | 4096x2048@60 버림 0 (실측 T03) | 8K는 60fps (공식 [Q1][M1]). 4K 120fps 버림 0 (실측 T12) | 8K 60fps (실측 T10) | 8K 60fps (실측 T13) |
| 비트레이트 | 디코더 신고 상한 220Mbps (실측 목록). 60M까지 잼 (실측 T04) | 디코더 신고 상한 160Mbps. 150M 버림 0 (실측 T11). 하한: 180은 35Mbps 초과, 360은 50Mbps 초과 (공식 [M1]) | 100M 버림 0 (실측 T10) | 디코더 신고 상한 100Mbps. 60M 버림 0 (실측 T13). HEVC보다 약 30% 적게 써도 됨 (실측보고 [R2]) |
| 디코더가 밝힌 성능 | 7680x4320@60, 8192x4320@48 | 같음 | 같음 | 같음 |

- 디코더가 밝힌 성능 지점(PerformancePoint)은 네 코덱 모두 **7680x4320@60**과 **8192x4320@48**입니다(실측 목록).
  초당 화소 수로 바꾸면 약 19.9억이고, 5760x5760@60이 정확히 이 값, 8192x4096@60은 이보다 약 1.1% 많습니다.
  그래서 디코더의 자체 판단(`areSizeAndRateSupported`)은 8192x4096@60을 "아니요"라고 답했지만, 실제 20초 재생에서는 버림 0이었습니다(T08, T10, T11, T13).
  오래 볼 때도 그런지는 아직 모릅니다(5장).

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
  libx264(CPU)로 만든 5760x2880@30 H.264는 기기에서 풀렸지만(T04), 느리고 파일이 커서 권하지 않습니다. HEVC를 쓰세요.

### 1.3 HDR

| 항목 | 내용 | 근거 |
|---|---|---|
| 화면 | LCD. Meta 사양표에 HDR 표시 기능이 없음. 다만 기기는 화면 HDR 형식으로 DolbyVision·HDR10·HLG를 알림 | 공식 [M3], 실측 목록 |
| 앱용 HDR 형식 | 2D 영상에 HDR10, HDR10+, Dolby Vision 5·8을 "선택"으로 적어 둠 | 공식 [M1] |
| 디코딩 | HDR10(PQ) 4K60 40M이 하드웨어로 버림 0. HEVC 디코더가 HDR10·HDR10+, 별도 Dolby Vision 디코더가 있음 | 실측 T16, 실측 목록 |
| 실제 색 | HDR 파일이 제 색으로 나오는지, 색이 바래 보이는지 | 미확인(사람 눈 확인 필요) |

권장: **HDR 영상은 SDR(BT.709)로 바꿔서** 넣으세요.
HDR이 풀리는 것은 확인했지만(T16), Quest 3 LCD에서 제 색으로 보이는지나 더 좋아 보인다는 근거는 아직 없습니다.

### 1.4 소리

| 형식 | 상태 | 근거 |
|---|---|---|
| AAC-LC 스테레오·5.1 (MP4) | **권장.** Android가 모든 기기에 보장하는 형식. 소리 남 | 공식 [A1], 실측 T01~T14 |
| Opus (MP4·MKV·WebM) | 소리 남(MKV) | 공식 [A1], 실측 T15 |
| MP3 | 지원 (MP4는 Android 10 이상) | 공식 [A1] |
| AC-3·E-AC-3(돌비) | **새 앱에서는 소리 남.** 기기에 `c2.dolby.eac3.decoder`가 있음(AC-3·E-AC-3·E-AC-3 JOC). 기존 웹앱에서 AC-3가 소리 없이 나온 것은 브라우저 문제 | 실측 T17, T18, 실측 목록 |
| DTS | 기기 디코더 목록에 없음. 소리가 나지 않으므로 AAC로 바꾸세요(변환 bat이 바꿈). 앱에서 풀려면 FFmpeg 확장이 필요 [A2] | 실측 목록 |
| 공간음향(앰비소닉) | Meta XR Audio SDK는 **1차 앰비소닉(AmbiX, 4채널)만** 지원. 이 SDK는 v85에서 기능 개발을 멈춤 | 공식 [M5] |

권장: **AAC 스테레오 192kbps**로 넣으세요. 변환 bat은 AAC 2채널이 아니면(돌비 5.1 포함) AAC 스테레오로 바꿉니다.
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
- **비트 깊이**: 권장은 8bit(yuv420p)입니다.
  10bit도 8K60까지 하드웨어로 풀립니다(실측 T10, T14). 하늘 같은 매끈한 면에서 계단 무늬가 줄지만,
  화면 색이 맞는지는 사람 눈으로 아직 보지 않아서 bat은 8bit로 만듭니다.
- **AV1**: 같은 화질에서 HEVC보다 약 30% 적은 비트레이트로 됩니다 [R2].
  8192x4096@60 60M이 버림 0이었습니다(실측 T13). 최고 등급의 선택지로 쓸 수 있습니다. 디코더 신고 상한이 100Mbps이니 그 아래로 만드세요.
- **입체 비트레이트**: 좌우·위아래 입체는 같은 화질의 2D보다 약 2배가 필요합니다 [M1].

### 2.1 평면 2D (가상 스크린)

가상 스크린이 시야 가로 약 90°를 차지한다고 보고 계산했습니다(기존 웹앱 기본값).
1920 ÷ 90° ≈ 21 PPD, 2560 ÷ 90° ≈ 28 PPD입니다.
패널 최고값이 25 PPD이므로 2560x1440이면 패널을 다 씁니다.

| 등급 | 해상도 | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|
| 안전 | 1920x1080 | 원본 (24~60) | H.264 또는 HEVC | 8~12Mbps | 약 21 PPD. 어떤 경로로도 재생됨 (실측 T01 버림 0) |
| 권장 | 2560x1440 | 원본 | HEVC | 12~20Mbps | 약 28 PPD로 패널 최고값(25)을 넘음. Meta도 "보통 1440p"를 권함 [M1]. 더 큰 T05가 버림 0 |
| 최고 | 3840x2160 | 원본, 최대 60 | HEVC 또는 AV1 | 25~40Mbps | 스크린을 크게(시야 120° 이상) 놓고 볼 때만 차이가 남 (실측 T05 4K60 30M, T12 4K120 50M 버림 0) |

- 4K 120fps도 풀립니다(T12). 다만 bat은 지금처럼 60fps를 넘으면 60으로 낮춥니다(120fps 원본은 드물고, 긴 재생은 재지 않았음).

### 2.2 3D 좌우(SBS) · 위아래(TB) 가상 스크린

눈당 해상도는 2D와 같게 보고, 좌우면 가로를, 위아래면 세로를 2배로 합니다 [M1].
Half SBS(1920x1080에 두 눈을 욱여넣은 것)는 눈당 가로가 960이라 흐립니다. 가능하면 Full SBS로 만드세요.

| 등급 | 좌우(SBS) | 위아래(TB) | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|---|
| 안전 | 3840x1080 | 1920x2160 | 원본 | H.264 또는 HEVC | 15~25Mbps | 눈당 1080p, 약 21 PPD. H.264로도 4K 안쪽 (T05보다 작음) |
| 권장 | 5120x1440 | 2560x2880 | 원본 | HEVC | 25~40Mbps | 눈당 1440p로 패널 최고값을 넘음 (T06보다 작음) |
| 최고 | 7680x2160 | 3840x4320 | 원본, 최대 60 | HEVC 또는 AV1 | 50~70Mbps | 눈당 4K. 디코더 한계(8192 이내) 안. 화소 수가 T06과 비슷하고 T08의 절반 (둘 다 버림 0) |

### 2.3 VR180 입체 (좌우, 눈당 정사각형)

눈 하나가 가로 180°를 덮으므로 눈당 가로 해상도 ÷ 180 = PPD입니다.
눈당 2880은 16 PPD, 3840은 21 PPD, 4096은 23 PPD입니다.

| 등급 | 해상도 (전체) | 눈당 | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|---|
| 안전 | 5760x2880 | 2880x2880 | 60 | HEVC | 40~50Mbps | 16 PPD. 디코더 한계의 절반 정도라 여유가 큼 (실측 T06 50M 버림 0) |
| 권장 | 7680x3840 | 3840x3840 | 60 | HEVC | 60~80Mbps | 21 PPD. Meta가 "현실적인 목표"로 든 값 [M1] (실측 T07 80M 버림 1.00%, 기준 경계. 5장) |
| 최고 | 8192x4096 | 4096x4096 | 60 | HEVC (AV1이면 50~70Mbps) | 80~100Mbps | 23 PPD. 디코더 최대값 [M1] (실측 T08 100M·T11 150M 버림 0, AV1 T13 60M 버림 0) |

- **VR180 최고 등급(8192x4096@60 HEVC 100M)이 이 문서 전체의 최고 권장 등급**입니다. 근거는 T08(그리고 같은 크기의 T10·T11·T13)입니다.
- H.264로도 5760x2880@30까지 풀렸지만(T04), 8K60은 재지 않았습니다. VR180은 HEVC로 만드세요.
- VR180 모노(한 눈 그림)는 Meta가 4320x4320@60을 현실적인 목표로, 5760x5760을 최대로 듭니다 [M1].

### 2.4 360 모노 (2:1)

가로가 360°를 덮으므로 가로 해상도 ÷ 360 = PPD입니다.
3840은 11 PPD, 5760은 16 PPD, 7680은 21 PPD입니다.

| 등급 | 해상도 | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|
| 안전 | 3840x1920 | 30~60 | H.264(30fps) 또는 HEVC | 20~30Mbps | 11 PPD로 흐리지만 어디서나 재생됨 (실측 T15 30fps 버림 0) |
| 권장 | 5760x2880 | 60 | HEVC | 50~60Mbps | 16 PPD. Meta 하한(50Mbps 초과)에 맞춤 [M1] (실측 T06 50M 버림 0) |
| 최고 | 7680x3840 (또는 8192x4096) | 60 | HEVC 또는 AV1 | 60~100Mbps | 21~23 PPD. Meta "현실적인 목표" 7680x3840 [M1] (실측 T07 1.00%, T08 0) |

### 2.5 360 입체 (위아래, 1:1)

위아래 형식은 눈당 가로 해상도가 전체 가로와 같고, 세로는 절반입니다.

| 등급 | 해상도 | 눈당 | fps | 코덱 | 비트레이트 | 이유 |
|---|---|---|---|---|---|---|
| 안전 | 3840x3840 | 3840x1920 | 30~60 | HEVC | 40Mbps | 11 PPD. 화소 수가 한계의 절반 이하 (T09보다 작음) |
| 권장 | 5760x5760 | 5760x2880 | 60 | HEVC | 60~80Mbps | 16 PPD. Meta "현실적인 목표"이자 디코더 최대값 [M1] (실측 T09 100M 버림 0.50%) |
| 최고 | 5760x5760 | 5760x2880 | 60 | HEVC 100Mbps 또는 AV1 60~70Mbps | — | 해상도는 더 올릴 수 없어 비트레이트로 화질을 올림 (실측 T09 100M 버림 0.50%. AV1 5760x5760은 미측정) |

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

통과 기준: 하드웨어 디코더로 열리고, 20초 동안 버린 프레임이 원본 프레임의 1% 미만이면 "됨"으로 봅니다(2026-11-14 측정에 쓴 기준).
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

## 4. 내 영상 변환 (bat)

### 4.1 이 PC에서 쓸 수 있는 인코더 (2026-11-13 확인)

- ffmpeg: `C:\Program Files\ffmpeg\bin\ffmpeg.exe`, 버전 6.1 (gyan.dev essentials 빌드)
- 그래픽카드: NVIDIA GeForce RTX 4080 (16GB, 드라이버 621.01)
- 실제로 인코딩해 보고 된 것:

| 인코더 | 종류 | 메모 |
|---|---|---|
| `hevc_nvenc` | HEVC, 그래픽카드 | 8bit·10bit, 8192x4096까지 확인. bat의 "빠르게" |
| `av1_nvenc` | AV1, 그래픽카드 | 8bit·10bit, 8192x4096까지 확인 |
| `h264_nvenc` | H.264, 그래픽카드 | **가로 4096까지만** 됨 |
| `libx265` | HEVC, CPU | 느리지만 같은 크기에서 화질이 좋음. bat의 기본("품질 우선") |
| `libx264` | H.264, CPU | 4K 이하 평면 영상용 |
| `libaom-av1` | AV1, CPU | 매우 느림. 쓰지 않음 |

- `libsvtav1`(빠른 CPU AV1)은 이 빌드에 없습니다. AV1은 `av1_nvenc`로 만듭니다.
- `ffmpeg -encoders` 목록에는 `hevc_amf`·`hevc_qsv`(AMD·인텔용)도 있지만 이 PC 그래픽카드와 맞지 않아 쓰지 않습니다.

### 4.2 변환 bat (`tools\encode\quest_encode.bat`)

| 파일 | 하는 일 |
|---|---|
| `tools\encode\quest_encode.bat` | 영상 파일을 끌어다 놓는 곳. 아래 ps1을 실행합니다 |
| `tools\encode\quest_encode.ps1` | 판별·변환 본체(PowerShell, Windows 기본 포함) |
| `tools\encode\quest_presets.csv` | **권장값 표(단 하나)**. 형식 묶음 × 등급마다 최대 해상도·fps·비트레이트·품질 값 |
| `tools\encode\tests\test_quest_encode.bat` | 합성 영상으로 bat을 시험합니다(4.3절) |

**bat이 하는 일**

1. ffmpeg를 찾습니다. 순서는 `C:\Program Files\ffmpeg\bin\ffmpeg.exe`, 그다음 PATH의 `ffmpeg`입니다(저장소의 다른 bat과 같음).
   없으면 설치 방법(`winget install Gyan.FFmpeg` 또는 gyan.dev 압축 파일)을 알려 주고 멈춥니다.
2. 형식을 판별합니다. 앱의 `video/FormatDetect.java`와 같은 규칙이고, 순서는 MP4 공간 메타데이터, 파일 이름 힌트, 화면 비율입니다.
   비율로만 짐작한 경우에는 번호로 고르게 합니다.
3. 형식에 맞는 줄을 표에서 고릅니다.

   | 형식 | 표의 묶음(group) |
   |---|---|
   | 2D, Half SBS, 가로가 넓은 Half TB | `flat` |
   | Full SBS 스크린 | `sbs3d` |
   | Full TB 스크린 | `tb3d` |
   | VR180 좌우 / VR180 모노 | `vr180` / `vr180mono` |
   | 360 모노 / 위아래 / 좌우 | `mono360` / `tb360` / `sbs360` |

   `vr180mono`·`sbs360` 줄은 2장 표에 없는 형식입니다. 화소 수가 같거나 더 큰 시험(T09, T08)으로 갈음했습니다.
4. 이미 권장 범위 안인지 봅니다. 조건은 HEVC Main 8bit, yuv420p, SDR, 상자 안 해상도, fps·비트레이트 상한 이하, `hvc1` 표시, AAC 2채널 이하(또는 소리 없음), MP4 faststart입니다.
   모두 맞으면 건너뜁니다. 그래도 다시 만들려면 시작할 때 "강제"에 `y`를 누르거나 `quest_encode.bat /force 파일...`로 실행합니다.
5. 변환합니다.
   - 해상도는 상자 안으로만 줄이고 키우지 않습니다. 줄일 때는 4의 배수로 맞춰 좌우·위아래 반쪽이 어긋나지 않게 합니다.
   - fps는 원본 그대로 둡니다. 상한(60)보다 높을 때만 60으로 낮춥니다.
   - HDR(PQ·HLG)은 SDR BT.709로 톤매핑하고(zscale + hable), 10bit는 8bit로 바꿉니다.
   - 소리는 AAC 스테레오 192kbps입니다. 원본이 이미 AAC 2채널 이하면 그대로 복사합니다.
   - MP4 `+faststart`와 `-tag:v hvc1`로 저장합니다. `.part.mp4`로 만든 뒤 성공했을 때만 이름을 바꿉니다.

bat이 실제로 부르는 명령은 다음과 같습니다(VR180 좌우 권장 등급, 8K 원본 예).

```bat
rem 품질 우선(기본): libx265, crf와 VBV 상한(표의 crf, max_mbps)
ffmpeg -i 입력.mp4 -map 0:v:0 -map 0:a:0? -vf "scale=7680:3840:flags=lanczos,format=yuv420p" -map_metadata -1 -map_chapters -1 -c:v libx265 -preset medium -profile:v main -crf 21 -x265-params "vbv-maxrate=80000:vbv-bufsize=160000" -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 192k -ac 2 -movflags +faststart 출력_q3_vr180_sbs.mp4

rem 빠르게: hevc_nvenc, cq와 최대 비트레이트(표의 cq, max_mbps)
ffmpeg -i 입력.mp4 -map 0:v:0 -map 0:a:0? -vf "scale=7680:3840:flags=lanczos,format=yuv420p" -c:v hevc_nvenc -preset p6 -tune hq -profile:v main -rc vbr -cq 23 -b:v 0 -maxrate 80000k -bufsize 160000k -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 192k -ac 2 -movflags +faststart 출력_q3_vr180_sbs.mp4
```

- `crf`·`cq`는 작을수록 화질이 좋고 파일이 큽니다.
- `-tag:v hvc1`은 HEVC를 여러 재생기가 알아보게 하는 표시입니다. 빼지 마세요.
- AV1은 앱에서 8K60까지 됩니다(T13·T14). bat에는 아직 넣지 않았습니다. AV1로 만들려면 아래처럼 직접 실행합니다(그래픽카드 `av1_nvenc`, VR180 최고 등급 예).

```bat
ffmpeg -i 입력.mp4 -map 0:v:0 -map 0:a:0? -vf "scale=8192:4096:flags=lanczos,format=yuv420p" -c:v av1_nvenc -preset p6 -tune hq -rc vbr -cq 30 -b:v 0 -maxrate 70000k -bufsize 140000k -c:a aac -b:a 192k -ac 2 -movflags +faststart 출력_q3_vr180_sbs.mp4
```
- 출력 이름의 형식 표시(`_2d`, `_fsbs`, `_hsbs`, `_tb`, `_vr180_sbs`, `_vr180_mono`, `_360_mono`, `_360_tb`, `_360_sbs`)는 앱이 같은 형식으로 다시 알아보는 이름입니다(시험에서 확인).
  원래 이름에 있던 형식 단어(`360`, `sbs` 등)는 빼고 붙입니다.
  예외: 가로세로 2:1인 평면 2D 영상은 앱이 360으로 볼 수 있습니다. 앱에서 형식을 한 번 바꾸면 기억합니다.
- 저장소 루트의 기존 bat과의 관계:
  - `make_quest_app_video.bat`(기존 웹앱용)은 형식과 상관없이 최대 8192x4096 HEVC로 바꿉니다. 새 앱에는 이 bat 대신 `quest_encode.bat`을 쓰세요.
  - `resize_for_quest3.bat`은 PC 스트리밍 플레이어(4XVR·4XLink)용이라 최대 8192x4320까지 둡니다. 세로가 4096을 넘으면 기기 디코더 한계를 넘을 수 있으니 새 앱용으로는 쓰지 마세요.

**값 고치는 법**: `quest_presets.csv`의 숫자와 `basis`(근거 시험 번호)를 고칩니다. 이 문서 맨 위 표와 2장 표도 같이 고칩니다.
`#status=` 줄이 "확정"으로 시작하면 bat은 권장값 상태를 보통 글자로, 아니면 노란 경고로 보여 줍니다.
2026-11-14 측정 결과로 바꾼 것은 `#status=`와 `basis`뿐이고 숫자는 그대로입니다(측정이 초안 값을 모두 통과함).

### 4.3 bat 시험

`tools\encode\tests\test_quest_encode.bat`을 실행하면 1~3분 동안 다음을 확인합니다(2026-11-14 이 PC에서 115개 항목 모두 통과, 확정 표로 다시 실행해도 115개 모두 통과).

- 한글·공백이 든 폴더에 짧은 합성 영상 7개(ffmpeg `testsrc2`)를 만들어, bat에 한 번에 끌어다 놓은 것처럼 넘깁니다.
  - 평면 1080p30(5.1 소리)
  - 4K24(→ 1440p로 줄이고 fps는 그대로)
  - VR180 4096x2048@60(키우지 않음)
  - 360 위아래 HDR 10bit MKV(→ SDR 8bit MP4)
  - Full SBS 3840x1080@25
  - 120fps(→ 60)
  - 이미 권장 범위인 HEVC(→ 건너뜀)
- 결과마다 ffprobe로 코덱·프로필, `hvc1`, yuv420p, 해상도, 권장 상자 안인지, fps, 비트레이트 상한, SDR, faststart, AAC 스테레오를 봅니다. 출력 이름으로 같은 형식이 다시 판별되는지도 봅니다.
- 강제 변환, 안전 등급(4K → 1080p, 이름이 겹치면 `_2`), NVENC(있을 때만), 없는 파일(종료 코드 1), 형식 판별 10가지를 확인합니다.

### 4.4 인코더 라이선스 메모

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

## 5. 실기기 측정 결과 (2026-11-14)

### 5.1 측정 조건

- 기기: Quest 3 (eureka), Android 14, 런타임 210.108.0. 앱 0.2.0.
- 2026-11-14 10:07~10:13, `diag_make_videos.bat` 기본 시험 영상(각 20초), 18개를 이어서 재생.
- 헤드셋은 사람이 쓰지 않고 책상에 둔 상태(근접 센서 끔), USB 연결. 화면은 고정 시점.
- 결과 원본: 진단 결과 파일 `quest3-decoder-diag.md`·`.json`(사령관 보관).

### 5.2 결과 (18개 모두 "됨", 모두 하드웨어 디코더)

| 번호 | 내용 | 버림 | 최대 연속 버림 | 소리 |
|---|---|---|---|---|
| T01 | H.264 1920x1080@30 10M | 0 | 0 | AAC |
| T02 | H.264 3840x2160@60 40M | 0 | 0 | AAC |
| T03 | H.264 4096x2048@60 50M | 0 | 0 | AAC |
| T04 | H.264 5760x2880@30 60M | 0 | 0 | AAC |
| T05 | HEVC 3840x2160@60 30M | 0 | 0 | AAC |
| T06 | HEVC 5760x2880@60 50M | 0 | 0 | AAC |
| T07 | HEVC 7680x3840@60 80M | **12 (1.00%)** | 6 | AAC |
| T08 | HEVC 8192x4096@60 100M | 0 | 0 | AAC |
| T09 | HEVC 5760x5760@60 100M | **6 (0.50%)** | 5 | AAC |
| T10 | HEVC 10bit 8192x4096@60 100M | 0 | 0 | AAC |
| T11 | HEVC 8192x4096@60 150M | 0 | 0 | AAC |
| T12 | HEVC 3840x2160@120 50M | 0 | 0 | AAC |
| T13 | AV1 8192x4096@60 60M | 0 | 0 | AAC |
| T14 | AV1 10bit 5760x2880@60 40M | 0 | 0 | AAC |
| T15 | HEVC 3840x1920@30 30M (MKV) | 0 | 0 | Opus |
| T16 | HEVC 10bit HDR10 3840x2160@60 40M | 0 | 0 | AAC |
| T17 | H.264 1080p30 + AC-3 5.1 | 0 | 0 | AC-3 (돌비 디코더) |
| T18 | H.264 1080p30 + E-AC-3 5.1 | 0 | 0 | E-AC-3 (돌비 디코더) |

디코더 목록에서 확인한 값: HEVC·H.264·AV1 모두 최대 8192x8192, 성능 지점 7680x4320@60·8192x4320@48, 신고 비트레이트 상한 HEVC 160M·H.264 220M·AV1 100M.

### 5.3 해석 (보수적으로)

- **T07(1.00%)은 통과 기준 "1% 미만"의 경계입니다.** 실제 값은 12 ÷ 1200.84 = 0.9993%라 "됨"이 됐고, 표에는 반올림해 1.00%로 나왔습니다.
- 더 큰 T08(8192x4096, 100M)이 버림 0이고 T07보다 작은 T06이 0인 것으로 보아, T07의 버림은 디코더 한계보다는 **한때의 끊김**일 가능성이 큽니다.
  12프레임 가운데 최대 연속이 6이라 적어도 두 번에 나뉘어 버려졌습니다.
  다만 결과 파일에는 버린 때(시작 구간인지)가 남지 않아 확인하지 못했습니다.
- 그래서 VR180 권장 등급(7680x3840@60 80M)은 그대로 두되 **"경계, 재측정 권장"**으로 표시했습니다.
- 8192x4096@60은 디코더가 스스로 밝힌 성능보다 약 1.1% 많고 자체 판단도 "아니요"였지만 20초 동안 버림 0이었습니다(T08, T10, T11, T13). **긴 재생에서 열이 쌓이면 달라질 수 있습니다.**
- 모든 시험이 20초·미착용·고정 시점입니다. 사람이 쓰고 고개를 돌리며 오래 보는 경우는 아직 재지 않았습니다.

### 5.4 아직 모르는 것

| 질문 | 어떻게 확인할까 |
|---|---|
| 8K60을 몇 분 동안 볼 때 열이 쌓여도 버림이 없나? | 긴 시험 영상 재측정(아래) |
| T07의 버림이 시작 구간 한때인가, 계속되는 것인가? | 긴 재측정 + 버린 때 기록(재생기 담당에 제안) |
| 10bit·HDR 영상의 색이 Quest 3 화면에서 맞게 보이나? | 사람이 직접 보고 확인 |
| 사람이 쓰고 고개를 돌릴 때(화면 합성 부담 증가)도 같은가? | 착용 상태로 재측정 |
| PC에서 Wi-Fi 스트리밍할 때 8K 80~100M이 끊기지 않나? | pc-source.md 5절 |
| AV1 5760x5760, H.264 8K60 | 재지 않음(권하지도 않음) |

### 5.5 재측정 제안 (긴 시험 영상)

진단은 이제 영상 길이를 따라 끝까지 잽니다(최대 30분). 일부 시험만 만들고 넣고 잴 수 있고,
결과에 초 단위 버림(시작 구간인지 꾸준한지)과 시험 앞뒤 열 상태가 남습니다(`decoder-diagnostics.md` 1.1·2.4절).

1. T07·T08을 3분 영상으로 만들어 넣습니다(`diag-videos-180s` 폴더, 20초 영상과 따로).

   ```bat
   quest-native	ools\diag_make_videos.bat T07 T08 180 nopause
   quest-native	ools\diag_push_videos.bat T07 T08 180 nopause
   ```

2. 열이 쌓인 상태를 보려면 쉬지 않고 두 번 잽니다(한 번에 약 6분 연속 재생).

   ```bat
   quest-native	ools\diag_run.bat T07 T08 x2 nopause
   ```

3. 가능하면 사람이 헤드셋을 쓴 채로 한 번 더 잽니다.

판단: 두 번째 실행에서도 T08(최고 등급)의 버림이 1% 미만이면 표를 그대로 둡니다.
T07이 다시 1% 근처면 VR180 권장 비트레이트를 60M으로 낮추는 것을 검토합니다.

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

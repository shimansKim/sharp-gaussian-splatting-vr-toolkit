# 기기 디코더 진단

이 앱 안에서 Quest 3의 실제 영상 디코더 한계를 재는 기능이다.
결과로 `encoding-guide.md`의 권장 표를 확정한다.
담당: video-dev.

## 1. 사람이 할 일(더블클릭 순서)

준비: PC에 Quest를 USB로 연결하고, 헤드셋 안에서 "USB 디버깅 허용"을 누른다.

| 순서 | 더블클릭 | 하는 일 | 걸리는 시간 |
|---|---|---|---|
| 1 | `quest-native\build.bat` | 앱을 만든다 | 1분 안팎 |
| 2 | `quest-native\install.bat` | Quest에 설치하고 켠다 | 30초 |
| 3 | `quest-native\tools\diag_make_videos.bat` | 시험 영상 T01~T18을 PC에 만든다(약 2.7GB, 이미 있으면 건너뜀) | 20분 안팎 |
| 4 | `quest-native\tools\diag_push_videos.bat` | 시험 영상을 Quest 앱 전용 폴더로 보낸다 | 5분 안팎 |
| 5 | `quest-native\tools\diag_run.bat` | 앱을 진단 모드로 켜서 18개를 차례로 재생해 잰다. 끝나면 결과를 PC로 가져온다 | 10분 안팎 |
| 6 | 결과 보기 | `quest-native\tools\diag-results\<날짜-시각>\latest.md` | — |

- 3~5를 한 번에 하려면 `quest-native\tools\diag_all.bat`을 더블클릭한다.
- 긴 재생·열 측정, 일부 시험만 재기는 1.1절.
- 5번 동안에는 **헤드셋을 쓰고 있는 것이 가장 확실하다.**
  헤드셋을 벗으면 화면이 꺼지고, 앱은 그 시험을 "측정 무효"로 두었다가 다시 쓰면 한 번 더 잰다.
  bat이 근접 센서를 잠시 끄는 명령(`prox_close`)을 보내지만, 기기·OS 버전에 따라 듣지 않을 수 있다(확인 못 함).
- 결과만 다시 가져오려면 `tools\diag_pull_results.bat`.
- 앱 안에서 직접 하려면: 목록 패널의 [설정] → [진단] → [디코더 진단] 페이지(계약 16절).
  [전체 실행], [시험] 고르기 + [이 시험 실행], [멈춤], [코덱 목록 저장]이 있고, 결과 줄이 아래에 나온다.
  실행 중에는 영상 HUD에 진행 상황과 [멈춤]이 보이고, 끝나면 이 페이지가 다시 열린다.

### 1.1 긴 재생·일부 시험·연속 측정

네 bat 모두 인수를 순서와 상관없이 받는다. 빈 인수(`""`)는 무시하고, `nopause`는 어느 자리에 있어도 알아본다.

| 인수 | 뜻 | 받는 bat |
|---|---|---|
| `T07 T08`(또는 `T07,T08`) | 이 시험만 만들기·넣기·재기. 없으면 전부 | 넷 다 |
| 숫자(예: `180`) | 만들기: 영상 길이(초, 기본 20). 넣기: 그 길이의 기본 폴더를 고름. 재기: 시험마다 첫 화면 뒤 이만큼만 잼(없으면 영상 끝까지) | 넷 다 |
| `x2`, `x3` | 재기를 쉬지 않고 두세 번 이어서(열이 쌓인 상태 보기) | `diag_run`, `diag_all` |
| 폴더 경로 | 만들 곳·보낼 영상이 있는 곳 | `diag_make_videos`, `diag_push_videos` |
| `nopause` | 끝에 멈추지 않음(다른 bat·원격 실행용) | 넷 다 |

- 길이가 20초가 아니면 기본 폴더는 `%LOCALAPPDATA%\sharp-quest-native\diag-videos-<초>s`다. 20초 영상과 섞이지 않는다.
- 환경 변수 `QN_DIAG_SECONDS`(길이), `QN_DIAG_TESTS`(예: `T07 T08`)도 같은 뜻으로 읽는다.
- 앱은 영상 길이를 따라 끝까지 잰다(최대 30분). 그래서 180초 영상을 넣으면 180초를 잰다.
- 같은 이름의 영상을 다시 넣으면 기기의 것을 바꾼다. 180초 T07을 넣은 뒤 전체를 재면 T07만 180초로 잰다.

예: 최고 권장 등급(T08)과 VR180 권장(T07)을 3분 영상으로, 열이 쌓이도록 두 번 이어서 잰다.

```
quest-native\tools\diag_make_videos.bat T07 T08 180 nopause
quest-native\tools\diag_push_videos.bat T07 T08 180 nopause
quest-native\tools\diag_run.bat T07 T08 x2 nopause
```

`diag_all.bat T07 T08 180 x2`도 같다. 앱에 직접 주는 주소는
`qn-diag://run-all/tests=T07,T08/seconds=180/decoder-diagnostics.qndiag`(seconds는 생략 가능)다.

## 2. 앱이 재는 것

### 2.1 디코더 목록(MediaCodecList)

디코더마다 다음을 적는다.
대상 MIME: video/avc, hevc, vp9, av01, dolby-vision과 audio/mp4a-latm, opus, ac3, eac3, eac3-joc, ac4.

- 이름, 정식 이름, 하드웨어 여부(`isHardwareAccelerated`), 소프트웨어 전용 여부, 제조사 코덱 여부
- 프로필·레벨 목록(예: `Main10 / MainTierLevel61`)
- 가로·세로·fps·비트레이트 범위, 정렬 단위, 동시 인스턴스 수
- 성능 지점(`getSupportedPerformancePoints`, 예: `8192x4320@60`)
- 10bit 여부(Main10·High10·Profile2 프로필 또는 P010 색 형식), HDR 프로필(HDR10, HDR10+, Dolby Vision)
- 시험 영상마다 디코더 자체 판단: `areSizeAndRateSupported(w, h, fps)`, `getAchievableFrameRatesFor(w, h)`
- 기기: 모델, Android 버전, OS 빌드, 화면 모드(해상도·주사율), 화면 HDR 종류

### 2.2 시험 영상 재생

시험 영상마다 실제 재생 경로(Media3 → Surface 스왑체인 → 컴포지터 레이어)로 처음부터 끝까지 한 번 재생한다.
반복·배속은 끄고(1배), 저장된 사용자 설정은 바꾸지 않는다.
잴 길이는 영상 길이(또는 주소의 seconds)를 따른다. 영상 길이 + 25초가 지나도 안 끝나면 멈춘다.

| 값 | 출처 |
|---|---|
| 고른 디코더 이름 | Media3 `onVideoDecoderInitialized` |
| 하드웨어 여부 | 2.1 목록에서 이름으로 찾음. 못 찾으면 이름으로 추정(`c2.android.*`, `OMX.google.*`는 소프트웨어) |
| 첫 화면까지 시간 | 파일 열기 → `onRenderedFirstFrame` |
| 표시·버린·건너뛴 프레임, 최대 연속 버림 | Media3 `DecoderCounters` |
| 재생된 길이 | 끝났을 때의 재생 위치 |
| 버린 때 | 첫 화면 뒤 1초마다 버린·표시한 프레임 수(0.1초마다 읽은 누적값의 차이) |
| 열 | 시험 앞뒤의 기기 열 상태(`PowerManager.getCurrentThermalStatus`, 0 없음~6 종료)와 배터리 온도 |
| 소리 | 오디오 디코더 이름, 출력 버퍼 수(0보다 크면 소리가 나옴) |
| 오류 | Media3 `PlaybackException` 코드 이름과 메시지 |

### 2.3 판정

`encoding-guide.md` 3.2절 기준을 그대로 쓴다.

| 판정 | 조건 |
|---|---|
| 됨(PASS) | 하드웨어 디코더, 재생이 잴 길이의 절반 이상 진행, 버린 프레임 < 원본 프레임의 1% |
| 안 됨(FAIL) | 소프트웨어 디코더, 화면에 나온 프레임 0, 재생이 잴 길이의 절반 미만만 진행(너무 느림), 또는 버림 ≥ 1% |
| 오류(ERROR) | 재생 오류, 20초 안에 첫 화면이 안 나옴, 재생기가 파일을 열지 않음 |
| 측정 무효(INVALID) | 측정 중 헤드셋 화면이 꺼짐, 사람이 멈춤, 다른 파일이 열림 |

- 원본 프레임 = 파일의 fps(없으면 시험 목록의 fps) × 재생된 초.
- 소리는 판정에 넣지 않고 따로 "남 / 안 남"으로 적는다(T15 Opus, T17 AC-3, T18 E-AC-3 확인용).
- 버림(%)은 소수 셋째 자리에서 **버린다**(반올림하지 않음). 0.9993%는 "0.999"로 나오고, 통과인데 "1.00"으로 보이는 일이 없다.
  0.5% 이상으로 통과하면 "경계"를 붙인다.

### 2.4 버린 때 읽기

md 표의 "버린 때" 칸과 JSON `drops`는 버림이 언제 났는지를 다섯 가지로 나눈다.

| 표시 | 뜻 | 짐작되는 원인 |
|---|---|---|
| 없음 | 버림 0 | — |
| 시작 구간만 | 버림이 모두 첫 5초 안 | 디코더·버퍼 준비. 긴 영상에서는 비율이 작아진다 |
| 꾸준함 | 5초 뒤에도 잰 초의 10% 이상(3초 이상)에서 버림 | 디코더가 이 해상도·비트레이트를 못 따라감 |
| 후반에 몰림 | 5초 뒤 버림의 2/3 이상이 마지막 1/3 구간에 | 열로 성능이 떨어짐(열 상태 칸과 같이 본다) |
| 드문드문 | 그 밖 | 다른 일(시스템 작업, 저장소 읽기)이 끼어듦 |

md의 "버린 때와 열" 표는 10초 구간별 버림, 처음·마지막 10초의 평균 표시 fps, 열 상태·배터리 온도 전→후를 보여 준다.

## 3. 결과 파일

Quest: `/sdcard/Android/data/com.sharp.questnative/files/diagnostics/`

| 파일 | 내용 |
|---|---|
| `decoder-diag-<날짜-시각>.json` | 기계가 읽는 전체 결과(스키마 `qn-decoder-diag/2`) |
| `decoder-diag-<날짜-시각>.md` | 사람이 읽는 요약(표) |
| `latest.json`, `latest.md` | 마지막 결과의 복사본 |
| `last-run.txt` | 전체(또는 고른 시험) 실행이 끝나면 `done <날짜-시각> <됨 수>/<시험 수>`. `diag_run.bat`이 끝을 알아내는 데 쓴다 |
| `tests/` | 시험 영상(`diag_push_videos.bat`이 넣음, PC로 가져오지 않음) |

JSON 구조:

```
{ schema, app, createdAt, passRule, borderPercent,
  device: { manufacturer, model, device, android, build, displayModes, displayHdr },
  codecs: [ { name, canonicalName, mime, hardware, softwareOnly, vendor, aliases, profileLevels,
              widths, heights, widthAlignment, heightAlignment, frameRates, bitrates,
              performancePoints, tenBit, hdr, maxInstances, audioInfo,
              testChecks: { T08: { sizeAndRate, achievableFps } } } ],
  tests: [ { spec: { id, file, codec, profile, width, height, fps, mbps, tenBit, hdr, audio, purpose },
             measurement: { decoderName, hardware, videoMime, videoCodecs, width, height, fps, firstFrameMs,
                            playedSeconds, renderedFrames, droppedFrames, skippedFrames,
                            maxConsecutiveDropped, audioDecoderName, audioOutputBuffers, error, invalidReason,
                            targetSeconds, droppedPerSecond[], renderedPerSecond[],
                            thermalStart, thermalEnd, batteryTempStartC, batteryTempEndC },
             result: { verdict, label, reason, expectedFrames, droppedPercent, droppedPercentText, audioOk },
             drops: { pattern, startSeconds, droppedInStart, droppedAfterStart, secondsWithDrops,
                      firstDropSecond, lastDropSecond, per10s } } ] }
```

`/2`는 `/1`에 measurement의 길이·초별·열 값과 `drops`, `droppedPercentText`를 더한 것이다(지운 값 없음).
`droppedPerSecond[0]`은 첫 화면이 나온 뒤 첫 1초다. 첫 화면 전에 버린 것도 여기에 넣는다.

## 4. 시험 영상

`encoding-guide.md` 3.1절의 T01~T15에 다음 3개를 더했다(가이드가 "목록에 아직 없음"이라 한 항목).

| 번호 | 파일 | 확인할 것 |
|---|---|---|
| T16 | `T16_hevc10-hdr10_3840x2160_60_40M.mp4` | HEVC Main10, BT.2020 + PQ(HDR10) 표시. 마스터링 메타데이터는 없음 |
| T17 | `T17_h264_1920x1080_30_10M_ac3.mp4` | 돌비 AC-3 5.1 소리 |
| T18 | `T18_h264_1920x1080_30_10M_eac3.mp4` | 돌비 E-AC-3 5.1 소리 |

- 파일 이름 규칙 `Tnn_코덱_가로x세로_fps_비트레이트M….mp4|mkv`을 지키면 표에 없는 시험 영상도 `tests/`에 넣어 잴 수 있다.
- 시험 영상 생성은 각자 설치한 ffmpeg를 부른다. 앱에는 ffmpeg가 들어가지 않는다(`licenses.md` 3절).

## 5. 확인한 것과 못 한 것(2026-11-14)

- 확인: `build.bat` 빌드, JVM 단위 시험(판정 규칙, 시험 목록·파일 이름, JSON·Markdown 형식),
  `diag_make_videos.bat`로 18개를 1초 길이로 만들어 ffprobe로 코덱·해상도·fps·10bit·HDR·소리 채널 확인,
  Quest가 없을 때 push·run·pull bat이 오류 안내를 내고 끝나는 것.
- `prox_close` 효과는 기기·OS 버전에 따라 확인이 필요하다.
- 2026-11-14 실기기: 사령관이 Quest 3에서 18개 모두 "됨"을 확인했다(`encoding-guide.md` 5장).
- 2026-11-14 실기기 긴 측정: `diag_run.bat T07 T08 x2`(3분 영상, 약 12분 연속)으로 초 단위 버림·열 상태·배터리 온도가 기록되는 것을 확인했다(`encoding-guide.md` 5.3절).
  이때 `diag_pull_results.bat`이 대상 폴더를 `"...\"`로 넘겨 adb가 따옴표 붙은 폴더를 찾다 실패했다. 끝의 `\`를 빼서 고쳤다.

### 5.1 긴 재생 보완(2026-11-14)

- 확인(PC): `build.bat` 빌드, JVM 단위 시험(초별 버림 세기·다섯 가지 분류, 주소 인수, 버림 % 버림 표시와 경계,
  긴 영상의 진행 판정, JSON·md 새 칸), 가짜 adb·ffmpeg로 bat 인수 처리(`""` 첫 인수, 쉼표 목록, 길이별 폴더,
  표준 입력을 막은 셸에서 기다리기, `x2` 두 번 실행, 주소 만들기).
- 3분 8K 영상 만들기의 실제 소요 시간은 확인하지 않았다.

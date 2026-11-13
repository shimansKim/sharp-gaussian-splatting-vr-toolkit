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
- 5번 동안에는 **헤드셋을 쓰고 있는 것이 가장 확실하다.**
  헤드셋을 벗으면 화면이 꺼지고, 앱은 그 시험을 "측정 무효"로 두었다가 다시 쓰면 한 번 더 잰다.
  bat이 근접 센서를 잠시 끄는 명령(`prox_close`)을 보내지만, 기기·OS 버전에 따라 듣지 않을 수 있다(확인 못 함).
- 결과만 다시 가져오려면 `tools\diag_pull_results.bat`.
- 앱 안에서 직접 하려면: 목록 패널의 [디코더 진단] → `decoder-diagnostics.qndiag`를 연다.
  HUD에서 [전체 실행], [시험] 고르기 + [이 시험 실행], [멈춤], [코덱 목록 저장]을 쓴다.
  결과 줄은 HUD의 [진단] 화면에 나온다.

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

| 값 | 출처 |
|---|---|
| 고른 디코더 이름 | Media3 `onVideoDecoderInitialized` |
| 하드웨어 여부 | 2.1 목록에서 이름으로 찾음. 못 찾으면 이름으로 추정(`c2.android.*`, `OMX.google.*`는 소프트웨어) |
| 첫 화면까지 시간 | 파일 열기 → `onRenderedFirstFrame` |
| 표시·버린·건너뛴 프레임, 최대 연속 버림 | Media3 `DecoderCounters` |
| 재생된 길이 | 끝났을 때의 재생 위치 |
| 소리 | 오디오 디코더 이름, 출력 버퍼 수(0보다 크면 소리가 나옴) |
| 오류 | Media3 `PlaybackException` 코드 이름과 메시지 |

### 2.3 판정

`encoding-guide.md` 3.2절 기준을 그대로 쓴다.

| 판정 | 조건 |
|---|---|
| 됨(PASS) | 하드웨어 디코더, 재생이 10초 이상 진행, 버린 프레임 < 원본 프레임의 1% |
| 안 됨(FAIL) | 소프트웨어 디코더, 화면에 나온 프레임 0, 재생이 10초 미만만 진행(너무 느림), 또는 버림 ≥ 1% |
| 오류(ERROR) | 재생 오류, 20초 안에 첫 화면이 안 나옴, 재생기가 파일을 열지 않음 |
| 측정 무효(INVALID) | 측정 중 헤드셋 화면이 꺼짐, 사람이 멈춤, 다른 파일이 열림 |

- 원본 프레임 = 파일의 fps(없으면 시험 목록의 fps) × 재생된 초.
- 소리는 판정에 넣지 않고 따로 "남 / 안 남"으로 적는다(T15 Opus, T17 AC-3, T18 E-AC-3 확인용).

## 3. 결과 파일

Quest: `/sdcard/Android/data/com.sharp.questnative/files/diagnostics/`

| 파일 | 내용 |
|---|---|
| `decoder-diag-<날짜-시각>.json` | 기계가 읽는 전체 결과(스키마 `qn-decoder-diag/1`) |
| `decoder-diag-<날짜-시각>.md` | 사람이 읽는 요약(표) |
| `latest.json`, `latest.md` | 마지막 결과의 복사본 |
| `last-run.txt` | 전체 실행이 끝나면 `done <날짜-시각> <됨 수>/<시험 수>`. `diag_run.bat`이 끝을 알아내는 데 쓴다 |
| `tests/` | 시험 영상(`diag_push_videos.bat`이 넣음, PC로 가져오지 않음) |

JSON 구조:

```
{ schema, app, createdAt, passRule,
  device: { manufacturer, model, device, android, build, displayModes, displayHdr },
  codecs: [ { name, canonicalName, mime, hardware, softwareOnly, vendor, aliases, profileLevels,
              widths, heights, widthAlignment, heightAlignment, frameRates, bitrates,
              performancePoints, tenBit, hdr, maxInstances, audioInfo,
              testChecks: { T08: { sizeAndRate, achievableFps } } } ],
  tests: [ { spec: { id, file, codec, profile, width, height, fps, mbps, tenBit, hdr, audio, purpose },
             measurement: { decoderName, hardware, videoMime, videoCodecs, width, height, fps, firstFrameMs,
                            playedSeconds, renderedFrames, droppedFrames, skippedFrames,
                            maxConsecutiveDropped, audioDecoderName, audioOutputBuffers, error, invalidReason },
             result: { verdict, label, reason, expectedFrames, droppedPercent, audioOk } } ] }
```

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
- 못 함(실기기 없음): 앱 안 진단 실행 전체, MediaCodecList 실제 값, adb push·pull 경로, `prox_close` 효과, 결과 파일 생성.

# 영상 재생기(video 모듈)

담당: video-dev. 계약은 `module-contract.md`, 권장 인코딩은 `encoding-guide.md`를 따른다.

## 1. 구조

```
Media3 ExoPlayer(Java, 스레드 "qn-video")
  └ 디코딩 → Android Surface ← XR_KHR_android_surface_swapchain 스왑체인(C++)
                                    └ SubmitLayers: quad(평면) / equirect2(180·360) → 컴포지터
```

- 영상 프레임은 앱의 Vulkan 렌더러를 거치지 않는다. 디코더가 Surface에 넣은 버퍼를 컴포지터가 바로 샘플링한다.
- 스왑체인 크기는 영상 해상도와 같다. 형식이 알려진 뒤(`nativeOnFormat`)에 만들고, 그다음 Surface를 플레이어에 붙여 재생을 시작한다.
- 파일을 닫으면 Java가 플레이어를 놓은 뒤(`nativeOnReleased`)에야 스왑체인을 없앤다. 디코더가 없어진 Surface에 쓰는 일이 없게 하기 위해서다.
- 파일마다 세대 번호(`gen`)를 붙여, 앞 파일의 늦은 콜백을 버린다.

| 파일 | 내용 |
|---|---|
| `cpp/video/video_module.cpp` | 뷰어(Open/Close, 입력, 레이어), JNI 콜백 |
| `cpp/video/video_layers.h` | 형식 → 레이어 계산(눈별 영역, 스크린 크기, equirect2 각도) |
| `java/.../video/VideoPlayer.java` | Media3 플레이어, 명령, 상태·통계 보고 |
| `java/.../video/FormatDetect.java` | 형식 자동 판별(quest-app `format-detect.js` 이식) |
| `java/.../video/SpatialMeta.java` | Media3 `Format.stereoMode`·`projectionData`(st3d/sv3d) 해석 |
| `java/.../video/VideoHud.java` | HUD 모델(`HudProvider`, 계약 14절) |
| `java/.../video/VideoState.java` | HUD·진단이 읽는 상태 스냅숏 |
| `java/.../video/VideoPrefs.java` | 파일별 형식 기억, 음량·배속·반복·줌 기억 |
| `app/src/test/.../video/*Test.java` | JVM 단위 시험(19건) |

## 2. 형식과 레이어

| 형식(`layoutHint` 이름) | 레이어 | 눈별 영역 |
|---|---|---|
| `mono2d` | quad 1장(두 눈) | 전체 |
| `sbsScreenFull`, `sbsScreenHalf` | quad 2장(왼눈·오른눈) | 왼쪽 절반 / 오른쪽 절반 |
| `tbScreen` | quad 2장 | 위 절반(왼눈) / 아래 절반(오른눈) |
| `mono180`, `mono360` | equirect2 1장 | 전체 |
| `sbs180`, `sbs360` | equirect2 2장 | 왼쪽 / 오른쪽 절반 |
| `tb360` | equirect2 2장 | 위(왼눈) / 아래(오른눈) |

- 스크린: 3m 앞, 너비 6m × 줌(기본 0.6, 0.15~3), 높이는 한 눈 화면 비율로 정한다(quest-app과 같은 값).
- 구: equirect2 `radius = 0`(무한 구), 180은 가로 π, 360은 가로 2π, 세로 ±π/2.
- 순서: 평면은 `kOrderContent`(100), 구는 `kOrderBackground`(-100).
- 판별 우선순위: 보관함 형식(`layoutHint`) > 파일별 기억 > MP4 공간 메타데이터(st3d/sv3d) > 이름 힌트 > 화면 비율.
  비율로만 추정했으면(확신 "low") 프레임 한 장을 작게 떠서 좌우·위아래가 닮았는지 본다(`sniffStereo`).

## 3. 상태·명령 API

### HUD(ui 모듈이 그림)

`VideoHud`가 계약 14.5절의 id로 모델을 낸다.

| 화면 | id |
|---|---|
| main | `seek`(드래그 중엔 미리보기만, 놓으면 이동), `back10`, `play`, `fwd10`, `speed`(0.5~2, 0.25 단위), `volume`(0~1) |
| more | `layout`(9종 choice), `mute`, `loop`, `swapEyes`, `recenter`, `zoomOut`, `zoomIn` |
| diagnostics | 디코더 이름, 코덱, 표시·버린·건너뛴 프레임, 최대 연속 버림, 버퍼 길이, 형식 판단 근거 |

- 영상이 끝나면(반복 꺼짐) `qn::ui::NotifyMediaEnded()`를 부른다.
- 형식을 비율로만 추정했으면 `status`에 안내 한 줄을 넣고 토스트를 띄운다.

### 진단 수치(다음 미션용)

- Java: `VideoPlayer.state`(`VideoState`) — `decoderName`, `renderedFrames`, `droppedFrames`, `skippedFrames`, `maxConsecutiveDropped`, `mime`, `codecs`, `width`, `height`, `fps`, `bufferedMs`.
  200ms마다 Media3 `DecoderCounters`에서 채운다.
- C++: `Playback` 구조체(같은 값)와 logcat. 디코더가 정해지면 `[video] decoder …`, 프레임을 버리면 `[video] dropped frames N (+k)`가 남는다.

## 4. 임시 조작(ui HUD가 그려지기 전까지)

A·B·X·Y는 ui 버튼 배정 표 몫이라 쓰지 않는다.

| 입력 | 동작 |
|---|---|
| 오른쪽 트리거 | 재생·일시정지(ui HUD가 생기면 "HUD 보이기·숨기기"로 바꿀 예정) |
| 오른쪽 스틱 좌우 | 10초 뒤로·앞으로(누르고 있으면 0.4초마다 반복) |
| 오른쪽 스틱 상하 | 스크린 크게·작게(기억됨) |
| 오른쪽 스틱 누름(R3) | 다음 형식(직접 고르면 이 파일에 기억) |
| 왼쪽 스틱 좌우 | 장면 돌리기 |
| 왼쪽 스틱 상하 | 음량 |
| 왼쪽 스틱 누름(L3) | 정면 맞춤(지금 보는 방향으로) |
| 왼쪽 트리거 | 배속 바꾸기(0.5 → 0.75 → 1 → 1.25 → 1.5 → 2) |
| 오른쪽 그립 | 눈 바꿈 |
| 왼쪽 그립 | 소리 켬·끔 |

- 헤드셋을 벗거나 앱이 가려지면 일시정지한다.

## 5. 임시 열기 경로(파일 탐색 UI 전까지)

앱 전용 폴더의 첫 영상(이름순)을 앱이 켜질 때 자동으로 연다. 저장소 권한이 필요 없다.

```
adb shell mkdir -p /sdcard/Android/data/com.sharp.questnative/files/Movies
adb push T01.mp4 /sdcard/Android/data/com.sharp.questnative/files/Movies/
install.bat
adb logcat -s QuestNative
```

## 6. 시험

- 빌드: `build.bat`
- 단위 시험: `gradlew :app:testReleaseUnitTest` — FormatDetect 13건(quest-app `format-detect.test.js`와 같은 사례), SpatialMeta 6건.

## 7. 실기기에서 볼 것(아직 못 함)

1. logcat에 `[video] started (surface swapchain yes)`가 나오는가.
2. `mono2d` 영상이 앞 3m 스크린에 나오고 소리가 나는가. 오른쪽 트리거로 멈추고 다시 재생되는가.
3. `sbs180` 시험 영상: 앞쪽 반구에 입체로 보이는가. 정면이 영상 가운데인가(equirect2 기준 방향 확인).
4. `tb360`: 왼눈이 위 절반인가. 반대면 `video_layers.h`의 `EyeRect` TB 순서를 바꾼다(또는 이미지 원점이 아래인지 확인).
5. 스크린 형식(`sbsScreenFull`·`tbScreen`)의 화면 비율이 맞는가.
6. 오른쪽 스틱 좌우 탐색, 왼쪽 트리거 배속, 왼쪽 스틱 음량이 듣는가.
7. encoding-guide 최고 등급 시험 영상에서 `[video] dropped frames` 줄이 늘지 않는가. 디코더 이름이 하드웨어(`c2.qti…`)인가.
8. 파일을 닫거나 앱을 내릴 때 크래시나 `abandoned` 오류가 없는가.

## 8. 알려진 한계

- 360·180 확대(줌)는 없다. 스크린 줌만 있다.
- 열기 전 디코드 가능 여부 확인(quest-app `decode-check.js`)은 없다. 재생 오류가 나면 HUD·토스트로 알린다.
- Matroska의 투영 정보(ProjectionPrivate)는 해석하지 않는다. MKV는 st3d 입체 표기·이름·비율로 판별한다.
- 회전 메타데이터(90°/270°)는 반영하지 않는다.
- `XR_FB_android_surface_swapchain_create`(보호 콘텐츠·동기 플래그)는 요청만 하고 아직 쓰지 않는다.

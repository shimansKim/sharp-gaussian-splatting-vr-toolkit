# PLY 실측 절차(splat)

Quest 3에서 SHARP PLY(1,179,648 splat)가 얼마나 빨리 그려지는지 잰다.
측정은 두 단계다.
1단계는 앱 없이 GPU 시간만 잰다.
2단계는 실측판 앱을 VR로 띄워 fps와 GPU 시간을 함께 잰다.
두 단계 모두 bat에 PLY 파일 하나를 끌어다 놓으면 된다.
splat 수 단계(118만·60만·40만·20만)는 앱과 도구가 같은 파일에서 직접 줄이므로 표본 파일을 따로 만들 필요가 없다.

## 준비(한 번)

1. Quest를 USB로 PC에 연결하고, 헤드셋 안에서 USB 디버깅을 허용한다.
2. PC에 Android SDK·NDK·CMake가 있어야 한다(`quest-native/build.bat`이 쓰는 것과 같다).
   Python 3도 있어야 한다.
3. 잴 SHARP PLY 하나를 고른다. 예: `outputs\run_...\02_ply\frame_000001.ply`

## 1단계: GPU 시간만(헤드셋을 쓰지 않아도 됨, 약 2분)

`step1_offscreen.bat` 위에 PLY를 끌어다 놓는다.

- bat이 하는 일
  - 측정 도구 `offscreen_bench`를 처음 한 번 빌드한다.
  - 도구와 PLY를 `/data/local/tmp/qnsplat`에 넣는다.
  - 다음 조건을 20초씩 잰다: 118만/60만/40만/20만 × 배율 1.0, 그리고 118만 × 배율 0.8.
- 이 도구는 앱이 쓰는 렌더러(`SplatEngine`) 그대로다.
  양 눈, Quest 3 FOV, 1680×1760, 머리를 ±10도로 흔드는 조건으로 그린다.
  화면 동기가 없으므로 **fps가 아니라 `gpu_ms`만 근거로 쓴다.**
- 읽는 법: `QNSPLAT_SUMMARY ... gpu_ms=X`
  - 72Hz 예산은 13.9ms다.
  - 앱에서 72fps를 지키려면 대략 11ms 이하가 필요하다(컴포지터·CPU 몫).
- 기록 위치: `measurements\offscreen_*.txt`

## 2단계: 실측판 앱(헤드셋을 씀, 약 6분)

`step2_app.bat` 위에 PLY를 끌어다 놓는다. 안내가 나오면 헤드셋을 쓴다.

- bat이 하는 일
  1. APK가 없으면 `build.bat`으로 만든다.
  2. 설치한다.
  3. PLY를 앱 전용 폴더(`/sdcard/Android/data/com.sharp.questnative/files/ply/scene.ply`)에 넣는다.
  4. `--es qn.open`으로 연다.
- 그다음 bat이 `adb shell setprop debug.qnsplat.*`로 조건을 바꾸며 30초씩 잰다.
  조건: 118만/60만/40만/20만 × 배율 1.0, 118만 × 배율 0.8, 118만 × 배율 0.6.
  - 그동안 사람은 장면을 보며 **머리를 천천히 좌우로 돌린다.**
  - 조건이 바뀌면 장면이 잠깐 사라졌다 다시 나온다. 다시 불러오기 때문이다.
- 결과 줄은 세 가지다.
  - `[VrApi]`: 시스템이 잰 실제 fps와 Stale(초당 재사용 프레임, 떨림 지표)
  - `[QNSPLAT]`: 앱이 잰 GPU ms(눈별 compute·draw), 보이는 splat 수
  - `[요약] QNSPLAT_SUMMARY`: 30초 측정창 요약(fps 중앙값·최저, GPU ms)
- 기록 위치
  - `measurements\app_<조건>.txt`(VrApi·QNSplat·QuestNative 로그)
  - `measurements\app_metrics.csv`(앱이 1초마다 남긴 줄 전체)

## 측정 중의 앱 상태

- PLY 뷰어의 조작(그립으로 잡기, 스틱 이동·회전, 맞춤)과 [PLY 옵션]은 일반 뷰어와 같다(`docs/feature-parity.md` 2절).
- bat이 `debug.qnsplat.budget`·`scale`·`fov`·`key`를 바꾸면 그 세션 동안 자동 조절이 꺼진다.
  사람이 고른 화질 프리셋보다 bat의 값이 우선한다.
- `debug.qnsplat.recenter`를 바꾸면 1:1 몰입 자리(사진을 찍은 자리 = 지금 머리)로 맞춘다.
  모든 조건을 같은 시점에서 재기 위해서다.
- PC에서 직접 바꿀 수도 있다. 앱은 다음 값을 1초마다 읽는다.
  - `adb shell setprop debug.qnsplat.budget 400000`
  - `adb shell setprop debug.qnsplat.scale 0.8`
  - `adb shell setprop debug.qnsplat.fov 2`
  - `adb shell setprop debug.qnsplat.key 32`
  - `adb shell setprop debug.qnsplat.hz 90`
  - `adb shell setprop debug.qnsplat.measure 이름표`
- 실시간으로 보려면: `adb logcat -s QNSplat`
- 헤드셋 안에서 [PLY 옵션] → [프레임 측정(10초)]을 누르면 p95·끊김 비율이 토스트로 나온다.
  logcat에는 `QNSPLAT_FRAMES` 줄로 남는다.

## 파일

| 파일 | 내용 |
|---|---|
| `step1_offscreen.bat` | 1단계 |
| `step2_app.bat` | 2단계 |
| `build_tools.bat` | `offscreen_bench`·`sharp_pack_check` 빌드(NDK). 출력은 `%LOCALAPPDATA%\sharp-quest-native\<체크아웃 폴더>\splat-tools` |
| `vrapi_fps_summary.py` | 로그 요약(VrApi 줄, QNSPLAT 줄, QNSPLAT_SUMMARY 줄) |
| `ply_subsample.py` | 파일로 된 표본이 필요할 때만 쓴다(불투명도 상위 N개). 측정 bat에는 필요 없다. |

## 아직 확인하지 못한 것

- 이 절차는 Quest를 연결하지 않은 상태에서 만들었다.
  - bat은 기기 없이 도는 부분(도구 빌드, 연결 안 됨 안내)만 시험했다.
  - 앱과 도구는 빌드와 PC GPU 실행까지만 확인했다.
- 포비에이션(fragment density map) 경로는 Quest에서 확인하지 않았다.
  FDM 이미지의 레이어 구성은 스왑체인과 같은 2레이어로 가정했다.
- `com.oculus.vrpowermanager.prox_close`(헤드셋을 벗어도 잠들지 않게)는 Quest 펌웨어에 따라 동작하지 않을 수 있다.
  1단계 도중 화면이 꺼지면 헤드셋을 쓰고 다시 돌린다.

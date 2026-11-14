# PLY 측정 절차

Quest 3에서 SHARP PLY를 열어 앱 fps, GPU 시간, 컴포지터의 재사용 프레임, 화질을 함께 확인한다.
측정 결과와 조건은 [results](results/README.md)에 둔다.
PC GPU 수치나 앱을 끈 offscreen 수치를 Quest 앱 fps로 환산하지 않는다.

## 준비

1. Quest를 USB로 연결하고 헤드셋에서 USB 디버깅을 허용한다.
2. Android SDK·NDK·CMake와 Python 3를 준비한다(`quest-native/build.bat`과 같은 환경).
3. 함께 쓰는 기기라면 사용 허가를 먼저 받는다.
4. 같은 PLY·자세·화질 설정으로 비교한다.
   기본 맞춤 보기와 화면을 넓게 덮는 1:1 몰입 보기는 fill 비용이 크게 다르다.

splat 수 상한은 동일한 파일에서 줄인다.
새 구현은 Morton 순서의 구간마다 하나씩 고르게 선택하고 축을 `sqrt(원래 수/남긴 수)`배로 넓힌다(상한 2배).
이것은 손실 없는 LOD 병합이 아닌 손실성 표본 선택이다.
기존 중요도 상위 N개 방식은 시험 PLY의 얼굴·옷을 지워서 폐기했다.
캐시 키도 `_spatial2_b`로 바꿨다.

## 1단계: offscreen GPU 진단

`step1_offscreen.bat`에 PLY를 끌어다 놓는다.
도구와 PLY를 `/data/local/tmp/qnsplat`에 넣고 여러 splat 수·해상도 조건을 20초씩 잰다.
코드를 바꾼 뒤에는 `build_tools.bat`으로 도구를 다시 빌드한다.

- 앱과 같은 `SplatEngine`을 쓴다. 두 눈, Quest에 가까운 비대칭 FOV, 눈당 1680×1760 기준이다.
- 머리를 ±10도로 흔드는 합성 카메라를 쓴다.
- 디스플레이 동기와 OpenXR 앱의 전력 정책이 없다.
  **offscreen fps는 앱 성능 근거가 아니며, GPU ms도 앱과 같은 클럭이라고 가정하면 안 된다.**
- `--stereo 0|1`, `--draw 0..3`, `--half 0|1`, `--probe 0..6`, `--minc`, `--acut`, `--sd2`, `--maxpx`로 A/B 비교한다.
- `--clear 1`은 draw pass에서 지우고, 0은 먼저 지운 이미지를 불러온다.
- `--snapshot output.ppm --motion 0 --seconds 1`은 같은 카메라의 양 눈 이미지를 저장한다.
  PPM은 RGB SBS다. 이 정지 모드는 compute를 재사용하므로 **화질 비교에만** 쓴다.
- 기록: `measurements/offscreen_*.txt`.

72Hz의 전체 프레임 예산은 13.89ms다.
GPU만 그보다 작다고 72fps가 보장되는 것은 아니다.
CPU·컴포지터 여유와 장시간 재사용 프레임도 확인한다.

## 2단계: 앱에서 움직이며 측정

`step2_app.bat`에 PLY를 끌어다 놓고 안내에 따라 헤드셋을 쓴다.

1. APK를 설치하고 측정용 `files/ply/qnsplat_bench_scene.ply`만 덮어쓴다.
   다른 PLY와 기존 CSV는 지우지 않는다.
2. `qn.open` 인텐트로 파일을 연다.
3. 원격 손잡이를 고정한 뒤 전체/600k/400k/200k × 배율 1.0, 전체 × 0.8/0.6을 잰다.
   shared=1, key=16, fov=0, minc=0, sd2=8, acut=1이며 프리셋 측정과는 다르다.
4. 각 조건에서 머리를 천천히 좌우로 돌린다.
5. `measurements/app_*.txt`와 `app_metrics.csv`를 가져온다.

UTF-8 한글 bat의 `call :label`이 라벨을 못 찾거나 줄 중간부터 실행하는 문제가 이 PC에서 재현됐다.
제어 bat은 ASCII로 작성하고 라벨 대신 `step2_measure.bat`을 호출한다.
한글 사용 안내는 이 문서에 둔다.
가짜 adb·Python·PowerShell 실행 파일로 여섯 조건, 숫자 손잡이 11개, 로그 파일 생성, 없는 파일의 실패 종료를 시험했다.

## 고정 시점 A/B와 장기 측정

`benchmark_app.py`는 이미 열린 앱의 **지정한 손잡이만** 바꾸고 원본 로그·설정·요약·선택적 캡처를 새 폴더에 저장한다.
전역 logcat을 지우지 않고 현재 앱 PID의 기록만 읽는다.
설치·앱 시작·파일 삭제·센서 설정은 하지 않는다.
`--out`에 이미 있는 폴더를 주면 덮어쓰지 않고 실패한다.

```bat
python -I benchmark_app.py --serial DEVICE_SERIAL --out measurements\case01 --seconds 120 --settle 20 --capture --set budget=600000 --set scale=0.65 --set stereo=1 --set sd2=4.36 --set acut=4 --set minc=0 --set fov=0 --set key=16 --set pose=1
```

- `pose=0`: 실제 추적 자세. 기본값이다.
- `pose=1`: 사진을 찍은 자리의 고정 몰입 카메라.
- `pose=2`: 기본 맞춤 배치의 고정 카메라.
- 고정 모드는 눈·장면의 렌더 카메라만 고정한다. 착용자가 움직이는 VR 경험을 시험하는 모드가 아니다.
- 고정 카메라도 **매 프레임 cull·preprocess·정렬을 강제로 실행**한다.
  정지 화면의 compute 재사용으로 fps가 부풀지 않게 했다.
- 스크립트는 `debug.qnsplat.benchpid`에 현재 PID를 넣어 고정 모드를 허용한다.
  다음 앱 실행의 PID와 맞지 않으면 고정 모드를 무시한다.
  앱 설정 파일에는 저장하지 않는다.
- 켜진 동안 HUD 상태와 매초 `QNSPLAT pose=1|2`에 표시한다.
- 같은 고정 모드를 유지한 채 예산을 바꾸면 카메라·장면 배치는 유지한다.
  모드를 바꿀 때는 전체 splat을 먼저 불러온 뒤 고정하면 맞춤 경계도 같게 비교할 수 있다.
- 요약은 첫 두 로그 창을 제외한다.
  설정이 중간에 바뀌면 실패하며, visL/visR 범위가 20% 넘게 변하면 `valid=false`와 사유를 기록하고 실패한다.
- 요약의 p95는 **1초 평균들의 p95**다. 개별 프레임 p95와 혼동하지 않는다.
- 30초 탐색으로 후보를 고르고 최소 2분씩 다시 잰다.
  가까운 시점·맞춤 시점·실제 추적 시점을 구분해 적는다.

## 손잡이와 기록 해석

`adb shell setprop debug.qnsplat.<이름> <값>`으로 바꾼다.
앱이 1초마다 읽는다.

| 이름 | 의미 |
|---|---|
| budget | 0 전체, 그 밖에는 공간별 표본 상한. 파일을 다시 불러옴 |
| scale | 눈 해상도 배율 |
| stereo | 1 공유 전처리·정렬, 0 눈별 경로 |
| key | 정렬 키 16/32bit |
| sd2 | 커널 지원 반경 제곱(1~8) |
| acut | primitive 지원 alpha 기준, 1/255 단위 |
| minc | 기여 컬링 기준 픽셀 수. 기본 측정 0 |
| maxpx | 반축 픽셀 상한(4~2048). 기본 2048 |
| draw | 0 삼각형 2개/6정점, 1 인스턴스 quad, 2 indexed quad, 3 삼각형 1개 |
| half | 1 mediump 프래그먼트 비교, 0 highp |
| probe | 진단 전용. 1~5는 일부러 틀린 그림을 내므로 화질·제품 fps로 인용 금지. 0 정상, 6 sorted-copy |
| fov | foveation 0 끔, 1 낮음, 2 중간, 3 높음 |
| hz | 요청 주사율. 실제 hz를 로그에서 확인 |
| recenter | 값이 바뀌면 현재 머리에 1:1 몰입 배치 |
| measure | 이름표를 바꾸면 30초 요약 |
| pose | PID로 허용한 측정 전용 고정 카메라(위 절 참고) |

`QNSPLAT`에는 실제 적용한 손잡이가 매초 나온다.
`stereo=0`에서 lc/ld/rc/rd는 왼눈 compute·draw, 오른눈 compute·draw다.
`stereo=1`에서는 lc가 공유 cull+preprocess, rc가 공유 prepare+sort, ld/rd가 눈별 draw다.
공유 모드의 visL/visR은 동일한 공유 목록 수이지 각 눈의 정확한 frustum 수가 아니다.
CSV는 이전 열 순서를 유지하므로 손잡이·모드는 logcat 원본과 함께 읽는다.

`VrApi`의 FPS·Stale·GPU 클럭·온도도 보존한다.
그림이 사라지거나 시점이 변해서 빨라진 실행은 무효다.
화질은 원본과 같은 영역을 나란히 놓고 얼굴·옷의 구멍·흐림을 확인한다.
헤드셋 미착용 캡처만으로 입체감·멀미·움직일 때의 안정성을 확인했다고 쓰지 않는다.

## 측정 뒤 복구

원격 값은 일반 프리셋보다 우선하며 자동 조절을 끈다.
작업을 마치면 아래 속성을 비우고 앱을 다시 시작한다.

```bat
for %P in (budget scale fov key hz recenter measure stereo draw half probe minc acut sd2 maxpx pose benchpid) do adb shell setprop debug.qnsplat.%P "''"
adb shell am broadcast -a com.oculus.vrpowermanager.automation_disable
```

bat 파일 안에 넣을 때는 `%P`를 `%%P`로 쓴다.
센서 자동화를 켤 때는 `com.oculus.vrpowermanager.prox_close`를 쓰고, 종료할 때 반드시 되돌린다.
앱을 다시 열어 로그의 `pose=0`, 프리셋 수치, 자동 조절 상태를 확인한다.

## PC 검사

- `python -I test_benchmark_app.py`: 로그 요약·시점 급변 거부 시험. 기기를 쓰지 않는다.
- `tools/run_all_tests.bat`: APK·라이선스·JVM·C++ 시험.
- splat C++ 시험에는 공유 중심 투영, 비평행/앞뒤 오프셋 거부, 공간별 표본의 결정성·필드 보존 검사가 있다.

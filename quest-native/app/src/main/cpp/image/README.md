# image 모듈 — VR 사진 뷰어

담당: image-dev. 계약: `docs/module-contract.md`(6.5 레이어, 6.6 Surface 스왑체인, 8 뷰어, 14 HUD).

## 하는 일

- 평면(2D), 3D 스크린(Full/Half SBS, TB), 180(모노·VR180 좌우), 360(모노·TB·SBS) 사진을 보여 준다.
- 사진을 앱 투영 레이어에 그리지 않는다. 컴포지터 레이어에 직접 올린다.
  평면은 `XrCompositionLayerQuad`(순서 Content 100), 180·360은 `XrCompositionLayerEquirect2KHR`(순서 Background -100)를 쓴다.
  입체 사진은 같은 스왑체인을 눈별 레이어 두 장(eyeVisibility LEFT/RIGHT, imageRect 절반)으로 낸다.
- 런타임에 `XR_FB_composition_layer_settings`가 있으면 슈퍼샘플링 필터를 켠다.
  Surface 스왑체인에는 밉맵이 없어서, 크게 줄여 보일 때 생기는 반짝임을 이 필터로 줄인다.
- 형식 자동 판별과 수동 전환을 지원한다.
  판별 규칙은 웹 앱 `format-detect.js`를 그대로 옮겼다(이름 힌트, 비율, 좌우·위아래가 닮았는지 보는 sniff).
  사람이 고른 형식은 파일별로 기억한다(최근 500개).
- 줌을 지원하고 기억한다.
  스크린은 크기 배율, 구는 시야각 확대이며, 두 값을 앱을 다시 켜도 유지한다.
  돌려 둔 방향과 놓인 자리는 다음 사진으로 넘어가도 이어진다.

## 처리 흐름(사진 한 장)

```
Open ─▶ Java probe(크기, EXIF 회전)                       [qn-image 작업 스레드]
     ─▶ C++: 형식 판별 + 디코드 크기 계산(image_logic.cpp)  [렌더 스레드]
     ─▶ Java decode(BitmapFactory / BitmapRegionDecoder 띠 단위)
     ─▶ C++: 그 크기의 Android Surface 스왑체인 생성
     ─▶ Java: Surface에 한 번 그리고 비트맵을 바로 해제
     ─▶ C++: 화면 교체(앞 사진은 새 사진이 준비될 때까지 그대로 보임), 앞 스왑체인 삭제
```

- 다음 사진: ui의 이전·다음(X, HUD [이전]/[다음])은 `Host::OpenMedia`를 부른다.
  다음 파일도 사진이면 core가 `Close` 없이 `Open`을 다시 부른다(계약 8절).
  그러면 위 흐름이 새 토큰으로 다시 돌고, 앞 사진은 새 사진이 준비될 때까지 보인다.
- fd: `Open`이 true면 fd는 뷰어 것이다. Java가 받아 들고 있다가 그 사진을 놓을 때(`release`) 닫는다.
  `Open`이 false면 fd를 건드리지 않는다(core가 닫는다).

- 디코드 크기
  - 보이는 각도 × 28 px/도만큼만 푼다. Quest 3 중심이 약 25 ppd다.
  - 키우지는 않는다.
  - 한계는 다음 세 값 중 가장 작은 것이다: 런타임 최대 스왑체인 크기(`xrGetSystemProperties`), 8192, 픽셀 예산 8192×4096.
- 큰 사진
  - BitmapFactory로 한 번에 풀 때 2400만 픽셀을 넘으면 `BitmapRegionDecoder`로 띠(약 400만 픽셀)씩 풀어 목표 크기에 줄여 붙인다.
    그래서 메모리는 "목표 비트맵 + 띠 하나"만 쓴다.
  - 띠로 풀 수 없는 형식(GIF, BMP, AVIF)은 inSampleSize를 키워 예산 안으로 줄인다.
- 확대
  - 모노 360·180을 확대하면 손을 멈춘 뒤 0.45초가 지나 보이는 가운데 부분만 원본 해상도로 다시 푼다.
  - 스크린을 키우면 원본에 픽셀이 더 있을 때 더 큰 크기로 다시 푼다.
  - 30% 이상 선명해질 때만 다시 푼다.
- 메모리
  - 디코드 비트맵은 그린 직후 `recycle()`한다.
  - 사진을 넘기거나 닫으면 파일 핸들과 남은 비트맵을 `release(token)`으로 정리한다.

## 파일

| 파일 | 내용 |
|---|---|
| `image_logic.h/.cpp` | 순수 C++: 형식 표, 판별, sniff, 눈 영역, 디코드 크기, 확대 자르기, 스틱 나누기·튕기기, 슬라이드쇼 타이머(ui가 씀), 형식 기억, 자연 정렬 |
| `image_viewer.cpp` | 뷰어 모듈: 레이어, 입력, HUD 모델(`DescribeHud`/`OnHudAction`), JNI |
| `image_api.h` | 다른 C++ 모듈용 상태·명령 API(`qn::image::Api()`) |
| `tests/` | PC 단위 시험(`run_tests.bat`, Visual Studio 2022 C++) |
| `java/.../image/ImageBridge.java` | 디코드, Surface 그리기, 설정 저장 |
| `java/.../image/Module.java` | `ImageBridge` 준비 |

## HUD(계약 14절)

- 기본 화면: `layout`(choice) / `zoomOut`, 줌 % 표시, `zoomIn`, `recenter`.
- 더 보기: `swapEyes`(입체일 때만 켜짐), `zoomReset`.
- 상태 줄: 불러오는 중, 오류, "형식을 비율로 추정했어요"(낮은 신뢰도일 때).
- 진단 줄: 원본·텍스처 크기, 자르기, 디코드 ms, 스왑체인 최대 크기, 판별 이유.
- 이전·다음, 슬라이드쇼, 목록은 ui가 맡는다(14.4절).
  ui는 `image_logic.h`의 `Slideshow` 클래스를 가져다 쓴다.

## 컨트롤러 조작(패널·HUD 밖을 가리킬 때)

| 입력 | 동작 |
|---|---|
| 왼쪽 스틱 | 사진 돌리기(미는 쪽으로 장면이 움직임, 위아래 ±80°) |
| 왼쪽 스틱 누르기 | 지금 보는 방향 앞으로 맞추기 |
| 오른쪽 스틱 위·아래 | 줌 |
| 오른쪽 스틱 누르기 | 줌 처음 크기로 |
| 오른쪽 트리거 | HUD 보이기·숨기기(`ui::SetHudVisible`) |

A·B·X·Y·menu는 ui가 쓴다(목록, 이전·다음, UI 켜기·끄기·옮기기). 뷰어는 같은 값을 받아도 무시한다.
형식 전환과 눈 바꿈은 HUD에서 한다.

## 시험으로 여는 법

모듈은 스스로 파일을 열지 않는다(계약 12절). core의 intent extra `qn.open`으로 연다.

```
adb push a.jpg /sdcard/Pictures/
adb shell am start -n com.sharp.questnative/.core.QnActivity --es qn.open file:///sdcard/Pictures/a.jpg
adb logcat -s QuestNative
```

앱에 저장소 읽기 권한이 없으면 `/sdcard/Pictures`를 읽지 못한다(상태 줄에 "파일을 읽을 수 없어요").
그때는 앱 자신의 폴더 `file:///sdcard/Android/data/com.sharp.questnative/files/`에 넣는다.

## 시험

- PC: `tests\run_tests.bat`(110개 확인: 판별, 눈 영역, 디코드 크기, sniff, 튕기기, 슬라이드쇼, 기억, 자연 정렬).
- 빌드: `quest-native\build.bat`.

## 실기기에서 볼 것

1. Surface 스왑체인에 `lockHardwareCanvas`로 그린 사진이 quad·equirect2에 바로 보이는지, 색(sRGB 감마)이 맞는지 본다.
2. equirect2 방향을 본다: 정면이 사진 가운데인지, 위아래가 뒤집히지 않았는지, 180 사진이 앞 반구에만 보이는지.
3. 입체 사진에서 왼눈과 오른눈이 바뀌지 않았는지 본다. imageRect의 원점(위·왼쪽)과 TB의 위 = 왼눈 규칙을 확인한다.
4. 8K·12K 360 사진을 열 때 디코드 시간(진단 줄)과 메모리를 보고, OOM이 나지 않는지 확인한다(`adb shell dumpsys meminfo com.sharp.questnative`).
5. 확대 뒤 다시 풀기가 끊김 없이 바뀌는지 본다.
6. 슈퍼샘플링(`XR_FB_composition_layer_settings`)이 켜졌는지(시작 로그) 보고, 2D 사진 가장자리가 반짝이지 않는지 본다.
7. `xrGetSystemProperties`의 스왑체인 최대 크기를 시작 로그에서 확인한다.

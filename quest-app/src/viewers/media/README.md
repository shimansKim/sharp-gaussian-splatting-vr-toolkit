# VR 영상·사진 뷰어 (media-dev)

Quest 3 앱에서 VR180, 360°, 3D 가상 스크린 형식의 영상과 사진을 보여 주는 뷰어입니다.
`core/types.js`의 `Viewer` 계약을 구현하며 `kinds`는 `video`, `image`입니다.
설계 배경은 `notes/quest-app-design.md` 6장입니다.

## 앱에 붙이기

```js
import { createMediaViewer } from "./viewers/media/media-viewer.js";

const mediaViewer = createMediaViewer();
registerViewer(mediaViewer);
mediaViewer.mount(stage);   // splatViewer.mount(stage) 옆에서 한 번

// 사용자가 바꾼 형식을 항목별로 기억하려면(보관함 항목은 keptLibrary.update가 저장한다)
mediaViewer.addEventListener("layoutchange", (event) => {
  const { itemId, layout } = event.detail;
  if (itemId.startsWith("library:")) keptLibrary.update(itemId, { layout });
});
```

`library`가 `load()`를 부를 때 `item.layout`이 유효한 형식이면 그 값을 그대로 쓰고, 없으면 자동 판별합니다.
사용자가 형식을 바꾸면 `item.layout`을 갱신하고 `layoutchange` 이벤트를 보냅니다.
같은 세션에서 항목을 다시 열면 바꾼 형식이 유지됩니다.

`content` 그룹이 월드 원점에 있다고 가정합니다(`xr-stage`가 그렇게 만듭니다).
구와 스크린은 머리의 월드 좌표를 따라가므로 `player`가 움직여도 맞습니다.

## 형식

| `MediaLayout` | 화면 | 눈 영역 |
|---|---|---|
| `sbs180` | VR180 3D 좌우 | 텍스처 왼쪽 절반 = 왼눈 |
| `mono180` | VR180 모노 | 전체 |
| `mono360` | 360° 모노 | 전체 |
| `tb360` | 360° 3D 위아래 | 위쪽 절반 = 왼눈 |
| `sbs360` | 360° 3D 좌우 | 왼쪽 절반 = 왼눈 |
| `sbsScreenFull` | 3D 가상 스크린, Full SBS | 왼쪽 절반 = 왼눈, 한쪽 눈 비율 (w/2):h |
| `sbsScreenHalf` | 3D 가상 스크린, Half SBS | 왼쪽 절반 = 왼눈, 비율 w:h |
| `tbScreen` | 3D 가상 스크린, 위아래 | 위쪽 절반 = 왼눈 |
| `mono2d` | 2D 일반 화면 | 전체 |

- 360° 구와 VR180 반구는 머리 위치를 따라가고(반지름 50m), 가상 스크린은 열 때와 "정면 맞춤"을 누를 때 바라보는 방향 4m 앞에 놓입니다.
- 눈 분리는 Three.js WebXR 규칙을 따릅니다. 왼눈 메시는 layer 1, 오른눈 메시는 layer 2이고 모노는 layer 0입니다.
- 눈이 바뀌어 보이면 VR 패널의 "눈 바꿈"을 켭니다.
- 영상은 `VideoTexture`, 사진은 `createImageBitmap`으로 읽은 `Texture`입니다. 사진은 GPU 한계와 8192px 중 작은 쪽으로 줄입니다.

## 형식 자동 판별

우선순위는 다음과 같습니다.

1. MP4 `st3d`/`sv3d` 박스, 구형 Google spherical v1 XML (`mp4-meta.js`)
2. 파일 이름 힌트: `360`, `180`, `VR180`, `SBS`, `LR`, `HSBS`, `FSBS`, `TB`, `OU`, `mono`
3. 화면 비율: 2:1은 360 모노, 1:1은 360 TB, 4:1은 360 SBS, 2.6:1 이상은 Full SBS 스크린

2:1 영상에 힌트가 없으면 360 모노로 봅니다. VR180이면 VR 패널에서 형식을 바꾸세요.
이름에 `180p`처럼 해상도 표기가 붙은 경우는 VR180으로 보지 않습니다.

## VR 안 조작

| 입력 | 동작 |
|---|---|
| 오른쪽 트리거 (패널 밖) | 재생/일시정지 (사진은 컨트롤 표시/숨김) |
| 오른쪽 스틱 좌우 | 10초 뒤로/앞으로 |
| 그립 | 재생 컨트롤 패널 표시/숨김 |
| 패널 버튼을 가리키고 트리거 | 재생, 10초, 탐색 막대, 소리, 반복, 형식 전환, 눈 바꿈, 스크린 크기, 정면 맞춤 |
| X/A, B/Y | `library`와 `vr-panel`이 처리(이전/다음, 목록 패널) |

앱의 VR 패널(B/Y)에는 `panelActions()`로 재생/일시정지, 10초 이동, 형식 전환 버튼이 들어갑니다.
재생이 시작되고 9초 동안 조작이 없으면 재생 컨트롤 패널이 숨겨지며, 그립이나 트리거로 다시 부릅니다.

## PC·드라이브 영상 스트리밍 (다운로드 없음)

목록에서 영상·사진을 누르면 파일을 앱에 받아 두지 않고 바로 연다. `source.open()`이 주는 URL(같은 출처 서비스 워커 프록시 `__src/pc/...`, 프록시가 없으면 PC 서버 직접 URL)을 `<video src>`에 그대로 붙이므로
브라우저가 HTTP Range로 필요한 구간만 받는다. 수 GB 파일도 앞부분(MP4 헤더와 첫 구간)만 받고 재생이 시작되고, 탐색은 그 위치만 새로 요청한다.

- 헤더 읽기(`mp4-meta.js`)도 Range로 필요한 박스만 읽는다. 본문(mdat)은 건너뛴다.
- `+faststart`가 없는 MP4(moov가 끝에 있음)도 Range로 끝부분을 읽어 재생하지만 시작이 조금 느리다. `make_quest_app_video.bat` 출력은 faststart다.
- 네트워크가 느려 데이터가 모자라면 `buffering` 이벤트를 보내고 VR 패널에 "버퍼링 중…"을 띄운다.
- 사진은 한 장씩 받아(최대 8192px로 줄임) 표시한다.
- 목록의 [보관]은 파일 전체를 앱 저장소로 복사하는 별개 동작이다(오프라인용). 스트리밍에는 필요 없고, 공간이 모자라면 `core/keep-check.js`가 시작 전에 알린다.
- PLY는 전체를 받아야 보이므로 받는 동안 상태 표시줄에 "PLY 받는 중… (받은 크기 / 전체 크기)"를 보여 준다.

## 코덱·해상도 안내

영상을 열면 MP4 헤더에서 코덱 문자열을 읽고 `navigator.mediaCapabilities.decodingInfo()`로 미리 확인합니다.
Quest Browser 한계(H.264는 4K까지, 8K는 HEVC/AV1, 하드웨어 한계 8192x4096@60)를 넘으면 패널에 경고를 띄웁니다.
이 저장소의 기존 출력(`*_quest3_8k_3D_FSBS.mp4`, H.264 8192x2730)이 여기에 해당하므로, `make_quest_app_video.bat`로 HEVC로 다시 인코딩하세요.

## 구성

| 파일 | 역할 |
|---|---|
| `media-viewer.js` | `Viewer` 구현, 입력 처리, 공개 제어 API |
| `projections.js` | 360/180 구, 가상 스크린 메시, 눈 레이어 |
| `format-detect.js` | 형식 표와 자동 판별(순수 함수) |
| `mp4-meta.js` | MP4 코덱·해상도·공간 메타데이터 (Range 요청) |
| `decode-check.js` | MediaCapabilities와 Quest 한계 경고 |
| `vr-hud.js` | VR 안 재생 컨트롤 패널(캔버스 텍스처 + 레이 선택) |

## 개발·검증

- `npm test`: 형식 판별, MP4 파서, 디코드 경고, 메시 방향·눈 레이어, 패널 클릭 판정을 `node --test`로 검사합니다.
- `npm run dev` 뒤 `https://localhost:5173/dev/media-test.html`: 단독 검증 페이지입니다.
  - "테스트 패턴" 버튼은 왼눈 L, 오른눈 R, 방위각 눈금이 있는 이미지를 만들어 각 형식으로 보여 줍니다.
  - "눈 미리보기"로 왼눈·오른눈·좌우 나란히를 확인하고, 드래그로 둘러봅니다.
  - `?emulate=1`을 붙이면 IWER로 Meta Quest 3를 흉내 내서 VR 세션과 컨트롤러 입력을 데스크톱에서 점검합니다(CDN 접속 필요).
  - `?src=/dev/samples/<파일>&layout=sbs180`처럼 영상을 바로 열 수 있습니다.
- `node dev/make-sample-videos.mjs`: ffmpeg로 형식별 샘플 영상을 `dev/samples/`에 만듭니다(커밋 대상 아님).

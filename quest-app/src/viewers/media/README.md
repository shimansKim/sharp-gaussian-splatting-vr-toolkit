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

- 360° 구와 VR180 반구는 머리 위치를 따라가고(반지름 50m), 가상 스크린은 열 때와 "정면 맞춤"을 누를 때 바라보는 방향 3m 앞에 가로 6m(시야각 약 90°)로 놓입니다.
- 눈 분리는 Three.js WebXR 규칙을 따릅니다. 왼눈 메시는 layer 1, 오른눈 메시는 layer 2이고 모노는 layer 0입니다.
- 눈이 바뀌어 보이면 VR 패널의 "눈 바꿈"을 켭니다.
- 영상은 `VideoTexture`, 사진은 `createImageBitmap`으로 읽은 `Texture`입니다. 사진은 GPU 한계와 8192px 중 작은 쪽으로 줄입니다.

## 형식 자동 판별

우선순위는 다음과 같습니다.

1. MP4 `st3d`/`sv3d` 박스, 구형 Google spherical v1 XML (`mp4-meta.js`)
2. 파일 이름 힌트: `360`, `180`, `VR180`, `SBS`, `LR`, `HSBS`, `FSBS`, `TB`, `OU`, `mono`
3. 화면 비율: 2:1은 360 모노, 1:1은 360 TB, 4:1은 360 SBS, 2.6:1 이상은 Full SBS 스크린

2:1 영상에 힌트가 없으면 360 모노로 보되, 프레임을 한 장 읽어 좌우 그림이 거의 같으면(눈당 정사각형 VR180 SBS) VR180 좌우(SBS)로 고칩니다(`sniffStereo`).
추정으로 정했을 때는 패널에 "형식을 … 추정했어요"가 뜹니다. 틀리면 ◀ ▶로 바꾸세요.
이름에 `180p`처럼 해상도 표기가 붙은 경우는 VR180으로 보지 않습니다.

## VR 안 조작

| 입력 | 동작 |
|---|---|
| 오른쪽 트리거 (패널 밖) | 재생/일시정지 (사진은 컨트롤 표시/숨김) |
| 오른쪽 스틱 좌우 | 10초 뒤로/앞으로 (영상), 사진은 한 번 튕기면 이전/다음(앱이 처리). 상하는 줌(위로 밀면 확대). 좌우가 더 크면(\|x\|>\|y\|) 좌우만, 아니면 줌만 나간다(`splitRightStick`) |
| 왼쪽 스틱 | 장면(360 구·3D 스크린)을 돌린다. 미는 쪽으로 장면이 움직인다(좌우·상하 반전, `core/stick-rules.js`). 왼쪽 스틱 누르기(L3)·재생 컨트롤 [더 보기]의 [화면 위치 맞춤]이 지금 보는 방향 앞으로 다시 맞추고 돌린 양도 지운다 |
| 그립 | 쓰지 않음(UI·화면이 저절로 옮겨지지 않게) |
| 패널 버튼을 가리키고 트리거 | 기본 화면: 재생, 10초, 탐색 막대, 이전·다음, 슬라이드쇼, 줌, 목록 / [더 보기] 화면: 소리, 반복, 형식 전환, 눈 바꿈, 진단, 정면 맞춤, 슬라이드쇼 간격 |
| X/A | `library`가 처리(이전/다음) |
| B/Y | 짧게 = 모든 UI(공용 패널·재생 컨트롤) 켜기·끄기, 길게 = UI 옮기기(`ui/ui-controls.js`, `core/ui-state.js`) |

앱의 VR 패널([목록] 버튼, UI가 켜져 있고 보이는 것이 없을 때 B/Y)의 [더 보기] 화면에는 `panelActions()`로 재생/일시정지, 10초 이동, 형식 전환 버튼이 들어갑니다.
재생이 시작되고 9초 동안 조작이 없으면 재생 컨트롤 패널이 숨겨지며, 그립이나 트리거로 다시 부릅니다.

재생 컨트롤 패널은 **한 번 놓이면 고정**입니다. 열 때, "정면 맞춤", 그립으로 다시 부를 때만 자리를 잡고, 가리키거나 누르거나 형식을 바꿔도 따라 움직이지 않습니다.
눈높이 아래 32.8°(윗변 기준) 지점에 머리 쪽으로 기울여 놓아서 3D 스크린(가로 약 90°, 위아래 ±29°)과 겹치지 않습니다. 형식을 바꾸면 버튼 글씨가 바뀌고 패널에 "형식: …" 안내가 5초 가까이 뜹니다.

**한 곳에서 조작(도크)**: 재생 컨트롤 기본 화면에 공용 패널과 같은 [이전] [다음] [슬라이드쇼] [목록]이 있습니다(영상은 이전·다음이 윗줄, 사진은 윗줄 전부). 번호(2 / 9)는 제목 줄 오른쪽에 보이고 슬라이드쇼 간격은 [더 보기]에 있습니다. 자주 쓰는 버튼만 기본 화면에 두고 나머지(소리·반복·눈 바꿈·진단·형식·화면 위치 맞춤)는 [더 보기] 화면에 접었습니다(`page`: main/more).
공용 목록 패널(`ui/vr-panel.js`)은 UI 앵커(`core/ui-state.js`)의 **같은 도크 기준점**(`core/panel-layout.js`의 `dockTop`)에 윗변을 맞춰 걸립니다(0.8배). **한 번에 한 창만** 보입니다: 패널이 열려 있는 동안(`ui.panelOpen`) 재생 컨트롤은 띄우지 않고(`showHud`·파일 열기 모두), 패널을 닫으면 돌아옵니다(`onPanelToggle`). 버튼 글씨는 `core/label-fit.js`로 크기·줄 수를 맞춰 잘리지 않게 그립니다.
이동 줄의 동작은 앱(`main.js`)이 `nav` 이벤트로 받아 `library`·`slideshow`에 연결하며, 상태(번호·슬라이드쇼 켬·간격)는 `setNavState()`로 내려 줍니다.

## 영상 출력 경로: WebXR 레이어 ↔ 메시

VR 안에서 영상은 가능하면 `XRMediaBinding`(`layers-path.js`)으로 컴포지터에 직접 넘깁니다.
평면 3D 스크린은 `createQuadLayer`, VR180/360은 `createEquirectLayer`이고 `stereo-left-right`/`stereo-top-bottom`으로 눈별 분리를 컴포지터가 합니다.
프레임마다 영상을 WebGL 텍스처로 올리지 않아 8K급 영상도 부담이 적고, three의 프로젝션 레이어(패널·레이 선)는 배경을 투명하게 두고 그 위에 그려집니다.
다음 경우에는 기존 메시 경로로 자동 폴백합니다: 브라우저에 `XRMediaBinding`이 없거나 세션에 `layers` 기능이 없음, 레이어 생성 실패, "눈 바꿈" 켬, 사용자가 끔, 2D 미리보기.
- 사진은 항상 메시 경로입니다(정지 화면이라 업로드 비용이 없고, 눈별 layer 1·2 규칙으로 분리됩니다).
- VR 패널 "영상 출력: 레이어/메시"로 바꿔 볼 수 있고 기기에 기억합니다. `?layers=0`/`?layers=1`로도 정할 수 있습니다.
- VR 중 5초마다 콘솔에 `[media-perf] path=… 5초: 표시 N프레임, 드롭 M`을 남깁니다(끊김 측정).

## 2D 미리보기와 VR 진입 (실기기 2026-11-12)

2D 브라우저 창의 미리보기는 SBS/TB 3D의 **왼쪽 눈 그림만** 보여 주므로 입체일 수 없고, 영상은 VideoTexture·DOM 재생이라 VR보다 끊긴다.
그래서 영상·사진을 열면 2D 화면 가운데에 큰 **'VR로 보기 (입체)'** 안내가 뜨고(WebXR가 있으면 `isSessionSupported`가 false여도 눌러서 시도, 실패 이유는 상태 줄에 표시),
목록에서 영상·사진을 누르면 그 클릭 안에서 바로 VR 세션을 요청한다(설정 "영상·사진은 열면 바로 VR로", 기본 켬, PLY는 그대로). 코드: `ui/vr-entry.js`, `ui/app-shell.js`.

## 진단과 눈 분리 방식 (입체·끊김 원인 확인용)

- HUD [더 보기] 화면의 **'진단'** 버튼: HUD 위에 진단 패널(경로, 레이어 생성 성공/실패 이유, XRMediaBinding·layers 기능, `renderState.layers`, 눈 카메라 수·마스크·뷰포트, 눈별 메시 그림/초, 표시 fps·드롭·버퍼 앞선 양·소스 경로(프록시/직접), 렌더 프레임 간격)을 띄운다. 같은 값을 5초마다 콘솔에 `[media-diag] {json}`으로 남기고 `__sharpQuest.mediaViewer.diagnostics()`로 읽을 수 있다.
- VR 패널 **'눈 테스트 패턴'**: 왼쪽 빨강 L / 오른쪽 파랑 R인 SBS 그림을 지금 쓰는 메시 경로로 보인다. 한쪽 눈씩 뜨고 왼눈=빨강 L, 오른눈=파랑 R이면 눈 분리 정상.
- VR 패널 **'눈 분리'**: `camera`(기본) = 두 메시를 모두 layer 0에 두고 그릴 때 서브카메라(`renderer.xr.getCamera().cameras[0|1]`)를 보고 맞는 눈에서만 그린다(layer 마스크에 의존하지 않음). `mask` = three의 눈 layer 1·2 마스크. `?eye=mask|camera`로도 정한다.
- 영상은 화면 밖 DOM에 붙여 두고 `requestVideoFrameCallback`으로 실제 표시 프레임 수를 센다.

## 형식 기억

사람이 고른 형식은 보관함 항목은 라이브러리가, 그 밖의 출처(PC·드라이브·기기 파일)는 `layout-memory.js`가 항목 id별로 기기(localStorage, 최근 500개)에 기억해 다음에 열 때 그대로 씁니다.
프레임 내용으로 고친 자동 판별(아래)은 기억하지 않습니다.

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

- 한도 경고(`questLimitWarnings`)는 MediaCapabilities 결과와 무관하게 파일 헤더에서 읽은 코덱·해상도로 따로 판정한다. 기기 쪽 보고가 낙관적이어도(데스크톱은 H.264 6000x2000을 "지원"으로 답한다) 경고가 뜬다. 코덱을 파일에서 읽지 못한 경우(MKV 등)에는 H.264 4K 한도를 단정하지 않는다.
- VR 패널의 경고 줄은 두 줄까지 보여 준다. 2D 화면의 상태 표시줄에는 파일을 연 뒤에도 경고가 남는다.
- 영상 오류 코드 4는 코덱 미지원 말고도 연결 차단(https 앱에서 http 주소 영상)에서 똑같이 나온다. 주소가 http이고 앱이 https이면 "연결이 막힌 것 같습니다"를 먼저 안내한다(`video-error.js`).

## 소리 (영상에서 소리가 안 날 때)

`<video>`는 음소거 없이(muted=false, volume=1) 만들고, 앱은 어디서도 몰래 음소거하지 않습니다. 소리가 안 나는 이유를 앱이 직접 알려 줍니다(새 버튼·배치 없음).

- 파일을 열면 MP4 헤더에서 소리 트랙을 읽어(`mp4-meta.js`의 `audio`) HUD 경고 줄에 알립니다(`audio-check.js`): 소리 트랙 없음(info), 브라우저가 못 읽는 소리 형식 AC-3·DTS 등(warn).
- 재생 1.5초 뒤 `webkitAudioDecodedByteCount`가 0이면(헤더를 못 읽는 mkv·webm 포함) "소리가 디코딩되지 않습니다"를 띄웁니다. 음소거 중에는 판단하지 않습니다.
- 진단 패널(HUD '진단')에 소리 한 줄이 있습니다: `소리 켜짐 · 볼륨 100% · 소리 트랙 AAC 2ch · 디코딩된 소리 312KB`. 디코딩된 소리가 재생 중 계속 늘면 앱은 소리를 내고 있는 것이니 Quest 시스템 볼륨·출력을 봅니다.
- `setVolume(0~1)` API가 있습니다(HUD 버튼은 없음). 소리 켜기/끄기는 기존 '소리' 토글입니다.
- 변환: `make_quest_app_video.bat`·`--mode quest_app`은 AAC/MP3 소리만 그대로 두고, 그 밖의 형식은 AAC로 다시 인코딩합니다(예전에는 복사해서 AC-3 영상이 소리 없이 나왔다).

## 구성

| 파일 | 역할 |
|---|---|
| `audio-check.js` | 소리 트랙·재생 가능 여부·실제 디코딩 판단(순수 함수) |
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

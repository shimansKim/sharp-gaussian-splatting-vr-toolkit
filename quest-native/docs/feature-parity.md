# quest-app → quest-native 기능 대조표

기존 웹 앱(`quest-app/`, origin/main d029fda 기준)의 기능을 새 앱(quest-native)의 담당 모듈에 하나씩 대응시킨다.
담당 모듈의 구성원이 기능을 옮기면 "상태" 칸을 고친다.

- 담당 모듈: `core`(foundation), `splat`(splat-dev), `video`(video-dev), `image`(image-dev), `ui`(image-dev), `source`(encode-guide)
- 상태 표기(2026-11-14 main 기준으로 다시 맞춤)
  - **구현**: 새 앱에 들어가 빌드된다. 따로 적지 않으면 **실기기에서는 아직 확인하지 않았다**(Quest 미연결).
  - **일부**: 일부만 들어갔다. 남은 것을 같이 적는다.
  - **안 옮김**: 새 앱에서는 옮기지 않는다. 사유와 대안을 같이 적는다.
  - **담당 미션 진행 중**: 담당 구성원의 미션이 진행 중이다(splat·source 행은 담당자가 고친다).
  - **새 기능**: 기존 앱에 없던 것(행 이름에 표시).
- 기존 위치 경로는 `quest-app/src/` 기준이다.

## 1. VR UI 요소 18개 (compare-ui.md 1절)

| # | 항목 | 기존 위치 | 새 앱 담당 | 상태 |
|---|---|---|---|---|
| 1 | 공용 패널 틀·페이지 전환(목록 / 더 보기 / PLY 옵션 / 버튼 지정) | `ui/vr-panel.js` | ui | 구현: 목록·설정·버튼 바꾸기·고지·진단·키패드·모듈 페이지(계약 16절) |
| 2 | 폴더 트리(출처별 뿌리, 지연 로드) | `core/folder-tree.js`, `ui/vr-panel.js` | ui(+source 목록) | 구현 |
| 3 | 파일 목록: 가상 스크롤, 종류 필터·정렬, 점프, 스틱 가속 | `ui/vr-panel.js`, `core/list-view.js`, `core/nav-history.js` | ui | 구현 |
| 4 | 종류 배지(PLY·영상·사진·폴더) | `ui/vr-panel.js` | ui | 구현 |
| 5 | 라벨 맞춤(크기 줄임·두 줄·말줄임) | `core/label-fit.js` | ui | 구현 |
| 6 | 영상 HUD: 탐색 막대, 10초 뒤·앞, 재생, 이전·다음, 줌, 더 보기(소리·반복·눈 바꿈·진단·형식·위치 맞춤·간격) | `viewers/media/vr-hud.js` | ui(화면) + video(동작) | 구현: 그리기 ui(HUD main/more/진단 화면), 동작 video |
| 6+ | 배속 조절(예: 0.5~2배) | — | ui(슬라이더) + video(Media3 `setPlaybackSpeed`) | 구현(새 기능): video HUD `speed`(0.5~2배)를 ui가 슬라이더로 그림 |
| 6+ | 음량 조절(슬라이더, 지금은 켬·끔뿐) | `viewers/media/vr-hud.js:281`(켬·끔) | ui(슬라이더) + video(`setVolume`) | 구현(새 기능): video HUD `volume` 슬라이더·`mute` 토글을 ui가 그림 |
| 7 | 이미지 조작·슬라이드쇼(간격 타이머, 영상 끝나면 다음) | `viewers/media/vr-hud.js`, `core/slideshow.js` | image + ui | 구현: 슬라이드쇼 ui(`image_logic.h` `Slideshow`, HUD [슬라이드쇼], [설정] 간격), 사진 조작 image |
| 8 | 진단 오버레이(디코드 통계·버퍼·코덱) | `viewers/media/media-diag.js` | video + ui | 구현: 재생 중 수치(HUD [진단] 화면) + 기기 디코더 진단(`decoder-diagnostics.md`, [설정] > [진단] 페이지), 실기기 미확인 |
| 9 | PLY 옵션·안내 토스트(화질, 전체 보기, 점 크기, 자세 유지, 미리 받기, 자동 조절, 프레임 측정) | `viewers/splat/splat-options.js`, `ui/vr-panel.js` | splat(값) + ui(화면) | 담당 미션 진행 중(splat): ui 쪽 그릴 자리는 구현(HUD [PLY 옵션] 화면에 splat의 `DescribeHud` 컨트롤이 그대로 보임) |
| 10 | 버튼 바꾸기(VR 안): 입력 캡처, 짧게·길게, 충돌 표시, 되돌리기 | `ui/vr-bindings-page.js`, `core/binding-capture.js`, `core/bindings.js` | ui + core(물리 버튼별 액션은 **계약** 완료) | 구현: A·B·X·Y·메뉴 × 짧게·길게 배정, "버튼을 누르세요" 입력 캡처, 바꾼 뒤 10초 안에 [유지]하지 않으면 되돌리기, 기본값으로. 충돌 표시는 필요 없음(칸 하나에 동작 하나). PC 동기화는 안 옮김(6절) |
| 11 | UI 켜기·끄기(B/Y 짧게)·옮기기(B/Y 길게), 방 고정 앵커 | `ui/ui-controls.js`, `core/ui-state.js`, `core/panel-layout.js` | ui | 구현 |
| 12 | 컴포지터 레이어로 UI 출력 | `core/quad-layer.js` | ui(core `LayerSink.AddQuad`, `CreateSurfaceSwapchain`은 **계약** 완료) | 구현 |
| 13 | 컨트롤러 레이 포인터(hover·선택·드래그) | `ui/vr-panel.js`, `core/xr-stage.js`, `core/input-map.js` | ui(core aim 자세·트리거는 **계약** 완료) | 구현: 양손 레이 선(얇은 quad 레이어, 패널이 떠 있을 때), 패널 위 커서 점, hover·선택·드래그·스틱 스크롤 |
| 14 | 손 입력(지금은 요청만 하고 UI 조작 안 함) | `core/xr-stage.js:213` | core(나중) | 안 옮김: 기존 앱도 손으로 UI를 조작하지 않았다(요청만 함). 필요해지면 손 추적(XR_EXT_hand_tracking)을 별도 미션으로 |
| 15 | 글자 입력(PC IP 직접 입력) | `ui/pc-panel.js:70` | ui + source | 구현: PC 주소는 소스 카드 [연결 설정]이 2D 창(`source/PcSetupActivity`, 시스템 키보드)을 연다(docs/pc-source.md). VR 안 짧은 숫자 입력용 키패드(`UiPages.askText`)도 있다 |
| 16 | 설정(품질 프리셋, 레이어 사용, 열면 바로 VR) | `ui/app-shell.js`, `ui/vr-entry.js` | ui | 구현: [설정] 해상도 배율·주사율·포비에이션·슬라이드쇼 간격 + 모듈 설정 페이지. 기존 "VR 패널을 레이어로"는 항상 레이어라 필요 없음, "열면 바로 VR"은 앱이 처음부터 VR이라 필요 없음 |
| 17 | 오픈소스 라이선스 고지·개인정보·지원 링크 | `ui/licenses-panel.js`, `core/policy-links.js` | ui(내용은 `docs/licenses.md`) | 구현: 오픈소스 고지(`docs/licenses.md`·third_party LICENSE 원문·라이선스 전문에서 생성, 빌드가 대조), 개인정보처리방침·지원·이용약관 링크(시스템 브라우저로 열고 주소를 토스트로 보임) |
| 18 | 한글 텍스트(모든 라벨·파일 이름) | 전 파일 | ui(Android Canvas 시스템 글꼴) | 구현 |

## 2. PLY(splat) 뷰어

| 항목 | 기존 위치 | 새 앱 담당 | 상태 |
|---|---|---|---|
| PLY 열기(스트리밍), SHARP PLY 헤더·뒤 요소 처리 | `viewers/splat/splat-viewer.js` | splat | 계약(.ply/.spz/.splat 등록, Open 스텁) |
| 렌더러(Spark CPU 정렬 → 네이티브 GPU 정렬) | `@sparkjsdev/spark` | splat(pocketsplat 코어) | 계약(Vulkan 1.3 기능 훅·셰이더 빌드) |
| 품질 프리셋(safe 1~10, lite, quest, quality) | `viewers/splat/quest-presets.js` | splat | 없음 |
| 적응 품질(정렬 간격·단계 내리기) | `viewers/splat/adaptive-quality.js` | splat(+core 해상도 배율·foveation·주사율 **계약**) | 계약 |
| 프레임 측정(p95·끊김 비율) | `viewers/splat/frame-stats.js` | splat | 없음 |
| 그립으로 잡아 이동·회전, 양손 확대·축소 | `viewers/splat/splat-motion.js` | splat | 없음 |
| 왼쪽 스틱 이동, 오른쪽 스틱 스냅 회전·높이 | `viewers/splat/splat-motion.js`, `core/stick-rules.js` | splat | 없음 |
| 크기·위치 맞춤(R3, 1:1 몰입), 크기 초기화(L3) | `viewers/splat/splat-viewer.js` | splat | 없음 |
| 열 때 눈앞 적정 크기 자동 맞춤, 조작 안내 카드 | `viewers/splat/splat-viewer.js`, `splat-hud.js` | splat + ui | 없음 |
| 이전·다음(X 짧게·길게), 다음 파일 미리 받기 | `core/prefetch.js`, `main.js` | core(목록 이동) + splat | 일부: 이전·다음 구현(ui: X 짧게·길게, HUD [이전]/[다음]). 미리 받기는 담당 미션 진행 중(splat) |

## 3. VR 영상 뷰어

| 항목 | 기존 위치 | 새 앱 담당 | 상태 |
|---|---|---|---|
| 형식 9종(sbs180, mono180, mono360, tb360, sbs360, sbsScreenFull, sbsScreenHalf, tbScreen, mono2d) | `viewers/media/projections.js` | video(equirect2·quad 레이어) | 구현(빌드·단위 시험, 실기기 미확인) |
| 형식 자동 판별(st3d/sv3d, 이름 힌트, 비율, sniffStereo) | `viewers/media/format-detect.js`, `mp4-meta.js` | video | 구현(st3d/sv3d·이름·비율·프레임 sniff, JUnit 19건), 실기기 미확인 |
| 형식 기억(항목별) | `viewers/media/layout-memory.js` | video | 구현(빌드·단위 시험, 실기기 미확인) |
| 재생·일시정지, 10초 이동, 드래그 탐색 | `viewers/media/media-viewer.js`, `vr-hud.js` | video + ui | 구현(빌드·단위 시험, 실기기 미확인) |
| 반복, 소리 켬·끔 | `viewers/media/vr-hud.js` | video + ui | 구현(빌드·단위 시험, 실기기 미확인) |
| 배속 조절 | — | video + ui | 구현(빌드·단위 시험, 실기기 미확인) |
| 음량 조절 | — | video + ui | 구현(빌드·단위 시험, 실기기 미확인) |
| 눈 바꿈 | `viewers/media/vr-hud.js` | video | 구현(빌드·단위 시험, 실기기 미확인) |
| 줌(오른쪽 스틱 상하), 줌 기억 | `viewers/media/zoom-memory.js` | video | 일부: 스크린 줌·기억 구현, 360/180 확대는 없음 |
| 장면 돌리기(왼쪽 스틱), 정면 맞춤(L3) | `core/stick-rules.js`, `media-viewer.js` | video | 구현(빌드·단위 시험, 실기기 미확인) |
| 디코드 가능 여부·소리 확인, 오류 안내 | `viewers/media/decode-check.js`, `audio-check.js`, `video-error.js` | video | 일부: 재생 오류를 HUD·토스트로 안내. 열기 전 디코드 가능 여부 확인은 없음 |
| 레이어 경로(컴포지터 직접 출력) | `viewers/media/layers-path.js` | video(Surface 스왑체인) | 구현(Media3 → Surface 스왑체인 → quad/equirect2), 실기기 미확인 |

## 4. 사진 뷰어

| 항목 | 기존 위치 | 새 앱 담당 | 상태 |
|---|---|---|---|
| 사진 열기(GPU 한계·8192px로 줄임) | `viewers/media/media-viewer.js` | image | 구현(quad·equirect2 레이어, 스왑체인 한계·픽셀 예산, 큰 사진 띠 디코드, 확대 시 가운데 다시 풀기), 실기기 미확인 |
| 형식(영상과 같은 9종) 판별·전환 | `viewers/media/format-detect.js` | image | 구현(`image/image_logic.cpp`, PC 단위 시험), 파일별 기억 |
| 이전·다음(스틱 튕김), 줌 | `viewers/media/media-viewer.js` | image(줌) + ui(이전·다음) | 구현: 줌·줌 기억(image). 이전·다음은 ui가 `Host::OpenMedia`로 열고, image는 같은 뷰어 재진입(앞 사진 유지)으로 받는다 |
| 슬라이드쇼 | `core/slideshow.js` | ui | 구현: ui가 `Slideshow`로 간격마다 다음 파일을 연다(HUD [슬라이드쇼], [설정] 간격) |

## 5. 파일 소스(PC·드라이브·기기)

| 항목 | 기존 위치 | 새 앱 담당 | 상태 |
|---|---|---|---|
| 기기 파일 열기(파일 선택기) | `sources/device-source.js` | source | 구현(실기기 미확인): 폴더 고르기(SAF)·모든 파일 접근, docs/storage-access.md |
| 끌어놓기 | `ui/app-shell.js` | — | 안 옮김(VR 앱에는 끌어놓을 창이 없음) |
| 보관함(OPFS·IndexedDB에 복사해 계속 보이기) | `core/library.js`, `core/store.js`, `core/keep-check.js` | source | 구현(실기기 미확인): 기기 파일은 복사하지 않고 "보관함"(즐겨찾기 ★)으로 대체, "최근" 추가 |
| PC 연결(같은 Wi-Fi 찾기, 주소 저장) | `sources/pc-connect.js`, `sources/pc-scan.js` | source | 구현(실기기 미확인): 마지막 주소 → 입력한 주소 → mDNS `_sharpvr._tcp` → 내 Wi-Fi /24 대역 훑기, 소스 카드·[연결 설정]. docs/pc-source.md |
| PC 파일 목록·스트리밍 | `sources/pc-source.js`, `sources/proxy-url.js` | source | 구현(JVM 시험·로컬 PC 서버 시험, 실기기 미확인): 영상은 http 스트리밍(Range), 사진·PLY는 앱 캐시에 받아 fd로 열기(상한·오래된 것부터 지움). 프록시는 필요 없음(PC 서버는 인증 없는 GET) |
| Cloudflare 터널 모드 | `sources/pc-connect.js` | source | 안 옮김: 앱은 평문 http를 집 안 주소(사설 IP·.local)에만 쓰도록 막았다(보안). 집 밖에서는 보기 전에 파일을 기기에 옮겨 두거나, 필요해지면 https 터널 지원을 따로 정한다 |
| Google Drive 로그인·목록 | `sources/gdrive-source.js`, `ui/gdrive-panel.js` | source + ui | 결정 대기(사람). 기존 웹 앱의 Google Picker·로그인 SDK는 Quest(Play 서비스 없음)에서 못 쓴다. 지금 쓸 수 있는 대안: PC의 "Google Drive 데스크톱" 폴더를 PC 서버에 공유(docs/pc-source.md 4절) |
| 탐색 기록(뒤로) | `core/nav-history.js` | ui | 구현(실기기 미확인) |

## 6. 앱 공통

| 항목 | 기존 위치 | 새 앱 담당 | 상태 |
|---|---|---|---|
| 몰입 세션 시작·끝, 일시정지·재개 | `core/xr-stage.js`, `core/vr-launch.js` | core | 구현(core: 세션 상태 처리, 빈 장면 빌드 확인) |
| 컨트롤러 입력(물리 버튼별) | `core/input-map.js` | core | 구현(core 입력 액션, ui 버튼 배정) |
| 버튼 배정 표와 기본값 | `core/bindings.js` | core 또는 ui(다음 미션에 정함) | 구현: ui `Bindings`(기기 SharedPreferences에 저장, 네이티브 버튼 처리에 반영) |
| 버튼 배정 PC 동기화 | `core/bindings-sync.js` | source + ui | 안 옮김: 기존 PC 서버의 PUT /api/bindings는 Origin 헤더가 허용 출처일 때만 받아 네이티브 앱은 보낼 수 없고(GET만 가능), 배정 id 형식도 웹 앱 전용(`(common\|media\|splat).이름`, 손·버튼·press/hold)이라 새 앱 모델과 다르다. 보내려면 기존 서버 파일(`scripts/quest_media_server.py`)을 고쳐야 해서 이번 범위(quest-native/ 밖 변경 없음)를 넘는다. 대안: 새 앱은 배정을 기기에 저장한다. 필요해지면 서버 수정과 함께 별도 작업으로 |
| 뷰어 등록·파일 종류 → 뷰어 선택 | `core/registry.js`, `core/kinds.js` | core | 구현(core 레지스트리, Java `MediaKind`) |
| 업데이트 확인(새 판 안내) | `core/update-guard.js` | ui | 안 옮김: 기존 것은 웹 배포 뒤 옛 화면이 옛 파일을 찾는 문제(서비스 워커 캐시)를 막는 장치다. 네이티브 앱은 설치한 판 전체가 함께 바뀌어 같은 문제가 없다 |
| 스토어 판별(TWA 밖 접근 막기) | `core/store-gate.js` | — | 안 옮김(네이티브 앱은 스토어에서 바로 설치됨) |
| 품질·주사율·해상도 설정 | `viewers/splat/quest-presets.js` | core(Host 설정 함수) + splat | 일부: core Host 함수와 [설정] 연결(해상도 배율·주사율·포비에이션)은 구현. splat 품질 프리셋은 담당 미션 진행 중(splat) |

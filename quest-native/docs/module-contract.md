# quest-native 모듈 계약

이 문서는 quest-native 앱에 모듈(뷰어·UI·소스)을 붙이는 규칙이다.
독자는 splat-dev, video-dev, image-dev, encode-guide와 이후 이 앱을 고칠 에이전트다.

- 계약 코드: `app/src/main/cpp/core/qn_api.h`(C++), `app/src/main/java/com/sharp/questnative/core/`(Java)
- 소유자: foundation. 계약을 바꿔야 하면 고치기 전에 commander에게 먼저 알린다.
- 스택: Android NDK + Khronos OpenXR loader 1.1.65 + Vulkan(XR_KHR_vulkan_enable2). Unity는 쓰지 않는다.

## 1. 요약(먼저 읽을 것)

1. 내 폴더 안에서만 일한다.
   C++은 `app/src/main/cpp/<id>/`, Java는 `app/src/main/java/com/sharp/questnative/<id>/`다.
   `<id>`는 `splat`, `video`, `image`, `ui`, `source` 중 하나다.
2. C++ 소스는 내 폴더의 `module.cmake`에 추가한다.
   루트 `CMakeLists.txt`는 고치지 않는다.
3. 등록은 내 .cpp의 `QN_REGISTER_MODULE(Info());` 한 줄이다.
   Java 쪽은 `com.sharp.questnative.<id>.Module` 클래스 하나가 이름으로 자동 등록된다.
4. 모든 C++ 훅은 렌더 스레드에서 불린다.
   Java 스레드에서 C++로 넘어올 때는 `Host::PostToRenderThread`로 넘긴다.
5. 프레임마다 내가 낼 것은 두 가지다.
   하나는 투영 레이어에 그리기(`RenderProjection`)이고, 다른 하나는 컴포지션 레이어 내기(`SubmitLayers`: quad·cylinder·equirect2·projection)다.
6. 빌드는 `build.bat`, 설치는 `install.bat`(더블클릭)이다.
   빌드 출력은 `%LOCALAPPDATA%\sharp-quest-native\<체크아웃 폴더>`에 생기고 저장소 안에는 생기지 않는다.
   체크아웃(worktree) 폴더 이름마다 따로 생기므로 여러 worktree가 동시에 빌드해도 겹치지 않는다.

## 2. 폴더 구조와 담당

```
quest-native/
  build.bat, install.bat, gradlew(.bat), settings.gradle, build.gradle   foundation
  app/build.gradle, app/src/main/AndroidManifest.xml                     foundation
  app/src/main/cpp/
    CMakeLists.txt, cmake/qn_shaders.cmake                               foundation
    core/        세션·프레임 루프·입력·Vulkan·레지스트리·JNI             foundation
    splat/       PLY(Gaussian splat) 뷰어                                 splat-dev
    video/       VR 영상 뷰어(배속·음량 포함)                             video-dev
    image/       사진 뷰어                                                image-dev
    ui/          VR 패널·HUD·레이 포인터                                  image-dev(UI)
    source/      (필요할 때만) 소스의 네이티브 부분                       encode-guide
  app/src/main/java/com/sharp/questnative/
    core/        QnActivity, NativeBridge, ModuleLoader, MediaSource 등   foundation
    splat/ video/ image/ ui/ source/   각 모듈의 Module.java와 그 밖의 파일   각 담당
  docs/          module-contract.md, licenses.md, feature-parity.md, encoding-guide.md
```

- 공용 파일(`app/build.gradle`, 매니페스트, 루트 CMake)을 바꿔야 할 때가 있다.
  예: 의존성(Media3) 추가, 권한 추가.
  이때는 PR 설명에 바꾼 줄과 이유를 적고 commander에게 알린다.
  같은 파일을 여러 명이 동시에 고치는 일을 막기 위해서다.
- 서드파티 코드(pocketsplat, volk 등)는 그 코드를 쓰는 모듈 폴더 아래에 둔다(예: `cpp/splat/third_party/`).
  들인 날 `docs/licenses.md`에 한 줄을 추가한다.

## 3. 스레드 모델

| 스레드 | 무엇이 도나 | 규칙 |
|---|---|---|
| 렌더 스레드(`android_main`) | OpenXR 이벤트, 프레임 루프, 모든 C++ 모듈 훅 | Vulkan 큐 제출과 OpenXR 호출은 여기서만 한다. |
| Android 메인 스레드 | `QnActivity`, Java `Module.onCreate/onDestroy` | 오래 걸리는 일을 하지 않는다. |
| 작업 스레드(모듈이 만듦) | 파일 읽기, 네트워크, 디코딩 | C++ 상태를 직접 바꾸지 않는다. `PostToRenderThread`로 넘긴다. |

- `Host::PostToRenderThread(fn)`와 `qn::PostIfRunning(fn)`만 어느 스레드에서나 부를 수 있다.
  fn은 다음 프레임의 훅들보다 먼저 렌더 스레드에서 돈다.
- **JNI 콜백에서는 `qn::PostIfRunning(fn)`(qn_api.h)을 쓴다.**
  앱이 끝난 뒤 늦게 온 Java 콜백에서 `GetHost()`를 부르면 null을 역참조한다.
  `PostIfRunning`은 네이티브가 시작 전이거나 끝난 뒤면 false를 돌려주고 fn을 버린다.
- Java에서 C++로 부를 때는 이름 규칙(`Java_com_sharp_questnative_<id>_<Class>_<method>`)으로 내 .cpp에 구현한다.
  `QnActivity`가 `System.loadLibrary("questnative")`를 먼저 하므로 별도 등록은 필요 없다.
  구현 안에서 할 일은 값 복사와 `qn::PostIfRunning`뿐이다.
- C++에서 Java로 부를 때는 `Host::Env()`(렌더 스레드에 붙은 JNIEnv)와 `Host::FindAppClass("com.sharp.questnative.video.Player")`를 쓴다.
  네이티브 스레드의 `FindClass`는 앱 클래스를 못 찾는다.
  `FindAppClass`가 돌려주는 global ref는 core가 캐시하므로 지우지 않는다.

## 4. 모듈 등록

### C++

```cpp
#include "core/qn_api.h"

namespace {
class SplatViewer final : public qn::Viewer { /* Open, Close, 훅 */ };

qn::ModuleInfo Info() {
    qn::ModuleInfo info;
    info.id = "splat";
    info.kind = qn::ModuleKind::kViewer;          // UI는 kOverlay
    info.fileExtensions = {".ply", ".spz", ".splat"};
    info.mimePrefixes = {};                       // 예: {"video/"}
    info.optionalXrExtensions = {};               // 런타임에 있으면 켜짐
    info.optionalDeviceExtensions = {};           // 기기에 있으면 켜짐
    info.fillDeviceFeatures = nullptr;            // 5.2절
    info.create = [] { return std::make_unique<SplatViewer>(); };
    return info;
}
}  // namespace

QN_REGISTER_MODULE(Info());
```

- 등록은 정적 초기화 때 일어난다.
  그래서 core는 OpenXR 인스턴스와 Vulkan 디바이스를 만들기 전에 모듈이 원하는 확장과 기능을 안다.
- 모듈 객체는 앱이 시작할 때 모듈마다 하나씩 만들어진다.
  `OnStart(Host&)`는 GPU와 세션이 생긴 뒤 모든 모듈에 한 번 불린다.
  `OnStop()`은 GPU와 세션을 없애기 전에 불린다.
  파이프라인처럼 무거운 것은 `OnStart`에서 만들어 두고 파일마다 다시 만들지 않는다.

### Java

- `com.sharp.questnative.<id>.Module implements QnModule` 클래스 하나를 둔다.
  `ModuleLoader`가 source → video → image → splat → ui 순서로 이름을 찾아 `onCreate(QnActivity)`를 부른다.
- 소스 모듈은 `onCreate`에서 `SourceRegistry.register(new PcSource(...))`처럼 등록한다.

## 5. Vulkan

### 5.1 core가 만드는 것

- 인스턴스: `xrCreateVulkanInstanceKHR`로 만든다. `VkApplicationInfo.apiVersion = VK_API_VERSION_1_3`.
- 물리 기기: `xrGetVulkanGraphicsDevice2KHR`가 고른다.
  시작할 때 logcat에 한 줄을 남긴다: `[gpu] device=… api=… driver=0x… timestampComputeAndGraphics=…`.
- 큐: graphics와 compute를 함께 지원하는 큐 패밀리 1개에서 큐 1개를 만든다.
  모든 모듈이 이 큐를 같이 쓰고, 제출은 렌더 스레드에서만 한다.
- 핸들은 `Host::Gpu()`(`GpuContext`)로 얻는다: `instance`, `physicalDevice`, `device`, `queueFamilyIndex`, `queue`, `deviceApiVersion`, `getInstanceProcAddr`, `enabledDeviceExtensions`.
  core는 Vulkan 1.0 함수만 직접 링크한다.
  1.1 이상 함수는 모듈이 직접 불러온다(volk: `volkInitialize()` → `volkLoadInstanceOnly(instance)` → `volkLoadDevice(device)`).
- 모듈은 core 핸들을 없애지 않는다.

### 5.2 디바이스 기능 훅

```cpp
void (*fillDeviceFeatures)(VkPhysicalDevice, const qn::DeviceFeatures& supported, qn::DeviceFeatures& requested);
```

- core가 `vkGetPhysicalDeviceFeatures2`로 `supported`를 채운 뒤 각 모듈의 훅을 부른다.
  `supported`에는 `core`, `v11`, `v12`, `v13` 구조체가 들어 있다.
- 기기 버전이 낮으면 구조체가 빠진다.
  `v11`·`v12`는 `hasV12`일 때만, `v13`은 `hasV13`일 때만 유효하다.
- 모듈은 `requested`의 VkBool32만 켠다.
  core는 requested를 supported와 AND해서 기기에 없는 기능을 빼고 로그(`[gpu] N requested feature(s) unsupported`)를 남긴다.
  그래서 1.3이 없는 기기에서도 앱은 뜨고 영상·이미지·UI는 동작한다.
  1.3이 필요한 모듈은 `OnStart`에서 `Gpu().deviceApiVersion`을 보고 스스로 꺼야 한다.
- core가 모르는 기능 구조체는 `requested.extraPNext`에 모듈 소유 메모리로 이어 붙인다.
- 지금 splat 스텁이 켜는 기능: v12 `timelineSemaphore`, v13 `dynamicRendering`, `synchronization2`, `shaderDemoteToHelperInvocation`, `maintenance4`, `subgroupSizeControl`, `computeFullSubgroups`.

### 5.3 셰이더 빌드

```cmake
# cpp/splat/module.cmake
qn_add_shaders(OUT SPLAT_SPV TARGET_ENV vulkan1.3 FILES ${CMAKE_CURRENT_LIST_DIR}/shaders/sort.comp)
list(APPEND QN_SOURCES ${CMAKE_CURRENT_LIST_DIR}/splat_viewer.cpp ${SPLAT_SPV})
```

```cpp
static const uint32_t kSortSpv[] =
#include "sort.comp.spv.inc"
    ;
```

- NDK `shader-tools/<host>/glslc`로 컴파일하고 `-mfmt=c` 결과를 헤더처럼 넣는다.
  출력 폴더는 include 경로에 이미 들어 있다.
- 1.3 전용 코드는 `vulkan1.3`, 어디서나 돌아야 하는 코드는 `vulkan1.1`을 쓴다.
- ABI는 arm64-v8a 하나다.

## 6. 프레임 계약

### 6.1 한 프레임의 순서(렌더 스레드)

1. `PostToRenderThread`로 들어온 일을 처리한다.
2. OpenXR 이벤트를 처리한다(세션 상태 → `OnFocus(visible, focused)`).
3. `xrWaitFrame`, `xrBeginFrame`을 부른다.
4. 입력을 동기화한다.
   활성 모듈을 `inputPriority`가 높은 순서로 `OnInput(InputState)`에 부르고, 처음 `true`를 돌려준 모듈에서 멈춘다.
5. 활성 모듈마다 `Update(FrameInfo)`를 부른다.
6. `shouldRender`일 때만 다음을 한다.
   1. 활성 모듈마다 `SubmitLayers(FrameInfo, LayerSink&)`를 부른다.
   2. 프레임 슬롯의 펜스를 기다린다.
   3. 투영 이미지를 받아 지우고, 활성 모듈마다 `RenderProjection(ProjectionPass)`를 부른다.
   4. 명령 버퍼를 제출하고 이미지를 반납한다.
7. 레이어를 순서(`order`)대로 정렬해 `xrEndFrame`에 넘긴다.

- 활성 모듈은 kOverlay 모듈 전부와, 파일이 열려 있는 뷰어 하나다.
  닫힌 뷰어는 프레임 훅을 받지 않는다.

### 6.2 `FrameInfo`

| 필드 | 뜻 |
|---|---|
| `predictedDisplayTime`, `predictedDisplayPeriod` | 이 프레임이 화면에 나올 예상 시각과 주기 |
| `deltaSeconds` | 앞 프레임과의 시간 차 |
| `frameSlot`, `frameSlotCount` | in-flight 슬롯 번호와 개수(**2**) |
| `shouldRender` | false면 `SubmitLayers`·`RenderProjection`이 불리지 않는다. |
| `head`, `headValid` | 머리 자세(앱 공간) |
| `eyes[2]` | 눈별 `XrPosef`·`XrFovf`(앱 공간) |

- 앱 공간(`Xr().appSpace`)은 XR_EXT_local_floor가 있으면 LOCAL_FLOOR(바닥 높이 0)이고, 없으면 LOCAL이다.
  모든 자세는 이 공간 기준이다.

### 6.3 프레임 슬롯 약속

- in-flight 프레임은 **2개**다(`kFrameSlots = 2`, pocketsplat의 `kFramesInFlight = 2`와 같다).
- core는 슬롯 `i`를 다시 쓰기 전에 그 슬롯으로 제출한 명령 버퍼의 펜스를 기다린다.
  그래서 뷰어가 `frameSlot`별로 둔 버퍼·디스크립터는 같은 슬롯이 돌아왔을 때 GPU가 더는 쓰지 않는다.

### 6.4 투영 레이어(`RenderProjection`)

- core는 투영 스왑체인 1개를 둔다.
  형식은 `VK_FORMAT_R8G8B8A8_SRGB`이고 `arraySize = 2`다(레이어 0 = 왼눈, 1 = 오른눈).
  usage는 COLOR_ATTACHMENT, TRANSFER_DST, SAMPLED, **MUTABLE_FORMAT**이다.
  뷰어는 같은 이미지에 UNORM 뷰를 직접 만들어도 된다.
  깊이 스왑체인은 없고, 멀티뷰도 없다(눈별 2패스).
- `ProjectionPass`에 들어 있는 것:
  - `cmd`: 기록 중인 명령 버퍼. 렌더 패스 밖이므로 뷰어가 `vkCmdBeginRendering`을 직접 부른다.
  - `frameSlot`, `predictedDisplayTime`
  - `eyes[2]`: `image`, `arrayLayer`, `view`(그 레이어의 2D SRGB 뷰), `format`, `extent`, `pose`, `fov`, `fdmImage`, `fdmExtent`
- **이미지 레이아웃 약속**
  - 들어올 때 두 레이어 모두 `VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL`이고 이미 지워져 있다.
    Background 레이어가 있으면 알파 0, 없으면 알파 1로 지운다.
  - 나갈 때 뷰어는 두 레이어를 `VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL`로 돌려놓는다.
  - 제출은 core가 한다. 뷰어는 `cmd`를 끝내거나 제출하지 않는다.
- 여러 모듈이 같은 투영 이미지에 차례로 그릴 수 있다(활성 모듈 순서).
  보통은 활성 뷰어 하나만 그린다.
- 렌더 영역은 `extent`다(= 투영 레이어 `imageRect`).
  해상도 배율을 바꾸면 다음 프레임부터 스왑체인이 새 크기로 다시 만들어지므로 크기에 의존하는 자원도 다시 만든다.

### 6.5 컴포지션 레이어(`SubmitLayers`)

```cpp
sink.AddQuad(qn::kOrderContent, quad);           // XrCompositionLayerQuad
sink.AddCylinder(qn::kOrderUi, cylinder);        // XR_KHR_composition_layer_cylinder
sink.AddEquirect2(qn::kOrderBackground, eq);     // XR_KHR_composition_layer_equirect2
sink.AddProjection(qn::kOrderContent, proj);     // 모듈 소유 투영 레이어(뷰 2개)
```

| 순서 상수 | 값 | 예 |
|---|---|---|
| `kOrderBackground` | -100 | 360°/180° 영상 equirect2 |
| `kOrderProjection` | 0 | core 투영 레이어(3D 장면, splat) |
| `kOrderContent` | 100 | 2D·3D 가상 스크린 quad |
| `kOrderUi` | 200 | 패널, HUD |
| `kOrderOverlay` | 300 | 토스트, 진단 |

- 작은 값이 먼저(뒤에) 그려진다.
  같은 값끼리는 core 투영 → 모듈 등록 순서다.
- Background(< 0) 레이어가 하나라도 있으면 core는 투영 레이어를 알파 0으로 지운다.
  그리고 `XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT`를 켜서 뒤 레이어가 보이게 한다.
- core는 구조체를 복사한다.
  구조체가 가리키는 스왑체인·공간·`next` 체인은 같은 모듈의 다음 `SubmitLayers` 호출까지 살아 있어야 한다.
- equirect(구판)는 Quest 3가 지원하지 않는다. equirect2를 쓴다(compare-direct.md 5절).
- 스테레오 영상은 같은 스왑체인을 눈별 레이어 2장으로 낸다.
  `eyeVisibility` LEFT/RIGHT와 `subImage.imageRect`로 절반씩 지정한다.

### 6.6 Android Surface 스왑체인(영상·UI)

```cpp
XrSwapchainCreateInfo ci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
ci.width = 3840; ci.height = 2160; ci.faceCount = 1; ci.arraySize = 1; ci.mipCount = 1; ci.sampleCount = 1;
XrSwapchain sc; jobject surface;   // surface는 global ref, 모듈이 DeleteGlobalRef 책임
host.CreateSurfaceSwapchain(ci, &sc, &surface);
```

- XR_KHR_android_surface_swapchain이 없으면 false를 돌려준다.
- Surface 스왑체인에는 acquire·wait·release를 부르지 않는다.
  생산자(ExoPlayer, `Surface.lockHardwareCanvas`)가 버퍼를 넣는다.
- 보호 콘텐츠나 동기 플래그가 필요하면 video 모듈이 `XR_FB_android_surface_swapchain_create`를 `optionalXrExtensions`로 요청한다(스텁에 이미 있음).

## 7. 입력

- 액션 세트 하나에 물리 버튼마다 액션 하나를 둔다.
  버튼 재배정은 앱 안에서 한다(quest-app `core/bindings.js`와 같은 모델).
- 바인딩 프로필: `/interaction_profiles/oculus/touch_controller`(Quest 2·3·Pro).

| `HandInput` 필드 | 왼손 | 오른손 |
|---|---|---|
| `aim`, `aimValid` | aim/pose | aim/pose |
| `grip`, `gripValid` | grip/pose | grip/pose |
| `trigger`(0~1), `triggerButton` | trigger/value | trigger/value |
| `squeeze`(0~1), `squeezeButton` | squeeze/value | squeeze/value |
| `stick`(x, y; 위 = +y), `stickClick` | thumbstick | thumbstick |
| `primary` | X | A |
| `secondary` | Y | B |
| `menu` | menu | (없음) |

- `Button`에는 `down`(누르고 있음), `pressed`(이번 프레임에 눌림), `released`(이번 프레임에 뗌)가 있다.
- `triggerButton`·`squeezeButton`은 0.55에서 눌림, 0.45에서 뗌으로 판정한다(히스테리시스).
- 길게 누르기, 두 번 누르기, 스틱 가속은 모듈이 판정한다.
- 시스템(Meta) 버튼은 앱이 받을 수 없다.
- `InputState.focused`가 false면(시스템 메뉴가 떠 있는 등) 모든 값이 0이다.
- 진동: `Host::Haptic(qn::kRight, amplitude, seconds)`.
- **A·B·X·Y(`primary`·`secondary`)와 `menu`는 ui가 맡는다.**
  ui는 레이가 패널 위에 없어도 이 버튼으로 UI 켜기·끄기·옮기기, 목록, 이전·다음을 처리한다.
  `OnInput`은 프레임 단위로만 입력을 가져가므로 뷰어도 같은 값을 받는다. **뷰어는 이 버튼들을 무시한다**(의도된 동작, 14.8절).
  뷰어 동작을 버튼에 걸려면 HUD 컨트롤 id로 내고, 버튼 바꾸기 화면에서 배정한다.
- 입력 순서: ui(`inputPriority` 100)가 먼저 받는다.
  `true`를 돌려주면(레이가 패널 위에 있음 등) 그 프레임에 뷰어는 입력을 받지 않는다.

## 8. 뷰어 계약

```cpp
class Viewer : public Module {
    virtual bool Open(const OpenRequest& request, std::string* error) = 0;
    virtual void Close() = 0;
};
```

- 파일 종류는 `OpenRequest.name`(없으면 `uri`)의 확장자로 뷰어를 고르고, 없으면 `mimeType` 접두어로 고른다.

| 확장자 | 뷰어 |
|---|---|
| .ply .spz .splat | splat |
| .mp4 .m4v .mkv .webm .mov, `video/*` | video |
| .jpg .jpeg .png .webp .heic .heif .avif .gif .bmp, `image/*` | image |

- `Host::OpenMedia(req, &err)`의 동작은 다음과 같다.
  - 다른 뷰어로 바뀌면: 앞의 뷰어를 `Close()`한 뒤 새 뷰어의 `Open`을 부른다.
  - **같은 뷰어가 이어서 열면(다음 사진, 다음 영상): `Close` 없이 `Open`을 다시 부른다.**
    뷰어는 내용을 바꿔 끼우고, 새 내용이 준비될 때까지 앞 내용을 보여 줘도 된다(빈 화면 방지).
  - `Open`이 false면 활성 뷰어가 없어진다(같은 뷰어였으면 core가 `Close`를 부른다).
  `Open`은 렌더 스레드에서 불리므로 오래 걸리는 읽기는 작업 스레드로 넘기고 바로 true를 돌려준다.
  진행 상태는 그 뒤 프레임 훅에서 낸다.
- `OpenRequest`: `uri`(content://, file://, http(s)://), `name`, `mimeType`, `sourceId`, `layoutHint`, `fd`, `size`.
- **fd 소유권**
  - `Open`이 true를 돌려주면 fd는 뷰어 것이다. 뷰어가 다 쓰고 닫는다(늦어도 다음 `Open`이나 `Close`에서).
  - 맞는 뷰어가 없거나 `Open`이 false를 돌려주면 core가 닫는다. 그래서 뷰어는 false를 돌려줄 때 fd를 닫지 않는다.
  - Java에서 `NativeBridge.openMedia`가 false(네이티브 시작 전)를 돌려주면 fd는 Java 호출자가 닫는다.
  `layoutHint`는 quest-app `MediaLayout` 이름(`sbs180`, `mono360`, `tb360`, `sbsScreenFull` …)을 그대로 쓴다.
- **`Open`이 false를 돌려줄 때 `*error`에 사용자에게 보일 짧은 한국어 문장을 넣는다**(예: "이 영상 코덱은 재생할 수 없어요").
  목록 패널에서 연 파일이 실패하면 ui가 그 문장을 토스트로 보여 준다. 비우면 "열지 못했어요"만 보인다.
- Java에서 열 때: `NativeBridge.openMedia(entry, sourceId, fd)` 또는 `NativeBridge.nativeOpenMedia(...)`.
  목록 패널(ui)은 실패 이유를 받으려고 ui 전용 경로로 연다(결과는 같다).
  네이티브가 아직 시작하지 않았으면 false를 돌려주고 요청은 버려진다.
- 지금 세 뷰어 스텁은 모두 `Open`에서 "not implemented"로 false를 돌려준다.

## 9. 소스 계약(Java)

```java
public interface MediaSource {
    String id();                 // "device", "pc", "gdrive"
    String displayName();
    List<MediaEntry> list(String folderId) throws IOException;   // null = 루트
    default int openFd(MediaEntry entry) throws IOException { return -1; }
}
```

- `list`·`openFd`는 I/O를 하므로 작업 스레드에서만 부른다.
- `MediaEntry`: `id`, `name`, `folder`, `mimeType`, `size`, `modifiedMs`, `uri`.
- 등록: `SourceRegistry.register(source)`, 조회: `SourceRegistry.all()`, `find(id)`.
- **스트리밍(URL로 열기)**: fd가 없는 원격 파일은 `MediaEntry.uri`에 `http(s)://` 주소를 넣고 `openFd`가 -1을 돌려준다.
  ui는 그 uri를 `OpenRequest.uri`로 넘기고 `fd = -1`이다. 뷰어는 fd가 없으면 uri를 직접 연다.
  - 넘기는 주소는 **추가 헤더 없이 GET으로 열려야 한다**(뷰어는 인증 헤더를 붙이지 않는다).
  - 인증이 필요한 소스(Google Drive 등)는 앱 안 로컬 프록시(`http://127.0.0.1:<port>/…`)를 띄워 그 주소를 넘긴다(기존 quest-app `sources/proxy-url.js`와 같은 방식).
  - Range 요청(부분 읽기)을 지원해야 영상 탐색과 큰 PLY 읽기가 된다.
  - 뷰어별: video는 Media3로 http(s)를 연다. image·splat은 fd가 없을 때 uri를 내려받거나 스트림으로 읽는다(각 담당).
- 목록 패널(ui)은 등록된 소스마다 트리 뿌리를 만든다. 폴더를 펼치면 `list(folderId)`를 작업 스레드("QnIo")에서 부른다.
  파일을 열 때는 `openFd(entry)`로 fd를 받아 `NativeBridge.openMedia(entry, sourceId, fd)`로 넘긴다.
- 파일 종류는 `core.MediaKind.of(name, mime)`으로 정한다. 뷰어가 확장자를 추가하면 이 목록도 같이 고친다.
- 소스 id "device"(`source.DeviceSource`, 기기 저장소)는 ui 담당이 만들었다. 저장소 권한은 `docs/storage-access.md`를 본다.
- 시스템 2D 화면(파일 선택기, 설정)을 열고 결과를 받으려면 `QnActivity.current().startForResult(intent, callback)`을 쓴다.
- **소스 카드**: 소스의 뿌리가 비었으면(연결 안 됨, 권한 없음) 목록 패널이 카드를 보인다.
  - `String status()`: 카드에 보일 한 줄(null이면 기본 문구). ui 스레드에서 불리므로 I/O 없이 저장해 둔 값을 돌려준다.
  - `boolean hasSetup()`: true면 카드에 [연결 설정] 버튼이 생긴다.
  - `void openSetup(Runnable done)`: 설정 화면(예: 2D 설정 Activity를 `startForResult`로)을 연다. 끝나면 `done`을 부른다(아무 스레드). ui는 그 뒤 뿌리를 다시 읽는다.
  - 기기 소스는 `openSetup` = 폴더 고르기이고, 카드에 [모든 파일 접근] 버튼이 하나 더 있다.

## 10. 렌더 설정(Host)

| 함수 | 확장 | 상태 |
|---|---|---|
| `SetResolutionScale(0.6~1.2)` | 없음 | 구현. 권장 크기 × 배율(최대 크기로 자름)로 다음 프레임에 스왑체인을 다시 만든다. |
| `SetFoveationLevel(kOff/kLow/kMedium/kHigh)` | XR_FB_foveation, XR_FB_foveation_configuration, XR_FB_swapchain_update_state, XR_FB_foveation_vulkan | 확장 활성화, 프로필 생성, `xrUpdateSwapchainFB`까지 구현. **Vulkan에서는 뷰어가 렌더링할 때 `EyeTarget::fdmImage`를 fragment density map으로 붙여야 효과가 난다**(VK_EXT_fragment_density_map). 실기기에서 확인하지 않았다. |
| `SetRefreshRate(72/90/120)`, `SupportedRefreshRates()` | XR_FB_display_refresh_rate | 구현. 바뀌면 logcat에 `[core] refresh rate a -> b Hz`가 남는다. |

- 확장이 없으면 함수는 false를 돌려주고 로그를 남긴다.

## 11. 로그

- logcat 태그는 `QuestNative` 하나이고, 메시지 앞에 `[모듈 id]`를 붙인다(`QN_LOGI("[splat] …")`).
- 보는 법: `adb logcat -s QuestNative`.
- 시작할 때 core가 남기는 줄: 런타임 확장 목록, `[gpu] device=… api=…`, 투영 스왑체인 크기, 등록된 모듈, 켜진 1.3 기능.

## 12. 빌드·설치

- `build.bat`(더블클릭): JDK(Android Studio jbr)와 SDK(`%LOCALAPPDATA%\Android\Sdk`)를 찾아 `gradlew assembleRelease`를 돌린다.
  - 출력: `%LOCALAPPDATA%\sharp-quest-native\<체크아웃 폴더>\app\outputs\apk\release\app-release.apk`
  - `QN_BUILD_ROOT` 환경 변수로 출력 위치를 바꿀 수 있다.
  - 인수를 하나 주면(`build.bat nopause`) 마지막에 멈추지 않는다.
  - 에이전트 셸에서는 `cmd /c "C:\…\quest-native\build.bat" nopause`처럼 전체 경로로 부른다(`NoDefaultCurrentDirectoryInExePath` 때문).
- `install.bat`: `adb install -r -g` 후 `com.sharp.questnative/.core.QnActivity`를 실행한다.
- 필요한 SDK 구성: NDK 28.1.13356709, CMake 3.22.1, platform android-36(Media3 1.11 때문, targetSdk는 32 유지), build-tools 35 이상, JDK 17 이상.
- 시험용 자동 열기: 모듈이 스스로 파일을 열지 않는다(임시 자동 열기 코드는 뺀다).
  시험할 때는 intent extra `qn.open`으로 연다. 시험 파일은 **앱 전용 폴더**에 둔다(권한 없이 읽힌다).
  ```
  adb push a.mp4 /sdcard/Android/data/com.sharp.questnative/files/a.mp4
  adb shell am start -n com.sharp.questnative/.core.QnActivity --es qn.open file:///sdcard/Android/data/com.sharp.questnative/files/a.mp4
  ```
  - 이 폴더는 앱을 한 번 설치·실행하면 생긴다. 없으면 `adb shell mkdir -p /sdcard/Android/data/com.sharp.questnative/files`.
  - `/sdcard/Movies`, `/sdcard/Download` 같은 공유 폴더는 "모든 파일 접근"을 켜야 `file://`로 읽힌다(`docs/storage-access.md`).
    켜는 법: 앱 목록 패널의 [모든 파일 접근] 버튼, 또는 `adb shell appops set --uid com.sharp.questnative MANAGE_EXTERNAL_STORAGE allow`(Quest에서 아직 시험하지 않음).
  - 앱을 지우면 앱 전용 폴더도 지워진다.
  core(`QnActivity`)가 네이티브가 시작되기를 기다렸다가(최대 15초) `NativeBridge.nativeOpenMedia`로 넘긴다.
- release는 아직 디버그 키로 서명한다(사이드로드 전용). 스토어용 서명은 나중에 정한다.

## 13. 아직 없는 것(다음 미션)

- (14절 HUD 계약은 정함) 파일 탐색, VR UI 그리기, 세 뷰어의 실제 구현, PC·드라이브 소스, 버튼 재배정 화면.
- 깊이 레이어(XR_KHR_composition_layer_depth), 손 추적, 성능 레벨(XR_EXT_performance_settings).
- 실기기 확인. 이 뼈대는 빌드와 정적 검사까지만 확인했다(Quest 미연결).

## 14. HUD 연결(뷰어 ↔ ui)

뷰어(video·image·splat)는 HUD를 직접 그리지 않는다.
뷰어는 상태와 명령을 **데이터(HUD 모델)**로 내고, ui 모듈이 그 모델을 공용 패널 부품으로 그린다.
사용자가 누르거나 끈 결과는 ui가 뷰어에게 명령(action)으로 돌려준다.

### 14.1 두 가지 연결 방법(뷰어마다 하나를 고름)

| 방법 | 맞는 뷰어 | 구현할 것 |
|---|---|---|
| C++ | 상태가 C++에 있는 뷰어(splat, image) | `qn::Viewer::DescribeHud(hud::Model&)`, `OnHudAction(id, value, phase)`(`core/qn_hud.h`). 정확히 같은 시그니처에 `override`를 붙이고, 같은 이름의 다른 오버로드는 만들지 않는다(`-Woverloaded-virtual`) |
| Java | 상태가 Java에 있는 뷰어(video의 Media3) | `com.sharp.questnative.ui.hud.HudProvider`를 만들어 `Hud.register("video", provider)` |

- ui는 활성 뷰어의 모듈 id로 등록된 Java provider를 먼저 찾는다.
  없으면 C++ 뷰어의 `DescribeHud`를 부른다.
- 두 언어의 모델은 필드가 같다(`hud::Model` ↔ `HudModel`, `hud::Control` ↔ `HudControl`).

### 14.2 모델

| 필드 | 뜻 |
|---|---|
| `title` | 제목 줄(보통 파일 이름) |
| `subtitle` | 메타 줄(예: "VR180 좌우 · 3840×1920") |
| `status` | 경고·안내 한 줄. 비면 숨김 |
| `controls` | 컨트롤 목록(아래) |
| `diagnostics` | 진단 줄. 사용자가 HUD의 [진단] 화면을 열었을 때만 보인다 |

| 컨트롤 종류 | 값 | 사용자가 하면 오는 명령 |
|---|---|---|
| `kButton` | — | `(id, 1, kCommit)` |
| `kToggle` | 0/1 | `(id, 새 값, kCommit)` |
| `kSlider` | `min`~`max`, `step`(0 = 연속), `format` | 드래그 중 `(id, 값, kChange)` 여러 번, 놓을 때 `(id, 값, kCommit)` |
| `kSeek` | `value` = 위치(초), `max` = 길이(초), `secondary` = 버퍼(초) | 슬라이더와 같다 |
| `kChoice` | `options[value]` | ◀ ▶로 `(id, 새 인덱스, kCommit)` |
| `kLabel` | `label`만 | 없음 |

- `format`: `"time"`(mm:ss), `"percent"`, `"x"`(1.25x), `""`(값 표시 안 함).
- 배치: `page`는 `"main"`(기본 화면) 또는 `"more"`([더 보기] 화면, splat은 [PLY 옵션]으로 보임)다.
  같은 `page`, 같은 `row`의 컨트롤은 한 줄에 순서대로 놓인다.
  위치·크기·글씨 맞춤은 ui가 정한다.
- `label`은 한국어로 쓴다. ui가 시스템 글꼴로 그리고, 넘치면 줄이거나 두 줄로 나누거나 …로 자른다.

### 14.3 호출 규칙

- ui는 HUD가 보이는 동안 모델을 **초당 최대 10번**, 그리고 명령을 보낸 직후에 한 번 가져간다.
  바로 다시 그리게 하려면 `qn::ui::InvalidateHud()`(Java `Hud.invalidate()`)를 부른다.
- C++ `DescribeHud`·`OnHudAction`은 렌더 스레드에서 불린다.
  Java `describe`·`onAction`은 ui 그리기 스레드에서 불린다(메인·렌더 스레드가 아님).
  Java provider는 스레드 안전하게 만들고 빨리 돌아와야 한다.
- `kChange`는 드래그하는 동안 매 프레임 올 수 있다.
  영상 탐색은 `kChange`에서 미리보기만 하고 `kCommit`에서 실제로 옮기는 식으로 쓴다(기존 앱은 200ms 간격 seek).
- 모델의 `id`는 파일이 바뀌어도 같게 유지한다. ui는 id로 드래그 상태를 기억한다.

### 14.4 ui가 직접 두는 버튼(뷰어 모델에 넣지 않음)

- [목록], [더 보기]/[PLY 옵션], [진단] 화면, HUD 닫기(✕), [이전], [다음], [슬라이드쇼], 슬라이드쇼 간격
  (이전·다음은 X 버튼과 HUD 아래쪽, 슬라이드쇼는 HUD 아래쪽과 [설정]의 간격)
- 파일 사이 이동과 슬라이드쇼는 ui가 목록 기준으로 처리한다(기존 `core/slideshow.js`, `core/nav-history.js`).
  영상이 끝나면 video가 `qn::ui::NotifyMediaEnded()`(Java `Hud.notifyMediaEnded()`)만 부른다.

### 14.5 권장 컨트롤 id

같은 뜻이면 이 id를 쓴다.
버튼 바꾸기 화면(feature-parity #10)이 "동작"을 이 id로 가리키므로, id를 맞춰야 컨트롤러 버튼으로 같은 명령을 보낼 수 있다.

| 뷰어 | id | 종류 | 뜻 |
|---|---|---|---|
| video | `play` | toggle | 재생(1)·일시정지(0) |
| video | `seek` | seek | 탐색 막대 |
| video | `back10`, `fwd10` | button | 10초 뒤로·앞으로 |
| video | `speed` | slider(0.5~2, step 0.25, format "x") 또는 choice | 배속(새 기능) |
| video | `volume` | slider(0~1, format "percent") | 음량(새 기능) |
| video | `mute` | toggle | 소리 끔 |
| video | `loop` | toggle | 반복 |
| video, image | `layout` | choice | 형식(VR180 좌우, 360 위아래 …) |
| video, image | `swapEyes` | toggle | 눈 바꿈 |
| video, image | `recenter` | button | 화면 위치 맞춤 |
| video, image | `zoomIn`, `zoomOut` | button | 줌 |
| splat | `quality` | choice | 화질 프리셋 |
| splat | `fitView` | button | 전체 보기(크기·위치 맞춤) |
| splat | `pointSize` | slider | 점 크기 |
| splat | `keepPose` | toggle | 자세 유지 |
| splat | `prefetch` | toggle | 다음 파일 미리 받기 |
| splat | `autoQuality` | toggle | 자동 조절 |
| splat | `measure` | button | 프레임 측정 |

### 14.6 아이콘 이름

`icon`을 비우면 글씨만 그린다.
ui가 그릴 수 있는 이름: `play`, `pause`, `back10`, `fwd10`, `prev`, `next`, `list`, `more`, `zoomIn`, `zoomOut`, `slideshow`, `volume`, `mute`, `loop`, `speed`, `recenter`, `swapEyes`, `diag`, `close`.
새 아이콘이 필요하면 ui 담당에게 요청한다.

### 14.7 ui에게 부탁하는 함수

| C++(`#include "ui/ui_api.h"`, 렌더 스레드) | Java(`com.sharp.questnative.ui.hud.Hud`, 아무 스레드) | 뜻 |
|---|---|---|
| `qn::ui::Toast(text, seconds)` | `Hud.toast(text, seconds)` | 짧은 안내(기본 3초) |
| `qn::ui::InvalidateHud()` | `Hud.invalidate()` | 모델을 곧 다시 가져가 그림 |
| `qn::ui::SetHudVisible(bool)`, `HudVisible()` | `Hud.setVisible(bool)` | HUD 보이기·숨기기 |
| `qn::ui::PanelOpen()` | — | 공용 목록 패널이 열려 있나(그동안 HUD는 숨김) |
| `qn::ui::NotifyMediaEnded()` | `Hud.notifyMediaEnded()` | 재생이 끝남 |

### 14.8 입력 나눔

- 레이가 ui 패널·HUD 위에 있으면 ui가 그 프레임의 입력을 가져간다(`OnInput`이 true).
  이때 뷰어는 입력을 받지 않는다.
- 레이가 패널 밖에 있으면 뷰어가 입력을 받는다.
  예: video는 패널 밖 트리거로 `SetHudVisible(!HudVisible())`를 부른다(기존 앱 동작).
- A·B·X·Y(`primary`·`secondary`)와 `menu`는 ui가 맡는다(기본 배정: B/Y 짧게 = UI 켜기·끄기, B/Y 길게 = UI를 보는 곳으로 옮기기, A = 목록, X = 이전·다음).
  `OnInput`은 프레임 단위로만 입력을 가져가므로, 뷰어는 이 버튼들을 직접 쓰지 않는다.
  뷰어 동작을 버튼에 걸고 싶으면 HUD 컨트롤 id로 낸다. 버튼 바꾸기 화면이 그 id를 버튼에 배정한다.
- HUD는 마지막 조작 뒤 9초가 지나면 ui가 숨긴다.
  뷰어는 필요하면 `SetHudVisible(true)`로 다시 띄운다.

### 14.9 지금 상태

- HUD 그리기, 토스트, 레이 포인터(호버·클릭·드래그·스틱 스크롤), 입력 나눔이 구현돼 있다(15절).
- 슬라이드쇼: 사진·PLY는 간격(3/5/10/30초)마다, 영상은 `NotifyMediaEnded`가 오면 다음 파일로 넘어간다.
- 실기기에서 확인하지 않았다. 특히 Surface 그림의 위아래 방향과 투명 모서리는 기기에서 봐야 한다.

## 15. ui 패널 부품(구현 메모)

다른 모듈은 이 절을 몰라도 된다(HUD는 14절 데이터만 내면 그려진다).
ui 모듈을 고치는 사람을 위한 메모다.

- 패널 3개를 Android Surface 스왑체인으로 만들고 quad 레이어로 낸다.
  | id | 패널 | 픽셀 | 크기(m) | 위치(앵커 기준) | 레이어 순서 |
  |---|---|---|---|---|---|
  | 0 | 목록(공용 패널) | 1024×768 | 1.2×0.9 | 정면 1.4m, 눈높이 | Ui |
  | 1 | HUD | 1024×400 | 1.2×0.47 | 눈높이 아래 30°, 1.3m, 눈 쪽으로 기울임 | Ui |
  | 2 | 토스트 | 768×96 | 0.8×0.1 | 목록 위 | Overlay |
- 앵커: 처음 머리 자세가 잡힐 때와 B/Y 길게 누를 때, 머리의 수평 방향(yaw)과 위치로 정한다. 방(앱 공간)에 고정되고 머리를 따라오지 않는다.
- 그리기: Java `Panel`이 `Surface.lockHardwareCanvas()`로 ui 그리기 스레드("QnUiDraw")에서 그린다. 바뀐 때만 다시 그린다.
- 레이: C++가 양손 aim 레이와 패널 평면의 교점을 픽셀로 바꿔 Java에 보낸다(hover, down, up, leave, scroll). 트리거를 누른 채 끌면 패널 밖으로 나가도 그 패널이 계속 받는다.
- 부품(Java `com.sharp.questnative.ui`): `Widgets.Button`(토글 포함), `Widgets.Slider`(탐색 막대 포함), `Widgets.Choice`(◀ ▶), `Widgets.Label`, `VirtualList`(보이는 줄만 그림, 스틱을 오래 밀수록 빨라짐, 끌어서 스크롤), `LabelFit`(quest-app `core/label-fit.js` 이식), `Icons`(14.6 이름).
- 버튼 배정: [설정] > [버튼 바꾸기]에서 A·B·X·Y·메뉴의 짧게·길게 10칸에 동작을 고른다.
  동작은 앱 동작(UI 켜기·끄기, UI 옮기기, 목록, 이전·다음, 슬라이드쇼, 재생 컨트롤 보이기) 또는 `hud:<id>`(14.5절 id)다.
  `hud:<id>`는 활성 뷰어에 그 id가 있을 때만 듣는다. 토글은 뒤집고, 선택은 다음 값으로 넘긴다.
- 보이기 규칙: 목록이 열려 있으면 HUD는 숨긴다(한 번에 한 창). 파일을 열면 목록이 닫히고 HUD가 보인다. HUD는 조작이 없으면 9초 뒤 숨는다.

## 16. 페이지 올리기(설정 항목·진단 화면)

다른 모듈이 목록 패널에 자기 페이지를 올리는 방법이다.
소스의 설정(PC 주소 입력, 드라이브 로그인)과 진단 화면(코덱 목록, 시험 영상 측정)이 이 길을 쓴다.
페이지 내용은 HUD와 같은 데이터(`HudModel`)로 내고, 그리기·입력은 ui가 한다.

### 16.1 Java API(`com.sharp.questnative.ui`)

```java
public interface UiPage {
    String id();      // 예: "source.pc", "video.diag"
    String title();   // 메뉴와 페이지 제목(한국어)
    String group();   // UiPage.GROUP_SETTINGS 또는 UiPage.GROUP_DIAGNOSTICS
    HudModel describe();                                      // 페이지 내용(14.2절과 같은 모델)
    void onAction(String controlId, float value, int phase);  // 14.2절과 같은 명령
}

UiPages.register(page);    // 보통 모듈 Java onCreate에서
UiPages.unregister(id);
UiPages.open(id);          // 목록 패널을 그 페이지로 연다(예: 로그인 결과를 보여 줄 때)
UiPages.invalidate();      // 내용이 바뀌었으니 곧 다시 가져가 그린다
UiPages.askText(title, initial, allowedChars, cb);  // 패널 위 키패드로 짧은 글자 입력
```

### 16.2 보이는 곳

- 목록 패널 위쪽의 [설정] 버튼 → 설정 화면.
  - 설정 화면 맨 위에는 ui 자체 항목이 있다: 해상도 배율, 주사율, 포비에이션, 슬라이드쇼 간격, 버튼 바꾸기, 오픈소스 고지.
  - 그 아래에 `GROUP_SETTINGS` 페이지가 등록 순서대로 한 줄씩 보인다. 줄을 누르면 그 페이지가 열린다.
- 설정 화면의 [진단] → `GROUP_DIAGNOSTICS` 페이지 목록.
  - HUD의 [진단] 화면(14절, 지금 보는 파일의 진단 줄)과는 따로다.
  - 앱 전체 진단(코덱 목록, 측정)은 여기에 둔다.

### 16.3 그리기 규칙

- 모델의 `title`은 무시하고 `UiPage.title()`을 제목으로 쓴다.
  `subtitle`·`status`는 제목 아래에 보인다.
- `controls`는 HUD와 같은 규칙(`row`로 줄, 종류별 폭)으로 위에서부터 놓인다. `page` 필드는 무시한다.
- `diagnostics` 줄은 컨트롤 아래에 스크롤 목록으로 보인다(줄 수 제한 없음, 고정폭 아님).
- 페이지가 열려 있는 동안 `describe()`를 초당 최대 10번 가져간다.
- 버튼에서 시스템 2D 화면(로그인 브라우저 등)을 열 때는 `QnActivity.current().startForResult(intent, cb)`를 쓴다.

### 16.4 글자 입력(키패드)

- `askText(title, initial, allowedChars, cb)`: 목록 패널에 키패드를 띄운다.
  `allowedChars`의 글자만 키로 보인다(예: PC 주소는 `"0123456789.:"`).
  ⌫, [지우기], [확인], [취소]가 있다.
- `cb.onText(text)`는 ui 그리기 스레드에서 불린다. 취소하면 `null`이다.
  키패드가 닫히면 부른 페이지로 돌아간다.
- 영문자 키보드는 아직 없다. 필요하면 ui 담당에게 요청한다.

### 16.5 왜 2D 화면이 아니라 VR 패널인가

설정·고지·글자 입력을 별도 2D Android Activity로 두는 방안과 VR 패널로 두는 방안 중 **VR 패널**을 골랐다.

- Quest에서 몰입 앱이 2D Activity를 열면 몰입 화면을 떠나 2D 창으로 바뀐다.
  돌아올 때 세션이 일시정지·재개되어 뷰어 상태(재생 위치, 장면 자세)가 흔들릴 수 있다.
- 기존 웹 앱 사용자는 설정을 2D 브라우저 화면에서 했다.
  새 앱은 2D 화면이 없으므로, VR 안에서 끝나야 헤드셋을 쓴 채로 쓸 수 있다.
- 필요한 입력이 짧다. PC 주소는 숫자와 `.:` 정도라 키패드로 충분하고, 나머지는 버튼·슬라이더·선택이다.
- 패널 부품(15절)을 그대로 쓰므로 새 UI 기술이 필요 없다.
- 예외: 시스템이 주는 화면(폴더 선택기, 모든 파일 접근 설정, 구글 로그인 브라우저)은 시스템 2D 화면을 그대로 쓴다.
  앱이 대신 만들 수 없기 때문이다(`startForResult`).
- 예외 2: 소스의 연결 설정(PC 주소 입력 등)은 소스 담당이 2D 설정 Activity(시스템 키보드)로 만들어도 된다(9절 소스 카드 `openSetup`).
  긴 글자 입력은 시스템 키보드가 낫고, 연결 설정은 자주 하지 않아 몰입 화면을 잠시 떠나도 괜찮다.
  VR 키패드(`askText`)는 숫자 위주의 짧은 입력을 VR 안에서 끝내고 싶을 때 쓴다.

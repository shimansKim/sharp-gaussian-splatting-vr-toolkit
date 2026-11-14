# splat/third_party — 들여온 코드

| 폴더 | 원본 | 버전 | 라이선스(원문 파일) | 들인 범위 |
|---|---|---|---|---|
| `pocketsplat/` | https://github.com/Artemarius/pocketsplat | 커밋 `826ead7`(2026-11-10) | MIT (`pocketsplat/LICENSE`) | `core/include` 전체, `core/src`의 `cleaning`·`coords`·`pack`·`stats`, `render/`(창 스왑체인 `vk_swapchain`과 `sortbench` 제외), 셰이더 12개, `THIRD_PARTY.md` |
| `volk/` | https://github.com/zeux/volk | `vulkan-sdk-1.4.357.0` | MIT (`volk/LICENSE.md`) | `volk.h`, `volk.c` |
| `vma/` | https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator | `v3.4.0` | MIT (`vma/LICENSE.txt`) | `vk_mem_alloc.h` |
| `glm_shim/` | quest-native 자체 작성 | — | 저장소 라이선스 | glm 1.0.3(MIT)의 `packHalf1x16`·`unpackHalf1x16` 두 함수를 같은 이름으로 대신한다. glm 전체를 들이지 않으려고 직접 짰다. numpy float16과 20만 값에서 비트 단위로 같았다. |

## 바꾼 점

최초 통합 diff는 `pocketsplat/quest-native.patch`(원본 `826ead7` 대비)에 있다.
그 뒤 추가한 Quest 성능 패치는 `pocketsplat/quest-native-perf.patch`에 있다.
두 패치는 이 순서로 적용한다.
아래 목록 밖의 파일은 원본과 같다(CRLF/LF 차이만 있음).

1. `Context::init_external`: OpenXR 런타임이 만든 Vulkan 핸들(인스턴스·디바이스·큐)을 빌린다.
   - 처리 내용
     - volk를 그 `vkGetInstanceProcAddr`로 초기화한다.
     - 1.3 버전과 기능 지원 여부를 확인한다.
     - VMA를 만든다.
     - `destroy()`는 VMA만 해제한다.
   - 대상 파일: `vk_context.h/.cpp`
2. `POCKETSPLAT_NO_VKBOOTSTRAP`: 정의하면 vk-bootstrap을 쓰는 `Context::init`이 빠진다. 그래서 vk-bootstrap을 들이지 않는다. 대상 파일은 `vk_context.cpp`다.
3. fragment density map(포비에이션):
   - `GraphicsPipelineCreateInfo::fragment_density_map`과 `SplatRenderer::set_fragment_density_map`을 추가했다.
   - 켜면 그리기 파이프라인을 `VK_PIPELINE_CREATE_RENDERING_FRAGMENT_DENSITY_MAP_ATTACHMENT_BIT_EXT`로 만든다.
   - 대상 파일: `vk_pipeline.h/.cpp`, `splat_renderer.h/.cpp`

4. 공유 스테레오와 비용 조절:
   - `DrawView`로 가운데 카메라의 레코드에 눈별 배율·오프셋·시차를 적용한다.
   - 레코드 마지막 32비트에는 지원 반경과 역깊이를 반정밀도로 나누어 넣는다.
   - 프래그먼트 지원 반경·alpha cutoff와 기여 컬링의 기준 픽셀 수를 조절한다.
   - 대상 파일: `splat_renderer.h/.cpp`, `splat.vert`, `splat.frag`, `splat_preprocess.comp`, `splat_pick.comp`.
   - `splat_half.frag`는 기존 커널의 mediump 비교용 변형이다. 기본값은 highp다.
   - 중심 위치 투영은 평행한 눈에 맞지만 공분산은 가운데 눈을 공유하는 근사다.
     비평행 눈과 앞뒤로 어긋난 눈은 호스트가 눈별 렌더로 돌린다.
   - 새 라이브러리는 추가하지 않았다. 공간별 예산 선택은 `engine/splat_scene.cpp`의 자체 코드다.

## 빌드 방식(splat/engine.cmake)

- 앱 대상은 C++17이고 libvulkan 프로토타입을 쓴다.
  그래서 pocketsplat·volk·VMA는 C++20 정적 라이브러리 `qn_splat_engine`로 따로 빌드한다.
- volk는 `VOLK_NAMESPACE`로 C++ 이름공간 `volk` 안에 둔다.
  이렇게 하면 core가 링크한 libvulkan의 `vk*` 기호와 같은 .so 안에서 부딪치지 않는다(llvm-nm으로 확인).
- 셰이더는 core의 `qn_add_shaders`(NDK glslc, vulkan1.3)로 만든다.
  pocketsplat이 기대하는 `<이름>_<확장자>.spv.h`는 `engine.cmake`가 감싸서 만든다.
- Vulkan 헤더는 NDK sysroot의 것(VK_HEADER_VERSION 275)을 쓴다. 따로 들이지 않는다.

## 쓰지 않는 것

- pocketsplat의 `spz` 경로(nianticlabs/spz, zstd BSD/GPLv2 이중 라이선스, zlib)는 들이지 않는다.
- SHARP PLY는 `engine/sharp_ply.cpp`로 읽는다.

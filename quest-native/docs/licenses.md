# quest-native 구성요소 라이선스

이 표는 quest-native 앱(APK)에 들어가는 구성요소와 빌드에만 쓰는 도구를 모두 적는다.
원칙: **앱에 들어가는 것 중 유료·GPL 구성요소는 0개**로 유지한다.
새 구성요소를 들이는 PR은 같은 PR에서 이 표에 한 줄을 추가한다.

기준: 2026-11-14, `qn/skeleton` 브랜치. 확인 방법은 각 줄의 "근거" 칸에 적었다.

## 1. APK에 들어가는 것

| 구성요소 | 버전 | 라이선스 | APK 안 위치 | 근거 | 출처 |
|---|---|---|---|---|---|
| Khronos OpenXR loader for Android | 1.1.65 | Apache-2.0 | `lib/arm64-v8a/libopenxr_loader.so` | Maven POM `<license>Apache-2.0` | https://central.sonatype.com/artifact/org.khronos.openxr/openxr_loader_for_android , https://github.com/KhronosGroup/OpenXR-SDK-Source |
| Android NDK `android_native_app_glue` | NDK 28.1.13356709 | Apache-2.0 | `libquestnative.so`에 정적 링크 | NDK `sources/android/native_app_glue/NOTICE` | https://developer.android.com/ndk |
| LLVM libc++ (`libc++_shared.so`) | NDK 28.1.13356709 | Apache-2.0 WITH LLVM-exception | `lib/arm64-v8a/libc++_shared.so` | LLVM 프로젝트 라이선스 | https://libcxx.llvm.org/ |
| AndroidX Media3 (exoplayer, common, container, datasource, database, decoder, extractor) | 1.11.1 | Apache-2.0 | `classes.dex` | Maven POM `<license>` Apache-2.0 | https://github.com/androidx/media |
| Guava (`guava`, `failureaccess`, `listenablefuture` 빈 패키지) | 33.3.1-android, 1.0.2, 9999.0 | Apache-2.0 | `classes.dex` | Media3 common의 의존성. Maven POM | https://github.com/google/guava |
| AndroidX annotation, annotation-experimental | 1.6.0, 1.3.1 | Apache-2.0 | `classes.dex` | Media3 의존성. Maven POM | https://developer.android.com/jetpack/androidx/releases/annotation |
| AndroidX exifinterface | 1.3.6 | Apache-2.0 | `classes.dex` | Media3 의존성. Maven POM | https://developer.android.com/jetpack/androidx/releases/exifinterface |
| Kotlin 표준 라이브러리(`kotlin-stdlib`, `-common`) | 1.8.0 | Apache-2.0 | `classes.dex`, `kotlin/*.kotlin_builtins` | AndroidX annotation의 의존성. Maven POM | https://github.com/JetBrains/kotlin |
| JetBrains annotations | 13.0 | Apache-2.0 | `classes.dex` | kotlin-stdlib의 의존성. Maven POM | https://github.com/JetBrains/java-annotations |
| pocketsplat(splat 렌더러: core 일부·render·셰이더, 패치 3건) | 커밋 826ead7 | MIT | `libquestnative.so`에 정적 링크 | `cpp/splat/third_party/pocketsplat/LICENSE`, 바꾼 점은 `third_party/README.md`·`quest-native.patch` | https://github.com/Artemarius/pocketsplat |
| volk(Vulkan 함수 로더, `VOLK_NAMESPACE`) | vulkan-sdk-1.4.357.0 | MIT | `libquestnative.so`에 정적 링크 | `cpp/splat/third_party/volk/LICENSE.md` | https://github.com/zeux/volk |
| Vulkan Memory Allocator | 3.4.0 | MIT | `libquestnative.so`에 정적 링크 | `cpp/splat/third_party/vma/LICENSE.txt` | https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator |
| quest-native 자체 코드 | 0.1.0 | 저장소 라이선스를 따름 | `libquestnative.so`, `classes.dex` | — | 이 저장소 |

- splat: glm은 들이지 않았다. pocketsplat이 쓰는 반정밀도 변환 두 함수만 자체 작성 헤더(`cpp/splat/third_party/glm_shim`)로 대신한다.
  pocketsplat의 spz 경로(spz MIT, zstd BSD/GPLv2 이중, zlib)와 vk-bootstrap도 들이지 않았다.
- splat 측정 도구(`cpp/splat/tools`의 `offscreen_bench`·`sharp_pack_check`)는 APK에 들어가지 않는다. 같은 소스와 위 구성요소만 쓴다.
- Android 플랫폼 라이브러리(`libvulkan.so`, `libandroid.so`, `liblog.so`, NativeActivity)는 기기 OS에 들어 있고 APK에 넣지 않는다.

## 2. 컴파일할 때만 쓰는 것(APK에 코드가 들어가지 않음)

| 구성요소 | 버전 | 라이선스 | 근거 | 출처 |
|---|---|---|---|---|
| OpenXR 헤더(`openxr.h`, `openxr_platform.h`) | 1.1.65 | Apache-2.0 OR MIT | OpenXR-SDK-Source | https://github.com/KhronosGroup/OpenXR-SDK-Source |
| Vulkan 헤더(NDK sysroot) | VK_HEADER_VERSION 275 | Apache-2.0 | `vulkan_core.h`의 `SPDX-License-Identifier: Apache-2.0` | https://github.com/KhronosGroup/Vulkan-Headers |

## 3. 빌드 도구(앱에 들어가지 않음)

| 도구 | 버전 | 라이선스 | 출처 |
|---|---|---|---|
| Gradle(wrapper) | 8.13 | Apache-2.0 | https://gradle.org |
| Android Gradle Plugin | 8.13.0 | Apache-2.0 | https://developer.android.com/build |
| Android SDK, NDK, CMake | platform 36, NDK 28.1.13356709, CMake 3.22.1 | Android Software Development Kit License(무료, 동의 필요) | https://developer.android.com/studio/terms |
| shaderc `glslc`(NDK 포함) | shaderc v2022.3 | Apache-2.0 | https://github.com/google/shaderc |
| JUnit 4(+ Hamcrest core 1.3), JVM 단위 시험 전용 | 4.13.2 | EPL-1.0(Hamcrest: BSD-3-Clause) | https://junit.org/junit4/ |
| ffmpeg(각자 설치, `tools\diag_make_videos.bat`이 부름) | 6.1 이상 | 빌드에 따라 LGPL 또는 GPL(이 PC의 gyan.dev 빌드는 GPL) | https://ffmpeg.org/legal.html |
| JDK(Android Studio jbr) | 17 이상 | GPLv2 + Classpath Exception | https://openjdk.org/legal/gplv2+ce.html |

- JDK는 빌드할 때만 쓰고 앱에 들어가지 않으므로 GPL 0개 원칙에 걸리지 않는다.
- ffmpeg는 시험 영상을 PC에서 만들 때만 쓰고, 저장소에 넣거나 앱에 담지 않는다(encoding-guide.md 4.3절).
- JUnit은 `testImplementation`이라 APK에 들어가지 않는다(`gradlew :app:testReleaseUnitTest`에서만 쓴다).
- Media3 1.11은 compileSdk 36을 요구한다. 그래서 `app/build.gradle`의 compileSdk를 36으로 올렸다(targetSdk는 32 그대로). 빌드 PC에 SDK platform android-36이 있어야 한다.

## 4. 들일 예정(아직 없음)

다음 미션에서 들여올 때 위 1절로 옮긴다.

| 구성요소 | 라이선스 | 쓸 모듈 | 출처 |
|---|---|---|---|
| (대안) SplatKit | MIT | splat | https://github.com/Xget7/splatkit-android |
| Noto Sans KR(쓸 경우, 시스템 글꼴로 충분하면 안 넣음) | SIL OFL 1.1 | ui | https://fonts.google.com/noto/specimen/Noto+Sans+KR |

## 5. 쓰지 않는 것

| 구성요소 | 이유 |
|---|---|
| CyVR_Player | GPL-3.0-only. 구조 참고도 코드 사용 없이만 한다(compare-ply.md). |
| Unity, Meta XR SDK, Meta Spatial SDK | 방식 결정(2026-11-13)에서 직접 쌓기를 골랐다. Meta SDK는 독점 라이선스다. |
| Meta OpenXR Mobile SDK 헤더 | 필요한 KHR·FB 확장 정의가 Khronos 헤더에 이미 있다. |

## 6. 앱 안 고지

- 앱의 [설정] > [오픈소스 고지] 화면은 이 문서를 그대로 보여 준다.
  빌드할 때 `app/build.gradle`의 `qnCopyLicenses` 작업이 이 파일과 `docs/license-texts/`(Apache-2.0 전문, LLVM 예외 전문)를 `assets/licenses/`로 복사한다.
  그래서 문서를 고치면 다음 빌드부터 앱 화면도 바뀐다(원본은 하나).
- 새 라이선스 종류(예: MIT, SIL OFL)가 들어오면 그 전문을 `docs/license-texts/`에 넣는다.
  `ui/ListPages.readLicenses()`의 파일 목록에도 이름을 더한다.
- 주의: 저장소 맨 위에 LICENSE 파일이 없다. "quest-native 자체 코드" 줄의 "저장소 라이선스"가 무엇인지는 사람이 정해야 한다.

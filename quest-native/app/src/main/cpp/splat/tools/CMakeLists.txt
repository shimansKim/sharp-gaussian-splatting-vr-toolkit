# adb-shell tools for the splat engine (not part of the APK). Built by quest-native/measure/splat/build_tools.bat
# with the NDK toolchain: offscreen_bench (GPU time without OpenXR) and sharp_pack_check (loader check).
cmake_minimum_required(VERSION 3.22.1)
project(qnsplat_tools LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
if(MSVC)  # PC check build
    add_compile_options(/utf-8)
    add_compile_definitions(_CRT_SECURE_NO_WARNINGS)
endif()
include(${CMAKE_CURRENT_LIST_DIR}/../../cmake/qn_shaders.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/../engine.cmake)
qnsplat_add_engine(qn_splat_engine)

add_executable(offscreen_bench ${CMAKE_CURRENT_LIST_DIR}/offscreen_bench.cpp)
set_target_properties(offscreen_bench PROPERTIES CXX_STANDARD 20)
target_compile_definitions(offscreen_bench PRIVATE VK_NO_PROTOTYPES VOLK_NAMESPACE)
target_link_libraries(offscreen_bench PRIVATE qn_splat_engine)

add_executable(sharp_pack_check ${CMAKE_CURRENT_LIST_DIR}/sharp_pack_check.cpp)
set_target_properties(sharp_pack_check PROPERTIES CXX_STANDARD 20)
target_link_libraries(sharp_pack_check PRIVATE qn_splat_engine)

# Unit tests (no GPU): run on PC (MSVC build) or with adb shell.
foreach(t xr_camera_test frame_log_test)
    add_executable(${t} ${CMAKE_CURRENT_LIST_DIR}/tests/${t}.cpp)
    set_target_properties(${t} PROPERTIES CXX_STANDARD 20)
    target_link_libraries(${t} PRIVATE qn_splat_engine)
endforeach()

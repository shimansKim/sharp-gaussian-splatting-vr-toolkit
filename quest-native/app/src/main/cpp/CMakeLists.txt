# quest-native native build. Owner: foundation.
# Each module adds its own sources in <module>/module.cmake; do not list module files here.
cmake_minimum_required(VERSION 3.22.1)
project(questnative LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(${CMAKE_CURRENT_SOURCE_DIR}/cmake/qn_shaders.cmake)

add_library(native_app_glue STATIC
    ${ANDROID_NDK}/sources/android/native_app_glue/android_native_app_glue.c)
target_include_directories(native_app_glue PUBLIC ${ANDROID_NDK}/sources/android/native_app_glue)

find_package(OpenXR REQUIRED CONFIG)

# Filled by the module.cmake files.
set(QN_SOURCES "")
set(QN_LINK_LIBS "")
set(QN_INCLUDE_DIRS "")

set(QN_MODULES core splat video image ui source)
foreach(m ${QN_MODULES})
    include(${CMAKE_CURRENT_SOURCE_DIR}/${m}/module.cmake)
endforeach()

add_library(questnative SHARED ${QN_SOURCES})
target_include_directories(questnative PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${QN_SHADER_OUT_DIR} ${QN_INCLUDE_DIRS})
target_compile_definitions(questnative PRIVATE XR_USE_PLATFORM_ANDROID XR_USE_GRAPHICS_API_VULKAN)
target_compile_options(questnative PRIVATE -Wall -Wno-unused-parameter)
# NativeActivity looks up ANativeActivity_onCreate; keep it exported.
target_link_options(questnative PRIVATE -u ANativeActivity_onCreate)
target_link_libraries(questnative PRIVATE native_app_glue OpenXR::openxr_loader vulkan android log ${QN_LINK_LIBS})

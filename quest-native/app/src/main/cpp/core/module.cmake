# core module sources. Owner: foundation.
set(QN_CORE_DIR ${CMAKE_CURRENT_LIST_DIR})
list(APPEND QN_SOURCES
    ${QN_CORE_DIR}/main.cpp
    ${QN_CORE_DIR}/app.cpp
    ${QN_CORE_DIR}/xr_setup.cpp
    ${QN_CORE_DIR}/gpu.cpp
    ${QN_CORE_DIR}/input.cpp
    ${QN_CORE_DIR}/settings.cpp
    ${QN_CORE_DIR}/registry.cpp
    ${QN_CORE_DIR}/jni_bridge.cpp
    ${QN_CORE_DIR}/shader_check.cpp)
# Keeps the shader pipeline honest: one tiny shader compiled for each target env.
qn_add_shaders(OUT QN_CORE_SPV13 TARGET_ENV vulkan1.3 FILES ${QN_CORE_DIR}/shaders/fill.comp)
list(APPEND QN_SOURCES ${QN_CORE_SPV13})

# GLSL -> SPIR-V with the NDK glslc. Owner: foundation.
#
#   qn_add_shaders(OUT my_spv TARGET_ENV vulkan1.3 FILES ${CMAKE_CURRENT_LIST_DIR}/shaders/a.comp ...)
#   list(APPEND QN_SOURCES ${my_spv})
#
# Each shader becomes <name>.spv.inc in QN_SHADER_OUT_DIR (on the include path), a C initializer list:
#   static const uint32_t kSpv[] =
#   #include "a.comp.spv.inc"
#   ;
# TARGET_ENV: vulkan1.3 for 1.3-only code (splat), vulkan1.1 for code that must run everywhere.
set(QN_SHADER_OUT_DIR ${CMAKE_CURRENT_BINARY_DIR}/shaders)
file(MAKE_DIRECTORY ${QN_SHADER_OUT_DIR})
find_program(QN_GLSLC glslc
    HINTS ${ANDROID_NDK}/shader-tools/${ANDROID_NDK_HOST_SYSTEM_NAME}
    NO_DEFAULT_PATH)
if(NOT QN_GLSLC)
    message(FATAL_ERROR "glslc not found under ${ANDROID_NDK}/shader-tools")
endif()

function(qn_add_shaders)
    cmake_parse_arguments(ARG "" "OUT;TARGET_ENV" "FILES" ${ARGN})
    if(NOT ARG_TARGET_ENV)
        set(ARG_TARGET_ENV vulkan1.3)
    endif()
    set(outs "")
    foreach(src ${ARG_FILES})
        get_filename_component(name ${src} NAME)
        set(out ${QN_SHADER_OUT_DIR}/${name}.spv.inc)
        add_custom_command(
            OUTPUT ${out}
            COMMAND ${QN_GLSLC} --target-env=${ARG_TARGET_ENV} -O -mfmt=c -o ${out} ${src}
            DEPENDS ${src}
            COMMENT "glslc ${name} (${ARG_TARGET_ENV})"
            VERBATIM)
        list(APPEND outs ${out})
    endforeach()
    set(${ARG_OUT} ${outs} PARENT_SCOPE)
endfunction()

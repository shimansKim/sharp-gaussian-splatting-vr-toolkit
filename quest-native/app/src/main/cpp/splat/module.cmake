# splat module (PLY / Gaussian splat viewer). Owner: splat-dev.
# splat_module.cpp is compiled into the app (C++17, contract hooks). The renderer (pocketsplat + volk +
# VMA + SHARP loader) is a separate C++20 static library: see engine.cmake for why.
include(${CMAKE_CURRENT_LIST_DIR}/engine.cmake)
qnsplat_add_engine(qn_splat_engine)
list(APPEND QN_SOURCES ${CMAKE_CURRENT_LIST_DIR}/splat_module.cpp)
list(APPEND QN_LINK_LIBS qn_splat_engine)

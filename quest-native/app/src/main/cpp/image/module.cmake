# image module (photos, 2D / 3D / 180 / 360). Owner: image-dev.
# image_logic.cpp is pure C++ (also built on a PC by tests/run_tests.bat).
list(APPEND QN_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/image_logic.cpp
    ${CMAKE_CURRENT_LIST_DIR}/image_viewer.cpp)

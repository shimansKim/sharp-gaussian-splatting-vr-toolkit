#pragma once
// SHARP(Apple ml-sharp) PLY 로더. pocketsplat의 splatcore::read_ply는 vertex 이외 요소가 있으면
// 거절하므로(SHARP 출력에는 extrinsic·intrinsic·image_size·frame·disparity·color_space·version이 붙음)
// 이 모듈이 vertex만 읽고 나머지 요소는 메타데이터로 보관한다.
//
// 받는 형식: binary_little_endian 1.0, 첫 요소가 vertex, vertex 속성은 모두 float.
// 필수 속성: x y z, f_dc_0..2, opacity, scale_0..2, rot_0..3. f_rest_*는 0/9/24/45개 허용.
// 그 밖의 vertex 속성(nx 등)은 읽고 버린다. 좌표계는 파일 그대로(SHARP는 OpenCV 카메라 공간 = RDF).

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

#include "splatcore/result.h"
#include "splatcore/splat_cloud.h"

namespace qnsplat {

/** vertex 뒤 요소에서 꺼낸 SHARP 메타데이터. 없는 값은 has_* = false. */
struct SharpMeta {
    bool has_intrinsic = false;
    float intrinsic[9] = {};  // 3x3 행 우선(fx 0 cx / 0 fy cy / 0 0 1), 픽셀 단위
    bool has_extrinsic = false;
    float extrinsic[16] = {};  // 4x4 행 우선
    bool has_image_size = false;
    std::uint32_t image_size[2] = {};  // 원본 이미지 너비, 높이
};

/** 바이트 공급 함수: dst에 최대 n바이트를 채우고 채운 수를 돌려준다(0이면 끝). fd·FILE*·AAsset 어디에나 붙인다. */
using ReadFn = std::function<std::size_t(void* dst, std::size_t n)>;

/** 헤더만 읽어 splat 수를 확인한다(빠름). */
struct SharpPlyInfo {
    std::size_t count = 0;
    int sh_degree = 0;
    bool sharp_extras = false;  // vertex 뒤에 SHARP 요소가 있었는지
};

splatcore::Result<splatcore::SplatCloud> read_sharp_ply(const ReadFn& read, SharpMeta* meta = nullptr,
                                                         SharpPlyInfo* info = nullptr);
splatcore::Result<splatcore::SplatCloud> read_sharp_ply_file(const std::string& path, SharpMeta* meta = nullptr,
                                                              SharpPlyInfo* info = nullptr);
/** 이미 열린 파일 기술자(Android SAF가 준 fd 등)에서 읽는다. fd는 닫지 않는다. */
splatcore::Result<splatcore::SplatCloud> read_sharp_ply_fd(int fd, SharpMeta* meta = nullptr,
                                                            SharpPlyInfo* info = nullptr);

}  // namespace qnsplat

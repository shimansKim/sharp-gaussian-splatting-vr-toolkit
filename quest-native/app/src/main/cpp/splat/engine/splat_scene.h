#pragma once
// SHARP PLY → pocketsplat GpuPack. 뷰어(OpenXR 뼈대)와 독립된 CPU 단계만 담는다.
//
// 순서: 읽기 → RDF→RUB 좌표 변환 → drop_invalid → Morton 재정렬 → (선택) spatial_budget → build_pack.
// 결과 좌표계: RUB(x 오른쪽, y 위, z 뒤). SHARP는 원본 카메라가 원점에서 -z를 보는 자리이므로
// 사용자를 원점에 두면 사진을 찍은 시점에서 장면을 보게 된다.

#include <cstdint>
#include <string>

#include "sharp_ply.h"
#include "splatcore/pack.h"
#include "splatcore/result.h"

namespace qnsplat {

struct LoadOptions {
    /** 0이면 전부. 아니면 Morton 순서에서 공간마다 고르게 N개를 뽑고 면적을 보정한다. */
    std::size_t max_splats = 0;
    /** SH 차수 상한(pocketsplat은 0~1). SHARP는 0차라 영향 없음. */
    int sh_target = 0;
};

struct LoadTimings {
    double read_ms = 0, convert_ms = 0, clean_ms = 0, morton_ms = 0, pack_ms = 0, total_ms = 0;
    std::size_t file_count = 0;     // 파일의 splat 수
    std::size_t dropped_invalid = 0;
    std::size_t packed_count = 0;   // 팩에 들어간 splat 수
    std::size_t gpu_bytes = 0;      // 팩 배열 합계(GPU 업로드 크기)
};

struct SharpScene {
    splatcore::GpuPack pack;
    SharpMeta meta;
    LoadTimings timings;
};

/** Deterministic stratified selection from a Morton-ordered cloud. No-op for 0 or count <= budget.
 * Enlarges retained axes by sqrt(count/budget), capped at 2, to approximately preserve screen coverage.
 * Unlike world-area importance pruning, this does not preferentially erase small foreground detail.
 * A lossy sampling heuristic, not a trained LOD or a guarantee of hole-free reconstruction.
 */
void spatial_budget(splatcore::SplatCloud& cloud, std::size_t budget);

/** ReadFn에서 읽어 팩까지 만든다. */
splatcore::Result<SharpScene> load_sharp_scene(const ReadFn& read, const LoadOptions& options = {});
splatcore::Result<SharpScene> load_sharp_scene_file(const std::string& path, const LoadOptions& options = {});
splatcore::Result<SharpScene> load_sharp_scene_fd(int fd, const LoadOptions& options = {});

/** 로드 결과 한 줄 요약(logcat·측정 파일용). */
std::string describe(const SharpScene& scene);

}  // namespace qnsplat

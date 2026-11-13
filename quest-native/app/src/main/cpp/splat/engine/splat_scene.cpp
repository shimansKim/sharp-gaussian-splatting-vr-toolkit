#include "splat_scene.h"

#include <chrono>
#include <cstdio>
#include <utility>

#include "splatcore/cleaning.h"
#include "splatcore/coords.h"

namespace qnsplat {
namespace {

using Clock = std::chrono::steady_clock;
double ms_since(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

splatcore::Result<SharpScene> finish(splatcore::Result<splatcore::SplatCloud> cloud_result, SharpMeta meta,
                                     double read_ms, const LoadOptions& options) {
    using R = splatcore::Result<SharpScene>;
    if (!cloud_result) return R::failure(cloud_result.error());
    if (options.sh_target != 0 && options.sh_target != 1) return R::failure("sh_target은 0 또는 1");
    splatcore::SplatCloud& cloud = cloud_result.value();

    SharpScene scene;
    scene.meta = meta;
    LoadTimings& t = scene.timings;
    t.read_ms = read_ms;
    t.file_count = cloud.count;

    auto t0 = Clock::now();
    // SHARP·INRIA PLY는 RDF(OpenCV 카메라), pocketsplat 렌더러는 RUB.
    splatcore::convert_coordinates(cloud, splatcore::CoordSystem::kRdf, splatcore::CoordSystem::kRub);
    if (cloud.sh_degree > options.sh_target) splatcore::truncate_sh(cloud, options.sh_target);
    t.convert_ms = ms_since(t0);

    t0 = Clock::now();
    const std::size_t before = cloud.count;
    splatcore::drop_invalid(cloud);
    t.dropped_invalid = before - cloud.count;
    if (options.max_splats > 0 && cloud.count > options.max_splats) splatcore::prune_budget(cloud, options.max_splats);
    t.clean_ms = ms_since(t0);
    if (cloud.count == 0) return R::failure("유효한 splat이 없음");

    t0 = Clock::now();
    splatcore::reorder_morton(cloud, splatcore::robust_aabb(cloud));
    t.morton_ms = ms_since(t0);

    t0 = Clock::now();
    auto pack = splatcore::build_pack(cloud);
    if (!pack) return R::failure(pack.error());
    scene.pack = std::move(pack.value());
    t.pack_ms = ms_since(t0);

    const auto& p = scene.pack;
    t.packed_count = p.header.count;
    t.gpu_bytes = (p.positions.size() + p.chunks.size()) * sizeof(float) +
                  (p.scale_rot.size() + p.color.size() + p.sh1.size()) * sizeof(std::uint32_t);
    t.total_ms = t.read_ms + t.convert_ms + t.clean_ms + t.morton_ms + t.pack_ms;
    return R::success(std::move(scene));
}

template <typename ReadCall>
splatcore::Result<SharpScene> load_with(ReadCall&& call, const LoadOptions& options) {
    SharpMeta meta;
    const auto t0 = Clock::now();
    auto cloud = call(&meta);
    return finish(std::move(cloud), meta, ms_since(t0), options);
}

}  // namespace

splatcore::Result<SharpScene> load_sharp_scene(const ReadFn& read, const LoadOptions& options) {
    return load_with([&](SharpMeta* m) { return read_sharp_ply(read, m); }, options);
}

splatcore::Result<SharpScene> load_sharp_scene_file(const std::string& path, const LoadOptions& options) {
    return load_with([&](SharpMeta* m) { return read_sharp_ply_file(path, m); }, options);
}

splatcore::Result<SharpScene> load_sharp_scene_fd(int fd, const LoadOptions& options) {
    return load_with([&](SharpMeta* m) { return read_sharp_ply_fd(fd, m); }, options);
}

std::string describe(const SharpScene& scene) {
    const LoadTimings& t = scene.timings;
    const auto& h = scene.pack.header;
    char buf[512];
    std::snprintf(buf, sizeof(buf),
                  "splats file=%zu packed=%zu dropped=%zu gpuMB=%.1f | ms read=%.0f convert=%.0f clean=%.0f "
                  "morton=%.0f pack=%.0f total=%.0f | aabb=(%.2f,%.2f,%.2f)-(%.2f,%.2f,%.2f) | fx=%.1f img=%ux%u",
                  t.file_count, t.packed_count, t.dropped_invalid, static_cast<double>(t.gpu_bytes) / (1024.0 * 1024.0),
                  t.read_ms, t.convert_ms, t.clean_ms, t.morton_ms, t.pack_ms, t.total_ms, h.aabb_min[0], h.aabb_min[1],
                  h.aabb_min[2], h.aabb_max[0], h.aabb_max[1], h.aabb_max[2],
                  scene.meta.has_intrinsic ? scene.meta.intrinsic[0] : 0.0f,
                  scene.meta.has_image_size ? scene.meta.image_size[0] : 0u,
                  scene.meta.has_image_size ? scene.meta.image_size[1] : 0u);
    return buf;
}

}  // namespace qnsplat

// 호스트(PC)·Android 공용 점검 도구: SHARP PLY를 팩으로 만들고 값이 맞는지 확인한다.
// 사용: sharp_pack_check <file.ply> [max_splats] [--pspk out.pspk]
//  - 원본 위치 합과 팩 위치 합(RDF→RUB로 y·z 부호 반전)이 같은지 본다(전부 쓸 때만).
//  - 팩 색(RGBA8)의 알파 평균이 원본 sigmoid(opacity) 평균과 맞는지 본다.
//  - fd 경로와 파일 경로 결과가 같은지 본다.
#include <fcntl.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>

#include "sharp_ply.h"
#include "splat_scene.h"

#if defined(_WIN32)
#include <io.h>
#define QN_OPEN _open
#define QN_CLOSE _close
#define QN_RDONLY (_O_RDONLY | _O_BINARY)
#else
#include <unistd.h>
#define QN_OPEN open
#define QN_CLOSE close
#define QN_RDONLY O_RDONLY
#endif

static int fail(const std::string& msg) {
    std::fprintf(stderr, "FAIL: %s\n", msg.c_str());
    return 1;
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: sharp_pack_check <file.ply> [max_splats] [--pspk out.pspk]\n");
        return 2;
    }
    const std::string path = argv[1];
    qnsplat::LoadOptions options;
    std::string pspk_out;
    for (int i = 2; i < argc; ++i) {
        if (std::strcmp(argv[i], "--pspk") == 0 && i + 1 < argc) pspk_out = argv[++i];
        else options.max_splats = static_cast<std::size_t>(std::strtoull(argv[i], nullptr, 10));
    }

    // 1) 원본 그대로 읽기(기준값)
    qnsplat::SharpMeta meta;
    qnsplat::SharpPlyInfo info;
    auto raw = qnsplat::read_sharp_ply_file(path, &meta, &info);
    if (!raw) return fail(raw.error());
    const auto& cloud = raw.value();
    double raw_sum[3] = {0, 0, 0}, raw_alpha = 0;
    for (std::size_t i = 0; i < cloud.count; ++i) {
        for (int a = 0; a < 3; ++a) raw_sum[a] += cloud.positions[3 * i + a];
        raw_alpha += 1.0 / (1.0 + std::exp(-static_cast<double>(cloud.opacities[i])));
    }
    std::printf("header: count=%zu sh=%d sharp_extras=%d intrinsic=%d extrinsic=%d image_size=%d (%ux%u) fx=%.2f\n",
                info.count, info.sh_degree, info.sharp_extras ? 1 : 0, meta.has_intrinsic ? 1 : 0,
                meta.has_extrinsic ? 1 : 0, meta.has_image_size ? 1 : 0, meta.image_size[0], meta.image_size[1],
                meta.intrinsic[0]);

    // 2) 파일 경로로 팩 만들기
    auto scene = qnsplat::load_sharp_scene_file(path, options);
    if (!scene) return fail(scene.error());
    std::printf("file: %s\n", qnsplat::describe(scene.value()).c_str());
    const auto& pack = scene.value().pack;

    // 3) fd 경로도 같은 결과인지
    const int fd = QN_OPEN(path.c_str(), QN_RDONLY);
    if (fd < 0) return fail("open fd");
    auto scene_fd = qnsplat::load_sharp_scene_fd(fd, options);
    QN_CLOSE(fd);
    if (!scene_fd) return fail(scene_fd.error());
    if (scene_fd.value().pack.positions != pack.positions || scene_fd.value().pack.color != pack.color)
        return fail("fd 경로 결과가 파일 경로와 다름");
    std::printf("fd:   same pack (ms total=%.0f)\n", scene_fd.value().timings.total_ms);

    // 4) 값 점검
    const std::size_t n = pack.header.count;
    double pack_sum[3] = {0, 0, 0}, pack_alpha = 0;
    for (std::size_t i = 0; i < n; ++i) {
        for (int a = 0; a < 3; ++a) pack_sum[a] += pack.positions[3 * i + a];
        pack_alpha += static_cast<double>((pack.color[i] >> 24) & 0xFFu) / 255.0;
    }
    std::printf("alpha mean: raw=%.4f pack=%.4f\n", raw_alpha / static_cast<double>(cloud.count),
                pack_alpha / static_cast<double>(n));
    if (options.max_splats == 0 && scene.value().timings.dropped_invalid == 0) {
        const double expect[3] = {raw_sum[0], -raw_sum[1], -raw_sum[2]};
        for (int a = 0; a < 3; ++a) {
            const double tol = 1e-4 * (std::fabs(expect[a]) + static_cast<double>(n));
            if (std::fabs(pack_sum[a] - expect[a]) > tol)
                return fail("위치 합 불일치 축 " + std::to_string(a) + ": " + std::to_string(pack_sum[a]) + " vs " +
                            std::to_string(expect[a]));
        }
        if (std::fabs(pack_alpha / static_cast<double>(n) - raw_alpha / static_cast<double>(cloud.count)) > 0.01)
            return fail("알파 평균 불일치");
        std::printf("check: position sums match (RDF->RUB), alpha mean matches\n");
    } else if (options.max_splats > 0 && n != std::min(options.max_splats, info.count)) {
        return fail("팩 개수가 max_splats와 다름");
    }

    if (!pspk_out.empty()) {
        const auto bytes = pack.serialize();
        std::ofstream out(pspk_out, std::ios::binary);
        out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        std::printf("pspk: %s (%.1f MB)\n", pspk_out.c_str(), static_cast<double>(bytes.size()) / (1024.0 * 1024.0));
    }
    std::printf("OK\n");
    return 0;
}

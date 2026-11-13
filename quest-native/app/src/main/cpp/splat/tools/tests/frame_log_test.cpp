// frame_log 단위 시험: 72Hz 가짜 프레임 2.5초 → 줄 2개, 평균·late·CSV 머리글 확인.
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "frame_log.h"

using namespace qnsplat;

int main() {
    std::vector<std::string> logcat, csv;
    FrameLog log([&](const std::string& l) { logcat.push_back(l); }, [&](const std::string& l) { csv.push_back(l); });
    FrameContext ctx;
    ctx.splats = 1179648;
    ctx.eye_w = 1680;
    ctx.eye_h = 1760;
    ctx.hz = 72;
    ctx.key_bits = 16;
    ctx.label = "sample_1179648";
    int fail = 0;
    for (int i = 0; i <= 180; ++i) {  // 0..2.5초
        FrameSample s;
        s.cpu_ms = 4.0;
        s.gpu_ms = (i % 10 == 0) ? 20.0 : 10.0;  // 10프레임마다 예산(13.9ms) 초과
        s.lc = 3;
        s.ld = 2;
        s.rc = 3;
        s.rd = 2;
        s.vis_l = 800000;
        s.vis_r = 790000;
        log.add(i / 72.0, s, ctx);
    }
    if (logcat.size() != 2) {
        std::printf("FAIL lines=%zu\n", logcat.size());
        ++fail;
    }
    if (csv.size() != 3 || csv[0] != FrameLog::csv_header()) {
        std::printf("FAIL csv=%zu\n", csv.size());
        ++fail;
    }
    if (!logcat.empty()) {
        std::printf("%s\n", logcat[0].c_str());
        double fps = 0, gpu = 0;
        int late = 0;
        const char* p = std::strstr(logcat[0].c_str(), "fps=");
        std::sscanf(p, "fps=%lf", &fps);
        std::sscanf(std::strstr(logcat[0].c_str(), "gpu_ms="), "gpu_ms=%lf", &gpu);
        std::sscanf(std::strstr(logcat[0].c_str(), "late="), "late=%d", &late);
        if (fps < 71.0 || fps > 74.0) { std::printf("FAIL fps=%.2f\n", fps); ++fail; }
        if (gpu < 10.5 || gpu > 11.5) { std::printf("FAIL gpu=%.2f\n", gpu); ++fail; }
        if (late < 7 || late > 8) { std::printf("FAIL late=%d\n", late); ++fail; }
    }
    if (csv.size() > 1) std::printf("%s\n%s\n", csv[0].c_str(), csv[1].c_str());
    if (!fail) std::printf("frame_log_test: all passed\n");
    return fail ? 1 : 0;
}

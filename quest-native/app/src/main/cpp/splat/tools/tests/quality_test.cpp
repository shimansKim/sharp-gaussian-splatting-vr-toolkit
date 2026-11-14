// quality unit tests (no GPU): presets, frame stats, adaptive quality.
#include <algorithm>
#include <cmath>
#include <cstdio>

#include "quality.h"
#include "splat_scene.h"

using namespace qnsplat;

static int g_fail = 0;
#define TRUE_(c)                                                     \
    do {                                                             \
        if (!(c)) {                                                  \
            std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); \
            ++g_fail;                                                \
        }                                                            \
    } while (0)

static void test_presets() {
    TRUE_(quality_choice_ids().size() == 8);
    const auto defaults = quality_preset(kDefaultQuality);
    TRUE_(defaults.id == "safe7" && defaults.label == "안전 7");
    TRUE_(defaults.budget == 800000 && defaults.scale == 0.75f);
    TRUE_(defaults.supportR2 == 4.36f && defaults.alphaCutLsb == 4.0f);
    TRUE_(defaults.sharedStereo && defaults.keyBits == 16);
    TRUE_(defaults.minContribution == 0 && defaults.foveation == 0);
    TRUE_(kDefaultPointSize == 1.10f && !kDefaultAutoQuality);
    TRUE_(quality_choice_labels()[2] == "안전 5");
    TRUE_(quality_choice_index("lite") == 5);
    TRUE_(quality_choice_index("nonsense") == 3);
    const QualityPreset s1 = safe_preset(1), s10 = safe_preset(10);
    TRUE_(s1.scale < s10.scale && s10.scale == 1.0f);
    TRUE_(s1.budget == 200000 && s10.budget == 0);
    TRUE_(s1.minContribution == 0 && s10.minContribution == 0);
    TRUE_(s1.foveation == 0 && s10.foveation == 0);
    // monotonic: never cheaper as the level rises
    for (int l = 1; l < 10; ++l) {
        const QualityPreset a = safe_preset(l), b = safe_preset(l + 1);
        TRUE_(b.scale >= a.scale);
        TRUE_(b.budget == 0 || (a.budget != 0 && b.budget >= a.budget));
        TRUE_(b.foveation <= a.foveation);
        TRUE_(b.supportR2 >= a.supportR2 && b.alphaCutLsb <= a.alphaCutLsb);
    }
    TRUE_(quality_preset("quality").keyBits == 32);
    TRUE_(!quality_preset("quality").sharedStereo);
    TRUE_(safe_preset(5).budget == 600000 && safe_preset(5).scale == 0.70f);
    TRUE_(safe_preset(5).supportR2 == 3.2f && safe_preset(5).alphaCutLsb == 4.0f);
    TRUE_(quality_preset("quest").budget == 300000);
    TRUE_(quality_preset("bogus").id == kDefaultQuality);
    TRUE_(safe_preset(0).level == 1 && safe_preset(99).level == 10);
}

static void test_frame_stats() {
    FrameStats fs;
    for (int i = 0; i < 100; ++i) fs.Add(13.9, false);
    for (int i = 0; i < 100; ++i) fs.Add(i % 10 == 0 ? 40.0 : 13.9, true);
    const FrameSummary s = fs.Summary();
    TRUE_(s.frames == 200 && s.movingFrames == 100 && s.stillFrames == 100);
    TRUE_(std::fabs(s.stillP95Ms - 13.9) < 1e-9);
    TRUE_(s.movingP95Ms == 40.0);
    TRUE_(std::fabs(s.dropRate - 0.05) < 1e-9);
    TRUE_(diagnose_frames(s, 1000.0 / 72) == "motion");
    TRUE_(format_frame_summary(s).find("끊김 5%") != std::string::npos);
    FrameStats slow;
    for (int i = 0; i < 60; ++i) slow.Add(25.0, i % 2 == 0);
    TRUE_(diagnose_frames(slow.Summary(), 1000.0 / 72) == "slow");
    FrameStats few;
    few.Add(10, true);
    TRUE_(diagnose_frames(few.Summary(), 13.9).empty());
    FrameStats cap(10);
    for (int i = 0; i < 25; ++i) cap.Add(1, false);
    TRUE_(cap.size() == 10);
}

static void test_adaptive() {
    const double budget = 1000.0 / 72;
    const AdaptConfig cfg;
    AdaptiveQuality aq;
    aq.SetUserLevel(7);
    double t = 0;
    for (int i = 1; i < cfg.overSeconds; ++i) TRUE_(!aq.AddSecond(++t, 18, 14, budget));
    TRUE_(aq.AddSecond(++t, 18, 14, budget) && aq.level() == 6 && aq.lowered());
    for (int i = 1; i < cfg.cooldownS; ++i) TRUE_(!aq.AddSecond(++t, 18, 14, budget));
    TRUE_(aq.AddSecond(++t, 18, 14, budget) && aq.level() == 5);
    for (int i = 0; i < 100; ++i) aq.AddSecond(++t, 30, 20, budget);
    TRUE_(aq.level() == cfg.floorLevel && aq.level() == 1);
    for (int i = 0; i < 200; ++i) aq.AddSecond(++t, budget, budget * 0.4, budget);
    TRUE_(aq.level() == 7 && !aq.lowered());

    AdaptiveQuality g;
    g.SetUserLevel(5);
    for (int i = 0; i < cfg.overSeconds; ++i) g.AddSecond(i, budget, budget * 0.98, budget);
    TRUE_(g.level() == 4);  // GPU overload alone counts even if the CPU submits on time

    AdaptiveQuality stable;
    stable.SetUserLevel(5);
    for (int i = 0; i < 120; ++i) {
        // Recorded 600k / .70 windows: ~12.16ms GPU, occasional 12.57ms, 72fps.
        TRUE_(!stable.AddSecond(i, budget, i % 20 == 0 ? 12.57 : 12.16, budget));
    }
    TRUE_(stable.level() == 5);
    stable.AddSecond(121, 30, 20, budget);
    stable.AddSecond(122, budget, 8, budget);
    stable.AddSecond(123, 30, 20, budget);
    TRUE_(stable.level() == 5); // isolated spikes must not resize the swapchain

    AdaptiveQuality n;
    n.SetUserLevel(0);
    for (int i = 0; i < 10; ++i) TRUE_(!n.AddSecond(i, 50, 40, budget));
    const QualityPreset user = safe_preset(10);
    const QualityPreset eff = effective_preset(user, 4);
    TRUE_(eff.budget == user.budget && eff.keyBits == user.keyBits && eff.sharedStereo == user.sharedStereo);
    TRUE_(eff.scale == safe_preset(4).scale && eff.minContribution == safe_preset(4).minContribution);
    TRUE_(eff.supportR2 == safe_preset(4).supportR2 && eff.alphaCutLsb == safe_preset(4).alphaCutLsb);
    TRUE_(eff.label.find("자동 4") != std::string::npos);
    TRUE_(effective_preset(user, 10).label == user.label);
}

static void test_spatial_budget() {
    splatcore::SplatCloud original;
    original.resize(1000, 1);
    for (std::size_t i = 0; i < original.count; ++i) {
        for (int a = 0; a < 3; ++a) {
            original.positions[3*i+a] = static_cast<float>(i);
            // A small foreground region must survive despite a large background region.
            original.log_scales[3*i+a] = i < 500 ? -6.0f : 0.0f;
            original.dc[3*i+a] = static_cast<float>(i + a);
        }
        for (int a = 0; a < 4; ++a) original.rotations[4*i+a] = static_cast<float>(i + a);
        original.opacities[i] = static_cast<float>(i);
        for (int a = 0; a < 9; ++a) original.sh[9*i+a] = static_cast<float>(i + a);
    }
    for (std::size_t n : {std::size_t(1), std::size_t(250), std::size_t(777), std::size_t(999)}) {
        auto cloud = original;
        spatial_budget(cloud, n);
        TRUE_(cloud.count == n && cloud.valid_sizes());
        auto repeat = original;
        spatial_budget(repeat, n);
        TRUE_(cloud.positions == repeat.positions);
        for (std::size_t i = 0; i < n; ++i) {
            const auto src = static_cast<std::size_t>(cloud.positions[3*i]);
            TRUE_(src >= i * 1000 / n && src < (i + 1) * 1000 / n);
            TRUE_(cloud.opacities[i] == original.opacities[src]);
            TRUE_(cloud.dc[3*i+2] == original.dc[3*src+2]);
            TRUE_(cloud.rotations[4*i+3] == original.rotations[4*src+3]);
            TRUE_(cloud.sh[9*i+8] == original.sh[9*src+8]);
            const double grow = std::min(2.0, std::sqrt(1000.0 / n));
            TRUE_(std::fabs(cloud.log_scales[3*i] - original.log_scales[3*src] - std::log(grow)) < 1e-6);
        }
    }
    for (std::size_t n : {std::size_t(0), std::size_t(1000), std::size_t(2000)}) {
        auto cloud = original;
        spatial_budget(cloud, n);
        TRUE_(cloud.positions == original.positions && cloud.log_scales == original.log_scales);
    }
}

int main() {
    test_spatial_budget();
    test_presets();
    test_frame_stats();
    test_adaptive();
    if (!g_fail) std::printf("quality_test: all passed\n");
    return g_fail ? 1 : 0;
}

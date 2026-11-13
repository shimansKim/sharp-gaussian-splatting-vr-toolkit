// quality unit tests (no GPU): presets, frame stats, adaptive quality.
#include <cmath>
#include <cstdio>

#include "quality.h"

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
    TRUE_(quality_choice_labels()[2] == "안전 5");
    TRUE_(quality_choice_index("lite") == 5);
    TRUE_(quality_choice_index("nonsense") == 2);
    const QualityPreset s1 = safe_preset(1), s10 = safe_preset(10);
    TRUE_(s1.scale < s10.scale && s10.scale == 1.0f);
    TRUE_(s1.budget == 400000 && s10.budget == 0);
    TRUE_(s1.minContribution > s10.minContribution);
    TRUE_(s1.foveation > 0 && s10.foveation == 0);
    // monotonic: never cheaper as the level rises
    for (int l = 1; l < 10; ++l) {
        const QualityPreset a = safe_preset(l), b = safe_preset(l + 1);
        TRUE_(b.scale >= a.scale);
        TRUE_(b.budget == 0 || (a.budget != 0 && b.budget >= a.budget));
        TRUE_(b.foveation <= a.foveation);
    }
    TRUE_(quality_preset("quality").keyBits == 32);
    TRUE_(quality_preset("quest").budget == 300000);
    TRUE_(quality_preset("bogus").id == "safe5");
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
    AdaptiveQuality aq;
    aq.SetUserLevel(7);
    double t = 0;
    // 2 s over budget: no change yet; 3rd second: one step down
    TRUE_(!aq.AddSecond(t += 1, 18, 12, budget));
    TRUE_(!aq.AddSecond(t += 1, 18, 12, budget));
    TRUE_(aq.AddSecond(t += 1, 18, 12, budget) && aq.level() == 6 && aq.lowered());
    // cooldown: still over, but no change inside 6 s
    TRUE_(!aq.AddSecond(t += 1, 18, 12, budget));
    TRUE_(!aq.AddSecond(t += 1, 18, 12, budget));
    TRUE_(!aq.AddSecond(t += 1, 18, 12, budget));
    TRUE_(!aq.AddSecond(t += 1, 18, 12, budget));
    TRUE_(!aq.AddSecond(t += 1, 18, 12, budget));
    TRUE_(aq.AddSecond(t += 1, 18, 12, budget) && aq.level() == 5);
    // floor at 3
    for (int i = 0; i < 60; ++i) aq.AddSecond(t += 1, 30, 20, budget);
    TRUE_(aq.level() == 3);
    // roomy for 10 s (GPU < 60 % and frames on time): one step up, never above the user's level
    for (int i = 0; i < 200; ++i) aq.AddSecond(t += 1, budget, budget * 0.4, budget);
    TRUE_(aq.level() == 7 && !aq.lowered());
    // a GPU-bound second alone (frame on time) counts as over
    AdaptiveQuality g;
    g.SetUserLevel(5);
    t = 0;
    for (int i = 0; i < 3; ++i) g.AddSecond(t += 1, budget, budget * 0.95, budget);
    TRUE_(g.level() == 4);
    // a single spike second does not change anything (needs 3 in a row)
    AdaptiveQuality s;
    s.SetUserLevel(5);
    t = 0;
    s.AddSecond(t += 1, 30, 20, budget);
    s.AddSecond(t += 1, budget, 8, budget);
    s.AddSecond(t += 1, 30, 20, budget);
    TRUE_(s.level() == 5);
    // named presets: disabled
    AdaptiveQuality n;
    n.SetUserLevel(0);
    for (int i = 0; i < 10; ++i) TRUE_(!n.AddSecond(i, 50, 40, budget));
    // effective preset keeps the user's budget and key, takes the auto level's cheap knobs
    const QualityPreset user = safe_preset(9);
    const QualityPreset eff = effective_preset(user, 4);
    TRUE_(eff.budget == user.budget && eff.keyBits == user.keyBits);
    TRUE_(eff.scale == safe_preset(4).scale && eff.minContribution == safe_preset(4).minContribution);
    TRUE_(eff.label.find("자동 4") != std::string::npos);
    TRUE_(effective_preset(user, 9).label == user.label);
}

int main() {
    test_presets();
    test_frame_stats();
    test_adaptive();
    if (!g_fail) std::printf("quality_test: all passed\n");
    return g_fail ? 1 : 0;
}

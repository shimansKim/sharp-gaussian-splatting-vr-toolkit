#pragma once
// PLY quality presets, adaptive quality and frame statistics (pure C++17, PC unit tests).
// Ports of quest-app viewers/splat/quest-presets.js, adaptive-quality.js, frame-stats.js, rebuilt for
// the native renderer's knobs: resolution scale x splat budget x sort-key bits x foveation x
// contribution cull.
//
// ** The preset numbers are PROVISIONAL (잠정): set from the PC run and published phone figures,
// not from Quest 3. They are fixed after the Quest measurement (quest-native/measure/splat). **

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace qnsplat {

struct QualityPreset {
    std::string id;     // "safe5", "lite", "quest", "quality"
    std::string label;  // Korean, shown in the HUD
    float scale = 1.0f;          // projection resolution scale (Host::SetResolutionScale)
    std::size_t budget = 0;      // splat cap at load, 0 = all (changing it reloads the file)
    int keyBits = 16;            // sort key bits (16 / 32)
    int foveation = 0;           // 0 off .. 3 high (needs the fragment density map)
    float minContribution = 0;   // cull splats below this many reference pixels (pocketsplat)
    int level = 0;               // safe level 1..10, 0 for the named presets
};

/** Choices in HUD order (same as quest-app PRESET_CHOICES): 안전 1/3/5/7/10, 라이트, 초저부하, 고화질. */
const std::vector<std::string>& quality_choice_ids();
std::vector<std::string> quality_choice_labels();
/** Preset for "safe1".."safe10", "lite", "quest", "quality". Unknown ids fall back to safe5. */
QualityPreset quality_preset(const std::string& id);
/** Safe level 1..10 (clamped). */
QualityPreset safe_preset(int level);
/** Index in quality_choice_ids(), or the index of safe5. */
int quality_choice_index(const std::string& id);
constexpr const char* kDefaultQuality = "safe5";

// ---------------------------------------------------------------- frame stats (frame-stats.js)

constexpr float kMovingSpeed = 0.05f;  // m/s
constexpr float kMovingTurn = 0.15f;   // rad/s
inline bool is_head_moving(float speed, float turnSpeed) { return speed > kMovingSpeed || turnSpeed > kMovingTurn; }

struct FrameSummary {
    std::size_t frames = 0;
    double fps = 0, avgMs = 0, p95Ms = 0, worstMs = 0;
    double dropRate = 0;  // share of frames over 1.5x the median (reprojected / stutter)
    std::size_t movingFrames = 0, stillFrames = 0;
    double movingP95Ms = 0, stillP95Ms = 0;
};

class FrameStats {
public:
    explicit FrameStats(std::size_t maxFrames = 720) : max_(maxFrames) {}
    void Add(double ms, bool moving);
    void Reset() { frames_.clear(); }
    FrameSummary Summary() const;
    std::size_t size() const { return frames_.size(); }

private:
    struct F {
        double ms;
        bool moving;
    };
    std::size_t max_;
    std::vector<F> frames_;
};

/** "motion" (slow only while the head moves), "slow" (slow while still), "ok", or "" (too few samples). */
std::string diagnose_frames(const FrameSummary& s, double targetMs);
/** One HUD line: "72fps · 움직일 때 12.1ms · 가만히 11.9ms · 끊김 2%". */
std::string format_frame_summary(const FrameSummary& s);

// ---------------------------------------------------------------- adaptive quality

struct AdaptConfig {
    double cooldownS = 6.0;        // at least this long between two changes
    int overSeconds = 3;           // this many consecutive over-budget seconds -> one step down
    int underSeconds = 10;         // this many consecutive roomy seconds -> one step up (never above the user's choice)
    double overFrameRatio = 1.15;  // avg frame time > budget * this = over
    double overGpuRatio = 0.90;    // or GPU time > budget * this = over
    double underGpuRatio = 0.60;   // GPU time < budget * this (and frames on time) = roomy
    int floorLevel = 3;            // never below safe 3 automatically
};

/**
 * Moves the safe level between floorLevel and the user's level, one step at a time.
 * Only the cheap knobs follow the auto level (resolution scale, contribution cull);
 * the splat budget, key bits and foveation stay at the user's preset (no automatic reload or pipeline rebuild).
 * Feed one sample per second.
 */
class AdaptiveQuality {
public:
    explicit AdaptiveQuality(AdaptConfig cfg = AdaptConfig()) : cfg_(cfg) {}
    /** userLevel: the safe level the user chose (1..10); 0 disables (named presets). */
    void SetUserLevel(int userLevel);
    /** Returns true when the level changed (read level()). */
    bool AddSecond(double nowS, double avgFrameMs, double gpuMs, double budgetMs);
    int level() const { return level_; }
    int userLevel() const { return user_; }
    bool lowered() const { return user_ > 0 && level_ < user_; }
    void Reset();

private:
    AdaptConfig cfg_;
    int user_ = 0, level_ = 0;
    int over_ = 0, under_ = 0;
    double lastChange_ = -1e9;
};

/** The preset actually applied: user's preset, with the cheap knobs of the auto level when lowered. */
QualityPreset effective_preset(const QualityPreset& user, int autoLevel);

}  // namespace qnsplat

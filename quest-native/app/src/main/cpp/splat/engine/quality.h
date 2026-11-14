#pragma once
// PLY quality presets, adaptive quality and frame statistics (pure C++17, PC unit tests).
// Ports of quest-app viewers/splat/quest-presets.js, adaptive-quality.js, frame-stats.js, rebuilt for
// the native renderer's knobs: resolution scale x splat budget x sort-key bits x foveation x
// contribution cull.
//
// Quest 3 policy fixed from the SHARP fixture measurement on 2026-11-14; see measure/splat/results.
// Not a guarantee for all PLY files, head motion, or every safe level. Higher levels prioritize detail.

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
    float supportR2 = 8.0f;       // truncated kernel support radius squared (sigma units)
    float alphaCutLsb = 1.0f;     // primitive support alpha threshold, in 1/255 units
    bool sharedStereo = true;    // shared center-view covariance + sort; quality preset uses per-eye
    int level = 0;               // safe level 1..10, 0 for the named presets
};

/** Choices in HUD order (same as quest-app PRESET_CHOICES): 안전 1/3/5/7/10, 라이트, 초저부하, 고화질. */
const std::vector<std::string>& quality_choice_ids();
std::vector<std::string> quality_choice_labels();
/** Preset for "safe1".."safe10", "lite", "quest", "quality". Unknown ids fall back to the default safe7. */
QualityPreset quality_preset(const std::string& id);
/** Safe level 1..10 (clamped). */
QualityPreset safe_preset(int level);
/** Index in quality_choice_ids(), or the index of the default safe7. */
int quality_choice_index(const std::string& id);
// Wearer preference (2026-11-14): detail over 72fps; auto remains opt-in.
constexpr const char* kDefaultQuality = "safe7";
constexpr float kDefaultPointSize = 1.10f;
constexpr bool kDefaultAutoQuality = false;

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
    double cooldownS = 8.0;        // avoid repeated swapchain rebuilds during a short disturbance
    int overSeconds = 4;           // 4 sustained overloaded windows, not a single load/clock spike
    int underSeconds = 15;         // recovery needs 15 roomy seconds, never above the user's choice
    double overFrameRatio = 1.05;  // below ~68.6fps on a 72Hz display is sustained overload
    double overGpuRatio = 0.95;    // 13.19ms at 72Hz; previous safe5 ~12.16ms stays below this
    double underGpuRatio = 0.65;   // leave headroom when raising resolution (pixel cost is quadratic)
    int floorLevel = 1;            // old floor 3 stopped before enough GPU work was removed
};

/**
 * Moves the safe level between floorLevel and the user's level, one step at a time.
 * Only cheap knobs follow the auto level (resolution, kernel support, alpha cutoff, contribution cull);
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

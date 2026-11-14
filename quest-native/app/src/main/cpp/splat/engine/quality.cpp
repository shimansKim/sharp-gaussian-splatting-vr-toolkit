#include "quality.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace qnsplat {

const std::vector<std::string>& quality_choice_ids() {
    static const std::vector<std::string> ids = {"safe1", "safe3", "safe5", "safe7", "safe10", "lite", "quest", "quality"};
    return ids;
}

std::vector<std::string> quality_choice_labels() {
    std::vector<std::string> out;
    for (const auto& id : quality_choice_ids()) out.push_back(quality_preset(id).label);
    return out;
}

// Quest 3 SHARP fixture policy, measured 2026-11-14 (measure/splat/results).
// Spatially stratified budgets preserve the foreground; world-area importance pruning did not.
// safe5: 600k / 0.70 / support^2 3.2 / alpha 4 LSB. Higher levels prefer detail, NOT a 72fps promise.
// Lower levels were also measured at near/fit views; their extra headroom is for heavier scenes and heat.
QualityPreset safe_preset(int level) {
    level = std::min(10, std::max(1, level));
    QualityPreset p;
    p.id = "safe" + std::to_string(level);
    p.label = "안전 " + std::to_string(level);
    p.level = level;
    const float scales[10] = {0.60f, 0.60f, 0.60f, 0.60f, 0.70f, 0.75f, 0.75f, 0.75f, 1.0f, 1.0f};
    const std::size_t budgets[10] = {200000, 300000, 400000, 500000, 600000, 600000, 800000, 0, 0, 0};
    const float support[10] = {2.2f, 2.6f, 2.8f, 3.0f, 3.2f, 4.36f, 4.36f, 4.36f, 4.36f, 8.0f};
    p.scale = scales[level - 1];
    p.budget = budgets[level - 1];
    p.supportR2 = support[level - 1];
    p.alphaCutLsb = level == 10 ? 1.0f : 4.0f;
    p.keyBits = 16;
    // Foveation level increases and mediump showed little extra benefit at the measured low scales.
    // No contribution cull: it can again remove small foreground details after spatial sampling.
    p.foveation = 0;
    p.minContribution = 0;
    return p;
}

QualityPreset quality_preset(const std::string& id) {
    if (id.rfind("safe", 0) == 0) {
        const int level = std::atoi(id.c_str() + 4);
        if (level >= 1 && level <= 10) return safe_preset(level);
    }
    QualityPreset p;
    p.id = id;
    if (id == "lite") {
        p.label = "라이트";
        p.scale = 0.75f;
        p.budget = 400000;
        p.supportR2 = 4.36f;
        p.alphaCutLsb = 4.0f;
    } else if (id == "quest") {
        p.label = "초저부하";
        p.scale = 0.60f;
        p.budget = 300000;
        p.supportR2 = 3.2f;
        p.alphaCutLsb = 4.0f;
    } else if (id == "quality") {
        p.label = "고화질";
        p.scale = 1.0f;
        p.budget = 0;
        p.keyBits = 32;
        p.sharedStereo = false;
    } else {
        return safe_preset(5);
    }
    return p;
}

int quality_choice_index(const std::string& id) {
    const auto& ids = quality_choice_ids();
    auto it = std::find(ids.begin(), ids.end(), id);
    if (it != ids.end()) return static_cast<int>(it - ids.begin());
    return 2;  // safe5
}

// ---------------------------------------------------------------- frame stats

void FrameStats::Add(double ms, bool moving) {
    if (!(ms > 0) || !std::isfinite(ms)) return;
    frames_.push_back({ms, moving});
    if (frames_.size() > max_) frames_.erase(frames_.begin());
}

static double percentile(const std::vector<double>& sorted, double q) {
    if (sorted.empty()) return 0;
    return sorted[std::min(sorted.size() - 1, static_cast<std::size_t>(std::floor(q * static_cast<double>(sorted.size()))))];
}

FrameSummary FrameStats::Summary() const {
    FrameSummary s;
    std::vector<double> all, mv, st;
    double total = 0;
    for (const F& f : frames_) {
        all.push_back(f.ms);
        (f.moving ? mv : st).push_back(f.ms);
        total += f.ms;
    }
    std::sort(all.begin(), all.end());
    std::sort(mv.begin(), mv.end());
    std::sort(st.begin(), st.end());
    s.frames = all.size();
    s.avgMs = all.empty() ? 0 : total / static_cast<double>(all.size());
    s.fps = s.avgMs > 0 ? 1000.0 / s.avgMs : 0;
    s.p95Ms = percentile(all, 0.95);
    s.worstMs = all.empty() ? 0 : all.back();
    const double median = percentile(all, 0.5);
    std::size_t drops = 0;
    for (double ms : all)
        if (ms > median * 1.5) ++drops;
    s.dropRate = all.empty() ? 0 : static_cast<double>(drops) / static_cast<double>(all.size());
    s.movingFrames = mv.size();
    s.stillFrames = st.size();
    s.movingP95Ms = percentile(mv, 0.95);
    s.stillP95Ms = percentile(st, 0.95);
    return s;
}

std::string diagnose_frames(const FrameSummary& s, double targetMs) {
    if (s.movingFrames < 30 || s.stillFrames < 30) return "";
    const double limit = targetMs * 1.3;
    if (s.movingP95Ms > limit && s.movingP95Ms > s.stillP95Ms * 1.25) return "motion";
    if (s.stillP95Ms > limit) return "slow";
    return "ok";
}

std::string format_frame_summary(const FrameSummary& s) {
    if (s.frames == 0) return "측정 중…";
    char buf[160];
    std::string out;
    std::snprintf(buf, sizeof(buf), "%.0ffps", s.fps);
    out = buf;
    if (s.movingFrames >= 30) {
        std::snprintf(buf, sizeof(buf), " · 움직일 때 %.1fms", s.movingP95Ms);
        out += buf;
    }
    if (s.stillFrames >= 30) {
        std::snprintf(buf, sizeof(buf), " · 가만히 %.1fms", s.stillP95Ms);
        out += buf;
    }
    if (s.movingFrames < 30 && s.stillFrames < 30) {
        std::snprintf(buf, sizeof(buf), " · p95 %.1fms", s.p95Ms);
        out += buf;
    }
    std::snprintf(buf, sizeof(buf), " · 끊김 %.0f%%", s.dropRate * 100.0);
    out += buf;
    return out;
}

// ---------------------------------------------------------------- adaptive quality

void AdaptiveQuality::SetUserLevel(int userLevel) {
    user_ = userLevel > 0 ? std::min(10, userLevel) : 0;
    level_ = user_;
    over_ = under_ = 0;
}

void AdaptiveQuality::Reset() {
    level_ = user_;
    over_ = under_ = 0;
    lastChange_ = -1e9;
}

bool AdaptiveQuality::AddSecond(double now, double avgFrameMs, double gpuMs, double budgetMs) {
    if (user_ <= 0 || !(budgetMs > 0)) return false;
    const bool over = avgFrameMs > budgetMs * cfg_.overFrameRatio || gpuMs > budgetMs * cfg_.overGpuRatio;
    const bool roomy = !over && gpuMs > 0 && gpuMs < budgetMs * cfg_.underGpuRatio && avgFrameMs <= budgetMs * 1.05;
    over_ = over ? over_ + 1 : 0;
    under_ = roomy ? under_ + 1 : 0;
    if (now - lastChange_ < cfg_.cooldownS) return false;
    const int floor = std::min(cfg_.floorLevel, user_);
    if (over_ >= cfg_.overSeconds && level_ > floor) {
        --level_;
        over_ = under_ = 0;
        lastChange_ = now;
        return true;
    }
    if (under_ >= cfg_.underSeconds && level_ < user_) {
        ++level_;
        over_ = under_ = 0;
        lastChange_ = now;
        return true;
    }
    return false;
}

QualityPreset effective_preset(const QualityPreset& user, int autoLevel) {
    if (user.level <= 0 || autoLevel <= 0 || autoLevel >= user.level) return user;
    const QualityPreset a = safe_preset(autoLevel);
    QualityPreset out = user;
    out.scale = a.scale;
    out.minContribution = a.minContribution;
    out.supportR2 = a.supportR2;
    out.alphaCutLsb = a.alphaCutLsb;
    // foveation stays the user's: toggling the density map rebuilds the draw pipelines (a visible stall)
    out.level = autoLevel;
    out.label = user.label + " (자동 " + std::to_string(autoLevel) + ")";
    return out;  // budget and key bits stay the user's (no automatic reload)
}

}  // namespace qnsplat

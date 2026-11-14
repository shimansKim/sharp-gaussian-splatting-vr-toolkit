// splat module: PLY (Gaussian splat) viewer. Owner: splat-dev.
// C++17 side: contract hooks, input, loading thread, quality, HUD. The renderer lives behind
// engine/splat_engine.h (pocketsplat, C++20, volk in its own namespace). Port of quest-app
// viewers/splat/ (splat-viewer.js, splat-math.js, splat-motion.js, splat-options.js,
// quest-presets.js, adaptive-quality.js, frame-stats.js).
//
// Controls (A/B/X/Y/menu belong to the ui, contract 7; viewer actions for those buttons are HUD ids):
//   grip (one hand)        grab the scene: move with the hand, turn with the hand's yaw
//   both grips             scale (hand distance), turn (hand-to-hand line), move (midpoint)
//   left stick             smooth move in the looking direction
//   right stick left/right 30 degree snap turn about the head (the scene turns the way the stick is pushed)
//   right stick up/down    height (the scene moves the way the stick is pushed)
//   right stick click      fit (scene in front, comfortable size); fitted already -> 1:1 immersive
//   left stick click       size back to the fit size (keeps the position)
// HUD ([PLY 옵션]): quality, autoQuality, pointSize, keepPose, prefetch, measure, fitView, zoomIn/zoomOut, ...
//
// Measurement remote control (quest-native/measure/splat), polled once a second; any of
// budget/scale/fov/key turns adaptive quality off for the session:
//   adb shell setprop debug.qnsplat.budget 400000 | .scale 0.8 | .fov 0..3 | .key 16|32 | .hz 90
//   adb shell setprop debug.qnsplat.recenter <new value>   (1:1 immersive at the head)
//   adb shell setprop debug.qnsplat.measure <label>        (30 s; QNSPLAT_SUMMARY line at the end)
//   A/B: .stereo 1|0 (shared sort) | .draw 0..3 | .half 0|1 | .probe 0..6 (timing only) | .minc <px> | .acut <1/255> | .sd2 <r^2> | .maxpx <px>
#include <android/log.h>
#include <dirent.h>
#include <fcntl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/system_properties.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "core/qn_api.h"
#include "core/qn_hud.h"
#include "core/qn_log.h"
#include "engine/quality.h"
#include "engine/scene_motion.h"
#include "engine/splat_engine.h"
#include "engine/splat_scene.h"
#include "ui/ui_api.h"

namespace {

constexpr const char* kMetricsTag = "QNSplat";
constexpr const char* kFdmExtension = "VK_EXT_fragment_density_map";
constexpr double kMeasureSeconds = 10.0;         // HUD [프레임 측정]
constexpr double kRemoteMeasureSeconds = 30.0;   // setprop measure
constexpr std::int64_t kPrefetchMaxBytes = 400LL * 1024 * 1024;
constexpr int kCacheKeep = 8;                    // .pspk files kept in files/cache
constexpr std::int64_t kBigFileBytes = 30LL * 1024 * 1024;

VkPhysicalDeviceFragmentDensityMapFeaturesEXT g_fdmFeature{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FRAGMENT_DENSITY_MAP_FEATURES_EXT};
bool g_fdmRequested = false;

double NowSeconds() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

bool EndsWithNoCase(const std::string& s, const char* suffix) {
    const std::size_t n = std::strlen(suffix);
    if (s.size() < n) return false;
    for (std::size_t i = 0; i < n; ++i)
        if (std::tolower(static_cast<unsigned char>(s[s.size() - n + i])) != suffix[i]) return false;
    return true;
}

std::string Stem(const std::string& name) {
    std::string base = name.substr(name.find_last_of('/') + 1);
    const auto dot = base.find_last_of('.');
    return dot == std::string::npos ? base : base.substr(0, dot);
}

std::string SplatCountText(std::uint32_t n) {
    char buf[32];
    if (n >= 10000) std::snprintf(buf, sizeof(buf), "%.0f만", n / 10000.0);
    else std::snprintf(buf, sizeof(buf), "%u", n);
    return buf;
}

qnsplat::Pose ToPose(const XrPosef& p) {
    qnsplat::Pose r;
    r.orientation = {p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w};
    r.position = {p.position.x, p.position.y, p.position.z};
    return r;
}

qnsplat::Fov ToFov(const XrFovf& f) { return {f.angleLeft, f.angleRight, f.angleUp, f.angleDown}; }

struct LoadResult {
    std::string path;
    std::size_t budget = 0;
    std::unique_ptr<qnsplat::SharpScene> scene;
    qnsplat::SceneBounds bounds;
    std::string error;
    bool fromCache = false;
    double ms = 0;
};

/** Reading progress shared with the loader thread (permille; -1 = processing after the read). */
struct LoadProgress {
    std::atomic<int> permille{0};
};

/** Persisted viewer options (files/splat_options.txt, key=value lines). */
struct Options {
    std::string quality = qnsplat::kDefaultQuality;
    bool autoQuality = true;
    float pointSize = 1.0f;
    bool keepPose = true;
    bool prefetch = true;
};

class SplatViewer final : public qn::Viewer {
public:
    // ================================================================ lifecycle
    void OnStart(qn::Host& host) override {
        host_ = &host;
        const qn::GpuContext& gpu = host.Gpu();
        if (gpu.deviceApiVersion < VK_API_VERSION_1_3) {
            disabled_ = "이 기기는 PLY 표시에 필요한 Vulkan 1.3을 지원하지 않아요";
            QN_LOGW("[splat] disabled: device Vulkan %u.%u < 1.3", VK_API_VERSION_MAJOR(gpu.deviceApiVersion),
                    VK_API_VERSION_MINOR(gpu.deviceApiVersion));
            return;
        }
        qnsplat::EngineGpu eg;
        eg.instance = gpu.instance;
        eg.physicalDevice = gpu.physicalDevice;
        eg.device = gpu.device;
        eg.queue = gpu.queue;
        eg.queueFamily = gpu.queueFamilyIndex;
        eg.getInstanceProcAddr = gpu.getInstanceProcAddr;
        eg.fragmentDensityMapEnabled =
            g_fdmRequested && std::find(gpu.enabledDeviceExtensions.begin(), gpu.enabledDeviceExtensions.end(),
                                        kFdmExtension) != gpu.enabledDeviceExtensions.end();
        fdmAvailable_ = eg.fragmentDensityMapEnabled;
        std::string err;
        engine_ = qnsplat::SplatEngine::Create(eg, &err);
        if (!engine_) {
            disabled_ = "PLY 표시 장치를 시작하지 못했어요";
            QN_LOGE("[splat] engine init failed: %s", err.c_str());
            return;
        }
        QN_LOGI("[splat] engine ready on %s, fragment density map %s", engine_->DeviceName().c_str(),
                fdmAvailable_ ? "on" : "off");
        filesDir_ = ExternalFilesDir();
        if (!filesDir_.empty()) {
            mkdir((filesDir_ + "/ply").c_str(), 0775);
            mkdir((filesDir_ + "/cache").c_str(), 0775);
        }
        LoadOptions();
        SetQualityChoice(options_.quality, /*apply=*/false);
        engine_->SetPointSize(options_.pointSize);
    }

    void OnStop() override {
        ++loadToken_;
        stopping_ = true;
        CloseCsv();
        engine_.reset();
    }

    // ================================================================ viewer
    // Called again without Close when the next file is also a PLY (contract 8): the previous scene stays
    // on screen until the new one is ready. fd: ours only when returning true (we dup it and close the
    // original here); on false core closes it.
    bool Open(const qn::OpenRequest& request, std::string* error) override {
        if (!engine_) {
            if (error) *error = disabled_.empty() ? "PLY 표시 장치가 아직 준비되지 않았어요" : disabled_;
            return false;
        }
        const std::string name = request.name.empty() ? request.uri.substr(request.uri.find_last_of('/') + 1) : request.name;
        if (EndsWithNoCase(name, ".spz") || EndsWithNoCase(name, ".splat")) {
            if (error) *error = "이 PLY 형식(.spz·.splat)은 아직 열 수 없어요";
            return false;
        }
        std::string path;
        if (request.uri.rfind("file://", 0) == 0) path = request.uri.substr(7);
        else if (!request.uri.empty() && request.uri[0] == '/') path = request.uri;
        if (path.empty() && request.fd < 0) {
            if (error) *error = "이 위치의 PLY는 열 수 없어요";
            return false;
        }
        if (request.fd < 0 && access(path.c_str(), R_OK) != 0) {
            if (error) *error = "파일을 읽을 수 없어요(권한이나 경로를 확인하세요)";
            return false;
        }
        int fd = -1;
        if (request.fd >= 0) {
            fd = dup(request.fd);
            if (fd < 0) {
                if (error) *error = "파일을 열지 못했어요";
                return false;  // core closes request.fd
            }
            close(request.fd);
        }
        name_ = name;
        path_ = path;
        fileSize_ = request.size;
        if (!path.empty()) ScanFolder(path.substr(0, path.find_last_of('/')));
        ApplyHostSettings();  // our resolution scale / foveation while a PLY is open
        StartLoad(path, fd);
        return true;
    }

    void Close() override {
        ++loadToken_;
        loading_ = false;
        prefetched_.reset();
        if (engine_) engine_->ClearScene();
        status_.clear();
        hidden_ = true;
        grab_ = GrabState{};
        RestoreHostSettings();
        CloseCsv();
    }

    // ================================================================ frame hooks
    void Update(const qn::FrameInfo& frame) override {
        const double now = NowSeconds();
        dt_ = static_cast<float>(std::min(0.1, std::max(0.0, frame.deltaSeconds)));
        if (frame.predictedDisplayPeriod > 0) hz_ = static_cast<int>(std::lround(1e9 / frame.predictedDisplayPeriod));
        if (frame.headValid) {
            const qnsplat::Pose head = ToPose(frame.head);
            // Head motion for the frame statistics (moving vs still).
            if (headValid_ && dt_ > 0) {
                const float speed = qnsplat::v_len(qnsplat::v_sub(head.position, head_.position)) / dt_;
                const qnsplat::Quat d = qnsplat::q_mul(head.orientation, qnsplat::q_inverse(head_.orientation));
                const float turn = 2.0f * std::acos(std::min(1.0f, std::fabs(d.w))) / dt_;
                headMoving_ = qnsplat::is_head_moving(speed, turn);
            }
            head_ = head;
            headValid_ = true;
        }
        if (engine_ && engine_->HasScene() && frame.deltaSeconds > 0) {
            const double ms = frame.deltaSeconds * 1000.0;
            if (measureUntil_ > 0) measureStats_.Add(ms, headMoving_);
            secondFrames_ += 1;
            secondFrameMs_ += ms;
        }
        if (pendingFit_ && headValid_) DoFit(fitMode_);
        if (now >= nextSecond_) {
            nextSecond_ = now + 1.0;
            OnSecond(now);
        }
        if (measureUntil_ > 0 && now >= measureUntil_) FinishMeasure();
        if (loading_ && now >= nextHudRefresh_) {
            nextHudRefresh_ = now + 0.5;
            qn::ui::InvalidateHud();
        }
    }

    bool OnInput(const qn::InputState& in) override {
        if (!in.focused || !engine_ || !engine_->HasScene() || hidden_) return false;
        const qn::HandInput& l = in.hand[qn::kLeft];
        const qn::HandInput& r = in.hand[qn::kRight];
        bool used = false;
        if (r.stickClick.pressed) {
            CycleView();
            used = true;
        }
        if (l.stickClick.pressed) {
            ResetSize();
            used = true;
        }
        if (UpdateGrab(in)) return true;  // while grabbing, sticks rest (web: same)
        float heading = 0;
        const bool haveHeading = headValid_ && qnsplat::heading_of(head_.orientation, &heading);
        if (qnsplat::apply_locomotion(&anchor_, &motion_, &snap_, head_.position, haveHeading, heading, l.stick.x,
                                      l.stick.y, r.stick.y, r.stick.x, dt_)) {
            movedSinceFit_ = true;
            used = true;
        }
        return used;
    }

    void RenderProjection(const qn::ProjectionPass& pass) override {
        if (!engine_ || !engine_->HasScene() || hidden_) return;
        const VkExtent2D ext = pass.eyes[0].extent;
        if (ext.width != lastExtent_.width || ext.height != lastExtent_.height) {
            engine_->ForgetTargets();  // swapchain rebuilt (resolution scale)
            lastExtent_ = ext;
        }
        qnsplat::EyeTargetDesc eyes[2];
        for (int e = 0; e < 2; ++e) {
            const qn::EyeTarget& t = pass.eyes[e];
            eyes[e].image = t.image;
            eyes[e].arrayLayer = t.arrayLayer;
            eyes[e].extent = t.extent;
            eyes[e].pose = ToPose(t.pose);
            eyes[e].fov = ToFov(t.fov);
            eyes[e].fdmImage = t.fdmImage;
        }
        qnsplat::FrameSample sample;
        engine_->Record(pass.cmd, pass.frameSlot, eyes, qnsplat::anchor_matrix(anchor_), &sample);
        if (sample.gpu_ms > 0) {
            secondGpuMs_ += sample.gpu_ms;
            secondGpuFrames_ += 1;
        }
        qnsplat::FrameContext c;
        c.splats = splats_;
        c.eye_w = ext.width;
        c.eye_h = ext.height;
        c.scale = host_->ResolutionScale();
        c.foveation = foveation_;
        c.key_bits = engine_->KeyBits();
        c.hz = hz_;
        c.label = label_;
        if (frameLog_.add(NowSeconds(), sample, c)) {
            lastLine_ = qnsplat::FrameLog::format_logcat(0, frameLog_.last_fps(), sample, 0, c);
            if (remoteMeasure_) {
                remoteFps_.push_back(frameLog_.last_fps());
                remoteGpu_.push_back(frameLog_.last_gpu_ms());
            }
        }
    }

    // ================================================================ HUD (contract 14)
    bool DescribeHud(qn::hud::Model& out) override {
        out.title = name_.empty() ? "PLY" : name_;
        const qnsplat::QualityPreset eff = EffectivePreset();
        out.subtitle = (splats_ ? SplatCountText(splats_) + " splat · " : std::string()) + eff.label;
        if (!disabled_.empty()) out.status = disabled_;
        else if (loading_) out.status = LoadingText();
        else out.status = status_;

        auto add = [&](const char* id, qn::hud::Kind kind, std::string label, const char* icon, float value,
                       const char* page, int row) -> qn::hud::Control& {
            qn::hud::Control c;
            c.id = id;
            c.kind = kind;
            c.label = std::move(label);
            c.icon = icon;
            c.value = value;
            c.page = page;
            c.row = row;
            out.controls.push_back(std::move(c));
            return out.controls.back();
        };
        const bool ready = engine_ && engine_->HasScene();
        add("fitView", qn::hud::Kind::kButton, fitMode_ == qnsplat::FitMode::kFit && !movedSinceFit_ ? "1:1 몰입" : "전체 보기",
            "recenter", 0, "main", 0).enabled = ready;
        add("zoomOut", qn::hud::Kind::kButton, "작게", "zoomOut", 0, "main", 0).enabled = ready;
        add("zoomIn", qn::hud::Kind::kButton, "크게", "zoomIn", 0, "main", 0).enabled = ready;

        auto& q = add("quality", qn::hud::Kind::kChoice, "화질", "", static_cast<float>(qnsplat::quality_choice_index(options_.quality)),
                      "more", 0);
        q.options = qnsplat::quality_choice_labels();
        add("autoQuality", qn::hud::Kind::kToggle, autoBlocked_ ? "자동 조절(측정 중 꺼짐)" : "자동 조절", "",
            options_.autoQuality ? 1.0f : 0.0f, "more", 0).enabled = !autoBlocked_;
        auto& ps = add("pointSize", qn::hud::Kind::kSlider, "점 크기", "", options_.pointSize, "more", 1);
        ps.min = 0.7f;
        ps.max = 1.5f;
        ps.step = 0.05f;
        ps.format = "x";
        add("keepPose", qn::hud::Kind::kToggle, "다음 PLY에서 자세 유지", "", options_.keepPose ? 1.0f : 0.0f, "more", 2);
        add("prefetch", qn::hud::Kind::kToggle, "다음 PLY 미리 읽기", "", options_.prefetch ? 1.0f : 0.0f, "more", 2);
        add("measure", qn::hud::Kind::kButton, measureUntil_ > 0 ? "측정 중…" : "프레임 측정(10초)", "", 0, "more", 3).enabled =
            ready && measureUntil_ <= 0;
        add("sizeReset", qn::hud::Kind::kButton, "크기 되돌리기", "", 0, "more", 3).enabled = ready;

        if (!measureText_.empty()) out.diagnostics.push_back("측정: " + measureText_);
        if (!lastLine_.empty()) out.diagnostics.push_back(lastLine_);
        if (!loadText_.empty()) out.diagnostics.push_back(loadText_);
        char buf[200];
        std::snprintf(buf, sizeof(buf), "프리셋 %s · 배율 %.2f · splat 상한 %s · 정렬 %dbit · 포비에이션 %d%s", eff.id.c_str(),
                      eff.scale, eff.budget ? SplatCountText(static_cast<std::uint32_t>(eff.budget)).c_str() : "전체",
                      eff.keyBits, eff.foveation, fdmAvailable_ ? "" : "(미지원)");
        out.diagnostics.push_back(buf);
        out.diagnostics.push_back("품질 값은 잠정값입니다(Quest 실측 뒤 확정)");
        return true;
    }

    void OnHudAction(const std::string& id, float value, qn::hud::Phase phase) override {
        const bool commit = phase == qn::hud::Phase::kCommit;
        const int v = static_cast<int>(std::lround(value));
        if (id == "pointSize") {
            options_.pointSize = std::min(1.5f, std::max(0.7f, value));
            if (engine_) engine_->SetPointSize(options_.pointSize);
            if (commit) SaveOptions();
            return;
        }
        if (!commit) return;
        if (id == "fitView") CycleView();
        else if (id == "recenter") ScheduleFit(qnsplat::FitMode::kFit);
        else if (id == "immersive") ScheduleFit(qnsplat::FitMode::kImmersive);
        else if (id == "zoomIn") Zoom(1.25f);
        else if (id == "zoomOut") Zoom(0.8f);
        else if (id == "sizeReset") ResetSize();
        else if (id == "quality") {
            const auto& ids = qnsplat::quality_choice_ids();
            const int n = static_cast<int>(ids.size());
            SetQualityChoice(ids[static_cast<std::size_t>(((v % n) + n) % n)], true);
            Toast("화질: " + qnsplat::quality_preset(options_.quality).label);
        } else if (id == "autoQuality") {
            options_.autoQuality = v != 0;
            adapt_.Reset();
            ApplyQuality();
            Toast(options_.autoQuality ? "자동 조절을 켰어요" : "자동 조절을 껐어요");
        } else if (id == "keepPose") {
            options_.keepPose = v != 0;
        } else if (id == "prefetch") {
            options_.prefetch = v != 0;
            if (!options_.prefetch) prefetched_.reset();
            else MaybePrefetch();
        } else if (id == "measure") {
            StartMeasure();
        }
        SaveOptions();
        qn::ui::InvalidateHud();
    }

private:
    // ================================================================ view (fit, grab, zoom)
    void ScheduleFit(qnsplat::FitMode mode) {
        fitMode_ = mode;
        pendingFit_ = true;
        if (headValid_) DoFit(mode);
    }

    void DoFit(qnsplat::FitMode mode) {
        float heading = 0;
        if (!qnsplat::heading_of(head_.orientation, &heading)) heading = 0;
        anchor_ = qnsplat::fit_transform(bounds_, head_.position, heading, mode);
        fitMode_ = mode;
        pendingFit_ = false;
        movedSinceFit_ = false;
        hidden_ = false;
        motion_.Reset();
        snap_.Reset();
        poseValid_ = true;
        qn::ui::InvalidateHud();
    }

    /** Right stick click / fitView: messed up or immersive -> fit; already fitted -> 1:1 immersive. */
    void CycleView() {
        ScheduleFit(fitMode_ == qnsplat::FitMode::kFit && !movedSinceFit_ ? qnsplat::FitMode::kImmersive
                                                                          : qnsplat::FitMode::kFit);
        Toast(fitMode_ == qnsplat::FitMode::kImmersive ? "1:1 몰입(사진을 찍은 자리)" : "전체 보기");
    }

    void ResetSize() {
        if (!engine_ || !engine_->HasScene()) return;
        anchor_ = qnsplat::reset_size(anchor_, bounds_);
        movedSinceFit_ = true;
        Toast("크기를 맞췄어요");
    }

    void Zoom(float factor) {
        if (!engine_ || !engine_->HasScene()) return;
        anchor_ = qnsplat::zoom_about_center(anchor_, bounds_, factor);
        movedSinceFit_ = true;
    }

    struct GrabState {
        std::string key;  // "", "L", "R", "LR"
        qnsplat::Anchor start;
        qnsplat::HandPose left, right;
    };

    bool UpdateGrab(const qn::InputState& in) {
        const qn::HandInput& l = in.hand[qn::kLeft];
        const qn::HandInput& r = in.hand[qn::kRight];
        const bool lh = grips_[0].Update(l.squeeze) && l.active && l.gripValid;
        const bool rh = grips_[1].Update(r.squeeze) && r.active && r.gripValid;
        const std::string key = std::string(lh ? "L" : "") + (rh ? "R" : "");
        if (key.empty()) {
            grab_ = GrabState{};
            return false;
        }
        const qnsplat::HandPose lp = HandOf(l.grip);
        const qnsplat::HandPose rp = HandOf(r.grip);
        if (grab_.key != key) {  // hand set changed: restart from the current state
            grab_.key = key;
            grab_.start = anchor_;
            grab_.left = lp;
            grab_.right = rp;
            return true;
        }
        if (key == "LR") {
            const float base = qnsplat::fit_scale_of(bounds_);
            anchor_ = qnsplat::two_hand_grab(grab_.start, grab_.left.position, grab_.right.position, lp.position,
                                             rp.position, base * qnsplat::kMinZoom, base * qnsplat::kMaxZoom);
        } else if (key == "L") {
            anchor_ = qnsplat::one_hand_grab(grab_.start, grab_.left, lp);
        } else {
            anchor_ = qnsplat::one_hand_grab(grab_.start, grab_.right, rp);
        }
        movedSinceFit_ = true;
        return true;
    }

    static qnsplat::HandPose HandOf(const XrPosef& p) {
        const qnsplat::Pose q = ToPose(p);
        return {q.position, q.orientation};
    }

    // ================================================================ quality
    qnsplat::QualityPreset EffectivePreset() const {
        const qnsplat::QualityPreset user = qnsplat::quality_preset(options_.quality);
        if (!options_.autoQuality || autoBlocked_) return user;
        return qnsplat::effective_preset(user, adapt_.level());
    }

    void SetQualityChoice(const std::string& id, bool apply) {
        options_.quality = qnsplat::quality_preset(id).id;
        const qnsplat::QualityPreset p = qnsplat::quality_preset(options_.quality);
        adapt_.SetUserLevel(p.level);
        if (apply) ApplyQuality();
    }

    /** Applies the effective preset; remote (setprop) overrides win per knob. */
    void ApplyQuality(bool allowReload = true) {
        if (!engine_) return;
        const qnsplat::QualityPreset eff = EffectivePreset();
        if (!override_.count("key")) engine_->SetKeyBits(eff.keyBits);
        if (!override_.count("minc")) engine_->SetMinContribution(eff.minContribution);
        if (!override_.count("scale") && hostTouched_) SetScale(eff.scale);
        if (!override_.count("fov") && hostTouched_) SetFoveation(eff.foveation);
        const std::size_t wantBudget = override_.count("budget") ? budget_ : eff.budget;
        if (wantBudget != budget_) {
            budget_ = wantBudget;
            if (allowReload && (!path_.empty() || fdKeep_ >= 0)) Reload();
        }
    }

    /** First Open: remember the host settings to restore on Close, then take over. */
    void ApplyHostSettings() {
        if (!hostTouched_) {
            hostScaleBefore_ = host_->ResolutionScale();
            hostTouched_ = true;
        }
        ApplyQuality(/*allowReload=*/false);  // Open loads with the new budget right after
    }

    void RestoreHostSettings() {
        if (!hostTouched_) return;
        host_->SetResolutionScale(hostScaleBefore_);
        if (foveation_ != 0) {
            host_->SetFoveationLevel(qn::FoveationLevel::kOff);
            if (engine_) engine_->SetFoveationAttachment(false, nullptr);
            foveation_ = 0;
        }
        hostTouched_ = false;
    }

    void SetScale(float s) {
        if (std::fabs(host_->ResolutionScale() - s) < 0.005f) return;
        host_->SetResolutionScale(s);
        if (engine_) engine_->ForgetTargets();
    }

    void SetFoveation(int level) {
        level = std::min(3, std::max(0, level));
        if (level > 0 && !fdmAvailable_) level = 0;
        if (level == foveation_ || !engine_) return;
        std::string err;
        if (!engine_->SetFoveationAttachment(level > 0, &err)) {
            QN_LOGW("[splat] foveation: %s", err.c_str());
            return;
        }
        host_->SetFoveationLevel(static_cast<qn::FoveationLevel>(level));
        foveation_ = level;
    }

    /** Once a second: adaptive quality, remote props. */
    void OnSecond(double now) {
        const double avgFrame = secondFrames_ ? secondFrameMs_ / secondFrames_ : 0;
        const double avgGpu = secondGpuFrames_ ? secondGpuMs_ / secondGpuFrames_ : 0;
        secondFrames_ = secondGpuFrames_ = 0;
        secondFrameMs_ = secondGpuMs_ = 0;
        PollProps();
        if (engine_ && engine_->HasScene() && !hidden_ && options_.autoQuality && !autoBlocked_ && hz_ > 0 && avgFrame > 0) {
            const int before = adapt_.level();
            if (adapt_.AddSecond(now, avgFrame, avgGpu, 1000.0 / hz_)) {
                QN_LOGI("[splat] auto quality %d -> %d (frame %.1f ms, gpu %.1f ms, budget %.1f ms)", before,
                        adapt_.level(), avgFrame, avgGpu, 1000.0 / hz_);
                ApplyQuality();
                qn::ui::InvalidateHud();
            }
        }
    }

    // ================================================================ files and loading
    std::string ExternalFilesDir() {
        JNIEnv* env = host_->Env();
        jobject activity = host_->Activity();
        std::string out = "/sdcard/Android/data/com.sharp.questnative/files";
        if (!env || !activity) return out;
        jclass cls = env->GetObjectClass(activity);
        jmethodID m = env->GetMethodID(cls, "getExternalFilesDir", "(Ljava/lang/String;)Ljava/io/File;");
        jobject file = m ? env->CallObjectMethod(activity, m, nullptr) : nullptr;
        if (file && !env->ExceptionCheck()) {
            jclass fcls = env->GetObjectClass(file);
            jmethodID gp = env->GetMethodID(fcls, "getAbsolutePath", "()Ljava/lang/String;");
            auto js = static_cast<jstring>(env->CallObjectMethod(file, gp));
            if (js) {
                const char* c = env->GetStringUTFChars(js, nullptr);
                out = c;
                env->ReleaseStringUTFChars(js, c);
                env->DeleteLocalRef(js);
            }
            env->DeleteLocalRef(fcls);
            env->DeleteLocalRef(file);
        }
        if (env->ExceptionCheck()) env->ExceptionClear();
        env->DeleteLocalRef(cls);
        return out;
    }

    void ScanFolder(const std::string& dir) {
        folder_ = dir;
        files_.clear();
        if (DIR* d = opendir(dir.c_str())) {
            while (dirent* e = readdir(d)) {
                const std::string n = e->d_name;
                if (!n.empty() && n[0] != '.' && EndsWithNoCase(n, ".ply")) files_.push_back(dir + "/" + n);
            }
            closedir(d);
        }
        std::sort(files_.begin(), files_.end());
    }

    std::string CacheKey(int fd, const std::string& path, std::size_t budget) const {
        struct stat st {};
        const bool ok = fd >= 0 ? fstat(fd, &st) == 0 : stat(path.c_str(), &st) == 0;
        if (!ok || filesDir_.empty()) return {};
        return filesDir_ + "/cache/" + Stem(name_) + "_" + std::to_string(static_cast<long long>(st.st_size)) + "_" +
               std::to_string(static_cast<long long>(st.st_mtime)) + "_b" + std::to_string(budget) + ".pspk";
    }

    /** Loader body (worker thread): cache -> PLY with progress -> pack -> bounds. */
    static std::shared_ptr<LoadResult> LoadNow(const std::string& path, int fd, const std::string& cache,
                                               std::size_t budget, LoadProgress* progress) {
        auto result = std::make_shared<LoadResult>();
        result->path = path;
        result->budget = budget;
        const double t0 = NowSeconds();
        result->scene = std::make_unique<qnsplat::SharpScene>();
        bool done = false;
        if (!cache.empty()) {
            if (FILE* f = std::fopen(cache.c_str(), "rb")) {
                std::vector<std::uint8_t> bytes;
                std::fseek(f, 0, SEEK_END);
                bytes.resize(static_cast<std::size_t>(std::max(0L, std::ftell(f))));
                std::fseek(f, 0, SEEK_SET);
                const bool ok = !bytes.empty() && std::fread(bytes.data(), 1, bytes.size(), f) == bytes.size();
                std::fclose(f);
                if (ok) {
                    auto pack = splatcore::parse_pack(bytes);
                    if (pack) {
                        result->scene->pack = std::move(pack.value());
                        result->fromCache = true;
                        done = true;
                    }
                }
            }
        }
        if (!done) {
            int rfd = fd >= 0 ? fd : open(path.c_str(), O_RDONLY | O_CLOEXEC);
            if (fd >= 0) lseek(fd, 0, SEEK_SET);  // a kept dup shares the offset with earlier reads
            if (rfd < 0) {
                result->error = "파일을 열지 못했어요";
                result->scene.reset();
                return result;
            }
            struct stat st {};
            const std::int64_t total = fstat(rfd, &st) == 0 ? static_cast<std::int64_t>(st.st_size) : 0;
            std::int64_t readBytes = 0;
            qnsplat::ReadFn read = [&](void* dst, std::size_t n) -> std::size_t {
                ssize_t got;
                do {
                    got = ::read(rfd, dst, n);
                } while (got < 0 && errno == EINTR);
                if (got <= 0) return 0;
                readBytes += got;
                if (progress && total > 0)
                    progress->permille.store(static_cast<int>(std::min<std::int64_t>(999, readBytes * 1000 / total)));
                return static_cast<std::size_t>(got);
            };
            qnsplat::LoadOptions opt;
            opt.max_splats = budget;
            auto scene = qnsplat::load_sharp_scene(read, opt);
            if (fd < 0) close(rfd);
            if (progress) progress->permille.store(-1);
            if (scene) {
                *result->scene = std::move(scene.value());
                QN_LOGI("[splat] load %s", qnsplat::describe(*result->scene).c_str());
                if (!cache.empty()) {
                    const auto bytes = result->scene->pack.serialize();
                    const std::string tmp = cache + ".tmp";
                    if (FILE* f = std::fopen(tmp.c_str(), "wb")) {
                        const bool ok = std::fwrite(bytes.data(), 1, bytes.size(), f) == bytes.size();
                        std::fclose(f);
                        if (ok) std::rename(tmp.c_str(), cache.c_str());
                        else std::remove(tmp.c_str());
                    }
                }
            } else {
                QN_LOGE("[splat] load failed: %s", scene.error().c_str());
                result->error = "PLY 내용을 읽지 못했어요(SHARP·3DGS PLY만 열 수 있어요)";
                result->scene.reset();
            }
        }
        if (result->scene) {
            const auto& pack = result->scene->pack;
            result->bounds = qnsplat::robust_bounds(pack.positions.data(), pack.header.count);
        }
        result->ms = (NowSeconds() - t0) * 1000.0;
        return result;
    }

    void StartLoad(const std::string& path, int fd) {
        const int token = ++loadToken_;
        if (fdKeep_ >= 0) {
            close(fdKeep_);
            fdKeep_ = -1;
        }
        loading_ = true;
        loadStart_ = NowSeconds();
        progress_ = std::make_shared<LoadProgress>();
        // Prefetched? Use it right away.
        if (prefetched_ && !path.empty() && prefetched_->path == path && prefetched_->budget == budget_) {
            auto ready = prefetched_;
            prefetched_.reset();
            if (fd >= 0) close(fd);
            QN_LOGI("[splat] using prefetched %s", path.c_str());
            host_->PostToRenderThread([this, token, ready] { FinishLoad(token, ready); });
            return;
        }
        prefetched_.reset();
        // fd sources cannot be reopened for a budget change: keep a dup for Reload().
        if (fd >= 0) fdKeep_ = dup(fd);
        const std::string cache = CacheKey(fd, path, budget_);
        if (fileSize_ > kBigFileBytes && cache.empty()) Toast("큰 PLY를 불러오는 중이에요");
        qn::ui::InvalidateHud();
        auto progress = progress_;
        const std::size_t budget = budget_;
        std::thread([this, token, path, fd, cache, budget, progress] {
            auto result = LoadNow(path, fd, cache, budget, progress.get());
            if (fd >= 0) close(fd);
            if (stopping_) return;
            qn::PostIfRunning([this, token, result] { FinishLoad(token, result); });
        }).detach();
    }

    void Reload() {
        if (!path_.empty()) {
            StartLoad(path_, -1);
        } else if (fdKeep_ >= 0) {
            const int fd = dup(fdKeep_);
            if (fd >= 0) {
                lseek(fd, 0, SEEK_SET);
                StartLoad(std::string(), fd);
            }
        }
    }

    void FinishLoad(int token, const std::shared_ptr<LoadResult>& result) {
        if (token != loadToken_ || !engine_) return;  // superseded or closed
        loading_ = false;
        if (!result->scene) {
            status_ = result->error;
            Toast(result->error);
            qn::ui::InvalidateHud();
            return;
        }
        const double t0 = NowSeconds();
        std::string err;
        const bool replacing = engine_->HasScene() && !hidden_;
        if (!engine_->SetScene(result->scene->pack, &err)) {
            status_ = "GPU 메모리에 올리지 못했어요";
            QN_LOGE("[splat] upload failed: %s", err.c_str());
            Toast(status_);
            qn::ui::InvalidateHud();
            return;
        }
        splats_ = result->scene->pack.header.count;
        bounds_ = result->bounds;
        label_ = Stem(name_) + "_" + std::to_string((splats_ + 500) / 1000) + "k";
        status_.clear();
        char buf[200];
        std::snprintf(buf, sizeof(buf), "불러오기 %.0fms%s · GPU 올리기 %.0fms · %u splat", result->ms,
                      result->fromCache ? "(캐시)" : "", (NowSeconds() - t0) * 1000.0, splats_);
        loadText_ = buf;
        QN_LOGI("[splat] ready %s: %s", name_.c_str(), buf);
        if (!(replacing && options_.keepPose && poseValid_)) {
            hidden_ = true;  // show after the fit (no flash at a stale pose)
            ScheduleFit(qnsplat::FitMode::kFit);
        }
        if (!introShown_) {
            introShown_ = true;
            Toast("그립: 잡아 옮기기 · 양손: 크기 · 왼스틱: 이동 · 오른스틱: 회전·높이 · 오른스틱 누름: 맞춤", 6.0f);
        }
        CleanCache();
        MaybePrefetch();
        qn::ui::InvalidateHud();
    }

    /** Reads the next PLY of the folder in the background (one file, size-limited). */
    void MaybePrefetch() {
        if (!options_.prefetch || path_.empty() || files_.size() < 2 || stopping_) return;
        auto it = std::find(files_.begin(), files_.end(), path_);
        if (it == files_.end()) return;
        const std::string next = ++it == files_.end() ? files_.front() : *it;
        if (prefetched_ && prefetched_->path == next && prefetched_->budget == budget_) return;
        struct stat st {};
        if (stat(next.c_str(), &st) != 0 || st.st_size > kPrefetchMaxBytes) return;
        const int token = loadToken_;
        const std::size_t budget = budget_;
        const std::string savedName = name_;
        name_ = next.substr(next.find_last_of('/') + 1);  // CacheKey uses the name
        const std::string cache = CacheKey(-1, next, budget);
        name_ = savedName;
        std::thread([this, token, next, cache, budget] {
            setpriority(PRIO_PROCESS, static_cast<id_t>(gettid()), 10);  // behind rendering
            auto result = LoadNow(next, -1, cache, budget, nullptr);
            if (stopping_ || !result->scene) return;
            qn::PostIfRunning([this, token, result] {
                if (token == loadToken_ && options_.prefetch) prefetched_ = result;
            });
        }).detach();
    }

    void CleanCache() {
        if (filesDir_.empty()) return;
        const std::string dir = filesDir_ + "/cache";
        std::vector<std::pair<long long, std::string>> files;
        if (DIR* d = opendir(dir.c_str())) {
            while (dirent* e = readdir(d)) {
                const std::string n = e->d_name;
                if (!EndsWithNoCase(n, ".pspk")) continue;
                struct stat st {};
                const std::string p = dir + "/" + n;
                if (stat(p.c_str(), &st) == 0) files.push_back({static_cast<long long>(st.st_mtime), p});
            }
            closedir(d);
        }
        if (static_cast<int>(files.size()) <= kCacheKeep) return;
        std::sort(files.begin(), files.end());
        for (std::size_t i = 0; i + kCacheKeep < files.size(); ++i) std::remove(files[i].second.c_str());
    }

    std::string LoadingText() const {
        const int pm = progress_ ? progress_->permille.load() : 0;
        if (pm < 0) return "정리하는 중: " + name_;
        char buf[64];
        std::snprintf(buf, sizeof(buf), "불러오는 중 %d%%: ", pm / 10);
        return buf + name_;
    }

    // ================================================================ measurement
    void StartMeasure() {
        measureStats_.Reset();
        measureUntil_ = NowSeconds() + kMeasureSeconds;
        measureText_.clear();
        Toast("10초 동안 잽니다. 머리를 천천히 좌우로 돌려 보세요");
    }

    void FinishMeasure() {
        measureUntil_ = 0;
        const qnsplat::FrameSummary s = measureStats_.Summary();
        measureText_ = qnsplat::format_frame_summary(s);
        const std::string d = qnsplat::diagnose_frames(s, hz_ > 0 ? 1000.0 / hz_ : 1000.0 / 72);
        if (d == "motion") measureText_ += " · 머리를 움직일 때만 느려요";
        else if (d == "slow") measureText_ += " · 가만히 있어도 느려요(화질을 낮춰 보세요)";
        else if (d == "ok") measureText_ += " · 고릅니다";
        __android_log_print(ANDROID_LOG_INFO, kMetricsTag, "QNSPLAT_FRAMES label=%s frames=%zu fps=%.1f p95=%.2f moving_p95=%.2f still_p95=%.2f drop=%.3f diag=%s",
                            label_.c_str(), s.frames, s.fps, s.p95Ms, s.movingP95Ms, s.stillP95Ms, s.dropRate,
                            d.empty() ? "-" : d.c_str());
        Toast("측정: " + measureText_, 6.0f);
        qn::ui::InvalidateHud();
    }

    // Remote 30 s measurement (QNSPLAT_SUMMARY, same as the measurement build).
    void StartRemoteMeasure(const std::string& tag) {
        remoteMeasure_ = true;
        remoteUntil_ = NowSeconds() + kRemoteMeasureSeconds;
        remoteTag_ = tag;
        remoteFps_.clear();
        remoteGpu_.clear();
        OpenCsv();
        __android_log_print(ANDROID_LOG_INFO, kMetricsTag, "QNSPLAT_MEASURE begin label=%s tag=%s", label_.c_str(), tag.c_str());
    }

    void FinishRemoteMeasure() {
        remoteMeasure_ = false;
        if (remoteFps_.size() > 2) {  // drop the first second
            remoteFps_.erase(remoteFps_.begin());
            remoteGpu_.erase(remoteGpu_.begin());
        }
        std::vector<double> sorted = remoteFps_;
        std::sort(sorted.begin(), sorted.end());
        double gpu = 0;
        for (double g : remoteGpu_) gpu += g;
        gpu = remoteGpu_.empty() ? 0 : gpu / static_cast<double>(remoteGpu_.size());
        char buf[320];
        std::snprintf(buf, sizeof(buf),
                      "QNSPLAT_SUMMARY label=%s tag=%s seconds=%zu fps_median=%.1f fps_min=%.1f gpu_ms=%.2f splats=%u "
                      "eye=%ux%u scale=%.2f fov=%d key=%d hz=%d",
                      label_.c_str(), remoteTag_.c_str(), remoteFps_.size(), sorted.empty() ? 0.0 : sorted[sorted.size() / 2],
                      sorted.empty() ? 0.0 : sorted.front(), gpu, splats_, lastExtent_.width, lastExtent_.height,
                      host_->ResolutionScale(), foveation_, engine_ ? engine_->KeyBits() : 0, hz_);
        __android_log_write(ANDROID_LOG_INFO, kMetricsTag, buf);
    }

    static std::string Prop(const char* name) {
        char v[PROP_VALUE_MAX] = {};
        __system_property_get(name, v);
        return v;
    }

    bool PropChanged(const char* key, std::string* value) {
        const std::string v = Prop((std::string("debug.qnsplat.") + key).c_str());
        std::string& last = props_[key];
        if (v == last) return false;
        last = v;
        *value = v;
        return !v.empty();
    }

    void PollProps() {
        if (remoteMeasure_ && NowSeconds() >= remoteUntil_) FinishRemoteMeasure();
        std::string v;
        auto blockAuto = [&](const char* knob) {
            override_[knob] = true;
            if (!autoBlocked_) QN_LOGI("[splat] remote control: adaptive quality off for this session");
            autoBlocked_ = true;
        };
        if (PropChanged("budget", &v)) {
            blockAuto("budget");
            budget_ = static_cast<std::size_t>(std::strtoull(v.c_str(), nullptr, 10));
            Reload();
        }
        if (PropChanged("scale", &v)) {
            blockAuto("scale");
            SetScale(std::strtof(v.c_str(), nullptr));
        }
        if (PropChanged("fov", &v)) {
            blockAuto("fov");
            SetFoveation(std::atoi(v.c_str()));
        }
        if (PropChanged("key", &v) && engine_) {
            blockAuto("key");
            engine_->SetKeyBits(std::atoi(v.c_str()));
        }
        if (PropChanged("hz", &v)) host_->SetRefreshRate(std::strtof(v.c_str(), nullptr));
        // A/B knobs for the Quest measurement (measure/splat/README.md)
        if (PropChanged("stereo", &v) && engine_) {
            std::string err;
            if (!engine_->SetStereoShared(v == "1", &err)) QN_LOGW("[splat] stereo: %s", err.c_str());
        }
        if (PropChanged("draw", &v) && engine_) engine_->SetDrawMode(std::atoi(v.c_str()));
        if (PropChanged("half", &v) && engine_) engine_->SetHalfFragment(v == "1");
        if (PropChanged("acut", &v) && engine_) engine_->SetAlphaCut(std::strtof(v.c_str(), nullptr));
        if (PropChanged("sd2", &v) && engine_) engine_->SetSupport(std::strtof(v.c_str(), nullptr), engine_->MaxPixelRadius());
        if (PropChanged("maxpx", &v) && engine_) engine_->SetSupport(engine_->SupportR2(), std::strtof(v.c_str(), nullptr));
        if (PropChanged("probe", &v) && engine_) engine_->SetDrawProbe(std::atoi(v.c_str()));
        if (PropChanged("minc", &v) && engine_) {
            blockAuto("minc");
            engine_->SetMinContribution(std::strtof(v.c_str(), nullptr));
        }
        if (PropChanged("recenter", &v)) ScheduleFit(qnsplat::FitMode::kImmersive);
        if (PropChanged("measure", &v)) StartRemoteMeasure(v);
    }

    void OpenCsv() {
        if (csv_ || filesDir_.empty()) return;
        const std::string p = filesDir_ + "/qnsplat_metrics.csv";
        const bool fresh = access(p.c_str(), F_OK) != 0;
        csv_ = std::fopen(p.c_str(), "a");
        if (csv_ && fresh) {
            std::fputs(qnsplat::FrameLog::csv_header(), csv_);
            std::fputc('\n', csv_);
        }
    }

    void CloseCsv() {
        if (csv_) std::fclose(csv_);
        csv_ = nullptr;
    }

    // ================================================================ options
    void LoadOptions() {
        if (filesDir_.empty()) return;
        FILE* f = std::fopen((filesDir_ + "/splat_options.txt").c_str(), "r");
        if (!f) return;
        char line[256];
        while (std::fgets(line, sizeof(line), f)) {
            std::string s(line);
            while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
            const auto eq = s.find('=');
            if (eq == std::string::npos) continue;
            const std::string k = s.substr(0, eq), val = s.substr(eq + 1);
            if (k == "quality") options_.quality = qnsplat::quality_preset(val).id;
            else if (k == "autoQuality") options_.autoQuality = val == "1";
            else if (k == "pointSize") options_.pointSize = std::min(1.5f, std::max(0.7f, std::strtof(val.c_str(), nullptr)));
            else if (k == "keepPose") options_.keepPose = val == "1";
            else if (k == "prefetch") options_.prefetch = val == "1";
        }
        std::fclose(f);
    }

    void SaveOptions() {
        if (filesDir_.empty()) return;
        FILE* f = std::fopen((filesDir_ + "/splat_options.txt").c_str(), "w");
        if (!f) return;
        std::fprintf(f, "quality=%s\nautoQuality=%d\npointSize=%.2f\nkeepPose=%d\nprefetch=%d\n", options_.quality.c_str(),
                     options_.autoQuality ? 1 : 0, options_.pointSize, options_.keepPose ? 1 : 0, options_.prefetch ? 1 : 0);
        std::fclose(f);
    }

    void Toast(const std::string& text, float seconds = 0) {
        QN_LOGI("[splat] %s", text.c_str());
        qn::ui::Toast(text, seconds);
        qn::ui::InvalidateHud();
    }

    // ================================================================ state
    qn::Host* host_ = nullptr;
    std::unique_ptr<qnsplat::SplatEngine> engine_;
    std::string disabled_;
    bool fdmAvailable_ = false;
    std::string filesDir_, folder_;
    std::vector<std::string> files_;
    std::string name_, path_, label_ = "-", status_, loadText_;
    std::int64_t fileSize_ = -1;
    int fdKeep_ = -1;
    std::uint32_t splats_ = 0;
    std::atomic<int> loadToken_{0};
    std::atomic<bool> stopping_{false};
    bool loading_ = false;
    double loadStart_ = 0, nextHudRefresh_ = 0;
    std::shared_ptr<LoadProgress> progress_;
    std::shared_ptr<LoadResult> prefetched_;

    Options options_;
    qnsplat::AdaptiveQuality adapt_;
    std::size_t budget_ = 0;  // budget the current scene was loaded with
    bool autoBlocked_ = false;
    std::map<std::string, bool> override_;
    bool hostTouched_ = false;
    float hostScaleBefore_ = 1.0f;
    int foveation_ = 0;

    qnsplat::Anchor anchor_;
    qnsplat::SceneBounds bounds_;
    qnsplat::FitMode fitMode_ = qnsplat::FitMode::kFit;
    bool pendingFit_ = false, movedSinceFit_ = false, hidden_ = true, poseValid_ = false, introShown_ = false;
    qnsplat::Pose head_;
    bool headValid_ = false, headMoving_ = false;
    qnsplat::GripState grips_[2];
    GrabState grab_;
    qnsplat::StickMotion motion_;
    qnsplat::SnapTurn snap_;
    float dt_ = 0;
    VkExtent2D lastExtent_{0, 0};
    int hz_ = 0;

    double nextSecond_ = 0, secondFrameMs_ = 0, secondGpuMs_ = 0;
    int secondFrames_ = 0, secondGpuFrames_ = 0;
    qnsplat::FrameStats measureStats_;
    double measureUntil_ = 0;
    std::string measureText_;
    bool remoteMeasure_ = false;
    double remoteUntil_ = 0;
    std::string remoteTag_;
    std::vector<double> remoteFps_, remoteGpu_;
    std::map<std::string, std::string> props_;

    FILE* csv_ = nullptr;
    qnsplat::FrameLog frameLog_{
        [](const std::string& line) { __android_log_write(ANDROID_LOG_INFO, kMetricsTag, line.c_str()); },
        [this](const std::string& line) {
            if (!csv_) return;
            std::fputs(line.c_str(), csv_);
            std::fputc('\n', csv_);
            std::fflush(csv_);
        }};
    std::string lastLine_;
};

// Vulkan 1.3 features pocketsplat needs, plus the fragment density map when the device has it.
// Core masks anything the device lacks; the FDM struct is only chained after checking support.
void FillDeviceFeatures(VkPhysicalDevice physical, const qn::DeviceFeatures& supported, qn::DeviceFeatures& requested) {
    if (supported.hasV12) requested.v12.timelineSemaphore = VK_TRUE;
    if (supported.hasV13) {
        requested.v13.dynamicRendering = VK_TRUE;
        requested.v13.synchronization2 = VK_TRUE;
        requested.v13.shaderDemoteToHelperInvocation = VK_TRUE;
        requested.v13.maintenance4 = VK_TRUE;
        requested.v13.subgroupSizeControl = VK_TRUE;
        requested.v13.computeFullSubgroups = VK_TRUE;
    }
    uint32_t count = 0;
    vkEnumerateDeviceExtensionProperties(physical, nullptr, &count, nullptr);
    std::vector<VkExtensionProperties> exts(count);
    vkEnumerateDeviceExtensionProperties(physical, nullptr, &count, exts.data());
    bool has = false;
    for (const auto& e : exts)
        if (std::strcmp(e.extensionName, kFdmExtension) == 0) has = true;
    if (!has) return;
    VkPhysicalDeviceFragmentDensityMapFeaturesEXT q{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FRAGMENT_DENSITY_MAP_FEATURES_EXT};
    VkPhysicalDeviceFeatures2 f2{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
    f2.pNext = &q;
    vkGetPhysicalDeviceFeatures2(physical, &f2);
    if (!q.fragmentDensityMap) return;
    g_fdmFeature = VkPhysicalDeviceFragmentDensityMapFeaturesEXT{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FRAGMENT_DENSITY_MAP_FEATURES_EXT};
    g_fdmFeature.fragmentDensityMap = VK_TRUE;
    g_fdmFeature.pNext = requested.extraPNext;
    requested.extraPNext = &g_fdmFeature;
    g_fdmRequested = true;
}

qn::ModuleInfo Info() {
    qn::ModuleInfo info;
    info.id = "splat";
    info.kind = qn::ModuleKind::kViewer;
    info.fileExtensions = {".ply", ".spz", ".splat"};
    info.optionalDeviceExtensions = {kFdmExtension};
    info.fillDeviceFeatures = FillDeviceFeatures;
    info.create = [] { return std::make_unique<SplatViewer>(); };
    return info;
}

}  // namespace

QN_REGISTER_MODULE(Info());

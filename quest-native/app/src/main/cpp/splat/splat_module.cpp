// splat module: PLY (Gaussian splat) viewer, measurement build. Owner: splat-dev.
// C++17 side of the module: contract hooks, input, file list, loading thread, logging.
// Rendering lives behind engine/splat_engine.h (pocketsplat, C++20, volk in its own namespace).
//
// Opening: the module never opens files by itself. Tests open with the intent extra (contract 12):
//   adb shell am start -n com.sharp.questnative/.core.QnActivity --es qn.open file:///sdcard/Android/data/com.sharp.questnative/files/ply/a.ply
// Measurement build controls (A/B/X/Y/menu belong to the ui, contract 7; only sticks, triggers, grips here):
//   right trigger / left trigger : next / previous PLY in the opened file's folder
//   right grip                   : resolution scale 1.0 -> 0.8 -> 0.6 -> 1.2 -> 1.0
//   left grip                    : foveation off -> low -> medium -> high (needs fragment density map)
//   right stick up / down        : splat budget  all -> 600k -> 400k -> 200k (reloads the file)
//   right stick left / right     : display refresh rate (supported rates)
//   right stick click            : sort key 16 / 32 bit
//   left stick click             : recenter (original photo camera at the head)
// The same commands are in the HUD model (docs/module-contract.md 14) for when the ui draws it.
//
// Remote control for the measurement scripts (quest-native/measure/splat), polled once a second:
//   adb shell setprop debug.qnsplat.budget 400000   (0 = all splats; reloads the current file)
//   adb shell setprop debug.qnsplat.scale 0.8        (resolution scale 0.6..1.2)
//   adb shell setprop debug.qnsplat.fov 0..3         (foveation level)
//   adb shell setprop debug.qnsplat.key 16|32        (sort key bits)
//   adb shell setprop debug.qnsplat.hz 72|90|120     (display refresh rate)
//   adb shell setprop debug.qnsplat.recenter <any new value>
//   adb shell setprop debug.qnsplat.measure <label>  (30 s measurement; QNSPLAT_SUMMARY line at the end)
#include <android/log.h>
#include <sys/system_properties.h>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cctype>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "core/qn_api.h"
#include "core/qn_hud.h"
#include "core/qn_log.h"
#include "engine/splat_engine.h"
#include "engine/splat_scene.h"
#include "ui/ui_api.h"

namespace {

constexpr const char* kMetricsTag = "QNSplat";
constexpr const char* kFdmExtension = "VK_EXT_fragment_density_map";
const float kScales[] = {1.0f, 0.8f, 0.6f, 1.2f};
const std::size_t kBudgets[] = {0, 600000, 400000, 200000};
const char* const kBudgetLabels[] = {"전체", "60만", "40만", "20만"};
const char* const kFoveationLabels[] = {"끔", "낮음", "중간", "높음"};

// Fragment density map feature, chained into device creation when the device has it.
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

qnsplat::Pose ToPose(const XrPosef& p) {
    qnsplat::Pose r;
    r.orientation = {p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w};
    r.position = {p.position.x, p.position.y, p.position.z};
    return r;
}

qnsplat::Fov ToFov(const XrFovf& f) { return {f.angleLeft, f.angleRight, f.angleUp, f.angleDown}; }

struct LoadResult {
    std::unique_ptr<qnsplat::SharpScene> scene;
    std::string error;
    bool fromCache = false;
    double ms = 0;
};

class SplatViewer final : public qn::Viewer {
public:
    // ------------------------------------------------------------------ lifecycle
    void OnStart(qn::Host& host) override {
        host_ = &host;
        const qn::GpuContext& gpu = host.Gpu();
        if (gpu.deviceApiVersion < VK_API_VERSION_1_3) {
            disabled_ = "이 기기의 Vulkan이 1.3보다 낮아 PLY를 그릴 수 없습니다";
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
            disabled_ = "PLY 렌더러를 시작하지 못했습니다: " + err;
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
    }

    void OnStop() override {
        ++loadToken_;
        stopping_ = true;
        if (csv_) {
            std::fclose(csv_);
            csv_ = nullptr;
        }
        engine_.reset();
    }

    // ------------------------------------------------------------------ viewer
    // Called again without Close when the next file is also a PLY (contract 8): the new load
    // supersedes the old one and the previous scene stays on screen until the new one is ready.
    // fd: owned only when returning true (contract 8); on false core closes it.
    bool Open(const qn::OpenRequest& request, std::string* error) override {
        if (!engine_) {
            if (error) *error = disabled_.empty() ? "splat engine not ready" : disabled_;
            return false;
        }
        std::string path;
        if (request.uri.rfind("file://", 0) == 0) path = request.uri.substr(7);
        else if (!request.uri.empty() && request.uri[0] == '/') path = request.uri;
        if (path.empty() && request.fd < 0) {
            if (error) *error = "PLY는 file:// 경로나 fd로만 열 수 있습니다: " + request.uri;
            return false;
        }
        name_ = request.name.empty() ? path.substr(path.find_last_of('/') + 1) : request.name;
        path_ = path;
        // Next/previous walk the opened file's folder.
        if (!path.empty()) {
            ScanFolder(path.substr(0, path.find_last_of('/')));
            auto it = std::find(files_.begin(), files_.end(), path);
            index_ = it != files_.end() ? static_cast<int>(it - files_.begin()) : -1;
        }
        // The loader thread reads a dup; the request's fd is closed now, so it never outlives this Open.
        int fd = -1;
        if (request.fd >= 0) {
            fd = dup(request.fd);
            close(request.fd);
            if (fd < 0) {
                if (error) *error = "fd dup failed";
                return true;  // we owned and closed the fd; nothing to show
            }
        }
        StartLoad(path, fd, request.size);
        return true;
    }

    void Close() override {
        ++loadToken_;
        loading_ = false;
        if (engine_) engine_->ClearScene();
        status_.clear();
    }

    // ------------------------------------------------------------------ frame hooks
    void Update(const qn::FrameInfo& frame) override {
        if (frame.headValid) lastHead_ = ToPose(frame.head);
        if (frame.predictedDisplayPeriod > 0) hz_ = static_cast<int>(std::lround(1e9 / frame.predictedDisplayPeriod));
        if (needPlacement_ && frame.headValid) {
            worldFromScene_ = qnsplat::sharp_initial_placement(lastHead_, 0.0f);
            needPlacement_ = false;
            QN_LOGI("[splat] placed scene at head (%.2f, %.2f, %.2f)", lastHead_.position.x, lastHead_.position.y,
                    lastHead_.position.z);
        }
        if (measureUntil_ > 0 && NowSeconds() >= measureUntil_) FinishMeasure();
        const double now = NowSeconds();
        if (now >= nextPropPoll_) {
            nextPropPoll_ = now + 1.0;
            PollProps();
        }
    }

    bool OnInput(const qn::InputState& in) override {
        if (!in.focused) return false;
        const qn::HandInput& r = in.hand[qn::kRight];
        const qn::HandInput& l = in.hand[qn::kLeft];
        bool used = false;
        if (r.triggerButton.pressed) used |= Step(+1);
        if (l.triggerButton.pressed) used |= Step(-1);
        if (r.squeezeButton.pressed) used |= CycleScale();
        if (l.squeezeButton.pressed) used |= CycleFoveation();
        if (r.stickClick.pressed) used |= ToggleKeyBits();
        if (l.stickClick.pressed) used |= Recenter();
        // Right stick flicks (edge-triggered at 0.8, re-armed below 0.3).
        const float sx = r.stick.x, sy = r.stick.y;
        if (stickArmed_) {
            if (sy > 0.8f) { used |= CycleBudget(-1); stickArmed_ = false; }
            else if (sy < -0.8f) { used |= CycleBudget(+1); stickArmed_ = false; }
            else if (sx > 0.8f) { used |= CycleRefresh(+1); stickArmed_ = false; }
            else if (sx < -0.8f) { used |= CycleRefresh(-1); stickArmed_ = false; }
        } else if (std::fabs(sx) < 0.3f && std::fabs(sy) < 0.3f) {
            stickArmed_ = true;
        }
        if (used) host_->Haptic(qn::kRight, 0.3f, 0.03f);
        return used;
    }

    void RenderProjection(const qn::ProjectionPass& pass) override {
        if (!engine_ || !engine_->HasScene()) return;
        const VkExtent2D ext = pass.eyes[0].extent;
        if (ext.width != lastExtent_.width || ext.height != lastExtent_.height) {
            engine_->ForgetTargets();  // swapchain was rebuilt (resolution scale)
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
        engine_->Record(pass.cmd, pass.frameSlot, eyes, worldFromScene_, &sample);

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
            if (measureUntil_ > 0) {
                measureFps_.push_back(frameLog_.last_fps());
                measureGpu_.push_back(frameLog_.last_gpu_ms());
            }
        }
    }

    // ------------------------------------------------------------------ HUD (contract 14)
    bool DescribeHud(qn::hud::Model& out) override {
        out.title = name_.empty() ? "PLY" : name_;
        char sub[160];
        std::snprintf(sub, sizeof(sub), "%u splat · %d / %d", splats_, index_ + 1, static_cast<int>(files_.size()));
        out.subtitle = sub;
        out.status = !disabled_.empty() ? disabled_ : status_;
        auto add = [&](const char* id, qn::hud::Kind kind, const char* label, float value,
                       std::vector<std::string> options, const char* page, int row) {
            qn::hud::Control c;
            c.id = id;
            c.kind = kind;
            c.label = label;
            c.value = value;
            c.options = std::move(options);
            c.page = page;
            c.row = row;
            out.controls.push_back(std::move(c));
        };
        add("recenter", qn::hud::Kind::kButton, "위치 맞춤", 0, {}, "main", 0);
        add("measure", qn::hud::Kind::kButton, measureUntil_ > 0 ? "측정 중…" : "프레임 측정(30초)", 0, {}, "main", 0);
        add("resolution", qn::hud::Kind::kChoice, "해상도 배율", static_cast<float>(scaleIndex_ < 0 ? 0 : scaleIndex_),
            {"1.0", "0.8", "0.6", "1.2"}, "more", 0);
        add("foveation", qn::hud::Kind::kChoice, fdmAvailable_ ? "포비에이션" : "포비에이션(미지원)",
            static_cast<float>(foveation_), {kFoveationLabels[0], kFoveationLabels[1], kFoveationLabels[2], kFoveationLabels[3]},
            "more", 0);
        add("budget", qn::hud::Kind::kChoice, "splat 수", static_cast<float>(budgetIndex_ < 0 ? 0 : budgetIndex_),
            {kBudgetLabels[0], kBudgetLabels[1], kBudgetLabels[2], kBudgetLabels[3]}, "more", 1);
        add("sortKey", qn::hud::Kind::kChoice, "정렬 키", engine_ && engine_->KeyBits() == 32 ? 1.0f : 0.0f,
            {"16bit", "32bit"}, "more", 1);
        if (!lastLine_.empty()) out.diagnostics.push_back(lastLine_);
        if (!lastSummary_.empty()) out.diagnostics.push_back(lastSummary_);
        return true;
    }

    void OnHudAction(const std::string& id, float value, qn::hud::Phase phase) override {
        if (phase != qn::hud::Phase::kCommit) return;
        const int v = static_cast<int>(std::lround(value));
        if (id == "recenter") Recenter();
        else if (id == "measure") StartMeasure();
        else if (id == "resolution") SetScaleIndex(v);
        else if (id == "foveation") SetFoveation(v);
        else if (id == "budget") SetBudgetIndex(v);
        else if (id == "sortKey" && engine_) engine_->SetKeyBits(v == 1 ? 32 : 16);
        qn::ui::InvalidateHud();
    }

private:
    // ------------------------------------------------------------------ files
    std::string ExternalFilesDir() {
        JNIEnv* env = host_->Env();
        jobject activity = host_->Activity();
        if (!env || !activity) return "/sdcard/Android/data/com.sharp.questnative/files";
        jclass cls = env->GetObjectClass(activity);
        jmethodID m = env->GetMethodID(cls, "getExternalFilesDir", "(Ljava/lang/String;)Ljava/io/File;");
        jobject file = m ? env->CallObjectMethod(activity, m, nullptr) : nullptr;
        std::string out = "/sdcard/Android/data/com.sharp.questnative/files";
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
        if (dir == folder_ && !files_.empty()) return;
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
        QN_LOGI("[splat] %d PLY file(s) in %s", static_cast<int>(files_.size()), dir.c_str());
    }

    bool Step(int delta) {
        if (files_.empty()) return false;
        const int n = static_cast<int>(files_.size());
        index_ = ((index_ < 0 ? 0 : index_) + delta + n) % n;
        const std::string& p = files_[static_cast<std::size_t>(index_)];
        name_ = p.substr(p.find_last_of('/') + 1);
        path_ = p;
        StartLoad(p, -1, -1);
        return true;
    }

    // ------------------------------------------------------------------ loading
    std::string CachePath(const std::string& key) const {
        if (filesDir_.empty()) return {};
        return filesDir_ + "/cache/" + key + ".pspk";
    }

    void StartLoad(const std::string& path, int fd, int64_t size) {
        const int token = ++loadToken_;
        loading_ = true;
        status_ = "불러오는 중: " + name_;
        qn::ui::InvalidateHud();
        // Cache key: name + size + mtime + budget. fd sources use fstat.
        struct stat st {};
        const bool haveStat = fd >= 0 ? fstat(fd, &st) == 0 : stat(path.c_str(), &st) == 0;
        std::string key;
        if (haveStat) {
            key = Stem(name_) + "_" + std::to_string(static_cast<long long>(st.st_size)) + "_" +
                  std::to_string(static_cast<long long>(st.st_mtime)) + "_b" + std::to_string(budget_);
        }
        const std::string cache = key.empty() ? std::string() : CachePath(key);
        const std::size_t budget = budget_;
        (void)size;
        std::thread([this, token, path, fd, cache, budget] {
            auto result = std::make_shared<LoadResult>();
            const double t0 = NowSeconds();
            result->scene = std::make_unique<qnsplat::SharpScene>();
            bool done = false;
            if (!cache.empty()) {
                // Cached pack: skips parse, Morton reorder and packing.
                if (FILE* f = std::fopen(cache.c_str(), "rb")) {
                    std::vector<std::uint8_t> bytes;
                    std::fseek(f, 0, SEEK_END);
                    bytes.resize(static_cast<std::size_t>(std::ftell(f)));
                    std::fseek(f, 0, SEEK_SET);
                    const bool ok = std::fread(bytes.data(), 1, bytes.size(), f) == bytes.size();
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
                qnsplat::LoadOptions opt;
                opt.max_splats = budget;
                auto scene = fd >= 0 ? qnsplat::load_sharp_scene_fd(fd, opt) : qnsplat::load_sharp_scene_file(path, opt);
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
                    result->error = scene.error();
                    result->scene.reset();
                }
            }
            if (fd >= 0) close(fd);
            result->ms = (NowSeconds() - t0) * 1000.0;
            if (stopping_) return;
            qn::PostIfRunning([this, token, result] { FinishLoad(token, *result); });
        }).detach();
    }

    void FinishLoad(int token, LoadResult& result) {
        if (token != loadToken_ || !engine_) return;  // superseded or closed
        loading_ = false;
        if (!result.scene) {
            status_ = "열지 못함: " + result.error;
            QN_LOGE("[splat] load failed %s: %s", name_.c_str(), result.error.c_str());
            qn::ui::Toast(status_);
            qn::ui::InvalidateHud();
            return;
        }
        const double t0 = NowSeconds();
        std::string err;
        if (!engine_->SetScene(result.scene->pack, &err)) {
            status_ = "GPU에 올리지 못함: " + err;
            QN_LOGE("[splat] upload failed: %s", err.c_str());
            qn::ui::InvalidateHud();
            return;
        }
        splats_ = result.scene->pack.header.count;
        char lbl[200];
        std::snprintf(lbl, sizeof(lbl), "%s_%uk", Stem(name_).c_str(), (splats_ + 500) / 1000);
        label_ = lbl;
        status_.clear();
        QN_LOGI("[splat] ready %s: %u splats, load %.0f ms%s, upload %.0f ms", name_.c_str(), splats_, result.ms,
                result.fromCache ? " (cache)" : "", (NowSeconds() - t0) * 1000.0);
        if (!placedOnce_) {
            needPlacement_ = true;
            placedOnce_ = true;
        }
        OpenCsv();
        qn::ui::InvalidateHud();
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

    // ------------------------------------------------------------------ settings
    bool CycleScale() { return SetScaleIndex(((scaleIndex_ < 0 ? 0 : scaleIndex_) + 1) % 4); }
    bool SetScaleIndex(int i) {
        if (i < 0 || i > 3) return false;
        scaleIndex_ = i;
        const bool ok = host_->SetResolutionScale(kScales[i]);
        if (engine_) engine_->ForgetTargets();
        Notice(std::string("해상도 배율 ") + (i == 0 ? "1.0" : i == 1 ? "0.8" : i == 2 ? "0.6" : "1.2") + (ok ? "" : " (실패)"));
        return true;
    }

    bool CycleFoveation() { return SetFoveation((foveation_ + 1) % 4); }
    bool SetFoveation(int level) {
        if (level < 0 || level > 3 || !engine_) return false;
        if (level > 0 && !fdmAvailable_) {
            Notice("포비에이션: 이 기기에서 fragment density map을 쓸 수 없음");
            return true;
        }
        std::string err;
        if (!engine_->SetFoveationAttachment(level > 0, &err)) {
            Notice("포비에이션 실패: " + err);
            return true;
        }
        const bool ok = host_->SetFoveationLevel(static_cast<qn::FoveationLevel>(level));
        foveation_ = level;
        Notice(std::string("포비에이션 ") + kFoveationLabels[level] + (ok ? "" : " (런타임 거절)"));
        return true;
    }

    bool CycleBudget(int delta) { return SetBudgetIndex(((budgetIndex_ < 0 ? 0 : budgetIndex_) + delta + 4) % 4); }
    bool SetBudgetIndex(int i) {
        if (i < 0 || i > 3) return false;
        return SetBudget(kBudgets[i]);
    }
    bool SetBudget(std::size_t value) {
        budget_ = value;
        budgetIndex_ = -1;
        for (int i = 0; i < 4; ++i)
            if (kBudgets[i] == value) budgetIndex_ = i;
        Notice(value == 0 ? std::string("splat 수 전체") : "splat 수 " + std::to_string(value));
        if (!path_.empty()) StartLoad(path_, -1, -1);
        return true;
    }

    // adb shell setprop debug.qnsplat.* (see the header comment). Applies a value when it changes.
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
        std::string v;
        if (PropChanged("budget", &v)) SetBudget(static_cast<std::size_t>(std::strtoull(v.c_str(), nullptr, 10)));
        if (PropChanged("scale", &v)) {
            const float s = std::strtof(v.c_str(), nullptr);
            scaleIndex_ = -1;
            for (int i = 0; i < 4; ++i)
                if (std::fabs(kScales[i] - s) < 0.01f) scaleIndex_ = i;
            const bool ok = host_->SetResolutionScale(s);
            if (engine_) engine_->ForgetTargets();
            Notice("해상도 배율 " + v + (ok ? "" : " (실패)"));
        }
        if (PropChanged("fov", &v)) SetFoveation(std::atoi(v.c_str()));
        if (PropChanged("key", &v) && engine_) {
            engine_->SetKeyBits(std::atoi(v.c_str()));
            Notice("정렬 키 " + std::to_string(engine_->KeyBits()) + "bit");
        }
        if (PropChanged("hz", &v)) {
            const bool ok = host_->SetRefreshRate(std::strtof(v.c_str(), nullptr));
            Notice("주사율 " + v + "Hz" + (ok ? "" : " (실패)"));
        }
        if (PropChanged("recenter", &v)) Recenter();
        if (PropChanged("measure", &v)) StartMeasure(v);
    }

    bool CycleRefresh(int delta) {
        std::vector<float> rates = host_->SupportedRefreshRates();
        if (rates.empty()) {
            Notice("주사율 바꾸기를 지원하지 않음");
            return true;
        }
        std::sort(rates.begin(), rates.end());
        int cur = 0;
        for (int i = 0; i < static_cast<int>(rates.size()); ++i)
            if (std::fabs(rates[static_cast<std::size_t>(i)] - static_cast<float>(hz_)) < 1.5f) cur = i;
        const int n = static_cast<int>(rates.size());
        const float next = rates[static_cast<std::size_t>((cur + delta + n) % n)];
        host_->SetRefreshRate(next);
        Notice("주사율 " + std::to_string(static_cast<int>(next)) + "Hz");
        return true;
    }

    bool ToggleKeyBits() {
        if (!engine_) return false;
        engine_->SetKeyBits(engine_->KeyBits() == 16 ? 32 : 16);
        Notice("정렬 키 " + std::to_string(engine_->KeyBits()) + "bit");
        return true;
    }

    bool Recenter() {
        worldFromScene_ = qnsplat::sharp_initial_placement(lastHead_, 0.0f);
        Notice("위치 맞춤");
        return true;
    }

    void StartMeasure(const std::string& tag = std::string()) {
        measureUntil_ = NowSeconds() + 30.0;
        measureFps_.clear();
        measureGpu_.clear();
        measureTag_ = tag;
        __android_log_print(ANDROID_LOG_INFO, kMetricsTag, "QNSPLAT_MEASURE begin label=%s tag=%s", label_.c_str(),
                            tag.empty() ? "-" : tag.c_str());
        Notice("30초 측정 시작: 머리를 천천히 좌우로 돌리세요");
    }

    void FinishMeasure() {
        measureUntil_ = 0;
        if (measureFps_.size() > 2) {  // drop the first second
            measureFps_.erase(measureFps_.begin());
            measureGpu_.erase(measureGpu_.begin());
        }
        auto mean = [](const std::vector<double>& v) {
            double s = 0;
            for (double x : v) s += x;
            return v.empty() ? 0.0 : s / static_cast<double>(v.size());
        };
        std::vector<double> sorted = measureFps_;
        std::sort(sorted.begin(), sorted.end());
        const double median = sorted.empty() ? 0.0 : sorted[sorted.size() / 2];
        char buf[256];
        std::snprintf(buf, sizeof(buf),
                      "QNSPLAT_SUMMARY label=%s tag=%s seconds=%zu fps_median=%.1f fps_min=%.1f gpu_ms=%.2f splats=%u "
                      "eye=%ux%u scale=%.2f fov=%d key=%d hz=%d",
                      label_.c_str(), measureTag_.empty() ? "-" : measureTag_.c_str(), measureFps_.size(), median,
                      sorted.empty() ? 0.0 : sorted.front(), mean(measureGpu_), splats_, lastExtent_.width,
                      lastExtent_.height, host_->ResolutionScale(), foveation_, engine_ ? engine_->KeyBits() : 0, hz_);
        __android_log_write(ANDROID_LOG_INFO, kMetricsTag, buf);
        lastSummary_ = buf;
        char note[128];
        std::snprintf(note, sizeof(note), "측정 끝: fps %.1f, GPU %.1fms", median, mean(measureGpu_));
        Notice(note);
    }

    void Notice(const std::string& text) {
        QN_LOGI("[splat] %s", text.c_str());
        qn::ui::Toast(text);
        qn::ui::InvalidateHud();
    }

    // ------------------------------------------------------------------ state
    qn::Host* host_ = nullptr;
    std::unique_ptr<qnsplat::SplatEngine> engine_;
    std::string disabled_;
    bool fdmAvailable_ = false;
    std::string filesDir_;
    std::string folder_;
    std::vector<std::string> files_;
    int index_ = -1;
    std::string name_, path_, label_ = "-", status_;
    std::uint32_t splats_ = 0;
    std::atomic<int> loadToken_{0};
    std::atomic<bool> stopping_{false};
    bool loading_ = false;

    qnsplat::Pose lastHead_;
    qnsplat::Mat4 worldFromScene_;
    bool needPlacement_ = false, placedOnce_ = false;
    VkExtent2D lastExtent_{0, 0};
    int hz_ = 0;
    int scaleIndex_ = 0, foveation_ = 0, budgetIndex_ = 0;
    std::size_t budget_ = 0;
    std::map<std::string, std::string> props_;
    double nextPropPoll_ = 0;
    std::string measureTag_;
    bool stickArmed_ = true;

    FILE* csv_ = nullptr;
    qnsplat::FrameLog frameLog_{
        [](const std::string& line) { __android_log_write(ANDROID_LOG_INFO, kMetricsTag, line.c_str()); },
        [this](const std::string& line) {
            if (!csv_) return;
            std::fputs(line.c_str(), csv_);
            std::fputc('\n', csv_);
            std::fflush(csv_);
        }};
    std::string lastLine_, lastSummary_;
    double measureUntil_ = 0;
    std::vector<double> measureFps_, measureGpu_;
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

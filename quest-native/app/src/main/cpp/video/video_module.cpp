// Video viewer. Owner: video-dev.
//
// Path: Media3 ExoPlayer (Java, com.sharp.questnative.video.VideoPlayer) decodes into the Surface of
// an OpenXR Android-Surface swapchain (Host::CreateSurfaceSwapchain); SubmitLayers puts that
// swapchain on quad / equirect2 layers. Decoded frames never pass through the app's Vulkan renderer.
//
// Flow of one file:
//   Open() -> VideoPlayer.open(gen, ...)            Java prepares the player (no Surface yet)
//   nativeOnFormat(gen, w, h, layout ...)           size + detected layout known
//     -> CreateSurfaceSwapchain(w x h) -> VideoPlayer.attachSurface(gen, surface) -> playback starts
//   nativeOnState / nativeOnStats (every 200 ms)    position, speed, volume, dropped frames, decoder
//   Close() -> VideoPlayer.close(gen) ... nativeOnReleased(gen) -> swapchain destroyed
// The swapchain outlives Close() until Java has released the player, so the decoder never writes
// into a destroyed Surface. `gen` tells stale callbacks of a previous file apart.
//
// HUD: drawn by the ui module from com.sharp.questnative.video.VideoHud (Java HudProvider).
// Controller shortcuts work when the ray is not on a ui panel (see OnInput).
// Decoder diagnostics (DiagRunner, Java) open as "*.qndiag" and drive this viewer through
// NativeBridge.openMedia like any other caller.
#include <jni.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <map>
#include <string>
#include <vector>

#include "core/qn_api.h"
#include "core/qn_log.h"
#include "ui/ui_api.h"
#include "video/video_layers.h"

namespace {

using qn::video::Placement;

// VideoPlayer.CMD_* (Java).
enum JavaCmd { kCmdPlay = 1, kCmdPause = 2, kCmdSeekToMs = 3, kCmdSpeed = 4, kCmdVolume = 5, kCmdLoop = 6,
               kCmdMute = 7, kCmdSaveZoom = 8, kCmdSaveScreenCurved = 9, kCmdSaveCurvature = 10 };

// Media3 Player.STATE_*.
enum PlayerState { kStateIdle = 1, kStateBuffering = 2, kStateReady = 3, kStateEnded = 4 };

const float kSpeeds[] = {0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f};

double NowSeconds() {
    using namespace std::chrono;
    return duration<double>(steady_clock::now().time_since_epoch()).count();
}

std::string JStr(JNIEnv* env, jstring s) {
    if (!s) return {};
    const char* c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

// Everything the viewer knows about the current file. Read by OnInput/Update/SubmitLayers and by
// the logs; the diagnostics mission reads decoderName / droppedFrames from here and from VideoHud.
struct Playback {
    // format
    int width = 0, height = 0;
    float fps = 0;
    std::string mime, codecs;
    std::string layout = "mono2d", confidence, reasons;
    // player
    int state = kStateIdle;
    bool playing = false, playWhenReady = false;
    int64_t positionMs = 0, durationMs = -1, bufferedMs = 0;
    double positionAt = 0;  // NowSeconds() when positionMs was reported
    float speed = 1, volume = 1;
    bool muted = false, loop = true;
    // stats
    std::string decoderName;
    int64_t renderedFrames = 0, droppedFrames = 0, skippedFrames = 0, droppedToKeyframe = 0;
    int maxConsecutiveDropped = 0;
    std::string error;
    bool endedNotified = false;

    // Position extrapolated between the 200 ms reports, for smooth seeking from the controller.
    int64_t EstimatedPositionMs() const {
        int64_t p = positionMs;
        if (playing) p += (int64_t)((NowSeconds() - positionAt) * 1000.0 * speed);
        if (durationMs > 0) p = std::min(p, durationMs);
        return std::max<int64_t>(0, p);
    }
};

class VideoViewer;
VideoViewer* g_viewer = nullptr;  // render thread only
int64_t g_nextGen = 1;

class VideoViewer final : public qn::Viewer {
public:
    // ---------------------------------------------------------------- module hooks

    void OnStart(qn::Host& host) override {
        host_ = &host;
        cylinderSupported_ = host.Xr().HasExtension(XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME);
        g_viewer = this;
        player_ = host.FindAppClass("com.sharp.questnative.video.VideoPlayer");
        diag_ = host.FindAppClass("com.sharp.questnative.video.DiagRunner");
        JNIEnv* env = host.Env();
        if (player_) {
            midOpen_ = env->GetStaticMethodID(player_, "open",
                "(JLjava/lang/String;IJLjava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z");
            midAttach_ = env->GetStaticMethodID(player_, "attachSurface", "(JLandroid/view/Surface;)V");
            midCommand_ = env->GetStaticMethodID(player_, "command", "(JID)V");
            midRemember_ = env->GetStaticMethodID(player_, "rememberLayout", "(JLjava/lang/String;)V");
            midClose_ = env->GetStaticMethodID(player_, "close", "(J)V");
            midViewState_ = env->GetStaticMethodID(player_, "setViewState", "(JLjava/lang/String;ZFZZF)V");
            midVisible_ = env->GetStaticMethodID(player_, "setSessionVisible", "(Z)V");
        }
        if (diag_) {
            midDiagHome_ = env->GetStaticMethodID(diag_, "onHomeOpened", "(Ljava/lang/String;)V");
            midDiagHomeClosed_ = env->GetStaticMethodID(diag_, "onHomeClosed", "()V");
        }
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
            player_ = nullptr;
        }
        if (!player_) QN_LOGE("[video] VideoPlayer class/methods missing; video disabled");
        QN_LOGI("[video] started (surface swapchain %s)",
                host.Xr().HasExtension(XR_KHR_ANDROID_SURFACE_SWAPCHAIN_EXTENSION_NAME) ? "yes" : "NO");
    }

    void OnStop() override {
        Close();
        for (auto& kv : pending_) {
            for (auto& s : kv.second) DestroySwapchain(s);
        }
        pending_.clear();
        g_viewer = nullptr;
    }

    void OnFocus(bool visible, bool focused) override {
        // Headset off or app hidden: pause (the person resumes by hand, like quest-app).
        if (!visible && open_ && pb_.playWhenReady) Command(kCmdPause, 0);
        // The decoder diagnostics must not count frames while the compositor is not showing them.
        if (player_ && midVisible_) {
            JNIEnv* env = host_->Env();
            env->CallStaticVoidMethod(player_, midVisible_, (jboolean)visible);
            if (env->ExceptionCheck()) env->ExceptionClear();
        }
    }

    // Contract 8: the same viewer may get Open again without Close (next video). Each Open retires
    // the previous file (its swapchain dies once Java released that player) and starts the new one.
    // A ".qndiag" name opens the decoder diagnostics home instead of a video (DiagRunner, Java).
    bool Open(const qn::OpenRequest& req, std::string* error) override {
        if (!player_ || !midOpen_) {
            if (error) *error = "video player unavailable";
            return false;  // core closes req.fd
        }
        const bool continuing = open_ || diagHome_;
        const std::string name = req.name.empty() ? req.uri : req.name;
        RetireVideo();
        if (IsDiagName(name)) {
            if (req.fd >= 0) close(req.fd);  // ours once we return true; the home needs no file
            diagHome_ = true;
            CallStaticStr(diag_, midDiagHome_, req.uri);
            QN_LOGI("[video] decoder diagnostics home (%s)", req.uri.c_str());
            return true;
        }
        LeaveDiagHome();

        gen_ = g_nextGen++;
        pb_ = Playback{};
        name_ = name;
        userPickedLayout_ = false;
        curvePrefsLoaded_ = false;
        if (!continuing) recenterPending_ = true;  // next video keeps the placement
        JNIEnv* env = host_->Env();
        jstring juri = env->NewStringUTF(req.uri.c_str());
        jstring jname = env->NewStringUTF(name_.c_str());
        jstring jmime = env->NewStringUTF(req.mimeType.c_str());
        jstring jsrc = env->NewStringUTF(req.sourceId.c_str());
        jstring jhint = env->NewStringUTF(req.layoutHint.c_str());
        // Java takes the fd only when it returns true.
        jboolean ok = env->CallStaticBooleanMethod(player_, midOpen_, (jlong)gen_, juri, (jint)req.fd,
                                                   (jlong)req.size, jname, jmime, jsrc, jhint);
        env->DeleteLocalRef(juri);
        env->DeleteLocalRef(jname);
        env->DeleteLocalRef(jmime);
        env->DeleteLocalRef(jsrc);
        env->DeleteLocalRef(jhint);
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
            ok = JNI_FALSE;
        }
        if (!ok) {
            if (error) *error = "player thread not running";
            return false;  // core closes req.fd
        }
        open_ = true;
        QN_LOGI("[video] open gen %lld %s", (long long)gen_, name_.c_str());
        return true;
    }

    void Close() override {
        RetireVideo();
        LeaveDiagHome();
    }

    // ---------------------------------------------------------------- Java callbacks (render thread)

    void OnFormat(int64_t gen, int w, int h, float fps, std::string mime, std::string codecs, std::string layout,
                  std::string confidence, std::string reasons, float zoom, bool curved, float curvature) {
        if (!open_ || gen != gen_) return;
        if (!curvePrefsLoaded_) {
            screenCurved_ = curved && cylinderSupported_;  // Do not overwrite unsupported saved preferences.
            curvature_ = qn::video::ClampCurvature(curvature);
            curvePrefsLoaded_ = true;
            if (curved && !cylinderSupported_) qn::ui::Toast("이 기기는 커브 화면을 지원하지 않아요", 3);
        }
        pb_.width = w;
        pb_.height = h;
        pb_.fps = fps;
        pb_.mime = std::move(mime);
        pb_.codecs = std::move(codecs);
        SetLayout(layout, false);
        pb_.confidence = std::move(confidence);
        pb_.reasons = std::move(reasons);
        if (zoom >= qn::video::kMinScreenScale && zoom <= qn::video::kMaxScreenScale) place_.screenScale = zoom;
        QN_LOGI("[video] format %dx%d %.2f fps %s %s -> %s (%s: %s)", w, h, fps, pb_.mime.c_str(),
                pb_.codecs.c_str(), pb_.layout.c_str(), pb_.confidence.c_str(), pb_.reasons.c_str());
        if (pb_.confidence == "low") qn::ui::Toast("형식 추정: " + pb_.layout + " (맞지 않으면 형식을 바꾸세요)", 4);
        CreateSwapchain();
        PushViewState();
    }

    void OnLayoutRefined(int64_t gen, std::string layout, std::string confidence, std::string reasons) {
        if (!open_ || gen != gen_ || userPickedLayout_) return;
        SetLayout(layout, false);
        pb_.confidence = std::move(confidence);
        pb_.reasons = std::move(reasons);
        QN_LOGI("[video] layout refined -> %s (%s)", pb_.layout.c_str(), pb_.reasons.c_str());
        PushViewState();
    }

    void OnState(int64_t gen, int state, bool playing, bool pwr, int64_t pos, int64_t dur, int64_t buf, float speed,
                 float volume, bool muted, bool loop) {
        if (!open_ || gen != gen_) return;
        pb_.state = state;
        pb_.playing = playing;
        pb_.playWhenReady = pwr;
        pb_.positionMs = pos;
        pb_.positionAt = NowSeconds();
        pb_.durationMs = dur;
        pb_.bufferedMs = buf;
        pb_.speed = speed;
        pb_.volume = volume;
        pb_.muted = muted;
        pb_.loop = loop;
        if (state == kStateEnded && !pb_.endedNotified) {
            pb_.endedNotified = true;
            qn::ui::NotifyMediaEnded();
        } else if (state != kStateEnded) {
            pb_.endedNotified = false;
        }
    }

    void OnStats(int64_t gen, std::string decoder, int64_t rendered, int64_t dropped, int64_t skipped, int maxCons,
                 int64_t toKey) {
        if (!open_ || gen != gen_) return;
        if (pb_.decoderName != decoder && !decoder.empty()) QN_LOGI("[video] decoder %s", decoder.c_str());
        if (dropped > pb_.droppedFrames) {
            QN_LOGW("[video] dropped frames %lld (+%lld), rendered %lld", (long long)dropped,
                    (long long)(dropped - pb_.droppedFrames), (long long)rendered);
        }
        pb_.decoderName = std::move(decoder);
        pb_.renderedFrames = rendered;
        pb_.droppedFrames = dropped;
        pb_.skippedFrames = skipped;
        pb_.maxConsecutiveDropped = maxCons;
        pb_.droppedToKeyframe = toKey;
    }

    void OnError(int64_t gen, std::string message) {
        if (!open_ || gen != gen_) return;
        pb_.error = message;
        QN_LOGE("[video] error: %s", message.c_str());
        qn::ui::Toast("영상 오류: " + message, 5);
    }

    void OnReleased(int64_t gen) {
        auto it = pending_.find(gen);
        if (it == pending_.end()) return;
        for (auto& s : it->second) DestroySwapchain(s);
        pending_.erase(it);
    }

    // From VideoHud (ui draw thread -> posted here): view controls that live in C++.
    void OnHudCommand(int64_t gen, const std::string& id, float value, int phase) {
        if (!open_ || gen != gen_) return;
        if (id == "layout") {
            static const char* kOrder[] = {"sbs180", "mono180", "mono360", "tb360", "sbs360",
                                           "sbsScreenFull", "sbsScreenHalf", "tbScreen", "mono2d"};
            int i = (int)value;
            if (i >= 0 && i < 9) SetLayout(kOrder[i], true);
        } else if (id == "screenCurve" || id == "curvature") {
            const auto* layout = qn::video::FindLayout(pb_.layout);
            if (!layout || layout->shape != qn::video::Shape::kScreen || !curvePrefsLoaded_) return;
            if (!cylinderSupported_) {
                qn::ui::Toast("이 기기는 커브 화면을 지원하지 않아요", 3);
            } else if (id == "screenCurve") {
                screenCurved_ = value != 0;
                Command(kCmdSaveScreenCurved, screenCurved_ ? 1 : 0);
                qn::ui::Toast(screenCurved_ ? "화면: 커브" : "화면: 평면", 2);
            } else if (screenCurved_) {
                curvature_ = qn::video::ClampCurvature(value);
                if (phase == static_cast<int>(qn::hud::Phase::kCommit)) Command(kCmdSaveCurvature, curvature_);
            }
        } else if (id == "swapEyes") {
            swapEyes_ = value != 0;
        } else if (id == "recenter") {
            recenterPending_ = true;
        } else if (id == "zoomIn" || id == "zoomOut") {
            Zoom(id == "zoomIn" ? 1.15f : 1.0f / 1.15f);
            SaveZoom();
        }
        PushViewState();
    }

    // ---------------------------------------------------------------- frame hooks

    bool OnInput(const qn::InputState& in) override {
        if (!in.focused) return false;
        if (diagHome_ && !open_) {  // diagnostics home: only the HUD toggle
            if (in.hand[qn::kRight].triggerButton.pressed) qn::ui::SetHudVisible(!qn::ui::HudVisible());
            return true;
        }
        if (!open_) return false;
        // Called only when the ray is not on a ui panel (the ui module consumes input there).
        // Right trigger toggles the HUD (§14.8, as in quest-app). The stick/grip shortcuts below avoid
        // A/B/X/Y, which the ui button table owns; the button-mapping screen may replace them later.
        const qn::HandInput& L = in.hand[qn::kLeft];
        const qn::HandInput& R = in.hand[qn::kRight];
        const double now = NowSeconds();
        const float dt = lastInputTime_ > 0 ? (float)std::min(0.1, now - lastInputTime_) : 0.0f;
        lastInputTime_ = now;

        if (R.triggerButton.pressed) qn::ui::SetHudVisible(!qn::ui::HudVisible());

        // Right stick left/right: 10 s seek, repeats every 0.4 s while held.
        float rx = R.stick.x, ry = R.stick.y;
        if (std::fabs(rx) > 0.7f && std::fabs(rx) > std::fabs(ry)) {
            if (now >= nextSeekAt_) {
                SeekBy(rx > 0 ? 10000 : -10000);
                nextSeekAt_ = now + (seekHeld_ ? 0.4 : 0.5);
                seekHeld_ = true;
            }
        } else {
            seekHeld_ = false;
            nextSeekAt_ = 0;
        }
        // Right stick up/down: screen zoom.
        if (std::fabs(ry) > 0.3f && std::fabs(ry) > std::fabs(rx)) {
            Zoom(std::exp(ry * dt * 0.8f));
            zoomDirty_ = true;
        } else if (zoomDirty_) {
            SaveZoom();
        }
        // Left stick left/right: turn the content; up/down: volume.
        float lx = L.stick.x, ly = L.stick.y;
        if (std::fabs(lx) > 0.3f && std::fabs(lx) > std::fabs(ly)) place_.yaw -= lx * dt * 1.2f;
        if (std::fabs(ly) > 0.3f && std::fabs(ly) > std::fabs(lx) && now >= nextVolumeAt_) {
            float v = std::clamp(pb_.volume + ly * 0.1f, 0.0f, 1.0f);
            pb_.volume = v;
            Command(kCmdVolume, v);
            nextVolumeAt_ = now + 0.1;
        }
        if (L.stickClick.pressed) recenterPending_ = true;
        if (R.stickClick.pressed) {
            SetLayout(qn::video::NextLayoutName(pb_.layout), true);
            qn::ui::Toast(std::string("형식: ") + pb_.layout, 2);
        }
        if (L.triggerButton.pressed) {
            int i = 0;
            while (i < 6 && kSpeeds[i] < pb_.speed + 0.01f) ++i;
            float s = kSpeeds[i % 6];
            Command(kCmdSpeed, s);
            char buf[32];
            snprintf(buf, sizeof(buf), "배속 %.2gx", s);
            qn::ui::Toast(buf, 1.5f);
        }
        if (R.squeezeButton.pressed) swapEyes_ = !swapEyes_;
        if (L.squeezeButton.pressed) Command(kCmdMute, pb_.muted ? 0 : 1);
        PushViewStateIfChanged();
        return true;
    }

    void Update(const qn::FrameInfo& frame) override {
        if (!open_) return;
        if (recenterPending_ && frame.headValid) {
            recenterPending_ = false;
            place_.anchor = frame.head.position;
            place_.yaw = qn::video::YawOf(frame.head.orientation);
        }
    }

    void SubmitLayers(const qn::FrameInfo& frame, qn::LayerSink& sink) override {
        if (!open_ || swap_.handle == XR_NULL_HANDLE || (pb_.renderedFrames == 0 && !pb_.playing)) return;
        bool sphere = false;
        int n = qn::video::BuildLayers(pb_.layout, swap_.width, swap_.height, swapEyes_, place_,
                                       host_->Xr().appSpace, swap_.handle, quads_, equirects_, &sphere,
                                       screenCurved_ && cylinderSupported_ ? cylinders_ : nullptr, curvature_);
        for (int i = 0; i < n; ++i) {
            if (sphere) {
                if (!host_->Xr().HasExtension(XR_KHR_COMPOSITION_LAYER_EQUIRECT2_EXTENSION_NAME)) return;
                sink.AddEquirect2(qn::kOrderBackground, equirects_[i]);
            } else if (screenCurved_ && cylinderSupported_) {
                sink.AddCylinder(qn::kOrderContent, cylinders_[i]);
            } else {
                sink.AddQuad(qn::kOrderContent, quads_[i]);
            }
        }
    }

private:
    static bool IsDiagName(const std::string& name) {
        static const std::string kExt = ".qndiag";
        return name.size() >= kExt.size() && name.compare(name.size() - kExt.size(), kExt.size(), kExt) == 0;
    }

    // Stops the current video: Java releases the player, then nativeOnReleased destroys the swapchain.
    void RetireVideo() {
        if (!open_) return;
        open_ = false;
        CallJava(midClose_, gen_);
        if (swap_.handle != XR_NULL_HANDLE) pending_[gen_].push_back(swap_);
        swap_ = Swapchain{};
        QN_LOGI("[video] close gen %lld (rendered %lld, dropped %lld)", (long long)gen_,
                (long long)pb_.renderedFrames, (long long)pb_.droppedFrames);
    }

    void LeaveDiagHome() {
        if (!diagHome_) return;
        diagHome_ = false;
        if (diag_ && midDiagHomeClosed_) {
            JNIEnv* env = host_->Env();
            env->CallStaticVoidMethod(diag_, midDiagHomeClosed_);
            if (env->ExceptionCheck()) env->ExceptionClear();
        }
    }

    void CallStaticStr(jclass cls, jmethodID mid, const std::string& value) {
        if (!cls || !mid) return;
        JNIEnv* env = host_->Env();
        jstring j = env->NewStringUTF(value.c_str());
        env->CallStaticVoidMethod(cls, mid, j);
        env->DeleteLocalRef(j);
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
        }
    }

    struct Swapchain {
        XrSwapchain handle = XR_NULL_HANDLE;
        jobject surface = nullptr;  // global ref
        int width = 0, height = 0;
    };

    void CreateSwapchain() {
        if (swap_.handle != XR_NULL_HANDLE) {
            if (swap_.width == pb_.width && swap_.height == pb_.height) return;
            pending_[gen_].push_back(swap_);  // size changed mid-file (rare): retired with this file
            swap_ = Swapchain{};
        }
        XrSwapchainCreateInfo ci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
        ci.usageFlags = XR_SWAPCHAIN_USAGE_SAMPLED_BIT;
        ci.width = (uint32_t)pb_.width;
        ci.height = (uint32_t)pb_.height;
        ci.faceCount = 1;
        ci.arraySize = 1;
        ci.mipCount = 1;
        ci.sampleCount = 1;
        Swapchain s;
        if (!host_->CreateSurfaceSwapchain(ci, &s.handle, &s.surface)) {
            OnError(gen_, "이 기기에서 영상 레이어(Surface 스왑체인)를 만들 수 없습니다");
            return;
        }
        s.width = pb_.width;
        s.height = pb_.height;
        swap_ = s;
        QN_LOGI("[video] surface swapchain %dx%d", s.width, s.height);
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(player_, midAttach_, (jlong)gen_, swap_.surface);
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
        }
    }

    void DestroySwapchain(Swapchain& s) {
        if (s.handle != XR_NULL_HANDLE) xrDestroySwapchain(s.handle);
        if (s.surface) host_->Env()->DeleteGlobalRef(s.surface);
        s = Swapchain{};
    }

    void CallJava(jmethodID mid, int64_t gen) {
        if (!player_ || !mid) return;
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(player_, mid, (jlong)gen);
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
        }
    }

    void Command(int cmd, double value) {
        if (!player_ || !midCommand_) return;
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(player_, midCommand_, (jlong)gen_, (jint)cmd, (jdouble)value);
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
        }
    }

    void SeekBy(int64_t deltaMs) {
        int64_t to = pb_.EstimatedPositionMs() + deltaMs;
        if (pb_.durationMs > 0) to = std::min(to, pb_.durationMs - 1);
        to = std::max<int64_t>(0, to);
        pb_.positionMs = to;
        pb_.positionAt = NowSeconds();
        Command(kCmdSeekToMs, (double)to);
    }

    void Zoom(float factor) {
        place_.screenScale = std::clamp(place_.screenScale * factor, qn::video::kMinScreenScale,
                                        qn::video::kMaxScreenScale);
    }

    void SaveZoom() {
        zoomDirty_ = false;
        Command(kCmdSaveZoom, place_.screenScale);
    }

    void SetLayout(const std::string& layout, bool byUser) {
        if (!qn::video::FindLayout(layout)) return;
        pb_.layout = layout;
        if (byUser) {
            userPickedLayout_ = true;
            pb_.confidence = "high";
            pb_.reasons = "직접 고름";
            if (midRemember_) {
                JNIEnv* env = host_->Env();
                jstring j = env->NewStringUTF(layout.c_str());
                env->CallStaticVoidMethod(player_, midRemember_, (jlong)gen_, j);
                env->DeleteLocalRef(j);
                if (env->ExceptionCheck()) env->ExceptionClear();
            }
        }
    }

    void PushViewState() {
        if (!midViewState_) return;
        sentLayout_ = pb_.layout;
        sentSwap_ = swapEyes_;
        sentZoom_ = place_.screenScale;
        JNIEnv* env = host_->Env();
        jstring j = env->NewStringUTF(pb_.layout.c_str());
        env->CallStaticVoidMethod(player_, midViewState_, (jlong)gen_, j, (jboolean)swapEyes_,
                                  (jfloat)place_.screenScale, (jboolean)cylinderSupported_,
                                  (jboolean)screenCurved_, (jfloat)curvature_);
        env->DeleteLocalRef(j);
        if (env->ExceptionCheck()) env->ExceptionClear();
    }

    void PushViewStateIfChanged() {
        if (sentLayout_ != pb_.layout || sentSwap_ != swapEyes_ || std::fabs(sentZoom_ - place_.screenScale) > 0.01f) {
            PushViewState();
        }
    }

    qn::Host* host_ = nullptr;
    jclass player_ = nullptr;  // global ref cached by core
    jclass diag_ = nullptr;  // com.sharp.questnative.video.DiagRunner
    jmethodID midVisible_ = nullptr, midDiagHome_ = nullptr, midDiagHomeClosed_ = nullptr;
    bool diagHome_ = false;
    jmethodID midOpen_ = nullptr, midAttach_ = nullptr, midCommand_ = nullptr, midRemember_ = nullptr,
              midClose_ = nullptr, midViewState_ = nullptr;

    bool open_ = false;
    int64_t gen_ = 0;
    std::string name_;
    Playback pb_;
    Swapchain swap_;
    std::map<int64_t, std::vector<Swapchain>> pending_;  // waiting for nativeOnReleased(gen)

    Placement place_;
    bool swapEyes_ = false;
    bool recenterPending_ = true;
    bool userPickedLayout_ = false;
    bool cylinderSupported_ = false, screenCurved_ = false, curvePrefsLoaded_ = false;
    float curvature_ = qn::video::kDefaultCurvature;
    XrCompositionLayerCylinderKHR cylinders_[2];
    XrCompositionLayerQuad quads_[2];
    XrCompositionLayerEquirect2KHR equirects_[2];

    double lastInputTime_ = 0, nextSeekAt_ = 0, nextVolumeAt_ = 0;
    bool seekHeld_ = false, zoomDirty_ = false;
    std::string sentLayout_;
    bool sentSwap_ = false;
    float sentZoom_ = 0;
};

qn::ModuleInfo Info() {
    qn::ModuleInfo info;
    info.id = "video";
    info.kind = qn::ModuleKind::kViewer;
    info.fileExtensions = {".mp4", ".m4v", ".mkv", ".webm", ".mov", ".qndiag"};  // .qndiag: decoder diagnostics
    info.mimePrefixes = {"video/"};
    info.optionalXrExtensions = {XR_FB_ANDROID_SURFACE_SWAPCHAIN_CREATE_EXTENSION_NAME,
                                 XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME};
    info.create = [] { return std::make_unique<VideoViewer>(); };
    return info;
}

// Java callbacks arrive on the "qn-video" thread: copy, then run on the render thread.
template <typename F>
void Post(F&& fn) {
    qn::PostIfRunning([fn = std::forward<F>(fn)]() {
        if (g_viewer) fn(*g_viewer);
    });
}

}  // namespace

QN_REGISTER_MODULE(Info());

// ------------------------------------------------------------------ JNI (com.sharp.questnative.video.VideoPlayer)

extern "C" {

JNIEXPORT void JNICALL Java_com_sharp_questnative_video_VideoPlayer_nativeOnFormat(
    JNIEnv* env, jclass, jlong gen, jint w, jint h, jfloat fps, jstring mime, jstring codecs, jstring layout,
    jstring confidence, jstring reasons, jboolean fromMemory, jfloat zoom, jboolean curved, jfloat curvature) {
    Post([gen, w, h, fps, m = JStr(env, mime), c = JStr(env, codecs), l = JStr(env, layout),
          cf = JStr(env, confidence), r = JStr(env, reasons), zoom, curved, curvature](VideoViewer& v) {
        v.OnFormat(gen, w, h, fps, m, c, l, cf, r, zoom, curved, curvature);
    });
}

JNIEXPORT void JNICALL Java_com_sharp_questnative_video_VideoPlayer_nativeOnLayoutRefined(
    JNIEnv* env, jclass, jlong gen, jstring layout, jstring confidence, jstring reasons) {
    Post([gen, l = JStr(env, layout), c = JStr(env, confidence), r = JStr(env, reasons)](VideoViewer& v) {
        v.OnLayoutRefined(gen, l, c, r);
    });
}

JNIEXPORT void JNICALL Java_com_sharp_questnative_video_VideoPlayer_nativeOnState(
    JNIEnv*, jclass, jlong gen, jint state, jboolean playing, jboolean pwr, jlong pos, jlong dur, jlong buf,
    jfloat speed, jfloat volume, jboolean muted, jboolean loop) {
    Post([=](VideoViewer& v) {
        v.OnState(gen, state, playing, pwr, pos, dur, buf, speed, volume, muted, loop);
    });
}

JNIEXPORT void JNICALL Java_com_sharp_questnative_video_VideoPlayer_nativeOnStats(
    JNIEnv* env, jclass, jlong gen, jstring decoder, jlong rendered, jlong dropped, jlong skipped, jint maxCons,
    jlong toKey) {
    Post([=, d = JStr(env, decoder)](VideoViewer& v) { v.OnStats(gen, d, rendered, dropped, skipped, maxCons, toKey); });
}

JNIEXPORT void JNICALL Java_com_sharp_questnative_video_VideoPlayer_nativeOnError(JNIEnv* env, jclass, jlong gen,
                                                                                  jstring message) {
    Post([gen, m = JStr(env, message)](VideoViewer& v) { v.OnError(gen, m); });
}

JNIEXPORT void JNICALL Java_com_sharp_questnative_video_VideoPlayer_nativeOnReleased(JNIEnv*, jclass, jlong gen) {
    Post([gen](VideoViewer& v) { v.OnReleased(gen); });
}

JNIEXPORT void JNICALL Java_com_sharp_questnative_video_VideoPlayer_nativeOnHudAction(
    JNIEnv* env, jclass, jlong gen, jstring id, jfloat value, jint phase) {
    Post([gen, i = JStr(env, id), value, phase](VideoViewer& v) { v.OnHudCommand(gen, i, value, phase); });
}

}  // extern "C"

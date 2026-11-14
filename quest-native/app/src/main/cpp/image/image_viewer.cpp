// Photo viewer: flat / 180 / 360, mono or stereo (SBS/TB), shown directly on compositor layers.
// Owner: image-dev. Contract: docs/module-contract.md (§6.5 layers, §6.6 Surface swapchain, §8 viewer,
// §14 HUD).
//
// Pipeline (one picture):
//   Open -> Java probe (size, EXIF rotation)            [image worker thread]
//        -> render thread picks the layout and the decode size (image_logic.cpp)
//        -> Java decode (BitmapFactory / BitmapRegionDecoder strips, no extra libraries)
//        -> render thread creates an Android Surface swapchain of exactly that size
//        -> Java draws the bitmap once into the Surface and frees the bitmap
//        -> render thread swaps it in and submits quad (screen) or equirect2 (180/360) layers.
// The compositor samples the picture at display rate, so it stays sharp and does not shake when the
// app frame is late. The previous picture stays on screen until the next one is ready.
//
// Zoom on a mono 360/180 picture re-decodes only the visible centre (crop) at full detail;
// zoom on a screen re-decodes at a higher size when the source has more pixels. Both happen after
// the stick has been still for a moment.
#include <jni.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

#include "core/qn_api.h"
#include "core/qn_hud.h"
#include "core/qn_log.h"
#include "image/image_api.h"
#include "image/image_logic.h"
#include "ui/ui_api.h"

namespace qn {
namespace image {
namespace {

constexpr const char* kBridgeClass = "com.sharp.questnative.image.ImageBridge";
constexpr double kStickDeadZone = 0.15;
constexpr double kRefineIdleSeconds = 0.45;  // stick still this long before a sharper re-decode
constexpr double kRefineGain = 1.3;          // re-decode only when it gets at least 30% sharper
constexpr double kSphereRadius = 50.0;       // m; the layer follows the head, so it looks infinite
constexpr int kMaxSide = 8192;               // our own cap, on top of the runtime limit

double Now() {
    using namespace std::chrono;
    return duration<double>(steady_clock::now().time_since_epoch()).count();
}

XrQuaternionf Mul(const XrQuaternionf& a, const XrQuaternionf& b) {
    return {a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z};
}

XrQuaternionf AxisAngle(float x, float y, float z, double angle) {
    const float s = static_cast<float>(std::sin(angle / 2));
    return {x * s, y * s, z * s, static_cast<float>(std::cos(angle / 2))};
}

XrVector3f Rotate(const XrQuaternionf& q, const XrVector3f& v) {
    // v' = v + 2w(q x v) + 2(q x (q x v))
    const XrVector3f u{q.x, q.y, q.z};
    auto cross = [](const XrVector3f& a, const XrVector3f& b) {
        return XrVector3f{a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
    };
    XrVector3f t = cross(u, v);
    t = {2 * t.x, 2 * t.y, 2 * t.z};
    const XrVector3f c = cross(u, t);
    return {v.x + q.w * t.x + c.x, v.y + q.w * t.y + c.y, v.z + q.w * t.z + c.z};
}

// Yaw of the head (0 = looking down -Z, positive = turned left), ignoring pitch and roll.
double HeadYaw(const XrQuaternionf& q) {
    const XrVector3f f = Rotate(q, {0, 0, -1});
    return std::atan2(-f.x, -f.z);
}

std::string JString(JNIEnv* env, jstring s) {
    if (!s) return {};
    const char* c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

bool CheckJni(JNIEnv* env, const char* what) {
    if (!env->ExceptionCheck()) return true;
    env->ExceptionDescribe();
    env->ExceptionClear();
    QN_LOGE("[image] JNI call failed: %s", what);
    return false;
}

std::string Dims(int w, int h) { return std::to_string(w) + "×" + std::to_string(h); }

// One picture as far as we know it.
struct Picture {
    int64_t token = 0;
    std::string uri, name, sourceId, key;
    int srcW = 0, srcH = 0;
    bool probed = false;
    Detection detection;
    Layout layout = Layout::kMono2d;
    bool layoutFromUser = false;  // picked by the person (now or remembered) or given as layoutHint
    bool sniffed = false;
};

// One Surface swapchain holding (a crop of) a picture.
struct Texture {
    XrSwapchain swapchain = XR_NULL_HANDLE;
    jobject surface = nullptr;  // global ref
    int w = 0, h = 0;
    RectI crop;  // area of the source (pixels) this texture shows
    int job = 0;
};

class ImageViewer;
std::atomic<ImageViewer*> g_viewer{nullptr};

class ImageViewer final : public Viewer, public ViewerApi {
public:
    // ------------------------------------------------------------------ Module
    void OnStart(Host& host) override {
        host_ = &host;
        JNIEnv* env = host.Env();
        bridge_ = host.FindAppClass(kBridgeClass);
        if (!bridge_) {
            QN_LOGE("[image] %s not found", kBridgeClass);
            return;
        }
        struct M {
            jmethodID* id;
            const char* name;
            const char* sig;
        };
        const M methods[] = {
            {&mProbe_, "probe", "(JLjava/lang/String;ILjava/lang/String;)V"},
            {&mDecode_, "decode", "(JIIIIIII)V"},
            {&mDraw_, "draw", "(JILandroid/view/Surface;)V"},
            {&mDrop_, "drop", "(JI)V"},
            {&mRelease_, "release", "(J)V"},
            {&mGetPref_, "getPref", "(Ljava/lang/String;)Ljava/lang/String;"},
            {&mPutPref_, "putPref", "(Ljava/lang/String;Ljava/lang/String;)V"},
        };
        for (const auto& m : methods) {
            *m.id = env->GetStaticMethodID(bridge_, m.name, m.sig);
            if (!CheckJni(env, m.name) || !*m.id) {
                QN_LOGE("[image] missing ImageBridge.%s", m.name);
                bridge_ = nullptr;
                return;
            }
        }

        XrSystemProperties props{XR_TYPE_SYSTEM_PROPERTIES};
        if (XR_SUCCEEDED(xrGetSystemProperties(host.Xr().instance, host.Xr().systemId, &props))) {
            limits_.maxWidth = std::min<int>(kMaxSide, static_cast<int>(props.graphicsProperties.maxSwapchainImageWidth));
            limits_.maxHeight = std::min<int>(kMaxSide, static_cast<int>(props.graphicsProperties.maxSwapchainImageHeight));
            runtimeMaxW_ = static_cast<int>(props.graphicsProperties.maxSwapchainImageWidth);
            runtimeMaxH_ = static_cast<int>(props.graphicsProperties.maxSwapchainImageHeight);
        }
        settingsSupported_ = host.Xr().HasExtension(XR_FB_COMPOSITION_LAYER_SETTINGS_EXTENSION_NAME);
        equirectSupported_ = host.Xr().HasExtension(XR_KHR_COMPOSITION_LAYER_EQUIRECT2_EXTENSION_NAME);
        cylinderSupported_ = host.Xr().HasExtension(XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME);
        if (!equirectSupported_) QN_LOGW("[image] XR_KHR_composition_layer_equirect2 missing: 180/360 shown flat");
        if (!cylinderSupported_) QN_LOGW("[image] XR_KHR_composition_layer_cylinder missing: curved screen disabled");
        QN_LOGI("[image] start: swapchain max %dx%d (using %dx%d, %lld px), layer settings %s, cylinder %s",
                runtimeMaxW_, runtimeMaxH_, limits_.maxWidth, limits_.maxHeight,
                static_cast<long long>(limits_.maxPixels), settingsSupported_ ? "on" : "off",
                cylinderSupported_ ? "on" : "off");

        LoadPrefs();
        g_viewer.store(this);
        SetApi(this);
    }

    void OnStop() override {
        SetApi(nullptr);
        g_viewer.store(nullptr);
        Close();
        host_ = nullptr;
    }

    bool OnInput(const InputState& input) override {
        const double dt = lastInputTime_ && input.time > lastInputTime_
                              ? std::min(0.1, (input.time - lastInputTime_) * 1e-9)
                              : 1.0 / 72;
        lastInputTime_ = input.time;
        if (!input.focused || !shownValid()) return false;
        const HandInput& L = input.hand[kLeft];
        const HandInput& R = input.hand[kRight];

        // Left stick turns the picture (the scene moves the way you push; same rule as the web app).
        double lx = L.stick.x, ly = L.stick.y;
        if (std::fabs(lx) < kStickDeadZone) lx = 0;
        if (std::fabs(ly) < kStickDeadZone) ly = 0;
        if (lx != 0 || ly != 0) {
            turnYaw_ -= lx * kTurnSpeed * dt;
            turnPitch_ = std::max(-kMaxTurnPitch, std::min(kMaxTurnPitch, turnPitch_ + ly * kTurnSpeed * dt));
        }
        if (L.stickClick.pressed) Recenter();

        // Right stick up/down zooms (the larger axis wins, so a sideways push does not zoom).
        // Previous/next file belongs to the ui (X, HUD [이전]/[다음]): it reopens through
        // Host::OpenMedia, which calls Open again without Close (§8).
        const auto split = SplitStick(R.stick.x, R.stick.y);
        if (std::fabs(split.second) > kStickDeadZone) ZoomBy(std::exp(split.second * kZoomRate * dt));
        if (R.stickClick.pressed) ResetZoom();

        // A/B/X/Y belong to the ui (list, UI on/off/move); layout and eye swap are on the HUD.
        // Right trigger outside the panels shows/hides the HUD (§14.8, same as video).
        if (R.triggerButton.pressed) ui::SetHudVisible(!ui::HudVisible());
        return false;
    }

    void Update(const FrameInfo& frame) override {
        if (frame.headValid) {
            head_ = frame.head;
            headValid_ = true;
            if (needPlace_ && shownValid()) {
                Recenter();
                needPlace_ = false;
            }
        }
        const double now = Now();
        if (zoomDirty_ && now - lastZoomChange_ > 0.5) {
            zoomDirty_ = false;
            PutPref("zoom.screen", std::to_string(screenScale_));
            PutPref("zoom.sphere", std::to_string(sphereZoom_));
        }
        if (!inFlight_ && wantDecode_) {
            wantDecode_ = false;
            RequestDecode();
        }
        if (!inFlight_ && shownValid() && shownPic_.token == cur_.token && now - lastZoomChange_ > kRefineIdleSeconds) {
            MaybeRefine();
        }
    }

    void SubmitLayers(const FrameInfo& frame, LayerSink& sink) override {
        if (!shownValid() || !host_) return;
        const Picture& pic = shownPic_;
        const LayoutInfo& info = Info(pic.layout);
        const XrQuaternionf q = Mul(AxisAngle(0, 1, 0, baseYaw_ + turnYaw_), AxisAngle(1, 0, 0, turnPitch_));
        const bool stereo = info.stereo != Stereo::kMono;
        const int layerCount = stereo ? 2 : 1;
        if (settingsSupported_) {
            settings_ = XrCompositionLayerSettingsFB{XR_TYPE_COMPOSITION_LAYER_SETTINGS_FB};
            settings_.layerFlags = XR_COMPOSITION_LAYER_SETTINGS_QUALITY_SUPER_SAMPLING_BIT_FB;
        }
        for (int i = 0; i < layerCount; ++i) {
            const int eye = stereo ? (swapEyes_ ? 1 - i : i) : 0;
            RectI region = EyeRect(pic.layout, eye, pic.srcW, pic.srcH);
            if (info.shape != Shape::kScreen) region = ZoomRect(region, sphereZoom_);
            const bool flat = info.shape == Shape::kScreen || !equirectSupported_;
            const XrRect2Di rect = ToTextureRect(region, shown_);
            const XrEyeVisibility vis = !stereo ? XR_EYE_VISIBILITY_BOTH : (i == 0 ? XR_EYE_VISIBILITY_LEFT : XR_EYE_VISIBILITY_RIGHT);
            const void* next = settingsSupported_ ? &settings_ : nullptr;
            if (flat) {
                if (info.shape == Shape::kScreen && screenCurved_ && cylinderSupported_) {
                    const CylinderParams cp =
                        ScreenCylinderParams(pic.layout, pic.srcW, pic.srcH, screenScale_, screenCurvature_);
                    XrCompositionLayerCylinderKHR l{XR_TYPE_COMPOSITION_LAYER_CYLINDER_KHR};
                    l.next = next;
                    l.space = host_->Xr().appSpace;
                    l.eyeVisibility = vis;
                    l.subImage.swapchain = shown_.swapchain;
                    l.subImage.imageRect = rect;
                    const XrVector3f fwd = Rotate(q, {0, 0, -1});
                    l.pose.orientation = q;
                    l.pose.position = {anchor_.x + fwd.x * static_cast<float>(cp.centerForwardOffset),
                                       anchor_.y + fwd.y * static_cast<float>(cp.centerForwardOffset),
                                       anchor_.z + fwd.z * static_cast<float>(cp.centerForwardOffset)};
                    l.radius = static_cast<float>(cp.radius);
                    l.centralAngle = static_cast<float>(cp.centralAngle);
                    l.aspectRatio = static_cast<float>(cp.aspectRatio);
                    sink.AddCylinder(kOrderContent, l);
                } else {
                    XrCompositionLayerQuad l{XR_TYPE_COMPOSITION_LAYER_QUAD};
                    l.next = next;
                    l.space = host_->Xr().appSpace;
                    l.eyeVisibility = vis;
                    l.subImage.swapchain = shown_.swapchain;
                    l.subImage.imageRect = rect;
                    const XrVector3f fwd = Rotate(q, {0, 0, static_cast<float>(-kScreenDistance)});
                    l.pose.orientation = q;
                    l.pose.position = {anchor_.x + fwd.x, anchor_.y + fwd.y, anchor_.z + fwd.z};
                    const QuadSize size = ScreenQuadSize(pic.layout, pic.srcW, pic.srcH, screenScale_);
                    l.size = {static_cast<float>(size.width), static_cast<float>(size.height)};
                    sink.AddQuad(kOrderContent, l);
                }
            } else {
                XrCompositionLayerEquirect2KHR l{XR_TYPE_COMPOSITION_LAYER_EQUIRECT2_KHR};
                l.next = next;
                l.space = host_->Xr().appSpace;
                l.eyeVisibility = vis;
                l.subImage.swapchain = shown_.swapchain;
                l.subImage.imageRect = rect;
                l.pose.orientation = q;
                l.pose.position = headValid_ ? head_.position : anchor_;  // follows the head
                l.radius = static_cast<float>(kSphereRadius);
                l.centralHorizontalAngle = static_cast<float>(info.shape == Shape::kSphere360 ? 2 * M_PI : M_PI);
                l.upperVerticalAngle = static_cast<float>(M_PI / 2);
                l.lowerVerticalAngle = static_cast<float>(-M_PI / 2);
                sink.AddEquirect2(kOrderBackground, l);
            }
        }
    }

    // ------------------------------------------------------------------ Viewer
    // Also called again without Close when the next file is a picture too (§8): the picture on
    // screen stays until the new one is ready, then it is swapped. On true the fd is ours (the Java
    // side adopts it and closes it on release); on false core closes it, so we never touch it.
    bool Open(const OpenRequest& request, std::string* error) override {
        if (!bridge_ || !host_) {
            if (error) *error = "image bridge missing";
            return false;
        }
        open_ = true;
        StartLoad(request.uri, request.name, request.fd, request.sourceId, request.layoutHint);
        return true;
    }

    void Close() override {
        if (!open_ && !shownValid() && !pending_.swapchain) return;
        open_ = false;
        ReleaseToken(cur_.token);
        if (shownPic_.token != cur_.token) ReleaseToken(shownPic_.token);
        DestroyTexture(shown_);
        DestroyTexture(pending_);
        cur_ = Picture{};
        shownPic_ = Picture{};
        pendingPic_ = Picture{};
        inFlight_ = false;
        wantDecode_ = false;
        pendingJob_ = 0;
        error_.clear();
        // Placement, turn and zoom carry over to the next opened picture, like the web app.
    }

    // ------------------------------------------------------------------ HUD (§14)
    bool DescribeHud(hud::Model& out) override {
        if (!open_) return false;
        out.title = cur_.name.empty() ? "사진" : cur_.name;
        const Picture& pic = cur_.probed ? cur_ : shownPic_;
        std::string sub = Info(pic.layout).label;
        if (pic.srcW > 0) sub += " · " + Dims(pic.srcW, pic.srcH);
        out.subtitle = sub;
        if (!error_.empty()) out.status = error_;
        else if (loading()) out.status = "불러오는 중…";
        else if (!equirectSupported_ && Info(pic.layout).shape != Shape::kScreen)
            out.status = "이 기기는 360/180 레이어를 지원하지 않아 평면으로 보여요";
        else if (!cur_.layoutFromUser && cur_.detection.confidence == Confidence::kLow)
            out.status = "형식을 비율로 추정했어요. 다르면 [형식]을 바꾸세요.";

        const auto& order = LayoutOrder();
        hud::Control layout;
        layout.id = "layout";
        layout.kind = hud::Kind::kChoice;
        layout.label = "형식";
        for (size_t i = 0; i < order.size(); ++i) {
            layout.options.push_back(Info(order[i]).shortLabel);
            if (order[i] == pic.layout) layout.value = static_cast<float>(i);
        }
        layout.max = static_cast<float>(order.size() - 1);
        layout.row = 0;
        out.controls.push_back(layout);

        const bool screen = Info(pic.layout).shape == Shape::kScreen;
        hud::Control curve;
        curve.id = "screenCurve";
        curve.kind = hud::Kind::kChoice;
        curve.label = "화면";
        curve.options = {"평면", "커브"};
        curve.value = (screenCurved_ && cylinderSupported_) ? 1.0f : 0.0f;
        curve.max = 1.0f;
        curve.enabled = screen && cylinderSupported_;
        curve.row = 0;
        out.controls.push_back(curve);

        auto button = [](const char* id, const char* label, const char* icon, const char* page, int row) {
            hud::Control c;
            c.id = id;
            c.kind = hud::Kind::kButton;
            c.label = label;
            c.icon = icon;
            c.page = page;
            c.row = row;
            return c;
        };
        out.controls.push_back(button("zoomOut", "줌 −", "zoomOut", "main", 1));
        hud::Control zoom;
        zoom.id = "zoomLabel";
        zoom.kind = hud::Kind::kLabel;
        zoom.label = ZoomLabel(screen, screen ? screenScale_ : sphereZoom_);
        zoom.row = 1;
        out.controls.push_back(zoom);
        out.controls.push_back(button("zoomIn", "줌 +", "zoomIn", "main", 1));
        out.controls.push_back(button("recenter", "화면 위치 맞춤", "recenter", "main", 1));

        hud::Control swap;
        swap.id = "swapEyes";
        swap.kind = hud::Kind::kToggle;
        swap.label = "좌우 눈 바꿈";
        swap.icon = "swapEyes";
        swap.value = swapEyes_ ? 1.f : 0.f;
        swap.enabled = Info(pic.layout).stereo != Stereo::kMono;
        swap.page = "more";
        out.controls.push_back(swap);
        out.controls.push_back(button("zoomReset", "줌 처음 크기로", "", "more", 0));

        hud::Control curvature;
        curvature.id = "curvature";
        curvature.kind = hud::Kind::kSlider;
        curvature.label = "곡률";
        curvature.value = static_cast<float>(screenCurvature_);
        curvature.min = static_cast<float>(kMinCurvature);
        curvature.max = static_cast<float>(kMaxCurvature);
        curvature.step = 0.05f;
        curvature.format = "percent";
        curvature.enabled = screen && screenCurved_ && cylinderSupported_;
        curvature.page = "more";
        curvature.row = 1;
        out.controls.push_back(curvature);

        out.diagnostics.push_back("원본 " + Dims(pic.srcW, pic.srcH) + " · 텍스처 " + Dims(shown_.w, shown_.h) +
                                  (shown_.crop.w > 0 && (shown_.crop.w != shownPic_.srcW || shown_.crop.h != shownPic_.srcH)
                                       ? " (가운데 " + Dims(shown_.crop.w, shown_.crop.h) + ")"
                                       : ""));
        out.diagnostics.push_back("디코드 " + std::to_string(lastDecodeMs_) + " ms · 스왑체인 최대 " +
                                  Dims(runtimeMaxW_, runtimeMaxH_) + (settingsSupported_ ? " · 슈퍼샘플링" : "") +
                                  (cylinderSupported_ ? " · 커브 지원" : " · 커브 미지원"));
        std::string reasons = "판별: ";
        for (const auto& r : pic.detection.reasons) reasons += r + "; ";
        out.diagnostics.push_back(pic.layoutFromUser ? "형식: 사람이 고름(기억됨)" : reasons);
        return true;
    }

    void OnHudAction(const std::string& id, float value, hud::Phase phase) override {
        if (id == "curvature") {
            screenCurvature_ = ClampCurvature(value);
            if (phase == hud::Phase::kCommit) {
                PutPref("screen.curvature", std::to_string(screenCurvature_));
                ui::InvalidateHud();
            }
            return;
        }
        if (phase != hud::Phase::kCommit) return;
        if (id == "layout") {
            const auto& order = LayoutOrder();
            const int i = static_cast<int>(std::lround(value));
            if (i >= 0 && i < static_cast<int>(order.size())) SetLayout(order[i]);
        } else if (id == "screenCurve") {
            SetScreenCurved(std::lround(value) != 0);
            ui::Toast(screenCurved_ ? "화면: 커브" : "화면: 평면", 2);
        } else if (id == "zoomIn") {
            ZoomBy(1.25);
        } else if (id == "zoomOut") {
            ZoomBy(1 / 1.25);
        } else if (id == "zoomReset") {
            ResetZoom();
        } else if (id == "recenter") {
            Recenter();
        } else if (id == "swapEyes") {
            SetSwapEyes(value > 0.5f);
        }
        ui::InvalidateHud();
    }

    // ------------------------------------------------------------------ ViewerApi (image_api.h)
    ViewerState State() const override {
        ViewerState s;
        s.open = open_;
        s.loading = loading();
        s.name = cur_.name;
        s.error = error_;
        s.layout = cur_.probed ? cur_.layout : shownPic_.layout;
        s.layoutFromUser = cur_.layoutFromUser;
        s.srcW = cur_.srcW;
        s.srcH = cur_.srcH;
        s.texW = shown_.w;
        s.texH = shown_.h;
        s.swapEyes = swapEyes_;
        s.screenCurved = screenCurved_;
        s.screenCurvature = screenCurvature_;
        s.screenScale = screenScale_;
        s.sphereZoom = sphereZoom_;
        return s;
    }

    void SetLayout(Layout layout) override {
        if (!cur_.probed) return;
        cur_.layout = layout;
        cur_.layoutFromUser = true;
        layoutMemory_.Remember(cur_.key, layout);
        PutPref("layouts", layoutMemory_.Serialize());
        if (shownPic_.token == cur_.token) {
            shownPic_.layout = layout;
            shownPic_.layoutFromUser = true;
        }
        ui::Toast(std::string("형식: ") + Info(layout).label, 2);
        ui::InvalidateHud();
        // A different layout may want a different texture (crop/size): MaybeRefine() decides.
    }

    void CycleLayoutBy(int direction) override {
        if (!cur_.probed) return;
        SetLayout(CycleLayout(cur_.layout, direction));
    }

    void ZoomBy(double factor) override {
        if (!(factor > 0) || !std::isfinite(factor)) return;
        if (IsScreen()) screenScale_ = ClampScreenScale(screenScale_ * factor);
        else sphereZoom_ = ClampSphereZoom(sphereZoom_ * factor);
        zoomDirty_ = true;
        lastZoomChange_ = Now();
        ui::InvalidateHud();
    }

    void ResetZoom() override {
        if (IsScreen()) screenScale_ = kDefaultScreenScale;
        else sphereZoom_ = kDefaultSphereZoom;
        zoomDirty_ = true;
        lastZoomChange_ = Now();
        ui::InvalidateHud();
    }

    void Recenter() override {
        if (!headValid_) {
            needPlace_ = true;
            return;
        }
        baseYaw_ = HeadYaw(head_.orientation);
        anchor_ = head_.position;
        turnYaw_ = 0;
        turnPitch_ = 0;
    }

    void SetSwapEyes(bool on) override {
        swapEyes_ = on;
        ui::InvalidateHud();
    }

    void SetScreenCurved(bool curved) override {
        if (curved && !cylinderSupported_) {
            screenCurved_ = false;
            ui::Toast("이 기기는 커브 화면을 지원하지 않아요", 3);
            ui::InvalidateHud();
            return;
        }
        screenCurved_ = curved;
        PutPref("screen.curved", screenCurved_ ? "1" : "0");
        ui::InvalidateHud();
    }

    void SetScreenCurvature(double curvature) override {
        screenCurvature_ = ClampCurvature(curvature);
        PutPref("screen.curvature", std::to_string(screenCurvature_));
        ui::InvalidateHud();
    }

    // ------------------------------------------------------------------ Java callbacks (render thread)
    void OnProbed(int64_t token, int w, int h, const std::string& err) {
        if (token != cur_.token) return;
        if (!err.empty() || w <= 0 || h <= 0) {
            Fail(err.empty() ? "크기를 읽지 못했어요" : err);
            return;
        }
        cur_.srcW = w;
        cur_.srcH = h;
        cur_.probed = true;
        cur_.detection = DetectLayout(cur_.name, w, h);
        Layout chosen = cur_.detection.layout;
        if (!hint_.empty() && ParseLayout(hint_, &chosen)) {
            cur_.layoutFromUser = true;
        } else if (layoutMemory_.Recall(cur_.key, &chosen)) {
            cur_.layoutFromUser = true;
        }
        cur_.layout = chosen;
        QN_LOGI("[image] %s %dx%d -> %s%s", cur_.name.c_str(), w, h, LayoutId(chosen),
                cur_.layoutFromUser ? " (remembered/hint)" : "");
        if (inFlight_) wantDecode_ = true;
        else RequestDecode();
        ui::InvalidateHud();
    }

    void OnDecoded(int64_t token, int job, int w, int h, const std::vector<uint8_t>& luma, int lw, int lh, int ms,
                   const std::string& err) {
        if (job != pendingJob_ || token != pendingPic_.token) {
            Drop(token, job);
            return;
        }
        if (!err.empty() || w <= 0 || h <= 0) {
            inFlight_ = false;
            if (token == cur_.token && !shownValid(token)) Fail(err.empty() ? "그림을 풀지 못했어요" : err);
            else QN_LOGW("[image] refine failed: %s", err.c_str());
            return;
        }
        lastDecodeMs_ = ms;
        // Ratio-only guesses (low confidence) are checked against the picture itself once.
        if (token == cur_.token && !cur_.layoutFromUser && !cur_.sniffed && !luma.empty()) {
            cur_.sniffed = true;
            const Sniff sniff = SniffStereo(luma.data(), lw, lh);
            const Detection refined = RefineWithSniff(cur_.detection, sniff, static_cast<double>(cur_.srcW) / cur_.srcH);
            if (refined.layout != cur_.detection.layout) {
                QN_LOGI("[image] sniff sbs=%.2f tb=%.2f -> %s", sniff.sbs, sniff.tb, LayoutId(refined.layout));
                cur_.detection = refined;
                cur_.layout = refined.layout;
                pendingPic_.layout = refined.layout;
                pendingPic_.detection = refined;
            }
        }
        XrSwapchainCreateInfo ci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
        ci.usageFlags = XR_SWAPCHAIN_USAGE_SAMPLED_BIT | XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT;
        ci.width = static_cast<uint32_t>(w);
        ci.height = static_cast<uint32_t>(h);
        ci.sampleCount = 1;
        ci.faceCount = 1;
        ci.arraySize = 1;
        ci.mipCount = 1;
        XrSwapchain sc = XR_NULL_HANDLE;
        jobject surface = nullptr;
        if (!host_->CreateSurfaceSwapchain(ci, &sc, &surface)) {
            inFlight_ = false;
            Drop(token, job);
            Fail("이 기기에서 사진 레이어를 만들 수 없어요(Surface 스왑체인)");
            return;
        }
        pending_.swapchain = sc;
        pending_.surface = surface;
        pending_.w = w;
        pending_.h = h;
        pending_.crop = pendingCrop_;
        pending_.job = job;
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(bridge_, mDraw_, static_cast<jlong>(token), static_cast<jint>(job), surface);
        if (!CheckJni(env, "draw")) {
            inFlight_ = false;
            DestroyTexture(pending_);
            Fail("그림을 레이어에 올리지 못했어요");
        }
    }

    void OnDrawn(int64_t token, int job, bool ok, const std::string& err) {
        if (job != pending_.job || token != pendingPic_.token) return;  // already destroyed
        inFlight_ = false;
        if (!ok) {
            DestroyTexture(pending_);
            if (token == cur_.token && !shownValid(token)) Fail(err.empty() ? "그림을 레이어에 올리지 못했어요" : err);
            return;
        }
        const int64_t oldToken = shownPic_.token;
        DestroyTexture(shown_);
        shown_ = pending_;
        pending_ = Texture{};
        shownPic_ = pendingPic_;
        if (oldToken && oldToken != shownPic_.token) ReleaseToken(oldToken);
        if (token == cur_.token) {
            // Keep layout changes made while this texture was being prepared.
            shownPic_.layout = cur_.layout;
            shownPic_.layoutFromUser = cur_.layoutFromUser;
            shownPic_.detection = cur_.detection;
            error_.clear();
        }
        if (!placed_) {
            placed_ = true;
            Recenter();
        }
        QN_LOGI("[image] showing %s: texture %dx%d crop %d,%d %dx%d", shownPic_.name.c_str(), shown_.w, shown_.h,
                shown_.crop.x, shown_.crop.y, shown_.crop.w, shown_.crop.h);
        ui::InvalidateHud();
    }

private:
    bool shownValid() const { return shown_.swapchain != XR_NULL_HANDLE; }
    bool shownValid(int64_t token) const { return shownValid() && shownPic_.token == token; }
    bool loading() const { return open_ && error_.empty() && !shownValid(cur_.token); }
    bool IsScreen() const {
        const Picture& p = cur_.probed ? cur_ : shownPic_;
        return Info(p.layout).shape == Shape::kScreen;
    }

    void StartLoad(const std::string& uri, const std::string& name, int fd, const std::string& sourceId,
                   const std::string& hint) {
        if (cur_.token && cur_.token != shownPic_.token) ReleaseToken(cur_.token);
        cur_ = Picture{};
        cur_.token = ++tokenCounter_;
        cur_.uri = uri;
        cur_.name = name.empty() ? uri.substr(uri.find_last_of('/') + 1) : name;
        cur_.sourceId = sourceId;
        cur_.key = sourceId + ":" + (uri.empty() ? name : uri);
        hint_ = hint;
        error_.clear();
        wantDecode_ = false;
        JNIEnv* env = host_->Env();
        jstring u = env->NewStringUTF(uri.c_str());
        jstring n = env->NewStringUTF(cur_.name.c_str());
        env->CallStaticVoidMethod(bridge_, mProbe_, static_cast<jlong>(cur_.token), u, static_cast<jint>(fd), n);
        env->DeleteLocalRef(u);
        env->DeleteLocalRef(n);
        CheckJni(env, "probe");
        ui::InvalidateHud();
    }

    // What texture the current picture wants now: crop of the source and decode size.
    void Want(const Picture& pic, RectI* crop, Size* size) const {
        RectI c{0, 0, pic.srcW, pic.srcH};
        SizeRequest r;
        r.layout = pic.layout;
        r.screenScale = screenScale_;
        r.sphereZoom = sphereZoom_;
        if (SphereZoomCrop(pic.layout, pic.srcW, pic.srcH, sphereZoom_, &c)) r.sphereZoom = 1;  // crop shown over the full sphere
        r.srcW = c.w;
        r.srcH = c.h;
        *crop = c;
        *size = TargetDecodeSize(r, limits_);
    }

    void RequestDecode() {
        if (!cur_.probed || !bridge_) return;
        RectI crop;
        Size size;
        Want(cur_, &crop, &size);
        StartJob(cur_, crop, size);
    }

    void StartJob(const Picture& pic, const RectI& crop, const Size& size) {
        pendingPic_ = pic;
        pendingCrop_ = crop;
        pendingJob_ = ++jobCounter_;
        inFlight_ = true;
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(bridge_, mDecode_, static_cast<jlong>(pic.token), static_cast<jint>(pendingJob_),
                                  static_cast<jint>(size.w), static_cast<jint>(size.h), static_cast<jint>(crop.x),
                                  static_cast<jint>(crop.y), static_cast<jint>(crop.w), static_cast<jint>(crop.h));
        if (!CheckJni(env, "decode")) inFlight_ = false;
        QN_LOGI("[image] decode job %d: %s crop %d,%d %dx%d -> %dx%d", pendingJob_, pic.name.c_str(), crop.x, crop.y,
                crop.w, crop.h, size.w, size.h);
    }

    // After zoom or layout changes: re-decode when the shown texture is clearly too soft or does not
    // cover what is now visible.
    void MaybeRefine() {
        RectI crop;
        Size size;
        Want(cur_, &crop, &size);
        if (size.w <= 0 || crop.w <= 0) return;
        // What must be visible now (all eyes) in source pixels.
        const LayoutInfo& info = Info(cur_.layout);
        bool covered = true;
        for (int eye = 0; eye < 2; ++eye) {
            RectI need = EyeRect(cur_.layout, eye, cur_.srcW, cur_.srcH);
            if (info.shape != Shape::kScreen) need = ZoomRect(need, sphereZoom_);
            const RectI& have = shown_.crop;
            if (need.x < have.x || need.y < have.y || need.x + need.w > have.x + have.w || need.y + need.h > have.y + have.h)
                covered = false;
        }
        const double haveDensity = static_cast<double>(shown_.w) / std::max(1, shown_.crop.w);
        const double wantDensity = static_cast<double>(size.w) / crop.w;
        const bool sharper = wantDensity > haveDensity * kRefineGain;
        // Zoomed back out of a crop: a whole-picture texture is needed again (covered is false then).
        if (covered && !sharper) return;
        StartJob(cur_, crop, size);
    }

    XrRect2Di ToTextureRect(const RectI& src, const Texture& t) const {
        const RectI& c = t.crop.w > 0 ? t.crop : RectI{0, 0, shownPic_.srcW, shownPic_.srcH};
        const double sx = static_cast<double>(t.w) / std::max(1, c.w);
        const double sy = static_cast<double>(t.h) / std::max(1, c.h);
        int x0 = static_cast<int>(std::lround((src.x - c.x) * sx));
        int y0 = static_cast<int>(std::lround((src.y - c.y) * sy));
        int x1 = static_cast<int>(std::lround((src.x + src.w - c.x) * sx));
        int y1 = static_cast<int>(std::lround((src.y + src.h - c.y) * sy));
        x0 = std::max(0, std::min(t.w - 1, x0));
        y0 = std::max(0, std::min(t.h - 1, y0));
        x1 = std::max(x0 + 1, std::min(t.w, x1));
        y1 = std::max(y0 + 1, std::min(t.h, y1));
        return XrRect2Di{{x0, y0}, {x1 - x0, y1 - y0}};
    }

    void Fail(const std::string& message) {
        error_ = message;
        QN_LOGW("[image] %s: %s", cur_.name.c_str(), message.c_str());
        ui::Toast(message, 4);
        ui::InvalidateHud();
    }

    void DestroyTexture(Texture& t) {
        if (t.swapchain != XR_NULL_HANDLE) xrDestroySwapchain(t.swapchain);
        if (t.surface && host_) host_->Env()->DeleteGlobalRef(t.surface);
        t = Texture{};
    }

    void Drop(int64_t token, int job) {
        if (!bridge_ || !host_) return;
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(bridge_, mDrop_, static_cast<jlong>(token), static_cast<jint>(job));
        CheckJni(env, "drop");
    }

    void ReleaseToken(int64_t token) {
        if (!token || !bridge_ || !host_) return;
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(bridge_, mRelease_, static_cast<jlong>(token));
        CheckJni(env, "release");
    }

    std::string GetPref(const char* key) {
        if (!bridge_ || !host_) return {};
        JNIEnv* env = host_->Env();
        jstring k = env->NewStringUTF(key);
        auto v = static_cast<jstring>(env->CallStaticObjectMethod(bridge_, mGetPref_, k));
        env->DeleteLocalRef(k);
        if (!CheckJni(env, "getPref")) return {};
        std::string out = JString(env, v);
        if (v) env->DeleteLocalRef(v);
        return out;
    }

    void PutPref(const char* key, const std::string& value) {
        if (!bridge_ || !host_) return;
        JNIEnv* env = host_->Env();
        jstring k = env->NewStringUTF(key);
        jstring v = env->NewStringUTF(value.c_str());
        env->CallStaticVoidMethod(bridge_, mPutPref_, k, v);
        env->DeleteLocalRef(k);
        env->DeleteLocalRef(v);
        CheckJni(env, "putPref");
    }

    void LoadPrefs() {
        const std::string s = GetPref("zoom.screen");
        const std::string z = GetPref("zoom.sphere");
        const std::string sc = GetPref("screen.curved");
        const std::string curv = GetPref("screen.curvature");
        if (!s.empty()) screenScale_ = ClampScreenScale(std::atof(s.c_str()));
        if (!z.empty()) sphereZoom_ = ClampSphereZoom(std::atof(z.c_str()));
        if (!sc.empty()) screenCurved_ = (sc == "1" || sc == "true");
        if (!curv.empty()) screenCurvature_ = ClampCurvature(std::atof(curv.c_str()));
        layoutMemory_.Parse(GetPref("layouts"));
    }

    Host* host_ = nullptr;
    jclass bridge_ = nullptr;
    jmethodID mProbe_ = nullptr, mDecode_ = nullptr, mDraw_ = nullptr, mDrop_ = nullptr, mRelease_ = nullptr,
              mGetPref_ = nullptr, mPutPref_ = nullptr;

    SizeLimits limits_;
    int runtimeMaxW_ = 0, runtimeMaxH_ = 0;
    bool settingsSupported_ = false;
    bool equirectSupported_ = true;
    bool cylinderSupported_ = false;
    XrCompositionLayerSettingsFB settings_{XR_TYPE_COMPOSITION_LAYER_SETTINGS_FB};

    bool open_ = false;
    int64_t tokenCounter_ = 0;
    int jobCounter_ = 0;
    Picture cur_;         // the picture asked for (may still be loading)
    Picture shownPic_;    // the picture whose texture is on screen
    Picture pendingPic_;  // the picture of the job in flight
    Texture shown_, pending_;
    RectI pendingCrop_;
    int pendingJob_ = 0;
    bool inFlight_ = false;
    bool wantDecode_ = false;
    std::string hint_;
    std::string error_;
    int lastDecodeMs_ = 0;

    // Placement and view.
    XrPosef head_{{0, 0, 0, 1}, {0, 0, 0}};
    bool headValid_ = false;
    bool placed_ = false;
    bool needPlace_ = false;
    XrVector3f anchor_{0, 1.6f, 0};
    double baseYaw_ = 0, turnYaw_ = 0, turnPitch_ = 0;
    double screenScale_ = kDefaultScreenScale;
    double sphereZoom_ = kDefaultSphereZoom;
    bool screenCurved_ = false;
    double screenCurvature_ = kDefaultCurvature;
    bool zoomDirty_ = false;
    double lastZoomChange_ = 0;
    bool swapEyes_ = false;
    XrTime lastInputTime_ = 0;

    LayoutMemory layoutMemory_;
};

ModuleInfo MakeInfo() {
    ModuleInfo info;
    info.id = "image";
    info.kind = ModuleKind::kViewer;
    info.fileExtensions = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".gif", ".bmp"};
    info.mimePrefixes = {"image/"};
    info.optionalXrExtensions = {XR_FB_COMPOSITION_LAYER_SETTINGS_EXTENSION_NAME};
    info.create = [] { return std::make_unique<ImageViewer>(); };
    return info;
}

// Java callbacks arrive on the image worker thread; hop to the render thread. PostIfRunning drops
// the call when the native side is not running (late callback after shutdown).
void Post(std::function<void(ImageViewer&)> fn) {
    if (!g_viewer.load()) return;
    PostIfRunning([fn = std::move(fn)]() {
        if (ImageViewer* v = g_viewer.load()) fn(*v);
    });
}

}  // namespace

std::atomic<ViewerApi*> g_api{nullptr};
void SetApi(ViewerApi* api) { g_api.store(api); }
ViewerApi* Api() { return g_api.load(); }

}  // namespace image
}  // namespace qn

QN_REGISTER_MODULE(qn::image::MakeInfo());

// ------------------------------------------------------------------ JNI (com.sharp.questnative.image.ImageBridge)

using qn::image::ImageViewer;

extern "C" JNIEXPORT void JNICALL Java_com_sharp_questnative_image_ImageBridge_nativeProbed(JNIEnv* env, jclass,
                                                                                           jlong token, jint w, jint h,
                                                                                           jstring err) {
    std::string e = qn::image::JString(env, err);
    qn::image::Post([=](ImageViewer& v) { v.OnProbed(token, w, h, e); });
}

extern "C" JNIEXPORT void JNICALL Java_com_sharp_questnative_image_ImageBridge_nativeDecoded(
    JNIEnv* env, jclass, jlong token, jint job, jint w, jint h, jbyteArray luma, jint lw, jint lh, jint ms, jstring err) {
    std::vector<uint8_t> bytes;
    if (luma) {
        const jsize n = env->GetArrayLength(luma);
        if (n >= lw * lh && lw > 0 && lh > 0) {
            bytes.resize(static_cast<size_t>(n));
            env->GetByteArrayRegion(luma, 0, n, reinterpret_cast<jbyte*>(bytes.data()));
        }
    }
    std::string e = qn::image::JString(env, err);
    qn::image::Post([=, bytes = std::move(bytes)](ImageViewer& v) { v.OnDecoded(token, job, w, h, bytes, lw, lh, ms, e); });
}

extern "C" JNIEXPORT void JNICALL Java_com_sharp_questnative_image_ImageBridge_nativeDrawn(JNIEnv* env, jclass,
                                                                                          jlong token, jint job,
                                                                                          jboolean ok, jstring err) {
    std::string e = qn::image::JString(env, err);
    const bool good = ok == JNI_TRUE;
    qn::image::Post([=](ImageViewer& v) { v.OnDrawn(token, job, good, e); });
}

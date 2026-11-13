// ui module: VR panels drawn by Java (android.graphics.Canvas) into Android Surface swapchains and
// submitted as quad layers; controller rays, panel placement, HUD model relay. Owner: ui (image-dev).
//
// Panels (fixed set, content drawn by com.sharp.questnative.ui.PanelHost):
//   0 list  : shared panel (folder tree + file list, settings pages)  1024x768 px, 1.2 x 0.9 m
//   1 hud   : active viewer HUD (docs/module-contract.md 14)          1024x400 px, 1.2 x 0.469 m
//   2 toast : one-line notice                                         768x96 px,   0.8 x 0.1 m
// Java <-> native: UiBridge static methods (attachSurface, pointer, setPanelVisible, setHudModel,
// showToast) and natives (nativeCommand, nativeHudAction) below.
#include <cmath>
#include <cstring>
#include <functional>
#include <map>
#include <string>
#include <unistd.h>

#include "core/qn_api.h"
#include "core/qn_log.h"
#include "core/xr_math.h"
#include "image/image_logic.h"
#include "ui/hud_json.h"
#include "ui/ui_api.h"

namespace qn {
namespace ui {
namespace {

using namespace qn::math;

enum PanelId { kList = 0, kHud = 1, kToast = 2, kPanelCount = 3 };
enum PointerType { kHover = 0, kDown = 1, kUp = 2, kLeave = 3, kScroll = 4 };

struct PanelDef {
    int wPx, hPx;
    float wM, hM;
};
constexpr PanelDef kDefs[kPanelCount] = {{1024, 768, 1.2f, 0.9f}, {1024, 400, 1.2f, 0.46875f}, {768, 96, 0.8f, 0.1f}};

constexpr float kLongPressS = 0.6f;
constexpr float kHudAutoHideS = 9.0f;
constexpr float kHudPullS = 0.1f;  // at most 10 pulls a second
constexpr float kDefaultToastS = 3.0f;

struct Panel {
    XrSwapchain swapchain = XR_NULL_HANDLE;
    jobject surface = nullptr;
    XrPosef pose{{0, 0, 0, 1}, {0, 0, 0}};
    bool visible = false;
    bool sentVisible = false;
};

struct HandRay {
    int hover = -1;    // panel under the ray
    int capture = -1;  // panel holding the trigger drag
    float x = 0, y = 0;
    // Drawn ray (thin quad layer): origin, direction, length to the hit (or kRayLength).
    bool show = false;
    XrVector3f origin{0, 0, 0}, dir{0, 0, -1};
    float length = 0;
};

constexpr float kRayLength = 2.0f;   // when the ray hits no panel
constexpr float kRayWidth = 0.006f;  // metres
constexpr int kRayTexW = 16, kRayTexH = 64;

class UiModule;
UiModule* g_ui = nullptr;

class UiModule final : public Module {
public:
    UiModule() { g_ui = this; }
    ~UiModule() override {
        if (g_ui == this) g_ui = nullptr;
    }

    void OnStart(Host& host) override {
        host_ = &host;
        JNIEnv* env = host.Env();
        bridge_ = host.FindAppClass("com.sharp.questnative.ui.UiBridge");
        if (!bridge_) return;
        attach_ = env->GetStaticMethodID(bridge_, "attachSurface", "(ILandroid/view/Surface;II)V");
        pointer_ = env->GetStaticMethodID(bridge_, "pointer", "(IIIFFF)V");
        setVisible_ = env->GetStaticMethodID(bridge_, "setPanelVisible", "(IZ)V");
        setHud_ = env->GetStaticMethodID(bridge_, "setHudModel", "(Ljava/lang/String;Ljava/lang/String;)V");
        showToast_ = env->GetStaticMethodID(bridge_, "showToast", "(Ljava/lang/String;F)V");
        attachRay_ = env->GetStaticMethodID(bridge_, "attachRaySurface", "(Landroid/view/Surface;II)V");
        captured_ = env->GetStaticMethodID(bridge_, "bindingCaptured", "(Ljava/lang/String;)V");
        navigate_ = env->GetStaticMethodID(bridge_, "navigate", "(I)V");
        setSlideshow_ = env->GetStaticMethodID(bridge_, "setSlideshow", "(ZI)V");
        hudShortcut_ = env->GetStaticMethodID(bridge_, "hudShortcut", "(Ljava/lang/String;Ljava/lang/String;)V");
        if (!attach_ || !pointer_ || !setVisible_ || !setHud_ || !showToast_ || !navigate_ || !setSlideshow_ ||
            !hudShortcut_ || !attachRay_ || !captured_) {
            Clear(env);
            QN_LOGE("[ui] UiBridge methods missing");
            bridge_ = nullptr;
            return;
        }
        for (int i = 0; i < kPanelCount; ++i) {
            XrSwapchainCreateInfo ci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
            ci.width = (uint32_t)kDefs[i].wPx;
            ci.height = (uint32_t)kDefs[i].hPx;
            ci.faceCount = 1;
            ci.arraySize = 1;
            ci.mipCount = 1;
            ci.sampleCount = 1;
            if (!host.CreateSurfaceSwapchain(ci, &panels_[i].swapchain, &panels_[i].surface)) {
                QN_LOGE("[ui] surface swapchain unavailable: VR panels disabled");
                ready_ = false;
                return;
            }
            env->CallStaticVoidMethod(bridge_, attach_, i, panels_[i].surface, kDefs[i].wPx, kDefs[i].hPx);
            Clear(env);
        }
        XrSwapchainCreateInfo rci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
        rci.width = kRayTexW;
        rci.height = kRayTexH;
        rci.faceCount = rci.arraySize = rci.mipCount = rci.sampleCount = 1;
        if (host.CreateSurfaceSwapchain(rci, &raySwapchain_, &raySurface_)) {
            env->CallStaticVoidMethod(bridge_, attachRay_, raySurface_, kRayTexW, kRayTexH);
            Clear(env);
        }
        ready_ = true;
        QN_LOGI("[ui] %d panels attached", kPanelCount);
    }

    void OnStop() override {
        JNIEnv* env = host_ ? host_->Env() : nullptr;
        for (auto& p : panels_) {
            if (p.swapchain) xrDestroySwapchain(p.swapchain);
            if (p.surface && env) env->DeleteGlobalRef(p.surface);
            p = Panel{};
        }
        if (raySwapchain_) xrDestroySwapchain(raySwapchain_);
        if (raySurface_ && env) env->DeleteGlobalRef(raySurface_);
        raySwapchain_ = XR_NULL_HANDLE;
        raySurface_ = nullptr;
        ready_ = false;
    }

    bool OnInput(const InputState& in) override {
        if (!ready_) return false;
        double t = in.time * 1e-9;
        float dt = lastInputTime_ > 0 ? (float)(t - lastInputTime_) : 0.0f;
        lastInputTime_ = t;
        if (!in.focused) {
            for (int h = 0; h < 2; ++h) {
                Leave(h);
                rays_[h].show = false;
            }
            return false;
        }
        HandleButtons(in, t);

        bool consumed = false;
        for (int h = 0; h < 2; ++h) {
            const HandInput& hi = in.hand[h];
            HandRay& r = rays_[h];
            if (!hi.active || !hi.aimValid) {
                Leave(h);
                r.show = false;
                continue;
            }
            XrVector3f o = hi.aim.position;
            XrVector3f d = Rotate(hi.aim.orientation, {0, 0, -1});
            r.show = true;
            r.origin = o;
            r.dir = d;
            r.length = kRayLength;

            if (r.capture >= 0) {  // dragging: keep projecting onto the captured plane
                float x, y, dist;
                if (Project(r.capture, o, d, false, &x, &y, &dist)) {
                    r.x = x;
                    r.y = y;
                    r.length = dist;
                }
                Send(r.capture, h, hi.triggerButton.down ? kHover : kUp, r.x, r.y, 0);
                if (!hi.triggerButton.down) r.capture = -1;
                consumed = true;
                Touch(t);
                continue;
            }

            int best = -1;
            float bx = 0, by = 0, bestT = 1e9f;
            for (int i = 0; i < kPanelCount; ++i) {
                if (!panels_[i].visible || i == kToast) continue;
                float x, y, dist;
                if (Project(i, o, d, true, &x, &y, &dist) && dist < bestT) {
                    best = i;
                    bestT = dist;
                    bx = x;
                    by = y;
                }
            }
            if (best != r.hover) Leave(h);
            if (best < 0) continue;
            r.hover = best;
            r.x = bx;
            r.y = by;
            r.length = bestT;
            consumed = true;
            Touch(t);
            Send(best, h, kHover, bx, by, 0);
            if (hi.triggerButton.pressed) {
                Send(best, h, kDown, bx, by, 0);
                r.capture = best;
            }
            if (std::fabs(hi.stick.y) > 0.2f) Send(best, h, kScroll, bx, by, hi.stick.y * dt);
        }
        return consumed;
    }

    void Update(const FrameInfo& f) override {
        if (!ready_) return;
        now_ = f.predictedDisplayTime * 1e-9;
        if (f.headValid) head_ = f.head;
        if (placeRequested_ && f.headValid) {
            Place(f.head);
            placeRequested_ = false;
        }

        std::string viewerId = ActiveViewerId();
        if (viewerId != viewerId_) {
            viewerId_ = viewerId;
            hudVisible_ = !viewerId.empty();
            if (!viewerId.empty()) listOpen_ = false;
            hudPullNow_ = true;
            lastInteraction_ = now_;
        }
        if (hudVisible_ && now_ - lastInteraction_ > kHudAutoHideS) hudVisible_ = false;
        // Slideshow: photos and PLY advance on the timer; videos advance when they end (MediaEnded).
        if (slideshow_.Running() && !viewerId_.empty() && viewerId_ != "video" && slideshow_.Tick(f.deltaSeconds)) {
            Navigate(1);
        }

        panels_[kList].visible = !uiHidden_ && listOpen_ && !placeRequested_;
        panels_[kHud].visible = !uiHidden_ && !listOpen_ && hudVisible_ && !viewerId_.empty() && !placeRequested_;
        panels_[kToast].visible = now_ < toastUntil_ && !placeRequested_;

        JNIEnv* env = host_->Env();
        for (int i = 0; i < kPanelCount; ++i) {
            if (panels_[i].visible != panels_[i].sentVisible) {
                env->CallStaticVoidMethod(bridge_, setVisible_, i, (jboolean)panels_[i].visible);
                Clear(env);
                panels_[i].sentVisible = panels_[i].visible;
                if (i == kHud && panels_[i].visible) hudPullNow_ = true;
            }
        }
        if (hudPullNow_ || (panels_[kHud].visible && now_ - lastHudPull_ >= kHudPullS)) PullHud();
    }

    void SubmitLayers(const FrameInfo&, LayerSink& sink) override {
        if (!ready_) return;
        for (int i = 0; i < kPanelCount; ++i) {
            const Panel& p = panels_[i];
            if (!p.visible) continue;
            XrCompositionLayerQuad q{XR_TYPE_COMPOSITION_LAYER_QUAD};
            q.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
            q.space = host_->Xr().appSpace;
            q.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
            q.subImage.swapchain = p.swapchain;
            q.subImage.imageRect = {{0, 0}, {kDefs[i].wPx, kDefs[i].hPx}};
            q.pose = p.pose;
            q.size = {kDefs[i].wM, kDefs[i].hM};
            sink.AddQuad(i == kToast ? kOrderOverlay : kOrderUi, q);
        }
        SubmitRays(sink);
    }

    // Controller rays as thin quads while a panel is up: long axis along the ray, turned about it
    // to face the head. Composition layers have no depth, so they draw over the scene.
    void SubmitRays(LayerSink& sink) {
        if (!raySwapchain_ || uiHidden_ || !(panels_[kList].visible || panels_[kHud].visible)) return;
        for (int h = 0; h < 2; ++h) {
            const HandRay& r = rays_[h];
            if (!r.show || r.length < 0.05f) continue;
            const float start = 0.03f;  // leave the controller tip clear
            float len = r.length - start;
            XrVector3f y = r.dir;
            XrVector3f center = Add(r.origin, Scale(y, start + len * 0.5f));
            XrVector3f toHead = Sub(head_.position, center);
            XrVector3f z = Normalize(Sub(toHead, Scale(y, Dot(toHead, y))));
            if (Length(z) < 0.5f) z = Normalize(Cross(y, {0, 1, 0}));
            if (Length(z) < 0.5f) continue;
            XrVector3f x = Cross(y, z);
            XrCompositionLayerQuad q{XR_TYPE_COMPOSITION_LAYER_QUAD};
            q.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
            q.space = host_->Xr().appSpace;
            q.eyeVisibility = XR_EYE_VISIBILITY_BOTH;
            q.subImage.swapchain = raySwapchain_;
            q.subImage.imageRect = {{0, 0}, {kRayTexW, kRayTexH}};
            q.pose = {FromBasis(x, y, z), center};
            q.size = {kRayWidth, len};
            sink.AddQuad(kOrderOverlay, q);
        }
    }

    // ---- ui_api.h / Java commands (render thread)
    void Toast(const std::string& text, float seconds) {
        if (!ready_) {
            QN_LOGI("[ui] toast: %s", text.c_str());
            return;
        }
        JNIEnv* env = host_->Env();
        jstring s = env->NewStringUTF(text.c_str());
        env->CallStaticVoidMethod(bridge_, showToast_, s, seconds > 0 ? seconds : kDefaultToastS);
        env->DeleteLocalRef(s);
        Clear(env);
        // Java calls back nativeCommand("toast", seconds) which sets toastUntil_.
    }
    void InvalidateHud() { hudPullNow_ = true; }
    void SetHudVisible(bool v) {
        hudVisible_ = v;
        lastInteraction_ = now_;
    }
    bool HudVisible() const { return hudVisible_; }
    bool PanelOpen() const { return listOpen_ && !uiHidden_; }

    void Command(const std::string& cmd, float value) {
        if (cmd == "list.open") {
            listOpen_ = true;
            uiHidden_ = false;
        } else if (cmd == "list.close") {
            listOpen_ = false;
            lastInteraction_ = now_;
        } else if (cmd == "list.toggle") {
            Command(listOpen_ ? "list.close" : "list.open", 0);
        } else if (cmd == "hud.show") {
            SetHudVisible(true);
        } else if (cmd == "hud.hide") {
            hudVisible_ = false;
        } else if (cmd == "ui.hide") {
            uiHidden_ = true;
        } else if (cmd == "ui.place") {
            placeRequested_ = true;
        } else if (cmd == "interact") {
            lastInteraction_ = now_;
        } else if (cmd == "toast") {
            toastUntil_ = now_ + (value > 0 ? value : kDefaultToastS);
        } else if (cmd == "bindings.capture") {
            capturing_ = value > 0.5f;
        } else if (cmd.compare(0, 9, "bindings:") == 0) {
            ParseBindings(cmd.substr(9));
        } else if (cmd == "settings.scale") {
            host_->SetResolutionScale(value);
        } else if (cmd == "settings.refresh") {
            host_->SetRefreshRate(value);
        } else if (cmd == "settings.foveation") {
            host_->SetFoveationLevel((FoveationLevel)std::max(0, std::min(3, (int)value)));
        } else if (cmd == "slideshow.toggle") {
            slideshow_.Toggle();
            if (slideshow_.Running()) slideshow_.OnShown();
            Toast(slideshow_.Running() ? "슬라이드쇼 시작" : "슬라이드쇼 멈춤", 2);
            SendSlideshow();
        } else if (cmd == "slideshow.interval") {
            slideshow_.SetInterval((int)value);
            SendSlideshow();
        } else {
            QN_LOGW("[ui] unknown command %s", cmd.c_str());
        }
    }

    void ParseBindings(const std::string& spec) {
        std::map<std::string, std::string> m;
        size_t pos = 0;
        while (pos < spec.size()) {
            size_t semi = spec.find(';', pos);
            if (semi == std::string::npos) semi = spec.size();
            std::string item = spec.substr(pos, semi - pos);
            size_t eq = item.find('=');
            if (eq != std::string::npos) m[item.substr(0, eq)] = item.substr(eq + 1);
            pos = semi + 1;
        }
        bindings_ = m;
        QN_LOGI("[ui] button table: %zu slots", bindings_.size());
    }

    // Open from the list panel: like Host::OpenMedia, plus the viewer's error as a toast.
    void OpenFromList(const OpenRequest& req) {
        std::string err;
        if (!host_->OpenMedia(req, &err)) {
            Toast(err.empty() || err.compare(0, 13, "no viewer for") == 0 ? "열지 못했어요: " + req.name : err, 4);
        }
    }

    void MediaEnded() {
        if (slideshow_.Running()) Navigate(1);
    }

    void HudAction(const std::string& id, float value, int phase) {
        lastInteraction_ = now_;
        if (Viewer* v = host_ ? host_->ActiveViewer() : nullptr) {
            v->OnHudAction(id, value, phase == 0 ? hud::Phase::kChange : hud::Phase::kCommit);
        }
        hudPullNow_ = true;
    }

private:
    static void Clear(JNIEnv* env) {
        if (env->ExceptionCheck()) {
            env->ExceptionDescribe();
            env->ExceptionClear();
        }
    }

    std::string ActiveViewerId() {
        Viewer* v = host_->ActiveViewer();
        if (!v) return "";
        for (const char* id : {"splat", "video", "image"}) {
            if (host_->FindModule(id) == v) return id;
        }
        return "viewer";
    }

    void PullHud() {
        hudPullNow_ = false;
        lastHudPull_ = now_;
        JNIEnv* env = host_->Env();
        jstring id = env->NewStringUTF(viewerId_.c_str());
        jstring json = nullptr;
        hud::Model model;
        Viewer* v = host_->ActiveViewer();
        if (v && v->DescribeHud(model)) json = env->NewStringUTF(HudToJson(model).c_str());
        env->CallStaticVoidMethod(bridge_, setHud_, id, json);
        env->DeleteLocalRef(id);
        if (json) env->DeleteLocalRef(json);
        Clear(env);
    }

    // Buttons the ui owns (contract 7, 14.8): A, B, X, Y, menu; short = released before 0.6 s,
    // long = held 0.6 s (fires once while held). What each does comes from the button table.
    void HandleButtons(const InputState& in, double t) {
        struct Src {
            const char* name;
            const Button* b;
        };
        const Src src[5] = {{"A", &in.hand[kRight].primary},
                            {"B", &in.hand[kRight].secondary},
                            {"X", &in.hand[kLeft].primary},
                            {"Y", &in.hand[kLeft].secondary},
                            {"menu", &in.hand[kLeft].menu}};
        for (int i = 0; i < 5; ++i) {
            const Button& b = *src[i].b;
            Hold& h = holds_[i];
            std::string base = src[i].name;
            if (b.pressed) {
                h.downAt = t;
                h.longDone = false;
            }
            if (b.down && h.downAt >= 0 && !h.longDone && t - h.downAt >= kLongPressS) {
                h.longDone = true;
                Fire(base + ".long");
            }
            if (b.released) {
                if (!h.longDone && h.downAt >= 0) Fire(base + ".short");
                h.downAt = -1;
            }
        }
    }

    void Fire(const std::string& slot) {
        if (!capturing_) {
            RunAction(Binding(slot));
            return;
        }
        capturing_ = false;
        JNIEnv* env = host_->Env();
        jstring s = env->NewStringUTF(slot.c_str());
        env->CallStaticVoidMethod(bridge_, captured_, s);
        env->DeleteLocalRef(s);
        Clear(env);
    }

    std::string Binding(const std::string& slot) const {
        auto it = bindings_.find(slot);
        return it == bindings_.end() ? std::string() : it->second;
    }

    void RunAction(const std::string& a) {
        if (a.empty()) return;
        if (a == "ui.toggle") {
            uiHidden_ = !uiHidden_;
        } else if (a == "ui.move") {
            uiHidden_ = false;
            Place(head_);
        } else if (a == "list.toggle") {
            Command("list.toggle", 0);
        } else if (a == "nav.prev") {
            Navigate(-1);
        } else if (a == "nav.next") {
            Navigate(1);
        } else if (a == "slideshow.toggle") {
            Command("slideshow.toggle", 0);
        } else if (a == "hud.toggle") {
            SetHudVisible(!hudVisible_);
        } else if (a.compare(0, 4, "hud:") == 0) {
            HudShortcut(a.substr(4));
        } else {
            QN_LOGW("[ui] unknown button action %s", a.c_str());
        }
    }

    // "hud:<id>": press the active viewer's control with that id (toggle flips, choice steps).
    void HudShortcut(const std::string& id) {
        Viewer* v = host_->ActiveViewer();
        if (!v) return;
        hud::Model m;
        if (v->DescribeHud(m)) {
            for (auto& c : m.controls) {
                if (c.id != id || !c.enabled) continue;
                float value = 1;
                if (c.kind == hud::Kind::kToggle) value = c.value >= 0.5f ? 0.0f : 1.0f;
                if (c.kind == hud::Kind::kChoice && !c.options.empty())
                    value = (float)(((int)std::lround(c.value) + 1) % (int)c.options.size());
                v->OnHudAction(id, value, hud::Phase::kCommit);
                hudPullNow_ = true;
                return;
            }
            return;
        }
        JNIEnv* env = host_->Env();  // Java HudProvider (video)
        jstring vid = env->NewStringUTF(viewerId_.c_str());
        jstring cid = env->NewStringUTF(id.c_str());
        env->CallStaticVoidMethod(bridge_, hudShortcut_, vid, cid);
        env->DeleteLocalRef(vid);
        env->DeleteLocalRef(cid);
        Clear(env);
    }

    void SendSlideshow() {
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(bridge_, setSlideshow_, (jboolean)slideshow_.Running(), slideshow_.Interval());
        Clear(env);
    }

    void Navigate(int dir) {
        slideshow_.OnShown();  // count the interval from the new file
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(bridge_, navigate_, dir);
        Clear(env);
    }

    // Panels hang off a yaw-only anchor at head height: list ahead, HUD below (tilted to the eyes),
    // toast above the list.
    void Place(const XrPosef& head) {
        XrPosef anchor{YawOnly(head.orientation), head.position};
        const float hudPitch = 30.0f * 3.14159265f / 180.0f;
        panels_[kList].pose = Compose(anchor, {{0, 0, 0, 1}, {0, 0, -1.4f}});
        panels_[kHud].pose = Compose(anchor, {AxisAngle({1, 0, 0}, -hudPitch),
                                              {0, -1.3f * std::sin(hudPitch), -1.3f * std::cos(hudPitch)}});
        panels_[kToast].pose = Compose(anchor, {{0, 0, 0, 1}, {0, 0.52f, -1.38f}});
    }

    // Ray -> panel pixel. bounded=false keeps projecting outside the quad (drag capture).
    bool Project(int i, XrVector3f o, XrVector3f d, bool bounded, float* px, float* py, float* dist = nullptr) {
        const Panel& p = panels_[i];
        XrVector3f n = Rotate(p.pose.orientation, {0, 0, 1});
        float denom = Dot(d, n);
        if (std::fabs(denom) < 1e-5f) return false;
        float t = Dot(Sub(p.pose.position, o), n) / denom;
        if (t <= 0) return false;
        XrVector3f hit = Add(o, Scale(d, t));
        XrVector3f local = Rotate(Conjugate(p.pose.orientation), Sub(hit, p.pose.position));
        float u = local.x / kDefs[i].wM + 0.5f;
        float v = 0.5f - local.y / kDefs[i].hM;
        if (bounded && (u < 0 || u > 1 || v < 0 || v > 1)) return false;
        *px = u * kDefs[i].wPx;
        *py = v * kDefs[i].hPx;
        if (dist) *dist = t;
        return true;
    }

    void Send(int panel, int hand, int type, float x, float y, float value) {
        JNIEnv* env = host_->Env();
        env->CallStaticVoidMethod(bridge_, pointer_, panel, hand, type, x, y, value);
        Clear(env);
    }

    void Leave(int h) {
        HandRay& r = rays_[h];
        if (r.capture >= 0) {
            Send(r.capture, h, kUp, r.x, r.y, 0);
            r.capture = -1;
        }
        if (r.hover >= 0) {
            Send(r.hover, h, kLeave, r.x, r.y, 0);
            r.hover = -1;
        }
    }

    void Touch(double t) {
        if (panels_[kHud].visible) lastInteraction_ = t;
    }

    Host* host_ = nullptr;
    bool ready_ = false;
    jclass bridge_ = nullptr;
    jmethodID attach_ = nullptr, pointer_ = nullptr, setVisible_ = nullptr, setHud_ = nullptr, showToast_ = nullptr,
              navigate_ = nullptr, setSlideshow_ = nullptr, hudShortcut_ = nullptr, attachRay_ = nullptr,
              captured_ = nullptr;
    bool capturing_ = false;  // [버튼 바꾸기] waits for a press: report it instead of running its action
    XrSwapchain raySwapchain_ = XR_NULL_HANDLE;
    jobject raySurface_ = nullptr;
    // Button table (Java ui.Bindings pushes it): "A.short" -> "list.toggle", ...
    std::map<std::string, std::string> bindings_ = {
        {"B.short", "ui.toggle"}, {"Y.short", "ui.toggle"}, {"B.long", "ui.move"}, {"Y.long", "ui.move"},
        {"A.short", "list.toggle"}, {"X.short", "nav.prev"}, {"X.long", "nav.next"}};
    struct Hold {
        double downAt = -1;
        bool longDone = false;
    };
    Hold holds_[5];  // A, B, X, Y, menu
    image::Slideshow slideshow_;
    Panel panels_[kPanelCount];
    HandRay rays_[2];
    XrPosef head_{{0, 0, 0, 1}, {0, 1.6f, 0}};
    double now_ = 0, lastInputTime_ = 0, lastInteraction_ = 0, lastHudPull_ = -1, toastUntil_ = 0;
    bool placeRequested_ = true, uiHidden_ = false, listOpen_ = true, hudVisible_ = false, hudPullNow_ = true;
    std::string viewerId_;
};

ModuleInfo Info() {
    ModuleInfo info;
    info.id = "ui";
    info.kind = ModuleKind::kOverlay;
    info.inputPriority = 100;
    info.create = [] { return std::make_unique<UiModule>(); };
    return info;
}

std::string ToString(JNIEnv* env, jstring s) {
    if (!s) return {};
    const char* c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

}  // namespace

// ---- ui_api.h
void Toast(const std::string& text, float seconds) {
    if (g_ui) g_ui->Toast(text, seconds);
}
void InvalidateHud() {
    if (g_ui) g_ui->InvalidateHud();
}
void SetHudVisible(bool visible) {
    if (g_ui) g_ui->SetHudVisible(visible);
}
bool HudVisible() { return g_ui && g_ui->HudVisible(); }
bool PanelOpen() { return g_ui && g_ui->PanelOpen(); }
void NotifyMediaEnded() {
    if (g_ui) g_ui->MediaEnded();
}

}  // namespace ui
}  // namespace qn

QN_REGISTER_MODULE(qn::ui::Info());

// ---- Java -> native (com.sharp.questnative.ui.UiBridge). Any thread; work runs on the render thread.
extern "C" JNIEXPORT void JNICALL Java_com_sharp_questnative_ui_UiBridge_nativeCommand(JNIEnv* env, jclass,
                                                                                      jstring cmd, jfloat value) {
    std::string c = qn::ui::ToString(env, cmd);
    float v = value;
    qn::PostIfRunning([c, v]() {
        if (qn::ui::g_ui) qn::ui::g_ui->Command(c, v);
    });
}

extern "C" JNIEXPORT void JNICALL Java_com_sharp_questnative_ui_UiBridge_nativeHudAction(JNIEnv* env, jclass,
                                                                                        jstring id, jfloat value,
                                                                                        jint phase) {
    std::string i = qn::ui::ToString(env, id);
    float v = value;
    int p = phase;
    qn::PostIfRunning([i, v, p]() {
        if (qn::ui::g_ui) qn::ui::g_ui->HudAction(i, v, p);
    });
}

extern "C" JNIEXPORT jboolean JNICALL Java_com_sharp_questnative_ui_UiBridge_nativeOpen(
    JNIEnv* env, jclass, jstring uri, jstring name, jstring mime, jstring sourceId, jint fd, jlong size) {
    qn::OpenRequest req;
    req.uri = qn::ui::ToString(env, uri);
    req.name = qn::ui::ToString(env, name);
    req.mimeType = qn::ui::ToString(env, mime);
    req.sourceId = qn::ui::ToString(env, sourceId);
    req.fd = fd;
    req.size = size;
    bool posted = qn::PostIfRunning([req]() {
        if (qn::ui::g_ui) {
            qn::ui::g_ui->OpenFromList(req);
        } else if (req.fd >= 0) {
            close(req.fd);
        }
    });
    return posted ? JNI_TRUE : JNI_FALSE;
}

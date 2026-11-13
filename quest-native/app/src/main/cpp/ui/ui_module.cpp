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
#include <string>

#include "core/qn_api.h"
#include "core/qn_log.h"
#include "core/xr_math.h"
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
    double secondaryDownAt = -1;
    bool secondaryLongDone = false;
};

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
        if (!attach_ || !pointer_ || !setVisible_ || !setHud_ || !showToast_) {
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
        ready_ = false;
    }

    bool OnInput(const InputState& in) override {
        if (!ready_) return false;
        double t = in.time * 1e-9;
        float dt = lastInputTime_ > 0 ? (float)(t - lastInputTime_) : 0.0f;
        lastInputTime_ = t;
        if (!in.focused) {
            for (int h = 0; h < 2; ++h) Leave(h);
            return false;
        }
        HandleButtons(in, t);

        bool consumed = false;
        for (int h = 0; h < 2; ++h) {
            const HandInput& hi = in.hand[h];
            HandRay& r = rays_[h];
            if (!hi.active || !hi.aimValid) {
                Leave(h);
                continue;
            }
            XrVector3f o = hi.aim.position;
            XrVector3f d = Rotate(hi.aim.orientation, {0, 0, -1});

            if (r.capture >= 0) {  // dragging: keep projecting onto the captured plane
                float x, y;
                if (Project(r.capture, o, d, false, &x, &y)) {
                    r.x = x;
                    r.y = y;
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
        } else {
            QN_LOGW("[ui] unknown command %s", cmd.c_str());
        }
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

    void HandleButtons(const InputState& in, double t) {
        // Default assignments (button remapping replaces this table in a later PR):
        // B/Y short = all UI on/off, B/Y long = move UI to where you look, A = list panel on/off.
        for (int h = 0; h < 2; ++h) {
            const Button& b = in.hand[h].secondary;
            HandRay& r = rays_[h];
            if (b.pressed) {
                r.secondaryDownAt = t;
                r.secondaryLongDone = false;
            }
            if (b.down && r.secondaryDownAt >= 0 && !r.secondaryLongDone && t - r.secondaryDownAt >= kLongPressS) {
                r.secondaryLongDone = true;
                uiHidden_ = false;
                Place(head_);
            }
            if (b.released) {
                if (!r.secondaryLongDone && r.secondaryDownAt >= 0) uiHidden_ = !uiHidden_;
                r.secondaryDownAt = -1;
            }
        }
        if (in.hand[kRight].primary.pressed) Command("list.toggle", 0);
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
    jmethodID attach_ = nullptr, pointer_ = nullptr, setVisible_ = nullptr, setHud_ = nullptr, showToast_ = nullptr;
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
void NotifyMediaEnded() { QN_LOGI("[ui] media ended (slideshow lands in a later PR)"); }

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

// Core app lifecycle, frame loop and module dispatch. Owner: foundation.
#include "core/app.h"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <deque>
#include <map>

#include <unistd.h>

#include "core/qn_log.h"
#include "core/registry.h"
#include "core/xr_util.h"

namespace qn {

uint32_t ShaderCheckWords();  // core/shader_check.cpp

namespace {

std::atomic<App*> g_app{nullptr};

enum class LayerType { kQuad, kCylinder, kEquirect2, kProjection };

struct StoredLayer {
    int order = 0;
    LayerType type = LayerType::kQuad;
    XrCompositionLayerQuad quad{XR_TYPE_COMPOSITION_LAYER_QUAD};
    XrCompositionLayerCylinderKHR cylinder{XR_TYPE_COMPOSITION_LAYER_CYLINDER_KHR};
    XrCompositionLayerEquirect2KHR equirect2{XR_TYPE_COMPOSITION_LAYER_EQUIRECT2_KHR};
    XrCompositionLayerProjection projection{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
    XrCompositionLayerProjectionView views[2] = {{XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW},
                                                 {XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW}};

    const XrCompositionLayerBaseHeader* Header() const {
        switch (type) {
            case LayerType::kQuad: return (const XrCompositionLayerBaseHeader*)&quad;
            case LayerType::kCylinder: return (const XrCompositionLayerBaseHeader*)&cylinder;
            case LayerType::kEquirect2: return (const XrCompositionLayerBaseHeader*)&equirect2;
            default: return (const XrCompositionLayerBaseHeader*)&projection;
        }
    }
};

// deque: element addresses stay valid while we push.
class FrameLayerSink final : public LayerSink {
public:
    std::deque<StoredLayer> layers;

    void AddQuad(int order, const XrCompositionLayerQuad& l) override {
        auto& s = Push(order, LayerType::kQuad);
        s.quad = l;
    }
    void AddCylinder(int order, const XrCompositionLayerCylinderKHR& l) override {
        auto& s = Push(order, LayerType::kCylinder);
        s.cylinder = l;
    }
    void AddEquirect2(int order, const XrCompositionLayerEquirect2KHR& l) override {
        auto& s = Push(order, LayerType::kEquirect2);
        s.equirect2 = l;
    }
    void AddProjection(int order, const XrCompositionLayerProjection& l) override {
        if (l.viewCount != 2 || !l.views) {
            QN_LOGE("[core] AddProjection needs 2 views, ignored");
            return;
        }
        auto& s = Push(order, LayerType::kProjection);
        s.projection = l;
        s.views[0] = l.views[0];
        s.views[1] = l.views[1];
        s.projection.views = s.views;
    }
    bool HasBackground() const {
        for (auto& l : layers) {
            if (l.order < kOrderProjection) return true;
        }
        return false;
    }

private:
    StoredLayer& Push(int order, LayerType type) {
        layers.emplace_back();
        auto& s = layers.back();
        s.order = order;
        s.type = type;
        return s;
    }
};

}  // namespace

Host& GetHost() { return *g_app.load(); }

App::App(android_app* android) : android_(android) { g_app.store(this); }

jobject App::Activity() { return android_->activity->clazz; }

jclass App::FindAppClass(const char* dottedName) {
    static std::map<std::string, jclass> cache;
    auto it = cache.find(dottedName);
    if (it != cache.end()) return it->second;
    JNIEnv* env = env_;
    jobject activity = Activity();
    jclass actCls = env->GetObjectClass(activity);
    jmethodID getCl = env->GetMethodID(actCls, "getClassLoader", "()Ljava/lang/ClassLoader;");
    jobject cl = env->CallObjectMethod(activity, getCl);
    jclass clCls = env->FindClass("java/lang/ClassLoader");
    jmethodID loadClass = env->GetMethodID(clCls, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;");
    jstring name = env->NewStringUTF(dottedName);
    auto cls = (jclass)env->CallObjectMethod(cl, loadClass, name);
    env->DeleteLocalRef(name);
    env->DeleteLocalRef(clCls);
    env->DeleteLocalRef(cl);
    env->DeleteLocalRef(actCls);
    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        QN_LOGE("[core] class not found: %s", dottedName);
        return nullptr;
    }
    auto global = (jclass)env->NewGlobalRef(cls);
    env->DeleteLocalRef(cls);
    cache[dottedName] = global;
    return global;
}

void App::PostToRenderThread(std::function<void()> fn) {
    std::lock_guard<std::mutex> lock(postMutex_);
    posted_.push_back(std::move(fn));
}

void App::RunPosted() {
    std::deque<std::function<void()>> work;
    {
        std::lock_guard<std::mutex> lock(postMutex_);
        work.swap(posted_);
    }
    for (auto& fn : work) fn();
}

bool App::OpenMedia(const OpenRequest& request, std::string* error) {
    std::vector<ModuleInfo> infos;
    for (auto& s : modules_) infos.push_back(*s.info);
    int idx = FindViewerIndex(infos, request);
    if (idx < 0) {
        if (request.fd >= 0) close(request.fd);  // fd ownership: see Host::OpenMedia
        if (error) *error = "no viewer for " + (request.name.empty() ? request.uri : request.name);
        QN_LOGW("[core] %s", error ? error->c_str() : "no viewer");
        return false;
    }
    // Same viewer again (next photo, next video): no Close, the viewer replaces its content and may
    // keep showing the previous one until the new one is ready (docs/module-contract.md 8).
    bool replacing = idx == activeViewer_;
    if (!replacing) CloseMedia();
    auto* viewer = static_cast<Viewer*>(modules_[idx].module.get());
    std::string err;
    if (!viewer->Open(request, &err)) {
        if (request.fd >= 0) close(request.fd);
        QN_LOGW("[core] %s could not open %s: %s", modules_[idx].info->id, request.name.c_str(), err.c_str());
        if (replacing) CloseMedia();
        if (error) *error = err;
        return false;
    }
    activeViewer_ = idx;
    if (!replacing) viewer->OnFocus(visible_, focused_);
    QN_LOGI("[core] opened %s with %s", request.name.c_str(), modules_[idx].info->id);
    return true;
}

void App::CloseMedia() {
    if (activeViewer_ < 0) return;
    static_cast<Viewer*>(modules_[activeViewer_].module.get())->Close();
    activeViewer_ = -1;
}

Viewer* App::ActiveViewer() {
    return activeViewer_ < 0 ? nullptr : static_cast<Viewer*>(modules_[activeViewer_].module.get());
}

Module* App::FindModule(const char* id) {
    for (auto& s : modules_) {
        if (!strcmp(s.info->id, id)) return s.module.get();
    }
    return nullptr;
}

std::vector<Module*> App::ActiveModules() {
    std::vector<Module*> out;
    for (size_t i = 0; i < modules_.size(); ++i) {
        if (modules_[i].info->kind == ModuleKind::kOverlay || (int)i == activeViewer_) {
            out.push_back(modules_[i].module.get());
        }
    }
    return out;
}

std::vector<Module*> App::ActiveModulesByInputPriority() {
    std::vector<std::pair<int, Module*>> v;
    for (size_t i = 0; i < modules_.size(); ++i) {
        if (modules_[i].info->kind == ModuleKind::kOverlay || (int)i == activeViewer_) {
            v.push_back({modules_[i].info->inputPriority, modules_[i].module.get()});
        }
    }
    std::stable_sort(v.begin(), v.end(), [](auto& a, auto& b) { return a.first > b.first; });
    std::vector<Module*> out;
    for (auto& p : v) out.push_back(p.second);
    return out;
}

bool App::Init() {
    android_->activity->vm->AttachCurrentThread(&env_, nullptr);
    std::string ids;
    for (auto& m : RegisteredModules()) {
        ids += m.id;
        ids += ' ';
    }
    QN_LOGI("[core] registered modules: %s(shader check %u words)", ids.c_str(), ShaderCheckWords());

    if (!(InitLoader() && CreateInstance() && CreateVulkan() && CreateSession() && CreateSpaces() &&
          CreateFrameResources() && CreateProjectionSwapchain() && CreateActions())) {
        return false;
    }
    if (passthroughSupported_) InitPassthrough();
    for (auto& info : RegisteredModules()) {
        ModuleSlot slot;
        slot.info = &info;
        slot.module = info.create ? info.create() : nullptr;
        if (!slot.module) {
            QN_LOGE("[core] module %s has no factory", info.id);
            continue;
        }
        modules_.push_back(std::move(slot));
    }
    for (auto& s : modules_) s.module->OnStart(*this);
    QN_LOGI("[core] init done, %zu modules started", modules_.size());
    return true;
}

void App::Shutdown() {
    if (gpu_.device) vkDeviceWaitIdle(gpu_.device);
    CloseMedia();
    for (auto it = modules_.rbegin(); it != modules_.rend(); ++it) it->module->OnStop();
    modules_.clear();
    if (foveationProfile_) {
        PFN_xrDestroyFoveationProfileFB destroy = nullptr;
        if (XR_SUCCEEDED(XR_PROC(xr_.instance, "xrDestroyFoveationProfileFB", destroy))) destroy(foveationProfile_);
        foveationProfile_ = XR_NULL_HANDLE;
    }
    DestroyPassthrough();
    DestroyActions();
    DestroyProjectionSwapchain();
    if (xr_.viewSpace) xrDestroySpace(xr_.viewSpace);
    if (xr_.appSpace) xrDestroySpace(xr_.appSpace);
    if (xr_.session) xrDestroySession(xr_.session);
    DestroyVulkan();
    if (xr_.instance) xrDestroyInstance(xr_.instance);
    xr_ = XrContext{};
}

void App::HandleSessionState(XrSessionState s) {
    state_ = s;
    QN_LOGI("[core] session state -> %d", (int)s);
    bool wasVisible = visible_, wasFocused = focused_;
    switch (s) {
        case XR_SESSION_STATE_READY: {
            XrSessionBeginInfo bi{XR_TYPE_SESSION_BEGIN_INFO};
            bi.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
            if (XR_SUCCEEDED(xrBeginSession(xr_.session, &bi))) {
                sessionRunning_ = true;
                if (passthroughEnabled_ && !passthroughRunning_) ApplyPassthroughState();
            }
            break;
        }
        case XR_SESSION_STATE_STOPPING:
            if (passthroughRunning_) {
                if (passthroughLayer_ && pfnPassthroughLayerPause_) pfnPassthroughLayerPause_(passthroughLayer_);
                if (passthrough_ && pfnPassthroughPause_) pfnPassthroughPause_(passthrough_);
                passthroughRunning_ = false;
            }
            xrEndSession(xr_.session);
            sessionRunning_ = false;
            break;
        case XR_SESSION_STATE_EXITING:
        case XR_SESSION_STATE_LOSS_PENDING:
            quit_ = true;
            break;
        default:
            break;
    }
    visible_ = s == XR_SESSION_STATE_VISIBLE || s == XR_SESSION_STATE_FOCUSED;
    focused_ = s == XR_SESSION_STATE_FOCUSED;
    if (visible_ != wasVisible || focused_ != wasFocused) {
        for (auto* m : ActiveModules()) m->OnFocus(visible_, focused_);
    }
}

void App::PollEvents() {
    XrEventDataBuffer ev{XR_TYPE_EVENT_DATA_BUFFER};
    while (xrPollEvent(xr_.instance, &ev) == XR_SUCCESS) {
        switch (ev.type) {
            case XR_TYPE_EVENT_DATA_SESSION_STATE_CHANGED:
                HandleSessionState(((XrEventDataSessionStateChanged*)&ev)->state);
                break;
            case XR_TYPE_EVENT_DATA_INSTANCE_LOSS_PENDING:
                quit_ = true;
                break;
            case XR_TYPE_EVENT_DATA_DISPLAY_REFRESH_RATE_CHANGED_FB: {
                auto* e = (XrEventDataDisplayRefreshRateChangedFB*)&ev;
                QN_LOGI("[core] refresh rate %.0f -> %.0f Hz", e->fromDisplayRefreshRate, e->toDisplayRefreshRate);
                break;
            }
            case XR_TYPE_EVENT_DATA_PASSTHROUGH_STATE_CHANGED_FB: {
                auto* e = (XrEventDataPassthroughStateChangedFB*)&ev;
                QN_LOGI("[core] passthrough state changed flags=0x%llx", (unsigned long long)e->flags);
                if (e->flags & XR_PASSTHROUGH_STATE_CHANGED_NON_RECOVERABLE_ERROR_BIT_FB) {
                    QN_LOGE("[core] passthrough non-recoverable error, disabling");
                    DestroyPassthrough();
                    passthroughSupported_ = false;
                    passthroughEnabled_ = false;
                } else if (e->flags & XR_PASSTHROUGH_STATE_CHANGED_REINIT_REQUIRED_BIT_FB) {
                    DestroyPassthrough();
                    if (InitPassthrough() && sessionRunning_ && passthroughEnabled_) ApplyPassthroughState();
                }
                break;
            }
            default:
                break;
        }
        ev = {XR_TYPE_EVENT_DATA_BUFFER};
    }
}

void App::Frame() {
    if (pendingScale_ > 0.0f) {
        resolutionScale_ = pendingScale_;
        pendingScale_ = 0.0f;
        DestroyProjectionSwapchain();
        if (!CreateProjectionSwapchain()) {
            quit_ = true;
            return;
        }
    }

    XrFrameState fs{XR_TYPE_FRAME_STATE};
    if (XR_FAILED(xrWaitFrame(xr_.session, nullptr, &fs))) return;
    if (XR_FAILED(xrBeginFrame(xr_.session, nullptr))) return;

    FrameInfo frame;
    frame.predictedDisplayTime = fs.predictedDisplayTime;
    frame.predictedDisplayPeriod = fs.predictedDisplayPeriod;
    frame.deltaSeconds = lastDisplayTime_ ? (fs.predictedDisplayTime - lastDisplayTime_) * 1e-9 : 0.0;
    lastDisplayTime_ = fs.predictedDisplayTime;
    frame.frameSlot = frameSlot_;
    frame.frameSlotCount = kFrameSlots;
    frame.shouldRender = fs.shouldRender == XR_TRUE;

    XrView views[2] = {{XR_TYPE_VIEW}, {XR_TYPE_VIEW}};
    XrViewLocateInfo li{XR_TYPE_VIEW_LOCATE_INFO};
    li.viewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
    li.displayTime = fs.predictedDisplayTime;
    li.space = xr_.appSpace;
    XrViewState vs{XR_TYPE_VIEW_STATE};
    uint32_t vc = 0;
    xrLocateViews(xr_.session, &li, &vs, 2, &vc, views);
    for (int e = 0; e < 2; ++e) {
        frame.eyes[e].pose = views[e].pose;
        frame.eyes[e].fov = views[e].fov;
    }
    XrSpaceLocation head{XR_TYPE_SPACE_LOCATION};
    if (XR_SUCCEEDED(xrLocateSpace(xr_.viewSpace, xr_.appSpace, fs.predictedDisplayTime, &head))) {
        frame.head = head.pose;
        frame.headValid = (head.locationFlags & XR_SPACE_LOCATION_ORIENTATION_VALID_BIT) != 0;
    }

    SyncInput(fs.predictedDisplayTime, lastInput_);
    for (auto* m : ActiveModulesByInputPriority()) {
        if (m->OnInput(lastInput_)) break;
    }
    for (auto* m : ActiveModules()) m->Update(frame);

    std::vector<const XrCompositionLayerBaseHeader*> submit;
    FrameLayerSink sink;
    XrCompositionLayerPassthroughFB passthroughComp{XR_TYPE_COMPOSITION_LAYER_PASSTHROUGH_FB};
    XrCompositionLayerProjection proj{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
    XrCompositionLayerProjectionView projViews[2] = {{XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW},
                                                     {XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW}};

    if (frame.shouldRender) {
        auto active = ActiveModules();
        for (auto* m : active) m->SubmitLayers(frame, sink);
        bool passthroughActive = passthroughEnabled_ && passthroughRunning_ && passthroughLayer_ != XR_NULL_HANDLE;
        bool transparent = sink.HasBackground() || passthroughActive;

        uint32_t slot = frameSlot_;
        vkWaitForFences(gpu_.device, 1, &fence_[slot], VK_TRUE, UINT64_MAX);  // slot reuse guarantee
        vkResetFences(gpu_.device, 1, &fence_[slot]);

        uint32_t imageIndex = 0;
        xrAcquireSwapchainImage(proj_.handle, nullptr, &imageIndex);
        XrSwapchainImageWaitInfo wi{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
        wi.timeout = XR_INFINITE_DURATION;
        xrWaitSwapchainImage(proj_.handle, &wi);

        VkCommandBuffer cmd = cmd_[slot];
        vkResetCommandBuffer(cmd, 0);
        VkCommandBufferBeginInfo bi{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
        bi.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        vkBeginCommandBuffer(cmd, &bi);
        RecordClear(cmd, imageIndex, transparent);

        ProjectionPass pass;
        pass.cmd = cmd;
        pass.frameSlot = slot;
        pass.predictedDisplayTime = fs.predictedDisplayTime;
        for (uint32_t e = 0; e < 2; ++e) {
            EyeTarget& t = pass.eyes[e];
            t.image = proj_.images[imageIndex];
            t.arrayLayer = e;
            t.view = proj_.views[imageIndex * 2 + e];
            t.format = proj_.format;
            t.extent = proj_.extent;
            t.pose = views[e].pose;
            t.fov = views[e].fov;
            t.fdmImage = proj_.fdmImages[imageIndex];
            t.fdmExtent = proj_.fdmExtents[imageIndex];
        }
        for (auto* m : active) m->RenderProjection(pass);
        vkEndCommandBuffer(cmd);

        VkSubmitInfo si{VK_STRUCTURE_TYPE_SUBMIT_INFO};
        si.commandBufferCount = 1;
        si.pCommandBuffers = &cmd;
        vkQueueSubmit(gpu_.queue, 1, &si, fence_[slot]);
        xrReleaseSwapchainImage(proj_.handle, nullptr);

        for (uint32_t e = 0; e < 2; ++e) {
            projViews[e].pose = views[e].pose;
            projViews[e].fov = views[e].fov;
            projViews[e].subImage.swapchain = proj_.handle;
            projViews[e].subImage.imageRect = {{0, 0}, {(int32_t)proj_.extent.width, (int32_t)proj_.extent.height}};
            projViews[e].subImage.imageArrayIndex = e;
        }
        proj.space = xr_.appSpace;
        proj.viewCount = 2;
        proj.views = projViews;
        if (transparent) proj.layerFlags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;

        if (passthroughActive) {
            passthroughComp.flags = XR_COMPOSITION_LAYER_BLEND_TEXTURE_SOURCE_ALPHA_BIT;
            passthroughComp.space = XR_NULL_HANDLE;
            passthroughComp.layerHandle = passthroughLayer_;
            submit.push_back((const XrCompositionLayerBaseHeader*)&passthroughComp);
        }
        // Stable sort by order; core projection sits at kOrderProjection before module layers of equal order.
        std::vector<std::pair<int, const XrCompositionLayerBaseHeader*>> ordered;
        ordered.push_back({kOrderProjection, (const XrCompositionLayerBaseHeader*)&proj});
        for (auto& l : sink.layers) ordered.push_back({l.order, l.Header()});
        std::stable_sort(ordered.begin(), ordered.end(), [](auto& a, auto& b) { return a.first < b.first; });
        for (auto& o : ordered) submit.push_back(o.second);
        frameSlot_ = (frameSlot_ + 1) % kFrameSlots;
    }

    XrFrameEndInfo fe{XR_TYPE_FRAME_END_INFO};
    fe.displayTime = fs.predictedDisplayTime;
    fe.environmentBlendMode = XR_ENVIRONMENT_BLEND_MODE_OPAQUE;
    fe.layerCount = (uint32_t)submit.size();
    fe.layers = submit.data();
    xrEndFrame(xr_.session, &fe);
}

static void OnAppCmd(android_app* a, int32_t cmd) {
    auto* resumed = (bool*)a->userData;
    if (cmd == APP_CMD_RESUME) *resumed = true;
    if (cmd == APP_CMD_PAUSE) *resumed = false;
}

void App::Run() {
    android_->userData = &resumed_;
    android_->onAppCmd = OnAppCmd;
    bool ok = Init();
    if (!ok) QN_LOGE("[core] init failed; see the log lines above");

    while (!android_->destroyRequested && !quit_) {
        int events = 0;
        android_poll_source* src = nullptr;
        int timeout = (!ok || (!resumed_ && !sessionRunning_)) ? -1 : 0;
        while (ALooper_pollOnce(timeout, nullptr, &events, (void**)&src) >= 0) {
            if (src) src->process(android_, src);
            if (android_->destroyRequested) break;
            timeout = (!resumed_ && !sessionRunning_) ? -1 : 0;
        }
        if (!ok) continue;
        RunPosted();
        PollEvents();
        if (sessionRunning_) Frame();
    }

    if (xr_.instance) Shutdown();
    g_app.store(nullptr);
    android_->activity->vm->DetachCurrentThread();
    if (!android_->destroyRequested) ANativeActivity_finish(android_->activity);
}

}  // namespace qn

// Java -> native entry used by core/jni_bridge.cpp.
namespace qn {
bool PostIfRunning(std::function<void()> fn) {
    App* app = g_app.load();
    if (!app) return false;
    app->PostToRenderThread(std::move(fn));
    return true;
}
}  // namespace qn

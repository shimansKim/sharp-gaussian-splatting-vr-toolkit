// Core app: OpenXR instance/session, Vulkan via XR_KHR_vulkan_enable2, frame loop, input,
// module dispatch. Core-internal; modules only see qn_api.h. Owner: foundation.
#pragma once

#include <android_native_app_glue.h>

#include <deque>
#include <mutex>

#include "core/qn_api.h"

namespace qn {

// Frames in flight. A slot is reused only after its fence signalled (pocketsplat assumes 2).
constexpr uint32_t kFrameSlots = 2;

struct ProjectionSwapchain {
    XrSwapchain handle = XR_NULL_HANDLE;
    VkFormat format = VK_FORMAT_UNDEFINED;
    VkExtent2D extent{0, 0};
    std::vector<VkImage> images;
    std::vector<VkImageView> views;  // images.size() * 2 (layer 0, layer 1)
    std::vector<VkImage> fdmImages;  // XR_FB_foveation_vulkan, may be empty
    std::vector<VkExtent2D> fdmExtents;
    bool foveationCapable = false;
};

struct ActionHandles {
    XrActionSet set = XR_NULL_HANDLE;
    XrAction aim = XR_NULL_HANDLE, grip = XR_NULL_HANDLE;
    XrAction trigger = XR_NULL_HANDLE, squeeze = XR_NULL_HANDLE, stick = XR_NULL_HANDLE;
    XrAction stickClick = XR_NULL_HANDLE, primary = XR_NULL_HANDLE, secondary = XR_NULL_HANDLE;
    XrAction menu = XR_NULL_HANDLE, haptic = XR_NULL_HANDLE;
    XrPath handPath[2] = {XR_NULL_PATH, XR_NULL_PATH};
    XrSpace aimSpace[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE};
    XrSpace gripSpace[2] = {XR_NULL_HANDLE, XR_NULL_HANDLE};
};

struct ModuleSlot {
    const ModuleInfo* info = nullptr;
    std::unique_ptr<Module> module;
};

class App final : public Host {
public:
    explicit App(android_app* android);
    void Run();  // blocks until the activity is destroyed

    // Host
    const GpuContext& Gpu() const override { return gpu_; }
    const XrContext& Xr() const override { return xr_; }
    JNIEnv* Env() override { return env_; }
    jobject Activity() override;
    jclass FindAppClass(const char* dottedName) override;
    void PostToRenderThread(std::function<void()> fn) override;
    bool OpenMedia(const OpenRequest& request, std::string* error) override;
    void CloseMedia() override;
    Viewer* ActiveViewer() override;
    Module* FindModule(const char* id) override;
    void Haptic(Hand hand, float amplitude, float seconds) override;
    bool SetResolutionScale(float scale) override;
    float ResolutionScale() const override { return resolutionScale_; }
    bool SetFoveationLevel(FoveationLevel level) override;
    bool SetRefreshRate(float hz) override;
    std::vector<float> SupportedRefreshRates() override;
    bool CreateSurfaceSwapchain(const XrSwapchainCreateInfo& info, XrSwapchain* swapchain,
                                jobject* surface) override;

private:
    // app.cpp
    bool Init();
    void Shutdown();
    void PollEvents();
    void HandleSessionState(XrSessionState state);
    void RunPosted();
    void Frame();
    std::vector<Module*> ActiveModulesByInputPriority();
    std::vector<Module*> ActiveModules();
    // xr_setup.cpp
    bool InitLoader();
    bool CreateInstance();
    bool CreateSession();
    bool CreateSpaces();
    // gpu.cpp
    bool CreateVulkan();
    bool CreateFrameResources();
    void DestroyVulkan();
    bool CreateProjectionSwapchain();
    void DestroyProjectionSwapchain();
    void RecordClear(VkCommandBuffer cmd, uint32_t imageIndex, bool transparent);
    // input.cpp
    bool CreateActions();
    void SyncInput(XrTime time, InputState& out);
    void DestroyActions();

    android_app* android_;
    JNIEnv* env_ = nullptr;
    GpuContext gpu_;
    XrContext xr_;
    DeviceFeatures enabledFeatures_;

    std::vector<ModuleSlot> modules_;
    int activeViewer_ = -1;  // index into modules_

    std::mutex postMutex_;
    std::deque<std::function<void()>> posted_;

    // session
    bool resumed_ = false;
    bool sessionRunning_ = false;
    bool visible_ = false;
    bool focused_ = false;
    bool quit_ = false;
    XrSessionState state_ = XR_SESSION_STATE_UNKNOWN;
    XrTime lastDisplayTime_ = 0;

    // projection
    std::vector<XrViewConfigurationView> viewConfigs_;
    ProjectionSwapchain proj_;
    float resolutionScale_ = 1.0f;
    float pendingScale_ = 0.0f;  // applied between frames
    XrFoveationProfileFB foveationProfile_ = XR_NULL_HANDLE;
    FoveationLevel foveation_ = FoveationLevel::kOff;

    // frame slots
    VkCommandPool cmdPool_[kFrameSlots] = {};
    VkCommandBuffer cmd_[kFrameSlots] = {};
    VkFence fence_[kFrameSlots] = {};
    uint32_t frameSlot_ = 0;

    ActionHandles actions_;
    InputState lastInput_;
};

}  // namespace qn

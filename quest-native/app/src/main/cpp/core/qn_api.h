// quest-native module contract (C++ side). Owner: foundation.
// Read docs/module-contract.md first. Changing anything in this file affects every module:
// ask the commander before you edit it.
#pragma once

#ifndef XR_USE_PLATFORM_ANDROID
#define XR_USE_PLATFORM_ANDROID
#endif
#ifndef XR_USE_GRAPHICS_API_VULKAN
#define XR_USE_GRAPHICS_API_VULKAN
#endif

#include <jni.h>
#include <vulkan/vulkan.h>
#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "core/qn_hud.h"

namespace qn {

// ------------------------------------------------------------------ handles

// Vulkan objects created by core. Modules never destroy them.
// Load function pointers yourself (volk: volkLoadInstanceOnly(instance) + volkLoadDevice(device)),
// or use getInstanceProcAddr. Only core-owned threads may touch `queue` (render thread).
struct GpuContext {
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    uint32_t queueFamilyIndex = 0;  // supports graphics + compute
    VkQueue queue = VK_NULL_HANDLE;
    uint32_t instanceApiVersion = 0;  // what core asked for (VK_API_VERSION_1_3)
    uint32_t deviceApiVersion = 0;    // VkPhysicalDeviceProperties::apiVersion
    PFN_vkGetInstanceProcAddr getInstanceProcAddr = nullptr;
    std::vector<std::string> enabledDeviceExtensions;
};

struct XrContext {
    XrInstance instance = XR_NULL_HANDLE;
    XrSystemId systemId = XR_NULL_SYSTEM_ID;
    XrSession session = XR_NULL_HANDLE;
    XrSpace appSpace = XR_NULL_HANDLE;   // LOCAL_FLOOR when available, else LOCAL. All poses are in this space.
    XrSpace viewSpace = XR_NULL_HANDLE;  // head
    std::vector<std::string> enabledExtensions;
    bool HasExtension(const char* name) const;
};

// ------------------------------------------------------------------ device features hook

// Core fills `supported` from vkGetPhysicalDeviceFeatures2 before creating the device.
// v11/v12 are valid only when deviceApiVersion >= 1.2, v13 only when >= 1.3 (check the flags).
// A module's fillDeviceFeatures sets VkBool32 fields in `requested`. Core ANDs requested with
// supported, so asking for something unsupported never fails device creation (it is logged).
// To request feature structs core does not know, append them to requested.extraPNext
// (memory owned by the module, alive until OnStart).
struct DeviceFeatures {
    uint32_t apiVersion = 0;
    bool hasV11 = false, hasV12 = false, hasV13 = false;
    VkPhysicalDeviceFeatures2 core{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_FEATURES_2};
    VkPhysicalDeviceVulkan11Features v11{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_1_FEATURES};
    VkPhysicalDeviceVulkan12Features v12{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES};
    VkPhysicalDeviceVulkan13Features v13{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_3_FEATURES};
    void* extraPNext = nullptr;
};

// ------------------------------------------------------------------ input

enum Hand : int { kLeft = 0, kRight = 1 };

struct Button {
    bool down = false;      // held now
    bool pressed = false;   // went down this frame
    bool released = false;  // went up this frame
};

struct HandInput {
    bool active = false;  // controller connected and tracked
    XrPosef aim{{0, 0, 0, 1}, {0, 0, 0}};
    XrPosef grip{{0, 0, 0, 1}, {0, 0, 0}};
    bool aimValid = false, gripValid = false;
    float trigger = 0, squeeze = 0;  // 0..1
    XrVector2f stick{0, 0};          // -1..1, +y = up
    Button triggerButton;  // trigger > 0.55 (release < 0.45)
    Button squeezeButton;  // squeeze > 0.55 (release < 0.45)
    Button stickClick;
    Button primary;    // A (right) / X (left)
    Button secondary;  // B (right) / Y (left)
    Button menu;       // left hand only (the system button is not available to apps)
};

struct InputState {
    XrTime time = 0;
    bool focused = false;  // false: no input this frame (all zero)
    HandInput hand[2];
};

// ------------------------------------------------------------------ frame

struct EyeView {
    XrPosef pose{{0, 0, 0, 1}, {0, 0, 0}};  // in appSpace
    XrFovf fov{};
};

struct FrameInfo {
    XrTime predictedDisplayTime = 0;
    XrDuration predictedDisplayPeriod = 0;
    double deltaSeconds = 0;
    // 0..frameSlotCount-1, for per-frame GPU resources. Core waits for the GPU work submitted with
    // this slot two frames ago before handing the slot out again, so slot resources are free to reuse.
    uint32_t frameSlot = 0;
    uint32_t frameSlotCount = 0;  // frames in flight (2)
    bool shouldRender = false;    // false: Render/SubmitLayers are not called this frame
    XrPosef head{{0, 0, 0, 1}, {0, 0, 0}};
    bool headValid = false;
    EyeView eyes[2];
};

// One eye of the core projection swapchain (one swapchain, arraySize 2: layer 0 = left, 1 = right).
struct EyeTarget {
    VkImage image = VK_NULL_HANDLE;
    uint32_t arrayLayer = 0;
    VkImageView view = VK_NULL_HANDLE;  // 2D view of arrayLayer, format `format`
    VkFormat format = VK_FORMAT_R8G8B8A8_SRGB;  // image is MUTABLE_FORMAT: UNORM views are allowed
    VkExtent2D extent{0, 0};  // render area; equals the projection imageRect
    XrPosef pose{{0, 0, 0, 1}, {0, 0, 0}};
    XrFovf fov{};
    // Foveation density map for this eye (XR_FB_foveation_vulkan), VK_NULL_HANDLE when off.
    VkImage fdmImage = VK_NULL_HANDLE;
    VkExtent2D fdmExtent{0, 0};
};

// Layout promise: on entry both eye layers are VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL, already
// cleared (alpha 0 when a Background layer exists, else 1). cmd is recording, outside any render
// pass. The viewer records its own passes (vkCmdBeginRendering etc.) and must leave both layers in
// COLOR_ATTACHMENT_OPTIMAL. Core submits cmd on `queue` after all modules ran.
struct ProjectionPass {
    VkCommandBuffer cmd = VK_NULL_HANDLE;
    uint32_t frameSlot = 0;
    XrTime predictedDisplayTime = 0;
    EyeTarget eyes[2];
};

// ------------------------------------------------------------------ layers

// Smaller order is drawn first (further back). Core's projection layer is order 0.
enum LayerOrder : int {
    kOrderBackground = -100,  // e.g. 360/180 video equirect2 behind the 3D scene
    kOrderProjection = 0,
    kOrderContent = 100,      // e.g. 2D/3D video screen quad
    kOrderUi = 200,           // panels, HUD
    kOrderOverlay = 300,      // toasts, diagnostics
};

// Core copies the structs. Swapchains, spaces and any `next` chain must stay valid until the
// next SubmitLayers call of the same module.
class LayerSink {
public:
    virtual ~LayerSink() = default;
    virtual void AddQuad(int order, const XrCompositionLayerQuad& layer) = 0;
    virtual void AddCylinder(int order, const XrCompositionLayerCylinderKHR& layer) = 0;
    virtual void AddEquirect2(int order, const XrCompositionLayerEquirect2KHR& layer) = 0;
    // A module-owned projection layer (needs exactly 2 views). Core copies the views.
    virtual void AddProjection(int order, const XrCompositionLayerProjection& layer) = 0;
};

// ------------------------------------------------------------------ media

struct OpenRequest {
    std::string uri;         // content://, file:// or http(s)://
    std::string name;        // display name with extension, e.g. "frame_0001.ply"
    std::string mimeType;    // may be empty
    std::string sourceId;    // "device", "pc", "gdrive", ...
    std::string layoutHint;  // optional, e.g. "sbs180" (same names as quest-app MediaLayout)
    int fd = -1;             // optional open file descriptor; the viewer takes ownership
    int64_t size = -1;
};

// ------------------------------------------------------------------ modules

class Host;

// Every hook runs on the render thread. Hooks of inactive viewers are not called.
class Module {
public:
    virtual ~Module() = default;
    virtual void OnStart(Host& host) { (void)host; }  // GPU and session exist
    virtual void OnStop() {}                           // before GPU/session are destroyed
    virtual void OnFocus(bool visible, bool focused) { (void)visible; (void)focused; }
    virtual void OnPassthroughChanged(bool supported, bool enabled, bool failed) {
        (void)supported;
        (void)enabled;
        (void)failed;
    }
    // Return true to consume this frame's input (lower inputPriority modules then get none).
    virtual bool OnInput(const InputState& input) { (void)input; return false; }
    virtual void Update(const FrameInfo& frame) { (void)frame; }
    virtual void RenderProjection(const ProjectionPass& pass) { (void)pass; }
    virtual void SubmitLayers(const FrameInfo& frame, LayerSink& sink) { (void)frame; (void)sink; }
};

// A viewer is a module that opens one file at a time. Only the active viewer gets frame hooks.
class Viewer : public Module {
public:
    // May be called while a file is already open (same viewer, next file): replace the content.
    // Returning false then makes core Close the viewer.
    virtual bool Open(const OpenRequest& request, std::string* error) = 0;
    virtual void Close() = 0;

    // HUD (docs/module-contract.md 14). Override with exactly this signature and `override`; do not
    // add other overloads named DescribeHud/OnHudAction (-Woverloaded-virtual would hide them).
    // The ui module pulls the model at most 10 times a second
    // while the HUD is visible (and right after an action) and draws it. Return false = no HUD.
    // A viewer whose HUD lives on the Java side registers a Java HudProvider instead.
    virtual bool DescribeHud(hud::Model& out) { (void)out; return false; }
    virtual void OnHudAction(const std::string& id, float value, hud::Phase phase) {
        (void)id; (void)value; (void)phase;
    }
};

enum class ModuleKind { kViewer, kOverlay };

struct ModuleInfo {
    const char* id = "";  // "splat", "video", "image", "ui", "source"
    ModuleKind kind = ModuleKind::kOverlay;
    int inputPriority = 0;  // higher gets input first; ui = 100, viewers = 0
    std::vector<std::string> fileExtensions;  // viewers: lowercase with dot, e.g. ".ply"
    std::vector<std::string> mimePrefixes;    // viewers: e.g. "video/"
    std::vector<std::string> optionalXrExtensions;   // enabled when the runtime has them
    std::vector<std::string> optionalDeviceExtensions;  // enabled when the device has them
    void (*fillDeviceFeatures)(VkPhysicalDevice, const DeviceFeatures& supported,
                               DeviceFeatures& requested) = nullptr;
    std::function<std::unique_ptr<Module>()> create;  // Viewer subclasses for kViewer
};

// Use through QN_REGISTER_MODULE at namespace scope in the module's own .cpp.
bool RegisterModule(ModuleInfo info);

#define QN_CONCAT_INNER(a, b) a##b
#define QN_CONCAT(a, b) QN_CONCAT_INNER(a, b)
#define QN_REGISTER_MODULE(makeInfo) \
    static const bool QN_CONCAT(qn_registered_, __LINE__) = ::qn::RegisterModule(makeInfo)

// ------------------------------------------------------------------ host services

enum class FoveationLevel { kOff = 0, kLow = 1, kMedium = 2, kHigh = 3 };

// Given to modules in OnStart; also reachable through qn::GetHost().
// All calls are render-thread only, except PostToRenderThread.
class Host {
public:
    virtual ~Host() = default;
    virtual const GpuContext& Gpu() const = 0;
    virtual const XrContext& Xr() const = 0;

    // JNI. Env() is attached to the render thread. FindAppClass uses the app ClassLoader
    // (FindClass on the native thread only sees system classes). Returns a global ref.
    virtual JNIEnv* Env() = 0;
    virtual jobject Activity() = 0;
    virtual jclass FindAppClass(const char* dottedName) = 0;

    // Thread-safe. Runs fn on the render thread before the next frame's hooks.
    virtual void PostToRenderThread(std::function<void()> fn) = 0;

    // Media. Picks the viewer by file extension (then MIME prefix). A different viewer: the previous
    // one is closed first. The same viewer: Open is called again without Close (replace content).
    // request.fd: the viewer owns it only when Open returns true. When no viewer matches or Open
    // returns false, core closes it (so a viewer must not close the fd before returning false).
    virtual bool OpenMedia(const OpenRequest& request, std::string* error) = 0;
    virtual void CloseMedia() = 0;
    virtual Viewer* ActiveViewer() = 0;
    virtual Module* FindModule(const char* id) = 0;

    // Output.
    virtual void Haptic(Hand hand, float amplitude, float seconds) = 0;

    // Render settings. Each returns false (and logs) when the runtime lacks the extension.
    virtual bool SetResolutionScale(float scale) = 0;  // 0.6..1.2 of recommended, rebuilds swapchain
    virtual float ResolutionScale() const = 0;
    virtual bool SetFoveationLevel(FoveationLevel level) = 0;  // XR_FB_foveation(+_vulkan)
    virtual bool SetRefreshRate(float hz) = 0;                 // XR_FB_display_refresh_rate
    virtual std::vector<float> SupportedRefreshRates() = 0;
    virtual bool PassthroughSupported() const = 0;
    virtual bool PassthroughEnabled() const = 0;
    virtual bool SetPassthrough(bool enabled) = 0;             // XR_FB_passthrough

    // Android Surface swapchain (XR_KHR_android_surface_swapchain) for video/UI layers.
    // *surface is a JNI global ref owned by the caller. Returns false when unsupported.
    virtual bool CreateSurfaceSwapchain(const XrSwapchainCreateInfo& info, XrSwapchain* swapchain,
                                        jobject* surface) = 0;
};

// Render thread only, while the app runs (after OnStart, before OnStop).
Host& GetHost();

// Any thread, any time: queues fn for the render thread. Returns false (fn dropped) before the
// native side started or after it stopped. Use this in JNI callbacks instead of
// GetHost().PostToRenderThread, which crashes when a late Java callback arrives after shutdown.
bool PostIfRunning(std::function<void()> fn);

}  // namespace qn

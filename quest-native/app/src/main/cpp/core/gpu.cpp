// Vulkan through XR_KHR_vulkan_enable2, frame resources and the core projection swapchain.
// Owner: foundation.
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <set>

#include "core/app.h"
#include "core/qn_log.h"
#include "core/registry.h"
#include "core/xr_util.h"

namespace qn {

namespace {

// AND every VkBool32 after sType/pNext of `req` with `sup`; returns how many were dropped.
template <typename T>
int MaskBools(T& req, const T& sup) {
    constexpr size_t first = offsetof(T, pNext) + sizeof(void*);
    constexpr size_t n = (sizeof(T) - first) / sizeof(VkBool32);
    auto* r = reinterpret_cast<VkBool32*>(reinterpret_cast<char*>(&req) + first);
    auto* s = reinterpret_cast<const VkBool32*>(reinterpret_cast<const char*>(&sup) + first);
    int dropped = 0;
    for (size_t i = 0; i < n; ++i) {
        if (r[i] && !s[i]) {
            r[i] = VK_FALSE;
            ++dropped;
        }
    }
    return dropped;
}

int MaskCoreFeatures(VkPhysicalDeviceFeatures& req, const VkPhysicalDeviceFeatures& sup) {
    constexpr size_t n = sizeof(VkPhysicalDeviceFeatures) / sizeof(VkBool32);
    auto* r = reinterpret_cast<VkBool32*>(&req);
    auto* s = reinterpret_cast<const VkBool32*>(&sup);
    int dropped = 0;
    for (size_t i = 0; i < n; ++i) {
        if (r[i] && !s[i]) {
            r[i] = VK_FALSE;
            ++dropped;
        }
    }
    return dropped;
}

// Chain core -> v11 -> v12 -> v13 -> extra, only the structs the device version allows.
void ChainFeatures(DeviceFeatures& f) {
    void** tail = &f.core.pNext;
    *tail = nullptr;
    if (f.hasV11) { *tail = &f.v11; tail = &f.v11.pNext; *tail = nullptr; }
    if (f.hasV12) { *tail = &f.v12; tail = &f.v12.pNext; *tail = nullptr; }
    if (f.hasV13) { *tail = &f.v13; tail = &f.v13.pNext; *tail = nullptr; }
    *tail = f.extraPNext;
}

const char* VersionString(uint32_t v, char* buf, size_t n) {
    snprintf(buf, n, "%u.%u.%u", VK_API_VERSION_MAJOR(v), VK_API_VERSION_MINOR(v), VK_API_VERSION_PATCH(v));
    return buf;
}

}  // namespace

bool App::CreateVulkan() {
    PFN_xrGetVulkanGraphicsRequirements2KHR getReq = nullptr;
    PFN_xrCreateVulkanInstanceKHR createInstance = nullptr;
    PFN_xrGetVulkanGraphicsDevice2KHR getDevice = nullptr;
    PFN_xrCreateVulkanDeviceKHR createDevice = nullptr;
    XR_TRY(XR_PROC(xr_.instance, "xrGetVulkanGraphicsRequirements2KHR", getReq));
    XR_TRY(XR_PROC(xr_.instance, "xrCreateVulkanInstanceKHR", createInstance));
    XR_TRY(XR_PROC(xr_.instance, "xrGetVulkanGraphicsDevice2KHR", getDevice));
    XR_TRY(XR_PROC(xr_.instance, "xrCreateVulkanDeviceKHR", createDevice));

    XrGraphicsRequirementsVulkan2KHR req{XR_TYPE_GRAPHICS_REQUIREMENTS_VULKAN2_KHR};
    XR_TRY(getReq(xr_.instance, xr_.systemId, &req));
    QN_LOGI("[core] runtime Vulkan api min %u.%u max %u.%u", XR_VERSION_MAJOR(req.minApiVersionSupported),
            XR_VERSION_MINOR(req.minApiVersionSupported), XR_VERSION_MAJOR(req.maxApiVersionSupported),
            XR_VERSION_MINOR(req.maxApiVersionSupported));

    // --- instance (1.3 requested for the splat module; lower devices still work, see features)
    VkApplicationInfo appInfo{VK_STRUCTURE_TYPE_APPLICATION_INFO};
    appInfo.pApplicationName = "SHARP Quest Native";
    appInfo.applicationVersion = 1;
    appInfo.pEngineName = "quest-native";
    appInfo.apiVersion = VK_API_VERSION_1_3;
    VkInstanceCreateInfo ici{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
    ici.pApplicationInfo = &appInfo;
    XrVulkanInstanceCreateInfoKHR xici{XR_TYPE_VULKAN_INSTANCE_CREATE_INFO_KHR};
    xici.systemId = xr_.systemId;
    xici.pfnGetInstanceProcAddr = vkGetInstanceProcAddr;
    xici.vulkanCreateInfo = &ici;
    VkResult vr = VK_SUCCESS;
    XR_TRY(createInstance(xr_.instance, &xici, &gpu_.instance, &vr));
    VK_TRY(vr);
    gpu_.instanceApiVersion = appInfo.apiVersion;
    gpu_.getInstanceProcAddr = vkGetInstanceProcAddr;

    XrVulkanGraphicsDeviceGetInfoKHR dgi{XR_TYPE_VULKAN_GRAPHICS_DEVICE_GET_INFO_KHR};
    dgi.systemId = xr_.systemId;
    dgi.vulkanInstance = gpu_.instance;
    XR_TRY(getDevice(xr_.instance, &dgi, &gpu_.physicalDevice));

    VkPhysicalDeviceProperties props{};
    vkGetPhysicalDeviceProperties(gpu_.physicalDevice, &props);
    gpu_.deviceApiVersion = props.apiVersion;
    char vbuf[32];
    QN_LOGI("[gpu] device=%s api=%s driver=0x%08x timestampComputeAndGraphics=%u", props.deviceName,
            VersionString(props.apiVersion, vbuf, sizeof(vbuf)), props.driverVersion,
            (unsigned)props.limits.timestampComputeAndGraphics);

    // --- queue family: graphics + compute
    uint32_t qfCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(gpu_.physicalDevice, &qfCount, nullptr);
    std::vector<VkQueueFamilyProperties> qfs(qfCount);
    vkGetPhysicalDeviceQueueFamilyProperties(gpu_.physicalDevice, &qfCount, qfs.data());
    int family = -1;
    for (uint32_t i = 0; i < qfCount; ++i) {
        VkQueueFlags need = VK_QUEUE_GRAPHICS_BIT | VK_QUEUE_COMPUTE_BIT;
        if ((qfs[i].queueFlags & need) == need) {
            family = (int)i;
            break;
        }
    }
    if (family < 0) {
        QN_LOGE("[core] no graphics+compute queue family");
        return false;
    }
    gpu_.queueFamilyIndex = (uint32_t)family;

    // --- features: query supported, let modules fill requested, mask
    DeviceFeatures supported;
    supported.apiVersion = props.apiVersion;
    supported.hasV11 = supported.hasV12 = props.apiVersion >= VK_API_VERSION_1_2;
    supported.hasV13 = props.apiVersion >= VK_API_VERSION_1_3;
    ChainFeatures(supported);
    vkGetPhysicalDeviceFeatures2(gpu_.physicalDevice, &supported.core);

    DeviceFeatures& requested = enabledFeatures_;
    requested = DeviceFeatures{};
    requested.apiVersion = supported.apiVersion;
    requested.hasV11 = supported.hasV11;
    requested.hasV12 = supported.hasV12;
    requested.hasV13 = supported.hasV13;
    for (auto& m : RegisteredModules()) {
        if (m.fillDeviceFeatures) m.fillDeviceFeatures(gpu_.physicalDevice, supported, requested);
    }
    int dropped = MaskCoreFeatures(requested.core.features, supported.core.features);
    if (requested.hasV11) dropped += MaskBools(requested.v11, supported.v11);
    if (requested.hasV12) dropped += MaskBools(requested.v12, supported.v12);
    if (requested.hasV13) dropped += MaskBools(requested.v13, supported.v13);
    if (dropped) QN_LOGW("[gpu] %d requested feature(s) unsupported and not enabled", dropped);
    if (requested.hasV13) {
        QN_LOGI("[gpu] v13 enabled: dynamicRendering=%u synchronization2=%u demoteToHelper=%u maintenance4=%u "
                "subgroupSizeControl=%u computeFullSubgroups=%u; v12 timelineSemaphore=%u",
                requested.v13.dynamicRendering, requested.v13.synchronization2,
                requested.v13.shaderDemoteToHelperInvocation, requested.v13.maintenance4,
                requested.v13.subgroupSizeControl, requested.v13.computeFullSubgroups,
                requested.v12.timelineSemaphore);
    } else {
        QN_LOGW("[gpu] device is below Vulkan 1.3: 1.3 features are not available");
    }
    ChainFeatures(requested);

    // --- device extensions requested by modules
    uint32_t extCount = 0;
    vkEnumerateDeviceExtensionProperties(gpu_.physicalDevice, nullptr, &extCount, nullptr);
    std::vector<VkExtensionProperties> exts(extCount);
    vkEnumerateDeviceExtensionProperties(gpu_.physicalDevice, nullptr, &extCount, exts.data());
    std::set<std::string> availableExt;
    for (auto& e : exts) availableExt.insert(e.extensionName);
    std::set<std::string> wantExt;
    for (auto& m : RegisteredModules()) {
        for (auto& e : m.optionalDeviceExtensions) {
            if (availableExt.count(e)) {
                wantExt.insert(e);
            } else {
                QN_LOGW("[gpu] device extension not available, skipped: %s (%s)", e.c_str(), m.id);
            }
        }
    }
    gpu_.enabledDeviceExtensions.assign(wantExt.begin(), wantExt.end());
    std::vector<const char*> extNames;
    for (auto& e : gpu_.enabledDeviceExtensions) extNames.push_back(e.c_str());

    float priority = 1.0f;
    VkDeviceQueueCreateInfo qci{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
    qci.queueFamilyIndex = gpu_.queueFamilyIndex;
    qci.queueCount = 1;
    qci.pQueuePriorities = &priority;
    VkDeviceCreateInfo dci{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
    dci.pNext = &requested.core;  // features through VkPhysicalDeviceFeatures2, pEnabledFeatures stays null
    dci.queueCreateInfoCount = 1;
    dci.pQueueCreateInfos = &qci;
    dci.enabledExtensionCount = (uint32_t)extNames.size();
    dci.ppEnabledExtensionNames = extNames.data();

    XrVulkanDeviceCreateInfoKHR xdci{XR_TYPE_VULKAN_DEVICE_CREATE_INFO_KHR};
    xdci.systemId = xr_.systemId;
    xdci.pfnGetInstanceProcAddr = vkGetInstanceProcAddr;
    xdci.vulkanPhysicalDevice = gpu_.physicalDevice;
    xdci.vulkanCreateInfo = &dci;
    XR_TRY(createDevice(xr_.instance, &xdci, &gpu_.device, &vr));
    VK_TRY(vr);
    vkGetDeviceQueue(gpu_.device, gpu_.queueFamilyIndex, 0, &gpu_.queue);
    return true;
}

bool App::CreateFrameResources() {
    for (uint32_t i = 0; i < kFrameSlots; ++i) {
        VkCommandPoolCreateInfo pci{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
        pci.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        pci.queueFamilyIndex = gpu_.queueFamilyIndex;
        VK_TRY(vkCreateCommandPool(gpu_.device, &pci, nullptr, &cmdPool_[i]));
        VkCommandBufferAllocateInfo ai{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
        ai.commandPool = cmdPool_[i];
        ai.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        ai.commandBufferCount = 1;
        VK_TRY(vkAllocateCommandBuffers(gpu_.device, &ai, &cmd_[i]));
        VkFenceCreateInfo fci{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
        fci.flags = VK_FENCE_CREATE_SIGNALED_BIT;
        VK_TRY(vkCreateFence(gpu_.device, &fci, nullptr, &fence_[i]));
    }
    return true;
}

bool App::CreateProjectionSwapchain() {
    uint32_t n = 0;
    XR_TRY(xrEnumerateSwapchainFormats(xr_.session, 0, &n, nullptr));
    std::vector<int64_t> formats(n);
    XR_TRY(xrEnumerateSwapchainFormats(xr_.session, n, &n, formats.data()));
    VkFormat format = VK_FORMAT_UNDEFINED;
    for (auto f : formats) {
        if (f == VK_FORMAT_R8G8B8A8_SRGB) format = VK_FORMAT_R8G8B8A8_SRGB;
    }
    if (format == VK_FORMAT_UNDEFINED) {
        QN_LOGE("[core] runtime has no VK_FORMAT_R8G8B8A8_SRGB swapchain format");
        return false;
    }

    const auto& vc = viewConfigs_[0];
    uint32_t w = (uint32_t)std::lround(vc.recommendedImageRectWidth * resolutionScale_);
    uint32_t h = (uint32_t)std::lround(vc.recommendedImageRectHeight * resolutionScale_);
    w = std::min(std::max(w, 16u), vc.maxImageRectWidth);
    h = std::min(std::max(h, 16u), vc.maxImageRectHeight);

    bool fov = xr_.HasExtension(XR_FB_FOVEATION_VULKAN_EXTENSION_NAME) &&
               xr_.HasExtension(XR_FB_FOVEATION_EXTENSION_NAME) &&
               xr_.HasExtension(XR_FB_SWAPCHAIN_UPDATE_STATE_EXTENSION_NAME);
    XrSwapchainCreateInfoFoveationFB fovInfo{XR_TYPE_SWAPCHAIN_CREATE_INFO_FOVEATION_FB};
    fovInfo.flags = XR_SWAPCHAIN_CREATE_FOVEATION_FRAGMENT_DENSITY_MAP_BIT_FB;

    XrSwapchainCreateInfo sci{XR_TYPE_SWAPCHAIN_CREATE_INFO};
    sci.next = fov ? &fovInfo : nullptr;
    sci.usageFlags = XR_SWAPCHAIN_USAGE_COLOR_ATTACHMENT_BIT | XR_SWAPCHAIN_USAGE_TRANSFER_DST_BIT |
                     XR_SWAPCHAIN_USAGE_SAMPLED_BIT | XR_SWAPCHAIN_USAGE_MUTABLE_FORMAT_BIT;
    sci.format = format;
    sci.sampleCount = 1;
    sci.width = w;
    sci.height = h;
    sci.faceCount = 1;
    sci.arraySize = 2;  // layer 0 = left eye, layer 1 = right eye (no multiview, two passes)
    sci.mipCount = 1;
    XR_TRY(xrCreateSwapchain(xr_.session, &sci, &proj_.handle));
    proj_.format = format;
    proj_.extent = {w, h};
    proj_.foveationCapable = fov;

    XR_TRY(xrEnumerateSwapchainImages(proj_.handle, 0, &n, nullptr));
    std::vector<XrSwapchainImageVulkan2KHR> imgs(n, {XR_TYPE_SWAPCHAIN_IMAGE_VULKAN2_KHR});
    std::vector<XrSwapchainImageFoveationVulkanFB> fdm(n, {XR_TYPE_SWAPCHAIN_IMAGE_FOVEATION_VULKAN_FB});
    if (fov) {
        for (uint32_t i = 0; i < n; ++i) imgs[i].next = &fdm[i];
    }
    XR_TRY(xrEnumerateSwapchainImages(proj_.handle, n, &n, (XrSwapchainImageBaseHeader*)imgs.data()));
    proj_.images.clear();
    proj_.views.clear();
    proj_.fdmImages.clear();
    proj_.fdmExtents.clear();
    for (uint32_t i = 0; i < n; ++i) {
        proj_.images.push_back(imgs[i].image);
        proj_.fdmImages.push_back(fov ? fdm[i].image : VK_NULL_HANDLE);
        proj_.fdmExtents.push_back(fov ? VkExtent2D{fdm[i].width, fdm[i].height} : VkExtent2D{0, 0});
        for (uint32_t layer = 0; layer < 2; ++layer) {
            VkImageViewCreateInfo vci{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
            vci.image = imgs[i].image;
            vci.viewType = VK_IMAGE_VIEW_TYPE_2D;
            vci.format = format;
            vci.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, layer, 1};
            VkImageView view = VK_NULL_HANDLE;
            VK_TRY(vkCreateImageView(gpu_.device, &vci, nullptr, &view));
            proj_.views.push_back(view);
        }
    }
    QN_LOGI("[core] projection swapchain %ux%u x2 layers, %u images, scale %.2f, foveation-capable %d", w, h, n,
            resolutionScale_, (int)fov);
    if (foveation_ != FoveationLevel::kOff) SetFoveationLevel(foveation_);
    return true;
}

void App::DestroyProjectionSwapchain() {
    if (gpu_.device) vkDeviceWaitIdle(gpu_.device);
    for (auto v : proj_.views) vkDestroyImageView(gpu_.device, v, nullptr);
    if (proj_.handle) xrDestroySwapchain(proj_.handle);
    proj_ = ProjectionSwapchain{};
}

void App::RecordClear(VkCommandBuffer cmd, uint32_t imageIndex, bool transparent) {
    VkImage image = proj_.images[imageIndex];
    VkImageSubresourceRange range{VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 2};
    VkImageMemoryBarrier b{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
    b.srcAccessMask = 0;
    b.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    b.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;  // contents are replaced
    b.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    b.srcQueueFamilyIndex = b.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    b.image = image;
    b.subresourceRange = range;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, nullptr, 0,
                         nullptr, 1, &b);
    // Empty immersive scene: dark blue-grey (sRGB image, values are linear).
    VkClearColorValue color{};
    color.float32[0] = 0.010f;
    color.float32[1] = 0.012f;
    color.float32[2] = 0.020f;
    color.float32[3] = transparent ? 0.0f : 1.0f;
    vkCmdClearColorImage(cmd, image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, &color, 1, &range);
    b.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    b.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_READ_BIT | VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    b.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
    b.newLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT, 0, 0,
                         nullptr, 0, nullptr, 1, &b);
}

void App::DestroyVulkan() {
    if (!gpu_.device) return;
    vkDeviceWaitIdle(gpu_.device);
    for (uint32_t i = 0; i < kFrameSlots; ++i) {
        if (fence_[i]) vkDestroyFence(gpu_.device, fence_[i], nullptr);
        if (cmdPool_[i]) vkDestroyCommandPool(gpu_.device, cmdPool_[i], nullptr);
        fence_[i] = VK_NULL_HANDLE;
        cmdPool_[i] = VK_NULL_HANDLE;
    }
    vkDestroyDevice(gpu_.device, nullptr);
    gpu_.device = VK_NULL_HANDLE;
    if (gpu_.instance) vkDestroyInstance(gpu_.instance, nullptr);
    gpu_.instance = VK_NULL_HANDLE;
}

}  // namespace qn

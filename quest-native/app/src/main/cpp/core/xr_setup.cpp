// OpenXR loader, instance, session and reference spaces. Owner: foundation.
#include <cstring>
#include <set>

#include "core/app.h"
#include "core/qn_log.h"
#include "core/registry.h"
#include "core/xr_util.h"

namespace qn {

bool App::InitLoader() {
    PFN_xrInitializeLoaderKHR initLoader = nullptr;
    XR_TRY(xrGetInstanceProcAddr(XR_NULL_HANDLE, "xrInitializeLoaderKHR", (PFN_xrVoidFunction*)&initLoader));
    XrLoaderInitInfoAndroidKHR info{XR_TYPE_LOADER_INIT_INFO_ANDROID_KHR};
    info.applicationVM = android_->activity->vm;
    info.applicationContext = android_->activity->clazz;
    XR_TRY(initLoader((const XrLoaderInitInfoBaseHeaderKHR*)&info));
    return true;
}

bool App::CreateInstance() {
    uint32_t count = 0;
    XR_TRY(xrEnumerateInstanceExtensionProperties(nullptr, 0, &count, nullptr));
    std::vector<XrExtensionProperties> props(count, {XR_TYPE_EXTENSION_PROPERTIES});
    XR_TRY(xrEnumerateInstanceExtensionProperties(nullptr, count, &count, props.data()));
    std::set<std::string> available;
    std::string all;
    for (auto& p : props) {
        available.insert(p.extensionName);
        all += p.extensionName;
        all += ' ';
    }
    QN_LOGI("[core] runtime extensions (%u): %s", count, all.c_str());

    std::vector<std::string> wanted = {XR_KHR_ANDROID_CREATE_INSTANCE_EXTENSION_NAME,
                                       XR_KHR_VULKAN_ENABLE2_EXTENSION_NAME};
    for (auto& r : wanted) {
        if (!available.count(r)) {
            QN_LOGE("[core] required OpenXR extension missing: %s", r.c_str());
            return false;
        }
    }
    // Core optional extensions: layer types in the contract and render settings.
    std::vector<std::string> optional = {
        XR_KHR_ANDROID_SURFACE_SWAPCHAIN_EXTENSION_NAME,
        XR_KHR_COMPOSITION_LAYER_EQUIRECT2_EXTENSION_NAME,
        XR_KHR_COMPOSITION_LAYER_CYLINDER_EXTENSION_NAME,
        XR_FB_DISPLAY_REFRESH_RATE_EXTENSION_NAME,
        XR_FB_SWAPCHAIN_UPDATE_STATE_EXTENSION_NAME,
        XR_FB_FOVEATION_EXTENSION_NAME,
        XR_FB_FOVEATION_CONFIGURATION_EXTENSION_NAME,
        XR_FB_FOVEATION_VULKAN_EXTENSION_NAME,
        XR_EXT_LOCAL_FLOOR_EXTENSION_NAME,
    };
    for (auto& m : RegisteredModules()) {
        for (auto& e : m.optionalXrExtensions) optional.push_back(e);
    }
    for (auto& o : optional) {
        bool dup = false;
        for (auto& w : wanted) dup = dup || w == o;
        if (dup) continue;
        if (available.count(o)) {
            wanted.push_back(o);
        } else {
            QN_LOGW("[core] optional OpenXR extension not available, skipped: %s", o.c_str());
        }
    }
    std::vector<const char*> names;
    for (auto& w : wanted) names.push_back(w.c_str());

    XrInstanceCreateInfoAndroidKHR androidInfo{XR_TYPE_INSTANCE_CREATE_INFO_ANDROID_KHR};
    androidInfo.applicationVM = android_->activity->vm;
    androidInfo.applicationActivity = android_->activity->clazz;

    XrInstanceCreateInfo ci{XR_TYPE_INSTANCE_CREATE_INFO};
    ci.next = &androidInfo;
    strncpy(ci.applicationInfo.applicationName, "SHARP Quest Native", XR_MAX_APPLICATION_NAME_SIZE - 1);
    ci.applicationInfo.applicationVersion = 1;
    strncpy(ci.applicationInfo.engineName, "quest-native", XR_MAX_ENGINE_NAME_SIZE - 1);
    // 1.1 loaders accept 1.0 apps everywhere; the Quest runtime reports 1.0/1.1 depending on OS.
    ci.applicationInfo.apiVersion = XR_API_VERSION_1_0;
    ci.enabledExtensionCount = (uint32_t)names.size();
    ci.enabledExtensionNames = names.data();
    XR_TRY(xrCreateInstance(&ci, &xr_.instance));
    xr_.enabledExtensions = wanted;

    XrInstanceProperties ip{XR_TYPE_INSTANCE_PROPERTIES};
    xrGetInstanceProperties(xr_.instance, &ip);
    QN_LOGI("[core] runtime %s %u.%u.%u", ip.runtimeName, XR_VERSION_MAJOR(ip.runtimeVersion),
            XR_VERSION_MINOR(ip.runtimeVersion), XR_VERSION_PATCH(ip.runtimeVersion));

    XrSystemGetInfo sgi{XR_TYPE_SYSTEM_GET_INFO};
    sgi.formFactor = XR_FORM_FACTOR_HEAD_MOUNTED_DISPLAY;
    XR_TRY(xrGetSystem(xr_.instance, &sgi, &xr_.systemId));

    uint32_t viewCount = 0;
    XR_TRY(xrEnumerateViewConfigurationViews(xr_.instance, xr_.systemId, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
                                             0, &viewCount, nullptr));
    viewConfigs_.assign(viewCount, {XR_TYPE_VIEW_CONFIGURATION_VIEW});
    XR_TRY(xrEnumerateViewConfigurationViews(xr_.instance, xr_.systemId, XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO,
                                             viewCount, &viewCount, viewConfigs_.data()));
    if (viewCount != 2) {
        QN_LOGE("[core] expected 2 views, got %u", viewCount);
        return false;
    }
    QN_LOGI("[core] recommended eye %ux%u, max %ux%u", viewConfigs_[0].recommendedImageRectWidth,
            viewConfigs_[0].recommendedImageRectHeight, viewConfigs_[0].maxImageRectWidth,
            viewConfigs_[0].maxImageRectHeight);
    return true;
}

bool App::CreateSession() {
    XrGraphicsBindingVulkan2KHR binding{XR_TYPE_GRAPHICS_BINDING_VULKAN2_KHR};
    binding.instance = gpu_.instance;
    binding.physicalDevice = gpu_.physicalDevice;
    binding.device = gpu_.device;
    binding.queueFamilyIndex = gpu_.queueFamilyIndex;
    binding.queueIndex = 0;
    XrSessionCreateInfo sci{XR_TYPE_SESSION_CREATE_INFO};
    sci.next = &binding;
    sci.systemId = xr_.systemId;
    XR_TRY(xrCreateSession(xr_.instance, &sci, &xr_.session));
    return true;
}

bool App::CreateSpaces() {
    XrReferenceSpaceCreateInfo rs{XR_TYPE_REFERENCE_SPACE_CREATE_INFO};
    rs.poseInReferenceSpace.orientation.w = 1.0f;
    rs.referenceSpaceType = xr_.HasExtension(XR_EXT_LOCAL_FLOOR_EXTENSION_NAME) ? XR_REFERENCE_SPACE_TYPE_LOCAL_FLOOR_EXT
                                                                                  : XR_REFERENCE_SPACE_TYPE_LOCAL;
    if (XR_FAILED(xrCreateReferenceSpace(xr_.session, &rs, &xr_.appSpace))) {
        rs.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_LOCAL;
        XR_TRY(xrCreateReferenceSpace(xr_.session, &rs, &xr_.appSpace));
    }
    QN_LOGI("[core] app space: %s",
            rs.referenceSpaceType == XR_REFERENCE_SPACE_TYPE_LOCAL ? "LOCAL" : "LOCAL_FLOOR");
    rs.referenceSpaceType = XR_REFERENCE_SPACE_TYPE_VIEW;
    XR_TRY(xrCreateReferenceSpace(xr_.session, &rs, &xr_.viewSpace));
    return true;
}

}  // namespace qn

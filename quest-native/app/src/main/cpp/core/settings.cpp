// Render settings and surface swapchains (Host services). Owner: foundation.
// Foveation note: with Vulkan the runtime only applies foveation when the viewer attaches
// EyeTarget::fdmImage as a fragment density map in its render pass (VK_EXT_fragment_density_map).
// Core enables the extensions and sets the level; the effect is unverified until a device test.
#include <algorithm>

#include "core/app.h"
#include "core/qn_log.h"
#include "core/xr_util.h"

namespace qn {

bool App::SetResolutionScale(float scale) {
    scale = std::min(std::max(scale, 0.6f), 1.2f);
    pendingScale_ = scale;  // swapchain is rebuilt between frames (App::Frame)
    QN_LOGI("[core] resolution scale -> %.2f (pending)", scale);
    return true;
}

bool App::SetFoveationLevel(FoveationLevel level) {
    foveation_ = level;
    if (!xr_.HasExtension(XR_FB_FOVEATION_EXTENSION_NAME) ||
        !xr_.HasExtension(XR_FB_FOVEATION_CONFIGURATION_EXTENSION_NAME) ||
        !xr_.HasExtension(XR_FB_SWAPCHAIN_UPDATE_STATE_EXTENSION_NAME)) {
        QN_LOGW("[core] foveation extensions missing, level %d ignored", (int)level);
        return false;
    }
    if (!proj_.handle) return true;  // applied when the swapchain is created
    PFN_xrCreateFoveationProfileFB createProfile = nullptr;
    PFN_xrDestroyFoveationProfileFB destroyProfile = nullptr;
    PFN_xrUpdateSwapchainFB updateSwapchain = nullptr;
    XR_TRY(XR_PROC(xr_.instance, "xrCreateFoveationProfileFB", createProfile));
    XR_TRY(XR_PROC(xr_.instance, "xrDestroyFoveationProfileFB", destroyProfile));
    XR_TRY(XR_PROC(xr_.instance, "xrUpdateSwapchainFB", updateSwapchain));

    XrFoveationLevelProfileCreateInfoFB levelInfo{XR_TYPE_FOVEATION_LEVEL_PROFILE_CREATE_INFO_FB};
    static const XrFoveationLevelFB kLevels[] = {XR_FOVEATION_LEVEL_NONE_FB, XR_FOVEATION_LEVEL_LOW_FB,
                                                 XR_FOVEATION_LEVEL_MEDIUM_FB, XR_FOVEATION_LEVEL_HIGH_FB};
    levelInfo.level = kLevels[(int)level];
    levelInfo.verticalOffset = 0.0f;
    levelInfo.dynamic = XR_FOVEATION_DYNAMIC_DISABLED_FB;
    XrFoveationProfileCreateInfoFB profileInfo{XR_TYPE_FOVEATION_PROFILE_CREATE_INFO_FB};
    profileInfo.next = &levelInfo;
    XrFoveationProfileFB profile = XR_NULL_HANDLE;
    XR_TRY(createProfile(xr_.session, &profileInfo, &profile));
    XrSwapchainStateFoveationFB state{XR_TYPE_SWAPCHAIN_STATE_FOVEATION_FB};
    state.profile = profile;
    XR_TRY(updateSwapchain(proj_.handle, (const XrSwapchainStateBaseHeaderFB*)&state));
    if (foveationProfile_) destroyProfile(foveationProfile_);
    foveationProfile_ = profile;
    QN_LOGI("[core] foveation level %d", (int)level);
    return true;
}

std::vector<float> App::SupportedRefreshRates() {
    std::vector<float> rates;
    if (!xr_.HasExtension(XR_FB_DISPLAY_REFRESH_RATE_EXTENSION_NAME) || !xr_.session) return rates;
    PFN_xrEnumerateDisplayRefreshRatesFB enumerate = nullptr;
    if (XR_FAILED(XR_PROC(xr_.instance, "xrEnumerateDisplayRefreshRatesFB", enumerate))) return rates;
    uint32_t n = 0;
    if (XR_FAILED(enumerate(xr_.session, 0, &n, nullptr))) return rates;
    rates.resize(n);
    if (XR_FAILED(enumerate(xr_.session, n, &n, rates.data()))) rates.clear();
    return rates;
}

bool App::SetRefreshRate(float hz) {
    if (!xr_.HasExtension(XR_FB_DISPLAY_REFRESH_RATE_EXTENSION_NAME)) {
        QN_LOGW("[core] XR_FB_display_refresh_rate missing, %.0f Hz ignored", hz);
        return false;
    }
    PFN_xrRequestDisplayRefreshRateFB request = nullptr;
    XR_TRY(XR_PROC(xr_.instance, "xrRequestDisplayRefreshRateFB", request));
    XR_TRY(request(xr_.session, hz));
    QN_LOGI("[core] refresh rate requested %.0f Hz", hz);
    return true;
}

bool App::CreateSurfaceSwapchain(const XrSwapchainCreateInfo& info, XrSwapchain* swapchain, jobject* surface) {
    if (!xr_.HasExtension(XR_KHR_ANDROID_SURFACE_SWAPCHAIN_EXTENSION_NAME)) {
        QN_LOGW("[core] XR_KHR_android_surface_swapchain missing");
        return false;
    }
    PFN_xrCreateSwapchainAndroidSurfaceKHR create = nullptr;
    XR_TRY(XR_PROC(xr_.instance, "xrCreateSwapchainAndroidSurfaceKHR", create));
    jobject local = nullptr;
    XR_TRY(create(xr_.session, &info, swapchain, &local));
    *surface = env_->NewGlobalRef(local);
    return true;
}

}  // namespace qn

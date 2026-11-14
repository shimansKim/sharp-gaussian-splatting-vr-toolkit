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
    // XR_KHR_android_surface_swapchain: format, sampleCount, faceCount, arraySize and mipCount must be 0
    // (the Surface decides them). Quest rejects anything else with XR_ERROR_VALIDATION_FAILURE.
    XrSwapchainCreateInfo surfaceInfo = info;
    surfaceInfo.format = 0;
    surfaceInfo.sampleCount = 0;
    surfaceInfo.faceCount = 0;
    surfaceInfo.arraySize = 0;
    surfaceInfo.mipCount = 0;
    jobject local = nullptr;
    XR_TRY(create(xr_.session, &surfaceInfo, swapchain, &local));
    *surface = env_->NewGlobalRef(local);
    // Quest's runtime hands back a global reference that it owns (deleting it as a local aborts the VM);
    // other runtimes may return a local one, which would pile up on the always-attached render thread.
    if (env_->GetObjectRefType(local) == JNILocalRefType) env_->DeleteLocalRef(local);
    return true;
}

bool App::InitPassthrough() {
    if (!passthroughSupported_ || !xr_.session) return false;
    if (XR_FAILED(XR_PROC(xr_.instance, "xrCreatePassthroughFB", pfnCreatePassthrough_)) ||
        XR_FAILED(XR_PROC(xr_.instance, "xrDestroyPassthroughFB", pfnDestroyPassthrough_)) ||
        XR_FAILED(XR_PROC(xr_.instance, "xrPassthroughStartFB", pfnPassthroughStart_)) ||
        XR_FAILED(XR_PROC(xr_.instance, "xrPassthroughPauseFB", pfnPassthroughPause_)) ||
        XR_FAILED(XR_PROC(xr_.instance, "xrCreatePassthroughLayerFB", pfnCreatePassthroughLayer_)) ||
        XR_FAILED(XR_PROC(xr_.instance, "xrDestroyPassthroughLayerFB", pfnDestroyPassthroughLayer_)) ||
        XR_FAILED(XR_PROC(xr_.instance, "xrPassthroughLayerPauseFB", pfnPassthroughLayerPause_)) ||
        XR_FAILED(XR_PROC(xr_.instance, "xrPassthroughLayerResumeFB", pfnPassthroughLayerResume_))) {
        QN_LOGW("[core] XR_FB_passthrough entry points missing, passthrough disabled");
        passthroughSupported_ = false;
        return false;
    }
    XR_PROC(xr_.instance, "xrPassthroughLayerSetStyleFB", pfnPassthroughLayerSetStyle_);

    XrPassthroughCreateInfoFB pci{XR_TYPE_PASSTHROUGH_CREATE_INFO_FB};
    pci.flags = 0;
    XrResult r = pfnCreatePassthrough_(xr_.session, &pci, &passthrough_);
    if (XR_FAILED(r)) {
        QN_LOGW("[core] xrCreatePassthroughFB failed (%d), passthrough disabled", (int)r);
        passthroughSupported_ = false;
        return false;
    }

    XrPassthroughLayerCreateInfoFB lci{XR_TYPE_PASSTHROUGH_LAYER_CREATE_INFO_FB};
    lci.passthrough = passthrough_;
    lci.flags = 0;
    lci.purpose = XR_PASSTHROUGH_LAYER_PURPOSE_RECONSTRUCTION_FB;
    r = pfnCreatePassthroughLayer_(xr_.session, &lci, &passthroughLayer_);
    if (XR_FAILED(r)) {
        QN_LOGW("[core] xrCreatePassthroughLayerFB failed (%d), passthrough disabled", (int)r);
        DestroyPassthrough();
        passthroughSupported_ = false;
        return false;
    }

    if (pfnPassthroughLayerSetStyle_) {
        XrPassthroughStyleFB style{XR_TYPE_PASSTHROUGH_STYLE_FB};
        style.textureOpacityFactor = 1.0f;
        style.edgeColor = {0.0f, 0.0f, 0.0f, 0.0f};
        pfnPassthroughLayerSetStyle_(passthroughLayer_, &style);
    }
    passthroughRunning_ = false;
    QN_LOGI("[core] XR_FB_passthrough initialized");
    return true;
}

void App::DestroyPassthrough() {
    if (passthroughLayer_) {
        if (passthroughRunning_ && pfnPassthroughLayerPause_) pfnPassthroughLayerPause_(passthroughLayer_);
        if (pfnDestroyPassthroughLayer_) pfnDestroyPassthroughLayer_(passthroughLayer_);
        passthroughLayer_ = XR_NULL_HANDLE;
    }
    if (passthrough_) {
        if (passthroughRunning_ && pfnPassthroughPause_) pfnPassthroughPause_(passthrough_);
        if (pfnDestroyPassthrough_) pfnDestroyPassthrough_(passthrough_);
        passthrough_ = XR_NULL_HANDLE;
    }
    passthroughRunning_ = false;
}

bool App::ApplyPassthroughState() {
    if (!passthroughSupported_ || !passthrough_ || !passthroughLayer_) {
        passthroughEnabled_ = false;
        passthroughRunning_ = false;
        return false;
    }
    if (passthroughEnabled_ == passthroughRunning_) return true;
    if (passthroughEnabled_) {
        XrResult r = pfnPassthroughStart_(passthrough_);
        if (XR_FAILED(r)) {
            QN_LOGW("[core] xrPassthroughStartFB failed (%d)", (int)r);
            passthroughEnabled_ = false;
            passthroughRunning_ = false;
            return false;
        }
        r = pfnPassthroughLayerResume_(passthroughLayer_);
        if (XR_FAILED(r)) {
            QN_LOGW("[core] xrPassthroughLayerResumeFB failed (%d)", (int)r);
            pfnPassthroughPause_(passthrough_);
            passthroughEnabled_ = false;
            passthroughRunning_ = false;
            return false;
        }
        passthroughRunning_ = true;
        QN_LOGI("[core] passthrough ON");
    } else {
        if (XR_FAILED(pfnPassthroughLayerPause_(passthroughLayer_))) {
            QN_LOGW("[core] xrPassthroughLayerPauseFB failed");
        }
        if (XR_FAILED(pfnPassthroughPause_(passthrough_))) {
            QN_LOGW("[core] xrPassthroughPauseFB failed");
        }
        passthroughRunning_ = false;
        QN_LOGI("[core] passthrough OFF");
    }
    return true;
}

bool App::SetPassthrough(bool enabled) {
    if (!passthroughSupported_) {
        if (enabled) QN_LOGW("[core] XR_FB_passthrough unsupported, passthrough toggle ignored");
        passthroughEnabled_ = false;
        return false;
    }
    passthroughEnabled_ = enabled;
    if (!sessionRunning_) {
        QN_LOGI("[core] passthrough %s (pending session ready)", enabled ? "ON" : "OFF");
        return true;
    }
    return ApplyPassthroughState();
}

}  // namespace qn

// Video layout -> OpenXR composition layers. Owner: video-dev.
// Pure functions (no JNI, no Host) so the layer math is easy to read and check.
//
// Layout names are quest-app MediaLayout names (format-detect.js / FormatDetect.java).
// The decoded frame lives in one Android-Surface swapchain of width x height pixels; each layout
// maps it to layers:
//   mono2d                      1 quad, both eyes, whole frame
//   sbsScreenFull/Half, tbScreen  2 quads (LEFT/RIGHT eye visibility), half frame each
//   mono360 / mono180           1 equirect2, both eyes
//   sbs360 / tb360 / sbs180     2 equirect2 (LEFT/RIGHT), half frame each
// Image rect origin is the top-left of the decoded picture: TB puts the left eye on top
// (same as quest-app eyeRegion, whose v axis points up). To verify on device.
#pragma once

#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#include <cmath>
#include <cstring>
#include <string>

namespace qn {
namespace video {

enum class Shape { kScreen, kSphere180, kSphere360 };
enum class Stereo { kMono, kSbs, kTb };

struct LayoutInfo {
    const char* name;
    Shape shape;
    Stereo stereo;
};

inline const LayoutInfo* FindLayout(const std::string& name) {
    static const LayoutInfo kLayouts[] = {
        {"sbs180", Shape::kSphere180, Stereo::kSbs},
        {"mono180", Shape::kSphere180, Stereo::kMono},
        {"mono360", Shape::kSphere360, Stereo::kMono},
        {"tb360", Shape::kSphere360, Stereo::kTb},
        {"sbs360", Shape::kSphere360, Stereo::kSbs},
        {"sbsScreenFull", Shape::kScreen, Stereo::kSbs},
        {"sbsScreenHalf", Shape::kScreen, Stereo::kSbs},
        {"tbScreen", Shape::kScreen, Stereo::kTb},
        {"mono2d", Shape::kScreen, Stereo::kMono},
    };
    for (auto& l : kLayouts) {
        if (name == l.name) return &l;
    }
    return nullptr;
}

// Same order as quest-app LAYOUT_ORDER (used by the temporary stick-click cycling).
inline const char* NextLayoutName(const std::string& current) {
    static const char* kOrder[] = {"sbs180", "mono180", "mono360", "tb360", "sbs360",
                                   "sbsScreenFull", "sbsScreenHalf", "tbScreen", "mono2d"};
    const int n = (int)(sizeof(kOrder) / sizeof(kOrder[0]));
    for (int i = 0; i < n; ++i) {
        if (current == kOrder[i]) return kOrder[(i + 1) % n];
    }
    return kOrder[0];
}

// Width / height of one eye's picture on the virtual screen (FormatDetect.eyeAspect).
inline double EyeAspect(const std::string& layout, int width, int height) {
    double w = width > 0 ? width : 16, h = height > 0 ? height : 9;
    if (layout == "sbsScreenFull") return w / 2 / h;
    if (layout == "tbScreen") return w / h < 1.2 ? w / (h / 2) : w / h;
    return w / h;
}

// Screen geometry, same numbers as quest-app projections.js.
constexpr float kScreenDistance = 3.0f;    // m in front of the viewer
constexpr float kScreenBaseWidth = 6.0f;   // m at scale 1
constexpr float kDefaultScreenScale = 0.6f;
constexpr float kMinScreenScale = 0.15f;
constexpr float kMaxScreenScale = 3.0f;
constexpr float kPi = 3.14159265358979f;

inline XrQuaternionf YawQuat(float yaw) {
    return XrQuaternionf{0.0f, std::sin(yaw * 0.5f), 0.0f, std::cos(yaw * 0.5f)};
}

// Heading of a pose around +Y (0 = looking down -Z).
inline float YawOf(const XrQuaternionf& q) {
    return std::atan2(2.0f * (q.w * q.y + q.x * q.z), 1.0f - 2.0f * (q.x * q.x + q.y * q.y));
}

struct Placement {
    XrVector3f anchor{0, 1.6f, 0};  // viewer head position when recentered (app space)
    float yaw = 0;                  // heading of the content center
    float screenScale = kDefaultScreenScale;
};

// Per-eye rectangle of the frame. eye 0 = left, 1 = right; swap flips them.
inline XrRect2Di EyeRect(Stereo stereo, int eye, bool swap, int width, int height) {
    int e = swap ? 1 - eye : eye;
    switch (stereo) {
        case Stereo::kSbs: return XrRect2Di{{e * (width / 2), 0}, {width / 2, height}};
        case Stereo::kTb: return XrRect2Di{{0, e * (height / 2)}, {width, height / 2}};
        default: return XrRect2Di{{0, 0}, {width, height}};
    }
}

// Fills up to 2 layers. Returns how many (0 when the layout is unknown or size is 0).
// Exactly one of quads / equirects is used, depending on the layout shape.
inline int BuildLayers(const std::string& layoutName, int width, int height, bool swapEyes, const Placement& p,
                       XrSpace space, XrSwapchain swapchain, XrCompositionLayerQuad quads[2],
                       XrCompositionLayerEquirect2KHR equirects[2], bool* isSphere) {
    const LayoutInfo* L = FindLayout(layoutName);
    if (!L || width <= 0 || height <= 0 || swapchain == XR_NULL_HANDLE) return 0;
    const int count = L->stereo == Stereo::kMono ? 1 : 2;
    *isSphere = L->shape != Shape::kScreen;
    for (int i = 0; i < count; ++i) {
        XrEyeVisibility vis = count == 1 ? XR_EYE_VISIBILITY_BOTH : (i == 0 ? XR_EYE_VISIBILITY_LEFT
                                                                             : XR_EYE_VISIBILITY_RIGHT);
        XrRect2Di rect = EyeRect(L->stereo, i, swapEyes, width, height);
        if (L->shape == Shape::kScreen) {
            XrCompositionLayerQuad& q = quads[i];
            q = XrCompositionLayerQuad{XR_TYPE_COMPOSITION_LAYER_QUAD};
            q.space = space;
            q.eyeVisibility = vis;
            q.subImage.swapchain = swapchain;
            q.subImage.imageRect = rect;
            q.pose.orientation = YawQuat(p.yaw);
            q.pose.position = XrVector3f{p.anchor.x - kScreenDistance * std::sin(p.yaw), p.anchor.y,
                                         p.anchor.z - kScreenDistance * std::cos(p.yaw)};
            float w = kScreenBaseWidth * p.screenScale;
            q.size = XrExtent2Df{w, (float)(w / EyeAspect(layoutName, width, height))};
        } else {
            XrCompositionLayerEquirect2KHR& e = equirects[i];
            e = XrCompositionLayerEquirect2KHR{XR_TYPE_COMPOSITION_LAYER_EQUIRECT2_KHR};
            e.space = space;
            e.eyeVisibility = vis;
            e.subImage.swapchain = swapchain;
            e.subImage.imageRect = rect;
            e.pose.orientation = YawQuat(p.yaw);
            e.pose.position = p.anchor;
            e.radius = 0.0f;  // infinite sphere: no parallax with head movement
            e.centralHorizontalAngle = L->shape == Shape::kSphere180 ? kPi : 2.0f * kPi;
            e.upperVerticalAngle = kPi / 2;
            e.lowerVerticalAngle = -kPi / 2;
        }
    }
    return count;
}

}  // namespace video
}  // namespace qn

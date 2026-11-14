// PC tests use the real OpenXR headers; no runtime or device is required.
#include "video/video_layers.h"
#include <cstdio>
#include <limits>

using namespace qn::video;
static int passed = 0, failed = 0;
#define CHECK(expr) do { if (expr) ++passed; else { ++failed; std::printf("FAIL line %d: %s\n", __LINE__, #expr); } } while (0)
static bool Near(float a, float b) { return std::fabs(a - b) < 0.0001f; }

int main() {
    CHECK(Near(ClampCurvature(0), kMinCurvature));
    CHECK(Near(ClampCurvature(20), kMaxCurvature));
    CHECK(Near(ClampCurvature(std::numeric_limits<float>::infinity()), kDefaultCurvature));
    CHECK(Near(ClampCurvature(std::numeric_limits<float>::quiet_NaN()), kDefaultCurvature));
    const auto def = ScreenCylinderParams("mono2d", 1920, 1080, 0.6f, 1);
    CHECK(Near(def.radius, 3));
    CHECK(Near(def.centralAngle, 1.2f));
    CHECK(Near(def.aspectRatio, 16.0f / 9));
    CHECK(Near(def.centerForwardOffset, 0));
    for (float scale : {kMinScreenScale, kDefaultScreenScale, kMaxScreenScale}) {
        for (float curve : {kMinCurvature, kDefaultCurvature, kMaxCurvature}) {
            const auto c = ScreenCylinderParams("mono2d", 1920, 1080, scale, curve);
            CHECK(c.radius > 0 && c.centralAngle > 0 && c.centralAngle <= kMaxCylinderAngle);
            CHECK(Near(c.radius * c.centralAngle, kScreenBaseWidth * scale));
            CHECK(Near(c.centerForwardOffset + c.radius, kScreenDistance));
        }
    }
    const auto capped = ScreenCylinderParams("mono2d", 1920, 1080, 3, 1.5f);
    CHECK(Near(capped.centralAngle, kMaxCylinderAngle));
    CHECK(Near(ScreenCylinderParams("mono2d", 0, 0, -1, 1).centralAngle, 0.3f));
    CHECK(Near(ScreenCylinderParams("mono2d", 0, 0, std::numeric_limits<float>::quiet_NaN(), 1).centralAngle, 1.2f));

    Placement p;
    p.anchor = {1, 2, 3};
    p.yaw = 0.7f;
    const XrSpace space = reinterpret_cast<XrSpace>(1);
    const XrSwapchain sc = reinterpret_cast<XrSwapchain>(2);
    XrCompositionLayerQuad q[2]{};
    XrCompositionLayerCylinderKHR c[2]{};
    XrCompositionLayerEquirect2KHR e[2]{};
    bool sphere = false;
    for (const char* name : {"mono2d", "sbsScreenFull", "sbsScreenHalf", "tbScreen"}) {
        for (bool swap : {false, true}) {
            const auto* layout = FindLayout(name);
            const int expected = layout->stereo == Stereo::kMono ? 1 : 2;
            CHECK(BuildLayers(name, 3840, 2160, swap, p, space, sc, q, e, &sphere) == expected);
            CHECK(!sphere);
            CHECK(Near(q[0].size.width, 3.6f));
            CHECK(Near(q[0].pose.position.x, p.anchor.x - 3 * std::sin(p.yaw)));
            CHECK(Near(q[0].pose.position.z, p.anchor.z - 3 * std::cos(p.yaw)));
            CHECK(BuildLayers(name, 3840, 2160, swap, p, space, sc, q, e, &sphere, c, 0.2f) == expected);
            CHECK(!sphere);
            for (int i = 0; i < expected; ++i) {
                CHECK(c[i].type == XR_TYPE_COMPOSITION_LAYER_CYLINDER_KHR);
                CHECK(c[i].space == space && c[i].subImage.swapchain == sc);
                CHECK(c[i].eyeVisibility == q[i].eyeVisibility);
                CHECK(c[i].subImage.imageRect.offset.x == q[i].subImage.imageRect.offset.x);
                CHECK(c[i].subImage.imageRect.offset.y == q[i].subImage.imageRect.offset.y);
                CHECK(c[i].subImage.imageRect.extent.width == q[i].subImage.imageRect.extent.width);
                CHECK(c[i].subImage.imageRect.extent.height == q[i].subImage.imageRect.extent.height);
                CHECK(Near(c[i].radius * c[i].centralAngle, q[i].size.width));
                CHECK(Near(c[i].radius * c[i].centralAngle / c[i].aspectRatio, q[i].size.height));
                CHECK(Near(c[i].pose.position.x - c[i].radius * std::sin(p.yaw), q[i].pose.position.x));
                CHECK(Near(c[i].pose.position.z - c[i].radius * std::cos(p.yaw), q[i].pose.position.z));
                CHECK(Near(c[i].pose.orientation.y, q[i].pose.orientation.y));
                CHECK(Near(c[i].pose.position.y, p.anchor.y));
            }
        }
    }
    CHECK(Near((float)EyeAspect("sbsScreenFull", 3840, 1080), 16.0f / 9));
    CHECK(Near((float)EyeAspect("sbsScreenHalf", 1920, 1080), 16.0f / 9));
    CHECK(Near((float)EyeAspect("tbScreen", 1920, 2160), 16.0f / 9));
    CHECK(Near((float)EyeAspect("tbScreen", 1920, 1080), 16.0f / 9));
    for (const char* name : {"mono180", "mono360", "sbs180", "sbs360", "tb360"}) {
        XrCompositionLayerEquirect2KHR before[2]{};
        int n = BuildLayers(name, 3840, 2160, true, p, space, sc, q, before, &sphere);
        CHECK(n > 0 && sphere);
        CHECK(BuildLayers(name, 3840, 2160, true, p, space, sc, q, e, &sphere, c, 1.5f) == n);
        for (int i = 0; i < n; ++i) {
            CHECK(e[i].centralHorizontalAngle == before[i].centralHorizontalAngle);
            CHECK(e[i].subImage.imageRect.offset.x == before[i].subImage.imageRect.offset.x);
            CHECK(e[i].subImage.imageRect.offset.y == before[i].subImage.imageRect.offset.y);
            CHECK(e[i].radius == 0 && e[i].pose.position.x == p.anchor.x);
        }
    }
    CHECK(BuildLayers("unknown", 1920, 1080, false, p, space, sc, q, e, &sphere, c) == 0);
    CHECK(BuildLayers("mono2d", 0, 1080, false, p, space, sc, q, e, &sphere, c) == 0);
    CHECK(BuildLayers("mono2d", 1920, 1080, false, p, space, XR_NULL_HANDLE, q, e, &sphere, c) == 0);
    std::printf("%d passed, %d failed\n", passed, failed);
    return failed ? 1 : 0;
}

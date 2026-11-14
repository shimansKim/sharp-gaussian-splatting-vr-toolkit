// Pure logic of the image viewer (no Android, OpenXR or Vulkan), so it builds and runs on a PC for
// unit tests (tests/run_tests.bat). Owner: image-dev.
// Ported from the web app (quest-app/src/viewers/media/format-detect.js, layers-path.js,
// zoom-memory.js, layout-memory.js, core/slideshow.js, core/input-map.js createFlick).
#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace qn {
namespace image {

// ------------------------------------------------------------------ layouts

// Same names as quest-app MediaLayout (OpenRequest.layoutHint uses these ids).
enum class Layout : int {
    kMono2d = 0,
    kMono360,
    kTb360,
    kSbs360,
    kSbs180,
    kMono180,
    kSbsScreenFull,
    kSbsScreenHalf,
    kTbScreen,
    kCount
};

enum class Shape { kScreen, kSphere360, kSphere180 };
enum class Stereo { kMono, kSbs, kTb };

struct LayoutInfo {
    const char* id;          // "sbs180"
    const char* label;       // Korean, for the UI
    const char* shortLabel;  // Korean/ASCII short form
    Shape shape;
    Stereo stereo;
};

const LayoutInfo& Info(Layout layout);
const char* LayoutId(Layout layout);
// Returns false when `id` is not a layout id.
bool ParseLayout(const std::string& id, Layout* out);
// Order used when cycling layouts in the panel (same as LAYOUT_ORDER).
const std::vector<Layout>& LayoutOrder();
Layout CycleLayout(Layout current, int direction);

// ------------------------------------------------------------------ detection

struct NameHints {
    enum Projection { kNone, k360, k180 } projection = kNone;
    enum StereoHint { kUnknown, kHintMono, kHintSbs, kHintTb } stereo = kUnknown;
    bool half = false, full = false;
    std::vector<std::string> hints;
};
NameHints ParseNameHints(const std::string& name);

enum class Confidence { kLow, kMedium, kHigh };
struct Detection {
    Layout layout = Layout::kMono2d;
    Confidence confidence = Confidence::kLow;
    std::vector<std::string> reasons;
};
// Photos have no MP4 spatial metadata: name hints first, then the aspect ratio.
Detection DetectLayout(const std::string& name, int width, int height);

struct Sniff {
    enum Result { kUndecided, kMono, kSbs, kTb } result = kUndecided;
    double sbs = 0, tb = 0;
};
// luma: width*height bytes (0..255). Same algorithm and threshold (0.8) as sniffStereo().
Sniff SniffStereo(const uint8_t* luma, int width, int height);
// Only changes a low-confidence detection (ratio guess), like refineDetectionWithSniff().
Detection RefineWithSniff(const Detection& detected, const Sniff& sniff, double ratio);

// ------------------------------------------------------------------ geometry

struct RectI {
    int x = 0, y = 0, w = 0, h = 0;
};

// Width / height of what one eye sees on a flat screen (eyeAspect()).
double EyeAspect(Layout layout, int width, int height);
// Pixel rect of one eye (0 = left, 1 = right) inside an image of width x height, origin top-left.
// SBS: left half is the left eye. TB: top half is the left eye.
RectI EyeRect(Layout layout, int eye, int width, int height);
// Centre 1/zoom of `r` (zoom >= 1), like zoomRegion().
RectI ZoomRect(const RectI& r, double zoom);

// Virtual screen and zoom constants (projections.js).
constexpr double kScreenDistance = 3.0;   // m
constexpr double kScreenBaseWidth = 6.0;  // m at scale 1
constexpr double kDefaultScreenScale = 0.6;
constexpr double kMinScreenScale = 0.15;
constexpr double kMaxScreenScale = 3.0;
constexpr double kDefaultSphereZoom = 1.0;
constexpr double kMaxSphereZoom = 4.0;
constexpr double kMaxTurnPitch = 80.0 * 3.14159265358979323846 / 180.0;
constexpr double kTurnSpeed = 1.4;   // rad/s at full stick
constexpr double kZoomRate = 0.9;    // zoom *= exp(stick * rate * dt)

double ClampScreenScale(double v);
double ClampSphereZoom(double v);
// "100%" = default size (screen) or no magnification (sphere), like zoomLabel().
std::string ZoomLabel(bool screen, double value);

// Quad size in metres of one eye's picture for a screen layout.
struct QuadSize {
    double width = 0, height = 0;
};
QuadSize ScreenQuadSize(Layout layout, int srcW, int srcH, double screenScale);

// Curved screen (XR_KHR_composition_layer_cylinder) geometry and curvature constants.
enum class ScreenShape : int { kFlat = 0, kCurved = 1 };

constexpr double kDefaultCurvature = 1.0;  // 1.0 -> cylinder radius equals kScreenDistance
constexpr double kMinCurvature = 0.2;
constexpr double kMaxCurvature = 1.5;
constexpr double kMaxCylinderAngle = 1.5 * 3.14159265358979323846;

double ClampCurvature(double v);

struct CylinderParams {
    double radius = kScreenDistance;    // cylinder radius in metres (> 0)
    double centralAngle = 0.0;          // horizontal arc angle in radians, (0, kMaxCylinderAngle]
    double aspectRatio = 16.0 / 9.0;    // arcWidth / height
    double centerForwardOffset = 0.0;   // kScreenDistance - radius along forward (-Z) from anchor
};
CylinderParams ScreenCylinderParams(Layout layout, int srcW, int srcH, double screenScale, double curvature);

// ------------------------------------------------------------------ decode size

// Pixels per degree we aim for. Quest 3 shows about 25 ppd in the centre; a little more gives the
// compositor's super-sampling filter something to work with without wasting memory.
constexpr double kTargetPpd = 28.0;

struct SizeLimits {
    int maxWidth = 8192;    // swapchain limit (xrGetSystemProperties), also capped by us
    int maxHeight = 8192;
    int64_t maxPixels = 8192LL * 4096LL;  // memory budget of one texture
};

struct SizeRequest {
    int srcW = 0, srcH = 0;   // the source area that will be decoded (whole image or a crop)
    Layout layout = Layout::kMono2d;
    double screenScale = kDefaultScreenScale;  // screen layouts
    double sphereZoom = 1.0;  // sphere layouts: magnification still applied on top of this area
    double ppd = kTargetPpd;
};

struct Size {
    int w = 0, h = 0;
};
// Size to decode `srcW x srcH` into: never upscales, keeps the aspect ratio, fits the limits.
Size TargetDecodeSize(const SizeRequest& request, const SizeLimits& limits);
// How many pixels wide the whole source area should be to look sharp (before limits).
double NeededWidth(const SizeRequest& request);

// Crop of the source used to sharpen a magnified mono sphere (360/180 mono only): centre 1/zoom.
// Returns false when no crop should be used (zoom ~1, stereo layout, or screen).
bool SphereZoomCrop(Layout layout, int srcW, int srcH, double zoom, RectI* crop);

// ------------------------------------------------------------------ input helpers

// One stick axis as a "flick": fires once past `on`, again only after coming back under `off`.
class Flick {
public:
    explicit Flick(double on = 0.7, double off = 0.4, double cooldown = 0.35) : on_(on), off_(off), cooldown_(cooldown) {}
    // Returns -1, 0 or +1.
    int Update(double value, double dt);

private:
    double on_, off_, cooldown_;
    bool armed_ = true;
    double wait_ = 0;
};

// Right stick does one thing at a time: the larger axis wins (splitRightStick()).
std::pair<double, double> SplitStick(double x, double y);

// Holding a button longer than kHoldSeconds counts as "hold" instead of "press".
constexpr double kHoldSeconds = 0.8;

// ------------------------------------------------------------------ slideshow

class Slideshow {
public:
    static const std::vector<int>& Intervals();  // {3, 5, 10, 30}
    static constexpr int kDefaultInterval = 5;

    bool Running() const { return running_; }
    int Interval() const { return interval_; }
    void SetInterval(int seconds);  // snaps to the nearest allowed value
    int CycleInterval();            // next allowed value, wraps
    void Start() { running_ = true; elapsed_ = 0; }
    void Stop() { running_ = false; elapsed_ = 0; }
    void Toggle() { running_ ? Stop() : Start(); }
    // The current picture is visible: start counting from now.
    void OnShown() { shown_ = true; elapsed_ = 0; }
    // A new picture is loading: do not count until it shows.
    void OnLoading() { shown_ = false; elapsed_ = 0; }
    // Returns true when it is time to go to the next picture (then call OnLoading()).
    bool Tick(double dt);

private:
    bool running_ = false;
    bool shown_ = false;
    int interval_ = kDefaultInterval;
    double elapsed_ = 0;
};

// ------------------------------------------------------------------ memory

// Remembers the layout a person picked per item (most recent 500), like layout-memory.js.
class LayoutMemory {
public:
    static constexpr size_t kMaxEntries = 500;
    bool Recall(const std::string& key, Layout* out) const;
    void Remember(const std::string& key, Layout layout);
    void Forget(const std::string& key);
    size_t Size() const { return entries_.size(); }
    // One "key\tlayoutId" per line. Parse() skips broken lines.
    std::string Serialize() const;
    void Parse(const std::string& text);

private:
    std::vector<std::pair<std::string, Layout>> entries_;  // oldest first
};

// Natural, case-insensitive file name order ("img2" < "img10"), used for folder playlists.
bool NaturalLess(const std::string& a, const std::string& b);

// True for the photo extensions this viewer registers (case-insensitive).
bool IsImageName(const std::string& name);

}  // namespace image
}  // namespace qn

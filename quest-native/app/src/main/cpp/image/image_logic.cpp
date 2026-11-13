// Pure logic of the image viewer. See image_logic.h. Owner: image-dev.
#include "image/image_logic.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <sstream>

namespace qn {
namespace image {

namespace {

const LayoutInfo kInfos[] = {
    {"mono2d", "2D 일반 화면", "2D", Shape::kScreen, Stereo::kMono},
    {"mono360", "360° 모노", "360", Shape::kSphere360, Stereo::kMono},
    {"tb360", "360° 3D 위아래(TB)", "360 TB", Shape::kSphere360, Stereo::kTb},
    {"sbs360", "360° 3D 좌우(SBS)", "360 SBS", Shape::kSphere360, Stereo::kSbs},
    {"sbs180", "VR180 3D 좌우(SBS)", "VR180", Shape::kSphere180, Stereo::kSbs},
    {"mono180", "VR180 모노", "180", Shape::kSphere180, Stereo::kMono},
    {"sbsScreenFull", "3D 스크린 Full SBS", "SBS 스크린", Shape::kScreen, Stereo::kSbs},
    {"sbsScreenHalf", "3D 스크린 Half SBS", "HSBS 스크린", Shape::kScreen, Stereo::kSbs},
    {"tbScreen", "3D 스크린 위아래(TB)", "TB 스크린", Shape::kScreen, Stereo::kTb},
};
static_assert(sizeof(kInfos) / sizeof(kInfos[0]) == static_cast<size_t>(Layout::kCount), "layout table");

std::string Lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

bool Contains(const std::string& s, const char* part) { return s.find(part) != std::string::npos; }

// "half[-_ ]?sbs" style: a, optional separator, b.
bool ContainsJoined(const std::string& s, const char* a, const char* b) {
    const std::string sa(a), sb(b);
    for (const char* sep : {"", "-", "_", " "}) {
        if (Contains(s, (sa + sep + sb).c_str())) return true;
    }
    return false;
}

std::string Fixed2(double v) {
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%.2f", v);
    return buf;
}

Stereo StereoFromRatio360(double ratio) {
    if (ratio >= 3.2) return Stereo::kSbs;
    if (ratio <= 1.25) return Stereo::kTb;
    return Stereo::kMono;
}

}  // namespace

// ------------------------------------------------------------------ layouts

const LayoutInfo& Info(Layout layout) {
    int i = static_cast<int>(layout);
    if (i < 0 || i >= static_cast<int>(Layout::kCount)) i = 0;
    return kInfos[i];
}

const char* LayoutId(Layout layout) { return Info(layout).id; }

bool ParseLayout(const std::string& id, Layout* out) {
    for (int i = 0; i < static_cast<int>(Layout::kCount); ++i) {
        if (id == kInfos[i].id) {
            if (out) *out = static_cast<Layout>(i);
            return true;
        }
    }
    return false;
}

const std::vector<Layout>& LayoutOrder() {
    static const std::vector<Layout> order = {Layout::kSbs180,        Layout::kMono180,       Layout::kMono360,
                                              Layout::kTb360,         Layout::kSbs360,        Layout::kSbsScreenFull,
                                              Layout::kSbsScreenHalf, Layout::kTbScreen,      Layout::kMono2d};
    return order;
}

Layout CycleLayout(Layout current, int direction) {
    const auto& order = LayoutOrder();
    const int n = static_cast<int>(order.size());
    int idx = 0;
    for (int i = 0; i < n; ++i) {
        if (order[i] == current) idx = i;
    }
    int step = direction >= 0 ? 1 : -1;
    return order[((idx + step) % n + n) % n];
}

// ------------------------------------------------------------------ detection

NameHints ParseNameHints(const std::string& name) {
    // Only the file name, without extension, lower case, split into [a-z0-9]+ tokens.
    std::string file = name;
    size_t slash = file.find_last_of("/\\");
    if (slash != std::string::npos) file = file.substr(slash + 1);
    size_t dot = file.find_last_of('.');
    if (dot != std::string::npos && dot > 0) file = file.substr(0, dot);
    const std::string base = Lower(file);
    std::vector<std::string> tokens;
    std::string cur;
    for (char c : base) {
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
            cur += c;
        } else if (!cur.empty()) {
            tokens.push_back(cur);
            cur.clear();
        }
    }
    if (!cur.empty()) tokens.push_back(cur);
    auto has = [&](std::initializer_list<const char*> keys) {
        for (const char* k : keys) {
            if (std::find(tokens.begin(), tokens.end(), k) != tokens.end()) return true;
        }
        return false;
    };

    NameHints h;
    if (has({"360", "vr360", "equirect", "equirectangular", "spherical"}) || Contains(base, "vr360") ||
        Contains(base, "360vr")) {
        h.projection = NameHints::k360;
        h.hints.push_back("이름에 360");
    }
    if (has({"180", "vr180", "fisheye180"}) || Contains(base, "vr180")) {
        h.projection = NameHints::k180;
        h.hints.push_back("이름에 180");
    }

    if (has({"hsbs", "halfsbs"}) || ContainsJoined(base, "half", "sbs")) {
        h.stereo = NameHints::kHintSbs;
        h.half = true;
        h.hints.push_back("이름에 HSBS");
    } else if (has({"fsbs", "fullsbs"}) || ContainsJoined(base, "full", "sbs")) {
        h.stereo = NameHints::kHintSbs;
        h.full = true;
        h.hints.push_back("이름에 FSBS");
    } else if (has({"sbs", "lr", "3dh", "leftright", "sidebyside"}) ||
               [&] {
                   for (const char* s1 : {"", "-", "_", " "})
                       for (const char* s2 : {"", "-", "_", " "})
                           if (Contains(base, (std::string("side") + s1 + "by" + s2 + "side").c_str())) return true;
                   return false;
               }()) {
        h.stereo = NameHints::kHintSbs;
        h.hints.push_back("이름에 SBS/LR");
    } else if (has({"tb", "ou", "htb", "ftb", "3dv", "topbottom", "overunder"}) || ContainsJoined(base, "over", "under") ||
               ContainsJoined(base, "top", "bottom")) {
        h.stereo = NameHints::kHintTb;
        h.hints.push_back("이름에 TB/OU");
    } else if (has({"mono", "2d"})) {
        h.stereo = NameHints::kHintMono;
        h.hints.push_back("이름에 mono");
    }
    if (h.stereo == NameHints::kUnknown && has({"3d"})) h.hints.push_back("이름에 3D(좌우/위아래 불명)");
    return h;
}

Detection DetectLayout(const std::string& name, int width, int height) {
    const double ratio = width > 0 && height > 0 ? static_cast<double>(width) / height : 0.0;
    const NameHints nh = ParseNameHints(name);
    Detection d;
    d.reasons = nh.hints;
    auto done = [&](Layout layout, Confidence c, const std::string& extra = std::string()) {
        d.layout = layout;
        d.confidence = c;
        if (!extra.empty()) d.reasons.push_back(extra);
        return d;
    };

    if (nh.projection == NameHints::k360) {
        Stereo st;
        if (nh.stereo == NameHints::kHintMono) st = Stereo::kMono;
        else if (nh.stereo == NameHints::kHintSbs) st = Stereo::kSbs;
        else if (nh.stereo == NameHints::kHintTb) st = Stereo::kTb;
        else st = ratio > 0 ? StereoFromRatio360(ratio) : Stereo::kMono;
        Layout layout = st == Stereo::kSbs ? Layout::kSbs360 : st == Stereo::kTb ? Layout::kTb360 : Layout::kMono360;
        const bool strong = nh.stereo != NameHints::kUnknown || ratio == 0;
        return done(layout, strong ? Confidence::kHigh : Confidence::kMedium,
                    nh.stereo == NameHints::kUnknown && ratio > 0 ? "비율 " + Fixed2(ratio) + ":1로 입체 방식 추정" : "");
    }

    if (nh.projection == NameHints::k180) {
        // There is no TB 180 layout; pick by ratio.
        bool sbs;
        if (nh.stereo == NameHints::kUnknown || nh.stereo == NameHints::kHintTb) {
            if (ratio > 0 && ratio >= 1.6) sbs = true;
            else if (ratio > 0 && ratio <= 1.25) sbs = false;
            else sbs = nh.stereo != NameHints::kHintTb;
        } else {
            sbs = nh.stereo == NameHints::kHintSbs;
        }
        return done(sbs ? Layout::kSbs180 : Layout::kMono180, Confidence::kHigh);
    }

    if (nh.stereo == NameHints::kHintSbs) {
        if (nh.half) return done(Layout::kSbsScreenHalf, Confidence::kHigh);
        if (nh.full) return done(Layout::kSbsScreenFull, Confidence::kHigh);
        if (ratio >= 1.9 && ratio <= 2.15)
            return done(Layout::kSbs180, Confidence::kMedium, "SBS 이름 + 비율 " + Fixed2(ratio) + ":1 → VR180으로 추정");
        if (ratio >= 2.6)
            return done(Layout::kSbsScreenFull, Confidence::kMedium, "SBS 이름 + 비율 " + Fixed2(ratio) + ":1 → Full SBS");
        return done(Layout::kSbsScreenHalf, Confidence::kMedium,
                    ratio > 0 ? "SBS 이름 + 비율 " + Fixed2(ratio) + ":1 → Half SBS" : "");
    }
    if (nh.stereo == NameHints::kHintTb) {
        if (ratio >= 0.95 && ratio <= 1.1) return done(Layout::kTb360, Confidence::kMedium, "비율 1:1 → 360 TB로 추정");
        return done(Layout::kTbScreen, Confidence::kMedium);
    }
    if (nh.stereo == NameHints::kHintMono) {
        if (ratio >= 1.9 && ratio <= 2.15) return done(Layout::kMono360, Confidence::kMedium, "비율 2:1 → 360으로 추정");
        return done(Layout::kMono2d, Confidence::kMedium);
    }

    if (ratio == 0) return done(Layout::kMono2d, Confidence::kLow, "해상도 정보 없음");
    if (nh.hints.empty() && Contains(Lower(name), "3d")) d.reasons.push_back("이름에 3D");
    if (ratio >= 3.8 && ratio <= 4.2)
        return done(Layout::kSbs360, Confidence::kLow, "비율 " + Fixed2(ratio) + ":1 → 360 SBS로 추정");
    if (ratio >= 2.6)
        return done(Layout::kSbsScreenFull, Confidence::kLow, "비율 " + Fixed2(ratio) + ":1 → Full SBS 스크린으로 추정");
    if (ratio >= 1.9 && ratio <= 2.15)
        return done(Layout::kMono360, Confidence::kLow, "비율 2:1 → 360 모노로 추정(VR180이면 형식을 바꾸세요)");
    if (ratio >= 0.95 && ratio <= 1.05) return done(Layout::kTb360, Confidence::kLow, "비율 1:1 → 360 TB로 추정");
    return done(Layout::kMono2d, Confidence::kLow, "일반 비율 " + Fixed2(ratio) + ":1");
}

namespace {
struct Area {
    int x0, y0, w, h;
};

// Normalised correlation of two equal areas, row means removed, best over horizontal shifts.
double HalvesCorrelation(const uint8_t* luma, int width, const Area& a, const Area& b, int shift) {
    double best = -1;
    for (int s = -shift; s <= shift; ++s) {
        double sxy = 0, sxx = 0, syy = 0;
        for (int y = 0; y < a.h; ++y) {
            const int rowA = (a.y0 + y) * width + a.x0;
            const int rowB = (b.y0 + y) * width + b.x0;
            const int x0 = std::max(0, -s);
            const int x1 = std::min(a.w, a.w - s);
            if (x1 - x0 < 4) continue;
            double ma = 0, mb = 0;
            for (int x = x0; x < x1; ++x) {
                ma += luma[rowA + x];
                mb += luma[rowB + x + s];
            }
            ma /= (x1 - x0);
            mb /= (x1 - x0);
            for (int x = x0; x < x1; ++x) {
                const double da = luma[rowA + x] - ma;
                const double db = luma[rowB + x + s] - mb;
                sxy += da * db;
                sxx += da * da;
                syy += db * db;
            }
        }
        const double denom = std::sqrt(sxx * syy);
        if (denom > 0) best = std::max(best, sxy / denom);
    }
    return best;
}
}  // namespace

Sniff SniffStereo(const uint8_t* luma, int width, int height) {
    Sniff out;
    if (!luma || width < 16 || height < 16) return out;
    const int64_t n = static_cast<int64_t>(width) * height;
    double sum = 0, sumSq = 0;
    for (int64_t i = 0; i < n; ++i) {
        sum += luma[i];
        sumSq += static_cast<double>(luma[i]) * luma[i];
    }
    const double mean = sum / n;
    const double stdev = std::sqrt(std::max(0.0, sumSq / n - mean * mean));
    if (stdev < 6) return out;
    const int hw = width / 2, hh = height / 2;
    const int shiftX = std::max(2, static_cast<int>(std::lround(hw * 0.06)));
    out.sbs = HalvesCorrelation(luma, width, {0, 0, hw, height}, {hw, 0, hw, height}, shiftX);
    out.tb = HalvesCorrelation(luma, width, {0, 0, width, hh}, {0, hh, width, hh},
                               std::max(2, static_cast<int>(std::lround(width * 0.03))));
    const double kThreshold = 0.8;
    out.result = Sniff::kMono;
    if (out.sbs >= kThreshold && out.sbs >= out.tb + 0.05) out.result = Sniff::kSbs;
    else if (out.tb >= kThreshold && out.tb >= out.sbs + 0.05) out.result = Sniff::kTb;
    return out;
}

Detection RefineWithSniff(const Detection& detected, const Sniff& sniff, double ratio) {
    if (detected.confidence != Confidence::kLow || sniff.result == Sniff::kUndecided) return detected;
    Detection d = detected;
    if (d.layout == Layout::kMono360 && ratio >= 1.9 && ratio <= 2.15 && sniff.result == Sniff::kSbs) {
        d.layout = Layout::kSbs180;
        d.confidence = Confidence::kMedium;
        d.reasons.push_back("화면 내용을 보니 좌우 그림이 거의 같아 VR180 좌우(SBS)로 판단");
        return d;
    }
    if (d.layout == Layout::kTb360 && sniff.result == Sniff::kMono) {
        d.layout = Layout::kMono360;
        d.reasons.push_back("화면 내용을 보니 위아래 그림이 달라 360 모노로 판단");
        return d;
    }
    return detected;
}

// ------------------------------------------------------------------ geometry

double EyeAspect(Layout layout, int width, int height) {
    const double w = width > 0 ? width : 16;
    const double h = height > 0 ? height : 9;
    switch (layout) {
        case Layout::kSbsScreenFull:
            return w / 2 / h;
        case Layout::kTbScreen:
            // Taller than wide-ish (e.g. 1920x2160) is Full TB, otherwise Half TB.
            return w / h < 1.2 ? w / (h / 2) : w / h;
        default:
            return w / h;
    }
}

RectI EyeRect(Layout layout, int eye, int width, int height) {
    const Stereo st = Info(layout).stereo;
    if (st == Stereo::kSbs) {
        const int half = width / 2;
        return eye == 0 ? RectI{0, 0, half, height} : RectI{half, 0, width - half, height};
    }
    if (st == Stereo::kTb) {
        const int half = height / 2;
        return eye == 0 ? RectI{0, 0, width, half} : RectI{0, half, width, height - half};
    }
    return RectI{0, 0, width, height};
}

RectI ZoomRect(const RectI& r, double zoom) {
    const double z = std::max(1.0, zoom);
    const int w = std::max(1, static_cast<int>(std::lround(r.w / z)));
    const int h = std::max(1, static_cast<int>(std::lround(r.h / z)));
    return RectI{r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h};
}

double ClampScreenScale(double v) {
    if (!std::isfinite(v)) return kDefaultScreenScale;
    return std::min(kMaxScreenScale, std::max(kMinScreenScale, v));
}

double ClampSphereZoom(double v) {
    if (!std::isfinite(v)) return kDefaultSphereZoom;
    return std::min(kMaxSphereZoom, std::max(1.0, v));
}

std::string ZoomLabel(bool screen, double value) {
    const double base = screen ? kDefaultScreenScale : 1.0;
    return std::to_string(static_cast<int>(std::lround(value / base * 100))) + "%";
}

QuadSize ScreenQuadSize(Layout layout, int srcW, int srcH, double screenScale) {
    double aspect = EyeAspect(layout, srcW, srcH);
    if (!(aspect > 0)) aspect = 16.0 / 9.0;
    QuadSize q;
    q.width = kScreenBaseWidth * ClampScreenScale(screenScale);
    q.height = q.width / aspect;
    return q;
}

// ------------------------------------------------------------------ decode size

double NeededWidth(const SizeRequest& r) {
    const LayoutInfo& info = Info(r.layout);
    const double sbsFactor = info.stereo == Stereo::kSbs ? 2.0 : 1.0;
    if (info.shape == Shape::kScreen) {
        const double halfWidth = kScreenBaseWidth * ClampScreenScale(r.screenScale) / 2;
        const double degrees = 2 * std::atan(halfWidth / kScreenDistance) * 180.0 / 3.14159265358979323846;
        return degrees * r.ppd * sbsFactor;
    }
    const double span = info.shape == Shape::kSphere360 ? 360.0 : 180.0;
    return span * r.ppd * std::max(1.0, r.sphereZoom) * sbsFactor;
}

Size TargetDecodeSize(const SizeRequest& r, const SizeLimits& limits) {
    Size out;
    if (r.srcW <= 0 || r.srcH <= 0) return out;
    const double w = r.srcW, h = r.srcH;
    double s = std::min(1.0, NeededWidth(r) / w);
    if (limits.maxWidth > 0) s = std::min(s, limits.maxWidth / w);
    if (limits.maxHeight > 0) s = std::min(s, limits.maxHeight / h);
    if (limits.maxPixels > 0) s = std::min(s, std::sqrt(static_cast<double>(limits.maxPixels) / (w * h)));
    out.w = std::max(1, static_cast<int>(std::floor(w * s + 1e-6)));
    out.h = std::max(1, static_cast<int>(std::floor(h * s + 1e-6)));
    // Keep stereo halves exact: even width (SBS) / even height (TB).
    const Stereo st = Info(r.layout).stereo;
    if (st == Stereo::kSbs && out.w > 1) out.w &= ~1;
    if (st == Stereo::kTb && out.h > 1) out.h &= ~1;
    return out;
}

bool SphereZoomCrop(Layout layout, int srcW, int srcH, double zoom, RectI* crop) {
    const LayoutInfo& info = Info(layout);
    if (info.shape == Shape::kScreen || info.stereo != Stereo::kMono) return false;
    if (zoom < 1.05 || srcW <= 0 || srcH <= 0) return false;
    if (crop) *crop = ZoomRect(RectI{0, 0, srcW, srcH}, zoom);
    return true;
}

// ------------------------------------------------------------------ input helpers

int Flick::Update(double value, double dt) {
    if (wait_ > 0) wait_ = std::max(0.0, wait_ - dt);
    const double a = std::fabs(value);
    if (!armed_) {
        if (a < off_) armed_ = true;
        return 0;
    }
    if (a > on_ && wait_ == 0) {
        armed_ = false;
        wait_ = cooldown_;
        return value > 0 ? 1 : -1;
    }
    return 0;
}

std::pair<double, double> SplitStick(double x, double y) {
    return std::fabs(x) > std::fabs(y) ? std::make_pair(x, 0.0) : std::make_pair(0.0, y);
}

// ------------------------------------------------------------------ slideshow

const std::vector<int>& Slideshow::Intervals() {
    static const std::vector<int> v = {3, 5, 10, 30};
    return v;
}

void Slideshow::SetInterval(int seconds) {
    const auto& v = Intervals();
    int best = v[0];
    for (int x : v) {
        if (std::abs(x - seconds) < std::abs(best - seconds)) best = x;
    }
    interval_ = best;
}

int Slideshow::CycleInterval() {
    const auto& v = Intervals();
    size_t i = 0;
    while (i < v.size() && v[i] != interval_) ++i;
    interval_ = v[(i + 1) % v.size()];
    return interval_;
}

bool Slideshow::Tick(double dt) {
    if (!running_ || !shown_) return false;
    elapsed_ += dt;
    if (elapsed_ >= interval_) {
        elapsed_ = 0;
        shown_ = false;
        return true;
    }
    return false;
}

// ------------------------------------------------------------------ memory

bool LayoutMemory::Recall(const std::string& key, Layout* out) const {
    for (auto it = entries_.rbegin(); it != entries_.rend(); ++it) {
        if (it->first == key) {
            if (out) *out = it->second;
            return true;
        }
    }
    return false;
}

void LayoutMemory::Remember(const std::string& key, Layout layout) {
    if (key.empty()) return;
    Forget(key);
    entries_.emplace_back(key, layout);
    if (entries_.size() > kMaxEntries) entries_.erase(entries_.begin(), entries_.end() - kMaxEntries);
}

void LayoutMemory::Forget(const std::string& key) {
    entries_.erase(std::remove_if(entries_.begin(), entries_.end(), [&](const auto& e) { return e.first == key; }),
                   entries_.end());
}

std::string LayoutMemory::Serialize() const {
    std::string out;
    for (const auto& e : entries_) {
        out += e.first;
        out += '\t';
        out += LayoutId(e.second);
        out += '\n';
    }
    return out;
}

void LayoutMemory::Parse(const std::string& text) {
    entries_.clear();
    std::istringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        size_t tab = line.rfind('\t');
        if (tab == std::string::npos || tab == 0) continue;
        Layout layout;
        if (!ParseLayout(line.substr(tab + 1), &layout)) continue;
        Remember(line.substr(0, tab), layout);
    }
}

bool NaturalLess(const std::string& a, const std::string& b) {
    size_t i = 0, j = 0;
    while (i < a.size() && j < b.size()) {
        const unsigned char ca = a[i], cb = b[j];
        if (std::isdigit(ca) && std::isdigit(cb)) {
            size_t i2 = i, j2 = j;
            while (i2 < a.size() && a[i2] == '0') ++i2;
            while (j2 < b.size() && b[j2] == '0') ++j2;
            size_t ie = i2, je = j2;
            while (ie < a.size() && std::isdigit(static_cast<unsigned char>(a[ie]))) ++ie;
            while (je < b.size() && std::isdigit(static_cast<unsigned char>(b[je]))) ++je;
            const size_t la = ie - i2, lb = je - j2;
            if (la != lb) return la < lb;
            const int c = a.compare(i2, la, b, j2, lb);
            if (c != 0) return c < 0;
            i = ie;
            j = je;
            continue;
        }
        const int la = std::tolower(ca), lb = std::tolower(cb);
        if (la != lb) return la < lb;
        ++i;
        ++j;
    }
    if (a.size() - i != b.size() - j) return a.size() - i < b.size() - j;
    return a < b;  // stable tie-break (case)
}

bool IsImageName(const std::string& name) {
    const std::string n = Lower(name);
    for (const char* ext : {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".gif", ".bmp"}) {
        const size_t len = std::char_traits<char>::length(ext);
        if (n.size() > len && n.compare(n.size() - len, len, ext) == 0) return true;
    }
    return false;
}

}  // namespace image
}  // namespace qn

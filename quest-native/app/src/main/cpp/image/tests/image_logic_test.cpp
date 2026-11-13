// PC unit tests for image_logic.cpp (no Android). Run tests\run_tests.bat. Owner: image-dev.
// Cases mirror quest-app/tests (format-detect) where the rules were ported.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "image/image_logic.h"

using namespace qn::image;

static int g_failed = 0, g_passed = 0;

#define CHECK(cond)                                                              \
    do {                                                                         \
        if (cond) {                                                              \
            ++g_passed;                                                          \
        } else {                                                                 \
            ++g_failed;                                                          \
            std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);          \
        }                                                                        \
    } while (0)

static void ExpectLayout(const char* name, int w, int h, const char* want) {
    const Detection d = DetectLayout(name, w, h);
    if (std::string(LayoutId(d.layout)) == want) {
        ++g_passed;
    } else {
        ++g_failed;
        std::printf("FAIL detect(%s, %dx%d) = %s, want %s\n", name, w, h, LayoutId(d.layout), want);
    }
}

static void TestDetect() {
    // Name hints.
    ExpectLayout("trip_360.jpg", 8000, 4000, "mono360");
    ExpectLayout("trip_360_tb.jpg", 5760, 5760, "tb360");
    ExpectLayout("trip_360.jpg", 5760, 5760, "tb360");         // ratio 1:1 -> TB
    ExpectLayout("trip_360.jpg", 11520, 2880, "sbs360");       // ratio 4:1 -> SBS
    ExpectLayout("park_vr180.jpg", 8640, 4320, "sbs180");
    ExpectLayout("park_180.jpg", 4320, 4320, "mono180");       // 1:1 -> mono 180
    ExpectLayout("park_180_mono.jpg", 8640, 4320, "mono180");
    ExpectLayout("movie_hsbs.png", 1920, 1080, "sbsScreenHalf");
    ExpectLayout("movie_half-sbs.png", 1920, 1080, "sbsScreenHalf");
    ExpectLayout("movie_fsbs.png", 3840, 1080, "sbsScreenFull");
    ExpectLayout("movie_sbs.png", 3840, 1080, "sbsScreenFull");
    ExpectLayout("movie_sbs.png", 3840, 1920, "sbs180");       // SBS + 2:1 -> VR180
    ExpectLayout("movie_LR.png", 1920, 1080, "sbsScreenHalf");
    ExpectLayout("movie_side_by_side.png", 1920, 1080, "sbsScreenHalf");
    ExpectLayout("movie_ou.png", 1920, 2160, "tbScreen");
    ExpectLayout("movie_tb.png", 4096, 4096, "tb360");
    ExpectLayout("movie_2d.png", 4096, 2048, "mono360");
    ExpectLayout("movie_mono.png", 1920, 1080, "mono2d");
    // Ratio only.
    ExpectLayout("IMG_0001.jpg", 4032, 3024, "mono2d");
    ExpectLayout("IMG_0001.jpg", 8192, 4096, "mono360");
    ExpectLayout("IMG_0001.jpg", 8192, 2048, "sbs360");
    ExpectLayout("IMG_0001.jpg", 4096, 4096, "tb360");
    ExpectLayout("IMG_0001.jpg", 3840, 1080, "sbsScreenFull");
    ExpectLayout("IMG_0001.jpg", 0, 0, "mono2d");
    // Token rules: "360" inside a word is not a hint, path parts are ignored.
    ExpectLayout("/sdcard/360/IMG_7360x.jpg", 4032, 3024, "mono2d");
    ExpectLayout("C:\\vr180\\photo.JPG", 4032, 3024, "mono2d");

    CHECK(DetectLayout("IMG.jpg", 8192, 4096).confidence == Confidence::kLow);
    CHECK(DetectLayout("x_360.jpg", 8192, 4096).confidence == Confidence::kMedium);
    CHECK(DetectLayout("x_vr180.jpg", 8192, 4096).confidence == Confidence::kHigh);
    CHECK(!DetectLayout("IMG.jpg", 8192, 4096).reasons.empty());
}

static void TestLayouts() {
    Layout l;
    CHECK(ParseLayout("sbsScreenHalf", &l) && l == Layout::kSbsScreenHalf);
    CHECK(!ParseLayout("sbs", &l));
    CHECK(CycleLayout(Layout::kSbs180, 1) == Layout::kMono180);
    CHECK(CycleLayout(Layout::kSbs180, -1) == Layout::kMono2d);
    CHECK(CycleLayout(Layout::kMono2d, 1) == Layout::kSbs180);
    CHECK(LayoutOrder().size() == static_cast<size_t>(Layout::kCount));
    for (int i = 0; i < static_cast<int>(Layout::kCount); ++i) {
        Layout back;
        CHECK(ParseLayout(LayoutId(static_cast<Layout>(i)), &back) && back == static_cast<Layout>(i));
    }
}

static void TestGeometry() {
    CHECK(std::fabs(EyeAspect(Layout::kSbsScreenFull, 3840, 1080) - 1920.0 / 1080) < 1e-9);
    CHECK(std::fabs(EyeAspect(Layout::kSbsScreenHalf, 1920, 1080) - 1920.0 / 1080) < 1e-9);
    CHECK(std::fabs(EyeAspect(Layout::kTbScreen, 1920, 2160) - 1920.0 / 1080) < 1e-9);  // full TB
    CHECK(std::fabs(EyeAspect(Layout::kTbScreen, 1920, 1080) - 1920.0 / 1080) < 1e-9);  // half TB

    RectI l = EyeRect(Layout::kSbs180, 0, 8000, 4000), r = EyeRect(Layout::kSbs180, 1, 8000, 4000);
    CHECK(l.x == 0 && l.w == 4000 && r.x == 4000 && r.w == 4000 && l.h == 4000);
    RectI t = EyeRect(Layout::kTb360, 0, 4096, 4096), b = EyeRect(Layout::kTb360, 1, 4096, 4096);
    CHECK(t.y == 0 && t.h == 2048 && b.y == 2048 && b.h == 2048 && t.w == 4096);
    RectI odd = EyeRect(Layout::kSbsScreenFull, 1, 3841, 1080);
    CHECK(odd.x == 1920 && odd.w == 1921);  // right eye keeps the odd pixel
    RectI m = EyeRect(Layout::kMono360, 1, 100, 50);
    CHECK(m.x == 0 && m.w == 100);

    RectI z = ZoomRect(RectI{0, 0, 8000, 4000}, 2);
    CHECK(z.x == 2000 && z.y == 1000 && z.w == 4000 && z.h == 2000);
    RectI z1 = ZoomRect(RectI{10, 20, 100, 50}, 0.5);  // < 1 means no zoom
    CHECK(z1.x == 10 && z1.w == 100);

    QuadSize q = ScreenQuadSize(Layout::kMono2d, 1920, 1080, kDefaultScreenScale);
    CHECK(std::fabs(q.width - 3.6) < 1e-9 && std::fabs(q.height - 3.6 * 1080 / 1920) < 1e-9);
    CHECK(ScreenQuadSize(Layout::kMono2d, 1920, 1080, 100).width == kScreenBaseWidth * kMaxScreenScale);

    CHECK(ClampSphereZoom(0.3) == 1.0 && ClampSphereZoom(9) == kMaxSphereZoom);
    CHECK(ClampScreenScale(NAN) == kDefaultScreenScale);
    CHECK(ZoomLabel(true, kDefaultScreenScale) == "100%");
    CHECK(ZoomLabel(false, 2) == "200%");
}

static void TestDecodeSize() {
    SizeLimits lim;  // 8192 x 8192, 32 Mpx
    // 2D photo on the default screen (~62°): ~1740 px wide is enough; never upscale.
    SizeRequest r;
    r.srcW = 4032;
    r.srcH = 3024;
    r.layout = Layout::kMono2d;
    Size s = TargetDecodeSize(r, lim);
    CHECK(s.w > 1500 && s.w < 2000);
    CHECK(std::abs(s.w * 3024 - s.h * 4032) < 4032);  // aspect kept
    r.srcW = 800;
    r.srcH = 600;
    s = TargetDecodeSize(r, lim);
    CHECK(s.w == 800 && s.h == 600);

    // Bigger screen asks for more pixels.
    r.srcW = 8000;
    r.srcH = 6000;
    Size small = TargetDecodeSize(r, lim);
    r.screenScale = 2.0;
    Size big = TargetDecodeSize(r, lim);
    CHECK(big.w > small.w * 1.5);

    // 360 mono 12K: limited by the 8192 side.
    SizeRequest p;
    p.srcW = 11968;
    p.srcH = 5984;
    p.layout = Layout::kMono360;
    s = TargetDecodeSize(p, lim);
    CHECK(s.w == 8192 && s.h == 4096);
    // Pixel budget.
    SizeLimits tight = lim;
    tight.maxPixels = 4096LL * 2048;
    s = TargetDecodeSize(p, tight);
    CHECK(static_cast<long long>(s.w) * s.h <= tight.maxPixels && s.w >= 4090);

    // SBS keeps an even width so both eyes get the same pixels.
    SizeRequest sbs;
    sbs.srcW = 7681;
    sbs.srcH = 3840;
    sbs.layout = Layout::kSbs180;
    s = TargetDecodeSize(sbs, lim);
    CHECK(s.w % 2 == 0);

    // Zoom crop for mono spheres only.
    RectI crop;
    CHECK(SphereZoomCrop(Layout::kMono360, 11968, 5984, 2.0, &crop) && crop.w == 5984 && crop.x == 2992);
    CHECK(!SphereZoomCrop(Layout::kSbs360, 11968, 5984, 2.0, &crop));
    CHECK(!SphereZoomCrop(Layout::kMono2d, 11968, 5984, 2.0, &crop));
    CHECK(!SphereZoomCrop(Layout::kMono360, 11968, 5984, 1.01, &crop));
    // The crop shown over the full sphere wants the same density as an unzoomed whole picture.
    SizeRequest c;
    c.srcW = crop.w;
    c.srcH = crop.h;
    c.layout = Layout::kMono360;
    CHECK(std::fabs(NeededWidth(c) - 360 * kTargetPpd) < 1e-6);

    CHECK(TargetDecodeSize(SizeRequest{}, lim).w == 0);
}

static void TestSniff() {
    const int w = 128, h = 64;
    std::vector<uint8_t> sbs(w * h), tb(w * h), mono(w * h), flat(w * h, 128);
    unsigned seed = 1;
    auto rnd = [&] { seed = seed * 1103515245u + 12345u; return static_cast<uint8_t>((seed >> 16) & 0xff); };
    std::vector<uint8_t> half(64 * 64);
    for (auto& v : half) v = rnd();
    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) {
            sbs[y * w + x] = half[y * 64 + (x % 64)];
            mono[y * w + x] = rnd();
        }
    std::vector<uint8_t> halfTb(128 * 32);
    for (auto& v : halfTb) v = rnd();
    for (int y = 0; y < h; ++y)
        for (int x = 0; x < w; ++x) tb[y * w + x] = halfTb[(y % 32) * 128 + x];
    CHECK(SniffStereo(sbs.data(), w, h).result == Sniff::kSbs);
    CHECK(SniffStereo(tb.data(), w, h).result == Sniff::kTb);
    CHECK(SniffStereo(mono.data(), w, h).result == Sniff::kMono);
    CHECK(SniffStereo(flat.data(), w, h).result == Sniff::kUndecided);
    CHECK(SniffStereo(nullptr, w, h).result == Sniff::kUndecided);

    // Refinement: 2:1 ratio guess + identical halves -> VR180 SBS.
    Detection low = DetectLayout("IMG.jpg", 8192, 4096);
    Sniff s;
    s.result = Sniff::kSbs;
    CHECK(RefineWithSniff(low, s, 2.0).layout == Layout::kSbs180);
    Detection named = DetectLayout("x_360.jpg", 8192, 4096);
    CHECK(RefineWithSniff(named, s, 2.0).layout == Layout::kMono360);  // not low confidence: untouched
    Detection square = DetectLayout("IMG.jpg", 4096, 4096);
    s.result = Sniff::kMono;
    CHECK(RefineWithSniff(square, s, 1.0).layout == Layout::kMono360);
}

static void TestInputHelpers() {
    Flick f;
    CHECK(f.Update(0.8, 0.016) == 1);
    CHECK(f.Update(0.9, 0.016) == 0);  // still held
    CHECK(f.Update(0.5, 0.016) == 0);  // not back under 0.4
    CHECK(f.Update(0.1, 0.016) == 0);  // re-armed, cooldown still running
    CHECK(f.Update(-0.8, 0.016) == 0); // cooldown 0.35 s
    f.Update(0.0, 0.5);
    CHECK(f.Update(-0.8, 0.016) == -1);

    auto a = SplitStick(0.6, 0.5);
    CHECK(a.first == 0.6 && a.second == 0.0);
    auto b = SplitStick(0.5, -0.5);
    CHECK(b.first == 0.0 && b.second == -0.5);
}

static void TestSlideshow() {
    Slideshow s;
    CHECK(!s.Running() && s.Interval() == 5);
    s.Start();
    CHECK(!s.Tick(10));  // nothing shown yet
    s.OnShown();
    CHECK(!s.Tick(4.9));
    CHECK(s.Tick(0.2));
    CHECK(!s.Tick(10));  // waits for the next OnShown
    s.OnShown();
    s.SetInterval(8);
    CHECK(s.Interval() == 10);
    CHECK(s.CycleInterval() == 30 && s.CycleInterval() == 3);
    s.Stop();
    s.OnShown();
    CHECK(!s.Tick(100));
}

static void TestMemoryAndNames() {
    LayoutMemory m;
    m.Remember("device:file:///a.jpg", Layout::kSbs180);
    m.Remember("device:file:///b.jpg", Layout::kTb360);
    m.Remember("device:file:///a.jpg", Layout::kMono2d);
    Layout l;
    CHECK(m.Recall("device:file:///a.jpg", &l) && l == Layout::kMono2d);
    CHECK(m.Size() == 2);
    LayoutMemory copy;
    copy.Parse(m.Serialize() + "broken line\nkey\tnotALayout\n");
    CHECK(copy.Size() == 2 && copy.Recall("device:file:///b.jpg", &l) && l == Layout::kTb360);
    for (int i = 0; i < 600; ++i) m.Remember("k" + std::to_string(i), Layout::kMono360);
    CHECK(m.Size() == LayoutMemory::kMaxEntries);
    CHECK(!m.Recall("k0", &l) && m.Recall("k599", &l));

    CHECK(NaturalLess("img2.jpg", "img10.jpg"));
    CHECK(!NaturalLess("img10.jpg", "img2.jpg"));
    CHECK(NaturalLess("a.jpg", "B.jpg"));
    CHECK(NaturalLess("img02.jpg", "img3.jpg"));
    CHECK(NaturalLess("img.jpg", "img1.jpg"));

    CHECK(IsImageName("A.JPG") && IsImageName("x.heic") && IsImageName("y.avif"));
    CHECK(!IsImageName("clip.mp4") && !IsImageName("jpg") && !IsImageName("scene.ply"));
}

int main() {
    TestDetect();
    TestLayouts();
    TestGeometry();
    TestDecodeSize();
    TestSniff();
    TestInputHelpers();
    TestSlideshow();
    TestMemoryAndNames();
    std::printf("%d passed, %d failed\n", g_passed, g_failed);
    return g_failed ? 1 : 0;
}

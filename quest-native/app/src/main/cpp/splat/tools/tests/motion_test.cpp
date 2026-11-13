// scene_motion unit tests (no GPU). Mirrors quest-app tests/splat-math.test.js and splat-motion.test.js.
#include <cmath>
#include <cstdio>
#include <vector>

#include "scene_motion.h"

using namespace qnsplat;

static int g_fail = 0;
#define NEAR(a, b, tol)                                                                                       \
    do {                                                                                                      \
        const double _a = (a), _b = (b);                                                                      \
        if (std::fabs(_a - _b) > (tol)) {                                                                     \
            std::printf("FAIL %s:%d  %s = %.6f, expected %.6f\n", __FILE__, __LINE__, #a, _a, _b);           \
            ++g_fail;                                                                                         \
        }                                                                                                     \
    } while (0)
#define TRUE_(c)                                                                  \
    do {                                                                          \
        if (!(c)) {                                                               \
            std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c);              \
            ++g_fail;                                                             \
        }                                                                         \
    } while (0)

static Quat yaw_q(float a) { return {0, std::sin(a / 2), 0, std::cos(a / 2)}; }
static const float kPi = 3.14159265f;

static void test_rotate_and_heading() {
    const Vec3 v = rotate_y({1, 0, 0}, kPi / 2);  // +x -> -z
    NEAR(v.x, 0, 1e-6);
    NEAR(v.z, -1, 1e-6);
    float h = 0;
    TRUE_(heading_of(yaw_q(0.7f), &h));
    NEAR(h, 0.7, 1e-5);
    // looking straight down: no heading
    const float a = -kPi / 2;
    TRUE_(!heading_of({std::sin(a / 2), 0, 0, std::cos(a / 2)}, &h));
    NEAR(yaw_of_quaternion(yaw_q(-2.0f)), -2.0, 1e-5);
    // matrix and apply agree
    Anchor an{{1, 2, 3}, 0.4f, 2.0f};
    const Mat4 m = anchor_matrix(an);
    const Vec3 p = transform_point(m, {0.3f, -0.2f, 0.5f});
    const Vec3 q = anchor_apply(an, {0.3f, -0.2f, 0.5f});
    NEAR(p.x, q.x, 1e-5);
    NEAR(p.y, q.y, 1e-5);
    NEAR(p.z, q.z, 1e-5);
}

static void test_bounds_and_fit() {
    // 10000 points in a 2x1x4 box centered at (0, 0, -3) plus far floaters (1%)
    std::vector<float> pts;
    for (int i = 0; i < 10000; ++i) {
        const float u = (i % 100) / 99.0f, v = ((i / 100) % 100) / 99.0f;
        pts.insert(pts.end(), {-1 + 2 * u, -0.5f + v, -5 + 4 * (u * 0.5f + v * 0.5f)});
    }
    for (int i = 0; i < 50; ++i) pts.insert(pts.end(), {500.0f, 500.0f, -500.0f});
    const SceneBounds b = robust_bounds(pts.data(), pts.size() / 3);
    TRUE_(b.valid);
    NEAR(b.center.x, 0, 0.05);
    NEAR(b.center.z, -3, 0.1);
    TRUE_(b.radius < 5);  // floaters ignored
    // fit: center lands 1.25 m in front of the head, 0.12 m lower, radius 0.6
    Vec3 head{0.5f, 1.6f, 2.0f};
    const float heading = kPi / 2;  // looking at -x
    const Anchor a = fit_transform(b, head, heading, FitMode::kFit);
    const Vec3 c = anchor_apply(a, b.center);
    NEAR(c.x, 0.5 - 1.25, 1e-4);
    NEAR(c.y, 1.6 - 0.12, 1e-4);
    NEAR(c.z, 2.0, 1e-4);
    NEAR(b.radius * a.scale, kTargetRadius, 1e-4);
    // immersive: scene origin at the head, scale 1, scene -z = head forward
    const Anchor im = fit_transform(b, head, heading, FitMode::kImmersive);
    const Vec3 ahead = anchor_apply(im, {0, 0, -2});
    NEAR(ahead.x, 0.5 - 2, 1e-5);
    NEAR(im.scale, 1, 0);
    // zoom keeps the center, clamps; reset_size restores the fit scale
    Anchor z = zoom_about_center(a, b, 2.0f);
    const Vec3 c2 = anchor_apply(z, b.center);
    NEAR(c2.x, c.x, 1e-4);
    NEAR(z.scale, a.scale * 2, 1e-5);
    z = zoom_about_center(z, b, 1000.0f);
    NEAR(z.scale, fit_scale_of(b) * kMaxZoom, 1e-4);
    const Anchor r = reset_size(z, b);
    NEAR(r.scale, fit_scale_of(b), 1e-6);
    NEAR(anchor_apply(r, b.center).z, c.z, 1e-3);
}

static void test_grab() {
    Anchor start{{0, 1, -1}, 0, 1};
    HandPose h0{{0.2f, 1.0f, -0.3f}, yaw_q(0)};
    // hand moves +0.5 x: scene moves +0.5 x
    HandPose h1{{0.7f, 1.0f, -0.3f}, yaw_q(0)};
    Anchor a = one_hand_grab(start, h0, h1);
    NEAR(a.position.x, 0.5, 1e-5);
    // hand turns 90 degrees: the scene turns about the hand
    h1 = {{0.2f, 1.0f, -0.3f}, yaw_q(kPi / 2)};
    a = one_hand_grab(start, h0, h1);
    NEAR(a.yaw, kPi / 2, 1e-5);
    const Vec3 rel = v_sub(a.position, h0.position);
    NEAR(rel.x, -0.7, 1e-5);  // (-0.2, 0, -0.7) rotated 90 deg -> (-0.7, 0, 0.2)
    NEAR(rel.z, 0.2, 1e-5);
    // two hands apart x2: scale x2 about the midpoint; clamp
    Anchor t = two_hand_grab(start, {-0.2f, 1, -0.5f}, {0.2f, 1, -0.5f}, {-0.4f, 1, -0.5f}, {0.4f, 1, -0.5f}, 0.1f, 10.0f);
    NEAR(t.scale, 2, 1e-5);
    NEAR(t.position.z, -0.5 + 2 * (-1 + 0.5), 1e-5);
    t = two_hand_grab(start, {-0.2f, 1, -0.5f}, {0.2f, 1, -0.5f}, {-4.0f, 1, -0.5f}, {4.0f, 1, -0.5f}, 0.1f, 3.0f);
    NEAR(t.scale, 3, 1e-5);
}

static void test_snap_and_locomotion() {
    SnapTurn snap;
    NEAR(snap.Step(0.9f), -kSnapAngle, 1e-6);  // push right: scene clockwise
    NEAR(snap.Step(0.9f), 0, 0);               // held: no repeat
    NEAR(snap.Step(0.1f), 0, 0);               // back to center re-arms
    NEAR(snap.Step(-0.9f), kSnapAngle, 1e-6);
    // turning keeps the head where it is relative to the scene
    Anchor a{{0, 0, -2}, 0, 1};
    const Vec3 head{0, 1.6f, 0};
    const Anchor t = turn_scene_about(a, head, kPi / 2);
    NEAR(v_len(v_sub(t.position, head)), v_len(v_sub(a.position, head)), 1e-5);

    // left stick forward for 1 s at 72 Hz: the scene comes toward the player (+z when facing -z)
    StickMotion motion;
    SnapTurn s2;
    Anchor w{{0, 0, -3}, 0, 1};
    for (int i = 0; i < 72; ++i) apply_locomotion(&w, &motion, &s2, head, true, 0.0f, 0, 1, 0, 0, 1.0f / 72);
    TRUE_(w.position.z > -3 + 0.5);
    TRUE_(w.position.z < -3 + kMoveSpeed + 1e-3);
    // release: decelerates to a stop within 1 s
    for (int i = 0; i < 72; ++i) apply_locomotion(&w, &motion, &s2, head, true, 0.0f, 0, 0, 0, 0, 1.0f / 72);
    const float z = w.position.z;
    apply_locomotion(&w, &motion, &s2, head, true, 0.0f, 0, 0, 0, 0, 1.0f / 72);
    NEAR(w.position.z, z, 1e-6);
    // right stick up: scene goes up; blocked while the snap axis is pushed
    Anchor hgt{{0, 0, -3}, 0, 1};
    StickMotion m2;
    for (int i = 0; i < 72; ++i) apply_locomotion(&hgt, &m2, &s2, head, true, 0.0f, 0, 0, 1, 0, 1.0f / 72);
    TRUE_(hgt.position.y > 0.3f);
    Anchor blk{{0, 0, -3}, 0, 1};
    StickMotion m3;
    SnapTurn s3;
    for (int i = 0; i < 72; ++i) apply_locomotion(&blk, &m3, &s3, head, true, 0.0f, 0, 0, 1, 0.65f, 1.0f / 72);
    NEAR(blk.position.y, 0, 1e-6);
    // move speed follows the scene scale (clamped)
    StickMotion m4;
    Anchor small{{0, 0, -3}, 0, 0.1f};
    for (int i = 0; i < 72; ++i) apply_locomotion(&small, &m4, &s2, head, true, 0.0f, 0, 1, 0, 0, 1.0f / 72);
    TRUE_(small.position.z - (-3) < kMoveSpeed * kSpeedScaleMin + 1e-3);
}

static void test_grip() {
    GripState g;
    TRUE_(!g.Update(0.5f));
    TRUE_(g.Update(0.65f));
    TRUE_(g.Update(0.4f));  // hysteresis
    TRUE_(!g.Update(0.3f));
}

int main() {
    test_rotate_and_heading();
    test_bounds_and_fit();
    test_grab();
    test_snap_and_locomotion();
    test_grip();
    if (!g_fail) std::printf("motion_test: all passed\n");
    return g_fail ? 1 : 0;
}

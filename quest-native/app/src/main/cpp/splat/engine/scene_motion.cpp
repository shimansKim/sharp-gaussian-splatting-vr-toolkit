#include "scene_motion.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace qnsplat {

namespace {
constexpr float kPi = 3.14159265358979f;
float clampf(float v, float lo, float hi) { return std::min(hi, std::max(lo, v)); }
float smooth_factor(float dt, float halfLife) {
    if (!(dt > 0.0f)) return 0.0f;
    if (!(halfLife > 0.0f)) return 1.0f;
    return 1.0f - std::pow(0.5f, dt / halfLife);
}
float approach(float cur, float target, float dt, float halfLife) { return cur + (target - cur) * smooth_factor(dt, halfLife); }
float yaw_of_vector(Vec3 v) { return std::atan2(-v.z, v.x); }
}  // namespace

Vec3 v_add(Vec3 a, Vec3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec3 v_sub(Vec3 a, Vec3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec3 v_scale(Vec3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
float v_len(Vec3 a) { return std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }

Vec3 rotate_y(Vec3 v, float a) {
    const float c = std::cos(a), s = std::sin(a);
    return {c * v.x + s * v.z, v.y, -s * v.x + c * v.z};
}

Quat q_mul(Quat a, Quat b) {
    return {a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z};
}

Quat q_inverse(Quat q) {
    const float n = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
    if (n <= 0.0f) return {};
    return {-q.x / n, -q.y / n, -q.z / n, q.w / n};
}

Vec3 q_rotate(Quat q, Vec3 v) {
    const Quat p{v.x, v.y, v.z, 0.0f};
    const Quat r = q_mul(q_mul(q, p), q_inverse(q));
    return {r.x, r.y, r.z};
}

float wrap_angle(float a) {
    a = std::fmod(a + kPi, 2.0f * kPi);
    if (a < 0) a += 2.0f * kPi;
    return a - kPi;
}

float yaw_of_quaternion(Quat q) { return wrap_angle(2.0f * std::atan2(q.y, q.w)); }

bool heading_of(Quat head, float* heading) {
    Vec3 f = q_rotate(head, {0.0f, 0.0f, -1.0f});
    f.y = 0.0f;
    if (f.x * f.x + f.z * f.z < 1e-6f) return false;
    *heading = std::atan2(-f.x, -f.z);
    return true;
}

Mat4 anchor_matrix(const Anchor& a) {
    const float c = std::cos(a.yaw), s = std::sin(a.yaw), k = a.scale;
    Mat4 m;
    m.m[0] = c * k;
    m.m[1] = 0;
    m.m[2] = -s * k;
    m.m[3] = 0;
    m.m[4] = 0;
    m.m[5] = k;
    m.m[6] = 0;
    m.m[7] = 0;
    m.m[8] = s * k;
    m.m[9] = 0;
    m.m[10] = c * k;
    m.m[11] = 0;
    m.m[12] = a.position.x;
    m.m[13] = a.position.y;
    m.m[14] = a.position.z;
    m.m[15] = 1;
    return m;
}

Vec3 anchor_apply(const Anchor& a, Vec3 p) { return v_add(rotate_y(v_scale(p, a.scale), a.yaw), a.position); }

SceneBounds robust_bounds(const float* positions, std::size_t count, std::size_t maxSamples, float lowQ, float highQ) {
    SceneBounds b;
    if (!positions || count == 0) return b;
    const std::size_t n = std::min(count, std::max<std::size_t>(maxSamples, 1));
    std::vector<float> col(n);
    float lo[3], hi[3];
    for (int axis = 0; axis < 3; ++axis) {
        for (std::size_t i = 0; i < n; ++i) {
            const std::size_t src = n == count ? i : (i * count) / n;
            col[i] = positions[3 * src + static_cast<std::size_t>(axis)];
        }
        std::sort(col.begin(), col.end());
        lo[axis] = col[static_cast<std::size_t>(std::floor(static_cast<float>(n - 1) * lowQ))];
        hi[axis] = col[static_cast<std::size_t>(std::ceil(static_cast<float>(n - 1) * highQ))];
    }
    b.size = {hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]};
    b.center = {0.5f * (lo[0] + hi[0]), 0.5f * (lo[1] + hi[1]), 0.5f * (lo[2] + hi[2])};
    b.radius = std::max(0.5f * v_len(b.size) * 0.85f, 1e-4f);
    b.valid = true;
    return b;
}

float fit_scale_of(const SceneBounds& b) { return b.valid ? clampf(kTargetRadius / b.radius, 0.005f, 500.0f) : 1.0f; }

Anchor fit_transform(const SceneBounds& b, Vec3 head, float heading, FitMode mode) {
    Anchor a;
    a.yaw = heading;
    if (mode == FitMode::kImmersive) {
        a.position = head;
        a.scale = 1.0f;
        return a;
    }
    a.scale = fit_scale_of(b);
    const Vec3 center = b.valid ? b.center : Vec3{};
    const Vec3 forward{-std::sin(heading), 0.0f, -std::cos(heading)};
    Vec3 target = v_add(head, v_scale(forward, kTargetDistance));
    target.y = head.y - kTargetDrop;
    a.position = v_sub(target, rotate_y(v_scale(center, a.scale), heading));
    return a;
}

Anchor reset_size(const Anchor& now, const SceneBounds& b) {
    const Vec3 center = b.valid ? b.center : Vec3{};
    const Vec3 keep = anchor_apply(now, center);
    Anchor a = now;
    a.scale = fit_scale_of(b);
    a.position = v_sub(keep, rotate_y(v_scale(center, a.scale), a.yaw));
    return a;
}

Anchor zoom_about_center(const Anchor& now, const SceneBounds& b, float factor) {
    const float base = fit_scale_of(b);
    const Vec3 center = b.valid ? b.center : Vec3{};
    const Vec3 keep = anchor_apply(now, center);
    Anchor a = now;
    a.scale = clampf(now.scale * factor, base * kMinZoom, base * kMaxZoom);
    a.position = v_sub(keep, rotate_y(v_scale(center, a.scale), a.yaw));
    return a;
}

Anchor one_hand_grab(const Anchor& start, const HandPose& h0, const HandPose& h1) {
    const float dyaw = yaw_of_quaternion(q_mul(h1.orientation, q_inverse(h0.orientation)));
    Anchor a = start;
    a.position = v_add(rotate_y(v_sub(start.position, h0.position), dyaw), h1.position);
    a.yaw = start.yaw + dyaw;
    return a;
}

Anchor two_hand_grab(const Anchor& start, Vec3 l0, Vec3 r0, Vec3 l1, Vec3 r1, float minScale, float maxScale) {
    const Vec3 v0 = v_sub(r0, l0), v1 = v_sub(r1, l1);
    const float d0 = v_len(v0), d1 = v_len(v1);
    float ratio = d0 > 0.04f ? d1 / d0 : 1.0f;
    ratio = clampf(start.scale * ratio, minScale, maxScale) / start.scale;
    const float flat0 = std::hypot(v0.x, v0.z), flat1 = std::hypot(v1.x, v1.z);
    const float dyaw = flat0 > 0.06f && flat1 > 0.06f ? yaw_of_vector(v1) - yaw_of_vector(v0) : 0.0f;
    const Vec3 mid0 = v_scale(v_add(l0, r0), 0.5f), mid1 = v_scale(v_add(l1, r1), 0.5f);
    Anchor a;
    a.position = v_add(rotate_y(v_scale(v_sub(start.position, mid0), ratio), dyaw), mid1);
    a.yaw = start.yaw + dyaw;
    a.scale = start.scale * ratio;
    return a;
}

Anchor turn_scene_about(const Anchor& a, Vec3 head, float angle) {
    Anchor out = a;
    out.position = v_add(rotate_y(v_sub(a.position, head), angle), head);
    out.yaw = a.yaw + angle;
    return out;
}

bool GripState::Update(float v) {
    if (!held_ && v > kGripOn) held_ = true;
    else if (held_ && v < kGripOff) held_ = false;
    return held_;
}

float SnapTurn::Step(float x) {
    if (std::fabs(x) < kSnapOff) {
        armed_ = true;
        return 0.0f;
    }
    if (armed_ && std::fabs(x) > kSnapOn) {
        armed_ = false;
        return x > 0 ? -kSnapAngle : kSnapAngle;  // push right: scene turns clockwise seen from above
    }
    return 0.0f;
}

StickMotion::Out StickMotion::Step(float sr, float sf, float su, bool haveHeading, float headingTarget, float dt) {
    const bool moving = std::sqrt(right_ * right_ + forward_ * forward_ + up_ * up_) > stopBelow;
    if (haveHeading && std::isfinite(headingTarget)) {
        if (!haveHeading_ || !moving) heading_ = headingTarget;  // start without lag
        else heading_ = wrap_angle(heading_ + wrap_angle(headingTarget - heading_) * smooth_factor(dt, headingHalfLife));
        haveHeading_ = true;
    } else if (!haveHeading_) {
        heading_ = 0.0f;
        haveHeading_ = true;
    }
    auto next = [&](float cur, float target) {
        const bool speedingUp = std::fabs(target) > std::fabs(cur) - 1e-9f;
        return approach(cur, target, dt, speedingUp ? accelHalfLife : decelHalfLife);
    };
    right_ = next(right_, sr);
    forward_ = next(forward_, sf);
    up_ = next(up_, su);
    const bool idle = sr == 0.0f && sf == 0.0f && su == 0.0f;
    if (idle && std::sqrt(right_ * right_ + forward_ * forward_ + up_ * up_) < stopBelow) right_ = forward_ = up_ = 0.0f;
    Out o;
    o.right = right_;
    o.forward = forward_;
    o.up = up_;
    o.heading = heading_;
    o.moving = right_ != 0.0f || forward_ != 0.0f || up_ != 0.0f;
    return o;
}

void StickMotion::Reset() {
    right_ = forward_ = up_ = 0.0f;
    haveHeading_ = false;
}

bool apply_locomotion(Anchor* anchor, StickMotion* motion, SnapTurn* snap, Vec3 head, bool haveHeading, float heading,
                      float moveX, float moveY, float heightY, float turnX, float dt) {
    bool changed = false;
    const bool heightBlocked = std::fabs(turnX) >= kHeightBlockedAbove;
    const float speed = kMoveSpeed * clampf(anchor->scale, kSpeedScaleMin, kSpeedScaleMax);
    const StickMotion::Out g = motion->Step(moveX, moveY, heightBlocked ? 0.0f : heightY, haveHeading, heading, dt);
    if (g.moving) {
        const Vec3 fwd{-std::sin(g.heading), 0.0f, -std::cos(g.heading)};
        const Vec3 right{std::cos(g.heading), 0.0f, -std::sin(g.heading)};
        // The player walks forward = the scene comes toward the player.
        const Vec3 walk = v_scale(v_add(v_scale(right, g.right), v_scale(fwd, g.forward)), speed * dt);
        anchor->position = v_sub(anchor->position, walk);
        anchor->position.y += g.up * kVerticalSpeed * dt;  // push up: the scene goes up
        changed = true;
    }
    const float turn = snap->Step(turnX);
    if (turn != 0.0f) {
        *anchor = turn_scene_about(*anchor, head, turn);
        changed = true;
    }
    return changed;
}

}  // namespace qnsplat

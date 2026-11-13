#pragma once
// PLY viewer controls as pure math (port of quest-app viewers/splat/splat-math.js and splat-motion.js).
// The scene moves only through one anchor: world = T(position) * Ry(yaw) * S(scale) * scene.
// The web app moved a "player" rig for stick locomotion and snap turns; an OpenXR app has no rig,
// so those apply the inverse motion to the anchor (same view, same feel).
// C++17, no Vulkan, no OpenXR: unit-tested on the PC (tools/tests/motion_test.cpp).

#include <cstddef>
#include <cstdint>

#include "xr_camera.h"

namespace qnsplat {

// ---- constants (same values as splat-math.js / splat-viewer.js) ----
constexpr float kTargetRadius = 0.6f;     // fitted scene bounding radius (m)
constexpr float kTargetDistance = 1.25f;  // in front of the eyes (m)
constexpr float kTargetDrop = 0.12f;      // scene center below eye height (m)
constexpr float kMinZoom = 0.1f, kMaxZoom = 25.0f;  // relative to the fit scale
constexpr float kGripOn = 0.6f, kGripOff = 0.35f;
constexpr float kSnapAngle = 3.14159265f / 6.0f;  // 30 degrees
constexpr float kSnapOn = 0.7f, kSnapOff = 0.35f;
constexpr float kMoveSpeed = 0.75f;      // m/s at scale 1
constexpr float kVerticalSpeed = 0.6f;   // m/s
constexpr float kSpeedScaleMin = 0.3f, kSpeedScaleMax = 2.0f;
constexpr float kHeightBlockedAbove = 0.6f;  // snap axis pushed this far: height rests (same stick)

Vec3 v_add(Vec3 a, Vec3 b);
Vec3 v_sub(Vec3 a, Vec3 b);
Vec3 v_scale(Vec3 a, float s);
float v_len(Vec3 a);
/** Rotate about +Y by angle (right-handed, +angle turns +x toward -z). */
Vec3 rotate_y(Vec3 v, float angle);
Quat q_mul(Quat a, Quat b);
Quat q_inverse(Quat q);
Vec3 q_rotate(Quat q, Vec3 v);
float wrap_angle(float a);
/** Yaw (rad) of a quaternion's twist about +Y. */
float yaw_of_quaternion(Quat q);
/** Horizontal heading of a head orientation: 0 when looking at -z; returns false when looking straight up/down. */
bool heading_of(Quat head, float* heading);

/** The scene anchor. */
struct Anchor {
    Vec3 position;
    float yaw = 0.0f;
    float scale = 1.0f;
};
Mat4 anchor_matrix(const Anchor& a);
/** World position of a scene-space point. */
Vec3 anchor_apply(const Anchor& a, Vec3 scenePoint);

/** Robust scene bounds (scene space): per-axis 1%..99% quantiles of the splat centers. */
struct SceneBounds {
    Vec3 center;
    Vec3 size;
    float radius = 0.0f;  // 0.5 * |size| * 0.85
    bool valid = false;
};
/** positions: x0,y0,z0,x1,... (count points); samples at most maxSamples evenly spaced points. */
SceneBounds robust_bounds(const float* positions, std::size_t count, std::size_t maxSamples = 150000,
                          float lowQ = 0.01f, float highQ = 0.99f);
/** Scale that makes the bounding radius kTargetRadius (1 when bounds are unknown). */
float fit_scale_of(const SceneBounds& b);

enum class FitMode { kFit, kImmersive };
/**
 * kFit: scene center kTargetDistance in front of the head, kTargetDrop below eye height, radius kTargetRadius.
 * kImmersive: the original camera position (scene origin) at the head, 1:1 (SHARP looks most natural there).
 */
Anchor fit_transform(const SceneBounds& b, Vec3 headPosition, float heading, FitMode mode);
/** Keep the scene center where it is and set the scale back to the fit scale (web L3). */
Anchor reset_size(const Anchor& now, const SceneBounds& b);
/** Zoom about the scene center by factor (clamped to the fit scale * [kMinZoom, kMaxZoom]). */
Anchor zoom_about_center(const Anchor& now, const SceneBounds& b, float factor);

struct HandPose {
    Vec3 position;
    Quat orientation;
};
/** One hand: move with the hand, turn with the hand's yaw (about the hand). */
Anchor one_hand_grab(const Anchor& start, const HandPose& handStart, const HandPose& handNow);
/** Two hands: distance -> scale (clamped), yaw of the hand-to-hand line -> turn, midpoint -> move. */
Anchor two_hand_grab(const Anchor& start, Vec3 leftStart, Vec3 rightStart, Vec3 leftNow, Vec3 rightNow,
                     float minScale, float maxScale);
/** The web app turned the player about the head; here the scene turns about the head by -playerAngle. */
Anchor turn_scene_about(const Anchor& a, Vec3 head, float sceneAngle);

/** Grip held state with hysteresis (kGripOn / kGripOff). */
class GripState {
public:
    bool Update(float value);
    bool held() const { return held_; }
    void Reset() { held_ = false; }

private:
    bool held_ = false;
};

/**
 * Snap turn: a big push turns once; the stick must come back toward the center to turn again.
 * Returns the scene turn angle (rad, 0 = none). Stick rule (web STICK_INVERT.x): the scene turns
 * the way the stick is pushed (push right -> scene turns right, i.e. clockwise seen from above).
 */
class SnapTurn {
public:
    float Step(float x);
    void Reset() { armed_ = true; }

private:
    bool armed_ = true;
};

/**
 * Smoothed stick locomotion (splat-motion.js): exponential accel/decel toward the stick value and a
 * smoothed heading (the move direction follows the head without its jitter). Halflives in seconds.
 */
class StickMotion {
public:
    struct Out {
        float right = 0, forward = 0, up = 0, heading = 0;
        bool moving = false;
    };
    Out Step(float stickRight, float stickForward, float stickUp, bool haveHeading, float headingTarget, float dt);
    void Reset();

    float accelHalfLife = 0.10f, decelHalfLife = 0.08f, headingHalfLife = 0.12f, stopBelow = 0.01f;

private:
    float right_ = 0, forward_ = 0, up_ = 0, heading_ = 0;
    bool haveHeading_ = false;
};

/**
 * One frame of stick locomotion applied to the anchor.
 * moveStick: left stick (x right, y up = forward); heightStick: right stick y (up = scene up);
 * turnStick: right stick x. Returns true when the anchor changed.
 */
bool apply_locomotion(Anchor* anchor, StickMotion* motion, SnapTurn* snap, Vec3 head, bool haveHeading, float heading,
                      float moveX, float moveY, float heightY, float turnX, float dt);

}  // namespace qnsplat

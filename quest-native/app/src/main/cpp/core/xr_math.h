// Small vector/quaternion helpers on OpenXR types. Owner: foundation. Header-only, any module may use it.
#pragma once
#include <openxr/openxr.h>

#include <cmath>

namespace qn {
namespace math {

inline XrVector3f Add(XrVector3f a, XrVector3f b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline XrVector3f Sub(XrVector3f a, XrVector3f b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline XrVector3f Scale(XrVector3f a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline float Dot(XrVector3f a, XrVector3f b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline float Length(XrVector3f a) { return std::sqrt(Dot(a, a)); }

inline XrQuaternionf Mul(XrQuaternionf a, XrQuaternionf b) {
    return {a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z};
}
inline XrQuaternionf Conjugate(XrQuaternionf q) { return {-q.x, -q.y, -q.z, q.w}; }

inline XrVector3f Rotate(XrQuaternionf q, XrVector3f v) {
    XrVector3f u{q.x, q.y, q.z};
    XrVector3f t = Scale({u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x}, 2.0f);
    XrVector3f c{u.y * t.z - u.z * t.y, u.z * t.x - u.x * t.z, u.x * t.y - u.y * t.x};
    return Add(Add(v, Scale(t, q.w)), c);
}

inline XrQuaternionf AxisAngle(XrVector3f axis, float radians) {
    float s = std::sin(radians * 0.5f);
    return {axis.x * s, axis.y * s, axis.z * s, std::cos(radians * 0.5f)};
}

// Rotation about +Y that faces the same horizontal direction as q (drops pitch and roll).
inline XrQuaternionf YawOnly(XrQuaternionf q) {
    XrVector3f f = Rotate(q, {0, 0, -1});
    float yaw = std::atan2(-f.x, -f.z);
    return AxisAngle({0, 1, 0}, yaw);
}

// Pose composition: child expressed in parent -> world.
inline XrPosef Compose(const XrPosef& parent, const XrPosef& child) {
    return {Mul(parent.orientation, child.orientation),
            Add(parent.position, Rotate(parent.orientation, child.position))};
}

}  // namespace math
}  // namespace qn

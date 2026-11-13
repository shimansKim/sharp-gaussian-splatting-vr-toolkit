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

inline XrVector3f Cross(XrVector3f a, XrVector3f b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline XrVector3f Normalize(XrVector3f a) {
    float l = Length(a);
    return l > 1e-6f ? Scale(a, 1.0f / l) : XrVector3f{0, 0, 0};
}

// Rotation whose local X, Y, Z axes map to the given orthonormal world axes.
inline XrQuaternionf FromBasis(XrVector3f x, XrVector3f y, XrVector3f z) {
    float m00 = x.x, m01 = y.x, m02 = z.x, m10 = x.y, m11 = y.y, m12 = z.y, m20 = x.z, m21 = y.z, m22 = z.z;
    float trace = m00 + m11 + m22;
    if (trace > 0) {
        float s = 0.5f / std::sqrt(trace + 1.0f);
        return {(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25f / s};
    }
    if (m00 > m11 && m00 > m22) {
        float s = 2.0f * std::sqrt(1.0f + m00 - m11 - m22);
        return {0.25f * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s};
    }
    if (m11 > m22) {
        float s = 2.0f * std::sqrt(1.0f + m11 - m00 - m22);
        return {(m01 + m10) / s, 0.25f * s, (m12 + m21) / s, (m02 - m20) / s};
    }
    float s = 2.0f * std::sqrt(1.0f + m22 - m00 - m11);
    return {(m02 + m20) / s, (m12 + m21) / s, 0.25f * s, (m10 - m01) / s};
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

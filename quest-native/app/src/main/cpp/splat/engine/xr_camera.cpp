#include "xr_camera.h"

#include <cmath>
#include <cstring>

namespace qnsplat {

Mat4 mat_mul(const Mat4& a, const Mat4& b) {
    Mat4 r;
    for (int c = 0; c < 4; ++c)
        for (int row = 0; row < 4; ++row) {
            float s = 0.0f;
            for (int k = 0; k < 4; ++k) s += a.m[k * 4 + row] * b.m[c * 4 + k];
            r.m[c * 4 + row] = s;
        }
    return r;
}

Mat4 mat_from_pose(const Pose& pose, float scale) {
    const Quat& q = pose.orientation;
    const float xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
    const float xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
    const float wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
    Mat4 r;
    // 열 0..2 = 회전 행렬의 열 × scale
    r.m[0] = (1 - 2 * (yy + zz)) * scale;
    r.m[1] = (2 * (xy + wz)) * scale;
    r.m[2] = (2 * (xz - wy)) * scale;
    r.m[3] = 0;
    r.m[4] = (2 * (xy - wz)) * scale;
    r.m[5] = (1 - 2 * (xx + zz)) * scale;
    r.m[6] = (2 * (yz + wx)) * scale;
    r.m[7] = 0;
    r.m[8] = (2 * (xz + wy)) * scale;
    r.m[9] = (2 * (yz - wx)) * scale;
    r.m[10] = (1 - 2 * (xx + yy)) * scale;
    r.m[11] = 0;
    r.m[12] = pose.position.x;
    r.m[13] = pose.position.y;
    r.m[14] = pose.position.z;
    r.m[15] = 1;
    return r;
}

Mat4 mat_inverse_rigid(const Mat4& m) {
    // m = [s R | t] → m^-1 = [R^T / s | -(R^T t) / s]
    const float s2 = m.m[0] * m.m[0] + m.m[1] * m.m[1] + m.m[2] * m.m[2];  // s^2
    const float inv_s2 = s2 > 0.0f ? 1.0f / s2 : 1.0f;
    Mat4 r;
    for (int c = 0; c < 3; ++c)
        for (int row = 0; row < 3; ++row) r.m[c * 4 + row] = m.m[row * 4 + c] * inv_s2;  // (sR)^T / s^2 = R^T / s
    for (int row = 0; row < 3; ++row) {
        float s = 0.0f;
        for (int k = 0; k < 3; ++k) s += r.m[k * 4 + row] * m.m[12 + k];
        r.m[12 + row] = -s;
    }
    r.m[3] = r.m[7] = r.m[11] = 0.0f;
    r.m[15] = 1.0f;
    return r;
}

Vec3 transform_point(const Mat4& m, const Vec3& p) {
    return {m.m[0] * p.x + m.m[4] * p.y + m.m[8] * p.z + m.m[12],
            m.m[1] * p.x + m.m[5] * p.y + m.m[9] * p.z + m.m[13],
            m.m[2] * p.x + m.m[6] * p.y + m.m[10] * p.z + m.m[14]};
}

Vec3 project_point(const Mat4& m, const Vec3& p, float* w_out) {
    const Vec3 c = transform_point(m, p);
    const float w = m.m[3] * p.x + m.m[7] * p.y + m.m[11] * p.z + m.m[15];
    if (w_out) *w_out = w;
    return {c.x / w, c.y / w, c.z / w};
}

Mat4 projection_from_fov(const Fov& fov, float near_z, float far_z) {
    const float tan_l = std::tan(fov.angle_left), tan_r = std::tan(fov.angle_right);
    const float tan_u = std::tan(fov.angle_up), tan_d = std::tan(fov.angle_down);
    const float w = tan_r - tan_l;
    const float h = tan_d - tan_u;  // Vulkan: y 아래 → 음수 높이로 뒤집는다(OpenXR 예제와 같음)
    Mat4 r;
    std::memset(r.m, 0, sizeof(r.m));
    r.m[0] = 2.0f / w;
    r.m[8] = (tan_r + tan_l) / w;
    r.m[5] = 2.0f / h;
    r.m[9] = (tan_u + tan_d) / h;
    r.m[10] = -far_z / (far_z - near_z);
    r.m[14] = -(far_z * near_z) / (far_z - near_z);
    r.m[11] = -1.0f;
    return r;
}

EyeCamera make_eye_camera(const Pose& eye_in_world, const Fov& fov, std::uint32_t width, std::uint32_t height,
                          const Mat4& world_from_scene, float near_z, float far_z) {
    const Mat4 eye_from_world = mat_inverse_rigid(mat_from_pose(eye_in_world));
    const Mat4 view = mat_mul(eye_from_world, world_from_scene);  // scene → eye
    const Mat4 proj = projection_from_fov(fov, near_z, far_z);
    const Mat4 proj_view = mat_mul(proj, view);
    const Mat4 scene_from_world = mat_inverse_rigid(world_from_scene);
    const Vec3 cam = transform_point(scene_from_world, eye_in_world.position);

    EyeCamera e;
    std::memcpy(e.view, view.m, sizeof(e.view));
    std::memcpy(e.proj_view, proj_view.m, sizeof(e.proj_view));
    e.cam_pos[0] = cam.x;
    e.cam_pos[1] = cam.y;
    e.cam_pos[2] = cam.z;
    e.viewport_w = static_cast<float>(width);
    e.viewport_h = static_cast<float>(height);
    e.focal_x = e.viewport_w / (std::tan(fov.angle_right) - std::tan(fov.angle_left));
    e.focal_y = e.viewport_h / (std::tan(fov.angle_up) - std::tan(fov.angle_down));
    return e;
}

Mat4 sharp_initial_placement(const Pose& head_in_world, float forward_offset_m, float scale) {
    const Mat4 head = mat_from_pose(head_in_world);
    // 머리 앞 방향(-z 열)을 수평면에 투영해 yaw만 쓴다.
    float fx = -head.m[8], fz = -head.m[10];
    const float len = std::sqrt(fx * fx + fz * fz);
    if (len < 1e-4f) {
        fx = 0.0f;
        fz = -1.0f;
    } else {
        fx /= len;
        fz /= len;
    }
    // Ry(θ)는 (0,0,-1)을 (-sinθ, 0, -cosθ)로 보낸다.
    const float theta = std::atan2(-fx, -fz);
    Pose p;
    p.orientation = {0.0f, std::sin(theta * 0.5f), 0.0f, std::cos(theta * 0.5f)};
    p.position = {head_in_world.position.x + fx * forward_offset_m, head_in_world.position.y,
                  head_in_world.position.z + fz * forward_offset_m};
    return mat_from_pose(p, scale);
}

}  // namespace qnsplat

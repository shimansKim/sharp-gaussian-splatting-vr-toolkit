#pragma once
// OpenXR 눈 하나(XrPosef + XrFovf)와 장면 배치로 pocketsplat SplatCameraParams를 만든다.
// OpenXR 헤더에 의존하지 않도록 같은 모양의 작은 구조체를 쓴다(뼈대에서 그대로 복사해 넣는다).
//
// 좌표계
//  - OpenXR 세계(스테이지/로컬 공간): 오른손, x 오른쪽, y 위, -z 앞. pocketsplat RUB와 같다.
//  - 장면(scene) 공간: splat 위치가 있는 공간(SHARP → RUB 변환 뒤). 원본 카메라가 원점에서 -z를 본다.
//  - world_from_scene: 장면을 세계에 두는 강체 변환(+균일 배율).
// 투영: Vulkan NDC(y 아래, 깊이 0..1). OpenXR XrMatrix4x4f_CreateProjectionFov(GRAPHICS_VULKAN)와 같은 식.

#include <cstdint>

namespace qnsplat {

struct Quat { float x = 0, y = 0, z = 0, w = 1; };   // XrQuaternionf 순서
struct Vec3 { float x = 0, y = 0, z = 0; };          // XrVector3f
struct Pose { Quat orientation; Vec3 position; };     // XrPosef
struct Fov { float angle_left = 0, angle_right = 0, angle_up = 0, angle_down = 0; };  // XrFovf(라디안)

/** 열 우선 4x4(m[col*4+row]), glm·Vulkan과 같은 배치. */
struct Mat4 {
    float m[16] = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1};
};

Mat4 mat_mul(const Mat4& a, const Mat4& b);
Mat4 mat_from_pose(const Pose& pose, float scale = 1.0f);  // T * R * S
Mat4 mat_inverse_rigid(const Mat4& m);                     // 회전+균일배율+이동의 역
Vec3 transform_point(const Mat4& m, const Vec3& p);
/** clip = m * (p,1)을 계산하고 w로 나눈 NDC를 돌려준다. w를 따로 받는다. */
Vec3 project_point(const Mat4& m, const Vec3& p, float* w_out = nullptr);

/** Vulkan용 비대칭 투영(y 아래, 깊이 0..1). */
Mat4 projection_from_fov(const Fov& fov, float near_z, float far_z);

/** pocketsplat SplatCameraParams와 같은 메모리 배치(이 헤더가 Vulkan 헤더 없이도 쓰이도록 따로 둔다). */
struct EyeCamera {
    float view[16];       // scene -> eye view
    float proj_view[16];  // scene -> clip
    float cam_pos[3];     // 장면 공간 눈 위치
    float focal_x = 0, focal_y = 0;
    float viewport_w = 0, viewport_h = 0;
};

/**
 * eye_in_world: xrLocateViews가 준 눈 자세(세계 공간), fov: 그 눈의 XrFovf,
 * width/height: 이 눈 이미지 크기(해상도 배율 적용 뒤), world_from_scene: 장면 배치.
 */
EyeCamera make_eye_camera(const Pose& eye_in_world, const Fov& fov, std::uint32_t width, std::uint32_t height,
                          const Mat4& world_from_scene, float near_z = 0.05f, float far_z = 1000.0f);

/**
 * SHARP 장면 처음 배치: 원본 사진의 카메라 자리를 사용자 머리에 맞춘다(장면 원점 = 머리 위치,
 * 장면 -z = 머리의 수평 앞 방향). 기울기(pitch/roll)는 버리고 yaw만 쓴다.
 * forward_offset_m만큼 장면을 앞(+)으로 민다(가까운 splat이 눈에 너무 붙을 때). scale은 장면 배율.
 */
Mat4 sharp_initial_placement(const Pose& head_in_world, float forward_offset_m = 0.0f, float scale = 1.0f);

}  // namespace qnsplat

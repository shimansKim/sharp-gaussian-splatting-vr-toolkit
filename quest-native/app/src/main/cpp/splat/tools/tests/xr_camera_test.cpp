// xr_camera 단위 시험(GPU 없음). 실패하면 0이 아닌 값으로 끝난다.
#include <cmath>
#include <cstdio>
#include <initializer_list>

#include "xr_camera.h"

using namespace qnsplat;

static int g_fail = 0;
#define CHECK_NEAR(a, b, tol)                                                                          \
    do {                                                                                               \
        const double _a = (a), _b = (b);                                                               \
        if (std::fabs(_a - _b) > (tol)) {                                                              \
            std::printf("FAIL %s:%d  %s = %.6f, expected %.6f\n", __FILE__, __LINE__, #a, _a, _b);      \
            ++g_fail;                                                                                  \
        }                                                                                              \
    } while (0)

static Quat yaw_quat(float rad) { return {0.0f, std::sin(rad / 2), 0.0f, std::cos(rad / 2)}; }

// Quest 3 왼눈 FOV에 가까운 비대칭 값(라디안)
static const Fov kFovL{-0.9425f, 0.6981f, 0.7330f, -0.9425f};

static void test_projection_edges() {
    const Mat4 p = projection_from_fov(kFovL, 0.05f, 1000.0f);
    // 왼쪽 가장자리 방향(z=-1, x=tan(left)) → NDC x = -1, 위쪽 가장자리 → Vulkan NDC y = -1
    CHECK_NEAR(project_point(p, {std::tan(kFovL.angle_left), 0, -1}).x, -1.0, 1e-5);
    CHECK_NEAR(project_point(p, {std::tan(kFovL.angle_right), 0, -1}).x, 1.0, 1e-5);
    CHECK_NEAR(project_point(p, {0, std::tan(kFovL.angle_up), -1}).y, -1.0, 1e-5);
    CHECK_NEAR(project_point(p, {0, std::tan(kFovL.angle_down), -1}).y, 1.0, 1e-5);
    // 깊이: near → 0, far → 1
    CHECK_NEAR(project_point(p, {0, 0, -0.05f}).z, 0.0, 1e-5);
    CHECK_NEAR(project_point(p, {0, 0, -1000.0f}).z, 1.0, 1e-4);
    float w = 0;
    project_point(p, {0, 0, -2.0f}, &w);
    CHECK_NEAR(w, 2.0, 1e-6);  // w = 시점 거리
}

static void test_inverse() {
    Pose pose;
    pose.orientation = {0.1f, 0.3f, -0.2f, 0.927f};
    const float n = std::sqrt(0.01f + 0.09f + 0.04f + 0.927f * 0.927f);
    pose.orientation = {0.1f / n, 0.3f / n, -0.2f / n, 0.927f / n};
    pose.position = {0.4f, 1.6f, -0.3f};
    for (float s : {1.0f, 2.5f}) {
        const Mat4 m = mat_from_pose(pose, s);
        const Mat4 id = mat_mul(mat_inverse_rigid(m), m);
        for (int i = 0; i < 16; ++i) CHECK_NEAR(id.m[i], (i % 5 == 0) ? 1.0 : 0.0, 1e-5);
    }
}

static void test_eye_camera_and_placement() {
    // 머리: (1, 1.6, 2), 오른쪽으로 90도 돌아 +x를 봄(yaw -90도).
    Pose head;
    head.orientation = yaw_quat(-1.5707963f);
    head.position = {1.0f, 1.6f, 2.0f};
    const Mat4 wfs = sharp_initial_placement(head, 0.0f);
    // 장면 (0,0,-3)(원본 카메라 정면 3m) → 세계에서 머리 앞 3m = (4, 1.6, 2)
    const Vec3 w = transform_point(wfs, {0, 0, -3});
    CHECK_NEAR(w.x, 4.0, 1e-5);
    CHECK_NEAR(w.y, 1.6, 1e-5);
    CHECK_NEAR(w.z, 2.0, 1e-5);
    // 앞으로 0.5m 밀기
    const Vec3 w2 = transform_point(sharp_initial_placement(head, 0.5f), {0, 0, -3});
    CHECK_NEAR(w2.x, 4.5, 1e-5);

    // 같은 머리 자세의 눈으로 보면 장면 (0,0,-3)은 대칭 FOV 화면 정중앙에 온다.
    const Fov sym{-0.8f, 0.8f, 0.8f, -0.8f};
    const EyeCamera e = make_eye_camera(head, sym, 1680, 1760, wfs);
    Mat4 pv;
    for (int i = 0; i < 16; ++i) pv.m[i] = e.proj_view[i];
    const Vec3 ndc = project_point(pv, {0, 0, -3});
    CHECK_NEAR(ndc.x, 0.0, 1e-5);
    CHECK_NEAR(ndc.y, 0.0, 1e-5);
    // 눈 위치는 장면 원점
    CHECK_NEAR(e.cam_pos[0], 0.0, 1e-5);
    CHECK_NEAR(e.cam_pos[2], 0.0, 1e-5);
    // focal: 대칭 FOV면 0.5*w/tan(0.8)
    CHECK_NEAR(e.focal_x, 0.5 * 1680 / std::tan(0.8), 1e-2);
    // 장면 +x(오른쪽) 점은 화면 오른쪽(NDC x > 0), 장면 +y(위) 점은 Vulkan NDC y < 0
    CHECK_NEAR(project_point(pv, {0.5f, 0, -3}).x > 0 ? 1 : 0, 1, 0);
    CHECK_NEAR(project_point(pv, {0, 0.5f, -3}).y < 0 ? 1 : 0, 1, 0);

    // 왼눈은 머리에서 -x(눈 기준 왼쪽)로 3.2cm: 정면 점은 왼눈 화면에서 약간 오른쪽에 보인다.
    Pose left = head;
    const Mat4 hm = mat_from_pose(head);
    left.position = {head.position.x - 0.032f * hm.m[0], head.position.y - 0.032f * hm.m[1],
                     head.position.z - 0.032f * hm.m[2]};
    const EyeCamera el = make_eye_camera(left, sym, 1680, 1760, wfs);
    for (int i = 0; i < 16; ++i) pv.m[i] = el.proj_view[i];
    const double x_left = project_point(pv, {0, 0, -3}).x;
    CHECK_NEAR(x_left > 0 ? 1 : 0, 1, 0);
    CHECK_NEAR(x_left, (0.032 / 3.0) / std::tan(0.8), 1e-4);
}

static void test_pitch_ignored() {
    // 고개를 30도 숙여도 처음 배치는 수평을 유지한다.
    Pose head;
    const float a = -0.5236f;  // x축 -30도
    head.orientation = {std::sin(a / 2), 0, 0, std::cos(a / 2)};
    head.position = {0, 1.5f, 0};
    const Vec3 w = transform_point(sharp_initial_placement(head), {0, 0, -2});
    CHECK_NEAR(w.y, 1.5, 1e-5);
    CHECK_NEAR(w.z, -2.0, 1e-5);
}

int main() {
    test_projection_edges();
    test_inverse();
    test_eye_camera_and_placement();
    test_pitch_ignored();
    if (g_fail == 0) std::printf("xr_camera_test: all passed\n");
    return g_fail == 0 ? 0 : 1;
}

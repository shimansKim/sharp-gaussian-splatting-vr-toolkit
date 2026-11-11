// PLY 뷰어 조작 계산(순수 함수). three 벡터만 쓰고 장면·렌더러는 모른다 → node 테스트 가능.
// - 그립으로 장면 잡기: 한 손(이동 + 좌우 돌리기), 양손(확대·축소 + 두 손 사이 돌리기 + 이동)
// - 스냅 회전: 머리 위치를 축으로 플레이어를 돌린다(시야가 흔들리지 않음)
// - 자동 맞춤: 점 샘플의 바깥값을 잘라 낸 범위로 장면 크기·중심을 구하고 눈앞에 놓는다.
// 장면은 anchor 그룹 하나(위치 P, Y축 회전 yaw, 균일 크기 s)로만 움직인다.

import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);

/** 보기 좋은 크기: 장면의 둘러싸는 구 반지름(m). 눈앞 TARGET_DISTANCE에 둔다. */
export const TARGET_RADIUS = 0.6;
export const TARGET_DISTANCE = 1.25;
/** 장면 중심을 눈높이보다 약간 아래에 둔다. */
export const TARGET_DROP = 0.12;
/** 맞춤 크기 대비 확대·축소 허용 범위. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 25;
/** 그립을 누른 것으로 보는 값과 뗀 것으로 보는 값(떨림 방지). */
export const GRIP_ON = 0.6;
export const GRIP_OFF = 0.35;
export const SNAP_ANGLE = Math.PI / 6; // 30°
export const SNAP_ON = 0.7;
export const SNAP_OFF = 0.35;
/**
 * 오른쪽 스틱 방향 규칙(사람 실기기 요청으로 이전 방향의 반대로 바꿈): 장면을 미는 방향으로 움직인다.
 * x: 오른쪽으로 밀면 장면이 오른쪽으로 돈다(시점은 왼쪽으로 돈다). y: 위로 밀면 장면이 위로(시점은 아래로) 간다.
 * 영상·사진 뷰어도 스틱으로 시점을 돌릴 때 같은 규칙을 쓴다.
 */
export const STICK_INVERT = { x: true, y: true };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 쿼터니언의 Y축 비틀림 각(라디안, -π..π). 손 회전 중 "좌우로 돌린 만큼"만 뽑는다. */
export function yawOfQuaternion(q) {
  const angle = 2 * Math.atan2(q.y, q.w);
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Y축 회전각 θ(라디안)가 +x축을 보내는 방향이 (cosθ, 0, -sinθ)가 되도록 벡터의 각을 잰다. */
export const yawOfVector = (v) => Math.atan2(-v.z, v.x);

/** 카메라(머리)가 바라보는 수평 방향의 Y축 회전각. 정면이 -z이면 0. */
export function headingOf(quaternion) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) return 0;
  return Math.atan2(-forward.x, -forward.z);
}

/**
 * 장면 점들(anchor 좌표, 여러 개의 x,y,z 한 줄 배열)에서 맞춤에 쓸 중심·반지름을 구한다.
 * 바깥 floater에 휘둘리지 않도록 각 축 1%~99% 범위를 쓴다.
 * @param {Float32Array | number[]} points  x0,y0,z0,x1,y1,z1,...
 * @returns {{ center: THREE.Vector3, radius: number, size: THREE.Vector3 } | null}
 */
export function robustBounds(points, lowQuantile = 0.01, highQuantile = 0.99) {
  const count = Math.floor(points.length / 3);
  if (count < 1) return null;
  const lo = new THREE.Vector3();
  const hi = new THREE.Vector3();
  const column = new Float32Array(count);
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < count; i++) column[i] = points[i * 3 + axis];
    column.sort();
    const low = column[Math.floor((count - 1) * lowQuantile)];
    const high = column[Math.ceil((count - 1) * highQuantile)];
    lo.setComponent(axis, low);
    hi.setComponent(axis, high);
  }
  const size = hi.clone().sub(lo);
  const center = lo.clone().add(hi).multiplyScalar(0.5);
  // 반지름: 대각선의 절반보다 조금 작게(구석이 비어 있는 장면이 많아서).
  const radius = Math.max(0.5 * size.length() * 0.85, 1e-4);
  return { center, radius, size };
}

/**
 * 장면을 눈앞에 놓는 anchor 변환을 구한다.
 * @param {{ center: THREE.Vector3, radius: number } | null} bounds  anchor 좌표 기준. null이면 크기 1로 본다.
 * @param {{ headPosition: THREE.Vector3, heading: number, mode?: 'fit' | 'immersive' }} view
 * @returns {{ position: THREE.Vector3, yaw: number, scale: number }}
 */
/** 장면 둘러싸는 구를 TARGET_RADIUS로 맞추는 크기. 범위를 모르면 1. */
export function fitScaleOf(bounds) {
  return bounds ? clamp(TARGET_RADIUS / bounds.radius, 0.005, 500) : 1;
}

export function fitTransform(bounds, { headPosition, heading, mode = "fit" }) {
  if (mode === "immersive") {
    // 원본 카메라 자리(장면 원점)에 머리를 두고 1:1로 본다. SHARP는 이 자리에서 가장 자연스럽다.
    return { position: headPosition.clone(), yaw: heading, scale: 1 };
  }
  const center = bounds?.center ?? new THREE.Vector3();
  const scale = fitScaleOf(bounds);
  const forward = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
  const target = headPosition.clone().addScaledVector(forward, TARGET_DISTANCE);
  target.y = headPosition.y - TARGET_DROP;
  // 장면 중심이 target에 오도록: P = target - R(yaw) * (s * center)
  const position = target.sub(center.clone().multiplyScalar(scale).applyAxisAngle(UP, heading));
  return { position, yaw: heading, scale };
}

/** 장면 중심의 월드 좌표. */
export function worldCenter(transform, center) {
  return center.clone().multiplyScalar(transform.scale).applyAxisAngle(UP, transform.yaw).add(transform.position);
}

/**
 * 한 손으로 잡기: 시작 시점의 손·장면 상태에서 지금 손 상태에 맞는 장면 변환.
 * 손 위치를 축으로, 손이 좌우로 돌린 만큼 장면이 같이 돈다.
 * @param {{ handPosition: THREE.Vector3, handQuaternion: THREE.Quaternion, transform: {position: THREE.Vector3, yaw: number, scale: number} }} start
 * @param {{ handPosition: THREE.Vector3, handQuaternion: THREE.Quaternion }} now
 */
export function oneHandGrab(start, now) {
  const delta = now.handQuaternion.clone().multiply(start.handQuaternion.clone().invert());
  const dyaw = yawOfQuaternion(delta);
  const position = start.transform.position
    .clone()
    .sub(start.handPosition)
    .applyAxisAngle(UP, dyaw)
    .add(now.handPosition);
  return { position, yaw: start.transform.yaw + dyaw, scale: start.transform.scale };
}

/**
 * 양손으로 잡기: 두 손 사이 거리로 확대·축소, 두 손을 잇는 선의 좌우 회전으로 돌리기, 가운데 점으로 이동.
 * @param {{ left: THREE.Vector3, right: THREE.Vector3, transform: {position: THREE.Vector3, yaw: number, scale: number} }} start
 * @param {{ left: THREE.Vector3, right: THREE.Vector3 }} now
 * @param {{ min: number, max: number }} scaleLimits  scale에 허용되는 절대 범위
 */
export function twoHandGrab(start, now, scaleLimits) {
  const v0 = start.right.clone().sub(start.left);
  const v1 = now.right.clone().sub(now.left);
  const d0 = v0.length();
  const d1 = v1.length();
  let ratio = d0 > 0.04 ? d1 / d0 : 1;
  ratio = clamp(start.transform.scale * ratio, scaleLimits.min, scaleLimits.max) / start.transform.scale;
  // 두 손이 거의 수평으로 겹칠 때(좌우 방향 불확실)는 돌리지 않는다.
  const flat0 = Math.hypot(v0.x, v0.z);
  const flat1 = Math.hypot(v1.x, v1.z);
  const dyaw = flat0 > 0.06 && flat1 > 0.06 ? yawOfVector(v1) - yawOfVector(v0) : 0;
  const mid0 = start.left.clone().add(start.right).multiplyScalar(0.5);
  const mid1 = now.left.clone().add(now.right).multiplyScalar(0.5);
  const position = start.transform.position
    .clone()
    .sub(mid0)
    .multiplyScalar(ratio)
    .applyAxisAngle(UP, dyaw)
    .add(mid1);
  return { position, yaw: start.transform.yaw + dyaw, scale: start.transform.scale * ratio };
}

/**
 * 머리 위치를 축으로 플레이어를 angle만큼 돌린 뒤의 위치·Y회전.
 * @param {THREE.Vector3} playerPosition
 * @param {number} playerYaw
 * @param {THREE.Vector3} head
 * @param {number} angle
 */
export function turnAbout(playerPosition, playerYaw, head, angle) {
  const position = playerPosition.clone().sub(head).applyAxisAngle(UP, angle).add(head);
  return { position, yaw: playerYaw + angle };
}

/**
 * 스냅 회전 입력 처리. 스틱을 크게 밀면 한 번만 돌고, 가운데 쪽으로 돌아와야 다시 돈다.
 * @returns {{ step(x: number): number }}  step이 플레이어를 돌릴 각도(라디안, 없으면 0)를 돌려준다.
 *   invert=false: 오른쪽으로 밀면 시점이 오른쪽으로(음수) 돈다. invert=true(기본): 반대.
 */
export function createSnapTurn(angle = SNAP_ANGLE, invert = STICK_INVERT.x) {
  const direction = invert ? -1 : 1;
  let armed = true;
  return {
    step(x) {
      if (Math.abs(x) < SNAP_OFF) {
        armed = true;
        return 0;
      }
      if (armed && Math.abs(x) > SNAP_ON) {
        armed = false;
        return (x > 0 ? -angle : angle) * direction;
      }
      return 0;
    },
    reset() {
      armed = true;
    },
  };
}

/** 그립 값에 히스테리시스를 걸어 "잡고 있음" 여부를 돌려주는 상태기. */
export function createGripState() {
  let held = false;
  return {
    update(value) {
      if (!held && value > GRIP_ON) held = true;
      else if (held && value < GRIP_OFF) held = false;
      return held;
    },
    get held() {
      return held;
    },
    reset() {
      held = false;
    },
  };
}

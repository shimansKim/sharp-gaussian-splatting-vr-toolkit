import { Euler, Vector3 } from "three";

// VR 패널을 장면과 겹치지 않는 방향에 놓기 위한 계산(순수 함수).
// 각도는 모두 라디안, 시선 기준 수평각이며 양수 = 왼쪽(three의 Y축 +회전과 같은 방향).

/** 이만큼보다 장면이 넓게 둘러싸면 비킬 자리가 없으므로 시선 정면에 연다. */
export const MAX_AVOID_HALF = (65 * Math.PI) / 180;
/** 비켜 놓았을 때 시야 밖으로 너무 멀어지지 않게 하는 한계. */
export const MAX_OFFSET = (105 * Math.PI) / 180;
/** 장면과 패널 사이 여유. */
export const MARGIN = (8 * Math.PI) / 180;

/** 수평 방향 벡터(x, z)의 시선각: 정면(-z)이 0, 왼쪽이 양수. */
export const yawOfDirection = (x, z) => Math.atan2(-x, -z);

const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * 장면(시선 기준 방향 avoidYaw, 반폭 avoidHalf)을 피해 패널 중심이 놓일 시선 기준 각도.
 * 장면의 왼쪽·오른쪽 가장자리 바깥 두 후보 중 시선에 가까운 쪽(눈에 덜 돌려도 되는 쪽)을 고른다.
 * @param {{ avoidYaw: number, avoidHalf: number, panelHalf: number, margin?: number }} input
 * @returns {number}
 */
export function panelYawOffset({ avoidYaw, avoidHalf, panelHalf, margin = MARGIN }) {
  if (!Number.isFinite(avoidYaw) || !Number.isFinite(avoidHalf) || avoidHalf > MAX_AVOID_HALF) return 0;
  const gap = avoidHalf + panelHalf + margin;
  const left = wrap(avoidYaw + gap);
  const right = wrap(avoidYaw - gap);
  const best = Math.abs(left) <= Math.abs(right) ? left : right;
  // 시선이 장면에서 충분히 벗어나 있어(이미 겹치지 않음) 정면이 더 낫다면 정면에 연다.
  if (Math.abs(avoidYaw) > gap) return 0;
  return Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, best));
}

/** 거리 d에서 반지름 r인 원이 보이는 반각. 안에 들어가 있으면 π. */
export function angularHalf(radius, distance) {
  if (distance <= radius) return Math.PI;
  return Math.asin(Math.min(1, radius / distance));
}

// ── 영상·사진용 "도크": 재생 컨트롤(VR HUD)과 공용 VR 패널이 같이 쓰는 한 자리 ──────────────────────────
// 3D 스크린(가로 약 90°, 위아래 ±29°) 아래에, 머리 쪽으로 기울여 놓는다. 위쪽 가장자리의 한 점(top)을 기준점으로 삼고,
// HUD와 패널은 둘 다 그 점에 윗변을 맞춰 매단다(높이가 달라도 같은 자리, 스크린과 겹치지 않음).
// 시선이 아니라 한 번 정한 기준점이라 조작 중에는 움직이지 않는다.
export const DOCK_TOP_FORWARD = 1.15; // 머리 앞 수평 거리(m)
export const DOCK_TOP_DROP = 0.74; // 눈높이 아래(m). atan(0.74/1.15)=32.8° > 스크린 아래 가장자리 29°
export const DOCK_TILT = 0.72; // 머리 쪽으로 눕힌 각도(rad)
/** 공용 패널(1.2m 폭)을 도크에 걸 때의 배율: 컨트롤러가 닿는 거리에서 너무 커 몸을 가리지 않게 줄인다. */
export const DOCK_PANEL_SCALE = 0.8;

/** 머리 위치·시선 방향(yaw)에서 도크 윗변 기준점. */
export function dockTop(head, yaw) {
  return new Vector3(head.x - Math.sin(yaw) * DOCK_TOP_FORWARD, head.y - DOCK_TOP_DROP, head.z - Math.cos(yaw) * DOCK_TOP_FORWARD);
}

/** 도크 평면의 회전(Euler YXZ): 위쪽이 멀어지고 아래쪽이 머리 쪽으로 온다. */
export function dockRotation(yaw, tilt = DOCK_TILT) {
  return new Euler(-tilt, yaw, 0, "YXZ");
}

/** 윗변 기준점 top에 윗변을 맞춰 높이 height(m)인 평면을 매달았을 때 평면 중심. */
export function dockCenter(top, yaw, tilt, height) {
  const up = new Vector3(0, 1, 0).applyEuler(dockRotation(yaw, tilt));
  return top.clone().addScaledVector(up, -height / 2);
}

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

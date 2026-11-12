// PLY 뷰어의 스틱 이동(왼쪽 스틱 이동·오른쪽 스틱 높이)을 부드럽게 하는 계산(순수 함수). three를 쓰지 않아 node 테스트가 가능하다.
// VR에서 머리 포즈는 컴포지터가 실제 값을 쓰므로 보간하지 않는다. 대신 "머리 방향을 따라 움직이는" 플레이어 이동에서
//  - 스틱 값을 목표 속도로 보고 dt 기반 지수 가감속으로 수렴시킨다(놓으면 부드럽게 멈춘다).
//  - 이동 방향의 기준이 되는 머리 방향(수평)도 따라가며 스무딩한다. 머리 포즈 잡음이 이동 방향 떨림으로 번지지 않는다.
// 지수 스무딩은 반감기 기준이라 프레임률(dt)과 무관하게 같은 시간에 같은 만큼 수렴한다.

export const MOTION = {
  /** 스틱을 밀 때 목표 속도에 절반 다가가는 데 걸리는 시간(초). */
  accelHalfLife: 0.1,
  /** 스틱을 놓을 때 절반으로 줄어드는 시간(초). */
  decelHalfLife: 0.08,
  /** 이동 방향 기준(머리 수평 방향)이 목표를 따라가는 반감기(초). */
  headingHalfLife: 0.12,
  /** 이 아래로 느려지면 멈춘 것으로 본다(스틱 값 단위, 최대 1). */
  stopBelow: 0.01,
};

const TWO_PI = Math.PI * 2;

/** 각도를 -π..π로 접는다. */
export function wrapAngle(angle) {
  const folded = ((((angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) - Math.PI;
  return folded === -Math.PI ? Math.PI : folded;
}

/** dt초 동안 반감기 halfLife로 다가가는 비율(0..1). dt를 쪼개서 연달아 적용해도 합친 것과 같다. */
export function smoothFactor(dt, halfLife) {
  if (!(dt > 0)) return 0;
  if (!(halfLife > 0)) return 1;
  return 1 - Math.pow(0.5, dt / halfLife);
}

/** current를 target으로 지수 수렴시킨다. */
export function approach(current, target, dt, halfLife) {
  return current + (target - current) * smoothFactor(dt, halfLife);
}

/** 각도 버전: 가장 짧은 방향으로 수렴하고 결과는 -π..π. */
export function approachAngle(current, target, dt, halfLife) {
  return wrapAngle(current + wrapAngle(target - current) * smoothFactor(dt, halfLife));
}

/**
 * 스틱 이동 상태기. 스틱 값(머리 기준 좌우·앞뒤, 높이)과 머리 수평 방향을 받아 이번 프레임의 이동 비율을 돌려준다.
 * 돌려주는 right·forward·up은 스무딩된 스틱 값(-1..1)이고, 호출한 쪽이 속도·dt를 곱한다.
 * 이동 방향은 스무딩된 heading 기준이다(forward = (-sin h, 0, -cos h), right = (cos h, 0, -sin h)).
 * @param {typeof MOTION} [params]
 */
export function createMotion(params = MOTION) {
  let right = 0;
  let forward = 0;
  let up = 0;
  /** @type {number | null} */
  let heading = null;
  return {
    /**
     * @param {{ right: number, forward: number, up: number }} stick 목표(스틱 값)
     * @param {number | null} headingTarget 머리 수평 방향(라디안). 정면이 -z이면 0. 위·아래를 봐서 모르면 null(이전 값 유지)
     * @param {number} dt 초
     * @returns {{ right: number, forward: number, up: number, heading: number, moving: boolean }}
     */
    step(stick, headingTarget, dt) {
      const moving = Math.hypot(right, forward, up) > params.stopBelow;
      if (headingTarget !== null && Number.isFinite(headingTarget)) {
        // 멈춰 있을 때는 바로 맞춰서 출발이 늦지 않게 하고, 움직이는 동안만 스무딩한다.
        heading = heading === null || !moving ? headingTarget : approachAngle(heading, headingTarget, dt, params.headingHalfLife);
      } else if (heading === null) {
        heading = 0;
      }
      const speedingUp = (current, target) => Math.abs(target) > Math.abs(current) - 1e-9;
      const next = (current, target) => approach(current, target, dt, speedingUp(current, target) ? params.accelHalfLife : params.decelHalfLife);
      right = next(right, stick.right);
      forward = next(forward, stick.forward);
      up = next(up, stick.up);
      const idle = !stick.right && !stick.forward && !stick.up;
      if (idle && Math.hypot(right, forward, up) < params.stopBelow) right = forward = up = 0;
      return { right, forward, up, heading, moving: right !== 0 || forward !== 0 || up !== 0 };
    },
    reset() {
      right = forward = up = 0;
      heading = null;
    },
    get active() {
      return right !== 0 || forward !== 0 || up !== 0;
    },
  };
}

/** heading(라디안)에서 수평 앞·오른쪽 단위 벡터(x, z). */
export function headingAxes(heading) {
  return {
    forward: { x: -Math.sin(heading), z: -Math.cos(heading) },
    right: { x: Math.cos(heading), z: -Math.sin(heading) },
  };
}

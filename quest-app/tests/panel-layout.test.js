import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { DOCK_TILT, DOCK_TOP_DROP, DOCK_TOP_FORWARD, MARGIN, MAX_AVOID_HALF, angularHalf, dockCenter, dockRotation, dockTop, panelYawOffset, yawOfDirection } from "../src/core/panel-layout.js";

const deg = (value) => (value * Math.PI) / 180;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("yawOfDirection: 정면 -z는 0, 왼쪽(-x)이 양수", () => {
  near(yawOfDirection(0, -1), 0);
  near(yawOfDirection(-1, 0), Math.PI / 2);
  near(yawOfDirection(1, 0), -Math.PI / 2);
});

test("angularHalf: 거리 2m에서 반지름 1m는 30°, 안에 들어가면 180°", () => {
  near(angularHalf(1, 2), deg(30));
  near(angularHalf(1, 0.5), Math.PI);
});

test("panelYawOffset: 장면이 정면이면 시선에 가까운 쪽 가장자리 바깥으로 비킨다", () => {
  const panelHalf = deg(27);
  const offset = panelYawOffset({ avoidYaw: 0, avoidHalf: deg(26), panelHalf });
  near(Math.abs(offset), deg(26) + deg(27) + MARGIN);
});

test("panelYawOffset: 시선이 장면에서 벗어나 있으면 덜 돌려도 되는 쪽을 고른다(겹침 없음)", () => {
  const panelHalf = deg(27);
  const avoidHalf = deg(26);
  // 장면이 시선 기준 왼쪽 20°에 있음: 오른쪽 가장자리 바깥(-20 - gap)이 아니라 왼쪽 바깥(+20 + gap)과 비교
  const offset = panelYawOffset({ avoidYaw: deg(20), avoidHalf, panelHalf });
  const gap = avoidHalf + panelHalf + MARGIN;
  near(offset, deg(20) - gap); // 오른쪽 후보가 시선(0)에 더 가깝다
  // 패널 범위가 장면 범위와 겹치지 않는다
  assert.ok(Math.abs(offset - deg(20)) >= avoidHalf + panelHalf);
});

test("panelYawOffset: 이미 장면에서 충분히 벗어나 있으면 정면에 연다", () => {
  assert.equal(panelYawOffset({ avoidYaw: deg(120), avoidHalf: deg(20), panelHalf: deg(27) }), 0);
});

test("panelYawOffset: 장면이 사방을 둘러싸면(반폭이 한계를 넘으면) 정면, 값이 이상해도 정면", () => {
  assert.equal(panelYawOffset({ avoidYaw: 0.2, avoidHalf: MAX_AVOID_HALF + 0.01, panelHalf: deg(27) }), 0);
  assert.equal(panelYawOffset({ avoidYaw: NaN, avoidHalf: deg(10), panelHalf: deg(27) }), 0);
  assert.equal(panelYawOffset({ avoidYaw: 0, avoidHalf: Math.PI, panelHalf: deg(27) }), 0);
});

test("panelYawOffset: 결과는 시선에서 105°를 넘지 않는다", () => {
  const offset = panelYawOffset({ avoidYaw: 0, avoidHalf: deg(60), panelHalf: deg(40) });
  assert.ok(Math.abs(offset) <= deg(105) + 1e-9);
});

test("도크: 윗변 기준점이 시선 앞·눈높이 아래에 있고 스크린(아래 29°)보다 아래다", () => {
  const head = new Vector3(0.5, 1.6, -0.3);
  for (const yaw of [0, 0.9, -2.2]) {
    const top = dockTop(head, yaw);
    near(top.y, head.y - DOCK_TOP_DROP);
    near(Math.hypot(top.x - head.x, top.z - head.z), DOCK_TOP_FORWARD);
    const angleBelow = Math.atan2(head.y - top.y, DOCK_TOP_FORWARD) * (180 / Math.PI);
    assert.ok(angleBelow > 29 + 2, `${angleBelow}°`);
  }
});

test("도크: 높이가 다른 평면(HUD·공용 패널)이 같은 윗변 기준점에 매달린다", () => {
  const head = new Vector3(0, 1.6, 0);
  for (const yaw of [0, 1.3]) {
    const top = dockTop(head, yaw);
    for (const height of [0.5, 0.9]) {
      const center = dockCenter(top, yaw, DOCK_TILT, height);
      // 평면 윗변 중심 = 중심 + 위쪽 방향 * 높이/2 → 기준점
      const up = new Vector3(0, 1, 0).applyEuler(dockRotation(yaw, DOCK_TILT));
      const topEdge = center.clone().addScaledVector(up, height / 2);
      near(topEdge.distanceTo(top), 0, 1e-9);
    }
    // 더 큰 평면일수록 중심이 아래·머리 쪽으로 내려온다(위로 올라가 스크린을 가리지 않는다)
    assert.ok(dockCenter(top, yaw, DOCK_TILT, 0.9).y < dockCenter(top, yaw, DOCK_TILT, 0.5).y);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { MARGIN, MAX_AVOID_HALF, angularHalf, panelYawOffset, yawOfDirection } from "../src/core/panel-layout.js";

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

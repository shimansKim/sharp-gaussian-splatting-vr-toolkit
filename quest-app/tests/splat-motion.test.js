import assert from "node:assert/strict";
import test from "node:test";
import { MOTION, approach, approachAngle, createMotion, headingAxes, smoothFactor, wrapAngle } from "../src/viewers/splat/splat-motion.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const none = { right: 0, forward: 0, up: 0 };

test("smoothFactor·approach: 반감기만큼 지나면 절반, dt를 쪼개도 같다", () => {
  near(smoothFactor(0.1, 0.1), 0.5);
  near(approach(0, 1, 0.1, 0.1), 0.5);
  let x = 0;
  for (let i = 0; i < 10; i++) x = approach(x, 1, 0.01, 0.1);
  near(x, 0.5);
  assert.equal(smoothFactor(0, 0.1), 0);
  assert.equal(smoothFactor(0.1, 0), 1);
});

test("wrapAngle·approachAngle: ±π 경계를 짧은 쪽으로", () => {
  near(wrapAngle(3 * Math.PI), Math.PI);
  near(wrapAngle(-0.5 - 4 * Math.PI), -0.5);
  const from = Math.PI - 0.1;
  const result = approachAngle(from, -Math.PI + 0.1, 0.1, 0.1); // 실제 차이는 +0.2
  const moved = Math.abs(wrapAngle(result - from));
  assert.ok(moved > 0 && moved < 0.2);
});

test("스틱을 밀면 부드럽게 올라가고 놓으면 부드럽게 멈춘다", () => {
  const motion = createMotion();
  const dt = 1 / 72;
  let last = 0;
  for (let i = 0; i < 72; i++) {
    const { forward } = motion.step({ ...none, forward: 1 }, 0, dt);
    assert.ok(forward >= last && forward <= 1);
    last = forward;
  }
  assert.ok(last > 0.99);
  // 첫 프레임은 목표의 일부만(즉시 점프하지 않음)
  const fresh = createMotion();
  assert.ok(fresh.step({ ...none, forward: 1 }, 0, dt).forward < 0.1);
  // 놓으면 점점 줄어 0으로
  let prev = last;
  for (let i = 0; i < 72 * 2; i++) {
    const { forward } = motion.step(none, 0, dt);
    assert.ok(forward <= prev);
    prev = forward;
  }
  assert.equal(prev, 0);
  assert.equal(motion.active, false);
  assert.equal(motion.step(none, 0, dt).moving, false);
});

test("프레임률이 달라도 같은 시간에 같은 만큼 움직인다(이동 거리 일치)", () => {
  const travel = (fps) => {
    const motion = createMotion();
    let distance = 0;
    for (let i = 0; i < fps; i++) distance += motion.step({ ...none, forward: 1 }, 0, 1 / fps).forward / fps; // 1초
    return distance;
  };
  // 적분 방식(왼쪽 합)의 차이만 남는다
  assert.ok(Math.abs(travel(30) - travel(120)) < 0.04, `${travel(30)} vs ${travel(120)}`);
  assert.ok(Math.abs(travel(72) - travel(90)) < 0.015);
});

test("이동 방향 기준(머리 방향): 멈춰 있으면 바로 맞추고, 움직이는 중 머리 잡음은 걸러진다", () => {
  const motion = createMotion();
  const dt = 1 / 72;
  const first = motion.step({ ...none, forward: 1 }, 1.0, dt);
  assert.equal(first.heading, 1.0); // 출발 때는 지연 없이 머리 방향
  for (let i = 0; i < 72; i++) motion.step({ ...none, forward: 1 }, 1.0, dt);
  // 머리 방향이 ±3° 잡음으로 흔들려도 heading은 거의 안 움직인다
  const samples = [];
  for (let i = 0; i < 144; i++) samples.push(motion.step({ ...none, forward: 1 }, 1.0 + (i % 2 ? 1 : -1) * 0.05, dt).heading);
  const spread = Math.max(...samples) - Math.min(...samples);
  assert.ok(spread < 0.02, `spread=${spread}`);
  // 크게 돌리면 따라간다(1초 뒤 대부분 도달)
  let heading = 0;
  for (let i = 0; i < 72; i++) heading = motion.step({ ...none, forward: 1 }, 2.0, dt).heading;
  assert.ok(heading > 1.9);
});

test("머리가 위·아래를 봐서 방향을 모르면(null) 이전 방향을 유지한다", () => {
  const motion = createMotion();
  motion.step({ ...none, forward: 1 }, 0.7, 1 / 72);
  const { heading } = motion.step({ ...none, forward: 1 }, null, 1 / 72);
  near(heading, 0.7);
  assert.equal(createMotion().step(none, null, 1 / 72).heading, 0);
});

test("reset: 속도와 방향을 지운다. 높이 이동도 같은 가감속", () => {
  const motion = createMotion();
  for (let i = 0; i < 30; i++) motion.step({ ...none, right: 1, up: 1 }, 0, 1 / 72);
  assert.equal(motion.active, true);
  motion.reset();
  assert.equal(motion.active, false);
  const { up } = motion.step({ ...none, up: -1 }, 0, 1 / 72);
  assert.ok(up < 0 && up > -0.1);
});

test("headingAxes: heading 0에서 정면 -z·오른쪽 +x, 90°면 정면이 -x", () => {
  const a = headingAxes(0);
  near(a.forward.x, 0);
  near(a.forward.z, -1);
  near(a.right.x, 1);
  near(a.right.z, 0);
  const b = headingAxes(Math.PI / 2);
  near(b.forward.x, -1);
  near(b.forward.z, 0);
  near(b.right.z, -1);
});

test("MOTION 기본값은 가감속이 100ms 안팎이다", () => {
  assert.ok(MOTION.accelHalfLife <= 0.15 && MOTION.decelHalfLife <= 0.15);
});

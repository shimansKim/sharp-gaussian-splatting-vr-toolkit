import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  STICK_INVERT,
  TARGET_DISTANCE,
  TARGET_RADIUS,
  createGripState,
  createSnapTurn,
  fitTransform,
  headingOf,
  oneHandGrab,
  robustBounds,
  turnAbout,
  twoHandGrab,
  worldCenter,
  yawOfQuaternion,
} from "../src/viewers/splat/splat-math.js";

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const nearVec = (a, b, eps = 1e-6) => {
  near(a.x, b.x, eps);
  near(a.y, b.y, eps);
  near(a.z, b.z, eps);
};
const quatYaw = (angle) => new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), angle);

test("yawOfQuaternion: Y축 회전만 뽑고 기울임은 무시한다", () => {
  near(yawOfQuaternion(quatYaw(0.7)), 0.7);
  near(yawOfQuaternion(quatYaw(-2.5)), -2.5);
  const tilted = new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), 0.9);
  near(yawOfQuaternion(tilted), 0);
});

test("headingOf: 정면 -z는 0, 왼쪽으로 돌면 양수", () => {
  near(headingOf(new THREE.Quaternion()), 0);
  near(headingOf(quatYaw(0.5)), 0.5);
});

test("robustBounds: 바깥 floater를 잘라 내고 중심·반지름을 구한다", () => {
  const points = [];
  for (let i = 0; i < 1000; i++) points.push((i % 10) - 4.5, ((i >> 2) % 10) - 4.5, 2 + (i % 7));
  points.push(5000, 5000, 5000, -5000, -5000, -5000); // floater 2개
  const bounds = robustBounds(new Float32Array(points));
  assert.ok(bounds.size.x < 11 && bounds.size.y < 11, `floater 제외: ${bounds.size.toArray()}`);
  near(bounds.center.x, 0, 0.6);
  assert.ok(bounds.radius > 3 && bounds.radius < 12);
  assert.equal(robustBounds(new Float32Array(0)), null);
});

test("fitTransform fit: 장면 중심이 눈앞 TARGET_DISTANCE, 반지름이 TARGET_RADIUS로 맞는다", () => {
  const bounds = { center: v(1, 0.5, -4), radius: 6, size: v(8, 4, 10) };
  for (const heading of [0, 1.1, -2.4]) {
    const head = v(0.3, 1.6, -0.2);
    const t = fitTransform(bounds, { headPosition: head, heading });
    near(t.scale, TARGET_RADIUS / 6);
    near(t.yaw, heading);
    const center = worldCenter(t, bounds.center);
    const forward = v(-Math.sin(heading), 0, -Math.cos(heading));
    const ahead = center.clone().sub(head).setY(0);
    near(ahead.length(), TARGET_DISTANCE, 1e-5);
    near(ahead.normalize().dot(forward), 1, 1e-6);
    assert.ok(center.y < head.y && center.y > head.y - 0.3);
  }
});

test("fitTransform: 장면이 아주 작거나 커도 같은 크기로 맞고 bounds가 없으면 크기 1", () => {
  const head = v(0, 1.6, 0);
  const small = fitTransform({ center: v(0, 0, 0), radius: 0.02, size: v(0, 0, 0) }, { headPosition: head, heading: 0 });
  near(small.scale, TARGET_RADIUS / 0.02, 1e-6);
  assert.equal(fitTransform(null, { headPosition: head, heading: 0 }).scale, 1);
});

test("fitTransform immersive: 장면 원점이 머리, 크기 1", () => {
  const head = v(1, 1.5, 2);
  const t = fitTransform(null, { headPosition: head, heading: 0.4, mode: "immersive" });
  nearVec(t.position, head);
  assert.equal(t.scale, 1);
  near(t.yaw, 0.4);
});

test("oneHandGrab: 손을 옮기면 장면이 같이 옮겨진다(회전 없이)", () => {
  const start = { handPosition: v(0, 1, -0.5), handQuaternion: new THREE.Quaternion(), transform: { position: v(0, 0, -1.2), yaw: 0.3, scale: 0.5 } };
  const t = oneHandGrab(start, { handPosition: v(0.4, 1.2, -0.7), handQuaternion: new THREE.Quaternion() });
  nearVec(t.position, v(0.4, 0.2, -1.4));
  near(t.yaw, 0.3);
  near(t.scale, 0.5);
});

test("oneHandGrab: 손을 좌우로 돌리면 손 위치를 축으로 장면이 같이 돈다", () => {
  const hand = v(0, 1, -0.5);
  const start = { handPosition: hand, handQuaternion: new THREE.Quaternion(), transform: { position: v(0, 1, -1.5), yaw: 0, scale: 1 } };
  const t = oneHandGrab(start, { handPosition: hand, handQuaternion: quatYaw(Math.PI / 2) });
  near(t.yaw, Math.PI / 2);
  // 손 기준 상대 위치 (0,0,-1)이 90° 돌아 (-1,0,0)이 된다
  nearVec(t.position, v(-1, 1, -0.5));
});

test("twoHandGrab: 손을 2배 벌리면 장면이 2배, 가운데 점 기준으로 커진다", () => {
  const start = { left: v(-0.2, 1, -0.5), right: v(0.2, 1, -0.5), transform: { position: v(0, 1, -1.5), yaw: 0, scale: 1 } };
  const t = twoHandGrab(start, { left: v(-0.4, 1, -0.5), right: v(0.4, 1, -0.5) }, { min: 0.01, max: 100 });
  near(t.scale, 2);
  // 가운데 점 (0,1,-0.5) 기준 상대 위치 (0,0,-1)이 (0,0,-2)가 된다
  nearVec(t.position, v(0, 1, -2.5));
});

test("twoHandGrab: 두 손을 잇는 선을 돌리면 장면이 돌고, 크기 한계로 잘린다", () => {
  const start = { left: v(-0.2, 1, -0.5), right: v(0.2, 1, -0.5), transform: { position: v(0, 1, -1.5), yaw: 0, scale: 1 } };
  // 오른손을 뒤(+z)로, 왼손을 앞(-z)으로: 두 손을 잇는 선이 90° 돈다
  const turned = twoHandGrab(start, { left: v(0, 1, -0.7), right: v(0, 1, -0.3) }, { min: 0.01, max: 100 });
  near(Math.abs(turned.yaw), Math.PI / 2, 1e-6);
  near(turned.scale, 1); // 손 사이 거리가 같으면 크기는 그대로
  const clamped = twoHandGrab(start, { left: v(-2, 1, -0.5), right: v(2, 1, -0.5) }, { min: 0.5, max: 3 });
  near(clamped.scale, 3);
  const tiny = twoHandGrab(start, { left: v(-0.001, 1, -0.5), right: v(0.001, 1, -0.5) }, { min: 0.5, max: 3 });
  near(tiny.scale, 0.5);
});

test("turnAbout: 머리 위치는 회전 뒤에도 같은 월드 좌표에 남는다", () => {
  const playerPosition = v(1, 0, -2);
  const playerYaw = 0.6;
  // 플레이어 로컬에서 머리가 (0.3, 1.6, -0.4)
  const headWorld = (position, yaw) => v(0.3, 1.6, -0.4).applyAxisAngle(v(0, 1, 0), yaw).add(position);
  const head = headWorld(playerPosition, playerYaw);
  const turned = turnAbout(playerPosition, playerYaw, head, 0.5236);
  nearVec(headWorld(turned.position, turned.yaw), head, 1e-6);
  near(turned.yaw, playerYaw + 0.5236);
});

test("createSnapTurn: 한 번 밀면 한 번만 돌고 가운데로 돌아와야 다시 돈다, 방향은 반전 규칙", () => {
  const snap = createSnapTurn();
  const angle = Math.PI / 6;
  // 이전 방향: 오른쪽 = 시점 오른쪽(음수). STICK_INVERT.x이면 반대(양수)
  const sign = STICK_INVERT.x ? 1 : -1;
  near(snap.step(0.9), sign * angle);
  assert.equal(snap.step(0.95), 0);
  assert.equal(snap.step(0.5), 0); // 아직 가운데로 안 옴
  assert.equal(snap.step(0.9), 0);
  assert.equal(snap.step(0.1), 0); // 가운데
  near(snap.step(-0.9), -sign * angle);
  assert.equal(createSnapTurn(angle, false).step(0.9), -angle);
  assert.equal(createSnapTurn(angle, true).step(0.9), angle);
});

test("createGripState: 히스테리시스(0.6에 켜지고 0.35 아래에서 꺼짐)", () => {
  const g = createGripState();
  assert.equal(g.update(0.5), false);
  assert.equal(g.update(0.7), true);
  assert.equal(g.update(0.5), true);
  assert.equal(g.update(0.3), false);
  assert.equal(g.update(0.5), false);
});

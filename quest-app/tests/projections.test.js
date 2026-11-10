import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Texture, Vector3 } from 'three';
import { LAYOUTS } from '../src/viewers/media/format-detect.js';
import { LAYER_LEFT, LAYER_RIGHT, MediaProjection, SCREEN_BASE_WIDTH, SCREEN_DISTANCE, SPHERE_RADIUS, buildScreenGeometry, buildSphereGeometry } from '../src/viewers/media/projections.js';

const FULL = { u0: 0, u1: 1, v0: 0, v1: 1 };
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

function vertex(geometry, index) {
  const p = geometry.getAttribute('position');
  return new Vector3(p.getX(index), p.getY(index), p.getZ(index));
}
function uv(geometry, index) {
  const t = geometry.getAttribute('uv');
  return [t.getX(index), t.getY(index)];
}

test('구: 정면(방위 0, 고도 0)은 -Z, 오른쪽(+방위)은 +X, 위(+고도)는 +Y', () => {
  const g = buildSphereGeometry({ azMin: -Math.PI, azMax: Math.PI, segU: 8, segV: 4, region: FULL });
  const cols = 9;
  // 고도 0 줄은 iv=2, 방위 0은 iu=4
  const front = vertex(g, 2 * cols + 4);
  assert.ok(near(front.x, 0) && near(front.y, 0) && near(front.z, -SPHERE_RADIUS), `정면 ${front.toArray()}`);
  const right = vertex(g, 2 * cols + 6); // 방위 +90°
  assert.ok(near(right.x, SPHERE_RADIUS) && near(right.z, 0), `오른쪽 ${right.toArray()}`);
  const top = vertex(g, 4 * cols + 4);
  assert.ok(near(top.y, SPHERE_RADIUS));
  // 텍스처: 정면은 u=0.5, v=0.5
  assert.deepEqual(uv(g, 2 * cols + 4).map((n) => +n.toFixed(4)), [0.5, 0.5]);
});

test('구: 모든 정점이 반지름 위에 있고 삼각형 법선이 바깥을 향한다(BackSide로 안쪽을 본다)', () => {
  const g = buildSphereGeometry({ azMin: -Math.PI / 2, azMax: Math.PI / 2, segU: 12, segV: 8, region: FULL });
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) assert.ok(near(vertex(g, i).length(), SPHERE_RADIUS, 1e-3));
  const index = g.getIndex();
  let outward = 0;
  let total = 0;
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const v0 = vertex(g, index.getX(i));
    const v1 = vertex(g, index.getX(i + 1));
    const v2 = vertex(g, index.getX(i + 2));
    const normal = a.subVectors(v1, v0).cross(b.subVectors(v2, v0));
    if (normal.lengthSq() < 1e-9) continue; // 극점의 퇴화 삼각형
    total++;
    if (normal.dot(v0) > 0) outward++;
  }
  assert.equal(outward, total);
});

test('VR180 반구는 방위 ±90°만 덮는다', () => {
  const g = buildSphereGeometry({ azMin: -Math.PI / 2, azMax: Math.PI / 2, segU: 8, segV: 4, region: FULL });
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) assert.ok(vertex(g, i).z <= 1e-3, '뒤쪽(+Z) 정점이 없어야 한다');
});

test('눈 영역이 UV에 반영된다', () => {
  const region = { u0: 0.5, u1: 1, v0: 0, v1: 0.5 };
  const g = buildSphereGeometry({ azMin: -Math.PI, azMax: Math.PI, segU: 4, segV: 2, region });
  assert.deepEqual(uv(g, 0), [0.5, 0]);
  assert.deepEqual(uv(g, g.getAttribute('uv').count - 1), [1, 0.5]);
});

test('평면: 크기와 UV 모서리', () => {
  const g = buildScreenGeometry({ width: 6, height: 3, region: { u0: 0, u1: 0.5, v0: 0, v1: 1 } });
  assert.deepEqual(vertex(g, 0).toArray(), [-3, -1.5, 0]);
  assert.deepEqual(vertex(g, 2).toArray(), [3, 1.5, 0]);
  assert.deepEqual(uv(g, 0), [0, 0]);
  assert.deepEqual(uv(g, 2), [0.5, 1]);
});

function projectionFor(layout, width, height) {
  const p = new MediaProjection(new Texture());
  p.setLayout(layout, { width, height });
  return p;
}

test('형식별 메시 개수와 눈 레이어', () => {
  for (const layout of Object.keys(LAYOUTS)) {
    const p = projectionFor(layout, 4096, 2048);
    const stereo = LAYOUTS[layout].stereo !== 'mono';
    assert.equal(p.meshes.length, stereo ? 2 : 1, layout);
    if (stereo) {
      assert.ok(p.meshes[0].layers.isEnabled(LAYER_LEFT) && !p.meshes[0].layers.isEnabled(LAYER_RIGHT), `${layout} 왼눈`);
      assert.ok(p.meshes[1].layers.isEnabled(LAYER_RIGHT) && !p.meshes[1].layers.isEnabled(0), `${layout} 오른눈`);
    } else {
      assert.ok(p.meshes[0].layers.isEnabled(0), `${layout} 모노는 두 눈 공통 레이어`);
    }
    p.dispose();
  }
});

test('눈 바꿈: 레이어는 그대로 두고 눈에 보이는 텍스처 영역만 서로 바뀐다', () => {
  const p = projectionFor('sbs180', 4096, 2048);
  const leftU = (m) => m.geometry.getAttribute('uv').getX(0);
  const [l, r] = p.meshes;
  assert.equal(leftU(l), 0); // 왼눈 메시 = 텍스처 왼쪽 절반
  assert.equal(leftU(r), 0.5);
  p.setLayout('sbs180', { swapEyes: true });
  const [sl, sr] = p.meshes;
  assert.ok(sl.layers.isEnabled(LAYER_RIGHT) && sr.layers.isEnabled(LAYER_LEFT));
  const byLayer = (layer) => p.meshes.find((m) => m.layers.isEnabled(layer));
  assert.equal(leftU(byLayer(LAYER_LEFT)), 0.5, '왼눈이 텍스처의 오른쪽 절반을 본다');
  assert.equal(leftU(byLayer(LAYER_RIGHT)), 0);
});

test('가상 스크린: Full SBS는 한쪽 눈 비율, 거리 4m, 배율 조절', () => {
  const p = projectionFor('sbsScreenFull', 3840, 1080);
  const g = p.meshes[0].geometry;
  const width = vertex(g, 2).x - vertex(g, 0).x;
  const height = vertex(g, 2).y - vertex(g, 0).y;
  assert.ok(near(width, SCREEN_BASE_WIDTH));
  assert.ok(near(width / height, 16 / 9, 1e-3));
  assert.equal(p.meshes[0].position.z, -SCREEN_DISTANCE);
  assert.equal(p.isScreen, true);
  p.setScreenScale(2);
  assert.ok(near(vertex(p.meshes[0].geometry, 2).x - vertex(p.meshes[0].geometry, 0).x, SCREEN_BASE_WIDTH * 2));
  p.setScreenScale(100);
  assert.equal(p.screenScale, 3);
  p.setScreenScale(0);
  assert.equal(p.screenScale, 0.3);
});

test('place/follow: 360은 머리 위치를 따라가고 스크린은 yaw 방향으로 놓는다', () => {
  const sphere = projectionFor('mono360', 4096, 2048);
  sphere.follow(new Vector3(1, 1.6, -2));
  assert.deepEqual(sphere.shell.position.toArray(), [1, 1.6, -2]);
  sphere.place(new Vector3(0, 0, 0), 1.2);
  assert.equal(sphere.shell.rotation.y, 0, '360 구는 회전하지 않는다');

  const screen = projectionFor('sbsScreenHalf', 1920, 1080);
  screen.place(new Vector3(0, 1.6, 0), Math.PI / 2); // 왼쪽(-X)을 보고 있다
  screen.shell.updateMatrixWorld(true);
  const center = new Vector3(0, 0, -SCREEN_DISTANCE).applyMatrix4(screen.shell.matrixWorld);
  assert.ok(near(center.x, -SCREEN_DISTANCE) && near(center.z, 0), `스크린 위치 ${center.toArray()}`);
  screen.follow(new Vector3(9, 9, 9));
  assert.equal(screen.shell.position.x, 0, '스크린은 follow로 움직이지 않는다');
});

test('알 수 없는 형식은 예외', () => {
  const p = new MediaProjection(new Texture());
  assert.throws(() => p.setLayout('nope'));
});

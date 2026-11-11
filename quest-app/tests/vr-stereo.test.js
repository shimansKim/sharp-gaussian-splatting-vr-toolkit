// m25: 영상·사진 입체·둘러싸기·끊김 수정에 쓰이는 순수 로직 검증.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix4, Quaternion, Texture, Vector3 } from 'three';
import { contentTurnDelta } from '../src/core/stick-rules.js';
import { detectLayout, refineDetectionWithSniff, sniffStereo } from '../src/viewers/media/format-detect.js';
import { layerSpec, mediaLayersSupported, worldToReferencePose } from '../src/viewers/media/layers-path.js';
import { recallLayout, rememberLayout } from '../src/viewers/media/layout-memory.js';
import { MAX_TURN_PITCH, MediaProjection, SCREEN_BASE_WIDTH, SCREEN_DISTANCE } from '../src/viewers/media/projections.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ── 스틱 방향 ─────────────────────────────────────────────────────────────
test('스틱: 오른쪽으로 밀면 장면이 오른쪽으로, 위로 밀면 장면이 위로 간다(반전 규칙)', () => {
  const right = contentTurnDelta(1, 0, 1, 1);
  const up = contentTurnDelta(0, -1, 1, 1); // 위쪽 스틱은 y 음수
  // 장면을 오른쪽으로 보내는 회전: 정면(-Z) 점이 +X로 간다
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), right.yaw);
  const front = new Vector3(0, 0, -1).applyQuaternion(q);
  assert.ok(front.x > 0.5, `정면 점이 오른쪽으로 이동 ${front.toArray()}`);
  const qp = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), up.pitch);
  const front2 = new Vector3(0, 0, -1).applyQuaternion(qp);
  assert.ok(front2.y > 0.5, `정면 점이 위로 이동 ${front2.toArray()}`);
});

test('스틱: PLY와 같은 STICK_INVERT 한 곳을 쓰고, 끄면 옛 규칙(시점이 따라감)', async () => {
  const { STICK_INVERT } = await import('../src/viewers/splat/splat-math.js');
  assert.deepEqual(STICK_INVERT, { x: true, y: true });
  assert.ok(contentTurnDelta(1, 0, 1, 1, { x: false, y: false }).yaw > 0, '반전을 끄면 오른쪽 스틱이 장면을 왼쪽으로(시점은 오른쪽으로)');
  assert.ok(contentTurnDelta(0, -1, 1, 1, { x: false, y: false }).pitch < 0);
});

// ── 스크린 크기 · 회전 ────────────────────────────────────────────────────
test('3D 스크린 기본값: 가로 시야각 약 90°(작은 TV가 아님)', () => {
  const fov = 2 * Math.atan(SCREEN_BASE_WIDTH / 2 / SCREEN_DISTANCE) * (180 / Math.PI);
  assert.ok(fov >= 85 && fov <= 110, `가로 시야각 ${fov.toFixed(1)}°`);
});

test('투영: 스틱 회전은 구·스크린 모두 머리를 중심으로 돌고, place()가 되돌린다', () => {
  const p = new MediaProjection(new Texture());
  p.setLayout('sbsScreenFull', { width: 3840, height: 1080 });
  p.place(new Vector3(0, 1.6, 0), 0);
  p.addTurn(Math.PI / 2, 0);
  p.shell.updateMatrixWorld(true);
  const c = new Vector3(0, 0, -SCREEN_DISTANCE).applyMatrix4(p.shell.matrixWorld);
  assert.ok(near(c.x, -SCREEN_DISTANCE, 1e-4) && near(c.z, 0, 1e-4), `90° 돌린 스크린 중심 ${c.toArray()}`);
  p.addTurn(0, 10);
  assert.ok(near(p.turn.pitch, MAX_TURN_PITCH), '위아래는 80°까지만');
  p.place(new Vector3(0, 1.6, 0), 0);
  assert.equal(p.turn.yaw, 0);
  assert.equal(p.turn.pitch, 0);
});

// ── 레이어 값 ─────────────────────────────────────────────────────────────
test('layerSpec: 형식별 눈 배치와 도형', () => {
  assert.deepEqual(
    (({ kind, layout, centralHorizontalAngle }) => ({ kind, layout, centralHorizontalAngle }))(layerSpec('sbs180')),
    { kind: 'equirect', layout: 'stereo-left-right', centralHorizontalAngle: Math.PI },
  );
  const s360 = layerSpec('tb360');
  assert.equal(s360.layout, 'stereo-top-bottom');
  assert.ok(near(s360.centralHorizontalAngle, Math.PI * 2));
  assert.equal(layerSpec('mono360').layout, 'mono');
  const full = layerSpec('sbsScreenFull', { width: 3840, height: 1080 });
  assert.equal(full.kind, 'quad');
  assert.equal(full.layout, 'stereo-left-right');
  assert.ok(near(full.width / full.height, 1920 / 1080, 1e-9), '눈 하나(1920x1080) 비율');
  assert.ok(near(full.width, SCREEN_BASE_WIDTH));
  const half = layerSpec('sbsScreenHalf', { width: 1920, height: 1080 });
  assert.ok(near(half.width / half.height, 1920 / 1080, 1e-9));
  assert.ok(near(layerSpec('sbsScreenFull', { width: 3840, height: 1080, screenScale: 2 }).width, SCREEN_BASE_WIDTH * 2));
  assert.equal(layerSpec('mono2d', { width: 1920, height: 1080 }).layout, 'mono');
});

test('layerSpec: 눈 바꿈은 확인된 메시 경로가 맡는다(null), 모노는 그대로', () => {
  assert.equal(layerSpec('sbs180', { swapEyes: true }), null);
  assert.ok(layerSpec('mono360', { swapEyes: true }));
  assert.equal(layerSpec('nope'), null);
});

test('mediaLayersSupported: XRMediaBinding이 없거나 layers 기능이 꺼져 있으면 false', () => {
  assert.equal(mediaLayersSupported(null), false);
  assert.equal(mediaLayersSupported({ enabledFeatures: ['layers'] }), false, 'XRMediaBinding 없음');
  globalThis.XRMediaBinding = class {};
  try {
    assert.equal(mediaLayersSupported({ enabledFeatures: ['layers', 'local'] }), true);
    assert.equal(mediaLayersSupported({ enabledFeatures: ['local'] }), false);
    assert.equal(mediaLayersSupported({}), true, 'enabledFeatures를 모르는 구현은 시도 후 폴백');
  } finally {
    delete globalThis.XRMediaBinding;
  }
});

test('worldToReferencePose: 플레이어가 움직여 있으면 그만큼 뺀 참조 공간 자세', () => {
  const player = new Matrix4().compose(new Vector3(2, 0, -1), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(1, 1, 1));
  // 월드 원점 앞(−Z) 3m 지점의 자세를 참조 공간으로
  const pose = worldToReferencePose(player, new Vector3(2, 0, -4), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
  // 플레이어가 왼쪽으로 90° 돌아 있으니, 월드에서 플레이어 앞 3m는 참조 공간에서도 플레이어 앞(−Z)이어야 한다.
  // 월드 (2,0,-4)는 플레이어(2,0,-1)에서 -Z로 3m → 플레이어 좌표로는 +X 3m(플레이어의 정면은 월드 -X)이고 회전은 상쇄된다.
  assert.ok(near(pose.position.x, 3, 1e-5) && near(pose.position.z, 0, 1e-5), JSON.stringify(pose.position));
  assert.ok(near(Math.abs(pose.orientation.w), 1, 1e-5));
  const identity = worldToReferencePose(new Matrix4(), new Vector3(1, 2, 3), new Quaternion());
  assert.deepEqual(identity.position, { x: 1, y: 2, z: 3 });
});

// ── 형식 판별 보강 ────────────────────────────────────────────────────────
function pseudo(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** 가로 폭 w, 높이 h의 무늬 그림. */
function scene(w, h, seed) {
  const rand = pseudo(seed);
  const cell = 4;
  const grid = [];
  for (let y = 0; y < Math.ceil(h / cell); y++) {
    grid.push(Array.from({ length: Math.ceil(w / cell) }, () => rand() * 255));
  }
  return (x, y) => grid[Math.floor(y / cell)][Math.floor(x / cell)];
}

test('sniffStereo: 같은 그림이 약간 어긋난 좌우 쌍은 sbs, 다른 두 그림은 mono', () => {
  const W = 128;
  const H = 64;
  const base = scene(W, H, 7);
  const luma = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W / 2; x++) {
      luma[y * W + x] = base(x, y);
      luma[y * W + W / 2 + x] = base(x + 2, y); // 시차 2px
    }
  }
  assert.equal(sniffStereo(luma, W, H).result, 'sbs');

  const a = scene(W / 2, H, 11);
  const b = scene(W / 2, H, 99);
  const mono = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W / 2; x++) {
      mono[y * W + x] = a(x, y);
      mono[y * W + W / 2 + x] = b(x, y);
    }
  }
  assert.equal(sniffStereo(mono, W, H).result, 'mono');
});

test('sniffStereo: 위아래 쌍은 tb, 밋밋한 그림은 판단 불가(null)', () => {
  const W = 64;
  const H = 128;
  const base = scene(W, H, 5);
  const luma = new Uint8Array(W * H);
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W; x++) {
      luma[y * W + x] = base(x, y);
      luma[(H / 2 + y) * W + x] = base(x + 1, y);
    }
  }
  assert.equal(sniffStereo(luma, W, H).result, 'tb');
  assert.equal(sniffStereo(new Uint8Array(W * H).fill(128), W, H).result, null);
});

test('refineDetectionWithSniff: 이름 없는 2:1 파일이 좌우 쌍이면 360 모노가 아니라 VR180 SBS', () => {
  const detected = detectLayout({ name: 'clip_0001.mp4', width: 5760, height: 2880 });
  assert.equal(detected.layout, 'mono360');
  assert.equal(detected.confidence, 'low');
  const refined = refineDetectionWithSniff(detected, { result: 'sbs' }, 2);
  assert.equal(refined.layout, 'sbs180');
  // 확신이 높은 판별(이름·메타)은 건드리지 않는다
  const named = detectLayout({ name: 'a_360.mp4', width: 3840, height: 1920 });
  assert.equal(refineDetectionWithSniff(named, { result: 'sbs' }, 2), named);
  // 판단 불가면 그대로
  assert.equal(refineDetectionWithSniff(detected, { result: null }, 2), detected);
  assert.equal(refineDetectionWithSniff(detected, { result: 'mono' }, 2), detected);
});

test('사람 파일 이름(*_3D_FSBS)은 눈당 16:9 평면 3D 스크린으로 판별한다(구로 억지로 바꾸지 않는다)', () => {
  for (const [name, w, h] of [
    ["IZ＊ONE (아이즈원) - 'Beware' MV_vr_sbs_30fps_3D_FSBS.mp4", 3840, 1080],
    ['sequence_4k30_vr_sbs_30fps_3D_FSBS.mp4', 7680, 2160],
    ['DJAWA_Maruemon_02_quest3_8k_3D_FSBS.mp4', 8192, 2730],
  ]) {
    const d = detectLayout({ name, width: w, height: h });
    assert.equal(d.layout, 'sbsScreenFull', name);
  }
});

// ── 파일별 형식 기억 ──────────────────────────────────────────────────────
test('layout-memory: 파일별로 고른 형식을 기억하고 최근 500개까지만 둔다', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    assert.equal(recallLayout('pc:/a.mp4'), null);
    rememberLayout('pc:/a.mp4', 'sbs180');
    rememberLayout('pc:/b.mp4', 'tb360');
    assert.equal(recallLayout('pc:/a.mp4'), 'sbs180');
    rememberLayout('pc:/a.mp4', 'mono360');
    assert.equal(recallLayout('pc:/a.mp4'), 'mono360');
    rememberLayout('pc:/c.mp4', 'nope'); // 모르는 형식은 무시
    assert.equal(recallLayout('pc:/c.mp4'), null);
    for (let i = 0; i < 520; i++) rememberLayout(`pc:/f${i}.mp4`, 'sbs360');
    assert.equal(recallLayout('pc:/a.mp4'), null, '오래된 것부터 밀려난다');
    assert.equal(recallLayout('pc:/f519.mp4'), 'sbs360');
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(recallLayout('pc:/x.mp4'), null, '저장소가 없어도 오류 없이 null');
  rememberLayout('pc:/x.mp4', 'sbs180');
});

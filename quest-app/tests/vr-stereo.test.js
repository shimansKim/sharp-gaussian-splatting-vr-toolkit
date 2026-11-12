// m25: 영상·사진 입체·둘러싸기·끊김 수정에 쓰이는 순수 로직 검증.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix4, Quaternion, Texture, Vector3 } from 'three';
import { contentTurnDelta } from '../src/core/stick-rules.js';
import { detectLayout, refineDetectionWithSniff, sniffStereo } from '../src/viewers/media/format-detect.js';
import { layerSpec, mediaLayersSupported, worldToReferencePose } from '../src/viewers/media/layers-path.js';
import { recallLayout, rememberLayout } from '../src/viewers/media/layout-memory.js';
import { LAYER_LEFT, LAYER_RIGHT, MAX_TURN_PITCH, MediaProjection, SCREEN_BASE_WIDTH, SCREEN_DISTANCE, eyeOfCamera } from '../src/viewers/media/projections.js';

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
test('3D 스크린: 배율 1은 가로 약 90°, 처음 크기는 그보다 작은 약 62°(사람 피드백: 너무 크게 나옴)', () => {
  const fovAt = (scale) => 2 * Math.atan((SCREEN_BASE_WIDTH * scale) / 2 / SCREEN_DISTANCE) * (180 / Math.PI);
  assert.ok(fovAt(1) >= 85 && fovAt(1) <= 110, `배율 1: ${fovAt(1).toFixed(1)}°`);
  const initial = fovAt(new MediaProjection(new Texture()).screenScale);
  assert.ok(initial >= 50 && initial <= 75, `처음 크기 ${initial.toFixed(1)}°`);
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

// ── 눈 분리: 서브카메라 판별 방식(layer 마스크에 의존하지 않음) ───────────────────
const fakeCamera = (...layers) => ({ layers: { isEnabled: (l) => layers.includes(l) } });

test('eyeOfCamera: XR 서브카메라는 순서(0=왼눈, 1=오른눈)로, 2D 미리보기는 눈 layer로 판별', () => {
  const l = fakeCamera(0);
  const r = fakeCamera(0);
  assert.equal(eyeOfCamera([l, r], l), 'left');
  assert.equal(eyeOfCamera([l, r], r), 'right');
  assert.equal(eyeOfCamera(null, fakeCamera(0, LAYER_LEFT)), 'left');
  assert.equal(eyeOfCamera(null, fakeCamera(0, LAYER_RIGHT)), 'right');
  assert.equal(eyeOfCamera([l], r), 'left', '서브카메라가 1개면(순서 판별 불가) layer로 판단');
});

test('눈 분리 camera 방식: 두 메시 모두 layer 0, 그릴 때 맞는 눈에서만 그리고 횟수를 센다', () => {
  const p = new MediaProjection(new Texture());
  assert.equal(p.eyeMethod, 'camera', '기본은 camera 방식');
  p.setLayout('sbsScreenFull', { width: 3840, height: 1080 });
  const [left, right] = p.meshes;
  assert.ok(left.layers.isEnabled(0) && right.layers.isEnabled(0));
  const camL = fakeCamera(0);
  const camR = fakeCamera(0);
  const renderer = { xr: { isPresenting: true, getCamera: () => ({ cameras: [camL, camR] }) } };
  const draw = (mesh, cam) => {
    mesh.onBeforeRender(renderer, null, cam);
    return mesh.geometry.drawRange.count;
  };
  assert.equal(draw(left, camL), Infinity, '왼눈 메시는 왼눈 패스에서 그림');
  assert.equal(draw(left, camR), 0, '왼눈 메시는 오른눈 패스에서 그리지 않음');
  assert.equal(draw(right, camR), Infinity);
  assert.equal(draw(right, camL), 0);
  assert.deepEqual({ ...p.eyeStats }, { left: 1, right: 1, mono: 0, cross: 0 });
});

test('눈 분리 mask 방식: layer로 걸러 주고, 틀린 눈에서 그려지면 cross로 센다', () => {
  const p = new MediaProjection(new Texture());
  p.setEyeMethod('mask');
  p.setLayout('sbs180', { width: 4096, height: 2048 });
  const [left, right] = p.meshes;
  assert.ok(left.layers.isEnabled(LAYER_LEFT) && right.layers.isEnabled(LAYER_RIGHT));
  const camL = fakeCamera(0, LAYER_LEFT);
  const camR = fakeCamera(0, LAYER_RIGHT);
  const renderer = { xr: { isPresenting: true, getCamera: () => ({ cameras: [camL, camR] }) } };
  left.onBeforeRender(renderer, null, camL);
  assert.equal(p.eyeStats.cross, 0);
  left.onBeforeRender(renderer, null, camR); // layer 마스크가 깨져 왼눈 메시가 오른눈에서 그려진 경우
  assert.equal(p.eyeStats.cross, 1);
  assert.equal(left.geometry.drawRange.count, Infinity, 'mask 방식은 그리는 개수를 건드리지 않는다');
});

test('눈 분리 camera 방식 + 눈 바꿈: 왼눈에는 텍스처 오른쪽 절반이 나간다', () => {
  const p = new MediaProjection(new Texture());
  p.setLayout('sbsScreenFull', { width: 3840, height: 1080, swapEyes: true });
  const camL = fakeCamera(0);
  const camR = fakeCamera(0);
  const renderer = { xr: { isPresenting: true, getCamera: () => ({ cameras: [camL, camR] }) } };
  const u0 = (m) => m.geometry.getAttribute('uv').getX(0);
  const shown = p.meshes.find((m) => {
    m.onBeforeRender(renderer, null, camL);
    return m.geometry.drawRange.count === Infinity;
  });
  assert.equal(u0(shown), 0.5, '왼눈 패스에서 그려진 메시가 텍스처 오른쪽 절반(u0=0.5)을 쓴다');
});

// ── 진단 줄 ───────────────────────────────────────────────────────────────
test('describeSource: 프록시·직접·기기 파일을 구분한다', async () => {
  const { describeSource } = await import('../src/viewers/media/media-diag.js');
  assert.match(describeSource('blob:https://x/abc'), /기기 파일/);
  assert.match(describeSource('https://app.example/base/__src/pc/files/a.mp4', 'https://app.example'), /프록시/);
  assert.equal(describeSource('http://192.168.0.5:8765/files/a.mp4', 'https://app.example'), '직접 http://192.168.0.5:8765');
  assert.equal(describeSource(''), '-');
});

test('diagLines: 경로·레이어 상태·눈 카메라·재생 통계가 줄로 나온다', async () => {
  const { diagLines } = await import('../src/viewers/media/media-diag.js');
  const lines = diagLines({
    path: 'mesh', pref: 'layers', layout: 'sbsScreenFull', kind: 'video', resolution: '3840×1080', presenting: true,
    layer: { active: false, error: '', reason: '이 브라우저에 XRMediaBinding 없음' },
    xr: { mediaBinding: false, layersFeature: '있음', stateLayers: ['XRProjectionLayer'], cameras: 2, masks: [3, 5], viewports: ['0+1440x1584', '1440+1440x1584'] },
    eye: { method: 'camera', rate: { left: 72, right: 72, cross: 0, mono: 0 } },
    video: { presentedFps: 25, nominalFps: 25, dropped: 3, total: 600, droppedInterval: 0, totalInterval: 125, readyState: 4, bufferAhead: 12.3, codec: 'avc1', bitrate: 17.1, source: '직접 http://192.168.0.5:8765' },
    frame: { avgMs: 13.9, maxMs: 31, slow: 2, count: 144 },
  });
  const text = lines.join('\n');
  assert.match(text, /경로 mesh\(선호 layers\)/);
  assert.match(text, /레이어 안 씀: 이 브라우저에 XRMediaBinding 없음/);
  assert.match(text, /XRMediaBinding 없음/);
  assert.match(text, /눈 카메라 2개 · 마스크 0b011 \/ 0b101/);
  assert.match(text, /L 72 R 72/);
  assert.match(text, /재생 25fps\(표시\) \/ 원본 25fps/);
  assert.match(text, /직접 http:\/\/192\.168\.0\.5:8765/);
  assert.equal(diagLines(null)[0], '(열린 항목 없음)');
});

// ── 영상·사진은 열면 바로 VR로 ────────────────────────────────────────────
test('vr-entry: 영상·사진만, 켜져 있고 VR이 가능하며 아직 VR 밖일 때만 바로 VR 요청', async () => {
  const { shouldAutoEnterVr, shouldShowVrPrompt, readAutoVr, writeAutoVr } = await import('../src/ui/vr-entry.js');
  const on = { enabled: true, supported: true, presenting: false };
  assert.equal(shouldAutoEnterVr({ ...on, kind: 'video' }), true);
  assert.equal(shouldAutoEnterVr({ ...on, kind: 'image' }), true);
  assert.equal(shouldAutoEnterVr({ ...on, kind: 'splat' }), false, 'PLY는 기존 동작 유지');
  assert.equal(shouldAutoEnterVr({ ...on, kind: 'video', enabled: false }), false);
  assert.equal(shouldAutoEnterVr({ ...on, kind: 'video', supported: false }), false);
  assert.equal(shouldAutoEnterVr({ ...on, kind: 'video', presenting: true }), false, '이미 VR이면 다시 요청하지 않는다');
  assert.equal(shouldShowVrPrompt({ kind: 'image', hasXr: true, presenting: false, dismissed: false }), true);
  assert.equal(shouldShowVrPrompt({ kind: 'image', hasXr: false, presenting: false, dismissed: false }), false, 'WebXR API가 없으면 안내하지 않는다');
  assert.equal(shouldShowVrPrompt({ kind: 'splat', hasXr: true, presenting: false, dismissed: false }), false);
  assert.equal(shouldShowVrPrompt({ kind: 'video', hasXr: true, presenting: true, dismissed: false }), false);
  assert.equal(shouldShowVrPrompt({ kind: 'video', hasXr: true, presenting: false, dismissed: true }), false);
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    assert.equal(readAutoVr(), true, '기본 켬');
    writeAutoVr(false);
    assert.equal(readAutoVr(), false);
    writeAutoVr(true);
    assert.equal(readAutoVr(), true);
  } finally {
    delete globalThis.localStorage;
  }
});

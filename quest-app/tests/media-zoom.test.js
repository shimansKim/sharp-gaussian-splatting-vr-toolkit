// 영상·사진 줌·위치 고정(m23): 줌 계산, 확대 기억, 파일을 넘겨도 화면이 저절로 옮겨지지 않는 것, R3·왼쪽 스틱 상하 조작
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Group, PerspectiveCamera, Texture, Vector3 } from 'three';
import { layerSpec } from '../src/viewers/media/layers-path.js';
import {
  DEFAULT_SCREEN_SCALE,
  MAX_SCREEN_SCALE,
  MAX_SPHERE_ZOOM,
  MIN_SCREEN_SCALE,
  MediaProjection,
  zoomRegion,
} from '../src/viewers/media/projections.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ── 줌 계산 ────────────────────────────────────────────────────────────────
test('zoomRegion: 영역 가운데를 기준으로 1/zoom만 잘라 낸다(1배 이하는 그대로)', () => {
  const full = { u0: 0, u1: 1, v0: 0, v1: 1 };
  assert.deepEqual(zoomRegion(full, 1), full);
  assert.deepEqual(zoomRegion(full, 0.5), full, '구는 줄일 수 없다');
  const z2 = zoomRegion(full, 2);
  assert.ok(near(z2.u0, 0.25) && near(z2.u1, 0.75) && near(z2.v0, 0.25) && near(z2.v1, 0.75));
  const half = zoomRegion({ u0: 0.5, u1: 1, v0: 0, v1: 1 }, 2); // SBS의 오른눈 영역
  assert.ok(near(half.u0, 0.625) && near(half.u1, 0.875), `오른눈 영역 가운데 ${half.u0}~${half.u1}`);
});

test('구 확대: UV만 다시 쓰고 지오메트리는 그대로(프레임마다 새로 만들지 않는다), 1~4배로 제한', () => {
  const p = new MediaProjection(new Texture());
  p.setLayout('mono360', { width: 4096, height: 2048 });
  const geometry = p.meshes[0].geometry;
  const uv = geometry.getAttribute('uv');
  assert.ok(near(uv.array[0], 0) && near(uv.array[1], 0));
  assert.equal(p.setZoom(2), 2);
  assert.equal(p.meshes[0].geometry, geometry, '지오메트리 재생성 없음');
  assert.ok(near(uv.array[0], 0.25) && near(uv.array[1], 0.25), '왼쪽 아래 모서리가 가운데 쪽으로 모인다');
  assert.equal(p.setZoom(100), MAX_SPHERE_ZOOM);
  assert.equal(p.setZoom(0.2), 1, '원래보다 작게는 못 줄인다');
  assert.ok(near(uv.array[0], 0));
});

test('스크린 확대: 같은 setZoom이 크기 배율을 바꾸고 한계를 지킨다', () => {
  const p = new MediaProjection(new Texture());
  p.setLayout('sbsScreenFull', { width: 3840, height: 1080 });
  assert.equal(p.zoom, DEFAULT_SCREEN_SCALE);
  assert.equal(p.setZoom(1.5), 1.5);
  assert.equal(p.setZoom(99), MAX_SCREEN_SCALE);
  assert.equal(p.setZoom(0), MIN_SCREEN_SCALE);
  assert.deepEqual(p.zoomRange, { min: MIN_SCREEN_SCALE, max: MAX_SCREEN_SCALE });
});

test('place(keepTurn): 형식만 바꿀 때는 돌려 둔 방향을 유지하고, 기본은 되돌린다', () => {
  const p = new MediaProjection(new Texture());
  p.setLayout('sbsScreenFull', { width: 3840, height: 1080 });
  p.place(new Vector3(0, 1.6, 0), 0);
  p.addTurn(0.5, 0.2);
  p.place(new Vector3(0, 1.6, 0), 0, { keepTurn: true });
  assert.ok(near(p.turn.yaw, 0.5) && near(p.turn.pitch, 0.2));
  p.place(new Vector3(0, 1.6, 0), 0);
  assert.equal(p.turn.yaw, 0);
  p.setTurn(1, 9);
  assert.equal(p.turn.yaw, 1);
  assert.ok(p.turn.pitch < 1.5, '위아래 한계');
});

test('layerSpec: 구를 확대하는 동안은 레이어를 못 써서 null(메시가 맡는다), 스크린은 확대해도 레이어', () => {
  assert.equal(layerSpec('mono360', { sphereZoom: 1 })?.kind, 'equirect');
  assert.equal(layerSpec('mono360', { sphereZoom: 1.5 }), null);
  assert.equal(layerSpec('sbs180', { sphereZoom: 2 }), null);
  const quad = layerSpec('sbsScreenFull', { width: 3840, height: 1080, screenScale: 0.6, sphereZoom: 3 });
  assert.equal(quad.kind, 'quad');
  assert.ok(near(quad.width, 6 * 0.6));
});

// ── 기기에 기억 ────────────────────────────────────────────────────────────
test('zoom-memory: 저장한 줌을 다시 읽고, 깨진 값·저장 불가는 기본값', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { loadZoom, saveZoom, zoomLabel } = await import('../src/viewers/media/zoom-memory.js');
  assert.deepEqual(loadZoom(), { screen: DEFAULT_SCREEN_SCALE, sphere: 1 });
  saveZoom({ screen: 1.2, sphere: 2.5 });
  assert.deepEqual(loadZoom(), { screen: 1.2, sphere: 2.5 });
  store.set('sharp.media.zoom.v1', JSON.stringify({ screen: 999, sphere: 'x' }));
  assert.deepEqual(loadZoom(), { screen: MAX_SCREEN_SCALE, sphere: 1 });
  store.set('sharp.media.zoom.v1', '{깨짐');
  assert.deepEqual(loadZoom(), { screen: DEFAULT_SCREEN_SCALE, sphere: 1 });
  assert.equal(zoomLabel('screen', DEFAULT_SCREEN_SCALE), '100%');
  assert.equal(zoomLabel('sphere', 2), '200%');
  globalThis.localStorage = { getItem: () => { throw new Error('막힘'); }, setItem: () => { throw new Error('막힘'); } };
  assert.deepEqual(loadZoom(), { screen: DEFAULT_SCREEN_SCALE, sphere: 1 });
  saveZoom({ screen: 1, sphere: 1 }); // 던지지 않는다
  delete globalThis.localStorage;
});

// ── 뷰어: 위치 고정·줌 조작 ────────────────────────────────────────────────
function fakeContext() {
  const target = { measureText: (t) => ({ width: String(t).length * 10 }) };
  return new Proxy(target, { get: (t, key) => (key in t ? t[key] : () => {}), set: () => true });
}

let MediaViewer;
before(async () => {
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }),
    body: null,
  };
  globalThis.createImageBitmap = async () => ({ width: 3840, height: 1080, close() {} });
  globalThis.fetch = async () => ({ ok: true, blob: async () => ({}) });
  ({ MediaViewer } = await import('../src/viewers/media/media-viewer.js'));
});

function makeStage() {
  const camera = new PerspectiveCamera(70, 1, 0.01, 100);
  camera.position.set(0, 1.6, 0);
  const scene = new Group();
  const state = { presenting: true };
  const stage = {
    camera,
    scene,
    content: scene,
    player: new Group(),
    renderer: {
      capabilities: { maxTextureSize: 8192 },
      xr: { isPresenting: true, getController: () => new Group(), getSession: () => null, getCamera: () => camera, addEventListener() {}, removeEventListener() {} },
    },
    isPresenting: () => state.presenting,
  };
  return { stage, camera, state };
}

const photo = (id) => ({ id, name: `${id}.jpg`, kind: 'image' });
const file = { name: 'a.jpg', url: 'blob:x', mime: 'image/jpeg', size: 1 };

function input({ left = {}, right = {} } = {}) {
  const hand = (o) => ({ connected: true, x: 0, y: 0, trigger: 0, grip: 0, primary: false, secondary: false, stick: false, stickPressed: false, primaryPressed: false, secondaryPressed: false, triggerPressed: false, gripPressed: false, ...o });
  return { presenting: true, left: hand(left), right: hand(right) };
}

function yawOf(viewer) {
  return viewer.projection.baseYaw;
}

test('파일을 넘겨도 화면·패널 자리와 돌려 둔 방향이 그대로다(머리를 돌려 둬도 따라 옮겨지지 않는다)', async () => {
  const { stage, camera } = makeStage();
  const viewer = new MediaViewer();
  viewer.mount(stage);
  await viewer.load(photo('a'), file);
  const yaw0 = yawOf(viewer);
  const hudPos = viewer.hud.mesh.position.clone();
  viewer.projection.addTurn(0.4, 0.1);
  // 사용자가 머리를 90° 돌리고 몇 걸음 걸어간 뒤 다음 파일을 연다.
  camera.rotation.set(0, Math.PI / 2, 0);
  camera.position.set(2, 1.6, 1);
  camera.updateMatrixWorld(true);
  await viewer.load(photo('b'), file);
  assert.ok(near(yawOf(viewer), yaw0), `화면 방향 ${yawOf(viewer)} ≠ ${yaw0}`);
  assert.ok(viewer.hud.mesh.position.distanceTo(hudPos) < 1e-9, '패널도 제자리');
  assert.ok(near(viewer.projection.turn.yaw, 0.4) && near(viewer.projection.turn.pitch, 0.1), '돌려 둔 방향도 이어진다');
  // 형식을 바꿔도(눈 바꿈 포함) 제자리
  viewer.setSwapEyes(true);
  viewer.cycleLayout(1);
  assert.ok(near(yawOf(viewer), yaw0));
  assert.ok(near(viewer.projection.turn.yaw, 0.4));
  viewer.dispose();
});

test('R3(오른쪽 스틱 누르기)만 지금 보는 방향으로 다시 맞춘다 — 그립은 아무것도 하지 않는다', async () => {
  const { stage, camera } = makeStage();
  const viewer = new MediaViewer();
  viewer.mount(stage);
  await viewer.load(photo('a'), file);
  viewer.hud.setVisible(false);
  viewer.projection.addTurn(0.4, 0);
  const yaw0 = yawOf(viewer);
  camera.rotation.set(0, Math.PI / 2, 0);
  camera.updateMatrixWorld(true);
  viewer.update(0.016, input({ left: { gripPressed: true, grip: 1 }, right: { gripPressed: true, grip: 1 } }));
  assert.equal(viewer.hud.visible, false, '그립으로 패널이 불려 오지 않는다');
  assert.ok(near(yawOf(viewer), yaw0), '그립으로 화면이 옮겨지지 않는다');
  viewer.update(0.016, input({ right: { stickPressed: true, stick: true } }));
  assert.ok(near(yawOf(viewer), Math.PI / 2, 1e-3), `R3 뒤 화면 방향 ${yawOf(viewer)}`);
  assert.equal(viewer.projection.turn.yaw, 0, '돌려 둔 양도 지운다');
  viewer.dispose();
});

test('왼쪽 스틱 위로 줌인·아래로 줌아웃, 좌우가 큰 입력은 줌하지 않고, 값은 파일을 넘겨도 유지·기억된다', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const { stage } = makeStage();
  const viewer = new MediaViewer();
  viewer.mount(stage);
  await viewer.load(photo('a'), file);
  const start = viewer.projection.zoom;
  assert.equal(start, DEFAULT_SCREEN_SCALE, '처음은 작게');
  for (let i = 0; i < 20; i++) viewer.update(0.05, input({ left: { y: -1 } }));
  const bigger = viewer.projection.zoom;
  assert.ok(bigger > start * 1.5, `줌인 ${start} → ${bigger}`);
  assert.equal(store.size, 0, '스틱을 쥐고 있는 동안에는 저장하지 않는다');
  viewer.update(0.05, input({ left: { y: 0 } }));
  assert.ok(store.get('sharp.media.zoom.v1')?.includes('"screen"'), '스틱을 놓으면 기억한다');
  for (let i = 0; i < 20; i++) viewer.update(0.05, input({ left: { y: 1 } }));
  assert.ok(viewer.projection.zoom < bigger, '아래로 밀면 줌아웃');
  viewer.update(0.05, input({ left: { y: 0 } }));
  const before = viewer.projection.zoom;
  viewer.update(0.05, input({ left: { x: 0.9, y: 0.5 } }));
  assert.equal(viewer.projection.zoom, before, '대각선이라도 좌우가 더 크면 이전·다음/되감기 쪽');
  await viewer.load(photo('b'), file);
  assert.equal(viewer.projection.zoom, before, '다음 파일도 같은 줌');
  viewer.dispose();
  // 앱을 다시 켠 것처럼 새 뷰어도 기억한 값으로 시작
  const again = new MediaViewer();
  again.mount(makeStage().stage);
  await again.load(photo('c'), file);
  assert.ok(near(again.projection.zoom, before, 1e-6));
  again.dispose();
  delete globalThis.localStorage;
});

test('패널 줌 +/−·위치 맞춤 버튼: 같은 동작이 되고 360 구는 확대만 된다', async () => {
  const { stage } = makeStage();
  const viewer = new MediaViewer();
  viewer.mount(stage);
  await viewer.load(photo('a'), file);
  const z0 = viewer.projection.zoom;
  viewer._onHudAction('sizeUp');
  assert.ok(viewer.projection.zoom > z0);
  viewer._onHudAction('sizeDown');
  assert.ok(near(viewer.projection.zoom, z0, 1e-9));
  viewer.setLayout('mono360');
  assert.equal(viewer.projection.zoom, 1, '구는 원래 크기에서 시작');
  viewer._onHudAction('sizeDown');
  assert.equal(viewer.projection.zoom, 1, '구는 더 줄일 수 없다');
  viewer._onHudAction('sizeUp');
  assert.ok(viewer.projection.zoom > 1);
  assert.equal(viewer.getState().zoom, viewer.projection.zoom);
  viewer.dispose();
});

test('세션이 시작될 때와 위치 맞춤을 누를 때만 자리를 새로 잡는다', async () => {
  const { stage, camera } = makeStage();
  const viewer = new MediaViewer();
  viewer.mount(stage);
  await viewer.load(photo('a'), file);
  camera.rotation.set(0, -Math.PI / 2, 0);
  camera.updateMatrixWorld(true);
  viewer.update(0.016, input());
  viewer.update(0.016, input());
  assert.ok(near(yawOf(viewer), 0, 1e-6), '프레임이 지나도 저절로 옮겨지지 않는다');
  viewer._onHudAction('recenter');
  assert.ok(near(yawOf(viewer), -Math.PI / 2, 1e-3), '위치 맞춤 버튼 ' + yawOf(viewer) + ' ' + viewer.layout);
  viewer.dispose();
});

// ── 공용 UI 상태(core/ui-state.js, app-dev m22)와의 연결 ───────────────────────
test('UI 끄기·켜기: 재생 컨트롤이 같이 꺼지고 같은 자리에서 되살아나며, 꺼진 동안은 새로 띄우지 않는다', async () => {
  const { ui } = await import('../src/core/ui-state.js');
  const { emit } = await import('../src/core/events.js');
  const { stage } = makeStage();
  const viewer = new MediaViewer();
  viewer.mount(stage);
  await viewer.load(photo('a'), file);
  assert.equal(viewer.hud.visible, true);
  const pos = viewer.hud.mesh.position.clone();
  ui.setVisible(false);
  assert.equal(viewer.hud.visible, false, '끄면 같은 프레임에 꺼진다(main.js가 hud.visible로 판단)');
  viewer.showHud();
  viewer.toggleHud();
  assert.equal(viewer.hud.visible, false, '꺼진 동안 새로 띄우지 않는다');
  await viewer.load(photo('b'), file);
  assert.equal(viewer.hud.visible, false, '꺼진 동안 파일을 열어도 안 뜬다');
  ui.setVisible(true);
  assert.equal(viewer.hud.visible, true, '켜면 동기적으로 되살아난다');
  assert.ok(viewer.hud.mesh.position.distanceTo(pos) < 1e-9, '같은 자리');
  // 꺼질 때 숨겨져 있었다면 켜도 숨김 그대로
  viewer.hideHud();
  ui.setVisible(false);
  ui.setVisible(true);
  assert.equal(viewer.hud.visible, false);
  viewer.showHud();
  // 공용 패널이 열려 있으면 켜도 재생 컨트롤을 되살리지 않는다
  viewer.onPanelToggle(true);
  ui.setVisible(false);
  ui.setVisible(true);
  assert.equal(viewer.hud.visible, false);
  viewer.onPanelToggle(false);
  assert.equal(viewer.hud.visible, true, '패널을 닫으면 돌아온다');
  // 앵커가 바뀔 때(ui:anchor)만 재생 컨트롤을 다시 놓는다
  viewer.recenter();
  assert.ok(viewer.hud.mesh.position.distanceTo(pos) < 1e-9, '화면 위치 맞춤은 재생 컨트롤을 옮기지 않는다');
  stage.camera.rotation.set(0, Math.PI / 2, 0);
  stage.camera.updateMatrixWorld(true);
  ui.relocate(stage.camera);
  assert.ok(viewer.hud.mesh.position.distanceTo(pos) > 0.1, 'UI 재배치(ui:anchor)가 오면 새 자리로');
  viewer.dispose();
  emit('ui:anchor', { reason: 'relocate' }); // 해제 뒤에는 아무 일도 없다
  ui.resetForSession();
});

// ── 왼쪽 스틱 대각선: 줌과 넘기기·되감기가 같이 나가지 않는다 ─────────────────────
test('splitLeftStick: 좌우가 더 클 때만 x, 그렇지 않으면(같을 때 포함) y만 남긴다', async () => {
  const { splitLeftStick } = await import('../src/core/stick-rules.js');
  assert.deepEqual(splitLeftStick(0.8, -0.9), { x: 0, y: -0.9 }, '위로 더 많이 밀면 줌');
  assert.deepEqual(splitLeftStick(0.9, -0.8), { x: 0.9, y: 0 }, '옆으로 더 많이 밀면 넘기기·되감기');
  assert.deepEqual(splitLeftStick(0.7, 0.7), { x: 0, y: 0.7 }, '같으면 줌');
  assert.deepEqual(splitLeftStick(0, 0), { x: 0, y: 0 });
  assert.deepEqual(splitLeftStick(), { x: 0, y: 0 });
});

test('사진 넘기기(createFlick) 경로: 대각선(x≈0.8, y≈-0.9)은 넘기지 않고, 옆으로 더 밀면 넘긴다', async () => {
  const { splitLeftStick } = await import('../src/core/stick-rules.js');
  const { createFlick } = await import('../src/core/input-map.js');
  const flick = createFlick({ cooldownMs: 0 });
  assert.equal(flick.update(splitLeftStick(0.8, -0.9).x), 0);
  flick.update(0);
  assert.equal(flick.update(splitLeftStick(0.9, -0.2).x), 1);
  flick.update(0);
  assert.equal(flick.update(splitLeftStick(-0.9, 0.3).x), -1);
});

test('뷰어: 대각선은 줌만(되감기 없음), 옆으로 더 크면 되감기만(줌 없음)', async () => {
  const { stage } = makeStage();
  const viewer = new MediaViewer();
  viewer.mount(stage);
  await viewer.load(photo('a'), file);
  viewer.item.kind = 'video'; // 영상처럼 되감기를 받게 한다
  const fake = { paused: true, ended: false, currentTime: 50, duration: 100, muted: false, loop: false, pause() {}, removeEventListener() {}, removeAttribute() {}, load() {}, remove() {} };
  viewer.video = fake;
  const z0 = viewer.projection.zoom;
  viewer.update(0.05, input({ left: { x: 0.8, y: -0.9 } }));
  assert.ok(viewer.projection.zoom > z0, '줌 됨');
  assert.equal(fake.currentTime, 50, '같은 프레임에 되감기는 안 나간다');
  const z1 = viewer.projection.zoom;
  viewer.update(0.05, input({ left: { x: 0.9, y: -0.8 } }));
  assert.equal(viewer.projection.zoom, z1, '옆으로 더 크면 줌하지 않는다');
  assert.equal(fake.currentTime, 60, '10초 빨리감기');
  viewer.video = null;
  viewer.dispose();
});

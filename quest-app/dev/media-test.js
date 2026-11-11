// 미디어 뷰어 단독 검증 하네스(개발 전용, 앱 빌드에는 들어가지 않는다).
// xr-stage·library 없이 MediaViewer를 같은 계약(7.3)으로 붙여 데스크톱 브라우저에서 형식별로 확인한다.
// 열기: npm run dev → https://localhost:5173/dev/media-test.html
import { Group, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer } from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createMediaViewer } from '../src/viewers/media/media-viewer.js';
import { LAYOUTS, LAYOUT_ORDER } from '../src/viewers/media/format-detect.js';
import { LAYER_LEFT, LAYER_RIGHT } from '../src/viewers/media/projections.js';
import { PATTERN_SIZES, canvasToFile, makePatternCanvas } from './pattern-canvas.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');

// ── WebXR 에뮬레이션(선택): ?emulate=1 이면 Meta Quest 3 기기를 흉내 낸다(IWER, CDN에서 불러옴) ──
// 사람 손이 닿는 실기기 대신 VR 세션·컨트롤러 입력 경로를 데스크톱에서 점검하는 용도다.
if (new URLSearchParams(location.search).get('emulate')) {
  const { XRDevice, metaQuest3 } = await import('https://cdn.jsdelivr.net/npm/iwer@2.2.0/build/iwer.module.min.js');
  const device = new XRDevice(metaQuest3);
  device.installRuntime();
  device.position.set(0, 1.6, 0);
  window.__xrDevice = device;
}

// ── 무대(xr-stage 대역) ────────────────────────────────────────────────────
const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.xr.enabled = true;
const scene = new Scene();
const camera = new PerspectiveCamera(70, 1, 0.05, 200);
const player = new Group();
const content = new Group();
camera.position.set(0, 1.6, 0);
player.add(camera);
scene.add(player, content);

const stage = {
  renderer,
  scene,
  camera,
  player,
  content,
  isPresenting: () => renderer.xr.isPresenting,
  enterVR: async () => {},
  exitVR: async () => renderer.xr.getSession()?.end(),
  resetPlayer: () => {
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
  },
};

const viewer = createMediaViewer();
viewer.mount(stage);

// ── 상태 표시 ─────────────────────────────────────────────────────────────
const layoutSelect = $('layout');
for (const key of LAYOUT_ORDER) layoutSelect.add(new Option(`${LAYOUTS[key].label} (${key})`, key));

let expected = null; // 자동 판별 검증용 기대 형식
function renderStatus(extra = '') {
  const s = viewer.getState();
  const lines = [
    `항목: ${s.name || '-'} (${s.kind ?? '-'})`,
    `형식: ${s.layout ?? '-'}  해상도: ${s.resolution || '-'}`,
    `판별: ${s.detected ? `${s.detected.layout} [${s.detected.confidence}] ${s.detected.reasons.join(' / ')}` : '-'}`,
    s.kind === 'video' ? `재생: ${s.playing ? '재생 중' : '정지'} ${s.time.toFixed(1)} / ${s.duration.toFixed(1)}s  소리 ${s.muted ? '끔' : '켬'}  반복 ${s.loop ? '켬' : '끔'}` : '',
    s.decode ? `디코드: ${s.decode.family ?? '?'} ${s.decode.codec ?? ''} 지원=${s.decode.supported} 부드러움=${s.decode.smooth} 경고=${s.decode.warnings.map((w) => `[${w.level}] ${w.code}`).join(', ') || '없음'}` : '',
    s.meta ? `MP4: ${s.meta.codec} ${s.meta.width}x${s.meta.height} ${s.meta.frameRate?.toFixed?.(1)}fps ${(s.meta.bitrate / 1e6).toFixed(1)}Mbps st3d=${s.meta.stereoMode ?? '-'} proj=${s.meta.projection ?? '-'}` : '',
    extra,
  ].filter(Boolean);
  $('status').textContent = lines.join('\n');
  layoutSelect.value = s.layout ?? '';

  const verdict = $('verdict');
  if (expected && s.detected) {
    const ok = s.detected.layout === expected;
    verdict.className = ok ? 'pass' : 'fail';
    verdict.textContent = ok ? `자동 판별 통과: ${expected}` : `자동 판별 불일치: 기대 ${expected}, 결과 ${s.detected.layout}`;
  } else {
    verdict.className = '';
    verdict.textContent = '';
  }
}
for (const type of ['state', 'layoutchange', 'warning', 'error']) {
  viewer.addEventListener(type, (e) => renderStatus(type === 'error' ? `오류: ${e.detail.message}` : type === 'warning' ? `경고: ${e.detail.text}` : ''));
}
setInterval(renderStatus, 500);

// ── 열기 ──────────────────────────────────────────────────────────────────
let currentFile = null;
async function openItem(item, file) {
  currentFile?.release();
  currentFile = file;
  try {
    await viewer.load(item, file);
  } catch (error) {
    console.error('[media-test] load failed', error);
    renderStatus(`열기 실패: ${error.message}`);
  }
  renderStatus();
}

function kindOf(name, mime) {
  if (/^video\//.test(mime || '') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(name)) return 'video';
  return 'image';
}

function fileToOpened(file) {
  const url = URL.createObjectURL(file);
  return { url, size: file.size, name: file.name, mime: file.type, release: () => URL.revokeObjectURL(url) };
}

$('file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  expected = null;
  await openItem({ id: `session:${file.name}`, sourceId: 'session', name: file.name, kind: kindOf(file.name, file.type), size: file.size, mime: file.type }, fileToOpened(file));
});

/** 형식별 파일 이름(실제 파일 이름 관례). 자동 판별이 이 이름을 보고 같은 형식을 내야 한다. */
const PATTERN_NAMES = {
  mono360: 'pattern_360.png',
  tb360: 'pattern_360_TB.png',
  sbs360: 'pattern_360_SBS.png',
  sbs180: 'pattern_VR180_SBS.png',
  mono180: 'pattern_VR180_mono.png',
  sbsScreenFull: 'pattern_FSBS.png',
  sbsScreenHalf: 'pattern_HSBS.png',
  tbScreen: 'pattern_TB.png',
  mono2d: 'pattern_flat.png',
};

async function openPattern(layout) {
  const auto = $('autodetect').checked;
  const file = await canvasToFile(makePatternCanvas(layout), PATTERN_NAMES[layout]);
  expected = auto ? layout : null;
  const item = { id: `session:${file.name}`, sourceId: 'session', name: file.name, kind: 'image', size: file.size, mime: file.type };
  if (!auto) item.layout = layout;
  await openItem(item, fileToOpened(file));
}

for (const layout of Object.keys(PATTERN_SIZES)) {
  const b = document.createElement('button');
  b.textContent = LAYOUTS[layout].short;
  b.title = LAYOUTS[layout].label;
  b.addEventListener('click', () => openPattern(layout));
  $('patterns').append(b);
}

async function openFromQuery() {
  const q = new URLSearchParams(location.search);
  if (q.has('pattern')) {
    $('autodetect').checked = q.get('auto') !== '0';
    await openPattern(q.get('pattern'));
  } else if (q.has('src')) {
    const src = q.get('src');
    const name = q.get('name') || decodeURIComponent(src.split('/').pop().split('?')[0]);
    const item = { id: `session:${name}`, sourceId: 'session', name, kind: q.get('kind') || kindOf(name, ''), mime: q.get('mime') || undefined };
    if (q.get('layout')) item.layout = q.get('layout');
    await openItem(item, { url: src, name, mime: item.mime, release() {} });
  }
  if (q.get('eye')) setEye(q.get('eye'));
  if (q.get('yaw')) look.yaw = (Number(q.get('yaw')) * Math.PI) / 180;
  if (q.get('pitch')) look.pitch = (Number(q.get('pitch')) * Math.PI) / 180;
}

// ── 버튼 ──────────────────────────────────────────────────────────────────
$('play').onclick = () => viewer.togglePlay();
$('back').onclick = () => viewer.seekBy(-10);
$('fwd').onclick = () => viewer.seekBy(10);
$('hud').onclick = () => viewer.toggleHud();
$('lprev').onclick = () => viewer.cycleLayout(-1);
$('lnext').onclick = () => viewer.cycleLayout(1);
$('swap').onclick = () => viewer.setSwapEyes(!viewer.getState().swapEyes);
layoutSelect.onchange = () => viewer.setLayout(layoutSelect.value);
$('title').onclick = () => $('panel').classList.toggle('collapsed');

let eyeMode = 'left';
function setEye(mode) {
  eyeMode = mode;
  for (const b of document.querySelectorAll('#eyes button')) b.classList.toggle('on', b.dataset.eye === mode);
}
for (const b of document.querySelectorAll('#eyes button')) b.onclick = () => setEye(b.dataset.eye);

$('vr').append(VRButton.createButton(renderer));

// ── 마우스: 둘러보기 + 패널 누르기 ────────────────────────────────────────────
const look = { yaw: 0, pitch: 0 };
const raycaster = new Raycaster();
const ndc = new Vector2();
let drag = null;

function pointerRay(e) {
  const rect = canvas.getBoundingClientRect();
  let x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (eyeMode === 'both') x = (x * 2) % 1; // 좌우 나란히면 반쪽 화면 기준
  ndc.set(x * 2 - 1, -(y * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  return raycaster;
}

canvas.addEventListener('pointerdown', (e) => {
  camera.updateMatrixWorld(true);
  const ray = pointerRay(e);
  const hit = viewer.hud.visible && viewer.hud.intersect(ray.ray.origin, ray.ray.direction);
  canvas.setPointerCapture(e.pointerId);
  if (hit) {
    drag = { type: 'hud' };
    viewer.setMousePointer(ray, true);
  } else {
    drag = { type: 'look', x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
  }
});
canvas.addEventListener('pointermove', (e) => {
  camera.updateMatrixWorld(true);
  if (drag?.type === 'look') {
    look.yaw += (e.clientX - drag.x) * 0.005;
    look.pitch = Math.max(-1.5, Math.min(1.5, look.pitch + (e.clientY - drag.y) * 0.005));
    drag.x = e.clientX;
    drag.y = e.clientY;
  } else if (drag?.type === 'hud') {
    viewer.setMousePointer(pointerRay(e), true);
  } else {
    // 패널 위 호버
    viewer.setMousePointer(viewer.hud.visible ? pointerRay(e) : null, false);
  }
});
const endDrag = (e) => {
  if (drag?.type === 'hud') viewer.setMousePointer(pointerRay(e), false);
  drag = null;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  camera.fov = Math.max(25, Math.min(110, camera.fov + Math.sign(e.deltaY) * 4));
  camera.updateProjectionMatrix();
  e.preventDefault();
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.key === ' ') { viewer.togglePlay(); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') viewer.seekBy(-10);
  else if (e.key === 'ArrowRight') viewer.seekBy(10);
  else if (e.key === 'h') viewer.toggleHud();
  else if (e.key === 'l') viewer.cycleLayout(1);
});

// ── XR 입력 → XrInput(계약) ───────────────────────────────────────────────
const prev = { left: {}, right: {} };
function handInput(side, sources) {
  const src = sources.find((s) => s.handedness === side && s.gamepad);
  const out = { connected: !!src, x: 0, y: 0, trigger: 0, grip: 0, primary: false, secondary: false, primaryPressed: false, secondaryPressed: false, triggerPressed: false, gripPressed: false };
  if (src) {
    const g = src.gamepad;
    const ax = (i) => (Math.abs(g.axes[i] ?? 0) < 0.15 ? 0 : g.axes[i]);
    out.x = ax(2);
    out.y = ax(3);
    out.trigger = g.buttons[0]?.value ?? 0;
    out.grip = g.buttons[1]?.value ?? 0;
    out.primary = !!g.buttons[4]?.pressed;
    out.secondary = !!g.buttons[5]?.pressed;
  }
  const p = prev[side];
  out.primaryPressed = out.primary && !p.primary;
  out.secondaryPressed = out.secondary && !p.secondary;
  out.triggerPressed = out.trigger > 0.6 && !(p.trigger > 0.6);
  out.gripPressed = out.grip > 0.6 && !(p.grip > 0.6);
  prev[side] = out;
  return out;
}

// ── 렌더 루프 ─────────────────────────────────────────────────────────────
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = (eyeMode === 'both' ? w / 2 : w) / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let last = performance.now();
renderer.setAnimationLoop((time) => {
  const dt = Math.min(0.1, (time - last) / 1000);
  last = time;
  const presenting = renderer.xr.isPresenting;
  const sources = presenting ? [...(renderer.xr.getSession()?.inputSources ?? [])] : [];
  const input = { presenting, left: handInput('left', sources), right: handInput('right', sources) };

  if (!presenting) {
    camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
    camera.aspect = (eyeMode === 'both' ? window.innerWidth / 2 : window.innerWidth) / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
  viewer.update(dt, input);

  if (presenting) {
    renderer.render(scene, camera);
    return;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (eyeMode === 'both') {
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, w / 2, h);
    renderer.setScissor(0, 0, w / 2, h);
    camera.layers.set(0);
    camera.layers.enable(LAYER_LEFT);
    renderer.render(scene, camera);
    renderer.setViewport(w / 2, 0, w / 2, h);
    renderer.setScissor(w / 2, 0, w / 2, h);
    camera.layers.set(0);
    camera.layers.enable(LAYER_RIGHT);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  } else {
    camera.layers.set(0);
    camera.layers.enable(eyeMode === 'right' ? LAYER_RIGHT : LAYER_LEFT);
    renderer.render(scene, camera);
  }
});

resize();
openFromQuery();

// 자동화·콘솔 점검용
window.__media = { viewer, stage, look, openPattern, setEye, get expected() { return expected; } };
// 실기기 원격 디버깅 수집기(앱과 같은 이름)가 이 하네스에도 붙을 수 있게 한다.
window.__sharpQuest = { mediaViewer: viewer, stage };

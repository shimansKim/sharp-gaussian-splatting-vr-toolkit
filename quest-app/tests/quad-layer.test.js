import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CURSOR_PATCH, QUAD_LAYER_EXTENT_FACTOR, QuadLayerSurface, UI_LAYER_KEY, quadLayerGeometry, quadLayerSupported, setUiLayerPreferred, uiLayerEnabled, uiLayerPreferred } from "../src/core/quad-layer.js";

const W = 1024;
const H = 960;

/** 호출을 기록하는 가짜 WebGL2 컨텍스트. */
function fakeGl() {
  const calls = [];
  const consts = {
    TEXTURE_BINDING_2D: "TEXTURE_BINDING_2D",
    DRAW_FRAMEBUFFER_BINDING: "DRAW_FRAMEBUFFER_BINDING",
    READ_FRAMEBUFFER_BINDING: "READ_FRAMEBUFFER_BINDING",
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: "UNPACK_PREMULTIPLY_ALPHA_WEBGL",
    UNPACK_FLIP_Y_WEBGL: "UNPACK_FLIP_Y_WEBGL",
    SCISSOR_TEST: "SCISSOR_TEST",
    TEXTURE_2D: "TEXTURE_2D",
    RGBA8: "RGBA8",
    RGBA: "RGBA",
    UNSIGNED_BYTE: "UNSIGNED_BYTE",
    LINEAR: "LINEAR",
    TEXTURE_MIN_FILTER: "MIN",
    TEXTURE_MAG_FILTER: "MAG",
    TEXTURE_WRAP_S: "WRAP_S",
    TEXTURE_WRAP_T: "WRAP_T",
    CLAMP_TO_EDGE: "CLAMP",
    READ_FRAMEBUFFER: "READ_FB",
    DRAW_FRAMEBUFFER: "DRAW_FB",
    COLOR_ATTACHMENT0: "COLOR0",
    COLOR_BUFFER_BIT: 0x4000,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    NO_ERROR: 0,
  };
  const state = { scissor: false, drawFb: "prev-draw", readFb: "prev-read", texture: "prev-tex", getError: 0, status: 0x8cd5 };
  const gl = {
    ...consts,
    calls,
    state,
    getParameter: (name) => ({ DRAW_FRAMEBUFFER_BINDING: state.drawFb, READ_FRAMEBUFFER_BINDING: state.readFb, TEXTURE_BINDING_2D: state.texture }[name] ?? false),
    isEnabled: () => state.scissor,
    enable: (c) => calls.push(["enable", c]),
    disable: (c) => calls.push(["disable", c]),
    createTexture: () => ({ id: "srcTex" }),
    createFramebuffer: () => ({ id: `fb${calls.filter((c) => c[0] === "createFramebuffer").length}` }),
    deleteTexture: (t) => calls.push(["deleteTexture", t.id]),
    deleteFramebuffer: (f) => calls.push(["deleteFramebuffer", f.id]),
    bindTexture: (target, tex) => calls.push(["bindTexture", tex?.id ?? tex]),
    texStorage2D: (...args) => calls.push(["texStorage2D", ...args]),
    texParameteri: () => {},
    pixelStorei: (name, value) => calls.push(["pixelStorei", name, value]),
    texSubImage2D: (...args) => calls.push(["texSubImage2D", ...args]),
    bindFramebuffer: (target, fb) => calls.push(["bindFramebuffer", target, fb?.id ?? fb]),
    framebufferTexture2D: (target, att, texTarget, tex) => calls.push(["framebufferTexture2D", target, tex?.id ?? tex]),
    checkFramebufferStatus: () => state.status,
    blitFramebuffer: (...args) => calls.push(["blit", ...args]),
    getError: () => state.getError,
  };
  const origCreate = gl.createFramebuffer;
  gl.createFramebuffer = () => {
    calls.push(["createFramebuffer"]);
    return origCreate();
  };
  return gl;
}

/** 작은 조각 캔버스 가짜: 그린 동작을 기록한다. */
function fakeScratch() {
  const ops = [];
  const ctx = {
    clearRect: (...a) => ops.push(["clearRect", ...a]),
    drawImage: (...a) => ops.push(["drawImage", ...a]),
    beginPath: () => ops.push(["beginPath"]),
    arc: (...a) => ops.push(["arc", ...a]),
    fill: () => ops.push(["fill"]),
    stroke: () => ops.push(["stroke"]),
  };
  return { width: 0, height: 0, ops, getContext: () => ctx };
}

function setup({ features = ["layers"], binding = {}, withFrame = true, player = null } = {}) {
  const gl = fakeGl();
  const proj = { name: "projection" };
  const session = {
    enabledFeatures: features,
    renderState: { layers: [proj] },
    updateRenderState(patch) {
      this.renderState = { ...this.renderState, ...patch };
    },
  };
  const created = [];
  const fullBinding = {
    createQuadLayer(init) {
      const layer = { ...init, destroyed: false, destroy() { this.destroyed = true; } };
      created.push(layer);
      return layer;
    },
    getSubImage: (layer, frame) => ({ colorTexture: { id: "layerTex" }, viewport: { x: 0, y: 0, width: W, height: H }, frame, layer }),
    ...binding,
  };
  const xr = {
    getSession: () => session,
    getBinding: () => fullBinding,
    getReferenceSpace: () => ({ space: "local-floor" }),
    getFrame: () => (withFrame ? { frame: 1 } : null),
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.125), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 1.2, -1);
  const canvas = { width: W, height: H };
  const scratch = fakeScratch();
  const surface = new QuadLayerSurface({
    stage: { renderer: { getContext: () => gl, xr }, player },
    canvas,
    mesh,
    widthM: 1.2,
    heightM: 1.125,
    enabled: () => true,
    makeTransform: (position, orientation) => ({ position, orientation }),
    makeScratch: () => scratch,
  });
  return { surface, gl, session, proj, created, mesh, xr, canvas, scratch };
}

test("uiLayerPreferred: 기본은 켬, ?uilayer=0·저장값 off로 끄고, 주소가 저장값보다 앞선다", () => {
  const storage = (value) => ({ getItem: (key) => (key === UI_LAYER_KEY ? value : null) });
  assert.equal(uiLayerPreferred({ search: "", storage: storage(null) }), true);
  assert.equal(uiLayerPreferred({ search: "?uilayer=0", storage: storage(null) }), false);
  assert.equal(uiLayerPreferred({ search: "?uilayer=off", storage: storage(null) }), false);
  assert.equal(uiLayerPreferred({ search: "", storage: storage("off") }), false);
  assert.equal(uiLayerPreferred({ search: "?uilayer=1", storage: storage("off") }), true);
  assert.equal(uiLayerPreferred({ search: "", storage: { getItem: () => { throw new Error("blocked"); } } }), true);
});

test("quadLayerSupported: 바인딩 함수와 layers 기능이 있어야 한다", () => {
  const binding = { createQuadLayer() {}, getSubImage() {} };
  assert.equal(quadLayerSupported({ enabledFeatures: ["layers"] }, binding), true);
  assert.equal(quadLayerSupported({}, binding), true); // enabledFeatures를 모르면 시도
  assert.equal(quadLayerSupported({ enabledFeatures: ["local-floor"] }, binding), false);
  assert.equal(quadLayerSupported({ enabledFeatures: ["layers"] }, {}), false);
  assert.equal(quadLayerSupported({ enabledFeatures: ["layers"] }, null), false);
  assert.equal(quadLayerSupported(null, binding), false);
});

test("레이어를 못 쓰는 환경(IWER 등)이면 메시로 폴백하고 다시 시도하지 않는다", () => {
  const { surface, session, proj } = setup({ binding: { createQuadLayer: undefined } });
  assert.equal(surface.sync(true), false);
  assert.equal(surface.active, false);
  assert.equal(surface.failed, true);
  assert.match(surface.lastError, /지원하지 않음/);
  assert.deepEqual(session.renderState.layers, [proj]);
  assert.equal(surface.sync(true), false);
  surface.detach(); // 세션이 끝나면 다시 시도할 수 있다
  assert.equal(surface.failed, false);
});

test("layers 기능이 없는 세션도 폴백", () => {
  const { surface } = setup({ features: ["local-floor"] });
  assert.equal(surface.sync(true), false);
  assert.equal(surface.failed, true);
});

test("레이어를 만들어 프로젝션 레이어 위에 붙이고, 캔버스를 위아래 뒤집어 복사한다", () => {
  const { surface, gl, session, proj, created } = setup();
  assert.equal(surface.sync(true), true);
  assert.equal(surface.active, true);
  assert.equal(created.length, 1);
  const layer = created[0];
  assert.equal(layer.viewPixelWidth, W);
  assert.equal(layer.viewPixelHeight, H);
  assert.equal(layer.layout, "mono");
  assert.equal(layer.isStatic, false);
  // 레이어에는 전체 크기의 반을 넘긴다(Quest는 width·height를 반 크기로 해석): 메시 1.2 × 1.125m → 0.6 × 0.5625
  assert.ok(Math.abs(layer.width - 0.6) < 1e-9 && Math.abs(layer.height - 0.5625) < 1e-9);
  assert.deepEqual(layer.transform.position, { x: 0, y: 1.2, z: -1 });
  assert.deepEqual(session.renderState.layers, [proj, layer]); // UI가 PLY(프로젝션 레이어) 위
  const blit = gl.calls.find((c) => c[0] === "blit");
  assert.deepEqual(blit.slice(1, 9), [0, 0, W, H, 0, H, W, 0]); // dst의 y를 뒤집음
  assert.equal(gl.calls.filter((c) => c[0] === "texSubImage2D").length, 1);
});

test("GL 상태를 되돌린다: 프레임버퍼 바인딩·scissor·텍스처·픽셀 저장 설정", () => {
  const { surface, gl } = setup();
  gl.state.scissor = true;
  surface.sync(true);
  const binds = gl.calls.filter((c) => c[0] === "bindFramebuffer");
  assert.deepEqual(binds.slice(-2), [["bindFramebuffer", "DRAW_FB", "prev-draw"], ["bindFramebuffer", "READ_FB", "prev-read"]]);
  assert.ok(gl.calls.some((c) => c[0] === "disable" && c[1] === "SCISSOR_TEST"));
  assert.ok(gl.calls.some((c) => c[0] === "enable" && c[1] === "SCISSOR_TEST"));
  assert.ok(gl.calls.filter((c) => c[0] === "bindTexture").pop()[1] === "prev-tex");
  // 레이어 텍스처를 프레임버퍼에서 뗀다
  const detach = gl.calls.filter((c) => c[0] === "framebufferTexture2D" && c[1] === "DRAW_FB").pop();
  assert.equal(detach[2], null);
  // premultiply·flip을 켰다가 원래 값(false)으로
  const stores = gl.calls.filter((c) => c[0] === "pixelStorei");
  assert.deepEqual(stores.map((c) => c.slice(1)), [["UNPACK_FLIP_Y_WEBGL", false], ["UNPACK_PREMULTIPLY_ALPHA_WEBGL", true], ["UNPACK_PREMULTIPLY_ALPHA_WEBGL", false], ["UNPACK_FLIP_Y_WEBGL", false]]);
});

test("캔버스는 다시 그렸을 때만 올리고, 복사는 매 프레임 한다", () => {
  const { surface, gl } = setup();
  surface.sync(true);
  surface.sync(true);
  surface.sync(true);
  assert.equal(gl.calls.filter((c) => c[0] === "texSubImage2D").length, 1);
  assert.equal(gl.calls.filter((c) => c[0] === "blit").length, 3);
  surface.invalidate();
  surface.sync(true);
  assert.equal(gl.calls.filter((c) => c[0] === "texSubImage2D").length, 2);
});

test("프레임버퍼 검사·getError는 첫 복사에서만 한다(GPU 왕복 회피)", () => {
  const { surface, gl } = setup();
  let status = 0;
  let errors = 0;
  gl.checkFramebufferStatus = () => (status++, gl.FRAMEBUFFER_COMPLETE);
  gl.getError = () => (errors++, 0);
  for (let i = 0; i < 5; i++) surface.sync(true);
  assert.equal(status, 2); // read + draw, 첫 복사 한 번
  assert.equal(errors, 1);
});

test("자세·크기는 바뀐 때만 레이어에 반영한다", () => {
  const { surface, created, mesh } = setup();
  let transforms = 0;
  surface.makeTransform = (position, orientation) => (transforms++, { position, orientation });
  surface.sync(true);
  const afterCreate = transforms;
  surface.sync(true);
  surface.sync(true);
  assert.equal(transforms, afterCreate); // 그대로면 갱신 없음
  mesh.position.x = 0.5;
  surface.sync(true);
  assert.equal(transforms, afterCreate + 1);
  assert.ok(Math.abs(created[0].transform.position.x - 0.5) < 1e-9);
  mesh.scale.setScalar(0.5);
  surface.sync(true);
  assert.ok(Math.abs(created[0].width - 0.3) < 1e-9); // 메시 scale 0.5 → 전체 0.6m → 레이어 값 0.3
});

test("플레이어가 움직여 있으면 참조 공간 자세에서 그만큼 뺀다", () => {
  const player = new THREE.Group();
  player.position.set(1, 0, 0);
  const { surface, created } = setup({ player });
  surface.sync(true);
  assert.ok(Math.abs(created[0].transform.position.x - -1) < 1e-9); // 월드 x=0 → 플레이어 기준 -1
});

test("숨기면 레이어를 목록에서 빼고(메시가 보이게), 다시 보이면 같은 레이어를 되살린다", () => {
  const { surface, session, proj, created } = setup();
  surface.sync(true);
  assert.equal(surface.sync(false), false);
  assert.equal(surface.active, false);
  assert.deepEqual(session.renderState.layers, [proj]);
  assert.equal(surface.sync(true), true);
  assert.equal(created.length, 1); // 새로 만들지 않음
  assert.deepEqual(session.renderState.layers, [proj, created[0]]);
});

test("복사 중 오류가 나면 그 자리에서 레이어를 걷고 메시로 폴백한다(세션 동안 재시도 없음)", () => {
  const { surface, session, proj, created } = setup({ binding: { getSubImage() { throw new Error("InvalidStateError"); } } });
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    assert.equal(surface.sync(true), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(surface.failed, true);
  assert.match(surface.lastError, /InvalidStateError/);
  assert.equal(created[0].destroyed, true);
  assert.deepEqual(session.renderState.layers, [proj]);
  assert.equal(warnings.length, 1);
  assert.equal(surface.sync(true), false);
  assert.equal(created.length, 1);
});

test("프레임버퍼가 불완전하면 폴백한다", () => {
  const { surface, gl } = setup();
  gl.state.status = 0x8cd6;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(surface.sync(true), false);
  } finally {
    console.warn = warn;
  }
  assert.match(surface.lastError, /불완전/);
});

test("GL 오류가 나면 폴백한다", () => {
  const { surface, gl } = setup();
  gl.state.getError = 0x502;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(surface.sync(true), false);
  } finally {
    console.warn = warn;
  }
  assert.match(surface.lastError, /GL 오류 0x502/);
});

test("꺼져 있으면(enabled false) 레이어를 만들지 않는다", () => {
  const { surface, created } = setup();
  surface.enabled = () => false;
  assert.equal(surface.sync(true), false);
  assert.equal(created.length, 0);
});

test("XR 프레임 밖이면 직전 상태를 유지하고, 세션이 바뀌면 새 레이어를 만든다", () => {
  const first = setup({ withFrame: false });
  assert.equal(first.surface.sync(true), false); // 아직 한 번도 못 그림
  const { surface, xr, created } = setup();
  surface.sync(true);
  const newSession = {
    enabledFeatures: ["layers"],
    renderState: { layers: [{ name: "projection2" }] },
    updateRenderState(patch) {
      this.renderState = { ...this.renderState, ...patch };
    },
  };
  xr.getSession = () => newSession;
  assert.equal(surface.sync(true), true);
  assert.equal(created.length, 2);
  assert.equal(created[0].destroyed, true);
  assert.equal(newSession.renderState.layers.length, 2);
});

test("dispose: 레이어와 GL 자원을 정리한다", () => {
  const { surface, gl, session, proj, created } = setup();
  surface.sync(true);
  surface.dispose();
  assert.equal(created[0].destroyed, true);
  assert.deepEqual(session.renderState.layers, [proj]);
  assert.ok(gl.calls.some((c) => c[0] === "deleteTexture"));
  assert.equal(gl.calls.filter((c) => c[0] === "deleteFramebuffer").length, 2);
});

test("2D 설정 토글: 끄면 'off'를 저장하고 켜면 항목을 지우며, 캐시된 값이 바로 바뀐다", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  setUiLayerPreferred(false, storage);
  assert.equal(data.get(UI_LAYER_KEY), "off");
  assert.equal(uiLayerEnabled(), false);
  assert.equal(uiLayerPreferred({ search: "", storage }), false); // 다음 실행에도 꺼짐
  setUiLayerPreferred(true, storage);
  assert.equal(data.has(UI_LAYER_KEY), false);
  assert.equal(uiLayerEnabled(), true);
  assert.equal(uiLayerPreferred({ search: "", storage }), true);
  // 저장이 막혀도 이번 실행에는 적용
  const blocked = { setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.doesNotThrow(() => setUiLayerPreferred(false, blocked));
  assert.equal(uiLayerEnabled(), false);
  setUiLayerPreferred(true, storage);
});

test("QuadLayerSurface 기본 enabled는 설정 토글을 따른다", () => {
  const { surface, created } = setup();
  surface.enabled = uiLayerEnabled;
  setUiLayerPreferred(false, { setItem() {}, removeItem() {} });
  assert.equal(surface.sync(true), false);
  assert.equal(created.length, 0);
  setUiLayerPreferred(true, { setItem() {}, removeItem() {} });
  assert.equal(surface.sync(true), true);
});

/** 텍스처 업로드 기록: 전체(캔버스)인지 조각(작은 캔버스)인지와 위치. */
function uploads(gl, canvas) {
  return gl.calls
    .filter((c) => c[0] === "texSubImage2D")
    .map((c) => ({ x: c[3], y: c[4], full: c[7] === canvas }));
}

test("커서 점은 패널 전체를 다시 올리지 않고 점 주변 작은 조각만 올린다", () => {
  const { surface, gl, canvas, scratch } = setup();
  surface.sync(true); // 처음에는 전체 한 번
  const base = uploads(gl, canvas).length;
  assert.equal(base, 1);
  surface.setCursor("right", { x: 300, y: 400 });
  surface.sync(true);
  const afterFirst = uploads(gl, canvas).slice(base);
  assert.deepEqual(afterFirst, [{ x: 300 - CURSOR_PATCH / 2, y: 400 - CURSOR_PATCH / 2, full: false }]); // 점 조각 하나
  // 조각: 캔버스 해당 사각형을 옮기고 그 위에 점을 그린다
  assert.ok(scratch.ops.some((op) => op[0] === "drawImage" && op[2] === 284 && op[3] === 384 && op[4] === CURSOR_PATCH));
  assert.ok(scratch.ops.some((op) => op[0] === "arc" && op[1] === 16 && op[2] === 16));
  assert.equal(scratch.width, CURSOR_PATCH);
  // 옮기면: 이전 자리를 캔버스 그림으로 되돌리는 조각 + 새 자리 조각, 전체 업로드 없음
  const before = uploads(gl, canvas).length;
  surface.setCursor("right", { x: 340, y: 400 });
  surface.sync(true);
  assert.deepEqual(uploads(gl, canvas).slice(before), [
    { x: 284, y: 384, full: false }, // 이전 자리 복원
    { x: 324, y: 384, full: false }, // 새 자리
  ]);
  assert.equal(uploads(gl, canvas).filter((u) => u.full).length, 1);
  // 복사는 매 프레임 그대로
  assert.equal(gl.calls.filter((c) => c[0] === "blit").length, 3);
});

test("커서를 빼면 이전 자리만 복원하고, 1px 미만으로 움직이면 아무것도 올리지 않는다", () => {
  const { surface, gl, canvas } = setup();
  surface.sync(true);
  surface.setCursor("left", { x: 100, y: 100 });
  surface.sync(true);
  const n = uploads(gl, canvas).length;
  surface.setCursor("left", { x: 100.4, y: 100.3 });
  surface.sync(true);
  assert.equal(uploads(gl, canvas).length, n);
  surface.setCursor("left", null);
  surface.sync(true);
  assert.deepEqual(uploads(gl, canvas).slice(n), [{ x: 84, y: 84, full: false }]);
  surface.setCursor("left", null);
  surface.sync(true);
  assert.equal(uploads(gl, canvas).length, n + 1);
});

test("가장자리에서는 조각이 캔버스 안에 들어오게 자리를 맞춘다", () => {
  const { surface, gl, canvas } = setup();
  surface.sync(true);
  const n = uploads(gl, canvas).length;
  surface.setCursor("left", { x: 2, y: 3 });
  surface.setCursor("right", { x: W - 1, y: H - 1 });
  surface.sync(true);
  assert.deepEqual(uploads(gl, canvas).slice(n), [
    { x: 0, y: 0, full: false },
    { x: W - CURSOR_PATCH, y: H - CURSOR_PATCH, full: false },
  ]);
});

test("패널을 다시 그려 전체를 올리면 지금 커서 조각을 다시 얹는다", () => {
  const { surface, gl, canvas } = setup();
  surface.sync(true);
  surface.setCursor("right", { x: 500, y: 500 });
  surface.sync(true);
  const n = uploads(gl, canvas).length;
  surface.invalidate();
  surface.sync(true);
  assert.deepEqual(uploads(gl, canvas).slice(n), [
    { x: 0, y: 0, full: true },
    { x: 484, y: 484, full: false }, // 전체가 커서를 지웠으니 되돌림 조각 없이 새 조각만
  ]);
});

test("숨겼다 다시 보이면 커서는 지워지고 깨끗한 캔버스를 처음부터 올린다", () => {
  const { surface, gl, canvas } = setup();
  surface.sync(true);
  surface.setCursor("right", { x: 500, y: 500 });
  surface.sync(true);
  surface.sync(false);
  const n = uploads(gl, canvas).length;
  surface.sync(true);
  assert.deepEqual(uploads(gl, canvas).slice(n), [{ x: 0, y: 0, full: true }]); // 커서 조각 없음
});

test("복사 오류로 failed가 된 뒤 세션이 끝나 detach하면 다음 세션에 다시 시도한다", () => {
  let fail = true;
  const { surface, created } = setup({ binding: { getSubImage() { if (fail) throw new Error("InvalidStateError"); return { colorTexture: { id: "t" }, viewport: { x: 0, y: 0, width: W, height: H } }; } } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(surface.sync(true), false);
    assert.equal(surface.failed, true);
    assert.equal(surface.sync(true), false); // 같은 세션에서는 재시도 없음
    assert.equal(created.length, 1);
    surface.detach(); // 세션 종료
    fail = false;
    assert.equal(surface.sync(true), true); // 다음 세션
    assert.equal(created.length, 2);
  } finally {
    console.warn = warn;
  }
});

/** 레이어가 컴포지터에서 차지하는 네 모서리(월드 좌표): 전체 크기 = 넘긴 값 ÷ QUAD_LAYER_EXTENT_FACTOR. */
function layerCornersWorld(geometry, playerMatrix) {
  const fullW = geometry.width / QUAD_LAYER_EXTENT_FACTOR;
  const fullH = geometry.height / QUAD_LAYER_EXTENT_FACTOR;
  const q = new THREE.Quaternion(geometry.orientation.x, geometry.orientation.y, geometry.orientation.z, geometry.orientation.w);
  const p = new THREE.Vector3(geometry.position.x, geometry.position.y, geometry.position.z);
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) =>
    new THREE.Vector3((sx * fullW) / 2, (sy * fullH) / 2, 0).applyQuaternion(q).add(p).applyMatrix4(playerMatrix));
}

function meshCornersWorld(mesh, widthM, heightM) {
  mesh.updateWorldMatrix(true, false);
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => new THREE.Vector3((sx * widthM) / 2, (sy * heightM) / 2, 0).applyMatrix4(mesh.matrixWorld));
}

test("레이어 네 모서리 = 히트 테스트 메시 네 모서리(배율·기울임·플레이어 이동·회전 포함)", () => {
  const cases = [
    { pos: [0, 1.6, -1.25], rot: [0, 0, 0], scale: 1, player: { pos: [0, 0, 0], yaw: 0 } },
    { pos: [0.3, 1.0, -1.2], rot: [-0.72, 0.4, 0], scale: 0.8, player: { pos: [0, 0, 0], yaw: 0 } },
    { pos: [-0.5, 1.2, -0.9], rot: [-0.3, -1.1, 0], scale: 0.5, player: { pos: [1, 0.2, -2], yaw: 0.7 } },
    { pos: [2, 0.4, 3], rot: [0.2, 2.5, 0.1], scale: 1.3, player: { pos: [-3, 1, 0.5], yaw: -2.1 } },
  ];
  for (const c of cases) {
    const player = new THREE.Group();
    player.position.set(...c.player.pos);
    player.rotation.y = c.player.yaw;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.125), new THREE.MeshBasicMaterial());
    mesh.position.set(...c.pos);
    mesh.rotation.set(c.rot[0], c.rot[1], c.rot[2], "YXZ");
    mesh.scale.setScalar(c.scale);
    player.updateWorldMatrix(true, false);
    mesh.updateWorldMatrix(true, false);
    const geometry = quadLayerGeometry(mesh.matrixWorld, player.matrixWorld, 1.2, 1.125);
    const layer = layerCornersWorld(geometry, player.matrixWorld);
    const hit = meshCornersWorld(mesh, 1.2, 1.125);
    layer.forEach((corner, i) => assert.ok(corner.distanceTo(hit[i]) < 1e-9, `케이스 ${JSON.stringify(c)} 모서리 ${i}: ${corner.toArray()} vs ${hit[i].toArray()}`));
    // 레이어에 넘기는 값은 전체 크기의 반
    assert.ok(Math.abs(geometry.width - 1.2 * c.scale * 0.5) < 1e-9);
    assert.ok(Math.abs(geometry.height - 1.125 * c.scale * 0.5) < 1e-9);
    assert.ok(Math.abs(geometry.fullWidth - 1.2 * c.scale) < 1e-9);
    // 종횡비는 캔버스(1024×960)와 같다
    assert.ok(Math.abs(geometry.fullWidth / geometry.fullHeight - 1024 / 960) < 1e-9);
  }
});

test("QuadLayerSurface가 레이어에 넘긴 값으로 그려지는 모서리도 메시와 같다(생성·크기 변경 뒤 모두)", () => {
  const player = new THREE.Group();
  player.position.set(0.5, 0, -1);
  player.rotation.y = 0.4;
  const { surface, created, mesh } = setup({ player });
  mesh.rotation.set(-0.72, 0.3, 0, "YXZ");
  mesh.scale.setScalar(0.8);
  surface.sync(true);
  const check = () => {
    player.updateWorldMatrix(true, false);
    const layer = created[0];
    const geometry = { position: layer.transform.position, orientation: layer.transform.orientation, width: layer.width, height: layer.height };
    const a = layerCornersWorld(geometry, player.matrixWorld);
    const b = meshCornersWorld(mesh, 1.2, 1.125);
    a.forEach((corner, i) => assert.ok(corner.distanceTo(b[i]) < 1e-9));
  };
  check();
  mesh.scale.setScalar(0.5);
  mesh.position.x += 0.2;
  surface.sync(true);
  check();
});

test("메시 폴백 히트·커서: 레이가 닿은 uv가 캔버스 좌표와 정확히 대응한다(모서리·중심, 배율·회전 메시)", () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.125), new THREE.MeshBasicMaterial());
  mesh.position.set(0.2, 1.3, -1.25);
  mesh.rotation.set(-0.5, 0.3, 0, "YXZ");
  mesh.scale.setScalar(0.5);
  mesh.updateWorldMatrix(true, false);
  const raycaster = new THREE.Raycaster();
  const toCanvas = (local) => {
    // 메시 로컬 점을 월드로 → 그 앞(메시 법선 쪽)에서 점을 향해 쏜다
    const world = local.clone().applyMatrix4(mesh.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    raycaster.set(world.clone().addScaledVector(normal, 1), normal.clone().negate());
    const hit = raycaster.intersectObject(mesh, false)[0];
    return { px: hit.uv.x * 1024, py: (1 - hit.uv.y) * 960 };
  };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.2, `${a} != ${b}`); // 캔버스 px(경계 안쪽 0.01% 오차 포함)
  let c = toCanvas(new THREE.Vector3(-0.6, 0.5625, 0).multiplyScalar(0.9999)); // 왼쪽 위 모서리(경계 부동소수점 회피로 아주 조금 안쪽)
  near(c.px, 0);
  near(c.py, 0);
  c = toCanvas(new THREE.Vector3(0.6, -0.5625, 0).multiplyScalar(0.9999)); // 오른쪽 아래 모서리
  near(c.px, 1024);
  near(c.py, 960);
  c = toCanvas(new THREE.Vector3(0, 0, 0));
  near(c.px, 512);
  near(c.py, 480);
  c = toCanvas(new THREE.Vector3(-0.3, 0.28125, 0)); // 왼쪽 위 사분면 중심
  near(c.px, 256);
  near(c.py, 240);
});

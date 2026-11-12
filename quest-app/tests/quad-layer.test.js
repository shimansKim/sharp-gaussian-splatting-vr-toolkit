import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { QuadLayerSurface, UI_LAYER_KEY, quadLayerSupported, setUiLayerPreferred, uiLayerEnabled, uiLayerPreferred } from "../src/core/quad-layer.js";

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
    texSubImage2D: () => calls.push(["texSubImage2D"]),
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
  const surface = new QuadLayerSurface({
    stage: { renderer: { getContext: () => gl, xr }, player },
    canvas: { width: W, height: H },
    mesh,
    widthM: 1.2,
    heightM: 1.125,
    enabled: () => true,
    makeTransform: (position, orientation) => ({ position, orientation }),
  });
  return { surface, gl, session, proj, created, mesh, xr };
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
  assert.ok(Math.abs(layer.width - 1.2) < 1e-9 && Math.abs(layer.height - 1.125) < 1e-9);
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
  assert.ok(Math.abs(created[0].width - 0.6) < 1e-9);
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

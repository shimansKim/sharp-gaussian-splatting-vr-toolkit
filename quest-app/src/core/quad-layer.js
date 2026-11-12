// UI(공용 VR 패널·미디어 재생 HUD)를 WebXR 컴포지터 레이어(XRQuadLayer)로 그린다.
// three 메시로 그리면 앱 프레임이 늦을 때(PLY 렌더 부하) 컴포지터가 장면 전체를 재투영하면서 UI도 같이 흔들려 보이고,
// 앱 프레임 버퍼에 antialias 없이 그려져 머리를 돌릴 때 글씨 가장자리가 반짝인다. 레이어는 컴포지터가 디스플레이 주사율로 직접 합성하므로 둘 다 없다.
//
// 구조: 캔버스를 (그릴 때마다) 자체 GL 텍스처로 올려 두고, 매 프레임 XRWebGLBinding.getSubImage()로 얻은 레이어 텍스처에 GPU 복사(blitFramebuffer, 위아래 뒤집어서)한다.
// 레이어 순서는 [미디어 레이어, three 프로젝션 레이어, UI 레이어…] 라서 UI가 PLY 위에 온다. 레이를 맞추는 히트 테스트용 메시는 그대로 두고 보이게만 끈다(material.visible=false).
// 지원하지 않거나(레이어 없는 브라우저·IWER) 어느 단계든 실패하면 그 자리에서 레이어를 걷고 기존 메시로 그린다(세션이 끝나면 다시 시도한다).
// 끄는 법: 2D 화면 [설정]의 'VR 패널을 레이어로 그리기'(= localStorage "sharp-quest.ui-layer" = "off"), 또는 주소 ?uilayer=0(주소가 저장값보다 앞선다).

import { Matrix4, Quaternion, Vector3 } from "three";
import { worldToReferencePose } from "../viewers/media/layers-path.js";

export const UI_LAYER_KEY = "sharp-quest.ui-layer";

/** UI를 레이어로 그리길 원하는가. 기본은 켬. */
export function uiLayerPreferred({ search = globalThis.location?.search ?? "", storage = safeStorage() } = {}) {
  const q = new URLSearchParams(search).get("uilayer");
  if (q === "0" || q === "off") return false;
  if (q === "1" || q === "on") return true;
  try {
    return storage?.getItem(UI_LAYER_KEY) !== "off";
  } catch {
    return true;
  }
}

let cachedPreference = null;

/** 지금 UI 레이어를 쓰는가(매 프레임 불러도 되도록 캐시한다). 값은 setUiLayerPreferred가 바꾼다. */
export function uiLayerEnabled() {
  if (cachedPreference === null) cachedPreference = uiLayerPreferred();
  return cachedPreference;
}

/**
 * 2D 설정 화면에서 켜고 끈다. 기기에 기억하고(꺼짐만 "off"로 저장, 켬은 항목 삭제) 다음 프레임부터 반영한다.
 * @param {boolean} on
 * @param {Storage | null} [storage]
 */
export function setUiLayerPreferred(on, storage = safeStorage()) {
  try {
    if (on) storage?.removeItem(UI_LAYER_KEY);
    else storage?.setItem(UI_LAYER_KEY, "off");
  } catch {
    /* 저장이 막힌 환경이면 이번 실행에만 적용 */
  }
  cachedPreference = !!on;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 이 세션·브라우저에서 XRQuadLayer를 만들 수 있는가. */
export function quadLayerSupported(session, binding) {
  if (!session || !binding || typeof binding.createQuadLayer !== "function" || typeof binding.getSubImage !== "function") return false;
  const enabled = session.enabledFeatures;
  // enabledFeatures를 알려 주지 않는 구현은 시도해 보고 실패하면 폴백한다.
  return !enabled || [...enabled].includes("layers");
}

/** 레이 커서 점 한 개를 갱신할 때 올리는 작은 사각형의 한 변(px). 점 반지름 9 + 테두리 3을 덮는다. */
export const CURSOR_PATCH = 32;
const CURSOR_RADIUS = 9;
const CURSOR_FILL = "rgba(255, 255, 255, 0.95)";
const CURSOR_RING = "#4fb3ff";

const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

export class QuadLayerSurface {
  /**
   * @param {{
   *   stage: { renderer: any, player?: any },
   *   canvas: HTMLCanvasElement,
   *   mesh: import('three').Mesh,
   *   widthM: number, heightM: number,   // 메시 크기(scale 1일 때, m)
   *   name?: string,
   *   enabled?: () => boolean,           // 기본: uiLayerEnabled()
   *   makeTransform?: (position: any, orientation: any) => any,
   *   makeScratch?: () => HTMLCanvasElement,  // 커서 조각을 만들 작은 캔버스(기본: document.createElement)
   * }} options
   */
  constructor({ stage, canvas, mesh, widthM, heightM, name = "ui", enabled = uiLayerEnabled, makeTransform, makeScratch }) {
    this.stage = stage;
    this.canvas = canvas;
    this.mesh = mesh;
    this.widthM = widthM;
    this.heightM = heightM;
    this.name = name;
    this.enabled = enabled;
    this.makeTransform = makeTransform ?? ((position, orientation) => new globalThis.XRRigidTransform(position, orientation));
    this.makeScratch = makeScratch ?? (() => globalThis.document.createElement("canvas"));
    /** @type {HTMLCanvasElement | null} */
    this._scratch = null;
    /** 레이 커서(캔버스 좌표). 캔버스에는 그리지 않고, 레이어 텍스처에 작은 조각만 올려 보인다. */
    this._cursors = { left: null, right: null };
    this._cursorsDirty = false;
    /** 지금 텍스처에 커서가 그려져 있는 사각형들(다음에 원래 그림으로 되돌릴 자리) */
    this._patches = [];
    this.layer = null;
    this.session = null;
    /** 이 세션에서 레이어를 포기했는가(실패 이유는 lastError). 세션이 새로 시작되면 다시 시도한다. */
    this.failed = false;
    this.lastError = "";
    /** 캔버스를 다시 올려야 하는가 */
    this.dirty = true;
    /** 마지막 프레임에 레이어에 그렸는가(= 메시를 보이지 않게 해도 되는가) */
    this.active = false;
    this.gl = null;
    this.srcTexture = null;
    this.srcFbo = null;
    this.dstFbo = null;
    this._lastPose = null;
    this._lastSize = null;
    this._checked = false;
    this._tmpPos = new Vector3();
    this._tmpQuat = new Quaternion();
    this._tmpScale = new Vector3();
    this._identity = new Matrix4();
  }

  /** 캔버스를 다시 그렸다(다음 프레임에 레이어 텍스처로 올린다). */
  invalidate() {
    this.dirty = true;
  }

  /**
   * 레이 커서 점을 옮긴다(캔버스 좌표, 없으면 null). 패널 전체를 다시 그리거나 올리지 않고 점 주변 작은 사각형(CURSOR_PATCH²)만 레이어 텍스처에 올린다.
   * 레이어로 그리지 않는 동안(메시 폴백)에는 아무것도 그리지 않는다. 메시에서는 레이 선이 보인다.
   * @param {'left' | 'right'} side
   * @param {{ x: number, y: number } | null} point
   */
  setCursor(side, point) {
    const prev = this._cursors[side];
    if (!prev && !point) return;
    if (prev && point && Math.abs(prev.x - point.x) < 1 && Math.abs(prev.y - point.y) < 1) return;
    this._cursors[side] = point ? { x: point.x, y: point.y } : null;
    this._cursorsDirty = true;
  }

  /**
   * 매 프레임(XR 프레임 콜백 안에서) 호출한다.
   * @param {boolean} visible UI를 지금 보여 줘야 하는가
   * @returns {boolean} 레이어로 그렸으면 true. false면 호출한 쪽이 메시를 보이게 둔다.
   */
  sync(visible) {
    if (!visible || this.failed || !this.enabled()) {
      this._leave();
      return false;
    }
    const xr = this.stage.renderer.xr;
    const session = xr.getSession?.();
    if (!session) {
      this._leave();
      return false;
    }
    if (this.session && this.session !== session) this._forgetSession();
    try {
      const binding = xr.getBinding?.();
      if (!this.layer) {
        if (!quadLayerSupported(session, binding)) {
          this._fail("레이어를 지원하지 않음", false);
          return false;
        }
        if (!this._create(session, binding, xr)) return false;
      }
      this._ensureInSession(session);
      this._updatePose();
      const frame = xr.getFrame?.();
      if (!frame) return this.active; // 프레임 밖(드문 경우): 직전 상태 유지
      this._draw(binding, frame);
      this.active = true;
      return true;
    } catch (error) {
      this._fail(`${error?.name ?? "Error"}: ${String(error?.message ?? error).slice(0, 80)}`, true);
      return false;
    }
  }

  /** 레이어를 걷는다(숨김·세션 종료·정리). GL 자원은 다음 세션을 위해 남긴다. */
  detach() {
    this._leave();
    this._forgetSession();
  }

  dispose() {
    this.detach();
    const gl = this.gl;
    if (gl) {
      if (this.srcTexture) gl.deleteTexture(this.srcTexture);
      if (this.srcFbo) gl.deleteFramebuffer(this.srcFbo);
      if (this.dstFbo) gl.deleteFramebuffer(this.dstFbo);
    }
    this.srcTexture = this.srcFbo = this.dstFbo = null;
    this.gl = null;
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  _create(session, binding, xr) {
    const space = xr.getReferenceSpace?.();
    if (!space) return false; // 참조 공간이 아직 없음: 다음 프레임에 다시
    this._ensureGl();
    const { width, height } = this._size();
    const layer = binding.createQuadLayer({
      space,
      viewPixelWidth: this.canvas.width,
      viewPixelHeight: this.canvas.height,
      layout: "mono",
      textureType: "texture",
      isStatic: false,
      transform: this._transform(),
      width,
      height,
    });
    this.layer = layer;
    this.session = session;
    this._lastPose = null;
    this._lastSize = [width, height];
    this.dirty = true;
    this.lastError = "";
    return true;
  }

  _ensureGl() {
    if (this.gl) return;
    const gl = this.stage.renderer.getContext();
    if (typeof gl.blitFramebuffer !== "function") throw new Error("WebGL2가 아님");
    this.gl = gl;
    const prevTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    this.srcTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.canvas.width, this.canvas.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, prevTexture);
    this.srcFbo = gl.createFramebuffer();
    this.dstFbo = gl.createFramebuffer();
  }

  /** 메시의 월드 자세를 참조 공간 자세로 바꾼 XRRigidTransform. */
  _transform() {
    const pose = this._pose();
    return this.makeTransform(pose.position, pose.orientation);
  }

  _pose() {
    const { mesh, stage } = this;
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(this._tmpPos, this._tmpQuat, this._tmpScale);
    stage.player?.updateWorldMatrix?.(true, false);
    return worldToReferencePose(stage.player?.matrixWorld ?? this._identity, this._tmpPos, this._tmpQuat);
  }

  _size() {
    this.mesh.updateWorldMatrix(true, false);
    this.mesh.matrixWorld.decompose(this._tmpPos, this._tmpQuat, this._tmpScale);
    return { width: this.widthM * this._tmpScale.x, height: this.heightM * this._tmpScale.y };
  }

  /** 위치·방향·크기가 바뀐 때만 레이어에 반영한다(보통은 패널을 열거나 옮길 때뿐). */
  _updatePose() {
    const pose = this._pose();
    const key = [pose.position.x, pose.position.y, pose.position.z, pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w];
    if (!same(key, this._lastPose)) {
      this.layer.transform = this.makeTransform(pose.position, pose.orientation);
      this._lastPose = key;
    }
    const { width, height } = this._size();
    if (!same([width, height], this._lastSize)) {
      this.layer.width = width;
      this.layer.height = height;
      this._lastSize = [width, height];
    }
  }

  /** 세션의 레이어 목록 맨 뒤(프로젝션 레이어 위)에 넣는다. */
  _ensureInSession(session) {
    const layers = [...(session.renderState.layers ?? [])];
    if (layers.includes(this.layer)) return;
    session.updateRenderState({ layers: [...layers, this.layer] });
  }

  _leave() {
    this.active = false;
    // 텍스처에 남은 커서 조각은 버린다. 다시 보이면 깨끗한 캔버스를 처음부터 올린다.
    this.dirty = true;
    this._cursors = { left: null, right: null };
    this._cursorsDirty = false;
    this._patches = [];
    const { layer, session } = this;
    if (!layer || !session) return;
    try {
      const layers = [...(session.renderState.layers ?? [])];
      if (layers.includes(layer)) session.updateRenderState({ layers: layers.filter((l) => l !== layer) });
    } catch {
      // 세션이 이미 끝났으면 레이어도 같이 사라졌다.
    }
  }

  _forgetSession() {
    const { layer } = this;
    this.layer = null;
    this.session = null;
    this._lastPose = null;
    this.failed = false;
    this.active = false;
    try {
      layer?.destroy?.();
    } catch {
      // 무시
    }
  }

  _fail(reason, warn) {
    this.lastError = reason;
    this.failed = true;
    if (warn) console.warn(`[ui-layer] ${this.name}: 레이어로 못 그려 메시로 보여 줍니다:`, reason);
    this._leave();
    try {
      this.layer?.destroy?.();
    } catch {
      // 무시
    }
    this.layer = null;
  }

  /** 캔버스를 올리고(바뀐 때만) 레이어 텍스처로 복사한다. 쓴 GL 상태는 모두 되돌린다. */
  _draw(binding, frame) {
    const gl = this.gl;
    if (this.dirty) {
      this._upload();
      this.dirty = false;
      this._patches = []; // 전체를 새로 올렸으니 이전 커서 조각은 이미 지워졌다
      this._cursorsDirty = true;
    }
    if (this._cursorsDirty) {
      this._applyCursors();
      this._cursorsDirty = false;
    }
    const sub = binding.getSubImage(this.layer, frame);
    const prevDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    try {
      if (scissor) gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.srcFbo);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.srcTexture, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.dstFbo);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sub.colorTexture, 0);
      // 검사(checkFramebufferStatus·getError)는 GPU 왕복이라 첫 복사 때만 한다.
      const first = !this._checked;
      if (first) {
        const read = gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER);
        const draw = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);
        if (read !== gl.FRAMEBUFFER_COMPLETE || draw !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer 불완전(read ${read}, draw ${draw})`);
      }
      const vp = sub.viewport ?? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height };
      // 캔버스는 위가 0행, GL 텍스처는 아래가 0행이라 위아래를 뒤집어 복사한다.
      gl.blitFramebuffer(0, 0, this.canvas.width, this.canvas.height, vp.x, vp.y + vp.height, vp.x + vp.width, vp.y, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      if (first) {
        const error = gl.getError();
        if (error !== gl.NO_ERROR) throw new Error(`GL 오류 0x${error.toString(16)}`);
        this._checked = true;
      }
    } finally {
      // 레이어 텍스처를 붙들고 있지 않게 떼고, 프레임버퍼 바인딩·scissor를 원래대로
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDraw);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead);
      if (scissor) gl.enable(gl.SCISSOR_TEST);
    }
  }

  _upload() {
    this._uploadSource(0, 0, this.canvas);
  }

  /** 레이 커서를 텍스처에 반영한다: 이전 커서 자리를 캔버스 그림으로 되돌리고, 지금 커서 자리에 점을 얹은 조각을 올린다. */
  _applyCursors() {
    for (const rect of this._patches) this._uploadPatch(rect, null);
    this._patches = [];
    for (const side of /** @type {const} */ (["left", "right"])) {
      const point = this._cursors[side];
      if (!point) continue;
      const rect = this._patchRect(point);
      this._uploadPatch(rect, point);
      this._patches.push(rect);
    }
  }

  _patchRect(point) {
    const size = CURSOR_PATCH;
    const x = Math.min(Math.max(Math.round(point.x) - size / 2, 0), Math.max(0, this.canvas.width - size));
    const y = Math.min(Math.max(Math.round(point.y) - size / 2, 0), Math.max(0, this.canvas.height - size));
    return { x, y, size };
  }

  /** 캔버스의 해당 사각형(+ 점)을 작은 캔버스에 옮겨 텍스처의 같은 자리에 올린다. */
  _uploadPatch(rect, point) {
    const scratch = (this._scratch ??= this.makeScratch());
    scratch.width = rect.size;
    scratch.height = rect.size;
    const ctx = scratch.getContext("2d");
    ctx.clearRect(0, 0, rect.size, rect.size);
    ctx.drawImage(this.canvas, rect.x, rect.y, rect.size, rect.size, 0, 0, rect.size, rect.size);
    if (point) {
      ctx.beginPath();
      ctx.arc(point.x - rect.x, point.y - rect.y, CURSOR_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = CURSOR_FILL;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = CURSOR_RING;
      ctx.stroke();
    }
    this._uploadSource(rect.x, rect.y, scratch);
  }

  /** 소스(캔버스)를 텍스처의 (x, y)에 올린다. 쓴 GL 상태는 되돌린다. */
  _uploadSource(x, y, source) {
    const gl = this.gl;
    const prevTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const prevPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    try {
      gl.bindTexture(gl.TEXTURE_2D, this.srcTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); // 컴포지터는 미리 곱한 알파를 기대한다
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } finally {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremultiply);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
      gl.bindTexture(gl.TEXTURE_2D, prevTexture);
    }
  }
}

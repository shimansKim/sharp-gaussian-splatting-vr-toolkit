// WebXR Layers 경로: 영상을 three 텍스처로 올리지 않고 XRMediaBinding 레이어로 컴포지터에 직접 넘긴다.
// - 눈별 분리(stereo-left-right / stereo-top-bottom)를 컴포지터가 한다 → 입체가 확실하다.
// - 프레임마다 영상→WebGL 텍스처 업로드·구 메시 렌더가 없다 → 8K급 영상에서 끊김이 줄어든다.
// 미지원·실패 시에는 호출 쪽이 기존 메시 경로(projections.js)로 폴백한다.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { LAYOUTS, eyeAspect } from './format-detect.js';
import { SCREEN_BASE_WIDTH, SCREEN_DISTANCE } from './projections.js';

/**
 * 형식을 레이어 생성 값으로 바꾼다(DOM 없이 검증 가능한 순수 함수).
 * @param {import('./format-detect.js').MediaLayout} layout
 * @param {{ width?: number, height?: number, screenScale?: number, swapEyes?: boolean }} [opts]
 * @returns {null | {
 *   kind: 'equirect'|'quad',
 *   layout: 'mono'|'stereo-left-right'|'stereo-top-bottom',
 *   centralHorizontalAngle?: number, upperVerticalAngle?: number, lowerVerticalAngle?: number,
 *   width?: number, height?: number, distance?: number,
 * }} null이면 레이어로 못 보여 주는 경우(눈 바꿈은 메시 경로가 맡는다)
 */
export function layerSpec(layout, { width, height, screenScale = 1, swapEyes = false } = {}) {
  const info = LAYOUTS[layout];
  if (!info) return null;
  // 눈 바꿈(invertStereo)은 브라우저마다 지원이 달라 확인된 메시 경로로 처리한다.
  if (swapEyes && info.stereo !== 'mono') return null;
  const xrLayout = info.stereo === 'sbs' ? 'stereo-left-right' : info.stereo === 'tb' ? 'stereo-top-bottom' : 'mono';
  if (info.shape === 'sphere360' || info.shape === 'sphere180') {
    return {
      kind: 'equirect',
      layout: xrLayout,
      centralHorizontalAngle: info.shape === 'sphere360' ? Math.PI * 2 : Math.PI,
      upperVerticalAngle: Math.PI / 2,
      lowerVerticalAngle: -Math.PI / 2,
    };
  }
  const aspect = eyeAspect(layout, width, height) || 16 / 9;
  const w = SCREEN_BASE_WIDTH * screenScale;
  return { kind: 'quad', layout: xrLayout, width: w, height: w / aspect, distance: SCREEN_DISTANCE };
}

/** 이 브라우저·세션에서 미디어 레이어를 쓸 수 있는가 */
export function mediaLayersSupported(session) {
  if (!session || typeof globalThis.XRMediaBinding === 'undefined') return false;
  const enabled = session.enabledFeatures;
  // enabledFeatures를 알려 주지 않는 구현은 시도해 보고 실패하면 폴백한다.
  return !enabled || [...enabled].includes('layers');
}

/**
 * 월드(three 씬) 자세를 참조 공간 자세로 바꾼다. 플레이어(카메라 부모)가 움직여 있으면 그만큼 뺀다.
 * @returns {{ position: {x,y,z}, orientation: {x,y,z,w} }}
 */
export function worldToReferencePose(playerMatrixWorld, worldPosition, worldQuaternion) {
  const world = new Matrix4().compose(worldPosition, worldQuaternion, new Vector3(1, 1, 1));
  const local = new Matrix4().copy(playerMatrixWorld).invert().multiply(world);
  const position = new Vector3();
  const quaternion = new Quaternion();
  local.decompose(position, quaternion, new Vector3());
  return {
    position: { x: position.x, y: position.y, z: position.z },
    orientation: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
  };
}

/** 영상 하나를 XR 미디어 레이어로 보여 주는 관리자 */
export class MediaLayerPresenter {
  /**
   * @param {{ renderer: import('three').WebGLRenderer, scene: import('three').Scene, player?: import('three').Object3D }} stage
   */
  constructor(stage) {
    this.stage = stage;
    this.layer = null;
    this.spec = null;
    this.session = null;
    this._saved = null;
    this._video = null;
    /** 마지막 생성 실패 이유(진단 줄에 보인다). 성공하면 빈 문자열 */
    this.lastError = '';
  }

  get active() {
    return !!this.layer;
  }

  /**
   * 레이어를 만들어 세션에 붙인다. 실패하면 false(정리까지 끝낸 상태).
   * @param {HTMLVideoElement} video
   * @param {ReturnType<typeof layerSpec>} spec
   * @param {import('three').Vector3} headWorld 머리 월드 위치
   * @param {import('three').Quaternion} contentQuaternion 콘텐츠 월드 회전(바라보는 방향+스틱 회전)
   */
  attach(video, spec, headWorld, contentQuaternion) {
    this.detach();
    const xr = this.stage.renderer.xr;
    const session = xr.getSession?.();
    if (!spec || !mediaLayersSupported(session)) return false;
    try {
      const space = xr.getReferenceSpace();
      if (!space) return false;
      const binding = new globalThis.XRMediaBinding(session);
      const init = { space, layout: spec.layout, transform: this._transform(spec, headWorld, contentQuaternion) };
      let layer;
      if (spec.kind === 'equirect') {
        layer = binding.createEquirectLayer(video, {
          ...init,
          centralHorizontalAngle: spec.centralHorizontalAngle,
          upperVerticalAngle: spec.upperVerticalAngle,
          lowerVerticalAngle: spec.lowerVerticalAngle,
        });
      } else {
        layer = binding.createQuadLayer(video, { ...init, width: spec.width, height: spec.height });
      }
      const others = [...(session.renderState.layers ?? [])].filter((l) => l !== this.layer);
      // 미디어 레이어가 맨 뒤, three의 프로젝션 레이어(패널·레이 선)가 그 위에 온다.
      session.updateRenderState({ layers: [layer, ...others] });
      this.layer = layer;
      this.spec = spec;
      this.session = session;
      this._video = video;
      this.lastError = '';
      this._makeBackgroundTransparent();
      return true;
    } catch (error) {
      console.warn('[media] XR 미디어 레이어를 만들지 못해 메시 경로로 보여 줍니다:', error?.message ?? error);
      this.detach();
      this.lastError = `${error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 70)}`;
      return false;
    }
  }

  /** 위치·방향·크기만 바뀐 경우(정면 맞춤, 스틱 회전, 크기 조절)에 레이어를 갱신한다. */
  update(spec, headWorld, contentQuaternion) {
    if (!this.layer) return;
    try {
      this.layer.transform = this._transform(spec, headWorld, contentQuaternion);
      if (spec.kind === 'quad' && 'width' in this.layer) {
        this.layer.width = spec.width;
        this.layer.height = spec.height;
      }
      this.spec = spec;
    } catch (error) {
      console.warn('[media] XR 미디어 레이어 갱신 실패:', error?.message ?? error);
    }
  }

  detach() {
    const { layer, session } = this;
    this._restoreBackground();
    this.layer = null;
    this.spec = null;
    this._video = null;
    if (layer && session) {
      try {
        const rest = [...(session.renderState.layers ?? [])].filter((l) => l !== layer);
        session.updateRenderState({ layers: rest });
      } catch {
        // 세션이 이미 끝났으면 레이어도 같이 사라졌다.
      }
      try {
        layer.destroy?.();
      } catch {
        // 무시
      }
    }
    this.session = null;
  }

  _transform(spec, headWorld, contentQuaternion) {
    const position = new Vector3(0, 0, 0);
    if (spec.kind === 'quad') position.set(0, 0, -spec.distance).applyQuaternion(contentQuaternion);
    position.add(headWorld);
    const player = this.stage.player;
    player?.updateWorldMatrix?.(true, false);
    const pose = worldToReferencePose(player?.matrixWorld ?? new Matrix4(), position, contentQuaternion);
    return new globalThis.XRRigidTransform(pose.position, pose.orientation);
  }

  /** three 프로젝션 레이어가 아무것도 안 그린 곳은 투명해야 뒤의 미디어 레이어가 보인다. */
  _makeBackgroundTransparent() {
    const { scene, renderer } = this.stage;
    if (this._saved) return;
    this._saved = { background: scene.background, alpha: renderer.getClearAlpha() };
    scene.background = null;
    renderer.setClearAlpha(0);
  }

  _restoreBackground() {
    if (!this._saved) return;
    const { scene, renderer } = this.stage;
    scene.background = this._saved.background;
    renderer.setClearAlpha(this._saved.alpha);
    this._saved = null;
  }
}

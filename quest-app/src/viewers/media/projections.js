// 형식별(360/180/가상 스크린) 메시 생성. 눈별 layers: 왼눈 1, 오른눈 2, 모노 0.
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { LAYOUTS, eyeAspect, eyeRegion } from './format-detect.js';

export const LAYER_LEFT = 1;
export const LAYER_RIGHT = 2;

/**
 * 지금 그리는 카메라가 왼눈인지 오른눈인지 알아낸다.
 * XR에서는 three가 눈마다 서브카메라(renderer.xr.getCamera().cameras[0|1])로 따로 그리므로 그 순서로 판별하고,
 * XR 밖(2D 미리보기)에서는 카메라에 켜 둔 눈 layer로 판별한다(오른눈 layer만 켜져 있으면 오른눈, 아니면 왼눈).
 * @param {ArrayLike<object>|null|undefined} xrCameras renderer.xr.getCamera().cameras (XR 세션 중에만)
 * @param {{ layers: { isEnabled(layer: number): boolean } }} camera
 * @returns {'left'|'right'}
 */
export function eyeOfCamera(xrCameras, camera) {
  if (xrCameras && xrCameras.length >= 2) {
    const index = Array.prototype.indexOf.call(xrCameras, camera);
    if (index === 0) return 'left';
    if (index === 1) return 'right';
  }
  return camera?.layers?.isEnabled?.(LAYER_RIGHT) && !camera.layers.isEnabled(LAYER_LEFT) ? 'right' : 'left';
}

export const SPHERE_RADIUS = 50;
/**
 * 가상 스크린이 놓이는 기본 거리(m)와 화면 너비 기준(배율 1). 거리 3m에 너비 6m = 가로 약 90°.
 * 처음 크기는 DEFAULT_SCREEN_SCALE(0.6, 약 62°)이고 사람이 오른쪽 스틱 상하·패널 +/−로 키우고 줄인다.
 */
export const SCREEN_DISTANCE = 3;
export const SCREEN_BASE_WIDTH = 6;
/** 스틱으로 돌릴 수 있는 위아래 한계(라디안) */
export const MAX_TURN_PITCH = (80 * Math.PI) / 180;

/** 가상 스크린 크기 배율의 기본값·한계. 배율 1이 너비 6m(거리 3m에서 가로 약 90°)이고, 기본은 그보다 작은 약 62°다(실기기 피드백: "너무 크게 나온다"). */
export const DEFAULT_SCREEN_SCALE = 0.6;
export const MIN_SCREEN_SCALE = 0.15;
export const MAX_SCREEN_SCALE = 3;
/** 360/180 구의 확대 배율(시야각 확대). 1이 원래 크기이고 구는 줄일 수 없다(전체 장면이 이미 구 전체다). */
export const DEFAULT_SPHERE_ZOOM = 1;
export const MAX_SPHERE_ZOOM = 4;
/** 이 값을 넘게 확대하면 컴포지터 레이어로는 못 보여 줘 메시 경로로 보여 준다. */
export const SPHERE_ZOOM_EPSILON = 0.001;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * 텍스처 영역의 가운데를 기준으로 1/zoom 만큼만 잘라 같은 구 전체에 편다 = 시야각 확대(zoom배).
 * 360·180 모두 정면이 영역 가운데라 확대해도 정면이 그대로 가운데에 남는다.
 */
export function zoomRegion(region, zoom) {
  const z = Math.max(1, zoom || 1);
  const cu = (region.u0 + region.u1) / 2;
  const cv = (region.v0 + region.v1) / 2;
  const hu = (region.u1 - region.u0) / 2 / z;
  const hv = (region.v1 - region.v0) / 2 / z;
  return { u0: cu - hu, u1: cu + hu, v0: cv - hv, v1: cv + hv };
}

/**
 * 방위각 az(0이 정면 -Z, +가 오른쪽 +X), 고도 el(+가 위)로 구의 일부를 만든다.
 * u는 방위각, v는 고도에 비례하고 region으로 텍스처의 한 영역에 매핑한다.
 * 삼각형 감김은 바깥쪽이 앞면이므로 재질은 BackSide를 쓴다.
 */
export function buildSphereGeometry({ azMin, azMax, radius = SPHERE_RADIUS, segU = 64, segV = 40, region }) {
  const cols = segU + 1;
  const rows = segV + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  let p = 0;
  for (let iv = 0; iv < rows; iv++) {
    const fv = iv / segV;
    const el = -Math.PI / 2 + fv * Math.PI;
    const cosEl = Math.cos(el);
    const sinEl = Math.sin(el);
    for (let iu = 0; iu < cols; iu++) {
      const fu = iu / segU;
      const az = azMin + fu * (azMax - azMin);
      positions[p++] = radius * Math.sin(az) * cosEl;
      positions[p++] = radius * sinEl;
      positions[p++] = -radius * Math.cos(az) * cosEl;
    }
  }
  fillSphereUvs(uvs, segU, segV, region);
  const indices = new Uint32Array(segU * segV * 6);
  let k = 0;
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = iv * cols + iu;
      const b = (iv + 1) * cols + iu;
      const c = (iv + 1) * cols + iu + 1;
      const d = iv * cols + iu + 1;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** 구의 UV를 region(텍스처의 한 영역)에 맞춰 채운다. 확대할 때 지오메트리를 다시 만들지 않고 이 값만 다시 쓴다. */
function fillSphereUvs(uvs, segU, segV, region) {
  let t = 0;
  for (let iv = 0; iv <= segV; iv++) {
    const fv = iv / segV;
    for (let iu = 0; iu <= segU; iu++) {
      const fu = iu / segU;
      uvs[t++] = region.u0 + fu * (region.u1 - region.u0);
      uvs[t++] = region.v0 + fv * (region.v1 - region.v0);
    }
  }
}

/** 가로 width, 세로 height 평면(정면 +Z를 바라봄). region으로 UV를 눈 영역에 맞춘다. */
export function buildScreenGeometry({ width, height, region }) {
  const hw = width / 2;
  const hh = height / 2;
  const positions = new Float32Array([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0]);
  const uvs = new Float32Array([
    region.u0, region.v0,
    region.u1, region.v0,
    region.u1, region.v1,
    region.u0, region.v1,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 하나의 텍스처를 형식에 맞는 메시로 보여 주는 투영 객체.
 * root를 씬에 붙이고, 매 프레임 follow(headPosition)을 불러 360/180 구를 머리 위치에 맞춘다.
 */
export class MediaProjection {
  /**
   * @param {import('three').Texture} texture
   */
  constructor(texture) {
    this.texture = texture;
    this.root = new Group();
    this.root.name = 'media-projection';
    /** 구 메시들(머리 위치를 따라감) 또는 스크린 메시들 */
    this.shell = new Group();
    this.root.add(this.shell);
    this.layout = 'mono2d';
    this.swapEyes = false;
    this.screenScale = DEFAULT_SCREEN_SCALE;
    /** 360/180 구의 확대 배율(1 = 원래). 스크린은 screenScale을 쓴다. */
    this.sphereZoom = DEFAULT_SPHERE_ZOOM;
    /** place()가 정한 바라보는 방향(라디안). 스크린만 쓴다. */
    this.baseYaw = 0;
    /** 스틱으로 돌린 양(라디안): yaw는 위(Y)축, pitch는 가로(X)축 */
    this.turn = { yaw: 0, pitch: 0 };
    this.mediaWidth = 1920;
    this.mediaHeight = 1080;
    this.meshes = [];
    /**
     * 눈별 분리 방식(메시 경로).
     * 'camera': 두 메시를 모두 layer 0에 두고, 그리는 순간 어느 서브카메라인지 보고 맞지 않는 눈에서는 그리지 않는다(drawRange 0).
     * 'mask': three의 눈 layer(왼눈 1, 오른눈 2) 마스크만 믿는다.
     * 실기기에서 layer 마스크로 눈이 갈리지 않는다는 보고가 있어 기본을 'camera'로 하고, 둘을 바꿔 가며 확인할 수 있게 한다.
     */
    this.eyeMethod = 'camera';
    /** 메시가 실제로 그려진 횟수(눈별). 진단 줄에 보여 준다. 한쪽 눈 횟수가 0이면 그 눈에는 영상이 안 나간다. */
    this.eyeStats = { left: 0, right: 0, mono: 0, cross: 0 };
    this._material = new MeshBasicMaterial({ map: texture, toneMapped: false });
    this._screenMaterial = new MeshBasicMaterial({ map: texture, toneMapped: false, side: DoubleSide });
    this._v = new Vector3();
  }

  get info() {
    return LAYOUTS[this.layout];
  }

  get isScreen() {
    return this.info.shape === 'screen';
  }

  setEyeMethod(method) {
    this.eyeMethod = method === 'mask' ? 'mask' : 'camera';
    this._rebuild();
  }

  setTexture(texture) {
    this.texture = texture;
    this._material.map = texture;
    this._screenMaterial.map = texture;
    this._material.needsUpdate = true;
    this._screenMaterial.needsUpdate = true;
  }

  /**
   * 형식을 바꿔 메시를 다시 만든다.
   * @param {import('./format-detect.js').MediaLayout} layout
   * @param {{ width?: number, height?: number, swapEyes?: boolean, screenScale?: number }} [opts]
   */
  setLayout(layout, opts = {}) {
    if (!LAYOUTS[layout]) throw new Error(`알 수 없는 형식: ${layout}`);
    this.layout = layout;
    if (opts.width) this.mediaWidth = opts.width;
    if (opts.height) this.mediaHeight = opts.height;
    if (opts.swapEyes !== undefined) this.swapEyes = !!opts.swapEyes;
    if (opts.screenScale !== undefined) this.screenScale = clamp(opts.screenScale, MIN_SCREEN_SCALE, MAX_SCREEN_SCALE);
    if (opts.sphereZoom !== undefined) this.sphereZoom = clamp(opts.sphereZoom, 1, MAX_SPHERE_ZOOM);
    this._rebuild();
  }

  _clear() {
    for (const mesh of this.meshes) {
      this.shell.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes = [];
  }

  _rebuild() {
    this._clear();
    const { shape, stereo } = this.info;
    const eyes = stereo === 'mono' ? ['mono'] : this.swapEyes ? ['right', 'left'] : ['left', 'right'];
    // 눈 이름은 "이 영역을 어느 눈에 보여 주는가"가 아니라 "텍스처의 어느 영역인가"다.
    const regionOwner = stereo === 'mono' ? ['mono'] : ['left', 'right'];

    eyes.forEach((layerEye, index) => {
      const regionEye = regionOwner[index] ?? 'left';
      const region = eyeRegion(this.layout, stereo === 'mono' ? 'left' : regionEye);
      let geometry;
      let material = this._material;
      if (shape === 'sphere360') {
        geometry = buildSphereGeometry({ azMin: -Math.PI, azMax: Math.PI, region: zoomRegion(region, this.sphereZoom) });
        material.side = BackSide;
      } else if (shape === 'sphere180') {
        geometry = buildSphereGeometry({ azMin: -Math.PI / 2, azMax: Math.PI / 2, segU: 48, region: zoomRegion(region, this.sphereZoom) });
        material.side = BackSide;
      } else {
        const aspect = eyeAspect(this.layout, this.mediaWidth, this.mediaHeight) || 16 / 9;
        const width = SCREEN_BASE_WIDTH * this.screenScale;
        geometry = buildScreenGeometry({ width, height: width / aspect, region });
        material = this._screenMaterial;
      }
      const mesh = new Mesh(geometry, material);
      mesh.name = `media-${shape}-${layerEye}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = -10;
      mesh.userData.region = region;
      mesh.userData.segU = shape === 'sphere180' ? 48 : 64;
      mesh.userData.segV = 40;
      if (shape === 'screen') mesh.position.set(0, 0, -SCREEN_DISTANCE);
      const gated = this.eyeMethod === 'camera' && layerEye !== 'mono';
      if (gated || layerEye === 'mono') mesh.layers.set(0);
      else if (layerEye === 'left') mesh.layers.set(LAYER_LEFT);
      else mesh.layers.set(LAYER_RIGHT);
      mesh.onBeforeRender = (renderer, _scene, camera) => {
        if (layerEye === 'mono') {
          this.eyeStats.mono++;
          return;
        }
        const xrCameras = renderer?.xr?.isPresenting ? renderer.xr.getCamera().cameras : null;
        const eye = eyeOfCamera(xrCameras, camera);
        // 맞는 눈에서 그려지면 그 눈 횟수, 틀린 눈에서 그려지면 cross(mask 방식에서 눈 분리가 깨졌다는 뜻)
        if (layerEye === eye) this.eyeStats[eye]++;
        else if (!gated) this.eyeStats.cross++;
        // 이 메시의 눈과 지금 그리는 눈이 다르면 그리지 않는다(그리는 개수 0). 'mask' 방식은 layer가 이미 걸러 준다.
        if (gated) mesh.geometry.setDrawRange(0, layerEye === eye ? Infinity : 0);
      };
      this.shell.add(mesh);
      this.meshes.push(mesh);
    });
    this.shell.userData.shape = shape;
  }

  /** 가상 스크린 크기 배율을 바꾼다(각도 크기만 달라지고 거리는 같다). */
  setScreenScale(scale) {
    this.screenScale = clamp(scale, MIN_SCREEN_SCALE, MAX_SCREEN_SCALE);
    if (this.isScreen) this._rebuild();
  }

  /** 360/180 구를 확대한다(시야각 확대, 1~4배). 지오메트리를 다시 만들지 않고 UV만 다시 쓴다. */
  setSphereZoom(zoom) {
    this.sphereZoom = clamp(zoom, 1, MAX_SPHERE_ZOOM);
    if (this.isScreen) return;
    for (const mesh of this.meshes) {
      const { region, segU, segV } = mesh.userData;
      const uv = mesh.geometry.getAttribute('uv');
      fillSphereUvs(uv.array, segU, segV, zoomRegion(region, this.sphereZoom));
      uv.needsUpdate = true;
    }
  }

  /** 지금 형식에서 쓰는 확대 값(스크린은 크기 배율, 구는 시야각 확대 배율). */
  get zoom() {
    return this.isScreen ? this.screenScale : this.sphereZoom;
  }

  /** 지금 형식의 확대 한계 */
  get zoomRange() {
    return this.isScreen ? { min: MIN_SCREEN_SCALE, max: MAX_SCREEN_SCALE } : { min: 1, max: MAX_SPHERE_ZOOM };
  }

  /** 형식에 맞게 확대 값을 바꾸고 실제 적용된 값을 돌려준다. */
  setZoom(zoom) {
    if (this.isScreen) this.setScreenScale(zoom);
    else this.setSphereZoom(zoom);
    return this.zoom;
  }

  /** 360/180 구는 머리 위치를 따라가고 방향은 그대로 둔다. 스크린은 place()로 놓은 자리에 둔다. */
  follow(headPosition) {
    if (!this.isScreen) this.shell.position.copy(headPosition);
  }

  /**
   * 스크린을 머리 앞에 놓는다. yaw는 머리가 바라보는 방향(라디안). 스틱으로 돌린 양은 처음으로 되돌린다.
   * keepTurn이면 돌린 양을 그대로 둔다(형식만 바꿀 때 화면이 저절로 돌아가지 않게).
   */
  place(headPosition, yaw, { keepTurn = false } = {}) {
    this.baseYaw = this.isScreen ? yaw : 0;
    if (!keepTurn) {
      this.turn.yaw = 0;
      this.turn.pitch = 0;
    }
    this.shell.position.copy(headPosition);
    this._applyRotation();
  }

  /** 스틱 회전 증분을 더한다(위아래는 한계까지만). */
  addTurn(dYaw, dPitch) {
    this.turn.yaw += dYaw;
    this.turn.pitch = Math.min(MAX_TURN_PITCH, Math.max(-MAX_TURN_PITCH, this.turn.pitch + dPitch));
    this._applyRotation();
  }

  /** 스틱으로 돌린 양을 통째로 넣는다(다음 파일로 넘겨도 돌려 둔 방향을 이어 가려고 쓴다). */
  setTurn(yaw, pitch) {
    this.turn.yaw = yaw || 0;
    this.turn.pitch = clamp(pitch || 0, -MAX_TURN_PITCH, MAX_TURN_PITCH);
    this._applyRotation();
  }

  /** 스틱 회전 양을 처음(정면)으로 되돌린다. */
  resetTurn() {
    this.turn.yaw = 0;
    this.turn.pitch = 0;
    this._applyRotation();
  }

  /** 구는 머리 위치를 중심으로, 스크린은 머리 앞 자리에서 머리를 중심으로 돈다. */
  _applyRotation() {
    this.shell.rotation.set(this.turn.pitch, this.baseYaw + this.turn.yaw, 0, 'YXZ');
  }

  dispose() {
    this._clear();
    this._material.dispose();
    this._screenMaterial.dispose();
    this.root.removeFromParent();
  }
}

export { FrontSide };

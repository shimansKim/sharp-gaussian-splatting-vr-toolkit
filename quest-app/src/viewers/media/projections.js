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

export const SPHERE_RADIUS = 50;
/**
 * 가상 스크린이 놓이는 기본 거리(m)와 화면 너비 기준.
 * 거리 3m에 너비 6m면 가로 시야각이 약 90°라 '앞의 작은 TV'가 아니라 시야를 가득 채운다(실기기 피드백).
 */
export const SCREEN_DISTANCE = 3;
export const SCREEN_BASE_WIDTH = 6;
/** 스틱으로 돌릴 수 있는 위아래 한계(라디안) */
export const MAX_TURN_PITCH = (80 * Math.PI) / 180;

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
  let t = 0;
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
      uvs[t++] = region.u0 + fu * (region.u1 - region.u0);
      uvs[t++] = region.v0 + fv * (region.v1 - region.v0);
    }
  }
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
    this.screenScale = 1;
    /** place()가 정한 바라보는 방향(라디안). 스크린만 쓴다. */
    this.baseYaw = 0;
    /** 스틱으로 돌린 양(라디안): yaw는 위(Y)축, pitch는 가로(X)축 */
    this.turn = { yaw: 0, pitch: 0 };
    this.mediaWidth = 1920;
    this.mediaHeight = 1080;
    this.meshes = [];
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
    if (opts.screenScale !== undefined) this.screenScale = opts.screenScale;
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
        geometry = buildSphereGeometry({ azMin: -Math.PI, azMax: Math.PI, region });
        material.side = BackSide;
      } else if (shape === 'sphere180') {
        geometry = buildSphereGeometry({ azMin: -Math.PI / 2, azMax: Math.PI / 2, segU: 48, region });
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
      if (shape === 'screen') mesh.position.set(0, 0, -SCREEN_DISTANCE);
      if (layerEye === 'left') mesh.layers.set(LAYER_LEFT);
      else if (layerEye === 'right') mesh.layers.set(LAYER_RIGHT);
      else mesh.layers.set(0);
      this.shell.add(mesh);
      this.meshes.push(mesh);
    });
    this.shell.userData.shape = shape;
  }

  /** 가상 스크린 크기 배율을 바꾼다(각도 크기만 달라지고 거리는 같다). */
  setScreenScale(scale) {
    this.screenScale = Math.min(3, Math.max(0.3, scale));
    if (this.isScreen) this._rebuild();
  }

  /** 360/180 구는 머리 위치를 따라가고 방향은 그대로 둔다. 스크린은 place()로 놓은 자리에 둔다. */
  follow(headPosition) {
    if (!this.isScreen) this.shell.position.copy(headPosition);
  }

  /** 스크린을 머리 앞에 놓는다. yaw는 머리가 바라보는 방향(라디안). 스틱으로 돌린 양은 처음으로 되돌린다. */
  place(headPosition, yaw) {
    this.baseYaw = this.isScreen ? yaw : 0;
    this.turn.yaw = 0;
    this.turn.pitch = 0;
    this.shell.position.copy(headPosition);
    this._applyRotation();
  }

  /** 스틱 회전 증분을 더한다(위아래는 한계까지만). */
  addTurn(dYaw, dPitch) {
    this.turn.yaw += dYaw;
    this.turn.pitch = Math.min(MAX_TURN_PITCH, Math.max(-MAX_TURN_PITCH, this.turn.pitch + dPitch));
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

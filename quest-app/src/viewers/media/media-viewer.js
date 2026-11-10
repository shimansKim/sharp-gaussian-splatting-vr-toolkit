// VR 영상·사진 뷰어. 계약(notes/quest-app-design.md 7.3)의 Viewer를 구현한다.
// kinds: video, image. 형식: VR180, 360(mono/TB/SBS), 3D SBS/TB 가상 스크린, 2D.
import {
  Group,
  LinearFilter,
  Line,
  BufferGeometry,
  LineBasicMaterial,
  Float32BufferAttribute,
  SRGBColorSpace,
  Texture,
  Vector3,
  VideoTexture,
} from 'three';
import { checkVideoDecode, summarizeWarnings } from './decode-check.js';
import { LAYOUTS, LAYOUT_ORDER, detectLayout, isLayout } from './format-detect.js';
import { readMp4Meta } from './mp4-meta.js';
import { LAYER_LEFT, MediaProjection } from './projections.js';
import { VrHud, formatTime } from './vr-hud.js';

const SEEK_STEP = 10;
const MAX_PHOTO_SIDE = 8192;
const HUD_AUTOHIDE_MS = 9000;

/** 코덱 정보를 MP4 헤더로 읽을 수 있는 확장자/MIME인지 */
function isMp4Like(name, mime) {
  return /\.(mp4|m4v|mov)$/i.test(name || '') || /mp4|quicktime/.test(mime || '');
}

/**
 * 이벤트(EventTarget): 'state'(재생 상태 변화), 'layoutchange'(detail: { itemId, layout, auto }),
 * 'warning'(detail: { level, text }), 'error'(detail: { message })
 */
export class MediaViewer extends EventTarget {
  constructor() {
    super();
    /** @type {Array<'video'|'image'>} */
    this.kinds = ['video', 'image'];
    this.stage = null;
    this.root = new Group();
    this.root.name = 'media-viewer';
    this.root.visible = false;
    this.item = null;
    this.file = null;
    this.video = null;
    this.texture = null;
    this.projection = null;
    this.decode = null;
    this.meta = null;
    this.detected = null;
    this.hud = new VrHud((id, value) => this._onHudAction(id, value));
    this.root.add(this.hud.mesh);
    this._token = 0;
    this._abort = null;
    this._stickCooldown = 0;
    this._lastSync = 0;
    this._lastInteract = 0;
    this._mouse = null;
    this._mouseDownLatch = false;
    this._rayLines = new Map();
    this._tmpHead = new Vector3();
    this._placePending = 0;
    this._input = null;
    this._hudResults = null;
    this._videoHandlers = [];
    this._buffering = false;
    this.resolution = '';
  }

  // ── Viewer 계약 ────────────────────────────────────────────────────────

  mount(stage) {
    this.stage = stage;
    (stage.content ?? stage.scene).add(this.root);
    // 2D 미리보기(XR 밖)는 왼눈만 보여 준다. XR 안에서는 three가 눈별로 레이어를 나눈다.
    stage.camera.layers.enable(LAYER_LEFT);
    const xr = stage.renderer?.xr;
    xr?.addEventListener?.('sessionstart', this._onSessionStart);
    // 컨트롤러가 연결되면 입력원을 기억한다(레이·버튼 읽기에 쓴다).
    for (let i = 0; i < 2; i++) {
      const controller = xr?.getController?.(i);
      if (!controller) continue;
      controller.addEventListener('connected', (e) => {
        controller.userData.inputSource = e.data;
      });
      controller.addEventListener('disconnected', () => {
        delete controller.userData.inputSource;
      });
    }
    this._lastInteract = performance.now();
  }

  /**
   * @param {import('../../core/types.js').LibraryItem} item
   * @param {import('../../core/types.js').OpenedFile} file
   */
  async load(item, file) {
    if (!this.stage) throw new Error('MediaViewer.mount(stage)를 먼저 호출해야 합니다.');
    this.unload();
    const token = ++this._token;
    const abort = new AbortController();
    this._abort = abort;
    this.item = item;
    this.file = file;
    const name = item.name || file.name || '';

    try {
      let width = 0;
      let height = 0;
      let texture;
      let meta = null;
      let decode = null;

      if (item.kind === 'video') {
        const video = this._createVideo(file.url);
        this.video = video;
        const metaPromise = isMp4Like(name, file.mime || item.mime) ? readMp4Meta(file.url, file.size ?? item.size, abort.signal) : Promise.resolve(null);
        await this._waitForMetadata(video, abort.signal);
        if (token !== this._token) return;
        meta = await metaPromise;
        if (token !== this._token) return;
        width = video.videoWidth || meta?.width || 0;
        height = video.videoHeight || meta?.height || 0;
        decode = await checkVideoDecode({
          name,
          mime: file.mime || item.mime,
          family: meta?.family ?? null,
          codec: meta?.codec ?? null,
          width,
          height,
          frameRate: meta?.frameRate || 0,
          bitrate: meta?.bitrate || 0,
        });
        if (token !== this._token) return;
        texture = new VideoTexture(video);
        texture.colorSpace = SRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
      } else if (item.kind === 'image') {
        const bitmap = await this._loadBitmap(file.url, abort.signal);
        if (token !== this._token) {
          bitmap.close?.();
          return;
        }
        width = bitmap.width;
        height = bitmap.height;
        texture = new Texture(bitmap);
        texture.colorSpace = SRGBColorSpace;
        texture.flipY = false; // createImageBitmap에서 이미 뒤집었다
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
      } else {
        throw new Error(`MediaViewer가 처리할 수 없는 종류입니다: ${item.kind}`);
      }

      this.meta = meta;
      this.decode = decode;
      this.texture = texture;
      this.resolution = width && height ? `${width}×${height}` : '';

      // 형식: 사용자가 정해 둔 값이 있으면 그대로, 없으면 판별한다.
      this.detected = detectLayout({ name, width, height, spatial: meta });
      const layout = isLayout(item.layout) ? item.layout : this.detected.layout;

      this.projection = new MediaProjection(texture);
      this.projection.setLayout(layout, { width, height });
      this.root.add(this.projection.root);
      this.root.visible = true;
      this._placeAll();

      this.hud.setState({
        kind: item.kind,
        name,
        resolution: this.resolution,
        warning: decode ? summarizeWarnings(decode) : '',
        warningLevel: decode ? this._worstLevel(decode.warnings) : 'info',
      });
      this._syncHud();
      if (decode?.warnings.length) {
        const worst = decode.warnings.find((w) => w.level === 'error') ?? decode.warnings[0];
        this.dispatchEvent(new CustomEvent('warning', { detail: { level: worst.level, text: worst.text, all: decode.warnings } }));
      }

      this.hud.setVisible(true);
      this._lastInteract = performance.now();

      if (this.video) {
        try {
          await this.video.play();
        } catch {
          // 자동 재생이 막혀도 HUD의 재생 버튼으로 시작할 수 있다.
        }
      }
      this._emitState();
    } catch (error) {
      if (token === this._token) {
        this.dispatchEvent(new CustomEvent('error', { detail: { message: error.message } }));
        this._disposeContent();
      }
      throw error;
    }
  }

  unload() {
    this._token++;
    this._abort?.abort();
    this._abort = null;
    this._disposeContent();
    this.item = null;
    this.file = null;
    this.root.visible = false;
    this.hud.setVisible(false);
  }

  /** 매 프레임. input은 사용하지 않고 컨트롤러 입력은 직접 읽는다. */
  update(dt, input) {
    if (!this.item || !this.projection) return;
    this._input = input ?? null;
    const now = performance.now();
    if (this._placePending > 0 && this._presenting() && --this._placePending === 0) {
      this._placeAll();
      this.showHud();
    }
    const camera = this._viewCamera();
    camera.getWorldPosition(this._tmpHead);
    this.projection.follow(this._tmpHead);

    // 프레임이 느려도 재생 시간 표시가 밀리지 않도록 dt가 아닌 실제 시계로 갱신 주기를 잡는다.
    if (now - this._lastSync >= 250) {
      this._lastSync = now;
      this._syncHud();
    }

    const pointers = this._collectPointers();
    this._handleControllerInput(pointers, dt, now);
    this._autoHide(now);
    this._updateRays(pointers);
    this.hud.tick();
  }

  panelActions() {
    const actions = [];
    if (this.item?.kind === 'video') {
      actions.push({ id: 'media-play', label: '재생/일시정지', run: () => this.togglePlay() });
      actions.push({ id: 'media-back', label: '10초 뒤로', run: () => this.seekBy(-SEEK_STEP) });
      actions.push({ id: 'media-fwd', label: '10초 앞으로', run: () => this.seekBy(SEEK_STEP) });
    }
    actions.push({ id: 'media-layout', label: `형식: ${this.layoutInfo?.short ?? ''}`.trim(), run: () => this.cycleLayout(1) });
    actions.push({ id: 'media-hud', label: '재생 컨트롤 표시', run: () => this.showHud() });
    return actions;
  }

  // ── 공개 제어 API (2D UI, VR 패널, 테스트 페이지가 같이 쓴다) ───────────────

  get layout() {
    return this.projection?.layout ?? null;
  }

  get layoutInfo() {
    return this.projection ? LAYOUTS[this.projection.layout] : null;
  }

  getState() {
    const v = this.video;
    return {
      kind: this.item?.kind ?? null,
      name: this.item?.name ?? '',
      layout: this.layout,
      detected: this.detected,
      resolution: this.resolution,
      playing: !!v && !v.paused && !v.ended,
      time: v?.currentTime ?? 0,
      duration: Number.isFinite(v?.duration) ? v.duration : 0,
      muted: !!v?.muted,
      loop: !!v?.loop,
      swapEyes: !!this.projection?.swapEyes,
      decode: this.decode,
      meta: this.meta,
    };
  }

  play() {
    return this.video?.play().catch(() => {});
  }

  pause() {
    this.video?.pause();
  }

  togglePlay() {
    if (!this.video) return;
    if (this.video.paused || this.video.ended) this.play();
    else this.pause();
  }

  seekTo(sec) {
    const v = this.video;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.min(Math.max(0, sec), v.duration);
    this._syncHud(true);
  }

  seekBy(delta) {
    if (this.video) this.seekTo(this.video.currentTime + delta);
  }

  setMuted(muted) {
    if (this.video) this.video.muted = !!muted;
  }

  setLoop(loop) {
    if (this.video) this.video.loop = !!loop;
  }

  /** 형식을 바꾼다. 항목별로 기억하도록 'layoutchange'를 보낸다. */
  setLayout(layout, { auto = false } = {}) {
    if (!this.projection || !isLayout(layout)) return;
    const [w, h] = [this.video?.videoWidth || this.texture?.image?.width || 0, this.video?.videoHeight || this.texture?.image?.height || 0];
    this.projection.setLayout(layout, { width: w || undefined, height: h || undefined });
    this._placeAll();
    this._syncHud(true);
    if (this.item) this.item.layout = layout;
    this.dispatchEvent(new CustomEvent('layoutchange', { detail: { itemId: this.item?.id, layout, auto } }));
  }

  cycleLayout(step = 1) {
    if (!this.projection) return;
    const index = LAYOUT_ORDER.indexOf(this.projection.layout);
    const next = LAYOUT_ORDER[(index + step + LAYOUT_ORDER.length) % LAYOUT_ORDER.length];
    this.setLayout(next);
  }

  setSwapEyes(value) {
    if (!this.projection) return;
    this.projection.setLayout(this.projection.layout, { swapEyes: value });
    this._syncHud(true);
  }

  scaleScreen(factor) {
    if (!this.projection?.isScreen) return;
    this.projection.setScreenScale(this.projection.screenScale * factor);
    this._syncHud(true);
  }

  /** 지금 바라보는 방향으로 스크린·패널을 다시 놓는다. */
  recenter() {
    this._placeAll();
  }

  showHud() {
    this._placeHud();
    this.hud.setVisible(true);
    this._lastInteract = performance.now();
  }

  hideHud() {
    this.hud.setVisible(false);
  }

  toggleHud() {
    if (this.hud.visible) this.hideHud();
    else this.showHud();
  }

  /**
   * XR 밖(데스크톱)에서 마우스로 패널을 눌러 볼 때 쓴다.
   * @param {import('three').Raycaster | null} raycaster null이면 포인터 해제
   */
  setMousePointer(raycaster, pressed) {
    // 눌렀다 떼는 사이에 프레임이 없어도 클릭이 사라지지 않도록, 눌림은 한 프레임 처리될 때까지 유지한다.
    if (pressed) this._mouseDownLatch = true;
    this._mouse = raycaster ? { id: 'mouse', origin: raycaster.ray.origin.clone(), direction: raycaster.ray.direction.clone(), pressed: !!pressed } : null;
  }

  dispose() {
    this.unload();
    this.stage?.renderer?.xr?.removeEventListener?.('sessionstart', this._onSessionStart);
    this.hud.dispose();
    this.root.removeFromParent();
  }

  // ── 내부 ──────────────────────────────────────────────────────────────

  _onSessionStart = () => {
    // 세션 시작 직후에는 머리 자세가 아직 없으므로 몇 프레임 뒤에 정면에 놓는다.
    this._placePending = 4;
  };

  _viewCamera() {
    const { renderer, camera } = this.stage;
    return this._presenting() ? renderer.xr.getCamera() : camera;
  }

  _presenting() {
    return this.stage.isPresenting ? !!this.stage.isPresenting() : !!this.stage.renderer?.xr?.isPresenting;
  }

  _headYaw() {
    const camera = this._viewCamera();
    const forward = new Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    return Math.atan2(-forward.x, -forward.z);
  }

  _placeAll() {
    if (!this.projection) return;
    const camera = this._viewCamera();
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(this._tmpHead);
    const yaw = this._headYaw();
    this.projection.place(this._tmpHead, yaw);
    this._placeHud();
  }

  _placeHud() {
    const camera = this._viewCamera();
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(this._tmpHead);
    this.hud.place(this._tmpHead, this._headYaw());
  }

  _worstLevel(warnings) {
    if (warnings.some((w) => w.level === 'error')) return 'error';
    if (warnings.some((w) => w.level === 'warn')) return 'warn';
    return 'info';
  }

  _createVideo(url) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.loop = false;
    video.src = url;
    const on = (type, fn) => {
      video.addEventListener(type, fn);
      this._videoHandlers.push([type, fn]);
    };
    on('play', () => this._emitState());
    on('pause', () => this._emitState());
    on('ended', () => {
      this._emitState();
      this.showHud();
    });
    on('volumechange', () => this._syncHud(true));
    // 네트워크(PC·드라이브)에서 스트리밍할 때 데이터가 모자라면 '버퍼링 중'을 알린다.
    on('waiting', () => this._setBuffering(true));
    on('stalled', () => {
      if (!video.paused && video.readyState < 3) this._setBuffering(true);
    });
    for (const type of ['playing', 'canplay', 'seeked', 'pause']) on(type, () => this._setBuffering(video.readyState < 3 && !video.paused));
    on('error', () => {
      const message = this._videoErrorMessage(video);
      this.hud.setState({ warning: message, warningLevel: 'error' });
      this.dispatchEvent(new CustomEvent('error', { detail: { message } }));
    });
    return video;
  }

  _setBuffering(buffering) {
    if (!this.video || this._buffering === buffering) return;
    this._buffering = buffering;
    const warned = this.decode ? summarizeWarnings(this.decode) : '';
    this.hud.setState(buffering ? { warning: '버퍼링 중…', warningLevel: 'info' } : { warning: warned, warningLevel: this.decode ? this._worstLevel(this.decode.warnings) : 'info' });
    this.dispatchEvent(new CustomEvent('buffering', { detail: { buffering } }));
  }

  _videoErrorMessage(video) {
    const code = video.error?.code;
    const family = this.meta?.family;
    const hint = this.decode ? summarizeWarnings(this.decode) : '';
    if (code === 4) return `이 영상은 재생할 수 없습니다(코덱·형식 미지원). ${hint}`.trim();
    if (code === 3) return `영상 디코딩 중 오류가 났습니다. ${hint || (family ? `${family} 영상이 기기 한계를 넘었을 수 있습니다.` : '')}`.trim();
    return `영상을 불러오지 못했습니다(오류 ${code ?? '?'}).`;
  }

  _waitForMetadata(video, signal) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onOk);
        video.removeEventListener('error', onErr);
        signal.removeEventListener('abort', onAbort);
        clearTimeout(timer);
      };
      const onOk = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error(this._videoErrorMessage(video)));
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('중단됨', 'AbortError'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('영상 정보를 읽는 데 시간이 너무 오래 걸립니다.'));
      }, 30000);
      video.addEventListener('loadedmetadata', onOk);
      video.addEventListener('error', onErr);
      signal.addEventListener('abort', onAbort);
    });
  }

  async _loadBitmap(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`사진을 읽지 못했습니다(${res.status}).`);
    const blob = await res.blob();
    const gl = this.stage.renderer?.capabilities?.maxTextureSize ?? 4096;
    const limit = Math.min(gl, MAX_PHOTO_SIDE);
    const base = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
    let bitmap = await createImageBitmap(blob, base);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest > limit) {
      const scale = limit / longest;
      const resized = await createImageBitmap(blob, {
        ...base,
        resizeWidth: Math.round(bitmap.width * scale),
        resizeHeight: Math.round(bitmap.height * scale),
        resizeQuality: 'high',
      });
      bitmap.close?.();
      bitmap = resized;
    }
    return bitmap;
  }

  _syncHud(force = false) {
    const s = this.getState();
    const info = this.layoutInfo;
    this.hud.setState({
      kind: s.kind ?? 'video',
      playing: s.playing,
      time: Math.floor(s.time * 4) / 4,
      duration: s.duration,
      muted: s.muted,
      loop: s.loop,
      swapEyes: s.swapEyes,
      layoutLabel: info?.label ?? '',
      layoutShort: info?.short ?? '',
      stereo: !!info && info.stereo !== 'mono',
      canScale: !!this.projection?.isScreen,
    });
    if (force) this.hud.tick();
  }

  _emitState() {
    this._syncHud(true);
    this.dispatchEvent(new CustomEvent('state', { detail: this.getState() }));
  }

  _onHudAction(id, value) {
    this._lastInteract = performance.now();
    switch (id) {
      case 'play':
        this.togglePlay();
        break;
      case 'back10':
        this.seekBy(-SEEK_STEP);
        break;
      case 'fwd10':
        this.seekBy(SEEK_STEP);
        break;
      case 'seek':
        if (this.video && Number.isFinite(this.video.duration)) this.seekTo(this.video.duration * value);
        break;
      case 'mute':
        this.setMuted(!this.video?.muted);
        break;
      case 'loop':
        this.setLoop(!this.video?.loop);
        break;
      case 'layoutPrev':
        this.cycleLayout(-1);
        break;
      case 'layoutNext':
        this.cycleLayout(1);
        break;
      case 'swap':
        this.setSwapEyes(!this.projection?.swapEyes);
        break;
      case 'sizeDown':
        this.scaleScreen(1 / 1.15);
        break;
      case 'sizeUp':
        this.scaleScreen(1.15);
        break;
      case 'recenter':
        this.recenter();
        break;
      case 'close':
        this.hideHud();
        break;
      default:
        break;
    }
    this._emitState();
  }

  /** XR 컨트롤러(레이)와 데스크톱 마우스 포인터를 한 목록으로 모은다. */
  _collectPointers() {
    const list = [];
    const xr = this.stage.renderer?.xr;
    if (this._presenting() && xr) {
      for (let i = 0; i < 2; i++) {
        const controller = xr.getController(i);
        const source = controller.userData.inputSource ?? this._sourceFor(i);
        if (!source) continue;
        if (!controller.parent) (this.stage.player ?? this.stage.scene).add(controller);
        controller.updateWorldMatrix(true, false);
        list.push({
          id: i,
          origin: controller.getWorldPosition(new Vector3()),
          direction: new Vector3(0, 0, -1).transformDirection(controller.matrixWorld),
          hand: source.handedness,
          pressed: this._input
            ? (this._input[source.handedness]?.trigger ?? 0) > 0.6
            : !!source.gamepad?.buttons?.[0]?.pressed,
          source,
          controller,
        });
      }
    }
    if (this._mouse) {
      list.push(this._mouseDownLatch ? { ...this._mouse, pressed: true } : this._mouse);
      this._mouseDownLatch = false;
    }
    return list;
  }

  _sourceFor(index) {
    const sources = this.stage.renderer?.xr?.getSession?.()?.inputSources;
    return sources && sources[index] ? sources[index] : null;
  }

  _handleControllerInput(pointers, dt, now) {
    const results = this.hud.visible ? this.hud.updatePointers(pointers, now) : new Map();
    if (this.hud.visible && [...this.hud.hover.values()].some(Boolean)) this._lastInteract = now;
    this._hudResults = results;

    const input = this._input;
    if (!input?.presenting) return;
    this._stickCooldown = Math.max(0, this._stickCooldown - dt);
    const overPanel = (hand) => this.hud.visible && pointers.some((p) => p.hand === hand && results.get(p.id));

    // 오른쪽 트리거: 패널 밖을 가리킬 때 재생/일시정지(사진은 패널 표시)
    if (input.right.triggerPressed && !overPanel('right')) {
      if (this.item.kind === 'video') this.togglePlay();
      else this.toggleHud();
      this._lastInteract = now;
    }
    // 그립: 재생 컨트롤을 눈앞으로 불러오거나 숨김
    if (input.left.gripPressed || input.right.gripPressed) {
      if (this.hud.visible) this.hideHud();
      else this.showHud();
    }
    // 오른쪽 스틱 좌우: 10초 이동(영상)
    if (this.item.kind === 'video') {
      const x = input.right.x ?? 0;
      if (Math.abs(x) > 0.7 && this._stickCooldown === 0) {
        this.seekBy(x > 0 ? SEEK_STEP : -SEEK_STEP);
        this._stickCooldown = 0.4;
        this._lastInteract = now;
      } else if (Math.abs(x) < 0.4) {
        this._stickCooldown = 0;
      }
    }
  }

  _autoHide(now) {
    if (!this.hud.visible || !this.video) return;
    if (this.video.paused) return;
    if (now - this._lastInteract > HUD_AUTOHIDE_MS) this.hideHud();
  }

  /** 컨트롤러에 레이 선을 붙이고 패널에 닿으면 거기까지로 줄인다. */
  _updateRays(pointers) {
    const visible = this.hud.visible;
    for (const p of pointers) {
      if (!p.controller) continue;
      let line = this._rayLines.get(p.id);
      if (!line) {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
        line = new Line(geometry, new LineBasicMaterial({ color: 0x8cc0ff, transparent: true, opacity: 0.8, depthTest: false }));
        line.name = 'media-ray';
        line.renderOrder = 101;
        line.frustumCulled = false;
        p.controller.add(line);
        this._rayLines.set(p.id, line);
      }
      line.visible = visible;
      const hit = this._hudResults?.get(p.id);
      line.scale.z = hit ? hit.distance : 1.5;
    }
  }

  _disposeContent() {
    for (const [type, fn] of this._videoHandlers) this.video?.removeEventListener(type, fn);
    this._videoHandlers = [];
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
    if (this.projection) {
      this.projection.dispose();
      this.projection = null;
    }
    if (this.texture) {
      this.texture.image?.close?.();
      this.texture.dispose();
      this.texture = null;
    }
    this.decode = null;
    this.meta = null;
    this.detected = null;
    this._buffering = false;
    this.resolution = '';
    for (const line of this._rayLines.values()) {
      line.removeFromParent();
      line.geometry.dispose();
      line.material.dispose();
    }
    this._rayLines.clear();
  }
}

/** registry.js 등록용 팩토리: registerViewer(createMediaViewer()) */
export function createMediaViewer() {
  return new MediaViewer();
}

export { formatTime };
export default MediaViewer;

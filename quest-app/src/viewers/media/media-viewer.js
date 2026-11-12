// VR 영상·사진 뷰어. 계약(notes/quest-app-design.md 7.3)의 Viewer를 구현한다.
// kinds: video, image. 형식: VR180, 360(mono/TB/SBS), 3D SBS/TB 가상 스크린, 2D.
import {
  CanvasTexture,
  Group,
  LinearFilter,
  Line,
  BufferGeometry,
  LineBasicMaterial,
  Euler,
  Float32BufferAttribute,
  Quaternion,
  SRGBColorSpace,
  Texture,
  Vector3,
  VideoTexture,
} from 'three';
import { checkVideoDecode, summarizeWarnings } from './decode-check.js';
import { audioDiagText, checkAudioTrack, judgeAudioRuntime } from './audio-check.js';
import { on } from '../../core/events.js';
import { contentTurnDelta, splitRightStick } from '../../core/stick-rules.js';
import { ui } from '../../core/ui-state.js';
import { LAYOUTS, LAYOUT_ORDER, detectLayout, isLayout, refineDetectionWithSniff, sniffStereo } from './format-detect.js';
import { MediaLayerPresenter, layerSpec, mediaLayersSupported } from './layers-path.js';
import { DiagPanel, describeSource, diagLines } from './media-diag.js';
import { rememberLayout, recallLayout } from './layout-memory.js';
import { readMp4Meta } from './mp4-meta.js';
import { LAYER_LEFT, MediaProjection } from './projections.js';
import { loadZoom, saveZoom, zoomLabel } from './zoom-memory.js';
import { describeVideoError } from './video-error.js';
import { VrHud, formatTime } from './vr-hud.js';

const SEEK_STEP = 10;
const MAX_PHOTO_SIDE = 8192;
const HUD_AUTOHIDE_MS = 9000;
/** 왼쪽 스틱으로 장면을 돌리는 최대 속도(라디안/초) */
const TURN_SPEED = 1.4;
/** 오른쪽 스틱 상하 줌 속도: 끝까지 밀면 1초에 e^ZOOM_RATE배(약 2.5배) */
const ZOOM_RATE = 0.9;
/** 패널 +/− 버튼 한 번의 배율 */
const ZOOM_STEP = 1.15;
const HINT_MS = 5000;
const RENDER_PREF_KEY = 'sharp.media.renderPath';
const EYE_METHOD_KEY = 'sharp.media.eyeMethod';
const DIAG_LOG_MS = 5000;

function readEyeMethod() {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('eye');
    if (q === 'mask' || q === 'camera') return q;
    return globalThis.localStorage?.getItem(EYE_METHOD_KEY) === 'mask' ? 'mask' : 'camera';
  } catch {
    return 'camera';
  }
}

function readRenderPref() {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('layers');
    if (q === '0') return 'mesh';
    if (q === '1') return 'layers';
    return globalThis.localStorage?.getItem(RENDER_PREF_KEY) === 'mesh' ? 'mesh' : 'layers';
  } catch {
    return 'layers';
  }
}

function writeRenderPref(value) {
  try {
    globalThis.localStorage?.setItem(RENDER_PREF_KEY, value);
  } catch {
    // 저장이 막혀도 이번 실행 동안은 유지된다.
  }
}

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
    this._audioNote = null;
    this._audioJudged = false;
    this.hud = new VrHud((id, value) => this._onHudAction(id, value));
    this.root.add(this.hud.mesh);
    // 진단 패널: HUD 위쪽에 붙어 HUD가 놓이는 대로 따라간다. HUD 버튼 '진단'으로 켠다.
    this.diag = new DiagPanel();
    this.diag.attachTo(this.hud.mesh, this.hud.mesh.geometry.parameters.height);
    this.eyeMethod = readEyeMethod();
    this._layerReason = '';
    this._eyeTest = null;
    this._frame = { last: 0, sum: 0, max: 0, slow: 0, count: 0, windowStart: 0, shown: { avg: 0, max: 0, slow: 0, count: 0 } };
    this._vfc = { count: 0 };
    this._diagPrev = { at: 0, vfc: 0, dropped: 0, total: 0, eye: { left: 0, right: 0, cross: 0, mono: 0 } };
    this._diagRefreshAt = 0;
    this._diagLogAt = 0;
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
    /** 'layers'(컴포지터 레이어) | 'mesh'(three 메시). 지금 실제로 쓰는 경로 */
    this.renderPath = 'mesh';
    /** 사용자가 고른 선호: 'layers'면 가능할 때 레이어를 쓰고 안 되면 메시 */
    this.renderPref = readRenderPref();
    this.presenter = null;
    this._lastPlace = null;
    this._hudPlaced = false;
    this._hudWasVisible = false;
    this._layoutFromUser = false;
    /** 사람이 맞춰 둔 줌(스크린 배율·구 확대). 파일을 넘기고 앱을 다시 켜도 유지한다. */
    this.zoom = loadZoom();
    this._zoomDirty = false;
    /** 사람이 스틱으로 돌려 둔 장면 회전. 파일을 넘겨도 이어 간다(L3로 맞출 때만 초기화). */
    this._turnMemory = { yaw: 0, pitch: 0 };
    this._sessionStartAt = 0;
    /** 공용 UI를 끌 때 재생 컨트롤이 보였는지(켤 때 되살린다). core/ui-state.js */
    this._hudBeforeUiOff = false;
    /** 공용 VR 패널이 열려 있는 동안은 같은 자리를 쓰므로 재생 컨트롤을 되살리지 않는다. */
    this._panelOpen = false;
    this._offUi = [];
    this.perf = null;
    this._hintTimer = 0;
    this._perf = { lastDropped: 0, lastTotal: 0, at: 0 };
  }

  // ── Viewer 계약 ────────────────────────────────────────────────────────

  mount(stage) {
    this.stage = stage;
    (stage.content ?? stage.scene).add(this.root);
    // 2D 미리보기(XR 밖)는 왼눈만 보여 준다. XR 안에서는 three가 눈별로 레이어를 나눈다.
    stage.camera.layers.enable(LAYER_LEFT);
    const xr = stage.renderer?.xr;
    xr?.addEventListener?.('sessionstart', this._onSessionStart);
    xr?.addEventListener?.('sessionend', this._onSessionEnd);
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
    // 공용 UI 상태(app-dev): 끌 때 보이던 재생 컨트롤을 기억했다가 켤 때 되살린다. 자리는 UI 앵커가 정해질 때·사람이 옮길 때만 다시 놓는다.
    this._offUi.push(on('ui:visibility', ({ visible }) => this._onUiVisibility(visible)));
    this._offUi.push(on('ui:anchor', () => this._onUiAnchor()));
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
      // 사람이 파일별로 고른 형식(보관함 항목·기기에 기억해 둔 값)이 있으면 그대로, 없으면 판별한다.
      const remembered = isLayout(item.layout) ? item.layout : recallLayout(item.id);
      const layout = remembered ?? this.detected.layout;
      this._layoutFromUser = !!remembered;

      this.projection = new MediaProjection(texture);
      this.projection.eyeMethod = this.eyeMethod;
      this.projection.setLayout(layout, { width, height, screenScale: this.zoom.screen, sphereZoom: this.zoom.sphere });
      this.projection.setTurn(this._turnMemory.yaw, this._turnMemory.pitch);
      this.root.add(this.projection.root);
      this.root.visible = true;
      // 화면·패널 자리는 세션 안에서 한 번만 정하고 파일을 넘겨도 그대로 둔다(사람이 L3·위치 맞춤을 누를 때만 다시 맞춘다).
      this._placeAll({ aim: false, hud: !this._hudPlaced });
      // 세션이 시작된 지 한참 뒤에 연 파일은 머리 자세가 이미 있으므로 세션 시작 때의 지연 배치를 취소한다.
      if (this._presenting() && performance.now() - this._sessionStartAt > 1500) this._placePending = 0;

      this.hud.setState({
        kind: item.kind,
        name,
        resolution: this.resolution,
        warning: decode ? summarizeWarnings(decode) : '',
        warningLevel: decode ? this._worstLevel(decode.warnings) : 'info',
      });
      this._syncHud();
      this._setAudioWarning(this.video ? checkAudioTrack(meta, (type) => this.video.canPlayType(type)) : null);
      if (decode?.warnings.length) {
        const worst = decode.warnings.find((w) => w.level === 'error') ?? decode.warnings[0];
        this.dispatchEvent(new CustomEvent('warning', { detail: { level: worst.level, text: worst.text, all: decode.warnings } }));
      }

      // 새 파일을 열면 재생 컨트롤을 보인다(UI가 꺼져 있으면 켤 때 보이게 기억만 한다).
      if (ui.visible) this.hud.setVisible(true);
      else this._hudBeforeUiOff = true;
      this._lastInteract = performance.now();
      if (!remembered && this.detected.confidence !== 'high') {
        this._flashHint(`형식을 ${this.detected.confidence === 'low' ? '해상도 비율로 추정' : '이름·비율로 판단'}했어요: ${LAYOUTS[layout].label}. 다르면 아래 ◀ ▶로 바꾸세요.`, 8000);
      }

      if (this.video) {
        try {
          await this.video.play();
        } catch {
          // 자동 재생이 막혀도 HUD의 재생 버튼으로 시작할 수 있다.
        }
      }
      this._emitState();
      this._sniffLater(token, width, height);
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
      // 화면만 새로 놓는다. 재생 컨트롤 자리는 UI 앵커(ui:anchor)가 정한다.
      this._placeAll({ hud: false });
      this.showHud();
    }
    const camera = this._viewCamera();
    camera.getWorldPosition(this._tmpHead);
    this.projection.follow(this._tmpHead);
    this._expireHint(now);
    this._samplePerf(now);
    this._trackFrame(now);
    if (this.diag.visible && now - this._diagRefreshAt >= 500) {
      this._diagRefreshAt = now;
      this.diag.setLines(diagLines(this.diagnostics()));
    }

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

  /**
   * 공용 VR 패널 배치 요청(ui/vr-panel.js가 열 때 한 번 읽는다).
   * 재생 컨트롤(HUD)과 같은 도크 자리(스크린 아래)에 열어, 이전·다음·슬라이드쇼·재생 조작이 한 곳에 모이게 한다.
   */
  panelPlacement() {
    if (!this._hudPlaced) this._placeHud();
    return { dock: this.hud.dock() };
  }

  /** 공용 패널이 열리고 닫힐 때(ui/vr-panel.js). 같은 자리를 쓰므로 열려 있는 동안 재생 컨트롤은 숨긴다. */
  onPanelToggle(open) {
    this._panelOpen = !!open;
    if (open) {
      this._hudWasVisible = this.hud.visible;
      this.hideHud();
    } else if (this._hudWasVisible && !this.hud.visible) {
      this.showHud();
    }
    if (!open) this._hudWasVisible = false;
  }

  /** 이전·다음·슬라이드쇼 상태를 재생 컨트롤 이동 줄에 보여 준다(앱이 library·slideshow 변화마다 부른다). */
  setNavState(patch) {
    this.hud.setState(patch);
  }

  panelActions() {
    const actions = [];
    if (this.item?.kind === 'video') {
      actions.push({ id: 'media-play', label: '재생/일시정지', run: () => this.togglePlay() });
      actions.push({ id: 'media-back', label: '10초 뒤로', run: () => this.seekBy(-SEEK_STEP) });
      actions.push({ id: 'media-fwd', label: '10초 앞으로', run: () => this.seekBy(SEEK_STEP) });
    }
    actions.push({ id: 'media-layout', label: `형식: ${this.layoutInfo?.short ?? ''}`.trim(), run: () => this.cycleLayout(1) });
    // 재생 컨트롤을 (이미 놓인 자리에 그대로) 보이고 공용 패널은 닫는다.
    actions.push({
      id: 'media-hud',
      label: '컨트롤 보기',
      run: () => {
        this._hudWasVisible = false;
        this.showHud();
        return 'close';
      },
    });
    actions.push({ id: 'media-diag', label: `진단 ${this.diag.visible ? '숨기기' : '보기'}`, run: () => this.toggleDiag() });
    if (this.projection && this.projection.info.stereo !== 'mono') {
      actions.push({ id: 'media-eyetest', label: `눈 테스트 패턴 ${this._eyeTest ? '끄기' : '켜기'}`, run: () => this.toggleEyeTest() });
      actions.push({ id: 'media-eye', label: `눈 분리: ${this.eyeMethod === 'camera' ? '카메라 판별(기본)' : '레이어 마스크'}`, run: () => this.setEyeMethod(this.eyeMethod === 'camera' ? 'mask' : 'camera') });
    }
    if (this._presenting() && this.item?.kind === 'video' && mediaLayersSupported(this.stage.renderer.xr.getSession())) {
      actions.push({ id: 'media-path', label: `영상 출력: ${this.renderPath === 'layers' ? '레이어(권장)' : '메시'}`, run: () => this.setRenderPref(this.renderPref === 'layers' ? 'mesh' : 'layers') });
    }
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
      volume: v?.volume ?? 1,
      loop: !!v?.loop,
      swapEyes: !!this.projection?.swapEyes,
      decode: this.decode,
      meta: this.meta,
      renderPath: this.renderPath,
      renderPref: this.renderPref,
      eyeMethod: this.eyeMethod,
      zoom: this.projection?.zoom ?? null,
    };
  }

  /** 눈 분리 방식을 바꾼다('camera' | 'mask'). 기기에 기억한다. */
  setEyeMethod(method) {
    this.eyeMethod = method === 'mask' ? 'mask' : 'camera';
    try {
      globalThis.localStorage?.setItem(EYE_METHOD_KEY, this.eyeMethod);
    } catch {
      // 저장이 막혀도 이번 실행 동안은 유지된다.
    }
    this.projection?.setEyeMethod(this.eyeMethod);
    this._flashHint(this.eyeMethod === 'camera' ? '눈 분리: 카메라 판별(눈마다 맞는 그림만 그림)' : '눈 분리: 레이어 마스크(three 기본)', 4000);
    this._emitState();
  }

  /**
   * 눈 테스트 패턴: 왼쪽 절반 빨강 'L', 오른쪽 절반 파랑 'R'인 좌우 입체(SBS) 그림을 지금 쓰는 메시 경로로 보여 준다.
   * 한쪽 눈을 감고 보면 왼눈에는 빨강 L만, 오른눈에는 파랑 R만 보여야 눈별 분리가 되는 것이다(둘 다 같은 색이면 분리 실패).
   */
  toggleEyeTest() {
    if (this._eyeTest) {
      const t = this._eyeTest;
      this._eyeTest = null;
      t.projection.dispose();
      t.texture.dispose();
      if (this.projection) this.projection.root.visible = this.renderPath !== 'layers';
      this._flashHint('눈 테스트 패턴을 껐습니다.', 3000);
      return;
    }
    if (!this.projection) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#d02020';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#2040d0';
    ctx.fillRect(512, 0, 512, 512);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 380px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('L', 256, 270);
    ctx.fillText('R', 768, 270);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const projection = new MediaProjection(texture);
    projection.eyeMethod = this.eyeMethod;
    projection.setLayout('sbsScreenFull', { width: 1024, height: 512 });
    const base = this._lastPlace ?? { head: this._tmpHead.clone(), yaw: 0 };
    projection.place(base.head, base.yaw);
    // 영상 레이어가 컴포지터에서 뒤에 깔려 있으면 가려지므로 진짜 영상 레이어도 잠깐 내린다.
    this.projection.root.visible = false;
    this.presenter?.detach();
    this.renderPath = 'mesh';
    this.root.add(projection.root);
    this._eyeTest = { projection, texture };
    this._flashHint('눈 테스트: 왼눈만 뜨면 빨강 L, 오른눈만 뜨면 파랑 R이 보여야 합니다.', 12000);
  }

  /** 진단 패널을 켜고 끈다(HUD '진단' 버튼). */
  toggleDiag() {
    const on = !this.diag.visible;
    this.diag.setVisible(on);
    if (on) {
      this._diagRefreshAt = 0;
      this.diag.setLines(diagLines(this.diagnostics()));
    }
    this.hud.setState({ diagOn: on });
    this._lastInteract = performance.now();
  }

  /**
   * 입체·끊김 원인을 가리는 진단 값. VR 패널·콘솔(`[media-diag]`)·원격 디버깅(`__sharpQuest.mediaViewer.diagnostics()`)에서 같이 쓴다.
   */
  diagnostics() {
    if (!this.item || !this.projection) return null;
    const now = performance.now();
    const renderer = this.stage.renderer;
    const xr = renderer.xr;
    const presenting = this._presenting();
    const session = presenting ? xr.getSession?.() : null;
    const cams = presenting ? [...(xr.getCamera().cameras ?? [])] : [];
    const stateLayers = session?.renderState?.layers ? [...session.renderState.layers].map((l) => l?.constructor?.name ?? l?.type ?? '?') : [];
    const enabled = session?.enabledFeatures ? [...session.enabledFeatures] : null;
    const prev = this._diagPrev;
    const dt = prev.at ? Math.max(0.001, (now - prev.at) / 1000) : 0;
    const e = this.projection.eyeStats;
    const rate = (key) => (dt ? Math.round((e[key] - prev.eye[key]) / dt) : 0);
    const eyeRate = { left: rate('left'), right: rate('right'), cross: rate('cross'), mono: rate('mono') };
    let video = null;
    const v = this.video;
    if (v) {
      const q = v.getVideoPlaybackQuality?.() ?? { droppedVideoFrames: 0, totalVideoFrames: 0 };
      let ahead = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.1 && v.buffered.end(i) >= v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
      }
      video = {
        presentedFps: dt ? Math.round((this._vfc.count - prev.vfc) / dt) : 0,
        nominalFps: this.meta?.frameRate ? Math.round(this.meta.frameRate * 10) / 10 : 0,
        dropped: q.droppedVideoFrames,
        total: q.totalVideoFrames,
        droppedInterval: dt ? q.droppedVideoFrames - prev.dropped : 0,
        totalInterval: dt ? q.totalVideoFrames - prev.total : 0,
        readyState: v.readyState,
        bufferAhead: Math.round(ahead * 10) / 10,
        codec: this.meta?.codec ?? '',
        bitrate: this.meta?.bitrate ? Math.round(this.meta.bitrate / 1e5) / 10 : 0,
        source: describeSource(v.currentSrc || v.src, globalThis.location?.origin ?? ''),
        audio: audioDiagText({ muted: v.muted, volume: v.volume, decodedBytes: v.webkitAudioDecodedByteCount, meta: this.meta }),
      };
      this._diagPrev = { at: now, vfc: this._vfc.count, dropped: q.droppedVideoFrames, total: q.totalVideoFrames, eye: { ...e } };
    } else {
      this._diagPrev = { at: now, vfc: 0, dropped: 0, total: 0, eye: { ...e } };
    }
    return {
      path: this.renderPath,
      pref: this.renderPref,
      layout: this.layout,
      kind: this.item.kind,
      resolution: this.resolution,
      presenting,
      layer: { active: !!this.presenter?.active, error: this.presenter?.lastError ?? '', reason: this._layerReason },
      xr: {
        mediaBinding: typeof globalThis.XRMediaBinding !== 'undefined',
        layersFeature: enabled ? (enabled.includes('layers') ? '있음' : '없음') : '?',
        stateLayers,
        cameras: cams.length,
        masks: cams.map((c) => c.layers.mask),
        viewports: cams.map((c) => `${Math.round(c.viewport?.x ?? 0)}+${Math.round(c.viewport?.z ?? 0)}x${Math.round(c.viewport?.w ?? 0)}`),
      },
      eye: this.projection.info.stereo === 'mono' ? null : { method: this.projection.eyeMethod, rate: eyeRate },
      video,
      frame: { ...this._frame.shown },
    };
  }

  /** 렌더 프레임 간격을 2초 창으로 모아 평균·최대·느린 프레임 수를 낸다. */
  _trackFrame(now) {
    const f = this._frame;
    if (f.last) {
      const ms = now - f.last;
      f.sum += ms;
      f.count++;
      if (ms > f.max) f.max = ms;
      if (ms > 25) f.slow++;
    }
    f.last = now;
    if (!f.windowStart) f.windowStart = now;
    if (now - f.windowStart >= 2000) {
      f.shown = { avg: f.count ? Math.round((f.sum / f.count) * 10) / 10 : 0, max: Math.round(f.max), slow: f.slow, count: f.count };
      f.sum = 0;
      f.max = 0;
      f.slow = 0;
      f.count = 0;
      f.windowStart = now;
    }
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

  /** 0~1. 소리를 키우면 음소거도 풀어 준다. */
  setVolume(volume) {
    if (!this.video) return;
    const v = Math.min(1, Math.max(0, Number(volume)));
    this.video.volume = Number.isFinite(v) ? v : 1;
    if (this.video.volume > 0) this.video.muted = false;
  }

  /** 버퍼링이 아닐 때 HUD 경고 줄에 둘 내용: 디코드 경고, 단 소리 안내가 있고 디코드 경고가 error가 아니면 소리 안내가 앞선다. */
  _idleWarning() {
    const decodeText = this.decode ? summarizeWarnings(this.decode) : '';
    const decodeLevel = this.decode ? this._worstLevel(this.decode.warnings) : 'info';
    if (this._audioNote && !(decodeText && decodeLevel === 'error')) return { warning: this._audioNote.text, warningLevel: this._audioNote.level };
    return { warning: decodeText, warningLevel: decodeLevel };
  }

  /**
   * 소리 관련 안내를 HUD의 기존 경고 줄에 올린다(새 버튼·배치 없음). null이면 안내를 지운다.
   * @param {{ text: string, level: 'info'|'warn' }|null} note
   */
  _setAudioWarning(note) {
    this._audioNote = note;
    if (!this._buffering) this.hud.setState(this._idleWarning());
  }

  /** 재생이 1.5초쯤 진행된 뒤 소리가 실제로 디코딩되는지 한 번 확인한다(timeupdate에서 부른다). */
  _judgeAudio() {
    const v = this.video;
    if (!v || this._audioJudged) return;
    const result = judgeAudioRuntime({
      decodedBytes: v.webkitAudioDecodedByteCount,
      currentTime: v.currentTime,
      playing: !v.paused && !v.ended,
      muted: v.muted,
    });
    if (!result) return;
    this._audioJudged = true;
    if (result === 'ok') this._setAudioWarning(null);
    else if (!this._audioNote) this._setAudioWarning(result);
  }

  setLoop(loop) {
    if (this.video) this.video.loop = !!loop;
  }

  /** 형식을 바꾼다. 항목별로 기억하도록 'layoutchange'를 보낸다. */
  setLayout(layout, { auto = false } = {}) {
    if (!this.projection || !isLayout(layout)) return;
    const [w, h] = [this.video?.videoWidth || this.texture?.image?.width || 0, this.video?.videoHeight || this.texture?.image?.height || 0];
    this.projection.setLayout(layout, { width: w || undefined, height: h || undefined });
    // 형식을 바꿔도 컨트롤 패널은 제자리에 둔다(누르는 동안 패널이 움직이면 다시 누를 수 없다).
    this._placeAll({ aim: false, hud: false });
    this._syncHud(true);
    if (this.item && !auto) this.item.layout = layout;
    if (!auto) {
      this._layoutFromUser = true;
      rememberLayout(this.item?.id, layout);
    }
    // 바뀐 형식 이름을 패널에 잠깐 크게 알린다(버튼 글씨가 바뀌는 걸 놓쳐도 확인할 수 있게).
    this._flashHint(`형식: ${LAYOUTS[layout].label}`, 3000);
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
    this._placeAll({ aim: false, hud: false });
    this._syncHud(true);
    this._flashHint(value ? '눈 바꿈: 켬(좌우 눈 그림을 서로 바꿈)' : '눈 바꿈: 끔', 3000);
  }

  /**
   * 줌 배율을 곱한다. 가상 스크린은 크기(시야각), 360/180은 시야각 확대(1배가 원래, 줄일 수 없음).
   * @param {number} factor 1보다 크면 확대
   * @param {{ persist?: boolean }} [opts] 스틱처럼 연속으로 부를 때는 persist:false로 두고 끝에 _flushZoom()
   */
  zoomBy(factor, { persist = true } = {}) {
    const p = this.projection;
    if (!p || !Number.isFinite(factor) || factor <= 0) return;
    const before = p.zoom;
    const after = p.setZoom(before * factor);
    this.zoom[p.isScreen ? 'screen' : 'sphere'] = after;
    if (after === before) {
      if (persist) this._flashHint(p.isScreen ? '더는 줄이거나 키울 수 없어요.' : '360/180은 원래 크기보다 작게는 못 줄여요.', 2500);
      return;
    }
    this._zoomDirty = true;
    this._refreshRenderPath();
    if (persist) {
      this._flushZoom();
      this._flashHint(`줌 ${zoomLabel(p.isScreen ? 'screen' : 'sphere', after)}`, 2000);
    }
    this._syncHud(persist);
  }

  /** 줌 값을 정하고 기억한다(스크린은 크기 배율, 구는 확대 배율). */
  setZoom(value) {
    const p = this.projection;
    if (p) this.zoomBy(value / p.zoom);
  }

  /** 줌 값을 기기에 기억한다(스틱을 놓았을 때·버튼을 눌렀을 때·파일을 닫을 때). */
  _flushZoom() {
    if (!this._zoomDirty) return;
    this._zoomDirty = false;
    saveZoom(this.zoom);
  }

  /** 예전 이름(HUD −/+ 버튼): 스크린 크기 조절 */
  scaleScreen(factor) {
    this.zoomBy(factor);
  }

  /**
   * 지금 바라보는 방향 앞으로 스크린·패널을 다시 놓고 스틱으로 돌린 양도 되돌린다.
   * 화면 자리는 사람이 이걸 부를 때(L3·패널 '위치 맞춤'·세션 시작)에만 바뀐다.
   */
  recenter() {
    this._placeAll({ hud: false });
  }

  /** 공용 패널의 '위치 초기화'가 부른다: 지금 보는 방향으로 다시 맞춘다. */
  resetView() {
    this.recenter();
  }

  /** 패널을 보이게 한다. 이미 놓인 자리에 그대로 두고, 아직 놓인 적이 없을 때만 UI 앵커 자리에 놓는다. 공용 UI가 꺼져 있으면 띄우지 않는다. */
  showHud() {
    if (!ui.visible) return;
    if (!this._hudPlaced) this._placeHud();
    this.hud.setVisible(true);
    this._lastInteract = performance.now();
  }

  /** 패널을 지금 바라보는 방향 앞에 다시 놓고 보이게 한다(사용자가 버튼으로 부를 때만). */
  callHud() {
    this._placeHud();
    this.hud.setVisible(true);
    this._lastInteract = performance.now();
  }

  hideHud() {
    this.hud.setVisible(false);
  }

  /** 패널을 켜고 끈다. 켤 때 자리를 옮기지 않는다(이미 놓인 자리 그대로). */
  toggleHud() {
    if (this.hud.visible) this.hideHud();
    else this.showHud();
  }

  /** 영상 출력 방식 선호를 바꾼다('layers' | 'mesh'). 기기에 기억한다. */
  setRenderPref(pref) {
    this.renderPref = pref === 'mesh' ? 'mesh' : 'layers';
    writeRenderPref(this.renderPref);
    this._refreshRenderPath();
    this._flashHint(this.renderPath === 'layers' ? '영상 출력: 컴포지터 레이어(부드러움·입체 권장)' : '영상 출력: 메시(레이어를 못 쓰거나 꺼짐)', 4000);
    this._syncHud(true);
    this._emitState();
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
    for (const off of this._offUi.splice(0)) off();
    this._lastPlace = null;
    this._hudPlaced = false;
    this.stage?.renderer?.xr?.removeEventListener?.('sessionstart', this._onSessionStart);
    this.stage?.renderer?.xr?.removeEventListener?.('sessionend', this._onSessionEnd);
    if (this._eyeTest) this.toggleEyeTest();
    this.diag.dispose();
    this.hud.dispose();
    this.root.removeFromParent();
  }

  // ── 내부 ──────────────────────────────────────────────────────────────

  _onSessionStart = () => {
    // 세션마다 기준 좌표가 새로 생기므로 자리를 새로 잡는다. 세션 시작 직후에는 머리 자세가 아직 없어 몇 프레임 뒤에 정면에 놓는다.
    this._lastPlace = null;
    this._hudPlaced = false;
    this._sessionStartAt = performance.now();
    this._placePending = 4;
  };

  _onSessionEnd = () => {
    // 레이어는 세션과 같이 사라진다. 2D 미리보기는 메시로 보여 준다.
    this.presenter?.detach();
    this.renderPath = 'mesh';
    this._placePending = 0;
    if (this.projection) {
      this.projection.root.visible = true;
      // 2D 화면의 카메라는 VR 때와 전혀 다른 자리이므로 한 번 다시 놓는다.
      this._lastPlace = null;
      this._hudPlaced = false;
      this._placeAll();
    }
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

  /**
   * 스크린·구와 패널을 놓는다.
   * @param {{ aim?: boolean, hud?: boolean }} [opts] aim=false면 마지막에 놓은 방향을 그대로 쓴다(형식만 바꿀 때). hud=false면 패널은 건드리지 않는다.
   */
  _placeAll({ aim = true, hud = true } = {}) {
    if (!this.projection) return;
    const reaim = aim || !this._lastPlace;
    if (reaim) {
      const camera = this._viewCamera();
      camera.updateMatrixWorld(true);
      camera.getWorldPosition(this._tmpHead);
      this._lastPlace = { head: this._tmpHead.clone(), yaw: this._headYaw() };
      this._turnMemory = { yaw: 0, pitch: 0 };
    }
    // 방향을 새로 잡을 때만 스틱으로 돌린 양을 지운다(형식·파일이 바뀌는 것만으로는 돌려 둔 화면이 되돌아가지 않는다).
    this.projection.place(this._lastPlace.head, this._lastPlace.yaw, { keepTurn: !reaim });
    if (hud) this._placeHud();
    this._refreshRenderPath();
  }

  /** 재생 컨트롤은 공용 패널과 같은 UI 앵커 자리에 놓는다(core/ui-state.js). 호출해도 앵커는 바뀌지 않는다. */
  _placeHud() {
    const { head, yaw } = ui.reference(this.stage.camera);
    this.hud.place(head, yaw);
    this._hudPlaced = true;
  }

  _onUiVisibility(visible) {
    if (!visible) {
      this._hudBeforeUiOff = this._hudBeforeUiOff || this.hud.visible;
      this.hud.setVisible(false);
      return;
    }
    // 켤 때는 끌 때 보이던 재생 컨트롤을 같은 자리에서 되살린다(공용 패널이 열려 있으면 패널이 그 자리를 쓴다).
    const restore = this._hudBeforeUiOff && !this._panelOpen && !!this.item && !!this.projection;
    this._hudBeforeUiOff = false;
    if (restore) this.showHud();
  }

  _onUiAnchor() {
    if (!this.item || !this.projection) return;
    this._placeHud();
    this._lastInteract = performance.now();
  }

  // ── 영상 출력 경로(컴포지터 레이어 ↔ 메시) ─────────────────────────────────

  _layerSpec() {
    const p = this.projection;
    if (!p) return null;
    const w = this.video?.videoWidth || undefined;
    const h = this.video?.videoHeight || undefined;
    return layerSpec(p.layout, { width: w, height: h, screenScale: p.screenScale, swapEyes: p.swapEyes, sphereZoom: p.sphereZoom });
  }

  _contentQuaternion() {
    const p = this.projection;
    return new Quaternion().setFromEuler(new Euler(p.turn.pitch, p.baseYaw + p.turn.yaw, 0, 'YXZ'));
  }

  /**
   * 레이어를 쓸 수 있으면 쓰고, 아니면 메시로 보여 준다.
   * 형식(구 각도·눈 배치)이 같으면 레이어를 다시 만들지 않고 자세·크기만 갱신한다.
   */
  _refreshRenderPath() {
    const p = this.projection;
    if (!p) return;
    const session = this._presenting() ? this.stage.renderer.xr.getSession?.() : null;
    const spec = this.video && this.renderPref === 'layers' && session && mediaLayersSupported(session) ? this._layerSpec() : null;
    if (!spec) {
      if (this.presenter?.active) this.presenter.detach();
      this.renderPath = 'mesh';
      p.root.visible = true;
      this._layerReason = this._layerReasonNow(session);
      return;
    }
    this._layerReason = '';
    this.presenter ??= new MediaLayerPresenter(this.stage);
    const before = this.presenter.spec;
    const sameShape = before && before.kind === spec.kind && before.layout === spec.layout && before.centralHorizontalAngle === spec.centralHorizontalAngle;
    if (this.presenter.active && sameShape) {
      this.presenter.update(spec, p.shell.position, this._contentQuaternion());
      this.renderPath = 'layers';
      p.root.visible = false;
      return;
    }
    const ok = this.presenter.attach(this.video, spec, p.shell.position, this._contentQuaternion());
    this.renderPath = ok ? 'layers' : 'mesh';
    p.root.visible = !ok;
    this._syncHud(true);
  }

  /** 레이어를 쓰지 않는 이유(진단 줄용) */
  _layerReasonNow(session) {
    if (!this._presenting()) return 'VR 세션이 아님(2D 미리보기)';
    if (!this.video) return '사진은 메시 경로';
    if (this.renderPref !== 'layers') return '선호가 메시';
    if (typeof globalThis.XRMediaBinding === 'undefined') return '이 브라우저에 XRMediaBinding 없음';
    if (!mediaLayersSupported(session)) return "세션에 'layers' 기능 없음";
    if (this.projection?.swapEyes) return '눈 바꿈 켬';
    if (!this.projection?.isScreen && this.projection?.sphereZoom > 1.001) return '확대 중(구는 메시로 그림)';
    return '';
  }

  _updateLayerPose() {
    if (!this.presenter?.active || !this.projection) return;
    const spec = this._layerSpec();
    if (spec) this.presenter.update(spec, this.projection.shell.position, this._contentQuaternion());
  }

  /** 영상 프레임 드롭·재생 품질을 5초마다 콘솔에 남긴다(실기기 끊김 측정용). */
  _samplePerf(now) {
    if (!this.video || !this._presenting() || now - this._perf.at < 5000) return;
    const q = this.video.getVideoPlaybackQuality?.();
    if (!q) return;
    const dropped = q.droppedVideoFrames - this._perf.lastDropped;
    const total = q.totalVideoFrames - this._perf.lastTotal;
    if (this._perf.at && total > 0) {
      console.info(`[media-perf] path=${this.renderPath} layout=${this.layout} ${this.resolution} 5초: 표시 ${total}프레임, 드롭 ${dropped}`);
    }
    this._perf = { lastDropped: q.droppedVideoFrames, lastTotal: q.totalVideoFrames, at: now };
    this.perf = { path: this.renderPath, dropped, total };
    this._logDiag(now);
  }

  /** 진단 값을 콘솔에 한 줄 JSON으로 남긴다(원격 디버깅 chrome://inspect에서 읽는다). */
  _logDiag(now) {
    if (now - this._diagLogAt < DIAG_LOG_MS) return;
    this._diagLogAt = now;
    try {
      console.info('[media-diag]', JSON.stringify(this.diagnostics()));
    } catch {
      // 진단이 재생을 막으면 안 된다.
    }
  }

  // ── 패널 안내 문구(잠깐 보였다 사라지는 한 줄) ─────────────────────────────

  _flashHint(text, ms = HINT_MS) {
    this.hud.setState({ hint: text });
    this._hintTimer = performance.now() + ms;
  }

  _expireHint(now) {
    if (this._hintTimer && now > this._hintTimer) {
      this._hintTimer = 0;
      this.hud.setState({ hint: '' });
    }
  }

  // ── 형식 자동 판별 보강: 프레임을 한 장 보고 좌우가 같은 그림이면 입체로 본다 ────────

  /** 영상은 첫 프레임이 나온 뒤, 사진은 바로 한 번 본다. 사람이 고른 형식은 건드리지 않는다. */
  async _sniffLater(token, width, height) {
    if (this._layoutFromUser || !this.detected || this.detected.confidence !== 'low' || !width || !height) return;
    const source = this.video ?? this.texture?.image;
    if (!source) return;
    try {
      if (this.video && this.video.readyState < 2) {
        await new Promise((resolve) => {
          const done = () => resolve();
          this.video.addEventListener('loadeddata', done, { once: true });
          setTimeout(done, 4000);
        });
      }
      if (token !== this._token || this._layoutFromUser) return;
      const ratio = width / height;
      const sw = 128;
      const sh = Math.max(16, Math.round(sw / ratio));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // 사진은 flipY로 뒤집혀 있어도 좌우·위아래 닮음 판단에는 상관없다.
      ctx.drawImage(source, 0, 0, sw, sh);
      const { data } = ctx.getImageData(0, 0, sw, sh);
      const luma = new Uint8Array(sw * sh);
      for (let i = 0; i < luma.length; i++) luma[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
      const refined = refineDetectionWithSniff(this.detected, sniffStereo(luma, sw, sh), ratio);
      if (refined !== this.detected && refined.layout !== this.layout) {
        this.detected = refined;
        this.setLayout(refined.layout, { auto: true });
        this._flashHint(`형식을 화면 내용으로 판단했어요: ${LAYOUTS[refined.layout].label}. 다르면 ◀ ▶로 바꾸세요.`, 8000);
      }
    } catch {
      // 다른 출처 영상이라 픽셀을 읽을 수 없으면 비율 추정 그대로 둔다.
    }
  }

  _worstLevel(warnings) {
    if (warnings.some((w) => w.level === 'error')) return 'error';
    if (warnings.some((w) => w.level === 'warn')) return 'warn';
    return 'info';
  }

  _createVideo(url) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    // 소리: 음소거로 시작하지 않는다(사용자가 HUD에서 끄기 전까지 켜짐). 자동 재생이 막히면 muted로 몰래 재생하지 않고 ▶로 시작하게 둔다.
    video.defaultMuted = false;
    video.muted = false;
    video.volume = 1;
    this._audioJudged = false;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.loop = false;
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    // 화면 밖에 붙여 둔다: 문서에 없는 <video>는 일부 브라우저에서 디코딩 우선순위가 낮고, XR 미디어 레이어가 DOM 요소를 기대할 수 있다.
    video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body?.appendChild(video);
    video.src = url;
    // 실제로 화면에 올라간 프레임 수(끊김 진단용)
    if (video.requestVideoFrameCallback) {
      const tick = () => {
        this._vfc.count++;
        if (video.isConnected && this.video === video) video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);
    }
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
    on('timeupdate', () => this._judgeAudio());
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
    this.hud.setState(buffering ? { warning: '버퍼링 중…', warningLevel: 'info' } : this._idleWarning());
    this.dispatchEvent(new CustomEvent('buffering', { detail: { buffering } }));
  }

  _videoErrorMessage(video) {
    return describeVideoError({
      code: video.error?.code,
      url: video.currentSrc || video.src,
      family: this.meta?.family,
      hint: this.decode ? summarizeWarnings(this.decode) : '',
    });
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
      pathLabel: this.renderPath === 'layers' ? '레이어' : '',
      stereo: !!info && info.stereo !== 'mono',
      canScale: !!this.projection,
      zoomLabel: this.projection ? zoomLabel(this.projection.isScreen ? 'screen' : 'sphere', this.projection.zoom) : '',
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
        this.zoomBy(1 / ZOOM_STEP);
        break;
      case 'sizeUp':
        this.zoomBy(ZOOM_STEP);
        break;
      case 'diag':
        this.toggleDiag();
        break;
      case 'recenter':
        this.recenter();
        break;
      case 'close':
        this.hideHud();
        break;
      default:
        // 이전·다음·슬라이드쇼·간격·목록(navPrev 등)은 라이브러리를 아는 앱이 처리한다.
        if (typeof id === 'string' && id.startsWith('nav')) this.dispatchEvent(new CustomEvent('nav', { detail: { id } }));
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
    // 이동 줄(이전·다음·슬라이드쇼)을 누르면 항목이 바로 바뀌어(unload) 이 프레임 나머지 입력 처리를 이어 갈 수 없다.
    if (!this.item || !this.projection) return;

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
    // 그립은 쓰지 않는다: 쥐다가 패널이 불려 오거나 옮겨지면 화면이 저절로 바뀐 것처럼 느껴진다(사람 피드백 2026-11-12).
    // L3(왼쪽 스틱 누르기): 지금 보는 방향 앞으로 화면을 다시 맞춘다. 사람이 원할 때만 자리가 바뀐다.
    if (input.left.stickPressed) {
      this.recenter();
      this._flashHint('화면을 지금 보는 방향으로 맞췄어요.', 2500);
      this._lastInteract = now;
    }
    // 왼쪽 스틱: 장면(360 구·스크린)을 돌린다. 방향 규칙은 PLY와 같이 core/stick-rules.js를 쓴다.
    const turnX = input.left.x ?? 0;
    const turnY = input.left.y ?? 0;
    if (turnX !== 0 || turnY !== 0) {
      const d = contentTurnDelta(turnX, turnY, TURN_SPEED, dt);
      this.projection.addTurn(d.yaw, d.pitch);
      if (this.renderPath === 'layers') this._updateLayerPose();
      this._lastInteract = now;
    }
    // 오른쪽 스틱은 한 번에 한 가지만: 좌우가 더 크면(|x|>|y|) 되감기·빨리감기, 아니면 상하 줌(위로 밀면 크게). 대각선이어도 둘이 같이 나가지 않는다.
    const { x: stickX, y: zoomY } = splitRightStick(input.right.x ?? 0, input.right.y ?? 0);
    if (zoomY !== 0) {
      this.zoomBy(Math.exp(-zoomY * ZOOM_RATE * dt), { persist: false });
      this._lastInteract = now;
    } else {
      this._flushZoom();
    }
    // 오른쪽 스틱 좌우: 10초 이동(영상)
    if (this.item.kind === 'video') {
      const x = stickX;
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
    if (this._eyeTest) this.toggleEyeTest();
    this.presenter?.detach();
    this.renderPath = 'mesh';
    // 화면 자리(_lastPlace)·패널 자리(_hudPlaced)·돌려 둔 방향은 파일이 바뀌어도 이어 간다(unload→load 사이에 화면이 옮겨지지 않게).
    if (this.projection) this._turnMemory = { yaw: this.projection.turn.yaw, pitch: this.projection.turn.pitch };
    this._flushZoom();
    this._layoutFromUser = false;
    this._hintTimer = 0;
    this.hud.setState({ hint: '', pathLabel: '' });
    for (const [type, fn] of this._videoHandlers) this.video?.removeEventListener(type, fn);
    this._videoHandlers = [];
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video.remove();
      this.video = null;
    }
    this._audioNote = null;
    this._audioJudged = false;
    this.diag.setVisible(false);
    this.hud.setState({ diagOn: false });
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

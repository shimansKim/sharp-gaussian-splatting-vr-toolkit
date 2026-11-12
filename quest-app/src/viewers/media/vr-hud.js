// VR 안 재생 컨트롤 패널. 캔버스 텍스처 평면에 버튼·탐색 막대를 그리고 컨트롤러 레이로 누른다.
// 기본 화면에는 자주 쓰는 버튼만 둔다(영상: 10초 뒤·재생·10초 앞·이전·다음 / 슬라이드쇼·줌−·줌+·목록·더 보기, 사진: 이전·다음·슬라이드쇼·목록 / 줌−·줌+·더 보기).
// 소리·반복·눈 바꿈·진단·형식·위치 맞춤·슬라이드쇼 간격은 [더 보기] 화면에 있다. 한 번에 한 화면만 보이고, 숨기면 기본 화면으로 돌아간다.
// 버튼 글씨는 core/label-fit.js로 크기·줄 수를 맞춰 잘리지 않게 그린다.
import { CanvasTexture, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, SRGBColorSpace, Vector3 } from 'three';
import { drawFitLabel } from '../../core/label-fit.js';
import { QuadLayerSurface } from '../../core/quad-layer.js';
import { DOCK_PANEL_SCALE, DOCK_TILT, dockCenter, dockRotation, dockTop } from '../../core/panel-layout.js';

const W = 1024;
/** 캔버스 높이: 제목·탐색 막대 / 위 버튼 줄 / 아래 버튼 줄 (더 보기 화면은 세 줄) */
export const HUD_CANVAS = { W, H: 476 };
const H = HUD_CANVAS.H;
export const HUD_WIDTH_M = 1.2;
export const HUD_HEIGHT_M = HUD_WIDTH_M * (H / W);

const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif';

const COLORS = {
  bg: 'rgba(18,22,30,0.92)',
  border: 'rgba(120,150,200,0.5)',
  button: 'rgba(52,64,88,1)',
  buttonHover: 'rgba(82,108,160,1)',
  buttonActive: 'rgba(110,150,230,1)',
  buttonOn: 'rgba(48,110,96,1)',
  text: '#e8edf7',
  dim: '#9aa8c4',
  warn: '#ffb454',
  error: '#ff6b6b',
  bar: 'rgba(70,84,110,1)',
  barFill: 'rgba(110,170,255,1)',
};

/** 초를 m:ss 또는 h:mm:ss로 */
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * 글자 단위로 줄을 나눈다(한글은 띄어쓰기 없이도 끊을 수 있다). 마지막 줄이 넘치면 …로 줄인다.
 * @param {(text: string) => number} measure
 * @returns {string[]}
 */
export function wrapText(measure, text, maxWidth, maxLines = 2) {
  const lines = [];
  let line = '';
  for (const ch of String(text)) {
    if (line && measure(line + ch) > maxWidth) {
      if (lines.length === maxLines - 1) {
        let cut = line;
        while (cut && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
        lines.push(`${cut}…`);
        return lines;
      }
      lines.push(line);
      line = ch === ' ' ? '' : ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 아이콘은 글꼴에 의존하지 않도록 경로로 그린다. */
const ICONS = {
  play(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.35, cy - s * 0.5);
    ctx.lineTo(cx + s * 0.55, cy);
    ctx.lineTo(cx - s * 0.35, cy + s * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  pause(ctx, cx, cy, s) {
    ctx.fillRect(cx - s * 0.4, cy - s * 0.5, s * 0.28, s);
    ctx.fillRect(cx + s * 0.12, cy - s * 0.5, s * 0.28, s);
  },
  back(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.1, cy - s * 0.4);
    ctx.lineTo(cx - s * 0.4, cy);
    ctx.lineTo(cx + s * 0.1, cy + s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.55, cy - s * 0.4);
    ctx.lineTo(cx + s * 0.05, cy);
    ctx.lineTo(cx + s * 0.55, cy + s * 0.4);
    ctx.closePath();
    ctx.fill();
  },
  fwd(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.1, cy - s * 0.4);
    ctx.lineTo(cx + s * 0.4, cy);
    ctx.lineTo(cx - s * 0.1, cy + s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.55, cy - s * 0.4);
    ctx.lineTo(cx - s * 0.05, cy);
    ctx.lineTo(cx - s * 0.55, cy + s * 0.4);
    ctx.closePath();
    ctx.fill();
  },
  left(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.25, cy - s * 0.45);
    ctx.lineTo(cx - s * 0.3, cy);
    ctx.lineTo(cx + s * 0.25, cy + s * 0.45);
    ctx.closePath();
    ctx.fill();
  },
  right(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.25, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.3, cy);
    ctx.lineTo(cx - s * 0.25, cy + s * 0.45);
    ctx.closePath();
    ctx.fill();
  },
};

/**
 * @typedef {{ id: string, x: number, y: number, w: number, h: number, label?: string, icon?: string, toggle?: boolean, on?: boolean, enabled: boolean }} HudButton
 */

export class VrHud {
  /**
   * @param {(id: string, value?: number) => void} onAction
   */
  constructor(onAction) {
    this.onAction = onAction;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    // 메시 폴백 경로: 줄여 그릴 때 글씨가 반짝이지 않게 밉맵(이방성은 attachSurface에서).
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(HUD_WIDTH_M, HUD_HEIGHT_M), this.material);
    this.mesh.name = 'media-hud';
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    /** 컴포지터 레이어 출력(attachSurface). 없으면 메시로 그린다. */
    this.surface = null;

    /** @type {any} */
    this.state = { kind: 'video', name: '', layoutLabel: '', resolution: '', playing: false, time: 0, duration: 0, muted: false, loop: false, warning: '', warningLevel: 'info', hint: '', pathLabel: '', diagOn: false, canScale: false, zoomLabel: '', swapEyes: false, stereo: false, navPos: '', navCanStep: false, navShow: false, navInterval: 5 };
    /** place()로 정한 도크 기준점. 공용 VR 패널이 같은 자리에 열리도록 내준다. */
    this._dock = null;
    this.buttons = [];
    /** 보이는 화면: 'main'(기본) | 'more'(더 보기) */
    this.page = 'main';
    this.seek = { x: 140, y: 118, w: 744, h: 22 };
    /** pointerId → { buttonId, down } */
    this.hover = new Map();
    this.pressed = new Map();
    this.dragSeek = null;
    this._lastSeekEmit = 0;
    this._dirty = true;
    this._raycaster = new Raycaster();
    this._tmp = new Vector3();
    this.layoutButtons();
    this.draw();
  }

  /**
   * 재생 컨트롤을 WebXR 컴포지터 레이어(XRQuadLayer)로 그리게 한다(core/quad-layer.js). 앱 프레임이 늦어도 HUD가 흔들리지 않는다.
   * 메시는 레이 히트 테스트용으로 두고, 레이어로 그리는 동안에만 보이지 않게 한다. 레이어를 못 쓰면 메시가 그대로 보인다.
   * @param {{ renderer: any, player?: any }} stage
   */
  attachSurface(stage) {
    this.texture.anisotropy = Math.min(8, stage.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
    this.surface = new QuadLayerSurface({ stage, canvas: this.canvas, mesh: this.mesh, widthM: HUD_WIDTH_M, heightM: HUD_HEIGHT_M, name: 'media-hud' });
  }

  get visible() {
    return this.mesh.visible;
  }

  setVisible(v) {
    this.mesh.visible = v;
    if (!v && this.surface) {
      // 숨기면 레이어도 바로 걷는다(이 뒤로 tick이 안 불려도 낡은 HUD가 남지 않게).
      this.surface.sync(false);
      this.material.visible = true;
    }
    if (v) this._dirty = true;
    // 숨기면 다음에 기본 화면으로 시작한다(더 보기 화면이 남아 있으면 무슨 화면인지 헷갈린다).
    else if (this.page !== 'main') {
      this.page = 'main';
      this.layoutButtons();
    }
  }

  /** 현재 상태를 받아 바뀐 부분이 있으면 다시 그리도록 표시한다. */
  setState(patch) {
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (this.state[key] !== value) {
        this.state[key] = value;
        changed = true;
      }
    }
    if (changed) {
      this._dirty = true;
      this.layoutButtons();
    }
  }

  layoutButtons() {
    const s = this.state;
    const video = s.kind === 'video';
    const b = [];
    const X0 = 24;
    const SPAN = 976; // 24 ~ 1000
    const GAP = 14;
    /** n개를 한 줄에 같은 폭으로 놓는다(widths를 주면 그 비율). */
    const row = (y, h, items, widths) => {
      const total = widths ? widths.reduce((a, v) => a + v, 0) : items.length;
      const unit = (SPAN - GAP * (items.length - 1)) / total;
      let x = X0;
      items.forEach((item, i) => {
        const w = unit * (widths ? widths[i] : 1);
        b.push({ x: Math.round(x), y, w: Math.round(w), h, enabled: true, ...item });
        x += w + GAP;
      });
    };
    const show = { id: 'navShow', label: s.navShow ? '슬라이드쇼\n■ 정지' : '슬라이드쇼\n▶ 시작', toggle: true, on: !!s.navShow, enabled: !!s.navCanStep || !!s.navShow };
    const prev = { id: 'navPrev', icon: 'left', label: '이전', enabled: !!s.navCanStep };
    const next = { id: 'navNext', icon: 'right', label: '다음', enabled: !!s.navCanStep };
    const list = { id: 'navList', label: '목록' };

    if (this.page === 'more') {
      // 더 보기: 자주 안 쓰는 설정. 위 줄(소리·반복·눈 바꿈·진단) / 형식 줄 / 간격·돌아가기
      const h = 88;
      const r1 = 166;
      const r2 = 264;
      const r3 = 362;
      const top = [];
      if (video) {
        top.push({ id: 'mute', label: s.muted ? '소리 꺼짐' : '소리 켜짐', toggle: true, on: !s.muted });
        top.push({ id: 'loop', label: s.loop ? '반복 켬' : '반복 끔', toggle: true, on: s.loop });
      }
      top.push({ id: 'swap', label: '좌우 눈 바꿈', toggle: true, on: s.swapEyes, enabled: !!s.stereo });
      top.push({ id: 'diag', label: s.diagOn ? '진단 켬' : '진단 끔', toggle: true, on: !!s.diagOn });
      row(r1, h, top);
      // 형식 전환: ◀ [현재 형식] ▶ · 위치 맞춤
      row(r2, h, [{ id: 'layoutPrev', icon: 'left' }, { id: 'layoutLabel', label: s.layoutShort || '형식', enabled: false, tag: true }, { id: 'layoutNext', icon: 'right' }, { id: 'recenter', label: '화면 위치 맞춤' }], [1, 3.6, 1, 2.4]);
      row(r3, h, [{ id: 'navInterval', label: `슬라이드쇼 간격 ${s.navInterval}초` }, { id: 'less', label: '◂ 돌아가기' }]);
    } else {
      const r1 = 166;
      const r2 = 314;
      const h1 = 132;
      const h2 = 140;
      if (video) {
        row(r1, h1, [
          { id: 'back10', icon: 'back', label: '10초' },
          { id: 'play', icon: s.playing ? 'pause' : 'play', big: true },
          { id: 'fwd10', icon: 'fwd', label: '10초' },
          prev,
          next,
        ]);
        row(r2, h2, [show, { id: 'sizeDown', label: '줌 −', enabled: !!s.canScale }, { id: 'sizeUp', label: '줌 +', enabled: !!s.canScale }, list, { id: 'more', label: '더 보기 ▸' }]);
      } else {
        row(r1, h1, [prev, next, show, list]);
        row(r2, h2, [{ id: 'sizeDown', label: '줌 −', enabled: !!s.canScale }, { id: 'sizeUp', label: '줌 +', enabled: !!s.canScale }, { id: 'more', label: '더 보기 ▸' }]);
      }
    }
    b.push({ id: 'close', x: 876, y: 14, w: 126, h: 56, label: '닫기', enabled: true, small: true });
    this.buttons = b;
    this._dirty = true;
  }

  /** 버튼을 눌렀을 때: 화면 전환([더 보기]·[돌아가기])은 여기서 처리하고, 나머지는 앱(뷰어)에 알린다. */
  _press(id) {
    if (id === 'more' || id === 'less') {
      this.page = id === 'more' ? 'more' : 'main';
      this.layoutButtons();
      return;
    }
    this.onAction(id);
  }

  /** 화면 좌표(캔버스 픽셀)에 있는 컨트롤을 찾는다. */
  hitTest(px, py) {
    if (this.state.kind === 'video') {
      const sk = this.seek;
      if (px >= sk.x - 10 && px <= sk.x + sk.w + 10 && py >= sk.y - 22 && py <= sk.y + sk.h + 22) return { type: 'seek', fraction: Math.min(1, Math.max(0, (px - sk.x) / sk.w)) };
    }
    for (const btn of this.buttons) {
      if (!btn.enabled) continue;
      if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) return { type: 'button', id: btn.id };
    }
    return null;
  }

  /** 레이가 패널에 닿는 지점. 닿지 않으면 null. */
  intersect(origin, direction) {
    if (!this.mesh.visible) return null;
    this.mesh.updateWorldMatrix(true, false);
    this._raycaster.set(origin, direction);
    this._raycaster.far = 6;
    const hit = this._raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return null;
    return { distance: hit.distance, px: hit.uv.x * W, py: (1 - hit.uv.y) * H };
  }

  /**
   * 포인터(컨트롤러 레이 또는 마우스)를 처리한다.
   * @param {Array<{ id: string|number, origin: Vector3, direction: Vector3, pressed: boolean }>} pointers
   * @returns {Map<string|number, { distance: number }|null>} 포인터별 패널 적중 정보
   */
  updatePointers(pointers, now) {
    const results = new Map();
    for (const p of pointers) {
      const hit = this.intersect(p.origin, p.direction);
      results.set(p.id, hit ? { distance: hit.distance } : null);
      const target = hit ? this.hitTest(hit.px, hit.py) : null;
      const key = target ? (target.type === 'seek' ? 'seek' : target.id) : null;
      const prevHover = this.hover.get(p.id) ?? null;
      if (prevHover !== key) {
        this.hover.set(p.id, key);
        this._dirty = true;
      }
      const wasPressed = this.pressed.get(p.id) ?? false;
      if (p.pressed && !wasPressed) {
        this.pressed.set(p.id, true);
        if (target?.type === 'seek') {
          this.dragSeek = p.id;
          this._emitSeek(target.fraction, now, true);
        } else if (target?.type === 'button') {
          this._press(target.id);
        }
        this._dirty = true;
      } else if (p.pressed && wasPressed && this.dragSeek === p.id && hit) {
        const sk = this.seek;
        const fraction = Math.min(1, Math.max(0, (hit.px - sk.x) / sk.w));
        this._emitSeek(fraction, now, false);
      } else if (!p.pressed && wasPressed) {
        this.pressed.set(p.id, false);
        if (this.dragSeek === p.id) {
          this.dragSeek = null;
          if (hit) {
            const sk = this.seek;
            this._emitSeek(Math.min(1, Math.max(0, (hit.px - sk.x) / sk.w)), now, true);
          }
        }
        this._dirty = true;
      }
    }
    return results;
  }

  _emitSeek(fraction, now, force) {
    if (!force && now - this._lastSeekEmit < 200) return;
    this._lastSeekEmit = now;
    this.onAction('seek', fraction);
  }

  /** 포인터가 패널 위에 있는가(트리거를 재생/일시정지로 쓰지 말아야 하는지 판단). */
  isOverPanel(results, id) {
    return !!results.get(id);
  }

  tick() {
    if (this._dirty && this.mesh.visible) {
      this.draw();
      // 캔버스를 다시 그렸으면 GPU 텍스처도 다시 올려야 한다. 이게 없으면 HUD가 처음 그린 모습으로 굳어
      // 형식 이름·재생 아이콘·시간이 바뀌지 않는다(실기기 피드백: "형식 버튼 글씨가 고정").
      this.texture.needsUpdate = true;
      this.surface?.invalidate();
      this._dirty = false;
    }
    // 레이어로 그렸으면 메시는 보이지 않게(히트 테스트는 그대로), 못 그렸으면 메시가 보인다.
    if (this.surface && this.mesh.visible) this.material.visible = !this.surface.sync(true);
  }

  draw() {
    const { ctx } = this;
    const s = this.state;
    ctx.clearRect(0, 0, W, H);
    roundRect(ctx, 2, 2, W - 4, H - 4, 28);
    ctx.fillStyle = COLORS.bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.border;
    ctx.stroke();

    // 제목 줄
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // 오른쪽 형식 정보의 실제 폭을 먼저 재서, 긴 파일 이름이 그 앞에서 말줄임(…)되게 한다(겹침 방지).
    const META_RIGHT = 860;
    ctx.font = `24px ${FONT}`;
    // 오른쪽 정보는 중요한 것부터(번호·줌·형식·해상도·경로). 안 들어가면 뒤쪽 항목부터 통째로 빼서 글자가 중간에 잘리지 않게 한다.
    const metaParts = [s.navPos, s.zoomLabel && '줌 ' + s.zoomLabel, s.layoutLabel, s.resolution, s.pathLabel].filter(Boolean);
    while (metaParts.length > 1 && ctx.measureText(metaParts.join(' · ')).width > 420) metaParts.pop();
    const meta = fitText(ctx, metaParts.join(' · '), 420);
    const metaWidth = meta ? ctx.measureText(meta).width : 0;
    const nameMax = Math.min(590, META_RIGHT - metaWidth - 24 - 28);
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(fitText(ctx, s.name || '(이름 없음)', nameMax), 28, 36);
    ctx.font = `24px ${FONT}`;
    ctx.fillStyle = COLORS.dim;
    ctx.textAlign = 'right';
    ctx.fillText(meta, META_RIGHT, 36);

    // 경고 줄
    if (s.warning) {
      ctx.textAlign = 'left';
      ctx.font = `20px ${FONT}`;
      ctx.fillStyle = s.warningLevel === 'error' ? COLORS.error : s.warningLevel === 'warn' ? COLORS.warn : COLORS.dim;
      // 긴 경고(코덱 한도 안내 등)는 두 줄로 보여 준다. 첫 줄은 오른쪽 위 닫기 버튼(x 876~)을 피한다.
      const lines = wrapText((t) => ctx.measureText(t).width, `⚠ ${s.warning}`, 836, 2);
      lines.forEach((text, i) => ctx.fillText(text, 28, 68 + i * 26));
    } else if (s.hint) {
      // 형식을 바꿨을 때 등 잠깐 보이는 안내(경고가 없을 때만)
      ctx.textAlign = 'left';
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = COLORS.barFill;
      const lines = wrapText((t) => ctx.measureText(t).width, s.hint, 836, 2);
      lines.forEach((text, i) => ctx.fillText(text, 28, 68 + i * 26));
    }

    // 탐색 막대
    if (s.kind === 'video') {
      const sk = this.seek;
      ctx.font = `24px ${FONT}`;
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'right';
      ctx.fillText(formatTime(s.time), sk.x - 14, sk.y + sk.h / 2);
      ctx.textAlign = 'left';
      ctx.fillText(formatTime(s.duration), sk.x + sk.w + 14, sk.y + sk.h / 2);
      roundRect(ctx, sk.x, sk.y, sk.w, sk.h, 11);
      ctx.fillStyle = COLORS.bar;
      ctx.fill();
      const frac = s.duration > 0 ? Math.min(1, Math.max(0, s.time / s.duration)) : 0;
      if (frac > 0) {
        roundRect(ctx, sk.x, sk.y, Math.max(22, sk.w * frac), sk.h, 11);
        ctx.fillStyle = COLORS.barFill;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(sk.x + sk.w * frac, sk.y + sk.h / 2, this.hover.size && [...this.hover.values()].includes('seek') ? 20 : 15, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }

    const hovered = new Set(this.hover.values());
    const down = new Set([...this.pressed.entries()].filter(([, v]) => v).map(([id]) => this.hover.get(id)));
    for (const btn of this.buttons) this.drawButton(btn, hovered.has(btn.id), down.has(btn.id));
  }

  drawButton(btn, hovered, down) {
    const { ctx } = this;
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 18);
    let fill = COLORS.button;
    if (btn.tag) fill = 'rgba(34,42,60,1)';
    else if (!btn.enabled) fill = 'rgba(38,44,58,0.7)';
    else if (down) fill = COLORS.buttonActive;
    else if (hovered) fill = COLORS.buttonHover;
    else if (btn.toggle && btn.on) fill = COLORS.buttonOn;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = btn.enabled || btn.tag ? COLORS.text : 'rgba(150,160,180,0.45)';
    const cx = btn.x + btn.w / 2;
    const cy = btn.y + btn.h / 2;
    const maxHeight = btn.h - 10;
    if (btn.icon && btn.label) {
      // 아이콘 + 글씨: 글씨는 아이콘 오른쪽 칸에 크기·줄 수를 맞춰 그린다
      ICONS[btn.icon](ctx, btn.x + 44, cy, btn.h > 100 ? 40 : 34);
      drawFitLabel(ctx, btn.label, btn.x + 44 + (btn.w - 44) / 2 + 8, cy, btn.w - 44 - 28, { family: FONT, sizes: [30, 28, 26, 24], maxLines: 2, maxHeight });
    } else if (btn.icon) {
      ICONS[btn.icon](ctx, cx, cy, btn.big ? 60 : 34);
    } else if (btn.label) {
      drawFitLabel(ctx, btn.label, cx, cy, btn.w - 24, {
        family: FONT,
        weight: btn.tag ? 600 : 500,
        sizes: btn.small ? [24, 22] : btn.label.length === 1 ? [44] : [30, 28, 26, 24, 22],
        maxLines: 2,
        maxHeight,
      });
    }
  }

  /**
   * 월드에 놓는다. head는 머리 위치, yaw는 바라보는 방향.
   * 영상·사진(3D 스크린은 가로 약 90°, 위아래 ±29°)과 겹치지 않게 core/panel-layout.js의 도크(윗변이 눈높이 아래 32.8°)에 두고 머리 쪽으로 기울인다.
   * 한 번 놓으면 다시 place()를 부르기 전에는 움직이지 않는다(컨트롤러로 누를 때 따라 움직이면 누를 수 없다).
   */
  place(head, yaw) {
    // 도크 기준점(윗변)에 윗변을 맞춰 매단다. 공용 VR 패널도 같은 기준점에 걸린다(dock()).
    const top = dockTop(head, yaw);
    this._dock = { top, yaw };
    this.mesh.position.copy(dockCenter(top, yaw, DOCK_TILT, HUD_HEIGHT_M));
    this.mesh.rotation.copy(dockRotation(yaw, DOCK_TILT));
  }

  /** 지금 놓인 도크 자리(아직 place한 적 없으면 null). 공용 VR 패널이 같은 자리에 열리도록 쓴다. */
  dock() {
    return this._dock ? { top: this._dock.top.clone(), yaw: this._dock.yaw, tilt: DOCK_TILT, scale: DOCK_PANEL_SCALE } : null;
  }

  dispose() {
    this.surface?.dispose();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

// VR 안 재생 컨트롤 패널. 캔버스 텍스처 평면에 버튼·탐색 막대를 그리고 컨트롤러 레이로 누른다.
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, SRGBColorSpace, Vector3 } from 'three';
import { DOCK_PANEL_SCALE, DOCK_TILT, dockCenter, dockRotation, dockTop } from '../../core/panel-layout.js';

const W = 1024;
/** 캔버스 높이: 제목·탐색 막대 / 재생 줄 / 형식 줄 / 이동 줄(이전·다음·슬라이드쇼·목록) */
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
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(HUD_WIDTH_M, HUD_HEIGHT_M), this.material);
    this.mesh.name = 'media-hud';
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;

    /** @type {any} */
    this.state = { kind: 'video', name: '', layoutLabel: '', resolution: '', playing: false, time: 0, duration: 0, muted: false, loop: false, warning: '', warningLevel: 'info', hint: '', pathLabel: '', canScale: false, swapEyes: false, stereo: false, navPos: '', navCanStep: false, navShow: false, navInterval: 5 };
    /** place()로 정한 도크 기준점. 공용 VR 패널이 같은 자리에 열리도록 내준다. */
    this._dock = null;
    this.buttons = [];
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

  get visible() {
    return this.mesh.visible;
  }

  setVisible(v) {
    this.mesh.visible = v;
    if (v) this._dirty = true;
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
      if ('kind' in patch || 'canScale' in patch || 'stereo' in patch || 'navPos' in patch || 'navCanStep' in patch || 'navShow' in patch || 'navInterval' in patch) this.layoutButtons();
    }
  }

  layoutButtons() {
    const s = this.state;
    const video = s.kind === 'video';
    const b = [];
    const row1 = 170;
    const row2 = 288;
    const h1 = 92;
    const h2 = 76;
    if (video) {
      b.push({ id: 'back10', x: 24, y: row1, w: 150, h: h1, icon: 'back', label: '10초', enabled: true });
      b.push({ id: 'play', x: 190, y: row1, w: 190, h: h1, icon: s.playing ? 'pause' : 'play', enabled: true, big: true });
      b.push({ id: 'fwd10', x: 396, y: row1, w: 150, h: h1, icon: 'fwd', label: '10초', enabled: true });
      b.push({ id: 'mute', x: 580, y: row1, w: 130, h: h1, label: s.muted ? '음소거' : '소리', toggle: true, on: !s.muted, enabled: true });
      b.push({ id: 'loop', x: 726, y: row1, w: 130, h: h1, label: '반복', toggle: true, on: s.loop, enabled: true });
    }
    // 형식 전환: ◀ [현재 형식] ▶
    const lx = video ? 24 : 24;
    b.push({ id: 'layoutPrev', x: lx, y: row2, w: 80, h: h2, icon: 'left', enabled: true });
    b.push({ id: 'layoutLabel', x: lx + 92, y: row2, w: 300, h: h2, label: s.layoutShort || '형식', enabled: false, tag: true });
    b.push({ id: 'layoutNext', x: lx + 404, y: row2, w: 80, h: h2, icon: 'right', enabled: true });
    b.push({ id: 'swap', x: 530, y: row2, w: 130, h: h2, label: '눈 바꿈', toggle: true, on: s.swapEyes, enabled: !!s.stereo });
    b.push({ id: 'sizeDown', x: 676, y: row2, w: 70, h: h2, label: '−', enabled: !!s.canScale });
    b.push({ id: 'sizeUp', x: 756, y: row2, w: 70, h: h2, label: '+', enabled: !!s.canScale });
    b.push({ id: 'recenter', x: 842, y: row2, w: 158, h: h2, label: '정면 맞춤', enabled: true });
    b.push({ id: 'close', x: 876, y: 14, w: 126, h: 56, label: '닫기', enabled: true, small: true });
    // 이동 줄: 공용 VR 패널과 같은 이전·다음·슬라이드쇼·간격·목록(실제 동작은 앱이 'nav' 이벤트로 처리한다)
    const row3 = 376;
    b.push({ id: 'navPrev', x: 24, y: row3, w: 140, h: h2, icon: 'left', label: '이전', enabled: !!s.navCanStep });
    b.push({ id: 'navPos', x: 176, y: row3, w: 130, h: h2, label: s.navPos || '–', enabled: false, tag: true });
    b.push({ id: 'navNext', x: 318, y: row3, w: 140, h: h2, icon: 'right', label: '다음', enabled: !!s.navCanStep });
    b.push({ id: 'navShow', x: 480, y: row3, w: 240, h: h2, label: s.navShow ? '■ 슬라이드쇼' : '▶ 슬라이드쇼', toggle: true, on: !!s.navShow, enabled: !!s.navCanStep || !!s.navShow });
    b.push({ id: 'navInterval', x: 732, y: row3, w: 130, h: h2, label: `${s.navInterval}초`, enabled: true });
    b.push({ id: 'navList', x: 874, y: row3, w: 130, h: h2, label: '목록', enabled: true });
    this.buttons = b;
    this._dirty = true;
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
          this.onAction(target.id);
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
      this._dirty = false;
    }
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
    const meta = fitText(ctx, [s.layoutLabel, s.resolution, s.pathLabel].filter(Boolean).join(' · '), 360);
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
    ctx.textAlign = 'center';
    const cx = btn.x + btn.w / 2;
    const cy = btn.y + btn.h / 2;
    if (btn.icon && btn.label) {
      ICONS[btn.icon](ctx, btn.x + 46, cy, 36);
      ctx.font = `26px ${FONT}`;
      ctx.fillText(btn.label, btn.x + btn.w / 2 + 28, cy);
    } else if (btn.icon) {
      ICONS[btn.icon](ctx, cx, cy, btn.big ? 52 : 34);
    } else if (btn.label) {
      ctx.font = `${btn.tag ? 600 : 500} ${btn.small ? 24 : btn.label.length === 1 ? 44 : 27}px ${FONT}`;
      ctx.fillText(fitText(ctx, btn.label, btn.w - 20), cx, cy + 1);
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
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

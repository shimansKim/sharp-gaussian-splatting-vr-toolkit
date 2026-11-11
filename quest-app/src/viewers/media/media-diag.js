// VR 안 '진단' 패널과 진단 값 정리. 실기기에서 입체·끊김 원인을 사람이 스크린샷이나 말로 알려 줄 수 있게 한다.
// (DOM·three에 의존하는 DiagPanel과, 순수 함수 diagLines/describeSource로 나눈다.)
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';

const W = 1024;
const H = 330;
export const DIAG_WIDTH_M = 1.2;

const FONT = 'ui-monospace,"D2Coding","Consolas","Noto Sans KR","Malgun Gothic",monospace';

/** 영상 주소를 '어떤 경로로 받는가'로 풀어 쓴다. 직접 URL이면 서버 주소를 그대로 보인다. */
export function describeSource(url, pageOrigin = '') {
  if (!url) return '-';
  if (/^blob:/.test(url)) return '기기 파일(blob)';
  if (/^data:/.test(url)) return 'data URL';
  try {
    const u = new URL(url, pageOrigin || undefined);
    if (u.pathname.includes('/__src/')) return `앱 프록시(서비스 워커) ${u.pathname.split('/__src/')[1]?.split('/')[0] ?? ''}`.trim();
    if (pageOrigin && u.origin === pageOrigin) return '같은 출처';
    return `직접 ${u.protocol}//${u.host}`;
  } catch {
    return String(url).slice(0, 40);
  }
}

const hex = (mask) => `0b${(mask >>> 0).toString(2).padStart(3, '0')}`;

/**
 * 진단 값을 패널에 쓸 줄들로 바꾼다.
 * @param {ReturnType<import('./media-viewer.js').MediaViewer['diagnostics']>} d
 * @returns {string[]}
 */
export function diagLines(d) {
  if (!d) return ['(열린 항목 없음)'];
  const lines = [];
  const layerState = d.layer.active
    ? '레이어 사용 중'
    : d.layer.error
      ? `레이어 실패: ${d.layer.error}`
      : d.layer.reason
        ? `레이어 안 씀: ${d.layer.reason}`
        : '레이어 안 씀';
  lines.push(`경로 ${d.path}(선호 ${d.pref}) · 형식 ${d.layout} · ${d.kind === 'image' ? '사진' : '영상'} ${d.resolution || '-'}`);
  lines.push(`레이어 ${layerState}`);
  lines.push(`세션 XRMediaBinding ${d.xr.mediaBinding ? '있음' : '없음'} · layers 기능 ${d.xr.layersFeature} · renderState.layers [${d.xr.stateLayers.join(', ') || '-'}]`);
  lines.push(`눈 카메라 ${d.xr.cameras}개 · 마스크 ${d.xr.masks.map(hex).join(' / ') || '-'} · 뷰포트 ${d.xr.viewports.join(' / ') || '-'}`);
  if (d.eye) {
    const r = d.eye.rate;
    lines.push(`눈 분리 ${d.eye.method} · 메시 그림/초 L ${r.left} R ${r.right}${r.cross ? ` 엇갈림 ${r.cross}` : ''}${r.mono ? ` 모노 ${r.mono}` : ''}`);
  }
  if (d.video) {
    const v = d.video;
    lines.push(`재생 ${v.presentedFps}fps(표시) / 원본 ${v.nominalFps || '?'}fps · 드롭 ${v.droppedInterval}/${v.totalInterval}(누적 ${v.dropped}/${v.total}) · 준비 ${v.readyState}`);
    lines.push(`버퍼 앞 ${v.bufferAhead}초 · 코덱 ${v.codec || '?'} ${v.bitrate ? `${v.bitrate}Mbps` : ''} · 소스 ${v.source}`);
  }
  lines.push(`렌더 평균 ${d.frame.avgMs}ms · 최대 ${d.frame.maxMs}ms · 25ms 넘은 프레임 ${d.frame.slow}/${d.frame.count}`);
  return lines;
}

/** HUD 위에 붙는 진단 패널(HUD 메시의 자식이라 HUD가 놓이는 대로 따라간다). */
export class DiagPanel {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.height = DIAG_WIDTH_M * (H / W);
    this.mesh = new Mesh(new PlaneGeometry(DIAG_WIDTH_M, this.height), this.material);
    this.mesh.name = 'media-diag';
    this.mesh.renderOrder = 102;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.lines = [];
  }

  /** HUD 메시 위쪽에 붙인다. hudHeight는 HUD 평면의 높이(m) */
  attachTo(hudMesh, hudHeight) {
    hudMesh.add(this.mesh);
    this.mesh.position.set(0, hudHeight / 2 + this.height / 2 + 0.02, 0.003);
  }

  get visible() {
    return this.mesh.visible;
  }

  setVisible(v) {
    this.mesh.visible = !!v;
  }

  setLines(lines) {
    const changed = lines.length !== this.lines.length || lines.some((l, i) => l !== this.lines[i]);
    if (!changed) return;
    this.lines = lines;
    this.draw();
  }

  draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,12,18,0.94)';
    ctx.strokeStyle = 'rgba(255,180,84,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect?.(2, 2, W - 4, H - 4, 22);
    if (!ctx.roundRect) ctx.rect(2, 2, W - 4, H - 4);
    ctx.fill();
    ctx.stroke();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `19px ${FONT}`;
    ctx.fillStyle = '#ffb454';
    ctx.fillText('진단 (스크린샷으로 알려 주세요)', 22, 12);
    ctx.fillStyle = '#e8edf7';
    const max = 11;
    this.lines.slice(0, max).forEach((line, i) => {
      let text = line;
      while (text.length > 2 && ctx.measureText(text).width > W - 44) text = `${text.slice(0, -2)}…`;
      ctx.fillText(text, 22, 42 + i * 26);
    });
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

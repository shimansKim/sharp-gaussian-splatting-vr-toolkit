// 형식·눈 순서·방향 검증용 테스트 패턴 이미지를 캔버스로 만든다(저장소에 큰 파일을 두지 않기 위함).
import { LAYOUTS, eyeRegion } from '../src/viewers/media/format-detect.js';

/** 형식별 기본 해상도 */
export const PATTERN_SIZES = {
  mono360: [4096, 2048],
  tb360: [2048, 2048],
  sbs360: [4096, 1024],
  sbs180: [4096, 2048],
  mono180: [2048, 2048],
  sbsScreenFull: [3840, 1080],
  sbsScreenHalf: [1920, 1080],
  tbScreen: [1920, 2160],
  mono2d: [1920, 1080],
};

/**
 * 한쪽 눈(또는 모노) 영역 하나를 그린다.
 * sphere: 'sphere360' | 'sphere180' | 'screen'. 눈 글자(L/R/M)로 눈 순서를, 각도 눈금으로 방향·늘어남을 본다.
 */
function drawEye(ctx, x, y, w, h, shape, label, hue) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = `hsl(${hue} 35% 22%)`;
  ctx.fillRect(x, y, w, h);

  const azSpan = shape === 'sphere360' ? 360 : shape === 'sphere180' ? 180 : 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = Math.max(2, h / 400);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (azSpan) {
    // 방위각 눈금: 가운데(u=0.5)가 정면 0°, 오른쪽이 +
    const step = shape === 'sphere360' ? 30 : 15;
    for (let az = -azSpan / 2; az <= azSpan / 2 + 0.01; az += step) {
      const px = x + ((az + azSpan / 2) / azSpan) * w;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + h);
      ctx.stroke();
      ctx.font = `${Math.round(h / 22)}px sans-serif`;
      ctx.fillText(`${az > 0 ? '+' : ''}${az}°`, px, y + h * 0.58);
    }
    for (let el = -60; el <= 60; el += 30) {
      const py = y + (0.5 - el / 180) * h;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + w, py);
      ctx.stroke();
      ctx.font = `${Math.round(h / 24)}px sans-serif`;
      ctx.fillText(`${el > 0 ? '+' : ''}${el}°`, x + w * 0.5 + h / 18, py - h / 40);
    }
    ctx.font = `bold ${Math.round(h / 6)}px sans-serif`;
    ctx.fillText('위 UP', x + w / 2, y + h * 0.1);
    ctx.fillText('아래 DOWN', x + w / 2, y + h * 0.9);
  } else {
    // 평면: 3x3 격자
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (i / 8) * w, y);
      ctx.lineTo(x + (i / 8) * w, y + h);
      ctx.stroke();
    }
    for (let j = 0; j <= 4; j++) {
      ctx.beginPath();
      ctx.moveTo(x, y + (j / 4) * h);
      ctx.lineTo(x + w, y + (j / 4) * h);
      ctx.stroke();
    }
  }

  // 중앙 십자
  ctx.strokeStyle = '#ffeb3b';
  ctx.lineWidth = Math.max(3, h / 200);
  ctx.beginPath();
  ctx.moveTo(x + w / 2 - h / 14, y + h / 2);
  ctx.lineTo(x + w / 2 + h / 14, y + h / 2);
  ctx.moveTo(x + w / 2, y + h / 2 - h / 14);
  ctx.lineTo(x + w / 2, y + h / 2 + h / 14);
  ctx.stroke();

  // 눈 글자
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(h / 3.2)}px sans-serif`;
  ctx.fillText(label, x + w / 2, y + h * 0.33);

  // 모서리 표식(왼쪽 위 빨강, 오른쪽 위 초록): 좌우가 뒤집혔는지 확인
  const s = h / 12;
  ctx.fillStyle = '#ff4d4d';
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = '#4dff7a';
  ctx.fillRect(x + w - s, y, s, s);
  ctx.restore();
}

/**
 * @param {import('../src/viewers/media/format-detect.js').MediaLayout} layout
 * @returns {HTMLCanvasElement}
 */
export function makePatternCanvas(layout) {
  const [w, h] = PATTERN_SIZES[layout] ?? [2048, 1024];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const info = LAYOUTS[layout];
  const eyes = info.stereo === 'mono' ? [['M', 200, null]] : [['L', 10, 'left'], ['R', 215, 'right']];
  for (const [label, hue, eye] of eyes) {
    const r = eyeRegion(layout, eye ?? 'left');
    const x = r.u0 * w;
    const width = (r.u1 - r.u0) * w;
    // v는 아래가 0이므로 캔버스 y로 바꾼다.
    const y = (1 - r.v1) * h;
    const height = (r.v1 - r.v0) * h;
    drawEye(ctx, x, y, width, height, info.shape, label, hue);
  }
  return canvas;
}

export function canvasToFile(canvas, name) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('PNG 변환 실패'))),
      'image/png',
    );
  });
}

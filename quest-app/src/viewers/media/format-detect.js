// 영상·사진의 VR 형식을 파일 이름, 해상도 비율, MP4 메타데이터로 판별한다.
// DOM·three에 의존하지 않는 순수 함수라서 node --test로 검증한다.

/** @typedef {'mono2d'|'mono360'|'tb360'|'sbs360'|'sbs180'|'mono180'|'sbsScreenFull'|'sbsScreenHalf'|'tbScreen'} MediaLayout */

/**
 * 형식별 속성. projections.js가 이 표를 보고 메시를 만든다.
 * - shape: 'sphere360' | 'sphere180' | 'screen' (flat은 screen에 stereo 'mono'로 표현)
 * - stereo: 'mono' | 'sbs' | 'tb'
 * @type {Record<MediaLayout, {label: string, short: string, shape: 'sphere360'|'sphere180'|'screen', stereo: 'mono'|'sbs'|'tb'}>}
 */
export const LAYOUTS = {
  mono2d: { label: '2D 일반 화면', short: '2D', shape: 'screen', stereo: 'mono' },
  mono360: { label: '360° 모노', short: '360', shape: 'sphere360', stereo: 'mono' },
  tb360: { label: '360° 3D 위아래(TB)', short: '360 TB', shape: 'sphere360', stereo: 'tb' },
  sbs360: { label: '360° 3D 좌우(SBS)', short: '360 SBS', shape: 'sphere360', stereo: 'sbs' },
  sbs180: { label: 'VR180 3D 좌우(SBS)', short: 'VR180', shape: 'sphere180', stereo: 'sbs' },
  mono180: { label: 'VR180 모노', short: '180', shape: 'sphere180', stereo: 'mono' },
  sbsScreenFull: { label: '3D 스크린 Full SBS', short: 'SBS 스크린', shape: 'screen', stereo: 'sbs' },
  sbsScreenHalf: { label: '3D 스크린 Half SBS', short: 'HSBS 스크린', shape: 'screen', stereo: 'sbs' },
  tbScreen: { label: '3D 스크린 위아래(TB)', short: 'TB 스크린', shape: 'screen', stereo: 'tb' },
};

/** VR 패널에서 형식을 순서대로 넘길 때 쓰는 순서 */
export const LAYOUT_ORDER = [
  'sbs180',
  'mono180',
  'mono360',
  'tb360',
  'sbs360',
  'sbsScreenFull',
  'sbsScreenHalf',
  'tbScreen',
  'mono2d',
];

export function isLayout(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LAYOUTS, value);
}

/** 경로가 섞여 들어와도 파일 이름만 보고, 확장자를 떼고 소문자 토큰으로 나눈다. */
export function nameTokens(name) {
  const file = String(name || '').split(/[\\/]/).pop();
  const base = file.replace(/\.[^.]+$/, '').toLowerCase();
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
  return { base, tokens };
}

/**
 * 파일 이름에서 투영·스테레오 힌트를 뽑는다.
 * @returns {{ projection: '360'|'180'|null, stereo: 'sbs'|'tb'|'mono'|null, half: boolean, full: boolean, hints: string[] }}
 */
export function parseNameHints(name) {
  const { base, tokens } = nameTokens(name);
  const has = (...keys) => keys.some((k) => tokens.includes(k));
  const hints = [];
  let projection = null;
  let stereo = null;
  let half = false;
  let full = false;

  if (has('360', 'vr360', 'equirect', 'equirectangular', 'spherical') || /vr360|360vr/.test(base)) {
    projection = '360';
    hints.push('이름에 360');
  }
  if (has('180', 'vr180', 'fisheye180') || /vr180/.test(base)) {
    projection = '180';
    hints.push('이름에 180');
  }

  if (has('hsbs', 'halfsbs', 'half-sbs') || /half[-_ ]?sbs/.test(base)) {
    stereo = 'sbs';
    half = true;
    hints.push('이름에 HSBS');
  } else if (has('fsbs', 'fullsbs') || /full[-_ ]?sbs/.test(base)) {
    stereo = 'sbs';
    full = true;
    hints.push('이름에 FSBS');
  } else if (has('sbs', 'lr', '3dh', 'leftright', 'sidebyside') || /side[-_ ]?by[-_ ]?side/.test(base)) {
    stereo = 'sbs';
    hints.push('이름에 SBS/LR');
  } else if (has('tb', 'ou', 'htb', 'ftb', '3dv', 'topbottom', 'overunder') || /over[-_ ]?under|top[-_ ]?bottom/.test(base)) {
    stereo = 'tb';
    hints.push('이름에 TB/OU');
  } else if (has('mono', '2d')) {
    stereo = 'mono';
    hints.push('이름에 mono');
  }
  if (!stereo && has('3d')) hints.push('이름에 3D(좌우/위아래 불명)');

  return { projection, stereo, half, full, hints };
}

/**
 * MP4 st3d/sv3d 메타데이터(mp4-meta.js의 결과)를 형식으로 바꾼다.
 * @param {{ stereoMode?: 'mono'|'top-bottom'|'left-right'|null, projection?: 'equirect'|'cubemap'|'mesh'|'rect'|null, equirectBounds?: {top:number,bottom:number,left:number,right:number}|null }|null|undefined} spatial
 * @returns {{ projection: '360'|'180'|null, stereo: 'sbs'|'tb'|'mono'|null }|null}
 */
export function hintsFromSpatialMeta(spatial) {
  if (!spatial) return null;
  let stereo = null;
  if (spatial.stereoMode === 'left-right') stereo = 'sbs';
  else if (spatial.stereoMode === 'top-bottom') stereo = 'tb';
  else if (spatial.stereoMode === 'mono') stereo = 'mono';

  let projection = null;
  if (spatial.projection === 'equirect') {
    const b = spatial.equirectBounds;
    // 투영 경계(0~1) 값: left+right가 0.5 근처면 가로 180°만 담긴 VR180.
    if (b && b.left + b.right >= 0.45) projection = '180';
    else projection = '360';
  }
  if (!projection && !stereo) return null;
  return { projection, stereo };
}

function stereoFromRatio360(ratio) {
  if (ratio >= 3.2) return 'sbs';
  if (ratio <= 1.25) return 'tb';
  return 'mono';
}

/**
 * 파일 이름·해상도·메타데이터로 형식을 판별한다.
 * 우선순위: MP4 공간 메타데이터 > 이름 힌트 > 화면 비율.
 *
 * @param {{ name?: string, width?: number, height?: number, spatial?: object|null }} input
 * @returns {{ layout: MediaLayout, confidence: 'high'|'medium'|'low', reasons: string[] }}
 */
export function detectLayout({ name = '', width = 0, height = 0, spatial = null } = {}) {
  const ratio = width > 0 && height > 0 ? width / height : 0;
  const nameHints = parseNameHints(name);
  const meta = hintsFromSpatialMeta(spatial);
  const reasons = [];

  let projection = nameHints.projection;
  let stereo = nameHints.stereo;
  let fromMeta = false;
  if (meta) {
    if (meta.projection) projection = meta.projection;
    if (meta.stereo) stereo = meta.stereo;
    fromMeta = true;
    reasons.push('MP4 공간 메타데이터(st3d/sv3d)');
  }
  reasons.push(...nameHints.hints.filter(() => !fromMeta || !meta));

  const done = (layout, confidence, extra) => {
    if (extra) reasons.push(extra);
    return { layout, confidence, reasons };
  };

  if (projection === '360') {
    const st = stereo === 'mono' ? 'mono' : stereo ?? (ratio ? stereoFromRatio360(ratio) : 'mono');
    const layout = st === 'sbs' ? 'sbs360' : st === 'tb' ? 'tb360' : 'mono360';
    const strong = fromMeta || stereo !== null || !ratio;
    return done(layout, fromMeta ? 'high' : strong ? 'high' : 'medium', stereo === null && ratio ? `비율 ${ratio.toFixed(2)}:1로 입체 방식 추정` : null);
  }

  if (projection === '180') {
    let st = stereo;
    if (!st || st === 'tb') {
      // 형식 목록에 TB 180이 없다. 비율로 좌우 입체 여부를 고른다.
      st = ratio && ratio >= 1.6 ? 'sbs' : ratio && ratio <= 1.25 ? 'mono' : st === 'tb' ? 'mono' : 'sbs';
    }
    return done(st === 'mono' ? 'mono180' : 'sbs180', fromMeta ? 'high' : 'high');
  }

  // 투영 힌트가 없으면 스테레오 힌트와 비율로 판단한다.
  if (stereo === 'sbs') {
    if (nameHints.half) return done('sbsScreenHalf', 'high');
    if (nameHints.full) return done('sbsScreenFull', 'high');
    if (ratio >= 1.9 && ratio <= 2.15) return done('sbs180', 'medium', `SBS 이름 + 비율 ${ratio.toFixed(2)}:1 → VR180으로 추정`);
    if (ratio >= 2.6) return done('sbsScreenFull', 'medium', `SBS 이름 + 비율 ${ratio.toFixed(2)}:1 → Full SBS`);
    return done('sbsScreenHalf', 'medium', ratio ? `SBS 이름 + 비율 ${ratio.toFixed(2)}:1 → Half SBS` : null);
  }
  if (stereo === 'tb') {
    if (ratio >= 0.95 && ratio <= 1.1) return done('tb360', 'medium', '비율 1:1 → 360 TB로 추정');
    return done('tbScreen', 'medium');
  }
  if (stereo === 'mono') {
    if (ratio >= 1.9 && ratio <= 2.15) return done('mono360', 'medium', '비율 2:1 → 360으로 추정');
    return done('mono2d', 'medium');
  }

  // 이름 단서가 전혀 없을 때
  if (!ratio) return done('mono2d', 'low', '해상도 정보 없음');
  if (nameHints.hints.length === 0 && /3d/.test(String(name).toLowerCase())) reasons.push('이름에 3D');
  if (ratio >= 3.8 && ratio <= 4.2) return done('sbs360', 'low', `비율 ${ratio.toFixed(2)}:1 → 360 SBS로 추정`);
  if (ratio >= 2.6) return done('sbsScreenFull', 'low', `비율 ${ratio.toFixed(2)}:1 → Full SBS 스크린으로 추정`);
  if (ratio >= 1.9 && ratio <= 2.15) return done('mono360', 'low', `비율 2:1 → 360 모노로 추정(VR180이면 형식을 바꾸세요)`);
  if (ratio >= 0.95 && ratio <= 1.05) return done('tb360', 'low', '비율 1:1 → 360 TB로 추정');
  return done('mono2d', 'low', `일반 비율 ${ratio.toFixed(2)}:1`);
}

/**
 * 가상 스크린/평면에서 한쪽 눈 화면의 가로세로 비율.
 * Full SBS는 (w/2):h, Half SBS와 2D는 w:h, TB는 Full이면 w:(h/2), Half이면 w:h로 본다.
 */
export function eyeAspect(layout, width, height) {
  const w = width || 16;
  const h = height || 9;
  switch (layout) {
    case 'sbsScreenFull':
      return w / 2 / h;
    case 'tbScreen':
      // 세로가 가로보다 길면(예: 1920x2160) Full TB, 아니면 Half TB로 본다.
      return w / h < 1.2 ? w / (h / 2) : w / h;
    default:
      return w / h;
  }
}

/** 눈 하나가 차지하는 영역(텍스처 UV 사각형). v는 아래가 0이다. */
export function eyeRegion(layout, eye) {
  const stereo = LAYOUTS[layout]?.stereo ?? 'mono';
  if (stereo === 'sbs') return eye === 'left' ? { u0: 0, u1: 0.5, v0: 0, v1: 1 } : { u0: 0.5, u1: 1, v0: 0, v1: 1 };
  if (stereo === 'tb') return eye === 'left' ? { u0: 0, u1: 1, v0: 0.5, v1: 1 } : { u0: 0, u1: 1, v0: 0, v1: 0.5 };
  return { u0: 0, u1: 1, v0: 0, v1: 1 };
}

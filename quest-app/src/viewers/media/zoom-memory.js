// 영상·사진 줌 값(스크린 크기 배율, 360/180 시야각 확대)을 기기(localStorage)에 기억한다.
// 파일을 넘기거나 앱을 다시 켜도 사람이 맞춰 둔 크기가 그대로 유지되게 한다.
import { DEFAULT_SCREEN_SCALE, DEFAULT_SPHERE_ZOOM, MAX_SCREEN_SCALE, MAX_SPHERE_ZOOM, MIN_SCREEN_SCALE } from './projections.js';

const KEY = 'sharp.media.zoom.v1';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const valid = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);

/** 기억해 둔 줌. 없거나 깨졌으면 기본값(스크린은 작게 시작, 구는 확대 없음). */
export function loadZoom() {
  try {
    const parsed = JSON.parse(storage()?.getItem(KEY) ?? 'null') ?? {};
    return {
      screen: valid(parsed.screen, MIN_SCREEN_SCALE, MAX_SCREEN_SCALE, DEFAULT_SCREEN_SCALE),
      sphere: valid(parsed.sphere, 1, MAX_SPHERE_ZOOM, DEFAULT_SPHERE_ZOOM),
    };
  } catch {
    return { screen: DEFAULT_SCREEN_SCALE, sphere: DEFAULT_SPHERE_ZOOM };
  }
}

/** 줌을 기억한다. 저장이 막혀도 이번 실행 동안은 뷰어가 값을 들고 있다. */
export function saveZoom(zoom) {
  try {
    storage()?.setItem(KEY, JSON.stringify({ screen: zoom.screen, sphere: zoom.sphere }));
  } catch {
    // 무시
  }
}

/** 퍼센트로 보여 줄 때의 글자(스크린은 기본 크기가 100%, 구는 원래 크기가 100%) */
export function zoomLabel(shape, value) {
  const base = shape === 'screen' ? DEFAULT_SCREEN_SCALE : 1;
  return `${Math.round((value / base) * 100)}%`;
}

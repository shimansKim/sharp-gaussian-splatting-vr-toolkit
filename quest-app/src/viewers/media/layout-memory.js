// 사람이 파일별로 고른 영상·사진 형식을 기기(localStorage)에 기억해 다음에 열 때 그대로 쓴다.
// 보관함 항목은 라이브러리가 따로 기억하고, PC·드라이브·기기 파일 같은 나머지 출처는 여기서 기억한다.
import { isLayout } from './format-detect.js';

const KEY = 'sharp.media.layoutByItem.v1';
const MAX_ENTRIES = 500;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readAll() {
  try {
    const raw = storage()?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && isLayout(e[1])) : [];
  } catch {
    return [];
  }
}

/** 항목 id에 기억해 둔 형식. 없으면 null */
export function recallLayout(itemId) {
  if (typeof itemId !== 'string' || !itemId) return null;
  const hit = readAll().find((e) => e[0] === itemId);
  return hit ? hit[1] : null;
}

/** 항목 id의 형식을 기억한다(가장 최근 500개까지). */
export function rememberLayout(itemId, layout) {
  if (typeof itemId !== 'string' || !itemId || !isLayout(layout)) return;
  try {
    const entries = readAll().filter((e) => e[0] !== itemId);
    entries.push([itemId, layout]);
    storage()?.setItem(KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // 저장이 막혀도 이번 실행 동안은 viewer가 item.layout으로 유지한다.
  }
}

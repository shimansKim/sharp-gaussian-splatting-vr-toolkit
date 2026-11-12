// PLY 뷰어 옵션(VR 패널의 [PLY 옵션]에서 바꾼다). 순수 함수 + 저장 도우미라 node에서 테스트한다.
//
// "주변부가 날아가 보이는" 원인(Spark 2.0 소스 확인):
//  - maxPixelRadius: 화면에서 이 반지름(px)보다 큰 splat은 *잘려서 작아진다*(min() 클램프). Quest safe 프리셋은 64~220(기본 5단계 약 133)이라
//    SHARP 출력의 가장자리·가까운 큰 splat이 줄어들어 구멍이 난다(Spark 기본 512).
//  - clipXY(기본 1.4): splat 중심이 화면(NDC)의 1.4배 밖이면 통째로 버린다. 큰 splat은 중심이 화면 밖이어도 안쪽을 덮으므로 가장자리에서 사라진다.
//  - maxStdDev: safe 5단계는 √4.3≈2.07σ로 가우시안 끝자락을 잘라 윤곽이 줄어든다(Spark 기본 √8≈2.83σ).
//  - minAlpha: 투명한 가장자리를 버린다(safe 낮은 단계일수록 큼).
//  - 라이트·초저부하(LOD) 프리셋은 시야 원뿔 밖 splat 밀도를 coneFoveate/behindFoveate 만큼 줄여 주변부가 성겨진다.
// "전체 보기"는 이 값들을 Spark 기본 이상으로 올린다(성능 비용이 있다).

import { getSplatPreset } from "./quest-presets.js";

export const STORAGE_KEY = "sharp-quest.ply-options";

/** 화질 단계: 2D 설정의 안전 단계와 같은 값. */
export const QUALITY_LEVELS = [1, 3, 5, 7, 10];
export const POINT_SIZES = [0.7, 0.85, 1, 1.2, 1.5];
/**
 * 정렬 갱신 간격(ms). null = 프리셋 값(safe는 0 = 시점이 바뀔 때마다). Spark는 머리를 움직이는 동안 정렬(GPU 읽기+정렬)을 이 간격마다 돌린다.
 * 머리를 움직일 때 장면이 떨리면 늦춰 본다(대신 빠르게 움직일 때 splat 겹침 순서가 잠깐 어긋날 수 있다).
 */
export const SORT_INTERVALS = [null, 50, 120];

/** 전체 보기가 덮어쓰는 최소 기준(프리셋이 더 넉넉하면 그 값을 쓴다). */
export const FULL_VIEW = {
  maxPixelRadius: 512,
  clipXY: 4,
  maxStdDev: Math.sqrt(8),
  minAlpha: 1 / 255,
  coneFoveate: 1,
  behindFoveate: 1,
};

export const DEFAULT_OPTIONS = Object.freeze({
  keepPose: true,
  fullView: false,
  pointSize: 1,
  prefetch: true,
  sortMs: null,
});

export function normalizeOptions(raw) {
  const o = { ...DEFAULT_OPTIONS };
  if (raw && typeof raw === "object") {
    if (typeof raw.keepPose === "boolean") o.keepPose = raw.keepPose;
    if (typeof raw.fullView === "boolean") o.fullView = raw.fullView;
    if (typeof raw.prefetch === "boolean") o.prefetch = raw.prefetch;
    if (POINT_SIZES.includes(raw.pointSize)) o.pointSize = raw.pointSize;
    if (SORT_INTERVALS.includes(raw.sortMs)) o.sortMs = raw.sortMs;
  }
  return o;
}

/** @param {Storage | null} [storage] */
export function loadOptions(storage = safeStorage()) {
  try {
    return normalizeOptions(JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeOptions(null);
  }
}

/** @param {Storage | null} [storage] */
export function saveOptions(options, storage = safeStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    /* 저장이 막힌 환경이면 이번 실행에만 적용 */
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 한 칸 뒤 값(끝에서 처음으로). 목록에 없으면 가장 가까운 칸 다음. */
export function cycle(values, current, step = 1) {
  let index = values.indexOf(current);
  if (index < 0) {
    index = values.reduce((best, v, i) => (Math.abs(v - current) < Math.abs(values[best] - current) ? i : best), 0);
    return values[index];
  }
  return values[(index + step + values.length) % values.length];
}

/**
 * 화질 단계(safe 1~10)에 해당하는 Spark 설정. 목록 값은 {@link QUALITY_LEVELS}.
 * @param {number} level
 */
export function sparkForLevel(level) {
  return getSplatPreset({ mode: "safe", level }).spark;
}

/**
 * SparkRenderer에 덮어쓸 값. 기본 프리셋 값 위에 전체 보기·점 크기를 얹는다.
 * @param {Record<string, any>} base 프리셋의 spark 설정
 * @param {{ fullView: boolean, pointSize: number }} options
 */
export function sparkSettings(base, { fullView, pointSize, sortMs = null }) {
  const out = { ...base };
  if (sortMs) out.minSortIntervalMs = Math.max(base.minSortIntervalMs ?? 0, sortMs);
  if (fullView) {
    out.maxPixelRadius = Math.max(base.maxPixelRadius ?? 0, FULL_VIEW.maxPixelRadius);
    out.clipXY = Math.max(base.clipXY ?? 1.4, FULL_VIEW.clipXY);
    out.maxStdDev = Math.max(base.maxStdDev ?? 0, FULL_VIEW.maxStdDev);
    out.minAlpha = Math.min(base.minAlpha ?? 1, FULL_VIEW.minAlpha);
    out.coneFoveate = FULL_VIEW.coneFoveate;
    out.behindFoveate = FULL_VIEW.behindFoveate;
  } else {
    out.clipXY = base.clipXY ?? 1.4;
  }
  // 점 크기: 화면 투영 크기 배율(focalAdjustment). 1이 프리셋 값.
  out.focalAdjustment = (base.focalAdjustment ?? 1) * pointSize;
  return out;
}

export const formatSortInterval = (value) => (value ? `${value}ms` : "기본");

export const formatPointSize = (value) => `×${value.toFixed(2).replace(/\.?0+$/, "")}`;

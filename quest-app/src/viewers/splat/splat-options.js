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
 * 정렬 갱신 간격. Spark는 머리를 움직이는 동안 정렬(GPU 읽기+정렬)을 이 간격(ms)마다 돌린다.
 * - "auto"(기본): VR에서는 {@link VR_SORT_MS}에서 시작하고, 프레임이 예산을 못 지키면 정렬 갱신을 늦추고 그래도 모자라면 화질을 한 칸씩 낮춘다(adaptive-quality.js). 2D에서는 프리셋 값.
 * - 120: 더 늦춤(빠르게 움직일 때 splat 겹침 순서가 잠깐 어긋날 수 있다).
 * - "preset": 이전 동작(프리셋 값 그대로).
 */
export const SORT_CHOICES = ["auto", 120, "preset"];
export const VR_SORT_MS = 50;

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
  sortMs: "auto",
});

export function normalizeOptions(raw) {
  const o = { ...DEFAULT_OPTIONS };
  if (raw && typeof raw === "object") {
    if (typeof raw.keepPose === "boolean") o.keepPose = raw.keepPose;
    if (typeof raw.fullView === "boolean") o.fullView = raw.fullView;
    if (typeof raw.prefetch === "boolean") o.prefetch = raw.prefetch;
    if (POINT_SIZES.includes(raw.pointSize)) o.pointSize = raw.pointSize;
    if (SORT_CHOICES.includes(raw.sortMs)) o.sortMs = raw.sortMs;
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

/** 정렬 갱신 선택과 VR 여부에서 실제로 덮어쓸 간격(ms). 덮어쓰지 않으면 null(프리셋 값). */
export function sortOverride(sortMs, vr, autoMs = VR_SORT_MS) {
  if (sortMs === "preset") return null;
  if (sortMs === "auto") return vr ? autoMs : null;
  return typeof sortMs === "number" ? sortMs : null;
}

/**
 * SparkRenderer에 덮어쓸 값. 기본 프리셋 값 위에 전체 보기·점 크기·정렬 갱신을 얹는다.
 * @param {Record<string, any>} base 프리셋의 spark 설정
 * @param {{ fullView: boolean, pointSize: number, sortMs?: "auto" | "preset" | number }} options
 * @param {{ vr?: boolean, autoSortMs?: number }} [context] vr: 지금 VR 세션 안인지, autoSortMs: "auto"일 때 VR 정렬 갱신(자동 조절 결과)
 */
export function sparkSettings(base, { fullView, pointSize, sortMs = "auto" }, { vr = false, autoSortMs = VR_SORT_MS } = {}) {
  const out = { ...base };
  const sort = sortOverride(sortMs, vr, autoSortMs);
  if (sort) out.minSortIntervalMs = Math.max(base.minSortIntervalMs ?? 0, sort);
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

/**
 * 패널의 '화질' 줄 표시. 자동 조절로 낮아졌으면 "(자동 N)"을 붙인다.
 * @param {string} baseText 사람이 고른 화질 문구(예: "안전 5/10", "라이트")
 * @param {number | null} adaptedLevel 자동 조절로 낮춘 화질 단계(없으면 null)
 */
export const formatQualitySide = (baseText, adaptedLevel) => (adaptedLevel === null ? baseText : `${baseText} (자동 ${adaptedLevel})`);

/**
 * 패널 표시. "auto"는 자동 조절로 바뀐 값이 있으면 함께 보여 준다.
 * @param {"auto" | "preset" | number} value
 * @param {{ sortMs: number | null, level: number | null } | null} [adapted] 지금 자동 조절 결과(없으면 null)
 */
export function formatSortInterval(value, adapted = null) {
  if (value === "preset") return "이전 값";
  if (value !== "auto") return `${value}ms`;
  if (!adapted || (adapted.sortMs === null && adapted.level === null)) return `자동 (VR ${VR_SORT_MS}ms~)`;
  return `자동 (지금 ${adapted.sortMs ?? VR_SORT_MS}ms${adapted.level !== null ? ` · 화질 ${adapted.level}` : ""})`;
}

export const formatPointSize = (value) => `×${value.toFixed(2).replace(/\.?0+$/, "")}`;

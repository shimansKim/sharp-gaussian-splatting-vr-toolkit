// Quest 품질 프리셋. webxr-spark-demo/src/main.js의 ?safe / ?lite / ?quest / ?quality 값을 순수 함수로 옮겼다.
// 값은 기존 데모와 같다(Quest 3 점 깜빡임 진단으로 맞춘 값이므로 임의로 바꾸지 않는다).

/** @typedef {'safe'|'lite'|'quest'|'quality'} PresetMode */

const lerp = (min, max, t) => min + (max - min) * t;

export const QUEST_UA = /Quest|OculusBrowser|Meta Quest/i;

/**
 * @param {{ mode?: PresetMode, level?: number }} [options] level은 safe 모드의 1~10단계(기본 5)
 */
export function getSplatPreset({ mode = "quality", level = 5 } = {}) {
  const safe = mode === "safe";
  const lite = mode === "lite" || mode === "quest";
  const quest = mode === "quest";
  const safeLevel = Math.min(10, Math.max(1, Math.round(level) || 5));
  const t = safe ? (safeLevel - 1) / 9 : 0;

  return {
    mode,
    level: safe ? safeLevel : null,
    label: safe ? `안전 ${safeLevel}/10` : { lite: "라이트", quest: "초저부하", quality: "고화질" }[mode],
    /** renderer 설정 */
    precision: quest ? "mediump" : "highp",
    /** @param {number} devicePixelRatio */
    pixelRatio: (devicePixelRatio) => (quest ? 0.85 : lite ? 1 : safe ? lerp(0.7, 1.25, t) : Math.min(devicePixelRatio, 1.5)),
    /** SparkRenderer 옵션 */
    spark: {
      focalAdjustment: quest ? 1.0 : lite ? 1.15 : 2.0,
      maxStdDev: quest ? Math.sqrt(2.2) : lite ? Math.sqrt(3) : safe ? Math.sqrt(lerp(3.2, 5.8, t)) : Math.sqrt(6),
      minAlpha: quest ? 8 / 255 : lite ? 4 / 255 : safe ? Math.round(lerp(6, 1, t)) / 255 : 1 / 255,
      maxPixelRadius: quest ? 28 : lite ? 56 : safe ? Math.round(lerp(64, 220, t)) : 256,
      minPixelRadius: quest ? 1 : lite ? 0.5 : safe ? lerp(0.35, 0, t) : 0,
      sortRadial: true,
      minSortIntervalMs: quest ? 180 : lite ? 120 : 0,
      enableLod: lite,
      lodSplatScale: quest ? 0.45 : lite ? 0.8 : 1,
      lodRenderScale: quest ? 3.0 : lite ? 2.4 : 1,
      lodInflate: false,
      coneFov0: quest ? 8 : 90,
      coneFov: quest ? 46 : 120,
      coneFoveate: quest ? 0.92 : 0.4,
      behindFoveate: quest ? 0.02 : 0.2,
    },
    /** SplatMesh 옵션 */
    mesh: {
      enableLod: lite,
      lod: lite ? "quality" : false,
      lodScale: quest ? 0.3 : lite ? 0.55 : 1,
      coneFov0: quest ? 8 : 90,
      coneFov: quest ? 46 : 120,
      coneFoveate: quest ? 0.92 : 0.4,
      behindFoveate: quest ? 0.02 : 0.2,
    },
  };
}

/**
 * 어떤 프리셋으로 시작할지 정한다. 우선순위: 주소 쿼리(?safe=7, ?lite, ?quest, ?quality) → 저장된 선택 → 기본값.
 * 기본값은 기존 데모 규칙과 같다: Quest 브라우저면 safe5, 데스크톱이면 고화질.
 * @param {{ search?: string, userAgent?: string, saved?: { mode: PresetMode, level?: number } | null }} [options]
 * @returns {{ mode: PresetMode, level: number }}
 */
export function resolvePresetChoice({ search = "", userAgent = "", saved = null } = {}) {
  const params = new URLSearchParams(search);
  if (params.has("quest")) return { mode: "quest", level: 5 };
  if (params.has("lite")) return { mode: "lite", level: 5 };
  if (params.has("quality")) return { mode: "quality", level: 5 };
  if (params.has("safe")) return { mode: "safe", level: clampLevel(params.get("safe")) };
  if (saved && ["safe", "lite", "quest", "quality"].includes(saved.mode)) {
    return { mode: saved.mode, level: clampLevel(saved.level) };
  }
  return QUEST_UA.test(userAgent) ? { mode: "safe", level: 5 } : { mode: "quality", level: 5 };
}

function clampLevel(value) {
  return Math.min(10, Math.max(1, Number.parseInt(String(value ?? ""), 10) || 5));
}

/** 설정 화면 선택지 */
export const PRESET_CHOICES = [
  { value: "safe:1", label: "안전 1 (가장 가볍게)" },
  { value: "safe:3", label: "안전 3" },
  { value: "safe:5", label: "안전 5 (Quest 기본)" },
  { value: "safe:7", label: "안전 7" },
  { value: "safe:10", label: "안전 10 (가장 선명)" },
  { value: "lite:5", label: "라이트" },
  { value: "quest:5", label: "초저부하" },
  { value: "quality:5", label: "고화질 (PC용)" },
];

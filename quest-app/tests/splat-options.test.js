import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPTIONS,
  FULL_VIEW,
  POINT_SIZES,
  QUALITY_LEVELS,
  STORAGE_KEY,
  cycle,
  formatPointSize,
  loadOptions,
  normalizeOptions,
  saveOptions,
  sparkForLevel,
  sparkSettings,
} from "../src/viewers/splat/splat-options.js";
import { getSplatPreset } from "../src/viewers/splat/quest-presets.js";

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), map };
};

test("기본 옵션: 자세 유지·미리 받기 켬, 전체 보기 끔", () => {
  assert.equal(DEFAULT_OPTIONS.keepPose, true);
  assert.equal(DEFAULT_OPTIONS.prefetch, true);
  assert.equal(DEFAULT_OPTIONS.fullView, false);
  assert.equal(DEFAULT_OPTIONS.pointSize, 1);
});

test("normalizeOptions: 잘못된 값은 기본값으로", () => {
  assert.deepEqual(normalizeOptions(null), { ...DEFAULT_OPTIONS });
  assert.deepEqual(normalizeOptions({ keepPose: "yes", pointSize: 9, fullView: true }), { ...DEFAULT_OPTIONS, fullView: true });
  assert.equal(normalizeOptions({ pointSize: 1.2 }).pointSize, 1.2);
});

test("저장·불러오기와 저장소가 막힌 경우", () => {
  const storage = memoryStorage();
  saveOptions({ ...DEFAULT_OPTIONS, fullView: true, pointSize: 0.7 }, storage);
  assert.equal(loadOptions(storage).fullView, true);
  assert.equal(loadOptions(storage).pointSize, 0.7);
  storage.map.set(STORAGE_KEY, "{깨진 json");
  assert.deepEqual(loadOptions(storage), { ...DEFAULT_OPTIONS });
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadOptions(broken), { ...DEFAULT_OPTIONS });
  assert.doesNotThrow(() => saveOptions(DEFAULT_OPTIONS, broken));
});

test("cycle: 끝에서 처음으로, 목록에 없는 값은 가까운 칸", () => {
  assert.equal(cycle(QUALITY_LEVELS, 5), 7);
  assert.equal(cycle(QUALITY_LEVELS, 10), 1);
  assert.equal(cycle(QUALITY_LEVELS, 4), 3); // 가장 가까운 3으로 맞춤
  assert.equal(cycle(POINT_SIZES, 1.5), 0.7);
});

test("전체 보기: 안전 5단계의 잘림 값을 Spark 기본 이상으로 올린다", () => {
  const base = sparkForLevel(5);
  assert.ok(base.maxPixelRadius < 512, "안전 5단계는 큰 splat을 잘라 낸다");
  const off = sparkSettings(base, { fullView: false, pointSize: 1 });
  const on = sparkSettings(base, { fullView: true, pointSize: 1 });
  assert.equal(off.maxPixelRadius, base.maxPixelRadius);
  assert.equal(off.clipXY, 1.4);
  assert.ok(on.maxPixelRadius >= FULL_VIEW.maxPixelRadius);
  assert.ok(on.clipXY >= 4);
  assert.ok(on.maxStdDev >= Math.sqrt(8) - 1e-9);
  assert.ok(on.minAlpha <= 1 / 255 + 1e-9);
  assert.equal(on.coneFoveate, 1);
  // 프리셋이 더 넉넉하면 그 값을 유지한다
  const generous = sparkSettings({ ...base, maxPixelRadius: 900 }, { fullView: true, pointSize: 1 });
  assert.equal(generous.maxPixelRadius, 900);
});

test("전체 보기는 라이트·초저부하의 시야 밖 밀도 감소도 푼다", () => {
  for (const mode of ["lite", "quest"]) {
    const base = getSplatPreset({ mode }).spark;
    const on = sparkSettings(base, { fullView: true, pointSize: 1 });
    assert.equal(on.coneFoveate, 1);
    assert.equal(on.behindFoveate, 1);
  }
});

test("점 크기는 focalAdjustment 배율", () => {
  const base = sparkForLevel(5);
  assert.equal(sparkSettings(base, { fullView: false, pointSize: 1 }).focalAdjustment, base.focalAdjustment);
  assert.ok(Math.abs(sparkSettings(base, { fullView: false, pointSize: 1.5 }).focalAdjustment - base.focalAdjustment * 1.5) < 1e-9);
  assert.equal(formatPointSize(1), "×1");
  assert.equal(formatPointSize(0.85), "×0.85");
  assert.equal(formatPointSize(1.5), "×1.5");
});

test("정렬 갱신(sortMs): 기본은 VR에서만 50ms, 2D·'이전 값'은 프리셋 그대로, 프리셋보다 짧아지지 않는다", async () => {
  const { SORT_CHOICES, VR_SORT_MS, formatSortInterval, sortOverride } = await import("../src/viewers/splat/splat-options.js");
  assert.equal(DEFAULT_OPTIONS.sortMs, "auto");
  assert.deepEqual(SORT_CHOICES, ["auto", 120, "preset"]);
  assert.equal(VR_SORT_MS, 50);
  assert.equal(normalizeOptions({ sortMs: 120 }).sortMs, 120);
  assert.equal(normalizeOptions({ sortMs: "preset" }).sortMs, "preset");
  assert.equal(normalizeOptions({ sortMs: 7 }).sortMs, "auto");
  assert.equal(normalizeOptions({ sortMs: null }).sortMs, "auto");
  assert.equal(sortOverride("auto", true), 50);
  assert.equal(sortOverride("auto", false), null);
  assert.equal(sortOverride("preset", true), null);
  assert.equal(sortOverride(120, false), 120);
  const base = { minSortIntervalMs: 0 };
  const plain = { fullView: false, pointSize: 1 };
  assert.equal(sparkSettings(base, plain).minSortIntervalMs, 0); // 2D 기본
  assert.equal(sparkSettings(base, plain, { vr: false }).minSortIntervalMs, 0);
  assert.equal(sparkSettings(base, plain, { vr: true }).minSortIntervalMs, 50); // VR 기본
  assert.equal(sparkSettings(base, { ...plain, sortMs: "preset" }, { vr: true }).minSortIntervalMs, 0); // 이전 값
  assert.equal(sparkSettings(base, { ...plain, sortMs: 120 }, { vr: true }).minSortIntervalMs, 120);
  assert.equal(sparkSettings({ minSortIntervalMs: 180 }, plain, { vr: true }).minSortIntervalMs, 180);
  assert.equal(formatSortInterval("preset"), "이전 값");
  assert.equal(formatSortInterval("auto"), "기본 (VR 50ms)");
  assert.equal(formatSortInterval(120), "120ms");
});

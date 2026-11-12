import assert from "node:assert/strict";
import test from "node:test";
import { ADAPT, DT_CAP_MS, frameBudgetMs, isOverBudget, isSpike, nextAdaptation, spikeLimitMs } from "../src/viewers/splat/adaptive-quality.js";
import { createFrameStats } from "../src/viewers/splat/frame-stats.js";

const budget = 1000 / 72;

function stats(frames) {
  const s = createFrameStats();
  for (const [count, ms, moving] of frames) for (let i = 0; i < count; i++) s.add(ms, moving);
  return s.summary();
}
const idle = { budgetMs: budget, sortMs: 50, level: 5, sinceChangeMs: 60000 };

test("frameBudgetMs: 세션 프레임 속도, 모르면 72Hz", () => {
  assert.ok(Math.abs(frameBudgetMs(90) - 11.111) < 0.01);
  assert.ok(Math.abs(frameBudgetMs(undefined) - budget) < 1e-9);
  assert.ok(Math.abs(frameBudgetMs(0) - budget) < 1e-9);
});

test("예산을 지키면(72Hz) 아무것도 하지 않는다", () => {
  const ok = stats([[200, 13.9, false], [200, 14.5, true]]);
  assert.equal(isOverBudget(ok, budget), false);
  assert.equal(nextAdaptation(ok, idle), null);
});

test("표본이 모자라거나 방금 조정했으면 판단하지 않는다", () => {
  const slow = stats([[100, 28, true]]);
  assert.equal(nextAdaptation(slow, idle), null); // 180프레임 미만
  const enough = stats([[240, 28, true]]);
  assert.deepEqual(nextAdaptation(enough, idle), { sortMs: 120 });
  assert.equal(nextAdaptation(enough, { ...idle, sinceChangeMs: ADAPT.cooldownMs - 1 }), null);
});

test("평균이 예산을 넘으면: 정렬 갱신 → 화질 한 칸씩 → 바닥에서 멈춤", () => {
  const slow = stats([[240, 28, false]]);
  assert.deepEqual(nextAdaptation(slow, idle), { sortMs: 120 });
  assert.deepEqual(nextAdaptation(slow, { ...idle, sortMs: 120 }), { level: 4 });
  assert.deepEqual(nextAdaptation(slow, { ...idle, sortMs: 120, level: 4 }), { level: 3 });
  assert.equal(nextAdaptation(slow, { ...idle, sortMs: 120, level: ADAPT.floorLevel }), null);
  // 안전 프리셋이 아니면(level null) 화질은 건드리지 않는다
  assert.equal(nextAdaptation(slow, { ...idle, sortMs: 120, level: null }), null);
});

test("프리셋 정렬 갱신이 이미 더 늦으면 그보다 늦은 단계만 쓴다", () => {
  const slow = stats([[240, 28, false]]);
  assert.deepEqual(nextAdaptation(slow, { ...idle, sortMs: 80 }), { sortMs: 120 });
});

test("가만히 있을 때는 괜찮고 움직일 때만 p95가 크게 튀면 모자란 것으로 본다", () => {
  const motionOnly = stats([[300, 13.9, false], [80, 14, true], [10, 40, true]]);
  assert.equal(isOverBudget(motionOnly, budget), true);
  // 움직인 프레임이 적으면(90 미만) 평균만 본다
  const fewMoving = stats([[300, 13.9, false], [50, 14, true], [10, 40, true]]);
  assert.equal(isOverBudget(fewMoving, budget), false);
});

test("90Hz 세션이면 예산이 줄어 72Hz 수준 프레임은 모자란 것", () => {
  const frames = stats([[240, 13.9, false]]);
  assert.equal(isOverBudget(frames, frameBudgetMs(90)), true);
  assert.equal(isOverBudget(frames, frameBudgetMs(72)), false);
});

test("큰 끊김 기준: 예산의 4배, 단 앱 dt가 50ms에서 잘리므로 49ms가 상한", () => {
  assert.equal(DT_CAP_MS, 49);
  assert.ok(Math.abs(spikeLimitMs(frameBudgetMs(90)) - 44.444) < 0.001); // 90Hz: 4배
  assert.equal(spikeLimitMs(budget), 49); // 72Hz: 4배(55.6ms)는 잘려서 못 보이므로 49ms
  assert.equal(isSpike(40, budget), false);
  assert.equal(isSpike(49, budget), false);
  assert.equal(isSpike(49.5, budget), true);
  assert.equal(isSpike(50, budget), true); // dt가 잘린 값(50ms)도 끊김
  assert.equal(isSpike(45, frameBudgetMs(90)), true);
});

test("한두 번 튀는 프레임은 표본에서 빼면 화질이 내려가지 않는다(빼지 않으면 내려간다)", () => {
  const frames = [
    [300, 13.9, false],
    [100, 14, true],
    [8, 50, true], // 로딩·헤드셋 벗었다 씀 등으로 잘린 프레임
  ];
  const raw = createFrameStats();
  const filtered = createFrameStats();
  for (const [count, ms, moving] of frames) {
    for (let i = 0; i < count; i++) {
      raw.add(ms, moving);
      if (!isSpike(ms, budget)) filtered.add(ms, moving);
    }
  }
  assert.deepEqual(nextAdaptation(raw.summary(), idle), { sortMs: 120 }); // 거르지 않으면 움직일 때 p95가 튀어 내려감
  assert.equal(nextAdaptation(filtered.summary(), idle), null);
});

test("꾸준히 느린 프레임(예산의 2배)은 끊김이 아니므로 표본에 남아 조절된다", () => {
  const s = createFrameStats();
  for (let i = 0; i < 240; i++) if (!isSpike(28, budget)) s.add(28, true);
  assert.deepEqual(nextAdaptation(s.summary(), idle), { sortMs: 120 });
});

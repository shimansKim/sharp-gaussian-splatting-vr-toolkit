import assert from "node:assert/strict";
import test from "node:test";
import { createFrameStats, diagnoseFrames, formatFrameStats, isHeadMoving } from "../src/viewers/splat/frame-stats.js";

function feed(stats, count, ms, moving) {
  for (let i = 0; i < count; i++) stats.add(ms, moving);
}

test("isHeadMoving: 이동 또는 회전 속도가 기준을 넘으면 움직이는 중", () => {
  assert.equal(isHeadMoving(0.01, 0.01), false);
  assert.equal(isHeadMoving(0.2, 0), true);
  assert.equal(isHeadMoving(0, 0.5), true);
});

test("summary: 평균·p95·최악·끊김 비율과 움직임별 분리", () => {
  const stats = createFrameStats();
  feed(stats, 90, 13.9, false);
  feed(stats, 10, 40, true);
  const s = stats.summary();
  assert.equal(s.frames, 100);
  assert.ok(Math.abs(s.avgMs - (90 * 13.9 + 10 * 40) / 100) < 1e-9);
  assert.equal(s.worstMs, 40);
  assert.equal(s.dropRate, 0.1);
  assert.equal(s.moving.frames, 10);
  assert.equal(s.moving.p95Ms, 40);
  assert.equal(s.still.p95Ms, 13.9);
});

test("createFrameStats: 최근 maxFrames개만 유지, 잘못된 값 무시, reset", () => {
  const stats = createFrameStats(5);
  for (let i = 1; i <= 8; i++) stats.add(i, false);
  stats.add(NaN, false);
  stats.add(-3, false);
  stats.add(0, false);
  const s = stats.summary();
  assert.equal(s.frames, 5);
  assert.equal(s.worstMs, 8);
  stats.reset();
  assert.equal(stats.summary().frames, 0);
  assert.equal(stats.summary().fps, 0);
});

test("diagnoseFrames: motion / slow / ok / 표본 부족", () => {
  const motion = createFrameStats();
  feed(motion, 100, 13.9, false);
  feed(motion, 100, 26, true);
  assert.equal(diagnoseFrames(motion.summary()), "motion");

  const slow = createFrameStats();
  feed(slow, 100, 22, false);
  feed(slow, 100, 23, true);
  assert.equal(diagnoseFrames(slow.summary()), "slow");

  const ok = createFrameStats();
  feed(ok, 100, 13.9, false);
  feed(ok, 100, 14.2, true);
  assert.equal(diagnoseFrames(ok.summary()), "ok");

  const few = createFrameStats();
  feed(few, 10, 13.9, false);
  feed(few, 10, 30, true);
  assert.equal(diagnoseFrames(few.summary()), null);
});

test("formatFrameStats", () => {
  assert.equal(formatFrameStats(createFrameStats().summary()), "측정 중…");
  const stats = createFrameStats();
  feed(stats, 40, 13.9, false);
  feed(stats, 40, 25, true);
  assert.match(formatFrameStats(stats.summary()), /^\d+fps · 움직일 때 25\.0ms · 가만히 13\.9ms$/);
  const few = createFrameStats();
  feed(few, 5, 14, false);
  assert.match(formatFrameStats(few.summary()), /^71fps · p95 14\.0ms$/);
});

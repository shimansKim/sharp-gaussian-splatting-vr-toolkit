import assert from "node:assert/strict";
import test from "node:test";
import { classifyFile, formatBytes, splatFileType } from "../src/core/kinds.js";
import { getSplatPreset, resolvePresetChoice } from "../src/viewers/splat/quest-presets.js";

test("classifyFile: 확장자와 MIME으로 종류를 가른다", () => {
  assert.equal(classifyFile("a.PLY"), "splat");
  assert.equal(classifyFile("a.spz"), "splat");
  assert.equal(classifyFile("v.mp4"), "video");
  assert.equal(classifyFile("x", "image/png"), "image");
  assert.equal(classifyFile("notes.txt"), null);
  assert.equal(splatFileType("a.ply"), "ply");
  assert.equal(splatFileType("a.mp4"), undefined);
});

test("formatBytes", () => {
  assert.equal(formatBytes(66061086), "63.0 MB");
  assert.equal(formatBytes(512), "512 B");
});

test("resolvePresetChoice: 쿼리 > 저장값 > Quest UA 기본값", () => {
  assert.deepEqual(resolvePresetChoice({ search: "?safe=7" }), { mode: "safe", level: 7 });
  assert.deepEqual(resolvePresetChoice({ search: "?quest" }), { mode: "quest", level: 5 });
  assert.deepEqual(resolvePresetChoice({ userAgent: "Mozilla OculusBrowser/40 Quest 3" }), { mode: "safe", level: 5 });
  assert.deepEqual(resolvePresetChoice({ userAgent: "Chrome" }), { mode: "quality", level: 5 });
  assert.deepEqual(resolvePresetChoice({ saved: { mode: "lite", level: 5 } }), { mode: "lite", level: 5 });
  assert.equal(resolvePresetChoice({ search: "?safe=99" }).level, 10);
});

test("getSplatPreset: 기존 데모 값과 같다", () => {
  const safe5 = getSplatPreset({ mode: "safe", level: 5 });
  assert.equal(safe5.spark.maxPixelRadius, Math.round(64 + (220 - 64) * (4 / 9)));
  assert.equal(safe5.spark.minSortIntervalMs, 0);
  assert.equal(safe5.mesh.lod, false);
  const quest = getSplatPreset({ mode: "quest" });
  assert.equal(quest.precision, "mediump");
  assert.equal(quest.pixelRatio(2), 0.85);
  assert.equal(quest.spark.maxPixelRadius, 28);
  assert.equal(quest.mesh.lod, "quality");
  assert.equal(getSplatPreset({ mode: "quality" }).pixelRatio(3), 1.5);
});

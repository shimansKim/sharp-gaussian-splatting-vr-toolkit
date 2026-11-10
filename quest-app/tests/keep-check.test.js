import assert from "node:assert/strict";
import { test } from "node:test";
import { keepBlocker } from "../src/core/keep-check.js";

const GB = 1024 ** 3;

test("공간이 충분하면 막지 않는다", () => {
  assert.equal(keepBlocker({ size: 1 * GB, kind: "video", sourceId: "pc" }, { usage: 0, quota: 10 * GB }), null);
});

test("크기·용량을 모르면 막지 않는다(저장 중 오류로 처리)", () => {
  assert.equal(keepBlocker({ kind: "video", sourceId: "pc" }, { usage: 0, quota: 10 * GB }), null);
  assert.equal(keepBlocker({ size: 5 * GB, kind: "video", sourceId: "pc" }, null), null);
});

test("영상이 남은 공간보다 크면 스트리밍으로 보라고 안내한다", () => {
  const message = keepBlocker({ size: 6 * GB, kind: "video", sourceId: "pc" }, { usage: 2 * GB, quota: 5 * GB });
  assert.match(message, /6\.00 GB/);
  assert.match(message, /3\.00 GB/);
  assert.match(message, /스트리밍/);
});

test("PLY는 스트리밍 안내 대신 보관함 정리를 안내한다", () => {
  const message = keepBlocker({ size: 6 * GB, kind: "splat", sourceId: "pc" }, { usage: 0, quota: 5 * GB });
  assert.match(message, /지운 뒤/);
  assert.doesNotMatch(message, /스트리밍/);
});

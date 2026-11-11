import assert from "node:assert/strict";
import test from "node:test";
import { createReloadGuard, installUpdateGuard, isChunkLoadError } from "../src/core/update-guard.js";

const memory = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

test("isChunkLoadError: Chromium·Firefox·Safari 문구와 MIME 오류를 알아본다", () => {
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/spark.module-A.js")), true);
  assert.equal(isChunkLoadError(new Error("error loading dynamically imported module")), true);
  assert.equal(isChunkLoadError("Importing a module script failed."), true);
  assert.equal(isChunkLoadError(new Error("파일을 읽지 못했습니다 (HTTP 500)")), false);
  assert.equal(isChunkLoadError(null), false);
});

test("reloadGuard: 60초 안에는 두 번째 새로고침을 막는다", () => {
  let t = 1000;
  const guard = createReloadGuard(memory(), () => t);
  assert.equal(guard.tryReload(), true);
  assert.equal(guard.reloadedRecently(), true);
  t += 10_000;
  assert.equal(guard.tryReload(), false, "무한 새로고침 방지");
  t += 60_000;
  assert.equal(guard.tryReload(), true);
});

function fakeWindow({ controller = true } = {}) {
  const listeners = {};
  const swListeners = {};
  return {
    addEventListener: (name, fn) => (listeners[name] ??= []).push(fn),
    navigator: { serviceWorker: { controller: controller ? {} : null, addEventListener: (name, fn) => (swListeners[name] ??= []).push(fn) } },
    fire: (name, event = {}) => (listeners[name] ?? []).forEach((fn) => fn(event)),
    fireSw: (name, event = {}) => (swListeners[name] ?? []).forEach((fn) => fn(event)),
  };
}

test("청크 로드 실패(vite:preloadError·unhandledrejection)는 한 번 새로고침하고 안내한다", () => {
  const win = fakeWindow();
  const calls = [];
  installUpdateGuard({ win, storage: memory(), reload: () => calls.push("reload"), notify: (t) => calls.push(t), canReloadNow: () => false });
  let prevented = false;
  win.fire("vite:preloadError", { preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.deepEqual(calls, ["새 버전을 받아 다시 시작합니다…", "reload"]);
  win.fire("unhandledrejection", { reason: new TypeError("Failed to fetch dynamically imported module: x") });
  assert.equal(calls.length, 2, "이미 새로고침했으므로 또 하지 않는다");
});

test("관련 없는 unhandledrejection은 무시한다", () => {
  const win = fakeWindow();
  const calls = [];
  installUpdateGuard({ win, storage: memory(), reload: () => calls.push("reload"), canReloadNow: () => true });
  win.fire("unhandledrejection", { reason: new Error("다른 오류") });
  assert.deepEqual(calls, []);
});

test("새 서비스 워커: 보던 것이 없으면 바로, 있으면 끝난 뒤에 새로고침한다", () => {
  const win = fakeWindow();
  const calls = [];
  let busy = true;
  const guard = installUpdateGuard({ win, storage: memory(), reload: () => calls.push("reload"), canReloadNow: () => !busy });
  win.fireSw("controllerchange");
  assert.deepEqual(calls, [], "VR·항목을 보는 중이면 미룬다");
  assert.equal(guard.pending, true);
  guard.flush();
  assert.deepEqual(calls, []);
  busy = false;
  guard.flush();
  assert.deepEqual(calls, ["reload"]);
});

test("처음 설치(제어 중인 서비스 워커가 없던 경우)의 controllerchange는 새로고침하지 않는다", () => {
  const win = fakeWindow({ controller: false });
  const calls = [];
  installUpdateGuard({ win, storage: memory(), reload: () => calls.push("reload"), canReloadNow: () => true });
  win.fireSw("controllerchange");
  assert.deepEqual(calls, []);
});

test("서비스 워커가 보낸 sharp:updated 메시지도 같은 규칙으로 처리한다(처음 설치 때는 무시)", () => {
  const first = fakeWindow({ controller: false });
  const firstCalls = [];
  installUpdateGuard({ win: first, storage: memory(), reload: () => firstCalls.push("reload"), canReloadNow: () => true });
  first.fireSw("message", { data: { type: "sharp:updated" } });
  assert.deepEqual(firstCalls, []);
  const win = fakeWindow({ controller: true });
  const calls = [];
  installUpdateGuard({ win, storage: memory(), reload: () => calls.push("reload"), canReloadNow: () => true });
  win.fireSw("message", { data: { type: "sharp:updated" } });
  assert.deepEqual(calls, ["reload"]);
});

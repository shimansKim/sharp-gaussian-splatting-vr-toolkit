import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VR_SOURCE, createSourceMemory, explainVrError, isVrLaunch, startVrLaunch } from "../src/core/vr-launch.js";

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("isVrLaunch: ?vr=1만 VR 앱으로 본다", () => {
  assert.equal(isVrLaunch("?vr=1"), true);
  assert.equal(isVrLaunch("?a=1&vr=1"), true);
  assert.equal(isVrLaunch("?vr=0"), false);
  assert.equal(isVrLaunch(""), false);
});

test("createSourceMemory: 알려진 소스만 기억하고 저장소가 막혀도 죽지 않는다", () => {
  const storage = memoryStorage();
  const memory = createSourceMemory(storage);
  assert.equal(memory.load(), null);
  memory.save("gdrive");
  assert.equal(memory.load(), "gdrive");
  memory.save("엉뚱한값");
  assert.equal(memory.load(), "gdrive");
  memory.save("session"); // VR에서 못 쓰는 소스는 기억하지 않는다
  assert.equal(memory.load(), "gdrive");
  assert.equal(createSourceMemory(memoryStorage({ "sharp-quest.last-source": "session" })).load(), null);
  const broken = { getItem: () => { throw new Error("막힘"); }, setItem: () => { throw new Error("막힘"); } };
  assert.equal(createSourceMemory(broken).load(), null);
  createSourceMemory(broken).save("pc");
});

test("explainVrError: NotSupportedError에는 해결 방법을 붙인다", () => {
  const error = Object.assign(new Error("The requested session is not supported."), { name: "NotSupportedError" });
  assert.match(explainVrError(error), /SHARP VR/);
  assert.match(explainVrError(Object.assign(new Error("x"), { name: "SecurityError" })), /버튼/);
  assert.equal(explainVrError(new Error("그냥 오류")), "그냥 오류");
});

function setupLaunch({ supported = true, enterError = null, current = null, saved = {} } = {}) {
  const calls = [];
  const statuses = [];
  const handlers = {};
  const winHandlers = {};
  const stage = {
    isVRSupported: async () => supported,
    enterVR: async () => {
      calls.push("enterVR");
      if (enterError) throw enterError;
    },
    isPresenting: () => false,
  };
  const library = { setListSource: (id) => calls.push(`source:${id}`), current };
  const panel = { isOpen: false, openAfterPose() { calls.push("panel"); } };
  const win = {
    addEventListener: (name, fn) => (winHandlers[name] ??= []).push(fn),
    removeEventListener: (name, fn) => (winHandlers[name] = (winHandlers[name] ?? []).filter((f) => f !== fn)),
  };
  const memory = createSourceMemory(memoryStorage(saved));
  const on = (name, fn) => ((handlers[name] ??= []).push(fn), () => {});
  const done = startVrLaunch({ stage, library, panel, status: (text, kind) => statuses.push({ text, kind }), memory, on, win });
  return { calls, statuses, handlers, winHandlers, panel, done };
}

test("VR 앱 시작: 마지막 소스(없으면 PC)를 열고 바로 VR에 들어간 뒤, 열린 파일이 없으면 패널을 띄운다", async () => {
  const run = setupLaunch({ saved: { "sharp-quest.last-source": "library" } });
  await run.done;
  assert.deepEqual(run.calls, ["source:library", "enterVR"]);
  run.handlers["xr:sessionstart"][0]();
  assert.deepEqual(run.calls, ["source:library", "enterVR", "panel"]);
  const first = setupLaunch();
  await first.done;
  assert.equal(first.calls[0], `source:${DEFAULT_VR_SOURCE}`);
});

test("VR 앱 시작: 이미 열린 파일이 있으면 패널을 띄우지 않는다", async () => {
  const run = setupLaunch({ current: { id: "x" } });
  await run.done;
  run.handlers["xr:sessionstart"][0]();
  assert.ok(!run.calls.includes("panel"));
});

test("VR 앱 시작: 진입이 거부되면 이유를 보이고 첫 입력에서 다시 시도한다", async () => {
  const error = Object.assign(new Error("거부"), { name: "NotAllowedError" });
  const run = setupLaunch({ enterError: error });
  await run.done;
  await tick();
  assert.match(run.statuses.at(-1).text, /VR을 시작하지 못했습니다.*NotAllowedError/);
  assert.equal(run.statuses.at(-1).kind, "error");
  assert.equal(run.calls.filter((c) => c === "enterVR").length, 1);
  run.winHandlers.pointerdown[0]();
  await tick();
  assert.equal(run.calls.filter((c) => c === "enterVR").length, 2, "입력으로 다시 시도");
});

test("VR 앱 시작: 지원 판정이 false여도 안내하고 입력 때 한 번 시도해 본다", async () => {
  const run = setupLaunch({ supported: false });
  await run.done;
  assert.match(run.statuses.at(-1).text, /SHARP VR/);
  assert.equal(run.calls.includes("enterVR"), false);
  run.winHandlers.click[0]();
  await tick();
  assert.equal(run.calls.includes("enterVR"), true);
});

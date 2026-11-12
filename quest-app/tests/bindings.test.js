// 컨트롤러 버튼 배정(core/bindings.js)과 그 표대로 읽는 판정(core/input-map.js), PC 동기화(core/bindings-sync.js)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ACTIONS,
  FIXED,
  SCOPES,
  STORAGE_KEY,
  cleanOverrides,
  createBindingStore,
  defaultBindings,
  describeAction,
  describeInput,
  findConflicts,
  hasHoldSibling,
  inputChoices,
  mergeBindings,
  normalizeInput,
  panelHint,
} from "../src/core/bindings.js";
import { HOLD_MS, commonActions, createActionTracker, mediaStickValues } from "../src/core/input-map.js";
import { createBindingsSync } from "../src/core/bindings-sync.js";

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

const hand = (o = {}) => ({ connected: true, x: 0, y: 0, trigger: 0, grip: 0, primary: false, secondary: false, stick: false, stickPressed: false, primaryPressed: false, secondaryPressed: false, triggerPressed: false, gripPressed: false, ...o });
const input = ({ left = {}, right = {}, presenting = true } = {}) => ({ presenting, left: hand(left), right: hand(right) });

// ── 표 ────────────────────────────────────────────────────────────────────
test("기본 배정: 모든 동작에 기본값이 있고, 기본값끼리는 충돌이 없다", () => {
  const map = defaultBindings();
  assert.equal(Object.keys(map).length, ACTIONS.length);
  for (const a of ACTIONS) assert.ok(SCOPES[a.scope], a.id);
  assert.deepEqual(findConflicts(map), []);
  // 지금까지 쓰던 배정 그대로
  assert.equal(describeAction(map, "common.prev"), "X");
  assert.equal(describeAction(map, "common.next"), "A");
  assert.equal(describeAction(map, "common.uiToggle"), "B/Y");
  assert.equal(describeAction(map, "common.uiMove"), "B/Y 길게");
  assert.equal(describeAction(map, "media.turn"), "왼쪽 스틱");
  assert.equal(describeAction(map, "media.zoom"), "오른쪽 스틱 상하");
  assert.equal(describeAction(map, "media.scrub"), "오른쪽 스틱 좌우");
  assert.equal(describeAction(map, "media.recenter"), "왼쪽 스틱 누르기(L3)");
  assert.equal(describeAction(map, "splat.fit"), "오른쪽 스틱 누르기(R3)");
});

test("cleanOverrides·mergeBindings: 모르는 동작·잘못된 값·기본값과 같은 값은 버리고, null(지정 안 함)은 남긴다", () => {
  const o = cleanOverrides({
    "common.prev": { hand: "right", button: "grip", mode: "hold" },
    "common.next": { hand: "right", button: "primary", mode: "press" }, // 기본값과 같다
    "media.zoom": { hand: "left", axis: "z" }, // 잘못된 축
    "media.turn": { hand: "either" }, // 스틱은 한 손만
    "splat.fit": null,
    "nope.x": { hand: "left" },
  });
  assert.deepEqual(o, { "common.prev": { hand: "right", button: "grip", mode: "hold" }, "splat.fit": null });
  const m = mergeBindings(o);
  assert.equal(m["splat.fit"], null);
  assert.equal(describeAction(m, "splat.fit"), "지정 안 함");
  assert.equal(describeAction(m, "common.prev"), "오른쪽 그립 길게");
});

test("충돌: 같은 범위·같은 버튼·같은 방식, 양손(either)은 한 손과 겹친다, 짧게/길게는 따로, 범위가 다르면 괜찮다", () => {
  const clash = (o) => findConflicts(mergeBindings(o)).map((c) => [c.a, c.b].sort().join("+"));
  assert.deepEqual(clash({ "common.next": { hand: "left", button: "primary", mode: "press" } }), ["common.next+common.prev"]);
  // either B/Y 짧게(UI 켜기·끄기)와 오른쪽 B 짧게
  assert.deepEqual(clash({ "media.recenter": { hand: "right", button: "secondary", mode: "press" } }), ["common.uiToggle+media.recenter"]);
  // 같은 버튼 길게는 UI 옮기기와 겹친다
  assert.deepEqual(clash({ "media.recenter": { hand: "left", button: "secondary", mode: "hold" } }), ["common.uiMove+media.recenter"]);
  // 영상·사진과 PLY는 범위가 달라 같은 입력을 써도 된다(기본값이 이미 그렇다: L3 = 위치 맞춤 / 크기 되돌리기)
  assert.deepEqual(clash({}), []);
  // 스틱 전체와 같은 스틱의 한 축은 겹친다
  assert.deepEqual(clash({ "media.zoom": { hand: "left", axis: "y" } }), ["media.turn+media.zoom"]);
  // 같은 축 두 동작
  assert.deepEqual(clash({ "media.zoom": { hand: "right", axis: "x" } }), ["media.scrub+media.zoom"]);
  // PLY 그립은 고정(잡기)이라 PLY 버튼을 그립에 두면 충돌
  assert.deepEqual(clash({ "splat.fit": { hand: "right", button: "grip", mode: "press" } }), ["splat.fit+splat.grab"]);
  // 영상·사진은 그립을 안 쓰므로 괜찮다
  assert.deepEqual(clash({ "media.recenter": { hand: "right", button: "grip", mode: "press" } }), []);
  // 지정 안 함은 아무것과도 겹치지 않는다
  assert.deepEqual(clash({ "common.prev": null, "common.next": null }), []);
});

test("hasHoldSibling: 같은 버튼에 '길게' 동작이 있으면 '짧게'는 뗄 때 판정", () => {
  const map = defaultBindings();
  assert.equal(hasHoldSibling(map, "common.uiToggle"), true);
  assert.equal(hasHoldSibling(map, "common.prev"), false);
  assert.equal(hasHoldSibling(mergeBindings({ "common.uiMove": null }), "common.uiToggle"), false);
  assert.equal(hasHoldSibling(mergeBindings({ "common.uiMove": { hand: "left", button: "primary", mode: "hold" } }), "common.prev"), true);
});

test("describeInput·inputChoices: 드롭다운 선택지와 이름", () => {
  const buttons = inputChoices("button");
  assert.equal(buttons.length, 1 + 3 * 5 * 2);
  assert.equal(buttons[0].label, "지정 안 함");
  assert.ok(buttons.some((c) => c.label === "오른쪽 스틱 누르기(R3) 길게"));
  assert.equal(inputChoices("axis").length, 5);
  assert.equal(inputChoices("stick").length, 3);
  assert.equal(describeInput("button", { hand: "either", button: "stick", mode: "press" }), "스틱 누르기(L3/R3)");
  assert.equal(describeInput("button", { hand: "left", button: "trigger", mode: "hold" }), "왼쪽 트리거 길게");
  // 모든 선택지가 값으로 되돌아가고 정리해도 같다
  for (const a of ACTIONS) for (const c of inputChoices(a.kind)) assert.notEqual(normalizeInput(a.kind, JSON.parse(c.value)), undefined, c.label);
});

// ── 저장소 ────────────────────────────────────────────────────────────────
test("저장소: 바꾼 값만 저장하고, 다시 만들면 그대로 읽고, 되돌리기·통째 바꾸기·깨진 저장값", () => {
  const storage = memoryStorage();
  let t = 1000;
  const store = createBindingStore({ storage: () => storage, now: () => t });
  assert.equal(store.meta().source, "default");
  const seen = [];
  store.subscribe((map, meta) => seen.push([map["common.prev"], meta.source]));
  assert.equal(store.set("common.prev", { hand: "left", button: "trigger", mode: "press" }), true);
  assert.equal(store.set("common.prev", { hand: "left", button: "nope" }), false);
  assert.equal(store.set("nope", null), false);
  const saved = JSON.parse(storage.map.get(STORAGE_KEY));
  assert.deepEqual(saved.bindings, { "common.prev": { hand: "left", button: "trigger", mode: "press" } });
  assert.equal(saved.updatedAt, 1000);
  assert.equal(seen.length, 1);
  assert.equal(store.get(), store.get(), "바뀌기 전에는 같은 객체");

  const again = createBindingStore({ storage: () => storage });
  assert.equal(describeAction(again.get(), "common.prev"), "왼쪽 트리거");
  assert.equal(again.meta().source, "device");

  t = 2000;
  store.set("common.prev", { hand: "left", button: "primary", mode: "press" }); // 기본값으로 고르면 바꾼 값에서 빠진다
  assert.deepEqual(store.overrides(), {});
  store.set("media.zoom", { hand: "left", axis: "x" });
  store.reset("media.zoom");
  assert.deepEqual(store.overrides(), {});
  store.replace({ "splat.fit": null }, { source: "pc", updatedAt: 5000 });
  assert.deepEqual(store.meta(), { updatedAt: 5000, source: "pc" });
  assert.equal(store.get()["splat.fit"], null);
  store.reset();
  assert.equal(store.meta().source, "default");

  storage.map.set(STORAGE_KEY, "{깨짐");
  assert.deepEqual(createBindingStore({ storage: () => storage }).overrides(), {});
  const blocked = createBindingStore({ storage: () => ({ getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } }) });
  assert.equal(blocked.set("common.prev", null), true, "저장이 막혀도 실행 중에는 바뀐다");
  assert.equal(blocked.get()["common.prev"], null);
});

// ── 판정 ──────────────────────────────────────────────────────────────────
test("판정기: 누르는 순간 / 같은 버튼에 길게가 있으면 짧게 뗄 때 / 길게는 HOLD_MS에 한 번", () => {
  let t = 0;
  let map = defaultBindings();
  const tracker = createActionTracker(["common.prev", "common.uiToggle", "common.uiMove"], { getBindings: () => map, now: () => t });
  assert.deepEqual([...tracker.update(input({ left: { primary: true, primaryPressed: true } }))], ["common.prev"]);
  // B 누름: 바로는 아무것도, 짧게 떼면 UI 켜기·끄기
  assert.equal(tracker.update(input({ right: { secondary: true, secondaryPressed: true } })).size, 0);
  t += 100;
  assert.deepEqual([...tracker.update(input())], ["common.uiToggle"]);
  // 길게
  tracker.update(input({ right: { secondary: true } }));
  t += HOLD_MS;
  assert.deepEqual([...tracker.update(input({ right: { secondary: true } }))], ["common.uiMove"]);
  assert.equal(tracker.update(input()).size, 0, "길게 뒤 떼도 짧게는 안 나온다");
  // 사람이 '이전'을 오른쪽 그립 길게로 바꾸면
  map = mergeBindings({ "common.prev": { hand: "right", button: "grip", mode: "hold" } });
  assert.equal(tracker.update(input({ left: { primary: true, primaryPressed: true } })).size, 0, "X는 이제 아무것도 아니다");
  tracker.update(input({ right: { grip: 1 } }));
  t += HOLD_MS;
  assert.deepEqual([...tracker.update(input({ right: { grip: 1 } }))], ["common.prev"]);
  // UI 옮기기를 끄면 B/Y 짧게는 누르는 순간 나온다
  map = mergeBindings({ "common.uiMove": null });
  tracker.update(input());
  assert.deepEqual([...tracker.update(input({ left: { secondary: true, secondaryPressed: true } }))], ["common.uiToggle"]);
  // VR 밖이면 없다
  assert.equal(tracker.update(input({ presenting: false, left: { primaryPressed: true } })).size, 0);
});

test("commonActions: 배정대로 이전·다음을 읽는다(바꾸면 따라간다)", () => {
  assert.deepEqual(commonActions(input({ left: { primaryPressed: true }, right: { primaryPressed: true } }), defaultBindings()), ["prev", "next"]);
  const swapped = mergeBindings({ "common.prev": { hand: "right", button: "primary", mode: "press" }, "common.next": { hand: "left", button: "primary", mode: "press" } });
  assert.deepEqual(commonActions(input({ left: { primaryPressed: true } }), swapped), ["next"]);
});

test("mediaStickValues: 같은 스틱이면 대각선은 더 크게 민 축만(splitRightStick 규칙), 다른 스틱이면 둘 다", () => {
  const map = defaultBindings();
  assert.deepEqual(mediaStickValues(input({ right: { x: 0.8, y: -0.9 } }), map), { scrub: 0, zoom: 0.9 });
  assert.deepEqual(mediaStickValues(input({ right: { x: 0.9, y: -0.8 } }), map), { scrub: 0.9, zoom: 0 });
  assert.deepEqual(mediaStickValues(input({ right: { x: 0.7, y: 0.7 } }), map), { scrub: 0, zoom: -0.7 }, "같으면 줌");
  // 줌을 왼쪽 스틱 좌우로 옮기면(회전은 지정 안 함) 둘은 따로 나간다. 좌우 줌은 오른쪽이 확대(+)
  const apart = mergeBindings({ "media.turn": null, "media.zoom": { hand: "left", axis: "x" } });
  assert.deepEqual(mediaStickValues(input({ left: { x: 0.5 }, right: { x: 0.8, y: -0.9 } }), apart), { scrub: 0.8, zoom: 0.5 });
  // 되감기를 상하, 줌을 좌우로 바꿔도 분리는 같다
  const crossed = mergeBindings({ "media.zoom": { hand: "right", axis: "x" }, "media.scrub": { hand: "right", axis: "y" } });
  assert.deepEqual(mediaStickValues(input({ right: { x: 0.3, y: -0.9 } }), crossed), { scrub: 0.9, zoom: 0 });
});

test("panelHint: VR 패널 안내 줄이 배정을 따른다", () => {
  assert.equal(panelHint(defaultBindings()), "스틱: 목록 넘기기 · X/A: 이전·다음 · B/Y: UI 끄기 · B/Y 길게: 옮기기");
  assert.equal(panelHint(mergeBindings({ "common.uiMove": null, "common.prev": { hand: "left", button: "trigger", mode: "hold" } })), "스틱: 목록 넘기기 · 왼쪽 트리거 길게/A: 이전·다음 · B/Y: UI 끄기");
});

test("조작표(notes)의 '버튼 지정' 표가 기본 배정과 같다", () => {
  const notes = readFileSync(new URL("../../notes/quest-app-controls-ko.md", import.meta.url), "utf8");
  const map = defaultBindings();
  for (const a of ACTIONS) assert.ok(notes.includes(`| ${SCOPES[a.scope]} | ${a.label} | ${describeAction(map, a.id)} |`), `${a.id} 줄이 없다`);
  for (const f of FIXED) assert.ok(notes.includes(`| ${f.label} | ${f.text} (고정) |`), `${f.id} 줄이 없다`);
});

// ── PC 동기화 ─────────────────────────────────────────────────────────────
function fakeConnection() {
  const subs = new Set();
  return {
    state: { status: "idle", base: null },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    set(state) {
      this.state = state;
      for (const fn of subs) fn(state);
    },
  };
}

function fakeServer(initial = { version: 1, updatedAt: 0, bindings: {} }) {
  const server = { record: initial, calls: [] };
  server.fetch = async (url, init = {}) => {
    server.calls.push([init.method ?? "GET", url, init.targetAddressSpace]);
    const respond = (status, body) => ({ status, ok: status === 200, json: async () => body });
    if (server.missing) return respond(404, { error: "not found" });
    if ((init.method ?? "GET") === "GET") return respond(200, server.record);
    const body = JSON.parse(init.body);
    if (!body.force && server.record.updatedAt > body.updatedAt) return respond(409, { error: "newer", current: server.record });
    server.record = { version: 1, updatedAt: body.updatedAt, bindings: body.bindings };
    return respond(200, server.record);
  };
  return server;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("PC 동기화: 연결되면 나중에 바꾼 쪽이 이긴다(PC가 최근이면 받아 옴, 기기가 최근이면 보냄)", async () => {
  // PC가 더 최근
  let store = createBindingStore({ storage: () => memoryStorage(), now: () => 1000 });
  store.set("common.prev", { hand: "left", button: "trigger", mode: "press" }); // 기기 시각 1000
  let server = fakeServer({ version: 1, updatedAt: 5000, bindings: { "splat.fit": null } });
  let conn = fakeConnection();
  let sync = createBindingsSync({ store, connection: conn, fetch: server.fetch, setTimeout: (fn) => fn(), clearTimeout: () => {} });
  conn.set({ status: "connected", base: "http://192.168.0.5:8787" });
  await tick();
  assert.deepEqual(store.overrides(), { "splat.fit": null });
  assert.equal(store.meta().source, "pc");
  assert.equal(server.calls[0][2], "local", "LAN 주소는 LNA 표시를 붙인다");
  assert.match(sync.status().text, /나중에 바꾼 쪽이 이깁니다/);

  // 기기가 더 최근
  store = createBindingStore({ storage: () => memoryStorage(), now: () => 9000 });
  store.set("media.zoom", { hand: "left", axis: "x" });
  server = fakeServer({ version: 1, updatedAt: 5000, bindings: { "splat.fit": null } });
  conn = fakeConnection();
  sync = createBindingsSync({ store, connection: conn, fetch: server.fetch, setTimeout: (fn) => fn(), clearTimeout: () => {} });
  conn.set({ status: "connected", base: "http://192.168.0.5:8787" });
  await tick();
  await tick();
  assert.deepEqual(server.record.bindings, { "media.zoom": { hand: "left", axis: "x" } });
  assert.equal(server.record.updatedAt, 9000);

  // 연결된 동안 기기에서 바꾸면 곧 보낸다, PC에서 받아 온 것은 다시 보내지 않는다
  const before = server.calls.length;
  store.set("common.next", null);
  await tick();
  assert.equal(server.calls.length, before + 1);
  assert.deepEqual(server.record.bindings["common.next"], null);
  await sync.pull();
  assert.equal(server.calls.at(-1)[0], "GET");

  // [이 배정을 PC로 보내기]는 PC가 더 최근이어도 덮어쓴다
  server.record = { version: 1, updatedAt: 99999, bindings: {} };
  assert.equal(await sync.push(), "PC로 보냈습니다");
  assert.ok(server.record.bindings["media.zoom"]);
});

test("PC 동기화: 옛 서버(/api/bindings 없음)·연결 안 됨은 알리기만 한다", async () => {
  const store = createBindingStore({ storage: () => memoryStorage() });
  const server = fakeServer();
  server.missing = true;
  const conn = fakeConnection();
  const sync = createBindingsSync({ store, connection: conn, fetch: server.fetch, setTimeout: (fn) => fn(), clearTimeout: () => {} });
  assert.equal(sync.status().connected, false);
  conn.set({ status: "connected", base: "http://10.0.0.2:8787" });
  await tick();
  assert.match(sync.status().text, /새 버전/);
  store.set("common.prev", null); // 옛 서버로는 보내지 않는다
  await tick();
  assert.equal(server.calls.length, 1);
  await assert.rejects(sync.pull(), /새 버전/);
});

test("PC 동기화: 이 기기 변경이 PC의 더 최근 배정에 밀려 버려지면(409) onDiscard로 알리고 설정창 경고(notice)를 남긴다", async () => {
  let t = 1000;
  const store = createBindingStore({ storage: () => memoryStorage(), now: () => t });
  const server = fakeServer({ version: 1, updatedAt: 500, bindings: {} });
  const conn = fakeConnection();
  const notices = [];
  const sync = createBindingsSync({ store, connection: conn, fetch: server.fetch, setTimeout: (fn) => fn(), clearTimeout: () => {}, onDiscard: (text) => notices.push(text) });
  conn.set({ status: "connected", base: "http://192.168.0.5:8787" });
  await tick();
  assert.equal(sync.notice, "");
  // 그사이 PC 페이지에서 더 최근에 바꿨다
  server.record = { version: 1, updatedAt: 50_000, bindings: { "splat.fit": null } };
  store.set("common.prev", { hand: "left", button: "trigger", mode: "press" }); // 이 기기 시각 1000 → 409
  await tick();
  await tick();
  assert.equal(notices.length, 1, "한 번 크게 알린다");
  assert.match(sync.notice, /버리고 PC 배정/);
  assert.deepEqual(store.overrides(), { "splat.fit": null }, "PC 배정이 적용됐다");
  assert.equal(store.meta().source, "pc");
  // 사람이 다시 바꾸면 지난 알림은 지운다(그리고 이번엔 더 최근이라 보내진다)
  t = 90_000;
  store.set("common.next", null);
  assert.equal(sync.notice, "");
  await tick();
  assert.equal(server.record.updatedAt, 90_000);
  assert.equal(notices.length, 1);
});


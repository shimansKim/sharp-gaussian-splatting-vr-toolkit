// VR 안 버튼 지정: 입력 받기(core/binding-capture.js)와 [컨트롤러 버튼 지정] 화면 동작(ui/vr-bindings-page.js)
import assert from "node:assert/strict";
import { test } from "node:test";
import { HOLD_MS } from "../src/core/input-map.js";
import { allowedFor, actionById, createBindingStore, describeAction, inputChoices } from "../src/core/bindings.js";
import { createBindingCapture, inputIsNeutral } from "../src/core/binding-capture.js";
import { CONFIRM_MS, createVrBindingsPage } from "../src/ui/vr-bindings-page.js";

const hand = (o = {}) => ({ connected: true, x: 0, y: 0, trigger: 0, grip: 0, primary: false, secondary: false, stick: false, stickPressed: false, primaryPressed: false, secondaryPressed: false, triggerPressed: false, gripPressed: false, ...o });
const input = ({ left = {}, right = {}, presenting = true } = {}) => ({ presenting, left: hand(left), right: hand(right) });
function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

// ── 입력 받기 ──────────────────────────────────────────────────────────────
test("capture 버튼: 떼면 짧게, HOLD_MS 넘게 누르면 길게, 양손 켜면 either", () => {
  let t = 0;
  let c = createBindingCapture({ kind: "button", now: () => t });
  assert.equal(c.update(input()), undefined);
  assert.equal(c.update(input({ right: { secondary: true, secondaryPressed: true } })), undefined, "누르는 동안은 아직");
  t += 100;
  assert.deepEqual(c.update(input()), { hand: "right", button: "secondary", mode: "press" });
  c = createBindingCapture({ kind: "button", now: () => t, either: true });
  c.update(input({ left: { grip: 1, gripPressed: true } }));
  t += HOLD_MS;
  assert.deepEqual(c.update(input({ left: { grip: 1 } })), { hand: "either", button: "grip", mode: "hold" });
  // 스틱 누르기도 버튼
  c = createBindingCapture({ kind: "button", now: () => t });
  c.update(input({ left: { stick: true, stickPressed: true } }));
  assert.deepEqual(c.update(input()), { hand: "left", button: "stick", mode: "press" });
});

test("capture 트리거: 레이가 패널을 가리킬 때는 패널 버튼 누르기라 받지 않고, 패널 밖이면 받는다", () => {
  let t = 0;
  const c = createBindingCapture({ kind: "button", now: () => t });
  assert.equal(c.update(input({ right: { trigger: 1, triggerPressed: true } }), { right: true }), undefined);
  c.update(input(), { right: true });
  c.update(input({ right: { trigger: 1, triggerPressed: true } }), { right: false });
  assert.deepEqual(c.update(input()), { hand: "right", button: "trigger", mode: "press" });
});

test("capture 축·스틱: 끝까지 민 손과 더 크게 민 축, 살짝 민 것은 무시", () => {
  const axis = createBindingCapture({ kind: "axis" });
  assert.equal(axis.update(input({ left: { x: 0.5 } })), undefined);
  assert.deepEqual(axis.update(input({ left: { x: 0.2, y: -0.95 } })), { hand: "left", axis: "y" });
  const stick = createBindingCapture({ kind: "stick" });
  assert.deepEqual(stick.update(input({ right: { x: 0.9 } })), { hand: "right" });
  assert.equal(inputIsNeutral(input()), true);
  assert.equal(inputIsNeutral(input({ left: { x: 0.5 } })), false);
  assert.equal(inputIsNeutral(input({ right: { secondary: true } })), false);
});

// ── 안전장치 ──────────────────────────────────────────────────────────────
test("UI 켜기·끄기는 비워 둘 수 없고 트리거에 둘 수 없다(저장소·드롭다운 모두)", () => {
  const ui = actionById("common.uiToggle");
  assert.equal(allowedFor(ui, null), false);
  assert.equal(allowedFor(ui, { hand: "right", button: "trigger", mode: "press" }), false);
  assert.equal(allowedFor(ui, { hand: "right", button: "grip", mode: "press" }), true);
  const store = createBindingStore({ storage: () => memoryStorage() });
  assert.equal(store.set("common.uiToggle", null), false);
  assert.equal(store.set("common.uiToggle", { hand: "left", button: "trigger", mode: "hold" }), false);
  assert.equal(describeAction(store.get(), "common.uiToggle"), "B/Y");
  const choices = inputChoices("button", ui).map((c) => c.label);
  assert.ok(!choices.includes("지정 안 함") && !choices.some((l) => l.includes("트리거")));
  assert.ok(inputChoices("button", actionById("common.prev")).some((c) => c.label === "지정 안 함"), "다른 동작은 비울 수 있다");
  // PC에서 받아 온 값도 같은 규칙으로 거른다
  store.replace({ "common.uiToggle": null }, { source: "pc", updatedAt: 1 });
  assert.equal(describeAction(store.get(), "common.uiToggle"), "B/Y");
});

// ── 화면 ──────────────────────────────────────────────────────────────────
function makePage() {
  let t = 1000;
  const store = createBindingStore({ storage: () => memoryStorage(), now: () => t });
  let changes = 0;
  const page = createVrBindingsPage({ store, now: () => t, onChange: () => changes++ });
  return { page, store, advance: (ms) => (t += ms), changes: () => changes };
}

const box = { W: 1024, margin: 40, top: 124, bottom: 848 };
const press = (btns, label) => {
  const b = btns.find((x) => x.label === label);
  assert.ok(b, `버튼 ${label}이 없다: ${btns.map((x) => x.label).join(", ")}`);
  return b.run();
};

test("화면: 줄을 누르면 지정 상태, 누른 버튼으로 배정, 손을 뗄 때까지 입력을 막는다", () => {
  const { page, store, advance } = makePage();
  let btns = page.layout(box);
  assert.deepEqual(btns.filter((b) => b.on).map((b) => b.label), ["모든 화면"]);
  assert.equal(btns.find((b) => b.label === "이전 파일").side, "X");
  press(btns, "이전 파일");
  assert.equal(page.capturing, "common.prev");
  assert.equal(page.inputBlocked, true);
  assert.match(page.message, /지정할 버튼을 누르세요/);
  btns = page.layout(box);
  assert.equal(btns.find((b) => b.label === "이전 파일").side, "누르세요…");
  assert.equal(btns.find((b) => b.label === "다음 파일(끝에서는 처음으로)").enabled, false, "지정 중에는 다른 줄을 못 누른다");
  // 길게 누르면 누르고 있는 동안 지정이 끝난다: 그 뒤 손을 뗄 때까지 입력을 막는다
  page.tick(input({ left: { grip: 1, gripPressed: true } }));
  advance(HOLD_MS);
  page.tick(input({ left: { grip: 1 } }));
  assert.equal(page.capturing, null);
  assert.equal(describeAction(store.get(), "common.prev"), "왼쪽 그립 길게");
  assert.equal(store.meta().source, "device", "저장은 기존 저장소 그대로(PC 동기화 대상)");
  page.tick(input({ left: { grip: 1 } }));
  assert.equal(page.inputBlocked, true, "아직 쥐고 있다");
  page.tick(input());
  assert.equal(page.inputBlocked, false);
});

test("화면: 충돌이면 경고 문구와 ⚠ 표시, 취소·지정 안 함·이 줄 기본값·모두 기본값", () => {
  const { page, store } = makePage();
  press(page.layout(box), "이전 파일");
  page.tick(input({ right: { primary: true, primaryPressed: true } }));
  page.tick(input());
  assert.match(page.message, /⚠ 파일 선택 화면 열기·닫기.*같은 입력/);
  assert.match(page.layout(box).find((b) => b.label === "이전 파일").side, /^⚠ A$/);
  // 취소
  press(page.layout(box), "다음 파일(끝에서는 처음으로)");
  press(page.layout(box), "취소");
  assert.equal(page.capturing, null);
  // 지정 안 함
  press(page.layout(box), "다음 파일(끝에서는 처음으로)");
  press(page.layout(box), "지정 안 함");
  assert.equal(store.get()["common.next"], null);
  // 이 줄 기본값
  press(page.layout(box), "다음 파일(끝에서는 처음으로)");
  press(page.layout(box), "이 줄 기본값");
  assert.equal(describeAction(store.get(), "common.next"), "X 길게");
  // UI 켜기·끄기는 '지정 안 함'이 없다
  press(page.layout(box), "UI 켜기·끄기(위치는 그대로)");
  assert.ok(!page.layout(box).some((b) => b.label === "지정 안 함"));
  press(page.layout(box), "취소");
  press(page.layout(box), "모두 기본값");
  assert.deepEqual(store.overrides(), {});
});

test("화면: 범위 탭과 축 지정(영상·사진 줌을 왼쪽 스틱 좌우로)", () => {
  const { page, store } = makePage();
  press(page.layout(box), "영상·사진");
  const rows = page.layout(box).filter((b) => b.side && !b.align);
  assert.equal(rows.length, 6);
  press(page.layout(box), "줌(위·오른쪽으로 밀면 확대)");
  assert.ok(!page.layout(box).some((b) => b.label.startsWith("양손")), "축 동작에는 양손 버튼이 없다");
  page.tick(input({ left: { x: 0.95 } }));
  assert.equal(describeAction(store.get(), "media.zoom"), "왼쪽 스틱 좌우");
  // 버튼은 양손으로
  press(page.layout(box), "화면을 지금 보는 방향 앞으로 맞추기");
  press(page.layout(box), "양손: 끔");
  page.tick(input()); // 스틱을 가운데로
  page.tick(input({ right: { stick: true, stickPressed: true } }));
  page.tick(input());
  assert.equal(describeAction(store.get(), "media.recenter"), "스틱 누르기(L3/R3)");
});

test("안전장치: UI 켜기·끄기를 바꾸면 10초 안에 새 버튼을 눌러 확인해야 하고, 아니면 되돌린다", () => {
  const { page, store, advance } = makePage();
  // 트리거로는 못 바꾼다(다시 받는다)
  press(page.layout(box), "UI 켜기·끄기(위치는 그대로)");
  page.tick(input({ right: { trigger: 1, triggerPressed: true } }), { right: false });
  page.tick(input(), { right: false });
  assert.equal(page.capturing, "common.uiToggle", "트리거는 거절하고 계속 받는다");
  assert.match(page.message, /둘 수 없습니다/);
  assert.equal(describeAction(store.get(), "common.uiToggle"), "B/Y");
  // 그립으로 바꾸고 확인하지 않으면 되돌림
  page.tick(input({ right: { grip: 1, gripPressed: true } }));
  page.tick(input());
  assert.equal(describeAction(store.get(), "common.uiToggle"), "양손 그립", "B/Y처럼 양손이던 것은 양손으로 받는다");
  assert.ok(page.confirming);
  assert.equal(page.inputBlocked, true, "확인 대기 중에는 새 버튼이 UI를 끄지 않게 막는다");
  assert.match(page.message, /한 번 눌러 확인/);
  advance(CONFIRM_MS + 1);
  page.tick(input());
  assert.equal(page.confirming, null);
  assert.equal(describeAction(store.get(), "common.uiToggle"), "B/Y");
  assert.match(page.message, /되돌렸습니다/);
  // 다시 바꾸고 이번엔 확인
  press(page.layout(box), "UI 켜기·끄기(위치는 그대로)");
  page.tick(input({ left: { primary: true, primaryPressed: true } }));
  page.tick(input());
  page.tick(input()); // 손을 뗐다
  page.tick(input({ left: { primary: true } })); // 새 버튼(X/A) 한 번
  assert.equal(page.confirming, null);
  assert.match(page.message, /확인했습니다/);
  advance(CONFIRM_MS + 1);
  page.tick(input());
  assert.equal(describeAction(store.get(), "common.uiToggle"), "X/A", "확인했으니 그대로");
});

test("화면을 떠나거나 VR 밖이 되면 지정을 취소한다", () => {
  const { page } = makePage();
  press(page.layout(box), "이전 파일");
  page.leave();
  assert.equal(page.capturing, null);
  press(page.layout(box), "이전 파일");
  page.tick(input({ presenting: false }));
  assert.equal(page.capturing, null);
});

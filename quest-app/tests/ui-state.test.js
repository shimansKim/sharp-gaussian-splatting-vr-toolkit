import test from "node:test";
import assert from "node:assert/strict";
import { Group, PerspectiveCamera } from "three";
import { createHoldTap, HOLD_MS } from "../src/core/input-map.js";
import { POSE_FRAMES, createUiState } from "../src/core/ui-state.js";
import { createUiControls } from "../src/ui/ui-controls.js";

function rig() {
  const events = [];
  const state = createUiState({ emit: (name, detail) => events.push([name, detail]) });
  const player = new Group();
  const camera = new PerspectiveCamera();
  player.add(camera);
  const look = (x, y, z, yaw = 0) => {
    camera.position.set(x, y, z);
    camera.rotation.set(0, yaw, 0);
    player.updateMatrixWorld(true);
  };
  return { state, events, player, camera, look };
}

const settle = (r, presenting = true) => {
  for (let i = 0; i < POSE_FRAMES; i++) r.state.tick(r.camera, presenting);
};

test("ui-state: 켜짐 상태는 바뀔 때만 이벤트를 낸다", () => {
  const r = rig();
  assert.equal(r.state.visible, true);
  r.state.setVisible(true);
  assert.equal(r.events.length, 0);
  r.state.toggle();
  assert.equal(r.state.visible, false);
  r.state.toggle();
  assert.deepEqual(
    r.events.map((e) => [e[0], e[1].visible]),
    [
      ["ui:visibility", false],
      ["ui:visibility", true],
    ],
  );
});

test("ui-state: 세션 시작 직후(자세 미수신)에는 앵커를 저장하지 않고, 자세가 들어온 뒤 한 번만 잡는다", () => {
  const r = rig();
  r.look(0, -5, 0, 2); // 아직 엉뚱한 자세(바닥·뒤쪽)
  r.state.tick(r.camera, true);
  r.state.tick(r.camera, true);
  assert.equal(r.state.hasAnchor, false);
  r.look(0, 1.6, 0, 0.5); // 자세가 들어옴
  r.state.tick(r.camera, true);
  assert.equal(r.state.hasAnchor, true);
  assert.deepEqual(r.events.filter((e) => e[0] === "ui:anchor"), [["ui:anchor", { reason: "session" }]]);
  const a = r.state.anchor;
  assert.ok(Math.abs(a.y - 1.6) < 1e-9);
  assert.ok(Math.abs(a.yaw - 0.5) < 1e-9);
});

test("ui-state: 앵커가 정해진 뒤에는 머리를 돌리거나 걸어도 reference가 그대로다", () => {
  const r = rig();
  r.look(0.2, 1.6, -0.3, 0.7);
  settle(r);
  const first = r.state.reference(r.camera);
  r.look(2, 1.4, 3, -2.5); // 머리를 돌리고 걸어감
  for (let i = 0; i < 100; i++) r.state.tick(r.camera, true);
  const later = r.state.reference(r.camera);
  assert.ok(first.head.distanceTo(later.head) < 1e-9);
  assert.ok(Math.abs(first.yaw - later.yaw) < 1e-9);
  assert.ok(Math.abs(first.yaw - 0.7) < 1e-9);
  assert.equal(r.events.filter((e) => e[0] === "ui:anchor").length, 1);
});

test("ui-state: 켜고 꺼도 앵커는 안 바뀌고, relocate만 앵커를 옮긴다(UI도 켠다)", () => {
  const r = rig();
  r.look(0, 1.6, 0, 0);
  settle(r);
  const before = r.state.reference(r.camera);
  r.state.setVisible(false);
  r.look(1, 1.6, 1, 1.2);
  r.state.setVisible(true);
  const same = r.state.reference(r.camera);
  assert.ok(before.head.distanceTo(same.head) < 1e-9);
  r.state.setVisible(false);
  r.state.relocate(r.camera);
  assert.equal(r.state.visible, true);
  const moved = r.state.reference(r.camera);
  assert.ok(moved.head.distanceTo(r.camera.position) < 1e-9);
  assert.ok(Math.abs(moved.yaw - 1.2) < 1e-9);
  assert.deepEqual(r.events.filter((e) => e[0] === "ui:anchor").pop(), ["ui:anchor", { reason: "relocate" }]);
});

test("ui-state: 앵커는 방(플레이어) 기준이라 플레이어가 움직이면 같이 옮겨지고, 머리와는 무관하다", () => {
  const r = rig();
  r.look(0, 1.6, 0, 0);
  settle(r);
  r.player.position.set(3, 0, 0); // 스틱으로 걸어감
  r.player.updateMatrixWorld(true);
  const ref = r.state.reference(r.camera);
  assert.ok(Math.abs(ref.head.x - 3) < 1e-9);
  r.player.rotation.y = Math.PI / 2; // 스냅 회전
  r.player.updateMatrixWorld(true);
  const turned = r.state.reference(r.camera);
  assert.ok(Math.abs(turned.yaw - Math.PI / 2) < 1e-9);
});

test("ui-state: resetForSession은 앵커를 비우고 UI를 켠다", () => {
  const r = rig();
  r.look(0, 1.6, 0, 0);
  settle(r);
  r.state.setVisible(false);
  r.state.resetForSession();
  assert.equal(r.state.hasAnchor, false);
  assert.equal(r.state.visible, true);
});

test("createHoldTap: 짧게 누르면 뗄 때 tap, 길게 누르면 HOLD_MS에 hold 한 번(뗄 때는 없음)", () => {
  let t = 1000;
  const tap = createHoldTap({ now: () => t });
  assert.equal(tap.update(false), null);
  assert.equal(tap.update(true), null);
  t += 200;
  assert.equal(tap.update(true), null);
  t += 50;
  assert.equal(tap.update(false), "tap");
  assert.equal(tap.update(false), null);
  // 길게
  t += 100;
  assert.equal(tap.update(true), null);
  t += HOLD_MS - 1;
  assert.equal(tap.update(true), null);
  t += 1;
  assert.equal(tap.update(true), "hold");
  t += 500;
  assert.equal(tap.update(true), null);
  assert.equal(tap.update(false), null);
});

function controls() {
  const r = rig();
  r.look(0, 1.6, 0, 0);
  settle(r);
  let t = 5000;
  const calls = { opened: 0, messages: [] };
  const panel = {
    isOpen: false,
    wantsOpen: false,
    open() {
      calls.opened++;
      panel.wantsOpen = true;
      panel.isOpen = r.state.visible;
    },
    showMessage: (m) => calls.messages.push(m),
  };
  // 패널이 UI 켜짐 상태를 따르는 것까지 흉내 낸다(실제 vr-panel: 보임 = 열림 && ui.visible)
  const view = { hasUi: false };
  const c = createUiControls({
    ui: r.state,
    camera: r.camera,
    panel: {
      get isOpen() {
        return panel.wantsOpen && r.state.visible;
      },
      get wantsOpen() {
        return panel.wantsOpen;
      },
      open: panel.open,
      showMessage: panel.showMessage,
    },
    viewerHasUi: () => view.hasUi && r.state.visible,
    holdTap: createHoldTap({ now: () => t }),
  });
  const press = (down, advance = 0) => {
    t += advance;
    return c.update({ presenting: true, left: { secondary: false }, right: { secondary: down } });
  };
  const tapOnce = () => {
    press(true);
    press(true, 100);
    return press(false, 10);
  };
  return { r, calls, view, press, tapOnce, advance: (ms) => (t += ms), c };
}

test("ui-controls: UI가 보이는 중 B/Y 짧게 = 전부 끄기, 한 번 더 = 켜기, 그동안 앵커 불변", () => {
  const k = controls();
  k.view.hasUi = true; // 미디어 재생 컨트롤이 보임
  const anchor = k.r.state.anchor;
  assert.equal(k.tapOnce(), "toggle");
  assert.equal(k.r.state.visible, false);
  k.r.look(5, 1.6, 5, 2); // 꺼진 동안 머리를 돌려도
  assert.equal(k.tapOnce(), "toggle");
  assert.equal(k.r.state.visible, true);
  assert.equal(k.calls.opened, 0); // 뷰어 UI가 돌아왔으니 패널은 안 연다
  assert.deepEqual(k.r.state.anchor, anchor);
});

test("ui-controls: 켜져 있어도 보이는 게 없으면 B/Y 짧게 = 패널 열기(빈 화면에서 목록 부르기)", () => {
  const k = controls();
  assert.equal(k.tapOnce(), "toggle");
  assert.equal(k.calls.opened, 1);
  assert.equal(k.r.state.visible, true);
  // 패널이 보이는 중에 B/Y → 끄기
  assert.equal(k.tapOnce(), "toggle");
  assert.equal(k.r.state.visible, false);
  // 다시 → 패널 상태를 유지한 채 켜기(다시 열 필요 없음)
  assert.equal(k.tapOnce(), "toggle");
  assert.equal(k.r.state.visible, true);
  assert.equal(k.calls.opened, 1);
});

test("ui-controls: B/Y 길게 = 앵커를 지금 시선으로 옮기고 UI를 켠다(켜고 끄기는 일어나지 않는다)", () => {
  const k = controls();
  k.r.state.setVisible(false);
  k.r.look(1, 1.5, -2, 0.9);
  k.press(true);
  k.advance(HOLD_MS);
  assert.equal(k.press(true), "relocate");
  assert.equal(k.r.state.visible, true);
  assert.ok(Math.abs(k.r.state.anchor.yaw - 0.9) < 1e-9);
  assert.equal(k.calls.opened, 1);
  assert.equal(k.press(false, 10), null); // 떼도 tap이 나오지 않는다
  assert.equal(k.r.state.visible, true);
});

test("ui-controls: VR 밖이거나 B/Y 안 누르면 아무 일도 없다", () => {
  const k = controls();
  assert.equal(k.press(false), null);
  assert.equal(k.c.update({ presenting: false, left: { secondary: true }, right: { secondary: true } }), null);
  assert.equal(k.r.state.visible, true);
});

test("ui-state: 공용 패널이 열려 있는지 한 곳에서 알려 주고(한 번에 한 창), 세션이 바뀌면 닫힌 상태로 돌아간다", () => {
  const r = rig();
  assert.equal(r.state.panelOpen, false);
  r.state.setPanelOpen(true);
  assert.equal(r.state.panelOpen, true);
  r.state.resetForSession();
  assert.equal(r.state.panelOpen, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createFlick, commonActions } from "../src/core/input-map.js";
import { createNavHistory } from "../src/core/nav-history.js";

/** 브라우저 기록을 흉내 낸 가짜 window. back()은 비동기로 popstate를 낸다(실제와 같다). */
function fakeWindow() {
  const entries = [{ state: null }];
  let index = 0;
  const handlers = [];
  let backs = 0;
  const win = {
    history: {
      get state() {
        return entries[index].state;
      },
      pushState(state) {
        entries.splice(index + 1);
        entries.push({ state });
        index++;
      },
      replaceState(state) {
        entries[index].state = state;
      },
      back() {
        if (index === 0) {
          backs++; // 더 갈 곳이 없다 = 앱 종료
          return;
        }
        index--;
        queueMicrotask(() => handlers.forEach((fn) => fn({ state: entries[index].state })));
      },
    },
    addEventListener(name, fn) {
      if (name === "popstate") handlers.push(fn);
    },
  };
  return { win, entries, get index() { return index; }, get exited() { return backs; } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const fake = fakeWindow();
  const state = { vr: false, item: false, folder: "" };
  const calls = [];
  const nav = createNavHistory({
    win: fake.win,
    layers: () => [state.vr && "vr", state.item && "viewer", state.folder && "folder"].filter(Boolean),
    pop: {
      vr: () => {
        calls.push("exitVR");
        state.vr = false;
      },
      viewer: () => {
        calls.push("close");
        state.item = false;
      },
      folder: () => {
        calls.push("up");
        state.folder = "";
      },
    },
  });
  /** 사용자가 뒤로 가기를 누른다(앱이 끝나면 exited가 오른다). */
  const back = async () => {
    fake.win.history.back();
    await tick();
  };
  return { fake, state, calls, nav, back };
}

test("목록 최상위에서는 가드가 없고, 뒤로 가기는 앱을 끝낸다", async () => {
  const { fake, back } = setup();
  await back();
  assert.equal(fake.exited, 1);
  assert.equal(fake.index, 0);
});

test("항목을 보는 중 뒤로 가기: 목록으로 돌아가고 앱은 안 꺼진다, 한 번 더 누르면 끝난다", async () => {
  const { fake, state, calls, nav, back } = setup();
  state.item = true;
  nav.sync();
  assert.equal(fake.index, 1);
  await back();
  assert.deepEqual(calls, ["close"]);
  assert.equal(fake.exited, 0);
  assert.equal(nav.guarded, false);
  assert.equal(fake.index, 0);
  await back();
  assert.equal(fake.exited, 1);
});

test("VR + 항목 + 폴더: 뒤로 가기마다 VR 종료 → 목록으로 → 상위 폴더 순으로 한 단계씩", async () => {
  const { fake, state, calls, nav, back } = setup();
  state.folder = "outputs";
  nav.sync();
  state.item = true;
  nav.sync();
  state.vr = true;
  nav.sync();
  assert.equal(fake.index, 1, "가드는 한 칸만 쌓인다");
  await back();
  assert.deepEqual(calls, ["exitVR"]);
  await back();
  assert.deepEqual(calls, ["exitVR", "close"]);
  await back();
  assert.deepEqual(calls, ["exitVR", "close", "up"]);
  assert.equal(fake.exited, 0);
  await back();
  assert.equal(fake.exited, 1);
});

test("앱 안에서 단계가 모두 사라지면(목록 버튼으로 닫기) 가드를 치워 첫 뒤로 가기에 끝난다", async () => {
  const { fake, state, nav, back } = setup();
  state.item = true;
  nav.sync();
  state.item = false; // 2D 목록에서 닫음
  nav.sync();
  await tick();
  assert.equal(fake.index, 0);
  assert.equal(nav.guarded, false);
  await back();
  assert.equal(fake.exited, 1);
});

test("가드를 치우는 중에 새 항목이 열려도 기록이 어긋나지 않는다", async () => {
  const { fake, state, calls, nav, back } = setup();
  state.item = true;
  nav.sync();
  state.item = false;
  nav.sync(); // back() 진행 중
  state.item = true;
  nav.sync(); // 아직 popstate 전: 보류
  await tick();
  assert.equal(nav.guarded, true);
  assert.equal(fake.index, 1);
  await back();
  assert.deepEqual(calls, ["close"]);
});

test("VR을 시스템이 끝냈을 때(앱이 먼저 상태를 바꿈)도 가드가 정리된다", async () => {
  const { fake, state, nav, back } = setup();
  state.vr = true;
  nav.sync();
  state.vr = false;
  nav.sync();
  await tick();
  assert.equal(fake.index, 0);
  await back();
  assert.equal(fake.exited, 1);
});

test("commonActions: X 이전, A 다음, B/Y 패널. VR 밖에서는 없다", () => {
  const hand = (extra = {}) => ({ primaryPressed: false, secondaryPressed: false, ...extra });
  assert.deepEqual(commonActions({ presenting: true, left: hand({ primaryPressed: true }), right: hand({ primaryPressed: true }) }), ["prev", "next"]);
  assert.deepEqual(commonActions({ presenting: true, left: hand(), right: hand({ secondaryPressed: true }) }), ["panel"]);
  assert.deepEqual(commonActions({ presenting: false, left: hand({ primaryPressed: true }), right: hand() }), []);
});

test("createFlick: 한 번 밀면 한 번, 중립으로 돌아와야 다시", () => {
  const flick = createFlick({ cooldown: 0.1 });
  assert.equal(flick.update(0.9, 0.016), 1);
  assert.equal(flick.update(0.9, 0.016), 0, "누르고 있어도 반복하지 않는다");
  assert.equal(flick.update(0.1, 0.2), 0);
  assert.equal(flick.update(-0.9, 0.016), -1);
  assert.equal(flick.update(0.5, 0.016), 0, "임계값 아래는 무시");
});

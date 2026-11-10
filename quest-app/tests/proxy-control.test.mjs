// 서비스 워커 제어를 기다리는 ensureProxyControl 테스트 (첫 실행 직후 혼합 콘텐츠 방지).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ensureProxyControl } from "../src/sources/proxy-url.js";

/** 최소한의 ServiceWorkerContainer 흉내. */
function fakeContainer({ controller = null, registration = {} } = {}) {
  const listeners = new Set();
  const container = {
    controller,
    ready: new Promise(() => {}), // 활성화 신호는 테스트가 controllerchange로 직접 보낸다
    getRegistration: async () => registration,
    addEventListener: (type, fn) => type === "controllerchange" && listeners.add(fn),
    removeEventListener: (type, fn) => type === "controllerchange" && listeners.delete(fn),
    take() {
      container.controller = {};
      for (const fn of [...listeners]) fn();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
  return container;
}

describe("ensureProxyControl", () => {
  test("이미 제어 중이면 기다리지 않는다", async () => {
    assert.equal(await ensureProxyControl(1000, fakeContainer({ controller: {} })), true);
  });

  test("서비스 워커를 지원하지 않거나 등록이 없으면 곧바로 false", async () => {
    const t0 = Date.now();
    assert.equal(await ensureProxyControl(1000, undefined), false);
    assert.equal(await ensureProxyControl(1000, fakeContainer({ registration: null })), false);
    assert.ok(Date.now() - t0 < 500);
  });

  test("등록은 됐지만 아직 제어 전이면 제어가 시작될 때까지 기다린다", async () => {
    const sw = fakeContainer();
    setTimeout(() => sw.take(), 30);
    assert.equal(await ensureProxyControl(2000, sw), true);
    assert.equal(sw.listenerCount, 0); // 듣던 것을 정리한다
  });

  test("끝내 제어가 오지 않으면 제한 시간 뒤 false", async () => {
    const sw = fakeContainer();
    const t0 = Date.now();
    assert.equal(await ensureProxyControl(40, sw), false);
    assert.ok(Date.now() - t0 >= 30);
    assert.equal(sw.listenerCount, 0);
  });
});

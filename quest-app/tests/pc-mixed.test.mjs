// https 앱 → http LAN 요청이 혼합 콘텐츠로 막힌 브라우저(이슈 #13)를 알아보고 따로 안내하는지 확인한다.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPcConnection, describeFailure, detectMixedContentBlock, isLoopbackBase } from "../src/sources/pc-connect.js";

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { get: (k) => data[k] ?? null, set: (k, v) => (v == null ? delete data[k] : (data[k] = v)), data };
};
const failNow = async () => {
  throw new TypeError("Failed to fetch");
};
const hangUntilAbort = (url, { signal }) =>
  new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));

describe("detectMixedContentBlock", () => {
  test("https 페이지에서 문서용 주소로 보낸 http 요청이 곧바로 실패하면 차단으로 본다", async () => {
    assert.equal(await detectMixedContentBlock({ protocol: "https:", fetch: failNow }), true);
  });

  test("요청이 실제로 나가 오래 기다리는 브라우저는 차단이 아니다", async () => {
    assert.equal(await detectMixedContentBlock({ protocol: "https:", fetch: hangUntilAbort, waitMs: 20 }), false);
  });

  test("느리게 실패해도(네트워크까지 나갔다) 차단이 아니다", async () => {
    const slowFail = async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      throw new TypeError("Failed to fetch");
    };
    assert.equal(await detectMixedContentBlock({ protocol: "https:", fetch: slowFail, waitMs: 20 }), false);
  });

  test("페이지가 http이면 혼합 콘텐츠가 없다", async () => {
    assert.equal(await detectMixedContentBlock({ protocol: "http:", fetch: failNow }), false);
  });

  test("loopback 주소는 혼합 콘텐츠 예외다", () => {
    for (const base of ["http://127.0.0.1:8787", "http://localhost:8787", "http://[::1]:8787"]) assert.equal(isLoopbackBase(base), true, base);
    for (const base of ["http://192.168.50.149:8787", "http://sharp-vr.local:8787", "https://pc.example"]) assert.equal(isLoopbackBase(base), false, base);
  });
});

describe("pc-connect 혼합 콘텐츠 분기", () => {
  test("막힌 브라우저에서 LAN http 주소가 모두 실패하면 mixed-content로 분류하고 탐색하지 않는다", async () => {
    const calls = [];
    const conn = createPcConnection({
      storage: memoryStorage({ "sharp.pc.lastBase": "http://192.168.50.149:8787" }),
      permissionState: async () => "granted",
      mixedContentProbe: async () => true,
      fetch: async (url) => (calls.push(url), failNow()),
    });
    const state = await conn.connect();
    assert.equal(state.status, "failed");
    assert.equal(state.reason, "mixed-content");
    assert.equal(calls.length, 2); // 마지막 주소 + sharp-vr.local만. 대역 탐색은 하지 않는다
    const { title, steps } = describeFailure(state);
    assert.match(title, /막고 있습니다/);
    assert.match(steps.join("\n"), /혼합 콘텐츠/);
    assert.doesNotMatch(steps.join("\n"), /방화벽 창이 뜹니다/); // 방화벽 안내로 오해하게 두지 않는다
  });

  test("막히지 않은 브라우저에서는 기존처럼 unreachable과 방화벽 안내를 준다", async () => {
    const conn = createPcConnection({
      storage: memoryStorage(),
      permissionState: async () => "granted",
      mixedContentProbe: async () => false,
      fetch: failNow,
      scan: false,
    });
    const state = await conn.connect();
    assert.equal(state.reason, "unreachable");
    assert.match(describeFailure(state).steps.join("\n"), /개인 네트워크/);
  });

  test("loopback 주소만 실패한 경우는 혼합 콘텐츠 탓이 아니다", async () => {
    const conn = createPcConnection({
      storage: memoryStorage({ "sharp.pc.lastBase": "http://127.0.0.1:8787", "sharp.pc.manualBase": "http://127.0.0.1:8787" }),
      mixedContentProbe: async () => true,
      permissionState: async () => "granted",
      mdnsHost: "127.0.0.1",
      fetch: failNow,
      scan: false,
    });
    const state = await conn.connect();
    assert.equal(state.reason, "unreachable");
  });

  test("막힌 브라우저에서도 https 터널 주소는 시도해 연결된다", async () => {
    const info = { app: "sharp-quest-server", version: 1, roots: [] };
    const conn = createPcConnection({
      storage: memoryStorage({ "sharp.pc.manualBase": "https://my-tunnel.trycloudflare.com" }),
      permissionState: async () => "granted",
      mixedContentProbe: async () => true,
      fetch: async (url) => {
        if (url.startsWith("https://my-tunnel")) return new Response(JSON.stringify(info), { status: 200, headers: { "Content-Type": "application/json" } });
        throw new TypeError("Failed to fetch");
      },
    });
    const state = await conn.connect();
    assert.equal(state.status, "connected");
    assert.equal(state.via, "manual");
  });
});

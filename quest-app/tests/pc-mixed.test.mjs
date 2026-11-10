// https 앱 → http LAN 요청이 혼합 콘텐츠로 막힌 브라우저(이슈 #13)를 알아보고 따로 안내하는지 확인한다.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPcConnection, describeFailure, detectMixedContentBlock, isLoopbackBase } from "../src/sources/pc-connect.js";
import { createLedger } from "../src/sources/pc-scan.js";

const looseLedger = () => createLedger({ budget: 1_000_000 });

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
  test("https 페이지에서 사설 주소 8개로 보낸 http 요청이 모두 곧바로 실패하면 차단으로 본다", async () => {
    assert.equal(await detectMixedContentBlock({ protocol: "https:", fetch: failNow }), true);
  });

  test("실제 탐색과 같은 옵션(http 사설 주소, targetAddressSpace: local)으로 서로 다른 8개에 보낸다", async () => {
    const seen = [];
    await detectMixedContentBlock({
      protocol: "https:",
      fetch: async (url, init) => {
        seen.push({ url, space: init.targetAddressSpace });
        throw new TypeError("Failed to fetch");
      },
    });
    assert.equal(seen.length, 8);
    assert.equal(new Set(seen.map((s) => s.url)).size, 8);
    for (const { url, space } of seen) {
      assert.match(url, /^http:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/, url); // 공인(문서용) 주소가 아니다
      assert.equal(space, "local");
    }
  });

  test("사설 주소는 허용하고 공인 주소만 막는 브라우저(Quest)는 요청이 실제로 나가므로 차단으로 보지 않는다", async () => {
    // 사설 주소로 간 요청은 응답 없이 기다린다. 공인 주소(192.0.2.1 등)로 가는 요청만 즉시 실패한다.
    const questLike = (url, init) => (/^http:\/\/(10|192\.168|172\.)/.test(url) ? hangUntilAbort(url, init) : failNow());
    assert.equal(await detectMixedContentBlock({ protocol: "https:", fetch: questLike, waitMs: 20 }), false);
  });

  test("한 주소라도 오래 기다리면(네트워크까지 나갔다) 차단이 아니다", async () => {
    let n = 0;
    const mostlyInstant = (url, init) => (n++ === 3 ? hangUntilAbort(url, init) : failNow());
    assert.equal(await detectMixedContentBlock({ protocol: "https:", fetch: mostlyInstant, waitMs: 20 }), false);
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
  test("막힌 브라우저에서도 탐색은 그대로 하고, 못 찾은 뒤에만 mixed-content 안내를 고른다", async () => {
    const calls = [];
    const conn = createPcConnection({
      storage: memoryStorage({ "sharp.pc.lastBase": "http://192.168.50.149:8787" }),
      permissionState: async () => "granted",
      mixedContentProbe: async () => true,
      scan: { primary: ["192.168.0"], secondary: [], ledger: looseLedger() },
      fetch: async (url) => (calls.push(url), failNow()),
    });
    const state = await conn.connect();
    assert.equal(state.status, "failed");
    assert.equal(state.reason, "mixed-content");
    assert.ok(calls.length > 100, "판정 결과로 탐색을 건너뛰지 않는다"); // 마지막 주소 + 이름 + 대역 254개
    assert.ok(state.attempts.some((a) => a.via === "scan"));
    const { title, steps } = describeFailure(state);
    assert.match(title, /막고 있습니다/);
    assert.match(steps.join("\n"), /혼합 콘텐츠/);
    assert.doesNotMatch(steps.join("\n"), /방화벽 창이 뜹니다/); // 방화벽 안내로 오해하게 두지 않는다
  });

  test("판정이 차단이라고 해도(오탐) 탐색이 서버를 찾으면 그대로 연결한다", async () => {
    const info = { app: "sharp-quest-server", version: 1, roots: [] };
    const conn = createPcConnection({
      storage: memoryStorage(),
      permissionState: async () => "granted",
      mixedContentProbe: async () => true, // Quest처럼 사설 주소는 허용되는데 판정이 잘못 나온 경우
      scan: { primary: ["192.168.50"], secondary: [], ledger: looseLedger() },
      fetch: async (url) => {
        if (url.startsWith("http://192.168.50.149:8787")) return new Response(JSON.stringify(info), { status: 200, headers: { "Content-Type": "application/json" } });
        throw new TypeError("Failed to fetch");
      },
    });
    const state = await conn.connect();
    assert.equal(state.status, "connected");
    assert.equal(state.via, "scan");
    assert.equal(state.reason, null);
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

// PC 연결·소스·서비스 워커 프록시 테스트. 실행: node --test quest-app/tests/
// 통합 테스트는 실제 scripts/quest_media_server.py를 띄운다. Python 경로는 환경 변수 QUEST_TEST_PYTHON(기본 python).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createPcConnection, describeFailure, lnaInit, normalizeBase } from "../src/sources/pc-connect.js";
import { createPcSource } from "../src/sources/pc-source.js";
import { encodePath, proxyUrl } from "../src/sources/proxy-url.js";

const here = dirname(fileURLToPath(import.meta.url));
// 서비스 워커용 클래식 스크립트는 package.json의 type과 무관하게 전역에서 실행해 불러온다.
globalThis.self = globalThis;
globalThis.registration = { scope: "https://shimanskim.github.io/repo/" };
globalThis.location = new URL("https://shimanskim.github.io/repo/sw.js");
vm.runInThisContext(readFileSync(join(here, "..", "public", "sw", "source-proxy.js"), "utf8"));
const proxyModule = globalThis.sharpSourceProxy;

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { get: (k) => data[k] ?? null, set: (k, v) => (v == null ? delete data[k] : (data[k] = v)), data };
};
const okInfo = { app: "sharp-quest-server", version: 1, roots: [{ id: "demo", label: "demo" }] };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("normalizeBase", () => {
  test("host만 넣으면 기본 포트를 붙인다", () => {
    assert.equal(normalizeBase("192.168.0.5"), "http://192.168.0.5:8787");
    assert.equal(normalizeBase("http://pc.local:9000/"), "http://pc.local:9000");
    assert.equal(normalizeBase("  "), null);
    assert.equal(normalizeBase("ftp://x"), null);
  });
});

describe("pc-connect", () => {
  test("마지막 주소가 되면 mDNS는 시도하지 않는다", async () => {
    const calls = [];
    const storage = memoryStorage({ "sharp.pc.lastBase": "http://192.168.0.23:8787" });
    const conn = createPcConnection({
      storage,
      permissionState: async () => "granted",
      fetch: async (url) => (calls.push(url), jsonResponse(okInfo)),
    });
    const state = await conn.connect();
    assert.equal(state.status, "connected");
    assert.equal(state.via, "last");
    assert.deepEqual(calls, ["http://192.168.0.23:8787/api/info"]);
  });

  test("마지막 주소가 실패하면 sharp-vr.local로 넘어가고 성공 주소를 기억한다", async () => {
    const storage = memoryStorage({ "sharp.pc.lastBase": "http://192.168.0.23:8787" });
    const conn = createPcConnection({
      storage,
      permissionState: async () => "granted",
      fetch: async (url) => {
        if (url.includes("sharp-vr.local")) return jsonResponse(okInfo);
        throw new TypeError("Failed to fetch");
      },
    });
    const state = await conn.connect();
    assert.equal(state.via, "mdns");
    assert.equal(storage.data["sharp.pc.lastBase"], "http://sharp-vr.local:8787");
    assert.equal(state.attempts.length, 1);
  });

  test("모두 실패하면 failed와 한국어 안내(방화벽·네트워크 프로필)를 준다", async () => {
    const conn = createPcConnection({
      storage: memoryStorage(),
      permissionState: async () => "granted",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const state = await conn.connect();
    assert.equal(state.status, "failed");
    assert.equal(state.reason, "unreachable");
    const text = describeFailure(state).steps.join("\n");
    assert.match(text, /개인 네트워크/);
    assert.match(text, /네트워크 프로필이 '개인'/);
    assert.match(text, /run_quest_pc_server\.bat/);
  });

  test("다른 서버가 응답하면 wrong-server, 권한 거부면 denied로 분류한다", async () => {
    const wrong = createPcConnection({
      storage: memoryStorage(),
      permissionState: async () => "granted",
      fetch: async () => jsonResponse({ app: "other" }),
    });
    assert.equal((await wrong.connect()).reason, "wrong-server");
    const denied = createPcConnection({
      storage: memoryStorage(),
      permissionState: async () => "denied",
      fetch: async () => {
        throw new TypeError("blocked");
      },
    });
    assert.equal((await denied.connect()).reason, "denied");
  });

  test("권한 창이 필요한 첫 연결은 긴 제한 시간, 권한이 있으면 짧은 제한 시간을 쓴다", async () => {
    const seen = [];
    const hang = (url, { signal }) =>
      new Promise((_, reject) => {
        seen.push(url);
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const t0 = Date.now();
    const conn = createPcConnection({ storage: memoryStorage(), permissionState: async () => "granted", quickTimeoutMs: 30, fetch: hang });
    const state = await conn.connect();
    assert.equal(state.status, "failed");
    assert.ok(Date.now() - t0 < 1000);
    assert.equal(state.attempts[0].error, "시간 초과");
  });

  test("동시에 connect()를 불러도 한 번만 시도한다", async () => {
    let n = 0;
    const conn = createPcConnection({
      storage: memoryStorage(),
      permissionState: async () => "granted",
      fetch: async () => (n++, jsonResponse(okInfo)),
    });
    await Promise.all([conn.connect(), conn.connect()]);
    assert.equal(n, 1);
  });

  test("subscribe는 상태 변화를 알리고, hasLastBase는 기억한 주소를 보고한다", async () => {
    const seen = [];
    const conn = createPcConnection({
      storage: memoryStorage(),
      permissionState: async () => "granted",
      fetch: async () => jsonResponse(okInfo),
    });
    const stop = conn.subscribe((s) => seen.push(s.status));
    assert.equal(conn.hasLastBase(), false);
    await conn.connect();
    assert.deepEqual(seen, ["connecting", "connected"]);
    assert.equal(conn.hasLastBase(), true);
    stop();
    conn.markLost();
    assert.deepEqual(seen, ["connecting", "connected"]);
  });

  test("수동 주소는 마지막 후보 뒤에 시도한다", async () => {
    const calls = [];
    const conn = createPcConnection({
      storage: memoryStorage(),
      permissionState: async () => "granted",
      fetch: async (url) => {
        calls.push(url);
        if (url.startsWith("http://10.0.0.9")) return jsonResponse(okInfo);
        throw new TypeError("x");
      },
    });
    assert.equal(conn.setManualBase("10.0.0.9"), true);
    assert.equal(conn.setManualBase("ftp://bad"), false);
    const state = await conn.connect();
    assert.equal(state.via, "manual");
    assert.deepEqual(calls, ["http://sharp-vr.local:8787/api/info", "http://10.0.0.9:8787/api/info"]);
  });
});

describe("proxy-url", () => {
  test("경로 조각을 인코딩하고 슬래시를 유지한다", () => {
    assert.equal(encodePath("outputs/VR 영상/a b.mp4"), "outputs/VR%20%EC%98%81%EC%83%81/a%20b.mp4");
    assert.equal(proxyUrl("pc", "outputs/a#1.ply", "/repo/"), "/repo/__src/pc/outputs/a%231.ply");
  });
});

describe("sw source-proxy", () => {
  const PC = proxyModule._pcBaseRe;
  test("normalizeBase가 만드는 주소는 모두 허용하고 경로·계정이 붙은 것은 거절한다", () => {
    const typed = ["sharp-vr.local", "192.168.0.2", "10.1.2.3:8787", "http://172.30.1.5:8787", "localhost", "MYPC.local", "100.101.102.103", "https://my-tunnel.trycloudflare.com", "[::1]:8787", "http://desktop-abc.local:9000"];
    for (const text of typed) {
      const base = normalizeBase(text);
      assert.ok(base, text);
      assert.ok(PC.test(base), `${text} -> ${base}`); // 목록은 뜨는데 열기만 503이 되는 주소가 없어야 한다
    }
    for (const bad of ["http://192.168.0.2:8787/x", "http://user:pw@192.168.0.2:8787", "http://192.168.0.2:8787?a=1", "ftp://192.168.0.2", "http://", "http://bad host", "//192.168.0.2"]) assert.ok(!PC.test(bad), bad);
  });

  test("LNA 표시는 http 주소에만 붙는다", () => {
    assert.equal(lnaInit("http://192.168.0.2:8787", { cache: "no-store" }).targetAddressSpace, "local");
    assert.equal(lnaInit("https://my-tunnel.trycloudflare.com").targetAddressSpace, undefined);
  });

  test("Range 요청을 PC 서버 /files 로 중계하고 206 헤더를 돌려준다", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    const cacheStore = new Map();
    globalThis.caches = {
      open: async () => ({
        put: async (k, v) => cacheStore.set(k, v),
        match: async (k) => cacheStore.get(k)?.clone(),
      }),
    };
    globalThis.fetch = async (url, init) => {
      calls.push({ url, range: init.headers.get("Range"), init });
      return new Response("0123456789".slice(2, 6), { status: 206, headers: { "Content-Range": "bytes 2-5/10", "Content-Length": "4", "Content-Type": "video/mp4", "Access-Control-Allow-Origin": "x" } });
    };
    try {
      const sent = [];
      const configEvent = { data: { type: "sharp-src-config", sourceId: "pc", config: { base: "http://sharp-vr.local:8787" } }, ports: [{ postMessage: (m) => sent.push(m) }], waitUntil() {} };
      assert.equal(proxyModule.onMessage(configEvent), true);
      await new Promise((r) => setTimeout(r, 10));
      assert.deepEqual(sent, [{ ok: true }]);

      let responded;
      const event = {
        request: new Request("https://shimanskim.github.io/repo/__src/pc/outputs/VR/a%20b.mp4", { headers: { Range: "bytes=2-5" } }),
        respondWith: (p) => (responded = p),
      };
      assert.equal(proxyModule.onFetch(event), true);
      const response = await responded;
      assert.equal(calls[0].url, "http://sharp-vr.local:8787/files/outputs/VR/a%20b.mp4");
      assert.equal(calls[0].range, "bytes=2-5");
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10");
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
      assert.equal(await response.text(), "2345");

      // 프록시 대상이 아닌 요청은 건드리지 않는다
      assert.equal(proxyModule.onFetch({ request: new Request("https://shimanskim.github.io/repo/assets/app.js"), respondWith() { throw new Error("no"); } }), false);

      // 설정이 주소 모양(http(s)://호스트[:포트])이 아니면 원본에 요청하지 않는다
      proxyModule.onMessage({ data: { type: "sharp-src-config", sourceId: "pc", config: { base: "http://user:pw@192.168.0.2:8787/x" } }, ports: [], waitUntil() {} });
      await new Promise((r) => setTimeout(r, 10));
      calls.length = 0;
      const blocked = { request: new Request("https://shimanskim.github.io/repo/__src/pc/outputs/a.ply"), respondWith: (p) => (responded = p) };
      proxyModule.onFetch(blocked);
      assert.equal((await responded).status, 503);
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("통합: 실제 quest_media_server.py", () => {
  const port = 18787 + Math.floor(Math.random() * 500);
  const dir = mkdtempSync(join(tmpdir(), "quest-it-"));
  let child;

  before(async () => {
    mkdirSync(join(dir, "VR"));
    writeFileSync(join(dir, "VR", "clip.mp4"), Buffer.alloc(5000, 7));
    writeFileSync(join(dir, "scene one.ply"), Buffer.from("ply\nformat binary_little_endian 1.0\nend_header\n"));
    writeFileSync(join(dir, "skip.txt"), "x");
    const script = join(here, "..", "..", "scripts", "quest_media_server.py");
    child = spawn(process.env.QUEST_TEST_PYTHON ?? "python", [script, dir, "--port", String(port), "--no-mdns", "--no-remember"], { stdio: "ignore", env: { ...process.env, PYTHONUTF8: "1" } });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/info`)).ok) return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("서버가 뜨지 않았습니다");
  });

  after(() => {
    child?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  const makeSource = () =>
    createPcSource({
      connection: createPcConnection({
        storage: memoryStorage({ "sharp.pc.lastBase": `http://127.0.0.1:${port}` }),
        permissionState: async () => "granted",
      }),
    });

  test("최상위 list는 루트 목록과 최신 미디어를 준다", async () => {
    const source = makeSource();
    const { items, dirs } = await source.list();
    const rootId = dirs.find((d) => d.startsWith("quest-it-"));
    assert.ok(rootId, `dirs=${dirs}`);
    assert.deepEqual(items.map((i) => i.name).sort(), ["clip.mp4", "scene one.ply"]);
    const ply = items.find((i) => i.kind === "splat");
    assert.equal(ply.sourceId, "pc");
    assert.equal(ply.id, `pc:${rootId}/scene one.ply`);
  });

  test("하위 폴더 탐색과 열기(스트림, Range)", async () => {
    const source = makeSource();
    const { dirs } = await source.list();
    const rootId = dirs.find((d) => d.startsWith("quest-it-"));
    const top = await source.list(rootId);
    assert.deepEqual(top.dirs, [`${rootId}/VR`]);
    assert.deepEqual(top.items.map((i) => i.name), ["scene one.ply"]);
    const sub = await source.list(`${rootId}/VR`);
    assert.equal(sub.items[0].kind, "video");

    const opened = await source.open(top.items[0]);
    assert.match(opened.url, /\/files\/quest-it-[^/]+\/scene%20one\.ply$/);
    const stream = await opened.stream();
    const text = await new Response(stream).text();
    assert.ok(text.startsWith("ply\n"));

    const video = await source.open(sub.items[0]);
    const partial = await fetch(video.url, { headers: { Range: "bytes=10-19" } });
    assert.equal(partial.status, 206);
    assert.equal((await partial.arrayBuffer()).byteLength, 10);
  });

  test("recent(kind)는 종류별로 거른다", async () => {
    const splats = await makeSource().recent("splat");
    assert.deepEqual(splats.map((i) => i.kind), ["splat"]);
  });
});

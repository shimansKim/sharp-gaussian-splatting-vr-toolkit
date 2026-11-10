// PC 서버 자동 탐색(pc-scan.js + pc-connect.js의 탐색 단계) 테스트. 실제 네트워크는 쓰지 않고 가짜 LAN으로 확인한다.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPcConnection, describeFailure, describeVia } from "../src/sources/pc-connect.js";
import { PRIMARY_PREFIXES, SECONDARY_PREFIXES, buildScanPlan, createLedger, hostsFor, ipv4Prefix, isPrefix, scanPrefixes } from "../src/sources/pc-scan.js";

const okInfo = { app: "sharp-quest-server", version: 1, host: "DESKTOP", roots: [{ id: "outputs", label: "outputs" }] };
const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { get: (k) => data[k] ?? null, set: (k, v) => (v == null ? delete data[k] : (data[k] = v)), data };
};
/** 테스트마다 새 장부. 예산을 크게 줘서 속도 조절이 시간을 늘리지 않게 한다(조절 자체는 따로 시험한다). */
const looseLedger = () => createLedger({ budget: 1_000_000 });

/**
 * 가짜 LAN. servers[주소 앞부분] = 응답 본문. 그 밖의 주소는 hang이면 중단될 때까지 응답이 없고,
 * 아니면 곧바로 실패한다. sharp-vr.local은 항상 이름 해석 실패다(Quest에서 보이는 증상).
 */
function fakeLan({ servers = {}, hang = false } = {}) {
  const calls = [];
  let inflight = 0;
  let maxInflight = 0;
  const fetch = async (url, init = {}) => {
    calls.push({ url, signal: init.signal });
    if (url.includes("sharp-vr.local")) throw new TypeError("Failed to fetch");
    const hit = Object.keys(servers).find((prefix) => url.startsWith(prefix));
    if (hit) return jsonResponse(servers[hit]);
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    try {
      if (!hang) throw new TypeError("Failed to fetch");
      await new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    } finally {
      inflight -= 1;
    }
  };
  return { fetch, calls, get maxInflight() { return maxInflight; } };
}

const baseOptions = (extra = {}) => ({ storage: memoryStorage(), permissionState: async () => "granted", mixedContentProbe: async () => false, ...extra });

describe("pc-scan 계획", () => {
  test("ipv4Prefix·isPrefix는 사설 IPv4에서만 앞 세 자리를 인정한다", () => {
    assert.equal(ipv4Prefix("http://192.168.50.149:8787"), "192.168.50");
    assert.equal(ipv4Prefix("http://172.30.1.9:8787"), "172.30.1");
    assert.equal(ipv4Prefix("http://10.0.0.5"), "10.0.0");
    for (const bad of ["http://8.8.8.8:8787", "http://sharp-vr.local:8787", "http://192.168.0.300:8787", "http://172.32.0.1:8787", "", null]) {
      assert.equal(ipv4Prefix(bad), null, String(bad));
    }
    assert.equal(isPrefix("192.168.50"), true);
    assert.equal(isPrefix("8.8.8"), false);
    assert.equal(isPrefix("192.168.50.1"), false);
  });

  test("힌트 대역(주소 또는 대역)이 맨 앞에 오고 중복은 빠진다", () => {
    const plan = buildScanPlan({ hints: ["192.168.219", "http://172.30.1.50:8787", "http://192.168.1.9:8787", "http://pc.local:8787"] });
    assert.deepEqual(plan.stage1.slice(0, 3), ["192.168.219", "172.30.1", "192.168.1"]);
    assert.equal(new Set(plan.stage1).size, plan.stage1.length);
    assert.ok(plan.stage2.every((prefix) => !plan.stage1.includes(prefix)));
  });

  test("기본 1단계는 짧게(5개), 드문 대역은 2단계로 둔다", () => {
    assert.deepEqual(PRIMARY_PREFIXES, ["192.168.0", "192.168.1", "192.168.50", "192.168.219", "172.30.1"]);
    for (const prefix of ["10.0.0", "192.168.43", "192.168.137"]) assert.ok(SECONDARY_PREFIXES.includes(prefix), prefix);
  });

  test("호스트 번호는 .100~.199를 먼저, 공유기 자리(.1)는 마지막이다", () => {
    const hosts = hostsFor("192.168.0");
    assert.equal(hosts.length, 254);
    assert.equal(new Set(hosts).size, 254);
    assert.equal(hosts[0], "192.168.0.100");
    assert.equal(hosts[99], "192.168.0.199");
    assert.equal(hosts[100], "192.168.0.2");
    assert.equal(hosts.at(-1), "192.168.0.1");
  });

  test("scanPrefixes는 동시 요청 수를 지키고 찾으면 남은 요청을 멈춘다", async () => {
    let inflight = 0;
    let max = 0;
    let started = 0;
    const result = await scanPrefixes({
      prefixes: ["192.168.0", "192.168.1"],
      port: 8787,
      concurrency: 10,
      ledger: looseLedger(),
      probe: async (base) => {
        started += 1;
        inflight += 1;
        max = Math.max(max, inflight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inflight -= 1;
        return base === "http://192.168.0.150:8787" ? { ok: true, info: okInfo } : { ok: false };
      },
    });
    assert.equal(result.found?.base, "http://192.168.0.150:8787");
    assert.ok(max <= 10, `동시 요청 ${max}`);
    assert.ok(started < 100, `찾은 뒤에도 ${started}개를 보냈다`);
  });

  test("대역은 하나씩 끝낸 뒤 다음 대역으로 간다", async () => {
    const order = [];
    await scanPrefixes({
      prefixes: ["192.168.0", "192.168.1", "192.168.50"],
      port: 8787,
      concurrency: 20,
      ledger: looseLedger(),
      probe: async (base) => {
        order.push(["192.168.0", "192.168.1", "192.168.50"].findIndex((p) => base.includes(`//${p}.`)));
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { ok: false };
      },
    });
    assert.equal(order.length, 3 * 254);
    for (let i = 1; i < order.length; i += 1) assert.ok(order[i] >= order[i - 1], `${i}번째에서 대역이 되돌아갔다`);
  });
});

describe("시간 제한에 걸린 시도의 장부(소켓 풀 보호)", () => {
  test("장부는 오래된 기록을 지우고, 예산이 차면 가장 오래된 기록이 사라질 때까지 기다리게 한다", () => {
    let now = 0;
    const ledger = createLedger({ budget: 3, lingerMs: 100, now: () => now });
    assert.equal(ledger.waitMs(0), 0);
    ledger.recordTimeout();
    now = 10;
    ledger.recordTimeout();
    now = 20;
    ledger.recordTimeout();
    assert.equal(ledger.lingering, 3);
    assert.equal(ledger.waitMs(0), 80); // 첫 기록(0ms)이 100ms에 사라진다
    now = 101;
    assert.equal(ledger.lingering, 2);
    assert.equal(ledger.waitMs(0), 0);
    assert.ok(ledger.waitMs(1) > 0, "진행 중인 시도도 예산에 센다");
  });

  test("시간 제한에 걸린 시도가 몰려도 풀에 남을 수 있는 시도 수는 예산을 넘지 않는다", async () => {
    const budget = 8;
    const lingerMs = 120;
    const ledger = createLedger({ budget, lingerMs });
    const starts = [];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 700);
    await scanPrefixes({
      prefixes: ["192.168.0"],
      port: 8787,
      concurrency: 4,
      ledger,
      signal: controller.signal,
      probe: async () => {
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: false, timedOut: true };
      },
    });
    assert.ok(starts.length >= budget, "예산만큼은 보내야 한다");
    // 어느 시점에서든 직전 lingerMs 안에 시작한 시도(=풀에 남았을 수 있는 시도)는 예산에 동시 진행 수를 더한 값 이하다.
    for (const at of starts) {
      const recent = starts.filter((other) => other <= at && other > at - lingerMs + 10).length;
      assert.ok(recent <= budget + 4, `${lingerMs}ms 안에 ${recent}개`);
    }
    assert.ok(starts.length < 254, "속도를 조절하지 않았다");
  });

  test("서버를 찾으면 중단된 나머지 시도는 장부에 적지 않는다", async () => {
    const ledger = createLedger({ budget: 1000 });
    await scanPrefixes({
      prefixes: ["192.168.0"],
      port: 8787,
      concurrency: 8,
      ledger,
      probe: async (base, signal) => {
        if (base.endsWith(".105:8787")) return { ok: true, info: okInfo };
        await new Promise((resolve) => setTimeout(resolve, 20));
        return signal.aborted ? { ok: false } : { ok: false, timedOut: true };
      },
    });
    assert.ok(ledger.lingering < 12, `${ledger.lingering}개 기록`);
  });
});

describe("pc-connect 자동 탐색", () => {
  test("sharp-vr.local이 안 풀려도 공유기 대역 탐색으로 찾고, 찾은 주소와 대역을 기억한다", async () => {
    const lan = fakeLan({ servers: { "http://192.168.50.149:8787": okInfo } });
    const storage = memoryStorage();
    const conn = createPcConnection(baseOptions({ storage, fetch: lan.fetch, scan: { timeoutMs: 50, ledger: looseLedger() } }));
    const state = await conn.connect();
    assert.equal(state.status, "connected");
    assert.equal(state.via, "scan");
    assert.equal(state.base, "http://192.168.50.149:8787");
    assert.equal(storage.data["sharp.pc.lastBase"], "http://192.168.50.149:8787");
    assert.deepEqual(JSON.parse(storage.data["sharp.pc.prefixes"]), ["192.168.50"]);
    assert.equal(state.attempts[0].base, "http://sharp-vr.local:8787"); // 이름 해석 실패가 기록에 남는다
    assert.match(describeVia(state), /자동 탐색/);
    assert.equal(state.progress, null);
  });

  test("이름(mDNS)으로 붙어도 서버가 알려 준 주소의 대역을 기억해 다음 탐색에서 먼저 본다", async () => {
    const storage = memoryStorage();
    const first = createPcConnection(baseOptions({
      storage,
      fetch: async () => jsonResponse({ ...okInfo, addresses: ["192.168.219.40"] }),
    }));
    assert.equal((await first.connect()).via, "mdns");
    assert.deepEqual(JSON.parse(storage.data["sharp.pc.prefixes"]), ["192.168.219"]);

    // 나중에 마지막 주소가 오래돼 실패하고 이름도 안 풀리면, 기억한 대역(219)부터 훑는다.
    storage.set("sharp.pc.lastBase", null);
    const lan = fakeLan({ servers: { "http://192.168.219.77:8787": okInfo } });
    const second = createPcConnection(baseOptions({ storage, fetch: lan.fetch, scan: { timeoutMs: 50, ledger: looseLedger() } }));
    const state = await second.connect();
    assert.equal(state.base, "http://192.168.219.77:8787");
    const firstScan = lan.calls.find((c) => !c.url.includes("sharp-vr.local"));
    assert.match(firstScan.url, /^http:\/\/192\.168\.219\./); // 192.168.0이 아니라 기억한 대역이 먼저
  });

  test("다음 연결은 기억한 주소로 바로 붙어 탐색하지 않는다", async () => {
    const lan = fakeLan({ servers: { "http://192.168.50.149:8787": okInfo } });
    const storage = memoryStorage({ "sharp.pc.lastBase": "http://192.168.50.149:8787" });
    const conn = createPcConnection(baseOptions({ storage, fetch: lan.fetch }));
    const state = await conn.connect();
    assert.equal(state.via, "last");
    assert.equal(lan.calls.length, 1);
  });

  test("마지막 주소가 오래돼도 그 주소의 대역을 먼저 훑는다", async () => {
    const lan = fakeLan({ servers: { "http://172.30.1.177:8787": okInfo } });
    const storage = memoryStorage({ "sharp.pc.lastBase": "http://172.30.1.50:8787" });
    const conn = createPcConnection(baseOptions({ storage, fetch: lan.fetch, scan: { timeoutMs: 50, ledger: looseLedger() } }));
    const state = await conn.connect();
    assert.equal(state.base, "http://172.30.1.177:8787");
    const firstOther = lan.calls.findIndex((c) => /^http:\/\/192\.168\.0\./.test(c.url));
    const firstHint = lan.calls.findIndex((c, i) => i > 1 && /^http:\/\/172\.30\.1\./.test(c.url));
    assert.ok(firstHint >= 0 && (firstOther === -1 || firstHint < firstOther));
  });

  test("자동 연결은 1단계 대역만 훑고, 드문 대역은 [더 찾아보기](scanMore)를 눌러야 훑는다", async () => {
    const lan = fakeLan({ servers: { "http://192.168.43.1:8787": okInfo } });
    const conn = createPcConnection(baseOptions({ fetch: lan.fetch, scan: { timeoutMs: 50, ledger: looseLedger() } }));
    const first = await conn.connect();
    assert.equal(first.status, "failed");
    assert.equal(first.reason, "unreachable");
    assert.equal(first.moreAvailable, true);
    assert.equal(lan.calls.some((c) => c.url.includes("192.168.43.")), false); // 드문 대역에는 요청이 나가지 않았다
    assert.match(describeFailure(first).steps.join("\n"), /더 찾아보기/);

    const more = await conn.scanMore();
    assert.equal(more.status, "connected");
    assert.equal(more.via, "scan");
    assert.equal(more.base, "http://192.168.43.1:8787");
    assert.equal(more.moreAvailable, false);
  });

  test("더 찾아봐도 없으면 moreAvailable이 꺼진 failed로 끝난다", async () => {
    const lan = fakeLan({});
    const conn = createPcConnection(baseOptions({ fetch: lan.fetch, scan: { primary: ["192.168.0"], secondary: ["10.1.1"], timeoutMs: 20, ledger: looseLedger() } }));
    const first = await conn.connect();
    assert.equal(first.moreAvailable, true);
    const more = await conn.scanMore();
    assert.equal(more.status, "failed");
    assert.equal(more.moreAvailable, false);
    assert.equal(more.attempts.filter((a) => a.via === "scan").length, 2); // 1단계와 2단계 요약
  });

  test("권한 창이 뜬 동안 기다리다가 사람이 허용하면 곧바로 탐색한다", async () => {
    const lan = fakeLan({ servers: { "http://192.168.0.123:8787": okInfo }, hang: true });
    let permission = "prompt";
    setTimeout(() => (permission = "granted"), 40);
    const t0 = Date.now();
    const conn = createPcConnection(baseOptions({
      permissionState: async () => permission,
      permissionPollMs: 5,
      fetch: lan.fetch,
      scan: { timeoutMs: 30, concurrency: 64, ledger: looseLedger() },
    }));
    const state = await conn.connect();
    assert.equal(state.status, "connected");
    assert.equal(state.via, "scan");
    assert.ok(Date.now() - t0 < 5000, "권한 답을 기다리느라 오래 걸렸다");
    assert.equal(lan.calls[0].signal.aborted, true); // 권한 창용 첫 요청은 답이 나온 뒤 정리된다
  });

  test("권한을 거부했으면 탐색하지 않고 denied로 끝낸다", async () => {
    const lan = fakeLan({});
    const conn = createPcConnection(baseOptions({ permissionState: async () => "denied", fetch: lan.fetch }));
    const state = await conn.connect();
    assert.equal(state.reason, "denied");
    assert.equal(lan.calls.length, 0);
  });

  test("어디에도 없으면 탐색한 대역과 함께 failed, 안내에 주소 직접 입력이 나온다", async () => {
    const lan = fakeLan({});
    const conn = createPcConnection(baseOptions({
      fetch: lan.fetch,
      scan: { primary: ["192.168.0"], secondary: ["10.1.1"], timeoutMs: 20, ledger: looseLedger() },
    }));
    const state = await conn.connect();
    assert.equal(state.status, "failed");
    assert.equal(state.reason, "unreachable");
    assert.equal(lan.calls.length, 1 + 254); // 이름 1번 + 1단계 한 대역 (2단계는 자동으로 훑지 않는다)
    const scanAttempt = state.attempts.find((a) => a.via === "scan");
    assert.match(scanAttempt.base, /192\.168\.0\.x/);
    const text = describeFailure(state).steps.join("\n");
    assert.match(text, /주소 직접 입력/);
    assert.match(text, /PC 주소/);
  });

  test("탐색 중에는 진행 문구를 상태로 알린다", async () => {
    const lan = fakeLan({ hang: true });
    const seen = [];
    const conn = createPcConnection(baseOptions({
      fetch: lan.fetch,
      scan: { primary: ["192.168.0"], secondary: [], timeoutMs: 30, concurrency: 64, ledger: looseLedger() },
      quickTimeoutMs: 20,
    }));
    conn.subscribe((s) => s.progress && seen.push(s.progress));
    await conn.connect();
    assert.ok(seen.some((text) => /192\.168\.0\.x 대역 확인 중/.test(text)), JSON.stringify(seen));
  });

  test("탐색 중 다른 프로그램이 8787에 응답하면 wrong-server로 분류한다", async () => {
    const lan = fakeLan({ servers: { "http://192.168.0.5:8787": { app: "other" } } });
    const conn = createPcConnection(baseOptions({
      fetch: lan.fetch,
      scan: { primary: ["192.168.0"], secondary: [], timeoutMs: 20, ledger: looseLedger() },
    }));
    const state = await conn.connect();
    assert.equal(state.reason, "wrong-server");
  });

  test("이름(sharp-vr.local)이 풀리면 대역 탐색 요청은 하나도 나가지 않는다", async () => {
    const calls = [];
    const conn = createPcConnection(baseOptions({ fetch: async (url) => (calls.push(url), jsonResponse(okInfo)) }));
    const state = await conn.connect();
    assert.equal(state.via, "mdns");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls, ["http://sharp-vr.local:8787/api/info"]);
  });

  test("이름 해석이 오래 걸려도(응답 없음) 기다리다 못해 탐색이 먼저 찾는다", async () => {
    const conn = createPcConnection(baseOptions({
      mdnsTimeoutMs: 5000,
      scan: { timeoutMs: 30, startDelayMs: 20, ledger: looseLedger() },
      fetch: async (url, init = {}) => {
        if (url.includes("sharp-vr.local")) {
          return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
        }
        if (url.startsWith("http://192.168.1.120:8787")) return jsonResponse(okInfo);
        throw new TypeError("Failed to fetch");
      },
    }));
    const t0 = Date.now();
    const state = await conn.connect();
    assert.equal(state.via, "scan");
    assert.equal(state.base, "http://192.168.1.120:8787");
    assert.ok(Date.now() - t0 < 3000, "이름 제한 시간(5초)까지 기다렸다");
    assert.equal(state.attempts.length, 0); // 이름 시도가 중단돼 실패 기록으로 남지 않는다
  });

  test("접속 주소 만드는 방식을 바꿔 끼울 수 있다(https 이름 방식 대비)", async () => {
    const calls = [];
    const conn = createPcConnection(baseOptions({
      scan: { primary: ["192.168.50"], secondary: [], ledger: looseLedger(), baseFor: (host, port) => `https://${host.replaceAll(".", "-")}.pc.example:${port}` },
      fetch: async (url) => {
        calls.push(url);
        if (url === "https://192-168-50-149.pc.example:8787/api/info") return jsonResponse(okInfo);
        throw new TypeError("Failed to fetch");
      },
    }));
    const state = await conn.connect();
    assert.equal(state.base, "https://192-168-50-149.pc.example:8787");
    assert.equal(state.via, "scan");
    assert.ok(calls.some((url) => url === "https://192-168-50-100.pc.example:8787/api/info"));
  });

  test("scan: false이면 탐색하지 않는다", async () => {
    const lan = fakeLan({ servers: { "http://192.168.50.149:8787": okInfo } });
    const conn = createPcConnection(baseOptions({ fetch: lan.fetch, scan: false }));
    const state = await conn.connect();
    assert.equal(state.status, "failed");
    assert.equal(lan.calls.length, 1);
    assert.equal(state.moreAvailable, false);
  });
});

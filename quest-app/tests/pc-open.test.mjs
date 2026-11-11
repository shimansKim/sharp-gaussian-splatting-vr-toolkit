// pc-source.open()이 서비스 워커 프록시를 "실제로 파일을 내줄 때만" 쓰는지 확인한다.
// Quest 실기기(Chrome 156): 페이지의 직접 http 요청은 되는데 서비스 워커 프록시는 502였다.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPcConnection } from "../src/sources/pc-connect.js";
import { createPcSource } from "../src/sources/pc-source.js";

const info = { app: "sharp-quest-server", version: 1, roots: [{ id: "vr", label: "VR" }] };
const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const memoryStorage = () => {
  const data = {};
  return { get: (k) => data[k] ?? null, set: (k, v) => (v == null ? delete data[k] : (data[k] = v)) };
};

function makeSource({ proxyStatus, proxyThrows = false, proxy = {} }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, range: init.headers?.Range });
    if (url.includes("/__src/")) {
      if (proxyThrows) throw new TypeError("Failed to fetch");
      return new Response(proxyStatus === 206 ? "x" : "원본에 연결하지 못했습니다", { status: proxyStatus });
    }
    return jsonResponse(info);
  };
  const connection = createPcConnection({ storage: memoryStorage(), permissionState: async () => "granted", fetch, scan: false, mdnsHost: "sharp-vr.local" });
  const source = createPcSource({
    connection,
    fetch,
    baseUrl: "/app/",
    proxy: { ensureControl: async () => true, configure: async () => true, available: () => true, ...proxy },
  });
  return { source, calls };
}

const item = { id: "pc:vr/clip.mp4", name: "clip.mp4", kind: "video", path: "vr/clip.mp4" };

describe("pc-source open()의 프록시 선택", () => {
  test("프록시가 파일을 내주면(206) 같은 출처 프록시 URL로 연다", async () => {
    const { source, calls } = makeSource({ proxyStatus: 206 });
    const opened = await source.open(item);
    assert.equal(opened.url, "/app/__src/pc/vr/clip.mp4");
    const ping = calls.find((c) => c.url.includes("/__src/"));
    assert.equal(ping.range, "bytes=0-0"); // 1바이트만 확인한다
  });

  test("프록시가 502를 돌려주면(Quest 실기기) PC 직접 주소로 연다", async () => {
    const { source } = makeSource({ proxyStatus: 502 });
    const opened = await source.open(item);
    assert.match(opened.url, /^http:\/\/sharp-vr\.local:8787\/files\/vr\/clip\.mp4$/);
  });

  test("프록시 요청 자체가 실패해도 직접 주소로 연다", async () => {
    const { source } = makeSource({ proxyThrows: true });
    const opened = await source.open(item);
    assert.match(opened.url, /^http:\/\/sharp-vr\.local:8787\/files\//);
  });

  test("서비스 워커 제어가 없으면 프록시를 확인하지도 않고 직접 주소로 연다", async () => {
    const { source, calls } = makeSource({ proxyStatus: 206, proxy: { available: () => false } });
    const opened = await source.open(item);
    assert.match(opened.url, /^http:\/\/sharp-vr\.local:8787\/files\//);
    assert.equal(calls.some((c) => c.url.includes("/__src/")), false);
  });

  test("직접 주소로 열 때 PLY 스트림은 같은 직접 주소를 요청한다", async () => {
    const { source, calls } = makeSource({ proxyStatus: 502 });
    const opened = await source.open({ ...item, id: "pc:vr/a.ply", name: "a.ply", kind: "splat", path: "vr/a.ply" });
    await opened.stream().catch(() => {});
    assert.ok(calls.some((c) => c.url === "http://sharp-vr.local:8787/files/vr/a.ply"));
  });
});

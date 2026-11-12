// pc-source의 목록 동작(종류별 요청, 시퀀스·개수, 폴더 이어 받기) 테스트. 서버는 가짜 fetch로 대신한다.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPcSource } from "../src/sources/pc-source.js";

const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const BASE = "http://192.168.0.5:8787";

function setup(handler) {
  const calls = [];
  const connection = {
    ensure: async () => ({ status: "connected", base: BASE, info: { roots: [{ id: "outputs" }, { id: "demo" }] } }),
    markLost: () => calls.push("lost"),
  };
  const source = createPcSource({
    connection,
    fetch: async (url) => {
      const u = new URL(url);
      calls.push(u.pathname + u.search);
      return jsonResponse(handler(u));
    },
  });
  return { source, calls };
}

const file = (root, path, kind, extra = {}) => ({ root, name: path.split("/").pop(), path, type: "file", kind, size: 10, mtime: 1, ...extra });

describe("pc-source list: 최상위", () => {
  test("종류를 주지 않으면 /api/recent를 한 번 부르고 sequences·counts를 함께 돌려준다", async () => {
    const { source, calls } = setup(() => ({
      items: [file("outputs", "VR/a.mp4", "video"), file("outputs", "m.ply", "splat")],
      counts: { splat: 279, video: 328, image: 151 },
      sequences: [{ root: "outputs", path: "run/03_stereo_frames", name: "03_stereo_frames", count: 8519, mtime: 5 }],
    }));
    const result = await source.list("");
    assert.deepEqual(calls, ["/api/recent?limit=1000"]);
    assert.deepEqual(result.items.map((i) => i.id), ["pc:outputs/VR/a.mp4", "pc:outputs/m.ply"]);
    assert.deepEqual(result.dirs, ["outputs", "demo"]);
    assert.deepEqual(result.counts, { splat: 279, video: 328, image: 151 });
    assert.deepEqual(result.sequences, [
      { id: "pc:outputs/run/03_stereo_frames", path: "outputs/run/03_stereo_frames", name: "03_stereo_frames", count: 8519, mtime: 5 },
    ]);
  });

  test("kind를 주면 서버에서 그 종류만 다시 받는다", async () => {
    const { source, calls } = setup(() => ({ items: [file("outputs", "a.mp4", "video")], counts: { splat: 1, video: 1, image: 1 }, sequences: [] }));
    const result = await source.list("", { kind: "video" });
    assert.deepEqual(calls, ["/api/recent?limit=1000&kind=video"]);
    assert.equal(result.items.length, 1);
  });

  test("kind가 all이거나 알 수 없는 값이면 종류 없이 부른다", async () => {
    const { source, calls } = setup(() => ({ items: [] }));
    await source.list("", { kind: "all" });
    await source.list("", { kind: "bogus" });
    assert.deepEqual(calls, ["/api/recent?limit=1000", "/api/recent?limit=1000"]);
  });

  test("옛 서버(counts·sequences 없음)에도 기본값으로 동작한다", async () => {
    const { source } = setup(() => ({ items: [file("outputs", "a.ply", "splat")] }));
    const result = await source.list("");
    assert.deepEqual(result.sequences, []);
    assert.deepEqual(result.counts, { splat: 0, video: 0, image: 0 });
    assert.equal(result.items.length, 1);
  });

  test("루트 폴더 자체가 시퀀스이면 path가 루트 id가 된다", async () => {
    const { source } = setup(() => ({ items: [], sequences: [{ root: "demo", path: "", name: "demo", count: 40, mtime: 1 }] }));
    const result = await source.list("");
    assert.equal(result.sequences[0].path, "demo");
  });
});

describe("pc-source list: 폴더 이어 받기", () => {
  /** total개 파일을 pageSize씩 나눠 주는 가짜 서버 */
  const pagedServer = (total, pageSize, kindOf = () => "image") => (u) => {
    const offset = Number(u.searchParams.get("offset") ?? 0);
    const limit = Math.min(Number(u.searchParams.get("limit") ?? pageSize), pageSize);
    const count = Math.min(limit, total - offset);
    const items = Array.from({ length: count }, (_, i) => file("outputs", `frames/f_${String(offset + i).padStart(5, "0")}.png`, kindOf(offset + i)));
    const next = offset + count;
    return { root: "outputs", path: "frames", items, total, offset, nextOffset: next < total ? next : null };
  };

  test("nextOffset이 없어질 때까지 이어 받아 모든 항목을 돌려준다", async () => {
    const { source, calls } = setup(pagedServer(8519, 5000));
    const result = await source.list("outputs/frames");
    assert.equal(result.items.length, 8519);
    assert.equal(result.total, 8519);
    assert.equal(result.truncated, false);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /offset=0&limit=5000/);
    assert.match(calls[1], /offset=5000&limit=5000/);
  });

  test("상한(20000)에서 멈추고 truncated로 알린다", async () => {
    const { source } = setup(pagedServer(30000, 5000));
    const result = await source.list("outputs/frames");
    assert.equal(result.items.length, 20000);
    assert.equal(result.total, 30000);
    assert.equal(result.truncated, true);
  });

  test("옛 서버(nextOffset·total 없음)는 첫 쪽에서 끝난다", async () => {
    const { source, calls } = setup(() => ({ root: "outputs", path: "x", items: [file("outputs", "x/a.png", "image"), { root: "outputs", name: "sub", path: "x/sub", type: "dir", kind: null }] }));
    const result = await source.list("outputs/x");
    assert.equal(calls.length, 1);
    assert.deepEqual(result.items.map((i) => i.name), ["a.png"]);
    assert.deepEqual(result.dirs, ["outputs/x/sub"]);
    assert.equal(result.total, 2);
    assert.equal(result.truncated, false);
  });

  test("서버가 같은 offset만 계속 주면 무한 반복하지 않는다", async () => {
    const { source, calls } = setup(() => ({ items: [file("outputs", "a/x.png", "image")], total: 99, nextOffset: 0 }));
    await source.list("outputs/a");
    assert.equal(calls.length, 1);
  });

  test("kind를 주면 받은 항목을 그 종류로 거른다(폴더는 그대로)", async () => {
    const kinds = ["video", "image", "splat"];
    const { source } = setup((u) => {
      const page = pagedServer(9, 9, (i) => kinds[i % 3])(u);
      page.items.push({ root: "outputs", name: "sub", path: "frames/sub", type: "dir", kind: null });
      return page;
    });
    const result = await source.list("outputs/frames", { kind: "video" });
    assert.equal(result.items.length, 3);
    assert.ok(result.items.every((i) => i.kind === "video"));
    assert.deepEqual(result.dirs, ["outputs/frames/sub"]);
  });

  test("연결 실패는 그대로 던지고 연결을 끊긴 것으로 표시한다", async () => {
    const calls = [];
    const source = createPcSource({
      connection: { ensure: async () => ({ status: "connected", base: BASE, info: {} }), markLost: () => calls.push("lost") },
      fetch: async () => {
        throw new Error("network");
      },
    });
    await assert.rejects(() => source.list("outputs/frames"), /network/);
    assert.deepEqual(calls, ["lost"]);
  });
});

describe("pc-source list: 연결 실패", () => {
  test("연결이 실패하면 연결을 한 번만 시도하고(탐색을 두 바퀴 돌리지 않고) 연결 오류를 던진다", async () => {
    let ensureCalls = 0;
    const failed = { status: "failed", base: null, info: null, reason: "unreachable", attempts: [] };
    const source = createPcSource({
      connection: { ensure: async () => (ensureCalls += 1, failed), markLost: () => {} },
      fetch: async () => {
        throw new Error("연결이 없으니 요청도 나가면 안 된다");
      },
    });
    await assert.rejects(() => source.list(""), (error) => error.name === "PcConnectionError");
    assert.equal(ensureCalls, 1);
  });
});

describe("pc-source dirs(): 폴더 트리용 하위 폴더만", () => {
  test("최상위는 연결 정보의 루트 id만 돌려주고 목록·최근 요청을 하지 않는다", async () => {
    const { source, calls } = setup(() => ({}));
    assert.equal(source.browsable, true);
    assert.deepEqual(await source.dirs(""), ["outputs", "demo"]);
    assert.deepEqual(calls, []);
  });

  test("폴더는 /api/list 첫 쪽에서 하위 폴더 경로만 뽑는다", async () => {
    const { source, calls } = setup(() => ({
      items: [
        { root: "outputs", name: "VR", path: "a/VR", type: "dir", kind: null },
        { root: "outputs", name: "ply", path: "a/ply", type: "dir", kind: null },
        file("outputs", "a/x.mp4", "video"),
      ],
      total: 3,
    }));
    assert.deepEqual(await source.dirs("outputs/a"), ["outputs/a/VR", "outputs/a/ply"]);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith("/api/list?root=outputs&path=a&offset=0&limit=5000"));
  });
});

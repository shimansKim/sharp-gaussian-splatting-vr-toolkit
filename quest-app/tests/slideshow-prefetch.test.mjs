import assert from "node:assert/strict";
import test from "node:test";
import { emit } from "../src/core/events.js";
import { createLibrary } from "../src/core/library.js";
import { createPrefetcher } from "../src/core/prefetch.js";
import { clearViewers, registerSource, registerViewer, setPrefetchLimit } from "../src/core/registry.js";

function resetRegistry() {
  clearViewers();
}
import { createEndWatch, createSlideshow } from "../src/core/slideshow.js";

const MB = 1024 * 1024;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** 가짜 원격 소스(PC)와 뷰어. 열기·받기 횟수와 뷰어가 받은 파일을 기록한다. */
function setup({ sizes = {}, failOpen = new Set(), splatViewer = null, slowOpen = {} } = {}) {
  // 이전 테스트가 등록한 뷰어가 남지 않게 한다(registry는 전역).
  resetRegistry();
  const log = { opens: [], loads: [], released: 0, reads: 0 };
  const names = ["a.png", "b.png", "c.ply", "d.mp4"];
  const items = names.map((name) => ({
    id: `pc:${name}`,
    sourceId: "pc",
    name,
    kind: name.endsWith(".png") ? "image" : name.endsWith(".ply") ? "splat" : "video",
    size: sizes[name] ?? 1024,
  }));
  registerSource({
    id: "pc",
    label: "PC",
    async list() {
      return { items };
    },
    async open(item) {
      log.opens.push(item.name);
      if (slowOpen[item.name]) await tick(slowOpen[item.name]);
      if (failOpen.has(item.name)) throw new Error("열 수 없음");
      const bytes = new Uint8Array(item.size).fill(7);
      return {
        url: "http://pc/" + item.name,
        name: item.name,
        size: bytes.length,
        stream: async () => {
          log.reads++;
          return new Blob([bytes]).stream();
        },
        release() {
          log.released++;
        },
      };
    },
  });
  for (const kind of ["image", "splat", "video"]) {
    if (kind === "splat" && splatViewer) {
      registerViewer(splatViewer);
      continue;
    }
    registerViewer({
      kinds: [kind],
      mount() {},
      async load(item, file) {
        log.loads.push({ name: item.name, url: file.url, prefetched: file.url.startsWith("blob:") });
      },
      unload() {},
      update() {},
    });
  }
  setPrefetchLimit("image", 48 * MB);
  setPrefetchLimit("splat", 160 * MB);
  setPrefetchLimit("video", 0);
  return { items, log };
}

test("미리 받기: 다 연 뒤 다음 파일을 받아 두고, 열 때 소스를 다시 부르지 않는다", async () => {
  const { items, log } = setup();
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[0], { playlist: items });
  await tick(20);
  assert.deepEqual(library.prefetchState && { id: library.prefetchState.itemId }, { id: "pc:b.png" });
  await library.next();
  assert.equal(log.loads.at(-1).name, "b.png");
  assert.equal(log.loads.at(-1).prefetched, true, "받아 둔 blob 파일로 열림");
  // a를 열 때 1번, b를 받아 둘 때 1번. b를 열 때는 소스를 다시 부르지 않는다.
  assert.deepEqual(log.opens, ["a.png", "b.png"]);
});

test("미리 받기: 방금 이전을 눌렀다면 이전 쪽을 받는다", async () => {
  const { items } = setup();
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[2], { playlist: items }); // c.ply
  await library.prev(); // b.png
  await tick(20);
  assert.equal(library.prefetchState.itemId, "pc:a.png");
});

test("미리 받기: 영상은 받지 않고, 영상을 보는 중에는 다음 파일도 받지 않는다", async () => {
  const { items, log } = setup();
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[3], { playlist: items }); // d.mp4 → 다음은 a.png지만 현재가 영상
  await tick(20);
  assert.equal(library.prefetchState, null);
  assert.deepEqual(log.opens, ["d.mp4"]);
});

test("미리 받기: 크기 한도를 넘는 파일은 받지 않는다", async () => {
  const { items, log } = setup({ sizes: { "b.png": 49 * MB } });
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[0], { playlist: items });
  await tick(20);
  assert.equal(library.prefetchState, null);
  assert.deepEqual(log.opens, ["a.png"]);
});

test("미리 받기: 다른 항목을 열면 받던 것을 버리고, 받아 둔 파일은 열 때 한 번 쓰인다", async () => {
  const { items, log } = setup();
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[0], { playlist: items });
  await tick(20);
  await library.open(items[2], { playlist: items }); // b를 받아 뒀지만 c를 연다
  assert.equal(log.loads.at(-1).prefetched, false);
  await tick(20);
  assert.equal(library.prefetchState, null, "c의 다음은 영상이라 받지 않음");
});

test("미리 받기: 받다가 실패해도 열 때는 평소대로 소스에서 연다", async () => {
  const { items, log } = setup({ failOpen: new Set(["b.png"]) });
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[0], { playlist: items });
  await tick(20);
  // b는 받다가 실패했다: 조용히 포기하고(재시도 안 함) 받아 둔 파일은 없다.
  assert.deepEqual(library.prefetchState, { itemId: "pc:b.png", done: true, ready: false });
  assert.ok(log.opens.filter((name) => name === "b.png").length >= 1);
});

test("미리 받기: 뷰어가 prefetch(item, file)를 내놓으면 그 항목의 OpenedFile을 넘기고, 열 때는 버리지 않는다", async () => {
  const calls = [];
  const loads = [];
  const { items } = setup({
    splatViewer: {
      kinds: ["splat"],
      mount() {},
      async load(item, file) {
        loads.push([item.name, file.url]);
      },
      unload() {},
      update() {},
      prefetchedItemId: null,
      async prefetch(item, file) {
        calls.push(["prefetch", item.name, typeof file.stream]);
        this.prefetchedItemId = item.id;
      },
      discardPrefetch() {
        calls.push(["discard"]);
        this.prefetchedItemId = null;
      },
    },
  });
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[1], { playlist: items }); // b.png → 다음 c.ply (뷰어 방식)
  await tick(20);
  assert.deepEqual(calls, [["prefetch", "c.ply", "function"]]);
  await library.next(); // c.ply를 연다: 받아 둔 것은 뷰어가 load에서 쓰므로 버리지 않는다
  assert.deepEqual(calls, [["prefetch", "c.ply", "function"]]);
  assert.deepEqual(loads, [["c.ply", "http://pc/c.ply"]], "열 때는 평소처럼 원본 OpenedFile");
});

test("미리 받기: 받아 둔 뒤 다른 항목으로 가면 discardPrefetch로 메모리를 푼다", async () => {
  const calls = [];
  const { items } = setup({
    splatViewer: {
      kinds: ["splat"], mount() {}, async load() {}, unload() {}, update() {},
      prefetchedItemId: null,
      async prefetch(item) { calls.push("prefetch:" + item.name); this.prefetchedItemId = item.id; },
      discardPrefetch() { calls.push("discard"); this.prefetchedItemId = null; },
    },
  });
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[1], { playlist: items }); // → c.ply 받아 둠
  await tick(20);
  await library.open(items[0], { playlist: items }); // c.ply가 아닌 a.png를 연다
  assert.deepEqual(calls, ["prefetch:c.ply", "discard"]);
  await library.open(items[1], { playlist: items });
  await tick(20);
  library.close(); // 항목을 닫을 때도 푼다
  assert.deepEqual(calls, ["prefetch:c.ply", "discard", "prefetch:c.ply", "discard"]);
});

test("prefetcher: 로컬 소스(기기 파일·보관함)는 받지 않는다", () => {
  const prefetcher = createPrefetcher({ getSource: () => ({}), limitFor: () => 100 * MB });
  assert.equal(prefetcher.eligible({ id: "session:a", sourceId: "session", kind: "image", size: 10 }), false);
  assert.equal(prefetcher.eligible({ id: "library:a", sourceId: "library", kind: "splat", size: 10 }), false);
  assert.equal(prefetcher.eligible({ id: "pc:a", sourceId: "pc", kind: "splat", size: 10 }), true);
});

// ---- 슬라이드쇼 ----

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    timers: {
      set: (fn, ms) => {
        pending.set(nextId, { fn, ms });
        return nextId++;
      },
      clear: (id) => pending.delete(id),
    },
    pending,
    fire() {
      const [id, entry] = [...pending][0] ?? [];
      if (!id) return false;
      pending.delete(id);
      entry.fn();
      return true;
    },
  };
}

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};

/** 이벤트 버스를 쓰되 테스트마다 따로 구독을 해제한다. */
async function showSetup() {
  const world = setup();
  const library = createLibrary({ prefetchDelayMs: -1 });
  const fake = fakeTimers();
  const subscriptions = [];
  const { on } = await import("../src/core/events.js");
  const subscribe = (name, fn) => {
    const off = on(name, fn);
    subscriptions.push(off);
    return off;
  };
  const slideshow = createSlideshow({ library, storage: memoryStorage(), timers: fake.timers, subscribe });
  return { ...world, library, slideshow, fake, dispose: () => subscriptions.forEach((off) => off()) };
}

test("슬라이드쇼: 사진은 간격이 지나면 다음으로 넘어가고, 영상은 끝나면 넘어간다", async () => {
  const { items, library, slideshow, fake, dispose } = await showSetup();
  await library.open(items[1], { playlist: items }); // b.png
  slideshow.start();
  assert.equal(slideshow.running, true);
  assert.equal([...fake.pending.values()][0].ms, 5000);
  fake.fire();
  await tick(10);
  assert.equal(library.current.name, "c.ply", "사진 → PLY도 간격으로 넘어감");
  fake.fire();
  await tick(10);
  assert.equal(library.current.name, "d.mp4");
  assert.equal(fake.pending.size, 0, "영상은 타이머를 걸지 않는다");
  slideshow.notifyEnded("pc:d.mp4");
  await tick(10);
  assert.equal(library.current.name, "a.png", "목록 끝에서 처음으로");
  slideshow.notifyEnded("pc:d.mp4"); // 이미 지난 영상의 중복 알림은 무시
  await tick(10);
  assert.equal(library.current.name, "a.png");
  dispose();
});

test("슬라이드쇼: 간격 바꾸기·직접 넘기면 새 항목 기준으로 다시 센다·열기 실패하면 멈춘다", async () => {
  const { items, library, slideshow, fake, dispose } = await showSetup();
  await library.open(items[0], { playlist: items });
  slideshow.start();
  slideshow.cycleInterval();
  assert.equal(slideshow.interval, 10);
  assert.equal([...fake.pending.values()][0].ms, 10000);
  await library.next();
  assert.equal(fake.pending.size, 1, "직접 넘겨도 타이머는 하나만");
  slideshow.stop();
  assert.equal(fake.pending.size, 0);
  assert.equal(slideshow.running, false);
  slideshow.start();
  emit("item:error", { item: items[0], error: new Error("x") });
  assert.equal(slideshow.running, false);
  dispose();
});

test("슬라이드쇼: 파일이 하나뿐이면 넘길 곳이 없어 멈춘다", async () => {
  const { items, library, slideshow, fake, dispose } = await showSetup();
  await library.open(items[0], { playlist: [items[0]] });
  slideshow.start();
  fake.fire();
  assert.equal(slideshow.running, false);
  dispose();
});

// ---- m29 후속 ----

test("영상 끝 감시: 끝에서 한 번만 알리고, 되감아 다시 끝나면 또 알린다", () => {
  let running = true;
  const notified = [];
  const watch = createEndWatch({ isRunning: () => running, notify: (id) => notified.push(id) });
  const video = { id: "pc:d.mp4", kind: "video" };
  watch(video, false);
  watch(video, true);
  watch(video, true);
  assert.deepEqual(notified, ["pc:d.mp4"]);
  watch(video, false); // 되감아 재생
  watch(video, true); // 다시 끝남
  assert.deepEqual(notified, ["pc:d.mp4", "pc:d.mp4"]);
  watch({ id: "pc:a.png", kind: "image" }, false);
});

test("영상 끝 감시: 쇼가 꺼진 채 끝나면 기다렸다가, 끝에 멈춘 채 쇼를 켜면 바로 알린다", () => {
  let running = false;
  const notified = [];
  const watch = createEndWatch({ isRunning: () => running, notify: (id) => notified.push(id) });
  const video = { id: "pc:d.mp4", kind: "video" };
  watch(video, true);
  assert.deepEqual(notified, []);
  running = true;
  watch(video, true);
  assert.deepEqual(notified, ["pc:d.mp4"]);
});

/** 미리 받은 mesh를 쥐는 가짜 PLY 뷰어. */
function holdingSplatViewer(state) {
  let prefetchedId = null;
  return {
    kinds: ["splat"],
    mount() {},
    async load() {},
    unload() {},
    update() {},
    async prefetch(item) {
      prefetchedId = item.id;
      state.prefetched = item.id;
      return true;
    },
    discardPrefetch() {
      prefetchedId = null;
      state.prefetched = null;
    },
    get prefetchedItemId() {
      return prefetchedId;
    },
  };
}

test("미리 받기 틈: 받은 항목 열기를 사진이 가로채도 PLY 뷰어가 mesh를 쥐고 있지 않는다", async () => {
  const state = { prefetched: null };
  const { items } = setup({ splatViewer: holdingSplatViewer(state), slowOpen: {} });
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[1], { playlist: items }); // b.png → c.ply를 뷰어가 받아 둠
  await tick(20);
  assert.equal(state.prefetched, "pc:c.ply");
  // c.ply 열기가 소스에서 늦어지는 동안 사진이 열린다(c의 슬롯은 이미 비워진 뒤)
  const { items: _ignored } = { items };
  registerSource({
    id: "pc",
    label: "PC",
    async list() {
      return { items };
    },
    async open(item) {
      if (item.name === "c.ply") await tick(40);
      return { url: "http://pc/" + item.name, name: item.name, size: item.size, stream: async () => new Blob([new Uint8Array(item.size)]).stream(), release() {} };
    },
  });
  const slowOpening = library.open(items[2], { playlist: items });
  await tick(5);
  await library.open(items[0], { playlist: items }); // a.png가 가로챈다
  await slowOpening;
  assert.equal(state.prefetched, null, "뷰어가 받아 둔 c.ply를 풀었다");
  assert.equal(library.current.name, "a.png");
});

test("미리 받기 틈: 받은 항목 열기가 실패해도 뷰어가 mesh를 풀어 준다", async () => {
  const state = { prefetched: null };
  const { items } = setup({ splatViewer: holdingSplatViewer(state) });
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[1], { playlist: items });
  await tick(20);
  assert.equal(state.prefetched, "pc:c.ply");
  registerSource({
    id: "pc",
    label: "PC",
    async list() {
      return { items };
    },
    async open(item) {
      if (item.name === "c.ply") throw new Error("열기 실패");
      return { url: "http://pc/" + item.name, name: item.name, size: item.size, release() {} };
    },
  });
  await library.open(items[2], { playlist: items });
  assert.equal(state.prefetched, null);
});

test("미리 받기: 뷰어에 넘긴 파일의 release는 항목이 열린 뒤로 미룬다(mesh가 스트림을 읽는 중일 수 있음)", async () => {
  const state = { prefetched: null };
  const { items, log } = setup({ splatViewer: holdingSplatViewer(state) });
  const library = createLibrary({ prefetchDelayMs: 0 });
  await library.open(items[1], { playlist: items });
  const before = log.released;
  await tick(20);
  assert.equal(state.prefetched, "pc:c.ply");
  assert.equal(log.released, before, "prefetch가 끝나도 아직 release하지 않는다");
  await library.next(); // c.ply가 열린 뒤: 보던 b.png 파일(1)과 받아 둔 c.ply 파일(1)이 release됨
  assert.equal(log.released, before + 2);
});

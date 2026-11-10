import assert from "node:assert/strict";
import test from "node:test";
import {
  applyView,
  describeFolder,
  folderEntries,
  loadView,
  nextValue,
  normalizeView,
  parentPath,
  pathSegments,
  saveView,
  KIND_FILTERS,
  PAGE_SIZE,
  pageLimit,
} from "../src/core/list-view.js";
import { createLibrary } from "../src/core/library.js";
import { registerSource } from "../src/core/registry.js";

const item = (name, kind, size, mtime) => ({ id: `t:${name}`, sourceId: "t", name, kind, size, mtime });
const sample = [
  item("b.mp4", "video", 500, 300),
  item("a.ply", "splat", 900, 100),
  item("c.jpg", "image", 50, 200),
  item("a10.ply", "splat", 100, 400),
  item("a2.ply", "splat", 100, 400),
];

const memoryStorage = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v) };
};

test("applyView: 종류 필터", () => {
  assert.deepEqual(applyView(sample, { kind: "splat", sort: "name" }).map((i) => i.name), ["a.ply", "a2.ply", "a10.ply"]);
  assert.equal(applyView(sample, { kind: "all", sort: "name" }).length, 5);
  assert.equal(applyView(sample, { kind: "image", sort: "name" }).length, 1);
});

test("applyView: 최신순·이름순(숫자 자연 정렬)·크기순·확장자순", () => {
  assert.deepEqual(applyView(sample, { sort: "recent" }).map((i) => i.name), ["a2.ply", "a10.ply", "b.mp4", "c.jpg", "a.ply"]);
  assert.deepEqual(applyView(sample, { sort: "name" }).map((i) => i.name), ["a.ply", "a2.ply", "a10.ply", "b.mp4", "c.jpg"]);
  assert.deepEqual(applyView(sample, { sort: "size" }).map((i) => i.name), ["a.ply", "b.mp4", "a2.ply", "a10.ply", "c.jpg"]);
  assert.deepEqual(applyView(sample, { sort: "ext" }).map((i) => i.name), ["c.jpg", "b.mp4", "a.ply", "a2.ply", "a10.ply"]);
});

test("applyView: 원본을 바꾸지 않고, mtime·size가 없어도 깨지지 않는다", () => {
  const before = sample.map((i) => i.name);
  applyView(sample, { sort: "size" });
  assert.deepEqual(sample.map((i) => i.name), before);
  const bare = [{ id: "x", sourceId: "t", name: "z.ply", kind: "splat" }, { id: "y", sourceId: "t", name: "y.ply", kind: "splat" }];
  assert.deepEqual(applyView(bare, { sort: "recent" }).map((i) => i.name), ["y.ply", "z.ply"]);
});

test("normalizeView: 알 수 없는 값은 기본값", () => {
  assert.deepEqual(normalizeView({ kind: "zip", sort: "zzz" }), { kind: "all", sort: "recent" });
  assert.deepEqual(normalizeView(null), { kind: "all", sort: "recent" });
  assert.deepEqual(normalizeView({ kind: "video", sort: "size" }), { kind: "video", sort: "size" });
});

test("nextValue: 끝에서 처음으로 돌아간다", () => {
  assert.equal(nextValue(KIND_FILTERS, "all"), "splat");
  assert.equal(nextValue(KIND_FILTERS, "image"), "all");
});

test("경로 계산", () => {
  assert.equal(parentPath("outputs/VR/clips"), "outputs/VR");
  assert.equal(parentPath("outputs"), "");
  assert.equal(parentPath(""), "");
  assert.deepEqual(pathSegments("a/b"), [{ name: "a", path: "a" }, { name: "b", path: "a/b" }]);
  assert.equal(describeFolder(""), "최근 파일");
  assert.equal(describeFolder("outputs/VR"), "outputs / VR");
  assert.deepEqual(folderEntries(["outputs/b", "outputs/a10", "outputs/a2"]).map((f) => f.name), ["a2", "a10", "b"]);
});

test("loadView/saveView: 저장이 막혀도 기본값으로 동작", () => {
  const storage = memoryStorage();
  assert.deepEqual(loadView(storage), { kind: "all", sort: "recent" });
  saveView({ kind: "video", sort: "name" }, storage);
  assert.deepEqual(loadView(storage), { kind: "video", sort: "name" });
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(loadView(broken), { kind: "all", sort: "recent" });
  saveView({ kind: "image", sort: "size" }, broken); // 던지지 않는다
});

test("library: 폴더 들어가기·상위·최근, 필터·정렬이 목록에 반영된다", async () => {
  const calls = [];
  const tree = {
    "": { items: [item("recent1.ply", "splat", 10, 900), item("recent2.mp4", "video", 20, 800)], dirs: ["outputs", "inputs"] },
    outputs: { items: [item("o1.ply", "splat", 5, 1), item("o2.jpg", "image", 6, 2)], dirs: ["outputs/VR"] },
    "outputs/VR": { items: [item("v.mp4", "video", 7, 3)], dirs: [] },
  };
  registerSource({
    id: "t",
    label: "T",
    async list(path = "") {
      calls.push(path);
      return tree[path] ?? { items: [], dirs: [] };
    },
    async open() {
      throw new Error("not used");
    },
  });
  const library = createLibrary();
  await library.refresh("t");
  assert.equal(library.folder, "");
  assert.equal(library.canBrowse, true);
  assert.deepEqual(library.folders.map((f) => f.name), ["inputs", "outputs"]);
  assert.equal(library.items.length, 2);

  await library.openFolder("outputs");
  assert.equal(library.folder, "outputs");
  assert.deepEqual(library.items.map((i) => i.name).sort(), ["o1.ply", "o2.jpg"]);

  library.setView({ kind: "image" });
  assert.deepEqual(library.items.map((i) => i.name), ["o2.jpg"]);
  assert.equal(library.allItems.length, 2);

  library.setView({ kind: "all" });
  await library.openFolder("outputs/VR");
  await library.upFolder();
  assert.equal(library.folder, "outputs");
  await library.upFolder();
  assert.equal(library.folder, "");
  assert.deepEqual(calls, ["", "outputs", "outputs/VR", "outputs", ""]);

  // 같은 소스를 다시 불러오면 보던 폴더를 유지하고, 다른 소스로 갔다 오면 최상위로 돌아간다.
  await library.openFolder("outputs");
  await library.refresh("t");
  assert.equal(library.folder, "outputs");
  library.setView({ kind: "all", sort: "recent" });
});

test("library: 폴더가 없는 소스는 canBrowse가 false", async () => {
  registerSource({ id: "flat", label: "F", list: async () => ({ items: [item("a.ply", "splat", 1, 1)] }), open: async () => ({}) });
  const library = createLibrary();
  await library.refresh("flat");
  assert.equal(library.canBrowse, false);
  assert.deepEqual(library.folders, []);
});

test("pageLimit: 한 번에 그리는 행 수는 쪽 단위로만 늘고, 열린 항목이 한계 밖이면 그 항목이 보이게 늘린다", () => {
  assert.equal(PAGE_SIZE, 200);
  assert.equal(pageLimit(200, 8519), 200);
  assert.equal(pageLimit(200, 50), 200);
  assert.equal(pageLimit(200, 8519, 199), 200);
  assert.equal(pageLimit(200, 8519, 200), 400);
  assert.equal(pageLimit(200, 8519, 1234), 1400);
  assert.equal(pageLimit(400, 8519, 10), 400);
  assert.equal(pageLimit(200, 300, 299), 300); // 전체 개수를 넘지 않는다
});

test("library: 최상위 종류 선택은 소스에 kind를 넘겨 다시 받고, 폴더 안에서는 넘기지 않는다", async () => {
  const calls = [];
  registerSource({
    id: "srv",
    label: "S",
    async list(path = "", options) {
      calls.push([path, options?.kind ?? null]);
      if (path === "") {
        const all = [item("a.ply", "splat", 1, 3), item("b.mp4", "video", 2, 2), item("c.jpg", "image", 3, 1)];
        const items = options?.kind ? all.filter((i) => i.kind === options.kind) : all;
        return {
          items,
          dirs: ["root"],
          sequences: [{ id: "s1", path: "root/frames/a", name: "a", count: 8519, mtime: 5 }, { id: "s2", path: "root/frames/b", name: "a", count: 3, mtime: 4 }],
          counts: { splat: 10, video: 20, image: 30 },
        };
      }
      return { items: [item("x.png", "image", 1, 1)], dirs: [], truncated: true };
    },
    async open() {
      return {};
    },
  });
  const library = createLibrary();
  library.setView({ kind: "all", sort: "recent" });
  await library.refresh("srv");
  assert.deepEqual(calls.at(-1), ["", null]);
  assert.equal(library.sequences.length, 2);
  assert.notEqual(library.sequences[0].path, library.sequences[1].path); // 같은 이름이어도 path로 구분
  assert.equal(library.hiddenCount, 60 - 3); // 외 57개
  assert.equal(library.canBrowse, true);

  library.setView({ kind: "video" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls.at(-1), ["", "video"]);
  assert.deepEqual(library.items.map((i) => i.name), ["b.mp4"]);
  assert.equal(library.hiddenCount, 20 - 1);

  await library.openFolder("root");
  assert.deepEqual(calls.at(-1), ["root", null]); // 폴더 안은 kind 없이 받는다
  assert.equal(library.sequences.length, 0);
  assert.equal(library.hiddenCount, 0);
  assert.equal(library.truncated, true);
  library.setView({ kind: "image" }); // 폴더 안에서는 다시 받지 않고 거르기만 한다
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.filter(([path]) => path === "root").length, 1);
  library.setView({ kind: "all" });
});

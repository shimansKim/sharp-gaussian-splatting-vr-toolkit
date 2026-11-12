import test from "node:test";
import assert from "node:assert/strict";
import { createFolderTree, treeKey } from "../src/core/folder-tree.js";

function setup({ pcDirs = {} } = {}) {
  const calls = [];
  const sources = [
    { id: "session", label: "이번에 연 파일" },
    { id: "library", label: "보관함" },
    {
      id: "pc",
      label: "PC",
      browsable: true,
      async dirs(path) {
        calls.push(["dirs", path]);
        if (pcDirs[path] === "fail") throw new Error("down");
        return pcDirs[path] ?? [];
      },
    },
    { id: "gdrive", label: "드라이브" },
  ];
  let changes = 0;
  const tree = createFolderTree({ listSources: () => sources, getSource: (id) => sources.find((s) => s.id === id), onChange: () => changes++ });
  return { tree, calls, changes: () => changes };
}
const cur = (sourceId = "session", path = "") => ({ sourceId, path });
const names = (tree, current) => tree.rows(current).map((r) => `${"  ".repeat(r.depth)}${r.name}`);

test("처음에는 출처 네 개만 보이고, 폴더를 지원하는 출처(PC)만 펼칠 수 있다", () => {
  const { tree } = setup();
  const rows = tree.rows(cur());
  assert.deepEqual(rows.map((r) => r.name), ["이번에 연 파일", "보관함", "PC", "드라이브"]);
  assert.deepEqual(rows.map((r) => r.expandable), [false, false, true, false]);
  assert.equal(rows[0].current, true);
  assert.equal(rows[2].current, false);
});

test("펼칠 때 하위 폴더만 불러오고(lazy), 접었다 다시 펼쳐도 다시 요청하지 않는다", async () => {
  const { tree, calls } = setup({ pcDirs: { "": ["outputs", "inputs"], outputs: ["outputs/VR", "outputs/ply"] } });
  assert.deepEqual(calls, []);
  await tree.expand("pc", "");
  assert.deepEqual(calls, [["dirs", ""]]);
  assert.deepEqual(names(tree, cur()), ["이번에 연 파일", "보관함", "PC", "  inputs", "  outputs", "드라이브"]);
  await tree.expand("pc", "outputs");
  assert.deepEqual(names(tree, cur()).slice(3), ["  inputs", "  outputs", "    ply", "    VR", "드라이브"]);
  tree.collapse("pc", "");
  assert.deepEqual(names(tree, cur()), ["이번에 연 파일", "보관함", "PC", "드라이브"]);
  await tree.expand("pc", "");
  assert.equal(calls.length, 2, "다시 펼쳐도 추가 요청 없음");
});

test("목록이 준 하위 폴더를 받아 두면(prime) 따로 요청하지 않고 펼쳐진다", async () => {
  const { tree, calls } = setup();
  tree.prime("pc", "", ["outputs"]);
  tree.reveal("pc", "");
  assert.deepEqual(names(tree, cur("pc", "")).slice(2), ["PC", "  outputs", "드라이브"]);
  tree.prime("pc", "outputs", ["outputs/a", "outputs/b"]);
  tree.reveal("pc", "outputs");
  assert.deepEqual(names(tree, cur("pc", "outputs")).slice(2), ["PC", "  outputs", "    a", "    b", "드라이브"]);
  assert.equal(tree.rows(cur("pc", "outputs")).find((r) => r.path === "outputs").current, true);
  assert.deepEqual(calls, []);
});

test("reveal: 아직 모르는 조상은 필요한 한 단계만 임시로 두고, 펼치면 전체를 불러온다", async () => {
  const { tree, calls } = setup({ pcDirs: { "a/b": ["a/b/c", "a/b/z"] } });
  tree.reveal("pc", "a/b/c");
  assert.deepEqual(names(tree, cur("pc", "a/b/c")).slice(2), ["PC", "  a", "    b", "      c", "드라이브"]);
  tree.prime("pc", "a/b", ["a/b/c", "a/b/z"]);
  assert.deepEqual(names(tree, cur("pc", "a/b/c")).slice(2), ["PC", "  a", "    b", "      c", "      z", "드라이브"]);
  assert.deepEqual(calls, []);
});

test("불러오기가 실패하면 error 표시를 남기고 다시 펼칠 때 재시도한다", async () => {
  const { tree, calls } = setup({ pcDirs: { "": "fail" } });
  await tree.expand("pc", "");
  assert.equal(tree.rows(cur()).find((r) => r.sourceId === "pc").error, true);
  assert.equal(calls.length, 1);
  await tree.toggle("pc", ""); // 접기
  await tree.toggle("pc", ""); // 다시 펼치기 → 재시도
  assert.equal(calls.length, 2);
});

test("현재 폴더 행에만 current 표시가 붙는다", () => {
  const { tree } = setup();
  tree.prime("pc", "", ["outputs", "inputs"]);
  tree.reveal("pc", "");
  const rows = tree.rows(cur("pc", "inputs"));
  assert.deepEqual(rows.filter((r) => r.current).map((r) => r.key), [treeKey("pc", "inputs")]);
});

test("출처의 dirs()가 없으면 list(path).dirs를 쓴다", async () => {
  const sources = [{ id: "x", label: "X", browsable: true, list: async (path) => ({ items: [], dirs: path === "" ? ["d1"] : [] }) }];
  const tree = createFolderTree({ listSources: () => sources, getSource: (id) => sources.find((s) => s.id === id) });
  await tree.expand("x", "");
  assert.deepEqual(tree.rows({ sourceId: "x", path: "" }).map((r) => r.name), ["X", "d1"]);
});

// 폴더 트리 상태(순수 로직). 파일 선택창 왼쪽 열(VR 패널·2D 목록)이 같이 쓴다.
//
// 구조: 출처(기기·보관함·PC·드라이브)가 뿌리이고, 폴더를 지원하는 출처(source.browsable)만 그 아래에 폴더가 달린다.
// 하위 폴더는 **필요할 때만** 불러온다(lazy):
//  - 폴더를 골라서 목록이 열리면 그 목록이 준 하위 폴더를 그대로 받아 둔다(prime) — 추가 요청 없음.
//  - [▸]로 펼치기만 할 때는 source.dirs(path)(없으면 source.list(path).dirs)로 그 폴더의 하위 폴더만 받아 온다.
// 현재 폴더까지의 조상은 펼쳐 둔다(reveal). 이미 받은 목록은 기억해서 접었다 펼쳐도 다시 요청하지 않는다.
//
// 행(rows)은 화면에 그릴 평평한 배열이다. 큰 트리여도 보이는 줄만 그리면 되도록 slice는 그리는 쪽이 한다.

import { folderEntries } from "./list-view.js";

/** @typedef {{ sourceId: string, path: string, name: string, depth: number, kind: 'source' | 'dir', expandable: boolean, expanded: boolean, loading: boolean, error: boolean, current: boolean, key: string }} TreeRow */

export const treeKey = (sourceId, path = "") => `${sourceId}|${path}`;

/** "a/b/c" → ["a", "a/b", "a/b/c"] */
function prefixes(path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * @param {{
 *   listSources: () => Array<{ id: string, label: string, browsable?: boolean }>,
 *   getSource: (id: string) => any,
 *   onChange?: () => void,
 * }} options
 */
export function createFolderTree({ listSources, getSource, onChange = () => {} }) {
  /** @type {Set<string>} */
  const expanded = new Set();
  /** key → { dirs: string[], loading: boolean, error: boolean, partial: boolean } */
  const nodes = new Map();

  const node = (key) => nodes.get(key);
  const dirsOf = (sourceId, path) => node(treeKey(sourceId, path))?.dirs ?? null;

  /** 목록이 준 하위 폴더를 받아 둔다(요청 없음). */
  function prime(sourceId, path, dirs) {
    nodes.set(treeKey(sourceId, path), { dirs: folderEntries(dirs).map((d) => d.path), loading: false, error: false, partial: false });
    onChange();
  }

  /** 현재 폴더까지의 조상을 펼쳐 보이게 한다. 아직 모르는 조상의 하위 폴더는 다음 한 단계만 임시로 둔다(partial). */
  function reveal(sourceId, path) {
    expanded.add(treeKey(sourceId, ""));
    let parent = "";
    for (const prefix of prefixes(path)) {
      const key = treeKey(sourceId, parent);
      const existing = node(key);
      if (!existing) nodes.set(key, { dirs: [prefix], loading: false, error: false, partial: true });
      else if (!existing.dirs.includes(prefix)) existing.dirs = [...existing.dirs, prefix].sort();
      expanded.add(treeKey(sourceId, prefix));
      parent = prefix;
    }
    onChange();
  }

  async function load(sourceId, path) {
    const key = treeKey(sourceId, path);
    const source = getSource(sourceId);
    if (!source) return;
    nodes.set(key, { dirs: node(key)?.dirs ?? [], loading: true, error: false, partial: false });
    onChange();
    try {
      const dirs = typeof source.dirs === "function" ? await source.dirs(path) : (await source.list(path)).dirs ?? [];
      nodes.set(key, { dirs: folderEntries(dirs).map((d) => d.path), loading: false, error: false, partial: false });
    } catch {
      nodes.set(key, { dirs: node(key)?.dirs ?? [], loading: false, error: true, partial: false });
    }
    onChange();
  }

  /** 펼친다. 하위 폴더를 아직 모르거나 일부만 알면 그때 불러온다. */
  async function expand(sourceId, path = "") {
    const key = treeKey(sourceId, path);
    expanded.add(key);
    const existing = node(key);
    if (!existing || existing.partial || existing.error) await load(sourceId, path);
    else onChange();
  }

  function collapse(sourceId, path = "") {
    expanded.delete(treeKey(sourceId, path));
    onChange();
  }

  async function toggle(sourceId, path = "") {
    if (expanded.has(treeKey(sourceId, path))) collapse(sourceId, path);
    else await expand(sourceId, path);
  }

  /**
   * 화면에 그릴 평평한 행.
   * @param {{ sourceId: string, path: string }} current 지금 목록이 열려 있는 출처·폴더
   * @returns {TreeRow[]}
   */
  function rows(current) {
    /** @type {TreeRow[]} */
    const out = [];
    const walk = (sourceId, path, depth) => {
      const key = treeKey(sourceId, path);
      const info = node(key);
      for (const child of info?.dirs ?? []) {
        const childKey = treeKey(sourceId, child);
        const childInfo = node(childKey);
        const isOpen = expanded.has(childKey);
        out.push({
          key: childKey,
          sourceId,
          path: child,
          name: child.split("/").filter(Boolean).pop() ?? child,
          depth,
          kind: "dir",
          expandable: true,
          expanded: isOpen,
          loading: !!childInfo?.loading,
          error: !!childInfo?.error,
          current: current.sourceId === sourceId && current.path === child,
        });
        if (isOpen) walk(sourceId, child, depth + 1);
      }
    };
    for (const source of listSources()) {
      const key = treeKey(source.id, "");
      const isOpen = expanded.has(key);
      out.push({
        key,
        sourceId: source.id,
        path: "",
        name: source.label,
        depth: 0,
        kind: "source",
        expandable: !!source.browsable,
        expanded: isOpen && !!source.browsable,
        loading: !!node(key)?.loading,
        error: !!node(key)?.error,
        current: current.sourceId === source.id && current.path === "",
      });
      if (isOpen && source.browsable) walk(source.id, "", 1);
    }
    return out;
  }

  return { rows, prime, reveal, expand, collapse, toggle, dirsOf, isExpanded: (sourceId, path = "") => expanded.has(treeKey(sourceId, path)) };
}

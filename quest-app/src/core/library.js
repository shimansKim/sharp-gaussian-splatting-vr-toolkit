// 목록 상태·현재 항목·이전/다음·뷰어 선택.
// 현재 항목이 바뀌면 kind에 맞는 뷰어를 골라 unload() → load()를 부른다.
// 같은 renderer·XR 세션이 유지되므로 PLY와 영상을 오가도 VR에서 나가지 않는다.
//
// 이벤트: "library:changed"  { sourceId, items }           보이는 목록이 바뀜
//         "item:loading"     { item }
//         "item:opened"      { item }
//         "item:error"       { item, error }
//         "item:closed"      {}                             현재 항목이 해제됨

import { emit } from "./events.js";
import { getSource, viewerFor } from "./registry.js";

/** @typedef {import('./types.js').LibraryItem} LibraryItem */
/** @typedef {import('./types.js').OpenedFile} OpenedFile */
/** @typedef {import('./types.js').Viewer} Viewer */

export function createLibrary() {
  /** 화면에 보이는 목록의 소스 */
  let listSourceId = "session";
  /** @type {LibraryItem[]} */
  let items = [];
  /** @type {LibraryItem | null} */
  let current = null;
  /** 현재 항목을 연 시점의 목록(이전/다음 이동 범위) */
  /** @type {LibraryItem[]} */
  let playlist = [];
  /** @type {Viewer | null} */
  let activeViewer = null;
  /** @type {OpenedFile | null} */
  let activeFile = null;
  let openToken = 0;
  let loading = false;

  const canOpen = (item) => !!viewerFor(item.kind);

  async function refresh(sourceId = listSourceId) {
    const switched = sourceId !== listSourceId;
    listSourceId = sourceId;
    if (switched) {
      // 목록을 기다리는 동안(PC 연결 시도 등) 이전 소스의 목록·패널이 남지 않게 먼저 탭을 바꿔 그린다.
      items = [];
      emit("library:changed", { sourceId, items });
    }
    const source = getSource(sourceId);
    if (!source) {
      items = [];
    } else {
      try {
        items = (await source.list()).items;
      } catch (error) {
        items = [];
        emit("library:error", { sourceId, error });
      }
    }
    // 보이는 목록이 현재 항목의 소스이면 이동 범위도 최신으로 맞춘다(보관함에서 삭제한 경우 등).
    if (current && current.sourceId === listSourceId) playlist = items;
    emit("library:changed", { sourceId: listSourceId, items });
    return items;
  }

  function release() {
    if (activeViewer) {
      try {
        activeViewer.unload();
      } catch (error) {
        console.error("[library] unload failed", error);
      }
      activeViewer = null;
    }
    if (activeFile) {
      try {
        activeFile.release();
      } catch (error) {
        console.error("[library] release failed", error);
      }
      activeFile = null;
    }
  }

  /**
   * 항목을 열어 뷰어에 싣는다. 열기가 겹치면 마지막 요청만 남는다.
   * @param {LibraryItem} item
   * @param {{ playlist?: LibraryItem[] }} [options] 이전/다음 이동 범위(기본: 지금 보이는 목록)
   */
  async function open(item, { playlist: range } = {}) {
    const token = ++openToken;
    const source = getSource(item.sourceId);
    const viewer = viewerFor(item.kind);
    if (!source) return fail(item, new Error(`소스 '${item.sourceId}'를 찾을 수 없습니다.`), token);
    if (!viewer) return fail(item, new Error(`'${item.kind}' 형식 뷰어가 아직 없습니다.`), token);

    loading = true;
    emit("item:loading", { item });
    release();
    current = item;
    playlist = range ?? (item.sourceId === listSourceId ? items : [item]);

    /** @type {OpenedFile | null} */
    let file = null;
    try {
      file = await source.open(item);
      if (token !== openToken) {
        file.release();
        return;
      }
      activeFile = file;
      activeViewer = viewer;
      await viewer.load(item, file);
      if (token !== openToken) return;
      loading = false;
      emit("item:opened", { item });
    } catch (error) {
      if (token !== openToken) return;
      release();
      fail(item, error, token);
    }
  }

  function fail(item, error, token) {
    if (token !== openToken) return;
    loading = false;
    console.error("[library] open failed", item, error);
    emit("item:error", { item, error });
  }

  function close() {
    openToken++;
    release();
    current = null;
    loading = false;
    emit("item:closed", {});
  }

  /** 이동 범위에서 열 수 있는 다음 항목. step은 +1/-1. */
  function neighbor(step) {
    if (!playlist.length) return null;
    const start = Math.max(0, playlist.findIndex((entry) => current && entry.id === current.id));
    for (let offset = 1; offset <= playlist.length; offset++) {
      const n = playlist.length;
      const candidate = playlist[(((start + step * offset) % n) + n) % n];
      if (candidate.id !== current?.id && canOpen(candidate)) return candidate;
    }
    return null;
  }

  return {
    refresh,
    open,
    close,
    canOpen,

    /** 보이는 목록을 바꾼다(소스 탭 전환). 열려 있는 항목은 그대로 둔다. */
    setListSource: (sourceId) => refresh(sourceId),

    next() {
      const item = neighbor(1);
      if (item) return open(item, { playlist });
    },

    prev() {
      const item = neighbor(-1);
      if (item) return open(item, { playlist });
    },

    get listSourceId() {
      return listSourceId;
    },
    get items() {
      return items;
    },
    get current() {
      return current;
    },
    get playlist() {
      return playlist;
    },
    get loading() {
      return loading;
    },
    get activeViewer() {
      return activeViewer;
    },
  };
}

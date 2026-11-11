// 목록 상태·현재 항목·이전/다음·뷰어 선택.
// 현재 항목이 바뀌면 kind에 맞는 뷰어를 골라 unload() → load()를 부른다.
// 같은 renderer·XR 세션이 유지되므로 PLY와 영상을 오가도 VR에서 나가지 않는다.
//
// 이벤트: "library:changed"  { sourceId, items, folder }  보이는 목록이 바뀜(items는 필터·정렬을 거친 것)
//         "item:loading"     { item }
//         "item:opened"      { item }
//         "item:error"       { item, error }
//         "item:closed"      {}                             현재 항목이 해제됨
//
// 다음 파일 미리 받기: 항목을 다 연 뒤 prefetchDelayMs가 지나면 다음(방금 이전을 눌렀다면 이전) 파일을 받아 둔다(core/prefetch.js).

import { emit } from "./events.js";
import { applyView, folderEntries, loadView, normalizeView, parentPath, saveView } from "./list-view.js";
import { createPrefetcher } from "./prefetch.js";
import { getSource, viewerFor } from "./registry.js";

/** @typedef {import('./types.js').LibraryItem} LibraryItem */
/** @typedef {import('./types.js').OpenedFile} OpenedFile */
/** @typedef {import('./types.js').Viewer} Viewer */

/**
 * @param {{ prefetchDelayMs?: number, prefetcher?: ReturnType<typeof createPrefetcher> }} [options]
 */
export function createLibrary({ prefetchDelayMs = 1200, prefetcher = createPrefetcher({ getSource, viewerFor }) } = {}) {
  /** 화면에 보이는 목록의 소스 */
  let listSourceId = "session";
  /** 소스가 준 원본 목록(필터·정렬 전) */
  /** @type {LibraryItem[]} */
  let rawItems = [];
  /** 보이는 목록: rawItems에 종류 필터·정렬을 적용한 것 */
  /** @type {LibraryItem[]} */
  let items = [];
  /** 소스가 준 하위 폴더(PC). 폴더를 지원하지 않는 소스는 빈 배열 */
  let rawDirs = [];
  /** 프레임 시퀀스 폴더 바로가기(PC 최상위): [{ id, path, name, count, mtime }] */
  let rawSequences = [];
  /** 종류별 전체 개수(PC 최상위, 시퀀스 제외): { splat, video, image } */
  let rawCounts = null;
  /** 소스가 상한에 걸려 목록이 잘렸는지(폴더가 아주 클 때) */
  let truncated = false;
  /** 시퀀스 폴더 묶음을 펼쳤는지(2D·VR 패널이 같이 쓴다). 폴더·소스가 바뀌면 접는다. */
  let sequencesExpanded = false;
  /** 지금 보는 폴더 경로. ""는 최상위(PC는 최근 파일 + 공유 폴더 목록) */
  let folderPath = "";
  let view = loadView();
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
  /** 마지막으로 이동한 방향(+1 다음, -1 이전). 미리 받을 쪽을 정한다. */
  let lastStep = 1;
  let prefetchTimer = 0;

  const canOpen = (item) => !!viewerFor(item.kind);

  function clearListing() {
    rawItems = [];
    rawDirs = [];
    rawSequences = [];
    rawCounts = null;
    truncated = false;
  }

  const recompute = () => {
    items = applyView(rawItems, view);
  };

  let refreshToken = 0;

  /**
   * 목록을 다시 불러온다. 소스를 바꾸면 최상위 폴더로 돌아가고, 같은 소스를 다시 부르면 보던 폴더를 유지한다.
   * @param {string} [sourceId]
   * @param {{ path?: string }} [options] path: 열 폴더(소스가 폴더를 지원할 때)
   */
  async function refresh(sourceId = listSourceId, { path } = {}) {
    const switched = sourceId !== listSourceId;
    listSourceId = sourceId;
    if (switched) folderPath = "";
    if (path !== undefined) folderPath = path;
    if (switched || path !== undefined) sequencesExpanded = false;
    const token = ++refreshToken;
    if (switched || path !== undefined) {
      // 목록을 기다리는 동안(PC 연결 시도 등) 이전 목록·패널이 남지 않게 먼저 비워서 그린다.
      clearListing();
      recompute();
      emit("library:changed", { sourceId, items, folder: folderPath });
    }
    const source = getSource(sourceId);
    let failed = false;
    if (!source) {
      clearListing();
    } else {
      try {
        // 최상위에서 종류를 고르면 서버에서 그 종류만 다시 받는다(최신 몇 개 한도에 다른 종류가 끼지 않게). 폴더 안은 클라이언트에서 거른다.
        const kind = folderPath === "" && view.kind !== "all" ? view.kind : undefined;
        const result = await source.list(folderPath, kind ? { kind } : undefined);
        if (token !== refreshToken) return items; // 그 사이 다른 목록을 요청했다
        rawItems = result.items;
        rawDirs = result.dirs ?? [];
        rawSequences = folderPath === "" ? (result.sequences ?? []) : [];
        rawCounts = folderPath === "" ? (result.counts ?? null) : null;
        truncated = !!result.truncated;
      } catch (error) {
        if (token !== refreshToken) return items;
        clearListing();
        failed = true;
        emit("library:error", { sourceId, error });
      }
    }
    recompute();
    // 보이는 목록이 현재 항목의 소스이면 이동 범위도 최신으로 맞춘다(보관함에서 삭제한 경우 등).
    if (current && current.sourceId === listSourceId) playlist = items;
    emit("library:changed", { sourceId: listSourceId, items, folder: folderPath, failed });
    return items;
  }

  /**
   * 종류 필터·정렬을 바꾼다(저장됨). 먼저 지금 목록을 다시 거르고, 종류가 바뀌었고 최상위 목록이면
   * 소스에서 그 종류만 다시 받는다(서버가 종류별 최근 목록을 줄 때 1000개 한도에 가려지지 않게).
   */
  function setView(next) {
    const before = view.kind;
    view = normalizeView({ ...view, ...next });
    saveView(view);
    recompute();
    if (current && current.sourceId === listSourceId) playlist = items;
    emit("library:changed", { sourceId: listSourceId, items, folder: folderPath });
    if (view.kind !== before && folderPath === "") refresh(listSourceId);
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

    clearTimeout(prefetchTimer);
    loading = true;
    emit("item:loading", { item });
    release();
    current = item;
    playlist = range ?? (item.sourceId === listSourceId ? items : [item]);

    /** @type {OpenedFile | null} */
    let file = null;
    try {
      // 미리 받아 둔 파일이 있으면 그것을 쓴다(없으면 평소처럼 소스에서 연다). 받는 중이던 다른 항목은 대역폭을 위해 버린다.
      file = await prefetcher.take(item);
      if (token === openToken && !file) file = await source.open(item);
      if (token !== openToken) {
        file?.release();
        return;
      }
      activeFile = file;
      activeViewer = viewer;
      await viewer.load(item, file);
      if (token !== openToken) return;
      loading = false;
      emit("item:opened", { item });
      schedulePrefetch();
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

  /** 현재 항목을 다 연 뒤 이동 방향의 이웃 파일을 받아 두기 시작한다(영상을 보는 중에는 하지 않는다). */
  function schedulePrefetch() {
    clearTimeout(prefetchTimer);
    if (prefetchDelayMs < 0) return;
    if (!current || current.kind === "video") {
      prefetcher.cancel();
      return;
    }
    prefetchTimer = setTimeout(() => {
      const target = current ? neighbor(lastStep) : null;
      if (target && target.id !== current?.id) prefetcher.schedule(target);
      else prefetcher.cancel();
    }, prefetchDelayMs);
  }

  function close() {
    clearTimeout(prefetchTimer);
    prefetcher.cancel();
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

    setView,

    /** 폴더로 들어간다. path는 소스가 준 경로(예: "outputs/VR"). "" 는 최상위(최근 파일). */
    openFolder: (path) => refresh(listSourceId, { path }),

    /** 상위 폴더로 간다. 최상위에서는 아무 일도 하지 않는다. */
    upFolder: () => (folderPath ? refresh(listSourceId, { path: parentPath(folderPath) }) : Promise.resolve(items)),

    next() {
      const item = neighbor(1);
      if (!item) return undefined;
      lastStep = 1;
      return open(item, { playlist });
    },

    prev() {
      const item = neighbor(-1);
      if (!item) return undefined;
      lastStep = -1;
      return open(item, { playlist });
    },

    /** 이전/다음으로 갈 수 있는 항목이 있는지(현재 말고 열 수 있는 것이 있을 때) */
    get canStep() {
      return neighbor(1) !== null;
    },

    /** 미리 받기 상태(진단·테스트용): { itemId, done, ready } 또는 null */
    get prefetchState() {
      return prefetcher.state;
    },

    get listSourceId() {
      return listSourceId;
    },
    /** 보이는 파일 목록(종류 필터·정렬 적용) */
    get items() {
      return items;
    },
    /** 프레임 시퀀스 폴더 바로가기(최상위에서만): [{ id, path, name, count, mtime }]. path로 구분한다. */
    get sequences() {
      return rawSequences;
    },
    /** 시퀀스 폴더가 둘 이상이면 「프레임 시퀀스 N곳」 한 줄로 접어 두고, 누르면 펼친다. */
    get sequencesExpanded() {
      return sequencesExpanded;
    },
    toggleSequences() {
      sequencesExpanded = !sequencesExpanded;
      emit("library:changed", { sourceId: listSourceId, items, folder: folderPath });
    },
    /** 서버에 더 있지만 이 목록에 없는 파일 수(「외 N개」). 알 수 없으면 0 */
    get hiddenCount() {
      if (!rawCounts) return 0;
      const total = view.kind === "all" ? Object.values(rawCounts).reduce((a, n) => a + (n || 0), 0) : rawCounts[view.kind] || 0;
      return Math.max(0, total - rawItems.length);
    },
    /** 소스가 상한에 걸려 목록이 잘렸는지 */
    get truncated() {
      return truncated;
    },
    /** 필터 전 원본 파일 목록 */
    get allItems() {
      return rawItems;
    },
    /** 보이는 하위 폴더: [{ path, name }] */
    get folders() {
      return folderEntries(rawDirs);
    },
    get folder() {
      return folderPath;
    },
    /** 폴더 이동을 보여 줄지(하위 폴더가 있거나 폴더 안에 들어와 있을 때) */
    get canBrowse() {
      return rawDirs.length > 0 || rawSequences.length > 0 || folderPath !== "";
    },
    get view() {
      return view;
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

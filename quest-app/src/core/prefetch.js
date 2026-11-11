// 다음 파일 미리 받기(공용 틀). PLY·사진처럼 "통째로 받아야 보이는" 파일을 현재 항목을 다 연 뒤에 메모리(Blob)로 받아 둔다.
// 이어서 그 항목을 열면 library가 take()로 받아 둔 파일을 넘겨, 네트워크·디스크 대기 없이 바로 뷰어에 싣는다.
//
// 규칙(메모리·대역폭 보호):
//  - 한 번에 한 항목만 받아 둔다(다음 후보가 바뀌면 이전 것은 버린다).
//  - 종류별 크기 한도를 넘으면 받지 않는다(받는 도중 넘어도 멈춘다). 한도는 registry의 setPrefetchLimit로 정한다.
//  - 원격 소스(PC·드라이브)만 받는다. 기기 파일·보관함은 이미 로컬이라 복사하지 않는다.
//  - 영상은 받지 않는다(스트리밍). 영상을 재생하는 동안에는 대역폭을 쓰지 않는다.
//  - 실패해도 조용히 포기한다. 열 때 평소대로 소스에서 받는다.
//
// 두 방식이 있다.
//  1) 뷰어가 prefetch(item, file)를 내놓으면(PLY: splat-viewer) 그 항목의 OpenedFile을 그대로 넘기고 뷰어가 자기 방식으로 받아 둔다.
//     뷰어는 discardPrefetch()로 받아 둔 것을 버린다. 열 때는 평소처럼 load(item, file)이 불리고, 뷰어가 prefetchedItemId로 알아본다.
//  2) 내놓지 않으면(사진) 공용으로 통째로 Blob에 받아 두고, 사진은 디코드까지 미리 해 둔다. 열 때 그 Blob 파일을 넘긴다.

import { prefetchLimitFor } from "./registry.js";

/** 미리 받기 대상이 되는 소스. 이미 로컬인 소스는 제외한다. */
const REMOTE_SOURCES = new Set(["pc", "gdrive"]);

/** @typedef {import('./types.js').LibraryItem} LibraryItem */
/** @typedef {import('./types.js').OpenedFile} OpenedFile */

/**
 * @param {{
 *   getSource: (id: string) => import('./types.js').Source | undefined,
 *   limitFor?: (kind: string) => number,
 * }} options
 */
export function createPrefetcher({ getSource, viewerFor = () => undefined, limitFor = prefetchLimitFor }) {
  /** @type {null | { item: LibraryItem, viewer: any, controller: AbortController, promise: Promise<OpenedFile | null>, file: OpenedFile | null, done: boolean, decoded?: any }} */
  let slot = null;

  /** 항목이 미리 받기 대상인지(크기·종류·소스). */
  function eligible(item) {
    if (!item || !REMOTE_SOURCES.has(item.sourceId)) return false;
    const limit = limitFor(item.kind);
    if (!limit) return false;
    if (typeof item.size === "number" && item.size > limit) return false;
    return !!getSource(item.sourceId);
  }

  function drop() {
    if (!slot) return;
    const old = slot;
    slot = null;
    old.controller.abort();
    // 뷰어가 받아 둔 것은 뷰어가 버린다.
    if (old.viewer) {
      try {
        old.viewer.discardPrefetch?.();
      } catch (error) {
        console.warn("[prefetch] discardPrefetch 실패", error);
      }
    }
    // 받는 중이었다면 끝난 뒤 정리한다.
    old.promise.then((file) => file?.release()).catch(() => {});
  }

  /** @param {OpenedFile} opened @param {number} limit @param {AbortSignal} signal */
  async function readAll(opened, limit, signal) {
    const chunks = [];
    let total = 0;
    if (opened.stream) {
      const reader = (await opened.stream()).getReader();
      signal.addEventListener("abort", () => reader.cancel().catch(() => {}), { once: true });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
    } else {
      const response = await fetch(opened.url, { signal });
      if (!response.ok) return null;
      const length = Number(response.headers.get("content-length"));
      if (length > limit) return null;
      const blob = await response.blob();
      if (blob.size > limit) return null;
      return blob;
    }
    return new Blob(chunks, opened.mime ? { type: opened.mime } : undefined);
  }

  return {
    eligible,

    /** 이 항목을 받아 두기 시작한다. 이미 같은 항목이면 그대로 둔다. */
    schedule(item) {
      if (!eligible(item)) {
        drop();
        return;
      }
      if (slot && slot.item.id === item.id) return;
      drop();
      const controller = new AbortController();
      const viewer = viewerFor(item.kind);
      const viaViewer = typeof viewer?.prefetch === "function" ? viewer : null;
      const entry = { item, viewer: viaViewer, controller, promise: /** @type {Promise<OpenedFile | null>} */ (Promise.resolve(null)), file: null, done: false };
      entry.promise = (async () => {
        const source = getSource(item.sourceId);
        let opened = null;
        try {
          opened = await source.open(item);
          if (controller.signal.aborted) return null;
          if (viaViewer) {
            await viaViewer.prefetch(item, opened);
            return null;
          }
          const blob = await readAll(opened, limitFor(item.kind), controller.signal);
          if (!blob || controller.signal.aborted) return null;
          const url = URL.createObjectURL(blob);
          /** @type {OpenedFile} */
          const file = {
            url,
            stream: async () => blob.stream(),
            size: blob.size,
            name: opened.name ?? item.name,
            mime: opened.mime ?? item.mime,
            release: () => URL.revokeObjectURL(url),
          };
          entry.file = file;
          if (item.kind === "image" && typeof Image !== "undefined") {
            // 디코드까지 미리 해 둔다(같은 blob URL로 열 때 브라우저의 디코드 캐시를 쓴다). 실패해도 무시.
            const img = new Image();
            img.src = url;
            entry.decoded = img;
            await img.decode?.().catch(() => {});
          }
          return file;
        } catch (error) {
          if (!controller.signal.aborted) console.warn("[prefetch] 포기", item.name, error?.message ?? error);
          return null;
        } finally {
          entry.done = true;
          try {
            opened?.release();
          } catch {
            /* 무시 */
          }
        }
      })();
      slot = entry;
    },

    /**
     * 이 항목을 미리 받아 두었으면 그 파일을 돌려주고 슬롯을 비운다(release는 받은 쪽 책임).
     * 아직 받는 중이면 끝나길 기다리고, 실패했으면 null.
     * @param {LibraryItem} item
     * @returns {Promise<OpenedFile | null>}
     */
    async take(item) {
      if (slot && slot.item.id !== item.id) drop(); // 다른 항목을 연다: 받던 것은 버린다(대역폭·메모리)
      if (!slot) return null;
      const entry = slot;
      slot = null;
      // 뷰어 방식이면 뷰어가 받아 둔 것을 load()에서 쓴다(여기서 버리지 않는다). 받는 중이면 끝나길 기다린다.
      return entry.promise;
    },

    /** 받아 둔 것·받는 중인 것을 모두 버린다(항목을 닫을 때 등). */
    cancel: drop,

    /** 테스트·진단용 */
    get state() {
      return slot ? { itemId: slot.item.id, done: slot.done, ready: !!slot.file } : null;
    },
  };
}

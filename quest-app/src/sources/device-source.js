// 기기 소스: 이번에 연 파일(session)과 앱 보관함(library).
// - session: <input type=file> 또는 끌어놓기로 고른 File. 앱을 닫으면 사라진다.
// - library: OPFS 복사본 + IndexedDB 메타데이터. 앱을 다시 열어도 남는다.
// (FileSystemFileHandle 저장은 Android 동작이 불확실해 아직 넣지 않았다. 설계 3.2의 보조 기능.)

import { classifyFile } from "../core/kinds.js";
import * as store from "../core/store.js";

/** @typedef {import('../core/types.js').LibraryItem} LibraryItem */
/** @typedef {import('../core/types.js').OpenedFile} OpenedFile */
/** @typedef {import('../core/types.js').Source} Source */

/**
 * File/Blob에서 OpenedFile을 만든다. 본문을 읽지 않고 blob URL과 스트림 팩토리만 만든다.
 * @param {Blob} blob
 * @param {string} name
 * @returns {OpenedFile}
 */
export function openedFromBlob(blob, name) {
  let url = "";
  return {
    get url() {
      if (!url) url = URL.createObjectURL(blob);
      return url;
    },
    stream: async () => blob.stream(),
    size: blob.size,
    name,
    mime: blob.type || undefined,
    release() {
      if (url) URL.revokeObjectURL(url);
      url = "";
    },
  };
}

/** 정렬: 이름 오름차순(자연 정렬). 같은 이름은 수정 시각이 최신인 것이 앞. */
function byName(a, b) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || (b.mtime ?? 0) - (a.mtime ?? 0);
}

/**
 * 이번에 연 파일 소스. 목록은 addFiles로 쌓는다.
 * @returns {Source & {
 *   addFiles(files: Iterable<File>): { added: LibraryItem[], skipped: string[] },
 *   getFile(id: string): File | undefined,
 *   clear(): void,
 * }}
 */
export function createSessionSource() {
  /** @type {Map<string, { item: LibraryItem, file: File }>} */
  const entries = new Map();
  let serial = 0;

  return {
    id: "session",
    label: "이번에 연 파일",

    addFiles(files) {
      const added = [];
      const skipped = [];
      for (const file of files) {
        const kind = classifyFile(file.name, file.type);
        if (!kind) {
          skipped.push(file.name);
          continue;
        }
        const id = `session:${++serial}:${file.name}`;
        /** @type {LibraryItem} */
        const item = { id, sourceId: "session", name: file.name, kind, size: file.size, mime: file.type || undefined, mtime: file.lastModified };
        entries.set(id, { item, file });
        added.push(item);
      }
      return { added, skipped };
    },

    getFile(id) {
      return entries.get(id)?.file;
    },

    clear() {
      entries.clear();
    },

    async list() {
      return { items: [...entries.values()].map((entry) => entry.item).sort(byName) };
    },

    async open(item) {
      const file = entries.get(item.id)?.file;
      if (!file) throw new Error("이번에 연 파일이 아닙니다. 다시 선택해 주세요.");
      return openedFromBlob(file, item.name);
    },
  };
}

/**
 * 앱 보관함 소스.
 * @returns {Source & {
 *   keep(item: LibraryItem, opened: OpenedFile, onProgress?: (written: number) => void): Promise<LibraryItem>,
 *   find(item: LibraryItem): Promise<LibraryItem | undefined>,
 *   remove(item: LibraryItem): Promise<void>,
 *   update(id: string, patch: Partial<LibraryItem>): Promise<void>,
 * }}
 */
export function createLibrarySource() {
  const originKey = (item) => `${item.sourceId}|${item.name}|${item.size ?? ""}|${item.mtime ?? ""}`;

  async function records() {
    return (await store.listRecords()).filter((record) => record.id.startsWith("library:"));
  }

  return {
    id: "library",
    label: "보관함",

    async list() {
      const items = (await records()).map(toItem).sort(byName);
      return { items };
    },

    async open(item) {
      const record = (await records()).find((entry) => entry.id === item.id);
      if (!record) throw new Error("보관함에서 파일을 찾을 수 없습니다.");
      const blob = await store.readBody(record.body.name, record.body.backend);
      return openedFromBlob(blob, record.name);
    },

    /** 이미 보관한 같은 파일(이름·크기·수정 시각·출처가 같음)이 있으면 그 항목을 돌려준다. */
    async find(item) {
      const key = originKey(item);
      const record = (await records()).find((entry) => entry.originKey === key);
      return record ? toItem(record) : undefined;
    },

    async keep(item, opened, onProgress) {
      const existing = await this.find(item);
      if (existing) return existing;

      await store.requestPersistence();
      const bodyName = crypto.randomUUID();
      const stream = opened.stream ? await opened.stream() : (await fetch(opened.url)).body;
      if (!stream) throw new Error("파일을 읽을 수 없습니다.");
      const { backend, written } = await store.writeBody(bodyName, stream, { onProgress, type: opened.mime });

      const record = {
        id: `library:${bodyName}`,
        sourceId: "library",
        name: item.name,
        kind: item.kind,
        size: written,
        mime: item.mime,
        mtime: item.mtime ?? Date.now(),
        layout: item.layout,
        originKey: originKey(item),
        addedAt: Date.now(),
        body: { name: bodyName, backend },
      };
      try {
        await store.putRecord(record);
      } catch (error) {
        await store.removeBody(bodyName, backend);
        throw error;
      }
      return toItem(record);
    },

    async remove(item) {
      const record = (await records()).find((entry) => entry.id === item.id);
      if (!record) return;
      await store.removeBody(record.body.name, record.body.backend);
      await store.deleteRecord(record.id);
    },

    /** 항목별 설정(예: 사용자가 바꾼 영상 layout)을 보관함에 기억한다. */
    async update(id, patch) {
      const record = (await records()).find((entry) => entry.id === id);
      if (!record) return;
      await store.putRecord({ ...record, ...patch, id: record.id, sourceId: "library", body: record.body });
    },
  };
}

/** @returns {LibraryItem} */
function toItem(record) {
  return {
    id: record.id,
    sourceId: "library",
    name: record.name,
    kind: record.kind,
    size: record.size,
    mime: record.mime,
    mtime: record.mtime,
    layout: record.layout,
  };
}

/**
 * 기기 저장소에서 파일을 고르는 시스템 선택기를 연다. 사용자 제스처(클릭) 안에서 불러야 한다.
 * `.ply`는 표준 MIME이 없어 accept로 거르면 파일이 숨겨질 수 있으므로 accept를 비운다.
 * @param {{ accept?: string, multiple?: boolean }} [options]
 * @returns {Promise<File[]>} 취소하면 빈 배열
 */
export function pickDeviceFiles({ accept = "", multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.style.display = "none";
    const finish = (files) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish([...(input.files ?? [])]));
    input.addEventListener("cancel", () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

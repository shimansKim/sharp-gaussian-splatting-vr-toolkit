// 앱 저장소: IndexedDB(목록 메타데이터·설정) + OPFS(보관한 파일 본문).
// OPFS를 쓸 수 없는 환경이면 IndexedDB의 blobs 스토어에 Blob을 그대로 넣는다.
// 모든 함수는 저장소가 막혀 있어도(시크릿 창 등) 예외를 호출자에게 그대로 던지므로, 호출자가 처리한다.

const DB_NAME = "sharp-quest-app";
const DB_VERSION = 1;
const OPFS_DIR = "library";

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("library")) db.createObjectStore("library", { keyPath: "id" });
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/**
 * @template T
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T>} run
 * @returns {Promise<T>}
 */
async function request(storeName, mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = run(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---- 목록 메타데이터 ----

/** @returns {Promise<any[]>} */
export function listRecords() {
  return request("library", "readonly", (store) => store.getAll());
}

/** @param {any} record */
export function putRecord(record) {
  return request("library", "readwrite", (store) => store.put(record));
}

/** @param {string} id */
export function deleteRecord(id) {
  return request("library", "readwrite", (store) => store.delete(id));
}

// ---- 설정(key-value) ----

/** @param {string} key */
export function kvGet(key) {
  return request("kv", "readonly", (store) => store.get(key));
}

/**
 * @param {string} key
 * @param {any} value
 */
export function kvSet(key, value) {
  return request("kv", "readwrite", (store) => store.put(value, key));
}

// ---- 파일 본문 ----

/** OPFS 사용 가능 여부(기능 감지). */
export function hasOpfs() {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

async function opfsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

/**
 * 스트림을 보관함에 저장한다. 저장 위치 이름(`path`)과 방식을 돌려준다.
 * @param {string} name 저장 이름(고유해야 함)
 * @param {ReadableStream<Uint8Array>} stream
 * @param {{ size?: number, onProgress?: (written: number) => void, type?: string }} [options]
 * @returns {Promise<{ backend: 'opfs' | 'idb', written: number }>}
 */
export async function writeBody(name, stream, { onProgress, type } = {}) {
  let written = 0;
  const counted = stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        written += chunk.byteLength;
        onProgress?.(written);
        controller.enqueue(chunk);
      },
    }),
  );

  if (hasOpfs()) {
    const dir = await opfsDir();
    const handle = await dir.getFileHandle(name, { create: true });
    try {
      const writable = await handle.createWritable();
      await counted.pipeTo(writable);
      return { backend: "opfs", written };
    } catch (error) {
      await dir.removeEntry(name).catch(() => {});
      throw error;
    }
  }

  const blob = await new Response(counted, { headers: type ? { "content-type": type } : {} }).blob();
  await request("blobs", "readwrite", (store) => store.put(blob, name));
  return { backend: "idb", written };
}

/**
 * 보관한 파일을 File(또는 Blob)로 연다. 본문을 메모리로 읽지 않는다(OPFS는 디스크 참조).
 * @param {string} name
 * @param {'opfs' | 'idb'} backend
 * @returns {Promise<Blob>}
 */
export async function readBody(name, backend) {
  if (backend === "opfs") {
    const dir = await opfsDir();
    const handle = await dir.getFileHandle(name);
    return handle.getFile();
  }
  const blob = await request("blobs", "readonly", (store) => store.get(name));
  if (!blob) throw new Error("보관된 파일을 찾을 수 없습니다.");
  return blob;
}

/**
 * @param {string} name
 * @param {'opfs' | 'idb'} backend
 */
export async function removeBody(name, backend) {
  if (backend === "opfs") {
    const dir = await opfsDir();
    await dir.removeEntry(name).catch(() => {});
    return;
  }
  await request("blobs", "readwrite", (store) => store.delete(name));
}

// ---- 용량 ----

/** 보관함을 브라우저가 임의로 지우지 않게 요청한다. 결과는 true/false. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** @returns {Promise<{ usage: number, quota: number, persisted: boolean } | null>} */
export async function storageEstimate() {
  try {
    const estimate = await navigator.storage.estimate();
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
  } catch {
    return null;
  }
}

// PC 소스: app의 Source 계약(core/types.js, 설계 7.3) 구현.
// 목록은 PC 서버 API(/api/list, /api/recent), 열기는 서비스 워커 프록시(없으면 직접 URL).
// 소유: sync-dev.
//
// 경로 규칙: `<root>/<상대 경로>` (예: "outputs/VR/clip.mp4"). 빈 문자열은 최상위.
//
// list(path, { kind }) 가 돌려주는 모양
//   최상위(path ""): { items, dirs, sequences, counts }
//     items      서버가 종류별로 고르게 모은 최근 미디어(영상·PLY 위주, 사진은 최근 일부, 프레임 시퀀스는 제외)
//     dirs       루트 폴더 id 목록
//     sequences  프레임 시퀀스 폴더 바로가기 [{ id, path, name, count, mtime }]  (path로 list(path)를 열면 프레임이 모두 나온다)
//     counts     프레임 시퀀스를 뺀 종류별 전체 개수 { splat, video, image } (목록이 상한으로 잘렸는지 알 수 있다)
//     kind를 주면 서버에서 그 종류만 다시 받는다(최신 1000개 한도에 다른 종류가 끼어들지 않는다).
//   폴더(path "root/..."): { items, dirs, total, truncated }
//     서버가 5000개씩 나눠 주는 목록을 nextOffset이 없어질 때까지 이어 받는다(MAX_FOLDER_ITEMS까지).
//     kind를 주면 받은 항목을 그 종류로 거른다.

import { createPcConnection, describeOffline, lnaInit } from "./pc-connect.js";
import { configureProxy, encodePath, ensureProxyControl, proxyAvailable, proxyUrl } from "./proxy-url.js";

const RECENT_LIMIT = 1000; // 서버 상한(MAX_RECENT)과 같다
const FOLDER_PAGE = 5000; // 서버 상한(MAX_LIST)과 같다
const MAX_FOLDER_ITEMS = 20000; // 한 폴더에서 이어 받는 항목 수 상한(그 이상은 truncated로 알린다)
const KINDS = new Set(["splat", "video", "image"]);

/**
 * @param {object} [options]
 * @param {ReturnType<typeof createPcConnection>} [options.connection]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.baseUrl]   앱 base 경로 (프록시 URL용)
 * @param {number} [options.recentLimit]
 * @param {Parameters<typeof createPcConnection>[0]} [options.connectionOptions]  connection을 주지 않을 때 만들 연결의 옵션(예: allowTunnel)
 * @param {{ ensureControl?: () => Promise<boolean>, configure?: (id: string, config: object) => Promise<boolean>, available?: () => boolean }} [options.proxy]
 *        서비스 워커 프록시 훅(테스트용). 기본은 proxy-url.js의 실제 함수.
 */
export function createPcSource(options = {}) {
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const connection = options.connection ?? createPcConnection({ fetch: fetchImpl, ...options.connectionOptions });
  const recentLimit = options.recentLimit ?? RECENT_LIMIT;
  const proxyHooks = {
    ensureControl: options.proxy?.ensureControl ?? (() => ensureProxyControl()),
    configure: options.proxy?.configure ?? ((id, config) => configureProxy(id, config)),
    available: options.proxy?.available ?? (() => proxyAvailable()),
  };

  /**
   * 서비스 워커 프록시가 이 파일을 실제로 내주는지 아주 작은 Range 요청(1바이트)으로 확인한다.
   * Quest 실기기에서는 페이지의 직접 요청은 되는데 서비스 워커의 http 요청은 502로 막혔다. 그런 경우에는 프록시를 쓰지 않는다.
   */
  async function proxyServes(url) {
    try {
      const response = await fetchImpl(url, { headers: { Range: "bytes=0-0" }, cache: "no-store", signal: AbortSignal.timeout(4000) });
      try {
        await response.body?.cancel();
      } catch {
        /* 본문을 읽지 않고 닫는다 */
      }
      return response.ok;
    } catch {
      return false;
    }
  }

  async function api(pathAndQuery) {
    const state = await connection.ensure();
    if (state.status !== "connected") throw new PcConnectionError(state);
    try {
      const response = await fetchImpl(`${state.base}${pathAndQuery}`, lnaInit(state.base, { cache: "no-store" }));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      // 서버가 꺼졌거나 PC 주소가 바뀐 경우: 다음 호출에서 다시 탐색한다.
      connection.markLost();
      throw error;
    }
  }

  /** 서버 항목 → LibraryItem. kind 없는 파일은 거른다. */
  function toItem(entry) {
    const path = `${entry.root}/${entry.path}`;
    return {
      id: `pc:${path}`,
      sourceId: "pc",
      name: entry.name,
      kind: entry.kind,
      size: entry.size ?? undefined,
      mtime: entry.mtime ?? undefined,
      path,
    };
  }

  /** 서버 시퀀스 폴더 → 바로가기 항목. path는 list()에 그대로 넣을 수 있다. */
  function toSequence(entry) {
    const path = entry.path ? `${entry.root}/${entry.path}` : entry.root;
    return { id: `pc:${path}`, path, name: entry.name, count: entry.count ?? 0, mtime: entry.mtime ?? undefined };
  }

  function splitPath(path) {
    const parts = String(path ?? "").split("/").filter(Boolean);
    return { root: parts[0] ?? "", rel: parts.slice(1).join("/") };
  }

  return {
    id: "pc",
    label: "PC",
    /** 폴더 트리(core/folder-tree.js)에서 이 출처 아래에 폴더를 펼칠 수 있다. */
    browsable: true,
    connection,

    /** 연결 시도. UI의 [PC] 탭/다시 연결 버튼 클릭 핸들러에서 부른다. */
    connect: () => connection.connect(),

    /**
     * @param {string} [path]
     * @param {{ kind?: 'splat'|'video'|'image'|'all' }} [options]
     */
    async list(path = "", { kind } = {}) {
      const wanted = KINDS.has(kind) ? kind : null;
      const { root, rel } = splitPath(path);
      if (!root) {
        // 연결을 한 번만 시도한다. 실패한 상태에서 api()를 또 부르면 대역 탐색이 한 바퀴 더 돈다(서버가 꺼져 있으면 몇 분 더).
        const state = await connection.ensure();
        if (state.status !== "connected") throw new PcConnectionError(state);
        const info = state.info ?? (await api("/api/info"));
        const query = wanted ? `&kind=${encodeURIComponent(wanted)}` : "";
        const recent = await api(`/api/recent?limit=${recentLimit}${query}`);
        return {
          items: recent.items.filter((e) => e.kind).map(toItem),
          dirs: (info.roots ?? []).map((r) => r.id),
          sequences: (recent.sequences ?? []).map(toSequence),
          counts: { splat: 0, video: 0, image: 0, ...(recent.counts ?? {}) },
        };
      }
      // 서버는 한 번에 FOLDER_PAGE개까지 준다. 끝(nextOffset 없음)까지 이어 받되 MAX_FOLDER_ITEMS에서 멈춘다.
      const entries = [];
      let offset = 0;
      let total = 0;
      let truncated = false;
      for (;;) {
        const page = await api(`/api/list?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}&offset=${offset}&limit=${FOLDER_PAGE}`);
        entries.push(...page.items);
        total = page.total ?? entries.length;
        const next = page.nextOffset;
        if (next == null || next <= offset) break; // 끝(옛 서버는 nextOffset이 없어 첫 쪽에서 끝난다)
        if (entries.length >= MAX_FOLDER_ITEMS) {
          truncated = true;
          break;
        }
        offset = next;
      }
      const files = entries.filter((e) => e.type === "file" && e.kind && (!wanted || e.kind === wanted));
      return {
        items: files.map(toItem),
        dirs: entries.filter((e) => e.type === "dir").map((e) => `${e.root}/${e.path}`),
        total,
        truncated,
      };
    },

    /**
     * 목록·트리를 불러오는 동안 보일 안내. 아직 연결 전이면 대역 탐색(처음 한 번 30초쯤)이 걸리므로 멈춘 게 아니라고 알린다. 연결돼 있으면 "".
     * @returns {string}
     */
    searchHint() {
      return connection.state?.status === "connected" ? "" : "PC 찾는 중(처음 한 번 최대 30초)";
    },

    /**
     * 목록이 비었을 때 보일 안내. PC에 연결되지 않았으면 오류 대신 "PC 없이도 기기 파일을 열 수 있다"는 쉬운 안내. 연결돼 있으면 "".
     * @param {{ vr?: boolean }} [options]
     * @returns {string}
     */
    offlineHint(options) {
      return connection.state?.status === "connected" ? "" : describeOffline(options);
    },

    /**
     * 폴더 트리용: 그 폴더의 하위 폴더 경로만(파일 목록·최근 목록을 받지 않는다). 서버가 하위 폴더를 먼저 주므로 첫 쪽이면 충분하다.
     * @param {string} [path] ""이면 공유 폴더(루트) 목록
     * @returns {Promise<string[]>}
     */
    async dirs(path = "") {
      const { root, rel } = splitPath(path);
      if (!root) {
        const state = await connection.ensure();
        if (state.status !== "connected") throw new PcConnectionError(state);
        const info = state.info ?? (await api("/api/info"));
        return (info.roots ?? []).map((r) => r.id);
      }
      const page = await api(`/api/list?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}&offset=0&limit=${FOLDER_PAGE}`);
      return page.items.filter((e) => e.type === "dir").map((e) => `${e.root}/${e.path}`);
    },

    /** 특정 종류(splat 등)만 최신순으로. 앱 셸의 "최근 PLY" 목록용. */
    async recent(kind, limit = recentLimit) {
      const query = kind ? `&kind=${encodeURIComponent(kind)}` : "";
      const data = await api(`/api/recent?limit=${limit}${query}`);
      return data.items.filter((e) => e.kind).map(toItem);
    },

    async open(item) {
      const state = await connection.ensure();
      if (state.status !== "connected") throw new PcConnectionError(state);
      const path = item.path ?? item.id.replace(/^pc:/, "");
      // 서비스 워커가 있으면 같은 출처 프록시로 열되, 프록시가 실제로 파일을 내줄 때만 쓴다.
      // 첫 실행 직후라 아직 제어가 없으면 잠시 기다린다. 프록시를 못 쓰면 PC 직접 주소로 연다
      // (이 앱이 PC에 연결해 있다면 페이지가 직접 요청할 수 있다는 뜻이다. Quest 브라우저에서 확인).
      const direct = `${state.base}/files/${encodePath(path)}`;
      let viaProxy = (await proxyHooks.ensureControl()) && (await proxyHooks.configure("pc", { base: state.base })) && proxyHooks.available();
      if (viaProxy && !(await proxyServes(proxyUrl("pc", path, options.baseUrl)))) viaProxy = false;
      const url = viaProxy ? proxyUrl("pc", path, options.baseUrl) : direct;
      return {
        url,
        name: item.name,
        size: item.size,
        mime: item.mime,
        // PLY는 스트림으로 넘겨 전체 ArrayBuffer 복사를 피한다. 호출할 때마다 새 요청이다.
        stream: async () => {
          const response = await fetchImpl(url, viaProxy ? { cache: "no-store" } : lnaInit(state.base, { cache: "no-store" }));
          if (!response.ok || !response.body) {
            connection.markLost();
            throw new Error(`파일을 읽지 못했습니다 (HTTP ${response.status})`);
          }
          return response.body;
        },
        release() {},
      };
    },
  };
}

/** 연결 실패를 호출자가 안내 UI로 바꿀 수 있게 상태를 싣는 오류. */
export class PcConnectionError extends Error {
  constructor(state) {
    super("PC 서버에 연결하지 못했습니다");
    this.name = "PcConnectionError";
    this.state = state;
  }
}

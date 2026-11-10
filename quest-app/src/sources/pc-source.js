// PC 소스: app의 Source 계약(core/types.js, 설계 7.3) 구현.
// 목록은 PC 서버 API(/api/list, /api/recent), 열기는 서비스 워커 프록시(없으면 직접 URL).
// 소유: sync-dev.
//
// 경로 규칙: `<root>/<상대 경로>` (예: "outputs/VR/clip.mp4"). 빈 문자열은 최상위.
// 최상위 list()는 { items: 전체 루트의 최신 미디어, dirs: 루트 목록 }을 돌려준다.

import { createPcConnection, lnaInit } from "./pc-connect.js";
import { configureProxy, encodePath, proxyAvailable, proxyUrl } from "./proxy-url.js";

const RECENT_LIMIT = 1000; // 서버 상한(MAX_RECENT)과 같다

/**
 * @param {object} [options]
 * @param {ReturnType<typeof createPcConnection>} [options.connection]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.baseUrl]   앱 base 경로 (프록시 URL용)
 * @param {number} [options.recentLimit]
 */
export function createPcSource(options = {}) {
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const connection = options.connection ?? createPcConnection({ fetch: fetchImpl });
  const recentLimit = options.recentLimit ?? RECENT_LIMIT;

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

  function splitPath(path) {
    const parts = String(path ?? "").split("/").filter(Boolean);
    return { root: parts[0] ?? "", rel: parts.slice(1).join("/") };
  }

  return {
    id: "pc",
    label: "PC",
    connection,

    /** 연결 시도. UI의 [PC] 탭/다시 연결 버튼 클릭 핸들러에서 부른다. */
    connect: () => connection.connect(),

    async list(path = "") {
      const { root, rel } = splitPath(path);
      if (!root) {
        const info = (await connection.ensure()).info ?? (await api("/api/info"));
        const recent = await api(`/api/recent?limit=${recentLimit}`);
        return {
          items: recent.items.filter((e) => e.kind).map(toItem),
          dirs: (info.roots ?? []).map((r) => r.id),
        };
      }
      const data = await api(`/api/list?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`);
      return {
        items: data.items.filter((e) => e.type === "file" && e.kind).map(toItem),
        dirs: data.items.filter((e) => e.type === "dir").map((e) => `${e.root}/${e.path}`),
      };
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
      // 서비스 워커가 있으면 같은 출처 프록시로, 없으면(첫 로드 등) PC 서버 직접 URL로 연다.
      const viaProxy = (await configureProxy("pc", { base: state.base })) && proxyAvailable();
      const direct = `${state.base}/files/${encodePath(path)}`;
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

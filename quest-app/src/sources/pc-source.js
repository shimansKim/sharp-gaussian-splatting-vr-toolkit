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

import { createPcConnection, lnaInit } from "./pc-connect.js";
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
        const info = (await connection.ensure()).info ?? (await api("/api/info"));
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
      // 서비스 워커가 있으면 같은 출처 프록시로 연다. 첫 실행 직후라 아직 제어가 없으면 잠시 기다린다
      // (직접 http URL은 https 페이지의 <video>·<img>에서 혼합 콘텐츠로 막힐 수 있다).
      const viaProxy = (await ensureProxyControl()) && (await configureProxy("pc", { base: state.base })) && proxyAvailable();
      if (!viaProxy && globalThis.location?.protocol === "https:" && /^http:/.test(state.base)) {
        console.warn("서비스 워커 제어가 없어 PC 직접 주소로 엽니다. 영상·사진은 혼합 콘텐츠로 막힐 수 있습니다. 앱을 한 번 닫았다 다시 여세요.");
      }
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

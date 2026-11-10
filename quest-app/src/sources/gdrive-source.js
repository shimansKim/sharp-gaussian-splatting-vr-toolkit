// 구글 드라이브 소스 (설계 5장): GIS 토큰 + Google Picker로 고른 파일만 연다(drive.file 범위, 민감 범위 심사 없음).
// app의 Source 계약(core/types.js, 설계 7.3) 구현. 소유: sync-dev.
//
// 흐름: signIn()(클릭 핸들러 안에서) → pick() → 고른 파일이 목록에 남는다(localStorage) → open()이
// 서비스 워커 프록시(`__src/gdrive/<파일 id>`, Range 중계)로 URL을 준다. 워커가 없으면 PLY는 Authorization 헤더로
// 직접 스트림, 영상·사진은 통째로 내려받은 blob URL로 연다.
//
// 설정(clientId, apiKey, appId)은 사람이 구글 클라우드에서 만든 값이며 src/config.js의 GDRIVE에 넣는다.
// 값이 비어 있으면 isConfigured()가 false이고 패널이 설정 안내를 보여 준다.

import { configureProxy, proxyAvailable, proxyUrl } from "./proxy-url.js";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";
const PICKED_KEY = "sharp.gdrive.picked";
const TOKEN_KEY = "sharp.gdrive.token";
const TOKEN_MARGIN_MS = 60_000;
/** 프록시 없이 영상·사진을 통째로 받을 때의 상한(메모리 보호). */
const BLOB_FALLBACK_MAX = 300 * 1024 * 1024;

const EXT_KIND = {
  ply: "splat", splat: "splat", spz: "splat",
  mp4: "video", m4v: "video", webm: "video", mov: "video", mkv: "video",
  jpg: "image", jpeg: "image", png: "image", webp: "image", avif: "image",
};

/** 이름 확장자 우선, 없으면 MIME으로 종류를 정한다. 모르면 null. */
export function detectKind(name, mimeType) {
  const ext = String(name ?? "").split(".").pop().toLowerCase();
  if (EXT_KIND[ext]) return EXT_KIND[ext];
  if (/^video\//.test(mimeType ?? "")) return "video";
  if (/^image\//.test(mimeType ?? "")) return "image";
  return null;
}

/** 오류에 분류를 싣는다. code: not-configured | auth | popup | picker | network | too-large */
export class GdriveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GdriveError";
    this.code = code;
  }
}

function defaultStorage() {
  return {
    get(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value == null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, value);
      } catch {
        /* 저장 불가: 고른 목록을 기억하지 못할 뿐이다 */
      }
    },
  };
}

function defaultLoadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new GdriveError("network", `스크립트를 불러오지 못했습니다: ${src}`));
    document.head.append(script);
  });
}

/**
 * @param {object} [options]
 * @param {{ clientId?: string, apiKey?: string, appId?: string }} [options.config]  src/config.js의 GDRIVE
 * @param {typeof fetch} [options.fetch]
 * @param {(src: string) => Promise<void>} [options.loadScript]
 * @param {() => any} [options.google]   window.google (테스트용)
 * @param {() => any} [options.gapi]     window.gapi (테스트용)
 * @param {{ get(key: string): string|null, set(key: string, value: string|null): void }} [options.storage]
 * @param {() => number} [options.now]
 * @param {string} [options.baseUrl]     앱 base 경로 (프록시 URL용)
 */
export function createGdriveSource(options = {}) {
  const config = options.config ?? {};
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const loadScript = options.loadScript ?? defaultLoadScript;
  const getGoogle = options.google ?? (() => globalThis.google);
  const getGapi = options.gapi ?? (() => globalThis.gapi);
  const storage = options.storage ?? defaultStorage();
  const now = options.now ?? (() => Date.now());

  /** @type {{ token: string, expiresAt: number }|null} */
  let token = readToken();
  let refreshTimer = null;
  const listeners = new Set();

  function readToken() {
    try {
      const saved = JSON.parse(storage.get(TOKEN_KEY) ?? "null");
      if (saved?.token && saved.expiresAt > (options.now ?? Date.now)() + TOKEN_MARGIN_MS) return saved;
    } catch {
      /* 손상된 값은 무시 */
    }
    return null;
  }

  function emit() {
    const snapshot = api.state;
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        /* 구독자 오류가 흐름을 끊지 않게 한다 */
      }
    }
  }

  function isConfigured() {
    return Boolean(config.clientId && config.apiKey && config.appId);
  }

  function requireConfigured() {
    if (!isConfigured()) {
      throw new GdriveError("not-configured", "구글 드라이브 설정(클라이언트 ID·API 키·프로젝트 번호)이 비어 있습니다");
    }
  }

  function tokenValid() {
    return token !== null && token.expiresAt > now() + TOKEN_MARGIN_MS;
  }

  async function ensureGis() {
    if (!getGoogle()?.accounts?.oauth2) await loadScript(GIS_SRC);
    const oauth2 = getGoogle()?.accounts?.oauth2;
    if (!oauth2) throw new GdriveError("network", "구글 로그인 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요.");
    return oauth2;
  }

  async function ensurePicker() {
    if (!getGoogle()?.picker) {
      if (!getGapi()) await loadScript(GAPI_SRC);
      const gapi = getGapi();
      if (!gapi) throw new GdriveError("network", "구글 파일 선택 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요.");
      await new Promise((resolve, reject) =>
        gapi.load("picker", { callback: resolve, onerror: () => reject(new GdriveError("network", "파일 선택 모듈 로딩 실패")) }),
      );
    }
    return getGoogle().picker;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!token) return;
    // 만료 5분 전에 조용히 갱신을 시도한다(긴 영상 재생 중 seek가 401이 되지 않게). 팝업이 필요하면 조용히 포기한다.
    const delay = Math.max(10_000, token.expiresAt - now() - 5 * 60_000);
    refreshTimer = setTimeout(() => {
      signIn({ silent: true }).catch(() => {});
    }, delay);
    refreshTimer.unref?.();
  }

  /**
   * 접근 토큰을 받는다. 처음에는 구글 로그인 팝업이 뜨므로 사용자 클릭 핸들러 안에서 부른다.
   * @param {{ silent?: boolean }} [opts]  silent면 팝업 없이 시도(이미 동의한 경우만 성공)
   */
  async function signIn(opts = {}) {
    requireConfigured();
    const oauth2 = await ensureGis();
    const result = await new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: config.clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response?.error) reject(new GdriveError("auth", `로그인에 실패했습니다 (${response.error})`));
          else resolve(response);
        },
        error_callback: (err) => {
          const type = err?.type ?? "unknown";
          const popup = type === "popup_failed_to_open" || type === "popup_closed";
          reject(new GdriveError(popup ? "popup" : "auth", type === "popup_failed_to_open" ? "로그인 창을 열지 못했습니다. 팝업 차단을 해제하세요." : "로그인 창이 닫혔습니다."));
        },
      });
      client.requestAccessToken({ prompt: opts.silent ? "none" : "" });
    });
    token = { token: result.access_token, expiresAt: now() + Number(result.expires_in ?? 3600) * 1000 };
    storage.set(TOKEN_KEY, JSON.stringify(token));
    scheduleRefresh();
    emit();
    return token;
  }

  async function ensureToken() {
    if (tokenValid()) return token;
    return signIn();
  }

  /** 고른 파일 목록(localStorage). */
  function readPicked() {
    try {
      const list = JSON.parse(storage.get(PICKED_KEY) ?? "[]");
      return Array.isArray(list) ? list.filter((f) => f && typeof f.id === "string") : [];
    } catch {
      return [];
    }
  }

  function writePicked(list) {
    storage.set(PICKED_KEY, JSON.stringify(list));
    emit();
  }

  function toItem(file) {
    return {
      id: `gdrive:${file.id}`,
      sourceId: "gdrive",
      name: file.name,
      kind: detectKind(file.name, file.mimeType),
      size: file.size ? Number(file.size) : undefined,
      mime: file.mimeType,
      mtime: file.lastEdited ? Number(file.lastEdited) : undefined,
      path: file.id,
    };
  }

  /**
   * 구글 파일 선택 창을 열어 파일을 고른다. 사용자 클릭 핸들러 안에서 부른다.
   * 종류를 알 수 없는 파일(PLY·영상·사진이 아닌 것)은 목록에 넣지 않고 skipped로 알린다.
   * @returns {Promise<{ added: object[], skipped: string[] }|null>} 취소하면 null
   */
  async function pick() {
    requireConfigured();
    const { token: accessToken } = await ensureToken();
    const picker = await ensurePicker();
    return new Promise((resolve, reject) => {
      try {
        const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
        const built = new picker.PickerBuilder()
          .setAppId(config.appId)
          .setDeveloperKey(config.apiKey)
          .setOAuthToken(accessToken)
          .setLocale("ko")
          .enableFeature(picker.Feature.MULTISELECT_ENABLED)
          .enableFeature(picker.Feature.SUPPORT_DRIVES)
          .addView(view)
          .setCallback((data) => {
            const action = data?.[picker.Response.ACTION];
            if (action === picker.Action.CANCEL) return resolve(null);
            if (action !== picker.Action.PICKED) return;
            const docs = data[picker.Response.DOCUMENTS] ?? [];
            const list = readPicked();
            const added = [];
            const skipped = [];
            // 고른 순서가 목록 맨 위에 그대로 보이도록 뒤에서부터 앞에 끼운다.
            for (const doc of [...docs].reverse()) {
              const file = {
                id: doc[picker.Document.ID],
                name: doc[picker.Document.NAME],
                mimeType: doc[picker.Document.MIME_TYPE],
                size: doc[picker.Document.SIZE_BYTES],
                lastEdited: doc[picker.Document.LAST_EDITED_UTC],
              };
              if (!file.id) continue;
              if (!detectKind(file.name, file.mimeType)) {
                skipped.unshift(file.name ?? file.id);
                continue;
              }
              const at = list.findIndex((f) => f.id === file.id);
              if (at >= 0) list.splice(at, 1);
              list.unshift(file);
              added.unshift(file);
            }
            writePicked(list);
            resolve({ added: added.map(toItem), skipped });
          })
          .build();
        built.setVisible(true);
      } catch (error) {
        reject(new GdriveError("picker", `파일 선택 창을 열지 못했습니다: ${error?.message ?? error}`));
      }
    });
  }

  function remove(id) {
    writePicked(readPicked().filter((f) => f.id !== id));
  }

  function signOut() {
    const accessToken = token?.token;
    token = null;
    clearTimeout(refreshTimer);
    storage.set(TOKEN_KEY, null);
    try {
      if (accessToken) getGoogle()?.accounts?.oauth2?.revoke?.(accessToken, () => {});
    } catch {
      /* 해제 실패는 무시: 토큰은 어차피 1시간 뒤 만료된다 */
    }
    emit();
  }

  async function open(item) {
    requireConfigured();
    const fileId = item.path ?? String(item.id).replace(/^gdrive:/, "");
    const { token: accessToken, expiresAt } = await ensureToken();
    const viaProxy = (await configureProxy("gdrive", { token: accessToken, expiresAt })) && proxyAvailable();
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

    async function directFetch() {
      const response = await fetchImpl(driveUrl, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new GdriveError("auth", `드라이브가 파일을 열어 주지 않았습니다 (HTTP ${response.status}). 로그인이 만료됐거나 이 파일을 다시 골라야 합니다.`);
      }
      if (!response.ok || !response.body) throw new GdriveError("network", `파일을 읽지 못했습니다 (HTTP ${response.status})`);
      return response;
    }

    const stream = async () => {
      if (viaProxy) {
        const response = await fetchImpl(proxyUrl("gdrive", fileId, options.baseUrl), { cache: "no-store" });
        if (!response.ok || !response.body) {
          throw new GdriveError(response.status === 401 ? "auth" : "network", `파일을 읽지 못했습니다 (HTTP ${response.status})`);
        }
        return response.body;
      }
      return (await directFetch()).body;
    };

    const base = { name: item.name, size: item.size, mime: item.mime, stream };
    if (viaProxy) return { ...base, url: proxyUrl("gdrive", fileId, options.baseUrl), release() {} };
    if (item.kind === "splat") return { ...base, url: "", release() {} };

    // 서비스 워커가 없을 때의 영상·사진: 통째로 받아 blob URL로 연다.
    if (item.size && item.size > BLOB_FALLBACK_MAX) {
      throw new GdriveError("too-large", "서비스 워커가 아직 켜지지 않아 큰 파일은 열 수 없습니다. 앱을 새로고침한 뒤 다시 시도하세요.");
    }
    const blob = await (await directFetch()).blob();
    const blobUrl = URL.createObjectURL(blob);
    return { ...base, url: blobUrl, release: () => URL.revokeObjectURL(blobUrl) };
  }

  const api = {
    id: "gdrive",
    label: "드라이브",
    isConfigured,
    signIn,
    signOut,
    pick,
    remove,
    open,
    /** 고른 파일 목록. 폴더는 없다. */
    async list() {
      return { items: readPicked().map(toItem).filter((i) => i.kind), dirs: [] };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get state() {
      return { configured: isConfigured(), signedIn: tokenValid(), count: readPicked().length };
    },
  };
  if (token) scheduleRefresh();
  return api;
}

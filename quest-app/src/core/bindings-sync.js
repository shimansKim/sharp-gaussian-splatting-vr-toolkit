// 컨트롤러 버튼 배정을 PC 서버(GET/PUT /api/bindings)와 맞춘다.
// 규칙: "나중에 바꾼 쪽이 이긴다". PC에 연결되면 양쪽의 바꾼 시각(updatedAt)을 비교해
//  - PC가 더 최근 → PC 배정을 받아 이 기기에 적용(출처 'pc')
//  - 이 기기가 더 최근 → PC로 보냄(서버도 더 옛 시각의 저장은 409로 거절해 같은 규칙을 지킨다)
// 연결된 동안 이 기기에서 바꾸면 곧바로 PC로 보낸다. 설정창의 [PC 배정 불러오기]·[이 배정을 PC로 보내기]는 시각과 상관없이 한쪽을 고른다.
import { lnaInit } from "../sources/pc-connect.js";

const PUSH_DELAY_MS = 400;

function formatTime(ms) {
  if (!ms) return "없음";
  try {
    return new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(ms);
  }
}

/**
 * @param {{
 *   store: ReturnType<typeof import('./bindings.js').createBindingStore>,
 *   connection: { state: { status: string, base: string|null }, subscribe: (fn: (state: any) => void) => () => void },
 *   fetch?: typeof fetch,
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout,
 *   onDiscard?: (text: string) => void,
 * }} options  onDiscard: 이 기기에서 바꾼 배정이 PC의 더 최근 배정에 밀려 버려졌을 때(409) 한 번. 앱은 상태줄·VR 패널에 크게 알린다.
 */
export function createBindingsSync({ store, connection, fetch: fetchImpl = (...a) => globalThis.fetch(...a), setTimeout: later = (...a) => globalThis.setTimeout(...a), clearTimeout: cancel = (...a) => globalThis.clearTimeout(...a), onDiscard = () => {} }) {
  /** PC 쪽 상태: unknown(아직 안 물어봄)·ok·unsupported(옛 서버)·error */
  let remote = { state: "unknown", updatedAt: 0, error: "" };
  let lastBase = null;
  let pushTimer = null;
  let last = "";
  /** 이 기기 변경이 버려졌다는 알림(설정창 경고 줄). 사람이 다시 바꾸거나 PC로 보내면 지운다. */
  let notice = "";
  const listeners = new Set();
  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch {
        // 무시
      }
    }
  };

  const base = () => (connection.state?.status === "connected" ? connection.state.base : null);

  async function request(method, body) {
    const b = base();
    if (!b) throw new Error("PC에 연결되어 있지 않습니다");
    const init = lnaInit(b, { method, cache: "no-store", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const response = await fetchImpl(`${b}/api/bindings`, init);
    if (response.status === 404) {
      remote = { state: "unsupported", updatedAt: 0, error: "" };
      throw new Error("PC 서버가 버튼 지정을 모릅니다(PC 서버를 새 버전으로 바꿔 주세요)");
    }
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }

  function applyRemote(data) {
    remote = { state: "ok", updatedAt: Number(data.updatedAt) || 0, error: "" };
    store.replace(data.bindings ?? {}, { source: "pc", updatedAt: remote.updatedAt || Date.now() });
  }

  /** 이 기기 배정을 PC로. force가 아니면 PC가 더 최근일 때 서버가 거절하고(409) 그 배정을 받아 적용한다. */
  async function push(force = false) {
    const meta = store.meta();
    const { status, data } = await request("PUT", { bindings: store.overrides(), updatedAt: meta.updatedAt || Date.now(), force });
    if (status === 409 && data.current) {
      const discarded = meta.source !== "pc"; // 이 기기에서 바꾼 것을 보내다 밀렸다
      applyRemote(data.current);
      if (discarded) {
        notice = `PC에서 더 최근에 바꾼 배정이 있어, 이 기기에서 바꾼 배정(${formatTime(meta.updatedAt)})은 버리고 PC 배정(${formatTime(remote.updatedAt)})으로 바꿨습니다. 이 기기 배정을 쓰려면 다시 바꾼 뒤 [이 배정을 PC로 보내기]를 누르세요.`;
        try {
          onDiscard(notice);
        } catch {
          // 알림 실패가 동기화를 막지 않게 한다.
        }
        notify();
      }
      return "PC 배정이 더 최근이라 그것을 받아 왔습니다";
    }
    if (status === 200 && force) notice = "";
    if (status !== 200) throw new Error(data.error || `HTTP ${status}`);
    remote = { state: "ok", updatedAt: Number(data.updatedAt) || meta.updatedAt, error: "" };
    notify();
    return "PC로 보냈습니다";
  }

  async function pull() {
    const { status, data } = await request("GET");
    if (status !== 200) throw new Error(data.error || `HTTP ${status}`);
    if (!Number(data.updatedAt)) {
      remote = { state: "ok", updatedAt: 0, error: "" };
      notify();
      return "PC에 저장된 배정이 없습니다(이 기기 배정을 그대로 둡니다)";
    }
    applyRemote(data);
    return "PC 배정을 받아 왔습니다";
  }

  /** 연결될 때: 나중에 바꾼 쪽으로 맞춘다. */
  async function reconcile() {
    try {
      const { status, data } = await request("GET");
      if (status !== 200) throw new Error(data.error || `HTTP ${status}`);
      const pcAt = Number(data.updatedAt) || 0;
      const localAt = store.meta().updatedAt || 0;
      remote = { state: "ok", updatedAt: pcAt, error: "" };
      if (pcAt > localAt) applyRemote(data);
      else if (localAt > pcAt) await push(false);
      last = pcAt > localAt ? "PC 배정이 더 최근이라 받아 왔습니다" : localAt > pcAt ? "이 기기 배정이 더 최근이라 PC로 보냈습니다" : "PC와 같습니다";
    } catch (error) {
      if (remote.state !== "unsupported") remote = { state: "error", updatedAt: 0, error: error?.message ?? String(error) };
      last = "";
    }
    notify();
  }

  connection.subscribe?.((state) => {
    const b = state?.status === "connected" ? state.base : null;
    if (b && b !== lastBase) {
      lastBase = b;
      reconcile();
    } else if (!b && lastBase) {
      lastBase = null;
      remote = { state: "unknown", updatedAt: 0, error: "" };
      notify();
    }
  });

  // 연결된 동안 이 기기에서 바꾸면 곧 PC로 보낸다(PC에서 받아 온 변경은 다시 보내지 않는다).
  store.subscribe((_map, meta) => {
    if (meta.source === "pc") return;
    notice = ""; // 사람이 다시 바꿨으면 지난 알림은 지운다
    if (!base() || remote.state === "unsupported") return;
    if (pushTimer) cancel(pushTimer);
    pushTimer = later(() => {
      pushTimer = null;
      push(false)
        .then((text) => {
          last = text;
          notify();
        })
        .catch((error) => {
          last = `PC로 보내지 못함: ${error?.message ?? error}`;
          notify();
        });
    }, PUSH_DELAY_MS);
  });

  return {
    reconcile,
    pull,
    push: () => push(true),
    /** 이 기기 변경이 PC 배정에 밀려 버려졌다는 알림(없으면 빈 문자열). 설정창이 경고 줄로 보인다. */
    get notice() {
      return notice;
    },
    /** 설정창에 보일 한 줄 */
    status() {
      const b = base();
      if (!b) return { connected: false, text: "PC에 연결되어 있지 않습니다. [PC] 탭에서 연결하면 PC 배정과 자동으로 맞춥니다(나중에 바꾼 쪽이 이깁니다)." };
      if (remote.state === "unsupported") return { connected: false, text: "연결된 PC 서버가 버튼 지정을 모릅니다. PC 서버를 새 버전으로 바꾸면 PC와 배정을 주고받을 수 있습니다." };
      if (remote.state === "error") return { connected: true, text: `PC 배정을 읽지 못했습니다: ${remote.error}` };
      const local = store.meta().updatedAt;
      return { connected: true, text: `PC 연결됨 · PC 배정 ${formatTime(remote.updatedAt)} · 이 기기 ${formatTime(local)} · 규칙: 나중에 바꾼 쪽이 이깁니다${last ? ` · ${last}` : ""}` };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

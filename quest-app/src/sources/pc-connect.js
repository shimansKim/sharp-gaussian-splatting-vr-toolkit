// PC 서버 자동 연결 (설계 4.4). 사람이 IP를 입력하지 않는다.
// 순서: 마지막 성공 주소 → sharp-vr.local → (선택) 수동 주소.
// 모든 LAN 요청은 targetAddressSpace: 'local'로 보낸다(LNA, 모르는 브라우저는 무시한다).
// 소유: sync-dev. 앱 셸 의존이 없어 Node에서도 테스트한다.

/** @typedef {'idle'|'connecting'|'connected'|'failed'} PcStatus */

/**
 * @typedef {object} PcState
 * @property {PcStatus} status
 * @property {string|null} base        연결된 서버 주소 (예: http://192.168.0.23:8787)
 * @property {'last'|'mdns'|'manual'|null} via
 * @property {any} info                /api/info 응답
 * @property {Array<{ base: string, via: string, error: string }>} attempts  실패 기록
 * @property {'unreachable'|'denied'|'wrong-server'|null} reason  실패 분류
 */

export const SERVER_APP_ID = "sharp-quest-server";
export const DEFAULT_PORT = 8787;
export const DEFAULT_MDNS_HOST = "sharp-vr.local";
const LAST_BASE_KEY = "sharp.pc.lastBase";
const MANUAL_BASE_KEY = "sharp.pc.manualBase";

/** 쓸 수 없을 때를 대비해 try/catch로 감싼 localStorage. */
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
        /* 저장 불가 환경: 자동 연결 기억만 못 한다 */
      }
    },
  };
}

/** 사용자가 입력한 주소를 http://host:port 로 정리한다. 이상하면 null. */
export function normalizeBase(text, defaultPort = DEFAULT_PORT) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    const port = url.port || (url.protocol === "http:" ? String(defaultPort) : "");
    return `${url.protocol}//${url.hostname}${port ? `:${port}` : ""}`;
  } catch {
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {number} [options.port]
 * @param {string} [options.mdnsHost]
 * @param {typeof fetch} [options.fetch]
 * @param {{ get(key: string): string|null, set(key: string, value: string|null): void }} [options.storage]
 * @param {(state: PcState) => void} [options.onChange]
 * @param {number} [options.quickTimeoutMs]   권한을 이미 받은 뒤 한 주소를 기다리는 시간
 * @param {number} [options.promptTimeoutMs]  LNA 권한 창에 사람이 답할 시간
 * @param {() => Promise<string>} [options.permissionState]  'granted'|'prompt'|'denied'|'unknown'
 */
export function createPcConnection(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const mdnsHost = options.mdnsHost ?? DEFAULT_MDNS_HOST;
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const storage = options.storage ?? defaultStorage();
  const quickTimeoutMs = options.quickTimeoutMs ?? 4000;
  const promptTimeoutMs = options.promptTimeoutMs ?? 45000;
  const permissionState = options.permissionState ?? queryLnaPermission;

  /** @type {PcState} */
  let state = { status: "idle", base: null, via: null, info: null, attempts: [], reason: null };
  /** @type {Promise<PcState>|null} */
  let running = null;

  /** @type {Set<(state: PcState) => void>} */
  const listeners = new Set();
  if (options.onChange) listeners.add(options.onChange);

  function setState(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        /* 구독자 오류가 연결 흐름을 끊지 않게 한다 */
      }
    }
  }

  async function probe(base, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/api/info`, {
        targetAddressSpace: "local",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, kind: "wrong-server" };
      let info;
      try {
        info = await response.json();
      } catch {
        return { ok: false, error: "JSON이 아닌 응답", kind: "wrong-server" };
      }
      if (info?.app !== SERVER_APP_ID) return { ok: false, error: "SHARP 서버가 아님", kind: "wrong-server" };
      return { ok: true, info };
    } catch (error) {
      const aborted = error?.name === "AbortError";
      return { ok: false, error: aborted ? "시간 초과" : String(error?.message ?? error), kind: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 후보 주소 목록(중복 제거, 순서 유지). */
  function candidates() {
    const list = [];
    const add = (base, via) => {
      if (base && !list.some((c) => c.base === base)) list.push({ base, via });
    };
    add(normalizeBase(storage.get(LAST_BASE_KEY), port), "last");
    add(`http://${mdnsHost}:${port}`, "mdns");
    add(normalizeBase(storage.get(MANUAL_BASE_KEY), port), "manual");
    return list;
  }

  async function runConnect() {
    setState({ status: "connecting", attempts: [], reason: null });
    const permission = await permissionState();
    const attempts = [];
    let sawWrongServer = false;
    for (const { base, via } of candidates()) {
      // 권한을 아직 안 받았으면 사람이 프롬프트에 답할 때까지 기다려야 한다.
      const timeoutMs = permission === "granted" ? quickTimeoutMs : promptTimeoutMs;
      const result = await probe(base, timeoutMs);
      if (result.ok) {
        storage.set(LAST_BASE_KEY, base);
        setState({ status: "connected", base, via, info: result.info, attempts, reason: null });
        return state;
      }
      if (result.kind === "wrong-server") sawWrongServer = true;
      attempts.push({ base, via, error: result.error });
    }
    const reason = permission === "denied" ? "denied" : sawWrongServer ? "wrong-server" : "unreachable";
    setState({ status: "failed", base: null, via: null, info: null, attempts, reason });
    return state;
  }

  return {
    get state() {
      return state;
    },
    /** 연결 시도. 이미 진행 중이면 그 결과를 같이 기다린다. 사용자 클릭 핸들러 안에서 부르면 LNA 프롬프트가 자연스럽게 뜬다. */
    connect() {
      running ??= runConnect().finally(() => {
        running = null;
      });
      return running;
    },
    /** 연결돼 있으면 그대로, 아니면 다시 시도한다. */
    async ensure() {
      return state.status === "connected" ? state : this.connect();
    },
    /** 연결이 끊겼다고 판단되면 호출한다(요청 실패 등). */
    markLost() {
      if (state.status === "connected") setState({ status: "idle", base: null, via: null, info: null });
    },
    /** 상태가 바뀔 때마다 부른다. 해제 함수를 돌려준다. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 기억해 둔 마지막 성공 주소가 있는가(있으면 권한을 이미 받은 것으로 보고 자동 연결해도 된다). */
    hasLastBase() {
      return normalizeBase(storage.get(LAST_BASE_KEY), port) !== null;
    },
    /** 고급 설정의 수동 주소. 빈 문자열이면 지운다. 저장 성공 여부를 돌려준다. */
    setManualBase(text) {
      if (!String(text ?? "").trim()) {
        storage.set(MANUAL_BASE_KEY, null);
        return true;
      }
      const base = normalizeBase(text, port);
      if (!base) return false;
      storage.set(MANUAL_BASE_KEY, base);
      return true;
    },
    getManualBase() {
      return storage.get(MANUAL_BASE_KEY);
    },
    forgetLastBase() {
      storage.set(LAST_BASE_KEY, null);
    },
  };
}

/** Chromium의 로컬 네트워크 접근 권한 상태. 이름이 버전마다 달라 차례로 시도한다. */
export async function queryLnaPermission() {
  const names = ["local-network-access", "local-network", "loopback-network"];
  for (const name of names) {
    try {
      const status = await navigator.permissions.query({ name });
      return status.state;
    } catch {
      /* 다음 이름 */
    }
  }
  return "unknown";
}

/**
 * 연결 실패를 사람에게 보여 줄 한국어 안내로 바꾼다. 상태 표시 UI가 그대로 쓴다.
 * @param {PcState} state
 * @returns {{ title: string, steps: string[] }}
 */
export function describeFailure(state) {
  if (state.reason === "denied") {
    return {
      title: "로컬 네트워크 접근이 차단되어 있습니다",
      steps: [
        "브라우저 주소창 왼쪽 자물쇠(사이트 설정)에서 '로컬 네트워크 기기' 권한을 허용으로 바꾸세요.",
        "허용한 뒤 [다시 연결]을 누르세요.",
      ],
    };
  }
  if (state.reason === "wrong-server") {
    return {
      title: "주소는 응답하지만 SHARP PC 서버가 아닙니다",
      steps: [
        "PC에서 run_quest_pc_server.bat가 실행 중인지 확인하세요.",
        "포트 8787을 다른 프로그램이 쓰고 있지 않은지 확인하세요.",
      ],
    };
  }
  return {
    title: "PC에 연결하지 못했습니다",
    steps: [
      "PC에서 run_quest_pc_server.bat를 실행하고 창을 열어 두세요.",
      "Quest와 PC가 같은 Wi-Fi(공유기)에 있는지 확인하세요.",
      "처음 실행하면 Windows 방화벽 창이 뜹니다. '개인 네트워크'를 허용하세요. 이미 닫았다면 방화벽 설정에서 Python의 개인 네트워크 허용을 켜세요.",
      "PC의 네트워크 프로필이 '개인'인지 확인하세요(설정 > 네트워크 및 인터넷 > Wi-Fi/이더넷 > 네트워크 프로필 유형). '공용'이면 연결이 막힙니다.",
      "브라우저가 '로컬 네트워크 기기 찾기' 권한을 물으면 허용하세요.",
    ],
  };
}

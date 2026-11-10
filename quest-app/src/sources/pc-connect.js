// PC 서버 자동 연결 (설계 4.4). 사람이 IP를 입력하지 않는다.
// 순서: 마지막 성공 주소 → sharp-vr.local → (선택) 수동 주소 → 공유기 대역 탐색(pc-scan.js).
// Quest 브라우저가 sharp-vr.local(mDNS)을 풀지 못해도 마지막 단계의 탐색으로 찾는다.
// 모든 LAN 요청은 targetAddressSpace: 'local'로 보낸다(LNA, 모르는 브라우저는 무시한다).
// 소유: sync-dev. 앱 셸 의존이 없어 Node에서도 테스트한다.

import { buildScanPlan, defaultBaseFor, defaultLedger, ipv4Prefix, scanPrefixes } from "./pc-scan.js";

/** @typedef {'idle'|'connecting'|'connected'|'failed'} PcStatus */

/**
 * @typedef {object} PcState
 * @property {PcStatus} status
 * @property {string|null} base        연결된 서버 주소 (예: http://192.168.0.23:8787)
 * @property {'last'|'mdns'|'manual'|'scan'|null} via
 * @property {any} info                /api/info 응답
 * @property {Array<{ base: string, via: string, error: string }>} attempts  실패 기록
 * @property {'unreachable'|'denied'|'wrong-server'|'mixed-content'|null} reason  실패 분류
 * @property {string|null} [progress]  연결 중에 화면에 보여 줄 진행 문구(대역 탐색 등)
 * @property {boolean} [moreAvailable]  못 찾았고, 드문 대역을 더 찾아볼 수 있다(scanMore)
 */

export const SERVER_APP_ID = "sharp-quest-server";
export const DEFAULT_PORT = 8787;
export const DEFAULT_MDNS_HOST = "sharp-vr.local";
const LAST_BASE_KEY = "sharp.pc.lastBase";
const MANUAL_BASE_KEY = "sharp.pc.manualBase";
const PREFIXES_KEY = "sharp.pc.prefixes"; // 연결에 성공한 공유기 대역(최대 4개, 최근 것이 앞)

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

/** fetch 옵션: http(LAN) 주소에만 LNA 표시(targetAddressSpace)를 붙인다. https 터널은 공용 주소다. */
export function lnaInit(base, init = {}) {
  return /^http:/i.test(String(base)) ? { targetAddressSpace: "local", ...init } : { ...init };
}

/** 브라우저가 loopback(127.x, localhost, ::1)은 안전한 출처로 보고 혼합 콘텐츠 검사에서 뺀다. */
export function isLoopbackBase(base) {
  return /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(String(base ?? ""));
}

/** 혼합 콘텐츠 판정에 쓰는 사설 주소(대개 비어 있는 주소 8개). */
export const MIXED_PROBE_HOSTS = [
  "192.168.255.254", "10.255.255.254", "172.31.255.254", "192.168.254.253",
  "10.254.254.254", "172.30.255.254", "192.168.253.252", "10.253.253.253",
];

/**
 * 이 페이지(https)에서 http 사설 주소로 가는 요청을 브라우저가 혼합 콘텐츠로 막는가.
 * 혼합 콘텐츠 차단은 네트워크에 나가기 전에 즉시 실패하고, 실제로 나간 요청은 응답을 기다리느라 시간이 걸린다.
 * 그래서 실제 탐색과 같은 옵션(http 사설 주소, targetAddressSpace: 'local')으로 서로 다른 사설 주소 8개에 보내
 * 모두 곧바로(waitMs 안에) 실패하면 차단으로 본다. 사설 주소는 허용하고 공인 주소만 막는 브라우저(Quest 등)는
 * 요청이 실제로 나가므로 차단으로 보지 않는다. 판정은 탐색이 실패한 뒤 안내 문구를 고르는 데만 쓴다.
 * 페이지가 http이면 막힐 일이 없으므로 false.
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.protocol]  테스트용
 * @param {number} [options.waitMs]    이 시간 안에 모두 실패하면 차단으로 본다
 * @param {string[]} [options.hosts]
 * @param {number} [options.port]
 */
export async function detectMixedContentBlock(options = {}) {
  const protocol = options.protocol ?? globalThis.location?.protocol;
  if (protocol !== "https:") return false;
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const waitMs = options.waitMs ?? 250;
  const hosts = options.hosts ?? MIXED_PROBE_HOSTS;
  const port = options.port ?? DEFAULT_PORT;
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(), waitMs + 300);
  try {
    const instant = await Promise.all(
      hosts.map(async (host) => {
        const base = `http://${host}:${port}`;
        try {
          await fetchImpl(`${base}/api/info`, lnaInit(base, { cache: "no-store", signal: controller.signal }));
          return false; // 응답이 왔다(있을 수 없지만): 막히지 않았다
        } catch (error) {
          if (error?.name === "AbortError") return false; // 오래 기다렸다 = 요청이 실제로 나갔다
          return Date.now() - started <= waitMs;
        }
      }),
    );
    return instant.length > 0 && instant.every(Boolean);
  } finally {
    clearTimeout(timer);
  }
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
 * @param {number} [options.quickTimeoutMs]   권한을 이미 받은 뒤 IP 주소 하나를 기다리는 시간
 * @param {number} [options.mdnsTimeoutMs]    sharp-vr.local 이름 해석을 기다리는 시간. 첫 mDNS 해석은 몇 초 걸릴 수 있어 더 길다.
 * @param {number} [options.promptTimeoutMs]  LNA 권한 창에 사람이 답할 시간
 * @param {() => Promise<string>} [options.permissionState]  'granted'|'prompt'|'denied'|'unknown'
 * @param {false | { primary?: string[], secondary?: string[], concurrency?: number, timeoutMs?: number, startDelayMs?: number, ledger?: ReturnType<typeof import('./pc-scan.js').createLedger>, baseFor?: (host: string, port: number) => string }} [options.scan]
 *        공유기 대역 탐색 설정. false면 끈다. 자동으로는 1단계 대역만 훑고, 2단계는 scanMore()를 불러야 훑는다.
 *        concurrency는 동시 시도 수(기본 24), timeoutMs는 주소 하나를 기다리는 시간(기본 600),
 *        startDelayMs는 이름(sharp-vr.local) 결과를 기다려 주는 최대 시간(이름이 곧바로 실패하면 바로 시작),
 *        ledger는 시간 제한에 걸린 시도의 장부(기본은 앱 전체 공유).
 * @param {number} [options.permissionPollMs]  권한 창 답을 확인하는 간격
 * @param {() => Promise<boolean>} [options.mixedContentProbe]  https→http 혼합 콘텐츠 차단 여부(테스트용으로 바꿀 수 있다)
 */
export function createPcConnection(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const mdnsHost = options.mdnsHost ?? DEFAULT_MDNS_HOST;
  const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const storage = options.storage ?? defaultStorage();
  const quickTimeoutMs = options.quickTimeoutMs ?? 4000;
  const promptTimeoutMs = options.promptTimeoutMs ?? 45000;
  const mdnsTimeoutMs = options.mdnsTimeoutMs ?? Math.max(quickTimeoutMs, 8000);
  const permissionState = options.permissionState ?? queryLnaPermission;
  const scanOptions = options.scan === false ? null : (options.scan ?? {});
  const permissionPollMs = options.permissionPollMs ?? 250;
  const mixedContentProbe = options.mixedContentProbe ?? (() => detectMixedContentBlock({ fetch: fetchImpl }));

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

  async function probe(base, timeoutMs, outerSignal) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (outerSignal?.aborted) controller.abort();
    else outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const response = await fetchImpl(`${base}/api/info`, lnaInit(base, { cache: "no-store", signal: controller.signal }));
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
      return { ok: false, error: aborted ? "시간 초과" : String(error?.message ?? error), kind: "unreachable", timedOut: aborted && timedOut };
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", onOuterAbort);
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

  /** 작업 중 처음으로 값을 낸 것을 돌려준다. 모두 값 없이 끝나면 null(그때까지 기다린다). */
  function firstSuccess(tasks) {
    return new Promise((resolve) => {
      let pending = tasks.length;
      if (!pending) resolve(null);
      const settle = () => {
        pending -= 1;
        if (pending === 0) resolve(null);
      };
      for (const task of tasks) {
        task.then((value) => (value ? resolve(value) : settle()), settle);
      }
    });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * 권한 창(LNA)이 아직 안 떴거나 답을 기다리는 상태면, 한 주소로 요청을 보내 창을 띄우고 사람이 답할 때까지 기다린다.
   * 답이 나오면(허용·거부) 그 요청은 끊고 돌아온다. 이후 요청은 짧은 제한 시간만 쓴다.
   * @returns {Promise<{ result: any, answered: boolean }>}
   */
  async function waitForPermissionAnswer(base) {
    const controller = new AbortController();
    const attempt = probe(base, promptTimeoutMs, controller.signal);
    let settled = false;
    attempt.then(() => (settled = true), () => (settled = true));
    let answered = false;
    while (!settled) {
      await Promise.race([sleep(permissionPollMs), attempt.catch(() => {})]);
      if (settled) break;
      if ((await permissionState()) !== "prompt") {
        answered = true;
        controller.abort();
        break;
      }
    }
    return { result: await attempt, answered };
  }

  function progressText(prefix, done, total) {
    return `${prefix}.x 대역 확인 중 (${Math.min(100, Math.round((done / Math.max(1, total)) * 100))}%)`;
  }

  /** 연결에 성공한 공유기 대역을 기억한다(서버가 알려 준 주소 포함). 이름(mDNS)으로 붙었어도 대역을 남긴다. */
  function rememberPrefixes(base, info) {
    const found = [base, ...(Array.isArray(info?.addresses) ? info.addresses.map((ip) => `http://${ip}`) : [])]
      .map(ipv4Prefix)
      .filter(Boolean);
    if (!found.length) return;
    const merged = [...new Set([...found, ...storedPrefixes()])].slice(0, 4);
    storage.set(PREFIXES_KEY, JSON.stringify(merged));
  }

  function storedPrefixes() {
    try {
      const list = JSON.parse(storage.get(PREFIXES_KEY) ?? "[]");
      return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
    } catch {
      return [];
    }
  }

  /** 탐색 힌트: 기억한 대역, 마지막·수동 주소의 대역. */
  function scanHints() {
    return [...storedPrefixes(), ...candidates().map((c) => c.base)];
  }

  /**
   * 공유기 대역을 훑는다. stage가 "primary"면 1단계(자동), "secondary"면 2단계([더 찾아보기]).
   * 대역은 하나씩 끝내고, 시간 제한에 걸린 시도가 소켓 풀을 채우지 않게 속도를 조절한다(pc-scan.js).
   */
  async function discover(hints, attempts, signal, stage = "primary") {
    const plan = buildScanPlan({ hints, primary: scanOptions.primary, secondary: scanOptions.secondary });
    const prefixes = stage === "secondary" ? plan.stage2 : plan.stage1;
    let wrongServers = [];
    let lastPush = 0;
    if (!prefixes.length || signal?.aborted) return { found: null, scanned: [], wrongServers };
    const stageTotal = prefixes.length * 254;
    const outcome = await scanPrefixes({
      prefixes,
      port,
      concurrency: scanOptions.concurrency ?? 24,
      baseFor: scanOptions.baseFor ?? defaultBaseFor,
      ledger: scanOptions.ledger ?? defaultLedger,
      signal,
      probe: (base, probeSignal) => probe(base, scanOptions.timeoutMs ?? 600, probeSignal),
      onProgress: ({ done, prefix }) => {
        const now = Date.now();
        if (now - lastPush < 250) return;
        lastPush = now;
        setState({ progress: progressText(prefix, done, stageTotal) });
      },
    });
    wrongServers = wrongServers.concat(outcome.wrongServers);
    if (outcome.found) return { found: outcome.found, scanned: prefixes, wrongServers };
    if (!signal?.aborted) {
      const shown = prefixes.length > 4 ? `${prefixes.slice(0, 4).map((p) => `${p}.x`).join(", ")} 외 ${prefixes.length - 4}개` : prefixes.map((p) => `${p}.x`).join(", ");
      attempts.push({ base: `${stage === "secondary" ? "드문" : "흔한"} 공유기 대역 ${shown}`, via: "scan", error: "응답 없음" });
    }
    return { found: null, scanned: prefixes, wrongServers };
  }

  const connected = (base, via, info, attempts) => {
    storage.set(LAST_BASE_KEY, base);
    rememberPrefixes(base, info);
    setState({ status: "connected", base, via, info, attempts, reason: null, progress: null, moreAvailable: false });
    return state;
  };

  /**
   * 못 찾았을 때의 마무리. 혼합 콘텐츠 판정은 여기서(탐색이 끝난 뒤) 안내 문구를 고르는 데만 쓴다.
   * @param {Array<{ base: string, via: string, error: string }>} attempts
   */
  async function finishFailed(attempts, sawWrongServer, moreAvailable) {
    const mixedBlocked = await isMixedBlocked();
    const blockedAttempt = mixedBlocked && attempts.some((a) => (/^http:/.test(a.base) && !isLoopbackBase(a.base)) || a.via === "scan");
    const reason = blockedAttempt ? "mixed-content" : sawWrongServer ? "wrong-server" : "unreachable";
    setState({ status: "failed", base: null, via: null, info: null, attempts, reason, progress: null, moreAvailable: moreAvailable && reason === "unreachable" });
    return state;
  }

  let mixedChecked = null;
  const isMixedBlocked = () => (mixedChecked ??= mixedContentProbe().catch(() => false));

  async function runConnect() {
    setState({ status: "connecting", attempts: [], reason: null, progress: null, moreAvailable: false });
    mixedChecked = null;
    const attempts = [];
    let sawWrongServer = false;
    let permission = await permissionState();
    const list = candidates();
    const hints = scanHints();

    // 처음 한 번은 권한 창이 뜬다. 사람이 답할 때까지만 기다리고, 그 뒤로는 짧은 제한 시간으로 훑는다.
    if (permission === "prompt") {
      const firstPrefix = buildScanPlan({ hints, primary: scanOptions?.primary }).stage1[0] ?? "192.168.0";
      const target = list.find((c) => ipv4Prefix(c.base))?.base ?? `http://${firstPrefix}.2:${port}`;
      const { result } = await waitForPermissionAnswer(target);
      if (result.ok) return connected(target, list.find((c) => c.base === target)?.via ?? "scan", result.info, attempts);
      permission = await permissionState();
    }
    if (permission === "denied") {
      setState({ status: "failed", base: null, via: null, info: null, attempts, reason: "denied", progress: null, moreAvailable: false });
      return state;
    }

    // 1) IP 주소 후보(마지막 성공 주소, 수동 주소)를 차례로.
    for (const { base, via } of list.filter((c) => c.via !== "mdns")) {
      const result = await probe(base, quickTimeoutMs);
      if (result.ok) return connected(base, via, result.info, attempts);
      if (result.kind === "wrong-server") sawWrongServer = true;
      attempts.push({ base, via, error: result.error });
    }

    // 2) 이름(sharp-vr.local)과 1단계 공유기 대역 탐색을 동시에. 먼저 성공한 쪽을 쓴다.
    //    이름 해석이 느리거나 안 되는 기기(Quest 브라우저 등)도 탐색이 따로 찾는다.
    const race = new AbortController();
    const tasks = [];
    const mdns = list.find((c) => c.via === "mdns");
    const mdnsTask = mdns
      ? probe(mdns.base, mdnsTimeoutMs, race.signal).then((result) => {
          if (result.ok) {
            race.abort(); // 이름이 풀렸으면 탐색은 하지 않는다
            return { base: mdns.base, via: "mdns", info: result.info };
          }
          if (race.signal.aborted) return null;
          if (result.kind === "wrong-server") sawWrongServer = true;
          attempts.push({ base: mdns.base, via: "mdns", error: result.error });
          return null;
        })
      : null;
    if (mdnsTask) tasks.push(mdnsTask);
    if (scanOptions) {
      tasks.push(
        (async () => {
          // 이름이 잘 풀리는 LAN에서 불필요한 요청을 보내지 않도록, 이름 결과를 잠깐 기다린다.
          // 이름이 곧바로 실패하면(Quest처럼 .local을 못 푸는 경우) 기다리지 않고 시작한다.
          if (mdnsTask) await Promise.race([mdnsTask.catch(() => null), sleep(scanOptions.startDelayMs ?? 1500)]);
          if (race.signal.aborted) return null;
          const outcome = await discover(hints, attempts, race.signal, "primary");
          if (outcome.found) {
            race.abort();
            return { base: outcome.found.base, via: "scan", info: outcome.found.info };
          }
          if (outcome.wrongServers.length) sawWrongServer = true;
          return null;
        })(),
      );
    }
    const winner = await firstSuccess(tasks);
    race.abort();
    if (winner) return connected(winner.base, winner.via, winner.info, attempts);

    const hasMore = !!scanOptions && buildScanPlan({ hints, primary: scanOptions.primary, secondary: scanOptions.secondary }).stage2.length > 0;
    return finishFailed(attempts, sawWrongServer, hasMore);
  }

  /** [더 찾아보기]: 드문 공유기 대역(2단계)을 훑는다. 포트 스캔으로 오인되지 않도록 사용자가 눌렀을 때만 부른다. */
  async function runScanMore() {
    const attempts = [...state.attempts];
    mixedChecked = null;
    setState({ status: "connecting", progress: null, reason: null, moreAvailable: false });
    const outcome = await discover(scanHints(), attempts, undefined, "secondary");
    if (outcome.found) return connected(outcome.found.base, "scan", outcome.found.info, attempts);
    return finishFailed(attempts, outcome.wrongServers.length > 0, false);
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
    /** 드문 공유기 대역까지 더 찾아본다([더 찾아보기] 버튼). 이미 연결 시도 중이면 그 결과를 기다린다. */
    scanMore() {
      if (!scanOptions) return Promise.resolve(state);
      running ??= runScanMore().finally(() => {
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
  if (state.reason === "mixed-content") {
    return {
      title: "이 브라우저가 앱에서 PC로 가는 연결을 막고 있습니다",
      steps: [
        "방화벽이나 Wi-Fi 문제가 아닙니다. 앱은 https 주소에서 열려 있고, 브라우저가 보안 규칙(혼합 콘텐츠)에 따라 이 앱에서 PC의 http 주소로 가는 요청을 막았습니다.",
        "PC의 서버 창이 켜져 있어도, 주소를 직접 입력해도 같은 증상이 나옵니다. 이 화면의 내용을 개발 담당에게 알려 주세요. 연결 방식을 바꿔야 합니다.",
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
  const scanned = state.attempts?.some((a) => a.via === "scan");
  return {
    title: "PC에 연결하지 못했습니다",
    steps: [
      "PC에서 run_quest_pc_server.bat를 실행하고 검은 창을 열어 두세요. 창에 'PC 주소'가 보이면 서버는 켜진 것입니다.",
      "Quest와 PC가 같은 Wi-Fi(공유기)에 있는지 확인하세요. 게스트 Wi-Fi나 'AP 격리'가 켜진 공유기는 기기끼리 보이지 않습니다.",
      "처음 실행하면 Windows 방화벽 창이 뜹니다. '개인 네트워크'를 허용하세요. 이미 닫았다면 방화벽 설정에서 Python의 개인 네트워크 허용을 켜세요.",
      "PC의 네트워크 프로필이 '개인'인지 확인하세요(설정 > 네트워크 및 인터넷 > Wi-Fi/이더넷 > 네트워크 프로필 유형). '공용'이면 연결이 막힙니다.",
      "브라우저가 '로컬 네트워크 기기 찾기' 권한을 물으면 허용하세요.",
      scanned
        ? `앱이 sharp-vr.local 이름과 흔한 공유기 주소를 모두 찾아봤지만 응답이 없었습니다.${state.moreAvailable ? " [더 찾아보기]를 누르면 드문 공유기 주소까지 찾아봅니다(몇 분 걸릴 수 있습니다)." : ""} 서버 창에 적힌 'PC 주소'의 숫자(예: 192.168.50.149)를 아래 [고급: 주소 직접 입력]에 한 번만 적으면, 다음부터는 자동으로 연결됩니다.`
        : "그래도 안 되면 서버 창에 적힌 'PC 주소'의 숫자(예: 192.168.50.149)를 아래 [고급: 주소 직접 입력]에 적으세요.",
    ],
  };
}

/** 연결된 방법을 한 줄로. 이름(mDNS)이 안 풀려 탐색으로 찾았는지 알 수 있게 한다. */
export function describeVia(state) {
  if (state?.status !== "connected") return "";
  switch (state.via) {
    case "mdns":
      return "연결 방법: sharp-vr.local 이름";
    case "scan":
      return "연결 방법: 공유기 주소 자동 탐색 (이 기기에서는 sharp-vr.local 이름이 풀리지 않을 수 있습니다)";
    case "manual":
      return "연결 방법: 직접 입력한 주소";
    default:
      return "연결 방법: 마지막으로 성공한 주소";
  }
}

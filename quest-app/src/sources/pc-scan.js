// PC 서버 주소 탐색: 흔한 공유기 대역(/24)에서 /api/info에 SHARP 서버가 답하는 주소를 찾는다.
// Quest 브라우저는 sharp-vr.local(mDNS) 이름을 풀지 못하는 경우가 있어 IP 입력 없이 연결하려면 이 경로가 필요하다.
// 순수 로직이라 Node에서 테스트한다. 소유: sync-dev.
//
// 주의(실측): 응답 없는 주소로 보낸 연결 시도는 우리가 abort해도 브라우저 소켓 풀에 약 20초 남는다.
// 풀(전체 약 256개)이 차면 살아 있는 서버로 가는 요청도 밀려 놓친다. 그래서 "시간 제한에 걸린 시도"를 장부에 적고,
// 최근 20초 안의 개수가 예산을 넘지 않게 속도를 조절한다. 대역은 하나씩 끝내고, 드문 대역(2단계)은 사용자가 요청할 때만 훑는다.

/** 1단계: 가정용 공유기 기본 대역 (ASUS 192.168.50, LG U+ 192.168.219, KT·SK 172.30.1 등). */
export const PRIMARY_PREFIXES = ["192.168.0", "192.168.1", "192.168.50", "192.168.219", "172.30.1"];

/** 2단계: 사용자가 [더 찾아보기]를 눌렀을 때만 훑는 드문 대역 (안드로이드 핫스팟 192.168.43 등). */
export const SECONDARY_PREFIXES = [
  "10.0.0", "192.168.2", "192.168.3", "192.168.10", "192.168.31", "192.168.43", "192.168.86", "192.168.100",
  "192.168.123", "192.168.137", "192.168.199", "192.168.200", "10.0.1", "10.1.1", "172.16.0",
];

/** 시간 제한에 걸린 시도가 소켓 풀에 남아 있는 시간(실측 약 20초, 여유를 둔다). */
export const LINGER_MS = 22000;
/** 풀에 남아 있을 수 있는 시도의 최대 개수(전체 약 256개 중 앱의 다른 연결 몫을 남긴다). */
export const ZOMBIE_BUDGET = 150;

const PRIVATE_IPV4 = /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;
const PREFIX_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** `192.168.0` 같은 대역 문자열이 사설 IPv4의 앞 세 자리인가. */
export function isPrefix(text) {
  const match = PREFIX_RE.exec(String(text ?? ""));
  return !!match && PRIVATE_IPV4.test(`${text}.1`) && [match[1], match[2], match[3]].every((part) => Number(part) <= 255);
}

/** `http://192.168.0.23:8787` 같은 주소에서 사설 IPv4의 앞 세 자리(`192.168.0`)를 꺼낸다. 아니면 null. */
export function ipv4Prefix(base) {
  const match = /^https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(String(base ?? ""));
  if (!match || !PRIVATE_IPV4.test(`${match[1]}.${match[2]}`)) return null;
  if ([...match[1].split("."), match[2]].some((part) => Number(part) > 255)) return null;
  return match[1];
}

/**
 * 탐색 순서. 힌트(기억한 대역, 마지막·수동 주소)를 맨 앞에 두고 중복은 뺀다.
 * @param {object} [options]
 * @param {string[]} [options.hints]       이미 아는 대역(`192.168.0`) 또는 주소(base)
 * @param {string[]} [options.primary]
 * @param {string[]} [options.secondary]
 * @returns {{ stage1: string[], stage2: string[] }}
 */
export function buildScanPlan({ hints = [], primary = PRIMARY_PREFIXES, secondary = SECONDARY_PREFIXES } = {}) {
  const seen = new Set();
  const take = (list) => list.filter((prefix) => prefix && !seen.has(prefix) && seen.add(prefix));
  const hinted = take(hints.map((hint) => (isPrefix(hint) ? hint : ipv4Prefix(hint))).filter(Boolean));
  const stage1 = [...hinted, ...take(primary)];
  const stage2 = take(secondary);
  return { stage1, stage2 };
}

/**
 * 호스트 번호 구간(훑는 순서). 가정용 공유기 DHCP는 .100~.199를 흔히 쓰므로 그 구간을 모든 대역에서 먼저 보고,
 * 나머지는 그다음 차례로 본다. 공유기 자리인 .1은 마지막이다.
 */
export const HOST_WINDOWS = [[100, 199], [2, 99], [200, 254], [1, 1]];

/** 한 대역의 한 구간(from~to)의 호스트 주소. 구간을 주지 않으면 한 대역 전체를 훑는 순서로 돌려준다. */
export function hostsFor(prefix, windows = HOST_WINDOWS) {
  const hosts = [];
  for (const [from, to] of windows) for (let n = from; n <= to; n += 1) hosts.push(`${prefix}.${n}`);
  return hosts;
}

/** 기본 접속 주소 만들기: `http://192.168.0.23:8787` */
export const defaultBaseFor = (host, port) => `http://${host}:${port}`;

/**
 * 시간 제한에 걸린 시도의 장부. 앱 전체에서 하나를 공유한다(연결을 연달아 다시 눌러도 풀을 비워 가며 진행한다).
 * @param {{ budget?: number, lingerMs?: number, now?: () => number }} [options]
 */
export function createLedger({ budget = ZOMBIE_BUDGET, lingerMs = LINGER_MS, now = () => Date.now() } = {}) {
  /** @type {number[]} */
  let stamps = [];
  const purge = () => {
    const cutoff = now() - lingerMs;
    stamps = stamps.filter((at) => at > cutoff);
  };
  return {
    budget,
    lingerMs,
    /** 시간 제한에 걸려 끊은 시도를 적는다. */
    recordTimeout() {
      stamps.push(now());
    },
    /** 아직 풀에 남아 있을 수 있는 시도 수. */
    get lingering() {
      purge();
      return stamps.length;
    },
    /** 새 시도를 보내도 되는 때까지 기다릴 시간(ms). 0이면 바로. */
    waitMs(inflight = 0) {
      purge();
      if (stamps.length + inflight < budget) return 0;
      if (!stamps.length) return 25; // 진행 중 시도만으로 찬 경우: 곧 끝난다
      return Math.max(25, stamps[0] + lingerMs - now());
    },
    clear() {
      stamps = [];
    },
  };
}

/** 앱 전체가 공유하는 장부. */
export const defaultLedger = createLedger();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 대역을 우선순위 순서로 하나씩 끝내며 훑는다. 먼저 모든 대역의 .100~.199를 보고(흔한 DHCP 구간), 그다음
 * 나머지 구간을 같은 순서로 본다. 처음 찾은 서버에서 멈추고 나머지 요청은 중단시킨다.
 * @param {object} options
 * @param {string[]} options.prefixes
 * @param {number} options.port
 * @param {(base: string, signal: AbortSignal) => Promise<{ ok: boolean, info?: any, kind?: string, timedOut?: boolean }>} options.probe
 * @param {number} [options.concurrency]   동시에 보낼 수 있는 시도 수(기본 24)
 * @param {AbortSignal} [options.signal]   바깥에서 중단할 때
 * @param {(progress: { done: number, total: number, prefix: string }) => void} [options.onProgress]
 * @param {(host: string, port: number) => string} [options.baseFor]  IP에서 접속 주소를 만드는 함수. 기본은 `http://IP:포트`.
 *        https 이름 방식(예: 주소를 이름에 넣는 와일드카드 DNS)으로 바꿀 때 여기만 갈아 끼운다.
 * @param {ReturnType<typeof createLedger>} [options.ledger]
 * @returns {Promise<{ found: { base: string, info: any } | null, tried: number, wrongServers: string[] }>}
 */
export async function scanPrefixes({ prefixes, port, probe, concurrency = 24, signal, onProgress, baseFor = defaultBaseFor, ledger = defaultLedger }) {
  const total = prefixes.length * 254;
  const stop = new AbortController();
  const onOuterAbort = () => stop.abort();
  if (signal?.aborted) stop.abort();
  else signal?.addEventListener("abort", onOuterAbort, { once: true });

  let done = 0;
  let inflight = 0;
  let found = null;
  const wrongServers = [];

  async function scanHosts(prefix, windows) {
    const queue = hostsFor(prefix, [windows]).map((host) => baseFor(host, port));
    let next = 0;
    async function worker() {
      while (!stop.signal.aborted && next < queue.length) {
        // 소켓 풀에 남아 있는 시도가 예산을 넘지 않게 기다린다.
        for (let wait = ledger.waitMs(inflight); wait > 0 && !stop.signal.aborted; wait = ledger.waitMs(inflight)) await sleep(Math.min(wait, 250));
        if (stop.signal.aborted || next >= queue.length) return;
        const base = queue[next++];
        inflight += 1;
        let result;
        try {
          result = await probe(base, stop.signal);
        } catch {
          result = { ok: false };
        }
        inflight -= 1;
        done += 1;
        if (result?.timedOut && !stop.signal.aborted) ledger.recordTimeout();
        if (result?.ok && !found) {
          found = { base, info: result.info };
          stop.abort();
        } else if (result?.kind === "wrong-server") {
          wrongServers.push(base);
        }
        onProgress?.({ done, total, prefix });
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  }

  try {
    for (const windows of HOST_WINDOWS) {
      for (const prefix of prefixes) {
        if (stop.signal.aborted) break;
        await scanHosts(prefix, windows); // 한 대역의 한 구간을 끝낸 뒤 다음 대역으로
      }
    }
  } finally {
    signal?.removeEventListener("abort", onOuterAbort);
  }
  return { found, tried: done, wrongServers };
}

// PC 서버 주소 탐색: 흔한 공유기 대역(/24)을 병렬로 짧게 훑어 /api/info에 SHARP 서버가 답하는 주소를 찾는다.
// Quest 브라우저는 sharp-vr.local(mDNS) 이름을 풀지 못하는 경우가 있어 IP 입력 없이 연결하려면 이 경로가 필요하다.
// 순수 로직이라 Node에서 테스트한다. 소유: sync-dev.

/** 1단계: 가정용 공유기 기본 대역 (ASUS 192.168.50, LG U+ 192.168.219, KT·SK 172.30.1 등). */
export const PRIMARY_PREFIXES = ["192.168.0", "192.168.1", "192.168.50", "192.168.219", "172.30.1", "10.0.0"];

/** 2단계: 1단계에서 못 찾았을 때만 훑는 드문 대역 (안드로이드 핫스팟 192.168.43 등). */
export const SECONDARY_PREFIXES = [
  "192.168.2", "192.168.3", "192.168.10", "192.168.31", "192.168.43", "192.168.86", "192.168.100",
  "192.168.123", "192.168.137", "192.168.199", "192.168.200", "10.0.1", "10.1.1", "172.16.0",
];

const PRIVATE_IPV4 = /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;

/** `http://192.168.0.23:8787` 같은 주소에서 사설 IPv4의 앞 세 자리(`192.168.0`)를 꺼낸다. 아니면 null. */
export function ipv4Prefix(base) {
  const match = /^https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(String(base ?? ""));
  if (!match || !PRIVATE_IPV4.test(`${match[1]}.${match[2]}`)) return null;
  if ([...match[1].split("."), match[2]].some((part) => Number(part) > 255)) return null;
  return match[1];
}

/**
 * 탐색 순서. 힌트(마지막·수동 주소의 대역)를 맨 앞에 두고 중복은 뺀다.
 * @param {object} [options]
 * @param {string[]} [options.hints]       이미 아는 주소(base). 같은 대역을 먼저 훑는다.
 * @param {string[]} [options.primary]
 * @param {string[]} [options.secondary]
 * @returns {{ stage1: string[], stage2: string[] }}
 */
export function buildScanPlan({ hints = [], primary = PRIMARY_PREFIXES, secondary = SECONDARY_PREFIXES } = {}) {
  const seen = new Set();
  const take = (list) => list.filter((prefix) => prefix && !seen.has(prefix) && seen.add(prefix));
  const hinted = take(hints.map(ipv4Prefix).filter(Boolean));
  const stage1 = [...hinted, ...take(primary)];
  const stage2 = take(secondary);
  return { stage1, stage2 };
}

/** 기본 접속 주소 만들기: `http://192.168.0.23:8787` */
export const defaultBaseFor = (host, port) => `http://${host}:${port}`;

/** 한 대역의 호스트 번호. 공유기 자리인 .1은 마지막에 본다. */
export function hostsFor(prefix) {
  const hosts = [];
  for (let n = 2; n <= 254; n += 1) hosts.push(`${prefix}.${n}`);
  hosts.push(`${prefix}.1`);
  return hosts;
}

/**
 * 여러 대역을 우선순위 순서로 훑는다. 처음 찾은 서버에서 멈추고 나머지 요청은 중단시킨다.
 * @param {object} options
 * @param {string[]} options.prefixes
 * @param {number} options.port
 * @param {(base: string, signal: AbortSignal) => Promise<{ ok: boolean, info?: any, kind?: string }>} options.probe
 * @param {number} [options.concurrency]
 * @param {AbortSignal} [options.signal]   바깥에서 중단할 때
 * @param {(progress: { done: number, total: number, prefix: string }) => void} [options.onProgress]
 * @param {(host: string, port: number) => string} [options.baseFor]  IP에서 접속 주소를 만드는 함수. 기본은 `http://IP:포트`.
 *        https 이름 방식(예: 주소를 이름에 넣는 와일드카드 DNS)으로 바꿀 때 여기만 갈아 끼운다.
 * @returns {Promise<{ found: { base: string, info: any } | null, tried: number, wrongServers: string[] }>}
 */
export async function scanPrefixes({ prefixes, port, probe, concurrency = 96, signal, onProgress, baseFor = defaultBaseFor }) {
  const queue = [];
  for (const prefix of prefixes) for (const host of hostsFor(prefix)) queue.push({ base: baseFor(host, port), prefix });
  const total = queue.length;
  const stop = new AbortController();
  const onOuterAbort = () => stop.abort();
  if (signal?.aborted) stop.abort();
  else signal?.addEventListener("abort", onOuterAbort, { once: true });

  let next = 0;
  let done = 0;
  let found = null;
  const wrongServers = [];

  async function worker() {
    while (!stop.signal.aborted && next < queue.length) {
      const { base, prefix } = queue[next++];
      let result;
      try {
        result = await probe(base, stop.signal);
      } catch {
        result = { ok: false };
      }
      done += 1;
      if (result?.ok && !found) {
        found = { base, info: result.info };
        stop.abort();
      } else if (result?.kind === "wrong-server") {
        wrongServers.push(base);
      }
      onProgress?.({ done, total, prefix });
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  } finally {
    signal?.removeEventListener("abort", onOuterAbort);
  }
  return { found, tried: done, wrongServers };
}

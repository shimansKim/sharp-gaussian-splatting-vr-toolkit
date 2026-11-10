// 서비스 워커 소스 프록시의 페이지 쪽 (설계 4.7).
// 파일은 `<앱 base>__src/<sourceId>/<인코딩된 경로>` 같은 출처 URL로 열고,
// sw의 source-proxy.js가 실제 원본(PC 서버, 드라이브)으로 중계한다.
// 소유: sync-dev.

export const SOURCE_PROXY_PREFIX = "__src/";

function defaultBase() {
  // Vite가 빌드 때 BASE_URL을 채운다. Node 테스트에서는 "/"로 둔다.
  return import.meta.env?.BASE_URL ?? "/";
}

/** 경로 조각마다 인코딩하고 `/`는 남긴다. */
export function encodePath(path) {
  return String(path)
    .split("/")
    .filter((part) => part !== "")
    .map(encodeURIComponent)
    .join("/");
}

/**
 * 같은 출처 프록시 URL.
 * @param {string} sourceId  'pc' | 'gdrive'
 * @param {string} path      pc는 `<root>/<상대 경로>`, gdrive는 파일 id
 * @param {string} [baseUrl] 앱 base 경로(끝에 /)
 */
export function proxyUrl(sourceId, path, baseUrl = defaultBase()) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}${SOURCE_PROXY_PREFIX}${sourceId}/${encodePath(path)}`;
}

/** 서비스 워커가 이 페이지를 제어하고 있는가(=프록시 URL이 통하는가). */
export function proxyAvailable() {
  return typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
}

/**
 * 서비스 워커가 이 페이지를 제어할 때까지 잠시 기다린다. 앱을 처음 연 직후에는 워커가 설치·활성화(clients.claim)되기 전이라
 * 제어가 없다. 이때 http://PC주소 직접 URL을 <video>·<img>에 붙이면 https 페이지에서 혼합 콘텐츠로 막힐 수 있어
 * 프록시(같은 출처 URL)를 쓸 수 있을 때까지 기다린다. 워커 등록이 없으면(개발 서버 등) 기다리지 않고 false.
 * @param {number} [timeoutMs]
 * @param {ServiceWorkerContainer} [sw]  테스트용
 * @returns {Promise<boolean>} 프록시를 쓸 수 있는가
 */
export async function ensureProxyControl(timeoutMs = 5000, sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined) {
  if (!sw) return false;
  if (sw.controller) return true;
  try {
    if (sw.getRegistration && !(await sw.getRegistration())) return false;
  } catch {
    return false;
  }
  if (sw.controller) return true;
  return new Promise((resolve) => {
    const finish = (value) => {
      clearTimeout(timer);
      sw.removeEventListener?.("controllerchange", onChange);
      resolve(value);
    };
    const onChange = () => {
      if (sw.controller) finish(true);
    };
    const timer = setTimeout(() => finish(!!sw.controller), timeoutMs);
    sw.addEventListener?.("controllerchange", onChange);
    sw.ready?.then(() => {
      if (sw.controller) finish(true);
    }, () => {});
  });
}

/**
 * 서비스 워커에 소스별 설정(PC 서버 주소, 드라이브 토큰 등)을 전한다.
 * 워커가 저장했다고 답하면 true. 워커가 없거나 시간 안에 답이 없으면 false.
 * @param {string} sourceId
 * @param {object} config
 * @param {number} [timeoutMs]
 */
export async function configureProxy(sourceId, config, timeoutMs = 2000) {
  const worker = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
  if (!worker) return false;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.ok === true);
    };
    worker.postMessage({ type: "sharp-src-config", sourceId, config }, [channel.port2]);
  });
}

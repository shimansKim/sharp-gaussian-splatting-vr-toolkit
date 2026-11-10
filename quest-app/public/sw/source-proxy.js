// 서비스 워커 소스 프록시 (설계 4.7). 소유: sync-dev.
//
// 클래식 스크립트다. 진입점 sw.js(app-dev)에서 이렇게 붙인다:
//   importScripts("./sw/source-proxy.js");
//   self.addEventListener("fetch", (event) => { if (self.sharpSourceProxy.onFetch(event)) return; /* 앱 셸 캐시 */ });
//   self.addEventListener("message", (event) => { self.sharpSourceProxy.onMessage(event); });
//
// 같은 출처 URL `<scope>__src/<sourceId>/<경로>` 를 원본으로 중계한다. Range 헤더를 그대로 전달해
// <video> seek가 동작하고, 응답이 같은 출처라 WebGL 텍스처 CORS 오염이 없다.
// 설정(PC 서버 주소 등)은 페이지가 postMessage로 보내며, 워커가 종료돼도 남도록 Cache API에 저장한다.
(function (root) {
  "use strict";

  var PREFIX = "__src/";
  var CONFIG_CACHE = "sharp-src-config-v1";
  var CONFIG_KEY_BASE = "https://sharp-src-config.invalid/";

  /**
   * 허용하는 PC 서버 주소: 앱의 normalizeBase(src/sources/pc-connect.js)가 만드는 모양과 같다.
   * `http(s)://호스트[:포트]` 뿐이고 경로·계정·질의가 붙으면 거절한다. 호스트는 이름(MYPC.local, 터널 주소),
   * IPv4(사설·Tailscale 포함), [IPv6]이다. 주소는 같은 출처의 앱 페이지만 정해 줄 수 있다.
   */
  var PC_BASE_RE = /^https?:\/\/([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(:\d{1,5})?$/;

  var memory = {};

  async function loadConfig(sourceId) {
    if (memory[sourceId]) return memory[sourceId];
    try {
      var cache = await caches.open(CONFIG_CACHE);
      var hit = await cache.match(CONFIG_KEY_BASE + sourceId);
      if (hit) {
        memory[sourceId] = await hit.json();
        return memory[sourceId];
      }
    } catch (e) {
      /* Cache API를 못 쓰면 메모리 값만 쓴다 */
    }
    return null;
  }

  async function saveConfig(sourceId, config) {
    memory[sourceId] = config;
    try {
      var cache = await caches.open(CONFIG_CACHE);
      await cache.put(CONFIG_KEY_BASE + sourceId, new Response(JSON.stringify(config), { headers: { "Content-Type": "application/json" } }));
    } catch (e) {
      /* 저장 실패는 치명적이지 않다: 페이지가 다음 열기 전에 다시 보낸다 */
    }
  }

  function fail(status, message) {
    return new Response(message, { status: status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  /** 소스별 원본 요청 만들기. 실패하면 Response를 돌려준다. */
  var resolvers = {
    pc: function (config, rest) {
      var base = config && config.base;
      if (!base || !PC_BASE_RE.test(base)) return fail(503, "PC 서버 주소가 설정되지 않았습니다. 앱에서 [PC] 탭의 다시 연결을 누르세요.");
      // LNA 표시는 http(LAN) 주소에만 붙인다. https 터널은 공용 주소라 붙이면 막힌다.
      return { url: base + "/files/" + rest, headers: {}, init: /^http:/.test(base) ? { targetAddressSpace: "local" } : {} };
    },
  };

  /** 다른 소스(gdrive 등)가 자기 resolver를 붙일 때 쓴다. */
  function registerResolver(sourceId, resolver) {
    resolvers[sourceId] = resolver;
  }

  async function proxy(request, sourceId, rest) {
    var resolver = resolvers[sourceId];
    if (!resolver) return fail(404, "알 수 없는 소스: " + sourceId);
    var config = await loadConfig(sourceId);
    var target = resolver(config, rest);
    if (target instanceof Response) return target;

    var headers = new Headers(target.headers);
    var range = request.headers.get("Range");
    if (range) headers.set("Range", range);
    var init = Object.assign({ method: request.method === "HEAD" ? "HEAD" : "GET", headers: headers, cache: "no-store", mode: "cors" }, target.init);
    var upstream;
    try {
      upstream = await fetch(target.url, init);
    } catch (e) {
      return fail(502, "원본에 연결하지 못했습니다: " + (e && e.message ? e.message : e));
    }
    // 본문은 스트림으로 그대로 넘긴다. 필요한 헤더만 옮긴다.
    var out = new Headers();
    ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified"].forEach(function (name) {
      var value = upstream.headers.get(name);
      if (value) out.set(name, value);
    });
    out.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
  }

  /** fetch 이벤트용. 프록시 요청이면 응답을 걸고 true를 돌려준다. */
  function onFetch(event) {
    var request = event.request;
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    var url = new URL(request.url);
    var scope = root.registration && root.registration.scope ? new URL(root.registration.scope).pathname : "/";
    var marker = scope + PREFIX;
    if (url.origin !== root.location.origin || url.pathname.indexOf(marker) !== 0) return false;
    var tail = url.pathname.slice(marker.length);
    var slash = tail.indexOf("/");
    if (slash <= 0) {
      event.respondWith(fail(400, "잘못된 프록시 주소"));
      return true;
    }
    var sourceId = tail.slice(0, slash);
    var rest = tail.slice(slash + 1); // 인코딩된 채로 원본 서버에 넘긴다
    if (rest.split("/").some(function (part) { return part === ".." || part === "%2e%2e" || part === "%2E%2E"; })) {
      event.respondWith(fail(400, "잘못된 경로"));
      return true;
    }
    event.respondWith(proxy(request, sourceId, rest));
    return true;
  }

  /** message 이벤트용. 페이지가 보낸 소스 설정을 저장하고 MessageChannel로 확인을 돌려준다. */
  function onMessage(event) {
    var data = event.data;
    if (!data || data.type !== "sharp-src-config" || typeof data.sourceId !== "string") return false;
    var port = event.ports && event.ports[0];
    var work = saveConfig(data.sourceId, data.config || null).then(function () {
      if (port) port.postMessage({ ok: true });
    });
    if (event.waitUntil) event.waitUntil(work);
    return true;
  }

  var api = { onFetch: onFetch, onMessage: onMessage, registerResolver: registerResolver, _pcBaseRe: PC_BASE_RE };
  root.sharpSourceProxy = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);

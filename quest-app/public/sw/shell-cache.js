// 앱 셸 캐시. 소유: app-dev. 클래식 스크립트(sw.js가 importScripts로 붙인다).
// - 설치: precache-manifest.js의 파일 목록을 전부 내려받아 캐시한다(Spark 포함, 오프라인에서도 앱이 열리도록).
// - 이동 요청(페이지): 네트워크 우선, 실패하면 캐시된 index.html.
// - 같은 출처 GET(해시가 붙은 assets 등): 캐시 우선, 없으면 네트워크 후 저장.
// - 새 버전: 목록이 바뀌면 sw.js 바이트가 달라져 새 워커가 설치되고, 활성화 때 옛 캐시를 지운다.
(function (root) {
  "use strict";

  var PREFIX = "sharp-shell-";
  var manifest = root.__SHARP_PRECACHE || { version: "dev", urls: [] };
  var CACHE = PREFIX + manifest.version;
  var SOURCE_PREFIX = "__src/";

  function scopeUrl(path) {
    return new URL(path, root.registration.scope).href;
  }

  async function onInstall() {
    root.skipWaiting();
    if (!manifest.urls.length) return;
    var cache = await caches.open(CACHE);
    // 하나가 실패해도 설치가 통째로 깨지지 않게 개별로 넣는다(핵심 파일은 아래에서 확인).
    var results = await Promise.all(
      manifest.urls.map(function (path) {
        return cache.add(new Request(scopeUrl(path), { cache: "reload" })).then(
          function () { return true; },
          function () { return false; }
        );
      })
    );
    if (!results[0]) throw new Error("앱 셸(index.html)을 캐시하지 못했습니다.");
  }

  async function onActivate() {
    var keys = await caches.keys();
    await Promise.all(
      keys
        .filter(function (key) { return key.indexOf(PREFIX) === 0 && key !== CACHE; })
        .map(function (key) { return caches.delete(key); })
    );
    await root.clients.claim();
    // 옛 화면이 새 배포 뒤에 옛 해시 파일을 요청해 실패하지 않게 한다. 보이지 않는 화면은 직접 새로고침하고,
    // 보이는 화면(VR·재생 중일 수 있음)은 새 코드가 알림을 받아 끝난 뒤 새로고침한다.
    var windows = await root.clients.matchAll({ type: "window" });
    windows.forEach(function (client) {
      if (client.visibilityState === "hidden" && client.navigate) client.navigate(client.url).catch(function () {});
      else client.postMessage({ type: "sharp:updated" });
    });
  }

  async function navigate(request) {
    try {
      var response = await fetch(request);
      if (response.ok) {
        var cache = await caches.open(CACHE);
        cache.put(scopeUrl("./"), response.clone());
      }
      return response;
    } catch (error) {
      var cached = (await caches.match(scopeUrl("./"))) || (await caches.match(request, { ignoreSearch: true }));
      if (cached) return cached;
      throw error;
    }
  }

  async function cacheFirst(request) {
    var cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    var response = await fetch(request);
    if (response.ok && response.type === "basic") {
      var cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  }

  /** @returns {boolean} 응답을 맡았으면 true */
  function onFetch(event) {
    var request = event.request;
    if (request.method !== "GET") return false;
    var url = new URL(request.url);
    if (url.origin !== root.location.origin) return false;
    if (url.href.indexOf(root.registration.scope + SOURCE_PREFIX) === 0) return false;
    if (request.headers.has("range")) return false; // 부분 요청은 캐시하지 않는다.

    if (request.mode === "navigate") {
      event.respondWith(navigate(request));
      return true;
    }
    // probe.html 등 앱 밖 페이지·정적 파일도 같은 규칙(캐시 우선)이면 갱신이 늦으므로 assets/·icons/만 캐시 우선.
    var relative = url.href.slice(root.registration.scope.length);
    if (/^(assets\/|icons\/|manifest\.webmanifest$)/.test(relative)) {
      event.respondWith(cacheFirst(request));
      return true;
    }
    return false;
  }

  root.sharpShellCache = { onInstall: onInstall, onActivate: onActivate, onFetch: onFetch };
})(self);

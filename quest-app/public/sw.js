// 서비스 워커 진입점. 앱 셸 캐시(app-dev)와 소스 프록시(sync-dev)를 합친다.
// - sw/shell-cache.js  : 앱 셸 오프라인 캐시. 목록은 빌드가 만드는 precache-manifest.js에서 온다.
// - sw/source-proxy.js : `__src/<소스>/...` 요청을 PC·드라이브 원본으로 중계(sync-dev, 없으면 건너뜀).
/* global importScripts, self */
"use strict";

try {
  importScripts("./precache-manifest.js");
} catch (error) {
  // dev 서버에는 이 파일이 없다. 캐시 없이 동작한다.
}
importScripts("./sw/shell-cache.js");
try {
  importScripts("./sw/source-proxy.js");
} catch (error) {
  // 소스 프록시가 아직 배포에 없는 빌드
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.sharpShellCache.onInstall());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.sharpShellCache.onActivate());
});

self.addEventListener("fetch", (event) => {
  // 소스 프록시가 먼저 본다: __src 요청은 캐시하지 않는다.
  if (self.sharpSourceProxy && self.sharpSourceProxy.onFetch(event)) return;
  self.sharpShellCache.onFetch(event);
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "sharp:skip-waiting") {
    self.skipWaiting();
    return;
  }
  if (self.sharpSourceProxy && self.sharpSourceProxy.onMessage) self.sharpSourceProxy.onMessage(event);
});

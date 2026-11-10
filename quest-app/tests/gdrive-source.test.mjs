// 구글 드라이브 소스·서비스 워커 gdrive resolver 테스트. 실행: npm test
// 구글 스크립트(GIS, Picker)는 가짜로 바꿔 끼운다. 실제 OAuth·Picker 동작은 사람 설정(H10) 뒤 실기기에서만 확인된다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { createGdriveSource, detectKind, GdriveError } from "../src/sources/gdrive-source.js";

const here = dirname(fileURLToPath(import.meta.url));
globalThis.self = globalThis;
globalThis.registration = { scope: "https://shimanskim.github.io/repo/" };
globalThis.location = new URL("https://shimanskim.github.io/repo/sw.js");
vm.runInThisContext(readFileSync(join(here, "..", "public", "sw", "source-proxy.js"), "utf8"));
const proxyModule = globalThis.sharpSourceProxy;

const config = { clientId: "cid.apps.googleusercontent.com", apiKey: "key", appId: "1234567890" };
const memoryStorage = () => {
  const data = {};
  return { get: (k) => data[k] ?? null, set: (k, v) => (v == null ? delete data[k] : (data[k] = v)), data };
};

/** 가짜 google.accounts.oauth2 + google.picker. picked에 Picker가 돌려줄 문서를 넣는다. */
function fakeGoogle({ picked = [], cancel = false, tokenError = null, expiresIn = 3600 } = {}) {
  const log = { tokenRequests: [], pickerBuilt: null, revoked: [] };
  const picker = {
    ViewId: { DOCS: "docs" },
    Feature: { MULTISELECT_ENABLED: "multi", SUPPORT_DRIVES: "drives" },
    Response: { ACTION: "action", DOCUMENTS: "docs" },
    Action: { PICKED: "picked", CANCEL: "cancel" },
    Document: { ID: "id", NAME: "name", MIME_TYPE: "mimeType", SIZE_BYTES: "sizeBytes", LAST_EDITED_UTC: "lastEditedUtc" },
    DocsView: class {
      setIncludeFolders() { return this; }
      setSelectFolderEnabled() { return this; }
    },
    PickerBuilder: class {
      constructor() { this.opts = { features: [] }; }
      setAppId(v) { this.opts.appId = v; return this; }
      setDeveloperKey(v) { this.opts.key = v; return this; }
      setOAuthToken(v) { this.opts.token = v; return this; }
      setLocale(v) { this.opts.locale = v; return this; }
      enableFeature(v) { this.opts.features.push(v); return this; }
      addView() { return this; }
      setCallback(cb) { this.cb = cb; return this; }
      build() {
        log.pickerBuilt = this.opts;
        return { setVisible: () => this.cb(cancel ? { action: "cancel" } : { action: "picked", docs: picked }) };
      }
    },
  };
  return {
    log,
    google: {
      picker,
      accounts: {
        oauth2: {
          initTokenClient: (opts) => ({
            requestAccessToken: (req) => {
              log.tokenRequests.push({ scope: opts.scope, client_id: opts.client_id, prompt: req.prompt });
              if (tokenError) opts.error_callback({ type: tokenError });
              else opts.callback({ access_token: `tok${log.tokenRequests.length}`, expires_in: expiresIn });
            },
          }),
          revoke: (t) => log.revoked.push(t),
        },
      },
    },
  };
}

const doc = (id, name, mimeType = "application/octet-stream", sizeBytes = 100) => ({ id, name, mimeType, sizeBytes, lastEditedUtc: 1700000000000 });

describe("detectKind", () => {
  test("확장자 우선, 없으면 MIME", () => {
    assert.equal(detectKind("a.PLY", "application/octet-stream"), "splat");
    assert.equal(detectKind("clip.mp4"), "video");
    assert.equal(detectKind("noext", "video/webm"), "video");
    assert.equal(detectKind("photo", "image/png"), "image");
    assert.equal(detectKind("notes.docx", "application/msword"), null);
  });
});

describe("gdrive-source", () => {
  test("설정이 비어 있으면 isConfigured false, 동작은 not-configured 오류", async () => {
    const source = createGdriveSource({ config: {}, storage: memoryStorage(), google: () => undefined });
    assert.equal(source.isConfigured(), false);
    await assert.rejects(source.signIn(), (e) => e instanceof GdriveError && e.code === "not-configured");
    await assert.rejects(source.pick(), (e) => e.code === "not-configured");
    assert.deepEqual(await source.list(), { items: [], dirs: [] });
  });

  test("signIn은 drive.file 범위로 토큰을 받아 상태를 바꾼다", async () => {
    const { google, log } = fakeGoogle();
    const source = createGdriveSource({ config, storage: memoryStorage(), google: () => google });
    const states = [];
    source.subscribe((s) => states.push(s.signedIn));
    assert.equal(source.state.signedIn, false);
    await source.signIn();
    assert.equal(source.state.signedIn, true);
    assert.deepEqual(log.tokenRequests[0], { scope: "https://www.googleapis.com/auth/drive.file", client_id: config.clientId, prompt: "" });
    assert.deepEqual(states, [true]);
    source.signOut();
    assert.equal(source.state.signedIn, false);
    assert.deepEqual(log.revoked, ["tok1"]);
  });

  test("팝업이 막히면 popup 오류", async () => {
    const { google } = fakeGoogle({ tokenError: "popup_failed_to_open" });
    const source = createGdriveSource({ config, storage: memoryStorage(), google: () => google });
    await assert.rejects(source.signIn(), (e) => e.code === "popup" && /팝업/.test(e.message));
  });

  test("pick: 고른 파일 중 지원 형식만 목록에 남고, 목록은 저장소에 기억된다", async () => {
    const { google, log } = fakeGoogle({ picked: [doc("id_ply_00001", "room.ply", "application/octet-stream", 5000), doc("id_mp4_00002", "tour.mp4", "video/mp4"), doc("id_doc_00003", "memo.docx", "application/msword")] });
    const storage = memoryStorage();
    const source = createGdriveSource({ config, storage, google: () => google });
    const result = await source.pick();
    assert.deepEqual(result.added.map((i) => [i.id, i.kind]), [["gdrive:id_ply_00001", "splat"], ["gdrive:id_mp4_00002", "video"]]);
    assert.deepEqual(result.skipped, ["memo.docx"]);
    assert.equal(log.pickerBuilt.appId, "1234567890");
    assert.equal(log.pickerBuilt.key, "key");
    assert.equal(log.pickerBuilt.token, "tok1");
    assert.equal(log.pickerBuilt.locale, "ko");

    // 새 인스턴스(앱 재시작)에서도 목록이 남아 있다
    const again = createGdriveSource({ config, storage, google: () => google });
    const { items } = await again.list();
    assert.deepEqual(items.map((i) => i.name), ["room.ply", "tour.mp4"]);
    assert.equal(items[0].size, 5000);
    assert.equal(items[0].path, "id_ply_00001");

    again.remove("id_ply_00001");
    assert.deepEqual((await again.list()).items.map((i) => i.name), ["tour.mp4"]);
  });

  test("pick을 취소하면 null", async () => {
    const { google } = fakeGoogle({ cancel: true });
    const source = createGdriveSource({ config, storage: memoryStorage(), google: () => google });
    assert.equal(await source.pick(), null);
  });

  test("만료가 가까우면 open이 토큰을 다시 받는다", async () => {
    const { google, log } = fakeGoogle({ expiresIn: 30 }); // 만료 여유(60초)보다 짧다
    let clock = 1_000_000;
    const source = createGdriveSource({
      config, storage: memoryStorage(), google: () => google, now: () => clock,
      fetch: async () => new Response("x", { status: 200 }),
    });
    await source.signIn();
    await source.open({ id: "gdrive:abcdefghij1", name: "a.ply", kind: "splat", path: "abcdefghij1" });
    assert.equal(log.tokenRequests.length, 2);
  });

  test("서비스 워커가 없으면 PLY는 Authorization 헤더로 직접 스트림한다", async () => {
    const { google } = fakeGoogle();
    const calls = [];
    const source = createGdriveSource({
      config, storage: memoryStorage(), google: () => google,
      fetch: async (url, init) => (calls.push({ url, auth: init.headers.Authorization }), new Response("PLYDATA", { status: 200 })),
    });
    const file = await source.open({ id: "gdrive:abcdefghij1", name: "a.ply", kind: "splat", path: "abcdefghij1" });
    const body = await new Response(await file.stream()).text();
    assert.equal(body, "PLYDATA");
    assert.equal(calls[0].url, "https://www.googleapis.com/drive/v3/files/abcdefghij1?alt=media&supportsAllDrives=true");
    assert.equal(calls[0].auth, "Bearer tok1");
  });

  test("서비스 워커가 없으면 영상은 blob URL로 열고 release가 해제한다, 너무 크면 거부", async () => {
    const { google } = fakeGoogle();
    const revoked = [];
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:fake";
    URL.revokeObjectURL = (u) => revoked.push(u);
    try {
      const source = createGdriveSource({ config, storage: memoryStorage(), google: () => google, fetch: async () => new Response("VIDEO", { status: 200 }) });
      const file = await source.open({ id: "gdrive:abcdefghij2", name: "t.mp4", kind: "video", size: 5, path: "abcdefghij2" });
      assert.equal(file.url, "blob:fake");
      file.release();
      assert.deepEqual(revoked, ["blob:fake"]);
      await assert.rejects(source.open({ id: "gdrive:abcdefghij3", name: "big.mp4", kind: "video", size: 5 * 1024 ** 3, path: "abcdefghij3" }), (e) => e.code === "too-large");
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
  });

  test("401/403/404는 auth 오류로 안내한다", async () => {
    const { google } = fakeGoogle();
    const source = createGdriveSource({ config, storage: memoryStorage(), google: () => google, fetch: async () => new Response("no", { status: 404 }) });
    const file = await source.open({ id: "gdrive:abcdefghij1", name: "a.ply", kind: "splat", path: "abcdefghij1" });
    await assert.rejects(file.stream(), (e) => e.code === "auth" && /다시 골라야/.test(e.message));
  });
});

describe("sw gdrive resolver", () => {
  const cacheStore = new Map();
  globalThis.caches = {
    open: async () => ({ put: async (k, v) => cacheStore.set(k, v), match: async (k) => cacheStore.get(k)?.clone() }),
  };
  const setConfig = async (cfg) => {
    proxyModule.onMessage({ data: { type: "sharp-src-config", sourceId: "gdrive", config: cfg }, ports: [{ postMessage() {} }], waitUntil() {} });
    await new Promise((r) => setTimeout(r, 10));
  };
  const request = async (path, headers = {}) => {
    let responded;
    const handled = proxyModule.onFetch({ request: new Request(`https://shimanskim.github.io/repo/__src/gdrive/${path}`, { headers }), respondWith: (p) => (responded = p) });
    assert.equal(handled, true);
    return responded;
  };

  test("토큰과 Range를 붙여 드라이브 API로 중계한다", async () => {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => (calls.push({ url, auth: init.headers.get("Authorization"), range: init.headers.get("Range") }), new Response("ab", { status: 206, headers: { "Content-Range": "bytes 0-1/9", "Content-Type": "video/mp4" } }));
    try {
      await setConfig({ token: "T0K", expiresAt: Date.now() + 3_600_000 });
      const response = await request("abcdefghij1", { Range: "bytes=0-1" });
      assert.equal(calls[0].url, "https://www.googleapis.com/drive/v3/files/abcdefghij1?alt=media&supportsAllDrives=true");
      assert.equal(calls[0].auth, "Bearer T0K");
      assert.equal(calls[0].range, "bytes=0-1");
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("Content-Range"), "bytes 0-1/9");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("만료된 토큰·잘못된 id는 원본에 요청하지 않고 거부한다", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("호출되면 안 된다");
    };
    try {
      await setConfig({ token: "old", expiresAt: Date.now() - 1000 });
      assert.equal((await request("abcdefghij1")).status, 401);
      await setConfig({ token: "T0K", expiresAt: Date.now() + 3_600_000 });
      assert.equal((await request("..%2Fetc")).status, 400);
      assert.equal((await request("short")).status, 400);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

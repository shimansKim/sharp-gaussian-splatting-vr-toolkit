// 스토어판 대응 테스트: TWA 판별(core/store-gate.js), 터널 주소 제외(pc-connect allowTunnel), PC 미연결 안내, 라이선스 표시 도우미.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TWA_SESSION_KEY, detectStoreApp, isStandaloneDisplay, isTwaReferrer } from "../src/core/store-gate.js";
import { PC_OPTIONAL_HINT, createPcConnection, describeOffline, isTunnelBase } from "../src/sources/pc-connect.js";
import { createPcSource } from "../src/sources/pc-source.js";
import { cleanHomepage, licenseHeading } from "../src/ui/licenses-panel.js";

const memorySession = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = String(v)), data };
};
const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { get: (k) => data[k] ?? null, set: (k, v) => (v == null ? delete data[k] : (data[k] = v)), data };
};

describe("store-gate: TWA 판별", () => {
  test("두 TWA 패키지(2D·VR)의 referrer를 받는다", () => {
    assert.equal(isTwaReferrer("android-app://io.github.shimanskim.sharpquest/"), true);
    assert.equal(isTwaReferrer("android-app://io.github.shimanskim.sharpquest"), true);
    assert.equal(isTwaReferrer("android-app://io.github.shimanskim.sharpquest.vr/"), true);
    assert.equal(isTwaReferrer("ANDROID-APP://IO.GITHUB.SHIMANSKIM.SHARPQUEST/"), true);
  });

  test("다른 앱·일반 웹 referrer·빈 값은 받지 않는다", () => {
    assert.equal(isTwaReferrer(""), false);
    assert.equal(isTwaReferrer(undefined), false);
    assert.equal(isTwaReferrer("https://shimanskim.github.io/"), false);
    assert.equal(isTwaReferrer("android-app://com.android.chrome/"), false);
    assert.equal(isTwaReferrer("android-app://io.github.shimanskim.sharpquestfake/"), false);
    assert.equal(isTwaReferrer("https://evil.example/?android-app://io.github.shimanskim.sharpquest"), false);
  });

  test("referrer로 확인되면 sessionStorage에 기억해, 다시 불러와 referrer가 비어도 통과한다", () => {
    const session = memorySession();
    assert.deepEqual(detectStoreApp({ referrer: "android-app://io.github.shimanskim.sharpquest/", session }), { allowed: true, via: "referrer" });
    assert.equal(session.data[TWA_SESSION_KEY], "1");
    assert.deepEqual(detectStoreApp({ referrer: "", session }), { allowed: true, via: "session" });
  });

  test("설치된 앱 화면(standalone)이면 referrer가 없어도 통과한다(보수적)", () => {
    assert.deepEqual(detectStoreApp({ referrer: "", session: memorySession(), standalone: true }), { allowed: true, via: "standalone" });
  });

  test("일반 브라우저 탭으로 직접 열면 막는다", () => {
    assert.deepEqual(detectStoreApp({ referrer: "", session: memorySession(), standalone: false }), { allowed: false, via: null });
    assert.deepEqual(detectStoreApp({ referrer: "https://www.google.com/", session: null }), { allowed: false, via: null });
  });

  test("저장소가 오류를 내도 referrer·standalone 판별은 그대로 된다", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    assert.equal(detectStoreApp({ referrer: "android-app://io.github.shimanskim.sharpquest.vr/", session: broken }).allowed, true);
    assert.equal(detectStoreApp({ referrer: "", session: broken, standalone: true }).allowed, true);
    assert.equal(detectStoreApp({ referrer: "", session: broken }).allowed, false);
  });

  test("display-mode 판별: standalone·fullscreen이면 참, 일반 탭·matchMedia 없음이면 거짓", () => {
    const win = (modes) => ({ navigator: {}, matchMedia: (q) => ({ matches: modes.some((m) => q.includes(m)) }) });
    assert.equal(isStandaloneDisplay(win(["standalone"])), true);
    assert.equal(isStandaloneDisplay(win(["fullscreen"])), true);
    assert.equal(isStandaloneDisplay(win([])), false);
    assert.equal(isStandaloneDisplay({ navigator: {} }), false);
    assert.equal(isStandaloneDisplay({ navigator: { standalone: true } }), true);
  });
});

describe("터널 모드 제외(allowTunnel)", () => {
  test("isTunnelBase: https 공용 주소만 터널로 본다", () => {
    assert.equal(isTunnelBase("https://my-tunnel.trycloudflare.com"), true);
    assert.equal(isTunnelBase("http://192.168.0.2:8787"), false);
    assert.equal(isTunnelBase("https://localhost:8787"), false);
    assert.equal(isTunnelBase(null), false);
  });

  test("기본(플래그 꺼짐)은 지금처럼 터널 주소를 저장·시도한다", async () => {
    const storage = memoryStorage();
    const tried = [];
    const conn = createPcConnection({ storage, scan: false, permissionState: async () => "granted", mixedContentProbe: async () => false, fetch: async (url) => (tried.push(url), Promise.reject(new TypeError("fail"))) });
    assert.equal(conn.allowsTunnel, true);
    assert.equal(conn.setManualBase("https://my-tunnel.trycloudflare.com"), true);
    await conn.connect();
    assert.ok(tried.some((url) => url.startsWith("https://my-tunnel.trycloudflare.com")));
  });

  test("스토어판(allowTunnel:false)은 터널 주소를 저장하지 않고, 예전에 저장된 터널 주소도 시도하지 않는다", async () => {
    const storage = memoryStorage({ "sharp.pc.manualBase": "https://old.trycloudflare.com", "sharp.pc.lastBase": "https://old2.trycloudflare.com" });
    const tried = [];
    const conn = createPcConnection({ storage, allowTunnel: false, scan: false, permissionState: async () => "granted", mixedContentProbe: async () => false, fetch: async (url) => (tried.push(url), Promise.reject(new TypeError("fail"))) });
    assert.equal(conn.allowsTunnel, false);
    assert.equal(conn.hasLastBase(), false);
    assert.equal(conn.setManualBase("https://my-tunnel.trycloudflare.com"), false);
    assert.equal(conn.setManualBase("192.168.0.23"), true);
    await conn.connect();
    assert.ok(!tried.some((url) => url.startsWith("https://")), tried.join(", "));
    assert.ok(tried.some((url) => url.startsWith("http://192.168.0.23:8787")));
  });

  test("createPcSource는 connectionOptions를 연결에 넘긴다", () => {
    const source = createPcSource({ connectionOptions: { allowTunnel: false, storage: memoryStorage() } });
    assert.equal(source.connection.allowsTunnel, false);
  });
});

describe("PC 미연결 안내", () => {
  test("오류 대신 PC 없이도 기기 파일을 열 수 있다는 안내와 연결 방법 위치를 준다", () => {
    const text = describeOffline();
    assert.match(text, /PC 없이도/);
    assert.match(text, /기기에서 파일 열기/);
    assert.match(text, /PC 연결 방법/);
    assert.ok(text.includes(PC_OPTIONAL_HINT));
    assert.match(describeOffline({ vr: true }), /보관함/);
  });

  test("pc 소스: 연결 전에는 offlineHint를, 연결되면 빈 문자열을 준다", async () => {
    const info = { app: "sharp-quest-server", version: 3, roots: [] };
    let up = false;
    const fetchImpl = async () => (up ? new Response(JSON.stringify(info), { status: 200 }) : Promise.reject(new TypeError("fail")));
    const source = createPcSource({ fetch: fetchImpl, connectionOptions: { storage: memoryStorage({ "sharp.pc.lastBase": "http://192.168.0.5:8787" }), scan: false, permissionState: async () => "granted", mixedContentProbe: async () => false } });
    assert.match(source.offlineHint(), /PC 없이도/);
    up = true;
    await source.connection.connect();
    assert.equal(source.offlineHint(), "");
  });
});

describe("라이선스 표시 도우미", () => {
  test("머리글과 링크 정리", () => {
    assert.equal(licenseHeading({ name: "three", version: "0.180.0", license: "MIT" }), "three 0.180.0 · MIT");
    assert.equal(licenseHeading({ name: "fflate" }), "fflate");
    assert.equal(cleanHomepage("git+https://github.com/vitejs/vite.git"), "https://github.com/vitejs/vite");
    assert.equal(cleanHomepage("https://threejs.org/"), "https://threejs.org/");
  });
});

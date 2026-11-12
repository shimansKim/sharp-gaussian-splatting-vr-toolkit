import basicSsl from "@vitejs/plugin-basic-ssl";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

// GitHub Pages 프로젝트 사이트 경로. APP_BASE 환경 변수로 덮어쓸 수 있다.
const PAGES_BASE = "/sharp-gaussian-splatting-vr-toolkit/";

// 오프라인 캐시 목록(precache-manifest.js)을 빌드 결과에서 만든다. public/sw/shell-cache.js가 읽는다.
// 목록(또는 정적 파일 내용)이 바뀌면 version이 바뀌어 새 서비스 워커가 옛 캐시를 교체한다.
const STATIC_PRECACHE = ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];

function precacheManifest() {
  return {
    name: "sharp-precache-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const hash = createHash("sha1");
      for (const file of STATIC_PRECACHE) hash.update(readFileSync(new URL(`./public/${file}`, import.meta.url)));
      const built = Object.keys(bundle).filter((name) => !name.endsWith(".map")).sort();
      hash.update(built.join(","));
      const urls = ["./", ...STATIC_PRECACHE, ...built];
      const source = `self.__SHARP_PRECACHE=${JSON.stringify({ version: hash.digest("hex").slice(0, 10), urls })};`;
      this.emitFile({ type: "asset", fileName: "precache-manifest.js", source });
    },
  };
}

// ---- 오픈소스 라이선스 고지 ----
// 앱 번들에 들어가는 오픈소스의 이름·버전·라이선스 전문을 빌드할 때 모아 가상 모듈(virtual:third-party-licenses)로 낸다.
// 화면: src/ui/licenses-panel.js([설정] > 오픈소스 라이선스). 목록은 package.json dependencies + 아래 EXTRA_LICENSES.
const LICENSES_ID = "virtual:third-party-licenses";
const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
/** dependencies에 없지만 번들에 들어가는 것. file은 quest-app 기준 경로, pkg는 node_modules 안 패키지. */
const EXTRA_LICENSES = [
  { name: "fflate", version: "0.8.x", license: "MIT", homepage: "https://github.com/101arrowz/fflate", note: "@sparkjsdev/spark 안에 포함", file: "legal/fflate-LICENSE.txt" },
  { pkg: "vite", note: "빌드 도구가 앱에 넣는 작은 도움 코드(모듈 미리 불러오기)", cut: "# Licenses of bundled dependencies" },
];

function readPackageLicense(name) {
  const dir = `${APP_DIR}node_modules/${name}/`;
  const meta = JSON.parse(readFileSync(`${dir}package.json`, "utf8"));
  const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(entry));
  if (!file) throw new Error(`[licenses] ${name}의 라이선스 파일을 찾지 못했습니다`);
  const repo = typeof meta.repository === "string" ? meta.repository : meta.repository?.url;
  return { name: meta.name, version: meta.version, license: meta.license ?? "", homepage: meta.homepage ?? repo ?? "", text: readFileSync(`${dir}${file}`, "utf8") };
}

function collectLicenses() {
  const pkg = JSON.parse(readFileSync(`${APP_DIR}package.json`, "utf8"));
  const list = Object.keys(pkg.dependencies ?? {}).map((name) => readPackageLicense(name));
  for (const extra of EXTRA_LICENSES) {
    if (extra.pkg) {
      const entry = readPackageLicense(extra.pkg);
      const cutAt = extra.cut ? entry.text.indexOf(extra.cut) : -1;
      list.push({ ...entry, note: extra.note, text: cutAt > 0 ? entry.text.slice(0, cutAt) : entry.text });
    } else {
      list.push({ name: extra.name, version: extra.version, license: extra.license, homepage: extra.homepage, note: extra.note, text: readFileSync(`${APP_DIR}${extra.file}`, "utf8") });
    }
  }
  return list.map((entry) => ({ ...entry, text: entry.text.replace(/\r\n?/g, "\n").trim() }));
}

function thirdPartyLicenses() {
  const resolved = `\0${LICENSES_ID}`;
  return {
    name: "sharp-third-party-licenses",
    resolveId: (id) => (id === LICENSES_ID ? resolved : null),
    load: (id) => (id === resolved ? `export default ${JSON.stringify(collectLicenses())};` : null),
  };
}

// ---- 스토어판 빌드 플래그 ----
// VITE_STORE_BUILD=1 (환경 변수 또는 .env 파일)이면 index.html의 진입을 src/store-entry.js로 바꾼다.
// store-entry.js는 스토어 앱(TWA) 안인지 확인한 뒤 앱(main.js)을 불러오고, 아니면 설치 안내만 보인다. 기본(꺼짐)은 index.html 그대로다.
const isStoreFlag = (value) => ["1", "true"].includes(String(value ?? "").toLowerCase());

function storeEntry(enabled) {
  return {
    name: "sharp-store-entry",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!enabled) return html;
        if (!html.includes('src="/src/main.js"')) throw new Error("[store] index.html에서 /src/main.js 진입을 찾지 못했습니다");
        return html.replace('src="/src/main.js"', 'src="/src/store-entry.js"');
      },
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  base: process.env.APP_BASE ?? (command === "build" ? PAGES_BASE : "/"),
  plugins: [basicSsl(), thirdPartyLicenses(), storeEntry(isStoreFlag(loadEnv(mode, APP_DIR, "VITE_").VITE_STORE_BUILD)), precacheManifest()],
  build: {
    outDir: "dist",
    target: "es2022",
    chunkSizeWarningLimit: 6144,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
  },
}));

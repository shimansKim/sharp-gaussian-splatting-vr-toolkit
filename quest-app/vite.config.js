import basicSsl from "@vitejs/plugin-basic-ssl";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

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

export default defineConfig(({ command }) => ({
  base: process.env.APP_BASE ?? (command === "build" ? PAGES_BASE : "/"),
  plugins: [basicSsl(), precacheManifest()],
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

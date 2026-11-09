import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

// GitHub Pages 프로젝트 사이트 경로. APP_BASE 환경 변수로 덮어쓸 수 있다.
const PAGES_BASE = "/sharp-gaussian-splatting-vr-toolkit/";

export default defineConfig(({ command }) => ({
  base: process.env.APP_BASE ?? (command === "build" ? PAGES_BASE : "/"),
  plugins: [basicSsl()],
  build: {
    outDir: "dist",
    target: "es2022",
    chunkSizeWarningLimit: 4096,
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

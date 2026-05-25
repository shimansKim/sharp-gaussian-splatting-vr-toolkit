import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    https: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    https: true,
  },
});

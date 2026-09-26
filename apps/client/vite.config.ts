import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const port = Number(process.env.CLIENT_PORT ?? 5173);
const api = process.env.API_PROXY_TARGET ?? "http://localhost:2567";

export default defineConfig({
  plugins: [react()],
  envDir: "../..",
  server: {
    port,
    strictPort: true,
    proxy: { "/api": api },
  },
  preview: { port, strictPort: true, proxy: { "/api": api } },
  // Phaser alone is ~1.2 MB minified (~370 kB gzipped); it's split into the lazily loaded World chunk.
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 1700 },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});

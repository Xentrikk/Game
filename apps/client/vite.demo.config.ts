import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Builds the offline preview as ONE self-contained HTML file (dist-demo/demo.html): no server, no
 * sign-in. Everything, including Phaser, sprites, tiles and the font, is inlined.
 *   pnpm --filter @hearth/client build:demo
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // No .env needed: the demo never talks to Supabase or the API.
  envDir: false,
  publicDir: false,
  // The preview has no server or secrets, so its test hooks (window.__hearth) can stay on.
  define: { "import.meta.env.VITE_TEST_HOOKS": JSON.stringify("1") },
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
    rollupOptions: { input: "demo.html" },
  },
});

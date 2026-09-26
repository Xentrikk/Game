import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript source, so bundle it into the server build.
  noExternal: ["@hearth/shared"],
});

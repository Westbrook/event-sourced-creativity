import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import nativeFixtureConfig from "../../model3d-native/vite.config.mjs";

// Source-only local fixture; no application config, env files, API or provider.
// Reuse the existing reviewed Vite-client transport removal.
export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  envDir: false,
  cacheDir: "node_modules/.vite-experience-reader-fixture",
  optimizeDeps: { entries: ["tests/fixtures/experience-runtime/reader.html"] },
  plugins: nativeFixtureConfig.plugins,
  server: { host: "127.0.0.1", port: 4193, strictPort: true, hmr: false, ws: false, forwardConsole: false, cors: false },
});

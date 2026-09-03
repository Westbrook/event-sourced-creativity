import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import nativeFixtureConfig from "../../model3d-native/vite.config.mjs";

// Static fixture only. No Sites plugin, Worker, D1, R2, API, proxy or provider.
export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  cacheDir: "node_modules/.vite-experience-fixture",
  plugins: nativeFixtureConfig.plugins,
  server: { host: "127.0.0.1", port: 4192, strictPort: true, hmr: false, ws: false, cors: false },
  build: { outDir: fileURLToPath(new URL("../../../../forma-experience-runtime-build", import.meta.url)), emptyOutDir: true, rollupOptions: { input: fileURLToPath(new URL("./index.html", import.meta.url)) } },
});

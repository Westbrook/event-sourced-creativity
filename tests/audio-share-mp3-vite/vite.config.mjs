import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const fixtureRoot = fileURLToPath(new URL(".", import.meta.url));
// Exercise Cloudflare's unmodified static-WASM module rule. No custom WASM
// resolver, browser decoder, provider configuration or application binding.
export default defineConfig(async () => {
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_LOG_PATH = fileURLToPath(new URL("../../.wrangler/audio-share-mp3-vite/logs", import.meta.url));
  process.env.MINIFLARE_REGISTRY_PATH = fileURLToPath(new URL("../../.wrangler/audio-share-mp3-vite/registry", import.meta.url));
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    root: fixtureRoot,
    envDir: fileURLToPath(new URL("empty-env", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../../.wrangler/audio-share-mp3-vite/cache", import.meta.url)),
    publicDir: false,
    build: { outDir: fileURLToPath(new URL("../../dist/audio-share-mp3-vite", import.meta.url)), emptyOutDir: true, manifest: true },
    plugins: [cloudflare({
      configPath: fileURLToPath(new URL("wrangler.json", import.meta.url)),
      viteEnvironment: { name: "server" },
      persistState: false, remoteBindings: false, inspectorPort: false,
    })],
  };
});

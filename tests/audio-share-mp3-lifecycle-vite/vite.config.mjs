import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { join, isAbsolute } from "node:path";

const fixtureRoot = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig(async () => {
  const temporary = process.env.FORMA_MP3_LIFECYCLE_BUILD_ROOT;
  if (!temporary || !isAbsolute(temporary)) throw new Error("An explicit disposable build directory is required");
  process.env.WRANGLER_SEND_METRICS = "false";
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_LOG_PATH = join(temporary, "logs");
  process.env.MINIFLARE_REGISTRY_PATH = join(temporary, "registry");
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    root: fixtureRoot, envDir: join(temporary, "empty-env"), cacheDir: join(temporary, "cache"), publicDir: false,
    build: { outDir: join(temporary, "build"), emptyOutDir: true, manifest: true },
    plugins: [cloudflare({ configPath: fileURLToPath(new URL("wrangler.json", import.meta.url)),
      viteEnvironment: { name: "server" }, persistState: false, remoteBindings: false, inspectorPort: false })],
  };
});

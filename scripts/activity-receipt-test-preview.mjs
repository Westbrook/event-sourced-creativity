import { build, preview } from "vite";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";

// Isolated renderer only. Never load the Worker or the project's Vite config.
if (process.env.FORMA_ACTIVITY_RECEIPT_FOCUS !== "1" || process.argv.length !== 2) {
  throw new Error("Explicit isolated Activity focus preview required");
}
const url = new URL(process.env.FORMA_ACTIVITY_RECEIPT_FOCUS_ORIGIN ?? "");
if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.port === "4186"
  || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
  throw new Error("Use an owner-allocated non-4186 loopback preview");
}
const root = process.cwd();
const results = resolve(root, "test-results");
await mkdir(results, { recursive: true });
// Preserve every epoch; never empty the application build or earlier evidence.
const outDir = await mkdtemp(join(results, "activity-receipt-built-"));
await build({
  configFile: false, root, publicDir: false,
  build: { outDir, emptyOutDir: false, modulePreload: false,
    rolldownOptions: { input: resolve(root, "tests/activity-receipt-focus.fixture.html") } },
});
const server = await preview({
  configFile: false, root, publicDir: false, appType: "mpa",
  build: { outDir },
  preview: { host: "127.0.0.1", port: Number(url.port), strictPort: true },
});
server.printUrls();
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.httpServer.close(() => process.exit(0)));
}

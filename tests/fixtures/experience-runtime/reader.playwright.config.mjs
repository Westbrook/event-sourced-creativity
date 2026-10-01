import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const evidence = resolve(process.env.FORMA_READER_EVIDENCE_DIR ?? resolve(root, "outputs/experience-reader-browser"));
export default defineConfig({
  testDir: ".", testMatch: "reader.spec.mjs",
  workers: 1, fullyParallel: false, retries: 0, forbidOnly: true,
  timeout: 30_000, expect: { timeout: 5_000 }, maxFailures: 1,
  outputDir: resolve(evidence, "results"),
  reporter: [["list"], ["json", { outputFile: resolve(evidence, "report.json") }]],
  use: {
    baseURL: "http://127.0.0.1:4193", browserName: "chromium", headless: true,
    serviceWorkers: "block", acceptDownloads: false,
    trace: "on", screenshot: "only-on-failure", actionTimeout: 5_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "touch-320", use: { viewport: { width: 320, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --config tests/fixtures/experience-runtime/reader.vite.config.mjs`,
    cwd: root, url: "http://127.0.0.1:4193/tests/fixtures/experience-runtime/reader.html",
    reuseExistingServer: false, timeout: 30_000, gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});

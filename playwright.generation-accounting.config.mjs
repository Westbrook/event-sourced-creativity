import { defineConfig } from "@playwright/test";

// Finite synthetic renderer fixture only. Never inherits a live base URL,
// storageState, credential or Worker preview. A busy port fails closed.
export default defineConfig({
  testDir: "./tests/browser", testMatch: "forma-generation-accounting.spec.mjs",
  outputDir: "./test-results/generation-accounting-browser", fullyParallel: false,
  workers: 1, retries: 0, forbidOnly: true, timeout: 45000, expect: { timeout: 10000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:4186", browserName: "chromium", headless: true,
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce", timezoneId: "UTC",
    storageState: { cookies: [], origins: [] }, serviceWorkers: "block", acceptDownloads: false, trace: "retain-on-failure" },
  webServer: { command: "node scripts/content-first-test-preview.mjs", url: "http://127.0.0.1:4186/tests/generation-accounting.fixture.html",
    reuseExistingServer: false, timeout: 30000 },
});

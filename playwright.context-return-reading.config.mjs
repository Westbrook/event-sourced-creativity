import { defineConfig } from "@playwright/test";

// One French Controls-return/current Direction reading observation; no E9 census.
// The existing persistent fixture supplies actual Shell/Store, finite transport
// and chrome.tabs.setZoom. This server has no Worker or production credentials.
export default defineConfig({
  testDir: "./tests/browser", testMatch: "forma-context-return-reading.spec.mjs",
  outputDir: "./test-results/context-return-reading-fr200", workers: 1, fullyParallel: false,
  retries: 0, forbidOnly: true, timeout: 90000, expect: { timeout: 10000 },
  reporter: [["list"], ["json", { outputFile: process.env.FORMA_CONTEXT_RETURN_READING_REPORT || "test-results/context-return-reading-fr200-report.json" }]],
  use: { baseURL: "http://127.0.0.1:4186",
    geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } },
  webServer: { command: "node scripts/content-first-test-preview.mjs --built",
    url: "http://127.0.0.1:4186", reuseExistingServer: false, timeout: 30000 },
});

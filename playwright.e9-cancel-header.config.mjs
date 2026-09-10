import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "forma-e9-cancel-header-reading.spec.mjs",
  outputDir: "./test-results/e9-cancel-header-en320",
  workers: 1, fullyParallel: false, retries: 0, forbidOnly: true,
  timeout: 90000, expect: { timeout: 10000 },
  reporter: [["list"], ["json", {
    outputFile: process.env.FORMA_E9_CANCEL_HEADER_REPORT || "test-results/e9-cancel-header-en320-report.json",
  }]],
  use: { baseURL: "http://127.0.0.1:4186" },
  webServer: {
    command: "node scripts/content-first-test-preview.mjs --built",
    url: "http://127.0.0.1:4186", reuseExistingServer: false, timeout: 30000,
  },
});

import { defineConfig } from "@playwright/test";

// Source proposal only. Run only after owner integration/build/fixture admission.
// Personal finite transport OFF; explicit shared-reader overlay ON; generic read-only guard retained.
export default defineConfig({
  testDir: "./tests/browser", testMatch: "forma-deliver-reader-denial.spec.mjs",
  outputDir: "./test-results/deliver-reader-denial", workers: 1, fullyParallel: false,
  retries: 0, forbidOnly: true, timeout: 60000, expect: { timeout: 10000 },
  reporter: [["list"], ["json", { outputFile: process.env.FORMA_DELIVER_READER_REPORT || "test-results/deliver-reader-denial-report.json" }]],
  use: { baseURL: "http://127.0.0.1:4186",
    geometry: { viewport: { width: 1280, height: 900 }, zoom: 1, locale: "en-US" } },
  webServer: { command: "node scripts/content-first-test-preview.mjs --built",
    url: "http://127.0.0.1:4186", reuseExistingServer: false, timeout: 30000 },
});

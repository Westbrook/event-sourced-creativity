import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser", testMatch: "forma-deliver-containment.spec.mjs",
  outputDir: "./test-results/deliver-containment", workers: 1, retries: 0, timeout: 45000,
  reporter: [["list"], ["json", { outputFile: process.env.FORMA_DELIVER_REPORT || "test-results/deliver-containment-report.json" }]],
  use: { browserName: "chromium", headless: true, deviceScaleFactor: 2, trace: "retain-on-failure", serviceWorkers: "block" },
  webServer: { command: "node scripts/content-first-test-preview.mjs", url: "http://127.0.0.1:4186/tests/presentation-responsive.fixture.html",
    reuseExistingServer: false, timeout: 30000 },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "reported-width", use: { viewport: { width: 681, height: 991 } } },
  ],
});

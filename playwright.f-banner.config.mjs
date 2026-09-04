import { defineConfig } from "@playwright/test";
import { localTestOrigin } from "./tests/browser/helpers/read-only-network.mjs";

// Reuse the running static preview; callers can preserve each run separately.
const evidenceDirectory = process.env.FORMA_F_BANNER_EVIDENCE_DIR ?? "test-results/f-banner";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "forma-f-banner-rail.spec.mjs",
  fullyParallel: false, workers: 1, retries: 0, maxFailures: 1,
  forbidOnly: true, timeout: 90_000, expect: { timeout: 10_000 },
  outputDir: `${evidenceDirectory}/results`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${evidenceDirectory}/report.json` }],
  ],
  use: { baseURL: localTestOrigin("http://127.0.0.1:4186") },
  projects: [{ name: "f-banner-rail" }],
});

import { defineConfig } from "@playwright/test";
import { localTestOrigin } from "./tests/browser/helpers/read-only-network.mjs";

// Parent owns the exclusive source preview on 4186 and every invocation.
const evidence = process.env.FORMA_LIBRARY_CONTROLS_EVIDENCE_DIR ?? "test-results/library-controls-reach";
export default defineConfig({
  testDir: "./tests/browser", testMatch: "forma-library-controls-reach.spec.mjs",
  fullyParallel: false, workers: 1, retries: 0, maxFailures: 1, forbidOnly: true,
  timeout: 90_000, expect: { timeout: 10_000 }, outputDir: `${evidence}/results`,
  reporter: [["list"], ["json", { outputFile: `${evidence}/report.json` }]],
  use: { baseURL: localTestOrigin("http://127.0.0.1:4186") },
  projects: [{ name: "library-controls-reach" }],
});

import { defineConfig } from "@playwright/test";

// Source-only proposal: one Japanese case. The existing FR spec/config are unchanged.
// Expected CSS identity was read from the existing built output, not browser data.
// A later build changing these bytes requires explicit re-binding, never auto-accept.
export default defineConfig({
  testDir: "./tests/browser", testMatch: "forma-output-footer-ja768.spec.mjs",
  outputDir: "./test-results/output-footer-ja768", workers: 1, fullyParallel: false,
  retries: 0, forbidOnly: true, timeout: 90000, expect: { timeout: 10000 },
  reporter: [["list"], ["json", { outputFile: process.env.FORMA_OUTPUT_FOOTER_JA_REPORT || "test-results/output-footer-ja768-report.json" }]],
  metadata: { outputFooterJapaneseBuild: { href: "/assets/index-Dq84i0wH.css", bytes: 746298,
    sha256: "0b123da07d283aa97adb3ea6589d503a3e402ef98562676af9b4272ef86e2628" },
    // Explicit fixture-head policy; source and transformed bytes pinned offline.
    outputFooterJapaneseDocumentIcon: {"policy": "ja-footer-inert-icon-v1", "source": {"bytes": 1929, "sha256": "b8570523b6e64893d371365b7508ee13eed94b5a2f3626a2b08b15ca23a1c2f1"}, "response": {"bytes": 2200, "sha256": "b1cd101f795cb1629e03189f82493103fd3780b93a2db7bfe9198573e57c5f6a"}} },
  use: { baseURL: "http://127.0.0.1:4186",
    geometry: { viewport: { width: 768, height: 900 }, zoom: 1, locale: "ja", hasTouch: false } },
  webServer: { command: "node scripts/content-first-test-preview.mjs --built",
    url: "http://127.0.0.1:4186", reuseExistingServer: false, timeout: 30000 },
});

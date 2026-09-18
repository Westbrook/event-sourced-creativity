import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";
import { localTestOrigin } from "./tests/browser/helpers/read-only-network.mjs";
import { syntheticNetworkEnabled } from "./tests/browser/helpers/synthetic-network.mjs";
const baseURL = localTestOrigin("http://127.0.0.1:4186");
if (!syntheticNetworkEnabled(baseURL)) throw new Error("Story download requires the existing synthetic fixture");
const output = process.env.FORMA_STORY_DOWNLOAD_OUTPUT_DIR
  ?? fileURLToPath(new URL("./test-results/story-revision-download/", import.meta.url));
if (!isAbsolute(output)) throw new Error("Story download output directory must be absolute");
export default defineConfig({
  testDir: fileURLToPath(new URL("./tests/browser/", import.meta.url)), testMatch: "forma-story-revision-download.spec.mjs",
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true, timeout: 90000, expect: { timeout: 10000 },
  outputDir: join(output, "results"), reporter: [["list"], ["json", { outputFile: join(output, "report.json") }]],
  use: { baseURL, acceptDownloads: true }, projects: [{ name: "story-revision-download" }],
});

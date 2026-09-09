import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";
import { localTestOrigin } from "./tests/browser/helpers/read-only-network.mjs";
import { syntheticNetworkEnabled } from "./tests/browser/helpers/synthetic-network.mjs";
const baseURL = localTestOrigin("http://127.0.0.1:4186");
if (!syntheticNetworkEnabled(baseURL)) throw new Error("The guest regression requires the retained finite synthetic transport");
const output = process.env.FORMA_GUEST_NARROW_READING_OUTPUT_DIR
  ?? fileURLToPath(new URL("./test-results/guest-narrow-reading-return/", import.meta.url));
if (!isAbsolute(output)) throw new Error("Guest narrow reading output directory must be absolute");
export default defineConfig({
  testDir: fileURLToPath(new URL("./tests/browser/", import.meta.url)), testMatch: "forma-guest-narrow-reading-return.spec.mjs",
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true, timeout: 60000, expect: { timeout: 10000 },
  outputDir: join(output, "results"), reporter: [["list"], ["json", { outputFile: join(output, "report.json") }]],
  use: { baseURL, acceptDownloads: false }, projects: [{ name: "guest-narrow-reading-return" }],
});

import { defineConfig } from "@playwright/test";
import retained from "./playwright.a11y.config.mjs";

// Separate prospective binding: do not edit or run the sealed F44 config here.
// The one case reuses E11's actual persistent-context, trace, native keyboard,
// zoom/typeface and viewport-capture mechanisms through unchanged fixtures.mjs.
if (process.env.FORMA_LIBRARY_PERSISTENCE !== "1"
  || process.env.FORMA_A11Y_SYNTHETIC_NETWORK !== "1"
  || process.env.FORMA_A11Y_E11_COPY !== "1"
  || process.env.FORMA_A11Y_BASE_URL !== "http://127.0.0.1:4186")
  throw new Error("Require explicit separate Library persistence opt-ins on the coordinated loopback source target");
const e11 = retained.projects.filter(project => project.name === "e11-copy-locales");
if (e11.length !== 1 || e11[0].testMatch !== "**/forma-e11-copy-locales.spec.mjs"
  || e11[0].use?.baseURL !== "http://127.0.0.1:4186"
  || retained.fullyParallel !== false || retained.workers !== 1 || retained.retries !== 0)
  throw new Error("Retained E11 runner policy changed; review the source binding again");

export default defineConfig({
  ...retained,
  outputDir: "outputs/library-persistence/results",
  reporter: [
    ["list"],
    ["json", { outputFile: "outputs/library-persistence/report.json" }],
    ["html", { outputFolder: "outputs/library-persistence/report", open: "never" }],
  ],
  projects: [{
    ...e11[0],
    name: "f-library-persistence",
    testMatch: "**/forma-library-persistence.spec.mjs",
  }],
});

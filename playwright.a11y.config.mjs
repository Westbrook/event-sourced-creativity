import { defineConfig } from "@playwright/test";
import { localTestOrigin } from "./tests/browser/helpers/read-only-network.mjs";

const baseURL = localTestOrigin(process.env.FORMA_A11Y_BASE_URL ?? "http://127.0.0.1:4178");

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: "outputs/a11y/results",
  reporter: [
    ["list"],
    ["json", { outputFile: "outputs/a11y/report.json" }],
    ["html", { outputFolder: "outputs/a11y/report", open: "never" }],
  ],
  use: { baseURL },
  projects: [
    { name: "calibration", testMatch: "**/harness-calibration.spec.mjs" },
    { name: "wide", testMatch: ["**/forma-keyboard.spec.mjs", "**/forma-project-contents.spec.mjs", "**/forma-library-import.spec.mjs", "**/forma-workspace-settings.spec.mjs", "**/forma-view-menu.spec.mjs", "**/forma-ordinary-copy.spec.mjs"], use: { geometry: { viewport: { width: 1280, height: 900 }, zoom: 1 } } },
    { name: "narrow-320", testMatch: ["**/forma-keyboard.spec.mjs", "**/forma-project-contents.spec.mjs", "**/forma-library-import.spec.mjs", "**/forma-workspace-settings.spec.mjs", "**/forma-view-menu.spec.mjs", "**/forma-ordinary-copy.spec.mjs"], use: { geometry: { viewport: { width: 320, height: 800 }, zoom: 1 } } },
    { name: "shallow", testMatch: ["**/forma-keyboard.spec.mjs", "**/forma-project-contents.spec.mjs", "**/forma-library-import.spec.mjs", "**/forma-workspace-settings.spec.mjs", "**/forma-view-menu.spec.mjs", "**/forma-ordinary-copy.spec.mjs"], use: { geometry: { viewport: { width: 844, height: 390 }, zoom: 1 } } },
    { name: "browser-zoom-200", testMatch: ["**/forma-keyboard.spec.mjs", "**/forma-project-contents.spec.mjs", "**/forma-library-import.spec.mjs", "**/forma-workspace-settings.spec.mjs", "**/forma-view-menu.spec.mjs", "**/forma-ordinary-copy.spec.mjs"], use: { geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2 } } },
    { name: "narrow-navigation-320", testMatch: "**/forma-narrow-navigation.spec.mjs", use: { geometry: { viewport: { width: 320, height: 800 }, zoom: 1 } } },
    { name: "shallow-navigation", testMatch: "**/forma-shallow-navigation.spec.mjs", use: { geometry: { viewport: { width: 844, height: 390 }, zoom: 1 } } },
    { name: "recovery-ar-320", testMatch: ["**/forma-project-contents.spec.mjs", "**/forma-library-import.spec.mjs", "**/forma-workspace-settings.spec.mjs", "**/forma-view-menu.spec.mjs", "**/forma-ordinary-copy.spec.mjs"], use: { geometry: { viewport: { width: 320, height: 800 }, zoom: 1, locale: "ar" } } },
    { name: "recovery-fr-200", testMatch: ["**/forma-project-contents.spec.mjs", "**/forma-library-import.spec.mjs", "**/forma-workspace-settings.spec.mjs", "**/forma-view-menu.spec.mjs", "**/forma-ordinary-copy.spec.mjs"], use: { geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } } },
    { name: "assistant-coarse-320", testMatch: "**/forma-assistant-studio-slot.spec.mjs", use: { geometry: { viewport: { width: 320, height: 800 }, zoom: 1, hasTouch: true } } },
    { name: "assistant-coarse-ar-320", testMatch: "**/forma-assistant-studio-slot.spec.mjs", use: { geometry: { viewport: { width: 320, height: 800 }, zoom: 1, hasTouch: true, locale: "ar" } } },
    ...(process.env.FORMA_A11Y_E7_CONTROLS === "1" ? [
      { name: "e7-rename-filter-locales", testMatch: "**/forma-e7-rename-filter.spec.mjs" },
    ] : []),
    ...(process.env.FORMA_A11Y_E8_PUBLIC === "1" ? [
      { name: "e8-public-marketing", testMatch: "**/forma-public-marketing.spec.mjs",
        use: { baseURL: localTestOrigin("http://127.0.0.1:4186"), publicMarketing: true } },
    ] : []),
    ...(process.env.FORMA_A11Y_E9_PEERS === "1" ? [
      { name: "e9-source-peers", testMatch: "**/forma-e9-peer-rows.spec.mjs",
        use: { baseURL: localTestOrigin("http://127.0.0.1:4186") } },
      { name: "e9-outputcard-peers", testMatch: "**/forma-e9-outputcard-peers.spec.mjs",
        use: { baseURL: localTestOrigin("http://127.0.0.1:4186") } },
    ] : []),
    ...(process.env.FORMA_A11Y_ISOLATED_E5 === "1" ? [
      { name: "isolated-e5-presentation", testMatch: "**/isolated-presentation-owners.spec.mjs",
        use: { baseURL: localTestOrigin(process.env.FORMA_E5_SOURCE_BASE_URL ?? "http://127.0.0.1:4180") } },
    ] : []),
    ...(process.env.FORMA_A11Y_ISOLATED_E6 === "1" ? [
      { name: "isolated-e6-noncanvas", testMatch: "**/isolated-e6-noncanvas.spec.mjs",
        use: { baseURL: localTestOrigin("http://127.0.0.1:4186") } },
    ] : []),
  ],
});

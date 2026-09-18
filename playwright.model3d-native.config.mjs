import { defineConfig } from "@playwright/test";

// Deliberately separate membership from the account/archive-based native suite.
export default defineConfig({
  testDir: "./tests/model3d-native",
  testMatch: "interaction.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: "outputs/model3d-native/results",
  reporter: [["list"], ["json", { outputFile: "outputs/model3d-native/report.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4181",
    browserName: "chromium",
    headless: true,
    colorScheme: "light",
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
    permissions: [],
    acceptDownloads: false,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Explicit software WebGL fixture, not certification of a user's GPU.
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: "pnpm exec vite --config tests/model3d-native/vite.config.mjs",
    url: "http://127.0.0.1:4181/tests/model3d-native/index.html",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "native3d-en-wide", use: { viewport: { width: 1280, height: 900 }, locale: "en-US" } },
    { name: "native3d-ar-320", use: { viewport: { width: 320, height: 800 }, locale: "ar" } },
  ],
});

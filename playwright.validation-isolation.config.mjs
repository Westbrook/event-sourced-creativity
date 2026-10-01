import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/browser', testMatch: 'validation-isolation.spec.mjs',
  workers: 1, retries: 0, forbidOnly: true, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4178' }, outputDir: 'outputs/validation/browser-isolation', reporter: 'list' });

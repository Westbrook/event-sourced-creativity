import { defineConfig } from '@playwright/test';
import { syntheticPreviewAddress } from './scripts/lib/synthetic-preview.mjs';
const {origin} = syntheticPreviewAddress();
export default defineConfig({
  testDir: './tests/browser', testMatch: ['forma-creator-gutters.spec.mjs', 'forma-library-scroll-stability.spec.mjs'],
  outputDir: './test-results/creator-gutters', workers: 1, retries: 0, timeout: 60000,
  use: { browserName: 'chromium', headless: true, baseURL: origin,
    colorScheme: 'dark', serviceWorkers: 'block', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/content-first-test-preview.mjs --built',
    url: origin + '/tests/presentation-responsive.fixture.html', reuseExistingServer: false, timeout: 30000 },
  projects: ['en-US', 'ar'].map(locale => ({ name: 'creator-gutters-' + locale, use: {locale} })),
});

import { defineConfig } from '@playwright/test';
import { syntheticNetworkEnabled, SYNTHETIC_NETWORK_ORIGIN } from './tests/browser/helpers/synthetic-network.mjs';
if (!syntheticNetworkEnabled(SYNTHETIC_NETWORK_ORIGIN)) throw Error('Set FORMA_A11Y_SYNTHETIC_NETWORK=1 for finite, provider-free Memory and containment browser cases.');
export default defineConfig({
  testDir: './tests/browser',
  testMatch: ['forma-memory-assistant-context.spec.mjs', 'forma-memory-resource.spec.mjs', 'forma-memory-scope-recall.spec.mjs', 'forma-project-containment.spec.mjs'],
  workers: 1, fullyParallel: false, retries: 0, forbidOnly: true, timeout: 90000,
  expect: { timeout: 10000 }, use: { baseURL: SYNTHETIC_NETWORK_ORIGIN, pinnedFonts: true },
  webServer: { command: 'node scripts/content-first-test-preview.mjs --built', url: SYNTHETIC_NETWORK_ORIGIN, reuseExistingServer: false, timeout: 30000 },
});

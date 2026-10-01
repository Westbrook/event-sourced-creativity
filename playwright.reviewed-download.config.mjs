import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
const selected = process.env.FORMA_REVIEWED_DOWNLOAD_KIND;
if (!['audio', 'slides'].includes(selected)) throw Error('Select FORMA_REVIEWED_DOWNLOAD_KIND=audio or slides and supply its authorized detached fixture root.');
const root = process.env.FORMA_REVIEWED_DOWNLOAD_FIXTURE_ROOT;
if (!root || !isAbsolute(root) || !existsSync(join(root, 'story-backend.mjs'))) throw Error('Missing exact detached reviewed-download fixture. Supply FORMA_REVIEWED_DOWNLOAD_FIXTURE_ROOT; do not create or export private fixtures to satisfy this check.');
export default defineConfig({
  testDir: './tests/browser', testMatch: `forma-${selected}-reviewed-download.spec.mjs`,
  workers: 1, fullyParallel: false, retries: 0, forbidOnly: true, timeout: 90000,
  expect: { timeout: 10000 }, use: { acceptDownloads: true, [`${selected}DownloadFixtureRoot`]: root },
});

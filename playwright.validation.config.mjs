import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Explicit selection preserves each lane's existing opt-ins and data boundaries.
// Example: FORMA_BROWSER_CONFIGS=output-footer,context-return-reading pnpm test:browser
const selected = (process.env.FORMA_BROWSER_CONFIGS ?? '').split(',').filter(Boolean);
if (!selected.length) throw Error('Set FORMA_BROWSER_CONFIGS to registered config suffixes; no implicit account or acceptance run.');
const registry = JSON.parse(readFileSync(new URL('./tests/validation-registry.json', import.meta.url), 'utf8'));
const projects = [], projectNames = new Set(), servers = new Map(), failureLimits = [];
const output = process.env.FORMA_VALIDATION_BROWSER_OUTPUT ?? `outputs/validation/browser-${randomUUID()}`;
for (const name of [...new Set(selected)]) {
  const file = `playwright.${name}.config.mjs`;
  if (name === 'validation' || !registry.browserConfigs.includes(file)) throw Error(`Unknown browser lane: ${name}`);
  const { default: config } = await import(new URL(file, import.meta.url));
  const { testDir, testMatch, testIgnore, timeout, expect, use, fullyParallel } = config;
  if (config.maxFailures) failureLimits.push(config.maxFailures);
  for (const project of config.projects ?? [{ name }]) {
    // Project names are fixture contracts (including exact download admission).
    // Namespace artifact paths, not the identity observed by a test.
    if (projectNames.has(project.name)) throw Error(`Conflicting browser project identity: ${project.name}; select separate batches.`);
    projectNames.add(project.name);
    projects.push({ testDir, testMatch, testIgnore, timeout, expect, fullyParallel,
      ...project, use: { ...use, ...project.use },
      outputDir: `${output}/${name}/${project.name}` });
  }
  for (const server of config.webServer ? [config.webServer].flat() : []) {
    const origin = new URL(server.url).origin, previous = servers.get(origin);
    const identity = value => JSON.stringify([value.command, value.cwd ?? null, Object.entries(value.env ?? {}).sort()]);
    if (previous && identity(previous) !== identity(server)) throw Error(`Incompatible source/built servers at ${origin}; select separate batches.`);
    // One owned server for the entire compatible batch. Never adopt a process
    // solely because a port is listening. Account lanes remain external/read-only.
    if (!previous) servers.set(origin, { ...server, reuseExistingServer: false });
  }
}
export default defineConfig({ projects, workers: 1, retries: 0, forbidOnly: true,
  maxFailures: failureLimits.length ? Math.min(...failureLimits) : 0,
  webServer: [...servers.values()],
  reporter: [['list'], ['json', { outputFile: `${output}/report.json` }]],
});

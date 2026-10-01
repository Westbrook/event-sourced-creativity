import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { census, classify, verifyInventory, classificationFingerprint } from './lib/validation-inventory.mjs';
import { atomicJSON, fingerprint, withLock, runProcess } from './lib/validation-process.mjs';
import { planValidation, runStages } from './lib/validation-plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = resolve(root, 'tests/validation-registry.json');
const argv = process.argv.slice(2), mode = argv.shift() ?? 'check';
const workersArgument = argv.find(a => a.startsWith('--workers='));
const workers = Number(workersArgument?.split('=')[1] ?? Math.min(2, availableParallelism()));
if (!Number.isInteger(workers) || workers < 1 || workers > 32) throw Error('Use --workers=1..32; budget all simultaneous runners together.');
const dryRun = argv.includes('--dry-run'), force = argv.includes('--force');
const files = argv.filter(a => !['--dry-run', '--force', workersArgument].includes(a));
if (files.some(f => f.startsWith('-'))) throw Error('Unknown validation option');
const current = census(root);
if (mode === 'inventory:update') {
  const previous = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : {};
  const tests = Object.fromEntries(current.files.map(file => [file, previous.overrides?.[file]?.lane ?? classify(root, file)]));
  atomicJSON(registryPath, { schemaVersion: 1, owner: 'Repository validation maintainer; domain contracts stay with their code owners',
    tests, overrides: previous.overrides ?? {}, classificationInput: classificationFingerprint(root), browserConfigs: current.configs, commands: current.commands, entrypoints: current.entrypoints,
    testImportExceptions: previous.testImportExceptions ?? {}, historicalHolds: previous.historicalHolds ?? [],
    conditionalModes: previous.conditionalModes ?? [], manualGates: previous.manualGates ?? ['docs/3d-production-readiness.md', 'docs/local-migrations.md', 'docs/still-toolbar-release-checks.md', 'tests/browser/README.md'],
    exclusions: previous.exclusions ?? {} });
  console.log(`Registered ${current.files.length} tests. Review lane assignments and the registry diff before using them.`);
  process.exit(0);
}
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
const errors = verifyInventory(root, registry);
if (errors.length) throw Error(errors.join('\n') + '\nRun pnpm validate:inventory:update, review the diff, then retry.');
if (mode === 'inventory') {
  console.log(JSON.stringify({ tests: current.files.length, lanes: Object.fromEntries(['source', 'runtime', 'artifact', 'browser'].map(lane => [lane, Object.values(registry.tests).filter(v => v === lane).length])), configs: current.configs.length, conditionalModes: registry.conditionalModes, exclusions: registry.exclusions }, null, 2));
  process.exit(0);
}
if (!['check', 'test', 'node', 'source', 'runtime', 'artifact', 'build', 'fast'].includes(mode)) throw Error(`Unknown mode: ${mode}`);
for (const file of files) if (!registry.tests[file] || registry.tests[file] === 'browser') throw Error(`Select registered Node tests only: ${file}. Browser lanes have separate fixture prerequisites.`);
const selected = [...new Set(files.length ? files : Object.keys(registry.tests).filter(file => registry.tests[file] !== 'browser' && (!['source', 'runtime', 'artifact'].includes(mode) || registry.tests[file] === mode)))];
const excluded = selected.filter(f => registry.exclusions[f]);
if (excluded.length) throw Error(excluded.map(f => `${f}: ${registry.exclusions[f]}`).join('\n') + '\nSelect explicit unaffected files; exclusions are not passes.');
const groups = ['source', 'runtime', 'artifact'].map(lane => ({ lane, files: selected.filter(f => registry.tests[f] === lane) })).filter(g => g.files.length);
const steps = planValidation(mode, groups, workers);
if (dryRun) { console.log(JSON.stringify({ mode, workers, steps }, null, 2)); process.exit(0); }
const runId = new Date().toISOString().replaceAll(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8);
const directory = resolve(root, 'outputs/validation', runId); mkdirSync(directory, { recursive: true });
const input = fingerprint(root, { tests: true });
const receipt = { version: 1, runId, mode, input, node: process.version, workers, selected: mode === 'build' || mode === 'fast' ? [] : selected, steps: [], status: 'running' };
const save = () => atomicJSON(resolve(directory, 'receipt.json'), receipt);
save();
async function execute(step) {
  const before = fingerprint(root, { tests: true });
  const reusable = ['types', 'lint'].includes(step.id);
  const priorPath = resolve(root, 'outputs/validation', step.id + '-receipt.json');
  if (reusable && !force && existsSync(priorPath)) {
    let prior;
    try { prior = JSON.parse(readFileSync(priorPath, 'utf8')); } catch { /* An incomplete receipt is a cache miss. */ }
    if (prior?.input === before && prior.status === 'passed') {
      receipt.steps.push({ id: step.id, status: 'reused', fromRun: prior.runId, input: before }); save(); return;
    }
  }
  console.log(`[validation] ${step.id} → ${resolve(directory, step.id + '.log')}`);
  const result = await runProcess(step.command, step.args, { cwd: root, log: resolve(directory, step.id + '.log'),
    env: ['source', 'runtime', 'artifact'].includes(step.id) ? { FORMA_SQLITE_CACHE_DIR: resolve(directory, 'sqlite-compiles') } : {},
    onFailure: log => console.error(`[validation] Negative result available now: ${log}`) });
  if (['source', 'runtime', 'artifact'].includes(step.id)) {
    const log = readFileSync(resolve(directory, step.id + '.log'), 'utf8');
    result.nodeSummary = Object.fromEntries([...log.matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(m => [m[1], Number(m[2])]));
  }
  receipt.steps.push({ id: step.id, ...result }); save();
  if (result.code) throw Error(`${step.id} failed (${result.code}); dependent work was not started.`);
  if (!['cem', 'clean', 'vite'].includes(step.id) && fingerprint(root, { tests: true }) !== before) throw Error(`Inputs changed during ${step.id}; rerun that check on a stable candidate.`);
  if (reusable) atomicJSON(priorPath, { status: 'passed', input: before, runId });
}
async function build(requireExisting = false) {
  await withLock(resolve(root, 'outputs/validation/build.lock'), async () => {
    const key = fingerprint(root), path = resolve(root, 'outputs/validation/build-receipt.json');
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    if (!force && previous?.input === key && existsSync(resolve(root, 'dist')) && previous.output === fingerprint(root, { output: true })) {
      receipt.steps.push({ id: 'build', status: 'reused', input: key, output: previous.output }); save(); return;
    }
    if (requireExisting) throw Error('No matching build receipt. Run pnpm build; stale output cannot qualify artifact tests.');
    for (const step of [
      ['cem', ['scripts/generate-custom-elements-manifest.mjs']],
      ['i18n', ['--experimental-strip-types', 'scripts/check-system-localization.mjs']],
      ['schema', ['scripts/generate-memory-schema-repair.mjs', '--check']],
      ['clean', ['build/clean-dist.mjs']],
    ]) await execute({ id: step[0], command: process.execPath, args: step[1] });
    const prepared = fingerprint(root);
    await execute({ id: 'vite', command: 'pnpm', args: ['exec', 'vite', 'build'] });
    if (prepared !== fingerprint(root)) throw Error('Build inputs changed while building; output was not qualified.');
    // Generation changes the tracked CEM; fingerprint its completed inputs.
    atomicJSON(path, { input: fingerprint(root), output: fingerprint(root, { output: true }), node: process.version, runId });
  });
}
try {
  await runStages(steps, async step => {
    if (step.id === 'build' || step.id === 'require-build') await build(step.id === 'require-build');
    else if (step.id === 'artifact') await withLock(resolve(root, 'outputs/validation/build.lock'), async () => {
      const qualified = JSON.parse(readFileSync(resolve(root, 'outputs/validation/build-receipt.json'), 'utf8'));
      if (qualified.input !== fingerprint(root) || qualified.output !== fingerprint(root, { output: true })) throw Error('Build changed before artifact tests; refusing stale output.');
      await execute(step);
      if (qualified.output !== fingerprint(root, { output: true })) throw Error('Artifact tests changed the shared production output.');
    });
    else await execute(step);
  });
  receipt.status = receipt.steps.some(s => s.nodeSummary?.skipped || s.nodeSummary?.todo) ? 'passed-with-skips' : 'passed';
} catch (error) { receipt.status = 'failed'; receipt.error = error.message; console.error(error.message); process.exitCode = 1; }
finally { receipt.completedAt = new Date().toISOString(); receipt.finalInput = fingerprint(root, { tests: true }); save(); console.log(`[validation] ${receipt.status}: ${resolve(directory, 'receipt.json')}`); }

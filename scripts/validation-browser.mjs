import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { atomicJSON, fingerprint, runProcess, withLock } from './lib/validation-process.mjs';
import { verifyInventory } from './lib/validation-inventory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = verifyInventory(root, JSON.parse(readFileSync(resolve(root, 'tests/validation-registry.json'), 'utf8')));
if (errors.length) throw Error(errors.join('\n'));
const args = process.argv.slice(2), listing = args.includes('--list');
const { default: config } = await import('../playwright.validation.config.mjs');
const directory = resolve(root, 'outputs/validation/browser-run-' + randomUUID());
const input = fingerprint(root, { tests: true });
const built = config.webServer.some(server => /(?:^|\s)--built(?:\s|$)/u.test(server.command));
const receipt = { input, selected: process.env.FORMA_BROWSER_CONFIGS, args, built, servers: config.webServer.map(({command, url}) => ({command, url})), status: 'running' };
async function run() {
  let qualified;
  if (built && !listing) {
    qualified = JSON.parse(readFileSync(resolve(root, 'outputs/validation/build-receipt.json'), 'utf8'));
    if (qualified.input !== fingerprint(root) || qualified.output !== fingerprint(root, { output: true })) throw Error('Run pnpm build before built browser checks; no matching artifact receipt.');
    receipt.build = qualified;
  }
  const result = await runProcess('pnpm', ['exec', 'playwright', 'test', '--config=playwright.validation.config.mjs', ...args], { cwd: root, log: resolve(directory, 'browser.log'), env: { FORMA_VALIDATION_BROWSER_OUTPUT: directory } });
  receipt.result = result;
  if (result.code) throw Error('Browser batch failed; see ' + directory);
  if (input !== fingerprint(root, { tests: true })) throw Error('Inputs changed during browser verification.');
  if (qualified && qualified.output !== fingerprint(root, { output: true })) throw Error('Build output changed during browser verification.');
  receipt.status = listing ? 'listed' : 'passed';
}
try { if (built && !listing) await withLock(resolve(root, 'outputs/validation/build.lock'), run); else await run(); }
catch (error) { receipt.status = 'failed'; receipt.error = error.message; console.error(error.message); process.exitCode = 1; }
finally { atomicJSON(resolve(directory, 'receipt.json'), receipt); console.log(directory); }

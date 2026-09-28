/** Offline-only C2 successor. Historical C/F2/H artifacts are immutable. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { newCurrentE2aFixture } from '../evals/generation-reliability/e2a/fixture.mjs';
import { captureE2aFixture } from '../evals/generation-reliability/e2a/capture.mjs';
import { qualifySunburstFinancialCell, F2_STAGE_INVENTORY } from '../evals/generation-reliability/sunburst-financial.mjs';
import { firstCompilerStudy } from '../evals/generation-reliability/first-compiler-study.mjs';
const mode = process.argv.slice(2);
assert(mode.length === 1 && ['--check', '--write'].includes(mode[0]), 'offline_only_use_check_or_write');
async function artifact(path, value, raw = false) {
  const url = new URL(`../${path}`, import.meta.url), bytes = raw ? value : JSON.stringify(value, null, 2) + '\n';
  if (mode[0] === '--write') {
    await mkdir(new URL('.', url), { recursive: true });
    try { await writeFile(url, bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  assert.equal(await readFile(url, 'utf8'), bytes, `immutable_artifact_changed:${path}`);
}
const capture = captureE2aFixture(newCurrentE2aFixture());
const base = 'evals/generation-reliability/e2a/artifacts/v2/';
for (const arm of ['before', 'after']) await artifact(`${base}${arm}.txt`, capture[arm].prompt, true);
await artifact(`${base}capture.json`, capture);
await artifact(`${base}exact-diff.json`, capture.exactDiff);
await artifact(`${base}semantic-ledger.json`, capture.privateEvidence);
// Recalculate changed prompt-byte inputs only. No new price lookup or expiry renewal.
const financial = qualifySunburstFinancialCell({ captureEvidence: capture,
  prompts: ['before', 'after'].map((arm, i) => ({ id: i ? 'candidate' : 'baseline', captureId: capture.id, prompt: capture[arm].prompt })),
  stageInventory: F2_STAGE_INVENTORY, now: '2026-09-25T00:00:00Z' });
assert.equal(financial.available, false);
assert(financial.gaps.includes('pricing_review_expired_or_invalid'));
await artifact('docs/evidence/f2-sunburst/c2-v2/financial-gate.json', financial);
const plan = await firstCompilerStudy();
await artifact('evals/generation-reliability/bridge-artifacts/v6-c2/first-study.json', plan);
console.log(JSON.stringify({ capture: capture.id, financial: financial.id, plan: plan.id, coverage: capture.privateEvidence.requirementCoverage.length,
  available: false, renewed: false, liveAuthorized: false, providerCalls: 0 }, null, 2));

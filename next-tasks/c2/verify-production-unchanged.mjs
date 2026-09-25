import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { hash } from '../../evals/generation-reliability/core.mjs';
import * as current from '../../worker/openai-adapter.ts';
import { PROMPT_TECHNIQUES } from '../../src/model/prompt-structures.ts';
const base = resolve(process.argv[2] ?? '/Users/westbrook/Documents/repos/codex');
const expected = 'c28af5fea0fc3ec2b37b878a544ec59c52a64daf';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['-C', base, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), expected, 'base_checkout_changed_use_an_isolated_exact_base');
assert.equal(git('diff', expected, '--', 'src', 'worker'), '', 'production_source_changed');
const original = await import(pathToFileURL(resolve(base, 'worker/openai-adapter.ts')));
const { newCurrentE2aFixture: oldFixture } = await import(pathToFileURL(resolve(base, 'evals/generation-reliability/e2a/fixture.mjs')));
const f = oldFixture(), results = [];
for (const quality of ['high', 'low']) for (const technique of PROMPT_TECHNIQUES) {
  const options = { quality, size: '1536x1024' };
  const before = original.buildCreativeImagePrompt(f.source, f.direction, [], technique, options);
  const after = current.buildCreativeImagePrompt(f.source, f.direction, [], technique, options);
  assert.equal(before, after);
  results.push({ quality, technique, sha256: hash(after), bytes: Buffer.byteLength(after), identical: true });
}
async function requests(adapter) {
  const calls = [], saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init.body });
    return String(url).endsWith('/moderations') ? Response.json({ results: [{ flagged: false, categories: {} }] })
      : Response.json({ data: [{ b64_json: btoa('synthetic-not-pixels') }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
  };
  try { await adapter.generateCreativeImage({ OPENAI_API_KEY: 'mock-only' }, 'synthetic-c2', f.source, f.direction, { quality: 'high', size: '1536x1024', outputFormat: 'png', partialImages: 0 }); }
  finally { globalThis.fetch = saved; }
  return calls;
}
const before = await requests(original), after = await requests(current);
assert.deepEqual(after, before); assert.equal(after.length, 2);
const productionFiles = ['src/model/context-intelligence.ts', 'src/model/context-proposal-application.ts', 'src/model/prompt-policy.ts', 'src/model/prompt-structures.ts', 'src/model/prompt-provenance-e2a.ts', 'worker/openai-adapter.ts', 'worker/openai-moderation.ts'];
console.log(JSON.stringify({ base: expected, productionDiff: false, fixtureInputs: 'unchanged original synthetic v1; no private input', promptComparisons: results,
  exactWire: after.map(call => ({ url: call.url, bodySha256: hash(call.body), bytes: Buffer.byteLength(call.body), identical: true })),
  sourceHashes: Object.fromEntries(productionFiles.map(path => [path, hash(readFileSync(path))])), providerCalls: 0 }, null, 2));

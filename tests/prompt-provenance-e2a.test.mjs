import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildBoundedPromptRepresentation, buildSpatialPromptDirectives, PROMPT_TECHNIQUES } from '../src/model/prompt-structures.ts';
import { buildCreativeImagePrompt } from '../worker/openai-adapter.ts';
import { compileE2aPrompt, projectE2aSource, E2A_COMPILER_VERSION } from '../src/model/prompt-provenance-e2a.ts';
import { captureE2aFixture, exactPromptDiff, E2A_SETTINGS } from '../evals/generation-reliability/e2a/capture.mjs';
import { newCurrentE2aFixture } from '../evals/generation-reliability/e2a/fixture.mjs';
import { hash, verifySeal } from '../evals/generation-reliability/core.mjs';

const treatment = fixture => ({ version: E2A_COMPILER_VERSION, bindings: fixture.bindings });

test('only four typed provenance fields change; all source/direction inputs stay immutable', () => {
  const f = newCurrentE2aFixture(), saved = structuredClone(f);
  const result = projectE2aSource(f.source, treatment(f));
  const expected = structuredClone(f.source);
  for (const key of ['context_detail', 'source_execution_id', 'source_proposal_id', 'created_from']) delete expected.facts[1].properties[key];
  assert.deepEqual(result.snapshot, expected); assert.deepEqual(f, saved);
  assert.equal(result.removed.length, 4); assert.equal(result.removed[1].value, 'fixture-execution-e2a');
  assert.deepEqual(buildSpatialPromptDirectives(result.snapshot), buildSpatialPromptDirectives(f.source));
});

test('authored opaque strings, quotations and nested provenance survive byte-for-byte', () => {
  const f = newCurrentE2aFixture(), c = captureE2aFixture(f);
  for (const text of ['7f4c20aa-9123-4f00-8777-abc123def456', 'source_execution_id is deliberately printed on the sign.', 'authored-opaque-id', 'PRINT THIS', 'VISIBLE-PROPOSAL']) assert.ok(c.after.prompt.includes(text));
  assert.deepEqual(projectE2aSource(f.source, treatment(f)).snapshot.facts[3], f.source.facts[3]);
  assert.ok(!c.after.prompt.includes('fixture-execution-e2a'));
});

test('unbound lookalike properties and arbitrary nested provenance are never recursively stripped', () => {
  const f = newCurrentE2aFixture();
  f.source.facts[3].properties.nested = structuredClone(f.source.facts[1].properties);
  f.source.facts[3].properties.source_execution_id = 'authored-direct-field';
  const p = projectE2aSource(f.source, treatment(f));
  assert.deepEqual(p.snapshot.facts[3], f.source.facts[3]);
  assert.deepEqual(projectE2aSource(f.source, { version: E2A_COMPILER_VERSION, bindings: [] }).snapshot, f.source);
});

test('approved research, subject, palette, scopes, exclusions, relationship and planner rationale remain', () => {
  const f = newCurrentE2aFixture(), c = captureE2aFixture(f);
  assert.equal(c.privateEvidence.requirementCoverage.length, 13);
  assert.ok(c.privateEvidence.requirementCoverage.every(row => row.before && row.after));
  assert.ok(c.after.prompt.includes(JSON.stringify(f.direction)));
  assert.ok(c.after.prompt.includes('across the entire image')); // E2b is deferred
  assert.ok(c.after.prompt.includes('Atticus Finch'));
  assert.ok(!/actor.likeness|screen actor/.test(c.after.prompt)); // E3 is deferred
  assert.deepEqual(c.case.direction, f.direction);
});

test('off is byte-identical to production compiler for all formats and high/low compatibility fixtures', () => {
  const f = newCurrentE2aFixture();
  for (const quality of ['high', 'low']) for (const technique of PROMPT_TECHNIQUES) {
    const options = { quality, size: '1536x1024' };
    const expected = buildBoundedPromptRepresentation(technique, f.source, f.direction, [], options);
    const actual = compileE2aPrompt(technique, f.source, f.direction, [], options);
    assert.equal(actual.prompt, expected.prompt);
    assert.equal(actual.prompt, buildCreativeImagePrompt(f.source, f.direction, [], technique, options));
    assert.equal(actual.privateProjection.version, null);
  }
});

test('reference roles and order preserved in compatibility fixture without changing no-ref study', () => {
  const f = newCurrentE2aFixture();
  const refs = [{ source: 'uploaded-reference', label: 'Layout only', mode: 'preserve_composition', mimeType: 'image/png' }, { source: 'locked-study', label: 'Subject only', mode: 'preserve_subject', mimeType: 'image/png' }];
  const before = compileE2aPrompt('prose', f.source, f.direction, refs, { quality: 'low' });
  const after = compileE2aPrompt('prose', f.source, f.direction, refs, { quality: 'low' }, treatment(f));
  assert.equal(before.prompt.split('Attached source-image policy:')[1].split('Spatial application map:')[0], after.prompt.split('Attached source-image policy:')[1].split('Spatial application map:')[0]);
  assert.deepEqual(captureE2aFixture(f).orderedReferenceInputs, []);
});

test('later edits or reordered facts reject stale typed bindings; a new capture gets new identity', () => {
  const f = newCurrentE2aFixture(), old = captureE2aFixture(f);
  f.source.facts[1].properties.text += ' The doors remain closed.';
  assert.throws(() => projectE2aSource(f.source, treatment(f)), /edited_rebind/);
  f.bindings[0].propertiesJson = JSON.stringify(f.source.facts[1].properties);
  assert.throws(() => captureE2aFixture(f), /original_prompt_not_reproduced/);
  f.originalPrompt = buildCreativeImagePrompt(f.source, f.direction, [], 'prose', { quality: 'high', size: '1536x1024' });
  assert.notEqual(captureE2aFixture(f).id, old.id);
  f.source.facts.reverse();
  assert.throws(() => projectE2aSource(f.source, treatment(f)), /source_binding_mismatch/);
  assert.equal(old.case.source.facts[1].properties.text.endsWith('closed.'), false);
});

test('changed producer types, missing fields, disabled facts, duplicate bindings and wrong versions fail closed', () => {
  for (const [key, value] of [['context_detail', false], ['source_execution_id', { nested: 'opaque' }], ['authority', 'inferred'], ['created_from', 'authored-label']]) {
    const f = newCurrentE2aFixture(); f.source.facts[1].properties[key] = value; f.bindings[0].propertiesJson = JSON.stringify(f.source.facts[1].properties);
    assert.throws(() => projectE2aSource(f.source, treatment(f)), /producer_contract_mismatch/);
  }
  const f = newCurrentE2aFixture();
  assert.throws(() => projectE2aSource(f.source, { ...treatment(f), version: 'future' }), /version_unsupported/);
  assert.throws(() => projectE2aSource(f.source, { ...treatment(f), bindings: [...f.bindings, ...f.bindings] }), /binding_invalid/);
  f.source.facts[1].active = false;
  assert.throws(() => projectE2aSource(f.source, treatment(f)), /source_binding_mismatch/);
});

test('compaction is refused as a second treatment while flag-off behavior stays unchanged', () => {
  const f = newCurrentE2aFixture(); f.direction.scene = 'lengthy direction '.repeat(9000);
  assert.equal(compileE2aPrompt('prose', f.source, f.direction).compacted, true);
  assert.throws(() => compileE2aPrompt('prose', f.source, f.direction, [], {}, treatment(f)), /requires_uncompacted_prompt/);
});

test('sealed capture freezes ordered inputs, exact UTF-8 diff and B identities', () => {
  const c = captureE2aFixture(newCurrentE2aFixture()), d = c.exactDiff;
  verifySeal('e2a-capture', c); verifySeal('case', c.case);
  assert.equal(c.before.prompt.slice(0, d.textOffset) + d.inserted + c.before.prompt.slice(d.beforeEnd), c.after.prompt);
  const bytes = Buffer.from(c.before.prompt);
  assert.equal(Buffer.concat([bytes.subarray(0, d.byteOffset), Buffer.from(d.insertedUtf8Hex, 'hex'), bytes.subarray(d.byteOffset + Buffer.from(d.removedUtf8Hex, 'hex').length)]).toString(), c.after.prompt);
  assert.equal(c.sourceBytesHash, hash(c.sourceJson));
  assert.equal(c.directionBytesHash, hash(c.directionJson));
  assert.ok(Object.isFrozen(c.privateEvidence.sourceLedger));
  assert.equal(c.futurePreparationPlannerCallNeeded, true); assert.equal(c.capturedPlannerOutput, null);
  assert.deepEqual(c.calls, { planner: 0, moderation: 0, image: 0, evaluator: 0 });
  const unicode = exactPromptDiff('é🌊old', 'é🌊new'); assert.equal(unicode.byteOffset, 6); assert.equal(unicode.textOffset, 3);
});

test('private payload labels and missing requirement mappings cannot be admitted via caller booleans', () => {
  const f = newCurrentE2aFixture();
  assert.throws(() => captureE2aFixture({ ...f, privacy: 'private', authorized: true }), /fixture_only/);
  assert.throws(() => captureE2aFixture({ ...f, directionProvenance: 'retained' }), /fixture_only/);
  f.requirements[0].sourcePaths = ['/missing'];
  assert.throws(() => captureE2aFixture(f), /requirement_source_missing/);
});

test('checked-in candidate is reproduced exactly by the current compiler', () => {
  const saved = JSON.parse(readFileSync(new URL('../evals/generation-reliability/e2a/artifacts/capture.json', import.meta.url)));
  assert.deepEqual(captureE2aFixture(newCurrentE2aFixture()), saved);
  const base = new URL('../evals/generation-reliability/e2a/artifacts/', import.meta.url);
  for (const arm of ['before', 'after']) assert.equal(readFileSync(new URL(`${arm}.txt`, base), 'utf8'), saved[arm].prompt);
  assert.deepEqual(JSON.parse(readFileSync(new URL('exact-diff.json', base))), saved.exactDiff);
  assert.deepEqual(JSON.parse(readFileSync(new URL('semantic-ledger.json', base))), saved.privateEvidence);
  assert.ok(Object.isFrozen(E2A_SETTINGS.references));
});

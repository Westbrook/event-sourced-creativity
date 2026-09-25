import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildContextApplicationPlan } from '../src/model/context-proposal-application.ts';
import { normalizeDecompositionProposals } from '../src/model/context-intelligence.ts';
import { providerFacingCreativeContext, providerFacingRenderingContext } from '../src/model/prompt-policy.ts';
import { buildProsePrompt } from '../src/model/prompt-structures.ts';
import { buildCreativeImagePrompt, generateCreativeImage } from '../worker/openai-adapter.ts';
import { captureE2aFixture } from '../evals/generation-reliability/e2a/capture.mjs';
import { newCurrentE2aFixture, E2A_SIGN_RECORD_TEXT } from '../evals/generation-reliability/e2a/fixture.mjs';
import { validateCoverage } from '../evals/generation-reliability/core.mjs';

const block = (id, text, documentId = 'doc') => ({ id, projectId: 'project', documentId, scope: 'document', type: 'direction', handle: `direction/${id}`, properties: { text, authority: 'authored', weight: 1 }, locked: false, removed: false });
const fact = payload => ({ block_id: payload.block_id, type: payload.type, handle: payload.handle, role: payload.type, intent: 'include', effect: 'must_include', properties: payload.properties });
function approved(edit) {
  const source = 'Keep the courthouse behind the lawyer. Never place it in front.';
  const target = block('source', source);
  const [decomposition] = normalizeDecompositionProposals(source, [{ id: 'proposal', type: 'environment', subtype: 'Place', label: 'courthouse', text: source, source_excerpt: source, participants: [] }]);
  assert.ok(decomposition);
  let n = 0;
  const plan = buildContextApplicationPlan({ projection: { libraryBlocks: [target], libraryBlockRelations: [] }, target,
    proposals: [{ key: 'proposal', executionId: 'internal-execution', proposalId: decomposition.id, decomposition, ...(edit ? { edit } : {}) }], createId: () => `new-${++n}` });
  return plan.events.find(e => e.type === 'BlockCreated').payload;
}
const contextIn = prompt => JSON.parse(prompt.split('Active creative context:\n')[1]);

test('approved excerpt is semantic only when selected into text; later reviewed edits do not resurrect grounding copy', () => {
  const original = approved(), edited = approved({ label: 'Left courthouse', text: 'Place the courthouse to the left. Keep the right clear.' });
  for (const payload of [original, edited]) {
    const source = { facts: [fact(payload)] };
    const projected = providerFacingCreativeContext(source).facts[0].properties;
    assert.equal(projected.text, payload.properties.text);
    assert.equal(projected.source_excerpt, undefined);
    const rendered = contextIn(buildProsePrompt(source, { scene: 'A planner suggestion.', authority: 'inferred' }));
    assert.equal(rendered.facts[0].properties.text, payload.properties.text);
    assert.equal(rendered.facts[0].properties.authority, 'authored');
    assert.equal(rendered.facts[0].properties.source_excerpt, undefined);
    assert.equal(rendered.facts[0].properties.source_block_id, undefined);
  }
  assert.equal(edited.properties.source_excerpt, original.properties.text);
  assert.equal(edited.properties.human_edited, true);
  assert.ok(!buildProsePrompt({ facts: [fact(edited)] }, {}).includes(original.properties.text));
});

test('actual copy producer preserves nested authored strings and same-named quoted keys while bookkeeping stays private', () => {
  const target = block('target', 'Use this sign.'), copied = block('sign', E2A_SIGN_RECORD_TEXT, 'other-doc');
  const quoted = '“provenance”, “source_excerpt” and “source_execution_id” are printed labels.';
  copied.properties.caption = { lines: [{ text: quoted }, { text: 'PRINT THIS — VISIBLE-PROPOSAL — authored-opaque-id' }], provenance: { text: 'PRIVATE_NESTED_LEDGER' } };
  copied.properties.provenance = { text: 'PRIVATE_ORIGINAL' };
  copied.properties.source_excerpt = 'PRIVATE_GROUNDING';
  copied.properties.source_block_id = 'PRIVATE_SOURCE_ID';
  let n = 0;
  const plan = buildContextApplicationPlan({ projection: { libraryBlocks: [target, copied], libraryBlockRelations: [] }, target,
    proposals: [{ key: 'copy', executionId: 'internal', proposalId: 'copy', research: { blockId: copied.id, area: 'related', label: 'Sign', text: 'Sign', type: 'direction' } }], createId: () => `copy-${++n}` });
  const created = plan.events.find(e => e.type === 'BlockCreated').payload;
  assert.deepEqual(created.properties.caption, copied.properties.caption);
  const snapshot = { facts: [fact(created)] }, rendered = contextIn(buildProsePrompt(snapshot, {}));
  assert.equal(rendered.facts[0].properties.text, E2A_SIGN_RECORD_TEXT);
  assert.deepEqual(rendered.facts[0].properties.caption.lines, copied.properties.caption.lines);
  assert.equal(rendered.facts[0].properties.caption.provenance, undefined);
  for (const marker of ['PRIVATE_NESTED_LEDGER', 'PRIVATE_ORIGINAL', 'PRIVATE_GROUNDING', 'PRIVATE_SOURCE_ID']) assert.ok(!JSON.stringify(rendered).includes(marker));
});

test('v2 retains every old anchor and scoped positive/negative meaning; missing semantic text still fails coverage', () => {
  const f = newCurrentE2aFixture(), capture = captureE2aFixture(f);
  assert.equal(f.requirements.length, 13);
  const archived = JSON.parse(readFileSync(new URL('../evals/generation-reliability/e2a/artifacts/capture.json', import.meta.url)));
  const anchors = requirements => requirements.map(({ id, mustContain, critical }) => ({ id, mustContain, critical }));
  assert.deepEqual(anchors(f.requirements), anchors(archived.case.requirements));
  assert.throws(() => validateCoverage(archived.case, buildProsePrompt(archived.case.source, archived.case.direction)), /semantic_coverage_missing:approved-excerpt,nested-authored-opaque/);
  for (const arm of ['before', 'after']) {
    const rendered = contextIn(capture[arm].prompt);
    assert.equal(rendered.facts[1].properties.text, f.source.facts[1].properties.text);
    assert.equal(rendered.facts[3].properties.text, f.source.facts[3].properties.text);
    assert.equal(rendered.facts[3].properties.quote, f.source.facts[3].properties.quote);
    assert.deepEqual(rendered.facts[3].properties.spatial_scope, f.source.facts[3].properties.spatial_scope);
    assert.deepEqual(rendered.facts[4].properties.spatial_scope, f.source.facts[4].properties.spatial_scope);
    assert.equal(rendered.facts[4].intent, 'prohibit');
    assert.equal(rendered.facts[3].intent, 'include');
    assert.equal(rendered.facts[1].properties.source_excerpt, undefined);
  }
  for (const [id, text] of [['approved-excerpt', 'Keep the courthouse behind the lawyer.'], ['nested-authored-opaque', 'VISIBLE-PROPOSAL']]) {
    assert.throws(() => validateCoverage(capture.case, capture.after.prompt.replaceAll(text, '')), new RegExp(id));
  }
  const withInference = { facts: [...f.source.facts, { block_id: 'inferred', type: 'style', authority: 'inferred', properties: { authority: 'inferred', text: 'Optional chalk texture.', weight: .2 } }] };
  assert.equal(providerFacingRenderingContext(withInference).facts.at(-1).authority, 'inferred');
});

test('actual image adapter sends all semantic carriers to exact moderation and renderer without E2a bookkeeping', async () => {
  const f = newCurrentE2aFixture(), c = captureE2aFixture(f), calls = [], saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return String(url).endsWith('/moderations') ? Response.json({ results: [{ flagged: false, categories: {} }] })
      : Response.json({ data: [{ b64_json: btoa('synthetic-not-pixels') }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
  };
  try {
    assert.equal(buildCreativeImagePrompt(f.source, f.direction, [], 'prose', { quality: 'high', size: '1536x1024' }), c.before.prompt);
    await generateCreativeImage({ OPENAI_API_KEY: 'mock-only', OPENAI_IMAGE_MODEL: 'gpt-image-2.5-sunburst' }, 'synthetic-c2', f.source, f.direction,
      { quality: 'high', size: '1536x1024', outputFormat: 'png', partialImages: 0, preparedPrompt: c.after.prompt });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.input[0].text, c.after.prompt);
    assert.equal(calls[1].body.prompt, c.after.prompt);
    for (const token of ['fixture-execution-e2a', 'fixture-proposal-e2a', 'fixture-source']) assert.ok(!c.after.prompt.includes(token));
    validateCoverage(c.case, calls[1].body.prompt);
  } finally { globalThis.fetch = saved; }
});

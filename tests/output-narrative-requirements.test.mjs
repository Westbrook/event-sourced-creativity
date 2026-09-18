import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { SHORT_STORY_NARRATIVE_CONTRACT as contract } from '../src/model/output-narrative-contract.ts';
import { inspectOutputRequirement, outputCountSatisfies } from '../src/model/output-requirements.ts';
import { compileOutputPlan } from '../src/model/output-plan.ts';
import { createExperienceOutputRecipe } from '../worker/experience-output-recipe.ts';
import { createExperienceNarrativeRecipe } from '../worker/experience-narrative-recipe.ts';

// Pre-change serialized hashes from the current canonical compiler, fixed inputs.
const before = {"options":{"document_id":"document-1","source_revision":"source-1","requirement_revision":"requirements-1"},"generic":{"schema_version":1,"id":"legacy-r","label":"Short story","original_text":"1 document","deliverables":[{"id":"legacy-d","label":"Short story","media_kind":"document","required":true,"quantity":{"kind":"exact","unit":"document","value":1},"source_scope":{"kind":"document"},"coverage":{"kind":"document_context"},"original_text":"1 document","value_origins":{}}],"value_origins":{"interpretation_basis":{"kind":"interpreted","text":"1 document"}}},"rows":{"image":{"spec":"8e443eb34e621ff8222a568ff94f6bfbd42b33d7c3ba13072ba2f3df85927660","plan":"f6cc40bb90c2bae2427fc55ab08ec75ae0f76d4444d8253119517ce4222e9e04","recipe":"8d99a7195bcb1334ba2a69d971cd75566089c81b7016995fc68f270189245d81"},"slides":{"spec":"3a9a73fb52d33624d153acf98d2a0ff73fc50eaf96ae3bc0f30c18a1a96d86de","plan":"ca5a5db24666dcb1e8a800f108c30748c5ab183ab392e7e5369a9795d23319ca","recipe":"3adc5f08698ed5b9bc0f1f56b9719d93c070b6c3aaca9c3ee055c9accd9db47d"},"document":{"spec":"1e4e4c929e3c97bac9c3e040177edb5030bcc4d4f4b75a734ecd7a6da25c09a7","plan":"0fc5870f3513000b68bae7a10af7814d80d4d949fa02a118d897b528f3965459"}}};
const recipe = () => createExperienceNarrativeRecipe({ output: 'short_story', requirementId: 'story-r', deliverableId: 'story-d', contract });
const plan = () => compileOutputPlan([recipe().spec], before.options);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Execute the exact production functions, not the DB/provider module graph.
// These checks use only unadmitted target metadata; no successful native jobs.
function sourceFunction(path, name) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const match = new RegExp('export (?:async )?function ' + name + '\\([\\s\\S]*?\\n\\}').exec(source);
  assert.ok(match, name); return stripTypeScriptTypes(match[0].replace('export ', ''));
}
const inspectionFunction = sourceFunction('../worker/output-requirements-api.ts', 'inspectOutputTargetFile');
const inspect = new Function('outputCountSatisfies', inspectionFunction + ';return inspectOutputTargetFile;')(outputCountSatisfies);

 test('omitted contracts preserve exact Image, Slides and generic Document spec/plan/recipe serialization', () => {
  for (const output of ['image', 'slides', 'document']) {
    const legacy = output === 'document' ? null : createExperienceOutputRecipe({ output, requirementId: 'requirement-1', deliverableId: 'deliverable-1', ...(output === 'image' ? { variantId: 'variant-1', aspectRatio: { width: 1, height: 1 } } : {}) });
    const spec = legacy?.spec ?? before.generic, compiled = compileOutputPlan([spec], before.options);
    assert.equal(hash(spec), before.rows[output].spec); assert.equal(hash(compiled), before.rows[output].plan);
    if (legacy) assert.equal(hash(legacy), before.rows[output].recipe);
    assert.ok(spec.deliverables.every(entry => !Object.hasOwn(entry, 'narrative_contract')));
    assert.ok(compiled.targets.every(target => !Object.hasOwn(target, 'narrative_contract')));
  }
});

test('explicit fixed story recipe propagates exact immutable narrative intent without enabling native entry', () => {
  const built = recipe(), compiled = plan();
  assert.equal(built.nativeReadiness, 'unavailable'); assert.equal(built.output, 'short_story');
  assert.equal(inspectOutputRequirement(built.spec).status, 'valid'); assert.ok(Object.isFrozen(built.spec.deliverables[0].narrative_contract));
  assert.equal(compiled.targets.length, 1); assert.deepEqual(compiled.issues, []);
  assert.equal(compiled.targets[0].media_kind, 'document'); assert.deepEqual(compiled.targets[0].quantity, { kind: 'exact', unit: 'document', value: 1 });
  assert.deepEqual(compiled.targets[0].narrative_contract, contract);
  compiled.targets[0].narrative_contract.wordRange.min = 1;
  assert.equal(built.spec.deliverables[0].narrative_contract.wordRange.min, 600);
  assert.throws(() => createExperienceOutputRecipe({ output: 'short_story', requirementId: 'r', deliverableId: 'd' }), /recipe_invalid/);
});

test('present undefined/null/foreign contracts and incompatible count/source/variant shapes fail closed and remain preserved', () => {
  const mutations = [
    entry => { entry.narrative_contract = undefined; }, entry => { entry.narrative_contract = null; },
    entry => { entry.narrative_contract.language = 'ja'; }, entry => { entry.narrative_contract.retry = true; },
    entry => { entry.media_kind = 'image'; }, entry => { entry.quantity.value = 2; },
    entry => { entry.quantity = { kind: 'range', unit: 'document', min: 1, max: 2 }; },
    entry => { entry.source_scope = { kind: 'blocks', block_ids: ['one'] }; },
    entry => { entry.coverage = { kind: 'document_outline' }; },
    entry => { entry.content_quantity = undefined; }, entry => { entry.content_quantity = { kind: 'exact', unit: 'document', value: 1 }; },
    entry => { entry.format_variants = []; }, entry => { entry.series = undefined; },
  ];
  for (const mutate of mutations) {
    const spec = structuredClone(recipe().spec); mutate(spec.deliverables[0]);
    const result = inspectOutputRequirement(spec); assert.equal(result.status, 'invalid'); assert.equal(result.spec, null); assert.equal(result.preserved, spec);
    assert.equal(compileOutputPlan([spec], before.options).targets.length, 0);
  }
  let invoked = false; const spec = structuredClone(recipe().spec);
  Object.defineProperty(spec.deliverables[0], 'narrative_contract', { enumerable: true, get() { invoked = true; throw Error('Getter invoked'); } });
  assert.equal(inspectOutputRequirement(spec).status, 'invalid'); assert.equal(invoked, false);
  const future = { ...recipe().spec, schema_version: 2 };
  assert.equal(inspectOutputRequirement(future).status, 'unsupported'); assert.equal(inspectOutputRequirement(future).preserved, future);
});

test('the actual target-contract digest binds narrative envelope and source; absent field is distinct', async () => {
  const canonical = sourceFunction('../worker/output-disclosure-proof.ts', 'canonicalOutputJson');
  const digest = sourceFunction('../worker/output-disclosure-proof.ts', 'outputDigest');
  const targetDigest = sourceFunction('../worker/output-requirements-api.ts', 'outputTargetContractDigest');
  const calculate = new Function('VALIDATION_POLICY', canonical + digest + targetDigest + ';return outputTargetContractDigest;')('output-owned-file-v1');
  const target = plan().targets[0], original = await calculate(target, 'source-one');
  for (const mutate of [value => { delete value.narrative_contract; }, value => { value.narrative_contract.id = 'changed'; }, value => { value.narrative_contract.wordRange.max = 801; }]) {
    const changed = structuredClone(target); mutate(changed); assert.notEqual(await calculate(changed, 'source-one'), original);
  }
  assert.notEqual(await calculate(target, 'source-two'), original);
  const reordered = structuredClone(target); reordered.narrative_contract = Object.fromEntries(Object.entries(reordered.narrative_contract).reverse());
  assert.equal(await calculate(reordered, 'source-one'), original);
});

test('actual shared legacy file inspection refuses any present narrative contract; ordinary safe Markdown is unchanged', () => {
  const safeMarkdown = { status: 'inspected', kind: 'document', facts: {}, checks: ['safe_markdown'], errors: [] };
  const generic = compileOutputPlan([before.generic], before.options).targets[0];
  assert.deepEqual(inspect(generic, safeMarkdown), { status: 'passed', checks: ['safe_markdown'], problems: [] });
  for (const value of [contract, null, undefined, {}]) {
    const target = { ...generic, narrative_contract: value };
    assert.deepEqual(inspect(target, safeMarkdown), { status: 'failed', checks: [], problems: ['narrative_body_validation_unavailable'] });
  }
});

test('native preflight and native-result entry refuse narrative metadata before DB/media/provider reads', async () => {
  const preflight = sourceFunction('../worker/output-image-slides-preflight.ts', 'outputNativeTargetRefusal');
  const refuse = new Function('unavailable', preflight + ';return outputNativeTargetRefusal;')((targetId, reasonCode) => ({ targetId, available: false, reasonCode }));
  const native = sourceFunction('../worker/output-native-result.ts', 'resolveOutputNativeResult');
  const resolve = new Function('OutputConflictError', native + ';return resolveOutputNativeResult;')(class extends Error {});
  const input = { target: plan().targets[0], env: { get DB() { throw Error('DB read forbidden'); } }, scope: {}, nativeJobId: 'unadmitted' };
  assert.equal(refuse(input).reasonCode, 'output_native_narrative_unavailable');
  await assert.rejects(resolve(input), /native_narrative_result_unavailable/);
});

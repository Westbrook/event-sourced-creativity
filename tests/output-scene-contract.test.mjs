import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSceneOutputContract, parseSceneOutputContract, SCENE_OUTPUT_POLICY } from '../src/model/output-scene-contract.ts';
import { SCENE_PAGINATION_POLICY } from '../src/model/scene-pagination.ts';
import { canonicalJson } from '../src/experiences/compiler.ts';
import { SCENE_FONT_METRICS, SCENE_FONT_METRICS_SHA256 } from '../worker/scene-font-metrics.ts';
import { createExperienceSceneRecipe } from '../worker/experience-scene-recipe.ts';
import { inspectOutputRequirement } from '../src/model/output-requirements.ts';
import { compileOutputPlan } from '../src/model/output-plan.ts';
import { SHORT_STORY_NARRATIVE_CONTRACT } from '../src/model/output-narrative-contract.ts';

const references = () => ({ draftId: 'experience-draft-' + 'a'.repeat(64), draftHash: 'sha256:' + 'b'.repeat(64),
  releaseHash: 'sha256:' + 'c'.repeat(64), requestHash: 'sha256:' + 'd'.repeat(64), sourceBindingHash: 'sha256:' + 'e'.repeat(64) });
const contract = () => createSceneOutputContract(references());
const recipe = () => createExperienceSceneRecipe({ output: 'scene', requirementId: 'requirement-1', deliverableId: 'deliverable-1', contract: contract() });
const options = { document_id: 'document-1', source_revision: 'source-1', requirement_revision: 'requirements-1' };

test('closed Scene output contract binds the current verified font/pagination profile and immutable original-source references', () => {
  const source = references(), captured = createSceneOutputContract(source); source.requestHash = 'changed';
  assert.deepEqual(parseSceneOutputContract(captured), contract()); assert.ok(Object.isFrozen(captured.source));
  assert.equal(SCENE_OUTPUT_POLICY.fontSha256, SCENE_FONT_METRICS.fontSha256);
  assert.equal(SCENE_OUTPUT_POLICY.metricsSha256, SCENE_FONT_METRICS_SHA256);
  assert.equal(SCENE_OUTPUT_POLICY.paginationPolicySha256, createHash('sha256').update(canonicalJson(SCENE_PAGINATION_POLICY)).digest('hex'));
  for (const changed of [{ ...captured, pageRange: { min: 1, max: 3 } }, { ...captured, medium: 'audio' },
    { ...captured, source: { ...captured.source, requestHash: 'changed' } }, { ...captured, requirementFulfilled: true }]) assert.equal(parseSceneOutputContract(changed), null);
  let called = false; const getter = { ...captured }; Object.defineProperty(getter, 'source', { enumerable: true, get() { called = true; return captured.source; } });
  assert.equal(parseSceneOutputContract(getter), null); assert.equal(called, false);
});

test('Scene recipe compiles one exact Document target with its explicit contract, no activation or narrative default', () => {
  const made = recipe(); assert.equal(inspectOutputRequirement(made.spec).status, 'valid'); assert.equal(made.nativeReadiness, 'unavailable');
  const plan = compileOutputPlan([made.spec], options); assert.equal(plan.targets.length, 1);
  const target = plan.targets[0]; assert.equal(target.id, made.targetId); assert.deepEqual(target.scene_contract, contract());
  assert.equal(Object.hasOwn(target, 'narrative_contract'), false); assert.equal(target.count_policy, null);
  assert.equal(target.media_kind, 'document'); assert.deepEqual(target.quantity, { kind: 'exact', unit: 'document', value: 1 });
  const ordinary = structuredClone(made.spec); delete ordinary.deliverables[0].scene_contract;
  const legacy = compileOutputPlan([ordinary], options).targets[0]; assert.equal(Object.hasOwn(legacy, 'scene_contract'), false);
});

test('Scene requirement cannot mix another medium, quantity, layout claim or Short story contract; generic adoption remains refused', () => {
  for (const patch of [{ narrative_contract: SHORT_STORY_NARRATIVE_CONTRACT }, { media_kind: 'slides' },
    { quantity: { kind: 'exact', unit: 'document', value: 2 } }, { content_quantity: { kind: 'exact', unit: 'page', value: 1 } }]) {
    const spec = structuredClone(recipe().spec); Object.assign(spec.deliverables[0], patch); assert.notEqual(inspectOutputRequirement(spec).status, 'valid');
  }
  const text = readFileSync(new URL('../worker/output-native-result.ts', import.meta.url), 'utf8');
  const line = text.split('\n').find(line => line.includes('Object.hasOwn(target,"scene_contract")'));
  class Refusal extends Error {}
  const guard = new Function('target', 'OutputConflictError', line);
  assert.throws(() => guard({ scene_contract: contract() }, Refusal), /native_scene_result_unavailable/);
  assert.doesNotThrow(() => guard({}, Refusal));
});

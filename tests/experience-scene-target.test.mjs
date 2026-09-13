import assert from 'node:assert/strict';
import test from 'node:test';
import { captureExperienceSceneTarget } from '../src/experiences/scene-target.ts';
import { createSceneOutputContract } from '../src/model/output-scene-contract.ts';
import { createExperienceSceneRecipe } from '../worker/experience-scene-recipe.ts';
import { compileOutputPlan } from '../src/model/output-plan.ts';

function fixture() {
  const source = {draftId: 'experience-draft-' + 'a'.repeat(64), draftHash: 'sha256:' + 'b'.repeat(64),
    releaseHash: 'sha256:' + 'c'.repeat(64), requestHash: 'sha256:' + 'd'.repeat(64), sourceBindingHash: 'sha256:' + 'e'.repeat(64)};
  const contract = createSceneOutputContract(source);
  const recipe = createExperienceSceneRecipe({output: 'scene', requirementId: 'requirement-1', deliverableId: 'deliverable-1', contract});
  const target = compileOutputPlan([recipe.spec], {document_id: 'doc', source_revision: 'source', requirement_revision: 'requirements'}).targets[0];
  return {source, contract, target};
}
// Pure unadmitted target comparison. No provider/receipt/permission authority.
test('Scene host captures only the exact compiled target and original source references', () => {
  const f = fixture(), captured = captureExperienceSceneTarget(f.target, f.source);
  assert.deepEqual(captured, f.contract); assert.ok(Object.isFrozen(captured.source));
  f.source.requestHash = 'sha256:' + 'f'.repeat(64);
  assert.notEqual(captured.source.requestHash, f.source.requestHash);
  assert.equal(captureExperienceSceneTarget(f.target, f.source), null);
  assert.equal(Object.hasOwn(captured, 'requirementFulfilled'), false);
  for (const key of ['draftId', 'draftHash', 'releaseHash', 'requestHash', 'sourceBindingHash']) {
    const next = fixture(); next.source[key] = key === 'draftId' ? 'experience-draft-' + 'f'.repeat(64) : 'sha256:' + 'f'.repeat(64);
    assert.equal(captureExperienceSceneTarget(next.target, next.source), null, key);
  }
});
test('Scene host refuses broadened counts, partial source, narrative and omitted nullable plan fields', () => {
  for (const patch of [{media_kind: 'scene'}, {scene_contract: null}, {narrative_contract: null},
    {quantity: {kind: 'exact', unit: 'document', value: 2}}, {quantity: {kind: 'exact', unit: 'document', value: 1, extra: true}},
    {source_scope: {kind: 'document', block_ids: []}}, {coverage: {kind: 'per_block'}},
    ...['aspect_ratio', 'content_quantity', 'count_policy', 'variant_id', 'member_id', 'suggested_count'].flatMap(key => [{[key]: false}, {[key]: undefined}])]) {
    const f = fixture(); Object.assign(f.target, patch);
    assert.equal(captureExperienceSceneTarget(f.target, f.source), null, JSON.stringify(patch));
  }
});
test('Scene target and source accessors are never read and foreign prototypes are refused', () => {
  for (const location of ['target', 'quantity', 'contract', 'expected']) {
    const f = fixture(); let calls = 0;
    const object = location === 'target' ? f.target : location === 'quantity' ? f.target.quantity
      : location === 'contract' ? f.target.scene_contract : f.source;
    const key = location === 'target' ? 'media_kind' : location === 'quantity' ? 'value' : location === 'contract' ? 'source' : 'draftHash';
    Object.defineProperty(object, key, {enumerable: true, get() {calls++; throw new Error('must not read');}});
    assert.equal(captureExperienceSceneTarget(f.target, f.source), null); assert.equal(calls, 0);
  }
  const f = fixture();
  assert.equal(captureExperienceSceneTarget(Object.assign(Object.create({inherited: true}), f.target), f.source), null);
});

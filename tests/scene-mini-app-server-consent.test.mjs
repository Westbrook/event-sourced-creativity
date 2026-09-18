import test from 'node:test';
import assert from 'node:assert/strict';
import { scenePreflightFixture } from './helpers/scene-output-fixture.mjs';
import { createSceneMiniAppCostPreview, requireSceneMiniAppCostApproval } from '../worker/scene-mini-app-consent.ts';

const now = Date.parse('2026-09-13T04:00:00.000Z'), expires = '2026-09-13T04:05:00.000Z';
async function setup() {
  const payload = await scenePreflightFixture(), { sceneContract, intake, contract, costPreview } = payload.outputScene;
  const preview = { ...costPreview, version: 'scene-cost-v1', maximumProviderCallCount: 2 };
  for (const key of ['maximumInputTokens', 'maximumOutputTokens', 'maximumTokens', 'sceneContractDigest', 'executionContractDigest', 'expiresAt']) delete preview[key];
  // Supplied source-proof fixture exercises binding logic only; no DB authority.
  const proof = { preview, scope: undefined, production: null, validUntil: '2026-09-13T04:10:00.000Z',
    binding: { actorUserId: preview.actorUserId, projectId: preview.projectId, documentId: preview.documentId,
      permissionEpoch: preview.permissionEpoch, sourceHash: preview.sourceHash, intentHash: preview.requestHash, period: preview.period } };
  return { proof, sceneContract, intake, contract, run: () => createSceneMiniAppCostPreview(proof, sceneContract, intake, contract, expires, now) };
}

test('one-call server disclosure binds legacy source proof and exact Scene/execution contracts without mutating or approving legacy flow', async () => {
  const f = await setup(), before = structuredClone(f.proof), current = await f.run(); assert.ok(current);
  assert.equal(current.maximumProviderCallCount, 1); assert.equal(current.requestId, before.preview.requestId);
  assert.equal(current.sourceHash, before.preview.sourceHash); assert.notEqual(current.requestHash, before.preview.requestHash);
  assert.notEqual(current.bindingHash, before.preview.bindingHash); assert.deepEqual(f.proof, before);
  assert.equal(Object.hasOwn(current, 'confirmed'), false);
  assert.throws(() => requireSceneMiniAppCostApproval(current, current, current, now), /confirmation_required/);
  assert.doesNotThrow(() => requireSceneMiniAppCostApproval({ ...current, confirmed: true }, current, current, now));
});

test('one-call server consent refuses source/actor changes, changed source-proof identity, expiry extension and missing explicit action', async () => {
  const f = await setup(), original = await f.run(), approval = { ...original, confirmed: true };
  f.proof.preview.sourceHash = f.proof.binding.sourceHash = 'f'.repeat(64); f.proof.preview.bindingHash = 'f'.repeat(64);
  const changed = await f.run(); assert.ok(changed);
  assert.throws(() => requireSceneMiniAppCostApproval(approval, original, changed, now), /confirmation_required/);
  f.proof.binding.actorUserId = 'other'; assert.equal(await f.run(), null);
  const good = await setup();
  assert.equal(await createSceneMiniAppCostPreview(good.proof, good.sceneContract, good.intake, good.contract, '2026-09-13T04:11:00.000Z', now), null);
  assert.equal(await createSceneMiniAppCostPreview(good.proof, good.sceneContract, good.intake, good.contract, expires, Date.parse(expires)), null);
  assert.throws(() => requireSceneMiniAppCostApproval(approval, original, original, Date.parse(expires)), /confirmation_required/);
});

test('one-call consent rejects managed/audio/workflow/project proofs rather than widening legacy Scene eligibility', async () => {
  for (const change of [f => { f.proof.preview.productionMode = 'managed'; }, f => { f.proof.preview.sceneMedium = 'audio'; },
    f => { f.proof.preview.reusedSourceCount = 1; }, f => { f.proof.scope = {}; }, f => { f.proof.production = {}; }]) {
    const f = await setup(); change(f); assert.equal(await f.run(), null);
  }
});

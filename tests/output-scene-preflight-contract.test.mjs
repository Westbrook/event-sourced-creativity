import test from 'node:test';
import assert from 'node:assert/strict';
import { scenePreflightFixture as fixture } from './helpers/scene-output-fixture.mjs';
import { readOutputScenePayload, outputScenePreflightConfiguration } from '../worker/output-scene-preflight-contract.ts';
const now = Date.parse('2026-09-13T04:00:00.000Z');

test('Scene preflight configuration discloses one exact route/call and same original request identity without synthesizing approval', async () => {
  const payload = await fixture(), ready = await outputScenePreflightConfiguration('target-1', payload, now);
  assert.ok(ready); assert.equal(ready.route, 'document-scene-screenplay-manual-v1'); assert.equal(ready.maximumCalls, 1);
  assert.equal(ready.maximumMicrousd, 1000000); assert.equal(ready.maximumTokens, 128000); assert.equal(ready.settings.calls.length, 1);
  assert.equal(ready.settings.calls[0].stage, payload.outputScene.contract.stage);
  assert.equal(ready.settings.payload.sceneRequestId, payload.outputScene.costPreview.requestId);
  assert.equal(Object.hasOwn(ready.settings.payload, 'sceneCostConsent'), false);
  assert.equal(Object.hasOwn(ready.settings.payload.outputScene.costPreview, 'confirmed'), false);
  assert.ok(Object.isFrozen(ready.settings.payload.outputScene.intake.values));
});

test('Scene preflight refuses changed instructions, source contract, input caps, foreign routes, expiry and injected confirmation', async () => {
  for (const change of [p => { p.outputTargetInstructions = 'changed'; }, p => { p.sceneRequestId = 'other'; }, p => { p.itemCount = 2; },
    p => { p.artifactKind = 'short_story'; }, p => { p.outputScene.costPreview.maximumInputTokens = 31000; },
    p => { p.outputScene.sceneContract.source.requestHash = 'sha256:' + 'f'.repeat(64); }, p => { p.sceneCostConsent = { confirmed: true }; }]) {
    const payload = structuredClone(await fixture()); change(payload); assert.equal(await readOutputScenePayload(payload), null);
  }
  const payload = await fixture(); assert.equal(await outputScenePreflightConfiguration('target-1', payload, Date.parse(payload.outputScene.costPreview.expiresAt)), null);
});

test('Scene preflight captures supplied revision before awaits and rejects getters without invoking them', async () => {
  const payload = structuredClone(await fixture()), promise = readOutputScenePayload(payload);
  payload.outputScene.intake.values.characterA.value = 'changed'; payload.outputScene.costPreview.maximumInputTokens = 1;
  const captured = await promise; assert.ok(captured); assert.equal(captured.outputScene.intake.values.characterA.value, 'Alex');
  let invoked = false; const hostile = await fixture(); Object.defineProperty(hostile, 'outputScene', { enumerable: true, get() { invoked = true; return {}; } });
  assert.equal(await readOutputScenePayload(hostile), null); assert.equal(invoked, false);
});

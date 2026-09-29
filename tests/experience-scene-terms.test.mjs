import assert from 'node:assert/strict';
import test from 'node:test';
import { scenePreflightFixture } from './helpers/scene-output-fixture.mjs';
import { outputScenePreflightConfiguration } from '../worker/output-scene-preflight-contract.ts';
import { outputTerms } from '../src/experiences/output-terms.ts';
const now = Date.parse('2026-09-13T04:00:00.000Z');
async function fixture() {
  const payload = await scenePreflightFixture(), target = await outputScenePreflightConfiguration('target-1', payload, now);
  const offer = {id: 'offer-1', planRevisionId: 'plan-1', termsDigest: 'terms-1', sourceDigest: 'source-1', requirementsDigest: 'requirements-1',
    maximumMicrousd: target.maximumMicrousd, maximumCalls: target.maximumCalls, createdAt: new Date(now - 1000).toISOString(),
    expiresAt: payload.outputScene.costPreview.expiresAt, targets: [target], operationAttempts: {'target-1': {ordinal: 0, previousSlotId: null}}};
  const options = {now, output: 'scene', targetId: 'target-1', expectedSceneContract: payload.outputScene.sceneContract,
    expectedSceneContractDigest: payload.outputScene.costPreview.sceneContractDigest, sceneCostPreview: payload.outputScene.costPreview};
  return {offer, options};
}
// Actual server formatter -> UI projection over unadmitted supplied fixtures.
test('Scene terms disclose exact one-call written Scene and captured separate approval identity', async () => {
  const f = await fixture(), shown = outputTerms(f.offer, f.options);
  assert.equal(shown.available, true); assert.equal(shown.grantAvailable, false);
  assert.equal(shown.targets.length, 1); assert.equal(shown.targets[0].calls.length, 1);
  const rows = Object.fromEntries(shown.targets[0].rows.map(({label, value}) => [label, value]));
  assert.equal(rows.Output, '1 written scene · 2 characters · 1 location · 1–2 pages');
  assert.equal(rows['Maximum generation calls'], '1'); assert.equal(rows['Maximum spend'], 'USD 1.00');
  assert.equal(rows['Scene request'], f.options.sceneCostPreview.requestId);
  assert.equal(rows['Generation calls'], '1 initial · No automatic repair');
  assert.equal(JSON.stringify(shown).includes('"confirmed":true'), false);
});
test('Scene terms cannot use another intake, changed disclosure, legacy route or extra paid repair', async () => {
  const f = await fixture();
  for (const mutate of [
    x => x.options.expectedSceneContract.source.requestHash = 'sha256:' + 'f'.repeat(64),
    x => x.options.expectedSceneContractDigest = 'sha256:' + 'f'.repeat(64),
    x => x.options.sceneCostPreview.requestId = 'different',
    x => delete x.options.sceneCostPreview,
    x => x.offer.targets[0].settings.payload.outputScene.costPreview.requestId = 'other',
    x => x.offer.targets[0].settings.payload.sceneRequestId = 'other',
    x => x.offer.targets[0].settings.payload.sceneCostConsent = {confirmed: true},
    x => x.offer.targets[0].settings.calls.push({...x.offer.targets[0].settings.calls[0], stage: 'planning:0:repair'}),
    x => x.offer.targets[0].settings.payload.outputScene.contract.maximumOutputTokens = 6000,
    x => x.offer.targets[0].route = 'document-short-story-manual-v1',
    x => x.offer.maximumCalls = 2,
    x => x.offer.operationAttempts['target-1'].ordinal = 1,
    x => x.options.now = Date.parse(x.options.sceneCostPreview.expiresAt),
  ]) {
    const changed = {offer: structuredClone(f.offer), options: structuredClone(f.options)};
    mutate(changed); assert.equal(outputTerms(changed.offer, changed.options).available, false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneMiniAppCostPreview, sceneMiniAppCostApprovalMatches } from '../src/model/scene-mini-app-consent.ts';
// Pure supplied records, not genuine server consent, grant or provider authority.
const now = Date.parse('2026-09-13T04:00:00.000Z');
const preview = () => ({ version: 'scene-mini-app-cost-v1', requestId: 'request-1', actorUserId: 'actor-1', projectId: 'project-1', documentId: 'document-1',
  contextSessionId: null, permissionEpoch: 'permission-1', period: '2026-09', requestHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64),
  provider: 'openai', model: 'gpt-5.6-terra', sceneMedium: 'visual', productionMode: 'manual', itemCount: 1, reusedSourceCount: 0,
  providerCallCount: 1, maximumProviderCallCount: 1, maximumMicrousd: 1000000, maximumInputTokens: 30000, maximumOutputTokens: 3000,
  maximumTokens: 128000, sceneContractDigest: 'sha256:' + 'c'.repeat(64), executionContractDigest: 'sha256:' + 'd'.repeat(64),
  expiresAt: '2026-09-13T04:05:00.000Z', bindingHash: 'e'.repeat(64) });

test('Scene mini-app consent needs the exact separate deliberate confirmation, not a preview or legacy two-call approval', () => {
  const original = preview(), captured = parseSceneMiniAppCostPreview(original); assert.ok(captured); assert.ok(Object.isFrozen(captured));
  assert.equal(sceneMiniAppCostApprovalMatches(original, captured, now), false);
  assert.equal(sceneMiniAppCostApprovalMatches({ ...original, confirmed: true }, captured, now), true);
  assert.equal(sceneMiniAppCostApprovalMatches({ ...original, confirmed: false }, captured, now), false);
  for (const patch of [{ version: 'scene-cost-v1' }, { maximumProviderCallCount: 2 }, { maximumMicrousd: 2000000 }, { maximumInputTokens: 125001 }, { model: 'other' }]) {
    assert.equal(parseSceneMiniAppCostPreview({ ...original, ...patch }), null);
    assert.equal(sceneMiniAppCostApprovalMatches({ ...original, ...patch, confirmed: true }, captured, now), false);
  }
});

test('Scene consent refuses every changed original identity, hash, expiry and cap; expiry is exact at the boundary', () => {
  const original = preview();
  for (const key of ['requestId', 'actorUserId', 'projectId', 'documentId', 'permissionEpoch', 'requestHash', 'sourceHash', 'bindingHash', 'sceneContractDigest', 'executionContractDigest', 'expiresAt', 'maximumInputTokens']) {
    const changed = { ...original, [key]: key === 'maximumInputTokens' ? 31000 : key === 'expiresAt' ? '2026-09-13T04:06:00.000Z' : String(original[key]).replace(/.$/, 'f'), confirmed: true };
    assert.equal(sceneMiniAppCostApprovalMatches(changed, original, now), false, key);
  }
  assert.ok(parseSceneMiniAppCostPreview(original));
  assert.equal(sceneMiniAppCostApprovalMatches({ ...original, confirmed: true }, original, Date.parse(original.expiresAt)), false);
  assert.equal(sceneMiniAppCostApprovalMatches({ ...original, confirmed: true }, original, NaN), false);
});

test('Scene consent readers do not invoke getters or retain mutable caller state, and reject extra authority fields', () => {
  const original = preview(), captured = parseSceneMiniAppCostPreview(original); original.maximumInputTokens = 1;
  assert.equal(captured.maximumInputTokens, 30000);
  let called = false; const hostile = { ...preview(), confirmed: true };
  Object.defineProperty(hostile, 'bindingHash', { enumerable: true, get() { called = true; return 'e'.repeat(64); } });
  assert.equal(sceneMiniAppCostApprovalMatches(hostile, preview(), now), false); assert.equal(called, false);
  assert.equal(parseSceneMiniAppCostPreview({ ...preview(), authorized: true }), null);
});

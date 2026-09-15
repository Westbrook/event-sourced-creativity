import test from 'node:test';
import assert from 'node:assert/strict';
import { model3dReplacementSuccessor, model3dReplacementCycleMatches, model3dReplacementCommandKey,
  parseModel3dReplacementPredecessor, model3dMayPrepareReplacement } from '../worker/experience-model3d-replacement.ts';
import { scenePreparationSuccessor, scenePreparationCycleMatches, scenePreparationCommandKey } from '../worker/experience-scene-renewal.ts';

const hash = 'a'.repeat(64), sha = `sha256:${hash}`;
const root = { version: 1, draftId: `experience-draft-${hash}`, draftHash: sha, releaseHash: sha,
  requestHash: sha, sourceBindingHash: sha, output: 'model3d', projectId: 'project-1', documentId: 'document-1', streamId: 'creative:owner-1' };
const receipt = name => ({ key: `experience-output-v1:${hash}:${name}`, eventId: `event-${name}`, digest: hash });
const prior = { slotId: 'slot-1', jobId: `model3d-${hash}`, grantId: 'grant-1', targetId: 'target-1',
  targetContractDigest: hash, sourceDigest: hash, requirementsDigest: hash, providerRequestId: 'fal-original-1', maximumMicrousd: 400000,
  confirmation: { ...receipt('confirm'), planRevisionId: 'plan-1' }, preflight: { ...receipt('preflight'), preflightId: 'preflight-1' },
  authorization: receipt('authorize'), run: receipt('run') };
const eligible = { sourceCurrent: true, custodyCurrent: true, personalOwner: true, evidenceComplete: true, textOnly: true,
  jobFailed: true, parentAttemptOrdinal: 0, parentPreviousSlotId: null, parentSlotStatus: 'uncertain', parentCallCount: 1,
  parentCallStatus: 'uncertain', parentCallUsedMicrousd: null, parentReservedMicrousd: 400000, costReservationActive: true,
  providerAccepted: true, retainedResultCount: 0, activeLeaseCount: 0, successorCount: 0, newMaximumMicrousd: 400000,
  newMaximumCalls: 1, now: Date.parse('2026-09-15T00:00:00.000Z'), retentionExpiresAt: '2026-09-16T00:00:00.000Z' };
test('unpaid 3D quote epochs preserve one replacement and capture immutable inputs before await', async () => {
  const replacementCycle = await model3dReplacementSuccessor(root, prior), binding = { ...root, replacementCycle };
  const predecessor = { ordinal: 0, cycleId: null, confirmation: { ...receipt('child-confirm'), planRevisionId: 'child-plan' },
    preflight: { ...receipt('child-preflight'), preflightId: 'child-preflight' }, sourceDigest: hash, requirementsDigest: hash };
  const expected = await scenePreparationSuccessor(binding, predecessor), supplied = structuredClone(binding), previous = structuredClone(predecessor);
  const pending = scenePreparationSuccessor(supplied, previous);
  supplied.draftId = 'experience-draft-' + 'b'.repeat(64); previous.confirmation.planRevisionId = 'mutated';
  assert.deepEqual(await pending, expected);
  assert.equal(await scenePreparationCycleMatches(binding, predecessor, expected), true);
  for (const phase of ['confirm', 'preflight', 'authorize', 'run']) assert.ok(scenePreparationCommandKey(expected, phase).length <= 160);
  assert.equal(expected.output, 'model3d'); assert.equal(Object.isFrozen(expected.predecessor.confirmation), true);
  await assert.rejects(scenePreparationSuccessor(root, predecessor), 'root original cannot renew as an unpaid replacement');
  let reads = 0;
  const getter = structuredClone(binding); Object.defineProperty(getter, 'replacementCycle', { enumerable: true, get() { reads++; return replacementCycle; } });
  const hidden = structuredClone(predecessor); Object.defineProperty(hidden, 'hidden', { value: true });
  await assert.rejects(scenePreparationSuccessor(getter, predecessor));
  await assert.rejects(scenePreparationSuccessor(binding, hidden));
  await assert.rejects(scenePreparationSuccessor(binding, { ...predecessor, [Symbol('authority')]: true }));
  assert.equal(reads, 0);
});
test('child continuation retains its fixed deadline, not a sliding preparation runway', () => {
  const start = eligible.now, childDeadlineMs = start + 15 * 60000, retentionExpiresAt = new Date(start + 16 * 60000).toISOString();
  assert.equal(model3dMayPrepareReplacement({ ...eligible, retentionExpiresAt }), true);
  assert.equal(model3dMayPrepareReplacement({ ...eligible, now: start + 2 * 60000, retentionExpiresAt }), false);
  assert.equal(model3dMayPrepareReplacement({ ...eligible, now: start + 2 * 60000, retentionExpiresAt, childDeadlineMs }), true);
  for (const change of [{ now: childDeadlineMs }, { childDeadlineMs: NaN }, { childDeadlineMs: start + 17 * 60000 }, { retentionExpiresAt: new Date(childDeadlineMs).toISOString() }])
    assert.equal(model3dMayPrepareReplacement({ ...eligible, retentionExpiresAt, childDeadlineMs, ...change }), false);
});

test('replacement has one deterministic, immutable child identity and no new save phase', async () => {
  const before = JSON.stringify({ root, prior });
  const child = await model3dReplacementSuccessor(root, prior);
  assert.deepEqual(child, await model3dReplacementSuccessor(structuredClone(root), structuredClone(prior)));
  assert.equal(await model3dReplacementCycleMatches(root, child), true);
  assert.equal(Object.isFrozen(child.predecessor.authorization), true);
  assert.equal(child.ordinal, 1);
  assert.equal(JSON.stringify({ root, prior }), before);
  const keys = ['confirm', 'preflight', 'authorize', 'run'].map(stage => model3dReplacementCommandKey(child, stage));
  assert.equal(new Set(keys).size, 4);
  assert.ok(keys.every(key => key.startsWith(`model3d-replace-v1:${hash}:`) && key.length <= 160));
  assert.throws(() => model3dReplacementCommandKey(child, 'save'));
  await assert.rejects(model3dReplacementSuccessor({ ...root, replacementCycle: child }, prior));
  await assert.rejects(model3dReplacementSuccessor({ ...root, preparationCycle: child }, prior));
});
test('caller mutation while hashing cannot change the captured draft identity', async () => {
  const supplied = structuredClone(root), pending = model3dReplacementSuccessor(supplied, prior);
  supplied.draftId = `experience-draft-${'b'.repeat(64)}`;
  const child = await pending;
  assert.equal(child.draftId, root.draftId);
  assert.equal(await model3dReplacementCycleMatches(root, child), true);
});
for (const key of ['slotId', 'jobId', 'grantId', 'targetId', 'targetContractDigest', 'sourceDigest', 'requirementsDigest', 'providerRequestId']) {
  test(`changed predecessor ${key} cannot replay the same child`, async () => {
    const child = await model3dReplacementSuccessor(root, prior);
    const altered = structuredClone(prior);
    altered[key] = key === 'jobId' ? `model3d-${'b'.repeat(64)}` : key.endsWith('Digest') ? 'b'.repeat(64) : 'changed';
    const other = await model3dReplacementSuccessor(root, altered);
    assert.notEqual(other.id, child.id);
    assert.equal(await model3dReplacementCycleMatches(root, { ...child, predecessor: altered }), false);
  });
}
for (const key of ['confirmation', 'preflight', 'authorization', 'run']) {
  test(`changed ${key} receipt invalidates retained child`, async () => {
    const child = await model3dReplacementSuccessor(root, prior);
    const altered = structuredClone(child);
    altered.predecessor[key].digest = 'b'.repeat(64);
    assert.equal(await model3dReplacementCycleMatches(root, altered), false);
  });
}
test('malformed, additional authority, accessor, symbol, inherited and non-enumerable fields fail closed', async () => {
  let reads = 0;
  const getter = { ...prior };
  Object.defineProperty(getter, 'jobId', { enumerable: true, get() { reads++; return prior.jobId; } });
  const hidden = { ...prior };
  Object.defineProperty(hidden, 'jobId', { value: prior.jobId, enumerable: false });
  for (const input of [null, [], {}, { ...prior, maximumMicrousd: 0 }, { ...prior, refund: true }, getter,
    { ...prior, [Symbol('authority')]: true }, hidden, Object.create(prior), { ...prior, run: { ...prior.run, confirmed: true } }]) {
    assert.equal(parseModel3dReplacementPredecessor(input), null);
  }
  assert.equal(reads, 0);
  await assert.rejects(model3dReplacementSuccessor({ ...root, output: 'scene' }, prior));
  await assert.rejects(model3dReplacementSuccessor({ ...root, draftId: 'different' }, prior));
  const child = await model3dReplacementSuccessor(root, prior);
  for (const changed of [{ ...child, ordinal: 2 }, { ...child, approved: true }, { ...child, id: 'b'.repeat(64) }]) {
    assert.equal(await model3dReplacementCycleMatches(root, changed), false);
  }
});
test('exact additional exposure is eligible without claiming original billing settled', () => {
  assert.equal(model3dMayPrepareReplacement(eligible), true);
  assert.equal(eligible.parentReservedMicrousd + eligible.newMaximumMicrousd, 800000);
  assert.equal(eligible.parentCallUsedMicrousd, null);
});
const rejected = {
  sourceCurrent: [false, undefined], custodyCurrent: [false], personalOwner: [false], evidenceComplete: [false], textOnly: [false],
  jobFailed: [false], parentAttemptOrdinal: [1, -1], parentPreviousSlotId: ['slot-other'], parentSlotStatus: ['failed', 'succeeded'],
  parentCallCount: [0, 2], parentCallStatus: ['pending', 'settled'], parentCallUsedMicrousd: [0, 400000], parentReservedMicrousd: [0, 399999, 400001],
  costReservationActive: [false], providerAccepted: [false], retainedResultCount: [1, undefined], activeLeaseCount: [1], successorCount: [1],
  newMaximumMicrousd: [0, 400001], newMaximumCalls: [2], now: [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER],
  retentionExpiresAt: ['bad', '2026-09-15T00:15:00.000Z', '2026-09-15T00:00:00.000Z', '2026-09-16'],
};
for (const [key, values] of Object.entries(rejected)) {
  test(`replacement eligibility rejects changed ${key}`, () => {
    for (const value of values) assert.equal(model3dMayPrepareReplacement({ ...eligible, [key]: value }), false, String(value));
  });
}

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeDocumentJobOriginManifest, decodeDocumentJobOriginManifest } from '../worker/memory-document-job-origin-manifest.ts';

// Syntactic comparison metadata only: these fixed IDs/digests are not a
// published origin, native capture, job capability, ledger body or read grant.
const times = {
  enrolled: '2000-01-01T00:00:00.000Z', old: '1999-12-31T23:59:50.000Z',
  recorded: '2000-01-01T00:00:10.000Z', captured: '2000-01-01T00:00:20.000Z',
  publication: '2000-01-01T00:01:00.000Z', conservative: '2000-01-01T00:40:00.000Z',
  ledgerExpiry: '2000-01-01T00:50:00.000Z', ceiling: '2000-01-01T01:00:00.000Z',
  enrollmentExpiry: '2000-01-01T02:00:00.000Z',
};
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const canonicalText = value => {
  const ordered = item => Array.isArray(item) ? item.map(ordered)
    : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])])) : item;
  return JSON.stringify(ordered(value));
};
const selector = (resource_kind, resource_id) => ({ resource_kind, resource_id });
function common(mode) {
  const contextJson = '{"refs":["comparison-event"],"version":1}';
  return {
    schemaVersion: 1, recipeVersion: 'native-document-job-origin-manifest-v1', mode,
    job: { originId: 'comparison-origin', jobId: 'comparison-job', attemptCount: 1,
      claimSha256: hash('comparison-claim'), requestSha256: hash('comparison-request'),
      inputContentRef: 'comparison-input', inputSha256: hash('comparison-input-hash'),
      sourceHead: 6, projectSourceHead: null },
    enrollment: { enrollment_id: 'comparison-enrollment', actor_user_id: 'comparison-actor', owner_user_id: 'comparison-actor',
      organization_id: null, project_access_id: null, project_id: 'comparison-project', document_id: 'comparison-document',
      revision: 1, policy_version: 'comparison-policy', permission_epoch: 'comparison-epoch',
      enrolled_at: times.enrolled, expires_at: times.enrollmentExpiry, retention_days: 1,
      cursor_sequence: mode === 'extractive' ? 6 : 0 },
    contextJson, consumedValueSha256: hash(contextJson),
    renderer: { recipe: 'document-job-evidence-answer-v1', locale: 'en' },
    lifetime: { capturedAt: times.captured, publicationValidUntil: times.publication, sourceRetentionCeiling: times.ceiling },
  };
}
function extractive() {
  return { ...common('extractive'), dependencies: [{
    ordinal: 0, event_stream_id: 'creative:comparison-actor', event_id: 'comparison-event', source_sequence: 1,
    event_type: 'DocumentOpened', recorded_at: times.recorded, block_id: null, turn_id: null,
    user_content_id: null, assistant_content_id: null, projection_sha256: hash('projection-0'),
    source_retention_ceiling: times.ceiling, consumed: 1,
    segment_enrollment_id: null, segment_revision: null, segment_recipe: null,
    segment_first_sequence: null, segment_last_sequence: null, segment_member_count: null,
    segment_ordinal: null, segment_created_at: null, segment_retention_ceiling: null,
  }] };
}
function segmentManifest() {
  const value = extractive();
  value.dependencies = Array.from({ length: 3 }, (_, index) => ({
    ...value.dependencies[0], ordinal: index, event_id: 'segment-event-' + index,
    source_sequence: 2 + index * 2, event_type: 'AssistantReasoned', turn_id: 'segment-turn-' + index,
    user_content_id: 'segment-user-' + index, assistant_content_id: 'segment-assistant-' + index,
    projection_sha256: hash('segment-projection-' + index), consumed: index === 0 ? 1 : 0,
    segment_enrollment_id: value.enrollment.enrollment_id, segment_revision: value.enrollment.revision,
    segment_recipe: 'live-conversation-references-v1', segment_first_sequence: 2, segment_last_sequence: 6,
    segment_member_count: 3, segment_ordinal: index, segment_created_at: times.captured, segment_retention_ceiling: times.ceiling,
  }));
  return value;
}
function structured(pairCount = 2, revisionCount = 2) {
  const value = common('structured'), ledgerId = hash('comparison-ledger');
  value.job.sourceHead = pairCount * 2;
  value.lifetime.sourceRetentionCeiling = times.conservative;
  const originals = Array.from({ length: pairCount * 2 }, (_, ordinal) => ({
    ordinal, event_stream_id: 'creative:comparison-actor', event_id: 'original-event-' + ordinal,
    source_sequence: ordinal + 1, event_type: ordinal % 2 === 0 ? 'ChatMessageSent' : 'AssistantReasoned',
    role: ordinal % 2 === 0 ? 'user' : 'assistant', turn_id: 'original-turn-' + Math.floor(ordinal / 2),
    content_id: 'original-body-' + ordinal, content_sha256: hash('original-content-' + ordinal),
    projection_sha256: hash('original-projection-' + ordinal), recorded_at: ordinal < 2 ? times.old : times.recorded,
    source_retention_ceiling: times.ceiling, retained_by_ledger: ordinal < 2 ? 0 : 1,
    presented_in_context: ordinal < 2 ? 1 : 0,
  }));
  const ledgerRevisions = Array.from({ length: revisionCount }, (_, ordinal) => ({
    ordinal, ledger_id: ledgerId, storage_revision: ordinal + 1, predecessor_revision: ordinal,
    predecessor_hash: ordinal === 0 ? null : hash('ledger-body-hash-' + (ordinal - 1)),
    body_ref: 'ledger-body-' + ordinal, body_hash: hash('ledger-body-hash-' + ordinal),
    created_at: times.recorded, expires_at: times.ledgerExpiry,
  }));
  const last = ledgerRevisions.at(-1);
  return { ...value, projectionOptions: { maxBytes: 16_384, specifiedMaxBytes: false },
    intervals: [{ afterSequence: 0, throughSequence: pairCount * 2 }], originals, ledgerRevisions,
    ledgerHead: { ledgerId, revision: revisionCount, bodyRef: last.body_ref, bodyHash: last.body_hash } };
}

test('job origin manifest: canonical roundtrip uses independent digests and immutable material', async () => {
  const value = extractive(), before = JSON.stringify(value), expectedText = canonicalText(value);
  const expectedSelectors = [selector('enrollment', 'comparison-enrollment'), selector('event', 'comparison-event')];
  const material = await encodeDocumentJobOriginManifest(value);
  assert.ok(material);
  assert.equal(material.text, expectedText);
  assert.equal(material.sha256, hash(expectedText));
  assert.deepEqual(material.selectors, expectedSelectors);
  assert.equal(material.selectorListSha256, hash(JSON.stringify(expectedSelectors)));
  assert.equal(JSON.stringify(value), before, 'Encoding must not mutate caller-owned comparison metadata');
  assert.ok(Object.isFrozen(material)); assert.ok(Object.isFrozen(material.selectors));
  for (const row of material.selectors) assert.ok(Object.isFrozen(row));
  assert.throws(() => { material.text = 'changed'; }, TypeError);
  assert.throws(() => { material.selectors[0].resource_id = 'changed'; }, TypeError);
  assert.throws(() => material.selectors.push(selector('event', 'changed')), TypeError);
  const decoded = await decodeDocumentJobOriginManifest(material.text);
  assert.deepEqual(decoded, material); assert.notEqual(decoded, material);
  const reverse = Object.fromEntries(Object.entries(value).reverse());
  assert.equal((await encodeDocumentJobOriginManifest(reverse)).text, expectedText);
});

test('job origin manifest: operational fields, accessors, holes and noncanonical duplicate keys fail closed', async () => {
  for (const mutate of [
    value => { value.enrollment.leaseId = 'OPERATIONAL_LEASE_MUST_NOT_BE_STORED'; },
    value => { value.readLease = { validUntil: times.publication }; },
    value => { value.job.unknown = true; },
    value => { delete value.dependencies[0]; },
    value => { value.dependencies.extra = true; },
    value => { value[Symbol('hidden')] = true; },
    value => { value.dependencies[0].consumed = Number.NaN; },
  ]) {
    const value = extractive(); mutate(value);
    assert.equal(await encodeDocumentJobOriginManifest(value), null);
  }
  let getterCalls = 0, toJsonCalls = 0;
  const accessor = extractive();
  Object.defineProperty(accessor, 'contextJson', { enumerable: true, get() { getterCalls++; throw new Error('getter invoked'); } });
  assert.equal(await encodeDocumentJobOriginManifest(accessor), null); assert.equal(getterCalls, 0);
  const withToJson = extractive();
  withToJson.toJSON = () => { toJsonCalls++; return extractive(); };
  assert.equal(await encodeDocumentJobOriginManifest(withToJson), null); assert.equal(toJsonCalls, 0);
  const material = await encodeDocumentJobOriginManifest(extractive()); assert.ok(material);
  const text = material.text;
  const noncanonical = [
    ' ' + text,
    text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    text.replace('"schemaVersion":1', String.raw`"schemaVersion":1,"\u0073chemaVersion":1`),
    text.replace('"jobId":"comparison-job"', '"jobId":"comparison-job","jobId":"comparison-job"'),
    text.replace('"revision":1', '"revision":1,"revision":1'),
    text.replace('"consumed":1', '"consumed":1,"consumed":1'),
  ];
  for (const raw of noncanonical) {
    assert.notEqual(raw, text, 'Every duplicate/noncanonical fixture must actually change the wire text');
    assert.equal(await decodeDocumentJobOriginManifest(raw), null);
  }
});

test('job origin manifest: caller mutation during a delegated crypto await cannot change captured material', { timeout: 5_000 }, async t => {
  const value = segmentManifest(), before = canonicalText(value);
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  let enter, release, calls = 0;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  t.mock.method(crypto.subtle, 'digest', async (...args) => {
    if (++calls === 1) { enter(); await gate; }
    return nativeDigest(...args);
  });
  let pending;
  try {
    pending = encodeDocumentJobOriginManifest(value);
    await Promise.race([entered, pending.then(() => { throw new Error('Encoder did not reach the delegated crypto await'); })]);
    value.job.jobId = 'MUTATED_JOB';
    value.dependencies[1].event_id = 'MUTATED_UNCONSUMED_EVENT';
    value.dependencies.splice(0, 1);
    value.contextJson = '{"changed":true}';
    release();
    const material = await pending; assert.ok(material); assert.ok(calls > 0);
    assert.equal(value.job.jobId, 'MUTATED_JOB');
    assert.equal(material.text, before); assert.equal(material.sha256, hash(before));
    assert.ok(material.selectors.some(row => row.resource_kind === 'event' && row.resource_id === 'segment-event-1'));
    assert.ok(!material.selectors.some(row => row.resource_id === 'MUTATED_UNCONSUMED_EVENT'));
  } finally { release(); if (pending) await pending; t.mock.restoreAll(); }
});

test('job origin manifest: full segment membership includes unconsumed sources and rejects gaps or tampering', async () => {
  const value = segmentManifest(), material = await encodeDocumentJobOriginManifest(value); assert.ok(material);
  const expectedSelectors = [selector('enrollment', 'comparison-enrollment'),
    ...[0, 1, 2].map(index => selector('event', 'segment-event-' + index)),
    ...[0, 1, 2].map(index => selector('private-content', 'segment-assistant-' + index)),
    ...[0, 1, 2].map(index => selector('private-content', 'segment-user-' + index))];
  assert.deepEqual(material.selectors, expectedSelectors);
  assert.equal(material.selectorListSha256, hash(JSON.stringify(expectedSelectors)));
  assert.equal(JSON.parse(material.text).dependencies[1].consumed, 0);
  for (const mutate of [
    data => { data.dependencies.splice(1, 1); data.dependencies.forEach((row, index) => { row.ordinal = index; }); },
    data => { data.dependencies[1].segment_ordinal = 0; },
    data => { data.dependencies[1].segment_member_count = 2; },
    data => { data.dependencies[1].segment_retention_ceiling = times.enrollmentExpiry; },
    data => { data.dependencies[1].event_id = data.dependencies[0].event_id; },
    data => { data.dependencies.forEach(row => { row.consumed = 0; }); },
    data => { data.dependencies[0].projection_sha256 = 'not-a-digest'; },
  ]) {
    const changed = segmentManifest(); mutate(changed);
    assert.equal(await encodeDocumentJobOriginManifest(changed), null);
  }
  const notSegmented = extractive(); notSegmented.dependencies[0].consumed = 0;
  assert.equal(await encodeDocumentJobOriginManifest(notSegmented), null);
});

test('job origin manifest: structured zero cursor preserves old unretained pairs, ledger chain and conservative ceiling', async () => {
  const value = structured(), material = await encodeDocumentJobOriginManifest(value); assert.ok(material);
  const decoded = JSON.parse(material.text);
  assert.equal(decoded.enrollment.cursor_sequence, 0);
  assert.ok(Date.parse(decoded.originals[0].recorded_at) < Date.parse(decoded.enrollment.enrolled_at));
  assert.deepEqual(decoded.originals.map(row => row.retained_by_ledger), [0, 0, 1, 1]);
  assert.deepEqual(decoded.originals.map(row => row.presented_in_context), [1, 1, 0, 0]);
  assert.equal(decoded.lifetime.sourceRetentionCeiling, times.conservative);
  assert.ok(Date.parse(times.conservative) < Date.parse(decoded.ledgerRevisions[1].expires_at));
  assert.deepEqual(await decodeDocumentJobOriginManifest(material.text), material);
  const inventory = structured();
  inventory.intervals = [{ afterSequence: 2, throughSequence: 4 },
    { afterSequence: 0, throughSequence: 4 }];
  const inventoryMaterial = await encodeDocumentJobOriginManifest(inventory); assert.ok(inventoryMaterial);
  assert.deepEqual(JSON.parse(inventoryMaterial.text).intervals, inventory.intervals,
    'Valid captured intervals remain in their original order, including overlapping coverage');
  assert.deepEqual(inventoryMaterial.selectors, material.selectors);
  for (const mutate of [
    data => { data.originals[0].retained_by_ledger = 1; },
    data => { data.originals.pop(); },
    data => { data.originals[1].turn_id = 'unpaired-turn'; },
    data => { data.originals[1].role = 'user'; data.originals[1].event_type = 'ChatMessageSent'; },
    data => { data.originals[0].presented_in_context = true; },
    data => { data.originals[3].retained_by_ledger = 2; },
    data => { data.originals.forEach(row => { row.retained_by_ledger = 0; }); },
    data => { data.intervals[0].afterSequence = 1; },
    data => { data.intervals[0].afterSequence = -1; },
    data => { data.intervals[0].afterSequence = data.intervals[0].throughSequence; },
    data => { data.intervals[0].throughSequence = data.job.sourceHead + 1; },
    data => { data.ledgerRevisions.pop(); },
    data => { data.ledgerRevisions[1].predecessor_hash = hash('wrong-predecessor'); },
    data => { data.ledgerHead.bodyHash = hash('wrong-head'); },
    data => { data.projectionOptions.maxBytes = 100; },
    data => { data.lifetime.sourceRetentionCeiling = times.ceiling; },
  ]) {
    const changed = structured(); mutate(changed);
    assert.equal(await encodeDocumentJobOriginManifest(changed), null);
  }
});

test('job origin manifest: exact UTF-8 budgets, context hashes and historical leases never truncate or renew', async () => {
  const value = extractive(), material = await encodeDocumentJobOriginManifest(value); assert.ok(material);
  assert.ok(Date.parse(times.publication) < Date.now(), 'This comparison fixture has a historical publication lease');
  const historical = await decodeDocumentJobOriginManifest(material.text); assert.ok(historical);
  assert.equal(JSON.parse(historical.text).lifetime.publicationValidUntil, times.publication);
  assert.equal(historical.sha256, material.sha256);
  const staleHash = extractive(); staleHash.contextJson = '{"refs":["tampered-event"],"version":1}';
  assert.equal(await encodeDocumentJobOriginManifest(staleHash), null);
  assert.equal(await decodeDocumentJobOriginManifest(canonicalText(staleHash)), null);
  const shellBytes = Buffer.byteLength(JSON.stringify({ label: '' }), 'utf8');
  const available = 16_384 - shellBytes;
  const exactContext = JSON.stringify({ label: 'é'.repeat(Math.floor(available / 2)) + 'x'.repeat(available % 2) });
  assert.equal(Buffer.byteLength(exactContext, 'utf8'), 16_384);
  const bounded = extractive(); bounded.contextJson = exactContext; bounded.consumedValueSha256 = hash(exactContext);
  const boundedMaterial = await encodeDocumentJobOriginManifest(bounded); assert.ok(boundedMaterial);
  assert.ok(Buffer.byteLength(boundedMaterial.text, 'utf8') <= 65_536);
  const overflowContext = JSON.stringify({ label: JSON.parse(exactContext).label + 'é' });
  assert.ok(overflowContext.length <= 16_384); assert.equal(Buffer.byteLength(overflowContext, 'utf8'), 16_386);
  bounded.contextJson = overflowContext; bounded.consumedValueSha256 = hash(overflowContext);
  assert.equal(await encodeDocumentJobOriginManifest(bounded), null);
  const large = structured(64, 64), largeText = canonicalText(large);
  // Do not claim a >256-selector positive fits the manifest byte ceiling.
  // This complete, bounded-count fixture's actual literal serialization is too large.
  const distinct = new Set([JSON.stringify(['enrollment', large.enrollment.enrollment_id]),
    ...large.originals.flatMap(row => [JSON.stringify(['event', row.event_id]), JSON.stringify(['private-content', row.content_id])]),
    ...large.ledgerRevisions.flatMap(row => [JSON.stringify(['ledger', row.ledger_id]), JSON.stringify(['private-content', row.body_ref])])]);
  assert.equal(large.originals.length, 128); assert.equal(large.ledgerRevisions.length, 64);
  assert.equal(distinct.size, 322); assert.ok(distinct.size <= 513);
  assert.ok(Buffer.byteLength(largeText, 'utf8') > 65_536, 'Overflow is measured from complete literal metadata, not an assumed selector count');
  assert.equal(await encodeDocumentJobOriginManifest(large), null);
  assert.equal(await decodeDocumentJobOriginManifest(largeText), null);
  for (const mutate of [
    data => { data.lifetime.publicationValidUntil = data.lifetime.capturedAt; },
    data => { data.lifetime.publicationValidUntil = '2000-01-01T00:01:20.001Z'; },
    data => { data.lifetime.sourceRetentionCeiling = times.conservative; },
  ]) {
    const changed = extractive(); mutate(changed);
    assert.equal(await encodeDocumentJobOriginManifest(changed), null);
  }
});

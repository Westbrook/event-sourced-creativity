import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validateDocumentJobOriginRecord } from '../worker/memory-document-job-origin-record.ts';

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

function recordFixture(value = extractive()) {
  // Independently construct comparison rows and hashes; no encoder or database
  // manufactures these expectations, and the rows do not assert publication.
  const resourcePairs = [['enrollment', value.enrollment.enrollment_id]];
  if (value.mode === 'extractive') {
    for (const row of value.dependencies) {
      resourcePairs.push(['event', row.event_id]);
      for (const ref of [row.user_content_id, row.assistant_content_id])
        if (ref !== null) resourcePairs.push(['private-content', ref]);
    }
  } else {
    for (const row of value.originals) resourcePairs.push(['event', row.event_id], ['private-content', row.content_id]);
    for (const row of value.ledgerRevisions) resourcePairs.push(['ledger', row.ledger_id], ['private-content', row.body_ref]);
  }
  const resourceKeys = [...new Set(resourcePairs.map(pair => JSON.stringify(pair)))].sort();
  const expectedSelectors = resourceKeys.map(key => { const [kind, id] = JSON.parse(key); return selector(kind, id); });
  const text = canonicalText(value), e = value.enrollment;
  const header = {
    origin_id: value.job.originId, schema_version: 1, recipe_version: 'native-document-job-answer-origin-v1',
    actor_user_id: e.actor_user_id, scope_key: JSON.stringify([e.organization_id ?? '', e.project_access_id ?? '', e.project_id, e.document_id]),
    job_id: value.job.jobId, turn_id: 'publication-turn', user_event_id: 'publication-user-event',
    user_content_id: 'publication-user-body', answer_event_id: 'publication-answer-event',
    answer_content_id: 'publication-answer-body', manifest_content_ref: 'publication-manifest-body',
    owner_user_id: e.owner_user_id, stream_id: 'creative:' + e.owner_user_id,
    organization_id: e.organization_id, project_access_id: e.project_access_id, project_id: e.project_id, document_id: e.document_id,
    attempt_count: value.job.attemptCount, correlation_id: 'publication-correlation',
    request_sha256: value.job.requestSha256, claim_sha256: value.job.claimSha256,
    input_content_ref: value.job.inputContentRef, input_sha256: value.job.inputSha256,
    input_expires_at: times.ceiling, job_requested_at: '2000-01-01T00:00:05.000Z',
    job_started_at: '2000-01-01T00:00:15.000Z', job_lease_expires_at: times.publication, job_expires_at: times.ceiling,
    requested_sequence: 0, source_head: value.job.sourceHead, project_source_head: value.job.projectSourceHead,
    user_source_sequence: value.job.sourceHead + 1, user_sha256: value.job.inputSha256,
    answer_source_sequence: value.job.sourceHead + 2, answer_sha256: hash('comparison-answer-not-supplied'),
    answer_expires_at: times.conservative, mode: value.mode, renderer_recipe: value.renderer.recipe, locale: value.renderer.locale,
    enrollment_id: e.enrollment_id, enrollment_revision: e.revision, permission_epoch: e.permission_epoch,
    policy_version: e.policy_version, enrolled_at: e.enrolled_at, enrollment_expires_at: e.expires_at,
    retention_days: e.retention_days, selection_cursor: e.cursor_sequence, consumed_value_sha256: value.consumedValueSha256,
    source_count: value.mode === 'extractive' ? value.dependencies.length : value.originals.length,
    ledger_revision_count: value.mode === 'extractive' ? 0 : value.ledgerRevisions.length,
    selector_count: expectedSelectors.length, selector_list_sha256: hash(JSON.stringify(expectedSelectors)),
    manifest_sha256: hash(text), manifest_expires_at: value.lifetime.sourceRetentionCeiling,
    proof_valid_until: value.lifetime.publicationValidUntil, source_retention_ceiling: value.lifetime.sourceRetentionCeiling,
    created_at: '2000-01-01T00:00:25.000Z', status: 'active', withdrawn_at: null, withdrawal_reason: null,
  };
  return { value, text, header, expectedSelectors,
    rows: expectedSelectors.map(row => ({ origin_id: header.origin_id, ...row })) };
}
const compare = fixture => validateDocumentJobOriginRecord(fixture.header, fixture.text, fixture.rows);
const moved = (time, milliseconds) => new Date(Date.parse(time) + milliseconds).toISOString();

test('job origin record: independent extractive and structured rows compare with the complete shuffled selector set', async () => {
  const shared = structured();
  Object.assign(shared.enrollment, { owner_user_id: 'comparison-owner', organization_id: 'comparison-organization', project_access_id: 'comparison-access' });
  shared.job.projectSourceHead = 8;
  for (const row of shared.originals) row.event_stream_id = 'creative:comparison-owner';
  for (const value of [extractive(), segmentManifest(), structured(), shared]) {
    const fixture = recordFixture(value), before = structuredClone(fixture);
    fixture.rows.reverse();
    const result = await compare(fixture); assert.ok(result);
    assert.equal(Object.keys(result.header).length, 61);
    assert.deepEqual({ ...result.header }, before.header);
    assert.equal(result.manifest.text, canonicalText(value));
    assert.equal(result.manifest.sha256, hash(canonicalText(value)));
    assert.deepEqual(result.manifest.selectors, fixture.expectedSelectors);
    assert.equal(result.manifest.selectorListSha256, hash(JSON.stringify(fixture.expectedSelectors)));
    assert.deepEqual(fixture.header, before.header);
    assert.deepEqual(fixture.rows, before.rows.reverse(), 'Caller row order remains untouched');
  }
  const fixture = recordFixture();
  assert.deepEqual(fixture.expectedSelectors, [selector('enrollment', 'comparison-enrollment'), selector('event', 'comparison-event')]);
  fixture.header.user_content_id = fixture.header.input_content_ref;
  assert.ok(await compare(fixture), 'The original job input may be the published user body');
  // A well-formed output digest alone is not checked against answer bytes here:
  // actual job/body equality and deterministic rendering remain caller obligations.
  fixture.header.answer_sha256 = hash('different-answer-still-requires-native-comparison');
  assert.ok(await compare(fixture));
  const reusedInput = segmentManifest();
  reusedInput.job.inputContentRef = reusedInput.dependencies[1].user_content_id;
  assert.ok(await compare(recordFixture(reusedInput)),
    'A separately bound job input may also be a prior private source; native proof remains external');
});

test('job origin record: closed bounded data rejects unknown fields accessors sparse arrays and hooks before crypto', async t => {
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  let cryptoCalls = 0, getterCalls = 0, hookCalls = 0;
  t.mock.method(crypto.subtle, 'digest', (...args) => { cryptoCalls++; return nativeDigest(...args); });
  try {
    const mutations = [
      f => { f.header.extra = null; },
      f => { f.header[Symbol('unknown')] = null; },
      f => { Object.setPrototypeOf(f.header, { inherited: true }); },
      f => { Object.defineProperty(f.header, 'job_id', { enumerable: false, value: f.header.job_id }); },
      f => { Object.defineProperty(f.header, 'job_id', { enumerable: true, get() { getterCalls++; return 'comparison-job'; } }); },
      f => { f.header.toJSON = () => { hookCalls++; return {}; }; },
      f => { f.header.origin_id = 'x'.repeat(241); },
      f => { f.header.scope_key = 'x'.repeat(8193); },
      f => { f.header.correlation_id = '\ud800'; },
      f => { f.header.source_head = Number.NaN; },
      f => { f.header.attempt_count = Number.MAX_SAFE_INTEGER + 1; },
      f => { f.rows = []; },
      f => { f.rows = new Array(2); },
      f => { f.rows = Array.from({ length: 514 }, () => ({ ...f.rows[0] })); },
      f => { delete f.rows[0]; },
      f => { f.rows.extra = null; },
      f => { Object.setPrototypeOf(f.rows, null); },
      f => { Object.defineProperty(f.rows, '0', { enumerable: true, get() { getterCalls++; return {}; } }); },
      f => { f.rows[0].extra = null; },
      f => { Object.defineProperty(f.rows[0], 'resource_id', { enumerable: true, get() { getterCalls++; return 'comparison-enrollment'; } }); },
      f => { f.rows[0].resource_id = { toJSON() { hookCalls++; return 'comparison-enrollment'; } }; },
      f => { f.text = { toString() { hookCalls++; return ''; }, toJSON() { hookCalls++; return {}; } }; },
      f => { f.text = 'é'.repeat(32_769); assert.equal(Buffer.byteLength(f.text), 65_538); },
    ];
    for (const mutate of mutations) {
      const fixture = recordFixture(); mutate(fixture);
      assert.equal(await compare(fixture), null);
    }
    for (const key of Object.keys(recordFixture().header)) {
      const fixture = recordFixture(); delete fixture.header[key];
      assert.equal(await compare(fixture), null, 'Missing required header column: ' + key);
    }
    assert.equal(cryptoCalls, 0); assert.equal(getterCalls, 0); assert.equal(hookCalls, 0);
  } finally { t.mock.restoreAll(); }
  assert.ok(await compare(recordFixture()), 'Malformed inputs do not poison a later ordinary comparison');
});

test('job origin record: every manifest-bound header value digest and declared count must agree', async () => {
  const bound = [
    'origin_id', 'job_id', 'attempt_count', 'request_sha256', 'claim_sha256', 'input_content_ref', 'input_sha256',
    'source_head', 'project_source_head', 'actor_user_id', 'owner_user_id', 'organization_id', 'project_access_id',
    'project_id', 'document_id', 'enrollment_id', 'enrollment_revision', 'permission_epoch', 'policy_version',
    'enrolled_at', 'enrollment_expires_at', 'retention_days', 'selection_cursor', 'mode', 'renderer_recipe', 'locale',
    'consumed_value_sha256', 'source_retention_ceiling', 'proof_valid_until', 'source_count', 'ledger_revision_count',
    'selector_count', 'selector_list_sha256', 'manifest_sha256',
  ];
  for (const make of [extractive, structured]) {
    const control = recordFixture(make()); assert.ok(await compare(control));
    for (const key of bound) {
      const fixture = recordFixture(make()), original = fixture.header[key];
      fixture.header[key] = typeof original === 'number' ? original + 1
        : original === null ? 'not-null'
        : key.endsWith('sha256') ? hash('different-' + key)
        : key === 'locale' ? 'fr' : original + '-changed';
      assert.notEqual(fixture.header[key], original);
      assert.equal(await compare(fixture), null, 'Mismatched bound header column: ' + key);
    }
  }
  for (const key of ['request_sha256', 'claim_sha256', 'input_sha256', 'user_sha256', 'answer_sha256',
    'consumed_value_sha256', 'selector_list_sha256', 'manifest_sha256']) {
    const fixture = recordFixture(); fixture.header[key] = 'G'.repeat(64);
    assert.equal(await compare(fixture), null, 'Malformed digest column: ' + key);
  }
  for (const mutate of [
    f => { f.header.schema_version = 2; },
    f => { f.header.recipe_version = 'unknown-recipe'; },
    f => { f.header.status = 'withdrawn'; f.header.withdrawn_at = times.publication; f.header.withdrawal_reason = 'manual'; },
    f => { f.header.status = 'minimized'; },
    f => { f.header.withdrawn_at = times.publication; },
    f => { f.header.withdrawal_reason = 'manual'; },
    f => { f.header.user_sha256 = hash('not-the-input-digest'); },
    f => { f.header.user_source_sequence++; },
    f => { f.header.answer_source_sequence++; },
    f => { f.header.requested_sequence = f.header.source_head + 1; },
    f => { f.header.stream_id = 'creative:someone-else'; },
    f => { f.text = f.text.replace('"comparison-job"', '"tampered-job"'); },
    f => { f.text = ' ' + f.text; },
  ]) {
    const fixture = recordFixture(); mutate(fixture); assert.equal(await compare(fixture), null);
  }
});

test('job origin record: omissions extras duplicate selectors wrong origins and identity collisions never compare', async () => {
  for (const make of [segmentManifest, structured]) {
    const control = recordFixture(make()); assert.ok(await compare(control));
    for (const mutate of [
      f => { f.rows.pop(); },
      f => { f.rows.pop(); f.header.selector_count--; },
      f => { f.rows.push({ origin_id: f.header.origin_id, resource_kind: 'event', resource_id: 'extra-source' }); f.header.selector_count++; },
      f => { f.rows[1] = { ...f.rows[0] }; },
      f => { f.rows[0].origin_id = 'wrong-origin'; },
      f => { f.rows[0].resource_kind = 'content'; },
      f => { f.rows[0].resource_id = 'different-resource'; },
    ]) {
      const fixture = recordFixture(make()); mutate(fixture); assert.equal(await compare(fixture), null);
    }
    const own = ['user_event_id', 'answer_event_id', 'user_content_id', 'answer_content_id', 'manifest_content_ref'];
    for (let left = 0; left < own.length; left++) for (let right = left + 1; right < own.length; right++) {
      const fixture = recordFixture(make()); fixture.header[own[right]] = fixture.header[own[left]];
      assert.equal(await compare(fixture), null, 'Published identities must be distinct: ' + own[left] + '/' + own[right]);
    }
    const originalRefs = control.expectedSelectors.filter(row => ['event', 'private-content'].includes(row.resource_kind));
    for (const key of own) for (const source of originalRefs) {
      const fixture = recordFixture(make()); fixture.header[key] = source.resource_id;
      assert.equal(await compare(fixture), null, 'A published identity must not reuse a retained source: ' + key + '/' + source.resource_kind);
    }
  }
  for (const field of ['answer_content_id', 'manifest_content_ref']) {
    const value = extractive(); value.job.inputContentRef = recordFixture().header[field];
    const fixture = recordFixture(value);
    assert.equal(await compare(fixture), null, 'The input cannot be the answer or manifest body');
  }
});

test('job origin record: captured and published chronology retains original ceilings without renewing historical proof', async () => {
  const fixture = recordFixture(structured()), result = await compare(fixture); assert.ok(result);
  assert.ok(Date.parse(result.header.proof_valid_until) < Date.now());
  assert.equal(result.header.proof_valid_until, times.publication);
  assert.equal(result.header.source_retention_ceiling, times.conservative);
  assert.equal(JSON.parse(result.manifest.text).lifetime.capturedAt, times.captured);
  const sameInstant = recordFixture(structured()); sameInstant.header.created_at = times.captured;
  assert.ok(await compare(sameInstant), 'Capture and publication may share the same timestamp');
  const changes = [
    h => { h.job_requested_at = moved(h.job_started_at, 1); },
    h => { h.job_started_at = moved(h.created_at, 1); },
    h => { h.created_at = moved(times.captured, -1); },
    h => { h.created_at = h.proof_valid_until; },
    h => { h.job_lease_expires_at = moved(h.proof_valid_until, -1); },
    h => { h.input_expires_at = moved(h.proof_valid_until, -1); },
    h => { h.job_expires_at = moved(h.proof_valid_until, -1); },
    h => { h.answer_expires_at = h.created_at; },
    h => { h.answer_expires_at = moved(h.manifest_expires_at, 1); },
    h => { h.manifest_expires_at = moved(h.source_retention_ceiling, 1); },
    h => { h.input_expires_at = moved(h.manifest_expires_at, -1); },
    h => { h.job_expires_at = moved(h.manifest_expires_at, -1); },
    h => { h.enrollment_expires_at = moved(h.source_retention_ceiling, -1); },
    h => { h.job_requested_at = '2000-01-01T00:00:05Z'; },
  ];
  for (const mutate of changes) {
    const changed = recordFixture(structured()); mutate(changed.header);
    assert.equal(await compare(changed), null);
  }
  const beforeEnrollment = extractive(); beforeEnrollment.dependencies[0].recorded_at = times.old;
  assert.equal(await compare(recordFixture(beforeEnrollment)), null);
  const outlivedSource = structured();
  outlivedSource.originals[2].source_retention_ceiling = times.captured;
  assert.equal(await compare(recordFixture(outlivedSource)), null);
  const validHistorical = await compare(recordFixture(structured())); assert.ok(validHistorical);
  assert.equal(validHistorical.header.proof_valid_until, times.publication);
  // None of these historical matches is current access, fresh enrollment, job
  // custody, answer-body equality or a native replay certificate. Null is not fallback.
});

test('job origin record: delegated crypto awaits own header and selector rows and return frozen isolated output', { timeout: 5_000 }, async t => {
  const fixture = recordFixture(segmentManifest()), before = structuredClone(fixture);
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
    pending = compare(fixture);
    await Promise.race([entered, pending.then(() => { throw new Error('Record comparison did not reach real delegated crypto'); })]);
    fixture.header.job_id = 'MUTATED_JOB';
    fixture.header.answer_sha256 = hash('MUTATED_ANSWER');
    fixture.rows[0].resource_id = 'MUTATED_SELECTOR';
    fixture.rows.pop(); fixture.text = '{}';
    release();
    const result = await pending; assert.ok(result); assert.ok(calls > 0);
    assert.equal(fixture.header.job_id, 'MUTATED_JOB'); assert.equal(fixture.rows[0].resource_id, 'MUTATED_SELECTOR');
    assert.deepEqual({ ...result.header }, before.header);
    assert.equal(result.manifest.text, before.text); assert.equal(result.manifest.sha256, hash(before.text));
    assert.deepEqual(result.manifest.selectors, before.expectedSelectors);
    assert.notEqual(result.header, fixture.header); assert.equal(Object.getPrototypeOf(result.header), null);
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.header));
    assert.ok(Object.isFrozen(result.manifest)); assert.ok(Object.isFrozen(result.manifest.selectors));
    assert.ok(result.manifest.selectors.every(row => Object.isFrozen(row)));
    assert.throws(() => { result.header.job_id = 'changed'; }, TypeError);
    assert.throws(() => { result.manifest.selectors[0].resource_id = 'changed'; }, TypeError);
    assert.throws(() => result.manifest.selectors.push(selector('event', 'changed')), TypeError);
  } finally { release(); if (pending) await pending; t.mock.restoreAll(); }
});

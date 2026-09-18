import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotedFixture, authorize, prepareGuestImageAuthorization, issueGuestImageGrant, readGuestImageIssuance,
  receiptAssertions, issuanceBatch, interceptIssuance, assertNoExecution, issuerTables, request, rows, snapshot, changes,
  nativeEvents, unchangedExcept, insert, digest, canonicalJson, contextBytes, payer, origin } from './helpers/guest-image-issuer-fixture.mjs';
import { enforceD1ExpressionDepth } from './helpers/d1-expression-depth.mjs';
const [{ readGuestImagePreflight }, { compileGuestSponsorEnvelope }, { compileSponsorEnvelope }, { prepareSponsorEntitlement },
  { authoritativeCreativeContext }, { guestImageStageQuoteRecipe }] = await Promise.all([
  import('../worker/experience-guest-image-preflight.ts'), import('../worker/experience-guest-sponsor-contract.ts'),
  import('../worker/experience-sponsor-policy.ts'), import('../worker/experience-sponsor-entitlement.ts'), import('../worker/context-authority.ts'),
  import('../worker/experience-guest-image-stage-contract.ts'),
]);

async function issued(f) { const auth = await authorize(f); return { ...auth, result: await issueGuestImageGrant(f.request, f.env, auth.authority) }; }
function exactTriple(f) {
  return { grant: rows(f, 'experience_sponsor_grants')[0], issuance: rows(f, 'experience_sponsor_issuances')[0],
    resource: rows(f, 'experience_sponsor_resource_receipts').find(row => row.operation === 'issuance') };
}
function replaceTriple(f, transform) {
  // Adversarial retained-state setup only. Restore the exact immutable schema
  // before any application call; malformed retained rows are never authority.
  const triggers = f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name IN('experience_sponsor_issuances','experience_sponsor_resource_receipts')").all();
  f.sqlite.exec('PRAGMA foreign_keys=OFF');
  try {
    for (const row of triggers) f.sqlite.exec(`DROP TRIGGER "${row.name}"`);
    transform();
  } finally { for (const row of triggers) f.sqlite.exec(row.sql); f.sqlite.exec('PRAGMA foreign_keys=ON'); }
}

for (const memory of [false, true]) test(`genuine guest issuer commits exactly three rows with ${memory ? 'complete' : 'absent'} Memory and strict D1 SQL limits`, async t => {
  const f = await quotedFixture(t, { memory }), before = snapshot(f);
  const limits = enforceD1ExpressionDepth(f, { queryLimits: { functionArguments: 32, parameters: 100, sqlBytes: 100000 } });
  try {
    const { input, result, authority } = await issued(f); receiptAssertions(f, result);
    const { grant, issuance, resource } = exactTriple(f), envelope = JSON.parse(issuance.envelope_json);
    assert.equal(rows(f, 'experience_sponsor_grants').length, 1); assert.equal(rows(f, 'experience_sponsor_issuances').length, 1);
    assert.equal(rows(f, 'experience_sponsor_resource_receipts').length, 4);
    assert.equal(grant.actor_user_id, f.session.guestSubject); assert.equal(grant.enabled, 1);
    assert.equal(grant.grant_id, result.grantId); assert.equal(resource.issued_grant_id, result.grantId);
    assert.equal(resource.text_bytes, contextBytes(f)); assert.equal(issuance.driver_command_json, rows(f, 'experience_sponsor_driver_intents')[0].command_json);
    assert.equal(JSON.parse(issuance.driver_command_json).action, 'run-guest-sponsored-image');
    assert.equal(issuance.command_digest, await digest(input.authorization)); assert.equal(issuance.command_digest, envelope.guestAuthorizationDigest);
    assert.equal(issuance.envelope_digest, await digest(envelope)); assert.equal(issuance.envelope_json, canonicalJson(envelope));
    assert.equal(envelope.sourceRevision, f.committed.head + 3); assert.equal(rows(f, 'output_plan_revisions')[0].source_head, f.committed.head + 1);
    assert.equal(nativeEvents(f).at(-1).sequence, f.committed.head + 3);
    const session = rows(f, 'experience_guest_sessions')[0], quoteEvent = nativeEvents(f).find(event => event.type === 'OutputPlanPreflighted');
    const nativeRecipe = await guestImageStageQuoteRecipe({ target: f.confirmed.plan.targets[0], releaseRevision: f.release.definition.revision,
      releaseHash: f.release.releaseHash, approvedTemplate: f.compiled.policy.templates[0] }, f.quoted.preflight.targets[0], quoteEvent.payload.guest_sponsor_quote_transport);
    assert.deepEqual(envelope.recipe, nativeRecipe, 'envelope retains the exact native recipe, settings and transport commitment');
    const sessionBinding = { domain: 'forma-sponsor-guest-session@1', sessionId: session.session_id, guestSubject: session.guest_subject,
      projectId: session.project_id, documentId: session.document_id, sessionPolicyId: session.policy_id,
      sessionTermsDigest: session.terms_digest, expiresAtMs: session.expires_at_ms };
    const context = authoritativeCreativeContext(nativeEvents(f).slice(0, f.committed.head), { projectId: f.session.projectId, documentId: f.session.documentId });
    const compiled = await compileGuestSponsorEnvelope(f.compiled.policy, envelope, { sessionBinding, authorization: input.authorization,
      native: { sourceRevision: f.committed.head + 3, preflight: f.quoted.preflight, contextSnapshot: context.snapshot,
        transport: quoteEvent.payload.guest_sponsor_quote_transport } });
    assert.equal(compiled.envelopeDigest, issuance.envelope_digest);
    let providerConfigurationReads = 0;
    Object.defineProperty(f.env, 'OPENAI_API_KEY', { configurable: true, get() { providerConfigurationReads++; return 'no-network-fixture'; } });
    const after = snapshot(f), count = changes(f), req = request(), replay = await authorize(f, req);
    let replayMutationBatches = 0; const batch = f.DB.batch;
    f.DB.batch = statements => { if (issuanceBatch(statements)) replayMutationBatches++; return batch.call(f.DB, statements); };
    receiptAssertions(f, await issueGuestImageGrant(req, f.env, replay.authority), true);
    receiptAssertions(f, await issueGuestImageGrant(f.request, f.env, authority), true);
    receiptAssertions(f, await readGuestImageIssuance(request(), f.env, f.input), true);
    assert.equal(replayMutationBatches, 0, 'both a fresh and the original opaque authority replay without another issuance batch');
    assert.deepEqual(snapshot(f), after); assert.equal(changes(f), count, 'replay adds no rows, counters or timestamps');
    assert.equal(providerConfigurationReads, 0, 'issuer replay never invokes the quote builder or reads provider credentials');
    await assert.rejects(readGuestImagePreflight(request(), f.env, f.input), 'old quoted stage API stays strict');
    await assert.rejects(compileSponsorEnvelope(f.compiled.policy, envelope));
    await assert.rejects(prepareSponsorEntitlement({ policy: f.compiled.policy, envelope, grantId: grant.grant_id,
      native: Object.fromEntries(['scopeKey', 'planRevisionId', 'slotId', 'executionGrantId', 'jobId', 'costReservationId', 'tokenReservationId', 'commandKey'].map(key => [key, `fixture-${key}`])) }));
    unchangedExcept(f, before, issuerTables); assertNoExecution(f); limits.assertVerified();
    t.diagnostic(JSON.stringify({ memory, qualifiedStatements: limits.records.length, maxBindings: Math.max(...limits.boundCounts),
      maxSqlBytes: Math.max(...limits.records.map(row => row.statementBytes)), nativeAuthorizationCommitted: false }));
  } finally { limits.restore(); }
});

for (const absent of [['grant'], ['issuance'], ['resource'], ['grant', 'issuance'], ['grant', 'resource'], ['issuance', 'resource']])
  test(`partial issuance with absent ${absent.join('+')} refuses recovery without mutation`, async t => {
    const f = await quotedFixture(t); await issued(f);
    replaceTriple(f, () => {
      for (const part of absent) f.sqlite.prepare(part === 'grant' ? 'DELETE FROM experience_sponsor_grants' : part === 'issuance'
        ? 'DELETE FROM experience_sponsor_issuances' : "DELETE FROM experience_sponsor_resource_receipts WHERE operation='issuance'").run();
    });
    const before = snapshot(f), count = changes(f);
    await assert.rejects(readGuestImageIssuance(request(), f.env, f.input));
    await assert.rejects(prepareGuestImageAuthorization(request(), f.env, f.input));
    assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count);
  });

const conflicts = {
  'grant actor': f => f.sqlite.prepare("UPDATE experience_sponsor_grants SET actor_user_id='foreign-actor'").run(),
  'grant digest': f => f.sqlite.prepare('UPDATE experience_sponsor_grants SET envelope_digest=?').run(`sha256:${'a'.repeat(64)}`),
  'issuance authorization digest': f => f.sqlite.prepare('UPDATE experience_sponsor_issuances SET command_digest=?').run(`sha256:${'b'.repeat(64)}`),
  'issuance envelope': f => f.sqlite.prepare("UPDATE experience_sponsor_issuances SET envelope_json='{}'").run(),
  'resource timestamp': f => f.sqlite.prepare("UPDATE experience_sponsor_resource_receipts SET recorded_at_ms=1 WHERE operation='issuance'").run(),
};
for (const [name, corrupt] of Object.entries(conflicts)) test(`retained triple ${name} conflict never becomes a replay`, async t => {
  const f = await quotedFixture(t); await issued(f); replaceTriple(f, () => corrupt(f)); const before = snapshot(f);
  await assert.rejects(readGuestImageIssuance(request(), f.env, f.input)); assert.deepEqual(snapshot(f), before);
});

test('an unrelated complete sponsor issuance family stays unchanged while exact guest issuance succeeds', async t => {
  const f = await quotedFixture(t), now = Date.now(), hash = `sha256:${'d'.repeat(64)}`;
  insert(f, 'experience_sponsor_grants', { grant_id: 'unrelated-grant', campaign_id: f.input.campaignId, policy_digest: f.input.policyDigest,
    actor_user_id: 'unrelated-actor', session_digest: hash, intent_key: 'unrelated-intent', envelope_digest: hash, issued_at_ms: now - 1000, expires_at_ms: now + 30000, enabled: 1 });
  insert(f, 'experience_sponsor_issuances', { grant_id: 'unrelated-grant', campaign_id: f.input.campaignId, actor_user_id: 'unrelated-actor', intent_key: 'unrelated-intent',
    policy_digest: f.input.policyDigest, driver_command_json: '{"documentId":"unrelated-document"}', command_digest: hash, envelope_digest: hash,
    envelope_json: canonicalJson({ documentId: 'unrelated-document', projectId: 'unrelated-project', ownerUserId: 'unrelated-actor', actorUserId: 'unrelated-actor', payerUserId: payer, sessionDigest: hash }) });
  insert(f, 'experience_sponsor_resource_receipts', { ...rows(f, 'experience_sponsor_resource_receipts')[0], resource_id: 'unrelated-resource',
    actor_user_id: 'unrelated-actor', session_digest: hash, operation: 'issuance', intent_key: 'unrelated-intent',
    payload_digest: hash, issued_grant_id: 'unrelated-grant', text_bytes: 0, recorded_at_ms: now });
  const before = rows(f, 'experience_sponsor_issuances')[0]; await issued(f);
  assert.deepEqual(rows(f, 'experience_sponsor_issuances').find(row => row.grant_id === 'unrelated-grant'), before); assertNoExecution(f);
});

test('foreign actor consumption linked to the exact issued grant prevents usable replay', async t => {
  const f = await quotedFixture(t); const { result } = await issued(f), hash = `sha256:${'d'.repeat(64)}`;
  insert(f, 'experience_sponsor_consumptions', { consumption_id: 'foreign-used-exact-grant', grant_id: result.grantId,
    campaign_id: f.input.campaignId, actor_user_id: 'foreign-consumption-actor', session_digest: hash, intent_key: 'foreign-consumption-intent',
    envelope_digest: hash, job_id: 'foreign-consumption-job', maximum_microusd: 1, admitted_at_ms: Date.now() });
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), [], 'adversarial association obeys native foreign keys');
  const before = snapshot(f), count = changes(f);
  await assert.rejects(readGuestImageIssuance(request(), f.env, f.input));
  await assert.rejects(prepareGuestImageAuthorization(request(), f.env, f.input));
  assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count, 'no repair, release or refund of unsupported consumption');
});

for (const defect of ['extra related grant', 'extra native authorization', 'unsupported schema', 'unsupported Memory']) test(`issuer rejects ${defect} without repairing it`, async t => {
  const f = await quotedFixture(t); const { authority } = await authorize(f);
  if (defect === 'extra related grant') insert(f, 'experience_sponsor_grants', { grant_id: 'unexpected-related-grant', campaign_id: f.input.campaignId,
    policy_digest: f.input.policyDigest, actor_user_id: f.session.guestSubject, session_digest: `sha256:${'d'.repeat(64)}`,
    intent_key: 'unexpected-intent', envelope_digest: `sha256:${'e'.repeat(64)}`, issued_at_ms: Date.now() - 1000, expires_at_ms: Date.now() + 30000, enabled: 1 });
  if (defect === 'extra native authorization') insert(f, 'output_commands', { ...rows(f, 'output_commands')[0], command_key: 'unexpected-authorization', action: 'authorize' });
  if (defect === 'unsupported schema') f.sqlite.exec('DROP TRIGGER experience_sponsor_issuance_no_update');
  if (defect === 'unsupported Memory') f.sqlite.exec('CREATE TABLE memory_structured_answer_origins(answer_id TEXT)');
  const before = snapshot(f); await assert.rejects(issueGuestImageGrant(f.request, f.env, authority)); assert.deepEqual(snapshot(f), before);
});

for (const cap of ['operation', 'bytes', 'pending grant']) test(`exhausted ${cap} cap rolls back the entire issuance and never refunds`, async t => {
  const options = cap === 'operation' ? { operationCap: 3 } : cap === 'pending grant' ? { pendingCap: 1 } : {};
  const f = await quotedFixture(t, options);
  if (cap === 'bytes') {
    // Fill the actual approved campaign byte allowance with unrelated retained
    // finite preparation work, preserving the original policy and its proof.
    const existing = rows(f, 'experience_sponsor_resource_receipts'), used = existing.reduce((n, row) => n + row.text_bytes, 0);
    const sample = existing[0];
    insert(f, 'experience_sponsor_resource_receipts', { ...sample, resource_id: 'unrelated-byte-cap', actor_user_id: 'unrelated-actor',
      session_digest: `sha256:${'e'.repeat(64)}`, intent_key: 'unrelated-byte-cap', text_bytes: f.compiled.policy.resources.campaign.maximumTextBytes - used,
      recorded_at_ms: Date.now() });
  }
  if (cap === 'pending grant') insert(f, 'experience_sponsor_grants', { grant_id: 'unrelated-pending', campaign_id: f.input.campaignId,
    policy_digest: f.input.policyDigest, actor_user_id: 'unrelated-actor', session_digest: `sha256:${'e'.repeat(64)}`,
    intent_key: 'unrelated-pending', envelope_digest: `sha256:${'e'.repeat(64)}`, issued_at_ms: Date.now() - 1000, expires_at_ms: Date.now() + 30000, enabled: 1 });
  const { authority } = await authorize(f), before = snapshot(f); let calls = 0; const batch = f.DB.batch;
  f.DB.batch = statements => { if (issuanceBatch(statements)) calls++; return batch.call(f.DB, statements); };
  await assert.rejects(issueGuestImageGrant(f.request, f.env, authority)); assert.equal(calls, 1);
  assert.deepEqual(snapshot(f), before); assert.equal(await readGuestImageIssuance(request(), f.env, f.input), null); assertNoExecution(f);
});

let accessorReads = 0;
const malformedAck = {
  lost: () => { throw Error('fixture lost real committed ACK'); },
  sparse: result => { delete result[0]; return result; },
  missingSuccess: result => { delete result[0].success; return result; },
  falseSuccess: result => { result[0].success = false; return result; },
  inheritedSlot: result => { const proto = Object.create(Array.prototype); proto[0] = result[0]; delete result[0]; Object.setPrototypeOf(result, proto); return result; },
  accessorSlot: result => { Object.defineProperty(result, 0, { get() { accessorReads++; return { success: true }; } }); return result; },
  accessorSuccess: result => { Object.defineProperty(result[0], 'success', { get() { accessorReads++; return true; } }); return result; },
  wrongInsertCount: (result, statements) => { result[statements.findIndex(row => /^INSERT INTO experience_sponsor_grants\(/u.test(row.sql))].meta.changes = 0; return result; },
};
for (const [kind, corrupt] of Object.entries(malformedAck)) test(`real committed issuance with ${kind} ACK recovers only its exact original`, async t => {
  accessorReads = 0;
  const f = await quotedFixture(t), { authority } = await authorize(f), hook = interceptIssuance(f, corrupt);
  try { receiptAssertions(f, await issueGuestImageGrant(f.request, f.env, authority), true); assert.equal(hook.calls, 1); }
  finally { hook.restore(); }
  assert.equal(accessorReads, 0, 'mutation ACK getters never supply permission evidence');
  assert.equal(rows(f, 'experience_sponsor_issuances').length, 1); assert.equal(rows(f, 'experience_sponsor_resource_receipts').length, 4); assertNoExecution(f);
});

test('failed atomic issuance with no completed original never retries mutation', async t => {
  const f = await quotedFixture(t), { authority } = await authorize(f), before = snapshot(f), hook = interceptIssuance(f, () => { throw Error('fixture rejects transaction before commit'); }, { before: true });
  try { await assert.rejects(issueGuestImageGrant(f.request, f.env, authority)); assert.equal(hook.calls, 1); } finally { hook.restore(); }
  assert.deepEqual(snapshot(f), before);
});

test('two concurrent authentic requests share one immutable issuance tuple', async t => {
  const f = await quotedFixture(t), req = request(), first = await authorize(f), second = await authorize(f, req);
  const values = await Promise.all([issueGuestImageGrant(f.request, f.env, first.authority), issueGuestImageGrant(req, f.env, second.authority)]);
  assert.equal(values[0].grantId, values[1].grantId); assert.equal(values.filter(value => !value.replayed).length, 1);
  assert.equal(rows(f, 'experience_sponsor_issuances').length, 1); assert.equal(rows(f, 'experience_sponsor_resource_receipts').length, 4);
});

test('claim acquired inside the native issuance batch rolls back all three new rows', async t => {
  const f = await quotedFixture(t), { authority } = await authorize(f), before = snapshot(f), batch = f.DB.batch; let calls = 0;
  f.DB.batch = statements => {
    if (issuanceBatch(statements)) {
      calls++; const index = statements.findIndex(row => /^INSERT INTO experience_sponsor_issuances\(/u.test(row.sql));
      const now = Date.now(), lease = f.DB.prepare('INSERT INTO experience_guest_claim_leases VALUES(?,?,?,?,?,?,?,?,?)')
        .bind(f.session.sessionId, crypto.randomUUID(), payer, f.inventory.manifestDigest, 'race-lease', '["race-lease"]', 1, now, now + 30000);
      statements = [...statements.slice(0, index), lease, ...statements.slice(index)];
    }
    return batch.call(f.DB, statements);
  };
  await assert.rejects(issueGuestImageGrant(f.request, f.env, authority)); assert.equal(calls, 1); assert.deepEqual(snapshot(f), before);
});

function interceptFinalProof(f, action) {
  const prepare = f.DB.prepare; let proofs = 0, hits = 0;
  function wrap(statement, sql) {
    const bind = statement.bind, all = statement.all;
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql); };
    statement.all = async function (...args) {
      const value = await all.apply(this, args);
      if (sql.startsWith('SELECT 1 AS current WHERE EXISTS(WITH guest_output_proof_') && ++proofs === 2) {
        hits++; assert.equal(value.success, true); assert.equal(value.results[0].current, 1); return action(value);
      }
      return value;
    };
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
  return () => { f.DB.prepare = prepare; assert.equal(hits, 1, 'final original-result proof hook ran'); };
}
const malformedProof = {
  missingSuccess: value => { delete value.success; return value; },
  falseSuccess: value => { value.success = false; return value; },
  sparseRows: value => { delete value.results[0]; return value; },
  inheritedCurrent: value => { value.results[0] = Object.create({ current: 1 }); return value; },
  inheritedRow: value => { const proto = Object.create(Array.prototype); proto[0] = value.results[0]; delete value.results[0]; Object.setPrototypeOf(value.results, proto); return value; },
  accessorCurrent: value => { Object.defineProperty(value.results[0], 'current', { get() { accessorReads++; return 1; } }); return value; },
  accessorSuccess: value => { Object.defineProperty(value, 'success', { get() { accessorReads++; return true; } }); return value; },
};
for (const [kind, corrupt] of Object.entries(malformedProof)) test(`final issuance proof rejects ${kind} independently of mutation ACK`, async t => {
  accessorReads = 0;
  const f = await quotedFixture(t); await issued(f); const before = snapshot(f), restore = interceptFinalProof(f, corrupt);
  try { await assert.rejects(readGuestImageIssuance(request(), f.env, f.input)); } finally { restore(); }
  assert.equal(accessorReads, 0, 'final proof getters never supply permission evidence');
  assert.deepEqual(snapshot(f), before);
});

for (const mutation of ['headers', 'database', 'abort', 'original grant expiry']) test(`final issuance read refuses ${mutation} changed at its last native await`, async t => {
  const f = await quotedFixture(t); const { result } = await issued(f), controller = new AbortController();
  const req = new Request(`${origin}/unregistered-guest-issuer`, { method: 'POST', headers: { origin }, signal: controller.signal });
  const before = snapshot(f), restore = interceptFinalProof(f, value => {
    if (mutation === 'headers') req.headers.set('x-final-change', 'yes');
    if (mutation === 'database') f.env.DB = { ...f.DB };
    if (mutation === 'abort') controller.abort();
    if (mutation === 'original grant expiry') t.mock.method(Date, 'now', () => result.expiresAtMs);
    return value;
  });
  try { await assert.rejects(readGuestImageIssuance(req, f.env, f.input)); } finally { restore(); }
  assert.deepEqual(snapshot(f), before);
});

for (const mode of ['original deadline on resolution', 'abort then late resolution']) test(`issuer local clock await stops at ${mode}`, async t => {
  const f = await quotedFixture(t), controller = new AbortController();
  const req = new Request(`${origin}/unregistered-guest-issuer`, { method: 'POST', headers: { origin }, signal: controller.signal });
  let monotonicNow = 1000;
  t.mock.method(performance, 'now', () => monotonicNow);
  const { authority } = await authorize(f, req), before = snapshot(f);
  monotonicNow = 11000;
  const prepare = f.DB.prepare, batch = f.DB.batch; let releaseClock, enterClock, clockHits = 0, preparedReads = 0, mutationBatches = 0;
  const entered = new Promise(resolve => { enterClock = resolve; });
  function wrap(statement, sql) {
    const bind = statement.bind, first = statement.first;
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql); };
    statement.first = async function (...args) {
      const value = await first.apply(this, args);
      if (sql.endsWith(' AS now_ms')) {
        clockHits++; enterClock();
        return new Promise(resolve => { releaseClock = () => resolve(value); });
      }
      return value;
    };
    return statement;
  }
  f.DB.prepare = function (sql) { preparedReads++; return wrap(prepare.call(this, sql), sql); };
  f.DB.batch = statements => { if (issuanceBatch(statements)) mutationBatches++; return batch.call(f.DB, statements); };
  const operation = issueGuestImageGrant(req, f.env, authority), outcome = operation.then(value => ({ value }), error => ({ error }));
  const boundary = await Promise.race([entered.then(() => ({ entered: true })), outcome]);
  assert.equal(boundary.entered, true, String(boundary.error ?? 'issuer clock boundary was not reached'));
  const readsAtBoundary = preparedReads;
  monotonicNow = 31000;
  assert.ok(monotonicNow < 11000 + 30000, 'a renewed deadline would still be live at this boundary');
  if (mode === 'abort then late resolution') { controller.abort(); assert.ok((await outcome).error); }
  releaseClock();
  assert.ok((await outcome).error, 'the originally owned deadline cannot be renewed by a nested observation');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clockHits, 1); assert.equal(preparedReads, readsAtBoundary, 'late local continuation starts no next database read');
  assert.equal(mutationBatches, 0); assert.deepEqual(snapshot(f), before);
  t.diagnostic('Captured at1000, reentered at11000, resumed at31000: original31000 expired while renewed41000 would remain live. This qualifies the issuer-owned clock wait; unchanged nested approval/source readers do not promise transitive cancellation.');
});

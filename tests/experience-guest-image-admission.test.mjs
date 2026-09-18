import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { issuedFixture, createGuestImageAdmissionAuthority, admitGuestImage, readGuestImageAdmission, admit,
  admissionReceiptAssertions, admissionBatch, interceptAdmission, observeAdmissionSql, assertOriginalUnchanged,
  request, rows, snapshot, changes, nativeEvents, canonicalJson, digest, payer, insert, addLease, redactSource, origin } from './helpers/guest-image-admission-fixture.mjs';
import { enforceD1ExpressionDepth } from './helpers/d1-expression-depth.mjs';
const [{ readGuestImageIssuance }, { requireGuestImageAdmissionFrame }, { guestImageStageQuoteRecipe }, { outputDigest },
  { eventWitness }, { makeEvent, uuidV7 }, { insertEventAtHead }, { jsonIssues }] = await Promise.all([
  import('../worker/experience-guest-image-issuer.ts'), import('../worker/experience-guest-image-admission-witness.ts'),
  import('../worker/experience-guest-image-stage-contract.ts'), import('../worker/output-disclosure-proof.ts'),
  import('../worker/experience-guest-image-history.ts'), import('../worker/event-write-primitives.ts'), import('../worker/event-append.ts'),
  import('../src/experiences/compiler.ts'),
]);

function exactGraph(f, result) {
  const one = table => { const value = rows(f, table); assert.equal(value.length, 1, table); return value[0]; };
  const grant = one('output_execution_grants'), slot = one('output_operation_slots'), job = one('document_jobs');
  const tokens = one('budget_reservations'), cost = one('cost_budget_reservations'), consumed = one('experience_sponsor_consumptions');
  const active = one('experience_sponsor_active_jobs'), quote = f.quoted.preflight.targets[0], guest = f.session.guestSubject;
  assert.deepEqual(rows(f, 'users').map(row => row.user_id), [payer], 'guest custody never fabricates a canonical user');
  assert.equal(grant.grant_id, result.grantId); assert.equal(grant.actor_user_id, guest); assert.equal(grant.payer_user_id, payer);
  assert.equal(grant.preflight_id, result.preflightId); assert.equal(grant.status, 'authorized');
  assert.equal(grant.maximum_microusd, f.quoted.preflight.maximumMicrousd); assert.equal(grant.maximum_calls, quote.maximumCalls);
  assert.equal(slot.slot_id, result.slotId); assert.equal(slot.grant_id, result.grantId); assert.equal(slot.job_id, result.jobId);
  assert.equal(slot.status, 'authorized'); assert.equal(slot.maximum_tokens, quote.maximumTokens);
  assert.equal(slot.maximum_tokens, 128000, 'retain the full quoted cap rather than a smaller native minimum');
  assert.equal(slot.maximum_microusd, quote.maximumMicrousd); assert.equal(slot.maximum_calls, quote.maximumCalls);
  assert.equal(slot.attempt_ordinal, 0); assert.equal(slot.previous_slot_id, null); assert.equal(slot.outcome_event_id, null);
  assert.equal(slot.target_contract_digest, rows(f, 'output_plan_targets')[0].target_contract_digest);
  assert.equal(slot.source_digest, f.quoted.preflight.sourceDigest);
  const routes = rows(f, 'output_operation_routes'); assert.equal(routes.length, 2);
  assert.ok(routes.every(route => route.slot_id === slot.slot_id && route.scope_key === slot.scope_key));
  assert.equal(routes.reduce((n, route) => n + route.maximum_calls, 0), slot.maximum_calls);
  assert.equal(job.job_id, result.jobId); assert.equal(job.owner_id, guest); assert.equal(job.stream_id, `creative:${guest}`);
  assert.equal(job.document_id, f.session.documentId); assert.equal(job.status, 'queued'); assert.equal(job.kind, 'generate');
  assert.equal(job.attempt_count, 0); assert.equal(job.started_at, null); assert.equal(job.completed_at, null);
  assert.equal(job.lease_expires_at, null); assert.equal(job.error_message, null);
  assert.equal(job.scene_source_version_json, null); assert.equal(job.scene_source_protocol, 0);
  assert.equal(job.expires_at, result.expiresAt); assert.equal(grant.expires_at, result.expiresAt);
  for (const hold of [tokens, cost]) { assert.equal(hold.owner_id, payer); assert.equal(hold.status, 'active');
    assert.equal(hold.stream_id, job.stream_id); assert.equal(hold.correlation_id, job.correlation_id); }
  assert.equal(tokens.reservation_id, slot.token_reservation_id); assert.equal(cost.reservation_id, slot.cost_reservation_id);
  assert.equal(tokens.reserved_tokens, slot.maximum_tokens); assert.equal(cost.reserved_microusd, slot.maximum_microusd);
  assert.equal(tokens.period, cost.period); assert.equal(cost.allow_user_overage, 0);
  for (const [table, unit, amount] of [['budget_counters', 'tokens', slot.maximum_tokens], ['cost_budget_counters', 'microusd', slot.maximum_microusd]]) {
    const counters = rows(f, table); assert.equal(counters.length, 2);
    assert.deepEqual(new Set(counters.map(row => `${row.scope}:${row.scope_id}`)), new Set([`user:${payer}`, 'workspace:forma']));
    assert.ok(counters.every(row => row.period === tokens.period && row[`used_${unit}`] === 0 && row[`reserved_${unit}`] === amount));
  }
  assert.equal(consumed.consumption_id, result.consumptionId); assert.equal(consumed.grant_id, f.issued.grantId);
  assert.equal(consumed.actor_user_id, guest); assert.equal(consumed.job_id, job.job_id);
  assert.equal(consumed.envelope_digest, rows(f, 'experience_sponsor_issuances')[0].envelope_digest);
  assert.equal(active.consumption_id, consumed.consumption_id); assert.equal(active.actor_user_id, guest); assert.equal(active.job_id, job.job_id);
  const events = nativeEvents(f), [queued, authorized] = events.slice(-2);
  assert.equal(queued.type, 'OutputOperationJobQueued'); assert.equal(authorized.type, 'OutputExecutionAuthorized');
  assert.equal(queued.sequence, f.committed.head + 4); assert.equal(authorized.sequence, f.committed.head + 5);
  assert.equal(job.requested_sequence, queued.sequence); assert.equal(authorized.eventId, result.eventId);
  assert.equal(grant.authorization_event_id, result.eventId);
  assert.ok([queued, authorized].every(event => event.actor === guest && event.streamId === job.stream_id));
  const command = rows(f, 'output_commands').find(row => row.command_key === result.commandKey);
  assert.equal(command.event_id, result.eventId); assert.equal(command.actor_user_id, guest); assert.equal(command.action, 'authorize');
  const payload = JSON.parse(job.request_json), initial = JSON.parse(job.result_json);
  assert.equal(payload.outputExecution.slotId, result.slotId); assert.equal(payload.outputExecution.grantId, result.grantId);
  assert.equal(initial.providerSubmissionProtocol, 1); assert.equal(initial.stage, 'queued');
  assert.equal(initial.generationReceipt.source_transmission_status, 'not_transmitted');
  assert.equal(initial.generationReceipt.provider_request_status, 'not_submitted');
  for (const table of ['output_provider_calls', 'output_results']) assert.equal(rows(f, table).length, 0);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  return { grant, slot, job, command, payload, authorized };
}

for (const memory of [false, true]) test(`genuine native guest admission with ${memory ? 'complete' : 'absent'} Memory pins the full atomic graph and strict deployment SQL`, async t => {
  const f = await issuedFixture(t, { memory }), before = snapshot(f), limits = enforceD1ExpressionDepth(f,
    { queryLimits: { functionArguments: 32, parameters: 100, sqlBytes: 100000 } });
  const observed = observeAdmissionSql(f);
  const nativeBoundary = interceptAdmission(f, () => { assert.deepEqual(snapshot(f), before, 'all native preparation remains read-only until the one complete batch'); }, { before: true });
  try {
    const authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input);
    const frame = requireGuestImageAdmissionFrame(f.request, f.env, authority);
    assert.equal(frame.sourceHead, f.committed.head); assert.equal(frame.planSourceHead, f.committed.head + 1);
    assert.equal(frame.quoteHead, f.committed.head + 3); assert.equal(frame.ownerHead, frame.quoteHead);
    assert.deepEqual(snapshot(f), before, 'sealed preparation is read-only');
    const result = await admitGuestImage(f.request, f.env, authority); admissionReceiptAssertions(f, result);
    const graph = exactGraph(f, result); assertOriginalUnchanged(f, before);
    const quoteEvent = nativeEvents(f).find(event => event.type === 'OutputPlanPreflighted');
    const recipe = await guestImageStageQuoteRecipe({ target: f.confirmed.plan.targets[0], releaseRevision: f.release.definition.revision,
      releaseHash: f.release.releaseHash, approvedTemplate: f.compiled.policy.templates[0] }, f.quoted.preflight.targets[0], quoteEvent.payload.guest_sponsor_quote_transport);
    assert.deepEqual(frame.recipe, recipe); assert.deepEqual(f.envelope.recipe, recipe);
    const issuance = rows(f, 'experience_sponsor_issuances')[0];
    assert.equal(issuance.driver_command_json, rows(f, 'experience_sponsor_driver_intents')[0].command_json);
    assert.equal(issuance.command_digest, await digest(f.authorizationInput)); assert.equal(issuance.command_digest, f.envelope.guestAuthorizationDigest);
    assert.equal(issuance.envelope_json, canonicalJson(f.envelope)); assert.equal(f.envelope.sourceRevision, f.committed.head + 3);
    assert.equal(rows(f, 'output_plan_revisions')[0].source_head, f.committed.head + 1);
    assert.equal(graph.command.request_digest, await outputDigest(graph.authorized.payload.output_command_envelope));
    assert.notEqual(graph.command.request_digest, issuance.command_digest, 'native authorize command and explicit issuer consent have distinct grammars');
    const consequential = observed.batches.filter(sql => sql.some(statement => /INSERT\s+INTO\s+output_execution_grants/iu.test(statement)));
    assert.equal(consequential.length, 1);
    assert.equal(nativeBoundary.calls, 1);
    for (const table of ['output_execution_grants', 'output_operation_slots', 'output_operation_routes', 'document_jobs',
      'output_commands', 'budget_reservations', 'cost_budget_reservations', 'experience_sponsor_consumptions', 'experience_sponsor_active_jobs'])
      assert.ok(consequential[0].some(sql => new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${table}\\b`, 'iu').test(sql)), `${table} is in the one admission batch`);
    assert.equal(consequential[0].filter(sql => /INSERT\s+INTO\s+event_write_stage\b/iu.test(sql)).length, 2,
      'two native event-stage insertions atomically trigger the queue/auth events and private bodies');
    assert.equal(rows(f, 'event_private_payloads').length, before.contents.event_private_payloads.length + 2);
    const after = snapshot(f), count = changes(f), req = request(); observed.readOnly = true;
    const replay = await createGuestImageAdmissionAuthority(req, f.env, f.input);
    assert.deepEqual(await admitGuestImage(req, f.env, replay), { ...result, replayed: true });
    assert.deepEqual(await admitGuestImage(f.request, f.env, authority), { ...result, replayed: true });
    assert.deepEqual(await readGuestImageAdmission(request(), f.env, f.input), { ...result, replayed: true });
    assert.deepEqual(snapshot(f), after); assert.equal(changes(f), count);
    await assert.rejects(readGuestImageIssuance(request(), f.env, f.input), 'old issued-only witness remains closed');
    observed.assertClean(); limits.assertVerified();
    const serialized = f.sqlite.prepare(`SELECT length(CAST(body.private_json AS BLOB)) AS privateBytes,
      length(CAST(e.payload AS BLOB)) AS publicBytes,length(CAST(${eventWitness} AS BLOB)) AS witnessBytes
      FROM events e JOIN event_private_payloads body ON body.private_event_id=e.event_id WHERE e.event_id IN(?,?)`).all(...nativeEvents(f).slice(-2).map(event => event.eventId));
    const serializedMax = Object.fromEntries(['privateBytes', 'publicBytes', 'witnessBytes'].map(key => [key, Math.max(...serialized.map(row => row[key]))]));
    t.diagnostic(JSON.stringify({ memory, qualifiedStatements: limits.records.length, maxBindings: Math.max(...limits.boundCounts),
      maxSqlBytes: Math.max(...limits.records.map(row => row.statementBytes)), consequentialBatches: consequential.length, providerCalls: 0,
      subjectCharacters: f.subject.length, serializedMax, oversizeGuardCrossed: false }));
  } finally {
    // Retain exact generated SQL and storage-size diagnostics even when the
    // positive path fails. Never emit private source text or binding values.
    const events = f.sqlite.prepare(`SELECT ${eventWitness} AS witness FROM events e
      JOIN event_private_payloads body ON body.private_event_id=e.event_id
      WHERE e.stream_id=? AND e.type='OutputExecutionAuthorized'`).all(`creative:${f.session.guestSubject}`);
    const storageDiagnostics = events.map(({ witness }) => {
      const wrapper = JSON.parse(witness), payload = JSON.parse(wrapper.private_json);
      return { witnessBytes: Buffer.byteLength(witness), witnessCharacters: witness.length,
        privateBytes: Buffer.byteLength(wrapper.private_json), privateCharacters: wrapper.private_json.length,
        publicBytes: Buffer.byteLength(wrapper.payload), publicCharacters: wrapper.payload.length,
        wrapperIssues: jsonIssues(wrapper), payloadIssues: jsonIssues(payload) };
    });
    t.diagnostic(JSON.stringify({ memory, subjectCharacters: f.subject.length, storageDiagnostics, privateTextEmitted: false }));
    if (process.env.FORMA_ADMISSION_SQL_CAPTURE_DIR) {
      const rank = { table: 0, index: 1, view: 2, trigger: 3 };
      const schema = before.schema.filter(row => row.sql).sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name)).map(row => row.sql);
      writeFileSync(join(process.env.FORMA_ADMISSION_SQL_CAPTURE_DIR, memory ? 'complete-memory.json' : 'absent-memory.json'),
        JSON.stringify({ memory, schema, statements: observed.executed, storageDiagnostics, subjectCharacters: f.subject.length }, null, 2) + '\n', { flag: 'wx' });
    }
    nativeBoundary.restore(); observed.restore(); limits.restore();
  }
});

const rollbackCases = {
  'ignored token hold': f => f.sqlite.exec('CREATE TRIGGER fail_guest_token BEFORE INSERT ON budget_reservations BEGIN SELECT RAISE(IGNORE); END'),
  'ignored cost hold': f => f.sqlite.exec('CREATE TRIGGER fail_guest_cost BEFORE INSERT ON cost_budget_reservations BEGIN SELECT RAISE(IGNORE); END'),
  'ignored queued native job': f => f.sqlite.exec('CREATE TRIGGER fail_guest_job BEFORE INSERT ON document_jobs BEGIN SELECT RAISE(IGNORE); END'),
  'changed held cost': f => f.sqlite.exec('CREATE TRIGGER corrupt_guest_cost AFTER INSERT ON cost_budget_reservations BEGIN UPDATE cost_budget_reservations SET reserved_microusd=reserved_microusd+1 WHERE reservation_id=NEW.reservation_id; END'),
  'changed held tokens': f => f.sqlite.exec('CREATE TRIGGER corrupt_guest_tokens AFTER INSERT ON budget_reservations BEGIN UPDATE budget_reservations SET reserved_tokens=reserved_tokens+1 WHERE reservation_id=NEW.reservation_id; END'),
  'changed job source': f => f.sqlite.exec("CREATE TRIGGER corrupt_guest_job AFTER INSERT ON document_jobs BEGIN UPDATE document_jobs SET request_json='{}' WHERE job_id=NEW.job_id; END"),
  'ignored stage route': f => f.sqlite.exec("CREATE TRIGGER fail_guest_route BEFORE INSERT ON output_operation_routes BEGIN SELECT RAISE(IGNORE); END"),
};
for (const [name, setup] of Object.entries(rollbackCases)) test(`native admission rolls back all synthetic rows after ${name}`, async t => {
  const f = await issuedFixture(t); setup(f); const before = snapshot(f), hook = interceptAdmission(f, value => value);
  try { await assert.rejects(admit(f)); assert.equal(hook.calls, 1); } finally { hook.restore(); }
  assert.deepEqual(snapshot(f), before, 'both holds, counters, events, native graph and sponsor consumption roll back');
  assert.equal(await readGuestImageAdmission(request(), f.env, f.input), null);
});

for (const [name, change] of Object.entries({ 'payer consent': f => f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer),
  'campaign approval': f => f.sqlite.exec('UPDATE experience_sponsor_campaigns SET enabled=0'), 'source redaction': redactSource, 'claim lease': addLease }))
  test(`final native batch refuses newly withdrawn ${name} without partial admission`, async t => {
    const f = await issuedFixture(t), authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input); let captured;
    const hook = interceptAdmission(f, () => { change(f); captured = snapshot(f); }, { before: true });
    try { await assert.rejects(admitGuestImage(f.request, f.env, authority)); assert.equal(hook.calls, 1); } finally { hook.restore(); }
    assert.deepEqual(snapshot(f), captured); assert.equal(rows(f, 'document_jobs').length, 0);
  });

let accessorReads = 0;
const malformedAck = {
  lost: () => { throw Error('fixture loses real committed native admission ACK'); },
  sparse: value => { delete value[0]; return value; },
  missingSuccess: value => { delete value[0].success; return value; },
  falseSuccess: value => { value[0].success = false; return value; },
  inheritedSlot: value => { const prototype = Object.create(Array.prototype); prototype[0] = value[0]; delete value[0]; Object.setPrototypeOf(value, prototype); return value; },
  accessorSlot: value => { Object.defineProperty(value, 0, { get() { accessorReads++; return { success: true }; } }); return value; },
  accessorSuccess: value => { Object.defineProperty(value[0], 'success', { get() { accessorReads++; return true; } }); return value; },
  explicitError: value => { value[0].error = 'fixture-contradictory-success'; return value; },
  nullError: value => { value[0].error = null; return value; },
  inheritedError: value => { Object.setPrototypeOf(value[0], { error: undefined }); return value; },
  accessorError: value => { Object.defineProperty(value[0], 'error', { get() { accessorReads++; return undefined; } }); return value; },
  wrongGrantInsertCount: (value, statements) => { value[statements.findIndex(row => /INSERT\s+INTO\s+output_execution_grants/iu.test(row.sql))].meta.changes = 0; return value; },
};
for (const [name, corrupt] of Object.entries(malformedAck)) test(`a ${name} mutation ACK recovers only the exact original native admission`, async t => {
  accessorReads = 0;
  const f = await issuedFixture(t), authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input), hook = interceptAdmission(f, corrupt);
  try { const result = await admitGuestImage(f.request, f.env, authority); admissionReceiptAssertions(f, result, true); exactGraph(f, result); assert.equal(hook.calls, 1); }
  finally { hook.restore(); }
  assert.equal(accessorReads, 0, 'mutation ACK accessors cannot supply authority'); assertOriginalUnchanged(f);
});

test('own undefined error values preserve an honest native mutation acknowledgement', async t => {
  const f = await issuedFixture(t), hook = interceptAdmission(f, value => { for (const result of value) result.error = undefined; return value; });
  try { const { result } = await admit(f); admissionReceiptAssertions(f, result, false); exactGraph(f, result); assert.equal(hook.calls, 1); }
  finally { hook.restore(); }
});

test('a rejected uncommitted batch never retries native mutation or reconstructs an admission', async t => {
  const f = await issuedFixture(t), before = snapshot(f), hook = interceptAdmission(f, () => { throw Error('fixture transaction unavailable'); }, { before: true });
  try { await assert.rejects(admit(f)); assert.equal(hook.calls, 1); } finally { hook.restore(); }
  assert.deepEqual(snapshot(f), before); assert.equal(await readGuestImageAdmission(request(), f.env, f.input), null);
});

for (const unit of ['tokens', 'microusd']) test(`exhausted synthetic payer ${unit} allowance refuses admission without fallback or new counters`, async t => {
  const f = await issuedFixture(t), table = unit === 'tokens' ? 'budget_counters' : 'cost_budget_counters';
  const exhausted = 1_000_000_000_000;
  insert(f, table, { scope: 'user', scope_id: payer, period: new Date().toISOString().slice(0, 7),
    [`used_${unit}`]: exhausted, [`reserved_${unit}`]: 0, [`hard_limit_${unit}`]: exhausted, updated_at: new Date().toISOString() });
  const before = snapshot(f), observed = observeAdmissionSql(f);
  try { await assert.rejects(admit(f)); observed.assertClean(); } finally { observed.restore(); }
  assert.deepEqual(snapshot(f), before); assert.equal(rows(f, 'document_jobs').length, 0);
  assert.equal(rows(f, table).some(row => row.scope_id === f.session.guestSubject), false, 'no actor-paid fallback');
});

test('final native budget assertion refuses a payer cap consumed after read-only preparation', async t => {
  const f = await issuedFixture(t), authority = await createGuestImageAdmissionAuthority(f.request, f.env, f.input); let before;
  const hook = interceptAdmission(f, () => {
    insert(f, 'cost_budget_counters', { scope: 'user', scope_id: payer, period: new Date().toISOString().slice(0, 7),
      used_microusd: 1_000_000_000_000, reserved_microusd: 0, hard_limit_microusd: 1_000_000_000_000, updated_at: new Date().toISOString() });
    before = snapshot(f);
  }, { before: true });
  try { await assert.rejects(admitGuestImage(f.request, f.env, authority)); assert.equal(hook.calls, 1); } finally { hook.restore(); }
  assert.deepEqual(snapshot(f), before, 'only the independently consumed synthetic cap remains');
});

const corrupted = {
  'slot status': f => f.sqlite.exec("UPDATE output_operation_slots SET status='running'"),
  'job payload': f => f.sqlite.exec("UPDATE document_jobs SET request_json='{}'"),
  'Scene source version': f => f.sqlite.exec("UPDATE document_jobs SET scene_source_version_json='{}'"),
  'Scene source protocol': f => f.sqlite.exec('UPDATE document_jobs SET scene_source_protocol=1'),
  'job owner': f => f.sqlite.exec("UPDATE document_jobs SET owner_id='foreign-owner'"),
  'cost hold amount': f => f.sqlite.exec('UPDATE cost_budget_reservations SET reserved_microusd=reserved_microusd+1'),
  'token hold amount': f => f.sqlite.exec('UPDATE budget_reservations SET reserved_tokens=reserved_tokens+1'),
  'payer counter': f => f.sqlite.prepare("UPDATE cost_budget_counters SET reserved_microusd=0 WHERE scope='user' AND scope_id=?").run(payer),
  'missing active job': f => f.sqlite.exec('DELETE FROM experience_sponsor_active_jobs'),
  'missing provider stage route': f => f.sqlite.exec('DELETE FROM output_operation_routes WHERE rowid=(SELECT MIN(rowid) FROM output_operation_routes)'),
  'extra native command': f => insert(f, 'output_commands', { ...rows(f, 'output_commands').at(-1), command_key: 'foreign-command' }),
};
for (const [name, corrupt] of Object.entries(corrupted)) test(`retained admission with ${name} refuses replay without repair`, async t => {
  const f = await issuedFixture(t); await admit(f); corrupt(f); const before = snapshot(f), count = changes(f);
  await assert.rejects(readGuestImageAdmission(request(), f.env, f.input));
  await assert.rejects(admit(f, request()));
  assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count);
});

test('foreign consumption using the exact original issuer grant prevents native admission', async t => {
  const f = await issuedFixture(t), hash = `sha256:${'e'.repeat(64)}`;
  insert(f, 'experience_sponsor_consumptions', { consumption_id: 'foreign-used-issued-grant', grant_id: f.issued.grantId, campaign_id: f.input.campaignId,
    actor_user_id: 'foreign-actor', session_digest: hash, intent_key: 'foreign-intent', envelope_digest: hash,
    job_id: 'foreign-job', maximum_microusd: 1, admitted_at_ms: Date.now() });
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []); const before = snapshot(f);
  await assert.rejects(readGuestImageAdmission(request(), f.env, f.input));
  await assert.rejects(admit(f)); assert.deepEqual(snapshot(f), before);
});

for (const identity of ['grant', 'slot']) test(`a foreign-scope ${identity} row cannot alias the exact original native ${identity} ID`, async t => {
  const f = await issuedFixture(t), { result } = await admit(f), foreignScope = `personal:foreign:${uuidV7()}`;
  const projectId = `foreign-project-${uuidV7()}`, documentId = `foreign-document-${uuidV7()}`;
  const planRevisionId = uuidV7(), preflightId = uuidV7(), grantId = uuidV7(), slotId = uuidV7(), targetId = uuidV7();
  const anchorHead = rows(f, 'events').filter(row => row.stream_id === `creative:${payer}`).reduce((n, row) => Math.max(n, row.sequence), 0);
  const anchors = ['OutputPlanConfirmed', 'OutputPlanPreflighted', 'OutputExecutionAuthorized'].map((type, index) =>
    makeEvent(`creative:${payer}`, anchorHead + index + 1, payer, 'server:foreign-fixture', uuidV7(), type,
      { project_id: projectId, document_id: documentId, fixture: 'unrelated native foreign-key support' }));
  await f.DB.batch(anchors.map((event, index) => insertEventAtHead(f.env, event, anchorHead + index)));
  insert(f, 'output_plan_revisions', { ...rows(f, 'output_plan_revisions')[0], scope_key: foreignScope, owner_user_id: payer,
    project_id: projectId, document_id: documentId, plan_revision_id: planRevisionId, plan_id: uuidV7(), confirmed_event_id: anchors[0].eventId });
  insert(f, 'output_preflights', { ...rows(f, 'output_preflights')[0], scope_key: foreignScope, preflight_id: preflightId,
    plan_revision_id: planRevisionId, actor_user_id: payer, event_id: anchors[1].eventId });
  insert(f, 'output_execution_grants', { ...rows(f, 'output_execution_grants')[0], scope_key: foreignScope, grant_id: grantId,
    plan_revision_id: planRevisionId, actor_user_id: payer, payer_user_id: payer, preflight_id: preflightId, authorization_event_id: anchors[2].eventId });
  if (identity === 'slot') {
    insert(f, 'output_plan_targets', { ...rows(f, 'output_plan_targets')[0], scope_key: foreignScope, plan_revision_id: planRevisionId, target_id: targetId });
    insert(f, 'output_operation_slots', { ...rows(f, 'output_operation_slots')[0], scope_key: foreignScope, slot_id: slotId, grant_id: grantId,
      plan_revision_id: planRevisionId, target_id: targetId, job_id: uuidV7(), cost_reservation_id: uuidV7(), token_reservation_id: uuidV7() });
  }
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  const unrelated = snapshot(f), count = changes(f);
  assert.deepEqual(await readGuestImageAdmission(request(), f.env, f.input), { ...result, replayed: true }, 'unrelated native rows do not deny the original');
  assert.deepEqual(snapshot(f), unrelated); assert.equal(changes(f), count);
  const table = identity === 'grant' ? 'output_execution_grants' : 'output_operation_slots', key = identity === 'grant' ? 'grant_id' : 'slot_id';
  const originalId = identity === 'grant' ? result.grantId : result.slotId;
  f.sqlite.prepare(`UPDATE ${table} SET ${key}=? WHERE scope_key=?`).run(originalId, foreignScope);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(new Set(rows(f, table).filter(row => row[key] === originalId).map(row => row.scope_key)).size, 2);
  const aliased = snapshot(f), aliasCount = changes(f);
  await assert.rejects(readGuestImageAdmission(request(), f.env, f.input)); await assert.rejects(admit(f, request()));
  assert.deepEqual(snapshot(f), aliased); assert.equal(changes(f), aliasCount, 'no alias repair, new hold or replacement graph');
});

const malformedProof = {
  nullTruth: value => { value[0].results[0].current = null; return value; },
  falseTruth: value => { value[0].results[0].current = 0; return value; },
  missingSuccess: value => { delete value[0].success; return value; },
  sparseResults: value => { delete value[0].results[0]; return value; },
  inheritedTruth: value => { value[0].results[0] = Object.create({ current: 1 }); return value; },
  accessorTruth: value => { Object.defineProperty(value[0].results[0], 'current', { get() { accessorReads++; return 1; } }); return value; },
  accessorSuccess: value => { Object.defineProperty(value[0], 'success', { get() { accessorReads++; return true; } }); return value; },
  explicitError: value => { value[0].error = 'fixture-contradictory-success'; return value; },
  nullError: value => { value[0].error = null; return value; },
  inheritedError: value => { Object.setPrototypeOf(value[0], { error: undefined }); return value; },
  accessorError: value => { Object.defineProperty(value[0], 'error', { get() { accessorReads++; return undefined; } }); return value; },
};
for (const [name, corrupt] of Object.entries(malformedProof)) test(`native admitted proof rejects ${name} without mutation or accessor trust`, async t => {
  accessorReads = 0;
  const f = await issuedFixture(t); await admit(f); const before = snapshot(f), batch = f.DB.batch; let hits = 0;
  f.DB.batch = async statements => {
    const value = await batch.call(f.DB, statements);
    if (statements.length && statements.every(row => /^SELECT CASE WHEN /u.test(row.sql))) {
      hits++; assert.equal(value[0].results[0].current, 1); return corrupt(value);
    }
    return value;
  };
  await assert.rejects(readGuestImageAdmission(request(), f.env, f.input));
  assert.equal(hits, 1); assert.equal(accessorReads, 0); assert.deepEqual(snapshot(f), before);
});

const erroneousRead = {
  explicit: value => { value.error = 'fixture-contradictory-success'; return value; },
  null: value => { value.error = null; return value; },
  inherited: value => { Object.setPrototypeOf(value, { error: undefined }); return value; },
  accessor: value => { Object.defineProperty(value, 'error', { get() { accessorReads++; return undefined; } }); return value; },
};
for (const boundary of ['optional native-command absence', 'retained native event']) for (const [name, corrupt] of Object.entries(erroneousRead))
  test(`${boundary} refuses a success ACK with ${name} error`, async t => {
    accessorReads = 0;
    const f = await issuedFixture(t);
    const identity = boundary === 'retained native event' ? (await admit(f)).result
      : requireGuestImageAdmissionFrame(f.request, f.env, await createGuestImageAdmissionAuthority(f.request, f.env, f.input));
    const before = snapshot(f), prepare = f.DB.prepare; let hits = 0;
    function wrap(statement, sql) {
      const bind = statement.bind, all = statement.all;
      statement.bind = function (...values) { return wrap(bind.apply(this, values), sql); };
      statement.all = async function (...args) {
        const value = await all.apply(this, args);
        const target = boundary === 'optional native-command absence'
          ? /FROM output_commands WHERE /u.test(sql) && this.bindings.includes(identity.commandKey)
          : /FROM events e JOIN event_private_payloads body/iu.test(sql) && this.bindings.includes(identity.eventId);
        if (target) { hits++; assert.equal(value.success, true); return corrupt(value); }
        return value;
      };
      return statement;
    }
    f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
    await assert.rejects(readGuestImageAdmission(request(), f.env, f.input));
    assert.equal(hits, 1); assert.equal(accessorReads, 0, 'error accessors never supply admission evidence'); assert.deepEqual(snapshot(f), before);
  });

test('own undefined error values remain valid on native row, retained-event and final-proof reads', async t => {
  const f = await issuedFixture(t), { result } = await admit(f), before = snapshot(f), prepare = f.DB.prepare, batch = f.DB.batch;
  let rowReads = 0, proofBatches = 0;
  function wrap(statement) {
    const bind = statement.bind, all = statement.all;
    statement.bind = function (...values) { return wrap(bind.apply(this, values)); };
    statement.all = async function (...args) { const value = await all.apply(this, args); rowReads++; value.error = undefined; return value; };
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql)); };
  f.DB.batch = async statements => { const value = await batch.call(f.DB, statements); proofBatches++; for (const row of value) row.error = undefined; return value; };
  assert.deepEqual(await readGuestImageAdmission(request(), f.env, f.input), { ...result, replayed: true });
  assert.ok(rowReads > 0); assert.ok(proofBatches > 0); assert.deepEqual(snapshot(f), before);
});

const malformedStoredEvent = {
  'extra wrapper key': value => { value.extra = true; },
  'missing wrapper field': value => { delete value.sequence; },
  'nested wrapper field': value => { value.sequence = { unexpected: 1 }; },
  'invalid private JSON': value => { value.private_json = '{broken'; },
  'unsafe nested payload key': value => { const payload = JSON.parse(value.private_json); payload.output_command_envelope.constructor = 'forbidden'; value.private_json = JSON.stringify(payload); },
};
for (const [name, corrupt] of Object.entries(malformedStoredEvent)) test(`flat native-event storage parser refuses ${name}`, async t => {
  const f = await issuedFixture(t), { result } = await admit(f), before = snapshot(f), prepare = f.DB.prepare; let hits = 0;
  function wrap(statement, sql) {
    const bind = statement.bind, all = statement.all;
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql); };
    statement.all = async function (...args) {
      const value = await all.apply(this, args);
      if (/FROM events e JOIN event_private_payloads body/iu.test(sql) && this.bindings.includes(result.eventId)) {
        hits++; const wrapper = JSON.parse(value.results[0].witness); corrupt(wrapper); value.results[0].witness = JSON.stringify(wrapper);
      }
      return value;
    };
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
  await assert.rejects(readGuestImageAdmission(request(), f.env, f.input)); assert.equal(hits, 1); assert.deepEqual(snapshot(f), before);
});

for (const boundary of ['request headers', 'database identity', 'provider configuration', 'payer budget configuration', 'abort', 'original expiry'])
  test(`final admitted proof rechecks ${boundary} after its await`, async t => {
    const f = await issuedFixture(t); await admit(f); const before = snapshot(f), controller = new AbortController();
    const req = new Request(`${origin}/unregistered-admitted-read`, { method: 'POST', headers: { origin }, signal: controller.signal });
    const batch = f.DB.batch; let hits = 0;
    f.DB.batch = async statements => {
      const value = await batch.call(f.DB, statements);
      if (statements.length && statements.every(row => /^SELECT CASE WHEN /u.test(row.sql))) {
        hits++; assert.equal(value[0].results[0].current, 1);
        if (boundary === 'request headers') req.headers.set('x-after-proof', 'changed');
        if (boundary === 'database identity') f.env.DB = { ...f.DB };
        if (boundary === 'provider configuration') f.env.OPENAI_IMAGE_MODEL = 'changed-fixture-model';
        if (boundary === 'payer budget configuration') f.env.FORMA_USER_COST_LIMIT_USD = '999';
        if (boundary === 'abort') controller.abort();
        if (boundary === 'original expiry') t.mock.method(Date, 'now', () => f.issued.expiresAtMs);
      }
      return value;
    };
    await assert.rejects(readGuestImageAdmission(req, f.env, f.input)); assert.equal(hits, 1); assert.deepEqual(snapshot(f), before);
  });

for (const lie of ['absent', 'present NULL']) test(`a ${lie} native authorization-command read cannot manufacture an issued-unadmitted result`, async t => {
  const f = await issuedFixture(t), { result } = await admit(f), before = snapshot(f), prepare = f.DB.prepare; let hits = 0;
  function wrap(statement, sql) {
    const bind = statement.bind, all = statement.all;
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql); };
    statement.all = async function (...args) {
      const value = await all.apply(this, args);
      if (/FROM output_commands WHERE /u.test(sql) && this.bindings.includes(result.commandKey)) {
        hits++; assert.equal(value.results.length, 1, 'original native row exists');
        return { ...value, results: lie === 'absent' ? [] : [{ witness: null }] };
      }
      return value;
    };
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
  await assert.rejects(readGuestImageAdmission(request(), f.env, f.input)); assert.equal(hits, 1); assert.deepEqual(snapshot(f), before);
});

test('concurrent authentic attempts commit one original without double holds and permit fresh exact recovery', async t => {
  const f = await issuedFixture(t), req = request(), first = await createGuestImageAdmissionAuthority(f.request, f.env, f.input),
    second = await createGuestImageAdmissionAuthority(req, f.env, f.input);
  const outcomes = await Promise.allSettled([admitGuestImage(f.request, f.env, first), admitGuestImage(req, f.env, second)]);
  const values = outcomes.filter(value => value.status === 'fulfilled').map(value => value.value);
  assert.equal(values.filter(value => !value.replayed).length, 1);
  const winner = values.find(value => !value.replayed); exactGraph(f, winner);
  for (const value of values) assert.deepEqual({ ...value, replayed: true }, { ...winner, replayed: true });
  const before = snapshot(f); assert.deepEqual(await readGuestImageAdmission(request(), f.env, f.input), { ...winner, replayed: true });
  assert.deepEqual((await admit(f, request())).result, { ...winner, replayed: true }); assert.deepEqual(snapshot(f), before);
});

for (const mode of ['original monotonic deadline', 'abort and late fulfillment']) test(`admission owner await stops at ${mode}`, async t => {
  const f = await issuedFixture(t), controller = new AbortController(), req = new Request(`${origin}/unregistered-native-admission`,
    { method: 'POST', headers: { origin }, signal: controller.signal });
  let monotonicNow = 1000; t.mock.method(performance, 'now', () => monotonicNow);
  const authority = await createGuestImageAdmissionAuthority(req, f.env, f.input), before = snapshot(f); monotonicNow = 11000;
  const batch = f.DB.batch; let release, entered, reads = 0, writes = 0;
  const boundary = new Promise(resolve => { entered = resolve; });
  f.DB.batch = async statements => {
    if (admissionBatch(statements)) writes++;
    const value = await batch.call(f.DB, statements);
    if (statements.every(statement => /^SELECT CASE WHEN /u.test(statement.sql))) {
      reads++; entered(); return new Promise(resolve => { release = () => resolve(value); });
    }
    return value;
  };
  const outcome = admitGuestImage(req, f.env, authority).then(value => ({ value }), error => ({ error }));
  const reached = await Promise.race([boundary.then(() => ({ reached: true })), outcome]);
  assert.equal(reached.reached, true, String(reached.error ?? 'owned proof wait was not reached'));
  monotonicNow = 31000; assert.ok(monotonicNow < 11000 + 30000, 'renewing at entry would incorrectly keep authority live');
  if (mode === 'abort and late fulfillment') { controller.abort(); assert.ok((await outcome).error); }
  release(); assert.ok((await outcome).error); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1); assert.equal(writes, 0); assert.deepEqual(snapshot(f), before);
  t.diagnostic('Original owned deadline captured at1000, reentry11000, late proof31000. No claim of transitive cancellation inside unchanged nested source/approval helpers.');
});

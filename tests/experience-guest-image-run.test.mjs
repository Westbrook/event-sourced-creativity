import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { admittedRunFixture, runGuestImage, readGuestImageRun, assertNativeCompletion, exactOriginalIdentities,
  rows, snapshot, changes, nativeEvents, request, payer, observeRunSql, interceptRunBatch, claimsJob,
  publishesCompletion, financialSnapshot, redactSource, assertKnownCall, createGuestImageExecutionAuthority, requireGuestImageExecution, origin } from './helpers/guest-image-run-fixture.mjs';
const { outputDigest } = await import('../worker/output-disclosure-proof.ts');

function sourceFreeReceipt(f, value, expectedStatus) {
  assert.ok(value && typeof value === 'object');
  assert.deepEqual(Object.keys(value).sort(), ['version', 'status', 'documentId', 'jobId', 'slotId', 'grantId', 'commandKey', 'runEventId',
    'expiresAt', 'replayed', 'admissionCommitted', 'runRequested', 'generationCompleted', 'publicReadAvailable', 'custodyTransferred'].sort());
  assert.equal(value.version, 1); assert.equal(value.status, expectedStatus);
  assert.equal(value.commandKey, f.driver.stageKeys.run); assert.equal(value.admissionCommitted, true);
  assert.equal(value.runRequested, expectedStatus !== 'admitted'); assert.equal(value.generationCompleted, expectedStatus === 'completed');
  assert.equal(value.publicReadAvailable, false); assert.equal(value.expiresAt, f.admitted.expiresAt);
  assert.equal(typeof value.replayed, 'boolean');
  if (expectedStatus === 'admitted') assert.equal(value.runEventId, null); else assert.equal(typeof value.runEventId, 'string');
  assert.equal(value.documentId, f.session.documentId); assert.equal(value.jobId, f.admitted.jobId);
  assert.equal(value.slotId, f.admitted.slotId); assert.equal(value.grantId, f.admitted.grantId);
  assert.equal(value.custodyTransferred, false); assert.ok(Object.isFrozen(value));
  const serialized = JSON.stringify(value);
  for (const secret of [f.subject, f.session.sessionToken, f.session.claimToken, payer, 'SELECT', 'private_json', 'Bearer', 'prompt_ref', 'reserved_microusd'])
    assert.equal(serialized.includes(secret), false, 'Run receipt excludes source, secret and finance data');
}
function assertPaidPreserved(f, count = 2) {
  exactOriginalIdentities(f);
  const calls = rows(f, 'output_provider_calls'); assert.equal(calls.length, count);
  for (const call of calls) assertKnownCall(f, call);
  const token = rows(f, 'budget_reservations')[0], cost = rows(f, 'cost_budget_reservations')[0];
  assert.equal(token.status, 'settled'); assert.equal(token.used_tokens, 200 * count); assert.equal(cost.status, 'settled');
  assert.equal(cost.used_microusd, count === 1 ? 1200 : 4200);
  assert.equal(cost.used_microusd, calls.reduce((sum, call) => sum + call.used_microusd, 0));
  assert.ok(cost.used_microusd > 0);
}
async function deniedOrStopped(operation) { try { return await operation; } catch (error) { assert.ok(error instanceof Error); return null; } }
function captureSql(t, f, observed, memory) {
  const measured = observed.statements;
  t.diagnostic(JSON.stringify({ memory, statements: measured.length, uniqueSql: new Set(measured.map(row => row.sql)).size,
    maximumBindings: Math.max(0, ...measured.map(row => row.bindings)), maximumSqlBytes: Math.max(0, ...measured.map(row => row.sqlBytes)),
    providerStages: f.provider.calls.map(call => call.stage), mediaCalls: f.storage.calls.map(call => call.method), fakeWireOnly: true }));
  if (process.env.FORMA_RUN_SQL_CAPTURE_DIR) {
    const order = { table: 0, index: 1, view: 2, trigger: 3 };
    const schema = f.admittedSnapshot.schema.filter(row => row.sql && !row.name.startsWith('sqlite_'))
      .sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name)).map(row => row.sql);
    writeFileSync(join(process.env.FORMA_RUN_SQL_CAPTURE_DIR, memory ? 'complete-memory.json' : 'absent-memory.json'),
      JSON.stringify({ memory, schema, statements: measured }, null, 2) + '\n', { flag: 'wx' });
  }
}

// Qualification explicitly runs ONLY these two cases first. Every negative
// case below is gated externally until both genuine native positives pass.
for (const memory of [false, true]) test(`positive native guest Run with ${memory ? 'complete' : 'absent'} Memory reaches the genuine Image terminal graph`, { timeout: 30000 }, async t => {
  const f = await admittedRunFixture(t, { memory }), observed = observeRunSql(f);
  try {
    const result = await runGuestImage(f.request, f.env, f.runInput);
    sourceFreeReceipt(f, result, 'completed'); assertNativeCompletion(f);
    const runCommands = rows(f, 'output_commands').filter(row => row.action === 'run'); assert.equal(runCommands.length, 1);
    assert.equal(runCommands[0].command_key, f.driver.stageKeys.run);
    const runEvent = nativeEvents(f).find(event => event.eventId === runCommands[0].event_id); assert.ok(runEvent);
    assert.equal(runEvent.sequence, f.committed.head + 6); assert.equal(runEvent.actor, f.session.guestSubject);
    assert.equal(runEvent.type, 'OutputExecutionRunRequested');
    assert.deepEqual(runEvent.payload.output_command_envelope, { action: 'run', documentId: f.session.documentId,
      expectedRevision: `output:${f.committed.head + 5}`, clientMutationId: f.driver.stageKeys.run, grantId: f.admitted.grantId });
    assert.equal(runCommands[0].request_digest, await outputDigest(runEvent.payload.output_command_envelope));
    assert.equal(result.runEventId, runEvent.eventId);
    const after = snapshot(f), count = changes(f), mediaCalls = structuredClone(f.storage.calls), transportCount = f.provider.calls.length;
    observed.readOnly = true; f.provider.blocked = true;
    const replay = await runGuestImage(request(), f.env, f.runInput), current = await readGuestImageRun(request(), f.env, f.input);
    sourceFreeReceipt(f, replay, 'completed'); sourceFreeReceipt(f, current, 'completed');
    assert.equal(replay.replayed, true); assert.equal(current.replayed, true);
    assert.deepEqual({ ...replay, replayed: false }, { ...result, replayed: false });
    assert.deepEqual({ ...current, replayed: false }, { ...result, replayed: false });
    assert.deepEqual(snapshot(f), after); assert.equal(changes(f), count);
    assert.deepEqual(f.storage.calls, mediaCalls); assert.equal(f.provider.calls.length, transportCount);
  } finally { captureSql(t, f, observed, memory); observed.restore(); }
});

for (const fault of ['lost acknowledgment', 'false acknowledgment', 'success with error', 'inherited error', 'accessor error', 'sparse acknowledgment', 'wrong changed count'])
  test(`Run refuses ${fault} for a committed first job claim without dispatch or reclaim`, async t => {
    const f = await admittedRunFixture(t), originalFinance = financialSnapshot(f);
    const hook = interceptRunBatch(f, claimsJob, (value, statements) => {
      if (fault === 'lost acknowledgment') throw new Error('synthetic lost native job claim ACK');
      const result = value.slice();
      if (fault === 'sparse acknowledgment') delete result[0];
      else if (fault === 'inherited error') result[0] = Object.assign(Object.create({ error: undefined }), result[0]);
      else if (fault === 'accessor error') Object.defineProperty(result[0] = { ...result[0] }, 'error', { get() { throw new Error('ACK getter must never execute'); } });
      else if (fault === 'wrong changed count') {
        const index = statements.findIndex(row => /UPDATE\s+document_jobs\s+SET\s+status='running'/iu.test(row.sql)); assert.ok(index >= 0);
        result[index] = { ...result[index], meta: { ...result[index].meta, changes: 0 } };
      } else result[0] = { ...result[0], ...(fault === 'false acknowledgment' ? { success: false } : { error: 'synthetic-error' }) };
      return result;
    });
    try { await assert.rejects(runGuestImage(f.request, f.env, f.runInput)); } finally { hook.restore(); }
    assert.equal(hook.calls, 1); assert.equal(f.provider.calls.length, 0); assert.equal(f.storage.calls.length, 0);
    const job = rows(f, 'document_jobs')[0]; assert.equal(job.status, 'running'); assert.equal(job.attempt_count, 1);
    assert.equal(rows(f, 'budget_reservations')[0].status, 'active'); assert.equal(rows(f, 'cost_budget_reservations')[0].status, 'active');
    for (const table of ['budget_counters', 'cost_budget_counters']) assert.deepEqual(rows(f, table), originalFinance[table]);
    exactOriginalIdentities(f);
    const after = snapshot(f), count = changes(f), observed = observeRunSql(f); observed.readOnly = true;
    try {
      const current = await readGuestImageRun(request(), f.env, f.input); sourceFreeReceipt(f, current, 'running');
      const replay = await runGuestImage(request(), f.env, f.runInput); sourceFreeReceipt(f, replay, 'running');
      assert.equal(replay.replayed, true); assert.deepEqual(snapshot(f), after); assert.equal(changes(f), count);
      assert.equal(f.provider.calls.length, 0);
    } finally { observed.restore(); }
  });

for (const stage of ['planner', 'image']) test(`unknown ${stage} outcome retains original exposure and fresh Run never dispatches twice`, async t => {
  const f = await admittedRunFixture(t); f.provider[`${stage}Failure`] = new Error('synthetic connection loss after possible provider acceptance');
  await deniedOrStopped(runGuestImage(f.request, f.env, f.runInput)); exactOriginalIdentities(f);
  const calls = rows(f, 'output_provider_calls'); assert.equal(calls.length, stage === 'planner' ? 1 : 2);
  const unresolved = calls.find(call => call.stage_key === (stage === 'planner' ? 'planning:initial' : 'image:initial'));
  assert.ok(unresolved && ['pending', 'uncertain'].includes(unresolved.status) && unresolved.used_microusd === null);
  if (stage === 'image') assertKnownCall(f, calls.find(call => call.stage_key === 'planning:initial'));
  for (const table of ['budget_counters', 'cost_budget_counters']) assert.deepEqual(rows(f, table), f.admittedSnapshot.contents[table]);
  assert.equal(rows(f, 'budget_reservations')[0].reserved_tokens, f.initialToken.reserved_tokens);
  assert.equal(rows(f, 'cost_budget_reservations')[0].reserved_microusd, f.initialCost.reserved_microusd);
  assert.equal(rows(f, 'cost_budget_reservations')[0].status, 'executing');
  assert.equal(rows(f, 'budget_reservations')[0].status, 'active'); assert.notEqual(rows(f, 'output_operation_slots')[0].status, 'succeeded');
  assert.equal(nativeEvents(f).filter(event => event.type === 'GenerationCompleted').length, 0);
  const after = snapshot(f), providerCount = f.provider.calls.length; f.provider.blocked = true;
  await deniedOrStopped(runGuestImage(request(), f.env, f.runInput));
  assert.equal(f.provider.calls.length, providerCount); assert.deepEqual(snapshot(f), after);
});

test('known planner and Image charges survive native guarded R2 failure', async t => {
  const f = await admittedRunFixture(t); f.storage.beforePut = () => { throw new Error('synthetic guarded R2 failure'); };
  await deniedOrStopped(runGuestImage(f.request, f.env, f.runInput)); assertPaidPreserved(f);
  assert.equal(nativeEvents(f).filter(event => event.type === 'GenerationCompleted').length, 0);
  assert.notEqual(rows(f, 'document_jobs')[0].status, 'completed'); assert.notEqual(rows(f, 'output_operation_slots')[0].status, 'succeeded');
  assert.equal(f.storage.objects.size, 0);
  const after = snapshot(f), counts = f.provider.calls.length; f.provider.blocked = true;
  await deniedOrStopped(runGuestImage(request(), f.env, f.runInput)); assert.deepEqual(snapshot(f), after); assert.equal(f.provider.calls.length, counts);
});

test('known charges survive rejected native GenerationCompleted transaction', async t => {
  const f = await admittedRunFixture(t);
  const hook = interceptRunBatch(f, publishesCompletion, statements => {
    return [...statements, f.DB.prepare('INSERT INTO output_atomic_assertions(token,passed) VALUES(?,?)').bind('synthetic-guest-publication-failure', 0)];
  }, { before: true });
  try { await deniedOrStopped(runGuestImage(f.request, f.env, f.runInput)); } finally { hook.restore(); }
  assert.equal(hook.calls, 1); assertPaidPreserved(f);
  assert.equal(nativeEvents(f).filter(event => event.type === 'GenerationCompleted').length, 0);
  assert.notEqual(rows(f, 'document_jobs')[0].status, 'completed'); assert.notEqual(rows(f, 'output_operation_slots')[0].status, 'succeeded');
});

test('concurrent Run while the original planner awaits cannot acquire a second dispatch or hold', async t => {
  const f = await admittedRunFixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.provider.beforeResponse = async call => { if (call.stage === 'planner') { entered.resolve(); await release.promise; } };
  let running;
  try {
    running = runGuestImage(f.request, f.env, f.runInput); await entered.promise;
    const finance = financialSnapshot(f), before = snapshot(f), counts = f.provider.calls.length;
    const current = await readGuestImageRun(request(), f.env, f.input); sourceFreeReceipt(f, current, 'running');
    const replay = await runGuestImage(request(), f.env, f.runInput); sourceFreeReceipt(f, replay, 'running');
    assert.deepEqual(snapshot(f), before); assert.deepEqual(financialSnapshot(f), finance); assert.equal(f.provider.calls.length, counts);
    release.resolve(); sourceFreeReceipt(f, await running, 'completed'); assertNativeCompletion(f);
  } finally { release.resolve(); if (running) await running.catch(() => {}); }
});

for (const boundary of ['source after planner', 'approval after planner', 'source after image', 'approval after image'])
  test(`late ${boundary} blocks further creative work while preserving known observed charges`, async t => {
    const f = await admittedRunFixture(t), target = boundary.endsWith('planner') ? 'planner' : 'image'; let changed = false;
    f.provider.beforeResponse = call => {
      if (call.stage !== target) return; changed = true;
      if (boundary.startsWith('source')) redactSource(f);
      else f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
    };
    await deniedOrStopped(runGuestImage(f.request, f.env, f.runInput)); assert.equal(changed, true);
    assertPaidPreserved(f, target === 'planner' ? 1 : 2);
    assert.equal(f.provider.image, target === 'planner' ? 0 : 1); assert.equal(f.storage.objects.size, 0);
    assert.equal(nativeEvents(f).filter(event => event.type === 'GenerationCompleted').length, 0);
  });

test('late completed Run read cannot disclose metadata after payer approval is revoked', async t => {
  const f = await admittedRunFixture(t); await runGuestImage(f.request, f.env, f.runInput); assertNativeCompletion(f);
  f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
  const before = snapshot(f), count = f.provider.calls.length; f.provider.blocked = true;
  await assert.rejects(readGuestImageRun(request(), f.env, f.input));
  await assert.rejects(runGuestImage(request(), f.env, f.runInput));
  assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, count);
});

test('lost native Run transition ACK recovers only its exact original command and never purchases twice', async t => {
  const f = await admittedRunFixture(t);
  const hook = interceptRunBatch(f, statements => statements.some(row => /INSERT INTO output_commands/iu.test(row.sql) && row.sql.includes("'run'")), () => {
    throw new Error('synthetic lost Run transition ACK after commit');
  });
  let result;
  try { result = await runGuestImage(f.request, f.env, f.runInput); } finally { hook.restore(); }
  assert.equal(hook.calls, 1); sourceFreeReceipt(f, result, 'completed'); assert.equal(result.replayed, true); assertNativeCompletion(f);
  const after = snapshot(f), calls = f.provider.calls.length; f.provider.blocked = true;
  assert.deepEqual(await runGuestImage(request(), f.env, f.runInput), result);
  assert.deepEqual(snapshot(f), after); assert.equal(f.provider.calls.length, calls);
});

for (const field of ['provider_submission_id', 'title']) test(`retained completion rejects changed ${field} with its original public envelope intact`, async t => {
  const f = await admittedRunFixture(t); await runGuestImage(f.request, f.env, f.runInput); const { event } = assertNativeCompletion(f);
  const { publicEventPayload } = await import('../worker/event-privacy.ts');
  const body = { ...event.payload, [field]: 'changed-retained-value' };
  const originalPublic = JSON.parse(rows(f, 'events').find(row => row.event_id === event.eventId).payload);
  assert.deepEqual(publicEventPayload(event.eventId, body, true).payload, originalPublic, 'target field is private; public envelope is not independently invalidated');
  f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body), event.eventId);
  const before = snapshot(f); await assert.rejects(readGuestImageRun(request(), f.env, f.input)); assert.deepEqual(snapshot(f), before);
});

for (const fault of ['negative input tokens', 'missing provider response identity']) test(`settled native call refuses ${fault} without rewriting incurred accounting`, async t => {
  const f = await admittedRunFixture(t); await runGuestImage(f.request, f.env, f.runInput); assertNativeCompletion(f);
  const call = rows(f, 'output_provider_calls').find(row => row.stage_key === 'planning:initial');
  if (fault === 'missing provider response identity') f.sqlite.prepare('UPDATE output_provider_calls SET provider_response_id=NULL WHERE client_request_id=?').run(call.client_request_id);
  else {
    const job = rows(f, 'document_jobs')[0], result = JSON.parse(job.result_json); result.providerSubmissions[call.client_request_id].inputTokens = -1;
    f.sqlite.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=?').run(JSON.stringify(result), job.job_id);
  }
  const before = snapshot(f); await assert.rejects(readGuestImageRun(request(), f.env, f.input)); assert.deepEqual(snapshot(f), before);
});

test('uncertain Image exposure rejects regression of its executing cost hold to active', async t => {
  const f = await admittedRunFixture(t); f.provider.imageFailure = new Error('synthetic unknown render');
  await deniedOrStopped(runGuestImage(f.request, f.env, f.runInput));
  assert.ok(await readGuestImageRun(request(), f.env, f.input), 'genuine original unknown graph is readable before the single-field corruption');
  assert.equal(rows(f, 'cost_budget_reservations')[0].status, 'executing');
  f.sqlite.exec("UPDATE cost_budget_reservations SET status='active'");
  const before = snapshot(f); await assert.rejects(readGuestImageRun(request(), f.env, f.input)); assert.deepEqual(snapshot(f), before);
});

test('same execution capability refuses replacement of an already observed private planner body', async t => {
  const f = await admittedRunFixture(t); await runGuestImage(f.request, f.env, f.runInput); const { body } = assertNativeCompletion(f);
  const authority = await createGuestImageExecutionAuthority(f.request, f.env, f.runInput), view = requireGuestImageExecution(f.request, f.env, authority);
  const raw = rows(f, 'private_content').find(row => row.content_id === body.output_ref), changed = { ...JSON.parse(raw.content), scene: 'Different retained scene' };
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(JSON.stringify(changed), raw.content_id);
  const before = snapshot(f); await assert.rejects(view.refresh()); assert.deepEqual(snapshot(f), before);
});

test('midflight client abort retains the original uncertain planner claim and prevents later stages', async t => {
  const f = await admittedRunFixture(t), controller = new AbortController(), entered = Promise.withResolvers(), released = Promise.withResolvers();
  const req = new Request(`${origin}/unregistered-guest-image-output`, { method: 'POST', headers: { origin }, signal: controller.signal });
  f.provider.beforeResponse = async call => { if (call.stage === 'planner') { entered.resolve(); await released.promise; throw new DOMException('Synthetic in-flight cancellation', 'AbortError'); } };
  let pending;
  try {
    pending = runGuestImage(req, f.env, f.runInput); void pending.catch(() => {}); await entered.promise;
    const transportSignal = f.provider.calls.find(call => call.stage === 'planner').signal;
    assert.equal(transportSignal.aborted, false, 'original foreground transport is live before client abort');
    controller.abort(); await Promise.resolve();
    assert.equal(transportSignal.aborted, true, 'client abort reaches the actual native provider transport signal');
    released.resolve(); await assert.rejects(pending);
    // Drain already scheduled local abort continuations; no timer or provider retry.
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    exactOriginalIdentities(f); assert.equal(f.provider.planner, 1); assert.equal(f.provider.safety, 0); assert.equal(f.provider.image, 0);
    const calls = rows(f, 'output_provider_calls'); assert.equal(calls.length, 1); assert.ok(['pending', 'uncertain'].includes(calls[0].status));
    assert.equal(calls[0].used_microusd, null); assert.equal(rows(f, 'budget_reservations')[0].status, 'active');
    assert.equal(rows(f, 'cost_budget_reservations')[0].status, 'executing'); assert.equal(f.storage.calls.length, 0);
  } finally { released.resolve(); if (pending) await pending.catch(() => {}); }
});

test('a late guarded storage ACK after source retirement cannot publish but preserves both known charges', async t => {
  const f = await admittedRunFixture(t); let retired = false;
  f.storage.afterPut = () => { retired = true; redactSource(f); };
  await deniedOrStopped(runGuestImage(f.request, f.env, f.runInput)); assert.equal(retired, true); assertPaidPreserved(f);
  assert.equal(nativeEvents(f).filter(event => event.type === 'GenerationCompleted').length, 0);
  assert.notEqual(rows(f, 'output_operation_slots')[0].status, 'succeeded');
  assert.equal(f.storage.calls.filter(call => call.method === 'put').length, 1);
});

for (const write of ['provider claim', 'slot transition']) test(`zero-change ${write} ACK preserves pending ownership and refuses every provider dispatch`, async t => {
  const f = await admittedRunFixture(t);
  const hook = interceptRunBatch(f, statements => statements.some(row => /INSERT\s+INTO\s+output_provider_calls\b/iu.test(row.sql)), (result, statements) => {
    const match = write === 'provider claim' ? /INSERT\s+INTO\s+output_provider_calls\b/iu : /UPDATE\s+output_operation_slots\s+SET/iu;
    const index = statements.findIndex(row => match.test(row.sql)); assert.ok(index >= 0);
    const ack = result.slice(); ack[index] = { ...ack[index], meta: { ...ack[index].meta, changes: 0 } }; return ack;
  });
  try { await deniedOrStopped(runGuestImage(f.request, f.env, f.runInput)); } finally { hook.restore(); }
  assert.equal(hook.calls, 1); exactOriginalIdentities(f); assert.equal(f.provider.calls.length, 0);
  const calls = rows(f, 'output_provider_calls'); assert.equal(calls.length, 1); assert.ok(['pending', 'uncertain'].includes(calls[0].status));
  assert.equal(calls[0].used_microusd, null); assert.equal(rows(f, 'budget_reservations')[0].status, 'active');
  assert.equal(rows(f, 'cost_budget_reservations')[0].status, 'executing');
  const before = snapshot(f), count = changes(f); await deniedOrStopped(runGuestImage(request(), f.env, f.runInput));
  assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count); assert.equal(f.provider.calls.length, 0);
});

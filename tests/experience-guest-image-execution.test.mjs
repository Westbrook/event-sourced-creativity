import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admittedRunFixture, createGuestImageExecutionAuthority, requireGuestImageExecution, runGuestImage,
  rows, snapshot, changes, request, payer, origin, redactSource, addLease, observeRunSql } from './helpers/guest-image-run-fixture.mjs';
const [{ executeGuestImageEvents }, { createGuestImageEventExecution }, { readGuestImageAdmission }] = await Promise.all([
  import('../worker/events-api.ts'), import('../worker/output-execution-control.ts'), import('../worker/experience-guest-image-admission.ts'),
]);
const rejected = value => assert.rejects(Promise.resolve().then(value));

// These cases are run only after the two complete genuine Run positives pass.
test('execution authority seals the original guest actor, payer, exact recipe and source epochs without a write', async t => {
  const f = await admittedRunFixture(t), before = snapshot(f), count = changes(f), observed = observeRunSql(f); observed.readOnly = true;
  try {
    const authority = await createGuestImageExecutionAuthority(f.request, f.env, f.runInput);
    assert.deepEqual(Object.keys(authority), []); assert.equal(Object.getPrototypeOf(authority), null); assert.ok(Object.isFrozen(authority));
    const view = requireGuestImageExecution(f.request, f.env, authority);
    assert.deepEqual(view.identity, { actorKind: 'guest', actorUserId: f.session.guestSubject, ownerUserId: f.session.guestSubject,
      streamId: `creative:${f.session.guestSubject}`, payerUserId: payer });
    assert.equal(view.scope.actorUserId, f.session.guestSubject); assert.equal(view.slot.slotId, f.admitted.slotId); assert.equal(view.job.job_id, f.admitted.jobId);
    assert.equal(view.slot.tokenReservationId, f.initialToken.reservation_id); assert.equal(view.slot.costReservationId, f.initialCost.reservation_id);
    assert.deepEqual(view.settings, f.quoted.preflight.targets[0].settings); assert.equal(view.expiresAtMs, f.issued.expiresAtMs);
    assert.equal(rows(f, 'output_plan_revisions')[0].source_head, f.committed.head + 1);
    assert.equal(f.envelope.sourceRevision, f.committed.head + 3); assert.deepEqual(view.proof.preflight, f.quoted.preflight);
    assert.equal(view.proof.head, f.committed.head + 5);
    assert.ok(Object.isFrozen(view)); assert.ok(Object.isFrozen(view.identity)); assert.ok(Object.isFrozen(view.settings));
    assert.deepEqual(snapshot(f), before); assert.equal(changes(f), count); assert.equal(f.provider.calls.length, 0);
  } finally { observed.restore(); }
});

for (const defect of ['false consent', 'missing consent', 'wrong command', 'authorize command', 'extra key', 'inherited consent', 'accessor consent'])
  test(`execution authority refuses ${defect} before a native mutation or dispatch`, async t => {
    const f = await admittedRunFixture(t), before = snapshot(f); let accesses = 0, input = { ...f.runInput };
    if (defect === 'false consent') input.explicitRun = false;
    if (defect === 'missing consent') delete input.explicitRun;
    if (defect === 'wrong command') input.commandKey += '-other';
    if (defect === 'authorize command') input.commandKey = f.driver.stageKeys.authorize;
    if (defect === 'extra key') input.ownerUserId = payer;
    if (defect === 'inherited consent') { delete input.explicitRun; input = Object.assign(Object.create({ explicitRun: true }), input); }
    if (defect === 'accessor consent') Object.defineProperty(input, 'explicitRun', { enumerable: true, get() { accesses++; return true; } });
    await assert.rejects(createGuestImageExecutionAuthority(f.request, f.env, input));
    assert.equal(accesses, 0); assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, 0);
  });

for (const defect of ['cloned capability', 'plain guest identity', 'different request', 'different environment', 'replaced database', 'forged claimed row'])
  test(`execution capability rejects ${defect}`, async t => {
    const f = await admittedRunFixture(t), authority = await createGuestImageExecutionAuthority(f.request, f.env, f.runInput), before = snapshot(f);
    let req = f.request, env = f.env, cap = authority, claimed;
    if (defect === 'cloned capability') cap = structuredClone(authority);
    if (defect === 'plain guest identity') cap = { actorKind: 'guest', actorUserId: f.session.guestSubject, payerUserId: payer };
    if (defect === 'different request') req = request();
    if (defect === 'different environment') env = { ...f.env };
    if (defect === 'replaced database') f.env.DB = { ...f.DB };
    if (defect === 'forged claimed row') claimed = { ...f.initialJob, output_slot_id: f.admitted.slotId, status: 'running', attempt_count: 1, correlation_id: `${f.admitted.jobId}:attempt:1` };
    await rejected(() => requireGuestImageExecution(req, env, cap, claimed));
    assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, 0);
  });

for (const defect of ['source retired', 'approval revoked', 'claim lease', 'sponsor disabled', 'native held amount changed', 'source plan revision changed'])
  test(`execution proof refuses retained ${defect} without a purchase`, async t => {
    const f = await admittedRunFixture(t);
    if (defect === 'source retired') redactSource(f);
    if (defect === 'approval revoked') f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
    if (defect === 'claim lease') addLease(f);
    if (defect === 'sponsor disabled') f.sqlite.exec('UPDATE experience_sponsor_campaigns SET enabled=0');
    if (defect === 'native held amount changed') f.sqlite.exec('UPDATE cost_budget_reservations SET reserved_microusd=reserved_microusd+1');
    if (defect === 'source plan revision changed') f.sqlite.exec('UPDATE output_plan_revisions SET source_head=source_head+1');
    const before = snapshot(f); await assert.rejects(createGuestImageExecutionAuthority(f.request, f.env, f.runInput));
    assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, 0); assert.equal(f.storage.calls.length, 0);
  });

test('execution refuses nonfinite owner deadlines and abort before any work', async t => {
  const f = await admittedRunFixture(t), before = snapshot(f);
  for (const deadline of [NaN, Infinity, -Infinity]) await assert.rejects(createGuestImageExecutionAuthority(f.request, f.env, f.runInput, deadline));
  const controller = new AbortController(); controller.abort();
  const req = new Request(`${origin}/unregistered-guest-image-output`, { method: 'POST', headers: { origin }, signal: controller.signal });
  await assert.rejects(createGuestImageExecutionAuthority(req, f.env, f.runInput));
  assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, 0);
});

test('a captured execution owner deadline is not renewed by a later refresh or late proof result', async t => {
  const f = await admittedRunFixture(t); let monotonic = 1000; t.mock.method(performance, 'now', () => monotonic);
  const authority = await createGuestImageExecutionAuthority(f.request, f.env, f.runInput, 31000), originalBatch = f.DB.batch;
  monotonic = 11000; const entered = Promise.withResolvers(), released = Promise.withResolvers(); let localBatches = 0;
  f.DB.batch = async statements => { localBatches++; if (localBatches === 1) { entered.resolve(); await released.promise; } return originalBatch.call(f.DB, statements); };
  let pending;
  try {
    pending = requireGuestImageExecution(f.request, f.env, authority).refresh(); await entered.promise;
    const capturedBatches = localBatches; monotonic = 31000; released.resolve(); await assert.rejects(pending);
    assert.equal(localBatches, capturedBatches, 'expired local owner performs no subsequent DB batch after the late proof resolves');
    assert.equal(f.provider.calls.length, 0); assert.equal(f.storage.calls.length, 0);
    await rejected(() => requireGuestImageExecution(f.request, f.env, authority));
  } finally { released.resolve(); if (pending) await pending.catch(() => {}); f.DB.batch = originalBatch; }
});

test('cold replacement database never installs schema or initializes a balance', async t => {
  const f = await admittedRunFixture(t), before = snapshot(f); let reads = 0, writes = 0;
  const cold = { prepare(sql) { reads++; if (/CREATE|INSERT|UPDATE|DELETE|ALTER|DROP/iu.test(sql)) writes++; throw new Error('cold database unavailable'); },
    batch() { writes++; throw new Error('cold database unavailable'); } };
  await assert.rejects(createGuestImageExecutionAuthority(f.request, { ...f.env, DB: cold }, f.runInput));
  assert.equal(writes, 0); assert.ok(reads <= 1); assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, 0);
});

test('no forged heartbeat control or unclaimed row can enter the native Image engine', async t => {
  const f = await admittedRunFixture(t), authority = await createGuestImageExecutionAuthority(f.request, f.env, f.runInput), before = snapshot(f);
  await assert.rejects(executeGuestImageEvents(f.request, f.env, authority, {}));
  await assert.rejects(createGuestImageEventExecution(f.request, f.env, authority, { ...f.initialJob, output_slot_id: f.admitted.slotId }));
  assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, 0); assert.equal(f.storage.calls.length, 0);
});

test('old strict admitted-only reader refuses genuine Run descendants', async t => {
  const f = await admittedRunFixture(t); await runGuestImage(f.request, f.env, f.runInput);
  const before = snapshot(f); await assert.rejects(readGuestImageAdmission(request(), f.env, f.input));
  assert.deepEqual(snapshot(f), before); assert.equal(rows(f, 'output_provider_calls').length, 2);
});

for (const change of ['original expiry', 'provider model', 'payer budget limit']) test(`captured capability rejects changed ${change} at the final local guard`, async t => {
  const f = await admittedRunFixture(t), authority = await createGuestImageExecutionAuthority(f.request, f.env, f.runInput), before = snapshot(f);
  if (change === 'original expiry') t.mock.method(Date, 'now', () => f.issued.expiresAtMs + 1);
  if (change === 'provider model') f.env.OPENAI_IMAGE_MODEL = 'different-model';
  if (change === 'payer budget limit') f.env.FORMA_USER_COST_LIMIT_USD = '0.01';
  await rejected(() => requireGuestImageExecution(f.request, f.env, authority));
  assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, 0);
});

for (const invalid of ['false proof', 'NULL proof', 'error alongside success']) test(`execution proof refuses ${invalid} from the actual native read batch`, async t => {
  const f = await admittedRunFixture(t), before = snapshot(f), batch = f.DB.batch; let intercepted = false;
  f.DB.batch = async statements => {
    const result = await batch.call(f.DB, statements);
    const index = statements.findIndex(row => /SELECT CASE WHEN[\s\S]*AS current/iu.test(row.sql));
    if (!intercepted && index >= 0) {
      intercepted = true;
      if (invalid === 'error alongside success') result[index] = { ...result[index], error: 'synthetic-native-read-error' };
      else result[index] = { ...result[index], results: [{ current: invalid === 'NULL proof' ? null : 0 }] };
    }
    return result;
  };
  try { await assert.rejects(createGuestImageExecutionAuthority(f.request, f.env, f.runInput)); } finally { f.DB.batch = batch; }
  assert.equal(intercepted, true); assert.deepEqual(snapshot(f), before); assert.equal(f.provider.calls.length, 0);
});

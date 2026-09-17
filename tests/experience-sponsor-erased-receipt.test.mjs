import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture, actor, payer, stream, init, freshRun, installImageTransport} from './sponsor-native-fixture.mjs';

const [{handleEventPrivacy}, {reconcileKnownOutputProviderReceipts}] = await Promise.all([
  import('../worker/privacy-api.ts'), import('../worker/output-execution-control.ts'),
]);

const count = (f, table) => f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
function financialRows(f) {
  return Object.fromEntries(['budget_reservations', 'cost_budget_reservations', 'budget_counters', 'cost_budget_counters',
    'output_provider_calls', 'experience_sponsor_consumptions', 'experience_sponsor_active_jobs'].map(table =>
    [table, f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function actorCounters(f) {
  return Object.fromEntries(['budget_counters', 'cost_budget_counters'].map(table =>
    [table, f.sqlite.prepare(`SELECT * FROM ${table} WHERE scope='user' AND scope_id=? ORDER BY rowid`).all(actor)]));
}
function privateBodies(f) {
  return f.sqlite.prepare('SELECT private_event_id,owner_id,private_json,redacted_at FROM event_private_payloads ORDER BY rowid').all();
}

for (const fault of ['account settlement', 'image call ledger']) test(`${fault} interruption settles original sponsor receipts after source erasure without dispatch`, async t => {
  // Every provider interaction is intercepted before fixture setup. The only
  // failure injection is a rejected local ledger batch, never invented usage.
  const transport = installImageTransport(t), f = await fixture(t), sponsor = await f.sponsor();
  await f.execute(sponsor.authority);
  const run = await freshRun(f), actorBefore = actorCounters(f);
  await run.queue();
  const nativeBatch = f.DB.batch.bind(f.DB);
  let failedWrites = 0;
  f.DB.batch = async statements => {
    const interrupted = fault === 'account settlement'
      ? statements.some(statement => /^UPDATE budget_reservations SET used_tokens=/u.test(statement.sql))
        && statements.some(statement => /^UPDATE cost_budget_reservations SET used_microusd=/u.test(statement.sql))
      : statements.some(statement => /^UPDATE output_provider_calls SET used_microusd=/u.test(statement.sql)
        && statement.bindings[1] === 'settled' && statement.bindings[6] === 'image:initial');
    if (interrupted) {
      failedWrites++;
      throw Error(`injected sponsor ${fault} unavailable`);
    }
    return nativeBatch(statements);
  };
  await run.drive();
  f.DB.batch = nativeBatch;
  // The runner may return its earlier in-memory receipt. Reconciliation acts on
  // canonical job evidence, including the source-free observation fallback.
  const failed = f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(run.jobId);
  assert.ok(failedWrites > 0, 'real provider receipts reached the interrupted financial batch');
  assert.equal(failed.status, 'failed', JSON.stringify(failed));
  assert.deepEqual(transport.counts(), {plannerCalls: 1, imageCalls: 1, safetyCalls: 1});

  const checkpoint = JSON.parse(failed.result_json), receipts = Object.values(checkpoint.providerSubmissions ?? {});
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every(receipt => receipt.status === 'completed'), JSON.stringify(receipts));
  assert.deepEqual(receipts.map(receipt => receipt.providerRequestId).sort(), ['direction-1', 'image-1']);
  assert.equal(receipts.reduce((sum, receipt) => sum + receipt.totalTokens, 0), 400);
  const expectedCost = receipts.reduce((sum, receipt) => sum + receipt.costMicrousd, 0);
  assert.ok(Number.isSafeInteger(expectedCost) && expectedCost > 0);
  const recordedCalls = f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY rowid').all();
  assert.equal(recordedCalls.length, 2);
  if (fault === 'account settlement') {
    assert.ok(recordedCalls.every(call => call.status === 'settled'), JSON.stringify(recordedCalls));
    assert.equal(recordedCalls.reduce((sum, call) => sum + call.used_microusd, 0), expectedCost);
  } else {
    const imageCall = recordedCalls.find(call => call.stage_key === 'image:initial');
    assert.ok(['pending', 'uncertain'].includes(imageCall.status), JSON.stringify(imageCall));
    assert.equal(imageCall.used_microusd, null);
    assert.equal(recordedCalls.find(call => call.stage_key === 'planning:initial').status, 'settled');
  }
  assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status, 'active');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status, 'executing');
  assert.equal(count(f, 'experience_sponsor_active_jobs'), 1);
  const held = financialRows(f), consumption = held.experience_sponsor_consumptions;
  const authoredBodies = privateBodies(f).filter(row => row.private_json.includes('A pear orchard beside a stone wall'));
  assert.ok(authoredBodies.length > 0, 'the actual authored source exists before erasure');

  const erased = await handleEventPrivacy(new Request('http://localhost/api/event-privacy', init({
    action: 'erase-personal-authored-context', confirmation: 'ERASE_MY_PERSONAL_AUTHORED_CONTEXT',
  })), f.env);
  assert.equal(erased.status, 200, await erased.clone().text());
  const redacted = privateBodies(f);
  for (const authored of authoredBodies) {
    const erasedBody = redacted.find(row => row.private_event_id === authored.private_event_id);
    assert.ok(erasedBody, 'erasure retains the original private-event identity');
    assert.equal(erasedBody.private_json, ''); assert.notEqual(erasedBody.redacted_at, null);
  }
  assert.deepEqual(financialRows(f), held, 'source erasure does not release unresolved financial exposure');
  // Historical financial reconciliation must not need an active campaign or
  // permission to regenerate the now-erased creative source.
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}'");
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
  const requestsBefore = transport.calls.length;
  let forbiddenDispatches = 0;
  t.mock.method(globalThis, 'fetch', async () => { forbiddenDispatches++; throw Error('source-free reconciliation must not dispatch'); });
  const result = await reconcileKnownOutputProviderReceipts(f.env, run.trusted.principal, {jobId: run.jobId});
  assert.deepEqual(result, {reconciled: 1, status: 'known'});

  const tokens = f.sqlite.prepare('SELECT * FROM budget_reservations').all();
  const dollars = f.sqlite.prepare('SELECT * FROM cost_budget_reservations').all();
  assert.equal(tokens.length, 1); assert.equal(dollars.length, 1);
  for (const reservation of [tokens[0], dollars[0]]) {
    assert.equal(reservation.owner_id, payer); assert.equal(reservation.stream_id, stream);
    assert.equal(reservation.correlation_id, failed.correlation_id); assert.equal(reservation.status, 'settled');
  }
  assert.equal(tokens[0].used_tokens, 400); assert.equal(dollars[0].used_microusd, expectedCost);
  for (const [scope, scopeId] of [['user', payer], ['workspace', 'forma']]) {
    const token = f.sqlite.prepare('SELECT * FROM budget_counters WHERE scope=? AND scope_id=?').get(scope, scopeId);
    const cost = f.sqlite.prepare('SELECT * FROM cost_budget_counters WHERE scope=? AND scope_id=?').get(scope, scopeId);
    assert.equal(token.used_tokens, 400); assert.equal(token.reserved_tokens, 0);
    assert.equal(cost.used_microusd, expectedCost); assert.equal(cost.reserved_microusd, 0);
  }
  assert.deepEqual(actorCounters(f), actorBefore);
  assert.equal(count(f, 'document_jobs'), 1); assert.equal(count(f, 'output_provider_calls'), 2);
  assert.equal(count(f, 'experience_sponsor_active_jobs'), 0);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM experience_sponsor_consumptions ORDER BY rowid').all(), consumption);
  assert.deepEqual(privateBodies(f), redacted, 'financial reconciliation cannot restore erased source bodies');
  assert.equal(forbiddenDispatches, 0);
  assert.equal(transport.calls.length, requestsBefore);

  const settled = financialRows(f);
  assert.deepEqual(await reconcileKnownOutputProviderReceipts(f.env, run.trusted.principal, {jobId: run.jobId}),
    {reconciled: 0, status: 'not_needed'});
  assert.deepEqual(financialRows(f), settled, 'the same retained receipt settles exactly once');
  assert.deepEqual(privateBodies(f), redacted);
  assert.equal(forbiddenDispatches, 0);
  assert.equal(transport.calls.length, requestsBefore);
});

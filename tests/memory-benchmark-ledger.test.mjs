import test from 'node:test';
import assert from 'node:assert/strict';
import { BenchmarkLedger, BENCHMARK_MAXIMUM_MICRO_USD } from '../worker/memory-benchmark/ledger.ts';
import { createBenchmarkDb } from './helpers/memory-benchmark-db.mjs';

const NOW = Date.UTC(2026, 8, 4, 12);
const PLAN = 'a'.repeat(64);
const REQUEST = 'b'.repeat(64);
const GRANT = Object.freeze({ experimentId: 'synthetic-10usd', planHash: PLAN, principalId: 'approved-admin', payerId: 'benchmark-payer', period: '2026-09', now: NOW, expiresAt: NOW + 600_000 });
const RESERVATION = Object.freeze({ experimentId: GRANT.experimentId, planHash: PLAN, principalId: GRANT.principalId, payerId: GRANT.payerId, operationId: 'operation-0', requestHash: REQUEST, ordinal: 0, maximumMicroUsd: 1_000_000, now: NOW + 1 });
const RECEIPT = Object.freeze({ experimentId: GRANT.experimentId, operationId: RESERVATION.operationId, requestHash: REQUEST, actualMicroUsd: 250_000, resultJson: '{"synthetic":true,"answer":"fixture"}', now: NOW + 2 });
const CLAIM = Object.freeze({ experimentId: GRANT.experimentId, operationId: RESERVATION.operationId, requestHash: REQUEST, now: NOW + 1 });

async function setup(t) {
  const fixture = createBenchmarkDb();
  t.after(fixture.close);
  const ledger = new BenchmarkLedger(fixture.DB);
  await ledger.initialize(GRANT);
  return { ...fixture, ledger };
}

async function reserveForDispatch(ledger, reservation = RESERVATION) {
  assert.equal(await ledger.reserve(reservation), true);
  assert.equal(await ledger.claimDispatch({ experimentId: reservation.experimentId, operationId: reservation.operationId, requestHash: reservation.requestHash, now: reservation.now }), true);
}

test('benchmark ledger fixes one immutable $10 grant and exposes no reset operation', async t => {
  const { ledger } = await setup(t);
  assert.deepEqual(await ledger.status(GRANT.experimentId), {
    experimentId: GRANT.experimentId, planHash: PLAN, principalId: GRANT.principalId,
    payerId: GRANT.payerId, period: GRANT.period, expiresAt: GRANT.expiresAt,
    maximumMicroUsd: BENCHMARK_MAXIMUM_MICRO_USD, spentMicroUsd: 0, reservedMicroUsd: 0,
    status: 'active', nextOrdinal: 0, createdAt: NOW, updatedAt: NOW, haltReason: null,
  });
});

test('benchmark ledger status is null for an absent experiment', async t => {
  const { ledger } = await setup(t);
  assert.equal(await ledger.status('absent'), null);
});

test('benchmark ledger exact reinitialization preserves previously spent funds', async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  const state = await ledger.initialize({ ...GRANT, now: NOW + 3 });
  assert.equal(state.spentMicroUsd, RECEIPT.actualMicroUsd);
  assert.equal(state.nextOrdinal, 1);
  assert.equal(state.createdAt, NOW);
});

for (const [name, change] of Object.entries({
  experiment: { experimentId: 'new-budget' }, plan: { planHash: 'c'.repeat(64) },
  principal: { principalId: 'other-admin' }, payer: { payerId: 'other-payer' },
  expiry: { expiresAt: GRANT.expiresAt + 1 }, period: { period: '2026-10' },
})) test(`benchmark ledger rejects reinitialization changing ${name}`, async t => {
  const { ledger, sqlite } = await setup(t);
  await assert.rejects(ledger.initialize({ ...GRANT, ...change }));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_experiments').get().n, 1);
  assert.equal((await ledger.status(GRANT.experimentId)).maximumMicroUsd, 10_000_000);
});

for (const [name, change] of Object.entries({
  expired: { expiresAt: NOW }, overlong: { expiresAt: NOW + 86_400_001 },
  unsafe: { now: Number.MAX_SAFE_INTEGER + 1 }, negative: { now: -1 },
  expanded_year: { now: 253_402_300_800_000, expiresAt: 253_402_300_800_001, period: '+010000' },
  malformed: { planHash: 'not-a-hash' }, identifier: { payerId: 'payer with spaces' },
})) test(`benchmark ledger rejects ${name} grant before creating budget`, async t => {
  const fixture = createBenchmarkDb();
  t.after(fixture.close);
  const ledger = new BenchmarkLedger(fixture.DB);
  await assert.rejects(ledger.initialize({ ...GRANT, ...change }));
  assert.equal(fixture.hooks.batches, 0);
  assert.equal(await ledger.status(GRANT.experimentId), null);
});

test('benchmark ledger reserves once, settles verified actual cost, and sorts synthetic results', async t => {
  const { ledger, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, 1_000_000);
  await ledger.settle(RECEIPT);
  const next = { ...RESERVATION, operationId: 'operation-1', ordinal: 1, now: NOW + 3 };
  await reserveForDispatch(ledger, next);
  await ledger.settle({ ...RECEIPT, operationId: next.operationId, actualMicroUsd: 0, resultJson: '[]', now: NOW + 4 });
  const state = await ledger.status(GRANT.experimentId);
  assert.equal(state.spentMicroUsd, 250_000);
  assert.equal(state.reservedMicroUsd, 0);
  assert.equal(state.nextOrdinal, 2);
  assert.deepEqual(await ledger.results(GRANT.experimentId), [
    { operationId: 'operation-0', ordinal: 0, requestHash: REQUEST, actualMicroUsd: RECEIPT.actualMicroUsd, resultJson: RECEIPT.resultJson },
    { operationId: 'operation-1', ordinal: 1, requestHash: REQUEST, actualMicroUsd: 0, resultJson: '[]' },
  ]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_assertions').get().n, 0);
});

test('benchmark ledger competing identical reservations authorize only one invocation', async t => {
  const { ledger, DB } = await setup(t);
  const second = new BenchmarkLedger(DB);
  const outcomes = await Promise.all([ledger.reserve(RESERVATION), second.reserve(RESERVATION)]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'active');
});

test('benchmark ledger competing different operations cannot spend in parallel', async t => {
  const { ledger, DB, sqlite } = await setup(t);
  const outcomes = await Promise.all([
    ledger.reserve(RESERVATION),
    new BenchmarkLedger(DB).reserve({ ...RESERVATION, operationId: 'other-operation' }),
  ]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_operations').get().n, 1);
});

test('benchmark ledger rejects another operation while a reservation is outstanding', async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  assert.equal(await ledger.reserve({ ...RESERVATION, operationId: 'operation-1', ordinal: 1 }), false);
  assert.equal(await ledger.reserve({ ...RESERVATION, requestHash: 'd'.repeat(64) }), false);
});

for (const [name, change] of Object.entries({
  principal: { principalId: 'wrong' }, payer: { payerId: 'wrong' }, plan: { planHash: 'd'.repeat(64) },
  ordinal: { ordinal: 1 }, expiry: { now: GRANT.expiresAt }, stale: { now: NOW - 1 },
  month: { now: Date.UTC(2026, 9, 1) }, unsafe: { maximumMicroUsd: Number.MAX_SAFE_INTEGER + 1 },
  fraction: { maximumMicroUsd: 0.5 }, zero: { maximumMicroUsd: 0 }, negative: { maximumMicroUsd: -1 },
  cap: { maximumMicroUsd: 10_000_001 }, malformed: { requestHash: 'bad' },
})) test(`benchmark ledger rejects ${name} reservation without changing accounting`, async t => {
  const { ledger, sqlite } = await setup(t);
  assert.equal(await ledger.reserve({ ...RESERVATION, ...change }), false);
  const state = await ledger.status(GRANT.experimentId);
  assert.equal(state.spentMicroUsd, 0);
  assert.equal(state.reservedMicroUsd, 0);
  assert.equal(state.nextOrdinal, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_operations').get().n, 0);
});

test('benchmark ledger enforces lifetime cap across sequential requests', async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger, { ...RESERVATION, maximumMicroUsd: 10_000_000 });
  await ledger.settle({ ...RECEIPT, actualMicroUsd: 9_900_000 });
  assert.equal(await ledger.reserve({ ...RESERVATION, operationId: 'operation-1', ordinal: 1, maximumMicroUsd: 100_001, now: NOW + 3 }), false);
  await reserveForDispatch(ledger, { ...RESERVATION, operationId: 'operation-1', ordinal: 1, maximumMicroUsd: 100_000, now: NOW + 3 });
  await ledger.settle({ ...RECEIPT, operationId: 'operation-1', actualMicroUsd: 100_000, now: NOW + 4 });
  assert.equal(await ledger.reserve({ ...RESERVATION, operationId: 'operation-2', ordinal: 2, maximumMicroUsd: 1, now: NOW + 5 }), false);
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, 10_000_000);
});

test('benchmark ledger does not redispatch a settled operation', async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  assert.equal(await ledger.reserve({ ...RESERVATION, ordinal: 1, now: NOW + 3 }), false);
});

for (const [name, hook] of [['lost', 'loseBatchAcknowledgement'], ['malformed', 'malformedBatchAcknowledgement']]) {
  test(`benchmark ledger ${name} reservation acknowledgement retains and halts`, async t => {
    const { ledger, hooks, sqlite, DB } = await setup(t);
    hooks[hook] = true;
    assert.equal(await ledger.reserve(RESERVATION), false);
    const state = await ledger.status(GRANT.experimentId);
    assert.equal(state.status, 'halted');
    assert.equal(state.reservedMicroUsd, RESERVATION.maximumMicroUsd);
    assert.equal(sqlite.prepare('SELECT state FROM memory_benchmark_operations').get().state, 'uncertain');
    assert.equal(await new BenchmarkLedger(DB).reserve(RESERVATION), false);
    await assert.rejects(ledger.settle(RECEIPT));
    assert.deepEqual(await ledger.results(GRANT.experimentId), []);
  });
}

test('benchmark ledger failed reserve transaction rolls back all earlier writes', async t => {
  const { ledger, hooks, sqlite } = await setup(t);
  hooks.failBatchAt = 3;
  assert.equal(await ledger.reserve(RESERVATION), false);
  const state = await ledger.status(GRANT.experimentId);
  assert.equal(state.reservedMicroUsd, 0);
  assert.equal(state.nextOrdinal, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_operations').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memory_benchmark_assertions').get().n, 0);
  await reserveForDispatch(ledger);
});

test('benchmark ledger lost reserve verification cannot dispatch', async t => {
  const { ledger, hooks } = await setup(t);
  hooks.failReads = 1;
  assert.equal(await ledger.reserve(RESERVATION), false);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, 1_000_000);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'halted');
});

test('benchmark ledger duplicate exact successful settlement is idempotent', async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  await Promise.all([ledger.settle(RECEIPT), ledger.settle(RECEIPT)]);
  await ledger.settle({ ...RECEIPT, now: GRANT.expiresAt + 1 });
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, RECEIPT.actualMicroUsd);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'active');
});

for (const [name, change] of Object.entries({
  cost: { actualMicroUsd: 250_001 }, hash: { requestHash: 'c'.repeat(64) }, result: { resultJson: '{"different":true}' },
})) test(`benchmark ledger conflicting settled ${name} halts without resetting known spend`, async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  await assert.rejects(ledger.settle({ ...RECEIPT, ...change, now: NOW + 3 }));
  const state = await ledger.status(GRANT.experimentId);
  assert.equal(state.spentMicroUsd, RECEIPT.actualMicroUsd);
  assert.equal(state.reservedMicroUsd, 0);
  assert.equal(state.status, 'halted');
});

for (const [name, change] of Object.entries({
  overrun: { actualMicroUsd: RESERVATION.maximumMicroUsd + 1 }, negative: { actualMicroUsd: -1 },
  unsafe: { actualMicroUsd: Number.MAX_SAFE_INTEGER + 1 }, fraction: { actualMicroUsd: 1.1 },
  wrong_operation: { operationId: 'wrong-operation' }, wrong_hash: { requestHash: 'c'.repeat(64) },
  malformed_json: { resultJson: '{bad' }, primitive_json: { resultJson: 'true' },
  infinite_json: { resultJson: '{"n":1e500}' }, oversized_json: { resultJson: JSON.stringify({ value: 'é'.repeat(524_288) }) },
  deep_json: { resultJson: '['.repeat(66) + ']'.repeat(66) }, expiry: { now: GRANT.expiresAt },
  stale_time: { now: NOW },
})) test(`benchmark ledger ${name} receipt retains full reservation and halts`, async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  await assert.rejects(ledger.settle({ ...RECEIPT, ...change }));
  const state = await ledger.status(GRANT.experimentId);
  assert.equal(state.spentMicroUsd, 0);
  assert.equal(state.reservedMicroUsd, RESERVATION.maximumMicroUsd);
  assert.equal(state.status, 'halted');
  assert.deepEqual(await ledger.results(GRANT.experimentId), []);
});

test('benchmark ledger failed settlement rolls back released funds and marks uncertainty', async t => {
  const { ledger, hooks, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  hooks.failBatchAt = 3;
  await assert.rejects(ledger.settle(RECEIPT));
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, 0);
  assert.equal(sqlite.prepare('SELECT state, result_json FROM memory_benchmark_operations').get().state, 'uncertain');
  assert.equal(sqlite.prepare('SELECT state, result_json FROM memory_benchmark_operations').get().result_json, null);
});

test('benchmark ledger lost settlement acknowledgement recovers only exact durable receipt', async t => {
  const { ledger, hooks } = await setup(t);
  await reserveForDispatch(ledger);
  hooks.loseBatchAcknowledgement = true;
  await ledger.settle(RECEIPT);
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, RECEIPT.actualMicroUsd);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, 0);
});

test('benchmark ledger halt never refunds or reopens an uncertain reservation', async t => {
  const { ledger, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.halt({ experimentId: GRANT.experimentId, operationId: RESERVATION.operationId, reason: 'provider_outcome_unknown', now: NOW + 2 });
  await ledger.halt({ experimentId: GRANT.experimentId, reason: 'second_halt', now: NOW });
  const state = await ledger.initialize({ ...GRANT, now: NOW + 3 });
  assert.equal(state.status, 'halted');
  assert.equal(state.reservedMicroUsd, RESERVATION.maximumMicroUsd);
  assert.equal(state.haltReason, 'provider_outcome_unknown');
  await assert.rejects(ledger.complete(GRANT.experimentId, NOW + 4));
  assert.throws(() => sqlite.exec("UPDATE memory_benchmark_experiments SET status='active'"));
  assert.throws(() => sqlite.exec("UPDATE memory_benchmark_operations SET state='reserved'"));
});

test('benchmark ledger completion requires settled work and permanently prevents more reservations', async t => {
  const { ledger } = await setup(t);
  await assert.rejects(ledger.complete(GRANT.experimentId, NOW));
  await reserveForDispatch(ledger);
  await assert.rejects(ledger.complete(GRANT.experimentId, NOW + 2));
  await ledger.settle(RECEIPT);
  await ledger.complete(GRANT.experimentId, NOW + 3);
  await ledger.complete(GRANT.experimentId, NOW + 4);
  assert.equal((await ledger.initialize({ ...GRANT, now: NOW + 5 })).status, 'complete');
  assert.equal(await ledger.reserve({ ...RESERVATION, operationId: 'operation-1', ordinal: 1, now: NOW + 6 }), false);
});

test('benchmark ledger database rejects reset, binding changes, and operation deletion', async t => {
  const { ledger, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  for (const sql of [
    'DELETE FROM memory_benchmark_experiments', 'DELETE FROM memory_benchmark_operations',
    'UPDATE memory_benchmark_experiments SET spent_micro_usd=0',
    'UPDATE memory_benchmark_experiments SET next_ordinal=0',
    "UPDATE memory_benchmark_experiments SET payer_id='other'",
    'UPDATE memory_benchmark_experiments SET expires_at=expires_at+1',
    'UPDATE memory_benchmark_operations SET maximum_micro_usd=2000000',
    'UPDATE memory_benchmark_operations SET actual_micro_usd=0',
  ]) assert.throws(() => sqlite.exec(sql));
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, RECEIPT.actualMicroUsd);
});

test('benchmark ledger SQL assertion fails atomically after a prior write', async t => {
  const { DB, ledger } = await setup(t);
  await assert.rejects(DB.batch([
    DB.prepare("UPDATE memory_benchmark_experiments SET status='halted'"),
    DB.prepare('INSERT INTO memory_benchmark_assertions(passed) VALUES (0)'),
  ]));
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'active');
});

test('benchmark ledger rejects premature erasure without altering the payload', async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  await assert.rejects(ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt - 1));
  assert.equal((await ledger.results(GRANT.experimentId))[0].resultJson, RECEIPT.resultJson);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'active');
});

test('benchmark ledger expired payload erasure retains charge and immutable operation tombstone', async t => {
  const { ledger, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  await ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt);
  const state = await ledger.status(GRANT.experimentId);
  assert.equal(state.status, 'halted');
  assert.equal(state.spentMicroUsd, RECEIPT.actualMicroUsd);
  assert.equal(state.reservedMicroUsd, 0);
  assert.equal(state.nextOrdinal, 1);
  assert.deepEqual(await ledger.results(GRANT.experimentId), []);
  const row = sqlite.prepare('SELECT * FROM memory_benchmark_operations').get();
  assert.equal(row.result_json, null);
  assert.equal(row.payload_purged_at, GRANT.expiresAt);
  assert.equal(row.actual_micro_usd, RECEIPT.actualMicroUsd);
  assert.equal(row.state, 'settled');
  assert.equal(row.request_hash, REQUEST);
  assert.equal(await ledger.reserve({ ...RESERVATION, now: GRANT.expiresAt }), false);
  await assert.rejects(ledger.initialize({ ...GRANT, expiresAt: GRANT.expiresAt + 1000, now: GRANT.expiresAt }));
});

test('benchmark ledger erasure does not turn completed work into a new budget', async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  await ledger.complete(GRANT.experimentId, NOW + 3);
  await ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'complete');
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, RECEIPT.actualMicroUsd);
  assert.deepEqual(await ledger.results(GRANT.experimentId), []);
  await assert.rejects(ledger.initialize({ ...GRANT, experimentId: 'replacement-budget', now: GRANT.expiresAt, expiresAt: GRANT.expiresAt + 1000 }));
});

test('benchmark ledger expiry erasure halts active work without refunding unknown reservation', async t => {
  const { ledger, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  await reserveForDispatch(ledger, { ...RESERVATION, operationId: 'operation-1', ordinal: 1, now: NOW + 3 });
  await ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt);
  const state = await ledger.status(GRANT.experimentId);
  assert.equal(state.status, 'halted');
  assert.equal(state.reservedMicroUsd, RESERVATION.maximumMicroUsd);
  assert.equal(state.spentMicroUsd, RECEIPT.actualMicroUsd);
  assert.deepEqual(await ledger.results(GRANT.experimentId), []);
  const row = sqlite.prepare("SELECT state, payload_purged_at FROM memory_benchmark_operations WHERE operation_id='operation-1'").get();
  assert.equal(row.state, 'uncertain');
  assert.equal(row.payload_purged_at, null);
});

test('benchmark ledger repeated erasure cannot alter purge time, restore JSON, or change charge', async t => {
  const { ledger, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  await ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt);
  await ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt + 1);
  assert.equal(sqlite.prepare('SELECT payload_purged_at FROM memory_benchmark_operations').get().payload_purged_at, GRANT.expiresAt);
  for (const sql of [
    "UPDATE memory_benchmark_operations SET result_json='{}', payload_purged_at=NULL",
    'UPDATE memory_benchmark_operations SET payload_purged_at=payload_purged_at+1',
    'UPDATE memory_benchmark_operations SET payload_purged_at=NULL',
    'UPDATE memory_benchmark_operations SET actual_micro_usd=0',
    'DELETE FROM memory_benchmark_operations',
  ]) assert.throws(() => sqlite.exec(sql));
});

test('benchmark ledger SQL disallows nulling or marking payload before expiry', async t => {
  const { ledger, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  assert.throws(() => sqlite.exec('UPDATE memory_benchmark_operations SET result_json=NULL'));
  assert.throws(() => sqlite.prepare('UPDATE memory_benchmark_operations SET result_json=NULL, payload_purged_at=?, updated_at=?').run(GRANT.expiresAt - 1, GRANT.expiresAt - 1));
  assert.equal((await ledger.results(GRANT.experimentId))[0].resultJson, RECEIPT.resultJson);
});

test('benchmark ledger fault during purge rolls back erased payload and lifecycle changes', async t => {
  const { ledger, hooks, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  hooks.failBatchAt = 4;
  await assert.rejects(ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt));
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'active');
  assert.equal((await ledger.results(GRANT.experimentId))[0].resultJson, RECEIPT.resultJson);
  assert.equal(sqlite.prepare('SELECT payload_purged_at FROM memory_benchmark_operations').get().payload_purged_at, null);
  await ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt);
  assert.deepEqual(await ledger.results(GRANT.experimentId), []);
});

test('benchmark ledger lost purge acknowledgement can retry without payload reconstruction', async t => {
  const { ledger, hooks } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  hooks.loseBatchAcknowledgement = true;
  await assert.rejects(ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt));
  assert.deepEqual(await ledger.results(GRANT.experimentId), []);
  await ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt);
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, RECEIPT.actualMicroUsd);
});

test('benchmark ledger exact settlement cannot recreate an erased result', async t => {
  const { ledger } = await setup(t);
  await reserveForDispatch(ledger);
  await ledger.settle(RECEIPT);
  await ledger.purgeResults(GRANT.experimentId, GRANT.expiresAt);
  await assert.rejects(ledger.settle({ ...RECEIPT, now: GRANT.expiresAt + 1 }));
  assert.deepEqual(await ledger.results(GRANT.experimentId), []);
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, RECEIPT.actualMicroUsd);
});

test('benchmark ledger dispatch claim is durable and succeeds exactly once', async t => {
  const { ledger, sqlite, DB } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  assert.equal(await ledger.claimDispatch(CLAIM), true);
  const row = sqlite.prepare('SELECT dispatch_claimed_at, dispatch_claim_token FROM memory_benchmark_operations').get();
  assert.equal(row.dispatch_claimed_at, CLAIM.now);
  assert.match(row.dispatch_claim_token, /^[a-f0-9-]{36}$/);
  assert.equal(await new BenchmarkLedger(DB).claimDispatch(CLAIM), false);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'active');
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
});

test('benchmark ledger competing dispatch claims authorize only one invocation', async t => {
  const { ledger, DB } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  const outcomes = await Promise.all([ledger.claimDispatch(CLAIM), new BenchmarkLedger(DB).claimDispatch(CLAIM)]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'active');
});

test('benchmark ledger halt winning before claim blocks outbound authorization', async t => {
  const { ledger, sqlite, DB } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  const [, authorized] = await Promise.all([
    ledger.halt({ experimentId: GRANT.experimentId, reason: 'operator_halt', now: CLAIM.now }),
    new BenchmarkLedger(DB).claimDispatch(CLAIM),
  ]);
  assert.equal(authorized, false);
  assert.equal(sqlite.prepare('SELECT dispatch_claimed_at FROM memory_benchmark_operations').get().dispatch_claimed_at, null);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
});

test('benchmark ledger claim winning before halt linearizes one already-authorized call', async t => {
  const { ledger, DB, sqlite } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  const [authorized] = await Promise.all([
    ledger.claimDispatch(CLAIM),
    new BenchmarkLedger(DB).halt({ experimentId: GRANT.experimentId, reason: 'operator_halt', now: CLAIM.now }),
  ]);
  assert.equal(authorized, true);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'halted');
  const row = sqlite.prepare('SELECT state, dispatch_claimed_at FROM memory_benchmark_operations').get();
  assert.equal(row.state, 'uncertain');
  assert.equal(row.dispatch_claimed_at, CLAIM.now);
  assert.equal(await ledger.claimDispatch(CLAIM), false);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
});

for (const [name, change] of Object.entries({
  expiry: { now: GRANT.expiresAt }, stale: { now: NOW }, month: { now: Date.UTC(2026, 9, 1) },
  operation: { operationId: 'absent' }, hash: { requestHash: 'c'.repeat(64) },
  malformed_hash: { requestHash: 'bad' }, unsafe_time: { now: Number.MAX_SAFE_INTEGER + 1 },
})) test(`benchmark ledger rejects ${name} dispatch claim with no authorization`, async t => {
  const { ledger, sqlite } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  assert.equal(await ledger.claimDispatch({ ...CLAIM, ...change }), false);
  assert.equal(sqlite.prepare('SELECT dispatch_claimed_at FROM memory_benchmark_operations').get().dispatch_claimed_at, null);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
});

test('benchmark ledger cannot claim without a reservation', async t => {
  const { ledger } = await setup(t);
  assert.equal(await ledger.claimDispatch(CLAIM), false);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, 0);
});

for (const [name, hook] of [['lost', 'loseBatchAcknowledgement'], ['malformed', 'malformedBatchAcknowledgement']]) {
  test(`benchmark ledger ${name} dispatch acknowledgement never recovers dispatch through reread`, async t => {
    const { ledger, DB, hooks, sqlite } = await setup(t);
    assert.equal(await ledger.reserve(RESERVATION), true);
    hooks[hook] = true;
    assert.equal(await ledger.claimDispatch(CLAIM), false);
    assert.equal(sqlite.prepare('SELECT dispatch_claimed_at FROM memory_benchmark_operations').get().dispatch_claimed_at, CLAIM.now);
    assert.equal((await ledger.status(GRANT.experimentId)).status, 'halted');
    assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
    assert.equal(await new BenchmarkLedger(DB).claimDispatch(CLAIM), false);
    await assert.rejects(ledger.settle(RECEIPT));
  });
}

test('benchmark ledger unavailable claim reread remains non-dispatchable and retains cost', async t => {
  const { ledger, hooks } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  hooks.loseBatchAcknowledgement = true;
  hooks.failReads = 2;
  assert.equal(await ledger.claimDispatch(CLAIM), false);
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'halted');
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
  assert.equal(await ledger.claimDispatch(CLAIM), false);
});

test('benchmark ledger failed claim transaction rolls back claim metadata without releasing funds', async t => {
  const { ledger, hooks, sqlite } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  hooks.failBatchAt = 3;
  assert.equal(await ledger.claimDispatch(CLAIM), false);
  const row = sqlite.prepare('SELECT dispatch_claimed_at, dispatch_claim_token FROM memory_benchmark_operations').get();
  assert.equal(row.dispatch_claimed_at, null);
  assert.equal(row.dispatch_claim_token, null);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
  assert.equal(await ledger.claimDispatch(CLAIM), true);
});

test('benchmark ledger refuses settlement without a prior acknowledged dispatch claim', async t => {
  const { ledger } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  await assert.rejects(ledger.settle(RECEIPT));
  assert.equal((await ledger.status(GRANT.experimentId)).status, 'halted');
  assert.equal((await ledger.status(GRANT.experimentId)).spentMicroUsd, 0);
  assert.equal((await ledger.status(GRANT.experimentId)).reservedMicroUsd, RESERVATION.maximumMicroUsd);
});

test('benchmark ledger SQL makes successful dispatch claim metadata immutable', async t => {
  const { ledger, sqlite } = await setup(t);
  await reserveForDispatch(ledger);
  for (const sql of [
    'UPDATE memory_benchmark_operations SET dispatch_claimed_at=NULL, dispatch_claim_token=NULL',
    'UPDATE memory_benchmark_operations SET dispatch_claimed_at=dispatch_claimed_at+1',
    "UPDATE memory_benchmark_operations SET dispatch_claim_token='11111111-1111-1111-1111-111111111111'",
  ]) assert.throws(() => sqlite.exec(sql));
  assert.equal(await ledger.claimDispatch(CLAIM), false);
});

test('benchmark ledger SQL rejects claiming a halted unclaimed reservation', async t => {
  const { ledger, sqlite } = await setup(t);
  assert.equal(await ledger.reserve(RESERVATION), true);
  await ledger.halt({ experimentId: GRANT.experimentId, reason: 'operator_halt', now: CLAIM.now });
  assert.throws(() => sqlite.prepare("UPDATE memory_benchmark_operations SET dispatch_claimed_at=?, dispatch_claim_token='11111111-1111-1111-1111-111111111111', updated_at=?").run(CLAIM.now, CLAIM.now));
  assert.equal(sqlite.prepare('SELECT dispatch_claimed_at FROM memory_benchmark_operations').get().dispatch_claimed_at, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { model3dRecoveryFixture, model3dRecoverySnapshot } from './helpers/output-model3d-recovery-fixture.mjs';
import { captureModel3dReplacementParent, model3dReplacementRowAssertion, model3dReplacementIndexAssertion } from '../worker/experience-model3d-replacement-proof.ts';
import { outputAssertionStatements } from '../worker/output-requirements-ledger.ts';

const fixture = () => model3dRecoveryFixture({ scopeKey: 'personal:owner:project', retentionMs: 3600000 });
const capture = f => captureModel3dReplacementParent(f.env, f.scope, f.slot, f.readJob(), { assertions: f.assertions, current: f.current });
test('actual SQLite parent read preserves every row, original hold and provider call', async t => {
  const f = await fixture(); t.after(() => f.close());
  const before = model3dRecoverySnapshot(f);
  t.mock.method(globalThis, 'fetch', () => { throw Error('unpaid preparation cannot contact provider'); });
  const proof = await capture(f);
  assert.equal(proof.checkpoint.providerRequestId, f.provider.providerRequestId);
  assert.equal(proof.checkpoint.settled, false);
  assert.ok(proof.assertions.length >= 8);
  await f.DB.batch(proof.assertions.flatMap(a => outputAssertionStatements(f.env, a)));
  assert.deepEqual(model3dRecoverySnapshot(f), before);
});
for (const [name, sql] of [
  ['wrong owner', "UPDATE document_jobs SET owner_id='other'"],
  ['changed source', 'UPDATE recovery_test_source SET current=0'],
  ['another call', "INSERT INTO output_provider_calls SELECT scope_key,slot_id,'unexpected',client_request_id||'-other',request_digest,stage_key,provider,model,reserved_microusd,used_microusd,status,provider_response_id,created_at,settled_at FROM output_provider_calls"],
  ['changed provider ID', "UPDATE output_provider_calls SET provider_response_id='different'"],
  ['settled call', "UPDATE output_provider_calls SET used_microusd=400000,status='settled'"],
  ['wrong hold', 'UPDATE cost_budget_reservations SET reserved_microusd=399999'],
  ['released hold', "UPDATE cost_budget_reservations SET status='released'"],
  ['changed slot ceiling', 'UPDATE output_operation_slots SET maximum_microusd=399999'],
  ['normal lease', "UPDATE document_jobs SET lease_expires_at='2099-01-01T00:00:00.000Z'"],
  ['active recovery', "UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecovery',json('{\"version\":\"output-model3d-recovery-v1\",\"expiresAt\":\"2099-01-01T00:00:00.000Z\"}'))"],
  ['unknown recovery shape', "UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecovery',json('{}'))"],
  ['provider result known', "UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions.\"forma-model3d-test-original\".status','completed')"],
  ['expired retention', "UPDATE document_jobs SET expires_at='2020-01-01T00:00:00.000Z'"],
]) test(`replacement refuses ${name} without changing accounting`, async t => {
  const f = await fixture(); t.after(() => f.close());
  f.sqlite.exec(sql); const before = model3dRecoverySnapshot(f);
  await assert.rejects(capture(f));
  assert.deepEqual(model3dRecoverySnapshot(f), before);
});
test('captured parent guards roll back a later child write when original state changes', async t => {
  const f = await fixture(); t.after(() => f.close());
  const proof = await capture(f);
  f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.changedAfterPreview',1)");
  const before = model3dRecoverySnapshot(f);
  await assert.rejects(f.DB.batch([
    f.DB.prepare("UPDATE cost_budget_reservations SET reserved_microusd=800000 WHERE reservation_id=?").bind('cost:model3d'),
    ...proof.assertions.flatMap(a => outputAssertionStatements(f.env, a)),
  ]));
  assert.deepEqual(model3dRecoverySnapshot(f), before);
});
test('row witnesses preserve null and reject SQL identifiers or non-scalar values', () => {
  assert.deepEqual(model3dReplacementRowAssertion('document_jobs', { job_id: 'job', result_json: null }), {
    sql: 'EXISTS(SELECT 1 FROM document_jobs WHERE job_id IS ? AND result_json IS ?)', bindings: ['job', null],
  });
  assert.throws(() => model3dReplacementRowAssertion('users', { user_id: 'owner' }));
  assert.throws(() => model3dReplacementRowAssertion('document_jobs', { 'job_id) OR 1=1--': 'job' }));
  assert.throws(() => model3dReplacementRowAssertion('document_jobs', { result_json: {} }));
  let reads = 0; const getter = {};
  Object.defineProperty(getter, 'job_id', { enumerable: true, get() { reads++; return 'job'; } });
  const hidden = {}; Object.defineProperty(hidden, 'job_id', { value: 'job' });
  assert.throws(() => model3dReplacementRowAssertion('document_jobs', getter));
  assert.throws(() => model3dReplacementRowAssertion('document_jobs', hidden));
  assert.throws(() => model3dReplacementRowAssertion('document_jobs', { job_id: 'job', [Symbol('extra')]: 1 }));
  assert.equal(reads, 0);
});
test('replacement command index requires exact scope, one cycle and recognized phases', async t => {
  const f = await fixture(); t.after(() => f.close()); const draft = 'experience-draft-' + 'a'.repeat(64);
  const guard = model3dReplacementIndexAssertion(f.scope, draft, []);
  await f.DB.batch(outputAssertionStatements(f.env, guard));
  assert.throws(() => model3dReplacementIndexAssertion({ ...f.scope, actorUserId: 'other' }, draft, []));
  assert.throws(() => model3dReplacementIndexAssertion(f.scope, draft, [`model3d-replace-v1:${'a'.repeat(64)}:${'b'.repeat(64)}:save`]));
  const prefix = `model3d-replace-v1:${'a'.repeat(64)}:`;
  assert.throws(() => model3dReplacementIndexAssertion(f.scope, draft, [prefix + 'b'.repeat(64) + ':confirm', prefix + 'c'.repeat(64) + ':preflight']));
});

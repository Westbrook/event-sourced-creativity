import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = process.env.FORMA_SOURCE_ROOT ?? new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const source = path => pathToFileURL(`${root}/${path}`).href;
const { model3dRecoveryFixture: fixture, model3dRecoverySnapshot: snapshot } = await import(source('tests/helpers/output-model3d-recovery-fixture.mjs'));
const { predicateTree } = await import(source('tests/output-native-publication-depth.test.mjs'));
const { outputModel3dRecoveryAssertions: original } = await import(source('worker/output-model3d-recovery-lease.ts'));
const { compactModel3dRecoveryAssertions: compact } = await import(source('worker/output-model3d-recovery-assertions.ts'));
const savedFetch = globalThis.fetch; let fetches = 0;
globalThis.fetch = () => { fetches++; throw Error('pure/SQLite controls forbid network'); };
test.after(() => { globalThis.fetch = savedFetch; assert.equal(fetches, 0); });
const tree = assertions => predicateTree(assertions.map(a => `(${a.sql})`).join(' AND '));
const binds = assertions => assertions.flatMap(a => a.bindings ?? []);

test('owned grouping cannot hide mutated SQL, bindings, deadlines or JSON fingerprint collisions', () => {
  const fresh = () => compact([{sql:'? IS NULL',bindings:[null]},{sql:'?=1',bindings:[1]}])[0];
  for(const bad of [NaN,Infinity,-Infinity,null,'123']) {
    const group=fresh();group.deadlineMs=bad;
    assert.throws(()=>compact([group]), /assertion_invalid/);
  }
  for(const bad of [undefined,NaN,Infinity,{},true]) {
    const group=fresh();group.bindings[0]=bad;
    assert.throws(()=>compact([group]), /assertion_invalid/);
  }
  const sparse=fresh();delete sparse.bindings[0];assert.throws(()=>compact([sparse]),/assertion_invalid/);
  const changed=fresh();changed.sql='0=1';changed.bindings=[];
  assert.equal(compact([changed])[0].sql,'(0=1)');
  const source={sql:'?=1',bindings:[1]}, grouped=compact([source]);source.bindings[0]=0;
  assert.deepEqual(binds(compact(grouped)),[1]);
  const distinct=compact([{sql:'?=?',bindings:[1,'1']},{sql:'?=?',bindings:['1',1]}]);
  assert.deepEqual(binds(distinct),[1,'1','1',1]);
  assert.deepEqual(compact([...grouped,...grouped]),grouped);
});

test('compaction retains every original fixed predicate, binding, expiry and caller-owned assertion', async () => {
  const f = await fixture();
  try {
    const lease = await f.claim();
    const fixed = original(f.scope, f.slot, f.job, lease.checkpoint, lease.expiresAt);
    assert.equal(fixed.length, 12); assert.equal(binds(fixed).length, 79);
    const before = structuredClone(fixed), combined = compact(fixed);
    assert.deepEqual(tree(combined), tree(fixed)); assert.deepEqual(binds(combined), binds(fixed)); assert.deepEqual(fixed, before);
    assert(combined.length <= fixed.length); assert(combined.every(a => (a.bindings ?? []).length <= 90));
    assert.deepEqual(compact(combined), combined, 'repeated compaction cannot deepen SQL');
    assert.equal(Math.min(...combined.flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs])), Date.parse(lease.expiresAt));
    for (let i = 0; i < fixed.length; i++) assert.notDeepEqual(tree(combined), tree(fixed.filter((_, index) => index !== i)), `omitted original predicate ${i} detected`);
    await lease.assertCurrent(); await lease.release();
  } finally { f.close(); }
});

test('compaction boundaries preserve order, tightest group deadlines, disjunction precedence and owned bindings', () => {
  const input = Array.from({ length: 19 }, (_, i) => ({ sql: Array.from({ length: 11 }, () => '?=1 OR ?=0').join(' AND '), bindings: Array.from({ length: 22 }, (_, j) => i * 100 + j), ...(i % 3 === 0 ? { deadlineMs: 1000 + i } : {}) }));
  const before = structuredClone(input), result = compact(input);
  assert.deepEqual(tree(result), tree(input)); assert.deepEqual(binds(result), binds(input)); assert.deepEqual(input, before);
  let offset = 0;
  for (const group of result) {
    const count = group.bindings.length / 22; assert(Number.isInteger(count) && count > 0 && count <= 8); assert(group.bindings.length <= 90);
    const deadlines = input.slice(offset, offset + count).flatMap(a => a.deadlineMs === undefined ? [] : [a.deadlineMs]);
    assert.equal(group.deadlineMs, deadlines.length ? Math.min(...deadlines) : undefined); offset += count;
  }
  assert.equal(offset, input.length); result[0].bindings[0] = -1; assert.deepEqual(input, before);
});

test('eight-term boundary, singleton D1 ceiling, empty input and invalid assertion fail-closed controls', () => {
  const input = Array.from({ length: 17 }, (_, i) => ({ sql: `${i}=${i}`, bindings: [] }));
  const output = compact(input); assert.equal(output.length, 3);
  assert.deepEqual(output.map(a => predicateTree(a.sql)).map(node => node.terms?.length ?? 1), [8,8,1]);
  assert.deepEqual(tree(output), tree(input)); assert.deepEqual(compact([]), []);
  const singleton = { sql: Array.from({ length: 99 }, () => '?=1').join(' AND '), bindings: Array(99).fill(1) };
  assert.deepEqual(binds(compact([singleton])), singleton.bindings);
  assert.throws(() => compact([{ ...singleton, bindings: Array(100).fill(1) }]));
  assert.throws(() => compact([{ sql: '', bindings: [] }]));
  for (const deadlineMs of [NaN, Infinity, -Infinity]) assert.throws(() => compact([{ sql: '1=1', deadlineMs }]));
});

const corruptions = [
  ...['artifactId','artifactKind','outputExecution','model3dInputReceipt','reservationId','costReservationId','costReservationPeriod'].map(key => [key, f => f.sqlite.prepare("UPDATE document_jobs SET result_json=json_set(result_json,?,'foreign')").run(`$.${key}`)]),
  ['job canceled', f => f.sqlite.exec("UPDATE document_jobs SET status='canceled'")],
  ['slot source', f => f.sqlite.exec("UPDATE output_operation_slots SET source_digest='foreign'")],
  ['plan requirement', f => f.sqlite.exec("UPDATE output_plan_revisions SET requirements_digest='foreign'")],
  ['grant revoked', f => f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'")],
  ['provider request', f => f.sqlite.exec("UPDATE output_provider_calls SET provider_response_id='foreign'")],
  ['token amount', f => f.sqlite.exec('UPDATE budget_reservations SET reserved_tokens=2')],
  ['cost amount', f => f.sqlite.exec('UPDATE cost_budget_reservations SET reserved_microusd=400001')],
  ['live source', f => f.sqlite.exec('UPDATE recovery_test_source SET current=0')],
  ['lease token', f => f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecovery.token','foreign')")],
  ['lease expiry', f => f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputModel3dRecovery.expiresAt','2020-01-01T00:00:00.000Z')")],
];
for (const [name, corrupt] of corruptions) test(`actual SQLite compact live assertions reject ${name} without extra mutation`, async () => {
  const f = await fixture();
  try { const lease = await f.claim(); await lease.assertCurrent(); corrupt(f); const before = snapshot(f); await assert.rejects(lease.assertCurrent()); assert.deepEqual(snapshot(f), before); }
  finally { f.close(); }
});

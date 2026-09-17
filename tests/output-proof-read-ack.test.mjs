import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';

// Actual source functions and explicit local D1-shaped receipt ports. SQLite
// evaluates the SELECTs; this does not claim workerd, private custody or a grant.
registerOutputSourceImports();
const { assertOutputProofRead, outputProofReadStatements, verifyOutputSourceRead } = await import('../worker/output-disclosure-proof.ts');
const { OutputConflictError } = await import('../worker/output-command-core.ts');
const changed = error => error instanceof OutputConflictError && error.code === 'output_source_changed_during_read' && error.status === 409;
const receipt = () => ({ success: true, results: [{ current: 1 }] });
const batch = () => [receipt(), receipt(), receipt()];
const withProperty = (value, key, property) => Object.defineProperty(value, key, { configurable: true, ...property });

const malformed = [
  ['non-array batch', () => ({ length: 3, 0: receipt(), 1: receipt(), 2: receipt() })],
  ['null batch', () => null],
  ['missing receipt', values => values.slice(1)],
  ['extra receipt', values => [...values, receipt()]],
  ['sparse interior slot', values => { delete values[1]; return values; }],
  ['inherited interior slot', values => { const prototype = Object.create(Array.prototype); prototype[1] = values[1]; delete values[1]; return Object.setPrototypeOf(values, prototype); }],
  ['undefined receipt', values => { values[1] = undefined; return values; }],
  ['null receipt', values => { values[1] = null; return values; }],
  ['array receipt', values => { values[1] = Object.assign([], receipt()); return values; }],
  ['success omitted', values => { delete values[1].success; return values; }],
  ['success inherited', values => { delete values[1].success; Object.setPrototypeOf(values[1], { success: true }); return values; }],
  ['success false', values => { values[1].success = false; return values; }],
  ['success string', values => { values[1].success = 'true'; return values; }],
  ['rows omitted', values => { delete values[1].results; return values; }],
  ['rows inherited', values => { const rows = values[1].results; delete values[1].results; Object.setPrototypeOf(values[1], { results: rows }); return values; }],
  ['rows non-array', values => { values[1].results = { 0: { current: 1 }, length: 1 }; return values; }],
  ['rows null', values => { values[1].results = null; return values; }],
  ['row absent', values => { values[1].results = []; return values; }],
  ['row sparse', values => { values[1].results = Array(1); return values; }],
  ['row inherited', values => { const rows = Array(1), prototype = Object.create(Array.prototype); prototype[0] = { current: 1 }; values[1].results = Object.setPrototypeOf(rows, prototype); return values; }],
  ['row extra', values => { values[1].results.push({ current: 1 }); return values; }],
  ['row null', values => { values[1].results = [null]; return values; }],
  ['row array', values => { values[1].results = [Object.assign([], { current: 1 })]; return values; }],
  ['current omitted', values => { values[1].results[0] = {}; return values; }],
  ['current inherited', values => { values[1].results[0] = Object.create({ current: 1 }); return values; }],
  ...[['string', '1'], ['boolean', true], ['boxed number', Object(1)], ['coercible object', { valueOf: () => 1 }], ['null', null], ['false', false], ['zero', 0], ['NaN', NaN]].map(([name, value]) => ['current ' + name, values => { values[1].results[0].current = value; return values; }]),
];

for (const [name, transform] of malformed) test('malformed proof acknowledgment refuses: ' + name, () => {
  assert.throws(() => assertOutputProofRead(transform(batch()), 3), changed);
});

for (const [name, select, key] of [
  ['batch slot', values => values, '1'],
  ['success', values => values[1], 'success'],
  ['results', values => values[1], 'results'],
  ['row slot', values => values[1].results, '0'],
  ['current', values => values[1].results[0], 'current'],
]) test('accessor proof acknowledgment refuses without invoking: ' + name, () => {
  const values = batch(), target = select(values), original = target[key]; let reads = 0;
  withProperty(target, key, { get() { reads++; return original; } });
  assert.throws(() => assertOutputProofRead(values, 3), changed);
  assert.equal(reads, 0);
});

test('zero proofs remain valid and malformed expected counts refuse', () => {
  assert.doesNotThrow(() => assertOutputProofRead([], 0));
  for (const count of [-1, 0.5, NaN, Infinity, '0', undefined]) assert.throws(() => assertOutputProofRead([], count), changed);
});
test('dense genuine receipts allow ordinary metadata and additional columns', () => {
  const result = receipt(); result.meta = { changes: 0, duration: 0 }; result.results[0].label = 'additional diagnostic column';
  assert.doesNotThrow(() => assertOutputProofRead([result], 1));
  assert.doesNotThrow(() => assertOutputProofRead(batch(), 3));
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("CREATE TABLE events(stream_id TEXT,sequence INTEGER); INSERT INTO events VALUES('creative:owner',7); CREATE TABLE source_proof(id TEXT PRIMARY KEY,current INTEGER); INSERT INTO source_proof VALUES('first',1),('second',1)");
  const controls = { transform: values => values, batches: 0, maximumBindings: 0 };
  const env = { DB: {
    prepare(sql) { return { sql, values: [], bind(...values) { assert(values.length <= 100); controls.maximumBindings = Math.max(controls.maximumBindings, values.length); return { ...this, values }; } }; },
    async batch(statements) {
      controls.batches++;
      return controls.transform(statements.map(statement => ({ success: true, results: sqlite.prepare(statement.sql).all(...statement.values), meta: { changes: 0 } })));
    },
  } };
  const assertions = ['first', 'second'].map(id => ({ sql: 'EXISTS(SELECT 1 FROM source_proof WHERE id=? AND current=1)', bindings: [id] }));
  return { sqlite, env, controls, assertions, close: () => sqlite.close() };
}

test('actual bounded SQL proofs preserve numeric truth and reject a changed predicate', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw Error('network forbidden'); });
  const f = fixture(); t.after(() => f.close());
  const statements = outputProofReadStatements(f.env, f.assertions);
  const passed = await f.env.DB.batch(statements);
  assert.deepEqual(passed.map(value => value.results[0].current), [1, 1]);
  assert.doesNotThrow(() => assertOutputProofRead(passed, 2));
  f.sqlite.prepare("UPDATE source_proof SET current=0 WHERE id='second'").run();
  const refused = await f.env.DB.batch(statements);
  assert.deepEqual(refused.map(value => value.results[0].current), [1, 0]);
  assert.throws(() => assertOutputProofRead(refused, 2), changed);
  assert.equal(f.controls.maximumBindings, 1);
});

test('ordinary source verification accepts exact SQL and head-only empty assertions', async t => {
  const f = fixture(); t.after(() => f.close());
  await verifyOutputSourceRead(f.env, { ownerUserId: 'owner' }, 7, f.assertions);
  await verifyOutputSourceRead(f.env, { ownerUserId: 'owner' }, 7, []);
  assert.equal(f.controls.batches, 2);
});
test('ordinary source verification keeps changed source and head errors distinct', async t => {
  const f = fixture(); t.after(() => f.close());
  f.sqlite.prepare("UPDATE source_proof SET current=0 WHERE id='second'").run();
  await assert.rejects(verifyOutputSourceRead(f.env, { ownerUserId: 'owner' }, 7, f.assertions), changed);
  await assert.rejects(verifyOutputSourceRead(f.env, { ownerUserId: 'owner' }, 8, f.assertions), error => error instanceof OutputConflictError && error.code === 'output_revision_or_authority_changed' && error.status === 409);
});
for (const [name, transform] of [
  ['sparse proof', values => { delete values[1]; return values; }],
  ['success omitted', values => { delete values[1].success; return values; }],
  ['coercible current', values => { values[1].results[0].current = '1'; return values; }],
  ['extra proof row', values => { values[1].results.push({ current: 1 }); return values; }],
]) test('ordinary source verification rejects malformed SQL acknowledgment: ' + name, async t => {
  const f = fixture(); t.after(() => f.close()); f.controls.transform = transform;
  await assert.rejects(verifyOutputSourceRead(f.env, { ownerUserId: 'owner' }, 7, f.assertions), changed);
});

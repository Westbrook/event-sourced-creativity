import assert from 'node:assert/strict';
import test from 'node:test';
import { outputDatabaseFailureKind, outputDatabaseMessageKind } from '../worker/output-database-diagnostic.ts';
import { logOutputJobFailure, recordOutputJobHeartbeatFailure } from '../worker/output-job-failure-diagnostic.ts';

test('shared database diagnostic returns only fixed categories', () => {
  for (const [message, kind] of [
    ['D1_ERROR: CHECK constraint failed: secret SQL', 'd1_constraint'],
    ['Wrong number of parameter bindings secret', 'd1_binding_count'],
    ['D1_TYPE_ERROR secret', 'd1_binding_type'], ['Expression tree is too large', 'd1_expression_depth'],
    ['parser stack overflow', 'd1_parser_depth'], ['malformed JSON', 'd1_malformed_json'],
    ['ambiguous column name secret', 'd1_ambiguous_column'], ['D1_ERROR: not authorized', 'd1_sql_authorization'],
    ['SQL statement too long', 'd1_statement_length'], ['too many terms in compound SELECT', 'd1_compound_limit'],
    ['too many SQL variables', 'd1_parameter_limit'], ['SQLITE_TOOBIG private', 'd1_value_limit'],
    ['database is locked', 'd1_busy'], ['no such column secret', 'd1_schema'],
    ['Too many subrequests private', 'worker_subrequest_limit'], ['D1_ERROR: too many queries', 'd1_query_limit'],
    ['D1_ERROR: private SQL', 'd1_error'],
  ]) assert.equal(outputDatabaseMessageKind(message), kind);
  assert.equal(outputDatabaseMessageKind('not authorized by provider'), undefined);
  assert.equal(outputDatabaseMessageKind('private prompt, URL, credential'), undefined);
});

test('bounded cross-realm causes, cycles and descriptors do not disclose or invoke getters', () => {
  assert.equal(outputDatabaseFailureKind({message:'D1_ERROR',cause:{message:'SQLITE_BUSY'}}), 'd1_busy');
  const cycle = {message:'D1_ERROR'}; cycle.cause = cycle;
  assert.equal(outputDatabaseFailureKind(cycle), 'd1_error');
  assert.equal(outputDatabaseFailureKind({cause:{cause:{cause:{message:'SQLITE_BUSY'}}}}), undefined);
  assert.equal(outputDatabaseFailureKind({message:'x'.repeat(2048)+'SQLITE_BUSY'}), undefined);
  let reads = 0;
  const accessor = Object.defineProperties({}, {
    message:{get(){reads++;return 'SQLITE_BUSY';}}, cause:{get(){reads++;return cycle;}},
  });
  assert.equal(outputDatabaseFailureKind(accessor), undefined); assert.equal(reads, 0);
  assert.equal(outputDatabaseFailureKind(new Proxy({}, {getOwnPropertyDescriptor(){throw Error('private');}})), undefined);
});

test('heartbeat diagnostics preserve original error identity and fixed first/later stages', t => {
  const logs = []; t.mock.method(console, 'warn', (...args) => logs.push(args));
  const first = new Error('D1_ERROR: CHECK constraint failed: private SQL');
  const before = Object.getOwnPropertyDescriptors(first);
  recordOutputJobHeartbeatFailure(first, true); logOutputJobFailure(first);
  assert.deepEqual(Object.getOwnPropertyDescriptors(first), before);
  const later = new Error('D1_ERROR', {cause:new Error('SQLITE_BUSY private')});
  recordOutputJobHeartbeatFailure(later, false); logOutputJobFailure(later);
  logOutputJobFailure('private prompt');
  assert.deepEqual(logs, [
    ['output_native_execution_stopped',{stage:'heartbeat_first',kind:'d1_constraint'}],
    ['output_native_execution_stopped',{stage:'heartbeat_later',kind:'d1_busy'}],
    ['output_native_execution_stopped',{stage:'execution',kind:'unknown'}],
  ]);
  assert(!JSON.stringify(logs).includes('private'));
});

test('a failing logger cannot replace the original operation failure', t => {
  t.mock.method(console, 'warn', () => {throw Error('logging failed');});
  const error = new Error('D1_ERROR');
  recordOutputJobHeartbeatFailure(error, true);
  assert.doesNotThrow(() => logOutputJobFailure(error));
});

test('only an exact own authority code outranks its underlying CHECK cause', t => {
  const logs = []; t.mock.method(console, 'warn', (...args) => logs.push(args));
  const cause = new Error('D1_ERROR: CHECK constraint failed: private');
  logOutputJobFailure(Object.assign(new Error('private', {cause}), {code:'output_execution_authority_unverified'}));
  logOutputJobFailure(cause);
  let reads = 0;
  logOutputJobFailure(Object.defineProperty(new Error('private', {cause}), 'code', {get(){reads++;return 'output_execution_authority_unverified';}}));
  logOutputJobFailure(Object.assign(new Error('private', {cause}), {code:'private-code'}));
  assert.equal(reads, 0);
  assert.deepEqual(logs.map(([,value])=>value.kind), ['authority_unverified','d1_constraint','d1_constraint','d1_constraint']);
  assert(!JSON.stringify(logs).includes('private'));
});

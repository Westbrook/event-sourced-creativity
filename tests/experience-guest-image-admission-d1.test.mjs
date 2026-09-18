import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { issuedFixture, request, admissionReceiptAssertions } from './helpers/guest-image-admission-fixture.mjs';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';
import { exportSynthetic, install, rowsSnapshot } from './helpers/model3d-workerd-snapshot.mjs';

const [{ createGuestImageAdmissionAuthority }, { admitGuestImage, readGuestImageAdmission }, { ensureSchema }] = await Promise.all([
  import('../worker/experience-guest-image-admission-witness.ts'), import('../worker/experience-guest-image-admission.ts'), import('../worker/runtime.ts'),
]);
const phase = (name, detail = {}) => process.stderr.write(`[guest-admission-d1] ${JSON.stringify({ phase: name, pid: process.pid, ppid: process.ppid,
  runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...detail })}\n`);
phase('loading-miniflare');
const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve('wrangler'))('miniflare');
phase('miniflare-loaded');
const queryLimits = { functionArguments: 32, parameters: 100, sqlBytes: 100000 };
const compiledSql = new Map();
const sourcePaths = ['worker/experience-guest-image-admission-witness.ts', 'worker/experience-guest-image-admission.ts',
  'worker/output-admission-reads.ts', 'worker/generation-readiness.ts', 'worker/document-jobs-api.ts', 'worker/output-document-execution.ts',
  'tests/helpers/guest-image-admission-fixture.mjs', 'tests/helpers/d1-expression-depth.mjs', 'tests/experience-guest-image-admission-d1.test.mjs'];
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
function exactKeys(value, keys, label) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: exact metadata fields`);
}
function verifiedCompilation(value) {
  exactKeys(value, ['ok', 'limit', 'queryLimits', 'statementBytes', 'parameterCount', 'sqliteVersion'], 'SQL compilation');
  assert.equal(value.ok, true, 'only successful offline compilation can be reused');
  assert.equal(value.limit, 100); assert.deepEqual(value.queryLimits, queryLimits);
  assert.ok(Number.isSafeInteger(value.statementBytes) && value.statementBytes > 0 && value.statementBytes <= queryLimits.sqlBytes);
  assert.ok(Number.isSafeInteger(value.parameterCount) && value.parameterCount >= 0 && value.parameterCount <= queryLimits.parameters);
  assert.match(value.sqliteVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/u);
  return Object.freeze({ ...value, queryLimits: Object.freeze({ ...value.queryLimits }) });
}
async function loadOfflineCompilations() {
  const path = process.env.FORMA_ADMISSION_D1_SQL_PRECHECK, expected = process.env.FORMA_ADMISSION_D1_SQL_PRECHECK_SHA256;
  if (path === undefined && expected === undefined) return null;
  assert.ok(typeof path === 'string' && path.length > 0 && path.length <= 4096, 'SQL precheck path required with its SHA256');
  assert.ok(hash(expected), 'SQL precheck requires an explicit lowercase 64-character SHA256');
  const bytes = await readFile(path);
  assert.ok(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024, 'bounded SQL precheck metadata');
  assert.equal(sha(bytes), expected, 'exact independently pinned SQL precheck bytes');
  const value = JSON.parse(bytes.toString('utf8'));
  exactKeys(value, ['version', 'purpose', 'expressionDepth', 'limits', 'compilerSha256', 'qualificationSha256', 'entries'], 'SQL precheck');
  assert.equal(value.version, 1); assert.equal(value.purpose, 'exact-offline-sql-compilation-only');
  assert.equal(value.expressionDepth, 100); assert.deepEqual(value.limits, queryLimits);
  assert.ok(hash(value.compilerSha256)); assert.ok(hash(value.qualificationSha256));
  assert.equal(value.compilerSha256, sha(await readFile(new URL('./helpers/d1-expression-depth.mjs', import.meta.url))), 'current strict compiler helper bytes');
  assert.ok(Array.isArray(value.entries) && value.entries.length > 0 && value.entries.length <= 8192, 'bounded SQL compilation entries');
  const entries = new Map();
  for (const entry of value.entries) {
    exactKeys(entry, ['key', 'sqlSha256', 'schemaSha256', 'compiled'], 'SQL precheck entry');
    assert.ok(hash(entry.key) && hash(entry.sqlSha256) && hash(entry.schemaSha256));
    assert.equal(entries.has(entry.key), false, 'duplicate SQL compilation key');
    entries.set(entry.key, Object.freeze({ ...entry, compiled: verifiedCompilation(entry.compiled) }));
  }
  phase('offline-sql-compilations-loaded', { sha256: expected, entries: entries.size, compilerSha256: value.compilerSha256,
    qualificationSha256: value.qualificationSha256 });
  return Object.freeze({ entries, sha256: expected, compilerSha256: value.compilerSha256, qualificationSha256: value.qualificationSha256 });
}
// This optional pinned artifact contains compilation metadata only: no database
// rows, permission decisions, results or acknowledgements. Missing exact keys
// still invoke the same strict compiler before any actual D1 statement executes.
const offlineCompilations = await loadOfflineCompilations();
const sourcePins = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await readFile(new URL('../' + path, import.meta.url)))])));
const insertInto = (sql, table) => new RegExp(`\\bINSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${table}\\b`, 'iu').test(sql);
const mutates = sql => /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu.test(sql);
const isAdmission = rows => rows.some(row => insertInto(row.sql, 'output_execution_grants'));

// Every measured application statement is compiled before real workerd D1 sees
// it. The compiler gets only schema/SQL; actual database rows and acknowledgements
// come exclusively from D1. Setup uses the same eventual handle with measurement
// disabled so native bootstrap, rather than a copied readiness flag, marks it.
function observedDatabase(raw, schema) {
  const handles = new WeakMap(), schemaSha256 = sha(JSON.stringify(schema));
  const observed = { measured: false, readOnly: false, records: [], batches: [], violations: [], alterHeldCost: false, injections: [],
    offlineCacheHits: 0, offlineCacheMisses: 0, freshCompilations: 0, inMemoryCacheHits: 0 };
  function qualify(row, inBatch = false) {
    if (!observed.measured) return;
    try {
      assert.ok(row.bindings.length <= queryLimits.parameters, 'actual bound-parameter ceiling');
      assert.ok(Buffer.byteLength(row.sql) <= queryLimits.sqlBytes, 'actual SQL-byte ceiling');
      assert.doesNotMatch(row.sql, /\b(?:CREATE|DROP|ALTER)\s+(?:TABLE|TRIGGER|INDEX|VIEW)\b/iu, 'admission never installs schema');
      if (!inBatch) assert.equal(mutates(row.sql), false, 'all measured admission mutations belong to an atomic native batch');
      assert.doesNotMatch(row.sql, /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(?:provider_health|generation_preflights)\b/iu,
        'guest local readiness never persists provider health or a new readiness quote');
      if (observed.readOnly) {
        assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'exact admitted replay is read-only');
        assert.equal(mutates(row.sql), false, 'exact admitted replay cannot mutate');
      }
      const key = sha(JSON.stringify([schema, queryLimits, row.sql]));
      const offline = offlineCompilations?.entries.get(key);
      let compiled, compilationSource;
      if (offline) {
        assert.equal(offline.sqlSha256, sha(row.sql), 'cached compilation has the exact actual SQL');
        assert.equal(offline.schemaSha256, schemaSha256, 'cached compilation has the exact actual schema');
        compiled = offline.compiled; compilationSource = 'offline'; observed.offlineCacheHits++;
      } else {
        if (offlineCompilations) observed.offlineCacheMisses++;
        compiled = compiledSql.get(key);
        if (compiled) { compilationSource = 'in-memory'; observed.inMemoryCacheHits++; }
      }
      if (!compiled) {
        compiled = compileSqliteExpressionDepth(null, row.sql, { schema, functions: [], limit: 100, queryLimits });
        assert.equal(compiled.ok, true, `strict deployment SQL qualification: ${compiled.error ?? ''}\n${row.sql.slice(0, 220)}`);
        compiled = verifiedCompilation(compiled); compiledSql.set(key, compiled);
        compilationSource = 'fresh'; observed.freshCompilations++;
      }
      assert.equal(compiled.limit, 100); assert.deepEqual(compiled.queryLimits, queryLimits);
      assert.equal(compiled.statementBytes, Buffer.byteLength(row.sql), 'compiled size equals the actual statement bytes');
      assert.equal(compiled.parameterCount, row.bindings.length, 'compiler measures the actual bound parameters');
      observed.records.push({ sql: row.sql, sqlSha256: sha(row.sql), parameters: row.bindings.length, sqlBytes: Buffer.byteLength(row.sql), strictCompilationKey: key, compilationSource, inBatch });
    } catch (error) { observed.violations.push({ sqlSha256: sha(row.sql), error: String(error) }); throw error; }
  }
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings }, result = { bind: (...values) => wrap(statement.bind(...values), sql, values) };
    for (const method of ['first', 'all', 'run']) result[method] = async (...args) => { qualify(row); return statement[method](...args); };
    handles.set(result, row); return result;
  }
  observed.DB = {
    prepare: sql => wrap(raw.prepare(sql), sql),
    async batch(statements) {
      const rows = statements.map(statement => { const row = handles.get(statement); assert.ok(row, 'observed native D1 statement'); return row; });
      const consequential = isAdmission(rows);
      const submitted = [...rows];
      if (observed.measured && observed.alterHeldCost && consequential) {
        const cost = rows.find(row => insertInto(row.sql, 'cost_budget_reservations'));
        assert.ok(cost, 'the actual paired cost reservation belongs to the admission batch');
        assert.equal(typeof cost.bindings[0], 'string', 'native reservation primitive binds its exact reservation ID first');
        const lastLastingWrite = rows.findLastIndex(row => mutates(row.sql)
          && !/^\s*(?:INSERT\s+INTO|DELETE\s+FROM)\s+(?:output_atomic_assertions|experience_sponsor_assertions)\b/iu.test(row.sql));
        const guardIndex = rows.findIndex((row, index) => index > lastLastingWrite && insertInto(row.sql, 'output_atomic_assertions'));
        assert.ok(guardIndex > lastLastingWrite && lastLastingWrite >= 0, 'a genuine final assertion follows every lasting admission write');
        assert.match(rows[guardIndex].sql, /FROM budget_reservations token JOIN cost_budget_reservations cost/iu,
          'inject immediately before the original shared native paired-hold receipt assertion');
        const sql = 'UPDATE cost_budget_reservations SET reserved_microusd=reserved_microusd+1 WHERE reservation_id=?';
        const injection = { statement: raw.prepare(sql).bind(cost.bindings[0]), sql, bindings: [cost.bindings[0]] };
        submitted.splice(guardIndex, 0, injection);
        observed.injections.push({ sql, beforeOriginalStatement: guardIndex, afterLastLastingWrite: lastLastingWrite });
      }
      submitted.forEach(row => qualify(row, true));
      const batch = { sql: submitted.map(row => row.sql), originalSql: rows.map(row => row.sql), consequential, failed: false };
      if (observed.measured) observed.batches.push(batch);
      try { return await raw.batch(submitted.map(row => row.statement)); }
      catch (error) { batch.failed = true; batch.error = String(error); throw error; }
    },
  };
  return observed;
}

async function fixture(t) {
  const beforePins = await sourcePins();
  phase('source-bookend-before', { sourcePins: beforePins });
  t.after(async () => {
    const afterPins = await sourcePins();
    phase('source-bookend-after', { sourcePins: afterPins });
    assert.deepEqual(afterPins, beforePins, 'qualified source and test bytes did not change during the actual D1 case');
  });
  let externalCalls = 0;
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    log: new Log(LogLevel.NONE), d1Databases: ['GuestAdmission'],
    script: "export default {fetch(){return new Response('Local guest admission D1 fixture only.',{status:404});}};",
    outboundService() { externalCalls++; throw Error('External workerd fetch forbidden.'); },
  });
  phase('miniflare-constructed');
  t.after(async () => { phase('miniflare-dispose-start'); await mf.dispose(); phase('miniflare-dispose-complete'); assert.equal(externalCalls, 0); });
  const raw = await mf.getD1Database('GuestAdmission');
  phase('d1-binding-ready');
  // Establish the local runtime bridge before the accepted source fixture adds
  // its application fetch/media tripwires. No provider or media is permitted.
  const f = await issuedFixture(t), exported = exportSynthetic(f.sqlite);
  phase('genuine-issuer-setup-complete');
  const compound = count => Array.from({ length: count }, () => 'SELECT 1').join(' UNION ALL ');
  assert.equal((await raw.prepare(compound(5)).all()).results.length, 5);
  await assert.rejects(raw.prepare(compound(6)).all(), /too many terms in compound SELECT/iu);
  await install(raw, exported);
  phase('exact-snapshot-installed');
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const observed = observedDatabase(raw, schema);
  f.env.DB = observed.DB; f.DB = observed.DB;
  const beforeBootstrapSchema = (await raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
  await ensureSchema(f.env);
  assert.deepEqual(await rowsSnapshot(raw, exported.tables), exported.rows, 'genuine native D1 bootstrap leaves every copied row and rowid unchanged');
  assert.deepEqual((await raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results, beforeBootstrapSchema,
    'genuine native D1 bootstrap preserves exact installed schema');
  observed.measured = true;
  t.after(() => assert.deepEqual(observed.violations, [], 'application error handling cannot hide qualification or replay-write violations'));
  phase('measured-admission-ready');
  return { ...f, raw, observed, exported };
}

const allRows = async (db, table) => (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results;
const admissionTables = new Set(['events', 'event_private_payloads', 'output_commands', 'output_execution_grants', 'output_operation_slots',
  'output_operation_routes', 'document_jobs', 'budget_counters', 'cost_budget_counters', 'budget_reservations', 'cost_budget_reservations',
  'experience_sponsor_consumptions', 'experience_sponsor_active_jobs']);
function metrics(t, f, label) {
  t.diagnostic(JSON.stringify({ label, engine: 'Wrangler-pinned Miniflare/workerd D1', localOnly: true,
    sourceSetup: 'genuine native guest/issuer APIs on SQLite, exact synthetic transfer, genuine D1 schema bootstrap',
    applicationExecution: 'Node-hosted genuine guest admission APIs against actual local workerd D1',
    actualCompoundSelectLimit: 5, expressionDepthLimit: 100, ...queryLimits,
    strictlyQualifiedStatements: f.observed.records.length, uniqueSql: new Set(f.observed.records.map(row => row.sqlSha256)).size,
    offlineCacheSha256: offlineCompilations?.sha256 ?? null, offlineCacheHits: f.observed.offlineCacheHits,
    offlineCacheMisses: f.observed.offlineCacheMisses, freshCompilations: f.observed.freshCompilations, inMemoryCacheHits: f.observed.inMemoryCacheHits,
    maxBindings: Math.max(0, ...f.observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(0, ...f.observed.records.map(row => row.sqlBytes)),
    consequentialBatches: f.observed.batches.filter(batch => batch.consequential).length, failedBatches: f.observed.batches.filter(batch => batch.failed).length,
    injectedStatements: f.observed.injections }));
}

test('actual local workerd D1 admits genuine guest Image with paired holds and read-only original replay', { timeout: 120000 }, async t => {
  const f = await fixture(t), before = await rowsSnapshot(f.raw, f.exported.tables);
  assert.equal(await readGuestImageAdmission(request(), f.env, f.input), null);
  const req = request(), authority = await createGuestImageAdmissionAuthority(req, f.env, f.input);
  phase('admission-write-start');
  const admitted = await admitGuestImage(req, f.env, authority);
  phase('admission-write-complete');
  admissionReceiptAssertions(f, admitted, false);
  const after = await rowsSnapshot(f.raw, f.exported.tables);
  for (const table of f.exported.tables) if (!admissionTables.has(table)) assert.deepEqual(after[table], before[table], `unchanged ${table}`);
  for (const table of ['events', 'event_private_payloads']) {
    assert.equal(after[table].length, before[table].length + 2, 'one queue and one native authorization event with their private bodies');
    assert.deepEqual(after[table].slice(0, before[table].length), before[table], `original ${table} bytes and rowids are unchanged`);
  }
  for (const table of ['output_commands', 'output_execution_grants', 'output_operation_slots', 'document_jobs', 'budget_reservations',
    'cost_budget_reservations', 'experience_sponsor_consumptions', 'experience_sponsor_active_jobs']) assert.equal(after[table].length, before[table].length + 1, table);
  assert.deepEqual(after.output_commands.slice(0, before.output_commands.length), before.output_commands, 'original native SAVE/confirmation/quote commands remain byte-identical');
  assert.equal(after.output_operation_routes.length, before.output_operation_routes.length + 2, 'exact native planning and Image provider-stage routes');
  const [grant] = await allRows(f.raw, 'output_execution_grants'), [slot] = await allRows(f.raw, 'output_operation_slots'), [job] = await allRows(f.raw, 'document_jobs');
  const [tokens] = await allRows(f.raw, 'budget_reservations'), [cost] = await allRows(f.raw, 'cost_budget_reservations');
  const [consumption] = await allRows(f.raw, 'experience_sponsor_consumptions'), [active] = await allRows(f.raw, 'experience_sponsor_active_jobs');
  const payer = (await allRows(f.raw, 'users'))[0].user_id, guest = f.session.guestSubject;
  assert.notEqual(payer, guest); assert.equal((await allRows(f.raw, 'users')).length, 1, 'no fabricated canonical guest');
  assert.equal(grant.grant_id, admitted.grantId); assert.equal(grant.actor_user_id, guest); assert.equal(grant.payer_user_id, payer);
  assert.equal(slot.slot_id, admitted.slotId); assert.equal(slot.job_id, admitted.jobId); assert.equal(slot.status, 'authorized');
  assert.equal(slot.maximum_tokens, 128000, 'the exact retained Image quote cap is not lowered to the job minimum');
  assert.equal(slot.attempt_ordinal, 0); assert.equal(slot.previous_slot_id, null);
  assert.equal(job.job_id, admitted.jobId); assert.equal(job.owner_id, guest); assert.equal(job.stream_id, `creative:${guest}`); assert.equal(job.status, 'queued');
  assert.ok(Date.parse(grant.expires_at) <= f.issued.expiresAtMs); assert.ok(Date.parse(job.expires_at) <= f.issued.expiresAtMs);
  assert.equal(tokens.reservation_id, slot.token_reservation_id); assert.equal(cost.reservation_id, slot.cost_reservation_id);
  for (const hold of [tokens, cost]) { assert.equal(hold.owner_id, payer); assert.equal(hold.status, 'active'); assert.equal(hold.stream_id, job.stream_id); assert.equal(hold.correlation_id, job.correlation_id); }
  assert.equal(tokens.period, cost.period); assert.equal(tokens.reserved_tokens, slot.maximum_tokens); assert.equal(cost.reserved_microusd, slot.maximum_microusd); assert.equal(cost.allow_user_overage, 0);
  for (const [table, field, amount] of [['budget_counters', 'tokens', slot.maximum_tokens], ['cost_budget_counters', 'microusd', slot.maximum_microusd]]) {
    const counters = await allRows(f.raw, table);
    assert.equal(counters.length, 2, `${table}: only actual payer and Forma workspace counters`);
    assert.deepEqual(new Set(counters.map(row => `${row.scope}:${row.scope_id}`)), new Set([`user:${payer}`, 'workspace:forma']));
    assert.ok(counters.every(row => row[`used_${field}`] === 0 && row[`reserved_${field}`] === amount && row.period === tokens.period));
  }
  assert.equal(consumption.consumption_id, admitted.consumptionId); assert.equal(consumption.grant_id, admitted.sponsorGrantId); assert.equal(consumption.actor_user_id, guest);
  assert.equal(consumption.job_id, admitted.jobId); assert.equal(active.job_id, admitted.jobId); assert.equal(active.actor_user_id, guest); assert.equal(active.consumption_id, admitted.consumptionId);
  const newEvents = (await allRows(f.raw, 'events')).slice(-2);
  assert.deepEqual(new Set(newEvents.map(row => row.type)), new Set(['OutputOperationJobQueued', 'OutputExecutionAuthorized']));
  assert.ok(newEvents.every(row => row.actor === guest && row.stream_id === job.stream_id), 'truthful native guest provenance');
  const batches = f.observed.batches.filter(batch => batch.consequential); assert.equal(batches.length, 1); assert.equal(batches[0].failed, false);
  for (const table of ['budget_reservations', 'cost_budget_reservations', 'experience_sponsor_consumptions', 'experience_sponsor_active_jobs', 'document_jobs'])
    assert.ok(batches[0].sql.some(sql => insertInto(sql, table)), `${table} belongs to the same native batch`);
  f.observed.readOnly = true;
  const replayRequest = request(), replayAuthority = await createGuestImageAdmissionAuthority(replayRequest, f.env, f.input);
  assert.deepEqual(await admitGuestImage(replayRequest, f.env, replayAuthority), { ...admitted, replayed: true });
  assert.deepEqual(await readGuestImageAdmission(request(), f.env, f.input), { ...admitted, replayed: true });
  assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), after, 'replay retains exact original job, slot, paired holds and all counters/timestamps');
  assert.deepEqual((await f.raw.prepare('PRAGMA foreign_key_check').all()).results, []);
  metrics(t, f, 'native-admission-and-original-replay');
});

test('actual local workerd D1 final receipt refuses a changed paired hold and rolls back every admission row', { timeout: 120000 }, async t => {
  const f = await fixture(t), before = await rowsSnapshot(f.raw, f.exported.tables);
  const req = request(), authority = await createGuestImageAdmissionAuthority(req, f.env, f.input);
  f.observed.alterHeldCost = true;
  await assert.rejects(admitGuestImage(req, f.env, authority));
  f.observed.alterHeldCost = false;
  const batches = f.observed.batches.filter(batch => batch.consequential);
  assert.equal(batches.length, 1, 'one original admission attempt, without retry or replacement holds');
  assert.equal(batches[0].failed, true); assert.equal(f.observed.injections.length, 1);
  assert.match(batches[0].error, /CHECK constraint failed/iu, 'a genuine native transaction assertion rejects the altered financial receipt');
  for (const table of ['budget_reservations', 'cost_budget_reservations', 'output_execution_grants', 'output_operation_slots', 'document_jobs',
    'experience_sponsor_consumptions', 'experience_sponsor_active_jobs']) assert.ok(batches[0].originalSql.some(sql => insertInto(sql, table)), `${table} was in the original attempted transaction`);
  assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), before, 'actual D1 rolls back both holds, counters, native events/job/grant/slot and sponsor rows atomically');
  f.observed.readOnly = true;
  assert.equal(await readGuestImageAdmission(request(), f.env, f.input), null, 'failed transaction is not reconstructed as an admitted original');
  assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), before);
  assert.deepEqual((await f.raw.prepare('PRAGMA foreign_key_check').all()).results, []);
  metrics(t, f, 'final-held-cost-mismatch-rollback');
});

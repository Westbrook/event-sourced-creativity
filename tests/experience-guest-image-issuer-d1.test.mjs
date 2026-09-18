import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { quotedFixture, request } from './helpers/guest-image-issuer-fixture.mjs';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';
import { exportSynthetic, install, rowsSnapshot } from './helpers/model3d-workerd-snapshot.mjs';

const [{ prepareGuestImageAuthorization, createGuestImageAuthorization },
  { issueGuestImageGrant, readGuestImageIssuance }, { inheritRuntimeSchemaReadiness }] = await Promise.all([
  import('../worker/experience-guest-image-authorization.ts'), import('../worker/experience-guest-image-issuer.ts'), import('../worker/runtime.ts'),
]);
const phase = (name, detail = {}) => process.stderr.write(`[guest-issuer-d1] ${JSON.stringify({ phase: name, ...detail })}\n`);
phase('loading-miniflare');
const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve('wrangler'))('miniflare');
phase('miniflare-loaded');
const queryLimits = { functionArguments: 32, parameters: 100, sqlBytes: 100000 };
const compiledSql = new Map();
const issuedTables = new Set(['experience_sponsor_grants', 'experience_sponsor_resource_receipts', 'experience_sponsor_issuances']);
const insertsGrant = sql => /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+experience_sponsor_grants\b/iu.test(sql);
const insertsResource = sql => /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+experience_sponsor_resource_receipts\b/iu.test(sql);
const insertsIssuance = sql => /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+experience_sponsor_issuances\b/iu.test(sql);
const mutates = sql => /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu.test(sql);

// This wrapper only observes and qualifies real workerd D1 statements. It never
// evaluates application SQL, manufactures rows or alters acknowledgements.
function observedDatabase(raw, schema) {
  const handles = new WeakMap();
  const observed = { records: [], batches: [], violations: [], readOnly: false };
  function qualify(row) {
    try {
      assert.ok(row.bindings.length <= queryLimits.parameters, 'actual D1 binding ceiling');
      assert.ok(Buffer.byteLength(row.sql) <= queryLimits.sqlBytes, 'actual D1 SQL byte ceiling');
      if (observed.readOnly) {
        assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'issued replay is read-only');
        assert.equal(mutates(row.sql), false, 'issued replay cannot mutate');
      }
      const key = createHash('sha256').update(JSON.stringify([schema, queryLimits, row.sql])).digest('hex');
      let compiled = compiledSql.get(key);
      if (!compiled) {
        compiled = compileSqliteExpressionDepth(null, row.sql, { schema, functions: [], limit: 100, queryLimits });
        assert.equal(compiled.ok, true, `strict deployment SQL qualification: ${compiled.error ?? ''}\n${row.sql.slice(0, 220)}`);
        compiledSql.set(key, compiled);
      }
      assert.equal(compiled.limit, 100);
      assert.deepEqual(compiled.queryLimits, queryLimits);
      assert.equal(compiled.parameterCount, row.bindings.length, 'compiled count equals actual bound parameters');
      observed.records.push({ sql: row.sql, sqlSha256: createHash('sha256').update(row.sql).digest('hex'),
        parameters: row.bindings.length, sqlBytes: Buffer.byteLength(row.sql), strictCompilationKey: key });
    } catch (error) {
      observed.violations.push({ sqlSha256: createHash('sha256').update(row.sql).digest('hex'), error: String(error) });
      throw error;
    }
  }
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings };
    const result = { bind: (...values) => wrap(statement.bind(...values), sql, values) };
    for (const method of ['first', 'all', 'run']) result[method] = async (...args) => {
      qualify(row);
      return statement[method](...args);
    };
    handles.set(result, row);
    return result;
  }
  observed.DB = {
    prepare: sql => wrap(raw.prepare(sql), sql),
    async batch(statements) {
      const rows = statements.map(statement => {
        const row = handles.get(statement);
        assert.ok(row, 'application batch uses only observed native statements');
        qualify(row);
        return row;
      });
      const batch = { sql: rows.map(row => row.sql), failed: false };
      observed.batches.push(batch);
      try { return await raw.batch(rows.map(row => row.statement)); }
      catch (error) { batch.failed = true; batch.error = String(error); throw error; }
    },
  };
  return observed;
}

async function fixture(t, options = {}) {
  // Genuine guest source, payer approval, SAVE, confirmation and quote use the
  // native APIs in the shared SQLite fixture. Copy those exact synthetic schema,
  // scalar values and rowids; authorization and issuance below then use D1.
  let outboundCalls = 0;
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    log: new Log(LogLevel.NONE), d1Databases: ['GuestIssuer'],
    script: "export default {fetch(){return new Response('Local guest issuer D1 fixture only.',{status:404});}};",
    outboundService() { outboundCalls++; throw Error('External workerd fetch forbidden.'); },
  });
  phase('miniflare-constructed');
  t.after(async () => { await mf.dispose(); assert.equal(outboundCalls, 0); });
  const raw = await mf.getD1Database('GuestIssuer');
  phase('d1-binding-ready');
  // Match the accepted stage D1 harness: establish the local runtime bridge
  // before the native fixture installs its application fetch tripwire. Worker
  // egress is denied from construction; every application operation below
  // still runs with the original fetch/media tripwires in place.
  phase('native-quoted-setup-start', options);
  const f = await quotedFixture(t, options), exported = exportSynthetic(f.sqlite);
  phase('native-quoted-setup-complete');
  // Measure this pinned local engine's compound ceiling. These probes are not
  // application evidence and make no assertion about hosted D1 service limits.
  const compound = count => Array.from({ length: count }, () => 'SELECT 1').join(' UNION ALL ');
  phase('compound-probe-start');
  assert.equal((await raw.prepare(compound(5)).all()).results.length, 5);
  await assert.rejects(raw.prepare(compound(6)).all(), /too many terms in compound SELECT/iu);
  phase('compound-probe-complete');
  await install(raw, exported);
  phase('exact-snapshot-installed');
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const observed = observedDatabase(raw, schema);
  inheritRuntimeSchemaReadiness(f.env.DB, observed.DB);
  f.env.DB = observed.DB;
  f.DB = observed.DB;
  t.after(() => assert.deepEqual(observed.violations, [], 'application errors cannot swallow SQL-limit or read-only harness failures'));
  return { ...f, raw, observed, exported };
}

async function authorize(f, req) {
  const review = await prepareGuestImageAuthorization(req, f.env, f.input);
  assert.equal(review.status, 'review');
  assert.equal(review.documentId, f.session.documentId);
  assert.equal(review.sourceRevision, f.committed.head + 3);
  const authority = await createGuestImageAuthorization(req, f.env,
    { ...f.input, authorization: { ...review.authorization, explicitAuthorization: true } });
  return { review, authority };
}
function assertReceipt(f, result, replayed) {
  assert.equal(result.status, 'issued');
  assert.equal(result.documentId, f.session.documentId);
  assert.equal(result.preflightId, f.quoted.preflight.id);
  assert.match(result.grantId, /^sponsor-issued-[0-9a-f]{64}$/u);
  assert.ok(Number.isSafeInteger(result.expiresAtMs));
  assert.equal(result.replayed, replayed);
  for (const flag of ['nativeAuthorizationCommitted', 'admissionCommitted', 'generationAvailable', 'custodyTransferred']) assert.equal(result[flag], false, flag);
}
const allRows = async (db, table) => (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results;
function metrics(t, f, label) {
  t.diagnostic(JSON.stringify({ label, engine: 'Wrangler-pinned Miniflare/workerd D1', localOnly: true,
    sourceSetup: 'genuine native APIs on SQLite, exact synthetic transfer', applicationExecution: 'Node-hosted issuer APIs against actual local workerd D1',
    actualCompoundSelectLimit: 5, expressionDepthLimit: 100, ...queryLimits,
    strictlyQualifiedStatements: f.observed.records.length, uniqueSql: new Set(f.observed.records.map(row => row.sqlSha256)).size,
    maxBindings: Math.max(0, ...f.observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(0, ...f.observed.records.map(row => row.sqlBytes)),
    batches: f.observed.batches.length, consequentialBatches: f.observed.batches.filter(batch => batch.sql.some(insertsGrant)).length,
    failedBatches: f.observed.batches.filter(batch => batch.failed).length }));
}

test('actual local workerd D1 issues one guest Image triple and exactly replays without writing', { timeout: 120000 }, async t => {
  const f = await fixture(t), before = await rowsSnapshot(f.raw, f.exported.tables);
  phase('issuer-observation-start');
  assert.equal(await readGuestImageIssuance(request(), f.env, f.input), null);
  const req = request(), { authority } = await authorize(f, req);
  phase('issuer-write-start');
  const issued = await issueGuestImageGrant(req, f.env, authority);
  phase('issuer-write-complete');
  assertReceipt(f, issued, false);
  const after = await rowsSnapshot(f.raw, f.exported.tables);
  for (const table of f.exported.tables) if (!issuedTables.has(table)) assert.deepEqual(after[table], before[table], `unchanged ${table}`);
  for (const table of issuedTables) assert.equal(after[table].length, before[table].length + 1, `one new ${table} row`);
  assert.deepEqual(after.experience_sponsor_resource_receipts.slice(0, -1), before.experience_sponsor_resource_receipts, 'retained resource receipts are immutable');
  const [grant] = await allRows(f.raw, 'experience_sponsor_grants'), [issuance] = await allRows(f.raw, 'experience_sponsor_issuances');
  const resource = (await allRows(f.raw, 'experience_sponsor_resource_receipts')).at(-1);
  assert.equal(grant.grant_id, issued.grantId);
  assert.equal(grant.actor_user_id, f.session.guestSubject);
  assert.equal(grant.expires_at_ms, issued.expiresAtMs);
  assert.equal(issuance.grant_id, grant.grant_id);
  assert.equal(issuance.actor_user_id, f.session.guestSubject);
  assert.equal(resource.operation, 'issuance');
  assert.equal(resource.issued_grant_id, grant.grant_id);
  assert.equal(resource.actor_user_id, f.session.guestSubject);
  const batches = f.observed.batches.filter(batch => batch.sql.some(insertsGrant));
  assert.equal(batches.length, 1, 'all lasting rows share exactly one issuance batch');
  assert.equal(batches[0].failed, false);
  assert.ok(batches[0].sql.some(insertsResource));
  assert.ok(batches[0].sql.some(insertsIssuance));

  f.observed.readOnly = true;
  const replayRequest = request(), replayAuthority = (await authorize(f, replayRequest)).authority;
  const replay = await issueGuestImageGrant(replayRequest, f.env, replayAuthority);
  assertReceipt(f, replay, true);
  assert.deepEqual(replay, { ...issued, replayed: true });
  assert.deepEqual(await readGuestImageIssuance(request(), f.env, f.input), replay);
  assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), after, 'replay/read preserves every row, counter and original timestamp');
  assert.deepEqual((await f.raw.prepare('PRAGMA foreign_key_check').all()).results, []);
  metrics(t, f, 'issued-and-exact-replay');
});

test('actual local workerd D1 exhausted guest issuance resource cap rolls back the entire triple', { timeout: 120000 }, async t => {
  const f = await fixture(t, { operationCap: 3 }), before = await rowsSnapshot(f.raw, f.exported.tables);
  assert.equal((await allRows(f.raw, 'experience_sponsor_resource_receipts')).length, 3, 'SAVE, confirmation and quote exhaust the approved finite operation budget');
  const req = request(), { authority } = await authorize(f, req);
  await assert.rejects(issueGuestImageGrant(req, f.env, authority));
  const batches = f.observed.batches.filter(batch => batch.sql.some(insertsGrant));
  assert.equal(batches.length, 1, 'one consequential attempt, never a second purchase');
  assert.equal(batches[0].failed, true, 'actual native D1 transaction failed');
  assert.ok(batches[0].sql.some(insertsResource));
  assert.ok(batches[0].sql.some(insertsIssuance));
  assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), before, 'native D1 rolls back grant, resource and issuer together without refund or decrement');
  f.observed.readOnly = true;
  assert.equal(await readGuestImageIssuance(request(), f.env, f.input), null, 'failed transaction is not reconstructed as an issued original');
  assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), before);
  assert.deepEqual((await f.raw.prepare('PRAGMA foreign_key_check').all()).results, []);
  metrics(t, f, 'atomic-operation-cap-refusal');
});

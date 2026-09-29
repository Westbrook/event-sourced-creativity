import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { completedResultFixture, guardInventory, deeplyFrozen, payer, compileResultInventorySql } from './helpers/guest-image-result-inventory-fixture.mjs';
import { request } from './helpers/guest-image-run-fixture.mjs';
import { exportSynthetic, install, rowsSnapshot } from './helpers/model3d-workerd-snapshot.mjs';

const { inspectGuestImageResultInventory, guestImageResultInventoryData, assertGuestImageResultInventoryCurrent } =
  await import('../worker/experience-guest-image-result-inventory.ts');
const { canonicalJson } = await import('../src/experiences/compiler.ts');
const phase = (name, detail = {}) => process.stderr.write(`[guest-result-inventory-d1] ${JSON.stringify({ phase: name,
  pid: process.pid, ppid: process.ppid, runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...detail })}\n`);
phase('loading-miniflare');
const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve('wrangler'))('miniflare');
phase('miniflare-loaded');
const queryLimits = { functionArguments: 32, parameters: 100, sqlBytes: 100000 }, compiledSql = new Map();
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const sourcePaths = ['worker/experience-guest-image-result-contract.ts', 'worker/experience-guest-image-result-facts.ts',
  'worker/experience-guest-image-result-inventory.ts', 'tests/experience-guest-image-result-contract.test.mjs',
  'tests/experience-guest-image-result-inventory.test.mjs', 'tests/experience-guest-image-result-inventory-d1.test.mjs',
  'tests/helpers/guest-image-result-inventory-fixture.mjs', 'tests/helpers/guest-image-run-fixture.mjs',
  'tests/helpers/guest-image-admission-fixture.mjs', 'tests/helpers/guest-image-issuer-fixture.mjs',
  'tests/helpers/guest-image-stage-fixture.mjs', 'tests/helpers/d1-expression-depth.mjs', 'tests/helpers/model3d-workerd-snapshot.mjs',
  'worker/experience-guest-image-history.ts', 'worker/experience-guest-image-stage-facts.ts',
  'worker/experience-guest-sponsor-contract.ts', 'worker/experience-sponsor-image-format.ts',
  'worker/experience-guest-image-admission-witness.ts', 'worker/experience-guest-image-execution.ts',
  'worker/experience-guest-image-driver.ts', 'worker/document-jobs-api.ts', 'worker/events-api.ts',
  'worker/output-execution-control.ts', 'worker/output-requirements-ledger.ts'];
const sourcePins = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, sha(await readFile(new URL('../' + path, import.meta.url)))])));
function exactKeys(value, keys, label) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: exact fields`);
}
function verifiedCompilation(value) {
  exactKeys(value, ['ok', 'limit', 'queryLimits', 'statementBytes', 'parameterCount', 'sqliteVersion', 'compoundSelectLimit'], 'SQL compilation');
  assert.equal(value.ok, true); assert.equal(value.limit, 100); assert.deepEqual(value.queryLimits, queryLimits);
  assert.equal(value.compoundSelectLimit, 5);
  assert.ok(Number.isSafeInteger(value.statementBytes) && value.statementBytes > 0 && value.statementBytes <= queryLimits.sqlBytes);
  assert.ok(Number.isSafeInteger(value.parameterCount) && value.parameterCount >= 0 && value.parameterCount <= queryLimits.parameters);
  assert.match(value.sqliteVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/u);
  return Object.freeze({ ...value, queryLimits: Object.freeze({ ...value.queryLimits }) });
}
async function loadOfflineCompilations() {
  const path = process.env.FORMA_RESULT_INVENTORY_D1_SQL_PRECHECK, expected = process.env.FORMA_RESULT_INVENTORY_D1_SQL_PRECHECK_SHA256;
  if (path === undefined && expected === undefined) return null;
  assert.ok(typeof path === 'string' && path.length > 0 && path.length <= 4096);
  assert.ok(hash(expected), 'an explicit lowercase SHA256 pins the offline artifact');
  const bytes = await readFile(path);
  assert.ok(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024); assert.equal(sha(bytes), expected);
  const value = JSON.parse(bytes.toString('utf8'));
  exactKeys(value, ['version', 'purpose', 'expressionDepth', 'limits', 'compilerSha256', 'wrapperSha256', 'qualificationSha256', 'entries'], 'SQL precheck');
  assert.equal(value.version, 1); assert.equal(value.purpose, 'exact-offline-sql-compilation-only');
  assert.equal(value.expressionDepth, 100); assert.deepEqual(value.limits, queryLimits);
  assert.ok(hash(value.compilerSha256) && hash(value.wrapperSha256) && hash(value.qualificationSha256));
  assert.equal(value.compilerSha256, sha(await readFile(new URL('./helpers/d1-expression-depth.mjs', import.meta.url))));
  assert.equal(value.wrapperSha256, sha(await readFile(new URL('./helpers/guest-image-result-inventory-fixture.mjs', import.meta.url))));
  assert.ok(Array.isArray(value.entries) && value.entries.length > 0 && value.entries.length <= 8192);
  const entries = new Map();
  for (const entry of value.entries) {
    exactKeys(entry, ['key', 'sqlSha256', 'schemaSha256', 'compiled'], 'SQL precheck entry');
    assert.ok(hash(entry.key) && hash(entry.sqlSha256) && hash(entry.schemaSha256)); assert.equal(entries.has(entry.key), false);
    entries.set(entry.key, Object.freeze({ ...entry, compiled: verifiedCompilation(entry.compiled) }));
  }
  phase('offline-sql-compilations-loaded', { sha256: expected, entries: entries.size,
    compilerSha256: value.compilerSha256, wrapperSha256: value.wrapperSha256, qualificationSha256: value.qualificationSha256 });
  return Object.freeze({ entries, sha256: expected });
}
// Only exact successful compiler metadata is reusable. Actual permissions, rows
// and acknowledgements always come from D1; missing keys compile freshly.
const offlineCompilations = await loadOfflineCompilations();
const mutates = sql => /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu.test(sql);
function observedDatabase(raw, schema) {
  const handles = new WeakMap(), schemaSha256 = sha(JSON.stringify(schema));
  const observed = { records: [], batches: [], violations: [], afterFirst: null, afterBatch: null, tamperedProofs: [],
    offlineCacheHits: 0, offlineCacheMisses: 0, freshCompilations: 0, inMemoryCacheHits: 0 };
  const forbidden = operation => { const error = new Error(`inventory cannot call ${operation}`);
    observed.violations.push({ operation, error: String(error) }); throw error; };
  function qualify(row, method) {
    try {
      assert.ok(row.bindings.length <= queryLimits.parameters); assert.ok(Buffer.byteLength(row.sql) <= queryLimits.sqlBytes);
      assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'inventory executes only read statements');
      assert.equal(mutates(row.sql), false, 'inventory never installs schema or changes any row');
      const key = sha(JSON.stringify([schema, queryLimits, row.sql])), offline = offlineCompilations?.entries.get(key);
      let compiled, compilationSource;
      if (offline) {
        assert.equal(offline.sqlSha256, sha(row.sql)); assert.equal(offline.schemaSha256, schemaSha256);
        compiled = offline.compiled; compilationSource = 'offline'; observed.offlineCacheHits++;
      } else {
        if (offlineCompilations) observed.offlineCacheMisses++;
        compiled = compiledSql.get(key);
        if (compiled) { compilationSource = 'in-memory'; observed.inMemoryCacheHits++; }
      }
      if (!compiled) {
        compiled = compileResultInventorySql(schema, row.sql);
        assert.equal(compiled.ok, true, `strict D1 qualification: ${compiled.error ?? ''}\n${row.sql.slice(0, 220)}`);
        compiled = verifiedCompilation(compiled); compiledSql.set(key, compiled); compilationSource = 'fresh'; observed.freshCompilations++;
      }
      assert.equal(compiled.statementBytes, Buffer.byteLength(row.sql)); assert.equal(compiled.parameterCount, row.bindings.length);
      observed.records.push({ sql: row.sql, sqlSha256: sha(row.sql), parameters: row.bindings.length,
        sqlBytes: Buffer.byteLength(row.sql), strictCompilationKey: key, compilationSource, method });
    } catch (error) { observed.violations.push({ sqlSha256: sha(row.sql), error: String(error) }); throw error; }
  }
  function wrap(statement, sql, bindings = []) {
    const row = { statement, sql, bindings }, wrapped = { bind: (...values) => wrap(statement.bind(...values), sql, values) };
    for (const method of ['first', 'all', 'run']) wrapped[method] = async (...args) => {
      qualify(row, method); const result = await statement[method](...args);
      return method === 'first' && observed.afterFirst ? observed.afterFirst(row, result) : result;
    };
    handles.set(wrapped, row); return wrapped;
  }
  observed.DB = {
    prepare: sql => wrap(raw.prepare(sql), sql),
    exec: () => forbidden('DB.exec'),
    dump: () => forbidden('DB.dump'),
    async batch(statements) {
      const rows = statements.map(statement => { const row = handles.get(statement); assert.ok(row); return row; });
      rows.forEach(row => qualify(row, 'batch')); observed.batches.push(rows.map(row => row.sql));
      const result = await raw.batch(rows.map(row => row.statement));
      return observed.afterBatch ? observed.afterBatch(rows, result) : result;
    },
  };
  return observed;
}

async function fixture(t, memory) {
  const beforePins = await sourcePins(); phase('source-bookend-before', { sourcePins: beforePins });
  t.after(async () => { const afterPins = await sourcePins(); phase('source-bookend-after', { sourcePins: afterPins });
    assert.deepEqual(afterPins, beforePins, 'source and test bytes remain fixed during qualification'); });
  let outbound = 0;
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    log: new Log(LogLevel.NONE), d1Databases: ['GuestResultInventory'],
    script: "export default {fetch(){return new Response('Local read-only guest result inventory fixture.',{status:404});}};",
    outboundService() { outbound++; throw Error('External workerd fetch forbidden.'); },
  });
  phase('miniflare-constructed');
  t.after(async () => { phase('miniflare-dispose-start'); await mf.dispose(); phase('miniflare-dispose-complete'); assert.equal(outbound, 0); });
  const raw = await mf.getD1Database('GuestResultInventory'); phase('d1-binding-ready');
  // Establish the local bridge before genuine native fixture setup installs its
  // synthetic provider wire. Provider/R2 use ends before inventory measurement.
  const f = await completedResultFixture(t, { memory }), exported = exportSynthetic(f.sqlite);
  phase('genuine-completed-native-setup-ready', { memory });
  const compound = count => Array.from({ length: count }, () => 'SELECT 1').join(' UNION ALL ');
  assert.equal((await raw.prepare(compound(5)).all()).results.length, 5);
  await assert.rejects(raw.prepare(compound(6)).all(), /too many terms in compound SELECT/iu);
  await install(raw, exported);
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const observed = observedDatabase(raw, schema);
  // Inventory must handle a genuine cold read-only handle. No ensureSchema call
  // or inherited runtime readiness conceals an application write during reads.
  f.env.DB = observed.DB; f.DB = observed.DB;
  t.after(() => assert.deepEqual(observed.violations, [], 'application refusal cannot swallow a harness SQL/read-only violation'));
  phase('exact-completed-snapshot-installed', { memory });
  return { ...f, raw, observed, exported, memory };
}
const databaseSnapshot = async f => ({
  schema: (await f.raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results,
  rows: await rowsSnapshot(f.raw, f.exported.tables),
});
const allRows = async (f, table) => (await f.raw.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results;
const digest = value => `sha256:${sha(canonicalJson(value))}`;
async function assertInventory(f, data) {
  exactKeys(data, ['manifest', 'manifestDigest', 'review', 'proof'], 'opaque inventory data'); deeplyFrozen(data);
  const { manifest: m, review } = data, { body, event, job } = f.completed;
  exactKeys(m, ['version', 'kind', 'sessionId', 'guestSubject', 'projectId', 'documentId', 'sourceHead', 'sourceSaveHead',
    'quoteHead', 'runHead', 'resultHead', 'expiresAt', 'draftHash', 'contentDigest', 'sourceEventIds', 'originalPayerUserId',
    'generationId', 'completionEventId', 'usageEventId', 'completedAt', 'nativeIdentity', 'financialReceipt', 'privateContents',
    'object', 'nativeSnapshotDigest'], 'completed manifest');
  assert.equal(m.version, 1); assert.equal(m.kind, 'original-image-completed-result');
  assert.equal(m.sessionId, f.session.sessionId); assert.equal(m.guestSubject, f.session.guestSubject);
  assert.equal(m.projectId, f.session.projectId); assert.equal(m.documentId, f.session.documentId);
  assert.equal(m.sourceHead, f.committed.head); assert.equal(m.sourceSaveHead, f.committed.head + 1);
  assert.equal(m.quoteHead, f.committed.head + 3); assert.equal(m.runHead, f.committed.head + 6); assert.equal(m.resultHead, f.committed.head + 14);
  assert.equal(m.draftHash, f.input.draftHash); assert.equal(m.originalPayerUserId, payer);
  assert.equal(m.generationId, body.generation_id); assert.equal(m.completionEventId, event.eventId); assert.equal(m.completedAt, job.completed_at);
  const [source] = await allRows(f, 'experience_guest_sources'), [commit] = await allRows(f, 'experience_guest_source_commits');
  assert.equal(m.contentDigest, source.content_digest); assert.deepEqual(m.sourceEventIds, JSON.parse(commit.event_ids_json));
  const usage = (await allRows(f, 'events')).filter(row => row.type === 'GenerationUsageRecorded'); assert.equal(usage.length, 1);
  assert.equal(m.usageEventId, usage[0].event_id); assert.equal(m.resultHead, usage[0].sequence);
  assert.deepEqual(m.nativeIdentity, { scopeKey: f.initialSlot.scope_key, jobId: f.admitted.jobId, slotId: f.admitted.slotId,
    executionGrantId: f.admitted.grantId, issuerGrantId: f.issued.grantId, consumptionId: f.admitted.consumptionId,
    planRevisionId: f.initialSlot.plan_revision_id, targetId: f.initialSlot.target_id, preflightId: f.admitted.preflightId });
  assert.deepEqual(m.financialReceipt, { period: f.initialToken.period, tokenReservationId: f.initialToken.reservation_id,
    costReservationId: f.initialCost.reservation_id, usedTokens: 400, usedMicrousd: 4200 });
  const contents = await allRows(f, 'private_content');
  const output = contents.find(row => row.content_id === body.output_ref), prompt = contents.find(row => row.content_id === body.prompt_ref);
  assert.ok(output && prompt);
  assert.deepEqual(m.privateContents, [output, prompt].map(row => ({ contentId: row.content_id, kind: row.kind,
    contentDigest: digest(row.content), bytes: Buffer.byteLength(row.content), createdAt: row.created_at, expiresAt: row.expires_at })));
  const writes = await allRows(f, 'output_native_storage_writes'); assert.equal(writes.length, 1);
  assert.deepEqual(m.object, { storageKey: writes[0].storage_key, contentSha256: writes[0].content_sha256, mimeType: 'image/png',
    width: 1024, height: 1024, publicationEventId: event.eventId, recordedDescriptorOnly: true });
  assert.equal(m.object.contentSha256, sha(f.provider.imageBytes), 'recorded descriptor identifies the accepted fixture bytes');
  assert.equal(writes[0].write_acknowledged, 1); assert.equal(writes[0].status, 'written');
  assert.equal(m.expiresAt, [source.expires_at, output.expires_at, prompt.expires_at].sort()[0]);
  assert.equal(new Date(m.expiresAt).toISOString(), m.expiresAt); assert.ok(m.expiresAt > m.completedAt);
  assert.match(m.nativeSnapshotDigest, /^sha256:[a-f0-9]{64}$/u); assert.equal(data.manifestDigest, digest(m));
  assert.deepEqual(review, { version: 1, kind: 'guest-image-result-inventory', sessionId: m.sessionId,
    documentId: m.documentId, projectId: m.projectId, generationId: m.generationId, originalPayerUserId: payer,
    manifestDigest: data.manifestDigest, sourceHead: m.sourceHead, resultHead: m.resultHead, expiresAt: m.expiresAt,
    privateBodyCount: 2, recordedObjectCount: 1, custodyTransferred: false, publicReadAvailable: false, freshBytesVerified: false });
  for (const privateValue of [f.subject, f.session.sessionToken, f.session.claimToken, m.object.storageKey,
    output.content, prompt.content, 'SELECT', 'private_json'])
    assert.equal(JSON.stringify(review).includes(privateValue), false, 'review includes no source, body, object locator or secret');
  assert.deepEqual((await f.raw.prepare('PRAGMA foreign_key_check').all()).results, []);
}
async function inspect(f, req = request()) {
  const capability = await inspectGuestImageResultInventory(req, f.env, f.inventoryInput);
  assert.ok(Object.isFrozen(capability)); assert.deepEqual(Reflect.ownKeys(capability), []);
  const data = guestImageResultInventoryData(req, f.env, capability);
  await assertGuestImageResultInventoryCurrent(req, f.env, capability);
  return { request: req, capability, data };
}
function metrics(t, f, label) {
  t.diagnostic(JSON.stringify({ label, memory: f.memory, engine: 'Wrangler-pinned Miniflare/workerd D1', localOnly: true,
    sourceSetup: 'genuine native guest Run on SQLite with synthetic OpenAI wire/in-memory R2, exact schema/scalars/rowids transferred',
    applicationExecution: 'Node-hosted production inventory APIs against actual local D1; no inventory provider or media access',
    mediaEvidence: 'recorded native descriptors only; inventory does not re-read or rehash stored bytes',
    actualCompoundSelectLimit: 5, expressionDepthLimit: 100, ...queryLimits,
    strictlyQualifiedStatements: f.observed.records.length, uniqueSql: new Set(f.observed.records.map(row => row.sqlSha256)).size,
    offlineCacheSha256: offlineCompilations?.sha256 ?? null, offlineCacheHits: f.observed.offlineCacheHits,
    offlineCacheMisses: f.observed.offlineCacheMisses, freshCompilations: f.observed.freshCompilations, inMemoryCacheHits: f.observed.inMemoryCacheHits,
    maxBindings: Math.max(0, ...f.observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(0, ...f.observed.records.map(row => row.sqlBytes)),
    tamperedProofs: f.observed.tamperedProofs }));
}

test('actual local D1 inventories the genuine completed guest Image with stable historical manifest and no writes or media access', { timeout: 120000 }, async t => {
  const f = await fixture(t, false); let guard;
  try {
    const before = await databaseSnapshot(f);
    guard = guardInventory(f, t, { database: false, snapshotDatabase: false });
    const first = await inspect(f); await assertInventory(f, first.data);
    const replay = await inspect(f); await assertInventory(f, replay.data);
    assert.deepEqual(replay.data.manifest, first.data.manifest); assert.equal(replay.data.manifestDigest, first.data.manifestDigest);
    assert.deepEqual(replay.data.review, first.data.review);
    assert.deepEqual(await databaseSnapshot(f), before); guard.assertUntouched(); guard.close(); guard = null;

    // Fixture-only mutation changes live production authorization. A new full
    // historical custody proof must preserve the original immutable manifest.
    const approvals = await allRows(f, 'experience_sponsor_approvals'); assert.equal(approvals.length, 1);
    const mutation = await f.raw.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1 WHERE approval_id=?')
      .bind(approvals[0].approval_id).run(); assert.equal(mutation.meta.changes, 1);
    const revoked = await databaseSnapshot(f);
    guard = guardInventory(f, t, { database: false, snapshotDatabase: false });
    const retained = await inspect(f); await assertInventory(f, retained.data);
    assert.deepEqual(retained.data.manifest, first.data.manifest); assert.equal(retained.data.manifestDigest, first.data.manifestDigest);
    assert.deepEqual(retained.data.review, first.data.review);
    assert.deepEqual(await databaseSnapshot(f), revoked); guard.assertUntouched();
  } finally { try { guard?.close(); } finally { metrics(t, f, 'completed-historical-manifest-stable'); } }
});

test('actual local D1 completed inventory refuses changed private history and a NULL final proof without side effects', { timeout: 120000 }, async t => {
  const f = await fixture(t, true); let guard;
  try {
    const before = await databaseSnapshot(f);
    guard = guardInventory(f, t, { database: false, snapshotDatabase: false });
    const original = await inspect(f); await assertInventory(f, original.data);
    assert.deepEqual(await databaseSnapshot(f), before); guard.assertUntouched(); guard.close(); guard = null;
    const contents = await allRows(f, 'private_content'), output = contents.find(row => row.content_id === f.completed.body.output_ref);
    assert.ok(output); const changed = JSON.stringify({ ...JSON.parse(output.content), title: 'Corrupted retained original title' });
    assert.notEqual(changed, output.content);
    const mutation = await f.raw.prepare('UPDATE private_content SET content=? WHERE content_id=?').bind(changed, output.content_id).run();
    assert.equal(mutation.meta.changes, 1); const corrupted = await databaseSnapshot(f);
    guard = guardInventory(f, t, { database: false, snapshotDatabase: false });
    await assert.rejects(Promise.resolve().then(() => assertGuestImageResultInventoryCurrent(original.request, f.env, original.capability)),
      /guest_image_result_inventory_proof_unavailable/u);
    await assert.rejects(inspectGuestImageResultInventory(request(), f.env, f.inventoryInput),
      /guest_image_result_run_completion_title_changed/u);
    assert.deepEqual(await databaseSnapshot(f), corrupted); guard.assertUntouched(); guard.close(); guard = null;

    // Restore only the explicit disposable-fixture corruption, preserving exact
    // original bytes before the separate genuine-result ACK refusal check.
    const restored = await f.raw.prepare('UPDATE private_content SET content=? WHERE content_id=?').bind(output.content, output.content_id).run();
    assert.equal(restored.meta.changes, 1); assert.deepEqual(await databaseSnapshot(f), before);
    guard = guardInventory(f, t, { database: false, snapshotDatabase: false });
    const recovered = await inspect(f); await assertInventory(f, recovered.data);
    assert.deepEqual(recovered.data.manifest, original.data.manifest); assert.equal(recovered.data.manifestDigest, original.data.manifestDigest);
    // Execute every original proof statement against actual D1. Alter only one
    // genuine successful acknowledgement, after the whole real batch returns;
    // no SQL predicate, permission row or successful result is fabricated.
    const proofSql = recovered.data.proof.map(part => `SELECT CASE WHEN (${part.sql}) THEN 1 ELSE 0 END AS current`);
    assert.ok(proofSql.length > 0);
    f.observed.afterBatch = (statements, results) => {
      if (!statements.length || !statements.every(row => row.sql.startsWith('SELECT CASE WHEN (') &&
          row.sql.endsWith(') THEN 1 ELSE 0 END AS current'))) return results;
      assert.equal(f.observed.tamperedProofs.length, 0, 'the final proof is intercepted exactly once');
      assert.deepEqual(statements.map(row => row.sql), proofSql, 'intercept only the complete source-exact final proof');
      assert.equal(results.length, statements.length);
      for (const result of results) {
        assert.equal(result.success, true); assert.equal(result.error, undefined);
        assert.equal(result.results.length, 1); assert.equal(result.results[0].current, 1);
      }
      const index = results.length - 1, original = results[index];
      f.observed.tamperedProofs.push({ index, sqlSha256: sha(statements[index].sql), originalCurrent: 1, returnedCurrent: null });
      return results.map((result, at) => at === index ? { ...original,
        results: [{ ...original.results[0], current: null }] } : result);
    };
    try {
      await assert.rejects(inspectGuestImageResultInventory(request(), f.env, f.inventoryInput),
        /guest_image_result_inventory_proof_unavailable/u);
      assert.equal(f.observed.tamperedProofs.length, 1);
    } finally { f.observed.afterBatch = null; }
    await assertGuestImageResultInventoryCurrent(recovered.request, f.env, recovered.capability);
    assert.deepEqual(await databaseSnapshot(f), before); guard.assertUntouched();
  } finally { try { guard?.close(); } finally { metrics(t, f, 'private-history-and-final-proof-refusal'); } }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { admittedRunFixture, runGuestImage, readGuestImageRun, plannedDirection, request, payer } from './helpers/guest-image-run-fixture.mjs';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';
import { exportSynthetic, install, rowsSnapshot } from './helpers/model3d-workerd-snapshot.mjs';

const { ensureSchema, serializeEvent } = await import('../worker/runtime.ts');
const phase = (name, detail = {}) => process.stderr.write(`[guest-run-d1] ${JSON.stringify({ phase: name, pid: process.pid, ppid: process.ppid,
  runnerPgid: process.env.FORMA_TEST_PGID ?? null, ...detail })}\n`);
phase('loading-miniflare');
const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve('wrangler'))('miniflare');
phase('miniflare-loaded');
const queryLimits = { functionArguments: 32, parameters: 100, sqlBytes: 100000 };
const compiledSql = new Map();
const sourcePaths = ['worker/experience-guest-image-execution.ts', 'worker/experience-guest-image-driver.ts',
  'worker/experience-guest-image-admission-witness.ts', 'worker/document-jobs-api.ts', 'worker/output-execution-control.ts',
  'worker/output-requirements-ledger.ts', 'worker/events-api.ts', 'tests/experience-guest-image-execution.test.mjs',
  'tests/experience-guest-image-run.test.mjs', 'tests/experience-guest-image-run-d1.test.mjs', 'tests/helpers/guest-image-run-fixture.mjs',
  'tests/helpers/guest-image-admission-fixture.mjs', 'tests/helpers/guest-image-issuer-fixture.mjs',
  'tests/helpers/guest-image-stage-fixture.mjs', 'tests/helpers/d1-expression-depth.mjs', 'tests/helpers/model3d-workerd-snapshot.mjs'];
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
  const path = process.env.FORMA_RUN_D1_SQL_PRECHECK, expected = process.env.FORMA_RUN_D1_SQL_PRECHECK_SHA256;
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
// Optional exact successful compilation metadata saves original capability time.
// No permission, database result, provider response, or ACK is taken from it.
const offlineCompilations = await loadOfflineCompilations();
const sourcePins = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await readFile(new URL('../' + path, import.meta.url)))])));
const mutates = sql => /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu.test(sql);
const allRows = async (db, table) => (await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).results;
const financialTables = ['budget_reservations', 'cost_budget_reservations', 'budget_counters', 'cost_budget_counters', 'output_provider_calls'];
const actualFinancial = async f => Object.fromEntries(await Promise.all(financialTables.map(async table => [table, await allRows(f.raw, table)])));
const mediaSnapshot = f => [...f.storage.objects].map(([key, value]) => ({ key, bytes: value.bytes.toString('base64'),
  metadata: structuredClone(value.metadata), contentType: value.contentType }));

// Qualify each actual statement before D1 execution. Run legitimately performs
// individual lease/checkpoint updates, so only passive replay forbids mutation.
// All database values and acknowledgements come from the real local D1 handle.
function observedDatabase(raw, schema) {
  const handles = new WeakMap(), schemaSha256 = sha(JSON.stringify(schema));
  const observed = { measured: false, readOnly: false, records: [], batches: [], violations: [], beforeBatch: null,
    afterFailedBatch: null, injections: [], offlineCacheHits: 0, offlineCacheMisses: 0, freshCompilations: 0, inMemoryCacheHits: 0 };
  function qualify(row, inBatch = false) {
    if (!observed.measured) return;
    try {
      assert.ok(row.bindings.length <= queryLimits.parameters, 'actual bound-parameter ceiling');
      assert.ok(Buffer.byteLength(row.sql) <= queryLimits.sqlBytes, 'actual SQL-byte ceiling');
      assert.doesNotMatch(row.sql, /^\s*(?:CREATE|DROP|ALTER|PRAGMA)\b/iu, 'Run never installs schema');
      if (observed.readOnly) {
        assert.match(row.sql, /^\s*(?:SELECT|WITH)\b/iu, 'terminal replay is read-only');
        assert.equal(mutates(row.sql), false, 'terminal replay cannot mutate');
      }
      const key = sha(JSON.stringify([schema, queryLimits, row.sql]));
      const offline = offlineCompilations?.entries.get(key);
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
        compiled = compileSqliteExpressionDepth(null, row.sql, { schema, functions: [], limit: 100, queryLimits });
        assert.equal(compiled.ok, true, `strict deployment SQL qualification: ${compiled.error ?? ''}\n${row.sql.slice(0, 220)}`);
        compiled = verifiedCompilation(compiled); compiledSql.set(key, compiled);
        compilationSource = 'fresh'; observed.freshCompilations++;
      }
      assert.equal(compiled.limit, 100); assert.deepEqual(compiled.queryLimits, queryLimits);
      assert.equal(compiled.statementBytes, Buffer.byteLength(row.sql));
      assert.equal(compiled.parameterCount, row.bindings.length, 'compiled parameters equal actual bindings');
      observed.records.push({ sql: row.sql, sqlSha256: sha(row.sql), parameters: row.bindings.length,
        sqlBytes: Buffer.byteLength(row.sql), strictCompilationKey: key, compilationSource, inBatch });
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
      const submitted = observed.measured && observed.beforeBatch ? await observed.beforeBatch(rows) ?? rows : rows;
      submitted.forEach(row => qualify(row, true));
      const batch = { sql: submitted.map(row => row.sql), originalSql: rows.map(row => row.sql), failed: false };
      if (observed.measured) observed.batches.push(batch);
      try { return await raw.batch(submitted.map(row => row.statement)); }
      catch (error) {
        batch.failed = true; batch.error = String(error);
        if (observed.measured) await observed.afterFailedBatch?.(batch);
        throw error;
      }
    },
  };
  return observed;
}

async function fixture(t) {
  const beforePins = await sourcePins(); phase('source-bookend-before', { sourcePins: beforePins });
  t.after(async () => { const afterPins = await sourcePins(); phase('source-bookend-after', { sourcePins: afterPins });
    assert.deepEqual(afterPins, beforePins, 'reviewed source and test bytes stay fixed during the actual D1 case'); });
  let externalCalls = 0;
  const mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-15', host: '127.0.0.1', port: 0,
    log: new Log(LogLevel.NONE), d1Databases: ['GuestRun'],
    script: "export default {fetch(){return new Response('Local guest Run D1 fixture only.',{status:404});}};",
    outboundService() { externalCalls++; throw Error('External workerd fetch forbidden.'); },
  });
  phase('miniflare-constructed');
  t.after(async () => { phase('miniflare-dispose-start'); await mf.dispose(); phase('miniflare-dispose-complete'); assert.equal(externalCalls, 0); });
  const raw = await mf.getD1Database('GuestRun'); phase('d1-binding-ready');
  // Initialize the local bridge before the unchanged A source fixture installs
  // its fetch tripwire. Only the new fixture's exact fake OpenAI wire is allowed.
  const f = await admittedRunFixture(t), exported = exportSynthetic(f.sqlite);
  phase('genuine-admitted-setup-complete');
  const compound = count => Array.from({ length: count }, () => 'SELECT 1').join(' UNION ALL ');
  assert.equal((await raw.prepare(compound(5)).all()).results.length, 5);
  await assert.rejects(raw.prepare(compound(6)).all(), /too many terms in compound SELECT/iu);
  await install(raw, exported); phase('exact-snapshot-installed');
  const schema = exported.schema.filter(row => row.sql).sort((left, right) => {
    const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    return rank[left.type] - rank[right.type] || left.name.localeCompare(right.name);
  }).map(row => row.sql);
  const observed = observedDatabase(raw, schema);
  f.env.DB = observed.DB; f.DB = observed.DB;
  const beforeBootstrapSchema = (await raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results;
  await ensureSchema(f.env);
  assert.deepEqual(await rowsSnapshot(raw, exported.tables), exported.rows, 'genuine bootstrap preserves every copied value and rowid');
  assert.deepEqual((await raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results,
    beforeBootstrapSchema, 'genuine bootstrap preserves exact installed schema');
  observed.measured = true;
  t.after(() => assert.deepEqual(observed.violations, [], 'native catches cannot hide strict SQL or replay-write violations'));
  phase('measured-run-ready');
  return { ...f, raw, observed, exported };
}

async function originalIdentities(f) {
  for (const [table, key, value] of [['document_jobs', 'job_id', f.admitted.jobId], ['output_operation_slots', 'slot_id', f.admitted.slotId],
    ['output_execution_grants', 'grant_id', f.admitted.grantId], ['budget_reservations', 'reservation_id', f.initialToken.reservation_id],
    ['cost_budget_reservations', 'reservation_id', f.initialCost.reservation_id], ['experience_sponsor_consumptions', 'consumption_id', f.admitted.consumptionId]]) {
    const rows = await allRows(f.raw, table); assert.equal(rows.length, 1, `${table}: one original graph`); assert.equal(rows[0][key], value);
  }
  assert.deepEqual((await allRows(f.raw, 'users')).map(row => row.user_id), [payer], 'no fabricated canonical guest');
  for (const table of ['events', 'event_private_payloads', 'output_commands', 'private_content']) {
    const original = structuredClone(f.admittedSnapshot.contents[table]);
    assert.deepEqual((await allRows(f.raw, table)).slice(0, original.length), original, `Run preserves all original ${table} values`);
  }
  for (const table of ['experience_sponsor_grants', 'experience_sponsor_issuances', 'experience_sponsor_resource_receipts',
    'experience_sponsor_driver_intents', 'experience_sponsor_driver_stages', 'output_plan_revisions', 'output_plan_targets',
    'output_preflights', 'output_operation_routes', 'experience_sponsor_consumptions'])
    assert.deepEqual(await allRows(f.raw, table), structuredClone(f.admittedSnapshot.contents[table]), `original ${table} keeps every scalar value`);
  for (const table of f.exported.tables.filter(name => name.startsWith('experience_guest_')))
    assert.deepEqual(await allRows(f.raw, table), structuredClone(f.admittedSnapshot.contents[table]), `Run leaves guest custody and source table ${table} unchanged`);
  assert.deepEqual(await allRows(f.raw, 'output_results'), [], 'native Image retains its own GenerationCompleted graph');
  assert.deepEqual((await f.raw.prepare('PRAGMA foreign_key_check').all()).results, []);
}
async function settledPair(f) {
  const financial = await actualFinancial(f), [token] = financial.budget_reservations, [cost] = financial.cost_budget_reservations;
  assert.equal(financial.budget_reservations.length, 1); assert.equal(financial.cost_budget_reservations.length, 1);
  assert.equal(token.reservation_id, f.initialToken.reservation_id); assert.equal(cost.reservation_id, f.initialCost.reservation_id);
  const calls = financial.output_provider_calls;
  assert.equal(calls.length, 2); assert.deepEqual(calls.map(row => row.stage_key).sort(), ['image:initial', 'planning:initial']);
  // Independent literal fixture oracle: planner 120*2 + 80*12 = 1200;
  // Image 120 text*5 + 0 image*8 + 80 output*30 = 3000 microusd.
  for (const [stage, wireStage, model, responseId, microusd, url] of [
    ['planning:initial', 'planner', 'gpt-5.6-terra', 'guest-local-planner', 1200, 'https://api.openai.com/v1/responses'],
    ['image:initial', 'image', 'gpt-image-2', 'guest-local-image-request', 3000, 'https://api.openai.com/v1/images/generations'],
  ]) {
    const row = calls.find(call => call.stage_key === stage), wires = f.provider.calls.filter(call => call.stage === wireStage);
    assert.ok(row); assert.equal(wires.length, 1);
    const wire = wires[0]; assert.equal(wire.url, url); assert.equal(typeof wire.rawBody, 'string');
    const body = JSON.parse(wire.rawBody); assert.deepEqual(body, wire.body); assert.equal(body.model, model);
    const clientRequestId = wire.headers.get('x-client-request-id'); assert.ok(clientRequestId);
    assert.equal(row.scope_key, f.initialSlot.scope_key); assert.equal(row.slot_id, f.admitted.slotId);
    assert.equal(row.call_key, stage); assert.equal(row.provider, 'openai'); assert.equal(row.model, model);
    assert.equal(row.status, 'settled'); assert.equal(row.used_microusd, microusd);
    assert.equal(row.provider_response_id, responseId); assert.equal(row.client_request_id, clientRequestId);
    // The existing Image adapter hashes its normalized request contract rather
    // than the full wire body. Reconstruct it only from the captured actual wire;
    // planner hashes the exact raw body, including its original serialization.
    const expectedDigest = wireStage === 'planner' ? sha(wire.rawBody) : sha(JSON.stringify({ model: body.model, prompt: body.prompt,
      size: body.size, quality: body.quality, outputFormat: body.output_format, references: [] }));
    if (wireStage === 'image') {
      assert.equal(body.n, 1); assert.equal(body.size, '1024x1024'); assert.equal(body.quality, 'high'); assert.equal(body.output_format, 'png');
      assert.equal(typeof body.prompt, 'string'); assert.ok(body.prompt.includes(f.subject));
    }
    assert.equal(row.request_digest, expectedDigest, `${stage} binds the original recorded provider request`);
  }
  assert.equal(token.status, 'settled'); assert.equal(token.used_tokens, 400); assert.equal(cost.status, 'settled');
  assert.equal(cost.used_microusd, 4200); assert.equal(calls.reduce((sum, row) => sum + row.used_microusd, 0), 4200);
  assert.equal(token.owner_id, payer); assert.equal(cost.owner_id, payer);
  for (const [table, unit, used] of [['budget_counters', 'tokens', 400], ['cost_budget_counters', 'microusd', 4200]]) {
    const counters = financial[table]; assert.equal(counters.length, 2);
    assert.deepEqual(new Set(counters.map(row => `${row.scope}:${row.scope_id}`)), new Set([`user:${payer}`, 'workspace:forma']));
    assert.ok(counters.every(row => row[`reserved_${unit}`] === 0 && row[`used_${unit}`] === used));
  }
  return financial;
}
async function nativeCompletion(f) {
  await originalIdentities(f); await settledPair(f);
  const [job] = await allRows(f.raw, 'document_jobs'), [slot] = await allRows(f.raw, 'output_operation_slots');
  assert.equal(job.status, 'completed'); assert.equal(job.attempt_count, 1); assert.equal(slot.status, 'succeeded');
  assert.equal(job.owner_id, f.session.guestSubject); assert.equal(job.stream_id, `creative:${f.session.guestSubject}`);
  assert.equal(job.lease_expires_at, null); assert.equal(job.request_json, f.initialJob.request_json);
  assert.equal((await allRows(f.raw, 'output_execution_grants'))[0].status, 'completed');
  const events = (await f.raw.prepare('SELECT event.*,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE stream_id=? ORDER BY sequence')
    .bind(job.stream_id).all()).results.map(serializeEvent);
  const completed = events.filter(event => event.type === 'GenerationCompleted'); assert.equal(completed.length, 1);
  const usages = events.filter(event => event.type === 'GenerationUsageRecorded'); assert.equal(usages.length, 1);
  assert.equal(usages[0].payload.cost_microusd, 4200); assert.equal(usages[0].payload.total_tokens, 400);
  assert.equal(usages[0].payload.planner_tokens, 200); assert.equal(usages[0].payload.image_tokens, 200);
  const event = completed[0], body = event.payload;
  assert.equal(event.eventId, slot.outcome_event_id); assert.equal(event.correlationId, job.correlation_id);
  assert.equal(body.document_id, f.session.documentId); assert.equal(body.model_id, 'gpt-image-2'); assert.equal(body.planner_model_id, 'gpt-5.6-terra');
  assert.equal(body.simulation, false); assert.equal(body.media_type, 'image/png'); assert.equal(body.image_width, 1024); assert.equal(body.image_height, 1024);
  assert.equal(body.source_surface, 'outputs'); assert.deepEqual(body.object_ids, [body.object_id]);
  const contents = await allRows(f.raw, 'private_content');
  const content = id => { const row = contents.find(row => row.content_id === id); assert.ok(row); assert.equal(row.owner_id, f.session.guestSubject);
    assert.equal(row.redacted_at, null); return row.content; };
  assert.deepEqual(JSON.parse(content(body.output_ref)), plannedDirection);
  assert.equal(content(body.prompt_ref), f.provider.calls.find(call => call.stage === 'image').body.prompt);
  assert.ok(body.media_url.startsWith('/api/media/'));
  const key = decodeURIComponent(body.media_url.slice('/api/media/'.length)), image = f.storage.objects.get(key); assert.ok(image);
  assert.deepEqual(image.bytes, f.provider.imageBytes); assert.equal(body.source_content_hash, sha(image.bytes));
  const writes = await allRows(f.raw, 'output_native_storage_writes'); assert.equal(writes.length, 1);
  assert.equal(writes[0].write_acknowledged, 1); assert.equal(writes[0].status, 'written');
  assert.equal(writes[0].storage_key, key); assert.equal(writes[0].publication_event_id, event.eventId);
  assert.deepEqual(f.provider.calls.map(call => call.stage), ['planner', 'safety', 'image']);
  assert.equal(f.storage.calls.filter(call => call.method === 'put').length, 1);
  assert.deepEqual(await allRows(f.raw, 'experience_sponsor_active_jobs'), []);
  return { job, slot, event, body };
}
function sourceFreeReceipt(f, value, status, replayed, generationCompleted = status === 'completed') {
  exactKeys(value, ['version', 'status', 'documentId', 'jobId', 'slotId', 'grantId', 'commandKey', 'runEventId', 'expiresAt',
    'replayed', 'admissionCommitted', 'runRequested', 'generationCompleted', 'publicReadAvailable', 'custodyTransferred'], 'Run receipt');
  assert.ok(value && typeof value === 'object'); assert.ok(Object.isFrozen(value));
  assert.equal(value.version, 1); assert.equal(value.admissionCommitted, true); assert.equal(value.runRequested, true);
  assert.equal(value.generationCompleted, generationCompleted); assert.equal(value.publicReadAvailable, false);
  assert.equal(value.status, status); assert.equal(value.replayed, replayed); assert.equal(value.custodyTransferred, false);
  assert.equal(value.documentId, f.session.documentId); assert.equal(value.jobId, f.admitted.jobId);
  assert.equal(value.slotId, f.admitted.slotId); assert.equal(value.grantId, f.admitted.grantId);
  assert.equal(value.commandKey, f.driver.stageKeys.run); assert.equal(typeof value.runEventId, 'string'); assert.ok(value.runEventId);
  assert.equal(value.expiresAt, f.admitted.expiresAt, 'Run retains the original admission expiry');
  const serialized = JSON.stringify(value);
  for (const secret of [f.subject, f.session.sessionToken, f.session.claimToken, payer, 'SELECT', 'private_json', 'Bearer', 'prompt_ref', 'reserved_microusd'])
    assert.equal(serialized.includes(secret), false, 'terminal receipt excludes source, secret and financial data');
}
function metrics(t, f, label) {
  t.diagnostic(JSON.stringify({ label, engine: 'Wrangler-pinned Miniflare/workerd D1', localOnly: true,
    sourceSetup: 'genuine guest issuer/admission APIs on SQLite, exact synthetic transfer, genuine D1 schema bootstrap',
    applicationExecution: 'Node-hosted native guest Run APIs against actual local D1 with synthetic OpenAI wire and in-memory R2',
    actualCompoundSelectLimit: 5, expressionDepthLimit: 100, ...queryLimits,
    strictlyQualifiedStatements: f.observed.records.length, uniqueSql: new Set(f.observed.records.map(row => row.sqlSha256)).size,
    offlineCacheSha256: offlineCompilations?.sha256 ?? null, offlineCacheHits: f.observed.offlineCacheHits,
    offlineCacheMisses: f.observed.offlineCacheMisses, freshCompilations: f.observed.freshCompilations, inMemoryCacheHits: f.observed.inMemoryCacheHits,
    maxBindings: Math.max(0, ...f.observed.records.map(row => row.parameters)), maxSqlBytes: Math.max(0, ...f.observed.records.map(row => row.sqlBytes)),
    failedBatches: f.observed.batches.filter(batch => batch.failed).length, injectedStatements: f.observed.injections,
    syntheticProviderStages: f.provider.calls.map(call => call.stage), mediaCalls: f.storage.calls.map(call => call.method),
    financialEvidence: 'synthetic app-recorded known costs; no provider invoice or live charge' }));
}

test('actual local workerd D1 completes the original guest Image job and retains read-only terminal replay', { timeout: 120000 }, async t => {
  const f = await fixture(t);
  try {
    phase('run-start');
    const result = await runGuestImage(request(), f.env, f.runInput);
    phase('run-complete');
    await nativeCompletion(f);
    sourceFreeReceipt(f, result, 'completed', false);
    const commands = (await allRows(f.raw, 'output_commands')).filter(row => row.action === 'run');
    assert.equal(commands.length, 1); assert.equal(commands[0].command_key, f.driver.stageKeys.run);
    assert.equal(commands[0].event_id, result.runEventId);
    const after = await rowsSnapshot(f.raw, f.exported.tables), media = mediaSnapshot(f), io = structuredClone(f.storage.calls);
    const providerStages = f.provider.calls.map(call => call.stage);
    f.observed.readOnly = true; f.provider.blocked = true;
    assert.deepEqual(await readGuestImageRun(request(), f.env, f.input), { ...result, replayed: true });
    assert.deepEqual(await runGuestImage(request(), f.env, f.runInput), { ...result, replayed: true });
    assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), after, 'read and repeated Run leave all original rows and timestamps unchanged');
    assert.deepEqual(mediaSnapshot(f), media); assert.deepEqual(f.storage.calls, io);
    assert.deepEqual(f.provider.calls.map(call => call.stage), providerStages);
  } finally { metrics(t, f, 'native-run-completion-original-replay'); }
});

// The second case injects a terminal-transaction failure, not a substituted
// authorization predicate. Every original SQL statement and binding is retained.
test('actual local workerd D1 terminal CHECK rollback preserves the original known paid calls and paired settlement', { timeout: 120000 }, async t => {
  const f = await fixture(t);
  try {
    let beforeFailure, paidBeforeFailure, rejectedBatch, injectionCount = 0, rollbackVerified = false;
    f.observed.beforeBatch = async rows => {
      const terminal = rows.find(row => /^\s*UPDATE\s+document_jobs\s+SET\s+status=\?/iu.test(row.sql)
        && row.bindings[0] === 'completed' && row.bindings.includes(f.admitted.jobId));
      if (!terminal) return rows;
      assert.equal(injectionCount++, 0, 'native completion is never retried');
      assert.ok(rows.some(row => /UPDATE\s+output_operation_slots\s+SET\s+status=CASE/iu.test(row.sql)));
      assert.ok(rows.some(row => /UPDATE\s+output_execution_grants\s+SET\s+status='completed'/iu.test(row.sql)));
      assert.ok(rows.some(row => /DELETE\s+FROM\s+experience_sponsor_active_jobs\b/iu.test(row.sql)));
      paidBeforeFailure = await settledPair(f);
      beforeFailure = await rowsSnapshot(f.raw, f.exported.tables);
      const sql = 'INSERT INTO output_atomic_assertions(token,passed) VALUES(?,0)', bindings = ['synthetic-guest-run-terminal-failure'];
      const injection = { sql, bindings, statement: f.raw.prepare(sql).bind(...bindings) };
      f.observed.injections.push({ sql, originalStatements: rows.length, position: 'after-all-original-statements' });
      return [...rows, injection];
    };
    f.observed.afterFailedBatch = async batch => {
      if (!batch.sql.includes('INSERT INTO output_atomic_assertions(token,passed) VALUES(?,0)')) return;
      rejectedBatch = batch;
      assert.match(batch.error, /CHECK constraint failed/iu);
      assert.deepEqual(batch.sql.slice(0, -1), batch.originalSql, 'all native terminal SQL is preserved in original order');
      assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), beforeFailure, 'actual D1 rolls back every write in the native terminal batch');
      rollbackVerified = true;
    };
    await assert.rejects(runGuestImage(request(), f.env, f.runInput));
    assert.equal(injectionCount, 1); assert.ok(rejectedBatch); assert.equal(rollbackVerified, true);
    await originalIdentities(f);
    assert.deepEqual(await settledPair(f), paidBeforeFailure, 'failure cleanup does not erase, zero, release or duplicate incurred cost');
    const [job] = await allRows(f.raw, 'document_jobs'), [slot] = await allRows(f.raw, 'output_operation_slots');
    assert.equal(job.status, 'failed'); assert.equal(job.attempt_count, 1); assert.equal(slot.status, 'failed');
    assert.equal(job.lease_expires_at, null); assert.equal((await allRows(f.raw, 'output_execution_grants'))[0].status, 'completed');
    assert.deepEqual(await allRows(f.raw, 'experience_sponsor_active_jobs'), []);
    assert.deepEqual(f.provider.calls.map(call => call.stage), ['planner', 'safety', 'image']);
    const after = await rowsSnapshot(f.raw, f.exported.tables), media = mediaSnapshot(f), io = structuredClone(f.storage.calls);
    f.observed.beforeBatch = null; f.observed.afterFailedBatch = null; f.observed.readOnly = true; f.provider.blocked = true;
    // The exact GenerationCompleted/Usage graph and known settlement preceded
    // the failed terminal batch. A complete witness reports interrupted metadata
    // with generationCompleted=true while retaining the raw failed job and slot.
    // This does not expose private bodies or authorize another provider purchase.
    const read = await readGuestImageRun(request(), f.env, f.input);
    sourceFreeReceipt(f, read, 'interrupted', true, true);
    const commands = (await allRows(f.raw, 'output_commands')).filter(row => row.action === 'run');
    assert.equal(commands.length, 1); assert.equal(commands[0].command_key, f.driver.stageKeys.run);
    assert.equal(commands[0].event_id, read.runEventId);
    assert.deepEqual(await runGuestImage(request(), f.env, f.runInput), read);
    assert.deepEqual(await rowsSnapshot(f.raw, f.exported.tables), after);
    assert.deepEqual(mediaSnapshot(f), media); assert.deepEqual(f.storage.calls, io);
    assert.deepEqual(f.provider.calls.map(call => call.stage), ['planner', 'safety', 'image']);
  } finally { metrics(t, f, 'terminal-rollback-known-accounting-preserved'); }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = await realpath(process.env.FORMA_SOURCE_ROOT ?? fileURLToPath(new URL('..', import.meta.url)));
assert(!root.split('/').includes('test-results'));
const requireRoot = createRequire(join(root, 'package.json'));
const requireWrangler = createRequire(requireRoot.resolve('wrangler'));
const { Miniflare, Log, LogLevel } = requireWrangler('miniflare');
const { build } = requireWrangler('esbuild');
const here = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const labels = ['Complete', 'Source', 'Race', 'Lease'];
const financial = ['budget_counters', 'budget_reservations', 'cost_budget_counters', 'cost_budget_reservations', 'output_provider_calls'];

// Scalar SQL encodings preserve SQLite types and rowids during synthetic
// export. No live database, application content, migration repair or dump path.
function exportSynthetic(sqlite) {
  const schema = sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  assert(schema.length <= 512);
  assert(schema.every(row => !row.name.startsWith('sqlite_') || row.sql === null), 'Unexpected SQLite system table needs explicit handling');
  const tables = schema.filter(row => row.type === 'table');
  const inserts = [], rows = {};
  for (const { name } of tables) {
    const columns = sqlite.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
    const expressions = ['CAST(rowid AS TEXT) AS original_rowid', ...columns.map((column, i) => `quote(${quote(column)}) AS c${i}`)];
    rows[name] = structuredClone(sqlite.prepare(`SELECT ${expressions.join(',')} FROM ${quote(name)} ORDER BY rowid`).all());
    for (const row of rows[name]) {
      assert(/^[0-9]+$/.test(row.original_rowid));
      const sql = `INSERT INTO ${quote(name)}(rowid,${columns.map(quote).join(',')}) VALUES(${row.original_rowid},${columns.map((_, i) => row['c' + i]).join(',')})`;
      assert(Buffer.byteLength(sql) < 90000, 'Synthetic fixture row unexpectedly exceeds bounded seed statement');
      inserts.push(sql);
    }
  }
  assert(inserts.length <= 2048);
  return { schema: structuredClone(schema), tables: tables.map(row => row.name), rows, inserts };
}
async function install(db, exported) {
  // Preserve every table/index/trigger and every field. Seed before triggers so
  // the already-recorded event sidecars are not generated a second time.
  await db.batch(exported.schema.filter(row => row.type === 'table').map(row => db.prepare(row.sql)));
  await db.batch([db.prepare('PRAGMA defer_foreign_keys=ON'), ...exported.inserts.map(sql => db.prepare(sql))]);
  const rest = exported.schema.filter(row => row.sql && row.type !== 'table');
  await db.batch(rest.map(row => db.prepare(row.sql)));
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.deepEqual(await rowsSnapshot(db, exported.tables), exported.rows, 'Exact synthetic row/rowid parity, not a substitute schema');
  const names = new Set(exported.schema.map(row => row.name));
  const actualSchema = (await db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results.filter(row => names.has(row.name));
  assert.deepEqual(actualSchema, exported.schema, 'Every original synthetic schema entry preserved');
}
async function rowsSnapshot(db, tables) {
  const result = {};
  for (const name of tables) {
    const columns = (await db.prepare(`PRAGMA table_info(${quote(name)})`).all()).results.map(row => row.name);
    const expressions = ['CAST(rowid AS TEXT) AS original_rowid', ...columns.map((column, i) => `quote(${quote(column)}) AS c${i}`)];
    result[name] = (await db.prepare(`SELECT ${expressions.join(',')} FROM ${quote(name)} ORDER BY rowid`).all()).results;
  }
  return result;
}
async function finite(work, ms, name) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('local_timeout:' + name)), ms); })]); }
  finally { clearTimeout(timer); }
}

test('actual local workerd + D1 + R2 recovery, lease/cleanup and conditional-create refusal', { timeout: 180000 }, async t => {
  const { model3dRecoveryFixture } = await import(pathToFileURL(join(root, 'tests/helpers/output-model3d-recovery-fixture.mjs')).href);
  const { glb } = await import(pathToFileURL(join(root, 'tests/helpers/model3d-native-execution-fixture.mjs')).href);
  const f = await model3dRecoveryFixture();
  let mf, directory, closed = false, passed = false;
  const requests = [], unexpected = [], reports = [];
  const originalFetch = globalThis.fetch;
  // The service runs in workerd, whose outboundService below is the only
  // accepted synthetic network port. Node fixture must never use fetch.
  globalThis.fetch = () => { throw Error('node_fixture_network_forbidden'); };
  try {
    const exported = exportSynthetic(f.sqlite), bytes = glb();
    const tuple = { scope: f.scope, slot: f.slot, user: f.user, assertions: f.assertions, current: f.current,
      jobId: f.job.job_id, draftId: f.original.preview.draftId };
    assert.equal(f.provider.providerRequestId, 'provider-test-original');
    const base = 'https://queue.fal.run/fal-ai/hyper3d/requests/' + f.provider.providerRequestId;
    const asset = 'https://v3.fal.media/files/test/original.glb';
    const entry = await readFile(join(here, 'helpers/model3d-recovery-workerd-entry.ts'), 'utf8');
    const built = await build({ stdin: { resolveDir: root, contents: entry, loader: 'ts' }, absWorkingDir: root,
      bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*'],
      plugins: [{ name: 'deny-protected-input', setup(build) { build.onResolve({ filter: /test-results/ }, () => { throw Error('protected input forbidden'); }); } }] });
    const inputPins = [];
    for (const name of Object.keys(built.metafile.inputs).filter(name => name !== '<stdin>')) {
      const path = resolve(root, name); assert(!path.split('/').includes('test-results'));
      inputPins.push({ path, sha256: hash(await readFile(path)) });
    }
    for (const relative of ['tests/helpers/output-model3d-recovery-fixture.mjs', 'tests/helpers/model3d-native-execution-fixture.mjs', 'tests/output-execution-test-helpers.mjs']) {
      const path = join(root, relative); inputPins.push({ path, sha256: hash(await readFile(path)) });
    }
    directory = await mkdtemp(join(tmpdir(), 'forma-model3d-recovery-workerd-'));
    mf = new Miniflare({ modules: true, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'],
      host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE), script: built.outputFiles[0].text,
      d1Databases: labels, d1Persist: join(directory, 'd1'), r2Buckets: labels.map(label => label + 'Media'), r2Persist: join(directory, 'r2'),
      bindings: { FIXTURE: JSON.stringify(tuple) },
      outboundService(request) {
        const record = { url: request.url, method: request.method }; requests.push(record);
        if (request.method !== 'GET' || ![base + '/status', base, asset].includes(request.url)) {
          unexpected.push(record); throw Error('unexpected_external_request');
        }
        if (request.url === asset) {
          assert.equal(request.headers.get('authorization'), null, 'No queue credential on media GET');
          return new Response(bytes, { headers: { 'content-type': 'model/gltf-binary', 'content-length': String(bytes.length) } });
        }
        assert.equal(request.headers.get('authorization'), 'Key synthetic-unit-test-key-not-a-credential');
        return request.url.endsWith('/status')
          ? Response.json({ request_id: f.provider.providerRequestId, status: 'COMPLETED' })
          : Response.json({ request_id: f.provider.providerRequestId, seed: 1, model_mesh: {
            url: asset, content_type: 'model/gltf-binary', file_name: 'original.glb', file_size: bytes.length }, textures: [] });
      },
    });
    const databases = {}, buckets = {};
    const invoke = async (action, label) => {
      const response = await finite(mf.dispatchFetch('https://qualification.invalid/' + action + '/' + label), 35000, action + '/' + label);
      const result = await finite(response.json(), 3000, 'response_json');
      reports.push({ action, label, httpStatus: response.status, ...result }); return result;
    };
    for (const label of labels) {
      databases[label] = await mf.getD1Database(label); buckets[label] = await mf.getR2Bucket(label + 'Media');
      await install(databases[label], exported);
      const warm = await invoke('warm', label); assert.equal(warm.ok, true, JSON.stringify(warm));
    }
    const complete = databases.Complete;
    const beforeAdvisory = await rowsSnapshot(complete, exported.tables), advisoryRequests = requests.length;
    const advisory = await invoke('available', 'Complete');
    assert.equal(advisory.ok, true, JSON.stringify(advisory));
    assert.equal(advisory.value, true, 'Actual D1 advisory must expose this retained accepted original: ' + JSON.stringify(advisory));
    assert.deepEqual(advisory.counters.queryFailures, []);
    assert.equal(advisory.counters.queries, 2); assert.equal(advisory.counters.batches, 0);
    assert.equal(advisory.counters.puts, 0); assert.equal(advisory.counters.deletes, 0);
    assert.equal(requests.length, advisoryRequests);
    assert.deepEqual(await rowsSnapshot(complete, exported.tables), beforeAdvisory, 'Advisory cannot claim, settle, acknowledge or publish');
    // Do not require the advisory to reject the later synthetic source veto;
    // only the independently guarded recovery service is authority for effects.
    const done = await invoke('recover', 'Complete'); assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(done.value.status, 'completed'); assert.equal(done.counters.puts, 1); assert.equal(done.counters.conditionalPuts, 1);
    assert(done.counters.queries <= 1000, 'Actual dispatched D1 statements exceed paid invocation ceiling');
    assert.deepEqual(requests.map(row => row.url), [base + '/status', base, asset]);
    const job = await complete.prepare('SELECT * FROM document_jobs WHERE job_id=?').bind(tuple.jobId).first();
    assert.equal(job.status, 'completed'); assert.equal(job.attempt_count, 1); assert.equal(job.error_message, null);
    assert.equal(job.request_json, f.job.request_json); assert.equal(job.notified_at, null);
    const result = JSON.parse(job.result_json), eventId = result.outputModel3dRecovery.completionEventId;
    assert(result.appendedEventIds.includes(eventId));
    for (const table of ['document_jobs', 'output_operation_slots', 'output_execution_grants', 'output_provider_calls', 'budget_reservations', 'cost_budget_reservations'])
      assert.equal((await complete.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 1, table);
    const slot = await complete.prepare('SELECT * FROM output_operation_slots').first();
    assert.equal(slot.status, 'succeeded'); assert.equal(slot.outcome_event_id, eventId);
    assert.equal((await complete.prepare('SELECT status FROM output_execution_grants').first()).status, 'completed');
    const call = await complete.prepare('SELECT * FROM output_provider_calls').first();
    assert.equal(call.status, 'settled'); assert.equal(call.used_microusd, 400000); assert.equal(call.provider_response_id, f.provider.providerRequestId);
    assert.equal((await complete.prepare('SELECT status FROM budget_reservations').first()).status, 'released');
    assert.equal((await complete.prepare('SELECT used_microusd FROM cost_budget_reservations').first()).used_microusd, 400000);
    for (const type of ['DocumentRenderCompleted', 'GenerationUsageRecorded'])
      assert.equal((await complete.prepare('SELECT COUNT(*) AS n FROM events WHERE correlation_id=? AND type=?').bind(f.job.correlation_id, type).first()).n, 1);
    const body = JSON.parse((await complete.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').bind(eventId).first()).private_json);
    assert.deepEqual(body.settings.output_model3d.execution, JSON.parse(job.request_json).outputExecution);
    assert.deepEqual(body.settings.output_model3d.contract, JSON.parse(job.request_json).outputModel3d);
    const stored = (await complete.prepare('SELECT * FROM output_native_storage_writes').all()).results;
    assert.equal(stored.length, 1); assert.equal(stored[0].write_acknowledged, 1); assert.equal(stored[0].publication_event_id, eventId);
    const media = await buckets.Complete.get(stored[0].storage_key); assert(media);
    assert.equal(hash(new Uint8Array(await media.arrayBuffer())), hash(bytes)); assert.equal(stored[0].content_sha256, hash(bytes));
    const beforeReplay = await rowsSnapshot(complete, exported.tables), requestCount = requests.length;
    const replay = await invoke('recover', 'Complete'); assert.equal(replay.ok, true, JSON.stringify(replay)); assert.equal(replay.value.replayed, true);
    assert.equal(requests.length, requestCount); assert.equal(replay.counters.puts, 0); assert.equal(replay.counters.deletes, 0);
    assert.deepEqual(await rowsSnapshot(complete, exported.tables), beforeReplay, 'No new events/receipts/financial writes on strict completed replay');
    await complete.prepare("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'").run();
    const beforeCleanup = await rowsSnapshot(complete, exported.tables), cleaned = await invoke('cleanup', 'Complete');
    assert.equal(cleaned.ok, true, JSON.stringify(cleaned)); assert.deepEqual(cleaned.value, { reconciled: 0, pending: 0 });
    assert.deepEqual(await rowsSnapshot(complete, exported.tables), beforeCleanup);
    assert(await buckets.Complete.head(stored[0].storage_key), 'Completed exact publication survives old grant expiry');

    await databases.Source.prepare('UPDATE recovery_test_source SET current=0').run();
    const sourceBefore = await rowsSnapshot(databases.Source, exported.tables), sourceRequests = requests.length;
    const refused = await invoke('recover', 'Source'); assert.equal(refused.ok, false, 'False source assertion must abort actual D1 claim');
    assert.equal(requests.length, sourceRequests); assert.equal(refused.counters.puts, 0);
    assert.deepEqual(await rowsSnapshot(databases.Source, exported.tables), sourceBefore, 'Failed source proof causes no claim or financial write');

    const race = await invoke('recover', 'Race'); assert.equal(race.ok, false, 'Existing R2 object cannot be overwritten');
    assert.equal(race.counters.puts, 1); assert.equal(race.counters.conditionalPuts, 1); assert.equal(race.counters.deletes, 0);
    assert(race.counters.collisionKey);
    const foreign = await buckets.Race.get(race.counters.collisionKey); assert(foreign);
    assert.deepEqual([...new Uint8Array(await foreign.arrayBuffer())], [7, 9, 11]);
    assert.equal(foreign.customMetadata.ownerId, 'foreign-synthetic-owner');
    assert.equal((await databases.Race.prepare('SELECT status FROM document_jobs').first()).status, 'failed');
    assert.equal((await databases.Race.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").first()).n, 0);
    assert.equal((await databases.Race.prepare('SELECT used_microusd FROM output_provider_calls').first()).used_microusd, 400000, 'Known completed provider bill remains settled despite local storage refusal');

    const leaseBefore = await rowsSnapshot(databases.Lease, financial), leaseRequests = requests.length;
    const retention = await invoke('lease-retention', 'Lease'); assert.equal(retention.ok, true, JSON.stringify(retention));
    assert.deepEqual(retention.live, { reconciled: 0, pending: 0 }); assert.deepEqual(retention.revoked, { reconciled: 1, pending: 0 });
    assert.equal(requests.length, leaseRequests); assert.deepEqual(await rowsSnapshot(databases.Lease, financial), leaseBefore);
    assert.equal((await databases.Lease.prepare('SELECT status FROM output_native_storage_writes').first()).status, 'deleted');
    assert.deepEqual(unexpected, []);
    for (const pin of inputPins) assert.equal(hash(await readFile(pin.path)), pin.sha256, 'Source changed during qualification: ' + pin.path);
    await finite(mf.dispose(), 10000, 'dispose'); closed = true; mf = null; passed = true;
    t.diagnostic(JSON.stringify({ scope: 'local actual bundled service/D1/R2; synthetic source authority and provider GET receipts, no live outcome',
      closed, requests, reports, fixtureSchemaSha256: hash(JSON.stringify(exported.schema)), fixtureRowsSha256: hash(JSON.stringify(exported.rows)),
      bundleSha256: hash(built.outputFiles[0].text), inputPins }));
  } finally {
    globalThis.fetch = originalFetch;
    try { if (mf) { await finite(mf.dispose(), 10000, 'failure_dispose'); closed = true; } }
    finally { f.close(); if (directory && closed) await rm(directory, { recursive: true, force: true }); }
    if (!closed && directory) t.diagnostic('FAILED cleanup: disposable local namespace retained at ' + directory);
    if (!passed || !closed || unexpected.length) t.diagnostic(JSON.stringify({ passed: false, closed, unexpected, requests, reports }));
  }
});

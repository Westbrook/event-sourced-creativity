import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { compileSqliteExpressionDepth } from './d1-expression-depth.mjs';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { admittedRunFixture, runGuestImage, assertNativeCompletion, rows, snapshot, changes, nativeEvents,
  request, payer, origin, redactSource, addLease, insert, interceptRunBatch, publishesCompletion } from './guest-image-run-fixture.mjs';

const inventory = await import('../../worker/experience-guest-image-result-inventory.ts');
export const { inspectGuestImageResultInventory, guestImageResultInventoryData, assertGuestImageResultInventoryCurrent } = inventory;
export const sha = value => createHash('sha256').update(value).digest('hex');

/** The accepted producer is unchanged. Nothing here constructs a positive
 * native graph by hand. Guards are armed separately after fixture mutations. */
export async function completedResultFixture(t, options = {}) {
  const f = await admittedRunFixture(t, options);
  f.completedRun = await runGuestImage(f.request, f.env, f.runInput);
  assert.equal(f.completedRun.status, 'completed');
  f.completed = assertNativeCompletion(f);
  f.inventoryInput = { proof: f.proof };
  return f;
}

/** Additional offline prepare-time bound for this increment only. The inherited
 * compiler remains unchanged; no target SQL or fixture row ever executes. */
export function compileResultInventorySql(schema, sql) {
  const compiled = compileSqliteExpressionDepth(null, sql, { schema, functions: [], limit: 100,
    queryLimits: { functionArguments: 32, parameters: 100, sqlBytes: 100000 } });
  if (!compiled.ok) return compiled;
  const source = String.raw`
import json,sqlite3,sys
n=int(sys.argv[1]); raw=sys.stdin.buffer.read(n)
if len(raw)!=n: raise EOFError("truncated compound-limit input")
data=json.loads(raw); db=sqlite3.connect(":memory:",cached_statements=0)
for statement in data["schema"]: db.executescript(statement+";")
db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)
assert db.getlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT)==5
# Positive and negative controls prove this connection actually enforces five.
db.execute("EXPLAIN "+" UNION ALL ".join(["SELECT 1"]*5)).fetchall()
try: db.execute("EXPLAIN "+" UNION ALL ".join(["SELECT 1"]*6)).fetchall()
except sqlite3.OperationalError as error:
    assert "too many terms in compound SELECT" in str(error)
else: raise AssertionError("compound limit not enforced")
try:
    db.execute("EXPLAIN "+data["sql"],[None]*data["parameters"]).fetchall()
    result={"ok":True,"compoundSelectLimit":5}
except sqlite3.Error as error: result={"ok":False,"compoundSelectLimit":5,"error":str(error)}
print(json.dumps(result))
`;
  const input = JSON.stringify({ schema, sql, parameters: compiled.parameterCount });
  const result = spawnSync(process.env.FORMA_SQLITE_PYTHON ?? 'python3', ['-I', '-S', '-B', '-c', source, String(Buffer.byteLength(input))],
    { input, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  const compound = JSON.parse(result.stdout); assert.equal(compound.compoundSelectLimit, 5);
  return { ...compiled, ...compound };
}

const mediaSnapshot = f => [...f.storage.objects].map(([key, value]) => ({ key,
  bytes: Buffer.from(value.bytes).toString('base64'), metadata: structuredClone(value.metadata), contentType: value.contentType }));
const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;

/** Persistent tripwires make a caught mutation/network/storage exception fail
 * qualification. close() must run before the inherited fixture closes SQLite.
 * D1 owns its actual database snapshot/guard and may reuse only these IO guards. */
export function guardInventory(f, t, { database = true, snapshotDatabase = true } = {}) {
  const originalFetch = globalThis.fetch, originalMedia = new Map(), previousBlocked = f.provider.blocked;
  const before = snapshotDatabase ? snapshot(f) : null, count = snapshotDatabase ? changes(f) : null;
  const providerCount = f.provider.calls.length, mediaCalls = structuredClone(f.storage.calls), objects = mediaSnapshot(f);
  const state = { closed: false, violations: [], statements: [] }, prepare = f.DB.prepare, batch = f.DB.batch;
  const forbiddenDbDescriptors = new Map(['exec', 'dump'].map(method => [method, Object.getOwnPropertyDescriptor(f.DB, method)]));
  const assetsFetchDescriptor = Object.getOwnPropertyDescriptor(f.env.ASSETS, 'fetch');
  const forbidden = operation => { const error = new Error(`Inventory attempted forbidden ${operation}`);
    state.violations.push({ operation }); throw error; };
  globalThis.fetch = () => forbidden('fetch'); f.provider.blocked = true;
  Object.defineProperty(f.env.ASSETS, 'fetch', { configurable: true, writable: true, value: () => forbidden('ASSETS.fetch') });
  for (const method of ['get', 'head', 'put', 'delete', 'list', 'createMultipartUpload', 'resumeMultipartUpload']) {
    originalMedia.set(method, Object.getOwnPropertyDescriptor(f.env.MEDIA, method));
    Object.defineProperty(f.env.MEDIA, method, { configurable: true, writable: true, value: () => forbidden(`MEDIA.${method}`) });
  }
  function qualify(sql, bindings, method) {
    try {
      assert.equal(typeof sql, 'string'); assert.match(sql, /^\s*(?:SELECT|WITH)\b/iu, 'inventory only reads');
      assert.doesNotMatch(sql, mutation, 'inventory cannot hide mutations in a CTE');
      assert.ok(Buffer.byteLength(sql) <= 100000, 'actual SQL bytes fit D1');
      assert.ok(bindings.length <= 100, 'actual bindings fit D1');
      state.statements.push({ sql, bindings: bindings.length, sqlBytes: Buffer.byteLength(sql), method });
    } catch (error) { state.violations.push({ operation: 'DB', sqlSha256: sha(String(sql)), error: String(error) }); throw error; }
  }
  const handles = new WeakMap();
  function wrap(statement, sql, bindings = []) {
    const bind = statement.bind;
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql, values); };
    for (const method of ['first', 'all', 'run']) {
      const original = statement[method];
      if (typeof original === 'function') statement[method] = function (...args) { qualify(sql, bindings, method); return original.apply(this, args); };
    }
    handles.set(statement, { sql, bindings }); return statement;
  }
  if (database) {
    f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
    f.DB.batch = function (statements) {
      for (const statement of statements) { const row = handles.get(statement); if (!row) return forbidden('unobserved DB statement'); qualify(row.sql, row.bindings, 'batch'); }
      return batch.call(this, statements);
    };
    for (const method of forbiddenDbDescriptors.keys()) Object.defineProperty(f.DB, method, { configurable: true, writable: true, value: () => forbidden(`DB.${method}`) });
  }
  const assertUntouched = () => {
    assert.deepEqual(state.violations, [], 'native catches cannot hide inventory side effects');
    if (snapshotDatabase) { assert.deepEqual(snapshot(f), before, 'inventory preserves every schema/row value'); assert.equal(changes(f), count); }
    assert.equal(f.provider.calls.length, providerCount); assert.deepEqual(f.storage.calls, mediaCalls); assert.deepEqual(mediaSnapshot(f), objects);
  };
  const close = () => {
    if (state.closed) return;
    try { assertUntouched(); } finally {
      state.closed = true; globalThis.fetch = originalFetch; f.provider.blocked = previousBlocked;
      if (assetsFetchDescriptor) Object.defineProperty(f.env.ASSETS, 'fetch', assetsFetchDescriptor); else delete f.env.ASSETS.fetch;
      for (const [method, descriptor] of originalMedia) { if (descriptor) Object.defineProperty(f.env.MEDIA, method, descriptor); else delete f.env.MEDIA[method]; }
      if (database) { f.DB.prepare = prepare; f.DB.batch = batch;
        for (const [method, descriptor] of forbiddenDbDescriptors) { if (descriptor) Object.defineProperty(f.DB, method, descriptor); else delete f.DB[method]; } }
    }
  };
  t.after(() => { assert.deepEqual(state.violations, [], 'persistent inventory tripwires'); assert.equal(state.closed, true, 'inventory guard explicitly closed'); });
  return { statements: state.statements, violations: state.violations, assertUntouched, close };
}

export function deeplyFrozen(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) deeplyFrozen(child); }
}

/** Isolated, test-only registry binding seam. The initial catalog source is
 * byte-pinned and executes unchanged except const→let on its two exports.
 * Only after a genuine original Run completes are those current bindings
 * replaced with a genuinely compiled new definition/catalog. No historical
 * record, predicate, native API, database result or object is stubbed. */
export async function inspectAfterRegistryAdvance() {
  const root = new URL('../../', import.meta.url), catalogUrl = new URL('src/experiences/catalog.ts', root);
  const catalogSha256 = sha(readFileSync(catalogUrl));
  const source = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { registerHooks } = require('node:module');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
(async () => {
  const catalogUrl = new URL('src/experiences/catalog.ts', workerData.root).href;
  let loads = 0, hookedSha256, egress = 0;
  const originalFetch = globalThis.fetch; globalThis.fetch = () => { egress++; throw Error('isolated registry fixture external fetch forbidden'); };
  const hook = registerHooks({ load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== catalogUrl) return result;
    loads++; assert.equal(loads, 1);
    const original = Buffer.isBuffer(result.source) ? result.source.toString('utf8') : typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    assert.equal(hash(original), workerData.catalogSha256, 'exact original catalog bytes');
    const first = 'export const definitions: readonly Definition[] =', second = 'export const contextCatalog: Catalog =';
    assert.equal(original.split(first).length, 2); assert.equal(original.split(second).length, 2);
    const changed = original.replace(first, 'export let definitions: readonly Definition[] =').replace(second, 'export let contextCatalog: Catalog =') + '\nexport function __advanceInventoryTestRegistry(nextDefinitions, nextCatalog) { definitions = freeze(nextDefinitions); contextCatalog = freeze(nextCatalog); }\n';
    hookedSha256 = hash(changed); return { ...result, source: changed };
  } });
  const { mock } = await import('node:test'), cleanup = [], context = { mock, after(callback) { cleanup.push(callback); } };
  let guard, receipt, failure;
  try {
    const fixture = await import(new URL('tests/helpers/guest-image-result-inventory-fixture.mjs', workerData.root).href);
    const catalog = await import(catalogUrl), intake = await import(new URL('src/experiences/intake.ts', workerData.root).href);
    const compiler = await import(new URL('src/experiences/compiler.ts', workerData.root).href);
    const format = await import(new URL('worker/experience-sponsor-image-format.ts', workerData.root).href);
    const { authoritativeCreativeContext } = await import(new URL('worker/context-authority.ts', workerData.root).href);
    const f = await fixture.completedResultFixture(context);
    assert.equal(f.completedRun.status, 'completed'); assert.equal(loads, 1);
    const facts = authoritativeCreativeContext(fixture.nativeEvents(f).filter(event => event.sequence <= f.committed.head + 3),
      { projectId: f.session.projectId, documentId: f.session.documentId }).snapshot.facts;
    assert.equal(await format.sponsorImageTextSource(facts), true);
    guard = fixture.guardInventory(f, context);
    const cap = await fixture.inspectGuestImageResultInventory(f.request, f.env, { proof: f.proof });
    const original = fixture.guestImageResultInventoryData(f.request, f.env, cap);
    const nextDefinitions = structuredClone(catalog.definitions), nextCatalog = structuredClone(catalog.contextCatalog);
    const nextDefinition = nextDefinitions.find(value => value.id === 'image'); nextDefinition.revision++;
    nextCatalog.outputs[nextDefinition.outputContractRef].result = '1 image from the next registered revision';
    const compiled = await compiler.compileExperience(nextDefinition, nextCatalog); assert.equal(compiled.ok, true);
    assert.notEqual(compiled.release.releaseHash, f.release.releaseHash);
    catalog.__advanceInventoryTestRegistry(nextDefinitions, nextCatalog);
    const current = await intake.registeredExperience('image');
    assert.equal(current.releaseHash, compiled.release.releaseHash); assert.notEqual(current.output.result, f.release.output.result);
    assert.equal(await format.sponsorImageTextSource(facts), false, 'unchanged current predicate actually sees the new registry');
    const retained = await format.createRetainedSponsorImageFormat(f.release, f.release.releaseHash);
    assert.equal(await format.sponsorImageTextSourceForRetainedFormat(facts, retained), true);
    const req = fixture.request(), later = await fixture.inspectGuestImageResultInventory(req, f.env, { proof: f.proof });
    const data = fixture.guestImageResultInventoryData(req, f.env, later);
    assert.deepEqual(data.manifest, original.manifest); assert.deepEqual(data.review, original.review); assert.equal(data.manifestDigest, original.manifestDigest);
    await fixture.assertGuestImageResultInventoryCurrent(req, f.env, later); guard.assertUntouched();
    assert.equal(hash(readFileSync(new URL(catalogUrl))), workerData.catalogSha256, 'catalog file unchanged');
    receipt = { originalCompletedBeforeAdvance: true, originalReleaseHash: f.release.releaseHash, currentReleaseHash: current.releaseHash,
      currentDefaultRejectsOriginalFacts: true, retainedPredicateAcceptsOriginalFacts: true, stableManifestDigest: data.manifestDigest,
      catalogSha256: workerData.catalogSha256, hookedCatalogSha256: hookedSha256, hookedCatalogLoads: loads,
      historicalDatabaseUnchanged: true, objectDescriptorsUnchanged: true, inventoryProviderCalls: 0, inventoryMediaOperations: 0,
      fixtureOnly: true, productionMigration: false };
  } catch (error) { failure = error; }
  finally {
    try { guard?.close(); } catch (error) { failure ??= error; }
    for (const callback of cleanup.reverse()) { try { await callback(); } catch (error) { failure ??= error; } }
    mock.restoreAll(); hook.deregister(); globalThis.fetch = originalFetch;
    try { assert.equal(egress, 0); } catch (error) { failure ??= error; }
  }
  if (failure) throw failure; parentPort.postMessage(receipt);
})().catch(error => { parentPort.postMessage({ error: error.stack || String(error) }); process.exitCode = 1; });
`;
  const worker = new Worker(source, { eval: true, workerData: { root: root.href, catalogSha256 } });
  let timer, result;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('isolated registry fixture exceeded 45 seconds')), 45000);
      worker.on('message', value => { result = value; }); worker.once('error', reject);
      worker.once('exit', code => { if (code !== 0 || result?.error || !result) reject(new Error(result?.error ?? `registry worker exited ${code}`)); else resolve(result); });
    });
  } finally { clearTimeout(timer); await worker.terminate(); }
}
export { admittedRunFixture, runGuestImage, assertNativeCompletion, rows, snapshot, changes, nativeEvents, request, payer,
  origin, redactSource, addLease, insert, interceptRunBatch, publishesCompletion };

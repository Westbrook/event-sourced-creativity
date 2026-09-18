import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as nativeTest } from 'node:test';
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises';
import { completedMediaFixture, createMediaInventory, installMediaReadGuards, knownPngOracle, deferred,
  snapshot, rows } from './helpers/guest-image-result-media-fixture.mjs';
import { origin, insert, time } from './helpers/guest-image-stage-fixture.mjs';

// The genuine fixture registers source imports before any native module loads.
// Importing this file for its isolated fixture never registers these tests.
const [{ GUEST_CONTEXT_ADOPTION_SCHEMA }, { GUEST_PLAN_CUSTODY_SCHEMA },
  { GUEST_IMAGE_SAVE_CLAIM_SCHEMA }, { GUEST_IMAGE_STAGE_CUSTODY_SCHEMA },
  { GUEST_IMAGE_RESULT_COPY_SCHEMA }, { POLICY_VERSION }, copyContract, api, media, operationApi, writerApi] = await Promise.all([
  import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-guest-image-claim-inventory.ts'),
  import('../worker/experience-guest-image-stage-custody.ts'),
  import('../worker/experience-guest-image-result-copy-schema.ts'),
  import('../worker/policy-version.ts'),
  import('../worker/experience-guest-image-result-copy-contract.ts'),
  import('../worker/experience-guest-image-result-claim-source.ts'),
  import('../worker/experience-guest-image-result-media.ts'),
  import('../worker/experience-guest-image-result-media-operation.ts'),
  import('../worker/experience-guest-image-result-copy-writer.ts'),
]);

export const claimOwner = 'synthetic-result-copy-owner';
export const leaseTable = 'experience_guest_claim_leases';
export const attemptTable = 'experience_guest_image_result_copy_attempts';
export const claimRequest = () => new Request(`${origin}/unregistered-result-copy`, {
  method: 'POST', headers: { origin, 'oai-authenticated-user-id': claimOwner,
    'oai-authenticated-user-email': `${claimOwner}@example.invalid` },
});

/** Real native source/SAVE/stages/Run producers create every positive event,
 * private body, storage receipt and financial row. This local setup adds only
 * dormant DDL and the receiving personal test user. No authority is fabricated. */
export async function copyWriterFixture(t, { inventory = true, inventoryDeadline, ...options } = {}) {
  const f = await completedMediaFixture(t, { ...options, inventory: false });
  for (const sql of [...GUEST_CONTEXT_ADOPTION_SCHEMA, ...GUEST_PLAN_CUSTODY_SCHEMA,
    ...GUEST_IMAGE_SAVE_CLAIM_SCHEMA, ...GUEST_IMAGE_STAGE_CUSTODY_SCHEMA, ...GUEST_IMAGE_RESULT_COPY_SCHEMA]) f.sqlite.exec(sql);
  insert(f, 'users', { user_id: claimOwner, email: `${claimOwner}@example.invalid`, display_name: claimOwner,
    role: 'creator', consent_version: POLICY_VERSION, consented_at: time, created_at: time, updated_at: time });
  f.controller = new AbortController(); f.request = new Request(claimRequest(), { signal: f.controller.signal });
  t.after(() => f.controller.abort());
  if (inventory) await createMediaInventory(f, f.request, inventoryDeadline);
  return f;
}

const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;
const insertPattern = /^\s*INSERT INTO (experience_guest_claim_leases|experience_guest_image_result_copy_attempts)\s*\(/u;
const updatePattern = /^\s*UPDATE experience_guest_image_result_copy_attempts\s+SET\b/u;
const ownMap = new WeakMap();
class CopyObject {
  constructor(value, state) { ownMap.set(this, { value, state }); }
  get key() { return ownMap.get(this).value.key; }
  get version() { return ownMap.get(this).value.version; }
  get size() { return ownMap.get(this).value.size; }
  get etag() { return ownMap.get(this).value.etag; }
  get httpEtag() { return ownMap.get(this).value.httpEtag; }
  get uploaded() { return ownMap.get(this).value.uploaded; }
  get customMetadata() { return ownMap.get(this).value.metadata; }
  get httpMetadata() { return ownMap.get(this).value.httpMetadata; }
  writeHttpMetadata(headers) {
    const captured = ownMap.get(this);
    if (!captured) throw Error('copy fixture lost native metadata method receiver');
    captured.state.metadataCalls++; headers.set('content-type', captured.value.httpMetadata.contentType);
  }
}
class CopyBody extends CopyObject {
  get body() { return ownMap.get(this).value.body; }
}
const recordObject = (row, bytes, suffix = 'original') => ({ key: row.destination_key, size: bytes.length,
  version: `synthetic-copy-version-${suffix}`, etag: `synthetic-copy-etag-${suffix}`,
  httpEtag: `"synthetic-copy-etag-${suffix}"`, uploaded: new Date(), bytes: bytes.slice(),
  metadata: JSON.parse(row.destination_metadata_json), httpMetadata: { contentType: 'image/png' } });

/** The inherited guard still forbids provider/ASSETS/network and preserves all
 * existing storage. Our destination map is separate from that source map. Only
 * native-like conditional PUT and bounded exact-key destination reads/deletion
 * are added; every caught guard violation fails cleanup. This is not workerd. */
export function installCopyWriterGuards(f, t) {
  const io = installMediaReadGuards(f, t, { database: false, snapshotDatabase: false });
  const initial = snapshot(f), statements = [], violations = [], handles = new WeakMap();
  const prepare = f.DB.prepare, batch = f.DB.batch;
  const blockedDescriptors = new Map(['exec', 'dump'].map(method => [method, Object.getOwnPropertyDescriptor(f.DB, method)]));
  const originalSourceGet = f.env.MEDIA.get, originalSourceHead = f.env.MEDIA.head;
  const state = { calls: [], objects: new Map(), putInput: null, putBytes: null, putSnapshot: null, putPromise: null,
    beforePut: null, beforeGet: null, beforeHead: null, putResultTransform: null, getTransform: null,
    headTransform: null, metadataCalls: 0, streamReads: 0, streamCancels: 0, chunks: [] };
  let closed = false, activeStatements = new Set(), reservedRow = null, leaseRow = null;
  const forbidden = operation => { violations.push(operation); throw Error(`copy fixture blocked ${operation}`); };
  const conform = callback => { try { return callback(); } catch (error) { violations.push(String(error)); throw error; } };
  for (const method of blockedDescriptors.keys()) Object.defineProperty(f.DB, method,
    { configurable: true, writable: true, value: () => forbidden(`DB.${method}`) });
  function qualify(sql, bindings, method) {
    conform(() => {
      assert.equal(typeof sql, 'string'); assert.ok(Array.isArray(bindings));
      assert.ok(Buffer.byteLength(sql) <= 100000, 'actual SQL byte bound'); assert.ok(bindings.length <= 100, 'actual binding bound');
      const inserted = insertPattern.exec(sql)?.[1] ?? null, updated = updatePattern.test(sql);
      if (inserted || updated) {
        assert.equal(method, 'batch', 'all allocated mutations remain in a native transaction');
        assert.doesNotMatch(sql, /;|--|\/\*/u); assert.equal([...sql.matchAll(new RegExp(mutation.source, 'giu'))].length, 1);
      } else { assert.match(sql, /^\s*(?:SELECT|WITH)\b/iu); assert.doesNotMatch(sql, mutation); }
      statements.push({ sql, bindings: [...bindings], method, inserted, updated, sqlBytes: Buffer.byteLength(sql) });
    });
  }
  function wrap(statement, sql, bindings = []) {
    const bind = statement.bind, execute = statement.execute;
    if (typeof execute === 'function') statement.execute = function (...args) {
      if (!activeStatements.has(this)) return forbidden('unobserved Statement.execute');
      return execute.apply(this, args);
    };
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql, values); };
    for (const method of ['first', 'all', 'run']) {
      const original = statement[method];
      if (typeof original === 'function') statement[method] = function (...args) {
        qualify(sql, bindings, method); const previous = activeStatements; activeStatements = new Set([this]);
        try { return original.apply(this, args); } finally { activeStatements = previous; }
      };
    }
    handles.set(statement, { sql, bindings }); return statement;
  }
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
  f.DB.batch = function (prepared) {
    for (const statement of prepared) {
      const captured = handles.get(statement); if (!captured) return forbidden('unobserved DB statement');
      qualify(captured.sql, captured.bindings, 'batch');
    }
    const previous = activeStatements; activeStatements = new Set(prepared);
    try { return batch.call(this, prepared); } finally { activeStatements = previous; }
  };
  const currentRow = () => { const attempts = rows(f, attemptTable); assert.equal(attempts.length, 1); return attempts[0]; };
  const exactKey = key => conform(() => { const row = currentRow(); assert.equal(key, row.destination_key); return row; });
  function body(value) {
    let offset = 0;
    return new ReadableStream({ pull(controller) {
      state.streamReads++;
      if (offset === value.bytes.length) { controller.close(); return; }
      const chunk = value.bytes.slice(offset, Math.min(offset + 4096, value.bytes.length)); offset += chunk.length;
      state.chunks.push(chunk); controller.enqueue(chunk);
    }, cancel() { state.streamCancels++; } }, { highWaterMark: 0 });
  }
  f.env.MEDIA.put = function (key, input, options) {
    const row = exactKey(key);
    conform(() => {
      assert.equal(this, f.env.MEDIA); assert.equal(row.state, 'writing'); assert.equal(row.put_outcome, 'pending');
      assert.equal(state.calls.filter(call => call.kind === 'put').length, 0, 'one physical PUT attempt');
      assert.ok(input instanceof ArrayBuffer); assert.deepEqual(new Uint8Array(input), f.mediaOracle.bytes);
      const metadata = JSON.parse(row.destination_metadata_json); assert.equal(Object.keys(metadata).length, 12);
      assert.equal(metadata.outputId, `object-${f.completed.body.generation_id.slice(-8)}`);
      assert.deepEqual(options, { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: metadata, httpMetadata: { contentType: 'image/png' } });
    });
    state.calls.push({ kind: 'put', key }); state.putInput = input; state.putBytes = new Uint8Array(input); state.putSnapshot = state.putBytes.slice();
    const pending = (async () => {
      await state.beforePut?.();
      if (state.objects.has(key)) return null;
      // Read the actual caller-owned buffer only on actual settlement, as a
      // pending storage implementation may do. An early zero becomes visible.
      const stored = recordObject(row, new Uint8Array(input)); state.objects.set(key, stored);
      const value = state.putResultTransform ? state.putResultTransform({ ...stored }) : stored;
      return value === null ? null : new CopyObject(value, state);
    })();
    state.putPromise = pending; return pending;
  };
  f.env.MEDIA.get = async function (key, options) {
    if (key === f.mediaOracle.key) return originalSourceGet.call(this, key, options);
    exactKey(key); conform(() => { assert.equal(this, f.env.MEDIA); assert.equal(options, undefined);
      assert.equal(state.calls.filter(call => call.kind === 'get').length, 0, 'one destination GET'); });
    state.calls.push({ kind: 'get', key }); await state.beforeGet?.();
    const value = state.objects.get(key); if (!value) return null;
    const captured = state.getTransform ? state.getTransform({ ...value, metadata: { ...value.metadata }, bytes: value.bytes.slice() }) : value;
    return new CopyBody({ ...captured, body: body(captured) }, state);
  };
  f.env.MEDIA.head = async function (key, options) {
    if (key === f.mediaOracle.key) return originalSourceHead.call(this, key, options);
    exactKey(key); conform(() => { assert.equal(this, f.env.MEDIA); assert.equal(options, undefined);
      assert.ok(state.calls.filter(call => call.kind === 'head').length < 3, 'destination plus cleanup HEAD bound'); });
    state.calls.push({ kind: 'head', key }); await state.beforeHead?.();
    const value = state.objects.get(key); if (!value) return null;
    const captured = state.headTransform ? state.headTransform({ ...value, metadata: { ...value.metadata } }) : value;
    return new CopyObject(captured, state);
  };
  f.env.MEDIA.delete = async function (key) {
    exactKey(key); conform(() => { assert.equal(this, f.env.MEDIA);
      assert.equal(state.calls.filter(call => call.kind === 'delete').length, 0, 'one cleanup DELETE');
      assert.equal(currentRow().state, 'cleanup_pending', 'cleanup fence precedes deletion');
      const value = state.objects.get(key);
      if (value) assert.deepEqual(value.metadata, JSON.parse(currentRow().destination_metadata_json), 'foreign object never deleted');
    });
    state.calls.push({ kind: 'delete', key }); state.objects.delete(key);
  };
  function captureReserved() {
    reservedRow = structuredClone(currentRow()); leaseRow = structuredClone(rows(f, leaseTable));
    assert.equal(reservedRow.state, 'reserved'); assert.equal(reservedRow.row_version, 0); return reservedRow;
  }
  function assertPreserved() {
    assert.deepEqual(violations, []); io.assertUntouched(); const actual = snapshot(f);
    assert.deepEqual(actual.schema, initial.schema);
    for (const [table, value] of Object.entries(initial.contents))
      if (![leaseTable, attemptTable].includes(table)) assert.deepEqual(actual.contents[table], value, `${table} unchanged`);
    if (reservedRow) {
      const current = currentRow();
      for (const column of copyContract.GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS)
        assert.equal(current[column], reservedRow[column], `${column} immutable`);
      assert.deepEqual(structuredClone(rows(f, leaseTable)), leaseRow, 'copy never renews or rewrites the original lease');
      assert.equal(current.published_at_ms, null); assert.equal(current.published_claim_digest, null);
    }
  }
  const close = () => { if (closed) return;
    try { assertPreserved(); }
    finally { try { io.close(); } finally { f.DB.prepare = prepare; f.DB.batch = batch;
      for (const [method, descriptor] of blockedDescriptors) {
        if (descriptor) Object.defineProperty(f.DB, method, descriptor); else delete f.DB[method];
      }
      closed = true;
    } }
  };
  t.after(() => { assert.deepEqual(violations, []); assert.equal(closed, true, 'copy guard explicitly closed'); });
  return { initial, statements, state, source: io.state, violations, captureReserved, currentRow, assertPreserved, close,
    count: kind => state.calls.filter(call => call.kind === kind).length,
    countInserts: table => statements.filter(item => item.inserted === table).length };
}

export async function genuineReservation(f, guard, observeSource) {
  const source = await api.acquireGuestImageResultClaimSource(f.request, f.env,
    { inventory: f.inventory, requestId: 'result-copy-request-1' });
  observeSource?.(source);
  const observation = await media.readLeasedGuestImageResultMedia(f.request, f.env, source);
  const result = await media.reserveGuestImageResultMedia(f.request, f.env, observation);
  assert.equal(result.status, 'reserved'); const row = guard.captureReserved();
  return { source, observation, reservation: result.reservation, row };
}

const directlyInvoked = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
const test = (name, fn) => nativeTest(name, { timeout: 30000 }, fn);
const refusal = error => { assert.match(String(error), /guest_image_result_/u); return true; };
const rejected = promise => assert.rejects(promise, refusal);
const opaque = token => { assert.ok(Object.isFrozen(token)); assert.deepEqual(Reflect.ownKeys(token), []); };
const noReady = value => { if (value.error) refusal(value.error); else {
  assert.ok(['pending', 'cleaned'].includes(value.value.status)); assert.equal(Object.hasOwn(value.value, 'ready'), false);
  const recovery = value.value.recovery; assert.ok(Object.isFrozen(recovery));
  assert.deepEqual(Object.keys(recovery).sort(), ['attemptId', 'custodyId', 'state', 'outcome', 'dispatchAllowed',
    'custodyTransferred', 'publicReadAvailable'].sort());
  assert.equal(recovery.dispatchAllowed, false); assert.equal(recovery.custodyTransferred, false); assert.equal(recovery.publicReadAvailable, false);
} };
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const foreground = promise => Promise.race([promise, delay(1000).then(() => { throw Error('foreground waited for an unresolved actual PUT'); })]);
async function awaitUploadRetirement(guard) {
  // Buffer retirement is independent of the finite outcome journal. In the
  // stalled-journal controls this wait must finish while that journal is held.
  for (let attempt = 0; attempt < 400; attempt++) {
    if (guard.state.putBytes?.every(value => value === 0)) return;
    await delay(5);
  }
  assert.fail('actual writer did not retire its input after terminal settlement');
}
async function awaitRecordedOutcome(guard, attemptId, expected) {
  // The native SQLite fixture settles independently of foreground refusal and
  // buffer zeroing. Observe its real persisted outcome rather than using buffer
  // lifetime as an implicit journal-completion signal.
  for (let attempt = 0; attempt < 400; attempt++) {
    const row = guard.currentRow(); assert.equal(row.attempt_id, attemptId);
    if (row.put_outcome === expected) { await turn(); return; }
    await delay(5);
  }
  assert.fail('actual writer did not record its observed storage outcome');
}
function observeMediaAccounting(t, operation) {
  const prototype = Object.getPrototypeOf(operation), originalOwn = prototype.own, originalCharge = prototype.charge;
  const owned = [], charges = new Map();
  t.mock.method(prototype, 'own', function (bytes) {
    const result = originalOwn.call(this, bytes); if (this === operation) owned.push(bytes); return result;
  });
  t.mock.method(prototype, 'charge', function (kind, amount = 1) {
    if (this === operation) charges.set(kind, (charges.get(kind) ?? 0) + amount);
    return originalCharge.call(this, kind, amount);
  });
  return { owned, charges };
}
function countPngDigests(t) {
  const original = crypto.subtle.digest.bind(crypto.subtle); let count = 0;
  t.mock.method(crypto.subtle, 'digest', (algorithm, input) => {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) count++;
    return original(algorithm, input);
  });
  return () => count;
}

function interceptAttemptUpdate(f, action) {
  const batch = f.DB.batch; let calls = 0;
  f.DB.batch = async function (statements) {
    const index = statements.findIndex(statement => updatePattern.test(statement.sql));
    const result = await batch.call(this, statements);
    if (index >= 0) { calls++; return action(result, index, calls); } return result;
  };
  return { get calls() { return calls; }, close() { f.DB.batch = batch; } };
}

if (directlyInvoked) {
  test('positive genuine bridge-to-ready copy uses one PUT and preserves original custody and finance', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t), hashes = countPngDigests(t);
    let accounting;
    try {
      const { reservation, row } = await genuineReservation(f, guard, source => {
        accounting = observeMediaAccounting(t, operationApi.guestImageResultLeasedMediaOperation(f.request, f.env, source));
      });
      const result = await media.copyGuestImageResultMedia(f.request, f.env, reservation);
      assert.equal(result.status, 'ready'); opaque(result.ready);
      const ready = await copyContract.readGuestImageResultCopyAttemptRow(guard.currentRow());
      assert.equal(ready.state, 'ready'); assert.equal(ready.put_outcome, 'success'); assert.equal(ready.row_version, 3);
      assert.ok(ready.put_started_at_ms !== null && ready.put_settled_at_ms !== null && ready.verified_at_ms !== null);
      const stored = guard.state.objects.get(row.destination_key); assert.ok(stored);
      assert.deepEqual(stored.bytes, f.mediaOracle.bytes); assert.equal(knownPngOracle(stored.bytes).sha256, f.mediaOracle.sha256);
      assert.deepEqual(stored.metadata, JSON.parse(row.destination_metadata_json));
      assert.deepEqual(guard.source.calls, ['get', 'head']);
      assert.deepEqual(guard.state.calls.map(call => call.kind), ['put', 'get', 'head']);
      assert.equal(hashes(), 1, 'destination comparison does not rehash or inspect the PNG');
      assert.equal(accounting.owned.length, 2); assert.equal(guard.state.putInput, accounting.owned[1].buffer, 'PUT uses the existing single admitted copy');
      assert.equal(accounting.charges.get('ownedBytes'), 2 * f.mediaOracle.size);
      for (const kind of ['readAttempts', 'get', 'head', 'hash', 'inspection', 'consumeAttempts'])
        assert.equal(accounting.charges.get(kind), 1, `${kind} source entitlement stays spent`);
      assert.equal(guard.countInserts(leaseTable), 1); assert.equal(guard.countInserts(attemptTable), 1);
      assert.ok(accounting.owned.every(bytes => bytes.every(value => value === 0)), 'normal media retirement precedes usable ready scalar review');
      // Ready already consumed its single final full database proof. This
      // informational review does not add unmetered currentness polling.
      const statementsBeforeReview = guard.statements.length;
      const review = api.guestImageResultReadyReview(f.request, f.env, result.ready); assert.ok(Object.isFrozen(review));
      assert.deepEqual(review, { version: 1, kind: 'guest-image-result-ready', status: 'ready', attemptId: row.attempt_id,
        custodyId: row.custody_id, destinationUserId: claimOwner, manifestDigest: row.manifest_digest,
        byteLength: f.mediaOracle.size, expiresAtMs: review.expiresAtMs, freshDestinationBytesVerified: true,
        custodyTransferred: false, publicReadAvailable: false });
      assert.equal(guard.statements.length, statementsBeforeReview, 'ready scalar review performs no new database polling');
      assert.ok(Number.isSafeInteger(review.expiresAtMs));
      assert.ok(review.expiresAtMs <= Math.min(JSON.parse(row.lease_snapshot_json).expires_at_ms, row.source_expires_at_ms));
      for (const secret of [f.session.sessionToken, f.session.claimToken, f.mediaOracle.key, row.descriptor_json])
        assert.equal(JSON.stringify(review).includes(secret), false, 'scalar review contains no source capability or private descriptor');
      await rejected(media.copyGuestImageResultMedia(f.request, f.env, reservation));
      assert.equal(guard.count('put'), 1); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('forged and foreign copy admissions cannot consume a genuine reservation', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t);
    try {
      const { reservation } = await genuineReservation(f, guard);
      for (const token of [{}, structuredClone(reservation), Object.create(reservation), new Proxy(reservation, {})])
        await rejected(media.copyGuestImageResultMedia(f.request, f.env, token));
      await rejected(media.copyGuestImageResultMedia(new Request(f.request), f.env, reservation));
      await rejected(media.copyGuestImageResultMedia(f.request, { ...f.env }, reservation));
      // The exported writer is an internal fixed consumer, not an alternate
      // raw-byte entry. Callers cannot obtain its genuine media-private CopyUse.
      const forgedUse = Object.freeze({}), arbitraryBytes = new Uint8Array(f.mediaOracle.size).fill(0xa5);
      const statementsBeforeDirectCalls = guard.statements.length;
      const sourceCallsBeforeDirectCalls = [...guard.source.calls];
      const destinationCallsBeforeDirectCalls = [...guard.state.calls];
      for (const use of [forgedUse, structuredClone(forgedUse), Object.create(forgedUse), new Proxy(forgedUse, {}), reservation])
        await rejected(writerApi.writeGuestImageResultCopy(f.request, f.env, use, arbitraryBytes));
      assert.ok(arbitraryBytes.every(byte => byte === 0xa5), 'forged calls cannot acquire or retire caller-owned bytes');
      assert.equal(guard.statements.length, statementsBeforeDirectCalls, 'direct forgery causes no database I/O');
      assert.deepEqual(guard.source.calls, sourceCallsBeforeDirectCalls, 'direct forgery causes no source I/O');
      assert.deepEqual(guard.state.calls, destinationCallsBeforeDirectCalls, 'direct forgery causes no destination I/O');
      assert.equal(guard.count('put'), 0); assert.equal(guard.currentRow().state, 'reserved');
      const result = await media.copyGuestImageResultMedia(f.request, f.env, reservation);
      assert.equal(result.status, 'ready'); assert.equal(guard.count('put'), 1); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('duplicate copy while actual PUT is pending cannot dispatch a second storage write', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t), entered = deferred(), release = deferred();
    let pending;
    try {
      const { reservation } = await genuineReservation(f, guard);
      guard.state.beforePut = async () => { entered.resolve(); await release.promise; };
      pending = outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); await entered.promise;
      await rejected(media.copyGuestImageResultMedia(f.request, f.env, reservation));
      assert.equal(guard.count('put'), 1); assert.equal(guard.currentRow().state, 'writing');
      assert.equal(guard.currentRow().put_outcome, 'pending'); assert.deepEqual(guard.state.putBytes, f.mediaOracle.bytes);
      release.resolve(); const result = await pending; assert.equal(result.error, undefined); assert.equal(result.value.status, 'ready');
      assert.equal(guard.count('put'), 1); guard.assertPreserved();
    } finally { release.resolve(); await pending; guard.close(); }
  });

  for (const damage of ['bytes', 'metadata']) test(`destination ${damage} mismatch never grants ready custody`, async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t);
    try {
      const { reservation } = await genuineReservation(f, guard);
      guard.state.getTransform = value => {
        if (damage === 'bytes') value.bytes[0] ^= 1;
        else value.metadata.outputId = 'object-00000000';
        return value;
      };
      const result = await outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); noReady(result);
      assert.equal(result.error, undefined); assert.equal(result.value.status, 'cleaned');
      assert.equal(guard.count('put'), 1); assert.equal(guard.count('get'), 1); assert.equal(guard.count('delete'), 1);
      assert.equal(guard.currentRow().state, 'deleted'); assert.equal(guard.state.objects.size, 0);
      guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('a destination body delivered after request-header invalidation is cancelled exactly once', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t), entered = deferred(), release = deferred();
    let pending;
    try {
      const { reservation } = await genuineReservation(f, guard);
      guard.state.beforeGet = async () => { entered.resolve(); await release.promise; };
      pending = outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); await entered.promise;
      f.request.headers.set('x-synthetic-copy-context-change', 'changed'); release.resolve();
      noReady(await pending); await turn();
      assert.equal(guard.state.streamCancels, 1, 'delivered body is cancelled even when no timer or abort event fired');
      assert.equal(guard.state.streamReads, 0); assert.equal(guard.count('get'), 1); assert.equal(guard.count('head'), 0);
      assert.equal(guard.count('delete'), 0); assert.equal(guard.currentRow().state, 'writing');
      assert.equal(guard.currentRow().put_outcome, 'success');
      f.request.headers.delete('x-synthetic-copy-context-change');
      await rejected(media.copyGuestImageResultMedia(f.request, f.env, reservation)); assert.equal(guard.count('put'), 1);
      guard.assertPreserved();
    } finally { release.resolve(); await pending; f.request.headers.delete('x-synthetic-copy-context-change'); guard.close(); }
  });

  test('a changed fresh destination HEAD cannot grant ready authority', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t);
    try {
      const { reservation } = await genuineReservation(f, guard);
      guard.state.headTransform = value => ({ ...value, version: 'synthetic-replaced-version' });
      noReady(await outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)));
      assert.equal(guard.count('put'), 1); assert.equal(guard.count('get'), 1); assert.ok(guard.count('head') >= 1);
      assert.notEqual(guard.currentRow().state, 'ready'); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('conditional-null collision preserves the foreign object and cannot imply ownership', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t);
    try {
      const { reservation, row } = await genuineReservation(f, guard);
      const foreign = recordObject(row, new Uint8Array([7, 8, 9]), 'foreign'); foreign.metadata.writerNonce = crypto.randomUUID();
      guard.state.objects.set(row.destination_key, foreign); const before = structuredClone(foreign);
      const result = await outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); noReady(result);
      assert.equal(result.error, undefined); assert.equal(result.value.status, 'cleaned'); assert.equal(guard.currentRow().state, 'deleted');
      assert.deepEqual(guard.state.objects.get(row.destination_key), before); assert.equal(guard.count('put'), 1);
      assert.equal(guard.count('delete'), 0); assert.equal(guard.currentRow().put_outcome, 'conditional-null');
      assert.notEqual(guard.currentRow().state, 'ready'); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('a rejected PUT acknowledgement after storage commit remains unknown without another PUT or cleanup', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t);
    try {
      const { reservation, row } = await genuineReservation(f, guard);
      guard.state.putResultTransform = () => { throw Error('synthetic transport rejected after storage commit'); };
      const result = await outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); noReady(result);
      assert.equal(result.error, undefined); assert.equal(result.value.status, 'pending');
      assert.deepEqual(guard.state.objects.get(row.destination_key).bytes, f.mediaOracle.bytes);
      assert.equal(guard.currentRow().state, 'writing'); assert.equal(guard.currentRow().put_outcome, 'unknown');
      assert.equal(guard.count('put'), 1); assert.equal(guard.count('get'), 0); assert.equal(guard.count('delete'), 0);
      await rejected(media.copyGuestImageResultMedia(f.request, f.env, reservation));
      assert.equal(guard.count('put'), 1); guard.assertPreserved();
    } finally { guard.close(); }
  });

  test('abort preserves the actual pending PUT buffer until terminal settlement and records no ready authority', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t), entered = deferred(), release = deferred();
    let pending;
    try {
      const { reservation, row } = await genuineReservation(f, guard);
      guard.state.beforePut = async () => { entered.resolve(); await release.promise; };
      pending = outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); await entered.promise;
      f.controller.abort(); noReady(await foreground(pending));
      assert.deepEqual(guard.state.putBytes, f.mediaOracle.bytes, 'physical PUT still owns the live input');
      assert.equal(guard.currentRow().state, 'writing'); assert.equal(guard.currentRow().put_outcome, 'pending');
      assert.equal(guard.state.objects.has(row.destination_key), false); assert.equal(guard.count('get'), 0);
      release.resolve(); await guard.state.putPromise; await awaitUploadRetirement(guard);
      assert.deepEqual(guard.state.objects.get(row.destination_key).bytes, f.mediaOracle.bytes, 'late PUT receives original bytes');
      await awaitRecordedOutcome(guard, row.attempt_id, 'success');
      assert.equal(guard.currentRow().state, 'writing'); assert.equal(guard.currentRow().put_outcome, 'success');
      assert.equal(guard.count('get'), 0); assert.equal(guard.count('head'), 0); assert.equal(guard.count('delete'), 0);
      assert.ok(guard.state.putBytes.every(value => value === 0), 'owned upload buffer retires after actual settlement');
      guard.assertPreserved();
    } finally { release.resolve(); await guard.state.putPromise; await pending; await turn(); guard.close(); }
  });

  for (const paused of ['batch', 'readback']) test(`settled PUT releases upload on abort while outcome ${paused} is pending`, async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t), entered = deferred(), release = deferred();
    const prepare = f.DB.prepare; let pending, hook, pausedCount = 0;
    try {
      const { reservation, row } = await genuineReservation(f, guard);
      hook = interceptAttemptUpdate(f, async (results, index, count) => {
        if (count === 2 && paused === 'batch') { pausedCount++; entered.resolve(); await release.promise; }
        return results;
      });
      if (paused === 'readback') f.DB.prepare = function (sql) {
        const wrap = statement => {
          const bind = statement.bind, first = statement.first;
          statement.bind = function (...values) { return wrap(bind.apply(this, values)); };
          statement.first = async function (...args) {
            const result = await first.apply(this, args);
            if (hook.calls === 2 && /^SELECT attempt_id,/u.test(sql)
              && sql.includes(' FROM experience_guest_image_result_copy_attempts')) {
              assert.equal(result.put_outcome, 'success'); pausedCount++; entered.resolve(); await release.promise;
            }
            return result;
          };
          return statement;
        };
        return wrap(prepare.call(this, sql));
      };
      pending = outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); await foreground(entered.promise);
      await guard.state.putPromise;
      assert.deepEqual(guard.state.objects.get(row.destination_key).bytes, f.mediaOracle.bytes);
      assert.deepEqual(guard.state.putBytes, f.mediaOracle.bytes, 'live destination comparison may still need bytes');
      f.controller.abort(); noReady(await foreground(pending));
      await awaitUploadRetirement(guard);
      assert.equal(pausedCount, 1); assert.equal(guard.count('put'), 1);
      assert.equal(guard.count('get'), 0); assert.equal(guard.count('head'), 0); assert.equal(guard.count('delete'), 0);
      assert.equal(guard.currentRow().state, 'writing'); assert.equal(guard.currentRow().put_outcome, 'success');
      release.resolve(); await turn(); await turn();
      assert.equal(guard.count('get'), 0); assert.equal(guard.count('head'), 0); assert.equal(guard.count('delete'), 0);
      guard.assertPreserved();
    } finally {
      release.resolve(); await guard.state.putPromise; await pending; await turn(); await turn();
      f.DB.prepare = prepare; hook?.close(); guard.close();
    }
  });

  test('reservation without a byte consumer retires owned buffers on abort while its ACK is pending', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t), entered = deferred(), release = deferred();
    const batch = f.DB.batch; let pending, accounting;
    try {
      const source = await api.acquireGuestImageResultClaimSource(f.request, f.env,
        { inventory: f.inventory, requestId: 'result-copy-request-1' });
      accounting = observeMediaAccounting(t, operationApi.guestImageResultLeasedMediaOperation(f.request, f.env, source));
      const observation = await media.readLeasedGuestImageResultMedia(f.request, f.env, source);
      f.DB.batch = async function (statements) {
        const result = await batch.call(this, statements);
        if (statements.some(statement => insertPattern.exec(statement.sql)?.[1] === attemptTable)) {
          guard.captureReserved(); entered.resolve(); await release.promise;
        }
        return result;
      };
      pending = outcome(media.reserveGuestImageResultMedia(f.request, f.env, observation)); await foreground(entered.promise);
      assert.equal(accounting.owned.length, 2); assert.ok(accounting.owned.some(bytes => bytes.some(value => value !== 0)));
      f.controller.abort(); assert.ok((await foreground(pending)).error);
      for (let attempt = 0; attempt < 400 && accounting.owned.some(bytes => bytes.some(value => value !== 0)); attempt++) await delay(5);
      assert.ok(accounting.owned.every(bytes => bytes.every(value => value === 0)), 'metadata-only reservation holds no active byte consumer');
      assert.equal(guard.count('put'), 0); assert.equal(guard.currentRow().state, 'reserved');
      release.resolve(); await turn(); await turn(); guard.assertPreserved();
    } finally { release.resolve(); await pending; await turn(); await turn(); f.DB.batch = batch; guard.close(); }
  });

  test('actual success after original monotonic expiry has outcome-only authority', async t => {
    const f = await copyWriterFixture(t, { inventory: false }), guard = installCopyWriterGuards(f, t);
    const entered = deferred(), release = deferred(); let clock = 1000, pending;
    const mockedClock = t.mock.method(performance, 'now', () => clock);
    try {
      await createMediaInventory(f, f.request, 31000); const { reservation, row } = await genuineReservation(f, guard);
      guard.state.beforePut = async () => { entered.resolve(); await release.promise; };
      pending = outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); await entered.promise;
      clock = 31000; assert.deepEqual(guard.state.putBytes, f.mediaOracle.bytes); release.resolve();
      noReady(await pending); await guard.state.putPromise; await awaitUploadRetirement(guard);
      await awaitRecordedOutcome(guard, row.attempt_id, 'success');
      assert.equal(guard.currentRow().state, 'writing'); assert.equal(guard.currentRow().put_outcome, 'success');
      assert.equal(guard.count('get'), 0); assert.equal(guard.count('head'), 0); assert.equal(guard.count('delete'), 0);
      clock = 1000; await rejected(media.copyGuestImageResultMedia(f.request, f.env, reservation));
      assert.equal(guard.count('put'), 1); guard.assertPreserved();
    } finally { release.resolve(); await guard.state.putPromise; await pending; mockedClock.mock.restore(); guard.close(); }
  });

  test('late settlement binds the captured database and cannot follow a replaced env binding', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t), entered = deferred(), release = deferred();
    const originalDatabase = f.env.DB; let pending, foreignCalls = 0;
    try {
      const { reservation, row } = await genuineReservation(f, guard);
      guard.state.beforePut = async () => { entered.resolve(); await release.promise; };
      pending = outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); await entered.promise;
      f.env.DB = { prepare() { foreignCalls++; throw Error('foreign DB prepare'); }, batch() { foreignCalls++; throw Error('foreign DB batch'); } };
      f.controller.abort(); noReady(await foreground(pending)); assert.deepEqual(guard.state.putBytes, f.mediaOracle.bytes);
      release.resolve(); await guard.state.putPromise; await awaitUploadRetirement(guard);
      await awaitRecordedOutcome(guard, row.attempt_id, 'success');
      assert.equal(foreignCalls, 0); assert.equal(guard.currentRow().state, 'writing');
      assert.equal(guard.currentRow().put_outcome, 'success'); assert.equal(guard.count('get'), 0); assert.equal(guard.count('head'), 0);
      assert.equal(guard.count('delete'), 0); guard.assertPreserved();
    } finally { release.resolve(); await guard.state.putPromise; await pending; await turn(); f.env.DB = originalDatabase; guard.close(); }
  });

  for (const damage of ['lost-ack', 'false-success', 'wrong-changes']) test(`uncertain writing ${damage} grants no PUT dispatch`, async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t); let hook;
    try {
      const { reservation } = await genuineReservation(f, guard);
      hook = interceptAttemptUpdate(f, (results, index, count) => {
        if (count !== 1) return results;
        if (damage === 'lost-ack') throw Error('synthetic acknowledgement lost after actual native commit');
        const changed = structuredClone(results);
        if (damage === 'false-success') changed[index].success = false; else changed[index].meta.changes = 0;
        return changed;
      });
      const result = await outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); noReady(result);
      assert.equal(result.error, undefined); assert.equal(result.value.status, 'pending');
      assert.equal(hook.calls, 1); assert.equal(guard.count('put'), 0);
      assert.equal(guard.currentRow().state, 'writing', 'native commit precedes injected ACK loss');
      assert.equal(guard.currentRow().put_outcome, 'pending'); guard.assertPreserved();
    } finally { hook?.close(); guard.close(); }
  });

  test('an oversized settlement ACK remains unresolved after the real outcome CAS and cannot become ready by readback', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t); let hook;
    try {
      const { reservation } = await genuineReservation(f, guard);
      hook = interceptAttemptUpdate(f, (results, index, count) => {
        if (count !== 2) return results;
        const changed = structuredClone(results);
        changed[index].meta.syntheticOversizedField = 'x'.repeat(16_384);
        return changed;
      });
      const result = await outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); noReady(result);
      if (result.value) assert.equal(result.value.status, 'pending');
      assert.equal(hook.calls, 2, 'actual writing and settlement CAS each ran once');
      assert.equal(guard.currentRow().state, 'writing'); assert.equal(guard.currentRow().put_outcome, 'success', 'actual synthetic outcome commit preceded oversized ACK');
      assert.equal(guard.count('put'), 1); assert.equal(guard.count('get'), 0); assert.equal(guard.count('head'), 0);
      assert.equal(guard.count('delete'), 0); guard.assertPreserved();
    } finally { hook?.close(); guard.close(); }
  });

  test('cleanup fence cannot delete a destination replaced by another writer', async t => {
    const f = await copyWriterFixture(t), guard = installCopyWriterGuards(f, t); let foreign;
    try {
      const { reservation, row } = await genuineReservation(f, guard);
      guard.state.getTransform = value => {
        foreign = recordObject(row, new Uint8Array([9, 4, 1]), 'replacement'); foreign.metadata.writerNonce = crypto.randomUUID();
        guard.state.objects.set(row.destination_key, foreign); value.bytes[0] ^= 1; return value;
      };
      const result = await outcome(media.copyGuestImageResultMedia(f.request, f.env, reservation)); noReady(result);
      assert.equal(result.error, undefined); assert.equal(result.value.status, 'pending');
      assert.equal(guard.currentRow().state, 'cleanup_pending'); assert.ok(foreign); assert.deepEqual(guard.state.objects.get(row.destination_key), foreign);
      assert.equal(guard.count('delete'), 0); assert.notEqual(guard.currentRow().state, 'ready');
      assert.notEqual(guard.currentRow().state, 'published'); guard.assertPreserved();
    } finally { guard.close(); }
  });
}

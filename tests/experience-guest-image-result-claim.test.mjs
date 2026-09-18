import assert from 'node:assert/strict';
import { test as nativeTest } from 'node:test';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { copyWriterFixture, genuineReservation, installCopyWriterGuards, claimOwner, attemptTable } from './experience-guest-image-result-copy-writer.test.mjs';
import { snapshot, rows, payer, knownPngOracle } from './helpers/guest-image-result-media-fixture.mjs';
import { guardInventory } from './helpers/guest-image-result-inventory-fixture.mjs';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';
const fixtureClosers = new WeakMap();
const test = (name, options, run) => nativeTest(name, options, async t => {
  const closers = []; fixtureClosers.set(t, closers);
  try { await run(t); } finally { for (const close of closers.reverse()) close(); }
});

// The upstream fixture owns native source/SAVE/Run creation and the import hook.
// Never replace it with an invented ready token or a hand-authored source row.
const [api, media, custody, copyContract] = await Promise.all([
  import('../worker/experience-guest-image-result-claim-source.ts'),
  import('../worker/experience-guest-image-result-media.ts'),
  import('../worker/experience-guest-image-result-custody.ts'),
  import('../worker/experience-guest-image-result-copy-contract.ts'),
]);
const allowed = new Set(['events', 'event_private_payloads', 'event_write_stage', 'event_client_receipts', 'output_commands', 'private_content',
  'experience_guest_context_adoptions', 'experience_guest_image_claims', 'experience_guest_image_stage_custodies',
  'experience_guest_image_stage_copies', 'experience_guest_image_result_custodies', 'experience_guest_image_result_copies',
  'experience_guest_sessions', attemptTable]);
const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+[\w"]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE\s+(?:TABLE|TRIGGER)|DROP\s+(?:TABLE|TRIGGER)|ALTER\s+TABLE)\b/iu;
const claimError = error => { assert.match(String(error), /guest_image_result_/u); return true; };
async function readyFixture(t, { freshRetry = false, copyMode = 'ready' } = {}) {
  const f = await copyWriterFixture(t), writer = installCopyWriterGuards(f, t);
  let ready;
  try {
    const reserved = await genuineReservation(f, writer);
    assert.ok(['ready', 'reserved', 'unknown'].includes(copyMode));
    if (copyMode !== 'reserved') {
      if (copyMode === 'unknown') writer.state.putResultTransform = () => { throw Error('synthetic original PUT ACK loss'); };
      const result = await media.copyGuestImageResultMedia(f.request, f.env, reserved.reservation);
      assert.equal(result.status, copyMode === 'ready' ? 'ready' : 'pending'); ready = result.ready;
      assert.equal(writer.count('put'), 1); assert.equal(writer.count('get'), copyMode === 'ready' ? 1 : 0);
      if (copyMode === 'unknown') assert.equal(rows(f, attemptTable)[0].put_outcome, 'unknown');
    } else { assert.equal(writer.count('put'), 0); assert.equal(writer.count('get'), 0); }
  } finally { writer.close(); }
  const io = guardInventory(f, t, { database: false, snapshotDatabase: false });
  const initial = snapshot(f), original = { prepare: f.DB.prepare, batch: f.DB.batch, head: f.env.MEDIA.head,
    get: f.env.MEDIA.get, put: f.env.MEDIA.put, delete: f.env.MEDIA.delete };
  const calls = [], statements = [], handles = new WeakMap(), violations = [];
  const blocked = new Map(['exec', 'dump'].map(key => [key, Object.getOwnPropertyDescriptor(f.DB, key)]));
  let activeStatements = new Set();
  const state = { batchTransform: null, readTransform: null, beforeBatch: null, headTransform: null, publicationBatches: 0, headCalls: 0,
    getTransform: null, beforeGet: null, beforeHead: null, getCalls: 0, streamReads: 0, streamCancels: 0,
    competing: false, competitorHeadCalls: 0, retryPublicationBatches: 0 };
  const denied = value => { violations.push(value); throw Error('claim fixture blocked ' + value); };
  for (const method of blocked.keys()) Object.defineProperty(f.DB, method, { configurable: true, writable: true, value: () => denied('DB.' + method) });
  function qualify(sql, bindings, batch) {
    try {
    assert.equal(typeof sql, 'string'); assert.ok(Buffer.byteLength(sql) <= 100000); assert.ok(bindings.length <= 100);
    const inserted = /^\s*INSERT INTO ([a-z_]+)\b/u.exec(sql)?.[1], updated = /^\s*UPDATE ([a-z_]+) SET\b/u.exec(sql)?.[1];
    if (inserted || updated) {
      assert.equal(batch, true); assert.ok(allowed.has(inserted ?? updated)); assert.doesNotMatch(sql, /;|--|\/\*/u);
      assert.equal([...sql.matchAll(new RegExp(mutation.source, 'giu'))].length, 1);
      if (updated) assert.ok(['experience_guest_sessions', attemptTable].includes(updated));
    } else { assert.match(sql, /^\s*(?:SELECT|WITH)\b/iu); assert.doesNotMatch(sql, mutation); }
    statements.push({ sql, bindings: [...bindings], batch, inserted, updated });
    } catch (error) { violations.push(String(error)); throw error; }
  }
  function wrap(statement, sql, bindings = []) {
    handles.set(statement, { sql, bindings });
    const bind = statement.bind, direct = statement.execute;
    if (typeof direct === 'function') statement.execute = function (...args) {
      if (!activeStatements.has(this)) return denied('unobserved Statement.execute');
      return direct.apply(this, args);
    };
    statement.bind = function (...values) { return wrap(bind.apply(this, values), sql, values); };
    for (const method of ['first', 'all', 'run']) {
      const execute = statement[method];
      if (typeof execute === 'function') statement[method] = function (...args) {
        qualify(sql, bindings, false); const previous = activeStatements; activeStatements = new Set([this]);
        try {
          const result = execute.apply(this, args);
          return state.readTransform ? Promise.resolve(result).then(value => state.readTransform(value, { sql, bindings, method })) : result;
        } finally { activeStatements = previous; }
      };
    }
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(original.prepare.call(this, sql), sql); };
  f.DB.batch = async function (prepared) {
    const items = prepared.map(item => { const found = handles.get(item); assert.ok(found); qualify(found.sql, found.bindings, true); return found; });
    const publication = items.some(item => /^\s*INSERT INTO experience_guest_image_result_custodies\b/u.test(item.sql));
    if (publication) { state.publicationBatches++; if (freshRetry && !state.competing) state.retryPublicationBatches++; }
    await state.beforeBatch?.({ prepared, items, publication });
    const previous = activeStatements; activeStatements = new Set(prepared);
    let result; try { result = await original.batch.call(this, prepared); } finally { activeStatements = previous; }
    return state.batchTransform ? state.batchTransform(result, { items, publication }) : result;
  };
  for (const method of ['get', 'put', 'delete']) f.env.MEDIA[method] = () => denied('MEDIA.' + method);
  if (freshRetry) f.env.MEDIA.get = async function (key, options) {
    state.getCalls++; calls.push({ kind: 'get', key });
    let value;
    try {
      assert.equal(this, f.env.MEDIA); assert.equal(options, undefined); assert.equal(state.competing, false);
      assert.equal(state.getCalls, 1, 'one fresh destination GET');
      assert.equal(key, rows(f, attemptTable)[0].destination_key);
      value = writer.state.objects.get(key); assert.ok(value);
    } catch (error) { violations.push(String(error)); throw error; }
    await state.beforeGet?.();
    const captured = { ...value, bytes: value.bytes.slice(), metadata: { ...value.metadata } };
    const raw = state.getTransform ? state.getTransform(captured) : captured;
    let offset = 0;
    const object = { key: raw.key, size: raw.size, version: raw.version, etag: raw.etag, httpEtag: raw.httpEtag,
      customMetadata: raw.metadata,
      writeHttpMetadata(headers) {
        if (this !== object) return denied('fresh GET metadata receiver');
        headers.set('content-type', raw.httpMetadata.contentType);
      },
      body: new ReadableStream({ pull(controller) {
        state.streamReads++;
        if (offset === raw.bytes.length) { controller.close(); return; }
        const chunk = raw.bytes.slice(offset, Math.min(offset + 4096, raw.bytes.length)); offset += chunk.length;
        controller.enqueue(chunk);
      }, cancel() { state.streamCancels++; } }, { highWaterMark: 0 }) };
    return object;
  };
  f.env.MEDIA.head = async function (key, options) {
    if (state.competing) state.competitorHeadCalls++; else state.headCalls++;
    calls.push({ kind: 'head', key, competitor: state.competing });
    let value;
    try {
      assert.equal(this, f.env.MEDIA); assert.equal(options, undefined);
      const attempt = rows(f, attemptTable)[0]; assert.equal(key, attempt.destination_key);
      if (state.competing) assert.equal(state.competitorHeadCalls, 1, 'one separately owned original claimant HEAD');
      else assert.ok(state.headCalls <= (freshRetry ? 2 : 1), 'bounded verification and final claim HEADs');
      value = writer.state.objects.get(key); assert.ok(value);
    } catch (error) { violations.push(String(error)); throw error; }
    await state.beforeHead?.();
    const raw = state.headTransform ? state.headTransform({ ...value }) : value;
    return { key: raw.key, size: raw.size, version: raw.version, etag: raw.etag, httpEtag: raw.httpEtag,
      customMetadata: raw.metadata, writeHttpMetadata(headers) { headers.set('content-type', raw.httpMetadata.contentType); } };
  };
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    try { assert.deepEqual(violations, []); io.assertUntouched(); }
    finally {
      f.DB.prepare = original.prepare; f.DB.batch = original.batch;
      for (const [method, descriptor] of blocked) { if (descriptor) Object.defineProperty(f.DB, method, descriptor); else delete f.DB[method]; }
      io.close();
    }
  };
  fixtureClosers.get(t).push(close);
  t.after(() => { assert.equal(closed, true); assert.deepEqual(violations, []); });
  return { f, ready, initial, writer, state, statements, calls, close };
}
// SQLite result rows contain scalar own data and may have a null prototype.
// Preserve that native shape in expected snapshots; never normalize actual rows.
const copyExpectedNativeRow = row => Object.create(Object.getPrototypeOf(row), Object.getOwnPropertyDescriptors(row));
function preserved(fixture) {
  const actual = snapshot(fixture.f); assert.deepEqual(actual.schema, fixture.initial.schema);
  for (const [table, value] of Object.entries(fixture.initial.contents)) {
    if (!allowed.has(table)) assert.deepEqual(actual.contents[table], value, table + ' retained byte-for-byte');
  }
  for (const table of ['events', 'event_private_payloads', 'private_content', 'output_commands', 'event_client_receipts']) {
    const original = fixture.initial.contents[table] ?? [];
    for (const row of original) assert.ok(actual.contents[table].some(value => JSON.stringify(value) === JSON.stringify(row)), table + ' original retained');
  }
  const custodyRow = rows(fixture.f, 'experience_guest_image_result_custodies')[0];
  const sessions = fixture.initial.contents.experience_guest_sessions.map(copyExpectedNativeRow);
  if (custodyRow) {
    const session = sessions.find(value => value.session_id === custodyRow.session_id); assert.ok(session);
    assert.equal(session.revoked_at_ms, null); session.revoked_at_ms = custodyRow.created_at_ms;
  }
  assert.deepEqual(actual.contents.experience_guest_sessions, sessions, 'only the exact own guest tombstone changes');
  const priorAttempt = fixture.initial.contents[attemptTable][0], currentAttempt = rows(fixture.f, attemptTable)[0];
  for (const column of copyContract.GUEST_IMAGE_RESULT_COPY_IMMUTABLE_COLUMNS)
    assert.equal(currentAttempt[column], priorAttempt[column], column + ' original immutable copy intent');
  assert.equal(fixture.writer.count('put'), 1); assert.equal(fixture.writer.count('get'), 1);
}
const options = { timeout: 30000 };

test('genuine ready whole-graph claim positive preserves original image and publishes five bodies atomically', options, async t => {
  const f = await readyFixture(t), result = await api.claimGuestImageResult(f.f.request, f.f.env, f.ready);
  assert.equal(result.status, 'claimed'); assert.equal(result.custodyTransferred, true); assert.equal(result.publicReadAvailable, false);
  const row = rows(f.f, 'experience_guest_image_result_custodies')[0], lineage = JSON.parse(row.lineage_json);
  assert.equal(rows(f.f, 'experience_guest_image_result_custodies').length, 1);
  assert.equal(rows(f.f, 'experience_guest_image_stage_copies').length, 3); assert.equal(rows(f.f, 'experience_guest_image_result_copies').length, 2);
  assert.equal(row.destination_user_id, claimOwner); assert.equal(row.generation_id, f.f.completed.body.generation_id);
  assert.equal(lineage.copy.manifest.documentId, f.f.session.documentId); assert.equal(lineage.copy.manifest.projectId, f.f.session.projectId);
  assert.equal(rows(f.f, 'experience_guest_sessions')[0].revoked_at_ms, row.created_at_ms);
  assert.equal(rows(f.f, attemptTable)[0].state, 'published'); assert.equal(rows(f.f, attemptTable)[0].published_claim_digest, row.lineage_digest);
  assert.equal(f.state.publicationBatches, 1); assert.equal(f.state.headCalls, 1);
  const canonical = rows(f.f, 'events').filter(event => event.type === 'GuestImageResultClaimed'); assert.equal(canonical.length, 1);
  const body = JSON.parse(rows(f.f, 'event_private_payloads').find(value => value.private_event_id === canonical[0].event_id).private_json);
  assert.equal(Object.keys(body).length, 29); assert.equal(body.object_id, f.f.completed.body.object_id);
  assert.equal(body.original_created_at, lineage.originalCompletion.occurredAt); assert.equal(body.source_rights_digest, JSON.parse(rows(f.f, 'experience_sponsor_issuances')[0].envelope_json).rightsDigest);
  assert.equal(rows(f.f, 'events').filter(event => event.type === 'GenerationCompleted').length, 1);
  preserved(f);
  const beforeRead = snapshot(f.f);
  const read = await custody.readGuestImageResultCustody(new Request(f.f.request), f.f.env, { sessionId: row.session_id, custodyId: row.custody_id });
  assert.ok(read); assert.equal(read.documentId, f.f.session.documentId); assert.deepEqual(read.completedReview, result.completedReview);
  assert.deepEqual(snapshot(f.f), beforeRead, 'fresh completed reader performs no writes'); preserved(f);
  await assert.rejects(api.claimGuestImageResult(f.f.request, f.f.env, f.ready), claimError);
});

test('forged or foreign ready values do not start final claim reads or writes', options, async t => {
  const f = await readyFixture(t), count = f.statements.length;
  for (const value of [{}, structuredClone(f.ready), new Proxy(f.ready, {}), Object.create(f.ready)])
    await assert.rejects(api.claimGuestImageResult(f.f.request, f.f.env, value), claimError);
  await assert.rejects(api.claimGuestImageResult(new Request(f.f.request), f.f.env, f.ready), claimError);
  await assert.rejects(api.claimGuestImageResult(f.f.request, { ...f.f.env }, f.ready), claimError);
  assert.equal(f.statements.length, count); assert.equal(f.state.headCalls, 0); preserved(f);
});

for (const kind of ['throw-after-commit', 'sparse-ack', 'truncated-ack', 'own-slice-ack']) test('one winner readback after ' + kind, options, async t => {
  const f = await readyFixture(t);
  f.state.batchTransform = (result, { publication }) => {
    if (!publication) return result;
    if (kind === 'throw-after-commit') throw Error('synthetic lost publication ACK');
    if (kind === 'sparse-ack') { const sparse = [...result]; delete sparse[0]; return sparse; }
    if (kind === 'own-slice-ack') { const extra = [...result]; extra.slice = null; return extra; }
    return result.slice(1);
  };
  const result = await api.claimGuestImageResult(f.f.request, f.f.env, f.ready);
  assert.equal(result.status, 'claimed'); assert.equal(result.replayed, true); assert.equal(f.state.publicationBatches, 1);
  assert.equal(f.state.headCalls, 1); preserved(f);
});

test('fresh destination version mismatch denies before every canonical write', options, async t => {
  const f = await readyFixture(t); f.state.headTransform = value => ({ ...value, version: value.version + '-changed' });
  await assert.rejects(api.claimGuestImageResult(f.f.request, f.f.env, f.ready), claimError);
  assert.equal(f.state.publicationBatches, 0); assert.equal(rows(f.f, 'experience_guest_image_result_custodies').length, 0);
  assert.equal(rows(f.f, attemptTable)[0].state, 'ready'); assert.equal(rows(f.f, 'experience_guest_sessions')[0].revoked_at_ms, null); preserved(f);
});

test('abort retires original ready lifetime without a new final allowance', options, async t => {
  const f = await readyFixture(t); f.f.controller.abort();
  await assert.rejects(api.claimGuestImageResult(f.f.request, f.f.env, f.ready), claimError);
  assert.equal(f.state.publicationBatches, 0); assert.equal(f.state.headCalls, 0); preserved(f);
});

for (const malformed of ['sparse-index-substitute', 'oversized-undefined-metadata']) test('fresh canonical reader refuses ' + malformed, options, async t => {
  const f = await readyFixture(t), claimed = await api.claimGuestImageResult(f.f.request, f.f.env, f.ready);
  const row = rows(f.f, 'experience_guest_image_result_custodies')[0], before = snapshot(f.f);
  let reached = 0;
  f.state.batchTransform = (result, { items }) => {
    if (items.length < 4 || !items.every(item => /^\s*SELECT 1 AS current WHERE /u.test(item.sql))) return result;
    reached++;
    const changed = [...result];
    if (malformed === 'sparse-index-substitute') { delete changed[0]; changed['4294967295'] = result[0]; }
    else changed[0] = { ...changed[0], meta: { ...changed[0].meta,
      deniedOwnUndefined: Object.fromEntries(Array.from({ length: 1500 }, (_, i) => ['field' + i, undefined])) } };
    return changed;
  };
  const observed = await custody.readGuestImageResultCustody(new Request(f.f.request), f.f.env, { sessionId: row.session_id, custodyId: row.custody_id });
  assert.equal(observed, null); assert.equal(reached, 1); assert.equal(claimed.status, 'claimed');
  assert.deepEqual(snapshot(f.f), before); assert.equal(f.state.publicationBatches, 1); preserved(f);
});

// Fresh retry uses real possession plus the durable selector, never the old
// informational review or a parsed row as authority. Explicit request creation
// avoids accidentally inheriting the retired original request's aborted signal.
function retryInput(fixture) {
  const row = rows(fixture.f, attemptTable)[0];
  return { proof: structuredClone(fixture.f.proof), selector: { version: 1,
    attemptId: row.attempt_id, custodyId: row.custody_id, manifestDigest: row.manifest_digest } };
}
function freshRequest(t, fixture, { retireOriginal = true, userId } = {}) {
  if (retireOriginal) fixture.f.controller.abort();
  const controller = new AbortController(), headers = new Headers(fixture.f.request.headers);
  if (userId) {
    headers.set('oai-authenticated-user-id', userId);
    headers.set('oai-authenticated-user-email', `${userId}@example.invalid`);
  }
  const request = new Request(fixture.f.request.url, { method: fixture.f.request.method, headers, signal: controller.signal });
  fixtureClosers.get(t).push(() => controller.abort());
  assert.equal(request.signal.aborted, false);
  return request;
}
function noRetryWrites(fixture, before) {
  assert.deepEqual(snapshot(fixture.f), before, 'retry changed no fixture-owned database row');
  assert.equal(fixture.state.retryPublicationBatches, 0);
  assert.equal(fixture.statements.filter(item => item.inserted || item.updated).length, 0, 'no attempted database mutation');
  assert.equal(rows(fixture.f, 'experience_guest_image_result_custodies').length, 0);
}
const changedHex = value => value.slice(0, -1) + (value.endsWith('0') ? '1' : '0');
function sameImageWithDifferentHash(bytes) {
  const original = knownPngOracle(bytes), changed = Buffer.from(bytes);
  let offset = 8, changedChunk = false;
  while (offset < changed.length) {
    const length = changed.readUInt32BE(offset), type = changed.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      const start = offset + 8, end = start + length;
      assert.ok(length >= 2); assert.equal(changed[start], 0x78); assert.equal(changed[start + 1] & 0x20, 0);
      // FLEVEL is a nonbinding compression hint. Change only that hint and
      // recompute FCHECK; the deflate payload and decoded pixels are identical.
      const hint = (((changed[start + 1] >>> 6) + 1) % 4) << 6;
      changed[start + 1] = hint | (31 - ((changed[start] * 256 + hint) % 31)) % 31;
      let crc = 0xffffffff;
      for (const byte of changed.subarray(offset + 4, end)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
      }
      changed.writeUInt32BE((crc ^ 0xffffffff) >>> 0, end); changedChunk = true; break;
    }
    offset += length + 12;
  }
  assert.equal(changedChunk, true);
  const observed = knownPngOracle(changed);
  assert.equal(observed.size, original.size); assert.notEqual(observed.sha256, original.sha256);
  return new Uint8Array(changed);
}

test('fresh ready retry positive retires the original request and claims the same single uploaded image', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f);
  const originalLease = rows(f.f, 'experience_guest_claim_leases').map(copyExpectedNativeRow);
  const request = freshRequest(t, f);
  assert.equal(f.f.request.signal.aborted, true);
  const claimed = await api.retryGuestImageResultClaim(request, f.f.env, input);
  assert.equal(claimed.status, 'claimed'); assert.equal(claimed.custodyTransferred, true); assert.equal(claimed.publicReadAvailable, false);
  assert.equal(claimed.replayed, false);
  const row = rows(f.f, 'experience_guest_image_result_custodies')[0], lineage = JSON.parse(row.lineage_json);
  assert.equal(row.custody_id, input.selector.custodyId); assert.equal(row.destination_user_id, claimOwner);
  assert.equal(row.generation_id, f.f.completed.body.generation_id);
  assert.equal(lineage.copy.manifest.documentId, f.f.session.documentId); assert.equal(lineage.copy.manifest.projectId, f.f.session.projectId);
  assert.deepEqual(rows(f.f, 'experience_guest_claim_leases'), originalLease, 'all nine original lease columns retained');
  assert.equal(rows(f.f, attemptTable)[0].state, 'published');
  assert.equal(f.state.getCalls, 1); assert.equal(f.state.headCalls, 2); assert.equal(f.state.competitorHeadCalls, 0);
  assert.equal(f.state.retryPublicationBatches, 1); assert.equal(f.state.publicationBatches, 1);
  assert.ok(f.state.streamReads > 0); assert.equal(f.writer.count('put'), 1); preserved(f);

  const beforeReplay = snapshot(f.f), priorReads = f.statements.length, priorCalls = f.calls.length;
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError);
  await assert.rejects(api.claimGuestImageResult(f.f.request, f.f.env, f.ready), claimError);
  assert.equal(f.statements.length, priorReads); assert.equal(f.calls.length, priorCalls);
  assert.deepEqual(snapshot(f.f), beforeReplay, 'spent request and retired ready cannot replay');

  // A completed graph has its own authenticated reader; retry never redirects.
  await assert.rejects(api.retryGuestImageResultClaim(freshRequest(t, f), f.f.env, input), claimError);
  assert.equal(f.state.getCalls, 1); assert.equal(f.state.headCalls, 2);
  assert.equal(f.state.retryPublicationBatches, 1); assert.deepEqual(snapshot(f.f), beforeReplay);
  const read = await custody.readGuestImageResultCustody(freshRequest(t, f), f.f.env, { sessionId: row.session_id, custodyId: row.custody_id });
  assert.ok(read); assert.deepEqual(read.completedReview, claimed.completedReview);
  assert.deepEqual(snapshot(f.f), beforeReplay, 'completed reader is read-only'); preserved(f);
});

test('fresh ready retry failed admission spends that Request before any second attempt', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f), request = freshRequest(t, f);
  const before = snapshot(f.f), wrong = structuredClone(input); wrong.selector.manifestDigest = changedHex(wrong.selector.manifestDigest);
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, wrong), claimError);
  const count = f.statements.length;
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError);
  assert.equal(f.statements.length, count); assert.equal(f.state.getCalls, 0); assert.equal(f.state.headCalls, 0);
  noRetryWrites(f, before); preserved(f);
});

for (const fault of ['foreign-owner', 'wrong-possession', 'redacted-source']) test('fresh ready retry refuses ' + fault + ' before destination access', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f);
  const request = freshRequest(t, f, fault === 'foreign-owner' ? { userId: payer } : {});
  if (fault === 'wrong-possession') input.proof.claimToken = changedHex(input.proof.claimToken);
  if (fault === 'redacted-source') {
    // Explicit negative fixture mutation, outside the application DB adapter.
    const descriptor = JSON.parse(rows(f.f, attemptTable)[0].descriptor_json), id = descriptor.manifest.privateContents[0].contentId;
    f.f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(), id);
    assert.notEqual(rows(f.f, 'private_content').find(row => row.content_id === id).redacted_at, null);
  }
  const before = snapshot(f.f);
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input),
    fault === 'wrong-possession' ? { message: 'guest_custody_proof_unavailable' } : claimError);
  assert.equal(f.state.getCalls, 0); assert.equal(f.state.headCalls, 0); noRetryWrites(f, before);
  assert.equal(f.writer.count('put'), 1); assert.equal(f.writer.count('get'), 1);
  if (fault !== 'redacted-source') preserved(f);
});

test('fresh ready retry cannot extend the original wall-clock expiry', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f), request = freshRequest(t, f);
  const row = rows(f.f, attemptTable)[0], lease = JSON.parse(row.lease_snapshot_json), before = snapshot(f.f);
  const expiry = Math.min(row.source_expires_at_ms, lease.expires_at_ms);
  // Only Date.now is replaced for this negative; native D1 clock and all real
  // promise timers remain untouched, and restoration precedes fixture cleanup.
  const clock = t.mock.method(Date, 'now', () => expiry + 1);
  try { await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError); }
  finally { clock.mock.restore(); }
  assert.equal(f.state.getCalls, 0); assert.equal(f.state.headCalls, 0); noRetryWrites(f, before); preserved(f);
});

for (const copyMode of ['reserved', 'unknown']) test('fresh ready retry rejects a genuine original ' + copyMode + ' copy outcome', options, async t => {
  const f = await readyFixture(t, { freshRetry: true, copyMode }), input = retryInput(f), request = freshRequest(t, f), before = snapshot(f.f);
  assert.equal(f.ready, undefined);
  assert.equal(rows(f.f, attemptTable)[0].state, copyMode === 'reserved' ? 'reserved' : 'writing');
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError);
  assert.equal(f.state.getCalls, 0); assert.equal(f.state.headCalls, 0); noRetryWrites(f, before);
  assert.equal(f.writer.count('put'), copyMode === 'reserved' ? 0 : 1); assert.equal(f.writer.count('get'), 0);
});

for (const fault of ['changed-hash', 'changed-metadata', 'verification-version', 'publication-version']) test('fresh ready retry rejects ' + fault + ' without publication', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f), request = freshRequest(t, f), before = snapshot(f.f);
  if (fault === 'changed-hash') f.state.getTransform = value => ({ ...value, bytes: sameImageWithDifferentHash(value.bytes) });
  if (fault === 'changed-metadata') f.state.getTransform = value => ({ ...value, metadata: { ...value.metadata, writerNonce: 'changed-writer-nonce' } });
  if (fault === 'verification-version' || fault === 'publication-version') {
    const targetHead = fault === 'verification-version' ? 1 : 2;
    f.state.headTransform = value => f.state.headCalls === targetHead ? { ...value, version: value.version + '-changed' } : value;
  }
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError);
  assert.equal(f.state.getCalls, 1);
  assert.equal(f.state.headCalls, fault === 'publication-version' ? 2 : fault === 'verification-version' ? 1 : 0);
  noRetryWrites(f, before); preserved(f);
});

test('fresh ready retry loses to a native cleanup fence without another write or deletion', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f), request = freshRequest(t, f);
  let fenced;
  f.state.beforeHead = () => {
    assert.equal(f.state.headCalls, 1); assert.equal(fenced, undefined);
    const row = rows(f.f, attemptTable)[0]; assert.equal(row.state, 'ready');
    // The negative fixture owns this real trigger-checked competing transition.
    // Neither the retry path nor this test performs physical cleanup/deletion.
    f.f.sqlite.prepare("UPDATE experience_guest_image_result_copy_attempts SET state='cleanup_pending',row_version=row_version+1,updated_at_ms=? WHERE attempt_id=? AND state='ready'")
      .run(Math.max(Date.now(), row.updated_at_ms), row.attempt_id);
    assert.equal(rows(f.f, attemptTable)[0].state, 'cleanup_pending'); fenced = snapshot(f.f);
  };
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError);
  assert.ok(fenced); assert.equal(f.state.getCalls, 1); assert.equal(f.state.headCalls, 1);
  noRetryWrites(f, fenced); preserved(f);
});

test('fresh ready retry loses to a still-live original owner publication without a second candidate', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f);
  // Only this race deliberately keeps the original owner live. The mandatory
  // retry positive above aborts it before constructing the fresh request.
  const request = freshRequest(t, f, { retireOriginal: false });
  let winner, published;
  f.state.beforeGet = async () => {
    assert.equal(f.f.request.signal.aborted, false); f.state.competing = true;
    try { winner = await api.claimGuestImageResult(f.f.request, f.f.env, f.ready); published = snapshot(f.f); }
    finally { f.state.competing = false; }
  };
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError);
  assert.equal(winner.status, 'claimed'); assert.ok(published);
  assert.equal(f.state.getCalls, 1); assert.equal(f.state.headCalls, 1); assert.equal(f.state.competitorHeadCalls, 1);
  assert.equal(f.state.publicationBatches, 1); assert.equal(f.state.retryPublicationBatches, 0);
  assert.deepEqual(snapshot(f.f), published, 'the losing fresh retry makes no additional change'); preserved(f);
  const row = rows(f.f, 'experience_guest_image_result_custodies')[0];
  const read = await custody.readGuestImageResultCustody(freshRequest(t, f), f.f.env, { sessionId: row.session_id, custodyId: row.custody_id });
  assert.ok(read); assert.deepEqual(read.completedReview, winner.completedReview); assert.deepEqual(snapshot(f.f), published);
});

test('fresh ready retry accounts complete collector ACK extras including own undefined values', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f), request = freshRequest(t, f), before = snapshot(f.f);
  let reached = 0;
  f.state.readTransform = (result, { sql, method }) => {
    if (method !== 'all' || !sql.startsWith('SELECT type,name,tbl_name,sql FROM main.sqlite_schema') || !sql.endsWith('LIMIT 513')) return result;
    reached++; assert.equal(reached, 1); assert.ok(Array.isArray(result.results));
    // This unchanged native catalog plus extra own data exceeds the explicit
    // retained 16KiB ACK metadata capacity, despite JSON dropping undefined.
    return { ...result, deniedOwnUndefined: Object.fromEntries(Array.from({ length: 1500 }, (_, index) => ['field' + index, undefined])) };
  };
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError);
  assert.equal(reached, 1); assert.equal(f.state.getCalls, 0); assert.equal(f.state.headCalls, 0);
  noRetryWrites(f, before); preserved(f);
});

test('fresh ready retry refuses retained proof ACK sparse own-index substitution', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), input = retryInput(f), request = freshRequest(t, f), before = snapshot(f.f);
  let reached = 0;
  f.state.batchTransform = (result, { items, publication }) => {
    if (publication || items.length <= 3 || !items.every(item => item.sql.startsWith('SELECT CASE WHEN (')
      && item.sql.endsWith(') THEN 1 ELSE 0 END AS current'))
      || !items.some(item => item.sql.includes('experience_guest_image_result_copy_attempts'))) return result;
    reached++; assert.equal(reached, 1); assert.equal(result.length, items.length);
    const sparse = [...result]; delete sparse[0]; sparse['4294967295'] = result[0]; return sparse;
  };
  await assert.rejects(api.retryGuestImageResultClaim(request, f.f.env, input), claimError);
  assert.equal(reached, 1); assert.equal(f.state.getCalls, 0); assert.equal(f.state.headCalls, 0);
  noRetryWrites(f, before); preserved(f);
});

test('genuine claim publication SQL fits the five accepted offline SQLite limits', { timeout: 300000 }, async t => {
  assert.equal(typeof process.env.TMPDIR, 'string'); assert.ok(isAbsolute(process.env.TMPDIR));
  assert.equal(typeof process.env.FORMA_SQLITE_PYTHON, 'string'); assert.ok(isAbsolute(process.env.FORMA_SQLITE_PYTHON));
  const temporaryRoot = realpathSync(process.env.TMPDIR);
  const f = await readyFixture(t);
  let emitted = null, claimStatus = null;
  f.state.beforeBatch = ({ items, publication }) => {
    if (!publication) return;
    assert.equal(emitted, null, 'one exact publication capture');
    // Capture actual constructor text and order; never copy its row bindings.
    emitted = items.map((item, index) => ({ ordinal: index + 1, sql: item.sql }));
  };
  try {
    const claimed = await api.claimGuestImageResult(f.f.request, f.f.env, f.ready);
    claimStatus = claimed.status; assert.equal(claimStatus, 'claimed');
    assert.equal(f.state.publicationBatches, 1); assert.ok(emitted && emitted.length > 0 && emitted.length <= 511);
    preserved(f);
  } finally {
    // Offline subprocess work belongs to the test, after the original request
    // and its guards retire. The application's thirty-second owner is unchanged.
    f.f.controller.abort(); f.close();
  }
  assert.equal(f.f.request.signal.aborted, true);
  const rank = { table: 0, index: 1, view: 2, trigger: 3 };
  const schema = f.initial.schema.filter(row => row.sql && !row.name.startsWith('sqlite_'))
    .sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name)).map(row => row.sql);
  const forms = [], bySql = new Map();
  const statements = emitted.map(({ ordinal, sql }) => {
    if (!bySql.has(sql)) { bySql.set(sql, forms.length); forms.push({ form: forms.length, sql, ordinals: [] }); }
    const form = bySql.get(sql); forms[form].ordinals.push(ordinal); return { ordinal, form };
  });
  const directory = mkdtempSync(join(temporaryRoot, 'guest-image-claim-final-sql-'));
  const limits = { expressionDepth: 100, functionArguments: 32, parameters: 100, sqlBytes: 100000, compoundSelect: 5 };
  const evidence = { version: 1, claimStatus, ownerRetired: true, priorNativeObservation: { publicationStatements: 303 },
    publicationStatements: emitted.length, uniqueSql: forms.length, limits, bindingsIncluded: false, schemaStatements: schema.length };
  const write = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  // Persist the whole source constructor before the first subprocess. Normal
  // prepare errors remain attributable to form and original ordinal without
  // another claim invocation; no target statement is executed by EXPLAIN.
  write('schema.json', schema); write('statements.json', { evidence, statements, forms });
  t.diagnostic(JSON.stringify({ phase: 'offline-claim-sql-captured', directory, ...evidence }));
  const results = [];
  for (const form of forms) {
    let compiled;
    try {
      compiled = compileSqliteExpressionDepth(null, form.sql, { schema, functions: [], limit: limits.expressionDepth,
        queryLimits: { functionArguments: limits.functionArguments, parameters: limits.parameters, sqlBytes: limits.sqlBytes } });
    } catch (error) {
      const failure = { form: form.form, ordinals: form.ordinals, ok: false, compilerException: String(error) };
      write(`compile-${String(form.form).padStart(3, '0')}.json`, failure);
      write('summary.json', { ...evidence, complete: false, results: [...results, failure] });
      throw error;
    }
    const result = { form: form.form, ordinals: form.ordinals, ...compiled };
    results.push(result); write(`compile-${String(form.form).padStart(3, '0')}.json`, result);
  }
  const failures = results.filter(result => !result.ok);
  write('summary.json', { ...evidence, complete: true, results, failedForms: failures.map(result => result.form) });
  t.diagnostic(JSON.stringify({ phase: 'offline-claim-sql-compiled', directory, publicationStatements: emitted.length,
    uniqueSql: forms.length, failures: failures.map(({ form, ordinals, error }) => ({ form, ordinals, error })) }));
  assert.equal(results.length, forms.length);
  assert.deepEqual(failures, [], 'every emitted unique final statement must fit all five existing limits; see ' + directory);
});

// Actual pure constructor, genuine captured native source, explicitly inert
// mock retention receipts. This is not a native preparation or publication and
// does not cover the core's separate max-selection or one-millisecond ceiling.
test('inert candidate receipts preserve strict creation ordering at the one-millisecond boundary', options, async t => {
  const f = await readyFixture(t, { freshRetry: true }), before = snapshot(f.f);
  const inventory = await import('../worker/experience-guest-image-result-inventory.ts');
  const candidate = await import('../worker/experience-guest-image-result-claim.ts');
  f.f.controller.abort();
  const controller = new AbortController(); fixtureClosers.get(t).push(() => controller.abort());
  const request = new Request(f.f.request.url, { method: f.f.request.method,
    headers: new Headers(f.f.request.headers), signal: controller.signal });
  let data, draft;
  try {
    const seed = await inventory.inspectRetainedGuestImageResultReady(request, f.f.env, retryInput(f));
    ({ data } = inventory.takeGuestImageResultRetainedReadySeed(request, f.f.env, seed));
    draft = await candidate.draftGuestImageResultClaimCandidate({ source: data.source,
      descriptor: data.descriptor, destinationHead: 0 });
  } finally { controller.abort(); }
  assert.equal(f.f.request.signal.aborted, true); assert.equal(request.signal.aborted, true);
  const B = data.row.updated_at_ms + 1;
  assert.ok(Number.isSafeInteger(B)); assert.ok(B + 2 < Math.min(data.lease.expires_at_ms, data.row.source_expires_at_ms));
  const iso = value => new Date(value).toISOString();
  const receipts = draft.bodies.map(body => ({ contentId: body.contentId,
    createdAt: iso(B), expiresAt: iso(B + 30 * 86_400_000) }));
  const originalReceipts = structuredClone(receipts);
  const verifyCandidate = (value, expectedTime, supplied) => {
    assert.equal(value.lineage.canonical.recordedAt, iso(expectedTime));
    assert.equal(value.lineage.canonical.occurredAt, iso(expectedTime));
    for (const event of value.events) {
      assert.equal(event.recordedAt, iso(expectedTime)); assert.equal(event.occurredAt, iso(expectedTime));
    }
    for (const mapping of ['contextMapping', 'saveMapping', 'stageMapping', 'resultMapping'])
      assert.equal(value.afterGraph[mapping].created_at_ms, expectedTime);
    assert.equal(value.afterGraph.revokedAtMs, expectedTime);
    assert.equal(value.afterGraph.privateContents.length, 5);
    for (const [index, row] of value.afterGraph.privateContents.entries()) {
      assert.equal(row.content_id, supplied[index].contentId);
      assert.equal(row.created_at, supplied[index].createdAt); assert.equal(row.expires_at, supplied[index].expiresAt);
    }
    const copies = [...value.afterGraph.stageCopies, ...value.afterGraph.resultCopies];
    assert.equal(copies.length, 5);
    for (const [index, row] of copies.entries()) {
      assert.equal(row.content_id, supplied[index].contentId);
      assert.equal(row.created_at, supplied[index].createdAt); assert.equal(row.expires_at, supplied[index].expiresAt);
    }
  };
  verifyCandidate(await candidate.finishGuestImageResultClaimCandidate(draft, receipts, B), B, receipts);
  assert.deepEqual(receipts, originalReceipts);
  // Each ordinal independently contradicts raw B while permitting coherent T.
  for (let index = 0; index < 5; index++) {
    const boundary = receipts.map((receipt, ordinal) => ({ ...receipt,
      ...(ordinal === index ? { createdAt: iso(B + 1) } : {}) }));
    const retained = structuredClone(boundary);
    await assert.rejects(candidate.finishGuestImageResultClaimCandidate(draft, boundary, B), claimError);
    verifyCandidate(await candidate.finishGuestImageResultClaimCandidate(draft, boundary, B + 1), B + 1, boundary);
    assert.deepEqual(boundary, retained, 'constructor never rewrites mocked receipt evidence');
  }
  const tooLate = receipts.map((receipt, index) => ({ ...receipt, ...(index === 4 ? { createdAt: iso(B + 2) } : {}) }));
  await assert.rejects(candidate.finishGuestImageResultClaimCandidate(draft, tooLate, B + 1), claimError);
  await assert.rejects(candidate.finishGuestImageResultClaimCandidate(draft, receipts, data.lease.expires_at_ms), claimError);
  assert.deepEqual(receipts, originalReceipts);
  assert.equal(f.state.getCalls, 0); assert.equal(f.state.headCalls, 0); assert.equal(f.state.publicationBatches, 0);
  noRetryWrites(f, before); preserved(f);
});

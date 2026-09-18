import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { completedResultFixture, guardInventory, inspectGuestImageResultInventory, guestImageResultInventoryData,
  assertGuestImageResultInventoryCurrent, compileResultInventorySql, rows, snapshot, request, payer, nativeEvents } from './guest-image-result-inventory-fixture.mjs';
import { admittedRunFixture, runGuestImage, assertNativeCompletion } from './guest-image-run-fixture.mjs';
import { ownerMediaNamespace } from '../../src/model/media-ownership.ts';

export { rows, snapshot, request, payer, nativeEvents, compileResultInventorySql, assertGuestImageResultInventoryCurrent };
export const sha = value => createHash('sha256').update(value).digest('hex');
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

/** Independent seed oracle: check literal PNG fields, inflated size and the first
 * and last pixel of each fixture row with Node zlib. It does not validate CRCs
 * or every pixel and never invokes the application asset inspector. */
export function knownPngOracle(input) {
  const bytes = Buffer.from(input); assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR'); assert.equal(bytes.readUInt32BE(8), 13);
  assert.equal(bytes.readUInt32BE(16), 1024); assert.equal(bytes.readUInt32BE(20), 1024);
  assert.deepEqual([...bytes.subarray(24, 29)], [8, 6, 0, 0, 0]);
  const compressed = []; let offset = 8, ended = false;
  while (offset < bytes.length) { const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + length + 12 <= bytes.length); if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12; if (type === 'IEND') { assert.equal(length, 0); ended = true; assert.equal(offset, bytes.length); } }
  assert.ok(ended && compressed.length); const pixels = inflateSync(Buffer.concat(compressed)); assert.equal(pixels.length, (1024 * 4 + 1) * 1024);
  for (let y = 0; y < 1024; y++) { const row = y * (1024 * 4 + 1); assert.equal(pixels[row], 0);
    assert.deepEqual([...pixels.subarray(row + 1, row + 5)], [36, 120, 80, 255]);
    assert.deepEqual([...pixels.subarray(row + 1 + 1023 * 4, row + 1 + 1024 * 4)], [36, 120, 80, 255]); }
  return { bytes: new Uint8Array(bytes), sha256: sha(bytes), size: bytes.length, width: 1024, height: 1024 };
}

export async function createMediaInventory(f, req = f.request, deadline) {
  f.request = req; f.inventory = await inspectGuestImageResultInventory(req, f.env, { proof: f.proof }, deadline);
  f.inventoryData = guestImageResultInventoryData(req, f.env, f.inventory); return f.inventory;
}

/** All positive custody/finance/events use unchanged real native producers.
 * imageTransform alters only an already-qualified local fake provider response;
 * it does not change a persisted body, storage receipt, hash or authority. */
export async function completedMediaFixture(t, { inventory = true, imageTransform, inventoryDeadline, ...options } = {}) {
  let f;
  if (imageTransform) {
    f = await admittedRunFixture(t, options);
    f.provider.beforeResponse = (call, response) => {
      if (call.stage !== 'image') return;
      const original = response.json.bind(response);
      t.mock.method(response, 'json', async () => { const json = await original(), originalBytes = Buffer.from(json.data[0].b64_json, 'base64');
        knownPngOracle(originalBytes); const changed = Buffer.from(imageTransform(new Uint8Array(originalBytes)));
        assert.ok(changed.length > 0); f.provider.imageBytes = changed; json.data[0].b64_json = changed.toString('base64'); return json; });
    };
    f.completedRun = await runGuestImage(f.request, f.env, f.runInput); assert.equal(f.completedRun.status, 'completed');
    f.completed = assertNativeCompletion(f);
  } else f = await completedResultFixture(t, options);
  const { body, slot } = f.completed, bytes = new Uint8Array(f.provider.imageBytes), hash = sha(bytes);
  const key = `${ownerMediaNamespace(f.session.guestSubject)}/generated/${body.generation_id}.png`;
  assert.equal(rows(f, 'output_native_storage_writes')[0].storage_key, key);
  const metadata = { ownerId: f.session.guestSubject, artifactId: body.generation_id, model: body.model_id, source: 'provider-image-api',
    sha256: hash, mimeType: 'image/png', generationId: body.generation_id, provider: body.provider,
    adapter: body.adapter_version, providerRequestId: body.provider_request_id ?? '', outputNativeStorage: '1', outputScopeKey: slot.scope_key,
    outputSlotId: slot.slot_id, outputOwnerId: f.session.guestSubject, outputDocumentId: f.session.documentId, outputSha256: hash };
  const stored = f.storage.objects.get(key); assert.ok(stored); assert.deepEqual(stored.metadata, metadata); assert.equal(stored.contentType, 'image/png');
  assert.deepEqual(new Uint8Array(stored.bytes), bytes); assert.equal(rows(f, 'cost_budget_reservations')[0].used_microusd, 4200);
  if (!imageTransform) knownPngOracle(bytes);
  f.mediaOracle = { key, bytes, sha256: hash, size: bytes.length, width: 1024, height: 1024, metadata, httpMetadata: { contentType: 'image/png' } };
  if (inventory) await createMediaInventory(f, f.request, inventoryDeadline);
  return f;
}

const receivers = new WeakMap();
function metadataWriter(owner, value, state) {
  return function (headers) {
    try { assert.equal(this, owner, 'preserve native object method receiver'); }
    catch (error) { state.violations.push(String(error)); throw error; }
    state.metadataMethodCalls++; for (const [key, item] of Object.entries(value.headers)) headers.set(key, item);
  };
}
class SyntheticR2Object {
  constructor(value, state) {
    receivers.set(this, { value, state });
    Object.defineProperty(this, 'writeHttpMetadata', { value: metadataWriter(this, value, state) });
  }
  get key() { return receivers.get(this).value.key; }
  get version() { return receivers.get(this).value.version; }
  get size() { return receivers.get(this).value.size; }
  get etag() { return receivers.get(this).value.etag; }
  get httpEtag() { return receivers.get(this).value.httpEtag; }
  get uploaded() { return receivers.get(this).value.uploaded; }
  get customMetadata() { return receivers.get(this).value.metadata; }
  get httpMetadata() { return receivers.get(this).value.httpMetadata; }
}
class SyntheticR2Body extends SyntheticR2Object {
  get body() { return receivers.get(this).value.body; }
}

/** Persistent guards wrap the existing read-only inventory fixture. GET/HEAD
 * alone are allowed on the exact recorded key; objects retain real-style method
 * receivers/prototype getters. This synthetic shape is not workerd evidence. */
export function installMediaReadGuards(f, t, { database = true, snapshotDatabase = true } = {}) {
  const guard = guardInventory(f, t, { database, snapshotDatabase }); const oracle = f.mediaOracle;
  const base = { key: oracle.key, size: oracle.size, version: 'synthetic-original-version', etag: 'synthetic-original-etag',
    httpEtag: '"synthetic-original-etag"', uploaded: new Date(f.completed.event.recordedAt), metadata: structuredClone(oracle.metadata),
    httpMetadata: { contentType: 'image/png' }, headers: { 'content-type': 'image/png' } };
  const state = { get: structuredClone(base), head: structuredClone(base), calls: [], violations: [], reads: 0, cancellations: 0,
    metadataMethodCalls: 0, chunks: [], beforeGet: null, beforeHead: null, getResult: undefined, headResult: undefined, bodyFactory: null };
  const conformance = callback => { try { return callback(); } catch (error) { state.violations.push(String(error)); throw error; } };
  state.bodyFactory = () => { let offset = 0; return new ReadableStream({ pull(controller) { state.reads++;
    if (offset === oracle.bytes.length) { controller.close(); return; }
    const chunk = oracle.bytes.slice(offset, Math.min(offset + 4096, oracle.bytes.length)); offset += chunk.length;
    state.chunks.push(chunk); controller.enqueue(chunk); }, cancel() { state.cancellations++; } }, { highWaterMark: 0 }); };
  f.env.MEDIA.get = async function (key, options) {
    conformance(() => { assert.equal(this, f.env.MEDIA); assert.equal(key, oracle.key); assert.equal(options, undefined);
      assert.equal(state.calls.filter(call => call === 'get').length, 0, 'one read attempt per original inventory'); });
    state.calls.push('get'); await state.beforeGet?.();
    if (state.getResult !== undefined) return state.getResult;
    return new SyntheticR2Body({ ...state.get, body: state.bodyFactory() }, state);
  };
  f.env.MEDIA.head = async function (key, options) {
    conformance(() => { assert.equal(this, f.env.MEDIA); assert.equal(key, oracle.key); assert.equal(options, undefined);
      assert.equal(state.calls.filter(call => call === 'head').length, 0, 'one final metadata read'); });
    state.calls.push('head'); await state.beforeHead?.();
    if (state.headResult !== undefined) return state.headResult;
    return new SyntheticR2Object(state.head, state);
  };
  const assertUntouched = () => { assert.deepEqual(state.violations, []); guard.assertUntouched(); };
  t.after(() => assert.deepEqual(state.violations, [], 'native catches cannot swallow wrong R2 key/method/receiver/replay'));
  return { state, statements: guard.statements, assertUntouched, close() { try { assertUntouched(); } finally { guard.close(); } } };
}

const compiles = new Map();
export async function createMediaSqlQualifier(schema) {
  const frozen = structuredClone(schema), records = [], failures = [], schemaHash = sha(JSON.stringify(frozen));
  return {
    qualify(sql, bindings) {
      try { assert.ok(Array.isArray(bindings) && bindings.length <= 100); assert.ok(Buffer.byteLength(sql) <= 100000);
        const key = sha(JSON.stringify([frozen, sql])); let compiled = compiles.get(key);
        if (!compiled) { compiled = compileResultInventorySql(frozen, sql); assert.equal(compiled.ok, true, compiled.error); compiles.set(key, compiled); }
        assert.equal(compiled.parameterCount, bindings.length); assert.equal(compiled.statementBytes, Buffer.byteLength(sql));
        assert.equal(compiled.compoundSelectLimit, 5); records.push({ sqlSha256: sha(sql), schemaHash, bindings: bindings.length, sqlBytes: Buffer.byteLength(sql), ...compiled });
        return compiled;
      } catch (error) { failures.push(String(error)); throw error; }
    },
    metrics() { return { statements: records.length, uniqueSql: new Set(records.map(row => row.sqlSha256)).size,
      maxBindings: Math.max(0, ...records.map(row => row.bindings)), maxSqlBytes: Math.max(0, ...records.map(row => row.sqlBytes)), failures: [...failures] }; },
    assertVerified() { assert.deepEqual(failures, []); assert.ok(records.length); },
  };
}

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises';
import { test as nativeTest } from 'node:test';
import { promiseHooks } from 'node:v8';
import { completedMediaFixture, createMediaInventory, installMediaReadGuards, knownPngOracle, deferred, sha, snapshot, request } from './helpers/guest-image-result-media-fixture.mjs';
// The unchanged fixture initializes registerOutputSourceImports before loading
// these native graph entry points, matching the accepted inventory test setup.
const [{ readGuestImageResultMedia, guestImageResultMediaReview, consumeGuestImageResultMedia }, { inspectOutputAsset },
  { guestImageResultMediaOperation }] = await Promise.all([
  import('../worker/experience-guest-image-result-media.ts'), import('../src/model/output-asset-inspection.ts'),
  import('../worker/experience-guest-image-result-media-operation.ts'),
]);

const test = (name, options, fn) => typeof options === 'function' ? nativeTest(name, { timeout: 20000 }, options) : nativeTest(name, options, fn);
const read = f => readGuestImageResultMedia(f.request, f.env, f.inventory);
const consume = (f, token, callback) => consumeGuestImageResultMedia(f.request, f.env, token, callback);
const refusal = error => { assert.match(String(error), /(?:guest_image_result_(?:media|inventory)_|guest_image_output_retirement_unavailable|guest_custody_database_changed)/u); return true; };
const rejected = promise => assert.rejects(promise, refusal);
const observed = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
async function promptly(promise, milliseconds = 500) { const result = await Promise.race([promise, delay(milliseconds).then(() => { throw Error('foreground remained pending after cancellation'); })]); return result; }
async function drain() { for (let index = 0; index < 8; index++) await turn(); }
// Observe the actual unchanged inspector promise supplied to operation.use.
// The public cancellation race and a fixed number of event-loop ticks cannot
// establish when the real hashing plus decompression consumer has settled.
function observeInspectorSettlement(t, f) {
  const operation = guestImageResultMediaOperation(f.request, f.env, f.inventory), prototype = Object.getPrototypeOf(operation), original = prototype.use;
  const ended = deferred(); let target, settled = 0;
  const stopHook = promiseHooks.createHook({ settled(promise) { if (promise === target) { settled++; ended.resolve(); } } });
  t.mock.method(prototype, 'use', function (bytes, work) {
    if (this !== operation) return original.call(this, bytes, work);
    return original.call(this, bytes, () => { assert.equal(target, undefined); target = work(); assert.ok(target instanceof Promise); return target; });
  });
  return { get settled() { return settled; }, async wait() {
    if (!target) return;
    let timer; try { await Promise.race([ended.promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('actual whole inspector promise did not settle')), 5000);
    })]); assert.equal(settled, 1); await turn(); } finally { clearTimeout(timer); }
  }, close: stopHook };
}
async function enterOrFail(entered, pending, label) {
  await Promise.race([entered.promise, pending.then(result => { throw Error(`${label}: reader settled before the intended gate: ${String(result.error ?? result.value)}`); })]);
}
const reviewFor = f => ({ version: 1, kind: 'guest-image-result-media', mimeType: 'image/png', sha256: f.mediaOracle.sha256,
  byteLength: f.mediaOracle.size, width: 1024, height: 1024, freshBytesVerified: true, custodyTransferred: false, publicReadAvailable: false });
async function cancelledFixture(t) { const f = await completedMediaFixture(t, { inventory: false }), controller = new AbortController();
  await createMediaInventory(f, new Request(f.request, { signal: controller.signal })); return { f, controller }; }
function capture(t, f, guard) {
  const statements = guard.statements, metrics = { statements: statements.length, uniqueSql: new Set(statements.map(row => row.sql)).size,
    maxBindings: Math.max(0, ...statements.map(row => row.bindings)), maxSqlBytes: Math.max(0, ...statements.map(row => row.sqlBytes)),
    get: guard.state.calls.filter(value => value === 'get').length, head: guard.state.calls.filter(value => value === 'head').length,
    reads: guard.state.reads, providerCallsDuringRead: 0, mutationsDuringRead: 0 };
  t.diagnostic(JSON.stringify(metrics));
  if (process.env.FORMA_RESULT_MEDIA_SQL_CAPTURE_DIR) { const rank = { table: 0, index: 1, view: 2, trigger: 3 };
    const schema = snapshot(f).schema.filter(row => row.sql && !row.name.startsWith('sqlite_'))
      .sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name)).map(row => row.sql);
    writeFileSync(join(process.env.FORMA_RESULT_MEDIA_SQL_CAPTURE_DIR, 'positive-media.json'), JSON.stringify({ schema, statements, metrics }, null, 2) + '\n', { flag: 'wx' }); }
}

// This single genuine byte-positive is the first runtime gate. Every other case
// is separately authorized only after it passes on reviewed, frozen sources.
test('positive original guest Image bytes are verified and consumed once without mutation', { timeout: 30000 }, async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t); let copy;
  try { const token = await read(f); assert.ok(Object.isFrozen(token)); assert.deepEqual(Reflect.ownKeys(token), []);
    const review = guestImageResultMediaReview(f.request, f.env, token); assert.ok(Object.isFrozen(review)); assert.deepEqual(review, reviewFor(f));
    for (const privateValue of [f.mediaOracle.key, f.session.guestSubject, f.session.claimToken, f.completed.body.provider_request_id])
      if (privateValue) assert.equal(JSON.stringify(review).includes(privateValue), false);
    const result = await consume(f, token, async (bytes, safe) => { copy = bytes; assert.notEqual(bytes.buffer, f.mediaOracle.bytes.buffer);
      assert.deepEqual(bytes, f.mediaOracle.bytes); assert.deepEqual(safe, review); assert.equal(knownPngOracle(bytes).sha256, review.sha256); return 'owned bytes checked'; });
    assert.equal(result, 'owned bytes checked'); assert.ok(copy.every(value => value === 0), 'owned consumer copy retires after actual settlement');
    assert.deepEqual(guard.state.calls, ['get', 'head']); assert.equal(guard.state.metadataMethodCalls, 2); assert.ok(guard.state.reads > 1);
    assert.equal(guard.statements.filter(row => row.method === 'batch').length, f.inventoryData.proof.length * 3, 'initial, final and consumption native proofs');
    guard.assertUntouched();
  } finally { capture(t, f, guard); guard.close(); }
});

// Test-only PNG reconstruction uses Node zlib plus an independent CRC routine;
// malformed values travel through the real local provider adapter and storage.
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const body = Buffer.concat([Buffer.from(type), Buffer.from(data)]), result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc32(body), result.length - 4); return result; }
function malformedPng(bytes, kind) {
  const input = Buffer.from(bytes); if (kind === 'CRC') { input[input.length - 1] ^= 1; return input; }
  const parts = []; let offset = 8; while (offset < input.length) { const size = input.readUInt32BE(offset), type = input.toString('ascii', offset + 4, offset + 8);
    parts.push({ type, data: input.subarray(offset + 8, offset + 8 + size) }); offset += size + 12; }
  if (kind === 'filter') { const raw = inflateSync(Buffer.concat(parts.filter(part => part.type === 'IDAT').map(part => part.data))); raw[0] = 5;
    return Buffer.concat([input.subarray(0, 8), chunk('IHDR', parts[0].data), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
  assert.equal(kind, 'dimensions'); const header = Buffer.from(parts[0].data); header.writeUInt32BE(1023, 0);
  const original = inflateSync(Buffer.concat(parts.filter(part => part.type === 'IDAT').map(part => part.data))), pixels = Buffer.alloc((1023 * 4 + 1) * 1024);
  for (let row = 0; row < 1024; row++) original.copy(pixels, row * (1023 * 4 + 1), row * (1024 * 4 + 1), row * (1024 * 4 + 1) + (1023 * 4 + 1));
  return Buffer.concat([input.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
for (const kind of ['CRC', 'filter', 'dimensions']) test(`authentic matching-hash provider PNG with bad ${kind} refuses byte proof`, async t => {
  const f = await completedMediaFixture(t, { imageTransform: bytes => malformedPng(bytes, kind) }), guard = installMediaReadGuards(f, t);
  try { assert.equal(f.inventoryData.manifest.object.contentSha256, sha(f.mediaOracle.bytes));
    assert.equal(f.mediaOracle.metadata.sha256, sha(f.mediaOracle.bytes));
    const direct = await inspectOutputAsset(f.mediaOracle.bytes, 'image.png'); assert.equal(direct.sha256, f.mediaOracle.sha256);
    if (kind === 'dimensions') { assert.equal(direct.status, 'inspected'); assert.deepEqual(direct.facts, { width: 1023, height: 1024 }); }
    else { assert.equal(direct.status, 'invalid'); assert.deepEqual(direct.errors, [kind === 'CRC' ? 'png_crc_mismatch' : 'invalid_png_filter']); }
    await rejected(read(f)); assert.deepEqual(guard.state.calls, ['get']); }
  finally { guard.close(); }
});

for (const stage of ['get', 'head']) for (const field of ['model', 'provider', 'adapter', 'providerRequestId'])
  test(`original producer ${field} is enforced on ${stage.toUpperCase()}`, async t => {
    const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t); guard.state[stage].metadata[field] += '-foreign';
    try { await rejected(read(f)); assert.deepEqual(guard.state.calls, stage === 'get' ? ['get'] : ['get', 'head']);
      if (stage === 'get') { assert.equal(guard.state.reads, 0); assert.ok(guard.state.cancellations >= 1); } }
    finally { guard.close(); }
  });

const metadataChanges = {
  'wrong original key': state => { state.get.key += '-other'; },
  'foreign owner': state => { state.get.metadata.ownerId = 'foreign-owner'; },
  'object ID substituted for generation ID': (state, f) => { state.get.metadata.artifactId = f.completed.body.object_id; },
  'foreign native slot': state => { state.get.metadata.outputSlotId += '-other'; },
  'foreign Document': state => { state.get.metadata.outputDocumentId += '-other'; },
  'organization sharing marker': state => { state.get.metadata.organizationId = 'org'; },
  'derived result marker': state => { state.get.metadata.derivedFromGenerationId = 'other'; },
  'custom metadata accessor': state => { Object.defineProperty(state.get.metadata, 'model', { enumerable: true, get() { throw Error('must not invoke custom metadata accessor'); } }); },
  'non-PNG content type': state => { state.get.headers['content-type'] = 'image/jpeg'; },
  'oversized custom metadata': state => { for (let index = 0; index < 5; index++) state.get.metadata[`extra${index}`] = 'a'.repeat(8192); },
  'late unknown metadata change': state => { state.head.metadata.extension = 'changed'; },
  'late HTTP header change': state => { state.head.headers['cache-control'] = 'public'; },
  'late object version': state => { state.head.version += '-other'; },
  'late object etag': state => { state.head.etag += '-other'; },
  'missing original object': state => { state.getResult = null; },
  'missing final object': state => { state.headResult = null; },
};
for (const [name, change] of Object.entries(metadataChanges)) test(`media metadata refuses ${name}`, async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t); change(guard.state, f);
  try { await rejected(read(f)); } finally { guard.close(); }
});
test('unchanged bounded extra metadata and HTTP headers retain complete equality', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t);
  for (const side of ['get', 'head']) { guard.state[side].metadata.originalExtension = 'preserved'; guard.state[side].headers['cache-control'] = 'private'; }
  try { const token = await read(f); await consume(f, token, async bytes => assert.deepEqual(bytes, f.mediaOracle.bytes)); }
  finally { guard.close(); }
});
for (const size of [0, NaN, 24000001]) test(`media refuses invalid declared byte count ${size} before reading`, async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t); guard.state.get.size = size;
  try { await rejected(read(f)); assert.equal(guard.state.reads, 0); } finally { guard.close(); }
});
for (const kind of ['underrun', 'overrun', 'wrong chunk', 'empty chunk']) test(`media stream refuses ${kind}`, async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t);
  guard.state.bodyFactory = () => new ReadableStream({ start(controller) {
    let bytes = f.mediaOracle.bytes.slice(); if (kind === 'underrun') bytes = bytes.slice(0, -1);
    if (kind === 'overrun') bytes = new Uint8Array(bytes.length + 1);
    controller.enqueue(kind === 'wrong chunk' ? 'not bytes' : kind === 'empty chunk' ? new Uint8Array() : bytes); controller.close(); } });
  try { await rejected(read(f)); assert.deepEqual(guard.state.calls, ['get']); } finally { guard.close(); }
});


test('media refuses a different structurally valid PNG with the original recorded hash', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t), input = Buffer.from(f.mediaOracle.bytes);
  const parts = []; let offset = 8;
  while (offset < input.length) { const length = input.readUInt32BE(offset), type = input.toString('ascii', offset + 4, offset + 8);
    parts.push({ type, data: input.subarray(offset + 8, offset + 8 + length) }); offset += length + 12; }
  const pixels = inflateSync(Buffer.concat(parts.filter(part => part.type === 'IDAT').map(part => part.data))); pixels[1] = 37;
  const different = new Uint8Array(Buffer.concat([input.subarray(0, 8), chunk('IHDR', parts[0].data), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
  try { const inspected = await inspectOutputAsset(different, 'image.png'); assert.equal(inspected.status, 'inspected');
    assert.deepEqual(inspected.facts, { width: 1024, height: 1024 }); assert.equal(inspected.sha256, sha(different)); assert.notEqual(inspected.sha256, f.mediaOracle.sha256);
    guard.state.get.size = different.length; guard.state.head.size = different.length;
    guard.state.bodyFactory = () => new ReadableStream({ start(controller) { controller.enqueue(different.slice()); controller.close(); } });
    await rejected(read(f)); assert.deepEqual(guard.state.calls, ['get']); }
  finally { guard.close(); }
});

test('source currentness is rechecked after the final HEAD before observation disclosure', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t, { snapshotDatabase: false }); let expected;
  guard.state.beforeHead = () => { f.sqlite.prepare('UPDATE private_content SET content=?,redacted_at=? WHERE content_id=?')
      .run('', '2000-01-01T00:00:00.000Z', f.prepared.plan.draftId); expected = snapshot(f); };
  try { await rejected(read(f)); assert.ok(expected); assert.deepEqual(snapshot(f), expected); assert.deepEqual(guard.state.calls, ['get', 'head']); }
  finally { guard.close(); }
});
test('private-body currentness is rechecked before a consumer receives any copy', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t, { snapshotDatabase: false }); let callbacks = 0;
  try { const token = await read(f); f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?')
      .run('2000-01-01T00:00:00.000Z', f.completed.body.output_ref); const expected = snapshot(f);
    await rejected(consume(f, token, async () => { callbacks++; })); assert.equal(callbacks, 0); assert.deepEqual(snapshot(f), expected); }
  finally { guard.close(); }
});

test('forged inventory and observation brands refuse before R2 or callback', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t); let callbacks = 0;
  try { for (const fake of [{}, structuredClone(f.inventory)]) { await rejected(readGuestImageResultMedia(f.request, f.env, fake));
      await rejected(consume(f, fake, async () => { callbacks++; })); }
    assert.equal(callbacks, 0); assert.deepEqual(guard.state.calls, []); }
  finally { guard.close(); }
});
for (const kind of ['request', 'environment', 'DB', 'bucket', 'headers']) test(`media ownership refuses changed ${kind}`, async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t), database = f.env.DB, bucket = f.env.MEDIA, original = f.request.headers.get('origin');
  try { if (kind === 'request') await rejected(readGuestImageResultMedia(request(), f.env, f.inventory));
    else if (kind === 'environment') await rejected(readGuestImageResultMedia(f.request, { ...f.env }, f.inventory));
    else { guard.state.beforeGet = () => { if (kind === 'DB') f.env.DB = { ...database }; if (kind === 'bucket') f.env.MEDIA = { ...bucket };
        if (kind === 'headers') f.request.headers.set('origin', 'https://other.example'); };
      await rejected(read(f)); }
    if (kind === 'request' || kind === 'environment') { const originalToken = await read(f); await consume(f, originalToken, async bytes => assert.deepEqual(bytes, f.mediaOracle.bytes)); }
  } finally { f.env.DB = database; f.env.MEDIA = bucket; if (original === null) f.request.headers.delete('origin'); else f.request.headers.set('origin', original); guard.close(); }
});
test('same inventory repeated read refuses before a second GET', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t);
  try { const token = await read(f); await rejected(read(f)); assert.deepEqual(guard.state.calls, ['get', 'head']);
    assert.throws(() => guestImageResultMediaReview(f.request, f.env, token), refusal); }
  finally { guard.close(); }
});
test('concurrent read cannot replenish the original operation allowance', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred();
  guard.state.beforeGet = async () => { entered.resolve(); await release.promise; };
  const first = observed(read(f));
  try { await entered.promise; await rejected(read(f)); const result = await promptly(first); assert.equal(result.ok, false); refusal(result.error);
    release.resolve(); await drain(); assert.deepEqual(guard.state.calls, ['get']); assert.equal(guard.state.reads, 0); assert.ok(guard.state.cancellations >= 1); }
  finally { release.resolve(); await first; await drain(); guard.close(); }
});
test('consumption attempt is one-shot even after callback success', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t); let count = 0;
  try { const token = await read(f); assert.equal(await consume(f, token, async () => ++count), 1);
    await rejected(consume(f, token, async () => ++count)); assert.equal(count, 1); }
  finally { guard.close(); }
});

test('original inventory monotonic deadline is not renewed by a later media read', async t => {
  const f = await completedMediaFixture(t, { inventory: false }); let clock = 1000;
  t.mock.method(performance, 'now', () => clock); await createMediaInventory(f, f.request, 31000); clock = 11000;
  const guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred();
  guard.state.beforeGet = async () => { entered.resolve(); await release.promise; }; const pending = observed(read(f));
  try { await entered.promise; clock = 31000; release.resolve(); const result = await promptly(pending);
    assert.equal(result.ok, false); refusal(result.error); await drain(); assert.deepEqual(guard.state.calls, ['get']); assert.equal(guard.state.reads, 0); }
  finally { release.resolve(); await pending; guard.close(); }
});
test('retained wall expiry ends media despite remaining monotonic time', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t); const expires = Date.parse(f.inventoryData.manifest.expiresAt);
  guard.state.beforeGet = () => { t.mock.method(Date, 'now', () => expires); };
  try { await rejected(read(f)); assert.deepEqual(guard.state.calls, ['get']); assert.equal(guard.state.reads, 0); }
  finally { guard.close(); }
});
for (const stage of ['get', 'head']) test(`pending ${stage.toUpperCase()} cannot delay cancellation or resume late success`, async t => {
  const { f, controller } = await cancelledFixture(t), guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred();
  guard.state[stage === 'get' ? 'beforeGet' : 'beforeHead'] = async () => { entered.resolve(); await release.promise; };
  const pending = observed(read(f));
  try { await entered.promise; controller.abort(); const result = await promptly(pending); assert.equal(result.ok, false); refusal(result.error);
    release.resolve(); await drain(); assert.deepEqual(guard.state.calls, stage === 'get' ? ['get'] : ['get', 'head']);
    if (stage === 'get') { assert.equal(guard.state.reads, 0); assert.ok(guard.state.cancellations >= 1); } }
  finally { release.resolve(); await pending; await drain(); guard.close(); }
});
test('nonresponsive body cancellation does not delay foreground refusal', async t => {
  const { f, controller } = await cancelledFixture(t), guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred(); let cancellations = 0;
  guard.state.bodyFactory = () => new ReadableStream({ pull() { entered.resolve(); return new Promise(() => {}); },
    cancel() { cancellations++; return release.promise; } }, { highWaterMark: 0 });
  const pending = observed(read(f));
  try { await entered.promise; controller.abort(); const result = await promptly(pending); assert.equal(result.ok, false); refusal(result.error); assert.ok(cancellations >= 1); }
  finally { release.resolve(); await pending; await drain(); guard.close(); }
});

test('controlled real digest return delay preserves input until its wrapper settles', async t => {
  const { f, controller } = await cancelledFixture(t), guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred();
  const inspection = observeInspectorSettlement(t, f), real = crypto.subtle.digest.bind(crypto.subtle); let held, gated = false;
  t.mock.method(crypto.subtle, 'digest', async (algorithm, data) => { const result = await real(algorithm, data);
    if (!gated && data instanceof Uint8Array && data.length === f.mediaOracle.size && data[0] === 137) { gated = true; held = data; entered.resolve(); await release.promise; }
    return result; }); const pending = observed(read(f));
  try { await enterOrFail(entered, pending, 'digest return delay'); assert.deepEqual(held, f.mediaOracle.bytes); controller.abort(); const result = await promptly(pending);
    assert.equal(result.ok, false); refusal(result.error); assert.equal(inspection.settled, 0);
    assert.deepEqual(held, f.mediaOracle.bytes, 'foreground refusal cannot erase input while the whole inspector still owns it');
    release.resolve(); await inspection.wait(); assert.ok(held.every(value => value === 0)); assert.deepEqual(guard.state.calls, ['get']); }
  finally { release.resolve(); await pending; try { await inspection.wait(); } finally { inspection.close(); guard.close(); } }
});
test('pending real PNG decompression settles before inspection input is retired', async t => {
  const { f, controller } = await cancelledFixture(t), guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred();
  const inspection = observeInspectorSettlement(t, f), Real = globalThis.DecompressionStream, digest = crypto.subtle.digest.bind(crypto.subtle); let held, gated = false;
  t.mock.method(crypto.subtle, 'digest', async (algorithm, data) => { if (data instanceof Uint8Array && data.length === f.mediaOracle.size && data[0] === 137) held = data;
    return digest(algorithm, data); });
  t.mock.method(globalThis, 'DecompressionStream', class { constructor(format) { assert.equal(format, 'deflate'); const native = new Real(format);
    // Native constructor mocking preserves a prototype with getter-only fields;
    // return the actual stream pair instead of assigning those inherited fields.
    return { writable: native.writable, readable: native.readable.pipeThrough(new TransformStream({ async transform(chunk, stream) {
      if (!gated) { gated = true; assert.ok(chunk.length > 0); entered.resolve(); await release.promise; } stream.enqueue(chunk); } })) }; } });
  const pending = observed(read(f));
  try { await enterOrFail(entered, pending, 'real decompression'); assert.deepEqual(held, f.mediaOracle.bytes); controller.abort(); const result = await promptly(pending);
    assert.equal(result.ok, false); refusal(result.error); assert.equal(inspection.settled, 0); assert.deepEqual(held, f.mediaOracle.bytes);
    release.resolve(); await inspection.wait(); assert.ok(held.every(value => value === 0)); assert.deepEqual(guard.state.calls, ['get']); }
  finally { release.resolve(); await pending; try { await inspection.wait(); } finally { inspection.close(); guard.close(); } }
});
test('pending consumer copy survives cancellation until actual consumer settlement', async t => {
  const { f, controller } = await cancelledFixture(t), guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred(); let copy;
  try { const token = await read(f), pending = observed(consume(f, token, async bytes => { copy = bytes; entered.resolve(); await release.promise; return 'late-private-result'; }));
    try { await entered.promise; controller.abort(); const result = await promptly(pending); assert.equal(result.ok, false); refusal(result.error);
      assert.deepEqual(copy, f.mediaOracle.bytes); release.resolve(); await drain(); assert.ok(copy.every(value => value === 0)); }
    finally { release.resolve(); await pending; await drain(); } }
  finally { guard.close(); }
});

test('operation constructor cannot mint authority without its private sentinel', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t), operation = guestImageResultMediaOperation(f.request, f.env, f.inventory);
  try { assert.throws(() => new operation.constructor(Symbol('forged'), f.request, f.env, f.inventory), refusal); assert.deepEqual(guard.state.calls, []); }
  finally { operation.stop(); guard.close(); }
});
test('aliased owned backing store refuses and waits for its genuine active consumer before zeroing', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t), operation = guestImageResultMediaOperation(f.request, f.env, f.inventory);
  const bytes = operation.own(new Uint8Array([7, 8, 9])), entered = deferred(), release = deferred();
  const pending = observed(operation.use(bytes, async () => { entered.resolve(); await release.promise; return true; }));
  try { await entered.promise; assert.throws(() => operation.own(new Uint8Array(bytes.buffer)), refusal);
    const result = await promptly(pending); assert.equal(result.ok, false); assert.deepEqual([...bytes], [7, 8, 9]);
    release.resolve(); await drain(); assert.deepEqual([...bytes], [0, 0, 0]); assert.deepEqual(guard.state.calls, []); }
  finally { release.resolve(); await pending; await drain(); operation.stop(); guard.close(); }
});


test('consumer result is refused when abort occurs at actual inner promise settlement', async t => {
  const { f, controller } = await cancelledFixture(t), guard = installMediaReadGuards(f, t); let stopHook = () => {}, target, settled = 0;
  try { const token = await read(f), operation = guestImageResultMediaOperation(f.request, f.env, f.inventory);
    const prototype = Object.getPrototypeOf(operation), original = prototype.use;
    t.mock.method(prototype, 'use', function (...args) { const pending = original.apply(this, args); if (this === operation) target = pending; return pending; });
    stopHook = promiseHooks.createHook({ settled(promise) { if (promise === target) { settled++; controller.abort(); } } });
    await rejected(consume(f, token, async () => 'must not escape the outer continuation')); assert.equal(settled, 1);
  } finally { stopHook(); guard.close(); }
});
test('consumer overriding its copy fill method cannot suppress intrinsic retirement', async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t); let copy, calls = 0;
  try { const token = await read(f); await consume(f, token, async bytes => { copy = bytes; bytes.fill = () => { calls++; return bytes; }; return true; });
    assert.equal(calls, 0); assert.ok(copy.every(value => value === 0)); }
  finally { guard.close(); }
});
for (const kind of ['DB rebind', 'wall expiry']) test(`cached media owner observed ${kind} cannot revive after restoration`, async t => {
  const f = await completedMediaFixture(t), guard = installMediaReadGuards(f, t), database = f.env.DB;
  const operation = guestImageResultMediaOperation(f.request, f.env, f.inventory), realNow = Date.now; let expired = true;
  try { if (kind === 'DB rebind') f.env.DB = { ...database };
    else t.mock.method(Date, 'now', () => expired ? Date.parse(f.inventoryData.manifest.expiresAt) : realNow());
    await rejected(read(f)); f.env.DB = database; expired = false;
    await rejected(read(f)); assert.deepEqual(guard.state.calls, []);
  } finally { f.env.DB = database; operation.stop(); guard.close(); }
});


test('stalled GET refuses at the remaining original inventory deadline without delivery', async t => {
  const f = await completedMediaFixture(t, { inventory: false }), deadline = performance.now() + 2000;
  await createMediaInventory(f, f.request, deadline); assert.ok(deadline - performance.now() > 750, 'fixture captures the original deadline with room to enter GET');
  await delay(Math.max(0, deadline - performance.now() - 500));
  const guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred(); let delivered = false;
  guard.state.beforeGet = async () => { entered.resolve(); await release.promise; delivered = true; };
  const pending = observed(read(f));
  try { await entered.promise; const result = await promptly(pending, Math.max(1, deadline - performance.now()) + 500);
    assert.equal(result.ok, false); refusal(result.error); assert.equal(delivered, false, 'GET still stalled at foreground deadline refusal');
    assert.ok(performance.now() >= deadline - 25); assert.ok(performance.now() < deadline + 500);
    release.resolve(); await drain(); assert.equal(delivered, true); assert.equal(guard.state.reads, 0); assert.deepEqual(guard.state.calls, ['get']); assert.ok(guard.state.cancellations >= 1); }
  finally { release.resolve(); await pending; await drain(); guard.close(); }
});
test('pending genuine native proof acknowledgement cancels before R2 and cannot continue after late delivery', async t => {
  const { f, controller } = await cancelledFixture(t), guard = installMediaReadGuards(f, t), entered = deferred(), release = deferred();
  const original = f.DB.batch; let batches = 0, delivered = false, nativeAck, nativeSettled = 0;
  const stopHook = promiseHooks.createHook({ settled(promise) { if (promise === nativeAck) nativeSettled++; } });
  f.DB.batch = function (statements) { nativeAck = (async () => { const results = await original.call(this, statements); batches++;
    assert.equal(results.length, f.inventoryData.proof.length); assert.ok(results.every(row => row.success === true && row.results.length === 1 && row.results[0].current === 1));
    entered.resolve(); await release.promise; delivered = true; return results; })(); return nativeAck; };
  const pending = observed(read(f));
  try { await entered.promise; const observedReads = guard.statements.length; controller.abort(); const result = await promptly(pending);
    assert.equal(result.ok, false); refusal(result.error); assert.equal(delivered, false); assert.equal(nativeSettled, 0); assert.deepEqual(guard.state.calls, []);
    release.resolve(); await drain(); assert.equal(delivered, true); assert.equal(nativeSettled, 1, 'actual delayed native ACK promise settled after retirement');
    assert.equal(batches, 1); assert.equal(guard.statements.length, observedReads); assert.deepEqual(guard.state.calls, []); }
  finally { release.resolve(); await pending; await drain(); stopHook(); f.DB.batch = original; guard.close(); }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = createRequire(require.resolve('wrangler'))('esbuild');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let bundle, serial = 0;
async function runtime() {
  bundle ??= build({ stdin: { contents: `export * from './worker/selected-output-share-mp3-operation.ts';
    export * from './worker/selected-output-share-mp3-projection.ts';
    export * from './src/model/selected-output-share-audio.ts';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
    plugins: [{ name: 'pinned-local-wasm', setup(builder) {
      builder.onLoad({ filter: /decoder\.wasm$/ }, async ({ path }) => ({ loader: 'js', contents:
        `export default new WebAssembly.Module(Buffer.from(${JSON.stringify((await readFile(path)).toString('base64'))},'base64'));` }));
    } }] });
  return import(`data:text/javascript;base64,${Buffer.from((await bundle).outputFiles[0].text).toString('base64')}#${serial++}`);
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const expected = source => ({ sha256: hash(source), byteLength: source.length, mimeType: 'audio/mpeg', recipe: 'forma.audio.instrumental-20@1' });
const sourceBytes = async () => new Uint8Array(await readFile(new URL('./fixtures/audio-share-mp3/stereo-20.mp3', import.meta.url)));

test('opaque single operation, real abort, local source ownership and finish are closed', async () => {
  const m = await runtime(), c = new AbortController();
  assert.equal(m.acquireSelectedOutputShareMp3Operation({}), null);
  const op = m.acquireSelectedOutputShareMp3Operation(c.signal); assert(op);
  assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
  assert.throws(() => m.selectedOutputShareMp3OperationSignal({}));
  const signal = m.selectedOutputShareMp3OperationSignal(op), source = new Uint8Array(1_000_000).fill(7);
  m.ownSelectedOutputShareMp3Source(op, source);
  assert.throws(() => m.ownSelectedOutputShareMp3Source(op, new Uint8Array(1)));
  m.finishSelectedOutputShareMp3Operation(op); m.finishSelectedOutputShareMp3Operation(op);
  assert(signal.aborted); assert(source.every(byte => byte === 0));
  assert.throws(() => m.assertSelectedOutputShareMp3OperationCurrent(op));
  const next = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal); assert(next); m.finishSelectedOutputShareMp3Operation(next);
});

test('stopped thunk and late async disposer both keep admission quarantined', async () => {
  const m = await runtime(), c = new AbortController(), op = m.acquireSelectedOutputShareMp3Operation(c.signal);
  const work = deferred(), disposal = deferred(), late = new Uint8Array(32).fill(9); let disposals = 0;
  const pending = m.runSelectedOutputShareMp3Operation(op, () => work.promise, async value => { disposals++; await disposal.promise; value.fill(0); });
  await tick(); c.abort(); await assert.rejects(pending); m.finishSelectedOutputShareMp3Operation(op);
  assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
  work.resolve(late); await tick(); assert.equal(disposals, 1);
  assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
  disposal.resolve(); await tick(); assert(late.every(byte => byte === 0));
  const next = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal); assert(next); m.finishSelectedOutputShareMp3Operation(next);
});

test('failed late disposer leaves the slot quarantined instead of reopening', async () => {
  const m = await runtime(), c = new AbortController(), op = m.acquireSelectedOutputShareMp3Operation(c.signal), work = deferred();
  const pending = m.runSelectedOutputShareMp3Operation(op, () => work.promise, () => { throw Error('cleanup_failed'); });
  await tick(); c.abort(); await assert.rejects(pending); m.finishSelectedOutputShareMp3Operation(op); work.resolve({}); await tick();
  assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
});

test('registered final copy is zeroed when final SQL rejects', async () => {
  const m = await runtime(), op = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), bytes = new Uint8Array(300).fill(4);
  m.ownSelectedOutputShareMp3ResponseBytes(op, bytes);
  await assert.rejects(m.runSelectedOutputShareMp3Operation(op, async () => { throw Error('sql_failed'); }));
  m.finishSelectedOutputShareMp3Operation(op); assert(bytes.every(byte => byte === 0));
});

test('response uses independent bounded pull chunks and owns lease through EOF', async () => {
  const m = await runtime(), op = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal);
  const bytes = new Uint8Array(3_840_044); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const before = hash(bytes); m.ownSelectedOutputShareMp3ResponseBytes(op, bytes);
  assert.throws(() => m.ownSelectedOutputShareMp3ResponseBytes(op, new Uint8Array(1)));
  const response = m.selectedOutputShareMp3Response(op, bytes, { status: 200 });
  m.finishSelectedOutputShareMp3Operation(op); // Successful handoff is body-owned.
  assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
  const reader = response.body.getReader(), chunks = [];
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    assert(part.value.length <= 65_536); assert.notEqual(part.value.buffer, bytes.buffer); chunks.push(part.value);
    assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
  }
  assert.equal(chunks.length, 59); assert(bytes.every(byte => byte === 0));
  assert.equal(hash(Buffer.concat(chunks)), before); // Emitted data survives owner zeroing.
  const next = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal); assert(next); m.finishSelectedOutputShareMp3Operation(next);
});

test('unread, partially read and never-handed response copies retire on cancel/abort/failure', async () => {
  const m = await runtime();
  for (const action of ['unread-cancel', 'partial-abort', 'constructor-failure']) {
    const c = new AbortController(), op = m.acquireSelectedOutputShareMp3Operation(c.signal), bytes = new Uint8Array(100_000).fill(7);
    m.ownSelectedOutputShareMp3ResponseBytes(op, bytes);
    if (action === 'constructor-failure') assert.throws(() => m.selectedOutputShareMp3Response(op, bytes, { status: 999 }));
    else {
      const response = m.selectedOutputShareMp3Response(op, bytes, { status: 200 });
      if (action === 'unread-cancel') await response.body.cancel();
      else { const reader = response.body.getReader(), first = await reader.read(); c.abort(); await assert.rejects(reader.read()); assert(first.value.every(byte => byte === 7)); }
    }
    await tick(); assert(bytes.every(byte => byte === 0));
    const next = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal); assert(next, action); m.finishSelectedOutputShareMp3Operation(next);
  }
});

test('wall and monotonic deadlines cannot be restarted by a later stage', async t => {
  const m = await runtime();
  for (const clock of ['wall', 'monotonic']) {
    const op = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), bytes = new Uint8Array(8).fill(3);
    m.ownSelectedOutputShareMp3ResponseBytes(op, bytes);
    const now = clock === 'wall' ? Date.now() : performance.now();
    const mocked = clock === 'wall' ? t.mock.method(Date, 'now', () => now + 30_001) : t.mock.method(performance, 'now', () => now + 30_001);
    assert.throws(() => m.assertSelectedOutputShareMp3OperationCurrent(op)); mocked.mock.restore(); m.finishSelectedOutputShareMp3Operation(op);
    assert(bytes.every(byte => byte === 0));
  }
});

test('audio and projected witnesses dispose idempotently without changing previously copied bytes', async () => {
  const m = await runtime(), source = await sourceBytes(), result = await m.projectSelectedOutputShareMp3(source, expected(source), new AbortController().signal);
  assert.equal(result.status, 'projected'); assert(m.isOwnedSelectedOutputShareMp3(result));
  const bytes = m.copySelectedOutputShareMp3Bytes(result), before = hash(bytes);
  const qualified = await m.qualifySelectedOutputShareAudio(bytes, { sha256: before, byteLength: bytes.length, mimeType: 'audio/wav' });
  assert.equal(qualified.status, 'qualified');
  m.disposeSelectedOutputShareAudio({ ...qualified }); assert(m.copySelectedOutputShareAudioBytes(qualified));
  m.disposeSelectedOutputShareAudio(qualified); m.disposeSelectedOutputShareAudio(qualified);
  assert.equal(m.copySelectedOutputShareAudioBytes(qualified), null);
  m.disposeSelectedOutputShareMp3({ ...result }); assert(m.isOwnedSelectedOutputShareMp3(result));
  m.disposeSelectedOutputShareMp3(result); m.disposeSelectedOutputShareMp3(result);
  assert.equal(m.copySelectedOutputShareMp3Bytes(result), null); assert(!m.isOwnedSelectedOutputShareMp3(result));
  assert.equal(hash(bytes), before); bytes.fill(0); source.fill(0);
});

test('late source hash or WAV qualification keeps projector and outer owner busy until drained', async t => {
  const m = await runtime(), source = await sourceBytes(), facts = expected(source), nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  for (const delayedCall of [1, 3]) { // source digest, then construction digest, then qualifier digest
    const c = new AbortController(), op = m.acquireSelectedOutputShareMp3Operation(c.signal), delayed = deferred(); let calls = 0;
    const mocked = t.mock.method(crypto.subtle, 'digest', (...args) => ++calls === delayedCall ? delayed.promise.then(() => nativeDigest(...args)) : nativeDigest(...args));
    const pending = m.runSelectedOutputShareMp3Operation(op,
      () => m.projectSelectedOutputShareMp3(source, facts, m.selectedOutputShareMp3OperationSignal(op)), m.disposeSelectedOutputShareMp3);
    while (calls < delayedCall) await tick();
    c.abort(); await assert.rejects(pending); m.finishSelectedOutputShareMp3Operation(op); await tick();
    assert(m.selectedOutputShareMp3ProjectionBusy());
    assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
    const refused = await m.projectSelectedOutputShareMp3(source, facts, new AbortController().signal); assert.equal(refused.reason, 'busy');
    delayed.resolve(); await m.selectedOutputShareMp3ProjectionDrained(); await tick(); mocked.mock.restore();
    assert(!m.selectedOutputShareMp3ProjectionBusy());
    const next = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal); assert(next); m.finishSelectedOutputShareMp3Operation(next);
  }
});

test('outer owner retains genuine projection without another WAV copy and retires it on finish', async () => {
  const m = await runtime(), op = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), source = await sourceBytes();
  m.ownSelectedOutputShareMp3Source(op, source);
  const projected = await m.runSelectedOutputShareMp3Operation(op,
    () => m.projectSelectedOutputShareMp3(source, expected(source), m.selectedOutputShareMp3OperationSignal(op)), m.disposeSelectedOutputShareMp3,
    value => { if (value.status === 'projected') m.ownSelectedOutputShareMp3Projection(op, value); });
  assert.equal(projected.status, 'projected');
  assert.throws(() => m.ownSelectedOutputShareMp3Projection(op, { ...projected }));
  m.retireSelectedOutputShareMp3Source(op);
  assert(source.every(byte => byte === 0)); m.finishSelectedOutputShareMp3Operation(op);
  assert.equal(m.copySelectedOutputShareMp3Bytes(projected), null);
});

test('captured deadlines are closed, finite and inherited through response body ownership', async () => {
  const m = await runtime(), signal = new AbortController().signal;
  for (const inherited of [{ wallDeadline: Date.now() - 1, monotonicDeadline: performance.now() + 1000 },
    { wallDeadline: Date.now() + 31_000, monotonicDeadline: performance.now() + 1000 },
    { wallDeadline: Date.now() + 1000, monotonicDeadline: Infinity },
    { get wallDeadline() { throw Error('getter'); }, monotonicDeadline: performance.now() + 1000 }]) {
    assert.equal(m.acquireSelectedOutputShareMp3Operation(signal, inherited), null);
  }
  const op = m.acquireSelectedOutputShareMp3Operation(signal, { wallDeadline: Date.now() + 60, monotonicDeadline: performance.now() + 60 });
  const bytes = new Uint8Array(12).fill(8); m.ownSelectedOutputShareMp3ResponseBytes(op, bytes);
  const response = m.selectedOutputShareMp3Response(op, bytes, { status: 200 });
  await new Promise(resolve => setTimeout(resolve, 100));
  await assert.rejects(response.arrayBuffer()); assert(bytes.every(byte => byte === 0));
  const next = m.acquireSelectedOutputShareMp3Operation(signal); assert(next); m.finishSelectedOutputShareMp3Operation(next);
});

test('late delivery decision and cleanup started after stop cannot reopen the slot', async () => {
  const m = await runtime(), c = new AbortController(), op = m.acquireSelectedOutputShareMp3Operation(c.signal);
  const work = deferred(), disposal = deferred(), allocationCleanup = deferred(); let adopted = false, disposals = 0;
  const pending = m.runSelectedOutputShareMp3Operation(op, () => work.promise,
    async () => { disposals++; await disposal.promise; }, () => { adopted = true; queueMicrotask(() => c.abort()); });
  work.resolve({}); await assert.rejects(pending); assert(adopted);
  const cleanup = m.cleanupSelectedOutputShareMp3Operation(op, () => allocationCleanup.promise);
  m.finishSelectedOutputShareMp3Operation(op);
  assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
  disposal.resolve(); await tick(); assert.equal(disposals, 1);
  assert.equal(m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), null);
  allocationCleanup.resolve(); await cleanup; await tick();
  m.retireSelectedOutputShareMp3Source(op); m.retireSelectedOutputShareMp3Projection(op);
  const next = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal); assert(next); m.finishSelectedOutputShareMp3Operation(next);
});

test('mono/stereo allocation inventory matches two sources plus two WAVs without an attachment copy', async () => {
  for (const name of ['mono-20', 'stereo-20']) {
    const m = await runtime(), fixture = await readFile(new URL(`./fixtures/audio-share-mp3/${name}.mp3`, import.meta.url));
    const NativeUint8Array = globalThis.Uint8Array, nativeFill = NativeUint8Array.prototype.fill;
    const tracked = new Map(); let live = 0, peak = 0, captureAllocations = true;
    globalThis.Uint8Array = new Proxy(NativeUint8Array, { construct(target, args) {
      const bytes = Reflect.construct(target, args, target);
      // Count allocated media buffers, not views of WASM/crypto/platform buffers.
      if (captureAllocations && (typeof args[0] === 'number' || ArrayBuffer.isView(args[0])) && bytes.byteLength >= 1000) {
        tracked.set(bytes, bytes.byteLength); live += bytes.byteLength; peak = Math.max(peak, live);
      }
      return bytes;
    } });
    NativeUint8Array.prototype.fill = function(value, start, end) {
      const result = Reflect.apply(nativeFill, this, [value, start, end]);
      if (value === 0 && (start === undefined || start === 0) && (end === undefined || end === this.length) && tracked.has(this)) {
        live -= tracked.get(this); tracked.delete(this);
      }
      return result;
    };
    try {
      const op = m.acquireSelectedOutputShareMp3Operation(new AbortController().signal), source = new Uint8Array(fixture);
      m.ownSelectedOutputShareMp3Source(op, source);
      const projected = await m.runSelectedOutputShareMp3Operation(op,
        () => m.projectSelectedOutputShareMp3(source, expected(source), m.selectedOutputShareMp3OperationSignal(op)), m.disposeSelectedOutputShareMp3,
        value => { if (value.status === 'projected') m.ownSelectedOutputShareMp3Projection(op, value); });
      assert.equal(projected.status, 'projected');
      assert.equal(peak, 2 * fixture.length + 2 * projected.byteLength);
      assert(peak + 16_973_824 <= m.SELECTED_OUTPUT_SHARE_MP3_OPERATION_LIMITS.ownedPayloadAndWasmBytes);
      m.retireSelectedOutputShareMp3Source(op); assert.equal(live, projected.byteLength);
      const finalCopy = m.copySelectedOutputShareMp3Bytes(projected); m.ownSelectedOutputShareMp3ResponseBytes(op, finalCopy);
      assert.equal(live, 2 * projected.byteLength);
      m.retireSelectedOutputShareMp3Projection(op); assert.equal(live, projected.byteLength);
      const response = m.selectedOutputShareMp3Response(op, finalCopy, { status: 200 });
      // Response.arrayBuffer creates a consumer-owned result outside this bound.
      // Stream slices are checked independently by the chunk-ownership test.
      captureAllocations = false; await response.arrayBuffer();
      assert.equal(live, 0); assert.equal(tracked.size, 0);
    } finally { globalThis.Uint8Array = NativeUint8Array; NativeUint8Array.prototype.fill = nativeFill; }
  }
});

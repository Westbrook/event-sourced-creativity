import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createHash } from "node:crypto";
import { readNativeRetainedAudioMedia } from "../src/model/native-retained-audio-media.ts";
import { MAX_AUDIO_UPLOAD_BYTES } from "../src/model/audio.ts";

// Native Node streams, Response and Blob; only the owned request port is supplied.
// These controls prove byte/lifetime contracts, not browser playback or audio decoding.
const origin = "https://forma.test";
const path = "/api/media/u-6f776e6572%2Fgenerated%2Faudio.wav";
const bytes = Uint8Array.from([82, 73, 70, 70, 0, 255, 13, 10, 128, 1]);
const sha = value => createHash("sha256").update(value).digest("hex");
const media = () => ({ url: path, mediaType: "audio/wav", sha256: sha(bytes) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const realFetch = globalThis.fetch;
let externalAttempts = 0;
before(() => { globalThis.fetch = async () => { externalAttempts++; throw Error("External transport is forbidden in Audio byte controls"); }; });
after(() => { globalThis.fetch = realFetch; assert.equal(externalAttempts, 0); });

function response(body = bytes, options = {}) {
  const { url = origin + path, redirected = false, status = 200, headers = {} } = options;
  const value = new Response(body, { status, headers: { "content-type": "audio/wav", ...headers } });
  // A constructed Response has no network URL. Supply only that missing native
  // response port explicitly; the reader still validates its exact value.
  Object.defineProperties(value, { url: { value: url }, redirected: { value: redirected } });
  return value;
}
function controls(t, request, current = () => true) {
  const owner = new AbortController(), calls = [];
  t.after(() => owner.abort());
  return { owner, calls, value: { origin, signal: owner.signal, current,
    request: (url, init) => { calls.push({ url, init }); return request(url, init); } } };
}
function bodyWithCancel(onCancel, chunks = [bytes]) {
  let index = 0;
  return new ReadableStream({
    pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close(); },
    cancel: onCancel,
  }, { highWaterMark: 0 });
}

test("Audio bytes become an exact SHA-verified Blob using the captured immutable media descriptor", { timeout: 2000 }, async t => {
  const source = media(); let getterCalls = 0;
  const reply = response(bodyWithCancel(() => assert.fail("Completed bytes need no cancellation"), [bytes.slice(0, 3), bytes.slice(3)]),
    { headers: { "content-length": String(bytes.length), "content-type": "audio/wav; charset=binary" } });
  const c = controls(t, async () => {
    for (const key of ["url", "mediaType", "sha256"]) Object.defineProperty(source, key,
      { enumerable: true, get() { getterCalls++; throw Error("The caller mutated its descriptor after capture"); } });
    return reply;
  });
  const blob = await readNativeRetainedAudioMedia(source, c.value);
  assert.ok(blob instanceof Blob); assert.equal(blob.type, "audio/wav"); assert.equal(blob.size, bytes.length);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes); assert.equal(getterCalls, 0);
  assert.equal(c.calls.length, 1); assert.equal(c.calls[0].url, path);
  const init = c.calls[0].init;
  assert.deepEqual(Object.keys(init).sort(), ["cache", "credentials", "method", "redirect", "signal"]);
  assert.equal(init.method, "GET"); assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
  assert.equal(init.signal.aborted, true); assert.equal(reply.body.locked, false);
});

test("Audio refuses malformed descriptors without executing getters or making a request", async t => {
  let getterCalls = 0;
  const accessor = media(); Object.defineProperty(accessor, "url", { enumerable: true, get() { getterCalls++; return path; } });
  const hidden = media(); Object.defineProperty(hidden, "sha256", { value: sha(bytes), enumerable: false });
  const symbol = media(); symbol[Symbol("hidden")] = true;
  const controlsToReject = [null, {}, accessor, hidden, symbol, { ...media(), extra: true },
    Object.create(media()), { ...media(), mediaType: "text/html" }, { ...media(), sha256: "F".repeat(64) },
    { ...media(), url: "https://outside.invalid/audio.wav" }, { ...media(), url: path + "?download=1" },
    { ...media(), url: "/api/media/u-owner%2F..%2Faudio.wav" }];
  for (const input of controlsToReject) {
    const c = controls(t, async () => assert.fail("Rejected media must not request anything"));
    await assert.rejects(readNativeRetainedAudioMedia(input, c.value), /retained_audio_unavailable/);
    assert.equal(c.calls.length, 0);
  }
  assert.equal(getterCalls, 0);
});

test("Audio rejects wrong response identity, MIME, status and redirects and cancels their bodies", async t => {
  for (const [name, options] of [
    ["missing URL", { url: "" }], ["other origin", { url: "https://outside.invalid" + path }],
    ["other key", { url: origin + path + "-replacement" }], ["query alias", { url: origin + path + "?x=1" }],
    ["MIME", { headers: { "content-type": "audio/mpeg" } }], ["redirect", { redirected: true }], ["status", { status: 206 }],
  ]) await t.test(name, { timeout: 2000 }, async child => {
    let cancelled = 0; const reply = response(bodyWithCancel(() => { cancelled++; }), options);
    const c = controls(child, async () => reply);
    await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_unavailable/);
    assert.equal(cancelled, 1); assert.equal(reply.body.locked, false); assert.equal(c.calls.length, 1);
    assert.equal(c.calls[0].init.signal.aborted, true);
  });
});

test("Audio rejects changed bytes under the same media key", { timeout: 2000 }, async t => {
  const changed = bytes.slice(); changed[changed.length - 1] ^= 1;
  const reply = response(changed, { headers: { "content-length": String(changed.length) } });
  const c = controls(t, async () => reply);
  await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_changed/);
  assert.equal(reply.body.locked, false); assert.equal(c.calls.length, 1);
});

test("Audio checks identity-encoded byte declarations and refuses empty or zero-length chunks", async t => {
  for (const [name, header, chunks] of [
    ["zero declared", "0", [bytes]], ["padded number", "010", [bytes]], ["negative", "-1", [bytes]],
    ["unsafe integer", "9007199254740992", [bytes]], ["over cap", String(MAX_AUDIO_UPLOAD_BYTES + 1), [bytes]],
    ["short body", String(bytes.length + 1), [bytes]], ["long body", String(bytes.length - 1), [bytes]],
    ["empty body", undefined, []], ["empty chunk", undefined, [new Uint8Array(0), bytes]],
  ]) await t.test(name, { timeout: 2000 }, async child => {
    const reply = response(bodyWithCancel(() => {}, chunks), { headers: header === undefined ? {} : { "content-length": header } });
    const c = controls(child, async () => reply);
    await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_size/);
    assert.equal(reply.body.locked, false); assert.equal(c.calls.length, 1);
  });
});

test("Audio bounds decoded bytes even without a declared length", { timeout: 5000 }, async t => {
  const part = new Uint8Array(1024 * 1024); let pulls = 0, cancelled = 0;
  const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(part); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const reply = response(body), c = controls(t, async () => reply);
  await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_size/);
  assert.equal(pulls, MAX_AUDIO_UPLOAD_BYTES / part.length + 1); assert.equal(cancelled, 1);
  assert.equal(reply.body.locked, false);
});

test("Audio refuses excessive tiny-chunk work independently of its byte cap", { timeout: 5000 }, async t => {
  let pulls = 0, cancelled = 0; const part = Uint8Array.of(1);
  const reply = response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(part); }, cancel() { cancelled++; } }, { highWaterMark: 0 }));
  const c = controls(t, async () => reply);
  await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_size/);
  assert.equal(pulls, 65_537); assert.equal(cancelled, 1); assert.equal(reply.body.locked, false);
});

test("Audio verifies decoded compressed-response bytes rather than comparing encoded Content-Length", { timeout: 2000 }, async t => {
  const reply = response(bytes, { headers: { "content-encoding": "gzip", "content-length": "2" } });
  const c = controls(t, async () => reply), blob = await readNativeRetainedAudioMedia(media(), c.value);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.equal(reply.body.locked, false);
});

test("Audio refuses pre-retired owners before requesting and detects ownership loss during the body", async t => {
  await t.test("pre-aborted", async child => {
    const c = controls(child, async () => assert.fail("Pre-aborted request")); c.owner.abort();
    await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_retired/); assert.equal(c.calls.length, 0);
  });
  await t.test("pre-stale", async child => {
    const c = controls(child, async () => assert.fail("Pre-stale request"), () => false);
    await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_retired/); assert.equal(c.calls.length, 0);
  });
  await t.test("stale after headers", async child => {
    let current = true, cancelled = 0; const reply = response(bodyWithCancel(() => { cancelled++; }));
    const c = controls(child, async () => { current = false; return reply; }, () => current);
    await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_retired/);
    assert.ok(cancelled >= 1); assert.equal(reply.body.locked, false);
  });
  await t.test("stale after chunk", async child => {
    let current = true, cancelled = 0;
    const reply = response(new ReadableStream({ pull(controller) { current = false; controller.enqueue(bytes); }, cancel() { cancelled++; } }, { highWaterMark: 0 }));
    const c = controls(child, async () => reply, () => current);
    await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_retired/);
    assert.equal(cancelled, 1); assert.equal(reply.body.locked, false);
  });
});

test("Audio owner abort settles a hung request and cancels any late response without awaiting pending cancellation", { timeout: 2000 }, async t => {
  const request = deferred(), cancellation = deferred(); let cancelled = 0;
  t.after(() => cancellation.resolve());
  const c = controls(t, () => request.promise), pending = readNativeRetainedAudioMedia(media(), c.value);
  const rejected = assert.rejects(pending, /retained_audio_retired/);
  c.owner.abort(); await rejected;
  const reply = response(bodyWithCancel(() => { cancelled++; return cancellation.promise; }));
  request.resolve(reply); await Promise.resolve(); await Promise.resolve();
  assert.equal(cancelled, 1); assert.equal(reply.body.locked, false); assert.equal(c.calls[0].init.signal.aborted, true);
});

test("Audio owner abort settles a hung read while its underlying cancellation remains pending", { timeout: 2000 }, async t => {
  const entered = deferred(), cancellation = deferred(); let cancelled = 0;
  t.after(() => cancellation.resolve());
  const reply = response(new ReadableStream({ pull() { entered.resolve(); }, cancel() { cancelled++; return cancellation.promise; } }, { highWaterMark: 0 }));
  const c = controls(t, async () => reply), pending = readNativeRetainedAudioMedia(media(), c.value);
  const rejected = assert.rejects(pending, /retained_audio_retired/);
  await entered.promise; c.owner.abort(); await rejected;
  assert.equal(cancelled, 1); assert.equal(reply.body.locked, false); assert.equal(c.calls[0].init.signal.aborted, true);
});

test("Audio rejects invalid headers even when source cancellation never settles", { timeout: 2000 }, async t => {
  const cancellation = deferred(); let cancelled = 0; t.after(() => cancellation.resolve());
  const reply = response(bodyWithCancel(() => { cancelled++; return cancellation.promise; }), { headers: { "content-type": "text/html" } });
  const c = controls(t, async () => reply);
  await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_unavailable/);
  assert.equal(cancelled, 1); assert.equal(reply.body.locked, false);
});

test("Audio timeout independently settles a request that ignores its abort signal", { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const request = deferred(); const c = controls(t, () => request.promise);
  const pending = readNativeRetainedAudioMedia(media(), c.value), rejected = assert.rejects(pending, /retained_audio_retired/);
  t.mock.timers.tick(30_000); await rejected;
  assert.equal(c.calls[0].init.signal.aborted, true);
  request.resolve(response()); await Promise.resolve(); await Promise.resolve();
});

test("Audio ownership lost during a hung read is refused by the finite deadline", { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const entered = deferred(); let current = true, cancelled = 0;
  const reply = response(new ReadableStream({ pull() { entered.resolve(); }, cancel() { cancelled++; } }, { highWaterMark: 0 }));
  const c = controls(t, async () => reply, () => current), pending = readNativeRetainedAudioMedia(media(), c.value);
  const rejected = assert.rejects(pending, /retained_audio_retired/);
  await entered.promise; current = false; t.mock.timers.tick(30_000); await rejected;
  assert.equal(cancelled, 1); assert.equal(reply.body.locked, false); assert.equal(c.calls[0].init.signal.aborted, true);
});

test("Audio checks the absolute deadline inside immediate chunk work", { timeout: 2000 }, async t => {
  let now = 1000, cancelled = 0;
  t.mock.method(Date, "now", () => now);
  const reply = response(new ReadableStream({ pull(controller) { controller.enqueue(bytes); now = 31_001; }, cancel() { cancelled++; } }, { highWaterMark: 0 }));
  const c = controls(t, async () => reply);
  await assert.rejects(readNativeRetainedAudioMedia(media(), c.value), /retained_audio_retired/);
  assert.equal(cancelled, 1); assert.equal(reply.body.locked, false);
});

test("Audio owner abort during a pending digest cannot publish a Blob", { timeout: 2000 }, async t => {
  const entered = deferred(), digest = deferred();
  t.mock.method(crypto.subtle, "digest", () => { entered.resolve(); return digest.promise; });
  const reply = response(), c = controls(t, async () => reply);
  const pending = readNativeRetainedAudioMedia(media(), c.value), rejected = assert.rejects(pending, /retained_audio_retired/);
  await entered.promise; c.owner.abort(); await rejected;
  assert.equal(reply.body.locked, false); digest.resolve(new ArrayBuffer(32));
});

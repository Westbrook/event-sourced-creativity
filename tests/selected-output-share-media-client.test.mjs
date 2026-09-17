import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readSelectedOutputShareSourceMedia, createSelectedOutputShareTokenMediaReader, createSelectedOutputSharePreparedMediaReader,
  accessVerifiedSelectedOutputShareMedia, disposeVerifiedSelectedOutputShareMedia,
  withVerifiedSelectedOutputShareMediaBytes, SELECTED_OUTPUT_SHARE_MEDIA_BUDGET_BYTES,
  SELECTED_OUTPUT_SHARE_MEDIA_READ_TIMEOUT_MS } from "../src/selected-output-share-media-client.ts";
import { validateSelectedOutputShareMediaPublicOutput } from "../src/model/selected-output-share.ts";
import { wav } from "./output-asset-fixtures.mjs";

// Synthetic transport and byte-identity checks. The closed descriptor is the
// declared server-qualified expectation; this client does not qualify containers,
// prove source custody, publish a link, fetch providers or certify playback.
const ORIGIN = "https://forma.test", TOKEN = "Aa0_-".repeat(6) + "xy";
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const SOURCE = "/api/media/" + encodeURIComponent("u-6f776e6572/generated/synthetic.wav");
const FILE = ORIGIN + "/api/selected-output-shared/" + TOKEN + "/file";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const deferred = () => Promise.withResolvers();
const names = { audio: "forma-audio.wav", video: "forma-video.mp4", model3d: "forma-3d.glb" };

function publicOutput(bytes, kind = "audio", byteLength = bytes.byteLength) {
  const common = { kind, mimeType: kind === "audio" ? "audio/wav" : kind === "video" ? "video/mp4" : "model/gltf-binary",
    byteLength, sha256: hash(bytes) };
  const media = kind === "audio" ? { ...common, sampleRate: 8000, channels: 1, sampleCount: (byteLength - 44) / 2,
    durationSeconds: ((byteLength - 44) / 2) / 8000, durationBasis: "pcm-samples" }
    : kind === "video" ? { ...common, width: 16, height: 16, durationSeconds: 1 } : common;
  const value = validateSelectedOutputShareMediaPublicOutput({ schemaVersion: 1, kind: "selected-output-read", output: kind,
    title: "Explicit reviewed title", expiresAt: new Date(NOW + 60_000).toISOString(), attribution: "Forma",
    content: { media, disclosure: kind === "audio" ? { watermark: "not-declared" } : kind === "video" ? { encoderDeclaration: null } : {} } }, NOW);
  assert.ok(value, "fixture is an actual-validator-accepted closed media public output"); return value;
}

function fixture(t, { kind = "audio", bytes = wav({ samples: 8 }), publicRead = false, byteLength } = {}) {
  t.mock.method(Date, "now", () => NOW);
  const output = publicOutput(bytes, kind, byteLength), descriptor = output.content.media;
  const source = { url: SOURCE, mimeType: descriptor.mimeType, byteLength: descriptor.byteLength, sha256: descriptor.sha256 };
  const controller = new AbortController(), calls = [], handles = []; let current = true, reply;
  const response = ({ body = bytes, status = 200, headers = {}, url = publicRead ? FILE : ORIGIN + SOURCE, redirected = false } = {}) => {
    const value = new Response(body, { status, headers: { "content-type": descriptor.mimeType,
      "content-length": String(descriptor.byteLength),
      ...(publicRead ? { "content-disposition": `attachment; filename="${names[kind]}"` } : {}), ...headers } });
    Object.defineProperty(value, "url", { value: url }); Object.defineProperty(value, "redirected", { value: redirected }); return value;
  };
  reply = () => response();
  const request = async (url, init) => { calls.push({ url, init }); return reply(url, init); };
  t.mock.method(globalThis, "fetch", request);
  const lease = { signal: controller.signal, isCurrent: () => current };
  const sourceOptions = { ...lease, origin: ORIGIN, request };
  const read = async (expected = output, input = source, options = sourceOptions) => {
    const value = publicRead ? await createSelectedOutputShareTokenMediaReader(TOKEN, ORIGIN)(expected, lease)
      : await readSelectedOutputShareSourceMedia(expected, input, options);
    handles.push(value); return value;
  };
  t.after(() => { controller.abort(); for (const handle of handles) disposeVerifiedSelectedOutputShareMedia(handle); });
  return { output, source, bytes, descriptor, controller, lease, sourceOptions, calls, request, response, handles, read,
    setReply(value) { reply = value; }, retire() { current = false; } };
}
async function eventually(check, label) {
  for (let index = 0; index < 40; index++) { if (check()) return; await new Promise(setImmediate); }
  assert.ok(check(), label);
}
const refuses = promise => assert.rejects(promise, error => error instanceof Error);

for (const publicRead of [false, true]) test(`${publicRead ? "token file" : "captured source"} uses one exact same-origin full GET and yields hash-verified bytes`, async t => {
  const f = fixture(t, { publicRead }), handle = await f.read();
  assert.equal(f.calls.length, 1); const call = f.calls[0];
  assert.equal(call.url, publicRead ? FILE : ORIGIN + SOURCE);
  assert.equal(call.init.method, "GET"); assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.cache, "no-store"); assert.equal(call.init.redirect, "error"); assert.equal(call.init.referrerPolicy, "no-referrer");
  assert.ok(call.init.signal instanceof AbortSignal); assert.equal(new Headers(call.init.headers).get("range"), null);
  assert.equal(new URL(call.url).search, ""); assert.equal(new URL(call.url).hash, "");
  const accessed = accessVerifiedSelectedOutputShareMedia(handle, f.output);
  assert.ok(accessed); assert.equal(accessed.fileName, "forma-audio.wav"); assert.equal(accessed.blob.type, "audio/wav");
  assert.deepEqual(new Uint8Array(await accessed.blob.arrayBuffer()), f.bytes);
  assert.ok(Object.isFrozen(handle));
});

test("fixed client filenames depend on media kind, never source metadata or reviewed title", async t => {
  for (const kind of ["audio", "video", "model3d"]) {
    const f = fixture(t, { kind });
    f.setReply(() => f.response({ headers: { "content-disposition": 'attachment; filename="PRIVATE_NATIVE_TITLE.wav"' } }));
    const handle = await f.read(), accessed = accessVerifiedSelectedOutputShareMedia(handle, f.output);
    assert.equal(accessed.fileName, names[kind]); assert.equal(accessed.blob.type, f.descriptor.mimeType);
  }
});

test("source route rejects alternate encodings, external/provider/data URLs and extra request components before transport", async t => {
  const f = fixture(t);
  for (const url of [ORIGIN + SOURCE, "https://provider.invalid/file.wav", "data:audio/wav;base64,AAAA", "blob:https://forma.test/id",
    "//foreign.invalid/file", SOURCE + "?download=1", SOURCE + "#fragment", SOURCE.replace("%2F", "%2f"),
    "/api/media/u-6f776e6572/generated/synthetic.wav", "/api/media/" + encodeURIComponent("../private.wav")]) {
    const before = f.calls.length; await refuses(f.read(f.output, { ...f.source, url }));
    assert.equal(f.calls.length, before, "invalid source must refuse before transport: " + url);
  }
  assert.equal(f.calls.length, 0);
});

test("canonical encoded opaque key bytes remain one exact path without a second decoding", async t => {
  const f = fixture(t);
  for (const url of ["/api/media/" + encodeURIComponent("u-6f776e6572/generated/synthetic.wav?secret"), SOURCE.replace("%2F", "%252F")]) {
    f.setReply(() => f.response({ url: ORIGIN + url })); const handle = await f.read(f.output, { ...f.source, url });
    assert.equal(f.calls.at(-1).url, ORIGIN + url); assert.equal(new URL(f.calls.at(-1).url).search, "");
    assert.ok(accessVerifiedSelectedOutputShareMedia(handle, f.output));
  }
});

test("invalid token or origin never creates a transport authority", async t => {
  const f = fixture(t);
  for (const token of ["", "a".repeat(31), "a".repeat(33), "a".repeat(31) + "=", "a/".repeat(16), "%41".repeat(16), null]) {
    await refuses(Promise.resolve().then(() => createSelectedOutputShareTokenMediaReader(token, ORIGIN)(f.output, f.lease)));
  }
  for (const origin of [ORIGIN + "/", ORIGIN + "/path", "https://user@forma.test", "data:text/plain,x", "https://forma.test?x=1", "null"]) {
    await refuses(Promise.resolve().then(() => createSelectedOutputShareTokenMediaReader(TOKEN, origin)(f.output, f.lease)));
    await refuses(f.read(f.output, f.source, { ...f.sourceOptions, origin }));
  }
  assert.equal(f.calls.length, 0);
});

test("closed source facts must match the whole public descriptor and invoke no input getters", async t => {
  const f = fixture(t); let hooks = 0;
  for (const patch of [{ mimeType: "video/mp4" }, { byteLength: f.bytes.length + 1 }, { sha256: "f".repeat(64) },
    { range: "bytes=0-10" }, { fileName: "PRIVATE.wav" }, { output: "audio" }]) await refuses(f.read(f.output, { ...f.source, ...patch }));
  const getter = { ...f.source }; Object.defineProperty(getter, "url", { enumerable: true, get() { hooks++; return SOURCE; } });
  const output = structuredClone(f.output); Object.defineProperty(output, "content", { enumerable: true, get() { hooks++; return f.output.content; } });
  await refuses(f.read(f.output, getter)); await refuses(f.read(output));
  const native = { ...f.output, kind: "native-retained-output", selection: { documentId: "PRIVATE" } };
  await refuses(f.read(native)); assert.equal(hooks, 0); assert.equal(f.calls.length, 0);
});

test("source/output/options are captured before request settlement and cannot be retargeted by caller mutation", async t => {
  const f = fixture(t), held = deferred(), output = structuredClone(f.output), source = { ...f.source }, options = { ...f.sourceOptions };
  f.setReply(() => held.promise); const pending = f.read(output, source, options);
  await eventually(() => f.calls.length === 1, "captured source request");
  source.url = "/api/media/other"; source.sha256 = "b".repeat(64); options.origin = "https://foreign.invalid";
  output.title = "Changed title"; output.content.media.sha256 = "b".repeat(64);
  held.resolve(f.response()); const handle = await pending;
  assert.equal(f.calls[0].url, ORIGIN + SOURCE); assert.ok(accessVerifiedSelectedOutputShareMedia(handle, f.output));
  assert.equal(accessVerifiedSelectedOutputShareMedia(handle, output), null);
});

test("a verified handle keeps its original lease predicate when caller controls are replaced", async t => {
  const f = fixture(t), options = { ...f.sourceOptions };
  const handle = await f.read(f.output, f.source, options);
  assert.ok(accessVerifiedSelectedOutputShareMedia(handle, f.output));
  f.retire(); options.isCurrent = () => true;
  assert.equal(accessVerifiedSelectedOutputShareMedia(handle, f.output), null,
    "a replacement predicate cannot revive the original retired lease");
});

test("replacing pending caller controls cannot detach abort or move cleanup to a different signal", async t => {
  const f = fixture(t), held = deferred(), replacement = new AbortController(), options = { ...f.sourceOptions };
  const originalRemove = f.controller.signal.removeEventListener, replacementRemove = replacement.signal.removeEventListener;
  let originalRemovals = 0, replacementRemovals = 0;
  t.mock.method(f.controller.signal, "removeEventListener", function (...args) {
    if (args[0] === "abort") originalRemovals++; return originalRemove.apply(this, args);
  });
  t.mock.method(replacement.signal, "removeEventListener", function (...args) {
    if (args[0] === "abort") replacementRemovals++; return replacementRemove.apply(this, args);
  });
  f.setReply(() => held.promise); const pending = f.read(f.output, f.source, options), rejected = refuses(pending);
  await eventually(() => f.calls.length === 1, "original lease subscription established");
  options.signal = replacement.signal; options.isCurrent = () => true; f.controller.abort();
  await rejected; held.resolve(f.response());
  assert.equal(f.calls[0].init.signal.aborted, true, "the original signal still cancels transport");
  assert.equal(originalRemovals, 1, "cleanup removes the original abort subscription");
  assert.equal(replacementRemovals, 0, "cleanup never targets caller replacement controls");
});

for (const publicRead of [false, true]) test(`${publicRead ? "public" : "source"} response status, final URL, redirect, MIME and declared lengths fail closed`, async t => {
  const f = fixture(t, { publicRead });
  const correctUrl = publicRead ? FILE : ORIGIN + SOURCE;
  const failures = [
    { status: 206 }, { status: 403 }, { status: 404 }, { redirected: true }, { url: "https://foreign.invalid/file" },
    { url: correctUrl + "?x=1" }, { url: correctUrl + "#x" }, { url: correctUrl + "/other" },
    { headers: { "content-type": "audio/mpeg" } }, { headers: { "content-type": "text/html" } },
    { headers: { "content-range": `bytes 0-${f.bytes.length - 1}/${f.bytes.length}` } },
    ...["", "wat", "-1", "1.5", "0", String(f.bytes.length - 1), String(f.bytes.length + 1)].map(value => ({ headers: { "content-length": value } })),
  ];
  for (const failure of failures) { f.setReply(() => f.response(failure)); await refuses(f.read()); }
});

test("private length may be absent, while public files require exact length and identity encoding", async t => {
  const source = fixture(t); source.setReply(() => { const response = source.response(); response.headers.delete("content-length"); return response; });
  assert.ok(accessVerifiedSelectedOutputShareMedia(await source.read(), source.output));
  // The Fetch port exposes already-decoded bytes; this is not a compression test.
  source.setReply(() => source.response({ headers: { "content-encoding": "gzip", "content-length": "123" } }));
  assert.ok(accessVerifiedSelectedOutputShareMedia(await source.read(), source.output));
  const recipient = fixture(t, { publicRead: true });
  recipient.setReply(() => { const response = recipient.response(); response.headers.delete("content-length"); return response; });
  await refuses(recipient.read());
  recipient.setReply(() => recipient.response({ headers: { "content-encoding": "gzip" } })); await refuses(recipient.read());
});

test("public files require the exact fixed attachment header", async t => {
  const f = fixture(t, { publicRead: true });
  for (const disposition of ["", "inline", 'attachment; filename="private.wav"', 'attachment; filename="forma-video.mp4"',
    'attachment; filename="forma-audio.wav"; filename*=UTF-8\'\'private.wav']) {
    f.setReply(() => f.response({ headers: { "content-disposition": disposition } })); await refuses(f.read());
  }
});

test("short, oversized and same-length wrong-hash bodies never yield a verified handle", async t => {
  const f = fixture(t), wrong = new Uint8Array(f.bytes); wrong[wrong.length - 1] ^= 1;
  for (const body of [f.bytes.slice(0, -1), new Uint8Array(f.bytes.length + 1), wrong]) {
    f.setReply(() => f.response({ body })); await refuses(f.read());
  }
});

test("overlong streams cancel at the expected byte bound without consuming an endless tail", async t => {
  const f = fixture(t); let pulls = 0, cancelled = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++; if (pulls === 1) controller.enqueue(new Uint8Array(f.bytes.length + 1)); else throw Error("unbounded tail was read");
  }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  f.setReply(() => f.response({ body: stream })); await refuses(f.read());
  assert.equal(pulls, 1); assert.equal(cancelled, 1);
});

test("stream chunks are copied before later supplier mutation", async t => {
  const f = fixture(t), supplied = new Uint8Array(f.bytes); let pulls = 0;
  const stream = new ReadableStream({ pull(controller) {
    pulls++; if (pulls === 1) controller.enqueue(supplied); else { supplied.fill(0); controller.close(); }
  } }, { highWaterMark: 0 });
  f.setReply(() => f.response({ body: stream }));
  const handle = await f.read(), result = accessVerifiedSelectedOutputShareMedia(handle, f.output);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), f.bytes);
});

test("already aborted or stale leases refuse before network", async t => {
  for (const mode of ["abort", "retire"]) {
    const f = fixture(t); if (mode === "abort") f.controller.abort(); else f.retire();
    await refuses(f.read()); assert.equal(f.calls.length, 0);
  }
});

test("late responses after abort or source-lease retirement are cancelled without body reads", async t => {
  for (const mode of ["abort", "retire"]) {
    const f = fixture(t), held = deferred(); let pulls = 0, cancels = 0;
    f.setReply(() => held.promise); const pending = f.read();
    const rejected = refuses(pending);
    await eventually(() => f.calls.length === 1, "pending media request");
    if (mode === "abort") f.controller.abort(); else f.retire();
    const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(f.bytes); }, cancel() { cancels++; } }, { highWaterMark: 0 });
    held.resolve(f.response({ body: stream })); await rejected;
    await eventually(() => cancels === 1, "late body cancellation"); assert.equal(pulls, 0);
  }
});

test("source lease changes while bytes arrive cancel the active body and never expose a handle", async t => {
  const f = fixture(t); let cancelled = 0;
  const stream = new ReadableStream({ pull(controller) { f.retire(); controller.enqueue(f.bytes.slice(0, 8)); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  f.setReply(() => f.response({ body: stream })); await refuses(f.read()); assert.equal(cancelled, 1);
});

test("abort interrupts a blocked body read rather than waiting indefinitely for the supplier", async t => {
  const f = fixture(t); let reading = false, cancelled = 0;
  const stream = new ReadableStream({ pull() { reading = true; }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  f.setReply(() => f.response({ body: stream })); const pending = f.read(), rejected = refuses(pending);
  await eventually(() => reading, "blocked stream read"); f.controller.abort();
  await eventually(() => cancelled === 1, "abort cancelled the active reader"); await rejected;
});

test("lease retirement during deferred digest prevents a later valid hash from authorizing access", async t => {
  const f = fixture(t), held = deferred(), started = deferred(), digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", async (...args) => { const result = await digest(...args); started.resolve(); await held.promise; return result; });
  const pending = f.read(), rejected = refuses(pending); await started.promise; f.retire(); held.resolve(); await rejected;
});

test("verified handles bind complete closed output data and reject forged identity while accepting an equal captured clone", async t => {
  const f = fixture(t), handle = await f.read();
  const clone = validateSelectedOutputShareMediaPublicOutput(structuredClone(f.output), NOW);
  assert.ok(accessVerifiedSelectedOutputShareMedia(handle, clone));
  for (const mutate of [value => { value.title += " changed"; }, value => { value.expiresAt = new Date(NOW + 30_000).toISOString(); },
    value => { value.content.disclosure.watermark = "synthid-declared"; }, value => { value.content.media.sha256 = "b".repeat(64); },
    value => { value.selection = { documentId: "PRIVATE" }; }]) {
    const changed = structuredClone(f.output); mutate(changed); assert.equal(accessVerifiedSelectedOutputShareMedia(handle, changed), null);
  }
  for (const forged of [{ ...handle }, JSON.parse(JSON.stringify(handle)), new Proxy(handle, {}), Object.create(handle), {}, null]) {
    assert.equal(accessVerifiedSelectedOutputShareMedia(forged, f.output), null);
  }
  assert.ok(accessVerifiedSelectedOutputShareMedia(handle, f.output), "foreign handle refusals cannot damage the original");
});

test("disposed, expired or stale handles become inaccessible without affecting an independent handle", async t => {
  const f = fixture(t), first = await f.read(), second = await f.read();
  disposeVerifiedSelectedOutputShareMedia(first); disposeVerifiedSelectedOutputShareMedia(first);
  assert.equal(accessVerifiedSelectedOutputShareMedia(first, f.output), null); assert.ok(accessVerifiedSelectedOutputShareMedia(second, f.output));
  f.retire(); assert.equal(accessVerifiedSelectedOutputShareMedia(second, f.output), null);
  const g = fixture(t), third = await g.read(); t.mock.method(Date, "now", () => NOW + 60_000);
  assert.equal(accessVerifiedSelectedOutputShareMedia(third, g.output), null);
});

test("borrowed bytes are detached and wiped after success or failure without mutating the owned blob", async t => {
  const f = fixture(t, { kind: "model3d" }), handle = await f.read(); let first, second;
  assert.equal(await withVerifiedSelectedOutputShareMediaBytes(handle, f.output, async bytes => {
    first = bytes; assert.deepEqual(bytes, f.bytes); bytes.fill(3); return "operation result";
  }), "operation result");
  assert.ok(first.every(byte => byte === 0));
  await refuses(withVerifiedSelectedOutputShareMediaBytes(handle, f.output, async bytes => { second = bytes; throw Error("synthetic operation refusal"); }));
  assert.ok(second.every(byte => byte === 0)); assert.notEqual(first, second);
  assert.deepEqual(new Uint8Array(await accessVerifiedSelectedOutputShareMedia(handle, f.output).blob.arrayBuffer()), f.bytes);
});

test("borrowed-byte operations refuse forged/disposed/mismatched handles before invoking the callback", async t => {
  const f = fixture(t, { kind: "model3d" }), handle = await f.read(); let operations = 0;
  const operation = async () => { operations++; };
  await refuses(withVerifiedSelectedOutputShareMediaBytes({ ...handle }, f.output, operation));
  await refuses(withVerifiedSelectedOutputShareMediaBytes(handle, { ...f.output, title: "different" }, operation));
  disposeVerifiedSelectedOutputShareMedia(handle); await refuses(withVerifiedSelectedOutputShareMediaBytes(handle, f.output, operation));
  assert.equal(operations, 0);
});

test("disposal during an outstanding byte operation removes future access and wipes its copy at settlement", async t => {
  const f = fixture(t, { kind: "model3d" }), handle = await f.read(), started = deferred(), held = deferred(); let copy;
  const pending = withVerifiedSelectedOutputShareMediaBytes(handle, f.output, async bytes => { copy = bytes; started.resolve(); await held.promise; return "finished"; });
  await started.promise; disposeVerifiedSelectedOutputShareMedia(handle);
  assert.equal(accessVerifiedSelectedOutputShareMedia(handle, f.output), null);
  await refuses(withVerifiedSelectedOutputShareMediaBytes(handle, f.output, async () => { throw Error("must not invoke"); }));
  assert.deepEqual(copy, f.bytes, "the already-running parse retains its reserved working copy until actual completion");
  held.resolve(); assert.equal(await pending, "finished"); assert.ok(copy.every(byte => byte === 0));
});

test("shared read reservations refuse excess work before transport and release after an aborted unallocated request", async t => {
  assert.equal(SELECTED_OUTPUT_SHARE_MEDIA_BUDGET_BYTES, 256 * 1024 * 1024);
  const active = [];
  for (let index = 0; index < 3; index++) {
    const f = fixture(t, { kind: "video", byteLength: 24_000_000 }), held = deferred(); f.setReply(() => held.promise);
    const rejected = refuses(f.read()); active.push({ f, held, rejected });
    await eventually(() => f.calls.length === 1, "bounded declared read owns its reservation");
  }
  const fourth = fixture(t, { kind: "video", byteLength: 24_000_000 });
  await refuses(fourth.read()); assert.equal(fourth.calls.length, 0);
  active[0].f.controller.abort(); await active[0].rejected;
  fourth.setReply(() => fourth.response({ status: 404 })); await refuses(fourth.read()); assert.equal(fourth.calls.length, 1);
  for (const { f, held, rejected } of active) { f.controller.abort(); held.resolve(f.response({ status: 404 })); await rejected; }
});

test("an aborted non-abortable digest retains its reservation until the real digest promise settles", async t => {
  const digestStarted = deferred(), digestHeld = deferred(), realDigest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", async (...args) => { const result = await realDigest(...args); digestStarted.resolve(); await digestHeld.promise; return result; });
  const small = fixture(t), rejectedSmall = refuses(small.read()); await digestStarted.promise;
  const active = [];
  for (let index = 0; index < 3; index++) {
    const f = fixture(t, { kind: "video", byteLength: 24_000_000 }), held = deferred(); f.setReply(() => held.promise);
    active.push({ f, held, rejected: refuses(f.read()) }); await eventually(() => f.calls.length === 1, "large declaration reserves without receiving bytes");
  }
  const probeBytes = Math.floor((SELECTED_OUTPUT_SHARE_MEDIA_BUDGET_BYTES - 3 * 24_000_000 * 3) / 3);
  const probe = fixture(t, { kind: "video", byteLength: probeBytes });
  small.controller.abort(); await rejectedSmall;
  await refuses(probe.read()); assert.equal(probe.calls.length, 0, "aborted digest still owns its allocation");
  digestHeld.resolve(); await new Promise(setImmediate);
  probe.setReply(() => probe.response({ status: 404 })); await refuses(probe.read()); assert.equal(probe.calls.length, 1, "capacity returns only after digest settlement");
  for (const { f, held, rejected } of active) { f.controller.abort(); held.resolve(f.response({ status: 404 })); await rejected; }
});

test("disposing a handle cannot release the outstanding borrowed Blob/copy reservation early", async t => {
  const small = fixture(t, { kind: "model3d" }), handle = await small.read(), started = deferred(), heldOperation = deferred(); let copy;
  const operation = withVerifiedSelectedOutputShareMediaBytes(handle, small.output, async bytes => { copy = bytes; started.resolve(); await heldOperation.promise; });
  await started.promise; disposeVerifiedSelectedOutputShareMedia(handle);
  const active = [];
  for (let index = 0; index < 3; index++) {
    const f = fixture(t, { kind: "video", byteLength: 24_000_000 }), held = deferred(); f.setReply(() => held.promise);
    active.push({ f, held, rejected: refuses(f.read()) }); await eventually(() => f.calls.length === 1, "large declaration reserves without receiving bytes");
  }
  const probeBytes = Math.floor((SELECTED_OUTPUT_SHARE_MEDIA_BUDGET_BYTES - 3 * 24_000_000 * 3) / 3);
  const probe = fixture(t, { kind: "video", byteLength: probeBytes });
  await refuses(probe.read()); assert.equal(probe.calls.length, 0, "running operation retains reservation after handle disposal");
  heldOperation.resolve(); await operation; assert.ok(copy.every(byte => byte === 0));
  probe.setReply(() => probe.response({ status: 404 })); await refuses(probe.read()); assert.equal(probe.calls.length, 1);
  for (const { f, held, rejected } of active) { f.controller.abort(); held.resolve(f.response({ status: 404 })); await rejected; }
});

test("finite read timeout aborts the request and cancels a response that arrives afterward", async t => {
  let timer, cleared = false;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds) => { assert.equal(milliseconds, SELECTED_OUTPUT_SHARE_MEDIA_READ_TIMEOUT_MS); timer = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", value => { assert.equal(value, 1); cleared = true; });
  const f = fixture(t), held = deferred(); let cancels = 0;
  f.setReply(() => held.promise); const rejected = refuses(f.read()); await eventually(() => f.calls.length === 1, "pending timed read");
  timer(); await rejected; assert.equal(f.calls[0].init.signal.aborted, true); assert.equal(cleared, true);
  const stream = new ReadableStream({ cancel() { cancels++; } }, { highWaterMark: 0 });
  held.resolve(f.response({ body: stream })); await eventually(() => cancels === 1, "late timed-out response cancellation");
});

// Prepared Stable20 files are private server-derived WAVs, never a native MP3
// URL. These synthetic bytes exercise transport integrity only: no decoder,
// provider, real media, publication authority or container qualification runs.
// The prepared backend route matches this finite identifier grammar directly
// in URL.pathname; unlike management DELETE it does not decode percent escapes.
const PREPARED_ID = "candidate-1:stable_audio", PREPARED_FILE = `${ORIGIN}/api/selected-output-shares/${PREPARED_ID}/file`;
const STABLE_BYTES = wav({ samples: 32000 * 20, sampleRate: 32000, channels: 1 });
function preparedFixture(t) {
  t.mock.method(Date, "now", () => NOW);
  const bytes = STABLE_BYTES;
  const output = validateSelectedOutputShareMediaPublicOutput({ schemaVersion: 1, kind: "selected-output-read", output: "audio",
    title: "Reviewed synthetic Stable20 audio", expiresAt: new Date(NOW + 60_000).toISOString(), attribution: "Forma",
    content: { media: { kind: "audio", mimeType: "audio/wav", byteLength: bytes.length, sha256: hash(bytes),
      sampleRate: 32000, channels: 1, sampleCount: 640000, durationSeconds: 20, durationBasis: "pcm-samples" },
    disclosure: { watermark: "not-declared" } } }, NOW);
  assert.ok(output);
  const owner = new AbortController(), preview = new AbortController(), calls = [], handles = [];
  let ownerCurrent = true, previewCurrent = true, reply;
  const ownerControls = { signal: owner.signal, isCurrent: () => ownerCurrent };
  const previewControls = { signal: preview.signal, isCurrent: () => previewCurrent };
  const response = ({ body = bytes, status = 200, url = PREPARED_FILE, redirected = false, headers = {}, omitLength = false } = {}) => {
    const value = new Response(body, { status, headers: { "content-type": "audio/wav", "content-length": String(bytes.length),
      "content-disposition": 'attachment; filename="forma-audio.wav"', ...headers } });
    if (omitLength) value.headers.delete("content-length");
    Object.defineProperty(value, "url", { value: url }); Object.defineProperty(value, "redirected", { value: redirected });
    return value;
  };
  reply = () => response();
  const request = async (url, init) => { calls.push({ url, init }); return reply(url, init); };
  const create = (candidateId = PREPARED_ID, expected = output, origin = ORIGIN, controls = ownerControls, fetcher = request) =>
    createSelectedOutputSharePreparedMediaReader(candidateId, expected, origin, controls, fetcher);
  const reader = create();
  const read = async (expected = output, controls = previewControls, selected = reader) => {
    const handle = await selected(expected, controls); handles.push(handle); return handle;
  };
  t.after(() => { owner.abort(); preview.abort(); for (const handle of handles) disposeVerifiedSelectedOutputShareMedia(handle); });
  return { bytes, output, owner, preview, ownerControls, previewControls, calls, handles, reader, create, read, request, response,
    setReply(value) { reply = value; }, retireOwner() { ownerCurrent = false; }, retirePreview() { previewCurrent = false; } };
}

test("prepared Stable20 factory is synchronous and fetch-free; review reads only its exact private candidate file", async t => {
  const f = preparedFixture(t); assert.equal(typeof f.reader, "function"); assert.equal(f.calls.length, 0);
  for (const omitLength of [true, false]) {
    f.setReply(() => f.response({ omitLength })); const handle = await f.read();
    const access = accessVerifiedSelectedOutputShareMedia(handle, f.output);
    assert.ok(access); assert.equal(access.fileName, "forma-audio.wav"); assert.equal(access.blob.type, "audio/wav");
    assert.deepEqual(new Uint8Array(await access.blob.arrayBuffer()), f.bytes);
  }
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.url, PREPARED_FILE); assert.equal(call.init.method, "GET");
    assert.equal(call.init.credentials, "same-origin"); assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.redirect, "error"); assert.equal(call.init.referrerPolicy, "no-referrer");
    assert.equal(new Headers(call.init.headers).get("accept"), "audio/wav");
    assert.equal(new Headers(call.init.headers).get("range"), null); assert.ok(call.init.signal instanceof AbortSignal);
  }
});

test("prepared factory rejects candidate path injection, foreign origins and non-Stable20 descriptors before transport", async t => {
  const f = preparedFixture(t);
  for (const candidate of ["", ".", "..", "_bad", "-bad", "a/other", "a%2Fother", "a?x=1", "a#x", "a\\other", " a", "a\n", "a".repeat(161), null, 1])
    assert.throws(() => f.create(candidate));
  for (const origin of [ORIGIN + "/", ORIGIN + "/path", "https://foreign.invalid/path", "https://user@forma.test", "data:text/plain,x", "null"])
    assert.throws(() => f.create(PREPARED_ID, f.output, origin));
  for (const output of [publicOutput(wav({ samples: 8 })), publicOutput(wav({ samples: 8 }), "video"), publicOutput(wav({ samples: 8 }), "model3d")])
    assert.throws(() => f.create(PREPARED_ID, output));
  const wrongRate = structuredClone(f.output); wrongRate.content.media.sampleRate = 8000;
  wrongRate.content.media.sampleCount = 160000; wrongRate.content.media.byteLength = 320044;
  assert.ok(validateSelectedOutputShareMediaPublicOutput(wrongRate, NOW)); assert.throws(() => f.create(PREPARED_ID, wrongRate));
  assert.equal(f.calls.length, 0);
});

test("prepared finite candidate identifiers retain the literal pathname accepted by the backend route", async t => {
  const f = preparedFixture(t);
  for (const id of ["a", "candidate.with_underscore-and:colon", "a".repeat(160)]) {
    const reader = f.create(id), url = `${ORIGIN}/api/selected-output-shares/${id}/file`;
    f.setReply(() => f.response({ url }));
    assert.ok(accessVerifiedSelectedOutputShareMedia(await f.read(f.output, f.previewControls, reader), f.output));
    assert.equal(f.calls.at(-1).url, url); assert.equal(new URL(f.calls.at(-1).url).pathname.includes("%"), false);
  }
});

test("prepared factory captures the whole public signature and rejects cross-profile or retargeted previews without a GET", async t => {
  const f = preparedFixture(t), mutable = structuredClone(f.output), reader = f.create(PREPARED_ID, mutable);
  mutable.title = "Changed caller title"; mutable.content.media.sha256 = "b".repeat(64);
  const mutations = [value => { value.title += " changed"; }, value => { value.expiresAt = new Date(NOW + 30_000).toISOString(); },
    value => { value.content.disclosure.watermark = "synthid-declared"; }, value => { value.content.media.sha256 = "c".repeat(64); },
    value => { value.content.media.sampleRate = 44100; value.content.media.sampleCount = 882000; value.content.media.byteLength = 1764044; }];
  for (const mutate of mutations) { const changed = structuredClone(f.output); mutate(changed); await refuses(f.read(changed, f.previewControls, reader)); }
  await refuses(f.read(mutable, f.previewControls, reader));
  await refuses(f.read(publicOutput(wav({ samples: 8 })), f.previewControls, reader));
  assert.equal(f.calls.length, 0);
  const handle = await f.read(structuredClone(f.output), f.previewControls, reader);
  assert.ok(accessVerifiedSelectedOutputShareMedia(handle, f.output)); assert.equal(accessVerifiedSelectedOutputShareMedia(handle, mutable), null);
});

test("prepared public data accessors cannot run at factory or preview capture", async t => {
  const f = preparedFixture(t); let getters = 0;
  const getter = structuredClone(f.output); Object.defineProperty(getter, "content", { enumerable: true, get() { getters++; return f.output.content; } });
  assert.throws(() => f.create(PREPARED_ID, getter)); await refuses(f.read(getter));
  assert.equal(getters, 0); assert.equal(f.calls.length, 0);
});

test("prepared responses require exact attachment, identity encoding, canonical length and the candidate URL", async t => {
  const f = preparedFixture(t);
  const failures = [
    { status: 206 }, { status: 404 }, { redirected: true }, { url: FILE }, { url: ORIGIN + SOURCE },
    { url: PREPARED_FILE.replace(PREPARED_ID, "different-candidate") }, { url: PREPARED_FILE + "?x=1" }, { url: PREPARED_FILE + "#x" },
    { headers: { "content-type": "audio/mpeg" } }, { headers: { "content-type": "audio/x-wav" } },
    { headers: { "content-range": `bytes 0-${f.bytes.length - 1}/${f.bytes.length}` } },
    ...["gzip", "br", "", "identity, gzip"].map(value => ({ headers: { "content-encoding": value }, omitLength: true })),
    ...["", "0", "-1", "1.5", "01", String(f.bytes.length - 1), String(f.bytes.length + 1), "9007199254740992"].map(value => ({ headers: { "content-length": value } })),
    ...["", "inline", 'attachment; filename="private.wav"', 'attachment; filename="forma-audio.mp3"',
      'attachment; filename="forma-audio.wav"; filename*=UTF-8\'\'other.wav'].map(value => ({ headers: { "content-disposition": value } })),
  ];
  for (const failure of failures) { f.setReply(() => f.response(failure)); await refuses(f.read()); }
  f.setReply(() => f.response({ headers: { "content-encoding": "identity" }, omitLength: true }));
  assert.ok(accessVerifiedSelectedOutputShareMedia(await f.read(), f.output));
});

test("prepared absent Content-Length still enforces exact final size and SHA", async t => {
  const f = preparedFixture(t), wrong = new Uint8Array(f.bytes); wrong[wrong.length - 1] ^= 1;
  for (const body of [f.bytes.slice(0, -1), new Uint8Array(f.bytes.length + 1), wrong]) {
    f.setReply(() => f.response({ body, omitLength: true })); await refuses(f.read());
  }
});

test("prepared owner controls are captured at factory time, before any preview or await", async t => {
  for (const mode of ["abort", "retire"]) await t.test(mode, async child => {
    const f = preparedFixture(child), replacement = new AbortController();
    f.ownerControls.signal = replacement.signal; f.ownerControls.isCurrent = () => true;
    if (mode === "abort") f.owner.abort(); else f.retireOwner();
    await refuses(f.read()); assert.equal(f.calls.length, 0);
  });
});

test("prepared factory expiry cannot be restarted by later previews or a backward wall clock", async t => {
  let monotonic = 100; t.mock.method(performance, "now", () => monotonic);
  const f = preparedFixture(t); monotonic += 60_001;
  t.mock.method(Date, "now", () => NOW - 60_000);
  await refuses(f.read()); await refuses(f.read(f.output, { signal: new AbortController().signal, isCurrent: () => true }));
  assert.equal(f.calls.length, 0);
});

for (const layer of ["owner", "preview"]) {
  test(`prepared ${layer} abort simultaneous with response settlement cancels an unread body`, async t => {
    const f = preparedFixture(t), held = deferred(); let pulls = 0, cancels = 0;
    f.setReply(() => held.promise); const rejected = refuses(f.read());
    await eventually(() => f.calls.length === 1, "prepared request is pending");
    const body = new ReadableStream({ pull() { pulls++; }, cancel() { cancels++; } }, { highWaterMark: 0 });
    held.resolve(f.response({ body })); f[layer].abort(); await rejected;
    await eventually(() => cancels === 1, "settled but unread response is cancelled"); assert.equal(pulls, 0);
  });

  test(`prepared ${layer} abort cancels pending fetch and disposes a late body without reading it`, async t => {
    const f = preparedFixture(t), held = deferred(); let pulls = 0, cancels = 0;
    f.setReply(() => held.promise); const rejected = refuses(f.read());
    await eventually(() => f.calls.length === 1, "prepared request started");
    f[layer].abort(); await rejected; assert.equal(f.calls[0].init.signal.aborted, true);
    const body = new ReadableStream({ pull() { pulls++; }, cancel() { cancels++; } }, { highWaterMark: 0 });
    held.resolve(f.response({ body })); await eventually(() => cancels === 1, "late prepared body cancelled"); assert.equal(pulls, 0);
  });

  test(`prepared ${layer} abort interrupts a blocked stream and original controls cannot be replaced`, async t => {
    const f = preparedFixture(t); let reading = false, cancels = 0;
    const body = new ReadableStream({ pull() { reading = true; }, cancel() { cancels++; } }, { highWaterMark: 0 });
    f.setReply(() => f.response({ body })); const rejected = refuses(f.read());
    await eventually(() => reading, "prepared stream read pending");
    const controls = layer === "owner" ? f.ownerControls : f.previewControls;
    controls.signal = new AbortController().signal; controls.isCurrent = () => true;
    f[layer].abort(); await rejected;
    await eventually(() => cancels === 1, "prepared stream cancelled"); assert.equal(f.calls[0].init.signal.aborted, true);
  });

  test(`prepared ${layer} abort during a non-abortable digest never admits later hash success`, { timeout: 5000 }, async t => {
    const f = preparedFixture(t), started = deferred(), held = deferred(), digest = crypto.subtle.digest.bind(crypto.subtle);
    t.mock.method(crypto.subtle, "digest", async (...args) => { const result = await digest(...args); started.resolve(); await held.promise; return result; });
    const rejected = refuses(f.read()); await started.promise; f[layer].abort(); await rejected; held.resolve();
    await new Promise(setImmediate); assert.equal(f.handles.length, 0);
  });

  test(`prepared ${layer} retirement during body delivery refuses without a verified handle`, async t => {
    const f = preparedFixture(t); let cancels = 0;
    const body = new ReadableStream({ pull(controller) {
      if (layer === "owner") f.retireOwner(); else f.retirePreview(); controller.enqueue(f.bytes.slice(0, 8));
    }, cancel() { cancels++; } }, { highWaterMark: 0 });
    f.setReply(() => f.response({ body })); await refuses(f.read()); assert.equal(cancels, 1);
  });
}

test("prepared preview cancellation is isolated while owner retirement invalidates all surviving previews", async t => {
  const f = preparedFixture(t), a = new AbortController(), b = new AbortController(), first = deferred(); let requests = 0;
  f.setReply(() => ++requests === 1 ? first.promise : f.response());
  const rejected = refuses(f.read(f.output, { signal: a.signal, isCurrent: () => true }));
  await eventually(() => f.calls.length === 1, "first independent preview pending");
  const handle = await f.read(f.output, { signal: b.signal, isCurrent: () => true });
  a.abort(); await rejected; first.resolve(f.response());
  assert.ok(accessVerifiedSelectedOutputShareMedia(handle, f.output)); assert.equal(b.signal.aborted, false);
  f.owner.abort(); assert.equal(accessVerifiedSelectedOutputShareMedia(handle, f.output), null);
  await refuses(f.read(f.output, { signal: new AbortController().signal, isCurrent: () => true })); assert.equal(f.calls.length, 2);
});

test("prepared verified handles keep both original predicates after caller control replacement", async t => {
  for (const layer of ["owner", "preview"]) await t.test(layer, async child => {
    const f = preparedFixture(child), handle = await f.read(); assert.ok(accessVerifiedSelectedOutputShareMedia(handle, f.output));
    if (layer === "owner") f.retireOwner(); else f.retirePreview();
    f.ownerControls.isCurrent = () => true; f.previewControls.isCurrent = () => true;
    assert.equal(accessVerifiedSelectedOutputShareMedia(handle, f.output), null);
  });
});

test("prepared cancelled digest retains shared capacity until actual digest settlement", { timeout: 5000 }, async t => {
  const started = deferred(), heldDigest = deferred(), digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", async (...args) => { const result = await digest(...args); started.resolve(); await heldDigest.promise; return result; });
  const prepared = preparedFixture(t), preparedRejected = refuses(prepared.read()); await started.promise;
  const active = [];
  for (let index = 0; index < 3; index++) {
    const f = fixture(t, { kind: "video", byteLength: 24_000_000 }), held = deferred(); f.setReply(() => held.promise);
    active.push({ f, held, rejected: refuses(f.read()) }); await eventually(() => f.calls.length === 1, "shared source reservation");
  }
  const probe = fixture(t, { kind: "video", byteLength: Math.floor((SELECTED_OUTPUT_SHARE_MEDIA_BUDGET_BYTES - 3 * 24_000_000 * 3) / 3) });
  prepared.owner.abort(); await preparedRejected;
  await refuses(probe.read()); assert.equal(probe.calls.length, 0, "prepared digest allocation is still owned");
  heldDigest.resolve(); await new Promise(setImmediate);
  probe.setReply(() => probe.response({ status: 404 })); await refuses(probe.read()); assert.equal(probe.calls.length, 1);
  for (const { f, held, rejected } of active) { f.controller.abort(); held.resolve(f.response({ status: 404 })); await rejected; }
});

test("prepared successful-handle abort detaches both original listeners and returns its shared Blob capacity", async t => {
  for (const layer of ["owner", "preview"]) await t.test(layer, async child => {
    const f = preparedFixture(child), removals = { owner: 0, preview: 0 };
    for (const key of ["owner", "preview"]) {
      const original = f[key].signal.removeEventListener;
      child.mock.method(f[key].signal, "removeEventListener", function (...args) {
        if (args[0] === "abort") removals[key]++; return original.apply(this, args);
      });
    }
    const handle = await f.read(); assert.ok(accessVerifiedSelectedOutputShareMedia(handle, f.output));
    assert.deepEqual(removals, { owner: 0, preview: 0 }, "both retained-handle cancellations stay attached");
    const active = [];
    for (let index = 0; index < 3; index++) {
      const pending = fixture(child, { kind: "video", byteLength: 24_000_000 }), held = deferred(); pending.setReply(() => held.promise);
      active.push({ pending, held, rejected: refuses(pending.read()) });
      await eventually(() => pending.calls.length === 1, "shared source reservation acquired");
    }
    const probe = fixture(child, { kind: "video", byteLength: Math.floor((SELECTED_OUTPUT_SHARE_MEDIA_BUDGET_BYTES - 3 * 24_000_000 * 3) / 3) });
    await refuses(probe.read()); assert.equal(probe.calls.length, 0, "prepared immutable Blob owns its share of capacity");
    f[layer].abort(); assert.equal(accessVerifiedSelectedOutputShareMedia(handle, f.output), null);
    assert.deepEqual(removals, { owner: 1, preview: 1 });
    disposeVerifiedSelectedOutputShareMedia(handle); assert.deepEqual(removals, { owner: 1, preview: 1 }, "disposal is idempotent");
    probe.setReply(() => probe.response({ status: 404 })); await refuses(probe.read()); assert.equal(probe.calls.length, 1);
    for (const { pending, held, rejected } of active) { pending.controller.abort(); held.resolve(pending.response({ status: 404 })); await rejected; }
  });
});

test("prepared reader captures its default fetch at factory time and rejects a revived owner predicate", async t => {
  const f = preparedFixture(t); let current = true;
  const owner = { signal: f.owner.signal, isCurrent: () => current };
  t.mock.method(globalThis, "fetch", f.request);
  const reader = createSelectedOutputSharePreparedMediaReader(PREPARED_ID, f.output, ORIGIN, owner);
  t.mock.method(globalThis, "fetch", () => { throw Error("replacement global fetch must not be used"); });
  assert.equal(f.calls.length, 0);
  assert.ok(accessVerifiedSelectedOutputShareMedia(await f.read(f.output, f.previewControls, reader), f.output));
  current = false; await refuses(f.read(f.output, f.previewControls, reader));
  current = true; await refuses(f.read(f.output, f.previewControls, reader));
  assert.equal(f.calls.length, 1, "once observed stale, the prepared owner lease cannot revive");
});

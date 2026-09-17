import assert from "node:assert/strict";
import test from "node:test";
import { nativeMediaFixture, retainAuthoredMedia, retainOriginalMediaRestore, CONTENT, OWNER, digest, syntheticMediaBytes, syntheticMediaPolicy } from "./helpers/native-media-custody-fixture.mjs";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
const imports = registerOutputSourceImports();
let readNativeRetainedMediaCustody, readNativeRetainedMediaBytes, copyCurrentNativeRetainedMediaBytes;
try {
  ({ readNativeRetainedMediaCustody } = await import("../worker/native-retained-media-custody.ts"));
  ({ readNativeRetainedMediaBytes, copyCurrentNativeRetainedMediaBytes } = await import("../worker/native-retained-media-bytes.ts"));
} finally { imports.deregister(); }
const unavailable = /retained_story_unavailable/u;
const ready = async (f, controller = new AbortController(), selection = f.select()) => ({ controller,
  custody: await readNativeRetainedMediaCustody(f.env, f.identity, selection, controller.signal) });
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const [output, options] of [["audio", {}], ["video", {}], ["video", { encoder: true }], ["model3d", {}], ["model3d", { textured: true }]]) {
  test(`current ${output} ${JSON.stringify(options)} qualifies exactly one unchanged native file without writes`, async t => {
    const f = await nativeMediaFixture(t, output, options), { custody } = await ready(f), before = f.changes();
    const proof = await readNativeRetainedMediaBytes(custody, f.env);
    assert.deepEqual(Reflect.ownKeys(proof), ["descriptor"]); assert(Object.isFrozen(proof)); assert(Object.isFrozen(proof.descriptor));
    assert.equal(proof.descriptor.kind, output); assert.equal(proof.descriptor.sha256, digest(f.currentBytes));
    assert.equal(proof.descriptor.byteLength, f.currentBytes.length);
    assert.deepEqual(await copyCurrentNativeRetainedMediaBytes(proof, f.env), f.currentBytes);
    const first = await copyCurrentNativeRetainedMediaBytes(proof, f.env); first.fill(0);
    assert.deepEqual(await copyCurrentNativeRetainedMediaBytes(proof, f.env), f.currentBytes);
    assert.deepEqual(f.mediaCalls, [f.key]); assert.equal(f.changes(), before);
    const serialized = JSON.stringify(proof);
    for (const privateValue of [f.url, f.key, OWNER, CONTENT, "Private", "prompt", "policy", "documentId", "artifactId"])
      assert(!serialized.includes(privateValue), privateValue);
  });
}

for (const mutation of ["missing", "owner", "scope", "mime", "hash", "size", "bytes"]) test(`owned byte read refuses ${mutation}`, async t => {
  const f = await nativeMediaFixture(t, "audio"), { custody } = await ready(f), object = f.media.get(f.key);
  if (mutation === "missing") f.media.delete(f.key);
  if (mutation === "owner") object.metadata.ownerId = "other";
  if (mutation === "scope") object.metadata.projectAccessId = "other";
  if (mutation === "mime") object.metadata.mimeType = "audio/mpeg";
  if (mutation === "hash") object.metadata.sha256 = "a".repeat(64);
  if (mutation === "size") object.bytes = object.bytes.slice(1);
  if (mutation === "bytes") object.bytes[object.bytes.length - 1] ^= 1;
  await assert.rejects(readNativeRetainedMediaBytes(custody, f.env), unavailable); assert.deepEqual(f.mediaCalls, [f.key]);
});
for (const mutation of ["modelFormat", "modelPreviewSafe", "rights", "rights_status", "license_expires_at"]) test(`GLB enforces ${mutation}`, async t => {
  const f = await nativeMediaFixture(t, "model3d"), { custody } = await ready(f);
  f.media.get(f.key).metadata[mutation] = { modelFormat: "obj", modelPreviewSafe: "false", rights: "revoked", rights_status: "denied", license_expires_at: "2001-01-01T00:00:00.000Z" }[mutation];
  await assert.rejects(readNativeRetainedMediaBytes(custody, f.env), unavailable);
});

test("strict profiles never fall back to encoder or texture profiles", async t => {
  for (const [output, options] of [["video", { encoder: true }], ["model3d", { textured: true }]]) await t.test(output, async child => {
    const f = await nativeMediaFixture(child, output, options), { custody } = await ready(f, undefined,
      f.select(0, { policy: syntheticMediaPolicy(output) }));
    await assert.rejects(readNativeRetainedMediaBytes(custody, f.env), unavailable);
  });
});
test("descriptive WAV chunks remain readable native media but fail selected-byte qualification", async t => {
  const wav = syntheticMediaBytes("audio"), bytes = new Uint8Array(wav.length + 12); bytes.set(wav);
  bytes.set(new TextEncoder().encode("LIST"), wav.length); new DataView(bytes.buffer).setUint32(wav.length + 4, 4, true);
  bytes.set(new TextEncoder().encode("INFO"), wav.length + 8); new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  const f = await nativeMediaFixture(t, "audio", { bytes }); assert.equal((await f.readNative()).status, 200);
  const { custody } = await ready(f); await assert.rejects(readNativeRetainedMediaBytes(custody, f.env), unavailable);
});

for (const phase of ["R2", "final SQL", "copy"]) test(`late content retirement at ${phase} cannot expose a buffer`, async t => {
  const f = await nativeMediaFixture(t, "audio"), { custody } = await ready(f);
  const redact = () => f.sqlite.prepare("UPDATE private_content SET redacted_at='2001-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
  if (phase === "R2") f.setBeforeMediaGet(redact);
  let proof;
  if (phase === "copy") { proof = await readNativeRetainedMediaBytes(custody, f.env); redact(); }
  if (phase === "final SQL") { let reads = 0; f.setBeforeRead(sql => { if (sql.includes("expected_events AS") && ++reads === 2) redact(); }); }
  await assert.rejects(phase === "copy" ? copyCurrentNativeRetainedMediaBytes(proof, f.env) : readNativeRetainedMediaBytes(custody, f.env), unavailable);
});
for (const binding of ["DB", "MEDIA", "FORMA_PILOT_COHORT_ID", "FORMA_ADMIN_EMAILS"]) test(`byte proof refuses ${binding} change while reading`, async t => {
  const f = await nativeMediaFixture(t, "audio"), { custody } = await ready(f);
  f.setBeforeMediaGet(() => { f.env[binding] = binding === "DB" || binding === "MEDIA" ? { ...f.env[binding] } : "changed"; });
  await assert.rejects(readNativeRetainedMediaBytes(custody, f.env), unavailable);
});
test("forged opaque proofs and different environment cannot copy retained bytes", async t => {
  const f = await nativeMediaFixture(t, "audio"), { custody } = await ready(f), proof = await readNativeRetainedMediaBytes(custody, f.env);
  for (const forged of [{}, { ...proof }, structuredClone(proof), Object.create(proof), new Proxy(proof, {})])
    await assert.rejects(copyCurrentNativeRetainedMediaBytes(forged, f.env), unavailable);
  await assert.rejects(copyCurrentNativeRetainedMediaBytes(proof, { ...f.env }), unavailable);
});

for (const fault of ["short", "long", "nonbyte", "many-empty"]) test(`bounded stream refuses ${fault}`, async t => {
  const f = await nativeMediaFixture(t, "audio"), get = f.env.MEDIA.get.bind(f.env.MEDIA);
  f.env.MEDIA.get = async key => {
    const object = await get(key); let reads = 0;
    const body = new ReadableStream({ pull(controller) {
      reads++;
      if (fault === "many-empty") { controller.enqueue(new Uint8Array(0)); return; }
      if (reads > 1) { controller.close(); return; }
      controller.enqueue(fault === "short" ? f.currentBytes.slice(1) : fault === "long" ? new Uint8Array(f.currentBytes.length + 1) : "wrong");
    } });
    return { ...object, body };
  };
  const { custody } = await ready(f); await assert.rejects(readNativeRetainedMediaBytes(custody, f.env), unavailable);
});
test("aborting an unresponsive R2 get rejects promptly and cancels a late body", async t => {
  const f = await nativeMediaFixture(t, "audio"), get = f.env.MEDIA.get.bind(f.env.MEDIA), controller = new AbortController();
  let resolve, cancelled = 0; f.env.MEDIA.get = () => new Promise(done => { resolve = done; });
  const { custody } = await ready(f, controller), pending = readNativeRetainedMediaBytes(custody, f.env);
  await flush(); assert.equal(typeof resolve, "function"); controller.abort(); await assert.rejects(pending, unavailable);
  const object = await get(f.key); resolve({ ...object, body: new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }) });
  await flush(); assert.equal(cancelled, 1);
});
test("aborting a stalled stream never waits for its cancellation", async t => {
  const f = await nativeMediaFixture(t, "audio"), get = f.env.MEDIA.get.bind(f.env.MEDIA), controller = new AbortController(); let cancelled = 0;
  f.env.MEDIA.get = async key => ({ ...await get(key), body: new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled++; return new Promise(() => {}); } }) });
  const { custody } = await ready(f, controller), pending = readNativeRetainedMediaBytes(custody, f.env);
  await flush(); controller.abort(); await assert.rejects(pending, unavailable); assert.equal(cancelled, 1);
});
test("whole-operation timer races a stalled final SQL read", async t => {
  const f = await nativeMediaFixture(t, "audio"), { custody } = await ready(f); let finals = 0;
  f.setBeforeRead(sql => { if (sql.includes("expected_events AS") && ++finals === 2) return new Promise(() => {}); });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = readNativeRetainedMediaBytes(custody, f.env); const rejected = assert.rejects(pending, unavailable);
  for (let count = 0; count < 30 && finals < 2; count++) await flush(); assert.equal(finals, 2);
  t.mock.timers.tick(30_000); await rejected;
});
test("copies expire with the original finite operation budget", async t => {
  const f = await nativeMediaFixture(t, "audio"), { custody } = await ready(f), proof = await readNativeRetainedMediaBytes(custody, f.env);
  const now = Date.now(); t.mock.method(Date, "now", () => now + 30_001);
  await assert.rejects(copyCurrentNativeRetainedMediaBytes(proof, f.env), unavailable);
});

test("concurrent get resolution and abort still owns and cancels the acquired body", async t => {
  const f = await nativeMediaFixture(t, "audio"), get = f.env.MEDIA.get.bind(f.env.MEDIA), controller = new AbortController();
  let resolve, cancelled = 0; f.env.MEDIA.get = () => new Promise(done => { resolve = done; });
  const { custody } = await ready(f, controller), pending = readNativeRetainedMediaBytes(custody, f.env);
  await flush(); const object = await get(f.key);
  resolve({ ...object, body: new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}); } }) });
  controller.abort(); await assert.rejects(pending, unavailable); assert.equal(cancelled, 1);
});

for (const output of ["audio", "video", "model3d"]) test(`authored ${output} obeys its exact profile and original restore preserves bytes`, async t => {
  const f = await nativeMediaFixture(t, output, output === "video" ? { editable: true } : {});
  const edited = await retainAuthoredMedia(f), editedReady = await ready(f, undefined, edited.selection);
  let proof;
  if (output === "model3d") {
    // Actual scale edits append POSITION data and preserve unused source data.
    // Native private custody accepts that edit; the strict sharing gate refuses it.
    assert.equal((await f.readNative(edited.selection)).status, 200);
    await assert.rejects(readNativeRetainedMediaBytes(editedReady.custody, f.env), unavailable);
  } else {
    proof = await readNativeRetainedMediaBytes(editedReady.custody, f.env);
    assert.deepEqual(await copyCurrentNativeRetainedMediaBytes(proof, f.env), edited.bytes);
  }
  assert.deepEqual(f.mediaCalls, [edited.key]);
  const restored = await retainOriginalMediaRestore(f);
  if (proof) await assert.rejects(copyCurrentNativeRetainedMediaBytes(proof, f.env), unavailable);
  const restoredReady = await ready(f, undefined, restored.selection), original = await readNativeRetainedMediaBytes(restoredReady.custody, f.env);
  assert.deepEqual(await copyCurrentNativeRetainedMediaBytes(original, f.env), f.originalBytes);
  assert.deepEqual(f.mediaCalls, [edited.key, f.originalKey]);
});
for (const output of ["audio", "video", "model3d"]) test(`authored ${output} rejects altered native storage provenance`, async t => {
  for (const field of ["source", "sourceMediaSha256", "sourceRevision", "requestSha256", "artifactId"]) await t.test(field, async child => {
    const f = await nativeMediaFixture(child, output, output === "video" ? { editable: true } : {});
    const edited = await retainAuthoredMedia(f), { custody } = await ready(f, undefined, edited.selection);
    f.media.get(edited.key).metadata[field] = "changed";
    await assert.rejects(readNativeRetainedMediaBytes(custody, f.env), unavailable);
  });
});

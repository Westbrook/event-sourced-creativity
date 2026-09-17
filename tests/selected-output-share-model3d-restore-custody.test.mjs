import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { originalOutputsMediaFixture, retainOriginalOutputsModel3dRevision } from "./helpers/selected-output-share-media-outputs-fixture.mjs";
import { forbidSelectedOutputShareNetwork } from "./helpers/selected-output-share-media-lifecycle-fixture.mjs";

const imports = registerOutputSourceImports();
let snapshot, current, readBytes, copyBytes;
try {
  ({ nativeRetainedMediaCustodySnapshot: snapshot, assertNativeRetainedMediaCustody: current } = await import("../worker/native-retained-media-custody.ts"));
  ({ readNativeRetainedMediaBytes: readBytes, copyCurrentNativeRetainedMediaBytes: copyBytes } = await import("../worker/native-retained-media-bytes.ts"));
} finally { imports.deregister(); }

async function restoredFixture(t) {
  forbidSelectedOutputShareNetwork(t);
  const f = await originalOutputsMediaFixture(t, "model3d", { mediaBytes: true });
  const scaled = await retainOriginalOutputsModel3dRevision(f, "scale");
  const restored = await retainOriginalOutputsModel3dRevision(f, "restore");
  return { f, scaled, restored };
}
const unavailable = error => error instanceof Error && /unavailable/u.test(error.message);

test("restored Outputs GLB keeps current revision while proving the genuine retained original and exact selected bytes", async t => {
  const { f, scaled, restored } = await restoredFixture(t), before = f.changes();
  const proof = await f.read(restored.selection), value = snapshot(proof, f.env);
  assert.deepEqual({ ...value.selection }, restored.selection);
  assert.equal(value.selection.revision, 2);
  assert.equal(value.dto.selection.revision, 2);
  assert.equal(value.dto.selection.contentSha256, restored.selection.contentSha256);
  assert.deepEqual(value.nativeOriginal, { output: "model3d", relation: "selected-restored-original", originalRevision: 0,
    originalContentSha256: f.selection.contentSha256, selectedRevision: 2, selectedContentSha256: restored.selection.contentSha256,
    mediaSha256: f.selection.mediaSha256, mediaByteLength: f.expectedBytes.length });
  assert.ok(Object.isFrozen(value.nativeOriginal));
  assert.notEqual(value.media.sha256, scaled.selection.mediaSha256);
  assert.equal(value.media.url, f.originalUrl);
  assert.deepEqual(f.stats, { gets: 0, heads: 0, writes: 0 }, "the genuine original metadata bridge performs no media fetch");
  const qualified = await readBytes(proof, f.env), bytes = await copyBytes(qualified, f.env);
  assert.deepEqual(bytes, f.expectedBytes);
  await current(proof, f.env);
  assert.equal(f.changes(), before);
  assert.deepEqual(f.stats, { gets: 1, heads: 0, writes: 0 });
  await assert.rejects(f.read(f.selection), unavailable);
  await assert.rejects(f.read(scaled.selection), unavailable);
});

test("restored original source expiry remains an independent effective current-custody deadline", async t => {
  const { f, restored } = await restoredFixture(t);
  const earlier = new Date(Date.now() + 30_000).toISOString();
  f.sqlite.prepare("UPDATE artifact_revisions SET expires_at=? WHERE revision=0").run(earlier);
  const proof = await f.read(restored.selection), value = snapshot(proof, f.env);
  assert.equal(value.expiresAt, earlier);
  assert.equal(value.sourceExpiresAt, f.expiry);
  f.sqlite.prepare("UPDATE artifact_revisions SET expires_at=? WHERE revision=0").run(f.expiry);
  await assert.rejects(current(proof, f.env), unavailable);
});

test("the final current proof pins original snapshot and paid native witness alongside current restore", async t => {
  const { f, restored } = await restoredFixture(t), proof = await f.read(restored.selection);
  const mutations = [
    ["original snapshot bytes", () => f.sqlite.prepare("UPDATE artifact_revisions SET content_json=content_json||' ' WHERE revision=0").run()],
    ["original snapshot hash", () => f.sqlite.prepare("UPDATE artifact_revisions SET content_sha256=? WHERE revision=0").run("a".repeat(64))],
    ["original snapshot expiry", () => f.sqlite.prepare("UPDATE artifact_revisions SET expires_at=? WHERE revision=0").run("2000-01-01T00:00:00.000Z")],
    ["original snapshot redaction", () => f.sqlite.prepare("UPDATE artifact_revisions SET redacted_at=? WHERE revision=0").run(f.expiry)],
    ["original snapshot removal", () => f.sqlite.prepare("DELETE FROM artifact_revisions WHERE revision=0").run()],
    ["original paid call", () => f.sqlite.prepare("UPDATE output_provider_calls SET request_digest=?").run("b".repeat(64))],
    ["original published storage", () => f.sqlite.prepare("UPDATE output_native_storage_writes SET write_acknowledged=0").run()],
    ["original private input", () => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE kind='document-artifact-input'").run(f.expiry)],
    ["current content", () => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id='content'").run()],
    ["current restore body", () => f.sqlite.prepare("UPDATE event_private_payloads SET private_json=private_json||' ' WHERE private_event_id=?").run(restored.event.eventId)],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    f.sqlite.exec("SAVEPOINT current_bridge_change");
    try { mutate(); const changed = f.changes(); await assert.rejects(current(proof, f.env), unavailable); assert.equal(f.changes(), changed); }
    finally { f.sqlite.exec("ROLLBACK TO current_bridge_change; RELEASE current_bridge_change"); }
    await current(proof, f.env);
  });
  assert.deepEqual(f.stats, { gets: 0, heads: 0, writes: 0 });
});

test("a missing or changed genuine original snapshot cannot be replaced by the restored current body", async t => {
  const { f, restored } = await restoredFixture(t);
  for (const sql of ["DELETE FROM artifact_revisions WHERE revision=0",
    "UPDATE artifact_revisions SET content_json=content_json||' ' WHERE revision=0",
    "UPDATE artifact_revisions SET redacted_at='2026-01-01T00:00:00.000Z' WHERE revision=0"]) {
    f.sqlite.exec("SAVEPOINT missing_original");
    try { f.sqlite.exec(sql); await assert.rejects(f.read(restored.selection), unavailable); }
    finally { f.sqlite.exec("ROLLBACK TO missing_original; RELEASE missing_original"); }
  }
  assert.deepEqual(f.stats, { gets: 0, heads: 0, writes: 0 });
});

test("a scaled current selection never acquires an original-byte bridge", async t => {
  forbidSelectedOutputShareNetwork(t);
  const f = await originalOutputsMediaFixture(t, "model3d", { mediaBytes: true });
  const scaled = await retainOriginalOutputsModel3dRevision(f, "scale"), proof = await f.read(scaled.selection), value = snapshot(proof, f.env);
  assert.equal(value.selection.revision, 1);
  assert.equal(value.nativeOriginal, null);
  assert.equal(value.media.sha256, scaled.selection.mediaSha256);
  assert.notEqual(value.media.url, f.originalUrl);
  assert.notEqual(value.media.sha256, f.selection.mediaSha256);
  await assert.rejects(readBytes(proof, f.env), unavailable);
  assert.equal(f.stats.gets, 1, "one selected scaled-file read, never a fallback original read");
});

test("the last original snapshot check refuses an intervening retirement", async t => {
  const { f, restored } = await restoredFixture(t); let retired = false;
  f.setBeforeRead(sql => { if (sql.includes("expected_events AS") && sql.includes("model3d_proof AS MATERIALIZED")) {
    retired = true; f.sqlite.prepare("UPDATE artifact_revisions SET redacted_at=? WHERE revision=0").run(f.expiry);
  } });
  await assert.rejects(f.read(restored.selection), unavailable);
  assert.equal(retired, true);
  assert.deepEqual(f.stats, { gets: 0, heads: 0, writes: 0 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { nativeMediaFixture, retainAuthoredMedia, retainOriginalMediaRestore, retainMediaSourceSnapshot,
  syntheticMediaUrl, digest, OWNER, EMAIL, DOCUMENT, PROJECT, ARTIFACT, CONTENT, EXPIRY } from "./helpers/native-media-custody-fixture.mjs";
const imports = registerOutputSourceImports();
let readNativeRetainedMediaCustody, nativeRetainedMediaCustodySnapshot, nativeRetainedMediaCustodyAssertion;
let assertNativeRetainedMediaCustody, copyNativeRetainedMediaOriginalVideoBytes, Unavailable;
try {
  ({ readNativeRetainedMediaCustody, nativeRetainedMediaCustodySnapshot, nativeRetainedMediaCustodyAssertion,
    assertNativeRetainedMediaCustody, copyNativeRetainedMediaOriginalVideoBytes } = await import("../worker/native-retained-media-custody.ts"));
  ({ Unavailable } = await import("../worker/native-retained-text-custody.ts"));
} finally { imports.deregister(); }
const kinds = ["audio", "video", "model3d"];
const unavailable = error => error instanceof Unavailable;
const read = (f, selection = f.select(), signal = new AbortController().signal, identity = f.identity) => readNativeRetainedMediaCustody(f.env, identity, selection, signal);
const current = (f, proof) => assertNativeRetainedMediaCustody(proof, f.env);
const snapshot = (f, proof) => nativeRetainedMediaCustodySnapshot(proof, f.env);
const deepFrozen = value => { if (value && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(deepFrozen); } };

// These are actual canonical native readers over synthetic SQLite records and
// owned fixture assets. They certify current private custody, not share access,
// provider completion, public release, financial settlement or user approval.
for (const output of kinds) test(`${output}: ordinary hosted DTO and opaque current-custody DTO match exactly`, async t => {
  const f = await nativeMediaFixture(t, output), before = f.changes(), response = await f.readNative();
  assert.equal(response.status, 200); const native = await response.json();
  const proof = await read(f), observed = snapshot(f, proof); deepFrozen(observed);
  assert.deepEqual(observed.dto, native); assert.deepEqual(observed.identity, f.identity);
  assert.deepEqual({ ...observed.selection }, f.select()); assert.equal(observed.contentId, CONTENT);
  assert.equal(observed.projectId, PROJECT); assert.equal(observed.completionId, f.completion.eventId);
  assert.equal(observed.sourceExpiresAt, EXPIRY); assert.equal(observed.expiresAt, EXPIRY);
  assert.equal(observed.media.url, f.url); assert.equal(observed.media.sha256, digest(f.currentBytes));
  assert.equal(observed.media.readMode, "owned-media"); assert.equal(observed.media.byteLength, output === "model3d" ? f.currentBytes.length : null);
  assert.equal(copyNativeRetainedMediaOriginalVideoBytes(proof, f.env), null);
  const assertion = nativeRetainedMediaCustodyAssertion(proof, f.env);
  assert.match(assertion.sql, /^WITH /u); assert.match(assertion.sql, /SELECT 1 AS admitted FROM private_content/u);
  assert.match(assertion.sql, /CAST\(private_json AS BLOB\)=CAST\(\? AS BLOB\)/u);
  assert.ok(assertion.bindings.length <= 100); assert.ok(Buffer.byteLength(assertion.sql) <= 100_000);
  assertion.bindings.fill(null); assert.notDeepEqual(nativeRetainedMediaCustodyAssertion(proof, f.env).bindings, assertion.bindings);
  await current(f, proof); assert.equal(f.changes(), before); assert.deepEqual(f.mediaCalls, []);
});

for (const [output, options] of [["video", { encoder: true }], ["model3d", { textured: true }]])
  test(`${output}: explicit alternate byte profile remains a private declared selection`, async t => {
    const f = await nativeMediaFixture(t, output, options), proof = await read(f);
    assert.equal(snapshot(f, proof).selection.policy, f.select().policy); assert.equal(f.mediaCalls.length, 0);
    assert.deepEqual(snapshot(f, proof).dto, await (await f.readNative()).json());
  });

const sourceChanges = [
  ["raw content bytes", f => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(CONTENT)],
  ["source redaction", f => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z", CONTENT)],
  ["source owner", f => f.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(CONTENT)],
  ["expired source", f => f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z", CONTENT)],
  ["extended source lifetime", f => f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2099-02-01T00:00:00.000Z", CONTENT)],
  ["private completion bytes", f => f.changePrivate(p => p.input_ref = "changed-input")],
  ["private completion redaction", f => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(EXPIRY, f.completion.eventId)],
  ["private completion owner", f => f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(f.completion.eventId)],
  ["private completion document", f => f.sqlite.prepare("UPDATE event_private_payloads SET document_id='other' WHERE private_event_id=?").run(f.completion.eventId)],
  ["private completion project", f => f.sqlite.prepare("UPDATE event_private_payloads SET project_id='other' WHERE private_event_id=?").run(f.completion.eventId)],
  ["principal role", f => f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER)],
  ["principal consent", f => f.sqlite.prepare("UPDATE users SET consent_version='withdrawn' WHERE user_id=?").run(OWNER)],
  ["principal epoch", f => f.sqlite.prepare("UPDATE users SET updated_at=? WHERE user_id=?").run(EXPIRY, OWNER)],
  ["organization project", f => f.sqlite.prepare("INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)").run("tenant-access", PROJECT, "tenant", OWNER, "active", EXPIRY, EXPIRY)],
  ...["content", "document", "artifact"].map(kind => [`scoped ${kind}`, f => f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("tenant-access", kind, { content: CONTENT, document: DOCUMENT, artifact: ARTIFACT }[kind], "tenant", PROJECT, OWNER, OWNER, EXPIRY)]),
  ["scoped completion", f => f.sqlite.prepare("INSERT INTO project_event_scopes VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(f.completion.eventId, "tenant-access", "tenant", PROJECT, OWNER, `creative:${OWNER}`, 2, 1, OWNER, EXPIRY)],
  ["governed retention", f => f.sqlite.prepare("INSERT INTO private_content_retention_scopes VALUES(?,?,?,?,?,?,?,?,?)")
    .run(CONTENT, "tenant", "tenant-access", PROJECT, OWNER, "internal", 1, EXPIRY, EXPIRY)],
];
for (const output of kinds) test(`${output}: complete native final SELECT rejects every independent current-custody change`, async t => {
  const f = await nativeMediaFixture(t, output), proof = await read(f);
  for (const [name, mutate] of sourceChanges) await t.test(name, async () => {
    f.sqlite.exec("SAVEPOINT custody_change");
    try { mutate(f); const after = f.changes(); await assert.rejects(current(f, proof), unavailable); assert.equal(f.changes(), after); }
    finally { f.sqlite.exec("ROLLBACK TO custody_change; RELEASE custody_change"); }
    await current(f, proof);
  });
  await f.append("DocumentRemoved", {}); const after = f.changes();
  await assert.rejects(current(f, proof), unavailable); await assert.rejects(read(f), unavailable);
  assert.equal(f.changes(), after); assert.deepEqual(f.mediaCalls, []);
});
for (const output of kinds) test(`${output}: the final observation refuses an intervening native receipt mutation`, async t => {
  const f = await nativeMediaFixture(t, output); let mutated = false, after;
  f.setBeforeRead(sql => { if (sql.includes("expected_events AS")) {
    mutated = true; f.changePrivate(p => p.content_ref = "other"); after = f.changes();
  } });
  await assert.rejects(read(f), unavailable); assert.ok(mutated); assert.equal(f.changes(), after); assert.deepEqual(f.mediaCalls, []);
});

test("identity capture refuses foreign, non-hosted, accessor, extra-field and inherited identities", async t => {
  const f = await nativeMediaFixture(t, "audio"); let getters = 0;
  const getter = { ...f.identity }; Object.defineProperty(getter, "email", { enumerable: true, get() { getters++; return EMAIL; } });
  for (const identity of [{ ...f.identity, userId: "other" }, { ...f.identity, email: "other@example.test" },
    { ...f.identity, source: "local-development" }, { ...f.identity, email: EMAIL.toUpperCase() },
    { ...f.identity, extra: true }, Object.create(f.identity), getter, { ...f.identity, userId: OWNER + "\n" }]) {
    const before = f.changes(); await assert.rejects(read(f, f.select(), undefined, identity), unavailable); assert.equal(f.changes(), before);
  }
  assert.equal(getters, 0);
});
test("selection capture rejects the wrong exact document, artifact, revision, content, media, kind and profile", async t => {
  const f = await nativeMediaFixture(t, "video"); let getters = 0;
  const selection = f.select(); Object.defineProperty(selection, "mediaSha256", { enumerable: true, get() { getters++; return digest(f.currentBytes); } });
  for (const selected of [{ ...f.select(), documentId: "other" }, { ...f.select(), artifactId: "other" },
    { ...f.select(), revision: 1 }, { ...f.select(), contentSha256: "a".repeat(64) }, { ...f.select(), mediaSha256: "a".repeat(64) },
    { ...f.select(), output: "audio" }, { ...f.select(), policy: "unknown" }, { ...f.select(), url: f.url }, selection]) {
    const before = f.changes(); await assert.rejects(read(f, selected), unavailable); assert.equal(f.changes(), before);
  }
  assert.equal(getters, 0); assert.deepEqual(f.mediaCalls, []);
});
test("only the exact local proof and environment recover private snapshot, SQL and already-owned bytes", async t => {
  const f = await nativeMediaFixture(t, "audio"), proof = await read(f), reads = f.calls.length;
  for (const forged of [{}, { ...proof }, JSON.parse(JSON.stringify(proof)), new Proxy(proof, {}), Object.create(proof), null]) {
    assert.throws(() => snapshot(f, forged), unavailable);
    assert.throws(() => nativeRetainedMediaCustodyAssertion(forged, f.env), unavailable);
    assert.throws(() => copyNativeRetainedMediaOriginalVideoBytes(forged, f.env), unavailable);
    await assert.rejects(current(f, forged), unavailable);
  }
  assert.throws(() => nativeRetainedMediaCustodySnapshot(proof, { ...f.env }), unavailable);
  assert.equal(f.calls.length, reads); deepFrozen(snapshot(f, proof));
});
for (const name of ["DB", "MEDIA", "FORMA_PILOT_COHORT_ID", "FORMA_ADMIN_EMAILS"]) {
  test(`captured ${name} change after a native await refuses issuing custody`, async t => {
    const f = await nativeMediaFixture(t, "audio"); let mutated = false;
    f.setBeforeRead(sql => { if (!mutated && sql.startsWith("SELECT content,expires_at")) {
      mutated = true; f.env[name] = name === "DB" ? { ...f.env.DB } : name === "MEDIA" ? { ...f.env.MEDIA } : "changed";
    } });
    await assert.rejects(read(f), unavailable); assert.ok(mutated); assert.equal(f.calls.some(sql => sql.includes("expected_events AS")), false);
  });
  test(`captured ${name} change invalidates an issued native proof`, async t => {
    const f = await nativeMediaFixture(t, "audio"), proof = await read(f), reads = f.calls.length;
    f.env[name] = name === "DB" ? { ...f.env.DB } : name === "MEDIA" ? { ...f.env.MEDIA } : "changed";
    assert.throws(() => snapshot(f, proof), unavailable); await assert.rejects(current(f, proof), unavailable);
    assert.equal(f.calls.length, reads);
  });
}
for (const phase of ["before", "principal", "raw", "final", "after"]) test(`abort at ${phase} invalidates current custody`, async t => {
  const f = await nativeMediaFixture(t, "audio"), controller = new AbortController();
  if (phase === "before") controller.abort();
  f.setBeforeRead(sql => {
    if (phase === "principal" && sql.includes("SELECT auth_json FROM authorized") || phase === "raw" && sql.startsWith("SELECT content,expires_at")
      || phase === "final" && sql.includes("expected_events AS")) controller.abort();
  });
  if (phase === "after") {
    const proof = await read(f, f.select(), controller.signal); controller.abort();
    assert.throws(() => snapshot(f, proof), unavailable); await assert.rejects(current(f, proof), unavailable);
  } else await assert.rejects(read(f, f.select(), controller.signal), unavailable);
  if (phase === "before") assert.equal(f.calls.length, 0);
});

test("an issued proof expires at its exact captured native source deadline", async t => {
  const f = await nativeMediaFixture(t, "audio"), proof = await read(f), originalNow = Date.now;
  try { Date.now = () => Date.parse(EXPIRY); assert.throws(() => snapshot(f, proof), unavailable); await assert.rejects(current(f, proof), unavailable); }
  finally { Date.now = originalNow; }
});

for (const output of kinds) test(`${output}: exact current authored media and explicit original restore preserve hosted DTO parity`, async t => {
  const f = await nativeMediaFixture(t, output, { editable: true }), original = f.select(), old = await read(f);
  const edited = await retainAuthoredMedia(f), before = f.changes(), proof = await read(f, edited.selection);
  const native = await f.readNative(edited.selection); assert.equal(native.status, 200);
  assert.deepEqual(snapshot(f, proof).dto, await native.json()); assert.deepEqual(snapshot(f, proof).media[`${output}Revision`], edited.revision);
  assert.equal(snapshot(f, proof).media.url, edited.url); assert.equal(snapshot(f, proof).media.byteLength, edited.bytes.length);
  await assert.rejects(current(f, old), unavailable); await assert.rejects(read(f, original), unavailable);
  await assert.rejects(read(f, { ...edited.selection, mediaSha256: digest(f.originalBytes) }), unavailable);
  assert.equal(f.changes(), before); assert.deepEqual(f.mediaCalls, []);
  const restored = await retainOriginalMediaRestore(f), after = f.changes(), restoredProof = await read(f, restored.selection);
  assert.deepEqual(snapshot(f, restoredProof).dto, await (await f.readNative(restored.selection)).json());
  assert.equal(snapshot(f, restoredProof).media.url, f.originalUrl); assert.equal(snapshot(f, restoredProof).media[`${output}Revision`], null);
  await assert.rejects(current(f, proof), unavailable); assert.equal(f.changes(), after);
});
for (const output of kinds) test(`${output}: latest exact authored private envelope remains in the final proof`, async t => {
  const f = await nativeMediaFixture(t, output, { editable: true }), edited = await retainAuthoredMedia(f), proof = await read(f, edited.selection);
  f.changePrivate(p => p[`${output}_revision`].media.sha256 = "e".repeat(64), edited.event.eventId);
  const after = f.changes(); await assert.rejects(current(f, proof), unavailable); await assert.rejects(read(f, edited.selection), unavailable);
  assert.equal(f.changes(), after); assert.equal((await f.readNative(edited.selection)).status, 404);
});
for (const output of ["video", "model3d"]) test(`${output}: current edit retains source-revision raw bytes, expiry and custody guards`, async t => {
  const f = await nativeMediaFixture(t, output, { editable: true });
  const sourceExpiry = "2098-01-01T00:00:00.000Z", edited = await retainAuthoredMedia(f, { sourceExpiresAt: sourceExpiry }), proof = await read(f, edited.selection);
  assert.equal(snapshot(f, proof).expiresAt, sourceExpiry); assert.equal(snapshot(f, proof).sourceExpiresAt, EXPIRY);
  const native = await f.readNative(edited.selection); assert.equal(native.status, 200);
  assert.equal((await native.json()).expiresAt, output === "video" ? EXPIRY : sourceExpiry,
    "ordinary HTTP lifetime remains unchanged: GLB already bounds its source revision, while private Video custody tightens its composite deadline");
  for (const [field, value] of [["content_json", edited.sourceRaw + " "], ["content_sha256", "d".repeat(64)],
    ["expires_at", "2099-02-01T00:00:00.000Z"], ["owner_id", "other"], ["organization_id", "tenant"], ["project_access_id", "tenant-access"],
    ["redacted_at", EXPIRY], ["document_id", "other"], ["project_id", "other"]]) {
    f.sqlite.exec("SAVEPOINT source_revision_change");
    try {
      f.sqlite.prepare(`UPDATE artifact_revisions SET ${field}=? WHERE revision=0`).run(value);
      const after = f.changes(); await assert.rejects(current(f, proof), unavailable); assert.equal(f.changes(), after);
    } finally { f.sqlite.exec("ROLLBACK TO source_revision_change; RELEASE source_revision_change"); }
    await current(f, proof);
  }
});
for (const output of kinds) test(`${output}: a second authored revision uses its exact previous current source`, async t => {
  const f = await nativeMediaFixture(t, output, { editable: true }), first = await retainAuthoredMedia(f), second = await retainAuthoredMedia(f);
  const proof = await read(f, second.selection), native = await f.readNative(second.selection);
  assert.equal(native.status, 200); assert.deepEqual(snapshot(f, proof).dto, await native.json());
  assert.equal(snapshot(f, proof).media[`${output}Revision`].source.revision, 1);
  if (output !== "audio") {
    f.changePrivate(p => p[`${output}_revision`].media.sha256 = "d".repeat(64), first.event.eventId);
    await assert.rejects(current(f, proof), unavailable); await assert.rejects(read(f, second.selection), unavailable);
  }
});
for (const output of kinds) test(`${output}: malformed original-reset markers cannot select the original after an authored edit`, async t => {
  const f = await nativeMediaFixture(t, output, { editable: true }); await retainAuthoredMedia(f);
  const restored = await retainOriginalMediaRestore(f), proof = await read(f, restored.selection);
  for (const [field, value] of [["source_surface", "document-artifact-editor"], ["revision_action", "edit"], ["restored_from_revision", 2]]) {
    f.sqlite.exec("SAVEPOINT reset_change");
    try { f.changePrivate(p => p[field] = value, restored.event.eventId);
      await assert.rejects(current(f, proof), unavailable); await assert.rejects(read(f, restored.selection), unavailable);
    } finally { f.sqlite.exec("ROLLBACK TO reset_change; RELEASE reset_change"); }
  }
});
test("GLB omission after scale requires an intervening exact original reset, including its final private witness", async t => {
  const f = await nativeMediaFixture(t, "model3d"), first = await retainAuthoredMedia(f);
  f.replace(f.originalRaw);
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: "model3d", content_ref: CONTENT,
    revision: 2, content_sha256: digest(f.raw()), edited_by_user_id: OWNER, source_surface: "document-artifact-editor" });
  f.currentRevision = 2; await assert.rejects(read(f, f.select(2)), unavailable); assert.equal((await f.readNative(f.select(2))).status, 404);
  const restored = await retainOriginalMediaRestore(f); retainMediaSourceSnapshot(f);
  f.replace({ ...JSON.parse(f.raw()), title: "Private text after explicit restore" });
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: "model3d", content_ref: CONTENT,
    revision: 4, content_sha256: digest(f.raw()), edited_by_user_id: OWNER, source_surface: "document-artifact-editor" });
  const selected = f.select(4), proof = await read(f, selected);
  assert.equal(snapshot(f, proof).media.url, f.originalUrl); assert.deepEqual(snapshot(f, proof).dto, await (await f.readNative(selected)).json());
  f.changePrivate(p => p.restored_from_revision = 3, restored.event.eventId);
  await assert.rejects(current(f, proof), unavailable); await assert.rejects(read(f, selected), unavailable);
  assert.notEqual(first.selection.contentSha256, selected.contentSha256);
});

for (const [name, change] of [
  ["root-only", p => { p.items[0].media_url = null; p.items[0].media_type = null; }],
  ["different root", p => p.media_url = syntheticMediaUrl("other.mp4")],
  ["missing immutable hash", p => { delete p.settings.source_media_sha256; }],
]) test(`Video private native compatibility does not silently widen share custody: ${name}`, async t => {
  const f = await nativeMediaFixture(t, "video"); f.changePrivate(change);
  assert.equal((await f.readNative()).status, 200); await assert.rejects(read(f), unavailable); assert.deepEqual(f.mediaCalls, []);
});
test("GLB selects the recorded primary mesh and never picks the first matching hash", async t => {
  const f = await nativeMediaFixture(t, "model3d"); f.changePrivate(p => {
    const original = p.settings.model3d_files[0]; p.settings.model3d_files.unshift({ ...original, url: syntheticMediaUrl("unselected.glb"), fileName: "unselected.glb" });
  });
  const proof = await read(f); assert.equal(snapshot(f, proof).media.url, f.originalUrl);
  f.changePrivate(p => p.media_url = syntheticMediaUrl("missing-primary.glb"));
  assert.equal((await f.readNative()).status, 200); await assert.rejects(read(f), unavailable);
});
for (const output of ["video", "model3d"]) test(`${output}: original Outputs markers cannot bypass native job/checkpoint proof`, async t => {
  const f = await nativeMediaFixture(t, output); f.changePrivate(p => p.settings[`output_${output}`] = {});
  await assert.rejects(read(f), error => error instanceof Error && error.message === `output_${output}_retained_unavailable`);
  assert.equal((await f.readNative()).status, 404); assert.deepEqual(f.mediaCalls, []);
});

for (const name of ["DB", "MEDIA", "FORMA_PILOT_COHORT_ID", "FORMA_ADMIN_EMAILS"]) test(`final custody recheck rejects ${name} replacement across its await`, async t => {
  const f = await nativeMediaFixture(t, "audio"), proof = await read(f); let mutated = false;
  f.setBeforeRead(sql => {
    if (sql.includes("expected_events AS")) {
      mutated = true; f.env[name] = name === "DB" ? { ...f.env.DB } : name === "MEDIA" ? { ...f.env.MEDIA } : "changed";
    }
  });
  await assert.rejects(current(f, proof), unavailable); assert.ok(mutated); assert.deepEqual(f.mediaCalls, []);
});
test("native expiry reached during issuance or final recheck is refused after the actual query resolves", async t => {
  const originalNow = Date.now;
  try {
    for (const phase of ["issuance", "recheck"]) await t.test(phase, async child => {
      Date.now = originalNow;
      const f = await nativeMediaFixture(child, "audio"), proof = phase === "recheck" ? await read(f) : null;
      let expired = false;
      f.setBeforeRead(sql => { if (sql.includes("expected_events AS")) { expired = true; Date.now = () => Date.parse(EXPIRY); } });
      await assert.rejects(proof ? current(f, proof) : read(f), unavailable); assert.ok(expired);
    });
  } finally { Date.now = originalNow; }
});

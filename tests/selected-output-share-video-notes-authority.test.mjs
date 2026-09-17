import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { videoNotesFixture } from "./helpers/selected-output-share-video-notes-fixture.mjs";
const imports = registerOutputSourceImports();
let readSelectedOutputShareMediaAuthority, selectedOutputShareAuthoritySnapshot, selectedOutputShareAuthorityAssertion;
let nativeRetainedMediaCustodySnapshot, readNativeRetainedMediaBytes, copyCurrentNativeRetainedMediaBytes, selectedShareProofStatement;
try {
  ({ readSelectedOutputShareMediaAuthority, selectedOutputShareAuthoritySnapshot, selectedOutputShareAuthorityAssertion } = await import("../worker/selected-output-share-authority.ts"));
  ({ nativeRetainedMediaCustodySnapshot } = await import("../worker/native-retained-media-custody.ts"));
  ({ readNativeRetainedMediaBytes, copyCurrentNativeRetainedMediaBytes } = await import("../worker/native-retained-media-bytes.ts"));
  ({ selectedShareProofStatement } = await import("../worker/selected-output-share-proof.ts"));
} finally { imports.deregister(); }
const hash = raw => createHash("sha256").update(raw).digest("hex");
const evaluate = async (f, proof) => {
  const statement = selectedShareProofStatement(selectedOutputShareAuthorityAssertion(proof, f.env));
  return (await f.env.DB.prepare(`${statement.withSql} SELECT 1 AS admitted WHERE ${statement.sql}`).bind(...statement.bindings).first())?.admitted ?? 0;
};
const withoutNetwork = t => {
  const previous = globalThis.fetch; globalThis.fetch = () => { throw Error("Video Notes tests must not access network"); };
  t.after(() => { globalThis.fetch = previous; });
};

test("actual Video Notes editor retains genuine original snapshot and current private/public event", async t => {
  withoutNetwork(t);
  const f = await videoNotesFixture(t), original = JSON.parse(f.originalRaw);
  await f.editNotes("Synthetic revised Notes");
  assert.equal(f.revision(), 1);
  const current = JSON.parse(f.currentRaw());
  assert.equal(current.items[0].notes, "Synthetic revised Notes");
  current.items[0].notes = original.items[0].notes; assert.deepEqual(current, original);
  const retained = f.sqlite.prepare("SELECT * FROM artifact_revisions WHERE artifact_id=? AND revision=0").get(f.originalSelection.artifactId);
  assert.equal(retained.content_json, f.originalRaw); assert.equal(retained.content_sha256, hash(f.originalRaw));
  const latest = f.latestEdit(), body = JSON.parse(latest.private_json);
  assert.equal(latest.actor, "user"); assert.equal(latest.client_id, "web:artifact-editor");
  assert.equal(body.source_surface, "document-artifact-editor"); assert.equal(body.content_sha256, hash(f.currentRaw()));
  assert.deepEqual(body.changed_fields, ["content_markdown", "items"]);
  assert.equal(Object.hasOwn(body, "video_revision"), false);
  assert.equal(f.editorStats.puts, 0); assert.equal(f.stats.gets, 0);
});

for (const [label, options] of [
  ["original", {}], ["new recovery original", { recovered: true }],
  ["new recovery retrieved", { recovered: true, evidenceMode: "retrieved" }],
  ["existing completion recovery", { recovered: true, completion: "existing" }],
]) test(`${label}: qualified synthetic original Notes uses native cached bytes with no second GET`, async t => {
  withoutNetwork(t); const f = await videoNotesFixture(t, { ...options, qualifiedBytes: true });
  await f.editNotes("Current private Notes for qualified synthetic Video."); const before = f.changes();
  const custody = await f.read(), proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
  const bytesProof = await readNativeRetainedMediaBytes(custody, f.env);
  assert.deepEqual(await copyCurrentNativeRetainedMediaBytes(bytesProof, f.env), f.expectedBytes);
  assert.equal(await evaluate(f, proof), 1); assert.equal(f.changes(), before);
  assert.deepEqual(f.stats, { gets: 1, heads: 0, writes: 0 });
  assert.equal(f.selection().revision, 1); assert.equal(JSON.parse(f.currentRaw()).items[0].notes, "Current private Notes for qualified synthetic Video.");
});

test("wrong latest actor or client never substitutes for an actual Notes editor event", async t => {
  withoutNetwork(t);
  for (const [actor, client] of [["user:owner", "web:artifact-editor"], ["user", "server:output-requirements"]]) await t.test(`${actor}/${client}`, async child => {
    const f = await videoNotesFixture(child); await f.editNotes("Current Notes");
    const body = JSON.parse(f.latestEdit().private_json);
    await f.appendSynthetic("DocumentArtifactEdited", { ...body, revision: 2 }, actor, client);
    assert.equal(f.selection().revision, 2);
    await assert.rejects(f.read(), /unavailable/u); assert.equal(f.stats.writes, 0);
  });
});

test("original snapshot retirement during the one native media read prevents custody minting", async t => {
  withoutNetwork(t); const f = await videoNotesFixture(t, { qualifiedBytes: true }); await f.editNotes("Current Notes");
  const get = f.env.MEDIA.get.bind(f.env.MEDIA); let retired = false;
  f.env.MEDIA.get = async key => {
    const value = await get(key);
    if (!retired) { retired = true; f.sqlite.prepare("UPDATE artifact_revisions SET redacted_at='retired' WHERE revision=0").run(); }
    return value;
  };
  await assert.rejects(f.read(), /unavailable/u);
  assert.ok(retired); assert.deepEqual(f.stats, { gets: 1, heads: 0, writes: 0 });
});

test("actual prefix trim then original restore leaves an independently saved current Notes revision", async t => {
  withoutNetwork(t); const f = await videoNotesFixture(t, { qualifiedBytes: true, editable: true });
  await f.trim(); assert.equal(f.revision(), 1);
  assert.ok(JSON.parse(f.currentRaw()).video_revision); assert.equal(f.editorStats.puts, 1);
  await f.restore(); assert.equal(f.revision(), 2); assert.equal(f.currentRaw(), f.originalRaw);
  assert.equal(JSON.parse(f.latestEdit().private_json).video_revision, null);
  await f.editNotes("Notes after restoring original encoded Video"); assert.equal(f.revision(), 3);
  const current = JSON.parse(f.currentRaw()); assert.equal(Object.hasOwn(current, "video_revision"), false);
  assert.equal(current.items[0].notes, "Notes after restoring original encoded Video");
  assert.equal(JSON.parse(f.latestEdit().private_json).source_surface, "document-artifact-editor");
});

test("higher current Notes and return to original Notes preserve current revision authority", async t => {
  withoutNetwork(t); const f = await videoNotesFixture(t), originalNotes = JSON.parse(f.originalRaw).items[0].notes;
  for (const [notes, expectedRevision] of [["First Notes", 1], ["Second Notes", 2], [originalNotes, 3]]) {
    await f.editNotes(notes); const custody = await f.read(), native = nativeRetainedMediaCustodySnapshot(custody, f.env);
    assert.equal(native.selection.revision, expectedRevision); assert.deepEqual({ ...native.selection }, f.selection());
    const authority = await readSelectedOutputShareMediaAuthority(f.env, custody);
    assert.equal(await evaluate(f, authority), 1);
  }
  assert.equal(f.currentRaw(), f.originalRaw); assert.equal(f.revision(), 3); assert.equal(f.stats.gets, 3);
});

test("trim then genuine original restore then Notes accepts current revision 3 with original bytes", async t => {
  withoutNetwork(t); const f = await videoNotesFixture(t, { qualifiedBytes: true, editable: true });
  await f.trim(); await f.restore(); await f.editNotes("Current Notes after original restore");
  const custody = await f.read(), native = nativeRetainedMediaCustodySnapshot(custody, f.env);
  assert.equal(native.selection.revision, 3); assert.equal(native.media.sha256, f.originalSelection.mediaSha256);
  assert.equal(native.media.readMode, "native-output-video");
  const authority = await readSelectedOutputShareMediaAuthority(f.env, custody);
  assert.equal(await evaluate(f, authority), 1); assert.deepEqual(f.stats, { gets: 1, heads: 0, writes: 0 });
});

test("an earlier title change reversed by the actual editor permits a current Notes-only relationship", async t => {
  withoutNetwork(t); const f = await videoNotesFixture(t), original = JSON.parse(f.originalRaw);
  await f.edit({ markdown: original.content_markdown, items: [{ index: 0, title: "Temporary earlier title" }] });
  await assert.rejects(f.read(), /unavailable/u);
  await f.edit({ markdown: original.content_markdown, items: [{ index: 0, title: original.items[0].title, notes: "Current Notes" }] });
  assert.equal(f.revision(), 2);
  const custody = await f.read(), authority = await readSelectedOutputShareMediaAuthority(f.env, custody);
  assert.equal(nativeRetainedMediaCustodySnapshot(custody, f.env).selection.revision, 2);
  assert.equal(await evaluate(f, authority), 1);
});

test("genuine editor changes to title, body or content markdown do not enter the Notes-only bridge", async t => {
  withoutNetwork(t);
  for (const field of ["title", "body", "content_markdown"]) await t.test(field, async child => {
    const f = await videoNotesFixture(child), body = JSON.parse(f.currentRaw());
    await f.edit(field === "content_markdown" ? { markdown: "Changed actual content markdown" }
      : { markdown: body.content_markdown, items: [{ index: 0, [field]: `Changed ${field}`, notes: "Also edited Notes" }] });
    assert.equal(f.revision(), 1);
    await assert.rejects(f.read(), /unavailable/u);
    assert.equal(f.stats.writes, 0);
  });
});

test("malformed latest private Notes receipts and original snapshots refuse actual current custody", async t => {
  withoutNetwork(t);
  const faults = {
    "receipt extra key": f => f.mutateLatest(value => { value.extra = true; }),
    "receipt wrong surface": f => f.mutateLatest(value => { value.source_surface = "document-artifact-history"; }),
    "receipt wrong editor": f => f.mutateLatest(value => { value.edited_by_user_id = "another-owner"; }),
    "receipt wrong revision": f => f.mutateLatest(value => { value.revision++; }),
    "receipt wrong hash": f => f.mutateLatest(value => { value.content_sha256 = "a".repeat(64); }),
    "receipt changed field order": f => f.mutateLatest(value => { value.changed_fields.reverse(); }),
    "receipt video marker": f => f.mutateLatest(value => { value.video_revision = null; }),
    "receipt restore marker": f => f.mutateLatest(value => { value.revision_action = "restore"; value.restored_from_revision = 0; }),
    "receipt retired": f => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='retired' WHERE private_event_id=?").run(f.latestEdit().event_id),
    "snapshot missing": f => f.sqlite.prepare("DELETE FROM artifact_revisions WHERE revision=0").run(),
    "snapshot retired": f => f.sqlite.prepare("UPDATE artifact_revisions SET redacted_at='retired' WHERE revision=0").run(),
    "snapshot expired": f => f.sqlite.prepare("UPDATE artifact_revisions SET expires_at='2000-01-01T00:00:00.000Z' WHERE revision=0").run(),
    "snapshot wrong document": f => f.sqlite.prepare("UPDATE artifact_revisions SET document_id='other-document' WHERE revision=0").run(),
    "snapshot wrong project": f => f.sqlite.prepare("UPDATE artifact_revisions SET project_id='other-project' WHERE revision=0").run(),
    "snapshot raw changed": f => f.sqlite.prepare("UPDATE artifact_revisions SET content_json=content_json||' ' WHERE revision=0").run(),
    "snapshot hash changed": f => f.sqlite.prepare("UPDATE artifact_revisions SET content_sha256=? WHERE revision=0").run("b".repeat(64)),
    "current unknown key": f => f.mutateCurrent(value => { value.unrecognized = "not preserved"; }),
    "current body altered": f => f.mutateCurrent(value => { value.items[0].body = "Altered outside Notes"; }),
    "current Notes nonstring": f => f.mutateCurrent(value => { value.items[0].notes = null; }),
  };
  for (const [name, mutate] of Object.entries(faults)) await t.test(name, async child => {
    const f = await videoNotesFixture(child); await f.editNotes("Current Notes"); mutate(f);
    await assert.rejects(f.read(), /unavailable/u); assert.equal(f.stats.writes, 0);
  });
});

test("held current Notes authority pins paid provenance and all current/snapshot witnesses", async t => {
  withoutNetwork(t); const f = await videoNotesFixture(t); await f.editNotes("Retain exact current Notes");
  const custody = await f.read(), proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
  assert.equal(await evaluate(f, proof), 1); const gets = f.stats.gets;
  const faults = {
    "different payer": () => f.sqlite.prepare("UPDATE output_execution_grants SET payer_user_id='different-payer'").run(),
    "different actor": () => f.sqlite.prepare("UPDATE output_execution_grants SET actor_user_id='different-actor'").run(),
    "sponsor marker": () => f.mutateAuthorization(body => { body.output_command_envelope.sponsor_entitlement = false; }),
    "private authorization retired": () => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='retired' WHERE private_event_id=?").run(f.authorization.eventId),
    "paid call unsettled": () => f.sqlite.prepare("UPDATE output_provider_calls SET status='uncertain'").run(),
    "paid call identity": () => f.sqlite.prepare("UPDATE output_provider_calls SET provider_response_id='other-response'").run(),
    "storage acknowledgment": () => f.sqlite.prepare("UPDATE output_native_storage_writes SET write_acknowledged=0").run(),
    "private input retirement": () => f.sqlite.prepare("UPDATE private_content SET redacted_at='retired' WHERE content_id='input'").run(),
    "snapshot retirement": () => f.sqlite.prepare("UPDATE artifact_revisions SET redacted_at='retired' WHERE revision=0").run(),
    "snapshot content": () => f.sqlite.prepare("UPDATE artifact_revisions SET content_json=content_json||' ' WHERE revision=0").run(),
    "current private content": () => f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id='content'").run(),
    "latest private event": () => f.mutateLatest(body => { body.changed_fields = ["items"]; }),
  };
  for (const [name, mutate] of Object.entries(faults)) await t.test(name, async () => {
    f.sqlite.exec("SAVEPOINT notes_authority_mutation");
    try { mutate(); const before = f.changes();
      assert.equal(await evaluate(f, proof), 0);
      await assert.rejects(readSelectedOutputShareMediaAuthority(f.env, custody), /unavailable/u);
      assert.equal(f.changes(), before); assert.equal(f.stats.gets, gets); assert.equal(f.stats.writes, 0);
    } finally { f.sqlite.exec("ROLLBACK TO notes_authority_mutation; RELEASE notes_authority_mutation"); }
    assert.equal(await evaluate(f, proof), 1);
  });
});

for (const [label, options] of [
  ["original", {}], ["recovered new original", { recovered: true }],
  ["recovered new retrieved", { recovered: true, evidenceMode: "retrieved" }],
  ["recovered existing", { recovered: true, completion: "existing" }],
]) test(`${label}: current Notes remain revision 1 and compose actual original paid authority`, async t => {
  withoutNetwork(t); const f = await videoNotesFixture(t, options);
  await f.editNotes("A single current Notes edit."); const before = f.changes(), custody = await f.read();
  const native = nativeRetainedMediaCustodySnapshot(custody, f.env);
  assert.deepEqual({ ...native.selection }, f.selection()); assert.equal(native.selection.revision, 1);
  assert.equal(native.media.readMode, "native-output-video");
  assert.equal(native.media.sha256, f.originalSelection.mediaSha256);
  const proof = await readSelectedOutputShareMediaAuthority(f.env, custody);
  assert.equal(selectedOutputShareAuthoritySnapshot(proof, f.env).completionId, f.completed.eventId);
  assert.equal(await evaluate(f, proof), 1);
  await assert.rejects(readNativeRetainedMediaBytes(custody, f.env), /unavailable/u,
    "accepted native donor remains outside the strict sharing byte profile");
  assert.equal(f.changes(), before); assert.deepEqual(f.stats, { gets: 1, heads: 0, writes: 0 });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { modelBytes } from "./model3d-native/assets.mjs";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

// Authored cube bytes and actual handlers over RAM SQLite/media only. This does
// not import another suite or claim provider output, live IAM or human review.
const imports = registerOutputSourceImports();
let handleArtifactEdit, handleNativeRetainedOutputRead, nativeRetainedOutputRequestPath, runtime, mediaApi, model, scale, revisions, mediaRevisions, foldEvents;
try {
  ({ handleArtifactEdit } = await import("../worker/artifact-api.ts"));
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ nativeRetainedOutputRequestPath } = await import("../src/model/native-retained-output.ts"));
  runtime = await import("../worker/runtime.ts");
  mediaApi = await import("../worker/media-api.ts");
  model = await import("../src/model/document-artifacts.ts");
  ({ scaleModel3dGeometry: scale } = await import("../src/model/model3d-geometry-edit.ts"));
  revisions = await import("../src/model/model3d-artifact-revision.ts");
  mediaRevisions = await import("../src/model/model3d-media-revision.ts");
  ({ foldEvents } = await import("../src/model/events.ts"));
} finally { imports.deregister(); }

const hash = value => createHash("sha256").update(value).digest("hex");
const OWNER = "model3d-scale-owner", EMAIL = "model3d-scale-owner@example.test", DOCUMENT = "model3d-scale-document";
const PROJECT = "model3d-scale-project", ARTIFACT = "model3d-scale-artifact", CONTENT = "model3d-scale-content", SOURCE_BLOCK = "model3d-scale-direction";
const MIME = "model/gltf-binary", EXPIRY = "2099-01-01T00:00:00.000Z";
const headers = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
const patch = value => ({ method: "PATCH", headers: { ...headers, "content-type": "application/json", origin: "https://forma.test" }, body: JSON.stringify(value) });
const editBatch = statements => statements[0]?.sql.includes("INSERT INTO event_write_stage") && statements[0]?.sql.includes("private_content");
const originalContent = () => ({ title: "Harbor cube", summary: "Owned authored cube fixture; no generated quality or rendering claim.",
  content_markdown: "A small static cube. Preserve these original modeling directions, Café 雨 🌱.", presentation: null, items: [] });

async function fixture(t, { sourceBytes = modelBytes(), differentRoot = false, glbVariant = false, completionChange, contentChange } = {}) {
  const state = outputTestDatabase(); t.after(() => { try { state.sqlite.close(); } finally { state.media.clear(); } });
  await runtime.ensureSchema(state.env);
  const now = new Date().toISOString(), streamId = `creative:${OWNER}`;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Model scale owner", "creator", "pilot-2026-08-10", now, now, now);
  await runtime.appendAuditEvent(state.env, streamId, "user", "ProjectCreated", { project_id: PROJECT, name: "Generated model persistence controls" });
  await runtime.appendAuditEvent(state.env, streamId, "user", "DocumentCreated", { project_id: PROJECT, document_id: DOCUMENT, title: "Model scale source" });
  await runtime.appendAuditEvent(state.env, streamId, "user", "BlockCreated", { project_id: PROJECT, document_id: DOCUMENT, block_id: SOURCE_BLOCK,
    type: "text", scope: "document", properties: { text: "A small static cube. Keep the original modeling directions." } });
  const originalBytes = new Uint8Array(sourceBytes);
  // The fixture author owns these synthetic cube bytes. Assert only that original
  // fixture's rights; the Worker must not fabricate a rights assertion on its derivative.
  const media = await mediaApi.storeGeneratedMedia(state.env, OWNER, ARTIFACT + "-glb", originalBytes, "authored-local-cube", MIME, { source: "synthetic-retained-fixture", rights: "asserted" });
  const alternateBytes = new TextEncoder().encode("o retained_original\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
  const alternate = differentRoot ? await mediaApi.storeGeneratedMedia(state.env, OWNER, ARTIFACT + "-obj", alternateBytes, "authored-local-alternate", "model/obj", { source: "synthetic-retained-fixture" }) : null;
  const content = originalContent(); contentChange?.(content);
  const raw = JSON.stringify(model.parseDocumentArtifactContent(JSON.stringify(content)));
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const selectedFile = { url: media.url, mimeType: MIME, fileName: "harbor-cube.glb", fileSize: originalBytes.length, format: "glb", role: "mesh", sha256: hash(originalBytes), previewSupported: true };
  const alternateFile = alternate ? { url: alternate.url, mimeType: "model/obj", fileName: "original.obj", fileSize: alternateBytes.length, format: "obj", role: "mesh", sha256: hash(alternateBytes), previewSupported: false } : null;
  const variant = glbVariant ? await mediaApi.storeGeneratedMedia(state.env, OWNER, ARTIFACT + "-shaded", originalBytes, "authored-local-variant", MIME, { source: "synthetic-retained-fixture" }) : null;
  const payload = { project_id: PROJECT, document_id: DOCUMENT, artifact_id: ARTIFACT, artifact_kind: "model3d", requested_by_user_id: OWNER,
    title: content.title, content_ref: CONTENT, input_ref: "model3d-scale-original-input", item_count: 0, items: [], presentation: null,
    source_block_versions: [{ block_id: SOURCE_BLOCK, version: 1 }], media_url: alternate?.url ?? media.url, media_type: alternate ? "model/obj" : MIME,
    settings: { item_count: 1, production_mode: "manual", model3d_files: alternateFile ? [alternateFile, selectedFile] : [selectedFile],
      source_media_sha256: alternateFile?.sha256 ?? selectedFile.sha256 } };
  completionChange?.(payload);
  if (variant) payload.settings.model3d_files.push({ ...selectedFile, url: variant.url, fileName: "shaded.glb" });
  const completion = await runtime.appendAuditEvent(state.env, streamId, "worker:renderer", "DocumentRenderCompleted", payload);
  const privatePayload = eventId => state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId)?.private_json;
  const initialCompletion = privatePayload(completion.eventId);
  const currentRaw = () => state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content;
  const events = () => runtime.readWorkspaceEvents(state.env, streamId);
  const revision = () => state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type='DocumentArtifactEdited'").get(streamId).n;
  const historyCount = () => state.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions WHERE artifact_id=?").get(ARTIFACT).n;
  const requestFor = (factor = 2, bytes = originalBytes, expectedRevision = 0, sourceRaw = raw) => ({ expectedRevision,
    expectedContentSha256: hash(sourceRaw), model3dScale: { sourceMediaSha256: hash(bytes), factor, resultMediaSha256: hash(scale(bytes, factor).bytes) } });
  const edit = input => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}`, patch(input ?? requestFor())), state.env, ARTIFACT);
  const restore = (selected, expectedRevision) => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}/revisions/${selected}/restore`,
    { ...patch({ expectedRevision }), method: "POST" }), state.env, ARTIFACT, ["revisions", String(selected), "restore"]);
  const fingerprint = input => hash(JSON.stringify(revisions.parseModel3dScaleEditRequest(input)));
  const check = input => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}?model3dScaleOperation=${fingerprint(input)}&expectedRevision=${input.expectedRevision}`, { headers }), state.env, ARTIFACT);
  const native = () => handleNativeRetainedOutputRead(new Request(`https://forma.test${nativeRetainedOutputRequestPath({ output: "model3d",
    selection: { documentId: DOCUMENT, artifactId: ARTIFACT, revision: revision(), contentSha256: hash(currentRaw()) } })}`, { headers }), state.env);
  const calls = { get: [], put: [], delete: [] };
  for (const method of Object.keys(calls)) {
    const original = state.env.MEDIA[method].bind(state.env.MEDIA);
    state.env.MEDIA[method] = async (...args) => { calls[method].push(args[0]); return original(...args); };
  }
  const bytesAt = url => state.media.get(decodeURIComponent(url.slice("/api/media/".length)))?.bytes;
  return { ...state, objects: state.media, media, alternate, variant, alternateBytes, originalBytes, raw, streamId, completion, initialCompletion, privatePayload,
    currentRaw, events, revision, historyCount, requestFor, edit, restore, fingerprint, check, native, calls, bytesAt };
}

function assertUncommitted(f, expectedRaw = f.raw) {
  assert.equal(f.revision(), 0); assert.equal(f.historyCount(), 0); assert.equal(f.currentRaw(), expectedRaw);
  assert.equal(f.objects.size, f.alternate ? 2 : 1); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
  assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
}
async function saved(f, response) {
  assert.equal(response.status, 200, await response.clone().text());
  const ack = await response.json(), content = model.parseDocumentArtifactContent(f.currentRaw());
  assert.equal(ack.appended.length, 1); assert.equal(ack.revision, f.revision()); assert.equal(ack.content[CONTENT], f.currentRaw());
  assert.deepEqual(ack.appended[0].payload.model3d_revision, content.model3d_revision);
  assert.deepEqual(JSON.parse(f.privatePayload(ack.appended[0].eventId)), ack.appended[0].payload);
  assert.equal(ack.appended[0].payload.content_sha256, hash(f.currentRaw()));
  assert(mediaRevisions.parseModel3dMediaRevision(content.model3d_revision));
  return { ack, content, revision: content.model3d_revision };
}

test("actual generated Model3D Save retains scaled geometry, exact source history and current native file", async t => {
  const f = await fixture(t), input = f.requestFor(), expected = scale(f.originalBytes, 2);
  const { ack, content, revision } = await saved(f, await f.edit(input));
  assert.equal(f.revision(), 1); assert.equal(f.calls.put.length, 1); assert.equal(f.objects.size, 2);
  assert.equal(revision.operation, "uniform-scale"); assert.equal(revision.factor, 2); assert.equal(revision.source.url, f.media.url);
  assert.equal(revision.source.sha256, hash(f.originalBytes)); assert.equal(revision.source.byteLength, f.originalBytes.length);
  assert.equal(revision.source.revision, 0); assert.equal(revision.source.contentSha256, hash(f.raw));
  assert.deepEqual(revision.beforeBounds, { min: [-1, -1, -1], max: [1, 1, 1], size: [2, 2, 2] });
  assert.deepEqual(revision.afterBounds, { min: [-2, -2, -2], max: [2, 2, 2], size: [4, 4, 4] });
  assert.equal(revision.vertexCount, 8); assert.equal(revision.positionAccessorCount, 1);
  assert.equal(revision.media.sha256, hash(expected.bytes)); assert.equal(revision.media.byteLength, expected.bytes.length);
  const fileResponse = await mediaApi.getMedia(new Request(`https://forma.test${revision.media.url}`, { headers }),
    decodeURIComponent(revision.media.url.slice("/api/media/".length)), f.env);
  assert.equal(fileResponse.status, 200);
  assert.equal(fileResponse.headers.get("content-type"), MIME);
  assert.equal(fileResponse.headers.get("content-disposition"), "attachment; filename=\"scaled-model.glb\"; filename*=UTF-8''scaled-model.glb");
  assert.equal(hash(new Uint8Array(await fileResponse.arrayBuffer())), revision.media.sha256);
  assert.equal(revision.media.fileName, "scaled-model.glb");
  const derivativeMetadata = f.objects.get(decodeURIComponent(revision.media.url.slice("/api/media/".length))).metadata;
  assert.equal(derivativeMetadata.source, "authored-model3d-edit"); assert.equal(derivativeMetadata.artifactId, ARTIFACT);
  assert.equal(derivativeMetadata.sourceMediaSha256, hash(f.originalBytes)); assert.equal(derivativeMetadata.sourceRevision, "0");
  assert.equal(derivativeMetadata.requestSha256, f.fingerprint(input)); assert.equal(Object.hasOwn(derivativeMetadata, "rights"), false);
  assert.deepEqual(f.bytesAt(revision.media.url), expected.bytes); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
  assert.deepEqual(scale(f.bytesAt(revision.media.url), 1).beforeBounds, revision.afterBounds);
  assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
  assert.deepEqual({ ...content, model3d_revision: undefined }, { ...model.parseDocumentArtifactContent(f.raw), model3d_revision: undefined });
  assert.deepEqual(content.items, []);
  for (const [number, raw] of [[0, f.raw], [1, f.currentRaw()]]) {
    const row = f.sqlite.prepare("SELECT content_json,content_sha256 FROM artifact_revisions WHERE artifact_id=? AND revision=?").get(ARTIFACT, number);
    assert.equal(row.content_json, raw); assert.equal(row.content_sha256, hash(raw));
  }
  const artifact = foldEvents(await f.events(), Infinity, DOCUMENT, PROJECT).artifacts.find(item => item.id === ARTIFACT);
  assert.equal(artifact.mediaUrl, revision.media.url); assert.equal(artifact.mediaType, MIME); assert.deepEqual(artifact.items, []);
  assert.deepEqual(artifact.settings.model3d_files, [mediaRevisions.model3dRevisionFile(revision)]);
  const response = await f.native(); assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).content.files, [mediaRevisions.model3dRevisionFile(revision)]);
  assert.equal(ack.appended[0].payload.model3d_scale_request_sha256, f.fingerprint(input));
  assert.equal(ack.appended[0].payload.source_surface, "document-artifact-model3d-scale");
});

test("eligible GLB selection follows its exact retained file descriptor when the completion root is another format", async t => {
  const f = await fixture(t, { differentRoot: true }), original = JSON.parse(f.initialCompletion);
  assert.notEqual(original.media_url, f.media.url); assert.notEqual(original.settings.source_media_sha256, hash(f.originalBytes));
  const { revision } = await saved(f, await f.edit()); assert.equal(revision.source.url, f.media.url); assert.equal(revision.source.sha256, hash(f.originalBytes));
  assert.deepEqual(f.bytesAt(f.alternate.url), f.alternateBytes); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.equal(f.objects.size, 3);
  const response = await f.native(); assert.equal(response.status, 200, await response.clone().text());
  const files = (await response.json()).content.files; assert.equal(files.length, 1); assert.equal(files[0].url, revision.media.url);
  assert.equal(files.some(file => file.url === f.alternate.url), false, "An unchanged original alternate is not labeled as scaled geometry");
});

test("explicit primary of two GLBs survives actual scale, native reread and original restoration", async t => {
  const f = await fixture(t, { glbVariant: true });
  const { revision } = await saved(f, await f.edit());
  assert.equal(revision.source.url, f.media.url);
  const response = await f.native(); assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).content.files[0].url, revision.media.url);
  const current = foldEvents(await f.events(), Infinity, DOCUMENT, PROJECT).artifacts.find(item => item.id === ARTIFACT);
  assert.equal(current.mediaUrl, revision.media.url);
  const second = await saved(f, await f.edit(f.requestFor(1.1, f.bytesAt(revision.media.url), 1, f.currentRaw())));
  assert.equal(second.revision.source.url, revision.media.url);
  const reread = await f.native(); assert.equal(reread.status, 200, await reread.clone().text());
  assert.equal((await reread.json()).content.files[0].url, second.revision.media.url);
  const restored = await f.restore(0, 2);
  assert.equal(restored.status, 200, await restored.clone().text());
  const artifact = foldEvents(await f.events(), Infinity, DOCUMENT, PROJECT).artifacts.find(item => item.id === ARTIFACT);
  assert.equal(artifact.mediaUrl, f.media.url); assert.equal(artifact.settings.model3d_files.length, 2);
  assert.equal(model.model3dArtifactMediaFile(artifact).url, f.media.url);
  assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.deepEqual(f.bytesAt(f.variant.url), f.originalBytes);
  assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
  assert.equal(f.calls.put.length, 2);
});

test("geometry-only Save preserves unknown raw metadata and original author text", async t => {
  const f = await fixture(t), body = JSON.parse(f.raw); body.producer_note = { literal: "\tCafé 雨 — retained model 🌱\n", flags: [false, true], optional: null };
  const raw = JSON.stringify(body); f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
  const response = await f.edit(f.requestFor(2, f.originalBytes, 0, raw)); assert.equal(response.status, 200, await response.clone().text());
  const current = JSON.parse(f.currentRaw()); assert.equal(current.model3d_revision.source.contentSha256, hash(raw)); delete current.model3d_revision;
  assert.deepEqual(current, body); assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE artifact_id=? AND revision=0").get(ARTIFACT).content_json, raw);
});

test("closed scale request rejects factors, extra metadata and mismatched source/result identities without staging", async t => {
  for (const fault of ["root-extra", "scale-extra", "length-extra", "mixed-video", "mixed-audio", "identity-factor", "zero", "negative", "string", "nonfinite", "equal-hashes", "result-hash", "source-hash", "stale-content", "stale-revision"])
    await t.test(fault, async child => {
      const f = await fixture(child), input = f.requestFor();
      if (fault === "root-extra") input.mediaUrl = f.media.url;
      if (fault === "scale-extra") input.model3dScale.mediaUrl = f.media.url;
      if (fault === "length-extra") input.model3dScale.sourceByteLength = f.originalBytes.length;
      if (fault === "mixed-video") input.videoTrim = {};
      if (fault === "mixed-audio") input.audioTrim = {};
      if (fault === "identity-factor") Object.assign(input, f.requestFor(1));
      if (fault === "zero") input.model3dScale.factor = 0;
      if (fault === "negative") input.model3dScale.factor = -2;
      if (fault === "string") input.model3dScale.factor = "2";
      if (fault === "nonfinite") input.model3dScale.factor = Infinity;
      if (fault === "equal-hashes") input.model3dScale.resultMediaSha256 = input.model3dScale.sourceMediaSha256;
      if (fault === "result-hash") input.model3dScale.resultMediaSha256 = "a".repeat(64);
      if (fault === "source-hash") input.model3dScale.sourceMediaSha256 = "b".repeat(64);
      if (fault === "stale-content") input.expectedContentSha256 = "c".repeat(64);
      if (fault === "stale-revision") input.expectedRevision = 1;
      const response = await f.edit(input); assert.notEqual(response.status, 200, fault);
      if (fault === "identity-factor") { assert.equal(response.status, 400); assert.equal((await response.json()).error, "model3d_scale_invalid_scale"); }
      assert.equal(f.calls.put.length, 0); assertUncommitted(f);
    });
});

test("model scale admission rejects missing, conflicting and foreign selected file descriptors", async t => {
  for (const fault of ["wrong-kind", "missing-files", "no-glb", "two-glbs", "descriptor-hash", "descriptor-size", "foreign-owner", "shared-media", "missing-source-versions"])
    await t.test(fault, async child => {
      const f = await fixture(child, { completionChange(payload) {
        const file = payload.settings.model3d_files[0];
        if (fault === "wrong-kind") payload.artifact_kind = "video";
        if (fault === "missing-files") delete payload.settings.model3d_files;
        if (fault === "no-glb") { file.format = "obj"; file.mimeType = "model/obj"; file.previewSupported = false; }
        if (fault === "two-glbs") { payload.settings.model3d_files.push({ ...file, url: file.url.replace(".glb", "-second.glb") }); delete payload.media_url; }
        if (fault === "descriptor-hash") file.sha256 = "f".repeat(64);
        if (fault === "descriptor-size") file.fileSize++;
        if (fault === "missing-source-versions") delete payload.source_block_versions;
      } });
      if (fault === "foreign-owner") f.objects.get(f.media.key).metadata.ownerId = "another-owner";
      if (fault === "shared-media") f.objects.get(f.media.key).metadata.projectAccessId = "shared-media-scope";
      const response = await f.edit(); assert.notEqual(response.status, 200, fault); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
    });
});

test("commit-time model scale guards reject retired ownership and remove only this operation's uncommitted object", async t => {
  for (const fault of ["role", "consent", "raw", "kind", "head", "expiry", "redaction", "owner", "rescope"]) await t.test(fault, async child => {
    const f = await fixture(child), batch = f.env.DB.batch.bind(f.env.DB); let intercepted = 0;
    const unrelated = await mediaApi.storeGeneratedMedia(f.env, OWNER, "unrelated-model-object", new Uint8Array([1, 2, 3]), "fixture", "application/octet-stream"); f.calls.put.length = 0;
    f.env.DB.batch = async statements => {
      if (editBatch(statements)) {
        intercepted++;
        if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
        if (fault === "consent") f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(OWNER);
        if (fault === "raw") f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(f.raw + " ", CONTENT);
        if (fault === "kind") f.sqlite.prepare("UPDATE private_content SET kind='document-artifact-input' WHERE content_id=?").run(CONTENT);
        if (fault === "head") await runtime.appendAuditEvent({ ...f.env, DB: { ...f.env.DB, batch } }, f.streamId, "user", "DocumentRenamed", { project_id: PROJECT, document_id: DOCUMENT, title: "Concurrent source" });
        if (fault === "expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
        if (fault === "redaction") f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
        if (fault === "owner") f.sqlite.prepare("UPDATE private_content SET owner_id='another-owner' WHERE content_id=?").run(CONTENT);
        if (fault === "rescope") f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,'artifact',?,?,?,?,?,?)")
          .run("model-scope-at-commit", ARTIFACT, "model-organization", PROJECT, OWNER, OWNER, new Date().toISOString());
      }
      return batch(statements);
    };
    const response = await f.edit(); assert.equal(response.status, 409, await response.clone().text()); assert.equal(intercepted, 1);
    assert.equal(f.revision(), 0); assert.equal(f.historyCount(), 0); assert.equal(f.calls.put.length, 1); assert.equal(f.objects.size, 2);
    assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.deepEqual(f.bytesAt(unrelated.url), new Uint8Array([1, 2, 3]));
    assert.equal(f.calls.delete.flat().includes(f.media.key), false); assert.equal(f.calls.delete.flat().includes(unrelated.key), false);
  });
});

test("ownership changes during model source read refuse before staging", async t => {
  for (const fault of ["role", "raw", "kind", "expiry"]) await t.test(fault, async child => {
    const f = await fixture(child), get = f.env.MEDIA.get.bind(f.env.MEDIA); let changed = false;
    f.env.MEDIA.get = async key => { const object = await get(key); if (key === f.media.key && !changed) {
      changed = true;
      if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
      if (fault === "raw") f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(f.raw + " ", CONTENT);
      if (fault === "kind") f.sqlite.prepare("UPDATE private_content SET kind='document-artifact-input' WHERE content_id=?").run(CONTENT);
      if (fault === "expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
    } return object; };
    const response = await f.edit(); assert.equal(changed, true); assert.equal(response.status, 409, await response.clone().text());
    assert.equal(f.calls.put.length, 0); assertUncommitted(f, fault === "raw" ? f.raw + " " : f.raw);
  });
});

test("positive trigger-inclusive D1 changes acknowledge the exact model scale revision", async t => {
  const f = await fixture(t), batch = f.env.DB.batch.bind(f.env.DB), metrics = [];
  f.env.DB.batch = async statements => {
    if (!editBatch(statements)) return batch(statements);
    const originals = statements.map(statement => statement.execute);
    statements.forEach((statement, index) => { statement.execute = function(kind) {
      const before = f.sqlite.prepare("SELECT total_changes() AS n").get().n, result = originals[index].call(this, kind);
      const changes = f.sqlite.prepare("SELECT total_changes() AS n").get().n - before;
      metrics.push({ success: result.success, directChanges: result.meta.changes, changes }); return { ...result, meta: { ...result.meta, changes } };
    }; });
    try { return await batch(statements); } finally { statements.forEach((statement, index) => { statement.execute = originals[index]; }); }
  };
  await saved(f, await f.edit()); assert(metrics[0].changes > metrics[0].directChanges);
  assert(metrics.every(value => value.success === true && Number.isSafeInteger(value.changes) && value.changes > 0));
});

test("a media scope created during source read or acknowledged PUT prevents the personal model commit", async t => {
  for (const timing of ["source-read", "after-put"]) await t.test(timing, async child => {
    const f = await fixture(child), get = f.env.MEDIA.get.bind(f.env.MEDIA), put = f.env.MEDIA.put.bind(f.env.MEDIA), batch = f.env.DB.batch.bind(f.env.DB);
    const unrelated = await mediaApi.storeGeneratedMedia(f.env, OWNER, "unrelated-model-scope-control", new Uint8Array([7, 8, 9]), "fixture", "application/octet-stream");
    f.calls.put.length = 0; let changes = 0, dispatches = 0;
    const scopeSource = () => {
      changes++;
      f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,'media',?,?,?,?,?,?)")
        .run("model-scope-during-save", f.media.key, "model-scope-organization", PROJECT, OWNER, OWNER, new Date().toISOString());
      assert.equal(Object.hasOwn(f.objects.get(f.media.key).metadata, "projectAccessId"), false, "The database scope alone retires personal custody");
    };
    if (timing === "source-read") f.env.MEDIA.get = async key => { const object = await get(key); if (key === f.media.key && !changes) scopeSource(); return object; };
    else f.env.MEDIA.put = async (...args) => { const result = await put(...args); if (!changes) scopeSource(); return result; };
    f.env.DB.batch = async statements => { if (editBatch(statements)) dispatches++; return batch(statements); };
    const response = await f.edit(); assert.equal(response.status, 409, await response.clone().text()); assert.equal(changes, 1);
    assert.equal(f.revision(), 0); assert.equal(f.historyCount(), 0); assert.equal(f.currentRaw(), f.raw); assert.equal(f.objects.size, 2);
    assert.equal(f.calls.put.length, timing === "after-put" ? 1 : 0); assert.equal(dispatches, timing === "after-put" ? 1 : 0);
    assert.equal(f.calls.delete.length, timing === "after-put" ? 1 : 0);
    assert.equal(f.calls.delete.flat().includes(f.media.key), false); assert.equal(f.calls.delete.flat().includes(unrelated.key), false);
    assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.deepEqual(f.bytesAt(unrelated.url), new Uint8Array([7, 8, 9]));
    assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
  });
});

test("original media rights retired after acknowledged PUT refuse before database dispatch", async t => {
  for (const fault of ["revoked", "expired", "cleanup-fails"]) await t.test(fault, async child => {
    const f = await fixture(child), put = f.env.MEDIA.put.bind(f.env.MEDIA), batch = f.env.DB.batch.bind(f.env.DB); let dispatches = 0;
    f.env.MEDIA.put = async (...args) => {
      const result = await put(...args), metadata = f.objects.get(f.media.key).metadata;
      if (fault === "expired") metadata.rights_expires_at = "2000-01-01T00:00:00.000Z"; else metadata.rights = "revoked";
      return result;
    };
    if (fault === "cleanup-fails") f.env.MEDIA.delete = async key => { f.calls.delete.push(key); throw new Error("Owned staging cleanup unavailable"); };
    f.env.DB.batch = async statements => { if (editBatch(statements)) dispatches++; return batch(statements); };
    const response = await f.edit(); assert.equal(response.status, fault === "cleanup-fails" ? 503 : 409, await response.clone().text());
    assert.equal((await response.json()).error, fault === "cleanup-fails" ? "model3d_scale_unconfirmed" : "model3d_scale_source_changed");
    assert.equal(dispatches, 0); assert.equal(f.calls.put.length, 1); assert.equal(f.calls.delete.length, 1);
    assert.equal(f.calls.delete.flat().includes(f.media.key), false); assert.equal(f.objects.size, fault === "cleanup-fails" ? 2 : 1);
    assert.equal(f.revision(), 0); assert.equal(f.historyCount(), 0); assert.equal(f.currentRaw(), f.raw); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
  });
});

test("invalid D1 ACK preserves committed model geometry as unconfirmed", async t => {
  for (const fault of ["not-array", "missing-result", "extra-result", "hole", "missing-meta", "zero", "fraction", "nan", "string", "unsafe", "false-success", "missing-success"])
    await t.test(fault, async child => {
      const f = await fixture(child), batch = f.env.DB.batch.bind(f.env.DB);
      f.env.DB.batch = async statements => {
        const results = await batch(statements); if (!editBatch(statements)) return results;
        if (fault === "not-array") return null;
        if (fault === "missing-result") return results.slice(1);
        if (fault === "extra-result") return [...results, results[0]];
        if (fault === "hole") { delete results[0]; return results; }
        if (fault === "missing-meta") { delete results[0].meta; return results; }
        if (fault === "false-success") { results[0].success = false; return results; }
        if (fault === "missing-success") { delete results[0].success; return results; }
        results[0].meta.changes = { zero: 0, fraction: .5, nan: NaN, string: "1", unsafe: Number.MAX_SAFE_INTEGER + 1 }[fault]; return results;
      };
      const response = await f.edit(); assert.equal(response.status, 503, await response.clone().text()); assert.equal((await response.json()).error, "model3d_scale_unconfirmed");
      assert.equal(f.revision(), 1); assert.equal(f.historyCount(), 2); assert.equal(f.objects.size, 2); assert.equal(f.calls.delete.length, 0);
      const revision = JSON.parse(f.currentRaw()).model3d_revision; assert.equal(hash(f.bytesAt(revision.media.url)), revision.media.sha256); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
    });
});

test("lost committed model response is observed by canonical read-only Check without a second object or event", async t => {
  const f = await fixture(t), input = f.requestFor(), batch = f.env.DB.batch.bind(f.env.DB); let lost = false;
  f.env.DB.batch = async statements => { const result = await batch(statements); if (editBatch(statements) && !lost) { lost = true; throw new Error("Lost original model commit response"); } return result; };
  assert.equal((await f.edit(input)).status, 503); assert.equal(f.revision(), 1);
  const raw = f.currentRaw(), event = (await f.events()).find(value => value.type === "DocumentArtifactEdited"), writes = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const checked = await f.check(input); assert.equal(checked.status, 200, await checked.clone().text()); assert.equal((await checked.json()).appended[0].eventId, event.eventId);
  assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, writes);
  const reordered = { model3dScale: { resultMediaSha256: input.model3dScale.resultMediaSha256, factor: 2, sourceMediaSha256: input.model3dScale.sourceMediaSha256 },
    expectedContentSha256: input.expectedContentSha256, expectedRevision: 0 };
  assert.equal(f.fingerprint(reordered), f.fingerprint(input));
  const observed = await f.edit(reordered); assert.equal(observed.status, 200, await observed.clone().text()); assert.equal((await observed.json()).appended[0].eventId, event.eventId);
  for (const fault of ["factor", "source", "revision"]) {
    const changed = structuredClone(input); if (fault === "factor") changed.model3dScale.factor = 3;
    if (fault === "source") changed.model3dScale.sourceMediaSha256 = "a".repeat(64); if (fault === "revision") changed.expectedRevision = 1;
    assert.notEqual((await f.check(changed)).status, 200);
  }
  assert.equal(f.currentRaw(), raw); assert.equal(f.revision(), 1); assert.equal(f.calls.put.length, 1); assert.equal(f.objects.size, 2);
});

test("model Check rechecks current custody kind and media scope before returning its exact ACK", async t => {
  for (const fault of ["content-kind", "current-media-scope"]) await t.test(fault, async child => {
    const f = await fixture(child), input = f.requestFor(), { revision } = await saved(f, await f.edit(input));
    const raw = f.currentRaw(), prepare = f.env.DB.prepare.bind(f.env.DB), puts = f.calls.put.length, deletes = f.calls.delete.length;
    let sourceReads = 0, finalReads = 0, changesAfterMutation;
    f.env.DB.prepare = sql => {
      const wrap = statement => {
        const bind = statement.bind.bind(statement), first = statement.first.bind(statement);
        statement.bind = (...values) => wrap(bind(...values));
        statement.first = async () => {
          const isFinal = sql.startsWith("SELECT 1 WHERE (")
            && sql.includes("AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?")
            && sql.includes("AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?");
          if (isFinal) {
            finalReads++; assert.equal(sourceReads, 1, "The initial owned source has already been read");
            if (fault === "content-kind") f.sqlite.prepare("UPDATE private_content SET kind='document-artifact-input' WHERE content_id=?").run(CONTENT);
            else {
              const key = decodeURIComponent(revision.media.url.slice("/api/media/".length));
              f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,'media',?,?,?,?,?,?)")
                .run("model-scope-during-check", key, "model-check-organization", PROJECT, OWNER, OWNER, new Date().toISOString());
              assert.equal(Object.hasOwn(f.objects.get(key).metadata, "projectAccessId"), false);
            }
            assert.equal(f.currentRaw(), raw, "Custody alone changes; content bytes stay equal");
            changesAfterMutation = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
          }
          const result = await first();
          if (sql.startsWith("SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL")) {
            sourceReads++; assert.equal(result.content, raw);
          }
          return result;
        };
        return statement;
      };
      return wrap(prepare(sql));
    };
    const response = await f.check(input); assert.equal(response.status, 409, await response.clone().text());
    const body = await response.json(); assert.equal(body.error, "model3d_scale_unconfirmed"); assert.equal(Object.hasOwn(body, "appended"), false);
    assert.equal(sourceReads, 1); assert.equal(finalReads, 1); assert.equal(f.currentRaw(), raw); assert.equal(f.revision(), 1);
    assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, changesAfterMutation, "Check adds no database writes");
    assert.equal(f.calls.put.length, puts); assert.equal(f.calls.delete.length, deletes); assert.equal(f.objects.size, 2);
  });
});

test("unobserved model PUT and DB outcomes remain uncertain without deleting possible retained bytes", async t => {
  for (const fault of ["put-before-storage", "put-after-storage", "db-before-commit"]) await t.test(fault, async child => {
    const f = await fixture(child), input = f.requestFor(), put = f.env.MEDIA.put.bind(f.env.MEDIA), batch = f.env.DB.batch.bind(f.env.DB); let attempts = 0;
    if (fault.startsWith("put")) f.env.MEDIA.put = async (...args) => { attempts++; if (fault === "put-after-storage") await put(...args); throw new Error("Unknown staging outcome"); };
    else f.env.DB.batch = async statements => { if (editBatch(statements)) { attempts++; throw new Error("Unknown model transaction outcome"); } return batch(statements); };
    const response = await f.edit(input); assert.equal(response.status, 503, await response.clone().text()); assert.equal((await response.json()).error, "model3d_scale_unconfirmed");
    assert.equal(attempts, 1); assert.equal(f.revision(), 0); assert.equal(f.currentRaw(), f.raw); assert.equal(f.historyCount(), 0); assert.equal(f.calls.delete.length, 0);
    assert.equal(f.objects.size, fault === "put-before-storage" ? 1 : 2); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
    const writes = f.sqlite.prepare("SELECT total_changes() AS n").get().n, checked = await f.check(input);
    assert.equal(checked.status, 409, await checked.clone().text()); assert.equal((await checked.json()).error, "model3d_scale_unconfirmed");
    assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, writes); assert.equal(attempts, 1);
  });
});

test("bounded model source read refuses an overlong stream and cancels without staging", async t => {
  const f = await fixture(t), get = f.env.MEDIA.get.bind(f.env.MEDIA); let reads = 0, cancels = 0;
  f.env.MEDIA.get = async key => { const object = await get(key); return key !== f.media.key || !object ? object : { ...object,
    body: new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(f.originalBytes.length + 1)); }, cancel() { cancels++; } }) }; };
  const response = await f.edit(); assert.equal(response.status, 404, await response.clone().text()); assert(cancels >= 1); assert(reads <= 3); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
});

test("the actual source bytes must match their retained digest before model geometry is staged", async t => {
  const f = await fixture(t), get = f.env.MEDIA.get.bind(f.env.MEDIA), corrupt = new Uint8Array(f.originalBytes); corrupt[corrupt.length - 1] ^= 1;
  f.env.MEDIA.get = async key => { const object = await get(key); return key !== f.media.key || !object ? object : { ...object,
    body: new ReadableStream({ start(controller) { controller.enqueue(corrupt); controller.close(); } }) }; };
  const response = await f.edit(); assert.equal(response.status, 404, await response.clone().text());
  assert.equal((await response.json()).error, "model3d_scale_unavailable"); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
});

test("a retained valid GLB with nonidentity node transforms is refused by the actual scale handler", async t => {
  const original = modelBytes(), originalView = new DataView(original.buffer, original.byteOffset, original.byteLength), jsonSize = originalView.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(original.subarray(20, 20 + jsonSize))); document.nodes[0].translation = [1, 0, 0];
  const json = new TextEncoder().encode(JSON.stringify(document)), padded = Math.ceil(json.length / 4) * 4, binChunk = original.subarray(20 + jsonSize);
  const transformed = new Uint8Array(20 + padded + binChunk.length), view = new DataView(transformed.buffer);
  transformed.set(original.subarray(0, 20)); view.setUint32(8, transformed.length, true); view.setUint32(12, padded, true);
  transformed.fill(32, 20, 20 + padded); transformed.set(json, 20); transformed.set(binChunk, 20 + padded);
  const f = await fixture(t, { sourceBytes: transformed }); assert.equal(f.objects.get(f.media.key).metadata.modelPreviewSafe, "true");
  const input = { expectedRevision: 0, expectedContentSha256: hash(f.raw), model3dScale: { sourceMediaSha256: hash(transformed), factor: 2, resultMediaSha256: "a".repeat(64) } };
  const response = await f.edit(input); assert.equal(response.status, 400, await response.clone().text());
  assert.equal((await response.json()).error, "model3d_scale_unsupported"); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
});

test("model source deadline settles while its hostile read and cancellation remain pending", async t => {
  const f = await fixture(t), input = f.requestFor(), get = f.env.MEDIA.get.bind(f.env.MEDIA), nativeTimeout = setTimeout;
  let reads = 0, cancels = 0, releases = 0, deadlines = 0;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds, ...args) => {
    if (milliseconds === 30000) { deadlines++; return nativeTimeout(callback, 5, ...args); } return nativeTimeout(callback, milliseconds, ...args);
  });
  const never = () => new Promise(() => {});
  f.env.MEDIA.get = async key => { const object = await get(key); return key !== f.media.key || !object ? object : { ...object, body: {
    getReader() { return { read() { reads++; return never(); }, cancel() { cancels++; return never(); }, releaseLock() { releases++; } }; }, cancel() { cancels++; return never(); },
  } }; };
  let watchdog; const expired = new Promise((_, reject) => { watchdog = nativeTimeout(() => reject(new Error("Model source did not settle after its deadline")), 1000); });
  try { const response = await Promise.race([f.edit(input), expired]); assert.equal(response.status, 404, await response.clone().text());
    assert(deadlines >= 1); assert.equal(reads, 1); assert(cancels >= 1); assert.equal(releases, 1); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
  } finally { clearTimeout(watchdog); }
});

test("early model metadata refusal never waits for a hostile cancel promise", async t => {
  for (const fault of ["declared-size", "mime", "owner"]) await t.test(fault, async child => {
    const f = await fixture(child), input = f.requestFor(), get = f.env.MEDIA.get.bind(f.env.MEDIA); let readers = 0, cancels = 0;
    f.env.MEDIA.get = async key => { const object = await get(key); if (key !== f.media.key || !object) return object; return { ...object,
      ...(fault === "declared-size" ? { size: Number.MAX_SAFE_INTEGER } : {}),
      ...(fault === "owner" ? { customMetadata: { ...object.customMetadata, ownerId: "other" } } : {}),
      ...(fault === "mime" ? { writeHttpMetadata(responseHeaders) { responseHeaders.set("content-type", "video/mp4"); } } : {}),
      body: { getReader() { readers++; throw new Error("Early refusal must not acquire a reader"); }, cancel() { cancels++; return new Promise(() => {}); } },
    }; };
    let watchdog; const expired = new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("Early model refusal waited for cancellation")), 1000); });
    try { const response = await Promise.race([f.edit(input), expired]); assert.equal(response.status, 404, await response.clone().text());
      assert.equal(readers, 0); assert.equal(cancels, 1); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
    } finally { clearTimeout(watchdog); }
  });
});

test("later model scaling binds an exact previous saved geometry snapshot", async t => {
  const f = await fixture(t), first = await saved(f, await f.edit()), sourceRaw = f.currentRaw(), sourceBytes = new Uint8Array(f.bytesAt(first.revision.media.url));
  const second = await saved(f, await f.edit(f.requestFor(.5, sourceBytes, 1, sourceRaw)));
  assert.equal(second.revision.source.revision, 1); assert.equal(second.revision.source.contentSha256, hash(sourceRaw));
  assert.equal(second.revision.source.url, first.revision.media.url); assert.equal(second.revision.source.sha256, first.revision.media.sha256);
  assert.deepEqual(second.revision.beforeBounds.size, [4, 4, 4]); assert.deepEqual(second.revision.afterBounds.size, [2, 2, 2]);
  assert.deepEqual(f.bytesAt(first.revision.media.url), sourceBytes); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
  assert.equal(f.revision(), 2); assert.equal(f.calls.put.length, 2); assert.equal(f.objects.size, 3);
});

test("ordinary text edit and original/scaled history restores preserve exact model files without another PUT", async t => {
  const f = await fixture(t, { differentRoot: true }), first = await saved(f, await f.edit()), edited = f.currentRaw();
  const text = await f.edit({ expectedRevision: 1, markdown: "Updated accompanying directions; saved model geometry remains current." });
  assert.equal(text.status, 200, await text.clone().text()); assert.deepEqual(JSON.parse(f.currentRaw()).model3d_revision, first.revision);
  assert.equal((await f.restore(0, 2)).status, 200); assert.equal(f.currentRaw(), f.raw); assert.equal(f.revision(), 3);
  let latest = (await f.events()).filter(value => value.type === "DocumentArtifactEdited").at(-1); assert.equal(latest.payload.model3d_revision, null);
  let artifact = foldEvents(await f.events(), Infinity, DOCUMENT, PROJECT).artifacts.find(item => item.id === ARTIFACT);
  assert.equal(artifact.mediaUrl, f.alternate.url); assert.equal(artifact.settings.model3d_files.length, 2);
  assert.equal((await f.restore(1, 3)).status, 200); assert.equal(f.currentRaw(), edited); assert.equal(f.revision(), 4);
  latest = (await f.events()).filter(value => value.type === "DocumentArtifactEdited").at(-1); assert.deepEqual(latest.payload.model3d_revision, first.revision);
  artifact = foldEvents(await f.events(), Infinity, DOCUMENT, PROJECT).artifacts.find(item => item.id === ARTIFACT); assert.equal(artifact.mediaUrl, first.revision.media.url);
  const response = await f.native(); assert.equal(response.status, 200, await response.clone().text()); assert.equal((await response.json()).content.files[0].url, first.revision.media.url);
  assert.equal(f.calls.put.length, 1); assert.equal(f.objects.size, 3); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.deepEqual(f.bytesAt(f.alternate.url), f.alternateBytes);
  assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
});

test("corrupt or retired source snapshots cannot authorize a subsequent generated model scale", async t => {
  for (const fault of ["corrupt-at-admission", "expired-at-admission", "changed-at-commit"]) await t.test(fault, async child => {
    const f = await fixture(child), first = await saved(f, await f.edit()), before = f.currentRaw(), input = f.requestFor(2, f.bytesAt(first.revision.media.url), 1, before);
    const corrupt = () => f.sqlite.prepare("UPDATE artifact_revisions SET content_json=content_json||' ' WHERE artifact_id=? AND revision=0").run(ARTIFACT);
    if (fault === "corrupt-at-admission") corrupt();
    if (fault === "expired-at-admission") f.sqlite.prepare("UPDATE artifact_revisions SET expires_at='2000-01-01T00:00:00.000Z' WHERE artifact_id=? AND revision=0").run(ARTIFACT);
    if (fault === "changed-at-commit") { const batch = f.env.DB.batch.bind(f.env.DB); f.env.DB.batch = async statements => { if (editBatch(statements)) corrupt(); return batch(statements); }; }
    const response = await f.edit(input); assert.equal(response.status, fault === "changed-at-commit" ? 409 : 404, await response.clone().text());
    assert.equal(f.currentRaw(), before); assert.equal(f.revision(), 1); assert.equal(f.historyCount(), 2); assert.equal(f.objects.size, 2);
    assert.equal(f.calls.put.length, fault === "changed-at-commit" ? 2 : 1); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
  });
});

test("historical geometry expiry during the retained-file read prevents restore", async t => {
  const f = await fixture(t), first = await saved(f, await f.edit()); assert.equal((await f.restore(0, 1)).status, 200);
  const get = f.env.MEDIA.get.bind(f.env.MEDIA), editedKey = decodeURIComponent(first.revision.media.url.slice("/api/media/".length)); let changed = false;
  f.env.MEDIA.get = async key => { const object = await get(key); if (key === editedKey && !changed) { changed = true;
    f.sqlite.prepare("UPDATE artifact_revisions SET expires_at='2000-01-01T00:00:00.000Z' WHERE artifact_id=? AND revision=1").run(ARTIFACT);
  } return object; };
  const response = await f.restore(1, 2); assert.equal(changed, true); assert.equal(response.status, 409, await response.clone().text());
  assert.equal(f.revision(), 2); assert.equal(f.currentRaw(), f.raw); assert.equal(f.calls.put.length, 1); assert.equal(f.objects.size, 2);
});

test("full model content validation and serialized-size refusal happen before staging", async t => {
  for (const fault of ["near-cap", "invalid-title", "summary-non-string", "presentation-non-null"]) await t.test(fault, async child => {
    const f = await fixture(child), body = JSON.parse(f.raw); body.summary = "";
    if (fault === "near-cap") body.summary = "x".repeat(999900 - Buffer.byteLength(JSON.stringify(body)));
    else if (fault === "invalid-title") body.title = "";
    else if (fault === "summary-non-string") body.summary = 17;
    else body.presentation = {};
    const raw = JSON.stringify(body); f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
    const response = await f.edit(f.requestFor(2, f.originalBytes, 0, raw)); assert.equal(response.status, 400, await response.clone().text());
    assert.equal((await response.json()).error, fault === "near-cap" ? "artifact_revision_too_large" : "invalid_artifact_revision");
    assert.equal(f.calls.put.length, 0); assertUncommitted(f, raw);
  });
});

test("a lone model revision marker on a non-model current artifact refuses all retained read and edit routes", async t => {
  const donor = await fixture(t), actual = await saved(donor, await donor.edit());
  for (const marker of ["valid", "null", "malformed"]) await t.test(marker, async child => {
    const item = { id: "retained-harbor-story-part", title: "The harbor cube", body: "At dusk, Mara found a small green cube beside the harbor and carried it home to finish her story.", notes: "An authored fictional story movement.", image_prompt: "" };
    const f = await fixture(child, {
      contentChange(content) { content.items = [item]; },
      completionChange(payload) { payload.artifact_kind = "short_story"; payload.item_count = 1; payload.items = [item]; },
    });
    const list = () => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}/revisions`, { headers }), f.env, ARTIFACT, ["revisions"]);
    const detail = () => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}/revisions/0`, { headers }), f.env, ARTIFACT, ["revisions", "0"]);
    assert.equal((await list()).status, 200); assert.equal((await detail()).status, 200);
    const ordinary = await f.edit({ expectedRevision: 0, markdown: "An ordinary retained story edit before the malformed kind marker." });
    assert.equal(ordinary.status, 200, await ordinary.clone().text()); assert.equal(f.revision(), 1);
    const body = JSON.parse(f.currentRaw()); body.model3d_revision = marker === "valid" ? actual.revision : marker === "null" ? null : { schemaVersion: 1, operation: "uniform-scale" };
    assert.equal(Object.hasOwn(body, "audio_revision"), false); assert.equal(Object.hasOwn(body, "video_revision"), false);
    const raw = JSON.stringify(body); if (marker === "valid") assert(model.parseDocumentArtifactContent(raw), "A parser-valid record must still be rejected for the authoritative story kind");
    f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
    const writes = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
    const operations = { list, detail, edit: () => f.edit({ expectedRevision: 1, markdown: "An attempted edit while the kind marker is invalid." }),
      check: () => f.check(f.requestFor()), restore: () => f.restore(0, 1) };
    for (const [route, invoke] of Object.entries(operations)) {
      const response = await invoke(); assert.equal(response.status, 409, `${route}: ${await response.clone().text()}`);
      assert.equal((await response.json()).error, "artifact_content_invalid", route);
    }
    assert.equal(f.currentRaw(), raw); assert.equal(f.revision(), 1); assert.equal(f.historyCount(), 2);
    assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, writes); assert.equal(f.calls.put.length, 0); assert.equal(f.calls.delete.length, 0);
  });
});

test("a lone model marker in non-model historical content refuses detail and restore before exposing retained writing", async t => {
  const donor = await fixture(t), actual = await saved(donor, await donor.edit());
  for (const marker of ["valid", "null", "malformed"]) await t.test(marker, async child => {
    const item = { id: "retained-harbor-story-part", title: "The harbor cube", body: "At dusk, Mara found a small green cube beside the harbor and carried it home to finish her story.", notes: "An authored fictional story movement.", image_prompt: "" };
    const f = await fixture(child, {
      contentChange(content) { content.items = [item]; },
      completionChange(payload) { payload.artifact_kind = "short_story"; payload.item_count = 1; payload.items = [item]; },
    });
    const ordinary = await f.edit({ expectedRevision: 0, markdown: "A current story with clean current content and a retained original revision." });
    assert.equal(ordinary.status, 200, await ordinary.clone().text());
    const current = f.currentRaw(), body = JSON.parse(f.raw);
    body.model3d_revision = marker === "valid" ? actual.revision : marker === "null" ? null : { schemaVersion: 1, operation: "uniform-scale" };
    const malformed = JSON.stringify(body); if (marker === "valid") assert(model.parseDocumentArtifactContent(malformed));
    f.sqlite.prepare("UPDATE artifact_revisions SET content_json=?,content_sha256=? WHERE artifact_id=? AND revision=0").run(malformed, hash(malformed), ARTIFACT);
    const detail = () => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}/revisions/0`, { headers }), f.env, ARTIFACT, ["revisions", "0"]);
    const writes = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
    for (const invoke of [detail, () => f.restore(0, 1)]) {
      const response = await invoke(); assert.equal(response.status, 404, await response.clone().text());
      const body = await response.json(); assert.equal(body.error, "artifact_revision_unavailable"); assert.equal(Object.hasOwn(body, "content"), false);
    }
    assert.equal(f.currentRaw(), current); assert.equal(f.revision(), 1); assert.equal(f.historyCount(), 2);
    assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, writes); assert.equal(f.calls.put.length, 0); assert.equal(f.calls.delete.length, 0);
    f.sqlite.prepare("UPDATE artifact_revisions SET content_json=?,content_sha256=? WHERE artifact_id=? AND revision=0").run(f.raw, hash(f.raw), ARTIFACT);
    assert.equal((await detail()).status, 200, "Removing only the invalid kind marker restores the ordinary history read");
    const restored = await f.restore(0, 1); assert.equal(restored.status, 200, await restored.clone().text()); assert.equal(f.currentRaw(), f.raw);
  });
});

test("a generic edit omitting the current derivative binding clears model media and cannot fall back to the original native file", async t => {
  const f = await fixture(t), first = await saved(f, await f.edit());
  const raw = JSON.stringify({ ...JSON.parse(f.raw), content_markdown: "Different accompanying writing with an intentionally omitted derivative binding." });
  f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
  const malformed = await runtime.appendAuditEvent(f.env, f.streamId, "user", "DocumentArtifactEdited", {
    artifact_id: ARTIFACT, artifact_kind: "model3d", document_id: DOCUMENT, project_id: PROJECT, content_ref: CONTENT,
    revision: 2, content_sha256: hash(raw), changed_fields: ["content_markdown"], edited_by_user_id: OWNER, source_surface: "document-artifact-editor",
  });
  const payload = JSON.parse(f.privatePayload(malformed.eventId)); assert.equal(Object.hasOwn(payload, "model3d_revision"), false);
  assert.equal(payload.content_sha256, hash(f.currentRaw())); assert.equal(Object.hasOwn(JSON.parse(raw), "model3d_revision"), false);
  const artifact = foldEvents(await f.events(), Infinity, DOCUMENT, PROJECT).artifacts.find(value => value.id === ARTIFACT);
  assert.equal(artifact.mediaUrl, null); assert.equal(artifact.mediaType, null); assert.deepEqual(artifact.settings.model3d_files, []);
  const response = await f.native(); assert.equal(response.status, 404, await response.clone().text());
  assert.equal(f.revision(), 2); assert.equal(f.calls.put.length, 1); assert.equal(f.calls.delete.length, 0); assert.equal(f.objects.size, 2);
  assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.equal(hash(f.bytesAt(first.revision.media.url)), first.revision.media.sha256);
  assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
});

test("an explicit original restore followed by an ordinary text edit retains the original native model file", async t => {
  const f = await fixture(t); await saved(f, await f.edit());
  const restored = await f.restore(0, 1); assert.equal(restored.status, 200, await restored.clone().text()); assert.equal(f.currentRaw(), f.raw);
  const edited = await f.edit({ expectedRevision: 2, markdown: "New writing after explicitly restoring the original model geometry." });
  assert.equal(edited.status, 200, await edited.clone().text()); assert.equal(f.revision(), 3);
  const latest = (await f.events()).filter(value => value.type === "DocumentArtifactEdited").at(-1);
  assert.equal(Object.hasOwn(latest.payload, "model3d_revision"), false); assert.equal(Object.hasOwn(JSON.parse(f.currentRaw()), "model3d_revision"), false);
  const artifact = foldEvents(await f.events(), Infinity, DOCUMENT, PROJECT).artifacts.find(value => value.id === ARTIFACT);
  assert.equal(artifact.mediaUrl, f.media.url); assert.equal(artifact.mediaType, MIME);
  const response = await f.native(); assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).content.files, JSON.parse(f.initialCompletion).settings.model3d_files);
  assert.equal(f.calls.put.length, 1); assert.equal(f.calls.delete.length, 0); assert.equal(f.objects.size, 2); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
  assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
});

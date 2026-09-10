import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ownedSocialVideo } from "./output-social-asset-fixtures.mjs";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

// Exact retained software fixture and actual Worker handlers. This suite does
// not import another suite, generate media, contact a provider or claim playback.
const imports = registerOutputSourceImports();
let handleArtifactEdit, handleNativeRetainedOutputRead, nativeRetainedOutputRequestPath, runtime, mediaApi, model, video, foldEvents;
try {
  ({ handleArtifactEdit } = await import("../worker/artifact-api.ts"));
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ nativeRetainedOutputRequestPath } = await import("../src/model/native-retained-output.ts"));
  runtime = await import("../worker/runtime.ts");
  mediaApi = await import("../worker/media-api.ts");
  model = await import("../src/model/document-artifacts.ts");
  video = await import("../src/model/video-container.ts");
  ({ foldEvents } = await import("../src/model/events.ts"));
} finally { imports.deregister(); }

const hash = value => createHash("sha256").update(value).digest("hex");
const OWNER = "video-trim-owner", EMAIL = "video-trim-owner@example.test", DOCUMENT = "video-trim-document";
const PROJECT = "video-trim-project", ARTIFACT = "video-trim-artifact", CONTENT = "video-trim-content";
const MEDIA_ITEM = "video-trim-encoded-part", TEXT_ITEM = "video-trim-text-only-part", EXPIRY = "2099-01-01T00:00:00.000Z";
const headers = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
const patch = value => ({ method: "PATCH", headers: { ...headers, "content-type": "application/json", origin: "https://forma.test" }, body: JSON.stringify(value) });
const editBatch = statements => statements[0]?.sql.includes("INSERT INTO event_write_stage") && statements[0]?.sql.includes("private_content");
const originalContent = () => ({ title: "Harbor ending", summary: "Owned encoded fixture; no playback or useful-content claim.",
  content_markdown: "Keep the opening of this retained scene. Preserve every accompanying word.", presentation: null,
  items: [
    { title: "Encoded scene", body: "The one retained silent scene keeps its original identity.", notes: "Authored fixture notes.", image_prompt: "", slide: null },
    { title: "Text-only ending", body: "This separate text-only item must survive the media edit.", notes: "No playable file exists for this item.", image_prompt: "", slide: null },
  ] });

async function fixture(t, { sourceBytes = ownedSocialVideo("16:9"), mimeType = "video/mp4", kind = "video", completionChange, contentChange } = {}) {
  const state = outputTestDatabase();
  t.after(() => { try { state.sqlite.close(); } finally { state.media.clear(); } });
  await runtime.ensureSchema(state.env);
  const now = new Date().toISOString(), streamId = `creative:${OWNER}`;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Video trim owner", "creator", "pilot-2026-08-10", now, now, now);
  await runtime.appendAuditEvent(state.env, streamId, "user", "ProjectCreated", { project_id: PROJECT, name: "Video persistence controls" });
  await runtime.appendAuditEvent(state.env, streamId, "user", "DocumentCreated", { project_id: PROJECT, document_id: DOCUMENT, title: "Video trim source" });
  const originalBytes = new Uint8Array(sourceBytes);
  const media = await mediaApi.storeGeneratedMedia(state.env, OWNER, ARTIFACT, originalBytes, "owned-offline-mp4-fixture", mimeType, { source: "synthetic-retained-fixture" });
  const content = originalContent(); contentChange?.(content);
  const raw = JSON.stringify(model.parseDocumentArtifactContent(JSON.stringify(content)));
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const payload = { project_id: PROJECT, document_id: DOCUMENT, artifact_id: ARTIFACT, artifact_kind: kind,
    requested_by_user_id: OWNER, title: content.title, content_ref: CONTENT, input_ref: "video-trim-original-input", item_count: 2,
    items: [
      { id: MEDIA_ITEM, title: content.items[0].title, media_url: media.url, media_type: "video/mp4" },
      { id: TEXT_ITEM, title: content.items[1].title, media_url: null, media_type: null },
    ], media_url: media.url, media_type: mimeType,
    // Legacy Video completion has owned URLs but no authoritative source SHA.
    settings: { item_count: 2, production_mode: "manual", video_seconds: 2, video_size: "32x18", video_audio_mode: "silent" } };
  completionChange?.(payload);
  const completion = await runtime.appendAuditEvent(state.env, streamId, "worker:renderer", "DocumentRenderCompleted", payload);
  const privatePayload = eventId => state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId)?.private_json;
  const initialCompletion = privatePayload(completion.eventId);
  const currentRaw = () => state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content;
  const events = () => runtime.readWorkspaceEvents(state.env, streamId);
  const revision = () => state.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type='DocumentArtifactEdited'").get(streamId).n;
  const historyCount = () => state.sqlite.prepare("SELECT COUNT(*) AS n FROM artifact_revisions WHERE artifact_id=?").get(ARTIFACT).n;
  const requestFor = async (endSample = 2, bytes = originalBytes, expectedRevision = 0, sourceRaw = raw) => {
    const source = await video.inspectVideoPrefix(bytes), result = await video.trimVideoPrefix(bytes, { startSample: 0, endSample });
    assert(source && result, "The fixture request must use a supported exact source and endpoint");
    return { expectedRevision, expectedContentSha256: hash(sourceRaw), videoTrim: { sourceMediaSha256: hash(bytes), sourceSampleCount: source.sampleCount,
      startSample: 0, endSample, resultMediaSha256: hash(result.bytes) } };
  };
  const edit = async input => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}`, patch(input ?? await requestFor())), state.env, ARTIFACT);
  const restore = (selected, expectedRevision) => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}/revisions/${selected}/restore`,
    { ...patch({ expectedRevision }), method: "POST" }), state.env, ARTIFACT, ["revisions", String(selected), "restore"]);
  const fingerprint = input => hash(JSON.stringify(model.parseVideoTrimEditRequest(input)));
  const check = input => handleArtifactEdit(new Request(`https://forma.test/api/artifacts/${ARTIFACT}?videoTrimOperation=${fingerprint(input)}&expectedRevision=${input.expectedRevision}`, { headers }), state.env, ARTIFACT);
  const native = () => handleNativeRetainedOutputRead(new Request(`https://forma.test${nativeRetainedOutputRequestPath({ output: "video",
    selection: { documentId: DOCUMENT, artifactId: ARTIFACT, revision: revision(), contentSha256: hash(currentRaw()) } })}`, { headers }), state.env);
  const calls = { get: [], put: [], delete: [] };
  for (const method of Object.keys(calls)) {
    const original = state.env.MEDIA[method].bind(state.env.MEDIA);
    state.env.MEDIA[method] = async (...args) => { calls[method].push(args[0]); return original(...args); };
  }
  const bytesAt = url => state.media.get(decodeURIComponent(url.slice("/api/media/".length)))?.bytes;
  return { ...state, objects: state.media, media, originalBytes, raw, streamId, completion, initialCompletion, privatePayload,
    currentRaw, events, revision, historyCount, requestFor, edit, restore, fingerprint, check, native, calls, bytesAt };
}

function assertUncommitted(f, expectedRaw = f.raw) {
  assert.equal(f.revision(), 0); assert.equal(f.historyCount(), 0); assert.equal(f.currentRaw(), expectedRaw);
  assert.equal(f.objects.size, 1); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
  assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
}
async function saved(f, response) {
  assert.equal(response.status, 200, await response.clone().text());
  const ack = await response.json(), content = model.parseDocumentArtifactContent(f.currentRaw());
  assert.equal(ack.appended.length, 1); assert.equal(ack.revision, f.revision()); assert.equal(ack.content[CONTENT], f.currentRaw());
  assert.deepEqual(ack.appended[0].payload.video_revision, content.video_revision);
  assert.deepEqual(JSON.parse(f.privatePayload(ack.appended[0].eventId)), ack.appended[0].payload);
  assert.equal(ack.appended[0].payload.content_sha256, hash(f.currentRaw()));
  return { ack, content, revision: content.video_revision };
}

test("actual saved Video prefix uses owned legacy bytes and preserves the sole clip, text-only item and original history", async t => {
  const f = await fixture(t), input = await f.requestFor(), expected = await video.trimVideoPrefix(f.originalBytes, { startSample: 0, endSample: 2 });
  assert.equal(f.originalBytes.length, 1513); assert.equal(Object.hasOwn(JSON.parse(f.initialCompletion).settings, "source_media_sha256"), false);
  const { ack, content, revision } = await saved(f, await f.edit(input));
  assert.equal(f.revision(), 1); assert.equal(f.calls.put.length, 1); assert.equal(f.objects.size, 2);
  assert.equal(revision.source.itemId, MEDIA_ITEM); assert.equal(revision.source.revision, 0); assert.equal(revision.source.contentSha256, hash(f.raw));
  assert.equal(revision.source.sha256, hash(f.originalBytes)); assert.equal(revision.source.sampleCount, 4);
  assert.equal(revision.source.timescale, 16384); assert.equal(revision.source.durationTicks, 32768);
  assert.equal(revision.startSample, 0); assert.equal(revision.endSample, 2); assert.equal(revision.sampleCount, 2);
  assert.equal(revision.timescale, 16384); assert.equal(revision.durationTicks, 16384); assert.equal(revision.durationSeconds, 1);
  assert.equal(revision.width, 32); assert.equal(revision.height, 18); assert.equal(revision.media.byteLength, expected.bytes.length);
  assert.equal(revision.media.sha256, hash(expected.bytes)); assert.deepEqual(f.bytesAt(revision.media.url), expected.bytes);
  assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
  assert.deepEqual({ ...content, video_revision: undefined }, { ...model.parseDocumentArtifactContent(f.raw), video_revision: undefined });
  for (const [number, raw] of [[0, f.raw], [1, f.currentRaw()]]) {
    const row = f.sqlite.prepare("SELECT content_json,content_sha256 FROM artifact_revisions WHERE artifact_id=? AND revision=?").get(ARTIFACT, number);
    assert.equal(row.content_json, raw); assert.equal(row.content_sha256, hash(raw));
  }
  const artifact = foldEvents(await f.events(), Infinity, DOCUMENT, PROJECT).artifacts.find(item => item.id === ARTIFACT);
  assert.equal(artifact.mediaUrl, revision.media.url); assert.equal(artifact.settings.video_seconds, 1);
  assert.deepEqual(artifact.items.map(item => item.id), [MEDIA_ITEM, TEXT_ITEM]);
  assert.equal(artifact.items[0].mediaUrl, revision.media.url); assert.equal(artifact.items[1].mediaUrl, null);
  const reopened = await f.native(); assert.equal(reopened.status, 200, await reopened.clone().text());
  const dto = await reopened.json(); assert.equal(dto.content.primaryMedia.url, revision.media.url);
  assert.equal(dto.content.clips[0].id, MEDIA_ITEM); assert.equal(dto.content.clips[0].media.url, revision.media.url);
  assert.equal(dto.content.clips[1].id, TEXT_ITEM); assert.equal(dto.content.clips[1].media, null);
  assert.equal(dto.content.clips[1].body, content.items[1].body); assert.equal(dto.content.clips[1].notes, content.items[1].notes);
  assert.equal(ack.appended[0].payload.video_trim_request_sha256, f.fingerprint(input));
});

test("Video media Save preserves unknown raw metadata and exact authored values outside its revision field", async t => {
  const f = await fixture(t), body = JSON.parse(f.raw);
  body.producer_note = { literal: "\tCafé 雨 — retained metadata 🌱\n", nullable: null, flags: [false, true] };
  body.items[0].retained_source_note = { label: "  Preserve this spacing.  ", indices: [0, 3] };
  body.items[1].retained_text_note = "Unrelated text-only item metadata";
  const raw = JSON.stringify(body); f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
  const response = await f.edit(await f.requestFor(2, f.originalBytes, 0, raw)); assert.equal(response.status, 200, await response.clone().text());
  const current = JSON.parse(f.currentRaw()); assert.equal(current.video_revision.source.contentSha256, hash(raw));
  delete current.video_revision; assert.deepEqual(current, body);
  assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE artifact_id=? AND revision=0").get(ARTIFACT).content_json, raw);
  assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
});

test("a later prefix Save binds the exact retained source snapshot for trimmed and legacy text-only sources", async t => {
  for (const source of ["trimmed", "legacy-text"]) await t.test(source, async child => {
    const f = await fixture(child); let sourceBytes = f.originalBytes, sourceUrl = f.media.url;
    if (source === "trimmed") {
      const first = await saved(f, await f.edit()); sourceUrl = first.revision.media.url; sourceBytes = new Uint8Array(f.bytesAt(sourceUrl));
    } else {
      const response = await f.edit({ expectedRevision: 0, markdown: "Changed accompanying notes; the original clip is still current." });
      assert.equal(response.status, 200, await response.clone().text());
    }
    assert.equal(f.revision(), 1); const sourceRaw = f.currentRaw(), endSample = source === "trimmed" ? 1 : 2;
    const result = await saved(f, await f.edit(await f.requestFor(endSample, sourceBytes, 1, sourceRaw)));
    assert.equal(result.revision.source.revision, 1); assert.equal(result.revision.source.contentSha256, hash(sourceRaw));
    assert.equal(result.revision.source.url, sourceUrl); assert.equal(result.revision.source.sha256, hash(sourceBytes));
    assert.equal(result.revision.source.sampleCount, source === "trimmed" ? 2 : 4);
    assert.equal(result.revision.durationSeconds, source === "trimmed" ? .5 : 1); assert.equal(f.revision(), 2);
    assert.deepEqual(f.bytesAt(sourceUrl), sourceBytes); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
    assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE artifact_id=? AND revision=1").get(ARTIFACT).content_json, sourceRaw);
    const response = await f.native(); assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).content.primaryMedia.url, result.revision.media.url);
    assert.equal(f.calls.put.length, source === "trimmed" ? 2 : 1); assert.equal(f.objects.size, source === "trimmed" ? 3 : 2);
  });
});

test("a corrupted or retired one-hop source snapshot cannot authorize a subsequent Video Save", async t => {
  for (const fault of ["corrupt-at-admission", "expired-at-admission", "changed-at-commit"]) await t.test(fault, async child => {
    const f = await fixture(child), first = await saved(f, await f.edit()), before = f.currentRaw();
    const input = await f.requestFor(1, new Uint8Array(f.bytesAt(first.revision.media.url)), 1, before);
    const corrupt = () => f.sqlite.prepare("UPDATE artifact_revisions SET content_json=content_json||' ' WHERE artifact_id=? AND revision=0").run(ARTIFACT);
    if (fault === "corrupt-at-admission") corrupt();
    if (fault === "expired-at-admission") f.sqlite.prepare("UPDATE artifact_revisions SET expires_at='2000-01-01T00:00:00.000Z' WHERE artifact_id=? AND revision=0").run(ARTIFACT);
    if (fault === "changed-at-commit") {
      const batch = f.env.DB.batch.bind(f.env.DB);
      f.env.DB.batch = async statements => { if (editBatch(statements)) corrupt(); return batch(statements); };
    }
    const response = await f.edit(input); assert.equal(response.status, fault === "changed-at-commit" ? 409 : 404, await response.clone().text());
    assert.equal(f.currentRaw(), before); assert.equal(f.revision(), 1); assert.equal(f.historyCount(), 2); assert.equal(f.objects.size, 2);
    assert.equal(f.calls.put.length, fault === "changed-at-commit" ? 2 : 1);
    assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.equal(hash(f.bytesAt(first.revision.media.url)), first.revision.media.sha256);
  });
});

test("whole prefix preserves exact source identity and creates no object, revision or history", async t => {
  const f = await fixture(t), response = await f.edit(await f.requestFor(4));
  assert.equal(response.status, 200, await response.clone().text());
  const ack = await response.json(); assert.deepEqual(ack.appended, []); assert.equal(ack.revision, 0); assert.equal(ack.content[CONTENT], f.raw);
  assert.equal(f.calls.put.length, 0); assertUncommitted(f);
});

test("closed Video request grammar, exact clocks and hashes reject without staging", async t => {
  for (const fault of ["root-extra", "trim-extra", "mixed-audio", "nonzero-start", "fraction", "empty", "beyond-end", "unsafe-end", "string-end", "missing-hash", "result-hash", "source-hash", "sample-count", "stale-content", "stale-revision"])
    await t.test(fault, async child => {
      const f = await fixture(child), input = await f.requestFor();
      if (fault === "root-extra") input.mediaUrl = f.media.url;
      if (fault === "trim-extra") input.videoTrim.mediaUrl = f.media.url;
      if (fault === "mixed-audio") input.audioTrim = {};
      if (fault === "nonzero-start") input.videoTrim.startSample = 1;
      if (fault === "fraction") input.videoTrim.endSample = 1.5;
      if (fault === "empty") input.videoTrim.endSample = 0;
      if (fault === "beyond-end") input.videoTrim.endSample = 5;
      if (fault === "unsafe-end") input.videoTrim.endSample = Number.MAX_SAFE_INTEGER + 1;
      if (fault === "string-end") input.videoTrim.endSample = "2";
      if (fault === "missing-hash") delete input.videoTrim.resultMediaSha256;
      if (fault === "result-hash") input.videoTrim.resultMediaSha256 = "a".repeat(64);
      if (fault === "source-hash") input.videoTrim.sourceMediaSha256 = "b".repeat(64);
      if (fault === "sample-count") input.videoTrim.sourceSampleCount = 5;
      if (fault === "stale-content") input.expectedContentSha256 = "c".repeat(64);
      if (fault === "stale-revision") input.expectedRevision = 1;
      const response = await f.edit(input); assert.notEqual(response.status, 200, fault);
      assert.equal(f.calls.put.length, 0); assertUncommitted(f);
    });
});

test("Video topology, MIME and owner admission refuse missing, foreign or ambiguous playable sources", async t => {
  for (const fault of ["wrong-kind", "wrong-mime", "root-missing", "root-item-differ", "two-playable-items", "no-playable-item", "missing-item-id", "duplicate-item-id", "foreign-object-owner", "authoritative-hash-mismatch"])
    await t.test(fault, async child => {
      const f = await fixture(child, { kind: fault === "wrong-kind" ? "storyboard" : "video", mimeType: fault === "wrong-mime" ? "application/octet-stream" : "video/mp4",
        completionChange(payload) {
          if (fault === "root-missing") { payload.media_url = null; payload.media_type = null; }
          if (fault === "root-item-differ") payload.items[0].media_url = payload.media_url.replace(".mp4", "-different.mp4");
          if (fault === "two-playable-items") Object.assign(payload.items[1], { media_url: payload.media_url, media_type: "video/mp4" });
          if (fault === "no-playable-item") Object.assign(payload.items[0], { media_url: null, media_type: null });
          if (fault === "missing-item-id") delete payload.items[0].id;
          if (fault === "duplicate-item-id") payload.items[1].id = MEDIA_ITEM;
          if (fault === "authoritative-hash-mismatch") payload.settings.source_media_sha256 = "f".repeat(64);
        } });
      if (fault === "foreign-object-owner") f.objects.get(f.media.key).metadata.ownerId = "another-owner";
      const response = await f.edit(); assert.notEqual(response.status, 200, fault); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
    });
});

test("a matching optional authoritative legacy hash agrees with independently read source bytes", async t => {
  const sourceBytes = ownedSocialVideo("16:9"), f = await fixture(t, { sourceBytes, completionChange(payload) { payload.settings.source_media_sha256 = hash(sourceBytes); } });
  const { revision } = await saved(f, await f.edit()); assert.equal(revision.source.sha256, hash(sourceBytes));
});

test("actual Worker refuses unsupported encoded source after exact owned source hash admission", async t => {
  for (const fault of ["codec", "audio-handler", "truncated"]) await t.test(fault, async child => {
    let sourceBytes = ownedSocialVideo("16:9");
    if (fault === "truncated") sourceBytes = sourceBytes.slice(0, -1);
    else {
      const marker = fault === "codec" ? "avc1" : "vide", replacement = fault === "codec" ? "hvc1" : "soun";
      const offset = Buffer.from(sourceBytes).indexOf(marker, 32); assert(offset > 32);
      sourceBytes.set(new TextEncoder().encode(replacement), offset);
    }
    const f = await fixture(child, { sourceBytes }), expected = await video.trimVideoPrefix(ownedSocialVideo("16:9"), { startSample: 0, endSample: 2 });
    const input = { expectedRevision: 0, expectedContentSha256: hash(f.raw), videoTrim: { sourceMediaSha256: hash(sourceBytes), sourceSampleCount: 4, startSample: 0, endSample: 2, resultMediaSha256: expected.sha256 } };
    const response = await f.edit(input); assert.equal(response.status, 400, await response.clone().text());
    assert.equal((await response.json()).error, "video_trim_unsupported"); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
  });
});

test("conditional Video commit rechecks current authority and raw source before retaining a revision", async t => {
  for (const fault of ["role", "consent", "raw", "head", "expiry", "redaction", "owner", "rescope"]) await t.test(fault, async child => {
    const f = await fixture(child), batch = f.env.DB.batch.bind(f.env.DB); let intercepted = 0;
    const unrelated = await mediaApi.storeGeneratedMedia(f.env, OWNER, "unrelated-retained-object", new Uint8Array([1, 2, 3]), "fixture", "application/octet-stream");
    f.calls.put.length = 0;
    f.env.DB.batch = async statements => {
      if (editBatch(statements)) {
        intercepted++;
        if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
        if (fault === "consent") f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(OWNER);
        if (fault === "raw") f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(f.raw + " ", CONTENT);
        if (fault === "head") await runtime.appendAuditEvent({ ...f.env, DB: { ...f.env.DB, batch } }, f.streamId, "user", "DocumentRenamed", { document_id: DOCUMENT, project_id: PROJECT, title: "Concurrent source change" });
        if (fault === "expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
        if (fault === "redaction") f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT);
        if (fault === "owner") f.sqlite.prepare("UPDATE private_content SET owner_id='another-owner' WHERE content_id=?").run(CONTENT);
        if (fault === "rescope") f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,'artifact',?,?,?,?,?,?)")
          .run("scope-during-video-save", ARTIFACT, "organization-during-video-save", PROJECT, OWNER, OWNER, new Date().toISOString());
      }
      return batch(statements);
    };
    const response = await f.edit(); assert.equal(response.status, 409, await response.clone().text()); assert.equal(intercepted, 1);
    assert.equal(f.revision(), 0); assert.equal(f.historyCount(), 0); assert.equal(f.calls.put.length, 1);
    assert.equal(f.objects.size, 2); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.deepEqual(f.bytesAt(unrelated.url), new Uint8Array([1, 2, 3]));
    assert.equal(f.calls.delete.flat().includes(f.media.key), false); assert.equal(f.calls.delete.flat().includes(unrelated.key), false);
  });
});

test("source ownership changes during the owned media read refuse before PUT", async t => {
  for (const fault of ["role", "raw", "expiry"]) await t.test(fault, async child => {
    const f = await fixture(child), input = await f.requestFor(), get = f.env.MEDIA.get.bind(f.env.MEDIA); let changed = false;
    f.env.MEDIA.get = async key => {
      const object = await get(key);
      if (key === f.media.key && !changed) {
        changed = true;
        if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
        if (fault === "raw") f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(f.raw + " ", CONTENT);
        if (fault === "expiry") f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT);
      }
      return object;
    };
    const response = await f.edit(input); assert.equal(changed, true); assert.equal(response.status, 409, await response.clone().text());
    assert.equal(f.calls.put.length, 0); assertUncommitted(f, fault === "raw" ? f.raw + " " : f.raw);
  });
});

test("trigger-inclusive positive integer batch changes acknowledge the exact committed Video edit", async t => {
  const f = await fixture(t), batch = f.env.DB.batch.bind(f.env.DB), metrics = [];
  f.env.DB.batch = async statements => {
    if (!editBatch(statements)) return batch(statements);
    const originals = statements.map(statement => statement.execute);
    statements.forEach((statement, index) => { statement.execute = function(kind) {
      const before = f.sqlite.prepare("SELECT total_changes() AS n").get().n, result = originals[index].call(this, kind);
      const changes = f.sqlite.prepare("SELECT total_changes() AS n").get().n - before;
      metrics.push({ success: result.success, directChanges: result.meta.changes, changes });
      return { ...result, meta: { ...result.meta, changes } };
    }; });
    try { return await batch(statements); } finally { statements.forEach((statement, index) => { statement.execute = originals[index]; }); }
  };
  await saved(f, await f.edit()); assert(metrics[0].changes > metrics[0].directChanges);
  assert(metrics.every(value => value.success === true && Number.isSafeInteger(value.changes) && value.changes > 0));
});

test("incomplete or invalid D1 ACK never confirms or deletes a committed Video trim", async t => {
  for (const fault of ["not-array", "missing-result", "extra-result", "hole", "missing-meta", "zero", "negative", "fraction", "nan", "infinity", "string", "unsafe-integer", "false-success", "missing-success"])
    await t.test(fault, async child => {
      const f = await fixture(child), batch = f.env.DB.batch.bind(f.env.DB); let intercepted = 0;
      f.env.DB.batch = async statements => {
        const results = await batch(statements); if (!editBatch(statements)) return results; intercepted++;
        if (fault === "not-array") return null;
        if (fault === "missing-result") return results.slice(1);
        if (fault === "extra-result") return [...results, results[0]];
        if (fault === "hole") { delete results[0]; return results; }
        if (fault === "missing-meta") { delete results[0].meta; return results; }
        if (fault === "false-success") { results[0].success = false; return results; }
        if (fault === "missing-success") { delete results[0].success; return results; }
        results[0].meta.changes = { zero: 0, negative: -1, fraction: .5, nan: NaN, infinity: Infinity, string: "1", "unsafe-integer": Number.MAX_SAFE_INTEGER + 1 }[fault]; return results;
      };
      const response = await f.edit(); assert.equal(response.status, 503, await response.clone().text()); assert.equal((await response.json()).error, "video_trim_unconfirmed");
      assert.equal(intercepted, 1); assert.equal(f.revision(), 1); assert.equal(f.historyCount(), 2); assert.equal(f.objects.size, 2); assert.equal(f.calls.delete.length, 0);
      const revision = JSON.parse(f.currentRaw()).video_revision; assert.equal(hash(f.bytesAt(revision.media.url)), revision.media.sha256);
      assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
    });
});

test("lost committed response reconciles by exact read-only Check and never stages a second operation", async t => {
  const f = await fixture(t), input = await f.requestFor(), batch = f.env.DB.batch.bind(f.env.DB); let lost = false;
  f.env.DB.batch = async statements => { const result = await batch(statements); if (editBatch(statements) && !lost) { lost = true; throw new Error("Deliberately lost committed Video response"); } return result; };
  const response = await f.edit(input); assert.equal(response.status, 503); assert.equal(f.revision(), 1);
  const raw = f.currentRaw(), event = (await f.events()).find(value => value.type === "DocumentArtifactEdited"), writes = f.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const checked = await f.check(input); assert.equal(checked.status, 200, await checked.clone().text()); assert.equal((await checked.json()).appended[0].eventId, event.eventId);
  assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, writes, "Check must only observe the original save");
  const reordered = { videoTrim: { resultMediaSha256: input.videoTrim.resultMediaSha256, endSample: input.videoTrim.endSample, startSample: 0,
    sourceSampleCount: 4, sourceMediaSha256: input.videoTrim.sourceMediaSha256 }, expectedContentSha256: input.expectedContentSha256, expectedRevision: 0 };
  assert.equal(f.fingerprint(reordered), f.fingerprint(input));
  const observed = await f.edit(reordered); assert.equal(observed.status, 200, await observed.clone().text());
  assert.equal((await observed.json()).appended[0].eventId, event.eventId); assert.equal(f.currentRaw(), raw); assert.equal(f.calls.put.length, 1); assert.equal(f.revision(), 1);
  for (const fault of ["source", "endpoint", "revision"]) {
    const changed = structuredClone(input);
    if (fault === "source") changed.videoTrim.sourceMediaSha256 = "a".repeat(64);
    if (fault === "endpoint") changed.videoTrim.endSample = 1;
    if (fault === "revision") changed.expectedRevision = 1;
    assert.notEqual((await f.check(changed)).status, 200);
  }
  assert.equal(f.calls.put.length, 1); assert.equal(f.revision(), 1); assert.equal(f.objects.size, 2);
});

test("Video Check rechecks content kind after its initial exact source read without publishing an ACK or writing", async t => {
  const f = await fixture(t), input = await f.requestFor(); await saved(f, await f.edit(input));
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
          finalReads++; assert.equal(sourceReads, 1, "The initial owned source must already have been read");
          f.sqlite.prepare("UPDATE private_content SET kind='document-artifact-input' WHERE content_id=?").run(CONTENT);
          assert.equal(f.currentRaw(), raw, "Only custody kind changes; exact source bytes stay equal");
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
  const body = await response.json(); assert.equal(body.error, "video_trim_unconfirmed"); assert.equal(Object.hasOwn(body, "appended"), false);
  assert.equal(sourceReads, 1); assert.equal(finalReads, 1); assert.equal(f.currentRaw(), raw); assert.equal(f.revision(), 1);
  assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, changesAfterMutation, "Check adds no database write after the injected kind change");
  assert.equal(f.calls.put.length, puts); assert.equal(f.calls.delete.length, deletes); assert.equal(f.objects.size, 2);
});

test("lost PUT or unobserved DB outcome preserves uncertainty and never deletes possibly retained bytes", async t => {
  for (const fault of ["put-before-storage", "put-after-storage", "db-before-commit"]) await t.test(fault, async child => {
    const f = await fixture(child), input = await f.requestFor(), put = f.env.MEDIA.put.bind(f.env.MEDIA), batch = f.env.DB.batch.bind(f.env.DB); let attempts = 0;
    if (fault.startsWith("put")) f.env.MEDIA.put = async (...args) => { attempts++; if (fault === "put-after-storage") await put(...args); throw new Error("Staging outcome intentionally unknown"); };
    else f.env.DB.batch = async statements => { if (editBatch(statements)) { attempts++; throw new Error("Commit outcome intentionally unknown"); } return batch(statements); };
    const response = await f.edit(input); assert.equal(response.status, 503, await response.clone().text()); assert.equal((await response.json()).error, "video_trim_unconfirmed");
    assert.equal(attempts, 1); assert.equal(f.revision(), 0); assert.equal(f.currentRaw(), f.raw); assert.equal(f.historyCount(), 0); assert.equal(f.calls.delete.length, 0);
    assert.equal(f.objects.size, fault === "put-before-storage" ? 1 : 2); assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes);
    const writes = f.sqlite.prepare("SELECT total_changes() AS n").get().n, checked = await f.check(input);
    assert.equal(checked.status, 409, await checked.clone().text()); assert.equal((await checked.json()).error, "video_trim_unconfirmed");
    assert.equal(f.sqlite.prepare("SELECT total_changes() AS n").get().n, writes); assert.equal(attempts, 1);
  });
});

test("Video source reads reject overlong streams and cancel without staging", async t => {
  const f = await fixture(t), get = f.env.MEDIA.get.bind(f.env.MEDIA); let pulls = 0, cancels = 0;
  f.env.MEDIA.get = async key => { const object = await get(key); return key !== f.media.key || !object ? object : { ...object,
    body: new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(f.originalBytes.length + 1)); }, cancel() { cancels++; } }) }; };
  const response = await f.edit(); assert.equal(response.status, 404, await response.clone().text()); assert(cancels >= 1); assert(pulls <= 3); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
});

test("Video actual-read deadline settles even if read and cancellation promises never settle", async t => {
  const f = await fixture(t), input = await f.requestFor(), get = f.env.MEDIA.get.bind(f.env.MEDIA), nativeTimeout = globalThis.setTimeout;
  let reads = 0, cancels = 0, releases = 0, deadlines = 0;
  t.mock.method(globalThis, "setTimeout", (callback, milliseconds, ...args) => {
    if (milliseconds === 30000) { deadlines++; return nativeTimeout(callback, 5, ...args); }
    return nativeTimeout(callback, milliseconds, ...args);
  });
  const never = () => new Promise(() => {});
  f.env.MEDIA.get = async key => { const object = await get(key); return key !== f.media.key || !object ? object : { ...object, body: {
    getReader() { return { read() { reads++; return never(); }, cancel() { cancels++; return never(); }, releaseLock() { releases++; } }; },
    cancel() { cancels++; return never(); },
  } }; };
  let watchdog;
  const expired = new Promise((_, reject) => { watchdog = nativeTimeout(() => reject(new Error("Video source read did not settle after its deadline")), 1000); });
  try {
    const response = await Promise.race([f.edit(input), expired]); assert.equal(response.status, 404, await response.clone().text());
    assert(deadlines >= 1); assert.equal(reads, 1); assert(cancels >= 1); assert.equal(releases, 1); assert.equal(f.calls.put.length, 0); assertUncommitted(f);
  } finally { clearTimeout(watchdog); }
});

test("early source metadata refusal observes cancellation without waiting for a hostile cancel promise", async t => {
  for (const fault of ["declared-size", "mime", "owner"]) await t.test(fault, async child => {
    const f = await fixture(child), input = await f.requestFor(), get = f.env.MEDIA.get.bind(f.env.MEDIA); let readers = 0, cancels = 0;
    f.env.MEDIA.get = async key => { const object = await get(key); if (key !== f.media.key || !object) return object; return { ...object,
      ...(fault === "declared-size" ? { size: Number.MAX_SAFE_INTEGER } : {}),
      ...(fault === "owner" ? { customMetadata: { ...object.customMetadata, ownerId: "other" } } : {}),
      ...(fault === "mime" ? { writeHttpMetadata(responseHeaders) { responseHeaders.set("content-type", "audio/wav"); } } : {}),
      body: { getReader() { readers++; throw new Error("Early refusal must not acquire a reader"); }, cancel() { cancels++; return new Promise(() => {}); } },
    }; };
    let watchdog;
    const expired = new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("Early Video refusal waited for cancellation")), 1000); });
    try {
      const response = await Promise.race([f.edit(input), expired]); assert.equal(response.status, 404, await response.clone().text()); assert.equal(readers, 0); assert.equal(cancels, 1);
      assert.equal(f.calls.put.length, 0); assertUncommitted(f);
    } finally { clearTimeout(watchdog); }
  });
});

test("ordinary text edit preserves saved Video media and original/edited restore creates only new references", async t => {
  const f = await fixture(t), { revision } = await saved(f, await f.edit()), edited = f.currentRaw();
  const text = await f.edit({ expectedRevision: 1, markdown: "New accompanying text; the retained prefix remains exact." });
  assert.equal(text.status, 200, await text.clone().text()); assert.deepEqual(JSON.parse(f.currentRaw()).video_revision, revision); assert.equal(f.revision(), 2);
  let dto = await (await f.native()).json(); assert.equal(dto.content.primaryMedia.url, revision.media.url);
  assert.equal((await f.restore(0, 2)).status, 200); assert.equal(f.currentRaw(), f.raw); assert.equal(f.revision(), 3);
  let latest = (await f.events()).filter(value => value.type === "DocumentArtifactEdited").at(-1); assert.equal(latest.payload.video_revision, null);
  dto = await (await f.native()).json(); assert.equal(dto.content.primaryMedia.url, f.media.url); assert.equal(dto.content.clips[0].media.url, f.media.url); assert.equal(dto.content.clips[1].media, null);
  assert.equal((await f.restore(1, 3)).status, 200); assert.equal(f.currentRaw(), edited); assert.equal(f.revision(), 4);
  latest = (await f.events()).filter(value => value.type === "DocumentArtifactEdited").at(-1); assert.deepEqual(latest.payload.video_revision, revision);
  dto = await (await f.native()).json(); assert.equal(dto.content.primaryMedia.url, revision.media.url); assert.equal(dto.content.clips[0].id, MEDIA_ITEM); assert.equal(dto.content.clips[1].id, TEXT_ITEM);
  assert.equal(f.calls.put.length, 1); assert.equal(f.objects.size, 2); assert.equal(f.privatePayload(f.completion.eventId), f.initialCompletion);
  assert.deepEqual(f.bytesAt(f.media.url), f.originalBytes); assert.equal(hash(f.bytesAt(revision.media.url)), revision.media.sha256);
});

test("Video retained revision expiry during media read refuses restoration without replacing the current source", async t => {
  const f = await fixture(t), { revision } = await saved(f, await f.edit()); assert.equal((await f.restore(0, 1)).status, 200);
  const get = f.env.MEDIA.get.bind(f.env.MEDIA), editedKey = decodeURIComponent(revision.media.url.slice("/api/media/".length)); let changed = false;
  f.env.MEDIA.get = async key => { const object = await get(key); if (key === editedKey && !changed) {
    changed = true; f.sqlite.prepare("UPDATE artifact_revisions SET expires_at='2000-01-01T00:00:00.000Z' WHERE artifact_id=? AND revision=1").run(ARTIFACT);
  } return object; };
  const response = await f.restore(1, 2); assert.equal(changed, true); assert.equal(response.status, 409, await response.clone().text());
  assert.equal(f.revision(), 2); assert.equal(f.currentRaw(), f.raw); assert.equal(f.calls.put.length, 1); assert.equal(f.objects.size, 2);
});

test("full Video content validation and serialized-size refusal precede any media staging", async t => {
  for (const fault of ["near-cap", "invalid-title"]) await t.test(fault, async child => {
    const f = await fixture(child), content = JSON.parse(f.raw); content.summary = "";
    if (fault === "near-cap") content.summary = "x".repeat(999900 - Buffer.byteLength(JSON.stringify(content))); else content.title = "";
    const raw = JSON.stringify(content); f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
    const response = await f.edit(await f.requestFor(2, f.originalBytes, 0, raw)); assert.equal(response.status, 400, await response.clone().text());
    assert.equal((await response.json()).error, fault === "near-cap" ? "artifact_revision_too_large" : "invalid_artifact_revision");
    assert.equal(f.calls.put.length, 0); assertUncommitted(f, raw);
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let ensureSchema, appendAuditEvent;
let handleNativeRetainedOutputRead, nativeRetainedOutputRequestPath, projectNativeRetainedOutput, parseVideoMediaRevision;
try {
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ nativeRetainedOutputRequestPath, projectNativeRetainedOutput } = await import("../src/model/native-retained-output.ts"));
  ({ parseVideoMediaRevision } = await import("../src/model/document-artifacts.ts"));
  ({ ensureSchema, appendAuditEvent } = await import("../worker/runtime.ts"));
} finally { imports.deregister(); }

const OWNER = "retained-video-owner";
const EMAIL = "retained-video-owner@example.test";
const DOCUMENT = "retained-story-document";
const PROJECT = "retained-story-personal-project";
const ARTIFACT = "retained-story-artifact";
const CONTENT = "retained-story-content";
const EXPIRY = "2099-01-01T00:00:00.000Z";
const POLICY = "pilot-2026-08-10";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const initialBody = () => ({ title: "  Literal 動画 <title>  ", content_markdown: "\ufeff # Retained video\r\nLiteral <script> & العربية.", presentation: null,
  items: [{ title: "Current clip title", body: "  First body\r\n ", notes: "Note <literal>", image_prompt: "", slide: null },
    { title: "Missing clip", body: "Written description only.", notes: "No rendered clip supplied.", image_prompt: "", slide: null }] });

async function fixture(t, options = {}) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Retained owner", "creator", POLICY, now, now, now);
  const stream = `creative:${OWNER}`;
  await appendAuditEvent(state.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Document name is not the result title" });
  const completion = await (options.completionWriter ?? appendAuditEvent)(state.env, stream, "worker:renderer", "DocumentRenderCompleted", {
    document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: options.kind ?? "short_story",
    requested_by_user_id: OWNER, title: "Completion name is not the retained title", content_ref: CONTENT, item_count: 2,
    ...options.completionPayload,
  });
  let raw = JSON.stringify(initialBody());
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const calls = [];
  const forbidden = [];
  const rawReads = [];
  let beforeRead = null;
  const guardedDB = {
    prepare(sql) {
      if (!/^\s*(?:WITH|SELECT)\b/iu.test(sql)) { forbidden.push({ operation: "prepare", sql }); throw new Error("Read endpoint prepared a writer"); }
      const prepared = state.DB.prepare(sql);
      function statement(values) {
        return {
          bind(...bindings) { return statement(bindings); },
          async first() {
            calls.push(sql);
            if (beforeRead) await beforeRead(sql);
            const result = await prepared.bind(...values).first();
            if (sql.startsWith("SELECT content,expires_at")) rawReads.push(result);
            return result;
          },
          async all() {
            calls.push(sql);
            if (beforeRead) await beforeRead(sql);
            return prepared.bind(...values).all();
          },
        };
      }
      return statement([]);
    },
    batch() { forbidden.push({ operation: "batch" }); throw new Error("No reader mutation"); },
  };
  const env = { ...state.env, DB: guardedDB,
    MEDIA: new Proxy({}, { get(_target, property) { forbidden.push({ operation: "MEDIA", property: String(property) }); throw new Error("Retained read entered MEDIA"); } }),
    ASSETS: { fetch() { forbidden.push({ operation: "ASSETS" }); throw new Error("Retained read entered ASSETS"); } },
  };
  const select = (revision = 0, sha256 = digest(raw)) => ({ documentId: DOCUMENT, artifactId: ARTIFACT, revision, contentSha256: sha256 });
  const requestNative = (output, selection = select(), headers = {}, method = "GET") => new Request(
    `https://forma.test${nativeRetainedOutputRequestPath({ output, selection })}`, {
      method, headers: { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL, ...headers },
    });
  const readNative = (output, selection = select(), headers = {}) => handleNativeRetainedOutputRead(requestNative(output, selection, headers), env);
  const changes = () => state.sqlite.prepare("SELECT total_changes() AS count").get().count;
  const replace = value => {
    raw = typeof value === "string" ? value : JSON.stringify(value);
    state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT);
  };
  const append = (type, payload) => appendAuditEvent(state.env, stream, "user", type, { project_id: PROJECT, document_id: DOCUMENT, ...payload });
  t.after(() => assert.deepEqual(forbidden, [], "caught forbidden attempts are still failures"));
  return { ...state, env, calls, rawReads, requestNative, readNative, select, changes, replace, append, completion,
    raw: () => raw, setBeforeRead(value) { beforeRead = value; } };
}

const { ownerMediaNamespace } = await import("../src/model/media-ownership.ts");
const videoUrl = () => `/api/media/${ownerMediaNamespace(OWNER)}%2Fgenerated%2Fclip-a.mp4`;
const privateItems = () => [{ id: "clip-a", title: "Original completion title", media_url: videoUrl(), media_type: "video/mp4", duration_seconds: 32 },
  { id: "clip-b", title: "Original missing title", media_url: null, media_type: null }];
async function videoFixture(t) {
  return fixture(t, { kind: "video", completionPayload: { input_ref: "original-video-input", media_url: null, media_type: null, items: privateItems() } });
}
const editEnvelope = (f, change) => {
  const row = f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId);
  const payload = JSON.parse(row.private_json); change(payload);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(payload), f.completion.eventId);
};
// Synthetic completion metadata only. No generation, media read, paid result,
// actual playback, live authorization, media-byte hash or combined-film claim.
test("native Video SELECT-only read joins current raw text with exact owned clip receipt and no media reads", async t => {
  const f = await videoFixture(t), before = f.changes(), response = await f.readNative("video");
  assert.equal(response.status, 200); const dto = await response.json();
  assert.deepEqual(dto.selection, f.select()); assert.equal(dto.title, initialBody().title);
  assert.deepEqual(dto.content, { primaryMedia: null, content_markdown: initialBody().content_markdown, clips: initialBody().items.map((item, index) => ({
    id: ["clip-a", "clip-b"][index], title: item.title, body: item.body, notes: item.notes,
    media: index === 0 ? { url: videoUrl(), mediaType: "video/mp4" } : null,
  })) });
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(f.changes(), before);
  assert.equal(f.calls.filter(sql => sql.startsWith("SELECT private_json")).length, 1);
  assert.equal(f.rawReads.length, 1);
  assert.ok(f.calls.at(-1).includes("CAST(private_json AS BLOB)=CAST(? AS BLOB)"));
});
test("native Video missing individual files remain absent and never acquire a combined-film fallback", async t => {
  const f = await videoFixture(t); editEnvelope(f, p => { p.items[0].media_url = null; p.items[0].media_type = null; });
  const response = await f.readNative("video"); assert.equal(response.status, 200); const dto = await response.json();
  assert.ok(dto.content.clips.every(clip => clip.media === null));
  assert.equal(dto.content.content_markdown, initialBody().content_markdown);
  assert.deepEqual(Object.keys(dto.content).sort(), ["clips", "content_markdown", "primaryMedia"]);
});
test("native Video exact root-owned file remains independent of per-clip media", async t => {
  for (const form of ["root-only", "mixed", "root-equals-first-clip"]) await t.test(form, async child => {
    const f = await videoFixture(child), url = form === "root-equals-first-clip" ? videoUrl() : videoUrl().replace("clip-a", "primary");
    editEnvelope(f, p => {
      p.media_url = url; p.media_type = "video/mp4";
      if (form === "root-only") p.items.forEach(item => { item.media_url = null; item.media_type = null; });
    });
    const before = f.changes(), response = await f.readNative("video"); assert.equal(response.status, 200); const dto = await response.json();
    assert.deepEqual(dto.content.primaryMedia, { url, mediaType: "video/mp4" });
    assert.equal(dto.content.clips[0].media === null, form === "root-only"); assert.equal(f.changes(), before);
  });
});
test("native Video current edited revision keeps original clip IDs and rejects stale raw bytes and selection", async t => {
  const f = await videoFixture(t), old = f.select(), body = initialBody();
  body.items[0].title = "Changed text, original clip"; f.replace(body);
  assert.equal((await f.readNative("video", old)).status, 404, "same identity cannot hide replaced raw bytes");
  await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
  const response = await f.readNative("video", f.select(1)); assert.equal(response.status, 200);
  const dto = await response.json(); assert.equal(dto.content.clips[0].title, body.items[0].title);
  assert.equal(dto.content.clips[0].id, "clip-a"); assert.equal(dto.content.clips[0].media.url, videoUrl());
  assert.equal((await f.readNative("video", old)).status, 404);
});
test("native Video refuses mismatched selection, format, role and expired source", async t => {
  for (const fault of ["documentId", "artifactId", "revision", "contentSha256", "kind", "role", "expired"])
    await t.test(fault, async child => {
      const f = await videoFixture(child), target = f.select();
      if (Object.hasOwn(target, fault)) target[fault] = fault === "revision" ? 1 : fault === "contentSha256" ? "c".repeat(64) : "other";
      if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
      if (fault === "expired") f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z", CONTENT);
      const before = f.changes(); assert.equal((await f.readNative(fault === "kind" ? "audio" : "video", target)).status, fault === "role" ? 403 : 404);
      assert.equal(f.changes(), before);
    });
});
test("native Video rejects altered private identity, owner, clip count and media before the final witness", async t => {
  for (const fault of ["document", "project", "artifact", "owner", "content", "input", "kind", "count", "duplicate", "foreign-media", "unsafe-url", "mime", "partial-null", "root-missing", "root-partial", "root-mime", "root-foreign", "root-unsafe", "missing", "redacted"])
    await t.test(fault, async child => {
      const f = await videoFixture(child);
      const field = { document: "document_id", project: "project_id", artifact: "artifact_id", owner: "requested_by_user_id", content: "content_ref", input: "input_ref", kind: "artifact_kind" }[fault];
      if (field) editEnvelope(f, p => p[field] = "other");
      if (fault === "count") editEnvelope(f, p => p.item_count = 1);
      if (fault === "duplicate") editEnvelope(f, p => p.items[1].id = p.items[0].id);
      if (fault === "foreign-media") editEnvelope(f, p => p.items[0].media_url = `/api/media/${ownerMediaNamespace("other")}%2Fgenerated%2Fclip.mp4`);
      if (fault === "unsafe-url") editEnvelope(f, p => p.items[0].media_url = videoUrl() + "?other=1");
      if (fault === "mime") editEnvelope(f, p => p.items[0].media_type = "image/png");
      if (fault === "partial-null") editEnvelope(f, p => p.items[1].media_type = "video/mp4");
      if (fault === "root-missing") editEnvelope(f, p => delete p.media_url);
      if (fault === "root-partial") editEnvelope(f, p => p.media_url = videoUrl());
      if (fault === "root-mime") editEnvelope(f, p => { p.media_url = videoUrl(); p.media_type = "audio/mpeg"; });
      if (fault === "root-foreign") editEnvelope(f, p => { p.media_url = `/api/media/${ownerMediaNamespace("other")}%2Fgenerated%2Fclip.mp4`; p.media_type = "video/mp4"; });
      if (fault === "root-unsafe") editEnvelope(f, p => { p.media_url = videoUrl() + "?other=1"; p.media_type = "video/mp4"; });
      if (fault === "missing") f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(f.completion.eventId);
      if (fault === "redacted") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run("2030-01-01T00:00:00.000Z", f.completion.eventId);
      const before = f.changes(); assert.equal((await f.readNative("video")).status, 404); assert.equal(f.changes(), before);
      assert.equal(f.calls.some(sql => sql.includes("expected_events AS")), false);
    });
});
test("native Video final witness rejects completion replacement and current source retirement", async t => {
  for (const fault of ["media", "root-media", "order", "input", "redaction", "owner", "raw", "role", "revision", "expired"])
    await t.test(fault, async child => {
      const f = await videoFixture(child); let entered = 0, afterMutation;
      f.setBeforeRead(async sql => {
        if (!sql.includes("expected_events AS")) return; entered++;
        if (fault === "media") editEnvelope(f, p => p.items[0].media_url = videoUrl().replace("clip-a.mp4", "replacement.mp4"));
        if (fault === "root-media") editEnvelope(f, p => { p.media_url = videoUrl().replace("clip-a", "replacement-root"); p.media_type = "video/mp4"; });
        if (fault === "order") editEnvelope(f, p => p.items.reverse());
        if (fault === "input") editEnvelope(f, p => p.input_ref = "different-input");
        if (fault === "redaction") f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run("2030-01-01T00:00:00.000Z", f.completion.eventId);
        if (fault === "owner") f.sqlite.prepare("UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?").run("other", f.completion.eventId);
        if (fault === "raw") f.replace({ ...initialBody(), title: "Changed" });
        if (fault === "role") f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
        if (fault === "revision") await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER });
        if (fault === "expired") f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z", CONTENT);
        afterMutation = f.changes();
      });
      assert.equal((await f.readNative("video")).status, 404); assert.equal(entered, 1); assert.equal(f.changes(), afterMutation);
    });
});

// These are finite authored revision envelopes and RAM snapshots, not an MP4
// encoder, Save API, media-byte verification, playback or Film qualification.
const privateEdit = (f, eventId, change) => {
  const row = f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(eventId);
  const payload = JSON.parse(row.private_json); change(payload);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(payload), eventId);
};
const retainVideoSnapshot = (f, revision, raw) => {
  f.sqlite.prepare("INSERT INTO artifact_revisions(revision_id,owner_id,organization_id,project_access_id,project_id,document_id,artifact_id,revision,content_json,content_sha256,created_by_user_id,created_at,expires_at,redacted_at) VALUES(?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,NULL)")
    .run(`video-snapshot-${revision}`, OWNER, PROJECT, DOCUMENT, ARTIFACT, revision, raw, digest(raw), OWNER, new Date().toISOString(), EXPIRY);
};
async function appendVideoRevision(f, body, revision, extra = {}) {
  f.replace(body);
  const event = await f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, artifact_kind: "video", content_ref: CONTENT,
    revision, content_sha256: digest(f.raw()), edited_by_user_id: OWNER,
    ...(Object.hasOwn(body, "video_revision") ? { video_revision: body.video_revision } : {}), ...extra });
  retainVideoSnapshot(f, revision, f.raw());
  return event;
}
async function editedVideoFixture(t, mutate = () => ({})) {
  const f = await fixture(t, { kind: "video", completionPayload: { input_ref: "original-video-input", media_url: videoUrl(), media_type: "video/mp4", items: privateItems() } });
  const originalRaw = f.raw(); retainVideoSnapshot(f, 0, originalRaw);
  const revision = { schemaVersion: 1, operation: "prefix-trim",
    media: { url: videoUrl().replace("clip-a.mp4", "trim-one.mp4"), mediaType: "video/mp4", sha256: "b".repeat(64), byteLength: 1100 },
    source: { url: videoUrl(), sha256: "a".repeat(64), revision: 0, contentSha256: digest(originalRaw), itemId: "clip-a",
      sampleCount: 4, timescale: 16384, durationTicks: 32768, width: 32, height: 18 },
    startSample: 0, endSample: 2, sampleCount: 2, timescale: 16384, durationTicks: 16384, durationSeconds: 1, width: 32, height: 18 };
  assert.deepEqual(parseVideoMediaRevision(revision), revision, "declared fixture satisfies the actual closed metadata contract");
  const body = { ...initialBody(), video_revision: revision }, extra = mutate({ f, revision, body });
  const edit = await appendVideoRevision(f, body, 1, extra);
  return { ...f, originalRaw, revision, body, edit };
}
test("native Video current trim changes only the witnessed root and exact clip, preserving original receipt and text", async t => {
  const f = await editedVideoFixture(t), original = f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId).private_json;
  const before = f.changes(), response = await f.readNative("video", f.select(1)); assert.equal(response.status, 200);
  const dto = await response.json(); assert.deepEqual(dto.selection, f.select(1));
  assert.deepEqual(dto.content.primaryMedia, { url: f.revision.media.url, mediaType: "video/mp4" });
  assert.deepEqual(dto.content.clips, initialBody().items.map((item, index) => ({ id: ["clip-a", "clip-b"][index],
    title: item.title, body: item.body, notes: item.notes, media: index ? null : dto.content.primaryMedia })));
  assert.equal(dto.content.content_markdown, initialBody().content_markdown);
  assert.deepEqual(Object.keys(dto.content).sort(), ["clips", "content_markdown", "primaryMedia"]);
  assert.equal(f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId).private_json, original);
  assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE revision=0").get().content_json, f.originalRaw);
  assert.equal(f.changes(), before);
});
test("native Video original and prior trim restores retain exact original provenance and fresh revision selection", async t => {
  const f = await editedVideoFixture(t), saved = f.raw();
  await appendVideoRevision(f, initialBody(), 2, { video_revision: null, revision_action: "restore", restored_from_revision: 0, source_surface: "document-artifact-history" });
  let response = await f.readNative("video", f.select(2)); assert.equal(response.status, 200); let dto = await response.json();
  assert.equal(dto.content.primaryMedia.url, videoUrl()); assert.equal(dto.content.clips[0].media.url, videoUrl());
  await appendVideoRevision(f, JSON.parse(saved), 3, { revision_action: "restore", restored_from_revision: 1, source_surface: "document-artifact-history" });
  response = await f.readNative("video", f.select(3)); assert.equal(response.status, 200); dto = await response.json();
  assert.equal(dto.content.primaryMedia.url, f.revision.media.url); assert.equal(dto.content.clips[0].id, "clip-a");
  assert.equal((await f.readNative("video", f.select(1, digest(saved)))).status, 404);
  assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE revision=0").get().content_json, f.originalRaw);
  assert.equal(f.sqlite.prepare("SELECT content_json FROM artifact_revisions WHERE revision=1").get().content_json, saved);
});
async function secondVideoTrimFixture(t, mutate = () => {}) {
  const f = await editedVideoFixture(t), sourceRaw = f.raw(), second = structuredClone(f.revision);
  second.source = { ...second.source, url: f.revision.media.url, sha256: f.revision.media.sha256, revision: 1,
    contentSha256: digest(sourceRaw), sampleCount: 2, durationTicks: 16384 };
  second.media = { ...second.media, url: videoUrl().replace("clip-a.mp4", "trim-two.mp4"), sha256: "c".repeat(64), byteLength: 900 };
  Object.assign(second, { endSample: 1, sampleCount: 1, durationTicks: 8192, durationSeconds: 0.5 });
  mutate(second);
  const body = { ...initialBody(), video_revision: second }, secondEdit = await appendVideoRevision(f, body, 2);
  return { ...f, second, secondEdit, sourceRaw };
}
test("native Video trim of an edited source binds its exact retained source snapshot and private edit", async t => {
  const f = await secondVideoTrimFixture(t), before = f.changes(), response = await f.readNative("video", f.select(2));
  assert.equal(response.status, 200); const dto = await response.json();
  assert.equal(dto.content.primaryMedia.url, f.second.media.url); assert.equal(dto.content.clips[0].media.url, f.second.media.url);
  assert.equal(dto.content.clips[1].media, null); assert.equal(f.changes(), before);
  assert.equal(f.calls.filter(sql => sql.startsWith("SELECT private_json")).length, 3);
});
test("native Video can bind a new trim to the exact retained original-restore source", async t => {
  const f = await editedVideoFixture(t);
  await appendVideoRevision(f, initialBody(), 2, { video_revision: null, revision_action: "restore", restored_from_revision: 0, source_surface: "document-artifact-history" });
  const revision = structuredClone(f.revision); revision.source.revision = 2; revision.source.contentSha256 = digest(f.raw());
  revision.media.url = videoUrl().replace("clip-a.mp4", "trim-after-restore.mp4"); revision.media.sha256 = "d".repeat(64);
  await appendVideoRevision(f, { ...initialBody(), video_revision: revision }, 3);
  const before = f.changes(), response = await f.readNative("video", f.select(3)); assert.equal(response.status, 200);
  const dto = await response.json(); assert.equal(dto.content.primaryMedia.url, revision.media.url);
  assert.equal(dto.content.clips[0].media.url, revision.media.url); assert.equal(dto.content.clips[1].media, null);
  assert.equal(f.changes(), before);
});
test("native Video malformed, foreign or unwitnessed current overrides never fall back to original media", async t => {
  for (const fault of ["missing-edit", "foreign-edit", "edit-kind", "unwitnessed-body", "missing-body", "mismatched-witness", "malformed", "mixed",
    "item", "source-url", "authoritative-hash", "missing-snapshot", "snapshot-hash", "expired-snapshot", "redacted-snapshot", "scoped-snapshot", "root-conflict", "multiple-media"])
    await t.test(fault, async child => {
      const f = await editedVideoFixture(child, ({ f, revision, body }) => {
        if (fault === "malformed") revision.source.sampleCount = 0;
        if (fault === "mixed") body.audio_revision = {};
        if (fault === "item") revision.source.itemId = "clip-b";
        if (fault === "source-url") revision.source.url = videoUrl().replace("clip-a", "unbound-source");
        if (fault === "authoritative-hash") editEnvelope(f, p => p.settings = { source_media_sha256: "d".repeat(64) });
        if (fault === "root-conflict") editEnvelope(f, p => p.media_url = videoUrl().replace("clip-a", "different-root"));
        if (fault === "multiple-media") editEnvelope(f, p => { p.items[1].media_url = videoUrl(); p.items[1].media_type = "video/mp4"; });
        if (fault === "unwitnessed-body") return { video_revision: undefined };
        if (fault === "missing-body") { delete body.video_revision; return { video_revision: revision }; }
        if (fault === "mismatched-witness") return { video_revision: { ...revision, media: { ...revision.media, sha256: "d".repeat(64) } } };
        return {};
      });
      if (fault === "missing-edit") f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(f.edit.eventId);
      if (fault === "foreign-edit") f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(f.edit.eventId);
      if (fault === "edit-kind") privateEdit(f, f.edit.eventId, p => p.artifact_kind = "audio");
      if (fault === "missing-snapshot") f.sqlite.prepare("DELETE FROM artifact_revisions WHERE revision=0").run();
      if (fault === "snapshot-hash") f.sqlite.prepare("UPDATE artifact_revisions SET content_json=? WHERE revision=0").run(JSON.stringify({ ...initialBody(), title: "Changed" }));
      if (fault === "expired-snapshot") f.sqlite.prepare("UPDATE artifact_revisions SET expires_at='2000-01-01T00:00:00.000Z' WHERE revision=0").run();
      if (fault === "redacted-snapshot") f.sqlite.prepare("UPDATE artifact_revisions SET redacted_at='2030-01-01T00:00:00.000Z' WHERE revision=0").run();
      if (fault === "scoped-snapshot") f.sqlite.prepare("UPDATE artifact_revisions SET organization_id='other' WHERE revision=0").run();
      const before = f.changes(); assert.equal((await f.readNative("video", f.select(1))).status, 404); assert.equal(f.changes(), before);
    });
});
test("native Video rejects a revision-zero authored media override and direct projection without an independent witness", async t => {
  const f = await videoFixture(t); f.replace({ ...initialBody(), video_revision: {} });
  assert.equal((await f.readNative("video")).status, 404);
  const edited = await editedVideoFixture(t), target = { output: "video", selection: edited.select(1) };
  const receipt = JSON.parse(edited.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(edited.completion.eventId).private_json);
  assert.equal(projectNativeRetainedOutput(target, edited.body, EXPIRY, null, { videoReceipt: receipt }), null);
  assert.equal(projectNativeRetainedOutput(target, initialBody(), EXPIRY, null, { videoReceipt: receipt, videoRevision: edited.revision }), null);
  assert.equal(projectNativeRetainedOutput({ output: "video", selection: edited.select(0) }, edited.body, EXPIRY, null,
    { videoReceipt: receipt, videoRevision: edited.revision }), null);
});
test("native Video source-chain facts and source private receipt must match the exact prior snapshot", async t => {
  for (const fault of ["source-url", "source-hash", "source-clock", "source-item", "source-private-missing", "source-private-replaced", "source-raw"])
    await t.test(fault, async child => {
      const f = await secondVideoTrimFixture(child, second => {
        if (fault === "source-url") second.source.url = videoUrl();
        if (fault === "source-hash") second.source.sha256 = "d".repeat(64);
        if (fault === "source-clock") second.source.durationTicks++;
        if (fault === "source-item") second.source.itemId = "clip-b";
      });
      if (fault === "source-private-missing") f.sqlite.prepare("DELETE FROM event_private_payloads WHERE private_event_id=?").run(f.edit.eventId);
      else if (fault === "source-private-replaced") privateEdit(f, f.edit.eventId, p => p.video_revision.media.sha256 = "d".repeat(64));
      else if (fault === "source-raw") f.sqlite.prepare("UPDATE artifact_revisions SET content_json=? WHERE revision=1").run(JSON.stringify(initialBody()));
      const before = f.changes(); assert.equal((await f.readNative("video", f.select(2))).status, 404); assert.equal(f.changes(), before);
    });
});
test("native Video final witness rejects current edit or retained source retirement after projection", async t => {
  for (const fault of ["current-edit", "source-edit", "snapshot-raw", "snapshot-expiry", "snapshot-scope", "snapshot-missing"])
    await t.test(fault, async child => {
      const f = await secondVideoTrimFixture(child); let entered = 0, afterMutation;
      f.setBeforeRead(sql => {
        if (!sql.includes("expected_events AS")) return; entered++;
        if (fault === "current-edit") privateEdit(f, f.secondEdit.eventId, p => p.video_revision.media.url = videoUrl());
        if (fault === "source-edit") privateEdit(f, f.edit.eventId, p => p.video_revision.media.sha256 = "d".repeat(64));
        if (fault === "snapshot-raw") f.sqlite.prepare("UPDATE artifact_revisions SET content_json=? WHERE revision=1").run(JSON.stringify(initialBody()));
        if (fault === "snapshot-expiry") f.sqlite.prepare("UPDATE artifact_revisions SET expires_at='2000-01-01T00:00:00.000Z' WHERE revision=1").run();
        if (fault === "snapshot-scope") f.sqlite.prepare("UPDATE artifact_revisions SET project_access_id='foreign-project' WHERE revision=1").run();
        if (fault === "snapshot-missing") f.sqlite.prepare("DELETE FROM artifact_revisions WHERE revision=1").run();
        afterMutation = f.changes();
      });
      assert.equal((await f.readNative("video", f.select(2))).status, 404); assert.equal(entered, 1); assert.equal(f.changes(), afterMutation);
    });
});

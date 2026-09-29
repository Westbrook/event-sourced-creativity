import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, after } from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleNativeRetainedOutputRead, ensureSchema, appendAuditEvent, appendEvents, makeEvent;
let nativeAudioCompletionPath, validateNativeAudioCompletion, nativeAudioRetainedRoute;
let nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute;
try {
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ ensureSchema, appendAuditEvent, appendEvents, makeEvent } = await import("../worker/runtime.ts"));
  ({ nativeAudioCompletionPath, validateNativeAudioCompletion, nativeAudioRetainedRoute } = await import("../src/model/native-audio-completion.ts"));
  ({ nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute } = await import("../src/model/native-retained-output.ts"));
} finally { imports.deregister(); }

const realFetch = globalThis.fetch;
let networkCalls = 0;
before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error("Network is forbidden in the RAM-only Audio reader controls"); }; });
after(() => { globalThis.fetch = realFetch; assert.equal(networkCalls, 0); });
const OWNER = "audio-native-owner", EMAIL = "audio-native-owner@example.test";
const DOCUMENT = "audio-native-document", PROJECT = "audio-native-personal-project";
const ARTIFACT = "audio-native-artifact", CONTENT = "audio-native-content", JOB = "audio-native-job";
const EXPIRY = "2099-01-01T00:00:00.000Z", POLICY = "pilot-2026-08-10";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const INPUT = "audio-native-input", PROVIDER_JOB = "audio-native-provider-job", MODEL = "local-audio-model";
const { ownerMediaNamespace } = await import("../src/model/media-ownership.ts");
const mediaUrl = () => `/api/media/${ownerMediaNamespace(OWNER)}%2Fgenerated%2Faudio.mp3`;
const settings = () => ({ item_count: 1, production_mode: "manual", audio_role: "score", lyrics: "  京都 — café\nوفي المساء  ",
  source_media_sha256: "b".repeat(64), audio_synthid_watermarked: false,
  duration_seconds: 2, duration_basis: "media-container", duration_media_url: mediaUrl(), duration_media_sha256: "b".repeat(64) });
const audio = () => ({ title: "Exact retained Audio", content_markdown: "# Authored score\n<literal> 京都 — café\nوفي المساء  ",
  items: [{ title: "Tone", body: "Exact original arrangement", notes: "  Keep silence\n", image_prompt: "", slide: null }] });
const snapshot = () => ({ facts: [{ block_id: "direction", properties: { text: "Saved original direction" } }], relationships: [],
  context_groups: [], pins: [], tail: [], standing_constraints: [{ preference_id: "pref1", polarity: "include", axis: "tone", value: "quiet" }] });
const profile = () => ({ goal: "music", role: "score", destination: "standalone", durationSeconds: 2, requireInstrumental: true });
const inputBody = () => ({ schema_version: 1, artifact_id: ARTIFACT, artifact_kind: "audio", document_id: DOCUMENT, project_id: PROJECT,
  request: { item_count: 1, production_mode: "manual", source_surface: "document", audio_profile: profile() },
  document_snapshot: { ...snapshot(), document: { id: DOCUMENT, title: "Original document" } },
  render: { provider: "fal", provider_job_id: PROVIDER_JOB, model: MODEL } });

// Existing SQLite/D1 test adapter, explicitly RAM-only; the endpoint gets SELECT-only bindings.
async function fixture(t, options = {}) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env);
  const now = new Date().toISOString(), stream = `creative:${OWNER}`, count = options.count ?? 1, attempt = options.attempt ?? 1;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Audio owner", "creator", POLICY, now, now, now);
  await appendAuditEvent(state.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Original document" });
  const payload = { document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: "audio",
    requested_by_user_id: OWNER, title: "Event title is not retained body", content_ref: CONTENT, item_count: count,
    source_block_versions: [{ block_id: "direction", version: 1 }], settings: settings(), input_ref: INPUT, media_url: mediaUrl(), media_type: "audio/mpeg", provider: "fal", provider_job_id: PROVIDER_JOB, model_id: MODEL, ...options.completionPayload };
  const completion = makeEvent(options.completionStream ?? stream, 0, options.completionActor ?? "worker:renderer",
    options.completionClient ?? "server:document-job:render_document", options.completionCorrelation ?? `${JOB}:attempt:${attempt}`,
    "DocumentRenderCompleted", payload);
  await appendEvents(state.env, [completion]);
  let raw = JSON.stringify(audio(count));
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const jobRequest = { artifactKind: "audio", productionMode: "manual", paidMediaConfirmed: true,
    documentId: DOCUMENT, documentRevision: "saved-revision", requestKey: "render:audio:manual:saved-revision:default",
    snapshot: snapshot(), sourceBlockVersions: [{ block_id: "direction", version: 1 }], audioProfile: profile(), audioProviderModel: MODEL, ...options.request };
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(INPUT, OWNER, "document-artifact-input", JSON.stringify(inputBody()), now, EXPIRY);
  const jobResult = { artifactKind: "audio", artifactId: ARTIFACT, appendedEventIds: [completion.eventId], providerJobId: PROVIDER_JOB, provider: "fal", ...options.result };
  const job = { job_id: JOB, owner_id: OWNER, stream_id: stream, document_id: DOCUMENT, kind: "render_document", status: "completed",
    source_surface: "document", correlation_id: `${JOB}:attempt:${attempt}`, requested_sequence: 1,
    request_json: JSON.stringify(jobRequest), result_json: JSON.stringify(jobResult), error_message: null, attempt_count: attempt,
    requested_at: now, started_at: now, completed_at: now, expires_at: EXPIRY, updated_at: now, ...options.job };
  state.sqlite.prepare("INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(job.job_id, job.owner_id, job.stream_id, job.document_id, job.kind, job.status, job.source_surface, job.correlation_id,
      job.requested_sequence, job.request_json, job.result_json, job.error_message, job.attempt_count,
      job.requested_at, job.started_at, job.completed_at, job.expires_at, job.updated_at);
  const calls = [], rawReads = [];
  let beforeRead = null;
  const DB = { prepare(sql) {
    assert.match(sql, /^\s*(?:WITH|SELECT)\b/iu, "retained reads must not prepare writes");
    const prepared = state.DB.prepare(sql);
    const statement = bindings => ({ bind(...next) { return statement(next); },
      async first() { calls.push(sql); if (beforeRead) await beforeRead(sql); const result = await prepared.bind(...bindings).first();
        if (sql.startsWith("SELECT content,expires_at") && sql.includes("kind='document-artifact'")) rawReads.push(result); return result; },
      async all() { calls.push(sql); if (beforeRead) await beforeRead(sql); return prepared.bind(...bindings).all(); } });
    return statement([]);
  }, batch() { throw new Error("retained read attempted a batch"); } };
  const env = { ...state.env, DB, MEDIA: new Proxy({}, { get() { throw new Error("retained read entered MEDIA"); } }),
    ASSETS: { fetch() { throw new Error("retained read entered ASSETS"); } } };
  const handle = { documentId: DOCUMENT, jobId: JOB };
  const identity = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
  const request = (headers = {}, method = "GET") => new Request(`https://forma.test${nativeAudioCompletionPath(handle)}`, { method, headers: { ...identity, ...headers } });
  const read = (headers = {}) => handleNativeRetainedOutputRead(request(headers), env);
  const select = () => ({ documentId: DOCUMENT, artifactId: ARTIFACT, revision: 0, contentSha256: digest(raw) });
  const readSelection = selection => handleNativeRetainedOutputRead(new Request(`https://forma.test${nativeRetainedOutputRequestPath({ output: "audio", selection })}`, { headers: identity }), env);
  const replace = body => { raw = typeof body === "string" ? body : JSON.stringify(body); state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT); };
  const privatePayload = () => JSON.parse(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(completion.eventId).private_json);
  const updatePrivate = delta => state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?")
    .run(JSON.stringify({ ...privatePayload(), ...delta }), completion.eventId);
  const updateInput = change => {
    const value = JSON.parse(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(INPUT).content);
    change(value); state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(JSON.stringify(value), INPUT);
  };
  const updateRequest = delta => state.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id=?").run(JSON.stringify({ ...jobRequest, ...delta }), JOB);
  const append = (type, value) => appendAuditEvent(state.env, stream, "user", type, { document_id: DOCUMENT, project_id: PROJECT, ...value });
  const changes = () => state.sqlite.prepare("SELECT total_changes() AS count").get().count;
  return { ...state, writerEnv: state.env, env, handle, payload, completion, jobRequest, jobResult, identity, request, read, readSelection, select, replace,
    updateInput, updateRequest, privatePayload, updatePrivate, append, calls, rawReads, changes, raw: () => raw, setBeforeRead(value) { beforeRead = value; } };
}

async function unavailable(f) {
  const before = f.changes(), response = await f.read();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "retained_story_unavailable" });
  assert.equal(f.changes(), before);
}

test("Audio completion joins the original completed job to owned input and exact playable receipt with SELECT only", async t => {
  for (const request of [{}, { itemCount: 1 }]) await t.test(request.itemCount ? "explicit one" : "actual UI omitted count", async child => {
    const f = await fixture(child, { request }), before = f.changes();
    const response = await f.read(), receipt = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(receipt, { schemaVersion: 1, kind: "native-audio-completion", handle: f.handle, selection: f.select(), expiresAt: EXPIRY });
    assert.ok(validateNativeAudioCompletion(receipt, f.handle)); assert.equal(f.calls.length, 7); assert.equal(f.rawReads.length, 1);
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= 8192);
    assert.equal(JSON.stringify(receipt).includes(INPUT), false); assert.equal(JSON.stringify(receipt).includes(PROVIDER_JOB), false);
    const target = parseNativeRetainedOutputRoute(nativeAudioRetainedRoute(receipt, f.handle));
    assert.deepEqual(target, { output: "audio", selection: f.select() });
    const start = f.calls.length, retained = await f.readSelection(target.selection), dto = await retained.json();
    assert.equal(retained.status, 200); assert.equal(f.calls.length - start, 5); assert.equal(dto.content.content_markdown, audio().content_markdown);
    assert.equal(dto.content.inputRef, INPUT); assert.deepEqual(dto.content.media, { url: mediaUrl(), mediaType: "audio/mpeg", sha256: "b".repeat(64) });
    assert.equal(dto.content.lyrics, settings().lyrics); assert.equal(f.changes(), before);
  });
});

test("Audio completion remains addressable after ACK feed omission and binds only the current exact attempt", async t => {
  for (const attempt of [1, 2, 8]) await t.test(`attempt ${attempt}`, async child => {
    const f = await fixture(child, { attempt });
    f.sqlite.prepare("UPDATE document_jobs SET notified_at=? WHERE job_id=?").run(new Date().toISOString(), JOB);
    if (attempt > 1) {
      const older = makeEvent(`creative:${OWNER}`, 0, "worker:renderer", "server:document-job:render_document", `${JOB}:attempt:${attempt - 1}`,
        "DocumentRenderCompleted", { ...f.payload, artifact_id: "older-artifact", content_ref: "older-content" });
      await appendEvents(f.writerEnv, [older]);
    }
    const before = f.changes(), response = await f.read(); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).selection, f.select()); assert.equal(f.changes(), before);
  });
});

test("Audio completion rejects coerced counts, unconfirmed paid media and unrelated production scopes before raw reads", async t => {
  for (const [label, request] of [
    ["null", { itemCount: null }], ["string", { itemCount: "1" }], ["zero", { itemCount: 0 }], ["two", { itemCount: 2 }], ["fraction", { itemCount: 1.5 }],
    ["paid missing", { paidMediaConfirmed: undefined }], ["paid false", { paidMediaConfirmed: false }], ["paid string", { paidMediaConfirmed: "true" }],
    ["managed", { productionMode: "managed" }], ["foreign kind", { artifactKind: "storyboard" }], ["Scene request", { sceneRequestId: JOB }],
    ["Scene consent", { sceneCostConsent: null }], ["Slides count", { requestedSlideCount: 1 }], ["Slides policy", { slideCountPolicy: null }],
    ["workflow", { workflowId: "workflow" }], ["workflow stage", { workflowStageId: "stage" }], ["workflow sources", { workflowSources: [] }],
    ["output execution", { outputExecution: {} }], ["oversized request", { extra: "x".repeat(128 * 1024) }],
  ]) await t.test(label, async child => { const f = await fixture(child, { request }); await unavailable(f); assert.equal(f.rawReads.length, 0); });
});

test("Audio exact attempt, event actor/client and result IDs cannot borrow another completion", async t => {
  const controls = [
    ["bare ID", { job: { correlation_id: JOB } }], ["previous attempt", { job: { correlation_id: `${JOB}:attempt:1`, attempt_count: 2 } }],
    ["future attempt", { job: { correlation_id: `${JOB}:attempt:2` } }], ["other job", { job: { correlation_id: "other:attempt:1" } }],
    ["zero attempt", { job: { attempt_count: 0 } }], ["wrong actor", { completionActor: "user" }], ["wrong client", { completionClient: "web:lit" }],
    ["stale result IDs", { result: { appendedEventIds: ["older-event"] } }], ["foreign result", { result: { artifactId: "other-artifact" } }],
    ["incomplete job", { job: { status: "running" } }], ["foreign owner", { job: { owner_id: "other" } }], ["foreign surface", { job: { source_surface: "canvas" } }],
  ];
  for (const [label, options] of controls) await t.test(label, async child => { const f = await fixture(child, options); await unavailable(f); assert.equal(f.rawReads.length, 0); });
  const f = await fixture(t);
  await appendEvents(f.writerEnv, [makeEvent(`creative:${OWNER}`, 0, "worker:renderer", "server:document-job:render_document", `${JOB}:attempt:1`, "DocumentRenderCompleted", { ...f.payload, artifact_id: "duplicate-artifact" })]);
  await unavailable(f); assert.equal(f.rawReads.length, 0);
});

test("Audio completion requires a playable selected media hash while its retained reader still represents missing media truthfully", async t => {
  for (const fault of ["null media", "wrong media owner", "bad hash", "wrong MIME", "input mismatch", "wrong count", "managed metadata"])
  await t.test(fault, async child => {
    const f = await fixture(child), p = f.privatePayload();
    if (fault === "null media") { p.media_url = null; p.media_type = null; p.settings.source_media_sha256 = null; }
    if (fault === "wrong media owner") p.media_url = `/api/media/${ownerMediaNamespace("other")}%2Fgenerated%2Faudio.mp3`;
    if (fault === "bad hash") p.settings.source_media_sha256 = "broken";
    if (fault === "wrong MIME") p.media_type = "image/png";
    if (fault === "input mismatch") p.input_ref = "other-input";
    if (fault === "wrong count") p.settings.item_count = 2;
    if (fault === "managed metadata") p.settings.production_mode = "managed";
    f.updatePrivate(p); await unavailable(f);
    if (fault === "null media") { const response = await f.readSelection(f.select()); assert.equal(response.status, 200); assert.equal((await response.json()).content.media, null); }
  });
});

test("Audio selected input binds exact private owner, artifact, provider invocation and original source", async t => {
  for (const fault of ["missing", "owner", "kind", "expiry", "artifact", "document", "project", "provider", "provider job", "model", "source", "constraint", "profile", "count"])
  await t.test(fault, async child => {
    const f = await fixture(child);
    if (fault === "missing") f.sqlite.prepare("DELETE FROM private_content WHERE content_id=?").run(INPUT);
    else if (["owner", "kind", "expiry"].includes(fault)) {
      const field = { owner: "owner_id", kind: "kind", expiry: "expires_at" }[fault];
      f.sqlite.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).run(fault === "expiry" ? "2000-01-01T00:00:00.000Z" : "other", INPUT);
    } else f.updateInput(p => {
      if (fault === "artifact") p.artifact_id = "other"; if (fault === "document") p.document_snapshot.document.id = "other";
      if (fault === "project") p.project_id = "other"; if (fault === "provider") p.render.provider = "other";
      if (fault === "provider job") p.render.provider_job_id = "other"; if (fault === "model") p.render.model = "other";
      if (fault === "source") p.document_snapshot.facts[0].properties.text = "Different direction";
      if (fault === "constraint") p.document_snapshot.standing_constraints[0].value = "loud";
      if (fault === "profile") p.request.audio_profile.durationSeconds = 3; if (fault === "count") p.request.item_count = 2;
    });
    await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
  await t.test("same foreign input ref in both envelopes still fails original invocation", async child => {
    const f = await fixture(child, { completionPayload: { input_ref: "foreign-input" } });
    const input = inputBody(); input.render.provider_job_id = "other-invocation";
    f.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES(?,?,?,?,?,?)")
      .run("foreign-input", OWNER, "document-artifact-input", JSON.stringify(input), new Date().toISOString(), EXPIRY);
    await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
});

test("Audio source comparison preserves original merged constraints and permits producer-added document metadata", async t => {
  const f = await fixture(t);
  f.updateInput(p => { p.document_snapshot.document.title = "Producer's current title";
    p.document_snapshot.standing_constraints.push({ preference_id: "new-authored", polarity: "avoid", axis: "tone", value: "noise" }); });
  assert.equal((await f.read()).status, 200);
  f.updateRequest({ snapshot: { ...snapshot(), facts: [{ block_id: "different-source" }] } });
  await unavailable(f);
});

test("Audio final witness rejects changed input bytes/expiry/custody, request, provider result and selected media", async t => {
  for (const fault of ["input bytes", "input expiry", "input owner", "input redacted", "input scope", "request snapshot", "request profile", "paid flag", "provider result", "attempt", "correlation", "media hash", "private input ref"])
  await t.test(fault, async child => {
    const f = await fixture(child); let mutated = false, afterMutation;
    f.setBeforeRead(async sql => {
      if (!sql.includes("expected_events AS")) return; assert.equal(mutated, false); mutated = true;
      if (fault === "input bytes") f.updateInput(p => { p.document_snapshot.facts[0].properties.text = "Changed later"; });
      if (fault === "input expiry") f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2098-01-01T00:00:00.000Z", INPUT);
      if (fault === "input owner") f.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(INPUT);
      if (fault === "input redacted") f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), INPUT);
      if (fault === "input scope") f.sqlite.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(INPUT, "org", "access", PROJECT, OWNER, "governed-evidence", 1, EXPIRY, new Date().toISOString());
      if (fault === "request snapshot") f.updateRequest({ snapshot: { ...snapshot(), facts: [] } });
      if (fault === "request profile") f.updateRequest({ audioProfile: { ...profile(), durationSeconds: 3 } });
      if (fault === "paid flag") f.updateRequest({ paidMediaConfirmed: false });
      if (fault === "provider result") f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({ ...f.jobResult, providerJobId: "different" }), JOB);
      if (fault === "attempt") f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2 WHERE job_id=?").run(JOB);
      if (fault === "correlation") f.sqlite.prepare("UPDATE document_jobs SET correlation_id=? WHERE job_id=?").run(`${JOB}:attempt:2`, JOB);
      if (fault === "media hash") f.updatePrivate({ settings: { ...settings(), source_media_sha256: "c".repeat(64) } });
      if (fault === "private input ref") f.updatePrivate({ input_ref: "changed" });
      afterMutation = f.changes();
    });
    const response = await f.read(); assert.equal(response.status, 404); assert.equal(mutated, true); assert.equal(f.changes(), afterMutation);
  });
});

test("Audio completed input cannot borrow a different original source version", async t => {
  const f = await fixture(t);
  f.updateRequest({ sourceBlockVersions: [{ block_id: "direction", version: 2 }] });
  await unavailable(f); assert.equal(f.rawReads.length, 0);
});

test("Audio version linkage rejects matching malformed or absent source lists", async t => {
  for (const [label, versions] of [["both missing", undefined], ["null", null], ["version string", [{ block_id: "direction", version: "1" }]],
    ["negative", [{ block_id: "direction", version: -1 }]], ["missing block", [{ version: 1 }]],
    ["duplicate block", [{ block_id: "direction", version: 1 }, { block_id: "direction", version: 1 }]]])
  await t.test(label, async child => {
    const f = await fixture(child, { request: { sourceBlockVersions: versions }, completionPayload: { source_block_versions: versions } });
    await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
});

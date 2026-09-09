import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, after } from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleNativeRetainedOutputRead, ensureSchema, appendAuditEvent, appendEvents, makeEvent;
let nativeVideoCompletionPath, validateNativeVideoCompletion, nativeVideoRetainedRoute;
let nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute;
try {
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ ensureSchema, appendAuditEvent, appendEvents, makeEvent } = await import("../worker/runtime.ts"));
  ({ nativeVideoCompletionPath, validateNativeVideoCompletion, nativeVideoRetainedRoute } = await import("../src/model/native-video-completion.ts"));
  ({ nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute } = await import("../src/model/native-retained-output.ts"));
} finally { imports.deregister(); }

const realFetch = globalThis.fetch;
let networkCalls = 0;
before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error("Network is forbidden in the RAM-only Video reader controls"); }; });
after(() => { globalThis.fetch = realFetch; assert.equal(networkCalls, 0); });
const OWNER = "video-native-owner", EMAIL = "video-native-owner@example.test";
const DOCUMENT = "video-native-document", PROJECT = "video-native-personal-project";
const ARTIFACT = "video-native-artifact", CONTENT = "video-native-content", JOB = "video-native-job";
const EXPIRY = "2099-01-01T00:00:00.000Z", POLICY = "pilot-2026-08-10";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const INPUT = "video-native-input", PROVIDER_JOB = "video-native-provider-job", MODEL = "local-video-model";
const { ownerMediaNamespace } = await import("../src/model/media-ownership.ts");
// The manual producer stores one root MP4; no invented Video media digest.
const mediaUrl = () => `/api/media/${ownerMediaNamespace(OWNER)}%2Fgenerated%2Fvideo.mp4`;
const requestSettings = (count = 1) => ({ item_count: count, production_mode: "manual", audience: "general", tone: "document-derived",
  video_seconds: 4, video_size: "1280x720", video_audio_mode: "silent" });
const video = (count = 1) => ({ title: "Exact retained Video", content_markdown: "# Saved motion\n<literal> 京都 — café\nوفي المساء  ",
  items: Array.from({ length: count }, (_, index) => ({ title: `Scene ${index + 1}`, body: `Exact ordered action ${index + 1}`,
    notes: `  Keep scene ${index + 1}.\n`, image_prompt: "Camera direction", slide: null })) });
const itemReceipts = count => video(count).items.map((item, index) => ({ id: `clip-${index + 1}`, title: item.title,
  media_url: null, media_type: null, width: null, height: null, slide: null, context_group_ids: [] }));
const snapshot = () => ({ facts: [{ block_id: "direction", properties: { text: "Saved original direction" } }], relationships: [],
  context_groups: [], pins: [], tail: [], standing_constraints: [{ preference_id: "pref1", polarity: "include", axis: "tone", value: "quiet" }] });
const inputBody = (count = 1) => ({ schema_version: 1, artifact_id: ARTIFACT, artifact_kind: "video", document_id: DOCUMENT, project_id: PROJECT,
  request: { ...requestSettings(count), source_surface: "document", soundtrack_block_ids: [], soundtrack_provider_transfer: false },
  document_snapshot: { ...snapshot(), document: { id: DOCUMENT, title: "Original document" } },
  render: { provider: "fal", provider_job_id: PROVIDER_JOB, model: MODEL } });

// Existing SQLite/D1 test adapter, explicitly RAM-only; the endpoint gets SELECT-only bindings.
async function fixture(t, options = {}) {
  const state = outputTestDatabase();
  const forbiddenPorts = [];
  t.after(() => { try { assert.deepEqual(forbiddenPorts, [], "No attempted forbidden endpoint port, including caught failures"); } finally { state.sqlite.close(); } });
  await ensureSchema(state.env);
  const now = new Date().toISOString(), stream = `creative:${OWNER}`, count = options.count ?? 1, attempt = options.attempt ?? 1;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Video owner", "creator", POLICY, now, now, now);
  await appendAuditEvent(state.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Original document" });
  const payload = { document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: "video",
    requested_by_user_id: OWNER, source_surface: "document", title: "Event title is not retained body", content_ref: CONTENT, item_count: count,
    source_block_versions: [{ block_id: "direction", version: 1 }], settings: requestSettings(count), items: itemReceipts(count), input_ref: INPUT, media_url: mediaUrl(), media_type: "video/mp4", provider: "fal", provider_job_id: PROVIDER_JOB, model_id: MODEL, ...options.completionPayload };
  const completion = makeEvent(options.completionStream ?? stream, 0, options.completionActor ?? "worker:renderer",
    options.completionClient ?? "server:document-job:render_document", options.completionCorrelation ?? `${JOB}:attempt:${attempt}`,
    "DocumentRenderCompleted", payload);
  await appendEvents(state.env, [completion]);
  let raw = JSON.stringify(video(count));
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const jobRequest = { artifactKind: "video", productionMode: "manual", paidMediaConfirmed: true,
    documentId: DOCUMENT, documentRevision: "saved-revision", requestKey: "render:video:manual:saved-revision:default",
    snapshot: snapshot(), sourceBlockVersions: [{ block_id: "direction", version: 1 }], ...options.request };
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(INPUT, OWNER, "document-artifact-input", JSON.stringify(inputBody(count)), now, EXPIRY);
  const jobResult = { artifactKind: "video", artifactId: ARTIFACT, appendedEventIds: [completion.eventId], providerJobId: PROVIDER_JOB, provider: "fal", ...options.result };
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
    if (!/^\s*(?:WITH|SELECT)\b/iu.test(sql)) { forbiddenPorts.push("DB.prepare:" + sql); assert.fail("retained reads must not prepare writes"); }
    const prepared = state.DB.prepare(sql);
    const statement = bindings => ({ bind(...next) { return statement(next); },
      async first() { calls.push(sql); if (beforeRead) await beforeRead(sql); const result = await prepared.bind(...bindings).first();
        if (sql.startsWith("SELECT content,expires_at") && sql.includes("kind='document-artifact'")) rawReads.push(result); return result; },
      async all() { calls.push(sql); if (beforeRead) await beforeRead(sql); return prepared.bind(...bindings).all(); } });
    return statement([]);
  }, batch() { forbiddenPorts.push("DB.batch"); throw new Error("retained read attempted a batch"); } };
  const env = { ...state.env, DB, MEDIA: new Proxy({}, { get(target, key) { forbiddenPorts.push("MEDIA." + String(key)); throw new Error("retained read entered MEDIA"); } }),
    ASSETS: { fetch() { forbiddenPorts.push("ASSETS.fetch"); throw new Error("retained read entered ASSETS"); } } };
  const handle = { documentId: DOCUMENT, jobId: JOB };
  const identity = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
  const request = (headers = {}, method = "GET") => new Request(`https://forma.test${nativeVideoCompletionPath(handle)}`, { method, headers: { ...identity, ...headers } });
  const read = (headers = {}) => handleNativeRetainedOutputRead(request(headers), env);
  const select = () => ({ documentId: DOCUMENT, artifactId: ARTIFACT, revision: 0, contentSha256: digest(raw) });
  const readSelection = selection => handleNativeRetainedOutputRead(new Request(`https://forma.test${nativeRetainedOutputRequestPath({ output: "video", selection })}`, { headers: identity }), env);
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

// These fixtures declare completed personal rows; they do not invoke admission,
// provider execution or browser transport. The association file covers the real
// local Worker producer separately with closed mocks.
test("Video completion joins exact manual root MP4 and ordered null-media plan with SELECT only", async t => {
  for (const [label, count, request] of [["UI omitted count", 1, {}], ["explicit three", 3, { itemCount: 3 }]])
  await t.test(label, async child => {
    const f = await fixture(child, { count, request }), before = f.changes();
    const response = await f.read(), receipt = await response.json();
    assert.equal(response.status, 200, JSON.stringify(receipt));
    assert.deepEqual(receipt, { schemaVersion: 1, kind: "native-video-completion", handle: f.handle, selection: f.select(), expiresAt: EXPIRY });
    assert.deepEqual(validateNativeVideoCompletion(receipt, f.handle), receipt);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= 8192);
    assert.equal(JSON.stringify(receipt).includes(INPUT), false); assert.equal(JSON.stringify(receipt).includes(PROVIDER_JOB), false);
    const target = parseNativeRetainedOutputRoute(nativeVideoRetainedRoute(receipt, f.handle));
    assert.deepEqual(target, { output: "video", selection: f.select() });
    const retained = await f.readSelection(target.selection), dto = await retained.json();
    assert.equal(retained.status, 200, JSON.stringify(dto));
    assert.equal(dto.content.content_markdown, video(count).content_markdown);
    assert.deepEqual(dto.content.primaryMedia, { url: mediaUrl(), mediaType: "video/mp4" });
    assert.deepEqual(dto.content.clips, video(count).items.map((item, index) => ({ id: `clip-${index + 1}`,
      title: item.title, body: item.body, notes: item.notes, media: null })));
    assert.equal(f.changes(), before);
  });
});

test("Video uses the producer's bounded effective count without forcing Audio one or adding a new admission policy", async t => {
  for (const [label, itemCount, count] of [["null default", null, 1], ["numeric string", "3", 3],
    ["lower bound", 0, 1], ["floor", 3.9, 3], ["upper bound", 13, 12]])
  await t.test(label, async child => {
    const f = await fixture(child, { count, request: { itemCount } }), before = f.changes();
    const response = await f.read(); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).selection, f.select()); assert.equal(f.changes(), before);
  });
  const mismatched = await fixture(t, { count: 3 });
  await unavailable(mismatched); // Omitted count normalizes to one, never silently adopts a three-scene result.
});

test("Video preserves valid trimmed and null default guidance from the original request", async t => {
  for (const request of [{ audience: "  general  ", tone: " document-derived " }, { audience: null, tone: null }]) {
    const f = await fixture(t, { request }), before = f.changes(), response = await f.read();
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).selection, f.select()); assert.equal(f.changes(), before);
  }
});

test("Video exact completed job remains readable after ordinary ACK omission without adopting another attempt", async t => {
  for (const attempt of [1, 2, 8]) await t.test(`attempt ${attempt}`, async child => {
    const f = await fixture(child, { attempt });
    f.sqlite.prepare("UPDATE document_jobs SET notified_at=? WHERE job_id=?").run(new Date().toISOString(), JOB);
    if (attempt > 1) await appendEvents(f.writerEnv, [makeEvent(`creative:${OWNER}`, 0, "worker:renderer", "server:document-job:render_document",
      `${JOB}:attempt:${attempt - 1}`, "DocumentRenderCompleted", { ...f.payload, artifact_id: "older-artifact", content_ref: "older-content" })]);
    const before = f.changes(), response = await f.read(); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).selection, f.select()); assert.equal(f.changes(), before);
  });
});

test("Video rejects foreign scopes and missing explicit paid consent before raw content", async t => {
  for (const [label, request] of [
    ["paid absent", { paidMediaConfirmed: undefined }], ["paid false", { paidMediaConfirmed: false }], ["paid string", { paidMediaConfirmed: "true" }],
    ["audience type", { audience: 7 }], ["tone type", { tone: {} }],
    ["audience too long", { audience: "x".repeat(121) }], ["tone UTF-16 too long", { tone: "😀".repeat(61) }],
    ["managed", { productionMode: "managed" }], ["Slides", { artifactKind: "slides" }], ["Audio", { artifactKind: "audio" }],
    ["Scene request", { sceneRequestId: JOB }], ["Scene consent", { sceneCostConsent: null }],
    ["Slides count", { requestedSlideCount: 1 }], ["Slides policy", { slideCountPolicy: null }],
    ["workflow", { workflowId: "workflow" }], ["workflow stage", { workflowStageId: "stage" }], ["workflow sources", { workflowSources: [] }],
    ["output execution", { outputExecution: {} }], ["oversized", { extra: "x".repeat(128 * 1024) }],
  ]) await t.test(label, async child => { const f = await fixture(child, { request }); await unavailable(f); assert.equal(f.rawReads.length, 0); });
});

test("Video original job correlation, result event membership and renderer cannot borrow any completion", async t => {
  const controls = [
    ["bare job ID", { job: { correlation_id: JOB } }], ["previous attempt", { job: { correlation_id: `${JOB}:attempt:1`, attempt_count: 2 } }],
    ["future attempt", { job: { correlation_id: `${JOB}:attempt:2` } }], ["foreign attempt", { job: { correlation_id: "other:attempt:1" } }],
    ["zero attempt", { job: { attempt_count: 0 } }], ["wrong actor", { completionActor: "user" }], ["wrong client", { completionClient: "web:lit" }],
    ["stale result ID", { result: { appendedEventIds: ["older-event"] } }], ["foreign artifact", { result: { artifactId: "other" } }],
    ["running", { job: { status: "running" } }], ["foreign owner", { job: { owner_id: "other" } }], ["foreign surface", { job: { source_surface: "canvas" } }],
    ["job expired", { job: { expires_at: "2000-01-01T00:00:00.000Z" } }],
    ["completion surface", { completionPayload: { source_surface: "canvas" } }],
  ];
  for (const [label, options] of controls) await t.test(label, async child => { const f = await fixture(child, options); await unavailable(f); assert.equal(f.rawReads.length, 0); });
  const f = await fixture(t);
  await appendEvents(f.writerEnv, [makeEvent(`creative:${OWNER}`, 0, "worker:renderer", "server:document-job:render_document", `${JOB}:attempt:1`,
    "DocumentRenderCompleted", { ...f.payload, artifact_id: "duplicate-artifact" })]);
  await unavailable(f); assert.equal(f.rawReads.length, 0);
});

test("Video root file, exact private envelope and plan order cannot borrow Audio or per-scene media", async t => {
  for (const fault of ["null root", "partial root", "wrong MIME", "foreign root", "input ref", "private count", "raw count", "duplicate IDs", "foreign clip", "managed settings"])
  await t.test(fault, async child => {
    const f = await fixture(child, { count: 3, request: { itemCount: 3 } }), p = f.privatePayload();
    if (fault === "null root") { p.media_url = null; p.media_type = null; }
    if (fault === "partial root") p.media_url = null;
    if (fault === "wrong MIME") p.media_type = "audio/mpeg";
    if (fault === "foreign root") p.media_url = `/api/media/${ownerMediaNamespace("other")}%2Fgenerated%2Fvideo.mp4`;
    if (fault === "input ref") p.input_ref = "foreign-input";
    if (fault === "private count") p.item_count = 2;
    if (fault === "raw count") f.replace(video(2));
    if (fault === "duplicate IDs") p.items[1].id = p.items[0].id;
    if (fault === "foreign clip") { p.items[0].media_url = `/api/media/${ownerMediaNamespace("other")}%2Fgenerated%2Fclip.mp4`; p.items[0].media_type = "video/mp4"; }
    if (fault === "managed settings") p.settings.production_mode = "managed";
    f.updatePrivate(p); await unavailable(f);
    if (fault === "null root") {
      const retained = await f.readSelection(f.select()); assert.equal(retained.status, 200);
      assert.equal((await retained.json()).content.primaryMedia, null, "retained unavailable state is distinct from a usable completed-job Open");
    }
  });
});

test("Video selected input binds original saved source, scope, provider invocation and each video option", async t => {
  const mutations = {
    artifact: p => { p.artifact_id = "other"; }, document: p => { p.document_snapshot.document.id = "other"; },
    project: p => { p.project_id = "other"; }, provider: p => { p.render.provider = "other"; },
    invocation: p => { p.render.provider_job_id = "other"; }, model: p => { p.render.model = "other"; },
    source: p => { p.document_snapshot.facts[0].properties.text = "Other direction"; },
    constraint: p => { p.document_snapshot.standing_constraints[0].value = "loud"; },
    count: p => { p.request.item_count = 2; }, seconds: p => { p.request.video_seconds = 8; },
    size: p => { p.request.video_size = "720x1280"; }, sound: p => { p.request.video_audio_mode = "native"; },
    soundtrack: p => { p.request.soundtrack_block_ids = ["foreign-block"]; },
    transfer: p => { p.request.soundtrack_provider_transfer = true; },
    audience: p => { p.request.audience = "different"; }, tone: p => { p.request.tone = "different"; },
  };
  for (const [label, mutate] of Object.entries(mutations)) await t.test(label, async child => {
    const f = await fixture(child); f.updateInput(mutate); await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
  for (const field of ["owner_id", "kind", "expires_at", "redacted_at"]) await t.test(`input ${field}`, async child => {
    const f = await fixture(child);
    f.sqlite.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`)
      .run(field === "expires_at" ? "2000-01-01T00:00:00.000Z" : "other", INPUT);
    await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
});

test("Video source versions reject absent, coerced, duplicated and changed saved witnesses", async t => {
  for (const [label, versions] of [["missing", undefined], ["null", null], ["string", [{ block_id: "direction", version: "1" }]],
    ["negative", [{ block_id: "direction", version: -1 }]], ["missing ID", [{ version: 1 }]],
    ["duplicate", [{ block_id: "direction", version: 1 }, { block_id: "direction", version: 1 }]]])
  await t.test(label, async child => {
    const f = await fixture(child, { request: { sourceBlockVersions: versions }, completionPayload: { source_block_versions: versions } });
    await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
  const f = await fixture(t); f.updateRequest({ sourceBlockVersions: [{ block_id: "direction", version: 2 }] });
  await unavailable(f); assert.equal(f.rawReads.length, 0);
});

test("Video authorization withdrawal and exact final witness reject mutations without endpoint writes", async t => {
  const f = await fixture(t); f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
  const before = f.changes(); assert.equal((await f.read()).status, 403); assert.equal(f.rawReads.length, 0); assert.equal(f.changes(), before);
  for (const fault of ["role", "input bytes", "input expiry", "input owner", "input redacted", "input scope", "request snapshot", "request seconds", "paid flag",
    "provider result", "attempt", "correlation", "root media", "private input", "private order", "raw content", "content expiry", "content owner"])
  await t.test(fault, async child => {
    const g = await fixture(child, { count: 3, request: { itemCount: 3 } }); let entered = false, afterMutation;
    g.setBeforeRead(async sql => {
      if (!sql.includes("expected_events AS")) return;
      assert.equal(entered, false); entered = true;
      if (fault === "role") g.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
      if (fault === "input bytes") g.updateInput(p => { p.document_snapshot.facts[0].properties.text = "Later replacement"; });
      if (fault === "input expiry") g.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2098-01-01T00:00:00.000Z", INPUT);
      if (fault === "input owner") g.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(INPUT);
      if (fault === "input redacted") g.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), INPUT);
      if (fault === "input scope") g.sqlite.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(INPUT, "org", "access", PROJECT, OWNER, "governed-evidence", 1, EXPIRY, new Date().toISOString());
      if (fault === "request snapshot") g.updateRequest({ snapshot: { ...snapshot(), facts: [] } });
      if (fault === "request seconds") g.updateRequest({ videoSeconds: 8 });
      if (fault === "paid flag") g.updateRequest({ paidMediaConfirmed: false });
      if (fault === "provider result") g.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({ ...g.jobResult, providerJobId: "other" }), JOB);
      if (fault === "attempt") g.sqlite.prepare("UPDATE document_jobs SET attempt_count=2 WHERE job_id=?").run(JOB);
      if (fault === "correlation") g.sqlite.prepare("UPDATE document_jobs SET correlation_id=? WHERE job_id=?").run(`${JOB}:attempt:2`, JOB);
      if (fault === "root media") g.updatePrivate({ media_url: `/api/media/${ownerMediaNamespace(OWNER)}%2Fgenerated%2Fchanged.mp4` });
      if (fault === "private input") g.updatePrivate({ input_ref: "changed" });
      if (fault === "private order") { const p = g.privatePayload(); p.items.reverse(); g.updatePrivate(p); }
      if (fault === "raw content") g.replace(video(2));
      if (fault === "content expiry") g.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z", CONTENT);
      if (fault === "content owner") g.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(CONTENT);
      afterMutation = g.changes();
    });
    const response = await g.read(); assert.equal(response.status, 404); assert.equal(entered, true); assert.equal(g.changes(), afterMutation);
  });
});

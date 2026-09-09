import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, after } from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleNativeRetainedOutputRead, ensureSchema, appendAuditEvent, appendEvents, makeEvent;
let nativeSlidesCompletionPath, validateNativeSlidesCompletion, nativeSlidesRetainedRoute;
let nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute;
try {
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ ensureSchema, appendAuditEvent, appendEvents, makeEvent } = await import("../worker/runtime.ts"));
  ({ nativeSlidesCompletionPath, validateNativeSlidesCompletion, nativeSlidesRetainedRoute } = await import("../src/model/native-slides-completion.ts"));
  ({ nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute } = await import("../src/model/native-retained-output.ts"));
} finally { imports.deregister(); }

const realFetch = globalThis.fetch;
let networkCalls = 0;
before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error("Network is forbidden in the RAM-only Slides reader controls"); }; });
after(() => { globalThis.fetch = realFetch; assert.equal(networkCalls, 0); });
const OWNER = "slides-native-owner", EMAIL = "slides-native-owner@example.test";
const DOCUMENT = "slides-native-document", PROJECT = "slides-native-personal-project";
const ARTIFACT = "slides-native-artifact", CONTENT = "slides-native-content", JOB = "slides-native-job";
const EXPIRY = "2099-01-01T00:00:00.000Z", POLICY = "pilot-2026-08-10";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const deck = count => ({ title: "Exact retained Slides", content_markdown: "# Retained manual deck", presentation: null,
  items: Array.from({ length: count }, (_, index) => ({ title: `Slide ${index + 1}`, body: `Body ${index + 1}`,
    notes: "PRIVATE_NOTES_SENTINEL", image_prompt: "PRIVATE_PROMPT_SENTINEL", slide: null })) });

// Existing SQLite/D1 test adapter, explicitly RAM-only; the endpoint gets SELECT-only bindings.
async function fixture(t, options = {}) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env);
  const now = new Date().toISOString(), stream = `creative:${OWNER}`, count = options.count ?? 6, attempt = options.attempt ?? 1;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Slides owner", "creator", POLICY, now, now, now);
  await appendAuditEvent(state.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Original document" });
  const payload = { document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: "slides",
    requested_by_user_id: OWNER, title: "Event title is not retained body", content_ref: CONTENT, item_count: count,
    settings: { item_count: count, production_mode: "manual" }, ...options.completionPayload };
  const completion = makeEvent(options.completionStream ?? stream, 0, options.completionActor ?? "worker:renderer",
    options.completionClient ?? "server:document-job:render_document", options.completionCorrelation ?? `${JOB}:attempt:${attempt}`,
    "DocumentRenderCompleted", payload);
  await appendEvents(state.env, [completion]);
  let raw = JSON.stringify(deck(count));
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const jobRequest = { artifactKind: "slides", productionMode: "manual", itemCount: count, requestedSlideCount: count, ...options.request };
  const jobResult = { artifactKind: "slides", artifactId: ARTIFACT, appendedEventIds: [completion.eventId], ...options.result };
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
        if (sql.startsWith("SELECT content,expires_at")) rawReads.push(result); return result; },
      async all() { calls.push(sql); if (beforeRead) await beforeRead(sql); return prepared.bind(...bindings).all(); } });
    return statement([]);
  }, batch() { throw new Error("retained read attempted a batch"); } };
  const env = { ...state.env, DB, MEDIA: new Proxy({}, { get() { throw new Error("retained read entered MEDIA"); } }),
    ASSETS: { fetch() { throw new Error("retained read entered ASSETS"); } } };
  const handle = { documentId: DOCUMENT, jobId: JOB };
  const identity = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
  const request = (headers = {}, method = "GET") => new Request(`https://forma.test${nativeSlidesCompletionPath(handle)}`, { method, headers: { ...identity, ...headers } });
  const read = (headers = {}) => handleNativeRetainedOutputRead(request(headers), env);
  const select = () => ({ documentId: DOCUMENT, artifactId: ARTIFACT, revision: 0, contentSha256: digest(raw) });
  const readSelection = selection => handleNativeRetainedOutputRead(new Request(`https://forma.test${nativeRetainedOutputRequestPath({ output: "slides", selection })}`, { headers: identity }), env);
  const replace = body => { raw = typeof body === "string" ? body : JSON.stringify(body); state.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(raw, CONTENT); };
  const updateRequest = delta => state.sqlite.prepare("UPDATE document_jobs SET request_json=? WHERE job_id=?").run(JSON.stringify({ ...jobRequest, ...delta }), JOB);
  const append = (type, value) => appendAuditEvent(state.env, stream, "user", type, { document_id: DOCUMENT, project_id: PROJECT, ...value });
  const changes = () => state.sqlite.prepare("SELECT total_changes() AS count").get().count;
  return { ...state, env, handle, payload, completion, jobRequest, jobResult, identity, request, read, readSelection, select, replace,
    updateRequest, append, calls, rawReads, changes, raw: () => raw, setBeforeRead(value) { beforeRead = value; } };
}

async function unavailable(f) {
  const before = f.changes(), response = await f.read();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "retained_story_unavailable" });
  assert.equal(f.changes(), before);
}

test("Slides exact completion derives the retained manual count and opens the original SHA-bound deck without writes", async t => {
  for (const count of [1, 6, 15]) await t.test(`${count} selected slides`, async child => {
    const f = await fixture(child, { count }), before = f.changes();
    const response = await f.read(), receipt = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(receipt, { schemaVersion: 1, kind: "native-slides-completion", handle: f.handle, selection: f.select(), expiresAt: EXPIRY });
    assert.ok(validateNativeSlidesCompletion(receipt, f.handle));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= 8192);
    assert.equal(JSON.stringify(receipt).includes("Exact retained Slides"), false);
    assert.equal(f.calls.length, 5); assert.equal(f.rawReads.length, 1);
    const publicCompletion = JSON.parse(f.sqlite.prepare("SELECT payload FROM events WHERE event_id=?").get(f.completion.eventId).payload);
    assert.equal(publicCompletion.settings, undefined); assert.equal(publicCompletion.item_count, count);
    assert.equal(typeof publicCompletion._private_ref, "string");
    assert.equal(f.calls.some(sql => /private_json|artifact_revisions/u.test(sql)), false);
    const route = nativeSlidesRetainedRoute(receipt, f.handle);
    assert.ok(route.startsWith("/make/slides?"));
    const target = parseNativeRetainedOutputRoute(route);
    assert.deepEqual(target, { output: "slides", selection: f.select() });
    const retained = await f.readSelection(target.selection), body = await retained.json();
    assert.equal(retained.status, 200); assert.equal(body.content.items.length, count);
    assert.equal(body.content.items[0].title, "Slide 1");
    assert.equal(JSON.stringify(body).includes("PRIVATE_"), false);
    assert.equal(f.changes(), before);
    assert.equal((await f.readSelection({ ...target.selection, contentSha256: "0".repeat(64) })).status, 404);
  });
});

test("Slides completion accepts an absent duplicate count and binds current supported attempts", async t => {
  for (const attempt of [1, 2, 8]) await t.test(`current attempt ${attempt}`, async child => {
    const f = await fixture(child, { attempt, request: { requestedSlideCount: undefined } });
    assert.equal((await f.read()).status, 200);
  });
});

test("Slides completion rejects missing, coerced, out-of-range or conflicting count commitments", async t => {
  const controls = [
    ["missing count", { itemCount: undefined }], ["null count", { itemCount: null }], ["string count", { itemCount: "6" }],
    ["boolean count", { itemCount: true }], ["zero", { itemCount: 0 }], ["negative", { itemCount: -1 }],
    ["fractional", { itemCount: 6.5 }], ["too many", { itemCount: 16 }], ["conflicting duplicate", { requestedSlideCount: 5 }],
    ["string duplicate", { requestedSlideCount: "6" }], ["null duplicate", { requestedSlideCount: null }],
    ["flexible policy", { slideCountPolicy: { kind: "flexible", unit: "slide", min: 1, max: 15, aim: 6 } }],
    ["policy outside generic Create", { slideCountPolicy: { kind: "exact", unit: "slide", value: 6 } }],
    ["null policy", { slideCountPolicy: null }], ["managed", { productionMode: "managed" }],
    ["Scene kind", { artifactKind: "scene" }], ["output execution", { outputExecution: {} }],
    ["workflow", { workflowId: "workflow" }], ["workflow stage", { workflowStageId: "stage" }],
    ["workflow sources", { workflowSources: [] }],
  ];
  for (const [label, request] of controls) await t.test(label, async child => { const f = await fixture(child, { request }); await unavailable(f); assert.equal(f.rawReads.length, 0); });
});

test("Slides completion requires request, completion metadata and the validated body to agree", async t => {
  for (const [label, completionPayload] of [
    ["actual count absent", { item_count: undefined }], ["actual count string", { item_count: "6" }], ["actual count mismatch", { item_count: 5 }],
  ]) await t.test(label, async child => { const f = await fixture(child, { completionPayload }); await unavailable(f); assert.equal(f.rawReads.length, 0); });
  for (const count of [0, 1, 5, 7]) await t.test(`body has ${count} items for six requested`, async child => {
    const f = await fixture(child); f.replace(deck(count)); await unavailable(f); assert.equal(f.rawReads.length, 1);
  });
  await t.test("invalid nested slide is rejected even with the exact count", async child => {
    const f = await fixture(child), body = deck(6); body.items[0].title = 12; f.replace(body); await unavailable(f);
  });
});

test("Slides completion cannot substitute a different job, attempt, owner, artifact or completion event", async t => {
  const controls = [
    ["queued", { job: { status: "queued" } }], ["partial", { job: { status: "partial" } }],
    ["wrong owner", { job: { owner_id: "other-owner" } }], ["wrong stream", { job: { stream_id: "creative:other" } }],
    ["wrong document", { job: { document_id: "other-document" } }], ["wrong surface", { job: { source_surface: "workflow" } }],
    ["failed detail", { job: { error_message: "failed" } }], ["no completion time", { job: { completed_at: null } }],
    ["attempt zero", { attempt: 0 }], ["attempt above limit", { attempt: 9 }],
    ["bare correlation", { job: { correlation_id: JOB }, completionCorrelation: JOB }],
    ["prior completion", { attempt: 2, completionCorrelation: `${JOB}:attempt:1` }],
    ["future completion", { completionCorrelation: `${JOB}:attempt:2` }],
    ["wrong completion actor", { completionActor: "user" }], ["wrong completion client", { completionClient: "client" }],
    ["wrong completion stream", { completionStream: "creative:other" }],
    ["wrong result kind", { result: { artifactKind: "scene" } }], ["wrong result artifact", { result: { artifactId: "other-artifact" } }],
    ["missing completion ID", { result: { appendedEventIds: ["other-event"] } }],
    ["wrong requesting actor", { completionPayload: { requested_by_user_id: "other-owner" } }],
    ["wrong completion document", { completionPayload: { document_id: "other-document" } }],
    ["wrong completion project", { completionPayload: { project_id: "other-project" } }],
    ["wrong completion kind", { completionPayload: { artifact_kind: "scene" } }],
  ];
  for (const [label, options] of controls) await t.test(label, async child => { const f = await fixture(child, options); await unavailable(f); });
  await t.test("two completions in the current attempt are ambiguous", async child => {
    const f = await fixture(child);
    const extra = makeEvent(`creative:${OWNER}`, 0, "worker:renderer", "server:document-job:render_document", `${JOB}:attempt:1`,
      "DocumentRenderCompleted", { ...f.payload, artifact_id: "other-artifact" });
    await appendEvents({ ...f.env, DB: f.DB }, [extra]); await unavailable(f);
  });
});

test("Slides current custody, source expiry and original revision remain mandatory", async t => {
  const controls = [
    ["source owner", f => f.sqlite.prepare("UPDATE private_content SET owner_id='other-owner' WHERE content_id=?").run(CONTENT)],
    ["source kind", f => f.sqlite.prepare("UPDATE private_content SET kind='document-artifact-input' WHERE content_id=?").run(CONTENT)],
    ["source redaction", f => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT)],
    ["source expiry", f => f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(CONTENT)],
    ["job expiry", f => f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(JOB)],
    ["removed", f => f.append("DocumentRemoved", {})],
    ["edited revision", f => f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER })],
  ];
  for (const [label, change] of controls) await t.test(label, async child => { const f = await fixture(child); await change(f); await unavailable(f); });
  for (const earlier of ["job", "source"]) await t.test(`${earlier} limits receipt expiry`, async child => {
    const f = await fixture(child), expires = "2098-01-01T00:00:00.000Z";
    if (earlier === "job") f.sqlite.prepare("UPDATE document_jobs SET expires_at=? WHERE job_id=?").run(expires, JOB);
    else f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(expires, CONTENT);
    const response = await f.read(); assert.equal(response.status, 200); assert.equal((await response.json()).expiresAt, expires);
  });
});

test("Slides final witness rejects changes after the body read without endpoint writes", async t => {
  const controls = [
    ["request count changes to another admissible count", f => f.updateRequest({ itemCount: 5, requestedSlideCount: 5 })],
    ["request duplicate becomes conflicting", f => f.updateRequest({ requestedSlideCount: 5 })],
    ["policy added", f => f.updateRequest({ slideCountPolicy: { kind: "flexible", unit: "slide", min: 1, max: 15 } })],
    ["new conflicting completion", f => appendEvents({ ...f.env, DB: f.DB }, [makeEvent(`creative:${OWNER}`, 0,
      "worker:renderer", "server:document-job:render_document", `${JOB}:attempt:1`, "DocumentRenderCompleted",
      { ...f.payload, artifact_id: "conflicting-artifact", item_count: 5 })])],
    ["job status", f => f.sqlite.prepare("UPDATE document_jobs SET status='partial' WHERE job_id=?").run(JOB)],
    ["current attempt", f => f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2,correlation_id=? WHERE job_id=?").run(`${JOB}:attempt:2`, JOB)],
    ["job artifact", f => f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({ ...f.jobResult, artifactId: "other-artifact" }), JOB)],
    ["raw source", f => f.replace(f.raw().replace("Exact retained Slides", "Changed retained Slides"))],
    ["source redaction", f => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), CONTENT)],
    ["owner role", f => f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER)],
    ["original revision edited", f => f.append("DocumentArtifactEdited", { artifact_id: ARTIFACT, content_ref: CONTENT, revision: 1, content_sha256: digest(f.raw()), edited_by_user_id: OWNER })],
  ];
  for (const [label, change] of controls) await t.test(label, async child => {
    const f = await fixture(child); let entered = 0, afterMutation;
    f.setBeforeRead(async sql => { if (!sql.includes("expected_events AS")) return; entered++; await change(f); afterMutation = f.changes(); });
    assert.equal((await f.read()).status, 404); assert.equal(entered, 1); assert.equal(f.rawReads.length, 1); assert.equal(f.changes(), afterMutation);
  });
});

test("Slides dispatch distinguishes valid unauthenticated/missing-job requests from malformed paths", async t => {
  const f = await fixture(t), validUnknown = "https://forma.test/api/retained-output/slides/jobs/one/two";
  assert.equal((await handleNativeRetainedOutputRead(new Request(validUnknown), f.env)).status, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await handleNativeRetainedOutputRead(new Request(validUnknown, { headers: f.identity }), f.env)).status, 404);
  assert.equal(f.calls.length, 2); assert.equal(f.rawReads.length, 0);
  const before = f.calls.length;
  for (const path of ["/api/retained-output/slides/jobs/one", "/api/retained-output/slides/jobs/one/two/extra",
    "/api/retained-output/slides/jobs/one/two?", "/api/retained-output/slides/jobs/one/two?revision=0"]) {
    assert.equal((await handleNativeRetainedOutputRead(new Request("https://forma.test" + path), f.env)).status, 400);
  }
  assert.equal((await handleNativeRetainedOutputRead(f.request({}, "POST"), f.env)).status, 405);
  assert.equal(f.calls.length, before);
  for (const cookie of ["forma_project_context=", "forma_impersonation="]) assert.equal((await f.read({ cookie })).status, 403);
  f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
  assert.equal((await f.read()).status, 403);
});

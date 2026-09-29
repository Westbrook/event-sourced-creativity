import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { before, after } from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

const imports = registerOutputSourceImports();
let handleNativeRetainedOutputRead, ensureSchema, appendAuditEvent, appendEvents, makeEvent;
let nativeModel3dCompletionPath, validateNativeModel3dCompletion, nativeModel3dRetainedRoute;
let nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute;
try {
  ({ handleNativeRetainedOutputRead } = await import("../worker/retained-story-api.ts"));
  ({ ensureSchema, appendAuditEvent, appendEvents, makeEvent } = await import("../worker/runtime.ts"));
  ({ nativeModel3dCompletionPath, validateNativeModel3dCompletion, nativeModel3dRetainedRoute } = await import("../src/model/native-model3d-completion.ts"));
  ({ nativeRetainedOutputRequestPath, parseNativeRetainedOutputRoute } = await import("../src/model/native-retained-output.ts"));
} finally { imports.deregister(); }

const realFetch = globalThis.fetch;
let networkCalls = 0;
before(() => { globalThis.fetch = async () => { networkCalls++; throw new Error("Network is forbidden in the RAM-only Model3D reader controls"); }; });
after(() => { globalThis.fetch = realFetch; assert.equal(networkCalls, 0); });
const OWNER = "model3d-native-owner", EMAIL = "model3d-native-owner@example.test";
const DOCUMENT = "model3d-native-document", PROJECT = "model3d-native-personal-project";
const ARTIFACT = "model3d-native-artifact", CONTENT = "model3d-native-content", JOB = "model3d-native-job";
const EXPIRY = "2099-01-01T00:00:00.000Z", POLICY = "pilot-2026-08-10";
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const INPUT = "model3d-native-input", PROVIDER_JOB = "model3d-native-provider-job";
const { ownerMediaNamespace } = await import("../src/model/media-ownership.ts");
const { DEFAULT_MODEL3D_SETTINGS, RODIN_TEXT_MODEL, RODIN_IMAGE_MODEL, RODIN_ADAPTER_VERSION, serializeRodinInput } = await import("../src/model/model3d.ts");
const MODEL = RODIN_TEXT_MODEL;
const PROMPT = "A quiet lantern — 京都 café é\nوفي المساء  ";
const meshUrl = (owner = OWNER, name = "lantern.glb") => `/api/media/${encodeURIComponent(`${ownerMediaNamespace(owner)}/generated/${name}`)}`;
// Declared producer metadata only: the completion endpoint must never read media bytes.
const retainedFiles = () => [
  { url: meshUrl(), mimeType: "model/gltf-binary", fileName: "lantern.glb", fileSize: 128, format: "glb", role: "mesh", sha256: "a".repeat(64), previewSupported: true },
  { url: meshUrl(OWNER, "albedo.png"), mimeType: "image/png", fileName: "albedo.png", fileSize: 64, format: null, role: "texture", sha256: "b".repeat(64) },
];
const modelSettings = () => structuredClone(DEFAULT_MODEL3D_SETTINGS);
const completionSettings = () => ({ model3d: modelSettings(), model3d_settings: modelSettings(), model3d_files: retainedFiles(),
  source_media_sha256: retainedFiles()[0].sha256, adapter_version: RODIN_ADAPTER_VERSION, seed: 7,
  reserved_cost_microusd: serializeRodinInput(PROMPT, modelSettings()).estimatedCostMicrousd,
  settled_cost_microusd: serializeRodinInput(PROMPT, modelSettings()).estimatedCostMicrousd });
const model3d = () => ({ title: "Exact retained Model3D", summary: PROMPT, content_markdown: PROMPT, presentation: null, items: [] });
const snapshot = () => ({ facts: [{ block_id: "direction", properties: { text: "Saved original direction" } }], relationships: [],
  context_groups: [], pins: [], tail: [], standing_constraints: [{ preference_id: "pref1", polarity: "include", axis: "tone", value: "quiet" }] });
// The declared receipt follows the existing Rodin serializer; no provider adapter is invoked.
const stableJson = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
const inputBody = (references = []) => {
  const serialized = serializeRodinInput(PROMPT, modelSettings(), references.map((_, index) => `https://fal.media/reference-${index + 1}`));
  const parameters = Object.fromEntries(Object.entries(serialized.input).filter(([key]) => key !== "image_urls"));
  const referenceInputs = structuredClone(references), model = serialized.model;
  return { schema_version: 1, artifact_id: ARTIFACT, artifact_kind: "model3d", document_id: DOCUMENT, project_id: PROJECT,
    source_block_versions: [{ block_id: "direction", version: 1 }],
    request: { model3d_prompt: PROMPT, model3d_settings: modelSettings(), model3d_reference_block_ids: references.map(reference => reference.blockId), source_surface: "document",
      estimated_cost_microusd: serialized.estimatedCostMicrousd, reserved_cost_microusd: serialized.estimatedCostMicrousd },
    document_snapshot: snapshot(), planner: null,
    render: { provider: "fal", model, providerJobId: PROVIDER_JOB, submittedPrompt: PROMPT, submitted_prompt: PROMPT,
      settings: modelSettings(), referenceInputs, reference_inputs: structuredClone(references), usedReferencePixels: references.length > 0, used_reference_pixels: references.length > 0,
      adapterVersion: RODIN_ADAPTER_VERSION, seed: 7, parameters, acceptedFields: Object.keys(serialized.input),
      estimatedCostMicrousd: serialized.estimatedCostMicrousd, requestDigest: digest(stableJson({ model, parameters, referenceInputs })) } };
};

// Existing SQLite/D1 test adapter, explicitly RAM-only; the endpoint gets SELECT-only bindings.
async function fixture(t, options = {}) {
  const state = outputTestDatabase();
  const forbiddenPorts = [];
  t.after(() => { try { assert.deepEqual(forbiddenPorts, [], "No attempted forbidden endpoint port, including caught failures"); } finally { state.sqlite.close(); } });
  await ensureSchema(state.env);
  const now = new Date().toISOString(), stream = `creative:${OWNER}`, attempt = options.attempt ?? 1;
  const references = options.references ?? [], model = references.length ? RODIN_IMAGE_MODEL : MODEL;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(OWNER, EMAIL, "Model3D owner", "creator", POLICY, now, now, now);
  await appendAuditEvent(state.env, stream, "user", "DocumentCreated", { document_id: DOCUMENT, project_id: PROJECT, title: "Original document" });
  const payload = { document_id: DOCUMENT, project_id: PROJECT, artifact_id: ARTIFACT, artifact_kind: "model3d",
    requested_by_user_id: OWNER, source_surface: "document", title: "Event title is not retained body", content_ref: CONTENT, item_count: 0,
    source_block_versions: [{ block_id: "direction", version: 1 }], settings: completionSettings(), items: [], presentation: null, input_ref: INPUT,
    media_url: meshUrl(), media_type: "model/gltf-binary", provider: "fal", provider_job_id: PROVIDER_JOB, model_id: model,
    reference_inputs: structuredClone(references), used_reference_pixels: references.length > 0, ...options.completionPayload };
  const completion = makeEvent(options.completionStream ?? stream, 0, options.completionActor ?? "worker:renderer",
    options.completionClient ?? "server:document-job:render_document", options.completionCorrelation ?? `${JOB}:attempt:${attempt}`,
    "DocumentRenderCompleted", payload);
  await appendEvents(state.env, [completion]);
  let raw = JSON.stringify(model3d());
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const jobRequest = { artifactKind: "model3d", productionMode: "manual", paidMediaConfirmed: true,
    documentId: DOCUMENT, documentRevision: "saved-revision", requestKey: "render:model3d:manual:saved-revision:default", itemCount: 1,
    snapshot: snapshot(), sourceBlockVersions: [{ block_id: "direction", version: 1 }], model3dPrompt: PROMPT, model3dPromptSource: "exact",
    model3dSettings: modelSettings(), model3dReferenceBlockIds: references.map(reference => reference.blockId), ...options.request };
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(INPUT, OWNER, "document-artifact-input", JSON.stringify(inputBody(references)), now, EXPIRY);
  const jobResult = { artifactKind: "model3d", artifactId: ARTIFACT, appendedEventIds: [completion.eventId], providerJobId: PROVIDER_JOB, provider: "fal", ...options.result };
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
      async all() { calls.push(sql); if (beforeRead) await beforeRead(sql); return prepared.bind(...bindings).all(); },
      run() { forbiddenPorts.push("DB.statement.run"); throw new Error("retained read attempted statement execution"); } });
    return statement([]);
  }, batch() { forbiddenPorts.push("DB.batch"); throw new Error("retained read attempted a batch"); },
    exec() { forbiddenPorts.push("DB.exec"); throw new Error("retained read attempted exec"); } };
  const env = { ...state.env, DB, MEDIA: new Proxy({}, { get(target, key) { forbiddenPorts.push("MEDIA." + String(key)); throw new Error("retained read entered MEDIA"); } }),
    ASSETS: { fetch() { forbiddenPorts.push("ASSETS.fetch"); throw new Error("retained read entered ASSETS"); } } };
  const handle = { documentId: DOCUMENT, jobId: JOB };
  const identity = { "oai-authenticated-user-id": OWNER, "oai-authenticated-user-email": EMAIL };
  const request = (headers = {}, method = "GET") => new Request(`https://forma.test${nativeModel3dCompletionPath(handle)}`, { method, headers: { ...identity, ...headers } });
  const read = (headers = {}) => handleNativeRetainedOutputRead(request(headers), env);
  const select = () => ({ documentId: DOCUMENT, artifactId: ARTIFACT, revision: 0, contentSha256: digest(raw) });
  const readSelection = selection => handleNativeRetainedOutputRead(new Request(`https://forma.test${nativeRetainedOutputRequestPath({ output: "model3d", selection })}`, { headers: identity }), env);
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

// Declared completed personal rows, not admission/provider/browser evidence.
// The association test separately exercises the actual local producer.
test("Model3D completion joins one requested generation to zero plan items and exact owned file metadata", async t => {
  const f = await fixture(t), before = f.changes();
  const response = await f.read(), receipt = await response.json();
  assert.equal(response.status, 200, JSON.stringify(receipt));
  assert.deepEqual(receipt, { schemaVersion: 1, kind: "native-model3d-completion", handle: f.handle, selection: f.select(), expiresAt: EXPIRY });
  assert.deepEqual(validateNativeModel3dCompletion(receipt, f.handle), receipt);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(f.jobRequest.itemCount, 1); assert.equal(f.payload.item_count, 0);
  assert.deepEqual(f.payload.items, []); assert.deepEqual(JSON.parse(f.raw()).items, []);
  assert.equal(f.calls.length, 7); assert.equal(f.rawReads.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) <= 8192);
  for (const privateValue of [INPUT, PROVIDER_JOB, PROMPT, meshUrl(), retainedFiles()[0].sha256])
    assert.equal(JSON.stringify(receipt).includes(privateValue), false);
  const target = parseNativeRetainedOutputRoute(nativeModel3dRetainedRoute(receipt, f.handle));
  assert.deepEqual(target, { output: "model3d", selection: f.select() });
  const retained = await f.readSelection(target.selection), dto = await retained.json();
  assert.equal(retained.status, 200, JSON.stringify(dto));
  assert.deepEqual(dto.content, { files: retainedFiles(), availability: "mesh-reference" });
  assert.equal(f.changes(), before);
});

test("Model3D exact completed attempt remains readable after ACK without borrowing old completions", async t => {
  for (const attempt of [1, 2, 8]) await t.test(`attempt ${attempt}`, async child => {
    const f = await fixture(child, { attempt });
    f.sqlite.prepare("UPDATE document_jobs SET notified_at=? WHERE job_id=?").run(new Date().toISOString(), JOB);
    if (attempt > 1) await appendEvents(f.writerEnv, [makeEvent(`creative:${OWNER}`, 0, "worker:renderer", "server:document-job:render_document",
      `${JOB}:attempt:${attempt - 1}`, "DocumentRenderCompleted", { ...f.payload, artifact_id: "older-artifact", content_ref: "older-content" })]);
    const before = f.changes(), response = await f.read(); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).selection, f.select()); assert.equal(f.changes(), before);
  });
});

test("Model3D completion uses the earliest exact input expiry and refuses an obsolete retained selection", async t => {
  const f = await fixture(t), inputExpiry = "2098-01-01T00:00:00.000Z";
  f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(inputExpiry, INPUT);
  const before = f.changes(), response = await f.read(), receipt = await response.json();
  assert.equal(response.status, 200); assert.equal(receipt.expiresAt, inputExpiry);
  for (const selection of [{ ...f.select(), revision: 1 }, { ...f.select(), contentSha256: "f".repeat(64) }])
    assert.equal((await f.readSelection(selection)).status, 404);
  assert.equal(f.changes(), before);
});

test("Model3D rejects unconfirmed, contradictory or unrelated generation requests before raw content", async t => {
  for (const [label, request] of [
    ["missing count", { itemCount: undefined }], ["null count", { itemCount: null }], ["zero count", { itemCount: 0 }], ["two count", { itemCount: 2 }], ["coerced count", { itemCount: "1" }],
    ["paid missing", { paidMediaConfirmed: undefined }], ["paid false", { paidMediaConfirmed: false }], ["paid string", { paidMediaConfirmed: "true" }],
    ["managed", { productionMode: "managed" }], ["Video", { artifactKind: "video" }],
    ["Scene request", { sceneRequestId: JOB }], ["Scene consent", { sceneCostConsent: null }],
    ["Slides count", { requestedSlideCount: 1 }], ["Slides policy", { slideCountPolicy: null }],
    ["workflow", { workflowId: "workflow" }], ["workflow stage", { workflowStageId: "stage" }],
    ["workflow sources", { workflowSources: [] }], ["output execution", { outputExecution: {} }],
    ["oversized request", { extra: "x".repeat(128 * 1024) }],
  ]) await t.test(label, async child => {
    const f = await fixture(child, { request }); await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
});

test("Model3D completion binds the current owner, attempt, renderer and result event", async t => {
  for (const [label, options] of [
    ["bare job ID", { job: { correlation_id: JOB } }], ["previous attempt", { job: { correlation_id: `${JOB}:attempt:1`, attempt_count: 2 } }],
    ["future attempt", { job: { correlation_id: `${JOB}:attempt:2` } }], ["zero attempt", { job: { attempt_count: 0 } }],
    ["wrong actor", { completionActor: "user" }], ["wrong client", { completionClient: "web:lit" }],
    ["wrong event correlation", { completionCorrelation: "other-job:attempt:1" }],
    ["stale result ID", { result: { appendedEventIds: ["older-event"] } }], ["foreign artifact", { result: { artifactId: "other" } }],
    ["running", { job: { status: "running" } }], ["foreign owner", { job: { owner_id: "other" } }],
    ["foreign surface", { job: { source_surface: "canvas" } }], ["job expired", { job: { expires_at: "2000-01-01T00:00:00.000Z" } }],
    ["completion surface", { completionPayload: { source_surface: "canvas" } }],
  ]) await t.test(label, async child => {
    const f = await fixture(child, options); await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
  const f = await fixture(t);
  await appendEvents(f.writerEnv, [makeEvent(`creative:${OWNER}`, 0, "worker:renderer", "server:document-job:render_document", `${JOB}:attempt:1`,
    "DocumentRenderCompleted", { ...f.payload, artifact_id: "duplicate-artifact" })]);
  await unavailable(f); assert.equal(f.rawReads.length, 0);
});

test("Model3D completion refuses contradictory public and private count or input witnesses", async t => {
  // Public events are append-only. Seed each contradictory public value through
  // ordinary appendEvents, then restore only the allowed private test envelope.
  for (const [label, options, mutate] of [
    ["public count", { completionPayload: { item_count: 1 } }, f => f.updatePrivate({ item_count: 0 })],
    ["private count", {}, f => f.updatePrivate({ item_count: 1 })],
    ["public input", { completionPayload: { input_ref: "other-input" } }, f => f.updatePrivate({ input_ref: INPUT })],
    ["private input", {}, f => f.updatePrivate({ input_ref: "other-input" })],
    ["private items", {}, f => f.updatePrivate({ items: [{ id: "invented-plan-item" }] })],
    ["raw plan items", {}, f => f.replace({ ...model3d(), items: [{ title: "Not a mesh receipt", body: "Prose" }] })],
  ]) await t.test(label, async child => { const f = await fixture(child, options); mutate(f); await unavailable(f); });
});

test("Model3D selected files cannot borrow foreign ownership, malformed types or contradictory primary metadata", async t => {
  const mutations = {
    absent: p => { delete p.settings.model3d_files; }, empty: p => { p.settings.model3d_files = []; },
    foreign: p => { p.settings.model3d_files[1].url = meshUrl("other", "albedo.png"); },
    traversal: p => { p.settings.model3d_files[0].url = meshUrl(OWNER, "../lantern.glb"); },
    remote: p => { p.settings.model3d_files[0].url = "https://example.test/lantern.glb"; },
    duplicate: p => { p.settings.model3d_files[1].url = p.settings.model3d_files[0].url; },
    mime: p => { p.settings.model3d_files[0].mimeType = "video/mp4"; },
    hash: p => { p.settings.model3d_files[0].sha256 = "not-a-hash"; },
    size: p => { p.settings.model3d_files[0].fileSize = 0; },
    primaryURL: p => { p.media_url = meshUrl(OWNER, "different.glb"); },
    primaryMIME: p => { p.media_type = "application/octet-stream"; },
    primarySHA: p => { p.settings.source_media_sha256 = "c".repeat(64); },
    wrongSettings: p => { p.settings.model3d_settings.seed = 9; },
    wrongAlias: p => { p.settings.model3d.seed = 9; },
  };
  for (const [label, mutate] of Object.entries(mutations)) await t.test(label, async child => {
    const f = await fixture(child), payload = f.privatePayload(); mutate(payload); f.updatePrivate(payload); await unavailable(f);
    if (label === "empty") {
      const retained = await f.readSelection(f.select()); assert.equal(retained.status, 200);
      assert.deepEqual((await retained.json()).content, { files: [], availability: "metadata-only" });
    }
  });
});

test("Model3D input binds original source, prompt, normalized settings and prepared provider receipt", async t => {
  const mutations = {
    artifact: p => { p.artifact_id = "other"; }, document: p => { p.document_id = "other"; }, project: p => { p.project_id = "other"; },
    provider: p => { p.render.provider = "other"; }, invocation: p => { p.render.providerJobId = "other"; }, model: p => { p.render.model = "other"; },
    source: p => { p.document_snapshot.facts[0].properties.text = "Later direction"; },
    constraint: p => { p.document_snapshot.standing_constraints[0].value = "loud"; },
    surface: p => { p.request.source_surface = "canvas"; }, prompt: p => { p.request.model3d_prompt += "changed"; },
    requestSettings: p => { p.request.model3d_settings.seed = 9; }, renderSettings: p => { p.render.settings.seed = 9; },
    references: p => { p.request.model3d_reference_block_ids = ["foreign-reference"]; },
    promptAlias: p => { p.render.submitted_prompt += "changed"; }, preparedPrompt: p => { p.render.submittedPrompt += "changed"; },
    parameters: p => { p.render.parameters.seed = 9; }, fields: p => { p.render.acceptedFields.push("invented"); },
    digest: p => { p.render.requestDigest = "d".repeat(64); }, adapter: p => { p.render.adapterVersion = "old-adapter"; },
    referenceAlias: p => { p.render.reference_inputs = [{ blockId: "other" }]; },
    usedPixels: p => { p.render.usedReferencePixels = true; }, usedAlias: p => { p.render.used_reference_pixels = true; },
    estimate: p => { p.request.estimated_cost_microusd++; }, reserve: p => { p.request.reserved_cost_microusd = 0; },
  };
  for (const [label, mutate] of Object.entries(mutations)) await t.test(label, async child => {
    const f = await fixture(child); f.updateInput(mutate); await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
  for (const field of ["owner_id", "kind", "expires_at", "redacted_at"]) await t.test(`input ${field}`, async child => {
    const f = await fixture(child);
    f.sqlite.prepare(`UPDATE private_content SET ${field}=? WHERE content_id=?`).run(field === "expires_at" ? "2000-01-01T00:00:00.000Z" : "other", INPUT);
    await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
});

test("Model3D source versions reject missing, coerced, duplicate and changed witnesses", async t => {
  for (const [label, versions] of [["missing", undefined], ["string", [{ block_id: "direction", version: "1" }]],
    ["negative", [{ block_id: "direction", version: -1 }]], ["missing ID", [{ version: 1 }]],
    ["duplicate", [{ block_id: "direction", version: 1 }, { block_id: "direction", version: 1 }]]])
  await t.test(label, async child => {
    const f = await fixture(child, { request: { sourceBlockVersions: versions }, completionPayload: { source_block_versions: versions } });
    await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
  const f = await fixture(t); f.updateRequest({ sourceBlockVersions: [{ block_id: "direction", version: 2 }] });
  await unavailable(f); assert.equal(f.rawReads.length, 0);
});

test("Model3D ordered reference receipts bind the original selection, bytes and prepared input digest", async t => {
  const references = [0, 1].map(index => ({ index, blockId: `reference-${index}`, referenceId: `saved-reference-${index}`,
    label: `View ${index + 1}`, byteLength: 128 + index, sha256: String(index + 1).repeat(64), mimeType: "image/png", transport: "fal-storage-upload" }));
  const current = await fixture(t, { references }), before = current.changes(), response = await current.read();
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual((await response.json()).selection, current.select()); assert.equal(current.changes(), before);
  const mutations = {
    order: p => { p.render.referenceInputs.reverse(); },
    selectedBlock: p => { p.render.referenceInputs[0].blockId = "other"; },
    bytes: p => { p.render.referenceInputs[0].byteLength = 0; },
    hash: p => { p.render.referenceInputs[0].sha256 = "not-a-hash"; },
    mime: p => { p.render.referenceInputs[0].mimeType = "video/mp4"; },
    transport: p => { p.render.referenceInputs[0].transport = "other"; },
    alias: p => { p.render.reference_inputs[0].referenceId = "other"; },
  };
  for (const [label, mutate] of Object.entries(mutations)) await t.test(label, async child => {
    const f = await fixture(child, { references });
    f.updateInput(p => {
      mutate(p);
      if (label !== "alias") {
        p.render.reference_inputs = structuredClone(p.render.referenceInputs);
        p.render.requestDigest = digest(stableJson({ model: p.render.model, parameters: p.render.parameters, referenceInputs: p.render.referenceInputs }));
        f.updatePrivate({ reference_inputs: structuredClone(p.render.referenceInputs) });
      }
    });
    await unavailable(f); assert.equal(f.rawReads.length, 0);
  });
});

test("Model3D final witness refuses source or file replacement after selection without endpoint writes", async t => {
  const denied = await fixture(t); denied.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER);
  const before = denied.changes(); assert.equal((await denied.read()).status, 403);
  assert.equal(denied.rawReads.length, 0); assert.equal(denied.changes(), before);
  const mutations = {
    role: f => f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(OWNER),
    inputBytes: f => f.updateInput(p => { p.document_snapshot.facts[0].properties.text = "Replaced"; }),
    inputExpiry: f => f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2098-01-01T00:00:00.000Z", INPUT),
    inputOwner: f => f.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(INPUT),
    inputRedacted: f => f.sqlite.prepare("UPDATE private_content SET redacted_at=? WHERE content_id=?").run(new Date().toISOString(), INPUT),
    inputScope: f => f.sqlite.prepare("INSERT INTO private_content_retention_scopes(content_id,organization_id,project_access_id,project_id,actor_user_id,classification,policy_version,assigned_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(INPUT, "org", "access", PROJECT, OWNER, "governed-evidence", 1, EXPIRY, new Date().toISOString()),
    snapshot: f => f.updateRequest({ snapshot: { ...snapshot(), facts: [] } }),
    options: f => f.updateRequest({ model3dSettings: { ...modelSettings(), seed: 9 } }),
    paid: f => f.updateRequest({ paidMediaConfirmed: false }),
    provider: f => f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify({ ...f.jobResult, providerJobId: "other" }), JOB),
    attempt: f => f.sqlite.prepare("UPDATE document_jobs SET attempt_count=2 WHERE job_id=?").run(JOB),
    correlation: f => f.sqlite.prepare("UPDATE document_jobs SET correlation_id=? WHERE job_id=?").run(`${JOB}:attempt:2`, JOB),
    fileURL: f => { const p = f.privatePayload(); p.settings.model3d_files[1].url = meshUrl(OWNER, "replaced.png"); f.updatePrivate(p); },
    fileSHA: f => { const p = f.privatePayload(); p.settings.model3d_files[1].sha256 = "c".repeat(64); f.updatePrivate(p); },
    fileOrder: f => { const p = f.privatePayload(); p.settings.model3d_files.reverse(); f.updatePrivate(p); },
    privateInput: f => f.updatePrivate({ input_ref: "changed" }),
    appendedPublicCompletion: f => appendEvents(f.writerEnv, [makeEvent(`creative:${OWNER}`, 0, "worker:renderer",
      "server:document-job:render_document", `${JOB}:attempt:1`, "DocumentRenderCompleted", { ...f.payload })]),
    raw: f => f.replace({ ...model3d(), summary: "Later prose replacement" }),
    contentExpiry: f => f.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run("2000-01-01T00:00:00.000Z", CONTENT),
    contentOwner: f => f.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(CONTENT),
  };
  for (const [label, mutate] of Object.entries(mutations)) await t.test(label, async child => {
    const f = await fixture(child); let entered = false, afterMutation;
    const originalEvent = f.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(f.completion.eventId);
    f.setBeforeRead(async sql => {
      if (!sql.includes("expected_events AS")) return;
      assert.equal(entered, false); entered = true; await mutate(f); afterMutation = f.changes();
    });
    const response = await f.read(); assert.equal(response.status, 404); assert.equal(entered, true);
    assert.equal(f.changes(), afterMutation);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(f.completion.eventId), originalEvent,
      "The selected append-only event remains byte-for-byte unchanged");
  });
});

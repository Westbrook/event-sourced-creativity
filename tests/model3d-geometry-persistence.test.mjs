import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, disposeSceneStoreResolution, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { outputTestDatabase } from "./output-server-test-helpers.mjs";
import { png } from "./output-asset-fixtures.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";
import { synchronizeProjectScope } from "../worker/project-access.ts";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { MODEL3D_MIME_TYPE, validateModel3dAsset } from "../src/model/model3d-assets.ts";
import { model3dPresetView } from "../src/model/model3d-view.ts";
import { scaleModel3dGeometry } from "../src/model/model3d-geometry-edit.ts";

// Real controller + real Store + routed Worker, with the existing RAM/native
// ports. The original is a declared synthetic triangle and its PNG is synthetic;
// this is reference-block geometry persistence, not generated output replacement,
// a real viewer capture, provider execution, browser input or media-quality proof.
after(disposeSceneStoreResolution);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const targetId = "geometry-persistence-target";
const paidTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters", "output_execution_grants", "output_operation_slots", "output_provider_calls"];

// The exact triangle fixture from the existing safe model3d-upload-flow test.
function triangleGlb() {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  }));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const bytes = Buffer.alloc(12 + 8 + jsonLength + 8 + 36);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonLength, 12); bytes.writeUInt32LE(0x4e4f534a, 16); bytes.fill(0x20, 20, 20 + jsonLength); json.copy(bytes, 20);
  bytes.writeUInt32LE(36, 20 + jsonLength); bytes.writeUInt32LE(0x004e4942, 24 + jsonLength);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => bytes.writeFloatLE(value, 28 + jsonLength + index * 4));
  return bytes;
}

// Transpile the full, unchanged component. Only Lit rendering and its base host
// are finite ports; all imported model code and exported transaction code remain
// the actual sources. No method extraction or test-only private accessor exists.
async function controller() {
  const url = new URL("../src/components/model3d-geometry-editor.ts", import.meta.url);
  const source = readFileSync(url, "utf8"), tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dependencies = new Map(), exports = {};
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier === "lit") dependencies.set(specifier, { html: (strings, ...values) => ({ strings, values }), nothing: Symbol("nothing") });
    else if (specifier === "./forma-element") dependencies.set(specifier, { FormaElement: class {} });
    else {
      assert.ok(specifier.startsWith("../model/"), "Only declared real model suppliers: " + specifier);
      dependencies.set(specifier, await import(new URL(specifier.endsWith(".ts") ? specifier : specifier + ".ts", url)));
    }
  }
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", "customElements", code)(specifier => {
    assert.ok(dependencies.has(specifier), "Declared controller import: " + specifier); return dependencies.get(specifier);
  }, exports, { get: () => true, define() { assert.fail("No component registration in RAM controls"); } });
  return exports;
}

async function fixture(t) {
  let externalAttempts = 0;
  t.mock.method(globalThis, "fetch", async () => { externalAttempts++; assert.fail("No external/provider requests in geometry persistence"); });
  const f = await createSceneCostFixture(1, "visual", { shared: true }), storage = outputTestDatabase();
  const hosts = [], requests = [], responses = [], api = await controller();
  f.env.MEDIA = storage.env.MEDIA;
  const originalRequest = f.request;
  f.request = async (url, init = {}) => {
    const method = init.method ?? "GET";
    assert.ok(method === "GET" && (url === "/api/session" || url.startsWith("/api/events?") || url.startsWith("/api/media/"))
      || method === "POST" && (url === "/api/events" || url === "/api/media"), "Finite local route: " + method + " " + url);
    const request = { method, url, body: typeof init.body === "string" ? JSON.parse(init.body) : null }; requests.push(request);
    const response = await originalRequest(url, init);
    const body = response.headers.get("content-type")?.includes("application/json") ? await response.clone().json() : null;
    responses.push({ ...request, status: response.status, body }); return response;
  };
  const counts = () => Object.fromEntries(paidTables.map(table => [table, f.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const history = () => f.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
  const mediaState = () => [...storage.media].map(([id, value]) => ({ key: id, bytes: hash(value.bytes), metadata: value.metadata, contentType: value.contentType }));
  const counters = () => f.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all();
  const session = await f.request("/api/session"); assert.equal(session.status, 200);
  const baselineCounts = counts(), baselineCounters = counters();
  t.after(async () => {
    try {
      for (const host of hosts) await host.close();
      await f.drainBackground();
      assert.deepEqual(counts(), baselineCounts); assert.deepEqual(counters(), baselineCounters);
      assert.equal(externalAttempts, 0); assert.ok(hosts.every(host => host.closed && host.timers.size === 0));
    } finally { f.close(); storage.sqlite.close(); }
  });
  assert.deepEqual(baselineCounts, { document_jobs: 0, budget_reservations: 0, cost_budget_reservations: 0, cost_budget_counters: 3,
    output_execution_grants: 0, output_operation_slots: 0, output_provider_calls: 0 });
  assert.ok(baselineCounters.every(row => row.used_microusd === 0 && row.reserved_microusd === 0));
  const seed = (type, payload) => appendAuditEvent(f.env, f.streamId, "user:" + f.owner, type, payload);
  const upload = async (bytes, model = null) => {
    const form = new FormData(), mime = model ? "image/png" : MODEL3D_MIME_TYPE;
    form.append("file", new File([bytes], model ? "declared-view.png" : "triangle.glb", { type: mime }));
    form.append("rightsConfirmed", "true"); form.append("nonSensitiveConfirmed", "true");
    if (model) { form.append("modelUrl", model.url); form.append("modelContentHash", model.contentHash); form.append("modelView", JSON.stringify(view)); }
    const response = await f.request("/api/media", { method: "POST", body: form }), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.contentHash, hash(bytes)); assert.equal(body.mimeType, mime);
    return body;
  };
  const view = model3dPresetView("front", "#ffffff"), originalBytes = triangleGlb(), originalMedia = await upload(originalBytes);
  // Declared RGBA image has valid PNG/CRC bytes, never fabricated viewer evidence.
  const raw = new Uint8Array((64 * 4 + 1) * 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) raw.set([30, 110, 190, 255], y * 257 + 1 + x * 4);
  const viewBytes = png({ width: 64, height: 64, raw }), viewMedia = await upload(viewBytes, originalMedia);
  const seedReference = async (id, media, positive = true) => {
    await seed("ReferenceIngested", { reference_id: id, source_type: "upload", source_ref: media.url, content_hash: media.contentHash,
      source_mime_type: media.mimeType, rights_class: "asserted", rights_expires_at: "+010000-01-01T00:00:00.000Z" });
    await seed("RightsAsserted", { reference_id: id, rights_class: positive ? "owned_or_licensed" : "revoked", rights_expires_at: "2999-01-01T00:00:00.000Z", assertion_method: "declared-test-fixture" });
  };
  const modelRef = targetId + "-original", viewRef = targetId + "-view";
  await seedReference(modelRef, originalMedia); await seedReference(viewRef, viewMedia);
  const originalProperties = { label: "Café 雨 — retained model 🌱", text: "Authored reference, not a generated result", weight: .65, subtype: "Object",
    model_reference_id: modelRef, model_url: originalMedia.url, model_content_hash: originalMedia.contentHash, model_mime_type: MODEL3D_MIME_TYPE,
    model_filename: "original-triangle.glb", reference_id: viewRef, media_url: viewMedia.url, media_type: "image/png",
    source_mime_type: "image/png", source_content_hash: viewMedia.contentHash, model_view: view, pixel_reference_mode: "preserve_composition" };
  const seedBlock = async (id, overrides = {}, properties = {}) => seed("BlockCreated", {
    block_id: id, project_id: f.projectId, scope: "library", type: "model3d", handle: "model3d/" + id, position: id,
    properties: { ...originalProperties, ...properties }, ...overrides,
  });
  await seedBlock(targetId);
  await seedBlock("geometry-wrong-type", { type: "reference" });
  await seedBlock("geometry-document-owned", { scope: "document", document_id: f.documentId });
  await seedBlock("geometry-locked"); await seed("BlockLocked", { block_id: "geometry-locked", scope: "library", locked_by: "user" });
  await seedBlock("geometry-removed"); await seed("BlockRemoved", { block_id: "geometry-removed", scope: "library" });
  await seedBlock("geometry-managed", {}, { organization_context_package_binding_id: "retained-managed-binding" });
  await seedBlock("geometry-expired", {}, { rights_expires_at: "2001-01-01T00:00:00Z" });
  await seedReference("geometry-revoked-ref", originalMedia, false);
  await seedBlock("geometry-revoked", {}, { model_reference_id: "geometry-revoked-ref" });
  await seedBlock("geometry-wrong-ref", {}, { model_reference_id: viewRef });
  await seed("ProjectCreated", { project_id: "geometry-foreign-project", name: "Unselected geometry project" });
  await seedBlock("geometry-foreign", { project_id: "geometry-foreign-project" });
  await seed("DocumentCreated", { project_id: f.projectId, document_id: "geometry-next-document", title: "Actual available next document" });
  await synchronizeProjectScope(f.env, { ...f.sharing, projectId: f.projectId, ownerUserId: f.owner });
  const target = host => host.store.projection.get().libraryBlocks.find(block => block.id === targetId);
  const open = async () => {
    const start = responses.length;
    const host = await createSceneStoreHost({ workerFixture: { ...f, close() {} }, exposeSceneTestAccessors: false,
      beforeFetch(url) { assert.ok(!String(url).startsWith("/api/document-jobs"), "No foreground scene driver/paid action"); } });
    hosts.push(host);
    host.store.route.set(withDocumentInRoute("/document", f.documentId, "One current authored direction"));
    assert.equal(host.store.projection.get().documentId, f.documentId);
    const reads = responses.slice(start), fresh = reads.find(row => row.url === "/api/events?after=0&limit=2000&content=1");
    assert.equal(reads.find(row => row.url === "/api/session")?.status, 200);
    assert.ok(fresh && Array.isArray(fresh.body.events) && Number.isSafeInteger(fresh.body.head) && fresh.body.content && typeof fresh.body.content === "object");
    assert.deepEqual(host.store.events.get(), fresh.body.events); assert.equal(host.store.head.get(), fresh.body.head); assert.deepEqual(host.store.content.get(), fresh.body.content);
    assert.equal(host.store.projection.get().libraryBlocks.filter(block => block.id === targetId).length, 1);
    return host;
  };
  const refresh = async host => {
    const response = await f.request("/api/events?after=0&limit=2000&content=1"); assert.equal(response.status, 200);
    const body = await response.json(); assert.ok(Array.isArray(body.events) && Number.isSafeInteger(body.head));
    host.store.events.set(body.events); host.store.head.set(body.head); host.store.content.set(body.content); return body;
  };
  const read = async (media, bytes) => {
    const response = await f.request(media.url); assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), media.mimeType);
    const actual = new Uint8Array(await response.arrayBuffer()); assert.deepEqual(actual, new Uint8Array(bytes)); assert.equal(hash(actual), media.contentHash); return actual;
  };
  return { f, storage, hosts, api, requests, responses, counts, history, mediaState, seed, upload, seedReference, originalProperties,
    originalBytes, originalMedia, viewBytes, viewMedia, target, open, refresh, read };
}

test("scaled vertex bytes receive one full Worker ACK and survive a fresh Store/private read without changing original assets", { timeout: 60_000 }, async t => {
  const f = await fixture(t), first = await f.open(), original = structuredClone(f.target(first)), history = f.history();
  const editing = await f.api.prepareModel3dGeometryEdit(first.store, targetId, () => true), head = first.store.head.get();
  const preview = editing.preview(2);
  assert.deepEqual(preview.beforeBounds.size, [1, 1, 0]); assert.deepEqual(preview.afterBounds.size, [2, 2, 0]);
  // Callers may inspect or alter preview output; saved geometry is recomputed from
  // the private original, not accepted from a manufactured preview object.
  const expectedBytes = new Uint8Array(preview.bytes); preview.bytes.fill(0);
  const requestStart = f.requests.length, responseStart = f.responses.length, mediaBefore = f.mediaState();
  assert.deepEqual(await editing.save(1), { status: "unchanged" });
  await assert.rejects(editing.save(2), error => error.code === "confirmation");
  assert.equal(f.requests.length, requestStart); assert.deepEqual(f.mediaState(), mediaBefore); assert.deepEqual(f.history(), history);
  const result = await editing.save(2, { nonSensitiveConfirmed: true }); assert.equal(result.status, "saved", JSON.stringify({ result, failure: first.store.appendFailure.get() }));
  assert.equal(result.contentHash, hash(expectedBytes)); assert.equal(editing.current(), false);
  const writes = f.requests.slice(requestStart).filter(row => row.method === "POST");
  assert.deepEqual(writes.map(row => row.url), ["/api/media", "/api/events"]); assert.equal(writes[1].body.expectedSequence, head);
  const ack = f.responses.slice(responseStart).find(row => row.method === "POST" && row.url === "/api/events");
  assert.equal(ack.status, 200); assert.equal(ack.body.appended.length, 14); assert.deepEqual(ack.body.rejected ?? [], []);
  assert.deepEqual(ack.body.appended.map(event => event.type), ["ReferenceIngested", "RightsAsserted", ...Array(12).fill("BlockPropertyEdited")]);
  assert.ok(ack.body.appended.slice(2).every(event => event.payload.block_id === targetId));
  assert.equal(ack.body.appended[1].payload.rights_expires_at, "2999-01-01T00:00:00.000Z", "the derivative retains year 2999, earlier than the ingestion’s extended ISO year +010000");
  assert.equal(ack.body.appended[1].payload.source_reference_id, original.properties.model_reference_id);
  const updated = structuredClone(f.target(first)), p = updated.properties;
  assert.equal(updated.id, original.id); assert.equal(updated.handle, original.handle); assert.equal(updated.scope, "library");
  for (const name of ["label", "text", "weight", "subtype"]) assert.deepEqual(p[name], original.properties[name]);
  assert.equal(p.model_url, result.url); assert.equal(p.model_content_hash, hash(expectedBytes)); assert.equal(p.model_filename, "scaled-model.glb");
  for (const name of ["media_url", "media_type", "source_mime_type", "source_content_hash", "reference_id", "model_view"]) assert.equal(p[name], null);
  assert.equal(p.pixel_reference_mode, "context_only"); assert.equal(f.storage.media.size, mediaBefore.length + 1);
  const savedRows = f.history(); for (const row of history) assert.deepEqual(savedRows.find(item => item.event_id === row.event_id), row);
  assert.equal(savedRows.length, history.length + 14);
  await first.close(); const second = await f.open(); assert.notEqual(first.store, second.store); assert.notEqual(first.modules, second.modules);
  assert.deepEqual(f.target(second), updated); assert.deepEqual(f.history(), savedRows);
  const persisted = await f.read({ url: result.url, contentHash: result.contentHash, mimeType: MODEL3D_MIME_TYPE }, expectedBytes);
  validateModel3dAsset(persisted, MODEL3D_MIME_TYPE); assert.deepEqual(scaleModel3dGeometry(persisted, 1).beforeBounds.size, [2, 2, 0]);
  await f.read(f.originalMedia, f.originalBytes); await f.read(f.viewMedia, f.viewBytes);
  const beforeRetry = f.requests.length; assert.deepEqual(await editing.save(3, { nonSensitiveConfirmed: true }), { status: "unavailable" }); assert.equal(f.requests.length, beforeRetry);
  t.diagnostic(JSON.stringify({ proof: "actual-geometry-to-full-ack-to-fresh-store", targetId, appended: 14, head: ack.body.head,
    glb: { bytes: persisted.byteLength, sha256: hash(persisted), dimensions: [2, 2, 0] }, originalGlbAndPngUnchanged: true, syntheticFixture: true }));
});

test("wrong, foreign, locked, removed and rights-invalid targets refuse before a source read or upload", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open();
  const ids = ["missing-geometry", "geometry-wrong-type", "geometry-document-owned", "geometry-foreign", "geometry-locked", "geometry-removed",
    "geometry-managed", "geometry-expired", "geometry-revoked", "geometry-wrong-ref"];
  assert.equal(host.store.projection.get().libraryBlocks.some(block => block.id === "geometry-foreign"), false);
  for (const id of ids) {
    const before = { history: f.history(), media: f.mediaState(), requests: f.requests.length };
    await assert.rejects(f.api.prepareModel3dGeometryEdit(host.store, id, () => true), { name: "Error" }, id);
    assert.deepEqual(f.history(), before.history, id); assert.deepEqual(f.mediaState(), before.media, id); assert.equal(f.requests.length, before.requests, id);
  }
  const before = f.requests.length;
  await assert.rejects(f.api.prepareModel3dGeometryEdit(host.store, targetId, () => false)); assert.equal(f.requests.length, before);
  const session = host.store.session.get(); host.setSession({ projectContext: { ...session.projectContext, permissions: ["project.read"] } });
  await assert.rejects(f.api.prepareModel3dGeometryEdit(host.store, targetId, () => true)); assert.equal(f.requests.length, before);
});

test("wrong original bytes and a source changed after reading cannot produce an upload", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open(), history = f.history(), media = f.mediaState();
  host.intercept = request => request.url === f.originalMedia.url
    ? new Response(scaleModel3dGeometry(f.originalBytes, 2).bytes, { headers: { "content-type": MODEL3D_MIME_TYPE } }) : undefined;
  await assert.rejects(f.api.prepareModel3dGeometryEdit(host.store, targetId, () => true), error => error.code === "source");
  host.intercept = null;
  const editing = await f.api.prepareModel3dGeometryEdit(host.store, targetId, () => true);
  await f.seed("BlockPropertyEdited", { block_id: targetId, property_path: "model_content_hash", old_value: f.originalMedia.contentHash,
    new_value: "a".repeat(64), source_surface: "declared-stale-source" });
  await f.refresh(host); const changedHistory = f.history(), requestStart = f.requests.length;
  assert.throws(() => editing.preview(2)); assert.deepEqual(await editing.save(2, { nonSensitiveConfirmed: true }), { status: "unavailable" });
  assert.equal(f.requests.length, requestStart); assert.deepEqual(f.mediaState(), media); assert.deepEqual(f.history(), changedHistory);
  assert.equal(changedHistory.length, history.length + 1);
});

for (const boundary of ["owner departure", "document departure", "changed source"]) test("late upload after " + boundary + " remains unreferenced without publishing or deleting", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open(); let owned = true;
  const editing = await f.api.prepareModel3dGeometryEdit(host.store, targetId, () => owned), release = sceneDeferred();
  const mediaBefore = f.mediaState(), requestStart = f.requests.length; let uploaded = false;
  host.transport = async request => {
    const response = await f.f.request(request.url, request.init);
    if (request.url === "/api/media" && request.init.method === "POST") { assert.equal(response.status, 200); uploaded = true; await release.promise; }
    return response;
  };
  const pending = editing.save(2, { nonSensitiveConfirmed: true });
  try {
    await untilScene(() => uploaded, "actual derived GLB upload completed");
    if (boundary === "owner departure") owned = false;
    else if (boundary === "document departure") {
      host.store.route.set(withDocumentInRoute("/document", "geometry-next-document", "Actual available next document"));
      assert.equal(host.store.projection.get().documentId, "geometry-next-document");
    } else {
      await f.seed("BlockPropertyEdited", { block_id: targetId, property_path: "model_filename", old_value: "original-triangle.glb",
        new_value: "newer-source-name.glb", source_surface: "declared-concurrent-edit" }); await f.refresh(host);
    }
    const protectedState = { history: f.history(), target: structuredClone(f.target(host)), focus: host.store.ui.focusBlockId, toast: host.store.ui.toast };
    release.resolve(); assert.deepEqual(await pending, { status: "unavailable" });
    assert.deepEqual(f.history(), protectedState.history); assert.deepEqual(f.target(host), protectedState.target);
    assert.equal(host.store.ui.focusBlockId, protectedState.focus); assert.equal(host.store.ui.toast, protectedState.toast);
    assert.deepEqual(f.requests.slice(requestStart).filter(row => row.method === "POST").map(row => row.url), ["/api/media"]);
    assert.equal(f.storage.media.size, mediaBefore.length + 1); for (const row of mediaBefore) assert.deepEqual(f.mediaState().find(item => item.key === row.key), row);
    assert.deepEqual(await editing.save(3, { nonSensitiveConfirmed: true }), { status: "unavailable" });
  } finally { release.resolve(); await pending; }
});

test("an unseen competing geometry edit gets an expected-head refusal, preserving the remote model and honest orphan", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open(), editing = await f.api.prepareModel3dGeometryEdit(host.store, targetId, () => true);
  const expected = host.store.head.get(), release = sceneDeferred(), requestStart = f.requests.length, mediaBefore = f.mediaState(); let uploaded = false;
  host.transport = async request => {
    const response = await f.f.request(request.url, request.init);
    if (request.url === "/api/media" && request.init.method === "POST") { uploaded = true; await release.promise; } return response;
  };
  const pending = editing.save(2, { nonSensitiveConfirmed: true });
  try {
    await untilScene(() => uploaded, "owned upload before the competing write");
    const remoteBytes = scaleModel3dGeometry(f.originalBytes, 3).bytes, remote = await f.upload(remoteBytes), referenceId = "remote-geometry-reference";
    const properties = { model_url: remote.url, model_content_hash: remote.contentHash, model_mime_type: MODEL3D_MIME_TYPE,
      model_reference_id: referenceId, model_filename: "remote-scaled.glb", media_url: null, media_type: null, source_mime_type: null,
      source_content_hash: null, reference_id: null, model_view: null, pixel_reference_mode: "context_only" };
    const events = [
      { type: "ReferenceIngested", payload: { reference_id: referenceId, source_type: "upload", source_ref: remote.url, content_hash: remote.contentHash, source_mime_type: MODEL3D_MIME_TYPE, rights_class: "asserted" } },
      { type: "RightsAsserted", payload: { reference_id: referenceId, rights_class: "owned_or_licensed", assertion_method: "declared-competing-edit" } },
      ...Object.entries(properties).map(([name, value]) => ({ type: "BlockPropertyEdited", payload: { block_id: targetId, property_path: name,
        old_value: f.originalProperties[name] ?? null, new_value: value, source_surface: "declared-competing-edit" } })),
    ];
    const response = await f.f.request("/api/events", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "batch", events, expectedSequence: expected, clientId: "declared-competitor" }) });
    const acknowledged = await response.json(); assert.equal(response.status, 200, JSON.stringify(acknowledged)); assert.equal(acknowledged.appended.length, 14);
    const remoteHistory = f.history(); assert.equal(host.store.head.get(), expected, "the controller has not seen the competing original");
    release.resolve(); assert.deepEqual(await pending, { status: "unconfirmed" });
    const ownWrite = f.responses.filter(row => row.url === "/api/events" && row.method === "POST").at(-1);
    assert.equal(ownWrite.status, 409); assert.equal(ownWrite.body.error, "stale_sequence");
    assert.deepEqual(f.history(), remoteHistory); assert.equal(host.store.head.get(), expected);
    assert.equal(f.requests.slice(requestStart).filter(row => row.url === "/api/events" && row.method === "POST").length, 2, "one competitor and one owned attempt, no automatic rebase");
    assert.equal(f.storage.media.size, mediaBefore.length + 2, "one referenced competitor and one unreferenced owned upload");
    const fresh = await f.open(); assert.equal(f.target(fresh).properties.model_url, remote.url); assert.equal(f.target(fresh).properties.model_content_hash, remote.contentHash);
    await f.read(remote, remoteBytes); await f.read(f.originalMedia, f.originalBytes); await f.read(f.viewMedia, f.viewBytes);
    const last = f.requests.length; assert.deepEqual(await editing.save(2, { nonSensitiveConfirmed: true }), { status: "unavailable" }); assert.equal(f.requests.length, last);
  } finally { release.resolve(); await pending; }
});

test("a lost full ACK is not retried or rolled back; fresh read observes the actual committed geometry", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open(), editing = await f.api.prepareModel3dGeometryEdit(host.store, targetId, () => true);
  const expectedBytes = editing.preview(2).bytes, initial = structuredClone(f.target(host)), requestStart = f.requests.length, head = host.store.head.get();
  let actualAck;
  host.transport = async request => {
    const response = await f.f.request(request.url, request.init);
    if (request.url === "/api/events" && request.init.method === "POST") {
      assert.equal(response.status, 200); actualAck = await response.json(); assert.equal(actualAck.appended.length, 14);
      // A truncated response is controlled transport loss after the real atomic
      // commit, not an invented successful Worker acknowledgment.
      return Response.json({ ...actualAck, appended: actualAck.appended.slice(0, 1) });
    } return response;
  };
  assert.deepEqual(await editing.save(2, { nonSensitiveConfirmed: true }), { status: "unconfirmed" }); assert.ok(actualAck);
  assert.equal(host.store.head.get(), head); assert.deepEqual(f.target(host), initial);
  assert.deepEqual(f.requests.slice(requestStart).filter(row => row.method === "POST").map(row => row.url), ["/api/media", "/api/events"]);
  const before = f.requests.length; assert.deepEqual(await editing.save(2, { nonSensitiveConfirmed: true }), { status: "unavailable" }); assert.equal(f.requests.length, before);
  const fresh = await f.open(), updated = f.target(fresh);
  assert.equal(updated.properties.model_content_hash, hash(expectedBytes)); assert.notEqual(updated.properties.model_url, initial.properties.model_url);
  await f.read({ url: updated.properties.model_url, contentHash: updated.properties.model_content_hash, mimeType: MODEL3D_MIME_TYPE }, expectedBytes);
  await f.read(f.originalMedia, f.originalBytes); await f.read(f.viewMedia, f.viewBytes);
  assert.equal(fresh.store.head.get(), actualAck.head);
});


test("retiring a hung original body does not await its hung cancellation or dispatch an upload", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open(), owner = new AbortController();
  const history = f.history(), media = f.mediaState(); let reading = false, cancellation = false;
  host.intercept = request => request.url === f.originalMedia.url ? new Response(new ReadableStream({
    pull() { reading = true; }, cancel() { cancellation = true; return new Promise(() => {}); },
  }), { headers: { "content-type": MODEL3D_MIME_TYPE } }) : undefined;
  const pending = f.api.prepareModel3dGeometryEdit(host.store, targetId, () => true, { signal: owner.signal });
  const rejected = assert.rejects(pending, error => error.code === "unavailable");
  await untilScene(() => reading, "controlled original body read began"); owner.abort(); await rejected;
  assert.equal(cancellation, true); assert.deepEqual(f.history(), history); assert.deepEqual(f.mediaState(), media);
});

test("retiring a hung upload response withholds events and retains the actual unreferenced GLB", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open(), owner = new AbortController();
  const editing = await f.api.prepareModel3dGeometryEdit(host.store, targetId, () => true, { signal: owner.signal });
  const history = f.history(), media = f.mediaState(), requestStart = f.requests.length; let reading = false, cancellation = false;
  host.transport = async request => {
    const response = await f.f.request(request.url, request.init);
    if (request.url !== "/api/media" || request.init.method !== "POST") return response;
    assert.equal(response.status, 200);
    return new Response(new ReadableStream({ pull() { reading = true; }, cancel() { cancellation = true; return new Promise(() => {}); } }),
      { headers: { "content-type": "application/json" } });
  };
  const pending = editing.save(2, { nonSensitiveConfirmed: true });
  await untilScene(() => reading, "actual upload complete, controlled response body waiting"); owner.abort();
  assert.deepEqual(await pending, { status: "unconfirmed" }); assert.equal(cancellation, true);
  assert.deepEqual(f.history(), history); assert.equal(f.storage.media.size, media.length + 1);
  for (const row of media) assert.deepEqual(f.mediaState().find(item => item.key === row.key), row);
  assert.deepEqual(f.requests.slice(requestStart).filter(row => row.method === "POST").map(row => row.url), ["/api/media"]);
});


test("an invalid upload response body is discarded without awaiting its cancellation or publishing events", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open(), editing = await f.api.prepareModel3dGeometryEdit(host.store, targetId, () => true);
  const history = f.history(), media = f.mediaState(), requestStart = f.requests.length; let cancellation = false;
  host.transport = async request => {
    const response = await f.f.request(request.url, request.init);
    if (request.url !== "/api/media" || request.init.method !== "POST") return response;
    assert.equal(response.status, 200);
    return new Response(new ReadableStream({ cancel() { cancellation = true; return new Promise(() => {}); } }),
      { headers: { "content-type": "text/html" } });
  };
  assert.deepEqual(await editing.save(2, { nonSensitiveConfirmed: true }), { status: "unconfirmed" });
  assert.equal(cancellation, true); assert.deepEqual(f.history(), history); assert.equal(f.storage.media.size, media.length + 1);
  assert.deepEqual(f.requests.slice(requestStart).filter(row => row.method === "POST").map(row => row.url), ["/api/media"]);
});

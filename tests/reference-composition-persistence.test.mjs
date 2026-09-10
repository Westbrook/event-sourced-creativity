import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, disposeSceneStoreResolution, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { outputTestDatabase } from "./output-server-test-helpers.mjs";
import { png } from "./output-asset-fixtures.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";
import { synchronizeProjectScope } from "../worker/project-access.ts";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { createReferenceComposition, addReferenceCompositionLayer } from "../src/model/reference-composition.ts";

// The complete production Store and Worker run against the existing RAM ports.
// These opaque PNGs are declared synthetic captures, never browser canvas output.
// Reference block event persistence is not a generated Image replacement or a
// numbered DocumentArtifact revision, and no review/export/provider is replayed.
after(disposeSceneStoreResolution);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceId = "reference-persistence-source", targetId = "reference-persistence-target";
const label = "Café 雨 — edited reference 🌱";
const publicationUi = host => ({ focusBlockId: host.store.ui.focusBlockId, editingBlockId: host.store.ui.editingBlockId,
  toast: host.store.ui.toast, toastPresentation: host.store.ui.toastPresentation });
const paidTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters", "output_execution_grants", "output_operation_slots", "output_provider_calls"];
const properties = (media, referenceId, text, recipe) => ({ label: text, subtype: recipe ? "Composition" : "Image", reference_id: referenceId,
  media_url: media.url, media_type: "image/png", source_mime_type: "image/png", source_content_hash: media.contentHash,
  pixel_reference_mode: recipe ? "preserve_composition" : "context_only", extraction_status: "unavailable", ...(recipe ? { reference_composition: recipe } : {}) });

function capturedPng(width, height, edited = false) {
  const stride = width * 4 + 1, raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    raw.set(x < width * (edited ? 0.7 : 0.4) ? [40, 90, 180, 255] : [30, 160, 100, 255], y * stride + 1 + x * 4);
  }
  return png({ width, height, raw });
}

async function fixture(t) {
  let externalAttempts = 0;
  t.mock.method(globalThis, "fetch", async () => { externalAttempts++; assert.fail("No external or provider request belongs to reference persistence"); });
  const f = await createSceneCostFixture(1, "visual", { shared: true });
  const storage = outputTestDatabase(), hosts = [], requests = [], responses = [];
  // Only reuse this helper's real byte/metadata Map. The scene fixture owns its
  // own event database; no second database receives application requests.
  f.env.MEDIA = storage.env.MEDIA;
  const originalRequest = f.request;
  f.request = async (url, init = {}) => {
    const method = init.method ?? "GET";
    assert.ok((method === "GET" && (url === "/api/session" || url.startsWith("/api/events?") || url.startsWith("/api/media/")))
      || (method === "POST" && (url === "/api/events" || url === "/api/media")), "Finite actual local route: " + method + " " + url);
    requests.push({ method, url });
    const response = await originalRequest(url, init);
    const body = response.headers.get("content-type")?.includes("application/json") ? await response.clone().json() : null;
    responses.push({ method, url, status: response.status, body });
    return response;
  };
  const counts = () => Object.fromEntries(paidTables.map(table => [table, f.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const history = () => f.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
  const mediaState = () => [...storage.media].map(([key, value]) => ({ key, bytes: hash(value.bytes), metadata: value.metadata, contentType: value.contentType }));
  const preSessionCounts = counts();
  const sharedSession = await f.request("/api/session"); assert.equal(sharedSession.status, 200);
  const zeroCounts = counts();
  const counterAmounts = () => f.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all();
  const initialCounters = counterAmounts();
  t.after(async () => {
    for (const host of hosts) await host.close();
    await f.drainBackground();
    try {
      assert.deepEqual(counts(), zeroCounts);
      assert.deepEqual(counterAmounts(), initialCounters);
      assert.equal(externalAttempts, 0);
      assert.ok(hosts.every(host => host.closed && host.timers.size === 0));
    } finally { f.close(); storage.sqlite.close(); }
  });
  // Shared session bootstrap adds its organization to the two zero-amount
  // account counters. Their presence
  // is not a charge or reservation; preserve their exact amounts and limits.
  assert.deepEqual(zeroCounts, { document_jobs: 0, budget_reservations: 0, cost_budget_reservations: 0, cost_budget_counters: 3, output_execution_grants: 0, output_operation_slots: 0, output_provider_calls: 0 });
  assert.equal(preSessionCounts.cost_budget_counters, 2);
  assert.ok(initialCounters.every(row => row.used_microusd === 0 && row.reserved_microusd === 0));
  t.diagnostic(JSON.stringify({ setup: "shared-session-budget-counters", before: preSessionCounts, baseline: zeroCounts, zeroUsedAndReserved: true }));
  const seed = (type, payload) => appendAuditEvent(f.env, f.streamId, "user:" + f.owner, type, payload);
  const upload = async (bytes, recipe) => {
    const form = new FormData(); form.append("file", new File([bytes], "declared-capture.png", { type: "image/png" }));
    form.append("rightsConfirmed", "true"); form.append("nonSensitiveConfirmed", "true");
    if (recipe) form.append("referenceComposition", JSON.stringify(recipe));
    const response = await f.request("/api/media", { method: "POST", body: form }), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.contentHash, hash(bytes));
    return body;
  };
  const seedReference = async (id, media, recipe, projectId = f.projectId, documentId = f.documentId) => {
    const referenceId = id + "-receipt";
    await seed("ReferenceIngested", { reference_id: referenceId, source_type: recipe ? "reference-composition" : "upload", source_ref: media.url,
      content_hash: media.contentHash, source_mime_type: "image/png", rights_class: "asserted" });
    await seed("RightsAsserted", { reference_id: referenceId, rights_class: "owned_or_licensed", assertion_method: "declared-test-fixture" });
    await seed("BlockCreated", { project_id: projectId, document_id: documentId, block_id: id, type: "reference", position: id, scope: "document",
      handle: "reference/" + id, properties: properties(media, referenceId, id, recipe) });
  };
  const sourceBytes = capturedPng(24, 24), sourceMedia = await upload(sourceBytes);
  await seedReference(sourceId, sourceMedia);
  const source = { id: sourceId + ":image", blockId: sourceId, label: sourceId, mediaUrl: sourceMedia.url, contentHash: sourceMedia.contentHash, kind: "image" };
  const recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "retained-image-layer");
  const originalBytes = capturedPng(recipe.width, recipe.height), originalMedia = await upload(originalBytes, recipe);
  await seedReference(targetId, originalMedia, recipe);
  // A retained foreign project target must never enter the selected project.
  await seed("ProjectCreated", { project_id: "foreign-reference-project", name: "Unselected reference project" });
  await seed("DocumentCreated", { project_id: "foreign-reference-project", document_id: "foreign-reference-document", title: "Unselected reference document" });
  await seedReference("foreign-reference-target", originalMedia, recipe, "foreign-reference-project", "foreign-reference-document");
  await seed("DocumentCreated", { project_id: f.projectId, document_id: "departed-reference-document", title: "Actual available next document" });
  await synchronizeProjectScope(f.env, { ...f.sharing, projectId: f.projectId, ownerUserId: f.owner });
  const open = async () => {
    const start = responses.length;
    // Each host retires its native timers. This facade only transfers database
    // disposal to this fixture's single owner, allowing a genuinely fresh Store.
    const host = await createSceneStoreHost({ workerFixture: { ...f, close() {} }, exposeSceneTestAccessors: false,
      beforeFetch(url) { assert.ok(!String(url).startsWith("/api/document-jobs"), "No scene driver or paid operation"); } });
    hosts.push(host);
    // The reused host starts at legacy /studio, which is no longer a Document
    // route. Address the actual source explicitly, without changing the helper.
    host.store.route.set(withDocumentInRoute("/document", f.documentId, "One current authored direction"));
    assert.equal(host.store.projection.get().documentId, f.documentId);
    const reads = responses.slice(start), fresh = reads.find(value => value.url === "/api/events?after=0&limit=2000&content=1");
    assert.equal(reads.find(value => value.url === "/api/session")?.status, 200);
    assert.ok(fresh && Array.isArray(fresh.body.events) && Number.isSafeInteger(fresh.body.head) && fresh.body.content && typeof fresh.body.content === "object");
    assert.deepEqual(host.store.events.get(), fresh.body.events); assert.equal(host.store.head.get(), fresh.body.head);
    assert.deepEqual(host.store.content.get(), fresh.body.content);
    assert.equal(host.store.projection.get().libraryBlocks.filter(block => block.id === targetId).length, 1);
    return host;
  };
  const target = host => host.store.projection.get().libraryBlocks.find(block => block.id === targetId);
  const capture = () => {
    const edited = structuredClone(recipe); edited.layers[0].x = 70;
    return { blob: new Blob([capturedPng(recipe.width, recipe.height, true)], { type: "image/png" }), recipe: edited, label, targetBlockId: targetId };
  };
  const readPng = async (media, expected) => {
    const response = await f.request(media.url); assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await response.arrayBuffer()); assert.deepEqual(bytes, expected); assert.equal(hash(bytes), media.contentHash);
    return { bytes: bytes.byteLength, sha256: hash(bytes), width: new DataView(bytes.buffer).getUint32(16), height: new DataView(bytes.buffer).getUint32(20) };
  };
  return { f, storage, requests, responses, history, mediaState, seed, open, target, capture, recipe, sourceMedia, sourceBytes, originalMedia, originalBytes, readPng };
}

test("edited reference composition survives actual Worker acknowledgement and a fresh Store/media read", { timeout: 60_000 }, async t => {
  const f = await fixture(t), first = await f.open();
  const initialHistory = f.history(), initialTarget = structuredClone(f.target(first)), capture = f.capture();
  const requestStart = f.requests.length, responseStart = f.responses.length, mediaCount = f.storage.media.size;
  assert.equal(await first.store.saveReferenceComposition(capture), true);
  const updated = f.target(first), newProperties = updated.properties;
  assert.equal(updated.id, initialTarget.id); assert.equal(newProperties.label, label);
  assert.deepEqual(newProperties.reference_composition, capture.recipe);
  assert.deepEqual(newProperties.reference_composition.sources, f.recipe.sources);
  assert.notEqual(newProperties.media_url, f.originalMedia.url);
  assert.notEqual(newProperties.source_content_hash, f.originalMedia.contentHash);
  assert.equal(newProperties.source_content_hash, hash(new Uint8Array(await capture.blob.arrayBuffer())));
  assert.equal(f.storage.media.size, mediaCount + 1);
  const writes = f.requests.slice(requestStart).filter(value => value.method === "POST");
  assert.deepEqual(writes.map(value => value.url), ["/api/media", "/api/events"]);
  const acknowledgement = f.responses.slice(responseStart).find(value => value.method === "POST" && value.url === "/api/events");
  assert.equal(acknowledgement.status, 200); assert.ok(Array.isArray(acknowledgement.body.appended));
  assert.equal(acknowledgement.body.appended.length, 12);
  assert.deepEqual(acknowledgement.body.appended.map(event => event.type), ["ReferenceIngested", "RightsAsserted", ...Array(10).fill("BlockPropertyEdited")]);
  for (const event of acknowledgement.body.appended.slice(2)) assert.equal(event.payload.block_id, targetId);
  const afterHistory = f.history();
  for (const row of initialHistory) assert.deepEqual(afterHistory.find(value => value.event_id === row.event_id), row);
  assert.equal(afterHistory.length, initialHistory.length + acknowledgement.body.appended.length);
  const stored = f.storage.media.get(decodeURIComponent(newProperties.media_url.slice("/api/media/".length)));
  assert.equal(stored.metadata.referenceCompositionVersion, "1");
  assert.equal(stored.metadata.referenceCompositionSha256, hash(JSON.stringify(capture.recipe)));
  await first.close();
  const second = await f.open();
  assert.notEqual(first.store, second.store); assert.notEqual(first.modules, second.modules);
  assert.notEqual(f.target(second), updated); assert.deepEqual(f.target(second), updated);
  assert.deepEqual(f.history(), afterHistory);
  const file = await f.readPng({ url: newProperties.media_url, contentHash: newProperties.source_content_hash }, new Uint8Array(await capture.blob.arrayBuffer()));
  assert.deepEqual({ width: file.width, height: file.height }, { width: capture.recipe.width, height: capture.recipe.height });
  await f.readPng(f.originalMedia, f.originalBytes); await f.readPng(f.sourceMedia, f.sourceBytes);
  t.diagnostic(JSON.stringify({ proof: "reference-block-persisted-edit", targetId, eventsAppended: acknowledgement.body.appended.length, file,
    freshStore: true, originalMediaUnchanged: true, syntheticCapture: true, documentArtifactRevision: false }));
});

test("wrong, foreign and stale-source reference edits refuse before any upload or event", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open();
  assert.equal(host.store.projection.get().libraryBlocks.some(block => block.id === "foreign-reference-target"), false);
  const cases = [
    { name: "missing target", change: capture => { capture.targetBlockId = "missing-reference-target"; } },
    { name: "wrong block type", change: capture => { capture.targetBlockId = "scene-reuse-direction"; } },
    { name: "foreign project target", change: capture => { capture.targetBlockId = "foreign-reference-target"; } },
    { name: "stale source hash", change: capture => { capture.recipe.sources[0].contentHash = "a".repeat(64); } },
  ];
  for (const example of cases) {
    const capture = f.capture(); example.change(capture);
    const history = f.history(), media = f.mediaState(), target = structuredClone(f.target(host)), requests = f.requests.length;
    assert.equal(await host.store.saveReferenceComposition(capture), false, example.name);
    assert.deepEqual(f.history(), history, example.name); assert.deepEqual(f.mediaState(), media, example.name);
    assert.deepEqual(f.target(host), target, example.name); assert.equal(f.requests.length, requests, example.name);
  }
});

for (const boundary of ["stale target", "document departure"]) test("reference edit withholds publication after " + boundary + " during real upload", { timeout: 60_000 }, async t => {
  const f = await fixture(t), host = await f.open(), entered = sceneDeferred(), release = sceneDeferred();
  const initialHistory = f.history(), initialTarget = structuredClone(f.target(host)), mediaCount = f.storage.media.size, start = f.requests.length;
  let uploaded = false;
  host.transport = async request => {
    const response = await f.f.request(request.url, request.init);
    if (request.url === "/api/media" && request.init.method === "POST") {
      assert.equal(response.status, 200); uploaded = true; entered.resolve(); await release.promise;
    }
    return response;
  };
  const capture = f.capture(), pending = host.store.saveReferenceComposition(capture);
  try {
    await untilScene(() => uploaded, "real upload completed before the controlled boundary"); await entered.promise;
    if (boundary === "stale target") {
      const replacement = structuredClone(f.recipe); replacement.layers[0].x = 25;
      await f.seed("BlockPropertyEdited", { block_id: targetId, document_id: f.f.documentId, property_path: "reference_composition",
        old_value: f.recipe, new_value: replacement, source_surface: "declared-concurrent-edit" });
      await synchronizeProjectScope(f.f.env, { ...f.f.sharing, projectId: f.f.projectId, ownerUserId: f.f.owner });
      const response = await f.f.request("/api/events?after=0&limit=2000&content=1");
      assert.equal(response.status, 200); const current = await response.json();
      assert.ok(Array.isArray(current.events)); assert.ok(Number.isSafeInteger(current.head));
      host.store.events.set(current.events); host.store.head.set(current.head); host.store.content.set(current.content);
      assert.equal(f.target(host).properties.reference_composition.layers[0].x, 25);
    } else {
      host.store.route.set(withDocumentInRoute("/document", "departed-reference-document", "Actual available next document"));
      assert.equal(host.store.projection.get().documentId, "departed-reference-document", "the departure must actually select another available document");
      assert.notEqual(host.store.projection.get().documentId, f.f.documentId);
    }
    const protectedState = { history: f.history(), ui: publicationUi(host), target: structuredClone(f.target(host)) };
    release.resolve(); assert.equal(await pending, false);
    assert.deepEqual(f.history(), protectedState.history);
    assert.deepEqual(publicationUi(host), protectedState.ui);
    assert.deepEqual(f.target(host), protectedState.target);
    assert.deepEqual(f.requests.slice(start).filter(value => value.method === "POST").map(value => value.url), ["/api/media"]);
    assert.equal(f.storage.media.size, mediaCount + 1, "late refusal preserves the honestly observed unreferenced upload");
    assert.equal(f.history().length, initialHistory.length + (boundary === "stale target" ? 1 : 0));
    const fresh = await f.open(), persisted = f.target(fresh);
    assert.equal(persisted.properties.media_url, initialTarget.properties.media_url);
    assert.equal(persisted.properties.label, initialTarget.properties.label);
    assert.equal(persisted.properties.reference_composition.layers[0].x, boundary === "stale target" ? 25 : 50);
    t.diagnostic(JSON.stringify({ boundary, uploadedObjects: 1, editPublication: false, orphanCleanupClaim: false, freshTargetId: persisted.id }));
  } finally { release.resolve(); await pending; }
});

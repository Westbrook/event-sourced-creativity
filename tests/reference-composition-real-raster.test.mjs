import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { fileURLToPath } from "node:url";
import { createReferenceRaster } from "./helpers/reference-composition-native-raster.mjs";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, disposeSceneStoreResolution } from "./helpers/scene-cost-store-host.mjs";
import { outputTestDatabase } from "./output-server-test-helpers.mjs";
import { png } from "./output-asset-fixtures.mjs";
import { appendAuditEvent } from "../worker/runtime.ts";
import { synchronizeProjectScope } from "../worker/project-access.ts";
import { withDocumentInRoute } from "../src/model/routes.ts";
import { createReferenceComposition, addReferenceCompositionLayer } from "../src/model/reference-composition.ts";

// The accepted finite RAM fixture supplies authored synthetic source PNGs and
// an explicitly synthetic old target. The edited output below is produced only
// by the native production compositor and decoded again after private readback.
// This is reference-block persistence, not a generated Image replacement or a
// numbered DocumentArtifact revision; no provider/review/export is exercised.
after(disposeSceneStoreResolution);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceId = "reference-persistence-source", targetId = "reference-persistence-target";
const label = "Café 雨 — edited reference 🌱";
const paidTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters", "output_execution_grants", "output_operation_slots", "output_provider_calls"];
const properties = (media, referenceId, text, recipe) => ({ label: text, subtype: recipe ? "Composition" : "Image", reference_id: referenceId,
  media_url: media.url, media_type: "image/png", source_mime_type: "image/png", source_content_hash: media.contentHash,
  pixel_reference_mode: recipe ? "preserve_composition" : "context_only", extraction_status: "unavailable", ...(recipe ? { reference_composition: recipe } : {}) });

function sourcePng(width, height) {
  const stride = width * 4 + 1, raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    raw.set(x < width * 0.4 ? [40, 90, 180, 255] : [30, 160, 100, 255], y * stride + 1 + x * 4);
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
  const sourceBytes = sourcePng(24, 24), sourceMedia = await upload(sourceBytes);
  await seedReference(sourceId, sourceMedia);
  const source = { id: sourceId + ":image", blockId: sourceId, label: sourceId, mediaUrl: sourceMedia.url, contentHash: sourceMedia.contentHash, kind: "image" };
  const recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "retained-image-layer");
  const originalBytes = sourcePng(recipe.width, recipe.height), originalMedia = await upload(originalBytes, recipe);
  await seedReference(targetId, originalMedia, recipe);
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
  const readPng = async (media, expected) => {
    const response = await f.request(media.url); assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await response.arrayBuffer()); assert.deepEqual(bytes, expected); assert.equal(hash(bytes), media.contentHash);
    return { data: bytes, bytes: bytes.byteLength, sha256: hash(bytes), width: new DataView(bytes.buffer).getUint32(16), height: new DataView(bytes.buffer).getUint32(20) };
  };
  return { f, storage, requests, responses, history, mediaState, open, target, recipe, sourceMedia, sourceBytes, originalMedia, originalBytes, readPng };
}

// Fixed analytic interior points, independent of the production rectangle helper.
// A 24-square source at scale50 covers a 432-square region on a 1536x864 board.
// x40/x60 placements overlap; the second layer paints blue at half opacity over
// the first layer's green. Background and fully opaque interiors are exact.
const pixelCases = [
  { x: 450, y: 300, rgba: [40, 90, 180, 255], tolerance: 0, name: "opaque blue" },
  { x: 650, y: 300, rgba: [30, 160, 100, 255], tolerance: 0, name: "opaque green" },
  { x: 750, y: 300, rgba: [35, 125, 140, 255], tolerance: 1, name: "upper blue over lower green" },
  { x: 1050, y: 300, rgba: [143, 208, 178, 255], tolerance: 1, name: "half-opacity green over white" },
  { x: 100, y: 100, rgba: [255, 255, 255, 255], tolerance: 0, name: "outside white background" },
  { x: 350, y: 300, rgba: [255, 255, 255, 255], tolerance: 0, name: "outside requested horizontal scale" },
  { x: 650, y: 200, rgba: [255, 255, 255, 255], tolerance: 0, name: "outside requested vertical scale" },
];
const samplePoints = pixelCases.map(({ x, y }) => ({ x, y }));
function assertRasterPixels(raster) {
  assert.equal(raster.width, 1536); assert.equal(raster.height, 864);
  assert.deepEqual(raster.pixels.map(({ x, y }) => ({ x, y })), samplePoints);
  for (const [index, expected] of pixelCases.entries()) {
    const actual = raster.pixels[index].rgba;
    assert.equal(actual.length, 4, expected.name);
    assert.ok(actual.every(value => Number.isInteger(value) && value >= 0 && value <= 255), expected.name);
    assert.equal(actual[3], 255, expected.name + " remains opaque");
    for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(actual[channel] - expected.rgba[channel]) <= expected.tolerance,
      `${expected.name} channel ${channel}: ${actual[channel]} expected ${expected.rgba[channel]} ±${expected.tolerance}`);
  }
}

test("native reference raster persists through the exact Worker ACK and fresh Store/private pixel readback", { timeout: 60_000 }, async t => {
  const f = await fixture(t), first = await f.open();
  const initialHistory = f.history(), initialTarget = structuredClone(f.target(first)), initialMedia = structuredClone(f.mediaState());
  const recipe = addReferenceCompositionLayer(structuredClone(f.recipe), f.recipe.sources[0], "edited-image-layer");
  recipe.layers[0] = { ...recipe.layers[0], x: 40, y: 50, scale: 50, opacity: 100 };
  recipe.layers[1] = { ...recipe.layers[1], x: 60, y: 50, scale: 50, opacity: 50 };
  assert.deepEqual(recipe.sources, f.recipe.sources);
  assert.equal(recipe.sources.length, 1); assert.equal(recipe.layers.length, 2);
  assert.deepEqual(recipe.layers.map(layer => layer.sourceId), [f.recipe.sources[0].id, f.recipe.sources[0].id]);
  const raster = await createReferenceRaster(t, { sourceRoot: fileURLToPath(new URL("../", import.meta.url)),
    request: (path, init) => f.f.request(path, init) });
  try {
    const staleRecipe = structuredClone(recipe); staleRecipe.sources[0].contentHash = "a".repeat(64);
    assert.notEqual(staleRecipe.sources[0].contentHash, f.sourceMedia.contentHash);
    const staleStart = f.requests.length;
    await assert.rejects(raster.render(staleRecipe, samplePoints), /hashMismatch/);
    const staleReads = f.requests.slice(staleStart);
    assert.ok(staleReads.some(row => row.method === "GET" && row.url === f.sourceMedia.url), "the real source read precedes hash refusal");
    assert.ok(staleReads.every(row => row.method === "GET" && row.url.startsWith("/api/media/")), "hash refusal has no upload/event write");
    assert.deepEqual(f.history(), initialHistory); assert.deepEqual(f.mediaState(), initialMedia);
    assert.deepEqual(f.target(first), initialTarget);

    const renderStart = f.requests.length, rendered = await raster.render(recipe, samplePoints);
    assertRasterPixels(rendered);
    assert.ok(rendered.blob instanceof NodeBlob); assert.equal(rendered.blob.type, "image/png");
    assert.ok(rendered.bytes instanceof Uint8Array);
    assert.deepEqual(new Uint8Array(await rendered.blob.arrayBuffer()), rendered.bytes);
    const reads = f.requests.slice(renderStart);
    assert.ok(reads.some(row => row.method === "GET" && row.url === f.sourceMedia.url));
    assert.ok(reads.every(row => row.method === "GET" && row.url.startsWith("/api/media/")));
    assert.deepEqual(f.history(), initialHistory); assert.deepEqual(f.mediaState(), initialMedia);
    assert.deepEqual(f.target(first), initialTarget);
    const capture = { blob: rendered.blob, recipe, label, targetBlockId: targetId };
    const requestStart = f.requests.length, responseStart = f.responses.length, mediaCount = f.storage.media.size;
    assert.equal(await first.store.saveReferenceComposition(capture), true);
    const updated = f.target(first), newProperties = updated.properties, rasterHash = hash(rendered.bytes);
    assert.equal(updated.id, initialTarget.id); assert.equal(newProperties.label, label);
    assert.deepEqual(newProperties.reference_composition, recipe);
    assert.deepEqual(newProperties.reference_composition.sources, f.recipe.sources);
    assert.notEqual(newProperties.media_url, f.originalMedia.url);
    assert.notEqual(newProperties.source_content_hash, f.originalMedia.contentHash);
    assert.equal(newProperties.source_content_hash, rasterHash);
    assert.equal(f.storage.media.size, mediaCount + 1);
    assert.deepEqual(f.requests.slice(requestStart).filter(row => row.method === "POST").map(row => row.url), ["/api/media", "/api/events"]);
    const acknowledgement = f.responses.slice(responseStart).find(row => row.method === "POST" && row.url === "/api/events");
    assert.equal(acknowledgement.status, 200); assert.ok(Array.isArray(acknowledgement.body.appended));
    assert.equal(acknowledgement.body.appended.length, 12);
    assert.deepEqual(acknowledgement.body.appended.map(event => event.type), ["ReferenceIngested", "RightsAsserted", ...Array(10).fill("BlockPropertyEdited")]);
    for (const event of acknowledgement.body.appended.slice(2)) assert.equal(event.payload.block_id, targetId);
    const afterHistory = f.history();
    for (const row of initialHistory) assert.deepEqual(afterHistory.find(value => value.event_id === row.event_id), row);
    assert.equal(afterHistory.length, initialHistory.length + 12);
    const stored = f.storage.media.get(decodeURIComponent(newProperties.media_url.slice("/api/media/".length)));
    assert.deepEqual(stored.bytes, rendered.bytes);
    assert.equal(stored.metadata.referenceCompositionVersion, "1");
    assert.equal(stored.metadata.referenceCompositionSha256, hash(JSON.stringify(recipe)));
    for (const original of initialMedia) assert.deepEqual(f.mediaState().find(row => row.key === original.key), original);
    await first.close();
    const second = await f.open();
    assert.notEqual(first.store, second.store); assert.notEqual(first.modules, second.modules);
    assert.notEqual(f.target(second), updated); assert.deepEqual(f.target(second), updated);
    assert.deepEqual(f.history(), afterHistory);
    const file = await f.readPng({ url: newProperties.media_url, contentHash: newProperties.source_content_hash }, rendered.bytes);
    assert.deepEqual({ width: file.width, height: file.height }, { width: recipe.width, height: recipe.height });
    const readback = await raster.inspect(file.data, samplePoints);
    assertRasterPixels(readback); assert.deepEqual(readback.pixels, rendered.pixels);
    assert.equal(file.sha256, rasterHash);
    await f.readPng(f.originalMedia, f.originalBytes); await f.readPng(f.sourceMedia, f.sourceBytes);
    assert.deepEqual(f.history(), afterHistory);
    for (const original of initialMedia) assert.deepEqual(f.mediaState().find(row => row.key === original.key), original);
    t.diagnostic(JSON.stringify({ proof: "native-reference-raster-persisted-edit", targetId, eventsAppended: 12,
      file: { bytes: file.bytes, sha256: file.sha256, width: file.width, height: file.height }, pixels: readback.pixels,
      sourcePins: rendered.sourcePins, nativeFile: rendered.file, native: raster.native, browserVersion: raster.browserVersion, executable: raster.executable,
      freshStore: true, originalMediaUnchanged: true, syntheticInputAndOldTarget: true,
      editedRasterFromNativeProductionCompositor: true, staleHashReadRefused: true, documentArtifactRevision: false,
      productionStalledReadCancellationClaim: false }));
  } finally { await raster.close(); }
});

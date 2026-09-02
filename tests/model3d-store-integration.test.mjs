import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { DEFAULT_MODEL3D_SETTINGS, RODIN_PROMPT_MAX_CHARS } from "../src/model/model3d.ts";
import { model3dPresetView } from "../src/model/model3d-view.ts";
import { addReferenceCompositionLayer, createReferenceComposition, referenceCompositionSources } from "../src/model/reference-composition.ts";
import { withDocumentInRoute } from "../src/model/routes.ts";

// The complete production Store, generation queue, append receipts and source ownership
// are exercised through the established Store host. Only DOM, timers and HTTP are ports;
// these synthetic receipts certify Store behavior, not Worker/media custody or rendering.
const OWNER = "model3d-store-owner";
const PROJECT = "model3d-store-project";
const DOCUMENT = "model3d-store-document";
const OTHER_DOCUMENT = "model3d-store-other-document";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=", "base64");
const hash = value => createHash("sha256").update(value).digest("hex");
const png = () => new Blob([PNG], { type: "image/png" });
const mediaUrl = name => `/api/media/${encodeURIComponent(`${OWNER}/uploads/${name}`)}`;
const mediaResponse = () => Response.json({ url: mediaUrl("saved.png"), contentHash: hash(PNG), mimeType: "image/png" });
const OPTIONS = { concurrency: false, timeout: 20_000 };

function triangleGlb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }], buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }] }));
  const length = Math.ceil(json.length / 4) * 4;
  const bytes = Buffer.alloc(12 + 8 + length + 8 + 36);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); bytes.fill(0x20, 20, 20 + length); json.copy(bytes, 20);
  bytes.writeUInt32LE(36, 20 + length); bytes.writeUInt32LE(0x004e4942, 24 + length);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => bytes.writeFloatLE(value, 28 + length + index * 4));
  return bytes;
}
const modelFile = () => new File([triangleGlb()], "sculpture.glb", { type: "model/gltf-binary" });

function fixtureTransport() {
  const events = [];
  let mediaSequence = 0, jobSequence = 0;
  const session = { user: { userId: OWNER, email: "model3d@example.test", displayName: "Model author", role: "creator" },
    impersonation: null, policy: { version: "fixture-policy", accepted: true }, permissionEpoch: "fixture-epoch",
    capabilities: ["project.read", "project.author", "project.output.request"], provider: { model3dConfigured: true } };
  const append = inputs => inputs.map(input => {
    const sequence = events.length + 1;
    const event = { ...structuredClone(input), eventId: `fixture-event-${sequence}`, sequence, streamId: `creative:${OWNER}`,
      occurredAt: "2026-08-31T12:00:00.000Z", recordedAt: "2026-08-31T12:00:00.000Z", actor: "user", clientId: "store-fixture",
      correlationId: `fixture-correlation-${sequence}`, causationId: null, compensatesEventId: input.compensatesEventId ?? null, schemaVersion: 1 };
    events.push(event); return event;
  });
  append([
    { type: "ProjectCreated", payload: { project_id: PROJECT, name: "3D fixtures" } },
    { type: "DocumentCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, title: "3D fixture" } },
    { type: "DocumentCreated", payload: { project_id: PROJECT, document_id: OTHER_DOCUMENT, title: "Other fixture" } },
    { type: "BlockCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, block_id: "direction", type: "direction", handle: "direction/subject", position: "a", properties: { text: "A ceramic bird sculpture.", weight: 1 } } },
  ]);
  for (const [index, id] of ["image-a", "image-b", "image-unselected", "model-a"].entries()) {
    const model = id === "model-a", referenceId = `reference-${id}`, url = mediaUrl(`${id}.png`), contentHash = hash(id);
    append([
      { type: "ReferenceIngested", payload: { reference_id: referenceId, source_ref: url, content_hash: contentHash, source_mime_type: "image/png", rights_class: "asserted" } },
      { type: "RightsAsserted", payload: { reference_id: referenceId, rights_class: "owned_or_licensed" } },
      { type: "BlockCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, block_id: id, type: model ? "model3d" : "reference", handle: `${model ? "model3d" : "reference"}/${id}`, position: `b${index}`,
        properties: { label: id, text: "Ceramic subject reference", reference_id: referenceId, media_url: url, media_type: "image/png", source_mime_type: "image/png",
          source_content_hash: contentHash, rights_class: "owned_or_licensed", weight: .8, intent: "include", pixel_reference_mode: "preserve_subject",
          ...(model ? { model_url: mediaUrl("model-a.glb"), model_content_hash: hash(triangleGlb()), model_mime_type: "model/gltf-binary", model_view: model3dPresetView("front") } : {}) } } },
    ]);
  }
  const request = async (url, init = {}) => {
    if (url === "/api/session") return Response.json(session);
    if (url.startsWith("/api/events?") && (!init.method || init.method === "GET")) return Response.json({ events, head: events.length, content: {} });
    if (url === "/api/media" && init.method === "POST") {
      const file = init.body.get("file"), bytes = new Uint8Array(await file.arrayBuffer());
      return Response.json({ url: mediaUrl(`uploaded-${++mediaSequence}.${file.type === "image/png" ? "png" : "glb"}`), contentHash: hash(bytes), mimeType: file.type });
    }
    if (url === "/api/events" && init.method === "POST") {
      const body = JSON.parse(init.body), appended = append(body.events);
      return Response.json({ appended, rejected: [], head: events.length });
    }
    if (url === "/api/document-jobs" && init.method === "POST") {
      const body = JSON.parse(init.body);
      return Response.json({ job: { jobId: `model3d-job-${++jobSequence}`, kind: body.kind, documentId: body.documentId,
        requestKey: body.payload.requestKey, status: "queued", requestedAt: "2026-08-31T12:00:00.000Z", result: { artifactKind: "model3d" } } });
    }
    assert.fail(`Unexpected fixture HTTP request ${init.method ?? "GET"} ${url}`);
  };
  return { owner: OWNER, projectId: PROJECT, documentId: DOCUMENT, requestId: "unused-scene-request", payload: {}, events, request, append, close() {} };
}

async function host(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No provider or external transport is permitted in Store 3D tests"));
  const transport = fixtureTransport();
  const h = await createSceneStoreHost({ workerFixture: transport, exposeSceneTestAccessors: true });
  t.after(() => h.close());
  h.store.route.set(withDocumentInRoute("/", DOCUMENT, "3D fixture"));
  h.store.loading.set(false);
  h.publish = inputs => { transport.append(inputs); h.store.events.set([...transport.events]); h.store.head.set(transport.events.length); };
  h.change = (blockId, property, value) => h.publish([{ type: "BlockPropertyEdited", payload: { block_id: blockId, document_id: DOCUMENT, property_path: property, new_value: value } }]);
  h.block = id => h.store.projection.get().libraryBlocks.find(block => block.id === id);
  h.appendRequests = () => h.requests.filter(row => row.url === "/api/events" && row.init.method === "POST");
  h.mediaRequests = () => h.requests.filter(row => row.url === "/api/media");
  h.jobRequests = () => h.requests.filter(row => row.url === "/api/document-jobs" && row.init.method === "POST");
  h.depart = kind => {
    if (kind === "document") h.store.route.set(withDocumentInRoute("/", OTHER_DOCUMENT, "Other fixture"));
    else h.store.session.set({ ...h.store.session.get(), user: { ...h.store.session.get().user, userId: "another-account" } });
  };
  h.recipe = (ids = ["model-a", "image-a"]) => {
    const sources = referenceCompositionSources(h.store.projection.get().blocks, h.store.events.get());
    assert.ok(["image-a", "image-b", "image-unselected", "model-a"].every(id => sources.some(source => source.blockId === id)), "all four current rights-backed image/view fixtures are available");
    return ids.reduce((recipe, id, index) => addReferenceCompositionLayer(recipe, sources.find(source => source.blockId === id), `layer-${index}`), createReferenceComposition("16:9"));
  };
  h.view = () => ({ blob: png(), view: model3dPresetView("left", "transparent"), src: h.block("model-a").properties.model_url });
  h.render = (options = {}) => h.store.renderDocumentArtifact("model3d", { model3dPrompt: "A ceramic bird.", model3dSettings: structuredClone(DEFAULT_MODEL3D_SETTINGS), model3dReferenceBlockIds: [], paidMediaConfirmed: true, ...options });
  return h;
}

test("3D Store upload requires explicit rights and valid GLB bytes before upload or append", OPTIONS, async t => {
  const h = await host(t), file = modelFile();
  const read = t.mock.method(file, "arrayBuffer", async () => assert.fail("Unconfirmed file bytes must not be read"));
  for (const options of [{}, { rightsConfirmed: false }]) assert.equal(await h.store.uploadModel3dFile(file, () => true, options), false);
  read.mock.restore();
  assert.equal(await h.store.uploadModel3dFile(new File(["not a model"], "wrong.glb", { type: "model/gltf-binary" }), () => true, { rightsConfirmed: true }), false);
  assert.match(h.store.ui.toast, /GLB|model/i);
  assert.equal(await h.store.uploadModel3dFile(file, () => false, { rightsConfirmed: true }), false);
  assert.equal(h.requests.length, 0);
});

test("3D Store valid upload creates a model-only context with explicit rights and no automatic image view", OPTIONS, async t => {
  const h = await host(t);
  assert.equal(await h.store.uploadModel3dFile(modelFile(), () => true, { documentId: DOCUMENT, rightsConfirmed: true }), true, h.store.ui.toast);
  assert.equal(h.mediaRequests().length, 1); assert.equal(h.appendRequests().length, 1);
  const form = h.mediaRequests()[0].init.body;
  assert.equal(form.get("rightsConfirmed"), "true"); assert.equal(form.get("nonSensitiveConfirmed"), "true");
  const changes = h.appendRequests()[0].body.events;
  assert.deepEqual(changes.map(event => event.type), ["ReferenceIngested", "RightsAsserted", "BlockCreated"]);
  const created = changes[2].payload, block = h.block(created.block_id);
  assert.equal(created.document_id, DOCUMENT); assert.equal(block.type, "model3d");
  assert.equal(block.properties.model_content_hash, hash(triangleGlb()));
  assert.equal(block.properties.pixel_reference_mode, "context_only"); assert.equal(block.properties.media_url, undefined);
  assert.equal(h.store.ui.focusBlockId, block.id); assert.equal(h.store.ui.editingBlockId, block.id);
});

for (const kind of ["document", "account"]) test(`3D Store upload withholds late media after ${kind} changes`, OPTIONS, async t => {
  const h = await host(t), gate = sceneDeferred();
  h.intercept = request => request.url === "/api/media" ? gate.promise : undefined;
  const pending = h.store.uploadModel3dFile(modelFile(), () => true, { rightsConfirmed: true });
  await untilScene(() => h.mediaRequests().length === 1);
  const before = h.store.events.get(); h.depart(kind); gate.resolve(mediaResponse());
  assert.equal(await pending, false); assert.equal(h.appendRequests().length, 0);
  assert.equal(h.store.events.get(), before); assert.equal(h.store.ui.focusBlockId, "");
});

test("3D Store view capture sends the exact camera/source binding and writes its PNG to the existing block", OPTIONS, async t => {
  const h = await host(t), capture = h.view(), original = h.block("model-a").properties;
  assert.equal(await h.store.saveModel3dView("model-a", capture), true, h.store.ui.toast);
  const form = h.mediaRequests()[0].init.body, edits = h.appendRequests()[0].body.events.filter(event => event.type === "BlockPropertyEdited");
  assert.equal(form.get("modelUrl"), capture.src); assert.equal(form.get("modelContentHash"), original.model_content_hash);
  assert.deepEqual(JSON.parse(form.get("modelView")), capture.view);
  assert.ok(edits.length > 0 && edits.every(event => event.payload.block_id === "model-a"));
  assert.equal(h.appendRequests()[0].body.events.some(event => event.type === "BlockCreated"), false);
  assert.deepEqual(h.block("model-a").properties.model_view, capture.view);
  assert.equal(h.block("model-a").properties.model_url, original.model_url);
  assert.equal(h.block("model-a").properties.source_content_hash, hash(PNG));
});

test("3D Store freezes the captured camera so its saved event matches the uploaded PNG proof", OPTIONS, async t => {
  const h = await host(t), gate = sceneDeferred(), capture = h.view(), reviewedView = structuredClone(capture.view);
  h.intercept = request => request.url === "/api/media" ? gate.promise : undefined;
  const pending = h.store.saveModel3dView("model-a", capture);
  await untilScene(() => h.mediaRequests().length === 1);
  assert.deepEqual(JSON.parse(h.mediaRequests()[0].init.body.get("modelView")), reviewedView);
  capture.view.position[0] = 2; capture.view.background = "#ffffff";
  gate.resolve(mediaResponse()); assert.equal(await pending, true, h.store.ui.toast);
  assert.deepEqual(h.block("model-a").properties.model_view, reviewedView);
});

for (const change of ["model_url", "model_content_hash", "media_url", "document", "account", "closed"]) {
  test(`3D Store view capture cannot attach its late PNG after ${change} changes`, OPTIONS, async t => {
    const h = await host(t), gate = sceneDeferred(); let open = true;
    h.intercept = request => request.url === "/api/media" ? gate.promise : undefined;
    const pending = h.store.saveModel3dView("model-a", h.view(), () => open);
    await untilScene(() => h.mediaRequests().length === 1);
    if (["document", "account"].includes(change)) h.depart(change);
    else if (change === "closed") open = false;
    else h.change("model-a", change, change === "model_content_hash" ? hash("replacement-model") : mediaUrl(`replacement-${change}.png`));
    const before = h.store.events.get(); gate.resolve(mediaResponse());
    assert.equal(await pending, false); assert.equal(h.appendRequests().length, 0); assert.equal(h.store.events.get(), before);
  });
}

test("3D Store composition replaces only exact selected parents and retains the reviewed recipe", OPTIONS, async t => {
  const h = await host(t), recipe = h.recipe();
  assert.equal(await h.store.saveReferenceComposition({ blob: png(), recipe, label: "  Reviewed scene  " }), true, h.store.ui.toast);
  const form = h.mediaRequests()[0].init.body, changes = h.appendRequests()[0].body.events;
  assert.deepEqual(JSON.parse(form.get("referenceComposition")), recipe);
  const edits = changes.filter(event => event.type === "BlockPropertyEdited");
  assert.deepEqual(edits.map(event => event.payload.block_id), ["model-a", "image-a"]);
  assert.ok(edits.every(event => event.payload.property_path === "pixel_reference_mode" && event.payload.new_value === "context_only"));
  assert.equal(h.block("image-b").properties.pixel_reference_mode, "preserve_subject");
  assert.equal(h.block("image-unselected").properties.pixel_reference_mode, "preserve_subject");
  const created = changes.find(event => event.type === "BlockCreated").payload, block = h.block(created.block_id);
  assert.equal(block.properties.label, "Reviewed scene"); assert.equal(block.properties.pixel_reference_mode, "preserve_composition");
  assert.deepEqual(block.properties.reference_composition, recipe); assert.equal(h.store.ui.focusBlockId, block.id);
});

test("3D Store empty, stale and non-PNG compositions do not upload or mutate source modes", OPTIONS, async t => {
  const h = await host(t), recipe = h.recipe(), stale = structuredClone(recipe); stale.sources[0].contentHash = hash("changed");
  for (const capture of [{ blob: png(), recipe: createReferenceComposition(), label: "empty" }, { blob: png(), recipe: stale, label: "stale" },
    { blob: new Blob([PNG], { type: "image/jpeg" }), recipe, label: "wrong type" }]) assert.equal(await h.store.saveReferenceComposition(capture), false);
  assert.equal(h.requests.length, 0); assert.equal(h.block("model-a").properties.pixel_reference_mode, "preserve_subject");
});

for (const change of ["selected-media", "selected-hash", "rights", "document", "account", "closed"]) {
  test(`3D Store composition withholds asynchronous save after ${change} changes`, OPTIONS, async t => {
    const h = await host(t), gate = sceneDeferred(), recipe = h.recipe(); let open = true;
    h.intercept = request => request.url === "/api/media" ? gate.promise : undefined;
    const pending = h.store.saveReferenceComposition({ blob: png(), recipe, label: "Reviewed scene" }, () => open);
    await untilScene(() => h.mediaRequests().length === 1);
    if (["document", "account"].includes(change)) h.depart(change);
    else if (change === "closed") open = false;
    else if (change === "rights") h.publish([{ type: "RightsAsserted", payload: { reference_id: "reference-image-a", rights_class: "revoked" } }]);
    else h.change("image-a", change === "selected-media" ? "media_url" : "source_content_hash", change === "selected-media" ? mediaUrl("replacement.png") : hash("replacement"));
    const before = h.store.events.get(); gate.resolve(mediaResponse());
    assert.equal(await pending, false); assert.equal(h.appendRequests().length, 0); assert.equal(h.store.events.get(), before);
    assert.equal(h.block("image-a").properties.pixel_reference_mode, "preserve_subject"); assert.equal(h.store.ui.focusBlockId, "");
  });
}

test("3D Store unrelated reference changes do not cancel an exact composition or disable that other reference", OPTIONS, async t => {
  const h = await host(t), gate = sceneDeferred(), recipe = h.recipe();
  h.intercept = request => request.url === "/api/media" ? gate.promise : undefined;
  const pending = h.store.saveReferenceComposition({ blob: png(), recipe, label: "Selected sources only" });
  await untilScene(() => h.mediaRequests().length === 1);
  h.change("image-unselected", "media_url", mediaUrl("unrelated-new.png")); gate.resolve(mediaResponse());
  assert.equal(await pending, true, h.store.ui.toast);
  assert.equal(h.block("image-unselected").properties.pixel_reference_mode, "preserve_subject");
});

async function savedComposition(h) {
  const recipe = h.recipe();
  assert.equal(await h.store.saveReferenceComposition({ blob: png(), recipe, label: "Initial scene" }), true, h.store.ui.toast);
  const block = h.store.projection.get().blocks.find(block => block.properties.reference_composition);
  assert.ok(block); h.requests.length = 0;
  return block;
}

test("3D Store editing a saved composition updates its existing context and receipts without duplicating the block", OPTIONS, async t => {
  const h = await host(t), original = await savedComposition(h), beforeCount = h.store.projection.get().libraryBlocks.length;
  const recipe = h.recipe(); recipe.layers[0].x = 24;
  assert.equal(await h.store.saveReferenceComposition({ targetBlockId: original.id, blob: png(), recipe, label: "Reframed scene" }), true, h.store.ui.toast);
  assert.equal(h.mediaRequests().length, 1); assert.equal(h.appendRequests().length, 1);
  const events = h.appendRequests()[0].body.events, updated = h.block(original.id);
  assert.equal(events.some(event => event.type === "BlockCreated"), false);
  assert.equal(h.store.projection.get().libraryBlocks.length, beforeCount);
  assert.equal(updated.properties.label, "Reframed scene"); assert.deepEqual(updated.properties.reference_composition, recipe);
  assert.notEqual(updated.properties.reference_id, original.properties.reference_id);
  assert.notEqual(updated.properties.media_url, original.properties.media_url);
  assert.equal(events.filter(event => event.type === "ReferenceIngested").length, 1);
  assert.equal(events.filter(event => event.type === "RightsAsserted").length, 1);
  assert.ok(events.filter(event => event.type === "BlockPropertyEdited").every(event => event.payload.block_id === original.id));
  assert.equal(h.store.ui.focusBlockId, original.id);
});

test("3D Store composition editing rejects missing, non-composition and locked targets before upload", OPTIONS, async t => {
  const h = await host(t), target = await savedComposition(h), recipe = h.recipe();
  for (const targetBlockId of ["missing", "image-a", "model-a"])
    assert.equal(await h.store.saveReferenceComposition({ targetBlockId, blob: png(), recipe, label: "Wrong target" }), false);
  h.publish([{ type: "BlockLocked", payload: { block_id: target.id, document_id: DOCUMENT } }]);
  assert.equal(await h.store.saveReferenceComposition({ targetBlockId: target.id, blob: png(), recipe, label: "Locked target" }), false);
  assert.equal(h.requests.length, 0); assert.equal(h.block(target.id).properties.label, "Initial scene");
});

for (const change of ["media_url", "reference_composition", "locked", "removed"]) test(`3D Store composition editing refuses a late image after the target ${change} changes`, OPTIONS, async t => {
  const h = await host(t), target = await savedComposition(h), gate = sceneDeferred(), recipe = h.recipe(); recipe.layers[0].x = 20;
  h.intercept = request => request.url === "/api/media" ? gate.promise : undefined;
  const pending = h.store.saveReferenceComposition({ targetBlockId: target.id, blob: png(), recipe, label: "Late target change" });
  await untilScene(() => h.mediaRequests().length === 1);
  if (change === "locked" || change === "removed") h.publish([{ type: change === "locked" ? "BlockLocked" : "BlockRemoved", payload: { block_id: target.id, document_id: DOCUMENT } }]);
  else h.change(target.id, change, change === "media_url" ? mediaUrl("changed-composition.png") : { ...recipe, background: "#171717" });
  const before = h.store.events.get(); gate.resolve(mediaResponse());
  assert.equal(await pending, false); assert.equal(h.appendRequests().length, 0); assert.equal(h.store.events.get(), before);
});

test("3D Store composition cannot change the visual mode of a locked selected parent", OPTIONS, async t => {
  const h = await host(t), recipe = h.recipe();
  h.publish([{ type: "BlockLocked", payload: { block_id: "image-a", document_id: DOCUMENT } }]);
  assert.equal(await h.store.saveReferenceComposition({ blob: png(), recipe, label: "Locked parent" }), false);
  assert.equal(h.requests.length, 0); assert.equal(h.block("image-a").properties.pixel_reference_mode, "preserve_subject");
  h.change("image-a", "pixel_reference_mode", "context_only");
  assert.equal(await h.store.saveReferenceComposition({ blob: png(), recipe, label: "Already describe-only parent" }), true, h.store.ui.toast);
  assert.ok(h.appendRequests()[0].body.events.every(event => event.type !== "BlockPropertyEdited" || event.payload.block_id !== "image-a"));
});

for (const operation of ["view", "composition"]) test(`3D Store ${operation} late event acknowledgment does not publish after its selected source changes`, OPTIONS, async t => {
  const h = await host(t), entered = sceneDeferred(), response = sceneDeferred();
  h.intercept = request => {
    if (request.url !== "/api/events") return undefined;
    const reply = h.worker.request(request.url, request.init);
    entered.resolve(); return response.promise.then(() => reply);
  };
  const pending = operation === "view" ? h.store.saveModel3dView("model-a", h.view())
    : h.store.saveReferenceComposition({ blob: png(), recipe: h.recipe(), label: "Late receipt" });
  await entered.promise;
  // A newer source can arrive independently while the original server append remains unobserved.
  const originalEvents = h.store.events.get(), originalHead = h.store.head.get();
  const replacement = { ...structuredClone(originalEvents.find(event => event.type === "BlockCreated" && event.payload.block_id === "model-a")),
    eventId: "independent-replacement", sequence: originalHead + 1, type: "BlockPropertyEdited",
    payload: { block_id: "model-a", document_id: DOCUMENT, property_path: operation === "view" ? "model_content_hash" : "source_content_hash", new_value: hash("new-source") } };
  h.store.events.set([...originalEvents, replacement]); h.store.head.set(originalHead + 1);
  const before = h.store.events.get(); response.resolve();
  assert.equal(await pending, false); assert.equal(h.store.events.get(), before);
  assert.equal(h.store.ui.focusBlockId, ""); assert.equal(h.appendRequests().length, 1);
});

test("3D Store generation rejects missing consent, overlong text, unsupported settings and invalid references before any queue request", OPTIONS, async t => {
  const h = await host(t);
  const invalid = [{ paidMediaConfirmed: false }, { model3dPrompt: "x".repeat(RODIN_PROMPT_MAX_CHARS + 1) },
    { model3dSettings: { ...DEFAULT_MODEL3D_SETTINGS, nonexistent_parameter: true } },
    { model3dReferenceBlockIds: ["image-a", "image-a"] }, { model3dReferenceBlockIds: ["missing"] }, { current: () => false }];
  for (const options of invalid) assert.equal(await h.render(options), false);
  h.change("model-a", "media_url", null);
  assert.equal(await h.render({ model3dReferenceBlockIds: ["model-a"] }), false);
  h.change("image-a", "pixel_reference_mode", "context_only");
  assert.equal(await h.render({ model3dReferenceBlockIds: ["image-a"] }), false);
  assert.equal(h.requests.length, 0); assert.deepEqual(h.store.documentJobs.get(), []);
});

test("3D Store queue preserves exact prompt, settings and ordered selected references, with one dispatch callback", OPTIONS, async t => {
  const h = await host(t), prompt = "  A ceramic bird — 鳥 🐦\nKeep its asymmetric glaze.  ";
  const settings = { ...structuredClone(DEFAULT_MODEL3D_SETTINGS), seed: 42, texture_mode: "high", preview_render: true, bbox_condition: { width: 200, height: 300, length: 100 } };
  const ids = ["image-b", "model-a", "image-a"]; let dispatches = 0;
  assert.equal(await h.render({ model3dPrompt: prompt, model3dSettings: settings, model3dReferenceBlockIds: ids, onDispatch: () => { dispatches++; } }), true, h.store.ui.toast);
  assert.equal(dispatches, 1); assert.equal(h.jobRequests().length, 1);
  const request = h.jobRequests()[0].body;
  assert.equal(request.documentId, DOCUMENT); assert.equal(request.kind, "render_document");
  assert.equal(request.payload.artifactKind, "model3d"); assert.equal(request.payload.productionMode, "manual");
  assert.equal(request.payload.model3dPrompt, prompt); assert.deepEqual(request.payload.model3dSettings, settings);
  assert.deepEqual(request.payload.model3dReferenceBlockIds, ids); assert.equal(request.payload.paidMediaConfirmed, true);
  assert.equal(h.appendRequests().length, 0); assert.equal(h.mediaRequests().length, 0);
  assert.equal(await h.render({ model3dPrompt: prompt, model3dSettings: settings, model3dReferenceBlockIds: ids, onDispatch: () => { dispatches++; } }), true);
  assert.equal(dispatches, 1); assert.equal(h.jobRequests().length, 1, "the identical in-progress job is reused");
  assert.equal(await h.render({ model3dPrompt: prompt, model3dSettings: settings, model3dReferenceBlockIds: [...ids].reverse() }), true);
  assert.equal(h.jobRequests().length, 2); assert.notEqual(h.jobRequests()[1].body.payload.requestKey, request.payload.requestKey, "changing material-guidance reference order changes request identity");
});

test("3D Store freezes reviewed nested settings and reference order before an asynchronous queue wait", OPTIONS, async t => {
  const h = await host(t), gate = sceneDeferred();
  const settings = { ...structuredClone(DEFAULT_MODEL3D_SETTINGS), bbox_condition: { width: 100, height: 200, length: 300 } };
  const reviewed = structuredClone(settings), ids = ["image-b", "image-a"];
  h.store.sceneGateForTest("append", gate.promise);
  const pending = h.render({ model3dSettings: settings, model3dReferenceBlockIds: ids });
  settings.bbox_condition.width = 99_999; settings.addons.high_pack = true; ids.reverse();
  gate.resolve(); assert.equal(await pending, true, h.store.ui.toast);
  assert.deepEqual(h.jobRequests()[0].body.payload.model3dSettings, reviewed);
  assert.deepEqual(h.jobRequests()[0].body.payload.model3dReferenceBlockIds, ["image-b", "image-a"]);
});

for (const change of ["document", "account", "closed"]) test(`3D Store generation does not dispatch after ${change} changes while waiting for append completion`, OPTIONS, async t => {
  const h = await host(t), gate = sceneDeferred(); let open = true, dispatches = 0;
  h.store.sceneGateForTest("append", gate.promise);
  const pending = h.render({ current: () => open, onDispatch: () => { dispatches++; } });
  if (change === "closed") open = false; else h.depart(change);
  gate.resolve(); assert.equal(await pending, false); assert.equal(dispatches, 0); assert.equal(h.requests.length, 0);
});

for (const change of ["document", "account", "closed"]) test(`3D Store generation withholds private completion after ${change} changes during response decoding`, OPTIONS, async t => {
  const h = await host(t), entered = sceneDeferred(), body = sceneDeferred(); let open = true;
  h.intercept = request => request.url === "/api/document-jobs" ? { ok: true, status: 200, json() { entered.resolve(); return body.promise; } } : undefined;
  const pending = h.render({ current: () => open }); await entered.promise;
  if (change === "closed") open = false; else h.depart(change);
  body.resolve({ job: { jobId: "late-model-job", documentId: DOCUMENT, kind: "render_document", status: "queued", requestedAt: "2026-08-31T12:00:00.000Z",
    requestKey: h.jobRequests()[0].body.payload.requestKey, result: { artifactKind: "model3d", privatePrompt: "private-original-source" } }, readiness: { privateDetails: "private-original-source" } });
  await pending;
  assert.doesNotMatch(JSON.stringify(h.store.documentJobs.get()), /private-original-source/);
  assert.deepEqual(h.store.generationReadiness.get(), {});
  assert.equal(h.requests.some(request => request.url.endsWith("/run")), false);
  assert.equal(h.store.ui.toast, "");
});

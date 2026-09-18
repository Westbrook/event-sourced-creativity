import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { MAX_MODEL3D_UPLOAD_BYTES, MODEL3D_MIME_TYPE } from "../src/model/model3d-assets.ts";
import { model3dPresetView, normalizeModel3dView } from "../src/model/model3d-view.ts";
import {
  REFERENCE_COMPOSITION_MAX_SOURCE_BYTES,
  addReferenceCompositionLayer,
  createReferenceComposition,
  normalizeReferenceComposition,
} from "../src/model/reference-composition.ts";
import { readOwnedModel3dReference, storeGeneratedMedia, verifyModel3dBlockAssets, verifyReferenceCompositionAssets, verifySourceDocumentEvidence } from "../worker/media-api.ts";

const OWNER = "model-owner@example.test";
const PROJECT = "model-reference-project";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4l8AAAAASUVORK5CYII=", "base64");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mediaUrl = (key) => `/api/media/${encodeURIComponent(key)}`;

test("ordinary generated image references retain a verified content hash without claiming document extraction", async () => {
  const bucket = memoryMedia();
  const stored = await storeGeneratedMedia(bucket.env, OWNER, "generated-image", PNG, "fixture", "image/png");
  const properties = { media_url: stored.url, media_type: "image/png", source_mime_type: "image/png", source_content_hash: stored.contentHash };
  assert.equal(await verifySourceDocumentEvidence(bucket.env, OWNER, stored.url, properties), true);
  assert.equal(await verifySourceDocumentEvidence(bucket.env, OWNER, stored.url, { ...properties, source_content_hash: "0".repeat(64) }), false);
  assert.equal(await verifySourceDocumentEvidence(bucket.env, OWNER, stored.url, { ...properties, source_citations: [] }), false);
  assert.equal(await verifySourceDocumentEvidence(bucket.env, OWNER, stored.url, { ...properties, extraction_status: "ready" }), false);
});

function triangleGlb({ extensionsRequired } = {}) {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" },
    ...(extensionsRequired ? { extensionsUsed: extensionsRequired, extensionsRequired } : {}),
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  }));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const bytes = Buffer.alloc(12 + 8 + jsonLength + 8 + 36);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  bytes.fill(0x20, 20, 20 + jsonLength);
  json.copy(bytes, 20);
  bytes.writeUInt32LE(36, 20 + jsonLength);
  bytes.writeUInt32LE(0x004e4942, 24 + jsonLength);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => bytes.writeFloatLE(value, 28 + jsonLength + index * 4));
  return bytes;
}

function memoryMedia() {
  const objects = new Map();
  const reads = [];
  const writes = [];
  const scopeQueries = [];
  const scopes = new Set();
  const snapshot = (key, withBody) => {
    const object = objects.get(key);
    if (!object) return null;
    return {
      size: object.size,
      customMetadata: { ...object.customMetadata },
      writeHttpMetadata(headers) { headers.set("content-type", object.contentType); },
      ...(withBody ? { body: object.bytes.slice() } : {}),
    };
  };
  const add = (key, bytes, contentType, customMetadata, size = bytes.byteLength) => {
    objects.set(key, { bytes: new Uint8Array(bytes), contentType, customMetadata: { ...customMetadata }, size });
  };
  const env = {
    MEDIA: {
      async head(key) { reads.push({ method: "head", key }); return snapshot(key, false); },
      async get(key) { reads.push({ method: "get", key }); return snapshot(key, true); },
      async put(key, body, options) {
        const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(await new Response(body).arrayBuffer());
        add(key, bytes, options.httpMetadata.contentType, options.customMetadata);
        writes.push(key);
      },
    },
    DB: {
      prepare(sql) {
        assert.match(sql, /FROM project_resource_scopes/);
        assert.match(sql, /resource_kind='media'/);
        return {
          bind(...values) {
            scopeQueries.push(values);
            return { async first() { return scopes.has(JSON.stringify(values)) ? { valid: 1 } : null; } };
          },
        };
      },
    },
  };
  return { env, objects, reads, writes, scopeQueries, scopes, add,
    grant(project, key, owner = OWNER) { scopes.add(JSON.stringify([project, key, owner])); } };
}

function fixture() {
  const bucket = memoryMedia();
  const modelBytes = triangleGlb();
  const modelKey = `${ownerMediaNamespace(OWNER)}/uploads/sculpture.glb`;
  const imageKey = `${ownerMediaNamespace(OWNER)}/uploads/sculpture-front.png`;
  const modelHash = digest(modelBytes);
  const imageHash = digest(PNG);
  const view = model3dPresetView("front", "transparent");
  bucket.add(modelKey, modelBytes, MODEL3D_MIME_TYPE, {
    ownerId: OWNER, modelFormat: "glb", mimeType: MODEL3D_MIME_TYPE, sha256: modelHash, rights: "asserted",
  });
  bucket.add(imageKey, PNG, "image/png", {
    ownerId: OWNER, mimeType: "image/png", sha256: imageHash, rights: "asserted",
    modelSourceKey: modelKey, modelSourceSha256: modelHash, modelView: JSON.stringify(view),
  });
  const originalProperties = {
    model_url: mediaUrl(modelKey), model_mime_type: MODEL3D_MIME_TYPE, model_content_hash: modelHash,
  };
  const properties = {
    ...originalProperties, media_url: mediaUrl(imageKey), media_type: "image/png", source_content_hash: imageHash,
    model_view: view, reference_id: "saved-model-front-view",
  };
  return { ...bucket, modelBytes, modelKey, imageKey, modelHash, imageHash, view, originalProperties, properties };
}

test("owned GLB reads preserve validated bytes and use metadata-only reads for saved block proof", async () => {
  const f = fixture();
  const full = await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey));
  assert.ok(full);
  assert.equal(full.key, f.modelKey);
  assert.equal(full.mimeType, MODEL3D_MIME_TYPE);
  assert.equal(full.metadata.sha256, digest(f.modelBytes));
  assert.equal(full.size, f.modelBytes.byteLength);
  assert.deepEqual(full.bytes, new Uint8Array(f.modelBytes));

  const metadata = await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey), { metadataOnly: true });
  assert.equal(metadata.bytes.byteLength, 0);
  assert.equal(metadata.metadata.sha256, f.modelHash);
  assert.deepEqual(f.reads, [{ method: "get", key: f.modelKey }, { method: "head", key: f.modelKey }]);
  assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, f.originalProperties), true,
    "an owned original can be saved before the user chooses its image view");
});

test("external URLs and another owner's namespace never reach the media bucket", async () => {
  const f = fixture();
  for (const url of [
    "https://untrusted.example/sculpture.glb",
    "data:model/gltf-binary;base64,AAAA",
    "/api/media/%ZZ",
    mediaUrl(`${ownerMediaNamespace("another-owner")}/uploads/sculpture.glb`),
  ]) assert.equal(await readOwnedModel3dReference(f.env, OWNER, url), null, url);
  assert.equal(f.reads.length, 0);
  assert.equal(await readOwnedModel3dReference(f.env, "another-owner", mediaUrl(f.modelKey)), null);
  assert.equal(f.reads.length, 0);
});

test("GLB reads reject incorrect owner, type, ingestion proof, and reported size", async () => {
  for (const [description, mutate] of [
    ["metadata belongs to another owner", (object) => { object.customMetadata.ownerId = "another-owner"; }],
    ["HTTP metadata is an image", (object) => { object.contentType = "image/png"; }],
    ["claimed MIME differs from HTTP metadata", (object) => { object.customMetadata.mimeType = "model/obj"; }],
    ["unsupported model format", (object) => { object.customMetadata.modelFormat = "obj"; }],
    ["missing ingestion hash", (object) => { delete object.customMetadata.sha256; }],
    ["malformed ingestion hash", (object) => { object.customMetadata.sha256 = "unverified"; }],
    ["neither asserted rights nor provider provenance", (object) => { delete object.customMetadata.rights; }],
    ["empty model", (object) => { object.size = 0; }],
    ["oversized model", (object) => { object.size = MAX_MODEL3D_UPLOAD_BYTES + 1; }],
  ]) {
    const f = fixture();
    mutate(f.objects.get(f.modelKey));
    assert.equal(await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey)), null, description);
    assert.equal(await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey), { metadataOnly: true }), null, `${description}, metadata-only`);
  }
});

test("full model reads reject corrupt bytes even when metadata claims an ingested GLB", async () => {
  const f = fixture();
  const object = f.objects.get(f.modelKey);
  object.bytes[0] = 0;
  assert.equal(await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey)), null);
});

test("generated model storage uses a GLB extension, canonical metadata, and the actual SHA-256", async () => {
  const f = memoryMedia();
  const bytes = triangleGlb();
  const result = await storeGeneratedMedia(f.env, OWNER, "generated-model", bytes, "fal-ai/hyper3d/rodin/v2.5/text-to-3d", MODEL3D_MIME_TYPE, {
    modelFormat: "obj", mimeType: "text/plain", sha256: "unverified-provider-claim", provider: "fal",
  });
  assert.equal(result.key, `${ownerMediaNamespace(OWNER)}/generated/generated-model.glb`);
  assert.equal(result.url, mediaUrl(result.key));
  assert.equal(result.mimeType, MODEL3D_MIME_TYPE);
  assert.equal(result.contentHash, digest(bytes));
  assert.equal(result.durationSeconds, null);
  assert.equal(result.previewSupported, true);
  const stored = f.objects.get(result.key);
  assert.equal(stored.contentType, MODEL3D_MIME_TYPE);
  assert.equal(stored.customMetadata.ownerId, OWNER);
  assert.equal(stored.customMetadata.modelFormat, "glb");
  assert.equal(stored.customMetadata.modelPreviewSafe, "true");
  assert.equal(stored.customMetadata.mimeType, MODEL3D_MIME_TYPE);
  assert.equal(stored.customMetadata.sha256, digest(bytes));
  assert.equal(stored.customMetadata.source, "provider-generated-media");
  assert.equal(stored.customMetadata.provider, "fal");
  assert.deepEqual(stored.bytes, new Uint8Array(bytes));
  assert.ok(await readOwnedModel3dReference(f.env, OWNER, result.url),
    "generated models retain provider provenance without an upload-rights field");
});

test("invalid generated GLB bytes never create a retained output object", async () => {
  const f = memoryMedia();
  await assert.rejects(storeGeneratedMedia(f.env, OWNER, "broken-model", PNG, "rodin", MODEL3D_MIME_TYPE), /GLB|model/i);
  assert.equal(f.writes.length, 0);
  assert.equal(f.objects.size, 0);
});

test("a framed decoder-dependent generated GLB remains retained for download but cannot become model context", async () => {
  const f = memoryMedia();
  const bytes = triangleGlb({ extensionsRequired: ["KHR_draco_mesh_compression"] });
  const result = await storeGeneratedMedia(f.env, OWNER, "compressed-model", bytes, "rodin", MODEL3D_MIME_TYPE);
  assert.equal(result.previewSupported, false);
  assert.match(result.key, /\/compressed-model\.glb$/);
  assert.equal(result.mimeType, MODEL3D_MIME_TYPE);
  assert.equal(result.contentHash, digest(bytes));
  const stored = f.objects.get(result.key);
  assert.equal(stored.contentType, MODEL3D_MIME_TYPE);
  assert.equal(stored.customMetadata.modelPreviewSafe, "false");
  assert.equal(stored.customMetadata.sha256, digest(bytes));
  const retained = await f.env.MEDIA.get(result.key);
  assert.deepEqual(new Uint8Array(await new Response(retained.body).arrayBuffer()), new Uint8Array(bytes),
    "the returned .glb URL retains the exact generated bytes for download");
  assert.equal(await readOwnedModel3dReference(f.env, OWNER, result.url), null);
  assert.equal(await readOwnedModel3dReference(f.env, OWNER, result.url, { metadataOnly: true }), null,
    "a retained export without preview support cannot authorize model context or view capture");

  const malformed = Buffer.from(bytes);
  malformed.writeUInt32LE(malformed.byteLength + 4, 8);
  await assert.rejects(storeGeneratedMedia(f.env, OWNER, "malformed-model", malformed, "rodin", MODEL3D_MIME_TYPE), /GLB|model/i);
  assert.deepEqual(f.writes, [result.key], "malformed framing is rejected before retention");
  assert.equal(f.objects.size, 1);
});

test("a saved PNG proves the same model, image hash, and normalized camera", async () => {
  const f = fixture();
  assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, f.properties), true);
  const roundedCamera = { ...f.view, position: [0.00000001, -0.00000001, 6.40000001] };
  assert.equal(JSON.stringify(normalizeModel3dView(roundedCamera)), JSON.stringify(f.view));
  assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, { ...f.properties, model_view: roundedCamera }), true,
    "equivalent camera values use the same normalized proof");
  assert.ok(f.reads.every((read) => read.method === "head"));
});

test("changing the saved model, image, or view claim invalidates the PNG proof", async () => {
  const f = fixture();
  const otherModelKey = `${ownerMediaNamespace(OWNER)}/uploads/another-model.glb`;
  const otherImageKey = `${ownerMediaNamespace(OWNER)}/uploads/unrelated-image.png`;
  f.add(otherModelKey, f.modelBytes, MODEL3D_MIME_TYPE, f.objects.get(f.modelKey).customMetadata);
  f.add(otherImageKey, PNG, "image/png", { ownerId: OWNER, mimeType: "image/png", rights: "asserted", sha256: f.imageHash });
  for (const [description, change] of [
    ["different model object with the same content", { model_url: mediaUrl(otherModelKey) }],
    ["different original hash", { model_content_hash: "a".repeat(64) }],
    ["different image hash", { source_content_hash: "b".repeat(64) }],
    ["different camera", { model_view: model3dPresetView("back", "transparent") }],
    ["invalid camera", { model_view: { ...f.view, fov: 90 } }],
    ["unrelated owned PNG", { media_url: mediaUrl(otherImageKey) }],
    ["missing PNG object", { media_url: mediaUrl(`${ownerMediaNamespace(OWNER)}/uploads/missing.png`) }],
    ["foreign PNG URL", { media_url: "https://untrusted.example/front.png" }],
    ["wrong model MIME claim", { model_mime_type: "model/obj" }],
    ["wrong image MIME claim", { media_type: "image/webp" }],
  ]) assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, { ...f.properties, ...change }), false, description);

  for (const partial of [
    { model_view: f.view }, { source_content_hash: f.imageHash }, { media_type: "image/png" }, { reference_id: "incomplete-view" },
  ]) assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, { ...f.originalProperties, ...partial }), false,
    "a partially supplied image proof cannot be saved as an original-only model block");
});

test("PNG proof rejects altered object ownership, MIME, rights, or model binding", async () => {
  for (const [description, mutate] of [
    ["other owner", (object) => { object.customMetadata.ownerId = "another-owner"; }],
    ["HTTP type changed", (object) => { object.contentType = "image/jpeg"; }],
    ["metadata type changed", (object) => { object.customMetadata.mimeType = "image/jpeg"; }],
    ["rights not asserted", (object) => { delete object.customMetadata.rights; }],
    ["other model object", (object) => { object.customMetadata.modelSourceKey += ".different"; }],
    ["other original hash", (object) => { object.customMetadata.modelSourceSha256 = "c".repeat(64); }],
    ["other saved image hash", (object) => { object.customMetadata.sha256 = "d".repeat(64); }],
    ["other stored camera", (object) => { object.customMetadata.modelView = JSON.stringify(model3dPresetView("right")); }],
  ]) {
    const f = fixture();
    mutate(f.objects.get(f.imageKey));
    assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, f.properties), false, description);
  }
});

test("project-scoped reads require the original model's matching resource scope", async () => {
  const f = fixture();
  f.objects.get(f.modelKey).customMetadata.projectAccessId = PROJECT;
  assert.equal(await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey), { projectAccessId: PROJECT }), null,
    "metadata alone does not grant a media scope");
  f.grant(PROJECT, f.modelKey, "another-owner");
  assert.equal(await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey), { projectAccessId: PROJECT }), null,
    "a scope belonging to another owner does not grant access");
  f.grant(PROJECT, f.modelKey);
  assert.ok(await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey), { projectAccessId: PROJECT }));

  f.objects.get(f.modelKey).customMetadata.projectAccessId = "another-project";
  assert.equal(await readOwnedModel3dReference(f.env, OWNER, mediaUrl(f.modelKey), { projectAccessId: PROJECT }), null,
    "a database grant cannot override mismatched project metadata");
});

test("a scoped saved view requires both model and PNG to belong to the selected project", async () => {
  const f = fixture();
  f.objects.get(f.modelKey).customMetadata.projectAccessId = PROJECT;
  f.objects.get(f.imageKey).customMetadata.projectAccessId = PROJECT;
  f.grant(PROJECT, f.modelKey);
  assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, f.properties, PROJECT), false,
    "the PNG requires its own scope even when the model is in the project");
  f.grant(PROJECT, f.imageKey);
  assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, f.properties, PROJECT), true);
  assert.ok(f.scopeQueries.some((values) => JSON.stringify(values) === JSON.stringify([PROJECT, f.modelKey, OWNER])));
  assert.ok(f.scopeQueries.some((values) => JSON.stringify(values) === JSON.stringify([PROJECT, f.imageKey, OWNER])));

  f.objects.get(f.imageKey).customMetadata.projectAccessId = "another-project";
  assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, f.properties, PROJECT), false);
  f.objects.get(f.imageKey).customMetadata.projectAccessId = PROJECT;
  f.scopes.delete(JSON.stringify([PROJECT, f.modelKey, OWNER]));
  assert.equal(await verifyModel3dBlockAssets(f.env, OWNER, f.properties, PROJECT), false,
    "the PNG scope cannot compensate for a missing model scope");
});

function compositionFixture() {
  const bucket = memoryMedia();
  const sourceKey = `${ownerMediaNamespace(OWNER)}/uploads/composition-source.png`;
  const compositionKey = `${ownerMediaNamespace(OWNER)}/uploads/composite-scene.png`;
  const sourceHash = digest(PNG);
  const recipe = normalizeReferenceComposition(addReferenceCompositionLayer(createReferenceComposition("16:9"), {
    id: "composition-image", blockId: "composition-source-block", label: "Saved image",
    mediaUrl: mediaUrl(sourceKey), contentHash: sourceHash, kind: "image",
  }, "composition-layer"));
  assert.ok(recipe);
  bucket.add(sourceKey, PNG, "image/png", {
    ownerId: OWNER, mimeType: "image/png", sha256: sourceHash, rights: "asserted",
  });
  bucket.add(compositionKey, PNG, "image/png", {
    ownerId: OWNER, mimeType: "image/png", sha256: digest(PNG), rights: "asserted",
    referenceCompositionVersion: "1", referenceCompositionSha256: digest(Buffer.from(JSON.stringify(recipe))),
  });
  const properties = {
    reference_composition: recipe, media_url: mediaUrl(compositionKey), media_type: "image/png", source_content_hash: digest(PNG),
  };
  const retainRecipeProof = () => {
    const normalized = normalizeReferenceComposition(properties.reference_composition);
    assert.ok(normalized);
    bucket.objects.get(compositionKey).customMetadata.referenceCompositionSha256 = digest(Buffer.from(JSON.stringify(normalized)));
  };
  return { ...bucket, sourceKey, compositionKey, sourceHash, recipe, properties, retainRecipeProof };
}

test("a composition PNG receipt binds normalized layers to owned source bytes", async () => {
  const f = compositionFixture();
  assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties), true);
  const supplied = structuredClone(f.recipe);
  supplied.sources[0].contentHash = f.sourceHash.toUpperCase();
  supplied.sources[0].label = "  Saved image  ";
  supplied.sources[0].mediaUrl = `/api/media/${f.sourceKey}`;
  assert.deepEqual(normalizeReferenceComposition(supplied), f.recipe);
  assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, { ...f.properties, reference_composition: supplied }), true);
  assert.ok(f.reads.every((read) => read.method === "head"), "retained source hashes need no additional body read");
});

test("the reference append evidence gate accepts composition proof and rejects a removed or changed recipe", async () => {
  const f = compositionFixture();
  assert.equal(await verifySourceDocumentEvidence(f.env, OWNER, f.properties.media_url, f.properties), true,
    "a composition's required source_content_hash is validated by its receipt rather than rejected as legacy image evidence");

  const changed = structuredClone(f.properties);
  changed.reference_composition.layers[0].scale = 85;
  assert.equal(await verifySourceDocumentEvidence(f.env, OWNER, changed.media_url, changed), false);

  const removed = { ...f.properties };
  delete removed.reference_composition;
  assert.equal(await verifySourceDocumentEvidence(f.env, OWNER, removed.media_url, removed), false);
  delete removed.source_content_hash;
  assert.equal(await verifySourceDocumentEvidence(f.env, OWNER, removed.media_url, removed), false,
    "stripping browser proof cannot downgrade a retained composition receipt to an ordinary legacy image");
});

test("removed or changed composition recipes and PNG proof cannot reuse a saved receipt", async () => {
  for (const [description, mutate] of [
    ["removed recipe", (f) => { delete f.properties.reference_composition; }],
    ["moved layer", (f) => { f.recipe.layers[0].x = 25; }],
    ["changed source hash", (f) => { f.recipe.sources[0].contentHash = "a".repeat(64); }],
    ["changed background", (f) => { f.recipe.background = "transparent"; }],
    ["removed layers", (f) => { f.recipe.layers = []; }],
    ["removed output URL", (f) => { delete f.properties.media_url; }],
    ["unrelated owned image", (f) => { f.properties.media_url = mediaUrl(f.sourceKey); }],
    ["foreign output URL", (f) => { f.properties.media_url = "https://untrusted.example/composite.png"; }],
    ["changed output hash", (f) => { f.properties.source_content_hash = "b".repeat(64); }],
    ["missing output hash", (f) => { delete f.properties.source_content_hash; }],
    ["changed output MIME claim", (f) => { f.properties.media_type = "image/jpeg"; }],
    ["missing receipt digest", (f) => { delete f.objects.get(f.compositionKey).customMetadata.referenceCompositionSha256; }],
    ["changed receipt version", (f) => { f.objects.get(f.compositionKey).customMetadata.referenceCompositionVersion = "2"; }],
    ["changed output owner", (f) => { f.objects.get(f.compositionKey).customMetadata.ownerId = "another-owner"; }],
    ["changed output HTTP MIME", (f) => { f.objects.get(f.compositionKey).contentType = "image/jpeg"; }],
    ["changed output metadata MIME", (f) => { f.objects.get(f.compositionKey).customMetadata.mimeType = "image/jpeg"; }],
    ["missing output rights", (f) => { delete f.objects.get(f.compositionKey).customMetadata.rights; }],
  ]) {
    const f = compositionFixture();
    mutate(f);
    assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties), false, description);
  }
});

test("a matching recipe receipt cannot grant foreign, changed, or unavailable composition sources", async () => {
  for (const [description, mutate] of [
    ["foreign owner namespace", (f) => {
      const foreignKey = `${ownerMediaNamespace("another-owner")}/uploads/source.png`;
      f.add(foreignKey, PNG, "image/png", { ownerId: "another-owner", mimeType: "image/png", sha256: f.sourceHash, rights: "asserted" });
      f.recipe.sources[0].mediaUrl = mediaUrl(foreignKey);
    }],
    ["source metadata belongs to another owner", (f) => { f.objects.get(f.sourceKey).customMetadata.ownerId = "another-owner"; }],
    ["missing source object", (f) => { f.objects.delete(f.sourceKey); }],
    ["different source content", (f) => { f.objects.get(f.sourceKey).customMetadata.sha256 = "c".repeat(64); }],
    ["source has no rights or provider provenance", (f) => { delete f.objects.get(f.sourceKey).customMetadata.rights; }],
    ["source is not an image", (f) => { f.objects.get(f.sourceKey).contentType = MODEL3D_MIME_TYPE; }],
    ["empty source", (f) => { f.objects.get(f.sourceKey).size = 0; }],
    ["oversized source", (f) => { f.objects.get(f.sourceKey).size = REFERENCE_COMPOSITION_MAX_SOURCE_BYTES + 1; }],
    ["image masquerades as a saved model view", (f) => { f.recipe.sources[0].kind = "model-view"; }],
    ["no visible source layer", (f) => { f.recipe.layers[0].opacity = 0; }],
  ]) {
    const f = compositionFixture();
    mutate(f);
    f.retainRecipeProof();
    assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties), false, description);
  }

  const remote = compositionFixture();
  remote.recipe.sources[0].mediaUrl = "https://untrusted.example/source.png";
  assert.equal(await verifyReferenceCompositionAssets(remote.env, OWNER, remote.properties), false);
});

test("composition output and each retained source require their own selected-project scope", async () => {
  const f = compositionFixture();
  f.objects.get(f.compositionKey).customMetadata.projectAccessId = PROJECT;
  f.objects.get(f.sourceKey).customMetadata.projectAccessId = PROJECT;
  f.grant(PROJECT, f.compositionKey);
  assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties, PROJECT), false,
    "the composite scope cannot grant access to its source");
  f.grant(PROJECT, f.sourceKey, "another-owner");
  assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties, PROJECT), false);
  f.grant(PROJECT, f.sourceKey);
  assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties, PROJECT), true);

  f.objects.get(f.sourceKey).customMetadata.projectAccessId = "another-project";
  assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties, PROJECT), false);
  f.objects.get(f.sourceKey).customMetadata.projectAccessId = PROJECT;
  f.objects.get(f.compositionKey).customMetadata.projectAccessId = "another-project";
  assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties, PROJECT), false);
  f.objects.get(f.compositionKey).customMetadata.projectAccessId = PROJECT;
  f.scopes.delete(JSON.stringify([PROJECT, f.compositionKey, OWNER]));
  assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties, PROJECT), false,
    "the source scope cannot compensate for an unscoped output PNG");
});

test("legacy generated composition sources derive a missing hash from bounded owned bytes", async () => {
  for (const source of ["provider-generated-media", "provider-image-api"]) {
    const f = compositionFixture();
    const retained = f.objects.get(f.sourceKey);
    delete retained.customMetadata.sha256;
    delete retained.customMetadata.rights;
    retained.customMetadata.source = source;
    assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties), true, source);
    assert.deepEqual(f.reads.filter((read) => read.method === "get"), [{ method: "get", key: f.sourceKey }]);

    retained.bytes[retained.bytes.length - 1] ^= 1;
    assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties), false,
      "legacy source bytes must still match the recipe's retained content hash");
    retained.bytes = new Uint8Array(PNG);
    const get = f.env.MEDIA.get;
    f.env.MEDIA.get = async (key) => {
      const object = await get(key);
      object.customMetadata.ownerId = "another-owner";
      return object;
    };
    assert.equal(await verifyReferenceCompositionAssets(f.env, OWNER, f.properties), false,
      "the body read rechecks ownership after the metadata read");
  }
});

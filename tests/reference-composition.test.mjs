import assert from "node:assert/strict";
import test from "node:test";
import {
  REFERENCE_COMPOSITION_MAX_EDGE, REFERENCE_COMPOSITION_MAX_LAYERS,
  addReferenceCompositionLayer, createReferenceComposition, moveReferenceCompositionLayer,
  normalizeReferenceComposition, referenceCompositionLayerRect, referenceCompositionMediaUrl,
  referenceCompositionSources, referenceCompositionSourcesFingerprint,
  removeReferenceCompositionLayer, updateReferenceCompositionLayer, updateReferenceCompositionSource, validateReferenceComposition,
} from "../src/model/reference-composition.ts";

const imageHash = "1".repeat(64), viewHash = "2".repeat(64);
const source = { id: "image:source", blockId: "image-block", label: "Landscape", kind: "image", mediaUrl: "/api/media/user%2Flandscape.png", contentHash: imageHash };
const modelView = { id: "model:view", blockId: "model-block", label: "Saved camera", kind: "model-view", mediaUrl: "/api/media/user%2Fview.png", contentHash: viewHash };
const imageBlock = (overrides = {}) => ({ id: "image-block", type: "reference", documentId: "document", canvasId: "canvas", projectId: "project", scope: "document", handle: "Landscape", position: "a", removed: false, locked: false, properties: { reference_id: "image-ref", media_url: source.mediaUrl, source_content_hash: imageHash, media_type: "image/png", weight: .7 }, sourceEvents: [], ...overrides });
const receipt = (id, url, contentHash) => [{ type: "ReferenceIngested", payload: { reference_id: id, source_ref: url, content_hash: contentHash, rights_class: "asserted" } }, { type: "RightsAsserted", payload: { reference_id: id, rights_class: "owned_or_licensed" } }];

test("private media routes reject network, redirect, and traversal inputs", () => {
  assert.equal(referenceCompositionMediaUrl("/api/media/user/path.png"), "/api/media/user%2Fpath.png");
  for (const url of ["https://example.org/image.png", "//example.org/image.png", "data:image/png;base64,aA==", "blob:https://forma.test/id", "/api/media/", "/api/media/../private", "/api/media/%2e%2e%2Fprivate", "/api/media/image.png?redirect=other", "/api/media/image.png#fragment", "/api/media/%00image", "/api/media/%5cprivate", "/api/media/%not-encoded"]) {
    assert.equal(referenceCompositionMediaUrl(url), null, url);
  }
});

test("only current rights and an exact image-content receipt admit a source", () => {
  const block = imageBlock(), events = receipt("image-ref", source.mediaUrl, imageHash);
  assert.equal(referenceCompositionSources([block], events).length, 1);
  assert.deepEqual(referenceCompositionSources([block], events.slice(0, 1)), []);
  assert.deepEqual(referenceCompositionSources([block], [...events, { type: "RightsAsserted", payload: { reference_id: "image-ref", rights_class: "revoked" } }]), []);
  assert.deepEqual(referenceCompositionSources([imageBlock({ removed: true })], events), []);
  assert.deepEqual(referenceCompositionSources([imageBlock({ properties: { ...block.properties, active: false } })], events), []);
  assert.deepEqual(referenceCompositionSources([imageBlock({ properties: { ...block.properties, source_content_hash: viewHash } })], events), []);
  assert.deepEqual(referenceCompositionSources([block], receipt("image-ref", "/api/media/different.png", imageHash)), []);
  assert.deepEqual(referenceCompositionSources([imageBlock({ properties: { ...block.properties, media_type: "video/mp4" } })], events), []);
});

test("saved model PNGs use their own view receipt and never read mesh URLs or hashes", () => {
  const block = imageBlock({ id: "model", type: "model3d", properties: { reference_id: "view-ref", model_reference_id: "mesh-ref", model_url: "/api/media/mesh.glb", model_content_hash: imageHash, media_url: modelView.mediaUrl, media_type: "image/png", source_content_hash: viewHash } });
  const events = [...receipt("mesh-ref", "/api/media/mesh.glb", imageHash), ...receipt("view-ref", modelView.mediaUrl, viewHash)];
  const choices = referenceCompositionSources([block], events);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].kind, "model-view");
  assert.equal(choices[0].contentHash, viewHash);
  assert.equal(choices[0].mediaUrl, modelView.mediaUrl);
  assert.deepEqual(referenceCompositionSources([{ ...block, properties: { ...block.properties, media_url: "", media_type: "model/gltf-binary" } }], events), []);
});

test("canvas output is bounded and keeps the selected aspect ratio", () => {
  for (const [aspect, width, height] of [["1:1", 1536, 1536], ["16:9", 1536, 864], ["9:16", 864, 1536]]) {
    const recipe = createReferenceComposition(aspect);
    assert.equal(recipe.width, width); assert.equal(recipe.height, height);
    assert.ok(recipe.width <= REFERENCE_COMPOSITION_MAX_EDGE && recipe.height <= REFERENCE_COMPOSITION_MAX_EDGE);
    assert.deepEqual(normalizeReferenceComposition(recipe), recipe);
    assert.equal(normalizeReferenceComposition({ ...recipe, width: width + 1 }), null);
  }
});

test("layer layout retains source aspect and uses the same percentage geometry at export", () => {
  let recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), modelView, "model-layer");
  recipe = updateReferenceCompositionLayer(recipe, "model-layer", { x: 25, y: 50, scale: 100, opacity: 60 });
  const rect = referenceCompositionLayerRect(recipe, recipe.layers[0], 1000, 1000);
  for (const [key, expected] of Object.entries({ x: -48, y: 0, width: 864, height: 864 })) assert.ok(Math.abs(rect[key] - expected) < 1e-9, key);
  assert.equal(referenceCompositionLayerRect(recipe, recipe.layers[0], 0, 100), null);
  const updated = updateReferenceCompositionLayer(recipe, "model-layer", { x: -10, y: Infinity, scale: 1000, opacity: -10 });
  assert.deepEqual(updated.layers[0], { id: "model-layer", sourceId: modelView.id, x: 0, y: 50, scale: 200, opacity: 0 });
  assert.equal(recipe.layers[0].x, 25);
  assert.equal(validateReferenceComposition(updated, [modelView]), "empty");
});

test("reordering and removal preserve exact provenance and never silently substitute changed sources", () => {
  let recipe = addReferenceCompositionLayer(createReferenceComposition(), source, "background");
  recipe = addReferenceCompositionLayer(recipe, modelView, "model");
  recipe = addReferenceCompositionLayer(recipe, source, "image-detail");
  assert.equal(recipe.sources.length, 2);
  recipe = moveReferenceCompositionLayer(recipe, "model", 1);
  assert.deepEqual(recipe.layers.map(layer => layer.id), ["background", "image-detail", "model"]);
  assert.equal(validateReferenceComposition(recipe, [source, modelView]), null);
  assert.equal(validateReferenceComposition(recipe, [source]), "source-unavailable");
  assert.equal(validateReferenceComposition(recipe, [source, { ...modelView, contentHash: imageHash }]), "source-changed");
  assert.equal(validateReferenceComposition(recipe, [source, { ...modelView, mediaUrl: "/api/media/other.png" }]), "source-changed");
  assert.equal(addReferenceCompositionLayer(recipe, { ...source, contentHash: viewHash }, "replacement"), recipe);
  recipe = removeReferenceCompositionLayer(recipe, "background");
  assert.equal(recipe.sources.length, 2);
  recipe = removeReferenceCompositionLayer(recipe, "image-detail");
  assert.deepEqual(recipe.sources, [modelView]);
  assert.equal(normalizeReferenceComposition({ ...recipe, sources: [...recipe.sources, source] }), null);
});

test("persisted data rejects malformed, unbounded, duplicate, and orphaned layers", () => {
  let recipe = createReferenceComposition();
  for (let index = 0; index < REFERENCE_COMPOSITION_MAX_LAYERS; index++) recipe = addReferenceCompositionLayer(recipe, source, String(index));
  assert.equal(recipe.layers.length, REFERENCE_COMPOSITION_MAX_LAYERS);
  assert.equal(addReferenceCompositionLayer(recipe, source, "overflow"), recipe);
  const invalid = [
    { ...recipe, version: 2 }, { ...recipe, aspect: "1000:1" }, { ...recipe, background: "url(https://example.org)" },
    { ...recipe, layers: [...recipe.layers, recipe.layers[0]] },
    { ...recipe, layers: [{ ...recipe.layers[0], sourceId: "missing" }] },
    { ...recipe, layers: [{ ...recipe.layers[0], x: Number.NaN }] },
    { ...recipe, layers: [{ ...recipe.layers[0], scale: 500 }] },
    { ...recipe, sources: [{ ...source, mediaUrl: "https://example.org/image.png" }] },
  ];
  for (const value of invalid) assert.equal(normalizeReferenceComposition(value), null);
});

test("locked pixel sources block replacement and lock changes invalidate an in-flight capture", () => {
  const block = imageBlock({ locked: true });
  block.properties.pixel_reference_mode = "preserve_composition";
  const sources = referenceCompositionSources([block], receipt("image-ref", source.mediaUrl, imageHash));
  assert.equal(sources[0].requiresUnlock, true);
  const recipe = addReferenceCompositionLayer(createReferenceComposition(), sources[0], "layer");
  assert.equal(validateReferenceComposition(recipe, sources), "source-locked");
  assert.equal(normalizeReferenceComposition(recipe).sources[0].requiresUnlock, undefined);
  assert.notEqual(referenceCompositionSourcesFingerprint(sources), referenceCompositionSourcesFingerprint(sources.map(value => ({ ...value, requiresUnlock: false }))));
  block.properties.pixel_reference_mode = "context_only";
  const describedOnly = referenceCompositionSources([block], receipt("image-ref", source.mediaUrl, imageHash));
  assert.equal(describedOnly[0].requiresUnlock, undefined);
  assert.equal(validateReferenceComposition(recipe, describedOnly), null);
});

test("an explicit saved-view refresh preserves every placement and updates its exact content binding", () => {
  let recipe = addReferenceCompositionLayer(createReferenceComposition(), modelView, "wide-view");
  recipe = addReferenceCompositionLayer(recipe, modelView, "detail-view");
  recipe = updateReferenceCompositionLayer(recipe, "detail-view", { x: 80, y: 20, scale: 40, opacity: 60 });
  const changed = { ...modelView, mediaUrl: "/api/media/new-view.png", contentHash: imageHash };
  assert.equal(validateReferenceComposition(recipe, [changed]), "source-changed");
  const updated = updateReferenceCompositionSource(recipe, changed);
  assert.deepEqual(updated.layers, recipe.layers);
  assert.deepEqual(updated.sources, [changed]);
  assert.equal(validateReferenceComposition(updated, [changed]), null);
  assert.equal(recipe.sources[0].contentHash, viewHash);
  assert.equal(updateReferenceCompositionSource(recipe, { ...changed, blockId: "different-block" }), recipe);
});

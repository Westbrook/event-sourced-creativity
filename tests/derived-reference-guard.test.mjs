import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { model3dPresetView } from "../src/model/model3d-view.ts";
import { createReferenceComposition, normalizeReferenceComposition } from "../src/model/reference-composition.ts";
import { assertDerivedReferenceProvenance } from "../worker/derived-reference-guard.ts";
import { ProviderRequestError } from "../worker/provider-errors.ts";

const digest = value => createHash("sha256").update(value).digest("hex");
const projectScope = { projectAccessId: "access", organizationId: "organization", projectId: "project", ownerUserId: "owner", actorUserId: "editor" };

function fixture() {
  const ownerId = "owner", events = [], blocks = new Map(), objects = new Map(), queries = [];
  const event = (type, payload) => events.push({
    eventId: `event-${events.length + 1}`, streamId: "creative:owner", sequence: events.length + 1,
    occurredAt: "2026-08-01T00:00:00.000Z", recordedAt: "2026-08-01T00:00:00.000Z", actor: "user",
    clientId: "unit", correlationId: "test", causationId: null, compensatesEventId: null,
    schemaVersion: 1, type, payload: structuredClone(payload),
  });
  event("ProjectCreated", { project_id: "project", name: "Project" });
  event("DocumentCreated", { document_id: "document", project_id: "project", title: "Document" });
  const env = {
    MEDIA: {
      async head(key) { return objects.get(key) ?? null; },
      async get(key) { return objects.get(key) ?? null; },
      async put() { assert.fail("Admission cannot mutate media"); },
    },
    DB: { prepare(sql) { return { bind(...values) { return { async first() {
      queries.push({ sql, values });
      return f.deniedResource && values.includes(f.deniedResource) ? null : { present: 1, valid: 1 };
    } }; } }; } },
  };
  function media(id, mimeType, metadata = {}) {
    const key = `${ownerMediaNamespace(ownerId)}/uploads/${id}`, bytes = Buffer.from(`fixture-${id}`);
    const sha256 = digest(bytes);
    const object = { size: bytes.length, body: bytes, customMetadata: { ownerId, mimeType, rights: "asserted", sha256, ...metadata },
      writeHttpMetadata(headers) { headers.set("content-type", mimeType); } };
    objects.set(key, object);
    return { key, url: `/api/media/${encodeURIComponent(key)}`, sha256, object };
  }
  function ingestion(referenceId, asset, rights = "owned_or_licensed") {
    event("ReferenceIngested", { reference_id: referenceId, source_ref: asset.url, content_hash: asset.sha256, rights_class: rights });
  }
  function block(id, type, properties) {
    blocks.set(id, { type, properties });
    event("BlockCreated", { block_id: id, document_id: "document", project_id: "project", type, properties });
    return blocks.get(id);
  }
  function image(id, properties = {}, metadata = {}) {
    const asset = media(`${id}.png`, "image/png", metadata), referenceId = `ref-${id}`;
    ingestion(referenceId, asset);
    block(id, "reference", { reference_id: referenceId, media_url: asset.url, media_type: "image/png", source_content_hash: asset.sha256,
      pixel_reference_mode: "preserve_composition", weight: .8, ...properties });
    return { ...asset, referenceId, block: blocks.get(id) };
  }
  function model(id) {
    const original = media(`${id}.glb`, "model/gltf-binary", { modelFormat: "glb" });
    const modelReferenceId = `model-ref-${id}`, view = model3dPresetView();
    ingestion(modelReferenceId, original, "account-generated");
    const saved = image(id, { model_url: original.url, model_mime_type: "model/gltf-binary", model_content_hash: original.sha256,
      model_reference_id: modelReferenceId, model_view: view },
    { modelSourceKey: original.key, modelSourceSha256: original.sha256, modelView: JSON.stringify(view) });
    blocks.get(id).type = "model3d";
    events.at(-1).payload.type = "model3d";
    return { ...saved, original, modelReferenceId, view };
  }
  function recipeFor(ids) {
    const recipe = createReferenceComposition();
    recipe.sources = ids.map(id => {
      const member = blocks.get(id), p = member.properties;
      return { id: `source-${id}`, blockId: id, label: id, mediaUrl: p.media_url, contentHash: p.source_content_hash,
        kind: member.type === "model3d" ? "model-view" : "image" };
    });
    recipe.layers = ids.map((id, index) => ({ id: `layer-${id}`, sourceId: `source-${id}`, x: 30 + index % 5 * 10, y: 50, scale: 70, opacity: 100 }));
    return recipe;
  }
  function composite(id, sourceIds) {
    const recipe = recipeFor(sourceIds);
    return { ...image(id, { reference_composition: recipe }, { referenceCompositionVersion: "1",
      referenceCompositionSha256: digest(JSON.stringify(normalizeReferenceComposition(recipe))) }), recipe };
  }
  function edit(id, property, value) {
    blocks.get(id).properties[property] = structuredClone(value);
    event("BlockPropertyEdited", { block_id: id, property_path: property, new_value: value });
  }
  const f = { ownerId, env, events, objects, blocks, queries, event, image, model, composite, recipeFor, edit, deniedResource: "",
    check(id, options = {}) { return assertDerivedReferenceProvenance({ env, ownerId, sourceEvents: events,
      blockId: id, properties: blocks.get(id).properties, ...options }); } };
  return f;
}

function rejected(code, blockId) {
  return error => error instanceof ProviderRequestError && error.detail.code === code
    && error.detail.httpStatus === 403 && error.detail.retryable === false
    && (!blockId || error.detail.contributingBlockIds.includes(blockId));
}

test("saved 3D views require the current original-model and PNG rights independently", async () => {
  for (const rightsClass of ["owned", "owned_or_licensed", "licensed", "account-generated"]) {
    const f = fixture(), model = f.model("model");
    f.event("RightsAsserted", { reference_id: model.modelReferenceId, rights_class: rightsClass });
    f.event("RightsAsserted", { reference_id: model.referenceId, rights_class: rightsClass });
    await f.check("model");
    f.event("RightsAsserted", { reference_id: model.modelReferenceId, rights_class: "revoked" });
    await assert.rejects(f.check("model"), rejected("derived_reference_rights_required", "model"));
  }
  const f = fixture(), model = f.model("model");
  f.event("RightsAsserted", { reference_id: model.referenceId, rights_class: "denied" });
  await assert.rejects(f.check("model"), rejected("derived_reference_rights_required", "model"));
});

test("the latest ingestion cannot reuse older rights or point at different original bytes", async () => {
  const f = fixture(), model = f.model("model");
  f.event("ReferenceIngested", { reference_id: model.modelReferenceId, source_ref: model.original.url,
    content_hash: model.original.sha256, rights_class: "unlicensed" });
  await assert.rejects(f.check("model"), rejected("derived_reference_rights_required"));
  f.event("RightsAsserted", { reference_id: model.modelReferenceId, rights_class: "owned" });
  await f.check("model");
  f.event("ReferenceIngested", { reference_id: model.modelReferenceId, source_ref: model.original.url,
    content_hash: "0".repeat(64), rights_class: "owned" });
  await assert.rejects(f.check("model"), rejected("derived_reference_integrity_mismatch"));
});

test("expiry and revocation are checked on each live block and latest rights assertion", async () => {
  for (const patch of [{ rights_expires_at: "2000-01-01T00:00:00Z" }, { license_expires_at: "not a timestamp" }, { source_rights_revoked: true }]) {
    const f = fixture(), model = f.model("model");
    f.event("RightsAsserted", { reference_id: model.modelReferenceId, rights_class: "owned", ...patch });
    await assert.rejects(f.check("model"), rejected("derived_reference_rights_unavailable"));
  }
  const f = fixture(); f.model("model");
  f.edit("model", "source_expires_at", "2000-01-01T00:00:00Z");
  await assert.rejects(f.check("model"), rejected("derived_reference_rights_unavailable"));
});

test("a changed camera, unowned original, or missing saved view is rejected before provider work", async () => {
  for (const mutate of [
    (f) => f.edit("model", "model_view", model3dPresetView("front")),
    (_f, model) => { model.original.object.customMetadata.ownerId = "another-owner"; },
    (_f, model) => { model.object.customMetadata.modelSourceSha256 = "1".repeat(64); },
  ]) {
    const f = fixture(), model = f.model("model"); mutate(f, model);
    await assert.rejects(f.check("model"), rejected("derived_reference_model_view_changed"));
  }
  const f = fixture(); f.model("model");
  f.edit("model", "media_url", null);
  await assert.rejects(f.check("model"), rejected("derived_reference_input_unavailable"));
});

test("compositions retain disabled sources and recursively check their original models", async () => {
  const f = fixture(), model = f.model("model"); f.image("photo");
  f.composite("inner", ["model"]); f.composite("outer", ["inner", "photo"]);
  for (const id of ["model", "inner", "photo"]) {
    f.edit(id, "pixel_reference_mode", "context_only"); f.edit(id, "weight", 0); f.edit(id, "active", false);
  }
  await f.check("outer");
  f.event("RightsAsserted", { reference_id: model.modelReferenceId, rights_class: "revoked" });
  await assert.rejects(f.check("outer"), rejected("derived_reference_rights_required", "model"));
});

test("legacy generated image sources can recover their bounded hash from owned bytes and ingestion", async () => {
  const f = fixture(), source = f.image("legacy");
  f.composite("composition", ["legacy"]);
  delete source.object.customMetadata.sha256;
  delete source.object.customMetadata.mimeType;
  f.edit("legacy", "source_content_hash", null);
  await f.check("composition");
  source.object.body = Buffer.from("different original bytes");
  await assert.rejects(f.check("composition"), rejected("derived_reference_composition_changed"));
});

test("an exact source block must remain present even if another block uses identical media", async () => {
  const f = fixture(), source = f.image("source");
  f.composite("composition", ["source"]);
  f.event("BlockCreated", { block_id: "duplicate", document_id: "document", project_id: "project", type: "reference", properties: source.block.properties });
  f.event("BlockRemoved", { block_id: "source" });
  await assert.rejects(f.check("composition"), rejected("derived_reference_source_unavailable", "source"));
});

test("source URL/hash changes, removal of its document, and project moves invalidate composites", async () => {
  for (const mutate of [
    f => f.edit("source", "source_content_hash", "2".repeat(64)),
    f => f.edit("source", "media_url", "/api/media/other.png"),
    f => f.event("BlockRehomed", { block_id: "source", scope: "library", project_id: "other-project" }),
  ]) {
    const f = fixture(); f.image("source"); f.composite("composition", ["source"]); mutate(f);
    await assert.rejects(f.check("composition"), error => error instanceof ProviderRequestError
      && ["derived_reference_source_changed", "derived_reference_source_unavailable"].includes(error.detail.code));
  }
  const f = fixture(); f.image("source"); f.composite("composition", ["source"]);
  f.event("DocumentCreated", { document_id: "second-document", project_id: "project" });
  f.event("BlockRehomed", { block_id: "composition", scope: "document", document_id: "second-document", project_id: "project" });
  f.event("DocumentRemoved", { document_id: "document" });
  await assert.rejects(f.check("composition"), rejected("derived_reference_source_unavailable", "source"));
});

test("valid-looking recipe edits cannot claim an already saved composite PNG", async () => {
  const f = fixture(); f.image("source"); const composite = f.composite("composition", ["source"]);
  const recipe = structuredClone(composite.recipe); recipe.layers[0].x += 10;
  f.edit("composition", "reference_composition", recipe);
  await assert.rejects(f.check("composition"), rejected("derived_reference_composition_changed"));
});

test("deleting authored derivation fields cannot launder saved PNGs into ordinary references", async () => {
  const f = fixture(); f.image("source"); f.composite("composition", ["source"]);
  f.edit("composition", "reference_composition", null);
  await assert.rejects(f.check("composition"), rejected("derived_reference_provenance_missing"));
  const g = fixture(); g.model("model");
  for (const field of ["model_url", "model_reference_id", "model_content_hash", "model_view"]) g.edit("model", field, null);
  g.event("BlockPropertyEdited", { block_id: "model", property_path: "type", new_value: "reference" });
  await assert.rejects(g.check("model"), rejected("derived_reference_provenance_missing"));
});

test("stale caller properties cannot substitute for the current block", async () => {
  const f = fixture(); f.model("model");
  const stale = structuredClone(f.blocks.get("model").properties);
  f.edit("model", "model_view", model3dPresetView("right"));
  await assert.rejects(f.check("model", { properties: stale }), rejected("derived_reference_source_changed"));
  const ordinary = f.image("ordinary");
  await assert.rejects(f.check("model", { properties: ordinary.block.properties }), rejected("derived_reference_source_changed"));
});

test("personal streams resolve the requested block after opening or rehoming across other projects", async () => {
  const f = fixture(); f.model("model");
  f.event("ProjectCreated", { project_id: "another-project", name: "Another project" });
  f.event("DocumentCreated", { document_id: "another-document", project_id: "another-project" });
  await f.check("model");
  f.event("BlockRehomed", { block_id: "model", scope: "document", document_id: "another-document", project_id: "another-project" });
  f.event("ProjectOpened", { project_id: "project" });
  await f.check("model");
  f.event("BlockRehomed", { block_id: "model", scope: "library" });
  await f.check("model");
});

test("circular recipes and excessively nested compositions have bounded admission", async () => {
  const f = fixture(); f.image("source");
  const a = f.composite("a", ["source"]); f.composite("b", ["a"]);
  const cycleRecipe = f.recipeFor(["b"]);
  f.edit("a", "reference_composition", cycleRecipe);
  a.object.customMetadata.referenceCompositionSha256 = digest(JSON.stringify(normalizeReferenceComposition(cycleRecipe)));
  await assert.rejects(f.check("b"), rejected("derived_reference_chain_invalid"));
  const g = fixture(); g.image("source");
  let previous = "source";
  for (let index = 0; index < 10; index++) { const id = `composition-${index}`; g.composite(id, [previous]); previous = id; }
  await assert.rejects(g.check(previous), rejected("derived_reference_chain_invalid"));
});

test("shared subtrees retain their full depth independent of source order", async () => {
  for (const order of [["depth-1", "depth-8"], ["depth-8", "depth-1"]]) {
    const f = fixture(); f.image("leaf");
    let previous = "leaf";
    for (let index = 1; index <= 8; index++) { const id = `depth-${index}`; f.composite(id, [previous]); previous = id; }
    f.composite("root", order);
    await assert.rejects(f.check("root"), rejected("derived_reference_chain_invalid"));
  }
});

test("bounded traversal permits shared ancestors without counting them again", async () => {
  const f = fixture();
  for (let index = 0; index < 117; index++) f.image(`image-${index}`);
  const branches = [];
  for (let index = 0; index < 10; index++) {
    const id = `branch-${index}`;
    f.composite(id, Array.from({ length: 12 }, (_, offset) => `image-${(index * 12 + offset) % 117}`)); branches.push(id);
  }
  f.composite("root", branches);
  await f.check("root");
  f.composite("extra-root", ["root"]);
  await assert.rejects(f.check("extra-root"), rejected("derived_reference_chain_invalid"));
});

test("every nested block, reference, original GLB, and PNG retains project custody", async () => {
  const f = fixture(), model = f.model("model"); f.composite("composition", ["model"]);
  await f.check("composition", { projectScope });
  for (const id of [model.modelReferenceId, model.referenceId, "model", model.original.key, model.key]) {
    f.deniedResource = id;
    await assert.rejects(f.check("composition", { projectScope }), error => error instanceof ProviderRequestError
      && ["derived_reference_not_authorized", "derived_reference_composition_changed"].includes(error.detail.code));
  }
  f.deniedResource = "";
  await assert.rejects(f.check("composition", { projectScope: { ...projectScope, ownerUserId: "different-owner" } }), rejected("derived_reference_not_authorized"));
  assert.ok(f.queries.some(query => query.sql.includes("JOIN project_resource_scopes reference")
    && query.values.includes(model.modelReferenceId)), "original-model reference custody is checked, not only PNG custody");
});

test("ordinary image references preserve their existing selector behavior", async () => {
  const f = fixture(); f.image("ordinary");
  f.event("RightsAsserted", { reference_id: "ref-ordinary", rights_class: "revoked" });
  await f.check("ordinary");
  assert.equal(f.queries.length, 0, "ordinary-reference admission remains owned by the calling selector");
});

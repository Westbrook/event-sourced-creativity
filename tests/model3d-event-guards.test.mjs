import assert from "node:assert/strict";
import test from "node:test";
import { validateModel3dAssetEvents } from "../worker/model3d-event-guards.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { model3dPresetView } from "../src/model/model3d-view.ts";

function fixture() {
  const ownerId = "model-event-owner", originalKey = `${ownerMediaNamespace(ownerId)}/object.glb`, previewKey = `${ownerMediaNamespace(ownerId)}/view.png`;
  const modelUrl = `/api/media/${encodeURIComponent(originalKey)}`, previewUrl = `/api/media/${encodeURIComponent(previewKey)}`;
  const modelHash = "1".repeat(64), previewHash = "2".repeat(64), view = model3dPresetView();
  const object = (mimeType, metadata) => ({ size: 128, customMetadata: { ownerId, mimeType, rights: "asserted", ...metadata }, writeHttpMetadata(headers) { headers.set("content-type", mimeType); } });
  const objects = new Map([
    [originalKey, object("model/gltf-binary", { sha256: modelHash, modelFormat: "glb" })],
    [previewKey, object("image/png", { sha256: previewHash, modelSourceKey: originalKey, modelSourceSha256: modelHash, modelView: JSON.stringify(view) })],
  ]);
  const env = { MEDIA: { async head(key) { return objects.get(key) ?? null; } } };
  const properties = { model_url: modelUrl, model_mime_type: "model/gltf-binary", model_content_hash: modelHash, model_reference_id: "model-ref", text: "A teapot", pixel_reference_mode: "context_only" };
  const sourceEvents = [
    { type: "ReferenceIngested", payload: { reference_id: "model-ref", source_ref: modelUrl, content_hash: modelHash } },
    { type: "BlockCreated", payload: { block_id: "model", type: "model3d", properties } },
  ];
  const viewEvents = [
    { type: "ReferenceIngested", payload: { reference_id: "view-ref", source_ref: previewUrl, content_hash: previewHash } },
    ...Object.entries({ media_url: previewUrl, media_type: "image/png", source_mime_type: "image/png", source_content_hash: previewHash, reference_id: "view-ref", model_view: view, pixel_reference_mode: "inspiration" }).map(([property_path, new_value]) => ({ type: "BlockPropertyEdited", payload: { block_id: "model", property_path, new_value } })),
  ];
  return { env, ownerId, sourceEvents, properties, viewEvents, view, objects, check(events, history = sourceEvents) { return validateModel3dAssetEvents({ env, ownerId, sourceEvents: history, events }); } };
}

test("original GLB context creation and an atomic saved PNG/camera update preserve exact asset receipts", async () => {
  const f = fixture();
  assert.equal(await f.check(f.sourceEvents, []), null);
  assert.equal(await f.check(f.viewEvents), null);
  const incomplete = f.viewEvents.filter((event) => event.payload.property_path !== "model_view");
  assert.equal((await f.check(incomplete)).error, "model3d_asset_not_verified");
});

test("camera-only mutations cannot relabel pixels from an earlier saved view", async () => {
  const f = fixture(), history = [...f.sourceEvents, ...f.viewEvents];
  const changed = { ...f.view, position: [f.view.position[0] + .25, f.view.position[1], f.view.position[2]] };
  const event = { type: "ChipEdited", payload: { block_id: "model", property: "model_view", new_value: changed } };
  assert.equal((await f.check([event], history)).error, "model3d_asset_not_verified");
});

test("3D originals and chosen PNGs require the ingestion receipt for their exact content hash", async () => {
  const f = fixture();
  const badReceipt = structuredClone(f.viewEvents);
  badReceipt[0].payload.content_hash = "3".repeat(64);
  assert.equal((await f.check(badReceipt)).error, "model3d_reference_receipt_mismatch");
  assert.equal((await f.check([{ type: "BlockPropertyEdited", payload: { block_id: "model", property_path: "model_reference_id", new_value: "unrelated-ref" } }])).error, "model3d_reference_receipt_mismatch");
});

test("model type cannot be stripped or attached to an ordinary block to evade asset validation", async () => {
  const f = fixture();
  assert.equal((await f.check([{ type: "BlockPropertyEdited", payload: { block_id: "model", property_path: "type", new_value: "reference" } }])).error, "model3d_type_transition_forbidden");
  assert.equal((await f.check([{ type: "BlockCreated", payload: { block_id: "forged", type: "reference", properties: f.properties } }])).error, "model3d_asset_requires_model3d_block");
  assert.equal(await f.check([{ type: "BlockCreated", payload: { block_id: "empty", type: "model3d", properties: { text: "Add a model", pixel_reference_mode: "context_only" } } }]), null);
});

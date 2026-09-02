import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { writeFixture } from "./helpers/event-source-retirement-fixture.mjs";
import { png } from "./output-asset-fixtures.mjs";
import { MODEL3D_MIME_TYPE } from "../src/model/model3d-assets.ts";
import { model3dPresetView, normalizeModel3dView } from "../src/model/model3d-view.ts";
import { storeGeneratedMedia, verifyModel3dBlockAssets } from "../worker/media-api.ts";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mediaKey = (url) => decodeURIComponent(url.slice("/api/media/".length));

function triangleGlb() {
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
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

// Only the R2 persistence primitive is a memory port. Every object and receipt
// below is written by the actual upload route or generated-media storage helper.
function retainUploadedMedia(h) {
  const rows = new Map();
  const object = (key, body) => {
    const row = rows.get(key);
    if (!row) return null;
    return {
      key, size: row.bytes.length, customMetadata: structuredClone(row.customMetadata), httpMetadata: structuredClone(row.httpMetadata),
      writeHttpMetadata(headers) { if (row.httpMetadata.contentType) headers.set("content-type", row.httpMetadata.contentType); },
      ...(body ? { body: new Response(row.bytes).body, arrayBuffer: async () => row.bytes.slice().buffer } : {}),
    };
  };
  h.worker.env.MEDIA = {
    async put(key, value, options = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      rows.set(key, { bytes, customMetadata: structuredClone(options.customMetadata ?? {}), httpMetadata: structuredClone(options.httpMetadata ?? {}) });
      return { key };
    },
    async head(key) { return object(key, false); },
    async get(key) { return object(key, true); },
    async delete(key) { rows.delete(key); },
  };
  return rows;
}

test("real Store uploads a GLB and saves an independently receipted view through the routed Worker", { timeout: 60_000 }, async (t) => {
  const h = await writeFixture(t, { shared: false });
  const rows = retainUploadedMedia(h);
  const replies = [];
  h.transport = async (request) => {
    assert.ok(request.url.startsWith("/api/"), "only local application routes may be called");
    const response = await h.worker.request(request.url, request.init);
    const text = await response.clone().text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    replies.push({ url: request.url, status: response.status, body });
    return response;
  };
  const failure = () => JSON.stringify({ replies, toast: h.store.ui.toast, appendFailure: h.store.appendFailure.get() });
  const bytes = triangleGlb();
  const uploaded = await h.store.uploadModel3dFile(new File([bytes], "triangle.glb", { type: MODEL3D_MIME_TYPE }), () => true, { rightsConfirmed: true });
  assert.equal(uploaded, true, failure());
  const original = h.store.projection.get().libraryBlocks.find((block) => block.type === "model3d" && block.properties.label === "triangle.glb");
  assert.ok(original, failure());
  assert.equal(original.documentId, h.worker.documentId);
  assert.equal(original.properties.model_mime_type, MODEL3D_MIME_TYPE);
  assert.equal(original.properties.model_content_hash, digest(bytes));
  assert.ok(original.properties.model_reference_id);
  assert.equal(original.properties.media_url, undefined, "the original model has no unreviewed image view");
  assert.equal(original.properties.reference_id, undefined);
  assert.equal(original.properties.model_view, undefined);
  assert.equal(await verifyModel3dBlockAssets(h.worker.env, h.worker.owner, original.properties), true);
  const originalKey = mediaKey(original.properties.model_url);
  const retainedModel = rows.get(originalKey);
  assert.deepEqual(retainedModel.bytes, new Uint8Array(bytes));
  assert.equal(retainedModel.httpMetadata.contentType, MODEL3D_MIME_TYPE);
  assert.equal(retainedModel.customMetadata.ownerId, h.worker.owner);
  assert.equal(retainedModel.customMetadata.modelFormat, "glb");
  assert.equal(retainedModel.customMetadata.sha256, digest(bytes));

  // This is a valid synthetic capture PNG; the test exercises persistence and
  // custody, not WebGL rendering or the visual fidelity of a chosen camera.
  const imageBytes = png({ width: 1024, height: 1024 });
  const view = model3dPresetView();
  const saved = await h.store.saveModel3dView(original.id, {
    blob: new Blob([imageBytes], { type: "image/png" }), view, src: original.properties.model_url,
  });
  assert.equal(saved, true, failure());
  const updated = h.store.projection.get().libraryBlocks.find((block) => block.id === original.id);
  assert.ok(updated?.properties.media_url);
  assert.equal(updated.properties.model_url, original.properties.model_url);
  assert.equal(updated.properties.model_content_hash, original.properties.model_content_hash);
  assert.equal(updated.properties.model_reference_id, original.properties.model_reference_id);
  assert.notEqual(updated.properties.reference_id, updated.properties.model_reference_id);
  assert.notEqual(updated.properties.media_url, updated.properties.model_url);
  assert.equal(updated.properties.media_type, "image/png");
  assert.equal(updated.properties.source_content_hash, digest(imageBytes));
  assert.notEqual(updated.properties.source_content_hash, updated.properties.model_content_hash);
  assert.deepEqual(updated.properties.model_view, view);
  assert.equal(await verifyModel3dBlockAssets(h.worker.env, h.worker.owner, updated.properties), true);
  const retainedImage = rows.get(mediaKey(updated.properties.media_url));
  assert.deepEqual(retainedImage.bytes, imageBytes);
  assert.equal(retainedImage.customMetadata.ownerId, h.worker.owner);
  assert.equal(retainedImage.customMetadata.sha256, digest(imageBytes));
  assert.equal(retainedImage.customMetadata.modelSourceKey, originalKey);
  assert.equal(retainedImage.customMetadata.modelSourceSha256, digest(bytes));
  assert.equal(retainedImage.customMetadata.modelView, JSON.stringify(normalizeModel3dView(view)));

  for (const [referenceId, sourceType, url, hash] of [
    [updated.properties.model_reference_id, "model3d-upload", updated.properties.model_url, updated.properties.model_content_hash],
    [updated.properties.reference_id, "model3d-view", updated.properties.media_url, updated.properties.source_content_hash],
  ]) {
    const receipt = h.store.events.get().find((event) => event.type === "ReferenceIngested" && event.payload.reference_id === referenceId);
    assert.ok(receipt);
    assert.equal(receipt.payload.source_type, sourceType);
    assert.equal(receipt.payload.source_ref, url);
    assert.equal(receipt.payload.content_hash, hash);
    assert.ok(h.store.events.get().some((event) => event.type === "RightsAsserted" && event.payload.reference_id === referenceId));
  }
  assert.equal(rows.size, 2);
  assert.equal(replies.filter((reply) => reply.url === "/api/media" && reply.status === 200).length, 2, failure());
  assert.equal(replies.filter((reply) => reply.url === "/api/events" && reply.status === 200).length, 2, failure());
  assert.ok(replies.every((reply) => reply.status < 400), failure());

  for (const [path, value] of [["model_view", model3dPresetView("back")], ["model_content_hash", "f".repeat(64)]]) {
    const response = await h.worker.request("/api/events", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "append", expectedSequence: h.store.head.get(), event: {
        type: "BlockPropertyEdited", payload: { project_id: h.worker.projectId, document_id: h.worker.documentId,
          block_id: updated.id, property_path: path, old_value: updated.properties[path], new_value: value, source_surface: "model3d-viewer" },
      } }),
    });
    const body = await response.json();
    assert.equal(response.status, 403, JSON.stringify(body));
    assert.equal(body.error, "model3d_asset_not_verified", JSON.stringify(body));
  }
  await h.store.refreshEvents();
  const afterRejectedEdit = h.store.projection.get().libraryBlocks.find((block) => block.id === updated.id);
  assert.deepEqual(afterRejectedEdit.properties, updated.properties, "rejected edits cannot detach the saved PNG from its camera and original model");
  assert.equal(await verifyModel3dBlockAssets(h.worker.env, h.worker.owner, afterRejectedEdit.properties), true);
  const generated = await storeGeneratedMedia(h.worker.env, h.worker.owner, "retained-model-download", bytes, "simulation", MODEL3D_MIME_TYPE);
  const download = await h.worker.request(generated.url);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), MODEL3D_MIME_TYPE);
  assert.match(download.headers.get("content-disposition"), /filename="retained-model-download\.glb"/);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), new Uint8Array(bytes));
});

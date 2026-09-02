import assert from "node:assert/strict";
import test from "node:test";
import { exportArchive, exportProjectArchive, importArchive, projectArchiveEvents } from "../src/model/archive.ts";
import { publicEventPayload } from "../worker/event-privacy.ts";

const media = (name, owner = "owner-1") => `/api/media/${encodeURIComponent(`${owner}/models/${name}`)}`;
const hash = (character) => character.repeat(64);
const event = (sequence, type, payload) => ({
  eventId: `model3d-archive-${sequence}`, streamId: "creative:owner-1", sequence,
  occurredAt: "2026-08-31T12:00:00.000Z", recordedAt: "2026-08-31T12:00:00.000Z",
  actor: "user", clientId: "test", correlationId: "model3d-archive", causationId: null,
  compensatesEventId: null, schemaVersion: 1, type, payload,
});
const file = (name, mimeType, role, character) => ({
  url: media(name), mimeType, role, fileName: name, fileSize: 1234,
  format: name.split(".").at(-1), sha256: hash(character),
});

test("3D artifacts archive every owned mesh, texture and preview with original file metadata", () => {
  const files = [
    file("vessel.glb", "model/gltf-binary", "mesh", "a"),
    file("vessel.obj", "model/obj", "mesh", "b"),
    file("vessel-base-color.png", "image/png", "texture", "c"),
    file("vessel-preview.webp", "image/webp", "preview", "d"),
  ];
  const rows = [event(1, "DocumentRenderCompleted", {
    project_id: "project-one", artifact_id: "model-output", artifact_kind: "model3d",
    media_url: files[0].url, media_type: "model/gltf-binary",
    settings: { model3d_files: [...files,
      { ...files[0], url: media("foreign.glb", "another-owner") },
      { ...files[0], url: "https://provider.example/private.glb" },
      { ...files[0], url: `${media("query.glb")}?download=1` },
      null, "invalid",
    ] },
  })];
  const archive = exportProjectArchive(rows, "project-one");
  assert.equal(archive.mediaManifest.length, files.length);
  for (const source of files) assert.deepEqual(archive.mediaManifest.find((entry) => entry.sourceRef === source.url), {
    sourceRef: source.url, rightsClass: "account-generated", artifactId: "model-output",
    role: source.role, mediaType: source.mimeType, fileName: source.fileName,
    fileSize: source.fileSize, format: source.format, sha256: source.sha256,
  });
  assert.deepEqual(importArchive(JSON.parse(JSON.stringify(archive))).events, rows);
  assert.ok(archive.mediaManifest.filter((entry) => entry.role === "mesh").every((entry) => entry.mediaType.startsWith("model/")));
});

test("3D context archives preserve the original GLB and separately saved image with receipt-bound hashes", () => {
  const model = media("source.glb"), firstView = media("front.png"), secondView = media("side.png");
  const rows = [
    event(1, "ReferenceIngested", { reference_id: "model-reference", source_ref: model, source_mime_type: "model/gltf-binary", content_hash: hash("a"), rights_class: "owned" }),
    event(2, "ReferenceIngested", { reference_id: "first-view", source_ref: firstView, source_mime_type: "image/png", content_hash: hash("b"), rights_class: "owned" }),
    event(3, "BlockCreated", { block_id: "model-block", type: "model3d", properties: {
      model_url: model, model_mime_type: "model/gltf-binary", model_content_hash: hash("a"), model_reference_id: "model-reference",
      media_url: firstView, media_type: "image/png", source_mime_type: "image/png", source_content_hash: hash("b"), reference_id: "first-view",
    } }),
    event(4, "ReferenceIngested", { reference_id: "second-view", source_ref: secondView, source_mime_type: "image/png", content_hash: hash("c"), rights_class: "owned" }),
    // Saving an updated camera can edit the hash before the URL in the same batch.
    event(5, "BlockPropertyEdited", { block_id: "model-block", property_path: "source_content_hash", new_value: hash("c") }),
    event(6, "BlockPropertyEdited", { block_id: "model-block", property_path: "media_url", new_value: secondView }),
    event(7, "BlockPropertyEdited", { block_id: "model-block", property_path: "reference_id", new_value: "second-view" }),
    event(8, "BlockRemoved", { block_id: "model-block" }),
  ];
  const before = structuredClone(rows), archive = exportArchive(rows);
  assert.deepEqual(rows, before, "archive reconstruction must not mutate event properties");
  assert.deepEqual(archive.mediaManifest, [
    { sourceRef: model, rightsClass: "owned", blockId: "model-block", role: "mesh", mediaType: "model/gltf-binary", sha256: hash("a") },
    { sourceRef: firstView, rightsClass: "owned", blockId: "model-block", role: "model3d-view", mediaType: "image/png", sha256: hash("b") },
    { sourceRef: secondView, rightsClass: "owned", blockId: "model-block", role: "model3d-view", mediaType: "image/png", sha256: hash("c") },
  ]);
});

test("model URL, attachment and settings edits retain historical files without relabeling a mesh as an image", () => {
  const first = media("original.glb"), replacement = media("replacement.glb");
  const texture = file("texture.png", "image/png", "texture", "c");
  const preview = file("preview.png", "image/png", "preview", "d");
  const rows = [
    event(1, "BlockCreated", { block_id: "model-block", type: "model3d", properties: {
      model_url: first, model_mime_type: "model/gltf-binary", model_content_hash: hash("a"),
      media_url: first, media_type: "image/png",
    } }),
    event(2, "BlockPropertyEdited", { block_id: "model-block", property_path: "media_url", new_value: null }),
    event(3, "BlockPropertyEdited", { block_id: "model-block", property_path: "model_url", new_value: replacement }),
    event(4, "BlockPropertyEdited", { block_id: "model-block", property_path: "model_content_hash", new_value: hash("b") }),
    event(5, "BlockPropertyEdited", { block_id: "model-block", property_path: "model3d_files", new_value: [texture] }),
    event(6, "BlockPropertyEdited", { block_id: "model-block", property_path: "settings", new_value: { model3d_files: [preview] } }),
    event(7, "BlockPropertyEdited", { block_id: "model-block", property_path: "model3d_files", new_value: [] }),
    event(8, "BlockPropertyEdited", { block_id: "model-block", property_path: "settings", new_value: {} }),
  ];
  const manifest = exportArchive(rows).mediaManifest;
  assert.equal(manifest.length, 4);
  assert.deepEqual(manifest.filter((entry) => entry.role === "mesh").map((entry) => [entry.sourceRef, entry.mediaType, entry.sha256]), [
    [first, "model/gltf-binary", hash("a")], [replacement, "model/gltf-binary", hash("b")],
  ]);
  assert.deepEqual(manifest.filter((entry) => entry.role !== "mesh").map((entry) => [entry.sourceRef, entry.role, entry.sha256]), [
    [texture.url, "texture", texture.sha256], [preview.url, "preview", preview.sha256],
  ]);
});

test("project archives recover model and edited-view ownership across interleaved projects and late completions", () => {
  const rows = [
    event(1, "ProjectCreated", { project_id: "project-one" }),
    event(2, "DocumentCreated", { project_id: "project-one", document_id: "document-one" }),
    event(3, "ProjectCreated", { project_id: "project-two" }),
    event(4, "ReferenceIngested", { reference_id: "model-reference", source_ref: media("owned.glb"), rights_class: "owned" }),
    event(5, "RightsAsserted", { reference_id: "model-reference", rights_class: "owned" }),
    event(6, "BlockCreated", { document_id: "document-one", block_id: "model-block", type: "model3d", properties: { model_reference_id: "model-reference", model_url: media("owned.glb"), model_mime_type: "model/gltf-binary" } }),
    event(7, "BlockPropertyEdited", { block_id: "model-block", property_path: "reference_id", new_value: "new-view" }),
    event(8, "ReferenceIngested", { reference_id: "new-view", source_ref: media("owned-view.png"), rights_class: "owned" }),
    event(9, "RightsAsserted", { reference_id: "new-view", rights_class: "owned" }),
    event(10, "BlockPropertyEdited", { block_id: "model-block", property_path: "model_reference_id", new_value: "new-model-reference" }),
    event(11, "ReferenceIngested", { reference_id: "new-model-reference", source_ref: media("owned-new.glb"), rights_class: "owned" }),
    event(12, "RightsAsserted", { reference_id: "new-model-reference", rights_class: "owned" }),
    event(13, "ReferenceIngested", { reference_id: "foreign-reference", source_ref: media("second-project.glb"), rights_class: "owned" }),
    event(14, "DocumentRenderRequested", { document_id: "document-one", artifact_id: "model-artifact", artifact_kind: "model3d" }),
    event(15, "ProjectOpened", { project_id: "project-two" }),
    event(16, "DocumentRenderCompleted", { artifact_id: "model-artifact", artifact_kind: "model3d", media_url: media("generated.glb"), media_type: "model/gltf-binary" }),
  ];
  const selected = projectArchiveEvents(rows, "project-one");
  assert.deepEqual(selected.map((entry) => entry.sequence), [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16]);
  const archive = exportProjectArchive(rows, "project-one");
  assert.doesNotMatch(JSON.stringify(archive), /project-two|foreign-reference|second-project/);
  assert.equal(archive.mediaManifest.find((entry) => entry.sourceRef === media("generated.glb"))?.role, "mesh");
});

test("reused 3D source URLs deduplicate while non-media reference records remain available", () => {
  const source = media("source.glb");
  const rows = [
    event(1, "ReferenceIngested", { reference_id: "original", source_ref: source, rights_class: "owned", content_hash: hash("a") }),
    event(2, "ReferenceIngested", { reference_id: "reuse", source_ref: source, rights_class: "owned", content_hash: hash("a") }),
    event(3, "ReferenceIngested", { reference_id: "citation", source_ref: "https://example.com/sculpture", rights_class: "cited" }),
    event(4, "ReferenceIngested", { reference_id: "foreign", source_ref: media("private.glb", "another-owner"), rights_class: "owned" }),
    event(5, "BlockCreated", { block_id: "model-block", type: "model3d", properties: { model_url: source, model_mime_type: "model/gltf-binary" } }),
  ];
  const manifest = exportArchive(rows).mediaManifest;
  assert.equal(manifest.length, 2);
  assert.equal(manifest.filter((entry) => entry.sourceRef === source).length, 1);
  assert.equal(manifest.find((entry) => entry.sourceRef === source)?.sha256, hash("a"));
  assert.ok(manifest.some((entry) => entry.sourceRef === "https://example.com/sculpture"));
});

test("ChipEdited model history preserves replacement files, saved views and reference ownership", () => {
  const original = media("original.glb"), replacement = media("replacement.glb"), view = media("saved-view.png");
  const texture = file("texture.png", "image/png", "texture", "d"), preview = file("preview.png", "image/png", "preview", "e");
  const rows = [
    event(1, "ProjectCreated", { project_id: "project-one" }),
    event(2, "DocumentCreated", { project_id: "project-one", document_id: "document-one" }),
    event(3, "BlockCreated", { document_id: "document-one", block_id: "model-block", type: "model3d", properties: { model_url: original, model_mime_type: "model/gltf-binary", model_content_hash: hash("a") } }),
    event(4, "ProjectCreated", { project_id: "project-two" }),
    event(5, "ChipEdited", { block_id: "model-block", property: "model_reference_id", new_value: "new-model-reference" }),
    event(6, "ReferenceIngested", { reference_id: "new-model-reference", source_ref: replacement, source_mime_type: "model/gltf-binary", content_hash: hash("b"), rights_class: "owned" }),
    event(7, "RightsAsserted", { reference_id: "new-model-reference", rights_class: "owned" }),
    event(8, "ChipEdited", { block_id: "model-block", property: "model_url", new_value: replacement }),
    event(9, "ChipEdited", { block_id: "model-block", property: "model_content_hash", new_value: hash("b") }),
    event(10, "ChipEdited", { block_id: "model-block", property: "reference_id", new_value: "new-view-reference" }),
    event(11, "ReferenceIngested", { reference_id: "new-view-reference", source_ref: view, source_mime_type: "image/png", content_hash: hash("c"), rights_class: "owned" }),
    event(12, "RightsAsserted", { reference_id: "new-view-reference", rights_class: "owned" }),
    event(13, "ChipEdited", { block_id: "model-block", property: "media_url", new_value: view }),
    event(14, "ChipEdited", { block_id: "model-block", property: "media_type", new_value: "image/png" }),
    event(15, "ChipEdited", { block_id: "model-block", property: "source_content_hash", new_value: hash("c") }),
    event(16, "ChipEdited", { block_id: "model-block", property: "model3d_files", new_value: [texture] }),
    event(17, "ChipEdited", { block_id: "model-block", property: "settings", new_value: { model3d_files: [preview] } }),
    event(18, "ChipEdited", { block_id: "model-block", property: "media_url", new_value: null }),
    event(19, "ReferenceIngested", { reference_id: "foreign-reference", source_ref: media("second-project.glb"), rights_class: "owned" }),
  ];
  const archive = exportProjectArchive(rows, "project-one");
  assert.deepEqual(archive.events.map((entry) => entry.sequence), [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.doesNotMatch(JSON.stringify(archive), /project-two|foreign-reference|second-project/);
  const expected = [
    [original, "mesh", "model/gltf-binary", hash("a")],
    [replacement, "mesh", "model/gltf-binary", hash("b")],
    [view, "model3d-view", "image/png", hash("c")],
    [texture.url, "texture", texture.mimeType, texture.sha256],
    [preview.url, "preview", preview.mimeType, preview.sha256],
  ];
  assert.equal(archive.mediaManifest.length, expected.length);
  for (const [url, role, mimeType, sha256] of expected) {
    const entry = archive.mediaManifest.find((candidate) => candidate.sourceRef === url);
    assert.deepEqual([entry?.role, entry?.mediaType, entry?.sha256], [role, mimeType, sha256]);
  }
});

test("public event payloads keep original model URLs, filenames and attachment manifests private", () => {
  const mesh = file("private-sculpture.glb", "model/gltf-binary", "mesh", "a");
  const payloads = [
    { block_id: "model-block", type: "model3d", properties: { model_url: mesh.url, model_content_hash: mesh.sha256, model_reference_id: "private-model-reference" } },
    { block_id: "model-block", property_path: "model_url", new_value: mesh.url },
    { artifact_id: "model-artifact", artifact_kind: "model3d", model_url: mesh.url, model3d_files: [mesh], settings: { model3d_files: [mesh] } },
  ];
  for (const payload of payloads) {
    const result = publicEventPayload("private-event", payload);
    assert.deepEqual(JSON.parse(result.privateJson), payload);
    assert.equal(result.payload._private_ref, "private-event");
    assert.doesNotMatch(JSON.stringify(result.payload), /private-sculpture|private-model-reference|\/api\/media\/|model3d_files/);
    assert.equal(Object.hasOwn(result.payload, "model_url"), false);
    assert.equal(Object.hasOwn(result.payload, "settings"), false);
  }
});

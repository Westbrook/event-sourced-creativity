import assert from "node:assert/strict";
import test from "node:test";
import { MAX_MODEL3D_UPLOAD_BYTES } from "../src/model/model3d-assets.ts";
import { model3dCurrentProjectionFile, model3dRevisionFile, parseModel3dCurrentProjection, parseModel3dMediaRevision } from "../src/model/model3d-media-revision.ts";
import { foldEvents } from "../src/model/events.ts";

// Declared revision metadata only. No bytes are scaled or persisted here; the
// accepted writer and current edit/source witnesses establish those separately.
function fixture() {
  return { schemaVersion: 1, operation: "uniform-scale",
    media: { url: "/api/media/" + encodeURIComponent("owner/generated/derived.glb"), mediaType: "model/gltf-binary",
      sha256: "c".repeat(64), byteLength: 2048, fileName: "Authored model.glb" },
    source: { url: "/api/media/" + encodeURIComponent("owner/generated/original.glb"), sha256: "b".repeat(64),
      byteLength: 1024, revision: 7, contentSha256: "a".repeat(64) },
    factor: 2,
    beforeBounds: { min: [-1, -2, -3], max: [1, 2, 3], size: [2, 4, 6] },
    afterBounds: { min: [-2, -4, -6], max: [2, 4, 6], size: [4, 8, 12] },
    vertexCount: 8, positionAccessorCount: 1 };
}
function refused(value) {
  assert.equal(parseModel3dMediaRevision(value), null);
  assert.equal(model3dRevisionFile(value), null, "invalid metadata never projects a downloadable derivative");
}

test("canonical parsing preserves source and derivative identities and exact field order from reversed input", () => {
  const expected = fixture();
  const reverse = value => Object.fromEntries(Object.entries(value).reverse());
  const input = reverse({ ...expected, media: reverse(expected.media), source: reverse(expected.source),
    beforeBounds: reverse(expected.beforeBounds), afterBounds: reverse(expected.afterBounds) });
  const original = structuredClone(input), parsed = parseModel3dMediaRevision(input);
  assert.deepEqual(parsed, expected); assert.deepEqual(input, original);
  assert.notEqual(JSON.stringify(input), JSON.stringify(expected));
  assert.equal(JSON.stringify(parsed), JSON.stringify(expected), "stable metadata serialization order");
  assert.equal(parsed.source.revision, 7, "source revision is retained; no new saved revision is invented");
  assert.notEqual(parsed.source.sha256, parsed.source.contentSha256, "GLB and artifact JSON hashes remain separate");
});

test("schema, source identity, factor and count constraints reject malformed and cross-format metadata", () => {
  for (const patch of [{ schemaVersion: 2 }, { schemaVersion: "1" }, { operation: "trim" },
    { factor: 0 }, { factor: -1 }, { factor: 1 }, { factor: Infinity }, { factor: NaN }, { factor: "2" },
    { vertexCount: 0 }, { vertexCount: 1.5 }, { vertexCount: Number.MAX_SAFE_INTEGER + 1 },
    { positionAccessorCount: 0 }, { positionAccessorCount: 9 }, { positionAccessorCount: 1.5 },
    { video_revision: {} }, { audio_revision: {} }]) refused({ ...fixture(), ...patch });
  for (const patch of [{ revision: -1 }, { revision: 1.5 }, { revision: "7" }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { contentSha256: "short" }, { sha256: "B".repeat(64) }, { artifactId: "unrecognized-source-field" }]) {
    const value = fixture(); Object.assign(value.source, patch); refused(value);
  }
  const zero = fixture(); zero.source.revision = 0; assert.equal(parseModel3dMediaRevision(zero).source.revision, 0);
  const sameHash = fixture(); sameHash.media.sha256 = sameHash.source.sha256; refused(sameHash);
  const sameUrl = fixture(); sameUrl.media.url = sameUrl.source.url; refused(sameUrl);
});

test("only canonical private GLB references, safe display names and bounded positive file sizes are accepted", () => {
  for (const url of ["https://example.invalid/model.glb", "/api/media/../model.glb", "/api/media/..%2Fmodel.glb",
    "/api/media/a%2fb.glb", "/api/media/a%5Cb.glb", "/api/media/a%00b.glb", "/api/media/%", "/api/media/", "/api/media/" + "a".repeat(2048)]) {
    for (const key of ["media", "source"]) { const value = fixture(); value[key].url = url; refused(value); }
  }
  for (const patch of [{ mediaType: "model/obj" }, { mediaType: "model/gltf-binary; charset=utf-8" },
    { fileName: "../model.glb" }, { fileName: "a\\b.glb" }, { fileName: "model\n.glb" }, { fileName: " model.glb" },
    { fileName: "model.glb " }, { fileName: ".glb" }, { fileName: "model.obj" }, { fileName: "x".repeat(237) + ".glb" },
    { format: "fbx" }]) { const value = fixture(); Object.assign(value.media, patch); refused(value); }
  for (const byteLength of [0, -1, 1.5, "1024", MAX_MODEL3D_UPLOAD_BYTES + 1]) {
    for (const key of ["media", "source"]) { const value = fixture(); value[key].byteLength = byteLength; refused(value); }
  }
  const bounded = fixture(); bounded.media.byteLength = MAX_MODEL3D_UPLOAD_BYTES; bounded.source.byteLength = MAX_MODEL3D_UPLOAD_BYTES;
  bounded.media.fileName = "模型 café.GLB";
  assert.equal(parseModel3dMediaRevision(bounded).media.byteLength, MAX_MODEL3D_UPLOAD_BYTES, "metadata boundary needs no large allocation");
});

test("bounds require exact three-component Float32 extrema and exact nonnegative double-precision extents", () => {
  for (const patch of [{ min: [0, 0] }, { max: [1, 2, 3, 4] }, { min: [-1.1, -2, -3] },
    { min: [-Infinity, -2, -3] }, { max: [1, NaN, 3] }, { min: [2, -2, -3] },
    { size: [2, 4, 5] }, { size: [2, -4, 6] }, { size: [2, 4, "6"] }, { extra: true }]) {
    const value = fixture(); Object.assign(value.beforeBounds, patch); refused(value);
  }
  const value = fixture(), largest = (2 - 2 ** -23) * 2 ** 127;
  value.factor = 0.5;
  value.beforeBounds = { min: [-largest, 0, 0], max: [largest, 0, 0], size: [2 * largest, 0, 0] };
  value.afterBounds = { min: [-largest / 2, 0, 0], max: [largest / 2, 0, 0], size: [largest, 0, 0] };
  assert.ok(Number.isFinite(value.beforeBounds.size[0])); assert.equal(Math.fround(value.beforeBounds.size[0]), Infinity);
  assert.deepEqual(parseModel3dMediaRevision(value).beforeBounds, value.beforeBounds, "size is exact max-min, not an extra Float32 rounding");
});

test("after extrema must match rounded positive scaling rather than merely plausible new bounds", () => {
  const wrong = fixture(); wrong.afterBounds.min[0] = -3; wrong.afterBounds.size[0] = 5; refused(wrong);
  const reversed = fixture(); [reversed.beforeBounds, reversed.afterBounds] = [reversed.afterBounds, reversed.beforeBounds]; refused(reversed);
  const value = fixture(); value.factor = 1.1;
  value.afterBounds.min = value.beforeBounds.min.map(number => Math.fround(number * 1.1));
  value.afterBounds.max = value.beforeBounds.max.map(number => Math.fround(number * 1.1));
  value.afterBounds.size = value.afterBounds.max.map((number, axis) => number - value.afterBounds.min[axis]);
  assert.deepEqual(parseModel3dMediaRevision(value).afterBounds, value.afterBounds);
  const overflow = fixture(); overflow.factor = Number.MAX_VALUE; refused(overflow);
});

test("unchanged outer bounds remain valid metadata for a changed interior Float32 vertex", () => {
  const value = fixture(); value.factor = 1 + 5e-8; value.vertexCount = 3;
  value.beforeBounds = { min: [0, 0, 0], max: [2, 2, 0], size: [2, 2, 0] };
  value.afterBounds = structuredClone(value.beforeBounds);
  assert.equal(Math.fround(2 * value.factor), 2);
  assert.notEqual(Math.fround(1.5 * value.factor), 1.5, "a changed interior coordinate need not move the outer bound");
  const parsed = parseModel3dMediaRevision(value); assert.ok(parsed); assert.deepEqual(parsed.afterBounds, parsed.beforeBounds);
  assert.notEqual(parsed.media.sha256, parsed.source.sha256, "the record still requires distinct file identities");
});

test("parsed nested values are owned and the projected file contains only the authored derivative", () => {
  const input = fixture(), original = structuredClone(input), parsed = parseModel3dMediaRevision(input), file = model3dRevisionFile(input);
  assert.deepEqual(file, { url: input.media.url, mimeType: "model/gltf-binary", fileName: input.media.fileName,
    fileSize: input.media.byteLength, format: "glb", role: "mesh", sha256: input.media.sha256, previewSupported: true });
  assert.notEqual(file.url, input.source.url); assert.notEqual(file.sha256, input.source.sha256);
  assert.notEqual(parsed, input); assert.notEqual(parsed.media, input.media); assert.notEqual(parsed.source, input.source);
  assert.notEqual(parsed.beforeBounds.min, input.beforeBounds.min); assert.notEqual(parsed.afterBounds.size, input.afterBounds.size);
  parsed.media.fileName = "caller change.glb"; parsed.source.revision = 99; parsed.beforeBounds.min[0] = -100; parsed.afterBounds.size[0] = 100;
  assert.deepEqual(input, original);
  input.media.url = "/api/media/changed.glb";
  assert.equal(file.url, original.media.url, "the projected descriptor has no mutable source references");
});

test("closed own-data parsing rejects hidden keys, prototypes, array tricks, accessors and coercion without calling them", () => {
  const cases = [null, undefined, [], JSON.stringify(fixture()), new Date(), Object.assign(Object.create({ inherited: true }), fixture())];
  const extra = fixture(); Object.defineProperty(extra, "hidden", { value: true }); cases.push(extra);
  const symbol = fixture(); symbol[Symbol("extra")] = true; cases.push(symbol);
  const missing = fixture(); delete missing.source.contentSha256; cases.push(missing);
  const sparse = fixture(); delete sparse.beforeBounds.min[1]; cases.push(sparse);
  const arrayExtra = fixture(); arrayExtra.afterBounds.max.extra = true; cases.push(arrayExtra);
  let reads = 0;
  for (const path of [["factor"], ["media", "url"], ["source", "revision"], ["beforeBounds", "min"], ["afterBounds", "max", "1"]]) {
    const value = fixture(); let target = value;
    for (const key of path.slice(0, -1)) target = target[key];
    Object.defineProperty(target, path.at(-1), { enumerable: true, get() { reads++; throw new Error("getter must not run"); } }); cases.push(value);
  }
  const coercion = fixture(); coercion.factor = { valueOf() { reads++; return 2; } }; cases.push(coercion);
  const boxed = fixture(); boxed.source.revision = Object(7); cases.push(boxed);
  for (const value of cases) refused(value);
  assert.equal(reads, 0);
});

function currentProjection(revision = 1) {
  return { schemaVersion: 1, revision, contentSha256: "d".repeat(64), media: fixture().media };
}
function projectionRefused(value) {
  assert.equal(parseModel3dCurrentProjection(value), null);
  assert.equal(model3dCurrentProjectionFile(value), null);
}

test("shared current-file projection is a canonical owned descriptor separate from the full private revision", () => {
  const expected = currentProjection(), reverse = value => Object.fromEntries(Object.entries(value).reverse());
  const input = reverse({ ...expected, media: reverse(expected.media) }), original = structuredClone(input);
  const parsed = parseModel3dCurrentProjection(input), file = model3dCurrentProjectionFile(input);
  assert.deepEqual(parsed, expected); assert.equal(JSON.stringify(parsed), JSON.stringify(expected));
  assert.deepEqual(file, model3dRevisionFile(fixture()));
  assert.notEqual(parsed, input); assert.notEqual(parsed.media, input.media);
  parsed.media.fileName = "Changed by caller.glb"; parsed.revision = 20;
  assert.deepEqual(input, original); input.media.url = "/api/media/other.glb";
  assert.equal(file.url, expected.media.url); assert.equal(file.fileSize, expected.media.byteLength);
  assert.equal(parseModel3dMediaRevision(expected), null, "a current projection is not a private source-chain witness");
  assert.equal(parseModel3dCurrentProjection(fixture()), null, "full private metadata cannot substitute for the closed projection");
});

test("shared current projection refuses malformed identities, media, hidden fields and getters without coercion", () => {
  for (const patch of [{ schemaVersion: 2 }, { revision: 0 }, { revision: 1.5 }, { revision: "1" },
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { contentSha256: "D".repeat(64) }, { contentSha256: "short" },
    { source: fixture().source }, { factor: 2 }, { video_revision: {} }, { audio_revision: {} }]) projectionRefused({ ...currentProjection(), ...patch });
  for (const patch of [{ url: "https://example.invalid/model.glb" }, { url: "/api/media/a%2fb.glb" }, { url: "/api/media/..%2Fa.glb" },
    { url: "/api/media/a%00b.glb" }, { mediaType: "model/obj" }, { sha256: "C".repeat(64) },
    { byteLength: 0 }, { byteLength: "2048" }, { byteLength: MAX_MODEL3D_UPLOAD_BYTES + 1 },
    { fileName: "../model.glb" }, { fileName: "model.obj" }, { fileName: " model.glb" }, { role: "mesh" }]) {
    const value = currentProjection(); Object.assign(value.media, patch); projectionRefused(value);
  }
  let reads = 0;
  const values = [null, [], JSON.stringify(currentProjection()), Object.assign(Object.create({ inherited: true }), currentProjection())];
  for (const path of [["revision"], ["media"], ["media", "url"], ["media", "sha256"]]) {
    const value = currentProjection(), target = path.length === 1 ? value : value.media;
    Object.defineProperty(target, path.at(-1), { enumerable: true, get() { reads++; throw Error("getter must not run"); } }); values.push(value);
  }
  for (const nested of [false, true]) {
    const hidden = currentProjection(); Object.defineProperty(nested ? hidden.media : hidden, "hidden", { value: true }); values.push(hidden);
    const symbolic = currentProjection(); (nested ? symbolic.media : symbolic)[Symbol("extra")] = true; values.push(symbolic);
  }
  const boxed = currentProjection(); boxed.revision = { valueOf() { reads++; return 1; } }; values.push(boxed);
  for (const value of values) projectionRefused(value);
  assert.equal(reads, 0);
  const bounded = currentProjection(); bounded.media.byteLength = MAX_MODEL3D_UPLOAD_BYTES;
  assert.equal(parseModel3dCurrentProjection(bounded).media.byteLength, MAX_MODEL3D_UPLOAD_BYTES);
});

// Pure projection controls use synthetic already-presented events. Their project
// stream label proves no membership or media access; the server supplies that
// authorization separately. Inactive source/original URLs are deliberately absent.
function foldFixture({ redacted = true, streamId = "project:access-a" } = {}) {
  const full = fixture(); full.source.revision = 0;
  const originalFile = { url: full.source.url, mimeType: "model/gltf-binary", fileName: "Original.glb",
    fileSize: full.source.byteLength, format: "glb", role: "mesh", sha256: full.source.sha256, previewSupported: true };
  const privateRevision = structuredClone(full); if (redacted) delete privateRevision.source.url;
  const event = (type, payload, sequence) => ({ eventId: "event-" + sequence, streamId, sequence,
    occurredAt: "2026-09-10T00:00:00.000Z", recordedAt: "2026-09-10T00:00:00.000Z", actor: "user",
    clientId: "fixture-client", correlationId: "fixture-correlation", causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload });
  const identity = { artifact_id: "model-a", artifact_kind: "model3d", document_id: "document-a", project_id: "project-a", content_ref: "content-a" };
  const completion = event("DocumentRenderCompleted", { ...identity, title: "Model", item_count: 0, items: [],
    media_url: redacted ? null : originalFile.url, media_type: redacted ? null : originalFile.mimeType,
    settings: { model3d_files: redacted ? [] : [originalFile] } }, 3);
  const edit = event("DocumentArtifactEdited", { ...identity, revision: 1, content_sha256: "d".repeat(64),
    source_surface: "document-artifact-model3d-scale", model3d_revision: privateRevision, model3d_current_projection: currentProjection() }, 4);
  const events = [event("ProjectCreated", { project_id: "project-a", name: "Shared project" }, 1),
    event("DocumentCreated", { project_id: "project-a", document_id: "document-a", title: "Model document" }, 2), completion, edit];
  return { events, event, identity, completion, edit, full };
}
function folded(f) {
  const result = foldEvents(f.events).libraryArtifacts.find(artifact => artifact.id === "model-a");
  assert.ok(result); return result;
}
function unavailableProjection(f) {
  const artifact = folded(f);
  assert.equal(artifact.mediaUrl, null); assert.equal(artifact.mediaType, null);
  assert.deepEqual(artifact.settings.model3d_files, []); assert.equal(artifact.settings.source_media_sha256, null);
}

test("project fold uses the exact current projection when inactive private references are redacted", () => {
  const f = foldFixture(), before = structuredClone(f.events);
  assert.equal(parseModel3dMediaRevision(f.edit.payload.model3d_revision), null);
  assert.notEqual(f.edit.streamId.slice("project:".length), f.edit.payload.project_id, "access ID and project ID are distinct");
  const artifact = folded(f), file = model3dCurrentProjectionFile(currentProjection());
  assert.equal(artifact.mediaUrl, file.url); assert.equal(artifact.mediaType, file.mimeType);
  assert.deepEqual(artifact.settings.model3d_files, [file]); assert.equal(artifact.settings.source_media_sha256, file.sha256);
  assert.deepEqual(artifact.items, []); assert.equal(artifact.itemCount, 0); assert.deepEqual(f.events, before);
  const missing = foldFixture(); delete missing.edit.payload.model3d_current_projection; unavailableProjection(missing);
  const later = foldFixture();
  later.events.splice(3, 0, later.event("DocumentArtifactEdited", { ...later.identity, revision: 1 }, 4));
  later.edit.sequence = 5; later.edit.eventId = "event-5"; later.edit.payload.revision = 2;
  later.edit.payload.model3d_current_projection = currentProjection(2);
  assert.equal(folded(later).mediaUrl, file.url, "every observed edit contributes to the selected revision");
  later.events.push(later.event("DocumentArtifactEdited", { ...later.identity, revision: 3,
    source_surface: "document-artifact-model3d-scale", model3d_revision: later.edit.payload.model3d_revision }, 6));
  unavailableProjection(later);
});

test("invalid or nonproject projection markers clear media rather than falling through to a valid private revision", () => {
  const personal = foldFixture({ redacted: false, streamId: "user:owner-a" });
  delete personal.edit.payload.model3d_current_projection;
  assert.equal(folded(personal).mediaUrl, personal.full.media.url, "the full private path retains its prior behavior");
  for (const mutate of [
    f => { f.edit.streamId = "user:owner-a"; }, f => { f.edit.streamId = "project:"; },
    f => { f.edit.payload.model3d_current_projection = null; },
    f => { f.edit.payload.model3d_current_projection.media.url = "https://example.invalid/model.glb"; },
    f => { f.edit.payload.project_id = "other-project"; }, f => { f.edit.payload.document_id = "other-document"; },
    f => { f.edit.payload.content_ref = "other-content"; }, f => { f.edit.payload.artifact_kind = "video"; },
    f => { f.edit.payload.artifact_id = Object("model-a"); },
    f => { f.edit.payload.revision = 2; }, f => { f.edit.payload.model3d_current_projection.revision = 2; },
    f => { f.edit.payload.revision = 2; f.edit.payload.model3d_current_projection.revision = 2; },
    f => { f.edit.payload.content_sha256 = "e".repeat(64); }, f => { delete f.edit.payload.content_sha256; },
    f => { f.edit.payload.audio_revision = null; }, f => { f.edit.payload.video_revision = null; },
    f => { f.completion.payload.item_count = 1; }, f => { f.completion.payload.items = [{ id: "invented-item" }]; },
  ]) {
    const f = foldFixture({ redacted: false }); assert.ok(parseModel3dMediaRevision(f.edit.payload.model3d_revision));
    mutate(f); unavailableProjection(f);
  }
});

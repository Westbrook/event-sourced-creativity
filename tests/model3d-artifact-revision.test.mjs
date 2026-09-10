import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  Model3dArtifactRevisionError, parseModel3dScaleEditRequest, prepareModel3dArtifactScale,
} from "../src/model/model3d-artifact-revision.ts";
import { GeometryScaleError } from "../src/model/model3d-geometry-edit.ts";

// Declared local GLBs and caller-supplied artifact snapshots. These pure checks
// prove preparation, not provider generation, permission, persistence, a saved
// numbered revision, a current server head, or a rendered WebGL view.
const hash = value => createHash("sha256").update(value).digest("hex");
const cube = [
  [-1, -2, -3], [1, -2, -3], [1, 2, -3], [-1, 2, -3],
  [-1, -2, 3], [1, -2, 3], [1, 2, 3], [-1, 2, 3],
];
const cubeIndices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
  3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
const bounds = points => {
  const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])));
  return { min, max, size: max.map((value, axis) => value - min[axis]) };
};

function mesh(points = cube, indices = cubeIndices, transform = null) {
  const positionBytes = points.length * 12, bin = Buffer.alloc(positionBytes + indices.length * 2);
  points.flat().forEach((value, index) => bin.writeFloatLE(value, index * 4));
  indices.forEach((value, index) => bin.writeUInt16LE(value, positionBytes + index * 2));
  const extent = bounds(points);
  const model = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, ...(transform ?? {}) }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes, byteLength: indices.length * 2, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: points.length, type: "VEC3", min: extent.min, max: extent.max },
      { bufferView: 1, componentType: 5123, count: indices.length, type: "SCALAR" }],
    extras: { declaredFixture: "local geometry preparation only" },
  };
  const json = Buffer.from(JSON.stringify(model)), jsonLength = Math.ceil(json.length / 4) * 4, binLength = Math.ceil(bin.length / 4) * 4;
  const bytes = Buffer.alloc(28 + jsonLength + binLength);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonLength, 12); bytes.writeUInt32LE(0x4e4f534a, 16);
  bytes.fill(0x20, 20, 20 + jsonLength); json.copy(bytes, 20);
  bytes.writeUInt32LE(binLength, 20 + jsonLength); bytes.writeUInt32LE(0x004e4942, 24 + jsonLength); bin.copy(bytes, 28 + jsonLength);
  return new Uint8Array(bytes);
}

// Independent GLB framing/accessor reader, intentionally not a writer helper.
function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67); assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.byteLength); assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const jsonLength = view.getUint32(12, true), binLength = view.getUint32(20 + jsonLength, true);
  assert.equal(jsonLength % 4, 0); assert.equal(binLength % 4, 0);
  assert.equal(view.getUint32(24 + jsonLength, true), 0x004e4942); assert.equal(bytes.byteLength, 28 + jsonLength + binLength);
  const model = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)));
  const bin = bytes.subarray(28 + jsonLength), binary = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const primitive = model.meshes[0].primitives[0], position = model.accessors[primitive.attributes.POSITION];
  assert.equal(position.componentType, 5126); assert.equal(position.type, "VEC3");
  const positionView = model.bufferViews[position.bufferView];
  const points = Array.from({ length: position.count }, (_, vertex) => [0, 1, 2].map(axis => binary.getFloat32(
    (positionView.byteOffset ?? 0) + (position.byteOffset ?? 0) + vertex * (positionView.byteStride ?? 12) + axis * 4, true)));
  const index = model.accessors[primitive.indices], indexView = model.bufferViews[index.bufferView];
  assert.equal(index.componentType, 5123); assert.equal(index.type, "SCALAR");
  const indices = Array.from({ length: index.count }, (_, i) => binary.getUint16((indexView.byteOffset ?? 0) + (index.byteOffset ?? 0) + i * 2, true));
  return { model, bin, points, indices, position };
}

function fixture(bytes = mesh()) {
  const rawContent = JSON.stringify({ title: "Declared generated Model3D fixture", summary: "Retained synthetic source only.",
    content_markdown: "An indexed cube; geometry editing does not prove provider generation.", presentation: null,
    items: [{ title: "Cube", body: "Static mesh", notes: "Preserve the original.", image_prompt: "", context_group_ids: [], slide: null }] }, null, 2) + "\n";
  const current = { artifactKind: "model3d", artifactId: "generated-model3d-artifact", documentId: "mesh-document", projectId: "mesh-project",
    sourceEventId: "model3d-render-completed-event", revision: 7, contentSha256: hash(rawContent),
    mediaUrl: "/api/media/" + encodeURIComponent("owner/mesh/source.glb"), mediaSha256: hash(bytes), byteLength: bytes.byteLength };
  return { captured: structuredClone(current), current, rawContent, bytes, factor: 2 };
}
const requestFor = (source, factor, bytes) => ({ expectedRevision: source.revision, expectedContentSha256: source.contentSha256,
  model3dScale: { sourceMediaSha256: source.mediaSha256, factor, resultMediaSha256: hash(bytes) } });
async function refuses(input, code) {
  await assert.rejects(prepareModel3dArtifactScale(input), error => {
    assert.ok(error instanceof Model3dArtifactRevisionError); assert.equal(error.code, code); return true;
  });
}

test("prepared cube changes actual vertices and binds exact artifact, JSON and GLB identities without replacing the source", async () => {
  const input = fixture(), original = structuredClone(input), before = decode(input.bytes);
  const result = await prepareModel3dArtifactScale(input), edited = decode(result.geometry.bytes);
  const expectedPoints = cube.map(point => point.map(value => Math.fround(value * 2)));
  assert.equal(result.status, "prepared"); assert.equal(result.geometry.changed, true);
  assert.equal(result.geometry.factor, 2); assert.equal(result.geometry.vertexCount, 8); assert.equal(result.geometry.positionAccessorCount, 1);
  assert.deepEqual(edited.points, expectedPoints); assert.deepEqual(edited.indices, cubeIndices);
  assert.deepEqual(result.geometry.beforeBounds, bounds(cube)); assert.deepEqual(result.geometry.afterBounds, bounds(expectedPoints));
  assert.deepEqual(edited.position.min, bounds(expectedPoints).min); assert.deepEqual(edited.position.max, bounds(expectedPoints).max);
  assert.deepEqual(edited.bin.subarray(0, before.bin.length), before.bin);
  for (const key of ["nodes", "scenes", "extras"]) assert.deepEqual(edited.model[key], before.model[key]);
  assert.deepEqual(result.source, original.current); assert.notEqual(result.source, input.current); assert.notEqual(result.source, input.captured);
  assert.deepEqual(result.request, requestFor(original.current, 2, result.geometry.bytes));
  assert.deepEqual(parseModel3dScaleEditRequest(result.request), result.request);
  assert.notEqual(result.request.model3dScale.sourceMediaSha256, result.request.model3dScale.resultMediaSha256);
  assert.notEqual(result.source.contentSha256, result.source.mediaSha256, "serialized artifact JSON and GLB have distinct raw hashes");
  assert.deepEqual(input, original); assert.notEqual(result.geometry.bytes.buffer, input.bytes.buffer);
  assert.equal(result.request.expectedRevision, 7, "preparation carries an expected revision; it does not save revision 8");
  assert.deepEqual(Object.keys(result.request).sort(), ["expectedContentSha256", "expectedRevision", "model3dScale"]);
});

test("every valid captured/current identity mismatch refuses, including null versus a project and a newer revision", async () => {
  const alternatives = { artifactId: "other-artifact", documentId: "other-document", projectId: null,
    sourceEventId: "other-render-event", revision: 8, contentSha256: "a".repeat(64),
    mediaUrl: "/api/media/other.glb", mediaSha256: "b".repeat(64), byteLength: mesh().byteLength + 4 };
  for (const [key, value] of Object.entries(alternatives)) {
    const input = fixture(); input.current[key] = value;
    const original = structuredClone(input); await refuses(input, "source_changed"); assert.deepEqual(input, original, key);
  }
  const noProject = fixture(); noProject.current.projectId = null; noProject.captured.projectId = null;
  const result = await prepareModel3dArtifactScale(noProject); assert.equal(result.source.projectId, null); assert.equal(result.status, "prepared");
});

test("malformed or accessor-bearing source snapshots refuse without invoking getters or coercion", async () => {
  for (const patch of [{ artifactKind: "video" }, { artifactId: "" }, { documentId: "bad\nidentifier" },
    { sourceEventId: "x".repeat(1025) }, { projectId: 4 }, { revision: -1 }, { revision: 1.5 }, { revision: Number.MAX_SAFE_INTEGER + 1 },
    { contentSha256: "not-a-sha" }, { mediaSha256: "short" }, { byteLength: 0 }, { byteLength: 1.5 },
    { mediaUrl: "https://example.invalid/source.glb" }, { mediaUrl: "/api/media/..%2Fsource.glb" }, { mediaUrl: "/api/media/a%5Cb.glb" },
    { mediaUrl: "/api/media/a%2fb.glb" }, { extra: "not a source field" }]) {
    const input = fixture(); Object.assign(input.captured, patch); await refuses(input, "invalid_source");
  }
  let reads = 0;
  const getter = fixture(); Object.defineProperty(getter.current, "mediaSha256", { enumerable: true, get() { reads++; throw new Error("getter must not run"); } });
  await refuses(getter, "invalid_source"); assert.equal(reads, 0);
  const coercion = fixture(); coercion.current.revision = { valueOf() { reads++; return 7; } };
  await refuses(coercion, "invalid_source"); assert.equal(reads, 0);
});

test("GLB bytes and length and exact raw JSON are checked independently without normalizing content", async () => {
  const changedBytes = fixture(); changedBytes.bytes[changedBytes.bytes.length - 1] ^= 1;
  await refuses(changedBytes, "media_mismatch");
  const wrongLength = fixture(); wrongLength.current.byteLength += 4; wrongLength.captured.byteLength += 4;
  await refuses(wrongLength, "media_mismatch");
  const forgedLength = fixture(), nativeLength = forgedLength.bytes.byteLength;
  forgedLength.current.byteLength = nativeLength + 4; forgedLength.captured.byteLength = nativeLength + 4;
  Object.defineProperty(forgedLength.bytes, "byteLength", { value: nativeLength + 4 });
  assert.equal(forgedLength.bytes.byteLength, nativeLength + 4);
  assert.equal(hash(forgedLength.bytes), forgedLength.current.mediaSha256, "the real N bytes still match the source hash");
  await refuses(forgedLength, "media_mismatch");
  const normalized = fixture(); normalized.rawContent = JSON.stringify(JSON.parse(normalized.rawContent));
  assert.deepEqual(JSON.parse(normalized.rawContent), JSON.parse(fixture().rawContent));
  await refuses(normalized, "content_mismatch");
  const wrongContent = fixture(); wrongContent.rawContent += " "; await refuses(wrongContent, "content_mismatch");
  const nonString = fixture(); nonString.rawContent = JSON.parse(nonString.rawContent); await refuses(nonString, "invalid_source");
  const triangle = fixture(mesh([[0, 0, 0], [1, 0, 0], [0, 1, 1]], [0, 1, 2]));
  triangle.factor = 0.5; triangle.bytes = triangle.bytes.buffer;
  const result = await prepareModel3dArtifactScale(triangle), output = decode(result.geometry.bytes);
  assert.deepEqual(output.points, [[0, 0, 0], [0.5, 0, 0], [0, 0.5, 0.5]]); assert.deepEqual(output.indices, [0, 1, 2]);
  assert.deepEqual(result.geometry.afterBounds, bounds(output.points));
});

test("unit and Float32-ineffective changes return independent original bytes and no revision request", async () => {
  for (const factor of [1, 1 + Number.EPSILON]) {
    const input = fixture(); input.factor = factor; const original = structuredClone(input);
    const result = await prepareModel3dArtifactScale(input);
    assert.equal(result.status, "unchanged"); assert.equal(result.request, null); assert.equal(result.geometry.changed, false);
    assert.deepEqual(result.geometry.bytes, original.bytes); assert.deepEqual(result.geometry.beforeBounds, result.geometry.afterBounds);
    assert.deepEqual(result.source, original.current); assert.notEqual(result.geometry.bytes.buffer, input.bytes.buffer);
    result.geometry.bytes[0] = 0; result.source.artifactId = "caller-mutated-result";
    assert.deepEqual(input, original, "returned owned data cannot mutate the source");
  }
});

test("unsupported geometry and invalid or imprecise factors retain the writer's typed refusal without source mutation", async () => {
  for (const [input, code] of [[fixture(mesh(cube, cubeIndices, { translation: [1, 0, 0] })), "unsupported"],
    [{ ...fixture(), factor: 0 }, "factor"], [{ ...fixture(), factor: Number.MAX_VALUE }, "precision"]]) {
    const original = structuredClone(input);
    await assert.rejects(prepareModel3dArtifactScale(input), error => {
      assert.ok(error instanceof GeometryScaleError); assert.equal(error.code, code); return true;
    });
    assert.deepEqual(input, original);
  }
});

test("a caller-supplied later-revision fixture scales its current derivative and refuses the old tuple without claiming a save", async () => {
  const firstInput = fixture(), first = await prepareModel3dArtifactScale(firstInput), firstBytes = first.geometry.bytes.slice();
  // This is an explicit fixture representing a possible later read. No server,
  // Store, media upload, ACK or saved revision is constructed by this test.
  const later = fixture(first.geometry.bytes);
  later.rawContent = JSON.stringify({ ...JSON.parse(later.rawContent), summary: "Caller-supplied later-revision fixture; no save was performed." }) + "\n";
  later.current.revision = 8; later.current.contentSha256 = hash(later.rawContent);
  later.current.mediaUrl = "/api/media/" + encodeURIComponent("owner/mesh/derivative.glb");
  later.captured = structuredClone(later.current); later.factor = 0.5;
  const stale = { ...later, captured: firstInput.captured }; await refuses(stale, "source_changed");
  const second = await prepareModel3dArtifactScale(later), decoded = decode(second.geometry.bytes), previous = decode(firstBytes);
  assert.equal(second.status, "prepared"); assert.equal(second.request.expectedRevision, 8);
  assert.equal(second.request.model3dScale.sourceMediaSha256, hash(firstBytes)); assert.deepEqual(decoded.points, cube);
  assert.deepEqual(decoded.bin.subarray(0, previous.bin.length), previous.bin);
  assert.deepEqual(first.geometry.bytes, firstBytes); assert.deepEqual(firstInput.bytes, fixture().bytes);
  assert.deepEqual(second.source, later.current); assert.notEqual(second.request.model3dScale.resultMediaSha256, firstInput.current.mediaSha256,
    "same coordinates do not imply the original file: preceding BIN streams remain preserved");
});

test("preparation owns source snapshots, option values and GLB bytes before its first digest yields", async () => {
  const input = fixture(), captured = structuredClone(input), pending = prepareModel3dArtifactScale(input);
  input.bytes.fill(0); input.current.artifactId = "changed-after-call"; input.captured.revision = 99;
  input.current.mediaSha256 = "f".repeat(64); input.rawContent = "changed after call"; input.factor = 3;
  const result = await pending;
  assert.equal(result.status, "prepared"); assert.deepEqual(result.source, captured.current);
  assert.deepEqual(result.request, requestFor(captured.current, 2, result.geometry.bytes));
  assert.deepEqual(decode(result.geometry.bytes).points, cube.map(point => point.map(value => value * 2)));
  assert.equal(result.request.expectedContentSha256, hash(captured.rawContent));
  assert.equal(result.request.model3dScale.sourceMediaSha256, hash(captured.bytes));
});

test("the parser returns only an owned copy of the canonical prepared scale request", async () => {
  const input = fixture(), prepared = await prepareModel3dArtifactScale(input), request = prepared.request;
  assert.ok(request);
  const reversed = { model3dScale: { resultMediaSha256: request.model3dScale.resultMediaSha256,
    factor: request.model3dScale.factor, sourceMediaSha256: request.model3dScale.sourceMediaSha256 },
    expectedContentSha256: request.expectedContentSha256, expectedRevision: request.expectedRevision };
  const parsed = parseModel3dScaleEditRequest(reversed);
  assert.deepEqual(parsed, request); assert.notEqual(parsed, reversed); assert.notEqual(parsed.model3dScale, reversed.model3dScale);
  assert.notEqual(JSON.stringify(reversed), JSON.stringify(request));
  assert.equal(JSON.stringify(parsed), JSON.stringify({ expectedRevision: input.current.revision,
    expectedContentSha256: input.current.contentSha256, model3dScale: { sourceMediaSha256: input.current.mediaSha256,
      factor: 2, resultMediaSha256: hash(prepared.geometry.bytes) } }), "canonical field order is stable for request fingerprints");
  assert.deepEqual(Object.keys(parsed).sort(), ["expectedContentSha256", "expectedRevision", "model3dScale"]);
  assert.deepEqual(Object.keys(parsed.model3dScale).sort(), ["factor", "resultMediaSha256", "sourceMediaSha256"]);
  parsed.model3dScale.factor = 4; parsed.expectedRevision = 90;
  assert.equal(request.model3dScale.factor, 2); assert.equal(request.expectedRevision, 7);
});

test("closed request parsing rejects extra fields, prototypes, getters and coercion without executing them", () => {
  const valid = () => ({ expectedRevision: 7, expectedContentSha256: "a".repeat(64),
    model3dScale: { sourceMediaSha256: "b".repeat(64), factor: 2, resultMediaSha256: "c".repeat(64) } });
  const cases = [null, undefined, [], JSON.stringify(valid()), new Date(), Object.assign(Object.create({ inherited: true }), valid()),
    { ...valid(), extra: true }, { ...valid(), expectedRevision: "7" }, { ...valid(), expectedRevision: -1 },
    { ...valid(), expectedRevision: 1.5 }, { ...valid(), expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid(), expectedContentSha256: "short" }, { ...valid(), model3dScale: null },
    { ...valid(), model3dScale: { ...valid().model3dScale, mediaUrl: "/api/media/invented.glb" } },
    { ...valid(), model3dScale: { ...valid().model3dScale, sourceMediaSha256: "short" } },
    { ...valid(), model3dScale: { ...valid().model3dScale, resultMediaSha256: null } },
    ...[0, -1, 1, Infinity, NaN, "2", Object(2)].map(factor => ({ ...valid(), model3dScale: { ...valid().model3dScale, factor } }))];
  const sameHash = valid(); sameHash.model3dScale.resultMediaSha256 = sameHash.model3dScale.sourceMediaSha256; cases.push(sameHash);
  const missing = valid(); delete missing.expectedRevision; cases.push(missing);
  const extraHidden = valid(); Object.defineProperty(extraHidden, "hiddenExtra", { value: true }); cases.push(extraHidden);
  const extraSymbol = valid(); extraSymbol[Symbol("extra")] = true; cases.push(extraSymbol);
  let reads = 0;
  const getter = valid(); Object.defineProperty(getter, "expectedRevision", { enumerable: true, get() { reads++; throw new Error("outer getter"); } }); cases.push(getter);
  const nestedGetter = valid(); Object.defineProperty(nestedGetter.model3dScale, "factor", { enumerable: true, get() { reads++; throw new Error("nested getter"); } }); cases.push(nestedGetter);
  const coercion = valid(); coercion.expectedRevision = { valueOf() { reads++; return 7; } }; cases.push(coercion);
  for (const value of cases) assert.equal(parseModel3dScaleEditRequest(value), null);
  assert.equal(reads, 0, "parsing never executes supplied accessors or value coercion");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { png, pngChunk, utf8 } from "./output-asset-fixtures.mjs";
import { GENERATED_IMAGE_EDIT_LIMITS, prepareGeneratedImageEdit } from "../src/model/generated-image-edit.ts";
import { createReferenceComposition, addReferenceCompositionLayer } from "../src/model/reference-composition.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";

// Authored structural PNGs only. These controls exercise the preparation core,
// not native compositor pixels, authentication, a Save, a URL or a new revision.
const digest = value => createHash("sha256").update(value).digest("hex");
const originalBytes = png({ width: 24, height: 24 });
const editedBytes = png({ width: 1536, height: 864 });
const rawJson = '{ "title": "Café 雨", "extensions": { "future": [1, true, null], "retained": "  exact  " } }\n';
function fixture({ fullSizeOriginal = false } = {}) {
  const originalPng = new Uint8Array(fullSizeOriginal ? editedBytes : originalBytes);
  const media = { url: `/api/media/${encodeURIComponent(ownerMediaNamespace("team:a") + "/generated/source-image.png")}`,
    mediaType: "image/png", sha256: digest(originalPng), width: fullSizeOriginal ? 1536 : 24, height: fullSizeOriginal ? 864 : 24 };
  const basis = { kind: "generated-image", ownerId: "team:a", documentId: "document-image", outputId: "generated-output",
    generationId: "image-generation", sourceEventId: "image-event", contentRef: "private-image-content", revision: 3,
    rawJson, contentSha256: digest(rawJson), media };
  const source = { id: "generated-source", blockId: "generated-reference", label: "Original image", mediaUrl: media.url,
    contentHash: media.sha256, kind: "image" };
  const recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "retained-layer");
  const input = { basis, sources: [structuredClone(source)], sourceId: source.id, recipe, originalPng, editedPng: new Uint8Array(editedBytes) };
  let state = structuredClone({ basis, sources: input.sources });
  return { input, current: () => state, setCurrent: value => { state = value; }, resetCurrent: () => { state = structuredClone({ basis: input.basis, sources: input.sources }); } };
}
function sourceMedia(f, values) {
  Object.assign(f.input.basis.media, values);
  for (const source of [f.input.sources[0], f.input.recipe.sources[0]]) {
    source.mediaUrl = f.input.basis.media.url; source.contentHash = f.input.basis.media.sha256;
  }
}
async function assertRefused(f, code, current = f.current) {
  const result = await prepareGeneratedImageEdit(f.input, current);
  assert.deepEqual(result, { status: "refused", code });
  assert.ok(Object.isFrozen(result));
}

test("prepares exact supplied identity and isolated PNG copies without creating a saved result", async () => {
  const f = fixture(), before = structuredClone(f.input);
  const result = await prepareGeneratedImageEdit(f.input, f.current);
  assert.equal(result.status, "prepared");
  try {
    const { rawJson: omittedRaw, ...expected } = before.basis;
    assert.equal(omittedRaw, rawJson); assert.deepEqual(result.expected, expected);
    assert.equal(result.expected.revision, 3); assert.equal(Object.hasOwn(result.expected, "rawJson"), false);
    assert.equal(result.sourceId, before.sourceId); assert.deepEqual(result.recipe, before.recipe);
    assert.equal(result.recipeSha256, digest(JSON.stringify(before.recipe)));
    assert.deepEqual(result.png, { mediaType: "image/png", sha256: digest(before.editedPng), byteLength: before.editedPng.length, width: 1536, height: 864 });
    assert.equal(result.unchangedBytes, false); assert.equal(Object.hasOwn(result, "unchangedPixels"), false);
    assert.deepEqual(Object.keys(result).sort(), ["status", "expected", "sourceId", "recipe", "recipeSha256", "png", "unchangedBytes", "copyPng", "dispose"].sort());
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.expected) && Object.isFrozen(result.expected.media));
    assert.ok(Object.isFrozen(result.recipe) && Object.isFrozen(result.recipe.sources) && Object.isFrozen(result.recipe.layers[0]) && Object.isFrozen(result.png));
    assert.throws(() => { result.expected.media.width = 1; }, TypeError);
    assert.throws(() => { result.recipe.layers[0].x = 1; }, TypeError);
    const first = result.copyPng(), second = result.copyPng();
    assert.deepEqual(first, before.editedPng); assert.deepEqual(second, before.editedPng);
    assert.notEqual(first.buffer, second.buffer); assert.notEqual(first.buffer, f.input.editedPng.buffer);
    first.fill(0); assert.deepEqual(second, before.editedPng); assert.deepEqual(result.copyPng(), before.editedPng);
    result.dispose(); result.dispose(); assert.equal(result.copyPng(), null);
    assert.deepEqual(second, before.editedPng, "a returned private copy remains independently owned after disposal");
    assert.deepEqual(f.input, before, "private cleanup does not clear supplied arrays or mutate metadata");
  } finally { result.dispose(); }
});

test("unchangedBytes compares complete encoded PNG hashes, including ancillary bytes", async () => {
  const f = fixture({ fullSizeOriginal: true });
  const same = await prepareGeneratedImageEdit(f.input, f.current);
  assert.equal(same.status, "prepared"); assert.equal(same.unchangedBytes, true); same.dispose();
  f.input.editedPng = png({ width: 1536, height: 864, extraChunks: [pngChunk("tEXt", utf8("Comment\0different ancillary bytes"))] });
  assert.notEqual(digest(f.input.originalPng), digest(f.input.editedPng));
  const different = await prepareGeneratedImageEdit(f.input, f.current);
  assert.equal(different.status, "prepared");
  try { assert.equal(different.unchangedBytes, false); assert.deepEqual(different.copyPng(), f.input.editedPng); }
  finally { different.dispose(); }
});

test("raw JSON extensions are retained in the exact hash rather than normalized away", async () => {
  const f = fixture(), normalized = JSON.stringify(JSON.parse(f.input.basis.rawJson));
  assert.notEqual(digest(normalized), f.input.basis.contentSha256);
  const prepared = await prepareGeneratedImageEdit(f.input, f.current);
  assert.equal(prepared.status, "prepared"); assert.equal(prepared.expected.contentSha256, digest(rawJson)); prepared.dispose();
  f.input.basis.contentSha256 = digest(normalized); f.resetCurrent(); await assertRefused(f, "invalid");
  const exact = fixture(), changed = exact.current(); changed.basis.rawJson = normalized; changed.basis.contentSha256 = digest(normalized);
  await assertRefused(exact, "source_changed");
});

test("metadata keys and available-source order may differ while recipe order is retained", async () => {
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  const f = fixture();
  f.input.recipe = addReferenceCompositionLayer(f.input.recipe, f.input.sources[0], "front-layer");
  f.input.recipe.layers[0].x = 25; f.input.recipe.layers[1].x = 75;
  const expectedRecipe = structuredClone(f.input.recipe);
  f.input.basis = reorder(f.input.basis); f.input.sources = reorder(f.input.sources); f.input.recipe = reorder(f.input.recipe);
  f.setCurrent({ sources: reorder(f.input.sources), basis: reorder(f.input.basis) });
  const prepared = await prepareGeneratedImageEdit(f.input, f.current);
  assert.equal(prepared.status, "prepared");
  try { assert.deepEqual(prepared.recipe, expectedRecipe); assert.equal(prepared.recipeSha256, digest(JSON.stringify(expectedRecipe))); assert.deepEqual(prepared.copyPng(), editedBytes); }
  finally { prepared.dispose(); }
  const arrayOrder = fixture(); arrayOrder.input.sources.push({ ...arrayOrder.input.sources[0], id: "other-source", blockId: "other-block" });
  arrayOrder.resetCurrent(); arrayOrder.current().sources.reverse();
  const reordered = await prepareGeneratedImageEdit(arrayOrder.input, arrayOrder.current);
  assert.equal(reordered.status, "prepared");
  try { assert.deepEqual(reordered.recipe, arrayOrder.input.recipe); assert.deepEqual(reordered.copyPng(), editedBytes); }
  finally { reordered.dispose(); }
});

test("input bytes and metadata are captured before the first await", async () => {
  const f = fixture(), before = structuredClone(f.input);
  const pending = prepareGeneratedImageEdit(f.input, f.current);
  f.input.originalPng.fill(0); f.input.editedPng.fill(0); f.input.basis.ownerId = "replacement";
  f.input.recipe.layers[0].x = 1; f.input.sources[0].contentHash = "a".repeat(64);
  const prepared = await pending; assert.equal(prepared.status, "prepared");
  try { assert.equal(prepared.expected.ownerId, before.basis.ownerId); assert.deepEqual(prepared.recipe, before.recipe); assert.deepEqual(prepared.copyPng(), before.editedPng); }
  finally { prepared.dispose(); }
  assert.ok(f.input.originalPng.every(value => value === 0)); assert.ok(f.input.editedPng.every(value => value === 0));
});

test("a source change during preparation refuses and a later restoration cannot revive retired bytes", async () => {
  const early = fixture(), pending = prepareGeneratedImageEdit(early.input, early.current);
  early.current().basis.revision++;
  assert.deepEqual(await pending, { status: "refused", code: "source_changed" });
  const f = fixture(), originalCurrent = structuredClone(f.current()), prepared = await prepareGeneratedImageEdit(f.input, f.current);
  assert.equal(prepared.status, "prepared");
  const ownedCopy = prepared.copyPng(); f.current().basis.sourceEventId = "different-event";
  assert.equal(prepared.copyPng(), null); f.setCurrent(originalCurrent); assert.equal(prepared.copyPng(), null);
  assert.deepEqual(ownedCopy, editedBytes); prepared.dispose();
});

test("current callbacks can dispose synchronously and cannot reanimate private bytes", async () => {
  const f = fixture(); let disposeDuringRead = false, prepared;
  prepared = await prepareGeneratedImageEdit(f.input, () => { if (disposeDuringRead) prepared.dispose(); return f.current(); });
  assert.equal(prepared.status, "prepared"); disposeDuringRead = true;
  assert.equal(prepared.copyPng(), null); disposeDuringRead = false; assert.equal(prepared.copyPng(), null); prepared.dispose();
  assert.deepEqual(await prepareGeneratedImageEdit(f.input, () => { throw new Error("retired current source"); }), { status: "refused", code: "source_changed" });
  assert.deepEqual(await prepareGeneratedImageEdit(f.input, () => null), { status: "refused", code: "source_changed" });
});

test("nonzero-offset arrays use intrinsic storage, not shadowed byte or iterator accessors", async () => {
  const f = fixture(); let accessed = 0;
  for (const key of ["originalPng", "editedPng"]) {
    const source = f.input[key], backing = new Uint8Array(source.length + 14).fill(77); backing.set(source, 7);
    const view = backing.subarray(7, 7 + source.length);
    for (const property of ["buffer", "byteLength", "length", Symbol.iterator]) Object.defineProperty(view, property, { get() { accessed++; throw new Error("shadowed accessor invoked"); } });
    f.input[key] = view;
  }
  const prepared = await prepareGeneratedImageEdit(f.input, f.current);
  assert.equal(prepared.status, "prepared");
  try { assert.deepEqual(prepared.copyPng(), editedBytes); assert.equal(accessed, 0); }
  finally { prepared.dispose(); }
  assert.equal(accessed, 0);
});

const invalidCases = [
  ["negative revision", f => { f.input.basis.revision = -1; }],
  ["fractional revision", f => { f.input.basis.revision = 0.5; }],
  ["unsafe revision", f => { f.input.basis.revision = Number.MAX_SAFE_INTEGER + 1; }],
  ["nonfinite revision", f => { f.input.basis.revision = Infinity; }],
  ["numeric-string revision", f => { f.input.basis.revision = "3"; }],
  ["wrong output kind", f => { f.input.basis.kind = "document-artifact"; }],
  ["missing generation identity", f => { f.input.basis.generationId = ""; }],
  ["control character owner", f => { f.input.basis.ownerId = "team\u0000a"; }],
  ["foreign canonical owner URL", f => sourceMedia(f, { url: `/api/media/${encodeURIComponent(ownerMediaNamespace("other-owner") + "/generated/image.png")}` })],
  ["legacy colliding owner namespace", f => sourceMedia(f, { url: "/api/media/team-a%2Fgenerated%2Fimage.png" })],
  ["noncanonical URL encoding", f => sourceMedia(f, { url: f.input.basis.media.url.replace(/%2F/g, "%2f") })],
  ["generated directory substitution", f => sourceMedia(f, { url: `/api/media/${encodeURIComponent(ownerMediaNamespace("team:a") + "/uploads/image.png")}` })],
  ["wrong file extension", f => sourceMedia(f, { url: f.input.basis.media.url.replace(/\.png$/, ".jpg") })],
  ["remote source URL", f => sourceMedia(f, { url: "https://example.invalid/image.png" })],
  ["wrong media type", f => sourceMedia(f, { mediaType: "image/jpeg" })],
  ["source byte hash mismatch", f => sourceMedia(f, { sha256: "a".repeat(64) })],
  ["original PNG width mismatch", f => sourceMedia(f, { width: 25 })],
  ["fractional PNG dimensions", f => sourceMedia(f, { height: 24.5 })],
  ["PNG dimensions exceed declared cap", f => sourceMedia(f, { width: 16_385 })],
  ["edited PNG dimensions mismatch recipe", f => { f.input.editedPng = new Uint8Array(originalBytes); }],
  ["absent selected recipe source", f => { f.input.sourceId = "missing-source"; }],
  ["wrong selected source kind", f => { f.input.sources[0].kind = "model-view"; f.input.recipe.sources[0].kind = "model-view"; }],
  ["stale eligible source hash", f => { f.input.sources[0].contentHash = "a".repeat(64); }],
  ["locked eligible source", f => { f.input.sources[0].requiresUnlock = true; }],
  ["duplicate eligible source", f => { f.input.sources.push(structuredClone(f.input.sources[0])); }],
  ["source list beyond finite cap", f => { for (let i = 1; i <= 12; i++) f.input.sources.push({ ...f.input.sources[0], id: "source-" + i }); }],
  ["empty recipe", f => { f.input.recipe.layers = []; }],
  ["nonfinite recipe placement", f => { f.input.recipe.layers[0].x = NaN; }],
  ["unknown recipe metadata", f => { f.input.recipe.unbound = true; }],
  ["empty PNG array", f => { f.input.editedPng = new Uint8Array(); }],
  ["PNG array beyond byte cap", f => { f.input.editedPng = new Uint8Array(GENERATED_IMAGE_EDIT_LIMITS.pngBytes + 1); }],
  ["ordinary array instead of byte view", f => { f.input.editedPng = [...f.input.editedPng]; }],
  ["Uint8Array subclass", f => { f.input.editedPng = new (class extends Uint8Array {})(editedBytes); }],
  ["shared byte storage", f => { f.input.editedPng = new Uint8Array(new SharedArrayBuffer(editedBytes.length)); f.input.editedPng.set(editedBytes); }],
  ["malformed raw JSON", f => { f.input.basis.rawJson = "{"; f.input.basis.contentSha256 = digest("{"); }],
  ["array raw JSON", f => { f.input.basis.rawJson = "[]"; f.input.basis.contentSha256 = digest("[]"); }],
  ["raw JSON beyond byte cap", f => { f.input.basis.rawJson = JSON.stringify({ extension: "x".repeat(GENERATED_IMAGE_EDIT_LIMITS.rawBytes) }); f.input.basis.contentSha256 = digest(f.input.basis.rawJson); }],
  ["sparse source array", f => { f.input.sources.length = 2; }],
  ["array extra property", f => { f.input.recipe.layers.unbound = true; }],
  ["symbol metadata key", f => { f.input.basis[Symbol("unbound")] = true; }],
  ["metadata cycle", f => { f.input.basis.cycle = f.input.basis; }],
  ["nonplain metadata prototype", f => { Object.setPrototypeOf(f.input.basis, { foreign: true }); }],
  ["metadata depth beyond finite bound", f => { let value = {}; for (let i = 0; i <= GENERATED_IMAGE_EDIT_LIMITS.depth; i++) value = { nested: value }; f.input.basis.unbound = value; }],
  ["metadata nodes beyond finite bound", f => { f.input.basis.unbound = Array(GENERATED_IMAGE_EDIT_LIMITS.nodes).fill(null); }],
];
for (const [name, change] of invalidCases) test("refuses invalid preparation: " + name, async () => {
  const f = fixture(); change(f);
  // Keep the declared current source aligned with this malformed input so a
  // currentness mismatch cannot conceal a missing validation or PNG check.
  await assertRefused(f, "invalid", () => ({ basis: f.input.basis, sources: f.input.sources }));
});

for (const which of ["originalPng", "editedPng"]) test("refuses corrupt PNG CRC in " + which, async () => {
  const f = fixture(); f.input[which][29] ^= 1;
  if (which === "originalPng") { sourceMedia(f, { sha256: digest(f.input.originalPng) }); f.resetCurrent(); }
  await assertRefused(f, "unsupported");
});
test("refuses structurally unsupported edited PNG rather than preparing its bytes", async () => {
  const f = fixture(); f.input.editedPng = png({ width: 1536, height: 864, interlace: 1 });
  await assertRefused(f, "unsupported");
});

test("metadata accessors and toJSON are never evaluated", async () => {
  for (const location of ["input", "basis", "layer", "toJSON", "current"]) {
    const f = fixture(); let accesses = 0;
    const get = () => { accesses++; throw new Error("accessor executed"); };
    if (location === "input") Object.defineProperty(f.input, "basis", { enumerable: true, get });
    if (location === "basis") Object.defineProperty(f.input.basis, "ownerId", { enumerable: true, get });
    if (location === "layer") Object.defineProperty(f.input.recipe.layers, "0", { enumerable: true, get });
    if (location === "toJSON") f.input.basis.toJSON = () => { accesses++; return {}; };
    const current = location === "current" ? () => Object.defineProperty({ sources: f.input.sources }, "basis", { enumerable: true, get }) : f.current;
    assert.deepEqual(await prepareGeneratedImageEdit(f.input, current), { status: "refused", code: location === "current" ? "source_changed" : "invalid" });
    assert.equal(accesses, 0, location);
  }
});

test("a normalized twelve-source recipe still respects the serialized recipe byte cap", async () => {
  const f = fixture();
  for (let index = 1; index < 12; index++) {
    const source = { id: `source-${index}-` + "s".repeat(230), blockId: `block-${index}-` + "b".repeat(230), label: "l".repeat(160),
      mediaUrl: `/api/media/${encodeURIComponent("other-reference/" + index + "-" + "p".repeat(1900) + ".png")}`,
      contentHash: "b".repeat(64), kind: "image" };
    f.input.sources.push(source);
    f.input.recipe = addReferenceCompositionLayer(f.input.recipe, source, `layer-${index}-` + "l".repeat(230));
  }
  assert.equal(f.input.sources.length, 12); assert.equal(f.input.recipe.sources.length, 12); assert.equal(f.input.recipe.layers.length, 12);
  assert.ok(new TextEncoder().encode(JSON.stringify(f.input.recipe)).byteLength > GENERATED_IMAGE_EDIT_LIMITS.recipeBytes);
  f.resetCurrent(); await assertRefused(f, "invalid");
});

for (const key of ["ownerId", "documentId", "outputId", "generationId", "sourceEventId", "contentRef", "revision", "rawJson"]) test("current " + key + " replacement cannot authorize captured bytes", async () => {
  const f = fixture(); f.current().basis[key] = key === "revision" ? 4 : key === "rawJson" ? rawJson + " " : "replacement";
  await assertRefused(f, "source_changed");
});

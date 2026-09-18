import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { png, pngChunk, utf8 } from "./output-asset-fixtures.mjs";
import { createCreativeEventFold, foldEvents } from "../src/model/events.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { createReferenceComposition, addReferenceCompositionLayer, referenceCompositionSources } from "../src/model/reference-composition.ts";
import { parseGuestImageResultCompletedCustodyReview, parseGuestImageResultMediaUrl, parseGuestImageResultEditBasis,
  prepareGuestImageResultEdit, prepareGeneratedImageEdit } from "../src/model/generated-image-edit.ts";
import { parseGuestImageResultEditRequest, parseGuestImageResultRevision, guestImageResultEditOperationSha256,
  projectGuestImageResultEdit, parseGeneratedImageEditRequest, parseGeneratedImageRevision,
  generatedImageEditOperationSha256, projectGeneratedImageEdit } from "../src/model/generated-image-revision.ts";
import { inspectCurrentGuestImageResultEdit, matchGuestImageResultEditSnapshot, captureCurrentGuestImageResultEdit,
  inspectCurrentGeneratedImageEdit } from "../src/model/generated-image-edit-current.ts";

// Direct TS module imports and authored, already-canonical DTOs only. The local
// pair is the exact accepted structural contract, not an adoption writer or
// custody/rights capability. Structural PNGs prove neither compositor pixels
// nor persistence, transport authentication, provider access or live activation.
const hash = value => createHash("sha256").update(value).digest("hex");
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ownerId = "owner:claim@example.test", projectId = id(1), documentId = id(2), generationId = id(3);
const custodyId = id(4), claimEventId = id(5), outputId = "object-" + generationId.slice(-8);
const contentRef = "guest-image-result-history-" + "c".repeat(64), promptRef = "guest-image-result-history-" + "d".repeat(64);
const start = Date.parse("2026-09-18T10:00:00.000Z"), expiry = new Date(start + 60_000).toISOString();
const originalBytes = png({ width: 24, height: 24 }), editedBytes = png({ width: 1536, height: 864 });
const secondBytes = png({ width: 1536, height: 864, extraChunks: [pngChunk("tEXt", utf8("Comment\0second local revision"))] });
const rawJson = '{ "title": "  Teal café · 雨  ", "extension": { "exact": [1,true,null] } }\n';
const context = { ownerId, projectId, documentId, outputId };
const review = () => ({ version: 1, kind: "guest-image-result-completed-review-v1", custodyId, claimEventId, lineageDigest: "sha256:" + "f".repeat(64) });
const mediaUrl = (revisionId = null, owner = ownerId, custody = custodyId, output = outputId) => "/api/media/" + encodeURIComponent(
  `guest-image-result-media-v1/${ownerMediaNamespace(owner)}/${custody}/${output}${revisionId ? "/revisions/" + revisionId : ""}.png`);
const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
const currentUnavailable = Object.freeze({ status: "unavailable" });
function deepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) deepFrozen(child);
}
function fixture({ adoption = false, owner = ownerId } = {}) {
  const ownerId = owner;
  const data = { ownerId, projectId, documentId, outputId, events: [], head: 100,
    planner: { contentRef, rawJson, expiresAt: expiry, claim: review() } };
  let readValue = data, now = start, eventNumber = 100;
  const append = (type, payload, headers = {}) => {
    const sequence = ++data.head;
    const event = { eventId: id(++eventNumber), streamId: "creative:" + ownerId, sequence,
      occurredAt: new Date(start).toISOString(), recordedAt: new Date(start).toISOString(), actor: "user", clientId: "web:lit",
      correlationId: id(900), causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload, ...headers };
    data.events.push(event); return event;
  };
  append("ProjectCreated", { project_id: projectId, name: "Claimed project" });
  append("DocumentCreated", { project_id: projectId, document_id: documentId, title: "Same Document" });
  const direction = append("BlockCreated", { project_id: projectId, document_id: documentId, block_id: id(6), type: "direction",
    scope: "document", handle: "direction/original", position: "a0", properties: { text: "Teal geometry", weight: .8, authority: "authored" } });
  const claimEvent = append("GuestImageResultClaimed", {
    version: 1, project_id: projectId, document_id: documentId, custody_id: custodyId, object_id: outputId,
    generation_id: generationId, manifest_digest: "sha256:" + "b".repeat(64),
    claimed_origin: { version: 1, kind: "guest-image-result-event-origin-v1", custodyId, claimEventId,
      outputId, generationId, manifestDigest: "sha256:" + "b".repeat(64) },
    original_created_at: "2026-09-01T10:11:12.000Z", title: "  Teal café · 雨  ", model_id: "gpt-image-2",
    planner_model_id: "gpt-5.6-terra", provider: "openai", prompt_technique: "xml", quality: "high", purpose: "final",
    source_surface: "outputs", output_ref: contentRef, prompt_ref: promptRef, content_expires_at: expiry,
    media_url: mediaUrl(null, ownerId), media_type: "image/png", source_content_hash: hash(originalBytes), image_width: 24,
    image_height: 24, image_byte_length: originalBytes.length, latency_ms: 12345,
    source_block_versions: [{ block_id: id(6), version: 1 }], source_rights_digest: "sha256:" + "e".repeat(64),
  }, { eventId: claimEventId, actor: "user:" + ownerId, clientId: "server:guest-image-result-claim",
    correlationId: "guest-image-result-claim:v1:" + custodyId });
  const folded = () => foldEvents(data.events, Infinity, documentId, projectId);
  const output = () => folded().libraryOutputs.find(value => value.id === outputId);
  const adopt = (ordinal = 0) => {
    const current = output(); assert.ok(current);
    const referenceId = id(200 + ordinal * 2), blockId = id(201 + ordinal * 2), correlationId = id(800 + ordinal);
    const revision = current.imageRevision?.revision ?? 0, editEventId = current.imageRevision?.editEventId ?? null;
    const contentHash = current.imageRevision?.mediaSha256 ?? claimEvent.payload.source_content_hash;
    const shared = { project_id: projectId, document_id: documentId, source_surface: "generated-image-editor" };
    const headers = { clientId: "server:guest-image-local-context", correlationId };
    const receipt = append("ReferenceIngested", { ...shared, reference_id: referenceId, source_type: "claimed-generated-output",
      operation_scope: "local-image-composition", source_ref: current.mediaUrl, media_url: current.mediaUrl, media_type: "image/png",
      content_hash: contentHash, rights_class: "owned", source_output_id: outputId, source_generation_id: generationId,
      source_document_id: documentId, source_event_id: claimEventId, source_revision: revision, source_edit_event_id: editEventId,
      source_content_ref: contentRef, source_prompt_ref: promptRef, claim: review(), source_expires_at: expiry,
      provider: "openai", model_id: "gpt-image-2", source_rights_digest: claimEvent.payload.source_rights_digest }, headers);
    const block = append("BlockCreated", { ...shared, block_id: blockId, type: "reference", scope: "document",
      handle: `reference/claimed-${outputId.slice(-8)}-r${revision}`, position: "z00000000", properties: {
        reference_id: referenceId, label: current.title.trim().slice(0, 160) || "Image", media_url: current.mediaUrl,
        media_type: "image/png", source_mime_type: "image/png", source_content_hash: contentHash, width: current.width, height: current.height,
        source_output_id: outputId, source_generation_id: generationId, source_document_id: documentId, source_event_id: claimEventId,
        source_output_content_ref: contentRef, source_output_prompt_ref: promptRef, source_revision: revision, source_edit_event_id: editEventId,
        claim: review(), operation_scope: "local-image-composition", source_type: "claimed-generated-output", rights_class: "owned",
        source_expires_at: expiry, pixel_reference_mode: "context_only", intent: "include", authority: "authored", weight: .8,
        created_from: "generated-image-editor", source_rights_digest: claimEvent.payload.source_rights_digest,
      } }, headers);
    assert.equal(Object.keys(receipt.payload).length, 24); assert.equal(Object.keys(block.payload).length, 9);
    assert.equal(Object.keys(block.payload.properties).length, 27);
    return { receipt, block, referenceId, blockId, sourceId: blockId + ":image" };
  };
  const f = { data, append, claimEvent, direction, folded, output, adopt, read: () => readValue, now: () => now,
    setRead(value) { readValue = value; }, setTime(value) { now = value; } };
  if (adoption) f.local = adopt();
  return f;
}
function editFixture(previous = null) {
  const revision = previous ? previous.record.revision + 1 : 1, revisionId = id(400 + revision), editEventId = id(500 + revision);
  const sourceUrl = previous?.record.media.url ?? mediaUrl(), sourceHash = previous?.record.media.sha256 ?? hash(originalBytes);
  const source = { id: id(201) + ":image", blockId: id(201), label: "Teal café · 雨", mediaUrl: sourceUrl, contentHash: sourceHash, kind: "image" };
  const recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "retained-layer");
  const resultBytes = revision === 1 ? editedBytes : secondBytes;
  const request = { expectedRevision: revision - 1, expectedEditEventId: previous?.record.editEventId ?? null,
    expectedContentSha256: hash(rawJson), generationId, sourceEventId: claimEventId, contentRef, sourceMediaUrl: sourceUrl,
    sourceMediaSha256: sourceHash, sourceId: source.id, recipe, resultMediaSha256: hash(resultBytes), resultByteLength: resultBytes.length,
    schemaVersion: 2, claim: review() };
  const operationSha256 = hash(JSON.stringify({ domain: "guest-image-result-edit@1", ownerId, projectId, documentId, outputId, request }));
  const record = { schemaVersion: 2, operation: "composition", revision, editEventId, outputId, documentId, generationId,
    sourceEventId: claimEventId, contentRef, contentSha256: hash(rawJson),
    source: { revision: revision - 1, eventId: previous?.record.editEventId ?? claimEventId, mediaUrl: sourceUrl, sha256: sourceHash,
      width: previous ? 1536 : 24, height: previous ? 864 : 24 },
    media: { url: mediaUrl(revisionId), mediaType: "image/png", sha256: hash(resultBytes), byteLength: resultBytes.length, width: 1536, height: 864 },
    sourceId: source.id, recipe: structuredClone(recipe), recipeSha256: hash(JSON.stringify(recipe)), operationSha256, claim: review() };
  const append = f => f.append("GeneratedImageEdited", { output_id: outputId, object_id: outputId, document_id: documentId, project_id: projectId,
    generation_id: generationId, source_event_id: claimEventId, content_ref: contentRef, edited_by_user_id: ownerId,
    source_surface: "generated-image-editor", revision, previous_revision: revision - 1, previous_edit_event_id: request.expectedEditEventId,
    image_revision_id: revisionId, image_revision_sha256: hash(JSON.stringify(record)), image_edit_operation_sha256: operationSha256,
    content_sha256: hash(rawJson), media_url: record.media.url, media_type: "image/png", source_content_hash: record.media.sha256,
    image_width: 1536, image_height: 864, image_byte_length: resultBytes.length, claim: review() },
  { eventId: editEventId, clientId: "web:generated-image-editor" });
  return { request, record, revisionId, append };
}
function preparationFixture() {
  const basis = { kind: "generated-image", ownerId, documentId, outputId, generationId, sourceEventId: claimEventId,
    contentRef, revision: 0, rawJson, contentSha256: hash(rawJson),
    media: { url: mediaUrl(), mediaType: "image/png", sha256: hash(originalBytes), width: 24, height: 24 }, claim: review() };
  const edit = editFixture(), sources = structuredClone(edit.request.recipe.sources);
  const input = { basis, sources, sourceId: sources[0].id, recipe: edit.request.recipe,
    originalPng: new Uint8Array(originalBytes), editedPng: new Uint8Array(editedBytes) };
  let current = structuredClone({ basis, sources });
  return { input, read: () => current, setCurrent(value) { current = value; } };
}
const inspect = f => inspectCurrentGuestImageResultEdit(f.read, f.now);
const capture = f => captureCurrentGuestImageResultEdit(f.read, f.local.sourceId, f.now);

// First named test is independently runnable as the genuine composed positive.
test("claimed protocol joins canonical local source through current snapshot capture and PNG preparation", async () => {
  const f = fixture({ adoption: true }), before = structuredClone(f.data), output = f.output();
  assert.ok(output.claimedOrigin); assert.equal(output.sourceEventId, claimEventId); assert.equal(output.documentId, documentId);
  const snapshot = await inspect(f); assert.equal(snapshot.status, "current");
  assert.deepEqual(snapshot.claim, review()); assert.equal(snapshot.rawJson, rawJson); assert.equal(snapshot.contentSha256, hash(rawJson));
  assert.equal(snapshot.revision, 0); assert.equal(snapshot.editEventId, null); assert.equal(snapshot.head, f.data.head);
  assert.deepEqual(snapshot.sourceIds, [f.local.sourceId]); deepFrozen(snapshot);
  const matched = await matchGuestImageResultEditSnapshot(structuredClone(snapshot), f.read, f.now);
  assert.deepEqual(matched, snapshot); assert.notEqual(matched, snapshot);
  const captured = await capture(f); assert.equal(captured.status, "captured");
  assert.deepEqual(captured.basis.claim, review()); assert.equal(captured.basis.sourceEventId, claimEventId);
  assert.equal(Object.hasOwn(captured.basis, "projectId"), false, "basis adds claim only; current read binds Project separately");
  const source = captured.sources.find(value => value.id === captured.sourceId); assert.ok(source); assert.equal(source.kind, "image");
  const recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "prepared-layer");
  const prepared = await prepareGuestImageResultEdit({ basis: captured.basis, sources: captured.sources,
    sourceId: captured.sourceId, recipe, originalPng: new Uint8Array(originalBytes), editedPng: new Uint8Array(editedBytes) }, captured.current);
  assert.equal(prepared.status, "prepared");
  try {
    assert.deepEqual(prepared.expected.claim, review()); assert.equal(prepared.expected.contentSha256, hash(rawJson));
    assert.equal(Object.hasOwn(prepared.expected, "rawJson"), false); assert.equal(prepared.recipeSha256, hash(JSON.stringify(recipe)));
    assert.deepEqual(prepared.copyPng(), editedBytes); assert.equal(prepared.png.sha256, hash(editedBytes));
    const copy = prepared.copyPng(); copy.fill(0); assert.deepEqual(prepared.copyPng(), editedBytes);
  } finally { prepared.dispose(); }
  assert.equal(prepared.copyPng(), null); assert.deepEqual(f.data, before);
  assert.equal(Object.hasOwn(f.data, "content"), false, "opening planner never enters a generic content map");
});

test("claimed protocol projects two revisions through actual fold and current snapshot", async () => {
  const f = fixture(), initial = f.output(), first = editFixture(), second = editFixture(first);
  const firstEvent = first.append(f), projected = projectGuestImageResultEdit(initial, firstEvent, { ownerId, projectId, claim: review() });
  assert.ok(projected); assert.equal(projected.imageRevision.revision, 1); assert.notEqual(first.revisionId, first.record.editEventId);
  assert.deepEqual(parseGuestImageResultRevision(first.record, ownerId, first.revisionId), first.record);
  assert.deepEqual(f.output(), projected, "allocated actual fold dispatch preserves the same visible projection");
  const secondEvent = second.append(f), projectedAgain = projectGuestImageResultEdit(projected, secondEvent, { ownerId, projectId, claim: review() });
  assert.ok(projectedAgain); assert.deepEqual(f.output(), projectedAgain);
  assert.deepEqual(parseGuestImageResultRevision(second.record, ownerId, second.revisionId), second.record);
  assert.equal(projectedAgain.sourceEventId, claimEventId); assert.equal(projectedAgain.contentRef, contentRef);
  assert.deepEqual(projectedAgain.claimedOrigin, initial.claimedOrigin); assert.equal(projectedAgain.createdAt, initial.createdAt);
  f.local = f.adopt(1);
  const snapshot = await inspect(f); assert.equal(snapshot.status, "current"); assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.editEventId, second.record.editEventId); assert.equal(snapshot.media.url, second.record.media.url);
  assert.equal(snapshot.media.byteLength, secondBytes.length); assert.deepEqual(snapshot.sourceIds, [f.local.sourceId]);
  assert.deepEqual(await matchGuestImageResultEditSnapshot(structuredClone(snapshot), f.read, f.now), snapshot);
  const captured = await capture(f); assert.equal(captured.status, "captured"); assert.equal(captured.basis.revision, 2);
  const source = captured.sources.find(value => value.id === captured.sourceId);
  const recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "second-current-layer");
  const prepared = await prepareGuestImageResultEdit({ basis: captured.basis, sources: captured.sources, sourceId: captured.sourceId,
    recipe, originalPng: new Uint8Array(secondBytes), editedPng: new Uint8Array(editedBytes) }, captured.current);
  assert.equal(prepared.status, "prepared");
  try { assert.equal(prepared.expected.revision, 2); assert.deepEqual(prepared.copyPng(), editedBytes); }
  finally { prepared.dispose(); }
});

test("claimed request reconstructs exact fixed hash bytes including nested claim order", async () => {
  const { request } = editFixture(), before = structuredClone(request), parsed = parseGuestImageResultEditRequest(reorder(request));
  assert.deepEqual(parsed, request); deepFrozen(parsed);
  assert.deepEqual(Object.keys(parsed), ["expectedRevision", "expectedEditEventId", "expectedContentSha256", "generationId", "sourceEventId", "contentRef",
    "sourceMediaUrl", "sourceMediaSha256", "sourceId", "recipe", "resultMediaSha256", "resultByteLength", "schemaVersion", "claim"]);
  assert.deepEqual(Object.keys(parsed.claim), ["version", "kind", "custodyId", "claimEventId", "lineageDigest"]);
  const expectedBytes = JSON.stringify({ domain: "guest-image-result-edit@1", ownerId, projectId, documentId, outputId, request });
  assert.equal(JSON.stringify({ domain: "guest-image-result-edit@1", ownerId, projectId, documentId, outputId, request: parsed }), expectedBytes);
  assert.equal(await guestImageResultEditOperationSha256(reorder(context), reorder(request)), hash(expectedBytes));
  for (const key of ["projectId", "documentId"]) {
    assert.notEqual(await guestImageResultEditOperationSha256({ ...context, [key]: id(700) }, request), hash(expectedBytes), key);
  }
  for (const mutate of [v => { v.claim.lineageDigest = "sha256:" + "a".repeat(64); }, v => { v.recipe.layers[0].x++; }, v => { v.resultByteLength++; }]) {
    const changed = structuredClone(request); mutate(changed);
    const changedHash = await guestImageResultEditOperationSha256(context, changed); assert.match(changedHash, /^[a-f0-9]{64}$/u);
    assert.notEqual(changedHash, hash(expectedBytes));
  }
  assert.equal(await guestImageResultEditOperationSha256({ ...context, ownerId: "other-owner" }, request), null);
  assert.equal(await guestImageResultEditOperationSha256({ ...context, outputId: "object-ffffffff" }, request), null);
  assert.deepEqual(request, before);
});

test("native parser hash and preparation defaults stay separate from claimed schema 2", async () => {
  const { request, record } = editFixture(), p = preparationFixture();
  assert.equal(parseGeneratedImageEditRequest(request), null); assert.equal(parseGeneratedImageRevision(record, ownerId), null);
  assert.equal(await generatedImageEditOperationSha256(context, request), null);
  assert.deepEqual(await prepareGeneratedImageEdit(p.input, p.read), { status: "refused", code: "invalid" });
  const native = structuredClone(request); delete native.schemaVersion; delete native.claim;
  native.sourceMediaUrl = "/api/media/" + encodeURIComponent(ownerMediaNamespace(ownerId) + "/generated/native.png");
  native.recipe.sources[0].mediaUrl = native.sourceMediaUrl;
  const parsed = parseGeneratedImageEditRequest(native); assert.deepEqual(parsed, native);
  assert.equal(await generatedImageEditOperationSha256(context, reorder(native)), hash(JSON.stringify({ ownerId, projectId, documentId, outputId, request: native })));
  assert.equal(parseGuestImageResultEditRequest(native), null);
  const f = fixture(); assert.deepEqual(await inspectCurrentGeneratedImageEdit(() => ({ ...context, events: f.data.events, head: f.data.head, content: { [contentRef]: rawJson } }), f.now), currentUnavailable);
  const edited = editFixture().append(f); assert.equal(projectGeneratedImageEdit(foldEvents(f.data.events.slice(0, -1), Infinity, documentId, projectId).libraryOutputs[0], edited, { ownerId, projectId }), null);
});

test("negative-zero compositor geometry round-trips from native and claimed preparation into canonical request hashes", async () => {
  for (const claimed of [false, true]) {
    const f = preparationFixture();
    f.input.recipe.layers[0].x = -0; f.input.recipe.layers[0].y = -0;
    if (!claimed) {
      delete f.input.basis.claim;
      f.input.basis.contentRef = "native-planner";
      f.input.basis.media.url = "/api/media/" + encodeURIComponent(ownerMediaNamespace(ownerId) + "/generated/native.png");
      f.input.sources[0].mediaUrl = f.input.basis.media.url;
      f.input.recipe.sources[0].mediaUrl = f.input.basis.media.url;
    }
    f.setCurrent(structuredClone({ basis: f.input.basis, sources: f.input.sources }));
    const prepared = await (claimed ? prepareGuestImageResultEdit : prepareGeneratedImageEdit)(f.input, f.read);
    assert.equal(prepared.status, "prepared", claimed ? "claimed preparation" : "native compatibility control");
    try {
      assert.equal(Object.is(prepared.recipe.layers[0].x, -0), true);
      assert.equal(Object.is(prepared.recipe.layers[0].y, -0), true);
      assert.equal(prepared.recipeSha256, hash(JSON.stringify(prepared.recipe)));
      const expected = prepared.expected;
      const request = { expectedRevision: expected.revision, expectedEditEventId: null, expectedContentSha256: expected.contentSha256,
        generationId: expected.generationId, sourceEventId: expected.sourceEventId, contentRef: expected.contentRef,
        sourceMediaUrl: expected.media.url, sourceMediaSha256: expected.media.sha256, sourceId: prepared.sourceId,
        recipe: prepared.recipe, resultMediaSha256: prepared.png.sha256, resultByteLength: prepared.png.byteLength,
        ...(claimed ? { schemaVersion: 2, claim: expected.claim } : {}) };
      const parsed = (claimed ? parseGuestImageResultEditRequest : parseGeneratedImageEditRequest)(request);
      assert.ok(parsed, "a valid prepared recipe remains a valid request");
      const bytes = JSON.stringify({ ...(claimed ? { domain: "guest-image-result-edit@1" } : {}), ownerId, projectId, documentId, outputId, request });
      const operationHash = claimed ? guestImageResultEditOperationSha256 : generatedImageEditOperationSha256;
      assert.equal(await operationHash(context, request), hash(bytes));
      const positiveZero = structuredClone(request); positiveZero.recipe.layers[0].x = 0; positiveZero.recipe.layers[0].y = 0;
      assert.equal(await operationHash(context, positiveZero), hash(bytes), "JSON geometry identity canonicalizes signed zero consistently");
    } finally { prepared.dispose(); }
  }
});

test("completed review and media association parse as detached inert closed values", () => {
  const input = reorder(review()), parsed = parseGuestImageResultCompletedCustodyReview(input);
  assert.deepEqual(parsed, review()); assert.notEqual(parsed, input); deepFrozen(parsed);
  assert.deepEqual(parseGuestImageResultMediaUrl(mediaUrl()), { ownerId, custodyId, outputId, revisionId: null });
  assert.deepEqual(parseGuestImageResultMediaUrl(mediaUrl(id(401))), { ownerId, custodyId, outputId, revisionId: id(401) });
  const unicodeOwner = "\ufeffé:雨";
  assert.equal(parseGuestImageResultMediaUrl(mediaUrl(null, unicodeOwner)).ownerId, unicodeOwner, "leading BOM is owner data");
  for (const bad of [mediaUrl().replaceAll("%2F", "%2f"), mediaUrl() + "?download=1", mediaUrl().replace(".png", ".jpg"),
    "/api/media/" + encodeURIComponent(ownerMediaNamespace(ownerId) + "/generated/native.png"), mediaUrl(null, "guest:forbidden"),
    "/api/media/" + encodeURIComponent(`guest-image-result-media-v1/u-ff/${custodyId}/${outputId}.png`)]) assert.equal(parseGuestImageResultMediaUrl(bad), null);
  for (const mutate of [v => { v.lineageDigest = "f".repeat(64); }, v => { v.custodyId = "not-uuid"; }, v => { v.kind = "guest-image-result-event-origin-v1"; },
    v => { v.version = 2; }, v => { v.extra = true; }]) { const v = review(); mutate(v); assert.equal(parseGuestImageResultCompletedCustodyReview(v), null); }
});

const invalidRequests = [
  ["native schema", v => { v.schemaVersion = 1; }], ["missing claim", v => { delete v.claim; }],
  ["source epoch", v => { v.sourceEventId = id(999); }], ["ordinary planner ref", v => { v.contentRef = "private-native"; }],
  ["wrong generation suffix", v => { v.generationId = id(999); }], ["wrong custody key", v => { v.sourceMediaUrl = mediaUrl(null, ownerId, id(999)); v.recipe.sources[0].mediaUrl = v.sourceMediaUrl; }],
  ["revision zero derivative", v => { v.sourceMediaUrl = mediaUrl(id(401)); v.recipe.sources[0].mediaUrl = v.sourceMediaUrl; }],
  ["negative-zero revision", v => { v.expectedRevision = -0; }], ["extra request key", v => { v.unbound = true; }],
  ["wrong recipe source hash", v => { v.recipe.sources[0].contentHash = "a".repeat(64); }],
];
for (const [name, mutate] of invalidRequests) test("claimed request refuses " + name, () => {
  const { request } = editFixture(); mutate(request); assert.equal(parseGuestImageResultEditRequest(request), null);
});

const invalidRevisions = [
  ["schema one", v => { v.schemaVersion = 1; }], ["missing claim", v => { delete v.claim; }],
  ["source epoch", v => { v.sourceEventId = id(998); }], ["wrong custody", v => { v.claim.custodyId = id(998); }],
  ["source ancestry", v => { v.source.eventId = id(998); }], ["noncontiguous revision", v => { v.revision = 3; }],
  ["ordinary media escape", v => { v.media.url = "/api/media/" + encodeURIComponent(ownerMediaNamespace(ownerId) + "/generated/image-edit-" + id(1) + ".png"); }],
  ["wrong output key", v => { v.media.url = mediaUrl(id(401), ownerId, custodyId, "object-ffffffff"); }],
  ["row UUID conflated with edit UUID", v => { v.media.url = mediaUrl(v.editEventId); }],
  ["ordinary content ref", v => { v.contentRef = "private-native"; }], ["unknown field", v => { v.revisionId = id(401); }],
];
for (const [name, mutate] of invalidRevisions) test("claimed revision refuses " + name, () => {
  const { record, revisionId } = editFixture(); mutate(record); assert.equal(parseGuestImageResultRevision(record, ownerId, revisionId), null);
});

test("claimed data parsers refuse accessor or toJSON metadata without evaluating it", () => {
  for (const parser of [parseGuestImageResultCompletedCustodyReview, parseGuestImageResultEditBasis, parseGuestImageResultEditRequest]) {
    let calls = 0;
    const value = parser === parseGuestImageResultCompletedCustodyReview ? review() : parser === parseGuestImageResultEditBasis ? preparationFixture().input.basis : editFixture().request;
    const key = parser === parseGuestImageResultCompletedCustodyReview ? "lineageDigest" : "claim";
    Object.defineProperty(value, key, { enumerable: true, get() { calls++; throw new Error("must not evaluate data getter"); } });
    assert.equal(parser(value), null); assert.equal(calls, 0);
  }
  const { request } = editFixture(); let calls = 0; request.toJSON = () => { calls++; return {}; };
  assert.equal(parseGuestImageResultEditRequest(request), null); assert.equal(calls, 0);
  const { record, revisionId } = editFixture(); Object.defineProperty(record.claim, "lineageDigest", { enumerable: true, get() { calls++; return "sha256:" + "f".repeat(64); } });
  assert.equal(parseGuestImageResultRevision(record, ownerId, revisionId), null); assert.equal(calls, 0);
});

test("bare claimed inspection has an empty source roster and does not invent adoption", async () => {
  const f = fixture(), before = structuredClone(f.data), snapshot = await inspect(f);
  assert.equal(snapshot.status, "current"); assert.deepEqual(snapshot.sourceIds, []); assert.deepEqual(snapshot.sources, []);
  assert.deepEqual(await captureCurrentGuestImageResultEdit(f.read, id(201) + ":image", f.now), currentUnavailable);
  assert.deepEqual(f.data, before);
});

const invalidCurrent = [
  ["foreign owner", f => { f.data.ownerId = "foreign"; }], ["foreign Project", f => { f.data.projectId = id(999); }],
  ["foreign Document", f => { f.data.documentId = id(999); }], ["wrong planner ref", f => { f.data.planner.contentRef = promptRef; }],
  ["missing opening planner", f => { delete f.data.planner; f.data.content = { [contentRef]: rawJson }; }],
  ["malformed raw planner", f => { f.data.planner.rawJson = "[1]"; }], ["expired planner", f => { f.data.planner.expiresAt = new Date(start).toISOString(); }],
  ["expired canonical result", f => { f.claimEvent.payload.content_expires_at = new Date(start).toISOString(); }],
  ["wrong completed claim", f => { f.data.planner.claim.claimEventId = id(999); }],
  ["missing explicit Store head", f => { delete f.data.head; }], ["Store head below history", f => { f.data.head--; }],
  ["removed Document", f => { f.append("DocumentRemoved", { document_id: documentId }); }],
  ["discarded output", f => { f.append("ObjectDiscarded", { object_id: outputId }); }],
  ["malformed duplicate origin", f => { f.append("GuestImageResultClaimed", { object_id: outputId, generation_id: generationId }); }],
  ["native origin alias", f => { f.append("GenerationCompleted", { object_id: outputId, object_ids: [outputId], generation_id: generationId }); }],
];
for (const [name, mutate] of invalidCurrent) test("claimed current inspection refuses " + name, async () => {
  const f = fixture(); mutate(f); assert.deepEqual(await inspect(f), currentUnavailable);
});

const invalidPairs = [
  ["missing receipt", f => { f.data.events = f.data.events.filter(e => e !== f.local.receipt); }],
  ["missing block", f => { f.data.events = f.data.events.filter(e => e !== f.local.block); }],
  ["wrong lineage", f => { f.local.receipt.payload.claim.lineageDigest = "sha256:" + "a".repeat(64); }],
  ["wrong source rights", f => { f.local.block.payload.properties.source_rights_digest = "sha256:" + "a".repeat(64); }],
  ["wrong tuple revision", f => { f.local.receipt.payload.source_revision = 1; }],
  ["wrong original event", f => { f.local.block.payload.properties.source_event_id = id(999); }],
  ["wrong content ref", f => { f.local.receipt.payload.source_content_ref = promptRef; }],
  ["wrong media hash", f => { f.local.block.payload.properties.source_content_hash = "a".repeat(64); }],
  ["wrong expiry", f => { f.local.receipt.payload.source_expires_at = new Date(start + 120_000).toISOString(); }],
  ["provider scope", f => { f.local.receipt.payload.operation_scope = "provider-reference"; }],
  ["unknown receipt property", f => { f.local.receipt.payload.unknown = true; }],
  ["different pair correlation", f => { f.local.block.correlationId = id(999); }],
  ["later rights replacement", f => { f.append("RightsAsserted", { reference_id: f.local.referenceId, rights_class: "revoked" }); }],
  ["duplicate source receipt", f => { f.append("ReferenceIngested", structuredClone(f.local.receipt.payload), { clientId: f.local.receipt.clientId, correlationId: id(999) }); }],
  ["removed source Block", f => { f.append("BlockRemoved", { block_id: f.local.blockId }); }],
  ["reassigned source Document", f => { f.local.block.payload.document_id = id(999); }],
];
for (const [name, mutate] of invalidPairs) test("claimed source capture refuses " + name, async () => {
  const f = fixture({ adoption: true }); mutate(f); assert.deepEqual(await capture(f), currentUnavailable);
});

test("claimed projector rejects changed tuple, event ancestry and revision-row binding", () => {
  for (const mutate of [e => { e.payload.project_id = id(999); }, e => { e.payload.document_id = id(999); }, e => { e.payload.content_ref = promptRef; },
    e => { e.payload.previous_revision = 1; }, e => { e.payload.previous_edit_event_id = id(999); },
    e => { e.payload.image_revision_id = e.eventId; }, e => { delete e.payload.claim; }]) {
    const f = fixture(), original = f.output(), edit = editFixture().append(f); mutate(edit);
    assert.equal(projectGuestImageResultEdit(original, edit, { ownerId, projectId, claim: review() }), null);
    assert.equal(f.output().mediaUrl, null, "contradictory targeted edit cannot leave old pixels looking current");
  }
});

for (const [name, mutate] of [
  ["unknown payload key", payload => { payload.unbound = true; }],
  ["missing payload key", payload => { delete payload.image_byte_length; }],
]) test("claimed edit payload refuses " + name, async () => {
  const f = fixture(), original = f.output(), event = editFixture().append(f);
  assert.equal(Object.keys(event.payload).length, 23, "native 22-field payload plus the one completed claim");
  mutate(event.payload);
  assert.equal(projectGuestImageResultEdit(original, event, { ownerId, projectId, claim: review() }), null);
  assert.equal(f.output().mediaUrl, null); assert.deepEqual(await inspect(f), currentUnavailable);
});

const invalidClaimedEditHeaders = [
  ["unknown header key", event => { event.unbound = true; }],
  ["missing header key", event => { delete event.causationId; }],
  ["event schema 2", event => { event.schemaVersion = 2; }],
  ["non-UUID correlation", event => { event.correlationId = "unbound-correlation"; }],
  ["divergent recorded and occurred times", event => { event.recordedAt = new Date(start + 1).toISOString(); }],
  ["noncanonical event time", event => { event.occurredAt = "2026-09-18T10:00:00Z"; event.recordedAt = event.occurredAt; }],
  ["nonnull causation", event => { event.causationId = id(997); }],
  ["nonnull compensation", event => { event.compensatesEventId = id(998); }],
];
for (const [name, mutate] of invalidClaimedEditHeaders) test("claimed edit header refuses " + name, async () => {
  const f = fixture(), original = f.output(), edit = editFixture(), event = edit.append(f);
  assert.equal(edit.record.schemaVersion, 2, "the private claimed revision has its own schema 2 contract");
  assert.equal(event.schemaVersion, 1, "the canonical event header keeps the existing writer schema 1 profile");
  mutate(event);
  assert.equal(projectGuestImageResultEdit(original, event, { ownerId, projectId, claim: review() }), null);
  assert.equal(f.output().mediaUrl, null); assert.deepEqual(await inspect(f), currentUnavailable);
});

test("full fold withdraws media when a contiguous claimed edit chain changes lineage", async () => {
  const f = fixture(), first = editFixture(), second = editFixture(first);
  first.append(f); const edit = second.append(f); edit.payload.claim.lineageDigest = "sha256:" + "a".repeat(64);
  assert.equal(f.output().mediaUrl, null); assert.deepEqual(await inspect(f), currentUnavailable);
  const initialOnly = fixture(), original = initialOnly.output(), different = editFixture().append(initialOnly);
  different.payload.claim.lineageDigest = "sha256:" + "a".repeat(64);
  assert.equal(projectGuestImageResultEdit(original, different, { ownerId, projectId, claim: review() }), null);
  assert.deepEqual(await inspect(initialOnly), currentUnavailable);
  // The original EventOrigin has no lineage digest; the pure fold can check
  // chain continuity, while the dedicated reader binds the supplied full review.
  assert.equal(Object.hasOwn(original.claimedOrigin, "lineageDigest"), false);
});

test("claimed current selection rejects a preceding native alias as well as a later one", async () => {
  const f = fixture(), alias = { ...structuredClone(f.claimEvent), eventId: id(998), sequence: 100,
    actor: "worker:generator", clientId: "native", type: "GenerationCompleted",
    payload: { object_id: outputId, object_ids: [outputId], generation_id: generationId, document_id: documentId } };
  f.data.events.unshift(alias); assert.deepEqual(await inspect(f), currentUnavailable);
});

test("reserved-family source cannot enter ordinary roster through the legacy owner namespace collision", async () => {
  const f = fixture(), legacyOwner = "guest-image-result-media-v1", reserved = mediaUrl(null, legacyOwner);
  f.data.ownerId = legacyOwner;
  for (const event of f.data.events) event.streamId = "creative:" + legacyOwner;
  f.claimEvent.actor = "user:" + legacyOwner; f.claimEvent.payload.media_url = reserved;
  const ref = id(901), block = id(902), headers = { streamId: "creative:" + legacyOwner };
  f.append("ReferenceIngested", { reference_id: ref, source_type: "generated-output", source_ref: reserved,
    media_url: reserved, media_type: "image/png", rights_class: "owned", content_hash: hash(originalBytes) }, headers);
  f.append("BlockCreated", { project_id: projectId, document_id: documentId, block_id: block, type: "reference", scope: "document",
    handle: "reference/ordinary-looking", position: "z0", properties: { reference_id: ref, label: "Ordinary-looking reserved source",
      media_url: reserved, media_type: "image/png", source_mime_type: "image/png", source_content_hash: hash(originalBytes),
      rights_class: "owned", pixel_reference_mode: "context_only", intent: "include", authority: "authored", weight: .8 } }, headers);
  const ordinary = referenceCompositionSources(f.folded().libraryBlocks, f.data.events, start);
  assert.ok(ordinary.some(source => source.blockId === block), "unqualified generic source exists, proving the exclusion is exercised");
  const snapshot = await inspect(f); assert.equal(snapshot.status, "current");
  assert.deepEqual(snapshot.sources, []); assert.deepEqual(snapshot.sourceIds, []);
});

test("claimed snapshots rejoin raw data, lineage and head across the digest await", async () => {
  for (const mutate of [f => { f.data.planner.rawJson += " "; }, f => { f.data.planner.claim.lineageDigest = "sha256:" + "a".repeat(64); }, f => { f.data.head++; }]) {
    const f = fixture({ adoption: true }), pending = inspect(f); mutate(f);
    assert.deepEqual(await pending, currentUnavailable);
  }
  const f = fixture({ adoption: true }), snapshot = await inspect(f); assert.equal(snapshot.status, "current");
  for (const mutate of [v => { v.claim.lineageDigest = "sha256:" + "a".repeat(64); }, v => { v.rawJson += " "; },
    v => { v.head++; }, v => { v.sources[0].label = "Replaced label"; }, v => { v.media.sha256 = "a".repeat(64); }]) {
    const value = structuredClone(snapshot); mutate(value);
    assert.deepEqual(await matchGuestImageResultEditSnapshot(value, f.read, f.now), currentUnavailable);
  }
  let getterCalls = 0; const response = structuredClone(snapshot);
  Object.defineProperty(response, "claim", { enumerable: true, get() { getterCalls++; return review(); } });
  assert.deepEqual(await matchGuestImageResultEditSnapshot(response, f.read, f.now), currentUnavailable); assert.equal(getterCalls, 0);
});

test("captured claimed currentness retires permanently after lifetime or Project withdrawal", async () => {
  for (const withdraw of [f => { f.setTime(start + 60_000); }, f => { f.data.projectId = id(999); }]) {
    const f = fixture({ adoption: true }), captured = await capture(f); assert.equal(captured.status, "captured");
    withdraw(f); assert.equal(captured.current(), null); f.setTime(start); f.data.projectId = projectId; assert.equal(captured.current(), null);
  }
});

test("claimed preparation preserves exact raw hash and retires owned bytes across await and disposal", async () => {
  const f = preparationFixture(), before = structuredClone(f.input), pending = prepareGuestImageResultEdit(f.input, f.read);
  f.input.originalPng.fill(0); f.input.editedPng.fill(0); f.input.basis.claim.lineageDigest = "sha256:" + "a".repeat(64);
  const prepared = await pending; assert.equal(prepared.status, "prepared");
  assert.deepEqual(prepared.expected.claim, before.basis.claim); assert.deepEqual(prepared.copyPng(), before.editedPng);
  const ownedCopy = prepared.copyPng(), originalCurrent = structuredClone(f.read());
  f.read().basis.claim.lineageDigest = "sha256:" + "b".repeat(64); assert.equal(prepared.copyPng(), null);
  f.setCurrent(originalCurrent); assert.equal(prepared.copyPng(), null); prepared.dispose(); assert.deepEqual(ownedCopy, before.editedPng);
  const changed = preparationFixture(), changing = prepareGuestImageResultEdit(changed.input, changed.read);
  changed.read().basis.rawJson += " "; assert.deepEqual(await changing, { status: "refused", code: "source_changed" });
  const wrongHash = preparationFixture(); wrongHash.input.basis.contentSha256 = hash(JSON.stringify(JSON.parse(rawJson)));
  assert.deepEqual(await prepareGuestImageResultEdit(wrongHash.input, () => ({ basis: wrongHash.input.basis, sources: wrongHash.input.sources })), { status: "refused", code: "invalid" });
});

test("claimed basis refuses native keys, unexpected fields and inconsistent original versus revision tuples", () => {
  for (const mutate of [v => { v.projectId = projectId; }, v => { delete v.claim; }, v => { v.sourceEventId = id(999); },
    v => { v.media.url = mediaUrl(id(401)); }, v => { v.contentRef = "private-native"; }, v => { v.outputId = "object-ffffffff"; },
    v => { v.claim.custodyId = id(999); }, v => { v.media.url = "/api/media/" + encodeURIComponent(ownerMediaNamespace(ownerId) + "/generated/native.png"); }]) {
    const { input } = preparationFixture(); mutate(input.basis); assert.equal(parseGuestImageResultEditBasis(input.basis), null);
  }
  const value = preparationFixture().input.basis; value.revision = 2; value.media.url = mediaUrl(id(402));
  assert.deepEqual(parseGuestImageResultEditBasis(reorder(value)), value);
});


for (const owner of ["\ufeffowner", "owner\u200dname"]) {
  test(`claimed current capture preserves accepted Unicode owner ${JSON.stringify(owner)}`, async () => {
    const f = fixture({ adoption: true, owner }), snapshot = await inspect(f);
    assert.equal(snapshot.status, "current"); assert.equal(snapshot.ownerId, owner);
    assert.equal(parseGuestImageResultMediaUrl(snapshot.media.url).ownerId, owner);
    assert.deepEqual(await matchGuestImageResultEditSnapshot(snapshot, f.read, f.now), snapshot);
    const captured = await capture(f); assert.equal(captured.status, "captured");
    assert.equal(captured.basis.ownerId, owner);
    const source = captured.sources.find(value => value.id === captured.sourceId);
    const recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "unicode-owner-layer");
    const prepared = await prepareGuestImageResultEdit({ basis: captured.basis, sources: captured.sources, sourceId: captured.sourceId,
      recipe, originalPng: new Uint8Array(originalBytes), editedPng: new Uint8Array(editedBytes) }, captured.current);
    assert.equal(prepared.status, "prepared");
    try { assert.equal(prepared.expected.ownerId, owner); assert.deepEqual(prepared.copyPng(), editedBytes); }
    finally { prepared.dispose(); }
  });
}

for (const removal of ["native collision", "removed Document"]) {
  test(`claimed edit retained fold state is released with ${removal}`, () => {
    const f = fixture(), tracked = createCreativeEventFold(Infinity, documentId, projectId), control = createCreativeEventFold(Infinity, documentId, projectId);
    for (const event of f.data.events) { tracked.accept(event); control.accept(event); }
    const event = editFixture().append(f);
    tracked.accept(event); control.accept({ ...event, type: "UnretainedDiagnostic" });
    const active = tracked.measureRetainedState(), ordinary = control.measureRetainedState();
    assert.ok(active.bytes > ordinary.bytes && active.nodes > ordinary.nodes);
    const limit = { bytes: ordinary.bytes + 1, nodes: active.nodes + 100, depth: 96 };
    assert.doesNotThrow(() => control.measureRetainedState(limit));
    assert.throws(() => tracked.measureRetainedState(limit), { message: "retained_state_capacity" });
    const end = removal === "native collision" ? f.append("GenerationCompleted", { project_id: projectId, document_id: documentId,
      generation_id: generationId, output_ref: "ordinary-result", object_ids: [outputId] })
      : f.append("DocumentRemoved", { project_id: projectId, document_id: documentId });
    tracked.accept(end); control.accept(end);
    assert.deepEqual(tracked.finish(), control.finish());
    assert.deepEqual(tracked.measureRetainedState(), control.measureRetainedState(), "withdrawn output leaves no private edit-review residue");
    assert.throws(() => tracked.accept(event), { message: "creative_fold_already_finished" });
  });
}

test("claimed edit lineage state belongs to one fold instance", () => {
  const a = fixture(), b = fixture(), edit = editFixture();
  edit.append(a); const eventB = edit.append(b);
  eventB.payload.claim.lineageDigest = "sha256:" + "a".repeat(64);
  assert.equal(a.output().imageRevision.revision, 1); assert.equal(b.output().imageRevision.revision, 1);
  assert.equal(Object.hasOwn(a.output(), "claim"), false);
  assert.equal(Object.hasOwn(a.output().claimedOrigin, "lineageDigest"), false);
  const second = editFixture(edit); const bad = second.append(a); bad.payload.claim = structuredClone(eventB.payload.claim);
  assert.equal(a.output().mediaUrl, null);
  const good = second.append(b); good.payload.claim = structuredClone(eventB.payload.claim);
  assert.equal(b.output().imageRevision.revision, 2);
});

for (const mutation of ["trimmed rights reference", "array rights reference", "array duplicate receipt", "array duplicate block", "array rehome", "array immutable property", "array type property", "array chip property", "array extraction property"]) {
  test(`claimed local capture rejects canonical history alias: ${mutation}`, async () => {
    const f = fixture({ adoption: true });
    assert.equal((await capture(f)).status, "captured", "genuine original pair is eligible before contradictory history");
    const blockId = f.local.blockId, ref = f.local.referenceId, original = f.local.block.payload.properties;
    if (mutation === "trimmed rights reference" || mutation === "array rights reference") {
      f.append("RightsAsserted", { reference_id: mutation === "trimmed rights reference" ? " " + ref + " " : [[ref]], rights_class: "denied" });
      if (mutation === "trimmed rights reference") {
        assert.deepEqual(referenceCompositionSources(f.folded().libraryBlocks, f.data.events, start), [], "existing compositor trims rights IDs");
      }
    } else if (mutation === "array duplicate receipt") {
      f.append("ReferenceIngested", { ...structuredClone(f.local.receipt.payload), reference_id: [[ref]] });
    } else if (mutation === "array duplicate block") {
      f.append("BlockCreated", { ...structuredClone(f.local.block.payload), block_id: [[blockId]] });
    } else if (mutation === "array rehome") {
      f.append("BlockRehomed", { block_id: [[blockId]], scope: "document", project_id: projectId, document_id: documentId });
    } else if (mutation === "array extraction property") {
      f.append("ExtractionCompleted", { block_id: [[blockId]], chips: [{ property: ["source_content_hash"], value: "a".repeat(64) }] });
      f.append("ExtractionCompleted", { block_id: [[blockId]], chips: [{ property: ["source_content_hash"], value: original.source_content_hash }] });
    } else {
      const type = mutation === "array chip property" ? "ChipEdited" : "BlockPropertyEdited";
      const property = mutation === "array type property" ? "type" : "source_content_hash";
      const field = type === "ChipEdited" ? "property" : "property_path";
      f.append(type, { block_id: [[blockId]], [field]: [property], new_value: property === "type" ? "direction" : "a".repeat(64) });
      f.append(type, { block_id: [[blockId]], [field]: [property], new_value: property === "type" ? "reference" : original.source_content_hash });
    }
    const visibleBlock = f.folded().libraryBlocks.find(block => block.id === blockId);
    assert.ok(visibleBlock, "actual fold still resolves the same canonical block");
    assert.equal(visibleBlock.type, "reference"); assert.equal(f.output().mediaUrl, mediaUrl());
    assert.deepEqual(await capture(f), currentUnavailable);
  });
}


for (const mutation of ["block", "reference", "property"]) {
  test(`indeterminate deep legacy ${mutation} identity cannot prove source history absence`, async () => {
    const f = fixture({ adoption: true }); assert.equal((await capture(f)).status, "captured");
    const wrap = value => { for (let depth = 0; depth < 26; depth++) value = [value]; return value; };
    if (mutation === "block") f.append("BlockRehomed", { block_id: wrap(f.local.blockId), scope: "document", project_id: projectId, document_id: documentId });
    if (mutation === "reference") f.append("RightsAsserted", { reference_id: wrap(f.local.referenceId), rights_class: "denied" });
    if (mutation === "property") {
      f.append("BlockPropertyEdited", { block_id: f.local.blockId, property_path: wrap("type"), new_value: "direction" });
      f.append("BlockPropertyEdited", { block_id: f.local.blockId, property_path: wrap("type"), new_value: "reference" });
    }
    const block = f.folded().libraryBlocks.find(value => value.id === f.local.blockId);
    assert.ok(block); assert.equal(block.type, "reference");
    assert.deepEqual(await capture(f), currentUnavailable);
  });
}


test("legacy alias detection never qualifies an alias-only original local Block", async () => {
  const f = fixture({ adoption: true }); assert.equal((await capture(f)).status, "captured");
  f.local.block.payload.block_id = [[f.local.blockId]];
  assert.equal(f.folded().libraryBlocks.find(block => block.id === f.local.blockId).type, "reference");
  assert.deepEqual(await capture(f), currentUnavailable);
});


test("claimed revision proves actual row association only when that row identity is supplied", () => {
  const first = editFixture();
  assert.ok(parseGuestImageResultRevision(first.record, ownerId, first.revisionId));
  assert.equal(parseGuestImageResultRevision(first.record, ownerId, first.record.editEventId), null);
  const differentlyStored = structuredClone(first.record); differentlyStored.media.url = mediaUrl(first.record.editEventId);
  assert.ok(parseGuestImageResultRevision(differentlyStored, ownerId), "closed shape alone cannot certify the persisted row identity");
  assert.equal(parseGuestImageResultRevision(differentlyStored, ownerId, first.revisionId), null, "genuine row identity detects the mismatch");
});

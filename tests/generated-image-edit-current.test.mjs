import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { png } from "./output-asset-fixtures.mjs";
import { foldEvents } from "../src/model/events.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { imageOutputContextEvents } from "../src/model/output-context.ts";
import { createReferenceComposition, addReferenceCompositionLayer, referenceCompositionSources } from "../src/model/reference-composition.ts";
import { prepareGeneratedImageEdit } from "../src/model/generated-image-edit.ts";
import { captureCurrentGeneratedImageEdit } from "../src/model/generated-image-edit-current.ts";

// Authored events use the actual producer/reference schema and real foldEvents.
// No provider, DB, browser, transport authentication or saved edit is exercised.
const digest = value => createHash("sha256").update(value).digest("hex");
const originalPng = png({ width: 24, height: 24 }), editedPng = png({ width: 1536, height: 864 });
const startTime = Date.parse("2026-09-10T12:00:00.000Z");
function fixture({ references = true } = {}) {
  const ownerId = "team:a", projectId = "image-project", documentId = "image-document", outputId = "image-output";
  const generationId = "image-generation", contentRef = "private-generated-image", blockId = "existing-image-reference", referenceId = "existing-reference-receipt";
  const mediaUrl = `/api/media/${encodeURIComponent(ownerMediaNamespace(ownerId) + "/generated/" + generationId + ".png")}`;
  const raw = '{ "title": "Café 雨", "media_url": ' + JSON.stringify(mediaUrl) + ', "generator_extension": { "retained": [1,true,null] } }\n';
  const data = { ownerId, projectId, documentId, outputId, events: [], content: { [contentRef]: raw } };
  let activeRead = data, clock = startTime;
  const append = (type, payload, actor = "user") => {
    const sequence = Math.max(0, ...data.events.map(event => event.sequence)) + 1;
    const event = { eventId: "event-" + sequence, streamId: "creative:" + ownerId, sequence,
      occurredAt: new Date(startTime).toISOString(), recordedAt: new Date(startTime).toISOString(), actor,
      clientId: "authored-current-fixture", correlationId: "current-image-fixture", causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload };
    data.events.push(event); return event;
  };
  append("ProjectCreated", { project_id: projectId, name: "Image source project" });
  append("DocumentCreated", { project_id: projectId, document_id: documentId, title: "Image source document" });
  const producer = append("GenerationCompleted", { document_id: documentId, generation_id: generationId, object_id: outputId, object_ids: [outputId],
    output_ref: contentRef, media_url: mediaUrl, media_type: "image/png", source_content_hash: digest(originalPng), image_width: 24, image_height: 24,
    quality: "high", purpose: "final", simulation: false, provider: "authored-test-fixture", model_id: "structural-png-fixture", title: "Original generated title",
    content_expires_at: new Date(startTime + 60_000).toISOString() }, "worker:generator");
  const associate = (nextBlockId = blockId, nextReferenceId = referenceId) => {
    const output = foldEvents(data.events, Infinity, documentId, projectId).libraryOutputs.find(value => value.id === outputId);
    assert.ok(output, "real folded generated output exists before association");
    const ids = [nextBlockId, nextReferenceId]; let index = 0;
    const association = imageOutputContextEvents(output, { documentId, projectId, sourceSurface: "library-image",
      content: JSON.parse(raw), contentHash: digest(originalPng), positionStart: 0, idFactory: () => ids[index++] });
    assert.equal(index, 2); assert.deepEqual(association.events.map(event => event.type), ["ReferenceIngested", "BlockCreated"]);
    for (const event of association.events) append(event.type, event.payload);
    return association;
  };
  const association = references ? associate() : null;
  return { data, producer, append, contentRef, referenceId, blockId, sourceId: blockId + ":image", mediaUrl, raw,
    read: () => activeRead, now: () => clock, setRead: value => { activeRead = value; }, setTime: value => { clock = value; },
    block: () => data.events.find(event => event.type === "BlockCreated"), association, associate };
}
const capture = f => captureCurrentGeneratedImageEdit(f.read, f.sourceId, f.now);
const projection = f => foldEvents(f.data.events, Infinity, f.data.documentId, f.data.projectId);
async function join(captured) {
  const source = captured.sources.find(value => value.id === captured.sourceId);
  const recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "prepared-layer");
  return prepareGeneratedImageEdit({ basis: captured.basis, sources: captured.sources, sourceId: captured.sourceId, recipe,
    originalPng: new Uint8Array(originalPng), editedPng: new Uint8Array(editedPng) }, captured.current);
}
async function unavailable(f) { assert.deepEqual(await capture(f), { status: "unavailable" }); }

test("joins one real folded producer and explicitly seeded eligible reference into structural PNG preparation", async () => {
  const f = fixture(), before = structuredClone(f.data), folded = projection(f);
  assert.equal(folded.libraryOutputs.length, 1); assert.equal(folded.libraryBlocks.length, 1);
  assert.equal(folded.libraryOutputs[0].sourceEventId, f.producer.eventId);
  assert.deepEqual(f.association.blockIds, [f.blockId]); assert.deepEqual(f.association.sourceItemIds, [f.data.outputId]);
  assert.equal(f.association.availableMemberCount, 1);
  assert.equal(f.association.events[0].payload.rights_class, "account-generated");
  const captured = await capture(f); assert.equal(captured.status, "captured");
  assert.deepEqual(captured.basis, { kind: "generated-image", ownerId: f.data.ownerId,
    documentId: f.data.documentId, outputId: f.data.outputId, generationId: f.producer.payload.generation_id,
    sourceEventId: f.producer.eventId, contentRef: f.contentRef, revision: 0, rawJson: f.raw, contentSha256: digest(f.raw),
    media: { url: f.mediaUrl, mediaType: "image/png", sha256: digest(originalPng), width: 24, height: 24 } });
  assert.equal(captured.sources.length, 1); assert.equal(captured.sources[0].id, f.sourceId);
  assert.equal(captured.sources[0].blockId, f.blockId); assert.equal(captured.sources[0].mediaUrl, f.mediaUrl);
  assert.equal(captured.sources[0].contentHash, digest(originalPng)); assert.equal(captured.sources[0].kind, "image");
  assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.basis.media) && Object.isFrozen(captured.sources[0]));
  assert.deepEqual(captured.current(), { basis: captured.basis, sources: captured.sources });
  const prepared = await join(captured); assert.equal(prepared.status, "prepared");
  try {
    assert.equal(prepared.expected.revision, 0); assert.equal(prepared.expected.sourceEventId, f.producer.eventId);
    assert.equal(prepared.expected.contentSha256, digest(f.raw)); assert.deepEqual(prepared.copyPng(), editedPng);
    assert.deepEqual(prepared.png, { mediaType: "image/png", sha256: digest(editedPng), byteLength: editedPng.length, width: 1536, height: 864 });
    assert.equal(prepared.unchangedBytes, false);
  } finally { prepared.dispose(); }
  assert.deepEqual(f.data, before, "capture/preparation cannot create reference blocks, events or private content");
});

test("a bare generated output does not synthesize a compositor reference or rights", async () => {
  const f = fixture({ references: false }), before = structuredClone(f.data);
  assert.equal(projection(f).libraryOutputs.length, 1); assert.equal(projection(f).libraryBlocks.length, 0);
  await unavailable(f); assert.deepEqual(f.data, before);
});

for (const missing of ["ReferenceIngested", "BlockCreated"]) test("requires the actual " + missing + " source receipt", async () => {
  const f = fixture(); f.data.events = f.data.events.filter(event => event.type !== missing); await unavailable(f);
});

const refusedCases = [
  ["wrong producer actor", f => { f.producer.actor = "user"; }],
  ["preview event instead of completed output", f => { f.producer.type = "IdeationPreviewCompleted"; }],
  ["scout report output", f => { f.producer.payload.report_space = "scout"; }],
  ["simulated output", f => { f.producer.payload.simulation = true; }],
  ["missing simulation witness", f => { delete f.producer.payload.simulation; }],
  ["low quality output", f => { f.producer.payload.quality = "low"; }],
  ["ideation purpose", f => { f.producer.payload.purpose = "ideate"; }],
  ["missing generation ID", f => { delete f.producer.payload.generation_id; }],
  ["mismatched object scalar", f => { f.producer.payload.object_id = "other-output"; }],
  ["multiple object IDs", f => { f.producer.payload.object_ids.push("other-output"); }],
  ["missing object-ID array", f => { delete f.producer.payload.object_ids; }],
  ["wrong producer Document", f => { f.producer.payload.document_id = "other-document"; }],
  ["wrong selected project", f => { f.data.projectId = "other-project"; }],
  ["wrong selected owner", f => { f.data.ownerId = "other-owner"; }],
  ["foreign event stream", f => { f.block().streamId = "creative:other-owner"; }],
  ["foreign canonical media URL", f => { f.producer.payload.media_url = `/api/media/${encodeURIComponent(ownerMediaNamespace("other-owner") + "/generated/image-generation.png")}`; }],
  ["noncanonical media URL", f => { f.producer.payload.media_url = f.mediaUrl.replace(/%2F/g, "%2f"); }],
  ["wrong media type", f => { f.producer.payload.media_type = "image/jpeg"; }],
  ["changed producer media hash", f => { f.producer.payload.source_content_hash = "a".repeat(64); }],
  ["unsafe image dimensions", f => { f.producer.payload.image_width = Number.MAX_SAFE_INTEGER + 1; }],
  ["fractional image dimensions", f => { f.producer.payload.image_height = 24.5; }],
  ["missing private content", f => { delete f.data.content[f.contentRef]; }],
  ["raw array instead of object", f => { f.data.content[f.contentRef] = "[]"; }],
  ["invalid raw JSON", f => { f.data.content[f.contentRef] = "{"; }],
  ["expired private content", f => { f.setTime(startTime + 60_000); }],
  ["noncanonical expiry", f => { f.producer.payload.content_expires_at = "2026-09-10T12:01:00Z"; }],
  ["malformed expiry", f => { f.producer.payload.content_expires_at = "not-a-date"; }],
  ["nonfinite clock", f => { f.setTime(NaN); }],
  ["discarded output", f => { f.append("ObjectDiscarded", { object_id: f.data.outputId }); }],
  ["removed Document", f => { f.append("DocumentRemoved", { document_id: f.data.documentId }); }],
  ["foreign reference Document", f => { f.block().payload.document_id = "other-document"; }],
  ["foreign reference project", f => { f.block().payload.project_id = "other-project"; }],
  ["same-byte reference bound to another output", f => { f.block().payload.properties.source_output_id = "other-output"; }],
  ["same-byte reference bound to another private content", f => { f.block().payload.properties.source_output_content_ref = "other-private-content"; }],
  ["same-byte receipt bound to another generation", f => { f.data.events.find(event => event.type === "ReferenceIngested").payload.source_generation_id = "other-generation"; }],
  ["same-byte receipt with unrelated source type", f => { f.data.events.find(event => event.type === "ReferenceIngested").payload.source_type = "upload"; }],
  ["changed reference hash", f => { f.append("BlockPropertyEdited", { block_id: f.blockId, property_path: "source_content_hash", new_value: "a".repeat(64) }); }],
  ["revoked reference rights", f => { f.append("RightsAsserted", { reference_id: f.referenceId, rights_class: "revoked" }); }],
  ["revoked reference property", f => { f.append("BlockPropertyEdited", { block_id: f.blockId, property_path: "rights_revoked", new_value: true }); }],
  ["expired reference license", f => { f.block().payload.properties.license_expires_at = new Date(startTime).toISOString(); }],
  ["removed reference block", f => { f.append("BlockRemoved", { block_id: f.blockId }); }],
  ["duplicate event ID", f => { f.block().eventId = f.producer.eventId; }],
  ["duplicate sequence", f => { f.block().sequence = f.producer.sequence; }],
];
for (const [name, change] of refusedCases) test("current generated Image refuses " + name, async () => {
  const f = fixture(); change(f);
  if (name.startsWith("same-byte")) {
    assert.equal(f.block().payload.properties.media_url, f.mediaUrl); assert.equal(f.block().payload.properties.source_content_hash, digest(originalPng));
    const receipt = f.data.events.find(event => event.type === "ReferenceIngested").payload;
    assert.equal(receipt.source_ref, f.mediaUrl); assert.equal(receipt.content_hash, digest(originalPng));
  }
  await unavailable(f);
});

for (const alias of ["same output", "preview output", "generation reused for another output"]) test("rejects duplicate producer lineage: " + alias, async () => {
  const f = fixture(), payload = structuredClone(f.producer.payload);
  if (alias === "generation reused for another output") { payload.object_id = "other-output"; payload.object_ids = ["other-output"]; }
  f.append(alias === "preview output" ? "IdeationPreviewCompleted" : "GenerationCompleted", payload, "worker:generator");
  await unavailable(f);
});

for (const kind of ["rights revocation", "discard"]) test("out-of-order events cannot reverse " + kind + " despite unique identities", async () => {
  const f = fixture();
  if (kind === "rights revocation") {
    f.append("RightsAsserted", { reference_id: f.referenceId, rights_class: "owned_or_licensed" });
    f.append("RightsAsserted", { reference_id: f.referenceId, rights_class: "revoked" });
    const last = f.data.events.length - 1;
    [f.data.events[last - 1], f.data.events[last]] = [f.data.events[last], f.data.events[last - 1]];
  } else {
    f.append("ObjectDiscarded", { object_id: f.data.outputId });
    f.data.events.splice(f.data.events.indexOf(f.producer), 1); f.data.events.push(f.producer);
  }
  assert.equal(new Set(f.data.events.map(event => event.eventId)).size, f.data.events.length);
  assert.equal(new Set(f.data.events.map(event => event.sequence)).size, f.data.events.length);
  assert.ok(projection(f).libraryOutputs.some(output => output.id === f.data.outputId), "unordered fold alone would still expose the output");
  assert.ok(referenceCompositionSources(projection(f).libraryBlocks, f.data.events, f.now()).some(source => source.id === f.sourceId),
    "unordered reference interpretation alone would still expose the source");
  await unavailable(f);
});

for (const claim of ["width", "hash"]) test("the preparation core checks actual PNG " + claim + " after the current metadata join", async () => {
  const f = fixture();
  if (claim === "width") f.producer.payload.image_width = 25;
  else {
    f.producer.payload.source_content_hash = "a".repeat(64); f.block().payload.properties.source_content_hash = "a".repeat(64);
    f.data.events.find(event => event.type === "ReferenceIngested").payload.content_hash = "a".repeat(64);
  }
  const captured = await capture(f); assert.equal(captured.status, "captured", "this adapter joins declared current facts, not image decoding");
  assert.deepEqual(await join(captured), { status: "refused", code: "invalid" });
});

test("generation IDs cannot introduce a nested generated media filename", async () => {
  const f = fixture(); f.producer.payload.generation_id = "nested/image";
  const mediaUrl = `/api/media/${encodeURIComponent(ownerMediaNamespace(f.data.ownerId) + "/generated/nested/image.png")}`;
  f.producer.payload.media_url = mediaUrl; f.block().payload.properties.media_url = mediaUrl;
  f.block().payload.properties.source_generation_id = "nested/image";
  const receipt = f.data.events.find(event => event.type === "ReferenceIngested").payload;
  receipt.source_ref = mediaUrl; receipt.media_url = mediaUrl; receipt.source_generation_id = "nested/image";
  f.data.content[f.contentRef] = f.raw.replace(f.mediaUrl, mediaUrl);
  await unavailable(f);
});

test("a new raw body during the digest cannot be captured as the old current source", async () => {
  const f = fixture(), pending = capture(f); f.data.content[f.contentRef] = f.raw + " ";
  assert.deepEqual(await pending, { status: "unavailable" });
});

test("observed raw-source retirement invalidates prepared bytes permanently", async () => {
  const f = fixture(), captured = await capture(f); assert.equal(captured.status, "captured");
  const prepared = await join(captured); assert.equal(prepared.status, "prepared");
  try {
    const copy = prepared.copyPng(); f.data.content[f.contentRef] = f.raw + " ";
    assert.equal(captured.current(), null); assert.equal(prepared.copyPng(), null);
    f.data.content[f.contentRef] = f.raw; assert.equal(captured.current(), null); assert.equal(prepared.copyPng(), null);
    assert.deepEqual(copy, editedPng);
  } finally { prepared.dispose(); }
});

for (const change of ["rights", "source event", "source membership", "expiry", "read unavailable"]) test("current callback retires after " + change, async () => {
  const f = fixture(), captured = await capture(f); assert.equal(captured.status, "captured");
  if (change === "rights") f.append("RightsAsserted", { reference_id: f.referenceId, rights_class: "revoked" });
  if (change === "source event") f.producer.eventId = "replacement-producer-event";
  if (change === "source membership") f.associate("another-existing-reference", "another-reference-receipt");
  if (change === "expiry") f.setTime(startTime + 60_000);
  if (change === "read unavailable") f.setRead(null);
  assert.equal(captured.current(), null);
});

test("ObjectSaved and OutputRenamed change their real projection fields without inventing a revision or approval", async () => {
  const f = fixture(), captured = await capture(f); assert.equal(captured.status, "captured");
  const count = f.data.events.length;
  f.append("ObjectSaved", { object_id: f.data.outputId });
  f.append("OutputRenamed", { project_id: f.data.projectId, document_id: f.data.documentId, output_kind: "image", output_id: f.data.outputId,
    object_id: f.data.outputId, new_title: "Renamed Café 雨" });
  const output = projection(f).libraryOutputs[0]; assert.equal(output.saved, true); assert.equal(output.title, "Renamed Café 雨");
  assert.equal(output.titleSource, "authored"); assert.equal(output.sourceEventId, f.producer.eventId);
  assert.deepEqual(captured.current(), { basis: captured.basis, sources: captured.sources });
  const fresh = await capture(f); assert.equal(fresh.status, "captured"); assert.deepEqual(fresh.basis, captured.basis); assert.equal(fresh.basis.revision, 0);
  assert.equal(f.data.events.length, count + 2); assert.deepEqual(f.data.events.slice(count).map(event => event.type), ["ObjectSaved", "OutputRenamed"]);
  assert.deepEqual(Object.keys(fresh).sort(), ["status", "sourceId", "basis", "sources", "current"].sort());
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { GENERATED_IMAGE_EDIT_LIMITS } from "../src/model/generated-image-edit.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { createReferenceComposition, addReferenceCompositionLayer } from "../src/model/reference-composition.ts";
import { parseGeneratedImageEditRequest, parseGeneratedImageRevision, generatedImageOwnedMediaUrl, generatedImageEditOperationSha256, projectGeneratedImageEdit } from "../src/model/generated-image-revision.ts";

// Parsed JSON DTO controls only. No media bytes, write, authentication, current
// source lookup or operation reconciliation occurs at this parsing boundary.
const owner = "team:é/雨", sourceHash = "a".repeat(64), contentHash = "b".repeat(64), resultHash = "c".repeat(64);
const digest = value => createHash("sha256").update(value).digest("hex");
const mediaUrl = (name, user = owner) => "/api/media/" + encodeURIComponent(ownerMediaNamespace(user) + "/generated/" + name);
const derivative = index => mediaUrl("image-edit-019928d0-0b30-7000-8000-" + String(index).padStart(12, "0") + ".png");
const context = { ownerId: owner, projectId: "project-image", documentId: "document-image", outputId: "output-image" };
const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
function fixture(expectedRevision = 0) {
  const source = { id: "reference:image", blockId: "reference", label: "Café 雨", kind: "image",
    mediaUrl: expectedRevision === 0 ? mediaUrl("image-generation.png") : derivative(expectedRevision), contentHash: sourceHash };
  let recipe = addReferenceCompositionLayer(createReferenceComposition("16:9"), source, "back");
  recipe = addReferenceCompositionLayer(recipe, source, "front");
  Object.assign(recipe.layers[0], { x: 40, y: 50, scale: 50, opacity: 100 });
  Object.assign(recipe.layers[1], { x: 60, y: 50, scale: 50, opacity: 50 });
  const request = { expectedRevision, expectedEditEventId: expectedRevision === 0 ? null : "image-edit-event-" + expectedRevision,
    expectedContentSha256: contentHash, generationId: "image-generation", sourceEventId: "original-generation-event", contentRef: "private-image-content",
    sourceMediaUrl: source.mediaUrl, sourceMediaSha256: sourceHash,
    sourceId: source.id, recipe, resultMediaSha256: resultHash, resultByteLength: 1234 };
  const revision = { schemaVersion: 1, operation: "composition", revision: expectedRevision + 1, editEventId: "image-edit-event-" + (expectedRevision + 1),
    outputId: "output-image", documentId: "document-image", generationId: "image-generation", sourceEventId: "original-generation-event",
    contentRef: "private-image-content", contentSha256: contentHash,
    source: { revision: expectedRevision, eventId: request.expectedEditEventId ?? request.sourceEventId, mediaUrl: source.mediaUrl, sha256: sourceHash,
      width: expectedRevision === 0 ? 24 : 1536, height: expectedRevision === 0 ? 24 : 864 },
    media: { url: derivative(expectedRevision + 1), mediaType: "image/png", sha256: resultHash, byteLength: 1234, width: 1536, height: 864 },
    sourceId: source.id, recipe: structuredClone(recipe), recipeSha256: digest(JSON.stringify(parseGeneratedImageEditRequest(request).recipe)),
    operationSha256: digest(JSON.stringify(parseGeneratedImageEditRequest(request))) };
  return { request, revision };
}

test("request parsing produces a complete canonical identity independent of object key insertion order", () => {
  const { request } = fixture(), before = structuredClone(request);
  const parsed = parseGeneratedImageEditRequest(JSON.parse(JSON.stringify(request)));
  assert.ok(parsed); assert.deepEqual(parsed, request);
  assert.deepEqual(Object.keys(parsed), ["expectedRevision", "expectedEditEventId", "expectedContentSha256", "generationId", "sourceEventId", "contentRef", "sourceMediaUrl", "sourceMediaSha256", "sourceId", "recipe", "resultMediaSha256", "resultByteLength"]);
  const reordered = parseGeneratedImageEditRequest(reorder(request));
  assert.deepEqual(reordered, parsed); assert.equal(JSON.stringify(reordered), JSON.stringify(parsed));
  assert.equal(digest(JSON.stringify(reordered)), digest(JSON.stringify(parsed)));
  assert.deepEqual(request, before);
  parsed.recipe.layers[0].x = 0; parsed.recipe.sources[0].label = "mutated";
  assert.deepEqual(request, before, "normalized request owns its recipe and source records");
});

test("each request field contributes to operation identity, including result bytes and authored paint order", async () => {
  const { request } = fixture(1), original = JSON.stringify(parseGeneratedImageEditRequest(request));
  const originalOperation = await generatedImageEditOperationSha256(context, request); assert.match(originalOperation, /^[a-f0-9]{64}$/);
  const changes = [
    ["expected revision", value => { value.expectedRevision++; }],
    ["expected edit event", value => { value.expectedEditEventId = "another-edit-event"; }],
    ["exact private content hash", value => { value.expectedContentSha256 = "d".repeat(64); }],
    ["generation identity", value => { value.generationId = "another-generation"; }],
    ["original producer event", value => { value.sourceEventId = "another-producer-event"; }],
    ["private content reference", value => { value.contentRef = "another-private-content"; }],
    ["source URL", value => { value.sourceMediaUrl = derivative(7); value.recipe.sources[0].mediaUrl = value.sourceMediaUrl; }],
    ["source bytes", value => { value.sourceMediaSha256 = "d".repeat(64); value.recipe.sources[0].contentHash = value.sourceMediaSha256; }],
    ["selected source", value => { value.sourceId = "other:image"; value.recipe.sources[0].id = value.sourceId; for (const layer of value.recipe.layers) layer.sourceId = value.sourceId; }],
    ["recipe geometry", value => { value.recipe.layers[0].x++; }],
    ["result hash", value => { value.resultMediaSha256 = "d".repeat(64); }],
    ["result byte length", value => { value.resultByteLength++; }],
    ["paint order", value => { value.recipe.layers.reverse(); }],
  ];
  for (const [name, change] of changes) {
    const next = structuredClone(request); change(next);
    const parsed = parseGeneratedImageEditRequest(next); assert.ok(parsed, name);
    assert.notEqual(digest(JSON.stringify(parsed)), digest(original), name);
    const operation = await generatedImageEditOperationSha256(context, next);
    assert.match(operation, /^[a-f0-9]{64}$/, name); assert.notEqual(operation, originalOperation, name);
  }
  const backwards = structuredClone(request); backwards.recipe.layers.reverse();
  assert.deepEqual(parseGeneratedImageEditRequest(backwards).recipe.layers.map(layer => layer.id), ["front", "back"]);
});

test("operation hashing binds all four supplied context identities and canonical request data without granting access", async () => {
  const { request, revision } = fixture(), before = structuredClone({ context, request });
  const operation = await generatedImageEditOperationSha256(context, request);
  assert.equal(operation, digest(JSON.stringify({ ...context, request: parseGeneratedImageEditRequest(request) })));
  assert.equal(await generatedImageEditOperationSha256(reorder(context), reorder(request)), operation);
  for (const key of ["projectId", "documentId", "outputId"]) {
    const changed = await generatedImageEditOperationSha256({ ...context, [key]: "another-" + key }, request);
    assert.match(changed, /^[a-f0-9]{64}$/); assert.notEqual(changed, operation, key);
  }
  assert.equal(await generatedImageEditOperationSha256({ ...context, ownerId: "another-owner" }, request), null, "a canonical URL for another owner cannot use this context");
  const otherRequest = structuredClone(request);
  otherRequest.sourceMediaUrl = mediaUrl("image-generation.png", "another-owner"); otherRequest.recipe.sources[0].mediaUrl = otherRequest.sourceMediaUrl;
  const otherOperation = await generatedImageEditOperationSha256({ ...context, ownerId: "another-owner" }, otherRequest);
  assert.match(otherOperation, /^[a-f0-9]{64}$/); assert.notEqual(otherOperation, operation);
  assert.equal(await generatedImageEditOperationSha256({ ...context, approved: true }, request), null);
  assert.equal(await generatedImageEditOperationSha256({ ...context, outputId: "" }, request), null);
  assert.equal(await generatedImageEditOperationSha256(context, { ...request, resultByteLength: 0 }), null);
  revision.operationSha256 = operation;
  assert.equal(parseGeneratedImageRevision(revision, owner).operationSha256, operation);
  assert.deepEqual({ context, request }, before);
});

test("all three recipe aspects and inclusive geometry bounds retain exact authored values", () => {
  for (const [aspect, width, height] of [["1:1", 1536, 1536], ["16:9", 1536, 864], ["9:16", 864, 1536]]) {
    const { request, revision } = fixture();
    Object.assign(request.recipe, { aspect, width, height });
    Object.assign(request.recipe.layers[0], { x: 0, y: 100, scale: 5, opacity: 0 });
    Object.assign(request.recipe.layers[1], { x: 100, y: 0, scale: 200, opacity: 100 });
    const parsed = parseGeneratedImageEditRequest(request); assert.ok(parsed); assert.deepEqual(parsed.recipe, request.recipe);
    revision.recipe = request.recipe; Object.assign(revision.media, { width, height });
    revision.recipeSha256 = digest(JSON.stringify(parsed.recipe)); revision.operationSha256 = digest(JSON.stringify(parsed));
    assert.deepEqual(parseGeneratedImageRevision(revision, owner), revision);
  }
  const { request } = fixture(); request.resultByteLength = GENERATED_IMAGE_EDIT_LIMITS.pngBytes;
  assert.equal(parseGeneratedImageEditRequest(request).resultByteLength, GENERATED_IMAGE_EDIT_LIMITS.pngBytes);
});

const requestFaults = [
  ["unknown request key", value => { value.approved = true; }],
  ["missing request key", value => { delete value.resultByteLength; }],
  ["negative revision", value => { value.expectedRevision = -1; }],
  ["fractional revision", value => { value.expectedRevision = 0.5; }],
  ["unsafe revision", value => { value.expectedRevision = Number.MAX_SAFE_INTEGER + 1; }],
  ["numeric string revision", value => { value.expectedRevision = "0"; }],
  ["initial revision with an edit event", value => { value.expectedEditEventId = "invented-edit-event"; }],
  ["edited revision without its event", value => { value.expectedRevision = 1; }],
  ["empty generation identity", value => { value.generationId = ""; }],
  ["missing original producer identity", value => { delete value.sourceEventId; }],
  ["source URL inconsistent with selected recipe", value => { value.sourceMediaUrl = mediaUrl("other.png"); }],
  ["uppercase hash", value => { value.expectedContentSha256 = "A".repeat(64); }],
  ["short result hash", value => { value.resultMediaSha256 = "c".repeat(63); }],
  ["selected source hash mismatch", value => { value.sourceMediaSha256 = "d".repeat(64); }],
  ["zero bytes", value => { value.resultByteLength = 0; }],
  ["fractional bytes", value => { value.resultByteLength = 1.5; }],
  ["oversize bytes", value => { value.resultByteLength = GENERATED_IMAGE_EDIT_LIMITS.pngBytes + 1; }],
  ["unknown selected source", value => { value.sourceId = "absent:image"; }],
  ["format-control source token", value => { value.sourceId = "reference\u200b:image"; }],
  ["model view selected as generated image", value => { value.recipe.sources[0].kind = "model-view"; }],
  ["transparent-only layers", value => { for (const layer of value.recipe.layers) layer.opacity = 0; }],
  ["unknown recipe key", value => { value.recipe.approved = true; }],
  ["unknown source key", value => { value.recipe.sources[0].approved = true; }],
  ["unknown layer key", value => { value.recipe.layers[0].rotation = 0; }],
  ["source label needing trim", value => { value.recipe.sources[0].label = " Café 雨 "; }],
  ["source hash needing case normalization", value => { value.recipe.sources[0].contentHash = "A".repeat(64); }],
  ["source URL needing canonical encoding", value => { value.recipe.sources[0].mediaUrl = value.recipe.sources[0].mediaUrl.replace(/%2F/g, "%2f"); }],
  ["locked-source field in persisted recipe", value => { value.recipe.sources[0].requiresUnlock = true; }],
  ["duplicate source ID", value => { value.recipe.sources.push(structuredClone(value.recipe.sources[0])); }],
  ["duplicate layer ID", value => { value.recipe.layers[1].id = value.recipe.layers[0].id; }],
  ["unused source", value => { value.recipe.sources.push({ ...value.recipe.sources[0], id: "unused:image" }); }],
  ["unbound layer", value => { value.recipe.layers[0].sourceId = "absent:image"; }],
  ["incorrect aspect dimensions", value => { value.recipe.width = 1535; }],
  ["unsupported background", value => { value.recipe.background = "red"; }],
  ["out-of-range x", value => { value.recipe.layers[0].x = -0.01; }],
  ["out-of-range y", value => { value.recipe.layers[0].y = 100.01; }],
  ["out-of-range scale", value => { value.recipe.layers[0].scale = 4.99; }],
  ["out-of-range opacity", value => { value.recipe.layers[0].opacity = 100.01; }],
  ["null numeric geometry", value => { value.recipe.layers[0].x = null; }],
];
for (const [name, change] of requestFaults) test("request refuses " + name, () => {
  const { request } = fixture(); change(request); assert.equal(parseGeneratedImageEditRequest(request), null);
});

test("serialized null, scalar and array values are not request or revision records", () => {
  for (const value of [null, false, true, 0, "{}", [], [{}]]) {
    assert.equal(parseGeneratedImageEditRequest(value), null); assert.equal(parseGeneratedImageRevision(value, owner), null);
  }
});

test("owned URLs use the exact canonical owner namespace and derivative UUID-v7 filename", () => {
  const original = mediaUrl("image-generation.png"), edited = derivative(1);
  assert.equal(generatedImageOwnedMediaUrl(original, owner), true);
  assert.equal(generatedImageOwnedMediaUrl(edited, owner, true), true);
  assert.equal(generatedImageOwnedMediaUrl(edited, owner), true, "a previous derivative can be the source of another edit");
  assert.equal(generatedImageOwnedMediaUrl(original, owner, true), false);
  const rejected = [
    mediaUrl("image-generation.png", "other-owner"),
    "/api/media/" + encodeURIComponent(owner + "/generated/image-generation.png"),
    original.replace(/%2F/g, "%2f"), original + "?download=1", original + "#image",
    original.replace("/api/media/", "https://example.invalid/api/media/"), "/api/media/%ZZ",
    mediaUrl("nested/image.png"), mediaUrl("../image.png"), mediaUrl("image.svg"),
  ];
  for (const url of rejected) assert.equal(generatedImageOwnedMediaUrl(url, owner), false, url);
  for (const url of [edited.replace("-7000-", "-4000-"), edited.replace("-8000-", "-7000-"), edited.replace("image-edit-", "video-trim-"), edited.replace(".png", ".mp4")]) {
    assert.equal(generatedImageOwnedMediaUrl(url, owner, true), false, url);
  }
  assert.equal(generatedImageOwnedMediaUrl(edited, ""), false);
});

test("revision DTOs retain both historical source and new media without inventing currentness", () => {
  const original = fixture(0), later = fixture(1);
  for (const { revision } of [original, later]) {
    const before = structuredClone(revision), parsed = parseGeneratedImageRevision(reorder(revision), owner);
    assert.ok(parsed); assert.deepEqual(parsed, revision);
    assert.equal(parsed.source.revision, parsed.revision - 1); assert.notEqual(parsed.media.url, parsed.source.mediaUrl);
    assert.equal(parsed.editEventId, "image-edit-event-" + parsed.revision);
    assert.equal(parsed.source.eventId, parsed.source.revision === 0 ? parsed.sourceEventId : "image-edit-event-" + parsed.source.revision);
    assert.equal(parsed.sourceEventId, "original-generation-event"); assert.equal(parsed.generationId, "image-generation");
    assert.equal(JSON.stringify(parsed), JSON.stringify(parseGeneratedImageRevision(revision, owner)));
    assert.deepEqual(Object.keys(parsed).sort(), Object.keys(revision).sort());
    parsed.source.width = 1; parsed.media.width = 1; parsed.recipe.layers[0].x = 0;
    assert.deepEqual(revision, before, "the parsed DTO owns nested source, media and recipe records");
  }
  assert.equal(later.revision.source.mediaUrl, original.revision.media.url);
  assert.equal(later.revision.source.eventId, original.revision.editEventId);
  assert.ok(parseGeneratedImageRevision(original.revision, owner), "an older well-formed DTO remains parseable; the handler must select the current head");
});

const revisionFaults = [
  ["unknown top-level field", value => { value.saved = true; }],
  ["missing content identity", value => { delete value.contentRef; }],
  ["wrong schema", value => { value.schemaVersion = 2; }],
  ["wrong operation", value => { value.operation = "prefix-trim"; }],
  ["zero saved revision", value => { value.revision = 0; }],
  ["unsafe saved revision", value => { value.revision = Number.MAX_SAFE_INTEGER + 1; }],
  ["skipped source revision", value => { value.revision = 3; }],
  ["source revision equal to result", value => { value.source.revision = value.revision; }],
  ["source event equal to new edit event", value => { value.source.eventId = value.editEventId; }],
  ["new edit event aliases original producer", value => { value.editEventId = value.sourceEventId; }],
  ["first source event differs from original producer", value => { value.source.eventId = "unrelated-event"; }],
  ["empty edit event", value => { value.editEventId = ""; }],
  ["empty producer event", value => { value.sourceEventId = ""; }],
  ["format-control output identity", value => { value.outputId = "output\u200b"; }],
  ["malformed content hash", value => { value.contentSha256 = "not-a-hash"; }],
  ["malformed recipe hash", value => { value.recipeSha256 = "A".repeat(64); }],
  ["malformed operation hash", value => { value.operationSha256 = "a".repeat(63); }],
  ["extra source field", value => { value.source.current = true; }],
  ["foreign source owner", value => { value.source.mediaUrl = mediaUrl("image-generation.png", "other-owner"); value.recipe.sources[0].mediaUrl = value.source.mediaUrl; }],
  ["foreign result owner", value => { value.media.url = value.media.url.replace(encodeURIComponent(ownerMediaNamespace(owner)), encodeURIComponent(ownerMediaNamespace("other-owner"))); }],
  ["source hash inconsistent with recipe", value => { value.source.sha256 = "d".repeat(64); }],
  ["source URL inconsistent with recipe", value => { value.source.mediaUrl = mediaUrl("other-generation.png"); }],
  ["invalid original width", value => { value.source.width = 0; }],
  ["oversize original height", value => { value.source.height = 16_385; }],
  ["non-derivative result filename", value => { value.media.url = mediaUrl("ordinary-generation.png"); }],
  ["overwriting source URL", value => { value.source.mediaUrl = value.media.url; value.recipe.sources[0].mediaUrl = value.media.url; }],
  ["wrong result MIME", value => { value.media.mediaType = "image/jpeg"; }],
  ["extra media field", value => { value.media.verified = true; }],
  ["oversize result byte length", value => { value.media.byteLength = GENERATED_IMAGE_EDIT_LIMITS.pngBytes + 1; }],
  ["result width inconsistent with recipe", value => { value.media.width = 1535; }],
  ["unselected source ID", value => { value.sourceId = "absent:image"; }],
  ["all invisible revision layers", value => { value.recipe.layers.forEach(layer => { layer.opacity = 0; }); }],
];
for (const [name, change] of revisionFaults) test("revision refuses " + name, () => {
  const { revision } = fixture(); change(revision); assert.equal(parseGeneratedImageRevision(revision, owner), null);
});

test("a later source revision requires its prior edit event rather than the original generation event", () => {
  const { revision } = fixture(1); assert.ok(parseGeneratedImageRevision(revision, owner));
  revision.source.eventId = revision.sourceEventId;
  assert.equal(parseGeneratedImageRevision(revision, owner), null);
});

test("recipe byte and layer limits apply to both serialized boundaries", () => {
  const { request, revision } = fixture(), source = request.recipe.sources[0];
  let large = createReferenceComposition("16:9");
  for (let index = 0; index < 12; index++) large = addReferenceCompositionLayer(large, {
    ...source, id: "source-" + index + "x".repeat(240), blockId: "block-" + index + "y".repeat(240),
    label: "雨".repeat(160), mediaUrl: mediaUrl("z".repeat(1800) + index + ".png"),
  }, "layer-" + index);
  assert.equal(large.sources.length, 12); assert.equal(large.layers.length, 12);
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength > GENERATED_IMAGE_EDIT_LIMITS.recipeBytes);
  request.recipe = large; request.sourceId = large.sources[0].id;
  request.sourceMediaUrl = large.sources[0].mediaUrl;
  revision.recipe = large; revision.sourceId = large.sources[0].id;
  revision.source.mediaUrl = large.sources[0].mediaUrl;
  assert.equal(parseGeneratedImageEditRequest(request), null); assert.equal(parseGeneratedImageRevision(revision, owner), null);
  const excess = fixture();
  for (let index = excess.request.recipe.layers.length; index < 13; index++) excess.request.recipe.layers.push({ ...excess.request.recipe.layers[0], id: "layer-" + index });
  excess.revision.recipe = excess.request.recipe;
  assert.equal(parseGeneratedImageEditRequest(excess.request), null); assert.equal(parseGeneratedImageRevision(excess.revision, owner), null);
});


// The projection keeps immutable generation provenance separately from edited
// media. These are event-shape controls, not server ingress or private-row proof.
function projectionFixture() {
  const { request, revision } = fixture();
  const output = { id:context.outputId, documentId:context.documentId, generationId:request.generationId,
    sourceEventId:request.sourceEventId, contentRef:request.contentRef, sequence:3, mediaUrl:request.sourceMediaUrl,
    mediaType:"image/png", width:24, height:24, quality:"high", purpose:"final", discarded:false,
    saved:true, pinned:true, title:"Original title", focalPoint:{x:0.2,y:0.7} };
  const event = { eventId:revision.editEventId, streamId:"creative:"+owner, sequence:6, actor:"user", clientId:"web:generated-image-editor",
    occurredAt:"2026-09-10T12:00:00.000Z",recordedAt:"2026-09-10T12:00:00.000Z",correlationId:"edit-operation",
    causationId:null,compensatesEventId:null,schemaVersion:1,type:"GeneratedImageEdited",payload:{
      output_id:context.outputId,object_id:context.outputId,document_id:context.documentId,project_id:context.projectId,
      generation_id:request.generationId,source_event_id:request.sourceEventId,content_ref:request.contentRef,content_sha256:contentHash,
      revision:1,previous_revision:0,previous_edit_event_id:null,image_revision_id:"private-revision-row",image_revision_sha256:"d".repeat(64),
      image_edit_operation_sha256:revision.operationSha256,media_url:revision.media.url,media_type:"image/png",source_content_hash:resultHash,
      image_width:1536,image_height:864,image_byte_length:1234,source_surface:"generated-image-editor",edited_by_user_id:owner,
    } };
  return {output,event,request,revision};
}

test("projection separates current edited media from immutable generation identity and old focal point", () => {
  const {output,event,revision}=projectionFixture(), before=structuredClone({output,event});
  const edited=projectGeneratedImageEdit(output,event,context);assert.ok(edited);
  for(const key of ["id","documentId","generationId","sourceEventId","contentRef","sequence","title","saved","pinned"]) assert.equal(edited[key],output[key],key);
  assert.equal(edited.mediaUrl,revision.media.url);assert.equal(edited.width,1536);assert.equal(edited.height,864);
  assert.equal(edited.focalPoint,null,"the previous pixel focal point is not attached to new pixels");
  assert.equal(edited.imageRevision.revision,1);assert.equal(edited.imageRevision.editEventId,event.eventId);
  assert.equal(edited.imageRevision.editSequence,6);assert.equal(edited.imageRevision.mediaSha256,resultHash);
  assert.equal(Object.hasOwn(edited,"approved"),false);assert.ok(Object.isFrozen(edited.imageRevision));
  assert.deepEqual({output,event},before);
  const later=structuredClone(event);later.eventId="image-edit-event-2";later.sequence=9;
  Object.assign(later.payload,{revision:2,previous_revision:1,previous_edit_event_id:event.eventId,media_url:derivative(2),image_revision_id:"private-row-2",image_edit_operation_sha256:"e".repeat(64)});
  const second=projectGeneratedImageEdit(edited,later,context);assert.ok(second);assert.equal(second.sourceEventId,output.sourceEventId);
  assert.equal(second.imageRevision.revision,2);assert.equal(second.mediaUrl,derivative(2));
});

const projectionFaults=[
 ["foreign owner",value=>{value.streamId="creative:foreign";}], ["foreign client",value=>{value.clientId="web:manual";}],
 ["wrong actor",value=>{value.actor="worker:generator";}], ["reused producer event",value=>{value.eventId="original-generation-event";}],
 ["non-forward sequence",value=>{value.sequence=3;}], ["foreign output alias",value=>{value.payload.object_id="other";}],
 ["foreign document",value=>{value.payload.document_id="other";}], ["foreign project",value=>{value.payload.project_id="other";}],
 ["foreign generation",value=>{value.payload.generation_id="other";}], ["replaced original event",value=>{value.payload.source_event_id="other";}],
 ["replaced raw reference",value=>{value.payload.content_ref="other";}], ["missing raw hash",value=>{delete value.payload.content_sha256;}],
 ["revision gap",value=>{value.payload.revision=2;}], ["unexpected previous edit",value=>{value.payload.previous_edit_event_id="other";}],
 ["foreign derivative media",value=>{value.payload.media_url=mediaUrl("image-edit-019928d0-0b30-7000-8000-000000000001.png","foreign");}],
 ["original URL reused",value=>{value.payload.media_url=mediaUrl("image-generation.png");}], ["unsafe byte count",value=>{value.payload.image_byte_length=Number.MAX_SAFE_INTEGER+1;}],
 ["oversize PNG",value=>{value.payload.image_byte_length=GENERATED_IMAGE_EDIT_LIMITS.pngBytes+1;}], ["wrong result MIME",value=>{value.payload.media_type="image/jpeg";}],
];
for(const [name,change] of projectionFaults)test("edited projection refuses "+name,()=>{
 const {output,event}=projectionFixture();change(event);assert.equal(projectGeneratedImageEdit(output,event,context),null);
});

test("projection refuses discarded, draft or foreign predecessor media and repeated edits",()=>{
 const {output,event}=projectionFixture();
 for(const change of [value=>{value.discarded=true;},value=>{value.quality="low";},value=>{value.purpose="ideate";},value=>{value.mediaType="image/jpeg";},value=>{value.mediaUrl=mediaUrl("image-generation.png","foreign");}]){
  const before=structuredClone(output);change(before);assert.equal(projectGeneratedImageEdit(before,event,context),null);
 }
 const edited=projectGeneratedImageEdit(output,event,context);assert.ok(edited);assert.equal(projectGeneratedImageEdit(edited,event,context),null);
 const later=structuredClone(event);later.eventId="next";later.sequence=9;Object.assign(later.payload,{revision:2,previous_revision:1,previous_edit_event_id:event.eventId,media_url:derivative(2),content_sha256:"f".repeat(64)});
 assert.equal(projectGeneratedImageEdit(edited,later,context),null,"later history cannot silently replace raw planner content");
});


test("Projects bootstrap includes the edited current pixels and leaves a neighboring unedited output intact",async()=>{
 const {foldEvents}=await import("../src/model/events.ts");const {eventMatchesProfile}=await import("../src/model/event-profiles.ts");
 const {event}=projectionFixture();
 const basic=(type,payload,sequence,eventId)=>({...event,type,payload,sequence,eventId,clientId:"web:fixture",actor:"user"});
 const project=basic("ProjectCreated",{project_id:context.projectId,name:"Images"},1,"project");
 const doc=basic("DocumentCreated",{project_id:context.projectId,document_id:context.documentId,title:"Harbor"},2,"document");
 const complete=basic("GenerationCompleted",{project_id:context.projectId,document_id:context.documentId,object_id:context.outputId,object_ids:[context.outputId],generation_id:"image-generation",output_ref:"private-image-content",media_url:mediaUrl("image-generation.png"),media_type:"image/png",image_width:24,image_height:24,quality:"high",purpose:"final",simulation:false,source_content_hash:sourceHash},3,"original-generation-event");complete.actor="worker:generator";
 const neighbor=structuredClone(complete);neighbor.sequence=4;neighbor.eventId="neighbor-origin";Object.assign(neighbor.payload,{object_id:"neighbor",object_ids:["neighbor"],generation_id:"neighbor-generation",media_url:mediaUrl("neighbor-generation.png")});
 const retained=[project,doc,complete,neighbor,event];const filtered=retained.filter(item=>eventMatchesProfile("projects",item.type,item.payload));
 assert.equal(filtered.length,5);const state=foldEvents(filtered,Infinity,context.documentId,context.projectId);
 const edited=state.libraryOutputs.find(item=>item.id===context.outputId),other=state.libraryOutputs.find(item=>item.id==="neighbor");
 assert.equal(edited.mediaUrl,event.payload.media_url);assert.equal(edited.imageRevision.editEventId,event.eventId);assert.equal(edited.imageRevision.revision,1);
 assert.equal(edited.sourceEventId,complete.eventId);assert.equal(edited.generationId,complete.payload.generation_id);assert.equal(edited.sequence,3);
 assert.equal(other.mediaUrl,neighbor.payload.media_url);assert.equal(other.imageRevision,undefined);
 const bad=structuredClone(event);bad.payload.previous_revision=9;
 const refused=foldEvents([project,doc,complete,neighbor,bad],Infinity,context.documentId,context.projectId).libraryOutputs;
 assert.equal(refused.find(item=>item.id===context.outputId).mediaUrl,null,"a malformed targeted edit cannot expose old pixels as current");
 assert.equal(refused.find(item=>item.id==="neighbor").mediaUrl,neighbor.payload.media_url);
});

// A legacy generation focal result names the original output, not the edited
// PNG revision. Arrival after Save must not reattach original-pixel coordinates.
test("late original-generation focal results cannot overwrite edited Image pixels", async () => {
  const { foldEvents } = await import("../src/model/events.ts");
  const { event } = projectionFixture();
  const basic = (type, payload, sequence, eventId) => ({ ...event, type, payload, sequence, eventId, clientId: "web:fixture", actor: "user" });
  const project = basic("ProjectCreated", { project_id: context.projectId, name: "Images" }, 1, "project");
  const document = basic("DocumentCreated", { project_id: context.projectId, document_id: context.documentId, title: "Harbor" }, 2, "document");
  const complete = basic("GenerationCompleted", { project_id: context.projectId, document_id: context.documentId,
    object_id: context.outputId, object_ids: [context.outputId], generation_id: "image-generation", output_ref: "private-image-content",
    media_url: mediaUrl("image-generation.png"), media_type: "image/png", image_width: 24, image_height: 24,
    quality: "high", purpose: "final", simulation: false, source_content_hash: sourceHash, focal_point: { x: 0.2, y: 0.7, confidence: 0.9, method: "saliency-grid-v1", sampleWidth: 24, sampleHeight: 24 } }, 3, "original-generation-event");
  complete.actor = "worker:generator";
  const late = basic("ImageFocalPointCalculated", { target_kind: "generation", target_id: context.outputId,
    focal_point: { x: 0.8, y: 0.1, confidence: 0.9, method: "saliency-grid-v1", sampleWidth: 24, sampleHeight: 24 } }, 7, "late-original-focal-result");
  const current = events => foldEvents(events, Infinity, context.documentId, context.projectId).libraryOutputs.find(output => output.id === context.outputId);
  const original = current([project, document, complete]);
  assert.ok(original.focalPoint, "this fixture starts with actual non-null normalized coordinates");
  assert.equal(original.focalPoint.x, 0.2); assert.equal(original.focalPoint.y, 0.7);
  const unedited = current([project, document, complete, late]);
  assert.equal(unedited.imageRevision, undefined); assert.equal(unedited.focalPoint.x, 0.8); assert.equal(unedited.focalPoint.y, 0.1);
  const saved = current([project, document, complete, event]);
  assert.equal(saved.imageRevision.revision, 1); assert.equal(saved.focalPoint, null);
  const afterLate = current([project, document, complete, event, late]);
  assert.equal(afterLate.mediaUrl, event.payload.media_url); assert.equal(afterLate.imageRevision.editEventId, event.eventId);
  assert.equal(afterLate.focalPoint, null, "an unbound late calculation cannot relabel edited pixels");
  const neighbor = { ...complete, eventId: "neighbor-generation", sequence: 4, payload: { ...complete.payload,
    object_id: "neighbor-image", object_ids: ["neighbor-image"], generation_id: "neighbor-generation" } };
  const neighborFocal = { ...late, eventId: "neighbor-focal", sequence: 8, payload: { ...late.payload,
    target_id: "neighbor-image", focal_point: { x: 0.6, y: 0.4, confidence: 0.9, method: "saliency-grid-v1", sampleWidth: 24, sampleHeight: 24 } } };
  const pair = foldEvents([project, document, complete, neighbor, event, late, neighborFocal], Infinity, context.documentId, context.projectId).libraryOutputs;
  assert.equal(pair.find(output => output.id === context.outputId).focalPoint, null);
  const untouched = pair.find(output => output.id === "neighbor-image");
  assert.equal(untouched.imageRevision, undefined); assert.equal(untouched.focalPoint.x, 0.6); assert.equal(untouched.focalPoint.y, 0.4);
  const early = { ...late, eventId: "early-original-focal-result", sequence: 4 };
  assert.equal(current([project, document, complete, early, event]).focalPoint, null, "Save also clears coordinates calculated before the edit");
});

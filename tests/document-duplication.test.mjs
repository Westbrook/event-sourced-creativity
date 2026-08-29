import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDocumentDuplicationPlan } from "../src/model/document-duplication.ts";
import { foldEvents } from "../src/model/events.ts";

const event = (sequence, type, payload, actor = "user") => ({
  eventId: `event-${sequence}`,
  streamId: "creative:owner",
  sequence,
  occurredAt: new Date(Date.UTC(2026, 7, 26, 12, 0, sequence)).toISOString(),
  recordedAt: new Date(Date.UTC(2026, 7, 26, 12, 0, sequence)).toISOString(),
  actor,
  clientId: "test",
  correlationId: `correlation-${sequence}`,
  causationId: null,
  compensatesEventId: null,
  schemaVersion: 1,
  type,
  payload,
});

const baseline = () => [
  event(1, "ProjectCreated", { project_id: "project-a", name: "Document comparison" }),
  event(2, "DocumentCreated", { project_id: "project-a", document_id: "original", title: "Original pitch", handle: "original-pitch" }),
  event(3, "BlockCreated", {
    project_id: "project-a", document_id: "original", block_id: "message", type: "message", handle: "message/nine-slide-pitch", position: "a0",
    properties: {
      text: "Slide 1 — One context\nSlide 2 — Many formats", authority: "authored", weight: .8,
      context_set_id: "group-a", context_set_root_id: "message",
      combined_context_memberships: [{ contextSetId: "group-a", context_set_id: "group-a", name: "Pitch", role: "message", target: "Pitch", application: "isolate", relativity: .8, memberOrder: 0, sourceCanvasId: "" }],
    },
  }),
  event(4, "BlockCreated", {
    project_id: "project-a", document_id: "original", block_id: "reference", type: "reference", handle: "reference/source", position: "a1",
    properties: { text: "Rights-confirmed source", reference_id: "licensed-reference", media_url: "/api/media/source", source_evidence_hash: "sha256-source", rights_class: "owned_or_licensed" },
  }),
  event(5, "BlockCreated", {
    project_id: "project-a", document_id: "original", block_id: "action", type: "action", handle: "action/present", position: "a2",
    properties: { text: "Present @message", source_block_id: "message", block_references: [{ block_id: "message", handle: "message/nine-slide-pitch", role: "target" }] },
  }),
  event(6, "BlockRelationAdded", {
    project_id: "project-a", document_id: "original", relation_id: "contains", from_block_id: "message", to_block_id: "reference", kind: "context_contains",
    properties: { context_set_id: "group-a", member_order: 0 },
  }),
  event(7, "BlockRelationAdded", {
    project_id: "project-a", document_id: "original", relation_id: "participant", from_block_id: "action", to_block_id: "message", kind: "action_participant",
    properties: { participant_role: "target", handle: "message/nine-slide-pitch" },
  }),
  event(8, "BlockLocked", { project_id: "project-a", document_id: "original", block_id: "reference" }),
  event(9, "DocumentRenderCompleted", {
    project_id: "project-a", document_id: "original", artifact_id: "original-slides", artifact_kind: "slides", title: "Original pitch", item_count: 1,
    items: [{ id: "slide-1", title: "One context", body: "Original only" }],
  }, "worker:renderer"),
];

test("duplicates document context, protected source evidence, relationships and locks without copying outputs", () => {
  const original = baseline();
  const projection = foldEvents(original);
  let ordinal = 0;
  const plan = buildDocumentDuplicationPlan({
    projection,
    sourceDocumentId: "original",
    title: "Decomposed pitch",
    sourceStreamId: "creative:owner",
    sourceSequence: 9,
    createId: () => `copy-${++ordinal}`,
  });

  assert.equal(plan.documentId, "copy-1");
  assert.equal(plan.blockCount, 3);
  assert.equal(plan.relationCount, 2);
  assert.equal(plan.events[0].type, "DocumentCreated");
  assert.equal(plan.events[0].payload.source_document_id, "original");
  assert.equal(plan.events[0].payload.source_stream_id, "creative:owner");
  assert.deepEqual(plan.events[0].payload.carried_block_ids, ["message", "reference", "action"]);
  assert.ok(plan.events.every((entry) => entry.type !== "DocumentRenderCompleted"));

  const copiedEvents = plan.events.map((entry, index) => event(original.length + index + 1, entry.type, entry.payload));
  const copy = foldEvents([...original, ...copiedEvents], Number.POSITIVE_INFINITY, plan.documentId, "project-a");
  const source = foldEvents([...original, ...copiedEvents], Number.POSITIVE_INFINITY, "original", "project-a");

  assert.equal(copy.documentTitle, "Decomposed pitch");
  assert.equal(copy.documents.length, 2);
  assert.equal(copy.blocks.length, 3);
  assert.equal(copy.artifacts.length, 0);
  assert.equal(source.artifacts.length, 1);
  assert.deepEqual(source.blocks.map((block) => block.id), ["message", "reference", "action"]);

  const copiedMessage = copy.blocks.find((block) => block.type === "message");
  const copiedReference = copy.blocks.find((block) => block.type === "reference");
  const copiedAction = copy.blocks.find((block) => block.type === "action");
  assert.notEqual(copiedMessage.id, "message");
  assert.equal(copiedMessage.handle, "message/nine-slide-pitch");
  assert.equal(copiedMessage.properties.text, source.blocks[0].properties.text);
  assert.notEqual(copiedMessage.properties.context_set_id, "group-a");
  assert.equal(copiedMessage.properties.context_set_root_id, copiedMessage.id);
  assert.equal(copiedMessage.properties.combined_context_memberships[0].contextSetId, copiedMessage.properties.context_set_id);
  assert.equal(copiedMessage.properties.combined_context_memberships[0].context_set_id, copiedMessage.properties.context_set_id);
  assert.equal(copiedReference.properties.reference_id, "licensed-reference");
  assert.equal(copiedReference.properties.source_evidence_hash, "sha256-source");
  assert.equal(copiedReference.properties.media_url, "/api/media/source");
  assert.equal(copiedReference.locked, true);
  assert.equal(copiedAction.properties.source_block_id, "message");
  assert.deepEqual(copiedAction.properties.block_references, [{ block_id: copiedMessage.id, handle: "message/nine-slide-pitch", role: "target" }]);

  const copiedContains = copy.blockRelations.find((relation) => relation.kind === "context_contains");
  assert.equal(copiedContains.fromBlockId, copiedMessage.id);
  assert.equal(copiedContains.toBlockId, copiedReference.id);
  assert.equal(copiedContains.properties.context_set_id, copiedMessage.properties.context_set_id);
  assert.equal(plan.events.at(-1).type, "BlockLocked");
});

test("refuses to silently duplicate governed organization context", () => {
  const events = baseline();
  events.push(event(10, "BlockCreated", {
    project_id: "project-a", document_id: "original", block_id: "governed", type: "direction", handle: "direction/governed", position: "a3",
    properties: { text: "Published direction", organization_context_package_binding_id: "binding-1" },
  }));
  assert.throws(() => buildDocumentDuplicationPlan({
    projection: foldEvents(events), sourceDocumentId: "original", title: "Unsafe copy", sourceStreamId: "creative:owner", sourceSequence: 10,
  }), /Published organization context cannot be duplicated/);
});

test("supports empty documents and rejects documents outside the current project", () => {
  const projection = foldEvents([
    event(1, "ProjectCreated", { project_id: "project-a", name: "A" }),
    event(2, "DocumentCreated", { project_id: "project-a", document_id: "empty", title: "Empty" }),
  ]);
  const plan = buildDocumentDuplicationPlan({
    projection, sourceDocumentId: "empty", title: "Empty copy", sourceStreamId: "creative:owner", sourceSequence: 2, createId: () => "empty-copy",
  });
  assert.equal(plan.blockCount, 0);
  assert.equal(plan.events.length, 1);
  assert.throws(() => buildDocumentDuplicationPlan({
    projection, sourceDocumentId: "missing", title: "No copy", sourceStreamId: "creative:owner", sourceSequence: 2,
  }), /no longer available/);
});

test("project contents reuses its copy slot for author confirmation and reader-only recovery", async () => {
  const source = await readFile(new URL("../src/components/forma-project-contents.ts", import.meta.url), "utf8");
  assert.match(source, /document-duplicate-trigger/);
  assert.match(source, /copyAccess\.canRead\?html`<button type="button" class="button ghost document-duplicate-trigger"/);
  assert.match(source, /copyAccess\.canAuthor\?this\.i18n\.system\("Duplicate"\)/);
  assert.match(source, /document\.copy\.check/);
  assert.match(source, /previewDocumentCopy/);
  assert.match(source, /applyDocumentCopy/);
  assert.doesNotMatch(source, /buildDocumentDuplicationPlan|rebaseAttempts:6/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { copyOutputRequirementBlock, copyOutputRequirementCreationEvents } from "../src/model/output-requirement-copy.ts";
import { inspectOutputRequirement, parseOutputRequirement } from "../src/model/output-requirements.ts";
import { buildDocumentDuplicationPlan } from "../src/model/document-duplication.ts";
import { foldEvents } from "../src/model/events.ts";

const originalSpec = () => parseOutputRequirement({ id: "output-original", type: "Output", subtype: "Executive summary", content: "1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TikTok style videos outlining the various parts of the document." }).spec;
const block = (spec = originalSpec()) => ({ id: "output-original", type: "OUtput", properties: { text: spec.original_text, output_spec: spec, output_grant_id: "old-grant", output_acceptance_id: "old-acceptance", grant_id: "old-grant", weight: 1, intent: "include", authority: "authored" } });
const allIds = (spec) => [spec.id, ...spec.deliverables.flatMap((entry) => [entry.id, ...(entry.format_variants ?? []).map((variant) => variant.id), ...(entry.series?.members ?? []).map((member) => member.id)])];

test("copies preserve authored counts and prose while remapping every requirement identity", () => {
  const original = block(), copied = copyOutputRequirementBlock(original, "output-copy", new Map(), { preserveDocumentScope: true });
  const spec = copied.properties.output_spec;
  assert.equal(copied.type, "output");
  assert.equal(inspectOutputRequirement(spec).status, "valid");
  assert.equal(spec.original_text, original.properties.output_spec.original_text);
  assert.deepEqual(spec.deliverables.map((entry) => entry.quantity), original.properties.output_spec.deliverables.map((entry) => entry.quantity));
  assert.deepEqual(spec.deliverables[0].content_quantity, { kind: "range", unit: "slide", min: 5, max: 15 });
  assert.equal(spec.deliverables[2].series.state, "unresolved");
  assert.ok(allIds(spec).every((id) => !allIds(original.properties.output_spec).includes(id)));
  for (const key of ["output_grant_id", "output_acceptance_id", "grant_id", "weight", "intent"]) assert.equal(Object.hasOwn(copied.properties, key), false);
  assert.equal(original.properties.output_spec.id, "output-original");
});

test("copying a partial library set does not retain or silently narrow old source references", () => {
  const spec = originalSpec();
  spec.deliverables[0].source_scope = { kind: "blocks", block_ids: ["source-a", "source-b"] };
  const complete = copyOutputRequirementBlock(block(spec), "copy-complete", new Map([["source-a", "new-a"], ["source-b", "new-b"]]));
  assert.deepEqual(complete.properties.output_spec.deliverables[0].source_scope, { kind: "blocks", block_ids: ["new-a", "new-b"] });
  const partial = copyOutputRequirementBlock(block(spec), "copy-partial", new Map([["source-a", "new-a"]]));
  assert.equal(partial.properties.output_spec.deliverables[0].source_scope.kind, "unknown");
  assert.equal(partial.properties.output_spec.deliverables[1].source_scope.kind, "unknown", "a whole-Document scope must be reviewed when only a library set moved");
});

test("ordered series members keep their order and constraints while remapping source and member identities", () => {
  const spec = originalSpec(), series = spec.deliverables[2];
  series.series = { state: "resolved", description: "Agreed topics", members: [{ id: "member-original", label: "Findings", required: true, source_scope: { kind: "blocks", block_ids: ["source-a"] }, coverage: { kind: "topics", topics: ["Findings"] }, quantity: { kind: "exact", unit: "video", value: 1 }, original_text: "Findings", value_origins: {} }] };
  const copied = copyOutputRequirementBlock(block(spec), "copy-with-series", new Map([["source-a", "new-a"]]));
  const member = copied.properties.output_spec.deliverables[2].series.members[0];
  assert.notEqual(member.id, "member-original");
  assert.deepEqual(member.source_scope, { kind: "blocks", block_ids: ["new-a"] });
  assert.deepEqual(member.coverage, series.series.members[0].coverage);
});

test("unknown schema versions remain opaque and non-executable after copying", () => {
  const unknown = { schema_version: 19, id: "future-original", unknown_constraint: "preserve exactly" };
  const copied = copyOutputRequirementBlock({ id: "future-block", type: "output", properties: { text: "Future intent", output_spec: unknown, output_status: "complete" } }, "future-copy", new Map());
  assert.deepEqual(copied.properties.output_spec, unknown);
  assert.equal(inspectOutputRequirement(copied.properties.output_spec).status, "unsupported");
  assert.equal(Object.hasOwn(copied.properties, "output_status"), false);
});

test("the library creation adapter remaps only Output drafts, never source Format blocks", () => {
  const source = block();
  const events = [{ type: "BlockCreated", payload: { block_id: "copy", type: "output", properties: source.properties } }, { type: "BlockCreated", payload: { block_id: "format-copy", type: "format", properties: { text: "A4", weight: 0.5 } } }];
  const copied = copyOutputRequirementCreationEvents(events, new Map([[source.id, "copy"], ["format", "format-copy"]]));
  assert.equal(copied[0].payload.properties.output_spec.id, "copy");
  assert.deepEqual(copied[1], events[1]);
  assert.equal(events[0].payload.properties.output_spec.id, source.id);
});

test("Document duplication uses the copy contract and never carries Output fulfillment events", () => {
  const event = (sequence, type, payload) => ({ eventId: `event-${sequence}`, streamId: "creative:owner", sequence, occurredAt: "2026-08-27T12:00:00Z", recordedAt: "2026-08-27T12:00:00Z", actor: "user", clientId: "fixture", correlationId: "fixture", causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload });
  const spec = originalSpec(); spec.deliverables[0].source_scope = { kind: "blocks", block_ids: ["source-a"] };
  const history = [event(1, "ProjectCreated", { project_id: "project", name: "Copy test" }), event(2, "DocumentCreated", { project_id: "project", document_id: "original", title: "Original" }), event(3, "BlockCreated", { block_id: "source-a", document_id: "original", project_id: "project", type: "message", properties: { text: "Verified source" }, position: "a0" }), event(4, "BlockCreated", { block_id: "output-original", document_id: "original", project_id: "project", type: "output", properties: block(spec).properties, position: "a1" }), event(5, "OutputTargetAccepted", { project_id: "project", document_id: "original", acceptance_id: "old-acceptance" })];
  const projection = foldEvents(history); let id = 0;
  const duplicated = buildDocumentDuplicationPlan({ projection, sourceDocumentId: "original", title: "Copied", sourceStreamId: "creative:owner", sourceSequence: 5, createId: () => `new-${++id}` });
  const copiedBlocks = duplicated.events.filter((entry) => entry.type === "BlockCreated");
  const source = copiedBlocks.find((entry) => entry.payload.copied_from_block_id === "source-a"), output = copiedBlocks.find((entry) => entry.payload.type === "output");
  assert.equal(output.payload.properties.output_spec.id, output.payload.block_id);
  assert.deepEqual(output.payload.properties.output_spec.deliverables[0].source_scope, { kind: "blocks", block_ids: [source.payload.block_id] });
  assert.deepEqual(output.payload.properties.output_spec.deliverables[1].source_scope, { kind: "document" });
  assert.ok(duplicated.events.every((entry) => !entry.type.startsWith("Output")));
  assert.equal(Object.hasOwn(output.payload.properties, "output_grant_id"), false);
});

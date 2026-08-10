import assert from "node:assert/strict";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";
import { buildPhase7Index, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, phase7IndexStatus, retrieveFewShotExemplars } from "../src/model/indexing.ts";

const event = (sequence, type, payload, actor = "user") => ({
  eventId: `event-${sequence}`, streamId: "stream-index", sequence,
  occurredAt: `2026-08-10T12:${String(sequence).padStart(2, "0")}:00.000Z`,
  recordedAt: `2026-08-10T12:${String(sequence).padStart(2, "0")}:00.000Z`,
  actor, clientId: "test", correlationId: `corr-${sequence}`, causationId: null,
  compensatesEventId: null, schemaVersion: 1, type, payload,
});

const corpus = [
  event(1, "ProjectCreated", { project_id: "project", name: "Index study" }),
  event(2, "DocumentCreated", { document_id: "document", title: "Warm studies" }),
  event(3, "CollectionCreated", { collection_id: "collection", handle: "studio", parent_collection_id: null }),
  event(4, "CollectionItemAdded", { collection_id: "collection", item_ref: { document_id: "document" }, position: "a0" }),
  event(5, "BlockCreated", { block_id: "palette", type: "palette", handle: "palette/dusk-warm", position: "a0", properties: { colors: ["#30242d", "#eaa073"], authority: "inferred" } }),
  event(6, "ExtractionCompleted", { block_id: "palette", chips: [{ property: "colors", value: ["#30242d", "#eaa073"] }] }, "worker:extractor"),
  event(7, "ChipEdited", { block_id: "palette", property: "colors", old_value: "cool", new_value: "warm amber" }),
  event(8, "ContextCompiled", { generation_id: "g1", compiled_snapshot: { facts: ["direction/nocturne", "palette/dusk-warm"] } }, "worker:compiler"),
  event(9, "GenerationCompleted", { generation_id: "g1", model_id: "m", object_ids: ["o1"] }, "worker:generator"),
  event(10, "ObjectPinned", { object_id: "o1" }),
  event(11, "ContextCompiled", { generation_id: "g2", compiled_snapshot: { facts: ["direction/nocturne", "palette/dusk-warm"] } }, "worker:compiler"),
  event(12, "GenerationCompleted", { generation_id: "g2", model_id: "m", object_ids: ["o2"] }, "worker:generator"),
  event(13, "MutationProposed", { content_ref: "prompt-1", proposed_events: [{ type: "BlockPropertyEdited", payload: { block_id: "palette" } }] }, "model:forma-chat"),
  event(14, "ProposalAccepted", { proposal_event_id: "event-13" }),
];

test("builds a deterministic versioned index, family claims, and cited corpus", () => {
  const first = buildPhase7Index(corpus, { "prompt-1": "make the dusk palette warmer" });
  const second = buildPhase7Index(corpus, { "prompt-1": "make the dusk palette warmer" });
  assert.deepEqual(first, second);
  assert.equal(first.embeddingModelId, EMBEDDING_MODEL_ID);
  assert.ok(first.items.every((item) => item.vector.length === EMBEDDING_DIMENSIONS));
  assert.ok(first.items.every((item) => item.collectionIds.includes("collection")));
  assert.equal(first.families.length, 1);
  assert.equal(first.families[0].label, "Warm nocturnes");
  assert.deepEqual(first.families[0].members.map((member) => member.objectId).sort(), ["o1", "o2"]);
  assert.equal(first.exemplars.length, 3);
  assert.deepEqual(new Set(first.exemplars.map((item) => item.kind)), new Set(["accepted-proposal", "authored-correction", "kept-generation"]));
});

test("retrieves private accepted precedents with event citations", () => {
  const results = retrieveFewShotExemplars(corpus, "warm the palette", { "prompt-1": "make the dusk palette warmer" });
  assert.ok(results.length >= 2);
  assert.ok(results.every((item) => item.citations.length >= 2));
  assert.ok(results.some((item) => item.exemplarId === "proposal:event-13"));
});

test("corrects one inferred family edge without deleting the family", () => {
  const familyEvents = [
    ...corpus,
    event(15, "FamilyDeclared", { family_id: "family-warm", label: "Warm nocturnes", confidence: .9 }, "worker:indexer"),
    event(16, "FamilyMembershipAsserted", { family_id: "family-warm", object_id: "o1", claim_ref: "family-membership:family-warm:o1" }, "worker:indexer"),
    event(17, "FamilyMembershipAsserted", { family_id: "family-warm", object_id: "o2", claim_ref: "family-membership:family-warm:o2" }, "worker:indexer"),
    event(18, "ClaimSuperseded", { claim_ref: "family-membership:family-warm:o2", previous_event_id: "event-17", new_event_id: null }),
  ];
  const family = foldEvents(familyEvents).families.find((item) => item.family_id === "family-warm");
  assert.ok(family);
  assert.equal(family.superseded, false);
  assert.deepEqual(family.members.map((member) => member.object_id), ["o1"]);
});

test("reports embedding freshness from event-derived receipts", () => {
  const index = buildPhase7Index(corpus);
  const stale = phase7IndexStatus(corpus);
  assert.equal(stale.fresh, false);
  const receipt = event(15, "FamilyDeclared", { family_id: "family-warm", label: "Warm nocturnes", embedding_model_id: EMBEDDING_MODEL_ID, source_head: index.sourceHead }, "worker:indexer");
  const fresh = phase7IndexStatus([...corpus, receipt]);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.staleBy, 0);
});

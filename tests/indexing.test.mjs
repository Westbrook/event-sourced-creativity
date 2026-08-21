import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { foldEvents } from "../src/model/events.ts";
import { buildFewShotCorpus, buildPhase7Index, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, phase7IndexStatus, retrieveFewShotExemplars } from "../src/model/indexing.ts";

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

test("keeps accepted proposals, authored corrections, and saved generations inside their originating project", () => {
  const events = [
    event(1, "ProjectCreated", { project_id: "project-orchard", name: "Orchard" }),
    event(2, "DocumentCreated", { document_id: "document-orchard", title: "Orchard campaign" }),
    event(3, "BlockCreated", { block_id: "block-orchard", type: "palette", handle: "palette/orchard", position: "a0", properties: { text: "Warm orchard palette" } }),
    event(4, "ExtractionCompleted", { block_id: "block-orchard", chips: [{ property: "colors", value: "cool orchard" }] }, "worker:extractor"),
    event(5, "ChipEdited", { block_id: "block-orchard", property: "colors", old_value: "cool orchard palette", new_value: "warm orchard palette" }),
    event(6, "ContextCompiled", { generation_id: "generation-orchard", compiled_snapshot: { facts: [{ type: "palette", properties: { text: "Warm orchard palette" } }] } }, "worker:compiler"),
    event(7, "GenerationCompleted", { generation_id: "generation-orchard", model_id: "m", object_ids: ["object-orchard"] }, "worker:generator"),
    event(8, "ObjectSaved", { object_id: "object-orchard" }),
    event(9, "MutationProposed", { content_ref: "prompt-orchard", proposed_events: [{ type: "BlockPropertyEdited", payload: { block_id: "block-orchard" } }] }, "model:forma-chat"),
    event(10, "ProposalAccepted", { proposal_event_id: "event-9" }),
    event(11, "ProjectCreated", { project_id: "project-nocturne", name: "Nocturne" }),
    event(12, "DocumentCreated", { document_id: "document-nocturne", title: "Nocturne campaign" }),
    event(13, "BlockCreated", { block_id: "block-nocturne", type: "palette", handle: "palette/nocturne", position: "a0", properties: { text: "Warm nocturne palette" } }),
    event(14, "ExtractionCompleted", { block_id: "block-nocturne", chips: [{ property: "colors", value: "cool nocturne" }] }, "worker:extractor"),
    event(15, "ChipEdited", { block_id: "block-nocturne", property: "colors", old_value: "cool nocturne palette", new_value: "warm nocturne palette" }),
    event(16, "ContextCompiled", { generation_id: "generation-nocturne", compiled_snapshot: { facts: [{ type: "palette", properties: { text: "Warm nocturne palette" } }] } }, "worker:compiler"),
    event(17, "GenerationCompleted", { generation_id: "generation-nocturne", model_id: "m", object_ids: ["object-nocturne"] }, "worker:generator"),
    event(18, "ObjectPinned", { object_id: "object-nocturne" }),
    event(19, "MutationProposed", { content_ref: "prompt-nocturne", proposed_events: [{ type: "BlockPropertyEdited", payload: { block_id: "block-nocturne" } }] }, "model:forma-chat"),
    event(20, "ProposalAccepted", { proposal_event_id: "event-19" }),
    // A delayed correction is attributed to its owning block even after another project opened.
    event(21, "ChipEdited", { block_id: "block-orchard", property: "colors", old_value: "warm orchard palette", new_value: "warmer orchard palette" }),
  ];
  const content = { "prompt-orchard": "Warm the orchard palette", "prompt-nocturne": "Warm the nocturne palette" };

  const all = buildFewShotCorpus(events, content);
  const orchard = buildFewShotCorpus(events, content, { projectId: "project-orchard" });
  const nocturne = buildFewShotCorpus(events, content, { projectId: "project-nocturne" });

  assert.equal(all.length, 7, "unscoped account-wide callers keep their existing behavior");
  assert.equal(orchard.length, 4);
  assert.equal(nocturne.length, 3);
  assert.deepEqual(new Set(orchard.map((item) => item.kind)), new Set(["accepted-proposal", "authored-correction", "kept-generation"]));
  assert.deepEqual(new Set(nocturne.map((item) => item.kind)), new Set(["accepted-proposal", "authored-correction", "kept-generation"]));
  assert.doesNotMatch(JSON.stringify(orchard.map((item) => ({ label: item.label, summary: item.summary, citations: item.citations }))), /nocturne|event-1[4-9]|event-20/i);
  assert.doesNotMatch(JSON.stringify(nocturne.map((item) => ({ label: item.label, summary: item.summary, citations: item.citations }))), /orchard|event-[4-9]"|event-10|event-21/i);

  const orchardResults = retrieveFewShotExemplars(events, "warm palette", content, { projectId: "project-orchard", limit: 10 });
  const nocturneResults = retrieveFewShotExemplars(events, "warm palette", content, { projectId: "project-nocturne", limit: 10 });
  assert.ok(orchardResults.length >= 2);
  assert.ok(nocturneResults.length >= 2);
  assert.ok(orchardResults.every((item) => !/nocturne/i.test(`${item.label} ${item.summary}`)));
  assert.ok(nocturneResults.every((item) => !/orchard/i.test(`${item.label} ${item.summary}`)));
  assert.deepEqual(buildFewShotCorpus(events, content, { projectId: "unknown-project" }), []);
});

test("reuses each selected project projection for collection inheritance and filtered precedent retrieval", async () => {
  const events = [
    event(1, "ProjectCreated", { project_id: "project-orchard", name: "Orchard" }),
    event(2, "DocumentCreated", { document_id: "document-orchard", title: "Orchard campaign" }),
    event(3, "CollectionCreated", { collection_id: "collection-orchard", handle: "orchard", parent_collection_id: null }),
    event(4, "CollectionItemAdded", { collection_id: "collection-orchard", item_ref: { document_id: "document-orchard" }, position: "a0" }),
    event(5, "BlockCreated", { block_id: "block-orchard", type: "palette", handle: "palette/orchard", position: "a0", properties: { text: "Warm orchard palette" } }),
    event(6, "ExtractionCompleted", { block_id: "block-orchard", chips: [{ property: "colors", value: "cool orchard" }] }, "worker:extractor"),
    event(7, "ChipEdited", { block_id: "block-orchard", property: "colors", old_value: "cool orchard palette", new_value: "warm orchard palette" }),
    event(8, "ContextCompiled", { generation_id: "generation-orchard", compiled_snapshot: { facts: ["palette/orchard-warm"] } }, "worker:compiler"),
    event(9, "GenerationCompleted", { generation_id: "generation-orchard", model_id: "m", object_ids: ["object-orchard"] }, "worker:generator"),
    event(10, "ObjectPinned", { object_id: "object-orchard" }),
    event(11, "MutationProposed", { content_ref: "prompt-orchard", proposed_events: [{ type: "BlockPropertyEdited", payload: { block_id: "block-orchard" } }] }, "model:forma-chat"),
    event(12, "ProposalAccepted", { proposal_event_id: "event-11" }),
    event(13, "ProjectCreated", { project_id: "project-nocturne", name: "Nocturne" }),
    event(14, "DocumentCreated", { document_id: "document-nocturne", title: "Nocturne campaign" }),
    event(15, "CollectionCreated", { collection_id: "collection-nocturne", handle: "nocturne", parent_collection_id: null }),
    event(16, "CollectionItemAdded", { collection_id: "collection-nocturne", item_ref: { document_id: "document-nocturne" }, position: "a0" }),
    event(17, "BlockCreated", { block_id: "block-nocturne", type: "palette", handle: "palette/nocturne", position: "a0", properties: { text: "Warm nocturne palette" } }),
    event(18, "ExtractionCompleted", { block_id: "block-nocturne", chips: [{ property: "colors", value: "cool nocturne" }] }, "worker:extractor"),
    event(19, "ChipEdited", { block_id: "block-nocturne", property: "colors", old_value: "cool nocturne palette", new_value: "warm nocturne palette" }),
    event(20, "ContextCompiled", { generation_id: "generation-nocturne", compiled_snapshot: { facts: ["palette/nocturne-warm"] } }, "worker:compiler"),
    event(21, "GenerationCompleted", { generation_id: "generation-nocturne", model_id: "m", object_ids: ["object-nocturne"] }, "worker:generator"),
    event(22, "ObjectSaved", { object_id: "object-nocturne" }),
    event(23, "MutationProposed", { content_ref: "prompt-nocturne", proposed_events: [{ type: "BlockPropertyEdited", payload: { block_id: "block-nocturne" } }] }, "model:forma-chat"),
    event(24, "ProposalAccepted", { proposal_event_id: "event-23" }),
  ];
  const content = { "prompt-orchard": "Warm the orchard palette", "prompt-nocturne": "Warm the nocturne palette" };

  const orchard = buildFewShotCorpus(events, content, { projectId: "project-orchard" });
  const nocturne = buildFewShotCorpus(events, content, { projectId: "project-nocturne" });
  assert.equal(orchard.length, 3);
  assert.equal(nocturne.length, 3);
  assert.ok(orchard.every((item) => item.collectionIds.includes("collection-orchard")));
  assert.ok(nocturne.every((item) => item.collectionIds.includes("collection-nocturne")));
  assert.ok(orchard.every((item) => !item.collectionIds.includes("collection-nocturne")));

  const results = retrieveFewShotExemplars(events, "warm palette", content, { projectId: "project-orchard", collectionId: "collection-orchard", limit: 10 });
  assert.ok(results.length >= 2);
  assert.ok(results.every((item) => item.collectionIds.includes("collection-orchard")));
  assert.deepEqual(retrieveFewShotExemplars(events, "warm palette", content, { projectId: "project-orchard", collectionId: "collection-nocturne" }), []);

  const source = await readFile(new URL("../src/model/indexing.ts", import.meta.url), "utf8");
  assert.match(source, /function collectionIdsFor\(projection: CreativeProjection/);
  assert.doesNotMatch(source, /function collectionIdsFor\(events: CreativeEvent\[\]/);
});

test("the project Library searches meaningful image context and accurately describes its document-only import", async () => {
  const library = await readFile(new URL("../src/components/forma-library.ts", import.meta.url), "utf8");
  assert.match(library, /retrieveFewShotExemplars\([^\n]*projectId:projection\.projectId/);
  assert.match(library, /this\.#outputSearchText\(output\)\.includes\(query\)/);
  assert.match(library, /technique\.label,technique\.shortLabel,output\.modelId/);
  assert.match(library, /Import as document/);
  assert.match(library, /Project archive inspected/);
  assert.match(library, /Other documents, generated outputs, uploaded media, collections, relationships, and history will not be restored/);
  assert.doesNotMatch(library, /output\.id\.toLowerCase\(\)\.includes\(query\)|Lossless archive verified|>Import project</);
});

test("describes creative precedents without event names, object identifiers, or stringified facts", () => {
  const events = [
    event(1, "ProjectCreated", { project_id: "project-nocturne", name: "Night library" }),
    event(2, "DocumentCreated", { document_id: "document-nocturne", title: "The midnight librarian" }),
    event(3, "BlockCreated", { block_id: "block-subject-42", type: "subject", handle: "subject/midnight-librarian", position: "a0", properties: { text: "A librarian carrying a brass lantern" } }),
    event(4, "ExtractionCompleted", { block_id: "block-subject-42", chips: [{ property: "description", value: { text: "An unfamiliar stranger" } }] }, "worker:extractor"),
    event(5, "ChipEdited", { block_id: "block-subject-42", property: "description", old_value: { text: "An unfamiliar stranger" }, new_value: { text: "A gentle librarian carrying a brass lantern" } }),
    event(6, "ContextCompiled", {
      generation_id: "generation-nocturne-02",
      compiled_snapshot: {
        facts: [
          { block_id: "block-subject-42", type: "subject", properties: { text: "A librarian carrying a brass lantern" } },
          { block_id: "block-palette-99", type: "palette", properties: { colors: ["#30242d", "#eaa073"] } },
          { block_id: "block-unreadable-17", internal_reference: "object-secret-12" },
        ],
      },
    }, "worker:compiler"),
    event(7, "GenerationCompleted", { generation_id: "generation-nocturne-02", model_id: "m", object_ids: ["object-nocturne-02"] }, "worker:generator"),
    event(8, "ObjectSaved", { object_id: "object-nocturne-02" }),
    event(9, "MutationProposed", {
      proposed_events: [{ type: "BlockCreated", payload: { block_id: "block-lighting-13", type: "lighting", handle: "lighting/warm-shelves", properties: { text: "Warm amber light across old shelves" } } }],
    }, "model:forma-chat"),
    event(10, "ProposalAccepted", { proposal_event_id: "event-9" }),
  ];

  const index = buildPhase7Index(events);
  const proposal = index.exemplars.find((item) => item.kind === "accepted-proposal");
  const correction = index.exemplars.find((item) => item.kind === "authored-correction");
  const saved = index.exemplars.find((item) => item.kind === "kept-generation");
  const output = index.items.find((item) => item.kind === "output");

  assert.match(proposal.label, /Add lighting/i);
  assert.match(proposal.summary, /Warm amber light across old shelves/i);
  assert.equal(correction.summary, "An unfamiliar stranger → A gentle librarian carrying a brass lantern");
  assert.match(saved.label, /Saved image · Subject: A librarian carrying a brass lantern/i);
  assert.match(saved.summary, /Palette: #30242d, #eaa073/i);
  assert.match(output.label, /librarian carrying a brass lantern/i);

  for (const value of [...index.exemplars.flatMap((item) => [item.label, item.summary]), output.label]) {
    assert.doesNotMatch(value, /\[object Object\]|BlockCreated|BlockPropertyEdited|object-nocturne-02|block-subject-42|generation-nocturne-02/);
  }
});

test("uses the document title when generation context contains only internal identifiers", () => {
  const events = [
    event(1, "ProjectCreated", { project_id: "project-fallback", name: "Fallback study" }),
    event(2, "DocumentCreated", { document_id: "document-fallback", title: "The winter conservatory" }),
    event(3, "ContextCompiled", { generation_id: "generation-fallback-03", compiled_snapshot: { facts: [{ block_id: "block-secret-04" }] } }, "worker:compiler"),
    event(4, "GenerationCompleted", { generation_id: "generation-fallback-03", model_id: "m", object_ids: ["object-fallback-03"] }, "worker:generator"),
    event(5, "ObjectPinned", { object_id: "object-fallback-03" }),
  ];

  const index = buildPhase7Index(events);
  assert.equal(index.items.find((item) => item.kind === "output").label, "The winter conservatory");
  assert.equal(index.exemplars.find((item) => item.kind === "kept-generation").label, "Saved image · The winter conservatory");
  assert.match(index.exemplars.find((item) => item.kind === "kept-generation").summary, /winter conservatory/i);
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

test("isolates identical aesthetic family IDs and their members across projects", () => {
  const familyId = "family-shared";
  const events = [
    event(1, "ProjectCreated", { project_id: "project-a", name: "First creative world" }),
    event(2, "DocumentCreated", { project_id: "project-a", document_id: "document-a", title: "First study" }),
    event(3, "GenerationCompleted", { generation_id: "generation-a", document_id: "document-a", model_id: "model", object_ids: ["output-a"] }, "worker:generator"),
    event(4, "FamilyDeclared", { family_id: familyId, label: "First project family" }, "worker:indexer"),
    event(5, "FamilyAnchorSet", { family_id: familyId, object_id: "output-a" }, "worker:indexer"),
    event(6, "FamilyMembershipAsserted", { family_id: familyId, object_id: "output-a", claim_ref: `family-membership:${familyId}:output-a` }, "worker:indexer"),
    event(7, "ProjectCreated", { project_id: "project-b", name: "Second creative world" }),
    event(8, "DocumentCreated", { project_id: "project-b", document_id: "document-b", title: "Second study" }),
    event(9, "GenerationCompleted", { generation_id: "generation-b", document_id: "document-b", model_id: "model", object_ids: ["output-b"] }, "worker:generator"),
    event(10, "FamilyDeclared", { family_id: familyId, label: "Second project family" }, "worker:indexer"),
    event(11, "FamilyAnchorSet", { family_id: familyId, object_id: "output-b" }, "worker:indexer"),
    event(12, "FamilyMembershipAsserted", { family_id: familyId, object_id: "output-b", claim_ref: `family-membership:${familyId}:output-b` }, "worker:indexer"),
  ];

  const first = foldEvents(events, Number.POSITIVE_INFINITY, "document-a");
  assert.equal(first.families.length, 1);
  assert.equal(first.families[0].project_id, "project-a");
  assert.equal(first.families[0].label, "First project family");
  assert.equal(first.families[0].object_id, "output-a");
  assert.deepEqual(first.families[0].members.map((member) => member.object_id), ["output-a"]);

  const second = foldEvents(events, Number.POSITIVE_INFINITY, "document-b");
  assert.equal(second.families.length, 1);
  assert.equal(second.families[0].project_id, "project-b");
  assert.equal(second.families[0].label, "Second project family");
  assert.equal(second.families[0].object_id, "output-b");
  assert.deepEqual(second.families[0].members.map((member) => member.object_id), ["output-b"]);
});

test("keeps family members and anchors limited to visible project outputs", () => {
  const events = [
    event(1, "ProjectCreated", { project_id: "project", name: "Visible work" }),
    event(2, "DocumentCreated", { project_id: "project", document_id: "document", title: "Visible study" }),
    event(3, "GenerationCompleted", { generation_id: "generation-a", document_id: "document", model_id: "model", object_ids: ["output-a"] }, "worker:generator"),
    event(4, "GenerationCompleted", { generation_id: "generation-b", document_id: "document", model_id: "model", object_ids: ["output-b"] }, "worker:generator"),
    event(5, "FamilyDeclared", { family_id: "family", label: "Visible family" }, "worker:indexer"),
    event(6, "FamilyAnchorSet", { family_id: "family", object_id: "output-b" }, "worker:indexer"),
    event(7, "FamilyMembershipAsserted", { family_id: "family", object_id: "output-a" }, "worker:indexer"),
    event(8, "FamilyMembershipAsserted", { family_id: "family", object_id: "output-b" }, "worker:indexer"),
    event(9, "FamilyDeclared", { family_id: "pending", label: "Pending family" }, "worker:indexer"),
    event(10, "ObjectDiscarded", { object_id: "output-b" }),
  ];

  const partiallyVisible = foldEvents(events);
  const family = partiallyVisible.families.find((item) => item.family_id === "family");
  assert.ok(family);
  assert.deepEqual(family.members.map((member) => member.object_id), ["output-a"]);
  assert.equal(family.object_id, "output-a");
  assert.ok(partiallyVisible.families.some((item) => item.family_id === "pending"));

  const fullyDiscarded = foldEvents([...events, event(11, "ObjectDiscarded", { object_id: "output-a" })]);
  assert.equal(fullyDiscarded.families.some((item) => item.family_id === "family"), false);
  assert.ok(fullyDiscarded.families.some((item) => item.family_id === "pending"));
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

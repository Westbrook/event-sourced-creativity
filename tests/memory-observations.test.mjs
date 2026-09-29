import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRecord, memoryKey } from "../src/model/scoped-memory.ts";
import { eligibleMemoryObservations, memoryWorkflowPatterns, normalizeMemoryObservation, rollingMemoryConsumption } from "../src/model/memory-observations.ts";
import { memoryFixture, sourceMap } from "./helpers/scoped-memory.mjs";

function observationView(fixture, receipts, attention) {
  const observations = receipts.map((receipt) => normalizeMemoryObservation(receipt, fixture.access, fixture.graph, attention)).filter(Boolean);
  return { observations, sources: sourceMap(observations.map((observation) => observation.evidenceSource)), access: fixture.access, graph: fixture.graph, attention };
}

test("non-chat views, edits, critiques, commitments and deferred suggestions have distinct meanings", () => {
  const f = memoryFixture();
  const cases = [["DocumentOpened", "encounter"], ["ObjectViewed", "inspect"], ["ComparisonOpened", "compare"],
    ["BlockPropertyEdited", "edit"], ["ObjectSaved", "commit"], ["ObjectCritiqued", "critique"],
    ["BriefItemIgnored", "defer"], ["ProposalDeclined", "defer"], ["BlockRemoved", "remove"], ["ArtifactChangesRequested", "critique"]];
  for (const [type, action] of cases) {
    const observation = normalizeMemoryObservation(f.receipt({ type }), f.access, f.graph);
    assert.equal(observation.action, action, type);
    assert.equal(observation.humanActivity, true, type);
  }
});

test("optimistic, foreign, unresolved and mismatched receipts are rejected", () => {
  const f = memoryFixture();
  const receipt = f.receipt();
  for (const input of [
    { ...receipt, event: { ...receipt.event, eventId: "optimistic:1" } },
    { ...receipt, event: { ...receipt.event, clientId: "web:canvas-optimistic" } },
    { ...receipt, event: { ...receipt.event, actor: "user:bob" } },
    { ...receipt, event: { ...receipt.event, sequence: 2 } },
    { ...receipt, source: { ...receipt.source, actorUserId: "bob", visibility: "shared" } },
    { ...receipt, targets: [] }, { ...receipt, targets: [{ id: "x", scopeId: "missing", revision: "r1", kind: "block" }] },
  ]) assert.equal(normalizeMemoryObservation(input, f.access, f.graph), null);
  assert.ok(normalizeMemoryObservation({ ...receipt, event: { ...receipt.event, actor: "user" } }, f.access, f.graph));
});

test("polls, provider completions, model summaries and generic canvas selection do not manufacture user evidence", () => {
  const f = memoryFixture();
  for (const type of ["GenerationCompleted", "DocumentRenderCompleted", "AssistantReasoned", "TasteModelVersioned", "BriefComposed", "ScoutObserved", "CanvasInteractionRecorded"]) {
    assert.equal(normalizeMemoryObservation(f.receipt({ type }), f.access, f.graph), null, type);
  }
});

test("finalized private chat counts as human activity without copying prose or inferring a preference", () => {
  const f = memoryFixture();
  const observation = normalizeMemoryObservation(f.receipt({ type: "ChatMessageSent", payload: { content_ref: "private-text" } }), f.access, f.graph);
  assert.equal(observation.humanActivity, true);
  assert.equal(observation.independentEvidence, false);
  assert.equal(JSON.stringify(observation).includes("private-text"), false);
  assert.equal(normalizeMemoryObservation(f.receipt({ type: "ChatMessageSent", source: { visibility: "shared" } }), f.access, f.graph), null);
});

test("assisted, copied, compensated and unresolved mutations never become independent preference support", () => {
  const f = memoryFixture();
  const cases = [
    f.receipt({ type: "ProposalAccepted" }), f.receipt({ payload: { memory_authored_version: 1 } }), f.receipt({ payload: { source_surface: "assistant" } }),
    f.receipt({ payload: { source_chat_turn_id: "turn-1" } }), f.receipt({ payload: { source_surface: "autocomplete" } }),
    f.receipt({ payload: { properties: { copied_from_block_id: "original" } } }),
    f.receipt({ payload: { properties: { organization_context_source_block_id: "published-original" } } }),
    f.receipt({ type: "BlockRelationAdded", payload: { properties: { copied_from_relation_id: "original-relation" } } }),
    f.receipt({ event: { compensatesEventId: "earlier" } }), f.receipt({ lineageResolved: false }),
  ];
  for (const receipt of cases) {
    const observation = normalizeMemoryObservation(receipt, f.access, f.graph);
    assert.equal(observation.independentEvidence, false);
    const record = createMemoryRecord({ id: "derived", version: 1, scopeId: "block", kind: "episode", body: "An action occurred",
      claimKey: "event", sources: [observation.evidenceSource] }, f.access, f.graph);
    assert.equal(record.lastIndependentEvidenceAt, null);
  }
});

test("view-only histories remain consumption, never taste or independent evidence", () => {
  const f = memoryFixture();
  const view = observationView(f, [1, 2, 3, 4].map((sequence) => f.receipt({ sequence, type: "ObjectViewed", episodeId: `visit-${sequence}` })));
  assert.deepEqual(memoryWorkflowPatterns(view), []);
  assert.equal(view.observations.every((row) => !row.independentEvidence), true);
  assert.equal(rollingMemoryConsumption(view)[0].actions.inspect, 4);
  const record = f.record({ sources: view.observations.map((row) => row.evidenceSource) });
  assert.equal(record.lastIndependentEvidenceAt, null);
});

test("normalization stores no private prose or arbitrary payloads and preserves synthetic taint", () => {
  const f = memoryFixture();
  const receipt = f.receipt({ source: { synthetic: false }, payload: {
    _private_ref: "private", old_value: "PRIVATE PROSE", new_value: "PRIVATE REPLACEMENT", url: "https://private.example",
    query: "PRIVATE QUERY", pointer_path: [1, 2], origin: { synthetic: true },
  } });
  const observation = normalizeMemoryObservation(receipt, f.access, f.graph);
  assert.equal(/PRIVATE|private\.example|pointer_path/u.test(JSON.stringify(observation)), false);
  assert.equal(observation.evidenceSource.synthetic, true);
  assert.equal(f.record({ sources: [observation.evidenceSource] }).synthetic, true);
  assert.equal(normalizeMemoryObservation(receipt, { ...f.access, environment: "production" }, f.graph), null);
  for (const payload of [{ simulation: true }, { mock_data_source: "openai-provider", simulation: false }, { report_space: "scout" }]) {
    assert.equal(normalizeMemoryObservation(f.receipt({ source: { synthetic: false }, payload }), { ...f.access, environment: "production" }, f.graph), null);
  }
});

test("duplicate physical events and correlated accept/mutation outcomes are counted once", () => {
  const f = memoryFixture();
  const view = observationView(f, [f.receipt({ type: "ProposalAccepted", outcomeId: "accepted-1" }),
    f.receipt({ sequence: 2, outcomeId: "accepted-1", payload: { source_surface: "assistant" } }),
    f.receipt({ sequence: 2, outcomeId: "accepted-1", payload: { source_surface: "assistant" } })]);
  const result = rollingMemoryConsumption(view)[0];
  assert.equal(result.outcomes, 1);
  assert.deepEqual(result.actions, { accept: 1, edit: 1 });
  assert.equal(result.sourceIds.length, 2);
});

test("consumption stays bound to exact artifact revisions and resolved export kinds", () => {
  const f = memoryFixture();
  const view = observationView(f, [f.receipt({ scopeId: "artifact", type: "DocumentArtifactViewed", targets: [{ id: "deck", kind: "artifact", scopeId: "artifact", revision: "r1" }] }),
    f.receipt({ sequence: 2, scopeId: "artifact", type: "DocumentArtifactEdited", targets: [{ id: "deck", kind: "artifact", scopeId: "artifact", revision: "r2" }] }),
    f.receipt({ sequence: 3, scopeId: "project", type: "ObjectExported", targets: [{ id: "project", kind: "project", scopeId: "project", revision: "r1" }] })]);
  const result = rollingMemoryConsumption(view);
  assert.equal(result.length, 3);
  assert.equal(result.find((row) => row.target.kind === "project").actions.commit, 1);
  assert.equal(result.filter((row) => row.target.kind === "artifact").every((row) => row.outcomes === 1), true);
});

function attentionReceipt(f, sequence = 1, source = {}) {
  return f.receipt({ sequence, type: "AttentionEpisodeObserved", source, payload: {
    capture_version: "attention-v2", surface: "document", context: "document-editor", terminal_type: "page_hidden",
    started_at: "2026-09-01T14:00:00.000Z", ended_at: "2026-09-01T14:01:00.000Z", expires_at: "2026-09-15T14:01:00.000Z",
    active_ms: 30_000, idle_ms: 30_000, visible_refs: ["block"],
  } });
}
const attentionGrant = { allowed: true, expiresAt: "2026-10-01T00:00:00.000Z", forgottenThrough: {} };

test("attention defaults off and requires valid bounded co-visible timing", () => {
  const f = memoryFixture();
  const receipt = attentionReceipt(f);
  assert.equal(normalizeMemoryObservation(receipt, f.access, f.graph), null);
  const observation = normalizeMemoryObservation(receipt, f.access, f.graph, attentionGrant);
  assert.equal(observation.humanActivity, false);
  assert.equal(observation.independentEvidence, false);
  assert.equal(observation.coVisiblePageActiveMs, 30_000);
  assert.equal(Object.hasOwn(observation, "activeMs"), false);
  for (const active_ms of [-1, NaN, 60_001]) assert.equal(normalizeMemoryObservation({ ...receipt, event: { ...receipt.event, payload: { ...receipt.event.payload, active_ms } } }, f.access, f.graph, attentionGrant), null);
  const phantom = { ...receipt, event: { ...receipt.event, payload: { ...receipt.event.payload, surface: "studio", context: "studio-overview", terminal_type: "idle_timeout", terminal_ref: null, visible_refs: [], friction_score: .1, outcome_weight: .1 } } };
  assert.equal(normalizeMemoryObservation(phantom, f.access, f.graph, attentionGrant), null);
});

test("stored attention becomes unusable on expiry, current opt-out or a same-stream forget cutoff", () => {
  const f = memoryFixture();
  const view = observationView(f, [attentionReceipt(f)], attentionGrant);
  assert.equal(rollingMemoryConsumption(view)[0].coVisiblePageActiveMs, 30_000);
  assert.deepEqual(rollingMemoryConsumption({ ...view, attention: undefined }), []);
  assert.deepEqual(rollingMemoryConsumption({ ...view, access: { ...view.access, now: "2026-09-16T06:00:00.000Z" } }), []);
  assert.deepEqual(rollingMemoryConsumption({ ...view, attention: { ...attentionGrant, forgottenThrough: { "creative:alice": 1 } } }), []);
  assert.equal(rollingMemoryConsumption({ ...view, attention: { ...attentionGrant, forgottenThrough: { "unrelated-stream": 999 } } }).length, 1);
  assert.deepEqual(rollingMemoryConsumption({ ...view, attention: { ...attentionGrant, forgottenThrough: { "creative:alice": NaN } } }), []);
});

test("current source erasure and grant revocation invalidate retained consumption and pattern inputs", () => {
  const f = memoryFixture();
  const view = observationView(f, [f.receipt()]);
  const source = view.observations[0].evidenceSource;
  assert.deepEqual(eligibleMemoryObservations({ ...view, sources: new Map([[memoryKey(source.custodianId, source.id), { ...source, state: "erased" }]]) }), []);
  assert.deepEqual(rollingMemoryConsumption({ ...view, access: { ...f.access, enabled: false } }), []);
});

test("workflow patterns require independent lineage across episodes and remain descriptive", () => {
  const f = memoryFixture();
  const view = observationView(f, [1, 2, 3].map((sequence) => f.receipt({ sequence, episodeId: `session-${sequence}` })));
  const [pattern] = memoryWorkflowPatterns(view);
  assert.equal(pattern.independentOutcomes, 3);
  assert.equal(pattern.action, "edit");
  assert.equal(Object.hasOwn(pattern, "preference"), false);
  const repeated = observationView(f, [1, 2, 3].map((sequence) => f.receipt({ sequence, episodeId: `session-${sequence}`, source: { lineageId: "one-original" } })));
  assert.deepEqual(memoryWorkflowPatterns(repeated), []);
  const oneEpisode = observationView(f, [1, 2, 3].map((sequence) => f.receipt({ sequence })));
  assert.deepEqual(memoryWorkflowPatterns(oneEpisode), []);
  assert.throws(() => rollingMemoryConsumption(view, 365), /window/);
});

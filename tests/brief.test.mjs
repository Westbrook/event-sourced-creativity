import assert from "node:assert/strict";
import test from "node:test";
import { briefEligibility, composeReentryBrief, phase6GateMetrics, rejectedPathMemory, sessionContinuityDelta } from "../src/model/brief.ts";
import { foldEvents } from "../src/model/events.ts";

function event(sequence, type, payload = {}, recordedAt = new Date(Date.UTC(2026, 0, 1, 10, 0, sequence)).toISOString()) {
  return { eventId: `event-${sequence}`, streamId: "creative:test", sequence, occurredAt: recordedAt, recordedAt, actor: type === "BriefComposed" ? "worker:brief" : "user", clientId: "test", correlationId: `corr-${sequence}`, causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload };
}

const eligibleHistory = () => [
  event(1, "ProjectCreated", { project_id: "p1", name: "Pilot" }),
  event(2, "DocumentCreated", { document_id: "d1", title: "Study" }),
  event(3, "BlockCreated", { block_id: "b1", type: "direction", handle: "direction/nocturne", position: "a0", properties: { text: "Nocturne", authority: "authored" } }),
  event(4, "SessionOpened", { session_id: "s1" }), event(5, "SessionClosed", { session_id: "s1", snapshot_ref: { head: 4 } }),
  event(6, "SessionOpened", { session_id: "s2" }), event(7, "SessionClosed", { session_id: "s2", snapshot_ref: { head: 6 } }),
  event(8, "SessionOpened", { session_id: "s3" }), event(9, "SessionClosed", { session_id: "s3", snapshot_ref: { head: 8 } }),
  event(10, "SessionOpened", { session_id: "s4" }),
  event(11, "ComparisonOpened", { object_ids: ["o1", "o2"], source_surface: "studio" }),
  event(12, "BlockPropertyEdited", { block_id: "b1", property_path: "temperature", new_value: "warm" }),
];

test("Phase 6 eligibility enforces cold-start history and an unresolved thread", () => {
  const history = eligibleHistory();
  const eligibility = briefEligibility(history);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.closedSessions, 3);
  assert.equal(eligibility.unresolvedThreads, 1);
  assert.equal(briefEligibility(history.slice(0, 7)).eligible, false);
});

test("re-entry composition is deterministic, cited, bounded, and rejects recent ignored paths", () => {
  const history = eligibleHistory();
  const first = composeReentryBrief(history, "brief-1");
  assert.equal(first.eligible, true); assert.ok(first.payload);
  assert.ok(first.payload.items.length > 0 && first.payload.items.length <= 3);
  assert.ok(first.payload.items.every((item) => item.source_event_refs.length > 0 && item.authority === "inferred"));
  assert.ok(first.payload.items.every((item) => item.destination?.route && item.destination?.view && item.destination?.ref_id));
  const comparison = first.payload.items.find((item) => item.item_type === "comparison");
  assert.deepEqual(comparison?.destination, { route: "/document/d1/study", document_id: "d1", document_view: "document", view: "comparison", ref_id: "o1", object_ids: ["o1", "o2"] });
  const thread = first.payload.items.find((item) => item.item_type === "thread");
  assert.deepEqual(thread?.destination, { route: "/document/d1/study", document_id: "d1", document_view: "document", view: "context-block", ref_id: "b1" });
  assert.equal(first.payload.composition.cost_usd, 0);
  assert.deepEqual(composeReentryBrief(history, "brief-1"), first);
  const ignored = first.payload.items[0];
  const withIgnore = [...history, event(13, "BriefItemIgnored", { brief_id: "brief-1", item_id: ignored.item_id })];
  const second = composeReentryBrief(withIgnore, "brief-2");
  assert.ok(second.payload?.items.every((item) => item.item_id !== ignored.item_id));
  assert.ok(rejectedPathMemory(withIgnore).some((entry) => entry.refId === ignored.item_id && entry.active));
});

test("continuity and gate metrics derive from witnessed events", () => {
  const history = eligibleHistory();
  const brief = composeReentryBrief(history, "brief-1"); assert.ok(brief.payload);
  const metricsEvents = [
    ...history,
    event(13, "BriefComposed", brief.payload),
    event(14, "BriefItemPresented", { brief_id: "brief-1", item_id: brief.payload.items[0].item_id, rank: 1, brief_size: brief.payload.items.length, destination: brief.payload.items[0].destination, document_view: brief.payload.items[0].destination.document_view }),
    event(15, "BriefItemAccepted", { brief_id: "brief-1", item_id: brief.payload.items[0].item_id, rank: 1, brief_size: brief.payload.items.length }),
    event(16, "EmptyCanvasChosen", { brief_id: "brief-1" }),
  ];
  const metrics = phase6GateMetrics(metricsEvents);
  assert.equal(metrics.impressions, 1); assert.equal(metrics.acceptances, 1); assert.equal(metrics.acceptanceRate, 1);
  assert.equal(metrics.costPerAcceptance, 0); assert.equal(metrics.blankChoices, 1); assert.equal(metrics.dosageCurve[0].acceptanceRate, 1);
  assert.equal(metrics.viewCoverage, 1); assert.equal(metrics.viewBreakdown[0].acceptanceRate, 1);
  assert.ok(sessionContinuityDelta(history).eventCount >= 2);
});

test("re-entry reports creative changes instead of locks, probes, budgets, or unrelated lifetime view switches", () => {
  const history = [
    event(1, "DocumentViewVisited", { view: "guided" }),
    event(2, "DocumentViewVisited", { view: "chat" }),
    event(3, "SessionClosed", { snapshot_ref: { head: 3 } }),
    event(4, "CanvasLockAcquired", { canvas_id: "canvas" }),
    event(5, "BudgetReserved", { amount: 200 }),
    event(6, "DocumentViewVisited", { view: "document" }),
    event(7, "DocumentViewVisited", { view: "board" }),
    event(8, "BlockPropertyEdited", { block_id: "decision" }),
    event(9, "GenerationCompleted", { document_id: "document" }),
  ];
  const delta = sessionContinuityDelta(history);
  assert.equal(delta.eventCount, 2);
  assert.deepEqual(delta.eventTypes, ["BlockPropertyEdited", "GenerationCompleted"]);
  assert.deepEqual(delta.documentViews, ["document", "board"]);
  assert.equal(delta.viewTransitions, 1);
});

test("session projection clears a closed brief and tracks active boundaries", () => {
  const history = eligibleHistory(); const brief = composeReentryBrief(history, "brief-1"); assert.ok(brief.payload);
  const active = foldEvents([...history, event(13, "BriefComposed", brief.payload)]);
  assert.equal(active.sessionOpen, true); assert.equal(active.currentSessionId, "s4"); assert.equal(active.brief?.brief_id, "brief-1");
  const closed = foldEvents([...history, event(13, "BriefComposed", brief.payload), event(14, "SessionClosed", { session_id: "s4", snapshot_ref: { head: 13 } })]);
  assert.equal(closed.sessionOpen, false); assert.equal(closed.brief, null);
});

test("a blank-canvas document becomes current without removing earlier library work", () => {
  const projection = foldEvents([
    event(1, "ProjectCreated", { project_id: "p1", name: "Pilot" }),
    event(2, "DocumentCreated", { document_id: "d1", title: "Existing study" }),
    event(3, "BlockCreated", { document_id: "d1", block_id: "b1", type: "reference", handle: "reference/elephants", position: "a0", properties: { media_url: "/api/media/elephants" } }),
    event(4, "GenerationCompleted", { document_id: "d1", generation_id: "g1", model_id: "m1", object_ids: ["o1"] }),
    event(5, "EmptyCanvasChosen", { brief_id: "brief-1", new_document_id: "d2" }),
    event(6, "DocumentCreated", { document_id: "d2", title: "Named blank canvas", entry_surface: "blank-canvas" }),
  ]);
  assert.equal(projection.documentId, "d2");
  assert.equal(projection.documentTitle, "Named blank canvas");
  assert.deepEqual(projection.blocks, []);
  assert.deepEqual(projection.outputs, []);
  assert.deepEqual(projection.libraryBlocks.map((block) => block.id), ["b1"]);
  assert.deepEqual(projection.libraryOutputs.map((output) => output.id), ["o1"]);
});

test("document renames are replayed only for the current document", () => {
  const projection = foldEvents([
    event(1, "DocumentCreated", { document_id: "d1", title: "Initial name" }),
    event(2, "DocumentRenamed", { document_id: "d1", old_title: "Initial name", new_title: "Evening studies" }),
    event(3, "DocumentRenamed", { document_id: "another-document", old_title: "Other", new_title: "Ignored" }),
  ]);
  assert.equal(projection.documentTitle, "Evening studies");
});

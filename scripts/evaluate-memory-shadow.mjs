import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createMemoryRecord, createMemoryScopeGraph, forgetMemory, memoryDigest, memoryKey, memorySourceRef,
} from "../src/model/scoped-memory.ts";
import { memoryWorkflowPatterns, normalizeMemoryObservation, rollingMemoryConsumption } from "../src/model/memory-observations.ts";
import { createMemoryConversationSegment, memoryConversationCoverage } from "../src/model/memory-conversation.ts";
import { assembleMemoryShadow, planMemoryReview, publishMemoryReview } from "../worker/memory-shadow.ts";

// Deliberately accepts no live-input/provider/database options. A future live adapter is a separate rollout.
assert.equal(process.argv.length, 2, "This evaluator only runs its bundled synthetic fixture.");
globalThis.fetch = () => { throw new Error("Network access is forbidden in the offline memory evaluator"); };
const fixture = JSON.parse(await readFile(new URL("./fixtures/memory-shadow.json", import.meta.url), "utf8"));
assert.equal(fixture.synthetic, true);
assert.equal(fixture.schemaVersion, 1);
const scopes = fixture.scopes.map((scope) => ({ ...scope, custodianId: fixture.custodianId, version: 1 }));
const graph = createMemoryScopeGraph(scopes);
const access = {
  actorUserId: fixture.actorUserId, custodianId: fixture.custodianId, targetScopeId: "block", enabled: true,
  environment: "synthetic", now: fixture.now, enrollmentExpiresAt: "2026-10-15T00:00:00.000Z", retentionDays: 30,
  fence: { permission: 1, erasure: 1, ancestry: 1, policy: 1 },
  grants: scopes.map((scope) => ({ custodianId: scope.custodianId, scopeId: scope.id, scopeVersion: 1, canRead: true,
    purposes: ["recall", "learn"], expiresAt: "2026-10-15T00:00:00.000Z" })),
};
const sources = new Map();
const observations = [];
async function sourceFor(row, streamId, text = JSON.stringify(row)) {
  return {
    id: row.id, custodianId: access.custodianId, scopeId: row.scopeId ?? "document", scopeVersion: 1,
    streamId, sequence: row.sequence, revision: "r1", contentHash: await memoryDigest(text), actorUserId: access.actorUserId,
    visibility: "actor", speaker: row.role ?? null, state: "active", happenedAt: row.at ?? "2026-09-01T15:00:00.000Z",
    expiresAt: "2026-09-30T00:00:00.000Z", origin: row.role ?? "user", lineageId: row.outcomeId ?? row.id,
    synthetic: true, independentEvidence: row.role !== "assistant",
  };
}
function observe(row, source) {
  const observation = normalizeMemoryObservation({
    event: { eventId: source.id, streamId: source.streamId, sequence: source.sequence, occurredAt: source.happenedAt,
      recordedAt: source.happenedAt, actor: `user:${access.actorUserId}`, clientId: "synthetic-fixture", correlationId: source.id,
      causationId: null, compensatesEventId: null, schemaVersion: 1, type: row.type, payload: row.payload ?? {} },
    source, targets: [{ id: source.scopeId, scopeId: source.scopeId, revision: "r1", kind: row.kind }],
    outcomeId: row.outcomeId ?? row.id, episodeId: row.episodeId ?? "chat-session", lineageResolved: true,
  }, access, graph);
  assert.ok(observation, `Fixture observation ${row.id} must normalize`);
  observations.push(observation);
  sources.set(memoryKey(source.custodianId, source.id), observation.evidenceSource);
}
for (const row of fixture.events) observe(row, await sourceFor(row, "synthetic-actions"));
for (const row of fixture.conversation) {
  const source = await sourceFor(row, "synthetic-conversation", row.text);
  sources.set(memoryKey(source.custodianId, source.id), source);
  if (row.role === "user") observe({ ...row, type: "ChatMessageSent", kind: "document" }, source);
}
const view = { observations, sources, access, graph };
const consumption = rollingMemoryConsumption(view);
const patterns = memoryWorkflowPatterns(view);
assert.equal(patterns.length, 1);
assert.equal(patterns[0].independentOutcomes, 3);
const records = observations.map((observation) => createMemoryRecord({ id: `episode:${observation.eventId}`, version: 1,
  scopeId: observation.scopeId, kind: "episode", claimKey: `outcome:${observation.outcomeId}`,
  body: `Observed ${observation.action} on ${observation.targets[0].kind}, revision ${observation.targets[0].revision}. This is historical activity, not a preference.`,
  sources: [observation.evidenceSource],
}, access, graph));
const patternRecord = createMemoryRecord({ id: "workflow:edits", version: 1, scopeId: patterns[0].scopeId,
  kind: "workflow-pattern", claimKey: patterns[0].claimKey,
  body: `Repeated edit activity in this scope: ${patterns[0].independentOutcomes} independent outcomes across ${patterns[0].episodeCount} episodes. No aesthetic preference is inferred.`,
  sources: patterns[0].sourceIds.map((id) => sources.get(memoryKey(access.custodianId, id))),
}, access, graph);
records.push(patternRecord);
assert.ok(records.every(Boolean));

const conversationAccess = { ...access, targetScopeId: "document" };
const inventory = { conversationId: "synthetic-conversation", scopeId: "document", completeFromStart: true,
  turns: fixture.conversation.map((row) => ({ turnId: row.turnId, conversationId: "synthetic-conversation", role: row.role,
    status: "final", text: row.text, source: memorySourceRef(sources.get(memoryKey(access.custodianId, row.id))) })) };
const segment = await createMemoryConversationSegment({ id: "summary:prefix", version: 1,
  inventory: { ...inventory, turns: inventory.turns.slice(0, 2) } }, sources, conversationAccess, graph);
assert.ok(segment);
records.push(segment.record);
const coverage = await memoryConversationCoverage({ inventory, segments: [segment], recentLimit: 2 }, sources, conversationAccess, graph);
assert.equal(coverage.continuous, true);

const through = new Map();
for (const source of sources.values()) through.set(source.streamId, Math.max(through.get(source.streamId) ?? 0, source.sequence));
const reviewInventory = { complete: true, from: {}, through: Object.fromEntries(through), observationSources: observations.map((observation) => observation.source) };
const decision = await planMemoryReview({ mode: "shadow", observations, sources, access, graph, processed: {},
  inventory: reviewInventory, recipeVersion: "offline-memory-v1", timeZone: fixture.timeZone });
assert.equal(decision.status, "planned");
const publication = await publishMemoryReview({ plan: decision.plan, processed: {}, successful: true, records, sources, access, graph });
assert.equal(publication.published, true);
const idle = await planMemoryReview({ mode: "shadow", observations, sources, access, graph, processed: publication.processed,
  inventory: { ...reviewInventory, from: publication.processed, observationSources: [] }, recipeVersion: "offline-memory-v1", timeZone: fixture.timeZone });
assert.equal(idle.status, "no-activity");

const context = { decisionAtoms: [{ text: "Keep the exact approved title.", protected: true }], capabilities: ["read"], recentTurns: [] };
const before = JSON.stringify(context);
const shadow = assembleMemoryShadow({ mode: "shadow", context, query: "edit chart", records, sources, access, graph });
assert.equal(shadow.status, "shadow");
assert.equal(JSON.stringify(shadow.context), before);
const forgotten = forgetMemory(patternRecord);
const afterForget = assembleMemoryShadow({ mode: "shadow", context, query: "edit chart", records, sources, access, graph, suppressions: [forgotten.suppression] });
assert.equal(afterForget.references.some((reference) => reference.sourceIds.some((id) => patterns[0].sourceIds.includes(id))), false);

process.stdout.write(JSON.stringify({
  schemaVersion: 1, mode: "offline-synthetic-shadow", fixtureTime: fixture.now,
  defaultActivation: "off", productionActivationImplemented: false, currentContextUnchanged: JSON.stringify(context) === before,
  normalizedInteractions: { total: observations.length, privateChat: observations.filter((row) => row.eventType === "ChatMessageSent").length,
    nonChat: observations.filter((row) => row.eventType !== "ChatMessageSent").length },
  consumption: consumption.map((row) => ({ kind: row.target.kind, revision: row.target.revision, episodes: row.episodes, outcomes: row.outcomes, actions: row.actions })),
  descriptiveWorkflowPatterns: patterns.map(({ action, independentOutcomes, episodeCount }) => ({ action, independentOutcomes, episodeCount })),
  conversation: { method: segment.method, summarizedTurns: coverage.summarizedTurnIds.length, recentTurns: coverage.recentTurnIds.length,
    omittedTurns: coverage.omittedTurnIds.length, continuous: coverage.continuous },
  review: { id: decision.plan.id, admission: decision.status, publicationGuardPassed: publication.published,
    capturedCutoff: publication.processed, replayAdmission: idle.status, persisted: false },
  recall: { method: shadow.retrieval, selected: shadow.references.length, serializedBytes: shadow.bytes, maxBytes: 16_384,
    forgottenLineagesExcluded: true },
  providerCalls: 0, databaseWrites: 0,
  limitations: ["No live event ingestion or durable memory storage", "No deployed scheduler, queue or vector index",
    "Extractive summary and lexical recall are baselines, not evaluated semantic models", "No serving-path or UI integration"],
}, null, 2) + "\n");

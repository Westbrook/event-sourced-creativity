import { createHash } from "node:crypto";
import { createMemoryRecord, createMemoryScopeGraph, memoryKey } from "../../src/model/scoped-memory.ts";

export const hashMemoryText = (text) => createHash("sha256").update(text).digest("hex");
export const sourceMap = (...sources) => new Map(sources.flat().map((source) => [memoryKey(source.custodianId, source.id), source]));

/** Synthetic, non-sensitive fixtures only. No environment, database or provider access. */
export function memoryFixture(options = {}) {
  const scopeRows = [
    ["organization", "organization", null], ["project", "project", "organization"],
    ["nested-project", "project", "project"], ["document", "document", "nested-project"],
    ["block", "block", "document"], ["sibling-block", "block", "document"],
    ["artifact", "artifact", "document"], ["section", "section", "artifact"],
    ["other-document", "document", "nested-project"], ["other-block", "block", "other-document"],
    ["outer-document", "document", "project"], ["canvas", "canvas", "nested-project"],
  ];
  const scopes = scopeRows.map(([id, kind, parentId]) => ({ id, kind, parentId, custodianId: "org:alpha", version: 1 }));
  scopes.push({ id: "organization", kind: "organization", parentId: null, custodianId: "org:beta", version: 1 },
    { id: "document", kind: "document", parentId: "organization", custodianId: "org:beta", version: 1 });
  const graph = createMemoryScopeGraph(scopes);
  const access = {
    actorUserId: "alice", custodianId: "org:alpha", targetScopeId: "block", enabled: true,
    environment: "synthetic", now: "2026-09-02T06:00:00.000Z", enrollmentExpiresAt: "2026-11-01T00:00:00.000Z",
    retentionDays: 30, fence: { permission: 1, erasure: 1, ancestry: 1, policy: 1 },
    grants: scopes.filter((scope) => scope.custodianId === "org:alpha").map((scope) => ({
      custodianId: scope.custodianId, scopeId: scope.id, scopeVersion: scope.version, canRead: true,
      purposes: ["recall", "learn"], expiresAt: "2026-10-15T00:00:00.000Z",
    })), ...options,
  };
  const source = (overrides = {}) => ({
    id: "event-1", custodianId: "org:alpha", scopeId: "block", scopeVersion: 1,
    streamId: "creative:alice", sequence: 1, revision: "r1", contentHash: hashMemoryText("Synthetic context"),
    actorUserId: "alice", visibility: "actor", speaker: null, state: "active", happenedAt: "2026-09-01T14:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z", origin: "user", lineageId: overrides.id ?? "event-1",
    synthetic: true, independentEvidence: true, ...overrides,
  });
  const record = (overrides = {}) => createMemoryRecord({ id: "memory-1", version: 1, scopeId: "block",
    kind: "episode", body: "Synthetic historical evidence", claimKey: "synthetic-claim", sources: [source()], ...overrides }, access, graph);
  const receipt = (overrides = {}) => {
    const sequence = overrides.sequence ?? 1;
    const scopeId = overrides.scopeId ?? "block";
    const evidence = source({ id: `event-${sequence}`, sequence, scopeId, speaker: overrides.type === "ChatMessageSent" ? "user" : null, ...overrides.source });
    return {
      source: evidence, event: { eventId: evidence.id, streamId: evidence.streamId, sequence: evidence.sequence,
        occurredAt: evidence.happenedAt, recordedAt: evidence.happenedAt, actor: "user:alice", clientId: "web:test",
        correlationId: `correlation-${sequence}`, causationId: null, compensatesEventId: null, schemaVersion: 1,
        type: overrides.type ?? "BlockPropertyEdited", payload: overrides.payload ?? { block_id: scopeId }, ...overrides.event },
      targets: overrides.targets ?? [{ id: scopeId, scopeId, revision: "r1", kind: "block" }],
      outcomeId: overrides.outcomeId ?? `outcome-${sequence}`, episodeId: overrides.episodeId ?? "session-1",
      lineageResolved: overrides.lineageResolved ?? true,
    };
  };
  return { scopes, graph, access, source, record, receipt };
}

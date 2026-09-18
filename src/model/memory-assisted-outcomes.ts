import { memoryTimestamp } from "./memory-lifetime.ts";

export const MEMORY_ASSISTED_OUTCOMES_VERSION = "native-assisted-outcomes-v1";
export const MEMORY_ASSISTED_OUTCOMES_MAX_BYTES = 16_384;
export type MemoryAssistedOutcomeSource = {
  eventId: string; type: string; blockId: string | null; recordedAt: string; validUntil: string;
};
export type MemoryAssistedOutcome = {
  proposalId: string; turnId: string; status: "accepted" | "rejected";
  actionKind: "context.create" | "context.edit" | "context.remove" | "context.relation.add" | "context.relation.remove";
  origin: "assistant-assisted"; independentEvidence: false;
  decision: { sourceIndex: number };
  mutation: { sourceIndex: number; type: string; blockIds: string[]; relationId: string | null } | null;
  recordedAt: string;
};
export type MemoryAssistedOutcomes = {
  version: typeof MEMORY_ASSISTED_OUTCOMES_VERSION; treatment: "descriptive-assisted-decisions";
  exposure: "not-measured"; inferredPreferences: false;
  coverage: { selectedSourceCount: number; selectedDecisionCount: number; certifiedOutcomeCount: number;
    completeHistory: false; bounded: true; freeAssistantOnly: true };
  outcomes: MemoryAssistedOutcome[];
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240
  && value.trim() === value && value.isWellFormed();
const index = (value: unknown, length: number): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < length;
const dense = (value: readonly unknown[]) => Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index));
const kinds = { "context.create": "BlockCreated", "context.edit": "BlockPropertyEdited", "context.remove": "BlockRemoved",
  "context.relation.add": "BlockRelationAdded", "context.relation.remove": "BlockRelationRemoved" } as const;

/** Structural/cross-reference validation, not a second authority system. Every
 * index belongs to the enclosing certified recall window and its single lease.
 * A malformed optional field must reject that field, never become trusted counts. */
export function parseMemoryAssistedOutcomes(value: unknown, sources: readonly MemoryAssistedOutcomeSource[],
  lifetime: { checkedAt: string; validUntil: string }): MemoryAssistedOutcomes | null {
  try {
    if (!object(value) || !exact(value, ["version", "treatment", "exposure", "inferredPreferences", "coverage", "outcomes"])
      || value.version !== MEMORY_ASSISTED_OUTCOMES_VERSION || value.treatment !== "descriptive-assisted-decisions"
      || value.exposure !== "not-measured" || value.inferredPreferences !== false
      || new TextEncoder().encode(JSON.stringify(value)).byteLength > MEMORY_ASSISTED_OUTCOMES_MAX_BYTES) return null;
    const checked = memoryTimestamp(lifetime?.checkedAt), until = memoryTimestamp(lifetime?.validUntil);
    if (checked === null || until === null || until <= checked || until - checked > 60_000
      || !Array.isArray(sources) || sources.length > 64 || !dense(sources)
      || new Set(sources.map(source => source.eventId)).size !== sources.length
      || sources.some(source => !id(source.eventId) || !id(source.type) || source.blockId !== null && !id(source.blockId)
        || memoryTimestamp(source.recordedAt) === null || memoryTimestamp(source.recordedAt)! > checked
        || memoryTimestamp(source.validUntil) === null || memoryTimestamp(source.validUntil)! < until)) return null;
    const coverage = value.coverage;
    if (!object(coverage) || !exact(coverage, ["selectedSourceCount", "selectedDecisionCount", "certifiedOutcomeCount", "completeHistory", "bounded", "freeAssistantOnly"])
      || coverage.selectedSourceCount !== sources.length || coverage.selectedDecisionCount !== sources.filter(source => ["ProposalAccepted", "ProposalRejected"].includes(source.type)).length
      || coverage.completeHistory !== false || coverage.bounded !== true || coverage.freeAssistantOnly !== true
      || !Array.isArray(value.outcomes) || value.outcomes.length > 64 || coverage.certifiedOutcomeCount !== value.outcomes.length) return null;
    const proposals = new Set<string>(), references = new Set<number>(), outcomes: MemoryAssistedOutcome[] = [];
    for (const item of value.outcomes) {
      if (!object(item) || !exact(item, ["proposalId", "turnId", "status", "actionKind", "origin", "independentEvidence", "decision", "mutation", "recordedAt"])
        || !id(item.proposalId) || proposals.has(item.proposalId) || !id(item.turnId) || typeof item.status !== "string" || !["accepted", "rejected"].includes(item.status)
        || typeof item.actionKind !== "string" || !Object.hasOwn(kinds, item.actionKind) || item.origin !== "assistant-assisted" || item.independentEvidence !== false
        || !object(item.decision) || !exact(item.decision, ["sourceIndex"]) || !index(item.decision.sourceIndex, sources.length)
        || references.has(item.decision.sourceIndex)) return null;
      const decisionIndex = item.decision.sourceIndex, decision = sources[decisionIndex];
      if (decision.type !== (item.status === "accepted" ? "ProposalAccepted" : "ProposalRejected") || item.recordedAt !== decision.recordedAt) return null;
      proposals.add(item.proposalId); references.add(decisionIndex);
      let mutation: MemoryAssistedOutcome["mutation"] = null;
      if (item.status === "accepted") {
        const change = item.mutation;
        if (!object(change) || !exact(change, ["sourceIndex", "type", "blockIds", "relationId"]) || !index(change.sourceIndex, sources.length)
          || references.has(change.sourceIndex) || change.type !== kinds[item.actionKind as keyof typeof kinds]
          || sources[change.sourceIndex].type !== change.type || memoryTimestamp(sources[change.sourceIndex].recordedAt)! < memoryTimestamp(decision.recordedAt)!
          || !Array.isArray(change.blockIds) || !dense(change.blockIds)
          || change.blockIds.some(block => !id(block)) || new Set(change.blockIds).size !== change.blockIds.length) return null;
        const relation = item.actionKind.startsWith("context.relation.");
        if (relation ? change.blockIds.length !== 2 || !id(change.relationId) || sources[change.sourceIndex].blockId !== null
          : change.blockIds.length !== 1 || change.relationId !== null || sources[change.sourceIndex].blockId !== change.blockIds[0]) return null;
        references.add(change.sourceIndex);
        mutation = { sourceIndex: change.sourceIndex, type: change.type as string, blockIds: [...change.blockIds] as string[], relationId: change.relationId as string | null };
      } else if (item.mutation !== null) return null;
      outcomes.push({ proposalId: item.proposalId, turnId: item.turnId, status: item.status as "accepted" | "rejected",
        actionKind: item.actionKind as MemoryAssistedOutcome["actionKind"], origin: "assistant-assisted", independentEvidence: false,
        decision: { sourceIndex: decisionIndex }, mutation,
        recordedAt: item.recordedAt as string });
    }
    return { version: MEMORY_ASSISTED_OUTCOMES_VERSION, treatment: "descriptive-assisted-decisions", exposure: "not-measured", inferredPreferences: false,
      coverage: { selectedSourceCount: sources.length, selectedDecisionCount: Number(coverage.selectedDecisionCount), certifiedOutcomeCount: outcomes.length,
        completeHistory: false, bounded: true, freeAssistantOnly: true }, outcomes };
  } catch { return null; }
}

import { createMemoryRecord, memoryDigest, memoryKey, memoryRecordEligible, memorySourceRef, type MemoryRecord } from "../src/model/scoped-memory.ts";
import { createMemoryConversationSegment, memoryConversationExcerptBytes, type MemoryConversationSegment } from "../src/model/memory-conversation.ts";
import { memoryWorkflowPatterns } from "../src/model/memory-observations.ts";
import type { MemoryReviewPlan } from "./memory-shadow.ts";
import { MEMORY_REVIEW_RECORD_LIMIT, type MemoryShadowStore, type MemoryStoreCapture } from "./memory-store.ts";
import { memoryAssert, memoryCanonical } from "./memory-sql.ts";

export const MEMORY_REVIEW_RECIPE = "extractive-interactions-v1";
export type MemoryReviewOutput = { records: MemoryRecord[]; segments: MemoryConversationSegment[] };
export type MemoryReviewDeriver = (input: { store: MemoryShadowStore; capture: MemoryStoreCapture; plan: MemoryReviewPlan }) => Promise<MemoryReviewOutput>;

/**
 * Provider-free recurrent baseline. Delta episodes and content-addressed pattern/
 * summary snapshots are immutable; unchanged support never creates a new version.
 * These historical snapshots are not a semantic personal-profile model.
 */
export const deriveMemoryReview: MemoryReviewDeriver = async ({ store,capture,plan }) => {
  memoryAssert(plan.recipeVersion === MEMORY_REVIEW_RECIPE,"unsupported-memory-review-recipe");
  const evidence = store.evidence(capture), previous = store.derivationState(capture);
  const known = new Set(previous.records.map((record) => record.id)), records: MemoryRecord[] = [], segments: MemoryConversationSegment[] = [];
  const eligible = (record: MemoryRecord | null): record is MemoryRecord => Boolean(record && !known.has(record.id)
    && memoryRecordEligible(record,evidence.sources,evidence.access,evidence.graph,previous.suppressions,"learn"));
  for (const observation of evidence.observations.filter((row) => row.sequence > (plan.from[row.streamId] ?? 0))) {
    const source = evidence.sources.get(memoryKey(observation.custodianId,observation.source.id))!;
    const id = `episode:${await memoryDigest(memoryCanonical(observation.source))}`;
    const record = createMemoryRecord({ id,version:1,scopeId:observation.scopeId,kind:"episode",claimKey:`outcome:${observation.outcomeId}`,
      body:`Observed ${observation.action} on ${observation.targets[0].kind}; historical activity, not a preference.`,sources:[source] },evidence.access,evidence.graph);
    if (eligible(record)) records.push(record);
  }
  for (const pattern of memoryWorkflowPatterns(evidence)) {
    const sources = [...pattern.sourceIds].sort().map((id) => evidence.sources.get(memoryKey(evidence.access.custodianId,id))!);
    const id = `workflow:${await memoryDigest(memoryCanonical({ scope:pattern.scopeId,action:pattern.action,sources:sources.map(memorySourceRef) }))}`;
    const record = createMemoryRecord({ id,version:1,scopeId:pattern.scopeId,kind:"workflow-pattern",claimKey:pattern.claimKey,
      body:`Repeated ${pattern.action} activity: ${pattern.independentOutcomes} independent outcomes across ${pattern.episodeCount} episodes.`,sources },evidence.access,evidence.graph);
    if (eligible(record)) records.push(record);
  }
  for (const inventory of evidence.conversations) {
    // Stable turn/UTF-8-bounded chunks leave room for the rolling raw tail.
    // Never skip missing turns or pretend a partial transcript begins at origin.
    const prefix = inventory.turns.slice(0,Math.max(0,inventory.turns.length - 2));
    for (let start=0; start<prefix.length;) {
      let end=Math.min(start+16,prefix.length);
      while(end>start && memoryConversationExcerptBytes(prefix.slice(start,end))>8_192)end--;
      memoryAssert(end>start,"memory-summary-byte-limit");
      const turns=prefix.slice(start,end);start=end;
      const id = `summary:${await memoryDigest(memoryCanonical({ conversation:inventory.conversationId,sources:turns.map((turn) => turn.source) }))}`;
      if (known.has(id)) continue;
      const segment = await createMemoryConversationSegment({ id,version:1,inventory:{ ...inventory,turns } },evidence.sources,evidence.access,evidence.graph);
      memoryAssert(segment,"incomplete-memory-summary-derivation");
      if (eligible(segment!.record)) { records.push(segment!.record);segments.push(segment!); }
    }
  }
  memoryAssert(records.length <= MEMORY_REVIEW_RECORD_LIMIT && segments.length <= 32,"memory-review-output-limit");
  return { records,segments };
};

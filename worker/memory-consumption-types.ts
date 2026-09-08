import type { NativeMemoryOutcomeSource, NativeMemoryOutcomes, nativeMemoryOutcomesQuery } from "./memory-native-outcomes.ts";
import type { NativeMemorySavedOutputSource, nativeMemorySavedOutputsValue } from "./memory-native-saved-outputs.ts";

/** Reuse the accepted source and enrollment identities; no new authority is minted. */
export type ConsumptionSource = NativeMemoryOutcomeSource & NativeMemorySavedOutputSource;
export type ConsumptionSourceRef = Pick<ConsumptionSource, "eventId" | "sequence">;
export type ConsumptionAuthority = Pick<Parameters<typeof nativeMemoryOutcomesQuery>[0],
  "enrollment_id" | "actor_user_id" | "owner_user_id" | "organization_id" | "project_access_id"
  | "project_id" | "document_id" | "permission_epoch" | "revision" | "cursor_sequence">;
export type ConsumptionKind = "visit" | "inspection" | "reuse";

/**
 * An actual-record adapter must certify this witness. A source type, proximity,
 * save/pin/export or assistant decision does not create a visit/inspection/reuse.
 */
export interface ConsumptionObservation {
  source: ConsumptionSourceRef;
  authority: ConsumptionAuthority;
  kind: ConsumptionKind;
  episodeId: string | null;
  /** Immutable content revision witnessed at this event, never enrollment/settings revision. */
  resourceRevision: string | null;
  copiedFrom: { source: ConsumptionSourceRef; revision: string | null } | null;
}
export interface ConsumptionCompensation {
  source: ConsumptionSourceRef;
  authority: ConsumptionAuthority;
  /** null preserves missing undo lineage; only a direct observation can be undone. */
  target: ConsumptionSourceRef | null;
}
export interface ConsumptionProvenance {
  /** Exact original selection used by the existing helpers, before any reordering. */
  selection: readonly ConsumptionSource[];
  outcomes: NativeMemoryOutcomes | null;
  savedOutputs: NonNullable<ReturnType<typeof nativeMemorySavedOutputsValue>> | null;
}
export interface ConsumptionInput {
  authority: ConsumptionAuthority;
  checkedAt: string;
  validUntil: string;
  sources: readonly ConsumptionSource[];
  observations: readonly ConsumptionObservation[];
  compensations: readonly ConsumptionCompensation[];
  withdrawnSources: readonly ConsumptionSourceRef[];
  provenance: ConsumptionProvenance | null;
}
export type ConsumptionOrigin = "assistant-assisted" | "native-generated-output" | "copy" | "unknown";
export interface ConsumptionEpisode {
  episodeId: string | null;
  documentId: string;
  blockId: string | null;
  resourceRevision: string | null;
  observations: Array<{
    sourceIndex: number;
    kind: ConsumptionKind;
    copiedFrom: { sourceIndex: number; revision: string | null } | null;
  }>;
  origins: ConsumptionOrigin[];
  provenanceSourceIndexes: number[];
  firstRecordedAt: string;
  lastRecordedAt: string;
  validUntil: string;
  independentEvidence: false;
}
export interface ConsumptionProjection {
  version: "memory-consumption-episodes-v1";
  treatment: "descriptive-consumption";
  validUntil: string;
  episodes: ConsumptionEpisode[];
  coverage: {
    eligibleSourceCount: number;
    observationCount: number;
    compensatedObservationCount: number;
    unresolvedCompensationCount: number;
    incompleteLineageCount: number;
    completeHistory: false;
    bounded: true;
  };
  attention: "not-measured";
  comprehension: "not-measured";
  inferredPreferences: false;
}

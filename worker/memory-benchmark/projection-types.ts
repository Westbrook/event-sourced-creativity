/** Demand-only simulation contracts. No provider, identity, billing or content adapter. */
export const PROJECTION_STAGES = [
  "backfill_embedding", "changed_embedding", "night_review", "conversation_summary", "profile_update", "recall_increment",
] as const;
export type ProjectionStage = typeof PROJECTION_STAGES[number];
export interface ProjectionSource {
  versionId: string;
  createdDay: number;
  invalidatedDay: number | null;
  invalidationReason: "superseded" | "withdrawn" | null;
}
export interface ProjectionJob {
  id: string;
  day: number;
  stage: ProjectionStage;
  units: number;
  sourceVersions: readonly string[];
  /** Inclusive deadline: no admission at or after this day. */
  expiresDay: number | null;
}
export interface DemandTrace {
  version: string;
  workload: "light" | "typical" | "heavy" | "test";
  /** This authored trace covers an actual 30-day UTC calendar month, without rollover. */
  period: "2026-09";
  activeDays: readonly boolean[];
  sources: readonly ProjectionSource[];
  jobs: readonly ProjectionJob[];
}
export interface StageEstimate {
  assumptionId: string;
  basis: "hypothetical";
  expectedMicroUsdPerUnit: number;
  maximumMicroUsdPerUnit: number;
}
/** null is missing evidence, never a zero-dollar estimate. */
export type StageEstimates = Record<ProjectionStage, StageEstimate | null>;
export interface ProjectionOptions {
  monthlyCapMicroUsd: number;
  /** Assumed remaining allowance after all stricter constraints, not native authorization. */
  availableAiMicroUsd: number;
  backfill: "include" | "exclude";
  infrastructureEstimateMicroUsd: number | null;
}
export type JobDisposition = "modeled_complete" | "deferred" | "skipped_recall" | "ineligible" | "unmodeled" | "excluded_backfill";
export interface ProjectedJob {
  id: string;
  stage: ProjectionStage;
  units: number;
  day: number;
  disposition: JobDisposition;
  completedDay: number | null;
  spentMicroUsd: number;
  eligibleAtEnd: boolean;
  ineligibleReason: "superseded" | "withdrawn" | "expired" | null;
}
export interface StageProjection {
  demandJobs: number;
  demandUnits: number;
  hypotheticalDemandMicroUsd: number | null;
  spentMicroUsd: number;
  completedJobs: number;
  completedUnits: number;
  deferredJobs: number;
  deferredUnits: number;
  skippedRecallJobs: number;
  ineligibleJobs: number;
  unmodeledJobs: number;
  excludedBackfillJobs: number;
}

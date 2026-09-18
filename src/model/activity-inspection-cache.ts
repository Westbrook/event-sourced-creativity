import type { GenerationInputInspection } from "./generation-inputs.ts";
import type { DocumentJob } from "./document-jobs.ts";

type InspectionJobIdentity = Pick<DocumentJob, "jobId" | "documentId" | "attemptCount" | "status" | "kind" | "productionMode">;

/** Same frozen attempt, not object identity or authorization. Existing caller/child scope checks remain authoritative. */
export function sameActivityInspectionJob(current: InspectionJobIdentity | null, inspected: InspectionJobIdentity) {
  return current !== null && current.jobId === inspected.jobId && current.documentId === inspected.documentId
    && current.attemptCount === inspected.attemptCount && current.status === inspected.status
    && current.kind === inspected.kind && current.productionMode === inspected.productionMode;
}

/**
 * One active Activity caller's app-produced inspection, never a global cache.
 * Reuse the exact object only while its complete rendered JSON is unchanged.
 * The serialized value contains private receipt data: clear at every real
 * opening/closing, job replacement, authorization retirement and disconnect.
 * This is not an authority token; the dialog's strict identity guard is unchanged.
 */
export function createActivityInspectionCache() {
  let selected: GenerationInputInspection | null = null;
  let serialized: string | null = null;
  const clear = () => { selected = null; serialized = null; };
  return {
    clear,
    select(candidate: GenerationInputInspection | null): GenerationInputInspection | null {
      if (candidate === null) { clear(); return null; }
      let next: string;
      try {
        const value = JSON.stringify(candidate);
        if (typeof value !== "string") { clear(); return candidate; }
        next = value;
      }
      catch { clear(); return candidate; } // Never reuse on an unrepresentable inspection.
      if (selected !== null && serialized === next) return selected;
      selected = candidate; serialized = next;
      return selected;
    },
  };
}

import type { DocumentArtifact } from "./document-artifacts";
import type { CreativeEvent } from "./events";

export type CreatorProductionSummary = {
  mode: "managed" | "manual";
  teamLabel: string | null;
  specialists: string[];
  itemCount: number;
  estimatedMicrousd: number | null;
  reservedMicrousd: number | null;
  actualMicrousd: number | null;
  evidenceBasis: string | null;
  measuredWeight: number | null;
  fullyEvaluated: boolean;
  mediaInspected: boolean;
  delivery: "scene-reel" | "single-video" | "artifact";
  audioMode: "silent" | "original_ambient" | null;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finiteAmount = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** A creator-safe projection from existing owner-bound artifact and cost receipts. */
export function creatorProductionSummary(artifact: DocumentArtifact, events: readonly CreativeEvent[]): CreatorProductionSummary {
  const related = events.filter((event) => String(event.payload.artifact_id ?? "") === artifact.id);
  const requested = related.find((event) => event.type === "DocumentRenderRequested");
  const usage = related.filter((event) => event.type === "GenerationUsageRecorded");
  const reservation = related.find((event) => event.type === "BudgetReserved");
  const team = record(artifact.settings.production_team);
  const evidence = record(artifact.settings.production_evidence);
  const specialists = Array.isArray(team.specialists)
    ? team.specialists.flatMap((member) => {
      const label = record(member).label;
      return typeof label === "string" && label.trim() ? [label.trim()] : [];
    })
    : [];
  const audio = artifact.settings.video_audio_mode;

  return {
    mode: artifact.settings.production_mode === "managed" ? "managed" : "manual",
    teamLabel: typeof team.label === "string" && team.label.trim() ? team.label.trim() : null,
    specialists,
    itemCount: artifact.itemCount,
    estimatedMicrousd: finiteAmount(requested?.payload.estimated_cost_microusd),
    reservedMicrousd: finiteAmount(reservation?.payload.reserved_microusd ?? usage[0]?.payload.reserved_microusd),
    actualMicrousd: usage.length ? usage.reduce((total, event) => total + (finiteAmount(event.payload.cost_microusd) ?? 0), 0) : null,
    evidenceBasis: typeof evidence.basis === "string" ? evidence.basis : null,
    measuredWeight: typeof evidence.measured_weight === "number" && Number.isFinite(evidence.measured_weight) ? Math.max(0, Math.min(1, evidence.measured_weight)) : null,
    fullyEvaluated: evidence.fully_evaluated === true,
    mediaInspected: evidence.media_inspected === true,
    delivery: artifact.kind === "video" ? artifact.itemCount > 1 ? "scene-reel" : "single-video" : "artifact",
    audioMode: audio === "silent" || audio === "original_ambient" ? audio : null,
  };
}

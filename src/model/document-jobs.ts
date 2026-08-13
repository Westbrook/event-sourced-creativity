export const DOCUMENT_JOB_KINDS = ["preview", "generate", "prompt_fan", "chat", "structure_adaptive", "extract_reference"] as const;
export type DocumentJobKind = typeof DOCUMENT_JOB_KINDS[number];
export type DocumentJobStatus = "queued" | "running" | "completed" | "partial" | "failed";
export type ProviderFailureCategory = "safety" | "authentication" | "access" | "quota" | "rate_limit" | "network" | "canceled" | "provider" | "server" | "unknown";
export type DocumentJobError = { code: string; category: ProviderFailureCategory; message: string; retryable: boolean; requestId: string | null; httpStatus: number | null };
export type PromptFanMember = { jobId: string; promptTechnique: "prose" | "bullets" | "json" | "xml"; status: Exclude<DocumentJobStatus, "partial">; error: DocumentJobError | null; attemptCount: number; updatedAt: string };

export type DocumentJob = {
  jobId: string;
  documentId: string;
  kind: DocumentJobKind;
  status: DocumentJobStatus;
  sourceSurface: string;
  requestedSequence: number;
  documentRevision: string;
  requestKey: string;
  sourcePreviewId: string | null;
  promptTechnique: "prose" | "bullets" | "json" | "xml";
  promptFanId: string | null;
  parentJobId: string | null;
  fanKind: "preview" | "generate" | null;
  members: PromptFanMember[];
  result: Record<string, unknown> | null;
  error: string | null;
  errorDetail: DocumentJobError | null;
  attemptCount: number;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  notifiedAt: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
  stage: string;
  progressMessage: string;
};

function stableGenerationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableGenerationValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableGenerationValue(item)]));
}

/** A compact, deterministic identity for the exact context sent to image generation. */
export function documentGenerationRevision(value: unknown) {
  const source = JSON.stringify(stableGenerationValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `rev-${(hash >>> 0).toString(36)}`;
}

export function documentGenerationRequestKey(kind: "preview" | "generate", documentRevision: string, sourcePreviewId?: string | null, promptTechnique = "prose", promptFanId?: string | null) {
  const base = kind === "preview" ? `preview:${documentRevision}` : `generate:${documentRevision}:${sourcePreviewId || "document"}`;
  return promptTechnique === "prose" && !promptFanId ? base : `${base}:prompt:${promptTechnique}${promptFanId ? `:fan:${promptFanId}` : ""}`;
}

export const DOCUMENT_JOB_LEASE_MS = 75_000;
export const DOCUMENT_JOB_HEARTBEAT_MS = 15_000;
export const DOCUMENT_JOB_STALE_AFTER_MS = 45_000;

export const documentJobMaxAttempts = (kind: DocumentJobKind) =>
  kind === "preview" || kind === "generate" || kind === "extract_reference" ? 2 : 1;

export const documentJobTerminal = (job: Pick<DocumentJob, "status">) => job.status === "completed" || job.status === "partial" || job.status === "failed";

export function documentJobIsStale(job: Pick<DocumentJob, "status" | "leaseExpiresAt" | "updatedAt">, now = Date.now()) {
  if (job.status !== "running") return false;
  const leaseExpires = Date.parse(job.leaseExpiresAt ?? "");
  const updated = Date.parse(job.updatedAt);
  return Number.isFinite(leaseExpires) && leaseExpires <= now || Number.isFinite(updated) && updated <= now - DOCUMENT_JOB_STALE_AFTER_MS;
}

export function documentJobActionLabel(job: DocumentJob | undefined, kind: "preview" | "generate", blockedByDraft = false) {
  if (!job) return kind === "preview" ? "Preview draft" : "Generate full";
  if (job.status === "queued") {
    if (kind === "generate" && blockedByDraft) return "Full queued behind draft…";
    return kind === "preview" ? "Draft queued…" : "Full generation queued…";
  }
  if (kind === "preview") return job.stage === "rendering" ? "Draft rendering…" : "Draft preparing…";
  return job.stage === "rendering" ? "Rendering full image…" : "Preparing full image…";
}

export const DOCUMENT_JOB_KINDS = ["preview", "generate", "prompt_fan", "chat", "structure_adaptive", "extract_reference"] as const;
export type DocumentJobKind = typeof DOCUMENT_JOB_KINDS[number];
export type DocumentJobStatus = "queued" | "running" | "completed" | "partial" | "failed";
export type ProviderFailureCategory = "safety" | "authentication" | "access" | "quota" | "rate_limit" | "network" | "canceled" | "provider" | "server" | "unknown";
export type ProviderFailureScope = "request" | "user" | "workspace" | "account" | "project" | "organization" | "model" | "region" | "network" | "provider" | "unknown";
export type ProviderFailureAction = "edit_request" | "check_credentials" | "check_project" | "verify_organization" | "add_credits" | "raise_limit" | "review_budget" | "wait_and_retry" | "retry" | "contact_support" | "none";
export type DocumentJobError = { code: string; category: ProviderFailureCategory; scope: ProviderFailureScope; action: ProviderFailureAction; message: string; retryable: boolean; retryAfterMs: number | null; requestId: string | null; httpStatus: number | null };
export type PromptFanMember = { jobId: string; promptTechnique: "prose" | "bullets" | "json" | "xml"; status: Exclude<DocumentJobStatus, "partial">; error: DocumentJobError | null; moderationPromptRef: string | null; attemptCount: number; updatedAt: string };

export type GenerationFailureGuidance = {
  title: string;
  summary: string;
  actionLabel: string | null;
  actionUrl: string | null;
  retryAllowed: boolean;
};

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
  moderationPromptRef: string | null;
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

export function documentJobFailure(job: DocumentJob) {
  const stored = job.errorDetail ?? job.members.find((member) => member.error)?.error ?? null;
  if (stored) return stored;
  const message = job.error ?? ""; const lower = message.toLowerCase();
  if (/safety|moderation|request was rejected/.test(lower)) return { code: "safety_rejected", category: "safety", scope: "request", action: "edit_request", message, retryable: false, retryAfterMs: null, requestId: message.match(/req_[a-z0-9]+/i)?.[0] ?? null, httpStatus: 400 } satisfies DocumentJobError;
  if (/budget.*hard.*cap|quota|credit/.test(lower)) return { code: "budget_hard_cap_reached", category: "quota", scope: "user", action: "review_budget", message, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 429 } satisfies DocumentJobError;
  return null;
}

export function generationFailureGuidance(detail: DocumentJobError | null, fallback = "") : GenerationFailureGuidance {
  if (!detail) return { title: "The image could not be completed", summary: fallback || "The server returned an error without a provider receipt.", actionLabel: null, actionUrl: null, retryAllowed: true };
  if (detail.category === "safety") return { title: "Safety checks stopped this image", summary: "Change the request or reference image before trying again. Repeating the exact request is not expected to help.", actionLabel: "Review safety guidance", actionUrl: "https://developers.openai.com/api/docs/guides/safety-best-practices", retryAllowed: false };
  if (detail.action === "review_budget") return { title: detail.scope === "workspace" ? "The workspace generation budget is exhausted" : "Your generation budget is exhausted", summary: "This application limit resets with the next budget period. An administrator can raise the configured token limit; retrying now would be rejected before an OpenAI request is sent.", actionLabel: "Review operational limits", actionUrl: "/operations", retryAllowed: false };
  if (detail.action === "add_credits") return { title: "The OpenAI account has no available API credit", summary: "Add credits or resolve billing on the OpenAI organization, then retry this image.", actionLabel: "Open billing settings", actionUrl: "https://platform.openai.com/settings/organization/billing/overview", retryAllowed: false };
  if (detail.category === "quota" && detail.scope === "project") return { title: "The OpenAI project limit was reached", summary: "Raise the project spend or usage limit, or wait for its budget period to reset, then retry.", actionLabel: "Review project limits", actionUrl: "https://platform.openai.com/settings/organization/limits", retryAllowed: false };
  if (detail.category === "quota" && detail.scope === "organization") return { title: "The OpenAI organization limit was reached", summary: "An organization owner must raise the spend or usage limit before generation can continue.", actionLabel: "Review organization limits", actionUrl: "https://platform.openai.com/settings/organization/limits", retryAllowed: false };
  if (detail.category === "authentication") return { title: "The OpenAI credential was rejected", summary: "Reconnect a valid API key for the configured project. The app will not keep retrying an invalid credential.", actionLabel: "Review API keys", actionUrl: "https://platform.openai.com/api-keys", retryAllowed: false };
  if (detail.action === "verify_organization") return { title: "OpenAI organization verification is required", summary: "Complete organization verification for GPT Image access, then retry.", actionLabel: "Review organization settings", actionUrl: "https://platform.openai.com/settings/organization/general", retryAllowed: false };
  if (detail.category === "access") return { title: detail.scope === "model" ? "This project cannot use the image model" : "This credential cannot access the configured OpenAI project", summary: "Check that the API key belongs to the selected project and that the project permits GPT Image 2.", actionLabel: "Review project settings", actionUrl: "https://platform.openai.com/settings/organization/projects", retryAllowed: false };
  if (detail.category === "rate_limit") return { title: "OpenAI is limiting image throughput", summary: detail.retryAfterMs ? `The server already retried. Wait about ${Math.max(1, Math.ceil(detail.retryAfterMs / 1000))} seconds before trying again.` : "The server already retried with backoff. Wait briefly before trying again.", actionLabel: "Review rate limits", actionUrl: "https://platform.openai.com/settings/organization/limits", retryAllowed: true };
  if (detail.category === "network" || detail.category === "server") return { title: "The provider connection was interrupted", summary: "No terminal account or request block was reported. It is reasonable to retry.", actionLabel: null, actionUrl: null, retryAllowed: true };
  return { title: "The provider did not produce an image", summary: detail.message || fallback || "Review the technical receipt, adjust the request if needed, and try again.", actionLabel: null, actionUrl: null, retryAllowed: detail.retryable };
}

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

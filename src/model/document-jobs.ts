export const DOCUMENT_JOB_KINDS = ["preview", "generate", "prompt_fan", "chat", "structure_adaptive", "extract_reference", "render_document"] as const;
export type DocumentJobKind = typeof DOCUMENT_JOB_KINDS[number];
export type DocumentJobStatus = "queued" | "running" | "committing" | "completed" | "partial" | "failed" | "canceled";
export type ProviderFailureCategory = "safety" | "authentication" | "access" | "quota" | "rate_limit" | "network" | "canceled" | "provider" | "server" | "unknown";
export type ProviderFailureScope = "request" | "user" | "workspace" | "account" | "project" | "organization" | "model" | "region" | "network" | "provider" | "unknown";
export type ProviderFailureAction = "edit_request" | "check_credentials" | "check_project" | "verify_organization" | "add_credits" | "raise_limit" | "review_budget" | "wait_and_retry" | "retry" | "contact_support" | "none";
export type DocumentJobError = { code: string; category: ProviderFailureCategory; scope: ProviderFailureScope; action: ProviderFailureAction; message: string; retryable: boolean; retryAfterMs: number | null; requestId: string | null; httpStatus: number | null; riskCategories?: string[]; contributingBlockIds?: string[]; contributingReferenceIds?: string[]; probe?: string | null };
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
  productionMode: ProductionMode;
  promptTechnique: "prose" | "bullets" | "json" | "xml";
  promptFanId: string | null;
  parentJobId: string | null;
  fanKind: "preview" | "generate" | null;
  members: PromptFanMember[];
  result: Record<string, unknown> | null;
  error: string | null;
  errorDetail: DocumentJobError | null;
  moderationPromptRef: string | null;
  dismissedAt: string | null;
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

export type DocumentJobProgressStep = {
  id: string;
  label: string;
  state: "complete" | "active" | "pending";
};

export type DocumentJobProgress = {
  percent: number;
  label: string;
  detail: string | null;
  steps: DocumentJobProgressStep[];
};

type ProgressPhase = { id: string; label: string; stages: string[] };

const IMAGE_PROGRESS: ProgressPhase[] = [
  { id: "queue", label: "Queue", stages: ["queued", "queue-recovery", "recovering"] },
  { id: "plan", label: "Plan", stages: ["preparing", "compiling", "planning", "processing"] },
  { id: "review", label: "Review", stages: ["safety-review"] },
  { id: "render", label: "Render", stages: ["provider-wait", "rendering"] },
  { id: "save", label: "Save", stages: ["saving", "committing"] },
];

const FAN_PROGRESS: ProgressPhase[] = [
  { id: "queue", label: "Queue", stages: ["queued", "queue-recovery", "recovering"] },
  { id: "prepare", label: "Prepare ×4", stages: ["preparing", "compiling", "planning", "processing", "safety-review"] },
  { id: "render", label: "Render ×4", stages: ["provider-wait", "rendering"] },
  { id: "save", label: "Save", stages: ["saving", "committing"] },
];

const TEXT_ARTIFACT_PROGRESS: ProgressPhase[] = [
  { id: "queue", label: "Queue", stages: ["queued", "queue-recovery", "recovering", "preparing"] },
  { id: "structure", label: "Structure", stages: ["planning"] },
  { id: "write", label: "Write", stages: ["writing"] },
  { id: "save", label: "Save", stages: ["saving", "committing"] },
];

const STORYBOARD_PROGRESS: ProgressPhase[] = [
  { id: "queue", label: "Queue", stages: ["queued", "queue-recovery", "recovering", "preparing"] },
  { id: "structure", label: "Structure", stages: ["planning"] },
  { id: "render", label: "Render frames", stages: ["anchor-generation", "rendering-frames", "rendering-scenes", "safety-review", "provider-wait", "rendering"] },
  { id: "save", label: "Save", stages: ["saving", "committing"] },
];

const VIDEO_PROGRESS: ProgressPhase[] = [
  { id: "queue", label: "Queue", stages: ["queued", "queue-recovery", "recovering", "preparing"] },
  { id: "structure", label: "Structure", stages: ["planning", "preparing-video", "anchor-generation"] },
  { id: "submit", label: "Submit", stages: ["uploading-references", "submitting"] },
  { id: "render", label: "Render", stages: ["rendering", "rendering-scenes"] },
  { id: "save", label: "Save", stages: ["finalizing", "downloading", "saving", "committing"] },
];

/** A UI-safe estimate from durable job checkpoints; it never implies provider precision we do not have. */
export function documentJobProgress(job: DocumentJob): DocumentJobProgress {
  const artifactKind = String(job.result?.artifactKind ?? "");
  const phases = job.kind === "prompt_fan"
    ? FAN_PROGRESS
    : job.kind !== "render_document"
      ? IMAGE_PROGRESS
      : artifactKind === "video"
        ? VIDEO_PROGRESS
        : artifactKind === "storyboard"
          ? STORYBOARD_PROGRESS
          : TEXT_ARTIFACT_PROGRESS;
  const stage = job.status === "committing" ? "committing" : job.stage || job.status;
  const recoveringQueue = stage === "queue-recovery" || stage === "recovering";
  let activeIndex = phases.findIndex((phase) => phase.stages.includes(stage));
  if (activeIndex < 0) activeIndex = job.status === "queued" ? 0 : Math.min(1, phases.length - 1);
  const fanCompleted = job.kind === "prompt_fan" ? Number(job.result?.completedCount ?? job.members.filter((member) => member.status === "completed").length) : 0;
  if (job.kind === "prompt_fan" && (fanCompleted > 0 || job.members.some((member) => member.status === "running" || member.status === "committing"))) activeIndex = 2;

  const providerPercent = job.progressMessage.match(/(?:rendering\s*[·:]?\s*)?(\d{1,3})%/i);
  const unitProgress = job.progressMessage.match(/(?:frame\s+)?(\d+)\s+of\s+(\d+)/i);
  const phaseStart = activeIndex / phases.length * 100;
  const phaseSpan = 100 / phases.length;
  let phaseFraction = job.status === "queued" ? .18 : .42;
  let detail: string | null = recoveringQueue ? job.progressMessage || "Recovering an interrupted queue operation" : null;

  if (providerPercent) {
    const value = Math.max(0, Math.min(99, Number(providerPercent[1])));
    phaseFraction = value / 100;
    detail = `${value}% reported by the provider`;
  } else if (unitProgress) {
    const complete = Math.max(0, Number(unitProgress[1]));
    const total = Math.max(1, Number(unitProgress[2]));
    phaseFraction = Math.min(1, complete / total);
    detail = `${Math.min(complete, total)} of ${total} ${artifactKind === "video" ? "scenes" : "frames"} stored`;
  } else if (job.kind === "prompt_fan" && fanCompleted > 0) {
    phaseFraction = Math.min(1, fanCompleted / 4);
    detail = `${Math.min(fanCompleted, 4)} of 4 prompt approaches finished`;
  }

  const percent = job.status === "committing"
    ? 96
    : Math.max(job.status === "queued" ? 3 : 8, Math.min(95, Math.round(phaseStart + phaseSpan * phaseFraction)));
  return {
    percent,
    label: recoveringQueue ? "Recovering queue" : phases[activeIndex]?.label ?? "Working",
    detail,
    steps: phases.map((phase, index) => ({ id: phase.id, label: phase.label, state: index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending" })),
  };
}

function stableGenerationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableGenerationValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b, "en-US")).map(([key, item]) => [key, stableGenerationValue(item)]));
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
  kind === "render_document" ? 8 : kind === "preview" || kind === "generate" || kind === "extract_reference" ? 2 : 1;

export const documentJobTerminal = (job: Pick<DocumentJob, "status">) => job.status === "completed" || job.status === "partial" || job.status === "failed" || job.status === "canceled";
export const documentJobFailureVisible = (job: Pick<DocumentJob, "status" | "dismissedAt">) => (job.status === "failed" || job.status === "partial") && !job.dismissedAt;

export function documentJobFailure(job: DocumentJob) {
  const stored = job.errorDetail ?? job.members.find((member) => member.error)?.error ?? null;
  if (stored) return stored;
  const message = job.error ?? ""; const lower = message.toLowerCase();
  const falStatus = lower.match(/^fal_(\d{3})$/);
  if (falStatus) {
    const status = Number(falStatus[1]);
    const editable = status === 400 || status === 422;
    return {
      code: lower,
      category: status >= 500 ? "server" : "provider",
      scope: editable ? "request" : "provider",
      action: editable ? "edit_request" : "retry",
      message: editable
        ? "The video provider could not accept the selected request settings or image references."
        : `The video provider returned HTTP ${status} without a detailed error receipt.`,
      retryable: !editable,
      retryAfterMs: null,
      requestId: null,
      httpStatus: status,
    } satisfies DocumentJobError;
  }
  if (/safety|moderation|request was rejected/.test(lower)) return { code: "safety_rejected", category: "safety", scope: "request", action: "edit_request", message, retryable: false, retryAfterMs: null, requestId: message.match(/req_[a-z0-9]+/i)?.[0] ?? null, httpStatus: 400 } satisfies DocumentJobError;
  if (/budget.*hard.*cap|quota|credit/.test(lower)) return { code: "budget_hard_cap_reached", category: "quota", scope: "user", action: "review_budget", message, retryable: false, retryAfterMs: null, requestId: null, httpStatus: 429 } satisfies DocumentJobError;
  return null;
}

/** A saved provider request can only be resumed after a genuinely recoverable transport/result failure. */
export function documentJobCanRecoverProviderRender(job: DocumentJob) {
  if (job.kind !== "render_document" || job.status !== "failed" || job.result?.artifactKind !== "video") return false;
  const sceneReceipts = job.result.productionSceneReceipts && typeof job.result.productionSceneReceipts === "object"
    ? Object.values(job.result.productionSceneReceipts as Record<string, Record<string, unknown>>)
    : [];
  const recoverableScene = job.result.recoverableProductionProviderRequest === true
    || sceneReceipts.some((scene) => Boolean(scene.providerJobId) && (scene.status === "submitted" || scene.status === "completed"));
  if (!job.result.providerJobId && !recoverableScene) return false;
  const failure = documentJobFailure(job);
  const recoverableReservationFailure=failure?.code==="cost_reservation_invalid_or_expired"||failure?.code==="cost_reservation_already_in_use"||failure?.code==="execution_interrupted";
  return Boolean((failure?.retryable||recoverableReservationFailure)&&failure?.category!=="safety"&&failure?.httpStatus!==400&&failure?.httpStatus!==422);
}

const TRUSTED_GENERATION_FAILURE_FALLBACKS = new Set([
  "Change this request or its reference before trying again.",
  "This prompt structure did not produce an image.",
]);

export function generationFailureGuidance(detail: DocumentJobError | null, fallback = "") : GenerationFailureGuidance {
  if (!detail) {
    return { title: "The generation could not be completed", summary: TRUSTED_GENERATION_FAILURE_FALLBACKS.has(fallback) ? fallback : "The provider could not complete this request. Review the saved inputs and technical receipt before trying again.", actionLabel: null, actionUrl: null, retryAllowed: true };
  }
  if (detail.code === "local_persistence_failed") return { title: "Forma could not save this generation", summary: "A local event or database write failed while Forma was saving this generation. No provider outage was reported. Contact support or review the server's persistence and event-storage diagnostics.", actionLabel: null, actionUrl: null, retryAllowed: false };
  if (detail.code === "source_fidelity_validation_failed") return { title: "The presentation did not preserve its source", summary: "The generated presentation failed source-fidelity validation and was not accepted. Review the source document and adjust the presentation requirements before starting a new request.", actionLabel: null, actionUrl: null, retryAllowed: false };
  if (detail.category === "safety" && (detail.riskCategories?.includes("audio-copyright") || /\baudio\b.*\bcopyright\b/i.test(detail.message))) return { title: "The generated soundtrack was rejected", summary: "The provider flagged generated audio as a potential copyright issue. Create a silent video, or explicitly choose original environmental ambience without music or voices. This rejected provider render cannot be recovered.", actionLabel: null, actionUrl: null, retryAllowed: false };
  if (detail.code.startsWith("fal_") && detail.category !== "safety" && (detail.httpStatus === 400 || detail.httpStatus === 422)) return { title: "The video settings or references were not accepted", summary: "Review the requested duration, frame, reference images, and submitted prompt before trying again. The complete failed-attempt receipt remains available.", actionLabel: null, actionUrl: null, retryAllowed: false };
  if (detail.code === "video_provider_not_configured") return { title: "Fal video generation is not configured", summary: "Add a valid server-side Fal key before retrying this video. Other document renderers remain available.", actionLabel: "Review Fal keys", actionUrl: "https://fal.ai/dashboard/keys", retryAllowed: false };
  if (detail.code.startsWith("fal_") && detail.category === "authentication") return { title: "The Fal credential was rejected", summary: "Replace the server-side Fal key, then retry this video. The app will not keep retrying an invalid credential.", actionLabel: "Review Fal keys", actionUrl: "https://fal.ai/dashboard/keys", retryAllowed: false };
  if (detail.code.startsWith("fal_") && detail.category === "quota") return { title: "The Fal account cannot fund this video", summary: "Add credits or resolve the Fal account limit before retrying the paid render.", actionLabel: "Review Fal billing", actionUrl: "https://fal.ai/dashboard/billing", retryAllowed: false };
  if (detail.code.startsWith("fal_") && detail.category === "rate_limit") return { title: "Fal is limiting video throughput", summary: detail.retryAfterMs ? `The server already retried. Wait about ${Math.max(1, Math.ceil(detail.retryAfterMs / 1000))} seconds before trying again.` : "The server already retried with backoff. Wait briefly before trying again.", actionLabel: null, actionUrl: null, retryAllowed: true };
  if (detail.code === "fal_submission_receipt_missing") return { title: "Fal did not return a video receipt", summary: "The provider accepted the connection but returned no usable request ID. The app preserved the exact video input and avoided an automatic paid resubmission; review it, then retry once.", actionLabel: null, actionUrl: null, retryAllowed: true };
  if (detail.code === "fal_queue_route_method_not_allowed") return { title: "The video finished, but its queue route was incompatible", summary: "Fal preserved the paid render. Retry resumes that provider request through its application-level status and result URLs; it does not submit a second video.", actionLabel: null, actionUrl: null, retryAllowed: true };
  if (/^fal_(status|result)_response_invalid$/.test(detail.code)||detail.code === "fal_status_receipt_invalid") return { title: "Fal returned an incomplete video update", summary: "The server retried the safe status read and preserved the provider request ID. Retrying resumes that durable provider job instead of starting a duplicate paid render.", actionLabel: null, actionUrl: null, retryAllowed: true };
  if (detail.code === "fal_reference_upload_failed") return { title: "A video reference could not be staged", summary: "The original image remains safe in this document. Check the Fal connection and retry; the app uploads references to short-lived provider storage before submitting the video request.", actionLabel: null, actionUrl: null, retryAllowed: true };
  if (detail.code === "provider_returned_incomplete_document_artifact") return { title: "The output plan was incomplete", summary: "The provider returned structurally incomplete output data. The technical receipt identifies the exact fields that still need correction.", actionLabel: null, actionUrl: null, retryAllowed: true };
  if (detail.category === "safety") return { title: "Safety checks stopped this generation", summary: "Change the request or reference image before trying again. Repeating the exact request is not expected to help.", actionLabel: "Review safety guidance", actionUrl: "https://developers.openai.com/api/docs/guides/safety-best-practices", retryAllowed: false };
  if (detail.action === "review_budget") return { title: detail.scope === "workspace" ? "The workspace generation budget is exhausted" : "Your generation budget is exhausted", summary: "This application limit resets with the next budget period. An administrator can raise the configured token limit; retrying now would be rejected before an OpenAI request is sent.", actionLabel: "Review operational limits", actionUrl: "/operations", retryAllowed: false };
  if (detail.action === "add_credits") return { title: "The OpenAI account has no available API credit", summary: "Add credits or resolve billing on the OpenAI organization, then retry this image.", actionLabel: "Open billing settings", actionUrl: "https://platform.openai.com/settings/organization/billing/overview", retryAllowed: false };
  if (detail.category === "quota" && detail.scope === "project") return { title: "The OpenAI project limit was reached", summary: "Raise the project spend or usage limit, or wait for its budget period to reset, then retry.", actionLabel: "Review project limits", actionUrl: "https://platform.openai.com/settings/organization/limits", retryAllowed: false };
  if (detail.category === "quota" && detail.scope === "organization") return { title: "The OpenAI organization limit was reached", summary: "An organization owner must raise the spend or usage limit before generation can continue.", actionLabel: "Review organization limits", actionUrl: "https://platform.openai.com/settings/organization/limits", retryAllowed: false };
  if (detail.category === "authentication") return { title: "The OpenAI credential was rejected", summary: "Reconnect a valid API key for the configured project. The app will not keep retrying an invalid credential.", actionLabel: "Review API keys", actionUrl: "https://platform.openai.com/api-keys", retryAllowed: false };
  if (detail.action === "verify_organization") return { title: "OpenAI organization verification is required", summary: "Complete organization verification for GPT Image access, then retry.", actionLabel: "Review organization settings", actionUrl: "https://platform.openai.com/settings/organization/general", retryAllowed: false };
  if (detail.category === "access") return { title: detail.scope === "model" ? "This project cannot use the image model" : "This credential cannot access the configured OpenAI project", summary: "Check that the API key belongs to the selected project and that the project permits GPT Image 2.", actionLabel: "Review project settings", actionUrl: "https://platform.openai.com/settings/organization/projects", retryAllowed: false };
  if (detail.category === "rate_limit") return { title: "OpenAI is limiting image throughput", summary: detail.retryAfterMs ? `The server already retried. Wait about ${Math.max(1, Math.ceil(detail.retryAfterMs / 1000))} seconds before trying again.` : "The server already retried with backoff. Wait briefly before trying again.", actionLabel: "Review rate limits", actionUrl: "https://platform.openai.com/settings/organization/limits", retryAllowed: true };
  if (detail.category === "network" || detail.category === "server") return { title: "The provider connection was interrupted", summary: detail.retryable ? "No terminal account or request block was reported. It is reasonable to retry." : "Review the saved technical receipt and resolve the reported connection or server issue before starting a new request.", actionLabel: null, actionUrl: null, retryAllowed: detail.retryable };
  if (detail.category === "canceled") return { title: "The generation request was stopped", summary: "No late provider result will be adopted. Start a new request whenever the document is ready.", actionLabel: null, actionUrl: null, retryAllowed: true };
  return { title: "The provider did not produce the requested output", summary: "Review the technical receipt, adjust the request if needed, and try again.", actionLabel: null, actionUrl: null, retryAllowed: detail.retryable };
}

const PROVIDER_CREDENTIAL_DESTINATIONS = new Set([
  "https://fal.ai/dashboard/keys",
  "https://platform.openai.com/api-keys",
]);

const PROVIDER_POLICY_DESTINATIONS = new Set([
  "https://fal.ai/dashboard/billing",
  "https://platform.openai.com/settings/organization/billing/overview",
  "https://platform.openai.com/settings/organization/limits",
  "https://platform.openai.com/settings/organization/general",
  "https://platform.openai.com/settings/organization/projects",
]);

/** Privileged provider destinations are visible only to the exact nonimpersonating platform principal. */
export function authorizedGenerationFailureRemediation(
  guidance: GenerationFailureGuidance,
  principal: { capabilities?: readonly string[]; projectContext?: unknown; impersonation?: unknown } | null,
) {
  if (!principal || principal.projectContext || principal.impersonation || guidance.retryAllowed || !guidance.actionUrl || !guidance.actionLabel || !Array.isArray(principal.capabilities)) return null;
  const capabilities = principal.capabilities;
  const provider = capabilities.includes("platform.provider.configure");
  const policy = capabilities.includes("platform.policy.manage");
  const destination = guidance.actionUrl;
  const allowed = PROVIDER_CREDENTIAL_DESTINATIONS.has(destination) ? provider
    : PROVIDER_POLICY_DESTINATIONS.has(destination) ? policy
      : destination === "/operations" ? policy
        : false;
  return allowed ? { href: destination, label: guidance.actionLabel, external: destination.startsWith("https://") } : null;
}

export function documentJobIsStale(job: Pick<DocumentJob, "status" | "leaseExpiresAt" | "updatedAt">, now = Date.now()) {
  if (job.status !== "running" && job.status !== "committing") return false;
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
  if (job.status === "committing") return kind === "preview" ? "Finalizing draft…" : "Finalizing full image…";
  if (kind === "preview") return job.stage === "rendering" ? "Draft rendering…" : "Draft preparing…";
  return job.stage === "rendering" ? "Rendering full image…" : "Preparing full image…";
}
import type { ProductionMode } from "./managed-production.ts";

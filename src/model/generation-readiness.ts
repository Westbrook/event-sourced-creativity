import type { PromptTechnique } from "./prompt-structures.ts";

export const GENERATION_PREFLIGHT_VERSION = "generation-readiness-v1";
export type GenerationReadinessStatus = "checking" | "ready" | "review" | "blocked" | "unknown";
export type GenerationReadinessKind = "preview" | "generate" | "preview_fan" | "generate_fan";
export type GenerationProbeSeverity = "info" | "warning" | "blocking";

export type GenerationReadinessProbe = {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail" | "unknown";
  severity: GenerationProbeSeverity;
  summary: string;
  action?: "review_prompt" | "review_blocks" | "review_references" | "review_budget" | "refresh_provider" | "wait" | "none";
  blockIds?: string[];
  referenceIds?: string[];
  categories?: string[];
};

export type ProviderHealthSnapshot = {
  status: "healthy" | "credits_blocked" | "project_limit" | "organization_limit" | "authentication_failed" | "model_access" | "rate_limited" | "degraded" | "unknown";
  scope: "account" | "project" | "organization" | "model" | "provider" | "unknown";
  message: string;
  observedAt: string;
  expiresAt: string;
  retryAfterMs: number | null;
  requestId: string | null;
};

export type GenerationReadiness = {
  preflightId: string;
  requestKey: string;
  documentId: string;
  documentRevision: string;
  kind: GenerationReadinessKind;
  promptTechnique: PromptTechnique;
  status: GenerationReadinessStatus;
  summary: string;
  probes: GenerationReadinessProbe[];
  provider: ProviderHealthSnapshot;
  estimatedTokens: number;
  estimatedCostMicrousd: number;
  estimatedSeconds: number;
  requiresAcknowledgement: boolean;
  checkedAt: string;
  expiresAt: string;
  cached: boolean;
  version: string;
};

export type PromptTechniqueSafetyResult = {
  technique: PromptTechnique;
  status: "pass" | "review" | "unknown";
  summary: string;
  prompt: string;
  promptLength: number;
  compacted: boolean;
  categories: string[];
  blockIds: string[];
  referenceIds: string[];
  coverage: "text" | "text-and-images";
  latencyMs: number;
  requestId: string | null;
};

export type PromptTechniqueSafetyComparison = {
  comparisonId: string;
  documentId: string;
  documentRevision: string;
  failedTechnique: PromptTechnique;
  recommendedTechnique: PromptTechnique | null;
  summary: string;
  results: PromptTechniqueSafetyResult[];
  referenceCount: number;
  imageGenerationCalls: 0;
  checkedAt: string;
  version: string;
};

export const generationReadinessReservation = (kind: GenerationReadinessKind) => kind === "preview" ? 24_000 : kind === "generate" ? 32_000 : kind === "preview_fan" ? 96_000 : 128_000;
export const generationReadinessSeconds = (kind: GenerationReadinessKind) => kind === "preview" ? 25 : kind === "generate" ? 55 : kind === "preview_fan" ? 95 : 210;
export const generationReadinessCostMicrousd = (kind: GenerationReadinessKind) => kind === "preview" ? 18_000 : kind === "generate" ? 90_000 : kind === "preview_fan" ? 72_000 : 360_000;

export function generationReadinessLabel(value: GenerationReadiness | null | undefined) {
  if (!value || value.status === "checking") return "Checking readiness…";
  if (value.status === "ready") return `Ready · about ${value.estimatedSeconds}s`;
  if (value.status === "review") return "Needs review before generation";
  if (value.status === "blocked") return value.summary;
  return "Readiness could not be confirmed";
}

export function generationReadinessBlocks(value: GenerationReadiness | null | undefined) {
  return value?.status === "blocked" || value?.status === "checking" || value?.status === "unknown";
}

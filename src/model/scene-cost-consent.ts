import { MANAGED_PRODUCTION_BATCH_RESERVATION_MICROUSD, MANAGED_PRODUCTION_BATCH_SIZE, type ManagedProductionPlan } from "./managed-production.ts";
import { isSceneMedium, type SceneMedium } from "./scene-configuration.ts";
import type { ProductionMode } from "./managed-production.ts";
import type { DocumentJob } from "./document-jobs.ts";
import type { ProductionWorkflowSource } from "./production-workflow.ts";

export type SceneCostRequest = {
  documentId: string;
  requestId: string;
  sceneMedium?: SceneMedium;
  productionMode?: ProductionMode;
  itemCount?: number;
  audience?: string;
  tone?: string;
  locale?: string;
  workflowId?: string;
  workflowStageId?: string;
  workflowSources?: ProductionWorkflowSource[];
  canvasId?: string;
  contextSetId?: string;
  contextRootBlockId?: string;
};

export type SceneCostPreview = {
  version: "scene-cost-v1";
  requestId: string;
  actorUserId: string;
  projectId: string;
  documentId: string;
  contextSessionId: string | null;
  permissionEpoch: string;
  period: string;
  requestHash: string;
  sourceHash: string;
  provider: "openai";
  model: string;
  sceneMedium: SceneMedium;
  productionMode: ProductionMode;
  itemCount: number;
  reusedSourceCount: number;
  providerCallCount: number;
  maximumProviderCallCount: number;
  maximumMicrousd: number;
  bindingHash: string;
};
export type SceneCostApproval = SceneCostPreview & { confirmed: true };
export type SceneCostInspection = { requestId: string; preview: SceneCostPreview | null; job: DocumentJob | null; safeUnused?: SceneSafeUnusedProof | null };

const previewKeys = [
  "version", "requestId", "actorUserId", "projectId", "documentId", "contextSessionId", "permissionEpoch", "period",
  "requestHash", "sourceHash", "provider", "model", "sceneMedium", "productionMode", "itemCount",
  "reusedSourceCount", "providerCallCount", "maximumProviderCallCount", "maximumMicrousd", "bindingHash",
] as const;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 240;
const integer = (value: unknown, minimum: number): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;

/** The UI may display only a complete current server descriptor, never a guessed one-request fallback. */
export function isSceneCostPreview(value: unknown): value is SceneCostPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== previewKeys.length || previewKeys.some(key => !Object.hasOwn(record, key))) return false;
  if (record.version !== "scene-cost-v1" || record.provider !== "openai"
    || !["requestId", "actorUserId", "projectId", "documentId", "permissionEpoch", "model"].every(key => identifier(record[key]))
    || record.contextSessionId !== null && !identifier(record.contextSessionId)
    || typeof record.period !== "string" || !/^\d{4}-\d{2}$/u.test(record.period)
    || !digest(record.requestHash) || !digest(record.sourceHash) || !digest(record.bindingHash)
    || !isSceneMedium(record.sceneMedium) || !["manual", "managed"].includes(String(record.productionMode))
    || !integer(record.itemCount, 1) || !integer(record.reusedSourceCount, 0)
    || !integer(record.providerCallCount, 1) || !integer(record.maximumProviderCallCount, 1)
    || !integer(record.maximumMicrousd, 1)) return false;
  const batches = record.productionMode === "managed" ? Math.ceil(record.itemCount / MANAGED_PRODUCTION_BATCH_SIZE) : 1;
  return record.providerCallCount === batches
    && record.maximumProviderCallCount === batches * (record.productionMode === "managed" ? 4 : 2)
    && record.maximumMicrousd === batches * MANAGED_PRODUCTION_BATCH_RESERVATION_MICROUSD;
}

export function sceneCostApprovalMatches(value: unknown, preview: SceneCostPreview): value is SceneCostApproval {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { confirmed, ...candidate } = value as Record<string, unknown>;
  return confirmed === true && isSceneCostPreview(candidate) && isSceneCostPreview(preview)
    && previewKeys.every(key => candidate[key] === preview[key]);
}

/** Arrays keep the existing consent hash and browser digest identical without copying private source text. */
export function sceneCostRequestDescription(input: SceneCostRequest): unknown[] {
  return [
    "scene-cost-request-v1", input.requestId, input.documentId, input.sceneMedium ?? "visual", input.productionMode ?? "manual",
    input.itemCount ?? null, (input.audience ?? "").trim(), (input.tone ?? "").trim(), (input.locale ?? "en").toLowerCase(),
    input.workflowId ?? null, input.workflowStageId ?? null,
    (input.workflowSources ?? []).map(source => [
      source.outputKind, source.outputId, source.format, source.documentId, source.sourceEventId,
      source.revision, source.contentSha256 ?? null, source.allowTextGuidance,
    ]),
    input.canvasId ?? null, input.contextSetId ?? null, input.contextRootBlockId ?? null,
  ];
}

export async function sceneCostRequestHash(input: SceneCostRequest): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(sceneCostRequestDescription(input))));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function sceneCostLimits(production: ManagedProductionPlan | null, itemCount = 1) {
  return {
    itemCount: production?.scenes.length ?? Math.max(1, Math.min(12, Math.floor(itemCount))),
    providerCallCount: production?.providerCallCount ?? 1,
    maximumProviderCallCount: production?.maximumProviderCallCount ?? 2,
    maximumMicrousd: production?.estimatedPlanningCostMicrousd ?? MANAGED_PRODUCTION_BATCH_RESERVATION_MICROUSD,
  };
}

/** Fresh response-only evidence; never a new-purchase approval or a replacement job. */
export type SceneSafeUnusedProof = {
  version: "scene-safe-unused-v1";
  requestId: string;
  actorUserId: string;
  projectId: string;
  documentId: string;
  contextSessionId: string | null;
  permissionEpoch: string;
  bindingHash: string;
  jobStatus: "canceled" | "failed";
  jobUpdatedAt: string;
  attemptCount: number;
  reason: "canceled-before-start" | "source-unavailable-before-dispatch" | "policy-stopped-before-dispatch";
  verifiedAt: string;
  expiresAt: string;
  evidenceHash: string;
};

const unusedKeys = [
  "version", "requestId", "actorUserId", "projectId", "documentId", "contextSessionId", "permissionEpoch",
  "bindingHash", "jobStatus", "jobUpdatedAt", "attemptCount", "reason", "verifiedAt", "expiresAt", "evidenceHash",
] as const;
const instant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

/** The host must additionally match the exact returned job, original binding and current authority. */
export function isSceneSafeUnusedProof(value: unknown, now = Date.now()): value is SceneSafeUnusedProof {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isFinite(now)) return false;
  const proof = value as Record<string, unknown>;
  if (Object.keys(proof).length !== unusedKeys.length || unusedKeys.some(key => !Object.hasOwn(proof, key))
    || proof.version !== "scene-safe-unused-v1"
    || !["requestId", "actorUserId", "projectId", "documentId", "permissionEpoch"].every(key => identifier(proof[key]))
    || proof.contextSessionId !== null && !identifier(proof.contextSessionId)
    || !digest(proof.bindingHash) || !digest(proof.evidenceHash)
    || !instant(proof.verifiedAt) || !instant(proof.expiresAt) || !instant(proof.jobUpdatedAt)) return false;
  const verified = Date.parse(proof.verifiedAt), expires = Date.parse(proof.expiresAt);
  return verified <= now && now < expires && expires - verified > 0 && expires - verified <= 30_000
    && Date.parse(proof.jobUpdatedAt) <= verified && proof.verifiedAt.slice(0, 7) === new Date(now).toISOString().slice(0, 7)
    && (proof.reason === "canceled-before-start" && proof.jobStatus === "canceled" && proof.attemptCount === 0
      || ["source-unavailable-before-dispatch","policy-stopped-before-dispatch"].includes(String(proof.reason)) && proof.jobStatus === "failed" && proof.attemptCount === 1);
}

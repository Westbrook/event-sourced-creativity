/** Worker-owned evidence for one paid provider request, never client authority. */
export type PaidProviderSubmission = {
  clientRequestId: string;
  provider: "openai" | "fal";
  operation: "planning" | "image" | "video" | "audio" | "model3d";
  model: string;
  unitId?: string;
  status: "pending" | "accepted" | "completed" | "rejected";
  providerRequestId?: string;
  responseRef?: string;
  costMicrousd?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Frozen per-call evidence. A client ID is a trace, never provider idempotency. */
  requestDigest?: string;
  reasoningEffort?: string;
  maximumOutputTokens?: number;
  submittedAt?: string;
  responseReceivedAt?: string;
  httpRequestId?: string;
  completionStatus?: string;
  incompleteReason?: string;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
  pricingVersion?: string;
  textInputCostMicrousd?: number;
  textOutputCostMicrousd?: number;
  effectiveModel?: string;
  routingPhase?: string;
  routingVersion?: string;
  serviceTier?: string;
  cachePolicy?: string;
  usageCostBasis?: string;
  pricingReceipt?: Record<string, unknown>;
  latencyMs?: number;
  validationStatus?: "pending" | "valid" | "invalid";
  validationIssueCount?: number;
};

export type PaidProviderSubmissionObserver = (receipt: PaidProviderSubmission) => void | Promise<void>;

/** Source-free billing evidence survives private-body retention and cancellation. */
export const PAID_PROVIDER_FINANCIAL_FIELDS = ["clientRequestId", "provider", "operation", "model", "unitId", "status", "providerRequestId", "costMicrousd", "inputTokens", "outputTokens", "totalTokens",
  "requestDigest", "reasoningEffort", "maximumOutputTokens", "submittedAt", "responseReceivedAt", "httpRequestId", "completionStatus", "incompleteReason",
  "cachedInputTokens", "cacheWriteInputTokens", "reasoningTokens", "pricingVersion", "textInputCostMicrousd", "textOutputCostMicrousd", "effectiveModel", "routingPhase", "routingVersion", "serviceTier", "cachePolicy", "usageCostBasis", "pricingReceipt", "latencyMs"] as const satisfies readonly (keyof PaidProviderSubmission)[];

export function definitiveProviderRejection(status: number) {
  return [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(status);
}

export function providerSubmissions(checkpoint: Record<string, unknown>): PaidProviderSubmission[] {
  const entries = checkpoint.providerSubmissions;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return [];
  return Object.values(entries).filter((value): value is PaidProviderSubmission => Boolean(value)
    && typeof value === "object" && !Array.isArray(value)
    && typeof (value as PaidProviderSubmission).clientRequestId === "string");
}

export function hasUnresolvedProviderSubmission(checkpoint: Record<string, unknown>) {
  return checkpoint.providerSubmissionLegacyUncertain === true
    || hasUnresolvedModel3dSubmission(checkpoint)
    || invalidProviderSubmissions(checkpoint)
    || providerSubmissions(checkpoint).some((receipt) => receipt.status === "pending");
}

const validRequestId = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value) && !["pending", "submitted", "unknown"].includes(value.toLowerCase());

function knownModel3dRequest(checkpoint: Record<string, unknown>) {
  return validRequestId(checkpoint.providerJobId) || providerSubmissions(checkpoint).some((receipt) =>
    receipt.provider === "fal" && receipt.operation === "model3d" && ["accepted", "completed"].includes(receipt.status)
    && validRequestId(receipt.providerRequestId));
}

/** A legacy 3D pending marker needs a valid accepted request, never a placeholder ID. */
export function hasUnresolvedModel3dSubmission(checkpoint: Record<string, unknown>) {
  return checkpoint.model3dProviderSubmission === "pending" && !knownModel3dRequest(checkpoint);
}

export function invalidProviderSubmissions(checkpoint: Record<string, unknown>) {
  if (!Object.hasOwn(checkpoint, "providerSubmissions")) return false;
  const entries = checkpoint.providerSubmissions;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return true;
  return Object.entries(entries).some(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return true;
    const receipt = value as PaidProviderSubmission;
    return !key || receipt.clientRequestId !== key || !["openai", "fal"].includes(receipt.provider)
      || !["planning", "image", "video", "audio", "model3d"].includes(receipt.operation)
      || typeof receipt.model !== "string" || !receipt.model
      || !["pending", "accepted", "completed", "rejected"].includes(receipt.status)
      || Object.hasOwn(receipt, "costMicrousd") && (!Number.isFinite(receipt.costMicrousd) || Number(receipt.costMicrousd) < 0);
  });
}

/** Acceptance is not settlement; keep incomplete paid work reserved. */
export function hasUnsettledProviderSubmission(checkpoint: Record<string, unknown>) {
  return hasUnresolvedProviderSubmission(checkpoint) || providerSubmissions(checkpoint).some((receipt) =>
    receipt.status === "accepted" || receipt.status === "completed" && !Number.isFinite(receipt.costMicrousd));
}

export function mergeProviderSubmissions(previous: unknown, patch: unknown) {
  const merged = Object.fromEntries(providerSubmissions({ providerSubmissions: previous }).map((receipt) => [receipt.clientRequestId, receipt]));
  const rank = { pending: 0, accepted: 1, completed: 2, rejected: 2 };
  for (const receipt of providerSubmissions({ providerSubmissions: patch })) {
    const existing = merged[receipt.clientRequestId];
    if (existing && (existing.provider !== receipt.provider || existing.operation !== receipt.operation || existing.model !== receipt.model)) throw new Error("provider_submission_identity_changed");
    if (existing?.providerRequestId && receipt.providerRequestId && existing.providerRequestId !== receipt.providerRequestId
      || existing?.unitId && receipt.unitId && existing.unitId !== receipt.unitId) throw new Error("provider_submission_identity_changed");
    for (const key of ["requestDigest", "reasoningEffort", "maximumOutputTokens", "responseRef", "pricingVersion", "routingPhase", "routingVersion", "serviceTier", "cachePolicy", "submittedAt", "responseReceivedAt", "httpRequestId", "completionStatus", "incompleteReason", "usageCostBasis", "latencyMs"] as const) {
      if (existing?.[key] !== undefined && receipt[key] !== undefined && existing[key] !== receipt[key]) throw new Error("provider_submission_evidence_changed");
    }
    if (existing && rank[existing.status] > rank[receipt.status]) continue;
    if (existing && ["completed", "rejected"].includes(existing.status) && existing.status !== receipt.status) throw new Error("provider_submission_terminal_state_changed");
    if (existing && existing.status !== "pending" && receipt.status === "rejected") throw new Error("accepted_provider_submission_cannot_be_rejected");
    if (existing?.status === "completed" && Number.isFinite(existing.costMicrousd) && Number.isFinite(receipt.costMicrousd) && existing.costMicrousd !== receipt.costMicrousd) throw new Error("provider_submission_cost_changed");
    for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningTokens", "textInputCostMicrousd", "textOutputCostMicrousd", "effectiveModel"] as const) {
      if (existing?.status === "completed" && existing[key] !== undefined && receipt[key] !== undefined && existing[key] !== receipt[key]) throw new Error("provider_submission_usage_changed");
    }
    if (existing?.validationStatus && existing.validationStatus !== "pending" && receipt.validationStatus && receipt.validationStatus !== "pending" && (existing.validationStatus !== receipt.validationStatus || existing.validationIssueCount !== undefined && receipt.validationIssueCount !== undefined && existing.validationIssueCount !== receipt.validationIssueCount)) throw new Error("provider_submission_validation_changed");
    if (existing?.pricingReceipt && receipt.pricingReceipt && JSON.stringify(existing.pricingReceipt) !== JSON.stringify(receipt.pricingReceipt)) throw new Error("provider_submission_pricing_changed");
    merged[receipt.clientRequestId] = { ...existing, ...receipt };
    if (existing?.validationStatus && existing.validationStatus !== "pending" && receipt.validationStatus === "pending") {
      merged[receipt.clientRequestId].validationStatus = existing.validationStatus;
      merged[receipt.clientRequestId].validationIssueCount = existing.validationIssueCount;
    }
  }
  return merged;
}

/** The expression is supplied only by server code, never from a request. */
function providerSubmissionProblemSql(resultExpression: string, pendingIsUnresolved: boolean, includeLegacy: boolean) {
  const root=`COALESCE(${resultExpression},'{}')`;
  const entries=`CASE WHEN json_type(${root},'$.providerSubmissions')='object' THEN json_extract(${root},'$.providerSubmissions') ELSE '{}' END`;
  const value="CASE WHEN paid_submission.type='object' THEN paid_submission.value ELSE '{}' END";
  const field=(key:string)=>`json_extract(${value},'$.${key}')`;
  const requestId=(expression:string)=>`(typeof(${expression})='text' AND length(${expression}) BETWEEN 1 AND 200
    AND ${expression} GLOB '[A-Za-z0-9]*' AND ${expression} NOT GLOB '*[^A-Za-z0-9._-]*' AND lower(${expression}) NOT IN ('pending','submitted','unknown'))`;
  const model3dPending=`(json_extract(${root},'$.model3dProviderSubmission')='pending'
    AND NOT COALESCE(${requestId(`json_extract(${root},'$.providerJobId')`)},0)
    AND NOT EXISTS(SELECT 1 FROM json_each(${entries}) paid_submission WHERE paid_submission.type='object'
      AND ${field("provider")}='fal' AND ${field("operation")}='model3d' AND ${field("status")} IN ('accepted','completed')
      AND ${requestId(field("providerRequestId"))}))`;
  // Structural invalidity is separate from unresolved provider/legacy markers.
  return `(${includeLegacy ? `COALESCE(json_extract(COALESCE(${resultExpression},'{}'),'$.providerSubmissionLegacyUncertain'),0)=1 OR COALESCE(${model3dPending},0)=1 OR ` : ""}EXISTS(
    SELECT 1 FROM json_each(${entries}) paid_submission WHERE paid_submission.type!='object'
      OR paid_submission.key='' OR COALESCE(${field("clientRequestId")},'')!=paid_submission.key
      OR COALESCE(${field("provider")},'') NOT IN ('openai','fal')
      OR COALESCE(${field("operation")},'') NOT IN ('planning','image','video','audio','model3d')
      OR COALESCE(json_type(${value},'$.model'),'null')!='text' OR COALESCE(${field("model")},'')=''
      OR COALESCE(${field("status")},'') NOT IN (${pendingIsUnresolved ? "'accepted','completed','rejected'" : "'pending','accepted','completed','rejected'"})
      OR json_type(${value},'$.costMicrousd') IS NOT NULL AND (json_type(${value},'$.costMicrousd') NOT IN ('integer','real') OR ${field("costMicrousd")}<0))
    OR COALESCE(json_type(${root},'$.providerSubmissions'),'object')!='object')`;
}

export function unresolvedProviderSubmissionSql(resultExpression = "result_json") {
  return providerSubmissionProblemSql(resultExpression, true, true);
}

export function invalidProviderSubmissionSql(resultExpression = "result_json") {
  return providerSubmissionProblemSql(resultExpression, false, false);
}

export function unsettledProviderSubmissionSql(resultExpression = "result_json") {
  const entries=`CASE WHEN json_type(COALESCE(${resultExpression},'{}'),'$.providerSubmissions')='object' THEN json_extract(${resultExpression},'$.providerSubmissions') ELSE '{}' END`;
  const value="CASE WHEN paid_submission.type='object' THEN paid_submission.value ELSE '{}' END";
  return `(${unresolvedProviderSubmissionSql(resultExpression)} OR EXISTS(
    SELECT 1 FROM json_each(${entries}) paid_submission
    WHERE json_extract(${value},'$.status')='accepted'
      OR json_extract(${value},'$.status')='completed' AND COALESCE(json_type(${value},'$.costMicrousd'),'null') NOT IN ('integer','real')))`;
}

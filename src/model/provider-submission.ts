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
};

export type PaidProviderSubmissionObserver = (receipt: PaidProviderSubmission) => void | Promise<void>;

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
    || checkpoint.model3dProviderSubmission === "pending" && !knownModel3dRequest(checkpoint)
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
    if (existing && rank[existing.status] > rank[receipt.status]) continue;
    if (existing && ["completed", "rejected"].includes(existing.status) && existing.status !== receipt.status) throw new Error("provider_submission_terminal_state_changed");
    if (existing && existing.status !== "pending" && receipt.status === "rejected") throw new Error("accepted_provider_submission_cannot_be_rejected");
    if (existing?.status === "completed" && Number.isFinite(existing.costMicrousd) && Number.isFinite(receipt.costMicrousd) && existing.costMicrousd !== receipt.costMicrousd) throw new Error("provider_submission_cost_changed");
    merged[receipt.clientRequestId] = { ...existing, ...receipt };
  }
  return merged;
}

/** The expression is supplied only by server code, never from a request. */
export function unresolvedProviderSubmissionSql(resultExpression = "result_json") {
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
  return `(COALESCE(json_extract(COALESCE(${resultExpression},'{}'),'$.providerSubmissionLegacyUncertain'),0)=1 OR COALESCE(${model3dPending},0)=1 OR EXISTS(
    SELECT 1 FROM json_each(${entries}) paid_submission WHERE paid_submission.type!='object'
      OR paid_submission.key='' OR COALESCE(${field("clientRequestId")},'')!=paid_submission.key
      OR COALESCE(${field("provider")},'') NOT IN ('openai','fal')
      OR COALESCE(${field("operation")},'') NOT IN ('planning','image','video','audio','model3d')
      OR COALESCE(json_type(${value},'$.model'),'null')!='text' OR COALESCE(${field("model")},'')=''
      OR COALESCE(${field("status")},'') NOT IN ('accepted','completed','rejected')
      OR json_type(${value},'$.costMicrousd') IS NOT NULL AND (json_type(${value},'$.costMicrousd') NOT IN ('integer','real') OR ${field("costMicrousd")}<0))
    OR COALESCE(json_type(${root},'$.providerSubmissions'),'object')!='object')`;
}

export function unsettledProviderSubmissionSql(resultExpression = "result_json") {
  const entries=`CASE WHEN json_type(COALESCE(${resultExpression},'{}'),'$.providerSubmissions')='object' THEN json_extract(${resultExpression},'$.providerSubmissions') ELSE '{}' END`;
  const value="CASE WHEN paid_submission.type='object' THEN paid_submission.value ELSE '{}' END";
  return `(${unresolvedProviderSubmissionSql(resultExpression)} OR EXISTS(
    SELECT 1 FROM json_each(${entries}) paid_submission
    WHERE json_extract(${value},'$.status')='accepted'
      OR json_extract(${value},'$.status')='completed' AND COALESCE(json_type(${value},'$.costMicrousd'),'null') NOT IN ('integer','real')))`;
}

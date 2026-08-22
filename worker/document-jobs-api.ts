import { handleEvents } from "./events-api";
import { adoptLegacyCostReservation, costBudgetReservation, loadPrivateContent, readCostBudgets, reconcileFailedBudgetReservations, releaseBudgetReservationsForCorrelation, releaseCostBudget, releaseCostReservationsForCorrelation, requireConsent, requireUser, settleCostBudget, storePrivateContent, type PilotUser } from "./pilot-policy";
import { appendAuditEvent, ensureSchema, readCorrelatedEvents, readWorkspaceEvents, streamHead, uuidV7, type WorkerEnv, type WorkerExecutionContext } from "./runtime";
import { foldEvents } from "../src/model/events";
import {
  DOCUMENT_JOB_HEARTBEAT_MS,
  DOCUMENT_JOB_LEASE_MS,
  DOCUMENT_JOB_STALE_AFTER_MS,
  documentGenerationRequestKey,
  documentGenerationRevision,
  documentJobIsStale,
  documentJobCanRecoverProviderRender,
  documentJobTerminal,
  documentJobMaxAttempts,
  type DocumentJobError,
  type DocumentJobKind,
  type DocumentJobStatus,
} from "../src/model/document-jobs";
import { normalizePromptTechnique, PROMPT_TECHNIQUES, type PromptTechnique } from "../src/model/prompt-structures";
import { applicationFailureDetail, classifyProviderFailure, publicFailureDetail, type ProviderFailureDetail } from "./provider-errors";
import { documentJobCompletionBindings } from "./document-job-sql";
import { preflightGeneration } from "./generation-readiness";
import { DEFAULT_REFERENCE_VIDEO_MODEL, normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter";
import { estimatePlannerOperationMicrousd, generationBudgetGate } from "../src/model/generation-budget";
import { buildManagedProductionPlan } from "../src/model/managed-production";

type DocumentJobRow = {
  job_id: string; owner_id: string; stream_id: string; document_id: string; kind: DocumentJobKind; status: DocumentJobStatus;
  source_surface: string; correlation_id: string; requested_sequence: number; request_json: string; result_json: string | null;
  error_message: string | null; attempt_count: number; requested_at: string; started_at: string | null; completed_at: string | null;
  lease_expires_at: string | null; notified_at: string | null; expires_at: string; updated_at: string;
};

const KINDS = new Set<DocumentJobKind>(["preview", "generate", "prompt_fan", "chat", "structure_adaptive", "extract_reference", "render_document"]);
const MAX_PAYLOAD_BYTES = 750_000;

function parseResult(row: Pick<DocumentJobRow, "result_json">) {
  try { return row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : {}; } catch { return {}; }
}

function parseRequest(row: Pick<DocumentJobRow, "request_json">) {
  try { return row.request_json ? JSON.parse(row.request_json) as Record<string, unknown> : {}; } catch { return {}; }
}

function generationRevisionFromRequest(request: Record<string, unknown>, documentId: string) {
  return String(request.documentRevision || documentGenerationRevision({ snapshot: request.snapshot ?? {}, sourceBlockVersions: request.sourceBlockVersions ?? [], documentId }));
}

function generationRequestIdentity(kind: DocumentJobKind, request: Record<string, unknown>, documentId: string) {
  const documentRevision = generationRevisionFromRequest(request, documentId);
  const sourcePreviewId = typeof request.sourcePreviewId === "string" && request.sourcePreviewId ? request.sourcePreviewId : null;
  const promptTechnique = normalizePromptTechnique(request.promptTechnique); const promptFanId = typeof request.promptFanId === "string" && request.promptFanId ? request.promptFanId : null;
  const requestKey = kind === "preview" || kind === "generate" ? String(request.requestKey || documentGenerationRequestKey(kind, documentRevision, sourcePreviewId, promptTechnique, promptFanId)) : kind === "prompt_fan" ? String(request.requestKey ?? "") : "";
  return { documentRevision, requestKey, sourcePreviewId, promptTechnique, promptFanId };
}

function parentJobIdFromRequest(request: Record<string, unknown>) {
  return typeof request.parentJobId === "string" && request.parentJobId ? request.parentJobId : null;
}

function fanKindFromRequest(request: Record<string, unknown>): "preview" | "generate" | null {
  return request.fanKind === "preview" || request.fanKind === "generate" ? request.fanKind : null;
}

function errorDetailFromResult(result: Record<string, unknown>): DocumentJobError | null {
  const value = result.errorDetail;
  if (!value || typeof value !== "object") return null;
  const detail = value as Record<string, unknown>;
  return {
    code: String(detail.code ?? "operation_failed"), category: String(detail.category ?? "unknown") as DocumentJobError["category"],
    scope: String(detail.scope ?? "unknown") as DocumentJobError["scope"], action: String(detail.action ?? "none") as DocumentJobError["action"],
    message: String(detail.message ?? "The operation failed."), retryable: Boolean(detail.retryable), retryAfterMs: detail.retryAfterMs === null || detail.retryAfterMs === undefined || !Number.isFinite(Number(detail.retryAfterMs)) ? null : Number(detail.retryAfterMs),
    requestId: detail.requestId ? String(detail.requestId) : null, httpStatus: detail.httpStatus === null || detail.httpStatus === undefined || !Number.isFinite(Number(detail.httpStatus)) ? null : Number(detail.httpStatus),
    riskCategories: Array.isArray(detail.riskCategories) ? detail.riskCategories.map(String) : [], contributingBlockIds: Array.isArray(detail.contributingBlockIds) ? detail.contributingBlockIds.map(String) : [], contributingReferenceIds: Array.isArray(detail.contributingReferenceIds) ? detail.contributingReferenceIds.map(String) : [], probe: detail.probe ? String(detail.probe) : null,
  };
}

function failureProgressMessage(detail: ProviderFailureDetail | DocumentJobError | null) {
  if (!detail) return "The operation failed.";
  if (detail.category === "safety") return detail.riskCategories?.includes("audio-copyright") || /\baudio\b.*\bcopyright\b/i.test(detail.message)
    ? "The provider rejected generated audio. Start a silent video instead of recovering the rejected render."
    : "Safety checks stopped this generation. Change the request or reference before retrying.";
  if (detail.action === "review_budget") return detail.scope === "workspace" ? "The workspace generation budget is exhausted." : "Your generation budget is exhausted.";
  if (detail.category === "quota") return `The OpenAI ${detail.scope === "project" || detail.scope === "organization" ? detail.scope : "account"} limit prevents generation.`;
  if (detail.category === "authentication") return "The configured OpenAI credential was rejected.";
  if (detail.category === "access") return "The configured credential cannot access this OpenAI project or model.";
  if (detail.category === "rate_limit") return "OpenAI remained rate limited after automatic backoff.";
  if (detail.category === "network" || detail.category === "server") return "The provider connection ended before an image was returned.";
  return detail.message || "The operation failed.";
}

async function finishDocumentJob(env: WorkerEnv, row: DocumentJobRow, status: "completed" | "failed", result: Record<string, unknown>, errorMessage: string | null, completedAt = new Date().toISOString(), guardActive = true) {
  const parentId = parentJobIdFromRequest(parseRequest(row));
  const bindings = documentJobCompletionBindings({ status, result, errorMessage, completedAt, parentId, jobId: row.job_id, ownerId: row.owner_id, correlationId: row.correlation_id });
  const statement = guardActive
    ? "UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status IN ('running','committing')"
    : "UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=?";
  return env.DB.prepare(statement).bind(...bindings).run();
}

function queueRecoveryPresentation(row: DocumentJobRow, recoveryBlocker: DocumentJobRow | null) {
  if (!recoveryBlocker) return null;
  if (row.job_id === recoveryBlocker.job_id) return {
    stage: "recovering",
    progressMessage: "The server is recovering this interrupted operation before continuing the queue.",
  };
  if (row.status === "queued") return {
    stage: "queue-recovery",
    progressMessage: "An earlier operation lost contact. The server is recovering it before this render starts.",
  };
  return null;
}

function serializeJob(row: DocumentJobRow, recoveryBlocker: DocumentJobRow | null = null, detail = true) {
  const parsed = parseResult(row); const result = row.result_json ? parsed : null; const request = parseRequest(row); const identity = generationRequestIdentity(row.kind, request, row.document_id);
  const members = Array.isArray(parsed.members) ? parsed.members : [];
  const recovery = queueRecoveryPresentation(row, recoveryBlocker);
  const visibleResult = row.kind === "render_document" && request.artifactKind
    ? { ...(result ?? {}), artifactKind: String(parsed.artifactKind ?? request.artifactKind) }
    : result;
  const summarizedResult = detail || !visibleResult ? visibleResult
    : Object.fromEntries(Object.entries(visibleResult).filter(([key]) => !["plannerInput", "videoInputReceipt", "artifactPlan"].includes(key)));
  return {
    jobId: row.job_id, documentId: row.document_id, kind: row.kind, status: row.status, sourceSurface: row.source_surface,
    requestedSequence: Number(row.requested_sequence), documentRevision: identity.documentRevision, requestKey: identity.requestKey, sourcePreviewId: identity.sourcePreviewId, productionMode:request.productionMode==="managed"?"managed" as const:"manual" as const, promptTechnique: identity.promptTechnique, promptFanId: identity.promptFanId,
    parentJobId: parentJobIdFromRequest(request), fanKind: fanKindFromRequest(request), members, result: summarizedResult, error: row.error_message, errorDetail: errorDetailFromResult(parsed), moderationPromptRef: parsed.moderationPromptRef ? String(parsed.moderationPromptRef) : null, dismissedAt: parsed.dismissedAt ? String(parsed.dismissedAt) : null, attemptCount: Number(row.attempt_count),
    requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at, notifiedAt: row.notified_at,
    leaseExpiresAt: row.lease_expires_at, updatedAt: row.updated_at,
    stage: recovery?.stage ?? String(parsed.stage ?? row.status), progressMessage: recovery?.progressMessage ?? String(parsed.progressMessage ?? ""),
  };
}

async function reconcilePromptFanParent(env: WorkerEnv, ownerId: string, parentId: string) {
  const parent = await readJob(env, ownerId, parentId); if (!parent || parent.kind !== "prompt_fan") return parent;
  if (parent.status === "canceled" || errorDetailFromResult(parseResult(parent))?.code === "force_failed_by_admin") return parent;
  const request = parseRequest(parent); const childIds = Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean).slice(0, 4) : [];
  const childRows=childIds.length?(await env.DB.prepare(`SELECT * FROM document_jobs WHERE owner_id=? AND job_id IN (${childIds.map(()=>"?").join(",")})`).bind(ownerId,...childIds).all<DocumentJobRow>()).results:[];
  const childrenById=new Map(childRows.map((row)=>[row.job_id,row]));
  const children=childIds.map((jobId)=>childrenById.get(jobId)).filter((row):row is DocumentJobRow=>Boolean(row));
  const members = children.map((child) => {
    const childRequest = parseRequest(child); const childResult = parseResult(child);
    return { jobId: child.job_id, promptTechnique: normalizePromptTechnique(childRequest.promptTechnique), status: child.status, error: errorDetailFromResult(childResult), moderationPromptRef: childResult.moderationPromptRef ? String(childResult.moderationPromptRef) : null, attemptCount: Number(child.attempt_count), updatedAt: child.updated_at };
  });
  const terminal = children.filter((child) => documentJobTerminal(child)); const succeeded = terminal.filter((child) => child.status === "completed").length; const canceled = terminal.filter((child) => child.status === "canceled").length; const failed = terminal.length - succeeded - canceled;
  const status: DocumentJobStatus = terminal.length === childIds.length && childIds.length > 0 ? canceled === childIds.length ? "canceled" : failed + canceled === 0 ? "completed" : succeeded > 0 ? "partial" : "failed" : children.some((child) => child.status === "running" || child.status === "committing") || terminal.length > 0 ? "running" : "queued";
  const now = new Date().toISOString(); const completedAt = documentJobTerminal({ status }) ? parent.completed_at ?? now : null;
  const progressMessage = status === "completed" ? "All four prompt approaches finished." : status === "canceled" ? "The fan generation was stopped." : status === "partial" ? `${succeeded} of 4 images finished; ${failed + canceled} did not finish.` : status === "failed" ? "All four prompt approaches failed or were stopped." : `${terminal.length} of 4 prompt approaches finished.`;
  const result = { ...parseResult(parent), stage: status, progressMessage, members, completedCount: succeeded, failedCount: failed, canceledCount: canceled, totalCount: childIds.length };
  const resultJson = JSON.stringify(result); const errorMessage = status === "partial" ? "prompt_fan_partial_failure" : status === "failed" ? "prompt_fan_failed" : null;
  if (parent.status === status && parent.result_json === resultJson && parent.error_message === errorMessage && parent.completed_at === completedAt) return parent;
  await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,updated_at=? WHERE job_id=? AND owner_id=?").bind(status, resultJson, errorMessage, completedAt, now, parentId, ownerId).run();
  return readJob(env, ownerId, parentId);
}

async function reconcileParentForChild(env: WorkerEnv, row: DocumentJobRow) {
  const parentId = parentJobIdFromRequest(parseRequest(row));
  if (parentId) await reconcilePromptFanParent(env, row.owner_id, parentId);
}

async function readJob(env: WorkerEnv, ownerId: string, jobId: string) {
  return env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=?").bind(jobId, ownerId).first<DocumentJobRow>();
}

function rowIsStale(row: DocumentJobRow, now = Date.now()) {
  return documentJobIsStale({ status: row.status, leaseExpiresAt: row.lease_expires_at, updatedAt: row.updated_at }, now);
}

async function updateJobProgress(env: WorkerEnv, row: DocumentJobRow, stage: string, progressMessage: string, patch:Record<string,unknown>={}) {
  const updatedAt = new Date().toISOString(); const result = { ...parseResult(row), stage, progressMessage, ...patch };
  await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=?").bind(JSON.stringify(result), updatedAt, row.job_id, row.owner_id, row.correlation_id).run();
  row.result_json = JSON.stringify(result); row.updated_at = updatedAt;
}

async function renewJobLease(env: WorkerEnv, row: DocumentJobRow) {
  const now = new Date(); const leaseExpiresAt = new Date(now.getTime() + DOCUMENT_JOB_LEASE_MS).toISOString();
  const result = await env.DB.prepare("UPDATE document_jobs SET lease_expires_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND status IN ('running','committing') AND correlation_id=?").bind(leaseExpiresAt, now.toISOString(), row.job_id, row.owner_id, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error("document_job_lease_lost");
  row.lease_expires_at = leaseExpiresAt; row.updated_at = now.toISOString();
}

async function beginJobCommit(env: WorkerEnv, row: DocumentJobRow) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE document_jobs SET status='committing',updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status='running'").bind(now, row.job_id, row.owner_id, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error("document_job_canceled");
  row.status = "committing"; row.updated_at = now;
}

async function runWithHeartbeat<T>(env: WorkerEnv, row: DocumentJobRow, operation: (control: { signal: AbortSignal; beginCommit: () => Promise<void>; progress: (stage:string,message:string,patch?:Record<string,unknown>) => Promise<void> }) => Promise<T>) {
  let settled = false; let value: T | undefined; let failure: unknown;
  const controller = new AbortController(); let commitStarted = false;
  const execution = operation({ signal: controller.signal, beginCommit: async () => { if (commitStarted) return; await updateJobProgress(env,row,"saving","Saving the provider result and its durable receipt.");await beginJobCommit(env, row); commitStarted = true; }, progress: async(stage,message,patch)=>{if(!commitStarted)await updateJobProgress(env,row,stage,message,patch);} }).then((result) => { value = result; settled = true; }, (error) => { failure = error; settled = true; });
  while (!settled) {
    await Promise.race([execution, new Promise<void>((resolve) => setTimeout(resolve, DOCUMENT_JOB_HEARTBEAT_MS))]);
    if (!settled) try { await renewJobLease(env, row); } catch (error) { controller.abort("document_job_canceled"); failure = error; await execution; }
  }
  if (failure !== undefined) throw failure;
  return value as T;
}

async function restoreLegacyCostReservation(env: WorkerEnv, user: PilotUser, row: DocumentJobRow, events: Awaited<ReturnType<typeof readCorrelatedEvents>>) {
  const checkpoint = parseResult(row);
  const existingId = String(checkpoint.costReservationId ?? "");
  const ownerId = user.billingUserId ?? user.userId;
  if (existingId && await costBudgetReservation(env, ownerId, existingId)) return existingId;
  const evidence = [...events].reverse().find((event) => event.type === "BudgetReserved" && Number(event.payload.reserved_microusd ?? 0) > 0);
  if (!evidence) return "";
  const reservationId = String(evidence.payload.cost_reservation_id ?? checkpoint.costReservationId ?? `legacy-cost:${String(evidence.payload.reservation_id ?? evidence.eventId)}`);
  await adoptLegacyCostReservation(env, ownerId, {
    reservationId,
    amountMicrousd: Number(evidence.payload.reserved_microusd),
    period: String(evidence.payload.period ?? checkpoint.costReservationPeriod ?? evidence.occurredAt.slice(0, 7)),
    streamId: user.streamId,
    correlationId: row.correlation_id,
    operation: String(evidence.payload.operation ?? `document-render:${parseRequest(row).artifactKind ?? "unknown"}`),
  });
  return reservationId;
}

async function releaseInterruptedAttempt(env: WorkerEnv, user: PilotUser, row: DocumentJobRow, reason: string) {
  const released=await releaseBudgetReservationsForCorrelation(env,user,row.correlation_id,reason);
  const checkpoint=parseResult(row);const activeSceneReceipts=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});const activeFrameReceipts=Object.values(checkpoint.productionFrameReceipts&&typeof checkpoint.productionFrameReceipts==="object"?checkpoint.productionFrameReceipts as Record<string,Record<string,unknown>>:{});const hasPaidProvider=Boolean(checkpoint.providerJobId)||activeSceneReceipts.some((receipt)=>receipt.status==="submitted"||receipt.status==="completed")||activeFrameReceipts.length>0;const events=await readCorrelatedEvents(env,user.streamId,[row.correlation_id]);await restoreLegacyCostReservation(env,user,row,events);if(!hasPaidProvider){const settled=events.some((event)=>event.type==="GenerationUsageRecorded");if(!settled)await releaseCostReservationsForCorrelation(env,user.billingUserId??user.userId,row.correlation_id);}
  try {
    await appendAuditEvent(env, user.streamId, "worker:scheduler", "JobAttemptInterrupted", { job_id: row.job_id, document_id: row.document_id, kind: row.kind, attempt: row.attempt_count, reason, released_reservation_count: released.length }, row.correlation_id);
    for (const reservation of released) await appendAuditEvent(env, user.streamId, "worker:policy", "BudgetReleased", { reservation_id: reservation.id, reserved_tokens: reservation.tokens, reason, operation: reservation.operation, job_id: row.job_id, attempt: row.attempt_count }, row.correlation_id);
  } catch (error) { console.error("document_job_interruption_audit_failed", row.job_id, error instanceof Error ? error.message : "unknown"); }
}

async function failStaleJob(env: WorkerEnv, user: PilotUser, row: DocumentJobRow) {
  const now = new Date().toISOString();
  const errorDetail = { code: "execution_interrupted", category: "server", message: "The server lost contact with this operation before it finished.", retryable: false, requestId: null, httpStatus: null };
  const parentId = parentJobIdFromRequest(parseRequest(row));
  const result = await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message='execution_interrupted',completed_at=?,lease_expires_at=NULL,result_json=?,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND status IN ('running','committing') AND correlation_id=?").bind(now, JSON.stringify({ ...parseResult(row), errorDetail, stage: "failed", progressMessage: errorDetail.message }), parentId, now, now, row.job_id, user.userId, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) === 1) { await releaseInterruptedAttempt(env, user, row, "execution_interrupted"); await reconcileParentForChild(env, row); }
}

function operationFinished(events: Awaited<ReturnType<typeof readWorkspaceEvents>>, row: DocumentJobRow) {
  const correlated = events.filter((event) => event.correlationId === row.correlation_id);
  const terminal = correlated.find((event) => {
    if (row.kind === "preview") return event.type === "IdeationPreviewCompleted" || event.type === "GenerationFailed";
    if (row.kind === "generate") return event.type === "GenerationCompleted" || event.type === "GenerationFailed";
    if (row.kind === "chat") return event.type === "GenerationUsageRecorded" && event.payload.operation === "creative-chat" || event.type === "BudgetReleased" && event.payload.operation === "creative-chat";
    if (row.kind === "structure_adaptive") return event.type === "GenerationUsageRecorded" && event.payload.operation === "adaptive-structure" || event.type === "BudgetReleased" && event.payload.operation === "adaptive-structure";
    if (row.kind === "render_document") return event.type === "DocumentRenderCompleted" || event.type === "DocumentRenderFailed";
    return event.type === "ExtractionCompleted" || event.type === "ExtractionFailed";
  });
  const failed = terminal?.type === "GenerationFailed" || terminal?.type === "ExtractionFailed" || terminal?.type === "DocumentRenderFailed" || terminal?.type === "BudgetReleased";
  return terminal ? { failed, correlated } : null;
}

function correlatedFailureDetail(events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  const failureEvent = [...events].reverse().find((event) => event.type === "GenerationFailed" || event.type === "ExtractionFailed" || event.type === "DocumentRenderFailed");
  if (!failureEvent) return null;
  const payload = failureEvent.payload;
  return {
    code: String(payload.error_code ?? payload.error_class ?? "operation_failed"), category: String(payload.error_category ?? "unknown") as DocumentJobError["category"],
    scope: String(payload.error_scope ?? "unknown") as DocumentJobError["scope"], action: String(payload.error_action ?? "none") as DocumentJobError["action"],
    message: String(payload.error_message ?? "The operation failed."), retryable: Boolean(payload.retryable),
    retryAfterMs: payload.retry_after_ms === null || payload.retry_after_ms === undefined || !Number.isFinite(Number(payload.retry_after_ms)) ? null : Number(payload.retry_after_ms),
    requestId: payload.provider_request_id ? String(payload.provider_request_id) : null,
    httpStatus: payload.http_status === null || payload.http_status === undefined || !Number.isFinite(Number(payload.http_status)) ? null : Number(payload.http_status),
    riskCategories: Array.isArray(payload.risk_categories) ? payload.risk_categories.map(String) : [], contributingBlockIds: Array.isArray(payload.contributing_block_ids) ? payload.contributing_block_ids.map(String) : [], contributingReferenceIds: Array.isArray(payload.contributing_reference_ids) ? payload.contributing_reference_ids.map(String) : [], probe: payload.preflight_probe ? String(payload.preflight_probe) : null,
  } satisfies DocumentJobError;
}

function correlatedModerationPromptRef(events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  const failureEvent=[...events].reverse().find((event)=>(event.type==="GenerationFailed"||event.type==="DocumentRenderFailed")&&event.payload.prompt_ref);
  return failureEvent?.payload.prompt_ref?String(failureEvent.payload.prompt_ref):null;
}

async function repairMisreportedTerminalJob(env: WorkerEnv, row: DocumentJobRow, events: Awaited<ReturnType<typeof readWorkspaceEvents>>) {
  if (row.status !== "failed" || !/Wrong number of parameter bindings/i.test(row.error_message ?? "")) return false;
  const finished = operationFinished(events, row); if (!finished) return false;
  const detail = finished.failed ? correlatedFailureDetail(finished.correlated) : null;
  const status = finished.failed ? "failed" : "completed";
  const moderationPromptRef=finished.failed?correlatedModerationPromptRef(finished.correlated):null;
  const result = { ...parseResult(row), ...(detail ? { errorDetail: detail } : {}), ...(moderationPromptRef?{moderationPromptRef}:{}), stage: status, progressMessage: finished.failed ? failureProgressMessage(detail) : "The operation finished." };
  await finishDocumentJob(env, row, status, result, detail?.message ?? (finished.failed ? "operation_failed" : null), row.completed_at ?? new Date().toISOString(), false);
  return true;
}

function safeResult(body: Record<string, unknown>, correlatedEventIds: string[] = []) {
  const appended = Array.isArray(body.appended) ? body.appended as Array<Record<string, unknown>> : [];
  const adaptiveReasoning = appended.find((event) => event.type === "AssistantReasoned" && (event.payload as Record<string, unknown> | undefined)?.operation === "adaptive-structure");
  const adaptivePayload = adaptiveReasoning?.payload as Record<string, unknown> | undefined;
  return {
    head: Number(body.head ?? 0),
    appendedEventIds: appended.map((event) => String(event.eventId ?? "")).filter(Boolean).concat(correlatedEventIds),
    previewed: Boolean(body.previewed), previewQueued: Boolean(body.previewQueued), previewSuppressed: Boolean(body.previewSuppressed), followupJobId: body.followupJobId ? String(body.followupJobId) : undefined, moderationPromptRef: body.moderationPromptRef ? String(body.moderationPromptRef) : undefined, promoted: Boolean(body.promoted), quality: body.quality ? String(body.quality) : undefined,
    artifactId: body.artifactId ? String(body.artifactId) : undefined, artifactKind: body.artifactKind ? String(body.artifactKind) : undefined,
    providerJobId: body.providerJobId ? String(body.providerJobId) : undefined, provider: body.provider ? String(body.provider) : undefined,
    intentRef: adaptivePayload?.intent_ref ? String(adaptivePayload.intent_ref) : undefined,
    structure: body.structure && typeof body.structure === "object" ? body.structure : undefined,
  };
}

async function queueFollowupPreview(env:WorkerEnv,user:PilotUser,parent:DocumentJobRow,spec:Record<string,unknown>){
  if(spec.kind!=="preview"||String(spec.documentId??"")!==parent.document_id)return null;const payload=spec.payload&&typeof spec.payload==="object"?{...(spec.payload as Record<string,unknown>)}:{};if(!payload.directionRef||JSON.stringify(payload).length>MAX_PAYLOAD_BYTES)return null;
  const requestedAt=new Date();const now=requestedAt.toISOString();const configuredRetention=Number(env.FORMA_RETENTION_DAYS??30);const retentionDays=Number.isFinite(configuredRetention)&&configuredRetention>0?configuredRetention:30;const expiresAt=new Date(requestedAt.getTime()+retentionDays*86_400_000).toISOString();const jobId=uuidV7();const sourceSurface=String(spec.sourceSurface??"chat").slice(0,80)||"chat";const requestedSequence=await streamHead(env,user.streamId);
  payload.documentRevision=`chat-${parent.job_id}`;payload.promptTechnique=normalizePromptTechnique(payload.promptTechnique);payload.requestKey=documentGenerationRequestKey("preview",String(payload.documentRevision),null,String(payload.promptTechnique));
  await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message='superseded_by_newer_chat_preview',completed_at=?,notified_at=?,updated_at=? WHERE owner_id=? AND document_id=? AND kind='preview' AND source_surface='chat' AND status='queued'").bind(now,now,now,user.userId,parent.document_id).run();
  await env.DB.prepare("INSERT INTO document_jobs (job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?,NULL,NULL,0,?,NULL,NULL,NULL,NULL,?,?)").bind(jobId,user.userId,user.streamId,parent.document_id,"preview",sourceSurface,jobId,requestedSequence,JSON.stringify(payload),now,expiresAt,now).run();return readJob(env,user.userId,jobId);
}

export async function runDocumentJob(env: WorkerEnv, user: PilotUser, jobId: string) {
  await ensureSchema(env);
  let row = await readJob(env, user.userId, jobId); if (!row) return row;
  if (row.kind === "prompt_fan") return reconcilePromptFanParent(env, user.userId, row.job_id);
  if (documentJobTerminal({ status: row.status })) return row;

  const existingEvents = await readCorrelatedEvents(env, user.streamId, [row.correlation_id]);
  const finished = operationFinished(existingEvents, row);
  if (finished) {
    const now = new Date().toISOString(); const status: DocumentJobStatus = finished.failed ? "failed" : "completed";let followup:DocumentJobRow|null=null;
    if(!finished.failed&&row.kind==="chat"){const reasoned=finished.correlated.find((event)=>event.type==="AssistantReasoned"&&event.payload.preview_queued&&event.payload.preview_direction_ref);if(reasoned)followup=await queueFollowupPreview(env,user,row,{kind:"preview",documentId:row.document_id,sourceSurface:"chat",payload:{directionRef:reasoned.payload.preview_direction_ref,directionModel:reasoned.payload.model_id,sourceChatTurnId:reasoned.payload.turn_id}});}
    const failureDetail = finished.failed ? correlatedFailureDetail(finished.correlated) : null;const moderationPromptRef=finished.failed?correlatedModerationPromptRef(finished.correlated):null;
    const result = { ...(finished.failed ? parseResult(row) : {}), ...safeResult({ head: await streamHead(env,user.streamId),previewQueued:Boolean(followup),followupJobId:followup?.job_id,moderationPromptRef }, finished.correlated.map((event) => event.eventId)), ...(failureDetail ? { errorDetail: failureDetail } : {}), stage: status, progressMessage: finished.failed ? failureProgressMessage(failureDetail) : "The operation finished." };
    await finishDocumentJob(env, row, status, result, failureDetail?.message ?? (finished.failed ? "operation_failed" : null), now, false);
    await reconcileParentForChild(env, row);
    return readJob(env, user.userId, jobId);
  }

  const blocker = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status IN ('queued','running','committing') AND (requested_at<? OR (requested_at=? AND job_id<?)) ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId, row.requested_at, row.requested_at, row.job_id).first<{ job_id: string }>();
  if (blocker) return row;
  if (row.status === "running" && !rowIsStale(row)) return row;
  if (row.status === "running" && row.attempt_count >= documentJobMaxAttempts(row.kind)) { await failStaleJob(env, user, row); return readJob(env, user.userId, jobId); }

  const previousAttempt = row.attempt_count; const previousRow = { ...row }; const attempt = previousAttempt + 1;
  const now = new Date(); const nowIso = now.toISOString(); const staleBefore = new Date(now.getTime() - DOCUMENT_JOB_STALE_AFTER_MS).toISOString(); const leaseExpiresAt = new Date(now.getTime() + DOCUMENT_JOB_LEASE_MS).toISOString();
  const attemptCorrelationId = `${jobId}:attempt:${attempt}`; const initialResult = { ...parseResult(row), stage: "preparing", progressMessage: attempt > 1 ? "Recovering the interrupted operation." : "Preparing the document context." };
  const claimed = await env.DB.prepare("UPDATE document_jobs SET status='running',attempt_count=attempt_count+1,correlation_id=?,started_at=COALESCE(started_at,?),lease_expires_at=?,result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND (status='queued' OR (status='running' AND (lease_expires_at<? OR updated_at<?)))").bind(attemptCorrelationId, nowIso, leaseExpiresAt, JSON.stringify(initialResult), nowIso, jobId, user.userId, nowIso, staleBefore).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) return readJob(env, user.userId, jobId);
  if (previousAttempt > 0 && !(row.kind === "render_document" && (parseResult(previousRow).providerJobId||parseResult(previousRow).productionSceneReceipts))) await releaseInterruptedAttempt(env, user, previousRow, "execution_interrupted_retrying");
  row = await readJob(env, user.userId, jobId); if (!row) return null;

  try {
    const payload = JSON.parse(row.request_json) as Record<string, unknown>;
    const inputRef = String(payload.jobInputRef ?? "");
    if (inputRef) {
      const privateContent = await loadPrivateContent(env, user.userId, row.kind === "chat" ? "chat" : "all"); const input = privateContent[inputRef];
      if (typeof input !== "string") throw new Error("job_input_expired");
      if (row.kind === "chat") payload.message = input;
      if (row.kind === "structure_adaptive") payload.prompt = input;
    }
    delete payload.expectedSequence; delete payload.jobInputRef;
    if(row.kind==="render_document"){
      const checkpoint=parseResult(row);for(const key of ["artifactId","providerJobId","providerModel","providerStatusUrl","providerResponseUrl","providerCancelUrl","artifactPlan","plannerModel","plannerResponseId","plannerLatencyMs","plannerUsage","plannerInput","renderedItems","videoInputReceipt","productionPlan","productionSceneReceipts","productionFrameReceipts","productionPrepaidSceneIds","prepaidProviderCostMicrousd","productionAnchor","costReservationMicrousd","costReservationId","costReservationPeriod"] as const)if(checkpoint[key]!==undefined)payload[key]=checkpoint[key];if((checkpoint.providerJobId||checkpoint.productionSceneReceipts||checkpoint.productionFrameReceipts)&&checkpoint.reservationId)payload.reservationId=checkpoint.reservationId;
    }
    payload.action = row.kind; payload.documentId = row.document_id; payload.sourceSurface = row.source_surface;
    payload.correlationId = row.correlation_id; payload.clientId = `server:document-job:${row.kind}`;
    await updateJobProgress(env, row, "compiling", row.kind === "preview" || row.kind === "generate" ? "Compiling the checked document state for generation." : row.kind==="render_document"?"Compiling the document into the requested artifact.":"Processing the requested document change.");
    const response = await runWithHeartbeat(env, row, (control) => handleEvents(new Request("http://document-job.local/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: control.signal }), env, false, user, control));
    const body = await response.json() as Record<string, unknown>;let followup:DocumentJobRow|null=null;if(response.ok&&body.followupJob&&typeof body.followupJob==="object")followup=await queueFollowupPreview(env,user,row,body.followupJob as Record<string,unknown>);const completedAt = new Date().toISOString();
    const detail = !response.ok
      ? body.errorDetail && typeof body.errorDetail === "object" ? body.errorDetail as ProviderFailureDetail : applicationFailureDetail(String(body.error ?? "document_job_failed"), body.scope, response.status)
      : null;
    const durableCheckpoint = response.ok?{}:parseResult(row);
    if (!response.ok) Object.assign(durableCheckpoint, parseResult(await readJob(env, user.userId, row.job_id) ?? row));
    const terminalResult = { ...durableCheckpoint, ...safeResult({...body,followupJobId:followup?.job_id}), ...(detail ? { errorDetail: publicFailureDetail(detail) } : {}), stage: response.ok ? "completed" : "failed", progressMessage: response.ok ? "The operation finished." : failureProgressMessage(detail) };
    await finishDocumentJob(env, row, response.ok ? "completed" : "failed", terminalResult, response.ok ? null : detail?.message ?? String(body.error ?? "document_job_failed"), completedAt);
  } catch (error) {
    const completedAt = new Date().toISOString(); const detail = classifyProviderFailure(error);
    const durableCheckpoint = parseResult(await readJob(env, user.userId, row.job_id) ?? row);
    await finishDocumentJob(env, row, "failed", { ...durableCheckpoint, errorDetail: publicFailureDetail(detail), stage: "failed", progressMessage: failureProgressMessage(detail) }, detail.message, completedAt);
  }
  const finishedRow = await readJob(env, user.userId, jobId); if (finishedRow) await reconcileParentForChild(env, finishedRow); return finishedRow;
}

async function driveDocumentQueue(env: WorkerEnv, user: PilotUser) {
  for (let count = 0; count < 50; count += 1) {
    const running = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status IN ('running','committing') ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId).first<{ job_id: string }>();
    if (running) {
      const active = await readJob(env, user.userId, running.job_id);
      if (!active) continue;
      if (!rowIsStale(active)) return;
      const recovered = await runDocumentJob(env, user, active.job_id);
      if (!recovered || recovered.status === "queued" || recovered.status === "running" || recovered.status === "committing") return;
      continue;
    }
    const next = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status='queued' ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId).first<{ job_id: string }>();
    if (!next) return;
    const job = await runDocumentJob(env, user, next.job_id);
    if (!job || job.status === "queued" || job.status === "running") return;
  }
}

async function stopGenerationJob(env: WorkerEnv, user: PilotUser, target: DocumentJobRow, force: boolean) {
  if (target.kind !== "preview" && target.kind !== "generate" && target.kind !== "prompt_fan" && target.kind !== "render_document") return { error: "generation_job_required", status: 409 } as const;
  if (target.status === "committing") return { error: "job_finalizing", status: 409 } as const;
  if (documentJobTerminal(target)) return { job: target } as const;
  const request = parseRequest(target); const childIds = target.kind === "prompt_fan" && Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean) : [];
  const children = (await Promise.all(childIds.map((id) => readJob(env, user.userId, id)))).filter((row): row is DocumentJobRow => Boolean(row));
  if (children.some((row) => row.status === "committing")) return { error: "job_finalizing", status: 409 } as const;
  const targets = target.kind === "prompt_fan" ? [...children, target] : [target]; const stopped: DocumentJobRow[] = [];
  for (const row of targets) {
    if (row.status !== "queued" && row.status !== "running") continue;
    const completedAt = new Date().toISOString();
    const errorDetail: DocumentJobError = { code: force ? "force_failed_by_admin" : "canceled_by_user", category: "canceled", scope: "request", action: "none", message: force ? "An administrator force-failed this generation." : "The user stopped this generation.", retryable: true, retryAfterMs: null, requestId: null, httpStatus: null };
    const result = { ...parseResult(row), errorDetail, stage: force ? "failed" : "canceled", progressMessage: errorDetail.message };
    const updated = await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND status IN ('queued','running')")
      .bind(force ? "failed" : "canceled", JSON.stringify(result), errorDetail.code, completedAt, force ? null : completedAt, completedAt, row.job_id, user.userId, row.correlation_id).run();
    if (Number(updated.meta.changes ?? 0) !== 1) continue;
    stopped.push(row);
    const released = await releaseBudgetReservationsForCorrelation(env, user, row.correlation_id, force ? "generation_force_failed" : "generation_canceled");
    const checkpoint=parseResult(row);const sceneReceipts=Object.values(checkpoint.productionSceneReceipts&&typeof checkpoint.productionSceneReceipts==="object"?checkpoint.productionSceneReceipts as Record<string,Record<string,unknown>>:{});const frameReceipts=Object.values(checkpoint.productionFrameReceipts&&typeof checkpoint.productionFrameReceipts==="object"?checkpoint.productionFrameReceipts as Record<string,Record<string,unknown>>:{});const correlated=await readCorrelatedEvents(env,user.streamId,[row.correlation_id]);const costReservationId=await restoreLegacyCostReservation(env,user,row,correlated);if(sceneReceipts.length||frameReceipts.length){const incurred=sceneReceipts.reduce((sum,receipt)=>sum+(receipt.status==="completed"?Number(receipt.costMicrousd??0):receipt.status==="submitted"?Number(receipt.durationSeconds??0)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]:0),0)+frameReceipts.reduce((sum,receipt)=>sum+Number(receipt.costMicrousd??0),0)+(checkpoint.productionAnchor?500_000:0);if(costReservationId&&incurred>0)await settleCostBudget(env,user.billingUserId??user.userId,costReservationId,incurred);}else if(!checkpoint.providerJobId&&!correlated.some((event)=>event.type==="GenerationUsageRecorded"))await releaseCostReservationsForCorrelation(env,user.billingUserId??user.userId,row.correlation_id);
    const auditType = force ? "JobForceFailed" : "JobCanceled";
    try {
      await appendAuditEvent(env, user.streamId, "worker:scheduler", auditType, { job_id: row.job_id, document_id: row.document_id, kind: row.kind, previous_status: row.status, requested_by: user.userId, requested_by_role: user.role, released_reservation_count: released.length }, row.correlation_id);
      for (const reservation of released) await appendAuditEvent(env, user.streamId, "worker:policy", "BudgetReleased", { reservation_id: reservation.id, reserved_tokens: reservation.tokens, reason: force ? "generation_force_failed" : "generation_canceled", operation: reservation.operation, job_id: row.job_id, attempt: row.attempt_count }, row.correlation_id);
    } catch (error) { console.error("document_job_stop_audit_failed", row.job_id, error instanceof Error ? error.message : "unknown"); }
  }
  return { job: await readJob(env, user.userId, target.job_id), stoppedCount: stopped.length } as const;
}

export async function handleDocumentJobs(request: Request, env: WorkerEnv, path = "", context?: WorkerExecutionContext) {
  await ensureSchema(env); const auth = await requireUser(request, env, request.method === "GET" ? "viewer" : "creator"); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
  type DocumentJobAdmission={kind?:string;documentId?:string;sourceSurface?:string;payload?:Record<string,unknown>};let submittedInput:DocumentJobAdmission|null=null;
  if(request.method==="POST"&&!path){const consent=requireConsent(user);if(consent)return consent;submittedInput=await request.json() as DocumentJobAdmission;const payload=submittedInput.payload;if(submittedInput.kind==="render_document"&&(payload?.artifactKind==="storyboard"||payload?.artifactKind==="video")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});}
  if(request.method==="POST"&&path.endsWith("/retry")){const target=await readJob(env,user.userId,decodeURIComponent(path.slice(0,-6).replace(/\/$/,"")));if(target?.kind==="render_document"){const payload=parseRequest(target);if((payload.artifactKind==="storyboard"||payload.artifactKind==="video")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before recovering this render."},{status:428});}}
  const now = new Date().toISOString();
  // Neither passive polling nor an unauthorized paid request may reconcile or
  // rewrite account history. Maintenance starts only after financial admission.
  if(request.method!=="GET"&&(!path||path.endsWith("/retry"))){
    await reconcileFailedBudgetReservations(env,user);
    await env.DB.prepare("UPDATE document_jobs SET request_json='{}',result_json=NULL,updated_at=? WHERE owner_id=? AND expires_at<=? AND (request_json!='{}' OR result_json IS NOT NULL)").bind(now, user.userId, now).run();
  }

  if ((path.endsWith("/cancel") || path.endsWith("/force-fail")) && request.method === "POST") {
    const force = path.endsWith("/force-fail");
    if (force && user.role !== "admin") return Response.json({ error: "admin_required" }, { status: 403 });
    const suffixLength = force ? 11 : 7; const jobId = decodeURIComponent(path.slice(0, -suffixLength).replace(/\/$/, ""));
    const target = await readJob(env, user.userId, jobId); if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    const stopped = await stopGenerationJob(env, user, target, force);
    if ("error" in stopped) return Response.json({ error: stopped.error }, { status: stopped.status });
    if (!stopped.job) return Response.json({ error: "job_not_found" }, { status: 404 });
    context?.waitUntil(driveDocumentQueue(env, user));
    return Response.json({ job: serializeJob(stopped.job), stoppedCount: stopped.stoppedCount ?? 0 });
  }

  if (path.endsWith("/ack") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -4).replace(/\/$/, ""));
    const target = await readJob(env, user.userId, jobId); if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    const request = parseRequest(target); const childIds = target.kind === "prompt_fan" && Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean) : [];
    const statements = [jobId, ...childIds].map((id) => env.DB.prepare("UPDATE document_jobs SET notified_at=COALESCE(notified_at,?),updated_at=? WHERE job_id=? AND owner_id=?").bind(now, now, id, user.userId));
    const results = await env.DB.batch(statements); const result = results[0];
    return Number(result.meta.changes ?? 0) === 1 ? Response.json({ ok: true }) : Response.json({ error: "job_not_found" }, { status: 404 });
  }

  if (path.endsWith("/dismiss") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -8).replace(/\/$/, ""));
    const target = await readJob(env, user.userId, jobId);
    if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (target.status !== "failed" && target.status !== "partial") return Response.json({ error: "terminal_failure_required" }, { status: 409 });
    const previousResult = parseResult(target);
    const result = { ...previousResult, dismissedAt: previousResult.dismissedAt ?? now };
    await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=?").bind(JSON.stringify(result), now, jobId, user.userId).run();
    const updated = await readJob(env, user.userId, jobId);
    return Response.json({ job: serializeJob(updated!) });
  }

  if (path.endsWith("/retry") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -6).replace(/\/$/, "")); const target = await readJob(env, user.userId, jobId);
    if (!target) return Response.json({ error: "job_not_found" }, { status: 404 });
    const previous = parseResult(target); const correlated = (await readCorrelatedEvents(env,user.streamId,[target.correlation_id])).filter((event) => event.correlationId === target.correlation_id);
    const failure=errorDetailFromResult(previous)??correlatedFailureDetail(correlated);
    const failedEvent = [...correlated].reverse().find((event) => event.type === "DocumentRenderFailed" && event.payload.provider_job_id);
    const requestedEvent = correlated.find((event) => event.type === "DocumentRenderRequested");
    const providerJobId = String(previous.providerJobId ?? failedEvent?.payload.provider_job_id ?? "");
    const artifactId = String(previous.artifactId ?? failedEvent?.payload.artifact_id ?? requestedEvent?.payload.artifact_id ?? "");
    const requestPayload = parseRequest(target); const artifactKind = String(requestPayload.artifactKind ?? failedEvent?.payload.artifact_kind ?? "");
    if((artifactKind==="storyboard"||artifactKind==="video")&&requestPayload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before recovering this render."},{status:428});
    const sceneReceipts=previous.productionSceneReceipts&&typeof previous.productionSceneReceipts==="object"?Object.values(previous.productionSceneReceipts as Record<string,Record<string,unknown>>):[];
    const prepaidSceneIds=sceneReceipts.filter((scene)=>Boolean(scene.providerJobId)&&(scene.status==="submitted"||scene.status==="completed")).map((scene)=>String(scene.sceneId)).filter(Boolean);
    const managedRecovery=prepaidSceneIds.length>0;
    if(!documentJobCanRecoverProviderRender({...serializeJob(target),result:{...previous,providerJobId,artifactKind,recoverableProductionProviderRequest:managedRecovery},errorDetail:failure}))return Response.json({error:"provider_job_not_retryable",message:"This provider request reached a terminal failure and cannot be resumed. Review the saved inputs and start a changed render.",...(failure?{errorDetail:publicFailureDetail({...failure,probe:failure.probe??undefined})}:{})},{status:409});
    if (target.kind !== "render_document" || target.status !== "failed" || (!providerJobId&&!managedRecovery) || !artifactId) return Response.json({ error: "resumable_provider_job_required" }, { status: 409 });
    const previousCostReservationId=String(previous.costReservationId??"");const billingOwnerId=user.billingUserId??user.userId;const previousCostReservation=previousCostReservationId?await costBudgetReservation(env,billingOwnerId,previousCostReservationId):null;let newlyPrepaidProviderCost=0;if(previousCostReservation&&(previousCostReservation.status==="active"||previousCostReservation.status==="executing")){const paidSceneCost=sceneReceipts.reduce((sum,receipt)=>sum+(receipt.status==="submitted"||receipt.status==="completed"?Number(receipt.costMicrousd??Number(receipt.durationSeconds??0)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]):0),0);const paidSingleVideo=!managedRecovery&&providerJobId?normalizeVideoDurationSeconds(requestPayload.videoSeconds)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]:0;const paidAnchor=managedRecovery&&previous.productionAnchor?500_000:0;const incurred=Math.min(previousCostReservation.reserved_microusd,paidSceneCost+paidSingleVideo+paidAnchor);if(incurred>0){await settleCostBudget(env,billingOwnerId,previousCostReservationId,incurred);newlyPrepaidProviderCost=paidSingleVideo;}else await releaseCostBudget(env,billingOwnerId,previousCostReservationId);}
    const providerModel = String(previous.providerModel ?? (artifactKind === "video" ? env.FAL_REFERENCE_VIDEO_MODEL ?? DEFAULT_REFERENCE_VIDEO_MODEL : ""));
    const result:Record<string,unknown> = { ...previous, artifactId, ...(managedRecovery?{productionPrepaidSceneIds:[...new Set([...(Array.isArray(previous.productionPrepaidSceneIds)?previous.productionPrepaidSceneIds.map(String):[]),...prepaidSceneIds])],recoverableProductionProviderRequest:true}:{providerJobId,providerModel}),...(newlyPrepaidProviderCost?{prepaidProviderCostMicrousd:Number(previous.prepaidProviderCostMicrousd??0)+newlyPrepaidProviderCost}:{}), stage: "queued", progressMessage: managedRecovery?"Recovering saved production scenes without submitting already-paid Fal requests again.":"Recovering the saved Fal render without submitting a second paid video." };delete result.errorDetail;delete result.dismissedAt;delete result.reservationId;delete result.costReservationMicrousd;delete result.costReservationId;delete result.costReservationPeriod;
    const updated = await env.DB.prepare("UPDATE document_jobs SET status='queued',correlation_id=?,result_json=?,error_message=NULL,completed_at=NULL,lease_expires_at=NULL,notified_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND status='failed'").bind(jobId, JSON.stringify(result), now, jobId, user.userId).run();
    if (Number(updated.meta.changes ?? 0) !== 1) return Response.json({ error: "job_retry_conflict" }, { status: 409 });
    const queued=await readJob(env,user.userId,jobId);context?.waitUntil(driveDocumentQueue(env,user));return Response.json({job:serializeJob(queued!),reusedProviderRequest:true},{status:202});
  }

  if (path.endsWith("/run") && request.method === "POST") {
    const consent = requireConsent(user); if (consent) return consent;
    const jobId = decodeURIComponent(path.slice(0, -4).replace(/\/$/, "")); const existing = await readJob(env, user.userId, jobId);
    if (!existing) return Response.json({ error: "job_not_found" }, { status: 404 });
    if (existing.kind === "prompt_fan") {
      const job = await reconcilePromptFanParent(env, user.userId, jobId); if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
      context?.waitUntil(driveDocumentQueue(env, user));
      return Response.json({ job: serializeJob(job) }, { status: documentJobTerminal({ status: job.status }) ? 200 : 202 });
    }
    if (context) {
      context.waitUntil(driveDocumentQueue(env, user));
      return Response.json({ job: serializeJob(existing), accepted: true }, { status: 202 });
    }
    const job = await runDocumentJob(env, user, jobId); if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    return Response.json({ job: serializeJob(job) }, { status: documentJobTerminal({ status: job.status }) ? 200 : 202 });
  }

  if (request.method === "GET") {
    const requestedJob = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
    if(path&&requestedJob&&documentJobTerminal(requestedJob)&&Date.parse(requestedJob.expires_at)<=Date.now())return Response.json({error:"job_not_found"},{status:404});
    const query = new URL(request.url).searchParams;
    const activeOnly = query.get("scope") === "active";
    const documentScope = query.get("document")?.trim().slice(0, 160) ?? "";
    // Failure checkpoints remain durable, but large provider/planner inputs
    // belong to the explicitly requested detail view, not every idle poll.
    const readVisibleJobs = () => env.DB.prepare(`SELECT job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,
      CASE WHEN json_extract(request_json,'$.documentRevision') IS NULL THEN request_json ELSE json_object(
        'documentRevision',json_extract(request_json,'$.documentRevision'),'requestKey',json_extract(request_json,'$.requestKey'),
        'sourcePreviewId',json_extract(request_json,'$.sourcePreviewId'),'promptTechnique',json_extract(request_json,'$.promptTechnique'),
        'promptFanId',json_extract(request_json,'$.promptFanId'),'parentJobId',json_extract(request_json,'$.parentJobId'),
        'fanKind',json_extract(request_json,'$.fanKind'),'artifactKind',json_extract(request_json,'$.artifactKind'),'productionMode',json_extract(request_json,'$.productionMode')
      ) END AS request_json,
      json_remove(result_json,'$.plannerInput','$.videoInputReceipt','$.artifactPlan','$.productionPlan','$.productionSceneReceipts','$.productionAnchor') AS result_json,
      error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at
      FROM document_jobs WHERE owner_id=? AND (status IN ('queued','running','committing') OR (notified_at IS NULL AND expires_at>?) OR (kind IN ('preview','generate','prompt_fan','render_document') AND status IN ('failed','partial') AND expires_at>?))
      AND (?=0 OR status IN ('queued','running','committing') OR notified_at IS NULL)
      AND (?='' OR status IN ('queued','running','committing') OR notified_at IS NULL OR document_id=?)
      ORDER BY CASE WHEN status IN ('queued','running','committing') THEN 0 ELSE 1 END,requested_at DESC LIMIT 120`).bind(user.userId, now, now, Number(activeOnly), documentScope, documentScope).all<DocumentJobRow>();
    let rows = path ? requestedJob ? [requestedJob] : [] : (await readVisibleJobs()).results;
    let reconciled = false;
    const repairCandidates = rows.filter((row) => row.status === "failed" && /Wrong number of parameter bindings/i.test(row.error_message ?? ""));
    if (repairCandidates.length) {
      const events = await readCorrelatedEvents(env,user.streamId,repairCandidates.map((row)=>row.correlation_id));
      for (const row of repairCandidates) {
        if(!operationFinished(events,row))continue;
        const retained = path ? row : await readJob(env, user.userId, row.job_id);
        if (retained && await repairMisreportedTerminalJob(env, retained, events)) reconciled = true;
      }
    }
    const parents = rows.filter((row) => row.kind === "prompt_fan" && ["queued","running","committing"].includes(row.status));
    for(const parent of parents){const updated=await reconcilePromptFanParent(env,user.userId,parent.job_id);if(!updated||updated.status!==parent.status||updated.result_json!==parent.result_json||updated.error_message!==parent.error_message||updated.completed_at!==parent.completed_at)reconciled=true;}
    for (const row of rows) if (rowIsStale(row) && row.attempt_count >= documentJobMaxAttempts(row.kind)) {
      // A compact list row must never replace the retained recovery checkpoint.
      const retained = path ? row : await readJob(env, user.userId, row.job_id);
      if (retained && rowIsStale(retained) && retained.attempt_count >= documentJobMaxAttempts(retained.kind)) {
        await failStaleJob(env, user, retained);
        reconciled = true;
      }
    }
    if (reconciled) {
      const refreshed = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
      rows = path ? refreshed ? [refreshed] : [] : (await readVisibleJobs()).results;
    }
    const visibleBlocker = [...rows].filter((row)=>row.kind!=="prompt_fan"&&["running","committing"].includes(row.status)).sort((left,right)=>left.requested_at.localeCompare(right.requested_at)||left.job_id.localeCompare(right.job_id))[0]??null;
    const activeBlocker = path
      ? await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status IN ('running','committing') ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId).first<DocumentJobRow>()
      : visibleBlocker;
    const recoveryBlocker = activeBlocker && rowIsStale(activeBlocker) ? activeBlocker : null;
    if (recoveryBlocker) context?.waitUntil(driveDocumentQueue(env, user));
    if (path && !rows.length) return Response.json({ error: "job_not_found" }, { status: 404 });
    return Response.json(path ? { job: serializeJob(rows[0], recoveryBlocker) } : { jobs: rows.map((row) => serializeJob(row, recoveryBlocker, false)) });
  }

  if (path || request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const consent = requireConsent(user); if (consent) return consent;
  const input = submittedInput??await request.json() as DocumentJobAdmission;
  if (!KINDS.has(input.kind as DocumentJobKind)) return Response.json({ error: "unsupported_document_job" }, { status: 400 });
  const kind = input.kind as DocumentJobKind; const payload = input.payload && typeof input.payload === "object" ? { ...input.payload } : {};
  if(kind==="render_document"&&(payload.artifactKind==="storyboard"||payload.artifactKind==="video")&&payload.paidMediaConfirmed!==true)return Response.json({error:"paid_media_confirmation_required",message:"Confirm paid media generation before starting this render."},{status:428});
  if (kind !== "extract_reference" && !env.OPENAI_API_KEY) return Response.json({ error: "provider_not_configured" }, { status: 503 });
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) return Response.json({ error: "document_job_payload_too_large" }, { status: 413 });
  if(kind==="preview"||kind==="generate"||kind==="prompt_fan"||kind==="render_document"||kind==="chat"||kind==="structure_adaptive"){
    const artifactKind=String(payload.artifactKind??"");const production=kind==="render_document"&&payload.productionMode==="managed"&&["short_story","scene","slides","storyboard","video"].includes(artifactKind)?buildManagedProductionPlan(artifactKind as "short_story"|"scene"|"slides"|"storyboard"|"video",payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:{},artifactKind==="video"?{}:{requestedItemCount:Number(payload.itemCount??0)}):null;
    const estimatedCostMicrousd=production?production.estimatedTotalCostMicrousd+(artifactKind==="storyboard"?production.scenes.length*1_000_000:0):kind==="chat"||kind==="structure_adaptive"?estimatePlannerOperationMicrousd(env.OPENAI_MODEL??"gpt-5.6-terra",kind):kind==="prompt_fan"?4_000_000:kind==="render_document"&&artifactKind==="video"?normalizeVideoDurationSeconds(payload.videoSeconds)*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution]+1_000_000:kind==="render_document"&&artifactKind==="storyboard"?Math.max(1,Math.floor(Number(payload.itemCount??6)))*1_000_000+1_000_000:1_000_000;
    const gate=generationBudgetGate(await readCostBudgets(env,user.billingUserId??user.userId),{projectedMicrousd:estimatedCostMicrousd,suppressedUntilCritical:payload.budgetWarningSuppressed===true,noticeAcknowledged:payload.budgetAcknowledged===true});
    if(gate.level==="blocked")return Response.json({error:"budget_hard_cap_reached",message:`This generation exceeds the remaining ${gate.scope==="workspace"?"organization":"personal"} monthly budget.`,scope:gate.scope,gate},{status:429});
    if(gate.requiresAcknowledgement&&payload.budgetAcknowledged!==true)return Response.json({error:"generation_budget_acknowledgement_required",message:`Review your ${Math.round(gate.projectedUtilization*100)}% monthly budget usage before starting this generation.`,gate},{status:428});
  }
  const events = await readWorkspaceEvents(env, user.streamId); const projection = foldEvents(events, Number.POSITIVE_INFINITY, input.documentId);
  const documentId = String(input.documentId ?? projection.documentId); const documentRecord = projection.documents.find((document) => document.id === documentId);
  if (!documentRecord) return Response.json({ error: "document_not_found" }, { status: 404 });

  if(kind==="preview"||kind==="generate"||kind==="prompt_fan"){
    const readinessKind=kind==="prompt_fan"?`${fanKindFromRequest(payload)??"generate"}_fan` as const:kind;const readiness=await preflightGeneration(env,user,{kind:readinessKind,documentId,documentRevision:String(payload.documentRevision??""),requestKey:String(payload.requestKey??""),sourcePreviewId:typeof payload.sourcePreviewId==="string"?payload.sourcePreviewId:null,promptTechnique:normalizePromptTechnique(payload.promptTechnique),productionMode:payload.productionMode==="managed"?"managed":"manual",snapshot:payload.snapshot&&typeof payload.snapshot==="object"?payload.snapshot as Record<string,unknown>:undefined,force:true,sourceSurface:String(input.sourceSurface??"generation-controls")},{appendEvents:true,allowCache:false,sourceEvents:events});
    if(readiness.status==="blocked"){await appendAuditEvent(env,user.streamId,"worker:policy","GenerationBlockedBeforeProvider",{preflight_id:readiness.preflightId,document_id:documentId,document_revision:readiness.documentRevision,request_key:readiness.requestKey,kind:readiness.kind,status:readiness.status,blocking_probes:readiness.probes.filter((probe)=>probe.status==="fail").map((probe)=>probe.id),estimated_cost_avoided_microusd:readiness.estimatedCostMicrousd},uuidV7());return Response.json({error:"generation_preflight_blocked",message:readiness.summary,readiness},{status:409});}
    if(readiness.status==="review"&&payload.preflightAcknowledged!==true)return Response.json({error:"generation_preflight_review_required",message:readiness.summary,readiness},{status:428});
    if(readiness.status==="review")await appendAuditEvent(env,user.streamId,"worker:policy","GenerationRiskAcknowledged",{preflight_id:readiness.preflightId,document_id:documentId,document_revision:readiness.documentRevision,request_key:readiness.requestKey,kind:readiness.kind,warning_probes:readiness.probes.filter((probe)=>probe.status==="warning"||probe.status==="unknown").map((probe)=>probe.id),source_surface:String(input.sourceSurface??"generation-controls")});
    payload.preflightId=readiness.preflightId;payload.preflightVersion=readiness.version;payload.preflightAcknowledged=readiness.status==="review";
  }

  if (kind === "prompt_fan") {
    const fanKind = fanKindFromRequest(payload); if (!fanKind) return Response.json({ error: "prompt_fan_kind_required" }, { status: 400 });
    const promptFanId = typeof payload.promptFanId === "string" && payload.promptFanId ? payload.promptFanId : uuidV7();
    const documentRevision = generationRevisionFromRequest(payload, documentId); const sourcePreviewId = typeof payload.sourcePreviewId === "string" && payload.sourcePreviewId ? payload.sourcePreviewId : null;
    const parentRequestKey = String(payload.requestKey || `prompt-fan:${fanKind}:${documentRevision}:${sourcePreviewId || "document"}`);
    const activeParents = (await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND document_id=? AND kind='prompt_fan' AND status IN ('queued','running','committing') ORDER BY requested_at DESC LIMIT 20").bind(user.userId, documentId).all<DocumentJobRow>()).results;
    const duplicate = activeParents.find((candidate) => String(parseRequest(candidate).requestKey ?? "") === parentRequestKey);
    if (duplicate) return Response.json({ job: serializeJob(await reconcilePromptFanParent(env, user.userId, duplicate.job_id) ?? duplicate), reused: true }, { status: 202 });
    const requestedAt = new Date(); const requestedAtIso = requestedAt.toISOString(); const configuredRetention = Number(env.FORMA_RETENTION_DAYS ?? 30); const retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : 30; const expiresAt = new Date(requestedAt.getTime() + retentionDays * 86_400_000).toISOString();
    const sourceSurface = String(input.sourceSurface ?? payload.sourceSurface ?? "studio").slice(0, 80) || "studio"; const requestedSequence = await streamHead(env, user.streamId); const parentId = uuidV7(); const childIds = PROMPT_TECHNIQUES.map(() => uuidV7());
    const productionMode=payload.productionMode==="managed"?"managed":"manual";
    const shared = { ...payload, productionMode, fanKind: undefined, requestKey: undefined, promptTechnique: undefined, promptFanId, documentRevision, sourcePreviewId };
    const parentRequest = { fanKind, promptFanId, documentRevision, sourcePreviewId, productionMode, requestKey: parentRequestKey, childJobIds: childIds };
    const insert = (jobId: string, jobKind: DocumentJobKind, requestJson: Record<string, unknown>, resultJson: Record<string, unknown> | null = null) => env.DB.prepare("INSERT INTO document_jobs (job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?,?,NULL,0,?,NULL,NULL,NULL,NULL,?,?)").bind(jobId, user.userId, user.streamId, documentId, jobKind, sourceSurface, jobId, requestedSequence, JSON.stringify(requestJson), resultJson ? JSON.stringify(resultJson) : null, requestedAtIso, expiresAt, requestedAtIso);
    const members = PROMPT_TECHNIQUES.map((technique, index) => ({ jobId: childIds[index], promptTechnique: technique, status: "queued", error: null, attemptCount: 0, updatedAt: requestedAtIso }));
    const statements = [insert(parentId, "prompt_fan", parentRequest, { stage: "queued", progressMessage: "Four prompt approaches are queued as one generation.", members, completedCount: 0, failedCount: 0, totalCount: 4 }), ...PROMPT_TECHNIQUES.map((technique: PromptTechnique, index: number) => insert(childIds[index], fanKind, { ...shared, parentJobId: parentId, promptTechnique: technique, requestKey: documentGenerationRequestKey(fanKind, documentRevision, sourcePreviewId, technique, promptFanId) }))];
    await env.DB.batch(statements); const parent = await readJob(env, user.userId, parentId); context?.waitUntil(driveDocumentQueue(env, user));
    return Response.json({ job: serializeJob(parent!), accepted: true }, { status: 202 });
  }

  let active:DocumentJobRow|null=null;
  if(kind!=="extract_reference"){
    const candidates=(await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND document_id=? AND kind=? AND status IN ('queued','running','committing') ORDER BY requested_at DESC LIMIT 50").bind(user.userId,documentId,kind).all<DocumentJobRow>()).results;
    if(kind==="preview"||kind==="generate"){
      const identity=generationRequestIdentity(kind,payload,documentId);payload.documentRevision=identity.documentRevision;payload.requestKey=identity.requestKey;
      active=candidates.find((candidate)=>generationRequestIdentity(kind,parseRequest(candidate),documentId).requestKey===identity.requestKey)??null;
    }else if(kind==="render_document")active=candidates.find((candidate)=>String(parseRequest(candidate).requestKey??"")===String(payload.requestKey??""))??null;
    else active=candidates[0]??null;
  }
  if (active) return Response.json({ job: serializeJob(active), reused: true }, { status: 202 });

  if (kind === "chat" || kind === "structure_adaptive") {
    const field = kind === "chat" ? "message" : "prompt"; const text = String(payload[field] ?? "").trim();
    if (!text) return Response.json({ error: kind === "chat" ? "chat_message_required" : "adaptive_intent_required" }, { status: 400 });
    if (text.length > (kind === "chat" ? 4000 : 2000)) return Response.json({ error: kind === "chat" ? "chat_message_too_long" : "adaptive_intent_too_long" }, { status: 400 });
    const stored = await storePrivateContent(env, user.userId, kind === "chat" ? "chat-user" : "adaptive-intent", text); payload[field] = undefined; payload.jobInputRef = stored.contentId;
  }

  const jobId = uuidV7(); const requestedAt = new Date(); const configuredRetention = Number(env.FORMA_RETENTION_DAYS ?? 30); const retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : 30; const expiresAt = new Date(requestedAt.getTime() + retentionDays * 86_400_000).toISOString();
  const sourceSurface = String(input.sourceSurface ?? payload.sourceSurface ?? "studio").slice(0, 80) || "studio"; const requestedSequence = await streamHead(env, user.streamId);
  await env.DB.prepare("INSERT INTO document_jobs (job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?,NULL,NULL,0,?,NULL,NULL,NULL,NULL,?,?)").bind(jobId, user.userId, user.streamId, documentId, kind, sourceSurface, jobId, requestedSequence, JSON.stringify(payload), requestedAt.toISOString(), expiresAt, requestedAt.toISOString()).run();
  const job = await readJob(env, user.userId, jobId);
  context?.waitUntil(driveDocumentQueue(env, user));
  return Response.json({ job: serializeJob(job!), accepted: true }, { status: 202 });
}

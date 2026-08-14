import { handleEvents } from "./events-api";
import { loadPrivateContent, releaseBudget, requireConsent, requireUser, storePrivateContent, type PilotUser } from "./pilot-policy";
import { appendAuditEvent, ensureSchema, readEvents, streamHead, uuidV7, type WorkerEnv, type WorkerExecutionContext } from "./runtime";
import { foldEvents } from "../src/model/events";
import {
  DOCUMENT_JOB_HEARTBEAT_MS,
  DOCUMENT_JOB_LEASE_MS,
  DOCUMENT_JOB_STALE_AFTER_MS,
  documentGenerationRequestKey,
  documentGenerationRevision,
  documentJobTerminal,
  documentJobMaxAttempts,
  type DocumentJobError,
  type DocumentJobKind,
  type DocumentJobStatus,
} from "../src/model/document-jobs";
import { normalizePromptTechnique, PROMPT_TECHNIQUES, type PromptTechnique } from "../src/model/prompt-structures";
import { applicationFailureDetail, classifyProviderFailure, publicFailureDetail, type ProviderFailureDetail } from "./provider-errors";
import { documentJobCompletionBindings } from "./document-job-sql";

type DocumentJobRow = {
  job_id: string; owner_id: string; stream_id: string; document_id: string; kind: DocumentJobKind; status: DocumentJobStatus;
  source_surface: string; correlation_id: string; requested_sequence: number; request_json: string; result_json: string | null;
  error_message: string | null; attempt_count: number; requested_at: string; started_at: string | null; completed_at: string | null;
  lease_expires_at: string | null; notified_at: string | null; expires_at: string; updated_at: string;
};

const KINDS = new Set<DocumentJobKind>(["preview", "generate", "prompt_fan", "chat", "structure_adaptive", "extract_reference"]);
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
  };
}

function failureProgressMessage(detail: ProviderFailureDetail | DocumentJobError | null) {
  if (!detail) return "The operation failed.";
  if (detail.category === "safety") return "Safety checks stopped this image. Change the request or reference before retrying.";
  if (detail.action === "review_budget") return detail.scope === "workspace" ? "The workspace generation budget is exhausted." : "Your generation budget is exhausted.";
  if (detail.category === "quota") return `The OpenAI ${detail.scope === "project" || detail.scope === "organization" ? detail.scope : "account"} limit prevents generation.`;
  if (detail.category === "authentication") return "The configured OpenAI credential was rejected.";
  if (detail.category === "access") return "The configured credential cannot access this OpenAI project or model.";
  if (detail.category === "rate_limit") return "OpenAI remained rate limited after automatic backoff.";
  if (detail.category === "network" || detail.category === "server") return "The provider connection ended before an image was returned.";
  return detail.message || "The operation failed.";
}

async function finishDocumentJob(env: WorkerEnv, row: DocumentJobRow, status: "completed" | "failed", result: Record<string, unknown>, errorMessage: string | null, completedAt = new Date().toISOString()) {
  const parentId = parentJobIdFromRequest(parseRequest(row));
  const bindings = documentJobCompletionBindings({ status, result, errorMessage, completedAt, parentId, jobId: row.job_id, ownerId: row.owner_id, correlationId: row.correlation_id });
  return env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=?")
    .bind(...bindings).run();
}

function serializeJob(row: DocumentJobRow) {
  const parsed = parseResult(row); const result = row.result_json ? parsed : null; const request = parseRequest(row); const identity = generationRequestIdentity(row.kind, request, row.document_id);
  const members = Array.isArray(parsed.members) ? parsed.members : [];
  return {
    jobId: row.job_id, documentId: row.document_id, kind: row.kind, status: row.status, sourceSurface: row.source_surface,
    requestedSequence: Number(row.requested_sequence), documentRevision: identity.documentRevision, requestKey: identity.requestKey, sourcePreviewId: identity.sourcePreviewId, promptTechnique: identity.promptTechnique, promptFanId: identity.promptFanId,
    parentJobId: parentJobIdFromRequest(request), fanKind: fanKindFromRequest(request), members, result, error: row.error_message, errorDetail: errorDetailFromResult(parsed), moderationPromptRef: parsed.moderationPromptRef ? String(parsed.moderationPromptRef) : null, dismissedAt: parsed.dismissedAt ? String(parsed.dismissedAt) : null, attemptCount: Number(row.attempt_count),
    requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at, notifiedAt: row.notified_at,
    leaseExpiresAt: row.lease_expires_at, updatedAt: row.updated_at,
    stage: String(parsed.stage ?? row.status), progressMessage: String(parsed.progressMessage ?? ""),
  };
}

async function reconcilePromptFanParent(env: WorkerEnv, ownerId: string, parentId: string) {
  const parent = await readJob(env, ownerId, parentId); if (!parent || parent.kind !== "prompt_fan") return parent;
  const request = parseRequest(parent); const childIds = Array.isArray(request.childJobIds) ? request.childJobIds.map(String).filter(Boolean).slice(0, 4) : [];
  const children = (await Promise.all(childIds.map((jobId) => readJob(env, ownerId, jobId)))).filter((row): row is DocumentJobRow => Boolean(row));
  const members = children.map((child) => {
    const childRequest = parseRequest(child); const childResult = parseResult(child);
    return { jobId: child.job_id, promptTechnique: normalizePromptTechnique(childRequest.promptTechnique), status: child.status, error: errorDetailFromResult(childResult), moderationPromptRef: childResult.moderationPromptRef ? String(childResult.moderationPromptRef) : null, attemptCount: Number(child.attempt_count), updatedAt: child.updated_at };
  });
  const terminal = children.filter((child) => child.status === "completed" || child.status === "failed"); const succeeded = terminal.filter((child) => child.status === "completed").length; const failed = terminal.length - succeeded;
  const status: DocumentJobStatus = terminal.length === childIds.length && childIds.length > 0 ? failed === 0 ? "completed" : succeeded > 0 ? "partial" : "failed" : children.some((child) => child.status === "running") || terminal.length > 0 ? "running" : "queued";
  const now = new Date().toISOString(); const completedAt = documentJobTerminal({ status }) ? parent.completed_at ?? now : null;
  const progressMessage = status === "completed" ? "All four prompt approaches finished." : status === "partial" ? `${succeeded} of 4 images finished; ${failed} failed.` : status === "failed" ? "All four prompt approaches failed." : `${terminal.length} of 4 prompt approaches finished.`;
  const result = { ...parseResult(parent), stage: status, progressMessage, members, completedCount: succeeded, failedCount: failed, totalCount: childIds.length };
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
  if (row.status !== "running") return false;
  const leaseExpires = Date.parse(row.lease_expires_at ?? ""); const updated = Date.parse(row.updated_at);
  return Number.isFinite(leaseExpires) && leaseExpires <= now || Number.isFinite(updated) && updated <= now - DOCUMENT_JOB_STALE_AFTER_MS;
}

async function updateJobProgress(env: WorkerEnv, row: DocumentJobRow, stage: string, progressMessage: string) {
  const updatedAt = new Date().toISOString(); const result = { ...parseResult(row), stage, progressMessage };
  await env.DB.prepare("UPDATE document_jobs SET result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=?").bind(JSON.stringify(result), updatedAt, row.job_id, row.owner_id, row.correlation_id).run();
  row.result_json = JSON.stringify(result); row.updated_at = updatedAt;
}

async function renewJobLease(env: WorkerEnv, row: DocumentJobRow) {
  const now = new Date(); const leaseExpiresAt = new Date(now.getTime() + DOCUMENT_JOB_LEASE_MS).toISOString();
  const result = await env.DB.prepare("UPDATE document_jobs SET lease_expires_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=?").bind(leaseExpiresAt, now.toISOString(), row.job_id, row.owner_id, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new Error("document_job_lease_lost");
  row.lease_expires_at = leaseExpiresAt; row.updated_at = now.toISOString();
}

async function runWithHeartbeat<T>(env: WorkerEnv, row: DocumentJobRow, operation: () => Promise<T>) {
  let settled = false; let value: T | undefined; let failure: unknown;
  const execution = operation().then((result) => { value = result; settled = true; }, (error) => { failure = error; settled = true; });
  while (!settled) {
    await Promise.race([execution, new Promise<void>((resolve) => setTimeout(resolve, DOCUMENT_JOB_HEARTBEAT_MS))]);
    if (!settled) await renewJobLease(env, row);
  }
  if (failure !== undefined) throw failure;
  return value as T;
}

async function releaseInterruptedAttempt(env: WorkerEnv, user: PilotUser, row: DocumentJobRow, reason: string) {
  const events = await readEvents(env, user.streamId); const correlated = events.filter((event) => event.correlationId === row.correlation_id);
  const settledReservations = new Set(correlated.filter((event) => event.type === "BudgetReleased" || event.type === "GenerationUsageRecorded").map((event) => String(event.payload.reservation_id ?? "")).filter(Boolean));
  const reservations = correlated.filter((event) => event.type === "BudgetReserved").map((event) => ({ id: String(event.payload.reservation_id ?? ""), tokens: Number(event.payload.reserved_tokens ?? 0), operation: String(event.payload.operation ?? row.kind) })).filter((reservation) => reservation.id && reservation.tokens > 0 && !settledReservations.has(reservation.id));
  const reservedTokens = reservations.reduce((sum, reservation) => sum + reservation.tokens, 0); if (reservedTokens) await releaseBudget(env, user.userId, reservedTokens);
  try {
    await appendAuditEvent(env, user.streamId, "worker:scheduler", "JobAttemptInterrupted", { job_id: row.job_id, document_id: row.document_id, kind: row.kind, attempt: row.attempt_count, reason, released_reservation_count: reservations.length }, row.correlation_id);
    for (const reservation of reservations) await appendAuditEvent(env, user.streamId, "worker:policy", "BudgetReleased", { reservation_id: reservation.id, reserved_tokens: reservation.tokens, reason, operation: reservation.operation, job_id: row.job_id, attempt: row.attempt_count }, row.correlation_id);
  } catch (error) { console.error("document_job_interruption_audit_failed", row.job_id, error instanceof Error ? error.message : "unknown"); }
}

async function failStaleJob(env: WorkerEnv, user: PilotUser, row: DocumentJobRow) {
  const now = new Date().toISOString();
  const errorDetail = { code: "execution_interrupted", category: "server", message: "The server lost contact with this operation before it finished.", retryable: false, requestId: null, httpStatus: null };
  const parentId = parentJobIdFromRequest(parseRequest(row));
  const result = await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message='execution_interrupted',completed_at=?,lease_expires_at=NULL,result_json=?,notified_at=CASE WHEN ? IS NULL THEN notified_at ELSE ? END,updated_at=? WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=?").bind(now, JSON.stringify({ ...parseResult(row), errorDetail, stage: "failed", progressMessage: errorDetail.message }), parentId, now, now, row.job_id, user.userId, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) === 1) { await releaseInterruptedAttempt(env, user, row, "execution_interrupted"); await reconcileParentForChild(env, row); }
}

function operationFinished(events: Awaited<ReturnType<typeof readEvents>>, row: DocumentJobRow) {
  const correlated = events.filter((event) => event.correlationId === row.correlation_id);
  const terminal = correlated.find((event) => {
    if (row.kind === "preview") return event.type === "IdeationPreviewCompleted" || event.type === "GenerationFailed";
    if (row.kind === "generate") return event.type === "GenerationCompleted" || event.type === "GenerationFailed";
    if (row.kind === "chat") return event.type === "GenerationUsageRecorded" && event.payload.operation === "creative-chat" || event.type === "BudgetReleased" && event.payload.operation === "creative-chat";
    if (row.kind === "structure_adaptive") return event.type === "GenerationUsageRecorded" && event.payload.operation === "adaptive-structure" || event.type === "BudgetReleased" && event.payload.operation === "adaptive-structure";
    return event.type === "ExtractionCompleted" || event.type === "ExtractionFailed";
  });
  const failed = terminal?.type === "GenerationFailed" || terminal?.type === "ExtractionFailed" || terminal?.type === "BudgetReleased";
  return terminal ? { failed, correlated } : null;
}

function correlatedFailureDetail(events: Awaited<ReturnType<typeof readEvents>>) {
  const failureEvent = [...events].reverse().find((event) => event.type === "GenerationFailed" || event.type === "ExtractionFailed");
  if (!failureEvent) return null;
  const payload = failureEvent.payload;
  return {
    code: String(payload.error_code ?? payload.error_class ?? "operation_failed"), category: String(payload.error_category ?? "unknown") as DocumentJobError["category"],
    scope: String(payload.error_scope ?? "unknown") as DocumentJobError["scope"], action: String(payload.error_action ?? "none") as DocumentJobError["action"],
    message: String(payload.error_message ?? "The operation failed."), retryable: Boolean(payload.retryable),
    retryAfterMs: payload.retry_after_ms === null || payload.retry_after_ms === undefined || !Number.isFinite(Number(payload.retry_after_ms)) ? null : Number(payload.retry_after_ms),
    requestId: payload.provider_request_id ? String(payload.provider_request_id) : null,
    httpStatus: payload.http_status === null || payload.http_status === undefined || !Number.isFinite(Number(payload.http_status)) ? null : Number(payload.http_status),
  } satisfies DocumentJobError;
}

function correlatedModerationPromptRef(events: Awaited<ReturnType<typeof readEvents>>) {
  const failureEvent=[...events].reverse().find((event)=>event.type==="GenerationFailed"&&event.payload.prompt_ref);
  return failureEvent?.payload.prompt_ref?String(failureEvent.payload.prompt_ref):null;
}

async function repairMisreportedTerminalJob(env: WorkerEnv, row: DocumentJobRow, events: Awaited<ReturnType<typeof readEvents>>) {
  if (row.status !== "failed" || !/Wrong number of parameter bindings/i.test(row.error_message ?? "")) return false;
  const finished = operationFinished(events, row); if (!finished) return false;
  const detail = finished.failed ? correlatedFailureDetail(finished.correlated) : null;
  const status = finished.failed ? "failed" : "completed";
  const moderationPromptRef=finished.failed?correlatedModerationPromptRef(finished.correlated):null;
  const result = { ...parseResult(row), ...(detail ? { errorDetail: detail } : {}), ...(moderationPromptRef?{moderationPromptRef}:{}), stage: status, progressMessage: finished.failed ? failureProgressMessage(detail) : "The operation finished." };
  await finishDocumentJob(env, row, status, result, detail?.message ?? (finished.failed ? "operation_failed" : null), row.completed_at ?? new Date().toISOString());
  return true;
}

function safeResult(body: Record<string, unknown>, correlatedEventIds: string[] = []) {
  const appended = Array.isArray(body.appended) ? body.appended as Array<Record<string, unknown>> : [];
  return {
    head: Number(body.head ?? 0),
    appendedEventIds: appended.map((event) => String(event.eventId ?? "")).filter(Boolean).concat(correlatedEventIds),
    previewed: Boolean(body.previewed), previewQueued: Boolean(body.previewQueued), previewSuppressed: Boolean(body.previewSuppressed), followupJobId: body.followupJobId ? String(body.followupJobId) : undefined, moderationPromptRef: body.moderationPromptRef ? String(body.moderationPromptRef) : undefined, promoted: Boolean(body.promoted), quality: body.quality ? String(body.quality) : undefined,
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

  const existingEvents = await readEvents(env, user.streamId);
  const finished = operationFinished(existingEvents, row);
  if (finished) {
    const now = new Date().toISOString(); const status: DocumentJobStatus = finished.failed ? "failed" : "completed";let followup:DocumentJobRow|null=null;
    if(!finished.failed&&row.kind==="chat"){const reasoned=finished.correlated.find((event)=>event.type==="AssistantReasoned"&&event.payload.preview_queued&&event.payload.preview_direction_ref);if(reasoned)followup=await queueFollowupPreview(env,user,row,{kind:"preview",documentId:row.document_id,sourceSurface:"chat",payload:{directionRef:reasoned.payload.preview_direction_ref,directionModel:reasoned.payload.model_id,sourceChatTurnId:reasoned.payload.turn_id}});}
    const failureDetail = finished.failed ? correlatedFailureDetail(finished.correlated) : null;const moderationPromptRef=finished.failed?correlatedModerationPromptRef(finished.correlated):null;
    const result = { ...safeResult({ head: existingEvents.at(-1)?.sequence ?? 0,previewQueued:Boolean(followup),followupJobId:followup?.job_id,moderationPromptRef }, finished.correlated.map((event) => event.eventId)), ...(failureDetail ? { errorDetail: failureDetail } : {}), stage: status, progressMessage: finished.failed ? failureProgressMessage(failureDetail) : "The operation finished." };
    await finishDocumentJob(env, row, status, result, failureDetail?.message ?? (finished.failed ? "operation_failed" : null), now);
    await reconcileParentForChild(env, row);
    return readJob(env, user.userId, jobId);
  }

  const blocker = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status IN ('queued','running') AND (requested_at<? OR (requested_at=? AND job_id<?)) ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId, row.requested_at, row.requested_at, row.job_id).first<{ job_id: string }>();
  if (blocker) return row;
  if (row.status === "running" && !rowIsStale(row)) return row;
  if (row.status === "running" && row.attempt_count >= documentJobMaxAttempts(row.kind)) { await failStaleJob(env, user, row); return readJob(env, user.userId, jobId); }

  const previousAttempt = row.attempt_count; const previousRow = { ...row }; const attempt = previousAttempt + 1;
  const now = new Date(); const nowIso = now.toISOString(); const staleBefore = new Date(now.getTime() - DOCUMENT_JOB_STALE_AFTER_MS).toISOString(); const leaseExpiresAt = new Date(now.getTime() + DOCUMENT_JOB_LEASE_MS).toISOString();
  const attemptCorrelationId = `${jobId}:attempt:${attempt}`; const initialResult = { ...parseResult(row), stage: "preparing", progressMessage: attempt > 1 ? "Recovering the interrupted operation." : "Preparing the document context." };
  const claimed = await env.DB.prepare("UPDATE document_jobs SET status='running',attempt_count=attempt_count+1,correlation_id=?,started_at=COALESCE(started_at,?),lease_expires_at=?,result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND (status='queued' OR (status='running' AND (lease_expires_at<? OR updated_at<?)))").bind(attemptCorrelationId, nowIso, leaseExpiresAt, JSON.stringify(initialResult), nowIso, jobId, user.userId, nowIso, staleBefore).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) return readJob(env, user.userId, jobId);
  if (previousAttempt > 0) await releaseInterruptedAttempt(env, user, previousRow, "execution_interrupted_retrying");
  row = await readJob(env, user.userId, jobId); if (!row) return null;

  try {
    const payload = JSON.parse(row.request_json) as Record<string, unknown>;
    const inputRef = String(payload.jobInputRef ?? "");
    if (inputRef) {
      const privateContent = await loadPrivateContent(env, user.userId); const input = privateContent[inputRef];
      if (typeof input !== "string") throw new Error("job_input_expired");
      if (row.kind === "chat") payload.message = input;
      if (row.kind === "structure_adaptive") payload.prompt = input;
    }
    delete payload.expectedSequence; delete payload.jobInputRef;
    payload.action = row.kind; payload.documentId = row.document_id; payload.sourceSurface = row.source_surface;
    payload.correlationId = row.correlation_id; payload.clientId = `server:document-job:${row.kind}`;
    await updateJobProgress(env, row, "processing", row.kind === "preview" || row.kind === "generate" ? "Planning and rendering from the current document." : "Processing the requested document change.");
    const response = await runWithHeartbeat(env, row, () => handleEvents(new Request("http://document-job.local/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), env, false, user));
    const body = await response.json() as Record<string, unknown>;let followup:DocumentJobRow|null=null;if(response.ok&&body.followupJob&&typeof body.followupJob==="object")followup=await queueFollowupPreview(env,user,row,body.followupJob as Record<string,unknown>);const completedAt = new Date().toISOString();
    const detail = !response.ok
      ? body.errorDetail && typeof body.errorDetail === "object" ? body.errorDetail as ProviderFailureDetail : applicationFailureDetail(String(body.error ?? "document_job_failed"), body.scope, response.status)
      : null;
    const terminalResult = { ...safeResult({...body,followupJobId:followup?.job_id}), ...(detail ? { errorDetail: publicFailureDetail(detail) } : {}), stage: response.ok ? "completed" : "failed", progressMessage: response.ok ? "The operation finished." : failureProgressMessage(detail) };
    await finishDocumentJob(env, row, response.ok ? "completed" : "failed", terminalResult, response.ok ? null : detail?.message ?? String(body.error ?? "document_job_failed"), completedAt);
  } catch (error) {
    const completedAt = new Date().toISOString(); const detail = classifyProviderFailure(error);
    await finishDocumentJob(env, row, "failed", { ...parseResult(row), errorDetail: publicFailureDetail(detail), stage: "failed", progressMessage: failureProgressMessage(detail) }, detail.message, completedAt);
  }
  const finishedRow = await readJob(env, user.userId, jobId); if (finishedRow) await reconcileParentForChild(env, finishedRow); return finishedRow;
}

async function driveDocumentQueue(env: WorkerEnv, user: PilotUser) {
  for (let count = 0; count < 50; count += 1) {
    const running = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status='running' ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId).first<{ job_id: string }>();
    if (running) return;
    const next = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE owner_id=? AND stream_id=? AND kind!='prompt_fan' AND status='queued' ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId).first<{ job_id: string }>();
    if (!next) return;
    const job = await runDocumentJob(env, user, next.job_id);
    if (!job || job.status === "queued" || job.status === "running") return;
  }
}

export async function handleDocumentJobs(request: Request, env: WorkerEnv, path = "", context?: WorkerExecutionContext) {
  await ensureSchema(env); const auth = await requireUser(request, env, request.method === "GET" ? "viewer" : "creator"); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE document_jobs SET request_json='{}',result_json=NULL,updated_at=? WHERE owner_id=? AND expires_at<=? AND (request_json!='{}' OR result_json IS NOT NULL)").bind(now, user.userId, now).run();

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
    const recentTerminalAfter = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const readVisibleJobs = () => env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND (status IN ('queued','running') OR notified_at IS NULL OR (kind IN ('preview','generate','prompt_fan') AND status IN ('failed','partial') AND completed_at>=?)) ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,requested_at DESC LIMIT 120").bind(user.userId, recentTerminalAfter).all<DocumentJobRow>();
    let rows = path ? requestedJob ? [requestedJob] : [] : (await readVisibleJobs()).results;
    let reconciled = false;
    const repairCandidates = rows.filter((row) => row.status === "failed" && /Wrong number of parameter bindings/i.test(row.error_message ?? ""));
    if (repairCandidates.length) {
      const events = await readEvents(env, user.streamId);
      for (const row of repairCandidates) if (await repairMisreportedTerminalJob(env, row, events)) reconciled = true;
    }
    const parents = rows.filter((row) => row.kind === "prompt_fan");
    for (const parent of parents) await reconcilePromptFanParent(env, user.userId, parent.job_id);
    reconciled = reconciled || parents.length > 0;
    for (const row of rows) if (rowIsStale(row) && row.attempt_count >= documentJobMaxAttempts(row.kind)) { await failStaleJob(env, user, row); reconciled = true; }
    if (reconciled) {
      const refreshed = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
      rows = path ? refreshed ? [refreshed] : [] : (await readVisibleJobs()).results;
    }
    if (path && !rows.length) return Response.json({ error: "job_not_found" }, { status: 404 });
    return Response.json(path ? { job: serializeJob(rows[0]) } : { jobs: rows.map(serializeJob) });
  }

  if (path || request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const consent = requireConsent(user); if (consent) return consent;
  const input = await request.json() as { kind?: string; documentId?: string; sourceSurface?: string; payload?: Record<string, unknown> };
  if (!KINDS.has(input.kind as DocumentJobKind)) return Response.json({ error: "unsupported_document_job" }, { status: 400 });
  const kind = input.kind as DocumentJobKind; const payload = input.payload && typeof input.payload === "object" ? { ...input.payload } : {};
  if (kind !== "extract_reference" && !env.OPENAI_API_KEY) return Response.json({ error: "provider_not_configured" }, { status: 503 });
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) return Response.json({ error: "document_job_payload_too_large" }, { status: 413 });
  const events = await readEvents(env, user.streamId); const projection = foldEvents(events, Number.POSITIVE_INFINITY, input.documentId);
  const documentId = String(input.documentId ?? projection.documentId); const documentRecord = projection.documents.find((document) => document.id === documentId);
  if (!documentRecord) return Response.json({ error: "document_not_found" }, { status: 404 });

  if (kind === "prompt_fan") {
    const fanKind = fanKindFromRequest(payload); if (!fanKind) return Response.json({ error: "prompt_fan_kind_required" }, { status: 400 });
    const promptFanId = typeof payload.promptFanId === "string" && payload.promptFanId ? payload.promptFanId : uuidV7();
    const documentRevision = generationRevisionFromRequest(payload, documentId); const sourcePreviewId = typeof payload.sourcePreviewId === "string" && payload.sourcePreviewId ? payload.sourcePreviewId : null;
    const parentRequestKey = String(payload.requestKey || `prompt-fan:${fanKind}:${documentRevision}:${sourcePreviewId || "document"}`);
    const activeParents = (await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND document_id=? AND kind='prompt_fan' AND status IN ('queued','running') ORDER BY requested_at DESC LIMIT 20").bind(user.userId, documentId).all<DocumentJobRow>()).results;
    const duplicate = activeParents.find((candidate) => String(parseRequest(candidate).requestKey ?? "") === parentRequestKey);
    if (duplicate) return Response.json({ job: serializeJob(await reconcilePromptFanParent(env, user.userId, duplicate.job_id) ?? duplicate), reused: true }, { status: 202 });
    const requestedAt = new Date(); const requestedAtIso = requestedAt.toISOString(); const configuredRetention = Number(env.FORMA_RETENTION_DAYS ?? 30); const retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : 30; const expiresAt = new Date(requestedAt.getTime() + retentionDays * 86_400_000).toISOString();
    const sourceSurface = String(input.sourceSurface ?? payload.sourceSurface ?? "studio").slice(0, 80) || "studio"; const requestedSequence = await streamHead(env, user.streamId); const parentId = uuidV7(); const childIds = PROMPT_TECHNIQUES.map(() => uuidV7());
    const shared = { ...payload, fanKind: undefined, requestKey: undefined, promptTechnique: undefined, promptFanId, documentRevision, sourcePreviewId };
    const parentRequest = { fanKind, promptFanId, documentRevision, sourcePreviewId, requestKey: parentRequestKey, childJobIds: childIds };
    const insert = (jobId: string, jobKind: DocumentJobKind, requestJson: Record<string, unknown>, resultJson: Record<string, unknown> | null = null) => env.DB.prepare("INSERT INTO document_jobs (job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?,?,NULL,0,?,NULL,NULL,NULL,NULL,?,?)").bind(jobId, user.userId, user.streamId, documentId, jobKind, sourceSurface, jobId, requestedSequence, JSON.stringify(requestJson), resultJson ? JSON.stringify(resultJson) : null, requestedAtIso, expiresAt, requestedAtIso);
    const members = PROMPT_TECHNIQUES.map((technique, index) => ({ jobId: childIds[index], promptTechnique: technique, status: "queued", error: null, attemptCount: 0, updatedAt: requestedAtIso }));
    const statements = [insert(parentId, "prompt_fan", parentRequest, { stage: "queued", progressMessage: "Four prompt approaches are queued as one generation.", members, completedCount: 0, failedCount: 0, totalCount: 4 }), ...PROMPT_TECHNIQUES.map((technique: PromptTechnique, index: number) => insert(childIds[index], fanKind, { ...shared, parentJobId: parentId, promptTechnique: technique, requestKey: documentGenerationRequestKey(fanKind, documentRevision, sourcePreviewId, technique, promptFanId) }))];
    await env.DB.batch(statements); const parent = await readJob(env, user.userId, parentId); context?.waitUntil(driveDocumentQueue(env, user));
    return Response.json({ job: serializeJob(parent!), accepted: true }, { status: 202 });
  }

  let active:DocumentJobRow|null=null;
  if(kind!=="extract_reference"){
    const candidates=(await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND document_id=? AND kind=? AND status IN ('queued','running') ORDER BY requested_at DESC LIMIT 50").bind(user.userId,documentId,kind).all<DocumentJobRow>()).results;
    if(kind==="preview"||kind==="generate"){
      const identity=generationRequestIdentity(kind,payload,documentId);payload.documentRevision=identity.documentRevision;payload.requestKey=identity.requestKey;
      active=candidates.find((candidate)=>generationRequestIdentity(kind,parseRequest(candidate),documentId).requestKey===identity.requestKey)??null;
    }else active=candidates[0]??null;
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

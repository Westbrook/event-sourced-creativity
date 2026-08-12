import { handleEvents } from "./events-api";
import { loadPrivateContent, releaseBudget, requireConsent, requireUser, storePrivateContent, type PilotUser } from "./pilot-policy";
import { appendAuditEvent, ensureSchema, readEvents, streamHead, uuidV7, type WorkerEnv } from "./runtime";
import { foldEvents } from "../src/model/events";
import {
  DOCUMENT_JOB_HEARTBEAT_MS,
  DOCUMENT_JOB_LEASE_MS,
  DOCUMENT_JOB_STALE_AFTER_MS,
  documentJobMaxAttempts,
  type DocumentJobKind,
  type DocumentJobStatus,
} from "../src/model/document-jobs";

type DocumentJobRow = {
  job_id: string; owner_id: string; stream_id: string; document_id: string; kind: DocumentJobKind; status: DocumentJobStatus;
  source_surface: string; correlation_id: string; requested_sequence: number; request_json: string; result_json: string | null;
  error_message: string | null; attempt_count: number; requested_at: string; started_at: string | null; completed_at: string | null;
  lease_expires_at: string | null; notified_at: string | null; expires_at: string; updated_at: string;
};

const KINDS = new Set<DocumentJobKind>(["preview", "generate", "chat", "structure_adaptive", "extract_reference"]);
const MAX_PAYLOAD_BYTES = 750_000;

function parseResult(row: Pick<DocumentJobRow, "result_json">) {
  try { return row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : {}; } catch { return {}; }
}

function serializeJob(row: DocumentJobRow) {
  const parsed = parseResult(row); const result = row.result_json ? parsed : null;
  return {
    jobId: row.job_id, documentId: row.document_id, kind: row.kind, status: row.status, sourceSurface: row.source_surface,
    requestedSequence: Number(row.requested_sequence), result, error: row.error_message, attemptCount: Number(row.attempt_count),
    requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at, notifiedAt: row.notified_at,
    leaseExpiresAt: row.lease_expires_at, updatedAt: row.updated_at,
    stage: String(parsed.stage ?? row.status), progressMessage: String(parsed.progressMessage ?? ""),
  };
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
  const result = await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message='execution_interrupted',completed_at=?,lease_expires_at=NULL,result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND status='running' AND correlation_id=?").bind(now, JSON.stringify({ ...parseResult(row), stage: "failed", progressMessage: "The server lost contact with this operation before it finished." }), now, row.job_id, user.userId, row.correlation_id).run();
  if (Number(result.meta.changes ?? 0) === 1) await releaseInterruptedAttempt(env, user, row, "execution_interrupted");
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

function safeResult(body: Record<string, unknown>, correlatedEventIds: string[] = []) {
  const appended = Array.isArray(body.appended) ? body.appended as Array<Record<string, unknown>> : [];
  return {
    head: Number(body.head ?? 0),
    appendedEventIds: appended.map((event) => String(event.eventId ?? "")).filter(Boolean).concat(correlatedEventIds),
    previewed: Boolean(body.previewed), previewQueued: Boolean(body.previewQueued), previewSuppressed: Boolean(body.previewSuppressed), followupJobId: body.followupJobId ? String(body.followupJobId) : undefined, promoted: Boolean(body.promoted), quality: body.quality ? String(body.quality) : undefined,
    structure: body.structure && typeof body.structure === "object" ? body.structure : undefined,
  };
}

async function queueFollowupPreview(env:WorkerEnv,user:PilotUser,parent:DocumentJobRow,spec:Record<string,unknown>){
  if(spec.kind!=="preview"||String(spec.documentId??"")!==parent.document_id)return null;const payload=spec.payload&&typeof spec.payload==="object"?spec.payload as Record<string,unknown>:{};if(!payload.directionRef||JSON.stringify(payload).length>MAX_PAYLOAD_BYTES)return null;
  const requestedAt=new Date();const now=requestedAt.toISOString();const configuredRetention=Number(env.FORMA_RETENTION_DAYS??30);const retentionDays=Number.isFinite(configuredRetention)&&configuredRetention>0?configuredRetention:30;const expiresAt=new Date(requestedAt.getTime()+retentionDays*86_400_000).toISOString();const jobId=uuidV7();const sourceSurface=String(spec.sourceSurface??"chat").slice(0,80)||"chat";const requestedSequence=await streamHead(env,user.streamId);
  await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message='superseded_by_newer_chat_preview',completed_at=?,notified_at=?,updated_at=? WHERE owner_id=? AND document_id=? AND kind='preview' AND source_surface='chat' AND status='queued'").bind(now,now,now,user.userId,parent.document_id).run();
  await env.DB.prepare("INSERT INTO document_jobs (job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?,NULL,NULL,0,?,NULL,NULL,NULL,NULL,?,?)").bind(jobId,user.userId,user.streamId,parent.document_id,"preview",sourceSurface,jobId,requestedSequence,JSON.stringify(payload),now,expiresAt,now).run();return readJob(env,user.userId,jobId);
}

export async function runDocumentJob(env: WorkerEnv, user: PilotUser, jobId: string) {
  await ensureSchema(env);
  let row = await readJob(env, user.userId, jobId); if (!row || row.status === "completed" || row.status === "failed") return row;

  const existingEvents = await readEvents(env, user.streamId);
  const finished = operationFinished(existingEvents, row);
  if (finished) {
    const now = new Date().toISOString(); const status: DocumentJobStatus = finished.failed ? "failed" : "completed";let followup:DocumentJobRow|null=null;
    if(!finished.failed&&row.kind==="chat"){const reasoned=finished.correlated.find((event)=>event.type==="AssistantReasoned"&&event.payload.preview_queued&&event.payload.preview_direction_ref);if(reasoned)followup=await queueFollowupPreview(env,user,row,{kind:"preview",documentId:row.document_id,sourceSurface:"chat",payload:{directionRef:reasoned.payload.preview_direction_ref,directionModel:reasoned.payload.model_id,sourceChatTurnId:reasoned.payload.turn_id}});}
    const result = { ...safeResult({ head: existingEvents.at(-1)?.sequence ?? 0,previewQueued:Boolean(followup),followupJobId:followup?.job_id }, finished.correlated.map((event) => event.eventId)), stage: status, progressMessage: finished.failed ? "The operation failed." : "The operation finished." };
    await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=?").bind(status, JSON.stringify(result), finished.failed ? "operation_failed" : null, now, now, jobId, user.userId, row.correlation_id).run();
    return readJob(env, user.userId, jobId);
  }

  const blocker = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE owner_id=? AND stream_id=? AND status IN ('queued','running') AND (requested_at<? OR (requested_at=? AND job_id<?)) ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId, row.requested_at, row.requested_at, row.job_id).first<{ job_id: string }>();
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
    const terminalResult = { ...safeResult({...body,followupJobId:followup?.job_id}), stage: response.ok ? "completed" : "failed", progressMessage: response.ok ? "The operation finished." : "The operation failed." };
    await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=?").bind(response.ok ? "completed" : "failed", JSON.stringify(terminalResult), response.ok ? null : String(body.error ?? "document_job_failed"), completedAt, completedAt, jobId, user.userId, row.correlation_id).run();
  } catch (error) {
    const completedAt = new Date().toISOString(); const message = error instanceof Error ? error.message : "document_job_failed";
    await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message=?,completed_at=?,lease_expires_at=NULL,result_json=?,updated_at=? WHERE job_id=? AND owner_id=? AND correlation_id=?").bind(message, completedAt, JSON.stringify({ ...parseResult(row), stage: "failed", progressMessage: "The operation failed." }), completedAt, jobId, user.userId, row.correlation_id).run();
  }
  return readJob(env, user.userId, jobId);
}

export async function handleDocumentJobs(request: Request, env: WorkerEnv, path = "") {
  await ensureSchema(env); const auth = await requireUser(request, env, request.method === "GET" ? "viewer" : "creator"); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE document_jobs SET request_json='{}',result_json=NULL,updated_at=? WHERE owner_id=? AND expires_at<=? AND (request_json!='{}' OR result_json IS NOT NULL)").bind(now, user.userId, now).run();

  if (path.endsWith("/ack") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -4).replace(/\/$/, ""));
    const result = await env.DB.prepare("UPDATE document_jobs SET notified_at=COALESCE(notified_at,?),updated_at=? WHERE job_id=? AND owner_id=?").bind(now, now, jobId, user.userId).run();
    return Number(result.meta.changes ?? 0) === 1 ? Response.json({ ok: true }) : Response.json({ error: "job_not_found" }, { status: 404 });
  }

  if (path.endsWith("/run") && request.method === "POST") {
    const consent = requireConsent(user); if (consent) return consent;
    const jobId = decodeURIComponent(path.slice(0, -4).replace(/\/$/, "")); const existing = await readJob(env, user.userId, jobId);
    if (!existing) return Response.json({ error: "job_not_found" }, { status: 404 });
    const job = await runDocumentJob(env, user, jobId); if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
    return Response.json({ job: serializeJob(job) }, { status: job.status === "completed" || job.status === "failed" ? 200 : 202 });
  }

  if (request.method === "GET") {
    const requestedJob = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
    let rows = path ? requestedJob ? [requestedJob] : [] : (await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND (status IN ('queued','running') OR notified_at IS NULL) ORDER BY requested_at DESC LIMIT 50").bind(user.userId).all<DocumentJobRow>()).results;
    let reconciled = false;
    for (const row of rows) if (rowIsStale(row) && row.attempt_count >= documentJobMaxAttempts(row.kind)) { await failStaleJob(env, user, row); reconciled = true; }
    if (reconciled) {
      const refreshed = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
      rows = path ? refreshed ? [refreshed] : [] : (await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND (status IN ('queued','running') OR notified_at IS NULL) ORDER BY requested_at DESC LIMIT 50").bind(user.userId).all<DocumentJobRow>()).results;
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

  const active = kind === "extract_reference" ? null : await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND document_id=? AND kind=? AND status IN ('queued','running') ORDER BY requested_at DESC LIMIT 1").bind(user.userId, documentId, kind).first<DocumentJobRow>();
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
  return Response.json({ job: serializeJob(job!) }, { status: 202 });
}

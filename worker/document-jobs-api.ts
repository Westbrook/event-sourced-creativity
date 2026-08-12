import { handleEvents } from "./events-api";
import { loadPrivateContent, requireConsent, requireUser, storePrivateContent, type PilotUser } from "./pilot-policy";
import { ensureSchema, readEvents, streamHead, uuidV7, type WorkerEnv } from "./runtime";
import { foldEvents } from "../src/model/events";

export type WorkerExecutionContext = { waitUntil(promise: Promise<unknown>): void };
export type DocumentJobKind = "preview" | "generate" | "chat" | "structure_adaptive" | "extract_reference";
type DocumentJobStatus = "queued" | "running" | "completed" | "failed";

type DocumentJobRow = {
  job_id: string; owner_id: string; stream_id: string; document_id: string; kind: DocumentJobKind; status: DocumentJobStatus;
  source_surface: string; correlation_id: string; requested_sequence: number; request_json: string; result_json: string | null;
  error_message: string | null; attempt_count: number; requested_at: string; started_at: string | null; completed_at: string | null;
  lease_expires_at: string | null; notified_at: string | null; expires_at: string; updated_at: string;
};

const KINDS = new Set<DocumentJobKind>(["preview", "generate", "chat", "structure_adaptive", "extract_reference"]);
const LEASE_MS = 10 * 60_000;
const MAX_PAYLOAD_BYTES = 750_000;

function serializeJob(row: DocumentJobRow) {
  let result: Record<string, unknown> | null = null;
  try { result = row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : null; } catch { result = null; }
  return {
    jobId: row.job_id, documentId: row.document_id, kind: row.kind, status: row.status, sourceSurface: row.source_surface,
    requestedSequence: Number(row.requested_sequence), result, error: row.error_message, attemptCount: Number(row.attempt_count),
    requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at, notifiedAt: row.notified_at,
  };
}

async function readJob(env: WorkerEnv, ownerId: string, jobId: string) {
  return env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=?").bind(jobId, ownerId).first<DocumentJobRow>();
}

async function runNextDocumentJob(env: WorkerEnv, user: PilotUser) {
  const next = await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND stream_id=? AND status='queued' ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId).first<DocumentJobRow>();
  if (next) await runDocumentJob(env, user, next.job_id);
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
    previewed: Boolean(body.previewed), promoted: Boolean(body.promoted), quality: body.quality ? String(body.quality) : undefined,
    structure: body.structure && typeof body.structure === "object" ? body.structure : undefined,
  };
}

export async function runDocumentJob(env: WorkerEnv, user: PilotUser, jobId: string) {
  await ensureSchema(env);
  let row = await readJob(env, user.userId, jobId); if (!row || row.status === "completed" || row.status === "failed") return;

  const blocker = await env.DB.prepare("SELECT job_id FROM document_jobs WHERE owner_id=? AND stream_id=? AND status IN ('queued','running') AND (requested_at<? OR (requested_at=? AND job_id<?)) ORDER BY requested_at ASC,job_id ASC LIMIT 1").bind(user.userId, user.streamId, row.requested_at, row.requested_at, row.job_id).first<{ job_id: string }>();
  if (blocker) return;

  const existingEvents = await readEvents(env, user.streamId);
  const finished = operationFinished(existingEvents, row);
  if (finished) {
    const now = new Date().toISOString(); const status: DocumentJobStatus = finished.failed ? "failed" : "completed";
    await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=?").bind(status, JSON.stringify(safeResult({ head: existingEvents.at(-1)?.sequence ?? 0 }, finished.correlated.map((event) => event.eventId))), finished.failed ? "operation_failed" : null, now, now, jobId, user.userId).run();
    await runNextDocumentJob(env, user);
    return;
  }

  const now = new Date(); const leaseExpiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
  const claimed = await env.DB.prepare("UPDATE document_jobs SET status='running',attempt_count=attempt_count+1,started_at=COALESCE(started_at,?),lease_expires_at=?,updated_at=? WHERE job_id=? AND owner_id=? AND (status='queued' OR (status='running' AND lease_expires_at<?))").bind(now.toISOString(), leaseExpiresAt, now.toISOString(), jobId, user.userId, now.toISOString()).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) return;
  row = await readJob(env, user.userId, jobId); if (!row) return;

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
    const response = await handleEvents(new Request("http://document-job.local/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }), env, false, user);
    const body = await response.json() as Record<string, unknown>; const completedAt = new Date().toISOString();
    await env.DB.prepare("UPDATE document_jobs SET status=?,result_json=?,error_message=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=?").bind(response.ok ? "completed" : "failed", JSON.stringify(safeResult(body)), response.ok ? null : String(body.error ?? "document_job_failed"), completedAt, completedAt, jobId, user.userId).run();
  } catch (error) {
    const completedAt = new Date().toISOString(); const message = error instanceof Error ? error.message : "document_job_failed";
    await env.DB.prepare("UPDATE document_jobs SET status='failed',error_message=?,completed_at=?,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND owner_id=?").bind(message, completedAt, completedAt, jobId, user.userId).run();
  }
  await runNextDocumentJob(env, user);
}

export async function handleDocumentJobs(request: Request, env: WorkerEnv, ctx: WorkerExecutionContext, path = "") {
  await ensureSchema(env); const auth = await requireUser(request, env, request.method === "GET" ? "viewer" : "creator"); if (auth.response || !auth.user) return auth.response!; const user = auth.user;
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE document_jobs SET request_json='{}',result_json=NULL,updated_at=? WHERE owner_id=? AND expires_at<=? AND (request_json!='{}' OR result_json IS NOT NULL)").bind(now, user.userId, now).run();

  if (path.endsWith("/ack") && request.method === "POST") {
    const jobId = decodeURIComponent(path.slice(0, -4).replace(/\/$/, ""));
    const result = await env.DB.prepare("UPDATE document_jobs SET notified_at=COALESCE(notified_at,?),updated_at=? WHERE job_id=? AND owner_id=?").bind(now, now, jobId, user.userId).run();
    return Number(result.meta.changes ?? 0) === 1 ? Response.json({ ok: true }) : Response.json({ error: "job_not_found" }, { status: 404 });
  }

  if (request.method === "GET") {
    const requestedJob = path ? await readJob(env, user.userId, decodeURIComponent(path)) : null;
    const rows = path ? requestedJob ? [requestedJob] : [] : (await env.DB.prepare("SELECT * FROM document_jobs WHERE owner_id=? AND (status IN ('queued','running') OR notified_at IS NULL) ORDER BY requested_at DESC LIMIT 50").bind(user.userId).all<DocumentJobRow>()).results;
    for (const row of rows) if (row.status === "queued" || row.status === "running" && (!row.lease_expires_at || row.lease_expires_at < now)) ctx.waitUntil(runDocumentJob(env, user, row.job_id));
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
  if (active) { ctx.waitUntil(runDocumentJob(env, user, active.job_id)); return Response.json({ job: serializeJob(active), reused: true }, { status: 202 }); }

  if (kind === "chat" || kind === "structure_adaptive") {
    const field = kind === "chat" ? "message" : "prompt"; const text = String(payload[field] ?? "").trim();
    if (!text) return Response.json({ error: kind === "chat" ? "chat_message_required" : "adaptive_intent_required" }, { status: 400 });
    if (text.length > (kind === "chat" ? 4000 : 2000)) return Response.json({ error: kind === "chat" ? "chat_message_too_long" : "adaptive_intent_too_long" }, { status: 400 });
    const stored = await storePrivateContent(env, user.userId, kind === "chat" ? "chat-user" : "adaptive-intent", text); payload[field] = undefined; payload.jobInputRef = stored.contentId;
  }

  const jobId = uuidV7(); const requestedAt = new Date(); const configuredRetention = Number(env.FORMA_RETENTION_DAYS ?? 30); const retentionDays = Number.isFinite(configuredRetention) && configuredRetention > 0 ? configuredRetention : 30; const expiresAt = new Date(requestedAt.getTime() + retentionDays * 86_400_000).toISOString();
  const sourceSurface = String(input.sourceSurface ?? payload.sourceSurface ?? "studio").slice(0, 80) || "studio"; const requestedSequence = await streamHead(env, user.streamId);
  await env.DB.prepare("INSERT INTO document_jobs (job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,error_message,attempt_count,requested_at,started_at,completed_at,lease_expires_at,notified_at,expires_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?,NULL,NULL,0,?,NULL,NULL,NULL,NULL,?,?)").bind(jobId, user.userId, user.streamId, documentId, kind, sourceSurface, jobId, requestedSequence, JSON.stringify(payload), requestedAt.toISOString(), expiresAt, requestedAt.toISOString()).run();
  const job = await readJob(env, user.userId, jobId); ctx.waitUntil(runDocumentJob(env, user, jobId));
  return Response.json({ job: serializeJob(job!) }, { status: 202 });
}

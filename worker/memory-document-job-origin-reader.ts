import type { WorkerEnv } from "./runtime.ts";
import { canonicalConsent, executionAdmissionGuard } from "./consequential-consent.ts";
import { publicEventPayload } from "./event-privacy.ts";
import { nativeDocumentJobOriginSchema } from "./memory-document-job-origin-schema.ts";
import { DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS, validateDocumentJobOriginRecord,
  type DocumentJobOriginHeader } from "./memory-document-job-origin-record.ts";
import type { DocumentJobOriginManifest } from "./memory-document-job-origin-manifest.ts";
import { nativeMemoryAnswerExclusion } from "./memory-native-boundary.ts";
import { nativeMemoryCanonical, nativeMemoryFingerprint, nativeMemoryAnswerFingerprint,
  nativeMemorySourceProjection, nativeStructuredOriginalProjection } from "./memory-native-origin.ts";
import { liveMemoryAuthority, liveMemoryEnrollmentGuard,
  type LiveMemoryEnrollment } from "./memory-live-authority.ts";
import { liveMemorySourceQuery } from "./memory-live-sources.ts";
import { liveMemoryLifetimeProjection, liveMemorySourceDeadline } from "./memory-live-source-lifetime.ts";
import { nativeMemoryGrantDeadline, nativeMemoryPilotQuery, nativeMemoryPilotDeadline,
  nativeMemoryTimestamp as timestamp } from "./memory-native-deadlines.ts";
import { prepareNativeMemorySelection, nativeMemorySelectionStatements, nativeMemorySelectionMatches,
  discoverNativeStructuredConversationOriginals } from "./memory-live-store.ts";
import { prepareNativeStructuredConversationContext, nativeStructuredConversationContextEvidence,
  revalidateNativeStructuredConversationProjection, nativeStructuredConversationContextPrecommitStatements,
  nativeStructuredConversationContextMatches, type NativeMemoryPreparedDocument,
  type PreparedNativeStructuredConversationContext, type NativeDocumentMemoryContext,
  type NativeStructuredConversationContext } from "./memory-live-context.ts";
import { nativeMemoryAssistantReply, nativeStructuredMemoryAssistantReply } from "./memory-assistant-reply.ts";

type Value = string | number | null;
type Row = Record<string, Value>;
type Query = { sql: string; bindings: Value[] };
type Header = DocumentJobOriginHeader;
type Manifest = DocumentJobOriginManifest;
type Extractive = Extract<Manifest, { mode: "extractive" }>;
type Structured = Extract<Manifest, { mode: "structured" }>;
type Guard = { sql: string; bindings: Value[] };
export type DocumentJobOriginReadTarget = Readonly<{ originId: string; jobId: string }>;
export type DocumentJobOriginRead = Readonly<{
  status: "current"; originId: string; jobId: string; turnId: string;
  text: string; locale: "en" | "fr" | "ar" | "ja"; validUntil: string; fallbackAllowed: false;
}> | Readonly<{ status: "unavailable"; fallbackAllowed: false }>;
const unavailable = Object.freeze({ status: "unavailable", fallbackAllowed: false } as const);
const H = "memory_document_job_answer_origins", D = "memory_document_job_origin_dependencies";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const BODY_COLUMNS = "content_id,owner_id,kind,content,created_at,expires_at,redacted_at";
const EVENT_COLUMNS = "event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,causation_id,compensates_event_id,schema_version,type,payload";
const CLAIM_COLUMNS = ["job_id","owner_id","stream_id","document_id","kind","status","source_surface","correlation_id",
  "requested_sequence","request_json","error_message","attempt_count","requested_at","started_at","completed_at","lease_expires_at","notified_at","expires_at"] as const;
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 240 && v.isWellFormed();
const bytes = (v: string) => new TextEncoder().encode(v).byteLength;
const fail = (): never => { throw new Error("document_job_origin_read_unavailable"); };
const text = (row: Row | Header, key: string) => typeof row[key as keyof typeof row] === "string" ? row[key as keyof typeof row] as string : fail();
const number = (row: Row | Header, key: string) => typeof row[key as keyof typeof row] === "number" && Number.isSafeInteger(row[key as keyof typeof row]) ? row[key as keyof typeof row] as number : fail();
const query = (sql: string, bindings: readonly Value[] = []): Query => {
  if (!sql || sql.length > 90_000 || bindings.length > 99 || bindings.some(v => v !== null && typeof v !== "string"
    && !(typeof v === "number" && Number.isSafeInteger(v)))) return fail();
  return { sql, bindings: [...bindings] };
};
function data<T>(object: object, key: PropertyKey): T {
  const d = Object.getOwnPropertyDescriptor(object, key);
  if (!d || !d.enumerable || !("value" in d)) return fail();
  return d.value as T;
}
function rowsOf(result: unknown): Row[] {
  if (!result || typeof result !== "object" || Array.isArray(result) || data(result, "success") !== true) return fail();
  const error = Object.getOwnPropertyDescriptor(result, "error");
  if ("error" in result && !error || error && (!("value" in error) || error.value !== undefined)) return fail();
  const rows = data<unknown>(result, "results");
  if (!Array.isArray(rows) || rows.length > 514 || Reflect.ownKeys(rows).length !== rows.length + 1) return fail();
  let size = 0;
  return Array.from({ length: rows.length }, (_, index) => {
    const value = data<unknown>(rows, String(index));
    if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail();
    const out: Row = Object.create(null), keys = Reflect.ownKeys(value);
    if (keys.length > 96) return fail();
    for (const key of keys) {
      if (typeof key !== "string") return fail();
      const item = data<unknown>(value, key);
      if (item !== null && typeof item !== "string" && !(typeof item === "number" && Number.isSafeInteger(item))) return fail();
      if (typeof item === "string" && (!item.isWellFormed() || bytes(item) > 131_072)) return fail();
      out[key] = item as Value; size += bytes(key) + (typeof item === "string" ? bytes(item) : 16);
      if (size > 1_048_576) return fail();
    }
    return Object.freeze(out);
  });
}
function receipt(result: unknown, count: number): { results: Row[]; success: true }[] {
  if (!Array.isArray(result) || result.length !== count || Reflect.ownKeys(result).length !== count + 1) return fail();
  return Array.from({ length: count }, (_, index) => ({ success: true, results: rowsOf(data(result, String(index))) }));
}
const rowKey = (rows: readonly Row[]) => JSON.stringify(rows.map(row => Object.keys(row).sort().map(key => [key, row[key]])));
const one = (rows: readonly Row[]): Row => rows.length === 1 ? rows[0] : fail();
const asserted = (rows: readonly Row[], key: string) => rows.length === 1 && Object.keys(rows[0]).length === 1 && rows[0][key] === 1;
const enrollmentKeys = ["enrollment_id","actor_user_id","owner_user_id","organization_id","project_access_id","project_id","document_id",
  "revision","policy_version","permission_epoch","enrolled_at","expires_at","retention_days"] as const;
function enrollmentMatches(e: LiveMemoryEnrollment, m: Manifest) {
  return enrollmentKeys.every(key => e[key] === m.enrollment[key]) && e.recall_enabled === 1
    && Number.isSafeInteger(e.cursor_sequence) && e.cursor_sequence >= m.enrollment.cursor_sequence
    && (e.cutoff_sequence === null || e.cutoff_sequence >= e.cursor_sequence);
}
function bodyCustody(prepared: NativeMemoryPreparedDocument): Guard {
  const p = prepared.principal, s = prepared.binding.scope;
  if (!s) return { sql: "NOT EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='content' AND r.resource_id=body.content_id)"
    + " AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes r WHERE r.content_id=body.content_id)", bindings: [] };
  return { sql: `(SELECT COUNT(*) FROM project_resource_scopes r WHERE r.resource_kind='content' AND r.resource_id=body.content_id)=1
    AND EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='content' AND r.resource_id=body.content_id
      AND (r.organization_id,r.project_access_id,r.project_id,r.owner_user_id,r.actor_user_id,r.visibility)
        IS (?,?,?,?,?,'actor_private') AND r.source_event_id IS NULL AND r.created_at=body.created_at)
    AND (SELECT COUNT(*) FROM private_content_retention_scopes r WHERE r.content_id=body.content_id)=1
    AND EXISTS(SELECT 1 FROM private_content_retention_scopes r WHERE r.content_id=body.content_id
      AND (r.organization_id,r.project_access_id,r.project_id,r.actor_user_id,r.classification) IS (?,?,?,?,'transient-private')
      AND r.created_at=body.created_at AND typeof(r.policy_version)='integer' AND r.policy_version>=0
      AND r.assigned_expires_at>${NOW})`, bindings: [s.organizationId,s.projectAccessId,s.projectId,s.ownerUserId,p.userId,
        s.organizationId,s.projectAccessId,s.projectId,p.userId] };
}

/** Dedicated GET/recovery path for an already registered job origin. A missing,
 * malformed or unavailable record is ALWAYS unavailable, never ordinary/provider
 * fallback. Stored material is comparison data: this function issues no claim,
 * changes no state, and does not renew the original publication lease. Plaintext
 * is returned only after the complete current proof and exact own/source rows
 * have matched in one final native batch. No assistant_turns or client receipts
 * are invented for the new two-event/three-body job-native footprint. */
export async function readDocumentJobMemoryOrigin(env: WorkerEnv, prepared: NativeMemoryPreparedDocument,
  target: DocumentJobOriginReadTarget): Promise<DocumentJobOriginRead> {
  try {
    const db = env.DB, started = Date.now(), originalKey = canonicalConsent(prepared), targetKey = canonicalConsent(target);
    const captured = structuredClone(prepared), wanted = structuredClone(target);
    const settings = () => JSON.stringify([env.FORMA_MEMORY_ENABLED, env.FORMA_MEMORY_USER_IDS, env.FORMA_PILOT_COHORT_ID,
      env.FORMA_ADMIN_EMAILS, env.FORMA_RETENTION_DAYS]);
    const originalSettings = settings(); let until = started + 60_000;
    const current = () => env.DB === db && settings() === originalSettings && canonicalConsent(prepared) === originalKey
      && canonicalConsent(target) === targetKey && Date.now() < until;
    const step = async <T>(work: () => Promise<T>): Promise<T> => {
      if (!current()) return fail(); const value = await work(); if (!current()) return fail(); return value;
    };
    const bound = (value: unknown, optional = false) => {
      if (optional && value === null) return;
      const at = timestamp(value); if (at === null || at <= Date.now()) return fail(); until = Math.min(until, at);
    };
    if (!wanted || Reflect.ownKeys(wanted).length !== 2 || !id(wanted.originId) || !id(wanted.jobId)
      || !captured?.principal || !captured.binding || captured.principal.fictional || !captured.principal.authorizationSnapshot
      || env.FORMA_MEMORY_ENABLED !== "true" || !(env.FORMA_MEMORY_USER_IDS ?? "").split(",").map(s => s.trim()).includes(captured.principal.userId)) return unavailable;
    const { principal, binding } = captured, scope = binding.scope;
    if (principal.userId !== binding.actorUserId || principal.access.permissionEpoch !== binding.permissionEpoch
      || !id(binding.projectId) || !id(binding.documentId) || binding.streamId !== `creative:${scope?.ownerUserId ?? principal.userId}`
      || scope && (scope.actorUserId !== principal.userId || scope.projectId !== binding.projectId)) return unavailable;
    bound(nativeMemoryGrantDeadline(principal, started), true);
    const selection = await step(() => prepareNativeMemorySelection(env, captured));
    if (!selection) return unavailable;
    const e = selection.enrollment;
    const schema = await step(() => nativeDocumentJobOriginSchema(env)); if (!schema.present) return unavailable;
    const authority = await step(() => liveMemoryAuthority(env, e)); if (!authority) return unavailable;
    if (canonicalConsent(authority.binding.scope) !== canonicalConsent(scope)) return unavailable;
    bound(nativeMemoryGrantDeadline(authority.principal, started), true); bound(e.expires_at);
    const request = executionAdmissionGuard(principal, binding, null), recall = liveMemoryEnrollmentGuard(e, "recall");
    const guards: Guard[] = [request, { sql: authority.guard.condition, bindings: [...authority.guard.bindings] },
      { sql: recall.condition, bindings: [...recall.bindings] }, { sql: schema.guard.condition, bindings: [...schema.guard.bindings] }];
    let structured: PreparedNativeStructuredConversationContext | null = null;
    const observed: { query: Query; rows: Row[] }[] = [];
    const ownProof = () => {
      if (!current()) return fail();
      const selectionStatements = nativeMemorySelectionStatements(env, selection);
      const structuredStatements = structured ? nativeStructuredConversationContextPrecommitStatements(env, structured.proof) : [];
      if (!selectionStatements?.length || !structuredStatements || structured && !structuredStatements.length) return fail();
      const assertions = guards.map(guard => db.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1
        ELSE json('document_job_origin_read_denied') END AS job_origin_read_verified`).bind(...guard.bindings));
      assertions.push(db.prepare(`SELECT CASE WHEN ${NOW}<? THEN 1 ELSE json('document_job_origin_read_expired') END AS job_origin_read_verified`)
        .bind(new Date(until).toISOString()));
      return { selectionStatements, structuredStatements, assertions,
        statements: [...selectionStatements, ...structuredStatements, ...assertions] };
    };
    const matched = (results: ReturnType<typeof receipt>, proof: ReturnType<typeof ownProof>) => {
      const a = proof.selectionStatements.length, b = proof.structuredStatements.length;
      return results.length === proof.statements.length && results.slice(0,a+b).every(result => asserted(result.results,"context_source_asserted"))
        && nativeMemorySelectionMatches(env, selection, results.slice(0,a) as D1Result<Row>[])
        && (!structured || nativeStructuredConversationContextMatches(env, structured, results.slice(a,a+b) as D1Result<Row>[]))
        && results.slice(a+b).every(result => asserted(result.results,"job_origin_read_verified"));
    };
    const read = async (queries: readonly Query[], retain = true): Promise<Row[][]> => {
      const proof = ownProof(), statements = queries.map(q => db.prepare(q.sql).bind(...q.bindings));
      const raw = await step(() => db.batch<Row>([...proof.statements,...statements,...proof.statements]));
      const results = receipt(raw, proof.statements.length * 2 + statements.length), n = proof.statements.length;
      if (!matched(results.slice(0,n),proof) || !matched(results.slice(-n),proof) || !current()) return fail();
      const rows = results.slice(n,n+statements.length).map(result => result.results);
      if (retain) queries.forEach((q,index) => observed.push({ query: q, rows: rows[index] }));
      return rows;
    };
    const initial = await read([query(`SELECT ${DOCUMENT_JOB_ORIGIN_HEADER_COLUMNS.join(",")} FROM ${H}
      WHERE origin_id=? AND job_id=? AND actor_user_id=? AND owner_user_id=? AND organization_id IS ?
      AND project_access_id IS ? AND project_id=? AND document_id=? LIMIT 2`, [wanted.originId,wanted.jobId,principal.userId,
        scope?.ownerUserId ?? principal.userId,scope?.organizationId ?? null,scope?.projectAccessId ?? null,binding.projectId,binding.documentId])]);
    const h = one(initial[0]) as Header;
    if (h.status !== "active" || h.stream_id !== binding.streamId || h.permission_epoch !== principal.access.permissionEpoch) return unavailable;
    const custody = bodyCustody(captured);
    const bodyQuery = (ref: string, kind: string, limit: number) => query(`SELECT ${BODY_COLUMNS} FROM private_content body
      WHERE body.content_id=? AND body.owner_id=? AND body.kind=? AND body.redacted_at IS NULL AND body.expires_at>${NOW}
      AND length(CAST(body.content AS BLOB))<=? AND (${custody.sql}) LIMIT 2`, [ref,principal.userId,kind,limit,...custody.bindings]);
    const manifestRows = await read([bodyQuery(text(h,"manifest_content_ref"),"memory-document-job-origin",65_536),
      query(`SELECT origin_id,resource_kind,resource_id FROM ${D} WHERE origin_id=? ORDER BY resource_kind,resource_id LIMIT 514`,[wanted.originId])]);
    const manifestBody = one(manifestRows[0]);
    const record = await step(() => validateDocumentJobOriginRecord(h,text(manifestBody,"content"),manifestRows[1]));
    if (!record) return unavailable;
    const manifest = JSON.parse(record.manifest.text) as Manifest;
    if (!enrollmentMatches(e,manifest) || selection.mode !== manifest.mode) return unavailable;
    for (const value of [h.input_expires_at,h.job_expires_at,h.enrollment_expires_at,h.answer_expires_at,h.manifest_expires_at,
      h.source_retention_ceiling]) bound(value);
    // Current lease is new and independently bounded; historical proof_valid_until
    // and job_lease_expires_at are compared but NEVER become today's authority.
    const configured = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
    const breakglass = (env.FORMA_ADMIN_EMAILS ?? "").split(",").map(v=>v.trim().toLowerCase()).includes(principal.email.toLowerCase());
    if (configured && !breakglass) bound(nativeMemoryPilotDeadline((await read([nativeMemoryPilotQuery(configured)]))[0],configured,started),true);
    if (binding.contextSessionId) {
      const session = one((await read([query("SELECT context_id,principal_user_id,organization_id,project_access_id,expires_at,revoked_at FROM project_context_sessions WHERE context_id=? AND principal_user_id=? AND organization_id IS ? AND project_access_id IS ? LIMIT 2",
        [binding.contextSessionId,principal.userId,scope?.organizationId ?? null,scope?.projectAccessId ?? null])]))[0]);
      if (session.revoked_at !== null) return unavailable; bound(session.expires_at);
    }
    const clock = one((await read([query(`SELECT ${NOW} AS checked_at`)],false))[0]);
    const checked = timestamp(clock.checked_at); if (checked === null || checked < started-60_000) return unavailable;
    until = Math.min(until,checked+60_000);
    const input = one((await read([bodyQuery(text(h,"input_content_ref"),"chat-user",16_000)]))[0]);
    const user = one((await read([bodyQuery(text(h,"user_content_id"),"chat-user",16_000)]))[0]);
    const answer = one((await read([bodyQuery(text(h,"answer_content_id"),"chat-assistant-memory",8_192)]))[0]);
    const bodies = [user,answer,manifestBody], refs = [...bodies.map(b=>text(b,"content_id")),text(h,"input_content_ref")];
    if (new Set([wanted.originId,wanted.jobId,text(h,"turn_id"),text(h,"input_content_ref"),...bodies.map(b=>text(b,"content_id")),text(h,"user_event_id"),text(h,"answer_event_id")]).size !== 9) return unavailable;
    for (const body of [...bodies,input]) {
      const at = timestamp(body.created_at); if (at === null || at > numberTime(h,"created_at") || !text(body,"content").trim()) return unavailable;
      bound(body.expires_at);
    }
    if (numberTime(user,"created_at") < Date.parse(manifest.lifetime.capturedAt)
      || numberTime(manifestBody,"created_at") < numberTime(user,"created_at")
      || numberTime(answer,"created_at") < numberTime(manifestBody,"created_at")) return unavailable;
    if (input.expires_at !== h.input_expires_at || answer.expires_at !== h.answer_expires_at || manifestBody.expires_at !== h.manifest_expires_at
      || numberTime(user,"expires_at") < numberTime(manifestBody,"expires_at") || numberTime(user,"expires_at") > Math.min(numberTime(h,"source_retention_ceiling"),numberTime(h,"input_expires_at"),numberTime(h,"job_expires_at"))
      || user.content !== input.content || await step(()=>nativeMemoryAnswerFingerprint(text(input,"content"))) !== h.input_sha256
      || await step(()=>nativeMemoryAnswerFingerprint(text(answer,"content"))) !== h.answer_sha256) return unavailable;
    const retention = (await read([query("SELECT content_id,organization_id,project_access_id,project_id,actor_user_id,classification,assigned_expires_at,policy_version,created_at FROM private_content_retention_scopes WHERE content_id IN(SELECT value FROM json_each(?)) ORDER BY content_id,project_access_id LIMIT 9",[JSON.stringify(refs)])]))[0];
    if (scope) {
      if (retention.length !== 4) return unavailable;
      for (const body of [...bodies,input]) {
        const row = one(retention.filter(r=>r.content_id===body.content_id));
        if (row.created_at !== body.created_at || row.organization_id !== scope.organizationId || row.project_access_id !== scope.projectAccessId
          || row.project_id !== scope.projectId || row.actor_user_id !== principal.userId || row.classification !== "transient-private"
          || !Number.isSafeInteger(row.policy_version) || number(row,"policy_version") < 0 || bodies.includes(body) && row.assigned_expires_at !== body.expires_at) return unavailable;
        bound(row.assigned_expires_at);
      }
    } else if (retention.length) return unavailable;
    const job = one((await read([query(`SELECT ${CLAIM_COLUMNS.join(",")},result_json,updated_at FROM document_jobs WHERE job_id=? AND owner_id=? LIMIT 2`,[wanted.jobId,principal.userId])]))[0]);
    if (!await step(()=>jobMatches(h,job,input,step))) return unavailable;
    const currentHead = one((await read([query("SELECT COALESCE(MAX(sequence),0) AS source_head FROM events WHERE stream_id=?",[binding.streamId])]))[0]);
    const head = number(currentHead,"source_head"); if (head < number(h,"answer_source_sequence")) return unavailable;
    if (!await certifyFootprint(h,captured,bodies,read)) return unavailable;
    const context = manifest.mode === "structured" ? await step(async () => {
      const preparedSource = { ...captured, sourceHead: head };
      const discovered = await step(()=>discoverNativeStructuredConversationOriginals(env,preparedSource,selection,manifest.intervals));
      if (!discovered) return null;
      structured = await step(()=>prepareNativeStructuredConversationContext(env,e,preparedSource,discovered.captures,
        manifest.projectionOptions.specifiedMaxBytes ? { maxBytes: manifest.projectionOptions.maxBytes } : {}));
      if (!structured) return null;
      const evidence = await step(()=>nativeStructuredConversationContextEvidence(env,structured!));
      if (!evidence || !await structuredMatches(manifest,evidence,step)
        || !await step(()=>revalidateNativeStructuredConversationProjection(env,structured!,manifest.contextJson,manifest.projectionOptions))) return null;
      bound(structured.context.lifetime.validUntil); bound(evidence.sourceEvidence.sourceRetentionCeiling);
      return JSON.parse(manifest.contextJson) as NativeStructuredConversationContext;
    }) : await certifyExtractive(env,manifest,e,authority,read,step,bound);
    if (!context) return unavailable;
    const rendered = manifest.mode === "structured"
      ? nativeStructuredMemoryAssistantReply(context as NativeStructuredConversationContext,manifest.renderer.locale)
      : nativeMemoryAssistantReply(context as NativeDocumentMemoryContext,manifest.renderer.locale);
    if (!rendered || rendered !== answer.content || !current()) return unavailable;
    // No intermediate proof or hash result permits delivery. Re-read EVERY exact
    // stored row plus all genuine native selection/source proofs in this batch.
    const proof = ownProof(), queries = observed.map(entry=>entry.query), n = proof.statements.length;
    const raw = await step(()=>db.batch<Row>([...proof.statements,...queries.map(q=>db.prepare(q.sql).bind(...q.bindings)),...proof.statements]));
    const final = receipt(raw,n*2+queries.length);
    if (!matched(final.slice(0,n),proof) || !matched(final.slice(-n),proof)
      || observed.some((entry,index)=>rowKey(entry.rows)!==rowKey(final[n+index].results)) || !current()) return unavailable;
    return Object.freeze({ status:"current",originId:wanted.originId,jobId:wanted.jobId,turnId:text(h,"turn_id"),text:rendered,
      locale:manifest.renderer.locale,validUntil:new Date(until).toISOString(),fallbackAllowed:false });
  } catch { return unavailable; }
}
function numberTime(row: Row | Header, key: string): number {
  const at = timestamp(row[key as keyof typeof row]); return at === null ? fail() : at;
}
type Read = (queries: readonly Query[], retain?: boolean) => Promise<Row[][]>;
type Step = <T>(work: () => Promise<T>) => Promise<T>;
async function jobMatches(h: Header, job: Row, input: Row, step: Step): Promise<boolean> {
  if (job.job_id !== h.job_id || job.owner_id !== h.actor_user_id || job.stream_id !== h.stream_id || job.document_id !== h.document_id
    || job.kind !== "chat" || job.source_surface !== "chat" || job.status !== "completed" || job.error_message !== null
    || job.lease_expires_at !== null || job.completed_at !== h.created_at || job.updated_at !== h.created_at
    || job.attempt_count !== h.attempt_count || job.correlation_id !== h.correlation_id || job.requested_sequence !== h.requested_sequence
    || job.requested_at !== h.job_requested_at || job.started_at !== h.job_started_at || job.expires_at !== h.job_expires_at
    || job.result_json !== JSON.stringify({memoryDocumentJobOrigin:{version:1,originId:h.origin_id},stage:"completed",noAutomaticRetry:true})
    || typeof job.request_json !== "string" || bytes(job.request_json) > 65_536) return false;
  const request = JSON.parse(job.request_json) as Record<string,unknown>;
  if (!request || typeof request !== "object" || Array.isArray(request) || request.jobInputRef !== input.content_id) return false;
  // Historical row comparison only, NEVER a running claim or authority. AP left
  // notified_at unchanged but did not store it separately. If later notification
  // housekeeping altered it, this comparison denies instead of guessing NULL.
  const original: Row = {...job,status:"running",error_message:null,completed_at:null,lease_expires_at:h.job_lease_expires_at};
  return await step(()=>nativeMemoryAnswerFingerprint(text(job,"request_json"))) === h.request_sha256
    && await step(()=>nativeMemoryAnswerFingerprint(JSON.stringify(CLAIM_COLUMNS.map(key=>original[key])))) === h.claim_sha256;
}
async function certifyFootprint(h: Header, prepared: NativeMemoryPreparedDocument, bodies: readonly Row[], read: Read): Promise<boolean> {
  const scope = prepared.binding.scope, actor = prepared.principal.userId, userId = text(h,"user_event_id"), answerId = text(h,"answer_event_id");
  const ids = [userId,answerId], bodyIds = bodies.map(body=>text(body,"content_id")), all = [...ids,...bodyIds];
  const rows = await read([
    query(`SELECT ${EVENT_COLUMNS} FROM events WHERE event_id IN(?,?) ORDER BY sequence LIMIT 3`,ids),
    query(`SELECT private_event_id,owner_id,project_id,document_id,private_json,created_at,redacted_at FROM event_private_payloads
      WHERE private_event_id IN(?,?) AND owner_id=? AND project_id=? AND document_id=? ORDER BY private_event_id LIMIT 3`,
      [...ids,text(h,"owner_user_id"),text(h,"project_id"),text(h,"document_id")]),
    query("SELECT private_event_id FROM event_private_payloads WHERE private_event_id IN(?,?) ORDER BY private_event_id LIMIT 3",ids),
    query("SELECT event_id FROM events WHERE stream_id=? AND correlation_id=? AND sequence>? ORDER BY sequence LIMIT 3",
      [text(h,"stream_id"),text(h,"correlation_id"),number(h,"source_head")]),
    query("SELECT event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at FROM project_event_scopes WHERE event_id IN(?,?) ORDER BY source_sequence LIMIT 3",ids),
    query("SELECT organization_id,project_access_id,project_id,owner_user_id,actor_user_id,source_event_id,visibility FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=? ORDER BY project_access_id LIMIT 2",[text(h,"job_id")]),
    query(`SELECT origin_id FROM ${H} WHERE origin_id<>? AND (job_id=? OR (actor_user_id,scope_key,turn_id)=(?,?,?)
      OR user_event_id IN(SELECT value FROM json_each(?)) OR answer_event_id IN(SELECT value FROM json_each(?))
      OR user_content_id IN(SELECT value FROM json_each(?)) OR answer_content_id IN(SELECT value FROM json_each(?))
      OR manifest_content_ref IN(SELECT value FROM json_each(?)) OR input_content_ref IN(SELECT value FROM json_each(?))) LIMIT 1`,
      [text(h,"origin_id"),text(h,"job_id"),actor,text(h,"scope_key"),text(h,"turn_id"),...Array(6).fill(JSON.stringify(all))]),
    query(`SELECT origin_id FROM ${D} WHERE resource_kind IN('event','private-content') AND resource_id IN(SELECT value FROM json_each(?)) LIMIT 1`,[JSON.stringify(all)]),
    query("SELECT event_id FROM events WHERE event_id IN(SELECT value FROM json_each(?)) LIMIT 1",[JSON.stringify(bodyIds)]),
    query("SELECT content_id FROM private_content WHERE content_id IN(?,?) LIMIT 1",ids),
  ]);
  if (rows[0].length !== 2 || rows[3].length !== 2 || rows.slice(6).some(row=>row.length)) return false;
  if (rows[3].some((row,index)=>row.event_id !== ids[index]) || rows[2].length !== rows[1].length) return false;
  for (const [index,event] of rows[0].entries()) {
    const body = bodies[index], eventId = ids[index];
    if (event.event_id !== eventId || event.stream_id !== h.stream_id || event.sequence !== number(h,"source_head")+index+1
      || event.type !== (index ? "AssistantReasoned" : "ChatMessageSent") || event.actor !== (index ? "worker:memory" : `user:${actor}`)
      || event.client_id !== "server:document-job:chat" || event.correlation_id !== h.correlation_id || event.causation_id !== (index ? userId : null)
      || event.compensates_event_id !== null || event.schema_version !== 1 || event.occurred_at !== event.recorded_at
      || numberTime(event,"recorded_at") > numberTime(h,"created_at") || numberTime(event,"recorded_at") < numberTime(body,"created_at")
      || index && numberTime(event,"recorded_at") < numberTime(rows[0][0],"recorded_at")) return false;
    const payload = {operation:"document-job-memory",job_id:h.job_id,turn_id:h.turn_id,project_id:h.project_id,document_id:h.document_id,
      content_ref:body.content_id,content_expires_at:body.expires_at,source_surface:"chat",
      ...(index ? {memory_origin_version:3,answer_only:true,locale:h.locale} : {})};
    const encoded = publicEventPayload(eventId,payload,true), privateRows = rows[1].filter(row=>row.private_event_id===eventId);
    if (event.payload !== JSON.stringify(encoded.payload)) return false;
    if (encoded.privateJson === null) { if (privateRows.length) return false; }
    else {
      const secret = one(privateRows);
      if (secret.private_json !== encoded.privateJson || secret.owner_id !== h.owner_user_id || secret.project_id !== h.project_id
        || secret.document_id !== h.document_id || secret.created_at !== event.recorded_at || secret.redacted_at !== null) return false;
    }
  }
  if (scope) {
    if (rows[4].length !== 2 || rows[5].length !== 1) return false;
    for (const [index,event] of rows[4].entries()) if (event.event_id !== ids[index] || event.project_access_id !== scope.projectAccessId
      || event.organization_id !== scope.organizationId || event.project_id !== scope.projectId || event.owner_user_id !== scope.ownerUserId
      || event.source_stream_id !== h.stream_id || event.source_sequence !== number(h,"source_head")+index+1
      || event.project_sequence !== number(h,"project_source_head")+index+1 || event.actor_user_id !== actor || event.created_at !== h.created_at) return false;
    const job = rows[5][0];
    if (job.organization_id !== scope.organizationId || job.project_access_id !== scope.projectAccessId || job.project_id !== scope.projectId
      || job.owner_user_id !== scope.ownerUserId || job.actor_user_id !== actor || job.visibility !== "actor_private" || !id(job.source_event_id)) return false;
    const anchor = one((await read([query(`SELECT event_id FROM events WHERE event_id=? AND stream_id=? AND actor=?
      AND type='ProjectDocumentJobQueued' AND json_extract(payload,'$.job_id')=? AND json_extract(payload,'$.organization_id')=?
      AND json_extract(payload,'$.project_access_id')=? AND json_extract(payload,'$.actor_user_id')=? LIMIT 2`,
      [job.source_event_id,text(h,"stream_id"),`user:${actor}`,text(h,"job_id"),scope.organizationId,scope.projectAccessId,actor])]))[0]);
    if (anchor.event_id !== job.source_event_id) return false;
    const migration = one((await read([query(`SELECT project_access_id,organization_id,owner_user_id,status,last_owner_sequence FROM project_migration_states
      WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active'
      AND last_owner_sequence=(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) LIMIT 2`,
      [scope.projectAccessId,scope.organizationId,scope.ownerUserId,text(h,"stream_id")])]))[0]);
    if (number(migration,"last_owner_sequence") < number(h,"answer_source_sequence")) return false;
  } else if (rows[4].length || rows[5].length) return false;
  // Optional historical protocols contribute only cross-registration exclusions;
  // their headers/capabilities/turns are never used to authorize this job answer.
  const optional = (await read([query("SELECT name FROM sqlite_schema WHERE type='table' AND name IN('memory_native_answer_origins','memory_native_answer_dependencies','memory_structured_answer_origins','memory_structured_answer_originals','memory_structured_answer_ledger_revisions') ORDER BY name")]))[0];
  const present = new Set(optional.map(row=>text(row,"name"))), checks: Query[] = [];
  const add = (table: string, columns: readonly string[]) => checks.push(query(`SELECT 1 AS conflict FROM ${table}
    WHERE ${columns.map(column=>`${column} IN(SELECT value FROM json_each(?))`).join(" OR ")} LIMIT 1`,columns.map(()=>JSON.stringify(all))));
  if (present.has("memory_native_answer_origins") !== present.has("memory_native_answer_dependencies")) return false;
  if (present.has("memory_native_answer_origins")) {
    checks.push(query("SELECT origin_id FROM memory_native_answer_origins WHERE (actor_user_id,scope_key,turn_id)=(?,?,?) LIMIT 1",[actor,text(h,"scope_key"),text(h,"turn_id")]));
    add("memory_native_answer_origins",["user_event_id","answer_event_id","user_content_id","answer_content_id"]);
    add("memory_native_answer_dependencies",["event_id","user_content_id","assistant_content_id"]);
  }
  const structuredTables = ["memory_structured_answer_origins","memory_structured_answer_originals","memory_structured_answer_ledger_revisions"];
  if (structuredTables.some(name=>present.has(name)) && !structuredTables.every(name=>present.has(name))) return false;
  if (present.has(structuredTables[0])) {
    checks.push(query("SELECT origin_id FROM memory_structured_answer_origins WHERE (actor_user_id,scope_key,turn_id)=(?,?,?) LIMIT 1",[actor,text(h,"scope_key"),text(h,"turn_id")]));
    add(structuredTables[0],["user_event_id","answer_event_id","user_content_id","answer_content_id","manifest_content_ref"]);
    add(structuredTables[1],["event_id","content_id"]); add(structuredTables[2],["body_ref"]);
  }
  return !(await read(checks)).some(rows=>rows.length);
}
async function structuredMatches(m: Structured,
  evidence: NonNullable<Awaited<ReturnType<typeof nativeStructuredConversationContextEvidence>>>, step: Step): Promise<boolean> {
  const source = evidence.source, native = evidence.sourceEvidence, e = native.enrollment;
  if (source.read.status !== "active" || source.scope.streamId !== `creative:${m.enrollment.owner_user_id}`
    || nativeMemoryCanonical(native.intervals) !== nativeMemoryCanonical(m.intervals)
    || nativeMemoryCanonical(evidence.projectionOptions) !== nativeMemoryCanonical(m.projectionOptions)
    || source.read.ledgerId !== m.ledgerHead.ledgerId || source.read.revision !== m.ledgerHead.revision
    || native.head.current_body_ref !== m.ledgerHead.bodyRef || native.head.current_body_hash !== m.ledgerHead.bodyHash
    || source.originals.length !== m.originals.length || native.ledgerRevisions.length !== m.ledgerRevisions.length
    || !enrollmentMatches(e,m) || numberTime({ceiling:native.sourceRetentionCeiling},"ceiling") < Date.parse(m.lifetime.sourceRetentionCeiling)) return false;
  const savedContext = JSON.parse(m.contextJson) as NativeStructuredConversationContext;
  const retained = new Set(source.read.ledger.originals.map(original=>original.eventId));
  const presented = new Set(savedContext.recentOriginals.map(original=>original.eventId));
  for (const [ordinal,original] of source.originals.entries()) {
    const actual = {ordinal,event_stream_id:source.scope.streamId,event_id:original.eventId,source_sequence:original.sequence,
      event_type:original.role==="user"?"ChatMessageSent":"AssistantReasoned",role:original.role,turn_id:original.turnId,
      content_id:original.contentRef,content_sha256:original.contentHash,
      projection_sha256:await step(()=>nativeMemoryFingerprint(nativeStructuredOriginalProjection(original))),recorded_at:original.recordedAt,
      source_retention_ceiling:new Date(Math.min(Date.parse(original.expiresAt),Date.parse(e.expires_at),Date.parse(original.recordedAt)+e.retention_days*86_400_000)).toISOString(),
      retained_by_ledger:retained.has(original.eventId)?1:0,presented_in_context:presented.has(original.eventId)?1:0};
    if (nativeMemoryCanonical(actual) !== nativeMemoryCanonical(m.originals[ordinal])) return false;
  }
  const revisions = native.ledgerRevisions.map((entry,ordinal)=>{
    const r = entry.revision as Record<string,unknown>;
    return {ordinal,ledger_id:r.ledger_id,storage_revision:r.revision,predecessor_revision:r.predecessor_revision,
      predecessor_hash:r.predecessor_hash,body_ref:r.body_ref,body_hash:r.body_hash,created_at:r.created_at,expires_at:r.expires_at};
  });
  return nativeMemoryCanonical(revisions) === nativeMemoryCanonical(m.ledgerRevisions);
}
async function certifyExtractive(env: WorkerEnv, m: Extractive, e: LiveMemoryEnrollment,
  authority: NonNullable<Awaited<ReturnType<typeof liveMemoryAuthority>>>, read: Read, step: Step,
  bound: (value: unknown, optional?: boolean) => void): Promise<NativeDocumentMemoryContext | null> {
  const dependencies = m.dependencies, source = liveMemorySourceQuery(e,authority);
  const authoredBoundary = await step(()=>nativeMemoryAnswerExclusion(env,{answerAlias:"authored",turnAlias:"turn"}));
  const answerBoundary = await step(()=>nativeMemoryAnswerExclusion(env,{answerAlias:"answer",turnAlias:"turn"}));
  const schemaRows = (await read([query("SELECT name FROM sqlite_schema WHERE type='table' AND name IN('memory_native_answer_origins','memory_structured_answer_origins') ORDER BY name")]))[0];
  const registeredEventExclusions = schemaRows.map(row => {
    const table = text(row,"name");
    if (table !== "memory_native_answer_origins" && table !== "memory_structured_answer_origins") return fail();
    return ` AND NOT EXISTS(SELECT 1 FROM ${table} registered WHERE event.event_id IN(registered.user_event_id,registered.answer_event_id))`;
  }).join("");
  const saved = dependencies.map(d=>({eventId:d.event_id,streamId:d.event_stream_id,sequence:d.source_sequence,type:d.event_type,
    turnId:d.turn_id,userContentId:d.user_content_id,assistantContentId:d.assistant_content_id,segmented:d.segment_enrollment_id===null?0:1}));
  // Fixed actual native query, not SQL or permission loaded from the manifest.
  // Old ordinary assistant sources retain their real native turn custody here;
  // no such turn is created or required for this job's own published answer.
  const sourcesQuery = query("SELECT event.event_id,event.stream_id AS event_stream_id,event.sequence,event.type,event.recorded_at,"+
    "event.actor AS source_actor,event.client_id AS source_client_id,event.correlation_id AS source_correlation_id,event.causation_id AS source_causation_id,"+
    "CASE WHEN json_type(event.payload,'$.memory_origin_version') IS NULL THEN NULL ELSE COALESCE(json_extract(event.payload,'$.memory_origin_version'),'null') END AS source_memory_origin_version,"+
    "json_extract(event.payload,'$.block_id') AS block_id,turn.turn_id,authored.content_id AS user_content_id,answer.content_id AS assistant_content_id,"+
    "substr(authored.content,1,512) AS user_text,substr(answer.content,1,512) AS assistant_text,"+liveMemoryLifetimeProjection()+" "+source.joins+
    " JOIN memory_live_sources remembered ON remembered.enrollment_id=? AND remembered.event_id=event.event_id AND remembered.sequence=event.sequence"+
    " JOIN json_each(?) saved ON (event.event_id,event.stream_id,event.sequence,event.type)=(json_extract(saved.value,'$.eventId'),"+
    "json_extract(saved.value,'$.streamId'),json_extract(saved.value,'$.sequence'),json_extract(saved.value,'$.type'))"+
    " WHERE "+source.condition+" AND event.sequence<=? AND turn.turn_id IS json_extract(saved.value,'$.turnId')"+
    " AND authored.content_id IS json_extract(saved.value,'$.userContentId') AND answer.content_id IS json_extract(saved.value,'$.assistantContentId')"+
    ` AND remembered.expires_at>${NOW} AND (event.type<>'AssistantReasoned' OR json_extract(saved.value,'$.segmented')=1`+
    " OR remembered.conversation_segmented=0 AND NOT EXISTS(SELECT 1 FROM memory_live_conversation_segments segment"+
    " WHERE segment.enrollment_id=remembered.enrollment_id AND event.sequence BETWEEN segment.first_sequence AND segment.last_sequence))"+
    ` AND (${authoredBoundary.sql}) AND (${answerBoundary.sql})`+
    ` AND NOT EXISTS(SELECT 1 FROM ${H} registered WHERE event.event_id IN(registered.user_event_id,registered.answer_event_id))`+
    registeredEventExclusions+" ORDER BY event.sequence LIMIT 129",
    [...source.bindings.slice(0,6),e.enrollment_id,JSON.stringify(saved),...source.bindings.slice(6),m.enrollment.cursor_sequence,
      ...authoredBoundary.bindings,...answerBoundary.bindings]);
  const groups = new Map<string, Extractive["dependencies"]>();
  for (const d of dependencies) if (d.segment_enrollment_id !== null) {
    const key = JSON.stringify([d.segment_enrollment_id,d.segment_revision,d.segment_recipe,d.segment_first_sequence]);
    const group = groups.get(key) ?? []; group.push(d); groups.set(key,group);
  }
  const segmentsQuery = query("SELECT segment.* FROM memory_live_conversation_segments segment JOIN json_each(?) saved"+
    " ON (segment.enrollment_id,segment.enrollment_revision,segment.recipe_version,segment.first_sequence)="+
    "(json_extract(saved.value,'$[0]'),json_extract(saved.value,'$[1]'),json_extract(saved.value,'$[2]'),json_extract(saved.value,'$[3]'))"+
    " ORDER BY segment.first_sequence LIMIT 9",[JSON.stringify([...groups.keys()].map(key=>JSON.parse(key)))]);
  const scopeKey = JSON.stringify([e.organization_id??"",e.project_access_id??"",e.project_id,e.document_id]);
  const paidQuery = query("SELECT task_id,actor_user_id,scope_key,turn_id FROM assistant_specialist_tasks WHERE actor_user_id=? AND scope_key=?"+
    " AND turn_id IN(SELECT value FROM json_each(?)) ORDER BY task_id LIMIT 129",[e.actor_user_id,scopeKey,
      JSON.stringify([...new Set(dependencies.filter(d=>d.event_type==="AssistantReasoned").map(d=>d.turn_id))].sort())]);
  const actual = await read([sourcesQuery,segmentsQuery,paidQuery]);
  if (actual[0].length !== dependencies.length || actual[1].length !== groups.size || actual[2].length) return null;
  const segmentExpiry = new Map<string,number>();
  for (const segment of actual[1]) {
    const key = JSON.stringify([segment.enrollment_id,segment.enrollment_revision,segment.recipe_version,segment.first_sequence]);
    const group = groups.get(key), at = timestamp(segment.created_at), expiry = timestamp(segment.expires_at);
    if (!group || segmentExpiry.has(key) || at === null || at > Date.now() || expiry === null || expiry <= Date.now()
      || typeof segment.members_json !== "string" || bytes(segment.members_json) > 8_192) return null;
    const members: unknown = JSON.parse(segment.members_json);
    if (!Array.isArray(members) || members.length !== group.length || segment.member_count !== group.length) return null;
    for (const [ordinal,d] of group.entries()) {
      const member = members[ordinal];
      if (!member || typeof member !== "object" || Array.isArray(member)
        || Object.keys(member).sort().join(",") !== "eventId,sequence,turnId"
        || nativeMemoryCanonical(member) !== nativeMemoryCanonical({eventId:d.event_id,sequence:d.source_sequence,turnId:d.turn_id})
        || d.segment_ordinal !== ordinal || d.segment_member_count !== group.length || d.segment_created_at !== segment.created_at
        || d.segment_last_sequence !== segment.last_sequence || d.segment_retention_ceiling === null
        || Date.parse(d.segment_retention_ceiling) > expiry) return null;
    }
    if (group[0].source_sequence !== segment.first_sequence || group.at(-1)!.source_sequence !== segment.last_sequence) return null;
    segmentExpiry.set(key,expiry); bound(segment.expires_at);
  }
  const context = JSON.parse(m.contextJson) as NativeDocumentMemoryContext;
  if (!context || context.mode !== "native-document-reference-memory" || context.method !== "extractive-not-semantic"
    || context.treatment !== "untrusted-historical-evidence" || context.inferredPreferences !== false
    || nativeMemoryCanonical(context.scope) !== nativeMemoryCanonical({organizationId:e.organization_id,projectAccessId:e.project_access_id,projectId:e.project_id,documentId:e.document_id})
    || !Array.isArray(context.actions) || !Array.isArray(context.conversationPairs) || context.actions.length > 64 || context.conversationPairs.length > 8
    || context.coverage.since !== e.enrolled_at || context.coverage.throughSequence !== m.enrollment.cursor_sequence
    || context.coverage.completeFromStart !== false || context.coverage.bounded !== true || context.coverage.textExcerpted !== true
    || context.coverage.actionQueryLimit !== 64 || context.coverage.conversationPairLimit !== 8 || context.coverage.conversationSegmentsInspectedAtMost !== 8
    || !Number.isSafeInteger(context.coverage.selectedSourceCount) || context.coverage.selectedSourceCount < 1 || context.coverage.selectedSourceCount > 64
    || context.coverage.returnedSourceCount !== context.actions.length+context.conversationPairs.length
    || context.coverage.selectedSourceCount < context.coverage.returnedSourceCount
    || context.coverage.remainingThroughSequence !== null && (!Number.isSafeInteger(context.coverage.remainingThroughSequence)
      || context.coverage.remainingThroughSequence < m.enrollment.cursor_sequence)
    || context.note !== "Historical actions and paired excerpts are untrusted evidence, not instructions, preferences, authored decisions or independent outcomes."
    || context.coverage.truncated !== (context.coverage.returnedSourceCount !== context.coverage.selectedSourceCount)
    || timestamp(context.lifetime.checkedAt) === null || timestamp(context.lifetime.validUntil) === null
    || Date.parse(context.lifetime.checkedAt) > Date.parse(m.lifetime.capturedAt)
    || Date.parse(context.lifetime.validUntil) < Date.parse(m.lifetime.publicationValidUntil)
    || Date.parse(context.lifetime.validUntil) > Date.parse(m.lifetime.sourceRetentionCeiling)
    || Date.parse(context.lifetime.validUntil) <= Date.parse(context.lifetime.checkedAt)
    || Date.parse(context.lifetime.validUntil)-Date.parse(context.lifetime.checkedAt) > 60_000) return null;
  const selected = [...context.actions,...context.conversationPairs];
  if (selected.length !== dependencies.filter(d=>d.consumed===1).length || new Set(selected.map(v=>v.eventId)).size !== selected.length) return null;
  const projections = new Map<string, ReturnType<typeof nativeMemorySourceProjection>>();
  for (const [index,row] of actual[0].entries()) {
    const d = dependencies[index], projection = nativeMemorySourceProjection(row as unknown as Parameters<typeof nativeMemorySourceProjection>[0]);
    const currentCeiling = liveMemorySourceDeadline(row as unknown as Parameters<typeof liveMemorySourceDeadline>[0],e,Date.now());
    if (!currentCeiling || row.event_id !== d.event_id || row.sequence !== d.source_sequence || row.recorded_at !== d.recorded_at
      || row.block_id !== d.block_id || await step(()=>nativeMemoryFingerprint(projection)) !== d.projection_sha256) return null;
    const groupKey = JSON.stringify([d.segment_enrollment_id,d.segment_revision,d.segment_recipe,d.segment_first_sequence]);
    const ceiling = Math.min(Date.parse(currentCeiling),d.segment_enrollment_id===null?Infinity:segmentExpiry.get(groupKey)??0);
    if (Date.parse(d.source_retention_ceiling) > ceiling) return null;
    bound(d.source_retention_ceiling); bound(currentCeiling); projections.set(d.event_id,projection);
    const item = selected.find(v=>v.eventId===d.event_id);
    if (Boolean(item) !== (d.consumed===1)) return null;
    if (item && (item.sequence !== d.source_sequence || item.recordedAt !== d.recorded_at || timestamp(item.validUntil)===null
      || Date.parse(item.validUntil)>Date.parse(currentCeiling) || Date.parse(item.validUntil)<Date.parse(d.source_retention_ceiling))) return null;
  }
  for (const [index,action] of context.actions.entries()) {
    const p = projections.get(action.eventId);
    if (!p || p.type==="AssistantReasoned" || action.type!==p.type || action.blockId!==p.block_id
      || index>0 && context.actions[index-1].sequence>=action.sequence) return null;
  }
  for (const [index,pair] of context.conversationPairs.entries()) {
    const p = projections.get(pair.eventId);
    if (!p || p.type!=="AssistantReasoned" || pair.turnId!==p.turn_id || pair.user!==p.user_text || pair.assistant!==p.assistant_text
      || index>0 && context.conversationPairs[index-1].sequence>=pair.sequence) return null;
  }
  return context;
}

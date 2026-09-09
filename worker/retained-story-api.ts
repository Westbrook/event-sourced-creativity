import { parseNativeAudioCompletionUrl, validateNativeAudioCompletion, type NativeAudioHandle } from "../src/model/native-audio-completion.ts";
import { parseNativeStoryboardCompletionUrl, validateNativeStoryboardCompletion, type NativeStoryboardHandle } from "../src/model/native-storyboard-completion.ts";
import { MAX_MANUAL_PRESENTATION_SLIDES } from "../src/model/presentation-count-policy.ts";
import { parseNativeSlidesCompletionUrl, validateNativeSlidesCompletion, type NativeSlidesHandle } from "../src/model/native-slides-completion.ts";
import { documentJobMaxAttempts } from "../src/model/document-jobs.ts";
import { ownerMediaNamespace } from "../src/model/media-ownership.ts";
import { parseNativeSceneCompletionUrl, validateNativeSceneCompletion, type NativeSceneHandle } from "../src/model/native-scene-completion.ts";
import { parseNativeStoryCompletionUrl, validateNativeStoryCompletion, type NativeStoryHandle } from "../src/model/native-short-story-generation.ts";
import {
  parseRetainedStoryRequestUrl, validateRetainedStoryDto,
  RETAINED_STORY_JSON_MAX_BYTES,
} from "../src/model/retained-short-story.ts";
import {
  parseNativeRetainedOutputRequestUrl, projectNativeRetainedOutput,
  type NativeRetainedOutputKind, type NativeRetainedOutputTarget,
} from "../src/model/native-retained-output.ts";
import { PLATFORM_PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow } from "./access-policy.ts";
import { configuredPilotAdmissionGuard, POLICY_VERSION } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

const AUTH_BYTES = 128 * 1024;
// Audio additionally witnesses the complete bounded original request bytes.
const AUDIO_JOB_BYTES = AUTH_BYTES * 6 + 16384;
const MAX_NATIVE_COMPLETION_ATTEMPTS = documentJobMaxAttempts("render_document");
const EVENT_COUNT = 512;
const EVENT_BYTES = 1024 * 1024;
const EVENT_ROW_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const familySql = "'DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored','DocumentRenderCompleted','DocumentArtifactEdited'";
const headers = {
  "cache-control": "private, no-store",
  "vary": "Cookie, oai-authenticated-user-id, oai-authenticated-user-email",
  "x-content-type-options": "nosniff",
  "content-type": "application/json; charset=utf-8",
};

class Unavailable extends Error {}
const unavailable = () => new Unavailable("retained_story_unavailable");
const error = (code: string, status: number) => new Response(JSON.stringify({ error: code }), { status, headers });
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const bytes = (value: string) => encoder.encode(value).length;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  byte => byte.toString(16).padStart(2, "0")).join("");

/** This endpoint is hosted-principal-only; it does not provision even a local development account. */
function hostedIdentity(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  const cookie = request.headers.get("cookie") ?? "";
  if (cookie.length > 8192 || cookie.split(";").some(part => /^(?:forma_project_context|forma_impersonation)(?:=|$)/u.test(part.trim()))) {
    throw new Unavailable("personal_principal_required");
  }
  if (!userId || !email || userId.length > 240 || email.length > 320 || bytes(userId) > 240 || bytes(email) > 320
    || /[\0-\u0020\u007f]/u.test(userId + email)) return null;
  return Object.freeze({ userId, email: email.toLowerCase(), source: "openai-workspace" as const });
}

/**
 * Fixed projection of the unchanged native policy query. The SQL-side byte
 * gate precedes transport/JSON.parse, not database aggregation or scan work.
 * No ensureSchema, account creation, identity refresh, enrollment or budget
 * initializer is called. Query cost/preemptibility remain unqualified.
 */
function authorizationQuery(env: WorkerEnv, identity: { userId: string; email: string }) {
  const admission = configuredPilotAdmissionGuard(env, identity);
  const configured = env.FORMA_PILOT_COHORT_ID?.trim() ?? "";
  const breakglass = new Set((env.FORMA_ADMIN_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  const requireBoundEnrollment = Boolean(configured && !breakglass.has(identity.email));
  const boundEnrollment = requireBoundEnrollment ? ` AND NOT EXISTS(
    SELECT 1 FROM pilot_cohorts cohort JOIN pilot_participants participant
      ON participant.cohort_id=cohort.cohort_id AND participant.organization_id=cohort.organization_id
    WHERE cohort.organization_id=(SELECT organization_id FROM pilot_cohorts WHERE cohort_id=?)
      AND cohort.status IN('active','paused') AND cohort.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND cohort.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND participant.email_normalized=? AND participant.status='active' AND participant.revoked_at IS NULL
      AND participant.user_id IS NULL)` : "";
  const cte = `native_principal AS (${PLATFORM_PRINCIPAL_WITH_ACCESS_SQL}),
    principal_json AS (SELECT json_object(
      'user_id',user_id,'email',email,'display_name',display_name,'role',role,
      'consent_version',consent_version,'consented_at',consented_at,
      'created_at',created_at,'updated_at',updated_at,'permission_epoch',permission_epoch,
      'grants_json',grants_json,'organizations_json',organizations_json,'projects_json',projects_json,
      'identity_policies_json',identity_policies_json,'approved_canvas_requirements',approved_canvas_requirements
    ) AS auth_json FROM native_principal
      WHERE user_id=? AND email=? AND role IN('creator','admin') AND consent_version=?
        AND (${admission.sql})${boundEnrollment}),
    authorized AS (SELECT auth_json FROM principal_json WHERE length(CAST(auth_json AS BLOB))<=${AUTH_BYTES})`;
  return { cte, bindings: [identity.userId, identity.userId, identity.email, POLICY_VERSION,
    ...admission.bindings, ...(requireBoundEnrollment ? [configured, identity.email] : [])] };
}

type EventRow = {
  event_id: string; sequence: number; type: string; payload: string;
  secret_id: string | null; secret_owner: string | null; secret_document: string | null;
  secret_project: string | null; secret_redacted: string | null; project_scoped: number;
};
const eventColumns = ["event_id", "sequence", "type", "payload", "secret_id", "secret_owner",
  "secret_document", "secret_project", "secret_redacted", "project_scoped"] as const;

/**
 * Conservative closed history: all six operational families in this owner's
 * stream, not a truncated page. No event_private_payloads.private_json is read.
 * Metadata attached to an event is included in the aggregate byte admission.
 */
const eventCte = `event_base AS (
  SELECT event.event_id,event.sequence,event.type,event.payload,
    secret.private_event_id AS secret_id,secret.owner_id AS secret_owner,
    secret.document_id AS secret_document,secret.project_id AS secret_project,secret.redacted_at AS secret_redacted,
    EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event.event_id) AS project_scoped
  FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
  WHERE event.stream_id=? AND event.type IN(${familySql})
), event_sizes AS (
  SELECT COUNT(*) AS total,COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS payload_bytes,
    COALESCE(MAX(length(CAST(payload AS BLOB))),0) AS largest,
    COALESCE(SUM(length(CAST(event_id AS BLOB))+length(CAST(COALESCE(secret_id,'') AS BLOB))
      +length(CAST(COALESCE(secret_owner,'') AS BLOB))+length(CAST(COALESCE(secret_document,'') AS BLOB))
      +length(CAST(COALESCE(secret_project,'') AS BLOB))+length(CAST(COALESCE(secret_redacted,'') AS BLOB))),0) AS metadata_bytes
  FROM event_base
), event_rows AS (
  SELECT event_base.* FROM event_base WHERE EXISTS(SELECT 1 FROM event_sizes
    WHERE total<=${EVENT_COUNT} AND largest<=${EVENT_ROW_BYTES} AND payload_bytes+metadata_bytes<=${EVENT_BYTES})
)`;

function eventSnapshot(rows: EventRow[]): string {
  if (rows.length > EVENT_COUNT) throw unavailable();
  let previous = -1;
  for (const row of rows) {
    if (typeof row.event_id !== "string" || !opaque.test(row.event_id) || !Number.isSafeInteger(row.sequence) || row.sequence <= previous
      || typeof row.type !== "string" || typeof row.payload !== "string" || bytes(row.payload) > EVENT_ROW_BYTES
      || ![0, 1].includes(row.project_scoped)) throw unavailable();
    previous = row.sequence;
    for (const key of ["secret_id", "secret_owner", "secret_document", "secret_project", "secret_redacted"] as const) {
      if (row[key] !== null && (typeof row[key] !== "string" || bytes(row[key]) > 1024)) throw unavailable();
    }
  }
  // An additional admission on the exact final witness; no escaping expansion
  // or silent truncation can turn a bounded row set into an unbounded bind.
  const snapshot = JSON.stringify(rows.map(row => eventColumns.map(key => row[key])));
  if (bytes(snapshot) > EVENT_BYTES) throw unavailable();
  return snapshot;
}

function selectNative(rows: EventRow[], selection: { documentId:string; artifactId:string; revision:number; contentSha256?:string }, ownerId: string, completionId?:string,
  expectedKind: "short_story" | NativeRetainedOutputKind = "short_story", requestedItemCount?: number) {
  const decoded = rows.map(row => {
    const payload = record(JSON.parse(row.payload));
    if (!payload) throw unavailable();
    return { row, payload };
  });
  const docs = decoded.filter(({ row, payload }) => ["DocumentCreated", "DocumentForked"].includes(row.type)
    && payload.document_id === selection.documentId);
  // Fold semantics permit identity replacement and implicit project/document
  // defaults. This first reader explicitly declines those ambiguous histories.
  if (docs.length !== 1) throw unavailable();
  const document = docs[0]!;
  const projectId = document.payload.project_id;
  if (typeof projectId !== "string" || !opaque.test(projectId)) throw unavailable();
  const completions = decoded.filter(({ row, payload }) => row.type === "DocumentRenderCompleted"
    && payload.artifact_id === selection.artifactId);
  if (completions.length !== 1) throw unavailable();
  const completion = completions[0]!;
  if (completionId !== undefined && completion.row.event_id !== completionId) throw unavailable();
  const payload = completion.payload;
  if (payload.document_id !== selection.documentId || payload.project_id !== projectId
    || payload.artifact_kind !== expectedKind || payload.requested_by_user_id !== ownerId
    || typeof payload.content_ref !== "string" || !opaque.test(payload.content_ref)
    || completion.row.sequence <= document.row.sequence) throw unavailable();
  const contentId = payload.content_ref;
  const selected = [document, completion];
  let removed = false;
  for (const entry of decoded.filter(({ row, payload: value }) => ["DocumentRemoved", "DocumentRestored"].includes(row.type)
    && value.document_id === selection.documentId)) {
    if (entry.row.sequence <= document.row.sequence
      || entry.payload.project_id !== undefined && entry.payload.project_id !== projectId) throw unavailable();
    removed = entry.row.type === "DocumentRemoved";
    selected.push(entry);
  }
  if (removed) throw unavailable();
  const edits = decoded.filter(({ row, payload: value }) => row.type === "DocumentArtifactEdited"
    && value.artifact_id === selection.artifactId);
  if (edits.length !== selection.revision) throw unavailable();
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index]!;
    if (edit.row.sequence <= completion.row.sequence || edit.payload.document_id !== selection.documentId
      || edit.payload.project_id !== projectId || edit.payload.content_ref !== contentId
      || edit.payload.edited_by_user_id !== ownerId || edit.payload.revision !== index + 1
      || typeof edit.payload.content_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(edit.payload.content_sha256)) throw unavailable();
    selected.push(edit);
  }
  if (edits.length && edits.at(-1)!.payload.content_sha256 !== selection.contentSha256) throw unavailable();
  for (const { row, payload: value } of selected) {
    if (row.project_scoped || row.secret_redacted !== null) throw unavailable();
    if (value._private_ref !== undefined) {
      if (value._private_ref !== row.event_id || row.secret_id !== row.event_id || row.secret_owner !== ownerId
        || row.secret_document !== selection.documentId || row.secret_project !== projectId) throw unavailable();
    } else if (row.secret_id !== null) throw unavailable();
  }
  let sceneMedium: unknown = null;
  if (expectedKind === "scene") {
    const configured = record(payload.settings)?.scene_medium;
    if (payload.scene_medium !== undefined && configured !== undefined && payload.scene_medium !== configured) throw unavailable();
    sceneMedium = payload.scene_medium ?? configured ?? null;
  }
  // The public event envelope retains item_count; settings is intentionally
  // private. Bind the actual public count without reading private_json.
  if (requestedItemCount !== undefined && payload.item_count !== requestedItemCount) throw unavailable();
  return Object.freeze({ projectId, contentId, sceneMedium,
    completionId: completion.row.event_id, completionItemCount: payload.item_count, completionInputRef: payload.input_ref });
}

const storyboardReceiptGuard = () => `private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
  AND redacted_at IS NULL AND length(CAST(private_json AS BLOB))<=${EVENT_BYTES}`;

/** Frame identities/media are private completion metadata, not authored plan
 * fields. Read only the selected envelope after its public custody was proved.
 * Its exact bytes join the final current-source witness below.
 */
async function storyboardReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string }) {
  const bindings = [native.completionId, ownerId, selection.documentId, native.projectId];
  const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${storyboardReceiptGuard()}`)
    .bind(...bindings).first<{ private_json: string }>();
  if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
  const payload = record(JSON.parse(row.private_json));
  if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
    || payload.artifact_id !== selection.artifactId || payload.artifact_kind !== "storyboard"
    || payload.content_ref !== native.contentId || payload.requested_by_user_id !== ownerId
    || !Number.isSafeInteger(native.completionItemCount) || Number(native.completionItemCount) < 1
    || Number(native.completionItemCount) > 24 || payload.item_count !== native.completionItemCount
    || !Array.isArray(payload.items) || payload.items.length !== native.completionItemCount) throw unavailable();
  const prefix = `${ownerMediaNamespace(ownerId)}/generated/`;
  for (const value of payload.items) {
    const item = record(value);
    if (!item) throw unavailable();
    if (item.media_url === null) continue;
    if (typeof item.media_url !== "string" || !item.media_url.startsWith("/api/media/")) throw unavailable();
    let key: string;
    try { key = decodeURIComponent(item.media_url.slice("/api/media/".length)); } catch { throw unavailable(); }
    if (!key.startsWith(prefix)) throw unavailable();
  }
  return { bindings, raw: row.private_json, items: payload.items };
}

const model3dReceiptGuard = () => `private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
  AND redacted_at IS NULL AND length(CAST(private_json AS BLOB))<=${EVENT_BYTES}`;

// Native file references belong to the selected completion envelope, not its
// prose generation plan. Its exact private bytes join the final witness.
async function model3dReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string }) {
  const bindings = [native.completionId, ownerId, selection.documentId, native.projectId];
  const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${model3dReceiptGuard()}`)
    .bind(...bindings).first<{ private_json: string }>();
  if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
  const payload = record(JSON.parse(row.private_json));
  if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
    || payload.artifact_id !== selection.artifactId || payload.artifact_kind !== "model3d"
    || payload.content_ref !== native.contentId || payload.requested_by_user_id !== ownerId) throw unavailable();
  const files = record(payload.settings)?.model3d_files;
  if (files !== undefined && !Array.isArray(files)) throw unavailable();
  const prefix = `${ownerMediaNamespace(ownerId)}/generated/`;
  for (const value of Array.isArray(files) ? files : []) {
    const file = record(value);
    if (!file || typeof file.url !== "string" || !file.url.startsWith("/api/media/")) throw unavailable();
    let key: string;
    try { key = decodeURIComponent(file.url.slice("/api/media/".length)); } catch { throw unavailable(); }
    if (!key.startsWith(prefix)) throw unavailable();
  }
  return { bindings, raw: row.private_json, payload };
}

const audioReceiptGuard = () => `private_event_id=? AND owner_id=? AND document_id=? AND project_id=?
  AND redacted_at IS NULL AND length(CAST(private_json AS BLOB))<=${EVENT_BYTES}`;

// Bind the selected private Audio media and original input receipt. The raw
// content is authored text; it does not identify or replace playable bytes.
async function audioReceipt(env: WorkerEnv, native: ReturnType<typeof selectNative>, ownerId: string,
  selection: { documentId: string; artifactId: string }) {
  const bindings = [native.completionId, ownerId, selection.documentId, native.projectId];
  const row = await env.DB.prepare(`SELECT private_json FROM event_private_payloads WHERE ${audioReceiptGuard()}`)
    .bind(...bindings).first<{ private_json: string }>();
  if (!row || typeof row.private_json !== "string" || bytes(row.private_json) > EVENT_BYTES) throw unavailable();
  const payload = record(JSON.parse(row.private_json));
  if (!payload || payload.document_id !== selection.documentId || payload.project_id !== native.projectId
    || payload.artifact_id !== selection.artifactId || payload.artifact_kind !== "audio"
    || payload.content_ref !== native.contentId || payload.requested_by_user_id !== ownerId
    || typeof native.completionInputRef !== "string" || !opaque.test(native.completionInputRef)
    || payload.input_ref !== native.completionInputRef) throw unavailable();
  if (payload.media_url !== null) {
    if (typeof payload.media_url !== "string" || !payload.media_url.startsWith("/api/media/")) throw unavailable();
    let key: string;
    try { key = decodeURIComponent(payload.media_url.slice("/api/media/".length)); } catch { throw unavailable(); }
    if (!key.startsWith(`${ownerMediaNamespace(ownerId)}/generated/`)) throw unavailable();
  }
  return { bindings, raw: row.private_json, payload };
}

function personalContentGuard() {
  return `content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL
    AND typeof(content)='text' AND length(CAST(content AS BLOB)) BETWEEN 1 AND ${RETAINED_STORY_JSON_MAX_BYTES}
    AND typeof(expires_at)='text' AND length(CAST(expires_at AS BLOB))=24
    AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE
      (resource_kind='document' AND resource_id=?) OR (resource_kind='artifact' AND resource_id=?)
      OR (resource_kind='content' AND resource_id=private_content.content_id))
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=private_content.content_id)`;
}

// A bounded, completed-only native association; not a new job runner or status/recovery API.
// The entire result JSON is byte-gated before transport, while only selected fields are returned.
// SQL JSON evaluation/scan work is not bounded by this transport cap.
const jobCte = `story_job AS (
  SELECT job.* FROM document_jobs job WHERE job.job_id=? AND job.document_id=? AND job.owner_id=? AND job.stream_id=?
    AND job.kind='render_document' AND job.status='completed' AND job.source_surface='document'
    AND typeof(job.attempt_count)='integer' AND job.attempt_count BETWEEN 1 AND ${MAX_NATIVE_COMPLETION_ATTEMPTS}
    AND job.correlation_id=(job.job_id||':attempt:'||CAST(job.attempt_count AS TEXT))
    AND job.error_message IS NULL AND job.completed_at IS NOT NULL
    AND typeof(job.expires_at)='text' AND length(CAST(job.expires_at AS BLOB))=24
    AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND json_valid(job.request_json) AND json_extract(job.request_json,'$.artifactKind')='short_story'
    AND json_extract(job.request_json,'$.productionMode')='manual' AND json_extract(job.request_json,'$.itemCount')=1
    AND json_type(job.request_json,'$.outputExecution') IS NULL AND json_type(job.request_json,'$.workflowId') IS NULL
    AND json_valid(job.result_json) AND length(CAST(job.result_json AS BLOB))<=${AUTH_BYTES}
    AND json_extract(job.result_json,'$.artifactKind')='short_story'
    AND json_type(job.result_json,'$.appendedEventIds')='array'
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE
      (scope.resource_kind='job' AND scope.resource_id=job.job_id) OR (scope.resource_kind='document' AND scope.resource_id=job.document_id))
    AND (SELECT COUNT(*) FROM events event WHERE event.stream_id=job.stream_id AND event.correlation_id=job.correlation_id
      AND event.type='DocumentRenderCompleted')=1
), story_job_json AS (
  SELECT json_object('jobId',job_id,'documentId',document_id,'correlationId',correlation_id,'attemptCount',attempt_count,'artifactId',json_extract(result_json,'$.artifactId'),
    'appendedEventIds',json_extract(result_json,'$.appendedEventIds'),'expiresAt',expires_at,
    'completionId',(SELECT event_id FROM events WHERE stream_id=story_job.stream_id AND correlation_id=story_job.correlation_id
      AND type='DocumentRenderCompleted' AND actor='worker:renderer' AND client_id='server:document-job:render_document')) AS job_json
  FROM story_job
), bounded_story_job AS (SELECT job_json FROM story_job_json WHERE length(CAST(job_json AS BLOB))<=16384)`;

// Scene retains its one-item consent. Manual Slides and Storyboard bind their
// exact numeric counts; Storyboard additionally requires explicit paid-media consent.
// These completed-only reads share the same attempt and final ownership witness.
function nativeCompletionJobCte(output: "scene" | "slides" | "storyboard" | "audio") {
  const requestGuard = output === "audio" ? `
    AND length(CAST(job.request_json AS BLOB))<=${AUTH_BYTES}
    AND (json_type(job.request_json,'$.itemCount') IS NULL
      OR (json_type(job.request_json,'$.itemCount')='integer' AND json_extract(job.request_json,'$.itemCount')=1))
    AND json_type(job.request_json,'$.paidMediaConfirmed')='true'
    AND json_type(job.request_json,'$.sceneRequestId') IS NULL AND json_type(job.request_json,'$.sceneCostConsent') IS NULL
    AND json_type(job.request_json,'$.requestedSlideCount') IS NULL AND json_type(job.request_json,'$.slideCountPolicy') IS NULL` : output === "scene" ? `    AND (json_type(job.request_json,'$.itemCount') IS NULL
      OR (json_type(job.request_json,'$.itemCount')='integer' AND json_extract(job.request_json,'$.itemCount')=1))
    AND json_extract(job.request_json,'$.sceneRequestId')=job.job_id
    AND json_extract(job.request_json,'$.sceneCostConsent.version')='scene-cost-v1'
    AND json_type(job.request_json,'$.sceneCostConsent.confirmed')='true'
    AND json_extract(job.request_json,'$.sceneCostConsent.requestId')=job.job_id
    AND json_extract(job.request_json,'$.sceneCostConsent.actorUserId')=job.owner_id
    AND json_extract(job.request_json,'$.sceneCostConsent.documentId')=job.document_id
    AND json_extract(job.request_json,'$.sceneCostConsent.productionMode')='manual'
    AND json_type(job.request_json,'$.sceneCostConsent.itemCount')='integer'
    AND json_extract(job.request_json,'$.sceneCostConsent.itemCount')=1` : output === "storyboard" ? `
    AND json_type(job.request_json,'$.itemCount')='integer'
    AND json_extract(job.request_json,'$.itemCount') BETWEEN 1 AND 12
    AND json_type(job.request_json,'$.paidMediaConfirmed')='true'
    AND json_type(job.request_json,'$.sceneRequestId') IS NULL AND json_type(job.request_json,'$.sceneCostConsent') IS NULL
    AND json_type(job.request_json,'$.requestedSlideCount') IS NULL AND json_type(job.request_json,'$.slideCountPolicy') IS NULL` : `
    AND json_type(job.request_json,'$.itemCount')='integer'
    AND json_extract(job.request_json,'$.itemCount') BETWEEN 1 AND ${MAX_MANUAL_PRESENTATION_SLIDES}
    AND (json_type(job.request_json,'$.requestedSlideCount') IS NULL
      OR (json_type(job.request_json,'$.requestedSlideCount')='integer'
        AND json_extract(job.request_json,'$.requestedSlideCount')=json_extract(job.request_json,'$.itemCount')))
    AND json_type(job.request_json,'$.slideCountPolicy') IS NULL`;
  return `story_job AS (
  SELECT job.* FROM document_jobs job WHERE job.job_id=? AND job.document_id=? AND job.owner_id=? AND job.stream_id=?
    AND job.kind='render_document' AND job.status='completed' AND job.source_surface='document'
    AND typeof(job.attempt_count)='integer' AND job.attempt_count BETWEEN 1 AND ${MAX_NATIVE_COMPLETION_ATTEMPTS}
    AND job.correlation_id=(job.job_id||':attempt:'||CAST(job.attempt_count AS TEXT))
    AND job.error_message IS NULL AND job.completed_at IS NOT NULL
    AND typeof(job.expires_at)='text' AND length(CAST(job.expires_at AS BLOB))=24
    AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND json_valid(job.request_json) AND json_extract(job.request_json,'$.artifactKind')='${output}'
    AND json_extract(job.request_json,'$.productionMode')='manual'
${requestGuard}
    AND json_type(job.request_json,'$.outputExecution') IS NULL AND json_type(job.request_json,'$.workflowId') IS NULL
    AND json_type(job.request_json,'$.workflowStageId') IS NULL AND json_type(job.request_json,'$.workflowSources') IS NULL
    AND json_valid(job.result_json) AND length(CAST(job.result_json AS BLOB))<=${AUTH_BYTES}
    AND json_extract(job.result_json,'$.artifactKind')='${output}'
    AND json_type(job.result_json,'$.appendedEventIds')='array'
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE
      (scope.resource_kind='job' AND scope.resource_id=job.job_id) OR (scope.resource_kind='document' AND scope.resource_id=job.document_id))
    AND (SELECT COUNT(*) FROM events event WHERE event.stream_id=job.stream_id AND event.correlation_id=job.correlation_id
      AND event.type='DocumentRenderCompleted')=1
), story_job_json AS (
  SELECT json_object('jobId',job_id,'documentId',document_id,'correlationId',correlation_id,'attemptCount',attempt_count,'artifactId',json_extract(result_json,'$.artifactId'),
    'appendedEventIds',json_extract(result_json,'$.appendedEventIds'),'expiresAt',expires_at,
    ${output === "audio" ? "'requestSnapshot',request_json,'providerJobId',json_extract(result_json,'$.providerJobId'),'provider',json_extract(result_json,'$.provider')," : output === "slides" ? "'requestedSlideCount',json_extract(request_json,'$.itemCount')," : output === "storyboard" ? "'requestedFrameCount',json_extract(request_json,'$.itemCount')," : ""}
    'completionId',(SELECT event_id FROM events WHERE stream_id=story_job.stream_id AND correlation_id=story_job.correlation_id
      AND type='DocumentRenderCompleted' AND actor='worker:renderer' AND client_id='server:document-job:render_document')) AS job_json
  FROM story_job
), bounded_story_job AS (SELECT job_json FROM story_job_json WHERE length(CAST(job_json AS BLOB))<=${output === "audio" ? AUDIO_JOB_BYTES : 16384})`;
}

type NativeOutputCompletion =
  | { output: "scene"; handle: NativeSceneHandle }
  | { output: "slides"; handle: NativeSlidesHandle }
  | { output: "storyboard"; handle: NativeStoryboardHandle }
  | { output: "audio"; handle: NativeAudioHandle };

async function completedStoryJob(env:WorkerEnv, handle:NativeStoryHandle | NativeSceneHandle | NativeSlidesHandle | NativeStoryboardHandle | NativeAudioHandle, ownerId:string, streamId:string, output:"scene" | "slides" | "storyboard" | "audio" | null=null) {
  const bindings=[handle.jobId,handle.documentId,ownerId,streamId];
  const raw=await env.DB.prepare(`WITH ${output ? nativeCompletionJobCte(output) : jobCte} SELECT job_json FROM bounded_story_job`).bind(...bindings).first<{job_json:string}>();
  if(!raw||typeof raw.job_json!=="string"||bytes(raw.job_json)>(output === "audio" ? AUDIO_JOB_BYTES : 16384))throw unavailable();
  const row=record(JSON.parse(raw.job_json));
  if(!row||row.jobId!==handle.jobId||row.documentId!==handle.documentId
    ||typeof row.attemptCount!=="number"||!Number.isSafeInteger(row.attemptCount)||row.attemptCount<1||row.attemptCount>MAX_NATIVE_COMPLETION_ATTEMPTS
    ||row.correlationId!==`${handle.jobId}:attempt:${row.attemptCount}`
    ||typeof row.artifactId!=="string"||!opaque.test(row.artifactId)
    ||typeof row.completionId!=="string"||!opaque.test(row.completionId)
    ||!Array.isArray(row.appendedEventIds)||row.appendedEventIds.length<1||row.appendedEventIds.length>128
    ||row.appendedEventIds.some(id=>typeof id!=="string"||!opaque.test(id))
    ||new Set(row.appendedEventIds).size!==row.appendedEventIds.length||!row.appendedEventIds.includes(row.completionId)
    ||typeof row.expiresAt!=="string"||!(Date.parse(row.expiresAt)>Date.now())
    ||new Date(row.expiresAt).toISOString()!==row.expiresAt)throw unavailable();
  if (output === "audio" && (typeof row.requestSnapshot !== "string" || bytes(row.requestSnapshot) > AUTH_BYTES
    || !record(JSON.parse(row.requestSnapshot)) || typeof row.providerJobId !== "string"
    || !opaque.test(row.providerJobId) || typeof row.provider !== "string" || !opaque.test(row.provider))) throw unavailable();
  const requestedSlideCount = output === "slides" && typeof row.requestedSlideCount === "number" ? row.requestedSlideCount : undefined;
  if (output === "slides" && (typeof requestedSlideCount !== "number" || !Number.isSafeInteger(requestedSlideCount)
    || requestedSlideCount < 1 || requestedSlideCount > MAX_MANUAL_PRESENTATION_SLIDES)) throw unavailable();
  const requestedFrameCount = output === "storyboard" && typeof row.requestedFrameCount === "number" ? row.requestedFrameCount : undefined;
  if (output === "storyboard" && (typeof requestedFrameCount !== "number" || !Number.isSafeInteger(requestedFrameCount)
    || requestedFrameCount < 1 || requestedFrameCount > 12)) throw unavailable();
  return {bindings,snapshot:raw.job_json,artifactId:row.artifactId,completionId:row.completionId,expiresAt:row.expiresAt,
    requestedSlideCount, requestedFrameCount,
    audioRequest: output === "audio" ? record(JSON.parse(row.requestSnapshot as string)) : null,
    audioProviderJobId: output === "audio" ? row.providerJobId as string : null,
    audioProvider: output === "audio" ? row.provider as string : null};
}

// The admission generationReceipt.input_ref is a different row. Bind the selected
// completion's private input through the actual artifact and provider invocation.
function audioInputGuard() {
  return personalContentGuard().replace("kind='document-artifact'", "kind='document-artifact-input'") + " AND json_valid(content) AND json_type(content)='object'";
}
async function audioCompletionInput(env: WorkerEnv, job: Awaited<ReturnType<typeof completedStoryJob>>,
  audio: NonNullable<Awaited<ReturnType<typeof audioReceipt>>>, native: ReturnType<typeof selectNative>,
  ownerId: string, target: { documentId: string; artifactId: string }) {
  const original = job.audioRequest, snapshot = record(original?.snapshot);
  if (!original || original.documentId !== target.documentId || !snapshot || !Array.isArray(snapshot.facts)
    || typeof original.documentRevision !== "string" || !original.documentRevision
    || typeof original.requestKey !== "string" || !original.requestKey
    || !Array.isArray(original.sourceBlockVersions)
    || original.sourceBlockVersions.some(value => {
      const version = record(value);
      return !version || Object.keys(version).length !== 2 || typeof version.block_id !== "string" || !opaque.test(version.block_id)
        || typeof version.version !== "number" || !Number.isSafeInteger(version.version) || version.version < 0;
    }) || new Set(original.sourceBlockVersions.map(value => (value as Record<string, unknown>).block_id)).size !== original.sourceBlockVersions.length
    || JSON.stringify(original.sourceBlockVersions) !== JSON.stringify(audio.payload.source_block_versions)) throw unavailable();
  const bindings = [audio.payload.input_ref as string, ownerId, native.projectId, target.documentId, target.artifactId];
  const row = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${audioInputGuard()}`)
    .bind(...bindings).first<{ content: string; expires_at: string }>();
  if (!row || typeof row.content !== "string" || bytes(row.content) > RETAINED_STORY_JSON_MAX_BYTES
    || typeof row.expires_at !== "string" || !Number.isFinite(Date.parse(row.expires_at)) || new Date(row.expires_at).toISOString() !== row.expires_at) throw unavailable();
  const input = record(JSON.parse(row.content)), request = record(input?.request), render = record(input?.render);
  const selectedSnapshot = record(input?.document_snapshot);
  if (!input || input.schema_version !== 1 || input.artifact_id !== target.artifactId || input.artifact_kind !== "audio"
    || input.document_id !== target.documentId || input.project_id !== native.projectId || !request || !render || !selectedSnapshot
    || record(selectedSnapshot.document)?.id !== target.documentId
    || request.item_count !== 1 || request.production_mode !== "manual" || request.source_surface !== "document"
    || render.provider_job_id !== job.audioProviderJobId || render.provider !== job.audioProvider
    || audio.payload.provider_job_id !== job.audioProviderJobId || audio.payload.provider !== job.audioProvider
    || typeof render.model !== "string" || render.model !== audio.payload.model_id
    || (original.audioProviderModel !== undefined && original.audioProviderModel !== render.model)
    || (original.audioProfile !== undefined && JSON.stringify(original.audioProfile) !== JSON.stringify(request.audio_profile))) throw unavailable();
  // The producer copies these fields verbatim, then adds current document metadata
  // and merges standing constraints. Preserve every original normalized constraint.
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== "document" && key !== "standing_constraints"
      && JSON.stringify(selectedSnapshot[key]) !== JSON.stringify(value)) throw unavailable();
  }
  const constraints = (value: unknown) => (Array.isArray(value) ? value : []).filter((item): item is Record<string, unknown> => Boolean(record(item)));
  const constraintKey = (item: Record<string, unknown>) => String(item.preference_id ?? `${item.polarity}:${item.axis}:${item.value}`);
  const originalConstraints = new Map(constraints(snapshot.standing_constraints).map(item => [constraintKey(item), item]));
  const selectedConstraints = constraints(selectedSnapshot.standing_constraints);
  const byKey = new Map(selectedConstraints.map(item => [constraintKey(item), item]));
  if (byKey.size !== selectedConstraints.length) throw unavailable();
  for (const [key, value] of originalConstraints) {
    if (JSON.stringify(byKey.get(key)) !== JSON.stringify(value)) throw unavailable();
  }
  return { bindings, raw: row.content, expiresAt: row.expires_at };
}

/**
 * Authenticated CURRENT personal native revision only. This is neither an
 * Experience result nor generation/custody authority. All database operations
 * here are fixed SELECTs; no provider, MEDIA, budget, repair or writer entry.
 * Runtime/import/SQL qualification is separate from this detached source.
 */
async function readCurrentRetainedNative(request: Request, env: WorkerEnv, nativeOutput: NativeRetainedOutputTarget | null, nativeCompletion: NativeOutputCompletion | null = null): Promise<Response> {
  if (request.method !== "GET") return error("method_not_allowed", 405);
  const handle = nativeCompletion?.handle ?? (nativeOutput ? null : parseNativeStoryCompletionUrl(request.url));
  let selection = nativeOutput?.selection ?? parseRetainedStoryRequestUrl(request.url);
  if (!selection && !handle) return error("invalid_retained_story_selection", 400);
  try {
    const identity = hostedIdentity(request);
    if (!identity) return error("authentication_required", 401);
    const auth = authorizationQuery(env, identity);
    const principal = await env.DB.prepare(`WITH ${auth.cte} SELECT auth_json FROM authorized`)
      .bind(...auth.bindings).first<{ auth_json: string }>();
    if (!principal || typeof principal.auth_json !== "string" || bytes(principal.auth_json) > AUTH_BYTES) {
      return error("retained_story_access_denied", 403);
    }
    const observed = record(JSON.parse(principal.auth_json));
    if (!observed || observed.user_id !== identity.userId || observed.email !== identity.email
      || observed.role !== "creator" && observed.role !== "admin" || observed.consent_version !== POLICY_VERSION) throw unavailable();
    for (const name of ["grants_json", "organizations_json", "projects_json", "identity_policies_json"] as const) {
      if (typeof observed[name] !== "string" || !Array.isArray(JSON.parse(observed[name]))) throw unavailable();
    }
    const access = await principalAccessFromRow(observed, observed.role, {
      email: identity.email, source: identity.source, subject: identity.userId,
    });
    if (access.identityPolicyDeniedCustody) return error("retained_story_access_denied", 403);
    const streamId = `creative:${identity.userId}`;
    const job = handle ? await completedStoryJob(env, handle, identity.userId, streamId, nativeCompletion?.output ?? null) : null;
    const target = job && handle ? {documentId:handle.documentId,artifactId:job.artifactId,revision:0} : selection!;
    const events = await env.DB.prepare(`WITH ${eventCte} SELECT * FROM event_rows ORDER BY sequence`)
      .bind(streamId).all<EventRow>();
    const snapshot = eventSnapshot(events.results);
    const native = selectNative(events.results, target, identity.userId, job?.completionId, nativeCompletion?.output ?? nativeOutput?.output ?? "short_story", job?.requestedSlideCount ?? job?.requestedFrameCount ?? (nativeCompletion?.output === "audio" ? 1 : undefined));
    const storyboard = (nativeCompletion?.output ?? nativeOutput?.output) === "storyboard" ? await storyboardReceipt(env, native, identity.userId, target) : null;
    const model3d = nativeOutput?.output === "model3d" ? await model3dReceipt(env, native, identity.userId, target) : null;
    const audio = (nativeCompletion?.output ?? nativeOutput?.output) === "audio" ? await audioReceipt(env, native, identity.userId, target) : null;
    const audioInput = nativeCompletion?.output === "audio" && job && audio
      ? await audioCompletionInput(env, job, audio, native, identity.userId, target) : null;
    const contentBindings = [native.contentId, identity.userId, native.projectId, target.documentId, target.artifactId];
    const source = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${personalContentGuard()}`)
      .bind(...contentBindings).first<{ content: string; expires_at: string }>();
    if (!source || typeof source.content !== "string" || bytes(source.content) > RETAINED_STORY_JSON_MAX_BYTES) throw unavailable();
    const contentSha256 = await hash(source.content);
    if (selection && contentSha256 !== selection.contentSha256) throw unavailable();
    selection ??= Object.freeze({ ...target, contentSha256 });
    const body = record(JSON.parse(source.content));
    if (!body || typeof body.title !== "string" || typeof body.content_markdown !== "string"
      || !Array.isArray(body.items)) throw unavailable();
    const outputTarget = nativeCompletion ? { output: nativeCompletion.output, selection } : nativeOutput;
    const dto = outputTarget
      ? projectNativeRetainedOutput(outputTarget, body, source.expires_at, native.sceneMedium, {
        storyboardItems: storyboard?.items ?? null, model3dReceipt: model3d?.payload ?? null, audioReceipt: audio?.payload ?? null })
      : validateRetainedStoryDto({ schemaVersion: 1, kind: "native-retained-short-story",
        selection, title: body.title, contentMarkdown: body.content_markdown, expiresAt: source.expires_at }, selection);
    if (!dto || nativeCompletion?.output === "scene" && body.items.length !== 1
      || nativeCompletion?.output === "slides" && body.items.length !== job?.requestedSlideCount
      || nativeCompletion?.output === "storyboard" && body.items.length !== job?.requestedFrameCount
      || nativeCompletion?.output === "audio" && (body.items.length !== 1 || dto.kind !== "native-retained-output" || dto.output !== "audio"
        || !dto.content.media || record(audio?.payload.settings)?.item_count !== 1
        || record(audio?.payload.settings)?.production_mode !== "manual")) throw unavailable();
    const sourceCompletionExpiry = job && Date.parse(job.expiresAt)<Date.parse(source.expires_at)?job.expiresAt:source.expires_at;
    const completionExpiry = audioInput && Date.parse(audioInput.expiresAt) < Date.parse(sourceCompletionExpiry)
      ? audioInput.expiresAt : sourceCompletionExpiry;
    const completion = job && handle ? nativeCompletion?.output === "audio"
      ? validateNativeAudioCompletion({schemaVersion:1,kind:"native-audio-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : nativeCompletion?.output === "storyboard"
      ? validateNativeStoryboardCompletion({schemaVersion:1,kind:"native-storyboard-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : nativeCompletion?.output === "slides"
      ? validateNativeSlidesCompletion({schemaVersion:1,kind:"native-slides-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : nativeCompletion?.output === "scene"
      ? validateNativeSceneCompletion({schemaVersion:1,kind:"native-scene-completion",handle,
        selection,expiresAt:completionExpiry},handle)
      : validateNativeStoryCompletion({schemaVersion:1,kind:"native-short-story-completion",handle,
        selection,expiresAt:completionExpiry},handle) : null;
    if (job && !completion) throw unavailable();
    const serialized = JSON.stringify(completion ?? dto);
    if (bytes(serialized) > RETAINED_STORY_JSON_MAX_BYTES) throw unavailable();
    // One final SELECT rechecks the exact auth and operational snapshots, all
    // source-redaction/scope metadata, personal custody and exact raw content.
    // The witness is a closed array generated above, never caller-supplied SQL.
    const comparisons = eventColumns.map((name, index) => `actual.${name} IS NOT json_extract(expected.value,'$[${index}]')`).join(" OR ");
    const final = await env.DB.prepare(`WITH ${auth.cte},${eventCte}${job?`,${nativeCompletion ? nativeCompletionJobCte(nativeCompletion.output) : jobCte}`:""},
      expected_events AS (SELECT value FROM json_each(?))
      SELECT 1 AS admitted FROM private_content WHERE ${personalContentGuard()}
        AND CAST(content AS BLOB)=CAST(? AS BLOB) AND expires_at=?
        AND EXISTS(SELECT 1 FROM authorized WHERE CAST(auth_json AS BLOB)=CAST(? AS BLOB))
        AND (SELECT COUNT(*) FROM event_rows)=(SELECT COUNT(*) FROM expected_events)
        AND NOT EXISTS(SELECT 1 FROM expected_events expected LEFT JOIN event_rows actual
          ON actual.event_id=json_extract(expected.value,'$[0]') WHERE actual.event_id IS NULL OR ${comparisons})
        ${job?"AND EXISTS(SELECT 1 FROM bounded_story_job WHERE CAST(job_json AS BLOB)=CAST(? AS BLOB))":""}
        ${storyboard?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${storyboardReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${model3d?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${model3dReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${audio?`AND EXISTS(SELECT 1 FROM event_private_payloads WHERE ${audioReceiptGuard()} AND CAST(private_json AS BLOB)=CAST(? AS BLOB))`:""}
        ${audioInput?`AND EXISTS(SELECT 1 FROM private_content WHERE ${audioInputGuard()} AND CAST(content AS BLOB)=CAST(? AS BLOB) AND expires_at=?)`:""}`)
      .bind(...auth.bindings, streamId, ...(job?.bindings??[]), snapshot, ...contentBindings, source.content, source.expires_at, principal.auth_json, ...(job?[job.snapshot]:[]), ...(storyboard?[...storyboard.bindings,storyboard.raw]:[]), ...(model3d?[...model3d.bindings,model3d.raw]:[]), ...(audio?[...audio.bindings,audio.raw]:[]), ...(audioInput?[...audioInput.bindings,audioInput.raw,audioInput.expiresAt]:[]))
      .first<{ admitted: number }>();
    if (final?.admitted !== 1 || Date.parse(source.expires_at) <= Date.now() || job && Date.parse(job.expiresAt) <= Date.now()
      || audioInput && Date.parse(audioInput.expiresAt) <= Date.now()) throw unavailable();
    // No asynchronous work occurs between the final read and literal response.
    return new Response(serialized, { status: 200, headers });
  } catch (failure) {
    if (failure instanceof Unavailable) return error(failure.message === "personal_principal_required"
      ? "personal_principal_required" : "retained_story_unavailable", failure.message === "personal_principal_required" ? 403 : 404);
    // Missing schema, adapter failures and invalid stored JSON remain opaque.
    return error("retained_story_unavailable", 503);
  }
}

/** Preserve the original Short Story read and completed-job protocol. */
export function handleRetainedStoryRead(request: Request, env: WorkerEnv): Promise<Response> {
  return readCurrentRetainedNative(request, env, null);
}

/** Native outputs use the current personal read witness, with no generation or media authority. */
export function handleNativeRetainedOutputRead(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "GET") return Promise.resolve(error("method_not_allowed", 405));
  const sceneHandle = parseNativeSceneCompletionUrl(request.url);
  if (sceneHandle) return readCurrentRetainedNative(request, env, null, { output: "scene", handle: sceneHandle });
  const slidesHandle = parseNativeSlidesCompletionUrl(request.url);
  if (slidesHandle) return readCurrentRetainedNative(request, env, null, { output: "slides", handle: slidesHandle });
  const storyboardHandle = parseNativeStoryboardCompletionUrl(request.url);
  if (storyboardHandle) return readCurrentRetainedNative(request, env, null, { output: "storyboard", handle: storyboardHandle });
  const audioHandle = parseNativeAudioCompletionUrl(request.url);
  if (audioHandle) return readCurrentRetainedNative(request, env, null, { output: "audio", handle: audioHandle });
  const target = parseNativeRetainedOutputRequestUrl(request.url);
  if (!target) return Promise.resolve(error("invalid_native_retained_output_selection", 400));
  return readCurrentRetainedNative(request, env, target);
}

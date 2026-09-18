import { PLATFORM_PRINCIPAL_WITH_ACCESS_SQL, principalAccessFromRow } from "./access-policy.ts";
import { configuredPilotAdmissionGuard, POLICY_VERSION } from "./pilot-policy.ts";
import { RETAINED_STORY_JSON_MAX_BYTES, validateRetainedStoryDto, type RetainedStorySelection } from "../src/model/retained-short-story.ts";
import { projectNativeRetainedOutput, type NativeRetainedOutputKind, type NativeRetainedOutputDto } from "../src/model/native-retained-output.ts";
import type { SelectedOutputShareSelection } from "../src/model/selected-output-share.ts";
import type { WorkerEnv } from "./runtime.ts";

// Shared native custody only. No provider, mutation, initializer or public route.
export const AUTH_BYTES = 128 * 1024;
const EVENT_COUNT = 512;
export const EVENT_BYTES = 1024 * 1024;
const EVENT_ROW_BYTES = 64 * 1024;
const encoder = new TextEncoder();
export const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const familySql = "'DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored','DocumentRenderCompleted','DocumentArtifactEdited'";
export type NativeRetainedIdentity = Readonly<{ userId: string; email: string; source: "openai-workspace" }>;

export class Unavailable extends Error {}
export const unavailable = () => new Unavailable("retained_story_unavailable");
export const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const bytes = (value: string) => encoder.encode(value).length;
export const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  byte => byte.toString(16).padStart(2, "0")).join("");

/** This endpoint is hosted-principal-only; it does not provision even a local development account. */
export function hostedIdentity(request: Request) {
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
export function authorizationQuery(env: WorkerEnv, identity: { userId: string; email: string }) {
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

export type EventRow = {
  event_id: string; sequence: number; type: string; payload: string;
  secret_id: string | null; secret_owner: string | null; secret_document: string | null;
  secret_project: string | null; secret_redacted: string | null; project_scoped: number;
};
export const eventColumns = ["event_id", "sequence", "type", "payload", "secret_id", "secret_owner",
  "secret_document", "secret_project", "secret_redacted", "project_scoped"] as const;

/**
 * Conservative closed history: all six operational families in this owner's
 * stream, not a truncated page. No event_private_payloads.private_json is read.
 * Metadata attached to an event is included in the aggregate byte admission.
 */
export const eventCte = `event_base AS (
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

export function eventSnapshot(rows: EventRow[]): string {
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

export function selectNative(rows: EventRow[], selection: { documentId:string; artifactId:string; revision:number; contentSha256?:string }, ownerId: string, completionId?:string,
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
    completionId: completion.row.event_id, completionItemCount: payload.item_count, completionInputRef: payload.input_ref,
    latestEditId: edits.at(-1)?.row.event_id ?? null,
    editIds: Object.freeze(edits.map(edit => edit.row.event_id)),
    model3dMediaTransitions: Object.freeze(expectedKind === "model3d" ? edits.flatMap((edit, index) =>
      edit.payload.source_surface === "document-artifact-model3d-scale" || edit.payload.revision_action === "restore"
        || Array.isArray(edit.payload.changed_fields) && edit.payload.changed_fields.includes("model3d_revision") ? [index] : []) : []),
    editContentHashes: Object.freeze(edits.map(edit => edit.payload.content_sha256 as string)) });
}


export function personalContentGuard() {
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

/** Preserve the native endpoint's exact current canonical-principal read. */
export async function readNativeRetainedPrincipal(env: WorkerEnv, identity: NativeRetainedIdentity) {
  const auth = authorizationQuery(env, identity);
  const principal = await env.DB.prepare(`WITH ${auth.cte} SELECT auth_json FROM authorized`)
    .bind(...auth.bindings).first<{ auth_json: string }>();
  if (!principal || typeof principal.auth_json !== "string" || bytes(principal.auth_json) > AUTH_BYTES) {
    throw new Unavailable("retained_story_access_denied");
  }
  const observed = record(JSON.parse(principal.auth_json));
  if (!observed || observed.user_id !== identity.userId || observed.email !== identity.email
    || observed.role !== "creator" && observed.role !== "admin" || observed.consent_version !== POLICY_VERSION) throw unavailable();
  for (const name of ["grants_json", "organizations_json", "projects_json", "identity_policies_json"] as const) {
    if (typeof observed[name] !== "string" || !Array.isArray(JSON.parse(observed[name]))) throw unavailable();
  }
  const role = observed.role;
  const access = await principalAccessFromRow(observed, role, {
    email: identity.email, source: identity.source, subject: identity.userId,
  });
  if (access.identityPolicyDeniedCustody) throw new Unavailable("retained_story_access_denied");
  return { auth, principal, observed, role };
}

export async function readNativeRetainedSelection(env: WorkerEnv, identity: NativeRetainedIdentity,
  target: { documentId: string; artifactId: string; revision: number; contentSha256?: string },
  expectedKind: "short_story" | NativeRetainedOutputKind, completionId?: string, requestedItemCount?: number) {
  const events = await env.DB.prepare(`WITH ${eventCte} SELECT * FROM event_rows ORDER BY sequence`)
    .bind(`creative:${identity.userId}`).all<EventRow>();
  const snapshot = eventSnapshot(events.results);
  const native = selectNative(events.results, target, identity.userId, completionId, expectedKind, requestedItemCount);
  return { snapshot, native };
}

export async function readNativeRetainedContent(env: WorkerEnv, identity: NativeRetainedIdentity,
  target: { documentId: string; artifactId: string; revision: number; contentSha256?: string },
  native: ReturnType<typeof selectNative>) {
  const contentBindings = [native.contentId, identity.userId, native.projectId, target.documentId, target.artifactId];
  const source = await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${personalContentGuard()}`)
    .bind(...contentBindings).first<{ content: string; expires_at: string }>();
  if (!source || typeof source.content !== "string" || bytes(source.content) > RETAINED_STORY_JSON_MAX_BYTES) throw unavailable();
  const contentSha256 = await hash(source.content);
  if (target.contentSha256 !== undefined && contentSha256 !== target.contentSha256) throw unavailable();
  const selection: RetainedStorySelection = Object.freeze({ documentId: target.documentId, artifactId: target.artifactId,
    revision: target.revision, contentSha256 });
  const body = record(JSON.parse(source.content));
  if (!body || typeof body.title !== "string" || typeof body.content_markdown !== "string"
    || !Array.isArray(body.items)) throw unavailable();
  return { contentBindings, source, selection,
    body: body as Record<string, unknown> & { title: string; content_markdown: string; items: unknown[] } };
}

/** Exact shared base of the native final read. Caller appends its existing
 * completion/media predicates; every bind keeps the original native order.
 */
export function nativeRetainedSourceFinalGuard() {
  const comparisons = eventColumns.map((name, index) => `actual.${name} IS NOT json_extract(expected.value,'$[${index}]')`).join(" OR ");
  return `${personalContentGuard()}
    AND CAST(content AS BLOB)=CAST(? AS BLOB) AND expires_at=?
    AND EXISTS(SELECT 1 FROM authorized WHERE CAST(auth_json AS BLOB)=CAST(? AS BLOB))
    AND (SELECT COUNT(*) FROM event_rows)=(SELECT COUNT(*) FROM expected_events)
    AND NOT EXISTS(SELECT 1 FROM expected_events expected LEFT JOIN event_rows actual
      ON actual.event_id=json_extract(expected.value,'$[0]') WHERE actual.event_id IS NULL OR ${comparisons})`;
}

type TextDto = NonNullable<ReturnType<typeof validateRetainedStoryDto>> | NativeRetainedOutputDto;
type TextSnapshot = Readonly<{
  identity: NativeRetainedIdentity;
  selection: SelectedOutputShareSelection;
  projectId: string;
  contentId: string;
  completionId: string;
  sourceExpiresAt: string;
  dto: TextDto;
  authSnapshot: string;
}>;
type TextState = { env: WorkerEnv; database: WorkerEnv["DB"];
  cohort: WorkerEnv["FORMA_PILOT_COHORT_ID"]; administrators: WorkerEnv["FORMA_ADMIN_EMAILS"]; snapshot: TextSnapshot;
  assertion: { sql: string; bindings: (string | number | null)[] } };
declare const textCustodyBrand: unique symbol;
export type NativeRetainedTextCustody = Readonly<{ [textCustodyBrand]: true }>;
const textCustodies = new WeakMap<NativeRetainedTextCustody, TextState>();

/** A fresh internal text observation plus a fixed SQL witness. The identity
 * comes from the actual authenticated issuer or an independently verified
 * purpose-specific read-share record. This function never interprets a token,
 * synthesizes request headers, accepts caller SQL or grants publishing rights.
 */
export async function readNativeRetainedTextCustody(env: WorkerEnv, identity: NativeRetainedIdentity,
  selection: SelectedOutputShareSelection): Promise<NativeRetainedTextCustody> {
  const database = env.DB, cohort = env.FORMA_PILOT_COHORT_ID, administrators = env.FORMA_ADMIN_EMAILS;
  const currentEnvironment = () => {
    if (env.DB !== database || env.FORMA_PILOT_COHORT_ID !== cohort || env.FORMA_ADMIN_EMAILS !== administrators) throw unavailable();
  };
  if (selection.output !== "short_story" && selection.output !== "scene" && selection.output !== "slides"
    || identity.source !== "openai-workspace") throw unavailable();
  const capturedIdentity = Object.freeze({ userId: identity.userId, email: identity.email, source: identity.source });
  const capturedSelection = Object.freeze({ output: selection.output, documentId: selection.documentId,
    artifactId: selection.artifactId, revision: selection.revision, contentSha256: selection.contentSha256 });
  const { auth, principal, observed, role } = await readNativeRetainedPrincipal(env, capturedIdentity);
  currentEnvironment();
  // Owner custody under an authenticated identity is not itself permission for
  // unauthenticated public delivery. Reuse the native policy's stricter branch.
  const publicAccess = await principalAccessFromRow(observed, role);
  currentEnvironment();
  if (publicAccess.identityPolicyDeniedCustody) throw new Unavailable("retained_story_access_denied");
  const { snapshot, native } = await readNativeRetainedSelection(env, capturedIdentity, capturedSelection, capturedSelection.output);
  currentEnvironment();
  const { contentBindings, source, body } = await readNativeRetainedContent(env, capturedIdentity, capturedSelection, native);
  currentEnvironment();
  const nativeSelection = { documentId: capturedSelection.documentId, artifactId: capturedSelection.artifactId,
    revision: capturedSelection.revision, contentSha256: capturedSelection.contentSha256 };
  const dto = capturedSelection.output === "short_story"
    ? validateRetainedStoryDto({ schemaVersion: 1, kind: "native-retained-short-story", selection: nativeSelection,
      title: body.title, contentMarkdown: body.content_markdown, expiresAt: source.expires_at }, nativeSelection)
    : projectNativeRetainedOutput({ output: capturedSelection.output, selection: nativeSelection }, body, source.expires_at, native.sceneMedium);
  if (!dto) throw unavailable();
  const assertion = {
    sql: `WITH ${auth.cte},${eventCte},expected_events AS (SELECT value FROM json_each(?))
      SELECT 1 AS admitted FROM private_content WHERE ${nativeRetainedSourceFinalGuard()}`,
    bindings: [...auth.bindings, `creative:${capturedIdentity.userId}`, snapshot, ...contentBindings,
      source.content, source.expires_at, principal.auth_json],
  };
  const final = await database.prepare(assertion.sql)
    .bind(...assertion.bindings).first<{ admitted: number }>();
  currentEnvironment();
  if (final?.admitted !== 1 || Date.parse(source.expires_at) <= Date.now()) throw unavailable();
  const proof = Object.freeze({}) as NativeRetainedTextCustody;
  textCustodies.set(proof, { env, database, cohort, administrators, assertion, snapshot: Object.freeze({
    identity: capturedIdentity, selection: capturedSelection, projectId: native.projectId, contentId: native.contentId,
    completionId: native.completionId, sourceExpiresAt: source.expires_at, dto, authSnapshot: principal.auth_json,
  }) });
  return proof;
}

function textState(proof: NativeRetainedTextCustody, env: WorkerEnv): TextState {
  const state = textCustodies.get(proof);
  if (!state || state.env !== env || state.database !== env.DB || state.cohort !== env.FORMA_PILOT_COHORT_ID
    || state.administrators !== env.FORMA_ADMIN_EMAILS) throw unavailable();
  return state;
}

/** Internal snapshots never replace rechecking the assertion at commit/read. */
export function nativeRetainedTextCustodySnapshot(proof: NativeRetainedTextCustody, env: WorkerEnv): TextSnapshot {
  return textState(proof, env).snapshot;
}

export function nativeRetainedTextCustodyAssertion(proof: NativeRetainedTextCustody, env: WorkerEnv) {
  const { assertion } = textState(proof, env);
  return { sql: assertion.sql, bindings: [...assertion.bindings] };
}

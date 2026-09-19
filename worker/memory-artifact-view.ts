import { foldEvents } from "../src/model/events.ts";
import { documentArtifactRevision, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { AUTHORING_EVENT_COLUMNS, authoringEventProof, authoringEventRowsProof, combineAuthoringGuards } from "./authoring-event-proof.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { configuredPilotAdmissionGuard } from "./intake-authority.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import type { PilotUser } from "./pilot-policy.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, readWorkspaceEvents, serializeEvent, type WorkerEnv } from "./runtime.ts";

const clock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const keys = new Set(["artifact_id", "artifact_kind", "project_id", "document_id", "artifact_revision", "content_sha256", "source_surface"]);
const id = (value: unknown): value is string => typeof value === "string" && /^[\p{L}\p{N}_:./@%+-]{1,240}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const failure = (error: string, status = 409) => Response.json({ error, noAutomaticRetry: true }, { status, headers: { "cache-control": "private, no-store" } });
const native = (payload: Record<string, unknown>) => !payload.simulation && !payload.synthetic
  && !(payload.origin && typeof payload.origin === "object" && (payload.origin as Record<string, unknown>).synthetic)
  && ["mock_data_source", "replay_session_id", "fictional_user_id", "report_space"].every(key => payload[key] == null);

/** Read-only exact current artifact certification, shared by the genuine view
 * writer and explicitly negotiated Memory inspection. It never appends a view
 * or grants enrollment. The returned guard must survive the caller's final batch. */
export async function preparePersonalArtifactViewSource(env: WorkerEnv, actor: PilotUser, input: unknown) {
  const db = env.DB, actorSnapshot = JSON.stringify(actor);
  if (actor.fictional || actor.projectExecution || actor.streamId !== `creative:${actor.userId}`
    || !["admin", "creator"].includes(actor.role) || !actor.authorizationSnapshot) return failure("artifact_view_personal_principal_required", 403);
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("artifact_view_invalid", 400);
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !keys.has(key)) || ![raw.artifact_id, raw.project_id, raw.document_id].every(id)
    || !Number.isSafeInteger(raw.artifact_revision) || Number(raw.artifact_revision) < 0
    || typeof raw.content_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(raw.content_sha256)
    || typeof raw.source_surface !== "string" || !/^[a-z][a-z-]{0,47}-artifact-gallery$/u.test(raw.source_surface)) return failure("artifact_view_invalid", 400);
  // Snapshot browser fields before the first await. Only verified identifiers are written below.
  const payload = { ...raw }, artifactId = String(payload.artifact_id), documentId = String(payload.document_id), projectId = String(payload.project_id);
  const history = await readWorkspaceEvents(env, actor.streamId);
  const projection = foldEvents(history, Number.POSITIVE_INFINITY, documentId, projectId);
  const document = projection.documents.find(row => row.id === documentId && row.projectId === projectId);
  const artifact = projection.artifacts.find(row => row.id === artifactId && row.documentId === documentId);
  const completed = history.find(row => row.eventId === artifact?.sourceEventId);
  const created = history.findLast(row => ["DocumentCreated", "DocumentForked"].includes(row.type) && row.payload.document_id === documentId);
  if (!document || !created || created.payload.project_id !== projectId || !artifact?.contentRef || !completed || completed.type !== "DocumentRenderCompleted"
    || completed.payload.project_id !== projectId || completed.payload.document_id !== documentId
    || completed.actor !== "worker:renderer" || !native(completed.payload) || artifact.kind !== payload.artifact_kind
    || documentArtifactRevision(history, artifactId) !== payload.artifact_revision) return failure("artifact_view_source_unavailable");
  const contentId = artifact.contentRef;
  // A legal hold preserves evidence, not permission to turn expired content into learning evidence.
  const body = await env.DB.prepare(`SELECT content,created_at,expires_at FROM private_content
    WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>${clock}
      AND length(CAST(content AS BLOB))<=1500000`).bind(contentId, actor.userId)
    .first<{ content: string; created_at: string; expires_at: string }>();
  if (!body || !parseDocumentArtifactContent(body.content)
    || ![body.created_at, body.expires_at].every(timestamp)
    || Date.parse(body.created_at) > Date.now() || Date.parse(body.expires_at) <= Date.now()) return failure("artifact_view_source_unavailable");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.content))), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== payload.content_sha256) return failure("artifact_view_source_unavailable");
  const dependencies = history.filter(event => document.sourceEvents.includes(event.eventId)
    || event.eventId === completed.eventId || event.type === "DocumentArtifactEdited" && event.payload.artifact_id === artifactId
    || event.type === "ProjectCreated" && event.payload.project_id === projectId);
  if (!dependencies.length || dependencies.length > 256 || dependencies.some(event => event.compensatesEventId || event.eventId.startsWith("optimistic:")
    || event.clientId.includes("optimistic") || ![event.recordedAt, event.occurredAt].every(timestamp)
    || Date.parse(event.recordedAt) > Date.now() || Date.parse(event.occurredAt) > Date.now() || !native(event.payload)))
    return failure("artifact_view_source_unavailable");
  const dependencyIds = JSON.stringify(dependencies.map(event => event.eventId));
  const rows = await env.DB.prepare(`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.created_at AS private_created_at,secret.redacted_at
    FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))`).bind(actor.streamId, dependencyIds).all<Record<string, unknown>>();
  if (rows.success !== true || !Array.isArray(rows.results) || rows.results.length !== dependencies.length
    || new Set(rows.results.map(row => row.event_id)).size !== dependencies.length || rows.results.some(row => {
    const expected = dependencies.find(event => event.eventId === row.event_id);
    try { return !expected || row.owner_id !== actor.userId || row.redacted_at !== null
      || JSON.stringify(serializeEvent(row)) !== JSON.stringify(expected)
      || JSON.stringify(eventWriteBindings(expected)) !== JSON.stringify([...AUTHORING_EVENT_COLUMNS.map(name => row[name]), row.owner_id, row.project_id, row.document_id, row.private_json])
      || row.private_created_at !== row.recorded_at
      || JSON.parse(String(row.payload))._private_ref !== row.event_id; } catch { return true; }
  })) return failure("artifact_view_source_unavailable");
  const sourceRows = rows.results.map(row => [...AUTHORING_EVENT_COLUMNS.map(name => row[name]), row.owner_id, row.project_id, row.document_id, row.private_json] as Array<string | number | null>);
  if (bytes(JSON.stringify(sourceRows)) > 1_500_000) return failure("artifact_view_source_unavailable");
  const snapshot = actor.authorizationSnapshot, pilot = configuredPilotAdmissionGuard(env, actor);
  const authority = { sql: `EXISTS(SELECT 1 FROM(${PRINCIPAL_WITH_ACCESS_SQL}) principal WHERE
    (principal.user_id,principal.email,principal.role,principal.updated_at,principal.consent_version,COALESCE(principal.permission_epoch,''),
      COALESCE(principal.grants_json,'[]'),COALESCE(principal.organizations_json,'[]'),COALESCE(principal.projects_json,'[]'),
      COALESCE(principal.identity_policies_json,'[]'),COALESCE(principal.approved_canvas_requirements,0))=(?,?,?,?,?,?,?,?,?,?,?))
    AND (${pilot.sql}) AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE project_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='document' AND resource_id=?)
      OR (resource_kind='artifact' AND resource_id=?) OR (resource_kind='content' AND resource_id=?))
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=?)
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?))
      OR project_id=?)`, bindings: [actor.userId, actor.userId, actor.email, actor.role, snapshot.updatedAt, POLICY_VERSION,
    snapshot.rawEpoch, snapshot.grants, snapshot.organizations, snapshot.projects, snapshot.identityPolicies, snapshot.canvasRequirements,
    ...pilot.bindings, projectId, documentId, artifactId, contentId, contentId, dependencyIds, projectId] };
  const retained = { sql: `EXISTS(SELECT 1 FROM private_content WHERE
    (content_id,owner_id,kind,content,created_at,expires_at,redacted_at) IS (?,?, 'document-artifact',?,?,?,NULL) AND expires_at>${clock})
    AND NOT EXISTS(SELECT 1 FROM events negative WHERE negative.stream_id=? AND negative.compensates_event_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM event_private_payloads secret WHERE secret.private_event_id IN(SELECT value FROM json_each(?))
      AND secret.created_at!=(SELECT event.recorded_at FROM events event WHERE event.event_id=secret.private_event_id))`,
  bindings: [contentId, actor.userId, body.content, body.created_at, body.expires_at, actor.streamId, dependencyIds, dependencyIds] };
  // A returned workspace page is not a completeness certificate. Independently pin
  // current native selections and revision count, including rows a partial page omitted.
  const selection = { sql: `(SELECT current.event_id FROM events current WHERE current.stream_id=? AND current.type='DocumentRenderCompleted'
      AND json_extract(current.payload,'$.artifact_id')=? ORDER BY current.sequence DESC LIMIT 1)=?
    AND (SELECT COUNT(*) FROM events edits WHERE edits.stream_id=? AND edits.type='DocumentArtifactEdited'
      AND json_extract(edits.payload,'$.artifact_id')=?)=?
    AND (SELECT declaration.event_id FROM events declaration WHERE declaration.stream_id=? AND declaration.type IN('DocumentCreated','DocumentForked')
      AND json_extract(declaration.payload,'$.document_id')=? ORDER BY declaration.sequence DESC LIMIT 1)=?
    AND (SELECT boundary.type FROM events boundary WHERE boundary.stream_id=?
      AND boundary.type IN('DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored')
      AND json_extract(boundary.payload,'$.document_id')=? ORDER BY boundary.sequence DESC LIMIT 1)!='DocumentRemoved'`,
  bindings: [actor.streamId, artifactId, completed.eventId, actor.streamId, artifactId, Number(payload.artifact_revision),
    actor.streamId, documentId, created.eventId, actor.streamId, documentId] };
  const source = combineAuthoringGuards(authority, retained, selection, authoringEventRowsProof(sourceRows));
  if (env.DB !== db || JSON.stringify(actor) !== actorSnapshot) return failure("artifact_view_source_unavailable");
  return { source, bodyBytes: bytes(body.content), provenance: {
    contentRef: contentId, eventIds: dependencies.map(event=>event.eventId).sort(),
  }, payload: {
    artifact_id: artifactId, artifact_kind: artifact.kind, document_id: documentId, project_id: projectId,
    artifact_revision: payload.artifact_revision, content_sha256: hash, artifact_source_event_id: completed.eventId,
    artifact_content_ref: contentId, observed_source_expires_at: body.expires_at,
    source_surface: payload.source_surface, capture_version: "personal-artifact-view-v2",
  } };
}

/** A reported current view, not proof of attention, understanding, preference, or a Memory grant. */
export async function appendPersonalArtifactView(
  env: WorkerEnv, actor: PilotUser, input: unknown, head: number, clientId: string, correlationId: string,
): Promise<Response> {
  if (!Number.isSafeInteger(head) || head < 0) return failure("artifact_view_invalid", 400);
  const db = env.DB, certified = await preparePersonalArtifactViewSource(env, actor, input);
  if (certified instanceof Response) return certified;
  if (env.DB !== db) return failure("artifact_view_source_unavailable");
  const { source } = certified;
  const event = makeEvent(actor.streamId, head + 1, `user:${actor.userId}`, clientId, correlationId, "DocumentArtifactViewed", certified.payload);
  const exact = authoringEventProof([event]);
  const insert = env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${Array(17).fill("?").join(",")}
    WHERE (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (${source.sql})`)
    .bind(...eventWriteBindings(event), actor.streamId, head, ...source.bindings);
  // An assertion failure rolls back the trigger-backed event and erasable envelope together.
  // No commutative rebase/retry is allowed after observing the original source or losing an ACK.
  const assertion = env.DB.prepare(`SELECT CASE WHEN (${source.sql}) AND (${exact.sql})
    AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=?)
    AND EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND created_at=?)
    THEN 1 ELSE json_extract('artifact_view_source_changed','$') END AS artifact_view_committed`)
    .bind(...source.bindings, ...exact.bindings, actor.streamId, event.sequence, event.eventId, event.eventId, event.recordedAt);
  let results: D1Result[];
  try { results = await env.DB.batch([insert, assertion]); }
  catch { return failure("artifact_view_commit_unconfirmed"); }
  if (!Array.isArray(results) || results.length !== 2 || results.some(result => result?.success !== true)
    || results[0]?.meta?.changes !== 1 || results[1]?.results?.length !== 1
    || (results[1].results[0] as Record<string, unknown>)?.artifact_view_committed !== 1) return failure("artifact_view_commit_unconfirmed");
  return Response.json({ appended: [event], rejected: [], head: event.sequence, noAutomaticRetry: true }, { headers: { "cache-control": "private, no-store" } });
}

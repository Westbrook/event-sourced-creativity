import { foldEvents } from "../src/model/events.ts";
import { documentArtifactRevision, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { AUTHORING_EVENT_COLUMNS, AUTHORING_SIDECAR_COLUMNS, authoringEventProof, authoringEventRowsProof, authoringSidecarProof, combineAuthoringGuards } from "./authoring-event-proof.ts";
import { PRINCIPAL_WITH_ACCESS_SQL } from "./access-policy.ts";
import { configuredPilotAdmissionGuard } from "./intake-authority.ts";
import { POLICY_VERSION } from "./policy-version.ts";
import { hasCapability, type PilotUser } from "./pilot-policy.ts";
import { executionAdmissionGuard, type ConsequentialBinding } from './consequential-consent.ts';
import { readProjectSourceEvents } from './project-access.ts';
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
  return preparePersonalArtifactSource(env, actor, input);
}

/** A genuine retained native view selects the historical snapshot. This never
 * manufactures an old view or authorizes the browser to publish against it. */
export async function preparePersonalArtifactHistorySource(env: WorkerEnv, actor: PilotUser, observationEventId: string) {
  if (!id(observationEventId)) return failure("artifact_view_invalid", 400);
  return preparePersonalArtifactSource(env, actor, null, observationEventId);
}

export async function prepareGovernedArtifactViewSource(env:WorkerEnv,actor:PilotUser,binding:ConsequentialBinding,input:unknown,observationEventId?:string){
  if(!binding.scope||binding.actorUserId!==actor.userId||binding.scope.actorUserId!==actor.userId
    ||binding.streamId!=='creative:'+binding.scope.ownerUserId||binding.projectId!==binding.scope.projectId
    ||binding.permissionEpoch!==actor.access.permissionEpoch||!hasCapability(actor,'project.read',binding.scope))return failure('artifact_view_governed_principal_required',403);
  return preparePersonalArtifactSource(env,actor,input,observationEventId,binding);
}

type ArtifactFrameSelector={eventId:string;artifactId:string;documentId:string;projectId:string;contentRef:string};
declare const nativeArtifactFrame:unique symbol;
export type NativeArtifactHistoryFrame=Readonly<{[nativeArtifactFrame]:true}>;
type ArtifactFrame={env:WorkerEnv;db:WorkerEnv['DB'];actorSnapshot:string;bindingSnapshot:string|undefined;governed?:ConsequentialBinding;
  selector:ArtifactFrameSelector;rows:Record<string,unknown>[];body:{content:string;created_at:string;expires_at:string}|null;
  eventScopes:Record<string,unknown>[];resources:Record<string,unknown>[];projectionGuard:{sql:string;bindings:(string|number|null)[]}};
const artifactFrames=new WeakMap<NativeArtifactHistoryFrame,ArtifactFrame>();

/** One bounded native read batch for up to four exact historical selectors.
 * No caller-supplied projection/body can become a frame. These opaque frames
 * only replace read round trips; every dependency, selection, envelope, body,
 * current access and custody guard is still reconstructed and replayed below. */
export async function captureNativeArtifactHistoryFrames(env:WorkerEnv,actor:PilotUser,selectors:ArtifactFrameSelector[],governed?:ConsequentialBinding){
  const db=env.DB,actorSnapshot=JSON.stringify(actor),bindingSnapshot=JSON.stringify(governed);
  selectors=structuredClone(selectors);
  if(!selectors.length||selectors.length>4||new Set(selectors.map(row=>row.eventId)).size!==selectors.length
    ||selectors.some(row=>!Object.values(row).every(id)))throw Error('artifact_history_frame_invalid');
  const owner=governed?.scope?.ownerUserId??actor.userId,stream=governed?.streamId??actor.streamId,scope=governed?.scope;
  if(governed&&(!scope||!hasCapability(actor,'project.read',scope)||governed.actorUserId!==actor.userId
    ||scope.actorUserId!==actor.userId||stream!=='creative:'+owner||governed.permissionEpoch!==actor.access.permissionEpoch))throw Error('artifact_history_frame_authority');
  // Explicit native event/resource proofs do not depend on the projection's
  // last indexed sequence. A paid assistant append can legitimately leave that
  // index behind; relevant unindexed source events still fail exact custody.
  const projectionGuard=scope?{sql:`EXISTS(SELECT 1 FROM project_migration_states WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active'
    AND last_owner_sequence<=(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?))`,bindings:[scope.projectAccessId,scope.organizationId,owner,stream]}:{sql:'1',bindings:[]};
  const plans=selectors.map(selector=>{
    if(governed&&(selector.projectId!==governed.projectId||selector.documentId!==governed.documentId))throw Error('artifact_history_frame_scope');
    const selection=`FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.redacted_at IS NULL
      WHERE event.stream_id=? AND (event.event_id=?
        OR event.type='ProjectCreated' AND json_extract(event.payload,'$.project_id')=?
        OR event.type IN('DocumentCreated','DocumentForked','DocumentRenamed','DocumentOpened','DocumentRemoved','DocumentRestored') AND json_extract(event.payload,'$.document_id')=?
        OR event.type IN('DocumentRenderCompleted','DocumentArtifactEdited') AND json_extract(event.payload,'$.artifact_id')=?)`;
    const bindings=[stream,selector.eventId,selector.projectId,selector.documentId,selector.artifactId];
    // Bound bytes in the hydration statement itself. An oversized frame is
    // unavailable, never a partial historical projection or acknowledged job.
    const bounded=`(SELECT COUNT(*) ${selection})<=512 AND (SELECT COALESCE(SUM(length(CAST(event.payload AS BLOB))+length(CAST(COALESCE(secret.private_json,'') AS BLOB))),0) ${selection})<=1500000`;
    return {selector,selection,bindings,queries:[
      {sql:`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.created_at AS private_created_at,secret.redacted_at ${selection}
        AND (${bounded}) ORDER BY event.sequence LIMIT 513`,bindings:[...bindings,...bindings,...bindings]},
      {sql:`SELECT content,created_at,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='document-artifact'
        AND redacted_at IS NULL AND expires_at>${clock} AND length(CAST(content AS BLOB))<=1500000`,bindings:[selector.contentRef,owner]},
      ...(scope?[
        {sql:`SELECT * FROM project_event_scopes WHERE event_id IN(SELECT event.event_id ${selection}) ORDER BY event_id LIMIT 513`,bindings},
        {sql:`SELECT * FROM project_resource_scopes WHERE owner_user_id=? AND ((resource_kind='document' AND resource_id=?) OR(resource_kind='artifact' AND resource_id=?)
          OR(resource_kind='content' AND resource_id=?)) ORDER BY resource_kind,resource_id,project_access_id LIMIT 4`,bindings:[owner,selector.documentId,selector.artifactId,selector.contentRef]},
        {sql:`SELECT 1 AS current WHERE (${projectionGuard.sql})`,bindings:projectionGuard.bindings},
      ]:[]),
    ]};
  });
  const queries=plans.flatMap(plan=>plan.queries),results=structuredClone(await db.batch<Record<string,unknown>>(queries.map(query=>db.prepare(query.sql).bind(...query.bindings))));
  if(env.DB!==db||JSON.stringify(actor)!==actorSnapshot||JSON.stringify(governed)!==bindingSnapshot||results.length!==queries.length
    ||results.some(result=>result?.success!==true||!Array.isArray(result.results)||'error' in result&&result.error!==undefined))throw Error('artifact_history_frame_unavailable');
  const frames=new Map<string,NativeArtifactHistoryFrame>();let offset=0;
  for(const plan of plans){
    const rows=results[offset]!.results,bodies=results[offset+1]!.results,eventScopes=scope?results[offset+2]!.results:[],resources=scope?results[offset+3]!.results:[];
    if(rows.length>512||bodies.length>1||scope&&(eventScopes.length>512||resources.length!==3||results[offset+4]!.results.length!==1||results[offset+4]!.results[0]!.current!==1))throw Error('artifact_history_frame_unavailable');
    const frameColumns=[...AUTHORING_EVENT_COLUMNS,'owner_id','project_id','document_id','private_json','private_created_at','redacted_at'];
    if(new Set(rows.map(row=>row.event_id)).size!==rows.length||rows.some(row=>Object.keys(row).sort().join(',')!==[...frameColumns].sort().join(',')))throw Error('artifact_history_frame_unavailable');
    const serialized=JSON.stringify(rows.map(row=>frameColumns.map(key=>row[key])));if(bytes(serialized)>1900000)throw Error('artifact_history_frame_capacity');
    const exactFrame={sql:`(SELECT json_group_array(json(value)) FROM(SELECT json_array(${[...AUTHORING_EVENT_COLUMNS.map(key=>'event.'+key),'secret.owner_id','secret.project_id','secret.document_id','secret.private_json','secret.created_at','secret.redacted_at'].join(',')}) AS value ${plan.selection} ORDER BY event.sequence LIMIT 513))=?`,bindings:[...plan.bindings,serialized]};
    const frame=Object.freeze({}) as NativeArtifactHistoryFrame;
    artifactFrames.set(frame,{env,db,actorSnapshot,bindingSnapshot,governed,selector:structuredClone(plan.selector),rows,
      body:(bodies[0]??null) as ArtifactFrame['body'],eventScopes,resources,projectionGuard:combineAuthoringGuards(projectionGuard,exactFrame)});frames.set(plan.selector.eventId,frame);offset+=plan.queries.length;
  }
  return frames;
}
export function prepareNativeArtifactHistoryFrame(env:WorkerEnv,actor:PilotUser,frame:NativeArtifactHistoryFrame){
  const captured=artifactFrames.get(frame);
  if(!captured||captured.env!==env||captured.db!==env.DB||captured.actorSnapshot!==JSON.stringify(actor)
    ||captured.bindingSnapshot!==JSON.stringify(captured.governed))return Promise.resolve(failure('artifact_history_frame_unavailable'));
  return preparePersonalArtifactSource(env,actor,null,captured.selector.eventId,captured.governed,frame);
}

async function preparePersonalArtifactSource(env: WorkerEnv, actor: PilotUser, input: unknown, observationEventId?: string,governed?:ConsequentialBinding,frame?:NativeArtifactHistoryFrame) {
  const db = env.DB, actorSnapshot = JSON.stringify(actor),bindingSnapshot=JSON.stringify(governed);
  const scope=governed?.scope,owner=scope?.ownerUserId??actor.userId,stream=governed?.streamId??actor.streamId;
  const captureVersion=governed?'governed-artifact-view-v1':'personal-artifact-view-v2';
  if (actor.fictional || !governed&&(actor.projectExecution || actor.streamId !== `creative:${actor.userId}`|| !["admin", "creator"].includes(actor.role)) || !actor.authorizationSnapshot) return failure("artifact_view_personal_principal_required", 403);
  // For history, obtain the selector from an actual native event, not browser
  // revision/expiry claims. Every envelope is checked again below and replayed.
  const captured=frame?artifactFrames.get(frame):undefined;
  if(frame&&(!captured||captured.env!==env||captured.db!==db||captured.actorSnapshot!==actorSnapshot||captured.bindingSnapshot!==bindingSnapshot||captured.selector.eventId!==observationEventId))return failure("artifact_history_frame_unavailable");
  const read=()=>captured?Promise.resolve(captured.rows.map(serializeEvent)):scope?readProjectSourceEvents(env,scope,{synchronize:false}):readWorkspaceEvents(env,stream);
  const fullHistory = observationEventId ? await read() : null;
  const observation = fullHistory?.find(event => event.eventId === observationEventId);
  if (observationEventId && (!observation || observation.type !== "DocumentArtifactViewed"
    || observation.actor !== `user:${actor.userId}` || observation.payload.capture_version !== captureVersion
    || Object.keys(observation.payload).sort().join(',') !== [...keys,'artifact_source_event_id','artifact_content_ref','observed_source_expires_at','capture_version'].sort().join(',')
    || !timestamp(observation.payload.observed_source_expires_at) || Date.parse(observation.payload.observed_source_expires_at) <= Date.now()))
    return failure("artifact_view_source_unavailable");
  if (observation) input = Object.fromEntries([...keys].map(key => [key, observation.payload[key]]));
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("artifact_view_invalid", 400);
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !keys.has(key)) || ![raw.artifact_id, raw.project_id, raw.document_id].every(id)
    || !Number.isSafeInteger(raw.artifact_revision) || Number(raw.artifact_revision) < 0
    || typeof raw.content_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(raw.content_sha256)
    || typeof raw.source_surface !== "string" || !/^[a-z][a-z-]{0,47}-artifact-gallery$/u.test(raw.source_surface)) return failure("artifact_view_invalid", 400);
  // Snapshot browser fields before the first await. Only verified identifiers are written below.
  const payload = { ...raw }, artifactId = String(payload.artifact_id), documentId = String(payload.document_id), projectId = String(payload.project_id);
  if(governed&&(projectId!==governed.projectId||documentId!==governed.documentId))return failure('artifact_view_source_unavailable');
  const workspace = fullHistory ?? await read();
  const history = observation ? workspace.filter(event => event.sequence < observation.sequence) : workspace;
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
  const body = captured?captured.body:await env.DB.prepare(`SELECT content,created_at,expires_at FROM private_content
    WHERE content_id=? AND owner_id=? AND kind='document-artifact' AND redacted_at IS NULL AND expires_at>${clock}
      AND length(CAST(content AS BLOB))<=1500000`).bind(contentId, owner)
    .first<{ content: string; created_at: string; expires_at: string }>();
  if (observation && (observation.payload.artifact_source_event_id !== completed.eventId
    || observation.payload.artifact_content_ref !== contentId || completed.sequence >= observation.sequence)) return failure("artifact_view_source_unavailable");
  if (!body || !parseDocumentArtifactContent(body.content)
    || ![body.created_at, body.expires_at].every(timestamp)
    || Date.parse(body.created_at) > Date.now() || Date.parse(body.expires_at) <= Date.now()
    || observation && body.created_at > observation.recordedAt) return failure("artifact_view_source_unavailable");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.content))), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== payload.content_sha256) return failure("artifact_view_source_unavailable");
  const dependencies = history.filter(event => document.sourceEvents.includes(event.eventId)
    || event.eventId === completed.eventId || event.type === "DocumentArtifactEdited" && event.payload.artifact_id === artifactId
    || event.type === "ProjectCreated" && event.payload.project_id === projectId);
  if (observation) dependencies.push(observation);
  if (!dependencies.length || dependencies.length > 256 || dependencies.some(event => event.compensatesEventId || event.eventId.startsWith("optimistic:")
    || event.clientId.includes("optimistic") || ![event.recordedAt, event.occurredAt].every(timestamp)
    || Date.parse(event.recordedAt) > Date.now() || Date.parse(event.occurredAt) > Date.now() || !native(event.payload)))
    return failure("artifact_view_source_unavailable");
  const dependencyIds = JSON.stringify(dependencies.map(event => event.eventId));
  const rows = captured?{success:true,results:captured.rows.filter(row=>dependencies.some(event=>event.eventId===row.event_id))}:await env.DB.prepare(`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.created_at AS private_created_at,secret.redacted_at
    FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))`).bind(stream, dependencyIds).all<Record<string, unknown>>();
  if (rows.success !== true || !Array.isArray(rows.results) || rows.results.length !== dependencies.length
    || new Set(rows.results.map(row => row.event_id)).size !== dependencies.length || rows.results.some(row => {
    const expected = dependencies.find(event => event.eventId === row.event_id);
    try { return !expected || row.owner_id !== owner || row.redacted_at !== null
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
    ${observation ? `AND ?>${clock}` : ''}
    AND NOT EXISTS(SELECT 1 FROM events negative WHERE negative.stream_id=? AND negative.compensates_event_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM event_private_payloads secret WHERE secret.private_event_id IN(SELECT value FROM json_each(?))
      AND secret.created_at!=(SELECT event.recorded_at FROM events event WHERE event.event_id=secret.private_event_id))`,
  bindings: [contentId, owner, body.content, body.created_at, body.expires_at, ...(observation ? [String(observation.payload.observed_source_expires_at)] : []), stream, dependencyIds, dependencyIds] };
  // A returned workspace page is not a completeness certificate. Independently pin
  // current native selections and revision count, including rows a partial page omitted.
  const selection = { sql: `(SELECT current.event_id FROM events current WHERE current.stream_id=? AND current.type='DocumentRenderCompleted'
      AND json_extract(current.payload,'$.artifact_id')=? ${observation ? 'AND current.sequence<?' : ''} ORDER BY current.sequence DESC LIMIT 1)=?
    AND (SELECT COUNT(*) FROM events edits WHERE edits.stream_id=? AND edits.type='DocumentArtifactEdited'
      AND json_extract(edits.payload,'$.artifact_id')=? ${observation ? 'AND edits.sequence<?' : ''})=?
    AND (SELECT declaration.event_id FROM events declaration WHERE declaration.stream_id=? AND declaration.type IN('DocumentCreated','DocumentForked')
      AND json_extract(declaration.payload,'$.document_id')=? ORDER BY declaration.sequence DESC LIMIT 1)=?
    AND (SELECT boundary.type FROM events boundary WHERE boundary.stream_id=?
      AND boundary.type IN('DocumentCreated','DocumentForked','DocumentRemoved','DocumentRestored')
      AND json_extract(boundary.payload,'$.document_id')=? ORDER BY boundary.sequence DESC LIMIT 1)!='DocumentRemoved'`,
  bindings: [stream, artifactId, ...(observation ? [observation.sequence] : []), completed.eventId, stream, artifactId, ...(observation ? [observation.sequence] : []), Number(payload.artifact_revision),
    stream, documentId, created.eventId, stream, documentId] };
  let sourceAuthority=captured&&!governed?combineAuthoringGuards(authority,captured.projectionGuard):authority;
  if(governed&&scope){
    const queries=[
      {sql:'SELECT * FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)) ORDER BY event_id',bindings:[dependencyIds]},
      {sql:`SELECT * FROM project_resource_scopes WHERE owner_user_id=? AND ((resource_kind='document' AND resource_id=?)
        OR (resource_kind='artifact' AND resource_id=?) OR (resource_kind='content' AND resource_id=?)) ORDER BY resource_kind,resource_id,project_access_id`,bindings:[owner,documentId,artifactId,contentId]},
    ];
    const results=captured?[{success:true,results:captured.eventScopes.filter(row=>dependencies.some(event=>event.eventId===row.event_id))},{success:true,results:captured.resources}]:await db.batch<Record<string,unknown>>(queries.map(query=>db.prepare(query.sql).bind(...query.bindings)));
    if(results.length!==2||results.some(result=>!result.success||!Array.isArray(result.results)))return failure('artifact_view_source_unavailable');
    const eventScopes=results[0]!.results,resources=results[1]!.results;
    if(eventScopes.length!==dependencies.length||resources.length!==3
      ||eventScopes.some(row=>row.organization_id!==scope.organizationId||row.project_access_id!==scope.projectAccessId||row.project_id!==projectId
        ||row.owner_user_id!==owner||row.source_stream_id!==stream||row.source_sequence!==dependencies.find(event=>event.eventId===row.event_id)?.sequence)
      ||resources.some(row=>row.organization_id!==scope.organizationId||row.project_access_id!==scope.projectAccessId||row.project_id!==projectId
        ||row.owner_user_id!==owner||row.visibility!=='collaborative_output'))return failure('artifact_view_source_unavailable');
    const eventProof=authoringSidecarProof('project_event_scopes',eventScopes.map(row=>AUTHORING_SIDECAR_COLUMNS.project_event_scopes.map(key=>row[key] as string|number|null))),
      resourceProof=authoringSidecarProof('project_resource_scopes',resources.map(row=>AUTHORING_SIDECAR_COLUMNS.project_resource_scopes.map(key=>row[key] as string|number|null)));
    const exact={sql:`(SELECT COUNT(*) FROM project_event_scopes WHERE event_id IN(SELECT value FROM json_each(?)))=?
      AND(SELECT COUNT(*) FROM project_resource_scopes WHERE owner_user_id=? AND ((resource_kind='document' AND resource_id=?)
        OR(resource_kind='artifact' AND resource_id=?) OR(resource_kind='content' AND resource_id=?)))=3`,bindings:[dependencyIds,dependencies.length,owner,documentId,artifactId,contentId]};
    sourceAuthority=combineAuthoringGuards(executionAdmissionGuard(actor,governed,null),pilot,eventProof,resourceProof,exact,...(captured?[captured.projectionGuard]:[]));
  }
  const source = combineAuthoringGuards(sourceAuthority, retained, selection, authoringEventRowsProof(sourceRows));
  if (env.DB !== db || JSON.stringify(actor) !== actorSnapshot||JSON.stringify(governed)!==bindingSnapshot) return failure("artifact_view_source_unavailable");
  return { source, bodyBytes: bytes(body.content), provenance: {
    contentRef: contentId, eventIds: dependencies.map(event=>event.eventId).sort(),
  }, payload: {
    artifact_id: artifactId, artifact_kind: artifact.kind, document_id: documentId, project_id: projectId,
    artifact_revision: payload.artifact_revision, content_sha256: hash, artifact_source_event_id: completed.eventId,
    artifact_content_ref: contentId, observed_source_expires_at: observation ? [body.expires_at, String(observation.payload.observed_source_expires_at)].sort()[0]! : body.expires_at,
    source_surface: payload.source_surface, capture_version: captureVersion,
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
    // D1 counts trigger writes as well; exact event/envelope/head assertions prove the logical receipt.
    || !Number.isSafeInteger(results[0]?.meta?.changes) || Number(results[0]!.meta.changes) < 1 || results[1]?.results?.length !== 1
    || (results[1].results[0] as Record<string, unknown>)?.artifact_view_committed !== 1) return failure("artifact_view_commit_unconfirmed");
  return Response.json({ appended: [event], rejected: [], head: event.sequence, noAutomaticRetry: true }, { headers: { "cache-control": "private, no-store" } });
}

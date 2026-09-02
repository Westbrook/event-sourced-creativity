import { foldEvents } from "../src/model/events.ts";
import { eventWriteBindings, type EventRow, type WorkerEnv } from "./runtime.ts";
import { projectDocumentPublicationEvents, projectPublicationResources, prepareProjectResourceScopeStatement } from "./project-access.ts";
import { OutputConflictError, outputAssertionStatements, outputScopeAuthority, type OutputOperationSlot, type OutputScope } from "./output-requirements-ledger.ts";

type NativeJob={job_id:string;owner_id:string;stream_id:string;document_id:string;correlation_id:string;kind:string};
export type OutputNativeProjectPublication={scope:OutputScope;slot:OutputOperationSlot;job:NativeJob};
const actors:Record<string,string>={
  DocumentRenderRequested:"user",GenerationRequested:"user",ContextCompiled:"worker:compiler",
  DocumentRenderCompleted:"worker:renderer",DocumentRenderFailed:"worker:renderer",GenerationCompleted:"worker:generator",GenerationFailed:"worker:generator",
  GenerationUsageRecorded:"worker:policy",BudgetReserved:"worker:policy",BudgetReleased:"worker:policy",BudgetExceeded:"worker:policy",
  ModelRegistered:"worker:registry",AdapterVersioned:"worker:registry",CapabilityDeclared:"worker:registry",
};
const documentEvents=new Set(["DocumentRenderRequested","GenerationRequested","ContextCompiled","DocumentRenderCompleted","GenerationCompleted"]);

/**
 * Worker-only publication sidecars, called after appendEvents assigns sequences.
 * The caller keeps its full live source/private/lease proof around the SAME batch.
 * The final statement's changes===1 proves that this batch advanced a current
 * manifest; changes===0 leaves the projection stale until an ordinary authorized
 * source refresh. Native publication must not reactivate a quarantined project.
 */
export function prepareOutputNativeProjectPublicationStatements(env:WorkerEnv,input:OutputNativeProjectPublication,events:EventRow[]):D1PreparedStatement[]{
  const {scope,slot,job}=input;
  if(scope.kind!=="project"||!events.length)return[];
  if(!scope.organizationId||!scope.projectAccessId||!scope.contextId||slot.scopeKey!==scope.key||slot.jobId!==job.job_id
    ||job.owner_id!==scope.actorUserId||job.stream_id!==`creative:${scope.ownerUserId}`||job.document_id!==scope.documentId
    ||!["generate","render_document"].includes(job.kind)||events.length>16)throw new OutputConflictError("output_job_scope_mismatch",403);
  const project={organizationId:scope.organizationId,projectAccessId:scope.projectAccessId,projectId:scope.projectId,ownerUserId:scope.ownerUserId};
  const first=events[0]!,last=events.at(-1)!;
  const eventIds=new Set<string>();
  for(const [offset,event] of events.entries()){
    const expectedActor=actors[event.type];
    const payload=event.payload;
    if(!expectedActor||event.actor!==(expectedActor==="user"?`user:${scope.actorUserId}`:expectedActor)
      ||event.streamId!==job.stream_id||event.correlationId!==job.correlation_id||event.clientId!==`server:document-job:${job.kind}`
      ||!Number.isSafeInteger(first.sequence)||first.sequence<1||event.sequence!==first.sequence+offset||eventIds.has(event.eventId)
      ||payload.project_id!=null&&payload.project_id!==scope.projectId||payload.document_id!=null&&payload.document_id!==scope.documentId
      ||documentEvents.has(event.type)&&payload.document_id!==scope.documentId
      ||payload.canvas_id||payload.context_set_id||payload.report_space)throw new OutputConflictError("output_native_route_unsupported",422);
    eventIds.add(event.eventId);
    if(event.type.startsWith("DocumentRender")&&(job.kind!=="render_document"||payload.artifact_kind!=="slides"))throw new OutputConflictError("output_native_route_unsupported",422);
    if(["GenerationRequested","ContextCompiled","GenerationCompleted"].includes(event.type)&&job.kind!=="generate")throw new OutputConflictError("output_native_route_unsupported",422);
    if(event.type==="GenerationCompleted"&&(!Array.isArray(payload.object_ids)||payload.object_ids.length!==1||typeof payload.object_ids[0]!=="string"||!payload.object_ids[0]
      ||payload.object_id!=null&&payload.object_id!==payload.object_ids[0]||typeof payload.media_url!=="string"||!payload.media_url.startsWith("/api/media/")
      ||payload.quality!=="high"||payload.purpose!=="final"))throw new OutputConflictError("output_native_route_unsupported",422);
    if(event.type==="DocumentRenderCompleted"&&(!payload.artifact_id||!payload.content_ref||!payload.input_ref||payload.content_ref===payload.input_ref
      ||payload.requested_by_user_id!==scope.actorUserId||payload.media_url||!Array.isArray(payload.items)||payload.items.some((item)=>item&&typeof item==="object"&&(item as Record<string,unknown>).media_url)))
      throw new OutputConflictError("output_native_route_unsupported",422);
  }
  const now=new Date().toISOString();
  const statements:D1PreparedStatement[]=[...outputAssertionStatements(env,outputScopeAuthority(scope,"request"))];
  statements.push(...outputAssertionStatements(env,{sql:`EXISTS(SELECT 1 FROM output_operation_slots slot
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN output_plan_targets target ON target.scope_key=slot.scope_key AND target.plan_revision_id=slot.plan_revision_id AND target.target_id=slot.target_id
    JOIN document_jobs job ON job.job_id=slot.job_id
    JOIN project_resource_scopes custody ON custody.resource_kind='job' AND custody.resource_id=job.job_id
      AND custody.project_access_id=plan.project_access_id AND custody.organization_id=plan.organization_id AND custody.project_id=plan.project_id
      AND custody.owner_user_id=plan.owner_user_id AND custody.actor_user_id=grant_row.actor_user_id AND custody.visibility='actor_private'
    JOIN events anchor ON anchor.event_id=custody.source_event_id AND anchor.stream_id=job.stream_id
      AND anchor.actor='user:'||job.owner_id AND anchor.type='ProjectDocumentJobQueued'
    JOIN event_private_payloads body ON body.private_event_id=anchor.event_id AND body.owner_id=plan.owner_user_id AND body.redacted_at IS NULL
    WHERE slot.scope_key=? AND slot.slot_id=? AND slot.job_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_id=?
      AND slot.source_digest=? AND slot.target_contract_digest=? AND slot.status IN('queued','running')
      AND grant_row.actor_user_id=? AND grant_row.context_id=? AND grant_row.status IN('authorized','active')
      AND grant_row.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND target.selected=1 AND target.target_contract_digest=slot.target_contract_digest AND target.media_kind=?
      AND plan.scope_kind='project' AND plan.owner_user_id=? AND plan.organization_id=? AND plan.project_access_id=? AND plan.project_id=? AND plan.document_id=?
      AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=? AND job.kind=? AND job.status IN('running','committing')
      AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.job_id')=job.job_id AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.document_id')=plan.document_id
      AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.organization_id')=plan.organization_id AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.project_access_id')=plan.project_access_id
      AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.project_id')=plan.project_id AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.actor_user_id')=job.owner_id
      AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.output_slot_id')=slot.slot_id AND json_extract(CASE WHEN json_valid(body.private_json) THEN body.private_json ELSE '{}' END,'$.output_grant_id')=slot.grant_id
      AND EXISTS(SELECT 1 FROM project_resource_scopes document WHERE document.project_access_id=plan.project_access_id AND document.organization_id=plan.organization_id
        AND document.project_id=plan.project_id AND document.owner_user_id=plan.owner_user_id AND document.resource_kind='document' AND document.resource_id=plan.document_id))`,
    bindings:[scope.key,slot.slotId,job.job_id,slot.grantId,slot.planRevisionId,slot.targetId,slot.sourceDigest,slot.targetContractDigest,
      scope.actorUserId,scope.contextId,now,job.kind==="generate"?"image":"slides",scope.ownerUserId,scope.organizationId,scope.projectAccessId,scope.projectId,scope.documentId,
      job.owner_id,job.stream_id,job.document_id,job.correlation_id,job.kind]}));
  // A lost head race may append nothing, allowing appendEvents to retry. A
  // partially appended batch must roll back; it can never strand event bodies.
  const ids=JSON.stringify([...eventIds]);
  statements.push(...outputAssertionStatements(env,{sql:`(SELECT COUNT(*) FROM events WHERE event_id IN(SELECT value FROM json_each(?)))=?
    OR (NOT EXISTS(SELECT 1 FROM events WHERE event_id IN(SELECT value FROM json_each(?)))
      AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)<>?)`,bindings:[ids,events.length,ids,job.stream_id,first.sequence-1]}));
  // Check each actual staged event and its exact public/private envelope before
  // exposing scope. Known public-only events cannot invent a private receipt.
  for(const event of events){
    const bindings=eventWriteBindings(event);
    const hasPrivate=bindings[16]!==null;
    statements.push(...outputAssertionStatements(env,{sql:`NOT EXISTS(SELECT 1 FROM events WHERE event_id=?) OR EXISTS(SELECT 1 FROM events event
      ${hasPrivate?"JOIN event_private_payloads body ON body.private_event_id=event.event_id":""}
      WHERE event.event_id=? AND event.stream_id=? AND event.sequence=? AND event.type=? AND event.actor=? AND event.client_id=? AND event.correlation_id=? AND event.payload=?
        ${hasPrivate?"AND body.owner_id=? AND body.redacted_at IS NULL AND body.private_json IS ?":"AND NOT EXISTS(SELECT 1 FROM event_private_payloads body WHERE body.private_event_id=event.event_id)"})`,
      bindings:[event.eventId,event.eventId,event.streamId,event.sequence,event.type,event.actor,event.clientId,event.correlationId,bindings[12]!,...(hasPrivate?[scope.ownerUserId,bindings[16]!]:[])]}));
  }
  for(const event of projectDocumentPublicationEvents(events,scope.projectId,scope.documentId))statements.push(env.DB.prepare(`INSERT INTO project_event_scopes(
    event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at)
    SELECT ?,?,?,?,?,?,?,(SELECT COALESCE(MAX(project_sequence),0)+1 FROM project_event_scopes WHERE project_access_id=?),?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
    .bind(event.eventId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,event.streamId,event.sequence,scope.projectAccessId,scope.actorUserId,now,event.eventId));
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,scope.documentId,scope.projectId);
  const resources=projectPublicationResources(projection.libraryOutputs.filter(output=>output.documentId===scope.documentId),projection.libraryArtifacts.filter(artifact=>artifact.documentId===scope.documentId),()=>scope.actorUserId);
  for(const resource of resources){
    if(resource.kind==="media")statements.push(...outputAssertionStatements(env,{sql:`NOT EXISTS(SELECT 1 FROM events WHERE event_id=?) OR EXISTS(SELECT 1 FROM output_native_storage_writes stored
      WHERE stored.scope_key=? AND stored.slot_id=? AND stored.storage_key=? AND stored.status='written' AND stored.write_acknowledged=1
        AND (stored.publication_event_id IS NULL OR stored.publication_event_id=?))`,bindings:[resource.sourceEventId,scope.key,slot.slotId,resource.id,resource.sourceEventId]}));
    if(resource.kind==="content"){
      const collaborative=resource.visibility==="collaborative_output";
      const artifactId=events.find(event=>event.eventId===resource.sourceEventId)?.payload.artifact_id;
      statements.push(...outputAssertionStatements(env,{sql:`NOT EXISTS(SELECT 1 FROM events WHERE event_id=?) OR EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=? AND content.kind=?
        AND content.redacted_at IS NULL AND content.expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        ${collaborative?"":`AND json_extract(CASE WHEN json_valid(content.content) THEN content.content ELSE '{}' END,'$.document_id')=? AND json_extract(CASE WHEN json_valid(content.content) THEN content.content ELSE '{}' END,'$.project_id')=? AND json_extract(CASE WHEN json_valid(content.content) THEN content.content ELSE '{}' END,'$.artifact_id')=?
          AND EXISTS(SELECT 1 FROM project_resource_scopes private WHERE private.resource_kind='content' AND private.resource_id=content.content_id
            AND private.project_access_id=? AND private.organization_id=? AND private.project_id=? AND private.owner_user_id=? AND private.actor_user_id=? AND private.visibility='actor_private')`})`,
        bindings:[resource.sourceEventId,resource.id,collaborative?scope.ownerUserId:scope.actorUserId,collaborative?"document-artifact":"document-artifact-input",now,
          ...(collaborative?[]:[scope.documentId,scope.projectId,String(artifactId??""),scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,scope.actorUserId])]}));
      // Inputs remain private. Fill only a missing anchor; never change visibility.
      if(!collaborative)statements.push(env.DB.prepare(`UPDATE project_resource_scopes SET source_event_id=? WHERE project_access_id=? AND organization_id=? AND project_id=?
        AND owner_user_id=? AND actor_user_id=? AND resource_kind='content' AND resource_id=? AND visibility='actor_private' AND source_event_id IS NULL
        AND EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
        .bind(resource.sourceEventId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,scope.actorUserId,resource.id,resource.sourceEventId));
    }
    statements.push(prepareProjectResourceScopeStatement(env,project,resource,now,true));
    statements.push(...outputAssertionStatements(env,{sql:`NOT EXISTS(SELECT 1 FROM events WHERE event_id=?) OR EXISTS(SELECT 1 FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND project_id=?
      AND owner_user_id=? AND resource_kind=? AND resource_id=? AND actor_user_id=? AND visibility=? AND source_event_id=?)`,
      bindings:[resource.sourceEventId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,resource.kind,resource.id,scope.actorUserId,resource.visibility,resource.sourceEventId]}));
  }
  // Never skip an unprocessed sibling completion or any other owner-stream gap.
  // A zero-row update is safe publication, but explicitly NOT a fresh manifest.
  statements.push(env.DB.prepare(`UPDATE project_migration_states SET last_owner_sequence=?,updated_at=?
    WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?
      AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND EXISTS(SELECT 1 FROM events WHERE event_id=?)
      AND EXISTS(SELECT 1 FROM project_resource_scopes marker WHERE marker.project_access_id=project_migration_states.project_access_id
        AND marker.organization_id=project_migration_states.organization_id AND marker.owner_user_id=project_migration_states.owner_user_id
        AND marker.project_id=? AND marker.resource_kind='manifest_version' AND marker.resource_id='canvas-v1')`)
    .bind(last.sequence,now,scope.projectAccessId,scope.organizationId,scope.ownerUserId,first.sequence-1,job.stream_id,last.sequence,last.eventId,scope.projectId));
  return statements;
}

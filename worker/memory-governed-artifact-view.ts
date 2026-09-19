import { prepareGovernedArtifactViewSource } from './memory-artifact-view.ts';
import { authoringEventProof, authoringSidecarProof } from './authoring-event-proof.ts';
import type { ConsequentialBinding } from './consequential-consent.ts';
import type { PilotUser } from './pilot-policy.ts';
import type { ProjectRequestContext } from './project-request-context.ts';
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, uuidV7, type WorkerEnv } from './runtime.ts';

const failure=(error:string,status=409)=>Response.json({error,noAutomaticRetry:true},{status,headers:{'cache-control':'private, no-store'}});
/** Isolated read-authorized observation. No authoring, paid execution, scope
 * repair, rebase or retry is delegated to the generic project mutation writer. */
export async function appendGovernedArtifactView(request:Request,env:WorkerEnv,actor:PilotUser,context:ProjectRequestContext,
  body:{action?:string;event?:{type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null};events?:{type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null}[];clientId?:string;correlationId?:string}){
  const events=body.events??(body.event?[body.event]:[]),input=events[0],payload=input?.payload;
  if(!['append','hot','batch'].includes(body.action??'')||events.length!==1||input?.type!=='DocumentArtifactViewed'||input.compensatesEventId
    ||!payload||payload.project_id!==context.projectId||typeof payload.document_id!=='string'
    ||context.principalUserId!==actor.userId||/(?:^|;\s*)forma_impersonation=/.test(request.headers.get('cookie')??''))return failure('artifact_view_isolated_governed_append_required');
  const db=env.DB,contextSnapshot=JSON.stringify(context),actorSnapshot=JSON.stringify(actor),stream='creative:'+context.ownerUserId;
  const binding:ConsequentialBinding={version:'governed-artifact-view-v1',operation:'artifact-observation',actorUserId:actor.userId,
    permissionEpoch:actor.access.permissionEpoch,streamId:stream,projectId:context.projectId,documentId:payload.document_id,blockId:'',canvasId:null,
    scope:{organizationId:context.organizationId,projectAccessId:context.projectAccessId,projectId:context.projectId,ownerUserId:context.ownerUserId,actorUserId:actor.userId},
    contextSessionId:context.contextId,intentHash:'',sourceHash:'',period:'',pilotCohortId:null,steps:[],publicQuery:'',request:{}};
  let certified:Awaited<ReturnType<typeof prepareGovernedArtifactViewSource>>;
  try{certified=await prepareGovernedArtifactViewSource(env,actor,binding,payload);}catch{return failure('artifact_view_source_unavailable');}
  if(certified instanceof Response)return certified;
  const heads=await db.prepare(`SELECT last_owner_sequence AS owner_head,
    (SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?) AS project_head
    FROM project_migration_states WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active'
      AND last_owner_sequence=(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)`)
    .bind(context.projectAccessId,context.organizationId,context.projectAccessId,context.organizationId,context.ownerUserId,stream).first<{owner_head:number;project_head:number}>();
  if(!heads||!Number.isSafeInteger(heads.owner_head)||!Number.isSafeInteger(heads.project_head)||env.DB!==db
    ||JSON.stringify(context)!==contextSnapshot||JSON.stringify(actor)!==actorSnapshot)return failure('artifact_view_source_unavailable');
  const {source}=certified,event=makeEvent(stream,heads.owner_head+1,'user:'+actor.userId,body.clientId||'web:artifact-view',body.correlationId||uuidV7(),'DocumentArtifactViewed',certified.payload),now=event.recordedAt;
  const custody=[event.eventId,context.projectAccessId,context.organizationId,context.projectId,context.ownerUserId,stream,event.sequence,heads.project_head+1,actor.userId,now];
  const exact=authoringEventProof([event]),sidecar=authoringSidecarProof('project_event_scopes',[custody]);
  const statements=[
    db.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${Array(17).fill('?').join(',')}
      WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND (${source.sql})`)
      .bind(...eventWriteBindings(event),stream,heads.owner_head,...source.bindings),
    db.prepare(`INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)
        AND(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?`)
      .bind(...custody,event.eventId,context.projectAccessId,context.organizationId,heads.project_head),
    db.prepare(`UPDATE project_migration_states SET last_owner_sequence=?,updated_at=? WHERE project_access_id=? AND organization_id=?
      AND owner_user_id=? AND status='active' AND last_owner_sequence=? AND EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
      .bind(event.sequence,now,context.projectAccessId,context.organizationId,context.ownerUserId,heads.owner_head,event.eventId),
    db.prepare(`SELECT CASE WHEN (${source.sql}) AND (${exact.sql}) AND (${sidecar.sql})
      AND(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?
      AND EXISTS(SELECT 1 FROM project_migration_states WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?)
      AND EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND created_at=?)
      THEN 1 ELSE json('artifact_view_commit_changed') END AS artifact_view_committed`)
      .bind(...source.bindings,...exact.bindings,...sidecar.bindings,stream,event.sequence,context.projectAccessId,context.organizationId,heads.project_head+1,
        context.projectAccessId,context.organizationId,context.ownerUserId,event.sequence,event.eventId,now),
  ];
  try{
    const result=await db.batch<Record<string,unknown>>(statements);
    // D1 includes trigger writes in changes; exact native rows and heads above are the atomic commit proof.
    if(!Array.isArray(result)||result.length!==4||result.some(row=>row?.success!==true||'error' in row&&row.error!==undefined)
      ||!Number.isSafeInteger(result[0]?.meta?.changes)||Number(result[0]!.meta.changes)<1||result[1]?.meta?.changes!==1
      ||result[2]?.meta?.changes!==1||result[3]?.results?.length!==1||result[3]?.results[0]?.artifact_view_committed!==1)return failure('artifact_view_commit_unconfirmed');
  }catch{return failure('artifact_view_commit_unconfirmed');}
  return Response.json({appended:[{...event,streamId:'project:'+context.projectAccessId,sequence:heads.project_head+1}],rejected:[],head:heads.project_head+1,noAutomaticRetry:true},
    {headers:{'cache-control':'private, no-store'}});
}

import { AssistantContextReadWitness } from './assistant-context-source.ts';
import { authoringEventProof, authoringSidecarProof } from './authoring-event-proof.ts';
import { executionAdmissionGuard, type ConsequentialBinding } from './consequential-consent.ts';
import { configuredPilotAdmissionGuard } from './intake-authority.ts';
import { DOCUMENT_VIEWS } from '../src/model/document-view-signals.ts';
import type { DocumentView } from '../src/model/routes.ts';
import { observeNativeMemoryDocumentScope } from './memory-native-scope.ts';
import { derivationId, derivationInteger } from './memory-derivation-policy.ts';
import { hasCapability, type PilotUser } from './pilot-policy.ts';
import { projectSourceProjectionCurrentAssertion } from './project-source-read.ts';
import type { ProjectRequestContext } from './project-request-context.ts';
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, uuidV7, type WorkerEnv } from './runtime.ts';

const keys=['document_id','project_id','view','focused','route_family','source_surface'].sort();
const failure=(error:string,status=409)=>Response.json({error,noAutomaticRetry:true},{status,headers:{'cache-control':'private, no-store'}});
type Input={type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null};
type Body={action?:string;event?:Input;events?:Input[];clientId?:string;correlationId?:string};

/** A governed document-view encounter, not evidence of attention or preference.
 * Preserve the native document/access proof and atomic event/custody publication.
 * A visit never authorizes editing, enrollment, a provider call or a retry. */
export async function appendNativeDocumentView(request:Request,env:WorkerEnv,actor:PilotUser,body:Body,context?:ProjectRequestContext){
  const url=new URL(request.url);
  if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return failure('same_origin_required',403);
  const events=body.events??(body.event?[body.event]:[]),input=events[0],raw=input?.payload;
  if(body.clientId!==undefined&&!derivationId(body.clientId)||body.correlationId!==undefined&&!derivationId(body.correlationId)
    ||!['append','hot','batch'].includes(body.action??'')||events.length!==1||input?.type!=='DocumentViewVisited'||input.compensatesEventId
    ||!raw||Object.keys(raw).sort().join(',')!==keys.join(',')||![raw.project_id,raw.document_id].every(derivationId)
    ||raw.source_surface!=='document-view-navigation'||raw.route_family!=='document'||typeof raw.focused!=='boolean'
    ||!DOCUMENT_VIEWS.includes(raw.view as DocumentView)
    ||/(?:^|;\s*)forma_impersonation=/.test(request.headers.get('cookie')??''))return failure('document_view_invalid',400);
  const payload=structuredClone(raw),db=env.DB,identity=JSON.stringify([actor,context]),scope=context?{
    organizationId:context.organizationId,projectAccessId:context.projectAccessId,projectId:context.projectId,ownerUserId:context.ownerUserId,actorUserId:actor.userId}:undefined;
  if(actor.fictional||!actor.authorizationSnapshot||context&&(context.principalUserId!==actor.userId||context.projectId!==payload.project_id)
    ||!context&&(actor.projectExecution||actor.streamId!=='creative:'+actor.userId)
    ||!(scope?hasCapability(actor,'project.read',scope):actor.access.capabilities.includes('project.read')))return failure('document_view_scope_unavailable',403);
  const owner=scope?.ownerUserId??actor.userId,stream='creative:'+owner;
  const binding:ConsequentialBinding={version:'native-document-view-v1',operation:'page-observation',actorUserId:actor.userId,
    permissionEpoch:actor.access.permissionEpoch,streamId:stream,projectId:String(payload.project_id),documentId:String(payload.document_id),blockId:'',canvasId:null,
    scope:scope??null,contextSessionId:context?.contextId??null,intentHash:'',sourceHash:'',period:'',pilotCohortId:null,steps:[],publicQuery:'',request:{}};
  const expected={actor_user_id:actor.userId,owner_user_id:owner,organization_id:scope?.organizationId??null,project_access_id:scope?.projectAccessId??null,
    project_id:binding.projectId,document_id:binding.documentId,permission_epoch:actor.access.permissionEpoch};
  const witness=new AssistantContextReadWitness<Record<string,unknown>>(env),until=new Date(Date.now()+60_000).toISOString();
  witness.require(executionAdmissionGuard(actor,binding,null));witness.require(configuredPilotAdmissionGuard(env,actor));
  if(scope)witness.require(projectSourceProjectionCurrentAssertion(scope));
  const started=Date.now(),monotonic=performance.now();
  const current=()=>env.DB===db&&JSON.stringify([actor,context])===identity&&Date.now()>=started&&performance.now()>=monotonic&&performance.now()-monotonic<60000&&new Date().toISOString()<until;
  try{
    const heads=await db.prepare(`SELECT (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS owner_head,
      (SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id IS ? AND organization_id IS ?) AS project_head`)
      .bind(stream,scope?.projectAccessId??null,scope?.organizationId??null).first<{owner_head:number;project_head:number}>();
    if(!heads||!derivationInteger(heads.owner_head,1)||!derivationInteger(heads.project_head)||!current())return failure('document_view_source_unavailable');
    if(!await observeNativeMemoryDocumentScope(env,{principal:actor,binding},expected,witness))return failure('document_view_source_unavailable');
    const event=makeEvent(stream,heads.owner_head+1,'user:'+actor.userId,body.clientId||'web:document-view',body.correlationId||uuidV7(),'DocumentViewVisited',
      payload);
    witness.before(until);witness.seal(event.payload);const proof=witness.precommitStatements(),exact=authoringEventProof([event]);
    const custody=scope?[event.eventId,scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,stream,event.sequence,heads.project_head+1,actor.userId,event.recordedAt]:null;
    const sidecar=custody?authoringSidecarProof('project_event_scopes',[custody]):null;
    const statements=[...proof,db.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${Array(17).fill('?').join(',')}
      WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?`).bind(...eventWriteBindings(event),stream,heads.owner_head)];
    if(scope&&custody)statements.push(
      db.prepare(`INSERT INTO project_event_scopes(event_id,project_access_id,organization_id,project_id,owner_user_id,source_stream_id,source_sequence,project_sequence,actor_user_id,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM events WHERE event_id=?)
        AND(SELECT COALESCE(MAX(project_sequence),0) FROM project_event_scopes WHERE project_access_id=? AND organization_id=?)=?`)
        .bind(...custody,event.eventId,scope.projectAccessId,scope.organizationId,heads.project_head),
      db.prepare(`UPDATE project_migration_states SET last_owner_sequence=?,updated_at=? WHERE project_access_id=? AND organization_id=? AND owner_user_id=?
        AND status='active' AND last_owner_sequence=? AND EXISTS(SELECT 1 FROM events WHERE event_id=?)`)
        .bind(event.sequence,event.recordedAt,scope.projectAccessId,scope.organizationId,scope.ownerUserId,heads.owner_head,event.eventId));
    statements.push(...proof,db.prepare(`SELECT CASE WHEN (${exact.sql})
      AND(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?
      AND EXISTS(SELECT 1 FROM event_private_payloads WHERE private_event_id=? AND created_at=?)
      AND ${sidecar?'('+sidecar.sql+')':'NOT EXISTS(SELECT 1 FROM project_event_scopes WHERE event_id=?)'}
      THEN 1 ELSE json('document_view_commit_changed') END AS document_view_committed`)
      .bind(...exact.bindings,stream,event.sequence,event.eventId,event.recordedAt,...(sidecar?sidecar.bindings:[event.eventId])));
    if(!current())return failure('document_view_source_unavailable');
    const result=await db.batch<Record<string,unknown>>(statements),write=proof.length;
    if(!current()||result.length!==statements.length||result.some(row=>row?.success!==true||'error' in row&&row.error!==undefined)
      ||!Number.isSafeInteger(result[write]?.meta.changes)||Number(result[write]?.meta.changes)<1
      ||scope&&(result[write+1]?.meta.changes!==1||result[write+2]?.meta.changes!==1)
      ||result.at(-1)?.results?.length!==1||result.at(-1)?.results?.[0]?.document_view_committed!==1
      ||result.some((row,index)=>index<write||index>=write+(scope?3:1)&&index<result.length-1
        ?row.results.length!==1||row.results[0]?.context_source_asserted!==1:false))return failure('document_view_commit_unconfirmed');
    return Response.json({appended:[scope?{...event,streamId:'project:'+scope.projectAccessId,sequence:heads.project_head+1}:event],rejected:[],head:scope?heads.project_head+1:event.sequence,noAutomaticRetry:true},
      {headers:{'cache-control':'private, no-store'}});
  }catch{return failure('document_view_commit_unconfirmed');}
}

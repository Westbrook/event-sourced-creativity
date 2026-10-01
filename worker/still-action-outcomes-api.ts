import { ACTIONS } from '../src/still/decisions.ts';
import { cleanActionObservation, cleanActionScope, validActionIdentifier, type ActionObservation, type ActionScope, type StillGoal } from '../src/still/action-outcomes.ts';
import { requireConsent, requireUser, type PilotUser } from './pilot-policy.ts';
import { readProjectRequestContext, type ProjectRequestContext } from './project-request-context.ts';
import { readStillHistory } from './still-history.ts';
import { actionPreference, actionRetentionUntil, actionScopeKey, createStillDecisionReceipt, invalidateStillActionDecisionCache, readStillActionContext } from './still-action-outcomes.ts';
import type { WorkerEnv } from './runtime.ts';
import type { CreativeProjection } from '../src/model/events.ts';

const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id'}});
type Access={user:PilotUser;shared?:ProjectRequestContext;projection:CreativeProjection};
export async function authorizeStillActionScope(request:Request,env:WorkerEnv,scope:ActionScope):Promise<Access|Response> {
  const auth=await requireUser(request,env);if(auth.response||!auth.user)return auth.response!;
  const consent=requireConsent(auth.user);if(consent)return consent;
  const resolved=await readProjectRequestContext(request,env,auth.user);if(resolved.response)return resolved.response;
  const shared=resolved.context??undefined;if(shared&&scope.projectId!==shared.projectId)return reply({error:'selection_unavailable'},409);
  const history=await readStillHistory(request,env,auth.user,JSON.stringify(['still-action-scope',auth.user.userId,shared?.contextId??'']),shared,scope);
  const projection=history.projection(scope.documentId??'',scope.projectId??'');
  if(scope.projectId&&!projection.projects.some(row=>row.id===scope.projectId)||scope.documentId&&!projection.documents.some(row=>row.id===scope.documentId&&!row.removed&&row.projectId===scope.projectId)||scope.blockId&&!projection.blocks.some(row=>row.id===scope.blockId&&!row.removed&&row.documentId===scope.documentId))return reply({error:'selection_unavailable'},409);
  return {user:auth.user,shared,projection};
}
const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
function purgeScope(env:WorkerEnv,owner:string,key:string,goals:boolean) {
  const statements=['still_action_observations','still_action_receipts','still_action_preferences'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE owner_id=? AND scope_key=?`).bind(owner,key));
  if(goals)statements.push(...clearGoals(env,owner,key));
  return statements;
}
function clearGoals(env:WorkerEnv,owner:string,key:string,id?:string) {
  const now=new Date().toISOString(),where=`owner_id=? AND scope_key=?${id?' AND goal_id=?':''}`,bindings=[owner,key,...(id?[id]:[])];
  return [env.DB.prepare(`UPDATE private_content SET content='',redacted_at=? WHERE owner_id=? AND kind='still-goal' AND content_id IN(SELECT content_id FROM still_action_goals WHERE ${where})`).bind(now,owner,...bindings),env.DB.prepare(`DELETE FROM still_action_goals WHERE ${where}`).bind(...bindings)];
}
export const handleStillActionOutcomes=createStillActionOutcomesHandler(authorizeStillActionScope);
export function createStillActionOutcomesHandler(authorize:typeof authorizeStillActionScope) { return async (request:Request,env:WorkerEnv):Promise<Response> => {
  const url=new URL(request.url),origin=request.headers.get('origin');if(origin&&origin!==url.origin)return reply({error:'same_origin_required'},403);
  let body:Record<string,unknown>={};
  if(request.method!=='GET'){
    const raw=await request.text();if(raw.length>16_000)return reply({error:'request_too_large'},413);
    try{const value=record(JSON.parse(raw));if(!value)return reply({error:'invalid_request'},400);body=value;}catch{return reply({error:'invalid_request'},400);}
  }
  const scope=cleanActionScope(request.method==='GET'?Object.fromEntries(['projectId','documentId','blockId'].map(key=>[key,url.searchParams.get(key)??''])):body.scope);
  if(!scope)return reply({error:'invalid_scope'},400);
  let access:Access|Response;try{access=await authorize(request,env,scope);}catch(error){return error instanceof Response?error:reply({error:'state_unavailable'},503);}
  if(access instanceof Response)return access;
  const {user,shared}=access,owner=user.userId,key=actionScopeKey(scope,shared),now=new Date().toISOString();
  const contextResponse=async()=>{
    const context=await readStillActionContext(env,user,scope,shared);
    if(context.enabled){const receipt=await createStillDecisionReceipt(env,user,{position:scope,scope:shared,stateFingerprint:'0'.repeat(64),policy:'still-direct-context-v1',head:0,response:{source:'context',candidateIds:ACTIONS.map(action=>action.id)}});if(receipt){context.directDecisionId=receipt.decisionId;context.directContextExpiresAt=receipt.contextWindowExpiresAt;}}
    return context;
  };
  try {
    if(url.pathname==='/api/still/action-context') {
      if(request.method==='GET')return reply(await contextResponse());
      if(request.method==='DELETE'){await env.DB.batch(purgeScope(env,owner,key,true));await invalidateStillActionDecisionCache(env,owner);return reply(await contextResponse());}
      if(request.method!=='PUT'||typeof body.enabled!=='boolean')return reply({error:'invalid_request'},400);
      if(!body.enabled)await env.DB.batch(purgeScope(env,owner,key,false));
      else {
        const preference=await actionPreference(env,owner,key);
        if(!preference)await env.DB.batch([...purgeScope(env,owner,key,false),env.DB.prepare('INSERT INTO still_action_preferences(owner_id,scope_key,epoch,created_at,expires_at) VALUES(?,?,?,?,?)').bind(owner,key,crypto.randomUUID(),now,await actionRetentionUntil(env,shared))]);
      }
      await invalidateStillActionDecisionCache(env,owner);
      return reply(await contextResponse());
    }
    if(url.pathname==='/api/still/goal') {
      if(request.method==='DELETE') {
        if(body.id!==undefined&&!validActionIdentifier(body.id))return reply({error:'invalid_goal'},400);
        await env.DB.batch(clearGoals(env,owner,key,body.id as string|undefined));await invalidateStillActionDecisionCache(env,owner);return reply(await contextResponse());
      }
      if(request.method==='POST') {
        if(!validActionIdentifier(body.id)||!['completed','abandoned'].includes(String(body.status)))return reply({error:'invalid_goal'},400);
        const result=await env.DB.prepare("UPDATE still_action_goals SET status=? WHERE goal_id=? AND owner_id=? AND scope_key=? AND status='active' AND expires_at>?").bind(body.status,body.id,owner,key,now).run();
        if(!result.meta.changes)return reply({error:'goal_unavailable'},409);
        await invalidateStillActionDecisionCache(env,owner);
        return reply(await contextResponse());
      }
      if(request.method!=='PUT'||body.remember!==true||typeof body.text!=='string'||!body.text.trim()||body.text.length>2000||!Array.isArray(body.criteria)||body.criteria.length>5||body.criteria.some(value=>typeof value!=='string'||value.length>240))return reply({error:'invalid_goal'},400);
      const id=crypto.randomUUID(),contentId='still-goal-'+crypto.randomUUID(),expiresAt=await actionRetentionUntil(env,shared),text=body.text.trim(),criteria=(body.criteria as string[]).map(value=>value.trim()).filter(Boolean);
      await env.DB.batch([
        ...clearGoals(env,owner,key),
        env.DB.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,'still-goal',?,?,?,NULL)").bind(contentId,owner,JSON.stringify({text,criteria}),now,expiresAt),
        env.DB.prepare("INSERT INTO still_action_goals(goal_id,owner_id,scope_key,content_id,status,created_at,expires_at) VALUES(?,?,?,?,'active',?,?)").bind(id,owner,key,contentId,now,expiresAt),
      ]);
      await invalidateStillActionDecisionCache(env,owner);
      const goal:StillGoal={id,scope,text,criteria,status:'active',createdAt:now,expiresAt};return reply({...(await contextResponse()),goal});
    }
    if(url.pathname!=='/api/still/action-observations'||request.method!=='POST')return reply({error:'method_not_allowed'},405);
    const input=cleanActionObservation(body,ACTIONS.map(action=>action.id));if(!input)return reply({error:'invalid_observation'},400);
    const preference=await actionPreference(env,owner,key);if(!preference)return reply({error:'observation_consent_required'},409);
    const existing=await env.DB.prepare('SELECT body FROM still_action_observations WHERE owner_id=? AND observation_id=? AND scope_key=? AND consent_epoch=? AND expires_at>?').bind(owner,input.id,key,preference.epoch,now).first<{body:string}>();
    if(existing){const observation=JSON.parse(existing.body) as ActionObservation;const previous=cleanActionObservation(observation,ACTIONS.map(action=>action.id),Date.parse(observation.recordedAt));
      if(JSON.stringify(previous)!==JSON.stringify(input))return reply({error:'observation_identity_conflict'},409);
      return reply({observation,replayed:true});}
    const count=await env.DB.prepare('SELECT count(*) AS count FROM still_action_observations WHERE owner_id=? AND scope_key=? AND expires_at>?').bind(owner,key,now).first<{count:number}>();
    if((count?.count??0)>=5000)return reply({error:'observation_capacity'},429);
    let decisionCreatedAt:string|undefined;
    if(input.decisionId) {
      const decision=await env.DB.prepare('SELECT body FROM still_action_receipts WHERE decision_id=? AND owner_id=? AND scope_key=? AND consent_epoch=? AND expires_at>?').bind(input.decisionId,owner,key,preference.epoch,now).first<{body:string}>();
      if(!decision)return reply({error:'decision_unavailable'},409);
      const receipt=JSON.parse(decision.body) as {candidateIds:string[];createdAt:string;kind?:string;contextWindowExpiresAt?:string};decisionCreatedAt=receipt.createdAt;
      if(receipt.kind==='context'&&['selection','invocation'].includes(input.kind)&&(!receipt.contextWindowExpiresAt||receipt.contextWindowExpiresAt<=now))return reply({error:'context_window_expired'},409);
      if(receipt.kind==='context'&&input.source!=='direct')return reply({error:'context_receipt_is_not_a_suggestion'},409);
      if([...(input.displayedActionIds??[]),...(input.actionId?[input.actionId]:[])].some(id=>!receipt.candidateIds.includes(id)))return reply({error:'action_not_in_decision'},409);
    } else return reply({error:'decision_required'},400);
    let parent:ActionObservation|undefined;
    if(input.parentId){
      const row=await env.DB.prepare('SELECT body FROM still_action_observations WHERE observation_id=? AND owner_id=? AND scope_key=? AND consent_epoch=? AND expires_at>?').bind(input.parentId,owner,key,preference.epoch,now).first<{body:string}>();
      if(!row)return reply({error:'parent_unavailable'},409);parent=JSON.parse(row.body) as ActionObservation;
      if(parent.decisionId!==input.decisionId||parent.actionId&&parent.actionId!==input.actionId||parent.source!==input.source)return reply({error:'parent_mismatch'},409);
    }
    if(input.kind==='selection'&&input.source!=='direct'&&(parent?.kind!=='exposure'||!parent.displayedActionIds?.includes(input.actionId!)))return reply({error:'exposure_required'},409);
    if(input.kind==='invocation'&&input.source!=='direct'&&parent?.kind!=='selection')return reply({error:'selection_required'},409);
    if(['commit','cancellation','failure'].includes(input.kind)&&parent?.kind!=='invocation')return reply({error:'invocation_required'},409);
    const expiresAt=[preference.expires_at,input.feedbackExpiresAt??preference.expires_at,await actionRetentionUntil(env,shared)].sort()[0];
    const observation:ActionObservation={...input,recordedAt:now,expiresAt};
    if(input.kind==='commit') {
      const evidence=await verifyCommitEvidence(env,access,scope,input.eventIds??[],input.jobId,decisionCreatedAt!);
      if(!evidence)return reply({error:'commit_evidence_unavailable'},409);observation.evidence=evidence;
    }
    const result=await env.DB.prepare(`INSERT INTO still_action_observations(observation_id,owner_id,scope_key,consent_epoch,decision_id,parent_id,kind,created_at,expires_at,body)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM still_action_preferences WHERE owner_id=? AND scope_key=? AND epoch=? AND expires_at>?)`).bind(input.id,owner,key,preference.epoch,input.decisionId??null,input.parentId??null,input.kind,now,expiresAt,JSON.stringify(observation),owner,key,preference.epoch,now).run();
    return result.meta.changes?reply({observation},201):reply({error:'observation_consent_required'},409);
  } catch { return reply({error:'action_context_unavailable'},503); }
}; }

/** Only the actor's acknowledged canonical operations may be correlated. A commit is not a quality claim. */
async function verifyCommitEvidence(env:WorkerEnv,access:Access,scope:ActionScope,eventIds:string[],jobId:string|undefined,decisionCreatedAt:string):Promise<ActionObservation['evidence']|undefined> {
  const {user,shared,projection}=access,events:Array<{event_id:string;type:string;correlation_id:string;recorded_at:string;payload:string}>=[];
  const after=decisionCreatedAt; // Server-issued before UI exposure, independent of the observation queue.
  for(const id of eventIds){
    const row=shared?await env.DB.prepare(`SELECT event.event_id,event.type,event.correlation_id,event.recorded_at,event.payload FROM events event JOIN project_event_scopes scope ON scope.event_id=event.event_id WHERE event.event_id=? AND scope.project_access_id=? AND scope.organization_id=? AND scope.owner_user_id=? AND scope.actor_user_id=? AND event.recorded_at>=?`).bind(id,shared.projectAccessId,shared.organizationId,shared.ownerUserId,user.userId,after).first<typeof events[number]>():await env.DB.prepare("SELECT event_id,type,correlation_id,recorded_at,payload FROM events WHERE event_id=? AND stream_id=? AND actor IN ('user',?) AND recorded_at>=?").bind(id,user.streamId,'user:'+user.userId,after).first<typeof events[number]>();
    if(!row)return;
    const payload=JSON.parse(row.payload) as Record<string,unknown>,document=payload.document_id??payload.source_document_id,block=payload.block_id;
    if(scope.blockId&&block!==scope.blockId)return;
    if(scope.documentId&&document!==scope.documentId&&!(typeof block==='string'&&projection.blocks.some(value=>value.id===block&&value.documentId===scope.documentId)))return;
    if(scope.projectId&&payload.project_id&&payload.project_id!==scope.projectId)return;
    if(scope.projectId&&!payload.project_id&&typeof document==='string'&&!projection.documents.some(value=>value.id===document&&value.projectId===scope.projectId))return;
    events.push(row);
  }
  let jobStatus:string|undefined;
  if(jobId){
    const job=await env.DB.prepare('SELECT document_id,status,correlation_id,stream_id FROM document_jobs WHERE job_id=? AND owner_id=? AND requested_at>=? AND expires_at>?').bind(jobId,user.userId,after,new Date().toISOString()).first<{document_id:string;status:string;correlation_id:string;stream_id:string}>();
    if(!job||scope.documentId&&job.document_id!==scope.documentId||!projection.documents.some(value=>value.id===job.document_id&&(!scope.projectId||value.projectId===scope.projectId)))return;
    if(shared){if(!await env.DB.prepare("SELECT 1 FROM project_resource_scopes WHERE resource_kind='job' AND resource_id=? AND project_access_id=? AND organization_id=? AND actor_user_id=?").bind(jobId,shared.projectAccessId,shared.organizationId,user.userId).first())return;}
    else if(job.stream_id!==user.streamId)return;
    jobStatus=job.status;
  }
  return {eventIds:events.map(row=>row.event_id),eventTypes:events.map(row=>row.type),correlationIds:[...new Set(events.map(row=>row.correlation_id))],...(jobId?{jobId,jobStatus}:{}),authority:'server-verified-references'};
}

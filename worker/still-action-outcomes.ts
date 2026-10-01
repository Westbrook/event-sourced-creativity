import { ACTION_METADATA_VERSION } from '../src/still/action-metadata.ts';
import { ACTION_CONTEXT_VERSION, ACTION_RETENTION_MS, type ActionObservation, type ActionScope, type StillActionContext, type StillGoal } from '../src/still/action-outcomes.ts';
import type { PilotUser } from './pilot-policy.ts';
import type { ProjectRequestContext } from './project-request-context.ts';
import type { WorkerEnv } from './runtime.ts';

export const actionScopeKey = (position: ActionScope, scope?: ProjectRequestContext) => JSON.stringify([ACTION_CONTEXT_VERSION,scope?.projectAccessId ?? '',position.projectId ?? '',position.documentId ?? '',position.blockId ?? '']);
const nowIso = () => new Date().toISOString();
export const emptyActionContext = (): StillActionContext => ({version:ACTION_CONTEXT_VERSION,enabled:false,observations:[],coverage:{status:'complete',limit:40,returned:0,hasMore:false,interpretation:'Semantic reports are evidence of interaction, not proof of quality. Absence is unknown.'}});
export async function actionPreference(env:WorkerEnv,userId:string,key:string) {
  return env.DB.prepare('SELECT epoch,expires_at FROM still_action_preferences WHERE owner_id=? AND scope_key=? AND expires_at>?').bind(userId,key,nowIso()).first<{epoch:string;expires_at:string}>();
}
/** Call only after fresh resource authorization. Authored text stays in private_content. */
export async function readStillActionContext(env:WorkerEnv,user:PilotUser,position:ActionScope,scope?:ProjectRequestContext,forDecision=false):Promise<StillActionContext> {
  const result=emptyActionContext(),key=actionScopeKey(position,scope),now=nowIso();
  try {
    const preference=await actionPreference(env,user.userId,key);
    result.enabled=!!preference;if(preference)result.expiresAt=preference.expires_at;
    const goal=await env.DB.prepare(`SELECT goal.goal_id,goal.status,goal.created_at,goal.expires_at,content.content FROM still_action_goals goal
      JOIN private_content content ON content.content_id=goal.content_id AND content.owner_id=goal.owner_id AND content.kind='still-goal'
      WHERE goal.owner_id=? AND goal.scope_key=? AND goal.status='active' AND goal.expires_at>? AND content.expires_at>? AND content.redacted_at IS NULL LIMIT 1`).bind(user.userId,key,now,now).first<{goal_id:string;status:StillGoal['status'];created_at:string;expires_at:string;content:string}>();
    if(goal){const text=JSON.parse(goal.content) as {text:string;criteria:string[]};result.goal={id:goal.goal_id,scope:position,...text,status:goal.status,createdAt:goal.created_at,expiresAt:goal.expires_at};}
    if(preference){
      const rows=await env.DB.prepare(`SELECT body FROM still_action_observations WHERE owner_id=? AND scope_key=? AND consent_epoch=? AND expires_at>? ${forDecision?"AND kind IN ('commit','failure','cancellation')":''} ORDER BY created_at DESC,observation_id DESC LIMIT ${forDecision?25:41}`).bind(user.userId,key,preference.epoch,now).all<{body:string}>();
      result.observations=rows.results.slice(0,forDecision?24:40).map(row=>JSON.parse(row.body) as ActionObservation);
      result.coverage={...result.coverage,hasMore:rows.results.length>(forDecision?24:40)};
      if(forDecision){
        const feedback=await env.DB.prepare("SELECT body FROM still_action_observations WHERE owner_id=? AND scope_key=? AND consent_epoch=? AND expires_at>? AND kind='feedback' AND COALESCE(json_extract(body,'$.feedbackScope'),'')!='decision' ORDER BY created_at DESC,observation_id DESC LIMIT 17").bind(user.userId,key,preference.epoch,now).all<{body:string}>();
        result.observations.push(...feedback.results.slice(0,16).map(row=>JSON.parse(row.body) as ActionObservation));
        result.coverage.feedback={limit:16,returned:Math.min(16,feedback.results.length),hasMore:feedback.results.length>16};
        result.coverage.hasMore ||= feedback.results.length>16;
      }
      result.observations.sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)||a.id.localeCompare(b.id));result.coverage.returned=result.observations.length;
    }
    return result;
  } catch { result.coverage.status='unavailable';return result; } // Missing optional schema never prevents ordinary work.
}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const ids=(value:unknown)=>Array.isArray(value)?[...new Set(value.flatMap(item=>{const id=typeof item==='string'?item:object(item).id;return typeof id==='string'&&/^[a-z0-9_-]{1,80}$/i.test(id)?[id]:[];}))].slice(0,100):[];
/** Whitelist only operational fields; neither model prompts nor authored state may be retained. */
export function decisionReceiptBody(input:{stateFingerprint:string;policy:string;head:number;response:unknown;usage?:unknown;model?:string},decisionId:string,createdAt:string,expiresAt:string) {
  const response=object(input.response),provider=object(response.provider),nomination=object(response.nextBest);
  const numeric=(value:unknown)=>Object.fromEntries(Object.entries(object(value)).filter(([key,n])=>/^[a-z_]{1,50}$/i.test(key)&&typeof n==='number'&&Number.isFinite(n)&&n>=0));
  return {version:ACTION_CONTEXT_VERSION,kind:response.source==='context'?'context':'decision',...(response.source==='context'?{contextWindowExpiresAt:new Date(Math.min(Date.parse(createdAt)+10*60_000,Date.parse(expiresAt))).toISOString()}:{}),decisionId,createdAt,expiresAt,policy:input.policy.slice(0,100),actionMetadataVersion:ACTION_METADATA_VERSION,stateFingerprint:input.stateFingerprint,head:input.head,
    candidateIds:ids(response.candidateIds),finalActionIds:ids(response.actions),rankedActionIds:ids(response.rankedActions),formatIds:ids(response.formats),paletteActionIds:ids(response.paletteActions),resolvedAction:typeof response.resolvedAction==='string'?response.resolvedAction.slice(0,80):null,
    nextBest:{choice:nomination.status==='Answered'&&typeof nomination.choice==='string'?nomination.choice.slice(0,80):null,status:typeof nomination.status==='string'?nomination.status.slice(0,40):'unavailable',confidence:typeof nomination.confidence==='number'&&Number.isFinite(nomination.confidence)?nomination.confidence:null},
    model:typeof input.model==='string'?input.model.slice(0,100):typeof response.model==='string'?response.model.slice(0,100):null,
    source:response.source==='jev'?'jev':'fallback',assessmentId:typeof response.assessmentId==='string'&&/^[A-Za-z0-9-]{1,80}$/.test(response.assessmentId)?response.assessmentId:null,usageBasis:'original-assessment-not-per-delivery',requestedModel:typeof provider.requestedModel==='string'?provider.requestedModel.slice(0,100):null,resolvedModels:Array.isArray(provider.resolvedModels)?provider.resolvedModels.filter((value):value is string=>typeof value==='string').slice(0,8).map(value=>value.slice(0,100)):[],usage:numeric(input.usage ?? provider.usage),latency:numeric(response.delivery),cache:['hit','shared','miss','bypass'].includes(String(object(response.cache).status))?String(object(response.cache).status):'unavailable'};
}
/** Every delivery receives a new immutable receipt, after authorization and live opt-in checks. */
export async function createStillDecisionReceipt(env:WorkerEnv,user:PilotUser,input:{position:ActionScope;scope?:ProjectRequestContext;stateFingerprint:string;policy:string;head:number;response:unknown;usage?:unknown;model?:string}):Promise<{decisionId:string;expiresAt:string;contextWindowExpiresAt?:string}|undefined> {
  if(!/^[a-f0-9]{64}$/.test(input.stateFingerprint)||!Number.isSafeInteger(input.head)||input.head<0)return;
  try {
    const key=actionScopeKey(input.position,input.scope),preference=await actionPreference(env,user.userId,key);if(!preference)return;
    const count=await env.DB.prepare('SELECT count(*) AS count FROM still_action_receipts WHERE owner_id=? AND scope_key=? AND expires_at>?').bind(user.userId,key,nowIso()).first<{count:number}>();
    if((count?.count??0)>=5000)return;
    const decisionId=crypto.randomUUID(),createdAt=nowIso(),expiresAt=[preference.expires_at,await actionRetentionUntil(env,input.scope)].sort()[0],body=JSON.stringify(decisionReceiptBody(input,decisionId,createdAt,expiresAt));
    const result=await env.DB.prepare(`INSERT INTO still_action_receipts(decision_id,owner_id,scope_key,consent_epoch,created_at,expires_at,body)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM still_action_preferences WHERE owner_id=? AND scope_key=? AND epoch=? AND expires_at>?)`).bind(decisionId,user.userId,key,preference.epoch,createdAt,expiresAt,body,user.userId,key,preference.epoch,createdAt).run();
    if(!result.meta.changes)return;
    return {decisionId,expiresAt,...(object(input.response).source==='context'?{contextWindowExpiresAt:new Date(Math.min(Date.parse(createdAt)+10*60_000,Date.parse(expiresAt))).toISOString()}: {})};
  } catch { return; }
}
/** Optional schema inventory, used by privacy and scheduled expiry without creating tables. */
export async function stillActionTables(env:WorkerEnv) {
  const rows=await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('still_action_preferences','still_action_receipts','still_action_observations','still_action_goals')").all<{name:string}>();
  return new Set(rows.results.map(row=>row.name));
}
export async function sweepStillActionOutcomes(env:WorkerEnv) {
  const tables=await stillActionTables(env);if(!tables.size)return;
  if(tables.size!==4)throw new Error('still_action_schema_incomplete');
  const now=nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE private_content SET content='',redacted_at=? WHERE kind='still-goal' AND redacted_at IS NULL AND expires_at<=?").bind(now,now),
    ...[...tables].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE expires_at<=?`).bind(now)),
  ]);
}
/** Goals are personal intentions even while their target is a shared project. */
export async function stillActionPrivacyDefinitions(env:WorkerEnv,owner:string) {
  const tables=await stillActionTables(env);
  return [...tables].map(table=>({table,set:`DELETE FROM ${table}`,timed:false,where:'owner_id=?',hold:null,bindings:[owner]}));
}
export async function invalidateStillActionDecisionCache(env:WorkerEnv,owner:string) {
  const memory=await import('./still-api.ts');memory.clearStillDecisionMemory(env);
  const table=await env.DB.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='still_decision_cache'").first();
  if(table)await env.DB.prepare('DELETE FROM still_decision_cache WHERE owner_id=?').bind(owner).run();
}
export async function actionRetentionUntil(env:WorkerEnv,scope?:ProjectRequestContext,now=Date.now()) {
  const policy=scope?await env.DB.prepare('SELECT transient_days FROM organization_retention_policies WHERE organization_id=?').bind(scope.organizationId).first<{transient_days:number}>():null;
  const days=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?Math.max(1,Math.min(30,n)):30;};
  return new Date(now+Math.min(ACTION_RETENTION_MS,days(env.FORMA_RETENTION_DAYS)*86_400_000,days(policy?.transient_days)*86_400_000)).toISOString();
}

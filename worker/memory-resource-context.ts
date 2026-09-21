import { memoryResourceSelector } from '../src/model/memory-resource-scope.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { memoryCanonical,type MemorySqlGuard } from './memory-sql.ts';
import { prepareNativeMemoryResourceAuthority,nativeMemoryResourceScopeInputs,type NativeMemoryResourceAuthority } from './memory-resource-authority.ts';
import { prepareNativeResourceMemoryRecall,prepareNativeResourceMemorySnapshot,nativeResourceMemoryRecallInputs,nativeResourceMemoryRecallSnapshot,nativeResourceMemoryRecallGuards,type NativeResourceMemoryRecall } from './memory-resource-history.ts';
import { memoryResourceSchema } from './memory-resource-settings.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { derivationExact,derivationHash,derivationConsentId } from './memory-derivation-policy.ts';
import { requireUser } from './pilot-policy.ts';
import { readNativeControlBody } from './native-control-body.ts';
import type { WorkerEnv } from './runtime.ts';

export const RESOURCE_CONTEXT_POLICY='resource-assistant-context-v1';
const columns=['context_id','actor_user_id','enrollment_id','enrollment_revision','policy_version','snapshot_sha256','snapshot_json','state','created_at','expires_at','retired_at'];
type ContextRow={context_id:string;actor_user_id:string;enrollment_id:string;enrollment_revision:number;policy_version:string;snapshot_sha256:string;snapshot_json:string;state:'active';created_at:string;expires_at:string;retired_at:null};
const reply=(value:Record<string,unknown>,status=200)=>Response.json({version:'memory-resource-context-v1',...value},{status,headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'}});
const rowGuard=(row:ContextRow):MemorySqlGuard=>({condition:`EXISTS(SELECT 1 FROM memory_resource_contexts WHERE context_id=? AND json_array(${columns.join(',')})=? AND state='active' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[row.context_id,JSON.stringify(columns.map(k=>row[k as keyof ContextRow]))]});
async function replay(env:WorkerEnv,guards:MemorySqlGuard[]){const db=env.DB,proof=guards.map(g=>derivationAssertion(env,g)),result=await db.batch(proof);if(env.DB!==db||!derivationResults(result,proof.length)||!result.every(derivationVerified))throw Error('resource_context_changed');}
async function active(env:WorkerEnv,actorId:string,resourceKey:string){
 const db=env.DB,r=structuredClone(await db.prepare(`SELECT ${columns.map(k=>'context.'+k).join(',')} FROM memory_resource_contexts context JOIN memory_resource_enrollments enrollment ON enrollment.enrollment_id=context.enrollment_id
  WHERE context.actor_user_id=? AND enrollment.actor_user_id=context.actor_user_id AND enrollment.resource_key=? AND context.state='active' LIMIT 2`).bind(actorId,resourceKey).all<ContextRow>());
 if(env.DB!==db||!derivationResults([r],1)||r.results.length>1||r.results.some(row=>!derivationExact(row,columns)))throw Error('resource_context_changed');return r.results[0]??null;
}
/** A selected resource remains its own source. No selected-document fallback,
 * provider call or purchase permission is minted by this native read handle. */
declare const contextBrand:unique symbol;
export type NativeResourceAssistantContext=Readonly<{[contextBrand]:true}>;
const captures=new WeakMap<NativeResourceAssistantContext,{env:WorkerEnv;db:WorkerEnv['DB'];recall:NativeResourceMemoryRecall;row:ContextRow;guards:MemorySqlGuard[]}>();
function current(env:WorkerEnv,handle:NativeResourceAssistantContext){const c=captures.get(handle);if(!c||c.env!==env||c.db!==env.DB||Date.now()>=Date.parse(c.row.expires_at))throw Error('resource_context_expired');nativeResourceMemoryRecallInputs(env,c.recall);return c;}
export async function prepareNativeResourceAssistantContext(env:WorkerEnv,authority:NativeMemoryResourceAuthority,contextId?:string){
 const db=env.DB,s=nativeMemoryResourceScopeInputs(env,authority),schema=await memoryResourceSchema(env);if(!schema.contexts)throw Error('resource_context_schema');
 const row=await active(env,s.identity.actorUserId,s.identity.resourceKey);if(!row||contextId!==undefined&&row.context_id!==contextId||row.policy_version!==RESOURCE_CONTEXT_POLICY||Date.now()>=Date.parse(row.expires_at))throw Error('resource_context_unavailable');
 const snapshot=JSON.parse(row.snapshot_json);if(await memoryDigest(memoryCanonical(snapshot))!==row.snapshot_sha256||snapshot.expiresAt!==row.expires_at)throw Error('resource_context_snapshot');
 const recall=await prepareNativeResourceMemorySnapshot(env,authority,snapshot),guards=[schema,rowGuard(row),...nativeResourceMemoryRecallGuards(env,recall)];await replay(env,guards);
 if(env.DB!==db)throw Error('resource_context_changed');const handle=Object.freeze({}) as NativeResourceAssistantContext;captures.set(handle,{env,db,recall,row,guards});current(env,handle);return handle;
}
export function nativeResourceAssistantContextInputs(env:WorkerEnv,handle:NativeResourceAssistantContext){const c=current(env,handle),history=nativeResourceMemoryRecallInputs(env,c.recall);return {contextId:c.row.context_id,snapshotSha256:c.row.snapshot_sha256,expiresAt:c.row.expires_at,history};}
export function nativeResourceAssistantContextGuards(env:WorkerEnv,handle:NativeResourceAssistantContext){return structuredClone(current(env,handle).guards);}
export async function replayNativeResourceAssistantContext(env:WorkerEnv,handle:NativeResourceAssistantContext){try{await replay(env,nativeResourceAssistantContextGuards(env,handle));current(env,handle);return true;}catch{captures.delete(handle);return false;}}

/** Explicit frozen-history selection. Separate review of provider request and
 * price remains mandatory. DELETE needs only ownership, never source access. */
export async function handleMemoryResourceContext(request:Request,env:WorkerEnv){
 const url=new URL(request.url),db=env.DB;
 if(!['GET','PUT','DELETE'].includes(request.method))return reply({error:'method_not_allowed'},405);
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.method!=='GET'&&request.headers.get('origin')!==url.origin)return reply({error:'same_origin_required'},403);
 try{
  if([...url.searchParams.keys()].some(k=>!['kind','projectId','resourceId','view'].includes(k)||url.searchParams.getAll(k).length!==1))throw Error('selection');
  const selector=memoryResourceSelector({kind:url.searchParams.get('kind'),projectId:url.searchParams.get('projectId'),resourceId:url.searchParams.get('resourceId')});if(!selector)throw Error('selection');
  if(url.searchParams.has('view')&&!['preview','saved'].includes(url.searchParams.get('view')!))throw Error('selection');
  const auth=await requireUser(request,env,'viewer',{account:'principal'});if(auth.response||!auth.user||auth.user.fictional||auth.user.projectExecution||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))return reply({error:'principal_account_required'},403);
  const schema=await memoryResourceSchema(env);if(!schema.contexts)throw Error('schema');
  if(request.method==='DELETE'){
   const parsed=await readNativeControlBody(request);if(parsed.status!=='parsed'||!derivationExact(parsed.value,['contextId','confirmation'])||!derivationConsentId(parsed.value.contextId)||parsed.value.confirmation!=='FORGET_RESOURCE_ASSISTANT_CONTEXT')return reply({error:'confirmation_required'},400);
   const statement=env.DB.prepare(`UPDATE memory_resource_contexts SET state='retired',snapshot_json=NULL,retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE context_id=? AND actor_user_id=? AND state='active'`)
    .bind(parsed.value.contextId,auth.user.userId);
   const result=await db.batch([derivationAssertion(env,schema),statement,derivationAssertion(env,{condition:"NOT EXISTS(SELECT 1 FROM memory_resource_contexts WHERE context_id=? AND actor_user_id=? AND state='active')",bindings:[parsed.value.contextId,auth.user.userId]})]);if(env.DB!==db||!derivationResults(result,3)||!derivationVerified(result[0]!)||!derivationVerified(result[2]!))throw Error('unconfirmed');
   return reply({forgotten:true,authoredResourcesPreserved:true,noAutomaticRetry:true});
  }
  const authority=await prepareNativeMemoryResourceAuthority(request,env,selector),scope=nativeMemoryResourceScopeInputs(env,authority).identity;
  if(request.method==='GET'&&url.searchParams.get('view')==='saved'){
   const handle=await prepareNativeResourceAssistantContext(env,authority),input=nativeResourceAssistantContextInputs(env,handle),response=reply({policyVersion:RESOURCE_CONTEXT_POLICY,...input});nativeResourceAssistantContextInputs(env,handle);return response;
  }
  if(request.method==='GET'){
   const recall=await prepareNativeResourceMemoryRecall(env,authority),snapshot=nativeResourceMemoryRecallSnapshot(env,recall),row=await active(env,scope.actorUserId,scope.resourceKey);
   if(!snapshot.sources.length&&!snapshot.openings.length)throw Error('empty');
   // Preserve room for the bounded confirmation envelope; no silent truncation.
   if(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength>60000)throw Error('capacity');
   const snapshotSha256=await memoryDigest(memoryCanonical(snapshot));await replay(env,[schema,...nativeResourceMemoryRecallGuards(env,recall)]);
   const response=reply({policyVersion:RESOURCE_CONTEXT_POLICY,snapshot,snapshotSha256,expectedContextId:row?.context_id??null,history:nativeResourceMemoryRecallInputs(env,recall),spendingAuthorized:false});nativeResourceMemoryRecallInputs(env,recall);return response;
  }
  const parsed=await readNativeControlBody(request,65536);
  if(parsed.status!=='parsed'||!derivationExact(parsed.value,['confirmation','snapshot','snapshotSha256','expectedContextId'])||parsed.value.confirmation!=='USE_RESOURCE_ACTIVITY_IN_ASSISTANT'
   ||!derivationHash(parsed.value.snapshotSha256)||parsed.value.expectedContextId!==null&&!derivationConsentId(parsed.value.expectedContextId))return reply({error:'confirmation_required'},400);
  const recall=await prepareNativeResourceMemorySnapshot(env,authority,parsed.value.snapshot),snapshot=nativeResourceMemoryRecallSnapshot(env,recall),hash=await memoryDigest(memoryCanonical(snapshot));
  if(hash!==parsed.value.snapshotSha256||!snapshot.sources.length&&!snapshot.openings.length)throw Error('snapshot');
  const now=new Date().toISOString(),contextId=crypto.randomUUID(),proof=[schema,...nativeResourceMemoryRecallGuards(env,recall),{condition:"(SELECT context_id FROM memory_resource_contexts WHERE enrollment_id=? AND state='active') IS ?",bindings:[snapshot.enrollmentId,parsed.value.expectedContextId]}];
  const result=await db.batch([...proof.map(g=>derivationAssertion(env,g)),
   db.prepare("UPDATE memory_resource_contexts SET state='retired',snapshot_json=NULL,retired_at=MAX(created_at,?) WHERE enrollment_id=? AND state='active'").bind(now,snapshot.enrollmentId),
   db.prepare("INSERT INTO memory_resource_contexts(context_id,actor_user_id,enrollment_id,enrollment_revision,policy_version,snapshot_sha256,snapshot_json,state,created_at,expires_at,retired_at) VALUES(?,?,?,?,?,?,?,'active',?,?,NULL)")
    .bind(contextId,scope.actorUserId,snapshot.enrollmentId,snapshot.revision,RESOURCE_CONTEXT_POLICY,hash,JSON.stringify(snapshot),now,snapshot.expiresAt),
   derivationAssertion(env,{condition:'changes()=1',bindings:[]})]);
  if(env.DB!==db||!derivationResults(result,proof.length+3)||!result.slice(0,proof.length).every(derivationVerified)||!derivationVerified(result.at(-1)!))throw Error('unconfirmed');
  nativeResourceMemoryRecallInputs(env,recall);return reply({saved:true,contextId,snapshotSha256:hash,spendingAuthorized:false,noAutomaticRetry:true});
 }catch{return reply({error:'resource_context_unavailable',noAutomaticRetry:true},409);}
}

import { nativeResourceAssistantContextInputs,nativeResourceAssistantContextGuards,type NativeResourceAssistantContext } from './memory-resource-context.ts';
import { memoryResourceSchema } from './memory-resource-settings.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { derivationExact,derivationHash,derivationTime } from './memory-derivation-policy.ts';
import type { WorkerEnv } from './runtime.ts';
import type { MemorySqlGuard } from './memory-sql.ts';

const executionIdValid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v);
const columns=['execution_id','actor_user_id','context_id','resource_key','snapshot_sha256','state','created_at','expires_at','retired_at'];
type Row={execution_id:string;actor_user_id:string;context_id:string;resource_key:string;snapshot_sha256:string;state:'active';created_at:string;expires_at:string;retired_at:null};
/** A retained private run is not an authored artifact, approval to purchase or
 * a serialized authority. Its exact selected activity is independently replayed. */
declare const runBrand:unique symbol;
export type NativeResourceAssistantRun=Readonly<{[runBrand]:true}>;
const runs=new WeakMap<NativeResourceAssistantRun,{env:WorkerEnv;db:WorkerEnv['DB'];context:NativeResourceAssistantContext;row:Row;guards:MemorySqlGuard[]}>();
const rowGuard=(row:Row):MemorySqlGuard=>({condition:`EXISTS(SELECT 1 FROM memory_resource_assistant_runs WHERE execution_id=? AND json_array(${columns.join(',')})=? AND state='active' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[row.execution_id,JSON.stringify(columns.map(k=>row[k as keyof Row]))]});
function current(env:WorkerEnv,handle:NativeResourceAssistantRun){const c=runs.get(handle);if(!c||c.env!==env||c.db!==env.DB||Date.now()>=Date.parse(c.row.expires_at))throw Error('resource_assistant_expired');nativeResourceAssistantContextInputs(env,c.context);return c;}
export async function prepareNativeResourceAssistantRun(env:WorkerEnv,context:NativeResourceAssistantContext,executionId:string){
 if(!executionIdValid(executionId))throw Error('resource_assistant_identity');const db=env.DB,input=nativeResourceAssistantContextInputs(env,context),schema=await memoryResourceSchema(env);if(!schema.assistantRuns)throw Error('resource_assistant_schema');
 const raw=structuredClone(await db.prepare(`SELECT ${columns.join(',')} FROM memory_resource_assistant_runs WHERE execution_id=? AND actor_user_id=? LIMIT 2`).bind(executionId,input.history.scope.actorUserId).all<Row>());
 if(env.DB!==db||!derivationResults([raw],1)||raw.results.length!==1)throw Error('resource_assistant_unavailable');const row=raw.results[0]!;
 if(!derivationExact(row,columns)||row.context_id!==input.contextId||row.resource_key!==input.history.scope.resourceKey||row.snapshot_sha256!==input.snapshotSha256||!derivationHash(row.snapshot_sha256)||row.state!=='active'||row.retired_at!==null
  ||!derivationTime(row.created_at)||!derivationTime(row.expires_at)||row.expires_at>input.expiresAt||row.created_at>=row.expires_at||row.expires_at<=new Date().toISOString())throw Error('resource_assistant_unavailable');
 const guards=[schema,...nativeResourceAssistantContextGuards(env,context),rowGuard(row)],proof=guards.map(g=>derivationAssertion(env,g)),checked=await db.batch(proof);
 if(env.DB!==db||!derivationResults(checked,proof.length)||!checked.every(derivationVerified))throw Error('resource_assistant_changed');nativeResourceAssistantContextInputs(env,context);
 const handle=Object.freeze({}) as NativeResourceAssistantRun;runs.set(handle,{env,db,context,row,guards});current(env,handle);return handle;
}
export function nativeResourceAssistantRunInputs(env:WorkerEnv,handle:NativeResourceAssistantRun){const c=current(env,handle);return {...nativeResourceAssistantContextInputs(env,c.context),executionId:c.row.execution_id,expiresAt:c.row.expires_at};}
export function nativeResourceAssistantRunGuards(env:WorkerEnv,handle:NativeResourceAssistantRun){return structuredClone(current(env,handle).guards);}
export async function replayNativeResourceAssistantRun(env:WorkerEnv,handle:NativeResourceAssistantRun){try{const c=current(env,handle),proof=c.guards.map(g=>derivationAssertion(env,g)),checked=await env.DB.batch(proof);current(env,handle);if(!derivationResults(checked,proof.length)||!checked.every(derivationVerified))throw Error('changed');return true;}catch{runs.delete(handle);return false;}}
/** The native quote transaction already owns an exact resource context handle.
 * Appending these statements does not create a document grant or a fake job. */
export function nativeResourceAssistantQuoteStatements(env:WorkerEnv,context:NativeResourceAssistantContext,executionId:string,contentId:string){
 const input=nativeResourceAssistantContextInputs(env,context);if(!executionIdValid(executionId))throw Error('resource_assistant_identity');
 return [...nativeResourceAssistantContextGuards(env,context).map(g=>derivationAssertion(env,g)),
  env.DB.prepare("INSERT INTO memory_resource_assistant_runs(execution_id,actor_user_id,context_id,resource_key,snapshot_sha256,state,created_at,expires_at,retired_at) VALUES(?,?,?,?,?,'active',?,?,NULL)")
   .bind(executionId,input.history.scope.actorUserId,input.contextId,input.history.scope.resourceKey,input.snapshotSha256,new Date().toISOString(),input.expiresAt),
  ...contentStatements(env,executionId,input.history.scope.actorUserId,input.expiresAt,contentId,'consent')];
}
function contentStatements(env:WorkerEnv,executionId:string,actorId:string,expiresAt:string,contentId:string,role:'consent'|'response'|'result'){
 const kind={consent:'execution-consent',response:'provider-response',result:'context-proposal'}[role];
 return [env.DB.prepare('UPDATE private_content SET expires_at=MIN(expires_at,?) WHERE content_id=? AND owner_id=? AND kind=? AND redacted_at IS NULL').bind(expiresAt,contentId,actorId,kind),
  derivationAssertion(env,{condition:'changes()=1',bindings:[]}),
  env.DB.prepare('INSERT INTO memory_resource_assistant_contents(content_id,execution_id,role) VALUES(?,?,?)').bind(contentId,executionId,role),
  derivationAssertion(env,{condition:'changes()=1',bindings:[]})];
}
/** Only private quote/response/result kinds; never authored/copied content. The
 * caller includes every run guard in the same publication transaction. */
export function nativeResourceAssistantContentStatements(env:WorkerEnv,handle:NativeResourceAssistantRun,contentId:string,role:'response'|'result'){
 const c=current(env,handle);return contentStatements(env,c.row.execution_id,c.row.actor_user_id,c.row.expires_at,contentId,role);
}

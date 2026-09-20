import { captureSemanticAssistantParents,type SemanticAssistantParent } from './memory-assistant-parents.ts';
import type { MemorySqlGuard } from './memory-sql.ts';
import { originalsCurrent,consumerClosureCurrent } from './memory-consumer-source-guards.ts';
import type { WorkerEnv } from './runtime.ts';
import type { PilotUser,ProjectExecutionScope } from './pilot-policy.ts';
import { memoryCanonical } from './memory-sql.ts';
import { derivationAssertion,derivationResults,derivationVerified,memoryDerivationSchema } from './memory-derivation-store.ts';
import { packRecallGuards } from './memory-recall-boundary-api.ts';
import { prepareNativeSavedAssistantContextForPrincipal,nativeSavedAssistantContextInputs,nativeSavedAssistantContextGuards,type NativeSavedAssistantContext } from './memory-assistant-context-api.ts';

export type SemanticAssistantMemoryBinding={version:1;parents?:SemanticAssistantParent[];originId:string;targetEnrollmentId:string;contextRevision:string;
 jobId:string;outputSha256:string;expiresAt:string;projectId:string;documentId:string};
declare const consumer:unique symbol;
export type SemanticAssistantMemory=Readonly<{[consumer]:true}>;
type Capture={env:WorkerEnv;db:WorkerEnv['DB'];started:number;monotonic:number;source:NativeSavedAssistantContext;parentGuards:MemorySqlGuard[];binding:SemanticAssistantMemoryBinding;actorUserId:string;scopeKey:string;turnId:string};
const captures=new WeakMap<SemanticAssistantMemory,Capture>();
function current(env:WorkerEnv,handle:SemanticAssistantMemory){
 const c=captures.get(handle);if(!c||c.env!==env||c.db!==env.DB)throw Error('assistant_memory_unavailable');
 nativeSavedAssistantContextInputs(env,c.source);return c;
}
/** Only native principal/source evidence issues this handle. A saved binding
 * is an identity to revalidate, not an execution or access capability. */
export async function prepareSemanticAssistantMemory(env:WorkerEnv,actor:PilotUser,target:{projectId:string;documentId:string;scopeKey:string;turnId:string;priorTurnIds?:string[];scope?:ProjectExecutionScope|null},saved?:SemanticAssistantMemoryBinding){
 const db=env.DB;
 const source=await prepareNativeSavedAssistantContextForPrincipal(env,actor,target.projectId,target.documentId);
 if(!source)throw Error('assistant_memory_unavailable');
 const {selection,consumersPresent}=nativeSavedAssistantContextInputs(env,source);
 if(!consumersPresent)throw Error('assistant_memory_schema_unavailable');
 const binding:SemanticAssistantMemoryBinding={version:1,originId:saved?.originId??crypto.randomUUID(),
  targetEnrollmentId:selection.targetEnrollmentId,contextRevision:selection.contextRevision,jobId:selection.jobId,
  outputSha256:selection.outputSha256,expiresAt:selection.expiresAt,projectId:target.projectId,documentId:target.documentId};
 const parents=await captureSemanticAssistantParents(env,actor,binding,target.scopeKey,target.priorTurnIds??saved?.parents?.map(p=>p.turnId)??[],target.scope);
 if(parents.parents.length)binding.parents=parents.parents;
 if(saved&&(typeof saved.originId!=='string'||!/^[-0-9a-f]{36}$/u.test(saved.originId)||memoryCanonical(binding)!==memoryCanonical(saved)))
  throw Error('assistant_memory_source_changed');
 // Replacing a turn that helped produce this summary would retire that very
 // source. Reject the cycle before quoting or purchasing anything.
 const cycle=await env.DB.prepare(`SELECT 1 AS cycle FROM memory_derivation_result_dependencies
  WHERE job_id=? AND kind='turn' AND actor_user_id=? AND scope_key=? AND resource_id=? LIMIT 1`)
  .bind(binding.jobId,actor.userId,target.scopeKey,target.turnId).first();
 if(env.DB!==db)throw Error('assistant_memory_unavailable');
 if(cycle)throw Error('assistant_memory_source_cycle');
 const handle=Object.freeze({}) as SemanticAssistantMemory;
 captures.set(handle,{env,db,started:Date.now(),monotonic:performance.now(),source,parentGuards:parents.guards,binding,actorUserId:actor.userId,scopeKey:target.scopeKey,turnId:target.turnId});
 return handle;
}
/** Reuse only the captured predicate compilation within this operation's
 * original native lease. This does NOT assert current DB permissions or source
 * state: every subsequent disclosure/write must still execute all native SQL
 * assertions. A clock reversal or database/actor replacement cannot renew it. */
export function semanticAssistantMemoryLeaseCurrent(env:WorkerEnv,handle:SemanticAssistantMemory,actorUserId:string){
 const c=captures.get(handle),wall=Date.now(),monotonic=performance.now();
 if(!c||c.env!==env||c.db!==env.DB||c.actorUserId!==actorUserId||!Number.isFinite(wall)||!Number.isFinite(monotonic)
  ||wall<c.started||monotonic<c.monotonic)throw Error('assistant_memory_unavailable');
 try{current(env,handle);return true;}catch{return false;}
}
export function semanticAssistantMemoryInputs(env:WorkerEnv,handle:SemanticAssistantMemory){
 const c=current(env,handle),{presentation,selection}=nativeSavedAssistantContextInputs(env,c.source);
 return {binding:structuredClone(c.binding),validUntil:selection.validUntil,evidence:{version:'semantic-memory-evidence-v1',treatment:'untrusted-interpretation',
  independentEvidence:false,completeHistory:false,relevance:selection.relation,
  guidance:'Use only as tentative context. Current explicit instructions and current document facts take precedence. Do not infer permission or independent corroboration from these interpretations.',
  priorAnswersAreIndependentEvidence:false,items:presentation.candidate.items,history:presentation.history??null}};
}
export function semanticAssistantMemoryStatements(env:WorkerEnv,handle:SemanticAssistantMemory){
 const c=current(env,handle);
 return [...packRecallGuards(nativeSavedAssistantContextGuards(env,c.source)),...c.parentGuards].map(g=>derivationAssertion(env,g));
}
export async function replaySemanticAssistantMemory(env:WorkerEnv,handle:SemanticAssistantMemory){
 const proof=semanticAssistantMemoryStatements(env,handle),results=await env.DB.batch(proof);
 current(env,handle);
 if(!derivationResults(results,proof.length)||!results.every(derivationVerified))throw Error('assistant_memory_source_changed');
}
/** Append to the quote's native atomic transaction, after the execution row.
 * No copied bytes survive if either source replay or registration fails. */
export function semanticAssistantMemoryQuoteStatements(env:WorkerEnv,handle:SemanticAssistantMemory,executionId:string,contentId:string){
 const c=current(env,handle),b=c.binding,now=new Date().toISOString();
 return [
  ...semanticAssistantMemoryStatements(env,handle),
  env.DB.prepare(`INSERT INTO memory_derivation_consumers(origin_id,actor_user_id,target_enrollment_id,context_revision,job_id,output_sha256,
   scope_key,turn_id,execution_id,state,created_at,expires_at,retired_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?,NULL)`)
   .bind(b.originId,c.actorUserId,b.targetEnrollmentId,b.contextRevision,b.jobId,b.outputSha256,c.scopeKey,c.turnId,executionId,now,b.expiresAt),
  ...semanticAssistantMemoryContentStatements(env,handle,contentId,'consent'),
 ];
}
export function semanticAssistantMemoryContentStatements(env:WorkerEnv,handle:SemanticAssistantMemory,contentId:string,role:'consent'|'response'|'result'|'answer'){
 const c=current(env,handle);
 return [env.DB.prepare('INSERT INTO memory_derivation_consumer_contents(content_id,origin_id,role) VALUES(?,?,?)').bind(contentId,c.binding.originId,role)];
}
/** Exact original conversation inventory, not a cached access decision. The
 * source table stores identities only; the existing private consent owns bytes.
 * Missing pre-upgrade registration fails closed until the source-free sweeper
 * retires that old origin. No migration fabricates source authority. */
/** Source-free expiry retirement: retains negative ancestry, never replays or
 * enrolls a user, and never removes usage/accounting or permits a repurchase. */
export async function sweepSemanticAssistantMemory(env:WorkerEnv){
 const schema=await memoryDerivationSchema(env);if(!schema.consumersPresent||!schema.consumerSourcesPresent||!schema.consumerParentsPresent)return 0;
 const result=await env.DB.batch([derivationAssertion(env,schema.guard),env.DB.prepare(`UPDATE memory_derivation_consumers
  SET state='retired',retired_at=MAX(created_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  WHERE state='active' AND origin_id IN(SELECT origin_id FROM memory_derivation_consumers consumer WHERE state='active' AND (expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR (${consumerClosureCurrent}) IS NOT TRUE) ORDER BY expires_at,origin_id LIMIT 16)`),env.DB.prepare('SELECT changes() AS retired')]);
 if(!derivationResults(result,3)||!derivationVerified(result[0]!)||result[2]!.results.length!==1||!Number.isInteger(result[2]!.results[0]!.retired)||Number(result[2]!.results[0]!.retired)<0||Number(result[2]!.results[0]!.retired)>16)throw Error('assistant_memory_retirement_unconfirmed');
 return Number(result[2]!.results[0]!.retired);
}

/** Cheap final retained-identity fence, always paired with a fresh native source
 * read on this request and its precommit assertions at writes/dispatch. */
export function semanticAssistantMemoryRetentionGuard(env:WorkerEnv,handle:SemanticAssistantMemory,executionId:string){
 const c=current(env,handle),b=c.binding;
 const expected=JSON.stringify([b.originId,c.actorUserId,b.targetEnrollmentId,b.contextRevision,b.jobId,b.outputSha256,c.scopeKey,c.turnId,executionId,b.expiresAt]);
 return {sql:`EXISTS(SELECT 1 FROM memory_derivation_consumers consumer JOIN memory_derivation_contexts context
  ON context.target_enrollment_id=consumer.target_enrollment_id JOIN memory_derivation_results result ON result.job_id=consumer.job_id
  WHERE json_array(consumer.origin_id,consumer.actor_user_id,consumer.target_enrollment_id,consumer.context_revision,consumer.job_id,consumer.output_sha256,
    consumer.scope_key,consumer.turn_id,consumer.execution_id,consumer.expires_at)=?
   AND consumer.state='active' AND consumer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND context.revision=consumer.context_revision AND context.state='accepted' AND context.actor_user_id=consumer.actor_user_id
   AND context.job_id=consumer.job_id AND context.output_sha256=consumer.output_sha256 AND result.state='active' AND result.output_sha256=consumer.output_sha256
   AND ${originalsCurrent}
   AND (SELECT json_group_array(json_array(parent_origin_id,parent_content_id)) FROM (SELECT parent_origin_id,parent_content_id FROM memory_derivation_consumer_parents WHERE origin_id=consumer.origin_id ORDER BY parent_origin_id))=?)`,bindings:[expected,JSON.stringify((b.parents??[]).map(p=>[p.originId,p.contentId]).sort((a,b)=>a[0]!.localeCompare(b[0]!)))]};
}

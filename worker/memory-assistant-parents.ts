import type { WorkerEnv } from './runtime.ts';
import type { PilotUser,ProjectExecutionScope } from './pilot-policy.ts';
import { executionContentCustodyGuard,consentHash } from './consequential-consent.ts';
import { consumerClosureCurrent } from './memory-consumer-source-guards.ts';
import type { SemanticAssistantMemoryBinding } from './memory-assistant-consumer.ts';
import type { MemorySqlGuard } from './memory-sql.ts';
export type SemanticAssistantParent={originId:string;turnId:string;executionId:string;contentId:string;bindingHash:string;reply:string};
function fail():never{throw Error('assistant_memory_parent_unavailable');}
/** Native, same-context canonical answers only. This is not a generic supplied
 * transcript: final publication replays the exact bounded snapshot and source
 * closure. No parent is treated as an original or independent support. */
export async function captureSemanticAssistantParents(env:WorkerEnv,actor:PilotUser,binding:SemanticAssistantMemoryBinding,
 scopeKey:string,turnIds:readonly string[],scope:ProjectExecutionScope|null=actor.projectExecution??null):Promise<{parents:SemanticAssistantParent[];guards:MemorySqlGuard[]}>{
 if(turnIds.length>2||new Set(turnIds).size!==turnIds.length||turnIds.some(id=>typeof id!=='string'||!id||id.length>240))fail();
 if(!turnIds.length)return {parents:[],guards:[]};
 const db=env.DB;
 const content=executionContentCustodyGuard({actorUserId:actor.userId,scope},'content');
 const approved={sql:content.sql.replaceAll('content.content_id','approved.content_id'),bindings:content.bindings};
 const query=`SELECT consumer.origin_id,consumer.turn_id,consumer.execution_id,registered.content_id,execution.binding_hash,
  CASE WHEN length(CAST(approved.content AS BLOB))<=196608 AND (${approved.sql}) THEN approved.content END AS consent,
  CASE WHEN length(CAST(content.content AS BLOB))<=65536 AND (${content.sql}) THEN content.content END AS result,
  CASE WHEN consumer.state='active' AND consumer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND consumer.target_enrollment_id=? AND consumer.context_revision=? AND consumer.job_id=? AND consumer.output_sha256=?
   AND execution.actor_user_id=consumer.actor_user_id AND execution.operation='assistant-specialist' AND execution.status='completed'
   AND execution.result_ref=registered.content_id
   AND approved.owner_id=consumer.actor_user_id AND approved.kind='execution-consent' AND approved.redacted_at IS NULL AND approved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND content.owner_id=consumer.actor_user_id AND content.kind='context-proposal' AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND EXISTS(SELECT 1 FROM consequential_execution_steps step JOIN budget_reservations tokens ON tokens.reservation_id=step.execution_id||':tokens:0'
    JOIN cost_budget_reservations cost ON cost.reservation_id=step.execution_id||':usd:0'
    WHERE step.execution_id=execution.execution_id AND step.step_index=0 AND step.status='settled'
     AND tokens.owner_id=consumer.actor_user_id AND tokens.status='settled' AND tokens.used_tokens=step.verified_tokens
     AND cost.owner_id=consumer.actor_user_id AND cost.status='settled' AND cost.used_microusd=step.verified_microusd)
   AND (${consumerClosureCurrent}) THEN 1 ELSE 0 END AS current
 FROM memory_derivation_consumers consumer JOIN memory_derivation_consumer_contents registered ON registered.origin_id=consumer.origin_id AND registered.role='result'
 LEFT JOIN consequential_executions execution ON execution.execution_id=consumer.execution_id
 LEFT JOIN private_content approved ON approved.content_id=execution.consent_ref
 LEFT JOIN private_content content ON content.content_id=registered.content_id
 WHERE consumer.actor_user_id=? AND consumer.scope_key=? AND consumer.turn_id IN(SELECT value FROM json_each(?)) ORDER BY consumer.turn_id,consumer.origin_id LIMIT 3`;
 const bindings=[...approved.bindings,...content.bindings,binding.targetEnrollmentId,binding.contextRevision,binding.jobId,binding.outputSha256,actor.userId,scopeKey,JSON.stringify(turnIds)];
 const names=['origin_id','turn_id','execution_id','content_id','binding_hash','consent','result','current'];
 const snapshot=`(SELECT json_group_array(json_object(${names.map(name=>"'"+name+"',"+name).join(',')})) FROM (${query}))`;
 const row=await db.prepare('SELECT '+snapshot+' AS captured').bind(...bindings).first<{captured:string}>();
 if(env.DB!==db||typeof row?.captured!=='string'||new TextEncoder().encode(row.captured).byteLength>786432)fail();
 const rows=JSON.parse(row.captured) as Record<string,unknown>[];if(!Array.isArray(rows)||rows.length>2)fail();
 const parents:SemanticAssistantParent[]=[];
 for(const row of rows){
  if(row.current!==1||typeof row.consent!=='string'||typeof row.result!=='string')fail();
  const saved=JSON.parse(row.consent),parent=saved?.binding,result=JSON.parse(row.result);
  const selected=parent?.request?.memory;
  if(await consentHash(parent)!==row.binding_hash||parent.version!=='assistant-specialist-consent-v1'||parent.operation!=='assistant-specialist'
   ||parent.actorUserId!==actor.userId||parent.projectId!==binding.projectId||parent.documentId!==binding.documentId
   ||parent.request?.turnId!==row.turn_id||parent.request?.scopeKey!==scopeKey||saved.preview?.executionId!==row.execution_id
   ||saved.preview?.bindingHash!==row.binding_hash||selected?.originId!==row.origin_id
   ||selected.targetEnrollmentId!==binding.targetEnrollmentId||selected.contextRevision!==binding.contextRevision
   ||selected.jobId!==binding.jobId||selected.outputSha256!==binding.outputSha256
   ||result.schema!==1||result.sourceStatus!=='semantic-memory-assisted'||result.executionId!==row.execution_id
   ||result.bindingHash!==row.binding_hash||result.turnId!==row.turn_id||result.sourceHash!==parent.sourceHash
   ||typeof result.reply!=='string'||!result.reply||result.reply.length>16000||result.reply!==result.providerResult?.reply
   ||result.providerResult?.model!==parent.steps?.[0]?.model)fail();
  parents.push({originId:String(row.origin_id),turnId:String(row.turn_id),executionId:String(row.execution_id),contentId:String(row.content_id),bindingHash:String(row.binding_hash),reply:result.reply});
 }
 if(env.DB!==db)fail();
 return{parents,guards:[{condition:snapshot+'=?',bindings:[...bindings,row.captured]}]};
}

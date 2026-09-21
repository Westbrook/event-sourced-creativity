import { executionAdmissionGuard } from "./intake-authority.ts";
export { executionAdmissionGuard };
import { claimCostBudgetReservation, preparePrivateContent, releaseBudget, releaseCostBudget, reserveBudget, reserveCostBudget, settleBudget, settleCostBudget, settleSpecialistBudgetPair, storePrivateContent, type BudgetReservationGuard, type PilotUser, type ProjectExecutionScope } from "./pilot-policy.ts";
import { uuidV7, type WorkerEnv } from "./runtime.ts";

export type ExecutionStepLimit={name:string;provider:string;model:string;inputTokens:number;outputTokens:number;maximumMicrousd:number;toolCalls:number};
export type ConsequentialBinding={version:string;intentHash:string;operation:string;actorUserId:string;permissionEpoch:string;streamId:string;projectId:string;documentId:string;canvasId:string|null;blockId:string;sourceHash:string;period:string;scope:ProjectExecutionScope|null;contextSessionId:string|null;pilotCohortId:string|null;steps:ExecutionStepLimit[];publicQuery:string;request:unknown};
export type ConsequentialPreview={executionId:string;bindingHash:string;expiresAt:string;operation:string;actorLabel:string;workspaceId:string|null;period:string;projectId:string;documentId:string;canvasId:string|null;blockId:string;sourceHash:string;provider:string;models:string[];maximumMicrousd:number;maximumTokens:number;providerCalls:number;searchCalls:number;publicQuery:string;privateInput:unknown;status:string};
export type AvailableConsequentialPreview=ConsequentialPreview&{providerAvailable:boolean;canExecute?:boolean;canPrepareNew?:boolean;budgetAvailable?:boolean;availableMicrousd?:number|null;unavailableReasons?:string[]};
export type ExecutionRow={execution_id:string;actor_user_id:string;intent_hash:string;binding_hash:string;consent_ref:string;result_ref:string|null;status:string;error_code:string|null;expires_at:string};
// An adaptive response can be durably paid before strict decoding or final materialization.
// Its original identity remains reusable even when those later steps failed.
const reusableExecutionSql=(alias:string)=>`(${alias}.status IN('reserved','uncertain','completed') OR ${alias}.result_ref IS NOT NULL OR ${alias}.operation IN('adaptive-structure','assistant-specialist') AND EXISTS(SELECT 1 FROM consequential_execution_steps paid WHERE paid.execution_id=${alias}.execution_id AND paid.status IN('submitting','uncertain','usage-recorded','settled')))`;

/** Stable object-key ordering prevents serialization accidents from widening an approval. */
export function canonicalConsent(value:unknown):string{
  if(Array.isArray(value))return`[${value.map(canonicalConsent).join(",")}]`;
  if(value&&typeof value==="object")return "{"+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalConsent(item)}`).join(",")+"}";
  return JSON.stringify(value)??"null";
}
export async function consentHash(value:unknown){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalConsent(value)));
  return Array.from(new Uint8Array(bytes),(byte)=>byte.toString(16).padStart(2,"0")).join("");
}


export async function executionAuthorityCurrent(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,sourceHead:number|null){
  const guard=executionAdmissionGuard(user,binding,sourceHead);
  return Boolean(await env.DB.prepare(`SELECT 1 AS authorized WHERE ${guard.sql}`).bind(...guard.bindings).first());
}

/** Retained read custody is independent of new-purchase roles or budget availability.
 * Row equalities keep every original comparison and SQL NULL behavior while avoiding
 * a left-deep AND chain when this proof is nested inside a final D1 custody check. */
export function executionContentCustodyGuard(binding:Pick<ConsequentialBinding,"scope"|"actorUserId">,alias:"private_content"|"content"|"raw"|"saved"="private_content"):BudgetReservationGuard{
  const scope=binding.scope;
  if(!scope)return{sql:`NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='content' AND resource.resource_id=${alias}.content_id) AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes retention WHERE retention.content_id=${alias}.content_id)`,bindings:[]};
  return{sql:`EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN private_content_retention_scopes retention
    ON (retention.content_id,retention.organization_id,retention.project_access_id,retention.project_id,retention.actor_user_id)
      =(resource.resource_id,resource.organization_id,resource.project_access_id,resource.project_id,resource.actor_user_id)
    WHERE (resource.resource_kind,resource.resource_id,resource.visibility,resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.actor_user_id)
      =('content',${alias}.content_id,'actor_private',?,?,?,?,?))`,bindings:[scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId,binding.actorUserId]};
}

export async function quoteConsequentialExecution(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,privateInput:unknown,sourceHead:number,availableMicrousd:number,additional?:BudgetReservationGuard,publicationEvidence?:(executionId:string,contentId:string)=>D1PreparedStatement[]){
  const executionId=uuidV7(),bindingHash=await consentHash(binding),now=new Date().toISOString(),expiresAt=new Date(Date.now()+10*60_000).toISOString();
  const admission=executionAdmissionGuard(user,binding,sourceHead),guard=additional?{sql:`(${admission.sql}) AND (${additional.sql})`,bindings:[...admission.bindings,...additional.bindings]}:admission,contentCustody=executionContentCustodyGuard(binding,"content");
  const splitReuse=Boolean(additional)&&5+contentCustody.bindings.length+guard.bindings.length>100;
  const reuseGuard=splitReuse?admission:guard;
  const existingStatement=env.DB.prepare(`SELECT execution.status,content.content FROM consequential_executions execution JOIN private_content content
    ON content.content_id=execution.consent_ref AND content.owner_id=execution.actor_user_id AND content.kind='execution-consent' AND content.redacted_at IS NULL AND content.expires_at>? AND ${contentCustody.sql}
    WHERE execution.actor_user_id=? AND((execution.intent_hash=? AND ${reusableExecutionSql("execution")})
      OR execution.binding_hash=? AND execution.status='quoted' AND execution.expires_at>?) AND ${reuseGuard.sql} ORDER BY execution.created_at DESC LIMIT 1`)
    .bind(now,...contentCustody.bindings,user.userId,binding.intentHash,bindingHash,now,...reuseGuard.bindings);
  // Preserve the exact current private-source proof in the same native read
  // transaction without repeating its bindings in the shared-custody SELECT.
  const existing=splitReuse?(await env.DB.batch<{status:string;content:string}>([
    env.DB.prepare(`SELECT CASE WHEN (${additional!.sql}) THEN 1 ELSE json('context_quote_source_changed') END AS verified`).bind(...additional!.bindings),
    existingStatement,
    env.DB.prepare(`SELECT CASE WHEN (${additional!.sql}) THEN 1 ELSE json('context_quote_source_changed') END AS verified`).bind(...additional!.bindings),
  ]))[1]?.results[0]:await existingStatement.first<{status:string;content:string}>();
  if(existing)return{...(JSON.parse(existing.content).preview as ConsequentialPreview),status:existing.status};
  const preview:ConsequentialPreview={executionId,bindingHash,expiresAt,operation:binding.operation,actorLabel:user.displayName||user.userId,workspaceId:binding.scope?.organizationId??null,period:binding.period,projectId:binding.projectId,documentId:binding.documentId,canvasId:binding.canvasId,blockId:binding.blockId,sourceHash:binding.sourceHash,
    provider:[...new Set(binding.steps.map((step)=>step.provider))].join(", "),models:[...new Set(binding.steps.map((step)=>step.model))],maximumMicrousd:binding.steps.reduce((sum,step)=>sum+step.maximumMicrousd,0),maximumTokens:binding.steps.reduce((sum,step)=>sum+step.inputTokens+step.outputTokens,0),providerCalls:binding.steps.length,searchCalls:binding.steps.reduce((sum,step)=>sum+step.toolCalls,0),publicQuery:binding.publicQuery,privateInput,status:"quoted"};
  const unresolved=await env.DB.prepare(`SELECT 1 FROM consequential_executions execution WHERE execution.actor_user_id=? AND execution.project_id=? AND execution.document_id=? AND execution.operation=?
    AND ${reusableExecutionSql("execution")} AND execution.status!='completed' AND NOT EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=execution.consent_ref AND content.redacted_at IS NULL AND content.expires_at>?) LIMIT 1`)
    .bind(user.userId,binding.projectId,binding.documentId,binding.operation,now).first();
  if(unresolved)throw new Error("context_existing_request_unavailable");
  if(preview.maximumMicrousd>availableMicrousd)throw new Error("context_budget_unavailable");
  if(!await executionAuthorityCurrent(env,user,binding,sourceHead))throw new Error("context_authorization_changed");
  const publication=(content:{contentId:string})=>[
    env.DB.prepare("INSERT INTO consequential_executions(execution_id,actor_user_id,stream_id,project_id,document_id,organization_id,project_access_id,operation,intent_hash,binding_hash,consent_ref,status,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'quoted',?,?,?)")
      .bind(executionId,user.userId,binding.streamId,binding.projectId,binding.documentId,binding.scope?.organizationId??null,binding.scope?.projectAccessId??null,binding.operation,binding.intentHash,bindingHash,content.contentId,now,expiresAt,now),
    ...binding.steps.map((step,index)=>env.DB.prepare("INSERT INTO consequential_execution_steps(execution_id,step_index,token_reservation_id,cost_reservation_id,maximum_tokens,maximum_microusd,status,updated_at) VALUES(?,?,?,?,?,?,'quoted',?)")
      .bind(executionId,index,`${executionId}:tokens:${index}`,`${executionId}:usd:${index}`,step.inputTokens+step.outputTokens,step.maximumMicrousd,now)),
  ];
  if(publicationEvidence&&!additional)throw new Error("context_quote_source_required");
  if(additional){
    // Native guarded quote: private input, execution and planned steps either
    // publish together or roll back before retaining any copied provider bytes.
    // Source assertions bracket this entire atomic batch. Repeating their
    // bindings inside the private INSERT can exceed D1's per-statement limit
    // for shared multi-turn context; it adds no separate transaction boundary.
    // Native custody/retention checks remain on the private INSERT itself.
    const content=await preparePrivateContent(env,user.userId,"execution-consent",JSON.stringify({binding,preview}),binding.scope??undefined);
    const rows=await env.DB.batch([
      env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE json('context_quote_source_changed') END AS verified`).bind(...guard.bindings),
      ...content.statements,...publication(content),...(publicationEvidence?.(executionId,content.contentId)??[]),
      env.DB.prepare(`SELECT CASE WHEN (${guard.sql}) THEN CASE WHEN EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=?) THEN 1 ELSE json('context_quote_source_changed') END ELSE json('context_quote_source_changed') END AS verified`).bind(...guard.bindings,content.contentId,user.userId),
    ]);
    if(rows.some(row=>!row.success))throw new Error("context_quote_source_changed");
  }else{
    const content=await storePrivateContent(env,user.userId,"execution-consent",JSON.stringify({binding,preview}),binding.scope??undefined);
    await env.DB.batch(publication(content));
  }
  return preview;
}

export async function readConsequentialExecution(env:WorkerEnv,userId:string,id:string){
  return env.DB.prepare("SELECT * FROM consequential_executions WHERE execution_id=? AND actor_user_id=?").bind(id,userId).first<ExecutionRow>();
}
export async function readConsequentialIntentExecution(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,sourceHead:number){
  const guard=executionAdmissionGuard(user,binding,sourceHead);
  return env.DB.prepare(`SELECT * FROM consequential_executions WHERE actor_user_id=? AND intent_hash=? AND ${reusableExecutionSql("consequential_executions")} AND ${guard.sql} ORDER BY created_at LIMIT 1`)
    .bind(user.userId,binding.intentHash,...guard.bindings).first<ExecutionRow>();
}
export async function readConsequentialConsent(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,sourceHead:number,row:ExecutionRow){
  const guard=executionAdmissionGuard(user,binding,sourceHead),custody=executionContentCustodyGuard(binding);
  const content=await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='execution-consent' AND redacted_at IS NULL AND expires_at>? AND ${guard.sql} AND ${custody.sql}`)
    .bind(row.consent_ref,user.userId,new Date().toISOString(),...guard.bindings,...custody.bindings).first<{content:string}>();
  return content?JSON.parse(content.content) as {binding:ConsequentialBinding;preview:ConsequentialPreview}:null;
}
export async function readConsequentialResult(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,sourceHead:number,row:ExecutionRow){
  if(!row.result_ref)return null;
  const guard=executionAdmissionGuard(user,binding,sourceHead),custody=executionContentCustodyGuard(binding);
  const content=await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='context-proposal' AND redacted_at IS NULL AND expires_at>? AND ${guard.sql} AND ${custody.sql}`)
    .bind(row.result_ref,user.userId,new Date().toISOString(),...guard.bindings,...custody.bindings).first<{content:string}>();
  return content?JSON.parse(content.content):null;
}
export async function claimConsequentialExecution(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string,approvedHash:string,sourceHead:number,admissionStatements:Array<ReturnType<WorkerEnv["DB"]["prepare"]>>=[],additional:BudgetReservationGuard={sql:"1",bindings:[]}){
  const hash=await consentHash(binding),row=await readConsequentialExecution(env,user.userId,id);
  if(!row||hash!==approvedHash||row.binding_hash!==hash)return{error:"context_consent_changed",status:409};
  if(row.status!=="quoted")return{row,reused:true};
  const now=new Date().toISOString();
  if(row.expires_at<=now||binding.period!==now.slice(0,7))return{error:"context_consent_expired",status:409};
  const guard=executionAdmissionGuard(user,binding,sourceHead,true);
  const split=9+guard.bindings.length+additional.bindings.length>100;
  const inline=split?{sql:'1',bindings:[]}:additional;
  const statement=env.DB.prepare(`UPDATE consequential_executions SET status='reserved',updated_at=? WHERE execution_id=? AND actor_user_id=? AND status='quoted' AND binding_hash=? AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ?=strftime('%Y-%m','now')
    AND NOT EXISTS(SELECT 1 FROM consequential_executions other WHERE other.actor_user_id=? AND other.intent_hash=? AND other.execution_id!=? AND ${reusableExecutionSql("other")}) AND ${guard.sql} AND (${inline.sql})`)
    .bind(now,id,user.userId,hash,now,binding.period,user.userId,binding.intentHash,id,...guard.bindings,...inline.bindings);
  const checks=split?[env.DB.prepare(`SELECT CASE WHEN (${additional.sql}) THEN 1 ELSE json('context_authorization_changed') END AS verified`).bind(...additional.bindings)]:[];
  // All admission assertions, the CAS and dependent task writes still execute
  // in one atomic transaction; only their per-statement bindings are separated.
  const changed=admissionStatements.length||split?(await env.DB.batch([...checks,statement,...admissionStatements]))[checks.length]!:await statement.run();
  if(Number(changed.meta.changes??0)!==1){
    const existing=await env.DB.prepare(`SELECT * FROM consequential_executions WHERE actor_user_id=? AND intent_hash=? AND ${reusableExecutionSql("consequential_executions")} AND ${guard.sql} LIMIT 1`).bind(user.userId,binding.intentHash,...guard.bindings).first<ExecutionRow>();
    return existing?{row:existing,reused:true}:{error:"context_consent_changed",status:409};
  }
  return{row:{...row,status:"reserved"},reused:false};
}

/** All limits are reserved before any provider step; only this single claimed execution can dispatch. */
function consequentialReservationGuard(userId:string,binding:ConsequentialBinding,id:string,index:number,bindingHash:string,status:"quoted"|"reserved"="reserved"):BudgetReservationGuard{
  const step=binding.steps[index];if(!step)throw new Error("context_invalid_step");
  return{sql:`EXISTS(SELECT 1 FROM consequential_execution_steps step JOIN consequential_executions execution ON execution.execution_id=step.execution_id
    WHERE step.execution_id=? AND step.step_index=? AND step.status=? AND step.token_reservation_id=? AND step.cost_reservation_id=? AND step.maximum_tokens=? AND step.maximum_microusd=?
      AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.status='reserved' AND execution.result_ref IS NULL
      AND execution.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ?=strftime('%Y-%m','now'))`,bindings:[id,index,status,`${id}:tokens:${index}`,`${id}:usd:${index}`,step.inputTokens+step.outputTokens,step.maximumMicrousd,userId,bindingHash,binding.period]};
}
export async function reserveConsequentialSteps(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string,additional:BudgetReservationGuard={sql:"1",bindings:[]}){
  const hash=await consentHash(binding);
  const guarded=(proof:BudgetReservationGuard):BudgetReservationGuard=>({sql:`(${proof.sql}) AND (${additional.sql})`,bindings:[...proof.bindings,...additional.bindings]});
  for(const [index,step] of binding.steps.entries()){
    const correlationId=id,operation=`${binding.operation}:${step.name}:${step.model}`,tokenId=`${id}:tokens:${index}`,costId=`${id}:usd:${index}`;
    // Persist the hold linkage first. A crash cannot make the orphan sweeper release a possibly dispatched step.
    const nativeQuoted=consequentialReservationGuard(user.userId,binding,id,index,hash,"quoted"),quoted=guarded(nativeQuoted);
    const splitQuoted=3+quoted.bindings.length>100,inlineQuoted=splitQuoted?nativeQuoted:quoted;
    const claim=env.DB.prepare(`UPDATE consequential_execution_steps SET status='reserved',updated_at=? WHERE execution_id=? AND step_index=? AND status='quoted' AND ${inlineQuoted.sql}`).bind(new Date().toISOString(),id,index,...inlineQuoted.bindings);
    // Larger retained conversations still replay the entire source proof in
    // the same claim transaction, without exceeding D1's per-statement bound.
    const claimed=splitQuoted?(await env.DB.batch([
      env.DB.prepare(`SELECT CASE WHEN (${additional.sql}) THEN 1 ELSE json('context_execution_not_active') END AS verified`).bind(...additional.bindings),claim,
      env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('context_execution_not_active') END AS verified"),
    ]))[1]!:await claim.run();
    if(Number(claimed.meta.changes??0)!==1)throw new Error("context_execution_not_active");
    const nativeReservation=consequentialReservationGuard(user.userId,binding,id,index,hash);
    const reservationGuard=guarded(nativeReservation);
    // Budget admissions already support native same-transaction assertions.
    // Reserve room for shared custody and pilot counters in their INSERTs;
    // the complete source proof stays inside each reservation transaction.
    const splitReservation=reservationGuard.bindings.length>60;
    const context={batchCounterInitialization:true,streamId:binding.streamId,correlationId,operation,period:binding.period,
      reservationGuard:splitReservation?nativeReservation:reservationGuard,
      ...(splitReservation?{reservationAssertions:[additional]}:{}),
      ...(binding.scope?{projectScope:binding.scope}:{})};
    const token=await reserveBudget(env,user.userId,step.inputTokens+step.outputTokens,{...context,reservationId:tokenId});
    if(!token.ok)throw new Error(token.scope==="authorization"?"context_execution_not_active":"context_token_budget_unavailable");
    const cost=await reserveCostBudget(env,user.userId,step.maximumMicrousd,{...context,reservationId:costId,maximumMicrousd:step.maximumMicrousd,allowUserOverage:false});
    if(!cost.ok)throw new Error(cost.scope==="authorization"?"context_execution_not_active":"context_cost_budget_unavailable");
    if(!await claimCostBudgetReservation(env,user.userId,costId))throw new Error("context_cost_claim_failed");
    if(!await env.DB.prepare(`SELECT 1 AS admitted WHERE ${reservationGuard.sql}`).bind(...reservationGuard.bindings).first())throw new Error("context_execution_not_active");
  }
}

export async function beginConsequentialStep(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string,index:number,sourceHead:number,additional:BudgetReservationGuard={sql:"1",bindings:[]},options:{separateSourceProof?:boolean}={}){
  const guard=executionAdmissionGuard(user,binding,sourceHead,true),reservation=consequentialReservationGuard(user.userId,binding,id,index,await consentHash(binding)),now=new Date().toISOString();
  // Source consumers may also require separation for SQLite expression depth.
  // A shared source can exceed D1's 100-bind limit when proofs combine. Replay in
  // the same atomic batch, never as an earlier positive authorization cache.
  const split=options.separateSourceProof===true||8+reservation.bindings.length+guard.bindings.length+additional.bindings.length>100;
  const inline=split?{sql:"1",bindings:[]}:additional;
  const statement=env.DB.prepare(`UPDATE consequential_execution_steps SET status='submitting',updated_at=? WHERE execution_id=? AND step_index=? AND status='reserved'
    AND ${reservation.sql} AND ${guard.sql} AND (${inline.sql})
    AND NOT EXISTS(SELECT 1 FROM consequential_execution_steps pending WHERE pending.execution_id=? AND(pending.status NOT IN('reserved','usage-recorded','settled')
      OR pending.status='reserved' AND(NOT EXISTS(SELECT 1 FROM budget_reservations tokens WHERE tokens.reservation_id=pending.token_reservation_id AND tokens.owner_id=? AND tokens.status='active' AND tokens.period=? AND tokens.reserved_tokens=pending.maximum_tokens)
        OR NOT EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=pending.cost_reservation_id AND cost.owner_id=? AND cost.status='executing' AND cost.period=? AND cost.reserved_microusd=pending.maximum_microusd))))`)
    .bind(now,id,index,...reservation.bindings,...guard.bindings,...inline.bindings,id,user.userId,binding.period,user.userId,binding.period);
  const changed=split?(await env.DB.batch([
    env.DB.prepare(`SELECT CASE WHEN (${additional.sql}) THEN 1 ELSE abs(-9223372036854775808) END AS verified`).bind(...additional.bindings),
    statement,
    env.DB.prepare('SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END AS verified'),
  ]))[1]!:await statement.run();
  if(Number(changed.meta.changes??0)!==1)throw new Error("context_authorization_changed");
}
export async function settleConsequentialStep(env:WorkerEnv,userId:string,id:string,index:number,tokens:number,microusd:number,providerRequestId:string|null,options:{atomicSpecialistPair?:boolean}={}){
  // Verified usage is saved before either ledger write; recovery can finish an interrupted settlement without another paid request.
  const recorded=await env.DB.prepare(`UPDATE consequential_execution_steps SET status='usage-recorded',verified_tokens=?,verified_microusd=?,provider_request_id=?,updated_at=? WHERE execution_id=? AND step_index=? AND status IN('submitting','uncertain')
    AND EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=consequential_execution_steps.execution_id AND execution.actor_user_id=?)`)
    .bind(tokens,microusd,providerRequestId,new Date().toISOString(),id,index,userId).run();
  if(Number(recorded.meta.changes??0)!==1){const retained=await env.DB.prepare(`SELECT step.status,step.verified_tokens,step.verified_microusd,step.provider_request_id,
      EXISTS(SELECT 1 FROM budget_reservations tokens JOIN cost_budget_reservations cost
        ON cost.reservation_id=? AND cost.owner_id=tokens.owner_id AND cost.status='settled' AND cost.used_microusd=step.verified_microusd
        WHERE tokens.reservation_id=? AND tokens.owner_id=execution.actor_user_id AND tokens.status='settled' AND tokens.used_tokens=step.verified_tokens) AS ledgers_settled
      FROM consequential_execution_steps step JOIN consequential_executions execution ON execution.execution_id=step.execution_id
    WHERE step.execution_id=? AND step.step_index=? AND execution.actor_user_id=?`).bind(`${id}:usd:${index}`,`${id}:tokens:${index}`,id,index,userId)
      .first<{status:string;verified_tokens:number;verified_microusd:number;provider_request_id:string|null;ledgers_settled:number}>();
    if(!retained||!["usage-recorded","settled"].includes(retained.status)||retained.verified_tokens!==tokens||retained.verified_microusd!==microusd||retained.provider_request_id!==providerRequestId)throw new Error("context_provider_usage_conflict");
    // A repeated exact receipt needs no ledger mutations. This is a fresh joined
    // database observation, never a request/process-local settlement cache.
    // Partial or mismatched ledgers still go through ordinary reconciliation.
    if(retained.status==='settled'&&retained.ledgers_settled===1)return;
  }
  if(options.atomicSpecialistPair){await settleSpecialistBudgetPair(env,userId,id,index,tokens,microusd,providerRequestId);return;}
  await settleBudget(env,userId,`${id}:tokens:${index}`,tokens);
  await settleCostBudget(env,userId,`${id}:usd:${index}`,microusd);
  if(!await consequentialUsageSettled(env,userId,id,index,tokens,microusd))throw new Error("context_billing_reconciliation_pending");
  await env.DB.prepare("UPDATE consequential_execution_steps SET status='settled',updated_at=? WHERE execution_id=? AND step_index=? AND status='usage-recorded'").bind(new Date().toISOString(),id,index).run();
}

/** Only the executor that just won beginConsequentialStep may call this, before invoking fetch. */
export async function proveConsequentialStepNotSubmitted(env:WorkerEnv,userId:string,id:string,index:number,bindingHash:string){
  await env.DB.prepare(`UPDATE consequential_execution_steps SET status='not-submitted',updated_at=?
    WHERE execution_id=? AND step_index=? AND status IN('submitting','uncertain')
      AND verified_tokens IS NULL AND verified_microusd IS NULL AND provider_request_id IS NULL
      AND EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=consequential_execution_steps.execution_id
        AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.status!='completed' AND execution.result_ref IS NULL)`)
    .bind(new Date().toISOString(),id,index,userId,bindingHash).run();
}

/** A concurrent reconciler may win a settlement CAS. The durable exact rows, not a stale return value, are authoritative. */
export async function consequentialUsageSettled(env:WorkerEnv,userId:string,id:string,index:number,tokens:number,microusd:number){
  return Boolean(await env.DB.prepare(`SELECT 1 AS settled FROM budget_reservations tokens JOIN cost_budget_reservations cost
    ON cost.reservation_id=? AND cost.owner_id=tokens.owner_id AND cost.status='settled' AND cost.used_microusd=?
    WHERE tokens.reservation_id=? AND tokens.owner_id=? AND tokens.status='settled' AND tokens.used_tokens=?`)
    .bind(`${id}:usd:${index}`,microusd,`${id}:tokens:${index}`,userId,tokens).first());
}
async function releaseStoppedConsequentialSteps(env:WorkerEnv,userId:string,id:string){
  const stopped=await env.DB.prepare(`SELECT step.step_index FROM consequential_execution_steps step JOIN consequential_executions execution ON execution.execution_id=step.execution_id
    WHERE step.execution_id=? AND execution.actor_user_id=? AND step.status='not-submitted' AND execution.status IN('failed','uncertain') AND execution.result_ref IS NULL`).bind(id,userId).all<{step_index:number}>();
  for(const step of stopped.results){await releaseBudget(env,userId,`${id}:tokens:${step.step_index}`,{reason:"context_provider_not_submitted"});await releaseCostBudget(env,userId,`${id}:usd:${step.step_index}`);}
}
export async function failConsequentialExecution(env:WorkerEnv,userId:string,id:string,error:string,authorizedStop?:{guard:BudgetReservationGuard;finalStatements:Array<ReturnType<WorkerEnv["DB"]["prepare"]>>}){
  const now=new Date().toISOString(),unfinished="EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=consequential_execution_steps.execution_id AND execution.actor_user_id=? AND execution.status!='completed' AND execution.result_ref IS NULL)";
  const guard=authorizedStop?.guard,suffix=guard?" AND ("+guard.sql+")":"",bindings=guard?.bindings??[];
  // An explicit Stop supplies current authority/custody plus its final CHECK in this same batch.
  // Automatic failure callers keep their existing SQL and release behavior.
  await env.DB.batch([
    env.DB.prepare(`UPDATE consequential_execution_steps SET status='not-submitted',updated_at=? WHERE execution_id=? AND status IN('quoted','reserved') AND ${unfinished}${suffix}`).bind(now,id,userId,...bindings),
    env.DB.prepare(`UPDATE consequential_execution_steps SET status='uncertain',updated_at=? WHERE execution_id=? AND status='submitting' AND ${unfinished}${suffix}`).bind(now,id,userId,...bindings),
    env.DB.prepare(`UPDATE consequential_executions SET status=CASE WHEN EXISTS(SELECT 1 FROM consequential_execution_steps step WHERE step.execution_id=consequential_executions.execution_id AND step.status IN('submitting','uncertain','usage-recorded')) THEN 'uncertain' ELSE 'failed' END,error_code=?,updated_at=? WHERE execution_id=? AND actor_user_id=? AND status!='completed' AND result_ref IS NULL${suffix}`).bind(error,now,id,userId,...bindings),
    ...(authorizedStop?.finalStatements??[]),
  ]);
  // No release is reached if the atomic authorization/custody CHECK rejects this Stop.
  await releaseStoppedConsequentialSteps(env,userId,id);
  return(await readConsequentialExecution(env,userId,id))?.status==="uncertain";
}
export async function completeConsequentialExecution(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string,result:unknown,proof:BudgetReservationGuard={sql:"1",bindings:[]},evidence?:{precommit:()=>D1PreparedStatement[];publish:(contentId:string)=>D1PreparedStatement[];complete?:(contentId:string)=>D1PreparedStatement[]}){
  const existing=await readConsequentialExecution(env,user.userId,id);if(existing?.result_ref)return existing;
  const hash=await consentHash(binding),authority=executionAdmissionGuard(user,{...binding,contextSessionId:null,pilotCohortId:null},null);
  const accounted={sql:`EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.result_ref IS NULL AND execution.status IN('reserved','uncertain','failed')
    AND(SELECT COUNT(*) FROM consequential_execution_steps step WHERE step.execution_id=execution.execution_id)=?
    AND NOT EXISTS(SELECT 1 FROM consequential_execution_steps step WHERE step.execution_id=execution.execution_id AND step.status NOT IN('usage-recorded','settled'))) AND ${authority.sql} AND (${proof.sql})`,bindings:[id,user.userId,hash,binding.steps.length,...authority.bindings,...proof.bindings]};
  const serialized=JSON.stringify(result),custody=executionContentCustodyGuard(binding);
  const complete=(contentId:string,atomic=false)=>env.DB.prepare(`UPDATE consequential_executions SET status='completed',result_ref=?,error_code=NULL,updated_at=? WHERE execution_id=? AND actor_user_id=? AND ${atomic?"result_ref IS NULL AND status IN('reserved','uncertain','failed')":accounted.sql}
    AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='context-proposal' AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql})`)
    .bind(contentId,new Date().toISOString(),id,user.userId,...(atomic?[]:accounted.bindings),contentId,user.userId,serialized,...custody.bindings);
  if(evidence){
    const content=await preparePrivateContent(env,user.userId,'context-proposal',serialized,binding.scope??undefined);
    // Retain the entire accounting/source proof immediately before completion,
    // in the same atomic transaction as the copy and its inverse registration.
    const verified=env.DB.prepare(`SELECT CASE WHEN (${accounted.sql}) THEN 1 ELSE json('context_result_not_retained') END AS verified`).bind(...accounted.bindings);
    const statements=[...evidence.precommit(),...content.statements,...evidence.publish(content.contentId),verified,complete(content.contentId,true),
      env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('context_result_not_retained') END AS verified"),...(evidence.complete?.(content.contentId)??[])];
    const rows=structuredClone(await env.DB.batch(statements));
    if(!Array.isArray(rows)||rows.length!==statements.length||!Array.from(rows).every(row=>row&&row.success===true&&(!('error' in row)||row.error===undefined)&&Array.isArray(row.results)
      &&row.results.every(value=>value&&typeof value==='object'&&(!Object.hasOwn(value,'verified')||Object.keys(value).length===1&&(value as Record<string,unknown>).verified===1)))
      ||rows.at(-1)?.results.length!==1||(rows.at(-1)?.results[0] as Record<string,unknown>)?.verified!==1)throw new Error('context_result_not_retained');
  }else{
    const content=await storePrivateContent(env,user.userId,'context-proposal',serialized,binding.scope??undefined,accounted);
    await complete(content.contentId).run();
  }
  const current=await readConsequentialExecution(env,user.userId,id);if(!current?.result_ref)throw new Error("context_result_not_retained");return current;
}

/** Finish only a previously verified ledger write. This never dispatches, estimates usage, or releases an unknown submission. */
export async function reconcileConsequentialUsage(env:WorkerEnv,userId:string,id:string,options:{atomicSpecialistPair?:boolean}={}){
  // One bounded metadata snapshot replaces three no-op calls on the common
  // reserved/settled path. This is work selection, never settlement authority:
  // ledger mutations still independently enforce owner, state and exact usage.
  const db=env.DB,selected=await db.prepare(`SELECT execution.status AS execution_status,execution.result_ref,
    step.step_index,step.status AS step_status,step.verified_tokens,step.verified_microusd
    FROM consequential_executions execution LEFT JOIN consequential_execution_steps step
      ON step.execution_id=execution.execution_id AND step.status IN('not-submitted','usage-recorded')
    WHERE execution.execution_id=? AND execution.actor_user_id=? ORDER BY step.step_index LIMIT 65`)
    .bind(id,userId).all<{execution_status:string;result_ref:string|null;step_index:number|null;step_status:string|null;verified_tokens:number|null;verified_microusd:number|null}>();
  if(env.DB!==db||selected.success!==true||('error' in selected&&selected.error!==undefined)||!Array.isArray(selected.results)||selected.results.length>64
    ||new Set(selected.results.map(row=>row?.step_index)).size!==selected.results.length
    ||selected.results.some(row=>!row||Object.keys(row).sort().join(',')!=='execution_status,result_ref,step_index,step_status,verified_microusd,verified_tokens'
      ||row.execution_status!==selected.results[0]!.execution_status||row.result_ref!==selected.results[0]!.result_ref
      ||!['quoted','reserved','uncertain','completed','failed','expired','canceled'].includes(row.execution_status)
      ||row.result_ref!==null&&typeof row.result_ref!=='string'
      ||row.step_index!==null&&(!Number.isSafeInteger(row.step_index)||row.step_index<0||!['not-submitted','usage-recorded'].includes(String(row.step_status)))
      ||row.step_index===null&&(selected.results.length!==1||row.step_status!==null||row.verified_tokens!==null||row.verified_microusd!==null)))throw Error('context_billing_reconciliation_unavailable');
  for(const step of selected.results){
    if(step.step_status==='not-submitted'&&['failed','uncertain'].includes(step.execution_status)&&step.result_ref===null){
      await releaseBudget(env,userId,`${id}:tokens:${step.step_index}`,{reason:"context_provider_not_submitted"});
      await releaseCostBudget(env,userId,`${id}:usd:${step.step_index}`);
    }
  }
  for(const step of selected.results){
    if(step.step_status!=='usage-recorded'||step.step_index===null)continue;
    if(typeof step.verified_tokens!=='number'||!Number.isSafeInteger(step.verified_tokens)||step.verified_tokens<0
      ||typeof step.verified_microusd!=='number'||!Number.isSafeInteger(step.verified_microusd)||step.verified_microusd<0)continue;
    if(options.atomicSpecialistPair){
      const receipt=await env.DB.prepare('SELECT provider_request_id FROM consequential_execution_steps WHERE execution_id=? AND step_index=?').bind(id,step.step_index).first<{provider_request_id:string|null}>();
      if(!receipt||receipt.provider_request_id!==null&&typeof receipt.provider_request_id!=='string')throw Error('context_billing_reconciliation_unavailable');
      await settleSpecialistBudgetPair(env,userId,id,step.step_index,step.verified_tokens,step.verified_microusd,receipt.provider_request_id);continue;
    }
    await settleBudget(env,userId,`${id}:tokens:${step.step_index}`,step.verified_tokens);
    await settleCostBudget(env,userId,`${id}:usd:${step.step_index}`,step.verified_microusd);
    if(!await consequentialUsageSettled(env,userId,id,step.step_index,step.verified_tokens,step.verified_microusd))continue;
    await env.DB.prepare("UPDATE consequential_execution_steps SET status='settled',updated_at=? WHERE execution_id=? AND step_index=? AND status='usage-recorded'").bind(new Date().toISOString(),id,step.step_index).run();
  }
  if(selected.results.some(row=>row.execution_status==='uncertain'))await env.DB.prepare(`UPDATE consequential_executions SET status=CASE WHEN result_ref IS NOT NULL THEN 'completed' ELSE 'failed' END,updated_at=?
    WHERE execution_id=? AND actor_user_id=? AND status='uncertain' AND NOT EXISTS(SELECT 1 FROM consequential_execution_steps step
      WHERE step.execution_id=consequential_executions.execution_id AND step.status IN('reserved','submitting','uncertain','usage-recorded'))`).bind(new Date().toISOString(),id,userId).run();
}

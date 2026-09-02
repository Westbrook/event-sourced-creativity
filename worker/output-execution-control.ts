import { prepareProviderSuccess } from "./generation-readiness.ts";
import { prepareOutputNativeProjectPublicationStatements } from "./output-native-project-publication.ts";
import { guardOutputPrivateWrites, reconcileOutputNativeStorage } from "./output-private-execution.ts";
import type { ProviderFailureDetail } from "./provider-errors.ts";
import type { PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { providerSubmissions } from "../src/model/provider-submission.ts";
import type { ImageFormat } from "../src/model/image-format.ts";
import { eventWriteBindings, type EventRow, type WorkerEnv } from "./runtime.ts";
import { documentJobProjectAuthority, type DocumentJobRow } from "./document-jobs-api.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import { settleBudget, settleCostBudget, settleDocumentGenerationBudgets, type PilotUser } from "./pilot-policy.ts";
import { outputDigest, resolveOutputExecutionAuthority, prepareOutputExecutionProof } from "./output-requirements-api.ts";
import { preflightOutputNativeTarget, type OutputNativeSettings } from "./output-document-execution.ts";
import { claimOutputProviderCall, settleOutputProviderCall, readOutputSlots, outputSlotFromRow, outputScopeAuthority, outputAssertionStatements, OutputConflictError, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { authoritativeCreativeContext } from "./context-authority.ts";
import { priceTextUsageBreakdownMicrousd, priceImageUsageBreakdownMicrousd } from "./replay-cost.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";

const parsed=(raw:string|null|undefined):Record<string,unknown>=>{try{const value:unknown=JSON.parse(raw??"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}catch{return{};}};
export type OutputJobBinding={scope:OutputScope;slot:OutputOperationSlot;retentionPolicy:Record<string,unknown>|null};
export type OutputExecutionProof=ReturnType<typeof prepareOutputExecutionProof>;
export type OutputEventExecution={
 guardedEnvironment:WorkerEnv;
 accountSettlement?:{reservation_id:string;reserved_microusd:number;used_microusd:number;status:string};
 sourceEvents:EventRow[];sourceHead:number;
 eventAppendCommitted:(events:EventRow[])=>Promise<boolean>;
 eventWriteSidecars?:(events:EventRow[])=>D1PreparedStatement[];
 eventWriteCommitted?:(results:D1Result[])=>void;
 publicationScopesComplete?:()=>boolean;
 reference:{scopeKey:string;grantId:string;slotId:string;planRevisionId:string;targetId:string;targetContractDigest:string;sourceDigest:string};
 settings:Record<string,unknown>;
 imageRender?:{format:ImageFormat;size:`${number}x${number}`};
 reservations:{reservationId:string;costReservationId:string;costReservationPeriod:string;costReservationMicrousd:number;maximumTokens:number};
 assertContext:(context:ReturnType<typeof authoritativeCreativeContext>)=>Promise<void>;
 beforeSourceTransmission:()=>Promise<void>;
 beforeProviderAttempt:(attempt:ProviderAttemptPreflight)=>Promise<void>;
 beforeProviderDispatch:(clientRequestId:string)=>void;
 dispatchStop:(error:unknown)=>ProviderFailureDetail|null;
 observeProvider:(receipt:PaidProviderSubmission)=>Promise<void>;
};

/** The durable slot, not an expiring request JSON property, determines execution. */
export async function loadOutputJobBinding(env:WorkerEnv,user:PilotUser,job:Pick<DocumentJobRow,"job_id"|"owner_id"|"stream_id"|"document_id"|"request_json"|"output_slot_id">):Promise<OutputJobBinding|null>{
 if(job.output_slot_id===null)return null;
 const row=await env.DB.prepare(`SELECT slot.*,plan.scope_kind,plan.owner_user_id,plan.project_id,plan.document_id,plan.organization_id,plan.project_access_id,grant_row.actor_user_id,grant_row.context_id,(SELECT json_object('transient_days',policy.transient_days,'evidence_days',policy.evidence_days,'version',policy.version) FROM organization_retention_policies policy WHERE policy.organization_id=plan.organization_id) AS retention_policy_json
  FROM output_operation_slots slot JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id WHERE slot.job_id=?`).bind(job.job_id).first<Record<string,unknown>>();
 if(!row){if(parsed(job.request_json).outputExecution)throw new OutputConflictError("output_job_binding_missing",403);return null;}
 if(job.owner_id!==user.userId||row.actor_user_id!==user.userId||job.stream_id!==`creative:${row.owner_user_id}`||job.document_id!==row.document_id)throw new OutputConflictError("output_job_scope_mismatch",403);
 const scope:OutputScope={kind:row.scope_kind as OutputScope["kind"],key:String(row.scope_key),ownerUserId:String(row.owner_user_id),actorUserId:user.userId,projectId:String(row.project_id),documentId:String(row.document_id),organizationId:row.organization_id===null?null:String(row.organization_id),projectAccessId:row.project_access_id===null?null:String(row.project_access_id),contextId:typeof row.context_id==="string"?row.context_id:null};
 if(scope.kind==="project"&&(!scope.contextId||!user.projectExecution||user.projectExecution.organizationId!==scope.organizationId||user.projectExecution.projectAccessId!==scope.projectAccessId||user.projectExecution.actorUserId!==scope.actorUserId)||scope.kind==="personal"&&user.projectExecution)throw new OutputConflictError("output_job_scope_mismatch",403);
 const slot=outputSlotFromRow(scope.key,row);
 return {scope,slot,retentionPolicy:typeof row.retention_policy_json==="string"?parsed(row.retention_policy_json):null};
}

/** Current source/target/route eligibility is checked again before each transfer and paid call. */
export async function createOutputEventExecution(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,binding:OutputJobBinding,preparedProof?:OutputExecutionProof):Promise<OutputEventExecution>{
 const {scope,slot}=binding;
 if(!["queued","running"].includes(slot.status))throw new OutputConflictError("output_operation_not_started",409);
 const authority=preparedProof??prepareOutputExecutionProof(scope,await resolveOutputExecutionAuthority(env,scope,slot));
 const current=await preflightOutputNativeTarget({env,request:new Request("https://output-execution.invalid"),scope,principal:user,confirmedPlan:authority.confirmedPlan,target:authority.target,context:authority.context,sourceDigest:authority.sourceDigest,requirementsDigest:authority.requirementsDigest});
 if(!current.available||await outputDigest(current)!==slot.routeDigest)throw new OutputConflictError("output_native_route_changed",409);
 const projectJobAuthority=documentJobProjectAuthority(user,job.document_id,job.job_id);
 const liveAssertions=()=>[...authority.assertions,...(projectJobAuthority?[projectJobAuthority]:[]),outputScopeAuthority(scope,"request"),{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND (status IN('running','committing') AND lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND lease_expires_at>=? OR status='completed'))",bindings:[job.job_id,user.userId,job.stream_id,job.correlation_id,new Date().toISOString(),job.lease_expires_at]},{sql:"EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS ? AND status IN('authorized','active') AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))",bindings:[scope.key,slot.grantId,scope.actorUserId,scope.contextId,new Date().toISOString()]}];
 const settings=authority.targetPreflight.settings as OutputNativeSettings;
 if(settings.kind!==job.kind)throw new OutputConflictError("output_job_route_mismatch",403);
 const billingOwner=user.billingUserId??user.userId;
 const checkpoint=parsed(job.result_json);
 const period=checkpoint.costReservationPeriod;
 const operation=job.kind==="generate"?"image-generation":"document-render:slides";
 if(typeof period!=="string"||!/^\d{4}-\d{2}$/u.test(period)||checkpoint.reservationId!==slot.tokenReservationId||checkpoint.costReservationId!==slot.costReservationId||checkpoint.costReservationMicrousd!==slot.maximumMicrousd)throw new OutputConflictError("output_admitted_reservations_missing",409);
 const periodDeadline=Date.parse(`${period}-01T00:00:00.000Z`);
 const nextPeriod=Number.isFinite(periodDeadline)?new Date(periodDeadline):null;
 nextPeriod?.setUTCMonth(nextPeriod.getUTCMonth()+1);
 const dispatchDeadline=Math.min(nextPeriod?.getTime()??0,...authority.assertions.flatMap(assertion=>assertion.deadlineMs===undefined?[]:[Number.isFinite(assertion.deadlineMs)?assertion.deadlineMs:0]));
 let dispatchStopError:OutputConflictError|null=null;
 const assertDispatchDeadline=()=>{if(dispatchStopError)throw dispatchStopError;const leaseDeadline=Date.parse(String(job.lease_expires_at));if(!Number.isFinite(dispatchDeadline)||!Number.isFinite(leaseDeadline)||Date.now()>=Math.min(dispatchDeadline,leaseDeadline)){
  dispatchStopError=new OutputConflictError("output_execution_deadline_expired",403);throw dispatchStopError;
 }};
 const claimedCalls=new Map<string,{callKey:string;provider:string;model:string;operation:string;pending:boolean;dispatched:boolean}>();
 const observedReceipts=new Map(providerSubmissions(checkpoint).map(receipt=>[receipt.clientRequestId,receipt]));
 const reference={scopeKey:slot.scopeKey,grantId:slot.grantId,slotId:slot.slotId,planRevisionId:slot.planRevisionId,targetId:slot.targetId,targetContractDigest:slot.targetContractDigest,sourceDigest:slot.sourceDigest};
 const guardedEnvironment=guardOutputPrivateWrites(env,scope,slot,async()=>liveAssertions(),{retentionPolicy:binding.retentionPolicy});
 let publicationScopesComplete=scope.kind==="personal";
 return {guardedEnvironment,
  dispatchStop:error=>dispatchStopError!==null&&error===dispatchStopError?{code:"output_execution_deadline_expired",category:"access",scope:"project",action:"check_project",
   message:"The current source or execution authorization expired before this provider call could be sent. Earlier usage and unresolved allowances are retained; check current access before starting other work.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:403}:null,
  sourceEvents:authority.events,sourceHead:authority.head,
  async eventAppendCommitted(events){
   if(!events.length||events.length>8||events.some(event=>event.streamId!==job.stream_id||event.correlationId!==job.correlation_id))return false;
   const checks=events.map(event=>{const values=eventWriteBindings(event);
    return env.DB.prepare(`SELECT 1 AS present FROM events stored LEFT JOIN event_private_payloads body ON body.private_event_id=stored.event_id
      WHERE stored.event_id=? AND stored.stream_id=? AND stored.sequence=? AND stored.occurred_at=? AND stored.recorded_at=?
       AND stored.actor=? AND stored.client_id=? AND stored.correlation_id=? AND stored.causation_id IS ? AND stored.compensates_event_id IS ? AND stored.schema_version=? AND stored.type=? AND stored.payload=?
       AND (? IS NULL AND body.private_event_id IS NULL OR ? IS NOT NULL AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ? AND body.private_json=? AND body.redacted_at IS NULL)`)
     .bind(...values.slice(0,13),values[16],values[16],values[13],values[14],values[15],values[16]);
   });
   try{const results=await env.DB.batch([...liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)),...checks]);return results.slice(-checks.length).every(result=>result.results.length===1);}
   catch{return false;}
  },
  eventWriteSidecars:events=>[
   // Shared publication already checks its entire range in the project
   // sidecars. Personal jobs need the same rollback when a concurrent open
   // advances the head between individual guarded event INSERTs.
   ...(scope.kind==="personal"&&events.length?outputAssertionStatements(env,{sql:`(SELECT COUNT(*) FROM events WHERE event_id IN(SELECT value FROM json_each(?)))=?
     OR (NOT EXISTS(SELECT 1 FROM events WHERE event_id IN(SELECT value FROM json_each(?))) AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)<>?)`,
    bindings:[JSON.stringify(events.map(event=>event.eventId)),events.length,JSON.stringify(events.map(event=>event.eventId)),job.stream_id,events[0]!.sequence-1]}):[]),
   ...(events.some(event=>event.type==="GenerationCompleted"||event.type==="DocumentRenderCompleted")?[prepareProviderSuccess(env).statement]:[]),...prepareOutputNativeProjectPublicationStatements(env,{scope,slot,job},events)],
  eventWriteCommitted:results=>{if(scope.kind==="project")publicationScopesComplete=Number(results.at(-1)?.meta.changes??0)===1;},
  publicationScopesComplete:()=>publicationScopesComplete,reference,settings:settings.payload,...(settings.imageRender?{imageRender:settings.imageRender}:{}),reservations:{reservationId:slot.tokenReservationId,costReservationId:slot.costReservationId,costReservationPeriod:period,costReservationMicrousd:slot.maximumMicrousd,maximumTokens:slot.maximumTokens},
  async assertContext(context){if(context.documentRevision!==authority.context.documentRevision||await outputDigest(context.snapshot)!==await outputDigest(authority.context.snapshot))throw new OutputConflictError("output_source_changed",409);},
  async beforeSourceTransmission(){await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));},
  async beforeProviderAttempt(attempt){
   assertDispatchDeadline();
   const callKey=attempt.logicalCallKey;
   const route=settings.calls.find(route=>route.stage===callKey);
   if(!callKey||!route||route.model!==attempt.model||!attempt.requestDigest||!Number.isSafeInteger(attempt.maximumInputTokens)||!Number.isSafeInteger(attempt.maximumOutputTokens)||attempt.maximumInputTokens<0||attempt.maximumOutputTokens<0)throw new OutputConflictError("output_provider_stage_not_authorized",403);
   if(settings.kind==="render_document"&&(!route.presentationRoute||!attempt.presentationRoute
    ||!Number.isSafeInteger(route.maximumInputTokens)||attempt.maximumInputTokens>Number(route.maximumInputTokens)
    ||attempt.maximumOutputTokens!==route.maximumOutputTokens
    ||await outputDigest(attempt.presentationRoute)!==await outputDigest(route.presentationRoute)))throw new OutputConflictError("output_provider_route_changed",403);
   const priorTokens=[...observedReceipts.values()].filter(receipt=>receipt.status==="completed").reduce((sum,receipt)=>sum+Number(receipt.totalTokens??0),0);
   if(priorTokens+attempt.maximumInputTokens+attempt.maximumOutputTokens>slot.maximumTokens)throw new OutputConflictError("output_token_allowance_exceeded",429);
   const maximumUsage={inputTokens:attempt.maximumInputTokens,outputTokens:attempt.maximumOutputTokens,totalTokens:attempt.maximumInputTokens+attempt.maximumOutputTokens};
   const pricedMaximum=route.presentationRoute?estimateOpenAITextCallMaximumMicrousd(attempt.model,attempt.maximumInputTokens,attempt.maximumOutputTokens)
    :callKey.startsWith("planning")?priceTextUsageBreakdownMicrousd(attempt.model,maximumUsage).totalMicrousd:priceImageUsageBreakdownMicrousd(attempt.model,{...maximumUsage,textInputTokens:attempt.maximumInputTokens,imageInputTokens:0},false).totalMicrousd;
   if(pricedMaximum>route.maximumMicrousd)throw new OutputConflictError("output_call_cost_allowance_exceeded",429);
   const assertions:OutputSqlAssertion[]=[...liveAssertions(),{sql:`EXISTS(SELECT 1 FROM document_jobs live WHERE live.job_id=? AND live.owner_id=? AND live.stream_id=? AND live.correlation_id=? AND live.attempt_count=? AND live.status='running'
      AND live.lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(live.result_json,'$.providerSubmissions'),'{}')) receipt
        WHERE json_extract(receipt.value,'$.status')='completed' AND (COALESCE(json_type(receipt.value,'$.totalTokens'),'')<>'integer' OR json_extract(receipt.value,'$.totalTokens')<0))
      AND (SELECT COALESCE(SUM(CASE WHEN json_extract(receipt.value,'$.status')='completed' THEN json_extract(receipt.value,'$.totalTokens') ELSE 0 END),0)
        FROM json_each(COALESCE(json_extract(live.result_json,'$.providerSubmissions'),'{}')) receipt)+?<=?)`,bindings:[job.job_id,user.userId,job.stream_id,job.correlation_id,job.attempt_count,new Date().toISOString(),attempt.maximumInputTokens+attempt.maximumOutputTokens,slot.maximumTokens]},
    {sql:`EXISTS(SELECT 1 FROM cost_budget_reservations cost JOIN budget_reservations token
      ON token.owner_id=cost.owner_id AND token.stream_id=cost.stream_id AND token.correlation_id=cost.correlation_id AND token.period=cost.period AND token.operation=cost.operation
      WHERE cost.reservation_id=? AND token.reservation_id=? AND cost.owner_id=? AND cost.stream_id=? AND cost.correlation_id=? AND cost.operation=? AND cost.period=?
       AND cost.reserved_microusd=? AND token.reserved_tokens=? AND cost.status='executing' AND token.status='active')`,bindings:[slot.costReservationId,slot.tokenReservationId,billingOwner,job.stream_id,job.correlation_id,operation,period,slot.maximumMicrousd,slot.maximumTokens]}];
   const claim=await claimOutputProviderCall(env,{scope,slotId:slot.slotId,jobId:slot.jobId,callKey,clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest,routeDigest:slot.routeDigest,stageKey:callKey,provider:route.provider,model:route.model,maximumMicrousd:route.maximumMicrousd,expectedHead:authority.head,sourceEpoch:authority.sourceEpoch,sourceDigest:authority.sourceDigest,assertions});
   if(!claim.claimed)throw new OutputConflictError("output_provider_call_already_consumed",409);
   claimedCalls.set(attempt.clientRequestId,{callKey,provider:route.provider,model:route.model,operation:callKey.startsWith("planning:")?"planning":"image",pending:false,dispatched:false});
  },
  beforeProviderDispatch(clientRequestId){
   const call=claimedCalls.get(clientRequestId);
   if(!call||!call.pending||call.dispatched)throw new OutputConflictError("output_provider_call_missing",403);
   // No await may separate this check from the actual adapter fetch. A denial
   // leaves the existing pending call/holds unresolved; it is not a provider rejection.
   assertDispatchDeadline();call.dispatched=true;
  },
  async observeProvider(receipt){
   const call=claimedCalls.get(receipt.clientRequestId);
   if(!call||receipt.provider!==call.provider||receipt.model!==call.model||receipt.operation!==call.operation)throw new OutputConflictError("output_provider_call_missing",403);
   // The immutable pending call already exists before the adapter's legacy
   // checkpoint. A failed checkpoint keeps that durable exposure reserved.
   if(receipt.status==="pending"){call.pending=true;return;}
   // The independent operational checkpoint contains payment identities/counts only.
   // It remains writable after erasure and never copies an in-memory source/result body.
   const safe:Record<string,unknown>={clientRequestId:receipt.clientRequestId,provider:receipt.provider,operation:receipt.operation,model:receipt.model,status:receipt.status};
   if(receipt.providerRequestId)safe.providerRequestId=receipt.providerRequestId;
   for(const key of ["costMicrousd","inputTokens","outputTokens","totalTokens"] as const)if(Number.isSafeInteger(receipt[key])&&Number(receipt[key])>=0)safe[key]=receipt[key];
   observedReceipts.set(receipt.clientRequestId,receipt);
   const planning=[...observedReceipts.values()].filter(value=>value.operation==="planning"&&value.status==="completed");
   const plannerFields=receipt.operation==="planning"&&receipt.status==="completed"?{plannerModel:receipt.model,plannerResponseId:receipt.providerRequestId??"",plannerResponseIds:planning.map(value=>value.providerRequestId).filter(Boolean),plannerUsage:planning.reduce((total,value)=>({inputTokens:total.inputTokens+Number(value.inputTokens??0),outputTokens:total.outputTokens+Number(value.outputTokens??0),totalTokens:total.totalTokens+Number(value.totalTokens??0)}),{inputTokens:0,outputTokens:0,totalTokens:0})}:{};
   const financial={...plannerFields,providerSubmissionProtocol:1,providerSubmissions:{[receipt.clientRequestId]:safe},reservationId:slot.tokenReservationId,costReservationId:slot.costReservationId,costReservationPeriod:period,costReservationMicrousd:slot.maximumMicrousd,
    ...(job.kind==="render_document"?{presentationProviderSubmission:"confirmed"}:{}),
    generationReceipt:{provider:receipt.provider,model:receipt.model,artifact_kind:job.kind==="generate"?"image":"slides",provider_request_status:"submitted",source_transmission_status:"transmitted",reservation_status:"executing"}};
   await env.DB.prepare("UPDATE document_jobs SET result_json=json_patch(COALESCE(result_json,'{}'),?),updated_at=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=?")
    .bind(JSON.stringify(financial),new Date().toISOString(),job.job_id,user.userId,job.stream_id,job.correlation_id).run();
   const known=Number.isSafeInteger(receipt.costMicrousd)&&Number(receipt.costMicrousd)>=0;
   await settleOutputProviderCall(env,{scopeKey:scope.key,slotId:slot.slotId,callKey:call.callKey,clientRequestId:receipt.clientRequestId,status:receipt.status==="rejected"?"rejected":receipt.status==="completed"&&known?"settled":"uncertain",usedMicrousd:receipt.status==="rejected"?0:receipt.status==="completed"&&known?Number(receipt.costMicrousd):null,...(receipt.providerRequestId?{providerResponseId:receipt.providerRequestId}:{})});
   // Subsequent private progress/candidate writes carry the same live SQL proof;
   // retaining this monetary witness does not itself authorize any private write.
  },
 };
}

/** Projection only: job/receipt truth wins and never creates a new grant or job. */
export function prepareOutputJobOutcomeStatements(env:WorkerEnv,job:Pick<DocumentJobRow,"job_id"|"stream_id"|"correlation_id">){
 const now=new Date().toISOString();
 const slotUpdate=env.DB.prepare(`UPDATE output_operation_slots SET status=CASE
  WHEN EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=output_operation_slots.scope_key AND calls.slot_id=output_operation_slots.slot_id AND calls.status IN('pending','uncertain')) THEN 'uncertain'
  ELSE CASE (SELECT live.status FROM document_jobs live WHERE live.job_id=output_operation_slots.job_id AND live.stream_id=? AND live.correlation_id=?)
   WHEN 'completed' THEN 'succeeded' WHEN 'failed' THEN 'failed' WHEN 'partial' THEN 'failed' WHEN 'canceled' THEN 'cancelled'
   WHEN 'running' THEN 'running' WHEN 'committing' THEN 'running' ELSE status END END,
  outcome_event_id=COALESCE((SELECT event_id FROM events WHERE stream_id=? AND correlation_id=? AND type IN('GenerationCompleted','GenerationFailed','DocumentRenderCompleted','DocumentRenderFailed') ORDER BY sequence DESC LIMIT 1),outcome_event_id),updated_at=? WHERE job_id=?`)
 .bind(job.stream_id,job.correlation_id,job.stream_id,job.correlation_id,now,job.job_id);
 const grantUpdate=env.DB.prepare(`UPDATE output_execution_grants SET status='completed' WHERE status IN('authorized','active')
   AND EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.scope_key=output_execution_grants.scope_key AND slot.grant_id=output_execution_grants.grant_id AND slot.job_id=?)
   AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.scope_key=output_execution_grants.scope_key AND slot.grant_id=output_execution_grants.grant_id AND slot.status IN('authorized','queued','running','uncertain'))`).bind(job.job_id);
 return [slotUpdate,grantUpdate];
}
export async function synchronizeOutputJobOutcome(env:WorkerEnv,job:Pick<DocumentJobRow,"job_id"|"status"|"stream_id"|"correlation_id">,extraStatements:D1PreparedStatement[]=[]){
 await env.DB.batch([...extraStatements,...prepareOutputJobOutcomeStatements(env,job)]);
}

/** Post-erasure reconciliation of work proven never to have been submitted. */
export async function releaseUndispatchedOutputReservations(env:WorkerEnv,filter:{ownerUserId?:string;organizationId?:string;personalOnly?:boolean;limit?:number}){
 if(!filter.ownerUserId&&!filter.organizationId)throw new Error("output_release_scope_required");
 const limit=Number.isSafeInteger(filter.limit)&&Number(filter.limit)>0?Math.min(64,Number(filter.limit)):64;
 const scopeSql=`FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
  JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN document_jobs job ON job.job_id=slot.job_id
  WHERE slot.status='cancelled' AND grant_row.status='revoked' AND job.status='canceled' AND job.attempt_count=0
   AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)
   AND (? IS NULL OR plan.owner_user_id=?) AND (? IS NULL OR plan.organization_id=?)
   AND (?=0 OR (plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL))
   AND (EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=slot.token_reservation_id AND token.status='active')
     OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=slot.cost_reservation_id AND cost.status='active'))`;
 const bindings=[filter.ownerUserId??null,filter.ownerUserId??null,filter.organizationId??null,filter.organizationId??null,Number(filter.personalOnly===true)];
 const rows=await env.DB.prepare(`SELECT slot.token_reservation_id,slot.cost_reservation_id,grant_row.payer_user_id ${scopeSql} ORDER BY slot.created_at,slot.slot_id LIMIT ?`)
  .bind(...bindings,limit).all<{token_reservation_id:string;cost_reservation_id:string;payer_user_id:string}>();
 for(const row of rows.results){await settleCostBudget(env,row.payer_user_id,row.cost_reservation_id,0,{activeOnly:true});await settleBudget(env,row.payer_user_id,row.token_reservation_id,0,"output_revoked_before_dispatch");}
 const remaining=await env.DB.prepare(`SELECT COUNT(*) AS pending ${scopeSql}`).bind(...bindings).first<{pending:number}>();
 return {reconciled:rows.results.length,pending:Number(remaining?.pending??0)};
}

/** Cancel and reconcile only slots whose provider history proves no submission. */
export async function cleanupExpiredOrRevokedOutputWork(env:WorkerEnv,scope:OutputScope,slots:OutputOperationSlot[],at=Date.now()) {
 const now=new Date(at).toISOString();
 const owned=slots.filter(slot=>slot.scopeKey===scope.key);
 if(!owned.length)return {reconciled:0};
 const statements:D1PreparedStatement[]=[];
 for(const slot of owned){
  statements.push(env.DB.prepare(`UPDATE output_execution_grants SET status='revoked'
   WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND status IN('authorized','active') AND expires_at<=?`)
   .bind(scope.key,slot.grantId,scope.actorUserId,now));
  statements.push(env.DB.prepare(`UPDATE document_jobs SET status='canceled',error_message='output_authorization_expired_or_revoked',completed_at=?,lease_expires_at=NULL,updated_at=?
   WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND status='queued' AND attempt_count=0
    AND EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row
     ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
     WHERE slot.scope_key=? AND slot.slot_id=? AND slot.job_id=document_jobs.job_id
      AND slot.status IN('authorized','queued','cancelled') AND grant_row.actor_user_id=? AND grant_row.status IN('revoked','exceeded','completed')
      AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id))`)
   .bind(now,now,slot.jobId,scope.actorUserId,`creative:${scope.ownerUserId}`,scope.documentId,scope.key,slot.slotId,scope.actorUserId));
  statements.push(env.DB.prepare(`UPDATE output_operation_slots SET status='cancelled',updated_at=? WHERE scope_key=? AND slot_id=?
   AND status IN('authorized','queued') AND EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=output_operation_slots.job_id AND job.owner_id=? AND job.status='canceled' AND job.attempt_count=0)
   AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=output_operation_slots.scope_key AND calls.slot_id=output_operation_slots.slot_id)`)
   .bind(now,scope.key,slot.slotId,scope.actorUserId));
 }
 await env.DB.batch(statements);
 // Cancel every still-unsubmitted sibling atomically, but settle only one
 // eligible pair per request. A settled first sibling must not starve the rest.
 const candidate=await env.DB.prepare(`SELECT grant_row.payer_user_id,slot.token_reservation_id,slot.cost_reservation_id FROM output_operation_slots slot
   JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
   JOIN document_jobs job ON job.job_id=slot.job_id WHERE slot.scope_key=? AND slot.slot_id IN(SELECT value FROM json_each(?)) AND slot.status='cancelled'
    AND grant_row.actor_user_id=? AND job.owner_id=? AND job.status='canceled' AND job.attempt_count=0
    AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)
    AND (EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=slot.token_reservation_id AND token.status='active')
      OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=slot.cost_reservation_id AND cost.status='active'))
   ORDER BY slot.updated_at,slot.slot_id LIMIT 1`)
   .bind(scope.key,JSON.stringify(owned.map(slot=>slot.slotId)),scope.actorUserId,scope.actorUserId).first<{payer_user_id:string;token_reservation_id:string;cost_reservation_id:string}>();
 if(!candidate)return {reconciled:0};
 const settlement=await settleDocumentGenerationBudgets(env,candidate.payer_user_id,{reservationId:candidate.token_reservation_id,costReservationId:candidate.cost_reservation_id,reason:"output_authorization_expired_or_revoked"});
 return {reconciled:Number(settlement.settled)};
}

/** Existing account reconciliation also drains authorizations abandoned before Start. */
export async function reconcileExpiredOutputAuthorizations(env:WorkerEnv,user:PilotUser,now=Date.now()) {
 await reconcileKnownOutputProviderReceipts(env,user);
 const owned=await env.DB.prepare(`SELECT grant_row.scope_key,grant_row.grant_id,grant_row.actor_user_id,grant_row.context_id,
  plan.scope_kind,plan.owner_user_id,plan.project_id,plan.document_id,plan.organization_id,plan.project_access_id
  FROM output_execution_grants grant_row JOIN output_plan_revisions plan ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
  WHERE grant_row.payer_user_id=? AND grant_row.actor_user_id=? AND grant_row.expires_at<=?
   AND EXISTS(SELECT 1 FROM output_operation_slots slot JOIN document_jobs job ON job.job_id=slot.job_id
    WHERE slot.scope_key=grant_row.scope_key AND slot.grant_id=grant_row.grant_id AND job.attempt_count=0
    AND slot.status IN('authorized','queued','cancelled') AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)
    AND (EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=slot.cost_reservation_id AND cost.status='active') OR EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=slot.token_reservation_id AND token.status='active')))
  ORDER BY grant_row.expires_at,grant_row.grant_id LIMIT 1`)
  .bind(user.billingUserId??user.userId,user.userId,new Date(now).toISOString()).all<Record<string,unknown>>();
 let reconciled=0;
 for(const row of owned.results){
  const scope:OutputScope={kind:row.scope_kind as OutputScope["kind"],key:String(row.scope_key),ownerUserId:String(row.owner_user_id),actorUserId:String(row.actor_user_id),projectId:String(row.project_id),documentId:String(row.document_id),organizationId:typeof row.organization_id==="string"?row.organization_id:null,projectAccessId:typeof row.project_access_id==="string"?row.project_access_id:null,contextId:typeof row.context_id==="string"?row.context_id:null};
  reconciled+=(await cleanupExpiredOrRevokedOutputWork(env,scope,await readOutputSlots(env,scope.key,String(row.grant_id)),now)).reconciled;
 }
 await reconcileOutputNativeStorage(env,{ownerUserId:user.userId,limit:1});
 return {reconciled};
}


/** Recover a known payment witness after a failed ledger write; never contact a provider.
 * One terminal slot per maintenance invocation keeps this bounded and lets unknown
 * receipts retain their exposure without monopolizing later reconciliation. */
export async function reconcileKnownOutputProviderReceipts(env:WorkerEnv,user:PilotUser,options:{jobId?:string;assertions?:OutputSqlAssertion[]}={}){
 const candidate=await env.DB.prepare(`SELECT slot.scope_key,slot.slot_id,slot.token_reservation_id,slot.cost_reservation_id,slot.updated_at,
   job.job_id,job.kind,job.owner_id,job.stream_id,job.document_id,job.status,job.correlation_id,
   json_extract(COALESCE(job.result_json,'{}'),'$.providerSubmissions') AS receipts_json
  FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
  JOIN document_jobs job ON job.job_id=slot.job_id AND job.owner_id=grant_row.actor_user_id
  WHERE grant_row.payer_user_id=? AND grant_row.actor_user_id=? AND job.status IN('completed','partial','failed','canceled')
   AND (? IS NULL OR job.job_id=?)
   AND (slot.status='uncertain' OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=slot.cost_reservation_id AND cost.status IN('active','executing'))
      OR EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=slot.token_reservation_id AND token.status='active'))
  ORDER BY slot.updated_at,slot.slot_id LIMIT 1`).bind(user.billingUserId??user.userId,user.userId,options.jobId??null,options.jobId??null).first<Record<string,unknown>>();
 if(!candidate)return {reconciled:0,status:'not_needed' as const};
 const scopeKey=String(candidate.scope_key),slotId=String(candidate.slot_id);
 const attemptedAt=new Date(Math.max(Date.now(),(Date.parse(String(candidate.updated_at))||0)+1)).toISOString();
 const authority=(options.assertions??[]).flatMap(assertion=>outputAssertionStatements(env,assertion));
 const rotate=env.DB.prepare("UPDATE output_operation_slots SET updated_at=? WHERE scope_key=? AND slot_id=?")
  .bind(attemptedAt,scopeKey,slotId);
 if(authority.length)await env.DB.batch([...authority,rotate]);else await rotate.run();
 const calls=await env.DB.prepare("SELECT call_key,client_request_id,provider,model,stage_key,status,used_microusd,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY created_at,call_key")
  .bind(scopeKey,slotId).all<Record<string,unknown>>();
 const receipts=providerSubmissions({providerSubmissions:parsed(String(candidate.receipts_json??'{}'))});
 const safe:Record<string,PaidProviderSubmission>={};
 for(const call of calls.results){
  const receipt=receipts.find(value=>value.clientRequestId===call.client_request_id);
  const expectedOperation=String(call.stage_key).startsWith('planning:')?'planning':'image';
  if(!receipt||receipt.provider!==call.provider||receipt.model!==call.model||receipt.operation!==expectedOperation
    ||!['completed','rejected'].includes(receipt.status))continue;
  const knownCost=receipt.status==='rejected'?0:receipt.costMicrousd;
  if(!Number.isSafeInteger(knownCost)||Number(knownCost)<0)continue;
  if(receipt.status==='completed'&&(!['inputTokens','outputTokens','totalTokens'].every(key=>Number.isSafeInteger(receipt[key as keyof PaidProviderSubmission])&&Number(receipt[key as keyof PaidProviderSubmission])>=0)))continue;
  const status=receipt.status==='rejected'?'rejected':'settled';
  if(['pending','uncertain'].includes(String(call.status))){
   await settleOutputProviderCall(env,{scopeKey,slotId,callKey:String(call.call_key),clientRequestId:receipt.clientRequestId,status,usedMicrousd:Number(knownCost),...(receipt.providerRequestId?{providerResponseId:receipt.providerRequestId}:{}),...(options.assertions?{assertions:options.assertions}:{})});
   call.status=status;call.used_microusd=Number(knownCost);call.provider_response_id=receipt.providerRequestId??null;
  }
  if(call.status!==status||Number(call.used_microusd)!==Number(knownCost)||call.provider_response_id&&call.provider_response_id!==receipt.providerRequestId)continue;
  safe[receipt.clientRequestId]=receipt;
 }
 if(calls.results.some(call=>!['settled','rejected'].includes(String(call.status)))||Object.keys(safe).length!==calls.results.length)return {reconciled:0,status:'uncertain' as const};
 const actor={...user,streamId:String(candidate.stream_id)};
 const job={job_id:String(candidate.job_id),stream_id:String(candidate.stream_id),correlation_id:String(candidate.correlation_id),status:String(candidate.status) as DocumentJobRow['status']};
 const settlement=await settleDocumentGenerationBudgets(env,actor.billingUserId??actor.userId,{reservationId:String(candidate.token_reservation_id),costReservationId:String(candidate.cost_reservation_id),reason:'output_known_response_reconciled',assertions:options.assertions});
 if(settlement.status==='uncertain')return {reconciled:0,status:'uncertain' as const};
 // Refresh only operational fields. This remains safe after source erasure and
 // never reconstructs private requests, candidates, outputs, or event bodies.
 const financial=env.DB.prepare(`UPDATE document_jobs SET result_json=json_patch(COALESCE(result_json,'{}'),json_object('generationReceipt',json_object(
    'reservation_status',(SELECT status FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?),
    'settled_cost_microusd',(SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?),
    'actual_provider_call_count',?, 'provider_request_status',CASE WHEN ?=0 THEN 'not_submitted' WHEN status='completed' THEN 'completed' ELSE 'submitted' END,
    'source_transmission_status',CASE WHEN ?=0 THEN 'not_transmitted' ELSE 'transmitted' END))),updated_at=?
   WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('completed','partial','failed','canceled')`)
   .bind(String(candidate.cost_reservation_id),actor.billingUserId??actor.userId,String(candidate.cost_reservation_id),actor.billingUserId??actor.userId,calls.results.length,calls.results.length,calls.results.length,new Date().toISOString(),job.job_id,actor.userId,job.stream_id,job.correlation_id);
 await synchronizeOutputJobOutcome(env,job,[...authority,financial]);
 return {reconciled:Number(settlement.settled),status:'known' as const};
}

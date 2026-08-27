import { adaptiveRequestKey, adaptiveRequestLocale } from "../src/model/adaptive-request.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { audioRightsAllowed } from "../src/model/audio.ts";
import { blockIntentFor } from "../src/model/block-types.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import { prepareDocumentAuthority, readDocumentExecutionAuthority } from "./context-authoring-authority.ts";
import { governedPackageSourceRightsValidity, sourceRightsDispatchGuard } from "./context-package-rights.ts";
import { synchronizeProjectScope } from "./project-access.ts";
import { beginConsequentialStep, canonicalConsent, completeConsequentialExecution, consequentialUsageSettled, consentHash, executionAdmissionGuard, executionContentCustodyGuard, failConsequentialExecution, proveConsequentialStepNotSubmitted, quoteConsequentialExecution, readConsequentialExecution, readConsequentialIntentExecution, reconcileConsequentialUsage, reserveConsequentialSteps, settleConsequentialStep, type ConsequentialBinding, type ConsequentialPreview, type ExecutionRow } from "./consequential-consent.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { EventExecutionControl } from "./events-api.ts";
import { managedPilotSourceClassificationValid, verifySourceDocumentEvidence } from "./media-api.ts";
import { buildAdaptivePlanningRequest, decodeAdaptivePlanningResponse, type AdaptivePlanningInput } from "./openai-adapter.ts";
import { hasCapability, pilotExecutionAllowance, readAccountBudgets, storePrivateContent, type BudgetReservationGuard, type PilotUser } from "./pilot-policy.ts";
import { hasKnownTextModelPricing, priceTextUsageBreakdownMicrousd } from "./replay-cost.ts";
import { streamHead, type WorkerEnv } from "./runtime.ts";

export const ADAPTIVE_CONSENT_VERSION="adaptive-planning-consent-v1";
const OPERATION="adaptive-structure",MAX_REQUEST_BYTES=128_000,MAX_PROVIDER_RESPONSE_BYTES=256_000,OUTPUT_TOKENS=1_400;
const HEADERS={"cache-control":"private, no-store",vary:"Cookie, oai-authenticated-user-id, oai-authenticated-user-email"};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:HEADERS});
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
function fail(code:string):never{throw new Error(code);}
const errorCode=(error:unknown)=>error instanceof Error&&/^(?:adaptive|context|provider|document|canvas|source|workspace)_[a-z_]+$/u.test(error.message)?error.message:"adaptive_planning_unavailable";
const errorStatus=(code:string)=>code.includes("budget_unavailable")?429:code.includes("too_large")?413:/denied|authorization|rights|protected/u.test(code)?403:409;
const joinProof=(...proofs:BudgetReservationGuard[]):BudgetReservationGuard=>({sql:proofs.map((proof)=>`(${proof.sql})`).join(" AND "),bindings:proofs.flatMap((proof)=>proof.bindings)});
type Authority=Pick<Exclude<Awaited<ReturnType<typeof prepareDocumentAuthority>>,Response>,"principal"|"binding"|"sourceHead"|"projection"|"scope"|"events">;
type Settings={prompt:string;locale:string;sourceSurface:string;projectScope:boolean;replaceExecutionId?:string};
type AdaptiveConsentRequest=Settings&{schema:1;requestKey:string;providerRequest:Record<string,unknown>;pricingVersion:string;sourcePolicy:string;sourceRightsValidUntil?:string|null};
type RetainedConsent={row:ExecutionRow;binding:ConsequentialBinding;preview:ConsequentialPreview;request:AdaptiveConsentRequest;serialized:string};
type AdaptiveRawReceipt={version:1;executionId:string;bindingHash:string;requestKey:string;sourceHash:string;providerRequestHash:string;httpStatus:number;requestIdHeader:string|null;responseBody:string;receivedAt:string;latencyMs:number};
export type AdaptivePlanningPrepared=Authority&{binding:ConsequentialBinding;settings:Settings;requestKey:string;providerRequest:Record<string,unknown>;privateInput:Record<string,unknown>;providerAvailable:boolean;purchaseUnavailableReasons:string[];sourceRightsValidUntil:string|null;sourceRightsDispatchProof:BudgetReservationGuard};
export type AdaptivePlanningPorts={
  /** Claim execution plus existing document job/resource in one batch; no reservation here. */
  admit:(prepared:AdaptivePlanningPrepared,executionId:string,approvedHash:string)=>Promise<Response>;
  /** Authorized view of this exact job; never dispatch from a free read. */
  read?:(user:PilotUser,binding:ConsequentialBinding,executionId:string)=>Promise<{job:unknown;proof?:BudgetReservationGuard}|null>;
};

function settingsFor(body:Record<string,unknown>,canvasId:string|null):Settings{
  if(typeof body.prompt!=="string")fail("adaptive_intent_required");
  const prompt=body.prompt.trim();if(!prompt||prompt.length>2_000)fail("adaptive_intent_required");
  if(body.projectScope!==undefined&&typeof body.projectScope!=="boolean")fail("adaptive_scope_invalid");
  if(body.sourceSurface!==undefined&&typeof body.sourceSurface!=="string")fail("adaptive_surface_invalid");
  const sourceSurface=typeof body.sourceSurface==="string"?body.sourceSurface:"studio";
  if(!sourceSurface||sourceSurface.length>80)fail("adaptive_surface_invalid");
  const projectScope=body.projectScope===true;
  if(canvasId?sourceSurface!=="canvas"||!projectScope:sourceSurface==="canvas")fail("canvas_context_required");
  if(body.replaceExecutionId!==undefined&&(typeof body.replaceExecutionId!=="string"||!body.replaceExecutionId||body.replaceExecutionId.length>120))fail("adaptive_replacement_invalid");
  return{prompt,locale:adaptiveRequestLocale(body.locale),sourceSurface,projectScope,...(typeof body.replaceExecutionId==="string"?{replaceExecutionId:body.replaceExecutionId}:{})};
}
function storedRequest(binding:ConsequentialBinding):AdaptiveConsentRequest{
  const request=record(binding.request);
  if(request.schema!==1||typeof request.requestKey!=="string"||typeof request.prompt!=="string"||typeof request.locale!=="string"||typeof request.sourceSurface!=="string"||typeof request.projectScope!=="boolean"||!Object.keys(record(request.providerRequest)).length)fail("adaptive_consent_invalid");
  if(request.sourceRightsValidUntil!==undefined&&request.sourceRightsValidUntil!==null&&(typeof request.sourceRightsValidUntil!=="string"||!Number.isFinite(Date.parse(request.sourceRightsValidUntil))||new Date(request.sourceRightsValidUntil).toISOString()!==request.sourceRightsValidUntil))fail("adaptive_consent_invalid");
  if(request.replaceExecutionId!==undefined&&(typeof request.replaceExecutionId!=="string"||!request.replaceExecutionId||request.replaceExecutionId.length>120))fail("adaptive_consent_invalid");
  return request as AdaptiveConsentRequest;
}
const canPrepareNewPlanning=(user:PilotUser,binding:ConsequentialBinding)=>binding.scope?hasCapability(user,"project.author",binding.scope)&&hasCapability(user,"project.output.request",binding.scope):user.access.capabilities.includes("project.author")&&user.access.capabilities.includes("project.output.request");

/** A pre-issued approval cannot bypass a same-request purchase, even under another model/source. */
export function adaptivePlanningAdmissionGuard(prepared:AdaptivePlanningPrepared,id:string):BudgetReservationGuard{
  const {binding,requestKey,settings}=prepared,previous=settings.replaceExecutionId??"";
  const value=(alias:string,path:string)=>`json_extract(CASE WHEN json_valid(${alias}.request_json) THEN ${alias}.request_json ELSE '{}' END,'$.${path}')`;
  const match=(alias:string)=>`${alias}.owner_id=? AND ${alias}.stream_id=? AND ${alias}.document_id=? AND ${alias}.kind='structure_adaptive'
    AND ${alias}.source_surface=? AND COALESCE(${value(alias,"canvasId")},'')=? AND ${value(alias,"projectId") }=?
    AND ${value(alias,"adaptiveConsentVersion")}=1 AND ${value(alias,"requestKey") }=?`;
  const bindings=()=>[binding.actorUserId,binding.streamId,binding.documentId,settings.sourceSurface,binding.canvasId??"",binding.projectId,requestKey];
  const custody=executionContentCustodyGuard(binding,"content"),resultCustody=executionContentCustodyGuard(binding,"saved");
  return{sql:`NOT EXISTS(
    WITH RECURSIVE lineage(execution_id) AS(
      SELECT ? WHERE ?!=''
      UNION SELECT ${value("ancestor","replacesExecutionId")} FROM document_jobs ancestor JOIN lineage ON ancestor.job_id=lineage.execution_id
        WHERE ${match("ancestor")} AND COALESCE(${value("ancestor","replacesExecutionId")},'')!=''
    )
    SELECT 1 FROM document_jobs job JOIN consequential_executions execution ON execution.execution_id=job.job_id AND execution.actor_user_id=job.owner_id
      WHERE ${match("job")} AND job.job_id!=?
        AND(execution.status IN('reserved','uncertain','completed') OR execution.result_ref IS NOT NULL
          OR EXISTS(SELECT 1 FROM consequential_execution_steps paid WHERE paid.execution_id=execution.execution_id AND paid.status IN('submitting','uncertain','usage-recorded','settled')))
        AND(execution.status!='completed' OR EXISTS(SELECT 1 FROM consequential_execution_steps pending WHERE pending.execution_id=execution.execution_id AND pending.status!='settled')
          OR job.job_id NOT IN(SELECT execution_id FROM lineage))
    ) AND(?='' OR EXISTS(SELECT 1 FROM document_jobs predecessor
      JOIN consequential_executions execution ON execution.execution_id=predecessor.job_id AND execution.actor_user_id=predecessor.owner_id
      JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id AND step.step_index=0 AND step.status='settled'
      JOIN budget_reservations tokens ON tokens.reservation_id=step.token_reservation_id AND tokens.owner_id=execution.actor_user_id AND tokens.status='settled' AND tokens.used_tokens=step.verified_tokens
      JOIN cost_budget_reservations cost ON cost.reservation_id=step.cost_reservation_id AND cost.owner_id=execution.actor_user_id AND cost.status='settled' AND cost.used_microusd=step.verified_microusd
      JOIN private_content content ON content.content_id=execution.consent_ref AND content.owner_id=execution.actor_user_id AND content.kind='execution-consent'
        AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      JOIN private_content saved ON saved.content_id=execution.result_ref AND saved.owner_id=execution.actor_user_id AND saved.kind='context-proposal'
        AND saved.redacted_at IS NULL AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE predecessor.job_id=? AND execution.status='completed' AND ${match("predecessor")} AND ${custody.sql} AND ${resultCustody.sql}))`,
    bindings:[previous,previous,...bindings(),...bindings(),id,previous,previous,...bindings(),...custody.bindings,...resultCustody.bindings]};
}
/** No retained private bytes leave this module until current resource authority is checked. */
async function retainedConsent(env:WorkerEnv,user:PilotUser,executionId:string):Promise<RetainedConsent|null>{
  const row=await readConsequentialExecution(env,user.userId,executionId);if(!row)return null;
  const content=await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='execution-consent' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(row.consent_ref,user.userId).first<{content:string}>();
  if(!content)return null;
  let parsed:{binding:ConsequentialBinding;preview:ConsequentialPreview};try{parsed=JSON.parse(content.content);}catch{return null;}
  const{binding,preview}=parsed;
  if(!binding||!preview||binding.version!==ADAPTIVE_CONSENT_VERSION||binding.operation!==OPERATION||binding.blockId!==""||binding.actorUserId!==user.userId||binding.intentHash!==row.intent_hash||await consentHash(binding)!==row.binding_hash||preview.executionId!==row.execution_id||preview.bindingHash!==row.binding_hash)return null;
  const custody=executionContentCustodyGuard(binding);
  if(!await env.DB.prepare(`SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql}`).bind(row.consent_ref,user.userId,content.content,...custody.bindings).first())return null;
  return{row,binding,preview,request:storedRequest(binding),serialized:content.content};
}
function consentRetentionProof(retained:RetainedConsent):BudgetReservationGuard{
  const custody=executionContentCustodyGuard(retained.binding);
  return{sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='execution-consent' AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql})`,bindings:[retained.row.consent_ref,retained.binding.actorUserId,retained.serialized,...custody.bindings]};
}
/** Retention survives cancellation; dispatch additionally requires the exact live lease. */
function jobRetentionProof(row:DocumentJobRow,binding:ConsequentialBinding):BudgetReservationGuard{
  const scope=binding.scope;
  const resource=scope?`EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN events anchor ON anchor.event_id=resource.source_event_id
    JOIN project_resource_scopes document ON document.resource_kind='document' AND document.resource_id=job.document_id
      AND document.project_access_id=resource.project_access_id AND document.organization_id=resource.organization_id AND document.project_id=resource.project_id AND document.owner_user_id=resource.owner_user_id
    WHERE resource.resource_kind='job' AND resource.resource_id=job.job_id AND resource.actor_user_id=job.owner_id AND resource.visibility='actor_private'
      AND resource.project_access_id=? AND resource.organization_id=? AND resource.project_id=? AND resource.owner_user_id=?
      AND anchor.stream_id=job.stream_id AND anchor.actor='user:'||resource.actor_user_id AND anchor.type='ProjectDocumentJobQueued'
      AND json_extract(anchor.payload,'$.job_id')=job.job_id AND json_extract(anchor.payload,'$.document_id')=job.document_id
      AND json_extract(anchor.payload,'$.organization_id')=resource.organization_id AND json_extract(anchor.payload,'$.project_access_id')=resource.project_access_id
      AND json_extract(anchor.payload,'$.project_id')=resource.project_id AND json_extract(anchor.payload,'$.history_owner_user_id')=resource.owner_user_id AND json_extract(anchor.payload,'$.actor_user_id')=resource.actor_user_id)`
    :`NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='job' AND resource.resource_id=job.job_id)`;
  return{sql:`EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.kind='structure_adaptive' AND job.correlation_id=? AND job.request_json=? AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${resource})`,bindings:[row.job_id,row.owner_id,row.stream_id,row.document_id,row.correlation_id,row.request_json,...(scope?[scope.projectAccessId,scope.organizationId,scope.projectId,scope.ownerUserId]:[])]};
}
function assertJobBinding(row:DocumentJobRow,retained:RetainedConsent){
  let payload:Record<string,unknown>;try{payload=record(JSON.parse(row.request_json));}catch{fail("adaptive_consent_invalid");}
  const{binding,request}=retained;
  if((payload.replacesExecutionId??null)!==(request.replaceExecutionId??null))fail("adaptive_consent_changed");
  if(row.kind!=="structure_adaptive"||row.job_id!==retained.row.execution_id||row.correlation_id!==row.job_id||row.owner_id!==binding.actorUserId||row.stream_id!==binding.streamId||row.document_id!==binding.documentId||row.source_surface!==request.sourceSurface||payload.adaptiveConsentVersion!==1||payload.executionId!==row.job_id||payload.bindingHash!==retained.row.binding_hash||payload.projectId!==binding.projectId||(payload.canvasId??null)!==binding.canvasId||payload.requestKey!==request.requestKey||payload.locale!==request.locale||payload.projectScope!==request.projectScope||payload.sourceSurface!==request.sourceSurface)fail("adaptive_consent_changed");
}
function adaptiveReadBinding(user:PilotUser,retained:RetainedConsent):ConsequentialBinding{
  const scope=retained.binding.scope??undefined;
  if(!(scope?hasCapability(user,"project.read",scope):user.access.capabilities.includes("project.read")))fail("adaptive_read_scope_denied");
  return{...retained.binding,permissionEpoch:user.access.permissionEpoch,contextSessionId:null,pilotCohortId:null};
}
async function readAdaptiveRawReceipt(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,retained:RetainedConsent){
  assertJobBinding(row,retained);
  const base=joinProof(executionAdmissionGuard(user,adaptiveReadBinding(user,retained),null),consentRetentionProof(retained),jobRetentionProof(row,retained.binding));
  const custody=executionContentCustodyGuard(retained.binding,"raw");
  const saved=await env.DB.prepare(`SELECT job.result_json,raw.content_id,raw.content FROM document_jobs job JOIN private_content raw
    ON raw.content_id=json_extract(job.result_json,'$.adaptiveProviderReceipt.contentRef') AND raw.owner_id=job.owner_id
    WHERE job.job_id=? AND job.owner_id=? AND raw.kind='provider-response' AND raw.redacted_at IS NULL
      AND raw.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_extract(job.result_json,'$.adaptiveProviderReceipt.version')=1 AND ${base.sql} AND ${custody.sql}`)
    .bind(row.job_id,user.userId,...base.bindings,...custody.bindings).first<{result_json:string;content_id:string;content:string}>();
  if(!saved)return null;
  let receipt:AdaptiveRawReceipt,pointer:Record<string,unknown>;
  try{receipt=JSON.parse(saved.content);pointer=record(record(JSON.parse(saved.result_json)).adaptiveProviderReceipt);}catch{fail("adaptive_provider_receipt_invalid");}
  const hash=await consentHash(receipt);
  if(receipt.version!==1||receipt.executionId!==row.job_id||receipt.bindingHash!==retained.row.binding_hash||receipt.requestKey!==retained.request.requestKey||receipt.sourceHash!==retained.binding.sourceHash||receipt.providerRequestHash!==await consentHash(retained.request.providerRequest)||typeof receipt.responseBody!=="string"||!Number.isInteger(receipt.httpStatus)||receipt.httpStatus<200||receipt.httpStatus>599||pointer.contentRef!==saved.content_id||pointer.sha256!==hash||pointer.executionId!==row.job_id||pointer.bindingHash!==retained.row.binding_hash)fail("adaptive_provider_receipt_invalid");
  const exact:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM document_jobs job JOIN private_content raw ON raw.content_id=json_extract(job.result_json,'$.adaptiveProviderReceipt.contentRef') AND raw.owner_id=job.owner_id
    WHERE job.job_id=? AND job.owner_id=? AND json_extract(job.result_json,'$.adaptiveProviderReceipt.sha256')=? AND raw.content_id=? AND raw.kind='provider-response' AND raw.content=? AND raw.redacted_at IS NULL AND raw.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql})`,bindings:[row.job_id,user.userId,hash,saved.content_id,saved.content,...custody.bindings]};
  const proof=joinProof(base,exact);if(!await env.DB.prepare(`SELECT 1 AS retained WHERE ${proof.sql}`).bind(...proof.bindings).first())return null;
  return{receipt,proof,resultJson:saved.result_json};
}
async function retainAdaptiveRawReceipt(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,retained:RetainedConsent,receipt:AdaptiveRawReceipt){
  const existing=await readAdaptiveRawReceipt(env,user,row,retained);
  if(existing){if(await consentHash(existing.receipt)!==await consentHash(receipt))fail("adaptive_provider_receipt_conflict");row.result_json=existing.resultJson;return existing;}
  const paid:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM consequential_executions execution JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id
    WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND step.step_index=0 AND step.status IN('submitting','uncertain','usage-recorded','settled'))
    AND EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND json_type(COALESCE(job.result_json,'{}'),'$.adaptiveProviderReceipt') IS NULL)`,bindings:[row.job_id,user.userId,retained.row.binding_hash,row.job_id,user.userId]};
  const proof=joinProof(executionAdmissionGuard(user,adaptiveReadBinding(user,retained),null),consentRetentionProof(retained),jobRetentionProof(row,retained.binding),paid),serialized=JSON.stringify(receipt),sha256=await consentHash(receipt);
  await storePrivateContent(env,user.userId,"provider-response",serialized,retained.binding.scope??undefined,proof,(stored)=>[
    env.DB.prepare(`UPDATE document_jobs SET result_json=json_set(COALESCE(result_json,'{}'),'$.adaptiveProviderReceipt',json(?)),updated_at=?
      WHERE job_id=? AND owner_id=? AND ${proof.sql} AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND content=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(JSON.stringify({version:1,contentRef:stored.contentId,sha256,executionId:row.job_id,bindingHash:retained.row.binding_hash}),new Date().toISOString(),row.job_id,user.userId,...proof.bindings,stored.contentId,user.userId,serialized),
  ]);
  const saved=await readAdaptiveRawReceipt(env,user,row,retained);if(!saved)fail("adaptive_provider_receipt_unavailable");row.result_json=saved.resultJson;return saved;
}
/** Accounting remains allowed after authoring revocation; it never exposes the response or buys work. */
async function accountAdaptiveRawReceipt(env:WorkerEnv,user:PilotUser,retained:RetainedConsent,receipt:AdaptiveRawReceipt,proof?:BudgetReservationGuard){
  let provider:Record<string,unknown>;try{provider=record(JSON.parse(receipt.responseBody));}catch{fail("adaptive_provider_response_unconfirmed");}
  const id=retained.row.execution_id,providerRequestId=typeof provider.id==="string"&&provider.id.length<=200?provider.id:receipt.requestIdHeader;
  if(providerRequestId)await env.DB.prepare(`UPDATE consequential_execution_steps SET provider_request_id=?,updated_at=? WHERE execution_id=? AND step_index=0 AND status IN('submitting','uncertain') AND(provider_request_id IS NULL OR provider_request_id=?)`).bind(providerRequestId,new Date().toISOString(),id,providerRequestId).run();
  const usage=record(provider.usage),limit=retained.binding.steps[0]!,inputTokens=usage.input_tokens,outputTokens=usage.output_tokens,totalTokens=usage.total_tokens;
  const tools=(Array.isArray(provider.output)?provider.output:[]).some((item)=>/(?:_call|tool_result)$/u.test(String(record(item).type??"")));
  if(!providerRequestId||typeof inputTokens!=="number"||!Number.isSafeInteger(inputTokens)||inputTokens<=0||typeof outputTokens!=="number"||!Number.isSafeInteger(outputTokens)||outputTokens<0||typeof totalTokens!=="number"||!Number.isSafeInteger(totalTokens)||totalTokens!==inputTokens+outputTokens||inputTokens>272_000||provider.model!==limit.model||provider.service_tier!==undefined&&provider.service_tier!=="default"||tools)fail("adaptive_provider_usage_unverified");
  const cost=priceTextUsageBreakdownMicrousd(limit.model,{inputTokens,outputTokens,totalTokens}).totalMicrousd;let billingPending=false;
  try{await settleConsequentialStep(env,user.userId,id,0,totalTokens,cost,providerRequestId);}catch(error){const saved=await env.DB.prepare(`SELECT status,verified_tokens,verified_microusd FROM consequential_execution_steps WHERE execution_id=? AND step_index=0`).bind(id).first<{status:string;verified_tokens:number;verified_microusd:number}>();if(!saved||!["usage-recorded","settled"].includes(saved.status)||saved.verified_tokens!==totalTokens||saved.verified_microusd!==cost)throw error;billingPending=!await consequentialUsageSettled(env,user.userId,id,0,totalTokens,cost);}
  if(proof&&!await env.DB.prepare(`SELECT 1 AS retained WHERE ${proof.sql}`).bind(...proof.bindings).first())fail("adaptive_provider_receipt_unavailable");
  return{provider,providerRequestId,inputTokens,outputTokens,totalTokens,cost,billingPending};
}
async function materializeAdaptiveReceipt(env:WorkerEnv,row:DocumentJobRow,retained:RetainedConsent,receipt:AdaptiveRawReceipt,accounted:Awaited<ReturnType<typeof accountAdaptiveRawReceipt>>){
  const{provider,providerRequestId,inputTokens,outputTokens,totalTokens,cost,billingPending}=accounted,limit=retained.binding.steps[0]!;
  if(receipt.httpStatus<200||receipt.httpStatus>=300)fail("adaptive_provider_failed_after_usage");
  if(inputTokens>limit.inputTokens||outputTokens>limit.outputTokens||cost>limit.maximumMicrousd)fail("adaptive_provider_budget_exceeded");
  const structure=decodeAdaptivePlanningResponse(outputText(provider));
  return{structure,intent:retained.request.prompt,appended:[],rejected:[],head:await streamHead(env,retained.binding.streamId),executionId:row.job_id,bindingHash:retained.row.binding_hash,requestKey:retained.request.requestKey,sourceHash:retained.binding.sourceHash,sourceStatus:"original-approved-source",noAutomaticRetry:true,billingStatus:billingPending?"pending":"settled",reservationId:`${row.job_id}:tokens:0`,costReservationId:`${row.job_id}:usd:0`,plannerModel:limit.model,plannerResponseId:providerRequestId,plannerUsage:{inputTokens,outputTokens,totalTokens},executionReceipt:{provider:"openai",providerRequestId,actualProviderCallCount:1,maximumMicrousd:limit.maximumMicrousd,accountedMicrousd:cost,sourceHash:retained.binding.sourceHash,latencyMs:receipt.latencyMs}};
}
/** Purchase-only proof: expiry never invalidates retrieval of an already paid retained result. */
const sourceRightsDeadlineGuard=(validUntil:string|null):BudgetReservationGuard=>validUntil===null?{sql:"1",bindings:[]}:{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[validUntil]};
async function prepareFromAuthority(env:WorkerEnv,authority:Authority,settings:Settings):Promise<AdaptivePlanningPrepared>{
  const{principal,projection,scope,events}=authority,{projectId,documentId,canvasId}=authority.binding;
  const allowed=scope?hasCapability(principal,"project.author",scope)&&hasCapability(principal,"project.output.request",scope):principal.access.capabilities.includes("project.author")&&principal.access.capabilities.includes("project.output.request");
  if(!allowed)fail("adaptive_project_denied");
  const allowance=await pilotExecutionAllowance(env,principal.userId,scope),purchaseUnavailableReasons=allowance.allowed?[]:["adaptive_pilot_denied"];
  const candidates=(settings.projectScope?projection.libraryBlocks:projection.blocks).filter((block)=>block.projectId===projectId&&!block.removed),blocks=candidates.filter(promptFactIsActive),blockIds=new Set(blocks.map((block)=>block.id));
  const relationships=(settings.projectScope?projection.libraryBlockRelations:projection.blockRelations).filter((relation)=>!relation.removed&&blockIds.has(relation.fromBlockId)&&blockIds.has(relation.toBlockId));
  const referenceIds=new Set(blocks.map((block)=>String(block.properties.reference_id??"")).filter(Boolean));
  const rights=events.filter((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)&&referenceIds.has(String(event.payload.reference_id??""))),storageOwner=scope?.ownerUserId??principal.userId;
  // Never discard a protected or unlicensed active fact merely to make a request fit.
  const sourceRightsDeadlines:string[]=[];let sourceRightsDispatchProof:BudgetReservationGuard={sql:"1",bindings:[]};
  for(const block of blocks){
    const validity=creativeContextRightsValidity(block.properties);
    if(validity.issue)fail("adaptive_source_rights_unavailable");
    if(validity.validUntil)sourceRightsDeadlines.push(validity.validUntil);
    const referenceId=String(block.properties.reference_id??"");
    if(referenceId||block.type==="reference"){
      const latest=[...rights].reverse().find((event)=>String(event.payload.reference_id??"")===referenceId),classification=latest?.payload.rights_class;
      if(!referenceId||!latest||!(block.type==="audio"?audioRightsAllowed(classification):["owned","owned_or_licensed","account-generated"].includes(String(classification??""))))fail("adaptive_source_rights_unavailable");
    }
    const governed=Boolean(block.properties.organization_context_package_id||block.properties.organization_context_package_version_id);
    if(block.properties.source_evidence_hash&&!governed&&!await verifySourceDocumentEvidence(env,storageOwner,block.properties.media_url,block.properties))fail("adaptive_source_evidence_unavailable");
    const mime=String(block.properties.source_mime_type??"");if((mime==="application/pdf"||mime.includes("officedocument"))&&(!String(block.properties.text??"").trim()||block.properties.extraction_status==="unavailable"))fail("adaptive_source_evidence_unavailable");
  }
  if(blocks.some((block)=>block.properties.organization_context_package_id||block.properties.organization_context_package_version_id)){
    if(!scope)fail("adaptive_source_rights_unavailable");
    const validity=await governedPackageSourceRightsValidity(env,scope.organizationId,blocks,(source)=>synchronizeProjectScope(env,source));
    if(!validity.current)fail("adaptive_source_rights_unavailable");
    sourceRightsDispatchProof=sourceRightsDispatchGuard(validity);
    if(validity.validUntil)sourceRightsDeadlines.push(validity.validUntil);
  }
  const sourceRightsValidUntil=sourceRightsDeadlines.length?new Date(Math.min(...sourceRightsDeadlines.map((value)=>Date.parse(value)))).toISOString():null;
  if(allowance.pilot&&!await managedPilotSourceClassificationValid(env,storageOwner,allowance.pilot.cohort_id,blocks,scope?.projectAccessId??""))purchaseUnavailableReasons.push("adaptive_pilot_source_denied");
  const model=env.OPENAI_MODEL??"gpt-5.6-terra";if(!hasKnownTextModelPricing(model))fail("adaptive_model_pricing_unavailable");
  const input:AdaptivePlanningInput={intent:settings.prompt,locale:settings.locale,documentTitle:settings.projectScope?`${projection.projectName} project`:projection.documentTitle,
    blocks:blocks.map((block)=>({id:block.id,document_id:block.documentId,canvas_id:block.canvasId??null,scope:block.scope,type:block.type,handle:block.handle,locked:block.locked,intent:blockIntentFor(block.type,block.properties),properties:block.properties,source_event_refs:block.sourceEvents})),
    relationships:relationships.map((relation)=>({id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties,source_event_refs:relation.sourceEvents}))};
  const providerRequest={...await buildAdaptivePlanningRequest(principal.userId,input,model),service_tier:"default",truncation:"disabled"};
  const bytes=new TextEncoder().encode(JSON.stringify(providerRequest)).byteLength;if(bytes>MAX_REQUEST_BYTES)fail("adaptive_source_too_large");
  // Byte-token upper bound plus framing allowance stays below long-context pricing.
  const inputTokens=bytes+1_024,maximumMicrousd=priceTextUsageBreakdownMicrousd(model,{inputTokens,outputTokens:OUTPUT_TOKENS,totalTokens:inputTokens+OUTPUT_TOKENS}).totalMicrousd;
  const sourceHash=await consentHash({projectId,documentId,canvasId,title:input.documentTitle,blocks,relationships,rights:rights.map((event)=>({id:event.eventId,payload:event.payload}))});
  const requestKey=await adaptiveRequestKey({projectId,documentId,canvasId,...settings});
  const intentHash=await consentHash({version:ADAPTIVE_CONSENT_VERSION,operation:OPERATION,actorUserId:principal.userId,streamId:authority.binding.streamId,scope:scope??null,projectId,documentId,canvasId,requestKey,sourceHash,model});
  const request:AdaptiveConsentRequest={schema:1,...settings,requestKey,providerRequest,pricingVersion:"openai-standard-2026-08-27",sourcePolicy:"all-active-authorized-facts-v1",sourceRightsValidUntil};
  const binding:ConsequentialBinding={...authority.binding,version:ADAPTIVE_CONSENT_VERSION,operation:OPERATION,intentHash,sourceHash,blockId:"",permissionEpoch:principal.access.permissionEpoch,period:new Date().toISOString().slice(0,7),pilotCohortId:allowance.pilot?.cohort_id??null,steps:[{name:"planning",provider:"OpenAI",model,inputTokens,outputTokens:OUTPUT_TOKENS,maximumMicrousd,toolCalls:0}],publicQuery:"",request};
  const canvasTitle=canvasId?foldCanvasEvents(events,projectId,canvasId).canvases.find((canvas)=>canvas.id===canvasId&&canvas.projectId===projectId)?.name??null:null;
  const privateInput={scope:settings.projectScope?"whole-project":"document",projectTitle:projection.projectName,documentTitle:projection.documentTitle,canvasTitle,destination:{projectId,documentId,canvasId},requestKey,sourceHash,sourceRightsValidUntil,documentCount:new Set(blocks.map((block)=>block.documentId).filter(Boolean)).size,blockCount:blocks.length,libraryBlockCount:blocks.filter((block)=>block.scope==="library").length,canvasBlockCount:blocks.filter((block)=>block.scope==="canvas").length,inactiveBlockCount:candidates.length-blocks.length,protectedBlockCount:blocks.filter((block)=>block.locked||block.type==="exclusion"||["avoid","prohibit"].includes(blockIntentFor(block.type,block.properties))).length,providerRequest,authorship:"Suggestions only; no document or board decisions are applied."};
  return{...authority,binding,settings,requestKey,providerRequest,privateInput,providerAvailable:Boolean(env.OPENAI_API_KEY),purchaseUnavailableReasons,sourceRightsValidUntil,sourceRightsDispatchProof};
}
/** Free exact preparation without provider calls, reservations or invented source blocks. */
export async function preparedAdaptivePlanning(request:Request,env:WorkerEnv,body:Record<string,unknown>){
  const authority=await prepareDocumentAuthority(request,env,body,"author");if(authority instanceof Response)return authority;
  try{const prepared=await prepareFromAuthority(env,authority,settingsFor(body,authority.binding.canvasId));if(body.requestKey!==undefined&&body.requestKey!==prepared.requestKey)return response({error:"adaptive_request_changed",submission:"not-submitted"},409);return prepared;}
  catch(error){const code=errorCode(error);return response({error:code,submission:"not-submitted"},errorStatus(code));}
}
function sameReadScope(current:ConsequentialBinding,original:ConsequentialBinding){return current.actorUserId===original.actorUserId&&current.streamId===original.streamId&&current.projectId===original.projectId&&current.documentId===original.documentId&&current.canvasId===original.canvasId&&canonicalConsent(current.scope)===canonicalConsent(original.scope);}
async function readResult(env:WorkerEnv,user:PilotUser,currentBinding:ConsequentialBinding,retained:RetainedConsent,reconcile=true){
  let proof=joinProof(executionAdmissionGuard(user,currentBinding,null),consentRetentionProof(retained));
  if(!await env.DB.prepare(`SELECT 1 AS readable WHERE ${proof.sql}`).bind(...proof.bindings).first())fail("adaptive_read_authorization_changed");
  if(reconcile)await reconcileConsequentialUsage(env,user.userId,retained.row.execution_id);
  const row=await readConsequentialExecution(env,user.userId,retained.row.execution_id);if(!row)fail("adaptive_execution_unavailable");
  if(row.status!=="quoted"){
    const job=await env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=?").bind(row.execution_id,user.userId).first<DocumentJobRow>();
    if(!job)fail("adaptive_job_unavailable");assertJobBinding(job,retained);proof=joinProof(proof,jobRetentionProof(job,retained.binding));
  }
  const custody=executionContentCustodyGuard(retained.binding),savedCustody=executionContentCustodyGuard(retained.binding,"saved");
  const content=row.result_ref?await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='context-proposal' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${proof.sql} AND ${custody.sql}`).bind(row.result_ref,user.userId,...proof.bindings,...custody.bindings).first<{content:string}>():null;
  if(row.result_ref&&!content)fail("adaptive_result_unavailable");
  if(content&&row.result_ref)proof=joinProof(proof,{sql:`EXISTS(SELECT 1 FROM consequential_executions execution JOIN private_content saved ON saved.content_id=execution.result_ref AND saved.owner_id=execution.actor_user_id
    WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.result_ref=? AND saved.kind='context-proposal' AND saved.content=? AND saved.redacted_at IS NULL AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${savedCustody.sql})`,bindings:[row.execution_id,user.userId,row.binding_hash,row.result_ref,content.content,...savedCustody.bindings]});
  const result=content?record(JSON.parse(content.content)):null;
  if(result&&(result.executionId!==row.execution_id||result.bindingHash!==row.binding_hash||result.sourceHash!==retained.binding.sourceHash||result.requestKey!==retained.request.requestKey))fail("adaptive_result_identity_invalid");
  const pending=await env.DB.prepare(`SELECT 1 FROM consequential_execution_steps WHERE execution_id=? AND status IN('reserved','submitting','uncertain','usage-recorded') LIMIT 1`).bind(row.execution_id).first();
  if(!await env.DB.prepare(`SELECT 1 AS readable WHERE ${proof.sql}`).bind(...proof.bindings).first())fail("adaptive_read_authorization_changed");
  return{row,result,serializedResult:content?.content??null,billingStatus:pending?"pending":"settled",proof};
}
async function retrieve(env:WorkerEnv,authority:Authority,retained:RetainedConsent,ports:AdaptivePlanningPorts,requestedExecutionId=retained.row.execution_id){
  if(!sameReadScope(authority.binding,retained.binding))fail("adaptive_read_scope_denied");
  const current=await readResult(env,authority.principal,authority.binding,retained),quote={...retained.preview,status:current.row.status,providerAvailable:Boolean(env.OPENAI_API_KEY),canPrepareNew:current.row.status==="completed"&&current.billingStatus==="settled"&&canPrepareNewPlanning(authority.principal,authority.binding)};
  const certified=await ports.read?.(authority.principal,retained.binding,current.row.execution_id),job=certified?.job;
  const finalProof=certified?.proof?joinProof(current.proof,certified.proof):current.proof;
  if(!await env.DB.prepare(`SELECT 1 AS retained WHERE ${finalProof.sql}`).bind(...finalProof.bindings).first())fail("adaptive_result_unavailable");
  const identity={executionId:current.row.execution_id,bindingHash:current.row.binding_hash,requestKey:retained.request.requestKey,planningRequest:originalPlanningRequest(retained),quote,status:current.row.status,...(job?{job}:{}),...(requestedExecutionId!==current.row.execution_id?{reused:true,requestedExecutionId,reusedExecutionId:current.row.execution_id}:{}),billingStatus:current.billingStatus,noAutomaticRetry:true};
  if(current.result)return response({...current.result,...identity});
  const recovered=record(job),jobResult=record(recovered.result);
  if(recovered.status==="completed"&&jobResult.structure&&jobResult.executionId===current.row.execution_id&&jobResult.bindingHash===current.row.binding_hash)return response({...jobResult,...identity,status:"completed",quote:{...quote,status:"completed"}});
  return response({...identity,error:current.row.error_code??(current.row.status==="quoted"?"adaptive_not_submitted":"adaptive_execution_in_progress"),...(current.row.status==="quoted"?{submission:"not-submitted"}:{})},current.row.status==="reserved"?202:409);
}
export async function adaptiveExecutionResponse(env:WorkerEnv,authority:Authority,executionId:string,ports:AdaptivePlanningPorts,requestedExecutionId=executionId){
  const retained=await retainedConsent(env,authority.principal,executionId);if(!retained)fail("adaptive_execution_unavailable");
  return retrieve(env,authority,retained,ports,requestedExecutionId);
}
function originalPlanningRequest(retained:RetainedConsent){
  const {binding,request}=retained;
  return{projectId:binding.projectId,documentId:binding.documentId,canvasId:binding.canvasId,prompt:request.prompt,locale:request.locale,sourceSurface:request.sourceSurface,projectScope:request.projectScope,requestKey:request.requestKey};
}
/** Find existing work by the durable intent, before inspecting today's model or source. */
async function priorPlanningRequest(env:WorkerEnv,authority:Authority,settings:Settings){
  const requestKey=await adaptiveRequestKey({...authority.binding,...settings});
  const row=await env.DB.prepare(`SELECT job.job_id FROM document_jobs job JOIN consequential_executions execution
    ON execution.execution_id=job.job_id AND execution.actor_user_id=job.owner_id
    WHERE job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.kind='structure_adaptive'
      AND job.source_surface=? AND COALESCE(json_extract(job.request_json,'$.canvasId'),'')=?
      AND json_extract(job.request_json,'$.adaptiveConsentVersion')=1 AND json_extract(job.request_json,'$.requestKey')=?
      AND(execution.status IN('reserved','uncertain','completed') OR execution.result_ref IS NOT NULL
        OR EXISTS(SELECT 1 FROM consequential_execution_steps paid WHERE paid.execution_id=execution.execution_id AND paid.status IN('submitting','uncertain','usage-recorded','settled')))
    ORDER BY CASE WHEN execution.status!='completed' THEN 0 ELSE 1 END,job.requested_at DESC,job.job_id DESC LIMIT 1`)
    .bind(authority.principal.userId,authority.binding.streamId,authority.binding.documentId,settings.sourceSurface,authority.binding.canvasId??"",requestKey).first<{job_id:string}>();
  if(!row)return null;
  const retained=await retainedConsent(env,authority.principal,row.job_id);
  if(!retained)fail("adaptive_existing_request_unavailable");
  if(!sameReadScope(authority.binding,retained.binding)||retained.request.requestKey!==requestKey)fail("adaptive_read_scope_denied");
  const current=await readResult(env,authority.principal,authority.binding,retained);
  return{retained,current};
}
export async function adaptivePriorExecutionResponse(env:WorkerEnv,prepared:AdaptivePlanningPrepared,ports:AdaptivePlanningPorts,requestedExecutionId:string){
  const prior=await priorPlanningRequest(env,prepared,prepared.settings);
  return prior?retrieve(env,prepared,prior.retained,ports,requestedExecutionId):null;
}
export async function handleAdaptivePlanning(request:Request,env:WorkerEnv,ports:AdaptivePlanningPorts):Promise<Response>{
  if(request.method!=="POST")return response({error:"method_not_allowed"},405);
  let body:Record<string,unknown>;try{body=record(await request.json());}catch{return response({error:"invalid_request"},400);}
  try{
    if(body.action==="quote"){
      const authority=await prepareDocumentAuthority(request,env,body,"read");if(authority instanceof Response)return authority;
      const settings=settingsFor(body,authority.binding.canvasId);
      if(body.requestKey!==undefined&&body.requestKey!==await adaptiveRequestKey({...authority.binding,...settings}))return response({error:"adaptive_request_changed",submission:"not-submitted"},409);
      const prior=await priorPlanningRequest(env,authority,settings);
      if(prior){
        const {retained,current}=prior;
        const explicitNew=body.replaceExecutionId===current.row.execution_id&&current.row.status==="completed"&&current.billingStatus==="settled";
        if(!explicitNew)return response({quote:{...retained.preview,status:current.row.status,providerAvailable:Boolean(env.OPENAI_API_KEY),canExecute:false,canPrepareNew:current.row.status==="completed"&&current.billingStatus==="settled"&&canPrepareNewPlanning(authority.principal,authority.binding)},planningRequest:originalPlanningRequest(retained),executionId:current.row.execution_id,reused:true,...(current.result?{...current.result,billingStatus:current.billingStatus}:{})});
      }else if(body.replaceExecutionId!==undefined)return response({error:"adaptive_existing_request_unavailable",noAutomaticRetry:true},409);
      const prepared=await preparedAdaptivePlanning(request,env,body);if(prepared instanceof Response)return prepared;
      const existing=await readConsequentialIntentExecution(env,prepared.principal,prepared.binding,prepared.sourceHead);
      if(existing){const retained=await retainedConsent(env,prepared.principal,existing.execution_id);if(!retained)return response({error:"adaptive_existing_request_unavailable",noAutomaticRetry:true},409);const current=await readResult(env,prepared.principal,prepared.binding,retained);return response({quote:{...retained.preview,status:current.row.status,providerAvailable:prepared.providerAvailable},planningRequest:originalPlanningRequest(retained),executionId:current.row.execution_id,reused:true,...(current.result?{...current.result,billingStatus:current.billingStatus}:{})});}
      let availableMicrousd:number|null=null;
      try{const budget=await readAccountBudgets(env,prepared.principal.userId,prepared.scope?.organizationId);availableMicrousd=Math.min(budget.costBudgets.user.remainingMicrousd,budget.costBudgets.workspace.remainingMicrousd);}catch{/* Free disclosure is not a new purchase; unavailable policy disables approval. */}
      const quote=await quoteConsequentialExecution(env,prepared.principal,prepared.binding,prepared.privateInput,prepared.sourceHead,Number.POSITIVE_INFINITY);
      // Private storage/admission can outlive the authority check that prepared
      // this quote. Certify current access and retained custody once more at
      // the disclosure boundary; this free read never reconciles or dispatches.
      const retained=await retainedConsent(env,prepared.principal,quote.executionId);
      if(!retained||!sameReadScope(prepared.binding,retained.binding)||retained.request.requestKey!==prepared.requestKey)return response({error:"adaptive_existing_request_unavailable",noAutomaticRetry:true},409);
      const current=await readResult(env,prepared.principal,prepared.binding,retained,false);
      // A concurrent paid winner retains its own request and cannot become an
      // apparently new purchase because quote creation returned an older row.
      if(current.row.status!=="quoted"){
        return response({quote:{...retained.preview,status:current.row.status,providerAvailable:prepared.providerAvailable,canExecute:false},planningRequest:originalPlanningRequest(retained),executionId:current.row.execution_id,reused:true,...(current.result?{...current.result,billingStatus:current.billingStatus}:{})});
      }
      const budgetAvailable=availableMicrousd!==null&&quote.maximumMicrousd<=availableMicrousd;
      return response({planningRequest:originalPlanningRequest(retained),quote:{...retained.preview,status:current.row.status,providerAvailable:prepared.providerAvailable,budgetAvailable,availableMicrousd,unavailableReasons:prepared.purchaseUnavailableReasons,canExecute:prepared.providerAvailable&&budgetAvailable&&!prepared.purchaseUnavailableReasons.length}});
    }
    if(!["execute","retrieve","resume"].includes(String(body.action))||typeof body.executionId!=="string"||!body.executionId||body.executionId.length>120||body.action!=="resume"&&(typeof body.approvedBindingHash!=="string"||!/^[a-f0-9]{64}$/u.test(body.approvedBindingHash)))return response({error:"adaptive_consent_required",submission:"not-submitted"},428);
    // Paid evidence retrieval ignores current source, model, key, pilot and new-spend headroom.
    const authority=await prepareDocumentAuthority(request,env,body,"read");if(authority instanceof Response)return authority;
    const retained=await retainedConsent(env,authority.principal,body.executionId);if(!retained)return response({error:"adaptive_execution_unavailable",noAutomaticRetry:true},404);
    if(body.action!=="resume"&&retained.row.binding_hash!==body.approvedBindingHash||!sameReadScope(authority.binding,retained.binding)||body.sourceSurface!==undefined&&body.sourceSurface!==retained.request.sourceSurface)return response({error:"adaptive_consent_changed",noAutomaticRetry:true},409);
    if(body.action==="resume")return await retrieve(env,authority,retained,ports);
    if(retained.row.status==="quoted"){
      const prior=await priorPlanningRequest(env,authority,retained.request);
      if(prior&&(prior.retained.row.execution_id!==retained.request.replaceExecutionId||prior.current.row.status!=="completed"||prior.current.billingStatus!=="settled"))return await retrieve(env,authority,prior.retained,ports,retained.row.execution_id);
      const winner=await readConsequentialIntentExecution(env,authority.principal,{...authority.binding,intentHash:retained.binding.intentHash},authority.sourceHead);
      if(winner){const original=await retainedConsent(env,authority.principal,winner.execution_id);if(!original)fail("adaptive_existing_request_unavailable");return await retrieve(env,authority,original,ports,retained.row.execution_id);}
    }
    if(body.action==="retrieve"||retained.row.status!=="quoted")return await retrieve(env,authority,retained,ports);
    if(body.replaceExecutionId!==undefined&&body.replaceExecutionId!==retained.request.replaceExecutionId)return response({error:"adaptive_consent_changed",submission:"not-submitted"},409);
    const prepared=await preparedAdaptivePlanning(request,env,{...body,...(retained.request.replaceExecutionId?{replaceExecutionId:retained.request.replaceExecutionId}:{})});if(prepared instanceof Response)return prepared;
    if(prepared.purchaseUnavailableReasons.length)return response({error:prepared.purchaseUnavailableReasons[0],submission:"not-submitted",providerAvailable:false},403);
    if(await consentHash(prepared.binding)!==retained.row.binding_hash)return response({error:"adaptive_consent_changed",submission:"not-submitted"},409);
    if(!prepared.providerAvailable)return response({error:"provider_not_configured",submission:"not-submitted",providerAvailable:false},503);
    return await ports.admit(prepared,retained.row.execution_id,retained.row.binding_hash);
  }catch(error){const code=errorCode(error);return response({error:code,noAutomaticRetry:true},errorStatus(code));}
}
/** Missing output is normal while running. This response-only proof describes retained review access, not completion or permission to submit. */
export async function adaptivePlanningReviewAvailable(env:WorkerEnv,user:PilotUser,row:DocumentJobRow){
  try{
    const retained=await retainedConsent(env,user,row.job_id);if(!retained)return false;assertJobBinding(row,retained);
    const scope=retained.binding.scope??undefined;
    if(retained.binding.canvasId&&!(scope?hasCapability(user,"project.canvas.use",scope):user.access.canvasAccess))return false;
    const current=await readResult(env,user,adaptiveReadBinding(user,retained),retained,false);
    const proof=joinProof(current.proof,jobRetentionProof(row,retained.binding));
    return (current.row.status!=="completed"||current.result!==null)&&Boolean(await env.DB.prepare(`SELECT 1 AS retained_review WHERE ${proof.sql}`).bind(...proof.bindings).first());
  }catch{return false;}
}
/** Recovery proof stays server-only and guards the exact paid-result-to-job terminal write. */
export async function readAdaptivePlanningJobResult(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,options:{readOnly?:boolean}={}){
  const retained=await retainedConsent(env,user,row.job_id);if(!retained)return null;assertJobBinding(row,retained);
  const scope=retained.binding.scope??undefined;if(!(scope?hasCapability(user,"project.read",scope):user.access.capabilities.includes("project.read")))return null;
  if(retained.binding.canvasId&&!(scope?hasCapability(user,"project.canvas.use",scope):user.access.canvasAccess))return null;
  const readBinding={...retained.binding,permissionEpoch:user.access.permissionEpoch,contextSessionId:null,pilotCohortId:null};
  const current=await readResult(env,user,readBinding,retained,!options.readOnly);
  if(!current.result){
    if(options.readOnly)return null;
    const saved=await readAdaptiveRawReceipt(env,user,row,retained);if(!saved)return null;
    const accounted=await accountAdaptiveRawReceipt(env,user,retained,saved.receipt,saved.proof),result=await materializeAdaptiveReceipt(env,row,retained,saved.receipt,accounted);
    if(!await env.DB.prepare(`SELECT 1 AS retained WHERE ${saved.proof.sql}`).bind(...saved.proof.bindings).first())return null;
    return{result:{...result,recoveredFromPaidReceipt:true,quote:{...retained.preview,status:"completed",providerAvailable:Boolean(env.OPENAI_API_KEY),canExecute:false,canPrepareNew:result.billingStatus==="settled"&&canPrepareNewPlanning(user,readBinding)}},proof:saved.proof};
  }
  if(!current.row.result_ref||current.serializedResult===null)return null;
  const proof=current.proof;if(!await env.DB.prepare(`SELECT 1 AS retained WHERE ${proof.sql}`).bind(...proof.bindings).first())return null;
  return{result:{...current.result,billingStatus:current.billingStatus,quote:{...retained.preview,status:current.row.status,providerAvailable:Boolean(env.OPENAI_API_KEY),canExecute:false,canPrepareNew:current.row.status==="completed"&&current.billingStatus==="settled"&&canPrepareNewPlanning(user,readBinding)}},proof};
}
const outputText=(provider:Record<string,unknown>)=>{
  if(typeof provider.output_text==="string")return provider.output_text;
  return(Array.isArray(provider.output)?provider.output:[]).flatMap((item)=>Array.isArray(record(item).content)?record(item).content as unknown[]:[]).filter((item)=>record(item).type==="output_text").map((item)=>typeof record(item).text==="string"?String(record(item).text):"").join("");
};
/** Runs only inside the existing claimed, heartbeating document-job lease. No paid POST retry. */
export async function executeApprovedAdaptivePlanning(env:WorkerEnv,user:PilotUser,row:DocumentJobRow,control:EventExecutionControl):Promise<Response>{
  let retained:RetainedConsent|null=null,ownsSubmission=false,providerInvoked=false;
  try{
    retained=await retainedConsent(env,user,row.job_id);if(!retained)fail("adaptive_consent_unavailable");assertJobBinding(row,retained);
    const recovered=await readAdaptivePlanningJobResult(env,user,row);if(recovered)return response(recovered.result);
    if(retained.row.status!=="reserved")fail("adaptive_execution_not_active");
    const stepState=await env.DB.prepare(`SELECT status FROM consequential_execution_steps WHERE execution_id=? AND step_index=0`).bind(row.job_id).first<{status:string}>();
    if(stepState?.status!=="quoted")fail("adaptive_existing_submission_unavailable");
    if(!env.OPENAI_API_KEY)fail("provider_not_configured");if(control.signal.aborted)fail("document_job_canceled");
    const original=retained,currentPreparation=async()=>{const authority=await readDocumentExecutionAuthority(env,user,original.binding),prepared=await prepareFromAuthority(env,authority,original.request);if(prepared.purchaseUnavailableReasons.length)fail(prepared.purchaseUnavailableReasons[0]!);if(await consentHash(prepared.binding)!==original.row.binding_hash)fail("adaptive_consent_changed");return prepared;};
    const reservationPreparation=await currentPreparation();
    const lease:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND job.correlation_id=? AND job.attempt_count=? AND job.status='running' AND job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[row.job_id,user.userId,row.job_id,row.attempt_count]};
    const retention=joinProof(consentRetentionProof(original),jobRetentionProof(row,original.binding)),dispatch=joinProof(retention,lease);
    if(!await env.DB.prepare(`SELECT 1 AS active WHERE ${dispatch.sql}`).bind(...dispatch.bindings).first())fail("document_job_canceled");
    await reserveConsequentialSteps(env,user,original.binding,row.job_id,joinProof(sourceRightsDeadlineGuard(reservationPreparation.sourceRightsValidUntil),reservationPreparation.sourceRightsDispatchProof));
    await control.progress("planning","Planning from the exact approved context.");
    const current=await currentPreparation();if(control.signal.aborted)fail("document_job_canceled");
    const providerInit:RequestInit={method:"POST",signal:control.signal,headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,"content-type":"application/json","X-Client-Request-Id":row.job_id,...(env.OPENAI_PROJECT?{"OpenAI-Project":env.OPENAI_PROJECT}:{})},body:JSON.stringify(original.request.providerRequest)};
    await beginConsequentialStep(env,user,original.binding,row.job_id,0,current.sourceHead,joinProof(dispatch,sourceRightsDeadlineGuard(current.sourceRightsValidUntil),current.sourceRightsDispatchProof));
    ownsSubmission=true;
    const ready=joinProof(dispatch,executionAdmissionGuard(user,original.binding,current.sourceHead,true),sourceRightsDeadlineGuard(current.sourceRightsValidUntil),current.sourceRightsDispatchProof);
    const dispatchReady=await env.DB.prepare(`SELECT 1 AS adaptive_dispatch_ready FROM consequential_executions execution
      JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id AND step.step_index=0 AND step.status='submitting'
      WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.status='reserved' AND execution.result_ref IS NULL AND ${ready.sql}`)
      .bind(row.job_id,user.userId,original.row.binding_hash,...ready.bindings).first();
    if(!dispatchReady)fail("context_authorization_changed");
    // D1 may have committed before its response arrives. No await may separate this check from fetch.
    const started=Date.now();
    if(control.signal.aborted||current.sourceRightsValidUntil!==null&&Date.parse(current.sourceRightsValidUntil)<=started){
      fail(control.signal.aborted?"document_job_canceled":"adaptive_source_rights_unavailable");
    }
    providerInvoked=true;
    const providerResponse=await fetch("https://api.openai.com/v1/responses",providerInit);
    const raw=await providerResponse.text();if(new TextEncoder().encode(raw).byteLength>MAX_PROVIDER_RESPONSE_BYTES)fail("adaptive_provider_response_unconfirmed");
    const receipt:AdaptiveRawReceipt={version:1,executionId:row.job_id,bindingHash:original.row.binding_hash,requestKey:original.request.requestKey,sourceHash:original.binding.sourceHash,providerRequestHash:await consentHash(original.request.providerRequest),httpStatus:providerResponse.status,requestIdHeader:providerResponse.headers.get("x-request-id"),responseBody:raw,receivedAt:new Date().toISOString(),latencyMs:Date.now()-started};
    let paidReceipt:NonNullable<Awaited<ReturnType<typeof readAdaptiveRawReceipt>>>;
    try{paidReceipt=await retainAdaptiveRawReceipt(env,user,row,original,receipt);}
    catch(error){await accountAdaptiveRawReceipt(env,user,original,receipt);throw error;}
    const accounted=await accountAdaptiveRawReceipt(env,user,original,paidReceipt.receipt,paidReceipt.proof);
    const result=await materializeAdaptiveReceipt(env,row,original,paidReceipt.receipt,accounted);
    await completeConsequentialExecution(env,user,original.binding,row.job_id,result,paidReceipt.proof);await control.beginCommit();
    const saved=await readAdaptivePlanningJobResult(env,user,row);if(!saved)fail("adaptive_result_unavailable");return response(saved.result);
  }catch(error){const code=errorCode(error);if(retained){try{const saved=await readAdaptivePlanningJobResult(env,user,row);if(saved)return response(saved.result);}catch{/* Current authorization/retention may no longer permit returning private bytes. */}if(ownsSubmission&&!providerInvoked)await proveConsequentialStepNotSubmitted(env,user.userId,row.job_id,0,retained.row.binding_hash);await failConsequentialExecution(env,user.userId,row.job_id,code);}const execution=await readConsequentialExecution(env,user.userId,row.job_id);return response({error:code,executionId:row.job_id,status:execution?.status??"failed",noAutomaticRetry:true},code.includes("budget_unavailable")?429:502);}
}

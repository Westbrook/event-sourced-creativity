import { foldCanvasEvents } from "../src/canvas/model.ts";
import { canvasDocumentTarget } from "../src/model/canvas-document-target.ts";
import { foldEvents } from "../src/model/events.ts";
import { ASSISTANT_MODELS, selectAssistantModel, type AssistantModel, type AssistantTask } from "../src/model/assistant-model-policy.ts";
import { assistantSurfaceForRoute, assistantPlaybookForSurface, type AssistantSurface } from "../src/model/assistant-route-policy.ts";
import { blockIntentFor } from "../src/model/block-types.ts";
import { compileAssistantContext, protectedAssistantDecision, ASSISTANT_CONTEXT_LIMITS, type AssistantContext } from "../src/model/conversation-context.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import { consentedTextPricing, assertConsentedTextPricing, maximumConsentedTextMicrousd, priceConsentedTextUsageMicrousd, type ConsentedTextPricing } from "../src/model/consented-text-pricing.ts";
import { prepareDocumentAuthority, readDocumentExecutionAuthority } from "./context-authoring-authority.ts";
import { governedPackageSourceRightsValidity, sourceRightsDispatchGuard } from "./context-package-rights.ts";
import { synchronizeProjectScope, readProjectSourceEvents, type ProjectRequestContext } from "./project-access.ts";
import { managedPilotSourceClassificationValid, verifySourceDocumentEvidence } from "./media-api.ts";
import { beginConsequentialStep, claimConsequentialExecution, completeConsequentialExecution, consentHash, canonicalConsent, executionAdmissionGuard, executionContentCustodyGuard, failConsequentialExecution, quoteConsequentialExecution, readConsequentialExecution, reconcileConsequentialUsage, reserveConsequentialSteps, settleConsequentialStep, consequentialUsageSettled, proveConsequentialStepNotSubmitted, type ConsequentialBinding, type ConsequentialPreview, type ExecutionRow } from "./consequential-consent.ts";
import { hasCapability, pilotExecutionAllowance, readAccountBudgets, storePrivateContent, requireUser, requireConsent, type BudgetReservationGuard, type PilotUser, type ProjectExecutionScope } from "./pilot-policy.ts";
import { buildAssistantProviderRequest, snapshotAssistantProviderInput, readAssistantProviderUsage, decodeAssistantProviderResult, MAX_ASSISTANT_PROVIDER_REQUEST_BYTES, MAX_ASSISTANT_PROVIDER_RESPONSE_BYTES, type AssistantProviderResult, type AssistantProviderAliases, type AssistantProviderSource } from "./assistant-provider.ts";
import { serializeEvent, type WorkerEnv, type WorkerExecutionContext } from "./runtime.ts";
import { ASSISTANT_STATE_EVENT_SQL } from "../src/model/assistant-event-views.ts";

export const ASSISTANT_SPECIALIST_CONSENT_VERSION="assistant-specialist-consent-v1";
const OPERATION="assistant-specialist",OUTPUT_TOKENS=1_600,CONVERSATION_TURNS=Math.floor(ASSISTANT_CONTEXT_LIMITS.turns/2),HEADERS={"cache-control":"private, no-store",vary:"Cookie, oai-authenticated-user-id, oai-authenticated-user-email"};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:HEADERS});
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
function fail(code:string):never{throw new Error(code);}
const errorCode=(error:unknown)=>error instanceof Error&&/^(?:assistant|context|provider|project|source|canvas)_[a-z_]+(?:_\d+)?$/u.test(error.message)?error.message:"assistant_specialist_unavailable";
const join=(...proofs:BudgetReservationGuard[]):BudgetReservationGuard=>({sql:proofs.map(proof=>"("+proof.sql+")").join(" AND "),bindings:proofs.flatMap(proof=>proof.bindings)});
const deadline=(validUntil:string|null):BudgetReservationGuard=>validUntil?{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[validUntil]}:{sql:"1",bindings:[]};

export type SpecialistActor={principal:PilotUser;project:ProjectRequestContext|null;surface:AssistantSurface;projectId:string|null;canPropose:boolean;legacyScopeKey?:string};
export type SpecialistTurn={id:string;user:string;reply:{key?:string;values?:Record<string,string|number>;text?:string};proposal:unknown;proposals?:unknown[];originalRequest?:unknown};
export type SpecialistTaskRecord={
  task_id:string;actor_user_id:string;scope_key:string;turn_id:string;organization_id:string|null;project_access_id:string|null;project_id:string|null;document_id:string|null;route_family:string;
  task_kind:string;selected_model:string;token_reservation_id:string;cost_reservation_id:string;estimated_microusd:number;maximum_input_tokens:number;maximum_output_tokens:number;locale:string;permission_epoch:string;
  status:string;error_code:string|null;lease_expires_at:string|null;provider_submitted:number;result_json:string|null;created_at:string;started_at:string|null;
};
export type SpecialistOriginalRequest={schema:1;turnId:string;route:string;projectId:string|null;documentId:string|null;canvasId:string|null;selectedItemIds:string[];locale:string};
type SavedTurn={turn_id:string;scope_key:string;actor_user_id:string;organization_id:string|null;project_access_id:string|null;project_id:string|null;document_id:string|null;request_json:string;user_content_ref:string;assistant_content_ref:string;created_at:string;user_content:string;assistant_content:string};
type ConversationEntry={turnId:string;userRef:string;answerRef:string;user:string;assistant:string};
type SpecialistRequest={schema:1;turnId:string;scopeKey:string;originalRequest:SpecialistOriginalRequest;taskKind:AssistantTask;explicitModel:AssistantModel|null;providerRequest:Record<string,unknown>;aliases:AssistantProviderAliases;context:AssistantContext;conversation:ConversationEntry[];pricing:ConsentedTextPricing;sourceRightsValidUntil:string|null;turn:Pick<SavedTurn,"user_content_ref"|"assistant_content_ref"|"request_json"|"document_id">};
type Retained={row:ExecutionRow;binding:ConsequentialBinding;preview:ConsequentialPreview;request:SpecialistRequest;serialized:string};
type RawReceipt={schema:1;executionId:string;bindingHash:string;providerRequestHash:string;httpStatus:number;responseBody:string;receivedAt:string;latencyMs:number};
type CanonicalResult={schema:1;executionId:string;bindingHash:string;turnId:string;reply:string;actions:AssistantProviderResult["actions"];providerResult:AssistantProviderResult;sourceStatus:"original-approved-source";sourceHash:string;maximumMicrousd:number;accountedMicrousd:number;billingStatus:"settled"|"pending";noAutomaticRetry:true};
export type AssistantSpecialistHost={
  ensure:(env:WorkerEnv)=>Promise<void>;
  authorize:(request:Request,env:WorkerEnv)=>Promise<{authorized:SpecialistActor|null;response:Response|null}>;
  scopeKey:(actor:SpecialistActor)=>string;
  kind:(message:string,context:AssistantContext,turnId:string)=>AssistantTask;
  allowedModels:(env:WorkerEnv)=>AssistantModel[];
  providerEnrolled:(env:WorkerEnv,userId:string)=>boolean;
  solEnrolled:(env:WorkerEnv,userId:string)=>boolean;
  turn:(env:WorkerEnv,actor:SpecialistActor,turnId:string)=>Promise<SpecialistTurn|null>;
  commit:(env:WorkerEnv,actor:SpecialistActor,task:SpecialistTaskRecord,result:AssistantProviderResult,context:AssistantContext,proof:BudgetReservationGuard)=>Promise<void>;
};

/** The existing queue gains only private-evidence pointers, never provider response bytes. */
export async function ensureAssistantSpecialistColumns(env:WorkerEnv){
  for(const [table,column]of[["assistant_turns","request_json"],["assistant_specialist_tasks","result_json"]]as const){
    const columns=await env.DB.prepare("PRAGMA table_info("+table+")").all<{name:string}>();
    if(!columns.results.some(item=>item.name===column)){
      try{await env.DB.prepare("ALTER TABLE "+table+" ADD COLUMN "+column+" TEXT").run();}
      catch(error){const current=await env.DB.prepare("PRAGMA table_info("+table+")").all<{name:string}>();if(!current.results.some(item=>item.name===column))throw error;}
    }
  }
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_single_consented_turn ON assistant_specialist_tasks(actor_user_id,scope_key,turn_id) WHERE result_json IS NOT NULL").run();
}
export function savedAssistantRequest(request:Request,actor:SpecialistActor,turnId:string,locale:string):SpecialistOriginalRequest{
  const url=new URL(request.url);
  return{schema:1,turnId,route:url.searchParams.get("route")??actor.surface.route,projectId:actor.projectId,documentId:actor.surface.documentId,canvasId:actor.surface.canvasId,selectedItemIds:url.searchParams.getAll("selected"),locale};
}
function actorScope(actor:SpecialistActor):ProjectExecutionScope|null{return actor.project?{organizationId:actor.project.organizationId,projectAccessId:actor.project.projectAccessId,projectId:actor.project.projectId,ownerUserId:actor.project.ownerUserId,actorUserId:actor.principal.userId}:null;}
function custody(binding:ConsequentialBinding,alias:string):BudgetReservationGuard{
  const proof=executionContentCustodyGuard(binding,"content");return{sql:proof.sql.replaceAll("content.content_id",alias+".content_id"),bindings:proof.bindings};
}
export function assistantTurnContentCustody(actor:SpecialistActor,alias:"authored"|"answer"):BudgetReservationGuard{return custody(scopeBinding(actor),alias);}

/** A copied paid reply is readable only while its canonical receipt and consent retain the same custody. */
export function assistantPaidReplyReadGuard(actor:SpecialistActor,scopeKey:string,turnIdSql:string):BudgetReservationGuard{
  const binding=scopeBinding(actor),authority=executionAdmissionGuard(actor.principal,{...binding,pilotCohortId:null},null);
  return join(authority,paidReplyContentGuard(binding,scopeKey,turnIdSql));
}
// Keep the exact canonical/consent/copy tuple in one equality: D1 limits expression depth to 100.
function paidReplyContentGuard(binding:ConsequentialBinding,scopeKey:string,turnIdSql:string):BudgetReservationGuard{
  const retained=custody(binding,"retained"),approved=custody(binding,"approved");
  const proof:BudgetReservationGuard={sql:`signed.actor_user_id=? AND signed.scope_key=? AND signed.turn_id=${turnIdSql}
    AND json_extract(signed.result_json,'$.specialistConsentVersion')=1
    AND (signed.status='completed' OR EXISTS(SELECT 1 FROM consequential_executions completed WHERE completed.execution_id=signed.task_id AND completed.actor_user_id=signed.actor_user_id AND completed.result_ref IS NOT NULL))
    AND NOT EXISTS(SELECT 1 FROM consequential_executions execution
      JOIN private_content approved ON approved.content_id=execution.consent_ref AND approved.owner_id=execution.actor_user_id AND approved.kind='execution-consent' AND approved.redacted_at IS NULL AND approved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      JOIN private_content retained ON retained.content_id=execution.result_ref AND retained.owner_id=execution.actor_user_id AND retained.kind='context-proposal' AND retained.redacted_at IS NULL AND retained.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE (execution.execution_id,execution.actor_user_id,execution.operation,execution.status,execution.binding_hash,
        json_extract(CASE WHEN json_valid(retained.content) THEN retained.content ELSE '{}' END,'$.executionId'),
        json_extract(CASE WHEN json_valid(retained.content) THEN retained.content ELSE '{}' END,'$.bindingHash'),
        json_extract(CASE WHEN json_valid(retained.content) THEN retained.content ELSE '{}' END,'$.turnId'),
        json_extract(CASE WHEN json_valid(retained.content) THEN retained.content ELSE '{}' END,'$.reply'),
        json_extract(CASE WHEN json_valid(approved.content) THEN approved.content ELSE '{}' END,'$.preview.executionId'),
        json_extract(CASE WHEN json_valid(approved.content) THEN approved.content ELSE '{}' END,'$.binding.actorUserId'),
        json_extract(CASE WHEN json_valid(approved.content) THEN approved.content ELSE '{}' END,'$.binding.request.turnId'))
        =(signed.task_id,signed.actor_user_id,'assistant-specialist','completed',json_extract(signed.result_json,'$.bindingHash'),
          signed.task_id,execution.binding_hash,signed.turn_id,answer.content,signed.task_id,signed.actor_user_id,signed.turn_id)
        AND (${retained.sql}) AND (${approved.sql}))`,bindings:[binding.actorUserId,scopeKey,...retained.bindings,...approved.bindings]};
  // The single packed context row lives in the signed-task scan, avoiding an extra enclosing EXISTS.
  // All original canonical fields and both live custody predicates still have to match.
  let parameter=0;const sql=proof.sql.replace(/\?/gu,()=>"json_extract(paid_reply_context.value,'$["+(parameter++)+"]')");
  if(parameter!==proof.bindings.length)fail("assistant_paid_reply_guard_invalid");
  return{sql:"NOT EXISTS(SELECT 1 FROM(SELECT ? AS value) paid_reply_context CROSS JOIN assistant_specialist_tasks signed WHERE "+sql+")",bindings:[JSON.stringify(proof.bindings)]};
}

function scopeBinding(actor:SpecialistActor):ConsequentialBinding{
  return{version:ASSISTANT_SPECIALIST_CONSENT_VERSION,intentHash:"",operation:OPERATION,actorUserId:actor.principal.userId,permissionEpoch:actor.principal.access.permissionEpoch,streamId:actor.project?"creative:"+actor.project.ownerUserId:actor.principal.streamId,projectId:actor.projectId??"",documentId:actor.surface.documentId??"",canvasId:actor.surface.canvasId,blockId:"",sourceHash:"",period:new Date().toISOString().slice(0,7),scope:actorScope(actor),contextSessionId:actor.project?.contextId||null,pilotCohortId:null,steps:[],publicQuery:"",request:{}};
}
function metadata(turn:SavedTurn):SpecialistOriginalRequest{
  let value:SpecialistOriginalRequest;try{value=JSON.parse(turn.request_json);}catch{fail("assistant_turn_snapshot_unavailable");}
  if(!value||value.schema!==1||value.turnId!==turn.turn_id||typeof value.route!=="string"||!Array.isArray(value.selectedItemIds)||value.selectedItemIds.some(id=>typeof id!=="string"||!id||id.length>160)||typeof value.locale!=="string"||value.projectId!==turn.project_id)fail("assistant_turn_snapshot_unavailable");
  return value;
}

async function savedTurn(env:WorkerEnv,actor:SpecialistActor,scopeKey:string,turnId:string){
  const binding=scopeBinding(actor),authored=custody(binding,"authored"),answer=custody(binding,"answer"),paid=assistantPaidReplyReadGuard(actor,scopeKey,"turn.turn_id");
  return env.DB.prepare(`SELECT turn.*,authored.content AS user_content,answer.content AS assistant_content FROM assistant_turns turn
    JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE turn.actor_user_id=? AND turn.scope_key=? AND turn.turn_id=? AND turn.status='completed' AND turn.organization_id IS ? AND turn.project_access_id IS ? AND turn.project_id IS ? AND ${authored.sql} AND ${answer.sql} AND ${paid.sql}`)
    .bind(actor.principal.userId,scopeKey,turnId,binding.scope?.organizationId??null,binding.scope?.projectAccessId??null,actor.projectId,...authored.bindings,...answer.bindings,...paid.bindings).first<SavedTurn>();
}
// New purchases require live provenance; recovery separately verifies its own canonical receipt before copying an answer.
function turnProof(binding:ConsequentialBinding,request:SpecialistRequest,paidSource=false):BudgetReservationGuard{
  const authored=custody(binding,"authored"),answer=custody(binding,"answer"),paid=paidSource?paidReplyContentGuard(binding,request.scopeKey,"turn.turn_id"):{sql:"1",bindings:[]};
  const expected={actor:binding.actorUserId,scopeKey:request.scopeKey,turnId:request.turnId,userRef:request.turn.user_content_ref,answerRef:request.turn.assistant_content_ref,metadata:request.turn.request_json,organizationId:binding.scope?.organizationId??null,projectAccessId:binding.scope?.projectAccessId??null,projectId:binding.projectId};
  return{sql:`EXISTS(SELECT 1 FROM assistant_turns turn,(SELECT ? AS value) expected
    JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE turn.actor_user_id=json_extract(expected.value,'$.actor') AND turn.scope_key=json_extract(expected.value,'$.scopeKey') AND turn.turn_id=json_extract(expected.value,'$.turnId')
      AND turn.user_content_ref=json_extract(expected.value,'$.userRef') AND turn.assistant_content_ref=json_extract(expected.value,'$.answerRef') AND turn.request_json=json_extract(expected.value,'$.metadata')
      AND turn.organization_id IS json_extract(expected.value,'$.organizationId') AND turn.project_access_id IS json_extract(expected.value,'$.projectAccessId') AND turn.project_id=json_extract(expected.value,'$.projectId')
      AND ${authored.sql} AND ${answer.sql} AND ${paid.sql})`,bindings:[JSON.stringify(expected),...authored.bindings,...answer.bindings,...paid.bindings]};
}
function conversationProof(binding:ConsequentialBinding,request:SpecialistRequest):BudgetReservationGuard{
  const authored=custody(binding,"authored"),answer=custody(binding,"answer"),paid=paidReplyContentGuard(binding,request.scopeKey,"turn.turn_id");
  return{sql:`NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM assistant_turns turn
    JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE turn.actor_user_id=? AND turn.scope_key=? AND turn.turn_id=json_extract(expected.value,'$.turnId')
      AND turn.user_content_ref=json_extract(expected.value,'$.userRef') AND turn.assistant_content_ref=json_extract(expected.value,'$.answerRef')
      AND authored.content=json_extract(expected.value,'$.user') AND ${authored.sql} AND ${answer.sql} AND ${paid.sql}))`,
    bindings:[JSON.stringify(request.conversation),binding.actorUserId,request.scopeKey,...authored.bindings,...answer.bindings,...paid.bindings]};
}
function readAuthority(actor:SpecialistActor,retained:Retained):BudgetReservationGuard{
  const scope=retained.binding.scope??undefined;if(!(scope?hasCapability(actor.principal,"project.read",scope):actor.principal.access.capabilities.includes("project.read")))fail("assistant_read_scope_denied");
  if(canonicalConsent(actorScope(actor))!==canonicalConsent(retained.binding.scope)||actor.projectId!==retained.binding.projectId)fail("assistant_read_scope_denied");
  return executionAdmissionGuard(actor.principal,{...retained.binding,permissionEpoch:actor.principal.access.permissionEpoch,contextSessionId:actor.project?.contextId||null,pilotCohortId:null},null);
}
function consentProof(retained:Retained):BudgetReservationGuard{
  const proof=custody(retained.binding,"content");return{sql:`EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=? AND content.kind='execution-consent' AND content.content=? AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${proof.sql})`,bindings:[retained.row.consent_ref,retained.binding.actorUserId,retained.serialized,...proof.bindings]};
}
async function retainedConsent(env:WorkerEnv,actor:SpecialistActor,scopeKey:string,turnId:string,id:string):Promise<Retained|null>{
  const row=await readConsequentialExecution(env,actor.principal.userId,id);if(!row)return null;
  const content=await env.DB.prepare("SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='execution-consent' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(row.consent_ref,actor.principal.userId).first<{content:string}>();if(!content)return null;
  let parsed:{binding:ConsequentialBinding;preview:ConsequentialPreview};try{parsed=JSON.parse(content.content);}catch{return null;}
  const{binding,preview}=parsed,request=binding?.request as SpecialistRequest;
  if(!binding||binding.version!==ASSISTANT_SPECIALIST_CONSENT_VERSION||binding.operation!==OPERATION||binding.actorUserId!==actor.principal.userId||binding.blockId!==""||await consentHash(binding)!==row.binding_hash||binding.intentHash!==row.intent_hash||preview?.executionId!==id||preview.bindingHash!==row.binding_hash||request?.schema!==1||request.turnId!==turnId||request.scopeKey!==scopeKey||request.originalRequest?.turnId!==turnId)return null;
  assertConsentedTextPricing(request.pricing,binding.steps[0]!.model as AssistantModel);
  const retained={row,binding,preview,request,serialized:content.content},proof=join(readAuthority(actor,retained),consentProof(retained),turnProof(binding,request));
  return await env.DB.prepare("SELECT 1 AS retained WHERE "+proof.sql).bind(...proof.bindings).first()?retained:null;
}
function taskProof(task:SpecialistTaskRecord,retained:Retained):BudgetReservationGuard{
  const expected={id:task.task_id,actor:retained.binding.actorUserId,scopeKey:retained.request.scopeKey,turnId:retained.request.turnId,organizationId:retained.binding.scope?.organizationId??null,projectAccessId:retained.binding.scope?.projectAccessId??null,projectId:retained.binding.projectId,documentId:retained.binding.documentId,kind:retained.request.taskKind,model:retained.binding.steps[0]!.model,bindingHash:retained.row.binding_hash,input:retained.binding.steps[0]!.inputTokens,output:retained.binding.steps[0]!.outputTokens,maximum:retained.binding.steps[0]!.maximumMicrousd,locale:retained.request.originalRequest.locale};
  return{sql:`EXISTS(SELECT 1 FROM assistant_specialist_tasks task,(SELECT ? AS value) expected WHERE task.task_id=json_extract(expected.value,'$.id')
    AND task.actor_user_id=json_extract(expected.value,'$.actor') AND task.scope_key=json_extract(expected.value,'$.scopeKey') AND task.turn_id=json_extract(expected.value,'$.turnId')
    AND task.organization_id IS json_extract(expected.value,'$.organizationId') AND task.project_access_id IS json_extract(expected.value,'$.projectAccessId') AND task.project_id=json_extract(expected.value,'$.projectId') AND task.document_id=json_extract(expected.value,'$.documentId')
    AND task.task_kind=json_extract(expected.value,'$.kind') AND task.selected_model=json_extract(expected.value,'$.model') AND task.locale=json_extract(expected.value,'$.locale')
    AND task.token_reservation_id=task.task_id||':tokens:0' AND task.cost_reservation_id=task.task_id||':usd:0'
    AND task.maximum_input_tokens=json_extract(expected.value,'$.input') AND task.maximum_output_tokens=json_extract(expected.value,'$.output') AND task.estimated_microusd=json_extract(expected.value,'$.maximum')
    AND json_extract(task.result_json,'$.specialistConsentVersion')=1 AND json_extract(task.result_json,'$.bindingHash')=json_extract(expected.value,'$.bindingHash'))`,bindings:[JSON.stringify(expected)]};
}
async function existingTask(env:WorkerEnv,actor:SpecialistActor,scopeKey:string,turnId:string){
  return env.DB.prepare("SELECT * FROM assistant_specialist_tasks WHERE actor_user_id=? AND scope_key=? AND turn_id=? ORDER BY created_at,task_id LIMIT 1").bind(actor.principal.userId,scopeKey,turnId).first<SpecialistTaskRecord>();
}
async function conversationWindow(env:WorkerEnv,actor:SpecialistActor,turn:SavedTurn):Promise<ConversationEntry[]>{
  const binding=scopeBinding(actor),authored=custody(binding,"authored"),answer=custody(binding,"answer"),paid=assistantPaidReplyReadGuard(actor,turn.scope_key,"prior.turn_id");
  // Choose the original window before custody checks. An unavailable included turn is not silently replaced by older history.
  const rows=await env.DB.prepare(`WITH included_turns AS(SELECT prior.* FROM assistant_turns prior
      WHERE prior.actor_user_id=? AND prior.scope_key=? AND prior.created_at<=? AND prior.turn_id!=? ORDER BY prior.created_at DESC,prior.turn_id DESC LIMIT ?)
    SELECT prior.turn_id,prior.user_content_ref,prior.assistant_content_ref,
      CASE WHEN ${authored.sql} THEN authored.content ELSE NULL END AS user_content,
      CASE WHEN ${answer.sql} AND ${paid.sql} THEN answer.content ELSE NULL END AS assistant_content
    FROM included_turns prior LEFT JOIN private_content authored ON authored.content_id=prior.user_content_ref AND authored.owner_id=prior.actor_user_id AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    LEFT JOIN private_content answer ON answer.content_id=prior.assistant_content_ref AND answer.owner_id=prior.actor_user_id AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    ORDER BY prior.created_at DESC,prior.turn_id DESC`)
    .bind(actor.principal.userId,turn.scope_key,turn.created_at,turn.turn_id,Math.max(0,CONVERSATION_TURNS-1),...authored.bindings,...answer.bindings,...paid.bindings)
    .all<{turn_id:string;user_content_ref:string;assistant_content_ref:string;user_content:string|null;assistant_content:string|null}>();
  return[...rows.results.reverse(),turn].map(row=>{
    if(typeof row.user_content!=="string"||typeof row.assistant_content!=="string")fail("assistant_conversation_custody_unavailable");
    return{turnId:row.turn_id,userRef:row.user_content_ref,answerRef:row.assistant_content_ref,user:row.user_content,assistant:row.assistant_content};
  });
}

async function canonicalEvents(env:WorkerEnv,actor:SpecialistActor){
  const scope=actorScope(actor);return scope?readProjectSourceEvents(env,scope):(await env.DB.prepare(`SELECT event.*,secret.private_json FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL WHERE event.stream_id=? AND event.type IN(${ASSISTANT_STATE_EVENT_SQL}) ORDER BY event.sequence`).bind(actor.principal.userId,actor.principal.streamId).all<Record<string,unknown>>()).results.map(serializeEvent);
}
async function documentForRequest(env:WorkerEnv,actor:SpecialistActor,original:SpecialistOriginalRequest){
  if(original.documentId)return original.documentId;
  if(!original.canvasId||!original.selectedItemIds.length||!original.projectId)fail("assistant_source_document_required");
  const events=await canonicalEvents(env,actor),canvas=foldCanvasEvents(events,original.projectId,original.canvasId),projection=foldEvents(events,Infinity,"",original.projectId);
  if(!canvas.canvases.some(item=>item.id===original.canvasId&&item.projectId===original.projectId))fail("assistant_selected_source_changed");
  const selected=original.selectedItemIds.map(id=>canvas.items.find(item=>item.id===id&&item.canvasId===original.canvasId&&item.projectId===original.projectId&&!item.removed&&item.visible));
  if(selected.some(item=>!item))fail("assistant_selected_source_changed");
  const documentId=canvasDocumentTarget(projection,canvas,original.selectedItemIds,"");
  if(!documentId)fail("assistant_source_document_required");return documentId;
}
async function sourcePreparation(request:Request,env:WorkerEnv,actor:SpecialistActor,original:SpecialistOriginalRequest,conversation:ConversationEntry[],binding?:ConsequentialBinding){
  const documentId=binding?.documentId??await documentForRequest(env,actor,original);
  if(!original.projectId)fail("assistant_source_document_required");
  const authority=binding?await readDocumentExecutionAuthority(env,actor.principal,binding):await prepareDocumentAuthority(request,env,{projectId:original.projectId,documentId,canvasId:original.canvasId},"author");
  if(authority instanceof Response){const error=record(await authority.json());fail(typeof error.error==="string"?error.error:"assistant_source_denied");}
  if(canonicalConsent(authority.scope??null)!==canonicalConsent(actorScope(actor)))fail("assistant_turn_custody_unavailable");
  const {projection,events,scope}=authority,blocks=projection.blocks.filter(block=>block.projectId===original.projectId&&block.documentId===documentId&&!block.removed),blockIds=new Set(blocks.map(block=>block.id));
  const relationships=projection.blockRelations.filter(relation=>!relation.removed&&blockIds.has(relation.fromBlockId)&&blockIds.has(relation.toBlockId));
  const sourceDeadlines:string[]=[],referenceIds=new Set(blocks.map(block=>String(block.properties.reference_id??"")).filter(Boolean)),rights=events.filter(event=>["RightsAsserted","ReferenceIngested"].includes(event.type)&&referenceIds.has(String(event.payload.reference_id??"")));
  for(const block of blocks.filter(promptFactIsActive)){
    const validity=creativeContextRightsValidity(block.properties);if(validity.issue)fail("assistant_source_rights_unavailable");if(validity.validUntil)sourceDeadlines.push(validity.validUntil);
    const referenceId=String(block.properties.reference_id??"");
    if(referenceId||block.type==="reference"){
      const receipt=[...rights].reverse().find(event=>String(event.payload.reference_id??"")===referenceId);
      if(!referenceId||!receipt||!["owned","owned_or_licensed","account-generated"].includes(String(receipt.payload.rights_class??"")))fail("assistant_source_rights_unavailable");
    }
    const governed=Boolean(block.properties.organization_context_package_id||block.properties.organization_context_package_version_id);
    if(block.properties.source_evidence_hash&&!governed&&!await verifySourceDocumentEvidence(env,scope?.ownerUserId??actor.principal.userId,block.properties.media_url,block.properties))fail("assistant_source_evidence_unavailable");
    const mime=String(block.properties.source_mime_type??"");if((mime==="application/pdf"||mime.includes("officedocument"))&&(!String(block.properties.text??"").trim()||block.properties.extraction_status==="unavailable"))fail("assistant_source_evidence_unavailable");
  }
  let sourceProof:BudgetReservationGuard={sql:"1",bindings:[]};
  if(blocks.some(block=>block.properties.organization_context_package_id||block.properties.organization_context_package_version_id)){
    if(!scope)fail("assistant_source_rights_unavailable");
    const validity=await governedPackageSourceRightsValidity(env,scope.organizationId,blocks.filter(promptFactIsActive),source=>synchronizeProjectScope(env,source));
    if(!validity.current)fail("assistant_source_rights_unavailable");if(validity.validUntil)sourceDeadlines.push(validity.validUntil);sourceProof=sourceRightsDispatchGuard(validity);
  }
  const sourceRightsValidUntil=sourceDeadlines.length?new Date(Math.min(...sourceDeadlines.map(value=>Date.parse(value)))).toISOString():null;
  const allowance=await pilotExecutionAllowance(env,actor.principal.userId,scope),unavailableReasons:string[]=[];
  if(!allowance.allowed)unavailableReasons.push("assistant_pilot_denied");
  if(!(scope?hasCapability(actor.principal,"project.output.request",scope):actor.principal.access.capabilities.includes("project.output.request")))unavailableReasons.push("assistant_output_denied");
  if(allowance.pilot&&!await managedPilotSourceClassificationValid(env,scope?.ownerUserId??actor.principal.userId,allowance.pilot.cohort_id,blocks.filter(promptFactIsActive),scope?.projectAccessId??""))unavailableReasons.push("assistant_pilot_source_denied");
  const canvas=original.canvasId?foldCanvasEvents(events,original.projectId,original.canvasId):null,selected=original.selectedItemIds.map(id=>canvas?.items.find(item=>item.id===id&&item.canvasId===original.canvasId&&item.projectId===original.projectId&&!item.removed&&item.visible));
  if(selected.some(item=>!item))fail("assistant_selected_source_changed");
  if(canvas&&(!original.selectedItemIds.length||canvasDocumentTarget(projection,canvas,original.selectedItemIds,"")!==documentId))fail("assistant_source_document_required");
  const surface=assistantSurfaceForRoute(original.route),base=compileAssistantContext({route:"/document/"+encodeURIComponent(documentId),projection,events,actorUserId:actor.principal.userId,projectId:original.projectId,organizationId:scope?.organizationId,projectAccessId:scope?.projectAccessId,capabilities:actor.project?.permissions??actor.principal.access.capabilities,head:authority.sourceHead});
  const outputOwned=new Set(projection.libraryBlockRelations.filter(relation=>!relation.removed&&relation.kind==="artifact_contains").flatMap(relation=>[relation.fromBlockId,relation.toBlockId]));
  const context:AssistantContext={...base,surface,playbook:assistantPlaybookForSurface(surface),documentTitle:projection.documents.find(item=>item.id===documentId)?.title??null,
    scope:{actorUserId:actor.principal.userId,organizationId:scope?.organizationId??null,projectAccessId:scope?.projectAccessId??null,projectId:original.projectId,documentId},
    selectedItems:selected.map(item=>({id:item!.id,sourceId:item!.sourceId,kind:item!.sourceKind,title:item!.title,documentId})),
    recentTurns:conversation.flatMap((turn,index)=>[{id:turn.turnId+":user",role:"user" as const,text:turn.user,sequence:index*2},{id:turn.turnId+":assistant",role:"assistant" as const,text:turn.assistant,sequence:index*2+1}]),
    decisionAtoms:blocks.map(block=>{const governed=Boolean(block.properties.organization_context_package_binding_id||block.properties.organization_context_package_id),immutable=Boolean(block.properties.source_evidence_hash||governed||block.properties.source_artifact_id||block.properties.source_artifact_item_id||block.properties.context_set_root_id||outputOwned.has(block.id));
      return{id:block.id,type:block.type,text:String(block.properties.text??block.properties.label??block.handle),intent:blockIntentFor(block.type,block.properties),locked:block.locked,protected:protectedAssistantDecision(block),focused:block.id===surface.focusedBlockId,version:block.sourceEvents.length,immutable,providerEligible:promptFactIsActive(block),providerVisibility:block.type==="reference"||block.type==="audio"&&immutable?"restricted":governed?"governed":immutable?"restricted":"editable"};}),
    relationships:relationships.map(relation=>({id:relation.id,from:relation.fromBlockId,to:relation.toBlockId,kind:relation.kind})),
    totals:{...base.totals,decisions:blocks.length,protectedDecisions:blocks.filter(block=>promptFactIsActive(block)&&protectedAssistantDecision(block)).length,unsafeRightsDecisions:0,truncatedProtectedDecisions:0},truncated:false};
  const source:AssistantProviderSource={blocks:blocks.map(block=>({id:block.id,type:block.type,properties:block.properties,locked:block.locked,intent:blockIntentFor(block.type,block.properties),document_id:block.documentId,canvas_id:block.canvasId??null,scope:block.scope})),relationships:relationships.map(relation=>({id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties}))};
  const sourceHash=await consentHash({projectId:original.projectId,documentId,canvasId:original.canvasId,title:context.documentTitle,blocks,relationships,rights:rights.map(event=>({id:event.eventId,payload:event.payload})),selected});
  return{...authority,context,source,sourceHash,sourceRightsValidUntil,sourceProof:join(deadline(sourceRightsValidUntil),sourceProof),allowance,unavailableReasons};
}
function modelEligibility(env:WorkerEnv,actor:SpecialistActor,host:AssistantSpecialistHost,kind:AssistantTask,model:AssistantModel,explicit:AssistantModel|null){
  const selection=selectAssistantModel(kind,{allowedModels:host.allowedModels(env),remainingMicrousd:Number.POSITIVE_INFINITY,premiumApproved:model==="gpt-5.6-sol"&&explicit===model&&actor.principal.role==="admin"&&host.solEnrolled(env,actor.principal.userId),requestedModel:model}),reasons:string[]=[];
  if(selection.blocked)reasons.push("assistant_model_"+selection.reason.replaceAll("-","_"));
  if(!host.providerEnrolled(env,actor.principal.userId))reasons.push("assistant_provider_policy_denied");
  return reasons;
}
async function prepareQuote(request:Request,env:WorkerEnv,actor:SpecialistActor,host:AssistantSpecialistHost,turn:SavedTurn,requestedModel:unknown){
  const original=metadata(turn),conversation=await conversationWindow(env,actor,turn),prepared=await sourcePreparation(request,env,actor,original,conversation),kind=host.kind(turn.user_content,prepared.context,turn.turn_id);
  if(requestedModel!==undefined&&(typeof requestedModel!=="string"||!ASSISTANT_MODELS.includes(requestedModel as AssistantModel)))fail("assistant_model_invalid");
  const explicit=requestedModel===undefined?null:requestedModel as AssistantModel,selection=selectAssistantModel(kind,{allowedModels:ASSISTANT_MODELS,remainingMicrousd:Infinity,premiumApproved:true,...(explicit?{requestedModel:explicit}:{})});if(!selection.model)fail("assistant_model_invalid");
  const model=selection.model,snapshot=snapshotAssistantProviderInput(prepared.context,turn.user_content,prepared.source);
  const visible=new Set(Object.values(snapshot.aliases));if(prepared.context.decisionAtoms.some(atom=>atom.providerEligible&&(atom.protected||atom.locked||atom.intent==="prohibit")&&!visible.has(atom.id)))fail("assistant_protected_source_unavailable");
  const providerRequest=await buildAssistantProviderRequest(actor.principal.userId,{model,locale:original.locale,maximumOutputTokens:OUTPUT_TOKENS,view:snapshot.view}),bytes=new TextEncoder().encode(JSON.stringify(providerRequest)).byteLength;
  if(bytes>MAX_ASSISTANT_PROVIDER_REQUEST_BYTES)fail("assistant_source_too_large");const inputTokens=bytes+1_024,pricing=consentedTextPricing(model),maximumMicrousd=maximumConsentedTextMicrousd(pricing,inputTokens,OUTPUT_TOKENS);
  const stored:SpecialistRequest={schema:1,turnId:turn.turn_id,scopeKey:host.scopeKey(actor),originalRequest:{...original,documentId:prepared.binding.documentId},taskKind:kind,explicitModel:explicit,providerRequest,aliases:snapshot.aliases,context:prepared.context,conversation,pricing,sourceRightsValidUntil:prepared.sourceRightsValidUntil,turn:{user_content_ref:turn.user_content_ref,assistant_content_ref:turn.assistant_content_ref,request_json:turn.request_json,document_id:turn.document_id}};
  const intentHash=await consentHash({version:ASSISTANT_SPECIALIST_CONSENT_VERSION,actor:actor.principal.userId,scopeKey:stored.scopeKey,turnId:turn.turn_id});
  const binding:ConsequentialBinding={...prepared.binding,version:ASSISTANT_SPECIALIST_CONSENT_VERSION,intentHash,operation:OPERATION,blockId:"",sourceHash:prepared.sourceHash,period:new Date().toISOString().slice(0,7),pilotCohortId:prepared.allowance.pilot?.cohort_id??null,steps:[{name:"specialist",provider:"OpenAI",model,inputTokens,outputTokens:OUTPUT_TOKENS,maximumMicrousd,toolCalls:0}],publicQuery:"",request:stored};
  const privateInput={turnId:turn.turn_id,originalRequest:{...stored.originalRequest,model,taskKind:kind,sourceHash:binding.sourceHash,conversationTurnIds:conversation.map(item=>item.turnId)},sourceRightsValidUntil:prepared.sourceRightsValidUntil,conversationWindow:{turns:conversation.length,maximumTurns:CONVERSATION_TURNS,throughTurnId:turn.turn_id},providerRequest,pricing,authorship:"Private guidance and separately reviewable proposals only. No authored decision is changed."};
  return{...prepared,binding,privateInput,unavailableReasons:[...prepared.unavailableReasons,...modelEligibility(env,actor,host,kind,model,explicit)]};
}

function retentionProof(task:SpecialistTaskRecord,retained:Retained){return join(consentProof(retained),turnProof(retained.binding,retained.request),taskProof(task,retained));}
async function readRaw(env:WorkerEnv,actor:SpecialistActor,task:SpecialistTaskRecord,retained:Retained){
  const base=retentionProof(task,retained),authority=readAuthority(actor,retained),contained=custody(retained.binding,"raw");
  const saved=await env.DB.prepare(`SELECT task.result_json,raw.content_id,raw.content FROM assistant_specialist_tasks task JOIN private_content raw ON raw.content_id=json_extract(task.result_json,'$.rawReceipt.contentRef') AND raw.owner_id=task.actor_user_id
    WHERE task.task_id=? AND task.actor_user_id=? AND raw.kind='provider-response' AND raw.redacted_at IS NULL AND raw.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${authority.sql} AND ${base.sql} AND ${contained.sql}`)
    .bind(task.task_id,actor.principal.userId,...authority.bindings,...base.bindings,...contained.bindings).first<{result_json:string;content_id:string;content:string}>();
  if(!saved)return null;let receipt:RawReceipt,pointer:Record<string,unknown>;
  try{receipt=JSON.parse(saved.content);pointer=record(record(JSON.parse(saved.result_json)).rawReceipt);}catch{fail("assistant_provider_receipt_invalid");}
  const sha=await consentHash(receipt);
  if(receipt.schema!==1||receipt.executionId!==task.task_id||receipt.bindingHash!==retained.row.binding_hash||receipt.providerRequestHash!==await consentHash(retained.request.providerRequest)||typeof receipt.responseBody!=="string"||!Number.isSafeInteger(receipt.httpStatus)||receipt.httpStatus<200||receipt.httpStatus>599||pointer.sha256!==sha||pointer.contentRef!==saved.content_id)fail("assistant_provider_receipt_invalid");
  const exact:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM assistant_specialist_tasks task JOIN private_content raw ON raw.content_id=json_extract(task.result_json,'$.rawReceipt.contentRef') AND raw.owner_id=task.actor_user_id
    WHERE task.task_id=? AND task.actor_user_id=? AND raw.content_id=? AND json_extract(task.result_json,'$.rawReceipt.sha256')=? AND raw.kind='provider-response' AND raw.content=? AND raw.redacted_at IS NULL AND raw.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${contained.sql})`,
    bindings:[task.task_id,actor.principal.userId,saved.content_id,sha,saved.content,...contained.bindings]};
  return{receipt,proof:join(base,exact)};
}
async function retainRaw(env:WorkerEnv,actor:SpecialistActor,task:SpecialistTaskRecord,retained:Retained,receipt:RawReceipt){
  const existing=await readRaw(env,actor,task,retained);if(existing){if(await consentHash(existing.receipt)!==await consentHash(receipt))fail("assistant_provider_receipt_conflict");return existing;}
  const paid:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM consequential_execution_steps step JOIN consequential_executions execution ON execution.execution_id=step.execution_id WHERE step.execution_id=? AND step.step_index=0 AND execution.actor_user_id=? AND execution.binding_hash=? AND step.status IN('submitting','uncertain','usage-recorded','settled'))
    AND EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.task_id=? AND task.actor_user_id=? AND json_type(task.result_json,'$.rawReceipt') IS NULL)`,bindings:[task.task_id,actor.principal.userId,retained.row.binding_hash,task.task_id,actor.principal.userId]};
  const proof=join(readAuthority(actor,retained),retentionProof(task,retained),paid),serialized=JSON.stringify(receipt),sha256=await consentHash(receipt);
  await storePrivateContent(env,actor.principal.userId,"provider-response",serialized,retained.binding.scope??undefined,proof,stored=>[
    env.DB.prepare(`UPDATE assistant_specialist_tasks SET result_json=json_set(result_json,'$.rawReceipt',json(?)),updated_at=?
      WHERE task_id=? AND actor_user_id=? AND ${proof.sql} AND EXISTS(SELECT 1 FROM private_content content WHERE content.content_id=? AND content.owner_id=? AND content.kind='provider-response' AND content.content=? AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(JSON.stringify({contentRef:stored.contentId,sha256}),new Date().toISOString(),task.task_id,actor.principal.userId,...proof.bindings,stored.contentId,actor.principal.userId,serialized),
  ]);
  const saved=await readRaw(env,actor,task,retained);if(!saved)fail("assistant_provider_receipt_unavailable");return saved;
}
async function accountRaw(env:WorkerEnv,actor:SpecialistActor,retained:Retained,raw:NonNullable<Awaited<ReturnType<typeof readRaw>>>){
  let body:unknown;try{body=JSON.parse(raw.receipt.responseBody);}catch{fail("assistant_provider_response_unconfirmed");}
  const observed=readAssistantProviderUsage(body,{model:retained.binding.steps[0]!.model as AssistantModel}),cost=priceConsentedTextUsageMicrousd(retained.request.pricing,observed.usage);let billingPending=false;
  try{await settleConsequentialStep(env,actor.principal.userId,retained.row.execution_id,0,observed.usage.totalTokens,cost,observed.responseId);}
  catch(error){
    const saved=await env.DB.prepare("SELECT status,verified_tokens,verified_microusd FROM consequential_execution_steps WHERE execution_id=? AND step_index=0").bind(retained.row.execution_id).first<{status:string;verified_tokens:number;verified_microusd:number}>();
    if(!saved||!["usage-recorded","settled"].includes(saved.status)||saved.verified_tokens!==observed.usage.totalTokens||saved.verified_microusd!==cost)throw error;
    billingPending=!await consequentialUsageSettled(env,actor.principal.userId,retained.row.execution_id,0,observed.usage.totalTokens,cost);
  }
  if(!await env.DB.prepare("SELECT 1 AS retained WHERE "+raw.proof.sql).bind(...raw.proof.bindings).first())fail("assistant_provider_receipt_unavailable");
  return{body,observed,cost,billingPending};
}
async function canonicalResult(env:WorkerEnv,actor:SpecialistActor,task:SpecialistTaskRecord,retained:Retained){
  const row=await readConsequentialExecution(env,actor.principal.userId,task.task_id);if(!row?.result_ref)return null;
  const base=retentionProof(task,retained),authority=readAuthority(actor,retained),contained=custody(retained.binding,"content");
  const saved=await env.DB.prepare(`SELECT content.content FROM private_content content WHERE content.content_id=? AND content.owner_id=? AND content.kind='context-proposal' AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${authority.sql} AND ${base.sql} AND ${contained.sql}`)
    .bind(row.result_ref,actor.principal.userId,...authority.bindings,...base.bindings,...contained.bindings).first<{content:string}>();if(!saved)return null;
  let result:CanonicalResult;try{result=JSON.parse(saved.content);}catch{fail("assistant_result_invalid");}
  if(result.schema!==1||result.executionId!==task.task_id||result.bindingHash!==retained.row.binding_hash||result.turnId!==retained.request.turnId||result.sourceHash!==retained.binding.sourceHash||result.providerResult?.model!==retained.binding.steps[0]!.model||result.reply!==result.providerResult.reply)fail("assistant_result_invalid");
  const exact:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM consequential_executions execution JOIN private_content content ON content.content_id=execution.result_ref AND content.owner_id=execution.actor_user_id WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.status='completed' AND content.content_id=? AND content.kind='context-proposal' AND content.content=? AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${contained.sql})`,bindings:[task.task_id,actor.principal.userId,retained.row.binding_hash,row.result_ref,saved.content,...contained.bindings]};
  return{result,proof:join(base,exact)};
}
export type AssistantTaskFeedEntry={
  record:SpecialistTaskRecord;
  display:{id:string;turnId:string;kind:string;model:string;status:string;error:string|null;estimatedMicrousd:number;
    executionId?:string;bindingHash?:string|null;canExecute?:boolean;submission?:string|null};
};
type AssistantCompletedReview={
  turnId:string;executionId:string;quote:ConsequentialPreview&{providerAvailable:boolean;canExecute:false};
  originalRequest:SpecialistOriginalRequest&{model:string;taskKind:AssistantTask;sourceHash:string;conversationTurnIds:string[]};
  result:{reply:string;sourceStatus:"original-approved-source"};
};

/** This is evidence of lost retained content, never an inference from a pending task. */
function assistantFeedRetentionProof(actor:SpecialistActor,scopeKey:string,entry:AssistantTaskFeedEntry,bindingHash:string):BudgetReservationGuard{
  const binding=scopeBinding(actor),approved=custody(binding,"approved"),authored=custody(binding,"authored"),answer=custody(binding,"answer"),retained=custody(binding,"retained");
  const expected={id:entry.record.task_id,actor:actor.principal.userId,scopeKey,turnId:entry.record.turn_id,bindingHash,
    organizationId:actor.project?.organizationId??null,projectAccessId:actor.project?.projectAccessId??null,
    projectId:actor.projectId,documentId:entry.record.document_id};
  return{sql:`EXISTS(SELECT 1 FROM assistant_specialist_tasks task,(SELECT ? AS value) expected
    JOIN consequential_executions execution ON execution.execution_id=task.task_id AND execution.actor_user_id=task.actor_user_id
      AND execution.operation='assistant-specialist' AND execution.binding_hash=json_extract(expected.value,'$.bindingHash')
      AND execution.organization_id IS task.organization_id AND execution.project_access_id IS task.project_access_id
      AND execution.project_id=task.project_id AND execution.document_id=task.document_id
    WHERE task.task_id=json_extract(expected.value,'$.id') AND task.actor_user_id=json_extract(expected.value,'$.actor')
      AND task.scope_key=json_extract(expected.value,'$.scopeKey') AND task.turn_id=json_extract(expected.value,'$.turnId')
      AND task.organization_id IS json_extract(expected.value,'$.organizationId') AND task.project_access_id IS json_extract(expected.value,'$.projectAccessId')
      AND task.project_id=json_extract(expected.value,'$.projectId') AND task.document_id=json_extract(expected.value,'$.documentId')
      AND task.token_reservation_id=task.task_id||':tokens:0' AND task.cost_reservation_id=task.task_id||':usd:0'
      AND json_extract(task.result_json,'$.specialistConsentVersion')=1 AND json_extract(task.result_json,'$.bindingHash')=json_extract(expected.value,'$.bindingHash')
      AND (NOT EXISTS(SELECT 1 FROM private_content approved WHERE approved.content_id=execution.consent_ref AND approved.owner_id=task.actor_user_id
        AND approved.kind='execution-consent' AND approved.redacted_at IS NULL AND approved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${approved.sql})
      OR NOT EXISTS(SELECT 1 FROM assistant_turns turn
        JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id
          AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id
          AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE turn.actor_user_id=task.actor_user_id AND turn.scope_key=task.scope_key AND turn.turn_id=task.turn_id
          AND turn.organization_id IS task.organization_id AND turn.project_access_id IS task.project_access_id AND turn.project_id=task.project_id
          AND ${authored.sql} AND ${answer.sql})
      OR (execution.result_ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private_content retained WHERE retained.content_id=execution.result_ref
        AND retained.owner_id=task.actor_user_id AND retained.kind='context-proposal' AND retained.redacted_at IS NULL
        AND retained.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${retained.sql}))))`,
    bindings:[JSON.stringify(expected),...approved.bindings,...authored.bindings,...answer.bindings,...retained.bindings]};
}

/** Final validation also covers visible paid turns that fell outside the eight-task feed. */
function assistantFeedTurnProof(actor:SpecialistActor,scopeKey:string,turn:SpecialistTurn):BudgetReservationGuard{
  const binding=scopeBinding(actor),authored=custody(binding,"authored"),answer=custody(binding,"answer");
  // Only used by the final SELECT-only feed batch, whose first AND last reads prove authority.
  // Reuse that same atomic proof; do not nest the full principal projection again per turn.
  const paid=paidReplyContentGuard(binding,scopeKey,"turn.turn_id");
  const expected=JSON.stringify({actor:actor.principal.userId,scopeKey,turnId:turn.id,user:turn.user,reply:turn.reply.text??null});
  return{sql:`NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks signed,(SELECT ? AS value) expected
      WHERE signed.actor_user_id=json_extract(expected.value,'$.actor') AND signed.scope_key=json_extract(expected.value,'$.scopeKey')
        AND signed.turn_id=json_extract(expected.value,'$.turnId') AND json_extract(signed.result_json,'$.specialistConsentVersion')=1)
    OR EXISTS(SELECT 1 FROM assistant_turns turn,(SELECT ? AS value) expected
      JOIN private_content authored ON authored.content_id=turn.user_content_ref AND authored.owner_id=turn.actor_user_id
        AND authored.kind='chat-user' AND authored.redacted_at IS NULL AND authored.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id
        AND answer.kind='chat-assistant' AND answer.redacted_at IS NULL AND answer.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE turn.actor_user_id=json_extract(expected.value,'$.actor') AND turn.scope_key=json_extract(expected.value,'$.scopeKey')
        AND turn.turn_id=json_extract(expected.value,'$.turnId') AND authored.content=json_extract(expected.value,'$.user')
        AND answer.content=json_extract(expected.value,'$.reply') AND ${authored.sql} AND ${answer.sql} AND ${paid.sql})`,
    bindings:[expected,expected,...authored.bindings,...answer.bindings,...paid.bindings]};
}

/** GET may certify a previously committed answer; it cannot recover, charge, or materialize one. */
export async function certifiedAssistantTaskFeed(env:WorkerEnv,actor:SpecialistActor,scopeKey:string,
  state:{context:AssistantContext;turns:SpecialistTurn[]},entries:AssistantTaskFeedEntry[]):Promise<Response>{
  const scope=actorScope(actor);
  if(!(scope?hasCapability(actor.principal,"project.read",scope):actor.principal.access.capabilities.includes("project.read")))
    return json({error:"assistant_read_scope_denied"},403);
  const authority=executionAdmissionGuard(actor.principal,{...scopeBinding(actor),pilotCohortId:null},null);
  const candidates=await Promise.all(entries.map(async(entry)=>{
    let metadata:Record<string,unknown>;try{metadata=record(JSON.parse(entry.record.result_json??"{}"));}catch{metadata={};}
    const hash=metadata.bindingHash;
    const signed=metadata.specialistConsentVersion===1&&typeof hash==="string"&&/^[a-f0-9]{64}$/u.test(hash)
      &&entry.record.actor_user_id===actor.principal.userId&&entry.record.scope_key===scopeKey
      &&entry.record.organization_id===(scope?.organizationId??null)&&entry.record.project_access_id===(scope?.projectAccessId??null)
      &&entry.record.project_id===actor.projectId;
    let review:AssistantCompletedReview|null=null,proof:BudgetReservationGuard={sql:"0",bindings:[]};
    const unavailable=signed?assistantFeedRetentionProof(actor,scopeKey,entry,hash as string):{sql:"0",bindings:[]};
    if(signed){
      try{
        const retained=await retainedConsent(env,actor,scopeKey,entry.record.turn_id,entry.record.task_id);
        if(retained){
          const saved=await canonicalResult(env,actor,entry.record,retained),model=retained.binding.steps[0]!.model;
          if(saved&&typeof saved.result.reply==="string"&&saved.result.sourceStatus==="original-approved-source"
            &&retained.row.binding_hash===hash&&retained.preview.projectId===retained.binding.projectId
            &&retained.preview.documentId===retained.binding.documentId&&retained.preview.canvasId===retained.binding.canvasId
            &&retained.preview.sourceHash===retained.binding.sourceHash&&retained.preview.models.length===1&&retained.preview.models[0]===model){
            const complete:BudgetReservationGuard={sql:`EXISTS(SELECT 1 FROM assistant_specialist_tasks task
              JOIN assistant_turns turn ON turn.actor_user_id=task.actor_user_id AND turn.scope_key=task.scope_key AND turn.turn_id=task.turn_id
              JOIN private_content answer ON answer.content_id=turn.assistant_content_ref AND answer.owner_id=turn.actor_user_id
              JOIN assistant_action_commits receipt ON receipt.commit_id='task:'||task.task_id AND receipt.verified=1
              WHERE task.task_id=? AND task.status='completed' AND turn.assistant_content_ref=? AND answer.content=?)`,
              bindings:[entry.record.task_id,retained.request.turn.assistant_content_ref,saved.result.reply]};
            proof=join(readAuthority(actor,retained),saved.proof,complete);
            review={turnId:retained.request.turnId,executionId:entry.record.task_id,
              quote:{...retained.preview,status:"completed",providerAvailable:Boolean(env.OPENAI_API_KEY),canExecute:false},
              originalRequest:{...retained.request.originalRequest,model,taskKind:retained.request.taskKind,
                sourceHash:retained.binding.sourceHash,conversationTurnIds:retained.request.conversation.map(item=>item.turnId)},
              result:{reply:saved.result.reply,sourceStatus:"original-approved-source"}};
          }
        }
      }catch{/* An unreadable or invalid retained record is not a completion certificate. */}
    }
    return{entry,hash:typeof hash==="string"?hash:null,review,proof,unavailable};
  }));
  const statements=[
    env.DB.prepare("SELECT CASE WHEN "+authority.sql+" THEN 1 ELSE 0 END AS feed_authorized").bind(...authority.bindings),
    ...candidates.map(candidate=>env.DB.prepare(`SELECT CASE WHEN ${candidate.proof.sql} THEN 1 ELSE 0 END AS certified_completed,
      CASE WHEN ${candidate.unavailable.sql} THEN 1 ELSE 0 END AS retention_unavailable`)
      .bind(...candidate.proof.bindings,...candidate.unavailable.bindings)),
    ...state.turns.map(turn=>{const proof=assistantFeedTurnProof(actor,scopeKey,turn);return env.DB.prepare("SELECT CASE WHEN ("+proof.sql+") THEN 1 ELSE 0 END AS feed_turn_retained").bind(...proof.bindings);}),
    env.DB.prepare("SELECT CASE WHEN "+authority.sql+" THEN 1 ELSE 0 END AS feed_authorized").bind(...authority.bindings),
  ];
  // One final SELECT-only snapshot: do not insert asynchronous work between this read and serialization.
  const reads=await env.DB.batch<{feed_authorized?:number;certified_completed?:number;retention_unavailable?:number;feed_turn_retained?:number}>(statements);
  if(reads[0]?.results[0]?.feed_authorized!==1||reads[reads.length-1]?.results[0]?.feed_authorized!==1)
    return json({error:"assistant_read_scope_denied"},403);
  const hidden=new Set<string>();
  const tasks=candidates.map((candidate,index)=>{
    const row=reads[index+1]?.results[0],display={...candidate.entry.display,...(candidate.entry.display.executionId?{canExecute:false}:{})};
    if(row?.retention_unavailable===1){
      hidden.add(candidate.entry.record.turn_id);
      return{...display,executionId:candidate.entry.record.task_id,bindingHash:candidate.hash,canExecute:false,retentionUnavailable:true};
    }
    if(row?.certified_completed===1&&candidate.review)
      return{...display,status:"completed",executionId:candidate.review.executionId,bindingHash:candidate.review.quote.bindingHash,
        canExecute:false,certifiedCompleted:true,completedReview:candidate.review};
    if(candidate.review||candidate.entry.record.status==="completed")hidden.add(candidate.entry.record.turn_id);
    return display;
  });
  for(const [index,turn]of state.turns.entries())if(reads[1+candidates.length+index]?.results[0]?.feed_turn_retained!==1)hidden.add(turn.id);
  return json({...state,turns:state.turns.filter(turn=>!hidden.has(turn.id)),context:{...state.context,
    recentTurns:state.context.recentTurns.filter(turn=>!hidden.has(turn.id.replace(/:(?:user|assistant)$/u,"")))},tasks});
}

async function recoverResult(env:WorkerEnv,actor:SpecialistActor,host:AssistantSpecialistHost,task:SpecialistTaskRecord,retained:Retained){
  await reconcileConsequentialUsage(env,actor.principal.userId,task.task_id);
  let saved=await canonicalResult(env,actor,task,retained);
  if(!saved){
    const completed=await readConsequentialExecution(env,actor.principal.userId,task.task_id);if(completed?.result_ref)fail("assistant_result_unavailable");
    const raw=await readRaw(env,actor,task,retained);if(!raw)return null;
    const paid=await accountRaw(env,actor,retained,raw),limit=retained.binding.steps[0]!;
    if(raw.receipt.httpStatus<200||raw.receipt.httpStatus>=300)fail("assistant_provider_failed_after_usage");
    if(paid.cost>limit.maximumMicrousd)fail("assistant_provider_budget_exceeded");
    const result=decodeAssistantProviderResult(paid.body,{model:limit.model as AssistantModel,maximumInputTokens:limit.inputTokens,maximumOutputTokens:limit.outputTokens,aliases:retained.request.aliases});
    const canonical:CanonicalResult={schema:1,executionId:task.task_id,bindingHash:retained.row.binding_hash,turnId:retained.request.turnId,reply:result.reply,actions:result.actions,providerResult:result,sourceStatus:"original-approved-source",sourceHash:retained.binding.sourceHash,maximumMicrousd:limit.maximumMicrousd,accountedMicrousd:paid.cost,billingStatus:paid.billingPending?"pending":"settled",noAutomaticRetry:true};
    await completeConsequentialExecution(env,actor.principal,retained.binding,task.task_id,canonical,raw.proof);saved=await canonicalResult(env,actor,task,retained);if(!saved)fail("assistant_result_unavailable");
  }
  let materializationPending=false;
  try{await host.commit(env,actor,task,saved.result.providerResult,retained.request.context,join(readAuthority(actor,retained),saved.proof));}
  catch{materializationPending=true;}
  const billingStatus=await consequentialUsageSettled(env,actor.principal.userId,task.task_id,0,saved.result.providerResult.usage.totalTokens,saved.result.accountedMicrousd)?"settled":"pending";
  return{result:{...saved.result,billingStatus},materializationPending,proof:saved.proof,...(!materializationPending?{turn:await host.turn(env,actor,retained.request.turnId)}:{})};
}

/** Only an actual recognized step state can describe provider submission. */
export function assistantSubmissionStatus(status:string|null|undefined){
  return status==="submitting"||status==="uncertain"||status==="usage-recorded"||status==="settled"?status
    :status==="quoted"||status==="reserved"||status==="not-submitted"?"not-submitted":undefined;
}

async function displayTask(env:WorkerEnv,actor:SpecialistActor,host:AssistantSpecialistHost,task:SpecialistTaskRecord,retained:Retained){
  const scope=retained.binding.scope??undefined,eligible=Boolean(env.OPENAI_API_KEY)&&actor.canPropose
    &&(scope?hasCapability(actor.principal,"project.output.request",scope):actor.principal.access.capabilities.includes("project.output.request"))
    &&actor.principal.access.permissionEpoch===retained.binding.permissionEpoch
    &&!modelEligibility(env,actor,host,retained.request.taskKind,retained.binding.steps[0]!.model as AssistantModel,retained.request.explicitModel).length;
  const proof=join(retentionProof(task,retained),executionAdmissionGuard(actor.principal,retained.binding,null,true),deadline(retained.request.sourceRightsValidUntil));
  const current=await env.DB.prepare(`SELECT task.status,task.error_code,step.status AS submission,
    CASE WHEN ?=1 AND execution.status='reserved' AND execution.result_ref IS NULL AND execution.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ?=strftime('%Y-%m','now')
      AND step.status IN('quoted','reserved') AND step.verified_tokens IS NULL AND step.verified_microusd IS NULL AND step.provider_request_id IS NULL
      AND task.provider_submitted=0 AND(task.status='queued' OR task.status='running' AND task.lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND(SELECT COUNT(*) FROM assistant_specialist_tasks other WHERE other.actor_user_id=task.actor_user_id AND other.task_id!=task.task_id AND other.status='running' AND other.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))<2
      AND ${proof.sql} THEN 1 ELSE 0 END AS can_execute
    FROM assistant_specialist_tasks task LEFT JOIN consequential_executions execution ON execution.execution_id=task.task_id AND execution.actor_user_id=task.actor_user_id
    LEFT JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id AND step.step_index=0 WHERE task.task_id=? AND task.actor_user_id=?`)
    .bind(Number(eligible),retained.binding.period,...proof.bindings,task.task_id,actor.principal.userId).first<{status:string;error_code:string|null;submission:string|null;can_execute:number}>();
  const submission=assistantSubmissionStatus(current?.submission);
  return{id:task.task_id,executionId:task.task_id,bindingHash:retained.row.binding_hash,turnId:task.turn_id,kind:task.task_kind,model:task.selected_model,status:current?.status??task.status,error:current?.error_code??task.error_code,estimatedMicrousd:Number(task.estimated_microusd),submission,canExecute:current?.can_execute===1};
}


/** The retained private approval cannot authorize a different or replaced execution row. */
function executionIdentityProof(retained:Retained):BudgetReservationGuard{
 const binding=retained.binding,expected={id:retained.row.execution_id,actor:binding.actorUserId,intent:binding.intentHash,hash:retained.row.binding_hash,consent:retained.row.consent_ref,stream:binding.streamId,project:binding.projectId,document:binding.documentId,organization:binding.scope?.organizationId??null,access:binding.scope?.projectAccessId??null};
 return{sql:`EXISTS(SELECT 1 FROM consequential_executions original,(SELECT ? AS value) expected
  WHERE (original.execution_id,original.actor_user_id,original.intent_hash,original.binding_hash,original.consent_ref,original.operation,original.stream_id,original.project_id,original.document_id)
    =(json_extract(expected.value,'$.id'),json_extract(expected.value,'$.actor'),json_extract(expected.value,'$.intent'),json_extract(expected.value,'$.hash'),json_extract(expected.value,'$.consent'),'assistant-specialist',json_extract(expected.value,'$.stream'),json_extract(expected.value,'$.project'),json_extract(expected.value,'$.document'))
    AND original.organization_id IS json_extract(expected.value,'$.organization') AND original.project_access_id IS json_extract(expected.value,'$.access'))`,bindings:[JSON.stringify(expected)]};
}

/** A structural free quote is unused only when its exact planned rows have no paid/admitted evidence. */
function unusedExecutionProof(retained:Retained):BudgetReservationGuard{
 const id=retained.row.execution_id,binding=retained.binding,expected={id,actor:binding.actorUserId,scopeKey:retained.request.scopeKey,turnId:retained.request.turnId,intent:binding.intentHash,
   steps:binding.steps.map((step,index)=>({index,tokens:step.inputTokens+step.outputTokens,microusd:step.maximumMicrousd,tokenId:id+":tokens:"+index,costId:id+":usd:"+index}))};
 const original=executionIdentityProof(retained);
 return join(original,{sql:`EXISTS(SELECT 1 FROM consequential_executions execution,(SELECT ? AS value) unused
  WHERE execution.execution_id=json_extract(unused.value,'$.id') AND execution.status='quoted' AND execution.result_ref IS NULL
    AND NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.task_id=execution.execution_id
      OR (task.actor_user_id=json_extract(unused.value,'$.actor') AND task.scope_key=json_extract(unused.value,'$.scopeKey') AND task.turn_id=json_extract(unused.value,'$.turnId')))
    AND NOT EXISTS(SELECT 1 FROM consequential_executions other WHERE other.execution_id!=execution.execution_id
      AND other.actor_user_id=json_extract(unused.value,'$.actor') AND other.intent_hash=json_extract(unused.value,'$.intent') AND other.operation='assistant-specialist'
      AND (other.status!='quoted' OR other.result_ref IS NOT NULL
        OR EXISTS(SELECT 1 FROM consequential_execution_steps paid WHERE paid.execution_id=other.execution_id AND
          (paid.status!='quoted' OR paid.verified_tokens IS NOT NULL OR paid.verified_microusd IS NOT NULL OR paid.provider_request_id IS NOT NULL))
        OR EXISTS(SELECT 1 FROM budget_reservations held WHERE held.correlation_id=other.execution_id)
        OR EXISTS(SELECT 1 FROM cost_budget_reservations held WHERE held.correlation_id=other.execution_id)))
    AND (SELECT COUNT(*) FROM consequential_execution_steps step WHERE step.execution_id=execution.execution_id)=json_array_length(unused.value,'$.steps')
    AND NOT EXISTS(SELECT 1 FROM json_each(unused.value,'$.steps') planned WHERE NOT EXISTS(
      SELECT 1 FROM consequential_execution_steps step WHERE
        (step.execution_id,step.step_index,step.status,step.maximum_tokens,step.maximum_microusd,step.token_reservation_id,step.cost_reservation_id)
        =(execution.execution_id,json_extract(planned.value,'$.index'),'quoted',json_extract(planned.value,'$.tokens'),json_extract(planned.value,'$.microusd'),json_extract(planned.value,'$.tokenId'),json_extract(planned.value,'$.costId'))
        AND step.verified_tokens IS NULL AND step.verified_microusd IS NULL AND step.provider_request_id IS NULL))
    AND NOT EXISTS(SELECT 1 FROM budget_reservations tokens WHERE tokens.correlation_id=execution.execution_id
      OR substr(tokens.reservation_id,1,length(execution.execution_id)+8)=execution.execution_id||':tokens:')
    AND NOT EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.correlation_id=execution.execution_id
      OR substr(cost.reservation_id,1,length(execution.execution_id)+5)=execution.execution_id||':usd:')
    AND NOT EXISTS(SELECT 1 FROM consequential_execution_steps other WHERE other.execution_id!=execution.execution_id AND
      (substr(other.token_reservation_id,1,length(execution.execution_id)+8)=execution.execution_id||':tokens:'
        OR substr(other.cost_reservation_id,1,length(execution.execution_id)+5)=execution.execution_id||':usd:')))`,bindings:[JSON.stringify(expected)]});
}

async function resultResponse(env:WorkerEnv,actor:SpecialistActor,host:AssistantSpecialistHost,retained:Retained,task:SpecialistTaskRecord|null,requestedExecutionId?:string,status=200){
  let recovered:Awaited<ReturnType<typeof recoverResult>>=null,recoveryError:string|null=null;
  if(task){try{recovered=await recoverResult(env,actor,host,task,retained);}catch(error){recoveryError=errorCode(error);}}
  const row=await readConsequentialExecution(env,actor.principal.userId,retained.row.execution_id);if(!row)fail("assistant_execution_unavailable");
  const shown=task?await displayTask(env,actor,host,task,retained):null;
  const originalRequest={...retained.request.originalRequest,model:retained.binding.steps[0]!.model,taskKind:retained.request.taskKind,sourceHash:retained.binding.sourceHash,conversationTurnIds:retained.request.conversation.map(item=>item.turnId)};
  const base=join(readAuthority(actor,retained),consentProof(retained),turnProof(retained.binding,retained.request)),resultProof=recovered?.proof??{sql:"1",bindings:[]};
  const unusedProof=!task?unusedExecutionProof(retained):{sql:"0",bindings:[]};
  const finalRead=await env.DB.prepare(`SELECT CASE WHEN ${base.sql} THEN 1 ELSE 0 END AS retained,CASE WHEN ${resultProof.sql} THEN 1 ELSE 0 END AS result_retained,CASE WHEN ${unusedProof.sql} THEN 1 ELSE 0 END AS unused_execution`).bind(...base.bindings,...resultProof.bindings,...unusedProof.bindings).first<{retained:number;result_retained:number;unused_execution:number}>();
  if(finalRead?.retained!==1)return json({error:"assistant_execution_unavailable",turnId:retained.request.turnId,executionId:retained.row.execution_id,retentionUnavailable:true,noAutomaticRetry:true},404);
  if(recovered&&finalRead.result_retained!==1){recovered=null;recoveryError="assistant_result_unavailable";}
  return json({turnId:retained.request.turnId,executionId:row.execution_id,quote:{...retained.preview,status:row.status,providerAvailable:Boolean(env.OPENAI_API_KEY),canExecute:shown?.canExecute??false},originalRequest,...(shown?{task:shown}:{}),
    ...(recovered?{result:recovered.result,materializationPending:recovered.materializationPending,...(recovered.turn!==undefined?{turn:recovered.turn}:{})}:{}),
    ...(recoveryError?{recoveryError,...(recoveryError==="assistant_result_unavailable"?{retainedResultUnavailable:true}:{})}:{}),...(finalRead.unused_execution===1?{unusedExecution:true as const}:{}),reused:Boolean(task),noAutomaticRetry:true,
    ...(requestedExecutionId&&requestedExecutionId!==row.execution_id?{requestedExecutionId,reusedExecutionId:row.execution_id,winnerExecutionId:row.execution_id}:{}),
  },status);
}

async function purchasePreparation(request:Request,env:WorkerEnv,actor:SpecialistActor,host:AssistantSpecialistHost,retained:Retained){
  if(actor.principal.access.permissionEpoch!==retained.binding.permissionEpoch)fail("assistant_authorization_changed");
  const source=await sourcePreparation(request,env,actor,retained.request.originalRequest,retained.request.conversation,retained.binding);
  if(source.sourceHash!==retained.binding.sourceHash||source.sourceRightsValidUntil!==retained.request.sourceRightsValidUntil)fail("assistant_consent_source_changed");
  const reasons=[...source.unavailableReasons,...modelEligibility(env,actor,host,retained.request.taskKind,retained.binding.steps[0]!.model as AssistantModel,retained.request.explicitModel)];
  if(reasons.length)fail(reasons[0]!);if(!env.OPENAI_API_KEY)fail("assistant_provider_unavailable");
  const proof=join(consentProof(retained),turnProof(retained.binding,retained.request,true),conversationProof(retained.binding,retained.request),source.sourceProof);
  if(!await env.DB.prepare("SELECT 1 AS current WHERE "+proof.sql).bind(...proof.bindings).first())fail("assistant_consent_source_changed");
  return{...source,proof};
}
async function refreshReadActor(request:Request,env:WorkerEnv,retained:Retained):Promise<SpecialistActor>{
  const auth=await requireUser(request,env,"viewer",{account:"principal"});if(auth.response||!auth.user||auth.user.userId!==retained.binding.actorUserId)fail("assistant_read_scope_denied");
  if(requireConsent(auth.user))fail("assistant_read_scope_denied");
  const scope=retained.binding.scope,principal=auth.user,project=scope?{contextId:"",organizationId:scope.organizationId,projectAccessId:scope.projectAccessId,projectId:scope.projectId,ownerUserId:scope.ownerUserId,principalUserId:principal.userId,role:principal.access.projects.find(item=>item.projectAccessId===scope.projectAccessId)?.role??"viewer",permissions:principal.access.capabilities.filter(capability=>hasCapability(principal,capability,scope)),expiresAt:""}:null;
  const actor:SpecialistActor={principal,project,projectId:retained.binding.projectId,surface:assistantSurfaceForRoute(retained.request.originalRequest.route),canPropose:scope?hasCapability(principal,"project.author",scope):principal.access.capabilities.includes("project.author")};
  const proof=readAuthority(actor,retained);if(!await env.DB.prepare("SELECT 1 AS current WHERE "+proof.sql).bind(...proof.bindings).first())fail("assistant_read_scope_denied");return actor;
}
async function finishFailed(env:WorkerEnv,task:SpecialistTaskRecord,leaseToken:string,code:string,paid:boolean){
  await env.DB.prepare("UPDATE assistant_specialist_tasks SET status=?,error_code=?,updated_at=?,completed_at=? WHERE task_id=? AND actor_user_id=? AND status!='completed' AND json_extract(result_json,'$.leaseToken')=? AND NOT EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=assistant_specialist_tasks.task_id AND execution.result_ref IS NOT NULL)")
    .bind(paid?"needs-review":"failed",code,new Date().toISOString(),new Date().toISOString(),task.task_id,task.actor_user_id,leaseToken).run();
}
/** Only an explicit execute request drives the existing queue. Reads never call this function. */
async function driveApprovedTask(request:Request,env:WorkerEnv,host:AssistantSpecialistHost,taskId:string,turnId:string){
  let task:SpecialistTaskRecord|null=null,retained:Retained|null=null,leaseToken="",ownsSubmission=false,providerInvoked=false;
  try{
    const authorization=await host.authorize(request,env),actor=authorization.authorized;if(authorization.response||!actor)return;
    const scopeKey=host.scopeKey(actor);retained=await retainedConsent(env,actor,scopeKey,turnId,taskId);if(!retained)return;
    task=await existingTask(env,actor,scopeKey,turnId);if(!task||task.task_id!==taskId)return;
    if(await recoverResult(env,actor,host,task,retained))return;
    if(retained.row.status!=="reserved")return;
    const step=await env.DB.prepare("SELECT status FROM consequential_execution_steps WHERE execution_id=? AND step_index=0").bind(taskId).first<{status:string}>();if(!step||!["quoted","reserved"].includes(step.status))return;
    const initial=await purchasePreparation(request,env,actor,host,retained),taskRetention=taskProof(task,retained),now=new Date().toISOString();leaseToken=crypto.randomUUID();
    const claim=await env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='running',updated_at=?,started_at=?,lease_expires_at=?,result_json=json_set(result_json,'$.leaseToken',?)
      WHERE task_id=? AND actor_user_id=? AND (status='queued' OR status='running' AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND provider_submitted=0)
        AND (SELECT COUNT(*) FROM assistant_specialist_tasks other WHERE other.actor_user_id=? AND other.task_id!=? AND other.status='running' AND other.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))<2
        AND ${taskRetention.sql} AND ${initial.proof.sql}`)
      .bind(now,now,new Date(Date.now()+10*60_000).toISOString(),leaseToken,taskId,actor.principal.userId,actor.principal.userId,taskId,...taskRetention.bindings,...initial.proof.bindings).run();
    if(Number(claim.meta.changes??0)!==1)return;
    const lease:BudgetReservationGuard={sql:"EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.task_id=? AND task.actor_user_id=? AND task.status='running' AND json_extract(task.result_json,'$.leaseToken')=? AND task.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[taskId,actor.principal.userId,leaseToken]};
    if(step.status==="quoted")await reserveConsequentialSteps(env,actor.principal,retained.binding,taskId,join(initial.proof,taskRetention,lease));
    const live=await host.authorize(request,env);if(live.response||!live.authorized)fail("assistant_authorization_changed");
    const currentActor=live.authorized,current=await purchasePreparation(request,env,currentActor,host,retained);
    const dispatch=join(current.proof,taskRetention,lease);
    await beginConsequentialStep(env,currentActor.principal,retained.binding,taskId,0,current.sourceHead,dispatch);ownsSubmission=true;
    const marked=await env.DB.prepare("UPDATE assistant_specialist_tasks SET provider_submitted=1,updated_at=? WHERE task_id=? AND actor_user_id=? AND status=\'running\' AND json_extract(result_json,\'$.leaseToken\')=?").bind(new Date().toISOString(),taskId,currentActor.principal.userId,leaseToken).run();if(Number(marked.meta.changes??0)!==1)fail("assistant_dispatch_authorization_changed");
    const finalAuthority=executionAdmissionGuard(currentActor.principal,retained.binding,current.sourceHead,true);
    const ready=await env.DB.prepare(`SELECT MIN(execution.expires_at,task.lease_expires_at,COALESCE(?,'9999-12-31T23:59:59.999Z'),
      COALESCE((SELECT expires_at FROM project_context_sessions WHERE context_id=?),'9999-12-31T23:59:59.999Z'),
      COALESCE((SELECT ends_at FROM pilot_cohorts WHERE cohort_id=?),'9999-12-31T23:59:59.999Z')) AS deadline
      FROM consequential_executions execution JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id AND step.step_index=0
      JOIN assistant_specialist_tasks task ON task.task_id=execution.execution_id WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.status='reserved' AND execution.result_ref IS NULL AND execution.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND step.status='submitting'
        AND ?=strftime('%Y-%m','now') AND ${dispatch.sql} AND ${finalAuthority.sql}`)
      .bind(current.sourceRightsValidUntil,retained.binding.contextSessionId,retained.binding.pilotCohortId,taskId,currentActor.principal.userId,retained.binding.period,...dispatch.bindings,...finalAuthority.bindings).first<{deadline:string}>();
    if(!ready||!Number.isFinite(Date.parse(ready.deadline))||Date.now()>=Date.parse(ready.deadline)||new Date().toISOString().slice(0,7)!==retained.binding.period||!env.OPENAI_API_KEY||modelEligibility(env,currentActor,host,retained.request.taskKind,retained.binding.steps[0]!.model as AssistantModel,retained.request.explicitModel).length)fail("assistant_dispatch_authorization_changed");
    const started=Date.now();providerInvoked=true;
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:"Bearer "+env.OPENAI_API_KEY,"content-type":"application/json","X-Client-Request-Id":taskId,...(env.OPENAI_PROJECT?{"OpenAI-Project":env.OPENAI_PROJECT}:{})},body:JSON.stringify(retained.request.providerRequest)});
    const text=await response.text();if(new TextEncoder().encode(text).byteLength>MAX_ASSISTANT_PROVIDER_RESPONSE_BYTES)fail("assistant_provider_response_unconfirmed");
    const readActor=await refreshReadActor(request,env,retained),raw:RawReceipt={schema:1,executionId:taskId,bindingHash:retained.row.binding_hash,providerRequestHash:await consentHash(retained.request.providerRequest),httpStatus:response.status,responseBody:text,receivedAt:new Date().toISOString(),latencyMs:Date.now()-started};
    await retainRaw(env,readActor,task,retained,raw);
    await env.DB.prepare("UPDATE assistant_specialist_tasks SET provider_submitted=1,updated_at=? WHERE task_id=? AND actor_user_id=? AND json_extract(result_json,'$.leaseToken')=?").bind(new Date().toISOString(),taskId,task.actor_user_id,leaseToken).run();
    await recoverResult(env,readActor,host,task,retained);
  }catch(error){
    if(!task||!retained||!leaseToken)return;
    const current=await env.DB.prepare("SELECT json_extract(result_json,'$.leaseToken') AS lease FROM assistant_specialist_tasks WHERE task_id=? AND actor_user_id=?").bind(task.task_id,task.actor_user_id).first<{lease:string}>();
    if(!ownsSubmission&&current?.lease!==leaseToken)return;
    if(ownsSubmission&&!providerInvoked)await proveConsequentialStepNotSubmitted(env,task.actor_user_id,task.task_id,0,retained.row.binding_hash);
    const code=errorCode(error);await failConsequentialExecution(env,task.actor_user_id,task.task_id,code);await finishFailed(env,task,leaseToken,code,providerInvoked);
  }
}
async function admitTask(env:WorkerEnv,actor:SpecialistActor,retained:Retained,sourceHead:number,sourceProof:BudgetReservationGuard,approvedHash:string){
  const {binding}=retained,id=retained.row.execution_id,spec=retained.request,step=binding.steps[0]!,now=new Date().toISOString();
  const single:BudgetReservationGuard={sql:"NOT EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.actor_user_id=? AND task.scope_key=? AND task.turn_id=?)",bindings:[actor.principal.userId,spec.scopeKey,spec.turnId]};
  const proof=join(consentProof(retained),turnProof(binding,spec),conversationProof(binding,spec),sourceProof,single);
  const exactExecution="EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.status='reserved')";
  const inserted=env.DB.prepare(`INSERT OR IGNORE INTO assistant_specialist_tasks(task_id,actor_user_id,scope_key,turn_id,organization_id,project_access_id,project_id,document_id,route_family,task_kind,selected_model,token_reservation_id,cost_reservation_id,estimated_microusd,maximum_input_tokens,maximum_output_tokens,locale,permission_epoch,status,error_code,created_at,updated_at,started_at,completed_at,lease_expires_at,provider_submitted,result_json)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',NULL,?,?,NULL,NULL,NULL,0,? WHERE ${exactExecution} AND ${proof.sql}`)
    .bind(id,actor.principal.userId,spec.scopeKey,spec.turnId,binding.scope?.organizationId??null,binding.scope?.projectAccessId??null,binding.projectId,binding.documentId,assistantSurfaceForRoute(spec.originalRequest.route).canonicalFamily,spec.taskKind,step.model,id+":tokens:0",id+":usd:0",step.maximumMicrousd,step.inputTokens,step.outputTokens,spec.originalRequest.locale,binding.permissionEpoch,now,now,JSON.stringify({specialistConsentVersion:1,bindingHash:retained.row.binding_hash}),id,actor.principal.userId,retained.row.binding_hash,...proof.bindings);
  const verified=env.DB.prepare(`INSERT OR IGNORE INTO assistant_action_commits(commit_id,verified,created_at)
    SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM assistant_specialist_tasks task WHERE task.task_id=? AND task.actor_user_id=? AND task.scope_key=? AND task.turn_id=? AND json_extract(task.result_json,'$.bindingHash')=?) THEN 1 ELSE 0 END,?
    WHERE ${exactExecution}`).bind("specialist-admission:"+id,id,actor.principal.userId,spec.scopeKey,spec.turnId,retained.row.binding_hash,now,id,actor.principal.userId,retained.row.binding_hash);
  return claimConsequentialExecution(env,actor.principal,binding,id,approvedHash,sourceHead,[inserted,verified],proof);
}

export async function handleAssistantSpecialistConsent(request:Request,env:WorkerEnv,execution:WorkerExecutionContext,host:AssistantSpecialistHost):Promise<Response>{
  if(request.method!=="POST")return json({error:"method_not_allowed"},405);
  let body:Record<string,unknown>;try{body=record(JSON.parse(await request.text()));}catch{return json({error:"assistant_request_invalid"},400);}
  const action=String(body.action??""),turnId=String(body.turnId??"");
  if(!["quote","execute","retrieve","resume"].includes(action)||!/^[a-zA-Z0-9_-]{8,80}$/u.test(turnId))return json({error:"assistant_request_invalid"},400);
  const fields=action==="quote"?["action","turnId","model"]:action==="resume"?["action","turnId","executionId"]:["action","turnId","executionId","approvedBindingHash"];
  if(Object.keys(body).some(key=>!fields.includes(key)))return json({error:"assistant_request_invalid"},400);
  const authorization=await host.authorize(request,env);if(authorization.response||!authorization.authorized)return authorization.response!;
  const actor=authorization.authorized,scopeKey=host.scopeKey(actor);await host.ensure(env);
  try{
    if(action==="quote"){
      const existing=await existingTask(env,actor,scopeKey,turnId);
      if(existing){const retained=await retainedConsent(env,actor,scopeKey,turnId,existing.task_id);if(!retained)return json({error:"assistant_existing_task_unavailable",turnId,executionId:existing.task_id,retentionUnavailable:true,noAutomaticRetry:true},409);return resultResponse(env,actor,host,retained,existing);}
      const turn=await savedTurn(env,actor,scopeKey,turnId);if(!turn)return json({error:"assistant_turn_snapshot_unavailable"},409);
      const prepared=await prepareQuote(request,env,actor,host,turn,body.model);
      const quote=await quoteConsequentialExecution(env,actor.principal,prepared.binding,prepared.privateInput,prepared.sourceHead,Infinity);
      const retained=await retainedConsent(env,actor,scopeKey,turnId,quote.executionId);if(!retained)return json({error:"assistant_execution_unavailable",turnId,executionId:quote.executionId,retentionUnavailable:true},404);
      const admitted=await existingTask(env,actor,scopeKey,turnId);
      if(admitted){const winner=admitted.task_id===quote.executionId?retained:await retainedConsent(env,actor,scopeKey,turnId,admitted.task_id);if(!winner)return json({error:"assistant_existing_task_unavailable",turnId,executionId:admitted.task_id,retentionUnavailable:true,noAutomaticRetry:true},409);return resultResponse(env,actor,host,winner,admitted);}
      let availableMicrousd:number|null=null;try{const budgets=await readAccountBudgets(env,actor.principal.userId,retained.binding.scope?.organizationId);availableMicrousd=Math.min(budgets.costBudgets.user.remainingMicrousd,budgets.costBudgets.workspace.remainingMicrousd);}catch{/* Free disclosure remains available. */}
      const finalRead=join(readAuthority(actor,retained),consentProof(retained),turnProof(retained.binding,retained.request));
      if(!await env.DB.prepare("SELECT 1 AS retained WHERE "+finalRead.sql).bind(...finalRead.bindings).first())return json({error:"assistant_execution_unavailable",turnId,executionId:quote.executionId,retentionUnavailable:true},404);
      const preview=retained.preview,budgetAvailable=availableMicrousd!==null&&availableMicrousd>=preview.maximumMicrousd,providerAvailable=Boolean(env.OPENAI_API_KEY),originalRequest={...retained.request.originalRequest,model:retained.binding.steps[0]!.model,taskKind:retained.request.taskKind,sourceHash:retained.binding.sourceHash,conversationTurnIds:retained.request.conversation.map(item=>item.turnId)};
      return json({turnId,executionId:preview.executionId,quote:{...preview,status:retained.row.status,providerAvailable,budgetAvailable,availableMicrousd,unavailableReasons:prepared.unavailableReasons,canExecute:retained.row.status==="quoted"&&providerAvailable&&budgetAvailable&&!prepared.unavailableReasons.length},originalRequest,noAutomaticRetry:true});
    }
    const id=String(body.executionId??""),hash=String(body.approvedBindingHash??"");
    if(!/^[a-zA-Z0-9_-]{8,80}$/u.test(id)||action!=="resume"&&!/^[a-f0-9]{64}$/u.test(hash))return json({error:"assistant_approval_required"},428);
    const retained=await retainedConsent(env,actor,scopeKey,turnId,id);if(!retained)return json({error:"assistant_execution_unavailable",turnId,executionId:id,retentionUnavailable:true},404);
    if(action!=="resume"&&retained.row.binding_hash!==hash)return json({error:"assistant_consent_changed"},409);
    let task=await existingTask(env,actor,scopeKey,turnId);
    if(task&&task.task_id!==id){
      const winner=await retainedConsent(env,actor,scopeKey,turnId,task.task_id);if(!winner)return json({error:"assistant_existing_task_unavailable",retentionUnavailable:true,noAutomaticRetry:true},409);return resultResponse(env,actor,host,winner,task,id);
    }
    if(action==="retrieve"||action==="resume")return resultResponse(env,actor,host,retained,task,id);
    if(task){const step=await env.DB.prepare("SELECT status FROM consequential_execution_steps WHERE execution_id=? AND step_index=0").bind(id).first<{status:string}>();if(retained.row.status!=="reserved"||!step||!["quoted","reserved"].includes(step.status))return resultResponse(env,actor,host,retained,task,id);}
    const current=await purchasePreparation(request,env,actor,host,retained);
    if(!task){
      const admitted=await admitTask(env,actor,retained,current.sourceHead,current.sourceProof,hash);task=await existingTask(env,actor,scopeKey,turnId);
      if(!task)return json({error:admitted.error??"assistant_consent_changed",noAutomaticRetry:true},admitted.status??409);
      if(task.task_id!==id){const winner=await retainedConsent(env,actor,scopeKey,turnId,task.task_id);if(!winner)return json({error:"assistant_existing_task_unavailable",retentionUnavailable:true},409);return resultResponse(env,actor,host,winner,task,id);}
    }
    const background=new Request(request.url,{method:"GET",headers:request.headers});
    execution.waitUntil(driveApprovedTask(background,env,host,id,turnId).catch(()=>undefined));
    return resultResponse(env,actor,host,retained,task,id,202);
  }catch(error){const code=errorCode(error);return json({error:code,noAutomaticRetry:true,...(code==="assistant_read_scope_denied"?{retentionUnavailable:true}:{})},code==="assistant_provider_unavailable"?503:/rights|denied|authorization|custody/u.test(code)?403:code.includes("too_large")?413:409);}
}
/** Unsigned legacy work is parked, never replayed or declared free by a read. */
export async function parkUnsignedAssistantTasks(env:WorkerEnv,actor:SpecialistActor,scopeKey:string){
  const keys=[scopeKey,...(actor.legacyScopeKey?[actor.legacyScopeKey]:[])];
  for(const key of keys)await env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='needs-review',error_code='assistant_legacy_approval_required',updated_at=?
    WHERE actor_user_id=? AND scope_key=? AND status IN('queued','running') AND NOT EXISTS(SELECT 1 FROM consequential_executions execution
      WHERE execution.execution_id=assistant_specialist_tasks.task_id AND execution.actor_user_id=assistant_specialist_tasks.actor_user_id AND execution.operation='assistant-specialist'
        AND json_extract(assistant_specialist_tasks.result_json,'$.specialistConsentVersion')=1 AND execution.binding_hash=json_extract(assistant_specialist_tasks.result_json,'$.bindingHash'))`)
    .bind(new Date().toISOString(),actor.principal.userId,key).run();
}
export async function cancelConsentedAssistantTask(env:WorkerEnv,actor:SpecialistActor,host:AssistantSpecialistHost,task:SpecialistTaskRecord):Promise<Response|null>{
  if(!task.result_json)return null;
  const scope=actorScope(actor),canStop=(["project.author","project.output.request"]as const).every(capability=>scope?hasCapability(actor.principal,capability,scope):actor.principal.access.capabilities.includes(capability));
  if(!canStop)return json({error:"assistant_stop_scope_denied",noAutomaticRetry:true},403);
  const retained=await retainedConsent(env,actor,host.scopeKey(actor),task.turn_id,task.task_id);if(!retained)return json({error:"assistant_execution_unavailable",retentionUnavailable:true,noAutomaticRetry:true},404);
  const proof=join(readAuthority(actor,retained),retentionProof(task,retained),executionIdentityProof(retained));
  if(!await env.DB.prepare("SELECT 1 AS current WHERE "+proof.sql).bind(...proof.bindings).first())return json({error:"assistant_read_scope_denied",noAutomaticRetry:true},403);
  if(retained.row.status==="completed"||retained.row.result_ref)return resultResponse(env,actor,host,retained,task,task.task_id);
  const now=new Date().toISOString();
  const stopped=env.DB.prepare(`UPDATE assistant_specialist_tasks SET status='canceled',error_code='assistant_canceled',updated_at=?,completed_at=?
    WHERE task_id=? AND actor_user_id=? AND status!='completed'
      AND NOT EXISTS(SELECT 1 FROM consequential_executions execution WHERE execution.execution_id=assistant_specialist_tasks.task_id AND execution.result_ref IS NOT NULL)
      AND (${proof.sql})`).bind(now,now,task.task_id,actor.principal.userId,...proof.bindings);
  // Targeted UPSERT does not suppress CHECK failure when a prior Stop receipt already exists.
  const receipt=env.DB.prepare(`INSERT INTO assistant_action_commits(commit_id,verified,created_at)
    VALUES(?,CASE WHEN ${proof.sql} THEN 1 ELSE 0 END,?)
    ON CONFLICT(commit_id) DO UPDATE SET verified=excluded.verified`).bind("specialist-stop:"+task.task_id,...proof.bindings,now);
  try{await failConsequentialExecution(env,actor.principal.userId,task.task_id,"assistant_canceled",{guard:proof,finalStatements:[stopped,receipt]});}
  catch{return json({error:"assistant_stop_unconfirmed",noAutomaticRetry:true},409);}
  return resultResponse(env,actor,host,retained,task,task.task_id);
}

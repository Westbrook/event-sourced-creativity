import { recordStoryboardReadFailure, type StoryboardReadStage } from "./storyboard-read-diagnostic.ts";
import { canonicalJson } from "../src/experiences/compiler.ts";
import { parseStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import { readOutputStoryboardCompletion } from "./output-storyboard-completion.ts";
import { outputSlotFromRow, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";
import type { WorkerEnv } from "./runtime.ts";

const fail=():never=>{throw new Error("output_storyboard_retained_unavailable");};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:fail();
const same=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const bounded=(v:string)=>{if(typeof v!=="string"||new TextEncoder().encode(v).length>1_048_576)return fail();return v;};
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))),n=>n.toString(16).padStart(2,"0")).join("");

/** The existing hosted retained reader owns current principal, Document and
 * revision custody. Revalidate the original completed five-call evidence and
 * four physical PNGs here, without dispatch, grant renewal or new authority.
 * Returned SQL joins the reader's final auth/private-source witness. */
export async function readRetainedOutputStoryboard(env:WorkerEnv,input:{
 ownerId:string;completionId:string;documentId:string;projectId:string;artifactId:string;contentId:string;inputId:string;
 rawContent:string;contentExpiresAt:string;completionRaw:string;signal?:AbortSignal;
}){
 let diagnosticStage:StoryboardReadStage="retained_receipt";
 try{
 const payload=object(JSON.parse(bounded(input.completionRaw))),settings=object(payload.settings),receipt=object(settings.output_storyboard);
 const contract=parseStoryboardOutputContract(receipt.contract);
 if(!contract||receipt.version!=="output-storyboard-completion-v1"||receipt.frameCount!==4||receipt.providerCallCount!==5
  ||receipt.actorUserId!==input.ownerId||receipt.documentId!==input.documentId||receipt.artifactId!==input.artifactId
  ||payload.source_surface!=="outputs"||payload.artifact_kind!=="storyboard"||payload.content_ref!==input.contentId
  ||payload.input_ref!==input.inputId||payload.document_id!==input.documentId||payload.project_id!==input.projectId
  ||payload.requested_by_user_id!==input.ownerId||payload.item_count!==4||!Array.isArray(payload.items)||payload.items.length!==4
  ||settings.item_count!==4||settings.production_mode!=="manual"||typeof receipt.jobId!=="string"||typeof receipt.slotId!=="string")return fail();
 diagnosticStage="retained_job";
 const jobSql=`job_id=? AND owner_id=? AND document_id=? AND stream_id=?
  AND EXISTS(SELECT 1 FROM output_operation_slots relation WHERE relation.job_id=document_jobs.job_id
   AND relation.scope_key=json_extract(document_jobs.result_json,'$.outputExecution.scopeKey') AND relation.slot_id=?) AND kind='render_document'
  AND source_surface='outputs' AND status='completed' AND error_message IS NULL AND completed_at IS NOT NULL
  AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(result_json AS BLOB))<=1048576 AND length(CAST(request_json AS BLOB))<=1048576
  AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind IN('job','document') AND resource_id IN(document_jobs.job_id,document_jobs.document_id))`;
 const jobBindings=[receipt.jobId,input.ownerId,input.documentId,`creative:${input.ownerId}`,receipt.slotId];
 const job=await env.DB.prepare(`SELECT document_jobs.*,(SELECT relation.slot_id FROM output_operation_slots relation
  WHERE relation.job_id=document_jobs.job_id AND relation.scope_key=json_extract(document_jobs.result_json,'$.outputExecution.scopeKey')
   AND relation.slot_id=json_extract(document_jobs.result_json,'$.outputExecution.slotId')) AS output_slot_id
  FROM document_jobs WHERE ${jobSql}`).bind(...jobBindings).first<DocumentJobRow>();
 if(!job||typeof job.result_json!=="string"||job.correlation_id!==receipt.correlationId||job.attempt_count!==receipt.attempt)return fail();
 diagnosticStage="retained_slot";
 const slotSql=`slot.job_id=? AND slot.slot_id=? AND slot.status='succeeded' AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
  AND plan.scope_kind='personal' AND plan.owner_user_id=? AND plan.document_id=? AND plan.project_id=?
  AND plan.organization_id IS NULL AND plan.project_access_id IS NULL AND grant_row.actor_user_id=plan.owner_user_id
  AND grant_row.context_id IS NULL AND grant_row.status='completed' AND slot.outcome_event_id=?`;
 const slotBindings=[job.job_id,receipt.slotId,input.ownerId,input.documentId,input.projectId,input.completionId];
 const slotFrom=`output_operation_slots slot JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id`;
 const row=await env.DB.prepare(`SELECT slot.* FROM ${slotFrom} WHERE ${slotSql}`).bind(...slotBindings).first<Record<string,unknown>>();
 if(!row)return fail();
 diagnosticStage="retained_reference";
 const scope:OutputScope={kind:"personal",key:String(row.scope_key),ownerUserId:input.ownerId,actorUserId:input.ownerId,
  documentId:input.documentId,projectId:input.projectId,organizationId:null,projectAccessId:null,contextId:null};
 const slot=outputSlotFromRow(scope.key,row),request=object(JSON.parse(job.request_json)),checkpoint=object(JSON.parse(job.result_json));
 const reference={scopeKey:scope.key,grantId:slot.grantId,slotId:slot.slotId,planRevisionId:slot.planRevisionId,targetId:slot.targetId,targetContractDigest:slot.targetContractDigest,sourceDigest:slot.sourceDigest};
 // Admission persists the execution reference in result_json, not the creative
 // request payload. A legacy duplicate may agree, but never override custody.
 if(Object.hasOwn(request,"outputExecution")&&!same(request.outputExecution,reference)||!same(checkpoint.outputExecution,reference)||request.artifactKind!=="storyboard"
  ||request.productionMode!=="manual"||request.itemCount!==4||!same(request.outputStoryboard,contract)
  ||checkpoint.artifactId!==input.artifactId||checkpoint.artifactKind!=="storyboard"
  ||!Array.isArray(checkpoint.appendedEventIds)||!checkpoint.appendedEventIds.includes(input.completionId))return fail();
 diagnosticStage="retained_input";
 const invocationSql=`content_id=? AND owner_id=? AND kind='document-artifact-input' AND redacted_at IS NULL
  AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576
  AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`;
 const invocationBindings=[input.inputId,input.ownerId];
 const invocation=await env.DB.prepare(`SELECT content,expires_at FROM private_content WHERE ${invocationSql}`).bind(...invocationBindings).first<{content:string;expires_at:string}>();
 if(!invocation)return fail();
 diagnosticStage="retained_hashes";
 if(await sha(bounded(input.rawContent))!==settings.storyboard_content_sha256||await sha(invocation.content)!==settings.storyboard_input_sha256)return fail();
 diagnosticStage="retained_invocation";
 const original=object(JSON.parse(invocation.content)),originalRequest=object(original.request),planner=object(original.planner);
 if(original.schema_version!==1||original.artifact_id!==input.artifactId||original.artifact_kind!=="storyboard"
  ||original.document_id!==input.documentId||original.project_id!==input.projectId||!same(original.output_storyboard,receipt)
  ||originalRequest.item_count!==4||originalRequest.production_mode!=="manual"||originalRequest.source_surface!=="outputs"
  ||planner.provider!=="openai"||planner.response_id!==receipt.plannerResponseId)return fail();
 const expiresMs=Math.min(Date.parse(input.contentExpiresAt),Date.parse(invocation.expires_at),Date.parse(job.expires_at));
 if(!Number.isFinite(expiresMs)||expiresMs<=Date.now()||input.signal?.aborted)return fail();
 diagnosticStage="completion_evidence";
 const result=await readOutputStoryboardCompletion(env,scope,slot,job,request,input.artifactId,JSON.parse(bounded(input.rawContent)),checkpoint.renderedItems,{signal:input.signal,deadlineMs:expiresMs});
 diagnosticStage="retained_receipt_match";
 if(!same(result.receipt,receipt))return fail();
 const assertions:OutputSqlAssertion[]=[...result.assertions,
  {sql:`EXISTS(SELECT 1 FROM document_jobs WHERE ${jobSql} AND result_json=? AND request_json=? AND correlation_id=? AND attempt_count=? AND expires_at=?)`,bindings:[...jobBindings,job.result_json,job.request_json,job.correlation_id,job.attempt_count,job.expires_at]},
  {sql:`EXISTS(SELECT 1 FROM ${slotFrom} WHERE ${slotSql} AND slot.scope_key=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_id=? AND slot.target_contract_digest=? AND slot.source_digest=?)`,bindings:[...slotBindings,scope.key,slot.grantId,slot.planRevisionId,slot.targetId,slot.targetContractDigest,slot.sourceDigest]},
  {sql:`EXISTS(SELECT 1 FROM private_content WHERE ${invocationSql} AND content=? AND expires_at=?)`,bindings:[...invocationBindings,invocation.content,invocation.expires_at],deadlineMs:Date.parse(invocation.expires_at)}];
 diagnosticStage="retained_publication";
 for(let index=0;index<4;index++){
  const frame=result.receipt.frames[index]!,item=object(payload.items[index]);
  if(item.id!==frame.id||item.media_url!==frame.mediaUrl||item.media_type!==frame.mimeType||item.width!==frame.width||item.height!==frame.height)return fail();
  const sql="EXISTS(SELECT 1 FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=? AND content_sha256=? AND status='written' AND write_acknowledged=1 AND publication_event_id=?)";
  const bindings=[scope.key,slot.slotId,decodeURIComponent(frame.mediaUrl.slice("/api/media/".length)),frame.sha256,input.completionId];
  if(!await env.DB.prepare("SELECT 1 WHERE "+sql).bind(...bindings).first())return fail();
  assertions.push({sql,bindings});
 }
 diagnosticStage="retained_lifetime";
 const deadlineMs=Math.min(expiresMs,...assertions.flatMap(a=>a.deadlineMs===undefined?[]:[a.deadlineMs]));
 if(!Number.isFinite(deadlineMs)||Date.now()>=deadlineMs||input.signal?.aborted)return fail();
 // Pack the closed server-authored bindings once; the final retained SELECT
 // must not grow one transport parameter per frame/private-body comparison.
 diagnosticStage="retained_witness";
 const witnessJson=JSON.stringify(assertions.map(a=>a.bindings??[]));
 bounded(witnessJson);
 const witnessSql=assertions.map((a,index)=>{
  const parts=a.sql.split("?"),bindings=a.bindings??[];
  if(parts.length!==bindings.length+1)return fail();
  return "("+parts.map((part,position)=>part+(position<bindings.length?`(SELECT json_extract(bindings,'$[${index}][${position}]') FROM storyboard_witness)`:"")).join("")+")";
 }).join(" AND ");
 return {assertions,expiresAt:new Date(deadlineMs).toISOString(),witness:{json:witnessJson,sql:witnessSql}};
 }catch(error){throw recordStoryboardReadFailure(error,diagnosticStage);}
}

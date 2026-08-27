import type { ApprovedContextProposal, ContextChange, ContextProposalSelection } from "../src/model/context-proposal-application.ts";
import type { EventInput } from "../src/model/events.ts";
import { consentHash, executionAdmissionGuard, executionAuthorityCurrent, type ConsequentialBinding } from "./consequential-consent.ts";
import { storePrivateContent, type PilotUser } from "./pilot-policy.ts";
import { appendProjectEvents, type ProjectRequestContext } from "./project-access.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, type WorkerEnv } from "./runtime.ts";

export type AuthoringPlan={operation:"context-proposal"|"document-duplicate";binding:ConsequentialBinding;sourceHead:number;events:EventInput[];changes:ContextChange[];review?:{sourceText:string;proposals:ApprovedContextProposal[];selections:ContextProposalSelection[]};result:{blockIds:string[];relationCount:number;documentId?:string};expiresAt:string};
export type AuthoringPreview={previewId:string;approvalHash:string;sourceHash:string;projectId:string;documentId:string;canvasId:string|null;blockId:string;changes:ContextChange[];events:EventInput[];review?:AuthoringPlan["review"];blockCount:number;relationCount:number;expiresAt:string};
export type RetainedAuthoringPreview={plan:AuthoringPlan;approvalHash:string;state?:"review"|"applying"|"applied"|"dismissed";leaseId?:string;leaseExpiresAt?:string};
const correlationFor=(userId:string,id:string)=>`authoring:${userId}:${id}`;
// Retention erases content to an empty string. CASE keeps every JSON predicate safe even
// when SQLite reorders filters; erased previews are never reconstructed or modified.
const privateJson = "CASE WHEN redacted_at IS NULL AND json_valid(content) THEN content ELSE '{}' END";

export async function storeAuthoringPreview(env:WorkerEnv,user:PilotUser,plan:AuthoringPlan):Promise<AuthoringPreview>{
  const approvalHash=await consentHash(plan),saved=await storePrivateContent(env,user.userId,"authoring-preview",JSON.stringify({plan,approvalHash,state:"review"}),plan.binding.scope??undefined);
  const guard=executionAdmissionGuard(user,plan.binding,null);
  await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','dismissed') WHERE owner_id=? AND kind='authoring-preview' AND rowid<(SELECT rowid FROM private_content WHERE content_id=?)
    AND COALESCE(json_extract(${privateJson},'$.state'),'review')='review' AND json_extract(${privateJson},'$.plan.operation')=?
    AND json_extract(${privateJson},'$.plan.binding.projectId')=? AND json_extract(${privateJson},'$.plan.binding.documentId')=? AND json_extract(${privateJson},'$.plan.binding.blockId')=?
    AND COALESCE(json_extract(${privateJson},'$.plan.binding.canvasId'),'')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.organizationId'),'')=?
    AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.projectAccessId'),'')=? AND ${guard.sql}`)
    .bind(user.userId,saved.contentId,plan.operation,plan.binding.projectId,plan.binding.documentId,plan.binding.blockId,plan.binding.canvasId??"",plan.binding.scope?.organizationId??"",plan.binding.scope?.projectAccessId??"",...guard.bindings).run();
  return authoringPreview(saved.contentId,approvalHash,plan);
}
export function authoringPreview(previewId:string,approvalHash:string,plan:AuthoringPlan):AuthoringPreview{
  return{previewId,approvalHash,sourceHash:plan.binding.sourceHash,projectId:plan.binding.projectId,documentId:plan.binding.documentId,canvasId:plan.binding.canvasId,blockId:plan.binding.blockId,changes:plan.changes,events:plan.events,...(plan.review?{review:plan.review}:{}),blockCount:plan.result.blockIds.length,relationCount:plan.result.relationCount,expiresAt:plan.expiresAt};
}
export async function readAuthoringPreview(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string){
  const guard=executionAdmissionGuard(user,binding,null),now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='authoring-preview' AND redacted_at IS NULL AND json_valid(content) AND expires_at>? AND ${guard.sql}`)
    .bind(id,user.userId,now,...guard.bindings).first<{content:string}>();
  return row?JSON.parse(row.content) as RetainedAuthoringPreview:null;
}
export async function readAuthoringCommit(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string){
  const guard=executionAdmissionGuard(user,binding,null);
  const row=await env.DB.prepare(`SELECT result_json,approval_hash FROM authoring_commits WHERE preview_id=? AND actor_user_id=? AND project_id=? AND document_id=? AND block_id=? AND COALESCE(canvas_id,'')=? AND operation=?
    AND COALESCE(organization_id,'')=? AND COALESCE(project_access_id,'')=? AND ${guard.sql}`)
    .bind(id,user.userId,binding.projectId,binding.documentId,binding.blockId,binding.canvasId??"",binding.operation,binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",...guard.bindings).first<{result_json:string;approval_hash:string}>();
  return row?{result:JSON.parse(row.result_json) as AuthoringPlan["result"],approvalHash:row.approval_hash}:null;
}

/** Rediscovery uses actor-private server storage, not proposal text or opaque receipts in browser storage. */
export async function latestAuthoringPreview(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding){
  const guard=executionAdmissionGuard(user,binding,null),now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT content_id,content FROM private_content WHERE owner_id=? AND kind='authoring-preview' AND redacted_at IS NULL AND expires_at>?
    AND json_extract(${privateJson},'$.plan.operation')=? AND json_extract(${privateJson},'$.plan.binding.projectId')=? AND json_extract(${privateJson},'$.plan.binding.documentId')=?
    AND json_extract(${privateJson},'$.plan.binding.blockId')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.canvasId'),'')=?
    AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.organizationId'),'')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.projectAccessId'),'')=?
    AND COALESCE(json_extract(${privateJson},'$.state'),'review')!='dismissed' AND ${guard.sql}
    ORDER BY CASE json_extract(${privateJson},'$.state') WHEN 'applying' THEN 0 ELSE 1 END,rowid DESC LIMIT 1`)
    .bind(user.userId,now,binding.operation,binding.projectId,binding.documentId,binding.blockId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",...guard.bindings).first<{content_id:string;content:string}>();
  return row?{previewId:row.content_id,saved:JSON.parse(row.content) as RetainedAuthoringPreview}:null;
}

/** An expired lease is reusable only after an atomic state change prevents its old worker from ever committing. */
export async function releaseExpiredAuthoringLease(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string){
  const guard=executionAdmissionGuard(user,binding,null);
  await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','review','$.leaseId','') WHERE content_id=? AND owner_id=? AND kind='authoring-preview'
    AND json_extract(${privateJson},'$.state')='applying' AND json_extract(${privateJson},'$.leaseExpiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND json_extract(${privateJson},'$.plan.operation')=? AND json_extract(${privateJson},'$.plan.binding.projectId')=? AND json_extract(${privateJson},'$.plan.binding.documentId')=?
    AND json_extract(${privateJson},'$.plan.binding.blockId')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.canvasId'),'')=?
    AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.organizationId'),'')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.projectAccessId'),'')=?
    AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?) AND ${guard.sql}`)
    .bind(id,user.userId,binding.operation,binding.projectId,binding.documentId,binding.blockId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",id,...guard.bindings).run();
}

/** Read execution outcome and review visibility in one SQL snapshot. Dismissing or expiring
 * a private review cannot erase its canonical receipt or create a torn not-applied response. */
export async function readAuthoringState(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string){
  await releaseExpiredAuthoringLease(env,user,binding,id);
  const guard=executionAdmissionGuard(user,binding,null);
  const row=await env.DB.prepare(`SELECT saved.content AS preview_content,receipt.result_json AS receipt_result_json,receipt.approval_hash AS receipt_approval_hash
    FROM(SELECT ? AS preview_id) requested
    LEFT JOIN private_content saved ON saved.content_id=requested.preview_id AND saved.owner_id=? AND saved.kind='authoring-preview'
      AND saved.redacted_at IS NULL AND json_valid(saved.content) AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    LEFT JOIN authoring_commits receipt ON receipt.preview_id=requested.preview_id AND receipt.actor_user_id=? AND receipt.operation=?
      AND receipt.project_id=? AND receipt.document_id=? AND receipt.block_id=? AND COALESCE(receipt.canvas_id,'')=?
      AND COALESCE(receipt.organization_id,'')=? AND COALESCE(receipt.project_access_id,'')=?
    WHERE ${guard.sql}`)
    .bind(id,user.userId,user.userId,binding.operation,binding.projectId,binding.documentId,binding.blockId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",...guard.bindings)
    .first<{preview_content:string|null;receipt_result_json:string|null;receipt_approval_hash:string|null}>();
  if(!row||!await executionAuthorityCurrent(env,user,binding,null))return null;
  const saved=row.preview_content?JSON.parse(row.preview_content) as RetainedAuthoringPreview:null;
  const committed=row.receipt_result_json&&row.receipt_approval_hash?{result:JSON.parse(row.receipt_result_json) as AuthoringPlan["result"],approvalHash:row.receipt_approval_hash}:null;
  const receiptPending=!committed&&saved?.state==="applied";
  return{committed,saved,receiptPending,status:committed?"applied" as const:saved?.state==="applying"||receiptPending?"applying" as const:"not-applied" as const};
}
export async function dismissAuthoringPreview(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string,hash:string){
  const guard=executionAdmissionGuard(user,binding,null);
  const result=await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','dismissed') WHERE content_id=? AND owner_id=? AND kind='authoring-preview'
    AND json_extract(${privateJson},'$.approvalHash')=? AND COALESCE(json_extract(${privateJson},'$.state'),'review') IN('review','applied','dismissed') AND ${guard.sql}`)
    .bind(id,user.userId,hash,...guard.bindings).run();
  return Number(result.meta.changes??0)===1;
}

/** The final CHECK receipt rolls back every preceding event if any admission or event write failed. */
export async function commitAuthoringPlan(env:WorkerEnv,user:PilotUser,current:ConsequentialBinding,shared:ProjectRequestContext|null|undefined,previewId:string,approvalHash:string,plan:AuthoringPlan,writeHead=plan.sourceHead){
  if(plan.binding.actorUserId!==user.userId||plan.binding.sourceHash!==current.sourceHash||plan.binding.permissionEpoch!==current.permissionEpoch
    ||plan.binding.contextSessionId!==current.contextSessionId||plan.expiresAt<=new Date().toISOString()||await consentHash(plan)!==approvalHash)throw new Error("authoring_preview_stale");
  const guard=executionAdmissionGuard(user,current,null),now=new Date().toISOString(),streamId=current.streamId,correlation=correlationFor(user.userId,previewId);
  const leaseId=crypto.randomUUID(),leaseExpiresAt=new Date(Date.now()+120_000).toISOString();
  const claimed=await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','applying','$.leaseId',?,'$.leaseExpiresAt',?)
    WHERE content_id=? AND owner_id=? AND kind='authoring-preview' AND redacted_at IS NULL AND expires_at>?
      AND json_extract(${privateJson},'$.approvalHash')=? AND COALESCE(json_extract(${privateJson},'$.state'),'review')='review' AND ${guard.sql}`)
    .bind(leaseId,leaseExpiresAt,previewId,user.userId,now,approvalHash,...guard.bindings).run();
  if(Number(claimed.meta.changes??0)!==1)throw new Error("authoring_save_in_progress");
  const privateGuard=`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='authoring-preview' AND redacted_at IS NULL AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_extract(${privateJson},'$.plan.expiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_extract(${privateJson},'$.state')='applying' AND json_extract(${privateJson},'$.leaseId')=? AND json_extract(${privateJson},'$.leaseExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
  const fullGuard=`(${guard.sql}) AND ${privateGuard}`,bindings=[...guard.bindings,previewId,user.userId,now,leaseId];
  const finalize=(lastEventId:string)=>env.DB.prepare(`INSERT INTO authoring_commits(preview_id,actor_user_id,operation,project_id,document_id,block_id,canvas_id,organization_id,project_access_id,approval_hash,result_json,last_event_id,verified,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ${fullGuard}
      AND(SELECT COUNT(*) FROM events WHERE stream_id=? AND correlation_id=? AND actor=?)=?
      AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=? AND correlation_id=?) THEN 1 ELSE 0 END,?)`)
    .bind(previewId,user.userId,plan.operation,current.projectId,current.documentId,current.blockId,current.canvasId,current.scope?.organizationId??null,current.scope?.projectAccessId??null,approvalHash,JSON.stringify(plan.result),lastEventId,
      ...bindings,streamId,correlation,`user:${user.userId}`,plan.events.length,lastEventId,streamId,writeHead+plan.events.length,correlation,now);
  const completed=()=>env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','applied') WHERE content_id=? AND owner_id=? AND json_extract(${privateJson},'$.leaseId')=? AND EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?)`).bind(previewId,user.userId,leaseId,previewId);
  try{
  if(current.scope){
    // Owner custody without a selected cookie is explicit and still checked by the same live tenant guard.
    const context=shared??{contextId:"",organizationId:current.scope.organizationId,projectAccessId:current.scope.projectAccessId,projectId:current.projectId,ownerUserId:current.scope.ownerUserId,principalUserId:user.userId,role:user.role,permissions:user.access.capabilities,expiresAt:plan.expiresAt};
    const response=await appendProjectEvents(env,context,user,{action:"batch",events:plan.events,clientId:"web:context-approval",correlationId:correlation},undefined,
      {preserveGovernance:true,authoringOperation:plan.operation,expectedOwnerHead:writeHead,guardSql:fullGuard,guardBindings:bindings,buildStatements:(lastEventId)=>[finalize(lastEventId),completed()]});
    if(!response.ok)throw new Error(String((await response.json() as {error?:string}).error??"authoring_commit_unavailable"));
  }else{
    // Activity may advance the stream without changing any approved source. The exact plan is unchanged;
    // the currently read head still guards every event, so concurrent semantic changes roll back atomically.
    const events=plan.events.map((input,index)=>makeEvent(streamId,writeHead+index+1,`user:${user.userId}`,"web:context-approval",correlation,input.type,input.payload));
    const placeholders=EVENT_WRITE_COLUMNS.split(",").map(()=>"?").join(",");
    await env.DB.batch([...events.map((event,index)=>env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${placeholders}
      WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND ${fullGuard}`)
      .bind(...eventWriteBindings(event),streamId,writeHead+index,...bindings)),finalize(events.at(-1)!.eventId),completed()]);
  }
  }catch(error){
    // Either the complete receipt already exists, or changing this lease atomically prevents any late commit.
    await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','review','$.leaseId','') WHERE content_id=? AND owner_id=?
      AND json_extract(${privateJson},'$.state')='applying' AND json_extract(${privateJson},'$.leaseId')=? AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?)`)
      .bind(previewId,user.userId,leaseId,previewId).run();
    throw error;
  }
  return plan.result;
}

import { validateIdeaBodyEvents } from './idea-body-guards.ts';
import { readWorkspaceEvents } from './runtime.ts';
import type { WorkspaceQuickEditReview } from "../src/model/workspace-local-proposal.ts";
import type { AdaptiveProposalReview } from "../src/model/adaptive-proposal-application.ts";
import type { ApprovedContextProposal, ContextChange, ContextProposalSelection } from "../src/model/context-proposal-application.ts";
import type { EventInput } from "../src/model/events.ts";
import { canonicalConsent, consentHash, executionAdmissionGuard, executionAuthorityCurrent, executionContentCustodyGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { storePrivateContent, type BudgetReservationGuard, type PilotUser } from "./pilot-policy.ts";
import { appendProjectEvents, type ProjectRequestContext } from "./project-access.ts";
import { EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent, type EventRow, type WorkerEnv } from "./runtime.ts";
import { authoringEventProof } from "./authoring-event-proof.ts";
import { prepareAuthoringEventBatch } from "./authoring-event-batches.ts";

export type AuthoringPlan={operation:"context-proposal"|"document-duplicate"|"canvas-arrangement"|"adaptive-proposal"|"workspace-quick-edit";binding:ConsequentialBinding;sourceHead:number;events:EventInput[];changes:ContextChange[];review?:{sourceText:string;proposals:ApprovedContextProposal[];selections:ContextProposalSelection[]};duplication?:{operationId:string;title:string;collectionId:string|null;collectionMode:"source"|"explicit";collectionPath:string[];sourceTitle:string;copyMode:"independent-snapshot";excluded:["outputs","approvals","generation-jobs","review-assignments"]};adaptiveReview?:AdaptiveProposalReview;localReview?:WorkspaceQuickEditReview;arrangement?:import("./canvas-arrangements.ts").RetainedCanvasArrangement;result:{blockIds:string[];relationCount:number;documentId?:string;operationId?:string;requestHash?:string;arrangementId?:string;itemCount?:number;dismissed?:boolean;canvasItemIds?:string[];selectionKey?:string;executionId?:string;bindingHash?:string};expiresAt:string};
export type AuthoringPreview={previewId:string;approvalHash:string;sourceHash:string;projectId:string;documentId:string;canvasId:string|null;blockId:string;changes:ContextChange[];events:EventInput[];review?:AuthoringPlan["review"];duplication?:AuthoringPlan["duplication"];adaptiveReview?:AdaptiveProposalReview;localReview?:WorkspaceQuickEditReview;blockCount:number;relationCount:number;expiresAt:string};
export type RetainedAuthoringPreview={plan:AuthoringPlan;approvalHash:string;state?:"review"|"applying"|"applied"|"dismissed";leaseId?:string;leaseExpiresAt?:string};
const correlationFor=(userId:string,id:string)=>`authoring:${userId}:${id}`;
// Retention erases content to an empty string. CASE keeps every JSON predicate safe even
// when SQLite reorders filters; erased previews are never reconstructed or modified.
const privateJson = "CASE WHEN redacted_at IS NULL AND json_valid(content) THEN content ELSE '{}' END";

/** Prospective copy identity survives content erasure in the existing private row's primary key.
 * No private title, destination, approval, or outcome is encoded or reconstructed. */
export async function documentCopyPreviewId(actorUserId:string,operationId:string){
  if(!actorUserId||!/^[a-zA-Z0-9_-]{16,120}$/u.test(operationId))throw new Error("document_duplicate_intent_required");
  return "copy-preview-"+await consentHash({domain:"forma:document-copy-private-preview:v1",actorUserId,operationId});
}

/** Prospective Canvas identity reserves the existing private row across content erasure.
 * Retained legacy IDs stay readable; already-erased random IDs cannot be reconstructed. */
export async function canvasArrangementPreviewId(actorUserId:string,operationId:string){
  if(typeof actorUserId!=="string"||!actorUserId||typeof operationId!=="string"||operationId.length>80||!/^[a-z0-9][a-z0-9:_-]*$/iu.test(operationId))throw new Error("canvas_arrangement_scope_invalid");
  return "canvas-arrangement-preview-"+await consentHash({domain:"forma:canvas-arrangement-private-preview:v1",actorUserId,operationId});
}

export async function storeAuthoringPreview(env:WorkerEnv,user:PilotUser,plan:AuthoringPlan,additional?:BudgetReservationGuard):Promise<AuthoringPreview>{
  const guard=executionAdmissionGuard(user,plan.binding,null);
  const admission=additional?{sql:`(${guard.sql}) AND (${additional.sql})`,bindings:[...guard.bindings,...additional.bindings]}:guard;
  const identity=plan.operation==="document-duplicate"?{contentId:await documentCopyPreviewId(user.userId,plan.result.operationId??"")}:plan.operation==="canvas-arrangement"?{contentId:await canvasArrangementPreviewId(user.userId,plan.result.operationId??"")}:undefined;
  const approvalHash=await consentHash(plan),saved=await storePrivateContent(env,user.userId,"authoring-preview",JSON.stringify({plan,approvalHash,state:"review"}),plan.binding.scope??undefined,admission,undefined,identity);
  // Different explicit copy intents can coexist. Retries of one intent are guarded by its operation ID.
  if(plan.operation!=="context-proposal")return authoringPreview(saved.contentId,approvalHash,plan);
  await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','dismissed') WHERE owner_id=? AND kind='authoring-preview' AND rowid<(SELECT rowid FROM private_content WHERE content_id=?)
    AND COALESCE(json_extract(${privateJson},'$.state'),'review')='review' AND json_extract(${privateJson},'$.plan.operation')=?
    AND json_extract(${privateJson},'$.plan.binding.projectId')=? AND json_extract(${privateJson},'$.plan.binding.documentId')=? AND json_extract(${privateJson},'$.plan.binding.blockId')=?
    AND COALESCE(json_extract(${privateJson},'$.plan.binding.canvasId'),'')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.organizationId'),'')=?
    AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.projectAccessId'),'')=? AND ${guard.sql}`)
    .bind(user.userId,saved.contentId,plan.operation,plan.binding.projectId,plan.binding.documentId,plan.binding.blockId,plan.binding.canvasId??"",plan.binding.scope?.organizationId??"",plan.binding.scope?.projectAccessId??"",...guard.bindings).run();
  return authoringPreview(saved.contentId,approvalHash,plan);
}
export function authoringPreview(previewId:string,approvalHash:string,plan:AuthoringPlan):AuthoringPreview{
  return{previewId,approvalHash,sourceHash:plan.binding.sourceHash,projectId:plan.binding.projectId,documentId:plan.binding.documentId,canvasId:plan.binding.canvasId,blockId:plan.binding.blockId,changes:plan.changes,events:plan.events,...(plan.review?{review:plan.review}:{}),...(plan.duplication?{duplication:plan.duplication}:{}),...(plan.adaptiveReview?{adaptiveReview:plan.adaptiveReview}:{}),...(plan.localReview?{localReview:plan.localReview}:{}),blockCount:plan.result.blockIds.length,relationCount:plan.result.relationCount,expiresAt:plan.expiresAt};
}
export async function readAuthoringPreview(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string){
  const guard=executionAdmissionGuard(user,binding,null),custody=executionContentCustodyGuard(binding),now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT content FROM private_content WHERE content_id=? AND owner_id=? AND kind='authoring-preview' AND redacted_at IS NULL AND json_valid(content) AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>? AND ${custody.sql} AND ${guard.sql}`)
    .bind(id,user.userId,now,...custody.bindings,...guard.bindings).first<{content:string}>();
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
  const guard=executionAdmissionGuard(user,binding,null),custody=executionContentCustodyGuard(binding),now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT content_id,content FROM private_content WHERE owner_id=? AND kind='authoring-preview' AND redacted_at IS NULL AND expires_at>?
    AND json_extract(${privateJson},'$.plan.operation')=? AND json_extract(${privateJson},'$.plan.binding.projectId')=? AND json_extract(${privateJson},'$.plan.binding.documentId')=?
    AND json_extract(${privateJson},'$.plan.binding.blockId')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.canvasId'),'')=?
    AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.organizationId'),'')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.projectAccessId'),'')=?
    AND COALESCE(json_extract(${privateJson},'$.state'),'review')!='dismissed' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql} AND ${guard.sql}
    ORDER BY CASE json_extract(${privateJson},'$.state') WHEN 'applying' THEN 0 ELSE 1 END,rowid DESC LIMIT 1`)
    .bind(user.userId,now,binding.operation,binding.projectId,binding.documentId,binding.blockId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",...custody.bindings,...guard.bindings).first<{content_id:string;content:string}>();
  return row?{previewId:row.content_id,saved:JSON.parse(row.content) as RetainedAuthoringPreview}:null;
}

/** An expired lease is reusable only after an atomic state change prevents its old worker from ever committing. */
export async function releaseExpiredAuthoringLease(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string,additional:BudgetReservationGuard={sql:"1",bindings:[]}){
  const guard=executionAdmissionGuard(user,binding,null),custody=executionContentCustodyGuard(binding);
  await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','review','$.leaseId','') WHERE content_id=? AND owner_id=? AND kind='authoring-preview'
    AND json_extract(${privateJson},'$.state')='applying' AND json_extract(${privateJson},'$.leaseExpiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND json_extract(${privateJson},'$.plan.operation')=? AND json_extract(${privateJson},'$.plan.binding.projectId')=? AND json_extract(${privateJson},'$.plan.binding.documentId')=?
    AND json_extract(${privateJson},'$.plan.binding.blockId')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.canvasId'),'')=?
    AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.organizationId'),'')=? AND COALESCE(json_extract(${privateJson},'$.plan.binding.scope.projectAccessId'),'')=?
    AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?) AND ${custody.sql} AND ${guard.sql} AND (${additional.sql})`)
    .bind(id,user.userId,binding.operation,binding.projectId,binding.documentId,binding.blockId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",id,...custody.bindings,...guard.bindings,...additional.bindings).run();
}

/** Read execution outcome and review visibility in one SQL snapshot. Dismissing or expiring
 * a private review cannot erase its canonical receipt or create a torn not-applied response. */
export async function readAuthoringState(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string,options:{readOnly?:boolean}={}){
  if(!options.readOnly)await releaseExpiredAuthoringLease(env,user,binding,id);
  const guard=executionAdmissionGuard(user,binding,null),custody=executionContentCustodyGuard(binding,"saved");
  const row=await env.DB.prepare(`SELECT saved.content AS preview_content,receipt.result_json AS receipt_result_json,receipt.approval_hash AS receipt_approval_hash,strftime('%Y-%m-%dT%H:%M:%fZ','now') AS database_now
    FROM(SELECT ? AS preview_id) requested
    LEFT JOIN private_content saved ON saved.content_id=requested.preview_id AND saved.owner_id=? AND saved.kind='authoring-preview'
      AND saved.redacted_at IS NULL AND json_valid(saved.content) AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql}
    LEFT JOIN authoring_commits receipt ON receipt.preview_id=requested.preview_id AND receipt.actor_user_id=? AND receipt.operation=?
      AND receipt.project_id=? AND receipt.document_id=? AND receipt.block_id=? AND COALESCE(receipt.canvas_id,'')=?
      AND COALESCE(receipt.organization_id,'')=? AND COALESCE(receipt.project_access_id,'')=?
    WHERE ${guard.sql}`)
    .bind(id,user.userId,...custody.bindings,user.userId,binding.operation,binding.projectId,binding.documentId,binding.blockId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",...guard.bindings)
    .first<{preview_content:string|null;receipt_result_json:string|null;receipt_approval_hash:string|null;database_now:string}>();
  if(!row)return null;
  const saved=row.preview_content?JSON.parse(row.preview_content) as RetainedAuthoringPreview:null;
  const committed=row.receipt_result_json&&row.receipt_approval_hash?{result:JSON.parse(row.receipt_result_json) as AuthoringPlan["result"],approvalHash:row.receipt_approval_hash}:null;
  const receiptPending=!committed&&saved?.state==="applied";
  // Receipt absence and expiry are observed together. A prior lease cannot pass the final DB-time guard again.
  let leaseExpired=!committed&&!receiptPending&&saved?.state==="applying"&&typeof saved.leaseId==="string"&&Boolean(saved.leaseId)
    &&typeof saved.leaseExpiresAt==="string"&&Number.isFinite(Date.parse(saved.leaseExpiresAt))&&saved.leaseExpiresAt<=row.database_now;
  if(leaseExpired){
    // Reuse the existing final authority query to certify the same lease bytes and receipt absence.
    // A concurrently claimed replacement or committed winner remains conservatively applying.
    const certified=await env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM private_content saved
      WHERE saved.content_id=? AND saved.owner_id=? AND saved.kind='authoring-preview' AND saved.redacted_at IS NULL
        AND saved.content=? AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql}
        AND json_extract(CASE WHEN json_valid(saved.content) THEN saved.content ELSE '{}' END,'$.leaseExpiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND NOT EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?) THEN 1 ELSE 0 END AS lease_expired WHERE ${guard.sql}`)
      .bind(id,user.userId,row.preview_content,...custody.bindings,id,...guard.bindings).first<{lease_expired:number}>();
    if(!certified)return null;leaseExpired=Number(certified.lease_expired)===1;
  }else if(!await executionAuthorityCurrent(env,user,binding,null))return null;
  return{committed,saved,retainedContent:row.preview_content,receiptPending,leaseExpired,status:committed?"applied" as const:saved?.state==="applying"||receiptPending?"applying" as const:"not-applied" as const};
}
/** Dismissal hides review UI only; its canonical outcome remains retrievable by exact receipt. */
export async function dismissAuthoringPreview(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,id:string,hash:string){
  const guard=executionAdmissionGuard(user,binding,null),custody=executionContentCustodyGuard(binding);
  const receipt=env.DB.prepare(`UPDATE authoring_commits SET result_json=json_set(result_json,'$.dismissed',json('true'))
    WHERE preview_id=? AND actor_user_id=? AND operation=? AND project_id=? AND document_id=? AND block_id=?
      AND COALESCE(canvas_id,'')=? AND COALESCE(organization_id,'')=? AND COALESCE(project_access_id,'')=? AND approval_hash=? AND ${guard.sql}`)
    .bind(id,user.userId,binding.operation,binding.projectId,binding.documentId,binding.blockId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",hash,...guard.bindings);
  const preview=env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','dismissed') WHERE content_id=? AND owner_id=? AND kind='authoring-preview'
    AND json_extract(${privateJson},'$.approvalHash')=? AND COALESCE(json_extract(${privateJson},'$.state'),'review') IN('review','applied','dismissed') AND ${custody.sql} AND ${guard.sql}`)
    .bind(id,user.userId,hash,...custody.bindings,...guard.bindings);
  // The receipt annotation and review visibility change in one snapshot, including after private erasure.
  const results=await env.DB.batch([receipt,preview]);
  return results.some((result)=>Number(result.meta.changes??0)===1);
}

/** The final CHECK receipt rolls back every preceding event if any admission or event write failed. */
export type AuthoringCommitProof=BudgetReservationGuard|(((allocatedEvents:readonly EventRow[])=>BudgetReservationGuard)&{beforeWrite?:BudgetReservationGuard});

export async function commitAuthoringPlan(env:WorkerEnv,user:PilotUser,current:ConsequentialBinding,shared:ProjectRequestContext|null|undefined,previewId:string,approvalHash:string,plan:AuthoringPlan,writeHead=plan.sourceHead,additional:AuthoringCommitProof={sql:"1",bindings:[]}){
  const identity=(binding:ConsequentialBinding)=>canonicalConsent({operation:binding.operation,actor:binding.actorUserId,stream:binding.streamId,project:binding.projectId,document:binding.documentId,block:binding.blockId,canvas:binding.canvasId,scope:binding.scope,intent:binding.intentHash});
  if(!plan.events.length||plan.events.length>512||plan.operation!==current.operation||identity(plan.binding)!==identity(current)
    ||plan.binding.actorUserId!==user.userId||plan.binding.sourceHash!==current.sourceHash||plan.binding.permissionEpoch!==current.permissionEpoch
    ||plan.binding.contextSessionId!==current.contextSessionId||plan.expiresAt<=new Date().toISOString()||await consentHash(plan)!==approvalHash)throw new Error("authoring_preview_stale");
  if(!current.scope){const issue=validateIdeaBodyEvents(await readWorkspaceEvents(env,current.streamId),plan.events);if(issue)throw new Error(issue.message);}
  const approvedPlanJson=JSON.stringify(plan);
  const guard=executionAdmissionGuard(user,current,null),custody=executionContentCustodyGuard(current),now=new Date().toISOString(),streamId=current.streamId,correlation=correlationFor(user.userId,previewId);
  const leaseId=crypto.randomUUID(),leaseExpiresAt=new Date(Date.now()+120_000).toISOString();
  const claimed=await env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','applying','$.leaseId',?,'$.leaseExpiresAt',?)
    WHERE content_id=? AND owner_id=? AND kind='authoring-preview' AND redacted_at IS NULL AND expires_at>?
      AND json_extract(${privateJson},'$.approvalHash')=? AND COALESCE(json_extract(${privateJson},'$.state'),'review')='review' AND ${custody.sql} AND ${guard.sql}`)
    .bind(leaseId,leaseExpiresAt,previewId,user.userId,now,approvalHash,...custody.bindings,...guard.bindings).run();
  if(Number(claimed.meta.changes??0)!==1)throw new Error("authoring_save_in_progress");
  const privateGuard=`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='authoring-preview' AND redacted_at IS NULL AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_extract(${privateJson},'$.plan.expiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_extract(${privateJson},'$.state')='applying' AND json_extract(${privateJson},'$.leaseId')=? AND json_extract(${privateJson},'$.leaseExpiresAt')>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND json_extract(${privateJson},'$.approvalHash')=? AND ${custody.sql}
    ${current.scope?`AND EXISTS(SELECT 1 FROM private_content_retention_scopes retention
      LEFT JOIN organization_retention_policies policy ON policy.organization_id=retention.organization_id
      WHERE retention.content_id=private_content.content_id AND retention.classification='governed-evidence'
        AND retention.policy_version=COALESCE(policy.version,0) AND retention.assigned_expires_at=private_content.expires_at)`:""})`;
  const fullGuard=`(${guard.sql}) AND ${privateGuard}`,bindings=[...guard.bindings,previewId,user.userId,now,leaseId,approvalHash,...custody.bindings];
  // A planned media transition must compare its previous custody row inside this transaction.
  // The final proof separately verifies the exact server-allocated replacement pointer.
  const beforeWrite=typeof additional==="function"?additional.beforeWrite:undefined;
  const writeGuard=beforeWrite?`(${fullGuard}) AND EXISTS(WITH authoring_before_write AS MATERIALIZED(SELECT 1 WHERE ${beforeWrite.sql}) SELECT 1 FROM authoring_before_write)`:fullGuard;
  const writeBindings=beforeWrite?[...bindings,...beforeWrite.bindings]:bindings;
  const finalize=(events:readonly EventRow[],providedProof?:BudgetReservationGuard)=>{
  if(!events.length||events.length!==plan.events.length||typeof additional==="function"&&(!providedProof||providedProof.sql==="1"))throw new Error("authoring_write_proof_required");
  const writeProof=providedProof??authoringEventProof(events);
  if(JSON.stringify(plan)!==approvedPlanJson)throw new Error("authoring_preview_stale");
  const lastEventId=events.at(-1)!.eventId,finalSource=typeof additional==="function"?additional(events):additional;
  // Large source snapshots appear once in the final CHECK, not once per copied event.
  const finalGuard=`(${finalSource.sql}) AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND json_extract(${privateJson},'$.plan')=json(?))`;
  const finalBindings=[...finalSource.bindings,previewId,user.userId,approvedPlanJson];
  return env.DB.prepare(`INSERT INTO authoring_commits(preview_id,actor_user_id,operation,project_id,document_id,block_id,canvas_id,organization_id,project_access_id,approval_hash,result_json,last_event_id,verified,created_at)
    -- Keep one row even on denial: verified=0 must reach the existing CHECK and roll back.
    -- Filtering away a denied proof could omit the receipt and leave earlier writes committed.
    WITH receipt_input(preview_id,actor_user_id,operation,project_id,document_id,block_id,canvas_id,organization_id,project_access_id,approval_hash,result_json,last_event_id)
      AS MATERIALIZED(VALUES(?,?,?,?,?,?,?,?,?,?,?,?)),
    receipt_admission(verified) AS MATERIALIZED(SELECT CASE WHEN ${fullGuard} THEN 1 ELSE 0 END),
    receipt_source(verified) AS MATERIALIZED(SELECT CASE WHEN ${finalGuard} THEN 1 ELSE 0 END),
    receipt_writes(verified) AS MATERIALIZED(SELECT CASE WHEN ${writeProof.sql} THEN 1 ELSE 0 END),
    receipt_tail(verified) AS MATERIALIZED(SELECT CASE WHEN
      (SELECT COUNT(*) FROM events WHERE stream_id=? AND correlation_id=? AND actor=?)=?
      AND EXISTS(SELECT 1 FROM events WHERE event_id=? AND stream_id=? AND sequence=? AND correlation_id=?)
      AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? THEN 1 ELSE 0 END)
    SELECT receipt_input.*,CASE WHEN receipt_admission.verified AND receipt_source.verified
      AND receipt_writes.verified AND receipt_tail.verified THEN 1 ELSE 0 END,?
    FROM receipt_input CROSS JOIN receipt_admission CROSS JOIN receipt_source CROSS JOIN receipt_writes CROSS JOIN receipt_tail`)
    .bind(previewId,user.userId,plan.operation,current.projectId,current.documentId,current.blockId,current.canvasId,current.scope?.organizationId??null,current.scope?.projectAccessId??null,approvalHash,JSON.stringify(plan.result),lastEventId,
      ...bindings,...finalBindings,...writeProof.bindings,streamId,correlation,`user:${user.userId}`,plan.events.length,lastEventId,streamId,writeHead+plan.events.length,correlation,streamId,writeHead+plan.events.length,now);
  };
  const completed=()=>env.DB.prepare(`UPDATE private_content SET content=json_set(content,'$.state','applied') WHERE content_id=? AND owner_id=? AND json_extract(${privateJson},'$.leaseId')=? AND EXISTS(SELECT 1 FROM authoring_commits WHERE preview_id=?)`).bind(previewId,user.userId,leaseId,previewId);
  try{
  if(current.scope){
    // Owner custody without a selected cookie is explicit and still checked by the same live tenant guard.
    const context=shared??{contextId:"",organizationId:current.scope.organizationId,projectAccessId:current.scope.projectAccessId,projectId:current.projectId,ownerUserId:current.scope.ownerUserId,principalUserId:user.userId,role:user.role,permissions:user.access.capabilities,expiresAt:plan.expiresAt};
    const response=await appendProjectEvents(env,context,user,{action:"batch",events:plan.events,clientId:"web:context-approval",correlationId:correlation},undefined,
      {preserveGovernance:true,authoringOperation:plan.operation,expectedOwnerHead:writeHead,guardSql:writeGuard,guardBindings:writeBindings,buildStatements:(lastEventId,writeProof,events)=>{if(!events?.length||events.at(-1)!.eventId!==lastEventId)throw new Error("authoring_write_proof_required");return[finalize(events,writeProof),completed()];}});
    if(!response.ok)throw new Error(String((await response.json() as {error?:string}).error??"authoring_commit_unavailable"));
  }else{
    // Activity may advance the stream without changing any approved source. The exact plan is unchanged;
    // the currently read head still guards every event, so concurrent semantic changes roll back atomically.
    const events=plan.events.map((input,index)=>makeEvent(streamId,writeHead+index+1,`user:${user.userId}`,"web:context-approval",correlation,input.type,input.payload));
    if(plan.operation!=="context-proposal"){
      const batch=prepareAuthoringEventBatch(env,events,writeHead,{sql:writeGuard,bindings:writeBindings});
      await env.DB.batch([...batch.statements,finalize(events,batch.proof),completed()]);
    }else{
    const placeholders=EVENT_WRITE_COLUMNS.split(",").map(()=>"?").join(",");
    await env.DB.batch([...events.map((event,index)=>env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT ${placeholders}
      WHERE(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=? AND ${writeGuard}`)
      .bind(...eventWriteBindings(event),streamId,writeHead+index,...writeBindings)),finalize(events),completed()]);
    }
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

// A separate typed side-effect receipt: ordinary document plans/event proofs stay unchanged.
export { createAuthoringStudyApproval } from './authoring-study-approval.ts';
export type { StudyApprovalProposal, StudyApprovalCommand, StudyApprovalConfiguration } from './authoring-study-types.ts';

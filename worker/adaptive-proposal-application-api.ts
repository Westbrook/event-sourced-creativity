import { outputAuthoringBlocksFromEvents, prepareOutputRequirementClientEvents, type OutputAuthoringGuardResult } from "./output-requirement-event-guards.ts";
import { adaptiveProposalOptions, adaptiveProposalSelections, buildAdaptiveProposalApplication, type AdaptiveProposalReview, type AdaptiveProposalReceipt, type AdaptiveProposalReceiptPage, type AdaptiveProposalDestinationReceiptPage } from "../src/model/adaptive-proposal-application.ts";
import { prepareAuthoringSourceProof as sourceRetentionProof, packAuthoringSourceProof as packedProof } from "./context-authoring-source.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { authoringPreview, commitAuthoringPlan, dismissAuthoringPreview, latestAuthoringPreview, readAuthoringState, releaseExpiredAuthoringLease, storeAuthoringPreview, type AuthoringPlan } from "./authoring-commits.ts";
import { readAdaptiveAuthoringProposal } from "./adaptive-planning.ts";
import { prepareDocumentAuthority } from "./context-authoring-authority.ts";
import { canonicalConsent, consentHash, executionAdmissionGuard, executionAuthorityCurrent, executionContentCustodyGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import type { BudgetReservationGuard, PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
const OPERATION="adaptive-proposal",VERSION="human-adaptive-proposal-v1";
const headers={"cache-control":"private, no-store",vary:"Cookie, oai-authenticated-user-id, oai-authenticated-user-email"};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers});
const outputRefusal=(guard:Extract<OutputAuthoringGuardResult<never>,{ok:false}>)=>response({error:guard.error,status:"not-applied",...(guard.blockId?{blockId:guard.blockId}:{}),noPayment:true,noAutomaticRetry:true},guard.status);
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const identifier=(value:unknown)=>typeof value==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/u.test(value);
const hash=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/u.test(value);
function fail(code:string):never{throw new Error(code);}
const join=(...proofs:BudgetReservationGuard[]):BudgetReservationGuard=>({sql:proofs.map(proof=>"("+proof.sql+")").join(" AND "),bindings:proofs.flatMap(proof=>proof.bindings)});
const sameScope=(left:ConsequentialBinding,right:ConsequentialBinding)=>left.actorUserId===right.actorUserId&&left.streamId===right.streamId
  &&left.projectId===right.projectId&&left.documentId===right.documentId&&left.canvasId===right.canvasId&&left.blockId===right.blockId&&canonicalConsent(left.scope)===canonicalConsent(right.scope);

async function authorityFor(request:Request,env:WorkerEnv,body:Record<string,unknown>,authority:"read"|"author"){
  const prepared=await prepareDocumentAuthority(request,env,body,authority);if(prepared instanceof Response)return prepared;
  const canvasId=prepared.binding.canvasId,canvas=canvasId?foldCanvasEvents(prepared.events,prepared.binding.projectId,canvasId):null;
  const sourceHash=canvas?await consentHash({sourceHash:prepared.binding.sourceHash,canvas:canvas.canvases.find(item=>item.id===canvasId)??null,items:canvas.items}):prepared.binding.sourceHash;
  return{...prepared,binding:{...prepared.binding,version:VERSION,operation:OPERATION,sourceHash}};
}


/** The scoped writer adds this existing server-owned Canvas attribution; approve those exact bytes too. */
function currentAuthoringEvents(events: AuthoringPlan["events"], author: Exclude<Awaited<ReturnType<typeof authorityFor>>, Response>) {
  const output = prepareOutputRequirementClientEvents(events, outputAuthoringBlocksFromEvents(author.events));
  if (!output.ok || !author.binding.scope || !author.binding.canvasId) return output;
  return { ...output, events: output.events.map((event) => ({ ...event, payload: { ...event.payload, history_owner_id: author.principal.userId } })) };
}

function previewRetentionProof(binding:ConsequentialBinding,previewId:string,approvalHash:string,plan:AuthoringPlan):BudgetReservationGuard{
  const custody=executionContentCustodyGuard(binding,"saved");
  return{sql:`EXISTS(SELECT 1 FROM private_content saved WHERE(saved.content_id,saved.owner_id,saved.kind)=(?,?,'authoring-preview')
    AND saved.redacted_at IS NULL AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND json_valid(saved.content)
    AND(json_extract(saved.content,'$.approvalHash'),json_extract(saved.content,'$.plan'))=(?,?) AND ${custody.sql})`,
    bindings:[previewId,binding.actorUserId,approvalHash,JSON.stringify(plan),...custody.bindings]};
}
function selectionReceiptProof(binding:ConsequentialBinding,selectionKey:string):BudgetReservationGuard{
  return{sql:`NOT EXISTS(SELECT 1 FROM authoring_commits receipt
    WHERE(receipt.actor_user_id,receipt.operation,receipt.project_id,receipt.document_id,COALESCE(receipt.canvas_id,''),receipt.verified,
      COALESCE(receipt.organization_id,''),COALESCE(receipt.project_access_id,''),json_extract(receipt.result_json,'$.selectionKey'))
      =( ?,'adaptive-proposal',?,?,?,1,?,?,?))`,
    bindings:[binding.actorUserId,binding.projectId,binding.documentId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",selectionKey]};
}
async function readSelectionReceipt(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,selectionKey:string){
  const authority=executionAdmissionGuard(user,binding,null);
  const row=await env.DB.prepare(`SELECT preview_id,approval_hash,result_json FROM authoring_commits
    WHERE(actor_user_id,operation,project_id,document_id,COALESCE(canvas_id,''),block_id,verified,
      COALESCE(organization_id,''),COALESCE(project_access_id,''),json_extract(result_json,'$.selectionKey'))
      =( ?,'adaptive-proposal',?,?,?,'',1,?,?,?) AND ${authority.sql}
    ORDER BY created_at,preview_id LIMIT 1`).bind(user.userId,binding.projectId,binding.documentId,binding.canvasId??"",binding.scope?.organizationId??"",binding.scope?.projectAccessId??"",selectionKey,...authority.bindings)
    .first<{preview_id:string;approval_hash:string;result_json:string}>();
  if(!row)return null;
  const result=JSON.parse(row.result_json) as AuthoringPlan["result"];
  if(result.selectionKey!==selectionKey||!Array.isArray(result.blockIds)||!Array.isArray(result.canvasItemIds)||!identifier(result.executionId)||!hash(result.bindingHash))fail("authoring_receipt_unavailable");
  const proof=join(authority,{sql:"EXISTS(SELECT 1 FROM authoring_commits WHERE(preview_id,actor_user_id,approval_hash,result_json,verified)=(?,?,?,?,1))",
    bindings:[row.preview_id,user.userId,row.approval_hash,row.result_json]});
  return{row,result,proof};
}
async function receiptResponse(env:WorkerEnv,receipt:NonNullable<Awaited<ReturnType<typeof readSelectionReceipt>>>,requestedPreviewId?:string){
  if(!await env.DB.prepare("SELECT 1 AS authoring_receipt_retained WHERE "+receipt.proof.sql).bind(...receipt.proof.bindings).first())return response({error:"authoring_result_read_unavailable"},403);
  return response({status:"applied",previewId:receipt.row.preview_id,approvalHash:receipt.row.approval_hash,...receipt.result,idempotent:true,
    ...(requestedPreviewId&&requestedPreviewId!==receipt.row.preview_id?{requestedPreviewId,reusedPreviewId:receipt.row.preview_id}:{}),noAutomaticRetry:true});
}


const RECEIPT_PAGE_SIZE=20;
const timestamp=(value:unknown):value is string=>typeof value==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
type ReceiptDiscoveryRow={preview_id:string;approval_hash:string;result_json:string;created_at:string};
type ReceiptCursor={version:1;scopeHash:string;createdAt:string;previewId:string};
function receiptCursor(value:unknown,scopeHash:string):ReceiptCursor|null{
  if(value===undefined)return null;
  if(typeof value!=="string"||!value||value.length>768||!/^[A-Za-z0-9_-]+$/u.test(value))fail("adaptive_changes_invalid_cursor");
  let parsed:Record<string,unknown>;try{parsed=record(JSON.parse(atob(value.replace(/-/gu,"+").replace(/_/gu,"/"))));}catch{fail("adaptive_changes_invalid_cursor");}
  if(Object.keys(parsed).length!==4||parsed.version!==1||parsed.scopeHash!==scopeHash||!timestamp(parsed.createdAt)||!identifier(parsed.previewId))fail("adaptive_changes_invalid_cursor");
  return parsed as ReceiptCursor;
}
const nextReceiptCursor=(value:ReceiptCursor)=>btoa(JSON.stringify(value)).replace(/\+/gu,"-").replace(/\//gu,"_").replace(/=+$/u,"");

/** The canonical receipt stays readable without private paid/preview bodies, under current destination custody. */
function receiptDestinationProof(binding:ConsequentialBinding):BudgetReservationGuard{
  const scope=binding.scope;if(!scope)return{sql:"NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind='canvas' AND resource.resource_id=? AND resource.owner_user_id=?)",bindings:[binding.canvasId??"",binding.actorUserId]};
  const required=[{kind:"document",id:binding.documentId},...(binding.canvasId?[{kind:"canvas",id:binding.canvasId}]:[])];
  return{sql:"NOT EXISTS(SELECT 1 FROM json_each(?) required WHERE NOT EXISTS(SELECT 1 FROM project_resource_scopes resource"+
    " WHERE(resource.resource_kind,resource.resource_id,resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.visibility)"+
    "=(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id'),?,?,?,?,'collaborative_output')))",
    bindings:[JSON.stringify(required),scope.projectAccessId,scope.organizationId,binding.projectId,scope.ownerUserId]};
}
function receiptMetadata(row:ReceiptDiscoveryRow,executionId:string|null,bindingHash:string|null):AdaptiveProposalReceipt{
  if(!identifier(row.preview_id)||!hash(row.approval_hash)||!timestamp(row.created_at)||typeof row.result_json!=="string"
    ||new TextEncoder().encode(row.result_json).byteLength>16_000)fail("authoring_receipt_unavailable");
  let result:Record<string,unknown>;try{result=record(JSON.parse(row.result_json));}catch{fail("authoring_receipt_unavailable");}
  const ids=(value:unknown,minimum:number)=>Array.isArray(value)&&value.length>=minimum&&value.length<=7&&value.every(identifier)&&new Set(value).size===value.length;
  if(!identifier(result.executionId)||!hash(result.bindingHash)||executionId!==null&&result.executionId!==executionId||bindingHash!==null&&result.bindingHash!==bindingHash||!hash(result.selectionKey)||result.relationCount!==0
    ||!ids(result.blockIds,1)||!ids(result.canvasItemIds,0)||result.dismissed!==undefined&&typeof result.dismissed!=="boolean")fail("authoring_receipt_unavailable");
  return{previewId:row.preview_id,approvalHash:row.approval_hash,executionId:String(result.executionId),bindingHash:String(result.bindingHash),selectionKey:String(result.selectionKey),
    blockIds:result.blockIds as string[],canvasItemIds:result.canvasItemIds as string[],relationCount:0,createdAt:row.created_at,dismissed:result.dismissed===true};
}
async function discoverAdaptiveProposalReceipts(env:WorkerEnv,user:PilotUser,binding:ConsequentialBinding,executionId:string|null,bindingHash:string|null,after:unknown){
  if((executionId===null)!==(bindingHash===null))fail("adaptive_changes_original_required");
  const exactProposal=executionId!==null;
  const scopeHash=await consentHash({operation:OPERATION,actorUserId:user.userId,projectId:binding.projectId,documentId:binding.documentId,
    canvasId:binding.canvasId,scope:binding.scope,executionId,bindingHash});
  const cursor=receiptCursor(after,scopeHash),scope=binding.scope,authorityParts=[executionAdmissionGuard(user,binding,null),receiptDestinationProof(binding)],guard=packedProof(...authorityParts);
  const match="(receipt.actor_user_id,receipt.operation,receipt.project_id,receipt.document_id,receipt.block_id,"+
    "COALESCE(receipt.canvas_id,''),COALESCE(receipt.organization_id,''),COALESCE(receipt.project_access_id,''),receipt.verified)"+
    "=(?,'adaptive-proposal',?,?,'',?,?,?,1) AND json_valid(receipt.result_json)"+
    (exactProposal?" AND(json_extract(receipt.result_json,'$.executionId'),json_extract(receipt.result_json,'$.bindingHash'))=(?,?)":"");
  const matchBindings=[user.userId,binding.projectId,binding.documentId,binding.canvasId??"",scope?.organizationId??"",scope?.projectAccessId??"",...(exactProposal?[executionId,bindingHash]:[])];
  const rows=await env.DB.prepare("SELECT receipt.preview_id,receipt.approval_hash,receipt.result_json,receipt.created_at"+
    " FROM authoring_commits receipt INDEXED BY idx_authoring_commits_actor_document WHERE "+match+
    (cursor?" AND(receipt.created_at<? OR receipt.created_at=? AND receipt.preview_id<?)":"")+" AND "+guard.sql+
    " ORDER BY receipt.created_at DESC,receipt.preview_id DESC LIMIT 21")
    .bind(...matchBindings,...(cursor?[cursor.createdAt,cursor.createdAt,cursor.previewId]:[]),...guard.bindings).all<ReceiptDiscoveryRow>();
  if(rows.results.length>RECEIPT_PAGE_SIZE+1)fail("authoring_receipt_unavailable");
  // Validate every bounded row, including the page look-ahead. Never silently skip a malformed receipt.
  const metadata=rows.results.map(row=>receiptMetadata(row,executionId,bindingHash)),receipts=metadata.slice(0,RECEIPT_PAGE_SIZE);
  const exact:BudgetReservationGuard={sql:"NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM authoring_commits receipt WHERE "+match+
    " AND(receipt.preview_id,receipt.approval_hash,receipt.result_json,receipt.created_at)"+
    "=(json_extract(expected.value,'$.preview_id'),json_extract(expected.value,'$.approval_hash'),json_extract(expected.value,'$.result_json'),json_extract(expected.value,'$.created_at'))))",
    bindings:[JSON.stringify(rows.results),...matchBindings]};
  const final=packedProof(...authorityParts,exact);
  if(!await env.DB.prepare("SELECT 1 AS authoring_receipt_discovery_retained WHERE "+final.sql).bind(...final.bindings).first())fail("context_authorization_changed");
  const last=receipts.at(-1),nextCursor=metadata.length>RECEIPT_PAGE_SIZE&&last?nextReceiptCursor({version:1,scopeHash,createdAt:last.createdAt,previewId:last.previewId}):null;
  const common={status:"receipts" as const,projectId:binding.projectId,documentId:binding.documentId,canvasId:binding.canvasId,
    receipts,nextCursor,pageSize:20 as const,readOnly:true as const,canApply:false as const,noPayment:true as const,noAutomaticRetry:true as const};
  const page:AdaptiveProposalReceiptPage|AdaptiveProposalDestinationReceiptPage=exactProposal?{...common,executionId:executionId!,bindingHash:bindingHash!}
    :{...common,discovery:"destination",executionId:null,bindingHash:null};
  return response(page);
}

/** Reuse the final private-review read: an expired lease is retryable only while its exact lease still exists and no receipt has landed. */
function expiredAdaptiveLeaseProof(state:NonNullable<Awaited<ReturnType<typeof readAuthoringState>>>,previewId:string,actorUserId:string):BudgetReservationGuard{
  const saved=state.saved;
  if(!("leaseExpired"in state)||state.leaseExpired!==true||state.committed||state.receiptPending||saved?.state!=="applying"
    ||typeof saved.leaseId!=="string"||!saved.leaseId||!timestamp(saved.leaseExpiresAt))return{sql:"0",bindings:[]};
  return{sql:"EXISTS(SELECT 1 FROM private_content lease WHERE(lease.content_id,lease.owner_id,lease.kind)=(?,?,'authoring-preview')"+
    " AND json_valid(lease.content) AND(json_extract(lease.content,'$.state'),json_extract(lease.content,'$.leaseId'),json_extract(lease.content,'$.leaseExpiresAt'))=('applying',?,?)"+
    " AND json_extract(lease.content,'$.leaseExpiresAt')<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))"+
    " AND NOT EXISTS(SELECT 1 FROM authoring_commits committed WHERE committed.preview_id=?)",
    bindings:[previewId,actorUserId,saved.leaseId,saved.leaseExpiresAt,previewId]};
}

/** Free preview and explicit atomic human authorship, using the existing authoring receipt instead of client event arrays. */
export async function handleAdaptiveProposalApplication(request:Request,env:WorkerEnv):Promise<Response>{
  if(request.method!=="POST")return response({error:"method_not_allowed"},405);
  let body:Record<string,unknown>;try{body=record(await request.json());}catch{return response({error:"invalid_request"},400);}
  const action=body.action;
  if(!["preview","apply","retrieve","resume","dismiss","receipts"].includes(String(action)))return response({error:"authoring_action_required"},400);
  const fields=["action","projectId","documentId","canvasId",...(action==="preview"?["executionId","bindingHash","selections"]:action==="resume"?["executionId","bindingHash","cursor"]:action==="receipts"?["cursor"]:["previewId","approvalHash"])];
  if(Object.keys(body).some(key=>!fields.includes(key)))return response({error:"adaptive_changes_invalid_request"},400);
  const prepared=await authorityFor(request,env,body,"read");if(prepared instanceof Response)return prepared;
  const{principal,binding}=prepared,receiptDiscovery=action==="receipts"||action==="resume"&&(body.executionId!==undefined||body.bindingHash!==undefined||body.cursor!==undefined);
  try{
    if(receiptDiscovery){
      if(action==="receipts")return await discoverAdaptiveProposalReceipts(env,principal,binding,null,null,body.cursor);
      if(!identifier(body.executionId)||!hash(body.bindingHash))return response({error:"adaptive_changes_original_required"},400);
      return await discoverAdaptiveProposalReceipts(env,principal,binding,String(body.executionId),String(body.bindingHash),body.cursor);
    }
    if(action==="preview"){
      if(!identifier(body.executionId)||!hash(body.bindingHash))return response({error:"adaptive_changes_original_required"},400);
      const executionId=String(body.executionId),bindingHash=String(body.bindingHash),selections=adaptiveProposalSelections(body.selections);
      const selectionKey=await consentHash({version:VERSION,actor:principal.userId,projectId:binding.projectId,documentId:binding.documentId,canvasId:binding.canvasId,executionId,bindingHash,selections});
      const existing=await readSelectionReceipt(env,principal,binding,selectionKey);if(existing)return receiptResponse(env,existing);
      const author=await authorityFor(request,env,body,"author");if(author instanceof Response)return author;
      const source=await readAdaptiveAuthoringProposal(env,author,executionId,bindingHash),native=await sourceRetentionProof(env,author);
      const previous=await latestAuthoringPreview(env,author.principal,author.binding);
      if(previous?.saved.plan.adaptiveReview?.selectionKey===selectionKey&&previous.saved.state!=="dismissed"
        &&previous.saved.plan.expiresAt>new Date().toISOString()&&sameScope(previous.saved.plan.binding,author.binding)
        &&previous.saved.plan.binding.sourceHash===author.binding.sourceHash&&previous.saved.plan.binding.permissionEpoch===author.binding.permissionEpoch
        &&previous.saved.plan.binding.contextSessionId===author.binding.contextSessionId&&await consentHash(previous.saved.plan)===previous.saved.approvalHash){
        const currentOutput=currentAuthoringEvents(previous.saved.plan.events,author);
        if(!currentOutput.ok)return outputRefusal(currentOutput);
        if(JSON.stringify(currentOutput.events)!==JSON.stringify(previous.saved.plan.events))fail("authoring_preview_stale");
        const proof=packedProof(...source.proofParts,native,previewRetentionProof(author.binding,previous.previewId,previous.saved.approvalHash,previous.saved.plan));
        if(!await env.DB.prepare("SELECT 1 AS adaptive_authoring_preview_retained WHERE "+proof.sql).bind(...proof.bindings).first())fail("adaptive_changes_proposal_unavailable");
        return response({status:previous.saved.state==="applying"?"applying":"review",preview:authoringPreview(previous.previewId,previous.saved.approvalHash,previous.saved.plan),reused:true,noPayment:true,noAutomaticRetry:true});
      }
      let planned:ReturnType<typeof buildAdaptiveProposalApplication>;
      try{
        planned=buildAdaptiveProposalApplication({projection:author.projection,documentId:binding.documentId,canvasId:binding.canvasId,
          structure:source.structure,executionId,bindingHash,selections});
      }catch(error){
        if(!(error instanceof Error)||!["adaptive_changes_no_changes","adaptive_changes_target_unavailable","adaptive_changes_target_protected"].includes(error.message))throw error;
        // This Preview stored nothing. It says nothing about any other saved review or application.
        const winner=await readSelectionReceipt(env,principal,binding,selectionKey);if(winner)return receiptResponse(env,winner);
        const current=packedProof(...source.proofParts,native,{sql:"(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?",bindings:[author.binding.streamId,author.sourceHead]});
        if(!await env.DB.prepare("SELECT 1 AS adaptive_authoring_no_changes_current WHERE "+current.sql).bind(...current.bindings).first()){
          const committed=await readSelectionReceipt(env,principal,binding,selectionKey);if(committed)return receiptResponse(env,committed);
          fail("adaptive_changes_source_changed");
        }
        return response({error:error.message,status:"preview-not-created",selectionKey,noPayment:true,noAutomaticRetry:true},409);
      }
      const output=currentAuthoringEvents(planned.events,author);
      if(!output.ok)return outputRefusal(output);
      const adaptiveReview:AdaptiveProposalReview={executionId,bindingHash,selectionKey,originalSourceHash:source.originalSourceHash,
        currentSourceHash:source.currentSourceHash!,sourceChanged:source.originalSourceHash!==source.currentSourceHash,selections,
        interpretation:source.structure.interpretation,originalSuggestions:adaptiveProposalOptions(source.structure).filter(item=>selections.some(selection=>selection.proposalId===item.proposalId))};
      const plan:AuthoringPlan={operation:OPERATION,binding:{...author.binding,intentHash:selectionKey},sourceHead:author.sourceHead,events:output.events,changes:planned.changes,
        adaptiveReview,result:{blockIds:planned.blockIds,canvasItemIds:planned.canvasItemIds,relationCount:planned.relationCount,selectionKey,executionId,bindingHash},
        expiresAt:new Date(Math.min(Date.now()+10*60_000,...(source.sourceRightsValidUntil?[Date.parse(source.sourceRightsValidUntil)]:[]))).toISOString()};
      const before=packedProof(...source.proofParts,native);
      if(!await env.DB.prepare("SELECT 1 AS adaptive_authoring_preview_current WHERE "+before.sql).bind(...before.bindings).first())fail("adaptive_changes_source_changed");
      const preview=await storeAuthoringPreview(env,author.principal,plan,before),proof=packedProof(...source.proofParts,native,previewRetentionProof(author.binding,preview.previewId,preview.approvalHash,plan));
      if(!await executionAuthorityCurrent(env,author.principal,author.binding,author.sourceHead)
        ||!await env.DB.prepare("SELECT 1 AS adaptive_authoring_preview_retained WHERE "+proof.sql).bind(...proof.bindings).first())fail("adaptive_changes_proposal_unavailable");
      return response({status:"review",preview,noPayment:true,noAutomaticRetry:true});
    }
    let previewId=typeof body.previewId==="string"?body.previewId:"",approvalHash=typeof body.approvalHash==="string"?body.approvalHash:"";
    if(action==="resume"){
      const latest=await latestAuthoringPreview(env,principal,binding);
      if(!latest){if(!await executionAuthorityCurrent(env,principal,binding,null))return response({error:"context_authorization_changed"},403);return response({status:"none",noPayment:true});}
      previewId=latest.previewId;approvalHash=latest.saved.approvalHash;
    }
    if(!identifier(previewId)||!hash(approvalHash))return response({error:"authoring_approval_required"},428);
    let state=await readAuthoringState(env,principal,binding,previewId,{readOnly:true});
    if(!state)return response({error:"context_authorization_changed"},403);
    if(state.receiptPending)return response({error:"authoring_receipt_unavailable",status:"applying"},503);
    if(state.committed){
      if(state.committed.approvalHash!==approvalHash)return response({error:"authoring_approval_changed"},409);
      if(!state.committed.result.selectionKey)return response({error:"authoring_receipt_unavailable"},409);
      const receipt=await readSelectionReceipt(env,principal,binding,state.committed.result.selectionKey);
      if(!receipt)return response({error:"authoring_receipt_unavailable"},503);
      if(action!=="dismiss")return receiptResponse(env,receipt,previewId);
    }
    const saved=state.saved,plan=saved?.plan,review=plan?.adaptiveReview;
    if(!saved||!plan||!review||saved.approvalHash!==approvalHash||plan.operation!==OPERATION||plan.binding.version!==VERSION
      ||!sameScope(plan.binding,binding)||await consentHash(plan)!==approvalHash||plan.result.selectionKey!==review.selectionKey
      ||plan.result.executionId!==review.executionId||plan.result.bindingHash!==review.bindingHash)return response({error:"authoring_preview_unavailable"},403);
    const readable=await readAdaptiveAuthoringProposal(env,prepared,review.executionId,review.bindingHash,false);
    const privateProof=previewRetentionProof(binding,previewId,approvalHash,plan),readProof=packedProof(...readable.proofParts,privateProof);
    const retryable=expiredAdaptiveLeaseProof(state,previewId,principal.userId);
    const reviewRead=await env.DB.prepare("SELECT 1 AS adaptive_authoring_review_retained,CASE WHEN "+retryable.sql+" THEN 1 ELSE 0 END AS retryable WHERE "+readProof.sql)
      .bind(...retryable.bindings,...readProof.bindings).first<{retryable:number}>();
    if(!reviewRead)return response({error:"authoring_preview_unavailable",retentionUnavailable:true},403);
    if(action==="dismiss"){
      // Only this explicit action fences an expired lease. Passive reads never mutate it.
      if(reviewRead.retryable===1)await releaseExpiredAuthoringLease(env,principal,binding,previewId,packedProof(...readable.proofParts,privateProof,retryable));
      const dismissed=await dismissAuthoringPreview(env,principal,binding,previewId,approvalHash);
      if(!state.committed){
        const outcome=await readAuthoringState(env,principal,binding,previewId,{readOnly:true});
        if(!outcome)return response({error:"context_authorization_changed",noAutomaticRetry:true},403);
        if(outcome.committed){
          if(outcome.committed.approvalHash!==approvalHash||outcome.committed.result.selectionKey!==review.selectionKey)return response({error:"authoring_receipt_unavailable",status:"applying",noAutomaticRetry:true},503);
          const winner=await readSelectionReceipt(env,principal,binding,review.selectionKey);
          return winner?receiptResponse(env,winner,previewId):response({error:"authoring_receipt_unavailable",status:"applying",noAutomaticRetry:true},503);
        }
        if(outcome.status==="applying")return response({status:"applying",leaseExpired:false,retryable:false,noAutomaticRetry:true},409);
      }
      return dismissed?response({status:"dismissed",noPayment:true,noAutomaticRetry:true}):response({status:"applying",leaseExpired:false,retryable:false,noAutomaticRetry:true},409);
    }
    const stale=plan.binding.sourceHash!==binding.sourceHash||plan.binding.permissionEpoch!==binding.permissionEpoch
      ||plan.binding.contextSessionId!==binding.contextSessionId||plan.expiresAt<=new Date().toISOString()
      ||Boolean(readable.originalRightsValidUntil&&readable.originalRightsValidUntil<=new Date().toISOString());
    if(action==="retrieve"||action==="resume")return response({status:state.status,preview:authoringPreview(previewId,approvalHash,plan),stale,dismissed:saved.state==="dismissed",readOnly:true,noPayment:true,noAutomaticRetry:true,leaseExpired:reviewRead.retryable===1,retryable:reviewRead.retryable===1&&!stale});
    if(saved.state==="dismissed")return response({error:"authoring_preview_dismissed",status:"not-applied"},409);
    const author=await authorityFor(request,env,body,"author");if(author instanceof Response)return author;
    if(stale||author.binding.sourceHash!==plan.binding.sourceHash)fail("authoring_preview_stale");
    const currentOutput=currentAuthoringEvents(plan.events,author);
    if(!currentOutput.ok)return outputRefusal(currentOutput);
    if(JSON.stringify(currentOutput.events)!==JSON.stringify(plan.events))fail("authoring_preview_stale");
    const paid=await readAdaptiveAuthoringProposal(env,author,review.executionId,review.bindingHash),native=await sourceRetentionProof(env,author);
    const check=buildAdaptiveProposalApplication({projection:author.projection,documentId:binding.documentId,canvasId:binding.canvasId,
      structure:paid.structure,executionId:review.executionId,bindingHash:review.bindingHash,selections:review.selections,
      createId:(()=>{const ids=plan.events.flatMap(event=>event.type==="BlockCreated"?[String(event.payload.block_id)]:event.type==="CanvasItemPlaced"?[String(event.payload.item_id)]:[]);return()=>ids.shift()??fail("authoring_preview_invalid");})()});
    const checkedOutput=currentAuthoringEvents(check.events,author);
    if(!checkedOutput.ok)return outputRefusal(checkedOutput);
    if(JSON.stringify(checkedOutput.events)!==JSON.stringify(plan.events))fail("authoring_preview_stale");
    const proof=(events:readonly import("../src/model/events.ts").CreativeEvent[])=>packedProof(...paid.proofPartsForAuthoring({streamId:author.binding.streamId,
      actorUserId:author.principal.userId,correlationId:`authoring:${author.principal.userId}:${previewId}`,eventIds:events.map(event=>event.eventId)}),native,privateProof,selectionReceiptProof(binding,review.selectionKey));
    state=await readAuthoringState(env,principal,binding,previewId);
    if(state?.status==="applying")return response({status:"applying",previewId,noAutomaticRetry:true},202);
    try{await commitAuthoringPlan(env,author.principal,{...author.binding,intentHash:review.selectionKey},author.shared,previewId,approvalHash,plan,author.sourceHead,proof);}
    catch(error){
      const winner=await readSelectionReceipt(env,principal,binding,review.selectionKey);if(winner)return receiptResponse(env,winner,previewId);
      const outcome=await readAuthoringState(env,principal,binding,previewId,{readOnly:true});
      if(!outcome)return response({error:"context_authorization_changed"},403);
      if(outcome.status==="applying")return response({status:"applying",previewId,noAutomaticRetry:true},202);
      throw error;
    }
    const committed=await readSelectionReceipt(env,principal,binding,review.selectionKey);
    return committed?receiptResponse(env,committed,previewId):response({error:"authoring_receipt_unavailable",status:"applying",previewId},503);
  }catch(error){
    const code=error instanceof Error&&/^(?:adaptive_|authoring_|context_|project_|stale_sequence)/u.test(error.message)?error.message:"adaptive_changes_unavailable";
    return response({error:code,status:"unavailable",...(receiptDiscovery?{readOnly:true,canApply:false}:{}),noPayment:true,noAutomaticRetry:true,...(/proposal_unavailable|source_unavailable/u.test(code)?{retentionUnavailable:true}:{})},/invalid_cursor/u.test(code)?400:/denied|authorization/u.test(code)?403:409);
  }
}

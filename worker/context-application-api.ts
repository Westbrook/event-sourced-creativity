import { preserveMemoryAuthoredCopies } from '../src/model/memory-authorship.ts';
import { buildContextApplicationPlan, type ApprovedContextProposal, type ContextProposalSelection } from "../src/model/context-proposal-application.ts";
import type { ContextResearchReport, DecompositionPlan } from "../src/model/context-intelligence.ts";
import { researchBlockText } from "../src/model/context-intelligence.ts";
import { ACTION_REFERENCE_ROLES } from "../src/model/combined-context.ts";
import { authoringPreview, commitAuthoringPlan, dismissAuthoringPreview, latestAuthoringPreview, readAuthoringState, storeAuthoringPreview, type AuthoringPlan } from "./authoring-commits.ts";
import { canonicalConsent, consentHash, executionAuthorityCurrent, readConsequentialConsent, readConsequentialExecution, readConsequentialResult } from "./consequential-consent.ts";
import { contextSourceHash, prepareContextAuthority } from "./context-authoring-authority.ts";
import { foldEvents } from "../src/model/events.ts";
import { creativeContextRightsValidity } from "../src/model/context-health.ts";
import { AUTHORING_EVENT_COLUMNS, AUTHORING_SIDECAR_COLUMNS, authoringEventRowsProof, authoringSidecarProof, combineAuthoringGuards } from "./authoring-event-proof.ts";
import type { BudgetReservationGuard } from "./pilot-policy.ts";
import { type WorkerEnv } from "./runtime.ts";
import { isOutputContextType } from "../src/model/output-requirements.ts";
import { outputAuthoringBlocksFromEvents, prepareOutputRequirementClientEvents } from "./output-requirement-event-guards.ts";
const headers={"cache-control":"private, no-store",vary:"Cookie, oai-authenticated-user-id, oai-authenticated-user-email"};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers});
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

type OutputApplicationIssue={error:string;message:string;status:number;blockId?:string};
class OutputApplicationError extends Error{
  readonly issue:OutputApplicationIssue;
  constructor(issue:OutputApplicationIssue){super(issue.error);this.issue=issue;}
}
const outputEditorRequired=(blockId:string)=>new OutputApplicationError({error:"output_requirement_endpoint_required",status:409,blockId,
  message:"Open the Output requirements editor to review and save this change against its current revision. Your draft was not saved."});
function normalizeContextOutputEvents(events:AuthoringPlan["events"],prepared:Exclude<Awaited<ReturnType<typeof prepareContextAuthority>>,Response>){
  if(isOutputContextType(prepared.target.type))throw outputEditorRequired(prepared.target.id);
  const checked=prepareOutputRequirementClientEvents(events,outputAuthoringBlocksFromEvents(prepared.events));
  if(!checked.ok)throw new OutputApplicationError(checked);
  return preserveMemoryAuthoredCopies(checked.events,prepared.projection.libraryBlocks,prepared.events);
}


/** Capture precisely the native state read by contextSourceHash, including tombstones and
 * implicit project/document routing. Output ledger bodies are not creative source facts. */
async function contextApplicationSourceProof(env:WorkerEnv,prepared:Exclude<Awaited<ReturnType<typeof prepareContextAuthority>>,Response>,events:AuthoringPlan["events"]):Promise<BudgetReservationGuard>{
  const {binding,principal,projection}=prepared,scope=binding.scope,owner=scope?.ownerUserId??principal.userId;
  const types=new Set(["ProjectCreated","ProjectOpened","ProjectRenamed","ProjectStateChanged",
    "DocumentCreated","DocumentForked","DocumentRenamed","DocumentOpened","DocumentRemoved","DocumentRestored",
    "BlockDocumentAttached", "BlockDocumentDetached", "BlockCreated","BlockRenamed","BlockPropertyEdited","BlockWeightSet","BlockLocked","BlockUnlocked","BlockRemoved","BlockRestored","BlockRehomed",
    "BlockRelationAdded","BlockRelationRemoved","ChipEdited","ExtractionRequested","ExtractionCompleted","ExtractionFailed",
    "ImageFocalPointCalculated","ReferenceIngested","RightsAsserted","CanvasCreated","CanvasRemoved","CanvasRestored"]);
  const dependencies=prepared.events.filter(event=>types.has(event.type));
  const rebuilt=foldEvents(dependencies,Infinity,binding.documentId,binding.projectId),target=rebuilt.libraryBlocks.find(block=>block.id===binding.blockId);
  if(await contextSourceHash(binding.projectId,binding.documentId,target,rebuilt,dependencies)!==binding.sourceHash)throw new Error("context_changes_source_stale");
  const expected=new Map(dependencies.map(event=>[event.eventId,event])),ids=JSON.stringify([...expected.keys()]);
  type Row=Record<string,string|number|null>;
  const rows=(await env.DB.prepare(`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.redacted_at
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))`).bind(binding.streamId,ids).all<Row>()).results;
  if(rows.length!==expected.size)throw new Error("context_changes_source_unavailable");
  for(const row of rows){
    if(row.redacted_at!==null||row.private_json!==null&&row.owner_id!==owner)throw new Error("context_changes_source_unavailable");
    let payload:unknown;try{payload=JSON.parse(String(row.private_json??row.payload));}catch{throw new Error("context_changes_source_unavailable");}
    if(payload&&typeof payload==="object"&&"_private_ref"in payload||canonicalConsent(payload)!==canonicalConsent(expected.get(String(row.event_id))?.payload))throw new Error("context_changes_source_stale");
  }
  const proofs=[authoringEventRowsProof(rows.map(row=>[...AUTHORING_EVENT_COLUMNS.map(column=>row[column]??null),row.owner_id??null,row.project_id??null,row.document_id??null,row.private_json??null]),true)];
  const required=new Map<string,{kind:string;id:string}>(),add=(kind:string,id:string)=>required.set(kind+":"+id,{kind,id});
  for(const document of projection.documents)add("document",document.id);
  for(const block of projection.libraryBlocks){add("block",block.id);if(block.documentId)add("document",block.documentId);if(block.canvasId)add("canvas",block.canvasId);const referenceId=String(block.properties.reference_id??"");if(referenceId)add("reference",referenceId);}
  for(const relation of projection.libraryBlockRelations)add("relation",relation.id);
  if(binding.canvasId)add("canvas",binding.canvasId);
  const requiredJson=JSON.stringify([...required.values()]);
  if(scope){
    const custody=(await env.DB.prepare(`SELECT * FROM project_event_scopes WHERE project_access_id=? AND organization_id=? AND project_id=? AND owner_user_id=?
      AND event_id IN(SELECT value FROM json_each(?))`).bind(scope.projectAccessId,scope.organizationId,scope.projectId,owner,ids).all<Row>()).results;
    const visibleIds=new Set([...projection.documents,...projection.libraryBlocks,...projection.libraryBlockRelations].flatMap(item=>item.sourceEvents));
    const needed=dependencies.filter(event=>visibleIds.has(event.eventId)||event.payload.project_id===binding.projectId);
    const held=new Set(custody.map(row=>String(row.event_id)));
    if(needed.some(event=>!held.has(event.eventId)))throw new Error("context_changes_source_custody_changed");
    proofs.push(authoringSidecarProof("project_event_scopes",custody.map(row=>AUTHORING_SIDECAR_COLUMNS.project_event_scopes.map(column=>row[column]??null))));
    const resources=(await env.DB.prepare(`SELECT resource.* FROM project_resource_scopes resource JOIN json_each(?) required
      ON(resource.resource_kind,resource.resource_id)=(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id'))
      WHERE(resource.project_access_id,resource.organization_id,resource.project_id,resource.owner_user_id,resource.visibility)=(?,?,?,?,'collaborative_output')`)
      .bind(requiredJson,scope.projectAccessId,scope.organizationId,scope.projectId,owner).all<Row>()).results;
    if(resources.length!==required.size)throw new Error("context_changes_source_custody_changed");
    proofs.push(authoringSidecarProof("project_resource_scopes",resources.map(row=>AUTHORING_SIDECAR_COLUMNS.project_resource_scopes.map(column=>row[column]??null))));
  }else proofs.push({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) required JOIN project_resource_scopes resource
    ON(resource.resource_kind,resource.resource_id)=(json_extract(required.value,'$.kind'),json_extract(required.value,'$.id')) WHERE resource.owner_user_id=?)`,bindings:[requiredJson,owner]});
  const used=new Set([binding.blockId]);
  for(const event of events){
    for(const key of ["block_id","from_block_id","to_block_id"])if(typeof event.payload[key]==="string")used.add(String(event.payload[key]));
    const properties=record(event.payload.properties);if(typeof properties.copied_from_block_id==="string")used.add(properties.copied_from_block_id);
  }
  let deadline:string|null=null;
  for(const block of projection.libraryBlocks)if(used.has(block.id)){
    const rights=[creativeContextRightsValidity(block.properties)],referenceId=String(block.properties.reference_id??"");
    if(referenceId){
      const latest=[...dependencies].reverse().find(event=>["ReferenceIngested","RightsAsserted"].includes(event.type)&&String(event.payload.reference_id??"")===referenceId);
      if(!latest||!["owned","owned_or_licensed","account-generated"].includes(String(latest.payload.rights_class??"")))throw new Error("context_changes_source_protected");
      rights.push(creativeContextRightsValidity(latest.payload));
    }
    if(block.removed||block.locked||rights.some(right=>right.issue))throw new Error("context_changes_source_protected");
    for(const right of rights)if(right.validUntil&&(deadline===null||right.validUntil<deadline))deadline=right.validUntil;
  }
  if(deadline)proofs.push({sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[deadline]});
  return combineAuthoringGuards(...proofs);
}

/** Free, explicit human authorship. This route has no provider dispatch or budget reservation. */
export async function handleContextApplication(request:Request,env:WorkerEnv){
  if(request.method!=="POST")return response({error:"method_not_allowed"},405);
  let body:Record<string,unknown>;try{body=record(await request.json());}catch{return response({error:"invalid_request"},400);}
  if(!["preview","apply","retrieve","resume","dismiss"].includes(String(body.action)))return response({error:"authoring_action_required"},400);
  const prepared=await prepareContextAuthority(request,env,body,body.action==="preview"?"author":"read");if(prepared instanceof Response)return prepared;
  const {principal,binding,sourceHead,projection,target}=prepared;
  let previewId=typeof body.previewId==="string"?body.previewId:"",approvalHash=typeof body.approvalHash==="string"?body.approvalHash:"";
  if(body.action==="resume"){
    const existing=await latestAuthoringPreview(env,principal,binding);
    if(!existing){if(!await executionAuthorityCurrent(env,principal,binding,null))return response({error:"context_authorization_changed"},403);return response({status:"none"});}
    previewId=existing.previewId;approvalHash=existing.saved.approvalHash;
  }
  if(body.action!=="preview"){
    if(!previewId||previewId.length>120||!approvalHash||approvalHash.length!==64)return response({error:"authoring_approval_required"},428);
    const state=await readAuthoringState(env,principal,binding,previewId);
    if(!state)return response({error:"context_authorization_changed"},403);
    const {committed,saved}=state;
    if(state.receiptPending)return response({error:"authoring_receipt_unavailable",status:"applying"},503);
    if(committed&&committed.approvalHash!==approvalHash)return response({error:"authoring_approval_changed"},409);
    if(committed&&body.action!=="dismiss")return response({status:"applied",previewId,...committed.result,idempotent:true,...(saved?{preview:authoringPreview(previewId,approvalHash,saved.plan)}:{})});
    if(!saved||saved.approvalHash!==approvalHash||saved.plan.operation!=="context-proposal"||saved.plan.binding.actorUserId!==principal.userId
      ||saved.plan.binding.projectId!==binding.projectId||saved.plan.binding.documentId!==binding.documentId||saved.plan.binding.blockId!==binding.blockId
      ||saved.plan.binding.canvasId!==binding.canvasId||await consentHash(saved.plan)!==approvalHash)return response({error:"authoring_preview_unavailable"},403);
    if(saved.plan.binding.streamId!==binding.streamId||saved.plan.binding.scope?.organizationId!==binding.scope?.organizationId||saved.plan.binding.scope?.projectAccessId!==binding.scope?.projectAccessId||saved.plan.binding.scope?.ownerUserId!==binding.scope?.ownerUserId)return response({error:"authoring_preview_unavailable"},403);
    if(body.action==="dismiss")return await dismissAuthoringPreview(env,principal,binding,previewId,approvalHash)?response({status:"dismissed"}):response({error:"authoring_save_in_progress",status:"applying"},409);
    const stale=saved.plan.binding.sourceHash!==binding.sourceHash||saved.plan.binding.permissionEpoch!==binding.permissionEpoch||saved.plan.binding.contextSessionId!==binding.contextSessionId||saved.plan.expiresAt<=new Date().toISOString()||!target||target.locked||target.removed;
    if(body.action==="retrieve"||body.action==="resume")return response({status:state.status,preview:authoringPreview(previewId,approvalHash,saved.plan),stale});
    if(saved.state==="dismissed")return response({error:"authoring_preview_dismissed",status:"not-applied"},409);
    if(saved.state==="applying")return response({status:"applying",preview:authoringPreview(previewId,approvalHash,saved.plan)},202);
    const author=await prepareContextAuthority(request,env,body,"author");if(author instanceof Response)return author;
    try{
      // Applying a retained approval validates its exact bytes; it never silently repairs an old draft.
      const checked=normalizeContextOutputEvents(saved.plan.events,author);
      if(JSON.stringify(checked)!==JSON.stringify(saved.plan.events))throw new Error("authoring_preview_stale");
      const source=await contextApplicationSourceProof(env,author,saved.plan.events);
      const result=await commitAuthoringPlan(env,author.principal,author.binding,author.shared,previewId,approvalHash,saved.plan,author.sourceHead,source);
      if(!await executionAuthorityCurrent(env,author.principal,author.binding,null))return response({error:"authoring_result_read_unavailable",previewId},403);
      return response({status:"applied",previewId,...result});
    }catch(error){
      const outcome=await readAuthoringState(env,principal,binding,previewId);
      if(!outcome)return response({error:"context_authorization_changed"},403);
      if(outcome.committed){
        if(outcome.committed.approvalHash!==approvalHash)return response({error:"authoring_approval_changed"},409);
        return response({status:"applied",previewId,...outcome.committed.result,idempotent:true});
      }
      if(outcome.status==="applying")return response({status:"applying",...(outcome.saved?{preview:authoringPreview(previewId,approvalHash,outcome.saved.plan)}:{})},outcome.receiptPending?503:202);
      const code=error instanceof Error&&/^(?:authoring_|context_|project_|output_|stale_sequence)/u.test(error.message)?error.message:"authoring_not_applied";
      return response({error:code,status:"not-applied",previewId,...(error instanceof OutputApplicationError?{message:error.issue.message,blockId:error.issue.blockId}:{})},409);
    }
  }
  if(!Array.isArray(body.selections)||!body.selections.length||body.selections.length>48)return response({error:"context_changes_selection_required"},400);
  const selections:ContextProposalSelection[]=[],seen=new Set<string>();
  for(const value of body.selections){
    const item=record(value),edit=item.edit===undefined?undefined:record(item.edit);
    if(Object.keys(item).some((key)=>!["executionId","bindingHash","proposalId","edit"].includes(key))
      ||![item.executionId,item.bindingHash,item.proposalId].every((part)=>typeof part==="string"&&part.length>0&&part.length<=120)
      ||edit&&Object.entries(edit).some(([key,value])=>key==="participants"?!Array.isArray(value)||value.length>8||value.some((part)=>{const participant=record(part);return Object.keys(participant).some((field)=>!["handle","role"].includes(field))||typeof participant.handle!=="string"||!participant.handle.trim()||participant.handle.length>96||!ACTION_REFERENCE_ROLES.includes(participant.role as typeof ACTION_REFERENCE_ROLES[number]);}):!["type","subtype","label","text"].includes(key)||typeof value!=="string"||value.length>1800))return response({error:"context_changes_invalid_selection"},400);
    const selection={executionId:String(item.executionId),bindingHash:String(item.bindingHash),proposalId:String(item.proposalId),...(edit?{edit:edit as ContextProposalSelection["edit"]}:{})};
    const key=`${selection.executionId}:${selection.proposalId}`;if(seen.has(key))return response({error:"context_changes_duplicate_selection"},400);seen.add(key);selections.push(selection);
  }
  try{
    const proposals:ApprovedContextProposal[]=[],cache=new Map<string,{plan?:DecompositionPlan;report?:ContextResearchReport;bindingHash:string;addendum:boolean}>();
    for(const selected of selections){
      let result=cache.get(selected.executionId);
      if(!result){
        const execution=await readConsequentialExecution(env,principal.userId,selected.executionId);if(!execution||execution.binding_hash!==selected.bindingHash||!execution.result_ref)throw new Error("context_changes_proposal_unavailable");
        const retained=await readConsequentialConsent(env,principal,binding,sourceHead,execution);
        if(!retained||retained.binding.sourceHash!==binding.sourceHash||retained.binding.projectId!==binding.projectId||retained.binding.documentId!==binding.documentId||retained.binding.canvasId!==binding.canvasId||retained.binding.blockId!==binding.blockId)throw new Error("context_changes_source_stale");
        const saved=await readConsequentialResult(env,principal,binding,sourceHead,execution) as {plan?:DecompositionPlan;report?:ContextResearchReport}|null;
        if(!saved)throw new Error("context_changes_proposal_unavailable");
        result={...saved,bindingHash:execution.binding_hash,addendum:Boolean(record(retained.binding.request).addedText)};cache.set(selected.executionId,result);
      }
      if(result.bindingHash!==selected.bindingHash)throw new Error("context_changes_proposal_unavailable");
      const decomposition=result.plan?.proposals.find((item)=>item.id===selected.proposalId),research=result.report?[...result.report.inferred,...result.report.related,...result.report.learned].find((item)=>item.id===selected.proposalId):undefined;
      if(!decomposition&&!research)throw new Error("context_changes_proposal_missing");
      proposals.push({key:`${selected.executionId}:${selected.proposalId}`,executionId:selected.executionId,proposalId:selected.proposalId,...(decomposition?{decomposition:{...decomposition,addendum:result.addendum}}:{}),...(research?{research}:{}),...(selected.edit?{edit:selected.edit}:{})});
    }
    if(!target)throw new Error("context_changes_source_protected");
    if(proposals.some((item)=>item.decomposition)&&proposals.some((item)=>item.research))throw new Error("context_changes_mixed_review");
    const planned=buildContextApplicationPlan({projection,target,proposals});
    // Main's Output draft contract is part of the human-visible plan and its retained consent hash.
    const events=normalizeContextOutputEvents(planned.events,prepared);
    const plan:AuthoringPlan={operation:"context-proposal",binding,sourceHead,events,changes:planned.changes,review:{sourceText:researchBlockText(target),proposals,selections},result:{blockIds:planned.blockIds,relationCount:planned.relationCount},expiresAt:new Date(Date.now()+10*60_000).toISOString()};
    const source=await contextApplicationSourceProof(env,prepared,events);
    const preview=await storeAuthoringPreview(env,principal,plan,source);
    if(!await executionAuthorityCurrent(env,principal,binding,sourceHead))return response({error:"context_authorization_changed"},403);
    return response({preview});
  }catch(error){
    if(error instanceof OutputApplicationError)return response({error:error.issue.error,message:error.issue.message,blockId:error.issue.blockId},error.issue.status);
    return response({error:error instanceof Error&&/^context_/u.test(error.message)?error.message:"context_changes_unavailable"},409);
  }
}

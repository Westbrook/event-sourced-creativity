import { buildContextApplicationPlan, type ApprovedContextProposal, type ContextProposalSelection } from "../src/model/context-proposal-application.ts";
import type { ContextResearchReport, DecompositionPlan } from "../src/model/context-intelligence.ts";
import { researchBlockText } from "../src/model/context-intelligence.ts";
import { ACTION_REFERENCE_ROLES } from "../src/model/combined-context.ts";
import { authoringPreview, commitAuthoringPlan, dismissAuthoringPreview, latestAuthoringPreview, readAuthoringState, storeAuthoringPreview, type AuthoringPlan } from "./authoring-commits.ts";
import { consentHash, executionAuthorityCurrent, readConsequentialConsent, readConsequentialExecution, readConsequentialResult } from "./consequential-consent.ts";
import { prepareContextAuthority } from "./context-authoring-authority.ts";
import { type WorkerEnv } from "./runtime.ts";
const headers={"cache-control":"private, no-store",vary:"Cookie, oai-authenticated-user-id, oai-authenticated-user-email"};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers});
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

/** Free, explicit human authorship. This route has no provider dispatch or budget reservation. */
export async function handleContextApplication(request:Request,env:WorkerEnv){
  if(request.method!=="POST")return response({error:"method_not_allowed"},405);
  let body:Record<string,unknown>;try{body=record(await request.json());}catch{return response({error:"invalid_request"},400);}
  if(!["preview","apply","retrieve","resume","dismiss"].includes(String(body.action)))return response({error:"authoring_action_required"},400);
  const prepared=await prepareContextAuthority(request,env,body,body.action==="preview"?"author":"read");if(prepared instanceof Response)return prepared;
  const {principal,binding,sourceHead,projection,target,shared}=prepared;
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
      const result=await commitAuthoringPlan(env,author.principal,author.binding,author.shared,previewId,approvalHash,saved.plan,author.sourceHead);
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
      const code=error instanceof Error&&/^(?:authoring_|context_|project_|stale_sequence)/u.test(error.message)?error.message:"authoring_not_applied";
      return response({error:code,status:"not-applied",previewId},409);
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
    const plan:AuthoringPlan={operation:"context-proposal",binding,sourceHead,events:planned.events,changes:planned.changes,review:{sourceText:researchBlockText(target),proposals,selections},result:{blockIds:planned.blockIds,relationCount:planned.relationCount},expiresAt:new Date(Date.now()+10*60_000).toISOString()};
    const preview=await storeAuthoringPreview(env,principal,plan);
    if(!await executionAuthorityCurrent(env,principal,binding,sourceHead))return response({error:"context_authorization_changed"},403);
    return response({preview});
  }catch(error){return response({error:error instanceof Error&&/^context_/u.test(error.message)?error.message:"context_changes_unavailable"},409);}
}

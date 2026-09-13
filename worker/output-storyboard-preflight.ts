import { freeze } from "../src/experiences/compiler.ts";
import { readStoryboardExecutionOffer, STORYBOARD_READY_REASON, STORYBOARD_TRANSFER } from "../src/model/output-storyboard-offer.ts";
import { parseStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import { standingConstraints } from "../src/model/taste.ts";
import { documentRenderTokenReservation } from "../src/model/generation-budget.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { createOutputFalImageContract, OUTPUT_FAL_PLANNING_MODEL } from "./output-fal-image-contract.ts";
import { selectImageAdapter } from "./image-adapter-selection.ts";
import { prepareStoryboardPlannerRequest } from "./openai-adapter.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import { resolveOutputStoryboardSource } from "./output-storyboard-source.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

const unavailable=(targetId:string,code:string):OutputNativeTargetPreflight=>({targetId,available:false,reasonCode:code,reason:"Storyboard unavailable",transferCode:"output_transfer_none_authorized",transferDescription:"This check sends nothing.",provider:null,model:null,route:null,maximumMicrousd:0,maximumCalls:0,maximumTokens:0,settings:{}});
const proofs=new WeakMap<OutputNativeTargetPreflight,Readonly<{sourceAssertions:readonly OutputSqlAssertion[];requestId:string;expiresAt:string}>>();
export const outputStoryboardPreflightProof=(preflight:OutputNativeTargetPreflight)=>proofs.get(preflight)??null;

/** Exact current manual-render snapshot assembly: same title and standing
 * constraint merge as events-api, with no invented scenes or pixel references. */
export function storyboardPlanningSnapshot(snapshot:Record<string,unknown>,projection:{documentId:string;documentTitle:string},events:Parameters<typeof standingConstraints>[0]){
 const authored=standingConstraints(events).map(item=>({preference_id:item.preferenceId,axis:item.axis,value:item.value,polarity:item.polarity,authority:"authored",source_event_refs:item.evidenceRefs,source_claim_ref:item.sourceClaimRef??null}));
 const supplied=Array.isArray(snapshot.standing_constraints)?snapshot.standing_constraints.filter((value):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)):[];
 const merged=[...new Map([...supplied,...authored].map(value=>[String(value.preference_id??`${value.polarity}:${value.axis}:${value.value}`),value])).values()];
 return {...structuredClone(snapshot),document:{id:projection.documentId,title:projection.documentTitle},...(merged.length?{standing_constraints:merged}:{})};
}
function conjunction(assertions:readonly OutputSqlAssertion[]):OutputSqlAssertion{
 if(assertions.length===1)return assertions[0]!;
 const middle=Math.ceil(assertions.length/2),left=conjunction(assertions.slice(0,middle)),right=conjunction(assertions.slice(middle));
 return{sql:`(${left.sql}) AND (${right.sql})`,bindings:[...(left.bindings??[]),...(right.bindings??[])]};
}

/** Offline quoted route for the exact completion and native host joins.
 * The existing adapter builds the final planner request offline; this function
 * cannot allocate a grant/slot/job or dispatch either selected provider. */
export async function preflightOutputStoryboardTarget(input:OutputBridgeTargetInput):Promise<OutputNativeTargetPreflight>{
 const {target,env}=input,contract=parseStoryboardOutputContract(target.storyboard_contract);
 if(!contract||target.media_kind!=="document"||!target.selected||target.blocking_issues.length||target.quantity.kind!=="exact"||target.quantity.unit!=="document"||target.quantity.value!==1
  ||target.source_scope.kind!=="document"||target.coverage.kind!=="document_context"||target.aspect_ratio||target.content_quantity||target.count_policy||target.variant_id||target.member_id
  ||["narrative_contract","scene_contract","audio_contract","video_contract"].some(key=>Object.hasOwn(target,key)))return unavailable(target.id,"output_storyboard_contract_unsupported");
 const fal=createOutputFalImageContract("ideogram/v4","1536x1024"),selection=selectImageAdapter(env,{quality:"high",size:"1536x1024",outputFormat:"png"});
 if(!fal||!env.OPENAI_API_KEY?.trim()||!env.FAL_KEY?.trim()||(env.OPENAI_MODEL??OUTPUT_FAL_PLANNING_MODEL)!==OUTPUT_FAL_PLANNING_MODEL||selection.provider!=="fal-ideogram"||selection.model!==fal.model)return unavailable(target.id,"output_storyboard_provider_unavailable");
 const source=await resolveOutputStoryboardSource(input);
 if(Date.parse(source.expiresAt)<=Date.now()||Date.parse(input.confirmedPlan.confirmedAt)>Date.now())return unavailable(target.id,"output_storyboard_original_expired");
 const snapshot=storyboardPlanningSnapshot(input.context.snapshot,input.context.projection,[...input.sourceEvents!]);
 const prepared=await prepareStoryboardPlannerRequest(env,input.principal.userId,{documentTitle:input.context.projection.documentTitle,snapshot,options:{itemCount:4,productionMode:"manual",outputTargetInstructions:target.instruction_text}},contract);
 if(prepared.maximumInputTokens+prepared.maximumOutputTokens>128000)return unavailable(target.id,"output_storyboard_context_limit");
 const plannerMaximum=estimateOpenAITextCallMaximumMicrousd(OUTPUT_FAL_PLANNING_MODEL,prepared.maximumInputTokens,prepared.maximumOutputTokens);
 const calls=[{stage:"planning:0:initial",provider:"openai",model:OUTPUT_FAL_PLANNING_MODEL,maximumMicrousd:plannerMaximum,maximumInputTokens:prepared.maximumInputTokens,maximumOutputTokens:4000},
  ...Array.from({length:4},(_,index)=>({stage:`image:frame:${index+1}`,provider:"fal",model:fal.model,maximumMicrousd:fal.maximumMicrousd,maximumInputTokens:0,maximumOutputTokens:0}))];
 const sourceAssertions:OutputSqlAssertion[]=[...source.sourceAssertions,{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[source.expiresAt],deadlineMs:Date.parse(source.expiresAt)}],guard=conjunction(sourceAssertions);
 if(!await env.DB.prepare(`SELECT 1 AS current WHERE ${guard.sql}`).bind(...(guard.bindings??[])).first()||sourceAssertions.some(x=>x.deadlineMs!==undefined&&Date.now()>=x.deadlineMs))return unavailable(target.id,"output_storyboard_source_changed");
 const preflight:OutputNativeTargetPreflight=freeze({targetId:target.id,available:true,reasonCode:"output_storyboard_ready",reason:STORYBOARD_READY_REASON,
  transferCode:"output_transfer_storyboard_after_authorization",transferDescription:STORYBOARD_TRANSFER,
  provider:"fal",model:fal.model,route:"document-storyboard-four-frames-manual-v1",maximumMicrousd:plannerMaximum+4*fal.maximumMicrousd,maximumCalls:5,maximumTokens:documentRenderTokenReservation("storyboard",4,1),
  settings:{kind:"render_document",payload:{artifactKind:"storyboard",productionMode:"manual",itemCount:4,outputStoryboard:contract,
   outputStoryboardPlanner:{contract,requestDigest:prepared.requestDigest,maximumInputTokens:prepared.maximumInputTokens},outputFalImage:fal,outputTargetInstructions:target.instruction_text,paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true},
   calls,executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY,preparationOnly:false,executionAvailable:true,explicitCostAndTransferApprovalRequired:true,
   original:{requestId:source.requestId,expiresAt:source.expiresAt,draftId:source.plan.draftId,actorUserId:input.scope.actorUserId,projectId:input.scope.projectId,documentId:input.scope.documentId,sourceDigest:input.sourceDigest,requirementsDigest:input.requirementsDigest}}});
 if(!readStoryboardExecutionOffer(preflight))return unavailable(target.id,"output_storyboard_offer_invalid");
 proofs.set(preflight,freeze({sourceAssertions:sourceAssertions.map(value=>({...value,bindings:[...(value.bindings??[])]})),requestId:source.requestId,expiresAt:source.expiresAt}));return preflight;
}

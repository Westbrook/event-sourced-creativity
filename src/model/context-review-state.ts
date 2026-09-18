import type { ContextResearchReport, DecompositionPlan, DecompositionProposal } from "./context-intelligence.ts";
import type { ContextProposalSelection } from "./context-proposal-application.ts";
import type { AuthoringPreview } from "../../worker/authoring-commits.ts";

/** Re-reading a paid result must not duplicate controls, overwrite human edits, or reselect rejected proposals. */
export function mergeContextAddendum(plan:DecompositionPlan,received:DecompositionProposal[]){
  const seen=new Set([...plan.proposals,...plan.addenda].map((proposal)=>proposal.id)),added:DecompositionProposal[]=[];
  for(const proposal of received)if(!seen.has(proposal.id)){seen.add(proposal.id);added.push({...proposal,addendum:true});}
  return{plan:{...plan,addenda:[...plan.addenda,...added]},addedIds:added.map((proposal)=>proposal.id)};
}

/** Recover the exact saved human selection; no provider call, replacement ID, or automatic application. */
export function recoverContextReview(preview:AuthoringPreview){
  const review=preview.review;if(!review)throw new Error("context_review_unavailable");
  const sources=new Map<string,ContextProposalSelection&{original?:DecompositionProposal}>(),selected=new Set<string>();
  const plan:DecompositionPlan={sourceBlockId:preview.blockId,sourceText:review.sourceText,proposals:[],addenda:[]};
  const report:ContextResearchReport={blockId:preview.blockId,inferred:[],related:[],learned:[],searchedWeb:false,query:""};
  for(const item of review.proposals){
    const selection=review.selections.find((candidate)=>candidate.executionId===item.executionId&&candidate.proposalId===item.proposalId);
    if(!selection||selected.has(item.key))throw new Error("context_review_identity_missing");
    sources.set(item.key,{executionId:selection.executionId,bindingHash:selection.bindingHash,proposalId:selection.proposalId,...(item.decomposition?{original:item.decomposition}:{})});selected.add(item.key);
    if(item.decomposition){
      const proposal={...item.decomposition,...item.edit,id:item.key} as DecompositionProposal;
      (proposal.addendum?plan.addenda:plan.proposals).push(proposal);
    }else if(item.research)report[item.research.area].push({...item.research,id:item.key});
  }
  const decomposition=plan.proposals.length+plan.addenda.length>0;
  return{mode:decomposition?"decompose" as const:"research" as const,plan:decomposition?plan:null,report:decomposition?null:report,sources,selected};
}

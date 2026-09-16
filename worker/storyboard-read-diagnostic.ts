/** Server-only fixed stages; no source, request, SQL, identifiers or error text. */
const stages = [
 "retained_receipt","retained_job","retained_slot","retained_reference","retained_input","retained_hashes","retained_invocation",
 "completion_evidence","retained_receipt_match","retained_publication","retained_lifetime","retained_witness",
 "completion_identity","completion_checkpoint","completion_planner_request","completion_planner_envelope","completion_planner_plan",
 "completion_ledger","completion_planner_claim","completion_frame","completion_media",
 "read_selection","read_receipt","read_content","read_evidence","read_dto","read_final_witness","read_final_lifetime",
] as const;
export type StoryboardReadStage=typeof stages[number];
const allowed=new Set<string>(stages);
const diagnostics=new WeakMap<object,StoryboardReadStage>();
export function recordStoryboardReadFailure<T>(error:T,stage:StoryboardReadStage):T{
 if(error!==null&&typeof error==="object"&&allowed.has(stage)&&!diagnostics.has(error))diagnostics.set(error,stage);
 return error;
}
export function storyboardReadFailureDiagnostic(error:unknown):StoryboardReadStage|undefined{
 return error!==null&&typeof error==="object"?diagnostics.get(error):undefined;
}
export function logStoryboardReadFailure(error:unknown,fallback:StoryboardReadStage,
 logger:(message:string,value:{stage:StoryboardReadStage})=>unknown=console.warn):void{
 const stage=storyboardReadFailureDiagnostic(error)??(allowed.has(fallback)?fallback:undefined);
 if(stage)try{logger("storyboard_retained_read_refused",{stage});}catch{/* Diagnosis never changes the original refusal. */}
}

import { captureStoryboardPlannerResponse } from "./output-storyboard-request.ts";
import { captureOutputStoryboardPlan } from "./output-storyboard-plan.ts";
import { parseStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
/** Source-free structural diagnostics; never returns provider text or arbitrary keys. */
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
export function outputPlannerResponseShape(value:unknown,expectedModel:string){
  const body=record(value),issues=new Set<string>();
  if(!body)return{valid:false,issues:["envelope_not_object"],reasoningEncryptedContent:false};
  if(body.model!==expectedModel)issues.add("model_mismatch");
  if(body.status!=="completed")issues.add("status_not_completed");
  if(body.incomplete_details)issues.add("incomplete_details_present");
  if(!body.id)issues.add("response_id_missing");
  const output=Array.isArray(body.output)?body.output:[];
  if(!output.length)issues.add("output_missing");
  if(output.filter(item=>record(item)?.type==="message").length!==1)issues.add("message_count_invalid");
  let reasoningEncryptedContent=false;
  for(const value of output){
    const item=record(value);
    if(!item){issues.add("output_item_not_object");continue;}
    if(item.type==="reasoning"){
      reasoningEncryptedContent ||= Object.hasOwn(item,"encrypted_content");
      // Responses includes encrypted_content in stateless (store:false) output.
      // Accept only this documented optional field, never decrypt or expose it.
      // https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses
      if(Object.keys(item).some(key=>!["id","type","status","summary","encrypted_content","content"].includes(key)))issues.add("reasoning_extra_fields");
      if(Object.hasOwn(item,"encrypted_content")&&item.encrypted_content!==null&&typeof item.encrypted_content!=="string")issues.add("reasoning_encrypted_content_invalid");
      // Optional reasoning content is metadata here, never the authored result.
      if(Object.hasOwn(item,"content")&&item.content!==null&&(!Array.isArray(item.content)||item.content.some(value=>{const part=record(value);return !part||Object.keys(part).some(key=>!["type","text"].includes(key))||part.type!=="reasoning_text"||typeof part.text!=="string";})))issues.add("reasoning_content_invalid");
      if(typeof item.id!=="string")issues.add("reasoning_id_invalid");
      if(!Array.isArray(item.summary)||item.summary.some(value=>{const part=record(value);return !part||part.type!=="summary_text"||typeof part.text!=="string";}))issues.add("reasoning_summary_invalid");
    }else{
      if(item.type!=="message")issues.add("output_type_invalid");
      if(item.role!=="assistant")issues.add("message_role_invalid");
      if(item.status!=="completed")issues.add("message_status_invalid");
      const content=Array.isArray(item.content)?item.content:[];
      if(content.length!==1)issues.add("message_content_count_invalid");
      if(record(content[0])?.type!=="output_text"||typeof record(content[0])?.text!=="string")issues.add("message_content_invalid");
    }
  }
  return{valid:issues.size===0,issues:[...issues],reasoningEncryptedContent};
}

/** Only the exact job's retained call may contribute shape-only inspection. */
export function retainedPlannerResponseShape(raw:string,identity:{jobId:string;documentId:string;streamId:string;kind:string;clientRequestId:string;responseId:string;model:string}){
  try{
    const retained=record(JSON.parse(raw)),call=record(retained?.call);
    if(!retained||retained.job_id!==identity.jobId||retained.document_id!==identity.documentId||retained.stream_id!==identity.streamId||retained.artifact_kind!==identity.kind
      ||retained.response_id!==identity.responseId||call?.clientRequestId!==identity.clientRequestId||call?.providerRequestId!==identity.responseId||call?.model!==identity.model
      ||typeof retained.raw_envelope!=="string"||retained.raw_envelope.length>524288)return null;
    return outputPlannerResponseShape(JSON.parse(retained.raw_envelope),identity.model);
  }catch{return null;}
}

/** Validate the original Storyboard candidate in place without disclosing its
 * creative contents or treating diagnostics as publication authority. */
export async function retainedStoryboardResponseShape(raw:string,identity:{jobId:string;documentId:string;streamId:string;kind:string;clientRequestId:string;responseId:string;model:string}){
  try{
    const retained=record(JSON.parse(raw)),call=record(retained?.call);
    if(identity.kind!=="storyboard"||!retained||retained.job_id!==identity.jobId||retained.document_id!==identity.documentId||retained.stream_id!==identity.streamId
      ||retained.artifact_kind!==identity.kind||retained.response_id!==identity.responseId||call?.clientRequestId!==identity.clientRequestId
      ||call?.providerRequestId!==identity.responseId||call?.model!==identity.model||typeof retained.provider_envelope!=="string"
      ||retained.provider_envelope.length>1_048_576||typeof retained.output_text!=="string"||retained.output_text.length>262144)return null;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(retained.output_text))),byte=>byte.toString(16).padStart(2,"0")).join("");
    if(digest!==retained.content_sha256)return null;
    const envelope=record(JSON.parse(retained.provider_envelope));
    if(!envelope||envelope.id!==identity.responseId||envelope.model!==identity.model)return null;
    let candidate:Record<string,unknown>|null=null;
    try{candidate=record(JSON.parse(retained.output_text));}catch{}
    const items=Array.isArray(candidate?.items)?candidate.items:[];
    const issues:string[]=[];
    try{await captureStoryboardPlannerResponse(envelope,retained.output_text,retained.output_storyboard);}catch{issues.push("storyboard_candidate_invalid");}
    const contractValid=Boolean(parseStoryboardOutputContract(retained.output_storyboard));
    let planValid=false;try{await captureOutputStoryboardPlan(candidate,retained.output_storyboard,identity.responseId);planValid=true;}catch{}
    // Fixed field names and numeric/type summaries only: no creative values,
    // unknown provider keys, group identifiers or opaque reasoning are exposed.
    const field=(value:unknown)=>({type:typeof value,length:typeof value==='string'?value.length:null,blank:typeof value==='string'?!value.trim():null});
    const candidateFields={title:field(candidate?.title),summary:field(candidate?.summary),contentMarkdown:field(candidate?.content_markdown),
      extraFieldCount:candidate?Object.keys(candidate).filter(key=>!['title','summary','content_markdown','items','presentation'].includes(key)).length:0,
      frames:items.slice(0,4).map(value=>{const row=record(value);return{title:field(row?.title),body:field(row?.body),notes:field(row?.notes),imagePrompt:field(row?.image_prompt),contextGroupCount:Array.isArray(row?.context_group_ids)?row.context_group_ids.length:null,extraFieldCount:row?Object.keys(row).filter(key=>!['title','body','notes','image_prompt','context_group_ids','slide'].includes(key)).length:0};})};
    const reasoningEncryptedContent=Array.isArray(envelope.output)&&envelope.output.some(item=>{const value=record(item);return value?.type==='reasoning'&&Object.hasOwn(value,'encrypted_content');});
    return{valid:issues.length===0,issues,contractValid,planValid,candidateFields,envelopeIssues:outputPlannerResponseShape(envelope,identity.model).issues,reasoningEncryptedContent,candidateParses:Boolean(candidate),frameCount:items.length,
      presentationField:!candidate||!Object.hasOwn(candidate,"presentation")?"absent":candidate.presentation===null?"null":"non_null",
      slideFields:items.slice(0,4).map(item=>{const row=record(item);return !row||!Object.hasOwn(row,"slide")?"absent":row.slide===null?"null":"non_null";})};
  }catch{return null;}
}

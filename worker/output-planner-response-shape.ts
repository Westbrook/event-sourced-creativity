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
      if(Object.keys(item).some(key=>!["id","type","status","summary"].includes(key)))issues.add("reasoning_extra_fields");
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

import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { parseAudioOutputContract, type AudioOutputContract } from "../src/model/output-audio-contract.ts";
import { parseAudioMiniAppCostPreview, audioMiniAppCostApprovalMatches } from "../src/model/audio-mini-app-consent.ts";
import { serializeAudioRequest } from "./audio-adapters/index.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import type { OutputNativeSettings } from "./output-image-slides-preflight.ts";
import type { PaidProviderSubmission } from "../src/model/provider-submission.ts";

export type OutputAudioAttempt = Readonly<{ contract: AudioOutputContract; requestBody: string }>;
export const outputAudioHash = async (value:string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");
export function readOutputAudioPayload(value: Record<string,unknown>) {
  const contract=parseAudioOutputContract(value.outputAudio);
  return contract && value.productionMode==="manual" && value.artifactKind==="audio" && value.itemCount===1
    && value.audioProviderModel==="fal-ai/stable-audio-3/medium/text-to-audio" && canonicalJson(value.audioProfile)===canonicalJson(EXPERIENCE_AUDIO_INTENT)
    && Number.isSafeInteger(value.audioEstimatedCostMicrousd) && Number(value.audioEstimatedCostMicrousd)>0
    && typeof value.outputTargetInstructions==="string" && value.outputTargetInstructions.length<=4000
    && !["productionPlan","productionPage","outputScene","outputNarrative","audioImageBlockId","audioVideoArtifactId","sendAudioVideoToProvider","spokenScript","voiceDirection","providerJobId","retainedReceipt"].some(key=>Object.hasOwn(value,key)) ? contract : null;
}
export function requireAudioMiniAppCostApproval(value:unknown, original:unknown, current:unknown) {
  const left=parseAudioMiniAppCostPreview(original),right=parseAudioMiniAppCostPreview(current);
  if(!left||!right||canonicalJson(left)!==canonicalJson(right)||!audioMiniAppCostApprovalMatches(value,right))throw new Error("audio_mini_app_confirmation_required");
  return right;
}
/** Intrinsic wire snapshot, not a caller's mutable input or an authority token. */
export async function captureOutputAudioAttempt(contractValue:unknown, body:string, clientRequestId:string, stage:string) {
  const contract=parseAudioOutputContract(contractValue);
  if(!contract||typeof body!=="string"||new TextEncoder().encode(body).byteLength>262144||!/^forma-(?:audio|document)-[A-Za-z0-9._:-]{1,150}$/u.test(clientRequestId))throw new Error("output_audio_request_invalid");
  const wire=JSON.parse(body) as Record<string,unknown>;
  let model:string,maximumInputTokens:number,maximumOutputTokens:number;
  if(stage==="audio:initial"){
    if(typeof wire.prompt!=="string"||!wire.prompt.trim()||wire.prompt!==wire.prompt.trim()||wire.prompt.length>5000)throw new Error("output_audio_request_invalid");
    model="fal-ai/stable-audio-3/medium/text-to-audio";
    if(canonicalJson(wire)!==canonicalJson(serializeAudioRequest(model,{prompt:wire.prompt,profile:EXPERIENCE_AUDIO_INTENT})))throw new Error("output_audio_request_invalid");
    maximumInputTokens=0;maximumOutputTokens=0;
  }else{
    if(!["planning:0:initial","planning:0:repair"].includes(stage))throw new Error("output_audio_request_invalid");
    const text=wire.text as Record<string,unknown>|undefined,format=text?.format as Record<string,unknown>|undefined;
    if(wire.model!=="gpt-5.6-terra"||wire.store!==false||wire.max_output_tokens!==3000||typeof wire.input!=="string"||typeof wire.instructions!=="string"
      ||format?.name!==(stage.endsWith(":repair")?"document_audio_repair":"document_audio")||format?.type!=="json_schema"||format.strict!==true
      ||wire.service_tier!=="default"||canonicalJson(wire.prompt_cache_options)!==canonicalJson({mode:"explicit"})||Object.hasOwn(wire,"tools"))throw new Error("output_audio_request_invalid");
    model="gpt-5.6-terra";maximumInputTokens=new TextEncoder().encode(body).byteLength+4096;maximumOutputTokens=3000;
  }
  return freeze({model,maximumInputTokens,maximumOutputTokens,clientRequestId,logicalCallKey:stage,requestDigest:await outputAudioHash(body),audio:{contract,requestBody:body}});
}
export async function assertOutputAudioAttempt(settings:OutputNativeSettings, attempt:ProviderAttemptPreflight) {
  const contract=readOutputAudioPayload(settings.payload),provided=parseAudioOutputContract(attempt.audio?.contract);
  if(!contract||!provided||canonicalJson(contract)!==canonicalJson(provided)||!attempt.audio||typeof attempt.audio.requestBody!=="string")throw new Error("output_audio_request_not_authorized");
  const capture=await captureOutputAudioAttempt(contract,attempt.audio.requestBody,attempt.clientRequestId,attempt.logicalCallKey??"");
  const route=settings.calls.find(route=>route.stage===capture.logicalCallKey);
  if(!route||route.model!==capture.model||!Number.isSafeInteger(route.maximumMicrousd)||route.maximumMicrousd<=0
    ||capture.logicalCallKey.startsWith("planning:")&&(!Number.isSafeInteger(route.maximumInputTokens)||capture.maximumInputTokens>Number(route.maximumInputTokens)||capture.maximumOutputTokens!==route.maximumOutputTokens))throw new Error("output_audio_request_not_authorized");
  for(const key of ["model","maximumInputTokens","maximumOutputTokens","clientRequestId","logicalCallKey","requestDigest"] as const)if(attempt[key]!==capture[key])throw new Error("output_audio_request_not_authorized");
}
/** Decoded-byte bounded reader; neither invalid JSON nor an unreadable error
 * envelope proves rejection/zero cost. No cancellation promise can delay exit. */
export async function readOutputAudioEnvelope(response:Response):Promise<string>{
 const maximum=262144,declared=response.headers.get("content-length"),encoding=response.headers.get("content-encoding"),identity=encoding===null||encoding.trim().toLowerCase()==="identity";
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,complete=false;
 try{
  if(!response.body||declared!==null&&(!/^(0|[1-9]\d*)$/u.test(declared)||!Number.isSafeInteger(Number(declared))||identity&&Number(declared)>maximum))throw new Error("output_audio_response_limit");
  reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
  for(;;){const next=await reader.read();if(next.done)break;if(!(next.value instanceof Uint8Array)||next.value.byteLength===0||length+next.value.byteLength>maximum)throw new Error("output_audio_response_limit");length+=next.value.byteLength;chunks.push(next.value);}
  complete=true;if(identity&&declared!==null&&Number(declared)!==length)throw new Error("output_audio_response_length_mismatch");
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
 }finally{if(!complete)try{const stopped=reader?reader.cancel():response.body?.cancel();if(stopped)void stopped.catch(()=>undefined);}catch{/* Keep original pending. */}reader?.releaseLock();}
}
export function verifyOutputAudioCalls(calls:PaidProviderSubmission[],contract:AudioOutputContract){
 const planning=calls.filter(call=>call.operation==="planning"),media=calls.filter(call=>call.operation==="audio");
 if(calls.length!==planning.length+media.length||planning.length<1||planning.length>2||media.length!==1||!parseAudioOutputContract(contract))throw new Error("output_audio_completion_unavailable");
 const stages=new Set<string>();
 for(const call of planning){if(call.provider!=="openai"||call.model!=="gpt-5.6-terra"||call.effectiveModel!==call.model||call.status!=="completed"||!call.providerRequestId||!call.responseRef
   ||!call.unitId||!["planning:0:initial","planning:0:repair"].includes(call.unitId)||stages.has(call.unitId)||!Number.isSafeInteger(call.costMicrousd)||Number(call.costMicrousd)<0||!Number.isSafeInteger(call.totalTokens)||Number(call.totalTokens)<0)throw new Error("output_audio_completion_unavailable");stages.add(call.unitId);}
 if(!stages.has("planning:0:initial"))throw new Error("output_audio_completion_unavailable");
 const final=planning.find(call=>call.unitId===(planning.length===2?"planning:0:repair":"planning:0:initial"));
 if(final?.validationStatus!=="valid"||final.completionStatus!=="completed")throw new Error("output_audio_completion_unavailable");
 const call=media[0]!;if(call.provider!=="fal"||call.model!=="fal-ai/stable-audio-3/medium/text-to-audio"||call.status!=="completed"||!call.providerRequestId||call.unitId!=="audio:initial"||!call.requestDigest||!Number.isSafeInteger(call.costMicrousd)||Number(call.costMicrousd)<=0||call.totalTokens!==0)throw new Error("output_audio_completion_unavailable");
 return freeze({schemaVersion:1,contract,plannerCallIds:planning.map(call=>call.clientRequestId),mediaCallId:call.clientRequestId,providerRequestId:call.providerRequestId,requestDigest:call.requestDigest,requestedSeconds:20,measuredSeconds:null,requirementFulfilled:false});
}

/** Sum measured original call prices only. No effective-model price inference. */
export function outputAudioPlannerCost(checkpoint:Record<string,unknown>,recorded=0){
 const entries=checkpoint.providerSubmissions;
 const calls=entries&&typeof entries==="object"&&!Array.isArray(entries)?Object.values(entries) as PaidProviderSubmission[]:[];
 if(!Number.isSafeInteger(recorded)||recorded<0)throw new Error("output_audio_cost_unavailable");
 let input=0,output=0;
 for(const call of calls.filter(call=>call.operation==="planning"&&call.status==="completed")){
  if(call.provider!=="openai"||call.model!=="gpt-5.6-terra"||call.effectiveModel!==call.model||![call.textInputCostMicrousd,call.textOutputCostMicrousd,call.costMicrousd].every(value=>Number.isSafeInteger(value)&&Number(value)>=0)
    ||Number(call.textInputCostMicrousd)+Number(call.textOutputCostMicrousd)!==call.costMicrousd)throw new Error("output_audio_cost_unavailable");
  input+=Number(call.textInputCostMicrousd);output+=Number(call.textOutputCostMicrousd);
 }
 if(!Number.isSafeInteger(input+output))throw new Error("output_audio_cost_unavailable");
 const paid=Math.min(input+output,recorded),paidInput=Math.min(input,paid);
 return{textInputMicrousd:input-paidInput,textOutputMicrousd:output-(paid-paidInput),imageTextInputMicrousd:0,imageInputMicrousd:0,imageOutputMicrousd:0,totalMicrousd:input+output-paid};
}

import type { WorkerEnv } from "./runtime.ts";
import { buildCreativeImagePrompt, validateImageReferences, type CreativeImageOptions, type ImageReference, type ImageOutputFormat } from "./openai-adapter.ts";
import { moderateExactImagePrompt } from "./openai-moderation.ts";
import { classifyProviderFailure, ProviderRequestError, providerErrorFromResponse } from "./provider-errors.ts";
import { normalizePromptTechnique } from "../src/model/prompt-structures.ts";
import { priceFalIdeogramImageBreakdownMicrousd, type FalIdeogramRenderingSpeed } from "./replay-cost.ts";

type FalQueueState = {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  request_id?: string;
  response_url?: string;
  status_url?: string;
  cancel_url?: string;
  queue_position?: number;
  logs?: Array<{ message?: string }>;
  error?: unknown;
  error_type?: string;
};
type FalImageFile = { url?: string; content_type?: string; width?: number; height?: number; file_size?: number };
type FalImageResult = { images?: FalImageFile[]; timings?: Record<string,number>; seed?: number; has_nsfw_concepts?: boolean[]; prompt?: string; error?: unknown };

export const FAL_IDEOGRAM_ADAPTER_ID="fal-ideogram-v4";
export const FAL_IDEOGRAM_ADAPTER_VERSION="v2";
const FAL_IMAGE_TIMEOUT_MS=10*60*1000;

const falHeaders=(env:WorkerEnv)=>({authorization:`Key ${env.FAL_KEY}`,"content-type":"application/json"});
const falEndpoint=(model:string)=>`https://queue.fal.run/${model}`;
const wait=(delay:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException("The operation was aborted.","AbortError"));return;}
  const timer=setTimeout(resolve,delay);
  signal?.addEventListener("abort",()=>{clearTimeout(timer);reject(new DOMException("The operation was aborted.","AbortError"));},{once:true});
});
const bytesToBase64=(bytes:Uint8Array)=>{
  let binary="";for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(bytes.length,offset+0x8000)));
  return btoa(binary);
};
const dataUri=(reference:ImageReference)=>`data:${reference.mimeType};base64,${bytesToBase64(reference.bytes)}`;
const outputFormat=(format:ImageOutputFormat|undefined):"jpeg"|"png"=>format==="png"?"png":"jpeg";
const renderingSpeed=(quality:CreativeImageOptions["quality"]):FalIdeogramRenderingSpeed=>quality==="low"?"TURBO":quality==="medium"?"BALANCED":"QUALITY";
export type FalIdeogramExpansionModel="None"|"Medium"|"Large";
export const falExpansionModel=(quality:CreativeImageOptions["quality"]):FalIdeogramExpansionModel=>quality==="high"?"Large":"Medium";
const referenceStrength=(reference:ImageReference)=>reference.mode==="preserve_composition"?.35:reference.mode==="preserve_subject"?.5:reference.mode==="preserve_style"?.65:reference.mode==="inspiration"?.82:.75;

export function validateFalImageSize(size:string){
  const match=/^(\d+)x(\d+)$/.exec(size);if(!match)return{valid:false,width:0,height:0,reason:"Use WIDTHxHEIGHT dimensions."};
  const width=Number(match[1]),height=Number(match[2]);
  if(width<512||height<512)return{valid:false,width,height,reason:"Ideogram V4 requires each side to be at least 512 pixels."};
  if(width>3840||height>3840)return{valid:false,width,height,reason:"Ideogram V4 accepts custom sides up to 3840 pixels."};
  if(width%16||height%16)return{valid:false,width,height,reason:"Ideogram V4 custom dimensions must be multiples of 16."};
  return{valid:true,width,height,reason:""};
}

const falBodyMessage=(body:unknown,fallback:string)=>{
  if(!body||typeof body!=="object")return fallback;
  const record=body as Record<string,unknown>;const nested=record.error&&typeof record.error==="object"?record.error as Record<string,unknown>:null;
  const direct=String(nested?.message??record.message??"").trim();if(direct)return direct;
  if(typeof record.error==="string"&&record.error.trim())return record.error.trim();
  if(typeof record.detail==="string"&&record.detail.trim())return record.detail.trim();
  if(Array.isArray(record.detail)){
    const details=record.detail.map((item)=>{
      if(typeof item==="string")return item.trim();if(!item||typeof item!=="object")return"";
      const detail=item as Record<string,unknown>;const location=Array.isArray(detail.loc)?detail.loc.map(String).join("."):"";const message=String(detail.msg??detail.message??"").trim();return[location,message].filter(Boolean).join(": ");
    }).filter(Boolean);if(details.length)return details.join("; ");
  }
  return fallback;
};
const falBodyCode=(body:unknown)=>{
  if(!body||typeof body!=="object")return"";const record=body as Record<string,unknown>;const nested=record.error&&typeof record.error==="object"?record.error as Record<string,unknown>:null;
  return String(nested?.code??nested?.type??record.error_type??record.code??"").trim();
};
const falError=(response:Response,body:unknown,fallback:string,prompt:string,requestId:string|null=null)=>{
  const message=falBodyMessage(body,fallback);const code=falBodyCode(body);const normalized=code||message!==fallback?{error:{code,message}}:body;
  const error=providerErrorFromResponse(response,normalized,fallback,prompt);
  return new ProviderRequestError({...error.detail,code:error.detail.code.startsWith("fal_")?error.detail.code:`fal_${error.detail.code}`,requestId:error.detail.requestId??requestId},prompt);
};

async function falJson(env:WorkerEnv,url:string,init:RequestInit,prompt:string,requestId:string|null=null){
  let response:Response;try{response=await fetch(url,init);}catch(error){throw new ProviderRequestError(classifyProviderFailure(error),prompt);}
  let body:unknown={};try{body=await response.clone().json();}catch{/* Keep status-level failure evidence. */}
  if(!response.ok)throw falError(response,body,`fal_image_${response.status}`,prompt,requestId);
  return body;
}

export async function generateFalCreativeImage(env:WorkerEnv,userId:string,snapshot:Record<string,unknown>,direction:Record<string,unknown>,options:CreativeImageOptions={}){
  if(!env.FAL_KEY)throw new ProviderRequestError({code:"fal_image_provider_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:"Fal image generation is not configured for this environment.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  if(!env.OPENAI_API_KEY)throw new ProviderRequestError({code:"safety_probe_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:"The image safety preflight is not configured. Fal image work cannot start without it.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  const quality=options.quality??"high";const size=options.size??"1536x1024";const sizeResult=validateFalImageSize(size);
  if(!sizeResult.valid)throw new ProviderRequestError({code:"fal_invalid_image_size",category:"provider",scope:"request",action:"edit_request",message:`The requested image size ${size} cannot be submitted to Ideogram V4. ${sizeResult.reason}`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const references=validateImageReferences(options.references??[]);
  if(references.length>1)throw new ProviderRequestError({code:"fal_multiple_reference_images_unsupported",category:"provider",scope:"request",action:"edit_request",message:"The Ideogram V4 image-to-image adapter accepts one reference image. Use the OpenAI image adapter for this multi-reference request.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  if(options.outputFormat==="webp")throw new ProviderRequestError({code:"fal_webp_output_unsupported",category:"provider",scope:"request",action:"edit_request",message:"The Ideogram V4 adapter returns JPEG or PNG. Choose one of those formats or use the OpenAI image adapter.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const promptTechnique=normalizePromptTechnique(options.promptTechnique);const prompt=buildCreativeImagePrompt(snapshot,direction,references,promptTechnique,{size,quality,partialImages:0});const started=Date.now();
  await options.onStage?.("safety-review","Reviewing the exact image prompt and selected reference pixels.");
  let moderation:Awaited<ReturnType<typeof moderateExactImagePrompt>>;try{moderation=await moderateExactImagePrompt(env,prompt,references,options.signal);}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  if(moderation.flagged)throw new ProviderRequestError({code:"safety_preflight_flagged",category:"safety",scope:"request",action:"edit_request",message:`A preflight review identified likely safety concerns${moderation.categories.length?` in ${moderation.categories.join(", ")}`:""}. Review the exact prompt and contributing context before retrying.`,retryable:false,retryAfterMs:null,requestId:moderation.requestId,httpStatus:400,riskCategories:moderation.categories,contributingReferenceIds:moderation.referenceIds,probe:"exact-prompt-and-reference-moderation"},prompt);

  const model=references.length?(env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"):(quality==="low"?(env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast"):(env.FAL_IMAGE_MODEL??"ideogram/v4"));
  const speed=renderingSpeed(quality);const expansionModel=falExpansionModel(quality);const format=outputFormat(options.outputFormat);const input:Record<string,unknown>={prompt,expansion_model:expansionModel,image_size:{width:sizeResult.width,height:sizeResult.height},rendering_speed:speed,num_images:1,enable_safety_checker:true,output_format:format};
  if(references[0]){input.image_url=dataUri(references[0]);input.strength=referenceStrength(references[0]);}
  await options.onStage?.("provider-submit",`Submitting to ${model}.`);
  const submitted=await falJson(env,falEndpoint(model),{method:"POST",headers:falHeaders(env),body:JSON.stringify(input),signal:options.signal},prompt) as FalQueueState;
  const requestId=String(submitted.request_id??"");if(!requestId)throw new ProviderRequestError({code:"fal_provider_returned_no_request_id",category:"provider",scope:"request",action:"retry",message:"Fal accepted no durable request identifier, so the image cannot be tracked safely.",retryable:true,retryAfterMs:2_000,requestId:null,httpStatus:502},prompt);
  const statusUrl=submitted.status_url??`${falEndpoint(model)}/requests/${encodeURIComponent(requestId)}/status`;const responseUrl=submitted.response_url??`${falEndpoint(model)}/requests/${encodeURIComponent(requestId)}/response`;
  await options.onStage?.("provider-queued",`Ideogram accepted request ${requestId.slice(0,8)} and is preparing the image.`);
  const deadline=Date.now()+FAL_IMAGE_TIMEOUT_MS;let state:FalQueueState=submitted;
  while(state.status!=="COMPLETED"){
    if(state.status==="FAILED"||state.status==="CANCELLED")throw new ProviderRequestError({code:`fal_image_${state.status.toLowerCase()}`,category:"provider",scope:"request",action:"retry",message:`Fal marked image request ${requestId.slice(0,8)} as ${state.status.toLowerCase()}.`,retryable:state.status==="FAILED",retryAfterMs:2_000,requestId,httpStatus:502},prompt);
    if(Date.now()>=deadline)throw new ProviderRequestError({code:"fal_image_timeout",category:"provider",scope:"request",action:"retry",message:"Fal did not finish this image within ten minutes. The provider request ID is retained for diagnosis.",retryable:true,retryAfterMs:5_000,requestId,httpStatus:504},prompt);
    const log=state.logs?.at(-1)?.message?.trim();await options.onStage?.("provider-rendering",log?`Ideogram · ${log}`:state.status==="IN_QUEUE"?`Ideogram queued${Number.isFinite(state.queue_position)?` · ${Number(state.queue_position)+1} ahead or active`:""}.`:"Ideogram is rendering the image.");
    await wait(1_000,options.signal);state=await falJson(env,`${statusUrl}${statusUrl.includes("?")?"&":"?"}logs=1`,{headers:falHeaders(env),signal:options.signal},prompt) as FalQueueState;
  }
  if(state.error!==undefined||state.error_type){
    const message=falBodyMessage({error:state.error,error_type:state.error_type},"Fal completed the queue request with a provider error.");const rawCode=falBodyCode({error:state.error,error_type:state.error_type});const safeCode=(rawCode||"completed_with_error").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
    throw new ProviderRequestError({code:`fal_${safeCode}`,category:"provider",scope:"request",action:"edit_request",message,retryable:false,retryAfterMs:null,requestId,httpStatus:422},prompt);
  }
  await options.onStage?.("provider-download","Ideogram finished rendering. Securing the private result.");
  const result=await falJson(env,responseUrl,{headers:falHeaders(env),signal:options.signal},prompt,requestId) as FalImageResult;
  const image=result.images?.[0];if(!image?.url)throw new ProviderRequestError({code:"fal_provider_returned_no_image",category:"provider",scope:"request",action:"retry",message:"Fal completed the request without an image URL.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);
  let imageUrl:URL;try{imageUrl=new URL(image.url);}catch{throw new ProviderRequestError({code:"fal_provider_returned_invalid_image_url",category:"provider",scope:"request",action:"retry",message:"Fal returned an invalid image location.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);}if(imageUrl.protocol!=="https:"||!(imageUrl.hostname==="fal.media"||imageUrl.hostname.endsWith(".fal.media")))throw new ProviderRequestError({code:"fal_provider_returned_untrusted_image_url",category:"provider",scope:"request",action:"retry",message:"Fal returned an image location outside its trusted media domain.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);
  let imageResponse:Response;try{imageResponse=await fetch(image.url,{signal:options.signal});}catch(error){throw new ProviderRequestError({...classifyProviderFailure(error),requestId},prompt);}
  if(!imageResponse.ok)throw falError(imageResponse,{},`fal_image_download_${imageResponse.status}`,prompt,requestId);
  const bytes=new Uint8Array(await imageResponse.arrayBuffer());if(!bytes.byteLength)throw new ProviderRequestError({code:"fal_provider_returned_empty_image",category:"provider",scope:"request",action:"retry",message:"Fal returned an empty image file.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);
  const width=Number(image.width??sizeResult.width),height=Number(image.height??sizeResult.height);const mimeType=image.content_type??imageResponse.headers.get("content-type")??(format==="png"?"image/png":"image/jpeg");if(!mimeType.startsWith("image/"))throw new ProviderRequestError({code:"fal_provider_returned_non_image",category:"provider",scope:"request",action:"retry",message:"Fal returned a non-image media type for an image request.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);
  return{provider:"fal" as const,adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,providerRequestId:requestId,model,prompt,promptTechnique,bytes,revisedPrompt:result.prompt&&result.prompt!==prompt?result.prompt:null,createdAt:null,latencyMs:Date.now()-started,usage:{inputTokens:0,outputTokens:0,totalTokens:0,textInputTokens:0,imageInputTokens:0},width,height,mimeType,quality,usedReference:references.length>0,referenceCount:references.length,referenceInputs:references.map((reference)=>({source:reference.source,blockId:reference.blockId??null,referenceId:reference.referenceId??null,label:reference.label??null,mode:reference.mode??null})),safetyProbeCount:moderation.probeCount,safetyCoverage:moderation.coverage,safetyRequestIds:moderation.requestIds,partialCount:0,outputFormat:format,outputCompression:null,seed:Number.isFinite(result.seed)?Number(result.seed):null,nsfwDetected:Boolean(result.has_nsfw_concepts?.some(Boolean)),renderingSpeed:speed,expansionModel,costBreakdown:priceFalIdeogramImageBreakdownMicrousd(model,width,height,speed,expansionModel),costPrecision:"provider-pixel-and-expansion-rate-estimate" as const};
}

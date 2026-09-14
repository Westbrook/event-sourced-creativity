import { captureOutputFalImageRequest, restoreOutputFalImageRequest, submitOutputFalImageRequest, outputFalImageCost, type OutputFalCapturedRequest } from "./output-fal-image-contract.ts";
import type { WorkerEnv } from "./runtime.ts";
import { buildCreativeImagePrompt, validateImageReferences, type CreativeImageOptions, type ImageReference, type ImageOutputFormat } from "./openai-adapter.ts";
import { moderateExactImagePrompt } from "./openai-moderation.ts";
import { classifyProviderFailure, ProviderRequestError, providerErrorFromResponse } from "./provider-errors.ts";
import { normalizePromptTechnique } from "../src/model/prompt-structures.ts";
import { priceFalIdeogramImageBreakdownMicrousd, type FalIdeogramRenderingSpeed } from "./replay-cost.ts";
import { buildIdeogramPrompt, classifyIdeogramPromptFocus, IDEOGRAM_PROMPT_ADAPTER_VERSION } from "./ideogram-prompt-adapter.ts";
import { buildIdeogramCaption, IDEOGRAM_CAPTION_ADAPTER_VERSION } from "./ideogram-caption-adapter.ts";
import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION } from "./fal-image-identity.ts";
export { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION };

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

export type FalImageProviderReceipt = {
  provider: "fal";
  model: string;
  providerRequestId: string;
  providerStatusUrl: string;
  providerResponseUrl: string;
  providerCancelUrl: string;
};
type FalCreativeImageOptions = CreativeImageOptions & {
  providerReceipt?: FalImageProviderReceipt;
  onProviderReceipt?: (receipt: FalImageProviderReceipt) => void | Promise<void>;
};

export const FAL_IDEOGRAM_CAPTION_STRATEGY="production_director" as const;
export const FAL_IDEOGRAM_REFERENCE_STRENGTHS={inspiration:.99,preserve_composition:.88,preserve_subject:.3,preserve_style:.72,default:.9} as const;
const FAL_IMAGE_TIMEOUT_MS=10*60*1000;

export function falIdeogramAdapterReadiness(env:WorkerEnv){return{configured:Boolean(env.FAL_KEY?.trim()),fal:Boolean(env.FAL_KEY?.trim()),missing:env.FAL_KEY?.trim()?[]:["Fal key"]};}

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
export const falRenderingSpeed=(quality:CreativeImageOptions["quality"]):FalIdeogramRenderingSpeed=>quality==="high"?"QUALITY":"BALANCED";
export type FalIdeogramExpansionModel="None"|"Medium"|"Large";
export const falExpansionModel=(quality:CreativeImageOptions["quality"],promptMode:CreativeImageOptions["ideogramPromptMode"]="expanded_plain",requested?:CreativeImageOptions["ideogramExpansionModel"]):FalIdeogramExpansionModel=>requested??(promptMode==="expanded_plain"?(quality==="high"?"Large":"Medium"):"None");
export const falExpansionModelForRequest=(env:WorkerEnv,quality:CreativeImageOptions["quality"],model:string,promptMode:CreativeImageOptions["ideogramPromptMode"]="expanded_plain",requested?:CreativeImageOptions["ideogramExpansionModel"]):FalIdeogramExpansionModel=>{
  if(requested)return requested;
  if(promptMode!=="expanded_plain")return"None";
  return model===(env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast")?"Medium":"Large";
};
export const falReferenceStrength=(reference:ImageReference,override?:number)=>Number.isFinite(override)?Math.max(0,Math.min(1,Number(override))):reference.mode&&reference.mode in FAL_IDEOGRAM_REFERENCE_STRENGTHS?FAL_IDEOGRAM_REFERENCE_STRENGTHS[reference.mode as keyof typeof FAL_IDEOGRAM_REFERENCE_STRENGTHS]:FAL_IDEOGRAM_REFERENCE_STRENGTHS.default;
export const falImageModelForRequest=(env:WorkerEnv,quality:CreativeImageOptions["quality"],references:ImageReference[],direction:Record<string,unknown>)=>{
  if(references.length)return env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image";
  const scene=String(direction.scene??"");
  // A low-quality material study still asks the model to resolve a person,
  // action, counted composition, and multiple judgeable surfaces. The fast
  // endpoint repeatedly reduced these to unattended still lifes, so route
  // this semantically complex class through the standard endpoint.
  const complexLowStudy=quality==="low"&&classifyIdeogramPromptFocus(scene,false,false,0)==="material";
  return quality==="low"&&!complexLowStudy?(env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast"):(env.FAL_IMAGE_MODEL??"ideogram/v4");
};

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

async function falJson(env:WorkerEnv,url:string,init:RequestInit,prompt:string,requestId:string|null=null,assertCurrent?:()=>Promise<void>){
  if(assertCurrent)await assertCurrent();
  let response:Response;try{response=await fetch(url,init);}catch(error){throw new ProviderRequestError({...classifyProviderFailure(error),...(requestId?{requestId}:{})},prompt);}
  let body:unknown={};try{body=await response.clone().json();}catch{/* Keep status-level failure evidence. */}
  if(assertCurrent)await assertCurrent();
  if(!response.ok)throw falError(response,body,`fal_image_${response.status}`,prompt,requestId);
  return body;
}

function trustedFalQueueUrl(value:string|undefined,fallback:string,requestId:string,prompt:string,legacyPaths:string[]=[]){
  let url:URL;try{url=new URL(value||fallback);}catch{throw new ProviderRequestError({code:"fal_provider_returned_untrusted_queue_url",category:"provider",scope:"request",action:"contact_support",message:"Fal returned an invalid queue location. The accepted request will not be polled outside its trusted provider endpoint.",retryable:false,retryAfterMs:null,requestId,httpStatus:502},prompt);}
  const expected=new URL(fallback);
  if(url.origin!==expected.origin||url.pathname!==expected.pathname&&!legacyPaths.includes(url.pathname)||url.username||url.password)throw new ProviderRequestError({code:"fal_provider_returned_untrusted_queue_url",category:"provider",scope:"request",action:"contact_support",message:"Fal returned a queue location outside the accepted request's trusted provider endpoint.",retryable:false,retryAfterMs:null,requestId,httpStatus:502},prompt);
  return url.toString();
}

/** Derive a recoverable Fal queue receipt exclusively from an owned model and validated request ID. */
export function falImageProviderReceipt(model:string,requestId:string,prompt=""):FalImageProviderReceipt{
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(requestId)||["pending","submitted","unknown"].includes(requestId.toLowerCase()))throw new ProviderRequestError({code:"fal_provider_returned_invalid_request_id",category:"provider",scope:"request",action:"contact_support",message:"Fal returned an invalid accepted-request identifier. Automatic resubmission was stopped to prevent a duplicate charge.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:502},prompt);
  const parts=model.split("/");const applicationLength=parts[0]==="workflows"||parts[0]==="comfy"?3:2;
  if(parts.length<applicationLength||parts.some((part)=>!part||part==="."||part===".."||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part)))throw new ProviderRequestError({code:"fal_provider_receipt_mismatch",category:"provider",scope:"request",action:"contact_support",message:"The saved image request does not identify a trusted Fal application. A second paid image request was not submitted.",retryable:false,retryAfterMs:null,requestId,httpStatus:409},prompt);
  const requestEndpoint=`https://queue.fal.run/${parts.slice(0,applicationLength).join("/")}/requests/${encodeURIComponent(requestId)}`;
  return{
    provider:"fal",model,providerRequestId:requestId,
    providerStatusUrl:`${requestEndpoint}/status`,
    providerResponseUrl:requestEndpoint,
    providerCancelUrl:`${requestEndpoint}/cancel`,
  };
}

function falProviderReceipt(model:string,requestId:string,state:Pick<FalQueueState,"status_url"|"response_url"|"cancel_url">,prompt:string):FalImageProviderReceipt{
  const canonical=falImageProviderReceipt(model,requestId,prompt);
  const legacyEndpoint=new URL(`${falEndpoint(model)}/requests/${encodeURIComponent(requestId)}`).pathname;
  return{
    ...canonical,
    providerStatusUrl:trustedFalQueueUrl(state.status_url,canonical.providerStatusUrl,requestId,prompt,[`${legacyEndpoint}/status`]),
    providerResponseUrl:trustedFalQueueUrl(state.response_url,canonical.providerResponseUrl,requestId,prompt,[legacyEndpoint,`${legacyEndpoint}/response`]),
    providerCancelUrl:trustedFalQueueUrl(state.cancel_url,canonical.providerCancelUrl,requestId,prompt,[`${legacyEndpoint}/cancel`]),
  };
}

export async function generateFalCreativeImage(env:WorkerEnv,userId:string,snapshot:Record<string,unknown>,direction:Record<string,unknown>,options:FalCreativeImageOptions={}){
  if(!env.FAL_KEY)throw new ProviderRequestError({code:"fal_image_provider_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:"Fal image generation is not configured for this environment.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  if(!env.OPENAI_API_KEY)throw new ProviderRequestError({code:"safety_probe_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:"The image safety preflight is not configured. Fal image work cannot start without it.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  const quality=options.quality??"high";const size=options.size??"1536x1024";const sizeResult=validateFalImageSize(size);
  if(!sizeResult.valid)throw new ProviderRequestError({code:"fal_invalid_image_size",category:"provider",scope:"request",action:"edit_request",message:`The requested image size ${size} cannot be submitted to Ideogram V4. ${sizeResult.reason}`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const references=validateImageReferences(options.references??[]);
  if(references.length>1)throw new ProviderRequestError({code:"fal_multiple_reference_images_unsupported",category:"provider",scope:"request",action:"edit_request",message:"The Ideogram V4 image-to-image adapter accepts one reference image. Use the OpenAI image adapter for this multi-reference request.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  if(options.outputFormat==="webp")throw new ProviderRequestError({code:"fal_webp_output_unsupported",category:"provider",scope:"request",action:"edit_request",message:"The Ideogram V4 adapter returns JPEG or PNG. Choose one of those formats or use the OpenAI image adapter.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:400});
  const promptTechnique=normalizePromptTechnique(options.promptTechnique);const canonicalPrompt=options.preparedPrompt?.trim()||buildCreativeImagePrompt(snapshot,direction,references,promptTechnique,{size,quality,partialImages:0});const promptMode=options.ideogramPromptMode??"expanded_plain";const ideogramCaptionStrategy=options.ideogramCaptionStrategy??FAL_IDEOGRAM_CAPTION_STRATEGY;const adaptation=promptMode==="expanded_plain"?buildIdeogramPrompt(snapshot,direction,canonicalPrompt,references,{size,quality,promptTechnique,ideogramCaptionStrategy}):buildIdeogramCaption(snapshot,direction,canonicalPrompt,references,{size,quality,promptTechnique,ideogramCaptionStrategy});const prompt=adaptation.prompt;const promptAdapterVersion=promptMode==="expanded_plain"?IDEOGRAM_PROMPT_ADAPTER_VERSION:IDEOGRAM_CAPTION_ADAPTER_VERSION;const started=Date.now();
  if(!adaptation.valid)throw new ProviderRequestError({code:promptMode==="expanded_plain"?"ideogram_prompt_invalid":"ideogram_caption_invalid",category:"provider",scope:"request",action:"edit_request",message:`The Ideogram ${promptMode==="expanded_plain"?"prompt":"caption"} compiler produced an invalid provider prompt: ${adaptation.issues.join("; ")}`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:400},prompt);
  const model=falImageModelForRequest(env,quality,references,direction);
  const speed=falRenderingSpeed(quality);const expansionModel=falExpansionModelForRequest(env,quality,model,promptMode,options.ideogramExpansionModel);const format=outputFormat(options.outputFormat);const input:Record<string,unknown>={prompt,expansion_model:expansionModel,image_size:{width:sizeResult.width,height:sizeResult.height},rendering_speed:speed,acceleration:"none",num_images:1,sync_mode:false,enable_safety_checker:true,output_format:format};
  if(Number.isFinite(options.ideogramSeed))input.seed=Math.max(0,Math.min(2_147_483_647,Math.floor(Number(options.ideogramSeed))));
  if(references[0]){input.image_url=dataUri(references[0]);input.strength=falReferenceStrength(references[0],options.ideogramReferenceStrength);}
  const nativeRequest=options.outputFalImage===undefined?null:await captureOutputFalImageRequest(options.outputFalImage,model,input,
    {promptMode,promptAdapterVersion,captionStrategy:ideogramCaptionStrategy,adapterVersion:options.ideogramAdapterVersion??FAL_IDEOGRAM_ADAPTER_VERSION},options.providerClientRequestId??"");
  if(nativeRequest&&(!options.onBeforeProviderAttempt||!options.onProviderSubmission||!options.onBeforeProviderDispatch||!options.onOutputFalRequest||!options.onBeforeSourceTransmission||options.providerReceipt))throw new Error("output_fal_dispatch_hooks_required");
  await options.onStage?.("safety-review","Reviewing the exact image prompt and selected reference pixels.");
  let moderation:Awaited<ReturnType<typeof moderateExactImagePrompt>>;try{moderation=await moderateExactImagePrompt(env,prompt,references,options.signal);}catch(error){if(error instanceof ProviderRequestError)throw new ProviderRequestError(error.detail,prompt);throw error;}
  if(moderation.flagged)throw new ProviderRequestError({code:"safety_preflight_flagged",category:"safety",scope:"request",action:"edit_request",message:`A preflight review identified likely safety concerns${moderation.categories.length?` in ${moderation.categories.join(", ")}`:""}. Review the exact prompt and contributing context before retrying.`,retryable:false,retryAfterMs:null,requestId:moderation.requestId,httpStatus:400,riskCategories:moderation.categories,contributingReferenceIds:moderation.referenceIds,probe:"exact-prompt-and-reference-moderation"},prompt);

  let state:FalQueueState;let receipt:FalImageProviderReceipt;
  if(options.providerReceipt){
    const retained=options.providerReceipt;
    if(retained.provider!=="fal"||retained.model!==model)throw new ProviderRequestError({code:"fal_provider_receipt_mismatch",category:"provider",scope:"request",action:"contact_support",message:"The saved image request does not match its original Fal model. A second paid image request was not submitted.",retryable:false,retryAfterMs:null,requestId:retained.providerRequestId||null,httpStatus:409},prompt);
    receipt=falProviderReceipt(model,retained.providerRequestId,{status_url:retained.providerStatusUrl,response_url:retained.providerResponseUrl,cancel_url:retained.providerCancelUrl},prompt);
    await options.onProviderReceipt?.(receipt);
    await options.onStage?.("provider-resume",`Resuming the original Ideogram request ${receipt.providerRequestId.slice(0,8)} without submitting another image.`);
    state=await falJson(env,`${receipt.providerStatusUrl}${receipt.providerStatusUrl.includes("?")?"&":"?"}logs=1`,{headers:falHeaders(env),signal:options.signal},prompt,receipt.providerRequestId) as FalQueueState;
  }else{
    await options.onStage?.("provider-submit",`Submitting to ${model}.`);
    const post=(body:string)=>falJson(env,falEndpoint(model),{method:"POST",headers:falHeaders(env),body,signal:options.signal},prompt);
    const submitted=(nativeRequest?await submitOutputFalImageRequest(nativeRequest,{beforeAttempt:options.onBeforeProviderAttempt!,checkpoint:request=>options.onOutputFalRequest!(request,{canonicalPrompt,promptTechnique,promptMode,promptAdapterVersion,promptAdaptation:adaptation,safety:moderation}),pending:options.onProviderSubmission!,beforeDispatch:options.onBeforeProviderDispatch!},post)
      :await post(JSON.stringify(input))) as FalQueueState;
    const acceptedRequestId=String(submitted.request_id??"");if(!acceptedRequestId)throw new ProviderRequestError({code:"fal_provider_returned_no_request_id",category:"provider",scope:"request",action:"contact_support",message:"Fal accepted no durable request identifier, so the image cannot be tracked or resubmitted safely.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:502},prompt);
    receipt=falImageProviderReceipt(model,acceptedRequestId,prompt);
    await options.onProviderReceipt?.(receipt);
    receipt=falProviderReceipt(model,acceptedRequestId,submitted,prompt);
    await options.onStage?.("provider-queued",`Ideogram accepted request ${receipt.providerRequestId.slice(0,8)} and is preparing the image.`);
    state=submitted;
  }
  const requestId=receipt.providerRequestId,statusUrl=receipt.providerStatusUrl,responseUrl=receipt.providerResponseUrl;
  const deadline=Date.now()+FAL_IMAGE_TIMEOUT_MS;
  while(state.status!=="COMPLETED"){
    if(state.status==="FAILED"||state.status==="CANCELLED")throw new ProviderRequestError({code:`fal_image_${state.status.toLowerCase()}`,category:"provider",scope:"request",action:"retry",message:`Fal marked image request ${requestId.slice(0,8)} as ${state.status.toLowerCase()}.`,retryable:state.status==="FAILED",retryAfterMs:2_000,requestId,httpStatus:502},prompt);
    if(Date.now()>=deadline)throw new ProviderRequestError({code:"fal_image_timeout",category:"provider",scope:"request",action:"retry",message:"Fal did not finish this image within ten minutes. The provider request ID is retained for diagnosis.",retryable:true,retryAfterMs:5_000,requestId,httpStatus:504},prompt);
    const log=state.logs?.at(-1)?.message?.trim();await options.onStage?.("provider-rendering",log?`Ideogram · ${log}`:state.status==="IN_QUEUE"?`Ideogram queued${Number.isFinite(state.queue_position)?` · ${Number(state.queue_position)+1} ahead or active`:""}.`:"Ideogram is rendering the image.");
    await wait(1_000,options.signal);state=await falJson(env,`${statusUrl}${statusUrl.includes("?")?"&":"?"}logs=1`,{headers:falHeaders(env),signal:options.signal},prompt,requestId) as FalQueueState;
  }
  if(state.error!==undefined||state.error_type){
    const message=falBodyMessage({error:state.error,error_type:state.error_type},"Fal completed the queue request with a provider error.");const rawCode=falBodyCode({error:state.error,error_type:state.error_type});const safeCode=(rawCode||"completed_with_error").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
    throw new ProviderRequestError({code:`fal_${safeCode}`,category:"provider",scope:"request",action:"edit_request",message,retryable:false,retryAfterMs:null,requestId,httpStatus:422},prompt);
  }
  await options.onStage?.("provider-download","Ideogram finished rendering. Securing the private result.");
  const result=await falJson(env,responseUrl,{headers:falHeaders(env),signal:options.signal},prompt,requestId) as FalImageResult;
  const {image,bytes,width,height,mimeType}=await readFalImageFile(result,requestId,prompt,sizeResult,format,options.signal,nativeRequest,nativeRequest?async()=>{await options.onBeforeSourceTransmission?.();}:undefined);
  return{provider:"fal" as const,adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:options.ideogramAdapterVersion??FAL_IDEOGRAM_ADAPTER_VERSION,providerRequestId:requestId,providerMediaUrl:image.url,model,prompt,canonicalPrompt,promptTechnique,promptMode,promptAdapterVersion,promptAdaptation:adaptation,bytes,revisedPrompt:result.prompt&&result.prompt!==prompt?result.prompt:null,createdAt:null,latencyMs:Date.now()-started,usage:{inputTokens:0,outputTokens:0,totalTokens:0,textInputTokens:0,imageInputTokens:0},width,height,mimeType,quality,usedReference:references.length>0,referenceCount:references.length,referenceInputs:references.map((reference)=>({source:reference.source,blockId:reference.blockId??null,referenceId:reference.referenceId??null,label:reference.label??null,mode:reference.mode??null,strength:falReferenceStrength(reference,options.ideogramReferenceStrength)})),safetyProbeCount:moderation.probeCount,safetyCoverage:moderation.coverage,safetyRequestIds:moderation.requestIds,partialCount:0,outputFormat:format,outputCompression:null,seed:Number.isFinite(result.seed)?Number(result.seed):null,nsfwDetected:Boolean(result.has_nsfw_concepts?.some(Boolean)),renderingSpeed:speed,expansionModel,costBreakdown:nativeRequest?outputFalImageCost(nativeRequest.contract):priceFalIdeogramImageBreakdownMicrousd(model,width,height,speed,expansionModel),...(nativeRequest?{pricingVersion:nativeRequest.contract.pricingVersion}:{}),costPrecision:"provider-pixel-rate-estimate" as const};
}

// Share the existing media/PNG validator between first run and GET-only recovery.
async function boundedFalImageBytes(response:Response){
  const {MAX_OUTPUT_ASSET_BYTES}=await import("../src/model/output-asset-inspection.ts");
  const length=response.headers.get("content-length");
  if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_OUTPUT_ASSET_BYTES)){await response.body?.cancel();throw new Error("output_fal_result_too_large");}
  if(!response.body)throw new Error("output_fal_result_empty");
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{
    for(;;){const chunk=await reader.read();if(chunk.done)break;
      total+=chunk.value.byteLength;if(total>MAX_OUTPUT_ASSET_BYTES)throw new Error("output_fal_result_too_large");chunks.push(chunk.value);}
  }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
async function readFalImageFile(result:FalImageResult,requestId:string,prompt:string,size:{width:number;height:number},format:"png"|"jpeg",signal?:AbortSignal,nativeRequest?:OutputFalCapturedRequest|null,assertCurrent?:()=>Promise<void>){
  if(nativeRequest&&result.images?.length!==1)throw new Error("output_fal_result_outside_contract");
  const image=result.images?.[0];if(!image?.url)throw new ProviderRequestError({code:"fal_provider_returned_no_image",category:"provider",scope:"request",action:"retry",message:"Fal completed the request without an image URL.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);
  let imageUrl:URL;try{imageUrl=new URL(image.url);}catch{throw new ProviderRequestError({code:"fal_provider_returned_invalid_image_url",category:"provider",scope:"request",action:"retry",message:"Fal returned an invalid image location.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);}if(imageUrl.protocol!=="https:"||imageUrl.username||imageUrl.password||imageUrl.port||!(imageUrl.hostname==="fal.media"||imageUrl.hostname.endsWith(".fal.media")))throw new ProviderRequestError({code:"fal_provider_returned_untrusted_image_url",category:"provider",scope:"request",action:"retry",message:"Fal returned an image location outside its trusted media domain.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);
  await assertCurrent?.();
  let imageResponse:Response;try{imageResponse=await fetch(image.url,{method:"GET",...(nativeRequest?{redirect:"error" as const}:{}),signal});}catch(error){throw new ProviderRequestError({...classifyProviderFailure(error),requestId},prompt);}
  if(!imageResponse.ok)throw falError(imageResponse,{},`fal_image_download_${imageResponse.status}`,prompt,requestId);
  const bytes=nativeRequest?await boundedFalImageBytes(imageResponse):new Uint8Array(await imageResponse.arrayBuffer());
  await assertCurrent?.();if(!bytes.byteLength)throw new ProviderRequestError({code:"fal_provider_returned_empty_image",category:"provider",scope:"request",action:"retry",message:"Fal returned an empty image file.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);
  const width=Number(image.width??size.width),height=Number(image.height??size.height);const mimeType=image.content_type??imageResponse.headers.get("content-type")??(format==="png"?"image/png":"image/jpeg");if(!mimeType.startsWith("image/"))throw new ProviderRequestError({code:"fal_provider_returned_non_image",category:"provider",scope:"request",action:"retry",message:"Fal returned a non-image media type for an image request.",retryable:true,retryAfterMs:2_000,requestId,httpStatus:502},prompt);
  if(nativeRequest){
    const { inspectOutputAsset }=await import("../src/model/output-asset-inspection.ts");
    const inspected=await inspectOutputAsset(bytes,"image.png",{snapshot:false});
    if(width!==nativeRequest.contract.width||height!==nativeRequest.contract.height||mimeType!=="image/png"
      ||inspected.status!=="inspected"||inspected.kind!=="image"||inspected.mimeType!=="image/png"
      ||inspected.facts.width!==nativeRequest.contract.width||inspected.facts.height!==nativeRequest.contract.height)throw new Error("output_fal_result_outside_contract");
  }
  return{result,image,bytes,width,height,mimeType};
}

/** One read of an already accepted request. Never plans, moderates, submits, cancels or claims. */
export async function readOutputFalImageResult(env:WorkerEnv,retained:OutputFalCapturedRequest,receipt:FalImageProviderReceipt,options:{assertCurrent:()=>Promise<void>;signal?:AbortSignal;onStage?:(stage:"provider_status"|"provider_result"|"provider_media")=>void}){
  if(typeof options?.assertCurrent!=="function"||!env.FAL_KEY?.trim())throw new Error("output_fal_recovery_unavailable");
  const captured=await restoreOutputFalImageRequest(retained.contract,retained.body,retained.attempt.clientRequestId,retained.attempt.requestDigest);
  const canonical=falImageProviderReceipt(captured.contract.model,receipt.providerRequestId);
  if(Object.keys(receipt).length!==Object.keys(canonical).length||Object.entries(canonical).some(([key,value])=>receipt[key as keyof FalImageProviderReceipt]!==value))throw new Error("output_fal_recovery_receipt_mismatch");
  const read=(url:string)=>falJson(env,url,{method:"GET",redirect:"error",headers:falHeaders(env),signal:options.signal},"",canonical.providerRequestId,options.assertCurrent);
  options.onStage?.("provider_status");
  const state=await read(canonical.providerStatusUrl) as FalQueueState;
  if(!state||typeof state!=="object"||state.request_id!==undefined&&state.request_id!==canonical.providerRequestId)throw new Error("output_fal_recovery_receipt_mismatch");
  if(state.status==="IN_QUEUE"||state.status==="IN_PROGRESS")return{status:"pending" as const,providerRequestId:canonical.providerRequestId};
  if(state.status!=="COMPLETED"||state.error!==undefined||state.error_type)throw new Error("output_fal_recovery_result_unavailable");
  options.onStage?.("provider_result");
  const result=await read(canonical.providerResponseUrl) as FalImageResult;
  if(!result||typeof result!=="object"||result.error!==undefined)throw new Error("output_fal_recovery_result_unavailable");
  options.onStage?.("provider_media");
  const image=await readFalImageFile(result,canonical.providerRequestId,"",captured.contract,"png",options.signal,captured,options.assertCurrent);
  await options.assertCurrent();
  return{status:"completed" as const,providerRequestId:canonical.providerRequestId,...image,costBreakdown:outputFalImageCost(captured.contract),pricingVersion:captured.contract.pricingVersion};
}

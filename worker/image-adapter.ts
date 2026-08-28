import type { WorkerEnv } from "./runtime.ts";
import { outputImageBudget } from "./output-image-budget.ts";
import { generateCreativeImage as generateOpenAICreativeImage, buildCreativeImagePrompt, type CreativeImageOptions } from "./openai-adapter.ts";
import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION, falImageModelForRequest, generateFalCreativeImage, type FalImageProviderReceipt } from "./fal-image-adapter.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import { priceImageUsageBreakdownMicrousd } from "./replay-cost.ts";
import { definitiveProviderRejection, type PaidProviderSubmission } from "../src/model/provider-submission.ts";

export type ImageAdapterProvider="openai"|"fal-ideogram";
export type ImageAdapterSelection={provider:ImageAdapterProvider;providerName:"openai"|"fal";model:string;adapterId:string;adapterVersion:string;reason:string;capabilities:string[]};

export function selectImageAdapter(env:WorkerEnv,options:CreativeImageOptions={}):ImageAdapterSelection{
  const requested=(env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase();const references=options.references??[];
  const falRequested=requested==="fal"||requested==="fal-ideogram"||requested==="ideogram"||requested==="ideogram-4";
  if(falRequested&&env.FAL_KEY&&references.length<=1&&options.outputFormat!=="webp"){
    const model=references.length?(env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"):options.quality==="low"?(env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast"):(env.FAL_IMAGE_MODEL??"ideogram/v4");
    return{provider:"fal-ideogram",providerName:"fal",model,adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,reason:references.length?"one-reference Ideogram 4 image-to-image":"configured Ideogram 4 text-to-image",capabilities:["image-generation","private-asset-output","context-snapshot","canonical-prompt-receipt","provider-expanded-caption","auditable-expansion-strategy","native-caption-diagnostic","quality-levels","custom-image-size","block-level-image-format",...(references.length?["reference-pixel-input","single-image-input","image-editing","reference-mode-strength"]:[])]};
  }
  const reason=falRequested&&!env.FAL_KEY?"Fal is not configured":falRequested&&references.length>1?"Ideogram 4 accepts one reference; preserving the multi-reference contract":falRequested&&options.outputFormat==="webp"?"Ideogram 4 does not return WebP":"configured OpenAI image adapter";
  return{provider:"openai",providerName:"openai",model:env.OPENAI_IMAGE_MODEL??"gpt-image-2",adapterId:"openai-image",adapterVersion:"v5",reason,capabilities:["image-generation","image-editing","private-asset-output","context-snapshot","quality-levels","reference-pixel-input","multiple-image-input","custom-image-size","block-level-image-format","streaming-previews"]};
}

export async function generateCreativeImage(env:WorkerEnv,userId:string,snapshot:Record<string,unknown>,direction:Record<string,unknown>,options:CreativeImageOptions={}){
  const selection=selectImageAdapter(env,options);
  const falOptions=options as CreativeImageOptions&{providerReceipt?:FalImageProviderReceipt;onProviderReceipt?:(receipt:FalImageProviderReceipt)=>void|Promise<void>};
  let submission:PaidProviderSubmission={clientRequestId:options.providerClientRequestId??`forma-image-${crypto.randomUUID()}`,provider:selection.providerName,operation:"image",model:selection.provider==="fal-ideogram"?falImageModelForRequest(env,options.quality,options.references??[],direction):selection.model,status:falOptions.providerReceipt?"accepted":"pending",...(falOptions.providerReceipt?{providerRequestId:falOptions.providerReceipt.providerRequestId}:{})};
  let attempted=false;
  const preparedPrompt=options.preparedPrompt?.trim()||(options.onBeforeProviderAttempt?buildCreativeImagePrompt(snapshot,direction,options.references??[],options.promptTechnique,{size:options.size,quality:options.quality,partialImages:options.partialImages,outputImageFormat:options.outputImageFormat,outputTargetInstructions:options.outputTargetInstructions}):undefined);
  const requestDigest=async()=>{
    const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes).buffer)),byte=>byte.toString(16).padStart(2,"0")).join("");
    const references=await Promise.all((options.references??[]).map(async(reference)=>({mimeType:reference.mimeType,sha256:await hash(reference.bytes)})));
    return hash(new TextEncoder().encode(JSON.stringify({model:submission.model,prompt:preparedPrompt,size:options.size,quality:options.quality,outputFormat:options.outputFormat??"png",references})));
  };
  const observedOptions={...options,...(preparedPrompt?{preparedPrompt}:{}),providerClientRequestId:submission.clientRequestId,
    ...(options.onProviderSubmission?{onProviderSubmission:async(receipt:PaidProviderSubmission)=>{submission=receipt;await options.onProviderSubmission?.(receipt);}}:{}),
    onStage:async(stage:string,message:string)=>{
      // Validation and moderation run before this exact paid-dispatch boundary.
      if(stage==="safety-review")await options.onBeforeSourceTransmission?.();
      if(stage==="provider-submit"){
        if(options.onBeforeProviderAttempt){
          const budget=outputImageBudget(submission.model,options.size??"1536x1024",new TextEncoder().encode(preparedPrompt??"").byteLength);
          if(!budget||(options.references?.length??0)>budget.maximumReferenceImages||options.quality!=="high"||(options.partialImages??0)!==0)throw new Error("output_image_request_outside_priced_contract");
          await options.onBeforeProviderAttempt({model:submission.model,maximumInputTokens:budget.maximumInputTokens,maximumOutputTokens:budget.maximumOutputTokens,clientRequestId:submission.clientRequestId,logicalCallKey:"image:initial",requestDigest:await requestDigest()});
        }
        await options.onProviderSubmission?.(submission);attempted=true;
      }
      await options.onStage?.(stage,message);
    },
    onProviderReceipt:async(receipt:FalImageProviderReceipt)=>{
      submission={...submission,status:"accepted",providerRequestId:receipt.providerRequestId};
      await options.onProviderSubmission?.(submission);
      await falOptions.onProviderReceipt?.(receipt);
    },
  };
  try{
    const result=await (async()=>{
      if(selection.provider==="fal-ideogram")return generateFalCreativeImage(env,userId,snapshot,direction,observedOptions);
      if(!env.OPENAI_API_KEY)throw new ProviderRequestError({code:"image_provider_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:`The selected image request cannot use Fal (${selection.reason}), and the OpenAI image adapter is not configured.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
      const image=await generateOpenAICreativeImage(env,userId,snapshot,direction,observedOptions);
      return{...image,provider:"openai" as const,adapterId:"openai-image",adapterVersion:"v5",providerMediaUrl:null,costBreakdown:priceImageUsageBreakdownMicrousd(image.model,image.usage,image.usedReference),costPrecision:"provider-token-receipt" as const,adapterSelectionReason:selection.reason};
    })();
    const alreadyRecorded=submission.status==="completed";
    submission={...submission,status:"completed",...(result.providerRequestId?{providerRequestId:result.providerRequestId}:{}),costMicrousd:result.costBreakdown.totalMicrousd,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,totalTokens:result.usage.totalTokens};
    if(!alreadyRecorded)await options.onProviderSubmission?.(submission);
    return{...result,providerSubmissionId:submission.clientRequestId};
  }catch(error){
    // A later poll/download rejection cannot undo an already accepted purchase.
    if(attempted&&submission.status==="pending"&&error instanceof ProviderRequestError&&definitiveProviderRejection(Number(error.detail.httpStatus))){
      await options.onProviderSubmission?.({...submission,status:"rejected",costMicrousd:0});
    }
    throw error;
  }
}

import type { WorkerEnv } from "./runtime.ts";
import { generateCreativeImage as generateOpenAICreativeImage, type CreativeImageOptions } from "./openai-adapter.ts";
import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION, generateFalCreativeImage } from "./fal-image-adapter.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import { priceImageUsageBreakdownMicrousd } from "./replay-cost.ts";

export type ImageAdapterProvider="openai"|"fal-ideogram";
export type ImageAdapterSelection={provider:ImageAdapterProvider;providerName:"openai"|"fal";model:string;adapterId:string;adapterVersion:string;reason:string;capabilities:string[]};

export function selectImageAdapter(env:WorkerEnv,options:CreativeImageOptions={}):ImageAdapterSelection{
  const requested=(env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase();const references=options.references??[];
  const falRequested=requested==="fal"||requested==="fal-ideogram"||requested==="ideogram"||requested==="ideogram-4";
  if(falRequested&&env.FAL_KEY&&references.length<=1&&options.outputFormat!=="webp"){
    const model=references.length?(env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"):options.quality==="low"?(env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast"):(env.FAL_IMAGE_MODEL??"ideogram/v4");
    return{provider:"fal-ideogram",providerName:"fal",model,adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,reason:references.length?"one-reference Ideogram 4 image-to-image":"configured Ideogram 4 text-to-image",capabilities:["image-generation","private-asset-output","context-snapshot","quality-levels","custom-image-size","block-level-image-format",...(references.length?["reference-pixel-input","single-image-input","image-editing"]:[])]};
  }
  const reason=falRequested&&!env.FAL_KEY?"Fal is not configured":falRequested&&references.length>1?"Ideogram 4 accepts one reference; preserving the multi-reference contract":falRequested&&options.outputFormat==="webp"?"Ideogram 4 does not return WebP":"configured OpenAI image adapter";
  return{provider:"openai",providerName:"openai",model:env.OPENAI_IMAGE_MODEL??"gpt-image-2",adapterId:"openai-image",adapterVersion:"v5",reason,capabilities:["image-generation","image-editing","private-asset-output","context-snapshot","quality-levels","reference-pixel-input","multiple-image-input","custom-image-size","block-level-image-format","streaming-previews"]};
}

export async function generateCreativeImage(env:WorkerEnv,userId:string,snapshot:Record<string,unknown>,direction:Record<string,unknown>,options:CreativeImageOptions={}){
  const selection=selectImageAdapter(env,options);
  if(selection.provider==="fal-ideogram")return generateFalCreativeImage(env,userId,snapshot,direction,options);
  if(!env.OPENAI_API_KEY)throw new ProviderRequestError({code:"image_provider_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:`The selected image request cannot use Fal (${selection.reason}), and the OpenAI image adapter is not configured.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  const result=await generateOpenAICreativeImage(env,userId,snapshot,direction,options);
  return{...result,provider:"openai" as const,adapterId:"openai-image",adapterVersion:"v5",providerRequestId:null,costBreakdown:priceImageUsageBreakdownMicrousd(result.model,result.usage,result.usedReference),costPrecision:"provider-token-receipt" as const,adapterSelectionReason:selection.reason};
}

import type { WorkerEnv } from "./runtime.ts";
import { generateCreativeImage as generateOpenAICreativeImage, type CreativeImageOptions } from "./openai-adapter.ts";
import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION, generateFalCreativeImage } from "./fal-image-adapter.ts";
import { FAL_GOOGLE_EDIT_DEFAULT_MODEL, GOOGLE_IMAGEN_ADAPTER_ID, GOOGLE_IMAGEN_ADAPTER_VERSION, generateGoogleCreativeImage, googleImageAdapterReadiness } from "./google-imagen-adapter.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import { priceImageUsageBreakdownMicrousd } from "./replay-cost.ts";

export type ImageAdapterProvider="openai"|"fal-ideogram"|"google-imagen"|"fal-google-edit";
export type ImageAdapterSelection={provider:ImageAdapterProvider;providerName:"openai"|"fal"|"google";model:string;adapterId:string;adapterVersion:string;reason:string;capabilities:string[]};

export function selectImageAdapter(env:WorkerEnv,options:CreativeImageOptions={}):ImageAdapterSelection{
  const requested=(env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase();const references=options.references??[];const googleRequested=requested==="google"||requested==="google-imagen"||requested==="imagen"||requested==="imagen-4";
  if(googleRequested){
    const readiness=googleImageAdapterReadiness(env);
    if(references.length&&env.FAL_KEY&&references.length<=14)return{provider:"fal-google-edit",providerName:"fal",model:env.FAL_GOOGLE_IMAGE_EDIT_MODEL??FAL_GOOGLE_EDIT_DEFAULT_MODEL,adapterId:GOOGLE_IMAGEN_ADAPTER_ID,adapterVersion:GOOGLE_IMAGEN_ADAPTER_VERSION,reason:"Imagen 4 is text-only; opted-in reference pixels route to its supported Google editing companion on Fal.",capabilities:["image-generation","image-editing","private-asset-output","context-snapshot","quality-levels","reference-pixel-input","multiple-image-input","provider-native-image-size","block-level-image-format","prompt-compaction"]};
    if(!references.length&&readiness.vertex&&options.outputFormat!=="webp"){const model=options.quality==="low"?(env.GOOGLE_IMAGEN_PREVIEW_MODEL??"imagen-4.0-fast-generate-001"):options.quality==="high"?(env.GOOGLE_IMAGEN_ULTRA_MODEL??"imagen-4.0-ultra-generate-001"):(env.GOOGLE_IMAGEN_MODEL??"imagen-4.0-generate-001");return{provider:"google-imagen",providerName:"google",model,adapterId:GOOGLE_IMAGEN_ADAPTER_ID,adapterVersion:GOOGLE_IMAGEN_ADAPTER_VERSION,reason:"Configured generally available Imagen 4 text-to-image route on Vertex AI.",capabilities:["image-generation","private-asset-output","context-snapshot","quality-levels","provider-native-image-size","block-level-image-format","prompt-compaction","synthid-watermark"]};}
  }
  const falRequested=requested==="fal"||requested==="fal-ideogram"||requested==="ideogram";
  if(falRequested&&env.FAL_KEY&&references.length<=1&&options.outputFormat!=="webp"){
    const model=references.length?(env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"):options.quality==="low"?(env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast"):(env.FAL_IMAGE_MODEL??"ideogram/v4");
    return{provider:"fal-ideogram",providerName:"fal",model,adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,reason:references.length?"one-reference image-to-image":"configured Ideogram text-to-image",capabilities:["image-generation","private-asset-output","context-snapshot","quality-levels","custom-image-size","block-level-image-format",...(references.length?["reference-pixel-input","single-image-input","image-editing"]:[])]};
  }
  const googleReadiness=googleImageAdapterReadiness(env);const reason=googleRequested&&references.length>14?"The Google editing companion accepts at most 14 references":googleRequested&&references.length&&!env.FAL_KEY?"Fal is not configured for Google reference editing":googleRequested&&!references.length&&!googleReadiness.vertex?`Imagen 4 is not configured: ${googleReadiness.missing.join(", ")}`:googleRequested&&options.outputFormat==="webp"?"Imagen 4 text generation returns JPEG or PNG":falRequested&&!env.FAL_KEY?"Fal is not configured":falRequested&&references.length>1?"Ideogram V4 accepts one reference; preserving the multi-reference contract":falRequested&&options.outputFormat==="webp"?"Ideogram V4 does not return WebP":"configured OpenAI image adapter";
  return{provider:"openai",providerName:"openai",model:env.OPENAI_IMAGE_MODEL??"gpt-image-2",adapterId:"openai-image",adapterVersion:"v5",reason,capabilities:["image-generation","image-editing","private-asset-output","context-snapshot","quality-levels","reference-pixel-input","multiple-image-input","custom-image-size","block-level-image-format","streaming-previews"]};
}

export async function generateCreativeImage(env:WorkerEnv,userId:string,snapshot:Record<string,unknown>,direction:Record<string,unknown>,options:CreativeImageOptions={}){
  const selection=selectImageAdapter(env,options);
  if(selection.provider==="google-imagen"||selection.provider==="fal-google-edit")return generateGoogleCreativeImage(env,userId,snapshot,direction,options);
  if(selection.provider==="fal-ideogram")return generateFalCreativeImage(env,userId,snapshot,direction,options);
  if(!env.OPENAI_API_KEY)throw new ProviderRequestError({code:"image_provider_not_configured",category:"authentication",scope:"account",action:"check_credentials",message:`The selected image request cannot use Fal (${selection.reason}), and the OpenAI image adapter is not configured.`,retryable:false,retryAfterMs:null,requestId:null,httpStatus:503});
  const result=await generateOpenAICreativeImage(env,userId,snapshot,direction,options);
  return{...result,provider:"openai" as const,adapterId:"openai-image",adapterVersion:"v5",providerRequestId:null,costBreakdown:priceImageUsageBreakdownMicrousd(result.model,result.usage,result.usedReference),costPrecision:"provider-token-receipt" as const,adapterSelectionReason:selection.reason};
}

import { openAIImageModel } from "./image-generation-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { CreativeImageOptions } from "./openai-adapter.ts";
import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION } from "./fal-image-identity.ts";

export type ImageAdapterProvider="openai"|"fal-ideogram";
export type ImageAdapterSelection={provider:ImageAdapterProvider;providerName:"openai"|"fal";model:string;adapterId:string;adapterVersion:string;reason:string;capabilities:string[]};

export function selectImageAdapter(env:WorkerEnv,options:CreativeImageOptions={}):ImageAdapterSelection{
  const requested=(env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase();const references=options.references??[];
  const falRequested=requested==="fal"||requested==="fal-ideogram"||requested==="ideogram"||requested==="ideogram-4";
  if(options.quality!=="low"&&falRequested&&env.FAL_KEY&&references.length<=1&&options.outputFormat!=="webp"){
    const model=references.length?(env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"):(env.FAL_IMAGE_MODEL??"ideogram/v4");
    return{provider:"fal-ideogram",providerName:"fal",model,adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,reason:references.length?"one-reference Ideogram 4 image-to-image":"configured Ideogram 4 text-to-image",capabilities:["image-generation","private-asset-output","context-snapshot","canonical-prompt-receipt","provider-expanded-caption","auditable-expansion-strategy","native-caption-diagnostic","quality-levels","custom-image-size","block-level-image-format",...(references.length?["reference-pixel-input","single-image-input","image-editing","reference-mode-strength"]:[])]};
  }
  const reason=options.quality==="low"?"Flare Draft with the shared OpenAI prompt and input pipeline":falRequested&&!env.FAL_KEY?"Fal is not configured":falRequested&&references.length>1?"Ideogram 4 accepts one reference; preserving the multi-reference contract":falRequested&&options.outputFormat==="webp"?"Ideogram 4 does not return WebP":"configured OpenAI image adapter";
  return{provider:"openai",providerName:"openai",model:openAIImageModel(env,options.quality),adapterId:"openai-image",adapterVersion:"v5",reason,capabilities:["image-generation","image-editing","private-asset-output","context-snapshot","quality-levels","reference-pixel-input","multiple-image-input","custom-image-size","block-level-image-format","streaming-previews"]};
}

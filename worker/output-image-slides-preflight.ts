import { createOutputFalImageContract, OUTPUT_FAL_PLANNING_MODEL } from "./output-fal-image-contract.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY, type OutputNativeExecutionPolicy } from "../src/model/output-execution-policy.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import type { ImageFormat } from "../src/model/image-format.ts";
import { validateProviderImageDimensions } from "../src/model/image-format.ts";
import { sendsReferencePixels } from "../src/model/block-types.ts";
import { minimumPresentationSlideCount } from "../src/model/managed-production.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { documentRenderTokenReservation } from "../src/model/generation-budget.ts";
import { manualPresentationMaximumOutputTokens, resolvePresentationCountRequest } from "../src/model/presentation-count-policy.ts";
import { selectImageAdapter } from "./image-adapter-selection.ts";
import { outputImageBudget } from "./output-image-budget.ts";
import { hasKnownTextModelPricing, priceTextUsageBreakdownMicrousd } from "./replay-cost.ts";
import { estimateOpenAITextCallMaximumMicrousd, OpenAITextAccountingError } from "./openai-text-cost.ts";
import { resolvePresentationModelRoutes, PresentationModelConfigurationError, type PresentationModelRoute } from "./presentation-model-routing.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const unavailable=(targetId:string,reasonCode:string,reason:string):OutputNativeTargetPreflight=>({targetId,available:false,reasonCode,transferCode:"output_transfer_none_owned_adoption",reason,provider:null,model:null,route:null,maximumMicrousd:0,maximumCalls:0,maximumTokens:0,settings:{},transferDescription:"No source or file is sent by this check. You can use an owned file after inspection and review."});
export type OutputNativeCallRoute={
 stage:string;provider:string;model:string;maximumMicrousd:number;
 presentationRoute?:PresentationModelRoute;maximumInputTokens?:number;maximumOutputTokens?:number;
};
export type OutputNativeSettings={
 kind:"generate"|"render_document";payload:Record<string,unknown>;calls:OutputNativeCallRoute[];
 executionPolicy?:OutputNativeExecutionPolicy;
 imageBudget?:NonNullable<ReturnType<typeof outputImageBudget>>;
 imageRender?:{format:ImageFormat;size:`${number}x${number}`};
};

export { record as outputNativeRecord, unavailable as outputNativeUnavailable };

/** Quote inputs only; callers independently prove current source and admission authority. */
export type OutputImageSlidesPreflightInput = Pick<OutputBridgeTargetInput, "env" | "target"> & {
 context: Pick<OutputBridgeTargetInput["context"], "snapshot">;
};

export function outputNativeTargetRefusal(input:Pick<OutputBridgeTargetInput,"target">):OutputNativeTargetPreflight|null{
 const {target}=input;
 if(Object.hasOwn(target,"video_contract"))return unavailable(target.id,"output_native_video_unavailable","Video generation unavailable");
 if(Object.hasOwn(target,"narrative_contract"))return unavailable(target.id,"output_native_narrative_unavailable","Narrative generation unavailable");
 if(!target.selected||target.blocking_issues.length)return unavailable(target.id,target.blocking_issues[0]?.code??"output_native_target_not_selected",target.blocking_issues[0]?.message??"Select this resolved target before creating it.");
 if(target.source_scope.kind!=="document")return unavailable(target.id,"output_native_document_scope_required","Native creation currently requires the full authorized Document. Scoped targets can be completed with a verified owned file.");
 return null;
}

/** Exact geometry only. No implicit crop, approximate ratio, resize, or provider fallback. */
export function outputExactImageRender(ratio:{width:number;height:number}):{format:ImageFormat;size:`${number}x${number}`}|null{
 if(!Number.isSafeInteger(ratio.width)||!Number.isSafeInteger(ratio.height)||ratio.width<=0||ratio.height<=0)return null;
 const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
 const divisor=gcd(ratio.width,ratio.height),w=ratio.width/divisor,h=ratio.height/divisor;
 const alignment=(a:number,b:number)=>a*b/gcd(a,b);
 const step=alignment(16/gcd(w,16),16/gcd(h,16));
 const baseWidth=w*step,baseHeight=h*step;
 const multiplier=Math.max(1,Math.ceil(Math.max(1024/Math.min(baseWidth,baseHeight),Math.sqrt(655_360/(baseWidth*baseHeight)))));
 const width=baseWidth*multiplier,height=baseHeight*multiplier;
 if(!validateProviderImageDimensions(width,height).valid)return null;
 return {format:{schema_version:1,aspect_ratio:{width:w,height:h},dimensions:{width,height,unit:"px"}},size:`${width}x${height}`};
}
export function providerInputInstructions(input:Pick<OutputBridgeTargetInput,"target">){
 return [input.target.instruction_text,`Only this deliverable is requested: ${input.target.label}.`,
  `Coverage contract: ${JSON.stringify(input.target.coverage)}.`,
  "The delivery instructions are not evidence. Ground factual claims in the authorized Document sources."].join("\n");
}

/** Shared native Image disclosure. Fresh values carry no admission authority. */
export function outputNativeImageDisclosure(){
 return {reasonValues:{maximumExecutionSeconds:OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds/1000},
  reason:"At most two generation calls: one direction call and one image call at the exact size. After authorization and Start, Forma sends the exact final image prompt as text to OpenAI (omni-moderation-latest) for at most one additional automatic safety check before image creation. This check is not counted as a generation call and is currently free under OpenAI’s pricing. Each operation has a four-minute application execution window; a timeout does not prove provider cancellation, and unresolved allowances remain held.",
  transferDescription:"After you authorize and start, the authorized Document source context and selected target instructions go to the disclosed provider. Native image attempts also send the exact final image prompt as text to OpenAI (omni-moderation-latest) for at most one additional automatic safety check before image creation. This check is not counted as a generation call and is currently free under OpenAI’s pricing. If reference pixels are required, native image generation is unavailable. This preflight sends nothing. Account and provider ceilings are separate; the displayed cap bounds application admission, not a guarantee of provider billing."};
}

export async function preflightOutputImageSlidesTarget(input:OutputImageSlidesPreflightInput):Promise<OutputNativeTargetPreflight>{
 const {target,env}=input;
 const refused=outputNativeTargetRefusal(input);
 if(refused)return refused;
 if(!["image","slides"].includes(target.media_kind))return unavailable(target.id,"output_native_medium_adoption_only","This medium uses verified owned-file adoption in this release; no provider job will be substituted.");
 if(!env.OPENAI_API_KEY)return unavailable(target.id,"output_native_planner_unconfigured","The planning provider is not configured. Saving and owned-file adoption remain available.");
 const plannerModel=env.OPENAI_MODEL??"gpt-5.6-terra";
 if(target.media_kind!=="slides"&&!hasKnownTextModelPricing(plannerModel))return unavailable(target.id,"output_native_planner_price_unknown","The configured planning model has no known price contract.");
 const facts=Array.isArray(input.context.snapshot.facts)?input.context.snapshot.facts.map(record):[];
 if(!facts.some(fact=>fact.active!==false&&String(fact.type).toLowerCase()!=="output"&&fact.intent!=="prohibit"&&fact.effect!=="must_not_include"))return unavailable(target.id,"output_native_source_required","Add an active authorized source before creating this target.");
 const common={productionMode:"manual",budgetAcknowledged:true,preflightAcknowledged:true,outputTargetInstructions:providerInputInstructions(input)};
 const maximumInputTokens=new TextEncoder().encode(JSON.stringify(input.context.snapshot)).byteLength*4+25_000;
 let settings:OutputNativeSettings,provider:string,model:string,route:string,maximumTokens:number,maximumMicrousd:number;
 if(target.media_kind==="slides"){
  if(!target.count_policy||target.count_policy.unit!=="slide")return unavailable(target.id,"output_native_slide_count_policy_required","Confirm an exact or flexible slide count policy first.");
  let counts:ReturnType<typeof resolvePresentationCountRequest>;
  try{counts=resolvePresentationCountRequest({slideCountPolicy:target.count_policy,...(target.count_policy.kind!=="flexible"||target.suggested_count===null?{}:{itemCount:target.suggested_count}),productionMode:"manual"},minimumPresentationSlideCount(input.context.snapshot));}
  catch{return unavailable(target.id,"output_native_slide_count_unsupported","The accepted slide count cannot use the native presentation route.");}
  const contract=buildPresentationSourceContract(input.context.snapshot,{itemCount:counts.itemCount,...(counts.requestedSlideCount===undefined?{}:{requestedSlideCount:counts.requestedSlideCount}),slideCountPolicy:counts.slideCountPolicy});
  if(contract.sourceIssues?.length||!contract.sources.some(source=>source.sourceKind==="block"))return unavailable(target.id,contract.sourceIssues?.[0]?.code??"output_native_slide_source_unresolved",contract.sourceIssues?.[0]?.message??"The deck needs an authorized factual source.");
  const maxOutput=manualPresentationMaximumOutputTokens(counts.slideCountPolicy,counts.itemCount);
  let calls:OutputNativeCallRoute[];
  try{
   const routes=resolvePresentationModelRoutes(env);
   // These exact route fields and caps are included in the persisted quote digest.
   const quotedCall=(stage:string,presentationRoute:PresentationModelRoute):OutputNativeCallRoute=>({
    stage,provider:"openai",model:presentationRoute.model,presentationRoute,maximumInputTokens,maximumOutputTokens:maxOutput,
    maximumMicrousd:Math.max(500_000,estimateOpenAITextCallMaximumMicrousd(presentationRoute.model,maximumInputTokens,maxOutput)),
   });
   calls=[quotedCall("planning:0:initial",routes.composition),quotedCall("planning:0:repair",routes.repair)];
  }catch(error){
   if(error instanceof PresentationModelConfigurationError||error instanceof OpenAITextAccountingError)return unavailable(target.id,error.code,error.message);
   throw error;
  }
  maximumMicrousd=calls.reduce((sum,call)=>sum+call.maximumMicrousd,0);maximumTokens=documentRenderTokenReservation("slides",counts.itemCount,2);
  settings={kind:"render_document",payload:{...common,artifactKind:"slides",itemCount:counts.itemCount,slideCountPolicy:counts.slideCountPolicy,...(counts.requestedSlideCount===undefined?{}:{requestedSlideCount:counts.requestedSlideCount})},calls};
  provider="openai";model=calls[0]!.model;route="document-slides-manual-v1";
 }else{
  if(!target.aspect_ratio)return unavailable(target.id,"output_native_image_ratio_required","Confirm the image aspect ratio first.");
  const imageRender=outputExactImageRender(target.aspect_ratio);
  if(!imageRender)return unavailable(target.id,"output_native_image_ratio_unsupported","The provider cannot create this exact ratio within its dimension limits. Adopt a verified file or explicitly revise the requirement.");
  const referenceCount=facts.filter(fact=>fact.type==="reference"&&fact.active!==false&&Number(record(fact.properties).weight??.5)>0&&sendsReferencePixels(record(fact.properties).pixel_reference_mode)).length;
  if(referenceCount)return unavailable(target.id,"output_native_reference_input_unpriced","This bounded image route cannot yet price GPT Image 2 reference-pixel input. No requested reference is omitted: use an inspected owned image or explicitly change the reference requirement.");
  const referenceStubs=Array.from({length:referenceCount},()=>({bytes:new Uint8Array(0),mimeType:"image/png",source:"uploaded-reference" as const}));
  const requestedProvider=(env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase();
  if(["fal","fal-ideogram","ideogram","ideogram-4"].includes(requestedProvider)&&!env.FAL_KEY?.trim())return unavailable(target.id,"output_native_fal_image_unconfigured","Fal key unavailable");
  const selected=selectImageAdapter(env,{quality:"high",size:imageRender.size,references:referenceStubs});
  if(selected.providerName==="fal"){
   if(plannerModel!==OUTPUT_FAL_PLANNING_MODEL)return unavailable(target.id,"output_native_fal_planner_unsupported","Planning model unavailable");
   const contract=createOutputFalImageContract(selected.model,imageRender.size);
   if(!contract)return unavailable(target.id,"output_native_fal_image_contract_unsupported","Fal model or size unavailable");
   const plannerMaximum=Math.max(100_000,priceTextUsageBreakdownMicrousd(plannerModel,{inputTokens:maximumInputTokens,outputTokens:1200,totalTokens:maximumInputTokens+1200}).totalMicrousd);
   maximumMicrousd=plannerMaximum+contract.maximumMicrousd;maximumTokens=128_000;
   settings={kind:"generate",payload:{...common,outputImageFormat:imageRender.format,outputFalImage:contract},imageRender,
    calls:[{stage:"planning:initial",provider:"openai",model:plannerModel,maximumMicrousd:plannerMaximum},{stage:"image:initial",provider:"fal",model:contract.model,maximumMicrousd:contract.maximumMicrousd}]};
   provider="fal";model=contract.model;route="document-image-fal-manual-v1";
  }else{
  if(selected.providerName!=="openai")return unavailable(target.id,"output_native_image_adapter_unsupported","The current bounded native image route supports the configured OpenAI adapter only. The selected provider must not silently fall back; adopt an owned image instead.");
  if((env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase()!=="openai")return unavailable(target.id,"output_native_image_provider_unavailable","The requested image provider is unavailable for this bounded route; no automatic fallback is authorized.");
  const plannerMaximum=Math.max(100_000,priceTextUsageBreakdownMicrousd(plannerModel,{inputTokens:maximumInputTokens,outputTokens:1200,totalTokens:maximumInputTokens+1200}).totalMicrousd);
  const imageBudget=outputImageBudget(selected.model,imageRender.size);
  if(!imageBudget)return unavailable(target.id,"output_native_image_price_unknown","The configured image model or size has no verified native image pricing contract. No fallback rate or provider will be used.");
  const imageMaximum=Math.max(900_000,imageBudget.maximumMicrousd);
  maximumMicrousd=plannerMaximum+imageMaximum;maximumTokens=128_000;
  settings={kind:"generate",payload:{...common,outputImageFormat:imageRender.format},imageRender,imageBudget,calls:[{stage:"planning:initial",provider:"openai",model:plannerModel,maximumMicrousd:plannerMaximum},{stage:"image:initial",provider:selected.providerName,model:selected.model,maximumMicrousd:imageMaximum}]};
  provider=selected.providerName;model=selected.model;route="document-image-manual-v1";
  }
 }
 settings.executionPolicy=OUTPUT_NATIVE_EXECUTION_POLICY;
 if(provider==="fal")return {targetId:target.id,available:true,reasonValues:{maximumExecutionSeconds:OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds/1000},
  reasonCode:"output_native_fal_image_ready",transferCode:"output_transfer_fal_image_after_authorization",
  reason:"1 PNG image · exact size · 1 planning call · 1 image request · 4-minute execution window",provider,model,route,maximumMicrousd,maximumCalls:2,maximumTokens,settings,
  transferDescription:"Planning: OpenAI · Image: fal.ai / Ideogram V4 · Safety: OpenAI · Prompt expansion: Large · Quality: QUALITY · Source: Document text · References: none · Pricing: published-rate estimate · Billing: provider-reported or published-rate estimate · Uncertain submission: no automatic retry"};
 const disclosure=outputNativeImageDisclosure();
 return {targetId:target.id,available:true,reasonValues:disclosure.reasonValues,reasonCode:target.media_kind==="slides"?"output_native_slides_ready":"output_native_image_ready",transferCode:"output_transfer_document_after_authorization",reason:target.media_kind==="slides"?"One initial request and at most one repair. The accepted count policy remains unchanged. Each operation has a four-minute application execution window; a timeout does not prove provider cancellation, and unresolved allowances remain held.":disclosure.reason,provider,model,route,maximumMicrousd,maximumCalls:2,maximumTokens,settings,
  transferDescription:disclosure.transferDescription};
}

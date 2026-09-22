import { OPENAI_IMAGE_GENERATION_CONTRACT } from "./openai-image-route-contract.ts";
import { selectImageAdapter } from "./image-adapter";
import { FAL_IDEOGRAM_ADAPTER_ID, FAL_IDEOGRAM_ADAPTER_VERSION, falExpansionModel, falIdeogramAdapterReadiness, falRenderingSpeed, validateFalImageSize } from "./fal-image-adapter";
import { priceFalIdeogramImageBreakdownMicrousd } from "./replay-cost";
import { ensureSchema, type WorkerEnv } from "./runtime";
import { requireCapability } from "./pilot-policy";
import { readCanvasGovernance } from "./canvas-governance-policy";
import { IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE, IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE, IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE, IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE, IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE, IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE, IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE, IMAGE_ADAPTER_EVALUATION_PLAN, RETAINED_IMAGE_ADAPTER_EVALUATIONS } from "./image-adapter-evaluation-evidence";
import { IDEOGRAM_PROMPT_ADAPTER_VERSION } from "./ideogram-prompt-adapter";
import type { CreativeImageOptions, ImageOutputFormat, ImageReference } from "./openai-adapter";

type PreviewInput={provider?:unknown;quality?:unknown;size?:unknown;outputFormat?:unknown;referenceCount?:unknown};

const quality=(value:unknown):NonNullable<CreativeImageOptions["quality"]>=>value==="low"||value==="medium"||value==="high"?value:"low";
const outputFormat=(value:unknown):ImageOutputFormat=>value==="png"||value==="webp"?value:"jpeg";
const size=(value:unknown)=>/^\d+x\d+$/.test(String(value??""))?String(value) as `${number}x${number}`:"1024x1024";
const referenceCount=(value:unknown)=>Math.max(0,Math.min(4,Math.floor(Number(value??0))));
const references=(count:number):ImageReference[]=>Array.from({length:count},(_,index)=>({bytes:new Uint8Array([index]),mimeType:"image/png",source:"uploaded-reference",referenceId:`laboratory-reference-${index+1}`,mode:"inspiration"}));
const dollars=(microusd:number)=>Number((microusd/1_000_000).toFixed(6));

function preview(env:WorkerEnv,input:PreviewInput){
  const resolvedQuality=quality(input.quality),resolvedSize=size(input.size),resolvedFormat=outputFormat(input.outputFormat),resolvedReferences=referenceCount(input.referenceCount);
  const options:CreativeImageOptions={quality:resolvedQuality,size:resolvedSize,outputFormat:resolvedFormat,references:references(resolvedReferences)};
  const requestedProvider=["openai","fal-ideogram"].includes(String(input.provider))?String(input.provider):env.FORMA_IMAGE_PROVIDER??"openai";
  const selection=selectImageAdapter({...env,FORMA_IMAGE_PROVIDER:requestedProvider},options);const dimensions=/^(\d+)x(\d+)$/.exec(resolvedSize);const width=Number(dimensions?.[1]??0),height=Number(dimensions?.[2]??0);
  const falSize=selection.provider==="fal-ideogram"?validateFalImageSize(resolvedSize):null;const speed=falRenderingSpeed(resolvedQuality);const expansionModel=falExpansionModel(resolvedQuality);
  const cost=selection.provider==="fal-ideogram"&&falSize?.valid?priceFalIdeogramImageBreakdownMicrousd(selection.model,width,height,speed,expansionModel):null;
  return{
    request:{provider:requestedProvider,quality:resolvedQuality,size:resolvedSize,outputFormat:resolvedFormat,referenceCount:resolvedReferences,pixelsTransmitted:resolvedReferences>0},
    selection:{...selection,promptAdapterVersion:selection.provider==="fal-ideogram"?IDEOGRAM_PROMPT_ADAPTER_VERSION:null,renderingSpeed:selection.provider==="fal-ideogram"?speed:null,expansionModel:selection.provider==="fal-ideogram"?expansionModel:null,sizeValid:falSize?.valid??true,sizeMessage:falSize?.reason??"",estimatedProviderCostUsd:cost?dollars(cost.totalMicrousd):null,costBasis:cost?"published output-pixel rates plus the selected provider caption expansion":null},
    stages:[
      {id:"compile",label:"Compile durable context",provider:false},
      {id:"safety-review",label:"Review the exact prompt and authorized reference pixels",provider:false},
      {id:"provider-submit",label:`Submit one bounded request to ${selection.model}`,provider:true},
      {id:"provider-queued",label:"Retain the provider request ID while queued",provider:true},
      {id:"provider-rendering",label:"Report provider progress without blocking navigation",provider:true},
      {id:"provider-download",label:"Copy the result into private application storage",provider:true},
      {id:"receipt",label:"Append model, cost, latency, safety, and fallback receipts",provider:false},
    ],
  };
}

export async function handleImageAdapters(request:Request,env:WorkerEnv){
  await ensureSchema(env);const auth=await requireCapability(request,env,"platform.provider.configure");if(auth.response||!auth.user)return auth.response!;
  if(request.method==="POST"){const body=await request.json().catch(()=>({})) as PreviewInput;return Response.json(preview(env,body));}
  if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  const governance=await readCanvasGovernance(env,auth.user.role);const second=governance.requirements.find((item)=>item.id==="second_image_adapter");const readiness=falIdeogramAdapterReadiness(env);
  const scenarios=[
    {id:"ideogram-draft",label:"Ideogram 4 fast draft",input:{provider:"fal-ideogram",quality:"low",size:"1024x1024",outputFormat:"jpeg",referenceCount:0}},
    {id:"ideogram-full",label:"Ideogram 4 full image",input:{provider:"fal-ideogram",quality:"high",size:"1536x1024",outputFormat:"png",referenceCount:0}},
    {id:"ideogram-single-reference",label:"Ideogram 4 one-reference edit",input:{provider:"fal-ideogram",quality:"high",size:"1024x1024",outputFormat:"jpeg",referenceCount:1}},
    {id:"ideogram-multi-reference",label:"Multi-reference fallback",input:{provider:"fal-ideogram",quality:"high",size:"1024x1024",outputFormat:"jpeg",referenceCount:2}},
    {id:"ideogram-webp",label:"WebP fallback",input:{provider:"fal-ideogram",quality:"medium",size:"1024x1024",outputFormat:"webp",referenceCount:0}},
  ].map((scenario)=>({...scenario,preview:preview(env,scenario.input)}));
  return Response.json({
    configuredProvider:env.FORMA_IMAGE_PROVIDER??"openai",
    candidate:{adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,promptAdapterVersion:IDEOGRAM_PROMPT_ADAPTER_VERSION,readiness,corpusVersion:IMAGE_ADAPTER_EVALUATION_PLAN.corpusVersion,caseCount:IMAGE_ADAPTER_EVALUATION_PLAN.caseCount,estimatedImageCostUsd:{minimum:4,maximum:7},paidRetryRequiresExplicitApproval:true,previousEvidenceRetained:true,evaluationPlan:IMAGE_ADAPTER_EVALUATION_PLAN},
    adapters:[
      {provider:"fal",adapterId:FAL_IDEOGRAM_ADAPTER_ID,adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,configured:readiness.configured,models:{draft:env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast",full:env.FAL_IMAGE_MODEL??"ideogram/v4",singleReference:env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"},limits:{referenceImages:1,formats:["jpeg","png"],minSide:512,maxSide:3840,sizeMultiple:16,promptAdapter:IDEOGRAM_PROMPT_ADAPTER_VERSION,promptChars:4000,promptStrategy:"production_director",promptExpansion:{draft:"Medium",balanced:"Large",full:"Large"},referenceStrengths:{inspiration:.99,preserveComposition:.88,preserveSubject:.3,preserveStyle:.72,default:.9},nativeCaptionMode:"diagnostic only",draftRendering:"BALANCED"},receipt:"docs/adapters/fal-ideogram-v4.md"},
      {provider:"openai",adapterId:"openai-image",adapterVersion:"v5",configured:Boolean(env.OPENAI_API_KEY),models:{default:env.OPENAI_IMAGE_MODEL??OPENAI_IMAGE_GENERATION_CONTRACT.defaults.model},limits:{referenceImages:"multiple",formats:["jpeg","png","webp"]}},
    ],
    scenarios,
    qualification:{approved:Boolean(second?.approved),pilotAvailable:governance.pilotAvailable,corpusMinimum:50,receiptReady:true,evaluationRequired:!second?.approved,evidenceRef:second?.evidenceRef??null,lastEvaluation:IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE,lastDiagnostic:IMAGE_ADAPTER_V9_DIAGNOSTIC_EVIDENCE,lastCycleSearch:IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE,cycleSearches:[IMAGE_ADAPTER_CYCLE_5_SEARCH_EVIDENCE,IMAGE_ADAPTER_CYCLE_4_SEARCH_EVIDENCE,IMAGE_ADAPTER_CYCLE_3_SEARCH_EVIDENCE,IMAGE_ADAPTER_CYCLE_2_SEARCH_EVIDENCE,IMAGE_ADAPTER_CYCLE_SEARCH_EVIDENCE],currentEvaluation:IMAGE_ADAPTER_V52_EVALUATION_EVIDENCE,evaluationPlan:IMAGE_ADAPTER_EVALUATION_PLAN,retainedEvaluations:RETAINED_IMAGE_ADAPTER_EVALUATIONS},
  });
}

/** A capability-scoped contract simulation; no pixels, provider requests, audit events, or durable writes occur. */
export async function handleQualificationPreview(request:Request,env:WorkerEnv){
  if(request.method!=="POST")return new Response("Method not allowed",{status:405});
  await ensureSchema(env);
  const auth=await requireCapability(request,env,["evaluation.qualification.run","platform.provider.configure"]);
  if(auth.response||!auth.user)return auth.response!;
  const input=await request.json().catch(()=>({})) as PreviewInput;
  const simulation=preview(env,input);
  const {provider,model,adapterId,adapterVersion,reason,renderingSpeed,sizeValid,sizeMessage,estimatedProviderCostUsd}=simulation.selection;
  return Response.json({dryRun:true,providerCall:false,pixelsTransmitted:false,
    request:{provider:simulation.request.provider,quality:simulation.request.quality,size:simulation.request.size,outputFormat:simulation.request.outputFormat,referenceCount:simulation.request.referenceCount,wouldTransmitReferencePixels:simulation.request.referenceCount>0},
    selection:{provider,model,adapterId,adapterVersion,reason,renderingSpeed,sizeValid,sizeMessage,estimatedProviderCostUsd},
    stages:simulation.stages.map(({id,label,provider})=>({id,label,wouldContactProvider:provider})),
  },{headers:{"cache-control":"private, no-store"}});
}

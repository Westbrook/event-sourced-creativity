import { selectImageAdapter } from "./image-adapter";
import { FAL_IDEOGRAM_ADAPTER_VERSION, falExpansionModel, validateFalImageSize } from "./fal-image-adapter";
import { FAL_GOOGLE_EDIT_DEFAULT_MODEL, GOOGLE_IMAGEN_ADAPTER_ID, GOOGLE_IMAGEN_ADAPTER_VERSION, googleImageAdapterReadiness, normalizeImagenRequest } from "./google-imagen-adapter";
import { priceFalGoogleEditBreakdownMicrousd, priceFalIdeogramImageBreakdownMicrousd, priceGoogleImagenImageBreakdownMicrousd, type FalIdeogramRenderingSpeed } from "./replay-cost";
import { ensureSchema, type WorkerEnv } from "./runtime";
import { requireUser } from "./pilot-policy";
import { readCanvasGovernance } from "./canvas-governance-policy";
import { IMAGE_ADAPTER_EVALUATION_EVIDENCE } from "./image-adapter-evaluation-evidence";
import type { CreativeImageOptions, ImageOutputFormat, ImageReference } from "./openai-adapter";

type PreviewInput={provider?:unknown;quality?:unknown;size?:unknown;outputFormat?:unknown;referenceCount?:unknown};

const quality=(value:unknown):NonNullable<CreativeImageOptions["quality"]>=>value==="low"||value==="medium"||value==="high"?value:"low";
const outputFormat=(value:unknown):ImageOutputFormat=>value==="png"||value==="webp"?value:"jpeg";
const size=(value:unknown)=>/^\d+x\d+$/.test(String(value??""))?String(value) as `${number}x${number}`:"1024x1024";
const referenceCount=(value:unknown)=>Math.max(0,Math.min(4,Math.floor(Number(value??0))));
const references=(count:number):ImageReference[]=>Array.from({length:count},(_,index)=>({bytes:new Uint8Array([index]),mimeType:"image/png",source:"uploaded-reference",referenceId:`laboratory-reference-${index+1}`,mode:"inspiration"}));
const speedFor=(value:NonNullable<CreativeImageOptions["quality"]>):FalIdeogramRenderingSpeed=>value==="low"?"TURBO":value==="medium"?"BALANCED":"QUALITY";
const dollars=(microusd:number)=>Number((microusd/1_000_000).toFixed(6));

function preview(env:WorkerEnv,input:PreviewInput){
  const resolvedQuality=quality(input.quality),resolvedSize=size(input.size),resolvedFormat=outputFormat(input.outputFormat),resolvedReferences=referenceCount(input.referenceCount);
  const options:CreativeImageOptions={quality:resolvedQuality,size:resolvedSize,outputFormat:resolvedFormat,references:references(resolvedReferences)};
  const requestedProvider=["openai","fal-ideogram","google-imagen"].includes(String(input.provider))?String(input.provider):env.FORMA_IMAGE_PROVIDER??"openai";const selection=selectImageAdapter({...env,FORMA_IMAGE_PROVIDER:requestedProvider},options);const dimensions=/^(\d+)x(\d+)$/.exec(resolvedSize);const width=Number(dimensions?.[1]??0),height=Number(dimensions?.[2]??0);
  const falSize=selection.provider==="fal-ideogram"?validateFalImageSize(resolvedSize):null;const googleSize=selection.provider==="google-imagen"||selection.provider==="fal-google-edit"?normalizeImagenRequest(resolvedSize,resolvedQuality):null;const speed=speedFor(resolvedQuality);const expansionModel=falExpansionModel(resolvedQuality);const googleResolution=selection.provider==="fal-google-edit"?(resolvedQuality==="low"?"0.5K":resolvedQuality==="high"?"2K":"1K"):googleSize?.resolution??null;
  const cost=selection.provider==="fal-ideogram"&&falSize?.valid?priceFalIdeogramImageBreakdownMicrousd(selection.model,width,height,speed,expansionModel):selection.provider==="google-imagen"?priceGoogleImagenImageBreakdownMicrousd(selection.model):selection.provider==="fal-google-edit"?priceFalGoogleEditBreakdownMicrousd(googleResolution as "0.5K"|"1K"|"2K"|"4K"):null;
  return{
    request:{provider:requestedProvider,quality:resolvedQuality,size:resolvedSize,outputFormat:resolvedFormat,referenceCount:resolvedReferences,pixelsTransmitted:resolvedReferences>0},
    selection:{...selection,renderingSpeed:selection.provider==="fal-ideogram"?speed:null,expansionModel:selection.provider==="fal-ideogram"?expansionModel:null,providerAspectRatio:googleSize?.aspectRatio??null,providerResolution:googleResolution,sizeValid:falSize?.valid??googleSize?.valid??true,sizeMessage:falSize?.reason??googleSize?.reason??"",sizeNormalized:googleSize?.normalized??false,providerWidth:googleSize?.width??width,providerHeight:googleSize?.height??height,estimatedProviderCostUsd:cost?dollars(cost.totalMicrousd):null,costBasis:selection.provider==="google-imagen"?"published per-image Vertex AI rate":selection.provider==="fal-google-edit"?"published Fal Google edit rate by resolution tier":cost?"published output-pixel and prompt-expansion rates":null},
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
  await ensureSchema(env);const auth=await requireUser(request,env,"admin",{account:"principal"});if(auth.response||!auth.user)return auth.response!;
  if(request.method==="POST"){const body=await request.json().catch(()=>({})) as PreviewInput;return Response.json(preview(env,body));}
  if(request.method!=="GET")return new Response("Method not allowed",{status:405});
  const governance=await readCanvasGovernance(env,auth.user.role);const second=governance.requirements.find((item)=>item.id==="second_image_adapter");
  const googleReadiness=googleImageAdapterReadiness(env);
  const scenarios=[
    {id:"imagen-draft",label:"Imagen 4 fast draft",input:{provider:"google-imagen",quality:"low",size:"1024x1024",outputFormat:"jpeg",referenceCount:0}},
    {id:"imagen-full",label:"Imagen 4 full image",input:{provider:"google-imagen",quality:"high",size:"1536x1024",outputFormat:"png",referenceCount:0}},
    {id:"google-single-reference",label:"Google one-reference edit",input:{provider:"google-imagen",quality:"high",size:"1536x1024",outputFormat:"jpeg",referenceCount:1}},
    {id:"google-multi-reference",label:"Google multi-reference edit",input:{provider:"google-imagen",quality:"high",size:"1536x1024",outputFormat:"jpeg",referenceCount:2}},
    {id:"imagen-webp",label:"Imagen WebP boundary",input:{provider:"google-imagen",quality:"medium",size:"1024x1024",outputFormat:"webp",referenceCount:0}},
  ].map((scenario)=>({...scenario,preview:preview(env,scenario.input)}));
  return Response.json({
    configuredProvider:env.FORMA_IMAGE_PROVIDER??"openai",
    candidate:{adapterId:GOOGLE_IMAGEN_ADAPTER_ID,adapterVersion:GOOGLE_IMAGEN_ADAPTER_VERSION,readiness:googleReadiness,corpusVersion:"canvas-image-corpus-v2",caseCount:50,estimatedImageCostUsd:{minimum:3,maximum:7},paidRetryRequiresExplicitApproval:true,previousEvidenceRetained:true},
    adapters:[
      {provider:"google",adapterId:GOOGLE_IMAGEN_ADAPTER_ID,adapterVersion:GOOGLE_IMAGEN_ADAPTER_VERSION,configured:googleReadiness.configured,models:{draft:env.GOOGLE_IMAGEN_PREVIEW_MODEL??"imagen-4.0-fast-generate-001",full:env.GOOGLE_IMAGEN_MODEL??"imagen-4.0-generate-001",ultra:env.GOOGLE_IMAGEN_ULTRA_MODEL??"imagen-4.0-ultra-generate-001",referenceEdit:env.FAL_GOOGLE_IMAGE_EDIT_MODEL??FAL_GOOGLE_EDIT_DEFAULT_MODEL},limits:{imagenReferences:0,editingReferences:14,imagenFormats:["jpeg","png"],editingFormats:["jpeg","png","webp"],imagenAspectRatios:["1:1","3:4","4:3","9:16","16:9"],promptEnvelopeCharacters:1800},receipt:"docs/adapters/google-imagen-4.md",readiness:googleReadiness},
      {provider:"fal",adapterId:"fal-ideogram-v4",adapterVersion:FAL_IDEOGRAM_ADAPTER_VERSION,configured:Boolean(env.FAL_KEY),models:{draft:env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast",full:env.FAL_IMAGE_MODEL??"ideogram/v4",singleReference:env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"},limits:{referenceImages:1,formats:["jpeg","png"],minSide:512,maxSide:3840,sizeMultiple:16},receipt:"docs/adapters/fal-ideogram-v4.md"},
      {provider:"openai",adapterId:"openai-image",adapterVersion:"v5",configured:Boolean(env.OPENAI_API_KEY),models:{default:env.OPENAI_IMAGE_MODEL??"gpt-image-2"},limits:{referenceImages:"multiple",formats:["jpeg","png","webp"]}},
    ],
    scenarios,
    qualification:{approved:Boolean(second?.approved),pilotAvailable:governance.pilotAvailable,corpusMinimum:50,receiptReady:true,evaluationRequired:!second?.approved,evidenceRef:second?.evidenceRef??null,lastEvaluation:IMAGE_ADAPTER_EVALUATION_EVIDENCE,retainedEvaluations:[IMAGE_ADAPTER_EVALUATION_EVIDENCE]},
  });
}

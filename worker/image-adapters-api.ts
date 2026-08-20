import { selectImageAdapter } from "./image-adapter";
import { validateFalImageSize } from "./fal-image-adapter";
import { priceFalIdeogramImageBreakdownMicrousd, type FalIdeogramRenderingSpeed } from "./replay-cost";
import { ensureSchema, type WorkerEnv } from "./runtime";
import { requireUser } from "./pilot-policy";
import { readCanvasGovernance } from "./canvas-governance-policy";
import type { CreativeImageOptions, ImageOutputFormat, ImageReference } from "./openai-adapter";

type PreviewInput={quality?:unknown;size?:unknown;outputFormat?:unknown;referenceCount?:unknown};

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
  const selection=selectImageAdapter(env,options);const dimensions=/^(\d+)x(\d+)$/.exec(resolvedSize);const width=Number(dimensions?.[1]??0),height=Number(dimensions?.[2]??0);
  const falSize=selection.provider==="fal-ideogram"?validateFalImageSize(resolvedSize):null;const speed=speedFor(resolvedQuality);
  const cost=selection.provider==="fal-ideogram"&&falSize?.valid?priceFalIdeogramImageBreakdownMicrousd(selection.model,width,height,speed):null;
  return{
    request:{quality:resolvedQuality,size:resolvedSize,outputFormat:resolvedFormat,referenceCount:resolvedReferences,pixelsTransmitted:resolvedReferences>0},
    selection:{...selection,renderingSpeed:selection.provider==="fal-ideogram"?speed:null,sizeValid:falSize?.valid??true,sizeMessage:falSize?.reason??"",estimatedProviderCostUsd:cost?dollars(cost.totalMicrousd):null,costBasis:cost?"published output-pixel rate":null},
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
  const scenarios=[
    {id:"draft",label:"Draft image",input:{quality:"low",size:"1024x1024",outputFormat:"jpeg",referenceCount:0}},
    {id:"full",label:"Full image",input:{quality:"high",size:"1536x1024",outputFormat:"png",referenceCount:0}},
    {id:"single-reference",label:"One-reference edit",input:{quality:"high",size:"1536x1024",outputFormat:"jpeg",referenceCount:1}},
    {id:"multi-reference",label:"Multi-reference edit",input:{quality:"high",size:"1536x1024",outputFormat:"jpeg",referenceCount:2}},
    {id:"webp",label:"WebP output",input:{quality:"medium",size:"1024x1024",outputFormat:"webp",referenceCount:0}},
  ].map((scenario)=>({...scenario,preview:preview(env,scenario.input)}));
  return Response.json({
    configuredProvider:env.FORMA_IMAGE_PROVIDER??"openai",
    adapters:[
      {provider:"fal",adapterId:"fal-ideogram-v4",adapterVersion:"v1",configured:Boolean(env.FAL_KEY),models:{draft:env.FAL_IMAGE_PREVIEW_MODEL??"ideogram/v4/fast",full:env.FAL_IMAGE_MODEL??"ideogram/v4",singleReference:env.FAL_IMAGE_EDIT_MODEL??"ideogram/v4/image-to-image"},limits:{referenceImages:1,formats:["jpeg","png"],minSide:512,maxSide:3840,sizeMultiple:16},receipt:"docs/adapters/fal-ideogram-v4.md"},
      {provider:"openai",adapterId:"openai-image",adapterVersion:"v5",configured:Boolean(env.OPENAI_API_KEY),models:{default:env.OPENAI_IMAGE_MODEL??"gpt-image-2"},limits:{referenceImages:"multiple",formats:["jpeg","png","webp"]}},
    ],
    scenarios,
    qualification:{approved:Boolean(second?.approved),pilotAvailable:governance.pilotAvailable,corpusMinimum:50,receiptReady:true,evaluationRequired:!second?.approved,evidenceRef:second?.evidenceRef??null},
  });
}

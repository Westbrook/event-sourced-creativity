import assert from "node:assert/strict";
import test from "node:test";
import { generateCreativeImage, selectImageAdapter } from "../worker/image-adapter.ts";
import { GOOGLE_IMAGEN_ADAPTER_ID, GOOGLE_IMAGEN_ADAPTER_VERSION, buildGoogleImagePrompt, googleImageAdapterReadiness, normalizeImagenRequest } from "../worker/google-imagen-adapter.ts";
import { priceFalGoogleEditBreakdownMicrousd, priceGoogleImagenImageBreakdownMicrousd } from "../worker/replay-cost.ts";

const configured={GOOGLE_CLOUD_PROJECT:"project-test",GOOGLE_CLOUD_LOCATION:"us-central1",GOOGLE_VERTEX_ACCESS_TOKEN:"vertex-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"google-imagen"};
const moderationPass=()=>Response.json({id:"modr_google",model:"omni-moderation-latest",results:[{flagged:false,categories:{},category_scores:{}}]});
const snapshot={document:{title:"Quiet study"},facts:[{block_id:"subject-1",type:"subject",role:"subject",intent:"include",active:true,properties:{text:"an adult conservator repairing a paper lantern",weight:.9,spatial_scope:{kind:"region",region:"left",falloff:"soft",feather:.1}}},{block_id:"avoid-1",type:"constraint",role:"constraint",intent:"avoid",effect:"must_not_include",active:true,properties:{text:"crowds and visible brand marks",weight:1,spatial_scope:{kind:"document"}}}],relationships:[],standing_constraints:[]};
const direction={title:"Lantern repair",scene:"A quiet worktable at blue hour",palette:["paper white","indigo"]};

test("normalizes requested dimensions onto documented Imagen 4 ratios and tiers",()=>{
  assert.deepEqual(normalizeImagenRequest("1024x1024","low"),{valid:true,reason:"Exact supported aspect ratio.",requestedWidth:1024,requestedHeight:1024,aspectRatio:"1:1",resolution:"1K",width:1024,height:1024,normalized:false});
  const landscape=normalizeImagenRequest("1536x1024","high");assert.equal(landscape.aspectRatio,"4:3");assert.equal(landscape.resolution,"2K");assert.equal(landscape.width,2560);assert.equal(landscape.height,1792);assert.equal(landscape.normalized,true);
});

test("compacts every active decision into the Imagen prompt envelope",()=>{
  for(const technique of ["prose","bullets","json","xml"]){const receipt=buildGoogleImagePrompt(snapshot,direction,[],technique);assert.ok(receipt.prompt.length<=1800);assert.match(receipt.prompt,/conservator/);assert.match(receipt.prompt,/crowds/);assert.equal(receipt.technique,technique);}
});

test("selects Vertex for text and the Fal-hosted Google companion for reference pixels",()=>{
  const draft=selectImageAdapter(configured,{quality:"low"});assert.equal(draft.provider,"google-imagen");assert.equal(draft.model,"imagen-4.0-fast-generate-001");assert.equal(draft.adapterId,GOOGLE_IMAGEN_ADAPTER_ID);assert.equal(draft.adapterVersion,GOOGLE_IMAGEN_ADAPTER_VERSION);
  const reference={bytes:new Uint8Array([1]),mimeType:"image/png",source:"uploaded-reference"};const edit=selectImageAdapter(configured,{references:[reference,reference]});assert.equal(edit.provider,"fal-google-edit");assert.equal(edit.model,"fal-ai/nano-banana-2/edit");
  assert.deepEqual(googleImageAdapterReadiness(configured).missing,[]);
});

test("submits Imagen 4 through Vertex with explicit safety, ratio, and native-resolution receipts",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),init});if(String(url).endsWith("/moderations"))return moderationPass();if(String(url).includes("aiplatform.googleapis.com"))return Response.json({predictions:[{bytesBase64Encoded:btoa("imagen-pixels"),mimeType:"image/png"}]},{headers:{"x-request-id":"vertex-1"}});throw new Error(`unexpected request ${url}`);};
  try{const result=await generateCreativeImage({...configured,OPENAI_API_KEY:"openai-test"},"user-1",snapshot,direction,{quality:"high",size:"1536x1024",outputFormat:"png",promptTechnique:"json"});assert.equal(result.provider,"google");assert.equal(result.model,"imagen-4.0-ultra-generate-001");assert.equal(result.providerRequestId,"vertex-1");assert.equal(result.width,2560);assert.equal(result.height,1792);assert.equal(result.sizeNormalized,true);assert.equal(new TextDecoder().decode(result.bytes),"imagen-pixels");const submitted=JSON.parse(String(calls.find((call)=>call.url.includes("aiplatform.googleapis.com")).init.body));assert.equal(submitted.parameters.aspectRatio,"4:3");assert.equal(submitted.parameters.sampleImageSize,"2K");assert.equal(submitted.parameters.enhancePrompt,false);assert.equal(submitted.parameters.safetySetting,"block_medium_and_above");assert.equal(submitted.parameters.addWatermark,true);assert.equal(result.costBreakdown.totalMicrousd,60_000);assert.ok(result.prompt.length<=1800);}finally{globalThis.fetch=originalFetch;}
});

test("passes multiple opted-in reference images to Nano Banana 2 edit",async()=>{
  const originalFetch=globalThis.fetch;let submitted;
  globalThis.fetch=async(url,init={})=>{if(String(url).endsWith("/moderations"))return moderationPass();if(String(url)==="https://queue.fal.run/fal-ai/nano-banana-2/edit"){submitted=JSON.parse(String(init.body));return Response.json({request_id:"google-edit-1",status:"COMPLETED",response_url:"https://queue.fal.run/fal-ai/nano-banana-2/edit/requests/google-edit-1/response"});}if(String(url).endsWith("/requests/google-edit-1/response"))return Response.json({images:[{url:"https://cdn.fal.media/google-edit.webp",content_type:"image/webp",width:1536,height:1024}],description:"Edited result"});if(String(url)==="https://cdn.fal.media/google-edit.webp")return new Response("edited-pixels",{headers:{"content-type":"image/webp"}});throw new Error(`unexpected request ${url}`);};
  try{const references=[1,2].map((index)=>({bytes:new TextEncoder().encode(`pixels-${index}`),mimeType:"image/png",source:"uploaded-reference",referenceId:`reference-${index}`,mode:"inspiration"}));const result=await generateCreativeImage({...configured,OPENAI_API_KEY:"openai-test"},"user-1",snapshot,direction,{quality:"medium",size:"1536x1024",outputFormat:"webp",references});assert.equal(result.provider,"fal");assert.equal(result.adapterId,GOOGLE_IMAGEN_ADAPTER_ID);assert.equal(result.referenceCount,2);assert.equal(submitted.image_urls.length,2);assert.ok(submitted.image_urls.every((value)=>value.startsWith("data:image/png;base64,")));assert.equal(submitted.limit_generations,true);assert.equal(submitted.resolution,"1K");assert.equal(result.costBreakdown.totalMicrousd,80_000);}finally{globalThis.fetch=originalFetch;}
});

test("prices published Google routes without inventing token usage",()=>{
  assert.equal(priceGoogleImagenImageBreakdownMicrousd("imagen-4.0-fast-generate-001").totalMicrousd,20_000);
  assert.equal(priceGoogleImagenImageBreakdownMicrousd("imagen-4.0-generate-001").totalMicrousd,40_000);
  assert.equal(priceGoogleImagenImageBreakdownMicrousd("imagen-4.0-ultra-generate-001").totalMicrousd,60_000);
  assert.equal(priceFalGoogleEditBreakdownMicrousd("2K").totalMicrousd,120_000);
});

import assert from "node:assert/strict";
import test from "node:test";
import { generateCreativeImage, selectImageAdapter } from "../worker/image-adapter.ts";
import { priceFalIdeogramImageBreakdownMicrousd } from "../worker/replay-cost.ts";

const moderationPass=()=>Response.json({id:"modr_fal",model:"omni-moderation-latest",results:[{flagged:false,categories:{},category_scores:{}}]});

test("selects Ideogram models by quality and preserves the multi-reference contract with an OpenAI fallback",()=>{
  const env={FAL_KEY:"test-only",FORMA_IMAGE_PROVIDER:"fal-ideogram",FAL_IMAGE_MODEL:"ideogram/v4",FAL_IMAGE_PREVIEW_MODEL:"ideogram/v4/fast",FAL_IMAGE_EDIT_MODEL:"ideogram/v4/image-to-image"};
  assert.equal(selectImageAdapter(env,{quality:"low"}).model,"ideogram/v4/fast");
  assert.equal(selectImageAdapter(env,{quality:"high"}).model,"ideogram/v4");
  const reference={bytes:new Uint8Array([1]),mimeType:"image/png",source:"uploaded-reference"};
  assert.equal(selectImageAdapter(env,{quality:"high",references:[reference]}).model,"ideogram/v4/image-to-image");
  const fallback=selectImageAdapter({...env,OPENAI_IMAGE_MODEL:"gpt-image-2"},{references:[reference,reference]});
  assert.equal(fallback.provider,"openai");assert.match(fallback.reason,/one reference/i);
});

test("runs a Fal Ideogram draft through moderation, queue, result, private download, and pixel pricing",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4/fast"&&init.method==="POST")return Response.json({request_id:"fal-request-1",status:"IN_QUEUE",status_url:"https://queue.fal.run/ideogram/v4/fast/requests/fal-request-1/status",response_url:"https://queue.fal.run/ideogram/v4/fast/requests/fal-request-1/response"});
    if(String(url).endsWith("/requests/fal-request-1/status?logs=1"))return Response.json({request_id:"fal-request-1",status:"COMPLETED"});
    if(String(url).endsWith("/requests/fal-request-1/response"))return Response.json({images:[{url:"https://cdn.fal.media/output.jpg",content_type:"image/jpeg",width:816,height:816}],seed:42,has_nsfw_concepts:[false],prompt:"unchanged"});
    if(String(url)==="https://cdn.fal.media/output.jpg")return new Response("fal-image",{headers:{"content-type":"image/jpeg"}});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    const stages=[];const result=await generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{facts:[]},{title:"Typography study"},{quality:"low",size:"816x816",outputFormat:"jpeg",onStage:(stage)=>stages.push(stage)});
    assert.equal(result.provider,"fal");assert.equal(result.model,"ideogram/v4/fast");assert.equal(result.providerRequestId,"fal-request-1");assert.equal(result.seed,42);assert.equal(new TextDecoder().decode(result.bytes),"fal-image");
    const submitted=JSON.parse(String(calls.find((call)=>call.url==="https://queue.fal.run/ideogram/v4/fast").init.body));
    assert.equal(submitted.expansion_model,"Medium");assert.equal(submitted.rendering_speed,"TURBO");assert.deepEqual(submitted.image_size,{width:816,height:816});assert.equal(submitted.enable_safety_checker,true);assert.equal(submitted.num_images,1);assert.equal(result.expansionModel,"Medium");
    assert.ok(stages.includes("safety-review"));assert.ok(stages.includes("provider-queued"));assert.ok(stages.includes("provider-download"));assert.equal(result.costBreakdown.totalMicrousd,33496);
  }finally{globalThis.fetch=originalFetch;}
});

test("passes exactly one reference image as pixels to Ideogram image-to-image",async()=>{
  const originalFetch=globalThis.fetch;let submitted;
  globalThis.fetch=async(url,init={})=>{
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4/image-to-image"&&init.method==="POST"){submitted=JSON.parse(String(init.body));return Response.json({request_id:"fal-edit-1",status:"COMPLETED",response_url:"https://queue.fal.run/ideogram/v4/image-to-image/requests/fal-edit-1/response"});}
    if(String(url).endsWith("/requests/fal-edit-1/response"))return Response.json({images:[{url:"https://cdn.fal.media/edit.png",content_type:"image/png",width:1024,height:1024}],has_nsfw_concepts:[false]});
    if(String(url)==="https://cdn.fal.media/edit.png")return new Response("edited",{headers:{"content-type":"image/png"}});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    const reference={bytes:new TextEncoder().encode("pixels"),mimeType:"image/png",mode:"preserve_composition",source:"uploaded-reference"};
    const result=await generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{facts:[]},{title:"Edit"},{size:"1024x1024",outputFormat:"png",references:[reference]});
    assert.equal(result.model,"ideogram/v4/image-to-image");assert.match(submitted.image_url,/^data:image\/png;base64,/);assert.equal(submitted.strength,.35);assert.equal(submitted.enable_safety_checker,true);
  }finally{globalThis.fetch=originalFetch;}
});

test("surfaces a completed Fal queue error before attempting result retrieval",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push(String(url));
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4"&&init.method==="POST")return Response.json({request_id:"fal-failed-1",status:"IN_QUEUE",status_url:"https://queue.fal.run/ideogram/v4/requests/fal-failed-1/status",response_url:"https://queue.fal.run/ideogram/v4/requests/fal-failed-1/response"});
    if(String(url).endsWith("/requests/fal-failed-1/status?logs=1"))return Response.json({request_id:"fal-failed-1",status:"COMPLETED",error_type:"ValidationError",error:"Requested dimensions are unavailable for this model."});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    await assert.rejects(()=>generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{facts:[]},{title:"Invalid"},{quality:"high",size:"1024x1024"}),(error)=>{
      assert.equal(error.detail.code,"fal_validationerror");assert.equal(error.detail.message,"Requested dimensions are unavailable for this model.");assert.equal(error.detail.requestId,"fal-failed-1");return true;
    });
    assert.equal(calls.some((url)=>url.endsWith("/requests/fal-failed-1/response")),false);
  }finally{globalThis.fetch=originalFetch;}
});

test("preserves Fal validation detail and request IDs from result responses",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4"&&init.method==="POST")return Response.json({request_id:"fal-validation-1",status:"COMPLETED",response_url:"https://queue.fal.run/ideogram/v4/requests/fal-validation-1/response"});
    if(String(url).endsWith("/requests/fal-validation-1/response"))return Response.json({detail:[{loc:["body","image_size"],msg:"Width is outside the supported range",type:"value_error"}]},{status:422});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    await assert.rejects(()=>generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{facts:[]},{title:"Invalid"},{quality:"high",size:"1024x1024"}),(error)=>{
      assert.equal(error.detail.code,"fal_provider_request_failed");assert.equal(error.detail.message,"body.image_size: Width is outside the supported range");assert.equal(error.detail.requestId,"fal-validation-1");return true;
    });
  }finally{globalThis.fetch=originalFetch;}
});

test("prices Fal output by megapixels rather than inventing token usage",()=>{
  assert.deepEqual(priceFalIdeogramImageBreakdownMicrousd("ideogram/v4",1024,1024,"QUALITY","Large"),{textInputMicrousd:30000,textOutputMicrousd:0,imageTextInputMicrousd:0,imageInputMicrousd:0,imageOutputMicrousd:26215,totalMicrousd:56215});
});

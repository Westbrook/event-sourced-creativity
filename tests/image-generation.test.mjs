import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCreativeImagePrompt, buildPixelReferenceDirectives, buildSpatialDirectives, generateCreativeDirection, generateCreativeImage } from "../worker/openai-adapter.ts";
import { foldEvents } from "../src/model/events.ts";
import { providerFailurePrompt } from "../worker/provider-errors.ts";

test("builds a GPT Image prompt that preserves role, intent, and negative constraints",()=>{
  const prompt=buildCreativeImagePrompt({facts:[{block_id:"subject",role:"subject",intent:"avoid",effect:"must_not_include",properties:{text:"people under 20 years old"}},{block_id:"reference",role:"reference",intent:"include",properties:{label:"Casting reference"}}],relationships:[{relation_id:"relation",from_block_id:"subject",to_block_id:"reference",kind:"subject_reference"}]},{title:"Quiet interior",scene:"A still room after dusk"});
  assert.match(prompt,/Create one polished landscape image/);
  assert.match(prompt,/effect must_not_include/);
  assert.match(prompt,/people under 20 years old/);
  assert.match(prompt,/Never promote that content/);
  assert.match(prompt,/subject_reference/);assert.match(prompt,/target block supports the source block/);
});

test("sends the requested prompt representation without changing the image request profile",async()=>{
  const originalFetch=globalThis.fetch;const prompts=[];globalThis.fetch=async(_url,init)=>{prompts.push(JSON.parse(String(init.body)).prompt);return Response.json({data:[{b64_json:btoa("image")}],usage:{total_tokens:1}});};
  try{for(const promptTechnique of ["prose","bullets","json","xml"])await generateCreativeImage({OPENAI_API_KEY:"test-only"},"user-1",{facts:[{block_id:"b",role:"direction",properties:{text:"Quiet field"}}]},{title:"Study"},{promptTechnique});}finally{globalThis.fetch=originalFetch;}
  assert.match(prompts[0],/^Create one polished landscape/);assert.match(prompts[1],/Document decisions:/);assert.equal(JSON.parse(prompts[2]).operation,"generate_image");assert.match(prompts[3],/<image-generation-prompt/);assert.equal(new Set(prompts).size,4);
});

test("turns every spatial block scope into an explicit image-generation directive",()=>{
  const snapshot={facts:[
    {block_id:"subject-1",role:"subject",intent:"include",properties:{text:"glass vessel",weight:.8,spatial_scope:{kind:"aabb",aabb:{x:.62,y:.18,width:.28,height:.54},falloff:"hard"}}},
    {block_id:"light-1",role:"lighting",intent:"prefer",properties:{text:"warm rim light",weight:.65,spatial_scope:{kind:"subject",subject_block_id:"subject-1",subject_relation:"around",falloff:"soft",feather:.25}}},
    {block_id:"quiet-1",role:"composition",intent:"include",properties:{text:"negative space",weight:.5,spatial_scope:{kind:"region",region:"custom",instruction:"quiet upper-left field",polarity:"inside",falloff:"contextual"}}},
    {block_id:"paused-1",role:"material",intent:"include",active:false,properties:{text:"polished chrome",weight:0}},
  ]};
  const directives=buildSpatialDirectives(snapshot);
  assert.equal(directives.length,4);
  assert.match(directives[0],/left 62%, top 18%, width 28%, height 54%/);
  assert.match(directives[1],/around the subject “glass vessel”/);
  assert.match(directives[2],/quiet upper-left field/);
  assert.match(directives[3],/Do not apply material “polished chrome”/);
  const prompt=buildCreativeImagePrompt(snapshot,{title:"Spatial study"});
  assert.match(prompt,/Spatial application map/);
  assert.match(prompt,/spatial scope.*requirements/i);
  assert.match(prompt,/quiet upper-left field/);
});

test("calls the direct Image API with gpt-image-2, project attribution, and decodes one private image",async()=>{
  const originalFetch=globalThis.fetch;let requestBody;let requestHeaders;
  globalThis.fetch=async(url,init)=>{assert.equal(url,"https://api.openai.com/v1/images/generations");requestBody=JSON.parse(String(init.body));requestHeaders=new Headers(init.headers);return Response.json({created:1786406400,data:[{b64_json:btoa("png-bytes")}],usage:{input_tokens:120,output_tokens:900,total_tokens:1020}});};
  try{
    const result=await generateCreativeImage({OPENAI_API_KEY:"test-only",OPENAI_PROJECT:"proj_test"},"user-1",{facts:[]},{title:"Study"});
    assert.equal(requestBody.model,"gpt-image-2");assert.equal(requestBody.size,"1536x1024");assert.equal(requestBody.quality,"high");assert.equal(requestBody.n,1);
    assert.equal(requestHeaders.get("OpenAI-Project"),"proj_test");
    assert.equal(new TextDecoder().decode(result.bytes),"png-bytes");assert.equal(result.usage.totalTokens,1020);assert.equal(result.mimeType,"image/png");
  }finally{globalThis.fetch=originalFetch;}
});

test("rejects invalid GPT Image 2 dimensions before a paid provider request",async()=>{
  const originalFetch=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests+=1;return Response.json({});};
  try{
    await assert.rejects(()=>generateCreativeImage({OPENAI_API_KEY:"test-only"},"user-1",{facts:[]},{title:"Invalid portrait"},{quality:"low",size:"544x816"}),error=>{
      assert.equal(error.detail.code,"invalid_image_size");assert.equal(error.detail.action,"edit_request");assert.equal(error.detail.retryable,false);assert.match(error.detail.message,/at least 655,360 pixels/);return true;
    });
    assert.equal(requests,0);
  }finally{globalThis.fetch=originalFetch;}
});

test("preserves the exact image prompt when moderation stops a generation",async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:{message:"Your request was rejected by the safety system.",type:"image_generation_user_error"}},{status:400,headers:{"x-request-id":"req_prompt_receipt"}});
  try{
    await assert.rejects(()=>generateCreativeImage({OPENAI_API_KEY:"test-only"},"user-1",{facts:[{block_id:"subject",role:"subject",properties:{text:"Editorial portrait"}}]},{title:"Moderation receipt study"}),error=>{
      assert.match(providerFailurePrompt(error)??"",/Moderation receipt study/);
      assert.equal(error.detail.category,"safety");assert.equal(error.detail.requestId,"req_prompt_receipt");return true;
    });
  }finally{globalThis.fetch=originalFetch;}
});

test("preserves planner instructions and context when moderation stops before image submission",async()=>{
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:{message:"Request was rejected by moderation.",type:"content_policy_violation"}},{status:400});
  try{
    await assert.rejects(()=>generateCreativeDirection({OPENAI_API_KEY:"test-only"},"user-1",{document:{title:"Planning receipt"}}),error=>{
      const submitted=providerFailurePrompt(error)??"";assert.match(submitted,/creative-direction planner instructions/i);assert.match(submitted,/Planning receipt/);assert.equal(error.detail.category,"safety");return true;
    });
  }finally{globalThis.fetch=originalFetch;}
});

test("documents project attribution for every direct OpenAI request",async()=>{
  const adapter=await readFile(new URL("../worker/openai-adapter.ts",import.meta.url),"utf8");
  assert.ok((adapter.match(/headers:openAIHeaders\(env\)|headers: openAIHeaders\(env\)/g)??[]).length>=4);
  assert.match(adapter,/headers:openAIAuthHeaders\(env\)/);
});

test("uses the small compressed preview profile and hands multiple policy-labelled images to the high-quality edit request",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({data:[{b64_json:btoa("image")}],usage:{total_tokens:12}});};
  try{
    await generateCreativeImage({OPENAI_API_KEY:"test-only"},"user-1",{facts:[]},{title:"Draft"},{quality:"low",size:"816x816",outputFormat:"jpeg",outputCompression:70});
    const draftBody=JSON.parse(String(calls[0].init.body));assert.equal(calls[0].url,"https://api.openai.com/v1/images/generations");assert.equal(draftBody.quality,"low");assert.equal(draftBody.size,"816x816");assert.equal(draftBody.output_format,"jpeg");assert.equal(draftBody.output_compression,70);
    const reference=new TextEncoder().encode("draft-image");const uploaded=new TextEncoder().encode("uploaded-image");await generateCreativeImage({OPENAI_API_KEY:"test-only",OPENAI_PROJECT:"proj_test"},"user-1",{facts:[]},{title:"Final"},{quality:"high",size:"1536x1024",references:[{bytes:reference,mimeType:"image/png",label:"Selected draft",source:"ideation-preview"},{bytes:uploaded,mimeType:"image/jpeg",label:"Amber window",blockId:"reference-1",mode:"preserve_composition",source:"uploaded-reference"}]});
    assert.equal(calls[1].url,"https://api.openai.com/v1/images/edits");assert.ok(calls[1].init.body instanceof FormData);assert.equal(calls[1].init.body.get("quality"),"high");assert.equal(calls[1].init.body.get("size"),"1536x1024");assert.equal(calls[1].init.body.getAll("image[]").length,2);assert.ok(calls[1].init.body.getAll("image[]").every((value)=>value instanceof Blob));assert.match(String(calls[1].init.body.get("prompt")),/Image 1 is the selected working draft/);assert.match(String(calls[1].init.body.get("prompt")),/preserve the reference image's composition/i);assert.equal(new Headers(calls[1].init.headers).get("OpenAI-Project"),"proj_test");assert.equal(new Headers(calls[1].init.headers).has("content-type"),false);
  }finally{globalThis.fetch=originalFetch;}
});

test("explains reference pixel policy without attaching context-only images",()=>{
  const directives=buildPixelReferenceDirectives([{bytes:new Uint8Array([1]),mimeType:"image/jpeg",label:"Texture study",mode:"preserve_style",source:"uploaded-reference"}]);
  assert.match(directives,/Image 1/);assert.match(directives,/Texture study/);assert.match(directives,/material language/);
  assert.match(buildPixelReferenceDirectives([]),/No source-image pixels are attached/);
});

test("streams one early GPT Image preview before returning the completed JPEG",async()=>{
  const originalFetch=globalThis.fetch;const partials=[];let requestBody;
  globalThis.fetch=async(_url,init)=>{requestBody=JSON.parse(String(init.body));const events=[{type:"image_generation.partial_image",b64_json:btoa("partial-jpeg"),created_at:1,size:"816x816",quality:"low",output_format:"jpeg",partial_image_index:0},{type:"image_generation.completed",b64_json:btoa("final-jpeg"),created_at:2,size:"816x816",quality:"low",output_format:"jpeg",usage:{input_tokens:20,output_tokens:196,total_tokens:216}}];return new Response(events.map((event)=>`data: ${JSON.stringify(event)}\n\n`).join(""),{headers:{"content-type":"text/event-stream"}});};
  try{
    const result=await generateCreativeImage({OPENAI_API_KEY:"test-only"},"user-1",{facts:[]},{title:"Draft"},{quality:"low",size:"816x816",outputFormat:"jpeg",outputCompression:70,partialImages:1,onPartial:(partial)=>partials.push(partial)});
    assert.equal(requestBody.stream,true);assert.equal(requestBody.partial_images,1);assert.equal(requestBody.output_format,"jpeg");assert.equal(partials.length,1);assert.equal(new TextDecoder().decode(partials[0].bytes),"partial-jpeg");assert.equal(partials[0].mimeType,"image/jpeg");assert.equal(new TextDecoder().decode(result.bytes),"final-jpeg");assert.equal(result.mimeType,"image/jpeg");assert.equal(result.partialCount,1);assert.equal(result.usage.totalTokens,216);
  }finally{globalThis.fetch=originalFetch;}
});

test("stores generated bytes in R2 and projects only the authenticated asset reference",async()=>{
  const mediaUrl="/api/media/owner-example.com%2Fgenerated%2Fgeneration-1.png";
  const base={streamId:"s",occurredAt:"2026-08-11T12:00:00.000Z",recordedAt:"2026-08-11T12:00:00.000Z",clientId:"test",correlationId:"c",causationId:null,compensatesEventId:null,schemaVersion:1};
  const projection=foldEvents([
    {...base,eventId:"e1",sequence:1,actor:"user",type:"ProjectCreated",payload:{project_id:"p",name:"P"}},
    {...base,eventId:"e2",sequence:2,actor:"user",type:"DocumentCreated",payload:{document_id:"d",project_id:"p",title:"D"}},
    {...base,eventId:"e3",sequence:3,actor:"worker:generator",type:"GenerationCompleted",payload:{generation_id:"g",document_id:"d",model_id:"gpt-image-2",planner_model_id:"gpt-5.6-terra",object_ids:["o"],media_url:mediaUrl,media_type:"image/png",image_width:1536,image_height:1024}},
  ]);
  assert.equal(projection.outputs[0].mediaUrl,mediaUrl);assert.equal(projection.outputs[0].modelId,"gpt-image-2");assert.equal(projection.outputs[0].plannerModelId,"gpt-5.6-terra");assert.equal(projection.outputs[0].width,1536);
  const [eventApi,mediaApi]=await Promise.all([readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),readFile(new URL("../worker/media-api.ts",import.meta.url),"utf8")]);assert.doesNotMatch(eventApi,/b64_json/);assert.match(eventApi,/media_url:media\.url/);assert.match(mediaApi,/env\.MEDIA\.put\(key,bytes\.buffer/);assert.match(mediaApi,/source:"openai-image-api"/);
});

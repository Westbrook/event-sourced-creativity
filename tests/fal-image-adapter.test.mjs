import assert from "node:assert/strict";
import test from "node:test";
import { generateCreativeImage, selectImageAdapter } from "../worker/image-adapter.ts";
import { FAL_IDEOGRAM_ADAPTER_VERSION, FAL_IDEOGRAM_CAPTION_STRATEGY, FAL_IDEOGRAM_REFERENCE_STRENGTHS, falExpansionModel, falExpansionModelForRequest, falImageModelForRequest, falImageProviderReceipt, falReferenceStrength, falRenderingSpeed } from "../worker/fal-image-adapter.ts";
import { buildIdeogramCaption, IDEOGRAM_CAPTION_ADAPTER_VERSION, IDEOGRAM_CAPTION_MAX_CHARS, validateIdeogramCaption } from "../worker/ideogram-caption-adapter.ts";
import { buildIdeogramPrompt, IDEOGRAM_PROMPT_ADAPTER_VERSION, IDEOGRAM_PROMPT_MAX_CHARS } from "../worker/ideogram-prompt-adapter.ts";
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

test("derives canonical Fal queue receipts from the application root instead of routed model endpoints",()=>{
  for(const model of ["ideogram/v4","ideogram/v4/fast","ideogram/v4/image-to-image"]){
    assert.deepEqual(falImageProviderReceipt(model,"fal-canonical-1"),{
      provider:"fal",model,providerRequestId:"fal-canonical-1",
      providerStatusUrl:"https://queue.fal.run/ideogram/v4/requests/fal-canonical-1/status",
      providerResponseUrl:"https://queue.fal.run/ideogram/v4/requests/fal-canonical-1",
      providerCancelUrl:"https://queue.fal.run/ideogram/v4/requests/fal-canonical-1/cancel",
    });
  }
  const workflow=falImageProviderReceipt("workflows/example/app/fast","fal-workflow-1");
  assert.equal(workflow.providerResponseUrl,"https://queue.fal.run/workflows/example/app/requests/fal-workflow-1");
  assert.throws(()=>falImageProviderReceipt("ideogram/v4/../foreign","fal-canonical-1"),(error)=>error.detail?.code==="fal_provider_receipt_mismatch");
  assert.throws(()=>falImageProviderReceipt("ideogram/v4/fast","foreign/request"),(error)=>error.detail?.code==="fal_provider_returned_invalid_request_id");
});

test("runs a Fal Ideogram draft through moderation, queue, result, private download, and pixel pricing",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4/fast"&&init.method==="POST")return Response.json({request_id:"fal-request-1",status:"IN_QUEUE",status_url:"https://queue.fal.run/ideogram/v4/requests/fal-request-1/status",response_url:"https://queue.fal.run/ideogram/v4/requests/fal-request-1",cancel_url:"https://queue.fal.run/ideogram/v4/requests/fal-request-1/cancel"});
    if(String(url)==="https://queue.fal.run/ideogram/v4/requests/fal-request-1/status?logs=1")return Response.json({request_id:"fal-request-1",status:"COMPLETED"});
    if(String(url)==="https://queue.fal.run/ideogram/v4/requests/fal-request-1")return Response.json({images:[{url:"https://cdn.fal.media/output.jpg",content_type:"image/jpeg",width:816,height:816}],seed:42,has_nsfw_concepts:[false],prompt:"unchanged"});
    if(String(url)==="https://cdn.fal.media/output.jpg")return new Response("fal-image",{headers:{"content-type":"image/jpeg"}});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    const stages=[];const result=await generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{facts:[]},{title:"Typography study"},{quality:"low",size:"816x816",outputFormat:"jpeg",onStage:(stage)=>stages.push(stage)});
    assert.equal(result.provider,"fal");assert.equal(result.adapterVersion,"v52");assert.equal(result.model,"ideogram/v4/fast");assert.equal(result.providerRequestId,"fal-request-1");assert.equal(result.seed,42);assert.equal(result.promptAdaptation.strategy,"production_director");assert.equal(new TextDecoder().decode(result.bytes),"fal-image");
    const submitted=JSON.parse(String(calls.find((call)=>call.url==="https://queue.fal.run/ideogram/v4/fast").init.body));
    assert.ok(calls.some((call)=>call.url==="https://queue.fal.run/ideogram/v4/requests/fal-request-1/status?logs=1"));assert.ok(calls.some((call)=>call.url==="https://queue.fal.run/ideogram/v4/requests/fal-request-1"));assert.equal(calls.some((call)=>call.url.includes("/fast/requests/")||call.url.endsWith("/response")),false);
    assert.match(submitted.prompt,/CREATIVE GOAL: Typography study/);assert.match(submitted.prompt,/TEXT: Do not render/);
    assert.equal(submitted.expansion_model,"Medium");assert.equal(submitted.rendering_speed,"BALANCED");assert.deepEqual(submitted.image_size,{width:816,height:816});assert.equal(submitted.enable_safety_checker,true);assert.equal(submitted.num_images,1);assert.equal("seed" in submitted,false);assert.equal(result.expansionModel,"Medium");assert.equal(result.promptMode,"expanded_plain");assert.equal(result.promptAdapterVersion,IDEOGRAM_PROMPT_ADAPTER_VERSION);
    assert.ok(stages.includes("safety-review"));assert.ok(stages.includes("provider-queued"));assert.ok(stages.includes("provider-download"));assert.equal(result.costBreakdown.totalMicrousd,36992);
  }finally{globalThis.fetch=originalFetch;}
});

test("passes exactly one reference image as pixels to Ideogram image-to-image",async()=>{
  const originalFetch=globalThis.fetch;let submitted;
  globalThis.fetch=async(url,init={})=>{
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4/image-to-image"&&init.method==="POST"){submitted=JSON.parse(String(init.body));return Response.json({request_id:"fal-edit-1",status:"COMPLETED",response_url:"https://queue.fal.run/ideogram/v4/requests/fal-edit-1"});}
    if(String(url)==="https://queue.fal.run/ideogram/v4/requests/fal-edit-1")return Response.json({images:[{url:"https://cdn.fal.media/edit.png",content_type:"image/png",width:1024,height:1024}],has_nsfw_concepts:[false]});
    if(String(url)==="https://cdn.fal.media/edit.png")return new Response("edited",{headers:{"content-type":"image/png"}});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    const reference={bytes:new TextEncoder().encode("pixels"),mimeType:"image/png",mode:"preserve_composition",source:"uploaded-reference"};
    const result=await generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{facts:[]},{title:"Edit"},{size:"1024x1024",outputFormat:"png",references:[reference]});
    assert.equal(result.model,"ideogram/v4/image-to-image");assert.match(submitted.image_url,/^data:image\/png;base64,/);assert.equal(submitted.strength,.88);assert.equal(submitted.enable_safety_checker,true);assert.match(submitted.prompt,/REFERENCE — LAYOUT ONLY/);
  }finally{globalThis.fetch=originalFetch;}
});

test("surfaces a completed Fal queue error before attempting result retrieval",async()=>{
  const originalFetch=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push(String(url));
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4"&&init.method==="POST")return Response.json({request_id:"fal-failed-1",status:"IN_QUEUE",status_url:"https://queue.fal.run/ideogram/v4/requests/fal-failed-1/status",response_url:"https://queue.fal.run/ideogram/v4/requests/fal-failed-1"});
    if(String(url)==="https://queue.fal.run/ideogram/v4/requests/fal-failed-1/status?logs=1")return Response.json({request_id:"fal-failed-1",status:"COMPLETED",error_type:"ValidationError",error:"Requested dimensions are unavailable for this model."});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    await assert.rejects(()=>generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{facts:[]},{title:"Invalid"},{quality:"high",size:"1024x1024"}),(error)=>{
      assert.equal(error.detail.code,"fal_validationerror");assert.equal(error.detail.message,"Requested dimensions are unavailable for this model.");assert.equal(error.detail.requestId,"fal-failed-1");return true;
    });
    assert.equal(calls.includes("https://queue.fal.run/ideogram/v4/requests/fal-failed-1"),false);
  }finally{globalThis.fetch=originalFetch;}
});

test("preserves Fal validation detail and request IDs from result responses",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4"&&init.method==="POST")return Response.json({request_id:"fal-validation-1",status:"COMPLETED",response_url:"https://queue.fal.run/ideogram/v4/requests/fal-validation-1"});
    if(String(url)==="https://queue.fal.run/ideogram/v4/requests/fal-validation-1")return Response.json({detail:[{loc:["body","image_size"],msg:"Width is outside the supported range",type:"value_error"}]},{status:422});
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

test("maps reference intent onto Fal's documented transformation-strength semantics",()=>{
  const reference=(mode)=>({bytes:new Uint8Array([1]),mimeType:"image/png",source:"uploaded-reference",mode});
  assert.ok(falReferenceStrength(reference("preserve_subject"))<falReferenceStrength(reference("preserve_composition")));
  assert.ok(falReferenceStrength(reference("preserve_composition"))<falReferenceStrength(reference("inspiration")));
  assert.equal(falReferenceStrength(reference("preserve_composition"),.94),.94);
  assert.equal(falReferenceStrength(reference("inspiration"),2),1);
  assert.equal(FAL_IDEOGRAM_ADAPTER_VERSION,"v52");assert.equal(FAL_IDEOGRAM_CAPTION_STRATEGY,"production_director");assert.deepEqual(FAL_IDEOGRAM_REFERENCE_STRENGTHS,{inspiration:.99,preserve_composition:.88,preserve_subject:.3,preserve_style:.72,default:.9});
});

test("uses a quality-aware explicit expansion strategy and keeps fast drafts at balanced rendering",()=>{
  assert.equal(falExpansionModel("low"),"Medium");
  assert.equal(falExpansionModel("medium"),"Medium");
  assert.equal(falExpansionModel("high"),"Large");
  assert.equal(falExpansionModel("high","native_caption"),"None");
  assert.equal(falExpansionModel("low","expanded_plain"),"Medium");
  assert.equal(falExpansionModel("high","expanded_plain","Large"),"Large");
  const env={FAL_IMAGE_MODEL:"ideogram/v4",FAL_IMAGE_PREVIEW_MODEL:"ideogram/v4/fast"};
  assert.equal(falExpansionModelForRequest(env,"low","ideogram/v4/fast"),"Medium");
  assert.equal(falExpansionModelForRequest(env,"low","ideogram/v4"),"Large");
  assert.equal(falExpansionModelForRequest(env,"low","ideogram/v4/image-to-image"),"Large");
  assert.equal(falExpansionModelForRequest(env,"low","ideogram/v4","native_caption"),"None");
  assert.equal(falRenderingSpeed("low"),"BALANCED");
  assert.equal(falRenderingSpeed("medium"),"BALANCED");
  assert.equal(falRenderingSpeed("high"),"QUALITY");
});

test("routes semantically complex low-quality material studies through the standard model",()=>{
  const env={FAL_IMAGE_MODEL:"ideogram/v4",FAL_IMAGE_PREVIEW_MODEL:"ideogram/v4/fast",FAL_IMAGE_EDIT_MODEL:"ideogram/v4/image-to-image"};
  assert.equal(falImageModelForRequest(env,"low",[],{scene:"Produce a fast but readable study emphasizing the named material, palette, light, and mood."}),"ideogram/v4");
  assert.equal(falImageModelForRequest(env,"low",[],{scene:"Create a loose visual draft."}),"ideogram/v4/fast");
  assert.equal(falImageModelForRequest(env,"low",[{bytes:new Uint8Array([1]),mimeType:"image/png",source:"reference"}],{scene:"Material study."}),"ideogram/v4/image-to-image");
});

test("retains an explicitly prepared canonical prompt while submitting its provider-native translation",async()=>{
  const originalFetch=globalThis.fetch;let submitted;
  globalThis.fetch=async(url,init={})=>{
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4/fast"&&init.method==="POST"){submitted=JSON.parse(String(init.body));return Response.json({request_id:"fal-prepared-1",status:"COMPLETED",response_url:"https://queue.fal.run/ideogram/v4/requests/fal-prepared-1"});}
    if(String(url)==="https://queue.fal.run/ideogram/v4/requests/fal-prepared-1")return Response.json({images:[{url:"https://cdn.fal.media/prepared.jpg",content_type:"image/jpeg",width:1024,height:1024}]});
    if(String(url)==="https://cdn.fal.media/prepared.jpg")return new Response("prepared",{headers:{"content-type":"image/jpeg"}});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    const result=await generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{ignored:"snapshot"},{ignored:"direction"},{quality:"low",size:"1024x1024",outputFormat:"jpeg",preparedPrompt:"Exact paired evaluation prompt."});
    assert.match(submitted.prompt,/Exact paired evaluation prompt/);assert.equal(result.canonicalPrompt,"Exact paired evaluation prompt.");assert.equal(result.prompt,submitted.prompt);assert.equal(result.promptAdapterVersion,IDEOGRAM_PROMPT_ADAPTER_VERSION);
  }finally{globalThis.fetch=originalFetch;}
});

test("compiles a deterministic Ideogram-native caption with ordered keys, scoped boxes, colors, and exact authored type",()=>{
  const facts=[
    {block_id:"subject-1",type:"subject",intent:"include",properties:{text:"an adult astronomer checking a brass telescope",spatial_scope:{kind:"aabb",aabb:{x:.15,y:.2,width:.4,height:.5}}}},
    {block_id:"palette-1",type:"palette",intent:"prefer",properties:{text:"midnight blue, warm brass, chalk white"}},
    {block_id:"type-1",type:"typography",intent:"include",properties:{text:"Set the exact display text “OPEN SKY” once.",weight:.9}},
  ];
  const result=buildIdeogramCaption({facts},{scene:"An observatory at night."},"canonical",[],{quality:"high",size:"1024x1024",promptTechnique:"json"});
  const caption=JSON.parse(result.prompt);assert.equal(result.valid,true);assert.equal(result.adapterVersion,IDEOGRAM_CAPTION_ADAPTER_VERSION);assert.ok(result.prompt.length<=IDEOGRAM_CAPTION_MAX_CHARS);assert.deepEqual(Object.keys(caption),["high_level_description","style_description","compositional_deconstruction"]);assert.deepEqual(caption.compositional_deconstruction.elements[0].bbox,[200,150,700,550]);assert.deepEqual(caption.compositional_deconstruction.elements[0].color_palette,["#191970","#B08D57","#F5F5E8"]);assert.equal(caption.compositional_deconstruction.elements[1].text,"OPEN SKY");assert.deepEqual(validateIdeogramCaption(caption),{valid:true,issues:[]});
});

test("keeps scoped palettes local and material/composition requirements explicit in native captions",()=>{
  const facts=[
    {block_id:"subject",type:"subject",intent:"include",properties:{text:"a food scientist testing a plated tasting menu"}},
    {block_id:"composition",type:"composition",intent:"include",properties:{text:"an overhead grid of six plates interrupted by one displaced plate"}},
    {block_id:"materials",type:"material",intent:"include",properties:{text:"brushed steel, glazed ceramic, linen, and translucent gel"}},
    {block_id:"local-palette",type:"palette",intent:"prefer",properties:{text:"celadon, bone, iron oxide, and cobalt",spatial_scope:{kind:"aabb",aabb:{x:.52,y:.48,width:.4,height:.42}}}},
  ];
  const result=buildIdeogramCaption({facts},{scene:"A precise material and layout study.",palette:["celadon","bone","iron oxide","cobalt"]},"canonical",[],{quality:"high",size:"1024x1024",promptTechnique:"json",ideogramCaptionStrategy:"spatial_material"});
  const caption=JSON.parse(result.prompt);const elements=caption.compositional_deconstruction.elements;
  assert.equal(result.valid,true);assert.equal(result.schemaVersion,2);assert.equal(result.strategy,"spatial_material");assert.equal(caption.style_description.color_palette,undefined);assert.ok(elements.some((item)=>item.bbox?.join(",")==="480,520,900,920"&&item.color_palette?.length===4));assert.ok(elements.some((item)=>/Every named material must be visibly present/.test(item.desc)));assert.ok(elements.some((item)=>/named counts, ordering, interruptions/.test(item.desc)));
});

test("keeps the legacy expanded-plain strategy available as an explicit comparison path",async()=>{
  const originalFetch=globalThis.fetch;let submitted;
  globalThis.fetch=async(url,init={})=>{
    if(String(url).endsWith("/moderations"))return moderationPass();
    if(String(url)==="https://queue.fal.run/ideogram/v4/fast"&&init.method==="POST"){submitted=JSON.parse(String(init.body));return Response.json({request_id:"fal-expanded-1",status:"COMPLETED",response_url:"https://queue.fal.run/ideogram/v4/requests/fal-expanded-1"});}
    if(String(url)==="https://queue.fal.run/ideogram/v4/requests/fal-expanded-1")return Response.json({images:[{url:"https://cdn.fal.media/expanded.jpg",content_type:"image/jpeg",width:1024,height:1024}]});
    if(String(url)==="https://cdn.fal.media/expanded.jpg")return new Response("expanded",{headers:{"content-type":"image/jpeg"}});
    throw new Error(`unexpected request ${url}`);
  };
  try{
    const result=await generateCreativeImage({OPENAI_API_KEY:"openai-test",FAL_KEY:"fal-test",FORMA_IMAGE_PROVIDER:"fal-ideogram"},"user-1",{facts:[{block_id:"subject",type:"subject",intent:"include",properties:{text:"an adult astronomer"}}]},{scene:"An observatory at night."},{quality:"low",size:"1024x1024",ideogramPromptMode:"expanded_plain",ideogramExpansionModel:"Large"});
    assert.equal(submitted.expansion_model,"Large");assert.throws(()=>JSON.parse(submitted.prompt));assert.equal(result.promptMode,"expanded_plain");assert.equal(result.promptAdapterVersion,IDEOGRAM_PROMPT_ADAPTER_VERSION);
  }finally{globalThis.fetch=originalFetch;}
});

test("expanded captions keep scoped palettes local and repeat literal composition and material structure",()=>{
  const facts=[
    {block_id:"subject",type:"subject",intent:"include",properties:{text:"a ceramicist comparing three glaze tiles",spatial_scope:{kind:"aabb",aabb:{x:.52,y:.48,width:.4,height:.42}}}},
    {block_id:"palette",type:"palette",intent:"prefer",properties:{text:"celadon, bone, iron oxide, and cobalt",spatial_scope:{kind:"aabb",aabb:{x:.52,y:.48,width:.4,height:.42}}}},
    {block_id:"composition",type:"composition",intent:"include",properties:{text:"an ordered triptych of three tiles"}},
    {block_id:"material",type:"material",intent:"include",properties:{text:"crackle glaze, raw clay, plaster, and pale oak"}},
  ];
  const result=buildIdeogramPrompt({facts},{scene:"Keep local decisions bounded.",palette:["celadon","bone","iron oxide","cobalt"]},"canonical",[],{quality:"high",size:"1024x1024",promptTechnique:"bullets",ideogramCaptionStrategy:"spatial_material"});
  assert.equal(result.strategy,"spatial_material");assert.match(result.prompt,/COMPOSITION — LITERAL STRUCTURE/);assert.match(result.prompt,/MATERIALS — VISIBLE AND DISTINCT/);assert.match(result.prompt,/Do not extend its subject, palette, material/);assert.doesNotMatch(result.prompt,/^PALETTE:/m);
});

test("literal contracts preserve edge-only framing and normalize structured inputs into one visible checklist",()=>{
  const facts=[
    {block_id:"subject",type:"subject",intent:"include",properties:{text:"a ceramicist comparing three experimental glaze tiles"}},
    {block_id:"setting",type:"setting",intent:"include",properties:{text:"a daylight workshop with a single long worktable"}},
    {block_id:"composition",type:"composition",intent:"include",properties:{text:"ordered triptych of tiles with hands entering only at the lower edge"}},
    {block_id:"material",type:"material",intent:"prefer",properties:{text:"crackle glaze, raw clay, plaster, and pale oak"}},
  ];
  const result=buildIdeogramPrompt({facts},{scene:"Resolve the complete scene."},"<document><facts>canonical XML</facts></document>",[],{quality:"high",size:"1024x1024",promptTechnique:"xml",ideogramCaptionStrategy:"literal_contract"});
  assert.equal(result.adapterVersion,"ideogram-context-v6");assert.equal(result.strategy,"literal_contract");assert.match(result.prompt,/COMPOSITION — LITERAL STRUCTURE/);assert.match(result.prompt,/FRAMING LOCK:/);assert.match(result.prompt,/Do not show that person's face, head, shoulders, torso, or full body/);assert.match(result.prompt,/VISIBLE ACCEPTANCE CHECKLIST:/);assert.match(result.prompt,/subject\/action = a ceramicist/);assert.match(result.prompt,/FINAL COMPOSITION CHECK:/);assert.doesNotMatch(result.prompt,/<document>/);
});

test("compiles campaign-four prompts into one prioritized, directed, clean-frame contract",()=>{
  const facts=[
    {block_id:"subject",type:"subject",intent:"include",properties:{text:"a solitary astronomer calibrating a brass telescope"}},
    {block_id:"setting",type:"setting",intent:"include",properties:{text:"a circular mountain observatory open to a star-dense sky"}},
    {block_id:"composition",type:"composition",intent:"include",properties:{text:"a strong diagonal from the telescope toward a small celestial event"}},
    {block_id:"material",type:"material",intent:"prefer",properties:{text:"patinated brass, dark walnut, frosted glass, and worn paper"}},
  ];
  const result=buildIdeogramPrompt({facts},{scene:"Resolve the exact composition as a polished editorial image."},"canonical",[],{quality:"high",size:"1024x1024",promptTechnique:"prose",ideogramCaptionStrategy:"production_director"});
  assert.equal(result.adapterVersion,"ideogram-context-v6");assert.match(result.prompt,/PRIMARY SUCCESS TEST — COMPOSITION/);assert.match(result.prompt,/DIRECTED GEOMETRY/);assert.match(result.prompt,/continued axis beyond the far end/);assert.match(result.prompt,/FINAL READ/);assert.match(result.prompt,/DELIVERY QUALITY CONTROL/);assert.equal(result.mandatorySubjectRepeated,true);assert.ok(result.providerPromptLength<=IDEOGRAM_PROMPT_MAX_CHARS);
});

test("translates event-heavy context into concise visual instructions without promoting optional type",()=>{
  const facts=[
    {block_id:"subject-1",type:"subject",intent:"include",properties:{text:"a ceramicist comparing three glaze tiles",weight:.92,spatial_scope:{kind:"aabb",aabb:{x:.52,y:.48,width:.4,height:.42}}}},
    {block_id:"palette-1",type:"palette",intent:"prefer",properties:{text:"celadon, bone, iron oxide, cobalt",weight:.72,spatial_scope:{kind:"aabb",aabb:{x:.52,y:.48,width:.4,height:.42}}}},
    {block_id:"type-1",type:"typography",intent:"prefer",properties:{text:"If typography is present, set the exact display text “WEATHER, FIRED” once.",weight:.45,spatial_scope:{kind:"document"}}},
    {block_id:"avoid-1",type:"constraint",intent:"avoid",effect:"must_not_include",properties:{text:"pottery wheels, rustic farmhouse styling, or interface chrome",weight:.9,spatial_scope:{kind:"document"}}},
  ];
  const result=buildIdeogramPrompt({facts},{scene:"Honor the scoped subject and palette decisions."},"x".repeat(12_000),[],{quality:"medium",size:"1024x1024",promptTechnique:"json"});
  assert.ok(result.prompt.length<=IDEOGRAM_PROMPT_MAX_CHARS);assert.match(result.prompt,/MANDATORY PRIMARY SUBJECT AND ACTION: Prominently and unmistakably depict a ceramicist/);assert.match(result.prompt,/FINAL VISUAL CHECK:.*a ceramicist/);assert.match(result.prompt,/lower-right area/);assert.match(result.prompt,/Confine subject/);assert.match(result.prompt,/TEXT: Do not render/);assert.doesNotMatch(result.prompt,/WEATHER, FIRED/);assert.match(result.prompt,/EXCLUDE: pottery wheels/);assert.equal(result.omittedOptionalTypography,true);assert.deepEqual(result.includedBlockIds,["subject-1","palette-1","avoid-1"]);assert.deepEqual(result.omittedBlockIds,["type-1"]);assert.deepEqual(result.mandatorySubjectBlockIds,["subject-1"]);assert.equal(result.mandatorySubjectRepeated,true);assert.equal(result.benignStoryContextApplied,false);
});

test("retains one exact phrase only when typography is an authored requirement",()=>{
  const result=buildIdeogramPrompt({facts:[{block_id:"type-1",type:"typography",intent:"include",properties:{text:"Set the exact display text “ONE CLEAR LINE” once.",weight:.95,spatial_scope:{kind:"document"}}}]},{scene:"Create restrained typographic key art."},"canonical",[],{quality:"high",size:"1024x1024",promptTechnique:"prose"});
  assert.match(result.prompt,/BENIGN STORY CONTEXT:/);assert.match(result.prompt,/safe fictional character/);assert.match(result.prompt,/only the artwork's title/);assert.match(result.prompt,/TEXT — REQUIRED: Render exactly “ONE CLEAR LINE” once/);assert.match(result.prompt,/No other letters/);assert.equal(result.omittedOptionalTypography,false);assert.equal(result.benignStoryContextApplied,true);
});

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import { generateCreativeImage } from "../worker/image-adapter.ts";
import { buildIdeogramPrompt } from "../worker/ideogram-prompt-adapter.ts";

const workspaceRoot=new URL("../",import.meta.url).href;
const sourceResolution=registerHooks({resolve(specifier,context,nextResolve){
  const workspaceSource=typeof context.parentURL==="string"&&context.parentURL.startsWith(workspaceRoot)&&!context.parentURL.includes("/node_modules/");
  return nextResolve(workspaceSource&&specifier.startsWith(".")&&!/\.[a-z0-9]+$/i.test(specifier)?`${specifier}.ts`:specifier,context);
}});
const {storyboardFrameRenderingInput}=await import("../worker/events-api.ts").finally(()=>sourceResolution.deregister());

const feedbackMessage=[
  "Your content. One context. Infinite paths to your target.",
  "Ease of gathering/managing context: 7/10.",
  "Success adapting that context to the slideshow medium: 2/10.",
  "Success capturing the intended message: 3/10.",
  "EASIER: one authored context can deliver slides, a storyboard, or video.",
  "HARDER: failed provider request fal_safety_rejected left a disputed payment receipt.",
  "P0: resolve provider failures, billing diagnostics, and PRIVATE_PROJECT_LEDGER.",
  "P1: preserve storyteller-led and recipient-led delivery.",
  "P2: show an honest readiness preview before spending.",
].join("\n");

function feedbackFixture(){
  return{
    snapshot:{
      facts:[
        {block_id:"feedback-direction",type:"direction",intent:"include",properties:{text:"Tell the full end-user critique, failed provider request, and payment dispute.",weight:1}},
        {block_id:"feedback-audience",type:"audience",intent:"include",properties:{text:"Product leadership and private procurement reviewers",weight:1}},
        {block_id:"feedback-format",type:"format",intent:"include",properties:{text:"Landscape 3:2 storyboard with the exact tagline and five labeled legacy file formats",weight:1}},
        {block_id:"feedback-message",type:"message",intent:"include",properties:{text:feedbackMessage,weight:1}},
        {block_id:"feedback-typography",type:"typography",intent:"include",properties:{text:"Render the exact words “Your content. One context. Infinite paths to your target.”",weight:1}},
        {block_id:"feedback-subject",type:"subject",intent:"include",properties:{text:"An adult product designer arranging five blank color-coded file-shaped cards around one glowing shared context",weight:.9}},
        {block_id:"feedback-composition",type:"composition",intent:"include",locked:true,properties:{text:"Landscape three-act left-to-right flow: five unmarked abstract document shapes, a luminous neutral center, and three unlabeled delivery panels",weight:1}},
        {block_id:"feedback-style",type:"style",intent:"prefer",properties:{text:"Minimal cinematic editorial illustration with clean geometric forms",weight:.8}},
        {block_id:"feedback-palette",type:"palette",intent:"prefer",properties:{text:"midnight blue, warm brass, and cobalt",weight:.8}},
        {block_id:"feedback-visual-exclusion",type:"exclusion",intent:"avoid",effect:"must_not_include",properties:{text:"watermarks, logos, signatures, and decorative borders",weight:1}},
        {block_id:"feedback-operational-exclusion",type:"exclusion",intent:"avoid",effect:"must_not_include",properties:{text:"private identifiers, failed provider requests, disputed payment receipts, and billing records",weight:1}},
        {block_id:"feedback-private-reference",type:"reference",intent:"include",properties:{text:"PRIVATE_REFERENCE_PHOTO",reference_id:"PRIVATE_SOURCE_REFERENCE_1",media_url:"/api/media/PRIVATE_REFERENCE_BYTES",pixel_reference_mode:"context_only",weight:.9}},
        {block_id:"feedback-muted",type:"subject",intent:"include",active:false,properties:{text:"PRIVATE_MUTED_SOURCE_SUBJECT",weight:1}},
      ],
      relationships:[{relation_id:"PRIVATE_RELATION_ID",from_block_id:"feedback-message",to_block_id:"feedback-subject",kind:"supports"}],
      standing_constraints:[{polarity:"avoid",axis:"account",value:"PRIVATE_PROVIDER_TRANSACTION_REFERENCE"}],
      as_of:{head:19,lag:0},
    },
    frame:{
      title:"Frame 1 — Context verdict: 7/10",
      body:"Five legacy files converge into one shared context; adaptation 2/10 and message 3/10 remain available in the authored caption.",
      notes:"Caption: Your content. One context. Infinite paths to your target. Preserve the failed provider payment in the end-user notes.",
      image_prompt:"Landscape 3:2 cinematic editorial illustration. Show five labeled cards reading .doc, .ppt, .mov, .mp3, and .psd converging into one glowing Forma context, then branching into three clean delivery panels. Render the exact text “Your content. One context. Infinite paths to your target.” Include explicit scorecard labels 7/10, 2/10, and 3/10.",
    },
  };
}

const forbiddenProviderSource=/7\/10|2\/10|3\/10|\.doc\b|\.ppt\b|\.mov\b|\.mp3\b|\.psd\b|fal_safety_rejected|failed provider|\bpayment\b|\bbilling\b|\bprocurement\b|PRIVATE_[A-Z_0-9]+|Your content\. One context\./iu;

function preparedFrame(){
  const source=feedbackFixture();
  const original=structuredClone(source);
  const prepared=storyboardFrameRenderingInput(source.snapshot,source.frame);
  assert.deepEqual(source,original,"provider-frame adaptation must not mutate the authored scorecard, full source context, captions, or notes");
  return{source,prepared};
}

test("adapts critique-heavy authored context into a benign text-free landscape storyboard frame without altering its source",()=>{
  const{source,prepared}=preparedFrame();
  assert.equal(prepared.size,"1536x1024");
  assert.equal(prepared.ideogramCaptionStrategy,"compact_literal");
  assert.ok(Array.isArray(prepared.snapshot.facts));
  assert.ok(prepared.snapshot.facts.some((fact)=>fact.type==="subject"),"authored visible subject remains available to the frame renderer");
  assert.ok(prepared.snapshot.facts.some((fact)=>fact.type==="composition"),"authored visible layout remains available to the frame renderer");
  assert.ok(prepared.snapshot.facts.some((fact)=>fact.type==="exclusion"),"visual-only authored prohibitions remain enforceable");
  assert.ok(prepared.snapshot.facts.every((fact)=>!["message","audience","direction","format","typography","reference"].includes(fact.type)),"narrative, typography, and description-only source pixels are not image-rendering inputs");
  assert.doesNotMatch(JSON.stringify({snapshot:prepared.snapshot,direction:prepared.direction}),forbiddenProviderSource);
  assert.match(prepared.direction.scene,/glowing|shared context|abstract|delivery/i);
  assert.doesNotMatch(prepared.direction.scene,/\blabeled cards\b|\b(?:show|include|render|display)\s+(?:visible\s+)?(?:labels|captions|exact text|words)\b/i,"an image asked to contain no text cannot simultaneously demand visible labels");

  assert.match(source.snapshot.facts.find((fact)=>fact.type==="message").properties.text,/7\/10[\s\S]*2\/10[\s\S]*3\/10/);
  assert.match(source.snapshot.facts.find((fact)=>fact.type==="message").properties.text,/failed provider request[\s\S]*P0:[\s\S]*P1:[\s\S]*P2:/);
  assert.match(source.snapshot.facts.find((fact)=>fact.type==="message").properties.text,/storyteller-led and recipient-led delivery/);
  assert.match(source.frame.notes,/Your content\. One context\. Infinite paths to your target\./);
  assert.match(source.frame.image_prompt,/\.doc.*\.ppt.*\.mov.*\.mp3.*\.psd/);
  assert.match(source.frame.title,/7\/10/);
  assert.match(source.frame.body,/2\/10.*3\/10/);
});

test("compiles a coherent visual-only Ideogram prompt while retaining authored visual exclusions and source isolation",()=>{
  const{prepared}=preparedFrame();
  const adaptation=buildIdeogramPrompt(prepared.snapshot,prepared.direction,"",[],{
    quality:"low",size:prepared.size,ideogramCaptionStrategy:prepared.ideogramCaptionStrategy,
  });
  assert.equal(adaptation.valid,true,adaptation.issues.join("; "));
  assert.equal(adaptation.strategy,"compact_literal");
  assert.match(adaptation.prompt,/1536\s*[×x]\s*1024/);
  assert.match(adaptation.prompt,/MANDATORY PRIMARY SUBJECT AND ACTION:[^\n]*adult product designer/i);
  assert.match(adaptation.prompt,/COMPOSITION — LITERAL STRUCTURE:[^\n]*left-to-right/i);
  assert.match(adaptation.prompt,/EXCLUDE:[^\n]*(?:watermarks|logos|signatures|borders)/i);
  assert.match(adaptation.prompt,/TEXT: Do not render words, letters, numbers, labels/i);
  assert.match(adaptation.prompt,/No reference pixels are attached/i);
  assert.match(adaptation.prompt,/FINAL VISUAL CHECK:[^\n]*adult product designer/i);
  assert.doesNotMatch(adaptation.prompt,/TEXT — REQUIRED|PRIMARY SUCCESS TEST[^\n]*=\s*(?:;|\.)|FINAL READ:[^\n]*=\s*(?:;|\.)/);
  assert.doesNotMatch(adaptation.prompt,forbiddenProviderSource);
  assert.doesNotMatch(adaptation.prompt,/PRIVATE_RELATION_ID|feedback-message|feedback-private-reference/);
});

test("moderates the exact sanitized storyboard frame before one pixel-free paid submission and preserves landscape output",async()=>{
  const{source,prepared}=preparedFrame();
  const previousFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,init={})=>{
    const address=String(url);
    calls.push({url:address,body:init.body?JSON.parse(String(init.body)):null});
    if(address.endsWith("/moderations"))return Response.json({id:"storyboard-frame-moderation",model:"omni-moderation-latest",results:[{flagged:false,categories:{},category_scores:{}}]});
    if(address==="https://api.openai.com/v1/images/generations")return Response.json({data:[{b64_json:btoa("private-storyboard-frame")}],usage:{input_tokens:100,output_tokens:200,total_tokens:300}},{headers:{"x-request-id":"storyboard-frame-safe-1"}});
    throw new Error(`unexpected request ${address}`);
  };
  try{
    const result=await generateCreativeImage(
      {OPENAI_API_KEY:"storyboard-moderation-test-key",FAL_KEY:"storyboard-image-test-key",FORMA_IMAGE_PROVIDER:"fal-ideogram"},
      "storyboard-test-owner",prepared.snapshot,prepared.direction,
      {quality:"low",size:prepared.size,outputFormat:"jpeg",ideogramCaptionStrategy:prepared.ideogramCaptionStrategy},
    );
    assert.equal(result.provider,"openai");
    assert.equal(result.providerRequestId,"storyboard-frame-safe-1");
    assert.equal(result.width,1536);
    assert.equal(result.height,1024);
    assert.equal(result.usedReference,false);
    assert.equal(result.referenceCount,0);
    assert.equal(result.safetyProbeCount,1);
    assert.equal(result.safetyCoverage,"text");

    const moderation=calls.filter((call)=>call.url.endsWith("/moderations"));
    const submissions=calls.filter((call)=>call.url==="https://api.openai.com/v1/images/generations");
    assert.equal(moderation.length,1,"the sanitized exact image prompt still receives its required safety review");
    assert.equal(submissions.length,1,"one finished frame requires exactly one paid image submission");
    assert.ok(calls.indexOf(moderation[0])<calls.indexOf(submissions[0]),"moderation must complete before any paid provider submission");
    assert.equal(moderation[0].body.input.length,1);
    assert.equal(moderation[0].body.input[0].type,"text");
    assert.equal(moderation[0].body.input[0].text,submissions[0].body.prompt,"the safety probe and paid provider must receive the exact same sanitized prompt");
    assert.equal(submissions[0].body.size,"1536x1024");
    assert.equal(submissions[0].body.model,"gpt-image-2.5-flare");
    assert.equal("image_url" in submissions[0].body,false,"description-only sources must never transfer reference pixels");
    assert.doesNotMatch(JSON.stringify(submissions[0].body),forbiddenProviderSource);
    assert.match(source.frame.notes,/Your content\. One context\. Infinite paths to your target\./,"the display caption remains owned by the original storyboard plan");
  }finally{globalThis.fetch=previousFetch;}
});

test("a flagged sanitized storyboard frame never submits paid work or retries automatically",async()=>{
  const{prepared}=preparedFrame();
  const previousFetch=globalThis.fetch;
  let moderationCalls=0;
  let providerCalls=0;
  globalThis.fetch=async(url)=>{
    if(String(url).endsWith("/moderations")){
      moderationCalls+=1;
      return Response.json({id:"storyboard-flagged-moderation",model:"omni-moderation-latest",results:[{flagged:true,categories:{violence:true},category_scores:{violence:.91}}]});
    }
    providerCalls+=1;
    throw new Error("A flagged storyboard frame must never contact its paid provider.");
  };
  try{
    await assert.rejects(
      ()=>generateCreativeImage(
        {OPENAI_API_KEY:"storyboard-moderation-test-key",FAL_KEY:"storyboard-image-test-key",FORMA_IMAGE_PROVIDER:"fal-ideogram"},
        "storyboard-test-owner",prepared.snapshot,prepared.direction,
        {quality:"low",size:prepared.size,outputFormat:"jpeg",ideogramCaptionStrategy:prepared.ideogramCaptionStrategy},
      ),
      (error)=>error.detail.code==="safety_preflight_flagged"&&error.detail.retryable===false,
    );
    assert.equal(moderationCalls,1);
    assert.equal(providerCalls,0);
  }finally{globalThis.fetch=previousFetch;}
});

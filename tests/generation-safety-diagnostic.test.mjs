import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moderatePromptTechniqueSet } from "../worker/openai-moderation.ts";

test("compares four prompt techniques in one text probe and moderates each reference only once",async()=>{
  const originalFetch=globalThis.fetch;const inputs=[];
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,"https://api.openai.com/v1/moderations");
    const input=JSON.parse(String(init.body)).input;inputs.push(input);
    if(inputs.length===1)return Response.json({id:"modr_text",model:"omni-moderation-latest",results:[
      {flagged:true,categories:{violence:true},category_scores:{violence:.87}},
      {flagged:false,categories:{},category_scores:{}},
      {flagged:false,categories:{},category_scores:{}},
      {flagged:false,categories:{},category_scores:{}},
    ]},{headers:{"x-request-id":"req_text_batch"}});
    const flagged=inputs.length===3;
    return Response.json({id:`modr_image_${inputs.length-1}`,model:"omni-moderation-latest",results:[{flagged,categories:flagged?{violence:true}:{},category_scores:flagged?{violence:.92}:{}}]},{headers:{"x-request-id":`req_image_${inputs.length-1}`}});
  };
  try{
    const result=await moderatePromptTechniqueSet({OPENAI_API_KEY:"test-only"},[
      {technique:"prose",prompt:"Prose request"},
      {technique:"bullets",prompt:"- Bullet request"},
      {technique:"json",prompt:'{"prompt":"JSON request"}'},
      {technique:"xml",prompt:"<prompt>XML request</prompt>"},
    ],[
      {bytes:new TextEncoder().encode("first"),mimeType:"image/png",referenceId:"reference-1",source:"uploaded-reference"},
      {bytes:new TextEncoder().encode("second"),mimeType:"image/jpeg",referenceId:"reference-2",source:"uploaded-reference"},
    ]);
    assert.equal(inputs.length,3);
    assert.equal(inputs[0].length,4);
    assert.ok(inputs.slice(1).every((input)=>input.filter((item)=>item.type==="image_url").length===1));
    assert.equal(result.promptResults.length,4);
    assert.equal(result.promptResults[0].flagged,true);
    assert.equal(result.promptResults[1].flagged,false);
    assert.equal(result.textRequestId,"req_text_batch");
    assert.equal(result.references.flagged,true);
    assert.deepEqual(result.references.referenceIds,["reference-2"]);
    assert.equal(result.references.probeCount,2);
  }finally{globalThis.fetch=originalFetch;}
});

test("exposes a zero-image safety diagnostic with inspection and one-technique recovery",async()=>{
  const [api,actions,store,index,styles]=await Promise.all([
    readFile(new URL("../worker/generation-readiness.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/index.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/styles.css",import.meta.url),"utf8"),
  ]);
  assert.match(index,/\/api\/generation-readiness\//);
  assert.match(api,/path==="prompt-techniques"/);
  assert.match(api,/PROMPT_TECHNIQUES\.map/);
  assert.match(api,/moderatePromptTechniqueSet/);
  assert.match(api,/image_generation_calls: 0/);
  assert.match(api,/kind: "prompt_technique_comparison"/);
  assert.doesNotMatch(api,/generateCreativeImage/);
  assert.match(actions,/Test alternate prompt structures/);
  assert.match(actions,/makes no image-generation request/);
  assert.match(actions,/Inspect compiled prompt/);
  assert.match(actions,/Retry one with/);
  assert.match(actions,/Use as document default/);
  assert.match(store,/comparePromptTechniqueSafety/);
  assert.match(store,/retryDocumentGeneration\(job:DocumentJob,promptTechnique\?:PromptTechnique\)/);
  assert.match(styles,/\.generation-safety-results/);
  assert.match(styles,/grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
});

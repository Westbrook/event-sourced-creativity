import assert from 'node:assert/strict';
import test from 'node:test';
import { validModerationResults } from '../worker/moderation-response-validation.ts';
import { moderateExactImagePrompt, moderateGenerationSnapshot, moderatePromptTechniqueSet } from '../worker/openai-moderation.ts';
import { generateCreativeImage } from '../worker/openai-adapter.ts';
const result={flagged:false,categories:{violence:false},category_scores:{violence:0.01}};
const env={OPENAI_API_KEY:'offline-only'};
const withFetch=async(fetch,run)=>{const old=globalThis.fetch;globalThis.fetch=fetch;try{return await run();}finally{globalThis.fetch=old;}};
for(const [name,value] of [['error with results',{error:{code:'server_error'},results:[result]}],['missing',{}],['null',null],['empty',{results:[]}],['missing flag',{results:[{categories:{}}]}],['string flag',{results:[{flagged:'false',categories:{}}]}],['missing categories',{results:[{flagged:false}]}],['array categories',{results:[{flagged:false,categories:[]}]}],['bad category',{results:[{flagged:false,categories:{violence:'false'}}]}],['inconsistent flag',{results:[{flagged:false,categories:{violence:true}}]}],['out-of-range score',{results:[{...result,category_scores:{violence:2}}]}],['string score',{results:[{...result,category_scores:{violence:'0'}}]}],['excess results',{results:[result,result]}]])test(`${name} moderation result never passes or dispatches media`,async()=>{
  assert.equal(validModerationResults(value,1),false);let requests=0;const evidence=[];
  await withFetch(async()=>{requests++;return Response.json(value);},async()=>{
    await assert.rejects(()=>generateCreativeImage(env,'user',{facts:[]},{},{onEvidence:e=>evidence.push(e)}),e=>e.detail.code==='moderation_response_invalid');
  });assert.equal(requests,1);assert.equal(evidence.at(-1).safety.verdict,'unknown');assert.equal(evidence.at(-1).safety.validity,'invalid');
});
for(const raw of ['not JSON','{"results":[{"flagged":true,"flagged":false,"categories":{}}]}',JSON.stringify({results:[result],padding:'x'.repeat(65536)})])test('malformed, duplicate-key or oversized moderation does not pass',async()=>withFetch(async()=>new Response(raw),async()=>{
  await assert.rejects(()=>moderateExactImagePrompt(env,'exact',[]),e=>e.detail.code==='moderation_response_invalid');
}));
test('single checks allow absent scores as unknown, with a complete explicit flag/categories result',()=>{
  assert.equal(validModerationResults({results:[{flagged:false,categories:{}}]},1),true);
  assert.equal(validModerationResults({results:[result,result]},2),true);assert.equal(validModerationResults({results:[result]},2),false);
});
test('snapshot batch validates every expected diagnostic result',async()=>withFetch(async()=>Response.json({results:[result]}),async()=>{
  await assert.rejects(()=>moderateGenerationSnapshot(env,{facts:[{block_id:'a',properties:{text:'one fact'}}]}),e=>e.detail.code==='moderation_response_invalid');
}));
test('technique batch cardinality is not a single-result contract',async()=>{
  await withFetch(async()=>Response.json({results:[result]}),async()=>assert.rejects(()=>moderatePromptTechniqueSet(env,[{technique:'prose',prompt:'one'},{technique:'json',prompt:'two'}],[]),e=>e.detail.code==='moderation_response_invalid'));
  await withFetch(async()=>Response.json({results:[result,result]}),async()=>{const value=await moderatePromptTechniqueSet(env,[{technique:'prose',prompt:'one'},{technique:'json',prompt:'two'}],[]);assert.equal(value.promptResults.length,2);assert.ok(value.promptResults.every(value=>!value.flagged));});
});
test('Memory strict branch preserves mandatory signal, unique keys and single-result shape',async()=>{
  await withFetch(async()=>Response.json({results:[result]}),async()=>assert.rejects(()=>moderateExactImagePrompt(env,'prompt',[],undefined,true),/private_image_moderation_invalid/));
  for(const raw of ['{"results":[{"flagged":true,"flagged":false,"categories":{}}]}',JSON.stringify({results:[result,result]})])await withFetch(async()=>new Response(raw),async()=>assert.rejects(()=>moderateExactImagePrompt(env,'prompt',[],new AbortController().signal,true),/private_image_moderation_invalid/));
});
test('Memory private image retains bounded receipt before financial completion and rejects absent usage',async()=>{
  const order=[];const signal=new AbortController().signal;
  await withFetch(async url=>String(url).endsWith('/moderations')?Response.json({results:[result]}):Response.json({data:[{b64_json:btoa('image')}],usage:{input_tokens:1,output_tokens:2,total_tokens:3,input_tokens_details:{text_tokens:1,image_tokens:0}}}),async()=>{
    await generateCreativeImage(env,'user',{facts:[]},{},{signal,privateImageReceipt:{signal,onReceipt:async()=>order.push('private')},onProviderSubmission:()=>order.push('financial')});
  });assert.deepEqual(order,['private','financial']);
  await withFetch(async url=>String(url).endsWith('/moderations')?Response.json({results:[result]}):Response.json({data:[{b64_json:btoa('image')}]}),async()=>assert.rejects(()=>generateCreativeImage(env,'user',{facts:[]},{},{signal,privateImageReceipt:{signal,onReceipt:async()=>assert.fail('invalid usage must not be accepted')},onProviderSubmission:()=>assert.fail('missing usage cannot settle')}),e=>e.detail.code==='provider_usage_receipt_missing'));
});

test('oversized moderation has unknown full response hash, never an invented empty-body hash',async()=>{
  const evidence=[];await withFetch(async()=>new Response('x'.repeat(65537)),async()=>assert.rejects(()=>moderateExactImagePrompt(env,'exact',[],undefined,false,e=>evidence.push(e))));
  assert.equal(evidence.at(-1).operation.responseSha256,null);assert.equal(evidence.at(-1).responseBody,undefined);
});

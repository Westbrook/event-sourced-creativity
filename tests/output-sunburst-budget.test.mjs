import assert from 'node:assert/strict';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const {outputImageBudget}=await import('../worker/output-image-budget.ts');
const {generateCreativeImage}=await import('../worker/image-adapter.ts');
const {outputExactImageRender}=await import('../worker/output-document-execution.ts');
const model='gpt-image-2.5-sunburst';

// Golden high-quality outputs from the pinned official calculator, not this implementation.
// Asset SHA256 db420638507abf236e5535e83759631734d4b47837eb2edf1f53af2461b0d8fa.
const samples=[['1024x1024',1756],['1536x1024',1372],['1024x1536',1372],
 ['1024x1280',1510],['1280x1024',1510],['2048x1152',1413],['1152x2048',1413],
 ['1536x864',1078],['1536x912',1143],['1536x944',1201],['944x1536',1201],['1536x976',1260],
 ['640x1024',956],['1536x512',535],['3840x2160',3336],['2880x2880',5930]];

test('Sunburst high output estimate matches pinned vectors, exact JS half handling and existing allowances',()=>{
 for(const [size,tokens]of samples){
  const budget=outputImageBudget(model,size);assert.ok(budget,size);
  assert.equal(budget.estimatedOutputTokens,tokens,size);assert.equal(budget.maximumOutputTokens,tokens*2);
  assert.equal(budget.maximumInputTokens,32000+4096);assert.equal(budget.maximumMicrousd,(32000+4096)*5+tokens*2*30);
  assert.equal(budget.maximumPromptBytes,32000);assert.equal(budget.maximumReferenceImages,0);assert.equal(budget.quality,'high');
  assert.equal(budget.version,'gpt-image-2.5-sunburst-doc-calculator-2026-09-18');assert.equal(budget.calculatorSource.sha256,'db420638507abf236e5535e83759631734d4b47837eb2edf1f53af2461b0d8fa');assert.equal(budget.calculatorSource.qualityBase,48);
  assert.match(budget.allowanceDescription,/Provider receipts determine actual charges/);
 }
 for(const [width,height]of[[1,1],[3,2],[2,3],[4,5],[5,4],[16,9],[9,16]]){
  const render=outputExactImageRender({width,height});assert.ok(samples.some(([size])=>size===render.size),render.size);
 }
 assert.equal(outputImageBudget(model,'1024x1024',0).maximumInputTokens,4096);
 assert.equal(outputImageBudget(model,'1024x1024',17).maximumInputTokens,4113);
});

test('Sunburst keeps existing size/prompt boundaries and refuses unsupported model aliases or automatic size',()=>{
 for(const size of ['auto','624x1024','2912x2880','3856x1024','1536x496','1000x1024','0x1024','-1024x1024','NaNx1024'])assert.equal(outputImageBudget(model,size),null,size);
 for(const bytes of [-1,32001,1.5,NaN,Infinity])assert.equal(outputImageBudget(model,'1024x1024',bytes),null);
 for(const alias of ['gpt-image-2.5','gpt-image-2.5-flare','gpt-image-2.5-sunburst-2026-09-08','unknown'])assert.equal(outputImageBudget(alias,'1024x1024'),null,alias);
});

test('Image 2 calculation and historical provenance are unchanged',()=>{
 const square=outputImageBudget('gpt-image-2','1024x1024'),landscape=outputImageBudget('gpt-image-2','1536x1024');
 assert.equal(square.estimatedOutputTokens,7024);assert.equal(landscape.estimatedOutputTokens,5488);assert.equal(landscape.maximumMicrousd,509760);
 assert.equal(square.version,'gpt-image-2-doc-calculator-2026-08-27');assert.equal(Object.hasOwn(square,'calculatorSource'),false);
});

test('bounded Sunburst dispatch still refuses other qualities, reference pixels and partial outputs',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return Response.json({results:[{flagged:false,categories:{}}]});});
 for(const override of [{quality:'low'},{quality:'medium'},{quality:'auto'},{quality:'xhigh'},{quality:'max'},{partialImages:1},{references:[{bytes:new Uint8Array([1]),mimeType:'image/png',source:'uploaded-reference'}]}]){
  let attempts=0;
  await assert.rejects(generateCreativeImage({OPENAI_API_KEY:'synthetic-only',OPENAI_IMAGE_MODEL:model},'test',{}, {},{quality:'high',size:'1024x1024',preparedPrompt:'An orchard.',...override,onBeforeProviderAttempt:()=>{attempts++;}}),/output_image_request_outside_priced_contract/);
  assert.equal(attempts,0);
 }
 assert.ok(calls.length>0);assert.ok(calls.every(call=>call.url==='https://api.openai.com/v1/moderations'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProductionImageOperation as production, resolveExperimentImageOperation as experiment, validateImageExperimentCell as validate } from '../worker/image-operation-capabilities.ts';
const sunburst='gpt-image-2.5-sunburst', flare='gpt-image-2.5-flare';
const cell=(patch={})=>({model:sunburst,endpoint:'/v1/images/generations',referenceCount:0,settings:{quality:'high',size:'1536x1024',outputFormat:'png'},...patch});
test('effective routing honors each operation, not UI names or legacy final override',()=>{
 for(const imageProvider of ['openai','fal']) for(const openAIImageModel of ['gpt-image-2',sunburst]){
  const config={imageProvider,openAIImageModel,falConfigured:true};
  assert.equal(production(config,{quality:'low'}).model,flare);
  assert.equal(production(config,{quality:'low'}).provider,'openai');
  assert.equal(production(config,{quality:'high'}).provider,imageProvider);
 }
 assert.equal(production({falConfigured:false},{quality:'high'}).model,sunburst); // Private Memory preview is high.
 assert.equal(production({falConfigured:false,openAIImageModel:'gpt-image-2'},{quality:'medium'}).model,'gpt-image-2');
});
test('settings distinguish caller omission, explicit input, application defaults and wire omission',()=>{
 const omitted=production({falConfigured:false});
 assert.deepEqual(omitted.settings.quality.requested,{state:'omitted'});
 assert.deepEqual(omitted.settings.quality.sent,{state:'explicit',value:'high'});
 assert.deepEqual(omitted.settings.moderation.sent,{state:'omitted'});
 assert.equal(omitted.settings.moderation.effective,'auto');
 assert.equal(omitted.settings.stream.sent.state,'omitted');
 assert.equal(omitted.settings.outputCompression.effective,null);
 const explicit=production({falConfigured:false},{quality:'high',outputFormat:'jpeg',outputCompression:110.4,partialImages:2});
 assert.equal(explicit.settings.outputCompression.requested.value,110.4);
 assert.equal(explicit.settings.outputCompression.sent.value,100);
 assert.equal(explicit.settings.stream.sent.value,true);
 assert.equal(omitted.aliasResolution,'unknown'); assert.equal(omitted.modelSnapshot,null);
});
test('no/single/multiple references retain route factor and provider fallback',()=>{
 for(const count of [0,1,2]){
  const refs=Array.from({length:count},()=>({bytes:new Uint8Array([1]),mimeType:'image/png',source:'uploaded-reference'}));
  const result=production({falConfigured:false},{references:refs});
  assert.equal(result.endpoint,count?'/v1/images/edits':'/v1/images/generations'); assert.equal(result.referenceCount,count);
  const fal=production({falConfigured:true,imageProvider:'fal'},{references:refs});
  assert.equal(fal.provider,count>1?'openai':'fal');
 }
 assert.equal(production({falConfigured:true,imageProvider:'fal'},{outputFormat:'webp'}).provider,'openai');
 assert.equal(production({falConfigured:true,imageProvider:'fal'}).settings.outputFormat.effective,'jpeg');
});
test('fixed-model experiment disabled by default and does not mutate production config',()=>{
 assert.throws(()=>experiment(cell()),/disabled/);
 for(const model of [sunburst,flare,`${sunburst}-2026-09-08`,`${flare}-2026-09-08`]) for(const quality of ['low','medium','high']){
  const c=cell({model,enabled:true,settings:{quality,size:'1536x1024',outputFormat:'png'}});
  const before=JSON.stringify(c),plan=experiment(c);
  assert.equal(plan.model,model); assert.equal(plan.settings.quality.effective,quality);assert.equal(plan.liveDispatchAuthorized,false);assert.equal(JSON.stringify(c),before);
  assert.equal(plan.aliasResolution,model.endsWith('2026-09-08')?'pinned':'unknown');
 }
 assert.equal(production({falConfigured:false},{quality:'low'}).model,flare);
});
test('omitted experiment parameters stay omitted, explicit provider defaults remain explicit',()=>{
 const a=experiment(cell({enabled:true,settings:{}}));
 const b=experiment(cell({enabled:true,settings:{quality:'auto',moderation:'auto',stream:false}}));
 assert.equal(a.settings.quality.sent.state,'omitted'); assert.equal(a.settings.quality.effective,'auto');
 assert.equal(b.settings.quality.sent.state,'explicit');assert.equal(b.settings.stream.sent.value,false);
 const jpeg=experiment(cell({enabled:true,settings:{outputFormat:'jpeg'}}));
 assert.equal(jpeg.settings.outputCompression.sent.state,'omitted'); assert.equal(jpeg.settings.outputCompression.effective,100);
 assert.equal(validate(cell({settings:{inputFidelity:'high'}})).valid,false);
 assert.throws(()=>production({falConfigured:false},{outputFalImage:{}}),/native_output_requires/);
});
test('reject unsupported cells before a mocked submission boundary',async()=>{
 let calls=0;
 const submit=async c=>{const plan=experiment({...c,enabled:true});calls++;return plan;};
 for(const c of [cell({model:'chatgpt-image-latest'}),cell({model:'gpt-image-2'}),cell({referenceCount:1}),cell({endpoint:'/v1/images/edits'}),cell({referenceCount:17}),cell({referenceCount:NaN}),cell({settings:{quality:'xhigh'}}),cell({settings:{quality:'max'}}),cell({settings:{quality:'standard'}}),cell({settings:{size:'1536x864'}}),cell({settings:{outputFormat:'gif'}}),cell({settings:{outputFormat:'jpeg',background:'transparent'}}),cell({settings:{outputCompression:100}}),cell({settings:{moderation:'low'}}),cell({settings:{stream:true,partialImages:1}}),cell({settings:{partialImages:1}}),cell({endpoint:'/v1/responses',mainlineModel:'gpt-6-astra'})]){
  assert.equal(validate(c).valid,false);await assert.rejects(submit(c),/invalid/);
 }
 assert.equal(calls,0);
});
test('optional low moderation requires explicit benign policy study with no refusal fallback',()=>{
 const settings={moderation:'low'};
 assert.equal(validate(cell({settings,policyExperiment:{id:'E8-benign-v1',benignCorpus:true,automaticRefusalFallback:false}})).valid,true);
 for(const automaticRefusalFallback of [true,undefined])assert.equal(validate(cell({settings,policyExperiment:{id:'E8',benignCorpus:true,automaticRefusalFallback}})).valid,false);
});

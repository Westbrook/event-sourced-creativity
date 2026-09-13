import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createStoryboardOutputContract,parseStoryboardOutputContract} from '../src/model/output-storyboard-contract.ts';
import {captureOutputStoryboardPlan,outputStoryboardFrameDirection,outputStoryboardFrameBinding} from '../worker/output-storyboard-plan.ts';

const contract=()=>createStoryboardOutputContract({draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)});
const plan=()=>({title:'The lantern',summary:'An authored journey',content_markdown:'Four moments retained in order.\n灯笼 · فانوس',presentation:null,
 items:['A keeper opens the door.','The keeper finds a lantern.','The keeper carries it home.','The keeper sets it by the window.'].map((body,index)=>({title:'Moment '+(index+1),body,notes:'Keep the same person and lantern.',image_prompt:'  '+body+' Natural harbor setting.\n<svg>Literal direction</svg>  ',slide:null,context_group_ids:[]}))});
const originalFetch=globalThis.fetch;let network=0;
globalThis.fetch=()=>{network++;throw Error('network forbidden');};
test.after(()=>{globalThis.fetch=originalFetch;assert.equal(network,0);});

test('array capture never consults inherited map or subclass mapping behavior',async()=>{
 let calls=0;
 const inherited=Object.create(Array.prototype,{map:{value(){calls++;return [];}}});
 class ReorderingArray extends Array {map(){calls++;return [...this].reverse();}}
 for(const kind of ['inherited','subclass']){
  const original=plan(),before=structuredClone(original);
  if(kind==='inherited')Object.setPrototypeOf(original.items,inherited);
  else original.items=ReorderingArray.from(original.items);
  const captured=await captureOutputStoryboardPlan(original,contract(),'original-response');
  assert.deepEqual(captured.plan,before);assert.equal(captured.plan.items.length,4);assert.equal(calls,0);
  original.items[0].image_prompt='';await assert.rejects(captureOutputStoryboardPlan(original,contract(),'original-response'),/output_storyboard_plan_invalid/);
 }
});

test('source-bound fixed intent is exact and does not assert authorization or a generated result',()=>{
 const c=contract();assert.equal(c.frameCount,4);assert.equal(c.maximumPlanningCalls,1);assert.equal(c.maximumFrameCalls,4);
 assert.deepEqual(parseStoryboardOutputContract(structuredClone(c)),c);assert(Object.isFrozen(c.source));
 for(const changed of [{frameCount:3},{maximumPlanningCalls:2},{maximumFrameCalls:5},{grantId:'invented'},{productionMode:'managed'},{source:{...c.source,requestHash:'edited'}}])assert.equal(parseStoryboardOutputContract({...c,...changed}),null);
 for(const key of ['confirmed','grantId','jobId','images','frames'])assert.equal(Object.hasOwn(c,key),false);
 let reads=0;const trapped={...c};Object.defineProperty(trapped,'frameCount',{enumerable:true,get(){reads++;return 4;}});
 assert.equal(parseStoryboardOutputContract(trapped),null);assert.equal(reads,0);
});

test('four records are copied before await and preserve exact text/order, with no generic fallback',async()=>{
 const p=plan(),before=structuredClone(p);const pending=captureOutputStoryboardPlan(p,contract(),'original-response');
 p.items[0].image_prompt='Changed after capture';p.items.reverse();const c=await pending;
 assert.deepEqual(c.plan,before);assert(Object.isFrozen(c.plan.items[0]));assert.equal(c.raw,JSON.stringify(before));
 for(let index=0;index<4;index++){
  const direction=outputStoryboardFrameDirection(c,index);assert.equal(direction.scene,before.items[index].image_prompt);
  assert.equal(direction.title,before.items[index].title);assert.equal(direction.rationale,before.items[index].notes);
  assert.deepEqual(direction.palette,[]);assert(!direction.scene.includes('abstract shapes'));
 }
 assert.throws(()=>outputStoryboardFrameDirection(structuredClone(c),0),/output_storyboard_plan_invalid/);
 for(const index of [-1,4,0.5,NaN])assert.throws(()=>outputStoryboardFrameDirection(c,index),/output_storyboard_plan_invalid/);
});

test('malformed or missing planner frames fail explicitly; no coercion, getter, padding or alternate media',async()=>{
 const mutations=[p=>p.items.pop(),p=>p.items.push(p.items[0]),p=>p.items=[],p=>delete p.items[1],p=>p.items[0].image_prompt='',p=>p.items[0].image_prompt='  ',p=>p.items[0].body='',p=>p.items[0].title='',p=>p.items[0].slide={},p=>p.items[0].context_group_ids=['foreign'],p=>p.items[0].image_prompt=3,p=>p.items[0].media_url='/api/media/forged',p=>p.presentation={},p=>p.audio_revision={},p=>p.items[0].image_prompt='x'.repeat(8193),p=>p.content_markdown='x'.repeat(65537)];
 for(const mutate of mutations){const p=plan();mutate(p);await assert.rejects(captureOutputStoryboardPlan(p,contract(),'original-response'),/output_storyboard_plan_invalid/);}
 let reads=0;const p=plan();Object.defineProperty(p.items[1],'image_prompt',{enumerable:true,get(){reads++;return 'invented';}});
 await assert.rejects(captureOutputStoryboardPlan(p,contract(),'original-response'),/output_storyboard_plan_invalid/);assert.equal(reads,0);
});

test('per-frame digest binds exact source, planner response, all four records, ordinal and adapted request',async()=>{
 const c=await captureOutputStoryboardPlan(plan(),contract(),'original-response'),request='f'.repeat(64);
 const first=await outputStoryboardFrameBinding(c,0,request);assert.equal(first.stage,'image:frame:1');assert.equal(first.frameIndex,0);
 const all=await Promise.all([0,1,2,3].map(index=>outputStoryboardFrameBinding(c,index,request)));assert.equal(new Set(all.map(x=>x.requestDigest)).size,4);
 assert.deepEqual(await outputStoryboardFrameBinding(await captureOutputStoryboardPlan(plan(),contract(),'original-response'),0,request),first);
 const changedPlan=plan();changedPlan.items[3].notes+=' Changed';
 for(const altered of [await captureOutputStoryboardPlan(changedPlan,contract(),'original-response'),await captureOutputStoryboardPlan(plan(),{...contract(),source:{...contract().source,sourceBindingHash:'sha256:'+'f'.repeat(64)}},'original-response'),await captureOutputStoryboardPlan(plan(),contract(),'different-response')])assert.notEqual((await outputStoryboardFrameBinding(altered,0,request)).requestDigest,first.requestDigest);
 assert.notEqual((await outputStoryboardFrameBinding(c,0,'a'.repeat(64))).requestDigest,first.requestDigest);
 await assert.rejects(outputStoryboardFrameBinding(c,0,'bad'),/output_storyboard_plan_invalid/);
});

test('actual events-handler native contract gate refuses injected, wrong-count and managed shapes before provider work',async()=>{
 const source=readFileSync(new URL('../worker/events-api.ts',import.meta.url),'utf8');
 const start=source.indexOf('      const nativeStoryboard=');const end=source.indexOf('\n      if(artifactKind==="scene"',start);assert(start>0&&end>start);
 const gate=new Function('execution','artifactKind','body','parseStoryboardOutputContract','Response',source.slice(start,end));
 const settings={outputStoryboard:contract()};
 const retainStoryboardFrameRequest=async()=>{throw Error('Shape gate must not invoke checkpoint hook');};
 assert.equal(gate({output:{settings,retainStoryboardFrameRequest}},'storyboard',{productionMode:'manual',itemCount:4},parseStoryboardOutputContract,Response),undefined,'Gate pass is shape-only, not admission');
 const missingHook=gate({output:{settings}},'storyboard',{productionMode:'manual',itemCount:4},parseStoryboardOutputContract,Response);
 assert.equal(missingHook.status,422);assert.equal((await missingHook.json()).error,'output_storyboard_contract_unsupported');
 for(const [execution,kind,body]of [[undefined,'storyboard',{outputStoryboard:contract()}],[{output:{settings:{}}},'storyboard',{productionMode:'manual',itemCount:4}],[{output:{settings}},'storyboard',{productionMode:'managed',itemCount:4}],[{output:{settings}},'storyboard',{productionMode:'manual',itemCount:3}],[{output:{settings}},'storyboard',{productionMode:'manual',itemCount:'4'}],[{output:{settings}},'storyboard',{productionMode:'manual',itemCount:4,storyboardSafeRecovery:{}}]]){
  const response=gate(execution?{...execution,output:{...execution.output,retainStoryboardFrameRequest}}:execution,kind,body,parseStoryboardOutputContract,Response);assert.equal(response.status,422);assert.equal((await response.json()).error,'output_storyboard_contract_unsupported');
 }
 assert.equal(gate(undefined,'storyboard',{productionMode:'manual',itemCount:6},parseStoryboardOutputContract,Response),undefined,'Legacy path unchanged');
 assert(source.includes('plan=nativeStoryboardPlan.plan;'));
 assert(source.includes('direction:outputStoryboardFrameDirection(nativeStoryboardPlan,index)'));
 assert(source.indexOf('captureOutputStoryboardPlan(plan,nativeStoryboard,plannerResponseId)')<source.indexOf('for(let index=renderedItems.length;index<plan.items.length;index+=1)'));
});

test('actual post-planner receipt join requires exactly one matching completed response before frame capture is used',async()=>{
 const source=readFileSync(new URL('../worker/events-api.ts',import.meta.url),'utf8');
 const start=source.indexOf('        const nativeStoryboardPlan=');const end=source.indexOf('        let sceneCompletionReceipt:',start);assert(start>0&&end>start);
 const selected=stripTypeScriptTypes('async function selected(plan,nativeStoryboard,plannerResponseId,plannerModel,body,providerSubmissions,captureOutputStoryboardPlan){'+source.slice(start,end)+'return plan;}');
 const run=new Function('return '+selected)();
 const original={operation:'planning',status:'completed',provider:'openai',providerRequestId:'original-response',model:'selected-planner'};
 const invoke=receipts=>run(plan(),contract(),'original-response','selected-planner',{},()=>receipts,captureOutputStoryboardPlan);
 assert.deepEqual(await invoke([original]),plan(),'Source-extracted association only, not real receipt admission');
 for(const receipts of [[],[original,original],[{...original,status:'pending'}],[{...original,provider:'fal'}],[{...original,providerRequestId:'foreign'}],[{...original,model:'different'}]])await assert.rejects(invoke(receipts),/output_storyboard_planner_receipt_unavailable/);
});

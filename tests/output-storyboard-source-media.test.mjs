import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
const C=process.env.FORMA_SOURCE_ROOT;if(!C)throw Error('FORMA_SOURCE_ROOT required');
const {registerOutputSourceImports,outputTestDatabase}=await import(C+'/tests/output-execution-test-helpers.mjs');registerOutputSourceImports();
registerHooks({resolve(specifier,context,next){
 if(!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.includes(':'))return next(specifier,{...context,parentURL:new URL('file://'+C+'/worker/openai-adapter.ts').href});
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const normal=new URL(/\.[a-z0-9]+$/iu.test(specifier)?specifier:specifier+'.ts',context.parentURL);if(!existsSync(normal)&&normal.pathname.includes('/src/experiences/'))return next(new URL('file://'+C+'/src/experiences/'+normal.pathname.split('/src/experiences/')[1]).href,context);}
 return next(specifier,context);
}});
const {createStoryboardOutputContract}=await import('../src/model/output-storyboard-contract.ts');
const {createExperienceOutputRecipe,matchExperienceOutputRecipeTarget}=await import('../worker/experience-output-recipe.ts');
const {inspectOutputRequirement}=await import('../src/model/output-requirements.ts');
const {compileOutputPlan}=await import('../src/model/output-plan.ts');
const {outputStoryboardPreparationIdentity,resolveOutputStoryboardSource}=await import('../worker/output-storyboard-source.ts');
const {readOutputStoryboardFrameMedia}=await import('../worker/output-storyboard-media.ts');
const {storyboardPlanningSnapshot}=await import('../worker/output-storyboard-preflight.ts');
const {storeGeneratedImage}=await import(C+'/worker/media-api.ts');
const {png}=await import(C+'/tests/output-asset-fixtures.mjs');
const {outputAssetSha256}=await import(C+'/src/model/output-asset-inspection.ts');
const contract=()=>createStoryboardOutputContract({draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)});
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});
test('Storyboard is one same-Document four-frame collection, never four independent jobs or an invented authored segmentation',()=>{
 const recipe=createExperienceOutputRecipe({output:'storyboard',requirementId:'requirement',deliverableId:'deliverable',contract:contract()});
 assert.equal(inspectOutputRequirement(recipe.spec).status,'valid');assert.equal(recipe.spec.deliverables[0].quantity.value,1);assert.equal(recipe.spec.deliverables[0].storyboard_contract.frameCount,4);
 const plan=compileOutputPlan([recipe.spec],{document_id:'doc',source_revision:'source',requirement_revision:'requirements'});
 assert.equal(plan.targets.length,1);assert.equal(matchExperienceOutputRecipeTarget(recipe,plan,{documentId:'doc',sourceRevision:'source',requirementRevision:'requirements'}).id,recipe.targetId);
 assert(!JSON.stringify(recipe).includes('confirmed'));assert(!recipe.spec.original_text.includes('newline'));
 for(const mutate of [d=>d.quantity.value=4,d=>d.media_kind='image',d=>d.storyboard_contract.frameCount=3,d=>d.audio_contract={},d=>d.scene_contract={},d=>d.narrative_contract={},d=>d.format_variants=[]]){
  const changed=structuredClone(recipe.spec);mutate(changed.deliverables[0]);assert.notEqual(inspectOutputRequirement(changed).status,'valid');
 }
});
test('original preparation identity retains confirmed time; current source checks cannot manufacture a new lifetime',async()=>{
 const plan={revisionId:'revision',confirmedAt:'2026-09-13T00:00:00.000Z'},a=await outputStoryboardPreparationIdentity(contract(),plan,'target');
 assert.equal(a.expiresAt,'2026-09-13T00:15:00.000Z');assert.deepEqual(await outputStoryboardPreparationIdentity(contract(),plan,'target'),a);
 assert.notEqual((await outputStoryboardPreparationIdentity(contract(),plan,'different')).requestId,a.requestId);
 assert.equal(await outputStoryboardPreparationIdentity(contract(),{...plan,confirmedAt:'invalid'},'target'),null);
 await assert.rejects(resolveOutputStoryboardSource({scope:{kind:'personal'},principal:{},target:{storyboard_contract:contract()}}));
});
test('planner snapshot retains actual Document title and supplied constraints without scene splitting',()=>{
 const snapshot={document:{id:'old',title:'old'},facts:[{type:'subject',instruction:'An arbitrary story. No newline convention.'}],standing_constraints:[{preference_id:'constraint',axis:'style',value:'charcoal',polarity:'positive'}]};
 const mapped=storyboardPlanningSnapshot(snapshot,{documentId:'doc',documentTitle:'Original title'},[]);assert.deepEqual(mapped.document,{id:'doc',title:'Original title'});assert.deepEqual(mapped.facts,snapshot.facts);assert.deepEqual(mapped.standing_constraints,snapshot.standing_constraints);assert.notEqual(mapped,snapshot);
});
async function frameFixture(index=0,bytes=png({width:1536,height:1024})){
 const f=outputTestDatabase(),artifactId='artifact-original',id=artifactId+'-frame-'+(index+1),binding='f'.repeat(64),providerRequestId='provider-'+index,clientRequestId='client-'+index;
 const stored=await storeGeneratedImage(f.env,'owner',id,bytes,'ideogram/v4','image/png',{artifactRole:'storyboard-frame',artifactId,provider:'fal',providerRequestId,providerSubmissionId:clientRequestId,storyboardFrameIndex:String(index),storyboardBindingSha256:binding});
 return{...f,artifactId,binding,index,stored,frame:{id,media_url:stored.url,media_type:'image/png',width:1536,height:1024,provider:'fal',provider_request_id:providerRequestId,provider_submission_id:clientRequestId,provider_model:'ideogram/v4',source_content_hash:stored.contentHash}};
}
test('all four actual stored private PNG objects read back with exact frame/receipt/hash identity; fixtures are not generated output',async()=>{
 for(let index=0;index<4;index++){const f=await frameFixture(index);try{const r=await readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,index,f.frame,f.binding);assert.equal(r.frameIndex,index);assert.equal(r.sha256,f.stored.contentHash);assert.equal(r.clientRequestId,'client-'+index);}finally{f.sqlite.close();}}
});
test('private frame rejects edited metadata, foreign URLs/receipts, deleted or changed bytes and wrong geometry',async()=>{
 const f=await frameFixture();try{
  const object=f.media.get(f.stored.key),original=structuredClone(object);
  for(const key of ['ownerId','artifactId','generationId','artifactRole','source','provider','model','providerRequestId','providerSubmissionId','storyboardFrameIndex','storyboardBindingSha256','sha256','mimeType']){
   object.metadata[key]='foreign';await assert.rejects(readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,f.frame,f.binding),/private_frame/);object.metadata=structuredClone(original.metadata);
  }
  for(const field of ['media_url','id','provider_request_id','provider_submission_id','source_content_hash'])await assert.rejects(readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,{...f.frame,[field]:'foreign'},f.binding),/private_frame/);
  object.bytes=new Uint8Array([1,2,3]);await assert.rejects(readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,f.frame,f.binding));object.bytes=original.bytes;
  f.media.delete(f.stored.key);await assert.rejects(readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,f.frame,f.binding));
 }finally{f.sqlite.close();}
 const wrong=await frameFixture(0,png({width:1024,height:1024}));try{assert.equal(wrong.frame.source_content_hash,await outputAssetSha256(wrong.media.get(wrong.stored.key).bytes));await assert.rejects(readOutputStoryboardFrameMedia(wrong.env,'owner',wrong.artifactId,0,wrong.frame,wrong.binding));}finally{wrong.sqlite.close();}
});
test('private readback bounds pending/late acquisition and disposes a late stream without awaiting cancellation', {timeout:3000},async()=>{
 for(const mode of ['never','late','late-rejection']){
  const f=await frameFixture();try{
   const abort=new AbortController(),base=await f.env.MEDIA.get(f.stored.key);let resolve,reject,cancelled=0;
   const stream=new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}});
   f.env.MEDIA.get=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});
   const result=readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,f.frame,f.binding,{signal:abort.signal});abort.abort();await assert.rejects(result,/private_frame/);
   if(mode==='late'){resolve({...base,body:stream});await new Promise(setImmediate);assert.equal(cancelled,1);assert.equal(stream.locked,false);}
   if(mode==='late-rejection'){reject(Error('late read failure'));await new Promise(setImmediate);}
  }finally{f.sqlite.close();}
 }
});
test('private stream bounds actual bytes, stalled reads, empty/tiny work and cancellation while preserving no-result semantics', {timeout:3000},async()=>{
 for(const mode of ['stalled','oversized','empty','tiny','cancel-rejection','deadline']){
  const f=await frameFixture();try{
   const abort=new AbortController(),base=await f.env.MEDIA.get(f.stored.key);let pulls=0,cancelled=0;
   const stream=new ReadableStream({pull(c){pulls++;if(mode==='stalled'||mode==='deadline'){if(mode==='stalled')setImmediate(()=>abort.abort());return new Promise(()=>{});}
    c.enqueue(mode==='empty'?new Uint8Array():mode==='tiny'?Uint8Array.of(1):new Uint8Array(base.size+1));
   },cancel(){cancelled++;return mode==='cancel-rejection'?Promise.reject(Error('cancel failed')):new Promise(()=>{});}});
   f.env.MEDIA.get=async()=>({...base,size:mode==='tiny'?24000000:base.size,body:stream});
   await assert.rejects(readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,f.frame,f.binding,{signal:abort.signal,...(mode==='deadline'?{deadlineMs:Date.now()+10}:{})}),/private_frame/);
   assert.equal(cancelled,1);assert.equal(stream.locked,false);assert(pulls<=8193);
  }finally{f.sqlite.close();}
 }
});
test('completed bytes cannot qualify after the caller deadline; real events readback passes its execution signal',async()=>{
 const f=await frameFixture();try{
  let gets=0;const get=f.env.MEDIA.get;f.env.MEDIA.get=async key=>{gets++;return get(key);};
  await assert.rejects(readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,f.frame,f.binding,{deadlineMs:Date.now()-1}),/private_frame/);assert.equal(gets,0);
  const abort=new AbortController();let hashReads=0;
  const frame={...f.frame};Object.defineProperty(frame,'source_content_hash',{get(){if(++hashReads===3)abort.abort();return f.frame.source_content_hash;}});
  await assert.rejects(readOutputStoryboardFrameMedia(f.env,'owner',f.artifactId,0,frame,f.binding,{signal:abort.signal}),/private_frame/);assert.equal(hashReads,3);
  const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../worker/events-api.ts',import.meta.url),'utf8');
  assert.match(source,/readOutputStoryboardFrameMedia\([^\n]+nativeStoryboardPlan.bindingSha256,\{signal:execution\?\.signal,deadlineMs:execution\?\.output\?\.storyboardMediaDeadlineMs\?\.\(\)\?\?0\}\)/u);
 }finally{f.sqlite.close();}
});

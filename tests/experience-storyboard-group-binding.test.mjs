import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const C=process.env.FORMA_SOURCE_ROOT;if(!C)throw Error('FORMA_SOURCE_ROOT required');
const {createStoryboardOutputContract}=await import(C+'/src/model/output-storyboard-contract.ts');
const {ownerMediaNamespace}=await import(C+'/src/model/media-ownership.ts');
const {captureOutputStoryboardPlan}=await import(C+'/worker/output-storyboard-plan.ts');
const {captureExperienceStoryboardEvidence,verifyExperienceStoryboardRead}=await import(C+'/src/experiences/storyboard-native-result.ts');
const sha=value=>createHash('sha256').update(value).digest('hex');
const previousFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=previousFetch;});
// Parser parity only: these synthetic objects do not mint authorization or
// replace the hosted retained reader's source, ledger, media and custody proof.
async function fixture(groups){
 const source={draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)};
 const contract=createStoryboardOutputContract(source),content={title:'Lantern',summary:'Home',content_markdown:'The lantern returns.',presentation:null,
  items:groups.map((ids,index)=>({title:'Frame '+index,body:'Exact body '+index,notes:'Exact notes',image_prompt:'Lantern '+index,slide:null,...(ids===undefined?{}:{context_group_ids:ids})}))};
 const requestBody=JSON.stringify({input:JSON.stringify({storyboard_contract:contract,combined_context_plan:[{context_key:'context_group_1'},{context_key:'context_group_2'}]})});
 const plan=await captureOutputStoryboardPlan(content,contract,'planner-original',requestBody);
 const receipt={version:'output-storyboard-completion-v1',contract,jobId:'job',slotId:'slot',artifactId:'artifact',actorUserId:'owner',documentId:'doc',streamId:'creative:owner',correlationId:'corr',attempt:1,grantId:'grant',targetId:'target',planRevisionId:'revision',targetContractDigest:'target-digest',sourceDigest:'source-digest',plannerRequestDigest:sha(requestBody),plannerResponseId:'planner-original',planSha256:plan.planSha256,storyboardBindingSha256:plan.bindingSha256,frameCount:4,
  frames:Array.from({length:4},(_,index)=>({frameIndex:index,id:'artifact-frame-'+(index+1),mediaUrl:'/api/media/'+encodeURIComponent(ownerMediaNamespace('owner')+'/generated/artifact-frame-'+(index+1)+'.png'),sha256:'1'.repeat(64),byteLength:99,width:1536,height:1024,mimeType:'image/png',provider:'fal',model:'ideogram/v4',clientRequestId:'client-'+index,providerRequestId:'provider-'+index,storyboardBindingSha256:plan.bindingSha256})),providerCallCount:5,visualReview:'required'};
 const input={schema_version:1,artifact_kind:'storyboard',document_id:'doc',project_id:'project',artifact_id:'artifact',request:{source_surface:'outputs',production_mode:'manual',item_count:4},planner:{provider:'openai',response_id:'planner-original'},output_storyboard:receipt};
 const expected={source,documentId:'doc',projectId:'project',artifactId:'artifact',ownerId:'owner',jobId:'job',slotId:'slot',grantId:'grant',targetId:'target',planRevisionId:'revision',targetContractDigest:'target-digest',sourceDigest:'source-digest',correlationId:'corr'};
 const now=Date.now(),dto={kind:'native-retained-output',schemaVersion:1,output:'storyboard',title:plan.plan.title,expiresAt:new Date(now+60000).toISOString(),selection:{documentId:'doc',artifactId:'artifact',revision:0,contentSha256:plan.planSha256},content:{frames:plan.plan.items.map((item,index)=>({id:receipt.frames[index].id,title:item.title,body:item.body,notes:item.notes,imagePrompt:item.image_prompt,image:{url:receipt.frames[index].mediaUrl,mediaType:'image/png',width:1536,height:1024}}))}};
 const evidence=()=>captureExperienceStoryboardEvidence({output_storyboard:receipt,storyboard_content_sha256:plan.planSha256,storyboard_input_sha256:sha(JSON.stringify(input))});
 return{plan,receipt,input,dto,expected,now,evidence,verify:(raw=plan.raw)=>verifyExperienceStoryboardRead(evidence(),raw,JSON.stringify(input),dto,expected,now)};
}
test('client agrees with actual server binding for ordered, mixed, empty and omitted context aliases',async()=>{
 for(const groups of [[['context_group_2','context_group_1'],['context_group_1'],['context_group_2'],['context_group_1']], [[],undefined,['context_group_2'],[]], [[],[],[],[]], [undefined,undefined,undefined,undefined]]){
  const f=await fixture(groups),before=f.plan.raw;
  assert.equal(await f.verify(),true,JSON.stringify(groups));
  assert.equal(f.plan.raw,before);assert.deepEqual(f.plan.plan.items.map(item=>item.context_group_ids),groups);
  const legacy=sha(JSON.stringify({contract:f.receipt.contract,plannerResponseId:f.receipt.plannerResponseId,planSha256:f.receipt.planSha256}));
  assert.equal(f.plan.bindingSha256===legacy,!groups.some(ids=>ids?.length));
 }
});
test('nonempty aliases require the exact planner request digest, with no legacy-hash fallback',async()=>{
 for(const mutation of ['digest','legacy','alias-order','remove-aliases']){
  const f=await fixture([['context_group_2','context_group_1'],[],[],[]]);let raw=f.plan.raw;
  if(mutation==='digest')f.receipt.plannerRequestDigest='0'.repeat(64);
  if(mutation==='legacy'){
   f.receipt.storyboardBindingSha256=sha(JSON.stringify({contract:f.receipt.contract,plannerResponseId:f.receipt.plannerResponseId,planSha256:f.receipt.planSha256}));
   for(const frame of f.receipt.frames)frame.storyboardBindingSha256=f.receipt.storyboardBindingSha256;
  }
  if(mutation==='alias-order'||mutation==='remove-aliases'){
   const changed=JSON.parse(raw);changed.items[0].context_group_ids=mutation==='alias-order'?['context_group_1','context_group_2']:[];raw=JSON.stringify(changed);
  }
  assert.equal(await f.verify(raw),false,mutation);
 }
});

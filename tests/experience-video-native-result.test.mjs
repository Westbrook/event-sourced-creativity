import assert from 'node:assert/strict';
import test from 'node:test';
import {videoRetainedFixture} from './output-video-retained-fixture.mjs';
const {projectNativeRetainedOutput}=await import('../src/model/native-retained-output.ts');
const {captureExperienceVideoEvidence,verifyExperienceVideoRead,captureExperienceVideoTarget}=await import('../src/experiences/video-native-result.ts');
const {captureExperienceNativeResult}=await import('../src/experiences/native-result-association.ts');
const {createExperienceOutputRecipe}=await import('../worker/experience-output-recipe.ts');
const {compileOutputPlan}=await import('../src/model/output-plan.ts');
const {parseExperienceHostRoute,experienceHostRoute}=await import('../src/experiences/host-route.ts');
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});
async function fixture(){
 const f=await videoRetainedFixture(),receipt=f.payload.settings.output_video;
 const selection={documentId:'doc',artifactId:f.artifactId,revision:0,contentSha256:f.payload.settings.video_content_sha256};
 const dto=projectNativeRetainedOutput({output:'video',selection},f.artifact,f.job.expires_at,null,{videoReceipt:f.payload});assert(dto);
 const rawInput=f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='input'").get().content;
 const expected={contract:f.contract,documentId:'doc',projectId:'project',artifactId:f.artifactId,ownerId:'owner',jobId:'job',slotId:'slot',grantId:'grant',targetId:'target',planRevisionId:'plan',targetContractDigest:'target-contract',sourceDigest:'source',correlationId:'corr'};
 const identity={output:'video',documentId:'doc',projectId:'project',ownerUserId:'owner',jobId:'job',correlationId:'corr',expiresAt:f.job.expires_at};
 Object.assign(f.payload,{content_expires_at:f.job.expires_at,input_expires_at:f.job.expires_at,planner_model_id:'gpt-5.6-terra',planner_response_id:receipt.plannerResponseId});
 const artifact={id:f.artifactId,documentId:'doc',kind:'video',itemCount:1,sourceEventId:'completion',sourceSurface:'outputs',contentRef:'content',inputRef:'input',mediaUrl:f.payload.media_url,settings:structuredClone(f.payload.settings)};
 const current={documentId:'doc',projectId:'project',documents:[{id:'doc',projectId:'project',removed:false}],outputs:[],artifacts:[artifact],events:[{type:'DocumentRenderCompleted',eventId:'completion',correlationId:'corr',streamId:'creative:owner',actor:'worker:renderer',payload:f.payload}]};
 const job={jobId:'job',documentId:'doc',sourceSurface:'outputs',kind:'render_document',status:'completed',result:JSON.parse(f.job.result_json)};
 return {...f,receipt,dto,rawInput,expected,identity,current,publicJob:job};
}
test('client associates original Video completion and verifies the real projected DTO and private input',async()=>{
 const f=await fixture();try{
  const candidate=captureExperienceNativeResult(f.identity,f.publicJob,f.current);assert(candidate);assert.equal(candidate.output,'video');assert(Object.isFrozen(candidate.video.receipt.media));
  assert.equal(await verifyExperienceVideoRead(candidate.video,f.input.rawContent,f.rawInput,f.dto,f.expected),true);
  const route=experienceHostRoute('/document/doc?progress-report','video',f.contract.source.draftId);assert.equal(parseExperienceHostRoute(route).output,'video');
  const recipe=createExperienceOutputRecipe({output:'video',requirementId:'requirement',deliverableId:'deliverable',contract:f.contract});
  const compiled=compileOutputPlan([recipe.spec],{document_id:'doc',source_revision:'source',requirement_revision:'requirements'});
  assert.deepEqual(compiled.issues,[]);const target=compiled.targets[0];
  assert.deepEqual(captureExperienceVideoTarget(target,f.contract),f.contract);
 }finally{f.sqlite.close();}
});
test('Video display evidence rejects tampering and accessors without fetching media or granting authority',async()=>{
 const f=await fixture();try{let reads=0;
  for(const mutate of [s=>s.output_video.media.model='other',s=>s.output_video.media.width=1280,s=>s.output_video.media.audioTracks=1,s=>s.output_video.providerCallCount=3,s=>s.output_video.media.mediaUrl='/api/media/other',s=>s.output_video.extra=true,s=>Object.defineProperty(s.output_video,'media',{enumerable:true,get(){reads++;throw Error('getter');}})]){const s=structuredClone(f.payload.settings);mutate(s);assert.equal(captureExperienceVideoEvidence(s),null);}
  assert.equal(reads,0);const evidence=captureExperienceVideoEvidence(f.payload.settings);assert(evidence);
  for(const change of [x=>x.jobId='other',x=>x.sourceDigest='other',x=>x.contract={...x.contract,frameSize:'720x1280'}]){const x=structuredClone(f.expected);change(x);assert.equal(await verifyExperienceVideoRead(evidence,f.input.rawContent,f.rawInput,f.dto,x),false);}
  assert.equal(await verifyExperienceVideoRead(evidence,f.input.rawContent+' ',f.rawInput,f.dto,f.expected),false);
  f.current.events.push({type:'DocumentArtifactEdited',payload:{artifact_id:f.artifactId}});assert.equal(captureExperienceNativeResult(f.identity,f.publicJob,f.current),null);
 }finally{f.sqlite.close();}
});

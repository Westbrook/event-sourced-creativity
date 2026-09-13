import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash}from'node:crypto';
import{SHORT_STORY_NARRATIVE_CONTRACT as contract}from'../src/model/output-narrative-contract.ts';
import{digest}from'../src/experiences/compiler.ts';
import{captureExperienceNativeResult}from'../src/experiences/native-result-association.ts';
import{captureExperienceStoryEvidence,isExperienceStoryTarget,verifyExperienceStoryRead}from'../src/experiences/story-result.ts';
const hash=v=>createHash('sha256').update(v).digest('hex');
async function fixture(){
 const now=Date.now(),expiry=new Date(now+60000).toISOString(),body=Array(600).fill('word').join(' '),settings={narrative_contract:contract,narrative_contract_digest:(await digest(contract)).slice(7),narrative_body_sha256:hash(body),narrative_word_count:600,narrative_word_count_policy:'english-lexical@1'};
 const artifact={id:'artifact',documentId:'doc',kind:'short_story',itemCount:3,sourceEventId:'event',sourceSurface:'outputs',contentRef:'content',settings};
 const event={eventId:'event',type:'DocumentRenderCompleted',correlationId:'correlation',streamId:'creative:owner',actor:'worker:renderer',payload:{document_id:'doc',project_id:'project',source_surface:'outputs',artifact_id:'artifact',content_ref:'content',artifact_kind:'short_story',item_count:3,requested_by_user_id:'owner',settings}};
 const identity={output:'short_story',documentId:'doc',projectId:'project',ownerUserId:'owner',jobId:'job',correlationId:'correlation',expiresAt:expiry},job={jobId:'job',documentId:'doc',sourceSurface:'outputs',status:'completed',kind:'render_document',result:{artifactId:'artifact',artifactKind:'short_story',appendedEventIds:['event']}};
 const current={documentId:'doc',projectId:'project',documents:[{id:'doc',projectId:'project',removed:false}],events:[event],outputs:[],artifacts:[artifact]};
 const raw=JSON.stringify({title:'Story',summary:'Summary',content_markdown:body,presentation:null,items:Array.from({length:3},()=>({title:'Movement',body:'Action',notes:'',image_prompt:'',context_group_ids:[],slide:null}))});
 const story={schemaVersion:1,kind:'native-retained-short-story',selection:{documentId:'doc',artifactId:'artifact',revision:0,contentSha256:hash(raw)},title:'Story',contentMarkdown:body,expiresAt:expiry};
 return{now,body,settings,artifact,event,identity,job,current,raw,story};
}
// Pure identity/byte checks on unadmitted metadata: no native job, grant or provider execution.
test('story requirement identity is explicit document+fixed contract, never a label or media mismatch exemption',()=>{
 const target={media_kind:'document',narrative_contract:contract,quantity:{kind:'exact',unit:'document',value:1},source_scope:{kind:'document'},coverage:{kind:'document_context'}};
 assert.equal(isExperienceStoryTarget(target),true);
 for(const change of [{narrative_contract:null},{media_kind:'short_story'},{quantity:{kind:'exact',unit:'document',value:3}},{narrative_contract:{...contract,language:'ja'}},{content_quantity:{kind:'exact',unit:'word',value:600}},{variant_id:'v'}])assert.equal(isExperienceStoryTarget({...target,...change}),false);
});
test('story result associates only original completed job/event/owner and matching current projection',async()=>{
 const f=await fixture(),candidate=captureExperienceNativeResult(f.identity,f.job,f.current,f.now);assert.equal(candidate.output,'short_story');assert.equal(candidate.artifactId,'artifact');assert.equal(candidate.narrative.wordCount,600);
 for(const mutate of [f=>f.identity.ownerUserId='other',f=>f.job.jobId='other',f=>f.job.result.artifactKind='scene',f=>f.event.payload.artifact_kind='slides',f=>f.job.result.appendedEventIds=[],f=>f.event.payload.content_ref='other',f=>f.current.events.push({...f.event,eventId:'duplicate'}),f=>f.current.events.push({type:'DocumentArtifactEdited',payload:{artifact_id:'artifact'}}),f=>f.artifact.settings={...f.settings,narrative_word_count:601},f=>f.event.payload.settings={},f=>f.identity.expiresAt=new Date(f.now).toISOString()]){const x=structuredClone(f);mutate(x);assert.equal(captureExperienceNativeResult(x.identity,x.job,x.current,x.now),null);}
});
test('story reader requires exact whole JSON, literal body, measured contract proof and current revision',async()=>{
 const f=await fixture(),evidence=captureExperienceStoryEvidence(f.settings);assert.equal(await verifyExperienceStoryRead(evidence,f.raw,f.story,f.now),true);
 for(const mutate of [f=>f.story.contentMarkdown=' '+f.body,f=>f.raw+=' ',f=>f.story.title='Other',f=>f.story.selection.revision=1,f=>f.story.selection.contentSha256='0'.repeat(64),f=>f.settings.narrative_body_sha256='0'.repeat(64),f=>f.settings.narrative_contract_digest='0'.repeat(64),f=>f.settings.narrative_word_count=601,f=>f.story.expiresAt=new Date(f.now).toISOString()]){const x=structuredClone(f);mutate(x);assert.equal(await verifyExperienceStoryRead(captureExperienceStoryEvidence(x.settings),x.raw,x.story,x.now),false);}
});
test('599/801 words and foreign media remain unavailable even with internally matching transport hashes',async()=>{
 for(const count of [599,801]){const f=await fixture(),body=Array(count).fill('word').join(' '),raw=JSON.stringify({...JSON.parse(f.raw),content_markdown:body}),story={...f.story,contentMarkdown:body,selection:{...f.story.selection,contentSha256:hash(raw)}};assert.equal(await verifyExperienceStoryRead({...captureExperienceStoryEvidence(f.settings),bodySha256:hash(body),wordCount:count},raw,story,f.now),false);}
 for(const extra of [{audio_revision:{}},{video_revision:{}},{model3d_revision:{}},{presentation:{}},{media_url:'/api/media/other'}]){const f=await fixture(),raw=JSON.stringify({...JSON.parse(f.raw),...extra});assert.equal(await verifyExperienceStoryRead(captureExperienceStoryEvidence(f.settings),raw,{...f.story,selection:{...f.story.selection,contentSha256:hash(raw)}},f.now),false);}
});

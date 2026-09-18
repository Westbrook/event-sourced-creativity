import assert from 'node:assert/strict';
import test from 'node:test';
import {authoritativeCreativeContext,createAuthoritativeCreativeContextFold} from '../worker/context-authority.ts';
import {assessCreativeContext,assessCreativeContextFromRights,createContextRightsFold} from '../src/model/context-health.ts';
import {foldEvents} from '../src/model/events.ts';
const event=(sequence,type,payload)=>({eventId:'context-'+sequence,streamId:'creative:a',sequence,occurredAt:'2026-09-14',recordedAt:'2026-09-14',actor:'a',clientId:'a',correlationId:'a',causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
export const streamedContextFixture=[
  event(1,'ProjectCreated',{project_id:'p',name:'Project'}),
  event(2,'DocumentCreated',{project_id:'p',document_id:'d',title:'Document'}),
  event(3,'BlockCreated',{project_id:'p',document_id:'d',block_id:'r',type:'reference',properties:{text:'Retained source',reference_id:'ref',source_mime_type:'text/plain'}}),
  event(4,'RightsAsserted',{reference_id:'ref',rights_class:'owned'}),
  event(5,'CanvasCreated',{canvas_id:'c',project_id:'p'}),
  event(6,'CanvasItemPlaced',{canvas_id:'c',item_id:'i',source_kind:'block',source_id:'r'}),
  event(7,'ContextSetFormalized',{canvas_id:'c',context_set_id:'cs',item_ids:['i']}),
  event(8,'ReferenceIngested',{reference_id:'ref',rights_class:'revoked'}),
  event(9,'RightsAsserted',{reference_id:'ref',rights_class:'owned_or_licensed'}),
];
export const contextRequests=[{documentId:'d',projectId:'p'},{documentId:'d',projectId:'p',canvasId:'c',contextSetId:'cs'},
  {documentId:'d',projectId:'p',snapshot:{canvas:{canvas_id:'c',context_set_id:'cs'}}},
  {documentId:'d',projectId:'p',snapshot:{facts:[{block_id:'foreign'}]}},
  {documentId:'d',projectId:'p',sourceBlockVersions:[{block_id:'r',version:99}]}];
export const contextOutcome=fn=>{try{return {value:fn()};}catch(error){return {error:error.code??error.message};}};
for(const pageSize of [1,2,7,256])test(`authoritative streamed context preserves decisions across ${pageSize}-event pages`,()=>{
  for(let count=0;count<=streamedContextFixture.length;count++)for(const request of contextRequests){
    const input=streamedContextFixture.slice(0,count),fold=createAuthoritativeCreativeContextFold(request);
    for(let start=0;start<input.length;start+=pageSize)for(const entry of structuredClone(input.slice(start,start+pageSize)))assert.equal(fold.accept(entry),true);
    assert.deepEqual(contextOutcome(()=>fold.finish()),contextOutcome(()=>authoritativeCreativeContext(input,request)));
    assert.throws(()=>fold.finish(),/already_finished/);assert.throws(()=>fold.accept(streamedContextFixture[0]),/already_finished/);
  }
});
test('rights revocation and restoration remain authoritative and selector mutation cannot redirect a read',()=>{
  assert.throws(()=>createAuthoritativeCreativeContextFold({documentId:'d'}),error=>error.code==='context_project_required');
  const request={documentId:'d',projectId:'p'},fold=createAuthoritativeCreativeContextFold(request);
  request.documentId='different';for(const entry of streamedContextFixture)fold.accept(entry);
  assert.equal(fold.finish().projection.documentId,'d');
  const revoked=createAuthoritativeCreativeContextFold({documentId:'d',projectId:'p'});
  for(const entry of streamedContextFixture.slice(0,8))revoked.accept(entry);
  assert.equal(contextOutcome(()=>revoked.finish()).error,'context_source_rights_required');
});
test('resolved project preserves legacy Canvas fallback despite earlier unrelated projects',()=>{
  const input=[event(0,'ProjectCreated',{project_id:'q'}),...streamedContextFixture.map(entry=>entry.type==='CanvasCreated'?{...entry,payload:{canvas_id:'c'}}:entry)];
  const request={documentId:'d',projectId:'p',canvasId:'c',contextSetId:'cs'},fold=createAuthoritativeCreativeContextFold(request);
  for(const entry of input)fold.accept(entry);
  assert.deepEqual(fold.finish(),authoritativeCreativeContext(input,{documentId:'d',canvasId:'c',contextSetId:'cs'}));
});
test('rights fold handles empty identities, non-rights events, audio classes and last receipt ordering',()=>{
  const projection=foldEvents(streamedContextFixture,Infinity,'d','p');
  for(const classification of ['owned','owned_or_licensed','account-generated','public-domain','revoked','',null]){
    const input=[...streamedContextFixture,event(10,'RightsAsserted',{reference_id:'ref',rights_class:classification}),event(11,'RightsAsserted',{reference_id:'',rights_class:'owned'})];
    const fold=createContextRightsFold();for(const entry of input)fold.accept(entry);
    assert.deepEqual(assessCreativeContextFromRights(projection,fold.finish(),0),assessCreativeContext(projection,input,0));
    assert.throws(()=>fold.accept(input[0]),/already_finished/);assert.throws(()=>fold.finish(),/already_finished/);
  }
});

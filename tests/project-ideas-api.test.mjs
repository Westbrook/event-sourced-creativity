import {independentIdeaEdits} from '../src/model/shared-idea-edits.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {readWorkspaceEvents} from '../worker/runtime.ts';
import {foldEvents} from '../src/model/events.ts';
import {authoritativeCreativeContext} from '../worker/context-authority.ts';
for(const shared of [false,true])test(`project ideas persist, replay and generate with a shared identity (${shared?'shared workspace':'personal workspace'})`,async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared});
 try{
  const append=async events=>{const source=await f.request('/api/events?after=0&limit=2000&content=0');const {head}=await source.json();const response=await f.request('/api/events',f.json({action:'batch',expectedSequence:head,events}));const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.appended.length,events.length);return body;};
  const scope={project_id:f.projectId,document_id:'ideas-other'};
  await append([{type:'DocumentCreated',payload:{...scope,title:'Other document'}},{type:'BlockDocumentAttached',payload:{...scope,block_id:'scene-reuse-direction',position:'z'}}]);
  await append([{type:'BlockPropertyEdited',payload:{...scope,block_id:'scene-reuse-direction',property_path:'text',old_value:'The keeper checks the harbor.',new_value:'Shared new direction.'}}]);
  let history=await readWorkspaceEvents(f.env,f.streamId);
  for(const doc of [f.documentId,'ideas-other']){
   assert.equal(foldEvents(history,Infinity,doc,f.projectId).blocks.find(b=>b.id==='scene-reuse-direction').properties.text,'Shared new direction.');
   const context=authoritativeCreativeContext(history,{documentId:doc,projectId:f.projectId});assert.ok(context.snapshot.facts.some(b=>b.block_id==='scene-reuse-direction'&&b.properties.text==='Shared new direction.'));
  }
  const original=foldEvents(history,Infinity,f.documentId,f.projectId);
  const plan=independentIdeaEdits(original,[{type:'BlockPropertyEdited',payload:{block_id:'scene-reuse-direction',property_path:'text',old_value:'Shared new direction.',new_value:'Independent direction.'}}],f.documentId);
  await append(plan.events);
  history=await readWorkspaceEvents(f.env,f.streamId);
  assert.equal(foldEvents(history,Infinity,f.documentId,f.projectId).blocks.find(b=>b.id===plan.ids.get('scene-reuse-direction')).properties.text,'Independent direction.');
  assert.equal(foldEvents(history,Infinity,'ideas-other',f.projectId).blocks.find(b=>b.id==='scene-reuse-direction').properties.text,'Shared new direction.');
  await append([{type:'BlockDocumentDetached',payload:{...scope,block_id:'scene-reuse-direction'}}]);
  history=await readWorkspaceEvents(f.env,f.streamId);assert.equal(foldEvents(history,Infinity,'ideas-other',f.projectId).blocks.length,0);
  await append([{type:'DocumentRemoved',payload:{project_id:f.projectId,document_id:f.documentId}}]);
  history=await readWorkspaceEvents(f.env,f.streamId);assert.ok(foldEvents(history,Infinity,'ideas-other',f.projectId).libraryBlocks.some(b=>b.id==='scene-reuse-direction'));
  const forbidden=await f.request('/api/events',f.json({action:'append',expectedSequence:(await(await f.request('/api/events?after=0')).json()).head,event:{type:'BlockDocumentAttached',payload:{...scope,project_id:'foreign',block_id:'scene-reuse-direction'}}}));assert.ok([403,409].includes(forbidden.status),await forbidden.text());
 }finally{await f.drainBackground();f.close();}
});

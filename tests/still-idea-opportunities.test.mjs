import {glb} from './helpers/model3d-native-execution-fixture.mjs';
import {wav,mp4} from './output-asset-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionState,questionsFor,evaluateActions,eligibleActions} from '../src/still/decisions.ts';
import {IDEA_ACTIONS} from '../src/still/idea-actions.ts';
import {StillClient} from '../src/still/client.ts';
import {ContextWorkflow} from '../src/still/context-workflow.ts';
import {suppliedReferenceEvents} from '../src/still/reference.ts';
import {resolveFileReferences,prepareContextIntelligence} from '../worker/context-intelligence-api.ts';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {memoryMedia} from './helpers/still-media-fixture.mjs';
const position=f=>({projectId:f.projectId,documentId:f.documentId,blockId:'',outputId:'',view:'document',intent:'',recentActions:[]});
const abilities={author:true,generate:true,projectCreate:true,formats:['image','video','audio','model3d','short_story','scene','slides','storyboard']};

test('document and block benefit probabilities use actual context, support ranking, and stay bounded',async()=>{
 const f=await createSceneCostFixture(1,'visual');try{
  for(const blockId of ['', 'scene-reuse-direction']){
   const pos={...position(f),blockId},built=buildDecisionState(f.events,pos,abilities,f.events.length),questions=questionsFor(built.candidates,pos,undefined,built.state.active.blocks);
   for(const id of IDEA_ACTIONS){assert.ok(built.candidates.some(a=>a.id===id));assert.equal(questions['benefit_'+id].type,'noul');assert.match(questions['benefit_'+id].instructions,/benefit probability, not click likelihood/);}
   assert.equal(questions['target_split-context']?.criteria['scene-reuse-direction'],blockId?undefined:'direction/scene-reuse');
   const answers=Object.fromEntries(built.candidates.map(a=>['use_'+a.id,{type:'score',score:2,confidence:.9}]));
   const ordinary=evaluateActions(built.candidates,pos,answers).rows.find(r=>r.id==='research-context');
   const useful=evaluateActions(built.candidates,pos,{...answers,'benefit_research-context':{type:'noul',noul:1}}).rows.find(r=>r.id==='research-context');assert.ok(useful.value>ordinary.value);
   assert.ok(Buffer.byteLength(JSON.stringify({state:built.state,questions}))<60000);
  }
  const manual=eligibleActions(f.projection,position(f),{...abilities,generate:false});assert.ok(manual.some(a=>a.id==='supply-reference'));assert.ok(!manual.some(a=>a.id==='find-references'));
  f.projection.blocks.forEach(b=>b.locked=true);assert.ok(!eligibleActions(f.projection,position(f),abilities).some(a=>IDEA_ACTIONS.includes(a.id)));
 }finally{await f.drainBackground();f.close();}
});

test('file research retains only cited public source candidates without claiming file bytes or rights',()=>{
 const row={title:'Ceramic vessel',description:'A turntable video of a glazed vessel.',reason:'Shows the surface under changing light.',source_url:'https://example.com/vessel',media_kind:'video',license:null,attribution:null};
 const report=resolveFileReferences('b',{references:[row,{...row,source_url:'https://invented.example/file'},{...row,source_url:'https://127.0.0.1/private'}]},new Set([row.source_url,'https://127.0.0.1/private']),'ceramic',[]);
 assert.equal(report.learned.length,1);assert.equal(report.learned[0].fileKind,'video');assert.equal(report.learned[0].license,null);assert.equal(report.learned[0].imageUrl,null);assert.equal(report.learned[0].sourceUrl,row.source_url);
});

test('Still explicitly quotes Sol high analysis; Forma retains its model and admin restrictions still apply',async()=>{
 const f=await createSceneCostFixture(1,'visual');f.env.FORMA_ASSISTANT_PROVIDER_USER_IDS=f.owner;
 try{
  const body={...position(f),blockId:'scene-reuse-direction',analysisProfile:'still-ideas-v1',purpose:'references',publicQuery:'Harbor navigation charts'};
  const prepare=body=>prepareContextIntelligence(new Request('http://localhost/api/context/research',{method:'POST'}),f.env,'research',body);
  const result=await prepare(body);assert.ok(!(result instanceof Response));assert.equal(result.decision.model,'gpt-5.6-sol');assert.equal(result.providerBase.reasoning.effort,'high');assert.ok(result.providerBase.max_output_tokens>=8192);assert.equal(result.binding.steps.length,2);assert.equal(result.providerBase.text.format.schema.required[0],'references');
  const traditional=await prepare({...body,analysisProfile:undefined});assert.equal(traditional.decision.model,'gpt-5.6-terra');assert.equal(traditional.providerBase.reasoning.effort,'low');
  assert.notEqual(result.binding.intentHash,traditional.binding.intentHash);
  const empty=await prepare({...body,publicQuery:''});assert.equal(empty.status,400);
  f.env.FORMA_ASSISTANT_ALLOWED_MODELS='gpt-5.6-terra';const restricted=await prepare(body);assert.equal(restricted.providerAvailable,false);
 }finally{await f.drainBackground();f.close();}
});

for(const shared of [false,true])test(`supplied files become typed, linked Forma context in ${shared?'shared':'personal'} scope`,async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;f.env.MEDIA=memoryMedia();
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith('/'),'No model request during manual attachment');return f.request(String(url),init);};
 try{
  const c=new StillClient();await c.load();c.position={...position(f),blockId:'scene-reuse-direction'};const before=f.counts();
  const sources=[['reference.png','image/png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7y8AAAAASUVORK5CYII=','base64')],['research.txt','text/plain','A harbor has a protected anchorage.'],['sound.wav','audio/wav',wav()],['motion.mp4','video/mp4',mp4()],['shape.glb','model/gltf-binary',glb()]];
  for(const [name,mime,data]of sources){
   const form=new FormData();form.append('file',new Blob([data],{type:mime}),name);form.append('rightsConfirmed','true');form.append('nonSensitiveConfirmed','true');
   const uploaded=await f.request('/api/media',{method:'POST',body:form});assert.equal(uploaded.status,200,await uploaded.clone().text());const media=await uploaded.json();
   const target=c.projection.blocks.find(b=>b.id==='scene-reuse-direction'),events=suppliedReferenceEvents(target,c.projection,media);await c.append(events);
   const reference=c.projection.blocks.find(b=>b.id===events.find(e=>e.type==='BlockCreated').payload.block_id);assert.ok(reference);assert.equal(reference.type,mime==='model/gltf-binary'?'model3d':mime.startsWith('audio/')?'audio':'reference');assert.equal(reference.properties.pixel_reference_mode,'context_only');assert.ok(c.projection.blockRelations.some(r=>r.fromBlockId===target.id&&r.toBlockId===reference.id));
   if(mime==='text/plain')assert.match(reference.properties.text,/protected anchorage/);
   if(mime==='video/mp4'){assert.equal(reference.properties.extraction_status,'unavailable');assert.equal(reference.properties.text,'');}
  }
  assert.deepEqual(f.counts(),before);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('file discovery executes reviewed search and private analysis once, with no attachment until approval',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch;f.env.MEDIA=memoryMedia();f.env.FORMA_ASSISTANT_PROVIDER_USER_IDS=f.owner;
 const calls=[];globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('/'))return f.request(String(url),init);
  assert.equal(String(url),'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);calls.push(body);assert.equal(body.model,'gpt-5.6-sol');assert.equal(body.reasoning.effort,'high');
  const usage={input_tokens:100,output_tokens:100,total_tokens:200},source='https://example.com/harbor-chart';
  return body.tools?Response.json({id:'search',model:body.model,usage,output_text:'A downloadable harbor navigation chart.',output:[{type:'web_search_call',action:{sources:[{url:source}]}}]}):Response.json({id:'analysis',model:body.model,usage,output_text:JSON.stringify({references:[{title:'Harbor chart',description:'Chart showing harbor channel markers.',reason:'Makes navigation details precise.',source_url:source,media_kind:'document',license:null,attribution:null}]})});
 };
 try{
  const c=new StillClient();await c.load();c.position={...position(f),blockId:'scene-reuse-direction'};const count=c.projection.blocks.length,flow=new ContextWorkflow(c,'research','references');flow.publicQuery='Harbor navigation chart';
  await flow.prepareQuote();assert.equal(calls.length,0);assert.equal(flow.quote.providerAvailable,true);await flow.analyze();assert.equal(calls.length,2);assert.equal(flow.candidates.length,1);assert.equal(flow.candidates[0].research.fileKind,'document');assert.equal(flow.candidates[0].included,false);assert.equal(c.projection.blocks.length,count);
  assert.equal(calls[0].input,'Harbor navigation chart');assert.doesNotMatch(calls[0].input,/keeper/);assert.match(calls[1].input,/keeper/);assert.equal(calls[1].tools,undefined);
  await flow.analyze();assert.equal(calls.length,2,'completed analysis is retrieved, never rerun');
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

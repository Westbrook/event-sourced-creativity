import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents } from '../src/model/events.ts';
import { compositionPlan } from '../src/still/composition.ts';
import {compositionIndex,connectionEvidence} from '../src/still/assessments.ts';
import { ContextWorkflow } from '../src/still/context-workflow.ts';
import { StillClient } from '../src/still/client.ts';
import { ACTIONS, buildDecisionState, questionsFor, selectActions, eligibleActions } from '../src/still/decisions.ts';

const session={user:{userId:'context-test',role:'creator'},permissionEpoch:'1',policy:{accepted:true},provider:{}};
const pos={projectId:'p',documentId:'d',blockId:'parent',outputId:'',view:'document',intent:'Change only the material',recentActions:[]};
const evt=(type,payload,sequence)=>({eventId:`e${sequence}`,sequence,type,payload,occurredAt:'2026-09-17'});
const events=[evt('ProjectCreated',{project_id:'p',name:'Project'},1),evt('DocumentCreated',{project_id:'p',document_id:'d',title:'Document'},2),...['parent','child','other'].map((id,i)=>evt('BlockCreated',{project_id:'p',document_id:'d',block_id:id,type:'subject',handle:id,scope:'document',position:String(i),properties:{text:`${id} ceramic and brass`,weight:.8}},i+3))];
const client=()=>{const c=new StillClient();c.session=session;c.position={...pos};c.events=structuredClone(events);c.head=5;return c;};
const quote={...pos,canvasId:null,executionId:'execution',bindingHash:'binding',status:'quoted',providerAvailable:true,publicQuery:''};
const candidate={id:'one',type:'subject',subtype:'Hero subject',label:'ceramic',text:'ceramic',sourceExcerpt:'ceramic',participants:[],addendum:false};
const result={plan:{sourceBlockId:'parent',sourceText:'ceramic and brass',proposals:[candidate],addenda:[]},executionId:'execution',bindingHash:'binding'};
const json=(body,status=200)=>Response.json(body,{status});

test('uncertain paid analysis is retrieved without another execution and proposals require selection',async()=>{
  const c=client(),flow=new ContextWorkflow(c,'decompose'),saved=globalThis.fetch,actions=[];
  globalThis.fetch=async(url,init)=>{if(url==='/api/session?profile=still')return json(session);const body=JSON.parse(init.body);actions.push(body.action);if(body.action==='quote')return json({quote});if(body.action==='execute')throw new Error('lost response');if(body.action==='retrieve')return json(result);throw new Error(`unexpected ${body.action}`);};
  try {await flow.prepareQuote();await assert.rejects(flow.analyze(),/lost/);await flow.analyze();assert.deepEqual(actions,['quote','execute','retrieve']);assert.equal(flow.candidates[0].included,false);await assert.rejects(flow.prepareChanges(),/Choose at least one/);}finally{globalThis.fetch=saved;}
});
test('analysis never accepts a result from a different retained identity',async()=>{
  const flow=new ContextWorkflow(client(),'decompose'),saved=globalThis.fetch;flow.quote=quote;
  globalThis.fetch=async url=>url==='/api/session?profile=still'?json(session):json({...result,executionId:'different'});
  try{await assert.rejects(flow.analyze(),/identity/);assert.equal(flow.candidates.length,0);assert.equal(flow.quote.status,'uncertain');}finally{globalThis.fetch=saved;}
});
test('unknown apply response preserves exact preview identity and retrieves rather than applying twice',async()=>{
  const flow=new ContextWorkflow(client(),'decompose'),saved=globalThis.fetch,actions=[];flow.preview={...pos,canvasId:null,previewId:'retained',approvalHash:'approved'};flow.status='review';
  globalThis.fetch=async(url,init)=>{if(url==='/api/session?profile=still')return json(session);const body=JSON.parse(init.body);actions.push(body);if(body.action==='apply')throw new Error('lost save');return json({status:'applying'});};
  try{await assert.rejects(flow.apply(),/lost save/);await flow.apply();assert.deepEqual(actions.map(a=>a.action),['apply','retrieve']);assert.ok(actions.every(a=>a.previewId==='retained'&&a.approvalHash==='approved'));}finally{globalThis.fetch=saved;}
});
test('scope changes prevent old context requests',async()=>{
  const c=client(),flow=new ContextWorkflow(c,'decompose'),saved=globalThis.fetch;let requests=0;
  globalThis.fetch=async url=>{if(url!=='/api/session?profile=still')requests++;return json({...session,permissionEpoch:'2'});};
  try{await assert.rejects(flow.prepareQuote(),/workspace changed/);assert.equal(requests,0);}finally{globalThis.fetch=saved;}
});
test('composition keeps block identities, order, and existing relation provenance',()=>{
  const related=[...events,evt('BlockRelationAdded',{relation_id:'r',project_id:'p',document_id:'d',from_block_id:'parent',to_block_id:'child',kind:'context_contains',properties:{member_order:0,source_hint:'retained'}},6)];
  const p=foldEvents(related,Infinity,'d','p'),plan=compositionPlan(p,'parent',['other','child'],'ordered');
  assert.equal(plan.filter(e=>e.type==='BlockCreated').length,0);
  assert.deepEqual(plan.filter(e=>e.type==='BlockRelationAdded').map(e=>e.payload.to_block_id),['other','child']);
  assert.equal(plan.at(-1).payload.properties.source_hint,'retained');
  const applied=foldEvents([...related,...plan.map((e,i)=>evt(e.type,e.payload,7+i))],Infinity,'d','p');
  assert.equal(applied.blocks.length,3);assert.equal(applied.blocks.find(b=>b.id==='parent').properties.context_group.application,'ordered');
  assert.equal(applied.blockRelations.filter(r=>!r.removed).length,2);
  assert.throws(()=>compositionPlan(applied,'child',['parent'],'isolate'),/ancestor|cycle/);
  applied.blocks.find(b=>b.id==='child').locked=true;
  assert.throws(()=>compositionPlan(applied,'parent',['child'],'ordered'),/editable/);
});
test('atomic guidance does not equate fragmentation with progress or exploration with unlocking',()=>{
  const candidates=ACTIONS.filter(a=>['split-context','compose','research-context','edit-block','unlock'].includes(a.id));
  const answers=Object.fromEntries(candidates.map(a=>[`use_${a.id}`,{type:'score',score:2,confidence:1}]));
  const noSplit={...answers,separable_decisions:{type:'noul',noul:1},coherent_small_idea:{type:'noul',noul:1},fragmentation_friction:{type:'noul',noul:1},bold_invitation:{type:'noul',noul:1}};
  assert.notEqual(selectActions(candidates,pos,noSplit)[0].id,'split-context');
  const explicit={...answers,independent_change:{type:'noul',noul:1},split_benefit:{type:'score',score:3,confidence:1}};
  assert.equal(selectActions(candidates,pos,explicit)[0].id,'split-context');
  assert.ok(!eligibleActions(foldEvents(events,Infinity,'d','p'),pos,{author:false,generate:false,projectCreate:false,formats:[]}).some(a=>['split-context','research-context','find-references','compose','edit-block'].includes(a.id)));
});
test('largest eligible request remains below the combined Jev budget and contains selected relationships',()=>{
  const full=[...events,...Array.from({length:150},(_,i)=>evt('BlockCreated',{project_id:'p',document_id:'d',block_id:`large-${i}`,type:'subject',handle:'方向'.repeat(60),scope:'document',position:String(i),properties:{text:'独立したアイデア'.repeat(300),weight:.8}},6+i)),evt('BlockRelationAdded',{relation_id:'r',project_id:'p',document_id:'d',from_block_id:'parent',to_block_id:'child',kind:'context_contains',properties:{member_order:0}},156)];
  const ability={author:true,generate:true,projectCreate:true,formats:['image','video','audio','scene','short_story','model3d','storyboard','slides']};
  const {state,candidates}=buildDecisionState(full,pos,ability,156);
  assert.equal(state.focus.relations[0].to,'child');
  assert.ok(Buffer.byteLength(JSON.stringify(state))<=20000);
  const questions=questionsFor(candidates,pos),evidence=connectionEvidence(full,pos);
  const requestState={...state,compositions:compositionIndex(questions),connectionCandidates:evidence.destinations.map(d=>({...d,label:d.label.slice(0,120),project:d.project.slice(0,120),document:d.document.slice(0,120)})),compositionGuidance:'Questions in each composition supply distinct judgments, not independent votes on the same outcome. Missing evidence remains unknown. Code combines eligible results; suggestions never authorize actions.'};
  const requestBytes=Buffer.byteLength(JSON.stringify({model:'jev-latest',state:requestState,questions}));
  assert.ok(requestBytes<60000,`Request uses ${requestBytes} bytes`);
  const documentPosition={...pos,blockId:''},documentState=buildDecisionState(full,documentPosition,ability,156);
  const documentQuestions=questionsFor(documentState.candidates,documentPosition,undefined,documentState.state.active.blocks);
  const documentBytes=Buffer.byteLength(JSON.stringify({model:'jev-latest',state:{...documentState.state,compositions:compositionIndex(documentQuestions),connectionCandidates:evidence.destinations},questions:documentQuestions}));
  assert.ok(documentBytes<60000,`Document request uses ${documentBytes} bytes`);
  const storyQuestions=questionsFor(candidates,pos,'short_story');
  assert.ok(storyQuestions.protagonist);assert.equal(storyQuestions.model_material,undefined);assert.ok(storyQuestions.use_context);
});
test('reused execution alias must carry a matching scoped server quote',async()=>{
  const flow=new ContextWorkflow(client(),'decompose'),saved=globalThis.fetch;flow.quote={...quote,sourceHash:'source',operation:'context-decompose'};
  const retained={...flow.quote,executionId:'earlier',bindingHash:'earlier-binding'};
  globalThis.fetch=async url=>url==='/api/session?profile=still'?json(session):json({...result,executionId:retained.executionId,bindingHash:retained.bindingHash,quote:retained});
  try{await flow.analyze();assert.equal(flow.quote.executionId,'earlier');assert.equal(flow.candidates[0].selection.bindingHash,'earlier-binding');}finally{globalThis.fetch=saved;}
});
test('existing reference proposals use normal authoring while web candidates require acquisition',async()=>{
  const flow=new ContextWorkflow(client(),'research'),saved=globalThis.fetch;let selections;
  flow.candidates=[{selection:{executionId:'e',bindingHash:'h',proposalId:'existing'},research:{type:'reference',blockId:'native',area:'related'},included:true,text:'Native'},{selection:{executionId:'e',bindingHash:'h',proposalId:'web'},research:{type:'reference',blockId:null,area:'learned'},included:true,text:'Web'}];
  globalThis.fetch=async(url,init)=>{if(url==='/api/session?profile=still')return json(session);selections=JSON.parse(init.body).selections;return json({preview:{...pos,canvasId:null}});};
  try{await flow.prepareChanges();assert.deepEqual(selections.map(s=>s.proposalId),['existing']);}finally{globalThis.fetch=saved;}
});
test('explicitly poor suggestions do not fill an arbitrary action quota',()=>{
  const candidates=ACTIONS.slice(0,10),answers=Object.fromEntries(candidates.map(a=>[`use_${a.id}`,{type:'score',score:0,confidence:1}]));
  assert.deepEqual(selectActions(candidates,pos,answers),[]);
});

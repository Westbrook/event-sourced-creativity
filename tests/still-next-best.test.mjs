import test from 'node:test';
import assert from 'node:assert/strict';
import {assessNextBest,nextBestOrder,nextBestQuestion,readNextBestFlag} from '../src/still/next-best.ts';
import {questionsFor,ACTIONS,buildDecisionState} from '../src/still/decisions.ts';
import {presentToolbar} from '../src/still/presentation.ts';
import {validPanelCommand} from '../src/still/remote-protocol.ts';
const evidence={a:{score:2.5,confidence:.8,usefulProbability:.9},b:{score:2.4,confidence:.8,usefulProbability:.9}};
const answer={status:'Answered',choice:'b',confidence:.8,probabilities:{a:.15,b:.8,none:.05}};
test('choice is asked alongside scores, with abstention and all eligible options',()=>{
 const candidates=ACTIONS.filter(a=>['new-project','new-document'].includes(a.id));
 const q=questionsFor(candidates,{view:'projects',intent:'',recentActions:[]});
 assert.equal(q.next_best_action.type,'choice');assert.ok(q.next_best_action.criteria.none);
 for(const a of candidates){assert.ok(q.next_best_action.criteria[a.id]);assert.equal(q['use_'+a.id].type,'score');}
 const formats=ACTIONS.filter(a=>['image','scene'].includes(a.id));
 assert.equal(questionsFor(formats,{view:'choose-format',intent:'',recentActions:[]}).next_best_action.type,'choice');
 assert.ok(!nextBestQuestion([{id:'intent',label:'Direction',description:''}]).criteria.intent);
});
test('toggle compares the same evidence, changes order and produces only one primary',()=>{
 const selected=[{id:'a'},{id:'b'}],on=assessNextBest(answer,['a','b'],evidence,true),off=assessNextBest(answer,['a','b'],evidence,false);
 assert.ok(on.accepted);assert.equal(off.accepted,false);assert.equal(off.probability,.8);
 assert.deepEqual(nextBestOrder(selected,selected,off),selected);
 assert.deepEqual(nextBestOrder(selected,selected,on).map(a=>a.id),['b','a']);
 const rows=presentToolbar(['b','a'],evidence,{nextBest:on.choice});
 assert.equal(rows.b.variant,'primary');assert.equal(rows.a.variant,'secondary');
 assert.ok(Object.values(presentToolbar(['b','a'],evidence,{more:true,nextBest:on.choice})).every(r=>r.variant==='secondary'));
 assert.ok(!assessNextBest(answer,['a','b'],evidence,true,['b']).accepted);
});
test('uncertain, malformed, unhelpful, missing and ineligible choices keep score behavior',()=>{
 for(const a of [undefined,{...answer,choice:'none'}, {...answer,confidence:.1}, {...answer,probabilities:undefined},{...answer,probabilities:{a:.6,b:.3,none:.1}},{...answer,probabilities:{a:-.1,b:1.05,none:.05}},{...answer,probabilities:{a:.2,b:.9,none:.1}}])assert.equal(assessNextBest(a,['a','b'],evidence,true).accepted,false);
 assert.equal(assessNextBest(answer,['a'],evidence,true).accepted,false);
 assert.equal(assessNextBest(answer,['a','b'],{...evidence,b:{...evidence.b,score:1}},true).accepted,false);
});
test('nominated action preserves group limits; local preference and remote flag are bounded',()=>{
 const selected=[{id:'a',group:'make'},{id:'c',group:'context'},{id:'d',group:'context'},{id:'e',group:'write'}],ranked=[{id:'b',group:'make'},...selected];
 assert.deepEqual(nextBestOrder(selected,ranked,assessNextBest(answer,['a','b'],evidence,true)).map(a=>a.id),['b','c','d','e']);
 assert.equal(readNextBestFlag({getItem:()=>null}),true);assert.equal(readNextBestFlag({getItem:()=> 'false'}),false);
 assert.ok(validPanelCommand({type:'next-best',value:false,scope:'a'.repeat(64)}));
 assert.ok(!validPanelCommand({type:'next-best',value:'false',scope:'a'.repeat(64)}));
});
test('server returns sanitized choice in the same request and reuses it from cache without developer mode',async()=>{
 const {createSceneCostFixture}=await import('./helpers/scene-cost-fixture.mjs');
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch;f.env.JEV_API_KEY='fixture-only';let calls=0;
 globalThis.fetch=async(url,init)=>{
  calls++;const {questions,state}=JSON.parse(init.body);assert.equal(state.toolbarDecision.defaultAction,'new-project');assert.equal(questions.next_best_action.type,'choice');
  const choice='new-project',probabilities=Object.fromEntries(Object.keys(questions.next_best_action.criteria).map(id=>[id,id===choice?.9:id==='none'?.1:0]));
  return Response.json({model:'fixture',answers:{use_new_project:{type:'score',score:3,confidence:.9},'use_new-project':{type:'score',score:3,confidence:.9,probabilities:{0:0,1:0,2:0,3:1}},next_best_action:{type:'choice',choice,confidence:.8,probabilities,privateProviderField:'omit'}}});
 };
 try{
  const body={view:'projects',intent:'',recentActions:[]};
  const a=await(await f.request('/api/still/decision',f.json(body))).json();
  assert.equal(a.nextBest.choice,'new-project');assert.equal(a.nextBest.status,'Answered');assert.equal(a.nextBest.privateProviderField,undefined);assert.equal(a.diagnostics,undefined);
  const b=await(await f.request('/api/still/decision',f.json(body))).json();assert.deepEqual(b.nextBest,a.nextBest);assert.equal(calls,1);
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});


test('listing pages nominate toolbar affordances without adding content navigation or choosing listing order',()=>{
 const events=[{eventId:'p',sequence:1,type:'ProjectCreated',occurredAt:'2026-09-20',payload:{project_id:'p',name:'Project'}},{eventId:'d',sequence:2,type:'DocumentCreated',occurredAt:'2026-09-20',payload:{project_id:'p',document_id:'d',title:'Existing document'}}];
 const base={projectId:'',documentId:'',blockId:'',outputId:'',intent:'',recentActions:[]};
 const abilities={author:true,projectCreate:true,generate:true,formats:['image']};
 for(const [view,projectId,defaultAction] of [['projects','','new-project'],['documents','p','new-document']]){
  const pos={...base,view,projectId};const {state,candidates}=buildDecisionState(events,pos,abilities,2);
  const question=questionsFor(candidates,pos).next_best_action;
  assert.equal(state.toolbarDecision.defaultAction,defaultAction);
  assert.match(state.toolbarDecision.contentNavigation,/opened directly/);
  assert.match(state.toolbarDecision.contentNavigation,/listing order are outside/);
  assert.ok(question.criteria[defaultAction]);assert.equal(question.criteria[view],undefined,'No navigation to the current listing');
  assert.equal(question.criteria.p,undefined);assert.equal(question.criteria.d,undefined,'No content rows in toolbar nominations');
  assert.match(question.instructions,/none only when none of the eligible toolbar actions would be useful/);
  assert.match(question.instructions,/uncertainty.*probabilities and confidence/);
  assert.match(questionsFor(candidates,pos)['use_'+defaultAction].instructions,/invitation, not the probability/);
  const denied=buildDecisionState(events,pos,{...abilities,author:false,projectCreate:false},2);
  assert.equal(denied.state.toolbarDecision.defaultAction,null);
  assert.equal(questionsFor(denied.candidates,pos).next_best_action.criteria[defaultAction],undefined);
 }
 // Defaults describe the page, never overwrite explicit intent or apply to other surfaces.
 const explicit=buildDecisionState(events,{...base,view:'documents',projectId:'p',intent:'Return to my projects'},abilities,2).state;
 assert.equal(explicit.current.intent,'Return to my projects');assert.match(explicit.toolbarDecision.defaultMeaning,/override/);
 const palette=buildDecisionState(events,{...base,view:'projects',palette:{toolbar:['new-project'],more:[]}},abilities,2).state;
 assert.equal(palette.toolbarDecision.defaultAction,null);assert.equal(palette.toolbarDecision.surface,'command palette');
 const format=buildDecisionState(events,{...base,view:'choose-format',projectId:'p',documentId:'d'},abilities,2).state;
 assert.equal(format.toolbarDecision.defaultAction,null);assert.equal(format.toolbarDecision.surface,'output toolbar');
});

import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {prepareIdeaAssessment,assessIdeas,ideaAssessmentAnswers} from '../worker/still-idea-assessment.ts';
import {matchingIdeaAssessment} from '../src/still/idea-assessment.ts';
import {IDEA_ACTIONS,IDEA_BENEFITS} from '../src/still/idea-actions.ts';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {fetchDecision} from '../src/still/decision-transport.ts';
const abilities={author:true,generate:true,projectCreate:true,formats:['image','short_story']};
const position=f=>({projectId:f.projectId,documentId:f.documentId,blockId:'',outputId:'',view:'document',intent:'',recentActions:[]});
const input=f=>({env:f.env,owner:f.owner,scope:'authorized-fixture',projection:structuredClone(f.projection),position:position(f),abilities,head:12,history:[],bypass:false,developer:true});
const answer=q=>Object.fromEntries(Object.keys(q).map(id=>[id,{type:'noul',noul:id.includes('split-context')?.95:.6}]));
const family='An 82-year-old Japanese father from Nagoya, an 80-year-old Japanese mother from Shizuoka, who lives in Nagoya, a 53-year-old daughter/wife who was born in Nagoya but now lives in Brooklyn, and her 42-year-old husband who was born in San Antonio.';

test('per-idea assessment repairs only missing/invalid answers once and caches complete blocks',async()=>{
 const f=await createSceneCostFixture(1,'visual'),original=globalThis.fetch;f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));f.env.JEV_API_KEY='fixture';let calls=[],omit;
 globalThis.fetch=async(_url,init)=>{const b=JSON.parse(init.body);calls.push(b);const answers=answer(b.questions);if(calls.length===1){omit=Object.keys(answers)[0];delete answers[omit];}return Response.json({model:'fixture',answers});};
 try{
  const plan=prepareIdeaAssessment(input(f)),passes=[];const r=await assessIdeas(plan,passes);
  assert.equal(calls.length,2);assert.deepEqual(Object.keys(calls[1].questions),[omit]);assert.equal(r.complete,true);assert.ok(r.actions['split-context'].probability===.95);assert.equal(passes[1].id,'idea-repair');
  const warm=await assessIdeas(prepareIdeaAssessment(input(f)),[]);assert.equal(calls.length,2);assert.equal(warm.coverage.cached,warm.coverage.included);assert.equal(warm.actions['split-context'].assessedAt,r.actions['split-context'].assessedAt);
  const refresh=await assessIdeas(prepareIdeaAssessment({...input(f),bypass:true}),[]);assert.equal(calls.length,3);assert.equal(refresh.coverage.cached,0);
 }finally{globalThis.fetch=original;await f.drainBackground();f.close();}
});
test('cache invalidates only changed ideas and dependent references, and isolates authorization scope',async()=>{
 const f=await createSceneCostFixture(1,'visual'),original=globalThis.fetch;f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));f.env.JEV_API_KEY='fixture';const calls=[];
 globalThis.fetch=async(_url,init)=>{const b=JSON.parse(init.body);calls.push(b);return Response.json({model:'fixture',answers:answer(b.questions)});};
 try{
  const i=input(f),base=i.projection.blocks.find(b=>b.id==='scene-reuse-direction');i.projection.blocks=[base,{...structuredClone(base),id:'other',handle:'other',properties:{...base.properties,text:'A ceramic cup.'}}];i.projection.blockRelations=[];
  await assessIdeas(prepareIdeaAssessment(i),[]);assert.equal(calls[0].state.ideas.length,2);
  i.projection.blocks[0].properties.text=family;await assessIdeas(prepareIdeaAssessment(i),[]);assert.deepEqual(calls[1].state.ideas.map(b=>b.block.id),[base.id]);
  await assessIdeas(prepareIdeaAssessment({...i,head:13}),[]);assert.equal(calls.length,2,'Unrelated head changes do not invalidate unchanged evidence');
  await assessIdeas(prepareIdeaAssessment({...i,scope:'other-authorized-scope'}),[]);assert.equal(calls.length,3);
  i.projection.blockRelations.push({id:'ref',fromBlockId:base.id,toBlockId:'other',kind:'context_reference',removed:false,properties:{}});await assessIdeas(prepareIdeaAssessment(i),[]);assert.equal(calls.length,4);
 }finally{globalThis.fetch=original;await f.drainBackground();f.close();}
});
test('partial answers are not cached as complete and repair is bounded',async()=>{
 const f=await createSceneCostFixture(1,'visual'),original=globalThis.fetch;f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));f.env.JEV_API_KEY='fixture';let count=0;
 globalThis.fetch=async(_url,init)=>{count++;const q=JSON.parse(init.body).questions;return Response.json({model:'fixture',answers:Object.fromEntries(Object.keys(q).filter(k=>k.includes('split-context')).map(k=>[k,{type:'noul',noul:2}]))});};
 try{
  const report=await assessIdeas(prepareIdeaAssessment(input(f)),[]);assert.equal(count,2);assert.equal(report.complete,false);assert.equal(report.actions['split-context'].status,'Invalid response');assert.equal(report.actions['research-context'].status,'Missing response');assert.equal(report.actions['split-context'].probability,undefined);
  await assessIdeas(prepareIdeaAssessment(input(f)),[]);assert.equal(count,4);
 }finally{globalThis.fetch=original;await f.drainBackground();f.close();}
});
test('unavailable actions, failures and coverage are explicit; stale assessment cannot cross pages',async()=>{
 const f=await createSceneCostFixture(1,'visual'),original=globalThis.fetch;
 try{
  const i=input(f),plan=prepareIdeaAssessment(i);const unconfigured=await assessIdeas(plan,[]);assert.equal(unconfigured.actions['split-context'].status,'Unavailable');
  f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));f.env.JEV_API_KEY='fixture';globalThis.fetch=async()=>new Response(null,{status:429});const failed=await assessIdeas(prepareIdeaAssessment(i),[]);assert.equal(failed.actions['split-context'].status,'Failed');assert.match(failed.actions['split-context'].reason,/busy/);
  const denied=await assessIdeas(prepareIdeaAssessment({...i,abilities:{...abilities,author:false}}),[]);assert.equal(denied.actions['split-context'].status,'Unavailable');assert.equal(denied.coverage.included,0);
  const block=i.projection.blocks.find(b=>b.id==='scene-reuse-direction');i.projection.blocks=Array.from({length:40},(_,n)=>({...structuredClone(block),id:'b'+n}));const large=prepareIdeaAssessment(i);assert.equal(large.report.coverage.total,40);assert.ok(large.report.coverage.omitted>=28);
  assert.equal(matchingIdeaAssessment(failed,i.position,12),failed);assert.equal(matchingIdeaAssessment(failed,{...i.position,blockId:'other'},12),undefined);assert.equal(matchingIdeaAssessment(failed,i.position,13),undefined);assert.equal(matchingIdeaAssessment(failed,{...i.position,intent:'New goal'},12),undefined);assert.equal(matchingIdeaAssessment(failed,{...i.position,view:'results'},12),undefined);
 }finally{globalThis.fetch=original;await f.drainBackground();f.close();}
});
test('family example is submitted intact with independent-person and subset reuse guidance',async()=>{
 const f=await createSceneCostFixture(1,'visual'),original=globalThis.fetch;f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));f.env.JEV_API_KEY='fixture';let sent;
 globalThis.fetch=async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({model:'fixture',answers:answer(sent.questions)});};
 try{const i=input(f);i.position.blockId='scene-reuse-direction';const b=i.projection.blocks.find(b=>b.id===i.position.blockId);b.properties.text=family;b.properties.label='The family';const r=await assessIdeas(prepareIdeaAssessment(i),[]);assert.equal(sent.state.ideas[0].block.text,family);assert.match(IDEA_BENEFITS['split-context'],/four person blocks/);assert.match(IDEA_BENEFITS['split-context'],/parent or links/);assert.equal(ideaAssessmentAnswers(r)['benefit_split-context'].noul,.95);}finally{globalThis.fetch=original;await f.drainBackground();f.close();}
});
test('first toolbar streams before idea assessment; explicit reassessment does not request toolbar scores',async()=>{
 const f=await createSceneCostFixture(1,'visual'),original=globalThis.fetch;f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));f.env.JEV_API_KEY='fixture';let release,ready;const gate=new Promise(r=>release=r),initialReady=new Promise(r=>ready=r);let calls=0,ideaCalls=0;
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('/'))return f.request(url,init);
  calls++;const b=JSON.parse(init.body);if(b.state.ideas){ideaCalls++;await gate;return Response.json({model:'fixture',answers:answer(b.questions)});}
  return Response.json({model:'fixture',answers:Object.fromEntries(Object.entries(b.questions).map(([id,q])=>[id,q.type==='score'?{type:'score',score:2,confidence:.8}:q.type==='noul'?{type:'noul',noul:.5}:{type:'choice',choice:'organize',confidence:.8}]))});
 };
 try{
  let initial,complete=false;const pending=fetchDecision({...position(f),developer:true},r=>{initial=r;ready();}).then(r=>{complete=true;return r;});await initialReady;assert.equal(complete,false);assert.equal(initial.opportunities.phase,'pending');assert.ok(initial.actions.length);release();const result=await pending;assert.equal(result.opportunities.phase,'complete');assert.equal(result.opportunities.complete,true);assert.equal(result.diagnostics.opportunities.complete,true);
  const before=calls;const again=await fetchDecision({...position(f),developer:true,opportunitiesOnly:true,cacheBypass:true});assert.equal(calls,before+1);assert.equal(again.actions,undefined);assert.equal(again.opportunities.complete,true);assert.ok(ideaCalls>=2);
  const refreshed=await fetchDecision({...position(f),developer:true});assert.notEqual(refreshed.cache.status,'hit','Manual reassessment invalidates the older whole-menu cache');assert.equal(refreshed.opportunities.coverage.cached,refreshed.opportunities.coverage.included);
 }finally{release();globalThis.fetch=original;await f.drainBackground();f.close();}
});

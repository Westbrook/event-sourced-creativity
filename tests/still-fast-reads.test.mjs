import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { appendAuditEvent } from '../worker/runtime.ts';
import { StillClient } from '../src/still/client.ts';
import { actionHelp,readOnboardingFlag } from '../src/still/onboarding.ts';

test('lean Still session omits unrelated budgets/governance and content IDs narrow hydration',async()=>{
 const f=await createSceneCostFixture();try{
  const queries=[];f.controls.beforeRead=s=>queries.push(s.sql);
  const session=await (await f.request('/api/session?profile=still')).json();
  assert.equal(session.policy.accepted,true);assert.equal(session.provider.plannerConfigured,true);assert.equal(session.budgets,undefined);assert.equal(session.canvas,undefined);
  assert.ok(!queries.some(q=>/FROM (budget_counters|cost_budget_counters)/.test(q)));
  const content=await (await f.request('/api/events?after=0&limit=1&contentId='+encodeURIComponent(f.contentRef))).json();assert.deepEqual(Object.keys(content.content),[f.contentRef]);
  const absent=await(await f.request('/api/events?after=0&limit=1&contentId=not-owned')).json();assert.deepEqual(absent.content,{});
 }finally{await f.drainBackground();f.close();}
});

test('personal prepared history reuses unchanged projection, consumes tail, and rejects redacted payload reuse',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch,realNow=Date.now;let clock=realNow()+1_000_000;Date.now=()=>clock;f.env.JEV_API_KEY='fake';globalThis.fetch=async()=>Response.json({model:'simulated',answers:{}});
 for(const file of ['0038_scene_source_generations.sql','0044_still_history_cache.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const call=async()=>{clock+=2000;const r=await f.request('/api/still/decision',f.json({view:'document',projectId:f.projectId,documentId:f.documentId,developer:true}));assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{
  const first=await call();assert.equal(first.preparation.source,'fresh');
  const second=await call();assert.equal(second.preparation.source,'snapshot');assert.equal(second.preparation.eventsRead,0);
  await appendAuditEvent(f.env,f.streamId,'user','ObjectViewed',{document_id:f.documentId,object_id:'x'});
  delete f.env.JEV_API_KEY;const third=await call();assert.equal(third.preparation.source,'incremental');assert.equal(third.preparation.eventsRead,1);
  const row=f.sqlite.prepare("SELECT private_event_id FROM event_private_payloads WHERE document_id=? AND redacted_at IS NULL LIMIT 1").get(f.documentId);assert.ok(row);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2026-09-18T00:00:00.000Z' WHERE private_event_id=?").run(row.private_event_id);
  const fourth=await call();assert.equal(fourth.preparation.source,'fresh');
 }finally{globalThis.fetch=saved;Date.now=realNow;await f.drainBackground();f.close();}
});

test('shared snapshots recheck resource/retention witnesses and live access',async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared:true});
 const call=()=>f.request('/api/still/decision',f.json({view:'document',projectId:f.projectId,documentId:f.documentId}));
 try{
  const first=await(await call()).json();assert.equal(first.preparation.source,'shared');
  const second=await(await call()).json();assert.equal(second.preparation.source,'shared-snapshot');assert.equal(second.preparation.eventsRead,0);
  f.sqlite.prepare("UPDATE private_content SET redacted_at='2026-09-18T00:00:00.000Z' WHERE content_id=?").run(f.contentRef);
  assert.equal((await(await call()).json()).preparation.source,'shared');
  f.sqlite.prepare("UPDATE project_context_sessions SET revoked_at='2026-09-18T00:00:00.000Z' WHERE context_id=?").run(f.sharing.contextId);
  assert.equal((await call()).status,403);
 }finally{await f.drainBackground();f.close();}
});

test('route startup returns the selected document before background workspace hydration',async()=>{
 const f=await createSceneCostFixture(),saved=globalThis.fetch;
 try{
  await appendAuditEvent(f.env,f.streamId,'user','DocumentCreated',{project_id:f.projectId,document_id:'other',title:'Other'});
  await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,document_id:'other',block_id:'other-block',type:'direction',properties:{text:'Unrelated body'}});
  let release,waiting;globalThis.fetch=(url,init)=>String(url).includes('profile=workspace')?new Promise(r=>{release=()=>f.request(url,init).then(r);waiting=true;}):f.request(url,init);
  const c=new StillClient();c.position={...c.position,projectId:f.projectId,documentId:f.documentId,view:'document'};
  await c.load({hydrateContent:false,route:{documentId:f.documentId}});
  assert.equal(c.historyComplete,false);assert.ok(c.projection.blocks.some(b=>b.id==='scene-reuse-direction'));assert.ok(!c.events.some(e=>e.payload.block_id==='other-block'));
  const background=c.completeHistory();await Promise.resolve();assert.equal(waiting,true);assert.ok(c.projection.blocks.length);release();await background;
  assert.equal(c.historyComplete,true);assert.ok(c.events.some(e=>e.payload.block_id==='other-block'));
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('onboarding is opt-in and has immediate factual action help',()=>{
 assert.equal(readOnboardingFlag('http://localhost/still',{getItem:()=>null}),false);
 assert.equal(readOnboardingFlag('http://localhost/still?onboarding',{getItem:()=>null}),true);
 assert.equal(readOnboardingFlag('http://localhost/still?onbaording',{getItem:()=>null}),true);
 assert.match(actionHelp('split-context','Split idea'),/smaller/);assert.match(actionHelp('image','Image'),/Required reviews/);
});

test('prepared aggregates retain full evidence and honor forgotten attention on incremental histories',async()=>{
 const {preparedHistory,retainedHistoryEvents,isCreativeHistoryEvent}=await import('../src/still/history.ts');
 const first=[{eventId:'1',sequence:1,type:'BlockCreated',payload:{}},{eventId:'2',sequence:2,type:'AttentionEpisodeObserved',payload:{}}];
 const initial=preparedHistory(first);assert.equal(initial.useful.length,2);
 const next=[...first,{eventId:'3',sequence:3,type:'DocumentRenamed',payload:{}}];
 assert.deepEqual(preparedHistory(next,first).useful,retainedHistoryEvents(next));
 const forgotten=[...next,{eventId:'4',sequence:4,type:'AttentionSignalsForgotten',payload:{before_sequence:8}}];
 const result=preparedHistory(forgotten,next);assert.deepEqual(result.useful,retainedHistoryEvents(forgotten));assert.deepEqual(result.creative,result.useful.filter(isCreativeHistoryEvent));assert.equal(result.counts.AttentionEpisodeObserved,undefined);
 const later=[...forgotten,{eventId:'5',sequence:5,type:'AttentionEpisodeObserved',payload:{}}];assert.deepEqual(preparedHistory(later,forgotten).useful,retainedHistoryEvents(later));
});

test('shared route bootstrap retains selected context and narrowed writing without exposing the context cookie',async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared:true}),saved=globalThis.fetch;
 try{
  const session=await(await f.request('/api/session?profile=still')).json();assert.equal(session.projectContext.contextId,undefined);
  globalThis.fetch=(url,init)=>f.request(url,init);const c=new StillClient();c.position={...c.position,projectId:f.projectId,documentId:f.documentId,view:'document'};
  await c.load({hydrateContent:false,route:{documentId:f.documentId}});assert.ok(c.projection.blocks.some(b=>b.id==='scene-reuse-direction'));assert.deepEqual(c.content,{});
  await c.ensureContent(f.contentRef);assert.deepEqual(Object.keys(c.content),[f.contentRef]);
  const home=await(await f.request('/api/events?stillDocument=&content=0')).json();assert.ok(home.events.some(e=>e.type==='ProjectCreated'));assert.ok(!home.events.some(e=>e.type==='BlockCreated'));
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {readStillHistoryPage,STILL_REPLAY_TYPES} from '../worker/still-history-read.ts';
import {jevRequestState,decisionTiming} from '../src/still/decision-timing.ts';
import {appendAuditEvent} from '../worker/runtime.ts';
const migrate=f=>{for(const file of ['0038_scene_source_generations.sql','0041_still_decision_cache.sql','0044_still_history_cache.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));};
const answers={fit_image:{type:'score',score:3,confidence:.9}};

test('history keeps all reducer input types exact and transport memory bounded',async()=>{
 const source=readFileSync(new URL('../src/model/events.ts',import.meta.url),'utf8');
 assert.deepEqual([...new Set([...source.matchAll(/case "([A-Za-z0-9]+)"/g)].map(m=>m[1]))],STILL_REPLAY_TYPES);
 const f=await createSceneCostFixture(1,'visual');
 try{
  const before=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.streamId).n;
  // 38k historical provider/preflight records: 150+ MB raw, without creating a
  // corresponding JS array. This previously went through two full witnesses.
  const payload=JSON.stringify({document_id:f.documentId,text:'Keep the authored direction',provider_response:'x'.repeat(4096)});
  f.sqlite.prepare(`WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<38000)
  INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload)
  SELECT 'large-'||i,?,?+i,'2026-09-18','2026-09-18','worker:test','test','test',1,'GenerationPreflightRequested',? FROM n`).run(f.streamId,before,payload);
  migrate(f);f.env.JEV_API_KEY='fixture';const saved=globalThis.fetch;let calls=0,queries=[];
  globalThis.fetch=async()=>{calls++;return Response.json({model:'fixture',answers});};
  f.controls.beforeRead=s=>queries.push(s.sql);
  try{
   const input={view:'choose-format',projectId:f.projectId,documentId:f.documentId,developer:true};
   const r=await f.request('/api/still/decision',f.json(input));assert.equal(r.status,200);const first=await r.json();
   assert.equal(first.source,'jev');assert.ok(first.preparation.eventsRead>=38000);assert.ok(first.diagnostics.exchange.request.state.history.eventCounts.GenerationPreflightRequested>=38000);
   assert.ok(!queries.some(sql=>sql.includes('secret.redacted_at,secret.private_json')),'No full-payload witness even on a cold certified read');
   assert.doesNotMatch(JSON.stringify(first),/xxxxxx/);
   // New binding identity simulates a new Worker request/isolate with empty memo.
   f.env.DB={...f.env.DB};queries=[];
   const warm=await (await f.request('/api/still/decision',f.json(input))).json();
   assert.equal(warm.cache.status,'hit');assert.equal(warm.preparation.source,'decision-cache');assert.equal(warm.preparation.eventsRead,0);assert.equal(calls,1);
   assert.ok(!queries.some(sql=>sql.includes('WITH page AS MATERIALIZED')),'Cache checked before history hydration');
  }finally{globalThis.fetch=saved;}
  const page=await readStillHistoryPage(f.env,f.streamId,before,before+38000);
  assert.ok(page.length<=1000);assert.ok(JSON.stringify(page).length<2_000_000);assert.equal(page[0].payload.text,'Keep the authored direction');assert.equal(page[0].payload.provider_response,undefined);
 }finally{await f.drainBackground();f.close();}
});

test('durable reuse respects content, revision, consent, bypass and expiration',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch,realNow=Date.now;let clock=realNow()+4_000_000,calls=0;
 migrate(f);Date.now=()=>clock;f.env.JEV_API_KEY='fixture';
 globalThis.fetch=async()=>{calls++;return Response.json({model:'fixture',answers});};
 const input={view:'choose-format',projectId:f.projectId,documentId:f.documentId,outputId:'saved-scene-story',developer:true};
 const request=async(extra={})=>{const r=await f.request('/api/still/decision',f.json({...input,...extra}));assert.equal(r.status,200);return r.json();};
 try{
  await request();f.env.DB={...f.env.DB};assert.equal((await request()).preparation.source,'decision-cache');assert.equal(calls,1);
  // Retained writing changes without an event append also invalidate reuse.
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('Changed retained content',f.contentRef);
  clock+=2000;assert.notEqual((await request()).preparation.source,'decision-cache');assert.equal(calls,2);
  clock+=2000;assert.equal((await request({cacheBypass:true})).cache.status,'bypass');assert.equal(calls,3);
  clock+=300001;f.env.DB={...f.env.DB};assert.equal((await request()).cache.status,'miss');assert.equal(calls,4);
  await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:'changed',name:'Changed'});clock+=2000;
  assert.notEqual((await request()).preparation.source,'decision-cache');assert.equal(calls,5);
  f.sqlite.prepare('UPDATE users SET consent_version=NULL').run();assert.equal((await f.request('/api/still/decision',f.json(input))).status,428);
 }finally{Date.now=realNow;globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('failed calls cannot claim a received Jev decision',()=>{
 const failed={source:'fallback',reason:'Network unavailable',requestElapsedMs:10960};
 assert.equal(jevRequestState(undefined),'Not Requested');assert.equal(jevRequestState(failed,true),'Pending');assert.equal(jevRequestState(failed),'Failed');assert.equal(decisionTiming(failed).steps.at(-1).label,'Failed');
 assert.equal(jevRequestState({source:'jev'}),'Received');assert.equal(jevRequestState({source:'fallback',trace:{passes:[{status:'answered'}]}}),'Received');
 assert.equal(jevRequestState({source:'fallback',reason:'not_configured'}),'Not Requested');
});

test('bounded history windows preserve full-history counts and focused evidence',async()=>{
 const {createHistoryCollector,installHistorySummary}=await import('../src/still/history.ts');
 const {buildDecisionState}=await import('../src/still/decisions.ts');
 const f=await createSceneCostFixture(1,'visual');
 try{
  const position={view:'artifact',projectId:f.projectId,documentId:f.documentId,blockId:'scene-reuse-direction',outputId:'saved-scene-story',intent:'',recentActions:[]};
  const abilities={author:true,generate:true,projectCreate:true,formats:['image']};
  const tail=Array.from({length:2000},(_,i)=>({eventId:'h'+i,sequence:10000+i,type:['ApplicationViewVisited','GenerationFailed','AttentionEpisodeObserved','ChatMessageAdded'][i%4],occurredAt:'2026-09-18',payload:{document_id:i%3===0?f.documentId:'elsewhere',text:'Evidence '+i}}));
  tail.push({eventId:'forget',sequence:12000,type:'AttentionSignalsForgotten',occurredAt:'2026-09-18',payload:{before_sequence:11800}});
  const events=[...f.events,...tail],collector=createHistoryCollector(position);for(const e of events)collector.accept(e);
  const compact=[...f.events];installHistorySummary(compact,collector.finish());
  const full=buildDecisionState(events,position,abilities,12000,{},f.projection).state.history;
  const bounded=buildDecisionState(compact,position,abilities,12000,{},f.projection).state.history;
  assert.deepEqual(bounded,full);
 }finally{await f.drainBackground();f.close();}
});


test('timings retain original preparation and charge cache persistence to the server',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch,realNow=Date.now;let clock=realNow()+20_000_000;
 migrate(f);Date.now=()=>clock;f.env.JEV_API_KEY='fixture';
 f.controls.beforeRead=s=>{if(s.sql.includes('WITH page AS MATERIALIZED'))clock+=100;};
 f.controls.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT OR REPLACE INTO still_decision_cache')))clock+=700;};
 globalThis.fetch=async()=>{clock+=250;return Response.json({model:'fixture',answers});};
 const input={view:'choose-format',projectId:f.projectId,documentId:f.documentId,developer:true};
 try{
  const first=await(await f.request('/api/still/decision',f.json(input))).json();
  assert.equal(first.delivery.cacheWriteMs,700);assert.ok(first.delivery.serverMs>=first.preparation.totalMs+950);
  assert.equal(first.cache.originalLatencyMs,first.originalTiming.delivery.serverMs);
  f.env.DB={...f.env.DB};
  const cached=await(await f.request('/api/still/decision',f.json(input))).json();
  assert.equal(cached.cache.status,'hit');assert.equal(cached.preparation.source,'decision-cache');
  assert.deepEqual(cached.originalTiming.preparation,first.preparation);
  assert.equal(cached.delivery.serverMs,0);assert.equal(cached.cache.originalLatencyMs,first.cache.originalLatencyMs);
  const timing=decisionTiming({...cached,trace:cached.diagnostics,requestElapsedMs:50});
  assert.ok(timing.steps.some(s=>s.label==='Original preparation'&&s.value==='100 ms'));
  assert.ok(timing.steps.some(s=>s.label==='Original Jev calls'&&s.value==='250 ms'));
 }finally{Date.now=realNow;globalThis.fetch=saved;await f.drainBackground();f.close();}
});

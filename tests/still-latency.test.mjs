import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTIONS,buildDecisionState,questionsFor,comprehensiveQuestionsFor,evaluateActions} from '../src/still/decisions.ts';
import {fetchDecision} from '../src/still/decision-transport.ts';
import {decisionTiming} from '../src/still/decision-timing.ts';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
const pos={view:'projects',projectId:'',documentId:'',blockId:'',outputId:'',intent:'',recentActions:[]};
const abilities={author:true,generate:true,projectCreate:true,formats:['image','video','audio','model3d','scene','short_story','slides','storyboard']};

test('Projects adds one comparative choice to the three relevant questions; pruned answers preserve ranking and constraint penalties',()=>{
 const built=buildDecisionState([],pos,abilities,0);
 assert.equal(Object.keys(comprehensiveQuestionsFor(built.candidates,pos)).length,71);
 assert.deepEqual(Object.keys(questionsFor(built.candidates,pos)),['next_best_action','stage','first_step','use_new-project']);
 let random=1234;const value=()=>{random=(random*1664525+1013904223)>>>0;return random/2**32;};
 for(const position of [pos,{...pos,view:'document',blockId:'b'},{...pos,view:'artifact',outputId:'a'},{...pos,view:'document',intent:'Make an image'}]){
  for(let n=0;n<80;n++){
   const candidates=ACTIONS.filter(()=>value()>.35),all=comprehensiveQuestionsFor(candidates,position,'short_story'),small=questionsFor(candidates,position,'short_story');
   const answers=Object.fromEntries(Object.entries(all).map(([id,q])=>[id,q.type==='noul'?{type:q.type,noul:value()}:q.type==='score'?{type:q.type,score:value()*3,confidence:.9}:{type:q.type,choice:'shape',confidence:.9}]));
   const subset=Object.fromEntries(Object.keys(small).map(k=>[k,answers[k]]));
   const rank=a=>evaluateActions(candidates,position,a).rows.filter(r=>r.rank).map(r=>({id:r.id,value:r.value,rank:r.rank,selected:r.selected}));
   assert.deepEqual(rank(subset),rank(answers));
  }
 }
});

test('initial decision reaches client while enrichment is blocked; final trace and cache remain complete',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch;f.env.JEV_API_KEY='simulated';
 let release,initial,finished=false,calls=0;const gate=new Promise(r=>release=r);
 globalThis.fetch=async(url,init)=>{
  if(String(url).startsWith('/'))return f.request(url,init);
  calls++;const b=JSON.parse(init.body);
  if(b.questions.target_0)await gate;
  return Response.json({model:'fixture',answers:Object.fromEntries(Object.entries(b.questions).map(([id,q])=>[id,q.type==='score'?{type:'score',score:id==='use_use-in'?3:2.2,confidence:.9}:q.type==='noul'?{type:'noul',noul:id.startsWith('conflict_')?0:.5}:{type:'choice',choice:'organize',confidence:.8}]))});
 };
 try{
  let delivered;const ready=new Promise(r=>delivered=r);
  const input={...pos,view:'document',projectId:f.projectId,documentId:f.documentId,blockId:'scene-reuse-direction',developer:true};
  const pending=fetchDecision(input,r=>{initial=r;delivered();}).then(r=>{finished=true;return r;});
  await ready;assert.equal(finished,false);assert.equal(initial.source,'jev');assert.equal(initial.delivery.stage,'initial');assert.ok(initial.actions.length);assert.equal(initial.diagnostics.passes.length,1);
  release();const final=await pending;assert.equal(final.delivery.stage,'complete');assert.equal(final.diagnostics.passes.length,2);assert.equal(final.cache.stored,true);
  const hit=await fetchDecision(input);assert.equal(hit.cache.status,'hit');assert.equal(calls,2);
  const timing=decisionTiming({requestElapsedMs:2700,firstResponseMs:600,preparation:final.preparation,delivery:{stage:'complete',serverMs:2600},trace:final.diagnostics});
  assert.equal(timing.label,'600 ms');assert.ok(timing.steps.some(s=>s.label==='Transport / client'&&s.value==='100 ms'));
 }finally{release();globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('transport preserves first ranking on truncated enrichment; JSON and HTTP failures remain supported',async()=>{
 const saved=globalThis.fetch;
 try{
  const first={source:'jev',head:1,policy:'test',actions:[{id:'new-project'}],delivery:{stage:'initial',serverMs:10}};
  const bytes=new TextEncoder().encode(JSON.stringify({stage:'initial',value:first})+'\n');
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,13));c.enqueue(bytes.slice(13));c.close();}}),{headers:{'content-type':'application/x-ndjson'}});
  let observed;const result=await fetchDecision({},r=>observed=r);assert.equal(observed.source,'jev');assert.equal(result.delivery.enrichment,'interrupted');assert.equal(result.cache,undefined);
  globalThis.fetch=async()=>Response.json({source:'jev'});assert.equal((await fetchDecision({})).source,'jev');
  globalThis.fetch=async()=>Response.json({error:'consent_required'},{status:428});await assert.rejects(fetchDecision({}),e=>e.status===428);
 }finally{globalThis.fetch=saved;}
});

test('warm personal history uses constant-size revision proof; private edits and withdrawals invalidate it',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch;f.env.JEV_API_KEY='simulated';let calls=0;
 f.sqlite.exec(readFileSync(new URL('../drizzle/0038_scene_source_generations.sql',import.meta.url),'utf8'));
 globalThis.fetch=async()=>{calls++;return Response.json({model:'fixture',answers:{fit_image:{type:'score',score:3,confidence:.9}}});};
 const input={...pos,view:'choose-format',projectId:f.projectId,documentId:f.documentId,developer:true};
 const request=async()=>{const r=await f.request('/api/still/decision',f.json(input));assert.equal(r.status,200);return r.json();};
 try{
  await request();let queries=[];f.controls.beforeRead=s=>queries.push(s.sql);f.controls.beforeBatch=ss=>queries.push(...ss.map(s=>s.sql));
  const warm=await request();assert.equal(warm.preparation.source,'snapshot');assert.equal(warm.cache.status,'hit');
  assert.ok(queries.some(sql=>sql.includes('AS generation')&&sql.includes('scene_source_generations')));
  assert.ok(!queries.some(sql=>sql.includes('ORDER BY event.sequence')&&sql.includes('secret.private_json')),'No full witness');
  assert.ok(!queries.some(sql=>sql.includes('SELECT * FROM events LEFT JOIN')),'No event page for unchanged history');
  const row=f.sqlite.prepare("SELECT secret.private_event_id,secret.private_json FROM event_private_payloads secret JOIN events event ON event.event_id=secret.private_event_id WHERE secret.document_id=? AND event.type='BlockCreated' LIMIT 1").get(f.documentId);
  assert.ok(row);const payload=JSON.parse(row.private_json);payload.properties={...payload.properties,text:'PRIVATE ALTERED DIRECTION'};
  f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(payload),row.private_event_id);
  const changed=await request();assert.equal(changed.cache.status,'miss');assert.notEqual(changed.preparation.source,'snapshot');
  f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-09-18' WHERE private_event_id=?").run(row.private_event_id);
  const withdrawn=await request();assert.equal(withdrawn.cache.status,'miss');assert.doesNotMatch(JSON.stringify(withdrawn.diagnostics.exchange.request.state),/PRIVATE ALTERED DIRECTION/);
  await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:'other',name:'New'});
  assert.equal((await request()).cache.status,'miss');assert.ok(calls>=4);
  f.sqlite.exec('DROP TRIGGER scene_source_event_private_payloads_update');
  const unqualified=await request();assert.notEqual(unqualified.preparation.source,'snapshot','Missing revision trigger falls back to fresh history');
 }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

test('rapid distinct navigation requests are allowed, while a bounded burst is still throttled',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch,now=Date.now;const clock=now()+2_000_000;
 f.env.JEV_API_KEY='simulated';Date.now=()=>clock;
 globalThis.fetch=async()=>Response.json({model:'fixture',answers:{fit_image:{type:'score',score:3,confidence:.9}}});
 try{
  for(let i=0;i<9;i++){
   const r=await f.request('/api/still/decision',f.json({...pos,view:'choose-format',projectId:f.projectId,documentId:f.documentId,intent:'navigation '+i}));
   assert.equal(r.status,i===8?429:200);
  }
 }finally{globalThis.fetch=saved;Date.now=now;await f.drainBackground();f.close();}
});

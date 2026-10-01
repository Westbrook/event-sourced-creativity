import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {readStillHistory} from '../worker/still-history.ts';
import {appendAuditEvent} from '../worker/runtime.ts';
import {readStillHistoryPage} from '../worker/still-history-read.ts';
import {buildDecisionState} from '../src/still/decisions.ts';
import {historyStoreKey,loadHistorySnapshot,saveHistorySnapshot,appendOnlyHistory} from '../worker/still-history-store.ts';

async function fixture(){
 const f=await createSceneCostFixture(1,'visual');
 for(const file of ['0038_scene_source_generations.sql','0044_still_history_cache.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 f.user={userId:f.owner,streamId:f.streamId};
 f.read=position=>readStillHistory(new Request('https://test/api/still/decision'),f.env,f.user,'test-scope',undefined,position);
 f.cold=()=>{f.env.DB={...f.env.DB};};return f;
}
const position=f=>({view:'artifact',projectId:f.projectId,documentId:f.documentId,blockId:'scene-reuse-direction',outputId:'saved-scene-story',intent:'',recentActions:[]});
const abilities={author:true,generate:true,projectCreate:true,formats:['image']};
async function assertEvidence(f,result,pos){
 const full=[];let after=0;
 for(;;){const page=await readStillHistoryPage(f.env,f.streamId,after,result.head);if(!page.length)break;full.push(...page);after=page.at(-1).sequence;}
 const expected=buildDecisionState(full,pos,abilities,result.head,{}).state;
 const actual=buildDecisionState(result.events,pos,abilities,result.head,{},result.projection(pos.documentId,pos.projectId)).state;
 assert.deepEqual(actual,expected);
}

test('persistent history survives Worker restarts and changes of selection with exact evidence',async()=>{
 const f=await fixture();
 try{
  for(let i=0;i<90;i++)await appendAuditEvent(f.env,f.streamId,'user',i%2?'ChatMessageAdded':'AttentionEpisodeObserved',{document_id:i%3?'elsewhere':f.documentId,text:'Evidence '+i,expires_at:'2099-01-01T00:00:00Z'});
  const first=await f.read({});assert.equal(first.receipt.source,'fresh');assert.equal(first.receipt.persisted,true);
  f.cold();const pos=position(f),focused=await f.read(pos);
  assert.equal(focused.receipt.source,'persistent-snapshot');assert.equal(focused.receipt.eventsRead,0);assert.ok(focused.receipt.focusedEventsRead>0);
  await assertEvidence(f,focused,pos);
  // Selection-specific windows must not overwrite a concurrent request's state.
  const [a,b]=await Promise.all([f.read(pos),f.read({...pos,documentId:'elsewhere',blockId:'',outputId:''})]);
  await assertEvidence(f,a,pos);await assertEvidence(f,b,{...pos,documentId:'elsewhere',blockId:'',outputId:''});
 }finally{await f.drainBackground();f.close();}
});

test('only appended events are read; edited or removed history forces a rebuild',async()=>{
 const f=await fixture();try{
  await f.read({});
  await appendAuditEvent(f.env,f.streamId,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'scene-reuse-direction',property_path:'text',new_value:'A changed direction'});
  f.cold();const pos=position(f),tail=await f.read(pos);
  assert.equal(tail.receipt.source,'incremental');assert.equal(tail.receipt.eventsRead,1);await assertEvidence(f,tail,pos);
  f.sqlite.exec('DROP TRIGGER events_block_update; DROP TRIGGER events_block_delete');
  f.sqlite.prepare("UPDATE events SET occurred_at='2026-09-20T12:00:00Z' WHERE stream_id=? AND sequence=(SELECT MIN(sequence) FROM events WHERE stream_id=?)").run(f.streamId,f.streamId);
  f.cold();const edited=await f.read(pos);assert.equal(edited.receipt.source,'fresh');await assertEvidence(f,edited,pos);
  f.sqlite.prepare('DELETE FROM events WHERE stream_id=? AND sequence=(SELECT MAX(sequence) FROM events WHERE stream_id=?)').run(f.streamId,f.streamId);
  await appendAuditEvent(f.env,f.streamId,'user','ApplicationViewVisited',{document_id:f.documentId});
  f.cold();assert.equal((await f.read(pos)).receipt.source,'fresh');
  f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-09-20' WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? AND type='BlockCreated' LIMIT 1)").run(f.streamId);
  f.cold();const redacted=await f.read(pos);assert.equal(redacted.receipt.source,'fresh');await assertEvidence(f,redacted,pos);
 }finally{await f.drainBackground();f.close();}
});

test('forgetting attention updates the snapshot and its counts',async()=>{
 const f=await fixture();try{
  await appendAuditEvent(f.env,f.streamId,'user','AttentionEpisodeObserved',{document_id:f.documentId,text:'Private attention',expires_at:'2099-01-01T00:00:00Z'});
  const before=await f.read(position(f));
  await appendAuditEvent(f.env,f.streamId,'user','AttentionSignalsForgotten',{before_sequence:before.head});
  f.cold();const after=await f.read(position(f));assert.equal(after.receipt.source,'incremental');await assertEvidence(f,after,position(f));
 }finally{await f.drainBackground();f.close();}
});

test('cache expiry, corruption, ownership and missing schema fail safely',async()=>{
 const f=await fixture();try{
  await f.read({});const key=await historyStoreKey(f.owner,f.streamId,'test-scope');
  const stored=await loadHistorySnapshot(f.env,key,f.owner);assert.ok(stored);
  assert.equal(await loadHistorySnapshot(f.env,key,'other-user'),undefined);
  await saveHistorySnapshot(f.env,key,f.owner,{...stored,checkpoint:{accessibleEvents:1}});
  assert.equal(await loadHistorySnapshot(f.env,key,f.owner),undefined);
  f.cold();assert.equal((await f.read({})).receipt.source,'fresh');
  f.sqlite.exec('UPDATE still_history_cache SET expires_at=0');f.cold();assert.equal((await f.read({})).receipt.source,'fresh');
  f.sqlite.exec('DROP TABLE still_history_cache');f.cold();assert.equal((await f.read({})).receipt.persisted,false);
 }finally{await f.drainBackground();f.close();}
});


test('append proof rejects replacements, historic writes and epoch changes',()=>{
 const old={version:JSON.stringify(['nonce',1,100,50]),head:50,privateCount:20,checkpoint:{accessibleEvents:50}};
 const counts={events:51,privateBodies:21,tailEvents:1,tailPrivateBodies:1};
 assert.equal(appendOnlyHistory(old,JSON.stringify(['nonce',1,102,51]),counts),true);
 assert.equal(appendOnlyHistory(old,JSON.stringify(['nonce',1,103,51]),counts),false,'Unexplained historic write');
 assert.equal(appendOnlyHistory(old,JSON.stringify(['nonce',2,102,51]),counts),false,'Rebuild epoch');
 assert.equal(appendOnlyHistory(old,JSON.stringify(['other',1,102,51]),counts),false,'Different source instance');
 assert.equal(appendOnlyHistory(old,JSON.stringify(['nonce',1,102,51]),{...counts,events:50}),false,'REPLACE displaced an old row');
 assert.equal(appendOnlyHistory(old,JSON.stringify(['nonce',1,102,51]),{...counts,privateBodies:20}),false,'Private row replacement');
});

test('a source mutation during focused evidence loading invalidates the snapshot',async()=>{
 const f=await fixture();try{
  await f.read({});let mutate=true;
  f.controls.beforeBatch=async statements=>{
   if(mutate&&statements.some(s=>s.sql.includes('ORDER BY event.sequence DESC LIMIT 35'))){
    mutate=false;await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:'during-read',name:'During read'});
   }
  };
  await assert.rejects(f.read(position(f)),/History changed/);
  f.cold();assert.equal((await f.read(position(f))).receipt.source,'fresh');
 }finally{await f.drainBackground();f.close();}
});

test('clock expiry rebuilds unchanged history and excludes phantom and expired evidence from all snapshots',async()=>{
 const f=await fixture(),realNow=Date.now;let now=realNow()+20_000_000;Date.now=()=>now;
 try{
  const future=new Date(now+1000).toISOString(),longSurface='document'.repeat(40);
  await appendAuditEvent(f.env,f.streamId,'user','AttentionEpisodeObserved',{document_id:f.documentId,text:'EXPIRING_ATTENTION',expires_at:future});
  await appendAuditEvent(f.env,f.streamId,'user','AttentionEpisodeObserved',{document_id:f.documentId,text:'PHANTOM_ATTENTION',expires_at:new Date(now+100_000).toISOString(),capture_version:'attention-v2',surface:longSurface,context:longSurface+'-overview',terminal_type:'idle_timeout',terminal_ref:null,active_ms:30_000,idle_ms:30_000,visible_refs:[],friction_score:0,outcome_weight:.08});
  await appendAuditEvent(f.env,f.streamId,'user','AttentionEpisodeObserved',{document_id:f.documentId,text:'MISSING_EXPIRY'});
  const pos=position(f),before=await f.read(pos),key=await historyStoreKey(f.owner,f.streamId,'test-scope');
  const state=result=>buildDecisionState(result.events,pos,abilities,result.head,{},result.projection(pos.documentId,pos.projectId)).state;
  assert.match(JSON.stringify(state(before)),/EXPIRING_ATTENTION/);assert.doesNotMatch(JSON.stringify(state(before)),/PHANTOM_ATTENTION|MISSING_EXPIRY/);
  const stored=await loadHistorySnapshot(f.env,key,f.owner);assert.equal(stored.checkpoint.expiresAt,now+1000);
  assert.equal(f.sqlite.prepare('SELECT expires_at FROM still_history_cache WHERE cache_key=?').get(key).expires_at,now+1000);
  now+=1000;assert.equal(await loadHistorySnapshot(f.env,key,f.owner),undefined);
  const after=await f.read(pos);assert.equal(after.head,before.head);assert.equal(after.receipt.source,'fresh');assert.doesNotMatch(JSON.stringify(state(after)),/EXPIRING_ATTENTION|PHANTOM_ATTENTION|MISSING_EXPIRY/);
  await assertEvidence(f,after,pos);
  f.cold();const cold=await f.read(pos);assert.equal(cold.receipt.source,'persistent-snapshot');assert.doesNotMatch(JSON.stringify(state(cold)),/EXPIRING_ATTENTION|PHANTOM_ATTENTION|MISSING_EXPIRY/);
 }finally{Date.now=realNow;await f.drainBackground();f.close();}
});

test('durable decision reuse ends at evidence expiry even if its creative revision is unchanged',async()=>{
 const f=await fixture(),realNow=Date.now;let now=realNow()+20_000_000;Date.now=()=>now;
 const {writeStoredDecision,readStoredDecision}=await import('../worker/still-decision-store.ts');
 f.sqlite.exec(readFileSync(new URL('../drizzle/0041_still_decision_cache.sql',import.meta.url),'utf8'));
 try{
  const value={response:{source:'jev',head:5,policy:'fixture',actions:[]},contentHash:'hash',evidenceExpiresAt:now+1000};
  await writeStoredDecision(f.env,'retention',f.owner,value);assert.equal((await readStoredDecision(f.env,'retention',f.owner)).expiresAt,now+1000);
  now+=1000;assert.equal(await readStoredDecision(f.env,'retention',f.owner),undefined);
  await writeStoredDecision(f.env,'already-expired',f.owner,value);assert.equal(await readStoredDecision(f.env,'already-expired',f.owner),undefined);
 }finally{Date.now=realNow;await f.drainBackground();f.close();}
});

test('old active preferences survive bounded evidence windows and persistent replay while revoked preferences stay inactive',async()=>{
 const f=await fixture();const {activePreferenceEvidence}=await import('../src/still/history.ts');
 try{
  const kept=await appendAuditEvent(f.env,f.streamId,`user:${f.owner}`,'PreferenceAuthored',{preference_id:'standing',scope:'document',scope_id:f.documentId,value:'Preserve generous whitespace'});
  await appendAuditEvent(f.env,f.streamId,`user:${f.owner}`,'PreferenceAuthored',{preference_id:'withdrawn',scope:'account',value:'Never applies now'});
  for(let i=0;i<90;i++)await appendAuditEvent(f.env,f.streamId,'worker:generator','GenerationFailed',{document_id:f.documentId,text:'Unrelated recent outcome '+i});
  await f.read({});f.cold();const first=await f.read(position(f));assert.equal(first.receipt.source,'persistent-snapshot');
  const active=activePreferenceEvidence(first.events,position(f),`user:${f.owner}`);assert.ok(active.active.some(p=>p.id==='standing'&&p.source.eventId===kept.eventId));
  await appendAuditEvent(f.env,f.streamId,`user:${f.owner}`,'PreferenceRevoked',{preference_id:'withdrawn'});
  f.cold();const next=await f.read(position(f));assert.equal(next.receipt.source,'incremental');
  const current=activePreferenceEvidence(next.events,position(f));assert.deepEqual(current.active.map(p=>p.id),['standing']);assert.equal(current.coverage.revoked,1);await assertEvidence(f,next,position(f));
 }finally{await f.drainBackground();f.close();}
});

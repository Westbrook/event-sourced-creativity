import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionState } from '../src/still/decisions.ts';
import { compactHistoryEvent, localHistoryEvidence, actorEvidence, retainedHistoryEvents, preparedHistory, createHistoryCollector, installHistorySummary, historySummary, historyEvidenceExpiresAt, activePreferenceEvidence } from '../src/still/history.ts';
const event=(sequence,type,payload={})=>({sequence,eventId:`e${sequence}`,type,payload,occurredAt:'2026-09-17T12:00:00Z'});
const position={projectId:'',documentId:'',blockId:'',outputId:'',view:'projects',intent:'',recentActions:[]};
const abilities={author:true,generate:true,projectCreate:true,formats:['image','model3d']};
const base=[event(1,'ProjectCreated',{project_id:'p',name:'Project'}),event(2,'DocumentCreated',{project_id:'p',document_id:'d',title:'Document'})];

test('home recommendations retain creative actions even after a burst of passive views',()=>{
  const events=[...base,event(3,'BlockPropertyEdited',{document_id:'d',block_id:'b',property_path:'text',new_value:'Softer light'}),event(4,'GenerationCompleted',{document_id:'d',object_ids:['o'],output_kind:'image'}),...Array.from({length:200},(_,i)=>event(i+5,'ApplicationViewVisited',{application:'forma',route_family:'document',document_view:'image',document_id:'d'}))];
  const {state}=buildDecisionState(events,position,abilities,204);
  assert.ok(state.history.recent.every(e=>e.type==='ApplicationViewVisited'));
  assert.deepEqual(state.history.recentCreative.slice(-2).map(e=>e.type),['BlockPropertyEdited','GenerationCompleted']);
  assert.equal(state.history.recentCreative.at(-2).property,'text');assert.equal(state.history.recentCreative.at(-1).format,'image');
  assert.equal(state.history.recent.at(-1).view,'image');assert.equal(state.history.recent.at(-1).source,'forma');
  assert.equal(state.history.focused.length,0,'The home page does not imply an active document');
  assert.equal(state.history.coverage.included.recentCreative,state.history.recentCreative.length);
});
test('history budgeting preserves recent creative evidence and reports actual omitted details',()=>{
  const events=[...base,...Array.from({length:100},(_,i)=>event(i+3,'BlockCreated',{project_id:'p',document_id:'d',block_id:`b${i}`,type:'direction',handle:'方向'.repeat(100),position:String(i),properties:{text:'創造的な世界'.repeat(1200),weight:1}}))];
  const {state}=buildDecisionState(events,{...position,projectId:'p',documentId:'d',blockId:'b99',view:'document'},abilities,102);
  assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength<=20000);
  assert.ok(state.history.recentCreative.length>0);assert.equal(state.history.recentCreative.at(-1).sequence,102);
  const samples=['recent','recentCreative','focused','milestones'];
  const unique=new Set(samples.flatMap(key=>state.history[key].map(e=>e.sequence)));
  assert.equal(state.history.coverage.sampledEvents,unique.size);assert.equal(state.history.coverage.omittedEventDetails,events.length-unique.size);
  for(const key of samples)assert.equal(state.history.coverage.included[key],state.history[key].length);
});
test('event evidence uses allowed metadata only and excludes forgotten attention',()=>{
  const raw=event(3,'GenerationCompleted',{document_id:'d',object_ids:['o'],output_kind:'image',status:'completed',authorization:'SECRET',provider_response:{key:'SECRET'},media_url:'https://private.test/?token=SECRET',text:'Reference https://private.test/?token=SECRET'});
  const compact=compactHistoryEvent(raw);assert.equal(compact.status,'completed');assert.deepEqual(compact.objects,['o']);assert.doesNotMatch(JSON.stringify(compact),/SECRET|private.test|authorization|provider_response/);
  const events=[...base,raw,event(4,'AttentionEpisodeObserved',{text:'FORGOTTEN'}),event(5,'AttentionSignalsForgotten',{before_sequence:4}),event(6,'AttentionEpisodeObserved',{text:'New attention',expires_at:'2099-01-01T00:00:00Z'})];
  const {state}=buildDecisionState(events,position,abilities,6);
  assert.doesNotMatch(JSON.stringify(state),/FORGOTTEN|SECRET/);assert.ok(state.history.recent.some(e=>e.text==='New attention'));
  assert.ok(localHistoryEvidence(events).every(e=>!e.type.startsWith('Attention')));
});
test('focused history recognizes output receipts whose targets are arrays',()=>{
  const {state}=buildDecisionState([...base,event(3,'GenerationCompleted',{object_ids:['o'],output_kind:'image'})],{...position,outputId:'o',view:'artifact'},abilities,3);
  assert.equal(state.history.focused.at(-1).sequence,3);
});


test('history preserves causal identity and safe actor relations without exposing actor identifiers',()=>{
  const source={...event(7,'BlockPropertyEdited',{text:'Authored choice'}),actor:'user:private-account',recordedAt:'2026-09-17T12:00:03Z',correlationId:'workflow-1',causationId:'e6',compensatesEventId:'e5',schemaVersion:2};
  const evidence=compactHistoryEvent(source);
  assert.equal(evidence.eventId,'e7');assert.equal(evidence.schemaVersion,2);assert.equal(evidence.at,source.occurredAt);assert.equal(evidence.recordedAt,source.recordedAt);
  assert.equal(evidence.correlationId,'workflow-1');assert.equal(evidence.causationId,'e6');assert.equal(evidence.compensatesEventId,'e5');
  assert.deepEqual(actorEvidence(source,'user:private-account'),{actorKind:'user',actorRelation:'current-user'});
  assert.deepEqual(actorEvidence(source,'user:other-account'),{actorKind:'user',actorRelation:'other-user'});
  assert.deepEqual(actorEvidence({...source,actor:'user'},'user:private-account'),{actorKind:'user',actorRelation:'unknown'});
  assert.deepEqual(actorEvidence({...source,actor:'worker:generator'}),{actorKind:'worker',actorRelation:'system'});
  assert.deepEqual(actorEvidence({...source,actor:'model:assistant'}),{actorKind:'model',actorRelation:'system'});
  assert.doesNotMatch(JSON.stringify(evidence),/private-account/);
});

test('retention matches canonical attention filtering including phantom, missing expiry and forget marker semantics',async()=>{
  const {attentionEvents}=await import('../src/model/attention.ts');
  const now=Date.parse('2026-10-01T00:00:00Z'),future=new Date(now+60_000).toISOString();
  const phantom={expires_at:future,capture_version:'attention-v2',surface:'document',context:'document-overview',terminal_type:'idle_timeout',terminal_ref:null,active_ms:30_000,idle_ms:30_000,visible_refs:[],friction_score:0,outcome_weight:.08};
  const events=[event(1,'AttentionEpisodeObserved',{expires_at:future}),event(2,'AttentionSignalsForgotten',{before_sequence:99}),event(3,'AttentionEpisodeObserved',{expires_at:future}),event(4,'AttentionEpisodeObserved',phantom),event(5,'AttentionEpisodeObserved',{expires_at:new Date(now).toISOString()}),event(6,'AttentionEpisodeObserved',{}),event(7,'BlockCreated',{})];
  assert.deepEqual(retainedHistoryEvents(events,now).filter(e=>e.type.startsWith('Attention')),attentionEvents(events,now));
  assert.deepEqual(retainedHistoryEvents(events,now).map(e=>e.sequence),[3,7]);
  const collector=createHistoryCollector({},undefined,now);events.forEach(e=>collector.accept(e));
  assert.deepEqual(collector.finish().useful.map(e=>e.sequence),[3,7]);assert.equal(collector.finish().counts.AttentionEpisodeObserved,1);
  assert.equal(collector.finish().expiresAt,now+60_000);
});

test('prepared and summarized attention expires without a new event or head',()=>{
  const now=Date.parse('2026-10-01T00:00:00Z'),events=[...base,event(3,'AttentionEpisodeObserved',{text:'EXPIRING',expires_at:new Date(now+1000).toISOString()}),event(4,'AttentionEpisodeObserved',{text:'LATER',expires_at:new Date(now+5000).toISOString()})];
  const original=preparedHistory(events,undefined,now);assert.equal(original.counts.AttentionEpisodeObserved,2);assert.equal(historyEvidenceExpiresAt(events,now),now+1000);
  const refreshed=preparedHistory(events,undefined,now+1000);assert.equal(refreshed.counts.AttentionEpisodeObserved,1);assert.doesNotMatch(JSON.stringify(refreshed),/EXPIRING/);
  const collector=createHistoryCollector({},undefined,now);events.forEach(e=>collector.accept(e));const replay=[...base];installHistorySummary(replay,collector.finish());
  assert.equal(historyEvidenceExpiresAt(replay,now),now+1000);const summary=historySummary(replay,now+1000);assert.equal(summary.counts.AttentionEpisodeObserved,1);assert.equal(summary.expiresAt,now+5000);assert.doesNotMatch(JSON.stringify(summary),/EXPIRING/);
  const expired=historySummary(replay,now+5000);assert.equal(expired.counts.AttentionEpisodeObserved,undefined);assert.equal(expired.summarizedEvents,base.length);
});

test('active preferences are scoped, explicit, revocable and expiring with source evidence',()=>{
  const now=Date.parse('2026-10-01T00:00:00Z');
  const author=(n,payload)=>({...event(n,'PreferenceAuthored',payload),actor:'user:private-account',recordedAt:'2026-10-01T00:00:00Z'});
  const events=[author(1,{preference_id:'account',scope:'account',axis:'composition',value:'Preserve room for text',source_claim_ref:'claim-1'}),author(2,{preference_id:'revoked',scope:'account',value:'Old preference'}),event(3,'PreferenceRevoked',{preference_id:'revoked'}),author(4,{preference_id:'document',scope:'document',scope_id:'d',value:'Relevant here',expires_at:new Date(now+1000).toISOString()}),author(5,{preference_id:'elsewhere',scope:'document',scope_id:'other',value:'UNRELATED'}),author(6,{preference_id:'expired',scope:'account',value:'EXPIRED',expires_at:new Date(now).toISOString()})];
  const evidence=activePreferenceEvidence(events,{documentId:'d'},'user:private-account',now);
  assert.deepEqual(evidence.active.map(p=>p.id),['account','document']);assert.equal(evidence.coverage.revoked,1);assert.equal(evidence.coverage.expired,1);assert.equal(evidence.coverage.outOfScope,1);
  assert.equal(evidence.active[0].source.eventId,'e1');assert.equal(evidence.active[0].source.actorRelation,'current-user');assert.equal(evidence.active[0].source.claimRef,'claim-1');
  assert.doesNotMatch(JSON.stringify(evidence),/private-account|UNRELATED|EXPIRED|Old preference/);
  assert.equal(historyEvidenceExpiresAt(events,now),now+1000);assert.deepEqual(activePreferenceEvidence(events,{documentId:'d'},undefined,now+1000).active.map(p=>p.id),['account']);
});

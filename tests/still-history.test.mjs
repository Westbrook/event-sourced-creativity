import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionState } from '../src/still/decisions.ts';
import { compactHistoryEvent, localHistoryEvidence } from '../src/still/history.ts';
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
  const events=[...base,raw,event(4,'AttentionEpisodeObserved',{text:'FORGOTTEN'}),event(5,'AttentionSignalsForgotten',{before_sequence:4}),event(6,'AttentionEpisodeObserved',{text:'New attention'})];
  const {state}=buildDecisionState(events,position,abilities,6);
  assert.doesNotMatch(JSON.stringify(state),/FORGOTTEN|SECRET/);assert.ok(state.history.recent.some(e=>e.text==='New attention'));
  assert.ok(localHistoryEvidence(events).every(e=>!e.type.startsWith('Attention')));
});
test('focused history recognizes output receipts whose targets are arrays',()=>{
  const {state}=buildDecisionState([...base,event(3,'GenerationCompleted',{object_ids:['o'],output_kind:'image'})],{...position,outputId:'o',view:'artifact'},abilities,3);
  assert.equal(state.history.focused.at(-1).sequence,3);
});

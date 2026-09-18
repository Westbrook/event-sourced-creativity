import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasEventFold,createCanvasTextFold,foldCanvasEvents,foldCanvasText} from '../src/canvas/model.ts';
const event=(sequence,type,payload)=>({eventId:'canvas-'+sequence,streamId:'creative:a',sequence,occurredAt:'2026-09-14T00:00:00Z',recordedAt:'2026-09-14T00:00:00Z',actor:'a',clientId:'a',correlationId:'a',causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const text=(sequence,ops,field='value')=>event(sequence,'CanvasTextApplied',{operation:{object:{item_id:'i'},field,ops}});
export const streamedCanvasFixture=[
  event(1,'ProjectCreated',{project_id:'p'}),
  text(2,[{del:{target:['a',1],len:1}}]),
  text(3,[{ins:{id:['a',1],left:null,chars:'Old'}}]),
  event(4,'CanvasCreated',{canvas_id:'c',project_id:'p',name:'Canvas'}),
  event(5,'CanvasItemPlaced',{canvas_id:'c',item_id:'i',body:'Fallback',source_id:'b',source_kind:'block'}),
  text(6,[{ins:{id:['a',1],left:null,chars:'New'}}]),
  text(7,[{ins:{id:['a',2],left:['a',1],chars:' text'}}]),
  text(8,[{ins:{id:['b',1],left:null,chars:'Title only'}}],'title'),
  event(9,'CanvasRegisterSet',{item_id:'i',prop:'x',value:350,hlc:{pt:10,c:1,site:'a'}}),
  event(10,'CanvasRegisterSet',{item_id:'i',prop:'x',value:10,hlc:{pt:9,c:1,site:'a'}}),
  event(11,'CanvasLockAcquired',{item_id:'i',holder_id:'a',lease_ms:1000}),
  event(12,'StrokeErased',{item_id:'i',stroke_id:'erased'}),
  event(13,'StrokeAdded',{item_id:'i',stroke_id:'erased',operation:{stroke:{points:[1,2]}}}),
  event(14,'StrokeAdded',{item_id:'i',stroke_id:'kept',operation:{stroke:{points:[3,4]}}}),
  event(15,'ContextSetFormalized',{canvas_id:'c',context_set_id:'context',item_ids:['i']}),
  event(16,'ProposalIssued',{canvas_id:'c',project_id:'p',proposal_id:'proposal',item_ids:['i']}),
  event(17,'ProposalAccepted',{proposal_id:'proposal'}),
  event(18,'MembershipAdded',{canvas_id:'c',project_id:'p',membership_id:'member',principal_ref:'a',role:'editor'}),
  event(19,'CanvasItemRemoved',{item_id:'i'}),
  event(20,'CanvasItemRestored',{item_id:'i'}),
];
export const streamedCanvasNow=Date.parse('2026-09-14T00:00:02Z');
for(const pageSize of [1,2,7,256])test(`Canvas and text folds retain exact behavior across ${pageSize}-event pages`,()=>{
  const fold=createCanvasEventFold('p','c',streamedCanvasNow),textFold=createCanvasTextFold('i');
  for(let index=0;index<streamedCanvasFixture.length;index+=pageSize)for(const entry of structuredClone(streamedCanvasFixture.slice(index,index+pageSize))){assert.equal(fold.accept(entry),true);assert.equal(textFold.accept(entry),true);}
  const projection=fold.finish();
  assert.deepEqual(projection,foldCanvasEvents(structuredClone(streamedCanvasFixture),'p','c',streamedCanvasNow));
  assert.equal(textFold.finish(),foldCanvasText(streamedCanvasFixture,'i'));
  assert.equal(projection.items[0].body,'ew text');assert.equal(projection.items[0].x,350);
  assert.equal(projection.items[0].lockedBy,null);assert.deepEqual(projection.items[0].strokes.map(value=>value.id),['kept']);
  assert.deepEqual(projection.contextSets[0].blockIds,['b']);assert.equal(projection.proposals[0].status,'accepted');
  assert.throws(()=>fold.finish(),/already_finished/);assert.throws(()=>fold.accept(streamedCanvasFixture[0]),/already_finished/);
  assert.throws(()=>textFold.finish(),/already_finished/);assert.throws(()=>textFold.accept(streamedCanvasFixture[0]),/already_finished/);
});
test('re-placement and completely deleted text retain legacy fallback semantics',()=>{
  const input=[...streamedCanvasFixture,event(21,'CanvasItemPlaced',{canvas_id:'c',item_id:'i',body:'Replacement'}),text(22,[{del:{target:['a',1],len:99}},{del:{target:['a',2],len:99}}])];
  const fold=createCanvasEventFold('p','c',streamedCanvasNow);for(const entry of input)fold.accept(entry);
  assert.equal(fold.finish().items[0].body,'Replacement');
});

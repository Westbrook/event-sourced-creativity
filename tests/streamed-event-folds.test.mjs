import assert from 'node:assert/strict';
import test from 'node:test';
import {createCreativeEventFold,foldEvents} from '../src/model/events.ts';
import {createStandingConstraintsFold,standingConstraints} from '../src/model/taste.ts';

const definitions=[
  ['ProjectCreated',{project_id:'p',name:'Original'}],
  ['DocumentCreated',{document_id:'d',project_id:'p',title:'Original document'}],
  ['BlockCreated',{block_id:'b',document_id:'d',project_id:'p',type:'direction',position:'a0',properties:{text:'Original'}}],
  ['CollectionCreated',{collection_id:'c',project_id:'p',handle:'work',position:'a0'}],
  ['CollectionItemAdded',{collection_id:'c',item_ref:{document_id:'d'},position:'a0'}],
  ['PreferenceAuthored',{preference_id:'tone',axis:'style',value:'Calm',polarity:'affirm'}],
  ['GenerationCompleted',{generation_id:'g',document_id:'d',model_id:'m',object_ids:['o']}],
  ['DocumentCreated',{document_id:'other',project_id:'p',title:'Other'}],
  ['DocumentRemoved',{document_id:'d',was_current:true,fallback_document_id:'other'}],
  ['PreferenceRevoked',{preference_id:'tone'}],
  ['ProjectCreated',{project_id:'q',name:'Elsewhere'}],
  ['DocumentCreated',{document_id:'q-doc',project_id:'q',title:'Elsewhere document'}],
  ['DocumentRestored',{document_id:'d',was_current:true,fallback_document_id:'other'}],
  ['ProjectOpened',{project_id:'p',previous_project_id:'q'}],
  ['DocumentRenamed',{document_id:'d',new_title:'Restored document'}],
  ['BlockPropertyEdited',{block_id:'b',document_id:'d',property_path:'text',new_value:'Revised'}],
  ['PreferenceAuthored',{preference_id:'tone',axis:'style',value:'Precise',polarity:'forbid'}],
];
const events=definitions.map(([type,payload],i)=>({eventId:`e${i}`,streamId:'creative:fixture',sequence:i+1,
  occurredAt:'2026-09-14T00:00:00Z',recordedAt:'2026-09-14T00:00:00Z',actor:'user',clientId:'test',
  correlationId:'test',causationId:null,compensatesEventId:null,schemaVersion:1,type,payload}));
export const streamedFoldFixture=events;

for(const size of [1,2,7,256])test(`streamed creative and preference folds match array wrappers across ${size}-event pages`,()=>{
  for(const asOf of [0,5,10,Infinity])for(const selection of [['',''],['d','p'],['q-doc','q']]){
    const fold=createCreativeEventFold(asOf,...selection),taste=createStandingConstraintsFold(asOf);
    for(let start=0;start<events.length;start+=size)for(const event of structuredClone(events.slice(start,start+size))){fold.accept(event);taste.accept(event);}
    assert.deepEqual(fold.finish(),foldEvents(structuredClone(events),asOf,...selection));
    assert.deepEqual(taste.finish(),standingConstraints(structuredClone(events),asOf));
  }
});
test('page boundaries do not discard membership needed by a later restoration',()=>{
  const fold=createCreativeEventFold(Infinity,'d','p');
  for(const event of structuredClone(events.slice(0,10)))fold.accept(event);
  for(const event of structuredClone(events.slice(10)))fold.accept(event);
  const result=fold.finish();assert.equal(result.membership.d.collectionId,'c');
  assert.equal(result.documentTitle,'Restored document');assert.equal(result.outputs[0].id,'o');
  assert.equal(result.blocks[0].properties.text,'Revised');
});
test('as-of break is permanent and finalization is single-use',()=>{
  for(const create of [createCreativeEventFold,createStandingConstraintsFold]){
    const fold=create(2);assert.equal(fold.accept(events[0]),true);assert.equal(fold.accept(events[2]),false);
    assert.equal(fold.accept(events[1]),false);fold.finish();
    assert.throws(()=>fold.accept(events[0]),/already_finished/);assert.throws(()=>fold.finish(),/already_finished/);
  }
});

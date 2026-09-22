import test from 'node:test';
import assert from 'node:assert/strict';
import {foldEvents} from '../src/model/events.ts';
import {sharedIdeaEdits,independentIdeaEdits} from '../src/model/shared-idea-edits.ts';
import {sharedIdeaOutputNotices} from '../src/model/shared-idea-output-freshness.ts';
import {validateIdeaMembershipEvents} from '../worker/idea-membership-guards.ts';
const e=(type,payload)=>({type,payload});
const record=inputs=>inputs.map((e,i)=>({...e,eventId:`e${i+1}`,sequence:i+1,streamId:'s',actor:'user',occurredAt:'2026-09-22'}));
const base=[e('ProjectCreated',{project_id:'p',name:'Project'}),e('DocumentCreated',{project_id:'p',document_id:'a',title:'A'}),e('DocumentCreated',{project_id:'p',document_id:'b',title:'B'}),e('BlockCreated',{project_id:'p',document_id:'a',block_id:'idea',type:'direction',handle:'Idea',position:'a',properties:{text:'Original',weight:.8}}),e('BlockDocumentAttached',{project_id:'p',document_id:'b',block_id:'idea',position:'b'})];
const edit=e('BlockPropertyEdited',{project_id:'p',document_id:'a',block_id:'idea',property_path:'text',old_value:'Original',new_value:'Changed'});
const fold=(inputs,doc='a')=>foldEvents(record(inputs),Infinity,doc,'p');
const allocator=()=>{let i=0;return()=>`copy-${++i}`;};
test('shared edit choice uses effective document memberships and ignores unchanged content and local influence',()=>{
 const p=fold(base);assert.equal(sharedIdeaEdits(p,[edit])[0].documents.length,2);
 assert.equal(sharedIdeaEdits(p,[e(edit.type,{...edit.payload,new_value:'Original'})]).length,0);
 assert.equal(sharedIdeaEdits(p,[e('BlockWeightSet',{block_id:'idea',document_id:'a',weight:.2})]).length,0);
});
test('independent edit replaces only this document use, preserving original and local influence',()=>{
 const inputs=[...base,e('BlockWeightSet',{block_id:'idea',document_id:'a',weight:.2})];const p=fold(inputs);const plan=independentIdeaEdits(p,[edit],'a',allocator());
 assert.equal(validateIdeaMembershipEvents(record(inputs),plan.events),null);
 const updated=[...inputs,...plan.events];assert.equal(fold(updated).blocks.length,1);assert.equal(fold(updated).blocks[0].properties.text,'Changed');assert.equal(fold(updated).blocks[0].properties.weight,.2);
 assert.equal(fold(updated,'b').blocks[0].id,'idea');assert.equal(fold(updated,'b').blocks[0].properties.text,'Original');
 assert.equal(fold(updated).libraryBlocks.length,2);
});
test('project Ideas creates unplaced independent idea without changing any document',()=>{
 const plan=independentIdeaEdits(fold(base),[edit],'',allocator());const p=fold([...base,...plan.events]);
 assert.equal(p.blocks[0].properties.text,'Original');assert.equal(p.libraryBlocks.find(b=>b.id===plan.ids.get('idea')).scope,'library');
});
test('forking a shared dependency also isolates its parent relationships',()=>{
 const inputs=[...base,e('BlockCreated',{project_id:'p',document_id:'a',block_id:'child',type:'style',handle:'Child',properties:{text:'Original'}}),e('BlockRelationAdded',{project_id:'p',relation_id:'r',from_block_id:'idea',to_block_id:'child',kind:'context_contains'})];
 const change=e(edit.type,{...edit.payload,block_id:'child'});const plan=independentIdeaEdits(fold(inputs),[change],'a',allocator());
 assert.equal(validateIdeaMembershipEvents(record(inputs),plan.events),null);
 const a=fold([...inputs,...plan.events]),b=fold([...inputs,...plan.events],'b');
 assert.ok(!a.blocks.some(b=>['idea','child'].includes(b.id)));assert.ok(a.blockRelations.some(r=>r.fromBlockId===plan.ids.get('idea')&&r.toBlockId===plan.ids.get('child')));
 assert.equal(b.blocks.find(b=>b.id==='child').properties.text,'Original');
});
const output=(id,versions)=>e('DocumentRenderCompleted',{artifact_id:id,artifact_kind:'short_story',document_id:'b',project_id:'p',title:id,items:[],source_block_versions:versions});
test('shared edit marks rendered output stale; a new output clears it and old outputs stay retained',()=>{
 const before=fold(base,'b').blocks.find(b=>b.id==='idea').sourceEvents.length;
 const rendered=[...base,output('old',[{block_id:'idea',version:before}])];assert.equal(sharedIdeaOutputNotices(fold(rendered),record(rendered)).length,0);
 const changed=[...rendered,edit];const notices=sharedIdeaOutputNotices(fold(changed),record(changed));assert.equal(notices[0].documentId,'b');assert.equal(notices[0].kind,'short_story');
 const refreshed=[...changed,output('new',[{block_id:'idea',version:fold(changed,'b').blocks[0].sourceEvents.length}])];assert.equal(sharedIdeaOutputNotices(fold(refreshed),record(refreshed)).length,0);assert.equal(fold(refreshed).libraryArtifacts.length,2);
});
test('edits made during generation use captured versions, not output completion time',()=>{
 const inputs=[...base,edit,output('late',[{block_id:'idea',version:2}])];assert.equal(sharedIdeaOutputNotices(fold(inputs),record(inputs)).length,1);
});
test('local influence, own-document edits, and edits to unused ideas do not show cross-document warning',()=>{
 for(const change of [e('BlockWeightSet',{block_id:'idea',document_id:'a',weight:.2}),e(edit.type,{...edit.payload,document_id:'b'}),e(edit.type,{...edit.payload,block_id:'unused'})]){
 const inputs=[...base,output('old',[{block_id:'idea',version:2}]),change];assert.equal(sharedIdeaOutputNotices(fold(inputs),record(inputs)).length,0);
 }
});
test('forking after a cross-document edit cannot mark retained old output as current',()=>{
 const changed=[...base,output('old',[{block_id:'idea',version:2}]),edit];
 const plan=independentIdeaEdits(fold(changed,'b'),[e(edit.type,{...edit.payload,document_id:'b',old_value:'Changed',new_value:'Local'})],'b',allocator());
 const inputs=[...changed,...plan.events];assert.equal(sharedIdeaOutputNotices(fold(inputs),record(inputs)).length,1);
});
test('global default influence and authored relationships require a shared choice, document influence does not',()=>{
 const p=fold(base);assert.equal(sharedIdeaEdits(p,[e('BlockWeightSet',{block_id:'idea',scope:'library',previous_weight:.8,weight:.2})]).length,1);
 assert.equal(sharedIdeaEdits(p,[e('BlockRelationAdded',{relation_id:'r',from_block_id:'idea',to_block_id:'other',kind:'reference'})]).length,1);
 assert.equal(sharedIdeaEdits(p,[e('BlockPropertyEdited',{block_id:'idea',document_id:'a',property_path:'weight',old_value:.8,new_value:.2})]).length,0);
});

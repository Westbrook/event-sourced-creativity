import {buildVectorIndex} from '../src/model/indexing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {foldEvents} from '../src/model/events.ts';
import {attachIdeaEvents} from '../src/model/project-ideas.ts';
import {validateIdeaMembershipEvents,projectOwnedIdeaInput} from '../worker/idea-membership-guards.ts';
import {useInPlan} from '../src/still/use-in.ts';
import {parseStillRoute,stillPath,stillRouteProblem} from '../src/still/routes.ts';
import {buildDecisionState} from '../src/still/decisions.ts';
import {evaluateLocalActions} from '../src/still/local-policy.ts';
const event=(type,payload)=>({type,payload});
const record=inputs=>inputs.map((e,i)=>({...e,eventId:`e${i+1}`,sequence:i+1,streamId:'creative:owner',actor:'user',occurredAt:'2026-09-21'}));
const base=[event('ProjectCreated',{project_id:'p',name:'Project'}),event('DocumentCreated',{project_id:'p',document_id:'a',title:'A'}),event('BlockCreated',{block_id:'idea',type:'direction',handle:'Idea',position:'a',properties:{text:'Original',weight:.8}}),event('BlockCreated',{block_id:'copy',type:'direction',handle:'Existing fork',position:'b',properties:{text:'Original',copied_from_block_id:'idea'}}),event('DocumentCreated',{project_id:'p',document_id:'b',title:'B'})];
const attach=event('BlockDocumentAttached',{project_id:'p',document_id:'b',block_id:'idea',position:'z'});
const fold=(inputs,doc='a')=>foldEvents(record(inputs),Infinity,doc,'p');
test('legacy implicit ownership preserves identities and project library includes every active document idea',()=>{
 const p=fold(base);assert.equal(p.libraryBlocks.length,2);assert.deepEqual(p.blocks.map(b=>b.id),['idea','copy']);assert.equal(p.libraryBlocks[0].projectId,'p');assert.equal(fold(base,'b').blocks.length,0);
});
test('Use in another document shares identity and edits while existing forks remain independent',()=>{
 const position={projectId:'p',documentId:'a',blockId:'idea',outputId:'',view:'document',intent:'',recentActions:[]};
 const plan=useInPlan(record(base),position,'idea','document:b',()=>{throw new Error('Must not allocate another idea');});
 assert.equal(plan.mode,'link');assert.equal(plan.rootId,'idea');assert.deepEqual(plan.events.map(e=>e.type),['BlockDocumentAttached']);
 const inputs=[...base,...plan.events,event('BlockPropertyEdited',{block_id:'idea',document_id:'b',property_path:'text',new_value:'Shared edit'})];
 for(const doc of ['a','b'])assert.equal(fold(inputs,doc).blocks.find(b=>b.id==='idea').properties.text,'Shared edit');
 assert.equal(fold(inputs).libraryBlocks.find(b=>b.id==='copy').properties.text,'Original');
 assert.equal(fold(inputs).libraryBlocks.length,2);
});
test('local ordering and influence do not change another document; detach retains the idea and attach restores use',()=>{
 const inputs=[...base,attach,event('BlockWeightSet',{block_id:'idea',document_id:'b',weight:.2}),event('BlockPropertyEdited',{block_id:'idea',document_id:'b',property_path:'position',new_value:'first'})];
 assert.equal(fold(inputs,'a').blocks[0].properties.weight,.8);assert.equal(fold(inputs,'b').blocks[0].properties.weight,.2);assert.equal(fold(inputs,'b').blocks[0].position,'first');
 const detached=[...inputs,event('BlockDocumentDetached',{project_id:'p',document_id:'b',block_id:'idea'})];
 assert.equal(fold(detached,'b').blocks.length,0);assert.equal(fold(detached,'b').libraryBlocks.length,2);assert.equal(fold([...detached,attach],'b').blocks[0].id,'idea');
});
test('connected dependencies follow shared roots without copying; removing a required child is rejected',()=>{
 const inputs=[...base,event('BlockRelationAdded',{project_id:'p',relation_id:'r',from_block_id:'idea',to_block_id:'copy',kind:'context_contains'}),attach];
 assert.deepEqual(new Set(fold(inputs,'b').blocks.map(b=>b.id)),new Set(['idea','copy']));
 assert.equal(validateIdeaMembershipEvents(record(inputs),[event('BlockDocumentDetached',{project_id:'p',document_id:'b',block_id:'copy'})]).error,'idea_required_by_document_group');
 const adjusted=[...inputs,event('BlockWeightSet',{block_id:'copy',document_id:'b',weight:0}),event('BlockDocumentDetached',{project_id:'p',document_id:'b',block_id:'idea'})];
 assert.equal(fold(adjusted,'b').blocks.length,0,'local override does not create an independent membership');
});
test('new document removals retain project ideas while historical removals and explicit idea deletion stay removed',()=>{
 const removed=event('DocumentRemoved',{document_id:'a'});
 assert.equal(fold([...base,removed],'b').libraryBlocks.length,0);
 assert.equal(fold([...base,projectOwnedIdeaInput(removed)],'b').libraryBlocks.length,2);
 assert.equal(fold([...base,attach,removed],'b').blocks[0].id,'idea');
 assert.equal(fold([...base,attach,event('BlockRemoved',{block_id:'idea'})],'b').blocks.length,0);
 assert.equal(fold([...base,attach,event('BlockRemoved',{block_id:'idea'}),event('BlockRestored',{block_id:'idea'})],'b').blocks[0].id,'idea');
});
test('membership admission rejects foreign projects and protected records',()=>{
 assert.equal(validateIdeaMembershipEvents(record(base),[attach]),null);
 assert.equal(validateIdeaMembershipEvents(record(base),[event(attach.type,{...attach.payload,project_id:'foreign'})]).error,'idea_membership_scope_denied');
 const protectedInputs=[...base,event('BlockCreated',{project_id:'p',scope:'library',block_id:'output',type:'output',properties:{}})];
 assert.equal(validateIdeaMembershipEvents(record(protectedInputs),[event(attach.type,{...attach.payload,block_id:'output'})]).error,'idea_membership_protected');
 const p=fold(protectedInputs);assert.throws(()=>attachIdeaEvents(p.libraryBlocks.find(b=>b.id==='output'),'b',p.libraryBlocks,p.libraryBlockRelations),/protected/);
});
test('Still project landing remains Documents; View ideas is available and first locally even for viewers',()=>{
 assert.equal(parseStillRoute('/still/project/p').view,'documents');
 const route=parseStillRoute('/still/project/p/ideas/block/idea/action/edit-block');assert.equal(stillPath(route),'/still/project/p/ideas/block/idea/action/edit-block');assert.equal(stillRouteProblem(route,fold(base)),'');
 const position={projectId:'p',documentId:'',blockId:'',outputId:'',view:'documents',intent:'',recentActions:[]};
 const abilities={author:false,projectCreate:false,generate:false,formats:[]};const {state,candidates,projection}=buildDecisionState(record(base),position,abilities,5);
 assert.equal(state.toolbarDecision.defaultAction,'ideas');assert.equal(evaluateLocalActions(candidates,projection,position).selected[0].id,'ideas');
});

test('shared ideas inherit collection visibility from each document without duplicating index records',()=>{
 const inputs=[...base,attach,event('CollectionCreated',{project_id:'p',collection_id:'folder',handle:'Folder'}),event('CollectionItemAdded',{collection_id:'folder',item_ref:{document_id:'b'},position:'a'})];
 const items=buildVectorIndex(record(inputs)).filter(item=>item.id==='idea');
 assert.equal(items.length,1);assert.ok(items[0].collectionIds.includes('folder'));
});

test('a surviving Library relationship never resurrects ideas hidden by a historical document removal',()=>{
 const inputs=[...base,event('BlockCreated',{project_id:'p',scope:'library',block_id:'root',type:'direction',properties:{text:'Reusable root'}}),event('BlockRelationAdded',{project_id:'p',relation_id:'r',from_block_id:'root',to_block_id:'idea',kind:'context_contains'}),event('DocumentRemoved',{document_id:'a'})];
 assert.deepEqual(fold(inputs,'b').libraryBlocks.map(b=>b.id),['root']);
 assert.deepEqual(fold([...inputs,event('BlockDocumentAttached',{project_id:'p',document_id:'b',block_id:'root'})],'b').blocks.map(b=>b.id),['root']);
});

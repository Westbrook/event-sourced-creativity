import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {foldEvents} from '../src/model/events.ts';
import {eligibleActions,evaluateActions,rankAllFormats} from '../src/still/decisions.ts';
import {localFormatRules,explicitLocalFormat} from '../src/still/local-policy.ts';
import {decisionDiagnostics} from '../src/still/diagnostics.ts';
const abilities={author:true,generate:true,projectCreate:true,formats:['image','video','audio','model3d','slides','scene','storyboard','short_story']};
const pos={projectId:'p',documentId:'d',blockId:'',outputId:'',view:'document',intent:'',recentActions:[]};
const events=[['ProjectCreated',{project_id:'p',name:'P'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'D'}],...['b','b2'].map(id=>['BlockCreated',{project_id:'p',document_id:'d',block_id:id,type:'subject',handle:id,properties:{text:'An idea',weight:1}}])].map(([type,payload],i)=>({type,payload,eventId:`e${i}`,sequence:i+1,occurredAt:'2026-09-18T12:00:00Z'}));
const projection=foldEvents(events,Infinity,'d','p');
const evaluate=(p,position,access=abilities,answers={})=>evaluateActions(eligibleActions(p,position,access),position,answers,p);
const ids=e=>e.selected.map(a=>a.id);
test('page facts supply useful defaults without filling the toolbar',()=>{
 assert.deepEqual(ids(evaluate(projection,{...pos,view:'projects',projectId:'',documentId:''})),['new-project']);
 assert.deepEqual(ids(evaluate({...projection,blocks:[],libraryBlocks:[]},pos)),['add-context','documents']);
 assert.deepEqual(ids(evaluate(projection,{...pos,blockId:'b'})),['edit-block','context','compose','use-in']);
 const locked=structuredClone(projection);locked.blocks[0].locked=true;
 assert.deepEqual(ids(evaluate(locked,{...pos,blockId:'b'})),['context']);
 assert.ok(eligibleActions(locked,{...pos,blockId:'b'},abilities).some(a=>a.id==='unlock'));
 const excluded=structuredClone(projection);excluded.blocks[0].properties.weight=0;
 assert.deepEqual(ids(evaluate(excluded,{...pos,blockId:'b'})),['toggle-context','edit-block','context']);
 const read=evaluate(projection,{...pos,blockId:'b'},{...abilities,author:false,generate:false});
 assert.deepEqual(ids(read),['context']);assert.ok(read.ranked.some(a=>a.id==='context'));
});
test('only completed work changes continuity; cancelled clicks do not',()=>{
 const selected={...pos,blockId:'b'};
 assert.deepEqual(ids(evaluate(projection,{...selected,recentActions:['split-context']})),ids(evaluate(projection,selected)));
 assert.deepEqual(ids(evaluate(projection,{...selected,recentActions:['split-context','completed:split-context']})),['context','compose','edit-block','use-in']);
 assert.deepEqual(ids(evaluate(projection,{...selected,recentActions:['completed:find-references']})).slice(0,3),['context','use-in','create']);
 const source=readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8');
 assert.match(source,/@context-done=.*rememberCompletion\(mode\)/);
 assert.match(source,/await c\.append\(\[this\.pendingBlock\]\); this\.rememberCompletion/);
 assert.doesNotMatch(source,/@pointerenter=\$\{\(\)=>\{this\.dockTouched=true/);
 assert.match(source,/snapshot!==JSON\.stringify\(this\.decisionPosition\(\)\)/);
});
test('uncertain generation favors status and context without proposing automatic submission',()=>{
 const position={...pos,view:'generation',outputId:'job',generation:{jobId:'job',documentId:'d',format:'image',active:false,mayDuplicateCharge:true,canStartNew:true}};
 assert.deepEqual(ids(evaluate(projection,position)),['refresh-generation','context']);
 assert.ok(eligibleActions(projection,position,abilities).some(a=>a.id==='generate-again'));
 assert.deepEqual(ids(evaluate(projection,{...position,generation:{...position.generation,inspectable:true}})),['inspect-rejection','refresh-generation','context']);
 assert.ok(ids(evaluate(projection,{...position,generation:{...position.generation,mayDuplicateCharge:false}})).includes('generate-again'));
 for(const state of [{failureCode:'provider_submission_uncertain'},{outcomeKind:'unknown-submission'}]){
  assert.ok(!eligibleActions(projection,{...position,generation:{...position.generation,...state}},abilities).some(a=>a.id==='generate-again'),'contradictory canStartNew cannot bypass explicit uncertainty');
 }
});
test('locked project ideas retain review and deliberate unlock discovery without a document selection',()=>{
 const locked=structuredClone(projection);locked.blocks=[];locked.libraryBlocks[0].locked=true;
 const position={...pos,view:'ideas',documentId:'',blockId:'b'};
 assert.deepEqual(ids(evaluate(locked,position)),['ideas']);
 assert.ok(eligibleActions(locked,position,abilities).some(a=>a.id==='unlock'));
 assert.ok(!ids(evaluate(locked,{...position,intent:'I want to unlock this'})).includes('unlock'),'free text is not a local intent interpreter');
});
test('local format preferences stay explicit, document scoped and subordinate to Jev',()=>{
 assert.equal(explicitLocalFormat('Generate a 3D model'),'model3d');
 for(const text of ['not an image','I saw a video','A video would not work','do not generate video'])assert.equal(explicitLocalFormat(text),undefined);
 const p={...projection,artifacts:[{id:'a',kind:'audio',documentId:'d',sequence:8},{id:'other',kind:'video',documentId:'elsewhere',sequence:100}],outputs:[]};
 const position={...pos,view:'choose-format'};
 assert.equal(localFormatRules(p,position)[0].id,'audio');
 assert.equal(localFormatRules(p,{...position,recentActions:['format-choice:slides']})[0].id,'slides');
 assert.equal(localFormatRules(p,{...position,intent:'make an image',recentActions:['format-choice:slides']})[0].id,'image');
 const candidates=eligibleActions(p,position,abilities);
 assert.equal(rankAllFormats(candidates,{}, {projection:p,position})[0],'audio');
 assert.equal(rankAllFormats(candidates,{fit_video:{type:'score',score:3,confidence:.95}}, {projection:p,position})[0],'video');
});
test('developer traces explain the baseline alongside model choices without invented confidence',()=>{
 const selected={...pos,blockId:'b'},answers={use_create:{type:'score',score:3,confidence:.95}};
 const local=decisionDiagnostics(projection,selected,abilities,{source:'fallback',head:4});
 assert.deepEqual(local.localStartingPoint.map(r=>r.id),local.recommended);
 assert.ok(local.localStartingPoint.every(r=>r.reason));
 assert.ok(local.questions.every(q=>q.confidence===undefined));
 const model=decisionDiagnostics(projection,selected,abilities,{source:'jev',head:4,answers,asked:true});
 assert.deepEqual(model.recommended,['create']);assert.deepEqual(model.localStartingPoint,local.localStartingPoint);
});

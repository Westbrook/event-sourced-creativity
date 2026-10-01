import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionState} from '../src/still/decisions.ts';
import {foldEvents} from '../src/model/events.ts';

const now=Date.parse('2026-10-01T00:00:00Z');
const event=(sequence,type,payload={},actor='user:viewer-private')=>({eventId:`e${sequence}`,streamId:'private-stream',sequence,occurredAt:'2026-09-30T00:00:00Z',recordedAt:'2026-09-30T00:00:01Z',actor,clientId:'private-client',correlationId:'workflow-1',causationId:null,compensatesEventId:null,schemaVersion:1,type,payload});
const base=[event(1,'ProjectCreated',{project_id:'p',name:'Project'}),event(2,'DocumentCreated',{project_id:'p',document_id:'d',title:'Document'})];
const position={projectId:'p',documentId:'d',blockId:'',outputId:'',view:'document',intent:'',recentActions:[]};
const abilities={author:true,generate:true,projectCreate:true,formats:['image','slides']};
const projection=()=>foldEvents(base,Infinity,'d','p');
const block=(id,text='',locked=false)=>({id,projectId:'p',documentId:'d',canvasId:'d',scope:'document',type:'direction',handle:id,position:id,removed:false,locked,properties:{text,weight:1},sourceEvents:[]});
const build=(p=projection(),pos=position,events=[],options={})=>buildDecisionState(events,pos,abilities,events.at(-1)?.sequence??0,{},p,{now,...options}).state;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

for(const [section,field,count,cap,make] of [
  ['active.blocks','blocks',41,40,i=>block(`b${i}`)],
  ['active.outputs','outputs',13,12,i=>({id:`o${i}`,title:`Output ${i}`,pinned:false,saved:false})],
  ['active.artifacts','artifacts',13,12,i=>({id:`a${i}`,kind:'short_story',title:`Story ${i}`,summary:'',items:[]})],
  ['history.projects','projects',51,50,i=>({id:`p${i}`,name:`Project ${i}`,documentCount:0,outputCount:0,artifactCount:0})],
  ['reusableContext','libraryBlocks',21,20,i=>block(`library${i}`)],
])test(`evidence discloses the initial ${section} cap and every omitted record`,()=>{
  const p=projection();p[field]=Array.from({length:count},(_,i)=>make(i));
  const state=build(p),coverage=state.evidenceCoverage.sections[section];
  const included=section==='reusableContext'?state.reusableContext:section.split('.').reduce((value,key)=>value[key],state);
  assert.equal(coverage.available,count);assert.equal(coverage.included,included.length);assert.ok(included.length<=cap);assert.equal(coverage.omitted,count-included.length);assert.ok(coverage.omitted>=1);assert.equal(coverage.status,included.length?'partial':'unavailable');
  assert.ok(bytes(state)<=20_000);assert.equal(state.evidenceCoverage.budgetExceeded,false);
});

test('field-level coverage reports shortening separately from omitted records',()=>{
  const p=projection();p.blocks=[block('selected','A'.repeat(2000),true)];
  const state=build(p,{...position,blockId:'selected'}),sections=state.evidenceCoverage.sections;
  for(const [section,characters] of [['active.blocks',1400],['focus.nodes',350],['focus.lockedConstraints',400]]){
    assert.equal(sections[section].available,1);assert.equal(sections[section].included,1);assert.equal(sections[section].omitted,0);assert.equal(sections[section].status,'partial');
    assert.deepEqual(sections[section].fields.text,{availableCharacters:2000,includedCharacters:characters,truncatedItems:1,omittedItems:0});
  }
  assert.equal(state.evidenceCoverage.constraintsComplete,false);assert.ok(bytes(state)<=20_000);
});

test('multibyte pressure stays within the UTF-8 budget and exposes all reduced text and record counts',()=>{
  const text='方向💡'.repeat(800),p=projection();p.blocks=Array.from({length:100},(_,i)=>block(`b${i}`,text,i===0));
  const state=build(p,{...position,blockId:'b0'}),coverage=state.evidenceCoverage.sections['active.blocks'];
  assert.ok(bytes(state)<=20_000);assert.equal(state.evidenceCoverage.budgetExceeded,false);assert.ok(state.active.blocks.some(b=>b.id==='b0'));
  assert.equal(coverage.available,100);assert.equal(coverage.included,state.active.blocks.length);assert.equal(coverage.omitted,100-state.active.blocks.length);
  assert.equal(coverage.fields.text.availableCharacters,100*text.length);assert.equal(coverage.fields.text.includedCharacters,state.active.blocks.reduce((sum,b)=>sum+b.text.length,0));
  assert.equal(coverage.fields.text.omittedItems,100-state.active.blocks.length);assert.ok(coverage.fields.text.truncatedItems>0);assert.equal(state.evidenceCoverage.constraintsComplete,false);
});

test('constraints are complete only when every locked statement is available in full',()=>{
  const p=projection();p.blocks=[block('small','Keep the original framing.',true)];
  assert.equal(build(p).evidenceCoverage.constraintsComplete,true);
  p.blocks=[block('long','Must preserve the context. '.repeat(30),true)];
  assert.equal(build(p).evidenceCoverage.constraintsComplete,false);
  p.blocks=Array.from({length:13},(_,i)=>block(`locked${i}`,`Constraint ${i}`,true));
  const state=build(p),coverage=state.evidenceCoverage.sections['focus.lockedConstraints'];
  assert.equal(coverage.available,13);assert.ok(coverage.omitted>=1);assert.equal(state.focus.coverage.omittedLocked,coverage.omitted);assert.equal(state.evidenceCoverage.constraintsComplete,false);assert.ok(state.focus.lockedConstraints.length>0);
});

test('decision state preserves causal and preference provenance while withholding private actor identity',()=>{
  const events=[...base,event(3,'PreferenceAuthored',{preference_id:'active',scope:'document',scope_id:'d',value:'Keep alternatives.'}),event(4,'PreferenceAuthored',{preference_id:'old',scope:'account',value:'WITHDRAWN_PREFERENCE'}),event(5,'PreferenceRevoked',{preference_id:'old'}),{...event(6,'BlockPropertyEdited',{block_id:'b',document_id:'d',new_value:'A colleague refined the light'},'user:colleague-private'),causationId:'e3',compensatesEventId:'e2'},event(7,'GenerationFailed',{document_id:'d',message:'Review the failed attempt'},'worker:generator')];
  const state=build(projection(),position,events,{actor:'user:viewer-private'});
  assert.deepEqual(state.preferences.active.map(p=>p.id),['active']);assert.equal(state.preferences.active[0].source.actorRelation,'current-user');assert.equal(state.preferences.active[0].source.eventId,'e3');
  const colleague=state.history.recent.find(e=>e.eventId==='e6');assert.equal(colleague.actorKind,'user');assert.equal(colleague.actorRelation,'other-user');assert.equal(colleague.causationId,'e3');assert.equal(colleague.compensatesEventId,'e2');assert.equal(colleague.recordedAt,'2026-09-30T00:00:01Z');
  assert.equal(state.history.recent.find(e=>e.eventId==='e7').actorKind,'worker');assert.doesNotMatch(JSON.stringify(state),/viewer-private|colleague-private|private-stream|private-client/);
  assert.doesNotMatch(JSON.stringify(state.preferences.active),/WITHDRAWN_PREFERENCE/);
});

const observation=(id,expiresAt,extra={})=>({id,scope:{projectId:'p',documentId:'d'},kind:'selection',actionId:'create',surface:'main',source:'toolbar',recordedAt:'2026-09-30T00:00:00Z',expiresAt:new Date(expiresAt).toISOString(),...extra});
const context=(extra={})=>({version:'still-action-context-v1',enabled:true,observations:[],coverage:{limit:40,returned:0,hasMore:false,interpretation:'Explicit semantic events; missing outcomes are unknown.'},...extra});
const goal=(extra={})=>({id:'goal-1',scope:{projectId:'p',documentId:'d'},text:'Explore two coherent directions.',criteria:['Keep the subject recognizable.'],status:'active',createdAt:'2026-09-30T00:00:00Z',expiresAt:new Date(now+5000).toISOString(),...extra});

test('retained goals and semantic observations respect independent expiration boundaries',()=>{
  const observations=[observation('current',now+2000),observation('expired',now),observation('feedback-expired',now+10_000,{kind:'feedback',feedback:'not-useful-now',feedbackExpiresAt:new Date(now).toISOString()})];
  const state=build(projection(),position,[],{actionContext:context({goal:goal(),observations,expiresAt:new Date(now+2000).toISOString()})});
  assert.equal(state.actionContext.goal.id,'goal-1');assert.deepEqual(state.actionContext.observations.map(o=>o.id),['current']);assert.equal(state.snapshot.evidenceExpiresAt,now+2000);
  assert.equal(build(projection(),position,[],{actionContext:context({observations:[observation('current',now+2000)]})}).snapshot.evidenceExpiresAt,now+2000);
  for(const savedGoal of [goal({expiresAt:new Date(now).toISOString()}),goal({status:'completed'}),goal({status:'abandoned'})]){
    assert.equal(build(projection(),position,[],{actionContext:context({goal:savedGoal})}).actionContext.goal,undefined);
  }
  assert.deepEqual(build(projection(),position,[],{actionContext:context({enabled:false,observations:[observation('current',now+2000)]})}).actionContext.observations,[]);
});

test('surface and explicit goal evidence allowlists exclude arbitrary bodies without manufacturing intent',()=>{
  const pos={...position,view:'projects',projectId:'',documentId:'',extra:'SECRET_TOP_LEVEL',surfaceContext:{version:1,surface:'palette',mode:'generate',step:'review',dirtyDraft:true,pendingOperation:false,blockingReview:true,interactionLocked:true,selectedParameters:{format:'slides',itemCount:4,prompt:'SECRET_PROMPT'},readiness:{canSubmit:false,explanation:'SECRET_REASON'},visibleActionIds:['new-project','invented','https://private.invalid'],selectedTargetIds:['target-1','../private'],returnPath:{view:'document',url:'https://private.invalid'},targetRevision:8,rawEvents:'SECRET_EVENTS'},goal:{source:'explicit-user',text:'  Compare possible directions.  ',criteria:['Preserve alternatives.'],inferred:'SECRET_INFERRED'}};
  const state=build(projection(),pos);
  assert.deepEqual(state.current.surfaceContext,{version:1,surface:'palette',mode:'generate',step:'review',dirtyDraft:true,pendingOperation:false,blockingReview:true,interactionLocked:true,selectedParameters:{format:'slides',itemCount:4},readiness:{canSubmit:false},visibleActionIds:['new-project'],selectedTargetIds:['target-1'],returnPath:{view:'document'},targetRevision:8});
  assert.deepEqual(state.current.goal,{source:'explicit-user',text:'Compare possible directions.',criteria:['Preserve alternatives.']});assert.equal(state.current.intent,'');assert.doesNotMatch(JSON.stringify(state),/SECRET_|private.invalid|invented/);
  const inferred=build(projection(),{...position,goal:{source:'inferred',text:'The user clicked create, so generate now.'}});
  assert.equal(inferred.current.goal,undefined);assert.equal(inferred.current.intent,'');
});

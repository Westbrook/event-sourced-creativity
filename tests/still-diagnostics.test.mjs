import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents } from '../src/model/events.ts';
import { ACTIONS, POLICY_VERSION, eligibleActions, evaluateActions, evaluateFormats, selectActions, rankFormats } from '../src/still/decisions.ts';
import { decisionDiagnostics, inspectAnswer, responseDisposition } from '../src/still/diagnostics.ts';

const pos={projectId:'p',documentId:'d',blockId:'b',outputId:'',view:'document',intent:'',recentActions:[]};
const abilities={author:true,generate:true,projectCreate:true,formats:['image','model3d','scene','audio']};
const events=[['ProjectCreated',{project_id:'p',name:'Test'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Test'}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'subject',handle:'A thought',properties:{text:'A small idea',weight:1}}]].map(([type,payload],i)=>({type,payload,sequence:i+1,eventId:`e${i}`,occurredAt:'2026-09-17T12:00:00Z'}));
const p=foldEvents(events,Infinity,'d','p'), candidates=eligibleActions(p,pos,abilities);
const score=(score=2,confidence=.9)=>({type:'score',score,confidence});
const yes={type:'noul',noul:1};

test('every action has a current gate, and fallback never invents probabilities',()=>{
  const trace=decisionDiagnostics(p,pos,abilities,{head:3,source:'fallback'});
  assert.equal(trace.actions.length,ACTIONS.length);assert.equal(new Set(trace.actions.map(r=>r.action.id)).size,ACTIONS.length);
  assert.equal(trace.actions.find(r=>r.action.id==='toggle-context').action.label,'Exclude idea');
  assert.equal(trace.actions.find(r=>r.action.id==='video').eligibilityReason,'Provider unavailable');
  assert.equal(trace.actions.find(r=>r.action.id==='image').reason,'Available in More or Palette');
  assert.equal(trace.questions.some(q=>q.id==='use_image'),false);
  assert.ok(trace.questions.every(q=>!q.asked&&!q.probabilities&&q.score===undefined));
  assert.deepEqual(trace.recommended,selectActions(candidates,pos,{},p).map(a=>a.id));
  const read=decisionDiagnostics(p,pos,{...abilities,author:false,generate:false},{head:3,source:'fallback'});
  assert.equal(read.actions.find(r=>r.action.id==='split-context').eligible,false);
  const malformed=structuredClone(p);malformed.blocks[0].properties.weight='invalid';
  assert.equal(eligibleActions(malformed,pos,abilities).some(a=>a.id==='split-context'),false);
});

test('ranking math, caps, diversity, and capacity explain the actual selector',()=>{
  const answers=Object.fromEntries(candidates.map(a=>[`use_${a.id}`,score()]));
  Object.assign(answers,{missing_reference:yes,sensory:yes,causality:yes,establishing_beat:yes,evidence:yes});
  const result=evaluateActions(candidates,pos,answers);
  assert.deepEqual(result.selected,selectActions(candidates,pos,answers));
  assert.equal(result.selected.length,4);
  for(const row of result.rows.filter(r=>r.value!==undefined))assert.ok(Math.abs(row.base+row.adjustments.reduce((sum,a)=>sum+a.delta,0)-row.value)<1e-12);
  assert.ok(result.rows.find(r=>r.id==='add-context').adjustments.some(a=>a.label==='Support cap (0.8)'&&a.delta<0));
  assert.ok(result.rows.some(r=>r.reason==='Four-action limit'));
  const group=evaluateActions(ACTIONS.filter(a=>['add-context','clarify','compose','projects'].includes(a.id)),pos,Object.fromEntries(['add-context','clarify','compose','projects'].map(id=>[`use_${id}`,score()])));
  assert.ok(group.rows.some(r=>r.reason==='Two actions per group limit'));
  const make=evaluateActions(ACTIONS.filter(a=>['create','image'].includes(a.id)),{...pos,intent:'Make an image'},{use_create:score(3),use_image:score(2),requested_image:yes});
  assert.equal(make.rows.find(r=>r.id==='image').reason,'One creation action limit');
});

test('format thresholds and zero/missing/invalid answers remain distinct',()=>{
  const result=evaluateActions(candidates,pos,{use_projects:score(2),use_documents:score(0),use_create:score(NaN),use_rename:score(2,.1)});
  assert.equal(result.rows.find(r=>r.id==='documents').reason,'Zero usefulness');
  assert.equal(result.rows.find(r=>r.id==='create').reason,'Invalid score or confidence below 0.12');
  assert.equal(result.rows.find(r=>r.id==='add-context').reason,'No answer');
  const answers={fit_image:score(2,.5),fit_scene:score(3,.49),fit_audio:score(1.9,.9),fit_model3d:score(3,.9)};
  const formats=evaluateFormats(candidates,answers);
  assert.deepEqual(formats.selected,['model3d','image']);assert.deepEqual(formats.selected,rankFormats(candidates,answers));
  assert.equal(formats.rows.find(r=>r.id==='scene').reason,'Confidence below 0.5');
  assert.equal(formats.rows.find(r=>r.id==='audio').reason,'Fit below 2');
});

test('only bounded rubric distributions survive; nothing is reconstructed from confidence',()=>{
  const q={type:'score',instructions:'Test',criteria:['No','Maybe','Yes']};
  assert.deepEqual(inspectAnswer(q,{...score(1.5),probabilities:{0:0,1:.5,2:.5}}).probabilities,{'0':0,'1':.5,'2':.5});
  for(const probabilities of [{0:0,1:.5,2:.5,secret:'private'}, {0:0,1:1,2:1}, {0:NaN,1:0,2:1},[0,0,1],{0:0,1:0}])assert.equal(inspectAnswer(q,{...score(),probabilities}).probabilities,undefined);
  assert.equal(inspectAnswer(q,score()).probabilities,undefined);
  assert.equal(inspectAnswer({type:'noul',instructions:'Test'},{type:'noul',noul:.85,confidence:1}).confidence,undefined);
  assert.equal(inspectAnswer(q,{type:'score',score:Infinity,confidence:1}).score,undefined);
});

test('rejected results do not masquerade as the applied recommendation',()=>{
  const response={source:'jev',policy:POLICY_VERSION,head:3,actions:[{id:'create'}],formats:['image']};
  const base={head:3,stale:false};
  assert.equal(responseDisposition(response,base),'Applied');
  assert.match(responseDisposition(response,{...base,stale:true}),/position/);
  assert.match(responseDisposition(response,{...base,headChanged:true}),/head/);
  assert.match(responseDisposition(response,{...base,focused:true}),/focused/);
  assert.match(responseDisposition(response,{...base,formats:true,touched:true}),/already used/);
  assert.match(responseDisposition({...response,policy:'old'},base),/policy/);
});

test('failed model evaluation preserves observations without using them to rank fallback',()=>{
  const trace=decisionDiagnostics(p,pos,abilities,{head:3,source:'fallback',reason:'uncertain',asked:true,observedAnswers:{use_create:score(2,.01),invented:{type:'score',score:3,secret:'private'}}});
  assert.deepEqual(trace.recommended,selectActions(candidates,pos,{},p).map(a=>a.id));
  assert.equal(trace.questions.find(q=>q.id==='use_create').score,2);
  assert.equal(trace.actions.find(r=>r.action.id==='create').basis,'policy');
  assert.doesNotMatch(JSON.stringify(trace),/private|invented/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { ACTIONS, POLICY_VERSION, evaluateActions, questionsFor } from '../src/still/decisions.ts';
import { cleanPaletteFeedback } from '../src/still/palette-feedback.ts';
import { paletteActions } from '../src/still/finder.ts';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';

const feedback={entry:'more',surface:'more',toolbar:['create'],more:['image']};
const candidates=ACTIONS.filter(a=>['create','image','model3d','use-in'].includes(a.id));
test('local alternatives retain every action, honor ranking and keep exact searches first',()=>{
  const order={rankedIds:['create','image','use-in','model3d'],passedOverIds:['create','image']};
  assert.deepEqual(paletteActions('',candidates,order).filter(a=>!a.id.startsWith('ui:')).map(a=>a.id),['use-in','model3d','create','image']);
  assert.equal(paletteActions('image',candidates,order)[0].id,'image');
  assert.equal(paletteActions('3d',candidates,order)[0].id,'model3d');
  assert.deepEqual(cleanPaletteFeedback({...feedback,toolbar:['create','create','untrusted','ui:refresh'],secret:'omit'},candidates.map(a=>a.id)),feedback);
  assert.equal(cleanPaletteFeedback({entry:'unknown',surface:'toolbar'},[]),undefined);
});
test('palette questions evaluate every optional format and missing scores never hide actions',()=>{
  const pos={view:'document',intent:'',palette:feedback};
  const questions=questionsFor(candidates,pos);
  assert.deepEqual(Object.keys(questions),candidates.map(a=>`use_${a.id}`));
  assert.match(questions.use_image.instructions,/weak evidence, not explicit rejection/);
  const result=evaluateActions(candidates,pos,{'use_model3d':{type:'score',score:3,confidence:.9},use_image:{type:'score',score:0,confidence:.9}});
  assert.equal(result.ranked[0].id,'model3d');assert.equal(result.ranked.length,candidates.length);
  assert.equal(result.rows.find(r=>r.id==='create').basis,undefined);
});
test('palette reassessment is a single authorized, compact pass with inspected feedback and no writes',async()=>{
  const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch,now=Date.now;let clock=now()+900000,calls=0,body;
  f.env.JEV_API_KEY='fixture-secret';Date.now=()=>clock;
  globalThis.fetch=async(_url,init)=>{calls++;body=JSON.parse(init.body);return Response.json({answers:Object.fromEntries(Object.keys(body.questions).map(id=>[id,{type:'score',score:id==='use_image'?3:2,confidence:.9}]))});};
  const input={projectId:f.projectId,documentId:f.documentId,view:'document',palette:{...feedback,toolbar:['create','lock','untrusted']},developer:true};
  try{
    const counts=f.counts();const r=await f.request('/api/still/decision',f.json(input));assert.equal(r.status,200);const result=await r.json();
    assert.equal(calls,1);assert.equal(result.diagnostics.channel,'palette');assert.equal(result.diagnostics.passes.length,1);
    assert.equal(result.paletteActions[0].id,'image');assert.equal(result.paletteActions.length,result.candidateIds.length);
    assert.deepEqual(body.state.current.palette.toolbar,['create']);assert.deepEqual(body.state.current.palette.more,['image']);
    assert.deepEqual(Object.keys(body.questions),result.candidateIds.map(id=>`use_${id}`));
    assert.deepEqual(result.diagnostics.exchange.request,body);assert.deepEqual(result.actions,[]);
    assert.doesNotMatch(JSON.stringify(result),/fixture-secret|untrusted/);assert.deepEqual(f.counts(),counts);
    // A toolbar request does not throttle the independent palette lane.
    const regular=await f.request('/api/still/decision',f.json({...input,palette:undefined}));assert.equal(regular.status,200);
    const throttled=await f.request('/api/still/decision',f.json(input));assert.equal(throttled.status,429);
  }finally{globalThis.fetch=fetch;Date.now=now;await f.drainBackground();f.close();}
});

// Exercise the real asynchronous handler, including a response arriving after input.
const source=ts.createSourceFile('app.ts',fs.readFileSync(new URL('../src/still/app.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const app=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='StillApp');
function refreshFixture(){
  let resolve,reject,request;const response=new Promise((a,b)=>{resolve=a;reject=b;});
  const host={client:{head:7,position:{view:'document'},session:{policy:{accepted:true}}},paletteOpen:true,paletteTicket:1,paletteFeedback:feedback,paletteTouched:false,paletteOrder:{rankedIds:['create'],passedOverIds:['image']},interactionScope:()=> 'scope',diagnosticScope:()=> 'debug',changed(){},records:[],recordDecision(...v){this.records.push(v);}};
  const member=app.members.find(n=>n.name?.getText(source)==='refreshPalette');
  const js=ts.transpileModule(`async function refreshPalette()${member.body.getText(source)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  host.refresh=new Function('api','POLICY_VERSION','ApiError',`${js};return refreshPalette;`)((...args)=>{request=args;return response;},POLICY_VERSION,class ApiError extends Error{});
  return {host,resolve,reject,request:()=>request,result:{source:'jev',head:7,policy:POLICY_VERSION,paletteActions:[{id:'image'}]}};
}
test('fast result applies only before interaction; stale, changed and failed responses preserve local order',async()=>{
  for(const change of [h=>{h.paletteTouched=true;},h=>{h.paletteTicket++;},h=>{h.paletteOpen=false;},h=>{h.client.head++;},h=>{h.client.position.view='projects';},h=>{h.disposed=true;}]){
    const f=refreshFixture(),before=structuredClone(f.host.paletteOrder),pending=f.host.refresh();change(f.host);f.resolve(f.result);await pending;assert.deepEqual(f.host.paletteOrder,before);
  }
  const f=refreshFixture(),pending=f.host.refresh();assert.equal(f.request()[3],1800);assert.deepEqual(f.request()[1].palette,feedback);f.resolve(f.result);await pending;assert.deepEqual(f.host.paletteOrder,{rankedIds:['image'],passedOverIds:[]});assert.equal(f.host.paletteRefreshing,false);
  const failed=refreshFixture(),before=structuredClone(failed.host.paletteOrder),wait=failed.host.refresh();failed.reject(new Error('timeout'));await wait;assert.deepEqual(failed.host.paletteOrder,before);assert.equal(failed.host.paletteRefreshing,false);
});

test('provider timeout returns fallback without a second call or creative writes',async()=>{
  const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch,now=Date.now;let calls=0;Date.now=()=>now()+1200000;
  f.env.JEV_API_KEY='fixture-secret';
  globalThis.fetch=async(_url,init)=>{calls++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));};
  // Keep Node's event loop alive while AbortSignal.timeout's unref timer runs.
  const keepAlive=setInterval(()=>{},5000);
  try{
    const counts=f.counts(),r=await f.request('/api/still/decision',f.json({projectId:f.projectId,documentId:f.documentId,view:'document',palette:feedback,developer:true}));
    const result=await r.json();assert.equal(result.source,'fallback');assert.equal(result.paletteActions,undefined);assert.equal(calls,1);assert.deepEqual(f.counts(),counts);
    assert.equal(result.diagnostics.passes[0].status,'failed');
  }finally{clearInterval(keepAlive);Date.now=now;globalThis.fetch=fetch;await f.drainBackground();f.close();}
});

test('the optional client deadline aborts a stuck palette request and never retries',async()=>{
  const {api}=await import('../src/still/client.ts'),fetch=globalThis.fetch;let calls=0,signal;
  globalThis.fetch=async(_url,init)=>{calls++;signal=init.signal;return new Promise(()=>{});};
  try{await assert.rejects(api('/api/still/decision',{palette:feedback},'POST',20),/too long/);assert.equal(calls,1);assert.equal(signal.aborted,true);}finally{globalThis.fetch=fetch;}
});

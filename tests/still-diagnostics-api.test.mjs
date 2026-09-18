import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { ACTIONS } from '../src/still/decisions.ts';

test('authenticated diagnostic opt-in preserves decisions and writes no creative records',async()=>{
  const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch,now=Date.now;
  f.env.JEV_API_KEY='secret-fixture-key';let clock=now(),calls=0,invalid=false,model='simulated-jev',submitted;
  Date.now=()=>clock;
  globalThis.fetch=async(url,init)=>{
    calls++;assert.equal(String(url),'https://api.typesafe.ai/v1/systemone');
    const body=JSON.parse(init.body);submitted=body;assert.equal(body.developer,undefined);assert.equal(body.state.developer,undefined);
    return Response.json({model,secret:'do-not-leak',answers:{fit_image:{type:'score',score:2.5,confidence:invalid?.01:.8,probabilities:{0:0,1:0,2:.5,3:.5},legend:{0:'do-not-leak'}},fit_short_story:{type:'score',score:2,confidence:.1},unknown:{type:'score',score:3,secret:'do-not-leak'}}});
  };
  const input={projectId:f.projectId,documentId:f.documentId,view:'choose-format'};
  const request=async(extra={})=>{clock+=2000;const r=await f.request('/api/still/decision',f.json({...input,cacheBypass:true,...extra}));assert.equal(r.status,200,await r.clone().text());return r.json();};
  try{
    const counts=f.counts(),head=(await (await f.request('/api/events?after=0')).json()).head;
    const ordinary=await request();assert.equal(ordinary.diagnostics,undefined);
    const debug=await request({developer:true,actionLimit:8});assert.equal(debug.diagnostics.exchange.request.state.current.actionLimit,7);assert.deepEqual(debug.formats,ordinary.formats);assert.deepEqual(debug.actions,ordinary.actions);
    assert.deepEqual(debug.diagnostics.exchange.request,submitted);
    assert.equal(debug.diagnostics.exchange.responseStatus,200);
    assert.match(debug.diagnostics.exchange.requestId,/^[0-9a-f-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(debug.diagnostics.exchange.requestedAt)));
    assert.equal(debug.diagnostics.actions.length,ACTIONS.length);
    assert.equal(debug.diagnostics.context.coverage.accessibleEvents,head);
    assert.deepEqual(debug.diagnostics.questions.find(q=>q.id==='fit_image').probabilities,{0:0,1:0,2:.5,3:.5});
    assert.doesNotMatch(JSON.stringify(debug),/secret-fixture-key|do-not-leak/);
    assert.ok(!debug.diagnostics.questions.some(q=>q.id==='unknown'));
    model=42;const malformed=await request({developer:true});assert.equal(malformed.source,'jev');assert.deepEqual(malformed.formats,ordinary.formats);assert.equal(malformed.diagnostics.model,undefined);
    invalid=true;const uncertain=await request({developer:true});assert.equal(uncertain.reason,'uncertain');assert.equal(uncertain.diagnostics.questions.find(q=>q.id==='fit_image').confidence,.01);assert.deepEqual(uncertain.formats,[]);
    const home=await request({developer:true,projectId:'',documentId:'',view:'projects'});
    assert.deepEqual(home.diagnostics.exchange.request,submitted);
    assert.ok(submitted.state.history.recentCreative.some(e=>e.type==='DocumentRenderCompleted'));
    assert.equal(submitted.state.history.focused.length,0);
    assert.equal(home.diagnostics.context.coverage.included.recentCreative,submitted.state.history.recentCreative.length);
    delete f.env.JEV_API_KEY;const fallback=await request({developer:true});assert.equal(fallback.reason,'not_configured');assert.ok(fallback.diagnostics.questions.every(q=>!q.asked&&!q.probabilities));assert.equal(fallback.diagnostics.exchange,undefined);
    clock+=2000;const denied=await f.request('/api/still/decision',f.json({...input,documentId:'not-accessible',developer:true}));
    assert.equal(denied.status,409);assert.equal((await denied.json()).diagnostics,undefined);
    assert.equal(calls,5);assert.deepEqual(f.counts(),counts);assert.equal((await (await f.request('/api/events?after=0')).json()).head,head);
  }finally{globalThis.fetch=fetch;Date.now=now;await f.drainBackground();f.close();}
});

test('failed responses retain the exact attempted request without replay or invented delivery',async()=>{
  const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch,now=Date.now;
  f.env.JEV_API_KEY='secret-fixture-key';let clock=now()+120000,calls=0,submitted,respond;
  Date.now=()=>clock;
  globalThis.fetch=async(_url,init)=>{calls++;submitted=JSON.parse(init.body);return respond();};
  const input={projectId:f.projectId,documentId:f.documentId,view:'choose-format',developer:true};
  try{
    const counts=f.counts();
    const cases=[
      [()=>new Response(null,{status:429}),'busy',429],
      [()=>new Response(null,{status:500}),'unavailable',500],
      [()=>{throw new Error('transport unavailable');},'unavailable',undefined],
      [()=>new Response('{',{headers:{'content-type':'application/json'}}),'unavailable',200],
      [()=>Response.json({model:'simulated-jev'}),'uncertain',200],
    ];
    const ids=new Set();
    for(const [response,reason,status] of cases){
      respond=response;clock+=2000;
      const result=await f.request('/api/still/decision',f.json(input));assert.equal(result.status,200);
      const body=await result.json(),e=body.diagnostics.exchange;
      assert.equal(body.reason,reason);assert.deepEqual(e.request,submitted);assert.equal(e.responseStatus,status);ids.add(e.requestId);
      assert.ok(body.diagnostics.questions.every(q=>q.asked));assert.doesNotMatch(JSON.stringify(e),/secret-fixture-key|authorization/);
    }
    assert.equal(ids.size,cases.length);assert.equal(calls,cases.length);assert.deepEqual(f.counts(),counts);
  }finally{globalThis.fetch=fetch;Date.now=now;await f.drainBackground();f.close();}
});

test('request snapshots use the authorized shared scope and ignore client-supplied state',async()=>{
  const f=await createSceneCostFixture(1,'visual',{shared:true}),fetch=globalThis.fetch,now=Date.now;
  const {appendAuditEvent}=await import('../worker/runtime.ts');
  await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:'unshared-project',name:'OUTSIDE_SHARED_SCOPE'});
  await appendAuditEvent(f.env,f.streamId,'user','DocumentCreated',{project_id:'unshared-project',document_id:'unshared-document',title:'OUTSIDE_SHARED_SCOPE'});
  f.env.JEV_API_KEY='secret-fixture-key';Date.now=()=>now()+240000;
  let submitted;
  globalThis.fetch=async(_url,init)=>{submitted=JSON.parse(init.body);return Response.json({answers:{fit_image:{type:'score',score:3,confidence:.9}}});};
  try{
    const r=await f.request('/api/still/decision',f.json({projectId:f.projectId,documentId:f.documentId,view:'choose-format',developer:true,state:{injected:'CLIENT_INJECTED_STATE'}}));
    assert.equal(r.status,200,await r.clone().text());const body=await r.json();
    assert.deepEqual(body.diagnostics.exchange.request,submitted);
    assert.equal(submitted.state.current.projectId,f.projectId);
    assert.doesNotMatch(JSON.stringify(body),/OUTSIDE_SHARED_SCOPE|CLIENT_INJECTED_STATE|secret-fixture-key/);
  }finally{globalThis.fetch=fetch;Date.now=now;await f.drainBackground();f.close();}
});

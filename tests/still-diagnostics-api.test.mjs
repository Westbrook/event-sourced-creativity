import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { ACTIONS } from '../src/still/decisions.ts';

test('authenticated diagnostic opt-in preserves decisions and writes no creative records',async()=>{
  const f=await createSceneCostFixture(1,'visual'),fetch=globalThis.fetch,now=Date.now;
  f.env.JEV_API_KEY='secret-fixture-key';let clock=now(),calls=0,invalid=false,model='simulated-jev';
  Date.now=()=>clock;
  globalThis.fetch=async(url,init)=>{
    calls++;assert.equal(String(url),'https://api.typesafe.ai/v1/systemone');
    const body=JSON.parse(init.body);assert.equal(body.developer,undefined);assert.equal(body.state.developer,undefined);
    return Response.json({model,secret:'do-not-leak',answers:{fit_image:{type:'score',score:2.5,confidence:invalid?.01:.8,probabilities:{0:0,1:0,2:.5,3:.5},legend:{0:'do-not-leak'}},fit_short_story:{type:'score',score:2,confidence:.1},unknown:{type:'score',score:3,secret:'do-not-leak'}}});
  };
  const input={projectId:f.projectId,documentId:f.documentId,view:'choose-format'};
  const request=async(extra={})=>{clock+=2000;const r=await f.request('/api/still/decision',f.json({...input,...extra}));assert.equal(r.status,200,await r.clone().text());return r.json();};
  try{
    const counts=f.counts(),head=(await (await f.request('/api/events?after=0')).json()).head;
    const ordinary=await request();assert.equal(ordinary.diagnostics,undefined);
    const debug=await request({developer:true});assert.deepEqual(debug.formats,ordinary.formats);assert.deepEqual(debug.actions,ordinary.actions);
    assert.equal(debug.diagnostics.actions.length,ACTIONS.length);
    assert.equal(debug.diagnostics.context.coverage.accessibleEvents,head);
    assert.deepEqual(debug.diagnostics.questions.find(q=>q.id==='fit_image').probabilities,{0:0,1:0,2:.5,3:.5});
    assert.doesNotMatch(JSON.stringify(debug),/secret-fixture-key|do-not-leak|unknown/);
    model=42;const malformed=await request({developer:true});assert.equal(malformed.source,'jev');assert.deepEqual(malformed.formats,ordinary.formats);assert.equal(malformed.diagnostics.model,undefined);
    invalid=true;const uncertain=await request({developer:true});assert.equal(uncertain.reason,'uncertain');assert.equal(uncertain.diagnostics.questions.find(q=>q.id==='fit_image').confidence,.01);assert.deepEqual(uncertain.formats,[]);
    delete f.env.JEV_API_KEY;const fallback=await request({developer:true});assert.equal(fallback.reason,'not_configured');assert.ok(fallback.diagnostics.questions.every(q=>!q.asked&&!q.probabilities));
    clock+=2000;const denied=await f.request('/api/still/decision',f.json({...input,documentId:'not-accessible',developer:true}));
    assert.equal(denied.status,409);assert.equal((await denied.json()).diagnostics,undefined);
    assert.equal(calls,4);assert.deepEqual(f.counts(),counts);assert.equal((await (await f.request('/api/events?after=0')).json()).head,head);
  }finally{globalThis.fetch=fetch;Date.now=now;await f.drainBackground();f.close();}
});

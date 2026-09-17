import test from 'node:test';import assert from 'node:assert/strict';import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
test('isolated Jev experiment authenticates, validates, throttles, captures bounded answers and writes no creative data',async()=>{
 const f=await createSceneCostFixture(1,'visual'),originalFetch=globalThis.fetch,now=Date.now;let clock=now()+400000,calls=0;Date.now=()=>clock;f.env.JEV_API_KEY='secret-fixture-key';
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://api.typesafe.ai/v1/systemone');const body=JSON.parse(init.body);assert.equal(body.model,'jev-latest');assert.deepEqual(body.state,{copied:'edited'});return Response.json({model:'simulated-jev',secret:'do-not-leak',answers:{q:{type:'score',score:2.5,confidence:.9,probabilities:{0:0,1:0,2:.5,3:.5},secret:'do-not-leak'},other:{secret:'do-not-leak'}}});};
 const input={state:{copied:'edited'},questions:{q:{type:'score',instructions:'Rate',criteria:['0','1','2','3']}}};
 try{const counts=f.counts(),head=(await(await f.request('/api/events?after=0')).json()).head;
 const invalid=await f.request('/api/still/experiment',f.json({state:{},questions:{}}));assert.equal(invalid.status,400);assert.equal(calls,0);
 const r=await f.request('/api/still/experiment',f.json(input));assert.equal(r.status,200,await r.clone().text());const result=await r.json();assert.equal(result.isolated,true);assert.equal(result.pass.status,'answered');assert.deepEqual(result.pass.exchange.request.state,input.state);assert.equal(result.pass.questions.length,1);assert.equal(result.pass.questions[0].score,2.5);assert.doesNotMatch(JSON.stringify(result),/secret-fixture-key|do-not-leak/);
 assert.equal((await f.request('/api/still/experiment',f.json(input))).status,429);assert.equal(calls,1);assert.deepEqual(f.counts(),counts);assert.equal((await(await f.request('/api/events?after=0')).json()).head,head);
 clock+=4000;assert.equal((await f.request('/api/still/experiment',f.json({...input,state:{large:'a'.repeat(61000)}}))).status,413);assert.equal(calls,1);
 delete f.env.JEV_API_KEY;assert.equal((await f.request('/api/still/experiment',f.json(input))).status,503);
 }finally{globalThis.fetch=originalFetch;Date.now=now;}
});

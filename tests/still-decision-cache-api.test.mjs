import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { appendAuditEvent } from '../worker/runtime.ts';

test('server memo hits exact authorized input, coalesces, expires and bypasses; changes and errors miss',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch,now=Date.now;let clock=now()+900000,calls=0,release,entered;
 Date.now=()=>clock;f.env.JEV_API_KEY='cache-test-only';
 let failure=false,gate;
 globalThis.fetch=async(url)=>{assert.equal(String(url),'https://api.typesafe.ai/v1/systemone');calls++;entered?.();if(gate)await gate;
  return failure?new Response(null,{status:503}):Response.json({model:'simulated-jev',answers:{fit_image:{type:'score',score:3,confidence:.9}}});};
 const base={view:'choose-format',projectId:f.projectId,documentId:f.documentId,developer:true};
 const request=async(extra={})=>{const r=await f.request('/api/still/decision',f.json({...base,...extra}));assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{
  const first=await request();assert.equal(first.cache.status,'miss');assert.equal(first.cache.stored,true);assert.equal(calls,1);
  clock+=100;const hit=await request();assert.equal(hit.cache.status,'hit');assert.equal(calls,1);assert.equal(hit.diagnostics.exchange.requestId,first.diagnostics.exchange.requestId);
  assert.doesNotMatch(JSON.stringify(hit),/cache-test-only|authorization/);
  clock+=2000;const fresh=await request({cacheBypass:true});assert.equal(fresh.cache.status,'bypass');assert.equal(calls,2);assert.notEqual(fresh.diagnostics.exchange.requestId,first.diagnostics.exchange.requestId);
  clock+=300001;assert.equal((await request()).cache.status,'miss');assert.equal(calls,3);
  clock+=2000;assert.equal((await request({recentActions:['ui:more']})).cache.status,'miss');
  clock+=2000;assert.equal((await request({actionLimit:7})).cache.status,'miss');
  // The same sequence number is not enough: authoritative retained content and abilities are included too.
  await appendAuditEvent(f.env,f.streamId,'user','BlockCreated',{project_id:f.projectId,document_id:f.documentId,block_id:'cache-new-block',scope:'document',type:'style',handle:'Light',position:'z',properties:{text:'Different direction'}});
  clock+=2000;assert.equal((await request()).cache.status,'miss');
  const before=calls;clock+=2000;const ready=new Promise(r=>{entered=r;});gate=new Promise(r=>{release=r;});
  const a=request({intent:'concurrent'});await ready;const b=request({intent:'concurrent'});
  // Let the second request complete its authorized reads before releasing the provider.
  await new Promise(r=>setTimeout(r,100));release();const pair=await Promise.all([a,b]);gate=undefined;entered=undefined;
  assert.deepEqual(pair.map(x=>x.cache.status).sort(),['miss','shared']);assert.equal(calls,before+1);
  failure=true;clock+=2000;const failed=await request({intent:'failure'});assert.equal(failed.source,'fallback');assert.equal(failed.cache.stored,false);
  clock+=2000;const failedAgain=await request({intent:'failure'});assert.equal(failedAgain.cache.status,'miss');
  delete f.env.JEV_API_KEY;clock+=2000;const unconfigured=await request();assert.equal(unconfigured.reason,'not_configured');assert.equal(unconfigured.cache.stored,false);
  const denied=await f.request('/api/still/decision',f.json({...base,documentId:'outside-scope'}));assert.equal(denied.status,409);assert.equal((await denied.json()).cache,undefined);
 }finally{release?.();globalThis.fetch=saved;Date.now=now;await f.drainBackground();f.close();}
});


test('cache reuse is fenced by current consent and personal/shared authorization scopes',async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared:true}),saved=globalThis.fetch,now=Date.now;let clock=now()+1_900_000,calls=0;
 Date.now=()=>clock;f.env.JEV_API_KEY='cache-scope-test';
 globalThis.fetch=async()=>{calls++;return Response.json({model:'simulated-jev',answers:{fit_image:{type:'score',score:3,confidence:.9}}});};
 const input={view:'choose-format',projectId:f.projectId,documentId:f.documentId,developer:true};
 const request=()=>f.request('/api/still/decision',f.json(input));
 try{
  assert.equal((await (await request()).json()).cache.status,'miss');
  assert.equal((await (await request()).json()).cache.status,'hit');assert.equal(calls,1);
  f.setScopedHeaders({});clock+=2000;
  assert.equal((await (await request()).json()).cache.status,'miss');assert.equal(calls,2);
  assert.equal((await (await request()).json()).cache.status,'hit');
  f.env.FAL_KEY='newly-enabled-provider';clock+=2000;
  assert.equal((await (await request()).json()).cache.status,'miss');assert.equal(calls,3);
  f.sqlite.prepare('UPDATE users SET consent_version=NULL').run();
  const denied=await request();assert.equal(denied.status,428);assert.equal((await denied.json()).cache,undefined);assert.equal(calls,3);
 }finally{globalThis.fetch=saved;Date.now=now;await f.drainBackground();f.close();}
});

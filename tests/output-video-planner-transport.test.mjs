import assert from 'node:assert/strict';
import test from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';registerOutputSourceImports();
const {requestOutputVideoPlannerResponse,requestOutputVideoResponse}=await import('../worker/output-video-execution.ts');
const url='https://api.openai.com/v1/responses';
function setup(t,fetch){t.mock.method(globalThis,'fetch',fetch);t.mock.timers.enable({apis:['setTimeout']});}
test('planner allows a single response after30s while FAL remains30s',async t=>{
 let resolve,calls=0;setup(t,()=>{calls++;return new Promise(r=>resolve=r);});
 const operation=requestOutputVideoPlannerResponse(url,{method:'POST'},()=>{});
 while(!resolve)await Promise.resolve();t.mock.timers.tick(30001);resolve(Response.json({ok:true}));
 assert.deepEqual(await(await operation).json(),{ok:true});assert.equal(calls,1);
 resolve=null;const fal=requestOutputVideoResponse('https://fal.media/test',{},()=>{});while(!resolve)await Promise.resolve();t.mock.timers.tick(30000);await assert.rejects(fal,/timeout/);
});
for(const mode of ['fetch','body'])test('planner bounds '+mode+' at240s despite ignored cancellation',async t=>{
 let began=false;setup(t,()=>{began=true;return mode==='fetch'?new Promise(()=>{}):Promise.resolve(new Response(new ReadableStream({cancel(){return new Promise(()=>{});}})));});
 const operation=requestOutputVideoPlannerResponse(url,{method:'POST'},()=>{});
 while(!began)await Promise.resolve();await new Promise(r=>setImmediate(r));t.mock.timers.tick(240000);await assert.rejects(operation,/timeout/);
});
test('parent abort retires late response and never retries',async t=>{
 let resolve,cancelled=0,calls=0;setup(t,()=>{calls++;return new Promise(r=>resolve=r);});
 const parent=new AbortController(),operation=requestOutputVideoPlannerResponse(url,{method:'POST',signal:parent.signal},()=>{});
 while(!resolve)await Promise.resolve();parent.abort(Error('parent stop'));await assert.rejects(operation,/parent stop/);
 resolve(new Response(new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}})));await new Promise(r=>setImmediate(r));assert.equal(cancelled,1);assert.equal(calls,1);
});
test('planner dispatch guard refuses before network',async t=>{setup(t,()=>assert.fail('network'));await assert.rejects(requestOutputVideoPlannerResponse(url,{method:'POST'},()=>{throw Error('source expired');}),/source expired/);});
for(const mode of ['redirect','oversized'])test('planner preserves '+mode+' refusal',async t=>{
 let calls=0;setup(t,async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return mode==='redirect'?new Response('',{status:307}):new Response('x'.repeat(524289));});
 await assert.rejects(requestOutputVideoPlannerResponse(url,{method:'POST'},()=>{}),mode==='redirect'?/redirect_refused/:/response_limit/);assert.equal(calls,1);
});

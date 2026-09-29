import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchDecision} from '../src/still/decision-transport.ts';

test('toolbar transport uses its visible-cycle deadline, with explicit cancellation and no retry',async t=>{
 const original=globalThis.fetch;let calls=0,requestSignal;
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  globalThis.fetch=async(_url,init)=>{calls++;requestSignal=init.signal;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
  const controller=new AbortController(),pending=fetchDecision({},undefined,0,controller.signal);
  t.mock.timers.tick(60_000);assert.equal(requestSignal.aborted,false);assert.equal(calls,1);
  controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
 }finally{globalThis.fetch=original;t.mock.timers.reset();}
});

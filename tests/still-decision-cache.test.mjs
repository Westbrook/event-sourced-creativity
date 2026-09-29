import test from 'node:test';
import assert from 'node:assert/strict';
import { DecisionMemo, stableDecisionKey, DECISION_TTL_MS } from '../src/still/decision-cache.ts';
import { decisionTiming } from '../src/still/decision-timing.ts';
const pause=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('exact keys, expiry, bypass and bounded LRU preserve independent results',async()=>{
 let now=100,calls=0;const cache=new DecisionMemo({accept:v=>v.ok,now:()=>now,maxEntries:2});
 const load=async()=>({ok:true,n:++calls});
 assert.equal((await cache.run('a',load)).cache.status,'miss');now+=100;
 const hit=await cache.run('a',load);assert.equal(hit.cache.status,'hit');assert.equal(hit.cache.ageMs,100);hit.value.n=99;
 assert.equal(cache.peek('a').value.n,1);
 assert.equal((await cache.run('a',load,true)).cache.status,'bypass');assert.equal(calls,2);
 await cache.run('b',load);await cache.run('c',load);assert.equal(cache.peek('a'),undefined);
 now+=DECISION_TTL_MS;assert.equal(cache.peek('b'),undefined);assert.equal(cache.peek('c'),undefined);
 assert.equal(stableDecisionKey({b:2,a:{c:3,b:1}}),stableDecisionKey({a:{b:1,c:3},b:2}));
});
test('simultaneous requests share one computation; rejection and clear cannot poison later reads',async()=>{
 const cache=new DecisionMemo({accept:()=>true}),gate=pause();let calls=0;
 const load=()=>{calls++;return gate.promise;};const a=cache.run('a',load),b=cache.run('a',load);
 gate.resolve({value:1});assert.equal((await a).cache.status,'miss');assert.equal((await b).cache.status,'shared');assert.equal(calls,1);
 const stale=pause(),late=cache.run('old',()=>stale.promise);cache.clear();stale.resolve({value:2});await late;assert.equal(cache.peek('old'),undefined);
 await assert.rejects(cache.run('failure',()=>Promise.reject(new Error('offline'))),/offline/);
 assert.equal((await cache.run('failure',async()=>({value:3}))).value.value,3);
});
test('failed, oversized and uncertain decisions are not retained',async()=>{
 const cache=new DecisionMemo({accept:v=>v.source==='jev'&&!v.reason,maxBytes:80});
 for(const result of [{source:'fallback'},{source:'jev',reason:'uncertain'},{source:'jev',large:'x'.repeat(100)}]){
 const response=await cache.run('key',async()=>result);assert.equal(response.cache.stored,false);assert.equal(cache.peek('key'),undefined);
 }
});
test('browser copies inherit original age and expiry without extending the server TTL',async()=>{
 let now=100000;const cache=new DecisionMemo({accept:()=>true,now:()=>now,ttl:r=>r.remainingMs,age:r=>r.ageMs,latency:r=>r.originalLatencyMs});
 await cache.run('a',async()=>({ageMs:20000,remainingMs:1000,originalLatencyMs:500}));now+=500;
 const hit=cache.peek('a');assert.equal(hit.cache.ageMs,20500);assert.equal(hit.cache.remainingMs,500);assert.equal(hit.cache.originalLatencyMs,500);
 now+=500;assert.equal(cache.peek('a'),undefined);
 const timing=decisionTiming({requestElapsedMs:1,cache:{...hit.cache,layer:'browser'},trace:{metrics:{elapsedMs:500},passes:[]}});
 assert.match(timing.description,/Local cache delivery/);assert.match(timing.description,/original decision, not a new Jev call/);
});

test('navigation detaches aborted pending work without discarding valid completed decisions',async()=>{
 const cache=new DecisionMemo({accept:()=>true});await cache.run('good',async()=>({value:1}));
 const gate=pause(),obsolete=cache.run('pending',()=>gate.promise);cache.clearPending();
 assert.equal(cache.peek('good').value.value,1);
 assert.equal((await cache.run('pending',async()=>({value:2}))).value.value,2);
 gate.resolve({value:3});await obsolete;assert.equal(cache.peek('pending').value.value,2);
});

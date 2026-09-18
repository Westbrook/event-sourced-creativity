import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionTiming } from '../src/still/decision-timing.ts';

test('Received shows measured round-trip duration and distinguishes partial server timings',()=>{
 const received={requestElapsedMs:1245.5,trace:{metrics:{elapsedMs:800},passes:[{status:'answered',elapsedMs:600},{status:'failed',elapsedMs:100},{status:'skipped',elapsedMs:999}]}};
 const timing=decisionTiming(JSON.parse(JSON.stringify(received)));
 assert.equal(timing.label,'1.25 s');assert.match(timing.description,/including data loading; excludes UI debounce/);
 assert.match(timing.description,/Decision phase: 800 ms/);assert.match(timing.description,/Jev calls: 700 ms across 2 calls/);
});
test('a pending request never displays the previous response time; absent timing is not zero',()=>{
 assert.equal(decisionTiming({requestElapsedMs:950},true),null);
 for(const ms of [undefined,NaN,Infinity,-10,'900'])assert.equal(decisionTiming({requestElapsedMs:ms}),null);
 assert.equal(decisionTiming(undefined),null);
 assert.equal(decisionTiming({requestElapsedMs:0}).label,'0 ms');
 assert.equal(decisionTiming({requestElapsedMs:942.8}).label,'943 ms');
 assert.doesNotMatch(decisionTiming({requestElapsedMs:500}).description,/Decision phase|Jev calls/);
});

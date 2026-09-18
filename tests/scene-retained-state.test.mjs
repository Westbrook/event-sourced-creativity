import assert from 'node:assert/strict';
import test from 'node:test';
import {measureSceneRetainedState} from '../worker/scene-retained-state.ts';
import {createSceneContextConsumer} from '../worker/scene-context-consumer.ts';
import {createContextRightsFold} from '../src/model/context-health.ts';
import {createAuthoritativeCreativeContextFold} from '../worker/context-authority.ts';
test('retained-state accounting includes Map/Set/UTF-16 strings and deduplicates object aliases',()=>{
  const shared={text:'😀'.repeat(100)};shared.self=shared;
  const measured=measureSceneRetainedState([shared,shared,new Map([['key',shared]]),new Set([shared])]);
  assert.ok(measured.bytes>=400);assert.ok(measured.bytes<2000);assert.ok(measured.nodes>5);
});
test('a refused consumer cannot resume after a state-reducing event',()=>{
  const consumer=createSceneContextConsumer({documentId:'d',projectId:'p'},{bytes:3000,nodes:100_000,depth:96});
  const event={eventId:'e',sequence:1,occurredAt:'now',recordedAt:'now',type:'PreferenceAuthored',payload:{preference_id:'p',value:'x'.repeat(1000),axis:'style'}};
  for(let i=0;i<100;i++)consumer.accept({...event,eventId:'e'+i,payload:{...event.payload,preference_id:'p'+i}});
  let original;try{consumer.checkpoint();}catch(error){original=error;}
  assert.ok(original);assert.match(original.message,/output_source_proof_too_large/);
  for(const attempt of [()=>consumer.accept({...event,type:'PreferenceRevoked'}),()=>consumer.checkpoint(),()=>consumer.finish()])assert.throws(attempt,error=>error===original);
});
test('accounting exposes numeric measurements, not mutable selectors or rights sets',()=>{
  const rights=createContextRightsFold(),authority=createAuthoritativeCreativeContextFold({documentId:'d',projectId:'p'});
  for(const fold of [rights,authority]){
    assert.equal(fold.retainedState,undefined);
    const measured=fold.measureRetainedState();assert.deepEqual(Object.keys(measured).sort(),['bytes','nodes']);
    assert.ok(Object.values(measured).every(value=>typeof value==='number'));
    measured.bytes=0;assert.ok(fold.measureRetainedState().bytes>0);
  }
});
test('byte, node, depth and unsupported values fail closed',()=>{
  for(const [value,limits] of [['x'.repeat(1000),{bytes:100,nodes:100,depth:10}],
    [Array(100).fill(0),{bytes:100_000,nodes:20,depth:10}],
    [[[[[1]]]],{bytes:100_000,nodes:100,depth:2}],
    [new Date(),{bytes:100_000,nodes:100,depth:10}]])assert.throws(()=>measureSceneRetainedState(value,limits),/output_source_proof_too_large/);
});

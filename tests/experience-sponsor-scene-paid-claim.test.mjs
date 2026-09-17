import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {registerOutputSourceImports} from './output-server-test-helpers.mjs';

// Negative tests import the actual module. No test creates, substitutes or
// claims possession of a genuine native/prepared/financial WeakMap proof.
const imports=registerOutputSourceImports();
const originalFetch=Object.getOwnPropertyDescriptor(globalThis,'fetch');let networkCalls=0;
globalThis.fetch=()=>{networkCalls++;throw Error('Scene paid-claim tests prohibit network');};
after(()=>{imports.deregister();Object.defineProperty(globalThis,'fetch',originalFetch);assert.equal(networkCalls,0);});
const api=await import('../worker/experience-sponsor-scene-paid-claim.ts');
const {ScenePaidPolicyStopError}=await import('../worker/scene-paid-dispatch.ts');
const stop=error=>error instanceof ScenePaidPolicyStopError&&error.code==='scene_paid_authority_changed';
const identity={jobId:'scene-job',scopeKey:'personal:actor:document',grantId:'scene-grant',slotId:'scene-slot',
  streamId:'creative:actor',correlationId:'scene-job:attempt:1',period:new Date().toISOString().slice(0,7),
  tokenReservationId:'scene-tokens',costReservationId:'scene-cost',reservedTokens:128000,reservedMicrousd:1000000};
function input(){
  let reads=0;const env={DB:{prepare(){reads++;throw Error('No authority may reach DB');},batch(){reads++;throw Error('No authority may reach DB');}}};
  const controller=new AbortController();
  return {env,executionAuthority:Object.freeze({}),financial:Object.freeze({}),originalClaimIdentity:structuredClone(identity),
    runtimeControl:{signal:controller.signal,output:{},beginCommit:async()=>{},progress:async()=>{}},controller,reads:()=>reads};
}

test('actual paid sidecar refuses JSON, inherited and copied empty capability objects without DB or network',async()=>{
  const f=input();
  for(const forged of [{},Object.freeze({}),structuredClone({}),Object.create({paidClaim:true}),{paidClaim:true}]){
    assert.throws(()=>api.sponsorScenePaidClaimIdentity(forged),stop);
    assert.throws(()=>api.requireSponsorScenePaidDispatchCurrent(forged),stop);
    await assert.rejects(api.sponsorScenePaidDispatchDeadline({claim:forged,prepared:{},evidence:{}}),stop);
  }
  assert.throws(()=>api.createSponsorScenePaidClaim(f),stop);
  assert.equal(f.reads(),0);
});

test('closed original-claim data rejects accessors and extra payer/proof fields before authority lookup',()=>{
  const changes=[
    value=>{value.payerUserId='caller-picked-payer';},value=>{value.assertions=[{sql:'1'}];},
    value=>{value.reservedTokens=128001;},value=>{value.reservedMicrousd=999999;},
    value=>{value.period='2026-9';},value=>{value.jobId='';},value=>{value.slotId='x'.repeat(513);},
    value=>{delete value.grantId;},value=>{value.jobId=Number.NaN;},
  ];
  for(const change of changes){const f=input();change(f.originalClaimIdentity);assert.throws(()=>api.createSponsorScenePaidClaim(f),stop);assert.equal(f.reads(),0);}
  const f=input();let called=0;
  Object.defineProperty(f.originalClaimIdentity,'jobId',{enumerable:true,get(){called++;return identity.jobId;}});
  assert.throws(()=>api.createSponsorScenePaidClaim(f),stop);assert.equal(called,0);assert.equal(f.reads(),0);
});

test('runtime cancellation requires a real non-aborted platform AbortSignal',()=>{
  for(const signal of [{aborted:false},Object.create(AbortSignal.prototype),null,undefined]){
    const f=input();f.runtimeControl.signal=signal;assert.throws(()=>api.createSponsorScenePaidClaim(f),stop);assert.equal(f.reads(),0);
  }
  const f=input();f.controller.abort();assert.throws(()=>api.createSponsorScenePaidClaim(f),stop);assert.equal(f.reads(),0);
});

test('a shadowed aborted flag cannot revive a canceled runtime signal',()=>{
  const f=input();f.controller.abort();Object.defineProperty(f.runtimeControl.signal,'aborted',{value:false});
  assert.equal(f.runtimeControl.signal.aborted,false);
  assert.throws(()=>api.createSponsorScenePaidClaim(f),stop);assert.equal(f.reads(),0);
});

test('runtime signal accessors are not treated as the runner own-data signal',()=>{
  const f=input();let calls=0;
  Object.defineProperty(f.runtimeControl,'signal',{enumerable:true,get(){calls++;return f.controller.signal;}});
  assert.throws(()=>api.createSponsorScenePaidClaim(f),stop);assert.equal(calls,0);assert.equal(f.reads(),0);
});

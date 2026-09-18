import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,freshRun,transport,actorCounters,assertPayerSettlement,finances,actor,payer,stream} from './sponsor-scene-native-fixture.mjs';

const diagnostic=process.env.FORMA_SCENE_NATIVE_DIAGNOSTIC==='1';
test(`genuine sponsored Scene admission, Run and native dispatch settle the distinct payer once ${diagnostic?'(diagnostic without strict SQL compiler)':'under strict SQL limits with one pinned native compatibility exception'}`,async t=>{
  const calls=transport(t),f=await fixture(t,{strict:!diagnostic}),before=actorCounters(f);
  assert.notEqual(actor,payer);await f.execute();assert.equal(calls.length,0);
  const run=await freshRun(f);await run.queue();assert.equal(calls.length,0);
  const result=await run.drive();
  assert.equal(result.status,'completed',JSON.stringify({error:result.error_message,calls:calls.length,trace:f.trace}));assert.equal(calls.length,1);
  assert.equal(result.owner_id,actor);assert.equal(result.stream_id,stream);assert.deepEqual(actorCounters(f),before);
  assertPayerSettlement(f);f.limits?.assertVerified();
  assert.deepEqual(f.trace.databaseErrors,[]);assert.deepEqual(f.trace.failedPredicates,[]);
  const stable=finances(f);await run.drive();assert.equal(calls.length,1);assert.deepEqual(finances(f),stable);
  t.diagnostic('Synthetic local Responses transport only; original branded native proofs and actual sponsor/runtime APIs; no real provider or campaign activation.');
  if(f.limits)t.diagnostic(`All ${f.limits.records.length} other SQL shapes use depth100/functionargs32/parameters100/SQL100k; ${f.limits.exceptions} calls of one exact SHA-pinned unchanged native metadata query use independently workerd-qualified functionargs56. This is not whole-path args32 compatibility.`);
});

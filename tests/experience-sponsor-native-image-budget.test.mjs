import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SponsorNativeImageReadBudget,sponsorImageResponseBody,sponsorNativeImageReadEnvironment} from '../worker/experience-sponsor-native-image-budget.ts';
import {outputTestDatabase} from './output-server-test-helpers.mjs';

test('verified response bytes are charged before exposure and zeroed after complete read or cancellation',async()=>{
  const budget=new SponsorNativeImageReadBudget(4,performance.now()+1_000,new AbortController().signal);
  const bytes=new Uint8Array([1,2,3,4]);
  assert.deepEqual(new Uint8Array(await new Response(sponsorImageResponseBody(bytes,budget)).arrayBuffer()),new Uint8Array([1,2,3,4]));
  assert.deepEqual(bytes,new Uint8Array(4));assert.throws(()=>budget.spend(1),/byte_capacity/);
  const abandoned=new Uint8Array([5,6]);
  const stream=sponsorImageResponseBody(abandoned,new SponsorNativeImageReadBudget(2,performance.now()+1_000,new AbortController().signal));
  await stream.cancel();assert.deepEqual(abandoned,new Uint8Array(2));
});

test('delayed first response pull cannot disclose after the absolute deadline even with backward wall clock',async t=>{
  const bytes=new Uint8Array([1,2,3]),budget=new SponsorNativeImageReadBudget(3,performance.now()+10,new AbortController().signal);
  const body=sponsorImageResponseBody(bytes,budget);
  t.mock.method(Date,'now',()=>0);
  await new Promise(resolve=>setTimeout(resolve,20));
  await assert.rejects(new Response(body).arrayBuffer(),/deadline/);assert.deepEqual(bytes,new Uint8Array(3));
});

test('an aborted response and never-resolving retained work terminate without waiting for their producer',async()=>{
  const controller=new AbortController(),budget=new SponsorNativeImageReadBudget(16,performance.now()+1_000,controller.signal);
  const bytes=new Uint8Array([1,2,3]),body=sponsorImageResponseBody(bytes,budget);
  const blocked=budget.wait(new Promise(()=>{}));controller.abort();await assert.rejects(blocked,/deadline/);
  await assert.rejects(new Response(body).arrayBuffer(),/deadline/);assert.deepEqual(bytes,new Uint8Array(3));
  const short=new SponsorNativeImageReadBudget(16,performance.now()+5,new AbortController().signal);
  await assert.rejects(short.wait(new Promise(()=>{})),/deadline/);
});

test('a known query reserves its bounded result before dispatch; unknown native SQL never executes',async()=>{
  let dispatched=0;
  const DB={prepare:()=>({first:async()=>{dispatched++;return {content:'{}',expires_at:'2099-01-01T00:00:00.000Z'};}})};
  const bounded=sponsorNativeImageReadEnvironment({DB},new SponsorNativeImageReadBudget(100,performance.now()+1_000,new AbortController().signal));
  assert.throws(()=>bounded.DB.prepare('SELECT arbitrary_unbounded_private_data'),/query_unbounded/);
  await assert.rejects(bounded.DB.prepare("SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-output' AND redacted_at IS NULL AND expires_at>?").first(),/byte_capacity/);
  assert.equal(dispatched,0);
});

test('stream chunks remain finite and abort between pulls stops the unsent suffix',async()=>{
  const controller=new AbortController(),budget=new SponsorNativeImageReadBudget(100_000,performance.now()+1_000,controller.signal);
  const bytes=new Uint8Array(100_000).fill(7),reader=sponsorImageResponseBody(bytes,budget).getReader();
  const first=await reader.read();assert.equal(first.value.byteLength,65_536);assert.ok(first.value.every(value=>value===7));
  controller.abort();await assert.rejects(reader.read(),/deadline/);assert.ok(bytes.every(value=>value===0));
});

test('malformed epoch schema cannot transfer large NUL-bearing cells or unbounded duplicate singleton rows',async t=>{
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  f.sqlite.exec('CREATE TABLE scene_source_epoch(singleton,schema_version,instance_nonce,generation);CREATE TABLE scene_source_generations(scope_kind,scope_key,generation)');
  const oversized='safe\0'+'x'.repeat(20_000);
  for(let index=0;index<100;index++)f.sqlite.prepare('INSERT INTO scene_source_epoch VALUES(1,1,?,?)').run(oversized,oversized);
  f.sqlite.prepare("INSERT INTO scene_source_generations VALUES('stream','creative:owner',?)").run(oversized);
  const bounded=sponsorNativeImageReadEnvironment(f.env,new SponsorNativeImageReadBudget(8_192,performance.now()+1_000,new AbortController().signal));
  const result=await bounded.DB.batch([bounded.DB.prepare(`SELECT instance_nonce,generation AS epoch,
      COALESCE((SELECT generation FROM scene_source_generations WHERE scope_kind='stream' AND scope_key=?),0) AS stream_generation
      FROM scene_source_epoch WHERE singleton=1 AND schema_version=1`).bind('creative:owner')]);
  assert.equal(result[0].results.length,2);assert.ok(Buffer.byteLength(JSON.stringify(result))<1_024);
  for(const row of result[0].results)assert.deepEqual({...row},{instance_nonce:null,epoch:null,stream_generation:'invalid'});
});

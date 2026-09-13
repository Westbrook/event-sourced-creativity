import assert from 'node:assert/strict';
import test from 'node:test';
import {videoEvidenceFixture} from './output-video-completion-fixture.mjs';
const {readOriginalOutputVideo}=await import('../worker/output-video-execution.ts');
async function fixture(){const f=await videoEvidenceFixture();return{...f,original:{contract:f.contract,requestBody:f.mediaAttempt.video.requestBody,clientRequestId:f.mediaAttempt.clientRequestId,requestDigest:f.mediaAttempt.requestDigest,providerRequestId:'video_original'}};}
async function network(fn,work){const old=globalThis.fetch;globalThis.fetch=fn;try{return await work();}finally{globalThis.fetch=old;}}
test('original Video retrieval uses only pinned GETs, privately observes response bytes and never submits another call',async()=>{
 const f=await fixture();try{const requests=[],saved=[],leases=[];
 const result=await network(async(url,init)=>{requests.push([url,init.method]);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  if(url.endsWith('/status'))return Response.json({request_id:'video_original',status:'COMPLETED',response_url:'https://attacker.invalid/ignored'});
  if(url.endsWith('/requests/video_original'))return Response.json({request_id:'video_original',video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:f.bytes.length}});
  assert.equal(url,'https://fal.media/original.mp4');assert.equal(new Headers(init.headers).has('authorization'),false);return new Response(f.bytes,{headers:{'content-type':'video/mp4'}});
 },()=>readOriginalOutputVideo({FAL_KEY:'synthetic-no-egress'},f.original,{onBeforeRead:async lease=>{lease.assertCurrent();leases.push(lease);},onEnvelope:async(e,lease)=>{lease.assertCurrent();saved.push(e);}}));
 assert.equal(result.status,'completed');assert.deepEqual(result.bytes,f.bytes);assert.deepEqual(saved.map(e=>e.phase),['status','result']);assert.equal(requests.length,3);assert(leases.every(lease=>lease.signal.aborted));
 for(const lease of leases)assert.throws(()=>lease.assertCurrent());
 }finally{f.sqlite.close();}
});
test('pending original is one GET with no polling, media fetch, claim or replacement',async()=>{
 const f=await fixture();try{let calls=0;const result=await network(async()=>{calls++;return Response.json({request_id:'video_original',status:'IN_PROGRESS'});},()=>readOriginalOutputVideo({FAL_KEY:'synthetic'},f.original,{onBeforeRead:async l=>l.assertCurrent(),onEnvelope:async(e,l)=>l.assertCurrent()}));assert.equal(result.status,'pending');assert.equal(calls,1);}finally{f.sqlite.close();}
});
test('changed identity, raw response failure and cancelled custody cannot fall through to submission',async()=>{
 const f=await fixture();try{
 for(const change of [o=>o.requestDigest='0'.repeat(64),o=>o.providerRequestId='../foreign']){const o={...f.original};change(o);await network(()=>assert.fail('network'),()=>assert.rejects(readOriginalOutputVideo({FAL_KEY:'synthetic'},o,{onBeforeRead:async l=>l.assertCurrent(),onEnvelope:async(e,l)=>l.assertCurrent()})));}
 let envelopes=0,gets=0;
 await network(async()=>{gets++;return new Response(new Uint8Array([255,254]),{headers:{'content-type':'application/json'}});},()=>assert.rejects(readOriginalOutputVideo({FAL_KEY:'synthetic'},f.original,{onBeforeRead:async l=>l.assertCurrent(),onEnvelope:async(e,l)=>{l.assertCurrent();envelopes++;assert.equal(e.decodedBodyBase64,'//4=');}})));assert.equal(envelopes,1);assert.equal(gets,1);
 await network(()=>assert.fail('network'),()=>assert.rejects(readOriginalOutputVideo({FAL_KEY:'synthetic'},f.original,{onBeforeRead:async()=>{throw Error('custody revoked');},onEnvelope:async(e,l)=>l.assertCurrent()})));
 }finally{f.sqlite.close();}
});

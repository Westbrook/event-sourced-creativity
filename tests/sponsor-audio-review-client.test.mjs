import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {digest} from '../src/experiences/compiler.ts';
import {createSponsorAudioReviewClient} from '../src/experiences/sponsor-audio-review-client.ts';

const network = globalThis.fetch;
let egress = 0;
globalThis.fetch = () => { egress++; throw Error('Unexpected network in dormant Audio review tests'); };
after(() => { globalThis.fetch = network; assert.equal(egress, 0); });
const hash = c => c.repeat(64), sha = c => `sha256:${hash(c)}`;
const options = () => ({signal: new AbortController().signal});
const json = value => Response.json(value);
async function fixture() {
  const preview = {version:'audio-mini-app-cost-v1',requestId:`audio-${hash('a')}`,actorUserId:'synthetic-actor',projectId:'synthetic-project',documentId:'synthetic-document',draftId:`experience-draft-${hash('b')}`,
    sourceDigest:hash('c'),requirementsDigest:hash('d'),expiresAt:new Date(Date.now()+180000).toISOString(),maximumMicrousd:1037600,maximumCalls:3,maximumTokens:128000,
    planningModel:'gpt-5.6-terra',maximumPlanningCalls:2,maximumOutputTokens:3000,audioModel:'fal-ai/stable-audio-3/medium/text-to-audio',maximumAudioCalls:1,durationSeconds:20,requireInstrumental:true,sourceFilesTransferred:0};
  const identity = {version:1,campaignId:'synthetic-campaign',actorUserId:preview.actorUserId,draftId:preview.draftId,draftHash:sha('4'),projectId:preview.projectId,documentId:preview.documentId,sourceDigest:preview.sourceDigest,requirementsDigest:preview.requirementsDigest};
  const review = {version:'sponsor-audio-review@1',campaignId:identity.campaignId,approvalReceiptDigest:sha('1'),policyDigest:sha('2'),templateDigest:sha('3'),payerUserId:'synthetic-payer',actorChargeMicrousd:0,termsDigest:hash('e'),preview,expiresAt:new Date(Date.now()+60000).toISOString()};
  const reviewDigest = await digest(review), wire = {version:1,kind:'sponsor-audio-review',binding:identity,review,reviewDigest,native:{draftHash:identity.draftHash,termsDigest:review.termsDigest,preview,expiresAt:new Date(Date.now()+120000).toISOString()}};
  // This is explicitly synthetic supplied consent, never a human action.
  const request = {draftHash:identity.draftHash,termsDigest:review.termsDigest,maximumMicrousd:preview.maximumMicrousd,explicitAuthorization:true,audioCostConsent:{...preview,confirmed:true,providerTransferConfirmed:true},sponsorReview:{campaignId:identity.campaignId,reviewDigest}};
  const ack = async (body=request) => ({version:1,kind:'sponsor-audio-authorization',binding:identity,reviewDigest,actorRequestDigest:await digest(body),grantId:'synthetic-grant',jobId:preview.requestId,
    receipt:{key:'synthetic-native-key',eventId:'11111111-1111-4111-8111-111111111111',requestDigest:hash('f')},replayed:false});
  return {identity,wire,request,ack};
}

test('construction is inert; passive read and explicit authorization send distinct bounded same-origin requests', async () => {
  const f=await fixture(), calls=[];
  const client=createSponsorAudioReviewClient(f.identity,async(path,init)=>{calls.push({path,init});return init.method==='GET'?json(f.wire):json(await f.ack(JSON.parse(init.body)));});
  assert.equal(calls.length,0);assert.equal(client.state.phase,'idle');
  const shown=await client.read(options());assert.equal(calls.length,1);assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.body,undefined);
  assert.equal(calls[0].path,`/api/experiences/sponsor/audio/drafts/${f.identity.draftId}/review`);
  const accepted=await client.authorize(shown,f.request,options());assert.equal(client.state.phase,'authorized');assert.equal(accepted.jobId,f.wire.review.preview.requestId);
  assert.equal(calls.length,2);assert.equal(calls[1].path,`/api/experiences/drafts/${f.identity.draftId}/output/authorize`);
  assert.deepEqual(JSON.parse(calls[1].init.body),f.request);
  for(const {init} of calls){assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);}
  assert.ok(Object.isFrozen(client.state.review.review.preview));assert.equal(client.state.originalIntent,'unknown_or_retained');client.dispose();
});

test('missing or false supplied consent, changed review and caller-selected payer never reach POST', async () => {
  for(const mutate of [x=>delete x.explicitAuthorization,x=>x.audioCostConsent.confirmed=false,x=>x.audioCostConsent.providerTransferConfirmed=false,x=>x.sponsorReview.reviewDigest=sha('0'),x=>x.payerUserId='other']){
    const f=await fixture(),calls=[];const client=createSponsorAudioReviewClient(f.identity,async(_path,init)=>{calls.push(init.method);return json(f.wire);});
    const shown=await client.read(options()),request=structuredClone(f.request);mutate(request);
    await assert.rejects(client.authorize(shown,request,options()));assert.deepEqual(calls,['GET']);client.dispose();
  }
});

test('only the exact displayed current response can be authorized; concurrent clicks send one POST', async () => {
  const f=await fixture();let release,calls=0;
  const client=createSponsorAudioReviewClient(f.identity,async(_path,init)=>{if(init.method==='GET')return json(f.wire);calls++;await new Promise(resolve=>{release=resolve;});return json(await f.ack());});
  const shown=await client.read(options());await assert.rejects(client.authorize(structuredClone(shown),f.request,options()),/stale_review/);
  const pending=client.authorize(shown,f.request,options());await assert.rejects(client.authorize(shown,f.request,options()),/unavailable/);
  while(!release)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);release();await pending;client.dispose();
});

test('actor body is captured before hashing; subsequent caller edits cannot change the wire', async () => {
  const f=await fixture(),original=structuredClone(f.request);let sent;
  const client=createSponsorAudioReviewClient(f.identity,async(_path,init)=>{if(init.method==='GET')return json(f.wire);sent=JSON.parse(init.body);return json(await f.ack(sent));});
  const shown=await client.read(options()),pending=client.authorize(shown,f.request,options());f.request.audioCostConsent.providerTransferConfirmed=false;f.request.sponsorReview.campaignId='changed';
  await pending;assert.deepEqual(sent,original);client.dispose();
});

test('abort and disposal end an unresolved transport without stale state or automatic retry', async () => {
  for(const dispose of [false,true]){
    const f=await fixture(),controller=new AbortController();let release,calls=0;
    const client=createSponsorAudioReviewClient(f.identity,async()=>{calls++;return new Promise(resolve=>{release=resolve;});});
    const pending=client.read({signal:controller.signal});if(dispose)client.dispose();else controller.abort();
    await assert.rejects(pending);release(json(f.wire));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.state.phase,dispose?'disposed':'unavailable');assert.equal(client.state.review,null);assert.equal(calls,1);assert.equal(client.pending,false);client.dispose();
  }
});

test('abort at response arrival cancels the body before review publication', async () => {
  const f=await fixture(),controller=new AbortController();let cancelled=0,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const body=new ReadableStream({pull(){started();return new Promise(()=>{});},cancel(){cancelled++;}});
  const client=createSponsorAudioReviewClient(f.identity,async()=>new Response(body,{headers:{'content-type':'application/json'}}));
  const pending=client.read({signal:controller.signal});await ready;controller.abort();await assert.rejects(pending);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(client.state.review,null);assert.equal(cancelled,1);client.dispose();
});

test('abort while the owned reader is pending and a fetch resolving after disposal both cancel their bodies', async () => {
  const f=await fixture(),controller=new AbortController();let cancelled=0;
  const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}});
  const client=createSponsorAudioReviewClient(f.identity,async()=>new Response(body,{headers:{'content-type':'application/json'}}));
  const pending=client.read({signal:controller.signal});
  for(let n=0;n<100&&!body.locked;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(body.locked,true);controller.abort();await assert.rejects(pending);await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);client.dispose();
  let release,lateCancelled=0;
  const late=new ReadableStream({cancel(){lateCancelled++;}}),second=createSponsorAudioReviewClient(f.identity,()=>new Promise(resolve=>{release=resolve;}));
  const stopped=second.read(options());second.dispose();await assert.rejects(stopped);release(new Response(late,{headers:{'content-type':'application/json'}}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(lateCancelled,1);assert.equal(second.state.phase,'disposed');
});

test('malformed, oversized, redirected and wrong-origin responses cannot become shown review', async () => {
  const f=await fixture();
  const bad=[()=>new Response('{}',{headers:{'content-type':'text/html'}}),()=>new Response('{',{headers:{'content-type':'application/json'}}),()=>json({...f.wire,reviewDigest:sha('0')}),
    ()=>new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'65537'}}),
    ()=>{const r=json(f.wire);Object.defineProperty(r,'redirected',{value:true});return r;},()=>{const r=json(f.wire);Object.defineProperty(r,'url',{value:'https://foreign.invalid/review'});return r;},
    ()=>new Response(new Uint8Array([0xc0,0xaf]),{headers:{'content-type':'application/json'}}),
    ()=>new Response(new ReadableStream({start(c){for(let i=0;i<1025;i++)c.enqueue(new Uint8Array());c.close();}}),{headers:{'content-type':'application/json'}})];
  for(const make of bad){let calls=0;const client=createSponsorAudioReviewClient(f.identity,async()=>{calls++;return make();});await assert.rejects(client.read(options()));assert.equal(client.state.review,null);assert.equal(calls,1);client.dispose();}
});

test('monotonic deadline during fetch and expired review at acknowledgement fail without retry', async () => {
  const f=await fixture(),originalNow=performance.now.bind(performance),descriptor=Object.getOwnPropertyDescriptor(performance,'now');let advance=0,calls=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>originalNow()+advance});
  try {const client=createSponsorAudioReviewClient(f.identity,async()=>{calls++;advance=20001;return json(f.wire);});await assert.rejects(client.read(options()),/stopped/);assert.equal(calls,1);client.dispose();}
  finally{if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete performance.now;}
  const now=Date.now;let offset=0;Date.now=()=>now()+offset;
  try{const client=createSponsorAudioReviewClient(f.identity,async(_path,init)=>{if(init.method==='GET')return json(f.wire);offset=61000;return json(await f.ack());});const shown=await client.read(options());await assert.rejects(client.authorize(shown,f.request,options()));assert.equal(client.state.phase,'unavailable');assert.equal(client.state.originalIntent,'unknown_or_retained');client.dispose();}
  finally{Date.now=now;}
});

test('a failed authorization remains unknown; rereading never posts or fabricates an acknowledgement', async () => {
  const f=await fixture(),calls=[];let posts=0;const client=createSponsorAudioReviewClient(f.identity,async(_path,init)=>{calls.push(init.method);if(init.method==='POST'){if(++posts===1)throw Error('Synthetic lost response after possible server commit');return json({...await f.ack(),replayed:true});}return json(f.wire);});
  const shown=await client.read(options());await assert.rejects(client.authorize(shown,f.request,options()));assert.equal(client.state.authorization,null);assert.equal(client.state.originalIntent,'unknown_or_retained');
  const reopened=await client.read(options());assert.deepEqual(calls,['GET','POST','GET']);assert.equal(client.state.authorization,null);
  assert.equal((await client.authorize(reopened,f.request,options())).replayed,true);assert.deepEqual(calls,['GET','POST','GET','POST']);client.dispose();
});

test('acknowledged original grant/receipt cannot be replaced on an explicit later action', async () => {
  const f=await fixture();let posts=0;
  const client=createSponsorAudioReviewClient(f.identity,async(_path,init)=>{if(init.method==='GET')return json(f.wire);const value=await f.ack();if(posts++)value.grantId='different-grant';return json(value);});
  await client.authorize(await client.read(options()),f.request,options());const retained=client.state.authorization;
  await assert.rejects(client.authorize(await client.read(options()),f.request,options()),/original_changed/);assert.equal(posts,2);assert.equal(client.state.authorization,retained);client.dispose();
});

test('a lost acknowledgement pins the attempted bytes and blocks changed review terms before a second POST', async () => {
  const f=await fixture();let posts=0;
  const client=createSponsorAudioReviewClient(f.identity,async(_path,init)=>{if(init.method==='GET')return json(f.wire);posts++;throw Error('Synthetic lost ACK');});
  await assert.rejects(client.authorize(await client.read(options()),f.request,options()),/Synthetic lost ACK/);
  // Same draft/source and campaign, but a newly quoted native authorization.
  f.wire.review.termsDigest=hash('7');f.wire.native.termsDigest=hash('7');f.wire.reviewDigest=await digest(f.wire.review);
  f.request.termsDigest=hash('7');f.request.sponsorReview.reviewDigest=f.wire.reviewDigest;
  await assert.rejects(client.authorize(await client.read(options()),f.request,options()),/original_intent_changed/);
  assert.equal(posts,1);assert.equal(client.state.originalIntent,'unknown_or_retained');client.dispose();
});

test('nonempty response URLs accept only the requested same-origin path', async () => {
  const f=await fixture(),descriptor=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://forma.test'}});
  try{
    for(const variant of ['matching','foreign','different-path']){
      let calls=0;
      const client=createSponsorAudioReviewClient(f.identity,async(path)=>{calls++;const response=json(f.wire);
        Object.defineProperty(response,'url',{value:variant==='foreign'?`https://foreign.invalid${path}`:`https://forma.test${path}${variant==='different-path'?'/other':''}`});return response;});
      if(variant==='matching')assert.equal((await client.read(options())).binding.documentId,f.identity.documentId);
      else await assert.rejects(client.read(options()),/response_invalid/);
      assert.equal(calls,1);client.dispose();
    }
  }finally{if(descriptor)Object.defineProperty(globalThis,'location',descriptor);else delete globalThis.location;}
});

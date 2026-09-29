import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,snapshot,noWrites,assertUnpaid,alterQuote,actor,post,imports} from './sponsor-video-native-fixture.mjs';
const [{readSponsorVideoIntentProof,requireSponsorVideoIntentProof,readSponsorVideoActorIntentProof,requireSponsorVideoActorIntentProof},
 {readSponsoredVideoReview,readSponsoredVideoActorRequest,digestSponsoredVideoReview,sponsoredVideoActorIntentMatchesNative,matchSponsoredVideoActorIntent},
 {loadOutputTrustedContext},{experienceOutputBinding,experienceOutputCommandKey,experienceOutputEnvelope,experienceOutputAuthorization},
 {digest,canonicalJson},{scenePreparationCyclePrefix},{handleExperienceOutput},{outputDocumentExecutionBridge},{readExperienceOutputLineage}]=await Promise.all([
 import('../worker/experience-sponsor-video-intent-proof.ts'),import('../src/experiences/sponsored-video-actor-intent.ts'),
 import('../worker/output-requirements-api.ts'),import('../worker/experience-output-binding.ts'),import('../src/experiences/compiler.ts'),
 import('../worker/experience-scene-renewal.ts'),import('../worker/experience-output-api.ts'),import('../worker/output-document-execution.ts'),
 import('../worker/experience-output-originals.ts'),
]);
after(()=>imports.deregister());
const sha=character=>'sha256:'+character.repeat(64),denied=/sponsor_|sponsored_|experience_|output_|body_|content_type/u;
const intentUrl=f=>`http://localhost/api/experiences/drafts/${f.plan.draftId}/output/authorize`;
const ordinaryBody=f=>({draftHash:f.plan.draftHash,termsDigest:f.terms.termsDigest,maximumMicrousd:f.terms.maximumMicrousd,explicitAuthorization:true});
const makeRequest=(f,{body=f.body,signal,headers={}}={})=>new Request(intentUrl(f),{...post(body),headers:{'content-type':'application/json',origin:'http://localhost','sec-fetch-site':'same-origin',...headers},...(signal?{signal}:{})});
const reviewValue=f=>({version:'sponsor-video-review@1',campaignId:'synthetic-video-campaign',approvalReceiptDigest:sha('1'),policyDigest:sha('2'),templateDigest:sha('3'),
 payerUserId:'synthetic-payer',actorChargeMicrousd:0,termsDigest:f.terms.termsDigest,offer:structuredClone(f.terms.targets[0]),
 transfer:{referenceCount:1,maximumReferenceBytes:31457280,referenceMimeTypes:['image/png','image/jpeg','image/webp']},
 expiresAt:new Date(Math.min(Date.parse(f.terms.expiresAt),Date.parse(f.terms.targets[0].settings.original.expiresAt))-1000).toISOString()});
async function actorFixture(t,options={}){
 const f=await fixture(t,options);f.review=reviewValue(f);f.body={...ordinaryBody(f),sponsorReview:{campaignId:f.review.campaignId,reviewDigest:await digestSponsoredVideoReview(f.review)}};
 f.nativeFacts={draftHash:f.plan.draftHash,termsDigest:f.terms.termsDigest,offer:structuredClone(f.terms.targets[0]),expiresAt:f.terms.expiresAt};
 f.request=makeRequest(f);f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
 f.binding=await experienceOutputBinding(f.plan);f.expectedEnvelope=await experienceOutputEnvelope(f.binding,'authorize',f.trusted.ownerHead,{...experienceOutputAuthorization(f.body,f.terms),preflightId:f.terms.id});
 f.commands=Object.fromEntries(f.sqlite.prepare('SELECT * FROM output_commands WHERE scope_key=? AND actor_user_id=?').all(f.trusted.scope.key,actor).map(row=>[row.action,row]));
 assert.deepEqual(Object.keys(f.commands).sort(),['confirm','preflight','save']);assertUnpaid(f);return f;
}
const requireActor=(proof,f,candidate)=>requireSponsorVideoActorIntentProof(proof,f.trusted,candidate);
const sourceFact=f=>f.trusted.context.snapshot.facts.find(value=>typeof value.properties.text==='string');
function commandCopy(f,key,action='confirm'){
 f.sqlite.prepare('INSERT INTO output_commands(scope_key,actor_user_id,command_key,request_digest,action,event_id,created_at) SELECT scope_key,actor_user_id,?,request_digest,?,event_id,created_at FROM output_commands WHERE scope_key=? AND actor_user_id=? AND command_key=?').run(key,action,f.trusted.scope.key,actor,f.commands.confirm.command_key);
}

for(const frame of ['landscape','portrait'])test(`five-field sponsored Video actor request ${frame} joins exact native evidence without authorizing payment`,async t=>{
 const f=await actorFixture(t,{frame}),before=snapshot(f),start=f.io.media.length,bytes=f.io.bytesRead,assertReadOnly=noWrites(f);
 const proof=await readSponsorVideoActorIntentProof(f.trusted,f.review),evidence=requireActor(proof,f,f.expectedEnvelope);
 assert.deepEqual(Object.keys(proof),[]);assert.ok(Object.isFrozen(proof));assert.ok(Object.isFrozen(evidence));
 assert.deepEqual(evidence.requestBody,f.body);assert.equal(Object.keys(evidence.requestBody).length,5);
 assert.deepEqual(evidence.review,f.review);assert.equal(evidence.reviewDigest,await digest(f.review));assert.equal(evidence.requestDigest,await digest(f.body));
 assert.deepEqual(evidence.envelope,f.expectedEnvelope);assert.equal(evidence.envelopeDigest,await digest(f.expectedEnvelope));
 assert.equal(evidence.envelope.clientMutationId,await experienceOutputCommandKey(f.binding,'authorize'));assert.equal(evidence.native.actorUserId,actor);
 assert.deepEqual(evidence.native.orderedAssetDigests,[`sha256:${f.reference.sha256}`]);assert.equal(evidence.native.recipe.maximumTokens,152000);
 assert.deepEqual(evidence.native.recipe.calls,{parsing:0,planning:1,render:1,repair:0});
 assert.equal(evidence.review.actorChargeMicrousd,0);assert.equal(evidence.requestBody.maximumMicrousd,f.terms.maximumMicrousd);assert.ok(evidence.requestBody.maximumMicrousd>0);
 assert.ok(evidence.expiresAtMs>Date.now());assert.ok(evidence.expiresAtMs<=Date.parse(f.review.expiresAt));
 for(const value of [evidence.requestBody,evidence.requestBody.sponsorReview,evidence.review,evidence.review.offer,evidence.review.transfer,evidence.review.transfer.referenceMimeTypes])assert.ok(Object.isFrozen(value));
 assert.deepEqual(f.io.media.slice(start),['head','head','get','head']);assert.equal(f.io.bytesRead-bytes,f.bytes.length);
 assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('ordinary four-field intent remains separate from actor-review proofs in both directions',async t=>{
 const ordinary=await actorFixture(t);ordinary.trusted.request=makeRequest(ordinary,{body:ordinaryBody(ordinary)});
 const before=snapshot(ordinary),assertReadOnly=noWrites(ordinary),proof=await readSponsorVideoIntentProof(ordinary.trusted);
 const evidence=requireSponsorVideoIntentProof(proof,ordinary.trusted,ordinary.expectedEnvelope);
 assert.deepEqual(evidence.requestBody,ordinaryBody(ordinary));assert.equal(Object.keys(evidence.requestBody).length,4);assert.equal(Object.hasOwn(evidence,'review'),false);
 assert.throws(()=>requireActor(proof,ordinary),denied);assert.deepEqual(snapshot(ordinary),before);assertReadOnly();assertUnpaid(ordinary);
 const sponsored=await actorFixture(t),sponsoredBefore=snapshot(sponsored),sponsoredReadOnly=noWrites(sponsored),actorProof=await readSponsorVideoActorIntentProof(sponsored.trusted,sponsored.review);
 assert.throws(()=>requireSponsorVideoIntentProof(actorProof,sponsored.trusted),denied);assert.deepEqual(requireActor(actorProof,sponsored).requestBody,sponsored.body);
 assert.deepEqual(snapshot(sponsored),sponsoredBefore);sponsoredReadOnly();assertUnpaid(sponsored);
});

test('actor review cannot manufacture missing explicit Request approval or promote the ordinary four-field body',async t=>{
 const f=await actorFixture(t),before=snapshot(f),assertReadOnly=noWrites(f),start=f.io.media.length;
 for(const mutate of [body=>delete body.explicitAuthorization,body=>body.explicitAuthorization=false,body=>body.explicitAuthorization='true',body=>delete body.sponsorReview]){
  const body=structuredClone(f.body);mutate(body);f.trusted.request=makeRequest(f,{body});await assert.rejects(readSponsorVideoActorIntentProof(f.trusted,f.review),denied);
 }
 f.trusted.request=makeRequest(f);await assert.rejects(readSponsorVideoIntentProof(f.trusted),denied);
 assert.equal(f.io.media.length,start);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('actor witness rejects opaque copies, another trusted context, and changed native envelope',async t=>{
 const f=await actorFixture(t),before=snapshot(f),assertReadOnly=noWrites(f),proof=await readSponsorVideoActorIntentProof(f.trusted,f.review);
 for(const forged of [{},structuredClone(proof),{...proof},null])assert.throws(()=>requireActor(forged,f),denied);
 assert.throws(()=>requireSponsorVideoActorIntentProof(proof,{...f.trusted}),denied);
 for(const mutate of [value=>value.maximumMicrousd++,value=>value.preflightId='other',value=>value.explicitAuthorization=false,value=>value.clientMutationId='invented',value=>value.expectedRevision='output:0',value=>delete value.experienceBinding,value=>value.extra=true]){
  const candidate=structuredClone(f.expectedEnvelope);mutate(candidate);assert.throws(()=>requireActor(proof,f,candidate),denied);
 }
 assert.deepEqual(requireActor(proof,f,f.expectedEnvelope).requestBody,f.body);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('pure actor-review match owns every supplied field and never invents payer or Run authority',async t=>{
 const f=await actorFixture(t),before=canonicalJson({review:f.review,request:f.body,native:f.nativeFacts});
 const result=await matchSponsoredVideoActorIntent(f.review,f.body,f.nativeFacts);assert.ok(result);
 assert.deepEqual(result.review,f.review);assert.deepEqual(result.request,f.body);assert.equal(result.reviewDigest,await digest(f.review));assert.equal(result.requestDigest,await digest(f.body));
 assert.deepEqual(Object.keys(result).sort(),['request','requestDigest','review','reviewDigest']);
 assert.equal(Object.hasOwn(result.request,'payerUserId'),false);assert.equal(Object.hasOwn(result.request,'explicitRun'),false);assert.notEqual(result.request,f.body);assert.notEqual(result.review,f.review);
 assert.equal(canonicalJson({review:f.review,request:f.body,native:f.nativeFacts}),before);assertUnpaid(f);
});

test('closed Video review rejects extra authority, invalid native offer caps and transfer widening',async t=>{
 const f=await actorFixture(t);
 const changes=[value=>value.version=1,value=>value.campaignId='',value=>value.approvalReceiptDigest='1'.repeat(64),value=>value.policyDigest=sha('A'),value=>value.templateDigest='unknown',
  value=>value.payerUserId='https://foreign.invalid',value=>value.payerUserId=actor,value=>value.actorChargeMicrousd=1,value=>value.actorChargeMicrousd='0',value=>value.termsDigest=sha('e'),
  value=>value.expiresAt='tomorrow',value=>value.expiresAt=new Date(Date.parse(value.offer.settings.original.expiresAt)+1).toISOString(),value=>value.explicitRun=true,
  value=>value.offer.maximumCalls=3,value=>value.offer.maximumTokens++,value=>value.offer.maximumMicrousd++,value=>value.offer.settings.calls[1].maximumMicrousd++,
  value=>value.offer.settings.payload.videoSeconds=8,value=>value.offer.settings.payload.videoAudioMode='audio',value=>value.offer.settings.payload.paidMediaConfirmed=false,
  value=>value.transfer.referenceCount=2,value=>value.transfer.maximumReferenceBytes++,value=>value.transfer.referenceMimeTypes.push('image/gif'),value=>value.transfer.referenceMimeTypes.reverse(),
  value=>value.transfer.sourceFilesTransferred=1,value=>value.transfer.url='https://destination.invalid'];
 for(const [index,change] of changes.entries()){const changed=structuredClone(f.review);change(changed);assert.throws(()=>readSponsoredVideoReview(changed),/sponsored_video_actor_intent_invalid/u,`review mutation ${index}`);}
 for(const key of Object.keys(f.review)){const changed=structuredClone(f.review);delete changed[key];assert.throws(()=>readSponsoredVideoReview(changed),/sponsored_video_actor_intent_invalid/u,key);}
 assert.equal(readSponsoredVideoReview(f.review).termsDigest,f.terms.termsDigest);assertUnpaid(f);
});

test('closed five-field request rejects invalid booleans, digest conventions and authority additions',async t=>{
 const f=await actorFixture(t);
 const changes=[value=>value.explicitAuthorization=false,value=>value.explicitAuthorization='true',value=>value.maximumMicrousd=0,value=>value.maximumMicrousd=1.5,
  value=>value.draftHash='4'.repeat(64),value=>value.termsDigest=sha('e'),value=>value.sponsorReview.reviewDigest='1'.repeat(64),value=>value.sponsorReview.campaignId='',
  value=>value.sponsorReview.extra='permission',value=>value.payerUserId='claimed-payer',value=>value.billingOwnerId='claimed-payer',value=>value.model='other',
  value=>value.url='https://destination.invalid',value=>value.explicitRun=true,value=>value.transfer={referenceCount:2},value=>value.sceneCostConsent={explicitAuthorization:true}];
 for(const [index,change] of changes.entries()){const changed=structuredClone(f.body);change(changed);assert.throws(()=>readSponsoredVideoActorRequest(changed),/sponsored_video_actor_intent_invalid/u,`request mutation ${index}`);}
 for(const key of Object.keys(f.body)){const changed=structuredClone(f.body);delete changed[key];assert.throws(()=>readSponsoredVideoActorRequest(changed),/sponsored_video_actor_intent_invalid/u,key);}
 assert.deepEqual(readSponsoredVideoActorRequest(f.body),f.body);assertUnpaid(f);
});

test('stale digest refuses changed payer and displayed metadata without claiming campaign authentication',async t=>{
 const f=await actorFixture(t);
 for(const mutate of [value=>value.campaignId+='-other',value=>value.approvalReceiptDigest=sha('5'),value=>value.policyDigest=sha('6'),value=>value.templateDigest=sha('7'),value=>value.payerUserId='another-payer',value=>value.expiresAt=new Date(Date.parse(value.expiresAt)-1).toISOString()]){
  const changed=structuredClone(f.review);mutate(changed);assert.ok(readSponsoredVideoReview(changed));assert.equal(await matchSponsoredVideoActorIntent(changed,f.body,f.nativeFacts),null);
 }
 const changed=structuredClone(f.body);changed.sponsorReview.reviewDigest=sha('f');assert.equal(await matchSponsoredVideoActorIntent(f.review,changed,f.nativeFacts),null);
 const copied=structuredClone(f.review);copied.payerUserId='another-payer';const copiedRequest=structuredClone(f.body);copiedRequest.sponsorReview.reviewDigest=await digestSponsoredVideoReview(copied);
 // Matching copied metadata is a review-reference match, not proof that this
 // payer or campaign approved a purchase. No financial issuer is invoked here.
 assert.ok(await matchSponsoredVideoActorIntent(copied,copiedRequest,f.nativeFacts));assertUnpaid(f);
});

test('fresh digest cannot substitute a different reference or native source offer',async t=>{
 const f=await actorFixture(t);
 for(const mutate of [value=>{value.offer.settings.payload.outputVideo.reference.sha256='f'.repeat(64);value.offer.settings.payload.outputVideoPlanner.contract.reference.sha256='f'.repeat(64);},
  value=>value.offer.settings.original.sourceDigest='f'.repeat(64),value=>value.offer.settings.original.requestId='video-'+'f'.repeat(64),value=>value.offer.settings.original.documentId='other']){
  const changed=structuredClone(f.review);mutate(changed);assert.ok(readSponsoredVideoReview(changed));const request=structuredClone(f.body);request.sponsorReview.reviewDigest=await digestSponsoredVideoReview(changed);
  assert.equal(sponsoredVideoActorIntentMatchesNative(changed,request,f.nativeFacts),false);assert.equal(await matchSponsoredVideoActorIntent(changed,request,f.nativeFacts),null);
 }
 for(const mutate of [value=>value.draftHash=sha('f'),value=>value.termsDigest='f'.repeat(64),value=>value.offer.settings.original.actorUserId='other',value=>value.offer.maximumCalls=3,value=>value.extra=true]){
  const native=structuredClone(f.nativeFacts);mutate(native);assert.equal(await matchSponsoredVideoActorIntent(f.review,f.body,native),null);
 }
 assertUnpaid(f);
});

test('parsers and matcher reject accessor, prototype, symbol and sparse shapes without evaluating getters',async t=>{
 const f=await actorFixture(t);let getters=0;
 const shapes=[value=>Object.create(value),value=>{Object.defineProperty(value,'hidden',{value:true});return value;},value=>{value[Symbol('extra')]=true;return value;},
  value=>{value.extra=undefined;return value;},value=>{value.extra=value;return value;},value=>{value.extra=Array(2);return value;},
  value=>{Object.defineProperty(value,Object.keys(value)[0],{enumerable:true,get(){getters++;throw Error('getter');}});return value;}];
 for(const shape of shapes){const review=shape(structuredClone(f.review)),request=shape(structuredClone(f.body)),native=shape(structuredClone(f.nativeFacts));
  assert.throws(()=>readSponsoredVideoReview(review),/sponsored_video_actor_intent_invalid/u);assert.throws(()=>readSponsoredVideoActorRequest(request),/sponsored_video_actor_intent_invalid/u);
  assert.equal(await matchSponsoredVideoActorIntent(review,f.body,f.nativeFacts),null);assert.equal(await matchSponsoredVideoActorIntent(f.review,request,f.nativeFacts),null);assert.equal(await matchSponsoredVideoActorIntent(f.review,f.body,native),null);
 }
 const nested=structuredClone(f.review);Object.defineProperty(nested.transfer,'referenceCount',{enumerable:true,get(){getters++;return 1;}});assert.throws(()=>readSponsoredVideoReview(nested),/sponsored_video_actor_intent_invalid/u);
 const before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f);await assert.rejects(readSponsorVideoActorIntentProof(f.trusted,nested),denied);
 assert.equal(getters,0);assert.equal(f.io.media.length,start);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('pure review digest and matcher capture inputs before the first owned await',async t=>{
 const f=await actorFixture(t),expected=await matchSponsoredVideoActorIntent(f.review,f.body,f.nativeFacts);assert.ok(expected);
 const review=structuredClone(f.review),pendingDigest=digestSponsoredVideoReview(review);review.payerUserId='late-payer';review.offer.settings.original.documentId='late-document';assert.equal(await pendingDigest,expected.reviewDigest);
 const pending=matchSponsoredVideoActorIntent(f.review,f.body,f.nativeFacts);f.review.policyDigest=sha('f');f.review.offer.settings.original.sourceDigest='f'.repeat(64);f.body.explicitAuthorization=false;
 f.body.sponsorReview.reviewDigest=sha('f');f.nativeFacts.draftHash=sha('f');f.nativeFacts.expiresAt=new Date(0).toISOString();
 assert.deepEqual(await pending,expected);assert.equal(await matchSponsoredVideoActorIntent(f.review,f.body,f.nativeFacts),null);assertUnpaid(f);
});

test('native actor collector captures the supplied review before reading the Request body',async t=>{
 const f=await actorFixture(t),originalReview=structuredClone(f.review),before=snapshot(f),assertReadOnly=noWrites(f);
 const pending=readSponsorVideoActorIntentProof(f.trusted,f.review);f.review.payerUserId='late-payer';f.review.offer.settings.original.documentId='late-document';
 const proof=await pending,evidence=requireActor(proof,f);assert.deepEqual(evidence.review,originalReview);assert.equal(evidence.reviewDigest,f.body.sponsorReview.reviewDigest);
 assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('historical review parsing does not extend the earliest review or native deadline',async t=>{
 const f=await actorFixture(t),deadline=Date.parse(f.review.expiresAt);
 assert.equal(sponsoredVideoActorIntentMatchesNative(f.review,f.body,f.nativeFacts,deadline-1),true);
 assert.equal(sponsoredVideoActorIntentMatchesNative(f.review,f.body,f.nativeFacts,deadline),false);
 for(const invalid of [NaN,Infinity,-Infinity])assert.equal(sponsoredVideoActorIntentMatchesNative(f.review,f.body,f.nativeFacts,invalid),false);
 const earlier=structuredClone(f.nativeFacts);earlier.expiresAt=new Date(deadline-1).toISOString();assert.equal(await matchSponsoredVideoActorIntent(f.review,f.body,earlier),null);
 const historical=structuredClone(f.review);historical.expiresAt=new Date(Date.now()-1).toISOString();assert.ok(readSponsoredVideoReview(historical));
 const historicalRequest=structuredClone(f.body);historicalRequest.sponsorReview.reviewDigest=await digestSponsoredVideoReview(historical);assert.equal(await matchSponsoredVideoActorIntent(historical,historicalRequest,f.nativeFacts),null);
 assertUnpaid(f);
});

test('expiry after either owned pure digest rejects return and synchronous comparison never hashes',async t=>{
 const f=await actorFixture(t);
 for(const expireAfter of [1,2]){
  const originalNow=Date.now,subtle=crypto.subtle,originalDigest=subtle.digest;let hashes=0,now=originalNow();Date.now=()=>now;
  subtle.digest=async function(...args){const value=await originalDigest.apply(this,args);hashes++;if(hashes===expireAfter)now=Date.parse(f.review.expiresAt);return value;};
  try{assert.equal(await matchSponsoredVideoActorIntent(f.review,f.body,f.nativeFacts),null);}finally{Date.now=originalNow;subtle.digest=originalDigest;}
  assert.equal(hashes,expireAfter);
 }
 const subtle=crypto.subtle,originalDigest=subtle.digest;subtle.digest=()=>{throw Error('synchronous helper must not hash');};
 try{assert.equal(sponsoredVideoActorIntentMatchesNative(f.review,f.body,f.nativeFacts),true);}finally{subtle.digest=originalDigest;}
 assertUnpaid(f);
});

for(const mode of ['abort','source','request-header','billing'])test(`actor collector refuses ${mode} at its owned preparation await before another principal read`,async t=>{
 const f=await actorFixture(t),controller=new AbortController();f.trusted.request=makeRequest(f,{signal:controller.signal});
 const before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f),prepare=f.DB.prepare.bind(f.DB),trace=[];let reached=false;
 f.DB.prepare=sql=>{trace.push(sql);const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{
  const bound=bind(...values),first=bound.first.bind(bound);bound.first=async()=>{const result=await first();
   if(sql.startsWith('SELECT 1 AS sponsored FROM private_content')){reached=true;
    if(mode==='abort')controller.abort(Error('synthetic actor review retirement'));else if(mode==='source')sourceFact(f).properties.text+=' changed';
    else if(mode==='request-header')f.trusted.request.headers.set('origin','https://changed.invalid');else f.trusted.principal.billingUserId='foreign';
   }return result;};return bound;};return statement;};
 await assert.rejects(readSponsorVideoActorIntentProof(f.trusted,f.review),denied);assert.equal(reached,true);
 assert.equal(trace.some(sql=>sql.includes('FROM (SELECT * FROM users WHERE user_id=?) principal')),false);assert.equal(f.io.media.length,start);
 assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('actor collector abort cancels a stalled body before native SQL or original-image reads',async t=>{
 const f=await actorFixture(t),controller=new AbortController();let startedResolve,cancelled=0;
 const started=new Promise(resolve=>{startedResolve=resolve;}),body=new ReadableStream({pull(){startedResolve();},cancel(){cancelled++;}},{highWaterMark:0});
 f.trusted.request=new Request(intentUrl(f),{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost'},body,duplex:'half',signal:controller.signal});
 const before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f),prepare=f.DB.prepare.bind(f.DB);let reads=0;f.DB.prepare=sql=>{reads++;return prepare(sql);};
 const pending=readSponsorVideoActorIntentProof(f.trusted,f.review);await started;controller.abort(Error('synthetic stalled actor body'));
 await assert.rejects(pending,denied);await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,1);assert.equal(body.locked,false);assert.equal(reads,0);assert.equal(f.io.media.length,start);
 assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('held actor proof retains Request, source, billing and review expiry currentness',async t=>{
 const f=await actorFixture(t),before=snapshot(f),assertReadOnly=noWrites(f),proof=await readSponsorVideoActorIntentProof(f.trusted,f.review);
 const exactRequest=f.trusted.request;f.trusted.request=makeRequest(f);assert.throws(()=>requireActor(proof,f),denied);f.trusted.request=exactRequest;
 const originalText=sourceFact(f).properties.text;sourceFact(f).properties.text+=' changed';assert.throws(()=>requireActor(proof,f),denied);sourceFact(f).properties.text=originalText;
 const payer=f.trusted.principal.billingUserId;f.trusted.principal.billingUserId='foreign';assert.throws(()=>requireActor(proof,f),denied);if(payer===undefined)delete f.trusted.principal.billingUserId;else f.trusted.principal.billingUserId=payer;
 const originalNow=Date.now;Date.now=()=>Date.parse(f.review.expiresAt);try{assert.throws(()=>requireActor(proof,f),denied);}finally{Date.now=originalNow;}
 assert.deepEqual(requireActor(proof,f).review,f.review);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

for(const mutation of ['earlier_authorize','orphan_renewal','late_renewal','native_plan_identity'])test(`actor native lineage refuses ${mutation} without promoting the reviewed metadata`,async t=>{
 const f=await actorFixture(t);let reached=false,afterMutation;
 const change=()=>{
  if(mutation==='earlier_authorize')commandCopy(f,'earlier-video-authorize','authorize');
  else if(mutation==='native_plan_identity')f.sqlite.prepare('UPDATE output_plan_revisions SET confirmed_event_id=? WHERE plan_revision_id=?').run(f.commands.save.event_id,f.terms.planRevisionId);
  else commandCopy(f,scenePreparationCyclePrefix(f.plan.draftId,'video')+'f'.repeat(64)+':confirm');
 };
 if(mutation==='late_renewal')f.afterGet=()=>{if(reached)return;reached=true;change();afterMutation=snapshot(f);};else change();
 const before=snapshot(f),assertReadOnly=noWrites(f);await assert.rejects(readSponsorVideoActorIntentProof(f.trusted,f.review),denied);
 if(mutation==='late_renewal')assert.equal(reached,true);assert.deepEqual(snapshot(f),mutation==='late_renewal'?afterMutation:before);assertReadOnly();assertUnpaid(f);
});

test('genuine unpaid renewal retains native child envelope and refuses a corrupted predecessor operation',{timeout:30000},async t=>{
 // Native preparation runs two seconds before its genuine original expiry.
 // Restore real time before renewal so both JS and the actual SQLite clock
 // observe expiry; no durable native timestamp or SQL clock is rewritten.
 const RealDate=Date,offset=14*60000+58000;
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()-offset]));}static now(){return RealDate.now()-offset;}};
 let f;try{f=await actorFixture(t);}finally{globalThis.Date=RealDate;}
 try{
  const predecessor=f.terms;await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(predecessor.targets[0].settings.original.expiresAt)-Date.now()+25)));
  const response=await handleExperienceOutput(new Request(intentUrl(f).replace('/authorize','/prepare'),post({draftHash:f.plan.draftHash,explicitRequirementsConfirmation:true,
   renewal:{predecessorPreflightId:predecessor.id,explicitRenewal:true}})),f.env,f.executionContext,outputDocumentExecutionBridge);
  assert.equal(response.status,200,await response.clone().text());const ready=await response.json();assert.notEqual(ready.preflight.id,predecessor.id);
  const row=f.sqlite.prepare('SELECT body.private_json FROM output_preflights p JOIN event_private_payloads body ON body.private_event_id=p.event_id WHERE p.preflight_id=?').get(ready.preflight.id);
  f.terms=JSON.parse(row.private_json).preflight;f.review=reviewValue(f);f.body={...ordinaryBody(f),sponsorReview:{campaignId:f.review.campaignId,reviewDigest:await digestSponsoredVideoReview(f.review)}};
  f.request=makeRequest(f);f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
  const lineage=await readExperienceOutputLineage(f.trusted,f.binding);assert.ok(lineage.binding.preparationCycle);
  const childEnvelope=await experienceOutputEnvelope(lineage.binding,'authorize',f.trusted.ownerHead,{...experienceOutputAuthorization(f.body,f.terms),preflightId:f.terms.id});
  const before=snapshot(f),proof=await readSponsorVideoActorIntentProof(f.trusted,f.review);assert.deepEqual(requireActor(proof,f).envelope,childEnvelope);
  assert.notEqual(childEnvelope.clientMutationId,f.expectedEnvelope.clientMutationId);assert.deepEqual(snapshot(f),before);assertUnpaid(f);
  // f.command still identifies the original preflight, as in the accepted
  // ordinary renewal control; the selected child's Request stays unchanged.
  assert.equal(f.command.preflightId,predecessor.id);await alterQuote(f,quote=>{quote.targets[0].settings.original.requestId='video-'+'f'.repeat(64);});
  f.request=makeRequest(f);f.trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(f.trusted instanceof Response));
  const mutated=snapshot(f),assertReadOnly=noWrites(f);await assert.rejects(readSponsorVideoActorIntentProof(f.trusted,f.review),denied);
  assert.deepEqual(snapshot(f),mutated);assertReadOnly();assertUnpaid(f);
 }finally{globalThis.Date=RealDate;}
});

test('native actor reader refuses stale review reference and mismatched campaign before any SQL or media',async t=>{
 const f=await actorFixture(t),before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f),prepare=f.DB.prepare.bind(f.DB);let reads=0;f.DB.prepare=sql=>{reads++;return prepare(sql);};
 for(const mode of ['review_digest','campaign','payer_with_stale_digest']){
  const review=structuredClone(f.review),body=structuredClone(f.body);
  if(mode==='review_digest')body.sponsorReview.reviewDigest=sha('f');else if(mode==='campaign')body.sponsorReview.campaignId+='-different';else review.payerUserId='another-payer';
  f.trusted.request=makeRequest(f,{body});await assert.rejects(readSponsorVideoActorIntentProof(f.trusted,review),/sponsor_video_actor_review_changed/u);
 }
 assert.equal(reads,0);assert.equal(f.io.media.length,start);assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
});

test('new native review and request digest awaits recheck original database and abort before classification reads',async t=>{
 for(const digestIndex of [1,2])for(const mode of ['database','abort']){
  const f=await actorFixture(t),controller=new AbortController();f.trusted.request=makeRequest(f,{signal:controller.signal});
  const before=snapshot(f),start=f.io.media.length,assertReadOnly=noWrites(f),prepare=f.DB.prepare.bind(f.DB),subtle=crypto.subtle,originalDigest=subtle.digest;let reads=0,hashes=0,reached=false;
  f.DB.prepare=sql=>{reads++;return prepare(sql);};
  subtle.digest=async function(...args){const result=await originalDigest.apply(this,args);hashes++;if(hashes===digestIndex){reached=true;if(mode==='database')f.env.DB={...f.DB};else controller.abort(Error('synthetic owned actor digest retirement'));}return result;};
  try{await assert.rejects(readSponsorVideoActorIntentProof(f.trusted,f.review),denied);}finally{subtle.digest=originalDigest;f.env.DB=f.DB;}
  assert.equal(reached,true,`${mode} after digest ${digestIndex}`);assert.equal(hashes,digestIndex);assert.equal(reads,0);assert.equal(f.io.media.length,start);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
 }
});

test('last native proof await rejects changed actor billing or Request header before minting actor proof',async t=>{
 for(const mode of ['billing','request-header']){
  const f=await actorFixture(t),before=snapshot(f),assertReadOnly=noWrites(f),batch=f.DB.batch.bind(f.DB);let reached=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(statement=>statement.sql.includes('captured WHERE terms_digest=? AND expires_at=? AND private_json=?'))){
   reached=true;if(mode==='billing')f.trusted.principal.billingUserId='foreign';else f.trusted.request.headers.set('origin','https://changed.invalid');
  }return result;};
  await assert.rejects(readSponsorVideoActorIntentProof(f.trusted,f.review),denied);assert.equal(reached,true);
  assert.deepEqual(snapshot(f),before);assertReadOnly();assertUnpaid(f);
 }
});

import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,post,snapshot,noWrites,assertUnpaid,actor} from './sponsor-audio-evidence-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{readSponsorAudioActorEvidence},{digestSponsoredAudioReview},{digest},{loadOutputTrustedContext}]=await Promise.all([
 import('../worker/experience-sponsor-audio-actor-evidence.ts'),import('../src/experiences/sponsored-audio-actor-intent.ts'),import('../src/experiences/compiler.ts'),import('../worker/output-requirements-api.ts'),
]);
const originalFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=()=>{outbound++;throw Error('No network in dormant Audio actor evidence');};after(()=>{globalThis.fetch=originalFetch;assert.equal(outbound,0);});
const hash=n=>`sha256:${String(n).repeat(64)}`;
async function input(f){
 const command=structuredClone(f.command),review={version:'sponsor-audio-review@1',campaignId:'synthetic-unapproved-audio-campaign',approvalReceiptDigest:hash(1),policyDigest:hash(2),templateDigest:hash(3),
  payerUserId:'synthetic-distinct-payer',actorChargeMicrousd:0,termsDigest:command.termsDigest,preview:structuredClone(f.terms.targets[0].settings.costPreview),expiresAt:f.terms.expiresAt};
 const body={draftHash:f.plan.draftHash,termsDigest:command.termsDigest,maximumMicrousd:command.maximumMicrousd,explicitAuthorization:true,audioCostConsent:structuredClone(command.audioCostConsent),
  sponsorReview:{campaignId:review.campaignId,reviewDigest:await digestSponsoredAudioReview(review)}};
 return{command,review,body};
}
const install=(f,body,options={})=>f.trusted.request=new Request(f.request.url,{...post(body),...options});
const read=(f,i)=>readSponsorAudioActorEvidence(f.trusted,i.command,i.review);
const finalProof=statements=>statements.some(s=>s.sql.includes('private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?'));
const nested=(depth,action)=>queueMicrotask(()=>depth===1?action():nested(depth-1,action));
function trace(f){const seen=[],prepare=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{seen.push(sql);return prepare(sql);};return seen;}
function unchanged(f,before,readonly){assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);}

test('Audio actor evidence uses the actual supplied POST and actual native proof under strict SQL limits',async t=>{
 const f=await fixture(t),i=await input(f),request=install(f,i.body),before=snapshot(f),readonly=noWrites(f);
 const limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>limits.restore());
 const result=await read(f,i);
 assert.equal(f.trusted.request,request);assert.deepEqual(result.request,i.body);assert.deepEqual(result.request.audioCostConsent,i.body.audioCostConsent);
 assert.equal(result.requestDigest,await digest(i.body));assert.equal(result.reviewDigest,i.body.sponsorReview.reviewDigest);assert.equal(result.commandDigest,await digest(i.command));
 assert.equal(result.native.description.actorUserId,actor);assert.equal(result.native.description.ownerUserId,actor);assert.equal(result.review.payerUserId,'synthetic-distinct-payer');
 assert.equal(result.review.actorChargeMicrousd,0);assert.ok(result.native.recipe.maximumMicrousd>0);assert.equal(result.native.recipe.maximumTokens,128000);
 assert.equal(result.native.offered.settings.costPreview.sourceFilesTransferred,0);assert.equal(result.native.offered.settings.payload.outputAudio.source.draftHash,i.body.draftHash);
 assert.equal(Object.hasOwn(result,'grantId'),false);assert.equal(Object.hasOwn(result,'receipt'),false);assert.equal(Object.hasOwn(result,'assertCurrent'),false);
 assert.ok(Object.isFrozen(result.request.audioCostConsent));assert.ok(Object.isFrozen(result.native.offered));assert.equal(request.bodyUsed,false);
 unchanged(f,before,readonly);limits.assertVerified();
 t.diagnostic(JSON.stringify({strictSqlShapes:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(r=>Buffer.byteLength(r.sql))),outbound,consent:'synthetic Request only; no human approval or verified campaign'}));
});

test('Audio actor evidence rejects missing or false actual Request approval despite a true canonical command',async t=>{
 for(const kind of ['missing-body-fields','false-authorize','missing-consent','false-cost','false-transfer']){
  const f=await fixture(t),i=await input(f),body=structuredClone(i.body);
  if(kind==='missing-body-fields')for(const key of Object.keys(body))delete body[key];
  if(kind==='false-authorize')body.explicitAuthorization=false;if(kind==='missing-consent')delete body.audioCostConsent;
  if(kind==='false-cost')body.audioCostConsent.confirmed=false;if(kind==='false-transfer')body.audioCostConsent.providerTransferConfirmed=false;
  install(f,body);const before=snapshot(f),readonly=noWrites(f),seen=trace(f);
  await assert.rejects(read(f,i));assert.equal(seen.length,0,kind);unchanged(f,before,readonly);
 }
});

test('Audio actor evidence rejects mismatched wire fields or review references before any SQL',async t=>{
 for(const kind of ['terms','maximum','actor','source','campaign','review-digest','payer-field','route-field']){
  const f=await fixture(t),i=await input(f),body=structuredClone(i.body);
  if(kind==='terms')body.termsDigest='0'.repeat(64);if(kind==='maximum')body.maximumMicrousd++;
  if(kind==='actor')body.audioCostConsent.actorUserId='other';if(kind==='source')body.audioCostConsent.sourceDigest='0'.repeat(64);
  if(kind==='campaign')body.sponsorReview.campaignId='other';if(kind==='review-digest')body.sponsorReview.reviewDigest=hash(9);
  if(kind==='payer-field')body.payerUserId='caller-selected';if(kind==='route-field')body.route='arbitrary';
  install(f,body);const before=snapshot(f),readonly=noWrites(f),seen=trace(f);
  await assert.rejects(read(f,i));assert.equal(seen.length,0,kind);unchanged(f,before,readonly);
 }
});

test('Audio actor evidence binds the real native draft hash and refuses forged future approval objects',async t=>{
 const f=await fixture(t),i=await input(f);i.body.draftHash=hash(9);install(f,i.body);const before=snapshot(f),readonly=noWrites(f);
 await assert.rejects(read(f,i),/sponsor_audio_actor_evidence_invalid/);unchanged(f,before,readonly);
 const invalid=await fixture(t),j=await input(invalid);j.review.authority=true;install(invalid,j.body);const beforeInvalid=snapshot(invalid),seen=trace(invalid);
 await assert.rejects(read(invalid,j));assert.equal(seen.length,0);assert.deepEqual(snapshot(invalid),beforeInvalid);assertUnpaid(invalid);
});

test('Audio actor evidence rejects unsupported or incomplete transports without SQL',async t=>{
 for(const kind of ['get','non-json','consumed','oversized','invalid-json','invalid-utf8','query','foreign-path']){
  const f=await fixture(t),i=await input(f);let request;
  if(kind==='get')request=new Request(f.request.url);
  else if(kind==='invalid-utf8')request=new Request(f.request.url,{method:'POST',headers:{'content-type':'application/json'},body:new Uint8Array([0xff])});
  else request=new Request(f.request.url+(kind==='query'?'?other=true':kind==='foreign-path'?'/other':''),{...post(i.body),...(kind==='non-json'?{headers:{'content-type':'text/plain'}}:{}),...(kind==='oversized'?{body:' '.repeat(4097)}:{}),...(kind==='invalid-json'?{body:'{'}:{})});
  if(kind==='consumed')await request.text();f.trusted.request=request;const before=snapshot(f),readonly=noWrites(f),seen=trace(f);
  await assert.rejects(read(f,i));assert.equal(seen.length,0,kind);unchanged(f,before,readonly);
 }
});

test('Audio actor evidence stops before SQL on pre-abort and abort-then-close during actual body consumption',async t=>{
 for(const stage of ['entry','body']){
  const f=await fixture(t),i=await input(f),controller=new AbortController();let release;
  if(stage==='entry'){install(f,i.body,{signal:controller.signal});controller.abort();}
  else{const stream=new ReadableStream({start(control){release=()=>{control.enqueue(new TextEncoder().encode(JSON.stringify(i.body)));controller.abort();control.close();};}});
   f.trusted.request=new Request(f.request.url,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half',signal:controller.signal});}
  const before=snapshot(f),readonly=noWrites(f),seen=trace(f),pending=read(f,i);
  if(release)release();await assert.rejects(pending);assert.equal(seen.length,0);unchanged(f,before,readonly);
 }
});

test('Audio actor evidence captures review and command before body await and detects current caller identity changes',async t=>{
 for(const kind of ['captured-inputs','request','headers','environment','database','principal','source']){
  const f=await fixture(t),i=await input(f),original=structuredClone(i);let release;
  const stream=new ReadableStream({start(control){release=()=>{control.enqueue(new TextEncoder().encode(JSON.stringify(original.body)));control.close();};}});
  f.trusted.request=new Request(f.request.url,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'});
  const before=snapshot(f),readonly=noWrites(f),seen=trace(f),pending=read(f,i);
  if(kind==='captured-inputs'){i.command.audioCostConsent.confirmed=false;i.review.payerUserId='changed-metadata';}
  if(kind==='request')f.trusted.request=new Request(f.request.url,post(original.body));if(kind==='headers')f.trusted.request.headers.set('oai-authenticated-user-id','other');
  if(kind==='environment')f.trusted.env={...f.env};if(kind==='database')f.env.DB={...f.DB};
  if(kind==='principal')f.trusted.principal={...f.trusted.principal};if(kind==='source')f.trusted.context.snapshot.facts[0].properties.text+=' changed';
  release();if(kind==='captured-inputs'){const result=await pending;assert.equal(result.review.payerUserId,original.review.payerUserId);assert.equal(result.request.audioCostConsent.confirmed,true);}
  else{await assert.rejects(pending);assert.equal(seen.length,0,kind);}unchanged(f,before,readonly);
 }
});

test('Audio actor evidence refuses original sponsored markers or sidecars before native private reads',async t=>{
 for(const kind of ['marker','sidecar']){
  const f=await fixture(t),i=await input(f);install(f,i.body);
  if(kind==='marker'){const row=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.draftId),value=JSON.parse(row.content);value.sponsor_intake=null;f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(JSON.stringify(value),f.draftId);}
  else{f.sqlite.exec('CREATE TABLE experience_sponsor_intakes(draft_id TEXT)');f.sqlite.prepare('INSERT INTO experience_sponsor_intakes(draft_id) VALUES(?)').run(f.draftId);}
  const before=snapshot(f),readonly=noWrites(f),seen=trace(f);
  await assert.rejects(read(f,i),/sponsor_audio_actor_ordinary_context_required/);assert.ok(seen.length>0);assert.ok(seen.every(sql=>!sql.includes('SELECT preflight.terms_digest')&&!sql.includes('SELECT principal.*')));
  assert.deepEqual(snapshot(f),before);readonly();if(kind==='marker')assertUnpaid(f);
 }
});

test('Audio actor evidence carries original negative classification into its final native proof',async t=>{
 const f=await fixture(t),i=await input(f);install(f,i.body);const batch=f.DB.batch.bind(f.DB);let injected=false,afterMutation;
 f.DB.batch=async statements=>{if(!injected&&finalProof(statements)){injected=true;const row=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.draftId),value=JSON.parse(row.content);value.sponsor_intake=null;f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(JSON.stringify(value),f.draftId);afterMutation=snapshot(f);}return batch(statements);};
 const readonly=noWrites(f);await assert.rejects(read(f,i));assert.equal(injected,true);unchanged(f,afterMutation,readonly);
});

for(const fault of ['abort','deadline','request','database','principal','source'])test(`Audio actor evidence final outer return refuses ${fault}`,async t=>{
 const f=await fixture(t),i=await input(f),controller=new AbortController();install(f,i.body,{signal:controller.signal});
 const before=snapshot(f),readonly=noWrites(f),batch=f.DB.batch.bind(f.DB),clock=Date.now;let finalBatches=0,changed=false;
 f.DB.batch=async statements=>{const result=await batch(statements);if(finalProof(statements)&&++finalBatches===2)nested(5,()=>{changed=true;
  if(fault==='abort')controller.abort();if(fault==='deadline')Date.now=()=>Date.parse(i.review.expiresAt);
  if(fault==='request')f.trusted.request=new Request(f.request.url,post(i.body));if(fault==='database')f.env.DB={...f.DB};
  if(fault==='principal')f.trusted.principal={...f.trusted.principal};if(fault==='source')f.trusted.context.snapshot.facts[0].properties.text+=' changed';
 });return result;};
 try{await assert.rejects(read(f,i),/sponsor_audio_actor_lifetime_changed/);}finally{Date.now=clock;}
 assert.equal(finalBatches,2);assert.equal(changed,true);unchanged(f,before,readonly);
});

test('Audio actor evidence preserves supplied metadata without pretending it is verified payer authority',async t=>{
 const f=await fixture(t),i=await input(f);i.review.payerUserId='different-unverified-payer';i.review.approvalReceiptDigest=hash(8);i.body.sponsorReview.reviewDigest=await digestSponsoredAudioReview(i.review);
 install(f,i.body);const actual=await loadOutputTrustedContext(f.trusted.request,f.env,f.documentId,'request');assert.ok(!(actual instanceof Response));f.trusted=actual;
 const before=snapshot(f),readonly=noWrites(f),result=await read(f,i);
 assert.equal(result.review.payerUserId,'different-unverified-payer');assert.equal(result.native.description.actorUserId,actor);assert.equal(result.native.description.ownerUserId,actor);
 assert.equal(Object.hasOwn(result,'payerApproved'),false);unchanged(f,before,readonly);
});

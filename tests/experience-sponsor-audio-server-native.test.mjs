import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture,trapEgress,readonlyDatabase,traceDatabase,snapshot,actor,payer,headers,canonicalJson,digest} from './sponsor-audio-server-native-fixture.mjs';
import {readSponsorAudioReviewResponse,prepareSponsorAudioAuthorize,readSponsorAudioAuthorizationResponse} from '../src/experiences/sponsor-audio-review-transport.ts';

const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const tables=['experience_sponsor_driver_intents','experience_sponsor_driver_stages','experience_sponsor_issuances','experience_sponsor_grants','experience_sponsor_consumptions',
  'experience_sponsor_resource_receipts','output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'];
const operations=f=>Object.fromEntries(tables.map(name=>[name,f.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const originalReceipt=f=>{
  const row=f.sqlite.prepare("SELECT command.*,body.private_json FROM output_commands command JOIN event_private_payloads body ON body.private_event_id=command.event_id WHERE command.action='authorize'").get();
  assert.ok(row);return {...row,body:JSON.parse(row.private_json)};
};
function assertNoRun(f){
  assert.equal(count(f,'output_provider_calls'),0);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='run'").get().n,0);
  const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();if(job){assert.equal(job.status,'queued');assert.equal(job.attempt_count,0);}
  assert.deepEqual(f.effects,{media:0,assets:0,detached:0});
}
function beforeFreshQuote(f){
  const prepare=f.env.DB.prepare,attempts=[];
  f.env.DB.prepare=function(sql){
    if(/(?:FROM|JOIN)\s+output_preflights\b/iu.test(sql)||/INSERT\s+INTO\s+(?:experience_sponsor_(?:grants|issuances|resource_receipts|consumptions)|output_execution_grants)/iu.test(sql)){
      attempts.push(sql);throw Error('Exact retained Audio admission must precede fresh quote/issuance/capacity');
    }
    return prepare.call(this,sql);
  };
  return()=>{f.env.DB.prepare=prepare;assert.deepEqual(attempts,[]);};
}

test('passive server Audio review reads the real native quote without consent, writes, admission or Run',async t=>{
  trapEgress(t);const f=await fixture(t),before=snapshot(f),restore=readonlyDatabase(f);
  let shown,again;try{shown=await f.readReview();again=await f.readReview();}finally{restore();}
  assert.equal(canonicalJson(shown),canonicalJson(again),'Review expiry and digest cannot renew on reload');
  assert.equal(canonicalJson(await readSponsorAudioReviewResponse(shown,shown.binding)),canonicalJson(shown));
  assert.equal(shown.kind,'sponsor-audio-review');assert.equal(shown.binding.actorUserId,actor);assert.equal(shown.binding.draftId,f.draftId);
  assert.equal(shown.binding.documentId,f.documentId);assert.equal(shown.binding.draftHash,f.draftHash);assert.equal(shown.review.payerUserId,payer);
  assert.equal(shown.review.actorChargeMicrousd,0);assert.equal(shown.review.templateDigest,f.templateDigest);assert.equal(shown.review.termsDigest,f.terms.termsDigest);
  assert.equal(canonicalJson(shown.review.preview),canonicalJson(f.terms.targets[0].settings.costPreview));assert.equal(shown.native.expiresAt,f.terms.expiresAt);
  assert.ok(Date.parse(shown.review.expiresAt)<=Date.parse(f.terms.expiresAt));
  for(const key of ['audioCostConsent','confirmed','providerTransferConfirmed','receipt','grantId','authority','preparation','command'])assert.equal(Object.hasOwn(shown,key),false,key);
  assert.deepEqual(snapshot(f),before);for(const table of tables)assert.equal(count(f,table),0,table);assertNoRun(f);f.limits.assertVerified();
});

test('server Audio authorization uses the actual supplied POST and genuine issuer/admission, then stops before Run',async t=>{
  trapEgress(t);const f=await fixture(t),shown=await f.readReview(),body=f.actorBody(shown),message=await prepareSponsorAudioAuthorize(shown,body);
  const request=f.actorRequest(body),beforeActor=f.sqlite.prepare("SELECT * FROM cost_budget_counters WHERE scope='user' AND scope_id=?").all(actor);
  const ack=await f.authorize(body,{request});assert.equal(ack.replayed,false);assert.equal(request.bodyUsed,false,'Native reader retains the same original Request, reading a clone');
  assert.equal(canonicalJson(await readSponsorAudioAuthorizationResponse(ack,shown,message)),canonicalJson(ack));
  const receipt=originalReceipt(f),marker=receipt.body.output_command_envelope.sponsor_entitlement;
  assert.equal(canonicalJson(marker.audio_actor_intent.request),canonicalJson(body));assert.equal(marker.audio_actor_intent.requestDigest,await digest(body));
  assert.equal(marker.audio_actor_intent.reviewDigest,shown.reviewDigest);assert.equal(ack.actorRequestDigest,await digest(body));
  assert.equal(ack.receipt.key,receipt.command_key);assert.equal(ack.receipt.eventId,receipt.event_id);assert.equal(ack.receipt.requestDigest,receipt.request_digest);
  assert.notEqual(ack.receipt.requestDigest,ack.actorRequestDigest.slice(7));
  const native=f.sqlite.prepare('SELECT * FROM output_execution_grants').get(),issued=f.sqlite.prepare('SELECT * FROM experience_sponsor_issuances').get();
  assert.equal(ack.grantId,native.grant_id);assert.notEqual(ack.grantId,issued.grant_id);assert.equal(ack.jobId,shown.review.preview.requestId);
  assert.equal(native.actor_user_id,actor);assert.equal(native.payer_user_id,payer);
  for(const table of ['experience_sponsor_issuances','experience_sponsor_grants','experience_sponsor_consumptions','output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations'])assert.equal(count(f,table),1,table);
  const stage=f.sqlite.prepare("SELECT command_json FROM experience_sponsor_driver_stages WHERE stage='authorize'").get();assert.ok(stage);
  const retained=JSON.parse(stage.command_json);assert.equal(retained.action,'authorize');assert.equal(retained.preflightId,f.terms.id);
  assert.equal(retained.expectedRevision,f.command.expectedRevision);assert.equal(canonicalJson(retained.audioCostConsent),canonicalJson(body.audioCostConsent));
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM cost_budget_counters WHERE scope='user' AND scope_id=?").all(actor),beforeActor);
  assertNoRun(f);f.limits.assertVerified();
});

test('exact server replay retains the original command and receipt before fresh quote or exhausted admission capacity',async t=>{
  trapEgress(t);const f=await fixture(t),shown=await f.readReview(),body=f.actorBody(shown),first=await f.authorize(body),before=snapshot(f),restore=beforeFreshQuote(f);
  let again;try{again=await f.authorize(structuredClone(body));}finally{restore();}
  assert.equal(again.replayed,true);assert.equal(canonicalJson({...again,replayed:false}),canonicalJson(first));assert.deepEqual(snapshot(f),before);
  assert.equal(count(f,'experience_sponsor_consumptions'),f.policy.maximumAdmissions);assertNoRun(f);f.limits.assertVerified();
});

test('lost native admission acknowledgement recovers the original server authorization without another purchase',async t=>{
  trapEgress(t);const f=await fixture(t),shown=await f.readReview(),body=f.actorBody(shown),batch=f.env.DB.batch.bind(f.env.DB);let injected=0;
  f.env.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(statement=>/^INSERT INTO output_execution_grants\(/u.test(statement.sql))){injected++;throw Error('Synthetic native admission ACK lost after actual commit');}return result;};
  let initial;try{initial=await f.authorize(body);}catch(error){assert.match(String(error),/ACK lost|original|changed/u);}finally{f.env.DB.batch=batch;}
  assert.equal(injected,1);assert.equal(count(f,'output_execution_grants'),1);const before=operations(f),receipt=originalReceipt(f),restore=beforeFreshQuote(f);
  let replay;try{replay=await f.authorize(structuredClone(body));}finally{restore();}
  assert.equal(replay.replayed,true);assert.equal(replay.receipt.eventId,receipt.event_id);assert.equal(replay.receipt.requestDigest,receipt.request_digest);
  if(initial)assert.equal(replay.grantId,initial.grantId);assert.deepEqual(operations(f),before);assertNoRun(f);f.limits.assertVerified();
});

test('changed actor intent and foreign draft/campaign/principal never renew an existing authorization',async t=>{
  trapEgress(t);const f=await fixture(t),shown=await f.readReview(),body=f.actorBody(shown);await f.authorize(body);const before=snapshot(f);
  for(const change of [value=>value.audioCostConsent.confirmed=false,value=>value.audioCostConsent.providerTransferConfirmed=false,
    value=>value.sponsorReview.reviewDigest='sha256:'+'f'.repeat(64),value=>value.sponsorReview.campaignId='foreign',value=>value.maximumMicrousd++,
    value=>value.payerUserId='caller-selected',value=>value.explicitRun=true,value=>value.draftHash='sha256:'+'f'.repeat(64)]){
    const changed=structuredClone(body);change(changed);await assert.rejects(f.authorize(changed));assert.deepEqual(snapshot(f),before);
  }
  await assert.rejects(f.authorize(body,{request:new Request(`http://localhost/api/experiences/drafts/experience-draft-${'f'.repeat(64)}/output/authorize`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}));
  await assert.rejects(f.authorize(body,{headers:headers(payer)}));
  await assert.rejects(f.authorize(body,{config:{...f.config,campaignId:'foreign-campaign'}}));
  assert.deepEqual(snapshot(f),before);assertNoRun(f);
});

test('review rejects a canceled actual Request, foreign URL and mismatched server selection without writes',async t=>{
  trapEgress(t);const f=await fixture(t),before=snapshot(f),controller=new AbortController();controller.abort();
  const canceled=new Request(f.reviewRequest().url,{signal:controller.signal});await assert.rejects(f.readReview(canceled));
  await assert.rejects(f.readReview(new Request(f.reviewRequest().url+'?campaignId=caller-choice')));
  await assert.rejects(f.readReview(new Request(`http://localhost/api/experiences/sponsor/audio/drafts/experience-draft-${'f'.repeat(64)}/review`)));
  await assert.rejects(f.readReview(f.reviewRequest(),{...f.config,templateDigest:'sha256:'+'f'.repeat(64)}));
  await assert.rejects(f.readReview(f.reviewRequest(),{...f.config,preflightId:'foreign-preflight'}));
  assert.deepEqual(snapshot(f),before);assertNoRun(f);
});

test('authorization rejects expiry and post-read cancellation before any issuance or native reservation',async t=>{
  trapEgress(t);const f=await fixture(t),shown=await f.readReview(),body=f.actorBody(shown),before=snapshot(f),clock=Date.now;
  try{Date.now=()=>Date.parse(shown.review.expiresAt);await assert.rejects(f.authorize(body));}finally{Date.now=clock;}
  assert.deepEqual(snapshot(f),before);
  const prepare=f.env.DB.prepare;let injected=0;
  const intercept=statement=>{const first=statement.first,bind=statement.bind;
    statement.bind=(...args)=>intercept(bind.apply(statement,args));
    statement.first=async(...args)=>{const result=await first.apply(statement,args);if(!injected){injected++;f.controller.abort();}return result;};return statement;};
  f.env.DB.prepare=function(sql){const statement=prepare.call(this,sql);return /experience_sponsor_campaigns/u.test(sql)?intercept(statement):statement;};
  try{await assert.rejects(f.authorize(body));}finally{f.env.DB.prepare=prepare;}
  assert.equal(injected,1);assert.deepEqual(snapshot(f),before);assertNoRun(f);
});

test('review qualification traces only actual source reads and strict D1-compatible SQL',async t=>{
  trapEgress(t);const f=await fixture(t),observed=traceDatabase(f);let shown;
  try{shown=await f.readReview();}finally{observed.restore();}
  const statements=observed.trace.flatMap(entry=>entry.statements??[entry]);
  assert.ok(statements.some(entry=>/output_preflights/u.test(entry.sql)));assert.ok(statements.some(entry=>/event_private_payloads/u.test(entry.sql)));
  assert.ok(statements.some(entry=>/experience_sponsor_approvals/u.test(entry.sql)));assert.ok(statements.some(entry=>/SELECT CASE WHEN/u.test(entry.sql)));
  assert.equal(shown.review.preview.sourceFilesTransferred,0);f.limits.assertVerified();assertNoRun(f);
});

test('wire copies cannot recover private review provenance or outlive the original review Request',async t=>{
  trapEgress(t);const f=await fixture(t),trusted=await f.load(f.reviewRequest());
  const {readSponsorAudioCurrentReview,sponsorAudioCurrentReviewNative}=await import('../worker/experience-sponsor-audio-review.ts');
  const shown=await readSponsorAudioCurrentReview(trusted,f.config),before=snapshot(f);
  const native=await sponsorAudioCurrentReviewNative(shown,trusted);
  assert.equal(native.preflightId,f.terms.id);assert.equal(native.expectedRevision,f.command.expectedRevision);assert.equal(typeof native.assertCurrent,'function');
  await assert.rejects(sponsorAudioCurrentReviewNative(structuredClone(shown),trusted));
  await assert.rejects(sponsorAudioCurrentReviewNative(shown,await f.load(f.reviewRequest())));
  f.controller.abort();assert.throws(native.assertCurrent);await assert.rejects(sponsorAudioCurrentReviewNative(shown,trusted));
  assert.deepEqual(snapshot(f),before);assertNoRun(f);
});

test('final passive review proof rejects false, sparse, accessor-error and expired acknowledgements',async t=>{
  trapEgress(t);
  for(const fault of ['false','sparse','accessor-error','expiry']){
    const f=await fixture(t),before=snapshot(f),batch=f.env.DB.batch.bind(f.env.DB),clock=Date.now;let injected=0,getters=0;
    f.env.DB.batch=async statements=>{
      const results=await batch(statements);
      if(!injected&&statements.some(statement=>/output_preflights/u.test(statement.sql))&&statements.some(statement=>/experience_sponsor_resource_policies/u.test(statement.sql))){
        injected++;
        if(fault==='false')results[0].results[0].current=0;
        if(fault==='sparse')delete results[0];
        if(fault==='accessor-error')Object.defineProperty(results[0],'error',{get(){getters++;return undefined;}});
        if(fault==='expiry')Date.now=()=>Date.parse(f.terms.expiresAt);
      }
      return results;
    };
    try{await assert.rejects(f.readReview(),undefined,fault);}finally{f.env.DB.batch=batch;Date.now=clock;}
    assert.equal(injected,1,fault);assert.equal(getters,0,fault);assert.deepEqual(snapshot(f),before,fault);assertNoRun(f);
  }
});

test('passive review refuses a changed actual confirmed-plan event pointer at final disclosure',async t=>{
  trapEgress(t);const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB);
  const original=f.sqlite.prepare('SELECT scope_key,plan_revision_id,confirmed_event_id FROM output_plan_revisions').get();
  assert.ok(original);const other=f.sqlite.prepare('SELECT event_id FROM events WHERE event_id<>? ORDER BY sequence LIMIT 1').get(original.confirmed_event_id);assert.ok(other);
  let injected=0;
  f.env.DB.batch=async statements=>{
    if(!injected&&statements.some(statement=>/output_preflights/u.test(statement.sql))&&statements.some(statement=>/experience_sponsor_resource_policies/u.test(statement.sql))){
      injected++;f.sqlite.prepare('UPDATE output_plan_revisions SET confirmed_event_id=? WHERE scope_key=? AND plan_revision_id=?').run(other.event_id,original.scope_key,original.plan_revision_id);
      assert.ok(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(original.confirmed_event_id),'Old private body still exists unchanged');
    }
    return batch(statements);
  };
  try{await assert.rejects(f.readReview(),/changed|source|plan/u,'A real changed plan pointer must prevent final review disclosure');}finally{f.env.DB.batch=batch;}
  assert.equal(injected,1);assert.equal(f.sqlite.prepare('SELECT confirmed_event_id FROM output_plan_revisions').get().confirmed_event_id,other.event_id);
  for(const table of tables)assert.equal(count(f,table),0,table);assertNoRun(f);
});

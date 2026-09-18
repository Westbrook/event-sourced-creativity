import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,actor,payer,headers,post,compileSponsorApprovalProposal,approveSponsorCampaign} from './sponsor-audio-v8-native-fixture.mjs';
import {nativeTemplate} from './sponsor-audio-evidence-fixture.mjs';
const [{loadOutputTrustedContext,outputExperienceCommands},{describeSponsorAudioAdmission,readSponsorAudioTemplateEvidence},
  {digest,canonicalJson},{readSponsorAudioCurrentReview},{authorizeSponsoredAudio},{SPONSOR_DRIVER_SCHEMA},
  {readSponsorAudioAuthorizationResponse,prepareSponsorAudioAuthorize}]=await Promise.all([
  import('../worker/output-requirements-api.ts'),import('../worker/experience-sponsor-audio-evidence.ts'),import('../src/experiences/compiler.ts'),
  import('../worker/experience-sponsor-audio-review.ts'),import('../worker/experience-sponsor-audio-authorize.ts'),import('../worker/experience-sponsor-driver.ts'),
  import('../src/experiences/sponsor-audio-review-transport.ts'),
]);
// Application functions and disposable SQLite, not built HTTP or workerd/D1.
// Native registered intake/confirmation/quote, actual payer approval and actual
// supplied actor POST; no operational rows are seeded. All egress is trapped.
const originalFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=()=>{outbound++;throw Error('No network in Audio AUTHORIZE qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(outbound,0);});
const tables=['events','event_private_payloads','output_commands','experience_sponsor_driver_intents','experience_sponsor_driver_stages',
  'experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_resource_receipts','experience_sponsor_consumptions',
  'experience_sponsor_active_jobs','output_execution_grants','output_operation_slots','document_jobs','output_provider_calls',
  'budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters'];
const rows=f=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const count=(f,name)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n;
const options=f=>({campaignId:f.campaignId,templateDigest:f.templateDigest,preflightId:f.terms.id});
async function prepared(t,{strict=false}={}){
  const f=await fixture(t,{sponsor:false,strict});
  for(const sql of SPONSOR_DRIVER_SCHEMA)f.sqlite.exec(sql);
  for(const method of ['get','head','put','delete','list'])f.env.MEDIA[method]=()=>{f.io.media.push({method});throw Error('No Audio AUTHORIZE asset access');};
  t.after(()=>{assert.deepEqual(f.io.media,[]);assert.deepEqual(f.io.assets,[]);});
  const preliminary=await loadOutputTrustedContext(new Request(`http://localhost${f.path}/authorize`,post(f.command)),f.env,f.documentId,'request');
  assert.ok(!(preliminary instanceof Response));
  const description=await describeSponsorAudioAdmission(preliminary,f.command),actual=await readSponsorAudioTemplateEvidence(preliminary,f.command,description.recipe),template=await nativeTemplate(actual);
  const now=f.sqlite.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS n").get().n,campaignId='authorize-audio-campaign';
  const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,maximumPendingGrants:10,maximumInflightJobs:1};
  const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
  const proposal={policy:{version:8,family:'canonical-instrumental-cue@1',mode:'candidate',campaignId,policyVersion:'audio-authorize-test@1',payerUserId:payer,audience:'canonical-principal',
    startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,maximumAdmissions:10,maximumMicrousd:template.maximumMicrousd*10,
    maximumAdmissionsPerActor:5,windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources},eligibleActorUserIds:[actor],issuerUserIds:[actor]};
  const terms=await compileSponsorApprovalProposal(proposal);
  await approveSponsorCampaign(new Request('http://localhost/__fixture/audio-authorize-approval',post({action:'approve-sponsor-campaign',approvalId:'authorize-audio-approval',
    proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:terms.termsDigest},headers(payer))),f.env);
  Object.assign(f,{campaignId,templateDigest:await digest(template)});
  const reviewRequest=new Request(`http://localhost/api/experiences/sponsor/audio/drafts/${f.draftId}/review`);
  const reviewTrusted=await loadOutputTrustedContext(reviewRequest,f.env,f.documentId,'request');assert.ok(!(reviewTrusted instanceof Response));
  const shown=await readSponsorAudioCurrentReview(reviewTrusted,options(f));
  const body={draftHash:f.draftHash,termsDigest:shown.review.termsDigest,maximumMicrousd:shown.review.preview.maximumMicrousd,explicitAuthorization:true,
    audioCostConsent:{...shown.review.preview,confirmed:true,providerTransferConfirmed:true},sponsorReview:{campaignId,reviewDigest:shown.reviewDigest}};
  const fresh=async({body:wire=body,url=`http://localhost${f.path}/authorize`,signal=f.controller.signal}={})=>{
    const request=new Request(url,{...post(wire),signal}),trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
    return {request,trusted,run:()=>authorizeSponsoredAudio(trusted,options(f))};
  };
  return Object.assign(f,{shown,body,fresh,...await fresh()});
}
function authorizedOnly(f){
  for(const table of ['experience_sponsor_driver_intents','experience_sponsor_driver_stages','experience_sponsor_grants','experience_sponsor_issuances',
    'experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs','output_execution_grants','output_operation_slots'])assert.equal(count(f,table),1,table);
  assert.equal(count(f,'document_jobs'),1);assert.equal(count(f,'output_provider_calls'),0);
  assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'queued');
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'authorized');
}

test('actual Audio POST persists original stage before admission and returns accepted native ACK without Run',async t=>{
  const f=await prepared(t,{strict:true}),actualWire=await f.request.clone().text(),identity=f.request,url=f.request.url;
  const prepare=outputExperienceCommands.prepareSponsoredAudioAdmission;
  t.mock.method(outputExperienceCommands,'prepareSponsoredAudioAdmission',async(trusted,command,review)=>{
    assert.equal(trusted.request,identity);assert.equal(trusted.request.url,url);assert.equal(trusted.request.bodyUsed,false);
    assert.equal(await trusted.request.clone().text(),actualWire);
    assert.equal(count(f,'experience_sponsor_driver_intents'),1);assert.equal(count(f,'experience_sponsor_driver_stages'),1);
    const retained=JSON.parse(f.sqlite.prepare('SELECT command_json FROM experience_sponsor_driver_stages').get().command_json);assert.deepEqual(retained,command);
    assert.equal(count(f,'experience_sponsor_consumptions'),0);return prepare(trusted,command,review);
  });
  const acknowledged=await f.run();authorizedOnly(f);
  assert.equal(f.request,identity);assert.equal(f.request.url,url);assert.equal(f.request.bodyUsed,false);
  assert.equal(acknowledged.replayed,false);assert.equal(acknowledged.jobId,f.shown.review.preview.requestId);
  const message=await prepareSponsorAudioAuthorize(f.shown,f.body);
  assert.equal(canonicalJson(await readSponsorAudioAuthorizationResponse(acknowledged,f.shown,message)),canonicalJson(acknowledged));
  assert.equal(acknowledged.actorRequestDigest,await digest(f.body));assert.notEqual(acknowledged.receipt.requestDigest,acknowledged.actorRequestDigest.slice(7));
  const event=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(acknowledged.receipt.eventId).private_json);
  assert.equal(acknowledged.grantId,event.grant_id);assert.deepEqual(event.output_command_envelope.sponsor_entitlement.audio_actor_intent.request,f.body);
  f.limits.assertVerified();
});

test('same original Audio replay uses retained expectedRevision before fresh review or payer capacity',async t=>{
  const f=await prepared(t),first=await f.run(),before=rows(f),stage=f.sqlite.prepare('SELECT * FROM experience_sponsor_driver_stages').get();
  const replay=await f.fresh();assert.notEqual(`output:${replay.trusted.ownerHead}`,JSON.parse(stage.command_json).expectedRevision);
  t.mock.method(outputExperienceCommands,'prepareSponsoredAudioReview',()=>{throw Error('Replay must not load a fresh quote');});
  t.mock.method(outputExperienceCommands,'prepareSponsoredAudioAdmission',()=>{throw Error('Replay must not prepare new admission');});
  const ack=await replay.run();assert.equal(ack.replayed,true);
  assert.deepEqual({...ack,replayed:false},first);assert.deepEqual(rows(f),before);
  assert.equal(replay.request.bodyUsed,false);authorizedOnly(f);
});

test('changed original actor wire, campaign, quote or template cannot replace retained Audio intent',async t=>{
  const f=await prepared(t);await f.run();const before=rows(f);
  for(const change of [body=>({...body,maximumMicrousd:body.maximumMicrousd+1}),body=>({...body,audioCostConsent:{...body.audioCostConsent,confirmed:false}}),
    body=>({...body,sponsorReview:{...body.sponsorReview,reviewDigest:`sha256:${'f'.repeat(64)}`}})]){
    const next=await f.fresh({body:change(structuredClone(f.body))});await assert.rejects(next.run());assert.deepEqual(rows(f),before);
  }
  for(const patch of [{campaignId:'changed-campaign'},{preflightId:'changed-preflight'},{templateDigest:`sha256:${'f'.repeat(64)}`}]){
    const next=await f.fresh();await assert.rejects(authorizeSponsoredAudio(next.trusted,{...options(f),...patch}));assert.deepEqual(rows(f),before);
  }
});

test('query, fragment, consumed body, false consent and caller-selected payer fail without operational writes',async t=>{
  const f=await prepared(t),before=rows(f);
  for(const suffix of ['?different=1','#different']){const next=await f.fresh({url:`http://localhost${f.path}/authorize${suffix}`});await assert.rejects(next.run());}
  for(const body of [{...f.body,payerUserId:payer},{...f.body,explicitAuthorization:false},{...f.body,audioCostConsent:{...f.body.audioCostConsent,providerTransferConfirmed:false}}]){
    const next=await f.fresh({body});await assert.rejects(next.run());
  }
  const consumed=await f.fresh();await consumed.request.text();await assert.rejects(consumed.run());assert.deepEqual(rows(f),before);
});

test('lost immutable intent-stage acknowledgement re-proves exact original before admission',async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO experience_sponsor_driver_stages'))){lost=true;throw Error('Synthetic committed stage ACK loss');}return result;};
  const ack=await f.run();assert.equal(lost,true);assert.equal(ack.replayed,false);authorizedOnly(f);
});

test('abort after original native authorization withholds ACK and preserves committed original',async t=>{
  const f=await prepared(t),execute=outputExperienceCommands.executeSponsored;let committed;
  t.mock.method(outputExperienceCommands,'executeSponsored',async(...args)=>{committed=await execute(...args);f.controller.abort();return committed;});
  await assert.rejects(f.run());assert.ok(committed);authorizedOnly(f);const before=rows(f);
  t.mock.restoreAll();const replay=await f.fresh({signal:new AbortController().signal}),ack=await replay.run();assert.equal(ack.replayed,true);
  assert.equal(ack.receipt.eventId,committed.receipt.eventId);assert.deepEqual(rows(f),before);
});

test('lost native commit acknowledgement recovers only the original recorded authorize stage',async t=>{
  const f=await prepared(t),execute=outputExperienceCommands.executeSponsored;let committed;
  t.mock.method(outputExperienceCommands,'executeSponsored',async(...args)=>{committed=await execute(...args);throw Error('Synthetic native admission ACK loss');});
  await assert.rejects(f.run(),/Synthetic native admission ACK loss/);authorizedOnly(f);const before=rows(f);
  t.mock.restoreAll();const replay=await f.fresh(),ack=await replay.run();assert.equal(ack.replayed,true);
  assert.equal(ack.receipt.eventId,committed.receipt.eventId);assert.deepEqual(rows(f),before);
});

const finalAck=statements=>statements.some(s=>s.sql.includes('JOIN output_execution_grants execution')&&s.sql.includes('slot.job_id=?'))
  &&statements.some(s=>s.sql.includes('experience_sponsor_driver_stages'));
for(const [name,damage] of [
  ['sparse batch',results=>{delete results[0];}],
  ['short batch',results=>{results.pop();}],
  ['false success',results=>{results[0].success=false;}],
  ['error value',results=>{results[0].error='synthetic error';}],
  ['error getter',results=>{Object.defineProperty(results[0],'error',{get(){throw Error('Do not invoke error getter');},enumerable:true});}],
  ['sparse rows',results=>{delete results[0].results[0];}],
  ['zero predicate',results=>{results[0].results[0].current=0;}],
])test(`final Audio ACK rejects ${name} while original native mutation remains`,async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let damaged=false;
  f.DB.batch=async statements=>{const results=await batch(statements);if(finalAck(statements)){damaged=true;damage(results);}return results;};
  await assert.rejects(f.run(),/sponsor_audio_authorize_ack_unconfirmed/);assert.equal(damaged,true);authorizedOnly(f);
  const before=rows(f);f.DB.batch=batch;const replay=await f.fresh();assert.equal((await replay.run()).replayed,true);assert.deepEqual(rows(f),before);
});

for(const [name,mutate] of [
  ['campaign revocation',f=>f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId)],
  ['current actor revocation',f=>f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(actor)],
  ['original receipt redaction',f=>f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-09-17T00:00:00.000Z' WHERE private_event_id=(SELECT event_id FROM output_commands WHERE action='authorize')").run()],
])test(`late ${name} withholds final ACK without undoing admitted original`,async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let changed=false;
  f.DB.batch=async statements=>{if(finalAck(statements)&&!changed){changed=true;mutate(f);}return batch(statements);};
  await assert.rejects(f.run());assert.equal(changed,true);authorizedOnly(f);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_commands WHERE action=\'authorize\'').get().n,1);
});

for(const column of ['payer_user_id','authorization_event_id'])test(`late native grant ${column} lineage change withholds Audio ACK`,async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let changed=false,before,original,replacement;
  f.DB.batch=async statements=>{
    if(finalAck(statements)&&!changed){
      changed=true;before=rows(f);original=f.sqlite.prepare('SELECT * FROM output_execution_grants').get();
      replacement=column==='payer_user_id'?actor:f.sqlite.prepare("SELECT event_id FROM output_commands WHERE action='preflight' AND event_id<>?").get(original.authorization_event_id).event_id;
      assert.notEqual(replacement,original[column]);
      assert.equal(f.sqlite.prepare(`UPDATE output_execution_grants SET ${column}=? WHERE scope_key=? AND grant_id=?`).run(replacement,original.scope_key,original.grant_id).changes,1);
    }
    return batch(statements);
  };
  let ack=null,error=null;try{ack=await f.run();}catch(caught){error=caught;}
  assert.equal(changed,true);authorizedOnly(f);
  const after=rows(f);
  for(const table of tables)if(table!=='output_execution_grants')assert.deepEqual(after[table],before[table],table);
  assert.equal(canonicalJson(after.output_execution_grants),canonicalJson([{...before.output_execution_grants[0],[column]:replacement}]));
  if(ack){
    assert.equal(ack.grantId,original.grant_id);assert.equal(ack.receipt.eventId,original.authorization_event_id);
    assert.equal(ack.jobId,f.shown.review.preview.requestId);assert.equal(ack.replayed,false);
    assert.equal(canonicalJson(await readSponsorAudioAuthorizationResponse(ack,f.shown,await prepareSponsorAudioAuthorize(f.shown,f.body))),canonicalJson(ack));
  }
  t.diagnostic(JSON.stringify({qualification:'real late disposable SQLite UPDATE; application ACK only, no Run/provider claim',column,
    originalValue:original[column],replacement,ack,error:error?.message??null,originalReceiptAndFinancialRowsPreserved:true}));
  assert.ok(error,'A changed native grant lineage must withhold the otherwise unchanged original Audio ACK');
  assert.equal(ack,null);assert.match(error.message,/sponsor_audio_authorize_ack_unconfirmed/);
});

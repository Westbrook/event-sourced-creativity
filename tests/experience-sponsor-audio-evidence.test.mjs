import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,actualEvidence,nativeTemplate,snapshot,noWrites,assertUnpaid,actor} from './sponsor-audio-evidence-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{describeSponsorAudioAdmission,readSponsorAudioTemplateEvidence},{matchSponsorAudioTemplate,readSponsorAudioCampaignTemplate},{outputDigest,rememberOutputPrivateBody}]=await Promise.all([
  import('../worker/experience-sponsor-audio-evidence.ts'),import('../worker/experience-sponsor-audio-contract.ts'),import('../worker/output-requirements-api.ts'),
]);
const originalFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=()=>{outbound++;throw Error('No network in dormant Audio qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(outbound,0);});
async function alterQuote(f,change){
  const row=f.sqlite.prepare('SELECT event_id FROM output_preflights WHERE preflight_id=?').get(f.command.preflightId);
  const body=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(row.event_id).private_json);
  change(body.preflight);const {termsDigest:ignored,...rest}=body.preflight;void ignored;
  body.preflight.termsDigest=await outputDigest(rest);f.command.termsDigest=body.preflight.termsDigest;
  f.sqlite.prepare('UPDATE output_preflights SET terms_digest=?,expires_at=? WHERE event_id=?').run(body.preflight.termsDigest,body.preflight.expiresAt,row.event_id);
  f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),row.event_id);
}
test('actual registered Audio intake, SAVE, confirm and quote qualify exactly three calls and one shared 128k ceiling under strict SQL limits',async t=>{
  const f=await fixture(t),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>limits.restore());
  const readonly=noWrites(f),{described,actual}=await actualEvidence(f),template=readSponsorAudioCampaignTemplate(await nativeTemplate(actual));
  assert.equal(await matchSponsorAudioTemplate(template,actual),true);assert.deepEqual(actual.recipe.calls,{parsing:0,planning:1,render:1,repair:1});
  assert.deepEqual(actual.offered.settings.calls.map(call=>call.stage),['planning:0:initial','planning:0:repair','audio:initial']);
  assert.equal(actual.recipe.maximumTokens,128000);assert.equal(actual.offered.maximumCalls,3);assert.equal(actual.recipe.durationMs,20000);
  assert.equal(actual.offered.settings.costPreview.sourceFilesTransferred,0);assert.equal(actual.offered.settings.duration.measuredSeconds,null);
  assert.equal(described.actorUserId,actor);assert.equal(described.ownerUserId,actor);assert.deepEqual(described.orderedAssetDigests,[]);
  assert.equal(actual.consent.providerTransferConfirmed,true);assert.deepEqual(actual.consent,{...actual.offered.settings.costPreview,confirmed:true,providerTransferConfirmed:true});
  assert.equal(actual.offered.settings.costPreview.draftId,f.draftId);assert.equal(Object.hasOwn(actual,'requestDigest'),false);
  assert.ok(Object.isFrozen(actual.offered.settings.calls));assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);limits.assertVerified();
  t.diagnostic(JSON.stringify({strictSqlShapes:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(r=>Buffer.byteLength(r.sql))),outbound}));
});
test('native consent, current native request identity and source ownership cannot be replaced by sponsor-shaped fields',async t=>{
  const f=await fixture(t),before=snapshot(f),readonly=noWrites(f);
  const changed=[x=>delete x.audioCostConsent,x=>x.audioCostConsent.confirmed=false,x=>x.audioCostConsent.providerTransferConfirmed=false,x=>x.audioCostConsent.actorUserId='sponsor-payer',
    x=>x.audioCostConsent.requestId='audio-'+ '0'.repeat(64),x=>x.audioCostConsent.durationSeconds=30,x=>x.audioCostConsent.sourceFilesTransferred=1,
    x=>x.audioCostConsent.maximumMicrousd++,x=>x.audioCostConsent.extra=true,x=>x.explicitAuthorization=false,x=>x.expectedRevision='output:0',x=>x.sponsor_entitlement={}];
  for(const mutate of changed){const command=structuredClone(f.command);mutate(command);await assert.rejects(describeSponsorAudioAdmission(f.trusted,command));}
  for(const change of [{scope:{...f.trusted.scope,kind:'project'}},{scope:{...f.trusted.scope,ownerUserId:'foreign'}},{principal:{...f.trusted.principal,fictional:true}},
    {principal:{...f.trusted.principal,billingUserId:'sponsor-payer'}},{sourcePrivateCaptured:false},{projectContext:{}}])await assert.rejects(describeSponsorAudioAdmission({...f.trusted,...change},f.command));
  assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);
});
test('native source profile, route and quote drift are refused even after a consistent quote rehash',async t=>{
  for(const mutate of [q=>q.targets[0].settings.calls[1].model='gpt-5.6-sol',q=>q.targets[0].settings.calls[1].maximumInputTokens++,
    q=>q.targets[0].settings.calls[0].maximumOutputTokens=6000,q=>q.targets[0].settings.calls[2].maximumMicrousd++,
    q=>q.targets[0].settings.payload.audioProfile.durationSeconds=30,q=>q.targets[0].settings.payload.audioProviderModel='other',
    q=>q.operationAttempts[q.targets[0].targetId]={ordinal:1,previousSlotId:'old'},q=>q.targets[0].settings.costPreview.requestId='audio-'+ 'a'.repeat(64)]){
    const f=await fixture(t);await alterQuote(f,mutate);const before=snapshot(f),readonly=noWrites(f);
    await assert.rejects(describeSponsorAudioAdmission(f.trusted,f.command));assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);
  }
});
test('unsupported provider configuration and media source facts are refused with no media access',async t=>{
  for(const provider of ['other',' fal','fal ']){const f=await fixture(t,{configuration:{FORMA_AUDIO_PROVIDER:provider}}),before=snapshot(f),readonly=noWrites(f);
    await assert.rejects(describeSponsorAudioAdmission(f.trusted,f.command),/sponsor_audio_provider_unavailable/);assert.deepEqual(snapshot(f),before);readonly();}
  const f=await fixture(t),before=snapshot(f),readonly=noWrites(f);
  for(const fact of [{type:'audio',properties:{text:'Listening description'}},{type:'reference',properties:{text:'Reference'}},{type:'message',properties:{text:'Reference',media_url:'/api/media/synthetic'}},{type:'unknown',properties:{text:'Unknown'}}]){
    const context=structuredClone(f.trusted.context);context.snapshot.facts.push(fact);
    await assert.rejects(describeSponsorAudioAdmission({...f.trusted,context},f.command),/sponsor_audio_text_source_required/);
  }
  assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);
});
test('the final native proof batch refuses late private source, quote, identity and retained witness changes',async t=>{
  for(const kind of ['source','quote','principal','email','display-name','retained']){
    const f=await fixture(t),witness='audio-extra-private-witness';
    if(kind==='retained'){const raw=JSON.stringify({witness:'original'});f.sqlite.prepare('INSERT INTO event_private_payloads(private_event_id,owner_id,project_id,document_id,private_json,created_at) VALUES(?,?,?,?,?,?)').run(witness,actor,f.trusted.scope.projectId,f.documentId,raw,new Date().toISOString());rememberOutputPrivateBody(f.trusted.scope,witness,raw);}
    const batch=f.DB.batch.bind(f.DB);let injected=false,afterMutation;
    f.DB.batch=async statements=>{if(!injected&&statements.some(s=>s.sql.includes('private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?'))){injected=true;
      if(kind==='source')assert.ok(f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE document_id=? AND private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated')").run(new Date().toISOString(),f.documentId).changes>0);
      if(kind==='quote')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.command.preflightId);
      if(kind==='principal')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
      if(kind==='email')f.sqlite.prepare('UPDATE users SET email=? WHERE user_id=?').run('changed@example.invalid',actor);
      if(kind==='display-name')f.sqlite.prepare('UPDATE users SET display_name=? WHERE user_id=?').run('Changed identity',actor);
      if(kind==='retained')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(witness);
      afterMutation=snapshot(f);
    }return batch(statements);};
    const readonly=noWrites(f);await assert.rejects(describeSponsorAudioAdmission(f.trusted,f.command));assert.equal(injected,true);assert.deepEqual(snapshot(f),afterMutation);readonly();assertUnpaid(f);
  }
});
test('late caller object, credentials and request changes cannot outlive the evidence read',async t=>{
  for(const kind of ['request','headers','database','credentials','model','provider','source','events','principal-object','scope-object','abort']){
    const f=await fixture(t),before=snapshot(f),batch=f.DB.batch.bind(f.DB);let injected=false;const abort=new AbortController();
    if(kind==='abort')f.trusted.request=new Request(f.request,{signal:abort.signal});
    f.DB.batch=async statements=>{if(!injected&&statements.some(s=>s.sql.includes('private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?'))){injected=true;
      if(kind==='request')f.trusted.request=new Request(f.request);if(kind==='headers')f.request.headers.set('oai-authenticated-user-id','other');if(kind==='database')f.env.DB={...f.DB};
      if(kind==='credentials')f.env.FAL_KEY='different-synthetic-presence';if(kind==='model')f.env.OPENAI_MODEL='gpt-5.6-sol';if(kind==='provider')f.env.FORMA_AUDIO_PROVIDER='other';
      if(kind==='source')f.trusted.context.snapshot.facts[0].properties.text+=' changed';if(kind==='events')f.trusted.events=[];
      if(kind==='principal-object')f.trusted.principal={...f.trusted.principal};if(kind==='scope-object')f.trusted.scope={...f.trusted.scope};if(kind==='abort')abort.abort();
    }return batch(statements);};
    const readonly=noWrites(f);await assert.rejects(describeSponsorAudioAdmission(f.trusted,f.command));assert.equal(injected,true);assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);
  }
});
test('expired native confirmation and late request deadline cannot be renewed by the evidence reader',async t=>{
  const f=await fixture(t);await alterQuote(f,q=>q.expiresAt=new Date(Date.now()-1).toISOString());const before=snapshot(f),readonly=noWrites(f);
  await assert.rejects(describeSponsorAudioAdmission(f.trusted,f.command),/sponsor_native_terms_changed/);assert.deepEqual(snapshot(f),before);readonly();
  const late=await fixture(t),deadline=Date.parse(late.command.audioCostConsent.expiresAt),clock=Date.now,batch=late.DB.batch.bind(late.DB);let reached=false;
  late.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(s=>s.sql.includes('private_json=? AND source_head=? AND plan_revision_id=? AND plan_json=?'))){reached=true;Date.now=()=>deadline;}return result;};
  try{await assert.rejects(describeSponsorAudioAdmission(late.trusted,late.command),/sponsor_authority_changed/);}finally{Date.now=clock;}assert.equal(reached,true);assertUnpaid(late);
});
test('caller command and recipe are captured before asynchronous native reads',async t=>{
  const f=await fixture(t),{actual}=await actualEvidence(f),command=structuredClone(f.command),recipe=structuredClone(actual.recipe),before=snapshot(f),readonly=noWrites(f);
  const pending=readSponsorAudioTemplateEvidence(f.trusted,command,recipe);command.audioCostConsent.providerTransferConfirmed=false;recipe.maximumTokens=1;
  assert.deepEqual(await pending,actual);await assert.rejects(readSponsorAudioTemplateEvidence(f.trusted,command,recipe));assert.deepEqual(snapshot(f),before);readonly();assertUnpaid(f);
});
test('pre-aborted and post-read-aborted requests stop before any later collector-owned private read',async t=>{
  for(const stage of ['before-first','after-principal','after-quote']){
    const f=await fixture(t),controller=new AbortController();f.trusted.request=new Request(f.request,{signal:controller.signal});
    const prepare=f.DB.prepare.bind(f.DB),seen=[];
    f.DB.prepare=sql=>{seen.push(sql);const statement=prepare(sql),bind=statement.bind;
      statement.bind=function(...values){const bound=bind.apply(this,values),first=bound.first.bind(bound);
        bound.first=async()=>{const value=await first();if(stage==='after-principal'&&sql.includes('SELECT principal.*')||stage==='after-quote'&&sql.startsWith('SELECT preflight.terms_digest'))controller.abort();return value;};return bound;};return statement;};
    if(stage==='before-first')controller.abort();
    const before=snapshot(f);await assert.rejects(describeSponsorAudioAdmission(f.trusted,f.command),/sponsor_authority_changed/);
    if(stage==='before-first')assert.equal(seen.length,0);if(stage==='after-principal')assert.equal(seen.length,1);
    if(stage==='after-quote')assert.ok(seen.at(-1).startsWith('SELECT preflight.terms_digest'));
    assert.deepEqual(snapshot(f),before);assertUnpaid(f);
  }
});

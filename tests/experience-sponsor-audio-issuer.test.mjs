import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,actor,payer} from './sponsor-audio-server-native-fixture.mjs';
const [{digest,canonicalJson},{digestSponsoredAudioReview},{issueSponsorAudioGrant}]=await Promise.all([
  import('../src/experiences/compiler.ts'),import('../src/experiences/sponsored-audio-actor-intent.ts'),
  import('../worker/experience-sponsor-audio-issuer.ts'),
]);

// Real registered ordinary Audio preparation, actual synthetic payer POST and
// separately supplied actor POST. No preinserted issuance, admission or Run.
const originalFetch=globalThis.fetch;let outbound=0;
globalThis.fetch=()=>{outbound++;throw Error('Audio issuer tests prohibit provider/network access');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(outbound,0);});
const tables=['experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_issuances',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','output_execution_grants','output_operation_slots',
  'document_jobs','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters','output_provider_calls'];
const rows=f=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const isIssuance=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_issuances'));
function noExecution(f){
  for(const table of ['experience_sponsor_consumptions','experience_sponsor_active_jobs','output_execution_grants','output_operation_slots',
    'document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(count(f,table),0,table);
  assert.deepEqual(f.io.media,[]);assert.deepEqual(f.io.assets,[]);
  for(const name of ['budget_counters','cost_budget_counters'])assert.deepEqual(f.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),f.initialCounters[name],name);
}
async function prepared(t,{strict=false,...options}={}){
  const f=await fixture(t,{strict,...options});
  await f.prepareActor();
  for(const table of ['experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_issuances'])assert.equal(count(f,table),0);
  f.initialCounters=Object.fromEntries(['budget_counters','cost_budget_counters'].map(name=>[name,f.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
  return f;
}
const input=f=>({trusted:f.trusted,command:f.command,preparation:f.preparation,campaignId:f.campaignId,templateDigest:f.templateDigest});
const issue=(f,patch={})=>issueSponsorAudioGrant({...input(f),...patch});

test('Audio issuer records one actual issuance and exact actor review under strict SQL limits, without native admission',async t=>{
  const f=await prepared(t,{strict:true}),issued=await issue(f);
  assert.equal(issued.kind,'issued');assert.equal(issued.replayed,false);assert.ok(issued.admissionAuthority);
  assert.equal(issued.envelope.version,8);assert.equal(issued.envelope.family,'canonical-instrumental-cue@1');
  assert.equal(issued.envelope.payerUserId,payer);assert.equal(issued.envelope.actorUserId,actor);assert.equal(issued.envelope.ownerUserId,actor);
  assert.equal(issued.envelope.templateDigest,f.templateDigest);assert.equal(issued.envelope.audioActorRequestDigest,await digest(f.body));
  assert.equal(issued.envelope.audioSponsorReviewDigest,await digestSponsoredAudioReview(f.review));
  assert.equal(issued.envelope.originalRequestId,f.review.preview.requestId);assert.equal(issued.envelope.originalExpiresAtMs,Date.parse(f.review.preview.expiresAt));
  assert.equal(issued.envelope.intentKey,f.command.clientMutationId);assert.equal(issued.envelope.recipe.maximumMicrousd,f.command.maximumMicrousd);
  assert.ok(issued.envelope.expiresAtMs<=Math.min(f.policy.expiresAtMs,f.policy.resources.expiresAtMs,Date.parse(f.review.expiresAt),issued.envelope.issuedAtMs+f.policy.maximumGrantLifetimeMs));
  for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_resource_receipts'])assert.equal(count(f,table),1);
  const resource=f.sqlite.prepare('SELECT * FROM experience_sponsor_resource_receipts').get(),retained=f.sqlite.prepare('SELECT * FROM experience_sponsor_issuances').get();
  assert.equal(resource.operation,'issuance');assert.equal(resource.issued_grant_id,issued.grantId);assert.equal(resource.actor_user_id,actor);
  assert.equal(resource.text_bytes,new TextEncoder().encode(canonicalJson(f.trusted.context.snapshot)).byteLength);
  assert.equal(retained.command_digest,await digest(f.command));assert.equal(retained.envelope_json,canonicalJson(issued.envelope));
  assert.equal(retained.driver_command_json,canonicalJson(f.body));
  assert.equal(resource.payload_digest,retained.envelope_digest);assert.equal(f.request.bodyUsed,false);noExecution(f);
  const before=rows(f),replay=await issue(f);assert.equal(replay.replayed,true);assert.equal(replay.grantId,issued.grantId);
  assert.deepEqual(replay.envelope,issued.envelope);assert.deepEqual(rows(f),before);
  f.limits.assertVerified();t.diagnostic(JSON.stringify({qualification:'disposable SQLite, not local D1',sqlShapes:f.limits.records.length,
    maximumBindings:Math.max(...f.limits.boundCounts),maximumSqlBytes:Math.max(...f.limits.records.map(r=>Buffer.byteLength(r.sql))),outbound}));
});

test('exact unadmitted Audio issuance replay from a fresh Request preserves all operational rows and timestamps',async t=>{
  const f=await prepared(t),first=await issue(f),before=rows(f),originalRequest=f.request;
  await f.prepareActor();assert.notEqual(f.request,originalRequest);
  const replay=await issue(f);
  assert.equal(replay.kind,'issued');assert.equal(replay.replayed,true);assert.equal(replay.grantId,first.grantId);assert.deepEqual(replay.envelope,first.envelope);
  assert.ok(replay.admissionAuthority);assert.deepEqual(rows(f),before);noExecution(f);
});

test('same native intent cannot replace its genuinely prepared actor wire with a different reviewed deadline',async t=>{
  const f=await prepared(t),first=await issue(f),before=rows(f),originalCommand=canonicalJson(f.command),originalBody=canonicalJson(f.body);
  const changed=structuredClone(f.shown);
  changed.review.expiresAt=new Date(Date.parse(changed.review.expiresAt)-1000).toISOString();
  changed.reviewDigest=await digestSponsoredAudioReview(changed.review);
  await f.prepareActor(changed);
  assert.equal(canonicalJson(f.command),originalCommand);assert.notEqual(canonicalJson(f.body),originalBody);
  assert.notEqual(await digest(f.body),first.envelope.audioActorRequestDigest);
  await assert.rejects(issue(f),/sponsor_issuer_intent_conflict/);
  assert.deepEqual(rows(f),before);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);noExecution(f);
});

test('copied or foreign native preparation cannot mint an Audio issuance',async t=>{
  const f=await prepared(t),other=await prepared(t),before=rows(f);
  for(const preparation of [{},structuredClone(f.preparation),{...f.preparation},other.preparation])await assert.rejects(issue(f,{preparation}));
  assert.deepEqual(rows(f),before);
});

test('Audio issuer rejects campaign/template substitution and altered original command before issuance',async t=>{
  const f=await prepared(t),before=rows(f);
  for(const patch of [{campaignId:'wrong-campaign'},{templateDigest:`sha256:${'f'.repeat(64)}`},
    {command:{...f.command,maximumMicrousd:f.command.maximumMicrousd+1}},{command:{...f.command,expectedRevision:'output:999999'}},
    {command:{...f.command,audioCostConsent:{...f.command.audioCostConsent,providerTransferConfirmed:false}}},
    {command:{...f.command,payerUserId:payer}}])await assert.rejects(issue(f,patch));
  assert.deepEqual(rows(f),before);
});

for(const fault of ['approval','resource policy','quote'])test(`Audio issuance commit-edge ${fault} revocation rolls back every new operational row`,async t=>{
  const f=await prepared(t),before=rows(f),batch=f.DB.batch.bind(f.DB);let reached=false;
  f.DB.batch=async statements=>{
    if(!reached&&isIssuance(statements)){
      reached=true;
      if(fault==='approval')f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
      if(fault==='resource policy')f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
      if(fault==='quote')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.terms.id);
    }
    return batch(statements);
  };
  await assert.rejects(issue(f));assert.equal(reached,true);assert.deepEqual(rows(f),before);
});

for(const fault of ['approval','resource policy','grant'])test(`current ${fault} revocation refuses exact Audio issuance replay without new debit`,async t=>{
  const f=await prepared(t);await issue(f);
  if(fault==='approval')f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
  if(fault==='resource policy')f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  if(fault==='grant')f.sqlite.prepare('UPDATE experience_sponsor_grants SET enabled=0').run();
  const before=rows(f);await assert.rejects(issue(f));assert.deepEqual(rows(f),before);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
});

test('lost Audio issuance acknowledgment resolves the exact committed original without another purchase',async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let reached=false,committed;
  f.DB.batch=async statements=>{const value=await batch(statements);if(!reached&&isIssuance(statements)){reached=true;committed=rows(f);throw Error('Synthetic lost Audio issuer acknowledgement');}return value;};
  const issued=await issue(f);assert.equal(reached,true);assert.equal(issued.replayed,true);assert.equal(count(f,'experience_sponsor_grants'),1);
  assert.deepEqual(rows(f),committed);assert.equal(issued.grantId,committed.experience_sponsor_issuances[0].grant_id);
  assert.equal(canonicalJson(issued.envelope),committed.experience_sponsor_issuances[0].envelope_json);
  const before=rows(f),replay=await issue(f);assert.equal(replay.grantId,issued.grantId);assert.deepEqual(replay.envelope,issued.envelope);assert.deepEqual(rows(f),before);
});

test('failed issuance before commit leaves no original and no issuance resource charge',async t=>{
  const f=await prepared(t),before=rows(f),batch=f.DB.batch.bind(f.DB);let reached=false;
  f.DB.batch=async statements=>{if(isIssuance(statements)){reached=true;throw Error('Synthetic precommit failure');}return batch(statements);};
  await assert.rejects(issue(f));assert.equal(reached,true);assert.deepEqual(rows(f),before);
});

for(const fault of ['abort','headers','DB','source','deadline'])test(`Audio issuer refuses ${fault} drift during its owned hash await before further writes`,async t=>{
  const f=await prepared(t),before=rows(f),original=crypto.subtle.digest.bind(crypto.subtle),clock=Date.now,database=f.env.DB;
  let reached=false,foreign=0,atMutation;const injectionErrors=[];
  t.mock.method(crypto.subtle,'digest',async(...args)=>{
    const value=await original(...args);
    if(!reached){reached=true;atMutation=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
      try{
        if(fault==='abort'){f.controller.abort();assert.equal(f.request.signal.aborted,true);}
        if(fault==='headers'){f.request.headers.set('oai-authenticated-user-id',payer);assert.equal(f.request.headers.get('oai-authenticated-user-id'),payer);}
        if(fault==='DB'){f.env.DB={...database,prepare(){foreign++;throw Error('Foreign DB prepare');},batch(){foreign++;throw Error('Foreign DB batch');}};assert.notEqual(f.env.DB,database);}
        if(fault==='source'){const previous=f.trusted.context;f.trusted.context={...previous,snapshot:{...previous.snapshot,title:'Changed after native preparation'}};assert.notEqual(f.trusted.context,previous);}
        if(fault==='deadline'){Date.now=()=>Date.parse(f.review.expiresAt);assert.equal(Date.now(),Date.parse(f.review.expiresAt));}
      }catch(error){injectionErrors.push(error);throw error;}
    }
    return value;
  });
  try{await assert.rejects(issue(f));}finally{Date.now=clock;f.env.DB=database;}
  assert.equal(reached,true);assert.deepEqual(injectionErrors,[]);assert.equal(foreign,0);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,atMutation);assert.deepEqual(rows(f),before);
});

test('late abort after committed Audio issuance preserves immutable original without returning capability',async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let reached=false,committed;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!reached&&isIssuance(statements)){reached=true;committed=rows(f);f.controller.abort();}return result;};
  await assert.rejects(issue(f));assert.equal(reached,true);assert.deepEqual(rows(f),committed);
  for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_resource_receipts'])assert.equal(count(f,table),1);
});

for(const fault of ['sparse','error getter','false predicate'])test(`malformed ${fault} final proof cannot return Audio authority or erase committed issuance`,async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let committed=false,reached=false,getters=0,retained,originalLength;const injectionErrors=[];
  f.DB.batch=async statements=>{
    const result=await batch(statements);
    if(isIssuance(statements)){committed=true;retained=rows(f);}
    else if(committed&&!reached&&statements.every(statement=>/^\s*SELECT\b/iu.test(statement.sql))
      &&statements.some(statement=>statement.sql.includes('experience_sponsor_grants'))){
      reached=true;originalLength=result.length;
      try{
        if(fault==='sparse')delete result[0];
        if(fault==='error getter')Object.defineProperty(result[0],'error',{enumerable:true,get(){getters++;return undefined;}});
        if(fault==='false predicate')result[0].results=[{current:0}];
      }catch(error){injectionErrors.push(error);throw error;}
    }
    return result;
  };
  await assert.rejects(issue(f));assert.equal(committed,true);assert.equal(reached,true);assert.ok(originalLength>0);assert.deepEqual(injectionErrors,[]);assert.equal(getters,0);
  assert.deepEqual(rows(f),retained);noExecution(f);
});

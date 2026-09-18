import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,actor,payer,stream,assertResourceAccounting,loadOutputTrustedContext,outputExperienceCommands,outputDocumentExecutionBridge} from './sponsor-scene-driver-fixture.mjs';
const [{prepareSponsoredSceneDriver,driveSponsoredScene},
  {createSponsorSceneIssuerAuthority,issueSponsorSceneGrant,readSponsorSceneDriverCommand,sponsorSceneIssuerIntentKey},
  {appendAuditEvent},{canonicalJson}]=await Promise.all([
  import('../worker/experience-sponsor-scene-driver.ts'),import('../worker/experience-sponsor-scene-issuer.ts'),
  import('../worker/runtime.ts'),import('../src/experiences/compiler.ts'),
]);

const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Scene issuer tests prohibit provider or external network calls');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
const state=f=>Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  .map(({name})=>[name,f.sqlite.prepare(`SELECT rowid AS original_rowid,* FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]));
const isIssuance=statements=>statements.some(statement=>statement.sql.startsWith('INSERT INTO experience_sponsor_grants('));
const finalProof=statements=>statements.every(statement=>statement.sql.startsWith('SELECT CASE WHEN'))
  &&statements.some(statement=>statement.sql.includes('EXISTS(SELECT 1 FROM experience_sponsor_grants WHERE grant_id=? AND campaign_id=? AND policy_digest=?'));
const afterSettlement=(pending,mutate,hops=1)=>new Promise((resolve,reject)=>{
  pending.then(value=>{resolve(value);let queued=()=>mutate(value);for(let i=1;i<hops;i++){const next=queued;queued=()=>queueMicrotask(next);}queueMicrotask(queued);},reject);
});
const noPurchase=f=>{for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_consumptions',
  'output_execution_grants','document_jobs','output_provider_calls','budget_reservations','cost_budget_reservations'])assert.equal(count(f,table),0,table);};
async function trusted(f){
  const current=await loadOutputTrustedContext(f.runRequest(f.prepared),f.env,f.documentId,'request');
  assert.ok(!(current instanceof Response));return current;
}

/** Reach the real issuer through production prepare and the actor's explicit
 * second request. Stop before its first grant transaction; do not reconstruct
 * or seed an intent, stage, resource ticket, quote, grant or native authority. */
async function prepared(t,options={}){
  const f=await fixture(t,options),preview=await prepareSponsoredSceneDriver(f.request(),f.env,f.context),batch=f.DB.batch.bind(f.DB);
  let reached=false;
  f.DB.batch=async statements=>{if(isIssuance(statements)){reached=true;throw Error('pause before genuine Scene issuance transaction');}return batch(statements);};
  try{await assert.rejects(driveSponsoredScene(f.runRequest(preview),f.env,f.context),/pause before genuine Scene issuance transaction/);}
  finally{f.DB.batch=batch;}
  assert.equal(reached,true);noPurchase(f);assert.equal(count(f,'experience_sponsor_resource_receipts'),2);assert.equal(count(f,'output_preflights'),1);
  assert.deepEqual(f.sqlite.prepare('SELECT stage FROM experience_sponsor_driver_stages ORDER BY rowid').all().map(row=>row.stage),['preflight','authorize']);
  const authorize=f.sqlite.prepare("SELECT command_json FROM experience_sponsor_driver_stages WHERE stage='authorize'").get();assert.ok(authorize);
  Object.assign(f,{prepared:preview,authorizeCommand:JSON.parse(authorize.command_json)});f.current=await trusted(f);return f;
}
async function issue(f,current=f.current,command=f.authorizeCommand){
  const authority=await createSponsorSceneIssuerAuthority(current,f.campaignId);
  return issueSponsorSceneGrant(authority,current,command);
}
async function admit(f){
  const issued=await issue(f);assert.equal(issued.kind,'issued');assert.ok(issued.admissionAuthority);
  const accepted=await outputExperienceCommands.executeSponsored(f.current,f.authorizeCommand,issued.admissionAuthority,outputDocumentExecutionBridge,f.context);
  assert.ok(!(accepted instanceof Response));return {issued,accepted};
}
function assertDenseProof(statements,results){
  assert.ok(statements.length>1);assert.equal(results.length,statements.length);
  for(let index=0;index<results.length;index++){
    assert.ok(Object.hasOwn(results,index));assert.equal(results[index].success,true);assert.equal(results[index].results.length,1);
    assert.ok(Object.hasOwn(results[index].results,0));assert.equal(results[index].results[0].current,1);
  }
}

test('closed Scene issuer wire preserves intent identity and refuses accessors without reading getters',async()=>{
  const command={action:'prepare-sponsored-scene',campaignId:'campaign',documentId:'document',planRevisionId:'plan',targetId:'target',intentKey:'intent'};
  assert.deepEqual(readSponsorSceneDriverCommand(command),command);assert.equal(Object.isFrozen(readSponsorSceneDriverCommand(command)),true);
  const key=await sponsorSceneIssuerIntentKey(command);assert.match(key,/^sponsor-scene-authorize-[a-f0-9]{64}$/u);
  assert.equal(await sponsorSceneIssuerIntentKey({...command,targetId:'changed'}),key);
  for(const patch of [{payerUserId:payer},{prompt:'replacement'},{nowMs:1},{maximumMicrousd:1},{outputKind:'video'},
    {action:'run-sponsored-slides'},{intentKey:'x'.repeat(81)}])assert.throws(()=>readSponsorSceneDriverCommand({...command,...patch}),/sponsor_driver_command_invalid/);
  let getters=0;const withGetter={...command};Object.defineProperty(withGetter,'intentKey',{enumerable:true,get(){getters++;return 'intent';}});
  assert.throws(()=>readSponsorSceneDriverCommand(withGetter),/sponsor_driver_command_invalid/);assert.equal(getters,0);
});

test('real Scene issuance joins genuine preparation with one immutable V6 grant and exact third resource debit',async t=>{
  const f=await prepared(t,{strict:true}),authority=await createSponsorSceneIssuerAuthority(f.current,f.campaignId);
  const issued=await issueSponsorSceneGrant(authority,f.current,f.authorizeCommand);
  assert.equal(issued.kind,'issued');assert.equal(issued.replayed,false);assert.ok(issued.admissionAuthority);assert.equal('nativeReceipt' in issued,false);
  assert.equal(issued.envelope.version,6);assert.equal(issued.envelope.family,'canonical-scene-screenplay@1');assert.equal(issued.envelope.recipe.outputKind,'scene');
  assert.equal(issued.envelope.payerUserId,payer);assert.equal(issued.envelope.ownerUserId,actor);assert.equal(issued.envelope.actorUserId,actor);
  assert.equal(issued.envelope.recipe.maximumMicrousd,f.prepared.preflight.maximumMicrousd);
  assert.ok(issued.envelope.expiresAtMs<=Date.parse(f.prepared.preflight.expiresAt));
  assert.equal(count(f,'experience_sponsor_grants'),1);assert.equal(count(f,'experience_sponsor_issuances'),1);assertResourceAccounting(f);
  const row=f.sqlite.prepare('SELECT * FROM experience_sponsor_issuances').get(),grant=f.sqlite.prepare('SELECT * FROM experience_sponsor_grants').get();
  assert.equal(row.grant_id,issued.grantId);assert.equal(row.envelope_json,canonicalJson(issued.envelope));
  assert.equal(JSON.parse(row.driver_command_json).sceneCostConsent.confirmed,true);
  assert.deepEqual(JSON.parse(row.driver_command_json).sceneCostConsent,f.authorizeCommand.sceneCostConsent);
  assert.equal(grant.issued_at_ms,issued.envelope.issuedAtMs);assert.equal(grant.expires_at_ms,issued.envelope.expiresAtMs);
  const resource=f.sqlite.prepare("SELECT * FROM experience_sponsor_resource_receipts WHERE operation='issuance'").get();
  assert.equal(resource.intent_key,f.authorizeCommand.clientMutationId);assert.equal(resource.resource_id,`${issued.grantId}:issuance`);
  for(const table of ['experience_sponsor_consumptions','output_execution_grants','document_jobs','output_provider_calls','budget_reservations','cost_budget_reservations'])assert.equal(count(f,table),0);
  const before=state(f),replay=await issueSponsorSceneGrant(authority,f.current,f.authorizeCommand);
  assert.equal(replay.replayed,true);assert.equal(replay.grantId,issued.grantId);assert.deepEqual(replay.envelope,issued.envelope);assert.deepEqual(state(f),before);
  f.limits.assertVerified();t.diagnostic(`Node-hosted native issuer, ${f.limits.records.length} strict SQL shapes, ${f.limits.exceptions} exact native metadata exceptions; no provider calls.`);
});

test('Scene issuer requires already charged production preparation and a persisted authorize stage',async t=>{
  const f=await fixture(t),preview=await prepareSponsoredSceneDriver(f.request(),f.env,f.context);
  f.prepared=preview;const current=await trusted(f),authority=await createSponsorSceneIssuerAuthority(current,f.campaignId),before=state(f);
  const command={action:'authorize',documentId:f.documentId,expectedRevision:`output:${current.ownerHead}`,clientMutationId:await sponsorSceneIssuerIntentKey(f.command),
    preflightId:preview.preflight.id,termsDigest:preview.preflight.termsDigest,maximumMicrousd:preview.preflight.maximumMicrousd,
    explicitAuthorization:true,sceneCostConsent:{...preview.sceneCostPreview,confirmed:true}};
  await assert.rejects(issueSponsorSceneGrant(authority,current,command),/sponsor_issuer_authority_changed/);
  assert.deepEqual(state(f),before);noPurchase(f);assert.equal(count(f,'experience_sponsor_resource_receipts'),2);
});

test('Scene issuer seal cannot be cloned or rebound to another Request, principal, source or database',async t=>{
  const f=await prepared(t),authority=await createSponsorSceneIssuerAuthority(f.current,f.campaignId),before=state(f);
  for(const seal of [{},structuredClone(authority),{...authority}])await assert.rejects(issueSponsorSceneGrant(seal,f.current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  for(const current of [{...f.current,request:f.current.request.clone()},{...f.current,env:{...f.env}},
    {...f.current,principal:{...f.current.principal,userId:payer}},
    {...f.current,context:{...f.current.context,snapshot:{...f.current.context.snapshot,title:'changed'}}},
    {...f.current,sourcePrivateCaptured:false}])await assert.rejects(issueSponsorSceneGrant(authority,current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  const db=f.env.DB;try{f.env.DB={...db};await assert.rejects(issueSponsorSceneGrant(authority,f.current,f.authorizeCommand),/sponsor_issuer_authority_changed/);}finally{f.env.DB=db;}
  assert.deepEqual(state(f),before);noPurchase(f);
});

test('Scene issuer refuses changed authorize bytes and accessor confirmation beneath the same real intent',async t=>{
  const f=await prepared(t),authority=await createSponsorSceneIssuerAuthority(f.current,f.campaignId),before=state(f);
  for(const patch of [{clientMutationId:'replacement-key'},{preflightId:'replacement-quote'},{maximumMicrousd:1},
    {sceneCostConsent:{...f.authorizeCommand.sceneCostConsent,confirmed:false}},{sponsor_entitlement:{payer_user_id:payer}}])
    await assert.rejects(issueSponsorSceneGrant(authority,f.current,{...f.authorizeCommand,...patch}),/sponsor_/);
  let getters=0;const consent={...f.authorizeCommand.sceneCostConsent};Object.defineProperty(consent,'confirmed',{enumerable:true,get(){getters++;return true;}});
  await assert.rejects(issueSponsorSceneGrant(authority,f.current,{...f.authorizeCommand,sceneCostConsent:consent}),/sponsor_command_invalid/);
  assert.equal(getters,0);assert.deepEqual(state(f),before);noPurchase(f);
});

test('resource withdrawal inside actual Scene issuance transaction rolls back the grant, ticket and injected withdrawal',async t=>{
  const f=await prepared(t),authority=await createSponsorSceneIssuerAuthority(f.current,f.campaignId),before=state(f),batch=f.DB.batch.bind(f.DB);let reached=false;
  f.DB.batch=async statements=>{
    if(!reached&&isIssuance(statements)){
      reached=true;const index=statements.findIndex(statement=>statement.sql.startsWith('INSERT INTO experience_sponsor_grants('));
      assert.ok(index>=0&&index+1<statements.length);
      return batch([...statements.slice(0,index+1),f.DB.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').bind(f.campaignId),
        statements[index+1],f.DB.prepare('UPDATE experience_sponsor_resource_policies SET enabled=1 WHERE campaign_id=?').bind(f.campaignId),...statements.slice(index+2)]);
    }return batch(statements);
  };
  await assert.rejects(issueSponsorSceneGrant(authority,f.current,f.authorizeCommand),/CHECK constraint failed|sponsor_/);
  assert.equal(reached,true);assert.deepEqual(state(f),before);assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_resource_policies').get().enabled,1);
  noPurchase(f);assert.equal(count(f,'experience_sponsor_resource_receipts'),2);
});

for(const withdrawal of ['quote expiry','approval','source'])test(`Scene ${withdrawal} at issuance commit edge prevents all new ownership`,async t=>{
  const f=await prepared(t),authority=await createSponsorSceneIssuerAuthority(f.current,f.campaignId),batch=f.DB.batch.bind(f.DB);let reached=false,afterWithdrawal;
  f.DB.batch=async statements=>{
    if(!reached&&isIssuance(statements)){
      reached=true;
      if(withdrawal==='quote expiry')f.sqlite.prepare('UPDATE output_preflights SET expires_at=? WHERE preflight_id=?').run('2020-01-01T00:00:00.000Z',f.prepared.preflight.id);
      if(withdrawal==='approval')f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
      if(withdrawal==='source')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',
        block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'The actor changes the source before the transaction.'});
      afterWithdrawal=state(f);
    }return batch(statements);
  };
  await assert.rejects(issueSponsorSceneGrant(authority,f.current,f.authorizeCommand),/CHECK constraint failed|sponsor_/);
  assert.equal(reached,true);assert.deepEqual(state(f),afterWithdrawal);noPurchase(f);assert.equal(count(f,'experience_sponsor_resource_receipts'),2);
});

test('Scene issuance lost acknowledgment returns the original grant and unchanged expiry without redebit',async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let reached=false,committed;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!reached&&isIssuance(statements)){
    reached=true;committed=f.sqlite.prepare('SELECT * FROM experience_sponsor_issuances').get();throw Error('lost genuine Scene issuance acknowledgment');}return result;};
  const issued=await issue(f);assert.equal(reached,true);assert.equal(issued.replayed,true);assert.equal(issued.grantId,committed.grant_id);
  assert.equal(canonicalJson(issued.envelope),committed.envelope_json);assertResourceAccounting(f);
  const before=state(f);assert.equal((await issue(f)).grantId,issued.grantId);assert.deepEqual(state(f),before);assert.equal(count(f,'document_jobs'),0);
});

test('admitted Scene issuer replay proves original lineage without recapturing admission source',async t=>{
  const f=await prepared(t,{strict:true}),{issued,accepted}=await admit(f),current=await trusted(f),before=state(f);let preparations=0;
  assert.notEqual(f.authorizeCommand.expectedRevision,`output:${current.ownerHead}`);
  t.mock.method(outputExperienceCommands,'prepareSponsoredSceneAdmission',async()=>{preparations++;throw Error('Fresh Scene admission capture prohibited after admission');});
  const replay=await issue(f,current);assert.equal(replay.kind,'admitted');assert.equal(replay.replayed,true);assert.equal(replay.grantId,issued.grantId);
  assert.equal('admissionAuthority' in replay,false);assert.equal(replay.nativeReceipt.eventId,accepted.receipt.eventId);
  assert.equal(canonicalJson(replay.nativeReceipt.payload),canonicalJson(accepted.receipt.payload));assert.equal(preparations,0);
  assert.deepEqual(state(f),before);assert.equal(count(f,'document_jobs'),1);assert.equal(count(f,'output_provider_calls'),0);f.limits.assertVerified();
});

for(const corruption of ['receipt redaction','slot route','consumption'])test(`Scene admitted replay refuses altered ${corruption} with no replacement`,async t=>{
  const f=await prepared(t);await admit(f);
  if(corruption==='receipt redaction')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=(SELECT event_id FROM output_commands WHERE action='authorize')").run();
  if(corruption==='slot route')f.sqlite.prepare('UPDATE output_operation_slots SET route_digest=?').run('f'.repeat(64));
  if(corruption==='consumption'){
    f.sqlite.exec('DROP TRIGGER experience_sponsor_consumptions_no_update');
    f.sqlite.prepare('UPDATE experience_sponsor_consumptions SET envelope_digest=?').run('sha256:'+'f'.repeat(64));
  }
  const current=await trusted(f),before=state(f);await assert.rejects(issue(f,current));assert.deepEqual(state(f),before);
  assertResourceAccounting(f);assert.equal(count(f,'document_jobs'),1);assert.equal(count(f,'output_provider_calls'),0);
});

test('disabled current Scene resource authority refuses an original admitted receipt without spending again',async t=>{
  const f=await prepared(t);await admit(f);f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  const current=await trusted(f),before=state(f);await assert.rejects(issue(f,current),/sponsor_/);
  assert.deepEqual(state(f),before);assertResourceAccounting(f);assert.equal(count(f,'document_jobs'),1);assert.equal(count(f,'output_provider_calls'),0);
});

for(const mutation of ['DB','Request','abort'])test(`Scene issuer ${mutation} change after original receipt read settles stops further writes`,async t=>{
  const f=await prepared(t);await admit(f);const current=await trusted(f),authority=await createSponsorSceneIssuerAuthority(current,f.campaignId);
  const database=f.env.DB,prepareSql=database.prepare;let reached=false,foreign=0,atBoundary,atChanges;
  database.prepare=function(sql){const wrap=statement=>{const bind=statement.bind,first=statement.first;
    statement.bind=function(...values){return wrap(bind.apply(this,values));};
    statement.first=function(...args){const pending=first.apply(this,args);
      if(!reached&&sql.startsWith('SELECT command.action,command.event_id'))return afterSettlement(pending,row=>{
        assert.ok(row);reached=true;atBoundary=state(f);atChanges=changes(f);
        if(mutation==='DB')f.env.DB={...database,prepare(){foreign++;throw Error('Foreign issuer DB prepare');},batch(){foreign++;throw Error('Foreign issuer DB batch');}};
        if(mutation==='Request')current.request=current.request.clone();
        if(mutation==='abort')f.controller.abort();
      },2);return pending;};return statement;};return wrap(prepareSql.call(this,sql));};
  t.after(()=>{database.prepare=prepareSql;f.env.DB=database;});
  await assert.rejects(issueSponsorSceneGrant(authority,current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  assert.equal(reached,true);assert.equal(foreign,0);assert.deepEqual(state(f),atBoundary);assert.equal(changes(f),atChanges);assert.equal(count(f,'output_provider_calls'),0);
});

for(const fault of ['sparse','inherited','accessor-current','contradictory-error','extra-row'])test(`Scene issuer final proof refuses ${fault} native acknowledgment without a capability`,async t=>{
  const f=await prepared(t),authority=await createSponsorSceneIssuerAuthority(f.current,f.campaignId),batch=f.DB.batch.bind(f.DB);
  let reached=false,getters=0,atBoundary,atChanges;
  f.DB.batch=async statements=>{const results=await batch(statements);if(!reached&&finalProof(statements)){
    assertDenseProof(statements,results);reached=true;atBoundary=state(f);atChanges=changes(f);
    if(fault==='sparse')delete results[0];
    if(fault==='inherited'){const first=results[0];delete results[0];Object.setPrototypeOf(results,Object.assign(Object.create(Array.prototype),{0:first}));}
    if(fault==='accessor-current')Object.defineProperty(results[0].results[0],'current',{get(){getters++;return 1;}});
    if(fault==='contradictory-error')results[0].error='contradictory successful proof';
    if(fault==='extra-row')results[0].results.push({current:1});
  }return results;};
  await assert.rejects(issueSponsorSceneGrant(authority,f.current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  assert.equal(reached,true);assert.equal(getters,0);assert.deepEqual(state(f),atBoundary);assert.equal(changes(f),atChanges);
  assertResourceAccounting(f);assert.equal(count(f,'document_jobs'),0);assert.equal(count(f,'output_provider_calls'),0);
});

for(const mutation of ['authentication header','abort','deadline'])test(`Scene issuer ${mutation} after final proof Promise settlement withholds authority`,async t=>{
  const f=await prepared(t),authority=await createSponsorSceneIssuerAuthority(f.current,f.campaignId),batch=f.DB.batch.bind(f.DB);
  let reached=false,atBoundary,atChanges,clock;
  f.DB.batch=statements=>{const pending=batch(statements);return !reached&&finalProof(statements)?afterSettlement(pending,results=>{
    assertDenseProof(statements,results);reached=true;atBoundary=state(f);atChanges=changes(f);
    if(mutation==='authentication header')f.current.request.headers.set('oai-authenticated-user-id',payer);
    if(mutation==='abort')f.controller.abort();
    if(mutation==='deadline')clock=t.mock.method(Date,'now',()=>f.policy.expiresAtMs+1);
  },3):pending;};
  t.after(()=>{if(clock)clock.mock.restore();});
  await assert.rejects(issueSponsorSceneGrant(authority,f.current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  assert.equal(reached,true);assert.deepEqual(state(f),atBoundary);assert.equal(changes(f),atChanges);assertResourceAccounting(f);
  assert.equal(count(f,'document_jobs'),0);assert.equal(count(f,'output_provider_calls'),0);
});

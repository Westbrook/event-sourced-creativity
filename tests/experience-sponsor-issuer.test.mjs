import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture} from './sponsor-driver-fixture.mjs';
const [{loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {createSponsorIssuerAuthority,issueSponsorGrant,sponsorIssuerIntentKey},{createSponsorAdmissionAuthority},
  {appendAuditEvent}]=await Promise.all([
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-sponsor-issuer.ts'),import('../worker/experience-sponsor-admission.ts'),import('../worker/runtime.ts'),
]);
const originalFetch=globalThis.fetch;let fetchAttempts=0;
globalThis.fetch=()=>{fetchAttempts++;throw Error('Issuer qualification prohibits provider and network calls');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(fetchAttempts,0);});
const tables=['experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_issuances',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','output_execution_grants','output_operation_slots',
  'document_jobs','budget_reservations','cost_budget_reservations'];
const rows=f=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
async function prepared(t,{requestOverrides={},resourceLifetimeMs,...options}={}){
  const f=await fixture(t,{...options,...(resourceLifetimeMs?{approved:false}:{})});
  if(resourceLifetimeMs){
    const now=f.sqlite.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now").get().now;
    f.proposal.policy.resources.expiresAtMs=now+resourceLifetimeMs;
    await f.approve();
  }
  const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:f.planRevisionId,targetIds:[f.targetId]}));
  const terms=preflight.command.preflight;assert.equal(terms.targets.length,1);assert.equal(terms.targets[0].available,true);
  const request=f.request(requestOverrides),trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');
  assert.ok(!(trusted instanceof Response));
  const command={action:'authorize',documentId:f.documentId,expectedRevision:preflight.snapshot.revision,
    clientMutationId:await sponsorIssuerIntentKey({...f.command,...requestOverrides}),preflightId:terms.id,
    termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  return Object.assign(f,{terms,request,trusted,authorizeCommand:command});
}

for(const failure of ['source head changes','personal project becomes governed','retained quote is redacted','payer approval is revoked'])
test(`issuer commit-edge ${failure} rolls back grant, resource debit and immutable issuance together`,async t=>{
  const f=await prepared(t),authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId),before=rows(f);
  const batch=f.DB.batch.bind(f.DB);let fired=false;
  f.DB.batch=async statements=>{
    if(!fired&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_grants'))){
      fired=true;assert.deepEqual(rows(f),before);
      if(failure==='source head changes')await appendAuditEvent(f.env,f.stream,'user','BlockPropertyEdited',{
        document_id:f.documentId,project_id:'project-atmosphere',block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'Changed at issuance commit'});
      if(failure==='personal project becomes governed')f.sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,'active','now','now')")
        .run('issuer-governed-project',f.trusted.scope.projectId,'fixture-organization',f.actor);
      if(failure==='retained quote is redacted')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='now' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.terms.id);
      if(failure==='payer approval is revoked')f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
    }
    return batch(statements);
  };
  await assert.rejects(issueSponsorGrant(authority,f.trusted,f.authorizeCommand));assert.equal(fired,true);
  assert.deepEqual(rows(f),before,'no partial grant, resource receipt, issuer receipt, entitlement or financial reservation');
  assert.equal(count(f,'output_preflights'),1,'the original preflight remains historical evidence');
});

test('actual native preflight issues one immutable grant and exact replay preserves its original timestamps',async t=>{
  const f=await prepared(t,{resourceLifetimeMs:120_000}),authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId);
  const issued=await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);assert.equal(issued.replayed,false);
  assert.ok(issued.policy.resources.expiresAtMs<issued.policy.expiresAtMs);
  assert.ok(issued.policy.resources.expiresAtMs<Date.parse(f.terms.expiresAt));
  assert.equal(issued.envelope.expiresAtMs,issued.policy.resources.expiresAtMs,'shorter resource authorization bounds the exact grant');
  assert.equal(count(f,'experience_sponsor_grants'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'experience_sponsor_issuances'),1);
  assert.equal(count(f,'output_execution_grants'),0);assert.equal(count(f,'document_jobs'),0);
  assert.equal(f.sqlite.prepare('SELECT operation FROM experience_sponsor_resource_receipts').get().operation,'issuance');
  const before=rows(f),again=await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);
  assert.equal(again.replayed,true);assert.equal(again.grantId,issued.grantId);assert.deepEqual(again.envelope,issued.envelope);assert.deepEqual(rows(f),before);
  const freshRequest=f.request.clone();
  const freshTrusted=await loadOutputTrustedContext(freshRequest,f.env,f.documentId,'request');assert.ok(!(freshTrusted instanceof Response));
  const freshAuthority=await createSponsorIssuerAuthority(freshTrusted,f.campaignId),fresh=await issueSponsorGrant(freshAuthority,freshTrusted,f.authorizeCommand);
  assert.equal(fresh.replayed,true);assert.equal(fresh.grantId,issued.grantId);assert.deepEqual(fresh.envelope,issued.envelope);assert.deepEqual(rows(f),before);
});

test('lost committed issuance acknowledgment recovers its exact original without another resource debit',async t=>{
  const f=await prepared(t),authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_grants'))){lost=true;throw Error('lost issuance acknowledgment');}return result;};
  const issued=await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);assert.equal(lost,true);assert.equal(issued.replayed,true);
  assert.equal(count(f,'experience_sponsor_grants'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'experience_sponsor_issuances'),1);
  const before=rows(f),replayed=await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);
  assert.equal(replayed.grantId,issued.grantId);assert.deepEqual(replayed.envelope,issued.envelope);assert.deepEqual(rows(f),before);
});

test('unsealed, copied and cross-request issuer capabilities refuse before issuance writes',async t=>{
  const f=await prepared(t),authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId),before=rows(f);
  for(const forged of [{},{...authority},structuredClone(authority)])await assert.rejects(issueSponsorGrant(forged,f.trusted,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  const variants=[{...f.trusted,request:f.request.clone()},{...f.trusted,env:{...f.env}},
    {...f.trusted,scope:{...f.trusted.scope,documentId:'different-document'}},{...f.trusted,sourceAssertions:[]},
    {...f.trusted,context:{...f.trusted.context,snapshot:{...f.trusted.context.snapshot,title:'Different source'}}}];
  for(const trusted of variants)await assert.rejects(issueSponsorGrant(authority,trusted,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  assert.deepEqual(rows(f),before);
});

for(const field of ['planRevisionId','targetId'])test(`driver ${field} must match the exact native preflight before issuance`,async t=>{
  const f=await prepared(t,{requestOverrides:{[field]:'different-native-selection'}}),before=rows(f);
  await assert.rejects(async()=>{const authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId);await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);});
  assert.deepEqual(rows(f),before);assert.equal(count(f,'output_preflights'),1);
});

test('changed authorize content under the same driver intent cannot replace its issued original',async t=>{
  const f=await prepared(t),authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId);
  await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);const before=rows(f);
  for(const changes of [{maximumMicrousd:f.authorizeCommand.maximumMicrousd+1},{preflightId:'different-preflight'},{expectedRevision:'output:999999'}])
    await assert.rejects(issueSponsorGrant(authority,f.trusted,{...f.authorizeCommand,...changes}),/sponsor_issuer_intent_conflict/);
  assert.deepEqual(rows(f),before);
});

test('exact issuance replay rechecks the current source head before returning another admission capability',async t=>{
  const f=await prepared(t),authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId);
  await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);const before=rows(f);
  await appendAuditEvent(f.env,f.stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',
    block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'A winter orchard after the original issuance'});
  await assert.rejects(issueSponsorGrant(authority,f.trusted,f.authorizeCommand));
  assert.deepEqual(rows(f),before);assert.equal(count(f,'output_execution_grants'),0);
});

test('two distinct native Image quotes retain one approved campaign template and aggregate resource identity',async t=>{
  const f=await prepared(t),firstAuthority=await createSponsorIssuerAuthority(f.trusted,f.campaignId);
  const first=await issueSponsorGrant(firstAuthority,f.trusted,f.authorizeCommand);
  await appendAuditEvent(f.env,f.stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',
    block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'A snowy evergreen forest beside a frozen river'});
  const confirmed=await f.ok(await f.send({action:'confirm'}));
  const secondDriver={...f.command,intentKey:'second-original-image',planRevisionId:confirmed.command.planRevisionId,
    targetId:confirmed.snapshot.confirmedPlan.plan.targets[0].id};
  const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:secondDriver.planRevisionId,targetIds:[secondDriver.targetId]}));
  const terms=preflight.command.preflight;assert.equal(terms.targets.length,1);assert.equal(terms.targets[0].available,true);
  const request=new Request(f.request.url,{method:'POST',headers:f.request.headers,body:JSON.stringify(secondDriver)});
  const trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const command={action:'authorize',documentId:f.documentId,expectedRevision:preflight.snapshot.revision,
    clientMutationId:await sponsorIssuerIntentKey(secondDriver),preflightId:terms.id,termsDigest:terms.termsDigest,
    maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const authority=await createSponsorIssuerAuthority(trusted,f.campaignId),second=await issueSponsorGrant(authority,trusted,command);
  assert.notEqual(second.grantId,first.grantId);assert.notEqual(second.envelope.intentKey,first.envelope.intentKey);
  assert.notEqual(terms.id,f.terms.id);assert.notEqual(secondDriver.planRevisionId,f.planRevisionId);
  assert.notEqual(second.envelope.sourceDigest,first.envelope.sourceDigest);assert.notEqual(second.envelope.compiledInputDigest,first.envelope.compiledInputDigest);
  assert.equal(second.envelope.templateDigest,first.envelope.templateDigest);assert.deepEqual(second.policy,first.policy);
  assert.equal(second.envelope.payerUserId,f.payer);assert.equal(first.envelope.payerUserId,f.payer);
  assert.equal(second.envelope.actorUserId,f.actor);assert.equal(second.envelope.sessionDigest,first.envelope.sessionDigest);
  assert.equal(count(f,'experience_sponsor_campaigns'),1);assert.equal(count(f,'experience_sponsor_approvals'),1);
  assert.equal(count(f,'output_preflights'),2);assert.equal(count(f,'experience_sponsor_grants'),2);assert.equal(count(f,'experience_sponsor_issuances'),2);
  const aggregates=f.sqlite.prepare(`SELECT campaign_id,actor_user_id,session_digest,policy_digest,limits_digest,
    COUNT(*) AS operations,SUM(text_bytes) AS bytes FROM experience_sponsor_resource_receipts
    GROUP BY campaign_id,actor_user_id,session_digest,policy_digest,limits_digest`).all();
  assert.equal(aggregates.length,1);assert.equal(aggregates[0].campaign_id,f.campaignId);assert.equal(aggregates[0].actor_user_id,f.actor);
  assert.equal(aggregates[0].operations,2);assert.ok(aggregates[0].bytes>0);
  assert.equal(count(f,'output_execution_grants'),0);assert.equal(count(f,'document_jobs'),0);
  assert.equal(count(f,'budget_reservations'),0);assert.equal(count(f,'cost_budget_reservations'),0);
});

test('v2 approval revocation at the native admission commit retains issuance but rolls back all admission and financial rows',async t=>{
  const f=await prepared(t),authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId),issued=await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);
  const tracked=[...tables,'events','event_private_payloads','output_commands','budget_counters','cost_budget_counters'];
  const state=()=>Object.fromEntries(tracked.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  const before=state(),batch=f.DB.batch.bind(f.DB);let fired=false;
  f.DB.batch=async statements=>{
    if(!fired&&statements.some(statement=>statement.sql.includes('INSERT INTO output_execution_grants'))){
      fired=true;assert.deepEqual(state(),before,'admission preparation creates no grants, events, jobs or holds');
      f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
      assert.ok(f.sqlite.prepare('SELECT revoked_at_ms FROM experience_sponsor_approvals WHERE campaign_id=?').get(f.campaignId).revoked_at_ms>0);
      assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_campaigns WHERE campaign_id=?').get(f.campaignId).enabled,1,'the v2 approval proof acts independently of the campaign switch');
    }
    return batch(statements);
  };
  await assert.rejects(outputExperienceCommands.executeSponsored(f.trusted,f.authorizeCommand,issued.admissionAuthority,outputDocumentExecutionBridge,f.context));
  assert.equal(fired,true);assert.deepEqual(state(),before);
  assert.equal(count(f,'experience_sponsor_grants'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'experience_sponsor_issuances'),1);
  assert.equal(count(f,'experience_sponsor_consumptions'),0);assert.equal(count(f,'experience_sponsor_active_jobs'),0);
});

for(const failure of ['missing receipt','wrong envelope receipt'])test(`v2 native admission refuses ${failure} before financial writes`,async t=>{
  const f=await prepared(t),authority=await createSponsorIssuerAuthority(f.trusted,f.campaignId),issued=await issueSponsorGrant(authority,f.trusted,f.authorizeCommand);
  // Deliberately corrupt only disposable fixture storage, bypassing the tested
  // immutable receipt triggers, to qualify the independent admission proof.
  f.sqlite.exec('DROP TRIGGER experience_sponsor_resource_no_delete; DROP TRIGGER experience_sponsor_resource_no_update');
  if(failure==='missing receipt')f.sqlite.exec("DELETE FROM experience_sponsor_resource_receipts WHERE operation='issuance'");
  else f.sqlite.prepare("UPDATE experience_sponsor_resource_receipts SET payload_digest=? WHERE operation='issuance'").run(`sha256:${'b'.repeat(64)}`);
  const before=rows(f);
  await assert.rejects(createSponsorAdmissionAuthority({trusted:f.trusted,command:f.authorizeCommand,policy:issued.policy,envelope:issued.envelope,grantId:issued.grantId}));
  await assert.rejects(outputExperienceCommands.executeSponsored(f.trusted,f.authorizeCommand,issued.admissionAuthority,outputDocumentExecutionBridge,f.context));
  assert.deepEqual(rows(f),before);assert.equal(count(f,'output_execution_grants'),0);
});

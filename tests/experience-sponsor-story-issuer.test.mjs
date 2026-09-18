import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,actor,payer,stream} from './sponsor-story-driver-fixture.mjs';
const [{loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {createSponsorStoryIssuerAuthority,issueSponsorStoryGrant,sponsorStoryIssuerIntentKey,readSponsorStoryDriverCommand},
  {appendAuditEvent},{canonicalJson}]=await Promise.all([
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-sponsor-story-issuer.ts'),import('../worker/runtime.ts'),import('../src/experiences/compiler.ts'),
]);
const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Story issuer qualification prohibits provider/network calls');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedEgress,0);});
const tables=['experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_issuances',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','output_execution_grants','output_operation_slots',
  'document_jobs','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters','output_provider_calls'];
const rows=f=>Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
async function trusted(f,overrides={}){
  const request=f.request(overrides),current=await loadOutputTrustedContext(request,f.env,f.documentId,'request');
  assert.ok(!(current instanceof Response));return current;
}
async function prepared(t,{driverOverrides={},...options}={}){
  const f=await fixture(t,options);
  const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:f.planRevisionId,targetIds:[f.targetId]}));
  const terms=preflight.command.preflight;assert.equal(terms.targets.length,1);assert.equal(terms.targets[0].available,true);
  const current=await trusted(f,driverOverrides),command={action:'authorize',documentId:f.documentId,expectedRevision:preflight.snapshot.revision,
    clientMutationId:await sponsorStoryIssuerIntentKey({...f.command,...driverOverrides}),preflightId:terms.id,
    termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  return Object.assign(f,{trusted:current,authorizeCommand:command,terms});
}
async function issue(f,current=f.trusted,command=f.authorizeCommand){
  const authority=await createSponsorStoryIssuerAuthority(current,f.campaignId);
  return issueSponsorStoryGrant(authority,current,command);
}
async function admit(f){
  const issued=await issue(f);assert.ok(issued.admissionAuthority);assert.equal('nativeReceipt' in issued,false);
  const accepted=await outputExperienceCommands.executeSponsored(f.trusted,f.authorizeCommand,issued.admissionAuthority,outputDocumentExecutionBridge,f.context);
  assert.ok(!(accepted instanceof Response));return {issued,accepted};
}

test('closed Story command keeps original intent identity while refusing Image, payer, prompt and price fields',async()=>{
  const command={action:'run-sponsored-short-story',campaignId:'campaign',documentId:'document',planRevisionId:'plan',targetId:'target',intentKey:'intent'};
  assert.deepEqual(readSponsorStoryDriverCommand(command),command);assert.ok(Object.isFrozen(readSponsorStoryDriverCommand(command)));
  const key=await sponsorStoryIssuerIntentKey(command);
  assert.match(key,/^sponsor-story-authorize-[a-f0-9]{64}$/u);
  assert.equal(await sponsorStoryIssuerIntentKey({...command,targetId:'changed'}),key);
  for(const patch of [{action:'run-sponsored-image'},{payerUserId:'other'},{prompt:'bypass context'},{maximumMicrousd:1},{intentKey:'x'.repeat(81)}])
    assert.throws(()=>readSponsorStoryDriverCommand({...command,...patch}),/sponsor_driver_command_invalid/);
});

test('actual V4 issuance is exact, atomic, source-pinned, resource-metered and replayable without a native admission or provider call',async t=>{
  const f=await prepared(t),authority=await createSponsorStoryIssuerAuthority(f.trusted,f.campaignId);
  const issued=await issueSponsorStoryGrant(authority,f.trusted,f.authorizeCommand);assert.equal(issued.replayed,false);assert.ok(issued.admissionAuthority);
  assert.equal(issued.envelope.version,4);assert.equal(issued.envelope.family,'canonical-short-story@1');assert.equal(issued.envelope.recipe.outputKind,'short_story');
  assert.deepEqual(issued.envelope.recipe.calls,{parsing:0,planning:1,render:0,repair:0});assert.equal(issued.envelope.payerUserId,payer);assert.equal(issued.envelope.ownerUserId,actor);
  assert.equal(issued.envelope.recipe.maximumMicrousd,f.terms.maximumMicrousd);assert.ok(issued.envelope.expiresAtMs<=Date.parse(f.terms.expiresAt));
  assert.equal(count(f,'experience_sponsor_grants'),1);assert.equal(count(f,'experience_sponsor_issuances'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
  assert.equal(f.sqlite.prepare('SELECT operation FROM experience_sponsor_resource_receipts').get().operation,'issuance');
  for(const table of ['experience_sponsor_consumptions','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(count(f,table),0);
  const before=rows(f),replay=await issueSponsorStoryGrant(authority,f.trusted,f.authorizeCommand);
  assert.equal(replay.replayed,true);assert.equal(replay.grantId,issued.grantId);assert.deepEqual(replay.envelope,issued.envelope);assert.deepEqual(rows(f),before);
});

for(const failure of ['source head','source custody','quote redaction','payer approval'])test(`Story issuance commit-edge ${failure} change rolls back new issuer and resource rows`,async t=>{
  const f=await prepared(t),authority=await createSponsorStoryIssuerAuthority(f.trusted,f.campaignId),before=rows(f),batch=f.DB.batch.bind(f.DB);let fired=false;
  f.DB.batch=async statements=>{
    if(!fired&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_grants'))){
      fired=true;
      if(failure==='source head')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'A changed decision before issuance.'});
      if(failure==='source custody')f.sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?, ?,'active','now','now')").run('issuer-story-governed',f.trusted.scope.projectId,'fixture-organization',actor);
      if(failure==='quote redaction')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.terms.id);
      if(failure==='payer approval')f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
    }
    return batch(statements);
  };
  await assert.rejects(issueSponsorStoryGrant(authority,f.trusted,f.authorizeCommand),/CHECK constraint failed|sponsor_/);assert.equal(fired,true);assert.deepEqual(rows(f),before);
});

test('issuer captures Request, DB, source and principal and cannot be reconstructed or rebound',async t=>{
  const f=await prepared(t),authority=await createSponsorStoryIssuerAuthority(f.trusted,f.campaignId),before=rows(f);
  for(const seal of [{},structuredClone(authority),{...authority}])await assert.rejects(issueSponsorStoryGrant(seal,f.trusted,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  for(const current of [{...f.trusted,request:f.trusted.request.clone()},{...f.trusted,env:{...f.env}},
    {...f.trusted,principal:{...f.trusted.principal,userId:payer}},
    {...f.trusted,context:{...f.trusted.context,snapshot:{...f.trusted.context.snapshot,title:'changed'}}},
    {...f.trusted,sourcePrivateCaptured:false}])await assert.rejects(issueSponsorStoryGrant(authority,current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  const db=f.env.DB;f.env.DB={...db};await assert.rejects(issueSponsorStoryGrant(authority,f.trusted,f.authorizeCommand),/sponsor_issuer_authority_changed/);f.env.DB=db;
  assert.deepEqual(rows(f),before);
});

for(const field of ['planRevisionId','targetId'])test(`issuer refuses a Story driver ${field} outside the actual retained native quote`,async t=>{
  const f=await prepared(t,{driverOverrides:{[field]:'different-selection'}}),before=rows(f);
  await assert.rejects(issue(f),/sponsor_issuer_intent_mismatch/);assert.deepEqual(rows(f),before);
});

test('same Story intent cannot replace its issued authorization body or native source',async t=>{
  const f=await prepared(t);await issue(f);const before=rows(f);
  for(const changes of [{maximumMicrousd:f.authorizeCommand.maximumMicrousd+1},{preflightId:'other'},{expectedRevision:'output:999999'}])
    await assert.rejects(issue(f,f.trusted,{...f.authorizeCommand,...changes}),/sponsor_issuer_intent_conflict/);
  await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'Mira makes a different decision.'});
  await assert.rejects(issue(f,await trusted(f)));assert.deepEqual(rows(f),before);
});

test('lost issuance acknowledgment resolves its committed original rather than creating another grant or resetting timestamps',async t=>{
  const f=await prepared(t),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_issuances'))){lost=true;throw Error('lost issuance acknowledgment');}return result;};
  const issued=await issue(f);assert.equal(lost,true);assert.equal(issued.replayed,true);assert.equal(count(f,'experience_sponsor_grants'),1);
  const before=rows(f);assert.equal((await issue(f)).grantId,issued.grantId);assert.deepEqual(rows(f),before);
});

test('committed native authorize receipt reopens after head advance without fabricating a fresh admission capability, under strict SQL limits',async t=>{
  const f=await prepared(t,{strict:true}),{issued,accepted}=await admit(f),before=rows(f),current=await trusted(f);
  assert.notEqual(f.authorizeCommand.expectedRevision,`output:${current.ownerHead}`);
  const replay=await issue(f,current);assert.equal(replay.replayed,true);assert.equal(replay.grantId,issued.grantId);assert.equal('admissionAuthority' in replay,false);
  assert.equal(replay.nativeReceipt.eventId,accepted.receipt.eventId);assert.equal(replay.nativeReceipt.payload.grant_id,accepted.receipt.payload.grant_id);
  assert.equal(canonicalJson(replay.nativeReceipt.payload),canonicalJson(accepted.receipt.payload));assert.deepEqual(rows(f),before);
  f.limits.assertVerified();t.diagnostic(JSON.stringify({strictSqlStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),networkCalls:0}));
});

for(const changed of ['command','slot','consumption'])test(`exact admitted Story receipt refuses mutated ${changed} lineage without new purchase`,async t=>{
  const f=await prepared(t);await admit(f);
  if(changed==='command')f.sqlite.prepare("UPDATE output_commands SET request_digest=? WHERE action='authorize'").run('f'.repeat(64));
  if(changed==='slot')f.sqlite.prepare('UPDATE output_operation_slots SET route_digest=?').run('f'.repeat(64));
  if(changed==='consumption'){
    f.sqlite.exec('DROP TRIGGER experience_sponsor_consumptions_no_update');
    f.sqlite.prepare('UPDATE experience_sponsor_consumptions SET envelope_digest=?').run(`sha256:${'f'.repeat(64)}`);
  }
  const before=rows(f);await assert.rejects(issue(f,await trusted(f)));assert.deepEqual(rows(f),before);
  assert.equal(count(f,'document_jobs'),1);assert.equal(count(f,'output_provider_calls'),0);
});

test('two genuine Story source quotes retain one template and aggregate campaign resource identity',async t=>{
  const f=await prepared(t),first=await issue(f);
  await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'Mira returns a compass before the ferry leaves.'});
  const confirmed=await f.ok(await f.send({action:'confirm'}));
  const next={...f.command,intentKey:'second-story',planRevisionId:confirmed.command.planRevisionId,targetId:confirmed.snapshot.confirmedPlan.plan.targets[0].id};
  const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:next.planRevisionId,targetIds:[next.targetId]})),terms=preflight.command.preflight;
  const current=await trusted(f,next),command={action:'authorize',documentId:f.documentId,expectedRevision:preflight.snapshot.revision,clientMutationId:await sponsorStoryIssuerIntentKey(next),
    preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const second=await issue(f,current,command);assert.notEqual(first.grantId,second.grantId);assert.notEqual(first.envelope.compiledInputDigest,second.envelope.compiledInputDigest);
  assert.equal(first.envelope.templateDigest,second.envelope.templateDigest);assert.equal(count(f,'experience_sponsor_campaigns'),1);assert.equal(count(f,'experience_sponsor_grants'),2);
  const totals=f.sqlite.prepare('SELECT campaign_id,actor_user_id,COUNT(*) AS n,SUM(text_bytes) AS bytes FROM experience_sponsor_resource_receipts GROUP BY campaign_id,actor_user_id').all();
  assert.equal(totals.length,1);assert.equal(totals[0].n,2);assert.ok(totals[0].bytes>0);assert.equal(count(f,'document_jobs'),0);
});

for(const phase of ['intent hash','original receipt'])for(const mutation of ['DB','Request','source','abort'])
test(`standalone issuer ${mutation} change during ${phase} await cannot reach subsequent assertion writes`,async t=>{
  const f=await prepared(t);
  if(phase==='original receipt')await admit(f);
  const current=phase==='original receipt'?await trusted(f):f.trusted;
  const abort=new AbortController();current.request=new Request(current.request,{signal:abort.signal});
  const authority=await createSponsorStoryIssuerAuthority(current,f.campaignId),db=f.env.DB,before=rows(f);
  let fired=false,foreignAccesses=0,changesAtMutation;
  const mutate=()=>{
    if(fired)return;fired=true;changesAtMutation=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
    if(mutation==='DB')f.env.DB={...db,prepare(){foreignAccesses++;throw Error('Foreign database prepare prohibited');},batch(){foreignAccesses++;throw Error('Foreign database batch prohibited');}};
    if(mutation==='Request')current.request=current.request.clone();
    if(mutation==='source')current.context={...current.context,snapshot:{...current.context.snapshot,title:'Changed during issuer await'}};
    if(mutation==='abort')abort.abort();
  };
  if(phase==='intent hash'){
    const originalDigest=crypto.subtle.digest.bind(crypto.subtle);
    t.mock.method(crypto.subtle,'digest',async(algorithm,data)=>{const value=await originalDigest(algorithm,data);if(!fired&&new TextDecoder().decode(data).includes('canonical-short-story@1'))mutate();return value;});
  }else{
    const prepare=db.prepare.bind(db);
    db.prepare=sql=>{
      const statement=prepare(sql);if(!sql.startsWith('SELECT command.action,command.event_id'))return statement;
      const wrap=item=>{
        const bind=item.bind.bind(item),first=item.first.bind(item);
        item.bind=(...values)=>wrap(bind(...values));
        item.first=async(...values)=>{const row=await first(...values);if(row&&!fired)mutate();return row;};
        return item;
      };
      return wrap(statement);
    };
  }
  await assert.rejects(issueSponsorStoryGrant(authority,current,f.authorizeCommand));assert.equal(fired,true);
  assert.equal(foreignAccesses,0,'The original issuer guard must refuse before preparing or batching anything on a substituted DB');
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,changesAtMutation,'Even temporary assertion INSERT/DELETE rows must not follow changed captured authority');
  assert.deepEqual(rows(f),before);assert.equal(count(f,'output_provider_calls'),0);f.env.DB=db;
});

import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,actor,payer,stream} from './sponsor-slides-driver-fixture.mjs';
const [{loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {createSponsorSlidesIssuerAuthority,issueSponsorSlidesGrant,sponsorSlidesIssuerIntentKey,readSponsorSlidesDriverCommand},
  {appendAuditEvent},{canonicalJson}]=await Promise.all([
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-sponsor-slides-issuer.ts'),import('../worker/runtime.ts'),import('../src/experiences/compiler.ts'),
]);
const originalFetch=globalThis.fetch;let unexpectedEgress=0;
globalThis.fetch=()=>{unexpectedEgress++;throw Error('Slides issuer qualification prohibits provider/network calls');};
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
    clientMutationId:await sponsorSlidesIssuerIntentKey({...f.command,...driverOverrides}),preflightId:terms.id,
    termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  return Object.assign(f,{trusted:current,authorizeCommand:command,terms});
}
async function issue(f,current=f.trusted,command=f.authorizeCommand){
  const authority=await createSponsorSlidesIssuerAuthority(current,f.campaignId);
  return issueSponsorSlidesGrant(authority,current,command);
}
async function admit(f){
  const issued=await issue(f);assert.ok(issued.admissionAuthority);assert.equal('nativeReceipt' in issued,false);
  const accepted=await outputExperienceCommands.executeSponsored(f.trusted,f.authorizeCommand,issued.admissionAuthority,outputDocumentExecutionBridge,f.context);
  assert.ok(!(accepted instanceof Response));return {issued,accepted};
}

test('closed Slides command keeps original intent identity while refusing Image, payer, prompt and price fields',async()=>{
  const command={action:'run-sponsored-slides',campaignId:'campaign',documentId:'document',planRevisionId:'plan',targetId:'target',intentKey:'intent'};
  assert.deepEqual(readSponsorSlidesDriverCommand(command),command);assert.ok(Object.isFrozen(readSponsorSlidesDriverCommand(command)));
  const key=await sponsorSlidesIssuerIntentKey(command);
  assert.match(key,/^sponsor-slides-authorize-[a-f0-9]{64}$/u);
  assert.equal(await sponsorSlidesIssuerIntentKey({...command,targetId:'changed'}),key);
  for(const patch of [{action:'run-sponsored-image'},{payerUserId:'other'},{prompt:'bypass context'},{maximumMicrousd:1},{intentKey:'x'.repeat(81)}])
    assert.throws(()=>readSponsorSlidesDriverCommand({...command,...patch}),/sponsor_driver_command_invalid/);
});

test('actual V5 issuance is exact, atomic, source-pinned, resource-metered and replayable without a native admission or provider call',async t=>{
  const f=await prepared(t),authority=await createSponsorSlidesIssuerAuthority(f.trusted,f.campaignId);
  const issued=await issueSponsorSlidesGrant(authority,f.trusted,f.authorizeCommand);assert.equal(issued.replayed,false);assert.ok(issued.admissionAuthority);
  assert.equal(issued.envelope.version,5);assert.equal(issued.envelope.family,'canonical-five-slide-deck@1');assert.equal(issued.envelope.recipe.outputKind,'slides');
  assert.deepEqual(issued.envelope.recipe.calls,{parsing:0,planning:1,render:0,repair:1});assert.equal(issued.envelope.payerUserId,payer);assert.equal(issued.envelope.ownerUserId,actor);
  assert.equal(issued.envelope.recipe.maximumMicrousd,f.terms.maximumMicrousd);assert.ok(issued.envelope.expiresAtMs<=Date.parse(f.terms.expiresAt));
  assert.equal(count(f,'experience_sponsor_grants'),1);assert.equal(count(f,'experience_sponsor_issuances'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
  assert.equal(f.sqlite.prepare('SELECT operation FROM experience_sponsor_resource_receipts').get().operation,'issuance');
  for(const table of ['experience_sponsor_consumptions','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(count(f,table),0);
  const before=rows(f),replay=await issueSponsorSlidesGrant(authority,f.trusted,f.authorizeCommand);
  assert.equal(replay.replayed,true);assert.equal(replay.grantId,issued.grantId);assert.deepEqual(replay.envelope,issued.envelope);assert.deepEqual(rows(f),before);
});

for(const failure of ['source head','source custody','quote redaction','payer approval'])test(`Slides issuance commit-edge ${failure} change rolls back new issuer and resource rows`,async t=>{
  const f=await prepared(t),authority=await createSponsorSlidesIssuerAuthority(f.trusted,f.campaignId),before=rows(f),batch=f.DB.batch.bind(f.DB);let fired=false;
  f.DB.batch=async statements=>{
    if(!fired&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_grants'))){
      fired=true;
      if(failure==='source head')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'A changed decision before issuance.'});
      if(failure==='source custody')f.sqlite.prepare("INSERT INTO organization_projects(project_access_id,project_id,organization_id,owner_user_id,status,created_at,updated_at) VALUES(?,?,?, ?,'active','now','now')").run('issuer-slides-governed',f.trusted.scope.projectId,'fixture-organization',actor);
      if(failure==='quote redaction')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=(SELECT event_id FROM output_preflights WHERE preflight_id=?)").run(f.terms.id);
      if(failure==='payer approval')f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
    }
    return batch(statements);
  };
  await assert.rejects(issueSponsorSlidesGrant(authority,f.trusted,f.authorizeCommand),/CHECK constraint failed|sponsor_/);assert.equal(fired,true);assert.deepEqual(rows(f),before);
});

test('issuer captures Request, DB, source and principal and cannot be reconstructed or rebound',async t=>{
  const f=await prepared(t),authority=await createSponsorSlidesIssuerAuthority(f.trusted,f.campaignId),before=rows(f);
  for(const seal of [{},structuredClone(authority),{...authority}])await assert.rejects(issueSponsorSlidesGrant(seal,f.trusted,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  for(const current of [{...f.trusted,request:f.trusted.request.clone()},{...f.trusted,env:{...f.env}},
    {...f.trusted,principal:{...f.trusted.principal,userId:payer}},
    {...f.trusted,context:{...f.trusted.context,snapshot:{...f.trusted.context.snapshot,title:'changed'}}},
    {...f.trusted,sourcePrivateCaptured:false}])await assert.rejects(issueSponsorSlidesGrant(authority,current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  const db=f.env.DB;f.env.DB={...db};await assert.rejects(issueSponsorSlidesGrant(authority,f.trusted,f.authorizeCommand),/sponsor_issuer_authority_changed/);f.env.DB=db;
  assert.deepEqual(rows(f),before);
});

for(const field of ['planRevisionId','targetId'])test(`issuer refuses a Slides driver ${field} outside the actual retained native quote`,async t=>{
  const f=await prepared(t,{driverOverrides:{[field]:'different-selection'}}),before=rows(f);
  await assert.rejects(issue(f),/sponsor_issuer_intent_mismatch/);assert.deepEqual(rows(f),before);
});

test('same Slides intent cannot replace its issued authorization body or native source',async t=>{
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

for(const changed of ['command','slot','consumption'])test(`exact admitted Slides receipt refuses mutated ${changed} lineage without new purchase`,async t=>{
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

test('two genuine Slides source quotes retain one template and aggregate campaign resource identity',async t=>{
  const f=await prepared(t),first=await issue(f);
  await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',block_id:f.sourceBlockId,property_path:'text',old_value:f.sourceText,new_value:'Mira returns a compass before the ferry leaves.'});
  const confirmed=await f.ok(await f.send({action:'confirm'}));
  const next={...f.command,intentKey:'second-slides',planRevisionId:confirmed.command.planRevisionId,targetId:confirmed.snapshot.confirmedPlan.plan.targets[0].id};
  const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:next.planRevisionId,targetIds:[next.targetId]})),terms=preflight.command.preflight;
  const current=await trusted(f,next),command={action:'authorize',documentId:f.documentId,expectedRevision:preflight.snapshot.revision,clientMutationId:await sponsorSlidesIssuerIntentKey(next),
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
  const authority=await createSponsorSlidesIssuerAuthority(current,f.campaignId),db=f.env.DB,before=rows(f);
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
    t.mock.method(crypto.subtle,'digest',async(algorithm,data)=>{const value=await originalDigest(algorithm,data);if(!fired&&new TextDecoder().decode(data).includes('canonical-five-slide-deck@1'))mutate();return value;});
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
  await assert.rejects(issueSponsorSlidesGrant(authority,current,f.authorizeCommand));assert.equal(fired,true);
  assert.equal(foreignAccesses,0,'The original issuer guard must refuse before preparing or batching anything on a substituted DB');
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,changesAtMutation,'Even temporary assertion INSERT/DELETE rows must not follow changed captured authority');
  assert.deepEqual(rows(f),before);assert.equal(count(f,'output_provider_calls'),0);f.env.DB=db;
});

const afterSettlement=(promise,mutate,hops=1)=>new Promise((resolve,reject)=>{
  promise.then(value=>{resolve(value);let queued=()=>mutate(value);for(let index=1;index<hops;index++){const next=queued;queued=()=>queueMicrotask(next);}queueMicrotask(queued);},reject);
});
const routeChanges={OPENAI_MODEL:'gpt-5.6-sol',OPENAI_SLIDES_COMPOSITION_MODEL:'gpt-5.6-sol',OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:'medium',
  OPENAI_SLIDES_REPAIR_MODEL:'gpt-5.6-terra',OPENAI_SLIDES_REPAIR_REASONING_EFFORT:'high',OPENAI_API_KEY:'',FORMA_PILOT_COHORT_ID:'different-pilot'};
for(const field of Object.keys(routeChanges))test(`Slides standalone issuer captures ${field} across intent-hash Promise settlement`,async t=>{
  const f=await prepared(t),before=rows(f),authority=await createSponsorSlidesIssuerAuthority(f.trusted,f.campaignId),original=crypto.subtle.digest.bind(crypto.subtle);
  let reached=false,atMutation;
  t.mock.method(crypto.subtle,'digest',(algorithm,data)=>{
    const pending=original(algorithm,data);let json;try{json=JSON.parse(new TextDecoder().decode(data));}catch{return pending;}
    if(!reached&&json.family==='canonical-five-slide-deck@1'&&Object.keys(json).sort().join(',')==='campaignId,family,intentKey')return afterSettlement(pending,()=>{
      reached=true;atMutation=f.sqlite.prepare('SELECT total_changes() AS n').get().n;f.env[field]=routeChanges[field];
    },3);return pending;
  });
  await assert.rejects(issueSponsorSlidesGrant(authority,f.trusted,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  assert.equal(reached,true);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,atMutation);assert.deepEqual(rows(f),before);assert.equal(count(f,'output_provider_calls'),0);
});

for(const phase of ['intent hash','original receipt'])for(const mutation of ['DB','Request','source','abort'])
test(`Slides issuer ${mutation} after ${phase} Promise settlement cannot reach another protected write`,async t=>{
  const f=await prepared(t);if(phase==='original receipt')await admit(f);
  const current=phase==='original receipt'?await trusted(f):f.trusted,controller=new AbortController();current.request=new Request(current.request,{signal:controller.signal});
  const authority=await createSponsorSlidesIssuerAuthority(current,f.campaignId),db=f.env.DB,before=rows(f);let reached=false,foreign=0,atMutation;
  const mutate=()=>{if(reached)return;reached=true;atMutation=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
    if(mutation==='DB')f.env.DB={...db,prepare(){foreign++;throw Error('Foreign DB prepare');},batch(){foreign++;throw Error('Foreign DB batch');}};
    if(mutation==='Request')current.request=current.request.clone();
    if(mutation==='source')current.context={...current.context,snapshot:{...current.context.snapshot,title:'Changed after settlement'}};
    if(mutation==='abort')controller.abort();
  };
  if(phase==='intent hash'){
    const original=crypto.subtle.digest.bind(crypto.subtle);
    t.mock.method(crypto.subtle,'digest',(algorithm,data)=>{const pending=original(algorithm,data);let json;try{json=JSON.parse(new TextDecoder().decode(data));}catch{return pending;}
      return !reached&&json.family==='canonical-five-slide-deck@1'&&Object.keys(json).sort().join(',')==='campaignId,family,intentKey'?afterSettlement(pending,mutate,3):pending;});
  }else{
    const prepare=db.prepare.bind(db);db.prepare=sql=>{
      const statement=prepare(sql);if(!sql.startsWith('SELECT command.action,command.event_id'))return statement;
      const wrap=item=>{const bind=item.bind.bind(item),first=item.first.bind(item);item.bind=(...values)=>wrap(bind(...values));
        item.first=(...values)=>afterSettlement(first(...values),mutate,2);return item;};return wrap(statement);
    };
  }
  t.after(()=>{f.env.DB=db;});
  await assert.rejects(issueSponsorSlidesGrant(authority,current,f.authorizeCommand),/sponsor_issuer_authority_changed/);assert.equal(reached,true);assert.equal(foreign,0);
  assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,atMutation);assert.deepEqual(rows(f),before);
});

const isFinalIssuerProof=statements=>statements.every(statement=>statement.sql.startsWith('SELECT CASE WHEN'))
  &&statements.some(statement=>statement.sql.includes('EXISTS(SELECT 1 FROM experience_sponsor_grants WHERE grant_id=? AND campaign_id=? AND policy_digest=?'));

function assertActualFinalProof(statements,results){
  assert.ok(statements.length>1);assert.equal(results.length,statements.length);
  for(let index=0;index<results.length;index++){
    assert.ok(Object.hasOwn(results,index));assert.equal(results[index].success,true);assert.equal(results[index].results.length,1);
    assert.ok(Object.hasOwn(results[index].results,0));assert.equal(results[index].results[0].current,1);
  }
}

test('Slides issuer diagnosis: late mutable authentication header after real final proof refuses the new capability',async t=>{
  const f=await prepared(t),authority=await createSponsorSlidesIssuerAuthority(f.trusted,f.campaignId),batch=f.DB.batch.bind(f.DB);
  let reached=false,atBoundary,changesAtBoundary;
  f.DB.batch=async statements=>{
    const results=await batch(statements);
    if(!reached&&isFinalIssuerProof(statements)){
      assertActualFinalProof(statements,results);reached=true;atBoundary=rows(f);changesAtBoundary=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
      f.trusted.request.headers.set('oai-authenticated-user-id',payer);
    }return results;
  };
  await assert.rejects(issueSponsorSlidesGrant(authority,f.trusted,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  assert.equal(reached,true);assert.deepEqual(rows(f),atBoundary);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,changesAtBoundary);
  assert.equal(count(f,'document_jobs'),0);assert.equal(count(f,'output_provider_calls'),0);
});

for(const admitted of [false,true])test(`Slides issuer diagnosis: disabled live resource policy refuses ${admitted?'admitted':'issued'} original replay without redebit`,async t=>{
  const f=await prepared(t);if(admitted)await admit(f);else await issue(f);
  f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  const current=admitted?await trusted(f):f.trusted,before=rows(f);
  await assert.rejects(issue(f,current),/sponsor_/);assert.deepEqual(rows(f),before);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
  assert.equal(count(f,'document_jobs'),admitted?1:0);assert.equal(count(f,'output_provider_calls'),0);
});

test('Slides issuer diagnosis: nested approval read cannot prepare on a replaced caller database',async t=>{
  const f=await prepared(t),db=f.env.DB,prepare=db.prepare.bind(db),before=rows(f);let reached=false,foreign=0,atMutation;
  db.prepare=sql=>{
    const statement=prepare(sql);if(sql!=='SELECT policy_json,policy_digest FROM experience_sponsor_campaigns WHERE campaign_id=? AND enabled=1')return statement;
    const wrap=item=>{const bind=item.bind.bind(item),first=item.first.bind(item);item.bind=(...args)=>wrap(bind(...args));
      item.first=async(...args)=>{const row=await first(...args);assert.ok(row);if(!reached){reached=true;atMutation=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
        f.env.DB={...db,prepare(){foreign++;throw Error('Foreign nested approval prepare');},batch(){foreign++;throw Error('Foreign nested approval batch');}};
      }return row;};return item;};return wrap(statement);
  };
  t.after(()=>{f.env.DB=db;});
  let failure;try{await createSponsorSlidesIssuerAuthority(f.trusted,f.campaignId);}catch(error){failure=error;}
  t.diagnostic(JSON.stringify({nestedApprovalReadReached:reached,foreignDatabasePreparations:foreign}));
  assert.equal(reached,true);assert.equal(foreign,0);assert.match(String(failure),/sponsor_issuer_authority_changed/);assert.deepEqual(rows(f),before);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,atMutation);
});


test('Slides issuer diagnosis: native preflight index expiration rolls back all issuance rows at commit edge',async t=>{
  const f=await prepared(t),authority=await createSponsorSlidesIssuerAuthority(f.trusted,f.campaignId),before=rows(f),batch=f.DB.batch.bind(f.DB);let reached=false;
  f.DB.batch=async statements=>{
    if(!reached&&statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_grants'))){
      reached=true;assert.ok(f.sqlite.prepare('SELECT expires_at FROM output_preflights WHERE preflight_id=?').get(f.terms.id));
      f.sqlite.prepare('UPDATE output_preflights SET expires_at=? WHERE preflight_id=?').run('2020-01-01T00:00:00.000Z',f.terms.id);
    }return batch(statements);
  };
  await assert.rejects(issueSponsorSlidesGrant(authority,f.trusted,f.authorizeCommand),/sponsor_|CHECK constraint failed/);
  assert.equal(reached,true);assert.deepEqual(rows(f),before);assert.equal(count(f,'experience_sponsor_issuances'),0);assert.equal(count(f,'output_provider_calls'),0);
});

for(const admitted of [false,true])for(const fault of ['sparse-proof','inherited-proof','failed-proof','string-current','current-accessor','extra-proof-row'])
test(`Slides issuer ${admitted?'admitted replay':'new issuance'} final proof refuses ${fault} acknowledgment without another mutation`,async t=>{
  const f=await prepared(t);if(admitted)await admit(f);
  const current=admitted?await trusted(f):f.trusted,authority=await createSponsorSlidesIssuerAuthority(current,f.campaignId),batch=f.DB.batch.bind(f.DB);
  let reached=false,getters=0,atBoundary,changesAtBoundary;
  f.DB.batch=async statements=>{
    const results=await batch(statements);
    if(!reached&&isFinalIssuerProof(statements)){
      assertActualFinalProof(statements,results);reached=true;atBoundary=rows(f);changesAtBoundary=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
      if(fault==='sparse-proof')delete results[0];
      if(fault==='inherited-proof'){const first=results[0];delete results[0];Object.setPrototypeOf(results,Object.assign(Object.create(Array.prototype),{0:first}));}
      if(fault==='failed-proof')results[0].success=false;
      if(fault==='string-current')results[0].results[0].current='1';
      if(fault==='current-accessor')Object.defineProperty(results[0].results[0],'current',{get(){getters++;return 1;}});
      if(fault==='extra-proof-row')results[0].results.push({current:1});
    }return results;
  };
  await assert.rejects(issueSponsorSlidesGrant(authority,current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  assert.equal(reached,true);assert.equal(getters,0);assert.deepEqual(rows(f),atBoundary);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,changesAtBoundary);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'document_jobs'),admitted?1:0);assert.equal(count(f,'output_provider_calls'),0);
});

for(const admitted of [false,true])for(const mutation of ['abort','authentication header','deadline'])
test(`Slides issuer ${mutation} after final proof Promise settlement withholds ${admitted?'admitted receipt':'new capability'}`,async t=>{
  const f=await prepared(t);if(admitted)await admit(f);
  const current=admitted?await trusted(f):f.trusted,controller=new AbortController();current.request=new Request(current.request,{signal:controller.signal});
  const authority=await createSponsorSlidesIssuerAuthority(current,f.campaignId),batch=f.DB.batch.bind(f.DB);let reached=false,atBoundary,changesAtBoundary,clock;
  f.DB.batch=statements=>{
    const pending=batch(statements);
    if(!reached&&isFinalIssuerProof(statements))return afterSettlement(pending,results=>{
      assertActualFinalProof(statements,results);reached=true;atBoundary=rows(f);changesAtBoundary=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
      if(mutation==='abort')controller.abort();
      if(mutation==='authentication header')current.request.headers.set('oai-authenticated-user-id',payer);
      if(mutation==='deadline')clock=t.mock.method(Date,'now',()=>f.policy.expiresAtMs+1);
    },3);return pending;
  };
  t.after(()=>{if(clock)clock.mock.restore();});
  await assert.rejects(issueSponsorSlidesGrant(authority,current,f.authorizeCommand),/sponsor_issuer_authority_changed/);
  assert.equal(reached,true);assert.deepEqual(rows(f),atBoundary);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,changesAtBoundary);
  assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'document_jobs'),admitted?1:0);assert.equal(count(f,'output_provider_calls'),0);
});

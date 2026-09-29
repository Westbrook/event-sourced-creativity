import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {outputTestDatabase, registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},{parseOutputRequirement},
  {handleOutputRequirements,loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {describeSponsorImageAdmission,createSponsorAdmissionAuthority},{compileSponsorEnvelope},{SPONSOR_ENTITLEMENT_SCHEMA}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),import('../src/model/output-requirements.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),import('../worker/experience-sponsor-admission.ts'),
  import('../worker/experience-sponsor-policy.ts'),import('../worker/experience-sponsor-entitlement.ts'),
]);
// Actual native source modules and real disposable SQLite. No live identity,
// campaign, financial ledger or provider is contacted. Only candidate fixture
// policies are provisioned; product schema/route/issuer remain disabled.
const originalFetch=globalThis.fetch;let fetchAttempts=0;
globalThis.fetch=()=>{fetchAttempts++;throw Error('Network forbidden in dormant sponsor admission qualification');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(fetchAttempts,0);});
const BASE='/api/output-requirements',actor='dev-local-creative',payer='fixture-sponsor',stream=`creative:${actor}`;
const context={waitUntil(){throw Error('No detached work permitted');}};
const init=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const tables=['events','event_private_payloads','output_commands','output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters','experience_sponsor_consumptions','experience_sponsor_active_jobs'];
function rows(f){return Object.fromEntries(tables.map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));}
async function fixture(t,{documentId='sponsor-native-image',kind='image'}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
  const sponsorHeaders={'oai-authenticated-user-id':payer,'oai-authenticated-user-email':'fixture-sponsor@example.invalid'};
  assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:sponsorHeaders}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Dormant sponsor fixture'});
  await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:'source-1',type:'subject',handle:'source-1',position:'0',properties:{text:'A pear orchard beside a stone wall',weight:1}});
  let sequence=0;
  const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,init({documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`setup-${++sequence}`,...body})),f.env,BASE,context,outputDocumentExecutionBridge);
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const parsed=parseOutputRequirement({id:'output-fixture',type:'Output',subtype:kind==='image'?'Social media image':'Executive summary',content:kind==='image'?'1 image at aspect ratio "1:1"':'1 slideshow with 5 slides'});
  assert.ok(parsed.spec);
  const deliverable=parsed.spec.deliverables.find(d=>d.media_kind===kind);assert.ok(deliverable);
  if(kind==='image') {deliverable.quantity={kind:'exact',unit:'image',value:1};deliverable.coverage={kind:'document_outline'};deliverable.format_variants.forEach(v=>{v.quantity={kind:'exact',unit:'image',value:1};v.required=true;});}
  await ok(await send({action:'save',blockId:parsed.spec.id,spec:parsed.spec}));
  const confirmed=await ok(await send({action:'confirm'}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
  const preflight=await ok(await send({action:'preflight',planRevisionId:confirmed.command.planRevisionId,targetIds:confirmed.snapshot.confirmedPlan.plan.targets.map(target=>target.id)}));
  const terms=preflight.command.preflight;assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
  const command={documentId,action:'authorize',expectedRevision:preflight.snapshot.revision,clientMutationId:'sponsor-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const request=new Request(`http://localhost${BASE}`,init(command));
  const trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  for(const sql of SPONSOR_ENTITLEMENT_SCHEMA)f.sqlite.exec(sql);
  const result={...f,documentId,terms,command,request,trusted,send,ok};
  result.sponsor=async({campaignId='fixture-campaign',payerUserId=payer,changes={},envelopeChanges={},command:cmd=command,trusted:tr=trusted}={})=>{
    const description=await describeSponsorImageAdmission(tr,cmd),{preflightExpiresAtMs,...native}=description,now=Date.now();
    const policy={version:1,mode:'candidate',campaignId,policyVersion:'fixture@1',payerUserId,audience:'canonical-principal',approvalReceiptDigest:`sha256:${'a'.repeat(64)}`,
      startsAtMs:now-60_000,expiresAtMs:now+3_600_000,maximumGrantLifetimeMs:900_000,maximumAdmissions:10,maximumMicrousd:Math.max(1_000_000,native.recipe.maximumMicrousd*10),maximumAdmissionsPerActor:5,
      windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,recipes:[native.recipe],...changes};
    const envelope={version:1,campaignId,policyVersion:policy.policyVersion,consumptionId:`consume-${campaignId}-${cmd.clientMutationId}`,intentKey:cmd.clientMutationId,payerUserId,...native,
      issuedAtMs:now-1000,expiresAtMs:Math.min(now+600_000,preflightExpiresAtMs),...envelopeChanges};
    const compiled=await compileSponsorEnvelope(policy,envelope),grantId=`issued-${campaignId}-${cmd.clientMutationId}`;
    f.sqlite.prepare('INSERT INTO experience_sponsor_campaigns(campaign_id,policy_digest,policy_json,enabled) VALUES(?,?,?,1)').run(campaignId,compiled.policyDigest,compiled.policyJson);
    f.sqlite.prepare('INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)').run(grantId,campaignId,compiled.policyDigest,actor,native.sessionDigest,cmd.clientMutationId,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs);
    const authority=await createSponsorAdmissionAuthority({trusted:tr,command:cmd,policy,envelope,grantId});
    return {authority,policy,envelope,grantId,compiled};
  };
  result.execute=(authority,cmd=command,tr=trusted)=>outputExperienceCommands.executeSponsored(tr,cmd,authority,outputDocumentExecutionBridge,context);
  return result;
}

test('actual authorizePlan commits actor custody and sealed sponsor reservations once, with native receipt in the same SQLite batch',async t=>{
  const f=await fixture(t),s=await f.sponsor();
  const accepted=await f.execute(s.authority);assert.equal(accepted.replayed,false);
  const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants').get(),slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get(),job=f.sqlite.prepare('SELECT * FROM document_jobs').get();
  assert.equal(grant.actor_user_id,actor);assert.equal(grant.payer_user_id,payer);assert.equal(grant.status,'authorized');assert.equal(slot.status,'authorized');assert.equal(job.status,'queued');assert.equal(job.owner_id,actor);assert.equal(job.stream_id,stream);
  for(const table of ['budget_reservations','cost_budget_reservations']){const held=f.sqlite.prepare(`SELECT * FROM ${table}`).get();assert.equal(held.owner_id,payer);assert.equal(held.correlation_id,job.correlation_id);assert.equal(held.status,'active');}
  assert.equal(f.sqlite.prepare('SELECT allow_user_overage FROM cost_budget_reservations').get().allow_user_overage,0);
  const saved=f.sqlite.prepare('SELECT private_json,owner_id FROM event_private_payloads WHERE private_event_id=?').get(accepted.receipt.eventId);assert.equal(saved.owner_id,actor);assert.equal(JSON.parse(saved.private_json).output_command_envelope.sponsor_entitlement.payer_user_id,payer);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').get().n,1);
  const before=rows(f),replay=await f.execute(s.authority);assert.equal(replay.replayed,true);assert.equal(replay.receipt.eventId,accepted.receipt.eventId);assert.deepEqual(rows(f),before);
});

test('sponsor preview leaves missing counters untouched; actual atomic batch creates them with the reservations',async t=>{
  const f=await fixture(t),s=await f.sponsor();
  f.sqlite.prepare("DELETE FROM budget_counters WHERE scope='user' AND scope_id=?").run(payer);f.sqlite.prepare("DELETE FROM cost_budget_counters WHERE scope='user' AND scope_id=?").run(payer);
  const before=rows(f),batch=f.DB.batch.bind(f.DB);let admitted=false;
  f.DB.batch=async statements=>{if(statements.some(statement=>statement.sql.includes('INSERT INTO output_execution_grants'))){admitted=true;assert.deepEqual(rows(f),before);}return batch(statements);};
  await f.execute(s.authority);assert.equal(admitted,true);
  assert.equal(f.sqlite.prepare("SELECT reserved_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get(payer).reserved_tokens,f.terms.targets[0].maximumTokens);
  assert.equal(f.sqlite.prepare("SELECT reserved_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(payer).reserved_microusd,f.terms.maximumMicrousd);
});

test('depleted actor uses only funded sponsor; depleted sponsor refuses despite funded actor, with no fallback',async t=>{
  for(const depleted of [actor,payer]){
    const f=await fixture(t),s=await f.sponsor();
    f.sqlite.prepare("UPDATE budget_counters SET used_tokens=hard_limit_tokens WHERE scope='user' AND scope_id=?").run(depleted);
    f.sqlite.prepare("UPDATE cost_budget_counters SET used_microusd=hard_limit_microusd WHERE scope='user' AND scope_id=?").run(depleted);
    const before=rows(f),actorTokens=f.sqlite.prepare("SELECT * FROM budget_counters WHERE scope='user' AND scope_id=?").get(actor),actorCost=f.sqlite.prepare("SELECT * FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(actor);
    if(depleted===actor){await f.execute(s.authority);assert.equal(f.sqlite.prepare('SELECT owner_id FROM cost_budget_reservations').get().owner_id,payer);}
    else{await assert.rejects(f.execute(s.authority),/budget|unavailable|ready/i);assert.deepEqual(rows(f),before);}
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM budget_counters WHERE scope='user' AND scope_id=?").get(actor),actorTokens);
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(actor),actorCost);
  }
});

test('registered personal path remains actor-paid and wire sponsor fields cannot grant authority',async t=>{
  const f=await fixture(t);const before=rows(f);
  const rejected=await f.send({...f.command,sponsor_entitlement:{payer_user_id:payer}});assert.equal(rejected.status,403);assert.deepEqual(rows(f),before);
  const accepted=await f.ok(await f.send(f.command));assert.ok(accepted.command.grantId);
  assert.equal(f.sqlite.prepare('SELECT payer_user_id FROM output_execution_grants').get().payer_user_id,actor);
  assert.equal(f.sqlite.prepare('SELECT owner_id FROM cost_budget_reservations').get().owner_id,actor);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').get().n,0);
});

test('unsealed, cloned, cross-request/env/DB/Document and tampered rights capabilities refuse without financial writes',async t=>{
  const f=await fixture(t),s=await f.sponsor(),before=rows(f);
  for(const seal of [{},structuredClone(s.authority),{...s.authority}])await assert.rejects(f.execute(seal),/sponsor_authority_unavailable/);
  const variants=[{...f.trusted,request:f.request.clone()},{...f.trusted,env:{...f.env}},{...f.trusted,scope:{...f.trusted.scope,documentId:'other'}},
    {...f.trusted,sourceAssertions:[]},{...f.trusted,context:{...f.trusted.context,snapshot:{...f.trusted.context.snapshot,title:'tampered'}}}];
  for(const trusted of variants)await assert.rejects(f.execute(s.authority,f.command,trusted),/sponsor_authority_/);
  const db=f.env.DB;f.env.DB={...db};await assert.rejects(f.execute(s.authority),/sponsor_authority_unavailable/);f.env.DB=db;
  assert.deepEqual(rows(f),before);
});

test('mutable caller body/source during async admission cannot change captured native command or weaken source guards',async t=>{
  const f=await fixture(t),s=await f.sponsor(),body=structuredClone(f.command);
  const pending=f.execute(s.authority,body);body.action='run';body.clientMutationId='tampered';body.maximumMicrousd=1;f.trusted.sourceAssertions.length=0;
  const accepted=await pending;assert.equal(accepted.replayed,false);
  const saved=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(accepted.receipt.eventId);
  const command=JSON.parse(saved.private_json).output_command_envelope;assert.equal(command.action,'authorize');assert.equal(command.clientMutationId,f.command.clientMutationId);assert.equal(command.maximumMicrousd,f.command.maximumMicrousd);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'authorized');
});

test('existing receipt cannot bypass seal validation, revoked authority, changed policy/payer or changed body',async t=>{
  const f=await fixture(t),s=await f.sponsor();await f.execute(s.authority);
  const headers={'oai-authenticated-user-id':'other-fixture-sponsor','oai-authenticated-user-email':'other-fixture-sponsor@example.invalid'};
  await handleSession(new Request('http://localhost/api/session',{headers}),f.env);f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,'other-fixture-sponsor');
  const before=rows(f);
  await assert.rejects(f.execute({}),/sponsor_authority_unavailable/);
  await assert.rejects(f.execute(s.authority,{...f.command,maximumMicrousd:f.command.maximumMicrousd+1}),/sponsor_authority_changed/);
  const second=await f.sponsor({campaignId:'second-campaign'});await assert.rejects(f.execute(second.authority),/mutation|conflict|changed/);
  const changedPayer=await f.sponsor({campaignId:'changed-payer',payerUserId:'other-fixture-sponsor'});await assert.rejects(f.execute(changedPayer.authority),/mutation|conflict|changed/);
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(s.policy.campaignId);
  await assert.rejects(f.execute(s.authority),/sponsor_authority_revoked/);
  assert.deepEqual(rows(f),before);
});

test('actor-paid original receipt cannot become sponsored under the same command key',async t=>{
  const f=await fixture(t),s=await f.sponsor();await outputExperienceCommands.execute(f.trusted,f.command,outputDocumentExecutionBridge,context);const before=rows(f);
  await assert.rejects(f.execute(s.authority),/mutation|conflict|changed/);assert.deepEqual(rows(f),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_consumptions').get().n,0);
});

for(const failure of ['campaign revoked','actor consent revoked','payer consent revoked','source changed','token reservation refused','cost reservation refused','receipt marker removed','native job ignored'])
test(`actual native transaction rolls back every admission write when ${failure}`,async t=>{
  const f=await fixture(t),s=await f.sponsor();let captured=null,fired=false;const batch=f.DB.batch.bind(f.DB),preparedBefore=rows(f);
  if(failure==='token reservation refused'||failure==='cost reservation refused')f.sqlite.exec(`CREATE TRIGGER refuse_reservation BEFORE INSERT ON ${failure.startsWith('token')?'budget_reservations':'cost_budget_reservations'} BEGIN SELECT RAISE(IGNORE); END`);
  if(failure==='receipt marker removed')f.sqlite.exec(`CREATE TRIGGER strip_marker AFTER INSERT ON output_commands BEGIN UPDATE event_private_payloads SET private_json=json_remove(private_json,'$.output_command_envelope.sponsor_entitlement') WHERE private_event_id=NEW.event_id; END`);
  if(failure==='native job ignored')f.sqlite.exec('CREATE TRIGGER refuse_job BEFORE INSERT ON document_jobs BEGIN SELECT RAISE(IGNORE); END');
  f.DB.batch=async statements=>{
    if(!fired&&statements.some(statement=>statement.sql.includes('INSERT INTO output_execution_grants'))){
      fired=true;assert.deepEqual(rows(f),preparedBefore,'native preparation creates no financial rows or holds');
      if(failure==='campaign revoked')f.sqlite.exec('UPDATE experience_sponsor_campaigns SET enabled=0');
      if(failure==='actor consent revoked'||failure==='payer consent revoked')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(failure.startsWith('actor')?actor:payer);
      if(failure==='source changed')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'source-1',property_path:'text',new_value:'Source changed at the final transaction'});
      captured=rows(f);
    }
    return batch(statements);
  };
  await assert.rejects(f.execute(s.authority),/CHECK|constraint|changed|conflict/i);assert.equal(fired,true);assert.deepEqual(rows(f),captured,'failed same-batch proof retains no partial events, reservations, jobs, slots, receipt or entitlement');
});

test('actual native lost acknowledgment replays original receipt and never re-reserves the sponsor budget',async t=>{
  const f=await fixture(t),s=await f.sponsor(),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(statement=>statement.sql.includes('INSERT INTO output_execution_grants'))){lost=true;throw Error('lost committed acknowledgment');}return result;};
  // commitOutputCommand may recover its receipt itself, or propagate ambiguity;
  // both must leave one committed admission that the exact replay locates.
  try{await f.execute(s.authority);}catch(error){assert.match(error.message,/lost committed acknowledgment/);}
  assert.equal(lost,true);const before=rows(f);const replay=await f.execute(s.authority);assert.equal(replay.replayed,true);assert.deepEqual(rows(f),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
});

test('new sponsored personal run is refused before slot transition or native dispatch',async t=>{
  const f=await fixture(t),s=await f.sponsor(),accepted=await f.execute(s.authority),before=rows(f);
  const response=await f.send({action:'run',grantId:accepted.receipt.payload.grant_id});assert.equal(response.status,403);assert.equal((await response.json()).error,'sponsor_execution_not_enabled');assert.deepEqual(rows(f),before);
});

test('retained run receipt also refuses sponsored personal resume without queue mutation or dispatch',async t=>{
  const {commitOutputCommand}=await import('../worker/output-requirements-ledger.ts'),{outputDigest}=await import('../worker/output-requirements-api.ts');
  const f=await fixture(t),s=await f.sponsor(),accepted=await f.execute(s.authority);
  const trusted=await loadOutputTrustedContext(f.request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const body={documentId:f.documentId,action:'run',grantId:accepted.receipt.payload.grant_id,expectedRevision:`output:${trusted.ownerHead}`,clientMutationId:'synthetic-retained-run'};
  // Seed only an old run receipt to reach the actual resume branch. No sponsored
  // run is authorized by product code, and no slot is made runnable here.
  await commitOutputCommand(f.env,{scope:trusted.scope,permission:'request',expectedHead:trusted.ownerHead,expectedProjectHead:trusted.projectHead,key:body.clientMutationId,digest:await outputDigest(body),action:'run',retainedEnvelope:body,
    events:[{type:'OutputExecutionRunRequested',payload:{grant_id:body.grantId}}]});
  const before=rows(f);await assert.rejects(outputExperienceCommands.execute(trusted,body,outputDocumentExecutionBridge,context),/sponsor_execution_not_enabled/);assert.deepEqual(rows(f),before);
});

test('first mapping rejects other output kinds, references and mismatched exact source envelope',async t=>{
  const slides=await fixture(t,{kind:'slides'});await assert.rejects(describeSponsorImageAdmission(slides.trusted,slides.command),/sponsor_recipe_unsupported/);
  const f=await fixture(t),changed={...f.trusted,context:{...f.trusted.context,snapshot:{...f.trusted.context.snapshot,facts:[...f.trusted.context.snapshot.facts,{type:'reference',properties:{asset_id:'fixture'}}]}}};
  await assert.rejects(describeSponsorImageAdmission(changed,f.command),/sponsor_recipe_unsupported/);
  await assert.rejects(f.sponsor({envelopeChanges:{sourceDigest:`sha256:${'b'.repeat(64)}`}}),/sponsor_native_envelope_mismatch/);
});

import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{ensureOutputRequirementsSchema},{registeredExperience,initialValues,validateIntakeRequest,buildExperiencePlan},
  {canonicalJson,digest},{SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign},
  {stableAudioTemplate},policy,approval,resources,classification]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/output-requirements-ledger.ts'),import('../src/experiences/intake.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),
  import('../worker/experience-sponsor-approval.ts'),import('./sponsor-audio-server-native-fixture.mjs'),
  import('../worker/experience-sponsor-audio-intake-policy.ts'),import('../worker/experience-sponsor-audio-intake-approval.ts'),
  import('../worker/experience-sponsor-audio-intake-resources.ts'),import('../worker/experience-sponsor-audio-intake-classification.ts'),
]);
const FAMILY='canonical-audio-initial-intake@1',actor='fixture-audio-intake-actor',payer='fixture-audio-intake-payer';
const operations=['audio-intake-prepare','audio-intake-commit','audio-intake-draft','audio-intake-receipt'];
const clock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value));
const headers=userId=>({'oai-authenticated-user-id':userId,'oai-authenticated-user-email':`${userId}@example.invalid`});
const request=(body,userId=payer,signal)=>new Request('http://localhost/__fixture/audio-initial-contracts',{
  method:'POST',headers:{...headers(userId),'content-type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})});
const readRequest=signal=>new Request('http://localhost/__fixture/audio-initial-contracts',{headers:headers(actor),...(signal?{signal}:{})});
const oldFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Audio initial contracts forbid provider/network egress');};
after(()=>{globalThis.fetch=oldFetch;assert.equal(networkAttempts,0);});
const storageTables=['experience_sponsor_audio_intake_allocations','experience_sponsor_audio_intakes'];
const approvalTables=['experience_sponsor_audio_intake_policies','experience_sponsor_audio_intake_approvals'];
const count=(f,table)=>Number(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const snapshot=f=>Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name}"`).all().map(row=>({...row})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
function initialPolicy(now){
  const storage={maximumOperations:4,maximumBytes:1_000_000,maximumOperationsPerWindow:4,maximumBytesPerWindow:1_000_000};
  const io={maximumRequestsPerWindow:20,maximumBytesPerWindow:20_000_000};
  return {version:1,family:FAMILY,purpose:'initial-context',storage:{startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,
    maximumDraftBytes:65_536,maximumEventBytes:65_536,maximumOriginalBytes:131_072,actor:{...storage},campaign:{...storage}},
  io:{windowMs:60_000,operations:Object.fromEntries(operations.map(name=>[name,{maximumBytes:1_000_000,deadlineMs:30_000}])),actor:{...io},campaign:{...io}}};
}
function noNativeWork(f){
  const installed=new Set(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  for(const table of ['events','private_content','output_preflights','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations',
    'experience_sponsor_grants','experience_sponsor_consumptions','output_provider_calls'])if(installed.has(table))assert.equal(count(f,table),0,table);
  assert.equal(installed.has('experience_sponsor_audio_intake_attempts'),false);assert.equal(f.media.size,0);
}
async function fixture(t,{approved=false,strict=false}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{throw Error('No actual or synthetic media IO in contracts');};
  for(const userId of [actor,payer]){
    assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headers(userId)}),f.env)).status,200);
    f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,userId);
  }
  await ensureOutputRequirementsSchema(f.env);
  for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,
    policy.SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA,approval.SPONSOR_AUDIO_INTAKE_APPROVAL_SCHEMA,resources.SPONSOR_AUDIO_INTAKE_STORAGE_SCHEMA])
    for(const sql of schema)f.sqlite.exec(sql);
  const now=Number(f.sqlite.prepare(`SELECT ${clock} AS now`).get().now),template=await stableAudioTemplate();
  const allowance={maximumOperations:20,maximumTextBytes:1_000_000,maximumOperationsPerWindow:20,maximumTextBytesPerWindow:1_000_000,maximumPendingGrants:2,maximumInflightJobs:1};
  const generationResources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64000,actor:{...allowance},campaign:{...allowance}};
  const generationProposal={policy:{version:8,family:'canonical-instrumental-cue@1',mode:'candidate',campaignId:'fixture-audio-initial-campaign',
    policyVersion:'audio-initial-contract-fixture@1',payerUserId:payer,audience:'canonical-principal',startsAtMs:generationResources.startsAtMs,
    expiresAtMs:generationResources.expiresAtMs,maximumGrantLifetimeMs:900000,maximumAdmissions:2,maximumMicrousd:template.maximumMicrousd*2,
    maximumAdmissionsPerActor:2,windowMs:60000,maximumAdmissionsPerWindow:2,maximumAdmissionsPerActorWindow:2,templates:[template],resources:generationResources},
    eligibleActorUserIds:[actor],issuerUserIds:[actor]};
  const compiled=await compileSponsorApprovalProposal(generationProposal);
  const generationCommand={action:'approve-sponsor-campaign',approvalId:'fixture-audio-original-approval',proposal:generationProposal,
    confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:compiled.termsDigest};
  f.original=await approveSponsorCampaign(request(generationCommand),f.env);
  assert.equal(f.original.policy.version,8);
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT payer_authority_json FROM experience_sponsor_approvals').get().payer_authority_json).length,13);
  f.now=now;f.policy=initialPolicy(now);f.campaignId=f.original.policy.campaignId;
  f.proposal={version:1,family:FAMILY,campaignId:f.campaignId,sponsorPolicyDigest:f.original.policyDigest,intakePolicy:f.policy};
  f.review=()=>approval.prepareSponsorAudioIntakeApproval(request({action:'prepare-sponsor-audio-intake-policy',proposal:f.proposal}),f.env);
  f.approve=async()=>{
    f.reviewed=await f.review();f.command={action:'approve-sponsor-audio-intake-policy',approvalId:'fixture-audio-initial-approval',proposal:f.proposal,
      confirmation:'APPROVE_SPONSOR_AUDIO_INTAKE_POLICY',reviewedTermsDigest:f.reviewed.termsDigest};
    f.approved=await approval.approveSponsorAudioIntakePolicy(request(f.command),f.env);return f.approved;
  };
  if(strict){f.limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>f.limits.restore());}
  if(approved)await f.approve();noNativeWork(f);return f;
}
async function nativeOriginal(f,{detail='',intentId=randomUUID()}={}){
  const release=await registeredExperience('audio'),values=initialValues(release);
  values.direction={value:'An original instrumental cue, gently rising. 水 — موسيقى',provenance:'authored'};
  if(detail)values.detail={value:detail,provenance:'authored'};
  const supplied={experienceId:'audio',intentId,releaseHash:release.releaseHash,values},valid=await validateIntakeRequest(supplied);
  assert.ok(valid);const ordinary=await buildExperiencePlan(actor,valid.request,valid.release);
  const receiptId=`sponsor-audio-intake-${(await digest([f.campaignId,actor,intentId])).slice(7)}`;
  const {draftHash:discarded,...base}=ordinary;assert.ok(discarded);
  const marked={...base,sponsor_intake:{version:1,family:FAMILY,receiptId}};
  const plan={...JSON.parse(canonicalJson(marked)),draftHash:await digest(marked)},content=canonicalJson(plan),payloads=plan.events.map(event=>JSON.stringify(event.payload));
  const draftBytes=bytes(content),eventBytes=payloads.reduce((n,payload)=>n+bytes(payload),0);
  assert.ok(draftBytes<=65536);assert.equal(plan.events.length,detail?6:5);
  return {plan,content,input:{policy:f.policy,receiptId,allocationId:`allocation-${intentId}`,campaignId:f.campaignId,
    sponsorPolicyDigest:f.original.policyDigest,intakePolicyDigest:await digest(f.policy),intakeApprovalId:f.approved?.approvalId??'fixture-audio-initial-approval',
    actorUserId:actor,sessionDigest:await digest({fixture:'synthetic-actor-session',actor}),nativeIntentId:intentId,
    draftId:plan.draftId,projectId:plan.projectId,documentId:plan.documentId,draftHash:plan.draftHash,
    bodyDigest:await digest({action:'prepare-sponsored-audio-draft',campaignId:f.campaignId,request:valid.request}),contentDigest:await digest(content),
    sourceDigest:await digest(plan.events),eventPayloadDigest:await digest(payloads),eventCount:plan.events.length,
    draftBytes,eventBytes,totalBytes:draftBytes+eventBytes,expiresAt:new Date(f.now+900000).toISOString()}};
}
const executePlan=(f,prepared)=>f.env.DB.batch(prepared.statements.map(({sql,bindings})=>f.env.DB.prepare(sql).bind(...bindings)));
const guardValue=(f,guard)=>Number(f.sqlite.prepare(`SELECT CASE WHEN (${guard.sql}) THEN 1 ELSE 0 END AS current`).get(...guard.bindings).current);
function wrapDatabase(f,transform){
  const db=f.env.DB,prepare=db.prepare,batch=db.batch;
  db.prepare=function(sql){const wrap=statement=>({bind:(...bindings)=>wrap(statement.bind(...bindings)),
    all:async()=>transform('all',sql,await statement.all()),first:(...args)=>statement.first(...args),run:()=>statement.run()});return wrap(prepare.call(db,sql));};
  db.batch=async statements=>transform('batch',null,await batch.call(db,statements));
  // This wrapper is only used by read-only query tests; no wrapped statement is batched.
  return()=>{db.prepare=prepare;db.batch=batch;};
}

test('Audio initial contract: registered grammar and closed finite policy',async t=>{
  await t.test('real registered five/six events preserve authored values and Audio format',async()=>{
    const f={now:Date.now(),campaignId:'fixture-grammar',policy:initialPolicy(Date.now()),original:{policyDigest:`sha256:${'1'.repeat(64)}`}};
    for(const detail of ['', 'A sustained ending.']){
      const {plan,input}=await nativeOriginal(f,{detail});assert.deepEqual(plan.events.slice(0,3).map(event=>event.type),['ProjectCreated','DocumentCreated','EmptyCanvasChosen']);
      assert.equal(plan.events.at(-1).payload.type,'format');assert.match(plan.events.at(-1).payload.properties.text,/Instrumental/u);
      assert.equal(plan.events[3].payload.properties.experience_value,plan.request.values.direction.value);
      if(detail)assert.equal(plan.events[4].payload.properties.experience_value,detail);
      assert.equal((await resources.prepareSponsorAudioIntakeStorage(input)).replayLookup.bindings[0],plan.draftId);
      for(const eventCount of [0,4,7,9,10])await assert.rejects(resources.prepareSponsorAudioIntakeStorage({...input,eventCount}));
      assert.equal(await validateIntakeRequest({...plan.request,reference:{}}),null);
    }
  });
  await t.test('policy refuses widening, accessors and impossible ceilings',()=>{
    const raw=initialPolicy(Date.now()),read=policy.readSponsorAudioIntakePolicy(raw);
    assert.deepEqual([...policy.SPONSOR_AUDIO_INTAKE_IO_OPERATIONS],operations);assert.equal(Object.isFrozen(read.io.operations),true);
    raw.storage.actor.maximumOperations=1;assert.equal(read.storage.actor.maximumOperations,4);
    for(const mutate of [p=>p.family='canonical-short-story-initial-intake@1',p=>p.version=8,p=>p.purpose='generation',
      p=>p.io.operations['audio-run']={maximumBytes:1,deadlineMs:1},p=>p.io.operations[operations[0]].deadlineMs=30001,
      p=>p.storage.actor.maximumBytes=p.storage.campaign.maximumBytes+1,p=>p.storage.maximumDraftBytes=Infinity]){
      const invalid=initialPolicy(Date.now());mutate(invalid);assert.throws(()=>policy.readSponsorAudioIntakePolicy(invalid));
    }
    let invoked=0;const invalid=initialPolicy(Date.now());Object.defineProperty(invalid,'purpose',{enumerable:true,get(){invoked++;return 'initial-context';}});
    assert.throws(()=>policy.readSponsorAudioIntakePolicy(invalid));assert.equal(invoked,0);
  });
});

test('Audio initial contract: actual separate V8 payer review and approval',async t=>{
  await t.test('actual Request original approval, exact replay and retained provenance are source-free',async t=>{
    const f=await fixture(t,{strict:true}),before=snapshot(f);await f.review();assert.deepEqual(snapshot(f),before);
    await f.approve();assert.equal(f.approved.replayed,false);for(const table of approvalTables)assert.equal(count(f,table),1);
    const committed=snapshot(f),replay=await approval.approveSponsorAudioIntakePolicy(request(f.command),f.env);
    assert.deepEqual({...replay,replayed:false},f.approved);assert.equal(replay.replayed,true);assert.deepEqual(snapshot(f),committed);
    f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms').run();
    const retained=await approval.readApprovedSponsorAudioIntakePolicy(readRequest(),f.env,f.campaignId,f.original.policyDigest);
    assert.equal(retained.payerUserId,payer);assert.deepEqual(retained.policy,f.policy);assert.ok(retained.controlBytes>0);
    await assert.rejects(f.review());noNativeWork(f);f.limits.assertVerified();
    t.diagnostic(JSON.stringify({strictStatements:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts),networkAttempts}));
  });
  await t.test('actor, changed terms and different original approval cannot provide payer authority',async t=>{
    const f=await fixture(t);const before=snapshot(f);
    await assert.rejects(approval.prepareSponsorAudioIntakeApproval(request({action:'prepare-sponsor-audio-intake-policy',proposal:f.proposal},actor),f.env));
    assert.deepEqual(snapshot(f),before);await f.approve();const saved=snapshot(f);
    for(const mutate of [c=>c.confirmation='APPROVE_SPONSOR_CAMPAIGN',c=>c.reviewedTermsDigest=`sha256:${'0'.repeat(64)}`,
      c=>c.approvalId='other-id',c=>c.proposal.intakePolicy.io.actor.maximumRequestsPerWindow--]){
      const command=structuredClone(f.command);mutate(command);await assert.rejects(approval.approveSponsorAudioIntakePolicy(request(command),f.env));assert.deepEqual(snapshot(f),saved);
    }
  });
  await t.test('same-transaction closing payer mutation rolls back both new rows',async t=>{
    const f=await fixture(t);await f.review();let mutations=0;
    f.sqlite.function('fixture_observe_payer_change',()=>{mutations++;return 1;});
    // Preserve the exact owned approval schema. The existing assertion sink
    // mutates the actual payer only after both newly inserted rows exist.
    f.sqlite.exec(`CREATE TRIGGER fixture_payer_change AFTER INSERT ON output_atomic_assertions
      WHEN EXISTS(SELECT 1 FROM experience_sponsor_audio_intake_approvals WHERE approval_id='fixture-audio-initial-approval')
      BEGIN SELECT fixture_observe_payer_change(); UPDATE users SET display_name='changed-during-transaction' WHERE user_id='${payer}'; END`);
    const original=f.sqlite.prepare('SELECT display_name FROM users WHERE user_id=?').get(payer).display_name;
    await assert.rejects(f.approve());for(const table of approvalTables)assert.equal(count(f,table),0);
    assert.ok(mutations>0,'The actual SQLite mutation ran after both new rows existed');
    assert.equal(f.sqlite.prepare('SELECT display_name FROM users WHERE user_id=?').get(payer).display_name,original);
  });
  await t.test('bounded ACK refuses inherited error without invoking it',async t=>{
    const f=await fixture(t);let invoked=0;
    const restore=wrapDatabase(f,(kind,sql,value)=>{if(kind!=='all')return value;const proto={};Object.defineProperty(proto,'error',{get(){invoked++;return 'contradictory-error';}});return Object.assign(Object.create(proto),value);});
    try{const bound=approval.createSponsorAudioIntakeReadBoundary(readRequest(),f.env);await assert.rejects(bound.query('SELECT 1 AS current',[],['current']));assert.equal(invoked,0);}finally{restore();}
  });
  await t.test('cumulative ACK bound rejects before whole-envelope serialization',async t=>{
    const f=await fixture(t),chunk='x'.repeat(1_100_000);let wholeEnvelope=false;
    const restore=wrapDatabase(f,(kind,sql,value)=>kind==='all'?{...value,meta:{fixtureLargeParts:[chunk,chunk,chunk,chunk]}}:value);
    const stringify=JSON.stringify;
    JSON.stringify=function(value,...args){if(value?.meta?.fixtureLargeParts)wholeEnvelope=true;return stringify.call(this,value,...args);};
    try{const bound=approval.createSponsorAudioIntakeReadBoundary(readRequest(),f.env);await assert.rejects(bound.query('SELECT 1 AS current',[],['current']));assert.equal(wholeEnvelope,false);}
    finally{JSON.stringify=stringify;restore();}
  });
  await t.test('escaped Unicode byte accounting is exact and batch errors are not inherited authority',async t=>{
    const f=await fixture(t);let actual;
    const restore=wrapDatabase(f,(kind,sql,value)=>kind==='all'?(actual={...value,meta:{'quoted"key':'\u0000\t\n"\\ 水 😀 \ud800'}}):value);
    try{const bound=approval.createSponsorAudioIntakeReadBoundary(readRequest(),f.env);await bound.query('SELECT 1 AS current',[],['current']);assert.equal(bound.controlBytes,bytes(actual));}finally{restore();}
    const batch=f.env.DB.batch;let invoked=0;
    f.env.DB.batch=async statements=>{const results=await batch.call(f.env.DB,statements),proto={};Object.defineProperty(proto,'error',{get(){invoked++;return 'invalid';}});return results.map(result=>Object.assign(Object.create(proto),result));};
    try{const bound=approval.createSponsorAudioIntakeReadBoundary(readRequest(),f.env);await assert.rejects(bound.batch([f.env.DB.prepare('SELECT 1 AS current')]));assert.equal(invoked,0);}finally{f.env.DB.batch=batch;}
  });
  await t.test('sparse and contradictory ACKs, abort and changed DB cannot disclose metadata',async t=>{
    for(const change of ['sparse','own-error','abort','database']){
      const f=await fixture(t),controller=new AbortController(),restore=wrapDatabase(f,(kind,sql,value)=>{
        if(kind!=='all')return value;if(change==='sparse')return {...value,results:new Array(1)};
        if(change==='own-error')return {...value,error:'contradictory'};if(change==='abort')controller.abort();
        if(change==='database')f.env.DB={...f.env.DB};return value;
      });
      try{const bound=approval.createSponsorAudioIntakeReadBoundary(readRequest(controller.signal),f.env);await assert.rejects(bound.query('SELECT 1 AS current',[],['current']));}finally{restore();}
    }
  });
});

test('Audio initial contract: actual logical allocation SQL',async t=>{
  await t.test('pure preparation owns the input before its first digest await',async t=>{
    const f=await fixture(t,{approved:true}),{input}=await nativeOriginal(f),raw=structuredClone(input),nativeDigest=crypto.subtle.digest.bind(crypto.subtle);
    const mocked=t.mock.method(crypto.subtle,'digest',(...args)=>{raw.policy.storage.maximumDraftBytes=1;raw.actorUserId='replacement';return nativeDigest(...args);});
    try{const prepared=await resources.prepareSponsorAudioIntakeStorage(raw);assert.ok(prepared.statements.some(statement=>statement.bindings.includes(actor)));assert.ok(prepared.statements.every(statement=>!statement.bindings.includes('replacement')));}finally{mocked.mock.restore();}
  });
  await t.test('five/six originals store one paired receipt without native or monetary writes',async t=>{
    const f=await fixture(t,{approved:true,strict:true});
    for(const detail of ['', 'A sustained ending.']){
      const {input}=await nativeOriginal(f,{detail}),prepared=await resources.prepareSponsorAudioIntakeStorage(input);await executePlan(f,prepared);
      const stored=await resources.readStoredSponsorAudioIntake(readRequest(),f.env,{draftId:input.draftId,actorUserId:actor});
      assert.ok(stored.receipt);assert.equal(stored.receipt.eventCount,detail?6:5);assert.equal(stored.receipt.totalBytes,input.totalBytes);
      const original=snapshot(f);await assert.rejects(executePlan(f,prepared));assert.deepEqual(snapshot(f),original);
      assert.equal(guardValue(f,{...prepared.receiptAssertion,bindings:prepared.receiptAssertion.bindings}),1);
    }
    for(const table of storageTables)assert.equal(count(f,table),2);noNativeWork(f);f.limits.assertVerified();
    t.diagnostic(JSON.stringify({strictStatements:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts)}));
  });
  await t.test('false and NULL final predicates roll back the actual new allocation pair',async t=>{
    for(const predicate of ['0','NULL']){
      const f=await fixture(t,{approved:true}),{input}=await nativeOriginal(f),prepared=await resources.prepareSponsorAudioIntakeStorage(input),before=snapshot(f);
      const bound=approval.createSponsorAudioIntakeReadBoundary(readRequest(),f.env);
      const statements=prepared.statements.map(({sql,bindings})=>f.env.DB.prepare(sql).bind(...bindings));
      await assert.rejects(f.env.DB.batch([...statements,...bound.assertions([{sql:predicate,bindings:[]}])]));assert.deepEqual(snapshot(f),before);
    }
  });
  await t.test('real campaign capacity and unpaired original fail closed',async t=>{
    const f=await fixture(t);f.policy.storage.actor.maximumOperations=1;f.policy.storage.actor.maximumOperationsPerWindow=1;await f.approve();
    const first=await nativeOriginal(f);await executePlan(f,await resources.prepareSponsorAudioIntakeStorage(first.input));
    const original=snapshot(f),second=await nativeOriginal(f);await assert.rejects(executePlan(f,await resources.prepareSponsorAudioIntakeStorage(second.input)));assert.deepEqual(snapshot(f),original);
    f.sqlite.exec('DROP TRIGGER experience_sponsor_audio_intakes_no_delete');f.sqlite.prepare('DELETE FROM experience_sponsor_audio_intakes WHERE draft_id=?').run(first.input.draftId);
    await assert.rejects(resources.readStoredSponsorAudioIntake(readRequest(),f.env,{draftId:first.input.draftId,actorUserId:actor}));
  });
});

test('Audio initial contract: source-free negative classification',async t=>{
  await t.test('ordinary absence is current only until actual Audio allocation appears',async t=>{
    const f=await fixture(t,{approved:true,strict:true}),{input}=await nativeOriginal(f);
    const before=await classification.classifySponsorAudioIntakeDraft(readRequest(),f.env,input.draftId);assert.equal(before.kind,'ordinary');assert.equal(guardValue(f,before.guard),1);
    await executePlan(f,await resources.prepareSponsorAudioIntakeStorage(input));
    assert.equal(guardValue(f,before.guard),0);assert.equal((await classification.classifySponsorAudioIntakeDraft(readRequest(),f.env,input.draftId)).kind,'audio-sponsored');
    f.sqlite.exec('DROP TRIGGER experience_sponsor_audio_intakes_no_delete');f.sqlite.prepare('DELETE FROM experience_sponsor_audio_intakes WHERE draft_id=?').run(input.draftId);
    assert.notEqual((await classification.classifySponsorAudioIntakeDraft(readRequest(),f.env,input.draftId)).kind,'ordinary');
    f.limits.assertVerified();t.diagnostic(JSON.stringify({classificationStrictStatements:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts)}));
  });
  await t.test('Image, Story and any marker remain refusals without Audio authority',async t=>{
    const f=await fixture(t),{input}=await nativeOriginal(f);
    f.sqlite.exec('CREATE TABLE experience_sponsor_intakes(draft_id TEXT PRIMARY KEY)');
    f.sqlite.prepare('INSERT INTO experience_sponsor_intakes VALUES(?)').run(input.draftId);
    assert.notEqual((await classification.classifySponsorAudioIntakeDraft(readRequest(),f.env,input.draftId)).kind,'ordinary');
    f.sqlite.exec('DROP TABLE experience_sponsor_intakes; CREATE TABLE experience_sponsor_story_intakes(draft_id TEXT PRIMARY KEY NOT NULL) WITHOUT ROWID');
    f.sqlite.prepare('INSERT INTO experience_sponsor_story_intakes VALUES(?)').run(input.draftId);
    assert.notEqual((await classification.classifySponsorAudioIntakeDraft(readRequest(),f.env,input.draftId)).kind,'ordinary');
    f.sqlite.exec('DROP TABLE experience_sponsor_story_intakes');
    f.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,'experience-draft',?,?,?,NULL)")
      .run(input.draftId,actor,JSON.stringify({sponsor_intake:{family:'unknown'}}),new Date(f.now).toISOString(),input.expiresAt);
    assert.notEqual((await classification.classifySponsorAudioIntakeDraft(readRequest(),f.env,input.draftId)).kind,'ordinary');
  });
  await t.test('unsupported indexed schema and pre-aborted Request cannot fall back',async t=>{
    const f=await fixture(t),{input}=await nativeOriginal(f);
    f.sqlite.exec('DROP TABLE experience_sponsor_audio_intakes; CREATE TABLE experience_sponsor_audio_intakes(draft_id TEXT PRIMARY KEY COLLATE NOCASE NOT NULL) WITHOUT ROWID');
    assert.equal((await classification.classifySponsorAudioIntakeDraft(readRequest(),f.env,input.draftId)).kind,'unavailable');
    const controller=new AbortController();controller.abort();assert.equal((await classification.classifySponsorAudioIntakeDraft(readRequest(controller.signal),f.env,input.draftId)).kind,'unavailable');
  });
  await t.test('missing/sparse/inherited-error ACKs and an owned-await abort refuse ordinary',async t=>{
    for(const change of ['sparse','inherited-error','abort']){
      const f=await fixture(t),{input}=await nativeOriginal(f),controller=new AbortController();let invoked=0;
      const restore=wrapDatabase(f,(kind,sql,value)=>{if(kind!=='all')return value;if(change==='sparse')return {...value,results:new Array(1)};
        if(change==='abort'){controller.abort();return value;}const proto={};Object.defineProperty(proto,'error',{get(){invoked++;return 'invalid';}});return Object.assign(Object.create(proto),value);});
      try{assert.equal((await classification.classifySponsorAudioIntakeDraft(readRequest(controller.signal),f.env,input.draftId)).kind,'unavailable');assert.equal(invoked,0);}finally{restore();}
    }
  });
});

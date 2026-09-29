import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture as baseFixture,initialPolicy,FAMILY,OPERATIONS,requestFor,snapshot,count,observeDatabase,assertNoGeneration} from './experience-sponsor-story-intake-native-fixture.mjs';
import {randomUUID} from 'node:crypto';

const {readSponsorStoryIntakePolicy,SPONSOR_STORY_INTAKE_IO_OPERATIONS}=await import('../worker/experience-sponsor-story-intake-policy.ts');
const {prepareSponsorStoryIntakeApproval,approveSponsorStoryIntakePolicy,readApprovedSponsorStoryIntakePolicy}=await import('../worker/experience-sponsor-story-intake-approval.ts');
const fixture=(t,options={})=>baseFixture(t,{...options,native:false});
const oldFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Initial Story policy qualification forbids network');};
after(()=>{globalThis.fetch=oldFetch;assert.equal(networkAttempts,0);});
const proposal=f=>({version:1,family:FAMILY,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,intakePolicy:f.intakePolicy});
const reviewRequest=(f,options={})=>requestFor(f,{action:'prepare-sponsor-story-intake-policy',proposal:proposal(f)},{actorUserId:f.payer,...options});
const commandRequest=(f,command=f.intakeApprovalCommand,options={})=>requestFor(f,command,{actorUserId:f.payer,...options});
const intakeTables=['experience_sponsor_story_intake_policies','experience_sponsor_story_intake_approvals'];

test('additional initial Context policy is closed, finite, copied and deeply frozen',()=>{
  const raw=initialPolicy(1_800_000_000_000),policy=readSponsorStoryIntakePolicy(raw);
  assert.deepEqual(policy,raw);assert.notEqual(policy,raw);
  assert.deepEqual([...SPONSOR_STORY_INTAKE_IO_OPERATIONS],OPERATIONS);
  for(const value of [policy,policy.storage,policy.storage.actor,policy.io,policy.io.operations,
    ...Object.values(policy.io.operations)])assert.equal(Object.isFrozen(value),true);
  raw.storage.maximumDraftBytes=1;assert.equal(policy.storage.maximumDraftBytes,256_000);
});

const invalidPolicies={
  oldGenerationFamily:p=>{p.family='canonical-short-story@1';},
  selectedResultFamily:p=>{p.family='canonical-short-story-io@1';},
  wrongPurpose:p=>{p.purpose='generation';},
  unknownField:p=>{p.provider='openai';},
  missingStorage:p=>{delete p.storage;},
  emptyWindow:p=>{p.storage.expiresAtMs=p.storage.startsAtMs;},
  fractionalStorage:p=>{p.storage.maximumDraftBytes=1.5;},
  unboundedStorage:p=>{p.storage.maximumOriginalBytes=Number.MAX_SAFE_INTEGER;},
  zeroEventBytes:p=>{p.storage.maximumEventBytes=0;},
  draftExceedsCombined:p=>{p.storage.maximumOriginalBytes=p.storage.maximumDraftBytes-1;},
  eventsExceedCombined:p=>{p.storage.maximumEventBytes=p.storage.maximumOriginalBytes+1;},
  windowExceedsLifetime:p=>{p.storage.actor.maximumOperationsPerWindow=p.storage.actor.maximumOperations+1;},
  actorExceedsCampaign:p=>{p.storage.actor.maximumOperations=p.storage.campaign.maximumOperations+1;},
  originalExceedsActorWindow:p=>{p.storage.actor.maximumBytesPerWindow=p.storage.maximumOriginalBytes-1;},
  removedOperation:p=>{delete p.io.operations[OPERATIONS[3]];},
  arbitraryOperation:p=>{p.io.operations['short-story-generate']={maximumBytes:100,deadlineMs:100};},
  unknownOperationField:p=>{p.io.operations[OPERATIONS[0]].refundOnFailure=true;},
  infiniteIo:p=>{p.io.operations[OPERATIONS[0]].maximumBytes=Infinity;},
  zeroDeadline:p=>{p.io.operations[OPERATIONS[0]].deadlineMs=0;},
  excessiveDeadline:p=>{p.io.operations[OPERATIONS[0]].deadlineMs=30_001;},
  operationExceedsWindow:p=>{p.io.operations[OPERATIONS[0]].maximumBytes=p.io.actor.maximumBytesPerWindow+1;},
  actorIoExceedsCampaign:p=>{p.io.actor.maximumRequestsPerWindow=p.io.campaign.maximumRequestsPerWindow+1;},
};
for(const [name,mutate]of Object.entries(invalidPolicies))test(`policy refuses ${name}`,()=>{
  const raw=initialPolicy(1_800_000_000_000);mutate(raw);
  assert.throws(()=>readSponsorStoryIntakePolicy(raw),/sponsor_story_intake_policy_invalid/u);
});

test('policy grammar refuses inherited and accessor values without invoking accessors',()=>{
  let invoked=0;const getter=initialPolicy(1_800_000_000_000);
  Object.defineProperty(getter.storage,'maximumDraftBytes',{enumerable:true,get(){invoked++;return 256_000;}});
  assert.throws(()=>readSponsorStoryIntakePolicy(getter));assert.equal(invoked,0);
  const inherited=initialPolicy(1_800_000_000_000),value=inherited.purpose;delete inherited.purpose;
  Object.setPrototypeOf(inherited,{purpose:value});assert.throws(()=>readSponsorStoryIntakePolicy(inherited));
});

test('actual original payer review and approval retain exact additional terms and replay without storage, IO or money',async t=>{
  const f=await fixture(t,{intakeApproved:false,strict:true}),before=snapshot(f);
  const review=await prepareSponsorStoryIntakeApproval(reviewRequest(f),f.env);
  assert.match(review.termsDigest,/^sha256:[a-f0-9]{64}$/u);assert.deepEqual(snapshot(f),before,'Review is read only');
  const approved=await f.approveIntake();assert.equal(approved.replayed,false);
  for(const table of intakeTables)assert.equal(count(f,table),1);
  const original=snapshot(f),replay=await approveSponsorStoryIntakePolicy(commandRequest(f),f.env);
  assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:false},approved);assert.deepEqual(snapshot(f),original);
  const retained=await readApprovedSponsorStoryIntakePolicy(f.readRequest(),f.env,f.campaignId,f.compiled.policyDigest);
  assert.deepEqual(retained.policy,f.intakePolicy);assert.equal(retained.intakePolicyDigest,approved.intakePolicyDigest);
  assert.equal(retained.reviewReceiptDigest,approved.reviewReceiptDigest);assert.equal(retained.payerUserId,f.payer);
  assert.ok(retained.controlBytes>0);assert.ok(retained.controlBytes<500_000);assert.ok(retained.assertions.length>0);
  assert.deepEqual(snapshot(f),original);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='experience_sponsor_story_intake_attempts'").get().n,0);
  assertNoGeneration(f);f.limits.assertVerified();
  t.diagnostic(JSON.stringify({strictSql:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts),networkAttempts}));
});

for(const stage of ['review','approve'])test(`actual actor/issuer cannot replace original payer at ${stage}`,async t=>{
  const f=await fixture(t,{intakeApproved:stage==='approve'}),before=snapshot(f);
  await assert.rejects(stage==='review'?prepareSponsorStoryIntakeApproval(reviewRequest(f,{actorUserId:f.actor}),f.env):
    approveSponsorStoryIntakePolicy(commandRequest(f,f.intakeApprovalCommand,{actorUserId:f.actor}),f.env));
  assert.deepEqual(snapshot(f),before);assertNoGeneration(f);
});

for(const change of ['digest','confirmation','terms','approvalId'])test(`approval cannot borrow an original review with changed ${change}`,async t=>{
  const f=await fixture(t),command=structuredClone(f.intakeApprovalCommand),before=snapshot(f);
  if(change==='digest')command.reviewedTermsDigest=`sha256:${'0'.repeat(64)}`;
  if(change==='confirmation')command.confirmation='APPROVE_SPONSOR_CAMPAIGN';
  if(change==='terms')command.proposal.intakePolicy.storage.maximumDraftBytes--;
  if(change==='approvalId')command.approvalId+='-other';
  await assert.rejects(approveSponsorStoryIntakePolicy(commandRequest(f,command),f.env));assert.deepEqual(snapshot(f),before);
});

test('additional approval survives a real committed lost acknowledgment only through its exact original proof',async t=>{
  const f=await fixture(t,{intakeApproved:false});let lost=false;
  const observer=observeDatabase(f,{after(entry){
    if(!lost&&entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO (?:main\.)?experience_sponsor_story_intake_approvals\b/u.test(part.sql))){lost=true;throw Error('fixture lost additional approval ACK');}
  }});
  const approved=await f.approveIntake();assert.equal(lost,true);assert.equal(approved.replayed,true);
  for(const table of intakeTables)assert.equal(count(f,table),1);
  const before=snapshot(f);await approveSponsorStoryIntakePolicy(commandRequest(f),f.env);assert.deepEqual(snapshot(f),before);
  observer.restore();assertNoGeneration(f);
});

for(const table of intakeTables)test(`${table} resists UPDATE, DELETE and REPLACE`,async t=>{
  const f=await fixture(t),before=snapshot(f),columns=f.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name);
  assert.throws(()=>f.sqlite.exec(`UPDATE ${table} SET campaign_id=campaign_id`),/immutable/u);
  assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`),/immutable/u);
  assert.throws(()=>f.sqlite.exec(`INSERT OR REPLACE INTO ${table}(${columns.join(',')}) SELECT ${columns.join(',')} FROM ${table}`));
  assert.deepEqual(snapshot(f),before);
});

for(const mutation of ['database','headers','abort'])test(`additional review refuses ${mutation} drift after actual database await`,async t=>{
  const f=await fixture(t,{intakeApproved:false}),controller=new AbortController();let request,fired=false;
  const observer=observeDatabase(f,{after(){if(!fired){fired=true;
    if(mutation==='database')f.env.DB={...f.env.DB};
    if(mutation==='headers')request.headers.set('oai-authenticated-user-id',f.actor);
    if(mutation==='abort')controller.abort();
  }}});
  request=reviewRequest(f,{signal:controller.signal});const before=snapshot(f);
  await assert.rejects(prepareSponsorStoryIntakeApproval(request,f.env));assert.equal(fired,true);assert.deepEqual(snapshot(f),before);observer.restore();
});

test('retained additional allocation provenance remains source-free after original campaign revocation',async t=>{
  const f=await fixture(t);
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
  const before=snapshot(f),observer=observeDatabase(f);
  const retained=await readApprovedSponsorStoryIntakePolicy(f.readRequest(),f.env,f.campaignId,f.compiled.policyDigest);
  assert.deepEqual(retained.policy,f.intakePolicy);assert.deepEqual(snapshot(f),before);
  assert.ok(observer.sql().every(sql=>!sql.includes('event_private_payloads')&&!/\bcontent\b/u.test(sql)));
  observer.restore();
});

/** Exercises only the pure resource transaction contract with real fixture payer
 * approval. It does not call initial storage or claim a native private draft. */
async function resourceInput(f){
  const {digest,canonicalJson}=await import('../src/experiences/compiler.ts');
  const request=structuredClone(f.nativeRequest);request.intentId=randomUUID();
  const native=await f.buildPlan(request),{draftHash:_hash,...nativeBase}=native;
  const receiptId=`sponsor-story-intake-${(await digest({campaignId:f.campaignId,actor:f.actor,intent:request.intentId})).slice(7)}`;
  const base=JSON.parse(canonicalJson({...nativeBase,sponsor_intake:{version:1,family:FAMILY,receiptId}}));
  const plan=JSON.parse(canonicalJson({...base,draftHash:await digest(base)})),content=canonicalJson(plan),payloads=plan.events.map(event=>JSON.stringify(event.payload));
  const draftBytes=Buffer.byteLength(content),eventBytes=payloads.reduce((sum,payload)=>sum+Buffer.byteLength(payload),0);
  return {policy:f.intakePolicy,receiptId,allocationId:`${receiptId}:storage`,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,
    intakePolicyDigest:f.intakeApproval.intakePolicyDigest,intakeApprovalId:f.intakeApproval.approvalId,
    actorUserId:f.actor,sessionDigest:await digest({synthetic:'resource-plan-session'}),nativeIntentId:request.intentId,
    draftId:plan.draftId,projectId:plan.projectId,documentId:plan.documentId,draftHash:plan.draftHash,
    bodyDigest:await digest({action:'prepare-sponsored-short-story-draft',campaignId:f.campaignId,request}),
    contentDigest:await digest(content),sourceDigest:await digest(plan.events),eventPayloadDigest:await digest(payloads),
    eventCount:plan.events.length,draftBytes,eventBytes,totalBytes:draftBytes+eventBytes,expiresAt:new Date(f.now+86_400_000).toISOString()};
}
async function resourceBatch(f,input){
  const {prepareSponsorStoryIntakeStorage}=await import('../worker/experience-sponsor-story-intake-resources.ts');
  const planned=await prepareSponsorStoryIntakeStorage(input);
  return f.env.DB.batch(planned.statements.map(statement=>f.env.DB.prepare(statement.sql).bind(...statement.bindings)));
}

test('resource regression: TEMP scratch shadow cannot bypass a false main allocation quota',async t=>{
  const f=await fixture(t,{intakeApproved:false,strict:true});
  Object.assign(f.intakePolicy.storage.actor,{maximumOperations:1,maximumOperationsPerWindow:1});await f.approveIntake();
  await resourceBatch(f,await resourceInput(f));assert.equal(count(f,'experience_sponsor_story_intake_allocations'),1);
  f.sqlite.exec('CREATE TEMP TABLE output_atomic_assertions(token TEXT PRIMARY KEY NOT NULL,passed INTEGER NOT NULL)');
  const before=snapshot(f),input=await resourceInput(f);
  const error=await resourceBatch(f,input).then(()=>null,cause=>cause);
  t.diagnostic(JSON.stringify({regression:'TEMP scratch shadow',mainAllocations:count(f,'experience_sponsor_story_intake_allocations'),
    mainSidecars:count(f,'experience_sponsor_story_intakes'),quota:1,error:error?.message??null,networkAttempts}));
  assert.ok(error instanceof Error,'Exact main-table quota failure must roll back despite a TEMP name shadow');
  assert.match(error.message,/CHECK constraint failed/u);
  assert.deepEqual(snapshot(f),before);assert.equal(count(f,'experience_sponsor_story_intakes'),1);assertNoGeneration(f);
  f.limits.assertVerified();t.diagnostic(JSON.stringify({strictResourceSql:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts)}));
});

test('resource regression: a one-millisecond rolling window still counts the transaction original at admission time',async t=>{
  const f=await fixture(t,{intakeApproved:false});f.intakePolicy.storage.windowMs=1;
  for(const scope of ['actor','campaign'])Object.assign(f.intakePolicy.storage[scope],{maximumOperations:2,maximumOperationsPerWindow:1});
  await f.approveIntake();const instant=f.now+1000;let calls=0,crossing=false;
  f.sqlite.function('julianday',{varargs:true},()=>{
    calls++;const at=instant+(crossing&&calls>3?10:0);return 2440587.5+at/86_400_000;
  });
  await resourceBatch(f,await resourceInput(f));const before=snapshot(f),input=await resourceInput(f);calls=0;crossing=true;
  const error=await resourceBatch(f,input).then(()=>null,cause=>cause);
  t.diagnostic(JSON.stringify({regression:'1ms admission window',actualClockCalls:calls,
    allocations:f.sqlite.prepare('SELECT recorded_at_ms FROM experience_sponsor_story_intake_allocations').all(),clockAdvanceAfterThirdCallMs:10,error:error?.message??null,networkAttempts}));
  assert.ok(calls>=3,'Actual SQL evaluated both initial time gates and its inserted admission timestamp');
  assert.ok(error instanceof Error,'The current insertion must not age out of its own final quota proof');
  assert.match(error.message,/CHECK constraint failed/u);
  assert.deepEqual(snapshot(f),before);assert.equal(count(f,'experience_sponsor_story_intake_allocations'),1);assertNoGeneration(f);
});

for(const mutation of ['database','headers','abort'])test(`approval final-resume regression: ${mutation} drift after real dense ACK validation refuses export`,async t=>{
  const f=await fixture(t,{intakeApproved:false}),controller=new AbortController();let request,fired=false,scheduled=false;
  const observer=observeDatabase(f,{transform(entry,result){
    if(fired||entry.kind!=='batch'||!entry.statements.every(part=>/^(?:INSERT INTO (?:main\.)?output_atomic_assertions|DELETE FROM (?:main\.)?output_atomic_assertions)/u.test(part.sql)))return result;
    fired=true;
    return new Proxy(result,{ownKeys(target){
      if(!scheduled){scheduled=true;queueMicrotask(()=>{
        if(mutation==='database')f.env.DB={...f.env.DB};
        if(mutation==='headers')request.headers.set('oai-authenticated-user-id',f.actor);
        if(mutation==='abort')controller.abort();
      });}
      return Reflect.ownKeys(target);
    }});
  }});
  request=reviewRequest(f,{signal:controller.signal});const before=snapshot(f);
  const error=await prepareSponsorStoryIntakeApproval(request,f.env).then(()=>null,cause=>cause);
  assert.equal(fired,true);assert.equal(scheduled,true);assert.deepEqual(snapshot(f),before);
  t.diagnostic(JSON.stringify({regression:'approval final helper resume',mutation,fired,scheduled,
    changedDatabase:f.env.DB!==observer.database,requestActor:request.headers.get('oai-authenticated-user-id'),aborted:request.signal.aborted,error:error?.message??null,networkAttempts}));
  if(mutation==='database')assert.notEqual(f.env.DB,observer.database);
  if(mutation==='headers')assert.equal(request.headers.get('oai-authenticated-user-id'),f.actor);
  if(mutation==='abort')assert.equal(request.signal.aborted,true);
  observer.restore();assertNoGeneration(f);
  assert.ok(error instanceof Error,'The exported review must recheck its request after helper Promise resolution');
  assert.equal(error.message,'sponsor_story_intake_authority_changed');
});

test('approval export-resume regression: actual replay refuses DB drift after inner finish check and before exported adoption',async t=>{
  const f=await fixture(t);let ackSeen=false,firstMicrotask=false,finishCheckObserved=false,mutated=false,fired=false;
  const observer=observeDatabase(f,{transform(entry,result){
    if(fired||entry.kind!=='batch'||!entry.statements.every(part=>/^(?:INSERT INTO (?:main\.)?output_atomic_assertions|DELETE FROM (?:main\.)?output_atomic_assertions)/u.test(part.sql)))return result;
    fired=true;
    return new Proxy(result,{ownKeys(target){
      if(!ackSeen){ackSeen=true;queueMicrotask(()=>{firstMicrotask=true;queueMicrotask(()=>{
        mutated=true;f.env.DB={...f.env.DB};
      });});}
      return Reflect.ownKeys(target);
    }});
  }});
  const request=commandRequest(f),originalHeaders=request.headers;
  // Observe the actual finish check without altering any returned Request data.
  // The second microtask mutates only after this getter proves that check ran.
  Object.defineProperty(request,'headers',{get(){
    if(ackSeen&&firstMicrotask&&!mutated)finishCheckObserved=true;
    return originalHeaders;
  }});
  const before=snapshot(f),outcome=await approveSponsorStoryIntakePolicy(request,f.env).then(result=>({result}),error=>({error}));
  t.diagnostic(JSON.stringify({regression:'approval exported adoption',fired,ackSeen,firstMicrotask,finishCheckObserved,mutated,
    replayReturned:outcome.result?.replayed??null,error:outcome.error?.message??null,networkAttempts}));
  assert.equal(fired,true);assert.equal(finishCheckObserved,true);assert.equal(mutated,true);assert.notEqual(f.env.DB,observer.database);
  assert.deepEqual(snapshot(f),before);observer.restore();assertNoGeneration(f);
  assert.ok(outcome.error instanceof Error,'An inner final check must not replace the exported approval continuation check');
  assert.equal(outcome.error.message,'sponsor_story_intake_authority_changed');
});

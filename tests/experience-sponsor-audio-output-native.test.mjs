import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture as intakeFixture,responseBody,rows,snapshot,observeDatabase,headersFor,requestFor,databaseClock,queryLimits} from './experience-sponsor-audio-intake-native-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{prepareSponsorAudioDraft,commitSponsorAudioDraft},{canonicalJson},{receiptPrefix},outputPolicy,outputApproval,outputAttempts]=await Promise.all([
  import('../worker/experience-sponsor-audio-intake.ts'),import('../src/experiences/compiler.ts'),import('../src/experiences/intake.ts'),
  import('../worker/experience-sponsor-audio-output-policy.ts'),import('../worker/experience-sponsor-audio-output-approval.ts'),
  import('../worker/experience-sponsor-audio-output-attempts.ts')]);
const monetaryTables=['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters',
  'output_execution_grants','output_operation_slots','document_jobs','output_provider_calls','experience_sponsor_grants',
  'experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs'];
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Initial native Audio output qualification forbids provider/network egress');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
function readPolicy(now){
  const allowance={maximumRequestsPerWindow:100,maximumBytesPerWindow:800_000_000,maximumQueriesPerWindow:1_000_000,maximumRowsPerWindow:10_000_000};
  return {version:1,family:'canonical-audio-output-read@1',purpose:'native-output-continuation',startsAtMs:now-60000,expiresAtMs:now+3600000,windowMs:60000,
    operations:Object.fromEntries(['audio-output-state','audio-output-prepare','audio-output-review','audio-output-authorize']
      .map(operation=>[operation,{maximumBytes:8_000_000,deadlineMs:30000,maximumQueries:10000,maximumRows:100000}])),
    actor:{...allowance},campaign:{...allowance}};
}
function assertNoExecution(f){
  for(const [table,expected]of Object.entries(f.financialBefore))assert.deepEqual(rows(f,table),expected,table);
  assert.deepEqual(f.effects,{media:0,assets:0});assert.equal(f.detached,0);assert.equal(f.media.size,0);assert.equal(networkAttempts,0);
}
async function outputFixture(t,{detail='',strict=false,configurePolicy}={}){
  // Reuse accepted B at its default real registration. Its dormant transition
  // controls are never changed by this suite. Preserve B's genuine stored
  // plan, paired allocation/receipt, native actor digest and original events.
  const f=await intakeFixture(t,{detail,strict:false});
  f.intake=await responseBody(await prepareSponsorAudioDraft(f.prepareRequest(),f.env));
  f.plan=f.intake.plan;assert.equal(f.plan.events.length,detail?6:5);assert.equal(f.intake.status,'prepared');
  f.committed=await responseBody(await commitSponsorAudioDraft(f.commitRequest(f.plan),f.env));
  assert.equal(f.committed.status,'complete');assert.equal(f.committed.appended.length,f.plan.events.length);
  for(const schema of [outputPolicy.SPONSOR_AUDIO_OUTPUT_READ_POLICY_SCHEMA,outputApproval.SPONSOR_AUDIO_OUTPUT_READ_APPROVAL_SCHEMA,
    outputAttempts.SPONSOR_AUDIO_OUTPUT_READ_ATTEMPTS_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  const now=Number(f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now);f.outputPolicy=readPolicy(now);configurePolicy?.(f.outputPolicy);
  const proposal={version:1,family:'canonical-audio-output-read@1',campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy:f.outputPolicy};
  const review=await outputApproval.prepareSponsorAudioOutputReadApproval(requestFor(f,{action:'prepare-sponsor-audio-output-read-policy',proposal},{actorUserId:f.payer}),f.env);
  f.outputApproval=await outputApproval.approveSponsorAudioOutputReadPolicy(requestFor(f,{action:'approve-sponsor-audio-output-read-policy',
    approvalId:'fixture-native-audio-output-read',proposal,reviewedTermsDigest:review.termsDigest,confirmation:'APPROVE_SPONSOR_AUDIO_OUTPUT_READ_POLICY'},{actorUserId:f.payer}),f.env);
  f.outputRequest=(operation='audio-output-state',{body,signal,headers={},draftId=f.plan.draftId}={})=>new Request(`http://localhost/api/experiences/drafts/${draftId}/output${operation==='audio-output-prepare'?'/prepare':''}`,{
    method:operation==='audio-output-state'?'GET':'POST',headers:{...headersFor(f.actor),...(operation==='audio-output-state'?{}:{'content-type':'application/json'}),...headers},...(signal?{signal}:{}),
    ...(operation==='audio-output-state'?{}:{body:JSON.stringify(body??{draftHash:f.plan.draftHash,explicitRequirementsConfirmation:true})})});
  f.detached=0;f.executionContext={waitUntil(){f.detached++;throw Error('Initial native Audio output cannot detach work');}};
  const existing=new Set(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
  f.financialBefore=Object.fromEntries(monetaryTables.filter(table=>existing.has(table)).map(table=>[table,rows(f,table)]));
  t.after(()=>{assert.deepEqual(f.effects,{media:0,assets:0});assert.equal(f.detached,0);assert.equal(networkAttempts,0);});
  if(strict){f.limits=enforceD1ExpressionDepth(f,{queryLimits});t.after(()=>f.limits.restore());}
  return f;
}
async function originalBudget(f,request=f.outputRequest(),operation='audio-output-state'){
  const attempt=await outputAttempts.reserveSponsorAudioOutputReadAttempt(request,f.env,{operation,draftId:f.plan.draftId});
  const budget=await outputAttempts.takeSponsorAudioOutputReadAttempt(attempt,request,f.env);
  const view=outputAttempts.requireSponsorAudioOutputReadBudget(budget,request,f.env);
  assert.equal(view.original.draftId,f.plan.draftId);assert.equal(view.principal.userId,f.actor);
  assert.equal(view.authenticated.response,null);assert.equal(view.authenticated.impersonation,null);
  assert.equal(view.authenticated.user,view.principal);assert.equal(view.authenticated.principal,view.principal);
  return {request,attempt,budget,view};
}
function originalEvents(f){
  return f.sqlite.prepare(`SELECT receipt.client_event_id,event.type,event.event_id,event.sequence,secret.private_json
    FROM event_client_receipts receipt JOIN events event ON event.event_id=receipt.event_id
    JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE receipt.stream_id=? AND substr(receipt.client_event_id,1,?)=? ORDER BY event.sequence`)
    .all(f.stream,receiptPrefix(f.plan.draftId).length,receiptPrefix(f.plan.draftId)).map(row=>({...row}));
}
function assertOriginalIntake(f){
  const actual=originalEvents(f);assert.equal(actual.length,f.plan.events.length);
  for(const [index,event]of f.plan.events.entries()){
    assert.equal(actual[index].type,event.type);assert.equal(actual[index].client_event_id,event.payload.client_event_id);
    assert.equal(actual[index].private_json,JSON.stringify(event.payload));
  }
  const draft=f.sqlite.prepare('SELECT content,expires_at FROM private_content WHERE content_id=?').get(f.plan.draftId);
  assert.equal(draft.content,canonicalJson(f.plan));assert.equal(draft.expires_at,f.intake.expiresAt);return actual;
}

for(const field of ['response','user','principal','impersonation','nested capabilities','nested descriptor'])test(`Audio native output owner rejects altered genuine authenticated ${field}`,async t=>{
  const f=await outputFixture(t),{view,budget,request}=await originalBudget(f),before=snapshot(f),auth=view.authenticated;
  let restore;
  if(field==='nested capabilities'){
    const original=auth.user.access.capabilities;auth.user.access.capabilities=['foreign-permission'];restore=()=>{auth.user.access.capabilities=original;};
  }else if(field==='nested descriptor'){
    const original=Object.getOwnPropertyDescriptor(auth.user,'role');assert.ok(original.configurable);assert.equal(original.writable,true);
    Object.defineProperty(auth.user,'role',{...original,writable:false});restore=()=>{Object.defineProperty(auth.user,'role',original);};
  }else {
    const original=auth[field];auth[field]=field==='response'?new Response('fixture changed authentication'):field==='impersonation'?{}:{...original};
    restore=()=>{auth[field]=original;};
  }
  let refusedChanged=false;try{view.current();}catch{refusedChanged=true;}finally{restore();}
  assert.equal(refusedChanged,true);assert.throws(()=>view.current());
  assert.throws(()=>outputAttempts.requireSponsorAudioOutputReadBudget(budget,request,f.env));assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});
// The owner is opened from the same actual request and taken C allowance. Every
// native read uses its qualified environment; no auth, plan or receipt is faked.
async function nativeOwner(f,{request=f.outputRequest(),operation='audio-output-state'}={}){
  const [{openSponsorAudioOutputReads,requireSponsorAudioOutputReads,closeSponsorAudioOutputReads},native,
    {retainedGuard},{commitAtomicIntake}]=await Promise.all([
    import('../worker/experience-sponsor-audio-output-reads.ts'),import('../worker/experience-sponsor-audio-output-native.ts'),
    import('../worker/experience-intake-read.ts'),import('../worker/project-intake.ts')]);
  const actual=await originalBudget(f,request,operation),owner=await openSponsorAudioOutputReads(request,f.env,actual.budget);
  const view=requireSponsorAudioOutputReads(owner,request);
  return {...actual,owner,native,view,requireOwner:requireSponsorAudioOutputReads,close:()=>closeSponsorAudioOutputReads(owner),retainedGuard,commitAtomicIntake};
}
async function sealOriginal(f,owned){
  const {native,owner,request,view}=owned;
  const saved=await native.readSponsorAudioOutputNativeDraft(owner,request,view.nativeEnv);
  const intake={projectId:saved.plan.projectId,documentId:saved.plan.documentId,events:structuredClone(saved.plan.events)};
  const options={receiptPrefix:receiptPrefix(saved.plan.draftId),clientId:'web:experience-intake',correlationPrefix:'experience-intake:',
    guard:owned.retainedGuard(view.auth,saved.plan,saved.content)};
  const sealed=native.sealSponsorAudioOutputNativeReceiptCheck(owner,request,view.nativeEnv,view.auth,intake,options);
  return {saved,intake,options,sealed};
}
for(const detail of ['', 'An exact second authored Context block.'])test(`Audio native ${detail?'six':'five'}-event original draft and check-only receipt preserve genuine bodies`,async t=>{
  const f=await outputFixture(t,{detail}),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const {saved,intake,sealed}=await sealOriginal(f,owned),before=snapshot(f),calls=observed.records.length;
  assert.deepEqual(saved.plan,f.plan);assert.equal(saved.content,canonicalJson(f.plan));assert.equal(saved.expiresAt,f.intake.expiresAt);
  assert.ok(Object.isFrozen(saved));assert.ok(Object.isFrozen(saved.plan));assert.ok(Object.isFrozen(saved.plan.events));
  const receipt=await responseBody(await owned.commitAtomicIntake(owned.view.nativeEnv,owned.view.auth,intake,'check',sealed));
  assert.equal(receipt.status,'complete');assert.equal(receipt.documentId,f.plan.documentId);
  assert.deepEqual(receipt.appended,f.committed.appended);assert.equal(receipt.head,f.committed.head);assert.deepEqual(receipt.rejected,[]);
  assert.ok(observed.records.length>calls);assert.deepEqual(snapshot(f),before);assertOriginalIntake(f);
  const proofs=owned.native.sponsorAudioOutputNativeProofs(owned.owner);assert.ok(proofs.length>0);assert.ok(Object.isFrozen(proofs));
  const after=observed.records.length;
  await assert.rejects(()=>owned.commitAtomicIntake(owned.view.nativeEnv,owned.view.auth,intake,'check',sealed));
  assert.equal(observed.records.length,after,'one-use check seal refuses before another native query');assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

test('Audio native check-only receipt token rejects commit before any read or append',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const {intake,sealed}=await sealOriginal(f,owned),before=snapshot(f),calls=observed.records.length;
  await assert.rejects(()=>owned.commitAtomicIntake(owned.view.nativeEnv,owned.view.auth,intake,'commit',sealed),/sponsor_audio_output_native_check_required/u);
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

for(const alteration of ['forged owner','different Request','original environment','copied qualified environment'])test(`Audio native draft rejects ${alteration} without dispatch`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const before=snapshot(f),calls=observed.records.length;
  await assert.rejects(()=>owned.native.readSponsorAudioOutputNativeDraft(alteration==='forged owner'?Object.freeze({}):owned.owner,
    alteration==='different Request'?f.outputRequest():owned.request,
    alteration==='original environment'?f.env:alteration==='copied qualified environment'?{...owned.view.nativeEnv}:owned.view.nativeEnv));
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

for(const alteration of ['auth clone','intake body','retained guard','extra options','getter options'])test(`Audio native receipt seal rejects ${alteration} without dispatch`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const original=await sealOriginal(f,owned),intake=structuredClone(original.intake),options=structuredClone(original.options),before=snapshot(f),calls=observed.records.length;
  let getterCalls=0,auth=owned.view.auth;
  if(alteration==='auth clone')auth={...auth};
  if(alteration==='intake body')intake.events[0].payload.name='different original';
  if(alteration==='retained guard')options.guard={sql:'1',bindings:[]};
  if(alteration==='extra options')options.expectedHead=f.committed.head;
  if(alteration==='getter options')Object.defineProperty(options,'clientId',{enumerable:true,get(){getterCalls++;return 'web:experience-intake';}});
  assert.throws(()=>owned.native.sealSponsorAudioOutputNativeReceiptCheck(owned.owner,owned.request,owned.view.nativeEnv,auth,intake,options));
  assert.equal(getterCalls,0);assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

for(const alteration of ['intake clone','auth clone','options clone','forged seal'])test(`Audio native receipt reader rejects ${alteration} before dispatch`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const {intake,sealed}=await sealOriginal(f,owned),before=snapshot(f),calls=observed.records.length;
  await assert.rejects(()=>owned.commitAtomicIntake(owned.view.nativeEnv,alteration==='auth clone'?{...owned.view.auth}:owned.view.auth,
    alteration==='intake clone'?structuredClone(intake):intake,'check',
    alteration==='options clone'?{...sealed}:alteration==='forged seal'?{...sealed,sponsorAudioOutputReceiptCheck:Object.freeze({})}:sealed));
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

for(const alteration of ['draft body','draft redaction','draft missing','draft owner','original private body','original receipt'])test(`Audio native original custody refuses current ${alteration} drift`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const first=await sealOriginal(f,owned);
  await responseBody(await owned.commitAtomicIntake(owned.view.nativeEnv,owned.view.auth,first.intake,'check',first.sealed));
  const event=originalEvents(f).at(-1);
  let mutation;
  if(alteration==='draft body')mutation=f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('{}',f.plan.draftId);
  if(alteration==='draft redaction')mutation=f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(),f.plan.draftId);
  if(alteration==='draft missing')mutation=f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(f.plan.draftId);
  if(alteration==='draft owner')mutation=f.sqlite.prepare('UPDATE private_content SET owner_id=? WHERE content_id=?').run(f.payer,f.plan.draftId);
  if(alteration==='original private body')mutation=f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run('{}',event.event_id);
  if(alteration==='original receipt')mutation=f.sqlite.prepare('DELETE FROM event_client_receipts WHERE stream_id=? AND client_event_id=?').run(f.stream,event.client_event_id);
  assert.equal(mutation.changes,1);const changed=snapshot(f),start=observed.records.length;
  await assert.rejects(()=>owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv));
  const reads=observed.records.slice(start).filter(entry=>entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT content,expires_at FROM private_content WHERE content_id=/u.test(part.sql)));
  assert.equal(reads.length,1);assert.equal(reads[0].error,undefined);assert.equal(reads[0].result.results[0].authorized,0);assert.equal(reads[0].result.results[0].body,null);
  assert.deepEqual(snapshot(f),changed);assertNoExecution(f);
});

test('Audio native receipt seal freezes the exact nested intake before the awaited original read',async t=>{
  const f=await outputFixture(t),owned=await nativeOwner(f);t.after(owned.close);
  const {intake,sealed}=await sealOriginal(f,owned);let getterCalls=0;
  assert.ok(Object.isFrozen(intake));assert.ok(Object.isFrozen(intake.events));assert.ok(Object.isFrozen(intake.events[0].payload));
  assert.throws(()=>{intake.events[0].payload.name='changed';},TypeError);
  assert.throws(()=>Object.defineProperty(intake.events[0],'payload',{get(){getterCalls++;return {};}}),TypeError);
  const before=snapshot(f),receipt=await responseBody(await owned.commitAtomicIntake(owned.view.nativeEnv,owned.view.auth,intake,'check',sealed));
  assert.equal(getterCalls,0);assert.deepEqual(receipt.appended,f.committed.appended);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

test('Audio native draft refuses an orphan Story intake declaration before returning its body',async t=>{
  const f=await outputFixture(t);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name IN('experience_sponsor_story_intakes','experience_sponsor_story_intake_allocations')").get().n,0);
  f.sqlite.exec('CREATE TABLE experience_sponsor_story_intake_orphan_fixture(value TEXT)');
  const observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);const before=snapshot(f),start=observed.records.length;
  await assert.rejects(()=>owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv));
  assert.ok(observed.records.length>start);assert.equal(observed.records.slice(start).some(entry=>entry.statements.some(part=>part.sql.includes('SELECT content,expires_at FROM private_content'))),false);
  assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

for(const dimension of ['bytes','queries','rows'])test(`Audio native owner keeps the original ${dimension} allowance after opening`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const original=outputAttempts.requireSponsorAudioOutputReadBudget(owned.budget,owned.request,f.env);
  const left=original.remaining(),usage={bytes:0,queries:0,rows:0};usage[dimension]=left[dimension];original.account(usage);
  const before=snapshot(f),calls=observed.records.length;
  await assert.rejects(()=>owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv));
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

for(const kind of ['raw descriptor','forged token'])test(`Audio native transport rejects a ${kind} before database dispatch`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  await owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv);
  const before=snapshot(f),calls=observed.records.length;
  const input=kind==='raw descriptor'?{sql:'SELECT 1 AS value',bindings:[],columns:['value'],maximumRows:1,assertions:[{sql:'1',bindings:[]}],invalidRow:"typeof(row.value)<>'integer' OR row.value<>1"}:Object.freeze({});
  await assert.rejects(async()=>owned.view.readRows(input));
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

test('Audio native validated plan cannot be replaced by a canonical-equal caller clone',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const saved=await owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv);
  const {setSponsorAudioOutputNativePlan}=await import('../worker/experience-sponsor-audio-output-reads.ts');
  assert.equal(owned.native.isSponsorAudioOutputNativePlan(owned.owner,saved.plan),true);
  setSponsorAudioOutputNativePlan(owned.owner,saved.plan);
  const clone=structuredClone(saved.plan),before=snapshot(f),calls=observed.records.length;
  assert.equal(canonicalJson(clone),canonicalJson(saved.plan));assert.equal(owned.native.isSponsorAudioOutputNativePlan(owned.owner,clone),false);
  assert.throws(()=>setSponsorAudioOutputNativePlan(owned.owner,clone));
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

test('Audio native owner cannot gain custody from a caller supplied true proof',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const original=await sealOriginal(f,owned);
  await responseBody(await owned.commitAtomicIntake(owned.view.nativeEnv,owned.view.auth,original.intake,'check',original.sealed));
  const {retainSponsorAudioOutputProofs}=await import('../worker/experience-sponsor-audio-output-reads.ts');
  const proof=Object.freeze({sql:'1',bindings:Object.freeze([])}),before=snapshot(f),calls=observed.records.length;
  assert.equal(owned.native.isSponsorAudioOutputNativeProof(owned.owner,proof),false);
  assert.throws(()=>retainSponsorAudioOutputProofs(owned.owner,[proof]));
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

test('Audio native pending original read cancels before disclosure on the same genuine signal',{timeout:10000},async t=>{
  const f=await outputFixture(t),controller=new AbortController(),request=f.outputRequest('audio-output-state',{signal:controller.signal});
  let release,reached;const blocked=new Promise(resolve=>{release=resolve;}),atBody=new Promise(resolve=>{reached=resolve;});
  let held=0;const observed=observeDatabase(f,{async after(entry){
    if(!held&&entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT content,expires_at FROM private_content WHERE content_id=/u.test(part.sql))){held++;reached();await blocked;}
  }});
  const owned=await nativeOwner(f,{request});t.after(owned.close);const before=snapshot(f);
  let settled=false;
  const pending=owned.native.readSponsorAudioOutputNativeDraft(owned.owner,request,owned.view.nativeEnv).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  let timer,beforeTimer;
  try{
    const phase=await Promise.race([atBody.then(()=>({atBody:true})),pending,new Promise(resolve=>{beforeTimer=setTimeout(()=>resolve({beforeTimedOut:true}),3000);})]);
    clearTimeout(beforeTimer);assert.equal(phase.atBody,true,phase.error?.stack);assert.equal(held,1);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'actual body read remains pending until native abort');
    const calls=observed.records.length;
    controller.abort();
    const result=await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve({timedOut:true}),1000);})]);
    assert.equal(result.timedOut,undefined);assert.ok(result.error instanceof Error);assert.equal(result.value,undefined);
    assert.throws(()=>owned.requireOwner(owned.owner,request));assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);
  }finally{clearTimeout(timer);clearTimeout(beforeTimer);release();await pending;}
  assertNoExecution(f);
});

test('Audio native original read rejects a getter-bearing actual database acknowledgement without invoking it',async t=>{
  const f=await outputFixture(t);let changed=0,getterCalls=0;
  observeDatabase(f,{transform(entry,result){
    if(!changed&&entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT content,expires_at FROM private_content WHERE content_id=/u.test(part.sql))){
      changed++;Object.defineProperty(result,'success',{configurable:true,enumerable:true,get(){getterCalls++;return true;}});
    }
    return result;
  }});
  const owned=await nativeOwner(f);t.after(owned.close);const before=snapshot(f);
  await assert.rejects(()=>owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv));
  assert.equal(changed,1);assert.equal(getterCalls,0);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

for(const corruption of ['BLOB body','oversized text body'])test(`Audio native bounded draft read refuses ${corruption} before private transfer`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const marker='OVERSIZED_PRIVATE_NATIVE_AUDIO_BODY';
  if(corruption==='BLOB body'){
    assert.equal(f.sqlite.prepare('UPDATE private_content SET content=CAST(content AS BLOB) WHERE content_id=?').run(f.plan.draftId).changes,1);
    const type=f.sqlite.prepare('SELECT typeof(content) AS type,length(content) AS length FROM private_content WHERE content_id=?').get(f.plan.draftId);
    assert.equal(type.type,'blob');assert.ok(type.length>0&&type.length<=65536);assert.equal(type.length,Buffer.byteLength(canonicalJson(f.plan)));
  }else assert.equal(f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(marker.repeat(2200),f.plan.draftId).changes,1);
  const before=snapshot(f),start=observed.records.length;
  await assert.rejects(()=>owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv));
  const reads=observed.records.slice(start).filter(entry=>entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT content,expires_at FROM private_content WHERE content_id=/u.test(part.sql)));
  assert.equal(reads.length,1);assert.equal(reads[0].error,undefined);assert.ok(reads[0].result.results[0].body===null||reads[0].result.results[0].body==='[]');
  assert.equal(JSON.stringify(reads[0].result).includes(marker),false);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});


test('Audio native fresh owner cannot initialize identity from a cloned genuine stored plan',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const {setSponsorAudioOutputNativePlan}=await import('../worker/experience-sponsor-audio-output-reads.ts');
  const clone=structuredClone(f.plan),before=snapshot(f),calls=observed.records.length;
  assert.equal(canonicalJson(clone),canonicalJson(f.plan));assert.equal(owned.native.isSponsorAudioOutputNativePlan(owned.owner,clone),false);
  assert.throws(()=>setSponsorAudioOutputNativePlan(owned.owner,clone));
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});


test('Audio native genuine original receipt read refuses 8192 remaining bytes before dispatch',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const {intake,sealed}=await sealOriginal(f,owned),remaining=owned.view.remaining();assert.ok(remaining.bytes>8192);
  const budget=outputAttempts.requireSponsorAudioOutputReadBudget(owned.budget,owned.request,f.env);
  budget.account({bytes:remaining.bytes-8192,queries:0,rows:0});assert.equal(budget.remaining().bytes,8192);
  const before=snapshot(f),calls=observed.records.length;
  await assert.rejects(()=>owned.commitAtomicIntake(owned.view.nativeEnv,owned.view.auth,intake,'check',sealed));
  assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

test('Audio native simultaneous accepted reads retire one owner without a second dispatch',async t=>{
  const f=await outputFixture(t);let release,reached,held=0,armed=false;
  const blocked=new Promise(resolve=>{release=resolve;}),atRead=new Promise(resolve=>{reached=resolve;});
  const observed=observeDatabase(f,{async after(entry){
    if(armed&&!held&&entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT COALESCE\(MAX\(sequence\),0\) AS head FROM events WHERE stream_id=/u.test(part.sql))){held++;reached();await blocked;}
  }});
  const owned=await nativeOwner(f);t.after(owned.close);const {intake,sealed}=await sealOriginal(f,owned);
  assert.equal((await responseBody(await owned.commitAtomicIntake(owned.view.nativeEnv,owned.view.auth,intake,'check',sealed))).status,'complete');
  const database=owned.view.nativeEnv.DB,sql='SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?';
  const before=snapshot(f);armed=true;let settled=false;
  const pending=database.prepare(sql).bind(f.stream).first().then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  let timer;
  try{
    const phase=await Promise.race([atRead.then(()=>({atRead:true})),pending,new Promise(resolve=>{timer=setTimeout(()=>resolve({timedOut:true}),3000);})]);
    clearTimeout(timer);assert.equal(phase.atRead,true,phase.error?.stack);assert.equal(held,1);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
    const calls=observed.records.length;
    await assert.rejects(()=>database.prepare(sql).bind(f.stream).first(),/sponsor_audio_output_parallel_read_refused/u);
    assert.equal(observed.records.length,calls);assert.throws(()=>owned.requireOwner(owned.owner));
    release();const result=await pending;assert.ok(result.error instanceof Error);assert.equal(result.value,undefined);assert.deepEqual(snapshot(f),before);
  }finally{clearTimeout(timer);release();await pending;}
  assertNoExecution(f);
});


test('Audio native observed original database replacement remains terminal after exact restoration',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const original=f.env.DB,before=snapshot(f),calls=observed.records.length;let foreignCalls=0;
  const replacement={prepare(){foreignCalls++;throw Error('replacement database');},batch(){foreignCalls++;throw Error('replacement database');}};
  try{
    f.env.DB=replacement;assert.notEqual(f.env.DB,original);assert.throws(()=>owned.view.current());
  }finally{f.env.DB=original;}
  assert.equal(f.env.DB,original);assert.throws(()=>owned.view.current());assert.throws(()=>owned.requireOwner(owned.owner));
  assert.equal(foreignCalls,0);assert.equal(observed.records.length,calls);assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});


async function retainedEmptyScopeBase(owned){
  const {projectIntakeAuthority}=await import('../worker/intake-authority.ts');
  const base=projectIntakeAuthority(owned.view.nativeEnv,owned.view.auth,{projectId:'',documentId:''});
  const proofs=owned.view.assertions,index=proofs.findIndex(proof=>proof.sql===base.sql&&JSON.stringify(proof.bindings??[])===JSON.stringify(base.bindings));
  assert.ok(index>=0,'the original native empty-scope base remains a mandatory retained predicate');return {base,index};
}

test('Audio native repeated draft reads retain the exact empty-scope base and both genuine read phases',async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  const before=snapshot(f);let retained;
  for(let round=0;round<2;round++){
    const start=observed.records.length,saved=await owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv);
    assert.deepEqual(saved.plan,f.plan);assert.equal(saved.content,canonicalJson(f.plan));
    const work=observed.records.slice(start),first=work.filter(entry=>entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT content,expires_at FROM private_content WHERE content_id=/u.test(part.sql)));
    assert.equal(first.length,1);assert.equal(first[0].result.results[0].authorized,1);assert.equal(first[0].result.results[0].count,1);
    const at=work.indexOf(first[0]),second=work.slice(at+1).filter(entry=>entry.statements.some(part=>/audio_output_native_*_rows AS MATERIALIZED \(SELECT 1 AS current\)/u.test(part.sql)));
    assert.equal(second.length,1);assert.equal(second[0].result.results[0].authorized,1);assert.deepEqual(JSON.parse(second[0].result.results[0].body),[[1]]);
    const current=await retainedEmptyScopeBase(owned);if(retained)assert.deepEqual(current.base,retained);retained=current.base;
  }
  assert.deepEqual(snapshot(f),before);assertNoExecution(f);
});

// Counterfactual native-SQL semantics after the real read token is validated.
// This does not authorize caller-supplied descriptors or alternate authority.
for(const truth of ['0','NULL'])test(`Audio native retained empty-scope base ${truth} suppresses the next genuine private read`,async t=>{
  const f=await outputFixture(t),observed=observeDatabase(f),owned=await nativeOwner(f);t.after(owned.close);
  await owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv);
  const {index}=await retainedEmptyScopeBase(owned),database=f.env.DB,prepare=database.prepare;
  let reached=0,completed=0;
  const track=(statement,sql,bindings=[])=>{
    const bind=statement.bind;statement.bind=function(...values){return track(bind.call(this,...values),sql,values);};
    const all=statement.all;statement.all=async function(...args){
      const match=/audio_output_native_*_rows AS MATERIALIZED \(SELECT content,expires_at FROM private_content WHERE content_id=/u.exec(sql);
      if(!reached&&match){
        const prefix=match[0].slice(0,match[0].indexOf('_rows')),opening=`${prefix}_gate_${index} AS MATERIALIZED (SELECT CASE WHEN (`,start=sql.indexOf(opening);
        assert.ok(start>=0);const end=sql.indexOf(') THEN 1 ELSE 0 END AS allowed)',start+opening.length);assert.ok(end>start);
        assert.equal(bindings.length,1);const changed=sql.slice(0,end+1)+` AND (${truth})`+sql.slice(end+1);reached++;
        const result=await prepare.call(database,changed).bind(...bindings).all(...args),row=result.results[0];
        assert.equal(result.results.length,1);assert.equal(row.authorized,0);assert.equal(row.count,1);assert.equal(row.body,null);completed++;return result;
      }
      return all.apply(this,args);
    };
    return statement;
  };
  database.prepare=function(sql){return track(prepare.call(this,sql),sql);};const before=snapshot(f),start=observed.records.length;
  try{
    await assert.rejects(()=>owned.native.readSponsorAudioOutputNativeDraft(owned.owner,owned.request,owned.view.nativeEnv));
    assert.equal(reached,1);assert.equal(completed,1);assert.equal(observed.records.length,start+1);assert.throws(()=>owned.requireOwner(owned.owner));
    assert.deepEqual(snapshot(f),before);assertNoExecution(f);
  }finally{database.prepare=prepare;}
});

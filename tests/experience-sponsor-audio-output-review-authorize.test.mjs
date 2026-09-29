import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {stripTypeScriptTypes} from 'node:module';
import {compileFunction} from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {packSponsorIntakeReadQuery,SponsorIntakeReadQueryError} from '../worker/experience-sponsor-intake-read-sql.ts';
import {join,resolve,sep} from 'node:path';
import {preparedFixture,prepareInitial,continuation,readyActor,actorMessage,ownedContinuation,observeBodyPasses,
  responseBody,refused,bytes,count,rows,snapshot,observeDatabase,canonicalJson,transport,attempts,outputIO,businessSnapshot,
  assertOriginalIntake,assertOneAuthorization,assertNoRun,actualD1,actualWorkerD1,d1Rows,d1Snapshot,qualifyStatements,evidence,persistActualTrace}
  from './experience-sponsor-audio-output-review-authorize-fixture.mjs';

// Native application against disposable SQLite by default. The two opt-in-name
// local D1 tests below are Node-hosted application calls, not a built Worker.
// All provider/media/network/Run paths remain trapped. No accepted suite is imported.
const finalAck=entry=>entry.kind==='batch'&&entry.statements.some(part=>part.sql.includes('JOIN output_execution_grants execution')&&part.sql.includes('slot.job_id='))
  &&entry.statements.some(part=>part.sql.includes('experience_sponsor_driver_stages'));
const insertInto=(entry,table)=>entry.statements.some(part=>new RegExp(`INSERT INTO (?:main\\.)?${table}\\b`,'u').test(part.sql));

// Execute this complete smallest case first and inspect it before any other case.
test('Audio finite five-event native review authorize and original replay preserve one purchase',{timeout:300000},async t=>{
  const f=await preparedFixture(t),observed=observeDatabase(f),original=assertOriginalIntake(f),before=businessSnapshot(f),attemptCount=count(f,outputIO);
  const shown=await responseBody(await continuation(f));
  assert.equal(shown.kind,'sponsor-audio-review');assert.equal(shown.binding.draftId,f.plan.draftId);assert.equal(shown.binding.documentId,f.plan.documentId);
  assert.equal(shown.binding.campaignId,f.campaignId);assert.equal(shown.binding.actorUserId,f.actor);
  assert.equal(shown.native.expiresAt,f.prepared.preflight.expiresAt);assert.deepEqual(shown.review.preview,f.prepared.audioCostPreview);
  assert.deepEqual(businessSnapshot(f),before,'Passive review changes only its one finite read attempt');assert.equal(count(f,outputIO),attemptCount+1);
  const {body,message}=await actorMessage(f,shown),request=f.outputRequest('authorize',{rawBody:message.body});
  const ack=await responseBody(await continuation(f,{operation:'authorize',request}));
  assert.equal(ack.replayed,false);assert.equal(request.bodyUsed,false);
  assert.equal(canonicalJson(await transport.readSponsorAudioAuthorizationResponse(ack,shown,message)),canonicalJson(ack));
  const native=assertOneAuthorization(f,ack);
  assert.deepEqual(native.event.output_command_envelope.sponsor_entitlement.audio_actor_intent.request,body);
  const stage=JSON.parse(f.sqlite.prepare('SELECT command_json FROM experience_sponsor_driver_stages').get().command_json);
  const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(f.stream).n;
  assert.notEqual(stage.expectedRevision,`output:${head}`,'Native authorization advanced the head beyond the retained original revision');
  assert.deepEqual(assertOriginalIntake(f),original);assert.equal(count(f,outputIO),attemptCount+2);const admitted=businessSnapshot(f);
  const {outputExperienceCommands}=await import('../worker/output-requirements-api.ts');
  t.mock.method(outputExperienceCommands,'prepareSponsoredAudioReview',()=>{throw Error('Exact original replay cannot request a fresh native review');});
  t.mock.method(outputExperienceCommands,'prepareSponsoredAudioAdmission',()=>{throw Error('Exact original replay cannot prepare new admission');});
  const replayRequest=f.outputRequest('authorize',{rawBody:message.body}),replay=await responseBody(await continuation(f,{operation:'authorize',request:replayRequest}));
  assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:false},ack);assert.equal(replayRequest.bodyUsed,false);
  assert.deepEqual(businessSnapshot(f),admitted);assert.equal(count(f,outputIO),attemptCount+3);assertOneAuthorization(f,replay);
  evidence(f,'native-original-authorization',{shown,actualBody:body,message,ack,replay,native,admitted,afterReplay:businessSnapshot(f)});
  await assertActualAdmissionWorkspacePair(f,observed.records);
  assert.deepEqual(assertOriginalIntake(f),original);qualifyStatements(f,observed.records,t,{mode:'five-event-review-authorize-replay'});
});

// A fresh child is essential: the genuine fixture imports pilot-policy first,
// which can hide an eager approval -> Audio owner -> approval-schema ESM cycle.
// Approval is a direct strip-only import. Controller additionally uses the
// unchanged source resolver for its legacy extensionless dependency imports;
// this helper replaces no source and imports no application/registry fixture.
for(const entry of ['approval','controller'])test(`Audio finite cold ${entry} import initializes its declared exports`,{timeout:40000},t=>{
  const workerPath=entry==='approval'?'experience-sponsor-approval.ts':'experience-sponsor-audio-output.ts';
  const moduleUrl=new URL(`../worker/${workerPath}`,import.meta.url),resolverUrl=new URL('./output-execution-test-helpers.mjs',import.meta.url);
  const pin=url=>createHash('sha256').update(readFileSync(url)).digest('hex');
  const before={entry:pin(moduleUrl),resolver:pin(resolverUrl)};
  assert.equal(before.resolver,'b9070af006ad87263f28f3845aaffd05af36e565cfda030fd951a32929e2bde5','The cold controller uses the reviewed unmodified resolver');
  const expected=entry==='approval'?['readSponsorInternalCommand','approveSponsorCampaign','loadApprovedSponsorAudioCampaign']:
    ['handleSponsorAudioOutputInitial','handleSponsorAudioOutputReviewAuthorize'];
  const setup=entry==='controller'?`const {registerOutputSourceImports}=await import(${JSON.stringify(resolverUrl.href)});
const hook=registerOutputSourceImports();`:'const hook=null;';
  const script=String.raw`import assert from 'node:assert/strict';
${setup}
try {
  const target=await import(${JSON.stringify(moduleUrl.href)});
  const expected=${JSON.stringify(expected)};
  for(const name of expected)assert.equal(typeof target[name],'function',name);
  ${entry==='approval'?"assert.ok(Array.isArray(target.SPONSOR_APPROVAL_SCHEMA)&&target.SPONSOR_APPROVAL_SCHEMA.length>0);assert.ok(Object.isFrozen(target.SPONSOR_APPROVAL_SCHEMA));":''}
  process.stdout.write(JSON.stringify({entry:${JSON.stringify(entry)},exports:expected,resolution:${JSON.stringify(entry==='approval'?'native-exact-file-url':'unchanged-extension-resolver')}})+'\n');
} finally {hook?.deregister();}`;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:1024*1024,
    // No inherited NODE_OPTIONS preloader, registry loader, credentials, DB or
    // application configuration can influence this isolated import ordering.
    env:{PATH:process.env.PATH??'',NODE_OPTIONS:'',NODE_PATH:''},
  });
  const after={entry:pin(moduleUrl),resolver:pin(resolverUrl)};
  t.diagnostic(JSON.stringify({kind:'cold-module-import-only',entry,sourceBefore:before,sourceAfter:after,
    status:result.status,signal:result.signal,error:result.error?.message??null,stdout:result.stdout,stderr:result.stderr}));
  assert.deepEqual(after,before);assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr||result.stdout);
  assert.deepEqual(JSON.parse(result.stdout),{entry,exports:expected,resolution:entry==='approval'?'native-exact-file-url':'unchanged-extension-resolver'});
});

test('Audio finite six-event native continuation retains the optional authored Context',{timeout:300000},async t=>{
  const f=await preparedFixture(t,{detail:'Quiet strings resolve without a voice. 水'}),original=assertOriginalIntake(f),actor=await readyActor(f);
  const ack=await responseBody(await continuation(f,{operation:'authorize',request:actor.request}));
  assertOneAuthorization(f,ack);assert.deepEqual(assertOriginalIntake(f),original);assert.equal(original.length,6);
  assert.equal(canonicalJson(await transport.readSponsorAudioAuthorizationResponse(ack,actor.shown,actor.message)),canonicalJson(ack));
});

for(const replayed of [false,true])test(`Audio finite ${replayed?'replay':'fresh'} two parser passes share original counters and nonrenewing lifetime`,{timeout:300000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f);
  if(replayed)assertOneAuthorization(f,await responseBody(await continuation(f,{operation:'authorize',request:actor.request})));
  const raw=`${' '.repeat(257)}${actor.message.body}\n`,observed=observeDatabase(f);
  const request=f.outputRequest('authorize',{rawBody:raw}),owned=await ownedContinuation(t,f,request,'authorize');
  const before={...owned.view.usage},deadline=owned.view.monotonicDeadline,start=observed.records.length,attemptCount=count(f,outputIO);
  const parts=observeBodyPasses(t,raw,{request,view:owned.view}),response=await owned.run();
  evidence(f,'two-real-parser-passes',{rawBody:raw,rawBytes:bytes(raw),before,after:owned.view.usage,deadlineBefore:deadline,deadlineAfter:owned.view.monotonicDeadline,
    passes:parts.readers.map(reader=>({reads:reader.reads,chunks:reader.chunks.map(part=>({bytes:part.bytes,usageBefore:part.usageBefore})),accounted:reader.accounted.length}))});
  assert.equal(parts.length,2,'Both actual native parser passes read the supplied whitespace and command bytes');
  assert.equal(parts.readers.length,2);assert.ok(parts.readers.every(reader=>reader.chunks.length===1&&reader.accounted.length===1&&reader.reads===2));
  assert.equal(parts.reduce((total,part)=>total+part.bytes,0),bytes(raw)*2);assert.equal(request.bodyUsed,false);
  const work=observed.records.slice(start),queries=work.reduce((total,entry)=>total+entry.statements.length,0),transportBytes=work.reduce((total,entry)=>total+(entry.returnedBytes??0),0);
  assert.equal(owned.view.usage.queries-before.queries,queries);
  assert.ok(owned.view.usage.bytes-before.bytes>=transportBytes+bytes(raw)*2,'Both real body reads and every DB transport share the original C bytes');
  assert.equal(owned.view.monotonicDeadline,deadline);assert.equal(count(f,outputIO),attemptCount);
  const ack=await responseBody(await owned.disclose(response));assert.equal(ack.replayed,replayed);assertOneAuthorization(f,ack);
  assert.throws(()=>attempts.requireSponsorAudioOutputReadBudget(owned.budget,request,f.env));
});

test('Audio finite second raw parser chunk exhausts the same allowance before issuance',{timeout:300000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f),raw=` ${actor.message.body}\n`,request=f.outputRequest('authorize',{rawBody:raw});
  const owned=await ownedContinuation(t,f,request,'authorize');let exhausted=false;
  const parts=observeBodyPasses(t,raw,{request,view:owned.view,onChunk(_part,index){if(index===2){
    const remaining=owned.view.remaining();assert.ok(remaining.bytes>=bytes(raw));
    owned.view.account({bytes:remaining.bytes-bytes(raw)+1,queries:0,rows:0});exhausted=true;
  }}});
  await refused(owned.run);assert.equal(exhausted,true);assert.equal(parts.length,2);assert.equal(request.bodyUsed,false);
  assert.equal(count(f,'experience_sponsor_driver_intents'),1,'Actual original stage may persist before the second native actor parse');
  assert.equal(count(f,'experience_sponsor_grants'),0);assert.equal(count(f,'output_execution_grants'),0);assert.equal(count(f,'document_jobs'),0);assertNoRun(f);
  assert.throws(()=>owned.view.current());
});

for(const dimension of ['queries','rows'])test(`Audio finite original ${dimension} exhaustion refuses before another native dispatch`,{timeout:120000},async t=>{
  const f=await preparedFixture(t),observed=observeDatabase(f),request=f.outputRequest('review'),owned=await ownedContinuation(t,f,request,'review');
  const before=businessSnapshot(f),start=observed.records.length,remaining=owned.view.remaining();
  owned.view.account({bytes:0,queries:dimension==='queries'?remaining.queries:0,rows:dimension==='rows'?remaining.rows:0});
  await refused(owned.run);assert.equal(observed.records.length,start);assert.deepEqual(businessSnapshot(f),before);assertNoRun(f);
});

for(const [name,change]of [
  ['extra payer',body=>({...body,payerUserId:'caller-selected-payer'})],
  ['false authorization',body=>({...body,explicitAuthorization:false})],
  ['false provider transfer',body=>({...body,audioCostConsent:{...body.audioCostConsent,providerTransferConfirmed:false}})],
  ['different maximum',body=>({...body,maximumMicrousd:body.maximumMicrousd+1})],
  ['different review',body=>({...body,sponsorReview:{...body.sponsorReview,reviewDigest:`sha256:${'f'.repeat(64)}`}})],
])test(`Audio finite actual actor wire refuses ${name} without a purchase`,{timeout:120000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f),before=businessSnapshot(f),attemptCount=count(f,outputIO);
  await refused(()=>continuation(f,{operation:'authorize',body:change(structuredClone(actor.body))}));
  assert.deepEqual(businessSnapshot(f),before);assert.equal(count(f,outputIO),attemptCount+1);assertNoRun(f);
});

for(const kind of ['query','fragment','cross-origin','run','consumed body'])test(`Audio finite controller refuses ${kind} before another reservation`,{timeout:120000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f),path=`http://localhost${actor.message.path}`;
  const request=f.outputRequest('authorize',{rawBody:actor.message.body,url:path+(kind==='query'?'?other=1':kind==='fragment'?'#other':kind==='run'?'/run':''),
    headers:kind==='cross-origin'?{origin:'https://other.example.invalid'}:{}});
  if(kind==='consumed body')await request.text();const before=snapshot(f);
  await refused(()=>continuation(f,{operation:'authorize',request}));assert.deepEqual(snapshot(f),before);assertNoRun(f);
});

for(const kind of ['invalid UTF-8','over 4096 bytes'])test(`Audio finite parser refuses ${kind} before native intent`,{timeout:120000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f),raw=kind==='invalid UTF-8'?new Uint8Array([0x7b,0x22,0xc3,0x28,0x22,0x7d]):`${' '.repeat(4097)}${actor.message.body}`;
  const before=businessSnapshot(f),request=f.outputRequest('authorize',{rawBody:raw});
  await refused(()=>continuation(f,{operation:'authorize',request}));assert.deepEqual(businessSnapshot(f),before);assert.equal(request.bodyUsed,false);assertNoRun(f);
});

test('Audio finite stalled body abort uses the intrinsic signal despite a shadow property',{timeout:120000},async t=>{
  const f=await preparedFixture(t),controller=new AbortController();let source,started=false,abortTimer,watchdog,rejectBounded;
  const bounded=new Promise((_,reject)=>{rejectBounded=reject;});
  const stream=new ReadableStream({start(value){source=value;}}),request=f.outputRequest('authorize',{rawBody:stream,signal:controller.signal});
  const nativeSignal=Object.getOwnPropertyDescriptor(Request.prototype,'signal').get.call(request);
  Object.defineProperty(nativeSignal,'aborted',{get:()=>false,configurable:true});
  const before=businessSnapshot(f),owned=await ownedContinuation(t,f,request,'authorize');
  const parts=observeBodyPasses(t,undefined,{request,view:owned.view,onRead(_reader,pending){
    assert.ok(pending instanceof Promise);if(started)return;started=true;
    // The actual parser reader has returned its never-settling read promise.
    // Abort is armed here, not during an earlier native DB/source read.
    watchdog=setTimeout(()=>rejectBounded(new assert.AssertionError({message:'Stalled native parser did not settle after intrinsic abort'})),10000);
    abortTimer=setTimeout(()=>controller.abort(),1);
  }});
  try{await refused(()=>Promise.race([owned.run(),bounded]));}
  finally{clearTimeout(watchdog);clearTimeout(abortTimer);source.close();}
  assert.equal(started,true);assert.equal(parts.length,0);assert.equal(parts.readers.length,1);assert.equal(parts.readers[0].reads,1);
  assert.equal(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get.call(nativeSignal),true);
  assert.deepEqual(businessSnapshot(f),before);assertNoRun(f);assert.throws(()=>owned.view.current());
});

for(const kind of ['original plan','original receipt','private original bytes','current campaign','current actor'])test(`Audio finite review refuses changed ${kind}`,{timeout:120000},async t=>{
  const f=await preparedFixture(t);
  if(kind==='original plan')assert.equal(f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('{}',f.plan.draftId).changes,1);
  if(kind==='original receipt')assert.equal(f.sqlite.prepare('DELETE FROM event_client_receipts WHERE stream_id=? AND client_event_id=?').run(f.stream,f.original[0].client_event_id).changes,1);
  if(kind==='private original bytes')assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run('{}',f.original[0].event_id).changes,1);
  if(kind==='current campaign')assert.equal(f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId).changes,1);
  if(kind==='current actor')assert.equal(f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(f.actor).changes,1);
  const changed=businessSnapshot(f);await refused(()=>continuation(f));assert.deepEqual(businessSnapshot(f),changed);assertNoRun(f);
});

test('Audio finite rejects a replaced admission bridge before invoking its wrapper',{timeout:300000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f);
  const {outputDocumentExecutionBridge,prepareAdmission}=await import('../worker/output-document-execution.ts');
  assert.equal(outputDocumentExecutionBridge.prepareAdmission,prepareAdmission);
  const financialTables=['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters'];
  const beforeFinancial=Object.fromEntries(financialTables.map(table=>[table,rows(f,table)]));let issuedOriginal,wrapperCalls=0,appendedMutations=0;
  const issuedTables=['experience_sponsor_driver_intents','experience_sponsor_driver_stages','experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_resource_receipts'];
  observeDatabase(f,{after(entry){if(entry.kind==='batch'&&insertInto(entry,'experience_sponsor_issuances')){
    assert.equal(issuedOriginal,undefined);issuedOriginal=Object.fromEntries(issuedTables.map(table=>[table,rows(f,table)]));
    for(const table of issuedTables)assert.equal(issuedOriginal[table].length,1,table);
  }}});
  const attemptCount=count(f,outputIO),owned=await ownedContinuation(t,f,actor.request,'authorize'),charged=rows(f,outputIO);
  assert.equal(charged.length,attemptCount+1);
  // This replacement precedes entry to the genuine finite authorizer. If an
  // owner mistakenly captured the mutable bridge as native authority, it would
  // call the actual preparer, then append an owner-DB mutation to its real
  // statement vector. No grant, private receipt or successful DTO is invented.
  t.mock.method(outputDocumentExecutionBridge,'prepareAdmission',async input=>{
    wrapperCalls++;const prepared=await prepareAdmission(input),build=prepared.buildStatements;
    return {...prepared,buildStatements(events){
      const native=build(events);appendedMutations++;
      return {...native,statements:[...native.statements,input.env.DB.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').bind(f.campaignId)]};
    }};
  });
  await assert.rejects(owned.run,/sponsor_audio_output_native_bridge_changed/u);
  assert.equal(wrapperCalls,0);assert.equal(appendedMutations,0);assert.ok(issuedOriginal,'This native ordering reaches the guard after genuine original issuance');
  assert.deepEqual(Object.fromEntries(issuedTables.map(table=>[table,rows(f,table)])),issuedOriginal,'The existing native driver and issuance remain untouched');
  assert.deepEqual(Object.fromEntries(financialTables.map(table=>[table,rows(f,table)])),beforeFinancial);
  for(const table of ['experience_sponsor_consumptions','experience_sponsor_active_jobs','output_execution_grants','output_operation_slots','document_jobs'])assert.equal(count(f,table),0,table);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='authorize'").get().n,0);
  assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_campaigns WHERE campaign_id=?').get(f.campaignId).enabled,1);
  assert.deepEqual(rows(f,outputIO),charged);assert.deepEqual(assertOriginalIntake(f),f.original);assertNoRun(f);
  evidence(f,'pre-entry-admission-bridge-replacement',{wrapperCalls,appendedMutations,issuedOriginal,beforeFinancial,charged});
});

test('Audio finite lost driver ACK proves its original stage and admits once on the same ticket',{timeout:300000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f);let lost=false,lostAt,retainedDriver;
  const observed=observeDatabase(f,{after(entry){
    if(lost||entry.kind!=='batch'||!insertInto(entry,'experience_sponsor_driver_stages'))return;
    assert.equal(count(f,'experience_sponsor_driver_intents'),1);assert.equal(count(f,'experience_sponsor_driver_stages'),1);
    assert.equal(count(f,'experience_sponsor_issuances'),0);assert.equal(count(f,'output_execution_grants'),0);
    retainedDriver={intents:rows(f,'experience_sponsor_driver_intents'),stages:rows(f,'experience_sponsor_driver_stages')};
    lost=true;lostAt=observed.records.length;
    // The actual database committed. Throw before this adapter delivers any
    // acknowledgement to the native owner: this is distinct from a received
    // malformed envelope and does not substitute a successful native result.
    entry.deliveryFault={kind:'committed-driver-ack-not-delivered',actualCommittedDriver:retainedDriver};
    throw Error('Synthetic lost actual native driver ACK');
  }});
  const attemptCount=count(f,outputIO),owned=await ownedContinuation(t,f,actor.request,'authorize'),charged=rows(f,outputIO),deadline=owned.view.monotonicDeadline;
  assert.equal(charged.length,attemptCount+1);assert.equal(charged.filter(row=>row.operation==='audio-output-authorize').length,1);
  const parts=observeBodyPasses(t,actor.message.body,{request:actor.request,view:owned.view}),response=await owned.run();
  assert.equal(lost,true);assert.equal(parts.length,2);assert.equal(parts.readers.length,2);
  assert.ok(parts.readers.every(reader=>reader.chunks.length===1&&reader.accounted.length===1&&reader.reads===2));
  assert.equal(actor.request.bodyUsed,false);assert.equal(owned.view.monotonicDeadline,deadline);
  const recovered=observed.records.slice(lostAt),issueAt=recovered.findIndex(entry=>entry.kind==='batch'&&insertInto(entry,'experience_sponsor_issuances'));
  const intentReadAt=recovered.findIndex(entry=>entry.statements.some(part=>part.sql.includes('SELECT driver_id,campaign_id,actor_user_id,session_digest,intent_key,document_id,command_json')));
  const stageReadAt=recovered.findIndex(entry=>entry.statements.some(part=>part.sql.includes('SELECT command_json,command_digest FROM experience_sponsor_driver_stages WHERE driver_id=')));
  assert.ok(intentReadAt>=0&&stageReadAt>=0&&issueAt>intentReadAt&&issueAt>stageReadAt,'The same original intent and stage are read before native issuance');
  assert.equal(observed.records.filter(entry=>entry.kind==='batch'&&insertInto(entry,'experience_sponsor_driver_intents')).length,1,'Recovery never resubmits the driver transaction');
  assert.deepEqual(rows(f,'experience_sponsor_driver_intents'),retainedDriver.intents);assert.deepEqual(rows(f,'experience_sponsor_driver_stages'),retainedDriver.stages);
  const ack=await responseBody(await owned.disclose(response));assert.equal(ack.replayed,false);const native=assertOneAuthorization(f,ack);
  assert.equal(canonicalJson(await transport.readSponsorAudioAuthorizationResponse(ack,actor.shown,actor.message)),canonicalJson(ack));
  assert.deepEqual(native.event.output_command_envelope.sponsor_entitlement.audio_actor_intent.request,actor.body);
  assert.deepEqual(assertOriginalIntake(f),f.original);assert.deepEqual(rows(f,outputIO),charged,'Recovery retains the one original finite debit');
  assert.deepEqual(rows(f,'experience_sponsor_driver_intents'),retainedDriver.intents);assert.deepEqual(rows(f,'experience_sponsor_driver_stages'),retainedDriver.stages);
  evidence(f,'lost-driver-ack-original-only-recovery',{lostAt,intentReadAt,stageReadAt,issueAt,retainedDriver,charged,ack,native,
    actualBodyPasses:parts.readers.map(reader=>({reads:reader.reads,rawBytes:reader.chunks.map(part=>part.bytes),accounted:reader.accounted.length}))});
});

test('Audio finite oversized received driver ACK retires its ticket before any recovery dispatch',{timeout:300000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f);let owned,corrupted=false,receivedAt,retainedDriver;
  const observed=observeDatabase(f,{transform(entry,result){
    if(corrupted||entry.kind!=='batch'||!insertInto(entry,'experience_sponsor_driver_stages'))return result;
    assert.equal(count(f,'experience_sponsor_driver_intents'),1);assert.equal(count(f,'experience_sponsor_driver_stages'),1);
    assert.ok(Array.isArray(result)&&result.length>0);assert.ok(result[0].meta&&typeof result[0].meta==='object');
    // The real native driver transaction has committed and returned its actual
    // ACK. Add only an own metadata field exceeding this ticket's remaining
    // bytes; no success, row, driver, receipt or native capability is fabricated.
    const remaining=owned.view.remaining(),fieldBytes=remaining.bytes+1;
    assert.ok(Number.isSafeInteger(fieldBytes)&&fieldBytes>0&&fieldBytes<=8_000_001);
    Object.defineProperty(result[0].meta,'fixtureOversizedReceivedAck',{value:'x'.repeat(fieldBytes),enumerable:true,configurable:true,writable:true});
    corrupted=true;receivedAt=observed.records.length;
    retainedDriver={intents:rows(f,'experience_sponsor_driver_intents'),stages:rows(f,'experience_sponsor_driver_stages')};
    entry.receivedAckFault={kind:'oversized-own-metadata',fieldBytes,remainingBefore:remaining,actualCommittedDriver:retainedDriver};
    entry.receivedAfterFault=structuredClone(result);return result;
  }});
  const attemptCount=count(f,outputIO);owned=await ownedContinuation(t,f,actor.request,'authorize');
  const charged=rows(f,outputIO);assert.equal(charged.length,attemptCount+1);
  await refused(owned.run);assert.equal(corrupted,true);
  assert.throws(()=>owned.view.current(),'A received unmeasurable ACK permanently retires the original lifetime');
  assert.throws(()=>attempts.requireSponsorAudioOutputReadBudget(owned.budget,actor.request,f.env));
  assert.equal(observed.records.length,receivedAt,'No original lookup, proof or recovery dispatch may follow that received ACK on this ticket');
  assert.deepEqual(rows(f,'experience_sponsor_driver_intents'),retainedDriver.intents);assert.deepEqual(rows(f,'experience_sponsor_driver_stages'),retainedDriver.stages);
  for(const table of ['experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_resource_receipts','experience_sponsor_consumptions',
    'experience_sponsor_active_jobs','output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations'])assert.equal(count(f,table),0,table);
  assert.deepEqual(rows(f,outputIO),charged,'The recorded finite debit is retained without a refund or replacement attempt');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='authorize'").get().n,0);assertNoRun(f);
  evidence(f,'oversized-received-driver-ack',{receivedAt,dispatchesAfterReceived:observed.records.length-receivedAt,retainedDriver,charged,retired:true});
});

test('Audio finite lost native commit ACK keeps one original and permits only exact later replay',{timeout:300000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f);let lost=false;
  const observed=observeDatabase(f,{after(entry){if(!lost&&entry.kind==='batch'&&insertInto(entry,'output_commands')
    &&f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='authorize'").get().n===1){lost=true;throw Error('Synthetic lost actual native authorization ACK');}}});
  let response;try{response=await continuation(f,{operation:'authorize',request:actor.request});}catch(error){assert.ok(error instanceof Error);}
  assert.equal(lost,true);if(response?.status===200){const recovered=await responseBody(response);
    assert.equal(canonicalJson(await transport.readSponsorAudioAuthorizationResponse(recovered,actor.shown,actor.message)),canonicalJson(recovered));assertOneAuthorization(f,recovered);
  }else if(response)assert.ok(response.status>=400);assertOneAuthorization(f);
  const before=businessSnapshot(f),original=f.sqlite.prepare("SELECT event_id FROM output_commands WHERE action='authorize'").get().event_id;
  observed.restore();const replay=await responseBody(await continuation(f,{operation:'authorize',rawBody:actor.message.body}));
  assert.equal(replay.replayed,true);assert.equal(replay.receipt.eventId,original);assert.deepEqual(businessSnapshot(f),before);assertOneAuthorization(f,replay);
});

test('Audio finite final response reproof refuses campaign revocation after its last body await',{timeout:300000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f),owned=await ownedContinuation(t,f,actor.request,'authorize');
  const response=await owned.run();assertOneAuthorization(f);let changed=false;
  const body=Object.getOwnPropertyDescriptor(Response.prototype,'body').get.call(response),getReader=ReadableStream.prototype.getReader;
  t.mock.method(ReadableStream.prototype,'getReader',function(...args){
    const reader=getReader.apply(this,args);if(this!==body)return reader;
    const read=reader.read;t.mock.method(reader,'read',async function(...readArgs){
      const result=await read.apply(this,readArgs);if(result.done&&!changed){
        assert.equal(f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId).changes,1);changed=true;
      }return result;
    });return reader;
  });
  await refused(()=>owned.disclose(response));assert.equal(changed,true);assertOneAuthorization(f);
  assert.equal(f.sqlite.prepare('SELECT enabled FROM experience_sponsor_campaigns WHERE campaign_id=?').get(f.campaignId).enabled,0);
  assert.throws(()=>owned.view.current());
});

for(const kind of ['zero proof','NULL proof','sparse ACK'])test(`Audio finite final native disclosure refuses ${kind} after committed authorization`,{timeout:300000},async t=>{
  const f=await preparedFixture(t),actor=await readyActor(f);let damaged=false;
  observeDatabase(f,{transform(entry,result){if(!damaged&&finalAck(entry)){
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='authorize'").get().n,1,'The corrupted proof ACK follows the actual native authorization commit');
    assert.equal(count(f,'output_execution_grants'),1);damaged=true;assert.ok(Array.isArray(result));assert.ok(result.length>0);
    if(kind==='sparse ACK')delete result[0];else{assert.equal(result[0].results.length,1);const row=result[0].results[0];
      const field=Object.hasOwn(row,'authorized')?'authorized':'current';assert.ok(Object.hasOwn(row,field));row[field]=kind==='zero proof'?0:null;}
  }return result;}});
  await refused(()=>continuation(f,{operation:'authorize',request:actor.request}));assert.equal(damaged,true);assertOneAuthorization(f);
});

// These cases require the root-authorized local listener/watchdog execution.
// They are named separately so the smallest native positive can be run first.
test('Audio finite local workerd D1 complete native authorize and original replay',{timeout:300000},async t=>{
  const f=await preparedFixture(t,{prepare:false}),d1=await actualD1(t,f);
  const original=await d1Snapshot(d1.db,['experience_sponsor_audio_intakes','experience_sponsor_audio_intake_allocations','private_content']);
  const actorCounters=async()=>Object.fromEntries(await Promise.all(['budget_counters','cost_budget_counters'].map(async table=>[table,(await d1Rows(d1.db,table)).filter(row=>row.scope==='user'&&row.scope_id===f.actor)])));
  const actorBefore=await actorCounters();
  await prepareInitial(f);const actor=await readyActor(f),request=actor.request;
  const ack=await responseBody(await continuation(f,{operation:'authorize',request}));assert.equal(ack.replayed,false);assert.equal(request.bodyUsed,false);
  assert.equal(canonicalJson(await transport.readSponsorAudioAuthorizationResponse(ack,actor.shown,actor.message)),canonicalJson(ack));
  const native=await d1Snapshot(d1.db,['output_execution_grants','document_jobs','output_commands','event_private_payloads','experience_sponsor_consumptions','experience_sponsor_issuances']);
  assert.equal(native.output_execution_grants.length,1);assert.equal(native.document_jobs.length,1);assert.equal(native.experience_sponsor_consumptions.length,1);assert.equal(native.experience_sponsor_issuances.length,1);
  assert.equal(native.output_execution_grants[0].payer_user_id,f.payer);assert.equal(native.output_execution_grants[0].status,'authorized');assert.equal(native.document_jobs[0].status,'queued');assert.equal(native.document_jobs[0].attempt_count,0);
  for(const table of ['experience_sponsor_driver_intents','experience_sponsor_driver_stages','experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_active_jobs','output_operation_slots','budget_reservations','cost_budget_reservations'])assert.equal((await d1Rows(d1.db,table)).length,1,table);
  for(const table of ['budget_reservations','cost_budget_reservations'])assert.equal((await d1Rows(d1.db,table))[0].owner_id,f.payer,table);
  assert.deepEqual(await actorCounters(),actorBefore);
  const command=native.output_commands.find(row=>row.action==='authorize');assert.equal(command.event_id,ack.receipt.eventId);
  const event=JSON.parse(native.event_private_payloads.find(row=>row.private_event_id===command.event_id).private_json);
  assert.deepEqual(event.output_command_envelope.sponsor_entitlement.audio_actor_intent.request,actor.body);
  const businessTables=d1.tables.filter(table=>table!==outputIO),before=await d1Snapshot(d1.db,businessTables);
  const replay=await responseBody(await continuation(f,{operation:'authorize',rawBody:actor.message.body}));assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:false},ack);
  const afterReplay=await d1Snapshot(d1.db,businessTables);assert.deepEqual(afterReplay,before);assert.deepEqual(await d1Snapshot(d1.db,Object.keys(original)),original);
  evidence(f,'actual-d1-original-authorization',{original,shown:actor.shown,actualBody:actor.body,message:actor.message,ack,replay,native,beforeReplay:before,afterReplay});
  assert.equal((await d1Rows(d1.db,outputIO)).length,4);assert.equal((await d1Rows(d1.db,'output_provider_calls')).length,0);
  assert.equal((await d1Rows(d1.db,'output_commands')).filter(row=>row.action==='run').length,0);
  assert.deepEqual(f.effects,{media:0,assets:0});assert.deepEqual(f.network,[]);assert.equal(f.detached,0);
  assert.deepEqual((await d1.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results,d1.schemaBefore);
  qualifyStatements(f,d1.records,t,{actualD1:true,mode:'five-event-review-authorize-replay'});
});

test('Audio finite local workerd D1 native admission rolls back concurrent original private-body drift',{timeout:300000},async t=>{
  const f=await preparedFixture(t,{detail:'An actual optional Context for the admission race.',prepare:false});let changed=false,raceEntry,before;
  const d1=await actualD1(t,f,{async before(entry,db){
    if(changed||entry.kind!=='batch'||!insertInto(entry,'output_commands'))return;
    if((await db.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_issuances').first()).n!==1)return;
    changed=true;raceEntry=entry;
    const original=f.original[0];const mutation=await db.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').bind('{}',original.event_id).run();assert.equal(mutation.meta.changes,1);
    before=await d1Snapshot(db,d1.tables.filter(table=>table!==outputIO));
  }});
  await prepareInitial(f);const actor=await readyActor(f);await refused(()=>continuation(f,{operation:'authorize',request:actor.request}));
  assert.equal(changed,true,'The original body changes at the actual native admission batch, not at an earlier read');
  assert.match(raceEntry.error??'',/CHECK constraint failed: passed\s*=\s*1/u,'The native CHECK proves atomic refusal');
  const after=await d1Snapshot(d1.db,Object.keys(before));assert.deepEqual(after,before);assert.equal((await d1Rows(d1.db,'output_execution_grants')).length,0);
  evidence(f,'actual-d1-atomic-private-body-race',{before,after,raceEntry,changedOriginalEventId:f.original[0].event_id});
  assert.equal((await d1Rows(d1.db,'output_provider_calls')).length,0);assert.equal((await d1Rows(d1.db,'output_commands')).filter(row=>row.action==='authorize').length,0);
  assert.deepEqual(f.effects,{media:0,assets:0});assert.deepEqual(f.network,[]);assert.equal(f.detached,0);
  assert.deepEqual((await d1.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).results,d1.schemaBefore);
  qualifyStatements(f,d1.records,t,{actualD1:true,mode:'actual-admission-private-body-race'});
});


// Persistence-only controls: these records are synthetic evidence values, not
// principals, grants, database responses used by an application, or acceptance.
const traceHash=value=>createHash('sha256').update(value).digest('hex');
function traceEvidenceFixture(t){
  const evidenceDirectory=mkdtempSync(join(tmpdir(),'forma-audio-trace-persistence-'));
  t.after(()=>rmSync(evidenceDirectory,{recursive:true,force:true}));
  return {testName:t.name,evidenceDirectory,
    sourceBefore:{fixture:'synthetic-source-pin',helper:'synthetic-helper-pin'},
    evidenceSchema:[{type:'table',name:'evidence_only',sql:'CREATE TABLE evidence_only(value TEXT)'}],
    evidenceOriginal:[{id:'synthetic-original',body:'No application or database was invoked.'}],traces:[]};
}
function reconstructTraceBundle(directory,completionPath){
  assert.equal(completionPath,join(directory,'completion.json'));
  const completion=JSON.parse(readFileSync(completionPath,'utf8'));
  assert.equal(completion.version,1);assert.equal(completion.format,'forma-audio-actual-trace@1');
  assert.equal(completion.captureComplete,true);assert.equal(completion.qualificationVerdict,false);
  assert.equal(completion.index.path,'index.jsonl');
  const index=readFileSync(join(directory,completion.index.path));
  assert.equal(index.length,completion.index.bytes);assert.equal(traceHash(index),completion.index.sha256);
  assert.equal(index.at(-1),10,'The final complete index record ends with a newline');
  const records=index.toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line));
  const nodes=new Map(),children=new Map(),blobs=new Map(),roots=[],headers=[],statements=[];
  let blobBytes=0;
  for(const record of records){
    if(record.kind==='node'){
      assert.equal(nodes.has(record.id),false,'Every node ID occurs exactly once');nodes.set(record.id,record);
      if(Object.hasOwn(record,'parent')){const list=children.get(record.parent)??[];list.push(record);children.set(record.parent,list);}
    }else if(record.kind==='blob'){
      assert.equal(blobs.has(record.id),false,'Every blob ID occurs exactly once');
      const path=resolve(directory,record.path);assert.ok(path.startsWith(`${resolve(directory)}${sep}`),'Blob paths stay in the bundle');
      const data=readFileSync(path);assert.equal(data.length,record.bytes);assert.equal(traceHash(data),record.sha256);
      assert.ok(record.encoding==='utf16le'||record.encoding==='bytes');
      if(record.encoding==='utf16le')assert.equal(data.length%2,0,'UTF-16 files contain complete code units');
      blobs.set(record.id,{...record,data});blobBytes+=data.length;
    }else if(record.kind==='root')roots.push(record);
    else if(record.kind==='trace')headers.push(record);
    else if(record.kind==='statement')statements.push(record);
    else assert.fail(`Unexpected trace index record: ${record.kind}`);
  }
  const visited=new Set(),usedBlobs=new Set(),usedRoots=new Set();
  const blob=(id,encoding)=>{assert.ok(blobs.has(id),'Every blob reference resolves');const found=blobs.get(id);
    assert.equal(found.encoding,encoding);usedBlobs.add(id);return found.data;};
  const key=value=>typeof value==='string'?value:blob(value.blob,'utf16le').toString('utf16le');
  const value=id=>{
    assert.ok(nodes.has(id),'Every node reference resolves');assert.equal(visited.has(id),false,'No node is shared or cyclic');visited.add(id);
    const node=nodes.get(id),nested=children.get(id)??[];
    if(node.type==='array'||node.type==='object'){
      if(node.type==='object')assert.ok(node.prototype==='object'||node.prototype==='null','Object prototype tags are exact');
      const result=node.type==='array'?new Array(node.length):node.prototype==='null'?Object.create(null):{};const keys=new Set();
      for(const child of nested){const name=key(child.key);assert.equal(keys.has(name),false,'No duplicate own property');keys.add(name);
        assert.notEqual(node.type==='array'?name:null,'length','Array length is held separately');
        Object.defineProperty(result,name,{value:value(child.id),writable:child.descriptor?.writable??true,
          enumerable:child.descriptor?.enumerable??true,configurable:child.descriptor?.configurable??true});
      }return result;
    }
    assert.equal(nested.length,0,'Scalar nodes have no children');
    if(node.type==='string')return blob(node.blob,'utf16le').toString('utf16le');
    if(node.type==='blob')return new Uint8Array(blob(node.blob,'bytes'));
    if(node.type==='number'){assert.equal(typeof node.value,'string');return node.value==='-0'?-0:Number(node.value);}
    if(node.type==='boolean'){assert.equal(typeof node.value,'boolean');return node.value;}
    if(node.type==='null')return null;
    if(node.type==='undefined')return undefined;
    assert.fail(`Unsupported evidence node: ${node.type}`);
  };
  const root=(name,context={})=>{
    const sameContext=actual=>Object.keys(actual??{}).length===Object.keys(context).length&&Object.keys(context).every(key=>Object.hasOwn(actual??{},key)&&actual[key]===context[key]);
    const matches=roots.filter(record=>record.name===name&&sameContext(record.context));
    assert.equal(matches.length,1,`One root for ${name} ${JSON.stringify(context)}`);const found=matches[0];
    assert.equal(usedRoots.has(found),false);usedRoots.add(found);
    assert.equal(Object.hasOwn(nodes.get(found.id)??{},'parent'),false,'Roots are not also nested nodes');return value(found.id);
  };
  const finish=()=>{
    assert.equal(usedRoots.size,roots.length,'No unverified roots');assert.equal(visited.size,nodes.size,'No orphan nodes');
    assert.equal(usedBlobs.size,blobs.size,'No unverified blobs');
    assert.deepEqual(readdirSync(join(directory,'pieces')).map(name=>`pieces/${name}`).sort(),[...blobs.values()].map(item=>item.path).sort(),
      'Every retained piece has exactly one inventory descriptor');
    assert.equal(completion.counts.nodes,nodes.size);assert.equal(completion.counts.blobs,blobs.size);assert.equal(completion.counts.blobBytes,blobBytes);
  };
  return {completion,records,headers,statements,root,finish};
}

test('Audio finite trace persistence reconstructs exact chunked SQL, typed bindings and ACK evidence',t=>{
  const f=traceEvidenceFixture(t),text='abc\uD83D\uDE80x\uD800y\uDFFF\u0000"\\\n'.repeat(9),longKey=`${'k'.repeat(1025)}\uD800`;
  // The astral pair straddles the first eight-byte chunk; lone surrogates must
  // also survive unchanged instead of becoming replacement characters.
  assert.equal(text.charCodeAt(3),0xD83D);assert.equal(text.charCodeAt(4),0xDE80);
  const diagnostics=new Array(3);diagnostics[0]=undefined;diagnostics[2]=text;
  const nullPrototype=Object.assign(Object.create(null),{text,flag:false});
  const results=[
    {success:true,meta:{changes:1,duration:0.25,nested:{note:text,negativeZero:-0,nullPrototype,[longKey]:'long own key'}},
      results:[{position:2,value:text,nullable:null,raw:new Uint8Array([0,255,128,1,0])},{position:1,value:'last row'}]},
    {success:false,meta:{changes:0,diagnostics},results:[]}
  ];
  const sql=`SELECT ? AS nullable, ? AS fraction, ? AS negative_zero, ? AS body, ? AS bytes /* ${text} */`;
  f.traces=[
    {application:'synthetic evidence only: first',records:[
      {kind:'batch',statements:[{sql,bindings:[null,1.25,-0,text,new Uint8Array([0,255,128,1,0])]},
        {sql:'SELECT ? AS label',bindings:['second statement']}],result:results,returnedBytes:731,elapsedMs:0},
      {kind:'all',statements:[{sql:'SELECT ? AS count',bindings:[7]}],result:{success:true,results:[{count:7}],meta:{changes:0}},returnedBytes:83}
    ]},
    {application:'synthetic evidence only: failed boundary',records:[
      {kind:'batch',statements:[{sql:'SELECT ? AS original',bindings:['retained before failure']}],returnedBytes:0,error:'Synthetic recorded application error'}
    ]}
  ];
  const expectedTyped=[[[['null',null],['real','1.25'],['real','-0.0'],['text',text],['blob','00ff800100']],[['text','second statement']]],
    [[['real','7']]],[[['text','retained before failure']]]];
  let nativeWrites=0,shortWrites=0;
  const saved=persistActualTrace(f,{...f.sourceBefore},{chunkBytes:8,write(fd,buffer,offset,length){
    nativeWrites++;const requested=Math.min(length,3);if(requested<length)shortWrites++;
    return writeSync(fd,buffer,offset,requested);
  }});
  assert.ok(nativeWrites>10);assert.ok(shortWrites>0,'The writer completes native short writes without losing bytes');
  assert.ok(saved.directory.startsWith(`${f.evidenceDirectory}${sep}`));assert.equal(existsSync(join(saved.directory,'failure.json')),false);
  const bundle=reconstructTraceBundle(saved.directory,saved.completion);
  assert.equal(bundle.completion.testName,t.name);
  assert.deepEqual(bundle.root('sourceBefore'),f.sourceBefore);assert.deepEqual(bundle.root('sourceAfter'),f.sourceBefore);
  assert.deepEqual(bundle.root('schema'),f.evidenceSchema);assert.deepEqual(bundle.root('original'),f.evidenceOriginal);
  assert.deepEqual(bundle.headers,f.traces.map((trace,traceIndex)=>({kind:'trace',traceIndex,application:trace.application})));
  const expectedStatements=[];let flatEntry=0,acknowledgements=0;
  for(const [traceIndex,trace] of f.traces.entries())for(const [entryIndex,entry] of trace.records.entries()){
    const context={traceIndex,entryIndex},metadata={...entry};delete metadata.statements;delete metadata.result;
    assert.deepEqual(bundle.root('entry',context),metadata,'All recorded error/accounting metadata is exact');
    for(const [statementIndex,statement] of entry.statements.entries()){
      const address={...context,statementIndex};expectedStatements.push({kind:'statement',...address});
      assert.equal(bundle.root('sql',address),statement.sql);
      assert.deepEqual(bundle.root('typedBindings',address),expectedTyped[flatEntry][statementIndex]);
    }
    if(Object.hasOwn(entry,'result')){
      assert.deepEqual(bundle.root('ack',context),entry.result,'ACK metadata, absent array slots, own undefined fields and row order survive');
      acknowledgements+=Array.isArray(entry.result)?entry.result.length:1;
    }flatEntry++;
  }
  assert.deepEqual(bundle.statements,expectedStatements,'Every original statement occurrence has its original address and order');
  assert.equal(bundle.completion.counts.traces,2);assert.equal(bundle.completion.counts.entries,3);
  assert.equal(bundle.completion.counts.statements,4);assert.equal(bundle.completion.counts.acknowledgements,acknowledgements);
  bundle.finish();
});

test('Audio finite trace persistence retains partial files and the identical write error without completion',t=>{
  const f=traceEvidenceFixture(t),sentinel=Object.assign(new Error('Synthetic trace write sentinel'),{code:'E_TRACE_SENTINEL'});
  f.traces=[{application:'synthetic evidence only',records:[{kind:'all',statements:[
    {sql:'FAIL marker for an exact statement-address persistence failure',bindings:[]}
  ],result:{success:true,results:[],meta:{changes:0}},returnedBytes:0}]}];
  const before=readdirSync(f.evidenceDirectory),marker=Buffer.from('FAIL','utf16le');let nativeWrites=0,injected=false;
  assert.throws(()=>persistActualTrace(f,{...f.sourceBefore},{chunkBytes:8,write(fd,buffer,offset,length){
    const actual=writeSync(fd,buffer,offset,length);nativeWrites++;
    if(!injected&&length===marker.length&&buffer.subarray(offset,offset+length).equals(marker)){
      injected=true;throw sentinel;
    }return actual;
  }}),error=>error===sentinel,'Persistence rethrows the original write error object');
  assert.equal(injected,true,'The failure occurs only after a real SQL chunk write');assert.ok(nativeWrites>5);
  const added=readdirSync(f.evidenceDirectory).filter(name=>!before.includes(name));assert.equal(added.length,1);
  const directory=join(f.evidenceDirectory,added[0]);assert.equal(existsSync(join(directory,'completion.json')),false);
  const failure=JSON.parse(readFileSync(join(directory,'failure.json'),'utf8'));
  assert.equal(failure.format,'forma-audio-actual-trace@1');assert.equal(failure.captureComplete,false);
  assert.equal(failure.testName,t.name);assert.equal(failure.directory,directory);
  assert.deepEqual(failure.error,{name:'Error',message:sentinel.message,code:sentinel.code});
  assert.equal(failure.address.traceIndex,0);assert.equal(failure.address.entryIndex,0);assert.equal(failure.address.statementIndex,0);
  assert.equal(failure.address.root,'sql');assert.equal(failure.address.phase,'blob-write');
  assert.equal(failure.address.chunkOffset,0);assert.equal(typeof failure.address.blobId,'string');
  assert.ok(failure.completed.indexBytes>0);assert.ok(readFileSync(join(directory,'index.jsonl')).length>0);
  assert.deepEqual(readFileSync(join(directory,'pieces',`${failure.address.blobId}.bin`)),marker,
    'The exact successfully written SQL chunk remains in the incomplete bundle');
});


// Pure packing units only. Current source is selected as one complete private
// declaration; no native owner/State or database result is fabricated here.
function audioProofPackMemoFactory(t){
  const url=new URL('../worker/experience-sponsor-audio-output-reads.ts',import.meta.url),filename=fileURLToPath(url);
  const source=readFileSync(url,'utf8'),file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length,0,'The current complete module must parse');
  const one=(items,label)=>{assert.equal(items.length,1,label);return items[0];};
  const collect=(root,predicate)=>{const result=[];const visit=node=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit);};visit(root);return result;};
  const named=(node,name)=>ts.isIdentifier(node)&&node.text===name;
  const calls=(root,name)=>collect(root,node=>ts.isCallExpression(node)&&named(node.expression,name));
  const declaration=name=>one(file.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name),`One complete ${name} declaration`);
  const factory=declaration('createSponsorAudioProofPackMemo'),compose=declaration('composeRows'),database=declaration('nativeDatabase');
  assert.equal(factory.modifiers?.some(item=>[ts.SyntaxKind.ExportKeyword,ts.SyntaxKind.DefaultKeyword].includes(item.kind))??false,false);
  const compact=node=>node.getText(file).replace(/\s+/gu,'');
  const ancestor=(node,predicate)=>{for(let at=node.parent;at;at=at.parent)if(predicate(at))return at;assert.fail('Expected source ownership boundary');};
  // Supplementary wiring correspondence; this does not qualify native authority.
  const allocation=one(calls(file,'createSponsorAudioProofPackMemo'),'One batch-local factory allocation');
  assert.ok(allocation.pos>database.pos&&allocation.end<database.end);assert.equal(compact(allocation.arguments[0]),'captured.length');
  const condition=allocation.parent;assert.ok(ts.isConditionalExpression(condition));assert.equal(condition.whenTrue,allocation);
  assert.equal(condition.whenFalse.kind,ts.SyntaxKind.NullKeyword);
  assert.equal(compact(condition.condition),'laterOperation(state)&&descriptors.every(item=>["proof","later-proof"].includes(item.kind))');
  const memoDeclaration=ancestor(allocation,ts.isVariableDeclaration);assert.ok(named(memoDeclaration.name,'memo'));
  const allCompose=calls(file,'composeRows'),supplied=one(allCompose.filter(call=>call.arguments.length===5),'Only one composeRows call receives a memo and catalog token');
  assert.equal(compact(supplied.arguments[3]),'memo');assert.equal(compact(supplied.arguments[2]),'maximum');
  assert.equal(compact(supplied.arguments[4]),'catalogEncoding??undefined');
  for(const call of allCompose)if(call!==supplied)assert.equal(call.arguments.length,3,'Other initial/single-read call sites retain the direct path');
  const mapping=ancestor(supplied,node=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='map');
  assert.equal(compact(mapping.expression),'inputs.map');
  const scope=ancestor(mapping,ts.isTryStatement);assert.ok(scope.finallyBlock);assert.equal(compact(scope.finallyBlock),'{if(catalogEncoding)catalogBatchEncodings.delete(catalogEncoding);memo?.retire();}');
  assert.ok(allocation.end<scope.pos);const statements=scope.parent.statements;assert.ok(statements);
  const position=statements.indexOf(scope);assert.ok(position>=0);
  assert.equal(compact(statements[position+1]),'state.data.account({bytes:0,queries:captured.length,rows:0});');
  const dispatch=statements[position+2];assert.ok(ts.isVariableStatement(dispatch));
  const raw=one(dispatch.declarationList.declarations.filter(item=>named(item.name,'raw')),'Original raw dispatch follows retirement/accounting');
  assert.ok(ts.isAwaitExpression(raw.initializer));assert.ok(compact(raw.initializer.expression).startsWith('state.data.wait('));
  const packed=one(collect(compose,node=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&compact(node.expression)==='memo.pack'),'One final packing lookup');
  assert.equal(compact(packed.arguments[0]),'sql');assert.equal(compact(packed.arguments[1]),'bindings');
  assert.ok(ts.isConditionalExpression(packed.parent));assert.equal(compact(packed.parent.whenFalse),'packSponsorIntakeReadQuery(sql,bindings)');
  const provenance=packed.arguments[2];assert.ok(ts.isArrayLiteralExpression(provenance));assert.equal(provenance.elements.length,9);
  assert.deepEqual(provenance.elements.slice(0,8).map(compact),['input.sql','b','input.columns','input.invalidRow','input.maximumRows','maximum','mandatoryCount','transportCount']);
  assert.equal(compact(provenance.elements[8]),'packingProofs!.map(proof=>[proof.sql,proof.bindings??[],proof.deadlineMs===undefined?null:proof.deadlineMs])');
  assert.equal(compact(compose.body.statements[0]),'current(state);');
  for(const name of ['capturedProof','sharedAudioIntakePrincipals','sharedAudioPrincipalRows'])assert.ok(one(calls(compose,name),`${name} remains before lookup`).end<packed.pos);
  for(const name of ['sql','bindings'])assert.ok(one(collect(compose,node=>ts.isVariableDeclaration(node)&&named(node.name,name)),`${name} is assembled before lookup`).end<packed.pos);
  const push=one(collect(compose,node=>ts.isCallExpression(node)&&compact(node.expression)==='packingProofs?.push'),'Capture every pre-dedup proof');
  const dedup=one(collect(compose,node=>ts.isCallExpression(node)&&compact(node.expression)==='proofs.some'),'Original proof dedup remains');
  assert.ok(one(calls(compose,'capturedProof'),'Capture proof before retaining key').end<push.pos&&push.end<dedup.pos);
  const text=factory.getText(file),packer=readFileSync(new URL('../worker/experience-sponsor-intake-read-sql.ts',import.meta.url));
  t.diagnostic(JSON.stringify({evidence:'pure-packing-source-unit-only',sourceSha256:traceHash(source),declarationSha256:traceHash(text),packerSha256:traceHash(packer)}));
  // Current realm preserves ordinary Array.prototype checks; this is not a sandbox.
  const extract=compileFunction(`"use strict";\n${stripTypeScriptTypes(text)}\nreturn createSponsorAudioProofPackMemo;`,['packSponsorIntakeReadQuery'],{filename});
  return extract(packSponsorIntakeReadQuery);
}
const memoPackingParity=(actual,sql,bindings)=>{
  const expected=packSponsorIntakeReadQuery(sql,bindings);assert.equal(actual.sql,expected.sql);assert.deepEqual(actual.bindings,expected.bindings);return actual;
};
const memoPackingProvenance=()=>[
  'SELECT ? AS current, ? AS other, ? AS label',[0,null,'input'],['current','other','label'],'row.current IS NOT 1',1,65536,1,1,
  [['EXISTS(SELECT 1 WHERE ?=?)',['actor-a','actor-b'],2000],['? IS ?',[0,null],null],['?=?',[2,3],0]]
];
const freezeMemoKey=value=>{if(Array.isArray(value)){value.forEach(freezeMemoKey);Object.freeze(value);}return value;};

test('Audio finite pure proof packing memo preserves exact keys, provenance and immutable reuse',t=>{
  const createMemo=audioProofPackMemoFactory(t),memo=createMemo(128);assert.ok(memo);
  const sql='SELECT ? AS a, ? AS b, ? AS c',bindings=Object.freeze([0,null,'tail']),provenance=freezeMemoKey(memoPackingProvenance());
  const first=memoPackingParity(memo.pack(sql,bindings,provenance),sql,bindings);
  assert.ok(Object.isFrozen(first));assert.ok(Object.isFrozen(first.bindings));
  assert.equal(memo.pack(sql,structuredClone(bindings),structuredClone(provenance)),first,'Independent equal-content keys reuse the immutable packed object');
  const miss=(label,nextSql,nextBindings,nextProvenance)=>{
    const actual=memoPackingParity(memo.pack(nextSql,nextBindings,nextProvenance),nextSql,nextBindings);
    assert.notEqual(actual,first,label);assert.equal(memo.pack(nextSql,structuredClone(nextBindings),structuredClone(nextProvenance)),actual,`${label}: changed key remains eligible`);return actual;
  };
  const negative=miss('signed zero',sql,[-0,null,'tail'],provenance);assert.equal(negative.bindings[0],'[-0.0,null,"tail"]');
  assert.equal(first.bindings[0],'[0,null,"tail"]');
  for(const [label,nextSql,nextBindings] of [
    ['SQL bytes',`${sql} /* distinct */`,[0,null,'tail']],['zero to null',sql,[null,null,'tail']],
    ['null to text',sql,[0,'null','tail']],['scalar value',sql,[0,null,'different']],
    ['scalar order',sql,[null,0,'tail']],['valid SQL/vector length','SELECT ? AS a, ? AS b',[0,null]]
  ])miss(label,nextSql,nextBindings,provenance);
  const changes=[
    ['input SQL',p=>{p[0]+=' /* input only */';}],['input scalar',p=>{p[1][2]='changed';}],
    ['input signed zero',p=>{p[1][0]=-0;}],['input null to zero',p=>{p[1][1]=0;}],['input null to text',p=>{p[1][1]='null';}],
    ['input order',p=>{p[1].reverse();}],['input length',p=>{p[1].push('more');}],
    ['column name',p=>{p[2][0]='changed';}],['column order',p=>{p[2].reverse();}],['column length',p=>{p[2].pop();}],
    ['invalid row predicate',p=>{p[3]+=' OR row.other IS NULL';}],['row cap',p=>{p[4]++;}],['byte cap',p=>{p[5]++;}],
    ['mandatory proof boundary',p=>{p[6]=0;}],['transport proof boundary',p=>{p[7]=0;}],
    ['proof order',p=>{p[8].reverse();}],['proof removal',p=>{p[8].pop();}],
    ['duplicate pre-dedup proof',p=>{p[8].push(structuredClone(p[8][0]));}]
  ];
  for(let at=0;at<provenance[8].length;at++){
    changes.push([`proof ${at} SQL`,p=>{p[8][at][0]+=' /* proof only */';}],
      [`proof ${at} binding order`,p=>{p[8][at][1].reverse();}],
      [`proof ${at} binding length`,p=>{p[8][at][1].push('more');}],
      [`proof ${at} deadline`,p=>{p[8][at][2]=p[8][at][2]===null?4000:p[8][at][2]+1;}]);
    for(let index=0;index<provenance[8][at][1].length;index++)changes.push([`proof ${at} scalar ${index}`,p=>{p[8][at][1][index]='different scalar';}]);
  }
  changes.push(['proof binding signed zero',p=>{p[8][1][1][0]=-0;}],['proof binding null to zero',p=>{p[8][1][1][1]=0;}],
    ['proof binding null to text',p=>{p[8][1][1][1]='null';}],['proof deadline signed zero',p=>{p[8][2][2]=-0;}]);
  for(const [label,change] of changes){const changed=structuredClone(provenance);change(changed);miss(label,sql,bindings,freezeMemoKey(changed));}
  assert.equal(memo.pack(sql,bindings,provenance),first,'The original positive entry survives every provenance-only miss');
  let getterReads=0;const accessor=[null];Object.defineProperty(accessor,'0',{enumerable:true,configurable:true,get(){getterReads++;throw Error('The provenance getter must not run');}});
  for(const unsupported of [[{}],[new Array(1)],[accessor]]){
    const a=memoPackingParity(memo.pack(sql,bindings,unsupported),sql,bindings),b=memoPackingParity(memo.pack(sql,bindings,unsupported),sql,bindings);
    assert.notEqual(a,b,'Unsupported provenance delegates genuine packing without retention');assert.notEqual(a,first);
    assert.equal(memo.pack(sql,bindings,provenance),first);
  }
  assert.equal(getterReads,0);
  const mutableBindings=[0,null,'tail'],mutableProvenance=memoPackingProvenance(),snapshotMemo=createMemo(8);
  const saved=memoPackingParity(snapshotMemo.pack(sql,mutableBindings,mutableProvenance),sql,mutableBindings);
  const originalBindings=structuredClone(mutableBindings),originalProvenance=structuredClone(mutableProvenance);
  mutableBindings[0]=-0;const changedBinding=memoPackingParity(snapshotMemo.pack(sql,mutableBindings,mutableProvenance),sql,mutableBindings);
  assert.notEqual(changedBinding,saved);assert.equal(snapshotMemo.pack(sql,originalBindings,originalProvenance),saved);
  mutableBindings[0]=0;assert.equal(snapshotMemo.pack(sql,mutableBindings,mutableProvenance),saved);
  mutableProvenance[8][0][1][0]='changed after insertion';
  assert.notEqual(memoPackingParity(snapshotMemo.pack(sql,mutableBindings,mutableProvenance),sql,mutableBindings),saved);
  assert.equal(snapshotMemo.pack(sql,originalBindings,originalProvenance),saved);
  mutableProvenance[8][0][1][0]=originalProvenance[8][0][1][0];assert.equal(snapshotMemo.pack(sql,mutableBindings,mutableProvenance),saved);
  assert.equal(Object.isFrozen(mutableBindings),false);assert.equal(Object.isFrozen(mutableProvenance[8][0][1]),false);
  snapshotMemo.retire();memo.retire();
});

test('Audio finite pure proof packing memo leaves failures uncached and retires within its batch',t=>{
  const createMemo=audioProofPackMemoFactory(t),sql='SELECT ? AS current',provenance=freezeMemoKey(memoPackingProvenance()),memo=createMemo(8);assert.ok(memo);
  const first=memoPackingParity(memo.pack(sql,[7],provenance),sql,[7]);assert.equal(memo.pack(sql,[7],provenance),first);
  const invalid=()=>{let found;assert.throws(()=>memo.pack(sql,[],provenance),error=>{
    found=error;return error instanceof SponsorIntakeReadQueryError&&error.code==='sponsor_intake_read_query_invalid';
  });return found;};
  const failureA=invalid(),failureB=invalid();assert.notEqual(failureA,failureB,'Real packer errors are not reused');
  assert.equal(memo.pack(sql,[7],provenance),first,'Failed shorter binding vectors cannot replace or alias the successful entry');
  const corrected=memoPackingParity(memo.pack(sql,[8],provenance),sql,[8]);assert.notEqual(corrected,first);assert.equal(memo.pack(sql,[8],provenance),corrected);
  const separate=createMemo(8),separateFirst=memoPackingParity(separate.pack(sql,[7],provenance),sql,[7]);
  assert.notEqual(separateFirst,first);assert.equal(separate.pack(sql,[7],provenance),separateFirst);assert.equal(memo.pack(sql,[7],provenance),first);
  const capacityOne=createMemo(1),retained=memoPackingParity(capacityOne.pack(sql,[7],provenance),sql,[7]);
  const overflowA=memoPackingParity(capacityOne.pack(sql,[8],provenance),sql,[8]),overflowB=memoPackingParity(capacityOne.pack(sql,[8],provenance),sql,[8]);
  assert.notEqual(overflowA,overflowB);assert.notEqual(overflowA,retained);assert.equal(capacityOne.pack(sql,[7],provenance),retained,'A full memo preserves its first entry');
  const overQuotaProvenance=['q'.repeat(4*1024*1024)];
  const overQuotaA=memoPackingParity(memo.pack(sql,[7],overQuotaProvenance),sql,[7]),overQuotaB=memoPackingParity(memo.pack(sql,[7],overQuotaProvenance),sql,[7]);
  assert.notEqual(overQuotaA,overQuotaB,'Over-quota provenance delegates genuine packing without retention');
  assert.notEqual(overQuotaA,first);assert.notEqual(overQuotaB,first);
  assert.equal(memo.pack(sql,[7],provenance),first,'Over-quota fallback preserves the earlier eligible entry');
  for(const invalidCapacity of [0,-1,1.5,1001,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(createMemo(invalidCapacity),null);
  memo.retire();memo.retire();
  for(const value of [7,8,9]){
    const a=memoPackingParity(memo.pack(sql,[value],provenance),sql,[value]),b=memoPackingParity(memo.pack(sql,[value],provenance),sql,[value]);
    assert.notEqual(a,b,'Retirement permanently bypasses retention');assert.notEqual(a,first);assert.notEqual(a,corrected);
  }
  assert.notEqual(invalid(),invalid(),'Retirement preserves real invalid-query errors');
  assert.equal(separate.pack(sql,[7],provenance),separateFirst,'Retiring one factory does not affect another');
  separate.retire();capacityOne.retire();
});


// These are pure SQL-encoder units, not principal/owner/receipt admission.
// Select complete current private declarations in the existing realm. The
// independent native guard is read as source only; no fake user is passed to it.
async function audioPrincipalDepthUnits(t){
  const url=new URL('../worker/experience-sponsor-audio-output-reads.ts',import.meta.url),filename=fileURLToPath(url);
  const nativeUrl=new URL('../worker/intake-authority.ts',import.meta.url),source=readFileSync(url,'utf8'),nativeSource=readFileSync(nativeUrl,'utf8');
  const file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const nativeFile=ts.createSourceFile(fileURLToPath(nativeUrl),nativeSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length,0);assert.equal(nativeFile.parseDiagnostics.length,0);
  const one=(items,label)=>{assert.equal(items.length,1,label);return items[0];};
  const collect=(root,predicate)=>{const result=[];const visit=node=>{if(predicate(node))result.push(node);ts.forEachChild(node,visit);};visit(root);return result;};
  const named=(node,name)=>ts.isIdentifier(node)&&node.text===name,compact=(node,owner=file)=>node.getText(owner).replace(/\s+/gu,'');
  const names=['same','audioIntakePrincipalLeaf','audioPrincipalColumns','audioEvidencePrincipalColumns','audioPrincipalWrappers',
    'audioOriginalPrincipalJsonColumns','audioOriginalPrincipalBound','audioOriginalPrincipalWrapper','audioPrincipalFragment','sharedAudioPrincipalRows'];
  const selected=names.map(name=>one(file.statements.filter(node=>
    ts.isFunctionDeclaration(node)?node.name?.text===name:ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>named(item.name,name))),`One complete ${name}`));
  for(const node of selected){
    assert.equal(node.modifiers?.some(item=>[ts.SyntaxKind.ExportKeyword,ts.SyntaxKind.DefaultKeyword].includes(item.kind))??false,false);
    if(ts.isVariableStatement(node))assert.equal(node.declarationList.declarations.length,1,'No unrelated declaration is extracted');
  }
  const nativeGuard=one(nativeFile.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='executionAdmissionGuard'),'The native admission guard');
  const returned=one(collect(nativeGuard,node=>ts.isReturnStatement(node)&&node.expression&&ts.isObjectLiteralExpression(node.expression)
    &&node.expression.properties.some(property=>ts.isPropertyAssignment(property)&&named(property.name,'sql')&&ts.isTemplateExpression(property.initializer))),
    'The one native guarded SQL return').expression;
  const property=name=>one(returned.properties.filter(node=>ts.isPropertyAssignment(node)&&named(node.name,name)),`Native ${name}`).initializer;
  const template=property('sql');assert.ok(ts.isTemplateExpression(template));assert.equal(template.head.text,'EXISTS(SELECT 1 FROM(');
  assert.ok(named(template.templateSpans[0].expression,'PRINCIPAL_WITH_ACCESS_SQL'));
  const suffix=template.templateSpans[0].literal.text.trimEnd();assert.ok(suffix.endsWith(')'));
  const bindingsNode=property('bindings');assert.ok(ts.isAsExpression(bindingsNode));assert.ok(ts.isArrayLiteralExpression(bindingsNode.expression));
  const nativeBindings=bindingsNode.expression.elements.slice(0,11).map(node=>compact(node,nativeFile));
  assert.deepEqual(nativeBindings,['user.userId','user.userId','user.role','snapshot.updatedAt','POLICY_VERSION','snapshot.rawEpoch',
    'snapshot.grants','snapshot.organizations','snapshot.projects','snapshot.identityPolicies','snapshot.canvasRequirements']);
  assert.ok(ts.isSpreadElement(bindingsNode.expression.elements[11]),'Custody/head bindings follow the eleven principal bindings');
  const fields=['user_id','role','updated_at','consent_version','permission_epoch','grants_json','organizations_json','projects_json','identity_policies_json','approved_canvas_requirements'];
  const predicates=['principal.user_id=?','principal.role=?','principal.updated_at=?','principal.consent_version=?',
    "COALESCE(principal.permission_epoch,'')=?","COALESCE(principal.grants_json,'[]')=?","COALESCE(principal.organizations_json,'[]')=?",
    "COALESCE(principal.projects_json,'[]')=?","COALESCE(principal.identity_policies_json,'[]')=?",'COALESCE(principal.approved_canvas_requirements,0)=?'];
  assert.equal(suffix.replace(/\s+/gu,' '),`) principal WHERE ${predicates.join(' AND ')})`,'Independent native ten-predicate order');
  const {PRINCIPAL_WITH_ACCESS_SQL:principalSql}=await import('../worker/access-policy.ts');
  const declarations=selected.map(node=>node.getText(file)).join('\n');
  const units=compileFunction(`"use strict";\n${stripTypeScriptTypes(declarations)}\nreturn {audioIntakePrincipalLeaf,audioPrincipalFragment,sharedAudioPrincipalRows,audioPrincipalWrappers,audioOriginalPrincipalWrapper};`,
    ['PRINCIPAL_WITH_ACCESS_SQL'],{filename})(principalSql);
  const nativeLeaf=template.head.text+principalSql+suffix;assert.equal(units.audioIntakePrincipalLeaf,nativeLeaf,'Recognition matches actual native source, not a mirrored test helper');
  // Supplementary wiring check: the unit does not exercise C/owner authority.
  const sharing=one(collect(file,node=>ts.isCallExpression(node)&&named(node.expression,'sharedAudioPrincipalRows')),'One row-sharing call');
  assert.ok(ts.isConditionalExpression(sharing.parent));assert.equal(sharing.parent.whenTrue,sharing);
  assert.equal(compact(sharing.parent.condition),'laterOperation(state)');
  assert.equal(compact(sharing.parent.whenFalse),'{definitions:sharedPrincipals.definitions,proofs:sharedPrincipals.proofs,row}');
  assert.deepEqual(sharing.arguments.map(node=>compact(node)),['sharedPrincipals.definitions','sharedPrincipals.proofs','row','prefix','state.auth.user.userId','state.data.assertions']);
  t.diagnostic(JSON.stringify({evidence:'pure-intake-principal-sql-unit-only',sourceSha256:traceHash(source),declarationSha256:traceHash(declarations),
    nativeGuardSha256:traceHash(nativeGuard.getText(nativeFile)),principalSqlSha256:traceHash(principalSql),nativeBindings}));
  return {...units,principalSql,nativeLeaf,suffix,fields};
}
const depthPrincipalBindings=()=>['actor-selector','actor-value','creator','updated-at','consent-version','epoch-value','["grant"]','["organization"]','["project"]','["identity"]',7];

test('Audio finite pure intake count encoding retains the closed native wrapper and actor boundary',async t=>{
  const u=await audioPrincipalDepthUnits(t),bindings=depthPrincipalBindings(),actor=bindings[0],prefix='depth_unit';
  const definition={name:'intake_truth',sql:`SELECT (${u.nativeLeaf}) AS value`,bindings},row={sql:u.principalSql,bindings:[actor]};
  const before=structuredClone({definition,row});
  const result=u.sharedAudioPrincipalRows([definition],[],row,prefix,actor,[]),relation=result.definitions[0];
  assert.deepEqual(relation,{name:`${prefix}_principal_rows_0`,sql:u.principalSql,bindings:[actor]});
  assert.equal(result.definitions.length,2);const encoded=result.definitions[1];
  assert.equal(encoded.name,definition.name);
  assert.equal(encoded.sql,`SELECT COUNT(*)>0 AS value FROM ${relation.name}${u.suffix.slice(1,-1)}`);
  assert.deepEqual(encoded.bindings,bindings.slice(1));assert.equal(encoded.bindings.length,10);
  assert.deepEqual(result.row,{sql:`SELECT * FROM ${relation.name}`,bindings:[]});
  assert.deepEqual({definition,row},before,'Pure encoding preserves original SQL/vector inputs');
  for(const last of [0,-0,null,'7']){
    const vector=bindings.slice();vector[10]=last;
    const changed=u.sharedAudioPrincipalRows([{...definition,bindings:vector}],[],row,prefix,actor,[]).definitions[1];
    assert.equal(changed.sql,encoded.sql);assert.deepEqual(changed.bindings,vector.slice(1));assert.ok(Object.is(changed.bindings[9],last));
  }
  const fragment=u.audioPrincipalFragment(definition,true,false);assert.equal(fragment.directRelation,true);
  assert.equal(u.audioPrincipalFragment(definition,false,false),null,'The leaf is eligible only as the closed intake definition');
  for(const mutated of [
    {...definition,sql:definition.sql+' '},{...definition,sql:definition.sql.replace('principal.role=?','principal.role IS ?')},
    {...definition,sql:definition.sql.replace(' AS value',' AS other')},{...definition,sql:`WITH other AS (SELECT 1) ${definition.sql}`},
    {...definition,sql:definition.sql.replace(u.principalSql,u.principalSql+' LIMIT 1')},{...definition,sql:definition.sql+' GROUP BY value'},
    {...definition,bindings:bindings.slice(0,-1)},{...definition,bindings:[...bindings,'extra']}
  ]){
    assert.equal(u.audioPrincipalFragment(mutated,true,false),null);
    const fallback=u.sharedAudioPrincipalRows([mutated],[],row,prefix,actor,[]);
    assert.deepEqual(fallback,{definitions:[mutated],proofs:[],row},'Unknown shape or arity retains the complete original fragment');
  }
  for(const selector of ['payer-selector',1,null]){
    const other={...definition,bindings:[selector,...bindings.slice(1)]};
    assert.deepEqual(u.sharedAudioPrincipalRows([other],[],row,prefix,actor,[]),{definitions:[other],proofs:[],row},'Only the exact typed actor selector is eligible');
  }
  const lone={sql:'SELECT 1 AS value',bindings:[]};
  assert.deepEqual(u.sharedAudioPrincipalRows([definition],[],lone,prefix,actor,[]),{definitions:[definition],proofs:[],row:lone},'One eligible use cannot create a shared relation');
  const payerRow={sql:u.principalSql,bindings:['payer-selector']},payer={...definition,bindings:['payer-selector',...bindings.slice(1)]};
  assert.deepEqual(u.sharedAudioPrincipalRows([payer],[],payerRow,prefix,actor,[]),{definitions:[payer],proofs:[],row:payerRow},'Two payer uses cannot become actor sharing');
  for(const scalar of [0,-0]){
    const typedRow={sql:u.principalSql,bindings:[scalar]},typed={...definition,bindings:[scalar,...bindings.slice(1)]};
    assert.deepEqual(u.sharedAudioPrincipalRows([typed],[],typedRow,prefix,'0',[]),{definitions:[typed],proofs:[],row:typedRow},'Numeric and text selectors never share');
  }
  const proof={sql:definition.sql,bindings,deadlineMs:100};
  assert.deepEqual(u.sharedAudioPrincipalRows([], [proof],row,prefix,actor,[]),{definitions:[],proofs:[proof],row},'An identical leaf used as a proof is not an intake definition');
  const wrappers=[...u.audioPrincipalWrappers,u.audioOriginalPrincipalWrapper];
  for(const wrapper of wrappers){
    const original=wrapper===u.audioOriginalPrincipalWrapper,wrapped={sql:wrapper.before+u.principalSql+wrapper.after,bindings:[actor,'snapshot'],deadlineMs:100};
    const parsed=u.audioPrincipalFragment(wrapped,false,original);assert.deepEqual(parsed,wrapper);assert.equal(parsed.directRelation,undefined);
    const shared=u.sharedAudioPrincipalRows([], [wrapped],row,prefix,actor,original?[wrapped]:[]);
    assert.deepEqual(shared.proofs,[{...wrapped,sql:wrapper.before+`SELECT * FROM ${relation.name}`+wrapper.after,bindings:['snapshot']}]);
    assert.equal(shared.definitions[0].sql,u.principalSql);assert.equal(shared.proofs[0].sql.includes('COUNT(*)>0'),false,'Existing native wrappers keep their previous encoding');
    if(original)assert.deepEqual(u.sharedAudioPrincipalRows([], [wrapped],row,prefix,actor,[]),{definitions:[],proofs:[wrapped],row},'Original-C wrapper shape alone is insufficient');
  }
});

test('Audio finite pure intake count and native exists agree for empty duplicate false and null rows',{timeout:90000},async t=>{
  const u=await audioPrincipalDepthUnits(t),vector=depthPrincipalBindings(),actor=vector[0];
  const encoded=u.sharedAudioPrincipalRows([{name:'intake_truth',sql:`SELECT (${u.nativeLeaf}) AS value`,bindings:vector}],[],
    {sql:u.principalSql,bindings:[actor]},'depth_truth',actor,[]);
  const relation=encoded.definitions[0].name,actualSql=encoded.definitions[1].sql;
  assert.equal(encoded.definitions[0].sql,u.principalSql);assert.deepEqual(encoded.definitions[0].bindings,[actor]);
  // Substitute only the common row source for an inert relation. No actual
  // principal, policy, owner, receipt or native application authority is created.
  const originalSql=`SELECT (EXISTS(SELECT 1 FROM(SELECT * FROM ${relation}${u.suffix}) AS value`;
  assert.equal(originalSql,`SELECT (${u.nativeLeaf.replace(u.principalSql,`SELECT * FROM ${relation}`)}) AS value`);
  const {DatabaseSync}=await import('node:sqlite'),{compileSqliteExpressionDepth}=await import('./helpers/d1-expression-depth.mjs');
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE ${relation}(${u.fields.map(name=>`"${name}" ANY`).join(',')}) STRICT`);
  const caps={functionArguments:32,parameters:100,sqlBytes:100000};
  for(const [kind,sql] of [['native-exists',originalSql],['actual-encoder-count',actualSql]]){
    const compiled=compileSqliteExpressionDepth(db,sql,{limit:100,bindings:vector.slice(1),queryLimits:caps});
    assert.equal(compiled.ok,true,compiled.error);assert.equal(compiled.limit,100);assert.deepEqual(compiled.queryLimits,caps);assert.equal(compiled.parameterCount,10);
    t.diagnostic(JSON.stringify({evidence:'strict-sqlite-prepare-only',kind,...compiled,compoundSelectLimit:5}));
  }
  const original=db.prepare(originalSql),actual=db.prepare(actualSql),insert=db.prepare(`INSERT INTO ${relation} VALUES(${u.fields.map(()=>'?').join(',')})`);
  const base=vector.slice(1);let cases=0;
  const check=(label,data,bindings,expected)=>{
    db.exec(`DELETE FROM ${relation}`);for(const values of data)insert.run(...values);
    const old=original.all(...bindings),next=actual.all(...bindings);assert.equal(old.length,1,label);assert.equal(next.length,1,label);
    assert.deepEqual(next,old,label);assert.equal(old[0].value,expected,label);assert.ok(old[0].value===0||old[0].value===1,label);cases++;
  };
  check('empty',[],base,0);check('one',[base],base,1);check('duplicates',[base,base],base,1);
  for(let at=0;at<u.fields.length;at++){
    const wrong=base.slice(),nulled=base.slice(),nullBinding=base.slice();wrong[at]=at===9?8:'different-value';nulled[at]=null;nullBinding[at]=null;
    check(`${u.fields[at]} false`,[wrong],base,0);check(`${u.fields[at]} NULL row`,[nulled],base,0);
    check(`${u.fields[at]} NULL binding`,[base,nulled],nullBinding,0);
    check(`${u.fields[at]} mixed true false NULL`,[wrong,nulled,base,base],base,1);
    const numeric=base.slice(),numericBinding=base.slice(),textNumeric=base.slice();numeric[at]=19;numericBinding[at]=19;textNumeric[at]='19';
    check(`${u.fields[at]} numeric match`,[numeric],numericBinding,1);
    check(`${u.fields[at]} numeric/text distinction`,[textNumeric],numericBinding,0);
  }
  const left=base.slice(),right=base.slice();left[0]='wrong-user';right[1]='wrong-role';
  check('Different failing rows cannot combine their predicates',[left,right],base,0);
  for(let at=4;at<u.fields.length;at++){
    const nullable=base.slice(),defaults=base.slice();nullable[at]=null;defaults[at]=at===4?'':at===9?0:'[]';
    check(`${u.fields[at]} native COALESCE default`,[nullable],defaults,1);
  }
  const zero=base.slice(),negativeZero=base.slice(),textZero=base.slice();zero[9]=0;negativeZero[9]=-0;textZero[9]='0';
  check('Numeric zero and negative zero',[zero,negativeZero],negativeZero,1);check('Text zero does not equal numeric COALESCE zero',[textZero],zero,0);
  t.diagnostic(JSON.stringify({evidence:'native-node-sqlite-pure-relation-truth-only',cases,sqliteVersion:db.prepare('SELECT sqlite_version() AS version').get().version}));
});


// Supplementary source correspondence only. Genuine owner/database controls
// qualify behavior separately; this test never constructs State or invokes it.
test('Audio finite catalog factoring retains private provenance, fallbacks and batch publication order',t=>{
  const url=new URL('../worker/experience-sponsor-audio-output-reads.ts',import.meta.url),filename=fileURLToPath(url);
  const source=readFileSync(url,'utf8'),file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(file.parseDiagnostics.length,0,'The complete current module parses');
  const one=(values,label)=>{assert.equal(values.length,1,label);return values[0];};
  const collect=(root,predicate)=>{const values=[];const visit=node=>{if(predicate(node))values.push(node);ts.forEachChild(node,visit);};visit(root);return values;};
  const compact=node=>node.getText(file).replace(/\s+/gu,'');
  const named=(node,name)=>ts.isIdentifier(node)&&node.text===name;
  const calls=(root,name)=>collect(root,node=>ts.isCallExpression(node)&&compact(node.expression)===name);
  const ancestor=(node,predicate)=>{for(let at=node.parent;at;at=at.parent)if(predicate(at))return at;assert.fail('Expected source ownership boundary');};
  const declaration=name=>one(file.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name),`Complete ${name} declaration`);
  const variable=(root,name)=>one(collect(root,node=>ts.isVariableDeclaration(node)&&named(node.name,name)),`One ${name} binding`);
  const privateDeclaration=node=>assert.equal(node.modifiers?.some(item=>[ts.SyntaxKind.ExportKeyword,ts.SyntaxKind.DefaultKeyword].includes(item.kind))??false,false);
  const disjunction=node=>ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.BarBarToken
    ?[...disjunction(node.left),...disjunction(node.right)]:[compact(node)];
  const begin=declaration('beginCatalogBatchEncoding'),carry=declaration('carriedCatalogProof'),compose=declaration('composeRows');
  const open=declaration('openSponsorAudioOutputReads'),database=declaration('nativeDatabase');
  for(const node of [begin,carry,compose]){privateDeclaration(node);assert.equal(collect(node,ts.isAwaitExpression).length,0,'Encoding helpers remain synchronous');}
  for(const name of ['laterCatalogProofs','nativeCatalogProofs','privateCatalogProofs','originalMetadataProofs','catalogBatchEncodings']){
    const node=variable(file,name),statement=ancestor(node,ts.isVariableStatement);privateDeclaration(statement);
    assert.equal(statement.parent,file);assert.ok(ts.isNewExpression(node.initializer));
    assert.equal(compact(node.initializer.expression),'WeakMap');assert.equal(node.initializer.arguments.length,0);
  }
  // Only the genuine later schema producer may register the exact captured
  // singleton. Equal SQL supplied by another caller earns no catalog identity.
  const register=one(calls(file,'laterCatalogProofs.set'),'Only one catalog registration');
  assert.equal(ancestor(register,ts.isFunctionDeclaration),open);assert.deepEqual(register.arguments.map(compact),['state','catalog']);
  const producerScope=ancestor(register,ts.isTryStatement),later=ancestor(producerScope,ts.isIfStatement);
  assert.equal(compact(later.expression),'laterOperation(state)');
  assert.equal(compact(variable(producerScope.tryBlock,'catalog').initializer),'capturedProof(awaitdata.wait(()=>sponsorAudioLaterSchemaProof()))');
  const transportAssignments=collect(file,node=>ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&compact(node.left)==='state.transportProofs');
  const transportAssignment=one(transportAssignments,'Only this producer assigns transport proofs');
  assert.equal(compact(transportAssignment),'state.transportProofs=[catalog]');
  assert.ok(transportAssignment.end<register.getStart(file));assert.ok(register.end<one(calls(producerScope.tryBlock,'current'),'Current validation after registration').getStart(file));
  assert.equal(compact(one(calls(declaration('capturedProof'),'Object.freeze').filter(call=>ts.isObjectLiteralExpression(call.arguments[0])),'Captured proof is frozen').expression),'Object.freeze');
  // Native registration comes only from the genuine checked plan producer and
  // resolves the exact immutable object retained by the original keepProofs.
  const nativeProducer=declaration('setSponsorAudioOutputNativePlan');
  const nativeRegister=one(calls(file,'nativeCatalogProofs.set'),'One native catalog registration');
  assert.equal(ancestor(nativeRegister,ts.isFunctionDeclaration),nativeProducer);
  assert.deepEqual(nativeRegister.arguments.map(compact),['state','retainedCatalog']);
  assert.equal(compact(variable(nativeProducer,'nativeCatalog').initializer),'capturedProof(sponsorAudioNativeSchemaProof())');
  assert.equal(compact(variable(nativeProducer,'retainedCatalog').initializer),'state.proofs.find(proof=>proof.sql===nativeCatalog.sql&&proof.deadlineMs===undefined&&same(proof.bindings??[],nativeCatalog.bindings??[]))');
  const nativeKeep=one(calls(nativeProducer,'keepProofs'),'Exact native producer retains through original path');
  assert.deepEqual(nativeKeep.arguments.map(compact),['state','[nativeCatalog]']);assert.ok(nativeKeep.end<nativeRegister.getStart(file));
  const nativeAbsent=one(nativeProducer.body.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression)==='!retainedCatalog'),'No synthesized native proof fallback');
  assert.equal(compact(nativeAbsent.thenStatement),'returnfail();');assert.ok(nativeAbsent.end<nativeRegister.getStart(file));
  // Original C producer provenance and the private-content catalog have separate
  // registrations. No string comparison alone can enter either private map.
  const originals=variable(producerScope.tryBlock,'originals'),originalCallback=originals.initializer.arguments[0];
  assert.equal(compact(originals.initializer.expression),'data.originalMetadataAssertions.map');
  assert.deepEqual(originalCallback.body.statements.map(compact),[
    'if(!data.assertions.includes(item))returnfail();',
    'constat=data.assertions.indexOf(item),retained=state.proofs[at];',
    'if(!retained||retained.sql!==item.sql||retained.deadlineMs!==undefined||!same(retained.bindings??[],item.bindings))returnfail();',
    'returnretained;',
  ]);
  const originalRegister=one(calls(file,'originalMetadataProofs.set'),'Only authentic original C metadata registration');
  assert.equal(ancestor(originalRegister,ts.isTryStatement),producerScope);
  assert.deepEqual(originalRegister.arguments.map(compact),['state','Object.freeze(originals)']);
  const originalShape=one(producerScope.tryBlock.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression).startsWith('originals.length')),'Closed 8-proof original group');
  assert.equal(compact(originalShape.expression),'originals.length!==8||newSet(originals).size!==originals.length');
  assert.equal(compact(originalShape.thenStatement),'returnfail();');assert.ok(originalShape.end<originalRegister.getStart(file));
  const privateRegister=one(calls(file,'privateCatalogProofs.set'),'One native private-content catalog registration');
  assert.equal(ancestor(privateRegister,ts.isFunctionDeclaration),nativeProducer);
  assert.equal(compact(ancestor(privateRegister,ts.isIfStatement).expression),'laterOperation(state)');
  assert.equal(compact(variable(nativeProducer,'privateCatalog').initializer),'sponsorAudioOutputPrivateCatalogProof(owner)');
  assert.equal(compact(variable(nativeProducer,'retainedPrivate').initializer),'privateCatalog&&state.proofs.find(proof=>proof.sql===privateCatalog.sql&&proof.deadlineMs===undefined&&same(proof.bindings??[],privateCatalog.bindings??[]))');
  assert.deepEqual(privateRegister.arguments.map(compact),['state','retainedPrivate']);
  assert.ok(ancestor(privateRegister,ts.isIfStatement).thenStatement.statements.some(node=>compact(node)==='if(!retainedPrivate)returnfail();'));
  // These are AST/source checks of the genuine producers, never fabricated C
  // capabilities. The only evaluated slice below is the pure group-size guard.
  const otherSource=name=>{
    const text=readFileSync(new URL(`../worker/${name}`,import.meta.url),'utf8');
    const ast=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0);
    const compact=node=>node.getText(ast).replace(/\s+/gu,'');
    return {ast,text,compact,fn:name=>one(ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name),name),
      variable:(root,name)=>one(collect(root,node=>ts.isVariableDeclaration(node)&&named(node.name,name)),name)};
  };
  const c=otherSource('experience-sponsor-audio-output-attempts.ts'),reserve=c.fn('reserveSponsorAudioOutputReadAttempt'),cvar=name=>c.variable(reserve,name);
  for(const [name,origin]of [['principalAssertions','principal'],['storedAssertions','stored'],['intakeAssertions','intake'],['approvedAssertions','approved']])
    assert.equal(c.compact(cvar(name).initializer),`${origin}.assertions.map(proof)`);
  assert.equal(c.compact(cvar('originalMetadataAssertions').initializer),'freeze([...storedAssertions,...intakeAssertions,...approvedAssertions,schemaProof(),proof(sink.assertion)])');
  assert.equal(c.compact(cvar('assertions').initializer),'freeze([...principalAssertions,...originalMetadataAssertions,validity])');
  assert.equal(c.compact(cvar('validity').initializer),'{sql:`${clock}>=?AND${clock}<?`,bindings:[approved.policy.startsAtMs,approved.policy.expiresAtMs]}');
  const group=one(collect(reserve,node=>ts.isIfStatement(node)&&c.compact(node.expression).includes('storedAssertions.length!==2')),'Exact later-only producer-group guard');
  assert.equal(c.compact(group.expression),'(selected.operation==="audio-output-review"||selected.operation==="audio-output-authorize")&&(storedAssertions.length!==2||intakeAssertions.length!==2||approvedAssertions.length!==2||originalMetadataAssertions.length!==8)');
  assert.equal(c.compact(group.thenStatement),'returnfailure();');
  const rejectsGroup=compileFunction(`return (${group.expression.getText(c.ast)});`,['selected','storedAssertions','intakeAssertions','approvedAssertions','originalMetadataAssertions']);
  const shapes=[[2,2,2,8],[1,2,2,8],[3,2,2,8],[2,1,2,8],[2,3,2,8],[2,2,1,8],[2,2,3,8],[2,2,2,7],[2,2,2,9]];
  for(const operation of ['audio-output-review','audio-output-authorize','audio-output-state','audio-output-prepare'])
    for(const [at,shape]of shapes.entries())assert.equal(rejectsGroup({operation},...shape.map(length=>Array(length))),at>0&&['audio-output-review','audio-output-authorize'].includes(operation));
  const budget=c.fn('requireSponsorAudioOutputReadBudget');
  assert.equal(collect(budget,node=>ts.isPropertyAssignment(node)&&named(node.name,'originalMetadataAssertions')).map(c.compact).join(','),'originalMetadataAssertions:state.originalMetadataAssertions');
  const n=otherSource('experience-sponsor-audio-output-native.ts'),negative=n.fn('negativeAssociations');
  const sets=collect(n.ast,node=>ts.isCallExpression(node)&&n.compact(node.expression)==='privateCatalogProofs.set');
  const actualRegister=one(sets,'Only actual negative-family proof producer registers the catalog');
  assert.equal(ancestor(actualRegister,ts.isFunctionDeclaration),negative);assert.deepEqual(actualRegister.arguments.map(n.compact),['owner','proofs[2]!']);
  assert.equal(n.compact(ancestor(actualRegister,ts.isIfStatement).expression),'view.operation==="audio-output-review"||view.operation==="audio-output-authorize"');
  assert.equal(n.compact(n.variable(negative,'proofs').initializer),'[copy(imageProof),copy(storyProof),copy(privateProof)]');
  assert.equal(n.compact(n.variable(negative,'privateProof').initializer),'{sql:`EXISTS(SELECT1FROM(${privateSchemaQuery})WHEREsnapshot=?)AND(${privateShape})`,bindings:[privateRow.snapshot]}');
  const checked=one(negative.body.statements.filter(node=>ts.isIfStatement(node)&&n.compact(node.expression)==='current.result.results[0]?.current!==1'),'Actual final private proof truth check');
  assert.equal(n.compact(checked.thenStatement),'returnfail();');assert.ok(checked.end<actualRegister.getStart(n.ast));
  assert.equal(n.compact(n.fn('sponsorAudioOutputPrivateCatalogProof').body),'{state(owner).view.current();returnprivateCatalogProofs.get(owner);}');
  // Exact closed eligibility proves source-level initial/single/mixed fallbacks.
  assert.equal(compact(variable(begin,'proof').initializer),'laterCatalogProofs.get(state)');
  const eligible=one(begin.body.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression).startsWith('!laterOperation(state)')),'One closed eligibility guard');
  assert.deepEqual(disjunction(eligible.expression),[
    '!laterOperation(state)','inputs.length<2','inputs.length!==descriptors.length','!proof',
    'proof.deadlineMs!==undefined','state.transportProofs.length!==1','state.transportProofs[0]!==proof',
    'descriptors.some((value,at)=>!["proof","later-proof"].includes(value.kind)||value.maximumRows!==1||!same(value.columns,["current"])||inputs[at]!.maximumRows!==1||!same(inputs[at]!.columns,["current"]))',
  ]);
  assert.ok(ts.isReturnStatement(eligible.thenStatement));assert.equal(eligible.thenStatement.expression.kind,ts.SyntaxKind.NullKeyword);
  assert.equal(compact(variable(begin,'nativeProof').initializer),'nativeCatalogProofs.get(state)');
  assert.equal(compact(variable(begin,'nativeIndex').initializer),'nativeProof?state.proofs.indexOf(nativeProof):-1');
  const nativeGuard=one(begin.body.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression).startsWith('nativeProof&&')),'Exact retained native identity with no deadline');
  assert.equal(compact(nativeGuard.expression),'nativeProof&&(nativeIndex<0||nativeProof.deadlineMs!==undefined)');assert.equal(compact(nativeGuard.thenStatement),'returnfail();');
  assert.equal(compact(variable(begin,'privateProof').initializer),'privateCatalogProofs.get(state)');
  assert.equal(compact(variable(begin,'metadataProofs').initializer),'originalMetadataProofs.get(state)');
  const extraMap=variable(begin,'extra').initializer;
  assert.equal(compact(extraMap.expression.expression),'[...(metadataProofs??[]),...(privateProof?[privateProof]:[])]');
  const extraBody=extraMap.arguments[0].body;
  assert.deepEqual(extraBody.statements.map(compact),[
    'constindex=state.proofs.indexOf(item);',
    'if(index<0||item.deadlineMs!==undefined||item===nativeProof)returnfail();',
    'returnObject.freeze({proof:item,index});',
  ]);
  assert.ok(begin.body.statements.some(node=>compact(node)==='if(newSet(extra.map(item=>item.index)).size!==extra.length)returnfail();'));
  assert.equal(compact(variable(begin,'token').initializer),'Object.freeze({})');
  const tokenSet=one(calls(file,'catalogBatchEncodings.set'),'One batch token producer');
  assert.equal(ancestor(tokenSet,ts.isFunctionDeclaration),begin);assert.deepEqual(tokenSet.arguments.map(compact),['token','{state,proof,nativeProof,nativeIndex,privateProof,metadataProofs,extra:Object.freeze(extra),inputs,next:0}']);
  assert.equal(compact(begin.body.statements.at(-1)),'returntoken;');
  assert.equal(compact(variable(carry,'encoding').initializer),'catalogBatchEncodings.get(token)');
  const sequence=one(carry.body.statements.filter(ts.isIfStatement),'One token identity/order guard');
  assert.deepEqual(disjunction(sequence.expression),[
    '!encoding','encoding.state!==state','encoding.inputs[encoding.next]!==input','laterCatalogProofs.get(state)!==encoding.proof',
    'state.transportProofs.length!==1','state.transportProofs[0]!==encoding.proof','encoding.proof.deadlineMs!==undefined',
    'nativeCatalogProofs.get(state)!==encoding.nativeProof','encoding.nativeProof&&(encoding.nativeProof.deadlineMs!==undefined||state.proofs[encoding.nativeIndex]!==encoding.nativeProof)',
    'privateCatalogProofs.get(state)!==encoding.privateProof','originalMetadataProofs.get(state)!==encoding.metadataProofs',
    'encoding.extra.some(item=>item.proof.deadlineMs!==undefined||state.proofs[item.index]!==item.proof)',
  ]);
  assert.equal(compact(sequence.thenStatement),'returnfail();');
  assert.equal(compact(carry.body.statements.at(-1)),'returnencoding.next++===0?undefined:encoding;');
  // The complete original vector is validated and included in memo provenance
  // before only the registered transport position can be omitted from SQL.
  assert.equal(compact(compose.body.statements[0]),'current(state);');
  assert.equal(compact(variable(compose,'mandatoryCount').initializer),'state.proofs.length');
  assert.equal(compact(variable(compose,'transportCount').initializer),'state.transportProofs.length');
  assert.equal(compact(variable(compose,'carried').initializer),'catalogEncoding?carriedCatalogProof(state,input,catalogEncoding):undefined');
  const loop=one(collect(compose,ts.isForOfStatement),'One original-proof traversal');
  assert.equal(compact(loop.expression),'[...state.proofs,...state.transportProofs,...(input.assertions??[])].entries()');
  assert.equal(compact(loop.initializer),'const[at,raw]');
  const capture=one(calls(loop,'capturedProof'),'Capture each original contribution'),push=one(calls(loop,'packingProofs?.push'),'Preserve each full original memo contribution');
  assert.deepEqual(capture.arguments.map(compact),['raw']);assert.deepEqual(push.arguments.map(compact),['proof']);
  const skip=one(loop.statement.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression)==='carried&&(at===mandatoryCount||at===carried.nativeIndex||extra)'),'Only exact privately registered catalog positions are skippable');
  assert.equal(compact(variable(loop,'extra').initializer),'carried?.extra.find(item=>item.index===at)');
  assert.ok(capture.end<push.getStart(file)&&push.end<skip.getStart(file));
  assert.equal(compact(skip.thenStatement.statements[0]),'if(raw!==(at===mandatoryCount?carried.proof:at===carried.nativeIndex?carried.nativeProof:extra?.proof))returnfail();');
  assert.equal(skip.thenStatement.statements.length,2);assert.ok(ts.isContinueStatement(skip.thenStatement.statements[1]));
  assert.equal(collect(loop,ts.isContinueStatement).length,1,'No other contribution is skipped');
  const dedup=one(calls(loop,'proofs.some'),'Original exact proof dedup');assert.ok(skip.end<dedup.getStart(file));
  assert.equal(compact(dedup.arguments[0]),'previous=>previous.sql===proof.sql&&previous.deadlineMs===proof.deadlineMs&&same(previous.bindings??[],proof.bindings??[])');
  const nonempty=one(compose.body.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression)==='!proofs.length'),'No synthetic TRUE authority fallback');
  assert.equal(compact(nonempty.thenStatement),'returnfail();');assert.ok(loop.end<nonempty.getStart(file));
  const collision=variable(compose,'source');assert.equal(compact(collision.initializer),'[input.sql,...proofs.map(proof=>proof.sql),...(carried?[carried.proof.sql,...(carried.nativeProof?[carried.nativeProof.sql]:[]),...carried.extra.map(item=>item.proof.sql)]:[])].join("\\n").toLowerCase()');
  const collisionLoop=one(collect(compose,ts.isWhileStatement),'Retain collision avoidance');assert.equal(compact(collisionLoop.expression),'source.includes(prefix)');
  assert.ok(nonempty.end<collision.getStart(file)&&collision.end<collisionLoop.getStart(file));
  // Inputs are the actual ordered captured statements. The private token dies
  // in finally before query charging and the unchanged native batch await.
  const start=one(calls(file,'beginCatalogBatchEncoding'),'Only one native batch allocation');assert.equal(ancestor(start,ts.isFunctionDeclaration),database);
  assert.deepEqual(start.arguments.map(compact),['state','inputs','descriptors']);
  const scope=ancestor(start,ts.isTryStatement),inputs=variable(scope.tryBlock,'inputs');
  assert.equal(compact(inputs.initializer),'captured.map((item,at)=>({...item,columns:descriptors[at]!.columns,assertions:descriptors[at]!.assertions,invalidRow:invalidNativeRow(descriptors[at]!,i),maximumRows:Math.min(descriptors[at]!.maximumRows,rowAllowance)}))');
  const supplied=one(calls(scope.tryBlock,'composeRows'),'One ordered encoding path');assert.deepEqual(supplied.arguments.map(compact),['state','input','maximum','memo','catalogEncoding??undefined']);
  const map=ancestor(supplied,node=>ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='map');
  assert.equal(compact(map.expression),'inputs.map');assert.ok(inputs.end<start.getStart(file)&&start.end<map.getStart(file));
  const complete=one(scope.tryBlock.statements.filter(ts.isIfStatement),'Every registered input must be consumed');
  assert.equal(compact(complete.expression),'catalogEncoding&&catalogBatchEncodings.get(catalogEncoding)?.next!==inputs.length');assert.equal(compact(complete.thenStatement),'returnfail();');assert.ok(map.end<complete.getStart(file));
  assert.equal(collect(scope.tryBlock,ts.isAwaitExpression).length,0);assert.equal(compact(scope.finallyBlock),'{if(catalogEncoding)catalogBatchEncodings.delete(catalogEncoding);memo?.retire();}');
  const deletion=one(calls(file,'catalogBatchEncodings.delete'),'One unconditional-finally retirement');assert.ok(deletion.getStart(file)>scope.finallyBlock.getStart(file)&&deletion.end<scope.finallyBlock.end);
  const siblings=scope.parent.statements,position=siblings.indexOf(scope);assert.ok(position>=0);
  assert.equal(compact(siblings[position+1]),'state.data.account({bytes:0,queries:captured.length,rows:0});');
  const raw=variable(siblings[position+2],'raw');assert.equal(compact(raw.initializer),'awaitstate.data.wait(()=>state.db.batch<Row>(plans.map(plan=>state.db.prepare(plan.packed.sql).bind(...plan.packed.bindings))))');
  for(const reference of collect(database,node=>named(node,'catalogEncoding')||named(node,'catalogBatchEncodings')))
    assert.ok(reference.end<raw.getStart(file),'The encoding token has no use after native dispatch begins');
  for(const call of calls(file,'composeRows'))if(call!==supplied)assert.equal(call.arguments.length,3,'All single-read paths retain complete direct encoding');
  // Publish no row identity or witness until every real ACK has passed and its
  // actual bytes/rows have been charged. No synthetic acknowledgement fan-out.
  const publish=one(calls(database,'rowObservations.set'),'One batch observation registration');
  const observationLoop=ancestor(publish,ts.isForStatement);assert.equal(observationLoop.parent,scope.parent);assert.equal(compact(observationLoop.condition),'at<restored.length');
  const validationLoop=one(siblings.filter(node=>ts.isForStatement(node)&&compact(node.condition)==='at<result.value.length'),'All genuine ACKs are checked in a separate first pass');
  const result=one(siblings.flatMap(node=>ts.isVariableStatement(node)?[...node.declarationList.declarations]:[]).filter(node=>named(node.name,'result')),'One result binding in this batch scope');assert.equal(compact(result.initializer),'laterOperation(state)?captureLaterResults(raw,state.data.remaining().bytes):captureResult(raw,state.data.remaining().bytes)');
  const cardinality=one(siblings.filter(node=>ts.isIfStatement(node)&&compact(node.expression)==='!Array.isArray(result.value)||result.value.length!==captured.length'),'Exact native ACK count');
  assert.ok(result.end<cardinality.getStart(file)&&cardinality.end<validationLoop.getStart(file));
  assert.equal(collect(validationLoop,ts.isAwaitExpression).length,0);assert.equal(calls(validationLoop,'acknowledgement').length,1);assert.equal(calls(validationLoop,'rowObservations.set').length,0);
  assert.equal(calls(validationLoop,'observeSponsorAudioOutputLaterRead').length,0);assert.equal(calls(validationLoop,'observe').length,0);
  const authority=one(validationLoop.statement.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression).includes('row.authorized!==1')),'Each real ACK retains its authority check');
  assert.equal(compact(authority.expression),'ack.results.length!==1||!row||row.authorized!==1||!integer(row.count)||row.count>d.maximumRows||typeofrow.body!=="string"');
  const shape=one(validationLoop.statement.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression).startsWith('!Array.isArray(data)')),'Every decoded ACK retains its shape check');
  assert.equal(compact(shape.expression),'!Array.isArray(data)||data.length!==row.count||data.some(value=>!Array.isArray(value)||value.length!==d.columns.length)');
  const logicalProof=one(validationLoop.statement.statements.filter(node=>ts.isIfStatement(node)&&compact(node.expression).includes('rows[0]!.current!==1')),'Every scalar target retains its own truth check');
  assert.equal(compact(logicalProof.expression),'["proof","later-proof"].includes(d.kind)&&(rows.length!==1||rows[0]!.current!==1)');
  assert.equal(compact(variable(validationLoop,'witness').initializer),'{sql:plans[at]!.witnessSql,bindings:[...item.bindings,row.body]}');
  assert.equal(compact(one(calls(validationLoop,'restored.push'),'Real ACK metadata retained').arguments[0]),'{ack:{...ack,results:rows},rows,witness}');
  const charged=one(calls(scope.parent,'state.data.account').filter(call=>compact(call.arguments[0])==='{bytes:result.bytes,queries:0,rows:rowsCharged}'),'Charge actual received batch before publication');
  assert.ok(validationLoop.end<charged.getStart(file)&&charged.end<observationLoop.getStart(file));
  const recheck=one(calls(scope.parent,'current').filter(call=>call.getStart(file)>charged.end&&call.end<observationLoop.getStart(file)),'Current authority is rechecked after charging');assert.ok(recheck.end<publish.getStart(file));
  assert.deepEqual(publish.arguments.map(compact),['observation.rows','{state,sql:item.sql,bindings:item.bindings,witness:observation.witness}']);
  const nativeObserve=one(calls(observationLoop,'observeSponsorAudioOutputLaterRead'),'Real native observation follows registration');assert.ok(publish.end<nativeObserve.getStart(file));
  t.diagnostic(JSON.stringify({evidence:'catalog-batch-source-correspondence-only',sourceSha256:traceHash(source),nativeAuthorityQualified:false}));
});


// Pure encoding eligibility only: these extracted private functions never
// produce a real owner or execute SQL. Genuine native review below qualifies IO.
test('Audio finite native catalog encoding requires exact private retained identity and preserves fallbacks',t=>{
  const text=readFileSync(new URL('../worker/experience-sponsor-audio-output-reads.ts',import.meta.url),'utf8');
  const file=ts.createSourceFile('audio-reads.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const names=['beginCatalogBatchEncoding','carriedCatalogProof'];
  const functions=names.map(name=>{const found=file.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.equal(found.length,1);return found[0].getText(file);});
  const executable=stripTypeScriptTypes(functions.join('\n'),{mode:'strip'});
  const laterCatalogProofs=new WeakMap(),nativeCatalogProofs=new WeakMap(),privateCatalogProofs=new WeakMap(),originalMetadataProofs=new WeakMap(),catalogBatchEncodings=new WeakMap();
  const helpers=compileFunction(executable+';return {beginCatalogBatchEncoding,carriedCatalogProof};',
    ['laterCatalogProofs','nativeCatalogProofs','privateCatalogProofs','originalMetadataProofs','catalogBatchEncodings','laterOperation','same','fail'])(laterCatalogProofs,nativeCatalogProofs,privateCatalogProofs,originalMetadataProofs,catalogBatchEncodings,
      state=>state.later,(a,b)=>a.length===b.length&&a.every((value,at)=>Object.is(value,b[at])),()=>{throw Error('encoding-refused');});
  const {beginCatalogBatchEncoding:begin,carriedCatalogProof:carry}=helpers;
  const make=(registered=true,deadline=false)=>{
    const native=Object.freeze({sql:'source-owned-native-catalog',bindings:Object.freeze(['source-manifest']),...(deadline?{deadlineMs:1}:{})});
    const later=Object.freeze({sql:'source-owned-later-catalog',bindings:Object.freeze(['later-manifest'])});
    const state={later:true,proofs:[Object.freeze({sql:'per-statement-private-custody',bindings:['exact-owner']}),native],transportProofs:[later]};
    laterCatalogProofs.set(state,later);if(registered)nativeCatalogProofs.set(state,native);
    const inputs=Array.from({length:2},()=>({columns:['current'],maximumRows:1})),descriptors=Array.from({length:2},()=>({kind:'proof',columns:['current'],maximumRows:1}));
    return {native,later,state,inputs,descriptors};
  };
  let cases=0;
  {const x=make(),token=begin(x.state,x.inputs,x.descriptors);assert.ok(token);assert.equal(carry(x.state,x.inputs[0],token),undefined);
    const carried=carry(x.state,x.inputs[1],token);assert.equal(carried.nativeProof,x.native);assert.equal(carried.nativeIndex,1);assert.equal(carried.proof,x.later);cases++;}
  {const x=make(false),token=begin(x.state,x.inputs,x.descriptors);assert.ok(token);carry(x.state,x.inputs[0],token);
    const carried=carry(x.state,x.inputs[1],token);assert.equal(carried.nativeProof,undefined);assert.equal(carried.nativeIndex,-1);assert.equal(carried.proof,x.later);cases++;}
  {const x=make();x.state.proofs[1]=Object.freeze({...x.native});assert.throws(()=>begin(x.state,x.inputs,x.descriptors),/encoding-refused/u);cases++;}
  {const x=make(true,true);assert.throws(()=>begin(x.state,x.inputs,x.descriptors),/encoding-refused/u);cases++;}
  {const x=make(),token=begin(x.state,x.inputs,x.descriptors);x.state.proofs.reverse();assert.throws(()=>carry(x.state,x.inputs[0],token),/encoding-refused/u);cases++;}
  {const x=make(),token=begin(x.state,x.inputs,x.descriptors);carry(x.state,x.inputs[0],token);nativeCatalogProofs.set(x.state,Object.freeze({...x.native}));assert.throws(()=>carry(x.state,x.inputs[1],token),/encoding-refused/u);cases++;}
  {const x=make(),token=begin(x.state,x.inputs,x.descriptors);assert.throws(()=>carry(x.state,x.inputs[1],token),/encoding-refused/u);cases++;}
  {const x=make(),token=begin(x.state,x.inputs,x.descriptors);catalogBatchEncodings.delete(token);assert.throws(()=>carry(x.state,x.inputs[0],token),/encoding-refused/u);cases++;}
  for(const change of [x=>{x.state.later=false;},x=>{x.inputs.pop();x.descriptors.pop();},x=>{x.descriptors[1].kind='source';},x=>{x.inputs[1].columns=['private_body'];},x=>{x.descriptors[1].maximumRows=2;}]){
    const x=make();change(x);assert.equal(begin(x.state,x.inputs,x.descriptors),null);cases++;
  }
  assert.equal(cases,13);
  // Inert values exercise only the private encoding declarations. The real
  // producer provenance/2+2+2+1+1 guard is checked above and in genuine IO below.
  const originals=()=>{
    const x=make(),metadata=Object.freeze(Array.from({length:8},(_,at)=>Object.freeze({sql:`inert-original-${at}`,bindings:Object.freeze([at])}))),
      privateProof=Object.freeze({sql:'inert-private-catalog',bindings:Object.freeze(['private-snapshot'])});
    x.state.proofs.push(...metadata,privateProof);originalMetadataProofs.set(x.state,metadata);privateCatalogProofs.set(x.state,privateProof);
    return {...x,metadata,privateProof};
  };
  {const x=originals(),token=begin(x.state,x.inputs,x.descriptors);assert.equal(carry(x.state,x.inputs[0],token),undefined);
    const value=carry(x.state,x.inputs[1],token);assert.equal(value.metadataProofs,x.metadata);assert.equal(value.privateProof,x.privateProof);
    assert.deepEqual(value.extra.map(item=>item.proof),[...x.metadata,x.privateProof]);assert.deepEqual(value.extra.map(item=>item.index),[2,3,4,5,6,7,8,9,10]);
    assert.ok(Object.isFrozen(value.extra)&&value.extra.every(Object.isFrozen));cases++;}
  {const x=originals();originalMetadataProofs.delete(x.state);privateCatalogProofs.delete(x.state);
    const token=begin(x.state,x.inputs,x.descriptors);carry(x.state,x.inputs[0],token);
    assert.deepEqual(carry(x.state,x.inputs[1],token).extra,[],'Unregistered equal-looking SQL has no encoding identity');cases++;}
  const refusals=[
    x=>{x.state.proofs[2]={...x.metadata[0]};},
    x=>{x.state.proofs[10]={...x.privateProof};},
    x=>{originalMetadataProofs.set(x.state,[...x.metadata.slice(0,7),x.metadata[0]]);},
    x=>{privateCatalogProofs.set(x.state,x.metadata[0]);},
    x=>{privateCatalogProofs.set(x.state,x.native);},
    x=>{const proof={...x.metadata[0],deadlineMs:1};x.state.proofs[2]=proof;originalMetadataProofs.set(x.state,[proof,...x.metadata.slice(1)]);},
    x=>{const proof={...x.privateProof,deadlineMs:1};x.state.proofs[10]=proof;privateCatalogProofs.set(x.state,proof);},
  ];
  for(const change of refusals){const x=originals();change(x);assert.throws(()=>begin(x.state,x.inputs,x.descriptors),/encoding-refused/u);cases++;}
  const stale=[
    x=>{originalMetadataProofs.set(x.state,[...x.metadata]);},
    x=>{privateCatalogProofs.set(x.state,{...x.privateProof});},
    x=>{[x.state.proofs[2],x.state.proofs[3]]=[x.state.proofs[3],x.state.proofs[2]];},
    x=>{x.state.proofs[10]={...x.privateProof};},
    x=>{originalMetadataProofs.delete(x.state);},
    x=>{privateCatalogProofs.delete(x.state);},
  ];
  for(const change of stale){const x=originals(),token=begin(x.state,x.inputs,x.descriptors);carry(x.state,x.inputs[0],token);change(x);
    assert.throws(()=>carry(x.state,x.inputs[1],token),/encoding-refused/u);cases++;}
  // A changed deadline also refuses if an inert mutable source violates the
  // production frozen-proof precondition between encoding slots.
  for(const index of [2,10]){const x=originals(),proof={...x.state.proofs[index]};x.state.proofs[index]=proof;
    if(index===2)originalMetadataProofs.set(x.state,[proof,...x.metadata.slice(1)]);else privateCatalogProofs.set(x.state,proof);
    const token=begin(x.state,x.inputs,x.descriptors);carry(x.state,x.inputs[0],token);proof.deadlineMs=1;
    assert.throws(()=>carry(x.state,x.inputs[1],token),/encoding-refused/u);cases++;}
  for(const change of [x=>{x.state.later=false;},x=>{x.inputs.pop();x.descriptors.pop();},x=>{x.descriptors[1].kind='source';}]){
    const x=originals();change(x);assert.equal(begin(x.state,x.inputs,x.descriptors),null);cases++;
  }
  assert.equal(cases,33);t.diagnostic(JSON.stringify({evidence:'actual-private-encoding-helper-controls-only',cases,realOwnerCreated:false,sqlExecuted:false}));
});

// Genuine owned review only. These observers call the existing database and
// native adapter unchanged; faults only damage a real returned ACK or schema.
const audioLaterCatalogMarker='WITH audio_later_manifest AS (SELECT ';
const isAudioCatalogCarrier=entry=>entry.kind==='batch'&&entry.statements.length>1
  &&entry.statements.every(part=>part.sql.includes('SELECT allowed AS authorized,count,')&&part.sql.includes(' AS body'))
  &&entry.statements.every((part,at)=>part.sql.includes(audioLaterCatalogMarker)===(at===0));
// Reverse only this packer's exact generated expressions and require complete
// byte-for-byte repacking. This is an offline view of actual emitted SQL, not a
// replacement encoder or an authority producer. Parameter offsets retain types.
function actualAudioAuthorityGates(part){
  assert.equal(part.bindings.length,1);const vector=JSON.parse(part.bindings[0]);assert.ok(Array.isArray(vector));
  const header='WITH sponsor_intake_parameters AS (SELECT ? AS json),';assert.ok(part.sql.startsWith(header));
  const packed='WITH'+part.sql.slice(header.length),parameters=[];
  const expression=/\((?:\+CAST\(json_extract\(\(SELECT json FROM sponsor_intake_parameters\),'\$\[(\d+)\]'\) AS REAL\)|json_extract\(\(SELECT json FROM sponsor_intake_parameters\),'\$\[(\d+)\]'\))\)/gu;
  let raw='',last=0;
  for(const match of packed.matchAll(expression)){
    const at=Number(match[1]??match[2]);assert.equal(at,parameters.length);assert.equal(match[1]!==undefined,typeof vector[at]==='number');
    raw+=packed.slice(last,match.index);parameters.push({at:raw.length,value:vector[at]});raw+='?';last=match.index+match[0].length;
  }
  raw+=packed.slice(last);assert.equal(parameters.length,vector.length);
  assert.deepEqual(packSponsorIntakeReadQuery(raw,vector),{sql:part.sql,bindings:part.bindings},'Lossless real packer round-trip for the entire actual statement');
  const definitions=[...raw.matchAll(/(audio_output_native_*)_gate_(\d+) AS MATERIALIZED \(SELECT CASE WHEN \(/gu)];assert.ok(definitions.length>0);
  const prefix=definitions[0][1],authority=raw.indexOf(`${prefix}_authority AS MATERIALIZED (`);assert.ok(authority>definitions.at(-1).index);
  const suffix=') THEN 1 ELSE 0 END AS allowed),';
  return definitions.map((match,at)=>{
    assert.equal(match[1],prefix);assert.equal(Number(match[2]),at);
    const start=match.index+match[0].length,end=at+1<definitions.length?definitions[at+1].index:authority;
    assert.ok(raw.slice(start,end).endsWith(suffix));const stop=end-suffix.length;
    return {sql:raw.slice(start,stop),bindings:parameters.filter(value=>value.at>=start&&value.at<stop).map(value=>value.value)};
  });
}
const exactAudioProof=(a,b)=>a.sql===b.sql&&a.bindings.length===b.bindings.length&&a.bindings.every((value,at)=>Object.is(value,b.bindings[at]));
function actualAudioPrivateCatalog(probe){
  const source=readFileSync(new URL('../worker/experience-sponsor-audio-output-native.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('audio-native.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0);
  const literal=name=>{
    const declarations=ast.statements.flatMap(node=>ts.isVariableStatement(node)?[...node.declarationList.declarations]:[]).filter(node=>ts.isIdentifier(node.name)&&node.name.text===name);
    assert.equal(declarations.length,1);assert.ok(ts.isNoSubstitutionTemplateLiteral(declarations[0].initializer));return declarations[0].initializer.text;
  };
  // This is the real observed physical ACK of the native snapshot read before
  // the selected batch. No owner getter, new query or application call occurs.
  const snapshots=probe.observed.records.slice(probe.continuationStart,probe.target().index).flatMap(entry=>entry.statements.flatMap((part,at)=>{
    if(!part.sql.includes('json_group_array(json_array(row."snapshot",row."supported"))'))return [];
    const ack=entry.kind==='batch'?entry.result?.[at]:entry.result;
    assert.equal(ack?.success,true);assert.equal(ack.results.length,1);assert.equal(ack.results[0].authorized,1);
    const rows=JSON.parse(ack.results[0].body);assert.equal(rows.length,1);assert.equal(rows[0][1],1);assert.equal(typeof rows[0][0],'string');return [rows[0][0]];
  }));
  assert.equal(snapshots.length,1,'One actual private-content schema snapshot precedes the carrier');
  return {sql:`EXISTS(SELECT 1 FROM (${literal('privateSchemaQuery')}) WHERE snapshot=?) AND (${literal('privateShape')})`,bindings:snapshots};
}
function assertAudioOriginalCarriers(probe,parts,{carried}){
  const metadata=probe.owned.view.originalMetadataAssertions,original=probe.owned.view.assertions;
  assert.equal(metadata.length,8);assert.ok(Object.isFrozen(metadata));assert.equal(new Set(metadata).size,8);
  assert.ok(metadata.every(item=>Object.isFrozen(item)&&original.includes(item)),'Exact original C assertion objects, not equal caller DTOs');
  const start=original.indexOf(metadata[0]);assert.ok(start>0);assert.deepEqual(original.slice(start,start+8),metadata);
  assert.equal(start+10,original.length,'Principal group precedes 2+2+2+1+1 metadata, then original validity and attempt receipt');
  const clocks=original.slice(-2);assert.ok(clocks.every(item=>item.sql.includes("julianday('now')")));
  const privateCatalog=actualAudioPrivateCatalog(probe);
  for(const [at,part]of parts.entries()){
    const gates=actualAudioAuthorityGates(part);
    for(const proof of [...metadata,privateCatalog])assert.equal(gates.filter(gate=>exactAudioProof(gate,proof)).length,carried&&at>0?0:1,
      'Only exact original metadata/private catalog authority gates leave subsequent qualified wrappers');
    for(const proof of clocks)assert.equal(gates.filter(gate=>exactAudioProof(gate,proof)).length,1,'Both original C clocks remain per physical statement');
  }
}
function actualCatalogManifest(part){
  assert.equal(part.bindings.length,1,'The genuine packer transports one exact scalar vector');
  const vector=JSON.parse(part.bindings[0]);assert.ok(Array.isArray(vector));
  const matches=vector.flatMap(value=>{
    if(typeof value!=='string'||!value.startsWith('{'))return [];
    let parsed;try{parsed=JSON.parse(value);}catch{return [];}
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)
      &&JSON.stringify(Object.keys(parsed).sort())===JSON.stringify(['indexes','tables','triggers','updateTargets'])?[{raw:value,value:parsed}]:[];
  });
  assert.equal(matches.length,1,'Exactly one original complete later catalog manifest is present');return matches[0];
}
async function audioCatalogOwnedReview(t,fault){
  const f=await preparedFixture(t);let owned,target;const observerErrors=[];
  const observe=callback=>{try{return callback();}catch(error){observerErrors.push(error);return undefined;}};
  const observed=observeDatabase(f,{
    before(entry){
      if(!owned||target||!isAudioCatalogCarrier(entry))return;
      target={entry,index:observed.records.length-1,altered:false,nativeReturned:false};
      if(!fault)target.usageAtDispatch=observe(()=>({...owned.view.usage}));
      if(fault==='native-schema-before'){
        f.sqlite.exec('CREATE TRIGGER audio_native_catalog_fault BEFORE INSERT ON events BEGIN SELECT 1; END;');target.altered=true;
      }
      if(fault==='private-schema-before'){
        f.sqlite.exec('CREATE INDEX audio_private_catalog_fault ON private_content(content)');target.altered=true;
      }
      if(fault==='schema-before'){
        target.originalTrigger=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='experience_sponsor_issuance_no_update'").get()?.sql;
        assert.equal(typeof target.originalTrigger,'string');
        f.sqlite.exec('DROP TRIGGER experience_sponsor_issuance_no_update');target.altered=true;
      }
    },
    after(entry,result){
      if(entry!==target?.entry||fault!=='carrier-lost')return;
      assert.ok(Array.isArray(result));assert.equal(result.length,entry.statements.length);
      assert.equal(result[0].success,true);assert.equal(result[0].results[0].authorized,1);
      target.altered=true;target.deliveryError=Error('Synthetic lost genuine catalog-carrier batch acknowledgement');
      // The complete real read-only transaction ran. Its response, including
      // the first ACK, is not delivered; no replacement successful ACK exists.
      throw target.deliveryError;
    },
    transform(entry,result){
      if(entry!==target?.entry||!['carrier-malformed','carrier-missing','later-zero'].includes(fault))return result;
      assert.ok(Array.isArray(result));assert.equal(result.length,entry.statements.length);assert.ok(result.length>1);
      assert.ok(result.every(ack=>ack.success===true&&ack.results.length===1&&ack.results[0].authorized===1));
      if(fault==='carrier-malformed')result[0].results=[];
      else if(fault==='carrier-missing')delete result[0];
      else {const last=result[result.length-1];assert.equal(last.results[0].body,'[[1]]');last.results[0].body='[[0]]';}
      target.altered=true;return result;
    },
  });
  const request=f.outputRequest('review'),attemptCount=count(f,outputIO);
  owned=await ownedContinuation(t,f,request,'review');const charged=rows(f,outputIO),before=businessSnapshot(f);
  assert.equal(charged.length,attemptCount+1);
  const continuationStart=observed.records.length;
  const native=owned.reads.requireSponsorAudioOutputReads(owned.owner).nativeEnv.DB,batch=native.batch;
  t.mock.method(native,'batch',async function(statements){
    const start=observed.records.length,usageAtNativeEntry=!fault?observe(()=>({...owned.view.usage})):undefined;let actual;
    try{actual=await batch.call(this,statements);}
    catch(error){if(target&&target.index>=start)target.nativeError=error;throw error;}
    if(target&&target.index>=start){
      target.nativeReturned=true;target.nativeInputCount=statements.length;target.nativeResult=actual;
      if(!fault){
        target.usageAtNativeEntry=usageAtNativeEntry;target.nativeStartIndex=start;
        target.priorQueries=observed.records.slice(start,target.index).reduce((total,entry)=>total+entry.statements.length,0);
        target.usageAfterNative=observe(()=>({...owned.view.usage}));
      }
    }
    return actual;
  });
  return {f,owned,observed,charged,before,observerErrors,continuationStart,target:()=>target};
}
function assertAudioCatalogReadOnly(f,target){
  assert.ok(target,'The actual native owner must reach the qualifying carrier batch');
  assert.ok(isAudioCatalogCarrier(target.entry));assert.ok(target.entry.statements.length>1);
  const manifest=actualCatalogManifest(target.entry.statements[0]);
  const nativeMatches=JSON.parse(target.entry.statements[0].bindings[0]).flatMap(value=>{
    if(typeof value!=='string'||!value.startsWith('{'))return [];let parsed;try{parsed=JSON.parse(value);}catch{return [];}
    return parsed&&JSON.stringify(Object.keys(parsed).sort())===JSON.stringify(['indexes','sceneTables','sceneTriggers','tables','triggers'])?[{raw:value,value:parsed}]:[];
  });
  assert.equal(nativeMatches.length,1,'One exact complete native catalog manifest is present');const nativeManifest=nativeMatches[0];
  assert.equal(nativeManifest.value.tables.length,8);assert.equal(nativeManifest.value.sceneTables.length,1);
  assert.ok(nativeManifest.value.tables.some(table=>table.name==='events'));

  assert.equal(manifest.value.tables.length,20);assert.equal(manifest.value.indexes.length,10);assert.equal(manifest.value.triggers.length,32);
  assert.ok(manifest.value.triggers.some(value=>value.name==='experience_sponsor_issuance_no_update'&&value.required===1));
  for(const [at,part]of target.entry.statements.entries()){
    assert.ok(bytes(part.sql)<=100000);assert.ok(part.bindings.length<=100);
    assert.equal(part.sql.split(audioLaterCatalogMarker).length-1,at===0?1:0);
    const vector=JSON.parse(part.bindings[0]);assert.ok(Array.isArray(vector));
    assert.equal(vector.filter(value=>value===manifest.raw).length,at===0?1:0,'Only the catalog scalar leaves noncarrier vectors');
    assert.equal(part.sql.includes('native_schema_manifest'),at===0,'Only the exact native catalog gate leaves the qualifying noncarrier');
    assert.equal(vector.filter(value=>value===nativeManifest.raw).length,at===0?1:0,'Its exact immutable source manifest follows the native carrier');
  }
  assertNoRun(f);return manifest;
}

test('Audio finite native catalog carrier preserves genuine ordered ACKs and exact successful accounting',{timeout:300000},async t=>{
  const probe=await audioCatalogOwnedReview(t),{f,owned,observed}=probe;
  const response=await owned.run(),shown=await responseBody(await owned.disclose(response));assert.equal(shown.kind,'sponsor-audio-review');
  const target=probe.target();assertAudioCatalogReadOnly(f,target);assert.deepEqual(probe.observerErrors,[]);
  assertAudioOriginalCarriers(probe,target.entry.statements,{carried:true});
  assert.equal(target.nativeReturned,true);assert.equal(target.nativeError,undefined);
  const actual=target.entry.result,count=target.entry.statements.length;
  assert.equal(target.nativeInputCount,count);assert.equal(actual.length,count);assert.equal(target.nativeResult.length,count);
  for(let at=0;at<count;at++){
    const ack=actual[at],restored=target.nativeResult[at];assert.equal(ack.success,true);assert.equal(ack.results.length,1);
    assert.equal(ack.results[0].authorized,1);assert.equal(ack.results[0].count,1);assert.equal(ack.results[0].body,'[[1]]');
    assert.deepEqual(restored,{...ack,results:[{current:1}]},'Each restored ACK keeps that genuine physical statement\'s metadata');
  }
  assert.equal(target.usageAtDispatch.queries-target.usageAtNativeEntry.queries,target.priorQueries+count,'Every real identity query plus all N physical batch queries is charged before dispatch');
  assert.equal(target.usageAfterNative.queries-target.usageAtDispatch.queries,0,'No second query debit occurs after dispatch');
  assert.equal(target.usageAfterNative.rows-target.usageAtDispatch.rows,2*count);
  assert.equal(target.usageAfterNative.bytes-target.usageAtDispatch.bytes,target.entry.returnedBytes);
  assert.deepEqual(businessSnapshot(f),probe.before);assert.deepEqual(rows(f,outputIO),probe.charged);assertNoRun(f);
  assert.throws(()=>owned.view.current(),'The completed disclosure closes the original lifetime before offline compilation');
  const wrapped=part=>part.sql.includes('SELECT allowed AS authorized,count,')&&part.sql.includes(' AS body');
  const reached=observed.records.slice(probe.continuationStart);
  const single=reached.filter(entry=>entry.kind!=='batch'&&entry.statements.length===1&&wrapped(entry.statements[0]));
  assert.ok(single.length>0,'This genuine review reaches ordinary single reads');
  for(const entry of single)assert.equal(entry.statements[0].sql.split(audioLaterCatalogMarker).length-1,1,'Every reached single wrapper retains its own complete later catalog');
  // The native catalog is registered only when the real plan is loaded. Do not
  // pretend earlier bootstrap single reads already had that mandatory proof.
  const firstNativeSingle=single.findIndex(entry=>entry.statements[0].sql.includes('native_schema_manifest'));
  assert.ok(firstNativeSingle>=0,'The actual review reaches native-catalog single reads');
  for(const entry of single.slice(firstNativeSingle)){
    assert.ok(entry.statements[0].sql.includes('native_schema_manifest'),'All subsequent single wrappers retain the native catalog');
    assertAudioOriginalCarriers(probe,entry.statements,{carried:false});
  }
  // The real trace may also reach a non-scalar batch. Inspect that actual shape
  // if present; never synthesize a descriptor or claim a mixed path was reached.
  const nonscalar=reached.filter(entry=>entry.kind==='batch'&&entry.statements.length>1&&entry.statements.every(wrapped)
    &&entry.statements.some(part=>!part.sql.includes('json_group_array(json_array(row."current"))')));
  for(const entry of nonscalar){
    for(const part of entry.statements)assert.equal(part.sql.split(audioLaterCatalogMarker).length-1,1,'Every reached non-scalar batch wrapper retains the later catalog');
    if(entry.statements.every(part=>part.sql.includes('native_schema_manifest')))assertAudioOriginalCarriers(probe,entry.statements,{carried:false});
  }
  t.diagnostic(JSON.stringify({evidence:'genuine-review-unfactored-paths',singleReadCount:single.length,nonScalarBatchCount:nonscalar.length,
    mixedPathEvidence:nonscalar.length?'actual-non-scalar-batch-plus-source-correspondence':'source-correspondence-only-not-dynamically-reached'}));
  // Exactly two actual emitted statements, after the original lifetime closes.
  // Parent separately compares captured original/candidate encoding. This is
  // strict compilation of genuine newly emitted SQL, not a stubbed composer.
  const {compileSqliteExpressionDepth}=await import('./helpers/d1-expression-depth.mjs');
  const queryLimits={functionArguments:32,parameters:100,sqlBytes:100000};
  for(const at of [0,count-1]){
    const part=target.entry.statements[at],compiled=compileSqliteExpressionDepth(f.sqlite,part.sql,{limit:100,bindings:part.bindings,queryLimits});
    assert.equal(compiled.ok,true,compiled.error);assert.equal(compiled.limit,100);assert.deepEqual(compiled.queryLimits,queryLimits);
    assert.ok(compiled.statementBytes<=100000);assert.ok(compiled.parameterCount<=100);
    t.diagnostic(JSON.stringify({evidence:'actual-native-catalog-emission-strict-compile',slot:at,compoundSelectLimit:5,...compiled}));
  }
  evidence(f,'catalog-carrier-success',{statements:count,carrierSqlSha256:traceHash(target.entry.statements[0].sql),
    noncarrierSqlSha256:traceHash(target.entry.statements[count-1].sql),usageAtDispatch:target.usageAtDispatch,usageAfterNative:target.usageAfterNative,
    rawBytes:target.entry.returnedBytes,source:'genuine-native-SQLite-review-not-actual-D1'});
  assert.ok(observed.records.includes(target.entry));
});

for(const fault of ['schema-before','native-schema-before','private-schema-before','carrier-malformed','carrier-missing','carrier-lost','later-zero'])
  test(`Audio finite native catalog carrier refuses ${fault} without later logical output`,{timeout:300000},async t=>{
    const probe=await audioCatalogOwnedReview(t,fault),{f,owned,observed}=probe;
    await refused(owned.run);const target=probe.target();assertAudioCatalogReadOnly(f,target);assert.equal(target.altered,true);
    assert.deepEqual(probe.observerErrors,[]);assert.equal(target.nativeReturned,false);assert.ok(target.nativeError instanceof Error);
    if(fault==='carrier-lost')assert.equal(target.nativeError,target.deliveryError,'Preserve the exact lost-ACK error after the actual transaction');
    else assert.equal(target.nativeError.code,fault==='later-zero'?'sponsor_audio_output_native_proof_changed':'sponsor_audio_output_native_unavailable',
      'A lifetime expiry or unrelated refusal cannot qualify this fault');
    assert.ok(Array.isArray(target.entry.result));assert.equal(target.entry.result.length,target.entry.statements.length);
    if(fault==='native-schema-before'){
      assert.equal(target.entry.result[0].results[0].authorized,0);assert.equal(target.entry.result[0].results[0].body,null);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='trigger' AND name='audio_native_catalog_fault'").get().n,1);
    }else if(fault==='private-schema-before'){
      assert.equal(target.entry.result[0].results[0].authorized,0);assert.equal(target.entry.result[0].results[0].body,null);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='index' AND name='audio_private_catalog_fault'").get().n,1);
    }else if(fault==='schema-before'){
      assert.equal(target.entry.result[0].results[0].authorized,0);assert.equal(target.entry.result[0].results[0].body,null);
      assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='trigger' AND name='experience_sponsor_issuance_no_update'").get().n,0);
    }else{
      // observeDatabase preserves a clone of the real successful pre-fault ACK.
      assert.ok(target.entry.result.every(ack=>ack.success===true&&ack.results[0].authorized===1&&ack.results[0].body==='[[1]]'));
    }
    const stoppedAt=observed.records.length;assert.throws(()=>owned.view.current());
    await refused(owned.run);assert.equal(observed.records.length,stoppedAt,'A rejected carrier/later ACK cannot continue dispatch on this owner');
    assert.deepEqual(businessSnapshot(f),probe.before);assert.deepEqual(rows(f,outputIO),probe.charged);assertNoRun(f);
    evidence(f,'catalog-carrier-refusal',{fault,statements:target.entry.statements.length,retired:true,nativeResultReturned:false,
      dispatchesAfterRetirement:observed.records.length-stoppedAt,carrierAuthorized:target.entry.result[0].results[0]?.authorized??null,
      observationLimit:'Private witness registration is checked by exact source correspondence; no private State/WeakMap hook is installed'});
  });

// These cases preserve the proxy cases above and name their different execution
// context. Only genuine persisted setup rows and actual HTTP wire cross realms.
test('Audio finite local Worker-handler D1 complete native authorize and original replay',{timeout:300000},async t=>{
  const f=await preparedFixture(t,{prepare:false}),d1=await actualWorkerD1(t,f);
  try{
    const original=await d1Snapshot(d1.db,['experience_sponsor_audio_intakes','experience_sponsor_audio_intake_allocations','private_content']);
    const actorCounters=async()=>Object.fromEntries(await Promise.all(['budget_counters','cost_budget_counters'].map(async table=>
      [table,(await d1Rows(d1.db,table)).filter(row=>row.scope==='user'&&row.scope_id===f.actor)])));
    const actorBefore=await actorCounters(),prepared=await d1.body(await d1.request('prepare'));
    assert.equal(prepared.status,'review');assert.equal(prepared.stage,'preflight');assert.equal(prepared.grant,null);
    assert.equal(prepared.preflight.planRevisionId,prepared.plan.revisionId);assert.equal((await d1Rows(d1.db,outputIO)).length,1);
    const businessTables=d1.tables.filter(table=>table!==outputIO),beforeReview=await d1Snapshot(d1.db,businessTables);
    const shown=await d1.body(await d1.request('review'));
    assert.equal(shown.kind,'sponsor-audio-review');assert.equal(shown.binding.draftId,f.plan.draftId);assert.equal(shown.binding.documentId,f.plan.documentId);
    assert.equal(shown.binding.campaignId,f.campaignId);assert.equal(shown.binding.actorUserId,f.actor);
    assert.equal(shown.native.expiresAt,prepared.preflight.expiresAt);assert.deepEqual(shown.review.preview,prepared.audioCostPreview);
    assert.deepEqual(await d1Snapshot(d1.db,businessTables),beforeReview);assert.equal((await d1Rows(d1.db,outputIO)).length,2);
    const actor=await actorMessage(f,shown),ack=await d1.body(await d1.request('authorize',{rawBody:actor.message.body}));
    assert.equal(ack.replayed,false);assert.equal(canonicalJson(await transport.readSponsorAudioAuthorizationResponse(ack,shown,actor.message)),canonicalJson(ack));
    assert.equal((await d1Rows(d1.db,outputIO)).length,3);
    const native=await d1Snapshot(d1.db,['output_execution_grants','document_jobs','output_commands','event_private_payloads','experience_sponsor_consumptions','experience_sponsor_issuances']);
    assert.equal(native.output_execution_grants.length,1);assert.equal(native.document_jobs.length,1);
    assert.equal(native.experience_sponsor_consumptions.length,1);assert.equal(native.experience_sponsor_issuances.length,1);
    const grant=native.output_execution_grants[0],job=native.document_jobs[0];
    assert.equal(grant.payer_user_id,f.payer);assert.equal(grant.status,'authorized');assert.equal(job.status,'queued');assert.equal(job.attempt_count,0);
    for(const table of ['experience_sponsor_driver_intents','experience_sponsor_driver_stages','experience_sponsor_grants','experience_sponsor_resource_receipts',
      'experience_sponsor_active_jobs','output_operation_slots','budget_reservations','cost_budget_reservations'])assert.equal((await d1Rows(d1.db,table)).length,1,table);
    for(const table of ['budget_reservations','cost_budget_reservations'])assert.equal((await d1Rows(d1.db,table))[0].owner_id,f.payer,table);
    assert.deepEqual(await actorCounters(),actorBefore);
    const commands=native.output_commands.filter(row=>row.action==='authorize');assert.equal(commands.length,1);const command=commands[0];
    assert.equal(command.event_id,ack.receipt.eventId);assert.equal(command.command_key,ack.receipt.key);assert.equal(ack.grantId,grant.grant_id);assert.equal(ack.jobId,job.job_id);
    assert.equal(grant.authorization_event_id,command.event_id);
    const event=JSON.parse(native.event_private_payloads.find(row=>row.private_event_id===command.event_id).private_json);
    assert.equal(event.grant_id,ack.grantId);assert.deepEqual(event.output_command_envelope.sponsor_entitlement.audio_actor_intent.request,actor.body);
    const before=await d1Snapshot(d1.db,businessTables),replay=await d1.body(await d1.request('authorize',{rawBody:actor.message.body}));
    assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:false},ack);
    const afterReplay=await d1Snapshot(d1.db,businessTables);assert.deepEqual(afterReplay,before);
    // Native admission retains one actor-private generation input receipt. It
    // must be the exact job-linked addition; no original or unrelated row may change.
    const request=JSON.parse(job.request_json),generation=JSON.parse(job.result_json).generationReceipt;
    assert.equal(job.owner_id,f.actor);assert.equal(job.stream_id,f.stream);assert.equal(job.document_id,f.plan.documentId);assert.equal(job.kind,'render_document');
    assert.equal(request.artifactKind,'audio');assert.equal(request.itemCount,1);assert.equal(request.productionMode,'manual');
    assert.equal(typeof generation.input_ref,'string');assert.ok(generation.input_ref.length>0);
    assert.ok(original.private_content.every(row=>row.content_id!==generation.input_ref));
    const retained=await d1Snapshot(d1.db,Object.keys(original)),inputs=retained.private_content.filter(row=>row.content_id===generation.input_ref);
    assert.equal(inputs.length,1);const input=inputs[0],inputReceipt=JSON.parse(input.content);
    assert.deepEqual(input,{content_id:generation.input_ref,owner_id:f.actor,kind:'document-artifact-input',content:input.content,
      created_at:input.created_at,expires_at:generation.input_expires_at,redacted_at:null});
    for(const value of [job.requested_at,generation.captured_at,input.created_at,input.expires_at])assert.equal(new Date(value).toISOString(),value);
    assert.ok(Date.parse(job.requested_at)<=Date.parse(generation.captured_at));assert.ok(Date.parse(generation.captured_at)<=Date.parse(input.created_at));
    // This personal fixture sets no retention override: input receipts are
    // governed evidence (365 days), independently of the 30-day job lifetime.
    assert.equal(Date.parse(input.expires_at)-Date.parse(input.created_at),365*86_400_000);
    assert.equal(Date.parse(job.expires_at)-Date.parse(job.requested_at),30*86_400_000);
    const sourceHash=createHash('sha256').update(JSON.stringify(request.snapshot)).digest('hex');
    assert.equal(generation.schema_version,1);assert.equal(generation.artifact_kind,'audio');assert.equal(generation.source_snapshot_sha256,sourceHash);
    assert.equal(generation.source_transmission_scope,'authorized_document_context');assert.equal(generation.source_transmission_status,'not_transmitted');
    assert.equal(generation.provider_request_status,'not_submitted');assert.equal(generation.actual_provider_call_count,null);
    assert.equal(generation.reservation_status,'active');assert.equal(generation.settled_cost_microusd,0);
    assert.ok(Number.isSafeInteger(request.audioEstimatedCostMicrousd)&&request.audioEstimatedCostMicrousd>=0);
    const settings={item_count:1,requested_slide_count:null,authored_slide_count:null,predicted_slide_count:null,
      audience:'general',tone:'document-derived',production_mode:'manual',presentation_style:null,presentation_fidelity:null,
      batch_count:1,planned_provider_call_count:2,max_repair_call_count:1,maximum_provider_call_count:3,
      reservation_microusd:request.audioEstimatedCostMicrousd+1_000_000,
      audio_goal:request.audioProfile.goal,audio_role:request.audioProfile.role,audio_destination:request.audioProfile.destination,
      audio_duration_seconds:request.audioProfile.durationSeconds,audio_provider_model:request.audioProviderModel,
      audio_provider_estimated_cost_microusd:request.audioEstimatedCostMicrousd};
    assert.deepEqual(generation.settings,settings);
    assert.deepEqual(inputReceipt,{schema_version:1,job_id:job.job_id,artifact_kind:'audio',document_id:f.plan.documentId,captured_at:generation.captured_at,
      request:{...settings,editable_settings:{schema_version:1,artifact_kind:'audio',settings:{itemCount:1,productionMode:'manual',audioProfile:request.audioProfile}},
        audio_profile:request.audioProfile,audio_video_artifact_id:null,audio_video_provider_transfer:false},
      document_snapshot:request.snapshot,source_block_versions:request.sourceBlockVersions,
      planner:{provider:'openai',model:f.env.OPENAI_MODEL,request_status:'not_submitted'},
      source:{scope:'authorized_document_context',status:'not_transmitted',snapshot_sha256:sourceHash},
      accounting:{reservation_microusd:settings.reservation_microusd,settled_cost_microusd:0,reservation_is_provider_hard_cap:false,reservation_is_application_hard_cap:false}});
    assert.equal(input.content,JSON.stringify(inputReceipt),'The complete native receipt body remains the original JSON bytes');
    assert.deepEqual(retained,{...original,private_content:[...original.private_content,input].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
    assert.equal((await d1Rows(d1.db,outputIO)).length,4);
    assert.equal((await d1Rows(d1.db,'output_provider_calls')).length,0);assert.equal((await d1Rows(d1.db,'output_commands')).filter(row=>row.action==='run').length,0);
    assert.deepEqual(f.effects,{media:0,assets:0});assert.deepEqual(f.network,[]);assert.equal(f.detached,0);
    assert.deepEqual(d1.records.map(record=>record.operation),['prepare','review','authorize','authorize']);
    await d1.qualify({expectedRequests:4});
    evidence(f,'direct-worker-original-authorization',{executionContext:'local-bundled-Worker-handler-and-native-D1',original,prepared,shown,
      actualBody:actor.body,message:actor.message,ack,replay,native,retainedInput:{row:input,receipt:inputReceipt,sourceHash},beforeReplay:before,afterReplay});
  }finally{await d1.collect();}
});

test('Audio finite local Worker-handler D1 native admission rolls back concurrent original private-body drift',{timeout:300000},async t=>{
  const f=await preparedFixture(t,{detail:'An actual optional Context for the admission race.',prepare:false});
  const d1=await actualWorkerD1(t,f,{scenario:'original-body-drift'});
  try{
    const prepared=await d1.body(await d1.request('prepare'));assert.equal(prepared.status,'review');assert.equal(prepared.stage,'preflight');assert.equal(prepared.grant,null);
    assert.equal(prepared.preflight.planRevisionId,prepared.plan.revisionId);
    const shown=await d1.body(await d1.request('review'));assert.equal(shown.kind,'sponsor-audio-review');assert.equal(shown.binding.draftId,f.plan.draftId);
    const actor=await actorMessage(f,shown);await d1.refused(()=>d1.request('authorize',{rawBody:actor.message.body}));
    const {record,baseline}=d1.raceBaseline();assert.equal(record.operation,'authorize');assert.equal(record.race.applied,true);
    assert.equal(record.race.nativeCheckFailure,true,'The unchanged actual native admission batch produces its passed=1 CHECK refusal');
    assert.equal(record.race.baseline.complete,true,'No truncated rollback snapshot can qualify');
    const after=await d1Snapshot(d1.db,Object.keys(baseline));assert.deepEqual(after,baseline);
    assert.equal((await d1Rows(d1.db,'output_execution_grants')).length,0);
    assert.equal((await d1Rows(d1.db,'output_commands')).filter(row=>row.action==='authorize'||row.action==='run').length,0);
    assert.equal((await d1Rows(d1.db,'output_provider_calls')).length,0);assert.equal((await d1Rows(d1.db,outputIO)).length,3);
    assert.deepEqual(f.effects,{media:0,assets:0});assert.deepEqual(f.network,[]);assert.equal(f.detached,0);
    // The actual failed native batch may exceed the fixed sample bound.
    // Its cap is explicit; the native CHECK and complete business snapshot above
    // are mandatory. This record never claims a complete failed SQL trace.
    assert.ok(record.representatives.failure);if(!record.representatives.failure.complete)assert.equal(record.representatives.failure.reason,'cap');
    await d1.qualify({expectedRequests:3,race:true});
    evidence(f,'direct-worker-atomic-private-body-race',{executionContext:'local-bundled-Worker-handler-and-native-D1',before:baseline,after,
      changedOriginalEventId:f.original[0].event_id,nativeCheckFailure:true,failingBatchRepresentative:record.representatives.failure,fullQueryTrace:false});
  }finally{await d1.collect();}
});

// Portable source/shape correspondence only. The private recognizer's isolated
// input records below do not create an actual State, owner or admission frame.
async function audioWorkspaceSource(){
  const load=name=>{
    const source=readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
    const file=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);assert.equal(file.parseDiagnostics.length,0);
    const all=(root,predicate)=>{const values=[];const visit=node=>{if(predicate(node))values.push(node);ts.forEachChild(node,visit);};visit(root);return values;};
    const one=(values,label)=>{assert.equal(values.length,1,label);return values[0];};
    return {source,file,all,one,compact:node=>node.getText(file).replace(/\s+/gu,''),
      fn:name=>one(file.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name),name),
      variable:name=>one(all(file,node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name),name)};
  };
  const runtime=load('worker/runtime.ts'),reads=load('worker/experience-sponsor-audio-output-reads.ts');
  const [{PROFILE_EXCLUDED_EVENT_TYPES,PROJECT_BOOTSTRAP_EVENT_TYPES},{PHANTOM_ATTENTION_EVENT_SQL}]=await Promise.all([
    import('../src/model/event-profiles.ts'),import('../db/event-predicates.ts')]);
  const cap=runtime.variable('SCOPED_EVENT_PAGE_SIZE').initializer;assert.ok(ts.isNumericLiteral(cap));assert.equal(Number(cap.text),6500);
  const native=runtime.fn('readProfileEventPage'),names=['pageSize','eventTypes','placeholders','operator','index','attentionFilter'];
  const declarations=native.body.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>names.includes(value.name.getText(runtime.file))));
  assert.equal(declarations.length,names.length);
  const prepare=runtime.all(native,node=>ts.isCallExpression(node)&&runtime.compact(node.expression)==='env.DB.prepare');assert.equal(prepare.length,2);
  const shape=call=>{
    assert.equal(call.arguments.length,1);assert.ok(ts.isPropertyAccessExpression(call.parent));assert.equal(call.parent.name.text,'bind');
    const bind=call.parent.parent;assert.ok(ts.isCallExpression(bind));
    return `{sql:(${call.arguments[0].getText(runtime.file)}),bindings:[${bind.arguments.map(node=>node.getText(runtime.file)).join(',')}]}`;
  };
  // Execute only the original pure declarations/template/scalar expressions,
  // not readProfileEventPage, an env object, a SQL request or a fake DB method.
  const nativeSource=`function nativeProfileShape(){\n${declarations.map(node=>node.getText(runtime.file)).join('\n')}\nreturn [${prepare.map(shape).join(',')}];\n}`;
  const nativePair=compileFunction(stripTypeScriptTypes(nativeSource,{mode:'strip'})+'\nreturn nativeProfileShape();',
    ['streamId','profile','afterSequence','limit','SCOPED_EVENT_PAGE_SIZE','PROFILE_EXCLUDED_EVENT_TYPES','PROJECT_BOOTSTRAP_EVENT_TYPES','PHANTOM_ATTENTION_EVENT_SQL']);
  const pair=(stream,profile='workspace',cursor=0,limit=6500)=>nativePair(stream,profile,cursor,limit,Number(cap.text),PROFILE_EXCLUDED_EVENT_TYPES,PROJECT_BOOTSTRAP_EVENT_TYPES,PHANTOM_ATTENTION_EVENT_SQL);
  const helper=reads.fn('admissionWorkspacePair');
  const nativeHead=pair('shape-stream')[1].sql;assert.equal(nativeHead,reads.variable('HEAD_READ').initializer.text);
  return {runtime,reads,helper,pair,PROFILE_EXCLUDED_EVENT_TYPES,PHANTOM_ATTENTION_EVENT_SQL,pageSize:Number(cap.text)};
}

test('Audio finite native workspace pair requires the exact admission shape and runtime profile',async t=>{
  const u=await audioWorkspaceSource(),{reads,helper}=u;
  assert.equal(helper.modifiers?.some(node=>node.kind===ts.SyntaxKind.ExportKeyword)??false,false);
  const declarations=['integer','same','HEAD_READ','EVENT_COLUMNS'].map(name=>reads.variable(name).parent.parent.getText(reads.file)).join('\n');
  const admissions=new WeakMap();let checks=0,checkError;
  const recognize=compileFunction(stripTypeScriptTypes(declarations+'\n'+helper.getText(reads.file),{mode:'strip'})+'\nreturn admissionWorkspacePair;',
    ['admissions','currentAdmission','PROFILE_EXCLUDED_EVENT_TYPES','PHANTOM_ATTENTION_EVENT_SQL','SCOPED_EVENT_PAGE_SIZE'])(
    admissions,()=>{checks++;if(checkError)throw checkError;},u.PROFILE_EXCLUDED_EVENT_TYPES,u.PHANTOM_ATTENTION_EVENT_SQL,u.pageSize);
  const make=()=>{
    const i={owner:'shape-owner',stream:'shape-stream'},state={owner:{}},frame={input:{principal:{streamId:i.stream},
      scope:{kind:'personal',ownerUserId:i.owner,actorUserId:i.owner},ownerHead:10},dispatched:false,completed:false};
    admissions.set(state.owner,frame);return {i,state,frame,captured:u.pair(i.stream)};
  };
  let accepted=0,refused=0;
  for(const cursor of [0,1,10]){
    const x=make();x.captured=u.pair(x.i.stream,'workspace',cursor);checks=0;
    const found=recognize(x.state,x.captured,x.i);assert.equal(checks,1);assert.ok(found);
    assert.deepEqual(found.map(value=>[value.kind,value.maximumRows]),[['events',6500],['head',1]]);
    assert.deepEqual(found[1].columns,['head']);assert.equal(found[0].columns.length,20);
    assert.ok(found[0].columns.includes('owner_id')&&found[0].columns.includes('private_json'));accepted++;
  }
  const closed=[
    ['no frame',x=>admissions.delete(x.state.owner)],['other owner',x=>{x.state.owner={};}],['no input',x=>{delete x.frame.input;}],
    ...['prepared','native','dispatched','completed'].map(key=>[key,x=>{x.frame[key]=true;}]),
    ['single page',x=>{x.captured.pop();}],['extra statement',x=>{x.captured.push(x.captured[1]);}],
  ];
  const changed=[
    ['missing page slot',x=>{delete x.captured[0];}],['missing head slot',x=>{delete x.captured[1];}],
    ['principal stream',x=>{x.frame.input.principal.streamId='foreign';}],['scope',x=>{x.frame.input.scope.kind='project';}],
    ['scope owner',x=>{x.frame.input.scope.ownerUserId='foreign';}],['scope actor',x=>{x.frame.input.scope.actorUserId='foreign';}],
    ...[-1,1.5,NaN,Infinity,'10',null].map(value=>[`owner head ${String(value)}`,x=>{x.frame.input.ownerHead=value;}]),
    ['page stream',x=>{x.captured[0].bindings[0]='foreign';}],['head stream',x=>{x.captured[1].bindings[0]='foreign';}],
    ['two foreign streams',x=>{x.captured[0].bindings[0]='foreign';x.captured[1].bindings[0]='foreign';}],
    ...[-1,11,0.5,NaN,Infinity,'0',null].map(value=>[`raw cursor ${String(value)}`,x=>{x.captured[0].bindings[1]=value;}]),
    ...[1,6499,6501,'6500'].map(value=>[`page cap ${String(value)}`,x=>{x.captured[0].bindings[11]=value;}]),
    ...u.PROFILE_EXCLUDED_EVENT_TYPES.workspace.map((_,at)=>[`profile scalar ${at}`,x=>{x.captured[0].bindings[at+2]='UnrecognizedProfileEvent';}]),
    ['profile order',x=>{[x.captured[0].bindings[2],x.captured[0].bindings[3]]=[x.captured[0].bindings[3],x.captured[0].bindings[2]];}],
    ...['sessions','memory','scout','projects'].map(profile=>[profile,x=>{x.captured=u.pair(x.i.stream,profile);}]),
    ['wrong SQL whitespace',x=>{x.captured[0].sql+=' ';}],['missing phantom predicate',x=>{x.captured[0].sql=x.captured[0].sql.replace(` AND NOT (${u.PHANTOM_ATTENTION_EVENT_SQL})`,'');}],
    ['wrong head SQL',x=>{x.captured[1].sql+=' ';}],['swapped pair',x=>{x.captured.reverse();}],
    ['missing page scalar',x=>{x.captured[0].bindings.pop();}],['extra page scalar',x=>{x.captured[0].bindings.push(null);}],
    ['extra head scalar',x=>{x.captured[1].bindings.push(null);}],
  ];
  assert.equal(u.PROFILE_EXCLUDED_EVENT_TYPES.workspace.length,9);assert.equal(make().captured[0].bindings.length,12);
  for(const [group,expectedChecks]of [[closed,0],[changed,1]])for(const [label,change]of group){
    const x=make();change(x);checks=0;assert.equal(recognize(x.state,x.captured,x.i),null,label);assert.equal(checks,expectedChecks,label);refused++;
  }
  {const x=make();checkError=Error('pure current admission sentinel');assert.throws(()=>recognize(x.state,x.captured,x.i),error=>error===checkError);checkError=undefined;}
  // Source boundaries, not authority from the isolated shape records above.
  const calls=reads.all(reads.file,node=>ts.isCallExpression(node)&&reads.compact(node.expression)==='admissionWorkspacePair');assert.equal(calls.length,1);
  assert.deepEqual(calls[0].arguments.map(reads.compact),['state','captured','i']);
  let owner=calls[0].parent;while(owner&&!ts.isFunctionDeclaration(owner))owner=owner.parent;assert.equal(owner,reads.fn('nativeDatabase'));
  assert.equal(reads.all(helper,ts.isAwaitExpression).length,0);
  assert.equal(reads.compact(helper.body.statements[0]),'constframe=admissions.get(state.owner);');
  assert.equal(reads.compact(helper.body.statements[1]),'if(!frame?.input||frame.prepared||frame.native||frame.dispatched||frame.completed||captured.length!==2)returnnull;');
  assert.equal(reads.compact(helper.body.statements[2]),'currentAdmission(state,frame);');
  const current=reads.fn('currentAdmission'),currentText=reads.compact(current);
  for(const original of ['admissions.get(state.owner)!==frame','state.later?.kind!=="authorize"','ownedIssued.get(frame.issued)?.owner!==state.owner',
    'sponsorAudioAdmissionPreparation(frame.issued.admissionAuthority,audioAuthorityIdentity(frame.trusted))!==frame.preparation','frame.inputCheck?.()','admissionInputFacts(frame.input)!==frame.inputFacts'])assert.ok(currentText.includes(original),original);
  const database=reads.fn('nativeDatabase'),databaseText=reads.compact(database);
  assert.ok(databaseText.includes('constdescriptors=workspacePair??captured.map(item=>describeRead(state,item.sql,item.bindings,i));'));
  assert.ok(databaseText.includes('if(state.recovery&&descriptors.some(item=>!["proof","later-proof"].includes(item.kind)))returnfail("sponsor_audio_output_recovery_read_changed");'));
  const headCheck=reads.one(reads.all(database,node=>ts.isIfStatement(node)&&reads.compact(node.expression).startsWith('workspacePair&&')),'Exactly one paired HEAD result check');
  assert.equal(reads.compact(headCheck.expression),'workspacePair&&(restored[1]!.rows.length!==1||restored[1]!.rows[0]!.head!==admissions.get(state.owner)?.input?.ownerHead)');
  assert.equal(reads.compact(headCheck.thenStatement),'returnfail("sponsor_audio_output_native_workspace_head_changed");');
  const siblings=headCheck.parent.statements,position=siblings.indexOf(headCheck);assert.ok(position>=2);
  assert.equal(reads.compact(siblings[position-2]),'state.data.account({bytes:result.bytes,queries:0,rows:rowsCharged});');
  assert.equal(reads.compact(siblings[position-1]),'current(state);');
  const publish=siblings[position+1];assert.ok(ts.isForStatement(publish));assert.equal(reads.compact(publish.condition),'at<restored.length');
  const publication=reads.one(reads.all(publish,node=>ts.isCallExpression(node)&&reads.compact(node.expression)==='rowObservations.set'),'Original witness publication follows HEAD validation');
  assert.ok(headCheck.end<publication.getStart(reads.file));
  const rejectsHead=compileFunction(stripTypeScriptTypes(`function check(workspacePair,restored,state,admissions){return (${headCheck.expression.getText(reads.file)});}`,{mode:'strip'})+'\nreturn check;',[])();
  let headGuardCases=0;
  for(const [label,rows,rejected]of [
    ['same retained head',[{head:10}],false],['empty head',[],true],['duplicate head',[{head:10},{head:10}],true],
    ...[9,11,-1,'10',null,undefined,NaN,false].map(head=>[`wrong head ${String(head)}`,[{head}],true]),
  ]){const x=make();assert.equal(rejectsHead(true,[{rows:[]},{rows}],x.state,admissions),rejected,label);headGuardCases++;}
  {const x=make();admissions.delete(x.state.owner);assert.equal(rejectsHead(true,[{rows:[]},{rows:[{head:10}]}],x.state,admissions),true);headGuardCases++;}
  {const x=make();assert.equal(rejectsHead(null,[],x.state,admissions),null,'An ordinary batch retains its original path');headGuardCases++;}
  for(const name of ['nativeRead','describeRead'])assert.equal(reads.all(reads.fn(name),node=>ts.isIdentifier(node)&&node.text==='admissionWorkspacePair').length,0,'Single reads remain unchanged');
  assert.ok(reads.compact(reads.fn('describeRead')).includes('if(sql===PAGE_READ&&b.length===3&&b[0]===i.stream&&integer(b[1])&&b[2]===5000)return{kind:"events",columns:EVENT_COLUMNS,maximumRows:5000};'),'The original raw-page limit remains exactly 5000');
  assert.ok(databaseText.includes('invalidRow:invalidNativeRow(descriptors[at]!,i)'),'Workspace event descriptors pass through the original ownership/row guard');
  assert.ok(databaseText.includes('constitem=captured[at]!,d=descriptors[at]!,observation=restored[at]!;'));
  assert.ok(databaseText.includes('elseobserve(state,d,observation.rows,item,i);'),'Actual workspace rows retain original owner/body observation');
  const invalid=reads.compact(reads.fn('invalidNativeRow')),observe=reads.compact(reads.fn('observe'));
  assert.ok(invalid.includes('row.private_jsonISNOTNULLAND(typeof(row.private_json)<>\'text\'ORNOTjson_valid(row.private_json)ORrow.created_atISNULL'));
  assert.ok(invalid.includes('row.private_event_idISNOTrow.event_idORrow.owner_idISNOT'));
  assert.ok(observe.includes('row.stream_id!==i.stream'));assert.ok(observe.includes('row.private_event_id!==row.event_id||row.owner_id!==i.owner'));
  // Run the unchanged event observation path and real rememberBody declaration
  // with isolated records only. No owner, row witness or admission is produced.
  // JSON validity and created_at remain SQL-level checks asserted above;
  // rememberBody alone intentionally does not parse JSON.
  const observeEvents=compileFunction(stripTypeScriptTypes(reads.variable('integer').parent.parent.getText(reads.file)+'\n'
    +reads.fn('rememberBody').getText(reads.file)+'\n'+reads.fn('observe').getText(reads.file),{mode:'strip'})+'\nreturn observe;',['fail'])(
    code=>{throw Object.assign(Error(code??'shape_event_refused'),{code:code??'shape_event_refused'});});
  const event=()=>({event_id:'shape-event',stream_id:'shape-stream',sequence:1,private_event_id:'shape-event',owner_id:'shape-owner',
    private_json:'{"shape":true}',project_id:null,document_id:null});
  const shapeState=()=>({observedEvents:new Set(),observedBodies:new Map()}),shapeIdentity={owner:'shape-owner',stream:'shape-stream'};
  {const state=shapeState(),row=event();observeEvents(state,{kind:'events'},[row],{},shapeIdentity);
    assert.deepEqual([...state.observedEvents],[row.event_id]);assert.deepEqual(state.observedBodies.get(row.event_id),{raw:row.private_json,projectId:null,documentId:null});}
  for(const field of ['stream_id','private_event_id','owner_id']){
    const state=shapeState(),row={...event(),[field]:'foreign'};
    assert.throws(()=>observeEvents(state,{kind:'events'},[row],{},shapeIdentity),error=>error.code==='shape_event_refused',field);
    assert.equal(state.observedBodies.size,0,'A wrong stream/private ID/owner cannot retain a private body');
  }
  t.diagnostic(JSON.stringify({evidence:'actual-private-workspace-recognizer-shape-and-source-only',accepted,refused,currentErrorPropagated:true,
    headGuardCases,eventGuardAccepted:1,eventGuardRefused:3,realOwnerCreated:false,sqlExecuted:false}));
});

// Added to the existing full native success, after all original lifetimes close.
// The real packed wrappers retain the native row query after authority proofs.
async function assertActualAdmissionWorkspacePair(f,records){
  const u=await audioWorkspaceSource(),excluded=u.PROFILE_EXCLUDED_EVENT_TYPES.workspace;
  const matches=records.filter(entry=>entry.kind==='batch'&&entry.statements.length===2&&entry.statements[0].sql.includes(u.PHANTOM_ATTENTION_EVENT_SQL)
    &&entry.statements[0].sql.includes('AND type NOT IN (')&&entry.statements[1].sql.includes('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id='));
  assert.ok(matches.length>0,'The genuine native admission reaches its exact workspace/head pair');
  for(const entry of matches){
    assert.ok(Array.isArray(entry.result));assert.equal(entry.result.length,2);assert.ok(entry.returnedBytes>0);
    const vector=JSON.parse(entry.statements[0].bindings[0]),tail=vector.slice(-12),cursor=tail[1];
    assert.ok(Number.isSafeInteger(cursor)&&cursor>=0);assert.deepEqual(tail,[f.stream,cursor,...excluded,6500]);
    const headVector=JSON.parse(entry.statements[1].bindings[0]);assert.equal(headVector.at(-1),f.stream);
    for(const [at,part]of entry.statements.entries()){
      assert.equal(part.bindings.length,1);assert.ok(bytes(part.sql)<=100000);
      assert.equal(entry.result[at].success,true);assert.equal(entry.result[at].results.length,1);assert.equal(entry.result[at].results[0].authorized,1);
      const row=entry.result[at].results[0],body=JSON.parse(row.body);assert.equal(body.length,row.count);assert.ok(body.every(item=>Array.isArray(item)));
      if(at===0){assert.ok(body.length<=6500);assert.ok(body.every(item=>item.length===20&&item[1]===f.stream&&(item[17]===null||item[14]===f.actor)));}
      else{assert.equal(body.length,1);assert.equal(body[0].length,1);assert.ok(Number.isSafeInteger(body[0][0])&&body[0][0]>=cursor);}
    }
  }
}

test('Audio finite genuine review owner cannot use the admission workspace pair',{timeout:300000},async t=>{
  const {readProfileEventPage,SCOPED_EVENT_PAGE_SIZE}=await import('../worker/runtime.ts');
  const {readSponsorAudioOutputNativeDraft}=await import('../worker/experience-sponsor-audio-output-native.ts');
  const f=await preparedFixture(t),observed=observeDatabase(f),request=f.outputRequest('review'),owned=await ownedContinuation(t,f,request,'review');
  const env=owned.reads.requireSponsorAudioOutputReads(owned.owner).nativeEnv;
  // The same genuine custody/plan prerequisite used by continueReview installs
  // the real identity, without installing its final disclosure or admission frame.
  const retained=await readSponsorAudioOutputNativeDraft(owned.owner,request,env);
  assert.equal(retained.plan.draftId,f.plan.draftId);owned.view.current();
  const before=businessSnapshot(f),charged=rows(f,outputIO),start=observed.records.length;
  await assert.rejects(()=>readProfileEventPage(env,f.stream,'workspace',0,SCOPED_EVENT_PAGE_SIZE),error=>error?.code==='sponsor_audio_output_native_query_changed');
  const reached=observed.records.slice(start);
  assert.ok(reached.every(entry=>entry.statements.every(part=>!part.sql.includes('AND type NOT IN ('))),'No workspace page is dispatched/disclosed outside admission');
  assert.deepEqual(businessSnapshot(f),before);assert.deepEqual(rows(f,outputIO),charged);assertNoRun(f);assert.throws(()=>owned.view.current());
  const stoppedAt=observed.records.length;await refused(owned.run);assert.equal(observed.records.length,stoppedAt,'A refused owner cannot continue');
  evidence(f,'workspace-outside-admission',{operation:'genuine-review-owner-after-native-draft-custody',nativeRefusal:'sponsor_audio_output_native_query_changed',retired:true,
    originalIdentityReadBoundaries:reached.length,workspacePageDispatched:false,charged});
});

import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,nativeRequest,responseBody,bytes,count,rows,snapshot,observeDatabase,assertNoGeneration,FAMILY,registrationFixture} from './experience-sponsor-audio-intake-native-fixture.mjs';
const {prepareSponsorAudioDraft,commitSponsorAudioDraft,readSponsorAudioIntake}=await import('../worker/experience-sponsor-audio-intake.ts');
const {canonicalJson,digest}=await import('../src/experiences/compiler.ts');
const {receiptPrefix}=await import('../src/experiences/intake.ts');
const oldFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Initial Audio native qualification forbids network');};
after(()=>{globalThis.fetch=oldFetch;assert.equal(networkAttempts,0);});
const IO='experience_sponsor_audio_intake_attempts',SIDECAR='experience_sponsor_audio_intakes',ALLOCATION='experience_sponsor_audio_intake_allocations';
const appendBatch=entry=>entry.kind==='batch'&&entry.statements.some(part=>part.sql.startsWith('INSERT INTO event_write_stage '));
const storageBatch=entry=>entry.kind==='batch'&&entry.statements.some(part=>/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+private_content\b/iu.test(part.sql));
const assertNoHeadFallback=observed=>assert.equal(observed.sql().some(sql=>/^SELECT COALESCE\(MAX\(sequence\),0\) AS head FROM events/iu.test(sql)),false);
const substantive=f=>snapshot(f,{exclude:[IO]});
const prepare=(f,native=f.nativeRequest)=>prepareSponsorAudioDraft(f.prepareRequest(native),f.env).then(responseBody);
const commit=(f,plan)=>commitSponsorAudioDraft(f.commitRequest(plan),f.env).then(responseBody);
const reopen=(f,plan,operation='audio-intake-draft',selector={draftId:plan.draftId})=>
  readSponsorAudioIntake(f.readRequest(),f.env,{operation,...selector}).then(responseBody);
async function denied(action){
  let value;try{value=await action();}catch(error){if(error?.code==='ERR_ASSERTION')throw error;assert.ok(error instanceof Error);return error;}
  assert.ok(value instanceof Response,'Refusal must be an exception or HTTP-shaped error Response');
  assert.ok(value.status>=400,`Expected refusal, got ${value.status}: ${await value.text()}`);return value;
}
function privateDraft(f,plan){return f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(plan.draftId);}
function originalEvents(f,plan){
  return f.sqlite.prepare(`SELECT receipt.client_event_id,event.type,event.event_id,event.sequence,secret.private_json
    FROM event_client_receipts receipt JOIN events event ON event.event_id=receipt.event_id
    JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE receipt.stream_id=? AND substr(receipt.client_event_id,1,?)=? ORDER BY event.sequence`)
    .all(f.stream,receiptPrefix(plan.draftId).length,receiptPrefix(plan.draftId));
}
function assertOriginal(f,plan){
  const saved=originalEvents(f,plan);assert.equal(saved.length,plan.events.length);
  saved.forEach((row,index)=>{
    assert.equal(row.client_event_id,plan.events[index].payload.client_event_id);
    assert.equal(row.type,plan.events[index].type);assert.equal(row.private_json,JSON.stringify(plan.events[index].payload));
  });
  return saved;
}
async function assertAllocation(f,plan,expiresAt){
  assert.equal(count(f,ALLOCATION),1);assert.equal(count(f,SIDECAR),1);
  const allocation=rows(f,ALLOCATION)[0],sidecar=rows(f,SIDECAR)[0],content=canonicalJson(plan),payloads=plan.events.map(event=>JSON.stringify(event.payload));
  assert.deepEqual(sidecar,allocation);assert.equal(allocation.receipt_id,plan.sponsor_intake.receiptId);
  assert.equal(allocation.draft_id,plan.draftId);assert.equal(allocation.actor_user_id,f.actor);assert.equal(allocation.campaign_id,f.campaignId);
  assert.equal(allocation.draft_bytes,bytes(content));assert.equal(allocation.event_bytes,payloads.reduce((sum,payload)=>sum+bytes(payload),0));
  assert.equal(allocation.total_bytes,allocation.draft_bytes+allocation.event_bytes);assert.equal(allocation.event_count,plan.events.length);
  assert.equal(allocation.content_digest,await digest(content));assert.equal(allocation.event_payload_digest,await digest(payloads));
  assert.equal(allocation.source_digest,await digest(plan.events));assert.equal(allocation.expires_at,expiresAt);
  assert.equal(JSON.stringify(allocation).includes(plan.request.values.direction.value),false,'Source-free allocation retains no authored text');
  return allocation;
}

for(const detail of ['', 'One sustained ending. 水 — موسيقى'])test(`native initial Audio ${detail?'6':'5'}-event prepare, commit and original reopen allocate once`,async t=>{
  const f=await fixture(t,{detail,strict:true}),observed=observeDatabase(f);
  const first=await prepare(f),plan=first.plan;assert.equal(first.status,'prepared');assert.equal(first.replayed,false);
  assert.equal(plan.events.length,detail?6:5);assert.equal(plan.streamId,f.stream);
  assert.equal(plan.events[3].payload.properties.experience_value,f.nativeRequest.values.direction.value);
  if(detail)assert.equal(plan.events[4].payload.properties.experience_value,detail);
  const {EXPERIENCE_AUDIO_INTENT}=await import('../src/experiences/contracts.ts');
  assert.deepEqual(plan.events.at(-1).payload.properties.experience_audio_intent,EXPERIENCE_AUDIO_INTENT);
  assert.match(plan.events.at(-1).payload.properties.text,/Instrumental only/u);
  assert.deepEqual(Object.keys(plan.sponsor_intake).sort(),['family','receiptId','version']);
  assert.equal(plan.sponsor_intake.family,FAMILY);assert.equal(plan.sponsor_intake.version,1);
  const {draftHash,...base}=plan;assert.equal(await digest(base),draftHash);
  const saved=privateDraft(f,plan);assert.equal(saved.content,canonicalJson(plan));assert.equal(saved.expires_at,first.expiresAt);
  assert.ok(Date.parse(saved.expires_at)>f.intakePolicy.storage.expiresAtMs,'Native retention is not shortened to the storage-write window');
  await assertAllocation(f,plan,first.expiresAt);
  assert.equal(count(f,SIDECAR),1);assert.equal(count(f,IO),1);assert.equal(count(f,'events'),0);
  const original=substantive(f),repeat=await prepare(f);assert.equal(repeat.replayed,true);assert.deepEqual(repeat.plan,plan);
  assert.deepEqual(substantive(f),original);assert.equal(count(f,IO),2);
  const committed=await commit(f,plan);assert.equal(committed.status,'complete');assert.equal(committed.documentId,plan.documentId);
  assert.equal(committed.generation,'unavailable');assert.equal(committed.appended.length,plan.events.length);
  const nativeRows=assertOriginal(f,plan),complete=substantive(f);assert.equal(count(f,IO),3);
  const replay=await commit(f,plan);assert.equal(replay.status,'complete');assert.equal(replay.replayed,true);
  assert.deepEqual(replay.appended,committed.appended);assert.deepEqual(substantive(f),complete);assert.equal(count(f,IO),4);
  const draft=await reopen(f,plan);assert.deepEqual(draft.plan,plan);assert.equal(draft.expiresAt,first.expiresAt);
  const receipt=await reopen(f,plan,'audio-intake-receipt');assert.equal(receipt.status,'complete');assert.deepEqual(receipt.appended,committed.appended);
  const byIntent=await reopen(f,plan,'audio-intake-draft',{intentId:plan.request.intentId});assert.deepEqual(byIntent.plan,plan);
  assert.equal(count(f,IO),7);assert.deepEqual(substantive(f),complete);assert.deepEqual(assertOriginal(f,plan),nativeRows);
  await assertAllocation(f,plan,first.expiresAt);
  assertNoGeneration(f);assert.equal(networkAttempts,0);
  const attempts=rows(f,IO);assert.ok(attempts.every(row=>row.maximum_bytes===2_000_000));
  assert.ok(observed.sql().some(sql=>sql.includes('memory_structured_answer_origins')),'Actual native Memory metadata helper was observed');
  assert.ok(observed.sql().some(sql=>sql.includes('INSERT INTO event_client_receipts')),'Actual atomic native receipt was used');
  observed.restore();
  if(f.limits){f.limits.assertVerified();t.diagnostic(JSON.stringify({strictSql:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts),
    draftBytes:bytes(saved.content),eventBytes:plan.events.reduce((sum,event)=>sum+bytes(event.payload),0),events:nativeRows.length,ioAttempts:attempts.length,networkAttempts}));}
});

test('old V8 generation approval alone does not authorize initial private storage or IO',async t=>{
  const f=await fixture(t,{intakeApproved:false}),before=snapshot(f);await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));
  assert.deepEqual(snapshot(f),before);assertNoGeneration(f);
});

for(const phase of ['prepare','commit'])test(`lost ${phase} native batch ACK recovers in the same request; a new request pays separately`,async t=>{
  const f=await fixture(t),first=phase==='commit'?await prepare(f):null;let lost=false,writes=0;
  const observer=observeDatabase(f,{after(entry){
    const matched=phase==='prepare'?storageBatch(entry):appendBatch(entry);
    if(matched)writes++;
    if(!lost&&matched){lost=true;throw Error(`fixture lost ${phase} native ACK`);}
  }});
  const initial=await(phase==='prepare'?prepare(f):commit(f,first.plan));
  assert.equal(initial.status,phase==='prepare'?'prepared':'complete');
  assert.equal(initial.replayed,phase==='prepare');assert.equal(writes,1);
  assert.equal(count(f,IO),phase==='prepare'?1:2,'Same-request recovery uses its existing paid attempt');
  assert.equal(lost,true);assert.equal(count(f,SIDECAR),1);const before=substantive(f),ioBefore=count(f,IO);
  const replay=await(phase==='prepare'?prepare(f):commit(f,first.plan));assert.equal(replay.status,phase==='prepare'?'prepared':'complete');
  assert.equal(replay.replayed,true);assert.deepEqual(substantive(f),before);assert.equal(count(f,IO),ioBefore+1);
  assert.equal(replay.draftHash??replay.plan.draftHash,initial.draftHash??initial.plan.draftHash);
  if(phase==='commit'){assert.deepEqual(replay.appended,initial.appended);assertOriginal(f,first.plan);}
  assert.equal(writes,1);assertNoHeadFallback(observer);
  observer.restore();assertNoGeneration(f);
});

for(const fault of ['false-success','zero-change','sparse','oversized'])test(`actual append ${fault} ACK is charged once without retry or hidden head read`,async t=>{
  const f=await fixture(t),first=await prepare(f);let writes=0,faultAt=-1,originalLength,faultApplied=false,ackTraversals=0;
  const observer=observeDatabase(f,{transform(entry,result){
    if(!appendBatch(entry))return result;
    writes++;faultAt=observer.records.length-1;
    originalLength=result.length;
    const changed=structuredClone(result);
    if(fault==='false-success')changed[0].success=false;
    if(fault==='zero-change')for(let i=0;i<first.plan.events.length;i++)changed[i].meta.changes=0;
    if(fault==='sparse')delete changed[0];
    if(fault==='oversized')changed[0].fixturePadding='x'.repeat(2_000_001);
    faultApplied=true;
    return new Proxy(changed,{ownKeys(target){ackTraversals++;return Reflect.ownKeys(target);}});
  }});
  const outcome=await commitSponsorAudioDraft(f.commitRequest(first.plan),f.env).then(response=>({response}),error=>({error}));
  assert.equal(writes,1);assert.ok(faultAt>=0);assert.equal(originalLength,2*first.plan.events.length);assert.equal(faultApplied,true);assert.ok(ackTraversals>=1);
  assert.equal(count(f,IO),2);assertOriginal(f,first.plan);
  const actual=substantive(f);
  if(['false-success','zero-change'].includes(fault)){
    assert.ok(outcome.response);const body=await responseBody(outcome.response);assert.equal(body.status,'complete');assert.equal(body.replayed,false);
    assert.ok(observer.records.length>faultAt+1,'Measurable ACK corruption can recover the committed original within the same allowance');
  }else{
    assert.ok(outcome.error instanceof Error);assert.equal(outcome.response,undefined);
    assert.equal(observer.records.length,faultAt+1,'Latched invalid accounting cannot reach another private recovery read');
  }
  assertNoHeadFallback(observer);observer.restore();
  const replay=await commit(f,first.plan);assert.equal(replay.replayed,true);assert.equal(count(f,IO),3);
  assert.deepEqual(substantive(f),actual);assertNoGeneration(f);
});

test('a real concurrent original winner after the first empty check is returned without a second append',async t=>{
  const f=await fixture(t),first=await prepare(f);let raced=false,winner,writes=0;
  const observer=observeDatabase(f,{async after(entry){
    if(appendBatch(entry))writes++;
    if(!raced&&entry.kind==='all'&&entry.statements[0].sql.includes('audio_native_rows')&&entry.statements[0].sql.includes('receipt_total')){
      const [row]=entry.result.results;assert.equal(row.bounded,1);
      const empty=JSON.parse(row.body);assert.equal(empty.length,first.plan.events.length);
      empty.forEach((values,index)=>{assert.equal(values.length,18);assert.equal(values[0],first.plan.events[index].payload.client_event_id);
        assert.ok(values.slice(1,16).every(value=>value===null));assert.equal(values[16],0);assert.equal(values[17],0);});
      raced=true;winner=await commit(f,first.plan);
    }
  }});
  const outer=await commit(f,first.plan);assert.equal(raced,true);assert.equal(winner.status,'complete');assert.equal(winner.replayed,false);
  assert.equal(outer.status,'complete');assert.equal(outer.replayed,true);assert.deepEqual(outer.appended,winner.appended);
  assert.equal(writes,1);assert.equal(count(f,IO),3);assertOriginal(f,first.plan);assertNoHeadFallback(observer);
  observer.restore();assertNoGeneration(f);
});

test('contradictory source-free bodyDigest refuses commit and both original reads after consistent metadata corruption',async t=>{
  const f=await fixture(t),first=await prepare(f);
  const originalRows=rows(f,ALLOCATION),schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
  // Explicit synthetic corruption: preserve the real schema after changing the
  // same field in both immutable rows. No product mutation path is represented.
  const triggers=f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name IN(?,?)")
    .all(`${SIDECAR}_no_update`,`${ALLOCATION}_no_update`);
  assert.equal(triggers.length,2);
  for(const trigger of triggers)f.sqlite.exec(`DROP TRIGGER "${trigger.name}"`);
  const contradictory=await digest({fixture:'contradicts exact retained request'});
  for(const table of [SIDECAR,ALLOCATION])f.sqlite.prepare(`UPDATE ${table} SET body_digest=? WHERE draft_id=?`).run(contradictory,first.plan.draftId);
  for(const trigger of triggers)f.sqlite.exec(trigger.sql);
  assert.deepEqual(f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(),schema);
  assert.deepEqual(rows(f,ALLOCATION).map(row=>({...row,body_digest:originalRows[0].body_digest})),originalRows);
  assert.deepEqual(rows(f,SIDECAR),rows(f,ALLOCATION));const before=substantive(f);
  for(const operation of ['commit','audio-intake-draft','audio-intake-receipt']){
    const error=await denied(()=>operation==='commit'?commitSponsorAudioDraft(f.commitRequest(first.plan),f.env):readSponsorAudioIntake(f.readRequest(),f.env,{operation,draftId:first.plan.draftId}));
    assert.equal(error.message,'sponsor_audio_intake_original_unavailable');
    assert.deepEqual(substantive(f),before);
  }
  assert.equal(count(f,IO),4);assert.equal(count(f,'events'),0);assertNoGeneration(f);
});

test('exhausted genuine IO capability stays invalid through cached methods and cannot start another read',async t=>{
  const f=await fixture(t),observed=observeDatabase(f),request=f.prepareRequest();
  const {identifySponsorAudioIntake,createSponsorAudioIntakeBudget,requireSponsorAudioIntakeBudget}=await import('../worker/experience-sponsor-audio-intake-reads.ts');
  const {reserveSponsorAudioIntakeAttempt}=await import('../worker/experience-sponsor-audio-intake-attempts.ts');
  const authority=await identifySponsorAudioIntake(request,f.env,{operation:'audio-intake-prepare'});
  const attempt=await reserveSponsorAudioIntakeAttempt(authority,request,f.env,'audio-intake-prepare');
  const cap=await createSponsorAudioIntakeBudget(authority,attempt,request,f.env),state=requireSponsorAudioIntakeBudget(cap,request,f.env);
  const calls=observed.records.length;let dispatched=false;
  assert.throws(()=>state.accountBytes(state.remaining()+1),/io_byte_capacity/u);
  for(const action of [()=>state.current(),()=>state.count(),()=>state.accountBytes(0),()=>requireSponsorAudioIntakeBudget(cap,request,f.env)])
    assert.throws(action,/io_unavailable/u);
  await assert.rejects(state.wait(async()=>{dispatched=true;return null;}),/io_unavailable/u);
  assert.equal(dispatched,false);assert.equal(observed.records.length,calls);assert.equal(count(f,IO),1);assert.equal(count(f,ALLOCATION),0);
  observed.restore();assertNoGeneration(f);
});

test('final Response adoption rechecks lifetime after the nested finalizer creates the actual response',async t=>{
  const f=await fixture(t);await prepare(f);const before=substantive(f),request=f.prepareRequest(),headers=request.headers;
  const ActualResponse=globalThis.Response;let constructed=false,innerCheck=false,mutated=false;
  Object.defineProperty(request,'headers',{get(){if(constructed&&!mutated)innerCheck=true;return headers;}});
  t.mock.method(globalThis,'Response',class extends ActualResponse{
    constructor(body,options){
      super(body,options);
      if(this.headers.get('cache-control')==='private, no-store'){
        assert.equal(constructed,false);constructed=true;
        queueMicrotask(()=>{mutated=true;f.env.DB={...f.env.DB};});
      }
    }
  });
  const outcome=await prepareSponsorAudioDraft(request,f.env).then(response=>({response}),error=>({error}));
  assert.equal(constructed,true);assert.equal(innerCheck,true);assert.equal(mutated,true);
  assert.equal(outcome.response,undefined,'Reject the exported promise itself, before any body-stream read');
  assert.ok(outcome.error instanceof Error);assert.match(outcome.error.message,/response_unavailable|authority_changed/u);
  assert.deepEqual(substantive(f),before);assert.equal(count(f,IO),2);assertNoGeneration(f);
});

test('simulated registered revision transition preserves exact old original prepare and refuses changed or fresh stale requests',async t=>{
  const f=await fixture(t),first=await prepare(f),completed=await commit(f,first.plan);
  const {registeredExperience,validateIntakeRequest}=await import('../src/experiences/intake.ts');
  const originalRelease=await registeredExperience('audio'),before=substantive(f),initialIo=count(f,IO);
  assert.equal(originalRelease.definition.revision,1);assert.equal(registrationFixture.loaded(),1);
  try{
    registrationFixture.setRevision(2);
    const current=await registeredExperience('audio');assert.equal(current.definition.revision,2);
    assert.notEqual(current.releaseHash,originalRelease.releaseHash);assert.equal(await validateIntakeRequest(f.nativeRequest),null);
    const replay=await prepare(f);assert.equal(replay.replayed,true);assert.deepEqual(replay.plan,first.plan);assert.equal(replay.expiresAt,first.expiresAt);
    const receipt=await commit(f,first.plan);assert.equal(receipt.replayed,true);assert.deepEqual(receipt.appended,completed.appended);
    assert.deepEqual(substantive(f),before);assert.equal(count(f,IO),initialIo+2);
    const changed=structuredClone(f.nativeRequest);changed.values.direction.value='A different character after registration changes';
    const changedError=await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(changed),f.env));
    assert.equal(changedError.message,'sponsor_audio_intake_original_changed');
    const fresh=await nativeRequest();fresh.releaseHash=originalRelease.releaseHash;
    const staleError=await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(fresh),f.env));
    assert.equal(staleError.message,'sponsor_audio_intake_command_invalid');
    assert.equal(count(f,IO),initialIo+2,'Rejected new input has no IO admission');assert.deepEqual(substantive(f),before);
    assert.equal(count(f,ALLOCATION),1);assertOriginal(f,first.plan);assertNoGeneration(f);
  }finally{registrationFixture.setRevision(1);}
});

test('the same native intent cannot change authored input or adopt a different reviewed campaign',async t=>{
  const f=await fixture(t),first=await prepare(f),changed=structuredClone(f.nativeRequest);changed.values.direction.value='A different authored character';
  const before=substantive(f);await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(changed),f.env));assert.deepEqual(substantive(f),before);
  const other=structuredClone(f.proposal);other.policy.campaignId+='-other';await f.approveCampaign({proposal:other,approvalId:'initial-other-campaign'});
  await f.approveIntake({campaignId:other.policy.campaignId});const second=substantive(f);
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(f.nativeRequest,other.policy.campaignId),f.env));
  assert.deepEqual(substantive(f),second);assert.equal(privateDraft(f,first.plan).content,canonicalJson(first.plan));assert.equal(count(f,SIDECAR),1);
});

for(const phase of ['prepare','commit'])for(const revoked of ['actor consent','campaign'])test(`${phase} late ${revoked} refusal rolls back every native write`,async t=>{
  const f=await fixture(t),first=phase==='commit'?await prepare(f):null;let fired=false,boundary;
  const observer=observeDatabase(f,{before(entry){
    const matched=entry.statements.some(part=>phase==='prepare'?/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+private_content\b/iu.test(part.sql):part.sql.includes('INSERT INTO event_client_receipts'));
    if(!fired&&entry.kind==='batch'&&matched){fired=true;
      if(revoked==='actor consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);
      else f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
      boundary=substantive(f);
    }
  }});
  await denied(()=>phase==='prepare'?prepareSponsorAudioDraft(f.prepareRequest(),f.env):commitSponsorAudioDraft(f.commitRequest(first.plan),f.env));
  assert.equal(fired,true);assert.deepEqual(substantive(f),boundary);assert.equal(count(f,'events'),0);
  assert.equal(count(f,SIDECAR),phase==='prepare'?0:1);observer.restore();assertNoGeneration(f);
});

test('completed original receipt survives disabled generation while current actor consent still gates disclosure',async t=>{
  const f=await fixture(t),first=await prepare(f),original=await commit(f,first.plan);
  f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
  f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  const before=substantive(f),recovered=await commit(f,first.plan),receipt=await reopen(f,first.plan,'audio-intake-receipt');
  assert.equal(recovered.replayed,true);assert.deepEqual(recovered.appended,original.appended);assert.deepEqual(receipt.appended,original.appended);
  assert.deepEqual(substantive(f),before);f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);
  const revoked=substantive(f);await denied(()=>readSponsorAudioIntake(f.readRequest(),f.env,{operation:'audio-intake-receipt',draftId:first.plan.draftId}));
  assert.deepEqual(substantive(f),revoked);assertNoGeneration(f);
});

test('expired original draft refuses reopen and replacement without deleting already committed Context',async t=>{
  const f=await fixture(t),first=await prepare(f);await commit(f,first.plan);const nativeRows=assertOriginal(f,first.plan);
  f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(first.plan.draftId);
  const before=substantive(f);
  for(const action of [()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env),()=>commitSponsorAudioDraft(f.commitRequest(first.plan),f.env),
    ()=>readSponsorAudioIntake(f.readRequest(),f.env,{operation:'audio-intake-receipt',draftId:first.plan.draftId})])await denied(action);
  assert.deepEqual(substantive(f),before);assert.deepEqual(assertOriginal(f,first.plan),nativeRows);assert.equal(count(f,SIDECAR),1);assertNoGeneration(f);
});

for(const mutation of ['database','headers','abort'])test(`native prepare refuses ${mutation} drift at an actual awaited database read`,async t=>{
  const f=await fixture(t),controller=new AbortController();let request,fired=false;
  const observer=observeDatabase(f,{after(){if(!fired){fired=true;
    if(mutation==='database')f.env.DB={...f.env.DB};
    if(mutation==='headers')request.headers.set('oai-authenticated-user-id',f.payer);
    if(mutation==='abort')controller.abort();
  }}});
  request=f.prepareRequest(f.nativeRequest,f.campaignId,{signal:controller.signal});const before=substantive(f);
  await denied(()=>prepareSponsorAudioDraft(request,f.env));assert.equal(fired,true);assert.deepEqual(substantive(f),before);
  assert.equal(count(f,SIDECAR),0);observer.restore();assertNoGeneration(f);
});

test('a one-byte request ceiling refuses before storing or exposing an initial draft',async t=>{
  const f=await fixture(t,{intakeApproved:false});f.intakePolicy.io.operations['audio-intake-prepare'].maximumBytes=1;
  await f.approveIntake();const before=substantive(f);
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));assert.deepEqual(substantive(f),before);
  // Depending on whether bounded control bytes already exceed the ceiling, the
  // reservation may refuse before debit or stay charged after successful debit.
  assert.ok(count(f,IO)<=1);assert.equal(count(f,SIDECAR),0);assertNoGeneration(f);
});

test('actual native collector redacts eligible expired owner text while preserving excluded Memory and other-owner bodies',async t=>{
  const f=await fixture(t),insert=f.sqlite.prepare(`INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at)
    VALUES(?,?,?,?,?,?,NULL)`);
  for(const [id,owner,kind]of [['old-ordinary',f.actor,'prompt'],['old-memory',f.actor,'chat-assistant-memory'],
    ['old-durable',f.actor,'document-artifact'],['old-other-owner',f.payer,'prompt']])
    insert.run(id,owner,kind,`synthetic-${id}`,'1999-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z');
  const before=rows(f,'private_content'),observer=observeDatabase(f),first=await prepare(f);
  const expired=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE content_id='old-ordinary'").get();
  assert.equal(expired.content,'');assert.equal(typeof expired.redacted_at,'string');
  for(const row of before.filter(row=>row.content_id!=='old-ordinary'))
    assert.deepEqual({...f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(row.content_id)},row);
  const metadata=observer.records.filter(entry=>entry.statements.some(part=>part.sql.includes('memory_structured_answer_origins')));
  assert.ok(metadata.length>0);assert.ok(metadata.every(entry=>JSON.stringify(entry.result??null).includes('synthetic-old-')===false));
  assert.equal(privateDraft(f,first.plan).content,canonicalJson(first.plan));observer.restore();assertNoGeneration(f);
});

test('private authored source is never returned by a database read before this request has its IO reservation',async t=>{
  const f=await fixture(t);let privateReturned=0;
  const observer=observeDatabase(f,{after(entry){
    if(JSON.stringify(entry.result??null).includes(f.nativeRequest.values.direction.value)){
      privateReturned++;assert.equal(count(f,IO),1,'Private result needs the exact admitted request first');
    }
  }});
  const first=await prepare(f);assert.ok(privateReturned>0);assert.equal(count(f,IO),1);
  await assertAllocation(f,first.plan,first.expiresAt);observer.restore();
});

for(const cap of ['maximumDraftBytes','maximumEventBytes','maximumOriginalBytes'])test(`actual native byte accounting enforces ${cap} before storage`,async t=>{
  const f=await fixture(t,{intakeApproved:false});
  if(cap==='maximumOriginalBytes'){
    const native=await f.buildPlan(),{draftHash:_nativeHash,...nativeBase}=native;
    const receiptId=`sponsor-audio-intake-${(await digest({campaignId:f.campaignId,actor:f.actor,intent:f.nativeRequest.intentId})).slice(7)}`;
    const base=JSON.parse(canonicalJson({...nativeBase,sponsor_intake:{version:1,family:FAMILY,receiptId}}));
    const plan=JSON.parse(canonicalJson({...base,draftHash:await digest(base)})),draftBytes=bytes(canonicalJson(plan));
    const eventBytes=plan.events.reduce((sum,event)=>sum+bytes(event.payload),0),combined=Math.max(draftBytes,eventBytes);
    assert.ok(draftBytes+eventBytes>combined);
    Object.assign(f.intakePolicy.storage,{maximumDraftBytes:draftBytes,maximumEventBytes:eventBytes,maximumOriginalBytes:combined});
  }else f.intakePolicy.storage[cap]=1;
  await f.approveIntake();const before=substantive(f);await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));
  assert.deepEqual(substantive(f),before);assert.equal(count(f,ALLOCATION),0);assert.equal(count(f,'private_content'),0);assertNoGeneration(f);
});

test('an actual second original cannot exceed its explicit actor storage allocation cap',async t=>{
  const f=await fixture(t,{intakeApproved:false});Object.assign(f.intakePolicy.storage.actor,{maximumOperations:1,maximumOperationsPerWindow:1});
  await f.approveIntake();await prepare(f);const before=substantive(f),second=await nativeRequest();
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(second),f.env));assert.deepEqual(substantive(f),before);
  assert.equal(count(f,ALLOCATION),1);assert.equal(count(f,'private_content'),1);assertNoGeneration(f);
});

test('an ignored native private_content insert reaches the real storage batch and rolls back all original allocation rows',async t=>{
  const f=await fixture(t),before=substantive(f);let attempted=false;
  f.sqlite.exec('CREATE TRIGGER refuse_audio_insert BEFORE INSERT ON private_content BEGIN SELECT RAISE(IGNORE); END');
  const observer=observeDatabase(f,{before(entry){if(entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO private_content\b/u.test(part.sql)))attempted=true;}});
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));assert.deepEqual(substantive(f),before);
  assert.equal(attempted,true);assert.equal(count(f,ALLOCATION),0);assert.equal(count(f,SIDECAR),0);observer.restore();assertNoGeneration(f);
});

for(const table of [ALLOCATION,SIDECAR])test(`an extra ${table} trigger invalidates the exact storage-schema witness`,async t=>{
  const f=await fixture(t),before=substantive(f);let attempted=false;
  f.sqlite.exec(`CREATE TRIGGER unknown_audio_schema_trigger BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`);
  const observer=observeDatabase(f,{before(entry){if(entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO private_content\b/u.test(part.sql)))attempted=true;}});
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));assert.deepEqual(substantive(f),before);
  assert.equal(attempted,false,'Malformed resource schema refuses before native storage');observer.restore();
});

test('actor consent revoked by an actual insert trigger rolls back its own change and all staged storage',async t=>{
  const f=await fixture(t),before=substantive(f);let attempted=false;
  f.sqlite.exec(`CREATE TRIGGER revoke_audio_actor AFTER INSERT ON private_content WHEN NEW.kind='experience-draft'
    BEGIN UPDATE users SET consent_version=NULL WHERE user_id=NEW.owner_id; END`);
  const observer=observeDatabase(f,{before(entry){if(entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO private_content\b/u.test(part.sql)))attempted=true;}});
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));assert.equal(attempted,true);assert.deepEqual(substantive(f),before);
  assert.equal(count(f,ALLOCATION),0);assert.equal(count(f,SIDECAR),0);observer.restore();assertNoGeneration(f);
});

for(const table of [ALLOCATION,SIDECAR,IO])test(`${table} original identities and reserved bytes cannot be updated, deleted or replaced`,async t=>{
  const f=await fixture(t);await prepare(f);const before=snapshot(f),columns=f.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name);
  assert.throws(()=>f.sqlite.exec(`UPDATE ${table} SET campaign_id=campaign_id`));
  assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`));
  assert.throws(()=>f.sqlite.exec(`INSERT OR REPLACE INTO ${table}(${columns.join(',')}) SELECT ${columns.join(',')} FROM ${table}`));
  assert.deepEqual(snapshot(f),before);
});

test('ordinary native storage and atomic intake retain their direct no-Audio-token behavior',async t=>{
  const [{authorizeExperienceIntake},{preparePrivateContent},{commitAtomicIntake,projectIntakeAuthority},{retainedGuard}]=await Promise.all([
    import('../worker/experience-intake-api.ts'),import('../worker/private-content-storage.ts'),
    import('../worker/project-intake.ts'),import('../worker/experience-intake-read.ts'),
  ]);
  const f=await fixture(t),request=f.prepareRequest(),auth=await authorizeExperienceIntake(request,f.env);assert.ok(!(auth instanceof Response));
  const plan=await f.buildPlan(),content=canonicalJson(plan),guard=projectIntakeAuthority(f.env,auth,plan);
  const collected=await preparePrivateContent(f.env,f.actor,'experience-draft',content,undefined,undefined,guard,{contentId:plan.draftId});
  const acknowledged=await f.env.DB.batch(collected.statements);assert.equal(acknowledged[0].meta.changes,1);
  const intake={projectId:plan.projectId,documentId:plan.documentId,events:structuredClone(plan.events)},options={
    receiptPrefix:receiptPrefix(plan.draftId),clientId:'web:experience-intake',correlationPrefix:'experience-intake:',guard:retainedGuard(auth,plan,content)};
  const complete=await responseBody(await commitAtomicIntake(f.env,auth,intake,'commit',options));assert.equal(complete.status,'complete');
  const original=substantive(f),check=await responseBody(await commitAtomicIntake(f.env,auth,intake,'check',options));
  assert.deepEqual(check.appended,complete.appended);assert.deepEqual(substantive(f),original);assertOriginal(f,plan);
  assert.equal(count(f,IO),0);assert.equal(count(f,ALLOCATION),0);assertNoGeneration(f);
});

test('existing Image initial native prepare and commit preserve their own token family and no Audio reservation',async t=>{
  const [{fixture:imageFixture},{prepareSponsorImageDraft,commitSponsorImageDraft}]=await Promise.all([
    import('./sponsor-initial-intake-fixture.mjs'),import('../worker/experience-sponsor-intake.ts'),
  ]);
  const f=await imageFixture(t),first=await prepareSponsorImageDraft(f.prepareRequest(),f.env),complete=await commitSponsorImageDraft(f.commitRequest(first.plan),f.env);
  assert.equal(complete.status,'complete');assert.equal(first.plan.request.experienceId,'image');
  assert.equal(count(f,'experience_sponsor_intakes'),1);assert.equal(count(f,'document_jobs'),0);assert.equal(count(f,'output_provider_calls'),0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='experience_sponsor_audio_intake_attempts'").get().n,0);
});

for(const fault of ['missing','null','sparse','inherited-success','accessor-success','false-success'])test(`IO reserve ${fault} ACK fails closed after its real immutable debit`,async t=>{
  const f=await fixture(t);let fired=false,getters=0;
  const observer=observeDatabase(f,{transform(entry,result){
    if(fired||entry.kind!=='batch'||!entry.statements.some(part=>/INSERT INTO (?:main\.)?experience_sponsor_audio_intake_attempts\b/u.test(part.sql)))return result;
    fired=true;const copy=structuredClone(result);
    if(fault==='missing')return undefined;
    if(fault==='null')return null;
    if(fault==='sparse'){delete copy[0];return copy;}
    if(fault==='inherited-success'){delete copy[0].success;Object.setPrototypeOf(copy[0],{success:true});return copy;}
    if(fault==='accessor-success'){Object.defineProperty(copy[0],'success',{enumerable:true,get(){getters++;return true;}});return copy;}
    copy[0].success=false;return copy;
  }});
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));assert.equal(fired,true);assert.equal(getters,0);
  assert.equal(count(f,IO),1,'Real committed request debit is retained after malformed acknowledgment');
  assert.equal(count(f,ALLOCATION),0);assert.equal(count(f,SIDECAR),0);assert.equal(count(f,'private_content'),0);observer.restore();assertNoGeneration(f);
});

test('already aborted native request never starts private IO or custody writes',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort();const before=snapshot(f);
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(f.nativeRequest,f.campaignId,{signal:controller.signal}),f.env));
  assert.deepEqual(snapshot(f),before);
});

test('cancellation of a nonsettling database await rejects promptly without reaching storage',async t=>{
  const f=await fixture(t),controller=new AbortController();let entered;
  const waiting=new Promise(resolve=>{entered=resolve;});let first=true;
  const observer=observeDatabase(f,{before(){if(first){first=false;entered();return new Promise(()=>{});}}});
  const request=f.prepareRequest(f.nativeRequest,f.campaignId,{signal:controller.signal});
  const rejected=denied(()=>prepareSponsorAudioDraft(request,f.env));await waiting;controller.abort();
  await Promise.race([rejected,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Cancellation did not end pending native read')),1000);timer.unref();})]);
  assert.equal(count(f,IO),0);assert.equal(count(f,ALLOCATION),0);observer.restore();assertNoGeneration(f);
});

test('current registered maximum multibyte Audio inputs retain their exact canonical bytes',async t=>{
  const f=await fixture(t);f.nativeRequest=await nativeRequest({direction:'ࠀ'.repeat(600),detail:'ࠀ'.repeat(300)});
  const {validateIntakeRequest}=await import('../src/experiences/intake.ts');assert.ok(await validateIntakeRequest(f.nativeRequest));
  const first=await prepare(f);assert.equal(first.plan.events.length,6);assert.equal(first.plan.request.values.direction.value.length,600);
  assert.equal(first.plan.request.values.detail.value.length,300);const canonicalBytes=bytes(canonicalJson(first.plan));assert.ok(canonicalBytes<=65_536);
  await assertAllocation(f,first.plan,first.expiresAt);assertNoGeneration(f);
  t.diagnostic(JSON.stringify({registry:'unchanged actual Audio direction600/detail300',canonicalDraftBytes:canonicalBytes,eventBytes:rows(f,ALLOCATION)[0].event_bytes}));
});

test('explicit synthetic enlarged Audio registration reaches the independent 65536-byte draft gate before cleanup',async t=>{
  try{
    registrationFixture.setDirectionMaximum(8192);
    const f=await fixture(t);f.nativeRequest=await nativeRequest({direction:'ࠀ'.repeat(8192)});
    const {validateIntakeRequest}=await import('../src/experiences/intake.ts');assert.ok(await validateIntakeRequest(f.nativeRequest));
    const rawBytes=bytes(canonicalJson(await f.buildPlan()));assert.ok(rawBytes>65_536);assert.ok(bytes(await f.prepareRequest().text())<131_072);
    const observed=observeDatabase(f),before=substantive(f),error=await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));
    assert.equal(error.message,'sponsor_audio_intake_storage_limit');assert.deepEqual(substantive(f),before);assert.equal(count(f,IO),1);
    assert.equal(observed.sql().some(sql=>/INSERT INTO private_content\b/u.test(sql)),false);
    assert.equal(observed.sql().some(sql=>sql.includes('memory_structured_answer_origins')),false,'Refuses before native private-content cleanup');
    assert.equal(count(f,ALLOCATION),0);assert.equal(count(f,'private_content'),0);observed.restore();assertNoGeneration(f);
    t.diagnostic(JSON.stringify({registry:'EXPLICIT TEST-ONLY cloned Audio direction max8192; actual compiler, builder and payer approvals',ordinaryCanonicalDraftBytes:rawBytes,gate:65536}));
  }finally{registrationFixture.setDirectionMaximum(600);}
});

for(const family of ['Image','Story'])test(`final native receipt proof refuses a late ${family} source-family collision`,async t=>{
  const f=await fixture(t),first=await prepare(f);await commit(f,first.plan);
  const {SPONSOR_INTAKE_SCHEMA}=await import('../worker/experience-sponsor-intake.ts');
  const {SPONSOR_STORY_INTAKE_STORAGE_SCHEMA}=await import('../worker/experience-sponsor-story-intake-resources.ts');
  const schema=family==='Image'?SPONSOR_INTAKE_SCHEMA:SPONSOR_STORY_INTAKE_STORAGE_SCHEMA;
  for(const sql of schema)f.sqlite.exec(sql);
  const table=family==='Image'?'experience_sponsor_intakes':'experience_sponsor_story_intakes';let injected=false;
  const observed=observeDatabase(f,{before(entry){
    if(injected||entry.kind!=='batch'||!entry.statements.some(part=>part.sql.includes('receipt_total')&&part.sql.includes('event_private_payloads'))
      ||!entry.statements.some(part=>part.sql.includes(IO)))return;
    // Explicit synthetic corruption, not a successful foreign authority: seed a
    // colliding row in the exact real foreign schema at the final SQL boundary.
    const source=rows(f,SIDECAR)[0],columns=f.sqlite.prepare(`PRAGMA table_info(${table})`).all();
    const values=columns.map(column=>column.name==='event_count'?9:column.name==='resource_id'?'synthetic-colliding-resource':
      column.name==='policy_digest'?source.sponsor_policy_digest:column.name==='limits_digest'?source.intake_policy_digest:
      column.name==='content_bytes'?source.draft_bytes:source[column.name]);
    assert.ok(values.every(value=>value!==undefined));
    f.sqlite.exec('PRAGMA foreign_keys=OFF');try{f.sqlite.prepare(`INSERT INTO ${table}(${columns.map(column=>column.name).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...values);}
    finally{f.sqlite.exec('PRAGMA foreign_keys=ON');}
    injected=true;
  }});
  const before=count(f,IO),outcome=await readSponsorAudioIntake(f.readRequest(),f.env,{operation:'audio-intake-receipt',draftId:first.plan.draftId}).then(response=>({response}),error=>({error}));
  assert.equal(injected,true,'The mutation must reach the actual final proof batch');
  await denied(()=>{if(outcome.error)throw outcome.error;return outcome.response;});assert.equal(count(f,IO),before+1);
  assert.equal(count(f,ALLOCATION),1);assertOriginal(f,first.plan);observed.restore();assertNoGeneration(f);
});

test('zero-change IO debit with a foreign nonempty receipt fails without a diagnostic retry',async t=>{
  const f=await fixture(t);let injected=false,at=-1;
  const observed=observeDatabase(f,{transform(entry,result){
    const debit=entry.statements.findIndex(part=>/INSERT INTO (?:main\.)?experience_sponsor_audio_intake_attempts\b/u.test(part.sql));
    if(injected||entry.kind!=='batch'||debit<0)return result;
    const changed=structuredClone(result);assert.equal(changed[debit].meta.changes,1);assert.equal(changed.at(-1).results.length,1);
    changed[debit].meta.changes=0;changed.at(-1).results[0].attempt_id='synthetic-foreign-receipt';injected=true;at=observed.records.length;return changed;
  }});
  await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));assert.equal(injected,true);assert.equal(observed.records.length,at);
  assert.equal(count(f,IO),1);assert.equal(count(f,ALLOCATION),0);observed.restore();assertNoGeneration(f);
});

for(const oversized of [false,true])test(`known capacity diagnostic charges its full actual ACK${oversized?' including oversized metadata':''}`,async t=>{
  const f=await fixture(t,{intakeApproved:false});f.intakePolicy.io.actor.maximumRequestsPerWindow=1;f.intakePolicy.io.campaign.maximumRequestsPerWindow=1;
  await f.approveIntake();await prepare(f);const before=substantive(f);let diagnostic=false;
  const observed=observeDatabase(f,{transform(entry,result){
    if(entry.kind==='all'&&entry.statements[0].sql.includes('AS campaign_requests')){
      diagnostic=true;if(oversized)return {...result,fixturePadding:'x'.repeat(2_000_001)};
    }return result;
  }});
  const error=await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(),f.env));assert.equal(diagnostic,true);
  if(oversized)assert.equal(error.message,'sponsor_audio_intake_data_limit');else assert.ok(error.retryAfterMs>0);
  assert.deepEqual(substantive(f),before);assert.equal(count(f,IO),1);assert.equal(count(f,ALLOCATION),1);observed.restore();assertNoGeneration(f);
});

for(const control of [
  {file:'experience-sponsor-story-intake-native.test.mjs',name:'native initial Story 9-event prepare, commit and original reopen allocate once'},
  {file:'experience-guest-plan-custody.test.mjs',name:'first retention copies exact original plan bytes into a distinct canonical private key and immutable mapping'},
])test(`affected shared hook control: ${control.name}`,{timeout:60_000},async t=>{
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const childEnvironment={...process.env};delete childEnvironment.NODE_TEST_CONTEXT;
  const result=await promisify(execFile)(process.execPath,['--experimental-strip-types','--test',`--test-name-pattern=^${control.name}$`,`tests/${control.file}`],
    {cwd:process.cwd(),env:childEnvironment,timeout:55_000,maxBuffer:2_000_000});
  assert.match(result.stdout,/pass 1\b/u);assert.match(result.stdout,/fail 0\b/u);t.diagnostic(result.stdout.trim());
});

test('returned actual Response refuses monotonic deadline expiry before first pull',async t=>{
  const f=await fixture(t),response=await prepareSponsorAudioDraft(f.prepareRequest(),f.env),before=snapshot(f);
  assert.equal(response.bodyUsed,false);const later=performance.now()+60_000;
  t.mock.method(performance,'now',()=>later);
  await assert.rejects(response.text(),/deadline|unavailable/u);assert.deepEqual(snapshot(f),before);
  assert.equal(count(f,IO),1);assert.equal(count(f,ALLOCATION),1);assertNoGeneration(f);
});

test('genuine Audio native receipt rejects copied, mixed and retired tokens before DB IO',async t=>{
  const [{identifySponsorAudioIntake,createSponsorAudioIntakeBudget,requireSponsorAudioIntakeBudget,
    readSponsorAudioIntakeWriteAuthority},{reserveSponsorAudioIntakeAttempt},
    {readStoredSponsorAudioIntake,prepareSponsorAudioIntakeStorage},
    {composeSponsorAudioIntakeGuards,readSponsorAudioIntakeNativeDraft,
      sealSponsorAudioIntakeNativeReceipt,continueSponsorAudioIntakeNativeReceipt},
    {commitAtomicIntake,projectIntakeAuthority},{retainedGuard}]=await Promise.all([
    import('../worker/experience-sponsor-audio-intake-reads.ts'),
    import('../worker/experience-sponsor-audio-intake-attempts.ts'),
    import('../worker/experience-sponsor-audio-intake-resources.ts'),
    import('../worker/experience-sponsor-audio-intake-native.ts'),
    import('../worker/project-intake.ts'),import('../worker/experience-intake-read.ts'),
  ]);
  const f=await fixture(t),first=await prepare(f),observed=observeDatabase(f);
  const request=f.commitRequest(first.plan),proof=p=>({sql:p.sql,bindings:[...(p.bindings??[])]});
  const join=composeSponsorAudioIntakeGuards;
  const authority=await identifySponsorAudioIntake(request,f.env,{operation:'audio-intake-commit'});
  const attempt=await reserveSponsorAudioIntakeAttempt(authority,request,f.env,'audio-intake-commit');
  const cap=await createSponsorAudioIntakeBudget(authority,attempt,request,f.env);
  const state=requireSponsorAudioIntakeBudget(cap,request,f.env),auth=state.auth;
  const metadata=await state.wait(()=>readStoredSponsorAudioIntake(request,f.env,
    {draftId:state.draftId,actorUserId:auth.user.userId},
    {current:state.current,monotonicDeadline:state.monotonicDeadline,signal:request.signal}));
  state.accountBytes(metadata.controlBytes);assert.ok(metadata.receipt);
  const saved=await state.wait(()=>readSponsorAudioIntakeNativeDraft(cap,request,f.env,auth,state.draftId,
    join(...metadata.assertions.map(proof))));
  assert.equal(saved.plan.draftHash,first.plan.draftHash);
  const plan=saved.plan,intake={projectId:plan.projectId,documentId:plan.documentId,events:structuredClone(plan.events)};
  const originalProof=join(projectIntakeAuthority(f.env,auth,plan),retainedGuard(auth,plan,saved.content),
    ...metadata.assertions.map(proof));
  const sealed=sealSponsorAudioIntakeNativeReceipt(cap,request,f.env,auth,intake,
    {receiptPrefix:receiptPrefix(plan.draftId),clientId:'web:experience-intake',correlationPrefix:'experience-intake:',guard:originalProof});
  assert.ok(Object.isFrozen(sealed));assert.ok(Object.isFrozen(sealed.sponsorAudioIntakeRead));
  const before=substantive(f),beforeIo=count(f,IO);
  async function refusedBeforeIo(label,invoke){
    const at=observed.records.length;
    await assert.rejects(invoke,/sponsor_audio_intake_(?:native|budget)_unavailable/u,label);
    assert.equal(observed.records.length,at,`${label}: no native query or fallback`);
    assert.deepEqual(substantive(f),before,label);assert.equal(count(f,IO),beforeIo,label);
  }
  for(const [label,options] of [
    ['copied options',{...sealed}],
    ['copied opaque token',{...sealed,sponsorAudioIntakeRead:structuredClone(sealed.sponsorAudioIntakeRead)}],
    ['mixed Image family marker',{...sealed,sponsorIntakeRead:Object.freeze({})}],
    ['mixed Story family marker',{...sealed,sponsorStoryIntakeRead:Object.freeze({})}],
    ['caller-supplied head',{...sealed,expectedHead:0}],
  ])await refusedBeforeIo(label,()=>commitAtomicIntake(f.env,auth,intake,'check',options));
  await refusedBeforeIo('copied intake',()=>commitAtomicIntake(f.env,auth,structuredClone(intake),'check',sealed));
  await refusedBeforeIo('copied authorization',()=>commitAtomicIntake(f.env,{...auth},intake,'check',sealed));
  await refusedBeforeIo('copied environment',()=>commitAtomicIntake({...f.env},auth,intake,'check',sealed));

  // Consume the actual native check through its core. Account its internal
  // response exactly as the composition owner does; no exported response is
  // finalized by this focused native capability test.
  async function native(action,options){
    const response=await state.wait(()=>commitAtomicIntake(f.env,auth,intake,action,options));
    const text=await state.wait(()=>response.text());state.accountSerialized(text);
    return {status:response.status,body:JSON.parse(text)};
  }
  const checked=await native('check',sealed);assert.equal(checked.status,409);
  assert.equal(checked.body.error,'project_intake_unconfirmed');assert.equal(count(f,'events'),0);
  const approved=await readSponsorAudioIntakeWriteAuthority(cap,request,f.env);
  assert.equal(approved.policyDigest,metadata.receipt.sponsorPolicyDigest);
  assert.equal(approved.sessionDigest,metadata.receipt.sessionDigest);
  const {recordedAtMs:discarded,...originalAllocation}=metadata.receipt;assert.ok(Number.isFinite(discarded));
  const allocation=await state.wait(()=>prepareSponsorAudioIntakeStorage({policy:state.policyfacts.policy,...originalAllocation}));
  const continued=continueSponsorAudioIntakeNativeReceipt(cap,request,f.env,auth,intake,sealed,
    join(originalProof,proof(allocation.writeAssertion),...approved.assertions.map(proof)));
  assert.notEqual(continued.sponsorAudioIntakeRead,sealed.sponsorAudioIntakeRead);
  await refusedBeforeIo('exact retired original token',()=>commitAtomicIntake(f.env,auth,intake,'check',sealed));
  const at=observed.records.length;
  assert.throws(()=>continueSponsorAudioIntakeNativeReceipt(cap,request,f.env,auth,intake,sealed,originalProof),
    /sponsor_audio_intake_native_unavailable/u);
  assert.equal(observed.records.length,at,'Retired token cannot create another continuation');
  const completed=await native('commit',continued);assert.equal(completed.status,200);
  assert.equal(completed.body.status,'complete');assert.equal(completed.body.appended.length,5);
  assertOriginal(f,plan);assert.equal(count(f,ALLOCATION),1);assert.equal(count(f,IO),2);
  assertNoHeadFallback(observed);observed.restore();assertNoGeneration(f);f.limits?.assertVerified();
});

for(const shadowSignal of [false,true])test(`returned actual Response refuses original abort before first pull${shadowSignal?' even when Request.signal is shadowed':''}`,async t=>{
  const f=await fixture(t),controller=new AbortController(),request=f.prepareRequest(f.nativeRequest,f.campaignId,{signal:controller.signal});
  const response=await prepareSponsorAudioDraft(request,f.env),before=snapshot(f);
  assert.equal(response.status,200);assert.equal(response.bodyUsed,false);
  if(shadowSignal)Object.defineProperty(request,'signal',{value:new AbortController().signal,configurable:true});
  controller.abort();
  await assert.rejects(response.text(),/abort|unavailable|authority_changed/u);
  assert.deepEqual(snapshot(f),before);assert.equal(count(f,IO),1);assert.equal(count(f,ALLOCATION),1);assertNoGeneration(f);
});

test('returned actual Response refuses original abort with an own aborted property on the same native signal',async t=>{
  const f=await fixture(t),controller=new AbortController(),request=f.prepareRequest(f.nativeRequest,f.campaignId,{signal:controller.signal});
  const actualSignal=request.signal,response=await prepareSponsorAudioDraft(request,f.env),before=snapshot(f);
  assert.equal(response.bodyUsed,false);Object.defineProperty(actualSignal,'aborted',{value:false,configurable:true});controller.abort();
  assert.equal(request.signal,actualSignal);assert.equal(actualSignal.aborted,false);
  await assert.rejects(response.text(),/abort|unavailable|authority_changed/u);
  assert.deepEqual(snapshot(f),before);assert.equal(count(f,IO),1);assert.equal(count(f,ALLOCATION),1);assertNoGeneration(f);
});

for(const fault of ['own-error','missing-results','nonarray-results'])test(`actual storage ${fault} contradictory ACK recovers the retained original`,async t=>{
  const f=await fixture(t);let writes=0,applied=false;
  const observed=observeDatabase(f,{transform(entry,result){
    if(!storageBatch(entry))return result;writes++;const changed=structuredClone(result);applied=true;
    if(fault==='own-error')changed[0].error='ambiguous';
    if(fault==='missing-results')delete changed[0].results;
    if(fault==='nonarray-results')changed[0].results={};
    return changed;
  }});
  const result=await prepare(f);assert.equal(applied,true);assert.equal(writes,1);assert.equal(result.status,'prepared');
  assert.equal(result.replayed,true,'A contradictory native ACK must use measured original recovery');
  assert.equal(count(f,IO),1);await assertAllocation(f,result.plan,result.expiresAt);assert.equal(count(f,'events'),0);
  observed.restore();assertNoGeneration(f);
});

test('actual local workerd D1 initial Audio payer approval, native custody, original replay and late rollback',
  {skip:process.env.FORMA_AUDIO_INITIAL_D1!=='1',timeout:120_000},async t=>{
  const [{createRequire},{createHash},{readFile,writeFile,rename},{exportSynthetic,install,rowsSnapshot},
    {enforceD1ExpressionDepth},{inheritRuntimeSchemaReadiness}]=await Promise.all([
    import('node:module'),import('node:crypto'),import('node:fs/promises'),import('./helpers/model3d-workerd-snapshot.mjs'),
    import('./helpers/d1-expression-depth.mjs'),import('../worker/runtime.ts'),
  ]);
  const evidencePath='/private/tmp/forma-audio-initial-native-d1-evidence.json';
  try{await rename(evidencePath,`${evidencePath}.${Date.now()}.previous`);}catch(error){if(error.code!=='ENOENT')throw error;}
  const {Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
  const sourcePaths=[...['policy','approval','resources','classification','attempts','reads','native'].map(name=>`worker/experience-sponsor-audio-intake-${name}.ts`),
    'worker/experience-sponsor-audio-intake.ts','worker/intake-authority.ts','worker/project-intake-read.ts','worker/project-intake.ts',
    'worker/private-content-storage.ts','worker/experience-sponsor-intake-classification.ts','worker/experience-sponsor-approval.ts',
    'worker/experience-sponsor-policy.ts','tests/sponsor-audio-server-native-fixture.mjs','worker/event-append.ts','worker/memory-native-boundary.ts','worker/memory-native-origin-schema.ts',
    'worker/memory-document-job-origin-schema.ts','src/experiences/intake.ts','tests/experience-sponsor-audio-intake-native-fixture.mjs',
    'tests/experience-sponsor-audio-intake-native.test.mjs','tests/helpers/model3d-workerd-snapshot.mjs','tests/helpers/d1-expression-depth.mjs'];
  const hashes=async()=>Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
  const beforeHashes=await hashes(),f=await fixture(t,{approved:false,intakeApproved:false,strict:false});
  const family=name=>name===SIDECAR||name.startsWith('experience_sponsor_audio_intake_');
  const schema=structuredClone(f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
  const initialSchema=schema.filter(row=>family(row.name)||family(row.tbl_name));
  const initialTables=initialSchema.filter(row=>row.type==='table').map(row=>row.name);
  for(const table of initialTables)assert.equal(count(f,table),0);
  // Reuse the accepted rowid exporter for original native schema. The new
  // WITHOUT ROWID family is empty here and its exact DDL is installed separately.
  const donor={prepare(sql){
    if(sql==='SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')return{all:()=>schema.filter(row=>!initialSchema.includes(row))};
    return f.sqlite.prepare(sql);
  }};
  const exported=exportSynthetic(donor),donorDatabase=f.env.DB;let external=0,media=0;
  t.mock.method(globalThis,'fetch',(input,options)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return oldFetch(input,{...options,redirect:'error'});
    external++;throw Error('Initial Audio actual D1 forbids external egress');
  });
  for(const operation of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,operation,()=>{media++;throw Error('No media IO in initial Audio intake');});
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-22',host:'127.0.0.1',port:0,
    log:new Log(LogLevel.NONE),d1Databases:['DB'],script:'export default {fetch(){return new Response("Direct synthetic initial Audio D1 only")}}',
    outboundService(){external++;throw Error('Initial Audio actual D1 forbids external egress');}});
  let observed,limits;
  const all=async(db,sql,...bindings)=>(await db.prepare(sql).bind(...bindings).all()).results;
  const d1count=async(db,table)=>Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n);
  async function initialRows(db,includeAttempts=false){
    const result={};
    for(const table of initialTables.filter(name=>includeAttempts||name!==IO)){
      const columns=await all(db,`PRAGMA table_info("${table}")`),primary=columns.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk);
      assert.ok(primary.length);
      result[table]=await all(db,`SELECT ${columns.map((column,index)=>`quote("${column.name}") AS c${index}`).join(',')} FROM "${table}" ORDER BY ${primary.map(column=>`"${column.name}"`).join(',')}`);
    }
    return result;
  }
  try{
    const db=await mf.getD1Database('DB');await install(db,exported);
    await db.batch(initialSchema.filter(row=>row.type==='table').map(row=>db.prepare(row.sql)));
    await db.batch(initialSchema.filter(row=>row.type!=='table'&&row.sql).map(row=>db.prepare(row.sql)));
    const names=new Set(initialSchema.map(row=>row.name));
    assert.deepEqual((await all(db,'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')).filter(row=>names.has(row.name)),initialSchema);
    assert.deepEqual(await all(db,'PRAGMA foreign_key_check'),[]);
    f.env.DB=db;f.DB=db;observed=observeDatabase(f);inheritRuntimeSchemaReadiness(donorDatabase,observed.database);
    limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
    await f.approveCampaign();assert.equal(await d1count(db,'experience_sponsor_approvals'),1);
    assert.equal(JSON.parse((await db.prepare('SELECT payer_authority_json FROM experience_sponsor_approvals').first()).payer_authority_json).length,13);
    await f.approveIntake();assert.equal(await d1count(db,'experience_sponsor_audio_intake_approvals'),1);
    assert.equal(await d1count(db,IO),0);assert.equal(await d1count(db,'private_content'),0);assert.equal(await d1count(db,'events'),0);

    const first=await prepare(f),plan=first.plan;assert.equal(plan.events.length,5);assert.equal(first.replayed,false);
    const allocation=(await all(db,`SELECT * FROM ${ALLOCATION}`))[0],sidecar=(await all(db,`SELECT * FROM ${SIDECAR}`))[0];
    assert.deepEqual(allocation,sidecar);assert.equal(await d1count(db,ALLOCATION),1);
    assert.equal(allocation.draft_bytes,bytes(canonicalJson(plan)));assert.equal(allocation.event_bytes,plan.events.reduce((sum,event)=>sum+bytes(event.payload),0));
    assert.equal(allocation.total_bytes,allocation.draft_bytes+allocation.event_bytes);assert.equal(allocation.expires_at,first.expiresAt);
    const repeated=await prepare(f);assert.equal(repeated.replayed,true);assert.deepEqual(repeated.plan,plan);
    const completed=await commit(f,plan);assert.equal(completed.status,'complete');assert.equal(completed.appended.length,5);
    const privateEvents=await all(db,`SELECT event.type,secret.private_json FROM events event JOIN event_private_payloads secret
      ON secret.private_event_id=event.event_id WHERE event.stream_id=? ORDER BY event.sequence`,f.stream);
    assert.deepEqual(privateEvents,plan.events.map(event=>({type:event.type,private_json:JSON.stringify(event.payload)})));
    const replay=await commit(f,plan);assert.equal(replay.replayed,true);assert.deepEqual(replay.appended,completed.appended);
    const reopened=await reopen(f,plan,'audio-intake-receipt');assert.deepEqual(reopened.appended,completed.appended);
    assert.equal(await d1count(db,ALLOCATION),1);assert.equal(await d1count(db,IO),5);

    // A real trigger revokes the actor only after the attempted native insert.
    // The late native proof must roll back both that revocation and every staged
    // draft/allocation/sidecar; its already admitted IO debit remains charged.
    const lateTrigger=`CREATE TRIGGER audio_d1_revoke_after_insert AFTER INSERT ON private_content WHEN NEW.kind='experience-draft'
      BEGIN UPDATE users SET consent_version=NULL WHERE user_id=NEW.owner_id; END`;
    await db.prepare(lateTrigger).run();f.sqlite.exec(lateTrigger);
    const beforeNative=await rowsSnapshot(db,exported.tables),beforeInitial=await initialRows(db),beforeTrace=observed.records.length;
    const secondRequest=await nativeRequest();
    await denied(()=>prepareSponsorAudioDraft(f.prepareRequest(secondRequest),f.env));
    const failedBatch=observed.records.slice(beforeTrace).find(entry=>entry.kind==='batch'&&entry.statements.some(part=>/INSERT INTO private_content\b/u.test(part.sql)));
    assert.ok(failedBatch,'The second intent reached the actual native storage transaction');
    assert.match(failedBatch.error,/CHECK constraint failed:\s*passed\s*=\s*1/u,'The late authority proof, not an unrelated engine error, refused the transaction');
    assert.deepEqual(await rowsSnapshot(db,exported.tables),beforeNative);assert.deepEqual(await initialRows(db),beforeInitial);
    assert.equal(await d1count(db,IO),6);assert.equal(await d1count(db,ALLOCATION),1);
    for(const table of ['output_preflights','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations',
      'output_provider_calls','experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_consumptions'])
      if(exported.tables.includes(table))assert.equal(await d1count(db,table),0,table);
    assert.equal(external,0);assert.equal(media,0);limits.assertVerified();
    const afterHashes=await hashes();assert.deepEqual(afterHashes,beforeHashes);
    const statements=observed.records.flatMap(entry=>entry.statements);
    const evidence={success:true,engine:'Pinned local Miniflare/workerd D1',applicationExecution:'Node-hosted production functions against actual D1; not bundled Worker or application HTTP handler',
      startingBoundary:'Native accounts and empty native/V8 schema from disposable SQLite; no approval, Context, initial policy, allocation or IO row. Exact empty Audio WITHOUT ROWID family installed separately on D1.',
      registryFixture:'Pinned intake registration lookup loaded with the authorized fixture hook, left at unchanged revision1 for this entire D1 group; no simulated transition in this group.',
      actualD1Stages:['real original V8 payer approval with13-column snapshot','real additional payer prepare/approval','actual native private collector','one logical storage allocation','native atomic five-event intake','original prepare and commit replay','original receipt reopen','late insert-trigger authority rollback'],
      statements:statements.length,strictSqlShapes:limits.records.length,maxBindings:Math.max(...statements.map(part=>part.bindings.length)),
      maxSqlBytes:Math.max(...statements.map(part=>Buffer.byteLength(part.sql))),actualReturnedDatabaseBytes:observed.returnedBytes(),
      expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000,events:5,storageAllocations:1,ioAttempts:6,externalRequests:external,mediaCalls:media,
      providerCalls:0,financialHolds:0,lateRevocationRolledBack:true,sourceHashes:afterHashes};
    await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');t.diagnostic(JSON.stringify(evidence));
  }catch(error){const failurePath=`/private/tmp/forma-audio-initial-native-d1-failed-trace-${Date.now()}.json`;
    await writeFile(failurePath,JSON.stringify({error:String(error),beforeHashes,records:observed?.records??[]},null,2)+'\n');t.diagnostic(`Preserved failure trace: ${failurePath}`);throw error;}
  finally{limits?.restore();observed?.restore();await mf.dispose();}
});

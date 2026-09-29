import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture,freshRun,transport,rows,finances,outputDocumentExecutionBridge,createOutputEventExecution,loadOutputJobBinding} from './sponsor-audio-v8-native-fixture.mjs';
const [{resolveOutputExecutionAuthority},{preflightOutputAudioTarget},{createAudioSponsorDispatchOwner,prepareAudioSponsorDispatchEvidence,requireAudioSponsorDispatchEvidence,invalidateAudioSponsorDispatch}]=await Promise.all([
  import('../worker/output-requirements-api.ts'),import('../worker/output-audio-preflight.ts'),import('../worker/output-audio-sponsored-handoff.ts'),
]);

const originalFetch=globalThis.fetch;let unexpected=0;
globalThis.fetch=()=>{unexpected++;throw Error('No untrapped Audio qualification egress');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpected,0);});
const leaseProof=statements=>statements.some(statement=>statement.sql.includes("attempt_count=1 AND status IN('running','committing') AND request_json=?"));
function strictReport(t,f){f.limits.assertVerified();t.diagnostic(JSON.stringify({shapes:f.limits.records.length,maxBindings:Math.max(...f.limits.boundCounts),maxSqlBytes:Math.max(...f.limits.records.map(item=>Buffer.byteLength(item.sql))),expressionDepth:100,functionArguments:32,parameters:100,exceptions:0}));}

for(const fault of ['sparse ACK','accessor ACK','error ACK','own error accessor ACK','inherited error ACK','aborted Run','provider configuration','original expiry'])test(`actual Audio native dispatch rejects ${fault} after owned lease proof and before any provider request`,async t=>{
  const calls=transport(t),f=await fixture(t,{strict:true});await f.execute();const run=await freshRun(f);await run.queue();
  const batch=f.env.DB.batch,key=f.env.FAL_KEY,now=Date.now;let intercepted=0,getters=0;
  f.env.DB.batch=async function(statements){const results=await batch.call(this,statements);
    if(!intercepted&&leaseProof(statements)){intercepted++;
      if(fault==='sparse ACK')delete results[0];
      if(fault==='accessor ACK')Object.defineProperty(results[0],'success',{get(){getters++;return true;},enumerable:true});
      if(fault==='error ACK')results[0]={...results[0],error:'Synthetic ambiguous acknowledgement'};
      if(fault==='own error accessor ACK')Object.defineProperty(results[0],'error',{get(){getters++;return undefined;},enumerable:true});
      if(fault==='inherited error ACK')Object.setPrototypeOf(results[0],{error:'Synthetic inherited error'});
      if(fault==='aborted Run')run.controller.abort();
      if(fault==='provider configuration')f.env.FAL_KEY='changed-synthetic-key';
      if(fault==='original expiry')Date.now=()=>f.envelope.originalExpiresAtMs+1;
    }return results;
  };
  let result;try{result=await run.drive();}finally{f.env.DB.batch=batch;f.env.FAL_KEY=key;Date.now=now;}
  assert.equal(intercepted,1,JSON.stringify({fault,status:result?.status,error:result?.error_message,trace:f.trace}));assert.equal(getters,0);assert.notEqual(result.status,'completed');assert.equal(calls.length,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);assert.equal(f.media.size,0);strictReport(t,f);
});

test('exact Audio Run replay abort after its final assertion batch cannot wake a retained job',async t=>{
  const calls=transport(t),f=await fixture(t,{strict:true});await f.execute();const first=await freshRun(f);await first.queue();
  const replay=await freshRun(f,{command:first.command}),before=rows(f),money=finances(f),batch=f.env.DB.batch,dispatch=outputDocumentExecutionBridge.dispatch;let intercepted=0,wakes=0;
  outputDocumentExecutionBridge.dispatch=async()=>{wakes++;throw Error('Replayed aborted Run must not wake');};
  f.env.DB.batch=async function(statements){const inReplay=new Error().stack.includes('resumeRecordedOutputRun')&&statements.some(statement=>statement.sql.includes('output_atomic_assertions'));
    const results=await batch.call(this,statements);if(inReplay){intercepted++;replay.controller.abort();}return results;};
  try{await assert.rejects(replay.queue(),/sponsor_|aborted/u);}finally{f.env.DB.batch=batch;outputDocumentExecutionBridge.dispatch=dispatch;}
  assert.equal(intercepted,1);assert.equal(wakes,0);assert.equal(calls.length,0);assert.deepEqual(finances(f),money);assert.deepEqual(rows(f),before);strictReport(t,f);
});

test('genuine Audio native proof owner invalidates older concurrent checks and rejects copied proof, control, and signal identities',async t=>{
  const f=await fixture(t,{strict:true});await f.execute();const run=await freshRun(f);await run.queue();let exercised=0;
  const calls=transport(t,{afterDispatch:async call=>{
    if(call.stage!=='planning:0:initial')return;exercised++;
    const job=f.sqlite.prepare('SELECT * FROM document_jobs').get(),binding=await loadOutputJobBinding(f.env,run.trusted.principal,job);assert.ok(binding);
    const authority=await resolveOutputExecutionAuthority(f.env,binding.scope,binding.slot);
    const native=await preflightOutputAudioTarget({request:run.request,env:f.env,scope:binding.scope,principal:run.trusted.principal,
      confirmedPlan:authority.confirmedPlan,target:authority.target,context:authority.context,ownerHead:authority.head,sourceEvents:authority.events,
      sourceAssertions:authority.assertions,sourceDigest:authority.sourceDigest,requirementsDigest:authority.requirementsDigest});assert.equal(native.available,true);
    const output=await createOutputEventExecution(f.env,run.trusted.principal,job,binding,undefined,run.authority);
    const controller=new AbortController(),control={output,signal:controller.signal,beginCommit:async()=>{},progress:async()=>{}};
    const owner=createAudioSponsorDispatchOwner({env:f.env,scope:binding.scope,slot:binding.slot,correlationId:job.correlation_id});
    const before=rows(f),batch=f.env.DB.batch;let release,arrived;
    const paused=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{arrived=resolve;});let held=0;
    f.env.DB.batch=async function(statements){const results=await batch.call(this,statements);if(leaseProof(statements)&&!held++){arrived();await paused;}return results;};
    const first=prepareAudioSponsorDispatchEvidence(owner,{nativePreflight:native,control,signal:control.signal});
    let second;try{await Promise.race([started,first.then(()=>{throw Error("First proof did not pause at its owned final batch");})]);second=await prepareAudioSponsorDispatchEvidence(owner,{nativePreflight:native,control,signal:control.signal});release();await assert.rejects(first,/sponsor_audio_handoff_changed/);}finally{release();f.env.DB.batch=batch;}
    assert.ok(requireAudioSponsorDispatchEvidence(second,control));
    for(const forgery of [{},structuredClone(second),{...second}])assert.throws(()=>requireAudioSponsorDispatchEvidence(forgery,control),/sponsor_audio_handoff_changed/);
    assert.throws(()=>requireAudioSponsorDispatchEvidence(second,{...control}),/sponsor_audio_handoff_changed/);
    const originalSignal=control.signal;control.signal=new AbortController().signal;assert.throws(()=>requireAudioSponsorDispatchEvidence(second,control),/sponsor_audio_handoff_changed/);control.signal=originalSignal;
    await assert.rejects(prepareAudioSponsorDispatchEvidence(owner,{nativePreflight:structuredClone(native),control,signal:control.signal}),/sponsor_audio_handoff_changed/);
    assert.throws(()=>requireAudioSponsorDispatchEvidence(second,control),/sponsor_audio_handoff_changed/);
    const final=await prepareAudioSponsorDispatchEvidence(owner,{nativePreflight:native,control,signal:control.signal});invalidateAudioSponsorDispatch(owner);
    assert.throws(()=>requireAudioSponsorDispatchEvidence(final,control),/sponsor_audio_handoff_changed/);assert.deepEqual(rows(f),before);
  }});
  const result=await run.drive();assert.equal(exercised,1);assert.equal(result.status,'completed',JSON.stringify({error:result.error_message,trace:f.trace}));assert.equal(calls.filter(call=>call.method==='POST').length,2);strictReport(t,f);
  t.diagnostic('Extra dispatch-owner checks use a real running native job/preflight and actual native output object; the synthetic local control never claims or submits a provider call.');
});

for(const phase of ['common admission','native Run evidence','common Run','common dispatch'])for(const errorShape of ['own error accessor','inherited error'])test(`Audio ${phase} rejects ${errorShape} in its actual final proof acknowledgement`,async t=>{
  const calls=transport(t),f=await fixture(t,{strict:true,sponsor:phase!=='common admission'});
  let operation;
  if(phase==='common admission')operation=()=>f.sponsor();
  else{await f.execute();if(phase==='common dispatch'){const run=await freshRun(f);await run.queue();operation=()=>run.drive();}else operation=()=>freshRun(f);}
  const before=rows(f),batch=f.env.DB.batch;let intercepted=0,getters=0;
  f.env.DB.batch=async function(statements){const stack=new Error().stack,results=await batch.call(this,statements);
    const target=phase==='common admission'?stack.includes('requireSponsorAdmission')&&statements.some(statement=>statement.sql.includes('experience_sponsor_campaigns campaign JOIN experience_sponsor_grants'))
      :phase==='native Run evidence'?stack.includes('readSponsorAudioRunEvidence')&&statements.some(statement=>statement.sql.includes('command_created_at')&&statement.sql.includes('authorization_json'))
      :phase==='common Run'?stack.includes('at current (')&&stack.includes('experience-sponsor-execution.ts')&&stack.includes('createSponsorExecutionAuthority')
      :stack.includes('refreshAudioDispatch')&&!stack.includes('prepareAudioSponsorDispatchEvidence')&&leaseProof(statements);
    if(target&&!intercepted){intercepted++;
      if(errorShape==='own error accessor')Object.defineProperty(results[0],'error',{get(){getters++;return undefined;},enumerable:true});
      else Object.setPrototypeOf(results[0],{error:'Synthetic inherited proof error'});
    }return results;
  };
  try{if(phase==='common dispatch'){const result=await operation();assert.notEqual(result.status,'completed');}
    else await assert.rejects(operation(),undefined,`${phase}: contradictory ${errorShape} must not mint authority`);
  }finally{f.env.DB.batch=batch;}
  assert.equal(intercepted,1);assert.equal(getters,0);assert.equal(calls.length,0);
  if(phase==='common admission'){for(const table of ['document_jobs','output_execution_grants','budget_reservations','cost_budget_reservations','experience_sponsor_consumptions'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);}
  else if(phase!=='common dispatch')assert.deepEqual(rows(f),before);
  strictReport(t,f);
});

test('Audio abort at the actual captured-request hash completion creates no pending provider call',async t=>{
  const calls=transport(t),f=await fixture(t,{strict:true});await f.execute();const run=await freshRun(f);await run.queue();
  const digest=crypto.subtle.digest.bind(crypto.subtle);let intercepted=0;
  t.mock.method(crypto.subtle,'digest',async(...args)=>{
    const stack=new Error().stack,target=stack.includes('captureOutputAudioAttempt')&&stack.includes('assertOutputAudioAttempt')&&stack.includes('beforeProviderAttempt');
    const result=await digest(...args);
    if(target&&!intercepted){intercepted++;run.controller.abort();}
    return result;
  });
  const result=await run.drive();
  const retained=f.sqlite.prepare('SELECT stage_key,status FROM output_provider_calls ORDER BY stage_key').all();
  t.diagnostic(JSON.stringify({intercepted,status:result.status,actualProviderRequests:calls.length,retainedProviderCalls:retained}));
  assert.equal(intercepted,1);assert.equal(calls.length,0);assert.notEqual(result.status,'completed');assert.equal(retained.length,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);assert.equal(f.media.size,0);strictReport(t,f);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {registerOutputSourceImports,outputTestDatabase} from './output-server-test-helpers.mjs';

// Actual intake/renewal/native confirmation/preflight/source readers and SQLite
// transactions. Local fixtures only; no source/auth/SQL port replacement.
const imports=registerOutputSourceImports();
let forbidden=0;
const previousFetch=globalThis.fetch;
globalThis.fetch=()=>{forbidden++;throw Error('No network in unpaid Audio renewal fixture');};
test.after(()=>{imports.deregister();globalThis.fetch=previousFetch;assert.equal(forbidden,0);});
const runtime=await import('../worker/runtime.ts');
const {handleExperienceIntake}=await import('../worker/experience-intake-api.ts');
const {handleExperienceOutput}=await import('../worker/experience-output-api.ts');
const {registeredExperience}=await import('../src/experiences/intake.ts');
const {preflightOutputAudioTarget}=await import('../worker/output-audio-preflight.ts');
const {decodeExperienceBinding}=await import('../src/experiences/output-binding-client.ts');
const execution={waitUntil(){forbidden++;throw Error('No background execution');}};
const owner='dev-local-creative',stream=`creative:${owner}`;
const financial=['output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls'];
async function fixture(t,configured=false){
  const s=outputTestDatabase();t.after(()=>s.sqlite.close());await runtime.ensureSchema(s.env);
  const forbiddenBridge=()=>{forbidden++;throw Error('Unpaid renewal cannot admit or execute');};
  const configure=()=>{
    s.env.OPENAI_API_KEY='fixture-no-network';s.env.FAL_KEY='fixture-no-network';
    s.bridge={preflight:preflightOutputAudioTarget,prepareAdmission:forbiddenBridge,dispatch:forbiddenBridge,resolveResult:forbiddenBridge,cleanupExpiredOrRevoked:forbiddenBridge};
  };
  if(configured){
    t.mock.timers.enable({apis:['Date'],now:Date.now()});t.after(()=>t.mock.timers.reset());
    const clock=outputTestDatabase();t.after(()=>clock.sqlite.close());
    for(const name of ['strftime','julianday','datetime'])s.sqlite.function(name,{varargs:true},(...args)=>
      clock.sqlite.prepare(`SELECT ${name}(${args.map(()=>'?').join(',')}) AS value`)
        .get(...args.map(value=>value==='now'?new Date().toISOString():value)).value);
    configure();
  }
  const now=new Date().toISOString();
  s.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(owner,'creative@local.forma','Local creative',now,now,now);
  const release=await registeredExperience('audio');
  const intent={experienceId:'audio',intentId:'00000000-0000-4000-8000-000000000093',releaseHash:release.releaseHash,
    values:{direction:{value:'Original gentle felt piano motif, a small development, and a clean resolved ending. No vocals or quotations.',provenance:'authored'},
      detail:{value:'20 seconds, instrumental only.',provenance:'authored'}}};
  const post=(path,body)=>new Request('http://localhost'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  let response=await handleExperienceIntake(post('/api/experiences/drafts',intent),s.env);
  assert.equal(response.status,200,await response.clone().text());s.plan=(await response.json()).plan;
  response=await handleExperienceIntake(post(`/api/experiences/drafts/${s.plan.draftId}/commit`,{draftHash:s.plan.draftHash}),s.env);
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');
  s.path=`/api/experiences/drafts/${s.plan.draftId}/output`;
  s.send=body=>handleExperienceOutput(body?post(s.path+'/prepare',body):new Request('http://localhost'+s.path),s.env,execution,s.bridge);
  if(configured){
    response=await s.send({draftHash:s.plan.draftHash,explicitRequirementsConfirmation:true});
    assert.equal(response.status,200,await response.clone().text());s.initial=await response.json();
    assert.equal(s.initial.permitted.authorize,true);assert.ok(s.initial.audioCostPreview);
    assert.ok(decodeExperienceBinding(s.initial,{...s.initial,actorUserId:owner}));
    t.mock.timers.setTime(Date.parse(s.initial.audioCostPreview.expiresAt)+1);
  }else{
    const RealDate=Date,old=Date.now()-1_200_000;
    globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[old]));}static now(){return old;}};
    try {response=await s.send({draftHash:s.plan.draftHash,explicitRequirementsConfirmation:true});assert.equal(response.status,200,await response.clone().text());}
    finally{globalThis.Date=RealDate;}
  }
  s.expired=await (await s.send()).json();assert.equal(s.expired.permitted.renewPreparation,true);
  s.body={draftHash:s.plan.draftHash,explicitRequirementsConfirmation:true,renewal:{predecessorPreflightId:s.expired.preflight.id,explicitRenewal:true}};
  configure();
  s.unpaid=()=>{for(const table of financial)assert.equal(s.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);assert.equal(s.media.size,0);};
  return s;
}

for(const configured of [false,true])test(`actual Audio HTTP renewal preserves original intake from ${configured?'configured':'unconfigured'} expired quote`,async t=>{
  const s=await fixture(t,configured),old=s.sqlite.prepare('SELECT * FROM output_commands ORDER BY command_key').all();
  const retained=s.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(s.plan.draftId);
  const before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  const response=await s.send(s.body);assert.equal(response.status,200,await response.clone().text());const renewed=await response.json();
  assert.equal(renewed.documentId,s.plan.documentId);assert.equal(renewed.draftId,s.plan.draftId);
  assert.notEqual(renewed.plan.revisionId,s.expired.plan.revisionId);assert.notEqual(renewed.preflight.id,s.expired.preflight.id);
  assert.equal(renewed.permitted.authorize,true);assert.equal(renewed.permitted.run,false);
  const offer=renewed.preflight.targets[0].settings;assert.ok(offer);
  assert.equal(offer.original.draftId,s.plan.draftId);assert.ok(Date.parse(offer.original.expiresAt)>Date.now());
  assert.ok(decodeExperienceBinding(renewed,{...renewed,actorUserId:owner}));
  assert.ok(decodeExperienceBinding(s.expired,{...s.expired,actorUserId:owner}));
  if(configured){
    assert.notEqual(renewed.audioCostPreview.requestId,s.initial.audioCostPreview.requestId);
    assert.equal(decodeExperienceBinding({...s.expired,audioRenewal:{...s.expired.audioRenewal,expiredAt:new Date(Date.parse(s.expired.audioRenewal.expiredAt)-1).toISOString()}},{...s.expired,actorUserId:owner}),null);
  }else{
    const unavailable={...s.expired,preflight:{...s.expired.preflight,expiresAt:new Date(Date.parse(s.expired.preflight.expiresAt)+500).toISOString()}};
    assert.ok(decodeExperienceBinding(unavailable,{...s.expired,actorUserId:owner}));
  }
  assert.deepEqual(s.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(s.plan.draftId),retained);
  for(const row of old)assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_commands WHERE command_key=?').get(row.command_key),row);
  const replay=await s.send(s.body);assert.equal(replay.status,200,await replay.clone().text());assert.equal((await replay.json()).preflight.id,renewed.preflight.id);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before+1);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,1);
  s.unpaid();
});

test('late Audio authorization evidence without head change blocks renewal atomically',async t=>{
  const s=await fixture(t),batch=s.DB.batch.bind(s.DB);let raced=false;
  const before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  s.DB.batch=async statements=>{
    if(!raced&&statements.some(q=>/^INSERT INTO output_commands\b/u.test(q.sql.trim()))){raced=true;
      s.sqlite.prepare("INSERT INTO output_commands SELECT scope_key,actor_user_id,'late-audio-authorize',request_digest,'authorize',event_id,created_at FROM output_commands WHERE action='confirm' LIMIT 1").run();}
    return batch(statements);
  };
  const response=await s.send(s.body);assert.equal(raced,true);assert.notEqual(response.status,200);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before);s.unpaid();
});

for(const table of ['budget_reservations','cost_budget_reservations'])test(`late ancestor Audio ${table} attempt blocks renewal atomically`,async t=>{
  const s=await fixture(t,true),batch=s.DB.batch.bind(s.DB),before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  let raced=false;
  const id=s.expired.audioCostPreview.requestId+':attempt:1',stamp=new Date().toISOString();
  s.DB.batch=async statements=>{
    if(!raced&&statements.some(q=>/^INSERT INTO output_commands\b/u.test(q.sql.trim()))){raced=true;
      if(table==='budget_reservations')s.sqlite.prepare("INSERT INTO budget_reservations(reservation_id,owner_id,stream_id,correlation_id,operation,period,reserved_tokens,status,created_at,updated_at) VALUES('late','other-payer','other-stream',?,'test','month',1,'settled',?,?)").run(id,stamp,stamp);
      else s.sqlite.prepare("INSERT INTO cost_budget_reservations(reservation_id,owner_id,correlation_id,operation,period,reserved_microusd,status,created_at,updated_at) VALUES('late','other-payer',?,'test','month',1,'settled',?,?)").run(id,stamp,stamp);
    }
    return batch(statements);
  };
  const response=await s.send(s.body);assert.equal(raced,true);assert.equal(response.status,409);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before);
  for(const other of financial)assert.equal(s.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${other}`).get().n,other===table?1:0);
  assert.equal(s.media.size,0);
});

test('interrupted child preflight resumes the same Audio confirmation without repeating Save',async t=>{
  const s=await fixture(t),preflight=s.bridge.preflight;let interrupted=false;
  const before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  s.bridge.preflight=async (...args)=>{if(!interrupted){interrupted=true;throw Error('Simulated interruption before preflight');}return preflight(...args);};
  const first=await s.send(s.body);assert.notEqual(first.status,200);assert.equal(interrupted,true);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before+1);
  const retry=await s.send(s.body);assert.equal(retry.status,200,await retry.clone().text());
  const ready=await retry.json();assert.equal(ready.permitted.authorize,true);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before+1);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE action='save'").get().n,1);s.unpaid();
});

test('concurrent Audio renewal attempts converge on one confirmation and preflight',async t=>{
  const s=await fixture(t),before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  const attempts=await Promise.all([s.send(s.body),s.send(s.body)]);
  assert.ok(attempts.some(response=>response.status===200));
  const replay=await s.send(s.body);assert.equal(replay.status,200,await replay.clone().text());
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before+1);
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM output_commands WHERE command_key LIKE 'audio-cycle-v1:%' AND action='preflight'").get().n,1);s.unpaid();
});

test('longer browser wait cannot authorize an expired fresh Audio quote',async t=>{
  const s=await fixture(t),prepared=await s.send(s.body);assert.equal(prepared.status,200,await prepared.clone().text());
  const fresh=await prepared.json(),RealDate=Date,future=Date.parse(fresh.preflight.expiresAt)+1;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[future]));}static now(){return future;}};
  try {
    const response=await handleExperienceOutput(new Request('http://localhost'+s.path+'/authorize',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({draftHash:s.plan.draftHash,termsDigest:fresh.preflight.termsDigest,maximumMicrousd:fresh.preflight.maximumMicrousd,explicitAuthorization:true,
        audioCostConsent:{...fresh.audioCostPreview,confirmed:true,providerTransferConfirmed:true}})}),s.env,execution,s.bridge);
    assert.equal(response.status,409);
    assert.equal((await response.json()).error,'experience_output_authorization_unavailable');s.unpaid();
  } finally {globalThis.Date=RealDate;}
});

test('actual Audio fold tolerates operational events; same-value source edit emits only fixed log category',async t=>{
  const s=await fixture(t);
  await runtime.appendEvents(s.env,[
    ['ContextCompiled',{document_id:s.plan.documentId,context_hash:'synthetic-context',snapshot:{facts:[]}}],
    ['DocumentRenderRequested',{document_id:s.plan.documentId,artifact_id:'synthetic-job-artifact',artifact_kind:'audio'}],
    ['DocumentRenderFailed',{document_id:s.plan.documentId,artifact_id:'synthetic-job-artifact',artifact_kind:'audio',reason:'provider_submission_uncertain'}],
  ].map(([type,payload])=>runtime.makeEvent(stream,0,'worker:renderer','test','original-run-regression',type,payload)));
  const unchanged=await s.send();assert.equal(unchanged.status,200,await unchanged.clone().text());
  const block=s.plan.events.find(event=>event.type==='BlockCreated');assert.ok(block);
  await runtime.appendEvents(s.env,[runtime.makeEvent(stream,0,'user','test','same-value-edit','BlockPropertyEdited',{
    document_id:s.plan.documentId,project_id:s.plan.projectId,block_id:block.payload.block_id,
    property_path:'text',old_value:block.payload.properties.text,new_value:block.payload.properties.text,
  })]);
  const warnings=[],warn=console.warn;console.warn=(...args)=>warnings.push(args);
  let response;try{response=await s.send();}finally{console.warn=warn;}
  assert.equal(response.status,409);
  const body=await response.json();assert.equal(body.error,'experience_output_source_changed');
  assert.deepEqual(warnings.filter(args=>args[0]==='experience_output_source_mismatch'),[
    ['experience_output_source_mismatch',{category:'provenance'}],
  ]);
  assert.equal(JSON.stringify(body).includes('provenance'),false,'Category is log-only, not a new public field');
  s.unpaid();
});

for(const mutation of ['retention','source-private-body'])test(`late ${mutation} change fences Audio renewal atomically`,async t=>{
  const s=await fixture(t),batch=s.DB.batch.bind(s.DB);let raced=false;
  const before=s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n;
  s.DB.batch=async statements=>{
    if(!raced&&statements.some(q=>/^INSERT INTO output_commands\b/u.test(q.sql.trim()))){raced=true;
      if(mutation==='retention')s.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(new Date(Date.now()+60_000).toISOString(),s.plan.draftId);
      else {
        const type='BlockCreated';
        const rows=s.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.rights_class','restricted') WHERE private_event_id IN(SELECT event_id FROM events WHERE type=?)").run(type);
        assert.ok(rows.changes>0);
      }
    }
    return batch(statements);
  };
  const response=await s.send(s.body);assert.equal(raced,true);assert.notEqual(response.status,200);
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM output_plan_revisions').get().n,before);s.unpaid();
});

test('repeated Audio renewals keep every proof within D1 capacity',async t=>{
  const s=await fixture(t,true),prepare=s.DB.prepare.bind(s.DB),batch=s.DB.batch.bind(s.DB);
  const counts=[],proofBatches=[];
  const track=statement=>{
    const bind=statement.bind.bind(statement);
    statement.bind=(...values)=>{counts.push(values.length);assert.ok(values.length<=100);return track(bind(...values));};
    return statement;
  };
  s.DB.prepare=sql=>track(prepare(sql));
  s.DB.batch=async statements=>{
    const result=await batch(statements);
    if(statements.every(q=>q.sql.startsWith('SELECT CASE WHEN ('))&&statements.at(-1)?.bindings.length===1
      &&statements.at(-1).sql.includes("strftime('%Y-%m-%dT%H:%M:%fZ','now')"))proofBatches.push(statements.reduce((n,q)=>n+q.bindings.length,0));
    return result;
  };
  const original=s.sqlite.prepare('SELECT * FROM output_commands ORDER BY command_key').all();
  for(let i=0;i<3;i++){
    const response=await s.send(s.body);assert.equal(response.status,200,await response.clone().text());
    const ready=await response.json();assert.equal(ready.permitted.authorize,true);
    t.mock.timers.setTime(Date.parse(ready.preflight.targets[0].settings.original.expiresAt)+1);
    const expired=await(await s.send()).json();assert.equal(expired.permitted.renewPreparation,true);
    s.body={...s.body,renewal:{predecessorPreflightId:expired.preflight.id,explicitRenewal:true}};
  }
  assert.ok(proofBatches.some(n=>n>100),'Regression actually exceeds a flattened D1 statement capacity');
  assert.ok(counts.length>0&&Math.max(...counts)<=100);
  for(const row of original)assert.deepEqual(s.sqlite.prepare('SELECT * FROM output_commands WHERE command_key=?').get(row.command_key),row);
  s.unpaid();
});

for(const fault of ['missing','sparse','failed','false','expired'])test('Audio preflight refuses '+fault+' atomic proof',async t=>{
  const s=await fixture(t,true),batch=s.DB.batch.bind(s.DB),preflight=s.bridge.preflight;
  let active=false,injected=false;
  s.bridge.preflight=async(...args)=>{active=true;try{return await preflight(...args);}finally{active=false;}};
  s.DB.batch=async statements=>{
    const result=await batch(statements),last=statements.at(-1);
    if(!active||!statements.every(q=>q.sql.startsWith('SELECT CASE WHEN ('))||last?.bindings.length!==1
      ||!last.sql.includes("strftime('%Y-%m-%dT%H:%M:%fZ','now')"))return result;
    injected=true;
    if(fault==='missing')return result.slice(0,-1);
    if(fault==='sparse'){delete result[0];return result;}
    if(fault==='failed')result[0].success=false;
    if(fault==='false')result[0].results=[{current:0}];
    if(fault==='expired')t.mock.timers.setTime(Date.parse(last.bindings[0]));
    return result;
  };
  const response=await s.send(s.body);assert.equal(injected,true);
  if(response.status===200){const state=await response.json();assert.equal(state.permitted.authorize,false);assert.equal(state.permitted.run,false);}
  else assert.equal(response.status,409);
  s.unpaid();
});

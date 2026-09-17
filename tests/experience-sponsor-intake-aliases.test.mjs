import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {fixture} from './sponsor-initial-intake-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const [{prepareSponsorImageDraft,commitSponsorImageDraft,SPONSOR_INTAKE_SCHEMA},{handleExperienceOutput},{canonicalJson,digest},{handleExperienceIntake}]=await Promise.all([
  import('../worker/experience-sponsor-intake.ts'),import('../worker/experience-output-api.ts'),
  import('../src/experiences/compiler.ts'),
  import('../worker/experience-intake-api.ts'),
]);
const originalFetch=globalThis.fetch;
let forbiddenFetches=0;
globalThis.fetch=()=>{forbiddenFetches++;throw Error('Intake alias qualification prohibits network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(forbiddenFetches,0);});

function verifyDepth(t,f){
  const depth=enforceD1ExpressionDepth(f);
  t.after(()=>{depth.assertVerified();depth.restore();});
  return depth;
}

function businessState(f){
  const tables=f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'experience_sponsor_%' OR name IN ('private_content','events','event_private_payloads','event_client_receipts','output_commands','output_preflights','output_execution_grants','output_operation_slots','document_jobs','output_provider_calls','budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters')) ORDER BY name").all();
  return Object.fromEntries(tables.map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
}

/** Count execution, not preparation or metadata-only EXISTS. Throw before the
 * actual private bytes are returned, so a caught exception still fails the test. */
function protectedReadTripwire(f,effects){
  const prepare=f.DB.prepare.bind(f.DB),decorated=new WeakSet();
  const decorate=statement=>{
    if(decorated.has(statement))return statement;
    decorated.add(statement);
    const bind=statement.bind.bind(statement),execute=statement.execute.bind(statement);
    statement.bind=(...bindings)=>decorate(bind(...bindings));
    statement.execute=kind=>{
      if(/^\s*SELECT\s+content\s*,\s*expires_at\s+FROM\s+private_content\b/iu.test(statement.sql)){
        effects.protectedReads++;
        throw Error('fixture_protected_read_forbidden');
      }
      return execute(kind);
    };
    return statement;
  };
  f.DB.prepare=sql=>decorate(prepare(sql));
}

async function sponsorPlan(f,{commit=true}={}){
  const prepared=await prepareSponsorImageDraft(f.prepareRequest(),f.env);
  assert.equal(prepared.status,'prepared');
  assert.ok(prepared.plan.sponsor_intake);
  if(commit)assert.equal((await commitSponsorImageDraft(f.commitRequest(prepared.plan),f.env)).status,'complete');
  return prepared.plan;
}

async function requirePrivateRefusal(t,f,invoke,label,expectedStatus=403){
  const before=businessState(f),mediaBefore=structuredClone([...f.media]),fetchBefore=forbiddenFetches;
  const effects={protectedReads:0,bridgeCalls:0,waitUntilCalls:0};
  protectedReadTripwire(f,effects);
  let response,result;
  try{response=await invoke();result=await response.json();}
  catch(cause){result={error:cause.message};}
  t.diagnostic(JSON.stringify({alias:label,status:response?.status,error:result.error,...effects}));
  assert.deepEqual(businessState(f),before,'ordinary alias must not change custody, sponsor receipts, jobs, purchases, or holds');
  assert.deepEqual([...f.media],mediaBefore);
  assert.equal(forbiddenFetches,fetchBefore);
  assert.deepEqual(effects,{protectedReads:0,bridgeCalls:0,waitUntilCalls:0});
  assert.equal(response?.status,expectedStatus,JSON.stringify(result));
  assert.equal(result.error,expectedStatus===403?'sponsor_intake_internal_only':'experience_draft_unavailable');
  assert.equal(JSON.stringify(result).includes(f.nativeRequest.values.subject.value),false);
}

const aliases=[
  {name:'GET output',suffix:'',body:null},
  {name:'POST output prepare',suffix:'/prepare',body:plan=>({draftHash:plan.draftHash,explicitRequirementsConfirmation:true})},
  {name:'POST output authorize',suffix:'/authorize',body:plan=>({draftHash:plan.draftHash,termsDigest:'a'.repeat(64),maximumMicrousd:1,explicitAuthorization:true})},
  {name:'POST output run',suffix:'/run',body:plan=>({draftHash:plan.draftHash,grantId:'fixture-unused-grant',explicitRun:true})},
  {name:'POST output recover-result',suffix:'/recover-result',body:plan=>({draftHash:plan.draftHash,grantId:'fixture-unused-grant',jobId:'fixture-unused-job',explicitRecovery:true})},
];
for(const alias of aliases)test(`ordinary ${alias.name} refuses a sponsored draft before private content read`,async t=>{
  const f=await fixture(t),plan=await sponsorPlan(f);
  const before=businessState(f),mediaBefore=structuredClone([...f.media]),fetchBefore=forbiddenFetches;
  const effects={protectedReads:0,bridgeCalls:0,waitUntilCalls:0};
  protectedReadTripwire(f,effects);
  const context={waitUntil(){effects.waitUntilCalls++;throw Error('fixture_detached_work_forbidden');}};
  const bridge=new Proxy({}, {get(){return ()=>{effects.bridgeCalls++;throw Error('fixture_output_bridge_forbidden');};}});
  const body=alias.body?.(plan);
  const request=new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/output${alias.suffix}`,{
    method:body?'POST':'GET',headers:{...f.actorHeaders,...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  const response=await handleExperienceOutput(request,f.env,context,bridge),result=await response.json();
  t.diagnostic(JSON.stringify({alias:alias.name,status:response.status,error:result.error,...effects}));
  assert.deepEqual(businessState(f),before,'refusal must not change custody, sponsor receipts, jobs, purchases, or holds');
  assert.deepEqual([...f.media],mediaBefore);
  assert.equal(forbiddenFetches,fetchBefore);
  assert.deepEqual(effects,{protectedReads:0,bridgeCalls:0,waitUntilCalls:0});
  assert.equal(response.status,403,JSON.stringify(result));
  assert.equal(result.error,'sponsor_intake_internal_only');
  assert.equal(JSON.stringify(result).includes(plan.request.values.subject.value),false);
});

const intakeAliases=[
  {name:'GET draft by ID',status:404,invoke:(f,plan)=>f.nativeCall(`drafts/${plan.draftId}`)},
  {name:'GET draft by intent',status:404,invoke:f=>f.nativeCall(`drafts?intentId=${encodeURIComponent(f.nativeRequest.intentId)}`)},
  {name:'GET draft receipt',status:404,invoke:(f,plan)=>f.nativeCall(`drafts/${plan.draftId}/receipt`)},
  {name:'POST ordinary save',invoke:f=>f.nativeCall('drafts','POST',f.nativeRequest)},
  {name:'POST ordinary commit',invoke:(f,plan)=>f.nativeCall(`drafts/${plan.draftId}/commit`,'POST',{draftHash:plan.draftHash})},
];
for(const alias of intakeAliases)test(`ordinary ${alias.name} refuses a sponsored draft before private content read`,async t=>{
  const f=await fixture(t),plan=await sponsorPlan(f);
  await requirePrivateRefusal(t,f,()=>alias.invoke(f,plan),alias.name,alias.status);
});

for(const marker of [null,{version:99},{version:1,receiptId:'orphan-intake-receipt'}])test(`ordinary read refuses an orphan sponsor marker ${JSON.stringify(marker)}`,async t=>{
  const f=await fixture(t),created=await f.nativeCall('drafts','POST',f.nativeRequest);
  assert.equal(created.status,200);
  const {plan}=await created.json(),{draftHash:_draftHash,...base}=plan;
  const marked={...base,sponsor_intake:marker},replacement={...marked,draftHash:await digest(marked)};
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(canonicalJson(replacement),plan.draftId);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_intakes').get().n,0);
  await requirePrivateRefusal(t,f,()=>f.nativeCall(`drafts/${plan.draftId}`),`orphan marker ${JSON.stringify(marker)}`,404);
});

test('an ordinary draft keeps its native save, ID and intent reads, commit, and receipt',async t=>{
  const f=await fixture(t);verifyDepth(t,f);
  const created=await f.nativeCall('drafts','POST',f.nativeRequest);
  assert.equal(created.status,200);const {plan}=await created.json();
  assert.equal(Object.hasOwn(plan,'sponsor_intake'),false);
  for(const path of [`drafts/${plan.draftId}`,`drafts?intentId=${encodeURIComponent(f.nativeRequest.intentId)}`]){
    const response=await f.nativeCall(path);assert.equal(response.status,200);assert.deepEqual((await response.json()).plan,plan);
  }
  const commit=await f.nativeCall(`drafts/${plan.draftId}/commit`,'POST',{draftHash:plan.draftHash});
  assert.equal(commit.status,200);assert.equal((await commit.json()).status,'complete');
  const before=businessState(f),receipt=await f.nativeCall(`drafts/${plan.draftId}/receipt`);
  assert.equal(receipt.status,200);assert.equal((await receipt.json()).status,'complete');
  const replay=await f.nativeCall('drafts','POST',f.nativeRequest);
  assert.equal(replay.status,200);assert.deepEqual((await replay.json()).plan,plan);assert.deepEqual(businessState(f),before);
});

test('invalid JSON without sponsor evidence remains an ordinary unavailable draft',async t=>{
  const f=await fixture(t),created=await f.nativeCall('drafts','POST',f.nativeRequest);
  assert.equal(created.status,200);const {plan}=await created.json();
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('{invalid-json',plan.draftId);
  const before=businessState(f),response=await f.nativeCall(`drafts/${plan.draftId}`);
  assert.equal(response.status,404);assert.equal((await response.json()).error,'experience_draft_unavailable');
  assert.deepEqual(businessState(f),before);
});

test('a raw expired foreign-actor sidecar refuses ordinary reads even after private content is missing',async t=>{
  const f=await fixture(t),plan=await sponsorPlan(f,{commit:false});
  // Adversarial fixture damage: classification must not join away evidence of
  // sponsor custody because provenance is no longer currently valid.
  f.sqlite.exec('DROP TRIGGER experience_sponsor_intake_no_update');
  f.sqlite.prepare("UPDATE experience_sponsor_intakes SET actor_user_id='other-actor',expires_at='2000-01-01T00:00:00.000Z' WHERE draft_id=?").run(plan.draftId);
  f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(plan.draftId);
  await requirePrivateRefusal(t,f,()=>f.nativeCall(`drafts/${plan.draftId}`),'raw sidecar without private body',404);
});

test('ordinary lookup refuses hidden sponsor schema through a mixed-case table or a substituted view',async t=>{
  for(const shape of ['mixed-case table','view']){
    const f=await fixture(t);let plan;
    if(shape==='mixed-case table'){
      plan=await sponsorPlan(f,{commit:false});
      // SQLite rejects a direct case-only rename; use a distinct intermediate.
      f.sqlite.exec('ALTER TABLE experience_sponsor_intakes RENAME TO fixture_sidecar_case; ALTER TABLE fixture_sidecar_case RENAME TO Experience_Sponsor_Intakes');
    }else{
      const created=await f.nativeCall('drafts','POST',f.nativeRequest);assert.equal(created.status,200);({plan}=await created.json());
      f.sqlite.exec("DROP TABLE experience_sponsor_intakes; CREATE VIEW experience_sponsor_intakes AS SELECT 'unrelated-draft' AS draft_id");
    }
    await requirePrivateRefusal(t,f,()=>f.nativeCall(`drafts/${plan.draftId}`),shape,404);
  }
});

/** Keep a real issued sidecar for deterministic interleaving, but start the
 * ordinary request with a valid unmarked body and no sidecar row. This fixture
 * mutation models classification becoming stale; it is not sponsor issuance. */
async function raceFixture(t,{absent=false,storage=false}={}){
  const f=await fixture(t),marked=await sponsorPlan(f,{commit:false});
  const row=f.sqlite.prepare('SELECT * FROM experience_sponsor_intakes WHERE draft_id=?').get(marked.draftId);
  const {sponsor_intake:_marker,draftHash:_hash,...base}=marked,plan={...base,draftHash:await digest(base)};
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(canonicalJson(plan),plan.draftId);
  f.sqlite.exec('DROP TABLE experience_sponsor_intakes');
  const recreate=()=>{
    for(const sql of SPONSOR_INTAKE_SCHEMA.filter(sql=>!sql.startsWith('CREATE TABLE experience_sponsor_intake_assertions')))f.sqlite.exec(sql);
  };
  if(!absent)recreate();
  if(storage)f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(plan.draftId);
  const installSidecar=()=>{
    if(absent)recreate();
    const keys=Object.keys(row);
    f.sqlite.prepare(`INSERT INTO experience_sponsor_intakes(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));
  };
  return {...f,plan,installSidecar};
}

const contentSelect=sql=>/^\s*SELECT\s+content\s*,\s*expires_at\s+FROM\s+private_content\b/iu.test(sql);
const finalCustodySelect=sql=>/^\s*SELECT 1 AS current WHERE/u.test(sql)&&sql.includes('private_content draft');
function installReadRace(f,{boundary,mutate}){
  const prepare=f.DB.prepare.bind(f.DB),decorated=new WeakSet(),effects={mutations:0,initialRows:0,finalRows:0};
  let expected;
  const inject=()=>{effects.mutations++;mutate();expected=businessState(f);};
  const decorate=statement=>{
    if(decorated.has(statement))return statement;
    decorated.add(statement);
    const bind=statement.bind.bind(statement),execute=statement.execute.bind(statement);
    statement.bind=(...bindings)=>decorate(bind(...bindings));
    statement.execute=kind=>{
      if(!effects.mutations&&(boundary==='initial'&&contentSelect(statement.sql)||boundary==='final'&&finalCustodySelect(statement.sql)))inject();
      const result=execute(kind);
      if(contentSelect(statement.sql)&&result)effects.initialRows++;
      if(finalCustodySelect(statement.sql)&&result)effects.finalRows++;
      return result;
    };
    return statement;
  };
  f.DB.prepare=sql=>decorate(prepare(sql));
  if(boundary==='storage'){
    const batch=f.DB.batch.bind(f.DB);
    f.DB.batch=async statements=>{
      // The competing sidecar commits before the native storage transaction.
      if(!effects.mutations&&statements.some(statement=>/^\s*INSERT INTO private_content\s*\(/u.test(statement.sql)))inject();
      return batch(statements);
    };
  }
  return {effects,expected:()=>expected};
}

for(const absent of [false,true])for(const boundary of ['initial','final','storage'])test(`ordinary ${boundary} guard refuses a newly inserted sidecar with schema ${absent?'initially absent':'present'}`,async t=>{
  const f=await raceFixture(t,{absent,storage:boundary==='storage'});
  verifyDepth(t,f);
  const race=installReadRace(f,{boundary,mutate:f.installSidecar}),fetchBefore=forbiddenFetches;
  const response=boundary==='storage'?await f.nativeCall('drafts','POST',f.nativeRequest):await f.nativeCall(`drafts/${f.plan.draftId}`);
  const result=await response.json();
  t.diagnostic(JSON.stringify({boundary,absent,status:response.status,error:result.error,...race.effects}));
  assert.equal(race.effects.mutations,1,'the interleaving must execute');
  assert.equal(response.status,boundary==='storage'?409:404,JSON.stringify(result));
  assert.equal(result.error,boundary==='storage'?'experience_save_unconfirmed':'experience_draft_unavailable');
  assert.equal(Object.hasOwn(result,'plan'),false);
  assert.equal(JSON.stringify(result).includes(f.nativeRequest.values.subject.value),false);
  assert.equal(race.effects.initialRows,boundary==='final'?1:0,'the initial guard must withhold a body once sponsorship has appeared');
  assert.equal(race.effects.finalRows,0,'the final custody guard must not confirm stale ordinary authority');
  assert.deepEqual(businessState(f),race.expected(),'only the simulated competing sidecar may change durable state');
  assert.equal(forbiddenFetches,fetchBefore);assert.equal(f.media.size,0);
});

for(const boundary of ['initial','final'])test(`ordinary output ${boundary} read guard refuses ${boundary==='initial'?'a marker':'a sidecar'} appearing after classification`,async t=>{
  const f=await raceFixture(t),effects={bridge:0,wait:0};
  verifyDepth(t,f);
  const {draftHash:_hash,...base}=f.plan,marked={...base,sponsor_intake:null},replacement={...marked,draftHash:await digest(marked)};
  const race=installReadRace(f,{boundary,mutate:boundary==='final'?f.installSidecar:()=>f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(canonicalJson(replacement),f.plan.draftId)});
  const context={waitUntil(){effects.wait++;throw Error('fixture_detached_work_forbidden');}};
  const bridge=new Proxy({}, {get(){return ()=>{effects.bridge++;throw Error('fixture_output_bridge_forbidden');};}});
  const response=await handleExperienceOutput(new Request(`http://localhost/api/experiences/drafts/${f.plan.draftId}/output`,{headers:f.actorHeaders}),f.env,context,bridge);
  const result=await response.json();
  assert.equal(race.effects.mutations,1);assert.equal(response.status,410,JSON.stringify(result));assert.equal(result.error,'experience_draft_unavailable');
  assert.equal(race.effects.initialRows,boundary==='final'?1:0);assert.equal(race.effects.finalRows,0);
  assert.equal(JSON.stringify(result).includes(f.nativeRequest.values.subject.value),false);
  assert.deepEqual(effects,{bridge:0,wait:0});assert.deepEqual(businessState(f),race.expected());
});

const replacementDatabase=effects=>new Proxy({}, {get(){return ()=>{effects.replacementQueries++;throw Error('fixture_replacement_database_forbidden');};}});

test('ordinary commit refuses a database swap while its real request body is being read',async t=>{
  const f=await fixture(t),created=await f.nativeCall('drafts','POST',f.nativeRequest);
  assert.equal(created.status,200);const {plan}=await created.json(),before=businessState(f);
  const effects={swaps:0,replacementQueries:0,protectedReads:0};
  protectedReadTripwire(f,effects);
  const replacement=replacementDatabase(effects),database=f.env.DB;
  const request=new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/commit`,{
    method:'POST',headers:{...f.actorHeaders,'content-type':'application/json'},body:JSON.stringify({draftHash:plan.draftHash}),
  });
  const getReader=request.body.getReader.bind(request.body);
  request.body.getReader=(...args)=>{
    const reader=getReader(...args),read=reader.read.bind(reader);
    reader.read=async()=>{
      const item=await read();
      if(!item.done&&!effects.swaps){effects.swaps++;f.env.DB=replacement;}
      return item;
    };
    return reader;
  };
  let response;
  try{response=await handleExperienceIntake(request,f.env);}
  finally{f.env.DB=database;}
  assert.equal(response.status,404);assert.equal((await response.json()).error,'experience_draft_unavailable');
  assert.deepEqual(effects,{swaps:1,replacementQueries:0,protectedReads:0});assert.deepEqual(businessState(f),before);
});

test('ordinary output refuses a database swap after its guarded draft custody read',async t=>{
  const f=await fixture(t),created=await f.nativeCall('drafts','POST',f.nativeRequest);
  assert.equal(created.status,200);const {plan}=await created.json();
  const committed=await f.nativeCall(`drafts/${plan.draftId}/commit`,'POST',{draftHash:plan.draftHash});assert.equal(committed.status,200);
  const before=businessState(f),effects={swaps:0,replacementQueries:0,guardedRows:0,bridge:0,wait:0};
  verifyDepth(t,f);
  const replacement=replacementDatabase(effects),database=f.env.DB,prepare=database.prepare.bind(database),decorated=new WeakSet();
  const decorate=statement=>{
    if(decorated.has(statement))return statement;
    decorated.add(statement);
    const bind=statement.bind.bind(statement),execute=statement.execute.bind(statement);
    statement.bind=(...bindings)=>decorate(bind(...bindings));
    statement.execute=kind=>{
      const result=execute(kind);
      if(!effects.swaps&&finalCustodySelect(statement.sql)){
        assert.ok(result,'the original guarded custody read must succeed before replacement');
        effects.guardedRows++;effects.swaps++;f.env.DB=replacement;
      }
      return result;
    };
    return statement;
  };
  database.prepare=sql=>decorate(prepare(sql));
  const context={waitUntil(){effects.wait++;throw Error('fixture_detached_work_forbidden');}};
  const bridge=new Proxy({}, {get(){return ()=>{effects.bridge++;throw Error('fixture_output_bridge_forbidden');};}});
  let response;
  try{response=await handleExperienceOutput(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/output`,{headers:f.actorHeaders}),f.env,context,bridge);}
  finally{f.env.DB=database;}
  const result=await response.json();assert.equal(response.status,410,JSON.stringify(result));assert.equal(result.error,'experience_draft_unavailable');
  assert.equal(JSON.stringify(result).includes(f.nativeRequest.values.subject.value),false);
  assert.deepEqual(effects,{swaps:1,replacementQueries:0,guardedRows:1,bridge:0,wait:0});assert.deepEqual(businessState(f),before);
});

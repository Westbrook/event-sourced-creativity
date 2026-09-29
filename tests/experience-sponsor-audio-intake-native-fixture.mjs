import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {after} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();

// Authorized test-only registry transition: one pinned lookup may clone only
// the Audio definition revision, plus an explicitly selected synthetic enlarged
// direction maximum for the canonical-byte ceiling check. The compiler, native
// handlers and SQL remain unchanged. This is not a two-deployed-worker test.
const registryUrl=new URL('../src/experiences/intake.ts',import.meta.url).href;
const registryKey=Symbol.for('forma.audio-initial-native.fixture-registration-revision');
assert.equal(Object.hasOwn(globalThis,registryKey),false);
const lengthKey=Symbol.for('forma.audio-initial-native.fixture-direction-maximum');
let registryRevision=1,registryLoads=0,directionMaximum=600;
Object.defineProperty(globalThis,lengthKey,{configurable:true,get:()=>directionMaximum});
Object.defineProperty(globalThis,registryKey,{configurable:true,get:()=>registryRevision});
const registryHook=registerHooks({load(url,context,nextLoad){
  const loaded=nextLoad(url,context);if(url!==registryUrl)return loaded;
  const source=typeof loaded.source==='string'?loaded.source:Buffer.from(loaded.source).toString('utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),'63b52b157d4f0ec81c2913021fb6d9312c5dd2ad091b4ba81e0f72cf4abace28');
  const needle='const definition = definitions.find(item => item.id === id);';
  assert.equal(source.split(needle).length,2);registryLoads++;
  const patched=source.replace(needle,`const selectedDefinition = definitions.find(item => item.id === id);
  const definition = id === "audio" && selectedDefinition && globalThis[Symbol.for("forma.audio-initial-native.fixture-registration-revision")] === 2
    ? { ...selectedDefinition, revision: 2 } : selectedDefinition;`);
  const compileNeedle='const result = await compileExperience(definition, contextCatalog);';assert.equal(patched.split(compileNeedle).length,2);
  return {...loaded,source:patched.replace(compileNeedle,`const catalog = id === "audio" && globalThis[Symbol.for("forma.audio-initial-native.fixture-direction-maximum")] === 8192
    ? { ...contextCatalog, interactions: { ...contextCatalog.interactions, "audio-direction@1": { ...contextCatalog.interactions["audio-direction@1"], maxLength: 8192 } } }
    : contextCatalog;
  const result = await compileExperience(definition, catalog);`)};
}});
after(()=>{assert.equal(registryRevision,1);assert.equal(directionMaximum,600);assert.equal(registryLoads,1);registryHook.deregister();delete globalThis[registryKey];delete globalThis[lengthKey];});
export const registrationFixture=Object.freeze({
  setRevision(revision){assert.ok(revision===1||revision===2);registryRevision=revision;},
  loaded(){return registryLoads;},
  // Explicit synthetic enlarged registration for the independent 65,536-byte gate test only.
  setDirectionMaximum(value){assert.ok(value===600||value===8192);directionMaximum=value;},
});

const [{handleSession,POLICY_VERSION},{ensureOutputRequirementsSchema},
  {registeredExperience,initialValues,buildExperiencePlan},{stableAudioTemplate},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},
  {SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/output-requirements-ledger.ts'),
  import('../src/experiences/intake.ts'),import('./sponsor-audio-server-native-fixture.mjs'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),
  import('../worker/experience-sponsor-approval.ts'),
]);
assert.equal(registryLoads,1);

export const actor='fixture-audio-initial-actor',payer='fixture-audio-initial-payer';
export const FAMILY='canonical-audio-initial-intake@1';
export const OPERATIONS=['audio-intake-prepare','audio-intake-commit','audio-intake-draft','audio-intake-receipt'];
export const databaseClock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export const queryLimits={functionArguments:32,parameters:100,sqlBytes:100000};
export const headersFor=userId=>({'oai-authenticated-user-id':userId,'oai-authenticated-user-email':`${userId}@example.invalid`});
export const jsonInit=(body,headers={})=>({method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
export const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');

/** WITH DML in the shared SQLite shim executes correctly but has no changed-row
 * metadata. Preserve its actual SQLite changes(), rather than fabricate ACKs. */
function withDmlMetadata(f){
  const prepare=f.DB.prepare.bind(f.DB),decorated=new WeakSet();
  const dml=/^\s*WITH\s+[A-Za-z_]\w*(?:\s*\([^)]*\))?\s+AS\s*\([\s\S]*\)\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[A-Za-z_]\w*/iu;
  const decorate=statement=>{
    if(decorated.has(statement))return statement;decorated.add(statement);
    const bind=statement.bind.bind(statement),execute=statement.execute.bind(statement);
    statement.bind=(...bindings)=>decorate(bind(...bindings));
    statement.execute=kind=>{
      const result=execute(kind);
      if(kind==='all'&&dml.test(statement.sql))result.meta.changes=Number(f.sqlite.prepare('SELECT changes() AS n').get().n);
      return result;
    };
    return statement;
  };
  f.DB.prepare=sql=>decorate(prepare(sql));
}

/** Actual registered Audio Context input: one required direction, optional
 * authored detail, and its registered format produce five or six native events. */
export async function nativeRequest({intentId=randomUUID(),detail='',direction='An original instrumental cue, gently rising. 水 — موسيقى',...overrides}={}){
  const release=await registeredExperience('audio');assert.ok(release);
  const values=initialValues(release);values.direction={value:direction,provenance:'authored'};
  if(detail)values.detail={value:detail,provenance:'authored'};
  return {intentId,experienceId:'audio',releaseHash:release.releaseHash,values,...overrides};
}

export function requestFor(f,body,{actorUserId=f.actor,headers={},path='http://localhost/__fixture/audio-initial-intake',signal}={}){
  return new Request(path.startsWith('/')?`http://localhost${path}`:path,{...jsonInit(body,{...headersFor(actorUserId),...headers}),...(signal?{signal}:{})});
}

export function initialPolicy(now){
  const storage={maximumOperations:100,maximumBytes:40_000_000,maximumOperationsPerWindow:100,maximumBytesPerWindow:40_000_000};
  const io={maximumRequestsPerWindow:200,maximumBytesPerWindow:400_000_000};
  return {version:1,family:FAMILY,purpose:'initial-context',
    storage:{startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,
      maximumDraftBytes:256_000,maximumEventBytes:128_000,maximumOriginalBytes:384_000,
      actor:{...storage},campaign:{...storage}},
    io:{windowMs:60_000,operations:Object.fromEntries(OPERATIONS.map(operation=>[operation,{maximumBytes:2_000_000,deadlineMs:30_000}])),
      actor:{...io},campaign:{...io}}};
}

export async function approveCampaign(f,{proposal=f.proposal,approvalId=`approval-${f.campaignId}`}={}){
  const compiled=await compileSponsorApprovalProposal(proposal);
  const command={action:'approve-sponsor-campaign',approvalId,proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:compiled.termsDigest};
  const approved=await approveSponsorCampaign(requestFor(f,command,{actorUserId:f.payer}),f.env);
  Object.assign(f,{proposal,policy:approved.policy,compiled:approved,approval:approved,approvalCommand:command});
  return approved;
}

export async function responseBody(response,status=200){
  assert.ok(response instanceof Response);const body=await response.json();
  assert.equal(response.status,status,JSON.stringify(body));return body;
}

export const count=(f,table)=>Number(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n);
export function rows(f,table){return f.sqlite.prepare(`SELECT * FROM "${table}"`).all().map(row=>({...row})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
export function tables(f){return f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);}
export function snapshot(f,{exclude=[]}={}){return Object.fromEntries(tables(f).filter(table=>!exclude.includes(table)).map(table=>[table,rows(f,table)]));}
export function assertNoGeneration(f){
  const installed=new Set(tables(f));
  for(const table of ['output_preflights','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations',
    'output_provider_calls','experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs']){
    if(installed.has(table))assert.equal(count(f,table),0,`No generation or old V1 resource use: ${table}`);
  }
  assert.equal(f.media.size,0);assert.deepEqual(f.effects,{media:0,assets:0});
}

/** Observes the real adapter and returned values. Fault hooks run around actual
 * SQLite/D1 calls; they never substitute a successful authority or canned row. */
export function observeDatabase(f,{before,after,transform}={}){
  const original=f.env.DB,records=[],statements=new WeakMap();
  const record=async(kind,parts,execute)=>{
    const entry={kind,statements:parts.map(part=>({sql:part.sql,bindings:[...part.bindings]}))};
    records.push(entry);await before?.(entry);
    try{
      const result=await execute();entry.returnedBytes=bytes(result);entry.result=structuredClone(result);
      await after?.(entry,result);
      return transform?await transform(entry,result):result;
    }catch(error){entry.error=String(error?.message??error);throw error;}
  };
  const wrap=(statement,sql,bindings=[])=>{
    const part={statement,sql,bindings},wrapped={
      bind(...values){return wrap(statement.bind(...values),sql,values);},
      all(){return record('all',[part],()=>statement.all());},
      first(...args){return record('first',[part],()=>statement.first(...args));},
      run(){return record('run',[part],()=>statement.run());},
    };
    statements.set(wrapped,part);return wrapped;
  };
  const database={
    prepare(sql){return wrap(original.prepare(sql),sql);},
    batch(items){
      const parts=items.map(item=>{const part=statements.get(item);assert.ok(part,'Observed batch must retain exact statements');return part;});
      return record('batch',parts,()=>original.batch(parts.map(part=>part.statement)));
    },
  };
  f.env.DB=database;f.DB=database;
  return {database,records,restore(){f.env.DB=original;f.DB=original;},
    sql(){return records.flatMap(entry=>entry.statements.map(part=>part.sql));},
    returnedBytes(){return records.reduce((sum,entry)=>sum+(entry.returnedBytes??0),0);}};
}

/** Installs real native account/schema and explicit synthetic V8 payer approval.
 * Initial Context remains empty. Additional dormant DDL and approval are added
 * by installIntake/approveIntake after the new leaf contracts freeze. */
export async function fixture(t,{campaignId='fixture-audio-initial-campaign',actorUserId=actor,payerUserId=payer,
  extraActorUserIds=[],approved=true,intakeApproved=true,strict=true,detail='',intentId,native=true}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());withDmlMetadata(f);
  f.effects={media:0,assets:0};
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{f.effects.media++;throw Error('Audio initial intake forbids media IO');};
  f.env.ASSETS.fetch=()=>{f.effects.assets++;throw Error('Audio initial intake forbids asset IO');};
  t.after(()=>assert.deepEqual(f.effects,{media:0,assets:0}));
  const oldFetch=globalThis.fetch;let setupFetchAttempts=0;
  globalThis.fetch=()=>{setupFetchAttempts++;throw Error('Audio initial-intake fixture forbids network');};
  try{
    Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',FAL_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'});
    const actors=[...new Set([actorUserId,...extraActorUserIds])],users=[...new Set([...actors,payerUserId])];
    for(const userId of users){
      assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headersFor(userId)}),f.env)).status,200);
      f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,userId);
    }
    await ensureOutputRequirementsSchema(f.env);
    for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
    const now=Number(f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now),template=await stableAudioTemplate();
    const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,
      maximumPendingGrants:10,maximumInflightJobs:1};
    const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,
      campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
    const proposal={policy:{version:8,family:'canonical-instrumental-cue@1',mode:'candidate',campaignId,policyVersion:'audio-initial-fixture@1',payerUserId,
      audience:'canonical-principal',startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,
      maximumAdmissions:10,maximumMicrousd:template.maximumMicrousd*10,maximumAdmissionsPerActor:5,
      windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources},
    eligibleActorUserIds:actors,issuerUserIds:actors};
    Object.assign(f,{actor:actorUserId,payer:payerUserId,actorHeaders:headersFor(actorUserId),payerHeaders:headersFor(payerUserId),
      stream:`creative:${actorUserId}`,campaignId,extraActorUserIds,proposal,template,resources,now,
      nativeRequest:await nativeRequest({detail,intentId}),intakePolicy:initialPolicy(now)});
    f.approveCampaign=options=>approveCampaign(f,options);
    f.prepareRequest=(native=f.nativeRequest,campaign=f.campaignId,options={})=>requestFor(f,
      {action:'prepare-sponsored-audio-draft',campaignId:campaign,request:native},options);
    f.commitRequest=(plan,campaign=f.campaignId,options={})=>requestFor(f,
      {action:'commit-sponsored-audio-draft',campaignId:campaign,draftId:plan.draftId,draftHash:plan.draftHash},options);
    f.readRequest=(options={})=>new Request('http://localhost/__fixture/audio-initial-original',
      {headers:{...headersFor(options.actorUserId??f.actor),...options.headers},...(options.signal?{signal:options.signal}:{})});
    f.buildPlan=async(native=f.nativeRequest)=>buildExperiencePlan(f.actor,native,await registeredExperience('audio'));
    if(approved){await f.approveCampaign();assert.equal(JSON.parse(f.sqlite.prepare('SELECT payer_authority_json FROM experience_sponsor_approvals').get().payer_authority_json).length,13);}
    await installIntake(f,{native});
    f.approveIntake=options=>approveIntake(f,options);
    if(strict){f.limits=enforceD1ExpressionDepth(f,{queryLimits});t.after(()=>f.limits.restore());}
    if(intakeApproved)await f.approveIntake();
    assert.equal(count(f,'events'),0);assert.equal(count(f,'private_content'),0);assertNoGeneration(f);
    assert.equal(setupFetchAttempts,0);return f;
  }finally{globalThis.fetch=oldFetch;}
}

async function installIntake(f,{native}){
  const [{SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA},{SPONSOR_AUDIO_INTAKE_APPROVAL_SCHEMA},
    {SPONSOR_AUDIO_INTAKE_STORAGE_SCHEMA}]=await Promise.all([
    import('../worker/experience-sponsor-audio-intake-policy.ts'),
    import('../worker/experience-sponsor-audio-intake-approval.ts'),
    import('../worker/experience-sponsor-audio-intake-resources.ts'),
  ]);
  for(const schema of [SPONSOR_AUDIO_INTAKE_POLICY_SCHEMA,SPONSOR_AUDIO_INTAKE_APPROVAL_SCHEMA,SPONSOR_AUDIO_INTAKE_STORAGE_SCHEMA]){
    assert.ok(Array.isArray(schema));for(const sql of schema)f.sqlite.exec(sql);
  }
  if(native){
    const {SPONSOR_AUDIO_INTAKE_ATTEMPT_SCHEMA}=await import('../worker/experience-sponsor-audio-intake-attempts.ts');
    assert.ok(Array.isArray(SPONSOR_AUDIO_INTAKE_ATTEMPT_SCHEMA));for(const sql of SPONSOR_AUDIO_INTAKE_ATTEMPT_SCHEMA)f.sqlite.exec(sql);
  }
}

export async function approveIntake(f,{intakePolicy=f.intakePolicy,campaignId=f.campaignId,
  sponsorPolicyDigest=f.compiled.policyDigest,approvalId=`initial-approval-${campaignId}`,actorUserId=f.payer}={}){
  const {prepareSponsorAudioIntakeApproval,approveSponsorAudioIntakePolicy}=await import('../worker/experience-sponsor-audio-intake-approval.ts');
  const proposal={version:1,family:FAMILY,campaignId,sponsorPolicyDigest,intakePolicy};
  const review=await prepareSponsorAudioIntakeApproval(requestFor(f,{action:'prepare-sponsor-audio-intake-policy',proposal},{actorUserId}),f.env);
  const command={action:'approve-sponsor-audio-intake-policy',proposal,approvalId,reviewedTermsDigest:review.termsDigest,
    confirmation:'APPROVE_SPONSOR_AUDIO_INTAKE_POLICY'};
  const approved=await approveSponsorAudioIntakePolicy(requestFor(f,command,{actorUserId}),f.env);
  Object.assign(f,{intakePolicy,intakeProposal:proposal,intakeReview:review,intakeApproval:approved,intakeApprovalCommand:command});
  return approved;
}

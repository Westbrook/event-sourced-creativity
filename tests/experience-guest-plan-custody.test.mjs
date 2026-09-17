import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},{acquireGuestClaimLease},
  {GUEST_CONTEXT_ADOPTION_SCHEMA,adoptGuestContextSource,readGuestContextAdoption,inspectGuestContextAdoption,guestContextAdoptionData},
  {GUEST_PLAN_CUSTODY_SCHEMA,retainGuestContextPlan,readGuestContextPlan},{retireExpiredGuestImageSource},
  {registeredExperience,initialValues},{canonicalJson,digest},{appendAuditEvent}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'),import('../worker/experience-guest-claim-lease.ts'),import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-plan-custody.ts'),import('../worker/experience-guest-source-retirement.ts'),import('../src/experiences/intake.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/runtime.ts')]);
const origin='https://guest.example.invalid',owner='owner',subject='A blue heron on a stone bridge';
const headers=(actor=owner,extra={})=>({...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...extra});
const post=(actor=owner,extra={})=>new Request(`${origin}/unregistered-plan`,{method:'POST',headers:headers(actor,{origin,...extra})});
const get=(actor=owner,extra={})=>new Request(`${origin}/unregistered-plan`,{headers:headers(actor,extra)});
const proof=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const mappings=f=>rows(f,'experience_guest_plan_custodies');
const copies=f=>f.sqlite.prepare("SELECT * FROM private_content WHERE owner_id=? AND kind='experience-draft' ORDER BY content_id").all(owner);
const persistent=f=>Object.fromEntries(['private_content','experience_guest_plan_custodies','events','event_private_payloads','event_client_receipts',
  'experience_guest_sources','experience_guest_source_commits','experience_guest_context_adoptions','experience_guest_sessions','experience_guest_claim_leases']
  .map(table=>[table,rows(f,table)]));
const financial=f=>Object.fromEntries(['users','budget_counters','cost_budget_counters','budget_reservations','cost_budget_reservations','document_jobs',
  'output_execution_grants','output_operation_slots','output_provider_calls'].map(table=>[table,rows(f,table)]));
const custodyBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO experience_guest_plan_custodies'));
async function fixture(t,{memory=false,draftLifetimeMs=120000,adopt=true}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  for(const actor of [owner,'other'])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headers(actor)}),f.env)).status,200);
  f.sqlite.prepare("UPDATE users SET consent_version=?,role='creator'").run(POLICY_VERSION);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA])f.sqlite.exec(sql);
  if(memory)for(const filename of ['0027_memory_native_origins.sql','0033_memory_structured_answer_provenance.sql','0034_memory_document_job_origins.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+filename,import.meta.url),'utf8'));
  f.env.FORMA_RETENTION_DAYS='2';
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:Date.now()-60000,expiresAtMs:Date.now()+600000,
    sessionLifetimeMs:300000,leaseLifetimeMs:120000,maximumSessions:5,maximumLeaseAcquisitions:3});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(post(null),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:subject,provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const policy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,
    maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(policy.policyId,await digest(policy),canonicalJson(policy),`sha256:${'c'.repeat(64)}`);
  t.mock.method(globalThis,'fetch',()=>{throw Error('network forbidden');});for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{throw Error('media forbidden');});
  const prepared=await prepareGuestImageSource(post(null),f.env,{proof:proof(session),policyId:policy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}});
  const source=await commitGuestImageSource(post(null),f.env,{proof:proof(session),draftHash:prepared.plan.draftHash});
  const inventory=await inspectGuestContextInventory(post(null),f.env,{proof:proof(session)}),lease=await acquireGuestClaimLease(post(),f.env,{proof:proof(session),requestId:'request-1',manifestDigest:inventory.manifestDigest});
  const adopted=adopt?await adoptGuestContextSource(post(),f.env,{inventory,leaseId:lease.leaseId,requestId:'request-1'}):null;
  const finances=financial(f);return {...f,session,prepared,source,inventory,lease,adopted,
    retain:(actor=owner,extra={})=>retainGuestContextPlan(post(actor,extra),f.env,{sessionId:session.sessionId}),
    read:(actor=owner,extra={})=>readGuestContextPlan(get(actor,extra),f.env,{draftId:prepared.plan.draftId}),
    unpaid:()=>assert.deepEqual(financial(f),finances)};
}
function beforeStatement(f,predicate,mutation){const prepare=f.DB.prepare;let hit=false;f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
  statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;bound.execute=function(kind){if(!hit&&predicate(sql,bindings)){hit=true;mutation(sql,bindings);}return execute.call(this,kind);};return bound;};return statement;};
  return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native transaction hook executed');};}
function afterBatch(f,mutation){const batch=f.DB.batch;let hit=false;f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(!hit&&custodyBatch(statements)){hit=true;return mutation(result,statements);}return result;};
  return()=>{f.DB.batch=batch;assert.equal(hit,true,'committed custody batch hook executed');};}
async function expire(f){const started=performance.now();while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS expired FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).expired){
  assert.ok(performance.now()-started<5000,'native source deadline reached');await delay(10);}}
function assertResult(f,result,replayed){assert.equal(result.version,1);assert.equal(result.status,'context-only');assert.deepEqual(result.plan,f.prepared.plan);
  assert.equal(result.generationAvailable,false);assert.equal(result.miniAppClaimComplete,false);assert.equal(result.replayed,replayed);
  assert.equal(result.custody.version,1);assert.equal(result.custody.kind,'guest-context');assert.equal(result.custody.sessionId,f.session.sessionId);assert.equal(result.custody.destinationUserId,owner);
  assert.equal(result.custody.manifestDigest,f.inventory.manifestDigest);assert.equal(result.custody.lineageDigest,rows(f,'experience_guest_context_adoptions')[0].lineage_digest);
  assert.equal(result.custody.draftId,f.prepared.plan.draftId);assert.equal(result.custody.draftHash,f.prepared.plan.draftHash);assert.equal(result.custody.projectId,f.session.projectId);
  assert.equal(result.custody.documentId,f.session.documentId);assert.equal(result.custody.targetStreamId,`creative:${owner}`);assert.deepEqual(result.custody.eventIds,f.adopted.eventIds);assert.equal(result.custody.head,f.adopted.head);
}
function registerNativeMemory(f,contentId){const table='memory_native_answer_origins',created='2026-01-01T00:00:00.000Z',expires='2026-01-02T00:00:00.000Z';
  const row=Object.fromEntries(f.sqlite.prepare(`PRAGMA table_info(${table})`).all().filter(column=>column.notnull).map(column=>[column.name,column.type.toLowerCase()==='integer'?1:column.name.endsWith('_sha256')?'a'.repeat(64):`fixture-${column.name}`]));
  Object.assign(row,{recipe_version:'native-answer-origin-v1',actor_user_id:owner,owner_user_id:owner,project_id:f.session.projectId,document_id:f.session.documentId,
    answer_content_id:contentId,user_source_sequence:2,answer_source_sequence:3,selection_cursor:1,answer_expires_at:expires,enrolled_at:created,enrollment_expires_at:expires,
    source_retention_ceiling:expires,created_at:created,status:'active'});const keys=Object.keys(row);
  f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));}

test('canonical GET without a retained mapping is read-only and never creates a plan copy',async t=>{
  const f=await fixture(t),before=persistent(f);assert.equal(await f.read(),null);assert.deepEqual(persistent(f),before);f.unpaid();
});
test('first retention copies exact original plan bytes into a distinct canonical private key and immutable mapping',async t=>{
  const f=await fixture(t),before=persistent(f),result=await f.retain();assertResult(f,result,false);const [copy]=copies(f),[mapping]=mappings(f);
  assert.equal(copies(f).length,1);assert.equal(mappings(f).length,1);assert.notEqual(copy.content_id,f.prepared.plan.draftId);assert.equal(mapping.content_id,copy.content_id);
  assert.equal(mapping.draft_id,f.prepared.plan.draftId);assert.equal(mapping.destination_user_id,owner);assert.equal(mapping.draft_hash,f.prepared.plan.draftHash);
  assert.equal(mapping.lineage_digest,result.custody.lineageDigest);assert.equal(mapping.content_digest,await digest(canonicalJson(f.prepared.plan)));assert.equal(copy.content,canonicalJson(f.prepared.plan));
  assert.equal(copy.kind,'experience-draft');assert.equal(copy.expires_at,result.expiresAt);assert.equal(Date.parse(copy.expires_at)-Date.parse(copy.created_at),2*86400000);
  assert.ok(Date.parse(copy.expires_at)>Date.parse(f.prepared.expiresAt));assert.ok(!JSON.stringify(mapping).includes(subject));
  const after=persistent(f);for(const table of Object.keys(before))if(!['private_content','experience_guest_plan_custodies'].includes(table))assert.deepEqual(after[table],before[table],table);
  assert.deepEqual(after.private_content.find(row=>row.content_id===f.prepared.plan.draftId),before.private_content[0]);f.unpaid();
});
test('POST replay and safe GET preserve original retained expiry and never allocate or append',async t=>{
  const f=await fixture(t),first=await f.retain(),before=persistent(f);for(const next of [await f.retain(),await f.read(),await f.read(owner,{origin})]){assertResult(f,next,true);assert.equal(next.expiresAt,first.expiresAt);}
  assert.deepEqual(persistent(f),before);f.unpaid();
});
test('retained canonical copy survives original source expiry and native source retirement',async t=>{
  const f=await fixture(t,{draftLifetimeMs:600}),first=await f.retain();await expire(f);assert.equal((await retireExpiredGuestImageSource(f.env,{sessionId:f.session.sessionId})).status,'retired');
  const source=f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(f.prepared.plan.draftId);assert.equal(source.content,'');assert.ok(source.redacted_at);
  const retained=await f.read();assertResult(f,retained,true);assert.equal(retained.expiresAt,first.expiresAt);assertResult(f,await f.retain(),true);f.unpaid();
});
test('source expiry before first retention cannot be bypassed by a completed context adoption',async t=>{
  const f=await fixture(t,{draftLifetimeMs:300});await expire(f);const before=persistent(f);await assert.rejects(f.retain());assert.deepEqual(persistent(f),before);assert.equal(await f.read(),null);f.unpaid();
});
for(const damage of ['redacted','changed'])test(`${damage} original private source cannot create a first retained copy`,async t=>{
  const f=await fixture(t);f.sqlite.prepare(damage==='redacted'?"UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?":"UPDATE private_content SET content='{}' WHERE content_id=?").run(f.prepared.plan.draftId);
  const before=persistent(f);await assert.rejects(f.retain());assert.deepEqual(persistent(f),before);f.unpaid();
});
test('registered native Memory content cannot be copied as an ordinary guest source plan',async t=>{
  const f=await fixture(t,{memory:true});registerNativeMemory(f,f.prepared.plan.draftId);const before=persistent(f);await assert.rejects(f.retain());assert.deepEqual(persistent(f),before);f.unpaid();
});
test('a source with no completed canonical context adoption cannot acquire plan custody',async t=>{
  const f=await fixture(t,{adopt:false}),before=persistent(f);await assert.rejects(f.retain());assert.equal(await f.read(),null);assert.deepEqual(persistent(f),before);f.unpaid();
});
test('GET same-origin policy rejects foreign origin, cross-site fetches and foreign request URLs',async t=>{
  const f=await fixture(t);await f.retain();const before=persistent(f);
  for(const req of [get(owner,{origin:'https://other.invalid'}),get(owner,{'sec-fetch-site':'cross-site'}),new Request('https://other.invalid/plan',{headers:headers()})])
    await assert.rejects(readGuestContextPlan(req,f.env,{draftId:f.prepared.plan.draftId}));
  assert.deepEqual(persistent(f),before);f.unpaid();
});
test('retention keeps POST origin checks and original public adoption reader does not gain GET authority',async t=>{
  const f=await fixture(t);for(const req of [get(),post(owner,{origin:'https://other.invalid'}),new Request(`${origin}/plan`,{method:'POST',headers:headers()})])await assert.rejects(retainGuestContextPlan(req,f.env,{sessionId:f.session.sessionId}));
  await assert.rejects(readGuestContextAdoption(get(),f.env,{sessionId:f.session.sessionId}));assert.ok(await readGuestContextAdoption(post(),f.env,{sessionId:f.session.sessionId}));assert.equal(mappings(f).length,0);f.unpaid();
});
test('canonical adoption witness is opaque, immutable and bound to its actual database',async t=>{
  const f=await fixture(t),witness=await inspectGuestContextAdoption(get(),f.env,{sessionId:f.session.sessionId});assert.ok(Object.isFrozen(witness));assert.ok(guestContextAdoptionData(f.env,witness));
  for(const fake of [{},structuredClone(witness),{...witness}])assert.throws(()=>guestContextAdoptionData(f.env,fake));
  f.env.DB={...f.DB};assert.throws(()=>guestContextAdoptionData(f.env,witness),/database_changed/);f.env.DB=f.DB;f.unpaid();
});
test('anonymous, nonexistent and another canonical destination cannot read or acquire this plan',async t=>{
  const f=await fixture(t);await f.retain();const before=persistent(f);
  for(const actor of [null,'nonexistent','other']){await assert.rejects(f.retain(actor));await assert.rejects(f.read(actor));}
  assert.deepEqual(persistent(f),before);f.unpaid();
});
test('workspace and impersonation cookies cannot turn personal plan custody into effective-account access',async t=>{
  const f=await fixture(t);await f.retain();const before=persistent(f);for(const cookie of ['forma_project_context=stale','forma_impersonation=stale']){
    await assert.rejects(f.retain(owner,{cookie}));await assert.rejects(f.read(owner,{cookie}));}
  assert.deepEqual(persistent(f),before);f.unpaid();
});
test('current destination consent and role are required for both first retention and later reads',async t=>{
  for(const stage of ['first','read'])for(const mutation of ["UPDATE users SET consent_version=NULL WHERE user_id='owner'","UPDATE users SET role='viewer' WHERE user_id='owner'"]){const f=await fixture(t);if(stage==='read')await f.retain();f.sqlite.exec(mutation);
    const before=persistent(f),money=financial(f);await assert.rejects(stage==='first'?f.retain():f.read());assert.deepEqual(persistent(f),before);assert.deepEqual(financial(f),money);}
});
for(const type of ['DocumentRemoved','ProjectRemoved'])test(`current ${type} denies copying and reading without recreating a baseline`,async t=>{
  for(const retained of [false,true]){const f=await fixture(t);if(retained)await f.retain();await appendAuditEvent(f.env,`creative:${owner}`,'user',type,{project_id:f.session.projectId,document_id:f.session.documentId});
    const before=persistent(f);await assert.rejects(f.retain());if(retained)await assert.rejects(f.read());assert.deepEqual(persistent(f),before);f.unpaid();}
});
test('organization custody changes deny both existing canonical plan reads and retention replay',async t=>{
  const f=await fixture(t);await f.retain();f.sqlite.prepare('INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)').run('scope',f.session.projectId,'org','native-owner','active','time','time');
  const before=persistent(f);await assert.rejects(f.read());await assert.rejects(f.retain());assert.deepEqual(persistent(f),before);f.unpaid();
});
for(const damage of ['redacted','expired','changed','owner'])test(`${damage==='expired'?'inconsistent expiry metadata on':damage} canonical retained copy fails closed and is never replaced`,async t=>{
  const f=await fixture(t);await f.retain();const id=copies(f)[0].content_id,updates={redacted:"content='',redacted_at='2026-01-01T00:00:00.000Z'",expired:"expires_at='2026-01-01T00:00:00.000Z'",changed:"content='{}'",owner:"owner_id='other'"};
  f.sqlite.prepare(`UPDATE private_content SET ${updates[damage]} WHERE content_id=?`).run(id);const before=persistent(f);await assert.rejects(f.read());await assert.rejects(f.retain());assert.deepEqual(persistent(f),before);f.unpaid();
});
test('a colliding retained key is not adopted, overwritten or associated with a mapping',async t=>{
  const f=await fixture(t),batch=f.DB.batch;let hit=false,collision;
  f.DB.batch=async statements=>{if(!hit&&custodyBatch(statements)){hit=true;const statement=statements.find(statement=>statement.sql.startsWith('INSERT INTO private_content'));
    assert.ok(statement);collision=statement.bindings[0];f.sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)').run(collision,'other','experience-draft','unrelated private bytes','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z');}return batch.call(f.DB,statements);};
  await assert.rejects(f.retain());f.DB.batch=batch;assert.equal(hit,true);assert.equal(mappings(f).length,0);assert.equal(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(collision).content,'unrelated private bytes');f.unpaid();
});
test('concurrent retention produces one independent private copy and one immutable mapping',async t=>{
  const f=await fixture(t),results=await Promise.all([f.retain(),f.retain()]);assert.deepEqual(results[0].plan,results[1].plan);assert.equal(results[0].expiresAt,results[1].expiresAt);
  assert.equal(copies(f).length,1);assert.equal(mappings(f).length,1);f.unpaid();
});
test('lost or invalid acknowledgments recover exact once-only custody from committed native rows',async t=>{
  for(const kind of ['lost','truncated','false']){const f=await fixture(t),done=afterBatch(f,result=>{if(kind==='lost')throw Error('lost ack');if(kind==='truncated')return result.slice(0,-1);return result.map((row,index)=>index?row:{...row,success:false});});
    const result=await f.retain();done();assertResult(f,result,true);assert.equal(mappings(f).length,1);assert.equal(copies(f).length,1);f.unpaid();}
});
test('late native source and destination failures roll back private copy and mapping atomically',async t=>{
  for(const mutation of [f=>f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId),
    f=>f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'")]){const f=await fixture(t),before=persistent(f),money=financial(f),done=beforeStatement(f,sql=>sql.startsWith('INSERT INTO private_content'),()=>mutation(f));
    await assert.rejects(f.retain());done();assert.deepEqual(persistent(f),before);assert.deepEqual(financial(f),money);}
});
test('post-copy source damage inside the same transaction prevents publishing a custody mapping',async t=>{
  const f=await fixture(t),before=persistent(f),done=beforeStatement(f,sql=>sql.startsWith('INSERT INTO experience_guest_plan_custodies'),()=>f.sqlite.prepare("UPDATE private_content SET content='{}' WHERE content_id=?").run(f.prepared.plan.draftId));
  await assert.rejects(f.retain());done();assert.deepEqual(persistent(f),before);f.unpaid();
});
test('post-commit destination revocation denies disclosure while leaving one committed copy',async t=>{
  const f=await fixture(t),done=afterBatch(f,result=>{f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'");return result;});await assert.rejects(f.retain());done();
  assert.equal(mappings(f).length,1);assert.equal(copies(f).length,1);const before=persistent(f);await assert.rejects(f.read());assert.deepEqual(persistent(f),before);
});
test('database replacement after native copy commit denies disclosure on the replacement binding',async t=>{
  const f=await fixture(t),done=afterBatch(f,result=>{f.env.DB={...f.DB};return result;});await assert.rejects(f.retain(),/database_changed/);done();assert.equal(mappings(f).length,1);
  f.env.DB=f.DB;assertResult(f,await f.read(),true);assert.equal(copies(f).length,1);f.unpaid();
});
for(const memory of [false,true])test(`full retention and read SQL fit D1 parser limits with ${memory?'complete':'absent'} Memory schema`,async t=>{
  const f=await fixture(t,{memory}),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{assertResult(f,await f.retain(),false);assertResult(f,await f.read(),true);assertResult(f,await f.retain(),true);limits.assertVerified();
    t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}f.unpaid();
});
test('immutable mapping refuses reassignment, replacement and deletion',async t=>{
  const f=await fixture(t);await f.retain();const before=persistent(f);for(const sql of ["UPDATE experience_guest_plan_custodies SET destination_user_id='other'",
    "UPDATE experience_guest_plan_custodies SET content_id='other'",'DELETE FROM experience_guest_plan_custodies','INSERT OR REPLACE INTO experience_guest_plan_custodies SELECT * FROM experience_guest_plan_custodies'])assert.throws(()=>f.sqlite.exec(sql),/immutable|exists/);
  assert.deepEqual(persistent(f),before);assertResult(f,await f.read(),true);f.unpaid();
});
test('registered native Memory retained copy is not exposed through ordinary plan custody',async t=>{
  const f=await fixture(t,{memory:true});await f.retain();registerNativeMemory(f,copies(f)[0].content_id);const before=persistent(f);await assert.rejects(f.read());await assert.rejects(f.retain());assert.deepEqual(persistent(f),before);f.unpaid();
});

for(const phase of ['read','retain-replay','retain-first','lost-ack'])test(`database replacement at the outer ${phase} settlement denies disclosure`,async t=>{
  const f=await fixture(t);if(phase==='read'||phase==='retain-replay')await f.retain();
  const batch=f.DB.batch;if(phase==='lost-ack'){let lost=false;f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(!lost&&custodyBatch(statements)){lost=true;throw Error('lost acknowledgment');}return result;};}
  const prepare=f.DB.prepare;let hit=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings),first=bound.first;
    bound.first=async function(){const result=await first.call(this);if(!hit&&sql.startsWith('SELECT 1 WHERE')&&sql.includes('experience_guest_plan_custodies mapping JOIN private_content')){
      hit=true;queueMicrotask(()=>queueMicrotask(()=>{f.env.DB={...f.DB};}));}return result;};return bound;};return statement;};
  await assert.rejects(phase==='read'?f.read():f.retain(),/database_changed/);assert.equal(hit,true);f.DB.prepare=prepare;f.DB.batch=batch;f.env.DB=f.DB;
  assert.equal(mappings(f).length,1);assert.equal(copies(f).length,1);f.unpaid();
});

test('absent dormant mapping schema makes GET return null without installing anything',async t=>{
  const f=await fixture(t);f.sqlite.exec('DROP TABLE experience_guest_plan_custodies');
  const snapshot=()=>({schema:f.sqlite.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name,type").all(),private:rows(f,'private_content'),events:rows(f,'events')});
  const before=snapshot();assert.equal(await f.read(),null);assert.deepEqual(snapshot(),before);f.unpaid();
});
for(const scope of ['resource','retention'])test(`content ${scope} custody excludes original source and retained copy`,async t=>{
  for(const retained of [false,true]){const f=await fixture(t);if(retained)await f.retain();const id=retained?copies(f)[0].content_id:f.prepared.plan.draftId;
    if(scope==='resource')f.sqlite.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?,?,?)').run('access','content',id,'organization',f.session.projectId,'other','collaborative_output',null,'other','2026-01-01T00:00:00.000Z');
    else f.sqlite.prepare('INSERT INTO private_content_retention_scopes VALUES(?,?,?,?,?,?,?,?,?)').run(id,'organization','access',f.session.projectId,'other','test',1,'2099-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    const before=persistent(f);await assert.rejects(f.retain());if(retained)await assert.rejects(f.read());assert.deepEqual(persistent(f),before);f.unpaid();}
});
test('native optional cleanup retires expired ordinary canonical content and preserves registered Memory content',async t=>{
  const f=await fixture(t,{memory:true}),created='2026-01-01T00:00:00.000Z',expires='2026-01-02T00:00:00.000Z';
  for(const [id,kind,text] of [['ordinary-expired','prompt','ordinary expired body'],['memory-expired','experience-draft','registered retyped Memory body']])
    f.sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)').run(id,owner,kind,text,created,expires);
  registerNativeMemory(f,'memory-expired');const protectedBefore=f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get('memory-expired');
  assertResult(f,await f.retain(),false);const cleaned=f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get('ordinary-expired');assert.equal(cleaned.content,'');assert.ok(cleaned.redacted_at);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get('memory-expired'),protectedBefore);f.unpaid();
});
test('native Memory registration racing copy insertion rolls back the entire custody transaction',async t=>{
  const f=await fixture(t,{memory:true}),before=persistent(f),done=beforeStatement(f,sql=>sql.startsWith('INSERT INTO private_content'),()=>registerNativeMemory(f,f.prepared.plan.draftId));
  await assert.rejects(f.retain());done();assert.deepEqual(persistent(f),before);assert.equal(rows(f,'memory_native_answer_origins').length,0);f.unpaid();
});
test('native public Memory provenance marker excludes a retained body from ordinary plan reads',async t=>{
  const f=await fixture(t);await f.retain();await appendAuditEvent(f.env,'creative:memory-marker-fixture','worker:memory','AssistantReasoned',{content_ref:copies(f)[0].content_id,memory_origin_version:1});
  const before=persistent(f);await assert.rejects(f.read());await assert.rejects(f.retain());assert.deepEqual(persistent(f),before);f.unpaid();
});
test('closed retention and read inputs cannot supply substitute plans, copies or extra authority',async t=>{
  const f=await fixture(t),before=persistent(f);
  for(const input of [{sessionId:f.session.sessionId,plan:f.prepared.plan},{sessionId:f.session.sessionId,contentId:'other'},{}])await assert.rejects(retainGuestContextPlan(post(),f.env,input));
  for(const input of [{draftId:f.prepared.plan.draftId,ownerId:owner},{draftId:'not-a-draft'},{}])await assert.rejects(readGuestContextPlan(get(),f.env,input));
  await assert.rejects(readGuestContextPlan(post(),f.env,{draftId:f.prepared.plan.draftId}));assert.deepEqual(persistent(f),before);f.unpaid();
});

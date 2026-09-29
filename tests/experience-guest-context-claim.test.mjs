import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},
  {GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{claimGuestContext},
  {registeredExperience,initialValues},{canonicalJson,digest},{appendAuditEvent}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'),import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-plan-custody.ts'),import('../worker/experience-guest-context-claim.ts'),import('../src/experiences/intake.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/runtime.ts')]);
const origin='https://guest.example.invalid',owner='owner',subject='A blue heron on a stone bridge';
const headers=(actor=owner,extra={})=>({...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...extra});
const post=(actor=owner,extra={})=>new Request(`${origin}/unregistered-context-claim`,{method:'POST',headers:headers(actor,{origin,...extra})});
const proof=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const mappings=f=>rows(f,'experience_guest_plan_custodies');
const copies=f=>f.sqlite.prepare("SELECT * FROM private_content WHERE owner_id=? AND kind='experience-draft' ORDER BY content_id").all(owner);
const persistent=f=>Object.fromEntries(['private_content','experience_guest_plan_custodies','events','event_private_payloads','event_client_receipts',
  'experience_guest_sources','experience_guest_source_commits','experience_guest_context_adoptions','experience_guest_sessions','experience_guest_claim_leases']
  .map(table=>[table,rows(f,table)]));
const financial=f=>Object.fromEntries(['users','budget_counters','cost_budget_counters','budget_reservations','cost_budget_reservations','document_jobs',
  'output_execution_grants','output_operation_slots','output_provider_calls'].map(table=>[table,rows(f,table)]));
const adoptionBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO experience_guest_context_adoptions'));
const retentionBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO experience_guest_plan_custodies'));
const withoutProof=f=>({sessionId:f.input.sessionId,requestId:f.input.requestId,approvedManifestDigest:f.input.approvedManifestDigest});
async function fixture(t,{memory=false,draftLifetimeMs=120000}={}){
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
  const inventory=await inspectGuestContextInventory(post(null),f.env,{proof:proof(session)});
  const input={sessionId:session.sessionId,requestId:'request-1',approvedManifestDigest:inventory.manifestDigest,proof:proof(session)};
  const finances=financial(f);return {...f,session,prepared,source,inventory,input,
    claim:(actor=owner,value=input,request=post(actor))=>claimGuestContext(request,f.env,value),
    unpaid:()=>assert.deepEqual(financial(f),finances)};
}

function statementHook(f,predicate,action,{method='first',after=true}={}){
  const prepare=f.DB.prepare;let hits=0;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...bindings){const bound=bind.call(this,...bindings),original=bound[method];
      bound[method]=async function(){if(!hits&&predicate(sql,bindings)){hits++;if(!after)action();const result=await original.call(this);if(after)action();return result;}return original.call(this);};return bound;};return statement;};
  return()=>{f.DB.prepare=prepare;assert.equal(hits,1,'native statement hook executed once');};
}
function batchHook(f,select,action){
  const batch=f.DB.batch;let attempts=0;
  f.DB.batch=async statements=>{if(select(statements)){attempts++;const result=await batch.call(f.DB,statements);return attempts===1?action(result):result;}return batch.call(f.DB,statements);};
  return()=>{f.DB.batch=batch;assert.equal(attempts,1,'exactly one selected mutation batch was attempted');};
}
function assertClaim(f,result,{retained=true,replayed=false}={}){
  assert.equal(result.version,1);assert.equal(result.status,'context-claimed');assert.equal(result.contextCustodyTransferred,true);
  assert.equal(result.generationAvailable,false);assert.equal(result.miniAppClaimComplete,false);assert.ok(Object.isFrozen(result));
  assert.equal(result.receipt.status,'context-adopted');assert.equal(result.receipt.sessionId,f.session.sessionId);
  assert.equal(result.receipt.requestId,f.input.requestId);assert.equal(result.receipt.manifestDigest,f.inventory.manifestDigest);
  assert.equal(result.receipt.destinationUserId,owner);assert.equal(result.receipt.projectId,f.session.projectId);assert.equal(result.receipt.documentId,f.session.documentId);
  assert.equal(result.receipt.replayed,true,'receipt is a fresh canonical reread, not the first-write acknowledgment');
  assert.equal(result.planRetention,retained?'retained':'unavailable');
  if(retained){assert.deepEqual(result.retained.plan,f.prepared.plan);assert.equal(result.retained.replayed,replayed);
    assert.equal(result.retained.generationAvailable,false);assert.equal(result.retained.miniAppClaimComplete,false);
    for(const key of ['sessionId','destinationUserId','manifestDigest','projectId','documentId','head'])assert.equal(result.retained.custody[key],result.receipt[key],key);
    assert.equal(result.retained.custody.lineageDigest,rows(f,'experience_guest_context_adoptions')[0].lineage_digest);assert.deepEqual(result.retained.custody.eventIds,result.receipt.eventIds);
  }else{assert.equal(Object.hasOwn(result,'retained'),false);assert.equal(Object.hasOwn(result,'plan'),false);
    for(const secret of [subject,f.prepared.plan.draftHash,f.session.sessionToken,f.session.claimToken])assert.ok(!JSON.stringify(result).includes(secret),'partial response excludes private plan and raw credentials');}
  assert.equal(rows(f,'experience_guest_context_adoptions').length,1);assert.equal(rows(f,'experience_guest_claim_leases').length,1);
  assert.equal(rows(f,'experience_guest_claim_leases')[0].acquisitions,1);
}

for(const memory of [false,true])test(`entire claim and proofless replay fit strict D1 limits with ${memory?'complete':'absent'} Memory schema`,async t=>{
  const f=await fixture(t,{memory}),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{assertClaim(f,await f.claim());assertClaim(f,await f.claim(owner,withoutProof(f)),{replayed:true});limits.assertVerified();
    t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}f.unpaid();
});
test('native claim preserves source history and finances while adding canonical context and an independent exact plan copy',async t=>{
  const f=await fixture(t),before=persistent(f),result=await f.claim();assertClaim(f,result);const after=persistent(f),[mapping]=mappings(f),[copy]=copies(f);
  assert.equal(mappings(f).length,1);assert.equal(copies(f).length,1);assert.notEqual(copy.content_id,f.prepared.plan.draftId);assert.equal(copy.content,canonicalJson(f.prepared.plan));assert.equal(mapping.content_id,copy.content_id);
  for(const table of ['experience_guest_sources','experience_guest_source_commits'])assert.deepEqual(after[table],before[table],table);
  for(const table of ['events','event_private_payloads','event_client_receipts','private_content'])for(const old of before[table])assert.ok(after[table].some(row=>JSON.stringify(row)===JSON.stringify(old)),`${table} retains exact original row`);
  assert.deepEqual({...after.experience_guest_sessions[0],revoked_at_ms:null},{...before.experience_guest_sessions[0]});
  assert.equal(after.experience_guest_sessions[0].revoked_at_ms,after.experience_guest_context_adoptions[0].created_at_ms);
  const events=after.events.filter(row=>row.stream_id===`creative:${owner}`);assert.equal(events.length,result.receipt.eventIds.length);assert.ok(events.every(row=>row.actor==='user'));
  for(const id of result.receipt.eventIds)assert.equal(after.event_private_payloads.find(row=>row.private_event_id===id).owner_id,owner);
  f.unpaid();
});
test('completed canonical recovery omits guest proof and remains read-only without another lease or adoption',async t=>{
  const f=await fixture(t);await f.claim();const before=persistent(f),batch=f.DB.batch,prepare=f.DB.prepare;
  f.DB.batch=async statements=>{assert.ok(statements.every(statement=>/^SELECT/u.test(statement.sql)),'read-only native inspection batch');return batch.call(f.DB,statements);};f.DB.prepare=function(sql){assert.ok(!/^(?:INSERT|UPDATE|DELETE|CREATE)/u.test(sql),'completed recovery is read-only');return prepare.call(this,sql);};
  assertClaim(f,await f.claim(owner,withoutProof(f)),{replayed:true});f.DB.batch=batch;f.DB.prepare=prepare;assert.deepEqual(persistent(f),before);f.unpaid();
});
test('exact request and approved manifest conflicts never reuse a completed receipt or mutate history',async t=>{
  const f=await fixture(t);await f.claim();const before=persistent(f);
  for(const input of [{...withoutProof(f),requestId:'request-2'},{...withoutProof(f),approvedManifestDigest:`sha256:${'0'.repeat(64)}`}])await assert.rejects(f.claim(owner,input),/claim_conflict/);
  assert.deepEqual(persistent(f),before);f.unpaid();
});
test('unapproved current inventory is rejected before lease acquisition and can be explicitly corrected',async t=>{
  const f=await fixture(t),before=persistent(f);await assert.rejects(f.claim(owner,{...f.input,approvedManifestDigest:`sha256:${'0'.repeat(64)}`}),/claim_conflict/);
  assert.deepEqual(persistent(f),before);assertClaim(f,await f.claim());f.unpaid();
});
test('closed input and purpose-bound proof validation apply even after canonical completion',async t=>{
  const f=await fixture(t);for(const completed of [false,true]){if(completed)await f.claim();const before=persistent(f);
    for(const input of [{...f.input,extra:true},{...f.input,proof:{...f.input.proof,extra:true}},{...f.input,proof:{...f.input.proof,sessionId:'other-session'}},
      {...f.input,proof:{...f.input.proof,claimToken:f.input.proof.sessionToken}},{...f.input,proof:undefined},{...f.input,requestId:''}])await assert.rejects(f.claim(owner,input),/claim_invalid/);
    assert.deepEqual(persistent(f),before);
  }f.unpaid();
});
test('a missing proof cannot begin custody and cannot bootstrap a new canonical identity',async t=>{
  const f=await fixture(t),before=persistent(f);await assert.rejects(f.claim(owner,withoutProof(f)),/proof_unavailable/);
  for(const actor of [null,'unknown'])await assert.rejects(f.claim(actor));assert.deepEqual(persistent(f),before);f.unpaid();
});
test('lost lease acknowledgment recovers the exact recorded lease without a second mutation',async t=>{
  const f=await fixture(t),done=batchHook(f,statements=>statements.some(statement=>statement.sql.startsWith('INSERT INTO experience_guest_claim_leases')),()=>{throw Error('lost lease acknowledgment');});
  assertClaim(f,await f.claim());done();assert.equal(rows(f,'experience_guest_claim_leases').length,1);assert.equal(rows(f,'experience_guest_context_adoptions').length,1);assert.equal(mappings(f).length,1);
  const before=persistent(f);assertClaim(f,await f.claim(),{replayed:true});assert.deepEqual(persistent(f),before);f.unpaid();
});
for(const phase of ['adoption','retention'])test(`lost ${phase} acknowledgment uses native once-only recovery without a second mutation`,async t=>{
  const f=await fixture(t),select=phase==='adoption'?adoptionBatch:retentionBatch,done=batchHook(f,select,()=>{throw Error('lost acknowledgment');});
  const result=await f.claim();done();assertClaim(f,result,{replayed:phase==='retention'});assert.equal(mappings(f).length,1);assert.equal(copies(f).length,1);f.unpaid();
});
test('late plan-copy transaction rollback returns source-free completed context, and explicit proofless retry retains it',async t=>{
  const f=await fixture(t),prepare=f.DB.prepare;let hit=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;
    bound.execute=function(kind){if(!hit&&sql.startsWith('INSERT INTO experience_guest_plan_custodies')){hit=true;throw Error('late retained mapping failure');}return execute.call(this,kind);};return bound;};return statement;};
  const result=await f.claim();f.DB.prepare=prepare;assert.equal(hit,true);assertClaim(f,result,{retained:false});assert.equal(mappings(f).length,0);assert.equal(copies(f).length,0);
  const context=rows(f,'experience_guest_context_adoptions'),events=rows(f,'events');assertClaim(f,await f.claim(owner,withoutProof(f)));assert.deepEqual(rows(f,'experience_guest_context_adoptions'),context);assert.deepEqual(rows(f,'events'),events);f.unpaid();
});
test('source redaction after completed adoption returns no plan while preserving the committed context',async t=>{
  const f=await fixture(t),done=batchHook(f,adoptionBatch,result=>{f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId);return result;});
  const result=await f.claim();done();assertClaim(f,result,{retained:false});assert.equal(mappings(f).length,0);assert.equal(copies(f).length,0);f.unpaid();
});
for(const revocation of ['consent','document'])test(`retention failure cannot launder current ${revocation} revocation into a partial success`,async t=>{
  const f=await fixture(t),batch=f.DB.batch;let hit=false;
  f.DB.batch=async statements=>{if(!hit&&retentionBatch(statements)){hit=true;if(revocation==='consent')f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'");else await appendAuditEvent(f.env,`creative:${owner}`,'user','DocumentRemoved',{project_id:f.session.projectId,document_id:f.session.documentId});throw Error('copy unavailable after revocation');}return batch.call(f.DB,statements);};
  await assert.rejects(f.claim());f.DB.batch=batch;assert.equal(hit,true);assert.equal(rows(f,'experience_guest_context_adoptions').length,1);assert.equal(mappings(f).length,0);assert.equal(copies(f).length,0);
  const before=persistent(f);await assert.rejects(f.claim(owner,withoutProof(f)));assert.deepEqual(persistent(f),before);
});
test('request method, same-origin envelope and pre-aborted signal are enforced before any mutation',async t=>{
  const f=await fixture(t),before=persistent(f),controller=new AbortController();controller.abort();
  const requests=[new Request(`${origin}/claim`,{headers:headers(owner,{origin})}),post(owner,{origin:'https://foreign.invalid'}),post(owner,{'sec-fetch-site':'cross-site'}),
    new Request(`${origin}/claim?x=1`,{method:'POST',headers:headers(owner,{origin})}),new Request('http://guest.example.invalid/claim',{method:'POST',headers:headers(owner,{origin:'http://guest.example.invalid'})}),
    new Request(`${origin}/claim`,{method:'POST',headers:headers(owner,{origin}),signal:controller.signal})];
  for(const request of requests)await assert.rejects(f.claim(owner,f.input,request));assert.deepEqual(persistent(f),before);f.unpaid();
});
for(const boundary of ['lease','adoption','retention'])for(const damage of ['database','abort'])test(`${damage} change after ${boundary} settlement prevents subsequent disclosure or mutation`,async t=>{
  const f=await fixture(t),controller=new AbortController(),request=new Request(post(),{signal:controller.signal}),action=()=>{if(damage==='database')f.env.DB={...f.DB};else controller.abort();};
  const done=boundary==='lease'?batchHook(f,statements=>statements.some(statement=>statement.sql.startsWith('INSERT INTO experience_guest_claim_leases')),result=>{action();return result;}):batchHook(f,boundary==='adoption'?adoptionBatch:retentionBatch,result=>{action();return result;});
  await assert.rejects(f.claim(owner,f.input,request),damage==='database'?/database_changed/:/claim_aborted/);done();f.env.DB=f.DB;
  assert.equal(rows(f,'experience_guest_context_adoptions').length,boundary==='lease'?0:1);assert.equal(mappings(f).length,boundary==='retention'?1:0);assert.equal(copies(f).length,boundary==='retention'?1:0);
  assertClaim(f,await f.claim(owner,boundary==='lease'?f.input:withoutProof(f)),{replayed:boundary==='retention'});f.unpaid();
});
test('caller input and nested proof are captured before the first awaited read',async t=>{
  const f=await fixture(t),original=structuredClone(f.input),done=statementHook(f,sql=>sql.includes('FROM experience_guest_context_adoptions'),()=>{
    f.input.requestId='changed-request';f.input.approvedManifestDigest=`sha256:${'0'.repeat(64)}`;f.input.proof.claimToken=f.input.proof.sessionToken;
  });
  const result=await f.claim();done();f.input=original;assertClaim(f,result);assert.equal(rows(f,'experience_guest_claim_leases')[0].request_id,original.requestId);f.unpaid();
});
test('concurrent identical intents converge on one canonical baseline and one plan copy',async t=>{
  const f=await fixture(t),results=await Promise.all([f.claim(),f.claim()]);for(const result of results)assertClaim(f,result,{replayed:result.retained.replayed});
  assert.deepEqual(results[0].receipt,results[1].receipt);assert.equal(mappings(f).length,1);assert.equal(copies(f).length,1);f.unpaid();
});
test('competing canonical actors cannot both acquire the same guest context',async t=>{
  const f=await fixture(t),results=await Promise.allSettled([f.claim(),f.claim('other')]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const winner=results.find(result=>result.status==='fulfilled').value;assert.equal(winner.status,'context-claimed');assert.equal(winner.planRetention,'retained');assert.equal(mappings(f).length,1);
  const destination=rows(f,'experience_guest_claim_leases')[0].destination_user_id;assert.equal(winner.receipt.destinationUserId,destination);
  assert.equal(rows(f,'experience_guest_context_adoptions')[0].destination_user_id,destination);assert.equal(mappings(f)[0].destination_user_id,destination);
  const loser=destination===owner?'other':owner;assert.equal(rows(f,'events').filter(row=>row.stream_id===`creative:${loser}`).length,0);
  assert.equal(rows(f,'event_private_payloads').filter(row=>row.owner_id===loser).length,0);assert.equal(rows(f,'private_content').filter(row=>row.owner_id===loser).length,0);
  const target=rows(f,'events').filter(row=>row.stream_id===`creative:${destination}`);assert.deepEqual(target.map(row=>row.event_id),winner.receipt.eventIds);
  for(const id of winner.receipt.eventIds)assert.equal(rows(f,'event_private_payloads').find(row=>row.private_event_id===id).owner_id,destination);f.unpaid();
});
test('missing dormant schema fails closed without installing tables or a canonical account',async t=>{
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());const schema=()=>f.sqlite.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(),before=schema();
  await assert.rejects(claimGuestContext(post(),f.env,{sessionId:'missing',requestId:'request',approvedManifestDigest:`sha256:${'0'.repeat(64)}`}));assert.deepEqual(schema(),before);
});

test('final retained private-proof failure returns only authorized context and never replaces the committed damaged copy',async t=>{
  const f=await fixture(t),done=statementHook(f,sql=>sql.startsWith('SELECT 1 WHERE')&&sql.includes('experience_guest_plan_custodies mapping JOIN private_content'),()=>{
    const [copy]=copies(f);assert.ok(copy);f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(copy.content_id);
  },{after:false});
  const result=await f.claim();done();assertClaim(f,result,{retained:false});assert.equal(mappings(f).length,1);assert.equal(copies(f).length,1);
  const before=persistent(f);assertClaim(f,await f.claim(owner,withoutProof(f)),{retained:false});assert.deepEqual(persistent(f),before);f.unpaid();
});
test('abort after final retained private proof prevents disclosure while preserving explicit recovery',async t=>{
  const f=await fixture(t),controller=new AbortController(),request=new Request(post(),{signal:controller.signal});
  const done=statementHook(f,sql=>sql.startsWith('SELECT 1 WHERE')&&sql.includes('experience_guest_plan_custodies mapping JOIN private_content'),()=>controller.abort());
  await assert.rejects(f.claim(owner,f.input,request),/claim_aborted/);done();assert.equal(mappings(f).length,1);assert.equal(copies(f).length,1);
  assertClaim(f,await f.claim(owner,withoutProof(f)),{replayed:true});f.unpaid();
});

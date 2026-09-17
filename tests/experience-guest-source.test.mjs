import assert from 'node:assert/strict';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [{ensureSchema,readWorkspaceEvents},{GUEST_CUSTODY_SCHEMA,issueGuestClaimSession,readGuestCustodyTerms,guestTokenHash},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},
  {registeredExperience,initialValues},{canonicalJson,digest},{foldEvents}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../src/model/events.ts')]);
const origin='https://guest.example.invalid',request=()=>new Request(`${origin}/unregistered-source`,{method:'POST',headers:{origin}});
const proof=s=>({sessionId:s.sessionId,sessionToken:s.sessionToken,claimToken:s.claimToken});
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
async function fixture(t,{sourceChanges={},guestChanges={}}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA])f.sqlite.exec(sql);
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:Date.now()-60000,expiresAtMs:Date.now()+600000,
    sessionLifetimeMs:300000,leaseLifetimeMs:60000,maximumSessions:5,maximumLeaseAcquisitions:2,...guestChanges});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(request(),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:'A blue heron on a stone bridge',provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const policy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,
    maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs:120000,...sourceChanges});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(policy.policyId,await digest(policy),canonicalJson(policy),`sha256:${'c'.repeat(64)}`);
  const input={proof:proof(session),policyId:policy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}};
  t.mock.method(globalThis,'fetch',()=>{throw Error('network forbidden');});
  for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{throw Error('media forbidden');});
  const unpaid=()=>{for(const table of ['users','document_jobs','budget_reservations','cost_budget_reservations','output_execution_grants','output_provider_calls'])assert.equal(count(f,table),0,table);};
  return {...f,session,terms,policy,input,unpaid,prepare:(changed=input)=>prepareGuestImageSource(request(),f.env,changed),
    commit:draftHash=>commitGuestImageSource(request(),f.env,{proof:proof(session),draftHash})};
}
function before(f,predicate,action){const prepare=f.DB.prepare;let ran=false;
  f.DB.prepare=function(sql){const stmt=prepare.call(this,sql),bind=stmt.bind;stmt.bind=function(...args){const bound=bind.call(this,...args),execute=bound.execute;
    bound.execute=function(kind){if(!ran&&predicate(sql)){ran=true;action(sql,args);}return execute.call(this,kind);};return bound;};return stmt;};
  return()=>{f.DB.prepare=prepare;assert.equal(ran,true);};}

test('guest source policy is explicit, closed, frozen and contains no generation or payer allowance',()=>{
  const raw={version:1,policyId:'p',sessionPolicyId:'s',sessionTermsDigest:`sha256:${'a'.repeat(64)}`,releaseHash:`sha256:${'b'.repeat(64)}`,
    maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs:1000};assert.ok(Object.isFrozen(readGuestSourcePolicy(raw)));
  for(const bad of [undefined,{}, {...raw,provider:'fal'}, {...raw,maximumDraftBytes:65537},{...raw,maximumEventBytes:0},{...raw,maximumEvents:17},{...raw,draftLifetimeMs:604800001}])assert.throws(()=>readGuestSourcePolicy(bad),/source_policy_invalid/);
});
test('actual guest prepare persists one native private draft without user or canonical events, then commits native source once',async t=>{
  const f=await fixture(t),saved=await f.prepare();assert.equal(saved.status,'prepared');assert.equal(saved.replayed,false);
  assert.equal(count(f,'events'),0);assert.equal(count(f,'private_content'),1);f.unpaid();
  const body=f.sqlite.prepare('SELECT * FROM private_content').get();assert.equal(body.owner_id,f.session.guestSubject);assert.equal(body.kind,'experience-draft');
  assert.ok(Date.parse(body.expires_at)<=f.session.expiresAtMs);assert.equal(body.content,canonicalJson(saved.plan));
  const receipt=f.sqlite.prepare('SELECT * FROM experience_guest_sources').get();assert.ok(!JSON.stringify(receipt).includes('blue heron'));
  const commit=await f.commit(saved.plan.draftHash);assert.equal(commit.status,'complete');assert.equal(commit.custodyTransferred,false);
  assert.equal(commit.documentId,f.session.documentId);assert.equal(count(f,'event_client_receipts'),saved.plan.events.length);
  const events=await readWorkspaceEvents(f.env,`creative:${f.session.guestSubject}`),projection=foldEvents(events,Infinity,f.session.documentId,f.session.projectId);
  assert.equal(projection.documentId,f.session.documentId);assert.ok(projection.libraryBlocks.some(b=>b.properties.text==='A blue heron on a stone bridge'));
  assert.ok(f.sqlite.prepare('SELECT actor FROM events').all().every(e=>e.actor===f.session.guestSubject));
  assert.ok(!f.sqlite.prepare('SELECT payload FROM events').all().some(e=>e.payload.includes('blue heron')));f.unpaid();
});
test('exact prepare and commit retries preserve IDs, original bytes, expiry and one source receipt',async t=>{
  const f=await fixture(t),a=await f.prepare(),b=await f.prepare();assert.deepEqual(a.plan,b.plan);assert.equal(b.replayed,true);assert.equal(a.expiresAt,b.expiresAt);
  const first=await f.commit(a.plan.draftHash),again=await f.commit(a.plan.draftHash);assert.deepEqual({...again,replayed:false},first);
  assert.equal(count(f,'experience_guest_sources'),1);assert.equal(count(f,'experience_guest_source_commits'),1);assert.equal(count(f,'events'),a.plan.events.length);f.unpaid();
});
test('changed input under the same native guest intent conflicts without replacing private source',async t=>{
  const f=await fixture(t),saved=await f.prepare(),changed=structuredClone(f.input);changed.request.values.subject.value='Changed input';
  await assert.rejects(f.prepare(changed),/source_conflict/);assert.equal(f.sqlite.prepare('SELECT content FROM private_content').get().content,canonicalJson(saved.plan));
});
test('session proof grants no source storage without the exact separate source policy',async t=>{
  const f=await fixture(t);await assert.rejects(f.prepare({...f.input,policyId:'missing'}),/source_policy_unavailable/);
  f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');await assert.rejects(f.prepare(),/source_policy_unavailable/);
  assert.equal(count(f,'private_content'),0);assert.equal(count(f,'events'),0);f.unpaid();
});
test('caller cannot change server-owned intent, output recipe, source ownership or provide reference assets',async t=>{
  const f=await fixture(t);
  for(const mutate of [v=>v.request.intentId=crypto.randomUUID(),v=>v.request.experienceId='slides',v=>v.request.reference={},v=>v.request.ownerId='owner',v=>v.request.values.subject.provenance='default',v=>v.request.releaseHash=`sha256:${'e'.repeat(64)}`]){
    const changed=structuredClone(f.input);mutate(changed);await assert.rejects(f.prepare(changed),/source_request_invalid/);
  }assert.equal(count(f,'private_content'),0);f.unpaid();
});
test('wrong guest proof cannot read or commit another session source',async t=>{
  const f=await fixture(t),a=await f.prepare(),other=await issueGuestClaimSession(request(),f.env,f.terms.policyId);
  await assert.rejects(f.prepare({...f.input,proof:{...proof(f.session),claimToken:other.claimToken}}),/proof_unavailable/);
  await assert.rejects(commitGuestImageSource(request(),f.env,{proof:proof(other),draftHash:a.plan.draftHash}),/source_unavailable/);assert.equal(count(f,'events'),0);
});
for(const [name,changes] of Object.entries({draft:{maximumDraftBytes:1},events:{maximumEventBytes:1},count:{maximumEvents:1}})){
  test(`source ${name} ceiling refuses before any body/event persistence`,async t=>{
    const f=await fixture(t,{sourceChanges:changes});await assert.rejects(f.prepare(),/source_limit/);assert.equal(count(f,'private_content'),0);assert.equal(count(f,'events'),0);f.unpaid();
  });
}
test('atomic prepare races produce one body and one immutable original source',async t=>{
  const f=await fixture(t),results=await Promise.all([f.prepare(),f.prepare()]);assert.deepEqual(results[0].plan,results[1].plan);
  assert.equal(count(f,'private_content'),1);assert.equal(count(f,'experience_guest_sources'),1);f.unpaid();
});
test('atomic commit races return the single original native event set',async t=>{
  const f=await fixture(t),saved=await f.prepare(),results=await Promise.all([f.commit(saved.plan.draftHash),f.commit(saved.plan.draftHash)]);
  assert.deepEqual(results[0].eventIds,results[1].eventIds);assert.equal(count(f,'events'),saved.plan.events.length);assert.equal(count(f,'experience_guest_source_commits'),1);f.unpaid();
});
test('revocation in native storage transaction rolls back body and source receipt',async t=>{
  const f=await fixture(t),done=before(f,sql=>sql.startsWith('INSERT INTO private_content('),()=>f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1'));
  await assert.rejects(f.prepare());done();assert.equal(count(f,'private_content'),0);assert.equal(count(f,'experience_guest_sources'),0);assert.equal(count(f,'events'),0);
});
test('revocation during native event append rolls back all public/private events and receipts',async t=>{
  const f=await fixture(t),saved=await f.prepare(),done=before(f,sql=>sql.startsWith('INSERT INTO event_write_stage'),()=>f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1'));
  await assert.rejects(f.commit(saved.plan.draftHash));done();assert.equal(count(f,'events'),0);assert.equal(count(f,'event_private_payloads'),0);
  assert.equal(count(f,'event_client_receipts'),0);assert.equal(count(f,'experience_guest_source_commits'),0);f.unpaid();
});
for(const phase of ['prepare','commit'])test(`lost ${phase} acknowledgement recovers actual original records without allocating another source`,async t=>{
  const f=await fixture(t),saved=phase==='commit'?await f.prepare():null,batch=f.DB.batch;let lost=false;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(!lost&&statements.some(s=>s.sql.includes(phase==='prepare'?'INSERT INTO experience_guest_sources':'INSERT INTO experience_guest_source_commits'))){lost=true;throw Error('lost ack');}return result;};
  const result=phase==='prepare'?await f.prepare():await f.commit(saved.plan.draftHash);f.DB.batch=batch;
  assert.equal(result.replayed,true);assert.equal(count(f,'private_content'),1);assert.equal(count(f,'experience_guest_sources'),1);
  assert.equal(count(f,'experience_guest_source_commits'),phase==='commit'?1:0);f.unpaid();
});
test('new storage revocation preserves already prepared/current guest read and completed source replay',async t=>{
  const f=await fixture(t),saved=await f.prepare(),committed=await f.commit(saved.plan.draftHash);
  f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');assert.deepEqual((await f.prepare()).plan,saved.plan);
  assert.deepEqual((await f.commit(saved.plan.draftHash)).eventIds,committed.eventIds);f.unpaid();
});
test('revoked source policy blocks first canonical source commit without deleting the prepared input',async t=>{
  const f=await fixture(t),saved=await f.prepare();f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');
  await assert.rejects(f.commit(saved.plan.draftHash),/source_policy_unavailable/);assert.equal(count(f,'events'),0);assert.equal(count(f,'private_content'),1);
});
test('redacted private draft cannot be rewritten or used to commit native context',async t=>{
  const f=await fixture(t),saved=await f.prepare();f.sqlite.exec("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z'");
  await assert.rejects(f.prepare());await assert.rejects(f.commit(saved.plan.draftHash),/source_unavailable/);assert.equal(count(f,'private_content'),1);assert.equal(count(f,'events'),0);
});
test('synthetic old random reserved IDs cannot be silently changed into native IDs',async t=>{
  const f=await fixture(t),old={...f.session,sessionId:crypto.randomUUID(),projectId:crypto.randomUUID(),documentId:crypto.randomUUID(),guestSubject:`guest:${crypto.randomUUID()}`,
    sessionToken:`forma-guest-session-v1.${'1'.repeat(64)}`,claimToken:`forma-guest-claim-v1.${'2'.repeat(64)}`};
  f.sqlite.prepare('INSERT INTO experience_guest_sessions VALUES(?,?,?,?,?,?,?,?,?,?,NULL)').run(old.sessionId,f.terms.policyId,await digest(f.terms),old.guestSubject,old.projectId,old.documentId,
    await guestTokenHash(old.sessionToken,'session'),await guestTokenHash(old.claimToken,'claim'),Date.now()-1,old.expiresAtMs);
  await assert.rejects(f.prepare({...f.input,proof:proof(old),request:{...f.input.request,intentId:old.sessionId}}),/source_identity_incompatible/);assert.equal(count(f,'private_content'),0);
});
for(const [name,mutation] of Object.entries({
  public:"UPDATE events SET payload='{}' WHERE sequence=1",
  private:"UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)",
  owner:"UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)",
  project:"UPDATE event_private_payloads SET project_id='other' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)",
  document:"UPDATE event_private_payloads SET document_id='other' WHERE private_event_id=(SELECT event_id FROM events WHERE sequence=1)",
  redacted:"UPDATE event_private_payloads SET private_json='{}',redacted_at='2026-01-01T00:00:00.000Z'",
  actor:"UPDATE events SET actor='other' WHERE sequence=1",
  correlation:"UPDATE events SET correlation_id='other' WHERE sequence=1",
  receipt:"DELETE FROM event_client_receipts",
}))test(`damaged ${name} native commit evidence fails closed and never reallocates`,async t=>{
  const f=await fixture(t),saved=await f.prepare(),done=await f.commit(saved.plan.draftHash);
  // Prove the native guard first, then emulate historical corruption in this isolated fixture.
  if(mutation.startsWith('UPDATE events')){assert.throws(()=>f.sqlite.exec(mutation),/append-only/);
    for(const row of f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='events'").all())f.sqlite.exec(`DROP TRIGGER ${row.name}`);}
  f.sqlite.exec(mutation);await assert.rejects(f.commit(saved.plan.draftHash),/source_commit_unavailable/);
  assert.equal(count(f,'events'),done.eventIds.length);assert.equal(count(f,'experience_guest_source_commits'),1);f.unpaid();
});
for(const phase of ['prepare','commit'])test(`database replacement after ${phase} batch cannot release original source`,async t=>{
  const f=await fixture(t),saved=phase==='commit'?await f.prepare():null,batch=f.DB.batch;let swapped=false;
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);
    if(!swapped&&statements.some(s=>s.sql.includes(phase==='prepare'?'INSERT INTO experience_guest_sources':'INSERT INTO experience_guest_source_commits'))){swapped=true;f.env.DB={...f.DB};}return result;};
  await assert.rejects(phase==='prepare'?f.prepare():f.commit(saved.plan.draftHash),/database_changed/);assert.equal(swapped,true);f.unpaid();
});
test('guest session revocation blocks original draft and event read without changing immutable history',async t=>{
  const f=await fixture(t),saved=await f.prepare(),committed=await f.commit(saved.plan.draftHash);
  f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');await assert.rejects(f.prepare(),/proof_unavailable/);
  await assert.rejects(f.commit(saved.plan.draftHash),/proof_unavailable/);assert.equal(count(f,'events'),committed.eventIds.length);f.unpaid();
});
function replaceDatabaseAfterRead(f,predicate,method,enabled=()=>true){const prepare=f.DB.prepare;let swapped=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...args){const bound=bind.call(this,...args),read=bound[method];bound[method]=async function(){const result=await read.call(this);
      if(!swapped&&predicate(sql)&&enabled()){swapped=true;f.env.DB={...f.DB};}return result;};return bound;};return statement;};return()=>assert.equal(swapped,true);}
for(const phase of ['prepare','commit'])test(`database replacement at ${phase} final proof denies disclosure`,async t=>{
  const f=await fixture(t),saved=phase==='commit'?await f.prepare():null;
  if(phase==='commit')await f.commit(saved.plan.draftHash);
  const checked=replaceDatabaseAfterRead(f,sql=>sql.startsWith(phase==='prepare'?'SELECT 1 WHERE':'SELECT expected.value'),phase==='prepare'?'first':'all');
  await assert.rejects(phase==='prepare'?f.prepare():f.commit(saved.plan.draftHash),/database_changed/);checked();f.unpaid();
});
for(const phase of ['prepare','commit'])test(`database replacement during lost ${phase} acknowledgement recovery denies disclosure`,async t=>{
  const f=await fixture(t),saved=phase==='commit'?await f.prepare():null,batch=f.DB.batch;let lost=false;
  const checked=replaceDatabaseAfterRead(f,sql=>sql.startsWith(phase==='prepare'?'SELECT source.*':'SELECT expected.value'),phase==='prepare'?'first':'all',()=>lost);
  f.DB.batch=async statements=>{const result=await batch.call(f.DB,statements);if(!lost&&statements.some(s=>s.sql.includes(phase==='prepare'?'INSERT INTO experience_guest_sources':'INSERT INTO experience_guest_source_commits'))){lost=true;throw Error('lost ack');}return result;};
  await assert.rejects(phase==='prepare'?f.prepare():f.commit(saved.plan.draftHash),/database_changed/);checked();f.unpaid();
});
function scopeSource(f,kind){
  if(kind==='project')f.sqlite.prepare('INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)').run('scope',f.session.projectId,'org','native-owner','active','time','time');
  else f.sqlite.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?,?,?)').run('scope','document',f.session.documentId,'org',f.session.projectId,'native-owner','collaborative_output',null,'native-owner','time');
}
for(const kind of ['project','document'])for(const stage of ['prepared','committed'])test(`new ${kind} custody after ${stage} source denies guest replay and commit`,async t=>{
  const f=await fixture(t),saved=await f.prepare();if(stage==='committed')await f.commit(saved.plan.draftHash);
  const eventCount=count(f,'events');scopeSource(f,kind);await assert.rejects(f.prepare());await assert.rejects(f.commit(saved.plan.draftHash));
  assert.equal(count(f,'events'),eventCount);assert.equal(count(f,'experience_guest_source_commits'),stage==='committed'?1:0);
});
for(const kind of ['project','document'])test(`new ${kind} custody inside native source event transaction rolls back entire append`,async t=>{
  const f=await fixture(t),saved=await f.prepare(),done=before(f,sql=>sql.startsWith('INSERT INTO event_write_stage'),()=>scopeSource(f,kind));
  await assert.rejects(f.commit(saved.plan.draftHash));done();assert.equal(count(f,'events'),0);assert.equal(count(f,'event_private_payloads'),0);
  assert.equal(count(f,'event_client_receipts'),0);assert.equal(count(f,'experience_guest_source_commits'),0);f.unpaid();
});

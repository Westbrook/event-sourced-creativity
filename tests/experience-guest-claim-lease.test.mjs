import assert from 'node:assert/strict';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [{GUEST_CUSTODY_SCHEMA,readGuestCustodyTerms,issueGuestClaimSession,revokeGuestClaimSession},
  {acquireGuestClaimLease},{canonicalJson,digest},{handleSession,POLICY_VERSION}]=await Promise.all([
  import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-claim-lease.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/pilot-policy.ts')]);
const origin='https://guest.example.invalid';
const terms=()=>({version:1,policyId:'synthetic-policy',origin,startsAtMs:Date.now()-60_000,expiresAtMs:Date.now()+600_000,
  sessionLifetimeMs:300_000,leaseLifetimeMs:60_000,maximumSessions:4,maximumLeaseAcquisitions:2});
const request=(actor='owner',headers={})=>new Request(`${origin}/unregistered-claim`,{method:'POST',headers:{origin,
  ...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...headers}});
const proof=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const intent=session=>({proof:proof(session),requestId:'request-1',manifestDigest:`sha256:${'a'.repeat(64)}`});
async function fixture(t,change={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  // Actual native account lifecycle is fixture setup only, before side-effect guards.
  for(const actor of ['owner','other'])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  for(const sql of GUEST_CUSTODY_SCHEMA)f.sqlite.exec(sql);
  const policy=readGuestCustodyTerms({...terms(),...change});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(policy.policyId,await digest(policy),canonicalJson(policy),`sha256:${'b'.repeat(64)}`);
  t.mock.method(globalThis,'fetch',()=>{throw Error('no network');});
  for(const operation of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,operation,()=>{throw Error('no media');});
  const nativeSnapshot=()=>Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'experience_guest_%' ORDER BY name").all()
    .map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()]));
  const before=nativeSnapshot();f.assertNoNativeChanges=()=>assert.deepEqual(nativeSnapshot(),before);
  f.issue=()=>issueGuestClaimSession(request(null),f.env,policy.policyId);
  f.claim=(session,actor='owner',changes={})=>acquireGuestClaimLease(request(actor),f.env,{...intent(session),...changes});
  return {...f,policy};
}
function intercept(f,when,action){
  const prepare=f.DB.prepare;let hit=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),original=statement.bind;
    statement.bind=function(...bindings){const bound=original.call(this,...bindings);for(const kind of ['first','run','all']){const execute=bound[kind];bound[kind]=async function(){if(!hit&&when(sql)){hit=true;await action(sql,bindings);}return execute.call(this);};}return bound;};return statement;};
  return ()=>{f.DB.prepare=prepare;assert.equal(hit,true,'interleaving hook ran');};
}

test('terms are closed, explicit, finite and copied; no hidden default or getter execution',()=>{
  const raw=terms(),checked=readGuestCustodyTerms(raw);raw.maximumSessions=999;
  assert.equal(checked.maximumSessions,4);assert.ok(Object.isFrozen(checked));
  for(const bad of [undefined,null,{}, {...terms(),enabled:true},{...terms(),version:2},{...terms(),origin:'http://guest.example.invalid'},
    {...terms(),origin:`${origin}/`},{...terms(),leaseLifetimeMs:900001},{...terms(),maximumSessions:0},{...terms(),maximumLeaseAcquisitions:101},
    {...terms(),sessionLifetimeMs:604800001},{...terms(),sessionLifetimeMs:1},{...terms(),expiresAtMs:0}])assert.throws(()=>readGuestCustodyTerms(bad),/terms_invalid/);
  const getter=terms();Object.defineProperty(getter,'origin',{enumerable:true,get(){throw Error('must not run');}});assert.throws(()=>readGuestCustodyTerms(getter),/terms_invalid/);
});
test('issuance makes separate random opaque proofs and IDs; only hashes persist; no native writes',async t=>{
  const f=await fixture(t),a=await f.issue(),b=await f.issue();
  assert.notEqual(a.sessionToken,a.claimToken);assert.notEqual(a.guestSubject,b.guestSubject);assert.notEqual(a.documentId,b.documentId);
  assert.match(a.sessionToken,/^forma-guest-session-v1\.[a-f0-9]{64}$/);assert.match(a.claimToken,/^forma-guest-claim-v1\.[a-f0-9]{64}$/);
  const stored=JSON.stringify(f.sqlite.prepare('SELECT * FROM experience_guest_sessions').all());
  assert.ok(!stored.includes(a.sessionToken)&&!stored.includes(a.claimToken));assert.ok(stored.includes('sha256:'));
  assert.ok(a.expiresAtMs<=f.policy.expiresAtMs);f.assertNoNativeChanges();
});
test('unprovisioned policy and absent schema fail closed without installing anything',async t=>{
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  await assert.rejects(issueGuestClaimSession(request(),f.env,'none'),/no such table/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='table'").get().n,0);
  for(const sql of GUEST_CUSTODY_SCHEMA)f.sqlite.exec(sql);
  await assert.rejects(issueGuestClaimSession(request(),f.env,'none'),/policy_unavailable/);
});
test('concurrent session issuance respects one policy ceiling atomically',async t=>{
  const f=await fixture(t,{maximumSessions:1});const results=await Promise.allSettled([f.issue(),f.issue(),f.issue()]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_sessions').get().n,1);f.assertNoNativeChanges();
});
test('origin, secure origin and unsafe method checks run before issue',async t=>{
  const f=await fixture(t);
  for(const req of [request(null,{origin:'https://evil.invalid'}),new Request(`${origin}/x`,{method:'POST'}),
    new Request(`${origin}/x`,{headers:{origin}}),new Request('https://elsewhere.invalid/x',{method:'POST',headers:{origin}})]){
    await assert.rejects(issueGuestClaimSession(req,f.env,f.policy.policyId),/origin_required/);
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_sessions').get().n,0);
});
test('DB clock defeats caller wall-clock advancement and blocks future/expired policy',async t=>{
  const f=await fixture(t,{startsAtMs:Date.now()+100000});t.mock.method(Date,'now',()=>9_000_000_000_000);
  await assert.rejects(f.issue(),/session_unavailable/);
});
test('policy mutation, deletion, replacement and reactivation are refused',async t=>{
  const f=await fixture(t);assert.throws(()=>f.sqlite.exec("UPDATE experience_guest_policies SET terms_json='{}'"),/immutable/);
  assert.throws(()=>f.sqlite.exec('DELETE FROM experience_guest_policies'),/immutable/);
  assert.throws(()=>f.sqlite.exec('INSERT OR REPLACE INTO experience_guest_policies SELECT * FROM experience_guest_policies'),/exists/);
  f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');
  assert.throws(()=>f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=NULL'),/immutable/);
  await assert.rejects(f.issue(),/policy_unavailable/);
});
test('native existing Creator receives a claiming lease with exact generated IDs, no custody or account changes',async t=>{
  const f=await fixture(t),s=await f.issue(),lease=await f.claim(s);
  assert.equal(lease.status,'claiming');assert.equal(lease.custodyTransferred,false);assert.equal(lease.documentId,s.documentId);
  assert.equal(lease.projectId,s.projectId);assert.equal(lease.guestSubject,s.guestSubject);assert.equal(lease.destinationUserId,'owner');
  assert.equal(lease.acquisition,1);assert.ok(lease.expiresAtMs<=s.expiresAtMs);f.assertNoNativeChanges();
});
test('cross-guest, swapped purpose, public share-shaped and forged tokens cannot claim',async t=>{
  const f=await fixture(t),s=await f.issue(),other=await f.issue();
  for(const invalid of [{...proof(s),claimToken:other.claimToken},{...proof(s),sessionToken:other.sessionToken},
    {...proof(s),claimToken:s.sessionToken},{...proof(s),sessionToken:s.claimToken},{...proof(s),claimToken:'public-share-token'},
    {...proof(s),sessionId:other.sessionId},{...proof(s),extra:1}])await assert.rejects(f.claim(s,'owner',{proof:invalid}),/proof_unavailable/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_claim_leases').get().n,0);
});
test('no anonymous, new, viewer, unconsented, guest-shaped or workspace/impersonated destination is created',async t=>{
  const f=await fixture(t),s=await f.issue();
  for(const actor of [null,'nonexistent','guest:forged'])await assert.rejects(f.claim(s,actor),/destination_unavailable/);
  for(const cookie of ['forma_project_context=stale','forma_impersonation=stale'])await assert.rejects(acquireGuestClaimLease(request('owner',{cookie}),f.env,intent(s)),/personal_principal_required/);
  f.sqlite.exec("UPDATE users SET role='viewer' WHERE user_id='owner'");await assert.rejects(f.claim(s),/destination_unavailable/);
  f.sqlite.exec("UPDATE users SET role='creator',consent_version=NULL WHERE user_id='owner'");await assert.rejects(f.claim(s),/destination_unavailable/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
});
test('email equality never merges a different authenticated subject',async t=>{
  const f=await fixture(t),s=await f.issue();
  const req=request('new-subject',{'oai-authenticated-user-email':'owner@example.invalid'});
  await assert.rejects(acquireGuestClaimLease(req,f.env,intent(s)),/destination_unavailable/);f.assertNoNativeChanges();
});
test('same request replays one lease without refreshing expiry or consuming attempts',async t=>{
  const f=await fixture(t),s=await f.issue(),a=await f.claim(s),b=await f.claim(s);assert.deepEqual(a,b);
  assert.equal(f.sqlite.prepare('SELECT acquisitions FROM experience_guest_claim_leases').get().acquisitions,1);
});
test('concurrent same-account claims are idempotent and competing accounts fail',async t=>{
  const f=await fixture(t),s=await f.issue();const same=await Promise.all([f.claim(s),f.claim(s)]);assert.deepEqual(same[0],same[1]);
  await assert.rejects(f.claim(s,'other'),/lease_conflict/);
  const another=await f.issue(),both=await Promise.allSettled([f.claim(another),f.claim(another,'other')]);
  assert.equal(both.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_claim_leases WHERE session_id=?').get(another.sessionId).n,1);
});
test('changed manifest conflicts and another request cannot renew a still-active lease',async t=>{
  const f=await fixture(t),s=await f.issue(),a=await f.claim(s);
  await assert.rejects(f.claim(s,'owner',{manifestDigest:`sha256:${'c'.repeat(64)}`}),/lease_conflict/);
  await assert.rejects(f.claim(s,'owner',{requestId:'request-2'}),/lease_unavailable/);assert.deepEqual(await f.claim(s),a);
});
test('lost write acknowledgement resumes the exact committed lease without a second acquisition',async t=>{
  const f=await fixture(t),s=await f.issue(),prepare=f.DB.prepare;let lost=false;
  f.DB.prepare=function(sql){const stmt=prepare.call(this,sql),bind=stmt.bind;stmt.bind=function(...args){const bound=bind.call(this,...args),run=bound.run;bound.run=async function(){const result=await run.call(this);if(!lost&&sql.startsWith('INSERT INTO experience_guest_claim_leases')){lost=true;throw Error('lost acknowledgement');}return result;};return bound;};return stmt;};
  await assert.rejects(f.claim(s),/lost acknowledgement/);f.DB.prepare=prepare;
  const resumed=await f.claim(s);assert.equal(resumed.acquisition,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_claim_leases').get().n,1);
});
test('native permission changes between read and transaction deny insertion',async t=>{
  const f=await fixture(t),s=await f.issue();const done=intercept(f,sql=>sql.startsWith('INSERT INTO experience_guest_claim_leases'),()=>f.sqlite.exec("UPDATE users SET role='viewer' WHERE user_id='owner'"));
  await assert.rejects(f.claim(s),/lease_unavailable/);done();assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_claim_leases').get().n,0);
});
test('revocation racing final read prevents lease disclosure and makes replay unusable',async t=>{
  const f=await fixture(t),s=await f.issue();const done=intercept(f,sql=>sql.startsWith('SELECT * FROM experience_guest_claim_leases WHERE session_id=? AND destination_user_id='),
    ()=>f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1'));
  await assert.rejects(f.claim(s),/lease_unavailable/);done();await assert.rejects(f.claim(s),/proof_unavailable/);
});
test('explicit guest revocation invalidates all leases without altering native data',async t=>{
  const f=await fixture(t),s=await f.issue();await f.claim(s);await revokeGuestClaimSession(request(null),f.env,proof(s));
  await assert.rejects(f.claim(s),/proof_unavailable/);assert.throws(()=>f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=NULL'),/immutable/);f.assertNoNativeChanges();
});
test('expired leases resume only same destination/manifest with bounded fresh request identity',async t=>{
  const f=await fixture(t,{leaseLifetimeMs:1}),s=await f.issue();
  // Simulate a process dying after its durable insert by pausing the final read;
  // use DB time for the wait condition, not an injected application clock.
  const done=intercept(f,sql=>sql.startsWith('SELECT * FROM experience_guest_claim_leases WHERE session_id=? AND destination_user_id='),async()=>new Promise(r=>setTimeout(r,8)));
  await assert.rejects(f.claim(s),/lease_unavailable/);done();
  await assert.rejects(f.claim(s),/lease_unavailable/);await assert.rejects(f.claim(s,'other',{requestId:'new'}),/lease_conflict/);
  // A tiny synthetic lease need not remain alive until JS returns. What matters
  // here is the real transaction's same lease ID, counter and bounded renewal.
  const prior=f.sqlite.prepare('SELECT * FROM experience_guest_claim_leases').get();
  await f.claim(s,'owner',{requestId:'request-2'}).catch(error=>assert.match(error.message,/lease_unavailable/));
  const next=f.sqlite.prepare('SELECT * FROM experience_guest_claim_leases').get();assert.equal(next.lease_id,prior.lease_id);assert.equal(next.acquisitions,2);
  await new Promise(r=>setTimeout(r,8));await assert.rejects(f.claim(s,'owner',{requestId:'request-3'}),/lease_unavailable/);
  assert.equal(f.sqlite.prepare('SELECT acquisitions FROM experience_guest_claim_leases').get().acquisitions,2);
});
test('expired guest sessions require separate future recovery authority; no implicit recovery',async t=>{
  const f=await fixture(t,{sessionLifetimeMs:1,leaseLifetimeMs:1}),s=await f.issue();await new Promise(r=>setTimeout(r,8));
  await assert.rejects(f.claim(s),/proof_unavailable/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_claim_leases').get().n,0);
});

test('policy revocation between issuance validation and insert prevents session allocation',async t=>{
  const f=await fixture(t);const done=intercept(f,sql=>sql.startsWith('INSERT INTO experience_guest_sessions'),()=>f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1'));
  await assert.rejects(f.issue(),/session_unavailable/);done();assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_sessions').get().n,0);
});
test('native terms revocation after lease insert prevents final disclosure and replay',async t=>{
  const f=await fixture(t),s=await f.issue();const done=intercept(f,sql=>sql.startsWith('SELECT * FROM experience_guest_claim_leases WHERE session_id=? AND destination_user_id='),
    ()=>f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'"));
  await assert.rejects(f.claim(s),/lease_unavailable/);done();await assert.rejects(f.claim(s),/destination_unavailable/);
});
test('configured native pilot admission is preserved instead of bypassed by guest proof',async t=>{
  const f=await fixture(t),s=await f.issue();f.env.FORMA_PILOT_COHORT_ID='missing-cohort';
  await assert.rejects(f.claim(s),/destination_unavailable/);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_claim_leases').get().n,0);
});
test('database substitution during asynchronous session policy proof fails closed',async t=>{
  const f=await fixture(t),original=f.env.DB;
  const done=intercept(f,sql=>sql.startsWith('SELECT * FROM experience_guest_policies'),()=>{f.env.DB={...original};});
  await assert.rejects(f.issue(),/database_changed/);done();f.env.DB=original;
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_guest_sessions').get().n,0);
});
test('lease and session rows cannot be retargeted, deleted, replaced or completed',async t=>{
  const f=await fixture(t),s=await f.issue();await f.claim(s);
  for(const sql of ["UPDATE experience_guest_sessions SET document_id='other'",'DELETE FROM experience_guest_sessions',
    'INSERT OR REPLACE INTO experience_guest_sessions SELECT * FROM experience_guest_sessions',
    "UPDATE experience_guest_claim_leases SET destination_user_id='other'",'DELETE FROM experience_guest_claim_leases',
    'INSERT OR REPLACE INTO experience_guest_claim_leases SELECT * FROM experience_guest_claim_leases'])assert.throws(()=>f.sqlite.exec(sql),/immutable|exists/);
  assert.ok(!f.sqlite.prepare("PRAGMA table_info(experience_guest_claim_leases)").all().some(row=>row.name==='status'));
});

test('delayed retry of a superseded request cannot acquire another lease or consume allowance',async t=>{
  const f=await fixture(t,{leaseLifetimeMs:1,maximumLeaseAcquisitions:3}),s=await f.issue();
  const attempt=async requestId=>{await f.claim(s,'owner',{requestId}).catch(error=>assert.match(error.message,/lease_unavailable/));await new Promise(r=>setTimeout(r,8));};
  await attempt('request-A');await attempt('request-B');
  const before=f.sqlite.prepare('SELECT * FROM experience_guest_claim_leases').get();assert.equal(before.acquisitions,2);
  assert.deepEqual(JSON.parse(before.request_ids_json),['request-A','request-B']);
  await assert.rejects(f.claim(s,'owner',{requestId:'request-A'}),/lease_unavailable/);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM experience_guest_claim_leases').get(),before);
});

test('concurrent expired-lease renewals use one compare-and-swap for identical or competing request IDs',async t=>{
  const f=await fixture(t,{leaseLifetimeMs:1,maximumLeaseAcquisitions:5}),s=await f.issue();
  await f.claim(s).catch(error=>assert.match(error.message,/lease_unavailable/));await new Promise(r=>setTimeout(r,8));
  const race=async ids=>{
    const prepare=f.DB.prepare;let arrivals=0,release;const barrier=new Promise(resolve=>release=resolve);
    f.DB.prepare=function(sql){const stmt=prepare.call(this,sql),bind=stmt.bind;stmt.bind=function(...args){const bound=bind.call(this,...args),first=bound.first;
      bound.first=async function(){const result=await first.call(this);if(sql.startsWith('SELECT * FROM experience_guest_claim_leases WHERE session_id=? AND (')){if(++arrivals===2)release();await barrier;}return result;};return bound;};return stmt;};
    try{const outcomes=await Promise.allSettled(ids.map(requestId=>f.claim(s,'owner',{requestId})));assert.equal(arrivals,2);
      for(const outcome of outcomes)if(outcome.status==='rejected')assert.match(outcome.reason.message,/lease_unavailable/);
    }finally{f.DB.prepare=prepare;}
  };
  await race(['request-B','request-B']);let row=f.sqlite.prepare('SELECT * FROM experience_guest_claim_leases').get();
  assert.equal(row.acquisitions,2);assert.equal(row.request_id,'request-B');assert.deepEqual(JSON.parse(row.request_ids_json),['request-1','request-B']);
  await new Promise(r=>setTimeout(r,8));await race(['request-C','request-D']);row=f.sqlite.prepare('SELECT * FROM experience_guest_claim_leases').get();
  assert.equal(row.acquisitions,3);assert.ok(['request-C','request-D'].includes(row.request_id));
  assert.equal(JSON.parse(row.request_ids_json).length,3);
});

test('reserved identities are the actual native compiler identities for the server-owned guest intent',async t=>{
  const f=await fixture(t),s=await f.issue();
  const {registeredExperience,initialValues,buildExperiencePlan,validateIntakeRequest}=await import('../src/experiences/intake.ts');
  const release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:'A stone bridge in morning light',provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const validated=await validateIntakeRequest({intentId:s.sessionId,experienceId:'image',releaseHash:release.releaseHash,values});assert.ok(validated);
  const plan=await buildExperiencePlan(s.guestSubject,validated.request,validated.release);
  assert.equal(plan.projectId,s.projectId);assert.equal(plan.documentId,s.documentId);assert.equal(plan.streamId,`creative:${s.guestSubject}`);
  const replay=await buildExperiencePlan(s.guestSubject,validated.request,validated.release);assert.deepEqual(plan,replay);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events WHERE stream_id=?').get(plan.streamId).n,0);f.assertNoNativeChanges();
});

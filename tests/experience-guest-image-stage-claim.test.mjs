import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {fixture,request,rows,snapshot,changes,batchHook,insert,origin,payer,time,GUEST_DB_NOW} from './helpers/guest-image-stage-fixture.mjs';
import {enforceD1ExpressionDepth,compileSqliteExpressionDepth} from './helpers/d1-expression-depth.mjs';

// Retained stage review and native lease controls precede the separate actual
// canonical-copy cases. All states originate with real guest state writers.
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{preflightGuestImage},
  {inspectGuestImageStageInventory},{inspectGuestImageSaveInventory,GUEST_IMAGE_SAVE_CLAIM_SCHEMA},
  {GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{GUEST_IMAGE_STAGE_CUSTODY_SCHEMA},
  {POLICY_VERSION},{issueGuestClaimSession},{appendAuditEvent},
  {inspectGuestImageStageClaimInventory,guestImageStageClaimInventoryData,guestImageStageClaimProof,readGuestImageStageClaimLeaseRow},
  {acquireGuestImageStageClaimLease,acquireGuestImageSaveClaimLease,acquireGuestContextClaimLease}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts'),
  import('../worker/experience-guest-image-stage-inventory.ts'),import('../worker/experience-guest-image-claim-inventory.ts'),
  import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-guest-image-stage-custody.ts'),import('../worker/policy-version.ts'),
  import('../worker/experience-guest-session.ts'),import('../worker/runtime.ts'),
  import('../worker/experience-guest-image-stage-claim-inventory.ts'),import('../worker/experience-guest-claim-lease.ts')]);
const owner='synthetic-stage-owner',other='synthetic-other-stage-owner';
const states=['confirmed','preflight-claimed-unknown','quoted'];
const canonicalRequest=(actor=owner,extra={})=>new Request(`${origin}/unregistered-stage-claim`,{method:'POST',headers:{origin,
  ...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...extra}});
const reservation=statements=>statements.some(statement=>/^INSERT INTO experience_sponsor_driver_stages\(/u.test(statement.sql));
const leaseBatch=statements=>statements.some(statement=>/^\s*(?:INSERT INTO|UPDATE) experience_guest_claim_leases\b/u.test(statement.sql));

async function stageFixture(t,state='confirmed',options={}){
  const f=await fixture(t,options);
  if(state!=='first-save'){
    const review=await prepareGuestImageConfirmation(request(),f.env,f.input);
    f.confirmed=await confirmGuestImageRequirement(request(),f.env,{...f.input,reviewedRequirementDigest:review.reviewedRequirementDigest,explicitRequirementsConfirmation:true});
    if(state==='quoted')f.quoted=await preflightGuestImage(request(),f.env,f.input);
    else if(state==='preflight-claimed-unknown'){
      const done=batchHook(f,reservation,()=>{throw Error('fixture lost native preflight reservation acknowledgement');});
      try{await assert.rejects(preflightGuestImage(request(),f.env,f.input),/fixture lost native preflight reservation acknowledgement/u);}finally{done();}
    }
  }
  for(const sql of [...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA,...GUEST_IMAGE_SAVE_CLAIM_SCHEMA,...GUEST_IMAGE_STAGE_CUSTODY_SCHEMA])f.sqlite.exec(sql);
  for(const actor of [owner,other])insert(f,'users',{user_id:actor,email:`${actor}@example.invalid`,display_name:actor,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
  f.state=state;f.inspect=(req=canonicalRequest(),input={proof:f.proof},env=f.env)=>inspectGuestImageStageClaimInventory(req,env,input);
  f.acquire=(inventory,requestId='stage-request-1',req=canonicalRequest(),proof=f.proof,env=f.env)=>acquireGuestImageStageClaimLease(req,env,{proof,requestId,inventory});
  f.stageHead=f.committed.head+(state==='first-save'?1:state==='quoted'?3:2);
  assert.equal(rows(f,'events').length,f.stageHead);assert.equal(rows(f,'output_preflights').length,state==='quoted'?1:0);
  assert.equal(rows(f,'experience_sponsor_resource_receipts').length,state==='first-save'?1:state==='confirmed'?2:3);
  return f;
}
async function readOnly(f,operation){const before=snapshot(f),count=changes(f),result=await operation();assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);return result;}
async function denied(f,operation){const before=snapshot(f);await assert.rejects(operation);assert.deepEqual(snapshot(f),before);}
function onlyLeaseChanged(f,before){const after=snapshot(f);assert.deepEqual(after.schema,before.schema);
  for(const [table,value]of Object.entries(before.contents))if(table!=='experience_guest_claim_leases')assert.deepEqual(after.contents[table],value,table);
}
function assertLease(f,inventory,receipt,{acquisition=1,actor=owner}={}){
  assert.ok(Object.isFrozen(receipt));assert.equal(receipt.version,1);assert.equal(receipt.status,'claiming');assert.equal(receipt.custodyTransferred,false);
  assert.equal(receipt.destinationUserId,actor);assert.equal(receipt.guestSubject,f.session.guestSubject);assert.equal(receipt.projectId,f.session.projectId);
  assert.equal(receipt.documentId,f.session.documentId);assert.equal(receipt.manifestDigest,inventory.manifestDigest);assert.equal(receipt.acquisition,acquisition);
  const lease=rows(f,'experience_guest_claim_leases')[0];assert.equal(lease.lease_id,receipt.leaseId);assert.equal(lease.expires_at_ms,receipt.expiresAtMs);
  assert.equal(lease.destination_user_id,actor);assert.equal(lease.acquisitions,acquisition);assert.equal(rows(f,'experience_guest_claim_leases').length,1);
  for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'private_json','SELECT'])assert.equal(JSON.stringify(receipt).includes(secret),false);
}
function noConstruction(f){let calls=0;for(const name of ['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_IMAGE_MODEL','FAL_KEY','FAL_IMAGE_MODEL'])Object.defineProperty(f.env,name,{configurable:true,get(){calls++;throw Error('stage custody lease cannot reconstruct a quote');}});return()=>assert.equal(calls,0);}
function nativeHolds(f){for(const actor of [payer,owner]){
  insert(f,'budget_reservations',{reservation_id:`stage-lease-tokens-${actor}`,owner_id:actor,stream_id:`creative:${actor}`,correlation_id:'foreign-job',operation:'image',period:'2026-09',reserved_tokens:100,used_tokens:3,status:'active',created_at:time,updated_at:time});
  insert(f,'cost_budget_reservations',{reservation_id:`stage-lease-cost-${actor}`,owner_id:actor,workspace_id:'forma',stream_id:`creative:${actor}`,correlation_id:'foreign-job',operation:'image',period:'2026-09',reserved_microusd:1234,used_microusd:4,status:'executing',created_at:time,updated_at:time});
}}
async function sourceDue(f){const start=performance.now();while(!f.sqlite.prepare(`SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due FROM experience_guest_sources WHERE session_id=?`).get(f.session.sessionId).due){assert.ok(performance.now()-start<10000);await delay(10);}}
function mutationHook(f,predicate,action){const prepare=f.DB.prepare;let hits=0;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.apply(this,bindings),execute=bound.execute;
    bound.execute=function(kind){const result=execute.call(this,kind);if(!hits&&predicate(sql)){action();hits++;}return result;};return bound;};return statement;};
  return()=>{f.DB.prepare=prepare;assert.equal(hits,1,'native transaction mutation reached');};
}

for(const state of states)for(const memory of [false,true])test(`${state} stage-claim inventory and lease preserve all history with ${memory?'complete':'absent'} Memory`,async t=>{
  const f=await stageFixture(t,state,{memory});nativeHolds(f);const noQuote=noConstruction(f),inventory=await readOnly(f,()=>f.inspect());
  assert.deepEqual(Object.keys(inventory).sort(),['version','sessionId','guestSubject','projectId','documentId','destinationUserId','draftHash','sourceHead','sourceSaveHead','stageHead','stageState','expiresAt','manifestDigest'].sort());
  assert.ok(Object.isFrozen(inventory));assert.equal(inventory.version,1);assert.equal(inventory.sessionId,f.session.sessionId);
  assert.equal(inventory.guestSubject,f.session.guestSubject);assert.equal(inventory.projectId,f.session.projectId);assert.equal(inventory.documentId,f.session.documentId);
  assert.equal(inventory.destinationUserId,owner);assert.equal(inventory.sourceHead,f.committed.head);assert.equal(inventory.sourceSaveHead,f.committed.head+1);
  assert.equal(inventory.draftHash,f.prepared.plan.draftHash);
  assert.equal(inventory.stageHead,f.stageHead);assert.equal(inventory.stageState,state);assert.equal(inventory.expiresAt,rows(f,'experience_guest_sources')[0].expires_at);
  for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'private_json','SELECT'])assert.equal(JSON.stringify(inventory).includes(secret),false);
  const data=guestImageStageClaimInventoryData(f.env,inventory);assert.ok(Object.isFrozen(data));assert.ok(data.manifest);
  assert.equal((await f.DB.prepare(`SELECT CASE WHEN (${data.beforeProof.sql}) THEN 1 ELSE 0 END AS current`).bind(...data.beforeProof.bindings).first()).current,1);
  assert.equal((await readOnly(f,()=>inspectGuestImageStageInventory(request(),f.env,{proof:f.proof}))).manifestDigest,inventory.manifestDigest);
  const before=snapshot(f),receipt=await f.acquire(inventory);assertLease(f,inventory,receipt);onlyLeaseChanged(f,before);noQuote();
  assert.deepEqual(await readOnly(f,()=>f.acquire(inventory)),receipt);
  const refreshed=await readOnly(f,()=>f.inspect());assert.equal(refreshed.manifestDigest,inventory.manifestDigest);
  assert.deepEqual(await readOnly(f,()=>f.acquire(refreshed)),receipt);noQuote();
  assert.equal((await f.DB.prepare(`SELECT CASE WHEN (${data.beforeProof.sql}) THEN 1 ELSE 0 END AS current`).bind(...data.beforeProof.bindings).first()).current,0,'captured absent-lease proof does not become authority over a new row');
  assert.equal((await f.DB.prepare(`SELECT CASE WHEN (${data.proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...data.proof.bindings).first()).current,1,'complete original source and destination proof survives its own matching lease');
  for(const table of ['experience_guest_context_adoptions','experience_guest_image_claims','experience_guest_plan_custodies','experience_guest_image_stage_custodies','experience_guest_image_stage_copies'])assert.deepEqual(rows(f,table),[],table);
  assert.equal(rows(f,'users').some(row=>row.user_id===f.session.guestSubject),false);
});

test('stage-claim inventory requires canonical identity plus both guest proof purposes without bootstrap',async t=>{
  const f=await stageFixture(t,'quoted');
  for(const actor of [null,'unknown-canonical-user'])await denied(f,()=>f.inspect(canonicalRequest(actor)));
  for(const proof of [{...f.proof,sessionToken:f.proof.claimToken},{...f.proof,claimToken:f.proof.sessionToken},
    {...f.proof,actorUserId:owner},{...f.proof,sessionId:crypto.randomUUID()}])await denied(f,()=>f.inspect(canonicalRequest(),{proof}));
  for(const input of [{proof:f.proof,destinationUserId:owner},{proof:f.proof,manifestDigest:'sha256:'+'a'.repeat(64)},
    {proof:f.proof,proofSql:'1'},{proof:f.proof,stageState:'quoted'}])await denied(f,()=>f.inspect(canonicalRequest(),input));
});

test('an opaque stage-claim inventory cannot be forged or moved across database identities',async t=>{
  const f=await stageFixture(t,'confirmed'),inventory=await f.inspect();
  for(const forged of [{},{...inventory},JSON.parse(JSON.stringify(inventory)),Object.create(inventory)]){
    assert.throws(()=>guestImageStageClaimInventoryData(f.env,forged));await denied(f,()=>f.acquire(forged));
  }
  const otherEnv={...f.env,DB:{...f.DB}};assert.throws(()=>guestImageStageClaimInventoryData(otherEnv,inventory));
  await denied(f,()=>f.acquire(inventory,'stage-request-1',canonicalRequest(),f.proof,otherEnv));
  const otherSession=await issueGuestClaimSession(request(),f.env,f.terms.policyId);
  await denied(f,()=>f.acquire(inventory,'stage-request-1',canonicalRequest(),{sessionId:otherSession.sessionId,sessionToken:otherSession.sessionToken,claimToken:otherSession.claimToken}));
});

test('a genuine different canonical principal cannot use an owner inventory before any lease exists',async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect();assert.deepEqual(rows(f,'experience_guest_claim_leases'),[]);
  await denied(f,()=>f.acquire(inventory,'stage-request-1',canonicalRequest(other)));assert.deepEqual(rows(f,'experience_guest_claim_leases'),[]);
  assertLease(f,inventory,await f.acquire(inventory));
});

for(const state of states)test(`${state} remains outside strict historical and N1 lease brands`,async t=>{
  const f=await stageFixture(t,state),stage=await f.inspect(),historical=await inspectGuestImageStageInventory(request(),f.env,{proof:f.proof});
  await denied(f,()=>f.acquire(historical));
  for(const acquire of [acquireGuestContextClaimLease,acquireGuestImageSaveClaimLease])await denied(f,()=>acquire(canonicalRequest(),f.env,{proof:f.proof,requestId:'wrong-brand',inventory:stage}));
  await denied(f,()=>inspectGuestImageSaveInventory(request(),f.env,{proof:f.proof}));
  await f.acquire(stage);await denied(f,()=>inspectGuestImageStageInventory(request(),f.env,{proof:f.proof}));
  await denied(f,()=>prepareGuestImageConfirmation(request(),f.env,f.input));await denied(f,()=>preflightGuestImage(request(),f.env,f.input));
});

test('a genuine N1 inventory and context brand cannot be passed as a later-stage claim inventory',async t=>{
  const f=await stageFixture(t,'first-save'),first=await inspectGuestImageSaveInventory(request(),f.env,{proof:f.proof});
  await denied(f,()=>f.inspect());await denied(f,()=>f.acquire(first));await denied(f,()=>f.acquire(f.inventory));
});

for(const damage of ['missing identity trigger','missing copy table','extra trigger'])test(`${damage} refuses stage-claim review and invalidates its captured schema`,async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect();
  if(damage==='missing identity trigger')f.sqlite.exec('DROP TRIGGER experience_guest_image_stage_content_identity');
  else if(damage==='missing copy table')f.sqlite.exec('DROP TABLE experience_guest_image_stage_copies');
  else f.sqlite.exec("CREATE TRIGGER fixture_extra_stage_trigger BEFORE INSERT ON experience_guest_image_stage_custodies BEGIN SELECT 1; END");
  await denied(f,()=>f.inspect());await denied(f,()=>f.acquire(inventory));
});

for(const boundary of ['GET','HTTP','query','fragment','wrong-origin','cross-site','project-cookie','impersonation-cookie'])test(`${boundary} refuses stage-claim review and lease without mutation`,async t=>{
  const f=await stageFixture(t,'confirmed'),inventory=await f.inspect();let req=canonicalRequest();
  if(boundary==='GET')req=new Request(req,{method:'GET'});else if(boundary==='HTTP')req=new Request(req.url.replace('https:','http:'),{method:'POST',headers:req.headers});
  else if(boundary==='query'||boundary==='fragment')req=new Request(req.url+(boundary==='query'?'?x=1':'#x'),{method:'POST',headers:req.headers});
  else if(boundary==='wrong-origin')req.headers.set('origin','https://foreign.invalid');else if(boundary==='cross-site')req.headers.set('sec-fetch-site','cross-site');
  else req.headers.set('cookie',boundary==='project-cookie'?' forma_project_context=':' forma_impersonation=');
  await denied(f,()=>f.inspect(req));await denied(f,()=>f.acquire(inventory,'stage-request-1',req));
});

const damages={
  'source draft':f=>f.sqlite.prepare("UPDATE private_content SET content='' WHERE content_id=?").run(f.prepared.plan.draftId),
  'confirmation body':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(f.confirmed.eventId),
  'quote owner':f=>f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign-owner' WHERE private_event_id=?").run(f.quoted.eventId),
  'confirmation command':f=>f.sqlite.exec("UPDATE output_commands SET request_digest='changed' WHERE action='confirm'"),
  'preflight terms':f=>f.sqlite.exec("UPDATE output_preflights SET terms_digest='changed'"),
  'guest revocation':f=>f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1'),
  'custody policy revocation':f=>f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1'),
  'canonical consent':f=>f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner),
  'canonical role':f=>f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(owner),
  'partial Memory':f=>f.sqlite.exec('CREATE TABLE memory_structured_answer_origins(origin_id TEXT PRIMARY KEY)'),
};
for(const [name,mutate]of Object.entries(damages))test(`captured stage-claim ${name} drift cannot acquire a lease`,async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect();mutate(f);await denied(f,()=>f.acquire(inventory));
});

test('a different-session stage mapping that names the original Document excludes custody',async t=>{
  const f=await stageFixture(t,'quoted'),foreign=await issueGuestClaimSession(request(),f.env,f.terms.policyId);
  const lineage={sessionId:foreign.sessionId,guestSubject:foreign.guestSubject,projectId:foreign.projectId,documentId:foreign.documentId};
  // Explicit adverse mapping fixture, never a successful canonical claim. Its
  // foreign parents use a genuine session, and native foreign keys stay on.
  const row={session_id:foreign.sessionId,destination_user_id:other,lease_id:'adverse-foreign-lease',request_id:'adverse-foreign-request',manifest_digest:'adverse-manifest',lineage_json:JSON.stringify(lineage),lineage_digest:'adverse-lineage',created_at_ms:1};
  insert(f,'experience_guest_context_adoptions',row);insert(f,'experience_guest_image_claims',{...row,context_lineage_digest:'adverse-context'});
  const inventory=await readOnly(f,()=>f.inspect());
  insert(f,'experience_guest_image_stage_custodies',{...row,context_lineage_digest:'adverse-context',save_lineage_digest:'adverse-save',lineage_json:JSON.stringify({...lineage,documentId:f.session.documentId})});
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);assert.deepEqual(rows(f,'experience_guest_claim_leases'),[]);
  await denied(f,()=>f.inspect());await denied(f,()=>f.acquire(inventory));
});

test('a native additional source event invalidates the captured stage before lease acquisition',async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect();await appendAuditEvent(f.env,`creative:${f.session.guestSubject}`,f.session.guestSubject,'EmptyCanvasChosen',{project_id:f.session.projectId,document_id:f.session.documentId});
  await denied(f,()=>f.acquire(inventory));
});

test('the original source deadline invalidates the captured lease inventory without being renewed',async t=>{
  const f=await stageFixture(t,'confirmed',{draftLifetimeMs:1500}),inventory=await f.inspect();await sourceDue(f);await denied(f,()=>f.acquire(inventory));
});

test('historical sponsor revocation and absent current payer never create new spending authority',async t=>{
  const f=await stageFixture(t,'quoted'),original=await f.inspect();
  f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}',policy_digest='changed'");
  f.sqlite.exec("UPDATE experience_sponsor_resource_policies SET enabled=0,limits_json='{}',limits_digest='changed'");
  f.sqlite.prepare('DELETE FROM users WHERE user_id=?').run(payer);const noQuote=noConstruction(f),inventory=await readOnly(f,()=>f.inspect());
  assert.equal(inventory.manifestDigest,original.manifestDigest);const before=snapshot(f);assertLease(f,inventory,await f.acquire(inventory));onlyLeaseChanged(f,before);noQuote();
});

test('an active different request or canonical destination cannot replace the original stage lease',async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect(),foreign=await f.inspect(canonicalRequest(other));
  const first=await f.acquire(inventory),refreshed=await f.inspect();
  await denied(f,()=>f.acquire(refreshed,'stage-request-2'));await denied(f,()=>f.acquire(foreign,'stage-request-1',canonicalRequest(other)));
  await denied(f,()=>f.acquire(refreshed,'stage-request-1',canonicalRequest(other)));await denied(f,()=>f.inspect(canonicalRequest(other)));
  assert.deepEqual(await readOnly(f,()=>f.acquire(refreshed)),first);
});

for(const ack of ['lost','sparse','false','truncated'])test(`${ack} stage lease acknowledgement returns one exact recorded lease`,async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect(),before=snapshot(f),done=batchHook(f,leaseBatch,result=>{
    if(ack==='lost')throw Error('fixture lost lease acknowledgement');if(ack==='truncated')return result.slice(0,-1);
    if(ack==='sparse'){const sparse=[...result];delete sparse[0];return sparse;}return result.map((row,index)=>index?row:{...row,success:false});
  });
  let receipt;try{receipt=await f.acquire(inventory);}finally{done();}assertLease(f,inventory,receipt);onlyLeaseChanged(f,before);
  const current=await f.inspect();assert.deepEqual(await readOnly(f,()=>f.acquire(current)),receipt);
});

for(const damage of ['source','consent'])test(`late ${damage} inside the real stage lease batch rolls back both writes`,async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect(),before=snapshot(f);
  const done=mutationHook(f,sql=>/^\s*INSERT INTO experience_guest_claim_leases\b/u.test(sql),()=>{
    if(damage==='source')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(f.confirmed.eventId);
    else f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner);
  });
  try{await assert.rejects(f.acquire(inventory));}finally{done();}assert.deepEqual(snapshot(f),before);
});

test('canonical revocation after a genuine lease commit refuses disclosure and preserves the original lease',async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect();let changed;
  const done=batchHook(f,leaseBatch,result=>{f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner);changed=snapshot(f);return result;});
  try{await assert.rejects(f.acquire(inventory));}finally{done();}
  assert.ok(changed);assert.deepEqual(snapshot(f),changed);assert.equal(rows(f,'experience_guest_claim_leases').length,1);
  await denied(f,()=>f.acquire(inventory));await denied(f,()=>f.inspect());
});

for(const damage of ['history count','duplicate requests','future expiry'])test(`a malformed own lease with ${damage} cannot be inventoried or replayed`,async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect();await f.acquire(inventory);const current=await f.inspect(),row=rows(f,'experience_guest_claim_leases')[0];
  const changed=damage==='history count'?{acquisitions:2}:damage==='duplicate requests'?{acquisitions:2,request_ids_json:JSON.stringify([row.request_id,row.request_id])}
    :{expires_at_ms:rows(f,'experience_guest_sessions')[0].expires_at_ms+1};
  const keys=Object.keys(changed),sql=`UPDATE experience_guest_claim_leases SET ${keys.map(key=>`${key}=?`).join(',')} WHERE session_id=?`,bindings=[...Object.values(changed),f.session.sessionId];
  assert.throws(()=>f.sqlite.prepare(sql).run(...bindings),/immutable/u);
  const trigger=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='experience_guest_lease_update'").get().sql;
  // Deliberate corrupt-row negative only: first prove the native guard rejects
  // it, then restore the exact guard before testing either production entry.
  f.sqlite.exec('DROP TRIGGER experience_guest_lease_update');try{f.sqlite.prepare(sql).run(...bindings);}finally{f.sqlite.exec(trigger);}
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  await denied(f,()=>f.inspect());await denied(f,()=>f.acquire(current));assert.equal(rows(f,'experience_guest_claim_leases').length,1);
});

test('the own-lease parser refuses malformed native histories and expiry bounds from a genuine acquired row',async t=>{
  const f=await stageFixture(t,'confirmed'),inventory=await f.inspect();await f.acquire(inventory);const current=await f.inspect(),data=guestImageStageClaimInventoryData(f.env,current),row={...rows(f,'experience_guest_claim_leases')[0]};
  assert.deepEqual(readGuestImageStageClaimLeaseRow(row,data.session,owner,current.manifestDigest),row);
  for(const changed of [{request_ids_json:'{}'},{request_ids_json:JSON.stringify([row.request_id,'different-last'])},
    {request_ids_json:JSON.stringify([row.request_id,row.request_id]),acquisitions:2},{acquisitions:4},
    {request_ids_json:`[ ${JSON.stringify(row.request_id)} ]`},{expires_at_ms:data.session.row.expires_at_ms+1},
    {expires_at_ms:row.created_at_ms},{lease_id:'not-a-native-lease-id'},{destination_user_id:other}])assert.throws(()=>readGuestImageStageClaimLeaseRow({...row,...changed},data.session,owner,current.manifestDigest));
});

test('a renewed own lease cannot claim expiry beyond the observed native lifetime bound',async t=>{
  const f=await stageFixture(t,'confirmed',{draftLifetimeMs:300000}),inventory=await f.inspect();await f.acquire(inventory);const current=await f.inspect(),row=rows(f,'experience_guest_claim_leases')[0];
  const future=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now+f.terms.leaseLifetimeMs+10000;
  assert.ok(future<rows(f,'experience_guest_sessions')[0].expires_at_ms);
  const sql='UPDATE experience_guest_claim_leases SET acquisitions=2,request_id=?,request_ids_json=?,expires_at_ms=? WHERE session_id=?',
    bindings=['stage-request-2',JSON.stringify([row.request_id,'stage-request-2']),future,f.session.sessionId];
  assert.throws(()=>f.sqlite.prepare(sql).run(...bindings),/immutable/u);
  const trigger=f.sqlite.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='experience_guest_lease_update'").get().sql;
  f.sqlite.exec('DROP TRIGGER experience_guest_lease_update');try{f.sqlite.prepare(sql).run(...bindings);}finally{f.sqlite.exec(trigger);}
  const before=snapshot(f);let inventoryRejected=false,leaseRejected=false;
  try{await f.inspect();}catch{inventoryRejected=true;}
  try{await f.acquire(current,'stage-request-2');}catch{leaseRejected=true;}
  assert.deepEqual(snapshot(f),before);assert.deepEqual({inventoryRejected,leaseRejected},{inventoryRejected:true,leaseRejected:true});
});

test('real native lease expiry preserves identity through three acquisitions and refuses its original cap',{timeout:240000},async t=>{
  const f=await stageFixture(t,'preflight-claimed-unknown',{draftLifetimeMs:300000});nativeHolds(f);
  assert.equal(f.terms.leaseLifetimeMs,60000);assert.equal(f.terms.maximumLeaseAcquisitions,3);
  const inventory=await f.inspect(),noQuote=noConstruction(f),before=snapshot(f),first=await f.acquire(inventory),initial={...rows(f,'experience_guest_claim_leases')[0]},waits=[];
  const waitForOriginalLease=async()=>{const stored={...rows(f,'experience_guest_claim_leases')[0]},start=performance.now();
    while(f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now<stored.expires_at_ms){assert.ok(performance.now()-start<65000,'native lease deadline advances without rewrite');await delay(50);}
    waits.push({acquisition:stored.acquisitions,originalExpiresAtMs:stored.expires_at_ms,databaseNowMs:f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now,elapsedMs:performance.now()-start});
    assert.deepEqual({...rows(f,'experience_guest_claim_leases')[0]},stored);
  };
  assertLease(f,inventory,first);assert.deepEqual(await readOnly(f,()=>f.acquire(inventory)),first);
  for(let acquisition=2;acquisition<=3;acquisition++){
    await waitForOriginalLease();const current=await readOnly(f,()=>f.inspect());assert.equal(current.manifestDigest,inventory.manifestDigest);
    await denied(f,()=>f.acquire(current,'stage-request-1'));await denied(f,()=>f.acquire(current,`stage-request-${acquisition}`,canonicalRequest(other)));
    const result=await f.acquire(current,`stage-request-${acquisition}`);assertLease(f,inventory,result,{acquisition});assert.equal(result.leaseId,first.leaseId);
    const retained=rows(f,'experience_guest_claim_leases')[0];assert.equal(retained.created_at_ms,initial.created_at_ms);
    assert.deepEqual(JSON.parse(retained.request_ids_json),Array.from({length:acquisition},(_,i)=>`stage-request-${i+1}`));
    assert.deepEqual(await readOnly(f,()=>f.acquire(current,`stage-request-${acquisition}`)),result);
  }
  await waitForOriginalLease();const exhausted=await f.inspect();
  for(const requestId of ['stage-request-1','stage-request-2','stage-request-3','stage-request-4'])await denied(f,()=>f.acquire(exhausted,requestId));
  assert.equal(rows(f,'experience_guest_claim_leases')[0].acquisitions,3);onlyLeaseChanged(f,before);noQuote();
  assert.equal(rows(f,'experience_sponsor_driver_stages').length,1);assert.equal(rows(f,'output_preflights').length,0);
  t.diagnostic(JSON.stringify({originalLeaseLifetimeMs:f.terms.leaseLifetimeMs,maximumLeaseAcquisitions:f.terms.maximumLeaseAcquisitions,waits}));
});

test('complete-Memory stage review and guarded lease stay within deployment SQL limits',async t=>{
  const f=await stageFixture(t,'quoted',{memory:true}),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{const inventory=await f.inspect(),before=snapshot(f);assertLease(f,inventory,await f.acquire(inventory));onlyLeaseChanged(f,before);
    const current=await f.inspect();await readOnly(f,()=>f.acquire(current));limits.assertVerified();
    t.diagnostic(JSON.stringify({qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}
});

test('packed stage proofs preserve SQLite truth with multiple quoted forms, Unicode, comments and scalar bindings',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('CREATE TABLE "q?uote"([br?ack] TEXT,`tick?` INTEGER)');
  db.prepare('INSERT INTO "q?uote" VALUES(?,?)').run("line\n界?'\"",9);
  const parts=[{sql:'EXISTS(SELECT 1 FROM "q?uote" WHERE [br?ack]=? AND `tick?`=?)',bindings:["line\n界?'\"",9]},
    {sql:"? IS NULL AND ? = 2.5 AND ? = 'literal? -- /* ? */'",bindings:[null,2.5,'literal? -- /* ? */']},
    {sql:"? = 'escaped ''?''' /* ? ignored */ AND ? = 4 -- ? ignored\n",bindings:["escaped '?'",4]}];
  const original=structuredClone(parts),execute=proof=>db.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS value`).get(...proof.bindings).value;
  const unpacked=values=>({sql:values.map(part=>`(${part.sql})`).join(' AND '),bindings:values.flatMap(part=>part.bindings)});
  const packed=guestImageStageClaimProof(parts);assert.equal(packed.bindings.length,1);assert.equal(execute(unpacked(parts)),1);assert.equal(execute(packed),1);
  const falseParts=structuredClone(parts);falseParts[0].bindings[1]=10;assert.equal(execute(unpacked(falseParts)),0);assert.equal(execute(guestImageStageClaimProof(falseParts)),0);
  assert.deepEqual(parts,original);
});

test('nested packed stage proofs preserve inner parameters and independent false predicates',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const run=proof=>db.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS value`).get(...proof.bindings).value;
  const first=guestImageStageClaimProof([{sql:'? = ? AND ? IS NULL',bindings:['same','same',null]}]);
  const second=guestImageStageClaimProof([first,{sql:'? < ? /* stage_claim_parameters_8 ? */',bindings:[2,3]}]);
  const third=guestImageStageClaimProof([second,{sql:"? = 'stage_claim_parameters_99 ?'",bindings:['stage_claim_parameters_99 ?']}]);
  assert.equal(run(third),1);assert.equal(third.bindings.length,1);
  assert.equal(run(guestImageStageClaimProof([third,{sql:'? = 0',bindings:[1]}])),0);
});

test('packed primitive binding types match native SQLite null, numeric and embedded-NUL text predicates',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const observations=[];
  for(const value of [null,1,2.5,'text\0after-null']){
    const native=db.prepare('SELECT typeof(?) AS kind,(? IS NULL) AS is_null,hex(?) AS bytes').get(value,value,value);
    const part={sql:'typeof(?) = ? AND (? IS NULL) = ? AND hex(?) = ?',bindings:[value,native.kind,value,native.is_null,value,native.bytes]};
    const packed=guestImageStageClaimProof([part]);
    observations.push({label:value===null?'null':typeof value==='number'?String(value):'embedded-NUL text',kind:native.kind,
      original:db.prepare(`SELECT CASE WHEN (${part.sql}) THEN 1 ELSE 0 END AS value`).get(...part.bindings).value,
      packed:db.prepare(`SELECT CASE WHEN (${packed.sql}) THEN 1 ELSE 0 END AS value`).get(...packed.bindings).value});
  }
  const integer={sql:"typeof(CAST(? AS INTEGER))='integer' AND CAST(? AS INTEGER)=1",bindings:[1,1]},packed=guestImageStageClaimProof([integer]);
  observations.push({label:'explicit SQLite integer',kind:'integer',original:db.prepare(`SELECT CASE WHEN (${integer.sql}) THEN 1 ELSE 0 END AS value`).get(...integer.bindings).value,
    packed:db.prepare(`SELECT CASE WHEN (${packed.sql}) THEN 1 ELSE 0 END AS value`).get(...packed.bindings).value});
  t.diagnostic(JSON.stringify(observations));assert.ok(observations.every(row=>row.original===1));
  assert.deepEqual(observations.map(row=>row.packed),observations.map(row=>row.original));
});

test('packed stage proofs refuse unsupported binding counts and unclosed quoted SQL',()=>{
  for(const parts of [[],[{sql:'?',bindings:[]}],[{sql:'1',bindings:[1]}],[{sql:'?1',bindings:[1]}],
    [{sql:"? = 'unterminated",bindings:[1]}],[{sql:'1 /* unterminated',bindings:[]}],
    [{sql:'?',bindings:[Number.NaN]}],[{sql:'?',bindings:[Number.POSITIVE_INFINITY]}],[{sql:'?',bindings:[{}]}]])assert.throws(()=>guestImageStageClaimProof(parts));
});


test('packed stage proofs retain more than seventy predicates through repeated nesting under deployment limits',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const parts=Array.from({length:80},(_,index)=>({sql:'? = ?',bindings:[index,index]}));
  let proof=guestImageStageClaimProof(parts);
  for(let index=0;index<12;index++)proof=guestImageStageClaimProof([proof,{sql:'? >= 0',bindings:[index]}]);
  const sql=`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS value`,queryLimits={functionArguments:32,parameters:100,sqlBytes:100000};
  const compiled=compileSqliteExpressionDepth(db,sql,{bindings:proof.bindings,queryLimits});assert.equal(compiled.ok,true,compiled.error);
  assert.equal(db.prepare(sql).get(...proof.bindings).value,1);assert.equal(proof.bindings.length,1);
  // Every original predicate, including group edges and earlier nested leaves,
  // must still decide the result after subsequent composition.
  for(let rejected=0;rejected<92;rejected++){
    let negative=guestImageStageClaimProof(parts.map((part,index)=>index===rejected?{...part,bindings:[index,index+1]}:part));
    for(let index=0;index<12;index++)negative=guestImageStageClaimProof([negative,{sql:'? >= 0',bindings:[80+index===rejected?-1:index]}]);
    assert.equal(db.prepare(`SELECT CASE WHEN (${negative.sql}) THEN 1 ELSE 0 END AS value`).get(...negative.bindings).value,0,`original predicate ${rejected} remains decisive`);
  }
  t.diagnostic(JSON.stringify({independentPredicates:92,limit:compiled.limit,statementBytes:compiled.statementBytes,parameterCount:compiled.parameterCount}));
});

test('packed stage proof outputs and captured inputs are immutable while foreign clones keep every predicate',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const run=proof=>db.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS value`).get(...proof.bindings).value;
  const input={sql:'? = ?',bindings:['native','native']},proof=guestImageStageClaimProof([input]);
  assert.ok(Object.isFrozen(proof));assert.ok(Object.isFrozen(proof.bindings));
  assert.throws(()=>{proof.sql='0';},TypeError);assert.throws(()=>{proof.bindings[0]='[]';},TypeError);
  input.sql='0';input.bindings[0]='changed';assert.equal(run(proof),1);
  assert.equal(run(guestImageStageClaimProof([proof,{sql:'1',bindings:[]}])),1);
  const clone={...proof,sql:`(${proof.sql}) AND ? = 0`,bindings:[...proof.bindings,1]};
  assert.equal(run(guestImageStageClaimProof([clone])),0);
  const serialized=JSON.parse(JSON.stringify(guestImageStageClaimProof([{sql:'? = 0',bindings:[1]}])));
  assert.equal(run(guestImageStageClaimProof([serialized,{sql:'1',bindings:[]}])),0);
  const nullProof=guestImageStageClaimProof([{sql:'?',bindings:[null]}]);
  assert.equal(run(nullProof),0);assert.equal(run(guestImageStageClaimProof([{sql:'1',bindings:[]},nullProof])),0);
  assert.equal(run(guestImageStageClaimProof([JSON.parse(JSON.stringify(nullProof)),{sql:'1',bindings:[]}])),0);
});

test('packed stage proofs preserve foreign namespace predicates through nested composition',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('CREATE TABLE guest_image_copy_p0(value TEXT); CREATE TABLE GUEST_IMAGE_COPY_1_group0(value TEXT)');
  db.prepare('INSERT INTO guest_image_copy_p0 VALUES(?)').run('original');
  db.prepare('INSERT INTO GUEST_IMAGE_COPY_1_group0 VALUES(?)').run('second');
  const parts=[{sql:'EXISTS(SELECT 1 FROM guest_image_copy_p0 WHERE value=?)',bindings:['original']},
    {sql:'EXISTS(SELECT 1 FROM GUEST_IMAGE_COPY_1_group0 WHERE value=?)',bindings:['second']}];
  const run=proof=>db.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE 0 END AS value`).get(...proof.bindings).value;
  const proof=guestImageStageClaimProof(parts);assert.equal(run(proof),1);
  assert.equal(run(guestImageStageClaimProof([proof,{sql:'? = ?',bindings:['third','third']} ])),1);
  db.prepare('UPDATE guest_image_copy_p0 SET value=?').run('changed');
  assert.equal(run(proof),0);assert.equal(run(guestImageStageClaimProof([proof])),0);
});

// Canonical-copy cases below call only the actual composed storage kind and
// native writer. Select them explicitly after the implementation owner freezes
// its source; the inventory/lease-only controls above are independent.
const stageCopyBatch=statements=>statements.some(statement=>/^INSERT INTO experience_guest_image_stage_custodies\(/u.test(statement.sql));
const canonicalEvents=f=>rows(f,'events').filter(row=>row.stream_id===`creative:${owner}`).sort((a,b)=>a.sequence-b.sequence);
const claimAllowedTables=['events','event_private_payloads','event_client_receipts','private_content','output_commands','experience_guest_claim_leases','experience_guest_sessions','experience_guest_context_adoptions','experience_guest_image_claims','experience_guest_image_stage_custodies','experience_guest_image_stage_copies'];
const proofless=f=>({sessionId:f.claimInput.sessionId,requestId:f.claimInput.requestId,approvedManifestDigest:f.claimInput.approvedManifestDigest});
async function canonicalClaimFixture(t,state='confirmed',options={}){
  const f=await stageFixture(t,state,options);
  const [{claimGuestImageStages},{readClaimedGuestImageStageHistory},{canonicalJson,digest}]=await Promise.all([
    import('../worker/experience-guest-image-stage-claim.ts'),import('../worker/experience-guest-image-stage-custody.ts'),import('../src/experiences/compiler.ts')]);
  f.env.FORMA_RETENTION_DAYS='2';f.claimInventory=await f.inspect();
  f.claimInput={sessionId:f.session.sessionId,requestId:'canonical-stage-claim-1',approvedManifestDigest:f.claimInventory.manifestDigest,proof:f.proof};
  f.claim=(input=f.claimInput,req=canonicalRequest(),env=f.env)=>claimGuestImageStages(req,env,input);
  f.history=(req=canonicalRequest(),env=f.env,input={sessionId:f.session.sessionId})=>readClaimedGuestImageStageHistory(req,env,input);
  f.originalComponents={confirmation:rows(f,'event_private_payloads').find(row=>row.private_event_id===f.confirmed.eventId).private_json};
  if(state==='quoted')f.originalComponents.quote=rows(f,'event_private_payloads').find(row=>row.private_event_id===f.quoted.eventId).private_json;
  if(state!=='confirmed')f.originalComponents.construction=canonicalJson({stage:{...rows(f,'experience_sponsor_driver_stages')[0]},resource:{...rows(f,'experience_sponsor_resource_receipts').find(row=>row.operation==='preflight')}});
  f.originalDigests=Object.fromEntries(await Promise.all(Object.entries(f.originalComponents).map(async([role,value])=>[role,await digest(value)])));
  return f;
}
function assertStageClaim(f,result,{replayed=false,retained=true}={}){
  assert.equal(result.version,1);assert.equal(result.status,'image-stage-history-claimed');assert.equal(result.stageState,f.state);
  for(const name of ['contextCustodyTransferred','requirementCustodyTransferred','stageHistoryCustodyTransferred'])assert.equal(result[name],true);
  assert.equal(result.historyRetention,retained?'retained':'unavailable');assert.equal(result.planRetention,'not-attempted');
  assert.equal(result.generationAvailable,false);assert.equal(result.miniAppClaimComplete,false);assert.equal(result.replayed,replayed);assert.ok(Object.isFrozen(result));
  const receipt=result.receipt;assert.equal(receipt.status,'image-save-adopted');assert.equal(receipt.sessionId,f.session.sessionId);
  assert.equal(receipt.destinationUserId,owner);assert.equal(receipt.documentId,f.session.documentId);assert.equal(receipt.projectId,f.session.projectId);
  assert.equal(receipt.manifestDigest,f.claimInventory.manifestDigest);assert.equal(receipt.requestId,f.claimInput.requestId);assert.equal(receipt.requirementId,f.saved.requirementId);
  assert.equal(receipt.revision,canonicalEvents(f).at(-1).sequence);assert.equal(receipt.eventId,canonicalEvents(f).at(-1).event_id);
  for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'private_json','guestSponsorPreparation','SELECT'])assert.equal(JSON.stringify(result).includes(secret),false);
  return receipt;
}
function preserveOriginalRows(f,before,allowed=claimAllowedTables){
  const after=snapshot(f);assert.deepEqual(after.schema,before.schema);
  for(const [table,prior]of Object.entries(before.contents)){
    if(!allowed.includes(table))assert.deepEqual(after.contents[table],prior,table);
    else if(table!=='experience_guest_sessions'&&table!=='experience_guest_claim_leases')for(const row of prior)assert.ok(after.contents[table].some(current=>JSON.stringify(current)===JSON.stringify(row)),`${table} preserves original rows`);
  }
}
async function assertStageHistory(f){
  const history=await readOnly(f,()=>f.history());assert.equal(history.kind,'guest-image-stage-history');assert.equal(history.sessionId,f.session.sessionId);
  assert.equal(history.documentId,f.session.documentId);assert.equal(history.stageState,f.state);assert.equal(history.generationAvailable,false);assert.equal(history.miniAppClaimComplete,false);
  assert.deepEqual(history.provenance,{guestSubject:f.session.guestSubject,originalPayerUserId:payer,originalSourceExpiresAt:f.claimInventory.expiresAt,
    originalQuoteExpiresAt:f.quoted?rows(f,'output_preflights')[0].expires_at:null});
  assert.deepEqual(history.components.map(row=>row.role).sort(),Object.keys(f.originalComponents).sort());
  for(const component of history.components){assert.equal(component.content,f.originalComponents[component.role]);assert.equal(component.originalDigest,f.originalDigests[component.role]);
    assert.ok(component.expiresAt>f.claimInventory.expiresAt);assert.equal(Date.parse(component.expiresAt)-Date.parse(component.createdAt),2*86400000);}
  return history;
}
for(const state of states)test(`canonical ${state} stage history claim preserves exact original history and copies only Context plus SAVE`,async t=>{
  const f=await canonicalClaimFixture(t,state,{memory:state==='quoted'});nativeHolds(f);
  await appendAuditEvent(f.env,`creative:${owner}`,'user','ProjectCreated',{project_id:'unrelated-stage-project',name:'Earlier work'});
  const noQuote=noConstruction(f),before=snapshot(f),oldTarget=canonicalEvents(f),result=await f.claim(),receipt=assertStageClaim(f,result);
  preserveOriginalRows(f,before);noQuote();
  const target=canonicalEvents(f),added=target.slice(oldTarget.length);assert.deepEqual(target.slice(0,oldTarget.length),oldTarget);
  assert.equal(added.length,f.committed.head+1);assert.deepEqual(added.map(row=>row.sequence),Array.from({length:added.length},(_,i)=>oldTarget.length+i+1));
  assert.ok(added.every(row=>!before.contents.events.some(old=>old.event_id===row.event_id)));
  assert.ok(added.slice(0,-1).every(row=>row.actor==='user'&&row.client_id==='server:guest-context-adoption'));
  for(const [index,event]of added.slice(0,-1).entries()){
    const original=f.prepared.plan.events[index],copied=rows(f,'event_private_payloads').find(row=>row.private_event_id===event.event_id);
    assert.equal(event.type,original.type);assert.equal(copied.owner_id,owner);assert.equal(copied.redacted_at,null);
    assert.deepEqual(JSON.parse(copied.private_json),{...original.payload,client_event_id:`guest-context-adoption:v1:${f.session.sessionId}:${index}`});
  }
  assert.equal(added.at(-1).actor,`user:${owner}`);assert.equal(added.at(-1).client_id,'server:output-requirements');
  assert.equal(added.some(row=>['OutputPlanConfirmed','OutputPlanPreflighted'].includes(row.type)),false);
  const body=rows(f,'event_private_payloads').find(row=>row.private_event_id===receipt.eventId),envelope=JSON.parse(body.private_json).output_command_envelope;
  assert.equal(body.owner_id,owner);assert.equal(envelope.action,'save');assert.equal(envelope.expectedRevision,`output:${receipt.revision-1}`);
  assert.equal(envelope.documentId,f.session.documentId);assert.equal(envelope.blockId,f.saved.requirementId);assert.equal(Object.hasOwn(envelope,'guestSponsorPreparation'),false);
  assert.deepEqual(envelope.spec,JSON.parse(before.contents.event_private_payloads.find(row=>row.private_event_id===f.saved.eventId).private_json).output_command_envelope.spec);
  for(const [table,delta]of [['events',added.length],['event_private_payloads',added.length],['event_client_receipts',f.committed.head],['output_commands',1],['private_content',Object.keys(f.originalComponents).length]])assert.equal(rows(f,table).length,before.contents[table].length+delta,table);
  for(const table of ['experience_guest_context_adoptions','experience_guest_image_claims','experience_guest_image_stage_custodies'])assert.equal(rows(f,table).length,1);
  assert.equal(rows(f,'experience_guest_plan_custodies').length,0);
  assert.equal(rows(f,'experience_guest_sessions')[0].revoked_at_ms,rows(f,'experience_guest_image_stage_custodies')[0].created_at_ms);
  await assertStageHistory(f);const replay=assertStageClaim(f,await readOnly(f,()=>f.claim(proofless(f))),{replayed:true});
  assert.deepEqual({...replay,replayed:false},{...receipt,replayed:false});
  const {loadPrivateContent}=await import('../worker/pilot-policy.ts');
  for(const scope of ['all','chat','memory']){const ordinary=await readOnly(f,()=>loadPrivateContent(f.env,owner,scope));for(const copy of rows(f,'experience_guest_image_stage_copies'))assert.equal(Object.hasOwn(ordinary,copy.content_id),false);}
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);noQuote();
});

for(const ack of ['lost','sparse','false','truncated'])test(`canonical ${ack} stage-copy acknowledgement recovers the one recorded claim`,async t=>{
  const f=await canonicalClaimFixture(t,'quoted'),before=snapshot(f),done=batchHook(f,stageCopyBatch,result=>{
    if(ack==='lost')throw Error('fixture lost canonical stage-copy acknowledgement');if(ack==='truncated')return result.slice(0,-1);
    if(ack==='sparse'){const sparse=[...result];delete sparse[0];return sparse;}return result.map((row,index)=>index?row:{...row,success:false});
  });let result;try{result=await f.claim();}finally{done();}
  const receipt=assertStageClaim(f,result,{replayed:true});preserveOriginalRows(f,before);await assertStageHistory(f);
  assert.equal(canonicalEvents(f).length,f.committed.head+1);assert.equal(rows(f,'experience_guest_image_stage_custodies').length,1);
  assert.equal(rows(f,'experience_guest_claim_leases')[0].acquisitions,1);
  assert.deepEqual({...assertStageClaim(f,await readOnly(f,()=>f.claim(proofless(f))),{replayed:true}),replayed:false},{...receipt,replayed:false});
});

for(const damage of ['source confirmation','canonical consent','canonical history body'])test(`canonical late ${damage} inside the actual copy batch rolls back all custody writes`,async t=>{
  const f=await canonicalClaimFixture(t,'quoted'),before=snapshot(f),done=mutationHook(f,sql=>/^INSERT INTO experience_guest_image_stage_custodies\(/u.test(sql),()=>{
    if(damage==='source confirmation')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=private_json||' ' WHERE private_event_id=?").run(f.confirmed.eventId);
    else if(damage==='canonical consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner);
    else f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE owner_id=? AND kind='guest-image-stage-history'").run(owner);
  });try{await assert.rejects(f.claim());}finally{done();}
  onlyLeaseChanged(f,before);assert.equal(rows(f,'experience_guest_claim_leases').length,1,'the separate native lease preserves the original bounded intent');
  assert.deepEqual(canonicalEvents(f),[]);for(const table of ['experience_guest_context_adoptions','experience_guest_image_claims','experience_guest_image_stage_custodies','experience_guest_image_stage_copies'])assert.deepEqual(rows(f,table),[]);
});

test('canonical claim refuses original input tampering, stale authority and incompatible replay identity',async t=>{
  const f=await canonicalClaimFixture(t,'confirmed');
  for(const input of [{...f.claimInput,approvedManifestDigest:`sha256:${'a'.repeat(64)}`},{...f.claimInput,destinationUserId:owner},
    {...f.claimInput,sourceProof:{sql:'1',bindings:[]}},{...f.claimInput,proof:{...f.proof,sessionToken:f.proof.claimToken}},proofless(f)])await denied(f,()=>f.claim(input));
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner);await denied(f,()=>f.claim());
  f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,owner);
  assertStageClaim(f,await f.claim());
  for(const input of [{...proofless(f),requestId:'different-request'},{...proofless(f),approvedManifestDigest:`sha256:${'b'.repeat(64)}`}])await denied(f,()=>f.claim(input));
  await denied(f,()=>f.claim(proofless(f),canonicalRequest(other)));await denied(f,()=>f.history(canonicalRequest(other)));
});

test('canonical claim snapshots caller input before native awaits and retains the approved original intent',async t=>{
  const f=await canonicalClaimFixture(t,'confirmed'),input=structuredClone(f.claimInput),done=mutationHook(f,sql=>sql.startsWith('SELECT')&&sql.includes('FROM users'),()=>{
    input.requestId='mutated-after-call';input.approvedManifestDigest=`sha256:${'b'.repeat(64)}`;input.proof.sessionToken='changed';
  });let result;try{result=await f.claim(input);}finally{done();}assertStageClaim(f,result);assert.equal(result.receipt.requestId,f.claimInput.requestId);
});

test('canonical existing logical identity collision cannot append or overwrite guest stage custody',async t=>{
  const f=await canonicalClaimFixture(t,'quoted');await appendAuditEvent(f.env,`creative:${owner}`,'user','ProjectCreated',{project_id:f.session.projectId,name:'Existing conflicting project'});
  const before=snapshot(f);await assert.rejects(f.claim());onlyLeaseChanged(f,before);
  assert.equal(rows(f,'experience_guest_image_stage_custodies').length,0);assert.equal(canonicalEvents(f).length,1);
});

test('canonical source expiry does not shorten the independently retained history or authorize another copy',async t=>{
  const f=await canonicalClaimFixture(t,'quoted',{draftLifetimeMs:2000});assertStageClaim(f,await f.claim());const before=snapshot(f);
  await sourceDue(f);await assertStageHistory(f);assertStageClaim(f,await readOnly(f,()=>f.claim(proofless(f))),{replayed:true});assert.deepEqual(snapshot(f),before);
  const copies=rows(f,'private_content').filter(row=>row.kind==='guest-image-stage-history');assert.equal(copies.length,3);assert.ok(copies.every(row=>row.expires_at>f.claimInventory.expiresAt));
});

for(const damage of ['body bytes','body tombstone','body expiry drift','partial Memory','canonical consent'])test(`canonical current history read refuses ${damage} after a genuine claim`,async t=>{
  const f=await canonicalClaimFixture(t,'quoted',{memory:damage==='partial Memory'});assertStageClaim(f,await f.claim());const copy=rows(f,'experience_guest_image_stage_copies')[0];
  if(damage==='body bytes')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(copy.content_id);
  else if(damage==='body tombstone')f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_id=?").run(copy.content_id);
  else if(damage==='body expiry drift')f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run('2000-01-01T00:00:00.000Z',copy.content_id);
  else if(damage==='partial Memory')f.sqlite.exec('DROP TABLE memory_structured_answer_originals');
  else f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner);
  await denied(f,()=>f.history());
  if(['body bytes','body tombstone','body expiry drift'].includes(damage))assertStageClaim(f,await readOnly(f,()=>f.claim(proofless(f))),{replayed:true,retained:false});
  else await denied(f,()=>f.claim(proofless(f)));
});

for(const damage of ['body bytes','Memory schema'])test(`canonical final history proof refuses late ${damage} without disclosing captured private content`,async t=>{
  const f=await canonicalClaimFixture(t,'quoted',{memory:true});assertStageClaim(f,await f.claim());let after;
  const done=mutationHook(f,sql=>sql.startsWith('SELECT content FROM private_content WHERE content_id='),()=>{
    if(damage==='body bytes')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=(SELECT content_id FROM experience_guest_image_stage_copies WHERE role='confirmation')").run();
    else f.sqlite.exec('DROP TABLE memory_document_job_origin_dependencies');after=snapshot(f);
  });try{await assert.rejects(f.history());}finally{done();}assert.ok(after);assert.deepEqual(snapshot(f),after);
});

test('real native expired predecessor cannot yield a successor older than the captured observation clock',{timeout:75000},async t=>{
  const f=await stageFixture(t,'confirmed',{draftLifetimeMs:180000}),initialInventory=await f.inspect();await f.acquire(initialInventory);
  const original={...rows(f,'experience_guest_claim_leases')[0]},start=performance.now();
  while(f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now<original.expires_at_ms){assert.ok(performance.now()-start<65000);await delay(50);}
  await delay(100);const inventory=await f.inspect(),data=guestImageStageClaimInventoryData(f.env,inventory);assert.ok(data.leaseObservedAtMs>original.expires_at_ms);
  const successorExpiry=original.expires_at_ms+f.terms.leaseLifetimeMs;
  assert.ok(successorExpiry<data.leaseObservedAtMs+f.terms.leaseLifetimeMs);
  const sql='UPDATE experience_guest_claim_leases SET acquisitions=2,request_id=?,request_ids_json=?,expires_at_ms=? WHERE session_id=?',
    bindings=['stage-request-2',JSON.stringify([original.request_id,'stage-request-2']),successorExpiry,f.session.sessionId];
  // The native trigger permits this expired-row transition shape. Deliberately
  // install its adverse clock value with the trigger intact, then require the
  // application proof to reject it against the original captured observation.
  assert.equal(f.sqlite.prepare(sql).run(...bindings).changes,1);
  assert.deepEqual({...rows(f,'experience_guest_claim_leases')[0]},{...original,acquisitions:2,request_id:'stage-request-2',request_ids_json:bindings[1],expires_at_ms:successorExpiry});
  await denied(f,()=>f.acquire(inventory,'stage-request-2'));
  t.diagnostic(JSON.stringify({originalExpiresAtMs:original.expires_at_ms,inventoryObservedAtMs:data.leaseObservedAtMs,adverseSuccessorExpiresAtMs:successorExpiry,elapsedMs:performance.now()-start}));
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

registerOutputSourceImports();
const [{ensureSchema},{GUEST_CUSTODY_SCHEMA,readGuestCustodyTerms,issueGuestClaimSession},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},
  {inspectGuestContextInventory,guestContextInventoryData},{registeredExperience,initialValues},{canonicalJson,digest}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'),import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts')]);
const origin='https://guest.example.invalid',authored='A blue heron on a stone bridge';
const request=()=>new Request(`${origin}/unregistered-inventory`,{method:'POST',headers:{origin}});
const guestProof=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const unavailable=/guest_custody_context_inventory_unavailable/u;
const denied=/guest_custody_(?:context_inventory_unavailable|proof_unavailable|source_unavailable|source_commit_unavailable|policy_unavailable)/u;
const queryLimits={functionArguments:32,parameters:100,sqlBytes:100000};
const now='2026-01-01T00:00:00.000Z',later='2099-01-01T00:00:00.000Z';
const tableRows=(f,table)=>f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
const nativeSnapshot=f=>Object.fromEntries(['events','event_private_payloads','event_client_receipts','private_content','experience_guest_sources',
  'experience_guest_source_commits','experience_guest_sessions','experience_guest_policies','experience_guest_source_policies'].map(table=>[table,tableRows(f,table)]));
function insert(f,table,row){const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));}

async function fixture(t,{committed=true,draftLifetimeMs=60000}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA])f.sqlite.exec(sql);
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:Date.now()-60000,expiresAtMs:Date.now()+600000,
    sessionLifetimeMs:300000,leaseLifetimeMs:60000,maximumSessions:5,maximumLeaseAcquisitions:2});
  insert(f,'experience_guest_policies',{policy_id:terms.policyId,terms_digest:await digest(terms),terms_json:canonicalJson(terms),review_digest:`sha256:${'b'.repeat(64)}`});
  const session=await issueGuestClaimSession(request(),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:authored,provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const policy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),
    releaseHash:release.releaseHash,maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  insert(f,'experience_guest_source_policies',{policy_id:policy.policyId,policy_digest:await digest(policy),policy_json:canonicalJson(policy),review_digest:`sha256:${'c'.repeat(64)}`});
  const proof=guestProof(session),input={proof,policyId:policy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}};
  const prepared=await prepareGuestImageSource(request(),f.env,input);
  const commit=committed?await commitGuestImageSource(request(),f.env,{proof,draftHash:prepared.plan.draftHash}):null;
  t.mock.method(globalThis,'fetch',()=>{throw Error('network forbidden');});
  for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{throw Error('media forbidden');});
  return {...f,session,terms,policy,proof,prepared,commit,inspect:(input={proof})=>inspectGuestContextInventory(request(),f.env,input),
    unpaid:()=>{for(const table of ['users','document_jobs','budget_reservations','cost_budget_reservations','output_execution_grants','output_provider_calls'])
      assert.equal(tableRows(f,table).length,0,table);}};
}
async function allows(f,proof){return Boolean(await f.DB.prepare(`SELECT 1 AS allowed WHERE ${proof.sql}`).bind(...proof.bindings).first());}
async function expire(f){const started=performance.now();while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS expired FROM experience_guest_sources").get().expired){
  assert.ok(performance.now()-started<5000);await delay(10);}}
function appendEvent(f,type,{stream=`creative:${f.session.guestSubject}`,actor=f.session.guestSubject}={}){
  const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(stream).n??0;
  insert(f,'events',{event_id:crypto.randomUUID(),stream_id:stream,sequence:head+1,occurred_at:now,recorded_at:now,actor,client_id:'fixture:later',
    correlation_id:'fixture:later',schema_version:1,type,payload:JSON.stringify({project_id:f.session.projectId,document_id:f.session.documentId})});
}
function corruptEvent(f,sql,...bindings){assert.throws(()=>f.sqlite.prepare(sql).run(...bindings),/append-only/u);
  f.sqlite.exec('DROP TRIGGER events_block_update');f.sqlite.prepare(sql).run(...bindings);}
function deeplyFrozen(value){if(!value||typeof value!=='object')return;assert.ok(Object.isFrozen(value));for(const child of Object.values(value))deeplyFrozen(child);}

test('inventory is a frozen source-free view of one actual committed native guest source without writes',async t=>{
  const f=await fixture(t),before=nativeSnapshot(f),count=changes(f),view=await f.inspect();
  assert.deepEqual(Object.keys(view).sort(),['version','sessionId','guestSubject','projectId','documentId','draftHash','sourceHead','expiresAt','manifestDigest'].sort());
  assert.equal(view.version,1);assert.equal(view.sessionId,f.session.sessionId);assert.equal(view.guestSubject,f.session.guestSubject);
  assert.equal(view.projectId,f.session.projectId);assert.equal(view.documentId,f.session.documentId);assert.equal(view.draftHash,f.prepared.plan.draftHash);
  assert.equal(view.sourceHead,f.commit.head);assert.equal(view.expiresAt,f.prepared.expiresAt);assert.match(view.manifestDigest,/^sha256:[a-f0-9]{64}$/u);
  assert.ok(Object.values(view).every(value=>['string','number'].includes(typeof value)));deeplyFrozen(view);
  const serialized=JSON.stringify(view);for(const secret of [authored,f.session.sessionToken,f.session.claimToken])assert.ok(!serialized.includes(secret));
  const data=guestContextInventoryData(f.env,view);deeplyFrozen(data);assert.deepEqual(data.plan,f.prepared.plan);assert.deepEqual(data.sourceEventIds,f.commit.eventIds);
  assert.equal(await digest(data.manifest),view.manifestDigest);
  assert.equal(await allows(f,data.proof),true);assert.equal(await allows(f,data.sourceProof),true);
  assert.equal(changes(f),count);assert.deepEqual(nativeSnapshot(f),before);f.unpaid();
});
test('preparation alone cannot mint inventory or silently commit native source',async t=>{
  const f=await fixture(t,{committed:false}),before=nativeSnapshot(f),count=changes(f);await assert.rejects(f.inspect(),denied);
  assert.equal(changes(f),count);assert.deepEqual(nativeSnapshot(f),before);assert.equal(tableRows(f,'events').length,0);assert.equal(tableRows(f,'experience_guest_source_commits').length,0);
});
test('wrong purpose or foreign guest proof cannot inspect the native source',async t=>{
  const f=await fixture(t),other=await issueGuestClaimSession(request(),f.env,f.terms.policyId),count=changes(f);
  for(const proof of [{...f.proof,sessionToken:f.session.claimToken},{...f.proof,claimToken:other.claimToken},guestProof(other),{...f.proof,sessionId:'missing'}])
    await assert.rejects(f.inspect({proof}),denied);
  assert.equal(changes(f),count);f.unpaid();
});
test('copied, serialized and forged inventory views cannot release trusted source proof',async t=>{
  const f=await fixture(t),view=await f.inspect(),data=guestContextInventoryData(f.env,view);
  for(const forged of [{...view},structuredClone(view),JSON.parse(JSON.stringify(view)),Object.freeze({...view}),{},null])
    assert.throws(()=>guestContextInventoryData(f.env,forged),unavailable);
  assert.strictEqual(guestContextInventoryData({...f.env},view),data);
  const foreign=outputTestDatabase();t.after(()=>foreign.sqlite.close());assert.throws(()=>guestContextInventoryData(foreign.env,view),/guest_custody_(?:context_inventory_unavailable|database_changed)/u);
  assert.throws(()=>{view.documentId='other';},TypeError);assert.throws(()=>{data.proof.bindings.push('other');},TypeError);
});
test('full proof requires live guest authority while source proof survives only exact-session revocation',async t=>{
  const f=await fixture(t),view=await f.inspect(),data=guestContextInventoryData(f.env,view);
  f.sqlite.prepare('UPDATE experience_guest_sessions SET revoked_at_ms=1 WHERE session_id=?').run(f.session.sessionId);
  assert.equal(await allows(f,data.proof),false);assert.equal(await allows(f,data.sourceProof),true);
  await assert.rejects(f.inspect(),denied);
  f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');assert.equal(await allows(f,data.sourceProof),false);
});
test('source-issuance policy revocation preserves existing source proofs and manifest identity',async t=>{
  const f=await fixture(t),view=await f.inspect(),data=guestContextInventoryData(f.env,view);
  f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');
  assert.equal(await allows(f,data.proof),true);assert.equal(await allows(f,data.sourceProof),true);
  const replay=await f.inspect();assert.equal(replay.manifestDigest,view.manifestDigest);assert.deepEqual(guestContextInventoryData(f.env,replay).manifest,data.manifest);
});
test('database-time source expiry invalidates both captured proofs',async t=>{
  const f=await fixture(t,{draftLifetimeMs:300}),data=guestContextInventoryData(f.env,await f.inspect());await expire(f);
  t.mock.method(Date,'now',()=>0);assert.equal(await allows(f,data.proof),false);assert.equal(await allows(f,data.sourceProof),false);await assert.rejects(f.inspect(),denied);
});

const sourceMutations={
  'draft bytes drift':f=>f.sqlite.prepare("UPDATE private_content SET content='{}' WHERE content_id=?").run(f.prepared.plan.draftId),
  'draft redaction':f=>f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(now,f.prepared.plan.draftId),
  'draft owner drift':f=>f.sqlite.prepare("UPDATE private_content SET owner_id='other' WHERE content_id=?").run(f.prepared.plan.draftId),
  'native private bytes drift':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(f.commit.eventIds[0]),
  'native private redaction':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(now,f.commit.eventIds[0]),
  'native private owner drift':f=>f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(f.commit.eventIds[0]),
  'native private Document drift':f=>f.sqlite.prepare("UPDATE event_private_payloads SET document_id='other' WHERE private_event_id=?").run(f.commit.eventIds[0]),
  'missing native client receipt':f=>f.sqlite.prepare('DELETE FROM event_client_receipts WHERE event_id=?').run(f.commit.eventIds[0]),
  'native actor metadata drift':f=>corruptEvent(f,"UPDATE events SET actor='other' WHERE event_id=?",f.commit.eventIds[0]),
  'native public payload drift':f=>corruptEvent(f,"UPDATE events SET payload='{}' WHERE event_id=?",f.commit.eventIds[0]),
  'later DocumentRemoved':f=>appendEvent(f,'DocumentRemoved'),
  'later ProjectRemoved':f=>appendEvent(f,'ProjectRemoved'),
  'later unknown event':f=>appendEvent(f,'FutureUnknownEvent'),
  'revoked session policy':f=>f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1'),
};
for(const [name,mutate] of Object.entries(sourceMutations))test(`${name} invalidates both captured source and live proof and prevents remint`,async t=>{
  const f=await fixture(t),data=guestContextInventoryData(f.env,await f.inspect());mutate(f);const before=nativeSnapshot(f),count=changes(f);
  assert.equal(await allows(f,data.proof),false);assert.equal(await allows(f,data.sourceProof),false);await assert.rejects(f.inspect(),denied);
  assert.equal(changes(f),count);assert.deepEqual(nativeSnapshot(f),before);
});

const closureMutations={
  'extra guest private body':f=>insert(f,'private_content',{content_id:'extra',owner_id:f.session.guestSubject,kind:'text',content:'extra',created_at:now,expires_at:later}),
  'extra guest external body':f=>insert(f,'external_content',{content_id:'extra',owner_id:f.session.guestSubject,content:'external',created_at:now}),
  'orphan guest private event':f=>insert(f,'event_private_payloads',{private_event_id:'orphan',owner_id:f.session.guestSubject,project_id:f.session.projectId,
    document_id:f.session.documentId,private_json:'{}',created_at:now}),
  'guest event in another stream':f=>appendEvent(f,'FutureUnknownEvent',{stream:'creative:other'}),
  'generation preflight':f=>insert(f,'generation_preflights',{preflight_id:'preflight',owner_id:f.session.guestSubject,stream_id:`creative:${f.session.guestSubject}`,
    document_id:f.session.documentId,request_key:'request',status:'prepared',result_json:'{}',created_at:now,expires_at:later}),
  'document job':f=>insert(f,'document_jobs',{job_id:'job',owner_id:f.session.guestSubject,stream_id:`creative:${f.session.guestSubject}`,
    document_id:f.session.documentId,kind:'image',status:'queued',source_surface:'fixture',correlation_id:'fixture',requested_sequence:1,
    request_json:'{}',requested_at:now,expires_at:later,updated_at:now}),
  'artifact revision':f=>insert(f,'artifact_revisions',{revision_id:'revision',owner_id:f.session.guestSubject,project_id:f.session.projectId,
    document_id:f.session.documentId,artifact_id:'artifact',revision:1,content_json:'{}',content_sha256:'a'.repeat(64),created_by_user_id:f.session.guestSubject,
    created_at:now,expires_at:later}),
  'token budget reservation':f=>insert(f,'budget_reservations',{reservation_id:'reservation',owner_id:f.session.guestSubject,stream_id:`creative:${f.session.guestSubject}`,
    correlation_id:'fixture',operation:'fixture',period:'fixture',reserved_tokens:1,status:'reserved',created_at:now,updated_at:now}),
  'cost budget reservation':f=>insert(f,'cost_budget_reservations',{reservation_id:'reservation',owner_id:f.session.guestSubject,stream_id:`creative:${f.session.guestSubject}`,
    correlation_id:'fixture',operation:'fixture',period:'fixture',reserved_microusd:1,status:'reserved',created_at:now,updated_at:now}),
  'consequential execution':f=>insert(f,'consequential_executions',{execution_id:'execution',actor_user_id:f.session.guestSubject,stream_id:`creative:${f.session.guestSubject}`,
    project_id:f.session.projectId,document_id:f.session.documentId,operation:'fixture',intent_hash:'fixture',binding_hash:'fixture',consent_ref:'fixture',
    status:'prepared',created_at:now,expires_at:later,updated_at:now}),
  'authoring commit':f=>insert(f,'authoring_commits',{preview_id:'preview',actor_user_id:f.session.guestSubject,operation:'fixture',project_id:f.session.projectId,
    document_id:f.session.documentId,block_id:'block',approval_hash:'fixture',result_json:'{}',last_event_id:f.commit.eventIds[0],verified:1,created_at:now}),
  'whole-Document share':f=>insert(f,'shares',{share_id:'share',token_hash:'fixture',owner_id:f.session.guestSubject,stream_id:`creative:${f.session.guestSubject}`,
    expires_at:later,created_at:now}),
  'output command':f=>insert(f,'output_commands',{scope_key:'fixture',actor_user_id:f.session.guestSubject,command_key:'command',request_digest:'fixture',
    action:'fixture',event_id:f.commit.eventIds[0],created_at:now}),
  'output storage attempt':f=>insert(f,'output_asset_storage_writes',{scope_key:'fixture',asset_id:'asset',owner_user_id:f.session.guestSubject,
    actor_user_id:f.session.guestSubject,project_id:f.session.projectId,document_id:f.session.documentId,command_key:'fixture',request_digest:'fixture',source_digest:'fixture',
    storage_key:'fixture',content_sha256:'a'.repeat(64),byte_length:1,status:'writing',created_at:now,updated_at:now}),
  'organization custody':f=>insert(f,'organization_projects',{project_access_id:'access',project_id:f.session.projectId,organization_id:'organization',
    owner_user_id:'other',status:'active',created_at:now,updated_at:now}),
  'draft retention custody':f=>insert(f,'private_content_retention_scopes',{content_id:f.prepared.plan.draftId,organization_id:'organization',project_access_id:'access',
    project_id:f.session.projectId,actor_user_id:'other',classification:'fixture',policy_version:1,assigned_expires_at:later,created_at:now}),
  'native event custody':f=>insert(f,'project_event_scopes',{event_id:f.commit.eventIds[0],project_access_id:'access',organization_id:'organization',
    project_id:f.session.projectId,owner_user_id:'other',source_stream_id:`creative:${f.session.guestSubject}`,source_sequence:1,project_sequence:1,actor_user_id:'other',created_at:now}),
};
for(const [name,mutate] of Object.entries(closureMutations))test(`${name} closes the context-only inventory and its previously captured proofs`,async t=>{
  const f=await fixture(t),data=guestContextInventoryData(f.env,await f.inspect());mutate(f);const count=changes(f);
  assert.equal(await allows(f,data.proof),false);assert.equal(await allows(f,data.sourceProof),false);await assert.rejects(f.inspect(),denied);assert.equal(changes(f),count);
});
test('completed expired job history still excludes context-only inventory',async t=>{
  const f=await fixture(t),data=guestContextInventoryData(f.env,await f.inspect());closureMutations['document job'](f);
  f.sqlite.exec("UPDATE document_jobs SET status='failed',completed_at='2026-01-01T00:00:00.000Z',expires_at='2026-01-01T00:00:00.000Z'");
  assert.equal(await allows(f,data.proof),false);assert.equal(await allows(f,data.sourceProof),false);await assert.rejects(f.inspect(),denied);
});
test('matching Document custody excludes a job even when its actor and stream are different',async t=>{
  const f=await fixture(t),data=guestContextInventoryData(f.env,await f.inspect());closureMutations['document job'](f);
  f.sqlite.exec("UPDATE document_jobs SET owner_id='other',stream_id='creative:other'");
  assert.equal(await allows(f,data.proof),false);assert.equal(await allows(f,data.sourceProof),false);await assert.rejects(f.inspect(),denied);
});
test('an unrelated native guest source and its sidecars do not block this inventory',async t=>{
  const f=await fixture(t),other=await issueGuestClaimSession(request(),f.env,f.terms.policyId),proof=guestProof(other);
  const prepared=await prepareGuestImageSource(request(),f.env,{proof,policyId:f.policy.policyId,request:{...f.prepared.plan.request,intentId:other.sessionId}});
  const commit=await commitGuestImageSource(request(),f.env,{proof,draftHash:prepared.plan.draftHash});
  const foreign={...f,session:other,prepared,commit};closureMutations['extra guest external body'](foreign);closureMutations['document job'](foreign);
  const before=nativeSnapshot(f),count=changes(f),data=guestContextInventoryData(f.env,await f.inspect());
  assert.equal(await allows(f,data.proof),true);assert.equal(await allows(f,data.sourceProof),true);assert.equal(changes(f),count);assert.deepEqual(nativeSnapshot(f),before);
});

const memoryMigrations=['0027_memory_native_origins.sql','0033_memory_structured_answer_provenance.sql','0034_memory_document_job_origins.sql'];
function installMemory(f){for(const name of memoryMigrations)f.sqlite.exec(readFileSync(new URL(`../drizzle/${name}`,import.meta.url),'utf8'));}
function memoryMarker(f){insert(f,'events',{event_id:crypto.randomUUID(),stream_id:'creative:memory',sequence:1,occurred_at:now,recorded_at:now,
  actor:'worker:memory',client_id:'fixture',correlation_id:'fixture',schema_version:1,type:'AssistantReasoned',
  payload:JSON.stringify({content_ref:f.prepared.plan.draftId,memory_origin_version:{malformed:true}})});}
function jobRegistration(f,slot='answer_content_id',value=f.prepared.plan.draftId){insert(f,'memory_document_job_answer_origins',{
  origin_id:'origin',schema_version:1,recipe_version:'native-document-job-answer-origin-v1',actor_user_id:f.session.guestSubject,
  scope_key:JSON.stringify(['','',f.session.projectId,f.session.documentId]),job_id:'job',turn_id:'turn',user_event_id:'user-event',user_content_id:'user-content',
  answer_event_id:'answer-event',answer_content_id:'answer-content',manifest_content_ref:'manifest',status:'minimized',withdrawn_at:now,
  withdrawal_reason:'erased',[slot]:value});}
for(const memory of ['absent','full'])test(`native ${memory} Memory schema permits read-only inventory and both proofs under strict D1 limits`,async t=>{
  const f=await fixture(t);if(memory==='full')installMemory(f);const count=changes(f),depth=enforceD1ExpressionDepth(f,{queryLimits});
  try{const data=guestContextInventoryData(f.env,await f.inspect());assert.equal(await allows(f,data.proof),true);assert.equal(await allows(f,data.sourceProof),true);depth.assertVerified();}
  finally{depth.restore();}assert.equal(changes(f),count);f.unpaid();
});
for(const kind of ['marker','draft registration','event registration','late schema'])test(`Memory ${kind} invalidates prior context proof and cannot be inventoried`,async t=>{
  const f=await fixture(t);if(kind.endsWith('registration'))installMemory(f);const data=guestContextInventoryData(f.env,await f.inspect());
  if(kind==='marker')memoryMarker(f);else if(kind==='draft registration')jobRegistration(f);else if(kind==='event registration')jobRegistration(f,'answer_event_id',f.commit.eventIds[0]);
  else installMemory(f);
  assert.equal(await allows(f,data.proof),false);assert.equal(await allows(f,data.sourceProof),false);
  if(kind!=='late schema')await assert.rejects(f.inspect(),denied);else assert.ok(await f.inspect());
});
test('a malformed partial native Memory schema cannot certify context-only custody',async t=>{
  const f=await fixture(t);f.sqlite.exec('CREATE TABLE memory_structured_answer_origins(origin_id TEXT,answer_content_id TEXT)');const count=changes(f);
  await assert.rejects(f.inspect(),denied);assert.equal(changes(f),count);
});

test('database replacement after a native custody read rejects the awaited inventory',async t=>{
  const f=await fixture(t),prepare=f.DB.prepare;let swapped=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...args){const bound=bind.call(this,...args),first=bound.first;
    bound.first=async function(){const result=await first.call(this);if(!swapped&&sql.includes('experience_guest_sources')){swapped=true;f.env.DB={...f.DB};}return result;};return bound;};return statement;};
  await assert.rejects(f.inspect(),/guest_custody_database_changed/u);assert.equal(swapped,true);
});
test('database replacement after mint prevents opaque inventory access',async t=>{
  const f=await fixture(t),view=await f.inspect();f.env.DB={...f.DB};assert.throws(()=>guestContextInventoryData(f.env,view),/guest_custody_database_changed/u);
});
function atFinalRead(f,action,{after=false}={}){
  const prepare=f.DB.prepare;let ran=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...args){const bound=bind.call(this,...args),first=bound.first;
      bound.first=async function(){
        const selected=!ran&&sql.startsWith('SELECT 1 AS current WHERE');
        if(selected&&!after){ran=true;action();}
        const result=await first.call(this);
        if(selected&&after){ran=true;action();}return result;
      };return bound;
    };return statement;
  };
  return()=>{f.DB.prepare=prepare;assert.equal(ran,true,'final live native read was intercepted');};
}
for(const [name,mutate] of Object.entries({
  'private source drift':sourceMutations['native private bytes drift'],
  DocumentRemoved:f=>appendEvent(f,'DocumentRemoved'),
  'conflicting Memory marker':memoryMarker,
}))test(`${name} after observation but before the final live read prevents inventory mint`,async t=>{
  const f=await fixture(t);let changedCount;
  const finish=atFinalRead(f,()=>{mutate(f);changedCount=changes(f);});
  await assert.rejects(f.inspect(),unavailable);finish();assert.equal(changes(f),changedCount);
});
test('database replacement after the final live result prevents inventory mint',async t=>{
  const f=await fixture(t),count=changes(f),finish=atFinalRead(f,()=>{f.env.DB={...f.DB};},{after:true});
  await assert.rejects(f.inspect(),/guest_custody_database_changed/u);finish();assert.equal(changes(f),count);
});
test('source proof excludes only revocation and still requires the immutable native session tuple',async t=>{
  const f=await fixture(t),data=guestContextInventoryData(f.env,await f.inspect());
  f.sqlite.prepare('UPDATE experience_guest_sessions SET revoked_at_ms=1 WHERE session_id=?').run(f.session.sessionId);
  assert.equal(await allows(f,data.sourceProof),true);
  const sql='UPDATE experience_guest_sessions SET expires_at_ms=expires_at_ms+1 WHERE session_id=?';
  assert.throws(()=>f.sqlite.prepare(sql).run(f.session.sessionId),/immutable/u);
  f.sqlite.exec('DROP TRIGGER experience_guest_session_update');f.sqlite.prepare(sql).run(f.session.sessionId);
  assert.equal(await allows(f,data.sourceProof),false);assert.equal(await allows(f,data.proof),false);
});

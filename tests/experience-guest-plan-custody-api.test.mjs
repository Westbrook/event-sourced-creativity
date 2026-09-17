import assert from 'node:assert/strict';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';

registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},
  {acquireGuestClaimLease},{GUEST_CONTEXT_ADOPTION_SCHEMA,adoptGuestContextSource},
  {GUEST_PLAN_CUSTODY_SCHEMA,retainGuestContextPlan},{handleExperienceIntake},
  {registeredExperience,initialValues,experienceDraftId,receiptPrefix},{canonicalJson,digest},{appendAuditEvent,readWorkspaceEvents},
  {ExperienceIntakeRuntime},{handleEvents},{foldEvents}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'),import('../worker/experience-guest-claim-lease.ts'),
  import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-intake-api.ts'),import('../src/experiences/intake.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/runtime.ts'),import('../src/experiences/intake-runtime.ts'),
  import('../worker/events-api.ts'),import('../src/model/events.ts')]);
const origin='https://guest.example.invalid',owner='owner',subject='A blue heron on a stone bridge';
const headers=(actor=owner,extra={})=>({...actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{},...extra});
const internalPost=()=>new Request(`${origin}/unregistered-plan`,{method:'POST',headers:headers(owner,{origin})});
const guestPost=()=>new Request(`${origin}/unregistered-source`,{method:'POST',headers:{origin}});
const proof=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const tableExists=(f,name)=>Boolean(f.sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
const rows=(f,table)=>tableExists(f,table)?f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all():null;
const protectedTables=['users','private_content','events','event_private_payloads','event_client_receipts','experience_guest_plan_custodies',
  'experience_guest_sources','experience_guest_source_commits','experience_guest_context_adoptions','experience_guest_sessions','experience_guest_claim_leases',
  'budget_counters','cost_budget_counters','budget_reservations','cost_budget_reservations','document_jobs','output_execution_grants','output_operation_slots','output_provider_calls'];
const snapshot=f=>Object.fromEntries(protectedTables.map(table=>[table,rows(f,table)]));
const count=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
const schema=f=>f.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
async function base(t){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  for(const actor of [owner,'other'])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headers(actor)}),f.env)).status,200);
  f.sqlite.prepare("UPDATE users SET consent_version=?,role='creator'").run(POLICY_VERSION);
  f.env.FORMA_RETENTION_DAYS='2';
  let forbidden=0;const sentinel=()=>{forbidden++;throw Error('network/media forbidden');};
  t.mock.method(globalThis,'fetch',sentinel);for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,sentinel);
  t.after(()=>assert.equal(forbidden,0,'No attempted provider, network or media operation, including swallowed failures'));
  const call=(path,{actor=owner,method='GET',body,extra={},urlOrigin=origin}={})=>handleExperienceIntake(new Request(`${urlOrigin}/api/experiences/${path}`,{
    method,headers:headers(actor,{...(method==='POST'?{origin,'content-type':'application/json'}:{}),...extra}),
    ...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);
  return {...f,call};
}
async function fixture(t,{retain=true,mappingSchema=true,targetHistory=false}={}){
  const f=await base(t);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...GUEST_CONTEXT_ADOPTION_SCHEMA,...mappingSchema?GUEST_PLAN_CUSTODY_SCHEMA:[]])f.sqlite.exec(sql);
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:Date.now()-60000,expiresAtMs:Date.now()+600000,
    sessionLifetimeMs:300000,leaseLifetimeMs:120000,maximumSessions:5,maximumLeaseAcquisitions:3});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(guestPost(),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:subject,provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const policy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,
    maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs:120000});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(policy.policyId,await digest(policy),canonicalJson(policy),`sha256:${'c'.repeat(64)}`);
  const prepared=await prepareGuestImageSource(guestPost(),f.env,{proof:proof(session),policyId:policy.policyId,
    request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}});
  await commitGuestImageSource(guestPost(),f.env,{proof:proof(session),draftHash:prepared.plan.draftHash});
  if(targetHistory)await appendAuditEvent(f.env,`creative:${owner}`,'user','ProjectCreated',{project_id:crypto.randomUUID(),name:'Existing project',state:'active'});
  const inventory=await inspectGuestContextInventory(guestPost(),f.env,{proof:proof(session)});
  const lease=await acquireGuestClaimLease(internalPost(),f.env,{proof:proof(session),requestId:'request-1',manifestDigest:inventory.manifestDigest});
  const adopted=await adoptGuestContextSource(internalPost(),f.env,{inventory,leaseId:lease.leaseId,requestId:'request-1'});
  const retained=retain?await retainGuestContextPlan(internalPost(),f.env,{sessionId:session.sessionId}):null;
  return {...f,session,prepared,inventory,adopted,retained,path:`drafts/${prepared.plan.draftId}`};
}
async function readOnly(f,run){const before=snapshot(f),writes=count(f),beforeSchema=schema(f);const result=await run();
  assert.equal(count(f),writes,'GET did not execute any native writes');assert.deepEqual(snapshot(f),before);assert.deepEqual(schema(f),beforeSchema);return result;}
async function denied(response,status){if(status!==undefined)assert.equal(response.status,status);else assert.ok(response.status>=400,response.status);
  const body=await response.json();assert.equal(body.plan,undefined);assert.equal(body.custody,undefined);assert.equal(body.appended,undefined);assert.ok(!JSON.stringify(body).includes(subject));return body;}
function canonicalReceipt(f,body){
  assert.equal(body.status,'context-only');assert.equal(body.generationAvailable,false);assert.equal(body.miniAppClaimComplete,false);
  assert.deepEqual(body.plan,f.prepared.plan);assert.equal(body.expiresAt,f.retained.expiresAt);
  assert.equal(body.custody.kind,'guest-context');assert.equal(body.custody.draftId,f.prepared.plan.draftId);
  assert.equal(body.custody.draftHash,f.prepared.plan.draftHash);assert.equal(body.custody.targetStreamId,`creative:${owner}`);
  assert.equal(body.custody.projectId,f.session.projectId);assert.equal(body.custody.documentId,f.session.documentId);
  assert.equal(body.custody.head,f.adopted.head);assert.deepEqual(body.custody.eventIds,f.adopted.eventIds);
  assert.equal(body.custody.appended.length,f.adopted.eventIds.length);
  for(const [index,event] of body.custody.appended.entries()){
    const actual=f.sqlite.prepare('SELECT e.*,p.private_json FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.event_id=?').get(event.eventId);
    assert.ok(actual);assert.equal(event.eventId,f.adopted.eventIds[index]);assert.equal(event.streamId,actual.stream_id);assert.equal(event.streamId,`creative:${owner}`);
    assert.equal(event.actor,actual.actor);assert.equal(event.actor,'user');assert.equal(event.clientId,actual.client_id);assert.equal(event.sequence,actual.sequence);
    assert.equal(event.type,actual.type);assert.deepEqual(event.payload,JSON.parse(actual.private_json));
    assert.deepEqual(event,{eventId:actual.event_id,streamId:actual.stream_id,sequence:actual.sequence,occurredAt:actual.occurred_at,recordedAt:actual.recorded_at,
      actor:actual.actor,clientId:actual.client_id,correlationId:actual.correlation_id,causationId:actual.causation_id,compensatesEventId:actual.compensates_event_id,
      schemaVersion:actual.schema_version,type:actual.type,payload:JSON.parse(actual.private_json)});
  }
}

for(const suffix of ['','/receipt'])test(`explicit original draft GET${suffix} returns original plan and real canonical receipt without writes`,async t=>{
  const f=await fixture(t);const response=await readOnly(f,()=>f.call(f.path+suffix));assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');canonicalReceipt(f,await response.json());
  const repeated=await readOnly(f,()=>f.call(f.path+suffix,{extra:{origin}}));canonicalReceipt(f,await repeated.json());
});
test('canonical intent GET never discovers a guest plan through the explicit-ID fallback',async t=>{
  const f=await fixture(t),ordinaryId=await experienceDraftId(owner,f.session.sessionId);assert.notEqual(ordinaryId,f.prepared.plan.draftId);
  await readOnly(f,async()=>{await denied(await f.call(`drafts?intentId=${f.session.sessionId}`),404);await denied(await f.call(`drafts/${ordinaryId}`),404);});
});
for(const mappingSchema of [true,false])test(`missing ${mappingSchema?'mapping':'mapping schema'} GET cannot retain or initialize guest plan custody`,async t=>{
  const f=await fixture(t,{retain:false,mappingSchema});const before=schema(f);
  await readOnly(f,async()=>{await denied(await f.call(f.path),404);await denied(await f.call(f.path+'/receipt'),404);});
  assert.deepEqual(schema(f),before);assert.equal(tableExists(f,'experience_guest_plan_custodies'),mappingSchema);
  if(mappingSchema)assert.deepEqual(rows(f,'experience_guest_plan_custodies'),[]);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE owner_id=?").get(owner).n,0);
});
test('missing all guest support remains a read-only ordinary 404 without schema activation',async t=>{
  const f=await base(t),id=`experience-draft-${'a'.repeat(64)}`;
  await readOnly(f,async()=>{await denied(await f.call(`drafts/${id}`),404);await denied(await f.call(`drafts/${id}/receipt`),404);});
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'experience_guest_%'").get().n,0);
});
test('ordinary canonical prepare, commit, read and receipt remain native after adding the guest fallback',async t=>{
  const f=await base(t),release=await registeredExperience('image'),values=initialValues(release),intentId=crypto.randomUUID();
  values.subject={value:'An ordinary canonical garden',provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const preparedResponse=await f.call('drafts',{method:'POST',body:{intentId,experienceId:'image',releaseHash:release.releaseHash,values}});
  assert.equal(preparedResponse.status,200);const prepared=await preparedResponse.json();assert.equal(prepared.status,'prepared');
  assert.equal(prepared.plan.draftId,await experienceDraftId(owner,intentId));assert.equal(prepared.plan.streamId,`creative:${owner}`);
  const path=`drafts/${prepared.plan.draftId}`,committedResponse=await f.call(path+'/commit',{method:'POST',body:{draftHash:prepared.plan.draftHash}});
  assert.equal(committedResponse.status,200);const committed=await committedResponse.json();assert.equal(committed.status,'complete');assert.ok(committed.appended.length);
  await readOnly(f,async()=>{
    const saved=await (await f.call(path)).json();assert.equal(saved.status,'prepared');assert.deepEqual(saved.plan,prepared.plan);assert.equal(saved.custody,undefined);
    const receipt=await (await f.call(path+'/receipt')).json();assert.equal(receipt.status,'complete');assert.deepEqual(receipt.appended,committed.appended);
    assert.equal(receipt.draftId,prepared.plan.draftId);assert.equal(receipt.draftHash,prepared.plan.draftHash);assert.equal(receipt.custody,undefined);
    const intent=await (await f.call(`drafts?intentId=${intentId}`)).json();assert.deepEqual(intent.plan,prepared.plan);
  });
  assert.equal(tableExists(f,'experience_guest_plan_custodies'),false);
  for(const table of ['document_jobs','budget_reservations','cost_budget_reservations','output_execution_grants','output_provider_calls'])assert.deepEqual(rows(f,table),[]);
});
test('POST commit of the original guest draft never mints an ordinary canonical receipt or rewrites custody',async t=>{
  const f=await fixture(t),before=snapshot(f),writes=count(f);
  const response=await f.call(f.path+'/commit',{method:'POST',body:{draftHash:f.prepared.plan.draftHash}});await denied(response,404);
  assert.equal(count(f),writes);assert.deepEqual(snapshot(f),before);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM event_client_receipts WHERE stream_id=? AND client_event_id LIKE ?')
    .get(`creative:${owner}`,receiptPrefix(f.prepared.plan.draftId)+'%').n,0);
});
for(const actor of [null,'other'])test(`${actor??'anonymous'} cannot read or recover another destination's guest plan`,async t=>{
  const f=await fixture(t);await readOnly(f,async()=>{await denied(await f.call(f.path,{actor}));await denied(await f.call(f.path+'/receipt',{actor}));});
});
for(const [name,sql] of [['consent',"UPDATE users SET consent_version=NULL WHERE user_id='owner'"],['role',"UPDATE users SET role='viewer' WHERE user_id='owner'"]])
  test(`current canonical ${name} withdrawal denies API plan and receipt`,async t=>{
    const f=await fixture(t);f.sqlite.exec(sql);await readOnly(f,async()=>{await denied(await f.call(f.path));await denied(await f.call(f.path+'/receipt'));});
  });
for(const type of ['DocumentRemoved','ProjectRemoved'])test(`current ${type} denies API plan and receipt without restoring removed context`,async t=>{
  const f=await fixture(t);await appendAuditEvent(f.env,`creative:${owner}`,'user',type,{project_id:f.session.projectId,document_id:f.session.documentId});
  await readOnly(f,async()=>{await denied(await f.call(f.path),404);await denied(await f.call(f.path+'/receipt'),404);});
});
for(const [name,options] of [['foreign Origin',{extra:{origin:'https://foreign.example.invalid'}}],['cross-site fetch',{extra:{'sec-fetch-site':'cross-site'}}],
  ['foreign URL origin',{urlOrigin:'https://foreign.example.invalid'}],['project context cookie',{extra:{cookie:'forma_project_context=stale'}}],
  ['impersonation cookie',{extra:{cookie:'forma_impersonation=stale'}}]])test(`${name} cannot disclose the guest plan through API fallback`,async t=>{
  const f=await fixture(t);await readOnly(f,async()=>{await denied(await f.call(f.path,options));await denied(await f.call(f.path+'/receipt',options));});
});
for(const damage of ['redacted','expired'])test(`${damage} retained plan copy returns 404 without replacement`,async t=>{
  const f=await fixture(t),mapping=rows(f,'experience_guest_plan_custodies')[0];
  f.sqlite.prepare(`UPDATE private_content SET ${damage==='redacted'?"content='',redacted_at='2026-01-01T00:00:00.000Z'":"expires_at='2026-01-01T00:00:00.000Z'"} WHERE content_id=?`).run(mapping.content_id);
  await readOnly(f,async()=>{await denied(await f.call(f.path),404);await denied(await f.call(f.path+'/receipt'),404);});
});
test('API settlement checks its captured database after the native custody reader has settled',async t=>{
  const f=await fixture(t),prepare=f.DB.prepare,descriptor=Object.getOwnPropertyDescriptor(f.env,'DB'),replacement={...f.DB};
  let armed=false,reads=0;
  Object.defineProperty(f.env,'DB',{configurable:true,get(){return armed&&++reads>=3?replacement:f.DB;}});
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...bindings){const bound=bind.call(this,...bindings),first=bound.first;
      bound.first=async function(){const result=await first.call(this);
        if(sql.startsWith('SELECT 1 WHERE')&&sql.includes('experience_guest_plan_custodies mapping JOIN private_content'))armed=true;
        return result;
      };return bound;
    };return statement;
  };
  try{
    // existing() and readGuestContextPlan() each check their captured binding.
    // Replacement is visible only at the next access: the API's own boundary.
    await readOnly(f,async()=>await denied(await f.call(f.path),404));assert.equal(armed,true);assert.equal(reads,3);
  }finally{f.DB.prepare=prepare;Object.defineProperty(f.env,'DB',descriptor);}
});
test('actual API resumes context-only runtime and recovers after native editing without POST or context reset',async t=>{
  const f=await fixture(t,{targetHistory:true}),calls=[],financialTables=['users','budget_counters','cost_budget_counters','budget_reservations','cost_budget_reservations',
    'document_jobs','output_execution_grants','output_operation_slots','output_provider_calls'];
  const financial=()=>Object.fromEntries(financialTables.map(table=>[table,rows(f,table)])),beforeMoney=financial();
  assert.equal(f.adopted.head,f.prepared.plan.events.length+1,'Prior canonical history makes the adopted head distinct from the guest source head');
  const runtime=new ExperienceIntakeRuntime(f.prepared.plan.release,async(path,init={})=>{
    const requestHeaders=new Headers(init.headers);for(const [key,value] of Object.entries(headers()))requestHeaders.set(key,value);
    calls.push({path,method:init.method??'GET'});
    return handleExperienceIntake(new Request(new URL(path,origin),{...init,headers:requestHeaders}),f.env);
  });
  t.after(()=>runtime.dispose());
  await readOnly(f,()=>runtime.resume(f.prepared.plan.draftId));
  assert.equal(runtime.state.phase,'complete',JSON.stringify(runtime.state.issues));assert.equal(runtime.contextOnly,true);
  assert.deepEqual(runtime.committedPlan,f.prepared.plan);assert.equal(runtime.receipt,undefined);assert.equal(runtime.canRetry,false);
  assert.deepEqual(runtime.contextReceipt,f.retained.custody);assert.equal(runtime.documentRoute,f.retained.custody.documentRoute);
  const callCount=calls.length;
  await readOnly(f,async()=>{await runtime.submit();runtime.back();await runtime.prepare();assert.equal(runtime.change('subject','Replacement settings'),false);});
  assert.equal(calls.length,callCount,'Context-only completion cannot invoke an ordinary prepare or commit');
  const block=f.prepared.plan.events.find(event=>event.type==='BlockCreated'&&event.payload.properties?.text===subject);
  assert.ok(block);const edited='A heron beside a quiet lake';
  const edit=await handleEvents(new Request(`${origin}/api/events`,{method:'POST',headers:headers(owner,{origin,'content-type':'application/json'}),
    body:JSON.stringify({action:'batch',expectedSequence:f.adopted.head,events:[{type:'BlockPropertyEdited',payload:{project_id:f.session.projectId,
      document_id:f.session.documentId,block_id:block.payload.block_id,property_path:'text',old_value:subject,new_value:edited}}]})}),f.env);
  const editBody=await edit.json();assert.equal(edit.status,200,JSON.stringify(editBody));assert.deepEqual(editBody.rejected,[]);assert.equal(editBody.appended.length,1);
  await readOnly(f,()=>runtime.recover());assert.equal(runtime.state.phase,'complete',JSON.stringify(runtime.state.issues));assert.equal(runtime.contextOnly,true);
  assert.deepEqual(runtime.committedPlan,f.prepared.plan);assert.equal(runtime.state.draft.values.subject.value,subject);assert.equal(runtime.receipt,undefined);
  assert.deepEqual(runtime.contextReceipt.eventIds,f.adopted.eventIds);assert.equal(runtime.documentRoute,f.retained.custody.documentRoute);
  assert.equal(calls.at(-1).path,`/api/experiences/${f.path}/receipt`);assert.ok(calls.every(call=>call.method==='GET'));
  const reopened=foldEvents(await readWorkspaceEvents(f.env,`creative:${owner}`),Infinity,f.session.documentId,f.session.projectId);
  assert.equal(reopened.documentId,f.session.documentId);assert.ok(reopened.libraryBlocks.some(item=>item.id===block.payload.block_id&&item.properties.text===edited));
  f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'");
  await readOnly(f,()=>runtime.recover());assert.equal(runtime.state.phase,'uncertain');assert.equal(runtime.contextOnly,true);
  assert.equal(runtime.committedPlan,undefined);assert.equal(runtime.preparedPlan,undefined);assert.equal(runtime.contextReceipt,undefined);assert.equal(runtime.documentRoute,undefined);
  f.sqlite.prepare("UPDATE users SET consent_version=? WHERE user_id='owner'").run(POLICY_VERSION);
  await readOnly(f,()=>runtime.recover());assert.equal(runtime.state.phase,'complete',JSON.stringify(runtime.state.issues));
  assert.deepEqual(runtime.committedPlan,f.prepared.plan);assert.deepEqual(runtime.contextReceipt,f.retained.custody);assert.equal(runtime.receipt,undefined);
  assert.ok(calls.every(call=>call.method==='GET'));assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events WHERE stream_id=?').get(`creative:${owner}`).n,f.adopted.head+1);
  assert.deepEqual(financial(),beforeMoney);
});

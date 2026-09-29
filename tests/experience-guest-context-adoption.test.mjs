import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},
  {inspectGuestContextInventory},{acquireGuestClaimLease},{GUEST_CONTEXT_ADOPTION_SCHEMA,adoptGuestContextSource,readGuestContextAdoption},
  {retireExpiredGuestImageSource},{registeredExperience,initialValues},{canonicalJson,digest},{readWorkspaceEvents,appendAuditEvent,streamHead},
  {foldEvents},{handleEvents}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'),import('../worker/experience-guest-claim-lease.ts'),import('../worker/experience-guest-context-adoption.ts'),
  import('../worker/experience-guest-source-retirement.ts'),import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),
  import('../worker/runtime.ts'),import('../src/model/events.ts'),import('../worker/events-api.ts')]);

const origin='https://guest.example.invalid',owner='owner',targetStream=`creative:${owner}`,subject='A blue heron on a stone bridge';
const headers=(actor=owner,extra={})=>({origin,...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...extra});
const request=(actor=owner,extra={})=>new Request(`${origin}/unregistered-context-adoption`,{method:'POST',headers:headers(actor,extra)});
const proof=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const count=(f,table)=>rows(f,table).length;
const financialTables=['users','budget_counters','cost_budget_counters','budget_reservations','cost_budget_reservations','document_jobs',
  'output_execution_grants','output_operation_slots','output_provider_calls'];
const finances=f=>Object.fromEntries(financialTables.map(table=>[table,rows(f,table)]));
const originals=f=>({events:f.sqlite.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence').all(`creative:${f.session.guestSubject}`),
  bodies:f.sqlite.prepare('SELECT body.* FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.stream_id=? ORDER BY event.sequence').all(`creative:${f.session.guestSubject}`),
  receipts:f.sqlite.prepare('SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY sequence').all(`creative:${f.session.guestSubject}`),
  draft:rows(f,'private_content'),source:rows(f,'experience_guest_sources'),commit:rows(f,'experience_guest_source_commits'),leases:rows(f,'experience_guest_claim_leases')});
const targetRows=f=>f.sqlite.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence').all(targetStream);
const adoptionBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO experience_guest_context_adoptions'));

async function fixture(t,{draftLifetimeMs=120000,leaseLifetimeMs=120000,acquire=true,inspect=true,commit=true,memory=false,maximumLeaseAcquisitions=3}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  // Real native account setup is fixture-only. Adoption may not bootstrap an account.
  for(const actor of [owner,'other'])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headers(actor)}),f.env)).status,200);
  f.sqlite.prepare("UPDATE users SET consent_version=?,role='creator'").run(POLICY_VERSION);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...GUEST_CONTEXT_ADOPTION_SCHEMA])f.sqlite.exec(sql);
  if(memory)for(const filename of ['0027_memory_native_origins.sql','0033_memory_structured_answer_provenance.sql','0034_memory_document_job_origins.sql'])f.sqlite.exec(readFileSync(new URL('../drizzle/'+filename,import.meta.url),'utf8'));
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:Date.now()-60000,expiresAtMs:Date.now()+600000,
    sessionLifetimeMs:300000,leaseLifetimeMs,maximumSessions:5,maximumLeaseAcquisitions});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(request(null),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:subject,provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const policy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,
    maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(policy.policyId,await digest(policy),canonicalJson(policy),`sha256:${'c'.repeat(64)}`);
  t.mock.method(globalThis,'fetch',()=>{throw Error('network forbidden');});
  for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{throw Error('media forbidden');});
  const sourceInput={proof:proof(session),policyId:policy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}};
  const prepared=await prepareGuestImageSource(request(null),f.env,sourceInput);
  const source=commit?await commitGuestImageSource(request(null),f.env,{proof:proof(session),draftHash:prepared.plan.draftHash}):null;
  const inventory=inspect?await inspectGuestContextInventory(request(null),f.env,{proof:proof(session)}):null;
  const lease=acquire?await acquireGuestClaimLease(request(),f.env,{proof:proof(session),requestId:'request-1',manifestDigest:inventory.manifestDigest}):null;
  const input={inventory,leaseId:lease?.leaseId,requestId:'request-1'},financialBefore=finances(f);
  return {...f,session,terms,policy,prepared,source,sourceInput,inventory,lease,input,
    adopt:(changes={},actor=owner,extra={})=>adoptGuestContextSource(request(actor,extra),f.env,{...input,...changes}),
    recover:(actor=owner,extra={})=>readGuestContextAdoption(request(actor,extra),f.env,{sessionId:session.sessionId}),
    unpaid:()=>assert.deepEqual(finances(f),financialBefore)};
}
function beforeStatement(f,predicate,mutation){
  const prepare=f.DB.prepare;let hit=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
    statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;
      bound.execute=function(kind){if(!hit&&predicate(sql,bindings)){hit=true;mutation(sql,bindings);}return execute.call(this,kind);};return bound;};return statement;};
  return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'transaction interleaving executed');};
}
function beforeBatch(f,mutation){const batch=f.DB.batch;let hit=false;f.DB.batch=async statements=>{
  if(!hit&&adoptionBatch(statements)){hit=true;await mutation(statements);}return batch.call(f.DB,statements);};
  return()=>{f.DB.batch=batch;assert.equal(hit,true,'adoption batch interleaving executed');};}
function afterBatch(f,mutation){const batch=f.DB.batch;let hit=false;f.DB.batch=async statements=>{
  const result=await batch.call(f.DB,statements);if(!hit&&adoptionBatch(statements)){hit=true;return mutation(result,statements);}return result;};
  return()=>{f.DB.batch=batch;assert.equal(hit,true,'post-commit interleaving executed');};}
function assertNoAdoption(f){assert.equal(count(f,'experience_guest_context_adoptions'),0);assert.equal(targetRows(f).length,0);
  assert.equal(f.sqlite.prepare('SELECT revoked_at_ms FROM experience_guest_sessions WHERE session_id=?').get(f.session.sessionId).revoked_at_ms,null);}
async function expire(f){const started=performance.now();while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS expired FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).expired){
  assert.ok(performance.now()-started<5000,'database source deadline reached');await delay(10);}}
function expectedResult(f,value,replayed){assert.equal(value.version,1);assert.equal(value.status,'context-adopted');assert.equal(value.projectId,f.session.projectId);
  assert.equal(value.documentId,f.session.documentId);assert.equal(value.contextCustodyTransferred,true);assert.equal(value.miniAppClaimComplete,false);assert.equal(value.replayed,replayed);
  assert.equal(value.eventIds.length,f.prepared.plan.events.length);assert.ok(value.route.includes(`/document/${f.session.documentId}/`));}

// This is native context custody qualification. It does not exercise a live guest
// route, OTP, providers, generated outputs, mini-app reopening, or deployed D1.
test('native context adoption preserves resource identity and original guest history while creating independent canonical private copies',async t=>{
  const f=await fixture(t),original=originals(f),accepted=await f.adopt();expectedResult(f,accepted,false);
  assert.deepEqual(originals(f),original);assert.equal(count(f,'experience_guest_context_adoptions'),1);
  const lineage=rows(f,'experience_guest_context_adoptions')[0],session=rows(f,'experience_guest_sessions')[0];assert.equal(session.revoked_at_ms,lineage.created_at_ms);
  assert.equal(lineage.destination_user_id,owner);assert.equal(lineage.lease_id,f.lease.leaseId);assert.equal(lineage.manifest_digest,f.inventory.manifestDigest);
  assert.ok(!JSON.stringify(lineage).includes(subject));assert.ok(!JSON.stringify(lineage).includes(f.session.sessionToken));assert.ok(!JSON.stringify(lineage).includes(f.session.claimToken));
  const target=targetRows(f);assert.equal(target.length,f.source.eventIds.length);assert.deepEqual(target.map(row=>row.event_id),accepted.eventIds);
  assert.ok(target.every(row=>row.actor==='user'&&row.client_id==='server:guest-context-adoption'&&row.correlation_id===`guest-context-adoption:${f.session.sessionId}`));
  assert.ok(target.every(row=>!f.source.eventIds.includes(row.event_id)));assert.ok(target.every(row=>!row.payload.includes(subject)));
  const bodies=f.sqlite.prepare('SELECT body.* FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.stream_id=? ORDER BY event.sequence').all(targetStream);
  assert.ok(bodies.every(row=>row.owner_id===owner&&row.project_id===f.session.projectId&&row.redacted_at===null));
  const sourceEvents=await readWorkspaceEvents(f.env,`creative:${f.session.guestSubject}`),targetEvents=await readWorkspaceEvents(f.env,targetStream);
  assert.deepEqual(targetEvents.map(row=>row.type),sourceEvents.map(row=>row.type));
  const projection=foldEvents(targetEvents,Infinity,f.session.documentId,f.session.projectId);
  assert.equal(projection.documentId,f.session.documentId);assert.ok(projection.libraryBlocks.some(block=>block.properties.text===subject));
  await assert.rejects(prepareGuestImageSource(request(null),f.env,f.sourceInput));await assert.rejects(commitGuestImageSource(request(null),f.env,{proof:proof(f.session),draftHash:f.prepared.plan.draftHash}));
  await assert.rejects(inspectGuestContextInventory(request(null),f.env,{proof:proof(f.session)}));f.unpaid();
});

test('actual native editor can edit and reopen the adopted same Document without restoring its baseline',async t=>{
  const f=await fixture(t),accepted=await f.adopt();const sourceBlock=f.prepared.plan.events.find(event=>event.type==='BlockCreated'&&event.payload.properties?.text===subject).payload.block_id;
  const response=await handleEvents(new Request(`${origin}/api/events`,{method:'POST',headers:headers(owner,{'content-type':'application/json'}),
    body:JSON.stringify({action:'batch',expectedSequence:accepted.head,events:[{type:'BlockPropertyEdited',payload:{project_id:f.session.projectId,document_id:f.session.documentId,
      block_id:sourceBlock,property_path:'text',old_value:subject,new_value:'A heron beside a quiet lake'}}]})}),f.env);
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.rejected,[]);assert.equal(body.appended.length,1);
  const reopened=foldEvents(await readWorkspaceEvents(f.env,targetStream),Infinity,f.session.documentId,f.session.projectId);
  assert.equal(reopened.documentId,f.session.documentId);assert.ok(reopened.libraryBlocks.some(block=>block.id===sourceBlock&&block.properties.text==='A heron beside a quiet lake'));
  const before=targetRows(f),recovered=await f.recover();expectedResult(f,recovered,true);assert.deepEqual(recovered.eventIds,accepted.eventIds);assert.deepEqual(targetRows(f),before);f.unpaid();
});

for(const memory of [false,true])test(`the full emitted adoption and recovery SQL fits real parser depth, function, parameter and byte limits with ${memory?'complete':'absent'} Memory schema`,async t=>{
  const f=await fixture(t,{memory}),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{const accepted=await f.adopt();expectedResult(f,accepted,false);expectedResult(f,await f.recover(),true);limits.assertVerified();
    t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}f.unpaid();
});

test('an existing canonical stream retains its earlier history and adoption appends exactly one contiguous range',async t=>{
  const f=await fixture(t);await appendAuditEvent(f.env,targetStream,'user','ProjectCreated',{project_id:'older-project',name:'Existing work'});
  const before=targetRows(f),head=await streamHead(f.env,targetStream),accepted=await f.adopt();assert.equal(accepted.head,head+accepted.eventIds.length);
  assert.deepEqual(targetRows(f).slice(0,before.length),before);assert.deepEqual(targetRows(f).slice(before.length).map(row=>row.sequence),accepted.eventIds.map((_,index)=>head+index+1));f.unpaid();
});

test('exact concurrent adoption returns one native baseline and one completion without changing the lease',async t=>{
  const f=await fixture(t),lease=rows(f,'experience_guest_claim_leases'),results=await Promise.all([f.adopt(),f.adopt()]);
  assert.deepEqual(results[0].eventIds,results[1].eventIds);assert.equal(targetRows(f).length,f.source.eventIds.length);assert.equal(count(f,'experience_guest_context_adoptions'),1);
  assert.deepEqual(rows(f,'experience_guest_claim_leases'),lease);f.unpaid();
});

for(const ack of ['throw','truncated','false','missing'])test(`a ${ack} post-commit acknowledgment recovers the original completion without another baseline`,async t=>{
  const f=await fixture(t),done=afterBatch(f,result=>{if(ack==='throw')throw Error('lost ack');if(ack==='truncated')return result.slice(0,-1);if(ack==='false')return result.map((row,index)=>index?row:{...row,success:false});return undefined;});
  const accepted=await f.adopt();done();expectedResult(f,accepted,true);assert.equal(targetRows(f).length,f.source.eventIds.length);assert.equal(count(f,'experience_guest_context_adoptions'),1);
  const before=targetRows(f);assert.deepEqual((await f.recover()).eventIds,accepted.eventIds);assert.deepEqual(targetRows(f),before);f.unpaid();
});

test('a completion read after revocation and due original source retirement uses independent canonical copies',async t=>{
  const f=await fixture(t,{draftLifetimeMs:500}),accepted=await f.adopt(),targetBefore=targetRows(f);await expire(f);
  const retired=await retireExpiredGuestImageSource(f.env,{sessionId:f.session.sessionId});assert.equal(retired.status,'retired');
  assert.ok(f.sqlite.prepare('SELECT private_json,redacted_at FROM event_private_payloads WHERE owner_id=?').all(f.session.guestSubject).every(row=>row.private_json===''&&row.redacted_at));
  const recovered=await f.recover();expectedResult(f,recovered,true);assert.deepEqual(recovered.eventIds,accepted.eventIds);assert.deepEqual(targetRows(f),targetBefore);
  assert.ok(foldEvents(await readWorkspaceEvents(f.env,targetStream),Infinity,f.session.documentId,f.session.projectId).libraryBlocks.some(block=>block.properties.text===subject));f.unpaid();
});

for(const inventoryKind of ['empty','cloned','spread','wrong-database'])test(`${inventoryKind} inventory cannot authorize custody`,async t=>{
  const f=await fixture(t),original=originals(f),inventory=inventoryKind==='empty'?{}:inventoryKind==='cloned'?structuredClone(f.inventory):inventoryKind==='spread'?{...f.inventory}:f.inventory;
  if(inventoryKind==='wrong-database')f.env.DB={...f.DB};await assert.rejects(f.adopt({inventory}));assertNoAdoption(f);assert.deepEqual(originals(f),original);f.unpaid();
});
for(const change of [{leaseId:'other-lease'},{requestId:'other-request'},{leaseId:null},{extra:'untrusted'}])test(`unproven adoption lease input ${Object.keys(change).join()} refuses`,async t=>{
  const f=await fixture(t);await assert.rejects(f.adopt(change));assertNoAdoption(f);f.unpaid();
});
for(const actor of [null,'nonexistent','guest:forged','other'])test(`destination ${actor??'anonymous'} cannot use another canonical lease`,async t=>{
  const f=await fixture(t);await assert.rejects(f.adopt({},actor));assertNoAdoption(f);f.unpaid();
});
for(const cookie of ['forma_project_context=stale','forma_impersonation=stale'])test(`native personal boundary rejects ${cookie.split('=')[0]}`,async t=>{
  const f=await fixture(t);await assert.rejects(f.adopt({},owner,{cookie}));assertNoAdoption(f);f.unpaid();
});
for(const changed of ['role','consent','pilot'])test(`current destination ${changed} is required before context adoption`,async t=>{
  const f=await fixture(t);if(changed==='role')f.sqlite.exec("UPDATE users SET role='viewer' WHERE user_id='owner'");
  else if(changed==='consent')f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'");else f.env.FORMA_PILOT_COHORT_ID='unprovisioned';
  const snapshot=finances(f);await assert.rejects(f.adopt());assertNoAdoption(f);assert.deepEqual(finances(f),snapshot);
});
for(const badRequest of ['origin','method','request-url','missing-origin'])test(`adoption rechecks ${badRequest} after inventory minting`,async t=>{
  const f=await fixture(t),req=badRequest==='origin'?request(owner,{origin:'https://elsewhere.invalid'}):badRequest==='method'?new Request(`${origin}/x`,{headers:headers()}):
    badRequest==='request-url'?new Request('https://elsewhere.invalid/x',{method:'POST',headers:headers()}):new Request(`${origin}/x`,{method:'POST',headers:{'oai-authenticated-user-id':owner}});
  await assert.rejects(adoptGuestContextSource(req,f.env,f.input));assertNoAdoption(f);f.unpaid();
});

test('already committed source remains adoptable after only new-source policy issuance is revoked',async t=>{
  const f=await fixture(t);f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');expectedResult(f,await f.adopt(),false);f.unpaid();
});
for(const type of ['ProjectRemoved','DocumentRemoved','BlockPropertyEdited','ContextCompiled'])test(`late source ${type} invalidates a minted inventory without writing target custody`,async t=>{
  const f=await fixture(t);await appendAuditEvent(f.env,`creative:${f.session.guestSubject}`,f.session.guestSubject,type,{project_id:f.session.projectId,document_id:f.session.documentId,
    block_id:f.prepared.plan.events.find(event=>event.type==='BlockCreated').payload.block_id,property_path:'text',new_value:'changed'});
  await assert.rejects(f.adopt());assertNoAdoption(f);f.unpaid();
});
for(const [name,type,resource] of [['ProjectCreated','ProjectCreated','project'],['DocumentCreated','DocumentCreated','document'],['DocumentForked','DocumentForked','native-fork'],['historical fork alias','DocumentForked','fork'],
  ['DocumentRemoved','DocumentRemoved','document'],['ProjectRemoved','ProjectRemoved','project'],['BlockCreated','BlockCreated','block']])test(`historical target ${name} resource identity cannot be overwritten by adoption`,async t=>{
  const f=await fixture(t),block=f.prepared.plan.events.find(event=>event.type==='BlockCreated').payload.block_id;
  const payload=resource==='project'?{project_id:f.session.projectId}:resource==='native-fork'?{document_id:f.session.documentId,source_document_id:'old-document',project_id:'old-project'}:resource==='fork'?{document_id:'old-document',new_document_id:f.session.documentId,project_id:'old-project'}:
    resource==='block'?{document_id:'other-document',project_id:'old-project',block_id:block,type:'subject',properties:{text:'Old'}}:{document_id:f.session.documentId,project_id:'old-project'};
  await appendAuditEvent(f.env,targetStream,'user',type,payload);const before=targetRows(f);await assert.rejects(f.adopt());assert.deepEqual(targetRows(f),before);
  assert.equal(count(f,'experience_guest_context_adoptions'),0);assert.equal(rows(f,'experience_guest_sessions')[0].revoked_at_ms,null);f.unpaid();
});

for(const [name,mutation] of Object.entries({
  'guest revocation':f=>f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1'),
  'terms revocation':f=>f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1'),
  'destination consent':f=>f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'"),
  'source private redaction':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(f.source.eventIds.at(-1)),
  'source draft redaction':f=>f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId),
  'source Project custody':f=>f.sqlite.prepare('INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)').run('scope',f.session.projectId,'org','native-owner','active','time','time'),
  'source Document custody':f=>f.sqlite.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?,?,?)').run('scope','document',f.session.documentId,'org',f.session.projectId,'native-owner','collaborative_output',null,'native-owner','time'),
}))test(`atomic ${name} race rolls back the entire target baseline, receipt and guest revocation`,async t=>{
  const f=await fixture(t),original=originals(f),financial=finances(f),done=beforeStatement(f,sql=>sql.startsWith('INSERT INTO event_write_stage'),()=>mutation(f));
  await assert.rejects(f.adopt());done();assertNoAdoption(f);assert.deepEqual(originals(f),original);assert.deepEqual(finances(f),financial);
});

test('a competing canonical stream append before the native batch denies adoption without erasing that write',async t=>{
  const f=await fixture(t),done=beforeBatch(f,()=>appendAuditEvent(f.env,targetStream,'user','ProjectCreated',{project_id:'concurrent-project',name:'Concurrent work'}));
  await assert.rejects(f.adopt());done();assert.equal(targetRows(f).length,1);assert.equal(targetRows(f)[0].type,'ProjectCreated');assert.equal(count(f,'experience_guest_context_adoptions'),0);
  assert.equal(rows(f,'experience_guest_sessions')[0].revoked_at_ms,null);f.unpaid();
});

test('database binding replacement after a committed adoption denies disclosure without duplicating custody',async t=>{
  const f=await fixture(t),done=afterBatch(f,result=>{f.env.DB={...f.DB};return result;});await assert.rejects(f.adopt(),/database_changed/);done();
  assert.equal(count(f,'experience_guest_context_adoptions'),1);assert.equal(targetRows(f).length,f.source.eventIds.length);f.env.DB=f.DB;expectedResult(f,await f.recover(),true);f.unpaid();
});
for(const kind of ['DocumentRemoved','ProjectRemoved'])test(`native target ${kind} prevents completed adoption recovery and never restores removed context`,async t=>{
  const f=await fixture(t);await f.adopt();await appendAuditEvent(f.env,targetStream,'user',kind,{project_id:f.session.projectId,document_id:f.session.documentId});
  const before=targetRows(f);await assert.rejects(f.recover());await assert.rejects(f.adopt());assert.deepEqual(targetRows(f),before);assert.equal(count(f,'experience_guest_context_adoptions'),1);f.unpaid();
});
for(const damage of ['private-redaction','owner','private-bytes','receipt'])test(`damaged target ${damage} denies recovery without reconstructing private content`,async t=>{
  const f=await fixture(t),accepted=await f.adopt(),eventId=accepted.eventIds.at(-1);
  if(damage==='private-redaction')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(eventId);
  else if(damage==='owner')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='other' WHERE private_event_id=?").run(eventId);
  else if(damage==='private-bytes')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(eventId);
  else f.sqlite.prepare('DELETE FROM event_client_receipts WHERE event_id=?').run(eventId);
  const before={events:targetRows(f),private:rows(f,'event_private_payloads'),receipts:rows(f,'event_client_receipts')};await assert.rejects(f.recover());await assert.rejects(f.adopt());
  assert.deepEqual({events:targetRows(f),private:rows(f,'event_private_payloads'),receipts:rows(f,'event_client_receipts')},before);f.unpaid();
});
for(const actor of [null,'other','nonexistent'])test(`completed custody receipt cannot disclose another destination to ${actor??'anonymous'}`,async t=>{
  const f=await fixture(t);await f.adopt();const before=targetRows(f);if(actor==='other')assert.equal(await f.recover(actor),null);else await assert.rejects(f.recover(actor));assert.deepEqual(targetRows(f),before);f.unpaid();
});
for(const change of ['consent','role','pilot'])test(`completion recovery honors current canonical ${change} authorization`,async t=>{
  const f=await fixture(t);await f.adopt();if(change==='consent')f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'");
  else if(change==='role')f.sqlite.exec("UPDATE users SET role='viewer' WHERE user_id='owner'");else f.env.FORMA_PILOT_COHORT_ID='unprovisioned';
  const before=targetRows(f),financial=finances(f);await assert.rejects(f.recover());assert.deepEqual(targetRows(f),before);assert.deepEqual(finances(f),financial);
});

test('completion lineage cannot be rewritten, replaced, deleted or reassigned',async t=>{
  const f=await fixture(t);await f.adopt();const before=rows(f,'experience_guest_context_adoptions');
  for(const sql of ["UPDATE experience_guest_context_adoptions SET destination_user_id='other'","UPDATE experience_guest_context_adoptions SET lineage_json='{}'",
    'DELETE FROM experience_guest_context_adoptions','INSERT OR REPLACE INTO experience_guest_context_adoptions SELECT * FROM experience_guest_context_adoptions'])assert.throws(()=>f.sqlite.exec(sql),/immutable|exists/);
  assert.deepEqual(rows(f,'experience_guest_context_adoptions'),before);expectedResult(f,await f.recover(),true);f.unpaid();
});

test('a minted inventory cannot extend its native source deadline',async t=>{
  const f=await fixture(t,{draftLifetimeMs:300});await expire(f);const original=originals(f);
  await assert.rejects(f.adopt());assertNoAdoption(f);assert.deepEqual(originals(f),original);f.unpaid();
});

test('an expired lease cannot commit custody even while the source remains current',async t=>{
  const f=await fixture(t,{leaseLifetimeMs:300});const started=performance.now();
  while(!f.sqlite.prepare("SELECT expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS expired FROM experience_guest_claim_leases WHERE session_id=?").get(f.session.sessionId).expired){
    assert.ok(performance.now()-started<5000,'database lease deadline reached');await delay(10);}
  const original=originals(f);await assert.rejects(f.adopt());assertNoAdoption(f);assert.deepEqual(originals(f),original);f.unpaid();
});

test('revoked issuance policies cannot revoke already completed personal context custody',async t=>{
  const f=await fixture(t),accepted=await f.adopt();f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1; UPDATE experience_guest_source_policies SET revoked_at_ms=1');
  const before=targetRows(f),recovered=await f.recover();expectedResult(f,recovered,true);assert.deepEqual(recovered.eventIds,accepted.eventIds);assert.deepEqual(targetRows(f),before);f.unpaid();
});

for(const kind of ['project','document'])test(`current ${kind} organization custody denies completed personal recovery`,async t=>{
  const f=await fixture(t);await f.adopt();if(kind==='project')f.sqlite.prepare('INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)').run('scope',f.session.projectId,'org','native-owner','active','time','time');
  else f.sqlite.prepare('INSERT INTO project_resource_scopes VALUES(?,?,?,?,?,?,?,?,?,?)').run('scope','document',f.session.documentId,'org',f.session.projectId,'native-owner','collaborative_output',null,'native-owner','time');
  const before=targetRows(f);await assert.rejects(f.recover());assert.deepEqual(targetRows(f),before);f.unpaid();
});

for(const [name,mutation] of Object.entries({
  'source private bytes':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(f.source.eventIds.at(-1)),
  'source redaction':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(f.source.eventIds.at(-1)),
  'destination consent':f=>f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'"),
}))test(`post-revocation ${name} inside the atomic batch rolls back completed custody`,async t=>{
  const f=await fixture(t),original=originals(f),financial=finances(f),done=beforeStatement(f,
    sql=>sql.startsWith('INSERT INTO experience_guest_context_adoption_assertions')&&rows(f,'experience_guest_sessions')[0].revoked_at_ms!==null,()=>mutation(f));
  await assert.rejects(f.adopt());done();assertNoAdoption(f);assert.deepEqual(originals(f),original);assert.deepEqual(finances(f),financial);
});

for(const [name,mutation] of Object.entries({
  'destination consent':f=>f.sqlite.exec("UPDATE users SET consent_version=NULL WHERE user_id='owner'"),
  'target private redaction':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(targetRows(f).at(-1).event_id),
  'Project organization custody':f=>f.sqlite.prepare('INSERT INTO organization_projects VALUES(?,?,?,?,?,?,?)').run('scope',f.session.projectId,'org','native-owner','active','time','time'),
  'Document removal':f=>appendAuditEvent(f.env,targetStream,'user','DocumentRemoved',{project_id:f.session.projectId,document_id:f.session.documentId}),
}))test(`post-commit ${name} denies disclosure without creating another baseline`,async t=>{
  const f=await fixture(t),done=afterBatch(f,async result=>{await mutation(f);return result;});await assert.rejects(f.adopt());done();
  const before={events:targetRows(f),bodies:rows(f,'event_private_payloads'),receipt:rows(f,'experience_guest_context_adoptions')},financial=finances(f);
  assert.equal(before.receipt.length,1);assert.equal(rows(f,'experience_guest_sessions')[0].revoked_at_ms,before.receipt[0].created_at_ms);
  await assert.rejects(f.recover());await assert.rejects(f.adopt());assert.deepEqual({events:targetRows(f),bodies:rows(f,'event_private_payloads'),receipt:rows(f,'experience_guest_context_adoptions')},before);
  assert.deepEqual(finances(f),financial);
});

test('a superseded lease request cannot claim or recover its successor completion',async t=>{
  const f=await fixture(t,{leaseLifetimeMs:300});const started=performance.now();
  while(!f.sqlite.prepare("SELECT expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS expired FROM experience_guest_claim_leases WHERE session_id=?").get(f.session.sessionId).expired){
    assert.ok(performance.now()-started<5000,'database lease deadline reached');await delay(10);}
  const successor=await acquireGuestClaimLease(request(),f.env,{proof:proof(f.session),requestId:'request-2',manifestDigest:f.inventory.manifestDigest});
  assert.equal(successor.leaseId,f.lease.leaseId);assert.equal(successor.acquisition,2);await assert.rejects(f.adopt());assertNoAdoption(f);
  const accepted=await f.adopt({requestId:'request-2'});expectedResult(f,accepted,false);assert.equal(accepted.requestId,'request-2');const before=targetRows(f);
  await assert.rejects(f.adopt(),/adoption_conflict/);assert.deepEqual(targetRows(f),before);assert.deepEqual((await f.recover()).eventIds,accepted.eventIds);f.unpaid();
});

async function nativeAppend(f,type,payload){
  const response=await handleEvents(new Request(`${origin}/api/events`,{method:'POST',headers:headers(owner,{'content-type':'application/json'}),
    body:JSON.stringify({action:'batch',expectedSequence:await streamHead(f.env,targetStream),events:[{type,payload}]})}),f.env);
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.deepEqual(result.rejected,[]);assert.equal(result.appended.length,1);return result.appended[0];
}
for(const type of ['DocumentCreated','DocumentForked','BlockCreated','ProjectCreated'])test(`later native ${type} reusing an adopted resource ID invalidates current baseline recovery`,async t=>{
  const f=await fixture(t);await f.adopt();const blockId=f.prepared.plan.events.find(event=>event.type==='BlockCreated').payload.block_id;
  const payload=type==='ProjectCreated'?{project_id:f.session.projectId,name:'Replacement Project'}:
    type==='BlockCreated'?{project_id:f.session.projectId,document_id:f.session.documentId,block_id:blockId,type:'subject',handle:'replacement',position:'a0',properties:{text:'Replacement context'}}:
    {project_id:'another-project',document_id:f.session.documentId,source_document_id:'prior-document',title:'Replacement Document',handle:'replacement'};
  if(type==='DocumentCreated'||type==='DocumentForked')await nativeAppend(f,'ProjectCreated',{project_id:'another-project',name:'Another existing Project'});
  const appended=await nativeAppend(f,type,payload),history=await readWorkspaceEvents(f.env,targetStream),projection=foldEvents(history,Infinity);
  if(type==='DocumentCreated'||type==='DocumentForked')assert.equal(projection.documents.find(document=>document.id===f.session.documentId).projectId,'another-project');
  else if(type==='BlockCreated')assert.deepEqual(projection.libraryBlocks.find(block=>block.id===blockId).sourceEvents,[appended.eventId]);
  else assert.equal(projection.projects.find(project=>project.id===f.session.projectId).createdSequence,appended.sequence);
  const before=targetRows(f);await assert.rejects(f.recover());await assert.rejects(f.adopt());assert.deepEqual(targetRows(f),before);f.unpaid();
});

test('ordinary native creation of a fresh context block remains compatible with completed custody recovery',async t=>{
  const f=await fixture(t),accepted=await f.adopt();await nativeAppend(f,'BlockCreated',{project_id:f.session.projectId,document_id:f.session.documentId,
    block_id:'fresh-native-block',type:'subject',handle:'fresh',position:'z0',properties:{text:'Additional native context'}});
  const before=targetRows(f),recovered=await f.recover();expectedResult(f,recovered,true);assert.deepEqual(recovered.eventIds,accepted.eventIds);assert.deepEqual(targetRows(f),before);
  const projection=foldEvents(await readWorkspaceEvents(f.env,targetStream),Infinity,f.session.documentId,f.session.projectId);
  assert.ok(projection.libraryBlocks.some(block=>block.id==='fresh-native-block'&&block.properties.text==='Additional native context'));f.unpaid();
});

test('a bounded native lease history beyond the catalogue string ceiling remains adoptable and recoverable',async t=>{
  const f=await fixture(t,{acquire:false,leaseLifetimeMs:200,maximumLeaseAcquisitions:100});let lease,requestId;
  // These are actual native renewals under the real immutable lease trigger and
  // database clock. No historical row, trigger, timestamp or expiry is rewritten.
  for(let index=0;index<56;index++){
    if(lease)while(!f.sqlite.prepare("SELECT expires_at_ms<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS expired FROM experience_guest_claim_leases WHERE session_id=?").get(f.session.sessionId).expired)await delay(5);
    requestId=`r${String(index).padStart(3,'0')}${'x'.repeat(156)}`;
    lease=await acquireGuestClaimLease(request(),f.env,{proof:proof(f.session),requestId,manifestDigest:f.inventory.manifestDigest});
  }
  const retained=rows(f,'experience_guest_claim_leases')[0];assert.equal(retained.acquisitions,56);assert.ok(retained.request_ids_json.length>8192);
  const accepted=await f.adopt({leaseId:lease.leaseId,requestId});expectedResult(f,accepted,false);assert.equal(accepted.requestId,requestId);
  const before=targetRows(f),recovered=await f.recover();expectedResult(f,recovered,true);assert.deepEqual(recovered.eventIds,accepted.eventIds);
  assert.deepEqual(targetRows(f),before);assert.equal(rows(f,'experience_guest_claim_leases')[0].request_ids_json,retained.request_ids_json);f.unpaid();
});

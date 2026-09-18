import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {fixture,request,rows,snapshot,changes,batchHook,readHook,addLease,digest,insert,origin,GUEST_DB_NOW} from './helpers/guest-image-stage-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
const [{GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{GUEST_IMAGE_SAVE_CLAIM_SCHEMA},{issueGuestClaimSession}]=await Promise.all([
  import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),
  import('../worker/experience-guest-image-claim-inventory.ts'),import('../worker/experience-guest-session.ts')]);

// Genuine native setup is shared with the accepted stage tests. No test module,
// historical Git object, canonical guest principal or fabricated stage is used.
const [{prepareGuestImageConfirmation,confirmGuestImageRequirement},{preflightGuestImage},
  {inspectGuestImageStageInventory,guestImageStageInventoryData}]=await Promise.all([
  import('../worker/experience-guest-image-confirmation.ts'),import('../worker/experience-guest-image-preflight.ts'),
  import('../worker/experience-guest-image-stage-inventory.ts')]);
const states=['confirmed','preflight-claimed-unknown','quoted'];
const reservation=statements=>statements.some(statement=>/^INSERT INTO experience_sponsor_driver_stages\(/u.test(statement.sql));
async function stageFixture(t,state='confirmed',options={}){
  const f=await fixture(t,options),review=await prepareGuestImageConfirmation(request(),f.env,f.input);
  f.confirmed=await confirmGuestImageRequirement(request(),f.env,{...f.input,reviewedRequirementDigest:review.reviewedRequirementDigest,explicitRequirementsConfirmation:true});
  if(state==='preflight-claimed-unknown'){
    const done=batchHook(f,reservation,()=>{throw Error('fixture lost native reservation acknowledgement');});
    try{await assert.rejects(preflightGuestImage(request(),f.env,f.input),/fixture lost native reservation acknowledgement/u);}finally{done();}
  }else if(state==='quoted')f.quoted=await preflightGuestImage(request(),f.env,f.input);
  f.state=state;f.inspect=(input={proof:f.proof},req=request(),env=f.env)=>inspectGuestImageStageInventory(req,env,input);
  assert.equal(rows(f,'events').length,f.committed.head+(state==='quoted'?3:2));
  assert.equal(rows(f,'experience_sponsor_resource_receipts').length,state==='confirmed'?2:3);
  assert.equal(rows(f,'output_preflights').length,state==='quoted'?1:0);
  return f;
}
async function readOnly(f,operation){const before=snapshot(f),count=changes(f),value=await operation();assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);return value;}
async function denied(f,operation=()=>f.inspect()){
  const before=snapshot(f),count=changes(f);await assert.rejects(operation);assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);
}
async function due(f){const start=performance.now();while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).due){assert.ok(performance.now()-start<10000,'original native deadline');await delay(10);}}
function corruptImmutable(f,table,sql,...bindings){
  const triggers=f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").all(table);
  assert.throws(()=>f.sqlite.prepare(sql).run(...bindings),/immutable|append.only/u);
  for(const trigger of triggers)f.sqlite.exec(`DROP TRIGGER "${trigger.name}"`);
  try{f.sqlite.prepare(sql).run(...bindings);}finally{for(const trigger of triggers)f.sqlite.exec(trigger.sql);}
}
function noQuoteConstruction(f){let calls=0;for(const name of ['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_IMAGE_MODEL','FAL_KEY','FAL_IMAGE_MODEL'])Object.defineProperty(f.env,name,{configurable:true,get(){calls++;throw Error('historical inventory cannot inspect provider configuration');}});return()=>assert.equal(calls,0,'history cannot reconstruct a quote');}
async function custodyBoundary(f,kind){
  for(const sql of [...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA,...GUEST_IMAGE_SAVE_CLAIM_SCHEMA])f.sqlite.exec(sql);
  const foreign=await issueGuestClaimSession(request(),f.env,f.terms.policyId);
  const lineage=session=>JSON.stringify({sessionId:session.sessionId,guestSubject:session.guestSubject,projectId:session.projectId,documentId:session.documentId});
  const adoption=session=>({session_id:session.sessionId,destination_user_id:'foreign-destination',lease_id:`negative-${session.sessionId}`,request_id:'negative-request',manifest_digest:'negative-manifest',lineage_json:lineage(session),lineage_digest:'negative-lineage',created_at_ms:1});
  // These are explicit adverse custody rows, never synthetic successful stage
  // construction. Foreign parents keep the native foreign keys enabled.
  insert(f,'experience_guest_context_adoptions',adoption(foreign));
  await readOnly(f,()=>f.inspect());
  if(kind==='context adoption')insert(f,'experience_guest_context_adoptions',adoption(f.session));
  else if(kind==='image claim')insert(f,'experience_guest_image_claims',{...adoption(foreign),context_lineage_digest:'negative-context',lineage_json:lineage(f.session)});
  else insert(f,'experience_guest_plan_custodies',{session_id:foreign.sessionId,destination_user_id:'foreign-destination',draft_id:f.prepared.plan.draftId,content_id:'foreign-content',draft_hash:'negative-hash',content_digest:'negative-content',lineage_digest:'negative-lineage',created_at:'2020-01-01T00:00:00.000Z',expires_at:'2020-01-02T00:00:00.000Z'});
  assert.deepEqual(rows(f,'experience_guest_claim_leases'),[]);assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
}

for(const state of states)for(const memory of [false,true])test(`${state} historical inventory is exact, source-free and read-only with ${memory?'complete':'absent'} Memory`,async t=>{
  const f=await stageFixture(t,state,{memory}),noQuote=noQuoteConstruction(f);
  const inventory=await readOnly(f,()=>f.inspect());noQuote();
  assert.deepEqual(Object.keys(inventory).sort(),['version','sessionId','documentId','sourceHead','sourceSaveHead','stageHead','stageState','expiresAt','manifestDigest'].sort());
  assert.equal(inventory.version,1);assert.equal(inventory.sessionId,f.session.sessionId);assert.equal(inventory.documentId,f.session.documentId);
  assert.equal(inventory.sourceHead,f.committed.head);assert.equal(inventory.sourceSaveHead,f.committed.head+1);
  assert.equal(inventory.stageHead,f.committed.head+(state==='quoted'?3:2));assert.equal(inventory.stageState,state);
  assert.equal(inventory.expiresAt,rows(f,'experience_guest_sources')[0].expires_at);assert.match(inventory.manifestDigest,/^sha256:[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(inventory));for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'private_json','SELECT','payerUserId'])assert.equal(JSON.stringify(inventory).includes(secret),false);
  const data=guestImageStageInventoryData(f.env,inventory);assert.equal(await digest(data.manifest),inventory.manifestDigest);
  assert.ok(data.proof.sql);assert.ok(Array.isArray(data.proof.bindings));assert.ok(Object.isFrozen(data));
  assert.equal((await f.DB.prepare(`SELECT CASE WHEN (${data.proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...data.proof.bindings).first()).current,1);
  assert.deepEqual(await readOnly(f,()=>f.inspect()),inventory);noQuote();
  assert.equal(rows(f,'users').some(row=>row.user_id===f.session.guestSubject),false);
  for(const table of ['experience_guest_claim_leases','document_jobs','output_execution_grants','output_operation_slots','output_provider_calls'])assert.deepEqual(rows(f,table),[],table);
});

test('stage inventory does not widen the accepted N+1 SAVE inventory or accept source-only work',async t=>{
  for(const saved of [false,true]){const f=await fixture(t,{saved}),before=snapshot(f);await assert.rejects(inspectGuestImageStageInventory(request(),f.env,{proof:f.proof}));assert.deepEqual(snapshot(f),before);}
});

test('original payer revocation and current provider configuration do not change a historical inventory manifest',async t=>{
  const f=await stageFixture(t,'quoted'),original=await f.inspect();
  f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}',policy_digest='replaced'");
  f.sqlite.exec("UPDATE experience_sponsor_resource_policies SET enabled=0,limits_json='{}',limits_digest='replaced'");
  f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');f.sqlite.exec('DELETE FROM users');
  const noQuote=noQuoteConstruction(f);assert.deepEqual(await readOnly(f,()=>f.inspect()),original);noQuote();
});

test('an originally expired quote remains historical inventory while its original source is retained',async t=>{
  const f=await stageFixture(t,'quoted',{policyChange:policy=>{policy.maximumGrantLifetimeMs=1500;}}),original=await f.inspect();
  const quote=rows(f,'output_preflights')[0],source=rows(f,'experience_guest_sources')[0];assert.ok(quote.expires_at<source.expires_at);
  const start=performance.now();while(!f.sqlite.prepare("SELECT ?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due").get(quote.expires_at).due){assert.ok(performance.now()-start<10000);await delay(10);}
  assert.ok(f.sqlite.prepare("SELECT ? > strftime('%Y-%m-%dT%H:%M:%fZ','now') AS retained").get(source.expires_at).retained);
  const noQuote=noQuoteConstruction(f);assert.deepEqual(await readOnly(f,()=>f.inspect()),original);noQuote();
});

test('both original guest purposes and a closed input remain required for historical disclosure',async t=>{
  const f=await stageFixture(t,'confirmed');
  for(const input of [{},{proof:{...f.proof,claimToken:f.proof.sessionToken}},{proof:{...f.proof,sessionToken:f.proof.claimToken}},
    {proof:f.proof,stageState:'quoted'},{proof:f.proof,manifest:{}},{proof:f.proof,sourceHead:f.committed.head},
    {proof:f.proof,actorUserId:'caller'},{proof:f.proof,allowExpired:true}])await denied(f,()=>f.inspect(input));
  for(const req of [new Request(`${origin}/unregistered`,{method:'GET',headers:{origin}}),
    new Request(`${origin}/unregistered`,{method:'POST',headers:{origin:'https://foreign.example.invalid'}})])await denied(f,()=>f.inspect({proof:f.proof},req));
});

test('the opaque inventory cannot be forged, serialized or moved to another database',async t=>{
  const f=await stageFixture(t,'confirmed'),inventory=await f.inspect(),before=snapshot(f);
  for(const forged of [{},JSON.parse(JSON.stringify(inventory)),Object.create(inventory)])assert.throws(()=>guestImageStageInventoryData(f.env,forged));
  assert.throws(()=>guestImageStageInventoryData({...f.env,DB:{...f.DB}},inventory));assert.deepEqual(snapshot(f),before);
});

for(const expired of [false,true])test(`${expired?'expired':'active'} claim lease prevents later-stage inventory`,async t=>{
  const f=await stageFixture(t,'quoted');addLease(f,expired);await denied(f);
});
for(const kind of ['context adoption','image claim','plan custody mapping'])test(`${kind} independently excludes historical inventory without any lease`,async t=>{
  const f=await stageFixture(t,'quoted');await custodyBoundary(f,kind);await denied(f);
});

test('original source expiry refuses retained inventory without changing charged-unknown history',async t=>{
  const f=await stageFixture(t,'preflight-claimed-unknown',{draftLifetimeMs:1500});await due(f);const noQuote=noQuoteConstruction(f);await denied(f);noQuote();
});

for(const kind of ['draft','prefix','save','confirmation','quote'])test(`a ${kind} tombstone prevents a retained historical inventory`,async t=>{
  const f=await stageFixture(t,'quoted'),now=new Date().toISOString();
  if(kind==='draft')f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(now,f.prepared.plan.draftId);
  else{const id=kind==='prefix'?f.committed.eventIds[0]:kind==='save'?f.saved.eventId:kind==='confirmation'?f.confirmed.eventId:f.quoted.eventId;f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(now,id);}
  await denied(f);
});

const corruptions={
  'plan source head':f=>f.sqlite.exec('UPDATE output_plan_revisions SET source_head=source_head+1'),
  'target contract':f=>f.sqlite.exec("UPDATE output_plan_targets SET target_contract_digest='changed'"),
  'confirmation command':f=>f.sqlite.exec("UPDATE output_commands SET request_digest='changed' WHERE action='confirm'"),
  'preflight row':f=>f.sqlite.exec("UPDATE output_preflights SET terms_digest='changed'"),
  'private ownership':f=>f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign-owner' WHERE private_event_id=?").run(f.confirmed.eventId),
  'driver digest':f=>corruptImmutable(f,'experience_sponsor_driver_intents',"UPDATE experience_sponsor_driver_intents SET command_digest='changed'"),
  'claimed command':f=>corruptImmutable(f,'experience_sponsor_driver_stages',"UPDATE experience_sponsor_driver_stages SET command_digest='changed'"),
};
for(const [name,mutate]of Object.entries(corruptions))test(`historical inventory rejects changed ${name} without repair`,async t=>{
  const f=await stageFixture(t,'quoted');mutate(f);await denied(f);
});

test('partial Memory schema fails closed while an exact complete family is accepted',async t=>{
  const f=await stageFixture(t,'confirmed');f.sqlite.exec('CREATE TABLE memory_structured_answer_origins(origin_id TEXT PRIMARY KEY)');await denied(f);
});

test('a retained inventory proof expires when a native sidecar changes after collection',async t=>{
  const f=await stageFixture(t,'quoted'),inventory=await f.inspect(),data=guestImageStageInventoryData(f.env,inventory);
  f.sqlite.exec("UPDATE output_preflights SET terms_digest='later-change'");const before=snapshot(f);
  assert.equal((await f.DB.prepare(`SELECT CASE WHEN (${data.proof.sql}) THEN 1 ELSE 0 END AS current`).bind(...data.proof.bindings).first()).current,0);
  assert.deepEqual(snapshot(f),before);await denied(f);
});

test('late source-private drift cannot return an inventory built from an earlier read',async t=>{
  const f=await stageFixture(t,'quoted');let changed,captured=false,capturedBeforeDrift=false;
  const capture=readHook(f,sql=>sql.includes("SELECT CASE WHEN typeof(e.payload)='text'")&&sql.includes('WHERE e.event_id=?'),()=>{captured=true;});
  const drift=readHook(f,sql=>sql.startsWith('SELECT 1 AS current WHERE')&&sql.includes('guest_stage_history_input'),()=>{
    capturedBeforeDrift=captured;f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(f.confirmed.eventId);changed=snapshot(f);
  },{after:false});
  try{await assert.rejects(f.inspect());}finally{drift();capture();}
  assert.equal(capturedBeforeDrift,true,'confirmation body was captured before final-proof drift');assert.deepEqual(snapshot(f),changed);
});

test('full native historical inventory qualifies deployment D1 expression and binding limits',async t=>{
  const f=await stageFixture(t,'quoted',{memory:true}),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{await readOnly(f,()=>f.inspect());limits.assertVerified();t.diagnostic(JSON.stringify({qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));}finally{limits.restore();}
});

test('linked native retention provenance prevents historical disclosure',async t=>{
  const f=await stageFixture(t,'quoted',{memory:true});
  insert(f,'memory_document_job_answer_origins',{origin_id:'historical-stage-memory',schema_version:1,recipe_version:'native-document-job-answer-origin-v1',job_id:'foreign-job',actor_user_id:'foreign-actor',scope_key:'["","","foreign-project","foreign-document"]',turn_id:'foreign-turn',user_event_id:f.confirmed.eventId,user_content_id:'foreign-user-body',answer_event_id:'foreign-answer',answer_content_id:'foreign-answer-body',manifest_content_ref:'foreign-manifest',status:'minimized',withdrawn_at:new Date().toISOString(),withdrawal_reason:'erased'});
  await denied(f);assert.ok((await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS now`).first()).now>0);
});

test('a different valid quote-index expiry cannot override the intact original quote body',async t=>{
  const {retireExpiredUnclaimedGuestImageStages}=await import('../worker/experience-guest-image-stage-retirement.ts');
  const f=await stageFixture(t,'quoted',{draftLifetimeMs:1500}),quote=rows(f,'output_preflights')[0];
  const source=rows(f,'experience_guest_sources')[0],different=new Date(Math.floor((Date.parse(quote.created_at)+Date.parse(source.expires_at))/2)).toISOString();
  assert.notEqual(different,quote.expires_at);assert.ok(different>quote.created_at&&different<source.expires_at);
  const originalBody=rows(f,'event_private_payloads').find(row=>row.private_event_id===f.quoted.eventId);
  f.sqlite.prepare('UPDATE output_preflights SET expires_at=?').run(different);
  assert.deepEqual({...rows(f,'output_preflights')[0]},{...quote,expires_at:different});
  assert.deepEqual(rows(f,'event_private_payloads').find(row=>row.private_event_id===f.quoted.eventId),originalBody);
  const before=snapshot(f);let inventoryRejected=false,retirementRejected=false;
  try{await f.inspect();}catch{inventoryRejected=true;}
  const inventoryUnchanged=JSON.stringify(snapshot(f))===JSON.stringify(before);
  await due(f);try{await retireExpiredUnclaimedGuestImageStages(f.env,{sessionId:f.session.sessionId});}catch{retirementRejected=true;}
  const retirementUnchanged=JSON.stringify(snapshot(f))===JSON.stringify(before);
  assert.deepEqual({inventoryRejected,inventoryUnchanged,retirementRejected,retirementUnchanged},
    {inventoryRejected:true,inventoryUnchanged:true,retirementRejected:true,retirementUnchanged:true});
});

test('a future-dated original confirmation resource receipt cannot authorize retained inventory',async t=>{
  const f=await stageFixture(t,'quoted'),receipt=rows(f,'experience_sponsor_resource_receipts').find(row=>row.resource_id!==`${rows(f,'output_commands').find(row=>row.action==='save').command_key}:text`&&row.operation==='text-intake');
  assert.ok(receipt);const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const future=now+10000;assert.ok(future<f.policy.expiresAtMs&&future<f.policy.resources.expiresAtMs&&future<Date.parse(rows(f,'experience_guest_sources')[0].expires_at));
  corruptImmutable(f,'experience_sponsor_resource_receipts','UPDATE experience_sponsor_resource_receipts SET recorded_at_ms=? WHERE resource_id=?',future,receipt.resource_id);
  assert.deepEqual({...rows(f,'experience_sponsor_resource_receipts').find(row=>row.resource_id===receipt.resource_id)},{...receipt,recorded_at_ms:future});
  await denied(f);
});

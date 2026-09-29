import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{ensureSchema},{POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,GUEST_DB_NOW,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA},{approveGuestSponsorCampaign},
  {compileGuestSponsorApprovalProposal},{saveGuestImageRequirement,readGuestImageRequirement},{registeredExperience,initialValues},
  {canonicalJson,digest},{preflightOutputImageSlidesTarget},{sponsorImageTransport},{serializeEvent},
  {GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{claimGuestContext},leaseApi,{makeEvent},{insertEventAtHead}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/policy-version.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),import('../worker/experience-guest-context-inventory.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),import('../worker/experience-guest-sponsor-approval.ts'),import('../worker/experience-guest-sponsor-contract.ts'),
  import('../worker/experience-guest-image-output.ts'),import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),import('../worker/event-read-primitives.ts'),
  import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),import('../worker/experience-guest-context-claim.ts'),import('../worker/experience-guest-claim-lease.ts'),import('../worker/event-write-primitives.ts'),import('../worker/event-append.ts')]);
const origin='https://guest.example.invalid',subject='A blue heron on a stone bridge',payer='synthetic-image-payer',time='2020-01-01T00:00:00.000Z';
const request=()=>new Request(`${origin}/unregistered-guest-image-output`,{method:'POST',headers:{origin}});
const proofFor=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();
const snapshot=f=>{const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();return {schema,contents:Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,rows(f,row.name)]))};};
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
const outputTables=['events','event_private_payloads','output_commands','experience_sponsor_resource_receipts'];
const nativeEvents=f=>f.sqlite.prepare('SELECT event.*,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE stream_id=? ORDER BY sequence').all(`creative:${f.session.guestSubject}`).map(serializeEvent);
function unchangedExcept(f,before,allowed=outputTables){const after=snapshot(f);assert.deepEqual(after.schema,before.schema);for(const [table,value]of Object.entries(before.contents))if(!allowed.includes(table))assert.deepEqual(after.contents[table],value,table);}
function insert(f,table,row){const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));}
const memoryFiles=['0027_memory_native_origins.sql','0033_memory_structured_answer_provenance.sql','0034_memory_document_job_origins.sql'];
const installMemory=f=>{for(const file of memoryFiles)f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));};
async function templateFor(env, release) {
  const offered = await preflightOutputImageSlidesTarget({ env,
    target: { id: 'synthetic-template', selected: true, blocking_issues: [], media_kind: 'image', source_scope: { kind: 'document' },
      aspect_ratio: { width: 1, height: 1 }, instruction_text: 'Show a pear orchard', label: 'Synthetic template', coverage: { kind: 'document_outline' } },
    context: { snapshot: { facts: [{ type: 'subject', properties: { text: 'A pear orchard' } }] } } });
  assert.equal(offered.available, true);
  const settings = offered.settings, payload = settings.payload;
  return { version: 2, appId: 'image', recipeVersion: `image@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: 'image', inputMode: 'text-only', outputCount: 1, durationMs: 0, width: 1024, height: 1024,
    route: offered.route, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd,
    calls: structuredClone(settings.calls), settings: { kind: settings.kind, productionMode: payload.productionMode,
      budgetAcknowledged: payload.budgetAcknowledged, preflightAcknowledged: payload.preflightAcknowledged,
      imageRender: structuredClone(settings.imageRender), imageBudget: structuredClone(settings.imageBudget), executionPolicy: structuredClone(settings.executionPolicy) },
    transport: await sponsorImageTransport(env) };
}
async function candidatePolicy(f) {
  const now = (await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value, template = await templateFor(f.env, f.release);
  const allowance = { maximumOperations: 100, maximumTextBytes: 1000000, maximumOperationsPerWindow: 100, maximumTextBytesPerWindow: 1000000,
    maximumPendingGrants: 10, maximumInflightJobs: 1 };
  const resources = { version: 1, startsAtMs: now - 60000, expiresAtMs: now + 60000, windowMs: 60000, maximumOperationTextBytes: 65536,
    campaign: { ...allowance, maximumInflightJobs: 3 }, actor: { ...allowance } };
  return { version: 3, mode: 'candidate', campaignId: 'synthetic-guest-campaign', policyVersion: 'synthetic-guest@1', payerUserId: 'synthetic-unprovisioned-payer',
    audience: 'guest-session', approvalReceiptDigest: `sha256:${'d'.repeat(64)}`, startsAtMs: resources.startsAtMs, expiresAtMs: resources.expiresAtMs,
    maximumGrantLifetimeMs: 30000, maximumAdmissions: 10, maximumMicrousd: Math.max(1000000, template.maximumMicrousd * 10), maximumAdmissionsPerActor: 5,
    windowMs: 60000, maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 5, templates: [template], resources,
    guestAdmission: { protocol: 'guest-image-source@1', origin, sessionPolicyId: f.terms.policyId, sessionTermsDigest: await digest(f.terms),
      sourcePolicyId: f.sourcePolicy.policyId, sourcePolicyDigest: await digest(f.sourcePolicy), releaseHash: f.release.releaseHash } };
}


async function approvePolicy(f,policy=f.policy,approvalId='synthetic-image-approval'){
  const {approvalReceiptDigest:ignored,...proposed}=structuredClone(policy);void ignored;
  const proposal={version:1,purpose:'guest-sponsored-image',issuerProtocol:'guest-image-source@1',policy:proposed},compiled=await compileGuestSponsorApprovalProposal(proposal);
  const command={version:1,action:'approve-guest-sponsor-campaign',approvalId,proposal,reviewedTermsDigest:compiled.termsDigest,confirmation:'APPROVE_GUEST_SPONSOR_CAMPAIGN'};
  const req=new Request(`${origin}/unregistered-guest-approval`,{method:'POST',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':payer,'oai-authenticated-user-email':`${payer}@example.invalid`},body:JSON.stringify(command)});
  const approved=await approveGuestSponsorCampaign(req,f.env);assert.equal(approved.status,'approved');return compiled;
}
async function fixture(t,{memory=false,approved=true,draftLifetimeMs=120000,leaseLifetimeMs=60000,maximumLeaseAcquisitions=3,policyChange,subjectText=subject}={}){
  const f=outputTestDatabase();
  // This frozen helper labels WITH statements as reads. Execute the native resource CTE insertion as a write so its acknowledgment reports real SQLite changes.
  const nativeBatch=f.DB.batch;f.DB.batch=statements=>nativeBatch.call(f.DB,statements.map(statement=>{if(/WITH[\s\S]*INSERT INTO experience_sponsor_resource_receipts/u.test(statement.sql)){const execute=statement.execute;statement.execute=function(kind){return execute.call(this,kind==='all'?'run':kind);};}return statement;}));
  t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA,...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA])f.sqlite.exec(sql);
  if(memory)installMemory(f);insert(f,'users',{user_id:payer,email:`${payer}@example.invalid`,display_name:payer,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
  Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  let egress=0,media=0;t.mock.method(globalThis,'fetch',()=>{egress++;throw Error('network forbidden');});for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{media++;throw Error('media forbidden');});
  t.after(()=>{assert.equal(egress,0);assert.equal(media,0);});const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:now-60000,expiresAtMs:now+600000,sessionLifetimeMs:300000,leaseLifetimeMs,maximumSessions:5,maximumLeaseAcquisitions});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(request(),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:subjectText,provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const sourcePolicy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(sourcePolicy.policyId,await digest(sourcePolicy),canonicalJson(sourcePolicy),`sha256:${'c'.repeat(64)}`);
  const proof=proofFor(session),prepared=await prepareGuestImageSource(request(),f.env,{proof,policyId:sourcePolicy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}});
  const committed=await commitGuestImageSource(request(),f.env,{proof,draftHash:prepared.plan.draftHash}),inventory=await inspectGuestContextInventory(request(),f.env,{proof});
  Object.assign(f,{session,terms,sourcePolicy,release,proof,prepared,committed,inventory,subject:subjectText});f.policy=await candidatePolicy(f);f.policy.payerUserId=payer;
  if(policyChange)await policyChange(f.policy,f);f.compiled=approved?await approvePolicy(f):await compileGuestSponsorApprovalProposal({version:1,purpose:'guest-sponsored-image',issuerProtocol:'guest-image-source@1',policy:Object.fromEntries(Object.entries(f.policy).filter(([key])=>key!=='approvalReceiptDigest'))});
  f.input={proof,campaignId:f.policy.campaignId,policyDigest:f.compiled.policyDigest,draftHash:prepared.plan.draftHash};f.request=request();
  f.save=(input=f.input,req=f.request,env=f.env)=>saveGuestImageRequirement(req,env,input);f.read=(input=f.input,req=f.request,env=f.env)=>readGuestImageRequirement(req,env,input);
  assert.equal(rows(f,'users').length,1);assert.equal(rows(f,'users')[0].user_id,payer);
  f.leaseInput={proof:f.proof,requestId:'request-1',inventory:f.inventory};f.acquire=(input=f.leaseInput,req=canonicalRequest(),env=f.env)=>leaseApi.acquireGuestContextClaimLease(req,env,input);
  f.claimInput={sessionId:f.session.sessionId,requestId:'request-1',approvedManifestDigest:f.inventory.manifestDigest,proof:f.proof};f.claim=(input=f.claimInput,req=canonicalRequest())=>claimGuestContext(req,f.env,input);return f;
}

const canonicalRequest=(actor=payer)=>new Request(`${origin}/unregistered-guest-context-claim`,{method:'POST',headers:{origin,...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{})}});

function readHook(f,predicate,action,{method='first',after=true}={}){const prepare=f.DB.prepare;let hits=0;function wrap(statement,sql){const bind=statement.bind,original=statement[method];statement.bind=function(...bindings){return wrap(bind.apply(this,bindings),sql);};statement[method]=async function(){if(!hits&&predicate(sql,this.bindings)){hits++;if(!after)await action();const result=await original.call(this);if(after)await action();return result;}return original.call(this);};return statement;}f.DB.prepare=function(sql){return wrap(prepare.call(this,sql),sql);};return()=>{f.DB.prepare=prepare;assert.equal(hits,1,'exact native read hook fired');};}
function coordinatorAfterInventory(f,action){let inventoryProven=false;return readHook(f,sql=>{if(sql.startsWith('SELECT 1 AS current WHERE')&&sql.includes('experience_guest_sources'))inventoryProven=true;return inventoryProven&&sql.startsWith('SELECT * FROM experience_guest_sessions WHERE session_id=? AND session_hash');},action,{after:false});}

test('actual coordinator paused after original inventory cannot leave a stale lease when SAVE wins',{timeout:5000},async t=>{
  const f=await fixture(t);let saved,before;const done=coordinatorAfterInventory(f,async()=>{saved=await f.save();before=snapshot(f);});
  await assert.rejects(f.claim());done();assert.ok(saved);assert.equal(rows(f,'experience_guest_claim_leases').length,0,'stale coordinator must not strand a lease after SAVE');
  assert.equal(rows(f,'experience_guest_context_adoptions').length,0);assert.deepEqual(snapshot(f),before);assert.equal((await f.read()).eventId,saved.eventId);assert.equal((await f.save()).eventId,saved.eventId);
});

function assertLease(f,value,{acquisition=1,destination=payer}={}){assert.equal(value.version,1);assert.equal(value.status,'claiming');assert.equal(value.acquisition,acquisition);assert.equal(value.destinationUserId,destination);assert.equal(value.guestSubject,f.session.guestSubject);assert.equal(value.projectId,f.session.projectId);assert.equal(value.documentId,f.session.documentId);assert.equal(value.manifestDigest,f.inventory.manifestDigest);assert.equal(value.custodyTransferred,false);assert.ok(Object.isFrozen(value));assert.ok(Number.isSafeInteger(value.expiresAtMs));for(const secret of [subject,f.proof.sessionToken,f.proof.claimToken])assert.ok(!JSON.stringify(value).includes(secret));}
for(const memory of [false,true])test(`guarded context lease and exact replay fit strict D1 limits with ${memory?'complete':'absent'} Memory`,async t=>{
  const f=await fixture(t,{memory}),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{const first=await f.acquire();assertLease(f,first);const count=changes(f),saved=snapshot(f);assert.deepEqual(await f.acquire(),first);assert.equal(changes(f),count);assert.deepEqual(snapshot(f),saved);limits.assertVerified();t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));}finally{limits.restore();}
  unchangedExcept(f,before,['experience_guest_claim_leases']);assert.equal(rows(f,'experience_guest_claim_leases').length,1);assert.equal(rows(f,'output_commands').length,0);
});

const leaseMutation=sql=>/^(INSERT INTO|UPDATE) experience_guest_claim_leases/u.test(sql);
const leaseBatch=statements=>statements.some(statement=>leaseMutation(statement.sql));
function batchHook(f,action,{after=true}={}){const batch=f.DB.batch;let attempts=0;f.DB.batch=async statements=>{if(!leaseBatch(statements))return batch.call(this,statements);attempts++;if(attempts===1&&!after)await action(statements);const result=await batch.call(this,statements);return attempts===1&&after?action(result):result;};return()=>{f.DB.batch=batch;assert.equal(attempts,1,'one authorized lease mutation attempt');};}
function executeHook(f,predicate,action,{after=false}={}){const prepare=f.DB.prepare;let hit=false;function wrap(statement,sql){const bind=statement.bind,execute=statement.execute;statement.bind=function(...bindings){return wrap(bind.apply(this,bindings),sql);};statement.execute=function(kind){if(!hit&&predicate(sql)){hit=true;if(!after)action();const result=execute.call(this,kind);if(after)action();return result;}return execute.call(this,kind);};return statement;}f.DB.prepare=function(sql){return wrap(prepare.call(this,sql),sql);};return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native transaction mutation hook executed');};}
async function waitForExpiry(f){const begin=performance.now();while(!f.sqlite.prepare(`SELECT expires_at_ms<=${GUEST_DB_NOW} AS expired FROM experience_guest_claim_leases`).get()?.expired){assert.ok(performance.now()-begin<5000);await delay(10);}}
function addCanonical(f,actor='other-owner'){insert(f,'users',{user_id:actor,email:`${actor}@example.invalid`,display_name:actor,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});return actor;}
function redactSource(f){f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(time,f.prepared.plan.draftId);}
async function appendTail(f){const event=makeEvent(`creative:${f.session.guestSubject}`,f.committed.head+1,f.session.guestSubject,'synthetic-context-edit','synthetic-change','BlockCreated',{actor_user_id:f.session.guestSubject,project_id:f.session.projectId,document_id:f.session.documentId,block_id:crypto.randomUUID(),type:'subject',scope:'document',properties:{text:'Additional context',authority:'authored'}});await insertEventAtHead(f.env,event,f.committed.head).run();return event;}

test('lease-first serialization refuses SAVE and preserves native source, quota and financial history',async t=>{
  const f=await fixture(t),original=nativeEvents(f),lease=await f.acquire(),before=snapshot(f);assertLease(f,lease);await assert.rejects(f.save());await assert.rejects(f.read());assert.deepEqual(snapshot(f),before);assert.deepEqual(nativeEvents(f),original);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,0);
});
test('SAVE before the guarded primitive refuses stale opaque inventory without a lease mutation',async t=>{
  const f=await fixture(t),saved=await f.save(),before=snapshot(f);await assert.rejects(f.acquire());assert.deepEqual(snapshot(f),before);assert.equal(rows(f,'experience_guest_claim_leases').length,0);assert.equal((await f.read()).eventId,saved.eventId);
});
test('the actual coordinator completes original-context custody using the guarded lease and reopens its retained plan',async t=>{
  const f=await fixture(t),result=await f.claim();assert.equal(result.status,'context-claimed');assert.equal(result.receipt.destinationUserId,payer);assert.equal(result.receipt.manifestDigest,f.inventory.manifestDigest);assert.equal(result.planRetention,'retained');assert.deepEqual(result.retained.plan,f.prepared.plan);assert.equal(result.generationAvailable,false);assert.equal(result.miniAppClaimComplete,false);
  const before=snapshot(f),{proof:ignored,...input}=f.claimInput;void ignored;const replay=await f.claim(input);assert.equal(replay.receipt.head,result.receipt.head);assert.deepEqual(snapshot(f),before);assert.equal(rows(f,'experience_guest_claim_leases').length,1);
});
test('guarded lease derives its manifest only from the original opaque same-database inventory',async t=>{
  const f=await fixture(t),before=snapshot(f);for(const value of [{},{...f.inventory},structuredClone(f.inventory),{...f.inventory,manifestDigest:`sha256:${'0'.repeat(64)}`}])await assert.rejects(f.acquire({...f.leaseInput,inventory:value}));
  for(const value of [{...f.leaseInput,manifestDigest:f.inventory.manifestDigest},{...f.leaseInput,destinationUserId:'other'},{...f.leaseInput,proofSql:'1'}])await assert.rejects(f.acquire(value));
  const foreign=outputTestDatabase();try{await assert.rejects(f.acquire(f.leaseInput,canonicalRequest(),{...f.env,DB:foreign.DB}));}finally{foreign.sqlite.close();}assert.deepEqual(snapshot(f),before);
});
test('another real guest session proof cannot be paired with this opaque source inventory',async t=>{
  const f=await fixture(t),other=await issueGuestClaimSession(request(),f.env,f.terms.policyId),before=snapshot(f);await assert.rejects(f.acquire({...f.leaseInput,proof:proofFor(other)}));assert.deepEqual(snapshot(f),before);
});
test('guarded credential objects reject additional unrecognized proof fields',async t=>{
  const f=await fixture(t),before=snapshot(f);await assert.rejects(f.acquire({...f.leaseInput,proof:{...f.proof,authority:'caller-selected'}}));assert.deepEqual(snapshot(f),before);
});
test('an existing historical source-policy revocation does not revoke an already committed context inventory',async t=>{
  const f=await fixture(t);f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');const before=snapshot(f);assertLease(f,await f.acquire());unchangedExcept(f,before,['experience_guest_claim_leases']);
});
for(const mutation of ['guest-revoked','session-policy-revoked','source-redacted','source-head','principal-consent','principal-role'])test(`current ${mutation} refuses first acquisition and leaves the historical source unchanged`,async t=>{
  const f=await fixture(t);if(mutation==='guest-revoked')f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');else if(mutation==='session-policy-revoked')f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');else if(mutation==='source-redacted')redactSource(f);else if(mutation==='source-head')await appendTail(f);else if(mutation==='principal-consent')f.sqlite.exec('UPDATE users SET consent_version=NULL');else f.sqlite.exec("UPDATE users SET role='viewer'");
  const before=snapshot(f);await assert.rejects(f.acquire());assert.deepEqual(snapshot(f),before);
});
for(const kind of ['lost','truncated','false','sparse'])test(`${kind} guarded batch acknowledgment uses one mutation and an exact current result`,async t=>{
  const f=await fixture(t),before=snapshot(f),done=batchHook(f,result=>{if(kind==='lost')throw Error('lost lease ack');if(kind==='truncated')return result.slice(0,-1);if(kind==='sparse'){const copy=[...result];delete copy[2];return copy;}return result.map((entry,index)=>index?entry:{...entry,success:false});});assertLease(f,await f.acquire());done();unchangedExcept(f,before,['experience_guest_claim_leases']);assert.equal(rows(f,'experience_guest_claim_leases').length,1);
});
test('a failed uncommitted lease batch does not automatically retry its mutation',async t=>{
  const f=await fixture(t),before=snapshot(f),batch=f.DB.batch;let attempts=0;f.DB.batch=async statements=>{if(leaseBatch(statements)){attempts++;throw Error('lease batch unavailable');}return batch.call(this,statements);};await assert.rejects(f.acquire());f.DB.batch=batch;assert.equal(attempts,1);assert.deepEqual(snapshot(f),before);
});
for(const change of ['guest-revocation','principal-consent','source-redaction','private-owner','new-Memory-schema'])test(`late ${change} inside the guarded lease transaction rolls back the lease and mutation`,async t=>{
  const f=await fixture(t),before=snapshot(f),done=executeHook(f,leaseMutation,()=>{if(change==='guest-revocation')f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');else if(change==='principal-consent')f.sqlite.exec('UPDATE users SET consent_version=NULL');else if(change==='source-redaction')redactSource(f);else if(change==='private-owner')f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run('other',f.committed.eventIds[0]);else installMemory(f);},{after:true});await assert.rejects(f.acquire());done();assert.deepEqual(snapshot(f),before);
});
for(const phase of ['fresh','replay'])test(`a postcommit guest revocation refuses ${phase} lease disclosure while preserving the one recorded lease`,async t=>{
  const f=await fixture(t);if(phase==='replay')await f.acquire();const done=phase==='fresh'?batchHook(f,result=>{f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');return result;}):readHook(f,sql=>sql.startsWith('WITH context_lease_inventory AS MATERIALIZED'),()=>f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1'),{after:false});await assert.rejects(f.acquire());done();assert.equal(rows(f,'experience_guest_claim_leases').length,1);const before=snapshot(f);await assert.rejects(f.acquire());assert.deepEqual(snapshot(f),before);
});
test('expired renewal preserves lease identity and appends request history without refreshing exact replay',{timeout:5000},async t=>{
  const f=await fixture(t,{leaseLifetimeMs:200}),first=await f.acquire(),initial={...rows(f,'experience_guest_claim_leases')[0]};await waitForExpiry(f);const second=await f.acquire({...f.leaseInput,requestId:'request-2'});assertLease(f,second,{acquisition:2});assert.equal(second.leaseId,first.leaseId);assert.equal(rows(f,'experience_guest_claim_leases')[0].created_at_ms,initial.created_at_ms);assert.equal(rows(f,'experience_guest_claim_leases')[0].request_ids_json,'["request-1","request-2"]');
  const before=snapshot(f),count=changes(f);assert.deepEqual(await f.acquire({...f.leaseInput,requestId:'request-2'}),second);assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);await assert.rejects(f.acquire(f.leaseInput));assert.deepEqual(snapshot(f),before);
});
test('acquisition cap and historical request ID forbid further expired renewal without deleting the lease',{timeout:5000},async t=>{
  const f=await fixture(t,{leaseLifetimeMs:150,maximumLeaseAcquisitions:2});await f.acquire();await waitForExpiry(f);await f.acquire({...f.leaseInput,requestId:'request-2'});await waitForExpiry(f);const before=snapshot(f);await assert.rejects(f.acquire({...f.leaseInput,requestId:'request-3'}));await assert.rejects(f.acquire());assert.deepEqual(snapshot(f),before);assert.equal(rows(f,'experience_guest_claim_leases')[0].acquisitions,2);
});
test('lease expiration uses database time even when process time is moved far into the future',async t=>{
  const f=await fixture(t);t.mock.method(Date,'now',()=>Date.UTC(2099,1,1));const value=await f.acquire(),now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;assert.ok(value.expiresAtMs>now);assert.ok(value.expiresAtMs<=now+f.terms.leaseLifetimeMs);
});
test('a competing canonical destination cannot replace the lease or its bound manifest',async t=>{
  const f=await fixture(t),other=addCanonical(f);await f.acquire();const before=snapshot(f);await assert.rejects(f.acquire(f.leaseInput,canonicalRequest(other)));assert.deepEqual(snapshot(f),before);
});
for(const competition of ['same-request','different-request','different-owner'])test(`two genuinely concurrent ${competition} acquisitions serialize to one immutable lease`,{timeout:5000},async t=>{
  const f=await fixture(t),other=competition==='different-owner'?addCanonical(f):payer,batch=f.DB.batch;let arrivals=0,release;const ready=new Promise(resolve=>{release=resolve;});f.DB.batch=async statements=>{if(leaseBatch(statements)){arrivals++;if(arrivals===2)release();await ready;}return batch.call(this,statements);};
  const results=await Promise.allSettled([f.acquire(),f.acquire({...f.leaseInput,requestId:competition==='different-request'?'request-2':'request-1'},canonicalRequest(other))]);f.DB.batch=batch;assert.equal(arrivals,2);assert.equal(results.filter(result=>result.status==='fulfilled').length,competition==='same-request'?2:1);assert.equal(rows(f,'experience_guest_claim_leases').length,1);assert.equal(rows(f,'experience_guest_claim_leases')[0].acquisitions,1);if(competition==='same-request')assert.deepEqual(results[0].value,results[1].value);
});

for(const scenario of ['anonymous','unknown-user','GET','cross-site','wrong-origin','query','fragment','project-cookie','leading-empty-project-cookie','leading-empty-impersonation-cookie'])test(`guarded entry refuses ${scenario} without bootstrapping or writing a lease`,async t=>{
  const f=await fixture(t),before=snapshot(f);let req=canonicalRequest(scenario==='anonymous'?null:scenario==='unknown-user'?'unknown':payer);
  if(scenario==='GET')req=new Request(req,{method:'GET'});if(scenario==='cross-site')req.headers.set('sec-fetch-site','cross-site');if(scenario==='wrong-origin')req.headers.set('origin','https://wrong.example.invalid');
  if(scenario==='query'||scenario==='fragment')req=new Request(req.url+(scenario==='query'?'?x=1':'#x'),req);
  if(scenario==='project-cookie')req.headers.set('cookie','forma_project_context=');if(scenario==='leading-empty-project-cookie')req.headers.set('cookie',' forma_project_context=; forma_project_context=stale');if(scenario==='leading-empty-impersonation-cookie')req.headers.set('cookie',' forma_impersonation=; forma_impersonation=stale');
  await assert.rejects(f.acquire(f.leaseInput,req));assert.deepEqual(snapshot(f),before);
});
for(const phase of ['fresh','replay'])for(const damage of ['database','abort','headers','pilot-config','admin-config'])test(`${damage} at outer ${phase} final lease proof settlement refuses stale authority`,async t=>{
  const f=await fixture(t);if(phase==='replay')await f.acquire();const before=snapshot(f),controller=new AbortController(),req=new Request(canonicalRequest(),{signal:controller.signal});const done=readHook(f,sql=>sql.startsWith('WITH context_lease_inventory AS MATERIALIZED'),()=>queueMicrotask(()=>queueMicrotask(()=>{if(damage==='database')f.env.DB={...f.DB};else if(damage==='abort')controller.abort();else if(damage==='headers')req.headers.set('oai-authenticated-user-id','different');else if(damage==='pilot-config')f.env.FORMA_PILOT_COHORT_ID='changed';else f.env.FORMA_ADMIN_EMAILS='changed@example.invalid';})));
  await assert.rejects(f.acquire(f.leaseInput,req));done();f.env.DB=f.DB;if(phase==='replay')assert.deepEqual(snapshot(f),before);else{assert.equal(rows(f,'experience_guest_claim_leases').length,1);unchangedExcept(f,before,['experience_guest_claim_leases']);}
});
test('credential and request intent fields are captured before awaited native session reads',async t=>{
  const f=await fixture(t),input={...f.leaseInput,proof:{...f.proof}},done=readHook(f,sql=>sql.startsWith('SELECT * FROM experience_guest_sessions'),()=>{input.requestId='changed-request';input.proof.sessionToken='changed-token';input.inventory={};});assertLease(f,await f.acquire(input));done();assert.equal(rows(f,'experience_guest_claim_leases')[0].request_id,'request-1');
});
test('an unchanged abstract legacy lease still supports a real session without a committed source',async t=>{
  const f=await fixture(t),session=await issueGuestClaimSession(request(),f.env,f.terms.policyId),input={proof:proofFor(session),requestId:'abstract-1',manifestDigest:`sha256:${'b'.repeat(64)}`},before=snapshot(f);
  const first=await leaseApi.acquireGuestClaimLease(canonicalRequest(),f.env,input);assert.equal(first.status,'claiming');assert.equal(first.custodyTransferred,false);assert.equal(first.manifestDigest,input.manifestDigest);assert.equal(first.guestSubject,session.guestSubject);unchangedExcept(f,before,['experience_guest_claim_leases']);
  const saved=snapshot(f),count=changes(f);assert.deepEqual(await leaseApi.acquireGuestClaimLease(canonicalRequest(),f.env,input),first);assert.deepEqual(snapshot(f),saved);assert.equal(changes(f),count);
});

function registerSourceMemory(f){insert(f,'memory_document_job_answer_origins',{origin_id:'synthetic-memory-origin',schema_version:1,recipe_version:'native-document-job-answer-origin-v1',actor_user_id:'foreign-memory-actor',scope_key:'["","","foreign-project","foreign-document"]',job_id:'foreign-job',turn_id:'foreign-turn',user_event_id:f.committed.eventIds[0],user_content_id:'foreign-user-content',answer_event_id:'foreign-answer-event',answer_content_id:'foreign-answer-content',manifest_content_ref:'foreign-manifest',status:'minimized',withdrawn_at:time,withdrawal_reason:'erased'});}
test('a source-event Memory registration in an existing native registry rolls back a pending lease atomically',async t=>{
  const f=await fixture(t,{memory:true}),before=snapshot(f),done=executeHook(f,leaseMutation,()=>registerSourceMemory(f),{after:true});await assert.rejects(f.acquire());done();assert.deepEqual(snapshot(f),before);assert.equal(rows(f,'experience_guest_claim_leases').length,0);
});
test('exact lease replay rechecks relevant existing Memory registry rows and preserves the original lease on refusal',async t=>{
  const f=await fixture(t,{memory:true});await f.acquire();registerSourceMemory(f);const before=snapshot(f),count=changes(f);await assert.rejects(f.acquire());assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);assert.equal(rows(f,'experience_guest_claim_leases').length,1);
});

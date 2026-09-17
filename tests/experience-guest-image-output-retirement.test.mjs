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
  {compileGuestSponsorApprovalProposal},{saveGuestImageRequirement,readGuestImageRequirement},
  {registeredExperience,initialValues},{canonicalJson,digest},{preflightOutputImageSlidesTarget},{sponsorImageTransport},
  {retireExpiredGuestImageSource},{retireExpiredGuestImageOutput},{outputDigest},{makeEvent},{insertEventAtHead},{experienceOutputBinding,experienceOutputCommandKey},{createExperienceOutputRecipe},
  {GUEST_CONTEXT_ADOPTION_SCHEMA,adoptGuestContextSource},{GUEST_PLAN_CUSTODY_SCHEMA,retainGuestContextPlan},{acquireGuestClaimLease}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/policy-version.ts'),import('../worker/experience-guest-session.ts'),
  import('../worker/experience-guest-source.ts'),import('../worker/experience-guest-context-inventory.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-approval.ts'),import('../worker/experience-guest-sponsor-contract.ts'),import('../worker/experience-guest-image-output.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),
  import('../worker/experience-guest-source-retirement.ts'),import('../worker/experience-guest-image-output-retirement.ts'),import('../worker/output-disclosure-proof.ts'),import('../worker/event-write-primitives.ts'),import('../worker/event-append.ts'),import('../worker/experience-output-binding.ts'),import('../worker/experience-output-recipe.ts'),
  import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),import('../worker/experience-guest-claim-lease.ts')]);
const origin='https://guest.example.invalid',subject='A blue heron on a stone bridge',payer='synthetic-image-payer',time='2020-01-01T00:00:00.000Z';
const request=()=>new Request(`${origin}/unregistered-guest-image-output`,{method:'POST',headers:{origin}});
const proofFor=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();
const snapshot=f=>{const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();return {schema,contents:Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,rows(f,row.name)]))};};
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
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
async function fixture(t,{memory=false,custody=false,approved=true,draftLifetimeMs=1000,sessionLifetimeMs=300000,saved=true,beforeSave,policyChange,subjectText=subject}={}){
  const f=outputTestDatabase();
  // This frozen helper labels WITH statements as reads. Execute the native resource CTE insertion as a write so its acknowledgment reports real SQLite changes.
  const nativeBatch=f.DB.batch;f.DB.batch=statements=>nativeBatch.call(f.DB,statements.map(statement=>{if(/WITH[\s\S]*INSERT INTO experience_sponsor_resource_receipts/u.test(statement.sql)){const execute=statement.execute;statement.execute=function(kind){return execute.call(this,kind==='all'?'run':kind);};}return statement;}));
  t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA])f.sqlite.exec(sql);
  if(custody)for(const sql of [...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA])f.sqlite.exec(sql);
  if(memory)installMemory(f);insert(f,'users',{user_id:payer,email:`${payer}@example.invalid`,display_name:payer,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
  Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  let egress=0,media=0;t.mock.method(globalThis,'fetch',()=>{egress++;throw Error('network forbidden');});for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{media++;throw Error('media forbidden');});
  t.after(()=>{assert.equal(egress,0);assert.equal(media,0);});const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:now-60000,expiresAtMs:now+600000,sessionLifetimeMs,leaseLifetimeMs:Math.min(60000,sessionLifetimeMs),maximumSessions:5,maximumLeaseAcquisitions:3});
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
  if(beforeSave)await beforeSave(f);f.saved=saved?await f.save():null;f.retire=(input={sessionId:f.session.sessionId},env=f.env)=>retireExpiredGuestImageOutput(env,input);
  f.retireSource=()=>retireExpiredGuestImageSource(f.env,{sessionId:f.session.sessionId});return f;
}

const canonicalTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&new Date(value).toISOString()===value;
const tail=f=>f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(f.saved.eventId);
const mutationBatch=statements=>statements.some(statement=>/^\s*UPDATE event_private_payloads\b/u.test(statement.sql));
async function expire(f,{session=false}={}){const start=performance.now();while(!f.sqlite.prepare(session?`SELECT expires_at_ms<=${GUEST_DB_NOW} AS due FROM experience_guest_sessions WHERE session_id=?`:"SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).due){assert.ok(performance.now()-start<5000,'real native database expiry');await delay(10);}}
function assertRetired(f,result,replayed=false){assert.deepEqual(Object.keys(result).sort(),['status','scope','sessionId','documentId','requirementId','eventId','redactedAt','replayed'].sort());
  assert.deepEqual(result,{status:'retired',scope:'first-save-private-body',sessionId:f.session.sessionId,documentId:f.session.documentId,requirementId:f.saved.requirementId,eventId:f.saved.eventId,redactedAt:tail(f).redacted_at,replayed});
  assert.ok(Object.isFrozen(result));assert.ok(canonicalTime(result.redactedAt));assert.equal(tail(f).private_json,'');
  for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'guestSponsorPreparation','private_json','SELECT'])assert.ok(!JSON.stringify(result).includes(secret),'source-free retirement receipt');
}
function onlyTailChanged(f,before){const after=snapshot(f);assert.deepEqual(after.schema,before.schema);for(const [table,prior]of Object.entries(before.contents)){
  if(table!=='event_private_payloads')assert.deepEqual(after.contents[table],prior,table);
  else{assert.equal(after.contents[table].length,prior.length);for(const row of after.contents[table]){const old=prior.find(value=>value.private_event_id===row.private_event_id);assert.ok(old);if(row.private_event_id===f.saved.eventId)assert.deepEqual({...row,private_json:old.private_json,redacted_at:old.redacted_at},{...old});else assert.deepEqual(row,old);}}
}}
function originalBodies(f){return rows(f,'event_private_payloads').filter(row=>f.committed.eventIds.includes(row.private_event_id));}
function sourceErased(f){const draft=rows(f,'private_content').find(row=>row.content_id===f.prepared.plan.draftId);assert.equal(draft.content,'');assert.ok(canonicalTime(draft.redacted_at));const bodies=originalBodies(f);assert.equal(bodies.length,f.committed.eventIds.length);for(const body of bodies){assert.equal(body.private_json,'');assert.ok(canonicalTime(body.redacted_at));}}
function batchHook(f,action,{after=true}={}){const batch=f.DB.batch;let attempts=0;f.DB.batch=async statements=>{if(mutationBatch(statements)){attempts++;if(attempts===1&&!after)action(statements);const result=await batch.call(f.DB,statements);if(attempts===1&&after)return action(result);return result;}return batch.call(f.DB,statements);};return()=>{f.DB.batch=batch;assert.equal(attempts,1,'one retirement mutation attempt');};}
function statementHook(f,predicate,action,{after=true}={}){const prepare=f.DB.prepare;let hit=false;f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.apply(this,bindings),execute=bound.execute;bound.execute=function(kind){if(!hit&&predicate(sql)){hit=true;if(!after)action();const result=execute.call(this,kind);if(after)action();return result;}return execute.call(this,kind);};return bound;};return statement;};return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native statement hook reached');};}
function readHook(f,predicate,action){const prepare=f.DB.prepare;let hit=false;function wrap(statement,sql){const first=statement.first,bind=statement.bind;statement.bind=function(...bindings){return wrap(bind.apply(this,bindings),sql);};statement.first=async function(){const value=await first.call(this);if(!hit&&predicate(sql)){hit=true;action();}return value;};return statement;}f.DB.prepare=sql=>wrap(prepare.call(f.DB,sql),sql);return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native read hook reached');};}
function nativeCorrupt(f,table,sql,...bindings){const triggers=f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").all(table);
  assert.throws(()=>f.sqlite.prepare(sql).run(...bindings),/immutable|append.only/u,'native immutable history rejects rewriting');
  for(const trigger of triggers)f.sqlite.exec(`DROP TRIGGER "${trigger.name}"`);try{f.sqlite.prepare(sql).run(...bindings);}finally{for(const trigger of triggers)f.sqlite.exec(trigger.sql);}
}
function projectScope(f){insert(f,'project_event_scopes',{event_id:f.saved.eventId,project_access_id:'foreign-access',organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:'foreign-owner',source_stream_id:`creative:${f.session.guestSubject}`,source_sequence:f.saved.revision,project_sequence:1,actor_user_id:'foreign-actor',created_at:time});}
function memoryOrigin(f){insert(f,'memory_document_job_answer_origins',{origin_id:'synthetic-retention-origin',schema_version:1,recipe_version:'native-document-job-answer-origin-v1',job_id:'foreign-job',actor_user_id:'foreign-actor',scope_key:'["","","foreign-project","foreign-document"]',turn_id:'foreign-turn',user_event_id:f.saved.eventId,user_content_id:'foreign-user-body',answer_event_id:'foreign-answer',answer_content_id:'foreign-answer-body',manifest_content_ref:'foreign-manifest',status:'minimized',withdrawn_at:time,withdrawal_reason:'erased'});}
async function deniedUnchanged(f){const before=snapshot(f);await assert.rejects(f.retire(),/unavailable/u);assert.deepEqual(snapshot(f),before);}

for(const memory of [false,true])for(const order of ['source-first','tail-first'])test(`${order} due cleanup and exact replay preserve source history with ${memory?'complete':'absent'} Memory under strict D1 limits`,async t=>{
  const f=await fixture(t,{memory});await expire(f);const limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{if(order==='source-first'){await f.retireSource();sourceErased(f);assert.notEqual(tail(f).private_json,'');}
    const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);const first=tail(f).redacted_at;
    if(order==='tail-first'){const original=originalBodies(f);assert.ok(original.every(row=>row.private_json!==''));await f.retireSource();sourceErased(f);}
    const retired=snapshot(f),count=changes(f);assertRetired(f,await f.retire(),true);assert.equal(tail(f).redacted_at,first);assert.deepEqual(snapshot(f),retired);assert.equal(changes(f),count,'exact replay performs no mutation');
    limits.assertVerified();t.diagnostic(JSON.stringify({memory,order,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}
});
test('active source cannot retire early under revoked authority or a forward process clock',async t=>{
  const f=await fixture(t,{draftLifetimeMs:60000});f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');t.mock.method(Date,'now',()=>8_000_000_000_000);const before=snapshot(f);await assert.rejects(f.retire(),/not_due/u);assert.deepEqual(snapshot(f),before);
});
test('due cleanup ignores live payer, mutable sponsor configuration, revocations and claim lease history',async t=>{
  const f=await fixture(t);f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}',policy_digest='replaced'");f.sqlite.exec("UPDATE experience_sponsor_resource_policies SET enabled=0,limits_json='{}',limits_digest='replaced'");f.sqlite.exec('DELETE FROM users');f.env.FORMA_PILOT_COHORT_ID='later-configured-pilot';
  const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS n`).get().n;insert(f,'experience_guest_claim_leases',{session_id:f.session.sessionId,lease_id:'historic-lease',destination_user_id:'former-user',manifest_digest:f.inventory.manifestDigest,request_id:'historic-request',request_ids_json:'["historic-request"]',acquisitions:1,created_at_ms:now,expires_at_ms:now+60000});
  await expire(f);t.mock.method(Date,'now',()=>0);const before=snapshot(f),prepare=f.DB.prepare;f.DB.prepare=function(sql){assert.doesNotMatch(sql,/\b(?:FROM|JOIN)\s+users\b/iu,'retirement does not consult current payer profile');return prepare.call(this,sql);};
  try{assertRetired(f,await f.retire());onlyTailChanged(f,before);}finally{f.DB.prepare=prepare;}
});
test('expired guest credentials cannot obstruct due tail cleanup',async t=>{
  const f=await fixture(t,{draftLifetimeMs:800,sessionLifetimeMs:1200});await expire(f,{session:true});const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);
});
for(const erased of ['draft','prefix','both'])test(`partially erased ${erased} source still permits exact historical SAVE association retirement`,async t=>{
  const f=await fixture(t);await expire(f);if(erased!=='prefix')f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(time,f.prepared.plan.draftId);
  if(erased!=='draft')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(time,f.committed.eventIds[0]);
  const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);
});
test('canonical preexisting tail tombstone is replayed without refreshing its redaction timestamp',async t=>{
  const f=await fixture(t);await expire(f);f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(time,f.saved.eventId);const before=snapshot(f),count=changes(f);assertRetired(f,await f.retire(),true);assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);assert.equal(tail(f).redacted_at,time);
});
test('a committed context without SAVE is unavailable rather than reported retired',async t=>{const f=await fixture(t,{saved:false});await expire(f);await deniedUnchanged(f);});
test('closed retirement input rejects forged authority and missing source without installing schema',async t=>{
  const f=await fixture(t),before=snapshot(f);for(const input of [{sessionId:f.session.sessionId,ownerUserId:payer},{sessionId:f.session.sessionId,nowMs:8_000_000_000_000},{sessionId:'missing-session'},{}])await assert.rejects(f.retire(input));assert.deepEqual(snapshot(f),before);
});

const corruptions={
  'private owner':f=>f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run(payer,f.saved.eventId),
  'private Document':f=>f.sqlite.prepare("UPDATE event_private_payloads SET document_id='foreign-document' WHERE private_event_id=?").run(f.saved.eventId),
  'retained private payload':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id=?").run(f.saved.eventId),
  'empty body without tombstone':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='' WHERE private_event_id=?").run(f.saved.eventId),
  'retained bytes with tombstone':f=>f.sqlite.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').run(time,f.saved.eventId),
  'noncanonical tombstone':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2020-01-01' WHERE private_event_id=?").run(f.saved.eventId),
  'missing tail body':f=>f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.saved.eventId),
  'command digest':f=>f.sqlite.prepare('UPDATE output_commands SET request_digest=?').run('0'.repeat(64)),
  'command time':f=>f.sqlite.prepare('UPDATE output_commands SET created_at=?').run(time),
  'missing command':f=>f.sqlite.exec('DELETE FROM output_commands'),
  'public private reference':f=>{const row=rows(f,'events').find(row=>row.event_id===f.saved.eventId),payload=JSON.parse(row.payload);payload._private_ref=f.committed.eventIds[0];nativeCorrupt(f,'events','UPDATE events SET payload=? WHERE event_id=?',JSON.stringify(payload),f.saved.eventId);},
  'native actor':f=>nativeCorrupt(f,'events','UPDATE events SET actor=? WHERE event_id=?',payer,f.saved.eventId),
  'resource payload digest':f=>nativeCorrupt(f,'experience_sponsor_resource_receipts','UPDATE experience_sponsor_resource_receipts SET payload_digest=?',`sha256:${'0'.repeat(64)}`),
  'resource measured bytes while original plan is retained':f=>nativeCorrupt(f,'experience_sponsor_resource_receipts','UPDATE experience_sponsor_resource_receipts SET text_bytes=text_bytes+1'),
};
for(const [name,mutate]of Object.entries(corruptions))test(`corrupt ${name} denies tail retirement without changing history`,async t=>{const f=await fixture(t);mutate(f);await expire(f);await deniedUnchanged(f);});
test('coherent retained binding corruption cannot replace the original fully retained source derivation',async t=>{
  const f=await fixture(t),body=JSON.parse(tail(f).private_json);body.output_command_envelope.experienceBinding.sourceBindingHash=`sha256:${'0'.repeat(64)}`;
  nativeCorrupt(f,'experience_sponsor_resource_receipts','UPDATE experience_sponsor_resource_receipts SET payload_digest=?',await digest(body.output_command_envelope));
  f.sqlite.prepare('UPDATE output_commands SET request_digest=?').run(await outputDigest(body.output_command_envelope));f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),f.saved.eventId);await expire(f);await deniedUnchanged(f);
});
function nativePlan(f){insert(f,'output_plan_revisions',{scope_key:`personal:${f.session.guestSubject}:${f.session.projectId}`,scope_kind:'personal',owner_user_id:f.session.guestSubject,project_id:f.session.projectId,document_id:f.session.documentId,plan_revision_id:'subsequent-plan',plan_id:'subsequent-plan',revision:1,confirmed_event_id:f.saved.eventId,requirements_digest:'a'.repeat(64),source_digest:'b'.repeat(64),resolver_version:'synthetic-native-plan',source_head:f.saved.revision,target_count:0,created_at:time});}
function nativeHold(f,{related=false}={}){const owner=related?f.session.guestSubject:payer,stream=related?`creative:${f.session.guestSubject}`:'creative:foreign-actor';
  insert(f,'budget_reservations',{reservation_id:'retention-held-tokens',owner_id:owner,stream_id:stream,correlation_id:'foreign-job',operation:'image',period:'2026-09',reserved_tokens:100,used_tokens:3,status:'active',created_at:time,updated_at:time});
  insert(f,'cost_budget_reservations',{reservation_id:'retention-held-cost',owner_id:owner,workspace_id:'forma',stream_id:stream,correlation_id:'foreign-job',operation:'image',period:'2026-09',reserved_microusd:1234,used_microusd:4,status:'executing',created_at:time,updated_at:time});
}
const footprints={
  'SAVE-linked project scope':projectScope,
  'SAVE-linked Memory origin':memoryOrigin,
  'requirement block custody':f=>insert(f,'project_resource_scopes',{project_access_id:'foreign-access',resource_kind:'block',resource_id:f.saved.requirementId,organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:'foreign-owner',visibility:'collaborative_output',source_event_id:null,actor_user_id:'foreign-actor',created_at:time}),
  'draft retention custody':f=>insert(f,'private_content_retention_scopes',{content_id:f.prepared.plan.draftId,organization_id:'foreign-org',project_access_id:'foreign-access',project_id:'foreign-project',actor_user_id:'foreign-actor',classification:'synthetic',policy_version:1,assigned_expires_at:f.prepared.expiresAt,created_at:time}),
  'subsequent native plan':nativePlan,
  'associated financial hold':f=>nativeHold(f,{related:true}),
  'second native tail':async f=>{const event=makeEvent(`creative:${f.session.guestSubject}`,f.saved.revision+1,f.session.guestSubject,'native-synthetic-successor','later-output','BlockCreated',{project_id:f.session.projectId,document_id:f.session.documentId,block_id:'later-block',type:'subject',scope:'document',properties:{text:'Later native context'}});await insertEventAtHead(f.env,event,f.saved.revision).run();},
};
for(const [name,mutate]of Object.entries(footprints))test(`${name} requires a later retention contract and prevents this narrow cleanup`,async t=>{const f=await fixture(t,{memory:name.includes('Memory')});await mutate(f);await expire(f);await deniedUnchanged(f);});
test('unrelated historical usage, financial holds, private bodies and media stay intact during due cleanup',async t=>{
  const f=await fixture(t);nativeHold(f);insert(f,'private_content',{content_id:'foreign-private',owner_id:'foreign-owner',kind:'experience-draft',content:'Foreign retained source',created_at:time,expires_at:time});
  insert(f,'event_private_payloads',{private_event_id:'foreign-private-event',owner_id:'foreign-owner',project_id:'foreign-project',document_id:'foreign-document',private_json:'{"text":"Foreign source"}',created_at:time});
  const receipt=rows(f,'experience_sponsor_resource_receipts')[0];insert(f,'experience_sponsor_resource_receipts',{...receipt,resource_id:'foreign-history',actor_user_id:'foreign-actor',session_digest:`sha256:${'e'.repeat(64)}`,intent_key:'foreign-history',text_bytes:1048576});
  f.media.set('foreign-media',{bytes:new Uint8Array([1,2,3]),metadata:{scope:'foreign'},contentType:'image/png'});const mediaBefore=structuredClone([...f.media]);await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);assert.deepEqual([...f.media],mediaBefore);
});
for(const kind of ['lost','truncated','false','sparse'])test(`${kind} committed acknowledgment recovers one exact tombstone without another mutation`,async t=>{
  const f=await fixture(t);await expire(f);const before=snapshot(f),done=batchHook(f,result=>{if(kind==='lost')throw Error('lost retirement acknowledgment');if(kind==='truncated')return result.slice(0,-1);if(kind==='sparse'){const copy=[...result];delete copy[0];return copy;}return result.map((row,index)=>index?row:{...row,success:false});});
  assertRetired(f,await f.retire(),true);done();onlyTailChanged(f,before);const first=tail(f).redacted_at;assertRetired(f,await f.retire(),true);assert.equal(tail(f).redacted_at,first);
});
for(const name of ['command','Memory','project'])test(`late ${name} change inside the retirement transaction rolls back the tombstone`,async t=>{
  const f=await fixture(t,{memory:name==='Memory'});await expire(f);const before=snapshot(f),done=statementHook(f,sql=>/^\s*UPDATE event_private_payloads\b/u.test(sql),()=>{if(name==='command')f.sqlite.prepare('UPDATE output_commands SET created_at=?').run(time);else if(name==='Memory')memoryOrigin(f);else projectScope(f);});
  await assert.rejects(f.retire());done();assert.deepEqual(snapshot(f),before);
});
for(const name of ['command','custody','schema'])test(`external ${name} change before the batch is preserved while cleanup is refused`,async t=>{
  const f=await fixture(t);await expire(f);let changed;const done=batchHook(f,()=>{if(name==='command')f.sqlite.prepare('UPDATE output_commands SET created_at=?').run(time);else if(name==='custody')projectScope(f);else installMemory(f);changed=snapshot(f);},{after:false});
  await assert.rejects(f.retire());done();assert.deepEqual(snapshot(f),changed);
});
test('a postcommit custody change with lost acknowledgment preserves the committed tombstone and refuses stale success',async t=>{
  const f=await fixture(t);await expire(f);let committed;const done=batchHook(f,()=>{projectScope(f);committed=snapshot(f);throw Error('lost acknowledgment after custody change');});await assert.rejects(f.retire());done();assert.equal(tail(f).private_json,'');assert.ok(canonicalTime(tail(f).redacted_at));assert.deepEqual(snapshot(f),committed);
});
test('a failed native tail update cannot commit an assertion-only success or erase another body',async t=>{
  const f=await fixture(t);await expire(f);const before=snapshot(f),done=statementHook(f,sql=>/^\s*UPDATE event_private_payloads\b/u.test(sql),()=>{throw Error('native retirement update failed');},{after:false});await assert.rejects(f.retire());done();assert.deepEqual(snapshot(f),before);
});
for(const stage of ['during-read','after-commit','final-read'])test(`database replacement ${stage} cannot report a stale retirement result`,async t=>{
  const f=await fixture(t);await expire(f);const before=snapshot(f),done=stage==='after-commit'?batchHook(f,result=>{f.env.DB={...f.DB};return result;}):readHook(f,sql=>stage==='during-read'?sql.includes('FROM experience_guest_sources'):sql.startsWith('SELECT body.redacted_at FROM event_private_payloads'),()=>{f.env.DB={...f.DB};});await assert.rejects(f.retire(),/database_changed/u);done();f.env.DB=f.DB;if(stage==='during-read')assert.deepEqual(snapshot(f),before);else{assert.equal(tail(f).private_json,'');onlyTailChanged(f,before);}
});
test('session identity is captured before the first awaited historical source read',async t=>{
  const f=await fixture(t);await expire(f);const input={sessionId:f.session.sessionId},before=snapshot(f),done=readHook(f,sql=>sql.includes('FROM experience_guest_sources'),()=>{input.sessionId='mutated-session';});assertRetired(f,await f.retire(input));done();onlyTailChanged(f,before);
});
test('an unrelated native-schema command sharing the SAVE key cannot strand due cleanup of the exact guest scope',async t=>{
  const f=await fixture(t,{async beforeSave(f){const key=await experienceOutputCommandKey(await experienceOutputBinding(f.prepared.plan),'save'),recipe=createExperienceOutputRecipe({output:'image',requirementId:'foreign-requirement',deliverableId:'foreign-deliverable',variantId:'foreign-variant',aspectRatio:{width:1,height:1}}),envelope={action:'save',documentId:'foreign-document',blockId:'foreign-requirement',spec:recipe.spec,clientMutationId:key,expectedRevision:'output:0'};
    const event=makeEvent('creative:foreign-actor',1,'user','server:output',key,'BlockCreated',{block_id:'foreign-requirement',type:'output',scope:'document',project_id:'foreign-project',document_id:'foreign-document',actor_user_id:'foreign-actor',properties:{text:recipe.spec.original_text,subtype:recipe.spec.label,output_spec:recipe.spec,authority:'authored'},output_command_envelope:envelope});
    await insertEventAtHead(f.env,event,0).run();insert(f,'output_commands',{scope_key:'personal:foreign-actor:foreign-project',actor_user_id:'foreign-actor',command_key:key,request_digest:await outputDigest(envelope),action:'save',event_id:event.eventId,created_at:event.recordedAt});
  }});assert.equal(rows(f,'output_commands').length,2);assert.equal(rows(f,'output_commands')[0].actor_user_id,'foreign-actor');await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);
});

async function unrelatedNativeCustody(f){
  const session=await issueGuestClaimSession(request(),f.env,f.terms.policyId),proof=proofFor(session),values=initialValues(f.release);
  values.subject={value:'An unrelated native context',provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const prepared=await prepareGuestImageSource(request(),f.env,{proof,policyId:f.sourcePolicy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:f.release.releaseHash,values}});
  await commitGuestImageSource(request(),f.env,{proof,draftHash:prepared.plan.draftHash});const inventory=await inspectGuestContextInventory(request(),f.env,{proof});
  const canonicalRequest=()=>new Request(`${origin}/unregistered-context-custody`,{method:'POST',headers:{origin,'oai-authenticated-user-id':payer,'oai-authenticated-user-email':`${payer}@example.invalid`}});
  const lease=await acquireGuestClaimLease(canonicalRequest(),f.env,{proof,requestId:'unrelated-custody-request',manifestDigest:inventory.manifestDigest});
  const adoption=await adoptGuestContextSource(canonicalRequest(),f.env,{inventory,leaseId:lease.leaseId,requestId:'unrelated-custody-request'});
  assert.equal(adoption.status,'context-adopted');const retained=await retainGuestContextPlan(canonicalRequest(),f.env,{sessionId:session.sessionId});assert.equal(retained.status,'context-only');assert.deepEqual(retained.plan,prepared.plan);
  return {session,prepared,adoption,retained};
}
for(const populated of [false,true])test(`complete installed adoption and plan-custody families with ${populated?'real unrelated native lineage':'empty history'} permit strict D1 cleanup`,async t=>{
  const f=await fixture(t,{memory:true,custody:true});if(populated)await unrelatedNativeCustody(f);await expire(f);
  const before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{assertRetired(f,await f.retire());onlyTailChanged(f,before);const retired=snapshot(f),count=changes(f);assertRetired(f,await f.retire(),true);assert.deepEqual(snapshot(f),retired);assert.equal(changes(f),count);
    limits.assertVerified();t.diagnostic(JSON.stringify({custody:populated?'native unrelated':'empty',memory:true,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}
});
for(const family of ['adoption lineage','retained plan'])test(`synthetic later association in installed ${family} refuses cleanup while preserving actual unrelated custody history`,async t=>{
  const f=await fixture(t,{custody:true}),other=await unrelatedNativeCustody(f);
  if(family==='adoption lineage'){
    const row=rows(f,'experience_guest_context_adoptions')[0],lineage=JSON.parse(row.lineage_json);lineage.documentId=f.session.documentId;
    nativeCorrupt(f,'experience_guest_context_adoptions','UPDATE experience_guest_context_adoptions SET lineage_json=?,lineage_digest=? WHERE session_id=?',canonicalJson(lineage),await digest(lineage),other.session.sessionId);
  }else nativeCorrupt(f,'experience_guest_plan_custodies','UPDATE experience_guest_plan_custodies SET draft_id=? WHERE session_id=?',f.prepared.plan.draftId,other.session.sessionId);
  await expire(f);await deniedUnchanged(f);
});

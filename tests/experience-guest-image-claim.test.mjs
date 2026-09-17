import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{ensureSchema,readWorkspaceEvents,streamHead,appendAuditEvent},{POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,GUEST_DB_NOW,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA},{approveGuestSponsorCampaign,revokeGuestSponsorCampaign},
  {compileGuestSponsorApprovalProposal},{saveGuestImageRequirement,readGuestImageRequirement},
  {registeredExperience,initialValues},{canonicalJson,digest},{preflightOutputImageSlidesTarget},{sponsorImageTransport},{serializeEvent},
  {GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{handleEvents},{readExistingPrincipalRequest},{continueOutputTrustedContext},{readOutputCommand},{outputDigest},{handleExperienceIntake},{ExperienceIntakeRuntime},{foldEvents},{handleOutputRequirements}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/policy-version.ts'),import('../worker/experience-guest-session.ts'),
  import('../worker/experience-guest-source.ts'),import('../worker/experience-guest-context-inventory.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-approval.ts'),import('../worker/experience-guest-sponsor-contract.ts'),import('../worker/experience-guest-image-output.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),
  import('../worker/event-read-primitives.ts'),import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),import('../worker/events-api.ts'),
  import('../worker/principal-request-core.ts'),import('../worker/output-trusted-context.ts'),import('../worker/output-command-core.ts'),import('../worker/output-disclosure-proof.ts'),import('../worker/experience-intake-api.ts'),import('../src/experiences/intake-runtime.ts'),import('../src/model/events.ts'),import('../worker/output-requirements-api.ts')]);
const origin='https://guest.example.invalid',subject='A blue heron on a stone bridge',payer='synthetic-image-payer',owner='synthetic-image-owner',other='synthetic-other-owner',time='2020-01-01T00:00:00.000Z';
const canonicalHeaders=(actor=owner,extra={})=>({origin,...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...extra});
const canonicalRequest=(actor=owner,extra={})=>new Request(`${origin}/unregistered-image-claim`,{method:'POST',headers:canonicalHeaders(actor,extra)});
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
async function fixture(t,{memory=false,approved=true,draftLifetimeMs=120000,policyChange,subjectText=subject,saved=true,targetHistory=true,leaseLifetimeMs=60000,maximumLeaseAcquisitions=3}={}){
  const f=outputTestDatabase();
  // This frozen helper labels WITH statements as reads. Execute the native resource CTE insertion as a write so its acknowledgment reports real SQLite changes.
  const nativeBatch=f.DB.batch;f.DB.batch=statements=>nativeBatch.call(f.DB,statements.map(statement=>{if(/WITH[\s\S]*INSERT INTO experience_sponsor_resource_receipts/u.test(statement.sql)){const execute=statement.execute;statement.execute=function(kind){return execute.call(this,kind==='all'?'run':kind);};}return statement;}));
  t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA,...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA])f.sqlite.exec(sql);
  if(memory)installMemory(f);for(const actor of [payer,owner,other])insert(f,'users',{user_id:actor,email:`${actor}@example.invalid`,display_name:actor,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
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
  f.env.FORMA_RETENTION_DAYS='2';
  assert.deepEqual(rows(f,'users').map(row=>row.user_id),[payer,owner,other]);f.saved=saved?await f.save():null;
  if(targetHistory){await appendAuditEvent(f.env,`creative:${owner}`,'user','ProjectCreated',{project_id:'unrelated-project',name:'Earlier work'});const previous=[
    {type:'DocumentCreated',payload:{project_id:'unrelated-project',document_id:'unrelated-document',title:'Earlier Document'}},
    {type:'EmptyCanvasChosen',payload:{project_id:'unrelated-project',document_id:'unrelated-document'}}];
    const response=await handleEvents(new Request(`${origin}/api/events`,{method:'POST',headers:canonicalHeaders(owner,{'content-type':'application/json'}),body:JSON.stringify({action:'batch',expectedSequence:1,events:previous})}),f.env);
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.deepEqual(result.rejected,[]);assert.equal(result.appended.length,previous.length);
  }
  f.targetHead=await streamHead(f.env,`creative:${owner}`);f.beforeClaim=snapshot(f);return f;
}

const financeTables=['users','budget_counters','cost_budget_counters','budget_reservations','cost_budget_reservations','document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','experience_sponsor_campaigns','experience_sponsor_resource_policies','experience_sponsor_approvals','experience_sponsor_resource_receipts'];
const finances=f=>Object.fromEntries(financeTables.map(table=>[table,rows(f,table)]));
const targetRows=f=>f.sqlite.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence').all(`creative:${owner}`);
function originalHistory(f){const stream=`creative:${f.session.guestSubject}`;return {
  events:f.sqlite.prepare('SELECT * FROM events WHERE stream_id=? ORDER BY sequence').all(stream),
  bodies:f.sqlite.prepare('SELECT body.* FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.stream_id=? ORDER BY event.sequence').all(stream),
  receipts:f.sqlite.prepare('SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY sequence').all(stream),
  draft:f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(f.prepared.plan.draftId),source:rows(f,'experience_guest_sources'),commits:rows(f,'experience_guest_source_commits'),
  commands:f.sqlite.prepare('SELECT * FROM output_commands WHERE actor_user_id=?').all(f.session.guestSubject),finance:finances(f)};}
function nonemptyFinancialHistory(f){for(const actor of [payer,owner]){
  insert(f,'budget_reservations',{reservation_id:`held-tokens-${actor}`,owner_id:actor,stream_id:`creative:${actor}`,correlation_id:`foreign-job-${actor}`,operation:'image',period:'2026-09',reserved_tokens:100,used_tokens:3,status:'active',created_at:time,updated_at:time});
  insert(f,'cost_budget_reservations',{reservation_id:`held-cost-${actor}`,owner_id:actor,workspace_id:'forma',stream_id:`creative:${actor}`,correlation_id:`foreign-job-${actor}`,operation:'image',period:'2026-09',reserved_microusd:1234,used_microusd:4,status:'executing',created_at:time,updated_at:time});
}}
async function trusted(f,actor=owner){const req=canonicalRequest(actor),auth=await readExistingPrincipalRequest(req,f.env,'creator',{account:'principal'});
  assert.equal('kind'in auth,false,'actual existing principal requires no lifecycle bootstrap');assert.equal(auth.response,null);assert.equal(auth.user.userId,actor);
  const context=await continueOutputTrustedContext(req,f.env,f.session.documentId,'author',auth);assert.equal(context instanceof Response,false);assert.deepEqual(context.sourceProblems,[]);assert.equal(context.sourcePrivateCaptured,true);assert.ok(context.context);return context;
}
async function canonicalEdit(f,type,payload){const head=await streamHead(f.env,`creative:${owner}`),response=await handleEvents(new Request(`${origin}/api/events`,{
  method:'POST',headers:canonicalHeaders(owner,{'content-type':'application/json'}),body:JSON.stringify({action:'batch',expectedSequence:head,events:[{type,payload:{project_id:f.session.projectId,document_id:f.session.documentId,...payload}}]})}),f.env);
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.rejected,[]);assert.equal(body.appended.length,1);return body.appended[0];
}
async function readOnly(f,operation){const before=snapshot(f),count=changes(f),result=await operation();assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);return result;}
function statementHook(f,predicate,action,{method='first',after=true}={}){const prepare=f.DB.prepare;let hits=0;
  function wrap(statement,sql){const original=statement[method],bind=statement.bind;statement.bind=function(...bindings){const bound=wrap(bind.apply(this,bindings),sql);bound.fixtureBindings=bindings;return bound;};
    statement[method]=async function(){if(!hits&&predicate(sql,this.fixtureBindings??[])){hits++;if(!after)await action();const result=await original.call(this);if(after)await action();return result;}return original.call(this);};return statement;}
  f.DB.prepare=function(sql){return wrap(prepare.call(this,sql),sql);};return()=>{f.DB.prepare=prepare;assert.equal(hits,1,'native statement hook reached');};
}
function nativeMutationHook(f,predicate,action){const prepare=f.DB.prepare;let hits=0;f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;
  statement.bind=function(...bindings){const bound=bind.apply(this,bindings),execute=bound.execute;bound.execute=function(kind){const result=execute.call(this,kind);if(!hits&&predicate(sql,bindings)){hits++;action();}return result;};return bound;};return statement;};
  return()=>{f.DB.prepare=prepare;assert.equal(hits,1,'native atomic statement hook reached');};
}
function selectedBatch(f,predicate,action,{after=true}={}){const batch=f.DB.batch;let attempts=0;f.DB.batch=async statements=>{if(predicate(statements)){attempts++;if(attempts===1&&!after)await action(statements);const result=await batch.call(f.DB,statements);if(attempts===1&&after)return action(result);return result;}return batch.call(f.DB,statements);};
  return()=>{f.DB.batch=batch;assert.equal(attempts,1,'exactly one selected mutation batch');};
}

test('native fixture has a real approved guest SAVE and a separate canonical destination with prior native history',async t=>{
  const f=await fixture(t);assert.equal(f.targetHead,3);assert.equal(f.saved.revision,f.committed.head+1);assert.equal(f.saved.custodyTransferred,false);
  const source=await readWorkspaceEvents(f.env,`creative:${f.session.guestSubject}`),target=await readWorkspaceEvents(f.env,`creative:${owner}`);
  assert.equal(source.at(-1).eventId,f.saved.eventId);assert.equal(target.length,3);assert.ok(target.every(event=>event.payload.project_id==='unrelated-project'));
  assert.equal(rows(f,'experience_guest_claim_leases').length,0);assert.equal(rows(f,'experience_guest_context_adoptions').length,0);assert.equal(rows(f,'experience_guest_plan_custodies').length,0);
  assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);assert.equal(rows(f,'output_commands').length,1);
});

async function claimFixture(t,options={}){
  const f=await fixture(t,options),[{GUEST_IMAGE_CLAIM_SCHEMA,claimGuestImageSave,readGuestImageClaim},{inspectGuestImageSaveInventory}]=await Promise.all([
    import('../worker/experience-guest-image-claim.ts'),import('../worker/experience-guest-image-claim-inventory.ts')]);
  for(const sql of GUEST_IMAGE_CLAIM_SCHEMA)f.sqlite.exec(sql);
  f.claimInventory=await inspectGuestImageSaveInventory(request(),f.env,{proof:f.proof});
  f.claimInput={sessionId:f.session.sessionId,requestId:'claim-request-1',approvedManifestDigest:f.claimInventory.manifestDigest,proof:f.proof};
  f.claim=(value=f.claimInput,req=canonicalRequest(),env=f.env)=>claimGuestImageSave(req,env,value);
  f.recover=(req=canonicalRequest(),env=f.env,value={sessionId:f.session.sessionId})=>readGuestImageClaim(req,env,value);
  f.inspect=(req=request(),value={proof:f.proof},env=f.env)=>inspectGuestImageSaveInventory(req,env,value);
  f.beforeClaim=snapshot(f);return f;
}
const withoutProof=f=>({sessionId:f.claimInput.sessionId,requestId:f.claimInput.requestId,approvedManifestDigest:f.claimInput.approvedManifestDigest});
function assertClaim(f,result,{retained=true}={}){
  assert.equal(result.version,1);assert.equal(result.status,'image-save-claimed');assert.equal(result.generationAvailable,false);assert.equal(result.miniAppClaimComplete,false);
  const receipt=result.receipt;assert.equal(receipt.version,1);assert.equal(receipt.status,'image-save-adopted');assert.equal(receipt.sessionId,f.session.sessionId);
  assert.equal(receipt.destinationUserId,owner);assert.equal(receipt.requestId,f.claimInput.requestId);assert.equal(receipt.manifestDigest,f.claimInventory.manifestDigest);
  assert.equal(receipt.projectId,f.session.projectId);assert.equal(receipt.documentId,f.session.documentId);assert.equal(receipt.requirementId,f.saved.requirementId);
  assert.notEqual(receipt.eventId,f.saved.eventId);assert.notEqual(receipt.commandKey,f.saved.commandKey);assert.equal(receipt.revision,f.targetHead+f.committed.head+1);
  assert.equal(receipt.contextCustodyTransferred,true);assert.equal(receipt.requirementCustodyTransferred,true);assert.equal(receipt.generationAvailable,false);assert.equal(receipt.miniAppClaimComplete,false);
  assert.equal(typeof receipt.replayed,'boolean');assert.equal(result.planRetention,retained?'retained':'unavailable');
  for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'private_json','guestSponsorPreparation','SELECT'])assert.ok(!JSON.stringify(receipt).includes(secret),'claim receipt is source-free');
  if(retained){assert.deepEqual(result.retained.plan,f.prepared.plan);assert.equal(result.retained.custody.kind,'guest-context');assert.equal(result.retained.custody.documentId,f.session.documentId);
    assert.equal(result.retained.custody.head,f.targetHead+f.committed.head);assert.equal(result.retained.custody.eventIds.length,f.committed.head);
    assert.equal(result.retained.generationAvailable,false);assert.equal(result.retained.miniAppClaimComplete,false);
  }else{assert.equal(Object.hasOwn(result,'retained'),false);assert.equal(Object.hasOwn(result,'plan'),false);}
  return receipt;
}
for(const memory of [false,true])test(`complete N+1 claim and proofless canonical recovery fit strict D1 limits with ${memory?'complete':'absent'} Memory`,async t=>{
  const f=await claimFixture(t,{memory}),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{const receipt=assertClaim(f,await f.claim());const before=snapshot(f),count=changes(f),recovered=assertClaim(f,await f.claim(withoutProof(f)));
    assert.deepEqual({...recovered,replayed:false},{...receipt,replayed:false});assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);
    const original=await readOnly(f,()=>f.recover());assert.deepEqual({...original,replayed:false},{...receipt,replayed:false});limits.assertVerified();
    t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{if(limits.failures.length)t.diagnostic(JSON.stringify({strictFailures:limits.failures.map(({kind,count,limit,error})=>({kind,count,limit,error})),maxBindings:Math.max(...limits.boundCounts)}));limits.restore();}
});
test('one atomic canonical prefix and native SAVE preserve original guest history, unchanged plan, payer receipts and nonempty financial holds',async t=>{
  const f=await claimFixture(t);nonemptyFinancialHistory(f);const before=snapshot(f),original=originalHistory(f),oldTarget=targetRows(f),oldSession={...rows(f,'experience_guest_sessions')[0]},result=await f.claim(),receipt=assertClaim(f,result);
  assert.deepEqual(originalHistory(f),original);unchangedExcept(f,before,['events','event_private_payloads','event_client_receipts','private_content','output_commands','experience_guest_claim_leases','experience_guest_sessions','experience_guest_context_adoptions','experience_guest_image_claims','experience_guest_plan_custodies']);
  for(const table of ['events','event_private_payloads','event_client_receipts','private_content','output_commands'])for(const row of before.contents[table])assert.ok(rows(f,table).some(current=>JSON.stringify(current)===JSON.stringify(row)),`${table} preserves every original row`);
  assert.deepEqual(targetRows(f).slice(0,oldTarget.length),oldTarget);const added=targetRows(f).slice(oldTarget.length);
  for(const [table,delta]of [['events',f.committed.head+1],['event_private_payloads',f.committed.head+1],['event_client_receipts',f.committed.head],['output_commands',1],['private_content',1]])assert.equal(rows(f,table).length,before.contents[table].length+delta,`${table} exact copy footprint`);
  assert.equal(added.length,f.committed.head+1);assert.deepEqual(added.map(row=>row.sequence),Array.from({length:f.committed.head+1},(_,index)=>f.targetHead+index+1));
  assert.ok(added.every(row=>!original.events.some(old=>old.event_id===row.event_id)));assert.ok(added.slice(0,-1).every(row=>row.actor==='user'&&row.client_id==='server:guest-context-adoption'));
  const tail=added.at(-1);assert.equal(tail.event_id,receipt.eventId);assert.equal(tail.actor,`user:${owner}`);assert.equal(tail.client_id,'server:output-requirements');assert.equal(tail.correlation_id,receipt.commandKey);
  const bodies=rows(f,'event_private_payloads').filter(row=>added.some(event=>event.event_id===row.private_event_id));assert.equal(bodies.length,added.length);assert.ok(bodies.every(row=>row.owner_id===owner&&row.project_id===f.session.projectId&&row.redacted_at===null));
  const session=rows(f,'experience_guest_sessions')[0],adoption=rows(f,'experience_guest_context_adoptions')[0];assert.deepEqual({...session,revoked_at_ms:null},{...oldSession,revoked_at_ms:null});assert.equal(session.revoked_at_ms,adoption.created_at_ms);
  assert.equal(rows(f,'experience_guest_image_claims').length,1);assert.equal(rows(f,'experience_guest_context_adoptions').length,1);assert.equal(rows(f,'experience_guest_plan_custodies').length,1);
  const command=rows(f,'output_commands').find(row=>row.actor_user_id===owner);assert.ok(command);assert.equal(command.command_key,receipt.commandKey);assert.equal(command.scope_key,`personal:${owner}:${f.session.projectId}`);assert.equal(command.event_id,receipt.eventId);
  const copy=rows(f,'private_content').find(row=>row.owner_id===owner&&row.kind==='experience-draft');assert.ok(copy);assert.notEqual(copy.content_id,f.prepared.plan.draftId);assert.equal(copy.content,canonicalJson(f.prepared.plan));
});
test('genuine native command and trusted private context read the copied requirement with original logical IDs',async t=>{
  const f=await claimFixture(t),result=await f.claim(),receipt=assertClaim(f,result),context=await trusted(f);
  assert.equal(context.scope.key,`personal:${owner}:${f.session.projectId}`);assert.equal(context.scope.ownerUserId,owner);assert.equal(context.scope.actorUserId,owner);
  assert.equal(context.ownerHead,receipt.revision);assert.equal(context.requirements.length,1);assert.equal(context.requirements[0].blockId,f.saved.requirementId);
  const guestTail=nativeEvents(f).at(-1),spec=guestTail.payload.properties.output_spec;assert.deepEqual(context.requirements[0].spec,spec);
  const command=rows(f,'output_commands').find(row=>row.actor_user_id===owner),native=await readOutputCommand(f.env,context.scope,command.command_key,command.request_digest);
  assert.ok(native);assert.equal(native.eventId,receipt.eventId);assert.equal(native.action,'save');assert.equal(native.privateUnavailable,undefined);assert.equal(native.requestDigest,await outputDigest(native.payload.output_command_envelope));
  const envelope=native.payload.output_command_envelope;assert.equal(envelope.action,'save');assert.equal(envelope.clientMutationId,receipt.commandKey);assert.equal(envelope.expectedRevision,`output:${f.targetHead+f.committed.head}`);assert.equal(envelope.documentId,f.session.documentId);assert.equal(envelope.blockId,f.saved.requirementId);assert.deepEqual(envelope.spec,spec);
  assert.equal(Object.hasOwn(envelope,'guestSponsorPreparation'),false);assert.equal(native.payload.actor_user_id,owner);
});

test('actual retained draft GET and closed client parser reopen historical settings with same-Document Edit after native context editing',async t=>{
  const f=await claimFixture(t),result=await f.claim(),receipt=assertClaim(f,result),calls=[];
  const runtime=new ExperienceIntakeRuntime(f.prepared.plan.release,async(path,init={})=>{
    const headers=new Headers(init.headers);for(const [key,value]of Object.entries(canonicalHeaders()))headers.set(key,value);
    calls.push({path,method:init.method??'GET'});return handleExperienceIntake(new Request(new URL(path,origin),{...init,headers}),f.env);
  });t.after(()=>runtime.dispose());
  await readOnly(f,()=>runtime.resume(f.prepared.plan.draftId));assert.equal(runtime.state.phase,'complete',JSON.stringify(runtime.state.issues));assert.equal(runtime.contextOnly,true);
  assert.deepEqual(runtime.committedPlan,f.prepared.plan);assert.equal(runtime.canRetry,false);assert.equal(runtime.receipt,undefined);assert.deepEqual(runtime.contextReceipt,result.retained.custody);
  assert.equal(runtime.contextReceipt.appended.length,f.committed.head);assert.equal(runtime.contextReceipt.head,receipt.revision-1);assert.equal(runtime.documentRoute,result.retained.custody.documentRoute);
  assert.ok(runtime.documentRoute.includes(f.session.documentId));assert.ok(!runtime.contextReceipt.eventIds.includes(receipt.eventId));
  const block=f.prepared.plan.events.find(event=>event.type==='BlockCreated'&&event.payload.properties?.text===subject),edited='A heron beside a quiet lake';assert.ok(block);
  await canonicalEdit(f,'BlockPropertyEdited',{block_id:block.payload.block_id,property_path:'text',old_value:subject,new_value:edited});
  await readOnly(f,()=>runtime.recover());assert.equal(runtime.state.phase,'complete',JSON.stringify(runtime.state.issues));assert.deepEqual(runtime.committedPlan,f.prepared.plan);
  const projection=foldEvents(await readWorkspaceEvents(f.env,`creative:${owner}`),Infinity,f.session.documentId,f.session.projectId);
  assert.equal(projection.documentId,f.session.documentId);assert.ok(projection.libraryBlocks.some(item=>item.id===block.payload.block_id&&item.properties.text===edited));
  const current=await trusted(f);assert.equal(current.requirements[0].blockId,f.saved.requirementId);
  const recovered=await readOnly(f,()=>f.claim(withoutProof(f)));assertClaim(f,recovered);assert.ok(calls.every(call=>call.method==='GET'));
  const count=calls.length;await readOnly(f,async()=>{await runtime.submit();runtime.back();await runtime.prepare();assert.equal(runtime.change('subject','Replacement'),false);});assert.equal(calls.length,count);
});
async function outputCall(f,{method='GET',body}={}){const base='/api/output-requirements',path=method==='GET'?`${base}?documentId=${encodeURIComponent(f.session.documentId)}`:base;
  const response=await handleOutputRequirements(new Request(`${origin}${path}`,{method,headers:canonicalHeaders(owner,body?{'content-type':'application/json'}:{}),...(body?{body:JSON.stringify(body)}:{})}),f.env,base,{waitUntil(){assert.fail('unexpected background/provider work');}});
  const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
}

test('empty completed reader is read-only and never creates a lease, custody mapping or canonical draft',async t=>{
  const f=await claimFixture(t);assert.equal(await readOnly(f,()=>f.recover()),null);assert.deepEqual(snapshot(f),f.beforeClaim);
});
for(const [name,change]of Object.entries({
  'unapproved manifest':input=>({...input,approvedManifestDigest:`sha256:${'e'.repeat(64)}`}),
  'missing purpose credentials':input=>{const {proof:ignored,...rest}=input;void ignored;return rest;},
  'different session':input=>({...input,sessionId:crypto.randomUUID()}),
  'forged destination':input=>({...input,destinationUserId:other}),
  'caller supplied plan':input=>({...input,plan:{}}),
  'forged purpose token':input=>({...input,proof:{...input.proof,claimToken:`${input.proof.claimToken}x`}}),
}))test(`initial ${name} refuses without a lease or copy`,async t=>{
  const f=await claimFixture(t),before=snapshot(f);await assert.rejects(f.claim(change(f.claimInput)));assert.deepEqual(snapshot(f),before);
});
for(const field of ['requestId','approvedManifestDigest'])test(`completed recovery binds the exact original ${field}`,async t=>{
  const f=await claimFixture(t);assertClaim(f,await f.claim());const before=snapshot(f),value={...withoutProof(f),[field]:field==='requestId'?'different-request':`sha256:${'e'.repeat(64)}`};
  await assert.rejects(f.claim(value));assert.deepEqual(snapshot(f),before);assertClaim(f,await readOnly(f,()=>f.claim(withoutProof(f))));
});
for(const actor of [null,'nonexistent-actor',other])test(`completed custody is unavailable to ${actor??'anonymous'} without account bootstrap`,async t=>{
  const f=await claimFixture(t);await f.claim();const before=snapshot(f);await assert.rejects(f.recover(canonicalRequest(actor)));assert.deepEqual(snapshot(f),before);
});
for(const name of ['consent','role','private tail','private prefix','Document removal','Project removal'])test(`current canonical ${name} damage denies original recovery without restoring it`,async t=>{
  const f=await claimFixture(t),result=await f.claim(),receipt=assertClaim(f,result);
  if(name==='consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner);
  else if(name==='role')f.sqlite.prepare("UPDATE users SET role='viewer' WHERE user_id=?").run(owner);
  else if(name==='private tail'||name==='private prefix')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),name==='private tail'?receipt.eventId:result.retained.custody.eventIds.at(-1));
  else if(name==='Document removal')await canonicalEdit(f,'DocumentRemoved',{});else await appendAuditEvent(f.env,`creative:${owner}`,'user','ProjectRemoved',{project_id:f.session.projectId});
  const before=snapshot(f);await assert.rejects(f.recover());await assert.rejects(f.claim(withoutProof(f)));assert.deepEqual(snapshot(f),before);
});
for(const name of ['GET','HTTP','query','fragment','cross-site','foreign origin','missing origin','empty project cookie','empty impersonation cookie'])test(`${name} boundary refuses before custody mutation`,async t=>{
  const f=await claimFixture(t),base=`${origin}/unregistered-image-claim`,headers=canonicalHeaders();let url=base,method='POST';
  if(name==='GET')method='GET';else if(name==='HTTP')url=base.replace('https:','http:');else if(name==='query')url+='?unexpected=1';else if(name==='fragment')url+='#unexpected';
  else if(name==='cross-site')headers['sec-fetch-site']='cross-site';else if(name==='foreign origin')headers.origin='https://foreign.invalid';else if(name==='missing origin')delete headers.origin;
  else headers.cookie=name==='empty project cookie'?' forma_project_context=':' forma_impersonation=';
  const before=snapshot(f);await assert.rejects(f.claim(f.claimInput,new Request(url,{method,headers})));assert.deepEqual(snapshot(f),before);
});

test('historical first-SAVE claim retains its approved manifest after production revocation and needs no live payer or provider configuration',async t=>{
  const f=await claimFixture(t),manifest=f.claimInventory.manifestDigest;
  const response=await revokeGuestSponsorCampaign(new Request(`${origin}/unregistered-guest-approval`,{method:'POST',headers:canonicalHeaders(payer,{'content-type':'application/json'}),
    body:JSON.stringify({version:1,action:'revoke-guest-sponsor-campaign',campaignId:f.policy.campaignId,policyDigest:f.compiled.policyDigest,confirmation:'REVOKE_GUEST_SPONSOR_CAMPAIGN'})}),f.env);
  assert.equal(response.status,'revoked');f.sqlite.prepare(`UPDATE experience_guest_source_policies SET revoked_at_ms=${GUEST_DB_NOW} WHERE policy_id=?`).run(f.sourcePolicy.policyId);
  f.sqlite.prepare('DELETE FROM users WHERE user_id=?').run(payer);delete f.env.OPENAI_API_KEY;f.env.OPENAI_MODEL='unavailable';f.env.OPENAI_IMAGE_MODEL='unavailable';
  const source=originalHistory(f),inventory=await f.inspect();assert.equal(inventory.manifestDigest,manifest);assertClaim(f,await f.claim());assert.deepEqual(originalHistory(f),source);
});
test('real native requirement editing and reentry keep the edited same-block projection and never restore the historical claimed SAVE',async t=>{
  const f=await claimFixture(t),receipt=assertClaim(f,await f.claim()),before=await outputCall(f),spec=structuredClone(before.requirements[0].spec);spec.label='Edited canonical Image requirement';
  const input={action:'save',documentId:f.session.documentId,blockId:f.saved.requirementId,spec,expectedRevision:before.revision,clientMutationId:'native-canonical-edit'};
  const edited=await outputCall(f,{method:'POST',body:input});assert.equal(edited.replayed,false);const current=await outputCall(f);assert.equal(current.requirements[0].spec.label,spec.label);assert.equal(current.requirements[0].blockId,f.saved.requirementId);
  const recovery=await readOnly(f,()=>f.recover());assert.deepEqual({...recovery,replayed:false},{...receipt,replayed:false});assertClaim(f,await readOnly(f,()=>f.claim(withoutProof(f))));
  const reopened=await trusted(f);assert.equal(reopened.scope.documentId,f.session.documentId);assert.equal(reopened.requirements[0].blockId,f.saved.requirementId);assert.deepEqual(reopened.requirements[0].spec,spec);
  const replay=await outputCall(f,{method:'POST',body:input});assert.equal(replay.replayed,true);assert.equal(rows(f,'experience_guest_image_claims').length,1);
  assert.equal(rows(f,'events').filter(row=>row.stream_id===`creative:${owner}`&&row.type==='BlockCreated'&&JSON.parse(row.payload).block_id===f.saved.requirementId).length,1);
});

test('genuine N+1 inventory and guarded lease fit strict D1 limits before canonical copy',async t=>{
  const f=await fixture(t),[{GUEST_IMAGE_SAVE_CLAIM_SCHEMA,inspectGuestImageSaveInventory},{acquireGuestImageSaveClaimLease}]=await Promise.all([
    import('../worker/experience-guest-image-claim-inventory.ts'),import('../worker/experience-guest-claim-lease.ts')]);
  for(const sql of GUEST_IMAGE_SAVE_CLAIM_SCHEMA)f.sqlite.exec(sql);const before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{const inventory=await inspectGuestImageSaveInventory(request(),f.env,{proof:f.proof});assert.equal(inventory.sourceHead,f.committed.head);assert.equal(inventory.sourceSaveHead,f.saved.revision);assert.ok(Object.isFrozen(inventory));
    assert.deepEqual(snapshot(f),before);const claimed=await acquireGuestImageSaveClaimLease(canonicalRequest(),f.env,{proof:f.proof,requestId:'inventory-lease',inventory});
    assert.equal(claimed.destinationUserId,owner);assert.equal(claimed.manifestDigest,inventory.manifestDigest);assert.equal(claimed.custodyTransferred,false);assert.equal(targetRows(f).length,f.targetHead);
    const replay=await readOnly(f,()=>acquireGuestImageSaveClaimLease(canonicalRequest(),f.env,{proof:f.proof,requestId:'inventory-lease',inventory}));assert.equal(replay.leaseId,claimed.leaseId);
    limits.assertVerified();t.diagnostic(JSON.stringify({qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}
});

async function inventoryFixture(t,options={}){const f=await fixture(t,options),module=await import('../worker/experience-guest-image-claim-inventory.ts'),lease=await import('../worker/experience-guest-claim-lease.ts');
  for(const sql of module.GUEST_IMAGE_SAVE_CLAIM_SCHEMA)f.sqlite.exec(sql);f.inspect=(req=request(),input={proof:f.proof},env=f.env)=>module.inspectGuestImageSaveInventory(req,env,input);
  f.lease=(inventory,req=canonicalRequest(),proof=f.proof)=>lease.acquireGuestImageSaveClaimLease(req,f.env,{proof,requestId:'inventory-lease',inventory});return f;}
for(const form of ['serialized','spread','fabricated'])test(`guarded N+1 lease refuses ${form} inventory without source or destination writes`,async t=>{
  const f=await inventoryFixture(t),inventory=await f.inspect(),forged=form==='serialized'?structuredClone(inventory):form==='spread'?{...inventory}:{version:1,sessionId:f.session.sessionId,manifestDigest:`sha256:${'e'.repeat(64)}`};
  const before=snapshot(f);await assert.rejects(f.lease(forged));assert.deepEqual(snapshot(f),before);
});
for(const damage of ['source draft redaction','source SAVE redaction','new source event','revoked guest','Memory source registration'])test(`current ${damage} invalidates a captured N+1 inventory before guarded lease mutation`,async t=>{
  const f=await inventoryFixture(t,{memory:damage==='Memory source registration'}),inventory=await f.inspect();
  if(damage==='source draft redaction')f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),f.prepared.plan.draftId);
  else if(damage==='source SAVE redaction')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),f.saved.eventId);
  else if(damage==='new source event')await appendAuditEvent(f.env,`creative:${f.session.guestSubject}`,f.session.guestSubject,'BlockPropertyEdited',{project_id:f.session.projectId,document_id:f.session.documentId,block_id:f.saved.requirementId,property_path:'text',new_value:'Later native history'});
  else if(damage==='revoked guest')f.sqlite.prepare(`UPDATE experience_guest_sessions SET revoked_at_ms=${GUEST_DB_NOW} WHERE session_id=?`).run(f.session.sessionId);
  else insert(f,'memory_document_job_answer_origins',{origin_id:'source-memory',schema_version:1,recipe_version:'native-document-job-answer-origin-v1',job_id:'foreign-job',actor_user_id:'foreign-actor',scope_key:'["","","foreign-project","foreign-document"]',turn_id:'foreign-turn',user_event_id:f.saved.eventId,user_content_id:'foreign-user-body',answer_event_id:'foreign-answer',answer_content_id:'foreign-answer-body',manifest_content_ref:'foreign-manifest',status:'minimized',withdrawn_at:time,withdrawal_reason:'erased'});
  const before=snapshot(f);await assert.rejects(f.lease(inventory));await assert.rejects(f.inspect());assert.deepEqual(snapshot(f),before);assert.equal(rows(f,'experience_guest_claim_leases').length,0);
});
test('context-only N source cannot be silently treated as a first-SAVE claim',async t=>{
  const f=await inventoryFixture(t,{saved:false}),before=snapshot(f);await assert.rejects(f.inspect());assert.deepEqual(snapshot(f),before);
});

for(const transition of ['sponsor revocation','source policy revocation','complete optional issuer schema'])test(`${transition} preserves the approved N+1 manifest and original lease intent`,async t=>{
  const f=await inventoryFixture(t),inventory=await f.inspect(),first=await f.lease(inventory);
  if(transition==='sponsor revocation')await revokeGuestSponsorCampaign(new Request(`${origin}/unregistered-guest-approval`,{method:'POST',headers:canonicalHeaders(payer,{'content-type':'application/json'}),body:JSON.stringify({version:1,action:'revoke-guest-sponsor-campaign',campaignId:f.policy.campaignId,policyDigest:f.compiled.policyDigest,confirmation:'REVOKE_GUEST_SPONSOR_CAMPAIGN'})}),f.env);
  else if(transition==='source policy revocation')f.sqlite.prepare(`UPDATE experience_guest_source_policies SET revoked_at_ms=${GUEST_DB_NOW} WHERE policy_id=?`).run(f.sourcePolicy.policyId);
  else{const {SPONSOR_ISSUER_SCHEMA}=await import('../worker/experience-sponsor-issuer.ts');for(const sql of SPONSOR_ISSUER_SCHEMA)f.sqlite.exec(sql);}
  const before=snapshot(f),fresh=await f.inspect();assert.equal(fresh.manifestDigest,inventory.manifestDigest);const replay=await f.lease(fresh);assert.equal(replay.leaseId,first.leaseId);assert.equal(replay.manifestDigest,first.manifestDigest);
  assert.deepEqual(snapshot(f),before);assert.equal(rows(f,'experience_guest_claim_leases')[0].acquisitions,1);
});
for(const damage of ['custody policy revocation','source prefix redaction','source prefix bytes','source draft bytes','extra guest text receipt','global original block scope','global requirement block scope'])test(`retained ${damage} prevents N+1 custody without modifying the evidence`,async t=>{
  const f=await inventoryFixture(t),inventory=await f.inspect(),block=f.prepared.plan.events.find(event=>event.type==='BlockCreated').payload.block_id;
  if(damage==='custody policy revocation')f.sqlite.prepare(`UPDATE experience_guest_policies SET revoked_at_ms=${GUEST_DB_NOW} WHERE policy_id=?`).run(f.terms.policyId);
  else if(damage==='source prefix redaction')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),f.committed.eventIds.at(-1));
  else if(damage==='source prefix bytes')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text','Changed retained source') WHERE private_event_id=?").run(f.committed.eventIds.at(-1));
  else if(damage==='source draft bytes')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(f.prepared.plan.draftId);
  else if(damage==='extra guest text receipt'){const row=rows(f,'experience_sponsor_resource_receipts')[0];insert(f,'experience_sponsor_resource_receipts',{...row,resource_id:'extra-retained-text',intent_key:'extra-retained-text'});}
  else insert(f,'project_resource_scopes',{project_access_id:'foreign-access',resource_kind:'block',resource_id:damage==='global original block scope'?block:f.saved.requirementId,organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:'foreign-owner',visibility:'collaborative_output',source_event_id:null,actor_user_id:'foreign-actor',created_at:time});
  const before=snapshot(f);await assert.rejects(f.inspect());await assert.rejects(f.lease(inventory));assert.deepEqual(snapshot(f),before);
});
test('N+1 inventory cannot cross database identity or accept another genuine guest session credentials',async t=>{
  const f=await inventoryFixture(t),inventory=await f.inspect(),{acquireGuestImageSaveClaimLease}=await import('../worker/experience-guest-claim-lease.ts'),another=await issueGuestClaimSession(request(),f.env,f.terms.policyId),before=snapshot(f);
  await assert.rejects(acquireGuestImageSaveClaimLease(canonicalRequest(),{...f.env,DB:{...f.DB}},{proof:f.proof,requestId:'inventory-lease',inventory}));
  await assert.rejects(f.lease(inventory,canonicalRequest(),proofFor(another)));assert.deepEqual(snapshot(f),before);
});


function twoArrivals(f,predicate){const batch=f.DB.batch;let arrivals=0,release,reject;const gate=new Promise((resolve,fail)=>{release=resolve;reject=fail;});
  const timer=setTimeout(()=>reject(Error('two actual native transaction contenders did not arrive')),5000);timer.unref();
  f.DB.batch=async statements=>{if(predicate(statements)){arrivals++;if(arrivals===2)release();await gate;}return batch.call(f.DB,statements);};
  return()=>{clearTimeout(timer);f.DB.batch=batch;assert.equal(arrivals,2,'both native mutation contenders reached the barrier');};
}
const claimBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO experience_guest_image_claims'));
const retentionBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO experience_guest_plan_custodies'));
for(const ack of ['lost','truncated','false','sparse'])test(`${ack} canonical-copy acknowledgment recovers the original claim without another copy or text purchase`,async t=>{
  const f=await claimFixture(t),original=originalHistory(f),done=selectedBatch(f,claimBatch,result=>{
    if(ack==='lost')throw Error('lost canonical claim acknowledgment');if(ack==='truncated')return result.slice(0,-1);if(ack==='sparse'){const copy=[...result];delete copy[0];return copy;}
    return result.map((row,index)=>index?row:{...row,success:false});
  });const receipt=assertClaim(f,await f.claim());done();assert.equal(receipt.replayed,true);assert.deepEqual(originalHistory(f),original);
  assert.equal(targetRows(f).length,f.targetHead+f.committed.head+1);assert.equal(rows(f,'experience_guest_image_claims').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);
});
test('simultaneous same-request claims converge on one prefix, SAVE and retained plan',async t=>{
  const f=await claimFixture(t),done=twoArrivals(f,claimBatch);let results;try{results=await Promise.all([f.claim(),f.claim()]);}finally{done();}const receipts=results.map(result=>assertClaim(f,result));
  assert.deepEqual({...receipts[0],replayed:false},{...receipts[1],replayed:false});assert.equal(rows(f,'experience_guest_image_claims').length,1);assert.equal(rows(f,'experience_guest_plan_custodies').length,1);
  assert.equal(rows(f,'experience_guest_claim_leases').length,1);assert.equal(rows(f,'experience_guest_claim_leases')[0].acquisitions,1);assert.equal(targetRows(f).length,f.targetHead+f.committed.head+1);
});
test('competing actual canonical principals cannot both acquire the same guest N+1 custody',async t=>{
  const f=await claimFixture(t),done=twoArrivals(f,statements=>statements.some(statement=>statement.sql.startsWith('INSERT INTO experience_guest_claim_leases')));let results;try{results=await Promise.allSettled([f.claim(),f.claim(f.claimInput,canonicalRequest(other))]);}finally{done();}assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const fulfilled=results.find(result=>result.status==='fulfilled').value,receipt=fulfilled.receipt;assert.ok([owner,other].includes(receipt.destinationUserId));assert.equal(rows(f,'experience_guest_image_claims').length,1);
  const loser=receipt.destinationUserId===owner?other:owner,head=loser===owner?f.targetHead:0;assert.equal(rows(f,'events').filter(row=>row.stream_id===`creative:${loser}`).length,head);
  const before=snapshot(f);await assert.rejects(f.recover(canonicalRequest(loser)));assert.deepEqual(snapshot(f),before);
});
for(const damage of ['source private bytes','canonical consent','target private ownership'])test(`late ${damage} inside the copy transaction rolls back both receipts and every canonical copy`,async t=>{
  const f=await claimFixture(t),before=snapshot(f),original=originalHistory(f),target=targetRows(f),done=nativeMutationHook(f,sql=>sql.includes('INSERT INTO experience_guest_image_claims'),()=>{
    if(damage==='source private bytes')f.sqlite.prepare("UPDATE event_private_payloads SET private_json=private_json||' ' WHERE private_event_id=?").run(f.saved.eventId);
    else if(damage==='canonical consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(owner);
    else f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign-owner' WHERE private_event_id=(SELECT event_id FROM events WHERE stream_id=? ORDER BY sequence DESC LIMIT 1)").run(`creative:${owner}`);
  });await assert.rejects(f.claim());done();unchangedExcept(f,before,['experience_guest_claim_leases']);assert.deepEqual(originalHistory(f),original);assert.deepEqual(targetRows(f),target);
  assert.equal(rows(f,'experience_guest_context_adoptions').length,0);assert.equal(rows(f,'experience_guest_image_claims').length,0);assert.equal(rows(f,'experience_guest_plan_custodies').length,0);assert.equal(rows(f,'experience_guest_sessions')[0].revoked_at_ms,null);
  assert.equal(rows(f,'experience_guest_claim_leases').length,1,'separately committed bounded lease remains original intent');
});
test('failed plan-copy retention reports source-free completed custody and retries only on an explicit later call',async t=>{
  const f=await claimFixture(t),done=selectedBatch(f,retentionBatch,()=>{throw Error('retained plan store unavailable');},{after:false}),result=await f.claim();assertClaim(f,result,{retained:false});done();
  const before=snapshot(f),receipt=await readOnly(f,()=>f.recover());assert.equal(receipt.eventId,result.receipt.eventId);assert.equal(rows(f,'experience_guest_plan_custodies').length,0);
  for(const secret of [subject,f.prepared.plan.draftHash,f.session.sessionToken,f.session.claimToken])assert.ok(!JSON.stringify(result).includes(secret),'partial result returns no private plan');
  assertClaim(f,await f.claim(withoutProof(f)));assert.equal(rows(f,'experience_guest_plan_custodies').length,1);assert.deepEqual(targetRows(f),before.contents.events.filter(row=>row.stream_id===`creative:${owner}`));
});

for(const operation of ['receipt','claim'])test(`later native scope enrollment of an original context block denies canonical ${operation} recovery`,async t=>{
  const f=await claimFixture(t);await f.claim();const block=f.prepared.plan.events.find(event=>event.type==='BlockCreated').payload.block_id;
  insert(f,'project_resource_scopes',{project_access_id:'foreign-access',resource_kind:'block',resource_id:block,organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:'foreign-owner',visibility:'collaborative_output',source_event_id:null,actor_user_id:'foreign-actor',created_at:time});
  const before=snapshot(f);await assert.rejects(operation==='receipt'?f.recover():f.claim(withoutProof(f)));assert.deepEqual(snapshot(f),before);
});
for(const family of ['structured','document-job'])for(const operation of ['receipt','partial claim'])test(`late ${family} family damage after Memory qualification denies ${operation} recovery`,async t=>{
  const f=await claimFixture(t,{memory:true});assertClaim(f,await f.claim());
  if(operation==='partial claim'){const mapping=rows(f,'experience_guest_plan_custodies')[0];f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),mapping.content_id);}
  let matching=0,changed;const done=statementHook(f,sql=>sql.startsWith('SELECT private_json FROM event_private_payloads WHERE private_event_id=')&&++matching===(operation==='receipt'?1:2),()=>{
    f.sqlite.exec(`DROP TABLE ${family==='structured'?'memory_structured_answer_originals':'memory_document_job_origin_dependencies'}`);changed=snapshot(f);
  },{after:false});
  await assert.rejects(operation==='receipt'?f.recover():f.claim(withoutProof(f)));done();assert.deepEqual(snapshot(f),changed);assert.equal(rows(f,'experience_guest_image_claims').length,1);
});

for(const operation of ['v1 adoption reader','v1 retained plan','actual draft GET'])test(`inherited ${operation} refuses a newly governed original prefix block after N+1 claim`,async t=>{
  const f=await claimFixture(t);assertClaim(f,await f.claim());const block=f.prepared.plan.events.find(event=>event.type==='BlockCreated'&&event.payload.properties?.text===subject).payload.block_id;
  insert(f,'project_resource_scopes',{project_access_id:'foreign-access',resource_kind:'block',resource_id:block,organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:'foreign-owner',visibility:'collaborative_output',source_event_id:null,actor_user_id:'foreign-actor',created_at:time});
  const before=snapshot(f);
  if(operation==='v1 adoption reader'){const {readGuestContextAdoption}=await import('../worker/experience-guest-context-adoption.ts');await assert.rejects(readGuestContextAdoption(canonicalRequest(),f.env,{sessionId:f.session.sessionId}));}
  else if(operation==='v1 retained plan'){const {retainGuestContextPlan}=await import('../worker/experience-guest-plan-custody.ts');await assert.rejects(retainGuestContextPlan(canonicalRequest(),f.env,{sessionId:f.session.sessionId}));}
  else{const response=await handleExperienceIntake(new Request(`${origin}/api/experiences/drafts/${f.prepared.plan.draftId}`,{headers:canonicalHeaders()}),f.env);assert.notEqual(response.status,200);}
  assert.deepEqual(snapshot(f),before);
});

test('actual renewed lease history beyond 8192 bytes remains intact through N+1 claim and completed recovery',{timeout:60000},async t=>{
  const f=await claimFixture(t,{leaseLifetimeMs:500,maximumLeaseAcquisitions:100}),{acquireGuestClaimLease}=await import('../worker/experience-guest-claim-lease.ts');let firstLease;
  const requestId=index=>`r${String(index).padStart(3,'0')}${'x'.repeat(156)}`;
  const waitExpired=async()=>{const start=performance.now();while(!f.sqlite.prepare(`SELECT expires_at_ms<=${GUEST_DB_NOW} AS expired FROM experience_guest_claim_leases WHERE session_id=?`).get(f.session.sessionId).expired){assert.ok(performance.now()-start<2000,'actual DB lease clock advances');await delay(5);}};
  // These are genuine bounded native renewals. No retained row, timestamp,
  // trigger or policy is rewritten to manufacture a long history.
  for(let index=0;index<55;index++){if(index)await waitExpired();const lease=await acquireGuestClaimLease(canonicalRequest(),f.env,{proof:f.proof,requestId:requestId(index),manifestDigest:f.claimInventory.manifestDigest});firstLease??=lease.leaseId;assert.equal(lease.leaseId,firstLease);}
  await waitExpired();f.claimInput.requestId=requestId(55);const receipt=assertClaim(f,await f.claim()),lease=rows(f,'experience_guest_claim_leases')[0],prefix=JSON.parse(rows(f,'experience_guest_context_adoptions')[0].lineage_json);
  assert.equal(lease.acquisitions,56);assert.ok(lease.request_ids_json.length>8192);assert.equal(receipt.leaseId,firstLease);assert.equal(prefix.lease.request_ids_json,lease.request_ids_json);
  assert.equal(JSON.parse(lease.request_ids_json).at(-1),f.claimInput.requestId);assertClaim(f,await readOnly(f,()=>f.claim(withoutProof(f))));
});

for(const kind of ['unrelated block','same ID non-block'])test(`${kind} scope does not invalidate canonical recovery or inherited retained settings`,async t=>{
  const f=await claimFixture(t),first=await f.claim(),block=f.prepared.plan.events.find(event=>event.type==='BlockCreated').payload.block_id;
  insert(f,'project_resource_scopes',{project_access_id:'foreign-access',resource_kind:kind==='unrelated block'?'block':'document',resource_id:kind==='unrelated block'?'foreign-block':block,organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:'foreign-owner',visibility:'collaborative_output',source_event_id:null,actor_user_id:'foreign-actor',created_at:time});
  const recovered=await readOnly(f,()=>f.recover());assert.equal(recovered.eventId,first.receipt.eventId);assertClaim(f,await readOnly(f,()=>f.claim(withoutProof(f))));
  const {retainGuestContextPlan}=await import('../worker/experience-guest-plan-custody.ts');assert.deepEqual((await readOnly(f,()=>retainGuestContextPlan(canonicalRequest(),f.env,{sessionId:f.session.sessionId}))).plan,f.prepared.plan);
  const response=await readOnly(f,()=>handleExperienceIntake(new Request(`${origin}/api/experiences/drafts/${f.prepared.plan.draftId}`,{headers:canonicalHeaders()}),f.env));assert.equal(response.status,200);
});
for(const operation of ['receipt','retained claim'])for(const damage of ['database','abort','identity headers'])test(`${damage} changes at the final ${operation} settlement cannot return stale authority`,async t=>{
  const f=await claimFixture(t);await f.claim();const before=snapshot(f),controller=new AbortController(),req=new Request(canonicalRequest(),{signal:controller.signal});
  const done=statementHook(f,sql=>sql.startsWith('SELECT 1 AS current WHERE EXISTS(WITH claim_p')&&(operation==='receipt'||sql.includes('experience_guest_plan_custodies mapping JOIN private_content content')),()=>{
    if(damage==='database')f.env.DB={...f.DB};else if(damage==='abort')controller.abort();else req.headers.set('oai-authenticated-user-id',other);
  });await assert.rejects(operation==='receipt'?f.recover(req):f.claim(withoutProof(f),req));done();f.env.DB=f.DB;assert.deepEqual(snapshot(f),before);
});
test('target private damage before the final joined plan read discards every held private plan byte',async t=>{
  const f=await claimFixture(t),receipt=assertClaim(f,await f.claim());let changed;
  const done=statementHook(f,sql=>sql.startsWith('SELECT 1 AS current WHERE EXISTS(WITH claim_p')&&sql.includes('experience_guest_plan_custodies mapping JOIN private_content content'),()=>{
    f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),receipt.eventId);changed=snapshot(f);
  },{after:false});await assert.rejects(f.claim(withoutProof(f)));done();assert.deepEqual(snapshot(f),changed);assert.equal(rows(f,'experience_guest_image_claims').length,1);
});

test('scope enrollment immediately before the inherited final proof refuses without a stale copied prefix',async t=>{
  const f=await claimFixture(t);await f.claim();const block=f.prepared.plan.events.find(event=>event.type==='BlockCreated').payload.block_id,{readGuestContextAdoption}=await import('../worker/experience-guest-context-adoption.ts');let changed;
  const done=statementHook(f,sql=>sql.startsWith('SELECT 1 AS current WHERE')&&sql.includes('experience_guest_context_adoptions')&&sql.includes('project_resource_scopes'),()=>{
    insert(f,'project_resource_scopes',{project_access_id:'late-foreign-access',resource_kind:'block',resource_id:block,organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:'foreign-owner',visibility:'collaborative_output',source_event_id:null,actor_user_id:'foreign-actor',created_at:time});changed=snapshot(f);
  },{after:false});await assert.rejects(readGuestContextAdoption(canonicalRequest(),f.env,{sessionId:f.session.sessionId}));done();assert.deepEqual(snapshot(f),changed);
});
test('claim intent and purpose credentials are copied before the first awaited completed-custody read',async t=>{
  const f=await claimFixture(t),input=structuredClone(f.claimInput),done=statementHook(f,sql=>sql.includes('FROM experience_guest_context_adoptions'),()=>{
    input.requestId='changed-after-await';input.approvedManifestDigest=`sha256:${'e'.repeat(64)}`;input.proof.claimToken='changed-after-await';input.sessionId=crypto.randomUUID();
  });assertClaim(f,await f.claim(input));done();assert.equal(rows(f,'experience_guest_image_claims')[0].request_id,f.claimInput.requestId);
});

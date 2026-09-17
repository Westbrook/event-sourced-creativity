import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{ensureSchema},{POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,GUEST_DB_NOW,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA},{approveGuestSponsorCampaign,readApprovedGuestSponsorCampaign},
  {compileGuestSponsorApprovalProposal},{saveGuestImageRequirement,readGuestImageRequirement},
  {registeredExperience,initialValues,experienceResourceId},{canonicalJson,digest},{preflightOutputImageSlidesTarget},{sponsorImageTransport},
  {experienceOutputBinding,experienceOutputCommandKey},{createExperienceOutputRecipe},{serializeEvent},{foldEvents},
  {outputRequirements,normalizePlanSuggestions},{authoritativeCreativeContext},{outputDigest},{publicEventPayload},{acquireGuestClaimLease},{GUEST_CONTEXT_ADOPTION_SCHEMA,adoptGuestContextSource},{makeEvent},{insertEventAtHead},{inspectGuestImageOutput,guestImageOutputData,recheckGuestImageOutput},{SPONSOR_NATIVE_IMAGE_READ_INDEXES},{SPONSOR_DRIVER_SCHEMA},{SPONSOR_ISSUER_SCHEMA}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/policy-version.ts'),import('../worker/experience-guest-session.ts'),
  import('../worker/experience-guest-source.ts'),import('../worker/experience-guest-context-inventory.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-approval.ts'),import('../worker/experience-guest-sponsor-contract.ts'),import('../worker/experience-guest-image-output.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),
  import('../worker/experience-output-binding.ts'),import('../worker/experience-output-recipe.ts'),import('../worker/event-read-primitives.ts'),import('../src/model/events.ts'),
  import('../worker/output-trusted-context.ts'),import('../worker/context-authority.ts'),import('../worker/output-disclosure-proof.ts'),import('../worker/event-privacy.ts'),import('../worker/experience-guest-claim-lease.ts'),import('../worker/experience-guest-context-adoption.ts'),import('../worker/event-write-primitives.ts'),import('../worker/event-append.ts'),import('../worker/experience-guest-image-output-witness.ts'),import('../worker/experience-sponsor-native-image-read.ts'),import('../worker/experience-sponsor-driver.ts'),import('../worker/experience-sponsor-issuer.ts')]);
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
async function fixture(t,{memory=false,approved=true,draftLifetimeMs=120000,policyChange,subjectText=subject}={}){
  const f=outputTestDatabase();
  // This frozen helper labels WITH statements as reads. Execute the native resource CTE insertion as a write so its acknowledgment reports real SQLite changes.
  const nativeBatch=f.DB.batch;f.DB.batch=statements=>nativeBatch.call(f.DB,statements.map(statement=>{if(/WITH[\s\S]*INSERT INTO experience_sponsor_resource_receipts/u.test(statement.sql)){const execute=statement.execute;statement.execute=function(kind){return execute.call(this,kind==='all'?'run':kind);};}return statement;}));
  t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA])f.sqlite.exec(sql);
  if(memory)installMemory(f);insert(f,'users',{user_id:payer,email:`${payer}@example.invalid`,display_name:payer,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
  Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  let egress=0,media=0;t.mock.method(globalThis,'fetch',()=>{egress++;throw Error('network forbidden');});for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{media++;throw Error('media forbidden');});
  t.after(()=>{assert.equal(egress,0);assert.equal(media,0);});const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:now-60000,expiresAtMs:now+600000,sessionLifetimeMs:300000,leaseLifetimeMs:60000,maximumSessions:5,maximumLeaseAcquisitions:3});
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
  assert.equal(rows(f,'users').length,1);assert.equal(rows(f,'users')[0].user_id,payer);return f;
}
const saveBatch=statements=>statements.some(statement=>statement.sql.startsWith('INSERT INTO output_commands'));
function batchHook(f,action,{after=true}={}){const batch=f.DB.batch;let attempts=0;f.DB.batch=async statements=>{
  if(saveBatch(statements)){attempts++;if(attempts===1&&!after)action(statements);const result=await batch.call(f.DB,statements);if(attempts===1&&after)return action(result);return result;}return batch.call(f.DB,statements);};
  return()=>{f.DB.batch=batch;assert.equal(attempts,1,'exactly one SAVE mutation attempt');};}
function readHook(f,predicate,action,{after=true,method='first'}={}){const prepare=f.DB.prepare;let hit=false;
  function wrap(statement,sql){const original=statement[method],bind=statement.bind;statement.bind=function(...args){return wrap(bind.apply(this,args),sql);};statement[method]=async function(){if(!hit&&predicate(sql)){hit=true;if(!after)action();const result=await original.call(this);if(after)action();return result;}return original.call(this);};return statement;}
  f.DB.prepare=function(sql){return wrap(prepare.call(this,sql),sql);};return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native read hook executed');};}
function assertSaved(f,result,replayed=false){assert.deepEqual(Object.keys(result).sort(),['status','documentId','requirementId','commandKey','eventId','revision','replayed','planConfirmed','admissionCommitted','generationAvailable','custodyTransferred'].sort());
  assert.equal(result.status,'saved');assert.equal(result.documentId,f.session.documentId);assert.equal(result.revision,f.committed.head+1);assert.equal(result.replayed,replayed);assert.ok(Object.isFrozen(result));
  for(const key of ['planConfirmed','admissionCommitted','generationAvailable','custodyTransferred'])assert.equal(result[key],false,key);
  for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'private_json','guestSponsorPreparation','SELECT'])assert.ok(!JSON.stringify(result).includes(secret),'SAVE summary excludes private source and authority internals');
}
function redactSource(f){f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId);}
function addLease(f,expired=false){const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;f.sqlite.prepare('INSERT INTO experience_guest_claim_leases VALUES(?,?,?,?,?,?,?,?,?)').run(f.session.sessionId,crypto.randomUUID(),payer,f.inventory.manifestDigest,'lease-request','["lease-request"]',1,now-1000,expired?now-1:now+60000);}
async function waitUntil(predicate){const start=performance.now();while(!predicate()){assert.ok(performance.now()-start<5000);await delay(10);}}

for(const memory of [false,true])test(`first SAVE, reopen and exact replay fit strict D1 limits with ${memory?'complete':'absent'} Memory`,async t=>{
  const f=await fixture(t,{memory}),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{assert.equal(await f.read(),null);assertSaved(f,await f.save());assertSaved(f,await f.read(),true);assertSaved(f,await f.save(),true);limits.assertVerified();
    t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}unchangedExcept(f,before);
});
test('native SAVE preserves the original source and adds exactly one private unconfirmed Image requirement, command and text receipt',async t=>{
  const f=await fixture(t),before=snapshot(f),original=nativeEvents(f),result=await f.save();assertSaved(f,result);unchangedExcept(f,before);
  for(const table of ['events','event_private_payloads']){const key=table==='events'?'event_id':'private_event_id',oldIds=new Set(before.contents[table].map(row=>row[key]));assert.deepEqual(rows(f,table).filter(row=>oldIds.has(row[key])),before.contents[table]);assert.equal(rows(f,table).length,before.contents[table].length+1);}
  assert.equal(rows(f,'output_commands').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);
  const events=nativeEvents(f);assert.deepEqual(events.slice(0,-1),original);assert.equal(events.length,original.length+1);const event=events.at(-1),body=event.payload;
  assert.equal(event.eventId,result.eventId);assert.equal(event.actor,f.session.guestSubject);assert.equal(event.clientId,'server:guest-output');assert.equal(event.correlationId,result.commandKey);assert.equal(event.sequence,f.committed.head+1);assert.equal(event.type,'BlockCreated');
  assert.equal(event.causationId,null);assert.equal(event.compensatesEventId,null);assert.equal(event.schemaVersion,1);assert.equal(body.actor_user_id,f.session.guestSubject);assert.equal(body.block_id,result.requirementId);
  assert.equal(body.project_id,f.session.projectId);assert.equal(body.document_id,f.session.documentId);assert.equal(body.type,'output');assert.equal(body.scope,'document');assert.equal(body.position,`z-output-${result.requirementId}`);assert.equal(body.handle,`output/${result.requirementId}`);
  const recipe=createExperienceOutputRecipe({output:'image',requirementId:await experienceResourceId(f.prepared.plan.draftId,'native-output-requirement'),deliverableId:await experienceResourceId(f.prepared.plan.draftId,'native-output-deliverable'),variantId:await experienceResourceId(f.prepared.plan.draftId,'native-output-variant'),aspectRatio:{width:1,height:1}});
  assert.deepEqual(body.properties.output_spec,recipe.spec);assert.deepEqual(body.properties.output_plan_suggestions,normalizePlanSuggestions(recipe.spec,undefined,true));assert.equal(body.properties.authority,'authored');
  const projection=foldEvents(events),requirements=outputRequirements(projection);assert.equal(requirements.length,1);assert.equal(requirements[0].blockId,result.requirementId);assert.deepEqual(requirements[0].spec,recipe.spec);
  const [command]=rows(f,'output_commands'),[resource]=rows(f,'experience_sponsor_resource_receipts'),publicRow=rows(f,'events').find(row=>row.event_id===event.eventId),privateRow=rows(f,'event_private_payloads').find(row=>row.private_event_id===event.eventId);
  const binding=await experienceOutputBinding(f.prepared.plan);assert.equal(result.commandKey,await experienceOutputCommandKey(binding,'save'));assert.equal(command.scope_key,`personal:${f.session.guestSubject}:${f.session.projectId}`);assert.equal(command.actor_user_id,f.session.guestSubject);assert.equal(command.action,'save');assert.equal(command.event_id,result.eventId);assert.equal(command.command_key,result.commandKey);assert.equal(command.created_at,event.recordedAt);
  assert.equal(command.request_digest,await outputDigest(body.output_command_envelope));assert.equal(privateRow.owner_id,f.session.guestSubject);assert.equal(privateRow.private_json,JSON.stringify(body));assert.deepEqual(JSON.parse(publicRow.payload),publicEventPayload(event.eventId,body,true).payload);
  assert.equal(JSON.stringify(JSON.parse(publicRow.payload)).includes('guestSponsorPreparation'),false);assert.equal(JSON.stringify(body).includes(f.session.sessionToken),false);assert.equal(JSON.stringify(body).includes(f.session.claimToken),false);
  assert.deepEqual(Object.keys(body.output_command_envelope.guestSponsorPreparation).sort(),['protocol','campaignId','approvalId','termsDigest','policyDigest','session','source','driver'].sort());
  assert.equal(body.output_command_envelope.guestSponsorPreparation.policyDigest,f.compiled.policyDigest);assert.equal(body.output_command_envelope.guestSponsorPreparation.termsDigest,f.compiled.termsDigest);
  assert.equal(resource.resource_id,`${result.commandKey}:text`);assert.equal(resource.operation,'text-intake');assert.equal(resource.intent_key,result.commandKey);assert.equal(resource.actor_user_id,f.session.guestSubject);assert.equal(resource.issued_grant_id,null);assert.equal(resource.policy_digest,f.compiled.policyDigest);
  assert.equal(resource.payload_digest,await digest(body.output_command_envelope));assert.equal(resource.text_bytes,Buffer.byteLength(canonicalJson(authoritativeCreativeContext(original,{projectId:f.session.projectId,documentId:f.session.documentId}).snapshot)));
  assert.equal(rows(f,'event_write_stage').length,0);assert.equal(rows(f,'output_atomic_assertions').length,0);assert.equal(rows(f,'event_client_receipts').length,f.committed.head);
});
test('empty read proves the original inventory without writes, while SAVE deliberately closes context-only claim eligibility',async t=>{
  const f=await fixture(t),before=snapshot(f),count=changes(f);assert.equal(await f.read(),null);assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);
  await f.save();const saved=snapshot(f);await assert.rejects(inspectGuestContextInventory(request(),f.env,{proof:f.proof}));assert.deepEqual(snapshot(f),saved);
});
test('reopen and repeated exact SAVE are read-only and keep the original event, command and resource identity',async t=>{
  const f=await fixture(t),first=await f.save(),before=snapshot(f),count=changes(f);for(const result of [await f.read(),await f.save(),await f.save()]){assertSaved(f,result,true);assert.deepEqual({...result,replayed:false},first);}
  assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);
});
test('concurrent identical SAVE calls converge on one native event and one preparation debit',{timeout:5000},async t=>{
  const f=await fixture(t),before=snapshot(f),batch=f.DB.batch;let release,arrivals=0;const barrier=new Promise(resolve=>{release=resolve;});
  f.DB.batch=async statements=>{if(saveBatch(statements)){arrivals++;if(arrivals===2)release();await barrier;}return batch.call(f.DB,statements);};
  const results=await Promise.all([f.save(),f.save()]);f.DB.batch=batch;assert.equal(arrivals,2,'both calls captured an empty source before either transaction');assert.equal(results.filter(result=>!result.replayed).length,1);assert.equal(results[0].eventId,results[1].eventId);
  assert.equal(rows(f,'output_commands').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);assert.equal(rows(f,'events').length,f.committed.head+1);unchangedExcept(f,before);
});
for(const kind of ['lost','truncated','false','sparse'])test(`${kind} batch acknowledgment resolves only the original current SAVE without another mutation`,async t=>{
  const f=await fixture(t),done=batchHook(f,result=>{if(kind==='lost')throw Error('lost ack');if(kind==='truncated')return result.slice(0,-1);if(kind==='sparse'){const copy=[...result];delete copy[Math.floor(copy.length/2)];return copy;}return result.map((row,index)=>index?row:{...row,success:false});});
  assertSaved(f,await f.save(),true);done();assert.equal(rows(f,'output_commands').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);
});
for(const stage of ['resource','event','command','final'])test(`late ${stage} transaction failure rolls back quota, event and command together`,async t=>{
  const f=await fixture(t),before=snapshot(f),prepare=f.DB.prepare;let hit=false,commandWritten=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;bound.execute=function(kind){
    if(sql.startsWith('INSERT INTO output_commands'))commandWritten=true;
    const selected=stage==='resource'?sql.includes('INSERT INTO experience_sponsor_resource_receipts'):stage==='event'?sql.startsWith('INSERT INTO event_write_stage'):stage==='command'?sql.startsWith('INSERT INTO output_commands'):commandWritten&&sql.startsWith('INSERT INTO output_atomic_assertions');
    if(!hit&&selected){hit=true;throw Error('native injected late failure');}return execute.call(this,kind);};return bound;};return statement;};
  await assert.rejects(f.save());f.DB.prepare=prepare;assert.equal(hit,true);assert.deepEqual(snapshot(f),before);
});
test('compiled candidate terms without a real payer approval cannot save or report an empty eligible source',async t=>{
  const f=await fixture(t,{approved:false}),before=snapshot(f);await assert.rejects(f.save());await assert.rejects(f.read());assert.deepEqual(snapshot(f),before);
});
test('closed internal SAVE input cannot smuggle confirmation, spending, source specs or authority',async t=>{
  const f=await fixture(t),before=snapshot(f);for(const input of [{...f.input,explicitAuthorization:true},{...f.input,actorUserId:payer},{...f.input,spec:{}},{...f.input,expectedRevision:1},{...f.input,policy:f.compiled.policy},
    {...f.input,draftHash:`sha256:${'0'.repeat(64)}`},{...f.input,policyDigest:`sha256:${'0'.repeat(64)}`},{...f.input,proof:{...f.proof,claimToken:f.proof.sessionToken}}]){await assert.rejects(f.save(input));await assert.rejects(f.read(input));}assert.deepEqual(snapshot(f),before);
});
for(const stage of ['before','after'])test(`current source and payer policy remain mandatory ${stage} SAVE`,async t=>{
  for(const sql of ['UPDATE experience_guest_sessions SET revoked_at_ms=1','UPDATE experience_guest_policies SET revoked_at_ms=1','UPDATE experience_guest_source_policies SET revoked_at_ms=1',
    'UPDATE experience_sponsor_campaigns SET enabled=0','UPDATE experience_sponsor_resource_policies SET enabled=0','UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1',
    "UPDATE users SET consent_version=NULL", "UPDATE users SET updated_at='2021-01-01T00:00:00.000Z'"]){const f=await fixture(t);if(stage==='after')await f.save();f.sqlite.exec(sql);const before=snapshot(f);await assert.rejects(f.save());await assert.rejects(f.read());assert.deepEqual(snapshot(f),before);}
});
for(const expired of [false,true])test(`${expired?'expired':'active'} claim lease blocks the first SAVE without a debit`,async t=>{
  const f=await fixture(t);addLease(f,expired);const before=snapshot(f);await assert.rejects(f.save());await assert.rejects(f.read());assert.deepEqual(snapshot(f),before);
});
for(const stage of ['before','after'])test(`source redaction ${stage} SAVE cannot be repaired from retained event metadata`,async t=>{
  const f=await fixture(t);if(stage==='after')await f.save();redactSource(f);const before=snapshot(f);await assert.rejects(f.save());await assert.rejects(f.read());assert.deepEqual(snapshot(f),before);
});
test('original source expiry denies saved reopen without deleting any history',async t=>{
  const f=await fixture(t,{draftLifetimeMs:600});await f.save();await waitUntil(()=>f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS expired FROM experience_guest_sources").get().expired);
  const before=snapshot(f);await assert.rejects(f.read());await assert.rejects(f.save());assert.deepEqual(snapshot(f),before);
});
test('campaign substitution cannot get a second SAVE identity for the same original draft',async t=>{
  const f=await fixture(t),first=await f.save(),policy=structuredClone(f.policy);policy.campaignId='second-approved-campaign';const compiled=await approvePolicy(f,policy,'second-approval'),before=snapshot(f);
  await assert.rejects(f.save({...f.input,campaignId:policy.campaignId,policyDigest:compiled.policyDigest}));assert.deepEqual(snapshot(f),before);assert.equal((await f.read()).eventId,first.eventId);
});

const contextBytes=f=>Buffer.byteLength(canonicalJson(authoritativeCreativeContext(nativeEvents(f).slice(0,f.committed.head),{projectId:f.session.projectId,documentId:f.session.documentId}).snapshot));
function unrelatedReceipt(f,overrides={}){const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;insert(f,'experience_sponsor_resource_receipts',{resource_id:'unrelated-receipt',campaign_id:f.policy.campaignId,policy_digest:f.compiled.policyDigest,limits_digest:rows(f,'experience_sponsor_resource_policies')[0].limits_digest,actor_user_id:'another-guest',session_digest:`sha256:${'e'.repeat(64)}`,operation:'text-intake',intent_key:'unrelated-intent',payload_digest:`sha256:${'f'.repeat(64)}`,text_bytes:1,issued_grant_id:null,recorded_at_ms:now,...overrides});}
async function appendOther(f,{stream=`creative:${f.session.guestSubject}`,sequence=f.committed.head+1,actor=f.session.guestSubject,payload}={}){const event=makeEvent(stream,sequence,actor,'synthetic-native-client','synthetic-tail','BlockCreated',payload??{project_id:f.session.projectId,document_id:f.session.documentId,block_id:crypto.randomUUID(),type:'subject',scope:'document',properties:{text:'Additional native context',authority:'authored'}});await insertEventAtHead(f.env,event,sequence-1).run();return event;}
async function denyUnchanged(f){const before=snapshot(f);await assert.rejects(f.read());await assert.rejects(f.save());assert.deepEqual(snapshot(f),before);}

test('a genuine original inventory can acquire a stale lease after SAVE; adoption and saved reopen then fail closed',async t=>{
  const f=await fixture(t);for(const sql of GUEST_CONTEXT_ADOPTION_SCHEMA)f.sqlite.exec(sql);
  const original=structuredClone(rows(f,'events')),inventory=f.inventory,first=await f.save(),afterSave=snapshot(f);
  const canonical=()=>new Request(`${origin}/unregistered-guest-claim`,{method:'POST',headers:{origin,'oai-authenticated-user-id':payer,'oai-authenticated-user-email':`${payer}@example.invalid`}});
  const lease=await acquireGuestClaimLease(canonical(),f.env,{proof:f.proof,requestId:'stale-inventory-request',manifestDigest:inventory.manifestDigest});
  assert.equal(lease.status,'claiming');assert.equal(lease.manifestDigest,inventory.manifestDigest);const afterLease=snapshot(f);
  await assert.rejects(adoptGuestContextSource(canonical(),f.env,{inventory,leaseId:lease.leaseId,requestId:'stale-inventory-request'}));
  await assert.rejects(f.read());await assert.rejects(f.save());assert.deepEqual(snapshot(f),afterLease);
  assert.deepEqual(rows(f,'events').slice(0,original.length).map(row=>({...row})),original);assert.equal(rows(f,'events').length,f.committed.head+1);assert.equal(rows(f,'output_commands')[0].event_id,first.eventId);
  assert.deepEqual(rows(f,'output_commands'),afterSave.contents.output_commands);assert.deepEqual(rows(f,'experience_sponsor_resource_receipts'),afterSave.contents.experience_sponsor_resource_receipts);
  assert.equal(rows(f,'experience_guest_context_adoptions').length,0);assert.equal(rows(f,'experience_guest_claim_leases').length,1);assert.equal(rows(f,'experience_guest_sessions')[0].revoked_at_ms,null);
  t.diagnostic('Reproduced next-increment defect: inventory N → SAVE N+1 → native stale lease succeeds → adoption refused → exact SAVE reopen refused; one output and original preparation receipt remain intact.');
});

for(const kind of ['command','receipt','native-tail'])test(`an orphan ${kind} cannot be laundered as empty or completed SAVE`,async t=>{
  const f=await fixture(t);if(kind==='command')insert(f,'output_commands',{scope_key:`personal:${f.session.guestSubject}:${f.session.projectId}`,actor_user_id:f.session.guestSubject,command_key:'foreign-output-command',request_digest:'a'.repeat(64),action:'save',event_id:rows(f,'events')[0].event_id,created_at:time});
  else if(kind==='receipt')unrelatedReceipt(f,{actor_user_id:f.session.guestSubject});else await appendOther(f);await denyUnchanged(f);
});
for(const kind of ['missing-command','changed-command','redacted-output','different-private-owner','extra-tail','extra-client-receipt','extra-project-scope','same-actor-other-stream'])test(`saved ${kind} fails the exact successor proof without repair`,async t=>{
  const f=await fixture(t),saved=await f.save();
  if(kind==='missing-command')f.sqlite.exec('DELETE FROM output_commands');
  else if(kind==='changed-command')f.sqlite.exec("UPDATE output_commands SET request_digest='"+'0'.repeat(64)+"'");
  else if(kind==='redacted-output')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=? WHERE private_event_id=?").run(time,saved.eventId);
  else if(kind==='different-private-owner')f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run(payer,saved.eventId);
  else if(kind==='extra-tail')await appendOther(f,{sequence:saved.revision+1});
  else if(kind==='extra-client-receipt')insert(f,'event_client_receipts',{stream_id:`creative:${f.session.guestSubject}`,client_event_id:'unexpected-output-receipt',event_id:saved.eventId,sequence:saved.revision,created_at:time});
  else if(kind==='extra-project-scope')insert(f,'project_event_scopes',{event_id:saved.eventId,project_access_id:'other-access',organization_id:'other-org',project_id:'other-project',owner_user_id:payer,source_stream_id:`creative:${f.session.guestSubject}`,source_sequence:saved.revision,project_sequence:1,actor_user_id:payer,created_at:time});
  else await appendOther(f,{stream:'creative:another-guest',sequence:1,payload:{project_id:'unrelated-project',document_id:'unrelated-document',block_id:'unrelated-block',type:'subject',scope:'document',properties:{text:'Unrelated source'}}});
  await denyUnchanged(f);
});
test('a minimized native job Memory origin linked only to the new SAVE event refuses reopen',async t=>{
  const f=await fixture(t,{memory:true}),saved=await f.save();insert(f,'memory_document_job_answer_origins',{origin_id:'synthetic-minimized-origin',schema_version:1,recipe_version:'native-document-job-answer-origin-v1',job_id:'other-job',actor_user_id:'another-actor',scope_key:'["","","other-project","other-document"]',turn_id:'other-turn',user_event_id:saved.eventId,user_content_id:'other-user-body',answer_event_id:'other-answer',answer_content_id:'other-answer-body',manifest_content_ref:'other-manifest',status:'minimized',withdrawn_at:time,withdrawal_reason:'erased'});await denyUnchanged(f);
});
test('unrelated campaign preparation remains allowed, but another actor sharing the guest session is forbidden',async t=>{
  const f=await fixture(t);unrelatedReceipt(f);const unrelated={...rows(f,'experience_sponsor_resource_receipts')[0]};const saved=await f.save();assertSaved(f,saved);
  const receipt=rows(f,'experience_sponsor_resource_receipts').find(row=>row.resource_id!==unrelated.resource_id);assert.deepEqual({...rows(f,'experience_sponsor_resource_receipts')[0]},unrelated);
  unrelatedReceipt(f,{resource_id:'same-session-other-actor',actor_user_id:'different-actor',session_digest:receipt.session_digest,intent_key:'same-session-intent'});await denyUnchanged(f);
});
for(const field of ['maximumOperations','maximumOperationsPerWindow'])test(`actual campaign ${field} exhaustion from unrelated actors denies one new SAVE atomically`,async t=>{
  const f=await fixture(t,{policyChange(policy){policy.resources.campaign[field]=1;policy.resources.actor[field]=1;if(field==='maximumOperations'){policy.resources.campaign.maximumOperationsPerWindow=1;policy.resources.actor.maximumOperationsPerWindow=1;policy.startsAtMs-=60000;policy.resources.startsAtMs-=60000;}}});
  unrelatedReceipt(f,field==='maximumOperations'?{recorded_at_ms:f.policy.resources.startsAtMs+1}:{});const before=snapshot(f);await assert.rejects(f.save());assert.deepEqual(snapshot(f),before);assert.equal(await f.read(),null);
});
for(const field of ['maximumTextBytes','maximumTextBytesPerWindow'])test(`actual campaign ${field} exhaustion preserves the unrelated receipt and original source`,async t=>{
  const f=await fixture(t,{policyChange(policy,f){const bytes=contextBytes(f);policy.resources.maximumOperationTextBytes=bytes;if(field==='maximumTextBytes'){policy.startsAtMs-=60000;policy.resources.startsAtMs-=60000;}for(const scope of ['campaign','actor']){policy.resources[scope].maximumTextBytes=field==='maximumTextBytes'?bytes:bytes*2;policy.resources[scope].maximumTextBytesPerWindow=bytes;}}});
  unrelatedReceipt(f,field==='maximumTextBytes'?{recorded_at_ms:f.policy.resources.startsAtMs+1}:{});const before=snapshot(f);await assert.rejects(f.save());assert.deepEqual(snapshot(f),before);
});
for(const difference of [0,-1])test(`UTF-8 authoritative context bytes ${difference?'one byte above':'at'} the exact per-operation cap ${difference?'deny':'save and replay once'}`,async t=>{
  const f=await fixture(t,{subjectText:'A café beside a 橋 🌿',policyChange(policy,f){policy.resources.maximumOperationTextBytes=contextBytes(f)+difference;for(const scope of ['actor','campaign'])policy.resources[scope].maximumOperations=policy.resources[scope].maximumOperationsPerWindow=1;}}),before=snapshot(f);
  if(difference){await assert.rejects(f.save());assert.deepEqual(snapshot(f),before);}else{assertSaved(f,await f.save());assert.equal(rows(f,'experience_sponsor_resource_receipts')[0].text_bytes,contextBytes(f));assertSaved(f,await f.save(),true);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);}
});

for(const alteration of ['GET','HTTP','wrong-origin','cross-site','query','fragment','cookie-empty','cookie-leading-space','pilot','aborted'])test(`internal SAVE and read refuse ${alteration} before touching durable history`,async t=>{
  const f=await fixture(t),before=snapshot(f),controller=new AbortController();let url=`${origin}/unregistered-output`,method='POST',headers={origin};
  if(alteration==='GET')method='GET';if(alteration==='HTTP'){url=url.replace('https:','http:');headers.origin=origin.replace('https:','http:');}
  if(alteration==='wrong-origin')headers.origin='https://other.example.invalid';if(alteration==='cross-site')headers['sec-fetch-site']='cross-site';if(alteration==='query')url+='?x=1';if(alteration==='fragment')url+='#x';
  if(alteration==='cookie-empty')headers.cookie='forma_project_context=';if(alteration==='cookie-leading-space')headers.cookie=' forma_impersonation=; forma_impersonation=stale';if(alteration==='pilot')f.env.FORMA_PILOT_COHORT_ID='configured-pilot';if(alteration==='aborted')controller.abort();
  const req=new Request(url,{method,headers,signal:controller.signal});await assert.rejects(f.save(f.input,req));await assert.rejects(f.read(f.input,req));assert.deepEqual(snapshot(f),before);
});
test('internal structured input is copied before any awaited native authority read',async t=>{
  const f=await fixture(t),input=structuredClone(f.input),done=readHook(f,sql=>sql.includes('experience_sponsor_approvals'),()=>{input.proof.sessionToken='mutated';input.campaignId='mutated';input.draftHash=`sha256:${'0'.repeat(64)}`;});
  assertSaved(f,await f.save(input));done();assertSaved(f,await f.read(),true);
});
for(const mode of ['save','read'])for(const mutation of ['database','header','abort'])test(`${mode} refuses ${mutation} replacement during awaited native approval authority`,async t=>{
  const f=await fixture(t),before=snapshot(f),controller=new AbortController(),req=new Request(f.request,{signal:controller.signal}),done=readHook(f,sql=>sql.includes('experience_sponsor_approvals'),()=>{if(mutation==='database')f.env.DB={...f.DB};else if(mutation==='header')req.headers.set('x-client-authority','changed');else controller.abort();});
  await assert.rejects(f[mode](f.input,req));done();f.env.DB=f.DB;assert.deepEqual(snapshot(f),before);
});
for(const change of ['guest-revocation','payer-consent','source-redaction'])test(`a ${change} inside the native transaction fails the final proof and rolls back SAVE`,async t=>{
  const f=await fixture(t),before=snapshot(f),prepare=f.DB.prepare;let hit=false;
  f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings),execute=bound.execute;bound.execute=function(kind){const result=execute.call(this,kind);if(!hit&&sql.startsWith('INSERT INTO event_write_stage')){hit=true;if(change==='guest-revocation')f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');else if(change==='payer-consent')f.sqlite.exec('UPDATE users SET consent_version=NULL');else redactSource(f);}return result;};return bound;};return statement;};
  await assert.rejects(f.save());f.DB.prepare=prepare;assert.equal(hit,true);assert.deepEqual(snapshot(f),before);
});

function foreignBlockScope(f,id){insert(f,'project_resource_scopes',{project_access_id:'foreign-access',resource_kind:'block',resource_id:id,organization_id:'foreign-org',project_id:'foreign-project',owner_user_id:'foreign-owner',visibility:'collaborative_output',source_event_id:null,actor_user_id:'foreign-actor',created_at:time});}
for(const phase of ['before','saved'])for(const target of ['original-context','new-requirement'])test(`foreign block scope ${target} ${phase} SAVE denies ambiguous custody`,async t=>{
  const f=await fixture(t);if(phase==='saved')await f.save();const id=target==='new-requirement'?await experienceResourceId(f.prepared.plan.draftId,'native-output-requirement'):f.prepared.plan.events.find(event=>event.type==='BlockCreated').payload.block_id;
  foreignBlockScope(f,id);await denyUnchanged(f);
});
test('unrelated foreign block scope preserves empty eligibility and native SAVE reopen',async t=>{
  const f=await fixture(t);foreignBlockScope(f,'unrelated-foreign-block');assert.equal(await f.read(),null);assertSaved(f,await f.save());assertSaved(f,await f.read(),true);
});

const installUnknownSponsorTrigger=f=>f.sqlite.exec('CREATE TRIGGER synthetic_unknown_sponsor_trigger AFTER INSERT ON experience_sponsor_resource_receipts BEGIN SELECT 1; END');
test('an unknown harmless trigger on a known sponsor table denies SAVE with no quota or event write',async t=>{
  const f=await fixture(t);installUnknownSponsorTrigger(f);await denyUnchanged(f);
});
test('a harmless sponsor trigger added after the captured proof invalidates the pending SAVE transaction',async t=>{
  const f=await fixture(t),before=snapshot(f),done=batchHook(f,()=>installUnknownSponsorTrigger(f),{after:false});await assert.rejects(f.save());done();
  const after=snapshot(f);assert.deepEqual(after.contents,before.contents);assert.equal(rows(f,'output_commands').length,0);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,0);
});

for(const acknowledgment of ['normal','lost'])for(const change of ['guest-revocation','payer-consent'])test(`postcommit ${change} refuses ${acknowledgment} acknowledgment disclosure while preserving one saved history`,async t=>{
  const f=await fixture(t);const done=batchHook(f,result=>{if(change==='guest-revocation')f.sqlite.exec('UPDATE experience_guest_sessions SET revoked_at_ms=1');else f.sqlite.exec('UPDATE users SET consent_version=NULL');if(acknowledgment==='lost')throw Error('lost acknowledgment after revocation');return result;});
  await assert.rejects(f.save());done();assert.equal(rows(f,'events').length,f.committed.head+1);assert.equal(rows(f,'output_commands').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);await denyUnchanged(f);
});
test('zero-row native event stage cannot retain a command or quota receipt',async t=>{
  const f=await fixture(t),before=snapshot(f),prepare=f.DB.prepare;let hit=false;f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.call(this,...bindings);if(sql.startsWith('INSERT INTO event_write_stage'))bound.execute=()=>{hit=true;return{results:[],success:true,meta:{changes:0}};};return bound;};return statement;};
  await assert.rejects(f.save());f.DB.prepare=prepare;assert.equal(hit,true);assert.deepEqual(snapshot(f),before);
});
for(const phase of ['first-save','replay','read','lost-ack'])for(const change of ['database','header','abort'])test(`${change} replacement at outer ${phase} final proof settlement denies stale receipt`,async t=>{
  const f=await fixture(t);if(['replay','read'].includes(phase))await f.save();const before=snapshot(f),controller=new AbortController(),req=new Request(f.request,{signal:controller.signal});let proofNumber=0;
  const target=['first-save','lost-ack'].includes(phase)?3:2;const done=readHook(f,sql=>sql.startsWith('SELECT 1 AS current WHERE EXISTS(WITH guest_output_proof_')&&++proofNumber===target,()=>queueMicrotask(()=>queueMicrotask(()=>{if(change==='database')f.env.DB={...f.DB};else if(change==='header')req.headers.set('x-current-request','changed');else controller.abort();})));
  const ack=phase==='lost-ack'?batchHook(f,()=>{throw Error('lost ack');}):null;await assert.rejects(f[phase==='read'?'read':'save'](f.input,req));done();ack?.();f.env.DB=f.DB;
  if(['replay','read'].includes(phase))assert.deepEqual(snapshot(f),before);else{assert.equal(rows(f,'events').length,f.committed.head+1);assert.equal(rows(f,'output_commands').length,1);assert.equal(rows(f,'experience_sponsor_resource_receipts').length,1);unchangedExcept(f,before);}
});

for(const state of ['empty','saved'])test(`${state} internal witness cannot be cloned, forged or reused across request/env/database boundaries`,async t=>{
  const f=await fixture(t);if(state==='saved')await f.save();const before=snapshot(f),req=request(),approved=await readApprovedGuestSponsorCampaign(req,f.env,{campaignId:f.input.campaignId,policyDigest:f.input.policyDigest}),witness=await inspectGuestImageOutput(req,f.env,f.input,approved);
  assert.equal(guestImageOutputData(req,f.env,witness).state,state);await recheckGuestImageOutput(req,f.env,witness);
  for(const forged of [{},structuredClone(witness),{...witness}]){assert.throws(()=>guestImageOutputData(req,f.env,forged));await assert.rejects(recheckGuestImageOutput(req,f.env,forged));}
  assert.throws(()=>guestImageOutputData(request(),f.env,witness));assert.throws(()=>guestImageOutputData(req,{...f.env},witness));f.env.DB={...f.DB};assert.throws(()=>guestImageOutputData(req,f.env,witness));f.env.DB=f.DB;
  assert.deepEqual(snapshot(f),before);
});
test('coherently rehashed out-of-band output corruption still cannot replace the native derived requirement',async t=>{
  const f=await fixture(t),saved=await f.save(),event=nativeEvents(f).at(-1),body=structuredClone(event.payload);body.properties.output_spec.label='Changed synthetic label';body.output_command_envelope.spec.label='Changed synthetic label';
  // Native resource immutability prevents this rewrite. Bypass and restore its exact trigger only to model coherent external database corruption.
  const update=f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='experience_sponsor_resource_receipts' AND sql LIKE '%BEFORE UPDATE%'").get();assert.ok(update);
  assert.throws(()=>f.sqlite.prepare('UPDATE experience_sponsor_resource_receipts SET payload_digest=?').run(`sha256:${'0'.repeat(64)}`));f.sqlite.exec(`DROP TRIGGER "${update.name}"`);
  f.sqlite.prepare('UPDATE experience_sponsor_resource_receipts SET payload_digest=?').run(await digest(body.output_command_envelope));f.sqlite.exec(update.sql);
  f.sqlite.prepare('UPDATE output_commands SET request_digest=?').run(await outputDigest(body.output_command_envelope));f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify(body),saved.eventId);
  await denyUnchanged(f);
});

async function foreignDriverStage(f,command,intentCommand){for(const sql of SPONSOR_DRIVER_SCHEMA)f.sqlite.exec(sql);const hash=`sha256:${'a'.repeat(64)}`,driverCommand=intentCommand??{action:'run-sponsored-image',campaignId:f.policy.campaignId,documentId:'foreign-document',planRevisionId:'foreign-plan',targetId:'foreign-target',intentKey:'foreign-intent'};
  insert(f,'experience_sponsor_driver_intents',{driver_id:'foreign-driver',campaign_id:f.policy.campaignId,actor_user_id:'foreign-actor',session_digest:hash,intent_key:'foreign-intent',document_id:'foreign-document',command_json:typeof driverCommand==='string'?driverCommand:JSON.stringify(driverCommand),command_digest:await digest(driverCommand),source_digest:hash,requirements_digest:hash,source_text_bytes:1,created_at_ms:f.policy.startsAtMs+1});
  let commandDigest='a'.repeat(64);try{commandDigest=await outputDigest(JSON.parse(command));}catch{/* Deliberately malformed retained history has no coherent JSON digest. */}
  insert(f,'experience_sponsor_driver_stages',{driver_id:'foreign-driver',stage:'preflight',command_json:command,command_digest:commandDigest});
}
function unrelatedEnvelope(f){const hash=`sha256:${'a'.repeat(64)}`,template=f.policy.templates[0];return{version:2,campaignId:f.policy.campaignId,policyVersion:f.policy.policyVersion,consumptionId:'foreign-consumption',intentKey:'foreign-intent',actorKind:'canonical-principal',actorUserId:'foreign-actor',sessionDigest:hash,payerUserId:'foreign-payer',ownerUserId:'foreign-owner',projectId:'foreign-project',documentId:'foreign-document',sourceRevision:1,sourceDigest:hash,orderedAssetDigests:[],rightsDigest:hash,compiledInputDigest:hash,transferEnvelopeDigest:hash,templateDigest:hash,recipe:{appId:template.appId,recipeVersion:template.recipeVersion,releaseDigest:template.releaseDigest,outputKind:'image',provider:'openai',model:'gpt-image-2',routeDigest:hash,settingsDigest:hash,outputCount:1,durationMs:0,width:1024,height:1024,calls:{parsing:0,planning:1,render:1,repair:0},maximumTokens:template.maximumTokens,maximumMicrousd:template.maximumMicrousd},issuedAtMs:f.policy.startsAtMs+1,expiresAtMs:f.policy.expiresAtMs};}
async function foreignIssuance(f,field,command){for(const sql of SPONSOR_ISSUER_SCHEMA)f.sqlite.exec(sql);const hash=`sha256:${'a'.repeat(64)}`;
  insert(f,'experience_sponsor_grants',{grant_id:'foreign-grant',campaign_id:f.policy.campaignId,policy_digest:f.compiled.policyDigest,actor_user_id:'foreign-actor',session_digest:hash,intent_key:'foreign-intent',envelope_digest:hash,issued_at_ms:f.policy.startsAtMs+1,expires_at_ms:f.policy.expiresAtMs,enabled:1});
  const driver={action:'run-sponsored-image',campaignId:f.policy.campaignId,documentId:'foreign-document',planRevisionId:'foreign-plan',targetId:'foreign-target',intentKey:'foreign-intent'},envelope=unrelatedEnvelope(f);
  insert(f,'experience_sponsor_issuances',{grant_id:'foreign-grant',campaign_id:f.policy.campaignId,actor_user_id:'foreign-actor',intent_key:'foreign-intent',policy_digest:f.compiled.policyDigest,driver_command_json:JSON.stringify(driver),command_digest:await outputDigest(driver),envelope_digest:await digest(envelope),envelope_json:JSON.stringify(envelope),[field]:command});
}
test('the exact existing native sponsor actor-history index remains compatible with first SAVE and reopen',async t=>{
  const f=await fixture(t);for(const definition of SPONSOR_NATIVE_IMAGE_READ_INDEXES)f.sqlite.exec(definition.sql);const before=snapshot(f);assert.equal(await f.read(),null);assertSaved(f,await f.save());assertSaved(f,await f.read(),true);unchangedExcept(f,before);
});
for(const phase of ['before','saved'])for(const kind of ['oversize-driver-stage','invalid-driver-stage','oversize-issuer-driver','oversize-issuer-envelope'])test(`${kind} ${phase} SAVE cannot prove exclusive custody with unclassifiable sponsor history`,async t=>{
  const f=await fixture(t);if(phase==='saved')await f.save();const command=kind==='invalid-driver-stage'?'{invalid':JSON.stringify({documentId:f.session.documentId,padding:'é'.repeat(32768)});if(kind!=='invalid-driver-stage')assert.ok(Buffer.byteLength(command)>65536);
  if(kind.endsWith('driver-stage'))await foreignDriverStage(f,command);else await foreignIssuance(f,kind.endsWith('issuer-driver')?'driver_command_json':'envelope_json',command);await denyUnchanged(f);
});
test('bounded valid sponsor JSON for an unrelated foreign driver remains compatible with native SAVE',async t=>{
  const f=await fixture(t);await foreignDriverStage(f,JSON.stringify({action:'preflight',documentId:'foreign-document'}));const before=snapshot(f);assertSaved(f,await f.save());assertSaved(f,await f.read(),true);unchangedExcept(f,before);
});

for(const phase of ['before','saved'])for(const scenario of ['stage-missing','stage-wrong-type','stage-duplicate','issuer-driver-duplicate','envelope-document-duplicate','envelope-project-missing','envelope-owner-wrong-type'])test(`${scenario} ${phase} SAVE refuses ambiguous sponsor identity selectors`,async t=>{
  const f=await fixture(t);if(phase==='saved')await f.save();let encoded,field='driver_command_json';
  if(scenario==='stage-missing')encoded='{"action":"preflight"}';
  else if(scenario==='stage-wrong-type')encoded='{"documentId":42}';
  else if(scenario==='stage-duplicate'||scenario==='issuer-driver-duplicate')encoded=`{"documentId":"foreign-document","documentId":${JSON.stringify(f.session.documentId)}}`;
  else{field='envelope_json';const value=unrelatedEnvelope(f);
    if(scenario==='envelope-document-duplicate')encoded=JSON.stringify(value).replace('"documentId":"foreign-document"',`"documentId":"foreign-document","documentId":${JSON.stringify(f.session.documentId)}`);
    else{if(scenario==='envelope-project-missing')delete value.projectId;else value.ownerUserId=42;encoded=JSON.stringify(value);}}
  if(scenario.startsWith('stage-'))await foreignDriverStage(f,encoded);else await foreignIssuance(f,field,encoded);await denyUnchanged(f);
});
test('bounded synthetic unrelated native-schema issuer history with all required text selectors remains compatible with SAVE and reopen',async t=>{
  const f=await fixture(t);await foreignIssuance(f,'envelope_json',JSON.stringify(unrelatedEnvelope(f)));const before=snapshot(f);assertSaved(f,await f.save());assertSaved(f,await f.read(),true);unchangedExcept(f,before);
});

for(const phase of ['before','saved'])for(const scenario of ['guest-document','missing-selector','malformed'])test(`retained driver intent ${scenario} ${phase} SAVE cannot prove exclusive guest custody`,async t=>{
  const f=await fixture(t);if(phase==='saved')await f.save();const command=scenario==='malformed'?'{invalid':scenario==='missing-selector'?{action:'run-sponsored-image'}:{action:'run-sponsored-image',campaignId:f.policy.campaignId,documentId:f.session.documentId,planRevisionId:'foreign-plan',targetId:'foreign-target',intentKey:'foreign-intent'};
  await foreignDriverStage(f,JSON.stringify({action:'preflight',documentId:'foreign-document'}),command);await denyUnchanged(f);
});
test('native issuer and driver history plus actor index fit strict D1 limits with complete Memory',async t=>{
  const f=await fixture(t,{memory:true});await foreignDriverStage(f,JSON.stringify({action:'preflight',documentId:'foreign-document'}));await foreignIssuance(f,'envelope_json',JSON.stringify(unrelatedEnvelope(f)));for(const definition of SPONSOR_NATIVE_IMAGE_READ_INDEXES)f.sqlite.exec(definition.sql);
  const before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{assert.equal(await f.read(),null);assertSaved(f,await f.save());assertSaved(f,await f.read(),true);limits.assertVerified();t.diagnostic(JSON.stringify({installedSponsorHistory:true,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));}finally{limits.restore();}unchangedExcept(f,before);
});

for(const phase of ['before','saved'])for(const identity of ['actorUserId','payerUserId','sessionDigest'])test(`issuer envelope guest-only ${identity} ${phase} SAVE cannot be classified as unrelated`,async t=>{
  const f=await fixture(t);if(phase==='saved')await f.save();const envelope=unrelatedEnvelope(f);
  if(identity==='sessionDigest'){const approved=await readApprovedGuestSponsorCampaign(f.request,f.env,{campaignId:f.input.campaignId,policyDigest:f.input.policyDigest}),witness=await inspectGuestImageOutput(f.request,f.env,f.input,approved);envelope.sessionDigest=guestImageOutputData(f.request,f.env,witness).resourceInput.sessionDigest;}else envelope[identity]=f.session.guestSubject;
  await foreignIssuance(f,'envelope_json',JSON.stringify(envelope));await denyUnchanged(f);
});

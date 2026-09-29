import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{ensureSchema,streamHead,appendAuditEvent},{POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,GUEST_DB_NOW,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA},{approveGuestSponsorCampaign},
  {compileGuestSponsorApprovalProposal},{saveGuestImageRequirement,readGuestImageRequirement},
  {registeredExperience,initialValues},{canonicalJson,digest},{preflightOutputImageSlidesTarget},{sponsorImageTransport},{serializeEvent},
  {GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{handleEvents},{handleOutputRequirements}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/policy-version.ts'),import('../worker/experience-guest-session.ts'),
  import('../worker/experience-guest-source.ts'),import('../worker/experience-guest-context-inventory.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-approval.ts'),import('../worker/experience-guest-sponsor-contract.ts'),import('../worker/experience-guest-image-output.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),
  import('../worker/event-read-primitives.ts'),import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),import('../worker/events-api.ts'),
  import('../worker/output-requirements-api.ts')]);
const origin='https://guest.example.invalid',subject='A blue heron on a stone bridge',payer='synthetic-image-payer',owner='synthetic-image-owner',other='synthetic-other-owner',time='2020-01-01T00:00:00.000Z';
const canonicalHeaders=(actor=owner,extra={})=>({origin,...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...extra});
const canonicalRequest=(actor=owner,extra={})=>new Request(`${origin}/unregistered-image-claim`,{method:'POST',headers:canonicalHeaders(actor,extra)});
const request=()=>new Request(`${origin}/unregistered-guest-image-output`,{method:'POST',headers:{origin}});
const proofFor=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();
const snapshot=f=>{const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();return {schema,contents:Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,rows(f,row.name)]))};};
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
const nativeEvents=f=>f.sqlite.prepare('SELECT event.*,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE stream_id=? ORDER BY sequence').all(`creative:${f.session.guestSubject}`).map(serializeEvent);
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
async function fixture(t,{memory=false,approved=true,draftLifetimeMs=2000,policyChange,subjectText=subject,saved=true,targetHistory=true}={}){
  const f=outputTestDatabase();
  // This frozen helper labels WITH statements as reads. Execute the native resource CTE insertion as a write so its acknowledgment reports real SQLite changes.
  const nativeBatch=f.DB.batch;f.DB.batch=statements=>nativeBatch.call(f.DB,statements.map(statement=>{if(/WITH[\s\S]*INSERT INTO experience_sponsor_resource_receipts/u.test(statement.sql)){const execute=statement.execute;statement.execute=function(kind){return execute.call(this,kind==='all'?'run':kind);};}return statement;}));
  t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA,...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA])f.sqlite.exec(sql);
  if(memory)installMemory(f);for(const actor of [payer,owner,other])insert(f,'users',{user_id:actor,email:`${actor}@example.invalid`,display_name:actor,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
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


// New claimed-retirement contract: genuine first-SAVE claim setup, never a seeded mapping.
async function claimedFixture(t,{claim=true,...options}={}){
  const f=await fixture(t,options);
  const {GUEST_IMAGE_SAVE_CLAIM_SCHEMA,inspectGuestImageSaveInventory}=await import('../worker/experience-guest-image-claim-inventory.ts');
  const {claimGuestImageSave,readGuestImageClaim}=await import('../worker/experience-guest-image-claim.ts');
  const {retireExpiredClaimedGuestImageOutput}=await import('../worker/experience-guest-claimed-image-output-retirement.ts');
  const {retireExpiredGuestImageSource}=await import('../worker/experience-guest-source-retirement.ts');
  for(const sql of GUEST_IMAGE_SAVE_CLAIM_SCHEMA)f.sqlite.exec(sql);
  if(claim){
    const inventory=await inspectGuestImageSaveInventory(request(),f.env,{proof:f.proof});
    f.claimInput={sessionId:f.session.sessionId,requestId:'native-retirement-claim',approvedManifestDigest:inventory.manifestDigest,proof:f.proof};
    f.claimed=await claimGuestImageSave(canonicalRequest(),f.env,f.claimInput);
    const adopted=rows(f,'experience_guest_context_adoptions').find(row=>row.session_id===f.session.sessionId),lineage=JSON.parse(adopted.lineage_json);
    assert.equal(lineage.events.length,f.committed.head);assert.equal(lineage.targetHead,f.targetHead+f.committed.head);
    f.mapping=rows(f,'experience_guest_image_claims').find(row=>row.session_id===f.session.sessionId);assert.ok(f.mapping);
    f.canonicalEvents=f.sqlite.prepare('SELECT * FROM events WHERE stream_id=? AND sequence>? ORDER BY sequence').all(`creative:${owner}`,f.targetHead);
    assert.equal(f.canonicalEvents.length,f.committed.head+1);assert.equal(f.canonicalEvents.at(-1).sequence,f.targetHead+f.committed.head+1);
    f.canonicalSaveId=f.canonicalEvents.at(-1).event_id;
    const originals=new Set([...f.committed.eventIds,f.saved.eventId]);for(const event of f.canonicalEvents)assert.equal(originals.has(event.event_id),false);
    const body=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(f.canonicalSaveId);assert.equal(body.owner_id,owner);assert.equal(body.document_id,f.session.documentId);assert.notEqual(body.private_json,'');
    const retained=rows(f,'private_content').find(row=>row.owner_id===owner&&row.kind==='experience-draft');assert.ok(retained);assert.notEqual(retained.content_id,f.prepared.plan.draftId);assert.equal(retained.content,canonicalJson(f.prepared.plan));assert.ok(retained.expires_at>f.prepared.expiresAt);
  }
  f.retire=(input={sessionId:f.session.sessionId},env=f.env)=>retireExpiredClaimedGuestImageOutput(env,input);
  f.recover=()=>readGuestImageClaim(canonicalRequest(),f.env,{sessionId:f.session.sessionId});
  f.replayClaim=()=>claimGuestImageSave(canonicalRequest(),f.env,{sessionId:f.session.sessionId,requestId:f.claimInput.requestId,approvedManifestDigest:f.claimInput.approvedManifestDigest});
  f.retireSource=()=>retireExpiredGuestImageSource(f.env,{sessionId:f.session.sessionId});return f;
}
const canonicalTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&new Date(value).toISOString()===value;
const tail=f=>f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(f.saved.eventId);
const mutationBatch=statements=>statements.some(statement=>/^\s*UPDATE event_private_payloads\b/u.test(statement.sql));
async function expire(f,{session=false}={}){const start=performance.now();while(!f.sqlite.prepare(session?`SELECT expires_at_ms<=${GUEST_DB_NOW} AS due FROM experience_guest_sessions WHERE session_id=?`:"SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).due){assert.ok(performance.now()-start<5000,'real native database expiry');await delay(10);}}
function assertRetired(f,result,replayed=false){assert.deepEqual(Object.keys(result).sort(),['status','scope','sessionId','documentId','requirementId','eventId','redactedAt','replayed'].sort());
  assert.deepEqual(result,{status:'retired',scope:'claimed-first-save-original-guest-body',sessionId:f.session.sessionId,documentId:f.session.documentId,requirementId:f.saved.requirementId,eventId:f.saved.eventId,redactedAt:tail(f).redacted_at,replayed});
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
function canonicalCopies(f){const ids=new Set(f.canonicalEvents.map(row=>row.event_id));return {
  events:rows(f,'events').filter(row=>row.stream_id===`creative:${owner}`),bodies:rows(f,'event_private_payloads').filter(row=>ids.has(row.private_event_id)),
  commands:rows(f,'output_commands').filter(row=>row.actor_user_id===owner),receipts:rows(f,'event_client_receipts').filter(row=>row.stream_id===`creative:${owner}`),
  drafts:rows(f,'private_content').filter(row=>row.owner_id===owner),adoption:rows(f,'experience_guest_context_adoptions'),claims:rows(f,'experience_guest_image_claims'),plans:rows(f,'experience_guest_plan_custodies'),
};}


for(const memory of [false,true])for(const order of ['source-first','tail-first'])test(`${order} claimed original-body cleanup preserves real canonical copies with ${memory?'complete':'absent'} Memory under strict D1 limits`,async t=>{
  const f=await claimedFixture(t,{memory}),canonicalBefore=canonicalCopies(f);await expire(f);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE owner_id=? AND kind='experience-draft' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").get(owner).n,1,'canonical retained plan has its own later deadline');const limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{if(order==='source-first'){await f.retireSource();sourceErased(f);assert.notEqual(tail(f).private_json,'');}
    const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);const first=tail(f).redacted_at;
    if(order==='tail-first'){assert.ok(originalBodies(f).every(row=>row.private_json!==''));await f.retireSource();sourceErased(f);}
    const retired=snapshot(f),count=changes(f);assertRetired(f,await f.retire(),true);assert.equal(tail(f).redacted_at,first);assert.deepEqual(snapshot(f),retired);assert.equal(changes(f),count,'exact replay performs no mutation');assert.deepEqual(canonicalCopies(f),canonicalBefore,'both original cleanups preserve every canonical copy and custody receipt');
    const receipt=await f.recover();assert.deepEqual({...receipt,replayed:false},{...f.claimed.receipt,replayed:false});const recovered=await f.replayClaim();assert.deepEqual({...recovered.receipt,replayed:false},{...f.claimed.receipt,replayed:false});assert.equal(recovered.planRetention,'retained');assert.deepEqual(recovered.retained.plan,f.prepared.plan);assert.deepEqual(snapshot(f),retired);assert.equal(changes(f),count,'canonical read and proofless completed-claim recovery stay read-only after original erasure');
    limits.assertVerified();t.diagnostic(JSON.stringify({memory,order,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }catch(error){t.diagnostic(JSON.stringify({strictFailures:limits.failures.map(row=>({kind:row.kind,error:row.error,count:row.count,limit:row.limit,statementBytes:row.statementBytes,parameterCount:row.parameterCount})),lastQualifiedSql:limits.records.at(-1)?.sql,qualifiedQueries:limits.records.length,maxBindings:Math.max(0,...limits.boundCounts),maxSqlBytes:Math.max(0,...limits.records.map(row=>row.statementBytes))}));throw error;}finally{limits.restore();}
});

async function canonicalEdit(f,type,payload){const head=await streamHead(f.env,`creative:${owner}`),response=await handleEvents(new Request(`${origin}/api/events`,{
  method:'POST',headers:canonicalHeaders(owner,{'content-type':'application/json'}),body:JSON.stringify({action:'batch',expectedSequence:head,events:[{type,payload:{project_id:f.session.projectId,document_id:f.session.documentId,...payload}}]})}),f.env);
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.rejected,[]);assert.equal(body.appended.length,1);return body.appended[0];
}

async function outputCall(f,{method='GET',body}={}){const base='/api/output-requirements',path=method==='GET'?`${base}?documentId=${encodeURIComponent(f.session.documentId)}`:base;
  const response=await handleOutputRequirements(new Request(`${origin}${path}`,{method,headers:canonicalHeaders(owner,body?{'content-type':'application/json'}:{}),...(body?{body:JSON.stringify(body)}:{})}),f.env,base,{waitUntil(){assert.fail('unexpected background/provider work');}});
  const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
}
function nonemptyFinancialHistory(f){for(const actor of [payer,owner]){
  insert(f,'budget_reservations',{reservation_id:`held-tokens-${actor}`,owner_id:actor,stream_id:`creative:${actor}`,correlation_id:`foreign-job-${actor}`,operation:'image',period:'2026-09',reserved_tokens:100,used_tokens:3,status:'active',created_at:time,updated_at:time});
  insert(f,'cost_budget_reservations',{reservation_id:`held-cost-${actor}`,owner_id:actor,workspace_id:'forma',stream_id:`creative:${actor}`,correlation_id:`foreign-job-${actor}`,operation:'image',period:'2026-09',reserved_microusd:1234,used_microusd:4,status:'executing',created_at:time,updated_at:time});
}}

test('a completed claim and target tombstone cannot advance the original DB-clock retention deadline',async t=>{
  const f=await claimedFixture(t,{draftLifetimeMs:60000});f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(time,f.canonicalSaveId);
  t.mock.method(Date,'now',()=>8_000_000_000_000);const before=snapshot(f);await assert.rejects(f.retire(),/claimed_image_output_retirement_not_due/u);assert.deepEqual(snapshot(f),before);
});
const canonicalChanges={
  'context edit':async f=>{const block=f.prepared.plan.events.find(event=>event.type==='BlockCreated'&&event.payload.properties?.text===subject);assert.ok(block);await canonicalEdit(f,'BlockPropertyEdited',{block_id:block.payload.block_id,property_path:'text',old_value:subject,new_value:'A heron beside a quiet lake'});},
  'native requirement edit':async f=>{const current=await outputCall(f),spec=structuredClone(nativeEvents(f).at(-1).payload.properties.output_spec);spec.label='Edited canonical Image';
    const edited=await outputCall(f,{method:'POST',body:{action:'save',documentId:f.session.documentId,blockId:f.saved.requirementId,spec,clientMutationId:'canonical-image-edit',expectedRevision:current.revision}});assert.equal(edited.replayed,false);const after=await outputCall(f);assert.equal(after.requirements.find(row=>row.blockId===f.saved.requirementId).spec.label,spec.label);assert.notEqual(after.revision,current.revision);},
  'redacted canonical body':f=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(time,f.canonicalSaveId),
  'redacted canonical context prefix':f=>{for(const event of f.canonicalEvents.slice(0,-1))f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(time,event.event_id);},
  DocumentRemoved:f=>canonicalEdit(f,'DocumentRemoved',{}),
  ProjectRemoved:f=>appendAuditEvent(f.env,`creative:${owner}`,'user','ProjectRemoved',{project_id:f.session.projectId}),
};
for(const [name,mutate]of Object.entries(canonicalChanges))test(`canonical ${name} does not postpone cleanup of the separate expired original SAVE body`,async t=>{
  const f=await claimedFixture(t);await mutate(f);if(!name.includes('edit')){const changed=snapshot(f),count=changes(f);await assert.rejects(f.recover());assert.deepEqual(snapshot(f),changed);assert.equal(changes(f),count);}await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);
});
test('already erased original context and canonical tail tombstone still permit proven original SAVE retirement',async t=>{
  const f=await claimedFixture(t);await expire(f);await f.retireSource();sourceErased(f);f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(time,f.canonicalSaveId);
  const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);
});
test('physical loss of canonical association metadata refuses historical cleanup without changing any remaining body',async t=>{
  const f=await claimedFixture(t);f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.canonicalSaveId);await expire(f);await deniedUnchanged(f);
});
test('completed custody cleanup requires no live guest, destination, payer or sponsor authorization',async t=>{
  const f=await claimedFixture(t);f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1');f.sqlite.exec('UPDATE experience_guest_source_policies SET revoked_at_ms=1');f.sqlite.exec('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1');
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}',policy_digest='replaced'");f.sqlite.exec("UPDATE experience_sponsor_resource_policies SET enabled=0,limits_json='{}',limits_digest='replaced'");f.sqlite.exec('DELETE FROM users');f.env.FORMA_PILOT_COHORT_ID='later-configured-pilot';
  await expire(f);t.mock.method(Date,'now',()=>0);const before=snapshot(f),prepare=f.DB.prepare;f.DB.prepare=function(sql){assert.doesNotMatch(sql,/\b(?:FROM|JOIN)\s+users\b/iu,'original-body retirement does not consult live principal profiles');return prepare.call(this,sql);};
  try{assertRetired(f,await f.retire());onlyTailChanged(f,before);}finally{f.DB.prepare=prepare;}
});
test('an actual unclaimed SAVE cannot masquerade as completed first-SAVE custody',async t=>{const f=await claimedFixture(t,{claim:false});await expire(f);await deniedUnchanged(f);});
test('a prior original-body tombstone with canonical timestamp replays without refreshing its time or writing canonical history',async t=>{
  const f=await claimedFixture(t);await expire(f);f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(time,f.saved.eventId);const before=snapshot(f),count=changes(f);assertRetired(f,await f.retire(),true);assert.deepEqual(snapshot(f),before);assert.equal(changes(f),count);assert.equal(tail(f).redacted_at,time);
});
test('nonempty payer and destination financial history and unrelated media are unchanged by original-body cleanup',async t=>{
  const f=await claimedFixture(t);nonemptyFinancialHistory(f);f.media.set('retained-canonical-media',{bytes:new Uint8Array([1,2,3]),metadata:{scope:owner},contentType:'image/png'});
  const media=structuredClone([...f.media]);await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);assert.deepEqual([...f.media],media);
});
for(const kind of ['lost','truncated','false','sparse'])test(`${kind} claimed-retirement acknowledgment recovers the exact original tombstone with one mutation attempt`,async t=>{
  const f=await claimedFixture(t);await expire(f);const before=snapshot(f),done=batchHook(f,result=>{if(kind==='lost')throw Error('lost original-body acknowledgment');if(kind==='truncated')return result.slice(0,-1);if(kind==='sparse'){const copy=[...result];delete copy[0];return copy;}return result.map((row,index)=>index?row:{...row,success:false});});
  assertRetired(f,await f.retire(),true);done();onlyTailChanged(f,before);const first=tail(f).redacted_at;assertRetired(f,await f.retire(),true);assert.equal(tail(f).redacted_at,first);
});
for(const name of ['command','Memory','project'])test(`late original ${name} association inside retirement rolls back the guest tombstone and leaves canonical copies intact`,async t=>{
  const f=await claimedFixture(t,{memory:name==='Memory'});await expire(f);const before=snapshot(f),done=statementHook(f,sql=>/^\s*UPDATE event_private_payloads\b/u.test(sql),()=>{if(name==='command')f.sqlite.prepare('UPDATE output_commands SET created_at=? WHERE actor_user_id=?').run(time,f.session.guestSubject);else if(name==='Memory')memoryOrigin(f);else projectScope(f);});
  await assert.rejects(f.retire());done();assert.deepEqual(snapshot(f),before);
});
test('a synthetic late immutable claim-lineage change rolls back original redaction with exact trigger definitions restored',async t=>{
  const f=await claimedFixture(t),lineage=JSON.parse(f.mapping.lineage_json);lineage.target.contextHead++;lineage.target.sequence++;const serialized=canonicalJson(lineage),hash=await digest(lineage);await expire(f);
  const before=snapshot(f),done=statementHook(f,sql=>/^\s*UPDATE event_private_payloads\b/u.test(sql),()=>nativeCorrupt(f,'experience_guest_image_claims','UPDATE experience_guest_image_claims SET lineage_json=?,lineage_digest=? WHERE session_id=?',serialized,hash,f.session.sessionId));
  await assert.rejects(f.retire());done();assert.deepEqual(snapshot(f),before);
});
for(const stage of ['during-read','after-commit','final-read'])test(`database replacement ${stage} prevents a stale claimed-retirement result`,async t=>{
  const f=await claimedFixture(t);await expire(f);const before=snapshot(f),done=stage==='after-commit'?batchHook(f,result=>{f.env.DB={...f.DB};return result;}):readHook(f,sql=>stage==='during-read'?sql.includes('FROM experience_guest_sources'):sql.startsWith('SELECT body.redacted_at FROM event_private_payloads'),()=>{f.env.DB={...f.DB};});
  await assert.rejects(f.retire(),/database_changed/u);done();f.env.DB=f.DB;if(stage==='during-read')assert.deepEqual(snapshot(f),before);else{assert.equal(tail(f).private_json,'');onlyTailChanged(f,before);}
});
test('claimed-retirement session identity is captured before awaited source reads',async t=>{
  const f=await claimedFixture(t);await expire(f);const input={sessionId:f.session.sessionId},before=snapshot(f),done=readHook(f,sql=>sql.includes('FROM experience_guest_sources'),()=>{input.sessionId='mutated-session';});assertRetired(f,await f.retire(input));done();onlyTailChanged(f,before);
});
test('rewritten original native actor is unavailable even though a real immutable custody mapping exists',async t=>{
  const f=await claimedFixture(t);nativeCorrupt(f,'events','UPDATE events SET actor=? WHERE event_id=?',owner,f.saved.eventId);await expire(f);await deniedUnchanged(f);
});
for(const association of ['prefix digest','prefix boundary','original command'])test(`coherently rehashed synthetic ${association} contradiction cannot substitute for exact completed claim lineage`,async t=>{
  const f=await claimedFixture(t),lineage=JSON.parse(f.mapping.lineage_json);
  if(association==='prefix digest')lineage.contextLineageDigest=`sha256:${'0'.repeat(64)}`;
  else if(association==='prefix boundary'){lineage.target.contextHead++;lineage.target.sequence++;}
  else lineage.source.command.created_at=time;
  nativeCorrupt(f,'experience_guest_image_claims','UPDATE experience_guest_image_claims SET lineage_json=?,lineage_digest=?,context_lineage_digest=? WHERE session_id=?',canonicalJson(lineage),await digest(lineage),lineage.contextLineageDigest,f.session.sessionId);
  await expire(f);await deniedUnchanged(f);
});
test('a synthetic additional original-stream event cannot be treated as the accepted N+1 claimed stage',async t=>{
  const f=await claimedFixture(t);await appendAuditEvent(f.env,`creative:${f.session.guestSubject}`,'user','BlockCreated',{project_id:f.session.projectId,document_id:f.session.documentId,block_id:'synthetic-later-stage',type:'subject',scope:'document',properties:{text:'Later original history'}});
  await expire(f);await deniedUnchanged(f);
});
test('retirement rejects caller-selected owner and target authority instead of extending its closed input',async t=>{
  const f=await claimedFixture(t),before=snapshot(f);for(const input of [{sessionId:f.session.sessionId,ownerUserId:owner},{sessionId:f.session.sessionId,eventId:f.canonicalSaveId},{sessionId:f.session.sessionId,nowMs:8_000_000_000_000},{sessionId:'missing-session'},{}])await assert.rejects(f.retire(input));assert.deepEqual(snapshot(f),before);
});

test('a genuine destination-owned second-Document plan in the same Project does not extend the original guest retention deadline',async t=>{
  const f=await claimedFixture(t),documentId='canonical-second-document',head=await streamHead(f.env,`creative:${owner}`),project_id=f.session.projectId;
  const events=[{type:'DocumentCreated',payload:{project_id,document_id:documentId,title:'Later work'}},{type:'EmptyCanvasChosen',payload:{project_id,document_id:documentId}},
    {type:'BlockCreated',payload:{project_id,document_id:documentId,block_id:'canonical-second-subject',type:'subject',scope:'document',position:'a0',handle:'subject/second',properties:{text:'A quiet orchard beside a lake',authority:'authored',weight:1}}}];
  const response=await handleEvents(new Request(`${origin}/api/events`,{method:'POST',headers:canonicalHeaders(owner,{'content-type':'application/json'}),body:JSON.stringify({action:'batch',expectedSequence:head,events})}),f.env),body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.rejected,[]);assert.equal(body.appended.length,3);
  const sibling={...f,session:{...f.session,documentId}}, {createExperienceOutputRecipe}=await import('../worker/experience-output-recipe.ts');
  const spec=createExperienceOutputRecipe({output:'image',requirementId:'canonical-second-output',deliverableId:'canonical-second-deliverable',variantId:'canonical-second-variant',aspectRatio:{width:1,height:1}}).spec;
  const initial=await outputCall(sibling);await outputCall(sibling,{method:'POST',body:{action:'save',documentId,blockId:spec.id,spec,clientMutationId:'save-second-output',expectedRevision:initial.revision}});
  const saved=await outputCall(sibling);await outputCall(sibling,{method:'POST',body:{action:'confirm',documentId,clientMutationId:'confirm-second-output',expectedRevision:saved.revision}});
  const plan=rows(f,'output_plan_revisions').find(row=>row.document_id===documentId);assert.ok(plan);assert.equal(plan.owner_user_id,owner);assert.equal(plan.project_id,project_id);assert.equal(plan.scope_key,`personal:${owner}:${project_id}`);
  await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);
});
function mappedCanonicalProject(f){const mapping={project_access_id:'synthetic-canonical-access',project_id:f.session.projectId,organization_id:'synthetic-canonical-org',owner_user_id:owner,status:'active',created_at:time,updated_at:time};insert(f,'organization_projects',mapping);return mapping;}
for(const reference of ['canonical','original guest'])test(`synthetic native-schema mapped resource with ${reference} event reference has explicit original-retention treatment`,async t=>{
  const f=await claimedFixture(t),parent=mappedCanonicalProject(f);insert(f,'project_resource_scopes',{project_access_id:parent.project_access_id,organization_id:parent.organization_id,project_id:parent.project_id,owner_user_id:owner,resource_kind:'document',resource_id:f.session.documentId,visibility:'collaborative_output',source_event_id:reference==='canonical'?f.canonicalSaveId:f.saved.eventId,actor_user_id:owner,created_at:time});
  await expire(f);if(reference==='original guest')await deniedUnchanged(f);else{const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);}
});
for(const family of ['review','package'])test(`synthetic native-schema ${family} on a canonical mapped Project still refuses a direct original guest participant`,async t=>{
  const f=await claimedFixture(t),parent=mappedCanonicalProject(f),common={project_access_id:parent.project_access_id,organization_id:parent.organization_id,project_id:parent.project_id,document_id:f.session.documentId,created_at:time};
  if(family==='review')insert(f,'project_review_tasks',{...common,task_id:'synthetic-review',artifact_id:'synthetic-artifact',request_event_id:f.canonicalSaveId,requested_by_user_id:owner,assigned_user_id:f.session.guestSubject,artifact_revision:1,content_sha256:'a'.repeat(64),status:'pending'});
  else insert(f,'project_context_package_bindings',{...common,binding_id:'synthetic-binding',package_id:'synthetic-package',version_id:'synthetic-version',update_mode:'pinned',status:'active',created_by_user_id:f.session.guestSubject,updated_at:time});
  await expire(f);await deniedUnchanged(f);
});

async function governedFixture(t){
  const f=await claimedFixture(t),{handleWorkspaces}=await import('../worker/workspaces-api.ts');
  const workspace=(path,body)=>handleWorkspaces(new Request(`${origin}/api/workspaces/${path.join('/')}`,{method:'POST',headers:canonicalHeaders(owner,body?{'content-type':'application/json'}:{}),...(body?{body:JSON.stringify(body)}:{})}),f.env,path);
  const created=await workspace([],{name:'Claimed canonical workspace'}),createdBody=await created.json();assert.equal(created.status,201,JSON.stringify(createdBody));const {organizationId}=createdBody;
  const attached=await workspace([organizationId,'projects'],{projectId:f.session.projectId}),attachedBody=await attached.json();assert.equal(attached.status,201,JSON.stringify(attachedBody));const {projectAccessId}=attachedBody;
  const opened=await workspace([organizationId,'projects',projectAccessId,'context']);assert.equal(opened.status,200,await opened.clone().text());const cookie=opened.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const refreshed=await handleEvents(new Request(`${origin}/api/events`,{headers:canonicalHeaders(owner,{cookie})}),f.env);assert.equal(refreshed.status,200,await refreshed.clone().text());
  const output=async body=>{const base='/api/output-requirements',path=body?base:`${base}?documentId=${encodeURIComponent(f.session.documentId)}`,response=await handleOutputRequirements(new Request(`${origin}${path}`,{method:body?'POST':'GET',headers:canonicalHeaders(owner,{cookie,...(body?{'content-type':'application/json'}:{})}),...(body?{body:JSON.stringify(body)}:{})}),f.env,base,{waitUntil(){assert.fail('unexpected background/provider work');}}),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
  const initial=await output(),spec=structuredClone(initial.requirements.find(row=>row.blockId===f.saved.requirementId).spec);spec.label='Governed canonical Image';
  await output({action:'save',documentId:f.session.documentId,blockId:f.saved.requirementId,spec,clientMutationId:'governed-canonical-save',expectedRevision:initial.revision});const saved=await output();assert.equal(saved.requirements.find(row=>row.blockId===f.saved.requirementId).spec.label,spec.label);
  await output({action:'confirm',documentId:f.session.documentId,clientMutationId:'governed-canonical-confirm',expectedRevision:saved.revision});
  const plan=rows(f,'output_plan_revisions').find(row=>row.scope_key===`project:${organizationId}:${projectAccessId}`);assert.ok(plan);assert.equal(plan.owner_user_id,owner);assert.equal(plan.document_id,f.session.documentId);assert.equal(plan.project_id,f.session.projectId);assert.equal(plan.scope_kind,'project');assert.equal(plan.organization_id,organizationId);assert.equal(plan.project_access_id,projectAccessId);assert.equal([...f.committed.eventIds,f.saved.eventId].includes(plan.confirmed_event_id),false);
  return Object.assign(f,{governedPlan:plan,organizationId,projectAccessId});
}
test('actual destination-owned governed Project SAVE and confirm do not postpone original guest expiry cleanup',async t=>{
  const f=await governedFixture(t);await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyTailChanged(f,before);
});
for(const field of ['owner_user_id','project_access_id','confirmed_event_id'])test(`synthetic governed-plan ${field} contradiction does not inherit the canonical scope exception`,async t=>{
  const f=await governedFixture(t),value=field==='owner_user_id'?other:field==='project_access_id'?'foreign-project-access':f.saved.eventId;
  f.sqlite.prepare(`UPDATE output_plan_revisions SET ${field}=? WHERE scope_key=? AND plan_revision_id=?`).run(value,f.governedPlan.scope_key,f.governedPlan.plan_revision_id);await expire(f);await deniedUnchanged(f);
});

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
  {compileGuestSponsorApprovalProposal},{saveGuestImageRequirement},
  {registeredExperience,initialValues},{canonicalJson,digest},{preflightOutputImageSlidesTarget},{sponsorImageTransport},
  {GUEST_CONTEXT_ADOPTION_SCHEMA},{GUEST_PLAN_CUSTODY_SCHEMA},{handleEvents},{handleOutputRequirements}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/policy-version.ts'),import('../worker/experience-guest-session.ts'),
  import('../worker/experience-guest-source.ts'),import('../worker/experience-guest-context-inventory.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-guest-sponsor-approval.ts'),import('../worker/experience-guest-sponsor-contract.ts'),import('../worker/experience-guest-image-output.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),
  import('../worker/experience-guest-context-adoption.ts'),import('../worker/experience-guest-plan-custody.ts'),import('../worker/events-api.ts'),
  import('../worker/output-requirements-api.ts')]);
const origin='https://guest.example.invalid',subject='A blue heron on a stone bridge',payer='synthetic-image-payer',owner='synthetic-image-owner',other='synthetic-other-owner',time='2020-01-01T00:00:00.000Z';
const canonicalHeaders=(actor=owner,extra={})=>({origin,...(actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':`${actor}@example.invalid`}:{}),...extra});
const canonicalRequest=(actor=owner,extra={})=>new Request(`${origin}/unregistered-image-claim`,{method:'POST',headers:canonicalHeaders(actor,extra)});
const request=()=>new Request(`${origin}/unregistered-guest-image-output`,{method:'POST',headers:{origin}});
const proofFor=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();
const snapshot=f=>{const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();return {schema,contents:Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,rows(f,row.name)]))};};
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

const [{claimGuestContext},{GUEST_IMAGE_SAVE_CLAIM_SCHEMA,inspectGuestImageSaveInventory},{claimGuestImageSave},
  {retireExpiredClaimedGuestImageOutput},{retireExpiredGuestImageSource},{handleWorkspaces}]=await Promise.all([
  import('../worker/experience-guest-context-claim.ts'),import('../worker/experience-guest-image-claim-inventory.ts'),
  import('../worker/experience-guest-image-claim.ts'),import('../worker/experience-guest-claimed-image-output-retirement.ts'),
  import('../worker/experience-guest-source-retirement.ts'),import('../worker/workspaces-api.ts')]);

async function fixture(t,{kind='context',memory=false,governed=true,adoption='complete',draftLifetimeMs=1800,leaseLifetimeMs=60000,leaseRenewals=0,subjectText=subject}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  // The frozen adapter dispatches WITH as read. This private adaptation preserves
  // the actual resource writer's SQLite changes without changing the shared helper.
  const nativeBatch=f.DB.batch;f.DB.batch=statements=>nativeBatch.call(f.DB,statements.map(statement=>{if(/WITH[\s\S]*INSERT INTO experience_sponsor_resource_receipts/u.test(statement.sql)){const execute=statement.execute;statement.execute=function(mode){return execute.call(this,mode==='all'?'run':mode);};}return statement;}));
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...(adoption==='complete'?[...GUEST_CONTEXT_ADOPTION_SCHEMA,...GUEST_PLAN_CUSTODY_SCHEMA]:[]),...(kind==='image'?[...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA,...GUEST_IMAGE_SAVE_CLAIM_SCHEMA]:[])])f.sqlite.exec(sql);
  if(memory)installMemory(f);
  for(const actor of kind==='image'?[owner,payer]:[owner])insert(f,'users',{user_id:actor,email:`${actor}@example.invalid`,display_name:actor,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
  let network=0,media=0;t.mock.method(globalThis,'fetch',()=>{network++;throw Error('network forbidden');});for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{media++;throw Error('media forbidden');});t.after(()=>{assert.equal(network,0);assert.equal(media,0);});
  f.env.FORMA_RETENTION_DAYS='2';const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:now-60000,expiresAtMs:now+600000,sessionLifetimeMs:300000,leaseLifetimeMs,maximumSessions:5,maximumLeaseAcquisitions:leaseRenewals?100:3});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(request(),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:subjectText,provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const sourcePolicy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(sourcePolicy.policyId,await digest(sourcePolicy),canonicalJson(sourcePolicy),`sha256:${'c'.repeat(64)}`);
  const proof=proofFor(session),prepared=await prepareGuestImageSource(request(),f.env,{proof,policyId:sourcePolicy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}}),committed=await commitGuestImageSource(request(),f.env,{proof,draftHash:prepared.plan.draftHash});
  Object.assign(f,{session,terms,sourcePolicy,release,proof,prepared,committed,subject:subjectText,kind});
  f.retire=(input={sessionId:session.sessionId},env=f.env)=>retireExpiredGuestImageSource(env,input);
  f.retireTail=()=>retireExpiredClaimedGuestImageOutput(f.env,{sessionId:session.sessionId});
  if(kind==='unclaimed')return f;
  await appendAuditEvent(f.env,`creative:${owner}`,'user','ProjectCreated',{project_id:'unrelated-project',name:'Earlier work'});
  const previous=[{type:'DocumentCreated',payload:{project_id:'unrelated-project',document_id:'unrelated-document',title:'Earlier Document'}},{type:'EmptyCanvasChosen',payload:{project_id:'unrelated-project',document_id:'unrelated-document'}}];
  const added=await handleEvents(new Request(`${origin}/api/events`,{method:'POST',headers:canonicalHeaders(owner,{'content-type':'application/json'}),body:JSON.stringify({action:'batch',expectedSequence:1,events:previous})}),f.env),addedBody=await added.json();assert.equal(added.status,200,JSON.stringify(addedBody));assert.deepEqual(addedBody.rejected,[]);assert.equal(addedBody.appended.length,2);f.targetHead=await streamHead(f.env,`creative:${owner}`);assert.equal(f.targetHead,3);
  let inventory;
  if(kind==='image'){
    Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
    f.policy=await candidatePolicy(f);f.policy.payerUserId=payer;f.compiled=await approvePolicy(f);
    f.saved=await saveGuestImageRequirement(request(),f.env,{proof,campaignId:f.policy.campaignId,policyDigest:f.compiled.policyDigest,draftHash:prepared.plan.draftHash});
    inventory=await inspectGuestImageSaveInventory(request(),f.env,{proof});
  }else inventory=await inspectGuestContextInventory(request(),f.env,{proof});
  let requestId='source-retirement-claim';
  if(leaseRenewals){
    const {acquireGuestClaimLease}=await import('../worker/experience-guest-claim-lease.ts');
    f.requestHistory=[];
    for(let index=0;index<leaseRenewals;index++){
      const currentId=`request-${String(index).padStart(3,'0')}-`.padEnd(160,'x');f.requestHistory.push(currentId);
      const acquired=await acquireGuestClaimLease(canonicalRequest(),f.env,{proof,requestId:currentId,manifestDigest:inventory.manifestDigest});
      if(index===0)f.originalLeaseId=acquired.leaseId;else assert.equal(acquired.leaseId,f.originalLeaseId);
      const started=performance.now();while(!f.sqlite.prepare(`SELECT expires_at_ms<=${GUEST_DB_NOW} AS expired FROM experience_guest_claim_leases WHERE session_id=?`).get(session.sessionId).expired){assert.ok(performance.now()-started<2000);await delay(5);}
    }
    requestId=`request-${String(leaseRenewals).padStart(3,'0')}-`.padEnd(160,'x');f.requestHistory.push(requestId);
  }
  const input={sessionId:session.sessionId,requestId,approvedManifestDigest:inventory.manifestDigest,proof};
  f.claimed=await (kind==='image'?claimGuestImageSave:claimGuestContext)(canonicalRequest(),f.env,input);assert.equal(f.claimed.status,kind==='image'?'image-save-claimed':'context-claimed');assert.equal(f.claimed.planRetention,'retained');assert.equal(f.claimed.generationAvailable,false);assert.equal(f.claimed.miniAppClaimComplete,false);
  f.adopted=rows(f,'experience_guest_context_adoptions').find(row=>row.session_id===session.sessionId);f.lineage=JSON.parse(f.adopted.lineage_json);
  assert.equal(f.lineage.targetStart,4);assert.equal(f.lineage.sourceHead,committed.head);assert.equal(f.lineage.targetHead,3+committed.head);assert.equal(f.lineage.events.length,committed.eventIds.length);
  f.canonicalEvents=f.sqlite.prepare('SELECT * FROM events WHERE stream_id=? AND sequence>? ORDER BY sequence').all(`creative:${owner}`,3);assert.equal(f.canonicalEvents.length,committed.head+(kind==='image'?1:0));
  for(const row of f.canonicalEvents){assert.equal([...committed.eventIds,...(f.saved?[f.saved.eventId]:[])].includes(row.event_id),false);const body=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(row.event_id);assert.equal(body.owner_id,owner);}
  const canonicalDraft=rows(f,'private_content').find(row=>row.owner_id===owner&&row.kind==='experience-draft');assert.equal(canonicalDraft.content,canonicalJson(prepared.plan));assert.ok(canonicalDraft.expires_at>prepared.expiresAt);
  if(governed)await attach(f);return f;
}
async function attach(f){
  const workspace=(path,body)=>handleWorkspaces(new Request(`${origin}/api/workspaces/${path.join('/')}`,{method:'POST',headers:canonicalHeaders(owner,body?{'content-type':'application/json'}:{}),...(body?{body:JSON.stringify(body)}:{})}),f.env,path);
  const response=await workspace([],{name:'Canonical custody workspace'}),created=await response.json();assert.equal(response.status,201,JSON.stringify(created));
  const attached=await workspace([created.organizationId,'projects'],{projectId:f.session.projectId}),result=await attached.json();assert.equal(attached.status,201,JSON.stringify(result));
  Object.assign(f,{organizationId:created.organizationId,projectAccessId:result.projectAccessId});
  const mapping=f.sqlite.prepare('SELECT * FROM organization_projects WHERE project_access_id=?').get(f.projectAccessId);assert.equal(mapping.owner_user_id,owner);assert.equal(mapping.project_id,f.session.projectId);assert.equal(mapping.organization_id,f.organizationId);
  const document=f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='document' AND resource_id=?").get(f.projectAccessId,f.session.documentId);assert.ok(document);assert.equal(document.owner_user_id,owner);assert.equal(document.organization_id,f.organizationId);assert.equal(document.project_id,f.session.projectId);assert.equal(document.source_event_id,null);assert.equal(document.actor_user_id,owner);assert.equal(document.visibility,'collaborative_output');
  const scopes=rows(f,'project_event_scopes').filter(row=>row.project_access_id===f.projectAccessId);assert.ok(scopes.length>=f.lineage.events.length);for(const scope of scopes){assert.equal(scope.source_stream_id,`creative:${owner}`);assert.equal([...f.committed.eventIds,...(f.saved?[f.saved.eventId]:[])].includes(scope.event_id),false);}
  for(const event of f.lineage.events){const scope=scopes.find(row=>row.event_id===event.id);assert.ok(scope);assert.equal(scope.owner_user_id,owner);assert.equal(scope.organization_id,f.organizationId);assert.equal(scope.project_id,f.session.projectId);assert.equal(scope.project_access_id,f.projectAccessId);assert.equal(scope.source_sequence,event.sequence);}
  const opened=await workspace([f.organizationId,'projects',f.projectAccessId,'context']);assert.equal(opened.status,200,await opened.clone().text());f.cookie=opened.headers.get('set-cookie')?.split(';')[0];assert.ok(f.cookie);
  const refreshed=await handleEvents(new Request(`${origin}/api/events`,{headers:canonicalHeaders(owner,{cookie:f.cookie})}),f.env);assert.equal(refreshed.status,200,await refreshed.clone().text());
  if(f.saved){
    const output=async body=>{const base='/api/output-requirements',path=body?base:`${base}?documentId=${encodeURIComponent(f.session.documentId)}`,response=await handleOutputRequirements(new Request(`${origin}${path}`,{method:body?'POST':'GET',headers:canonicalHeaders(owner,{cookie:f.cookie,...(body?{'content-type':'application/json'}:{})}),...(body?{body:JSON.stringify(body)}:{})}),f.env,base,{waitUntil(){assert.fail('unexpected provider work');}}),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
    const initial=await output(),spec=structuredClone(initial.requirements.find(row=>row.blockId===f.saved.requirementId).spec);spec.label='Governed canonical Image';await output({action:'save',documentId:f.session.documentId,blockId:f.saved.requirementId,spec,clientMutationId:'governed-save',expectedRevision:initial.revision});const saved=await output();assert.equal(saved.requirements.find(row=>row.blockId===f.saved.requirementId).spec.label,spec.label);await output({action:'confirm',documentId:f.session.documentId,clientMutationId:'governed-confirm',expectedRevision:saved.revision});
    const plan=rows(f,'output_plan_revisions').find(row=>row.scope_key===`project:${f.organizationId}:${f.projectAccessId}`);assert.ok(plan);assert.equal(plan.owner_user_id,owner);assert.equal(plan.project_access_id,f.projectAccessId);assert.equal(plan.organization_id,f.organizationId);assert.equal(plan.project_id,f.session.projectId);assert.equal(plan.document_id,f.session.documentId);assert.equal([...f.committed.eventIds,f.saved.eventId].includes(plan.confirmed_event_id),false);
  }
}
const canonicalTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&new Date(value).toISOString()===value;
async function expire(f){const start=performance.now();while(!f.sqlite.prepare("SELECT expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AS due FROM experience_guest_sources WHERE session_id=?").get(f.session.sessionId).due){assert.ok(performance.now()-start<45000,'real native expiry');await delay(10);}}
function assertRetired(f,result,replayed=false){assert.deepEqual(result,{status:'retired',sessionId:f.session.sessionId,draftId:f.prepared.plan.draftId,eventCount:f.committed.eventIds.length,replayed});assert.ok(Object.isFrozen(result));const draft=f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(f.prepared.plan.draftId);assert.equal(draft.content,'');assert.ok(canonicalTime(draft.redacted_at));for(const id of f.committed.eventIds){const body=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(id);assert.equal(body.private_json,'');assert.ok(canonicalTime(body.redacted_at));}for(const secret of [f.subject,f.session.sessionToken,f.session.claimToken,'lineage_json','SELECT'])assert.ok(!JSON.stringify(result).includes(secret));}
function onlyOriginalPrefixChanged(f,before){const after=snapshot(f);assert.deepEqual(after.schema,before.schema);for(const [table,prior]of Object.entries(before.contents)){
  const current=after.contents[table];assert.equal(current.length,prior.length,table);
  if(table==='private_content'){for(const row of current){const old=prior.find(x=>x.content_id===row.content_id);assert.ok(old);assert.deepEqual(row.content_id===f.prepared.plan.draftId?{...row,content:old.content,redacted_at:old.redacted_at}:{...row},{...old});}}
  else if(table==='event_private_payloads'){for(const row of current){const old=prior.find(x=>x.private_event_id===row.private_event_id);assert.ok(old);assert.deepEqual(f.committed.eventIds.includes(row.private_event_id)?{...row,private_json:old.private_json,redacted_at:old.redacted_at}:{...row},{...old});}}
  else assert.deepEqual(current,prior,table);
}}
async function deniedUnchanged(f){const before=snapshot(f);await assert.rejects(f.retire(),/source_retirement_unavailable/u);assert.deepEqual(snapshot(f),before);}

test('genuine context-only claim and native governed Project attachment permit due original prefix cleanup',async t=>{const f=await fixture(t);await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyOriginalPrefixChanged(f,before);});

function nativeCorrupt(f,table,sql,...bindings){const triggers=f.sqlite.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=?").all(table);assert.throws(()=>f.sqlite.prepare(sql).run(...bindings),/immutable|append.only/u,'native immutable history rejects rewriting');for(const row of triggers)f.sqlite.exec(`DROP TRIGGER "${row.name}"`);try{f.sqlite.prepare(sql).run(...bindings);}finally{for(const row of triggers)f.sqlite.exec(row.sql);}}
async function corruptLineage(f,mutate){const lineage=JSON.parse(f.adopted.lineage_json);mutate(lineage);nativeCorrupt(f,'experience_guest_context_adoptions','UPDATE experience_guest_context_adoptions SET lineage_json=?,lineage_digest=? WHERE session_id=?',canonicalJson(lineage),await digest(lineage),f.session.sessionId);}
const retirementBatch=statements=>statements.some(statement=>/UPDATE private_content SET content=''/u.test(statement.sql));
function batchHook(f,action,{after=true}={}){const batch=f.DB.batch;let attempts=0;f.DB.batch=async statements=>{if(!retirementBatch(statements))return batch.call(f.DB,statements);attempts++;if(attempts===1&&!after)action(statements);const result=await batch.call(f.DB,statements);return attempts===1&&after?action(result):result;};return()=>{f.DB.batch=batch;assert.equal(attempts,1,'exactly one mutation attempt');};}
function statementHook(f,predicate,action){const prepare=f.DB.prepare;let hit=false;f.DB.prepare=function(sql){const statement=prepare.call(this,sql),bind=statement.bind;statement.bind=function(...bindings){const bound=bind.apply(this,bindings),execute=bound.execute;bound.execute=function(kind){const result=execute.call(this,kind);if(!hit&&predicate(sql)){hit=true;action();}return result;};return bound;};return statement;};return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native statement hook reached');};}
function readHook(f,predicate,action){const prepare=f.DB.prepare;let hit=false;function wrap(statement,sql){const first=statement.first,bind=statement.bind;statement.bind=function(...bindings){return wrap(bind.apply(this,bindings),sql);};statement.first=async function(){const value=await first.call(this);if(!hit&&predicate(sql)){hit=true;action();}return value;};return statement;}f.DB.prepare=sql=>wrap(prepare.call(f.DB,sql),sql);return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native read hook reached');};}
const canonicalSnapshot=f=>{const all=snapshot(f),prefix=new Set(f.committed.eventIds);all.contents.private_content=all.contents.private_content.filter(row=>row.content_id!==f.prepared.plan.draftId);all.contents.event_private_payloads=all.contents.event_private_payloads.filter(row=>!prefix.has(row.private_event_id)&&row.private_event_id!==f.saved?.eventId);return all;};
for(const memory of [false,true])test(`strict context-only governed cleanup and stable replay with ${memory?'complete':'absent'} Memory`,async t=>{
  const f=await fixture(t,{memory,subjectText:memory?'界'.repeat(600):subject});await expire(f);const before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{assertRetired(f,await f.retire());onlyOriginalPrefixChanged(f,before);const erased=snapshot(f);assertRetired(f,await f.retire(),true);assert.deepEqual(snapshot(f),erased);limits.assertVerified();t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));}catch(error){t.diagnostic(JSON.stringify({strictFailures:limits.failures.map(row=>({kind:row.kind,error:row.error,count:row.count,limit:row.limit,statementBytes:row.statementBytes,parameterCount:row.parameterCount}))}));throw error;}finally{limits.restore();}
});
for(const order of ['source-first','tail-first'])test(`genuine governed N+1 SAVE ${order} cleanup preserves every separate canonical copy under strict complete Memory`,async t=>{
  const f=await fixture(t,{kind:'image',memory:true}),canonical=canonicalSnapshot(f);await expire(f);const limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{if(order==='tail-first'){const prefix=rows(f,'event_private_payloads').filter(row=>f.committed.eventIds.includes(row.private_event_id));await f.retireTail();assert.deepEqual(rows(f,'event_private_payloads').filter(row=>f.committed.eventIds.includes(row.private_event_id)),prefix);}
    const before=snapshot(f),tail=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(f.saved.eventId);assertRetired(f,await f.retire());onlyOriginalPrefixChanged(f,before);assert.deepEqual(f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(f.saved.eventId),tail);
    if(order==='source-first')await f.retireTail();assert.equal(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(f.saved.eventId).private_json,'');assert.deepEqual(canonicalSnapshot(f),canonical);const after=snapshot(f);assertRetired(f,await f.retire(),true);assert.deepEqual(snapshot(f),after);limits.assertVerified();t.diagnostic(JSON.stringify({order,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }catch(error){t.diagnostic(JSON.stringify({strictFailures:limits.failures.map(row=>({kind:row.kind,error:row.error,count:row.count,limit:row.limit,statementBytes:row.statementBytes,parameterCount:row.parameterCount}))}));throw error;}finally{limits.restore();}
});
for(const adoption of ['absent','complete'])test(`unclaimed source keeps conservative cleanup with optional adoption family ${adoption}`,async t=>{const f=await fixture(t,{kind:'unclaimed',adoption});await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyOriginalPrefixChanged(f,before);});
const schemaDamage={
  'partial adoption family':f=>f.sqlite.exec('DROP TABLE experience_guest_context_adoption_assertions'),
  'unknown attached adoption trigger':f=>f.sqlite.exec("CREATE TRIGGER sentinel_adoption AFTER INSERT ON experience_guest_context_adoptions BEGIN SELECT 1; END"),
  'missing required custody trigger':f=>f.sqlite.exec('DROP TRIGGER experience_guest_lease_update'),
  'missing completed receipt':f=>{nativeCorrupt(f,'experience_guest_plan_custodies','DELETE FROM experience_guest_plan_custodies WHERE session_id=?',f.session.sessionId);nativeCorrupt(f,'experience_guest_context_adoptions','DELETE FROM experience_guest_context_adoptions WHERE session_id=?',f.session.sessionId);},
};
for(const [name,mutate]of Object.entries(schemaDamage))test(`${name} cannot authorize governed original cleanup`,async t=>{const f=await fixture(t);mutate(f);await expire(f);await deniedUnchanged(f);});
const lineageDamage={
  'lease destination':f=>nativeCorrupt(f,'experience_guest_claim_leases','UPDATE experience_guest_claim_leases SET destination_user_id=? WHERE session_id=?',other,f.session.sessionId),
  'lease history':f=>nativeCorrupt(f,'experience_guest_claim_leases','UPDATE experience_guest_claim_leases SET request_ids_json=? WHERE session_id=?','["other-request"]',f.session.sessionId),
  'session revoke timestamp':f=>nativeCorrupt(f,'experience_guest_sessions','UPDATE experience_guest_sessions SET revoked_at_ms=revoked_at_ms+1 WHERE session_id=?',f.session.sessionId),
  'coherently rehashed ordered original IDs':f=>corruptLineage(f,lineage=>lineage.sourceEventIds.reverse()),
  'coherently rehashed target start':f=>corruptLineage(f,lineage=>{lineage.targetStart++;lineage.targetHead++;for(const event of lineage.events)event.sequence++;}),
  'coherently rehashed source/canonical overlap':f=>corruptLineage(f,lineage=>{lineage.events[0].id=lineage.sourceEventIds[0];}),
};
for(const [name,mutate]of Object.entries(lineageDamage))test(`synthetic ${name} contradiction cannot substitute for exact historical custody`,async t=>{const f=await fixture(t);await mutate(f);await expire(f);await deniedUnchanged(f);});
const targetDamage={
  'native actor':f=>nativeCorrupt(f,'events','UPDATE events SET actor=? WHERE event_id=?',`user:${other}`,f.lineage.events[0].id),
  'native client':f=>nativeCorrupt(f,'events','UPDATE events SET client_id=? WHERE event_id=?','foreign-client',f.lineage.events[0].id),
  'canonical receipt':f=>f.sqlite.prepare('DELETE FROM event_client_receipts WHERE event_id=?').run(f.lineage.events[0].id),
  'private owner metadata':f=>f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run(other,f.lineage.events[0].id),
  'physical private metadata loss':f=>f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(f.lineage.events[0].id),
};
for(const [name,mutate]of Object.entries(targetDamage))test(`canonical ${name} contradiction blocks cleanup without erasing originals`,async t=>{const f=await fixture(t);mutate(f);await expire(f);await deniedUnchanged(f);});
const relationDamage={
  'different Project owner':f=>f.sqlite.prepare('UPDATE organization_projects SET owner_user_id=? WHERE project_access_id=?').run(other,f.projectAccessId),
  'different Document owner':f=>f.sqlite.prepare("UPDATE project_resource_scopes SET owner_user_id=? WHERE resource_kind='document' AND resource_id=?").run(other,f.session.documentId),
  'different Document access':f=>f.sqlite.prepare("UPDATE project_resource_scopes SET project_access_id=? WHERE resource_kind='document' AND resource_id=?").run('foreign-access',f.session.documentId),
  'different Document organization':f=>f.sqlite.prepare("UPDATE project_resource_scopes SET organization_id=? WHERE resource_kind='document' AND resource_id=?").run('foreign-org',f.session.documentId),
  'direct original event reference':f=>f.sqlite.prepare("UPDATE project_resource_scopes SET source_event_id=? WHERE resource_kind='document' AND resource_id=?").run(f.committed.eventIds[0],f.session.documentId),
  'direct original guest actor':f=>f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id=? WHERE resource_kind='document' AND resource_id=?").run(f.session.guestSubject,f.session.documentId),
  'original draft content scope':f=>insert(f,'project_resource_scopes',{project_access_id:f.projectAccessId,organization_id:f.organizationId,project_id:f.session.projectId,owner_user_id:owner,resource_kind:'content',resource_id:f.prepared.plan.draftId,visibility:'collaborative_output',source_event_id:null,actor_user_id:owner,created_at:time}),
  'original draft retention scope':f=>insert(f,'private_content_retention_scopes',{content_id:f.prepared.plan.draftId,organization_id:f.organizationId,project_access_id:f.projectAccessId,project_id:f.session.projectId,actor_user_id:owner,classification:'governed-evidence',policy_version:1,assigned_expires_at:f.prepared.expiresAt,created_at:time}),
};
for(const [name,mutate]of Object.entries(relationDamage))test(`${name} remains excluded despite actual canonical governance`,async t=>{const f=await fixture(t);mutate(f);await expire(f);await deniedUnchanged(f);});
async function nativeEdit(f,type,payload){const read=await handleEvents(new Request(`${origin}/api/events`,{headers:canonicalHeaders(owner,{cookie:f.cookie})}),f.env),current=await read.json();assert.equal(read.status,200,JSON.stringify(current));const head=current.head;assert.ok(Number.isSafeInteger(head));const response=await handleEvents(new Request(`${origin}/api/events`,{method:'POST',headers:canonicalHeaders(owner,{cookie:f.cookie,'content-type':'application/json'}),body:JSON.stringify({action:'batch',expectedSequence:head,events:[{type,payload:{project_id:f.session.projectId,document_id:f.session.documentId,...payload}}]})}),f.env),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.rejected,[]);assert.equal(body.appended.length,1);}
const laterState={
  'native later context edit':f=>{const block=f.prepared.plan.events.find(event=>event.type==='BlockCreated'&&event.payload.properties?.text===subject);return nativeEdit(f,'BlockPropertyEdited',{block_id:block.payload.block_id,property_path:'text',old_value:subject,new_value:'A new canonical subject'});},
  'native Document removal':f=>nativeEdit(f,'DocumentRemoved',{}),
  'canonical private tombstones':f=>{for(const event of f.lineage.events)f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id=?").run(time,event.id);},
  'current access and policy loss':f=>{f.sqlite.prepare("UPDATE users SET role='viewer',consent_version=NULL WHERE user_id=?").run(owner);f.sqlite.exec("UPDATE organization_projects SET status='archived'");f.sqlite.exec('UPDATE experience_guest_policies SET revoked_at_ms=1; UPDATE experience_guest_source_policies SET revoked_at_ms=1');f.env.FORMA_PILOT_COHORT_ID='later-pilot';},
};
for(const [name,mutate]of Object.entries(laterState))test(`${name} does not extend the original retention deadline`,async t=>{const f=await fixture(t);await mutate(f);await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyOriginalPrefixChanged(f,before);});
for(const kind of ['lost','truncated','false'])test(`${kind} cleanup acknowledgement recovers only the exact original tombstones without a second mutation batch`,async t=>{const f=await fixture(t);await expire(f);const before=snapshot(f),done=batchHook(f,result=>{if(kind==='lost')throw Error('lost cleanup acknowledgement');return kind==='truncated'?result.slice(0,-1):result.map((row,index)=>index?row:{...row,success:false});});assertRetired(f,await f.retire(),true);done();onlyOriginalPrefixChanged(f,before);});
for(const change of ['relation','schema'])for(const stage of ['before-batch','inside-batch','after-commit'])test(`late ${change} change ${stage} is fenced by exact historical custody`,async t=>{
  const f=await fixture(t);await expire(f);const before=snapshot(f);let changed;
  const mutate=()=>{if(change==='relation')relationDamage['different Document organization'](f);else f.sqlite.exec("CREATE TRIGGER late_adoption AFTER INSERT ON experience_guest_context_adoptions BEGIN SELECT 1; END");changed=snapshot(f);};
  const done=stage==='inside-batch'?statementHook(f,sql=>/^UPDATE event_private_payloads SET private_json=''/u.test(sql),mutate):batchHook(f,result=>{mutate();return result;},{after:stage==='after-commit'});
  await assert.rejects(f.retire(),/source_retirement_unavailable/u);done();assert.ok(changed);
  if(stage==='inside-batch')assert.deepEqual(snapshot(f),before,'after-custody assertion rolls back every original erasure and injected relation/schema');
  else assert.deepEqual(snapshot(f),changed,'no second mutation or restoration after external custody drift');
});
for(const stage of ['before-read','after-commit'])test(`database identity change ${stage} cannot return retirement authority`,async t=>{const f=await fixture(t);await expire(f);const before=snapshot(f),done=stage==='after-commit'?batchHook(f,result=>{f.env.DB={...f.DB};return result;}):readHook(f,sql=>sql.includes('FROM experience_guest_sources'),()=>{f.env.DB={...f.DB};});await assert.rejects(f.retire(),/database_changed/u);done();f.env.DB=f.DB;if(stage==='before-read')assert.deepEqual(snapshot(f),before);else onlyOriginalPrefixChanged(f,before);});
test('source selector is copied before the first awaited native read',async t=>{const f=await fixture(t);await expire(f);const input={sessionId:f.session.sessionId},before=snapshot(f),done=readHook(f,sql=>sql.includes('FROM experience_guest_sources'),()=>{input.sessionId='other-session';});assertRetired(f,await f.retire(input));done();onlyOriginalPrefixChanged(f,before);});
test('real active original deadline still refuses cleanup after completed governed custody',async t=>{const f=await fixture(t,{draftLifetimeMs:60000}),before=snapshot(f);t.mock.method(Date,'now',()=>8_000_000_000_000);await assert.rejects(f.retire(),/source_retirement_not_due/u);assert.deepEqual(snapshot(f),before);});

test('expired authentic lease and nonempty canonical financial holds do not extend original expiry',async t=>{
  const f=await fixture(t,{leaseLifetimeMs:500});
  insert(f,'budget_reservations',{reservation_id:'native-unrelated-tokens',owner_id:owner,stream_id:`creative:${owner}`,correlation_id:'unrelated-job',operation:'image',period:'2026-09',reserved_tokens:100,used_tokens:3,status:'active',created_at:time,updated_at:time});
  insert(f,'cost_budget_reservations',{reservation_id:'native-unrelated-cost',owner_id:owner,workspace_id:'forma',stream_id:`creative:${owner}`,correlation_id:'unrelated-job',operation:'image',period:'2026-09',reserved_microusd:1234,used_microusd:4,status:'executing',created_at:time,updated_at:time});
  await expire(f);assert.ok(f.lineage.lease.expires_at_ms<=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS value`).get().value);const before=snapshot(f);assertRetired(f,await f.retire());onlyOriginalPrefixChanged(f,before);
});
test('direct original guest event scope remains excluded under completed destination custody',async t=>{
  const f=await fixture(t);insert(f,'project_event_scopes',{event_id:f.committed.eventIds[0],project_access_id:f.projectAccessId,organization_id:f.organizationId,project_id:f.session.projectId,owner_user_id:owner,source_stream_id:`creative:${f.session.guestSubject}`,source_sequence:1,project_sequence:999,actor_user_id:f.session.guestSubject,created_at:time});await expire(f);await deniedUnchanged(f);
});
test('native Memory reference to an original event remains excluded under completed destination custody',async t=>{
  const f=await fixture(t,{memory:true});insert(f,'memory_document_job_answer_origins',{origin_id:'synthetic-original-origin',schema_version:1,recipe_version:'native-document-job-answer-origin-v1',job_id:'unrelated-job',actor_user_id:'foreign-actor',scope_key:'["","","foreign-project","foreign-document"]',turn_id:'foreign-turn',user_event_id:f.committed.eventIds[0],user_content_id:'foreign-user-body',answer_event_id:'foreign-answer',answer_content_id:'foreign-answer-body',manifest_content_ref:'foreign-manifest',status:'minimized',withdrawn_at:time,withdrawal_reason:'erased'});await expire(f);await deniedUnchanged(f);
});
for(const kind of ['original guest actor','original guest event'])test(`actual canonical block scope with ${kind} cannot authorize original source erasure`,async t=>{
  const f=await fixture(t),index=f.prepared.plan.events.findIndex(event=>event.type==='BlockCreated'),blockId=f.prepared.plan.events[index].payload.block_id,originalEventId=f.committed.eventIds[index];assert.ok(index>=3);
  const select=()=>f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='block' AND resource_id=?").get(f.projectAccessId,blockId),before=select();assert.ok(before);assert.equal(before.owner_user_id,owner);assert.equal(before.actor_user_id,owner);assert.equal(before.source_event_id,null);
  if(kind==='original guest actor')f.sqlite.prepare("UPDATE project_resource_scopes SET actor_user_id=? WHERE project_access_id=? AND resource_kind='block' AND resource_id=?").run(f.session.guestSubject,f.projectAccessId,blockId);
  else f.sqlite.prepare("UPDATE project_resource_scopes SET source_event_id=? WHERE project_access_id=? AND resource_kind='block' AND resource_id=?").run(originalEventId,f.projectAccessId,blockId);
  const scoped=select();await expire(f);const held=snapshot(f);let result;try{result=await f.retire();}catch(error){assert.match(String(error),/source_retirement_unavailable/u);assert.deepEqual(select(),scoped);assert.deepEqual(snapshot(f),held,'refusal leaves every original, canonical, schema and financial row unchanged');return;}
  t.diagnostic(JSON.stringify({unexpectedSuccess:result,kind,scope:scoped,scopeUnchanged:JSON.stringify(select())===JSON.stringify(scoped),draftErased:f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.prepared.plan.draftId).content==='',originalPrefixErased:f.committed.eventIds.every(id=>f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(id).private_json==='')}));assert.fail('direct original guest association must not authorize source retirement');
});
test('unclaimed source with an unused partial optional adoption family preserves old conservative cleanup',async t=>{
  const f=await fixture(t,{kind:'unclaimed',adoption:'complete'});f.sqlite.exec('DROP TABLE experience_guest_context_adoption_assertions');assert.equal(rows(f,'organization_projects').length,0);assert.equal(rows(f,'project_resource_scopes').length,0);await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyOriginalPrefixChanged(f,before);
});

test('actual 56 native lease acquisitions preserve more than 8192 bytes of history through governed original cleanup',{timeout:60000},async t=>{
  const f=await fixture(t,{leaseLifetimeMs:500,leaseRenewals:55,draftLifetimeMs:40000});
  assert.equal(f.lineage.lease.lease_id,f.originalLeaseId);assert.equal(f.lineage.lease.acquisitions,56);assert.deepEqual(JSON.parse(f.lineage.lease.request_ids_json),f.requestHistory);assert.ok(f.lineage.lease.request_ids_json.length>8192);assert.equal(rows(f,'experience_guest_claim_leases')[0].request_ids_json,f.lineage.lease.request_ids_json);
  await expire(f);const before=snapshot(f);assertRetired(f,await f.retire());onlyOriginalPrefixChanged(f,before);assert.equal(rows(f,'experience_guest_claim_leases')[0].request_ids_json,f.lineage.lease.request_ids_json);
});

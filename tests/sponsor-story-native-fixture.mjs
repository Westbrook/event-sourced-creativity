import assert from 'node:assert/strict';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},
  {handleOutputRequirements,loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {createExperienceOutputRecipe},{SHORT_STORY_NARRATIVE_CONTRACT},{OUTPUT_NATIVE_EXECUTION_POLICY},
  {OPENAI_TEXT_PRICING_VERSION,estimateOpenAITextCallMaximumMicrousd},{describeSponsorStoryAdmission},
  {createSponsorAdmissionAuthority},{compileSponsorEnvelope},{SPONSOR_ENTITLEMENT_SCHEMA},
  {SPONSOR_RESOURCE_SCHEMA,prepareSponsorResourcePlan},{SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign,revokeSponsorCampaign},
  {SPONSOR_ISSUER_SCHEMA},{createSponsorExecutionAuthority,readSponsorFinancialBinding,sponsorFinancialIdentity,sponsorFinancialEventProfile},
  {runDocumentJob,handleDocumentJobs},{loadOutputJobBinding,reconcileExpiredOutputAuthorizations,createOutputEventExecution},
  {handleEventPrivacy},{canonicalJson,digest}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-output-recipe.ts'),import('../src/model/output-narrative-contract.ts'),import('../src/model/output-execution-policy.ts'),
  import('../worker/openai-text-cost.ts'),import('../worker/experience-sponsor-story-evidence.ts'),
  import('../worker/experience-sponsor-admission.ts'),import('../worker/experience-sponsor-policy.ts'),import('../worker/experience-sponsor-entitlement.ts'),
  import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),import('../worker/experience-sponsor-issuer.ts'),
  import('../worker/experience-sponsor-execution.ts'),import('../worker/document-jobs-api.ts'),import('../worker/output-execution-control.ts'),
  import('../worker/privacy-api.ts'),import('../src/experiences/compiler.ts'),
]);
// All identities, approvals, grants and ledgers belong to one disposable SQLite
// fixture. No route/schema is enabled, no real provider is contacted and every
// response below is synthetic. The immutable issuance is explicit fixture setup:
// this suite does not claim that the separate Story issuer/driver exists yet.
const actor='dev-local-creative',payer='fixture-story-sponsor',stream=`creative:${actor}`,BASE='/api/output-requirements';
const context={waitUntil(){throw Error('No detached work permitted');}};
const headers=id=>({'oai-authenticated-user-id':id,'oai-authenticated-user-email':`${id}@example.invalid`});
const post=(body,auth={})=>({method:'POST',headers:{'content-type':'application/json',...auth},body:JSON.stringify(body)});
const originalFetch=globalThis.fetch;
const tableNames=['events','event_private_payloads','output_commands','output_execution_grants','output_operation_slots','document_jobs',
  'budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters','experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls'];
const rows=f=>Object.fromEntries(tableNames.map(name=>[name,f.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const finances=f=>Object.fromEntries(['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters','experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls'].map(name=>[name,f.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const actorCounters=f=>Object.fromEntries(['budget_counters','cost_budget_counters'].map(name=>[name,f.sqlite.prepare(`SELECT * FROM ${name} WHERE scope='user' AND scope_id=? ORDER BY rowid`).all(actor)]));
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
function template(recipe){return {version:1,family:'canonical-short-story@1',appId:'short-story',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,
  outputKind:'short_story',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,route:'document-short-story-manual-v1',maximumCalls:1,maximumTokens:128000,
  maximumInputTokens:122000,maximumOutputTokens:6000,maximumMicrousd:Math.max(1_000_000,estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra',122000,6000)),
  call:{stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra'},narrativeContract:SHORT_STORY_NARRATIVE_CONTRACT,pricingVersion:OPENAI_TEXT_PRICING_VERSION,
  cachePolicy:'disabled-explicit',reasoningEffort:'low',executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};}
async function fixture(t,{strict=false,sponsor=true}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'});
  for(const auth of [{},headers(payer)])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:auth}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  const documentId='sponsor-native-story';
  await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Synthetic sponsored story'});
  await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:'story-source',type:'subject',handle:'story-source',position:'0',properties:{text:'Mira chooses to return a lost clock despite missing the last train.',weight:1}});
  let sequence=0;
  const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,post({documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`setup-${++sequence}`,...body})),f.env,BASE,context,outputDocumentExecutionBridge);
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const recipe=createExperienceOutputRecipe({output:'short_story',requirementId:'story-requirement',deliverableId:'story-deliverable',contract:SHORT_STORY_NARRATIVE_CONTRACT});
  await ok(await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec}));
  const confirmed=await ok(await send({action:'confirm'}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
  const preflight=await ok(await send({action:'preflight',planRevisionId:confirmed.command.planRevisionId,targetIds:confirmed.snapshot.confirmedPlan.plan.targets.map(target=>target.id)}));
  const terms=preflight.command.preflight;assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
  const command={documentId,action:'authorize',expectedRevision:preflight.snapshot.revision,clientMutationId:'story-sponsored-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const request=new Request(`http://localhost${BASE}`,post(command)),trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  const limits=strict?enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}}):null;
  if(limits)t.after(()=>limits.restore());
  Object.assign(f,{documentId,terms,command,request,trusted,send,ok,limits});
  f.sponsor=async({reviewedTermsDigest}={})=>{
  const trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  const description=await describeSponsorStoryAdmission(trusted,command),reviewedTemplate=template(description.recipe);
  const now=(await f.env.DB.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now").first()).now,campaignId='fixture-story-campaign';
  const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,maximumPendingGrants:10,maximumInflightJobs:1};
  const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
  const proposal={policy:{version:4,family:'canonical-short-story@1',mode:'candidate',campaignId,policyVersion:'story-fixture@1',payerUserId:payer,audience:'canonical-principal',
    startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,maximumAdmissions:10,maximumMicrousd:reviewedTemplate.maximumMicrousd*10,
    maximumAdmissionsPerActor:5,windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[reviewedTemplate],resources},eligibleActorUserIds:[actor],issuerUserIds:[actor]};
  const approvalTerms=await compileSponsorApprovalProposal(proposal),approvalCommand={action:'approve-sponsor-campaign',approvalId:'fixture-story-approval',proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:reviewedTermsDigest??approvalTerms.termsDigest};
  const approval=await approveSponsorCampaign(new Request('http://localhost/__fixture/story-approval',post(approvalCommand,headers(payer))),f.env),policy=approval.policy;
  const {preflightExpiresAtMs,...native}=description;
  const envelope={version:4,family:'canonical-short-story@1',campaignId,policyVersion:policy.policyVersion,consumptionId:'fixture-story-consumption',intentKey:command.clientMutationId,payerUserId:payer,...native,
    templateDigest:await digest(reviewedTemplate),issuedAtMs:now,expiresAtMs:Math.min(now+600_000,preflightExpiresAtMs)};
  const compiled=await compileSponsorEnvelope(policy,envelope),grantId='fixture-story-issued';
  const resource=await prepareSponsorResourcePlan({limits:resources,campaignId,policyDigest:compiled.policyDigest,actorUserId:actor,sessionDigest:native.sessionDigest,
    intentKey:command.clientMutationId,operation:'issuance',payloadDigest:compiled.envelopeDigest,textBytes:new TextEncoder().encode(canonicalJson(trusted.context.snapshot)).byteLength,resourceId:'fixture-story-resource',issuedGrantId:grantId});
  await f.env.DB.batch([
    f.env.DB.prepare('INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)')
      .bind(grantId,campaignId,compiled.policyDigest,actor,native.sessionDigest,command.clientMutationId,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs),
    ...resource.statements.map(statement=>f.env.DB.prepare(statement.sql).bind(...statement.bindings)),
    f.env.DB.prepare('INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(grantId,campaignId,actor,command.clientMutationId,compiled.policyDigest,canonicalJson({fixture:'explicit-story-issuance',documentId}),await digest(command),compiled.envelopeDigest,compiled.envelopeJson),
  ]);
  const authority=await createSponsorAdmissionAuthority({trusted,command,policy,envelope,grantId});
  Object.assign(f,{documentId,terms,command,request,trusted,send,ok,policy,envelope,grantId,compiled,authority,limits});
  f.execute=(seal=authority,body=command,tr=trusted)=>outputExperienceCommands.executeSponsored(tr,body,seal,outputDocumentExecutionBridge,context);
  return f;
  };
  if(sponsor)await f.sponsor();
  return f;
}
async function freshRun(f,{command}={}){
  const grant=await f.env.DB.prepare('SELECT * FROM output_execution_grants').first();assert.ok(grant);
  const body=command??{documentId:f.documentId,action:'run',expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:'story-sponsored-run',grantId:grant.grant_id};
  const request=new Request(`http://localhost${BASE}`,post(body)),trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const authority=await createSponsorExecutionAuthority(trusted,body),job=await f.env.DB.prepare('SELECT * FROM document_jobs').first();
  return {request,trusted,command:body,authority,jobId:job.job_id,
    queue:()=>outputExperienceCommands.executeSponsoredRun(trusted,body,authority,outputDocumentExecutionBridge,context),
    drive:()=>runDocumentJob(f.env,trusted.principal,job.job_id,undefined,authority)};
}
const syntheticStory=Array(50).fill('Mira carried the clock home while the last train passed beyond the river.').join(' ');
assert.equal(syntheticStory.split(/\s+/u).length,650);
function transport(t,{afterDispatch,localFetch}={}){
  const calls=[],unexpected=[];t.after(()=>assert.deepEqual(unexpected,[],'No unexpected network attempt may be swallowed by the worker'));
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    let endpoint;try{endpoint=new URL(url instanceof Request?url.url:String(url));}catch{unexpected.push('invalid-url');assert.fail('Invalid network destination');}
    if(localFetch&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))return localFetch(url,request);
    if(String(url)!=='https://api.openai.com/v1/responses'||request?.method!=='POST')unexpected.push({url:String(url),method:request?.method});
    assert.equal(String(url),'https://api.openai.com/v1/responses','Every other endpoint is prohibited');assert.equal(request.method,'POST');
    const body=JSON.parse(request.body);calls.push({url:String(url),body,clientRequestId:request.headers['X-Client-Request-Id']});
    assert.equal(body.model,'gpt-5.6-terra');assert.equal(body.text.format.name,'document_short_story');assert.equal(body.text.format.strict,true);
    assert.equal(body.max_output_tokens,6000);assert.equal(body.store,false);assert.deepEqual(body.prompt_cache_options,{mode:'explicit'});assert.deepEqual(body.reasoning,{effort:'low'});
    if(afterDispatch)await afterDispatch();
    return Response.json({id:'synthetic-sponsored-story-response',status:'completed',model:'gpt-5.6-terra',
      output_text:JSON.stringify({title:'The Returned Clock',summary:'Mira returns a lost clock.',content_markdown:syntheticStory,items:Array.from({length:3},(_,index)=>({title:`Part ${index+1}`,body:'Mira returned the clock.',notes:'',image_prompt:'',context_group_ids:[]}))}),
      usage:{input_tokens:120,output_tokens:80,total_tokens:200}},{headers:{'x-request-id':'synthetic-sponsored-story-request'}});
  });
  return calls;
}
function assertPayerSettlement(f,expectedTokens=200){
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();assert.equal(calls.length,1);assert.equal(calls[0].stage_key,'planning:0:initial');assert.equal(calls[0].status,'settled');
  const tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get(),cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();
  for(const reservation of [tokens,cost]){assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);assert.equal(reservation.status,'settled');assert.equal(reservation.operation,'document-render:short_story');}
  assert.equal(tokens.used_tokens,expectedTokens);assert.equal(cost.used_microusd,calls[0].used_microusd);assert.ok(cost.used_microusd>0);assert.equal(cost.allow_user_overage,0);
  assert.equal(f.sqlite.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_tokens,expectedTokens);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_microusd,cost.used_microusd);
  for(const [scope,id] of [['user',payer],['workspace','forma']]){
    const tokens=f.sqlite.prepare('SELECT reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?').get(scope,id),cost=f.sqlite.prepare('SELECT reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?').get(scope,id);
    assert.equal(tokens.reserved_tokens,0);assert.equal(cost.reserved_microusd,0);
  }
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);
}

export {fixture,freshRun,transport,rows,finances,actorCounters,count,assertPayerSettlement,actor,payer,stream,context,headers,post,originalFetch,
  createSponsorAdmissionAuthority,createSponsorExecutionAuthority,readSponsorFinancialBinding,sponsorFinancialIdentity,outputExperienceCommands,outputDocumentExecutionBridge,
  runDocumentJob,handleDocumentJobs,loadOutputJobBinding,reconcileExpiredOutputAuthorizations,handleEventPrivacy,revokeSponsorCampaign,handleEvents,createOutputEventExecution,sponsorFinancialEventProfile,compileSponsorApprovalProposal};

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {snapshot,outputFor} from './output-presentation-fixtures.mjs';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},
  {handleOutputRequirements,loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {createExperienceOutputRecipe},{PRESENTATION_ADAPTER_VERSION},{OUTPUT_NATIVE_EXECUTION_POLICY},
  {estimateOpenAITextCallMaximumMicrousd},{describeSponsorSlidesAdmission},
  {createSponsorAdmissionAuthority},{compileSponsorEnvelope},{SPONSOR_ENTITLEMENT_SCHEMA},
  {SPONSOR_RESOURCE_SCHEMA,prepareSponsorResourcePlan},{SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign,revokeSponsorCampaign,loadApprovedSponsorSlidesCampaign},
  {SPONSOR_ISSUER_SCHEMA},{createSponsorExecutionAuthority,readSponsorFinancialBinding,sponsorFinancialIdentity,sponsorFinancialEventProfile},
  {runDocumentJob,handleDocumentJobs},{loadOutputJobBinding,reconcileExpiredOutputAuthorizations,createOutputEventExecution},
  {handleEventPrivacy},{canonicalJson,digest}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-output-recipe.ts'),import('../worker/openai-adapter.ts'),import('../src/model/output-execution-policy.ts'),
  import('../worker/openai-text-cost.ts'),import('../worker/experience-sponsor-slides-evidence.ts'),
  import('../worker/experience-sponsor-admission.ts'),import('../worker/experience-sponsor-policy.ts'),import('../worker/experience-sponsor-entitlement.ts'),
  import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),import('../worker/experience-sponsor-issuer.ts'),
  import('../worker/experience-sponsor-execution.ts'),import('../worker/document-jobs-api.ts'),import('../worker/output-execution-control.ts'),
  import('../worker/privacy-api.ts'),import('../src/experiences/compiler.ts'),
]);
// All identities, approvals, grants and ledgers belong to one disposable SQLite
// fixture. No route/schema is enabled, no real provider is contacted and every
// response below is synthetic. The immutable issuance is explicit fixture setup:
// this suite does not claim that the separate Slides issuer/driver exists yet.
const actor='dev-local-creative',payer='fixture-slides-sponsor',stream=`creative:${actor}`,BASE='/api/output-requirements';
let detachedAttempts=0;
const context={waitUntil(){detachedAttempts++;throw Error('No detached work permitted');}};
const headers=id=>({'oai-authenticated-user-id':id,'oai-authenticated-user-email':`${id}@example.invalid`});
const post=(body,auth={})=>({method:'POST',headers:{'content-type':'application/json',...auth},body:JSON.stringify(body)});
const originalFetch=globalThis.fetch;
const tableNames=['events','event_private_payloads','output_commands','output_execution_grants','output_operation_slots','document_jobs',
  'budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters','experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls'];
const rows=f=>Object.fromEntries(tableNames.map(name=>[name,f.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const finances=f=>Object.fromEntries(['budget_reservations','cost_budget_reservations','budget_counters','cost_budget_counters','experience_sponsor_consumptions','experience_sponsor_active_jobs','output_provider_calls'].map(name=>[name,f.sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
const actorCounters=f=>Object.fromEntries(['budget_counters','cost_budget_counters'].map(name=>[name,f.sqlite.prepare(`SELECT * FROM ${name} WHERE scope='user' AND scope_id=? ORDER BY rowid`).all(actor)]));
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const exactFive={kind:'exact',unit:'slide',value:5};
function template(recipe,offered){
  const calls=offered.settings.calls.map((call,index)=>({stage:call.stage,provider:'openai',model:call.model,optional:index===1,
    presentationRoute:structuredClone(call.presentationRoute),maximumInputTokens:121500,maximumOutputTokens:6500,
    maximumMicrousd:Math.max(500000,estimateOpenAITextCallMaximumMicrousd(call.model,121500,6500))}));
  return {version:1,family:'canonical-five-slide-deck@1',appId:'slides',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,
    outputKind:'slides',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,slideCountPolicy:exactFive,
    route:'document-slides-manual-v1',maximumCalls:2,maximumTokens:128000,maximumMicrousd:calls.reduce((sum,call)=>sum+call.maximumMicrousd,0),
    calls,adapterVersion:PRESENTATION_ADAPTER_VERSION,sourceContractVersion:2,executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};
}
async function fixture(t,{strict=false,sponsor=true}={}){
  const detachedBefore=detachedAttempts;t.after(()=>assert.equal(detachedAttempts,detachedBefore));
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_SLIDES_COMPOSITION_MODEL:'gpt-5.6-terra',OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:'low',OPENAI_SLIDES_REPAIR_MODEL:'gpt-5.6-sol',OPENAI_SLIDES_REPAIR_REASONING_EFFORT:'medium'});
  f.io={media:0,assets:0};
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{f.io.media++;throw Error('No media I/O in native Slides qualification');};
  f.env.ASSETS.fetch=()=>{f.io.assets++;throw Error('No assets I/O in native Slides qualification');};
  t.after(()=>assert.deepEqual(f.io,{media:0,assets:0}));
  for(const auth of [{},headers(payer)])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:auth}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  const documentId='sponsor-native-slides';
  await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Synthetic sponsored slides'});
  for(const [index,fact] of snapshot(5).facts.filter(fact=>String(fact.type).toLowerCase()!=='output').entries())
    await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:fact.block_id,type:fact.type,handle:fact.block_id,position:String(index),properties:{...fact.properties,weight:1,...(fact.intent?{intent:fact.intent}:{})}});
  let sequence=0;
  const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,post({documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`setup-${++sequence}`,...body})),f.env,BASE,context,outputDocumentExecutionBridge);
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const recipe=createExperienceOutputRecipe({output:'slides',requirementId:'slides-requirement',deliverableId:'slides-deliverable'});
  await ok(await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec}));
  const confirmed=await ok(await send({action:'confirm'}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
  const preflight=await ok(await send({action:'preflight',planRevisionId:confirmed.command.planRevisionId,targetIds:confirmed.snapshot.confirmedPlan.plan.targets.map(target=>target.id)}));
  const terms=preflight.command.preflight;assert.ok(terms.targets.every(target=>target.available),JSON.stringify(terms));
  const command={documentId,action:'authorize',expectedRevision:preflight.snapshot.revision,clientMutationId:'slides-sponsored-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
  const request=new Request(`http://localhost${BASE}`,post(command)),trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  const limits=strict?enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}}):null;
  if(limits)t.after(()=>limits.restore());
  Object.assign(f,{documentId,terms,command,request,trusted,send,ok,limits});
  f.sponsor=async({reviewedTermsDigest}={})=>{
  const trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  const description=await describeSponsorSlidesAdmission(trusted,command),reviewedTemplate=template(description.recipe,terms.targets[0]);
  const now=(await f.env.DB.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now").first()).now,campaignId='fixture-slides-campaign';
  const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,maximumPendingGrants:10,maximumInflightJobs:1};
  const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
  const proposal={policy:{version:5,family:'canonical-five-slide-deck@1',mode:'candidate',campaignId,policyVersion:'slides-fixture@1',payerUserId:payer,audience:'canonical-principal',
    startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,maximumAdmissions:10,maximumMicrousd:reviewedTemplate.maximumMicrousd*10,
    maximumAdmissionsPerActor:5,windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[reviewedTemplate],resources},eligibleActorUserIds:[actor],issuerUserIds:[actor]};
  const approvalTerms=await compileSponsorApprovalProposal(proposal),approvalCommand={action:'approve-sponsor-campaign',approvalId:'fixture-slides-approval',proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:reviewedTermsDigest??approvalTerms.termsDigest};
  const approval=await approveSponsorCampaign(new Request('http://localhost/__fixture/slides-approval',post(approvalCommand,headers(payer))),f.env),policy=approval.policy;
  const loaded=await loadApprovedSponsorSlidesCampaign(new Request('http://localhost/__fixture/slides-approved'),f.env,campaignId);
  assert.equal(loaded.actor.userId,actor);assert.deepEqual(loaded.policy,policy);
  const {preflightExpiresAtMs,...native}=description;
  const envelope={version:5,family:'canonical-five-slide-deck@1',campaignId,policyVersion:policy.policyVersion,consumptionId:'fixture-slides-consumption',intentKey:command.clientMutationId,payerUserId:payer,...native,
    templateDigest:await digest(reviewedTemplate),issuedAtMs:now,expiresAtMs:Math.min(now+600_000,preflightExpiresAtMs)};
  const compiled=await compileSponsorEnvelope(policy,envelope),grantId='fixture-slides-issued';
  const resource=await prepareSponsorResourcePlan({limits:resources,campaignId,policyDigest:compiled.policyDigest,actorUserId:actor,sessionDigest:native.sessionDigest,
    intentKey:command.clientMutationId,operation:'issuance',payloadDigest:compiled.envelopeDigest,textBytes:new TextEncoder().encode(canonicalJson(trusted.context.snapshot)).byteLength,resourceId:'fixture-slides-resource',issuedGrantId:grantId});
  await f.env.DB.batch([
    f.env.DB.prepare('INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)')
      .bind(grantId,campaignId,compiled.policyDigest,actor,native.sessionDigest,command.clientMutationId,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs),
    ...resource.statements.map(statement=>f.env.DB.prepare(statement.sql).bind(...statement.bindings)),
    f.env.DB.prepare('INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(grantId,campaignId,actor,command.clientMutationId,compiled.policyDigest,canonicalJson({fixture:'explicit-slides-issuance',documentId}),await digest(command),compiled.envelopeDigest,compiled.envelopeJson),
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
  const body=command??{documentId:f.documentId,action:'run',expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:'slides-sponsored-run',grantId:grant.grant_id};
  const request=new Request(`http://localhost${BASE}`,post(body)),trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const authority=await createSponsorExecutionAuthority(trusted,body),job=await f.env.DB.prepare('SELECT * FROM document_jobs').first();
  return {request,trusted,command:body,authority,jobId:job.job_id,
    queue:()=>outputExperienceCommands.executeSponsoredRun(trusted,body,authority,outputDocumentExecutionBridge,context),
    drive:()=>runDocumentJob(f.env,trusted.principal,job.job_id,undefined,authority)};
}
const requestSha=value=>createHash('sha256').update(value).digest('hex');
function transport(t,{afterDispatch,localFetch,repairAtCall,usageAtCall,throwAtCall}={}){
  const calls=[],unexpected=[],failures=[];
  t.after(()=>assert.deepEqual(failures,[],'No transport or dispatch assertion failure may be swallowed'));
  t.after(()=>assert.deepEqual(unexpected,[],'No unexpected network attempt may be swallowed by the worker'));
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    let endpoint;try{endpoint=new URL(url instanceof Request?url.url:String(url));}catch{unexpected.push('invalid-url');assert.fail('Invalid network destination');}
    if(localFetch&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))return localFetch(url,request);
    if(String(url)!=='https://api.openai.com/v1/responses'||request?.method!=='POST')unexpected.push({url:String(url),method:request?.method});
    assert.equal(String(url),'https://api.openai.com/v1/responses','Every other endpoint is prohibited');assert.equal(request.method,'POST');
    let call,body,number,responseId;
    try{
    const requestBody=request.body;body=JSON.parse(requestBody);number=calls.length+1;const isRepair=body.text.format.name==='document_slides_repair';
    responseId=`synthetic-sponsored-slides-response-${number}`;
    call={url:String(url),body,requestBody,requestDigest:requestSha(requestBody),clientRequestId:request.headers['X-Client-Request-Id'],stage:isRepair?'planning:0:repair':'planning:0:initial',responseId};calls.push(call);
    assert.equal(body.model,isRepair?'gpt-5.6-sol':'gpt-5.6-terra');assert.equal(body.text.format.name,isRepair?'document_slides_repair':'document_slides');assert.equal(body.text.format.strict,true);
    assert.equal(body.text.format.schema.properties.items.minItems,5);assert.equal(body.text.format.schema.properties.items.maxItems,5);
    assert.equal(body.max_output_tokens,6500);assert.equal(body.store,false);assert.equal(body.service_tier,'default');
    assert.deepEqual(body.prompt_cache_options,{mode:'explicit'});assert.deepEqual(body.reasoning,{effort:isRepair?'medium':'low'});
    if(afterDispatch)await afterDispatch(call,number);
    }catch(error){failures.push(String(error));throw error;}
    if(throwAtCall===number)throw Error('Synthetic transport acknowledgement loss');
    const response=outputFor(5);
    response.items.forEach((item,index)=>{item.slide.kicker=['Pear trees','Shelf marks','Wooden hulls','Tactile atlases','Native grasses'][index];});
    response.content_markdown=response.items.map(item=>`## ${item.title}\n${item.slide.kicker}\n${item.body}\n${item.slide.visual.value}`).join('\n\n');
    if(repairAtCall===number)response.items=[];
    const usage=usageAtCall?.(number)??{input_tokens:120,output_tokens:80,total_tokens:200};
    call.usage=structuredClone(usage);
    return Response.json({id:responseId,status:'completed',model:body.model,service_tier:'default',output_text:JSON.stringify(response),usage},{headers:{'x-request-id':`synthetic-sponsored-slides-request-${number}`}});
  });
  return calls;
}
function assertRuntimeCalls(f,calls){
  const paid=f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY rowid').all();assert.equal(paid.length,calls.length);
  for(const [index,call] of calls.entries()){
    const row=paid[index],quote=f.terms.targets[0].settings.calls.find(quoted=>quoted.stage===call.stage);assert.ok(quote);
    assert.equal(row.stage_key,call.stage);assert.equal(row.client_request_id,call.clientRequestId);assert.equal(row.request_digest,requestSha(call.requestBody));
    assert.equal(row.provider,'openai');assert.equal(row.model,call.body.model);assert.equal(row.status,'settled');
    assert.equal(row.provider_response_id,call.responseId);
    const submission=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json).providerSubmissions[call.clientRequestId];
    assert.equal(submission.requestDigest,row.request_digest);assert.equal(submission.providerRequestId,call.responseId);assert.equal(submission.unitId,call.stage);
    assert.equal(submission.routingPhase,index===0?'composition':'validation-repair');assert.equal(submission.routingVersion,quote.presentationRoute.routingVersion);assert.equal(submission.pricingVersion,quote.presentationRoute.pricingVersion);
    assert.equal(submission.cachePolicy,'disabled-explicit');assert.equal(submission.serviceTier,'default');assert.equal(submission.maximumOutputTokens,6500);
    const expectedMicrousd=call.usage.input_tokens*(call.body.model==='gpt-5.6-terra'?2:4)+call.usage.output_tokens*(call.body.model==='gpt-5.6-terra'?12:20);
    assert.equal(row.used_microusd,expectedMicrousd);assert.equal(submission.costMicrousd,expectedMicrousd);
    assert.equal(submission.model,row.model);assert.equal(submission.inputTokens,call.usage.input_tokens);assert.equal(submission.outputTokens,call.usage.output_tokens);
    assert.equal(call.body.model,quote.presentationRoute.model);assert.deepEqual(call.body.reasoning,{effort:quote.presentationRoute.reasoningEffort});
    assert.equal(call.body.service_tier,quote.presentationRoute.serviceTier);assert.equal(quote.presentationRoute.cachePolicy,'disabled-explicit');
    assert.ok(new TextEncoder().encode(call.requestBody).byteLength+4096<=quote.maximumInputTokens);assert.equal(row.reserved_microusd,quote.maximumMicrousd);
    assert.equal(call.body.max_output_tokens,quote.maximumOutputTokens);assert.equal(quote.presentationRoute.pricingVersion,'openai-text-2026-09-02');
    assert.equal(call.body.text.format.schema.properties.items.minItems,5);assert.equal(call.body.text.format.schema.properties.items.maxItems,5);
    const input=JSON.parse(call.body.input);assert.deepEqual(input.presentation_source.slideCountPolicy,exactFive);
  }
  assert.equal(new Set(calls.map(call=>call.clientRequestId)).size,calls.length);
}
function assertPayerSettlement(f,expectedTokens=200,expectedCalls=1){
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY rowid').all();assert.equal(calls.length,expectedCalls);
  assert.deepEqual(calls.map(call=>call.stage_key),['planning:0:initial','planning:0:repair'].slice(0,expectedCalls));assert.ok(calls.every(call=>call.status==='settled'));
  const tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get(),cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();
  for(const reservation of [tokens,cost]){assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);assert.equal(reservation.status,'settled');assert.equal(reservation.operation,'document-render:slides');}
  assert.equal(tokens.used_tokens,expectedTokens);assert.equal(cost.used_microusd,calls.reduce((sum,call)=>sum+call.used_microusd,0));assert.ok(cost.used_microusd>0);assert.equal(cost.allow_user_overage,0);
  assert.equal(f.sqlite.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_tokens,expectedTokens);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_microusd,cost.used_microusd);
  for(const [scope,id] of [['user',payer],['workspace','forma']]){
    assert.equal(f.sqlite.prepare('SELECT reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?').get(scope,id).reserved_tokens,0);
    assert.equal(f.sqlite.prepare('SELECT reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?').get(scope,id).reserved_microusd,0);
  }
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);
}
const all=f=>Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
export {fixture,freshRun,transport,rows,all,finances,actorCounters,count,assertPayerSettlement,assertRuntimeCalls,requestSha,actor,payer,stream,context,headers,post,originalFetch,
  createSponsorAdmissionAuthority,createSponsorExecutionAuthority,readSponsorFinancialBinding,sponsorFinancialIdentity,outputExperienceCommands,outputDocumentExecutionBridge,
  runDocumentJob,handleDocumentJobs,loadOutputJobBinding,reconcileExpiredOutputAuthorizations,handleEventPrivacy,revokeSponsorCampaign,handleEvents,createOutputEventExecution,sponsorFinancialEventProfile,compileSponsorApprovalProposal,loadApprovedSponsorSlidesCampaign};

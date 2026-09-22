import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readLocalMigrations} from '../scripts/lib/local-migrations.mjs';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{ensureSchema,streamHead},
  {handleOutputRequirements,loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {SCENE_OUTPUT_POLICY},{OUTPUT_NATIVE_EXECUTION_POLICY},
  {OPENAI_TEXT_PRICING_VERSION},{describeSponsorSceneAdmission},
  {createSponsorAdmissionAuthority},{compileSponsorEnvelope},{SPONSOR_ENTITLEMENT_SCHEMA},
  {SPONSOR_RESOURCE_SCHEMA,prepareSponsorResourcePlan},{SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign,revokeSponsorCampaign},
  {SPONSOR_ISSUER_SCHEMA},{createSponsorExecutionAuthority,readSponsorFinancialBinding,sponsorFinancialIdentity,sponsorFinancialEventProfile},
  {runDocumentJob,handleDocumentJobs},{loadOutputJobBinding,reconcileExpiredOutputAuthorizations,createOutputEventExecution},
  {handleEventPrivacy},{canonicalJson,digest}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../src/model/output-scene-contract.ts'),import('../src/model/output-execution-policy.ts'),
  import('../worker/openai-text-cost.ts'),import('../worker/experience-sponsor-scene-evidence.ts'),
  import('../worker/experience-sponsor-admission.ts'),import('../worker/experience-sponsor-policy.ts'),import('../worker/experience-sponsor-entitlement.ts'),
  import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),import('../worker/experience-sponsor-issuer.ts'),
  import('../worker/experience-sponsor-execution.ts'),import('../worker/document-jobs-api.ts'),import('../worker/output-execution-control.ts'),
  import('../worker/privacy-api.ts'),import('../src/experiences/compiler.ts'),
]);
// All identities, approvals, grants and ledgers belong to one disposable SQLite
// fixture. No production route/schema is enabled, no real provider is contacted and every
// response below is synthetic. The immutable issuance is explicit fixture setup:
// this suite does not claim that the separate Scene issuer/driver exists yet.
const actor='dev-local-creative',payer='fixture-scene-sponsor',stream=`creative:${actor}`,BASE='/api/output-requirements';
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
const metadataSqlSha='87984dc31fc80df29511e79e97c2d1f59ce7e1c5324781951a3cb486f96d1a41';
function strictSceneSql(f){
  // Historical workerd qualification covers only this exact 56-argument SQL.
  // Current journeys assert zero exceptions; never reseal changed query bytes.
  const original=f.env.DB.prepare;
  const strict=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}}),strictPrepare=f.env.DB.prepare;
  const nativeEnv={DB:{prepare:original}},native=enforceD1ExpressionDepth({env:nativeEnv,sqlite:f.sqlite},{queryLimits:{functionArguments:56,parameters:100,sqlBytes:100000}});
  let exceptions=0;
  f.env.DB.prepare=function(sql){
    if(createHash('sha256').update(sql).digest('hex')===metadataSqlSha){exceptions++;return nativeEnv.DB.prepare(sql);}
    return strictPrepare.call(this,sql);
  };
  return {records:strict.records,nativeRecords:native.records,boundCounts:strict.boundCounts,
    assertVerified(){strict.assertVerified();if(exceptions)native.assertVerified();assert.ok(native.records.every(record=>createHash('sha256').update(record.sql).digest('hex')===metadataSqlSha));},
    get exceptions(){return exceptions;},restore(){strict.restore();native.restore();}};
}
function captureSql(f,path,t){
  if(!path)return;
  const entries=[],prepare=f.sqlite.prepare.bind(f.sqlite),exec=f.sqlite.exec.bind(f.sqlite);
  f.sqlite.exec=sql=>{const entry={kind:'exec',sql};entries.push(entry);try{return exec(sql);}catch(error){entry.error=error.message;throw error;}};
  f.sqlite.prepare=sql=>{const statement=prepare(sql);return new Proxy(statement,{get(target,key){const value=target[key];
    if(['all','get','run'].includes(key))return(...bindings)=>{const entry={kind:key,sql,bindings};entries.push(entry);try{const result=value.apply(target,bindings);entry.rows=Array.isArray(result)?result.length:undefined;return result;}catch(error){entry.error=error.message;throw error;}};
    return typeof value==='function'?value.bind(target):value;}});};
  t.after(()=>writeFileSync(path,JSON.stringify({format:'scene-native-synthetic-sql-trace@1',scope:'Ordered disposable SQLite operations, not a D1 acceptance claim',entries},(_,value)=>typeof value==='bigint'?Number(value):value,2)));
  f.sqlTrace=entries;
}
function template(recipe){return {version:1,family:'canonical-scene-screenplay@1',appId:'scene',recipeVersion:recipe.recipeVersion,releaseDigest:recipe.releaseDigest,
  outputKind:'scene',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,route:'document-scene-screenplay-manual-v1',maximumCalls:1,maximumTokens:128000,
  maximumInputTokens:125000,maximumOutputTokens:3000,maximumMicrousd:1000000,
  call:{stage:'planning:0:initial',provider:'openai',model:'gpt-5.6-terra'},scenePolicy:SCENE_OUTPUT_POLICY,pricingVersion:OPENAI_TEXT_PRICING_VERSION,
  cachePolicy:'disabled-explicit',reasoningEffort:'low',executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY};}
const [{handleExperienceIntake},{handleExperienceOutput},{registeredExperience,initialValues},{requireSceneSponsorAdmissionForEvidence}]=await Promise.all([
  import('../worker/experience-intake-api.ts'),import('../worker/experience-output-api.ts'),import('../src/experiences/intake.ts'),import('../worker/output-scene-sponsored-handoff.ts'),
]);
async function fixture(t,{strict=false,sponsor=true,controller=new AbortController()}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'});
  captureSql(f,process.env.FORMA_SCENE_SQL_TRACE,t);
  for(const auth of [{},headers(payer)])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:auth}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  await ensureSchema(f.env);
  for(const migration of readLocalMigrations(new URL('../drizzle/',import.meta.url)).filter(value=>value.tag==='0038_scene_source_generations'))
    for(const sql of migration.sql.split('--> statement-breakpoint'))if(sql.trim())f.sqlite.exec(sql);
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const release=await registeredExperience('scene');
  const intent={intentId:'00000000-0000-4000-8000-000000000097',experienceId:'scene',releaseHash:release.releaseHash,
    values:{...initialValues(release),...Object.fromEntries(Object.entries({characterA:'Alex',characterB:'Sam',goalA:'Stay',goalB:'Leave',secret:'The key is outside',location:'Waiting room'})
      .map(([key,value])=>[key,{value,provenance:'authored'}]))}};
  const saved=await ok(await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intent)),f.env));
  const {documentId,draftId,draftHash}=saved.plan;
  await ok(await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${draftId}/commit`,post({draftHash})),f.env));
  const ready=await ok(await handleExperienceOutput(new Request(`http://localhost/api/experiences/drafts/${draftId}/output/prepare`,post({draftHash,explicitRequirementsConfirmation:true})),f.env,context,outputDocumentExecutionBridge));
  const terms=ready.preflight;
  let sequence=0;
  const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,post({documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`setup-${++sequence}`,...body})),f.env,BASE,context,outputDocumentExecutionBridge);
  const command={documentId,action:'authorize',expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:'scene-sponsored-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true,sceneCostConsent:{...ready.sceneCostPreview,confirmed:true}};
  const request=new Request(`http://localhost${BASE}`,{...post(command),signal:controller.signal}),trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  f.controller=controller;f.ready=ready;
  f.io={assets:[],unexpected:[]};
  f.env.ASSETS.fetch=async request=>{const path=new URL(request.url).pathname;f.io.assets.push(path);assert.equal(path,'/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf');return new Response(readFileSync(new URL('../public/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf',import.meta.url)));};
  for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  f.trace={failedPredicates:[],databaseErrors:[]};
  const originalBatch=f.DB.batch.bind(f.DB);
  f.DB.batch=async statements=>{
    try{
      const results=await originalBatch(statements);
      results.forEach((result,index)=>{if(result.results?.some(row=>row.current===0))f.trace.failedPredicates.push({sql:statements[index].sql,bindings:statements[index].bindings});});
      return results;
    }catch(error){f.trace.databaseErrors.push({message:error.message,stack:error.stack,sql:statements.map(statement=>statement.sql)});throw error;}
  };
  const limits=strict?strictSceneSql(f):null;
  if(limits)t.after(()=>limits.restore());
  Object.assign(f,{documentId,terms,command,request,trusted,send,ok,limits});
  f.sponsor=async({reviewedTermsDigest}={})=>{
  const trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
  const scenePreparation=await outputExperienceCommands.prepareSponsoredSceneAdmission(trusted,command);
  const nativePreflight=await requireSceneSponsorAdmissionForEvidence(scenePreparation,trusted,command);
  const description=await describeSponsorSceneAdmission(trusted,command,nativePreflight),reviewedTemplate=template(description.recipe);
  const now=(await f.env.DB.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now").first()).now,campaignId='fixture-scene-campaign';
  const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,maximumPendingGrants:10,maximumInflightJobs:1};
  const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
  const proposal={policy:{version:6,family:'canonical-scene-screenplay@1',mode:'candidate',campaignId,policyVersion:'scene-fixture@1',payerUserId:payer,audience:'canonical-principal',
    startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,maximumAdmissions:10,maximumMicrousd:reviewedTemplate.maximumMicrousd*10,
    maximumAdmissionsPerActor:5,windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[reviewedTemplate],resources},eligibleActorUserIds:[actor],issuerUserIds:[actor]};
  const approvalTerms=await compileSponsorApprovalProposal(proposal),approvalCommand={action:'approve-sponsor-campaign',approvalId:'fixture-scene-approval',proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:reviewedTermsDigest??approvalTerms.termsDigest};
  const approval=await approveSponsorCampaign(new Request('http://localhost/__fixture/scene-approval',post(approvalCommand,headers(payer))),f.env),policy=approval.policy;
  const {preflightExpiresAtMs,...native}=description;
  const envelope={version:6,family:'canonical-scene-screenplay@1',campaignId,policyVersion:policy.policyVersion,consumptionId:'fixture-scene-consumption',intentKey:command.clientMutationId,payerUserId:payer,...native,
    templateDigest:await digest(reviewedTemplate),issuedAtMs:now,expiresAtMs:Math.min(now+600_000,preflightExpiresAtMs)};
  const compiled=await compileSponsorEnvelope(policy,envelope),grantId='fixture-scene-issued';
  const resource=await prepareSponsorResourcePlan({limits:resources,campaignId,policyDigest:compiled.policyDigest,actorUserId:actor,sessionDigest:native.sessionDigest,
    intentKey:command.clientMutationId,operation:'issuance',payloadDigest:compiled.envelopeDigest,textBytes:new TextEncoder().encode(canonicalJson(trusted.context.snapshot)).byteLength,resourceId:'fixture-scene-resource',issuedGrantId:grantId});
  await f.env.DB.batch([
    f.env.DB.prepare('INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)')
      .bind(grantId,campaignId,compiled.policyDigest,actor,native.sessionDigest,command.clientMutationId,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs),
    ...resource.statements.map(statement=>f.env.DB.prepare(statement.sql).bind(...statement.bindings)),
    f.env.DB.prepare('INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(grantId,campaignId,actor,command.clientMutationId,compiled.policyDigest,canonicalJson({fixture:'explicit-scene-issuance',documentId}),await digest(command),compiled.envelopeDigest,compiled.envelopeJson),
  ]);
  const authority=await createSponsorAdmissionAuthority({trusted,command,policy,envelope,grantId,scenePreparation});
  Object.assign(f,{documentId,terms,command,request,trusted,send,ok,policy,envelope,grantId,compiled,authority,limits,scenePreparation,nativePreflight});
  f.execute=(seal=authority,body=command,tr=trusted)=>outputExperienceCommands.executeSponsored(tr,body,seal,outputDocumentExecutionBridge,context);
  return f;
  };
  if(sponsor)await f.sponsor();
  return f;
}
async function freshRun(f,{command,controller=new AbortController()}={}){
  const grant=await f.env.DB.prepare('SELECT * FROM output_execution_grants').first();assert.ok(grant);
  const body=command??{documentId:f.documentId,action:'run',expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:'scene-sponsored-run',grantId:grant.grant_id};
  const request=new Request(`http://localhost${BASE}`,{...post(body),signal:controller.signal}),trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const scenePreparation=await outputExperienceCommands.prepareSponsoredSceneRun(trusted,body);
  const authority=await createSponsorExecutionAuthority(trusted,body,{scenePreparation}),job=await f.env.DB.prepare('SELECT * FROM document_jobs').first();
  return {request,trusted,command:body,authority,scenePreparation,controller,jobId:job.job_id,
    queue:()=>outputExperienceCommands.executeSponsoredRun(trusted,body,authority,outputDocumentExecutionBridge,context),
    drive:()=>runDocumentJob(f.env,trusted.principal,job.job_id,undefined,authority)};
}
function transport(t,{afterDispatch,missingUsage=false,throwOnDispatch=false}={}){
  const calls=[],unexpected=[],failures=[];t.after(()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(failures,[]);});
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    if(String(url)!=='https://api.openai.com/v1/responses'||request?.method!=='POST'){unexpected.push(String(url));throw Error('Unexpected network attempt');}
    let body;try{
      body=JSON.parse(request.body);calls.push({url:String(url),body,clientRequestId:new Headers(request.headers).get('X-Client-Request-Id')});
      assert.equal(body.model,'gpt-5.6-terra');assert.equal(body.text.format.name,'document_scene');assert.equal(body.text.format.strict,true);
      assert.equal(body.max_output_tokens,3000);assert.equal(body.store,false);assert.deepEqual(body.prompt_cache_options,{mode:'explicit'});assert.deepEqual(body.reasoning,{effort:'low'});
      if(afterDispatch)await afterDispatch(calls.at(-1));
    }catch(error){failures.push(String(error));throw error;}
    if(throwOnDispatch)throw Error('Synthetic Scene transport acknowledgement loss');
    const screenplay={schemaVersion:1,format:'forma-screenplay@1',heading:{setting:'INT.',location:'location',time:'NIGHT'},blocks:[
      {kind:'action',text:'A hand rests against the door.'},{kind:'dialogue',speaker:'A',parenthetical:null,text:'Stay.'},{kind:'dialogue',speaker:'B',parenthetical:null,text:'I have to go.'}]};
    return Response.json({id:'synthetic-sponsored-scene-response',status:'completed',model:body.model,incomplete_details:null,
      output:[{id:'synthetic-scene-message',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({title:'The door',summary:'Two intentions meet.',screenplay})}]}],
      ...(missingUsage?{}:{usage:{input_tokens:100,output_tokens:50,total_tokens:150}})},{headers:{'x-request-id':'synthetic-scene-request'}});
  });return calls;
}
function assertPayerSettlement(f,expectedTokens=150){
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();assert.equal(calls.length,1);assert.equal(calls[0].stage_key,'planning:0:initial');assert.equal(calls[0].status,'settled');
  const tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get(),cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();
  for(const reservation of [tokens,cost]){assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);assert.equal(reservation.status,'settled');assert.equal(reservation.operation,'document-render:scene');}
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

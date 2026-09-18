import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{ensureSchema,streamHead},
  {handleExperienceIntake},{handleExperienceOutput},{registeredExperience},
  {loadOutputTrustedContext,outputExperienceCommands},{outputDocumentExecutionBridge},
  {describeSponsorAudioAdmission,readSponsorAudioTemplateEvidence},{nativeTemplate},
  {createSponsorAdmissionAuthority},{compileSponsorEnvelope},{SPONSOR_ENTITLEMENT_SCHEMA},
  {SPONSOR_RESOURCE_SCHEMA,prepareSponsorResourcePlan},{SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign,revokeSponsorCampaign},
  {SPONSOR_ISSUER_SCHEMA},{createSponsorExecutionAuthority,readSponsorFinancialBinding,sponsorFinancialIdentity,sponsorFinancialEventProfile},
  {runDocumentJob,handleDocumentJobs},{loadOutputJobBinding,reconcileExpiredOutputAuthorizations,createOutputEventExecution,reconcileKnownOutputProviderReceipts},
  {handleEventPrivacy},{canonicalJson,digest},{digestSponsoredAudioReview},{requireAudioSponsorAdmissionForEvidence}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/experience-intake-api.ts'),import('../worker/experience-output-api.ts'),import('../src/experiences/intake.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-sponsor-audio-evidence.ts'),import('./sponsor-audio-evidence-fixture.mjs'),
  import('../worker/experience-sponsor-admission.ts'),import('../worker/experience-sponsor-policy.ts'),import('../worker/experience-sponsor-entitlement.ts'),
  import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),import('../worker/experience-sponsor-issuer.ts'),
  import('../worker/experience-sponsor-execution.ts'),import('../worker/document-jobs-api.ts'),import('../worker/output-execution-control.ts'),
  import('../worker/privacy-api.ts'),import('../src/experiences/compiler.ts'),import('../src/experiences/sponsored-audio-actor-intent.ts'),import('../worker/output-audio-sponsored-handoff.ts'),
]);
// Actual native registered Audio intake/prepare, genuine disposable payer approval,
// supplied actor Request, opaque admission/Run and native Events. Issuance/resource
// rows below are explicit fixture setup, not a public issuer/driver qualification.
// All provider and generated-media bytes are synthetic and every external request
// is intercepted. No real campaign, finance or private asset is touched.
const actor='dev-local-creative',payer='fixture-audio-sponsor',stream=`creative:${actor}`;
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
function captureSql(f,path,t){
  if(!path)return;
  const entries=[],prepare=f.sqlite.prepare.bind(f.sqlite),exec=f.sqlite.exec.bind(f.sqlite);
  f.sqlite.exec=sql=>{const entry={kind:'exec',sql};entries.push(entry);try{return exec(sql);}catch(error){entry.error=error.message;throw error;}};
  f.sqlite.prepare=sql=>{const statement=prepare(sql);return new Proxy(statement,{get(target,key){const value=target[key];
    if(['all','get','run'].includes(key))return(...bindings)=>{const entry={kind:key,sql,bindings};entries.push(entry);try{const result=value.apply(target,bindings);entry.rows=Array.isArray(result)?result.length:undefined;return result;}catch(error){entry.error=error.message;throw error;}};
    return typeof value==='function'?value.bind(target):value;}});};
  t.after(()=>writeFileSync(path,JSON.stringify({format:'audio-v8-native-synthetic-sql-trace@1',scope:'Ordered disposable SQLite operations, not D1 acceptance',entries},(_,value)=>typeof value==='bigint'?Number(value):value,2)));
}
async function fixture(t,{strict=false,sponsor=true,controller=new AbortController(),direction='A rising original instrumental motif, then a quiet finish. 水 — موسيقى'}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',FAL_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'});
  captureSql(f,process.env.FORMA_AUDIO_V8_SQL_TRACE,t);
  for(const auth of [{},headers(payer)])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:auth}),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);await ensureSchema(f.env);
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const release=await registeredExperience('audio');
  const intent={experienceId:'audio',intentId:'00000000-0000-4000-8000-000000000098',releaseHash:release.releaseHash,
    values:{direction:{value:direction,provenance:'authored'},detail:{value:'One sustained ending.',provenance:'authored'}}};
  const saved=await ok(await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intent)),f.env));
  const plan=saved.plan,{documentId,draftId,draftHash}=plan,path=`/api/experiences/drafts/${draftId}/output`;
  await ok(await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${draftId}/commit`,post({draftHash})),f.env));
  const ready=await ok(await handleExperienceOutput(new Request(`http://localhost${path}/prepare`,post({draftHash,explicitRequirementsConfirmation:true})),f.env,context,outputDocumentExecutionBridge));
  const quote=f.sqlite.prepare('SELECT event_id FROM output_preflights ORDER BY created_at DESC LIMIT 1').get();
  const terms=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(quote.event_id).private_json).preflight;
  const command={documentId,action:'authorize',expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:'audio-v8-sponsored-authorize',preflightId:terms.id,
    termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true,audioCostConsent:{...terms.targets[0].settings.costPreview,confirmed:true,providerTransferConfirmed:true}};
  f.io={assets:[],media:[]};f.env.ASSETS.fetch=async request=>{f.io.assets.push(String(request.url));throw Error('Audio must not fetch private or public assets');};
  for(const method of ['get','head','put','delete','list']){const original=f.env.MEDIA[method].bind(f.env.MEDIA);f.env.MEDIA[method]=async(...args)=>{f.io.media.push({method,key:args[0]});return original(...args);};}
  t.after(()=>assert.deepEqual(f.io.assets,[]));
  for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  f.trace={failedPredicates:[],databaseErrors:[]};
  const originalBatch=f.DB.batch.bind(f.DB);
  f.DB.batch=async statements=>{try{const results=await originalBatch(statements);results.forEach((result,index)=>{if(result.results?.some(row=>row.current===0))f.trace.failedPredicates.push({sql:statements[index].sql,bindings:statements[index].bindings});});return results;}
    catch(error){f.trace.databaseErrors.push({message:error.message,stack:error.stack,sql:statements.map(statement=>statement.sql)});throw error;}};
  const limits=strict?enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}}):null;
  if(limits)t.after(()=>limits.restore());
  Object.assign(f,{documentId,draftId,draftHash,plan,path,terms,command,controller,ready,ok,limits});
  f.sponsor=async({reviewedTermsDigest,bodyMutation,reviewMutation}={})=>{
    const descriptionRequest=new Request(`http://localhost${path}/authorize`,{...post(command),signal:controller.signal});
    const descriptionTrusted=await loadOutputTrustedContext(descriptionRequest,f.env,documentId,'request');assert.ok(!(descriptionTrusted instanceof Response));
    const setupDescription=await describeSponsorAudioAdmission(descriptionTrusted,command),actual=await readSponsorAudioTemplateEvidence(descriptionTrusted,command,setupDescription.recipe),reviewedTemplate=await nativeTemplate(actual);
    const now=(await f.env.DB.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now").first()).now,campaignId='fixture-audio-campaign';
    const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,maximumPendingGrants:10,maximumInflightJobs:1};
    const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
    const proposal={policy:{version:8,family:'canonical-instrumental-cue@1',mode:'candidate',campaignId,policyVersion:'audio-fixture@1',payerUserId:payer,audience:'canonical-principal',
      startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,maximumAdmissions:10,maximumMicrousd:reviewedTemplate.maximumMicrousd*10,
      maximumAdmissionsPerActor:5,windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[reviewedTemplate],resources},eligibleActorUserIds:[actor],issuerUserIds:[actor]};
    const approvalTerms=await compileSponsorApprovalProposal(proposal),approvalCommand={action:'approve-sponsor-campaign',approvalId:'fixture-audio-approval',proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:reviewedTermsDigest??approvalTerms.termsDigest};
    const approval=await approveSponsorCampaign(new Request('http://localhost/__fixture/audio-approval',post(approvalCommand,headers(payer))),f.env),policy=approval.policy;
    const review={version:'sponsor-audio-review@1',campaignId,approvalReceiptDigest:policy.approvalReceiptDigest,policyDigest:await digest(policy),templateDigest:await digest(reviewedTemplate),
      payerUserId:payer,actorChargeMicrousd:0,termsDigest:command.termsDigest,preview:structuredClone(terms.targets[0].settings.costPreview),expiresAt:terms.expiresAt};
    if(reviewMutation)reviewMutation(review);
    const body={draftHash,termsDigest:command.termsDigest,maximumMicrousd:command.maximumMicrousd,explicitAuthorization:true,audioCostConsent:structuredClone(command.audioCostConsent),
      sponsorReview:{campaignId,reviewDigest:await digestSponsoredAudioReview(review)}};
    if(bodyMutation)bodyMutation(body);
    const request=new Request(`http://localhost${path}/authorize`,{...post(body),signal:controller.signal});
    const trusted=await loadOutputTrustedContext(request,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
    const audioPreparation=await outputExperienceCommands.prepareSponsoredAudioAdmission(trusted,command,review);
    const {description}=await requireAudioSponsorAdmissionForEvidence(audioPreparation,trusted,command);
    const {preflightExpiresAtMs,...native}=description;
    const envelope={version:8,family:'canonical-instrumental-cue@1',campaignId,policyVersion:policy.policyVersion,consumptionId:'fixture-audio-consumption',intentKey:command.clientMutationId,payerUserId:payer,...native,
      templateDigest:await digest(reviewedTemplate),issuedAtMs:now,expiresAtMs:Math.min(now+600_000,preflightExpiresAtMs),
      audioActorRequestDigest:await digest(body),audioSponsorReviewDigest:await digestSponsoredAudioReview(review),originalRequestId:review.preview.requestId,originalExpiresAtMs:Date.parse(review.preview.expiresAt)};
    const compiled=await compileSponsorEnvelope(policy,envelope),grantId='fixture-audio-issued';
    const resource=await prepareSponsorResourcePlan({limits:resources,campaignId,policyDigest:compiled.policyDigest,actorUserId:actor,sessionDigest:native.sessionDigest,
      intentKey:command.clientMutationId,operation:'issuance',payloadDigest:compiled.envelopeDigest,textBytes:new TextEncoder().encode(canonicalJson(trusted.context.snapshot)).byteLength,resourceId:'fixture-audio-resource',issuedGrantId:grantId});
    await f.env.DB.batch([
      f.env.DB.prepare('INSERT INTO experience_sponsor_grants(grant_id,campaign_id,policy_digest,actor_user_id,session_digest,intent_key,envelope_digest,issued_at_ms,expires_at_ms,enabled) VALUES(?,?,?,?,?,?,?,?,?,1)')
        .bind(grantId,campaignId,compiled.policyDigest,actor,native.sessionDigest,command.clientMutationId,compiled.envelopeDigest,envelope.issuedAtMs,envelope.expiresAtMs),
      ...resource.statements.map(statement=>f.env.DB.prepare(statement.sql).bind(...statement.bindings)),
      f.env.DB.prepare('INSERT INTO experience_sponsor_issuances(grant_id,campaign_id,actor_user_id,intent_key,policy_digest,driver_command_json,command_digest,envelope_digest,envelope_json) VALUES(?,?,?,?,?,?,?,?,?)')
        .bind(grantId,campaignId,actor,command.clientMutationId,compiled.policyDigest,canonicalJson({fixture:'explicit-audio-issuance',documentId}),await digest(command),compiled.envelopeDigest,compiled.envelopeJson),
    ]);
    const authority=await createSponsorAdmissionAuthority({trusted,command,policy,envelope,grantId,audioPreparation});
    Object.assign(f,{request,trusted,review,body,policy,envelope,grantId,compiled,authority,audioPreparation,description,approvalCommand,approvalTerms});
    f.execute=(seal=authority,body=command,tr=trusted)=>outputExperienceCommands.executeSponsored(tr,body,seal,outputDocumentExecutionBridge,context);
    f.replayAdmission=async()=>{const replayRequest=new Request(request.url,post(body)),replayTrusted=await loadOutputTrustedContext(replayRequest,f.env,documentId,'request');assert.ok(!(replayTrusted instanceof Response));return outputExperienceCommands.readSponsoredAudioAdmissionReplay(replayTrusted,command);};
    return f;
  };
  if(sponsor)await f.sponsor();return f;
}
async function freshRun(f,{command,controller=new AbortController()}={}){
  const grant=await f.env.DB.prepare('SELECT * FROM output_execution_grants').first();assert.ok(grant);
  const body=command??{documentId:f.documentId,action:'run',expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:'audio-v8-sponsored-run',grantId:grant.grant_id};
  const request=new Request('http://localhost/api/output-requirements',{...post(body),signal:controller.signal}),trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response));
  const audioPreparation=await outputExperienceCommands.prepareSponsoredAudioRun(trusted,body);
  const authority=await createSponsorExecutionAuthority(trusted,body,{audioPreparation}),job=await f.env.DB.prepare('SELECT * FROM document_jobs').first();
  return {request,trusted,command:body,authority,audioPreparation,controller,jobId:job.job_id,
    queue:()=>outputExperienceCommands.executeSponsoredRun(trusted,body,authority,outputDocumentExecutionBridge,context),
    drive:()=>runDocumentJob(f.env,trusted.principal,job.job_id,undefined,authority)};
}
const audioModel='fal-ai/stable-audio-3/medium/text-to-audio',providerId='synthetic-sponsored-audio-original',providerBase=`https://queue.fal.run/fal-ai/stable-audio-3/requests/${providerId}`,mediaUrl='https://v3b.fal.media/files/synthetic-original-audio.mp3';
const mediaBytes=new Uint8Array([0x49,0x44,0x33,4,0,0,0,0,0,0,0xff,0xfb,0x90,0x64]);
function transport(t,{repair=false,afterDispatch,afterResponse,missingUsage=false,throwOnDispatch=false,mediaFailure,resultFailure=false,localFetch}={}){
  const calls=[],unexpected=[],failures=[];let plannerCalls=0;
  t.after(()=>{assert.deepEqual(unexpected,[]);assert.deepEqual(failures,[]);});
  t.mock.method(globalThis,'fetch',async(input,request={})=>{
    const url=String(input instanceof Request?input.url:input),method=request.method??(input instanceof Request?input.method:'GET');
    if(localFetch&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))return localFetch(input,request);
    const entry={url,method,requestBody:request.body??null,body:typeof request.body==='string'?JSON.parse(request.body):null,clientRequestId:new Headers(request.headers).get('X-Client-Request-Id')};
    calls.push(entry);
    if(url==='https://api.openai.com/v1/responses'&&method==='POST'){
      entry.provider='openai';entry.stage=plannerCalls++===0?'planning:0:initial':'planning:0:repair';
      try{assert.equal(plannerCalls<=2,true);assert.equal(entry.body.model,'gpt-5.6-terra');assert.equal(entry.body.text.format.name,plannerCalls===1?'document_audio':'document_audio_repair');
        assert.equal(entry.body.text.format.strict,true);assert.equal(entry.body.max_output_tokens,3000);assert.equal(entry.body.store,false);assert.deepEqual(entry.body.prompt_cache_options,{mode:'explicit'});
        assert.equal(Object.hasOwn(entry.body,'tools'),false);assert.equal(Object.hasOwn(entry.body,'audio'),false);if(afterDispatch)await afterDispatch(entry);
      }catch(error){failures.push(String(error));throw error;}
      if(throwOnDispatch==='planner'||throwOnDispatch===true)throw Error('Synthetic Audio planner acknowledgement loss');
      const plan={title:'Quiet rise',summary:'Original instrumental.',content_markdown:'A quiet instrumental piano motif rises over twenty seconds and resolves in a sustained ending.',
        items:[{title:'Original instrumental',body:'A quiet instrumental piano motif rises and settles.',notes:'No singing, vocals or spoken dialogue.',image_prompt:'',context_group_ids:[]}]};
      const response=Response.json({id:`synthetic-audio-planner-${plannerCalls}`,status:'completed',model:entry.body.model,incomplete_details:null,
        output:[{id:`synthetic-audio-message-${plannerCalls}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:repair&&plannerCalls===1?'{}':JSON.stringify(plan)}]}],
        ...(missingUsage?{}:{usage:{input_tokens:100,output_tokens:50,total_tokens:150,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}})},{headers:{'x-request-id':`synthetic-audio-planner-request-${plannerCalls}`}});
      if(afterResponse)await afterResponse(entry);return response;
    }
    if(url===`https://queue.fal.run/${audioModel}`&&method==='POST'){
      entry.provider='fal';entry.stage='audio:initial';
      try{assert.deepEqual(Object.keys(entry.body).sort(),['duration','enable_safety_checker','negative_prompt','output_format','prompt']);assert.equal(entry.body.duration,20);assert.equal(entry.body.output_format,'mp3');assert.equal(entry.body.enable_safety_checker,true);assert.equal(entry.body.negative_prompt,'singing, vocals, spoken dialogue');assert.ok(entry.body.prompt.length>0);if(afterDispatch)await afterDispatch(entry);}catch(error){failures.push(String(error));throw error;}
      if(throwOnDispatch==='media')throw Error('Synthetic Audio media acknowledgement loss');return Response.json({request_id:providerId});
    }
    if(url===providerBase+'/status?logs=1'&&method==='GET')return Response.json({status:'COMPLETED',request_id:providerId});
    if(url===providerBase&&method==='GET'){
      if(resultFailure)throw Error('Synthetic original result temporarily unavailable');
      const response=Response.json({request_id:providerId,audio:{url:mediaUrl,content_type:'audio/mpeg',duration:20,file_size:mediaBytes.length}});if(afterResponse)await afterResponse(entry);return response;
    }
    if(url===mediaUrl&&method==='GET'){
      if(mediaFailure==='timeout')throw Error('Synthetic media download timeout');
      if(mediaFailure==='redirect')return new Response(null,{status:302,headers:{location:'https://outside.invalid/audio.mp3'}});
      if(mediaFailure==='mime')return new Response(mediaBytes,{headers:{'content-type':'video/mp4'}});
      if(mediaFailure==='overflow')return new Response(new Uint8Array(26*1024*1024),{headers:{'content-type':'audio/mpeg'}});
      return new Response(mediaBytes,{headers:{'content-type':'audio/mpeg'}});
    }
    unexpected.push({url,method});throw Error('Unexpected network attempt');
  });return calls;
}
function assertPayerSettlement(f,expectedPlanningCalls=1){
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY stage_key').all();assert.equal(calls.length,expectedPlanningCalls+1);
  assert.deepEqual(calls.map(call=>call.stage_key),expectedPlanningCalls===1?['audio:initial','planning:0:initial']:['audio:initial','planning:0:initial','planning:0:repair']);assert.ok(calls.every(call=>call.status==='settled'));
  const tokens=f.sqlite.prepare('SELECT * FROM budget_reservations').get(),cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations').get();
  for(const reservation of [tokens,cost]){assert.equal(reservation.owner_id,payer);assert.equal(reservation.stream_id,stream);assert.equal(reservation.status,'settled');assert.equal(reservation.operation,'document-render:audio');}
  assert.equal(tokens.used_tokens,150*expectedPlanningCalls);assert.equal(cost.used_microusd,calls.reduce((sum,call)=>sum+call.used_microusd,0));assert.ok(cost.used_microusd>37600);assert.equal(cost.allow_user_overage,0);
  assert.equal(f.sqlite.prepare("SELECT used_tokens FROM budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_tokens,tokens.used_tokens);
  assert.equal(f.sqlite.prepare("SELECT used_microusd FROM cost_budget_counters WHERE scope='user' AND scope_id=?").get(payer).used_microusd,cost.used_microusd);
  for(const [scope,id] of [['user',payer],['workspace','forma']]){assert.equal(f.sqlite.prepare('SELECT reserved_tokens FROM budget_counters WHERE scope=? AND scope_id=?').get(scope,id).reserved_tokens,0);assert.equal(f.sqlite.prepare('SELECT reserved_microusd FROM cost_budget_counters WHERE scope=? AND scope_id=?').get(scope,id).reserved_microusd,0);}
  assert.equal(count(f,'experience_sponsor_consumptions'),1);assert.equal(count(f,'experience_sponsor_active_jobs'),0);
}
const requestHash=value=>createHash('sha256').update(value).digest('hex');
export {fixture,freshRun,transport,rows,finances,actorCounters,count,assertPayerSettlement,actor,payer,stream,context,headers,post,originalFetch,audioModel,providerId,providerBase,mediaUrl,mediaBytes,requestHash,
  createSponsorAdmissionAuthority,createSponsorExecutionAuthority,readSponsorFinancialBinding,sponsorFinancialIdentity,outputExperienceCommands,outputDocumentExecutionBridge,
  runDocumentJob,handleDocumentJobs,loadOutputJobBinding,reconcileExpiredOutputAuthorizations,handleEventPrivacy,revokeSponsorCampaign,handleEvents,createOutputEventExecution,sponsorFinancialEventProfile,compileSponsorApprovalProposal,approveSponsorCampaign,reconcileKnownOutputProviderReceipts};

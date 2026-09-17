import assert from 'node:assert/strict';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
export const sourceImports=registerOutputSourceImports();
export const [{handleSession,POLICY_VERSION},{handleEvents},runtime,{handleExperienceIntake},{handleExperienceOutput},
  {outputDocumentExecutionBridge},{registeredExperience},bindingNative,ledger,policy]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),import('../worker/experience-intake-api.ts'),
  import('../worker/experience-output-api.ts'),import('../worker/output-document-execution.ts'),import('../src/experiences/intake.ts'),
  import('../worker/experience-output-binding.ts'),import('../worker/output-requirements-ledger.ts'),import('../worker/pilot-policy.ts'),
]);
export const actor='dev-local-creative',stream=`creative:${actor}`;
export const observed={network:0,media:0,assets:0,detached:0};
const descriptor=Object.getOwnPropertyDescriptor(globalThis,'fetch');
globalThis.fetch=()=>{observed.network++;throw Error('No external network in Storyboard actor-intent fixture');};
export function closeFixtureImports(){Object.defineProperty(globalThis,'fetch',descriptor);sourceImports.deregister();assert.deepEqual(observed,{network:0,media:0,assets:0,detached:0});}
const execution={waitUntil(){observed.detached++;throw Error('No detached execution');}};
export const post=body=>({method:'POST',headers:{'content-type':'application/json',origin:'http://localhost','sec-fetch-site':'same-origin'},body:JSON.stringify(body)});
export function stateSnapshot(f){const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();return {schema,changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,
  rows:schema.filter(row=>row.type==='table').map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()])};}
export function forbidWrites(f){const database=f.env.DB,prepare=database.prepare.bind(database);let attempts=0;
  database.prepare=sql=>{if(!/^\s*SELECT\b/iu.test(sql)){attempts++;throw Error('Actor intent attempted non-read SQL');}return prepare(sql);};
  return {assert(){assert.equal(attempts,0);},restore(){database.prepare=prepare;}};
}
export function assertNoAdmission(f){for(const name of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,0,name);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'experience_sponsor_%'").get().n,0);
}
export async function storyboardIntentFixture(t){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-only-no-egress',OPENAI_MODEL:'gpt-5.6-terra',FAL_KEY:'synthetic-only-no-egress',FORMA_IMAGE_PROVIDER:'fal'});
  for(const method of ['get','head','put','delete','list'])f.env.MEDIA[method]=()=>{observed.media++;throw Error('No media access');};
  f.env.ASSETS.fetch=()=>{observed.assets++;throw Error('No asset access');};
  assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  const release=await registeredExperience('storyboard');assert.ok(release);
  const intent={experienceId:'storyboard',intentId:'00000000-0000-4000-8000-000000000097',releaseHash:release.releaseHash,values:{
    story:{value:'A lantern is found, lifted, carried home and placed in the window. 灯笼 — فانوس',provenance:'authored'},
    composition:{value:'Four frames, consistent lantern and screen direction, blue dusk and warm light.',provenance:'authored'}}};
  let response=await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intent)),f.env);assert.equal(response.status,200,await response.clone().text());const plan=(await response.json()).plan;
  response=await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/commit`,post({draftHash:plan.draftHash})),f.env);assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');
  const outputPath=`/api/experiences/drafts/${plan.draftId}/output`;
  response=await handleExperienceOutput(new Request('http://localhost'+outputPath+'/prepare',post({draftHash:plan.draftHash,explicitRequirementsConfirmation:true})),f.env,execution,outputDocumentExecutionBridge);
  assert.equal(response.status,200,await response.clone().text());const prepared=await response.json();assert.equal(prepared.permitted.authorize,true);assert.equal(prepared.permitted.run,false);
  const body={draftHash:plan.draftHash,termsDigest:prepared.preflight.termsDigest,maximumMicrousd:prepared.preflight.maximumMicrousd,explicitAuthorization:true};
  const binding=await bindingNative.experienceOutputBinding(plan),head=await runtime.streamHead(f.env,stream);
  const envelope=await bindingNative.experienceOutputEnvelope(binding,'authorize',head,{explicitAuthorization:true,termsDigest:body.termsDigest,maximumMicrousd:body.maximumMicrousd,preflightId:prepared.preflight.id});
  const request=(nextBody=body,init={})=>new Request('http://localhost'+outputPath+'/authorize',{...post(nextBody),...init});
  return {...f,plan,prepared,body,binding,envelope,outputPath,request};
}
export async function authorizeNative(f){const response=await handleExperienceOutput(f.request(),f.env,execution,outputDocumentExecutionBridge);assert.equal(response.status,200,await response.clone().text());const authorized=await response.json();
  const slots=f.sqlite.prepare('SELECT * FROM output_operation_slots').all();assert.equal(slots.length,1);const slot=slots[0];
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_execution_grants').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM budget_reservations').get().n,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n,1);
  assert.equal(slot.maximum_tokens,224000);assert.equal(slot.maximum_calls,5);assert.equal(slot.attempt_ordinal,0);assert.equal(slot.previous_slot_id,null);
  const routes=f.sqlite.prepare('SELECT * FROM output_operation_routes ORDER BY stage_key').all();assert.equal(routes.length,5);assert.ok(routes.every(row=>row.maximum_calls===1));
  const retained=f.sqlite.prepare("SELECT body.private_json,command.request_digest FROM output_commands command JOIN event_private_payloads body ON body.private_event_id=command.event_id WHERE command.action='authorize'").get();
  assert.deepEqual(JSON.parse(retained.private_json).output_command_envelope,f.envelope);
  return {authorized,slot,routes,retained};
}

/** Native HTTP admission/run plus synthetic accounting observations. No planner,
 * frame bytes, native frame-sequence proof or sponsor authority is fabricated.
 * `uncertain` means frame 3 was accepted but its final cost remains unknown. */
export async function exerciseStoryboardPartialAccounting(f,control,outcome){
  assert.ok(['uncertain','rejected'].includes(outcome));
  const [{loadOutputTrustedContext,outputDigest},{prepareOutputProviderFinancialCheckpoint},
    {handleDocumentJobs},{synchronizeOutputJobOutcome}]=await Promise.all([
    import('../worker/output-requirements-api.ts'),import('../worker/output-provider-financial-checkpoint.ts'),
    import('../worker/document-jobs-api.ts'),import('../worker/output-execution-control.ts'),
  ]);
  const slot=control.slot,grantId=slot.grant_id;
  const run=await handleExperienceOutput(new Request('http://localhost'+f.outputPath+'/run',post({draftHash:f.plan.draftHash,grantId,explicitRun:true})),f.env,execution,outputDocumentExecutionBridge);
  assert.equal(run.status,200,await run.clone().text());const running=await run.json();
  assert.equal(running.original.jobId,slot.job_id);assert.equal(running.original.grantId,grantId);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,0);
  const replay=await handleExperienceOutput(f.request(),f.env,execution,outputDocumentExecutionBridge);
  assert.equal(replay.status,200,await replay.clone().text());assert.equal((await replay.json()).original.jobId,slot.job_id);
  for(const name of ['document_jobs','output_execution_grants','output_operation_slots','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,1,name);
  const request=new Request('http://localhost/api/output-requirements',post({documentId:f.plan.documentId}));
  const trusted=await loadOutputTrustedContext(request,f.env,f.plan.documentId,'request');assert.ok(!(trusted instanceof Response));
  assert.equal(trusted.scope.key,slot.scope_key);assert.equal(trusted.sourceDigest,slot.source_digest);
  const job=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(slot.job_id);
  const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(slot.cost_reservation_id);
  const token=f.sqlite.prepare('SELECT * FROM budget_reservations WHERE reservation_id=?').get(slot.token_reservation_id);
  assert.equal(cost.owner_id,actor);assert.equal(token.owner_id,actor);assert.equal(cost.correlation_id,job.correlation_id);
  const counters=()=>({tokens:f.sqlite.prepare('SELECT scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters ORDER BY scope,scope_id,period').all().map(row=>({...row})),
    cost:f.sqlite.prepare('SELECT scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters ORDER BY scope,scope_id,period').all().map(row=>({...row}))});
  const admittedCounters=counters();
  assert.equal(await policy.claimCostBudgetReservation(f.env,actor,slot.cost_reservation_id),true);
  assert.equal(await policy.claimCostBudgetReservation(f.env,actor,slot.cost_reservation_id),false,'The admitted cost hold has one consumer');
  const financialGuard={sql:`EXISTS(SELECT 1 FROM cost_budget_reservations cost JOIN budget_reservations token
    ON token.owner_id=cost.owner_id AND token.stream_id=cost.stream_id AND token.correlation_id=cost.correlation_id AND token.period=cost.period AND token.operation=cost.operation
    WHERE cost.reservation_id=? AND token.reservation_id=? AND cost.owner_id=? AND cost.stream_id=? AND cost.correlation_id=?
      AND cost.reserved_microusd=? AND token.reserved_tokens=? AND cost.status='executing' AND token.status='active')`,
    bindings:[slot.cost_reservation_id,slot.token_reservation_id,actor,job.stream_id,job.correlation_id,slot.maximum_microusd,slot.maximum_tokens]};
  const calls=f.prepared.preflight.targets[0].settings.calls;
  const claims=new Map(),observations=[];
  const claimInput=async stage=>{
    const route=calls.find(call=>call.stage===stage);assert.ok(route);
    const input={scope:trusted.scope,slotId:slot.slot_id,jobId:job.job_id,callKey:stage,stageKey:stage,
      clientRequestId:`synthetic-storyboard-${stage}`,requestDigest:await outputDigest({syntheticAccountingOnly:true,stage,jobId:job.job_id}),
      provider:route.provider,model:route.model,maximumMicrousd:route.maximumMicrousd,routeDigest:slot.route_digest,
      sourceDigest:slot.source_digest,expectedHead:trusted.ownerHead,sourceEpoch:{head:trusted.ownerHead,sourceDigest:trusted.sourceDigest},
      assertions:[...trusted.sourceAssertions,financialGuard]};
    return input;
  };
  const claim=async stage=>{const input=await claimInput(stage);assert.equal((await ledger.claimOutputProviderCall(f.env,input)).claimed,true);claims.set(stage,input);return input;};
  const observe=async(input,receipt,patch={})=>{
    const financialCheckpoint=prepareOutputProviderFinancialCheckpoint(f.env,{scopeKey:slot.scope_key,slotId:slot.slot_id,callKey:input.callKey,
      jobId:job.job_id,ownerId:actor,streamId:job.stream_id,correlationId:job.correlation_id,receipt,
      patch:{providerSubmissionProtocol:1,generationReceipt:{reservation_status:'executing'},...patch}});
    const value={scopeKey:slot.scope_key,slotId:slot.slot_id,callKey:input.callKey,clientRequestId:receipt.clientRequestId,
      ...(receipt.providerRequestId?{providerResponseId:receipt.providerRequestId}:{}),
      status:receipt.status==='rejected'?'rejected':receipt.status==='completed'?'settled':'uncertain',
      usedMicrousd:receipt.status==='rejected'?0:receipt.status==='completed'?receipt.costMicrousd:null,financialCheckpoint};
    const result=await ledger.settleOutputProviderCall(f.env,value);observations.push({input:value,receipt});return result;
  };
  const knownCosts=[1000,2000,3000],stages=['planning:0:initial','image:frame:1','image:frame:2'];
  for(const [index,stage] of stages.entries()){
    const input=await claim(stage),planning=index===0;
    assert.ok(knownCosts[index]<=input.maximumMicrousd);
    const receipt={clientRequestId:input.clientRequestId,provider:input.provider,operation:planning?'planning':'image',model:input.model,
      providerRequestId:`synthetic-provider-${stage}`,status:'completed',costMicrousd:knownCosts[index],inputTokens:planning?100:0,outputTokens:planning?50:0,totalTokens:planning?150:0};
    const patch=planning?{plannerModel:input.model,plannerResponseId:receipt.providerRequestId,plannerUsage:{inputTokens:100,outputTokens:50,totalTokens:150}}:{};
    assert.deepEqual(await observe(input,receipt,patch),{replayed:false});
    assert.deepEqual(await ledger.settleOutputProviderCall(f.env,observations.at(-1).input),{replayed:true});
  }
  const third=await claim('image:frame:3');
  const thirdReceipt={clientRequestId:third.clientRequestId,provider:third.provider,operation:'image',model:third.model,
    ...(outcome==='uncertain'?{status:'accepted',providerRequestId:'synthetic-provider-frame-3'}:{status:'rejected',costMicrousd:0})};
  assert.deepEqual(await observe(third,thirdReceipt),{replayed:false});
  const callRows=()=>f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY stage_key').all();
  const beforeReplay=callRows();
  for(const input of claims.values())assert.equal((await ledger.claimOutputProviderCall(f.env,input)).claimed,false);
  await assert.rejects(ledger.claimOutputProviderCall(f.env,{...third,requestDigest:'different-synthetic-request'}),/provider_call_key_collision/);
  await assert.rejects(ledger.claimOutputProviderCall(f.env,{...third,callKey:'new-frame-three-call',clientRequestId:'new-frame-three-client'}),/output_provider_call_not_authorized/);
  assert.deepEqual(callRows(),beforeReplay);assert.equal(beforeReplay.length,4);
  assert.equal(beforeReplay.filter(row=>row.status==='settled').length,3);
  assert.equal(beforeReplay.find(row=>row.stage_key==='image:frame:3').status,outcome);
  assert.equal(beforeReplay.find(row=>row.stage_key==='image:frame:3').used_microusd,outcome==='uncertain'?null:0);
  assert.equal(beforeReplay.some(row=>row.stage_key==='image:frame:4'),false);
  const budgets=()=>({token:{...f.sqlite.prepare('SELECT * FROM budget_reservations WHERE reservation_id=?').get(slot.token_reservation_id)},
    cost:{...f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(slot.cost_reservation_id)}});
  const beforeCancel=budgets();assert.equal(beforeCancel.token.status,'active');assert.equal(beforeCancel.cost.status,'executing');
  assert.equal(beforeCancel.token.used_tokens,0);assert.equal(beforeCancel.cost.used_microusd,0);
  assert.deepEqual(counters(),admittedCounters,'Provider call observations and duplicate claims cannot spend or release account counters');
  if(outcome==='uncertain'){
    await assert.rejects(ledger.claimOutputProviderCall(f.env,await claimInput('image:frame:4')),/output_provider_call_not_authorized/);
    assert.deepEqual(await policy.settleDocumentGenerationBudgets(f.env,actor,{reservationId:slot.token_reservation_id,costReservationId:slot.cost_reservation_id,reason:'synthetic_storyboard_unknown_cost'}),{settled:false,status:'uncertain'});
    const accepted=observations.at(-1),rejected={...thirdReceipt,status:'rejected',costMicrousd:0};delete rejected.providerRequestId;
    const retainedFinancial=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs WHERE job_id=?').get(job.job_id).result_json).providerSubmissions;
    await assert.rejects(observe(third,rejected),/provider_settlement_conflict/);
    assert.equal(accepted.receipt.status,'accepted');assert.deepEqual(callRows(),beforeReplay);
    assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs WHERE job_id=?').get(job.job_id).result_json).providerSubmissions,retainedFinancial);
    await synchronizeOutputJobOutcome(f.env,job);
    assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'uncertain');
  }
  const cancel=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${job.job_id}/cancel`,post({})),f.env,`${job.job_id}/cancel`);
  const cancelled=await cancel.json();
  if(outcome==='uncertain'){
    assert.equal(cancel.status,409,JSON.stringify(cancelled));assert.equal(cancelled.error,'provider_submission_in_flight');
    assert.deepEqual(budgets(),beforeCancel,'Unknown liability retains both exact original holds');
    assert.deepEqual(counters(),admittedCounters,'Unknown liability retains user and workspace counter reservations');
    assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'active');
  }else{
    assert.equal(cancel.status,200,JSON.stringify(cancelled));assert.equal(cancelled.stoppedCount,1);
    const afterCancel=budgets();assert.equal(afterCancel.token.status,'settled');assert.equal(afterCancel.cost.status,'settled');
    assert.equal(afterCancel.token.used_tokens,150);assert.equal(afterCancel.cost.used_microusd,knownCosts.reduce((sum,value)=>sum+value,0));
    assert.equal(afterCancel.token.reserved_tokens,token.reserved_tokens);assert.equal(afterCancel.cost.reserved_microusd,cost.reserved_microusd);
    assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'cancelled');
    assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'completed');
    const chargedCounters=counters();
    for(const [name,unit,reserved,used,period] of [['tokens','tokens',token.reserved_tokens,150,token.period],['cost','microusd',cost.reserved_microusd,6000,cost.period]]){
      let affected=0;
      const expected=admittedCounters[name].map(row=>{
        if(row.period!==period||!(row.scope==='user'&&row.scope_id===actor||row.scope==='workspace'&&row.scope_id==='forma'))return row;
        affected++;assert.ok(row[`reserved_${unit}`]>=reserved);
        return {...row,[`reserved_${unit}`]:row[`reserved_${unit}`]-reserved,[`used_${unit}`]:row[`used_${unit}`]+used};
      });
      assert.equal(affected,2,'The admitted owner and workspace counters must both settle');assert.deepEqual(chargedCounters[name],expected);
    }
    const repeat=await policy.settleDocumentGenerationBudgets(f.env,actor,{reservationId:slot.token_reservation_id,costReservationId:slot.cost_reservation_id});
    assert.equal(repeat.settled,false);assert.equal(repeat.status,'known');assert.deepEqual(budgets(),afterCancel);
    assert.deepEqual(counters(),chargedCounters,'Settlement replay cannot duplicate counter charges or releases');
  }
  assert.deepEqual(callRows(),beforeReplay);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
  assert.deepEqual(observed,{network:0,media:0,assets:0,detached:0});
  return {outcome,jobId:job.job_id,grantId,slotId:slot.slot_id,callCount:4,unsubmittedFrame:4,knownCostMicrousd:6000,knownTokens:150,
    cancelStatus:cancel.status,slotStatus:f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,budgets:budgets(),
    coverage:'Native HTTP admission/run and accounting callbacks only; no provider execution, frame bytes, frame-sequence proof or sponsored admission.'};
}

/** A synthetic extracted reference with native rights/event custody. This adds
 * source events only: it never stores or reads an object, replaces MEDIA, or
 * resets the caller's observation counters. Callers can insert it before an
 * intent read or at an awaited read boundary and keep their own MEDIA trap. */
export async function addSyntheticExtractedReference(f){
  const [{extractSourceDocument,sourceDocumentEvidence,sourceDocumentEvidenceDigest,sourceDocumentEvidenceFromProperties},
    {ownerMediaNamespace}]=await Promise.all([import('../src/model/source-documents.ts'),import('../src/model/media-ownership.ts')]);
  const mimeType='text/plain',bytes=new TextEncoder().encode('Synthetic extracted source: retain the lantern continuity. 灯笼 — فانوس');
  const contentHash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const extracted=await extractSourceDocument(new File([bytes],'synthetic-storyboard-reference.txt',{type:mimeType}));
  assert.equal(extracted.status,'ready');
  const evidenceHash=await sourceDocumentEvidenceDigest(sourceDocumentEvidence(extracted,contentHash,mimeType));
  const referenceId='synthetic-storyboard-extracted-reference',blockId='synthetic-storyboard-extracted-block';
  const key=`${ownerMediaNamespace(actor)}/synthetic-storyboard-extracted-reference.txt`,mediaUrl=`/api/media/${encodeURIComponent(key)}`;
  const properties={label:'Synthetic extracted reference',reference_id:referenceId,weight:1,pixel_reference_mode:'context_only',
    media_url:mediaUrl,media_type:mimeType,source_evidence_hash:evidenceHash,source_content_hash:contentHash,source_mime_type:mimeType,
    source_kind:extracted.sourceKind,extraction_status:extracted.status,text:extracted.text,
    source_citations:extracted.segments.map(segment=>({anchor:segment.anchor,excerpt:segment.text})),
    source_segment_count:extracted.segments.length,source_excerpt_truncated:extracted.truncated};
  assert.equal(await sourceDocumentEvidenceDigest(sourceDocumentEvidenceFromProperties(properties,contentHash,mimeType)),evidenceHash);
  const scope={document_id:f.plan.documentId,project_id:f.plan.projectId};
  const events=[];
  for(const [type,payload] of [
    ['ReferenceIngested',{...scope,reference_id:referenceId,source_ref:mediaUrl,content_hash:contentHash,rights_class:'owned'}],
    ['RightsAsserted',{...scope,reference_id:referenceId,rights_class:'owned'}],
    ['BlockCreated',{...scope,block_id:blockId,type:'reference',scope:'document',handle:'reference/synthetic-extracted',position:'zz-synthetic-extracted',properties}],
  ])events.push(await runtime.appendAuditEvent(f.env,stream,'user',type,payload,'synthetic-storyboard-extracted-reference'));
  const metadata={ownerId:actor,sha256:contentHash,mimeType,rights:'asserted',sourceEvidenceSha256:evidenceHash};
  return {key,mediaUrl,referenceId,blockId,properties,metadata,byteLength:bytes.byteLength,events,
    coverage:'Synthetic native extracted-source event fixture only; no stored object or media operation.'};
}

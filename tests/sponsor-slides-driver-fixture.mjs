import assert from 'node:assert/strict';
import {snapshot} from './output-presentation-fixtures.mjs';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();

const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},
  {handleOutputRequirements},{outputDocumentExecutionBridge},{createExperienceOutputRecipe},
  {registeredExperience},{PRESENTATION_ADAPTER_VERSION},{OUTPUT_NATIVE_EXECUTION_POLICY},
  {resolvePresentationModelRoutes},{estimateOpenAITextCallMaximumMicrousd},
  {readSponsorSlidesCampaignTemplate},{SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},
  {SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign},
  {SPONSOR_ISSUER_SCHEMA},{SPONSOR_DRIVER_SCHEMA}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-output-recipe.ts'),import('../src/experiences/intake.ts'),
  import('../worker/openai-adapter.ts'),import('../src/model/output-execution-policy.ts'),
  import('../worker/presentation-model-routing.ts'),import('../worker/openai-text-cost.ts'),
  import('../worker/experience-sponsor-slides-contract.ts'),import('../worker/experience-sponsor-entitlement.ts'),
  import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-sponsor-issuer.ts'),import('../worker/experience-sponsor-driver.ts'),
]);

export {transport,assertPayerSettlement,assertRuntimeCalls,actorCounters,actor,payer,stream,headers,post} from './sponsor-slides-native-fixture.mjs';
import {actor,payer,stream,headers,post} from './sponsor-slides-native-fixture.mjs';
const io={media:0,assets:0,detached:0};
export const context={waitUntil(){io.detached++;throw Error('No detached Slides driver work');}};
export const BASE='/api/output-requirements';
const DRIVER_URL='http://localhost/__fixture/sponsor-slides-driver';
const APPROVAL_URL='http://localhost/__fixture/sponsor-slides-approval';
const databaseClock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";

/** Stable review material comes from the registered release and actual native
 * constants, without obtaining a native quote or fabricating an issuance. */
export async function stableSlidesTemplate(env){
  const release=await registeredExperience('slides');assert.ok(release);const routes=resolvePresentationModelRoutes(env);
  const calls=[routes.composition,routes.repair].map((route,index)=>({stage:index?'planning:0:repair':'planning:0:initial',provider:'openai',model:route.model,optional:index===1,
    presentationRoute:route,maximumInputTokens:121500,maximumOutputTokens:6500,maximumMicrousd:Math.max(500000,estimateOpenAITextCallMaximumMicrousd(route.model,121500,6500))}));
  return readSponsorSlidesCampaignTemplate({version:1,family:'canonical-five-slide-deck@1',appId:'slides',recipeVersion:`slides@${release.definition.revision}`,releaseDigest:release.releaseHash,
    outputKind:'slides',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,slideCountPolicy:{kind:'exact',unit:'slide',value:5},
    route:'document-slides-manual-v1',maximumCalls:2,maximumTokens:128000,maximumMicrousd:calls.reduce((sum,call)=>sum+call.maximumMicrousd,0),calls,
    adapterVersion:PRESENTATION_ADAPTER_VERSION,sourceContractVersion:2,executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY});
}
export function captureNativeTerms(f){
  const rows=f.sqlite.prepare('SELECT body.private_json FROM output_preflights quote JOIN event_private_payloads body ON body.private_event_id=quote.event_id ORDER BY quote.rowid').all();
  assert.equal(rows.length,1);f.terms=JSON.parse(rows[0].private_json).preflight;return f.terms;
}

export function request(f,overrides={}){
  return new Request(DRIVER_URL,post({...f.command,...overrides},f.actorHeaders));
}

/** This is the real V5 approval boundary, authenticated as the synthetic payer.
 * Every campaign, allowance and financial row belongs to this disposable DB. */
export async function approve(f,{proposal=f.proposal,approvalId=`approval-${f.campaignId}`}={}){
  const compiled=await compileSponsorApprovalProposal(proposal);
  const approvalCommand={action:'approve-sponsor-campaign',approvalId,proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:compiled.termsDigest};
  const approved=await approveSponsorCampaign(new Request(APPROVAL_URL,post(approvalCommand,f.payerHeaders)),f.env);
  Object.assign(f,{proposal,policy:approved.policy,compiled:approved,approval:approved,approvalCommand});
  return approved;
}

/** Native ordinary save/confirm only. The driver must obtain its own preflight,
 * immutable issuer receipt, native admission and native initial/optional-repair Slides execution.
 * These schemas are installed only here; no production route is enabled. */
export async function fixture(t,{documentId='sponsor-driver-slides',campaignId='fixture-slides-driver-campaign',
  intentKey='slides-driver-intent-1',sourceText=snapshot(5).facts[0].properties.text,approved=true,strict=false}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());const beforeIo={...io};t.after(()=>assert.deepEqual(io,beforeIo));
  for(const method of ['get','head','put','delete','list'])f.env.MEDIA[method]=()=>{io.media++;throw Error('No media access');};
  f.env.ASSETS.fetch=()=>{io.assets++;throw Error('No assets access');};
  const originalFetch=globalThis.fetch;let setupFetchAttempts=0;
  globalThis.fetch=()=>{setupFetchAttempts++;throw Error('Slides driver fixture setup prohibits network');};
  try{
    Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_SLIDES_COMPOSITION_MODEL:'gpt-5.6-terra',OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:'low',OPENAI_SLIDES_REPAIR_MODEL:'gpt-5.6-sol',OPENAI_SLIDES_REPAIR_REASONING_EFFORT:'medium'});
    const actorHeaders=headers(actor),payerHeaders=headers(payer);
    for(const auth of [actorHeaders,payerHeaders])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:auth}),f.env)).status,200);
    f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id IN(?,?)').run(POLICY_VERSION,actor,payer);
    assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers:actorHeaders}),f.env)).status,200);
    await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Synthetic sponsored Slides driver'});
    const sourceBlockId='source-0';
    for(const [index,fact] of snapshot(5).facts.filter(fact=>String(fact.type).toLowerCase()!=='output').entries())
      await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:fact.block_id,type:fact.type,handle:fact.block_id,position:String(index),properties:{...fact.properties,...(index===0?{text:sourceText}:{}),weight:1,...(fact.intent?{intent:fact.intent}:{})}});
    let sequence=0;
    const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,post({documentId,
      expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`slides-driver-setup-${++sequence}`,...body},actorHeaders)),
    f.env,BASE,context,outputDocumentExecutionBridge);
    const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
    const recipe=createExperienceOutputRecipe({output:'slides',requirementId:'slides-driver-requirement',deliverableId:'slides-driver-deliverable'});
    await ok(await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec}));
    const confirmed=await ok(await send({action:'confirm'}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
    const planRevisionId=confirmed.command.planRevisionId,targetId=confirmed.snapshot.confirmedPlan.plan.targets[0].id;
    for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA,SPONSOR_DRIVER_SCHEMA]){
      assert.ok(Array.isArray(schema));for(const sql of schema)f.sqlite.exec(sql);
    }
    const now=f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now,template=await stableSlidesTemplate(f.env);
    const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,
      maximumPendingGrants:10,maximumInflightJobs:1};
    const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,
      campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
    const proposal={policy:{version:5,family:'canonical-five-slide-deck@1',mode:'candidate',campaignId,policyVersion:'slides-driver-fixture@1',payerUserId:payer,
      audience:'canonical-principal',startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,
      maximumAdmissions:10,maximumMicrousd:template.maximumMicrousd*10,maximumAdmissionsPerActor:5,
      windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources},
    eligibleActorUserIds:[actor],issuerUserIds:[actor]};
    const command={action:'run-sponsored-slides',campaignId,documentId,planRevisionId,targetId,intentKey};
    Object.assign(f,{actor,payer,actorHeaders,payerHeaders,stream,documentId,campaignId,planRevisionId,targetId,sourceText,sourceBlockId,
      outputBlockId:recipe.spec.id,confirmed,command,proposal,template,resources,context,send,ok});
    f.request=overrides=>request(f,overrides);f.approve=options=>approve(f,options);
    if(strict){f.limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});t.after(()=>f.limits.restore());}
    if(approved)await approve(f);
    for(const table of ['output_preflights','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations',
      'output_provider_calls','experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_driver_intents','experience_sponsor_driver_stages',
      'experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs']){
      const exists=f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if(exists)assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`Fixture must not populate ${table}`);
    }
    assert.equal(setupFetchAttempts,0);return f;
  }finally{globalThis.fetch=originalFetch;}
}

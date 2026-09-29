import assert from 'node:assert/strict';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();

const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},
  {handleOutputRequirements},{outputDocumentExecutionBridge},{createExperienceOutputRecipe},
  {registeredExperience},{SHORT_STORY_NARRATIVE_CONTRACT},{OUTPUT_NATIVE_EXECUTION_POLICY},
  {OUTPUT_NARRATIVE_MODEL},{OPENAI_TEXT_PRICING_VERSION,estimateOpenAITextCallMaximumMicrousd},
  {readSponsorStoryCampaignTemplate},{SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},
  {SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign},
  {SPONSOR_ISSUER_SCHEMA},{SPONSOR_DRIVER_SCHEMA}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-output-recipe.ts'),import('../src/experiences/intake.ts'),
  import('../src/model/output-narrative-contract.ts'),import('../src/model/output-execution-policy.ts'),
  import('../worker/output-narrative-request.ts'),import('../worker/openai-text-cost.ts'),
  import('../worker/experience-sponsor-story-contract.ts'),import('../worker/experience-sponsor-entitlement.ts'),
  import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/experience-sponsor-issuer.ts'),import('../worker/experience-sponsor-driver.ts'),
]);

export {transport,assertPayerSettlement,actorCounters,actor,payer,stream,context,headers,post} from './sponsor-story-native-fixture.mjs';
import {actor,payer,stream,context,headers,post} from './sponsor-story-native-fixture.mjs';
export const BASE='/api/output-requirements';
const DRIVER_URL='http://localhost/__fixture/sponsor-story-driver';
const APPROVAL_URL='http://localhost/__fixture/sponsor-story-approval';
const databaseClock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";

/** Stable review material comes from the registered release and actual native
 * constants, without obtaining a native quote or fabricating an issuance. */
export async function stableStoryTemplate(){
  const release=await registeredExperience('short-story');assert.ok(release);
  return readSponsorStoryCampaignTemplate({version:1,family:'canonical-short-story@1',appId:'short-story',
    recipeVersion:`short-story@${release.definition.revision}`,releaseDigest:release.releaseHash,
    outputKind:'short_story',inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,
    route:'document-short-story-manual-v1',maximumCalls:1,maximumTokens:128000,maximumInputTokens:122000,maximumOutputTokens:6000,
    maximumMicrousd:Math.max(1_000_000,estimateOpenAITextCallMaximumMicrousd(OUTPUT_NARRATIVE_MODEL,122000,6000)),
    call:{stage:'planning:0:initial',provider:'openai',model:OUTPUT_NARRATIVE_MODEL},narrativeContract:SHORT_STORY_NARRATIVE_CONTRACT,
    pricingVersion:OPENAI_TEXT_PRICING_VERSION,cachePolicy:'disabled-explicit',reasoningEffort:'low',executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY});
}

export function request(f,overrides={}){
  return new Request(DRIVER_URL,post({...f.command,...overrides},f.actorHeaders));
}

/** This is the real V4 approval boundary, authenticated as the synthetic payer.
 * Every campaign, allowance and financial row belongs to this disposable DB. */
export async function approve(f,{proposal=f.proposal,approvalId=`approval-${f.campaignId}`}={}){
  const compiled=await compileSponsorApprovalProposal(proposal);
  const approvalCommand={action:'approve-sponsor-campaign',approvalId,proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:compiled.termsDigest};
  const approved=await approveSponsorCampaign(new Request(APPROVAL_URL,post(approvalCommand,f.payerHeaders)),f.env);
  Object.assign(f,{proposal,policy:approved.policy,compiled:approved,approval:approved,approvalCommand});
  return approved;
}

/** Native ordinary save/confirm only. The driver must obtain its own preflight,
 * immutable issuer receipt, native admission and one-call Story execution.
 * These schemas are installed only here; no production route is enabled. */
export async function fixture(t,{documentId='sponsor-driver-story',campaignId='fixture-story-driver-campaign',
  intentKey='story-driver-intent-1',sourceText='Mira chooses to return a lost clock despite missing the last train.',approved=true,strict=false}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  const originalFetch=globalThis.fetch;let setupFetchAttempts=0;
  globalThis.fetch=()=>{setupFetchAttempts++;throw Error('Story driver fixture setup prohibits network');};
  try{
    Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:OUTPUT_NARRATIVE_MODEL});
    const actorHeaders=headers(actor),payerHeaders=headers(payer);
    for(const auth of [actorHeaders,payerHeaders])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:auth}),f.env)).status,200);
    f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id IN(?,?)').run(POLICY_VERSION,actor,payer);
    assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers:actorHeaders}),f.env)).status,200);
    await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Synthetic sponsored Story driver'});
    const sourceBlockId=`source-${documentId}`;
    await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:sourceBlockId,
      type:'subject',handle:sourceBlockId,position:'0',properties:{text:sourceText,weight:1}});
    let sequence=0;
    const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,post({documentId,
      expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`story-driver-setup-${++sequence}`,...body},actorHeaders)),
    f.env,BASE,context,outputDocumentExecutionBridge);
    const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
    const recipe=createExperienceOutputRecipe({output:'short_story',requirementId:'story-driver-requirement',deliverableId:'story-driver-deliverable',contract:SHORT_STORY_NARRATIVE_CONTRACT});
    await ok(await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec}));
    const confirmed=await ok(await send({action:'confirm'}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
    const planRevisionId=confirmed.command.planRevisionId,targetId=confirmed.snapshot.confirmedPlan.plan.targets[0].id;
    for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA,SPONSOR_DRIVER_SCHEMA]){
      assert.ok(Array.isArray(schema));for(const sql of schema)f.sqlite.exec(sql);
    }
    const now=f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now,template=await stableStoryTemplate();
    const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,
      maximumPendingGrants:10,maximumInflightJobs:1};
    const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,
      campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
    const proposal={policy:{version:4,family:'canonical-short-story@1',mode:'candidate',campaignId,policyVersion:'story-driver-fixture@1',payerUserId:payer,
      audience:'canonical-principal',startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,
      maximumAdmissions:10,maximumMicrousd:template.maximumMicrousd*10,maximumAdmissionsPerActor:5,
      windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources},
    eligibleActorUserIds:[actor],issuerUserIds:[actor]};
    const command={action:'run-sponsored-short-story',campaignId,documentId,planRevisionId,targetId,intentKey};
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

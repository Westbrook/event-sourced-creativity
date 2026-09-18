import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readLocalMigrations} from '../scripts/lib/local-migrations.mjs';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();

const [{handleSession,POLICY_VERSION},{handleEvents},{ensureSchema,streamHead},
  {handleOutputRequirements,loadOutputTrustedContext},{outputDocumentExecutionBridge},
  {handleExperienceIntake},{registeredExperience,initialValues,experienceResourceId},
  {experienceOutputBinding},{createExperienceOutputRecipe},{SCENE_OUTPUT_POLICY,createSceneOutputContract},
  {OUTPUT_NATIVE_EXECUTION_POLICY},{OUTPUT_SCENE_MODEL},{OPENAI_TEXT_PRICING_VERSION},
  {readSponsorSceneCampaignTemplate},{canonicalJson},{SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},
  {SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign},
  {SPONSOR_ISSUER_SCHEMA},{SPONSOR_DRIVER_SCHEMA}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),
  import('../worker/experience-intake-api.ts'),import('../src/experiences/intake.ts'),
  import('../worker/experience-output-binding.ts'),import('../worker/experience-output-recipe.ts'),
  import('../src/model/output-scene-contract.ts'),import('../src/model/output-execution-policy.ts'),
  import('../worker/output-scene-request.ts'),import('../worker/openai-text-cost.ts'),
  import('../worker/experience-sponsor-scene-contract.ts'),import('../src/experiences/compiler.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),
  import('../worker/experience-sponsor-approval.ts'),import('../worker/experience-sponsor-issuer.ts'),
  import('../worker/experience-sponsor-driver.ts'),
]);

// Reuse the accepted synthetic provider and native settlement/source oracles.
// Merely importing that fixture does not call its authority-seeding fixture().
export {transport,rows,finances,actorCounters,count,assertPayerSettlement,freshRun,
  actor,payer,stream,context,headers,post,originalFetch,createSponsorAdmissionAuthority,
  createSponsorExecutionAuthority,readSponsorFinancialBinding,sponsorFinancialIdentity,
  outputExperienceCommands,runDocumentJob,handleDocumentJobs,loadOutputJobBinding,
  reconcileExpiredOutputAuthorizations,handleEventPrivacy,revokeSponsorCampaign,
  createOutputEventExecution,sponsorFinancialEventProfile} from './sponsor-scene-native-fixture.mjs';
import {actor,payer,stream,context,headers,post,actorCounters} from './sponsor-scene-native-fixture.mjs';
export {loadOutputTrustedContext,outputDocumentExecutionBridge,handleEvents,compileSponsorApprovalProposal};

export const BASE='/api/output-requirements';
const DRIVER_URL='http://localhost/__fixture/sponsor-scene-driver';
const APPROVAL_URL='http://localhost/__fixture/sponsor-scene-approval';
const databaseClock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const metadataSqlSha='87984dc31fc80df29511e79e97c2d1f59ce7e1c5324781951a3cb486f96d1a41';
let fixtureSetupInProgress=false;
const operationalTables=Object.freeze(['output_preflights','output_execution_grants','output_operation_slots',
  'document_jobs','budget_reservations','cost_budget_reservations','output_provider_calls',
  'experience_sponsor_grants','experience_sponsor_issuances','experience_sponsor_driver_intents',
  'experience_sponsor_driver_stages','experience_sponsor_resource_receipts',
  'experience_sponsor_consumptions','experience_sponsor_active_jobs','experience_sponsor_assertions']);

/** Preserve the accepted exception for this exact unchanged native SQL only.
 * All new statements retain depth 100, function arguments 32, parameters 100,
 * and SQL bytes 100000. This is Node SQLite qualification, not workerd evidence. */
export function strictSceneSql(f){
  const original=f.env.DB.prepare;
  const strict=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}}),strictPrepare=f.env.DB.prepare;
  const nativeEnv={DB:{prepare:original}},native=enforceD1ExpressionDepth({env:nativeEnv,sqlite:f.sqlite},{queryLimits:{functionArguments:56,parameters:100,sqlBytes:100000}});
  let exceptions=0;
  f.env.DB.prepare=function(sql){
    if(createHash('sha256').update(sql).digest('hex')===metadataSqlSha){exceptions++;return nativeEnv.DB.prepare(sql);}
    return strictPrepare.call(this,sql);
  };
  return {records:strict.records,nativeRecords:native.records,boundCounts:strict.boundCounts,
    assertVerified(){strict.assertVerified();native.assertVerified();assert.ok(exceptions>0);assert.ok(native.records.every(record=>createHash('sha256').update(record.sql).digest('hex')===metadataSqlSha));},
    get exceptions(){return exceptions;},restore(){strict.restore();native.restore();}};
}

/** Stable payer review material comes from the registered release and actual
 * native constants. No preflight, Scene admission handle, or grant is needed. */
export async function stableSceneTemplate(){
  const release=await registeredExperience('scene');assert.ok(release);
  return readSponsorSceneCampaignTemplate({version:1,family:'canonical-scene-screenplay@1',appId:'scene',
    recipeVersion:`scene@${release.definition.revision}`,releaseDigest:release.releaseHash,outputKind:'scene',
    inputMode:'authorized-document-text',outputCount:1,durationMs:0,width:0,height:0,
    route:'document-scene-screenplay-manual-v1',maximumCalls:1,maximumTokens:128000,maximumInputTokens:125000,
    maximumOutputTokens:3000,maximumMicrousd:1000000,call:{stage:'planning:0:initial',provider:'openai',model:OUTPUT_SCENE_MODEL},
    scenePolicy:SCENE_OUTPUT_POLICY,pricingVersion:OPENAI_TEXT_PRICING_VERSION,cachePolicy:'disabled-explicit',
    reasoningEffort:'low',executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY});
}

export function captureNativeTerms(f){
  const rows=f.sqlite.prepare('SELECT body.private_json FROM output_preflights quote JOIN event_private_payloads body ON body.private_event_id=quote.event_id ORDER BY quote.rowid').all();
  assert.equal(rows.length,1);f.terms=JSON.parse(rows[0].private_json).preflight;return f.terms;
}

export function request(f,overrides={}){
  return new Request(DRIVER_URL,{...post({...f.command,...overrides},f.actorHeaders),signal:f.controller.signal});
}

/** This helper represents a separate, deliberate synthetic actor action in a
 * test. Production prepare must never synthesize this confirmation. */
export function runRequest(f,prepared,overrides={}){
  const body={...f.command,action:'run-sponsored-scene',reviewedPolicyDigest:prepared.policyDigest,
    preflightId:prepared.preflight.id,termsDigest:prepared.preflight.termsDigest,
    maximumMicrousd:prepared.preflight.maximumMicrousd,explicitAuthorization:true,
    sceneCostConsent:{...structuredClone(prepared.sceneCostPreview),confirmed:true},...overrides};
  return new Request(DRIVER_URL,{...post(body,f.actorHeaders),signal:f.controller.signal});
}

/** Real V6 approval, authenticated as the synthetic payer in this disposable DB. */
export async function approve(f,{proposal=f.proposal,approvalId=`approval-${f.campaignId}`,reviewedTermsDigest}={}){
  const terms=await compileSponsorApprovalProposal(proposal);
  const approvalCommand={action:'approve-sponsor-campaign',approvalId,proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',
    reviewedTermsDigest:reviewedTermsDigest===undefined?terms.termsDigest:reviewedTermsDigest};
  const approved=await approveSponsorCampaign(new Request(APPROVAL_URL,post(approvalCommand,f.payerHeaders)),f.env);
  Object.assign(f,{proposal,policy:approved.policy,compiled:approved,approval:approved,approvalTerms:terms,approvalCommand,
    resources:approved.policy.resources,template:approved.policy.templates[0]});
  return approved;
}

export function assertNoOperationalRows(f){
  const counts={};
  for(const table of operationalTables){
    const exists=f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    counts[table]=exists?f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n:0;
    assert.equal(counts[table],0,`Fixture must not populate ${table}`);
  }
  return counts;
}

export function assertResourceAccounting(f){
  const receipts=f.sqlite.prepare('SELECT * FROM experience_sponsor_resource_receipts ORDER BY operation').all();
  assert.deepEqual(receipts.map(row=>row.operation),['issuance','preflight','text-intake']);
  for(const receipt of receipts){assert.equal(receipt.campaign_id,f.campaignId);assert.equal(receipt.actor_user_id,actor);assert.equal(receipt.text_bytes,f.N);}
  assert.equal(receipts.reduce((sum,row)=>sum+row.text_bytes,0),3*f.N);
  return receipts;
}

/** Genuine ordinary authored intake/commit followed by native save/confirm only.
 * Operational tables start empty. The driver owns every sponsored resource
 * receipt, native preflight, issuance, admission, Run, and provider call. */
export async function fixture(t,{campaignId='fixture-scene-driver-campaign',intentKey='scene-driver-intent-1',
  intakeIntentId='00000000-0000-4000-8000-000000000098',authoredValues={},approved=true,strict=false,
  controller=new AbortController()}={}){
  // The provider transport is process-global, so fixture construction must be
  // serial. Refuse overlap before replacing/restoring another setup's guard.
  assert.equal(fixtureSetupInProgress,false,'Scene driver fixtures must be constructed serially');
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  const originalFetch=globalThis.fetch;let setupFetchAttempts=0;
  fixtureSetupInProgress=true;
  globalThis.fetch=()=>{setupFetchAttempts++;throw Error('Scene driver fixture setup prohibits network');};
  try{
    Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:OUTPUT_SCENE_MODEL});
    const actorHeaders=headers(actor),payerHeaders=headers(payer);
    for(const auth of [actorHeaders,payerHeaders])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:auth}),f.env)).status,200);
    f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id IN(?,?)').run(POLICY_VERSION,actor,payer);
    assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers:actorHeaders}),f.env)).status,200);
    await ensureSchema(f.env);
    for(const migration of readLocalMigrations(new URL('../drizzle/',import.meta.url)).filter(value=>value.tag==='0038_scene_source_generations'))
      for(const sql of migration.sql.split('--> statement-breakpoint'))if(sql.trim())f.sqlite.exec(sql);
    const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
    const release=await registeredExperience('scene');assert.ok(release);
    const authored={characterA:'Alex',characterB:'Sam',goalA:'Stay',goalB:'Leave',secret:'The key is outside',location:'Waiting room',...authoredValues};
    const intake={intentId:intakeIntentId,experienceId:'scene',releaseHash:release.releaseHash,
      values:{...initialValues(release),...Object.fromEntries(Object.entries(authored).map(([key,value])=>[key,{value,provenance:'authored'}]))}};
    const saved=await ok(await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intake,actorHeaders)),f.env));
    const plan=saved.plan,{documentId,draftId,draftHash}=plan;
    const committed=await ok(await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${draftId}/commit`,post({draftHash},actorHeaders)),f.env));
    assert.equal(committed.status,'complete');
    const binding=await experienceOutputBinding(plan);
    const contract=createSceneOutputContract({draftId:binding.draftId,draftHash:binding.draftHash,releaseHash:binding.releaseHash,
      requestHash:binding.requestHash,sourceBindingHash:binding.sourceBindingHash});assert.ok(contract);
    const recipe=createExperienceOutputRecipe({output:'scene',
      requirementId:await experienceResourceId(draftId,'native-output-requirement'),
      deliverableId:await experienceResourceId(draftId,'native-output-deliverable'),contract});
    let sequence=0;
    const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,post({documentId,
      expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`scene-driver-setup-${++sequence}`,...body},actorHeaders)),
    f.env,BASE,context,outputDocumentExecutionBridge);
    await ok(await send({action:'save',blockId:recipe.spec.id,spec:recipe.spec}));
    const confirmed=await ok(await send({action:'confirm'}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
    const planRevisionId=confirmed.command.planRevisionId,targetId=confirmed.snapshot.confirmedPlan.plan.targets[0].id;
    assert.equal(targetId,recipe.targetId);
    for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA,SPONSOR_DRIVER_SCHEMA])
      for(const sql of schema)f.sqlite.exec(sql);
    const now=f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now,template=await stableSceneTemplate();
    const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,
      maximumPendingGrants:10,maximumInflightJobs:1};
    const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,
      campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
    const proposal={policy:{version:6,family:'canonical-scene-screenplay@1',mode:'candidate',campaignId,policyVersion:'scene-driver-fixture@1',payerUserId:payer,
      audience:'canonical-principal',startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,
      maximumAdmissions:10,maximumMicrousd:template.maximumMicrousd*10,maximumAdmissionsPerActor:5,
      windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources},
    eligibleActorUserIds:[actor],issuerUserIds:[actor]};
    const command={action:'prepare-sponsored-scene',campaignId,documentId,planRevisionId,targetId,intentKey};
    const sourceRequest=new Request(`http://localhost${BASE}`,{...post({documentId},actorHeaders),signal:controller.signal});
    const trusted=await loadOutputTrustedContext(sourceRequest,f.env,documentId,'request');assert.ok(!(trusted instanceof Response));
    const sourceText=canonicalJson(trusted.context.snapshot),sourceBytes=new TextEncoder().encode(sourceText).byteLength;
    const sourceBlock=plan.events.find(event=>event.type==='BlockCreated'&&event.payload.type!=='output');assert.ok(sourceBlock);
    Object.assign(f,{actor,payer,actorHeaders,payerHeaders,stream,controller,documentId,draftId,draftHash,campaignId,planRevisionId,targetId,
      intake,plan,committed,binding,contract,recipe,confirmed,command,proposal,template,resources,context,send,ok,sourceRequest,trusted,
      sourceText,sourceBytes,N:sourceBytes,sourceBlockId:sourceBlock.payload.block_id,outputBlockId:recipe.spec.id});
    f.request=overrides=>request(f,overrides);f.runRequest=(prepared,overrides)=>runRequest(f,prepared,overrides);f.approve=options=>approve(f,options);
    f.io={assets:[],unexpected:[]};
    f.env.ASSETS.fetch=async request=>{const path=new URL(request.url).pathname;f.io.assets.push(path);
      assert.equal(path,'/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf');return new Response(readFileSync(new URL('../public/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf',import.meta.url)));};
    f.trace={failedPredicates:[],databaseErrors:[]};
    const originalBatch=f.DB.batch.bind(f.DB);
    f.DB.batch=async statements=>{
      try{const results=await originalBatch(statements);
        results.forEach((result,index)=>{if(result.results?.some(row=>row.current===0))f.trace.failedPredicates.push({sql:statements[index].sql,bindings:statements[index].bindings});});
        return results;
      }catch(error){f.trace.databaseErrors.push({message:error.message,stack:error.stack,sql:statements.map(statement=>statement.sql)});throw error;}
    };
    if(strict){f.limits=strictSceneSql(f);t.after(()=>f.limits.restore());}
    if(approved)await approve(f);
    f.initialOperationalRows=assertNoOperationalRows(f);f.initialActorCounters=actorCounters(f);
    assert.equal(f.io.assets.length,0);assert.equal(setupFetchAttempts,0);return f;
  }finally{globalThis.fetch=originalFetch;fixtureSetupInProgress=false;}
}

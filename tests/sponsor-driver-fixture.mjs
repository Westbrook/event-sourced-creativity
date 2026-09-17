import assert from 'node:assert/strict';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();

const [{handleSession,POLICY_VERSION},{handleEvents},{appendAuditEvent,streamHead},{parseOutputRequirement},
  {handleOutputRequirements},{outputDocumentExecutionBridge},{SPONSOR_ENTITLEMENT_SCHEMA},
  {SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign},
  {preflightOutputImageSlidesTarget},{registeredExperience},{digest},{selectImageAdapter},route] = await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/runtime.ts'),
  import('../src/model/output-requirements.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/output-document-execution.ts'),import('../worker/experience-sponsor-entitlement.ts'),
  import('../worker/experience-sponsor-resources.ts'),import('../worker/experience-sponsor-approval.ts'),
  import('../worker/output-image-slides-preflight.ts'),import('../src/experiences/intake.ts'),
  import('../src/experiences/compiler.ts'),import('../worker/image-adapter-selection.ts'),
  import('../worker/openai-image-route-contract.ts'),
]);

export {installImageTransport} from './sponsor-native-fixture.mjs';
export const actor='dev-local-creative',payer='fixture-sponsor';
export const context={waitUntil(){throw Error('No detached work permitted');}};
export const BASE='/api/output-requirements';
const DRIVER_URL='http://localhost/__fixture/sponsor-driver';
const APPROVAL_URL='http://localhost/__fixture/sponsor-approval';
const databaseClock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
const headersFor=userId=>({'oai-authenticated-user-id':userId,'oai-authenticated-user-email':`${userId}@example.invalid`});
const init=(body,headers={})=>({method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});

/** This source-independent template quote is pure: it creates no native
 * preflight, grant, resource receipt or provider request. Its reviewed transport
 * shape is the one qualified by experience-sponsor-campaign.test.mjs. */
async function stableCampaignTemplate(env){
  const release=await registeredExperience('image');assert.ok(release);
  const offered=await preflightOutputImageSlidesTarget({env,
    target:{id:'template-image',selected:true,blocking_issues:[],media_kind:'image',source_scope:{kind:'document'},
      aspect_ratio:{width:1,height:1},instruction_text:'Show a pear orchard',label:'Template image',coverage:{kind:'document_outline'}},
    context:{snapshot:{facts:[{type:'subject',properties:{text:'A pear orchard'}}]}}});
  assert.equal(offered.available,true);
  const settings=offered.settings,payload=settings.payload;
  const adapter=selectImageAdapter(env,{quality:'high',size:'1024x1024',references:[]});
  const planning=route.OPENAI_IMAGE_DIRECTION_CONTRACT,image=route.OPENAI_IMAGE_GENERATION_CONTRACT,safety=route.OPENAI_IMAGE_MODERATION_CONTRACT;
  return {version:2,appId:'image',recipeVersion:`image@${release.definition.revision}`,releaseDigest:release.releaseHash,
    outputKind:'image',inputMode:'text-only',outputCount:1,durationMs:0,width:1024,height:1024,
    route:offered.route,maximumCalls:offered.maximumCalls,maximumTokens:offered.maximumTokens,maximumMicrousd:offered.maximumMicrousd,
    calls:structuredClone(settings.calls),settings:{kind:settings.kind,productionMode:payload.productionMode,
      budgetAcknowledged:payload.budgetAcknowledged,preflightAcknowledged:payload.preflightAcknowledged,
      imageRender:structuredClone(settings.imageRender),imageBudget:structuredClone(settings.imageBudget),executionPolicy:structuredClone(settings.executionPolicy)},
    transport:{planning:{api:planning.api,maximumOutputTokens:planning.maximumOutputTokens,reasoningEffort:planning.reasoning.effort,
      verbosity:planning.text.verbosity,format:{type:planning.text.format.type,name:planning.text.format.name,strict:planning.text.format.strict,
        schemaDigest:await digest(route.OPENAI_IMAGE_DIRECTION_SCHEMA)},store:planning.store},
    image:{api:image.api,adapterId:adapter.adapterId,adapterVersion:adapter.adapterVersion,quality:image.defaults.quality,
      outputFormat:image.defaults.outputFormat,partialImages:image.defaults.partialImages,outputCount:image.outputCount},
    safety:{api:safety.api,provider:'openai',model:safety.model,maximumCalls:safety.maximumCalls,input:safety.input}}};
}

export function request(f,overrides={}){
  return new Request(DRIVER_URL,init({...f.command,...overrides},f.actorHeaders));
}

/** The real approval boundary authenticates the synthetic payer. Tests may
 * supply a different proposal before approval to exercise reviewed limits. */
export async function approve(f,{proposal=f.proposal,approvalId=`approval-${f.campaignId}`}={}){
  const compiled=await compileSponsorApprovalProposal(proposal);
  const approvalCommand={action:'approve-sponsor-campaign',approvalId,proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:compiled.termsDigest};
  const approvalRequest=new Request(APPROVAL_URL,init(approvalCommand,f.payerHeaders));
  const approved=await approveSponsorCampaign(approvalRequest,f.env);
  Object.assign(f,{proposal,policy:approved.policy,compiled:approved,approval:approved,approvalCommand});
  return approved;
}

/** Disposable real SQLite and native save/confirm only. The driver under test
 * must perform its own text-intake, preflight, issuance and paid execution.
 * Install installImageTransport(t) before using the fixture, then pass fresh
 * f.request() instances to the driver. Setup itself fails on every fetch. */
export async function fixture(t,{documentId='sponsor-driver-image',campaignId='fixture-driver-campaign',actorUserId=actor,
  payerUserId=payer,intentKey='driver-intent-1',sourceText='A pear orchard beside a stone wall',approved=true}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());
  const originalFetch=globalThis.fetch;let setupFetchAttempts=0;
  globalThis.fetch=()=>{setupFetchAttempts++;throw Error('Sponsor driver fixture setup prohibits network');};
  try{
    Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
    const actorHeaders=headersFor(actorUserId),payerHeaders=headersFor(payerUserId),stream=`creative:${actorUserId}`;
    for(const headers of [actorHeaders,payerHeaders])assert.equal((await handleSession(new Request('http://localhost/api/session',{headers}),f.env)).status,200);
    f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id IN(?,?)').run(POLICY_VERSION,actorUserId,payerUserId);
    assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers:actorHeaders}),f.env)).status,200);
    await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Dormant sponsor driver fixture'});
    const sourceBlockId=`source-${documentId}`,outputBlockId=`output-${documentId}`;
    await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:sourceBlockId,
      type:'subject',handle:sourceBlockId,position:'0',properties:{text:sourceText,weight:1}});
    let sequence=0;
    const send=async body=>handleOutputRequirements(new Request(`http://localhost${BASE}`,init({documentId,
      expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:`driver-setup-${++sequence}`,...body},actorHeaders)),
    f.env,BASE,context,outputDocumentExecutionBridge);
    const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
    const parsed=parseOutputRequirement({id:outputBlockId,type:'Output',subtype:'Social media image',content:'1 image at aspect ratio "1:1"'});
    assert.ok(parsed.spec);const deliverable=parsed.spec.deliverables.find(value=>value.media_kind==='image');assert.ok(deliverable);
    deliverable.quantity={kind:'exact',unit:'image',value:1};deliverable.coverage={kind:'document_outline'};
    deliverable.format_variants.forEach(value=>{value.quantity={kind:'exact',unit:'image',value:1};value.required=true;});
    await ok(await send({action:'save',blockId:parsed.spec.id,spec:parsed.spec}));
    const confirmed=await ok(await send({action:'confirm'}));assert.equal(confirmed.snapshot.confirmedPlan.plan.targets.length,1);
    const planRevisionId=confirmed.command.planRevisionId,targetId=confirmed.snapshot.confirmedPlan.plan.targets[0].id;
    // These modules are late imports because this helper also supports work on
    // the dormant driver and issuer before their source files are assembled.
    const [{SPONSOR_ISSUER_SCHEMA},{SPONSOR_DRIVER_SCHEMA}]=await Promise.all([
      import('../worker/experience-sponsor-issuer.ts'),import('../worker/experience-sponsor-driver.ts'),
    ]);
    for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA,SPONSOR_DRIVER_SCHEMA]){
      assert.ok(Array.isArray(schema),'Dormant sponsor schema must be explicitly exported');
      for(const sql of schema)f.sqlite.exec(sql);
    }
    const now=f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now,template=await stableCampaignTemplate(f.env);
    const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,
      maximumPendingGrants:10,maximumInflightJobs:1};
    const resources={version:1,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,
      campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance}};
    const proposal={policy:{version:2,mode:'candidate',campaignId,policyVersion:'driver-fixture@1',payerUserId,
      audience:'canonical-principal',startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,
      maximumAdmissions:10,maximumMicrousd:Math.max(1_000_000,template.maximumMicrousd*10),maximumAdmissionsPerActor:5,
      windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources},
    eligibleActorUserIds:[actorUserId],issuerUserIds:[actorUserId]};
    const command={action:'run-sponsored-image',campaignId,documentId,planRevisionId,targetId,intentKey};
    Object.assign(f,{actor:actorUserId,payer:payerUserId,actorHeaders,payerHeaders,stream,documentId,campaignId,planRevisionId,targetId,
      sourceText,sourceBlockId,outputBlockId,confirmed,command,proposal,template,resources,context,send,ok});
    f.request=overrides=>request(f,overrides);f.approve=options=>approve(f,options);
    if(approved)await approve(f);
    for(const table of ['output_preflights','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations',
      'output_provider_calls','experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs']){
      const exists=f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if(exists)assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`Fixture must not populate ${table}`);
    }
    assert.equal(setupFetchAttempts,0);
    return f;
  }finally{globalThis.fetch=originalFetch;}
}

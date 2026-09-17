import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();

const [{handleSession,POLICY_VERSION},{ensureOutputRequirementsSchema},{handleExperienceIntake},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},
  {SPONSOR_APPROVAL_SCHEMA,compileSponsorApprovalProposal,approveSponsorCampaign},
  {preflightOutputImageSlidesTarget},{registeredExperience,initialValues},{digest},{selectImageAdapter},route] = await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/output-requirements-ledger.ts'),import('../worker/experience-intake-api.ts'),
  import('../worker/experience-sponsor-entitlement.ts'),import('../worker/experience-sponsor-resources.ts'),
  import('../worker/experience-sponsor-approval.ts'),import('../worker/output-image-slides-preflight.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/image-adapter-selection.ts'),
  import('../worker/openai-image-route-contract.ts'),
]);

export {installImageTransport} from './sponsor-native-fixture.mjs';
export const actor='fixture-intake-actor',payer='fixture-intake-payer';
export const context={waitUntil(){throw Error('No detached work permitted');}};
const INTAKE_URL='http://localhost/__fixture/sponsor-initial-intake';
const APPROVAL_URL='http://localhost/__fixture/sponsor-approval';
const databaseClock="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
export const headersFor=userId=>({'oai-authenticated-user-id':userId,'oai-authenticated-user-email':`${userId}@example.invalid`});
const init=(body,headers={})=>({method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});

/** The shared SQLite shim routes WITH statements through all(), which executes
 * DML but omits its changed-row count. Native private storage checks every
 * publication acknowledgment, so recover the actual SQLite count for WITH DML
 * here. Plain SELECT metadata remains zero, even following a prior write. */
function withDmlMetadata(f){
  const originalPrepare=f.DB.prepare.bind(f.DB),decorated=new WeakSet();
  const withDml=/^\s*WITH\s+[A-Za-z_]\w*(?:\s*\([^)]*\))?\s+AS\s*\([\s\S]*\)\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[A-Za-z_]\w*/iu;
  const decorate=statement=>{
    if(decorated.has(statement))return statement;
    decorated.add(statement);
    const originalBind=statement.bind.bind(statement),originalExecute=statement.execute.bind(statement);
    statement.bind=(...bindings)=>decorate(originalBind(...bindings));
    statement.execute=kind=>{
      const result=originalExecute(kind);
      if(kind==='all'&&withDml.test(statement.sql))result.meta.changes=Number(f.sqlite.prepare('SELECT changes() AS changes').get().changes);
      return result;
    };
    return statement;
  };
  f.DB.prepare=sql=>decorate(originalPrepare(sql));
}

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

/** A real registered Image request, without creating a draft or Document. */
export async function nativeRequest({intentId=randomUUID(),subject='A pear orchard beside a stone wall',ratio={width:1,height:1},...overrides}={}){
  const release=await registeredExperience('image');assert.ok(release);
  const values=initialValues(release);
  values.subject={value:subject,provenance:'authored'};
  values.ratio={value:ratio,provenance:'authored'};
  return {intentId,experienceId:'image',releaseHash:release.releaseHash,values,...overrides};
}

export function requestFor(f,body,{actorUserId=f.actor,headers={},path=INTAKE_URL}={}){
  const url=path.startsWith('/')?`http://localhost${path}`:path;
  return new Request(url,init(body,{...headersFor(actorUserId),...headers}));
}

/** Actual payer-authenticated approval of synthetic, reviewed fixture terms. */
export async function approve(f,{proposal=f.proposal,approvalId=`approval-${f.campaignId}`}={}){
  const compiled=await compileSponsorApprovalProposal(proposal);
  const approvalCommand={action:'approve-sponsor-campaign',approvalId,proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:compiled.termsDigest};
  const approved=await approveSponsorCampaign(new Request(APPROVAL_URL,init(approvalCommand,f.payerHeaders)),f.env);
  Object.assign(f,{proposal,policy:approved.policy,compiled:approved,approval:approved,approvalCommand});
  return approved;
}

/** Starts with real canonical accounts and native schema only. No events API,
 * draft, Document, preflight, provider call or financial hold is created here.
 * The initial-intake operation under test must perform the first custody write.
 * Every network request during fixture setup is rejected. */
export async function fixture(t,{campaignId='fixture-intake-campaign',actorUserId=actor,payerUserId=payer,
  extraActorUserIds=[],intentId,subject='A pear orchard beside a stone wall',approved=true}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());withDmlMetadata(f);
  const originalFetch=globalThis.fetch;let setupFetchAttempts=0;
  globalThis.fetch=()=>{setupFetchAttempts++;throw Error('Sponsor initial-intake fixture setup prohibits network');};
  try{
    Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
    const actorHeaders=headersFor(actorUserId),payerHeaders=headersFor(payerUserId),stream=`creative:${actorUserId}`;
    const actors=[...new Set([actorUserId,...extraActorUserIds])],users=[...new Set([...actors,payerUserId])];
    for(const userId of users){
      assert.equal((await handleSession(new Request('http://localhost/api/session',{headers:headersFor(userId)}),f.env)).status,200);
      f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,userId);
    }
    await ensureOutputRequirementsSchema(f.env);
    // Late imports permit the fixture to be assembled alongside the dormant
    // initial-intake module, without installing any schema in production.
    const [{SPONSOR_ISSUER_SCHEMA},{SPONSOR_DRIVER_SCHEMA},{SPONSOR_INTAKE_SCHEMA}]=await Promise.all([
      import('../worker/experience-sponsor-issuer.ts'),import('../worker/experience-sponsor-driver.ts'),
      import('../worker/experience-sponsor-intake.ts'),
    ]);
    for(const schema of [SPONSOR_ENTITLEMENT_SCHEMA,SPONSOR_RESOURCE_SCHEMA,SPONSOR_APPROVAL_SCHEMA,SPONSOR_ISSUER_SCHEMA,SPONSOR_DRIVER_SCHEMA,SPONSOR_INTAKE_SCHEMA]){
      assert.ok(Array.isArray(schema),'Dormant sponsor schema must be explicitly exported');
      for(const sql of schema)f.sqlite.exec(sql);
    }
    const now=f.sqlite.prepare(`SELECT ${databaseClock} AS now`).get().now,template=await stableCampaignTemplate(f.env);
    const allowance={maximumOperations:100,maximumTextBytes:1_000_000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1_000_000,
      maximumPendingGrants:10,maximumInflightJobs:1};
    const resources={version:2,startsAtMs:now-60_000,expiresAtMs:now+3_600_000,windowMs:60_000,maximumOperationTextBytes:64_000,
      campaign:{...allowance,maximumInflightJobs:3},actor:{...allowance},
      allowedOperations:['text-intake','preflight','issuance','image-text-draft-storage']};
    const proposal={policy:{version:2,mode:'candidate',campaignId,policyVersion:'initial-intake-fixture@1',payerUserId,
      audience:'canonical-principal',startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900_000,
      maximumAdmissions:10,maximumMicrousd:Math.max(1_000_000,template.maximumMicrousd*10),maximumAdmissionsPerActor:5,
      windowMs:60_000,maximumAdmissionsPerWindow:10,maximumAdmissionsPerActorWindow:5,templates:[template],resources},
    eligibleActorUserIds:actors,issuerUserIds:actors};
    Object.assign(f,{actor:actorUserId,payer:payerUserId,actorHeaders,payerHeaders,stream,campaignId,extraActorUserIds,
      nativeRequest:await nativeRequest({intentId,subject}),proposal,template,resources,context,headersFor});
    f.prepareRequest=(native=f.nativeRequest,campaignId=f.campaignId)=>requestFor(f,{action:'prepare-sponsored-image-draft',campaignId,request:native});
    f.commitRequest=(plan,campaignId=f.campaignId)=>requestFor(f,{action:'commit-sponsored-image-draft',campaignId,draftId:plan.draftId,draftHash:plan.draftHash});
    f.approve=options=>approve(f,options);
    f.nativeCall=(path,method='GET',body,headers={})=>{
      const pathname=path.startsWith('/')?path:`/api/experiences/${path}`;
      return handleExperienceIntake(new Request(`http://localhost${pathname}`,{
        method,headers:{...actorHeaders,...(body===undefined?{}:{'content-type':'application/json'}),...headers},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
      }),f.env);
    };
    if(approved)await approve(f);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN('ProjectCreated','DocumentCreated','BlockCreated')").get().n,0,
      'Initial-intake fixture must not precreate creative context');
    for(const table of ['private_content','output_preflights','output_execution_grants','document_jobs','budget_reservations','cost_budget_reservations',
      'output_provider_calls','experience_sponsor_grants','experience_sponsor_resource_receipts','experience_sponsor_consumptions','experience_sponsor_active_jobs']){
      const exists=f.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if(exists)assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,`Fixture must not populate ${table}`);
    }
    assert.equal(setupFetchAttempts,0);
    return f;
  }finally{globalThis.fetch=originalFetch;}
}

import assert from 'node:assert/strict';
import {fixture as v8Fixture,actor,payer,headers,post,context,compileSponsorApprovalProposal,approveSponsorCampaign} from './sponsor-audio-v8-native-fixture.mjs';
import {snapshot} from './sponsor-audio-evidence-fixture.mjs';
import {canonicalJson,digest} from '../src/experiences/compiler.ts';
import {registeredExperience} from '../src/experiences/intake.ts';
import {AUDIO_OUTPUT_POLICY} from '../src/model/output-audio-contract.ts';
import {EXPERIENCE_AUDIO_INTENT} from '../src/experiences/contracts.ts';
import {STABLE_AUDIO_ADAPTER_CONTRACT,estimateAudioProviderCostMicrousd} from '../src/model/audio.ts';
import {OUTPUT_NATIVE_EXECUTION_POLICY} from '../src/model/output-execution-policy.ts';
const [{OPENAI_TEXT_PRICING_VERSION,estimateOpenAITextCallMaximumMicrousd},{readSponsorAudioCampaignTemplate,SPONSOR_AUDIO_TRANSFER_DESCRIPTION},
  {SPONSOR_DRIVER_SCHEMA},{loadOutputTrustedContext,outputExperienceCommands},{streamHead}]=await Promise.all([
  import('../worker/openai-text-cost.ts'),import('../worker/experience-sponsor-audio-contract.ts'),
  import('../worker/experience-sponsor-driver.ts'),import('../worker/output-requirements-api.ts'),import('../worker/runtime.ts'),
]);

// This inert campaign template is derived directly from the registered release
// and accepted native constants. It is not manufactured native evidence, a
// consent object, an issuance, or a substitute for the new review owner.
export async function stableAudioTemplate(){
  const release=await registeredExperience('audio');assert.ok(release);
  const planningMaximum=Math.max(500000,estimateOpenAITextCallMaximumMicrousd('gpt-5.6-terra',61000,3000));
  const audioMaximum=estimateAudioProviderCostMicrousd(STABLE_AUDIO_ADAPTER_CONTRACT,EXPERIENCE_AUDIO_INTENT);
  const calls=[0,1].map(index=>({stage:index?'planning:0:repair':'planning:0:initial',provider:'openai',model:'gpt-5.6-terra',
    optional:index===1,maximumInputTokens:61000,maximumOutputTokens:3000,maximumMicrousd:planningMaximum}));
  calls.push({stage:'audio:initial',provider:'fal',model:'fal-ai/stable-audio-3/medium/text-to-audio',optional:false,maximumMicrousd:audioMaximum});
  return readSponsorAudioCampaignTemplate({version:1,family:'canonical-instrumental-cue@1',appId:'audio',recipeVersion:`audio@${release.definition.revision}`,releaseDigest:release.releaseHash,
    outputKind:'audio',inputMode:'authorized-document-text',outputCount:1,durationMs:20000,width:0,height:0,route:'document-audio-timed-music-manual-v1',
    maximumCalls:3,maximumTokens:128000,maximumMicrousd:planningMaximum*2+audioMaximum,calls,audioContract:AUDIO_OUTPUT_POLICY,
    mediaRequest:{duration:20,output_format:'mp3',enable_safety_checker:true,negative_prompt:'singing, vocals, spoken dialogue'},sourceFilesTransferred:0,
    pricingVersion:OPENAI_TEXT_PRICING_VERSION,adapterVersion:STABLE_AUDIO_ADAPTER_CONTRACT.adapterVersion,executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY,
    transferDescription:SPONSOR_AUDIO_TRANSFER_DESCRIPTION});
}

export function trapEgress(t){
  const calls=[];
  t.mock.method(globalThis,'fetch',async(input,init)=>{calls.push({url:String(input instanceof Request?input.url:input),method:init?.method??(input instanceof Request?input.method:'GET')});throw Error('Server review/authorize has no network authorization');});
  t.after(()=>assert.deepEqual(calls,[]));return calls;
}
export function readonlyDatabase(f){
  const prepare=f.env.DB.prepare,attempts=[];
  f.env.DB.prepare=function(sql){
    if(!/^\s*(?:SELECT|WITH)\b/iu.test(sql)||/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/iu.test(sql)){attempts.push(sql);throw Error('Passive Audio review attempted a write');}
    return prepare.call(this,sql);
  };
  return()=>{f.env.DB.prepare=prepare;assert.deepEqual(attempts,[]);};
}
export function traceDatabase(f){
  const prepare=f.env.DB.prepare,batch=f.env.DB.batch,trace=[],descriptions=new WeakMap();
  const wrap=(statement,sql,bindings=[])=>{
    const proxy={bind:(...values)=>wrap(statement.bind(...values),sql,values)};
    descriptions.set(proxy,{statement,sql,bindings});
    for(const method of ['first','all','run'])proxy[method]=async(...args)=>{
      const entry={kind:method,sql,bindings};trace.push(entry);
      try{return await statement[method](...args);}catch(error){entry.error=String(error);throw error;}
    };
    return proxy;
  };
  f.env.DB.prepare=function(sql){return wrap(prepare.call(this,sql),sql);};
  f.env.DB.batch=async statements=>{
    const items=statements.map(statement=>{const item=descriptions.get(statement);assert.ok(item,'Every application statement remains original');return item;});
    const entry={kind:'batch',statements:items.map(({sql,bindings})=>({sql,bindings}))};trace.push(entry);
    try{return await batch.call(f.env.DB,items.map(item=>item.statement));}catch(error){entry.error=String(error);throw error;}
  };
  return {trace,restore(){f.env.DB.prepare=prepare;f.env.DB.batch=batch;}};
}

export async function fixture(t,{strict=true,approve=true,maximumAdmissions=1,maximumPendingGrants=1,controller=new AbortController()}={}){
  const f=await v8Fixture(t,{sponsor:false,strict,controller});
  for(const sql of SPONSOR_DRIVER_SCHEMA)f.sqlite.exec(sql);
  const effects={media:0,assets:0,detached:0};
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{effects.media++;throw Error('Server review/authorize cannot read or write media');};
  f.env.ASSETS.fetch=()=>{effects.assets++;throw Error('Server review/authorize cannot fetch assets');};
  f.executionContext={waitUntil(){effects.detached++;throw Error('Server review/authorize cannot detach work');}};
  t.after(()=>assert.deepEqual(effects,{media:0,assets:0,detached:0}));
  f.effects=effects;f.campaignId='fixture-audio-server-campaign';f.template=await stableAudioTemplate();f.templateDigest=await digest(f.template);
  f.config={campaignId:f.campaignId,templateDigest:f.templateDigest,preflightId:f.terms.id};
  f.approve=async()=>{
    const now=(await f.env.DB.prepare("SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS now").first()).now;
    const allowance={maximumOperations:100,maximumTextBytes:1000000,maximumOperationsPerWindow:100,maximumTextBytesPerWindow:1000000,maximumPendingGrants,maximumInflightJobs:1};
    const resources={version:1,startsAtMs:now-60000,expiresAtMs:now+3600000,windowMs:60000,maximumOperationTextBytes:64000,campaign:{...allowance},actor:{...allowance}};
    const proposal={policy:{version:8,family:'canonical-instrumental-cue@1',mode:'candidate',campaignId:f.campaignId,policyVersion:'audio-server-fixture@1',payerUserId:payer,audience:'canonical-principal',
      startsAtMs:resources.startsAtMs,expiresAtMs:resources.expiresAtMs,maximumGrantLifetimeMs:900000,maximumAdmissions,maximumMicrousd:f.template.maximumMicrousd*maximumAdmissions,
      maximumAdmissionsPerActor:maximumAdmissions,windowMs:60000,maximumAdmissionsPerWindow:maximumAdmissions,maximumAdmissionsPerActorWindow:maximumAdmissions,
      templates:[f.template],resources},eligibleActorUserIds:[actor],issuerUserIds:[actor]};
    const terms=await compileSponsorApprovalProposal(proposal);
    f.approvalCommand={action:'approve-sponsor-campaign',approvalId:'fixture-audio-server-approval',proposal,confirmation:'APPROVE_SPONSOR_CAMPAIGN',reviewedTermsDigest:terms.termsDigest};
    const approved=await approveSponsorCampaign(new Request('http://localhost/__fixture/audio-server-approval',post(f.approvalCommand,headers(payer))),f.env);
    f.policy=approved.policy;return approved;
  };
  f.load=async(request)=>{const trusted=await loadOutputTrustedContext(request,f.env,f.documentId,'request');assert.ok(!(trusted instanceof Response),trusted instanceof Response?await trusted.clone().text():'');assert.equal(trusted.request,request);return trusted;};
  f.reviewRequest=()=>new Request(`http://localhost/api/experiences/sponsor/audio/drafts/${f.draftId}/review`,{signal:f.controller.signal});
  f.readReview=async(request=f.reviewRequest(),config=f.config)=>{
    const {readSponsorAudioCurrentReview}=await import('../worker/experience-sponsor-audio-review.ts');
    return readSponsorAudioCurrentReview(await f.load(request),config);
  };
  // Synthetic explicit actor input is supplied only when this test operation is
  // called. Passive review never consumes f.command or this consent object.
  f.actorBody=shown=>({draftHash:f.draftHash,termsDigest:shown.review.termsDigest,maximumMicrousd:shown.review.preview.maximumMicrousd,explicitAuthorization:true,
    audioCostConsent:{...structuredClone(shown.review.preview),confirmed:true,providerTransferConfirmed:true},
    sponsorReview:{campaignId:shown.review.campaignId,reviewDigest:shown.reviewDigest}});
  f.actorRequest=(body,options={})=>new Request(`http://localhost${f.path}/authorize`,{...post(body,options.headers),signal:options.signal??f.controller.signal});
  f.authorize=async(body,options={})=>{
    const {authorizeSponsoredAudio}=await import('../worker/experience-sponsor-audio-authorize.ts');
    const request=options.request??f.actorRequest(body,options),trusted=await f.load(request);
    return authorizeSponsoredAudio(trusted,options.config??f.config);
  };
  f.prepareActor=async(shown)=>{
    shown??=await f.readReview();
    const body=f.actorBody(shown),request=f.actorRequest(body),trusted=await f.load(request);
    const command={...f.command,expectedRevision:`output:${await streamHead(f.env,`creative:${actor}`)}`};
    const preparation=await outputExperienceCommands.prepareSponsoredAudioAdmission(trusted,command,shown.review);
    return Object.assign(f,{shown,review:shown.review,body,request,trusted,command,preparation});
  };
  if(approve)await f.approve();return f;
}
export {actor,payer,headers,post,context,snapshot,canonicalJson,digest,outputExperienceCommands};

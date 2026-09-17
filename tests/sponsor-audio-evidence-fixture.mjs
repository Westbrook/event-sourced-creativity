import assert from 'node:assert/strict';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [{handleSession,POLICY_VERSION},{handleEvents},{handleExperienceIntake},{handleExperienceOutput},
  {registeredExperience},{outputDocumentExecutionBridge},{loadOutputTrustedContext},{describeSponsorAudioAdmission,readSponsorAudioTemplateEvidence}]=await Promise.all([
  import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/experience-intake-api.ts'),import('../worker/experience-output-api.ts'),
  import('../src/experiences/intake.ts'),import('../worker/output-document-execution.ts'),import('../worker/output-requirements-api.ts'),
  import('../worker/experience-sponsor-audio-evidence.ts'),
]);
export const actor='dev-local-creative';
export const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
export const rows=f=>f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()]);
export const snapshot=f=>({rows:rows(f),changes:f.sqlite.prepare('SELECT total_changes() AS n').get().n,schema:f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()});
export function assertUnpaid(f){
  for(const name of ['document_jobs','output_execution_grants','output_operation_slots','output_provider_calls','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n,0,name);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'experience_sponsor_%'").get().n,0);
}
export function noWrites(f){const prepare=f.env.DB.prepare.bind(f.env.DB);let attempted=0;
  f.env.DB.prepare=sql=>{if(!/^\s*(?:SELECT|WITH)\b/iu.test(sql)||/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/iu.test(sql)){attempted++;throw Error('Audio evidence attempted non-read SQL');}return prepare(sql);};
  return ()=>assert.equal(attempted,0,'No write, including a no-op, may be attempted by the evidence reader');
}
/** Native registered intake and native prepare command only. No authorization,
 * sponsor schema, financial reservation, media or provider operation is created. */
export async function fixture(t,{direction='A rising original instrumental motif, then a quiet finish. 水 — موسيقى',detail='One sustained ending.',configuration={}}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());Object.assign(f.env,{OPENAI_API_KEY:'synthetic-presence-no-egress',FAL_KEY:'synthetic-presence-no-egress',OPENAI_MODEL:'gpt-5.6-terra'},configuration);
  const effects={media:0,assets:0,detached:0};
  for(const operation of ['get','head','put','delete','list'])f.env.MEDIA[operation]=()=>{effects.media++;throw Error('No media access');};
  f.env.ASSETS.fetch=()=>{effects.assets++;throw Error('No asset fetch');};
  const executionContext={waitUntil(){effects.detached++;throw Error('No detached work');}};
  assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
  const release=await registeredExperience('audio');assert.ok(release);
  const intent={experienceId:'audio',intentId:'00000000-0000-4000-8000-000000000098',releaseHash:release.releaseHash,
    values:{direction:{value:direction,provenance:'authored'},detail:{value:detail,provenance:'authored'}}};
  let response=await handleExperienceIntake(new Request('http://localhost/api/experiences/drafts',post(intent)),f.env);
  assert.equal(response.status,200,await response.clone().text());const plan=(await response.json()).plan;
  response=await handleExperienceIntake(new Request(`http://localhost/api/experiences/drafts/${plan.draftId}/commit`,post({draftHash:plan.draftHash})),f.env);
  assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'complete');
  const path=`/api/experiences/drafts/${plan.draftId}/output`;
  response=await handleExperienceOutput(new Request(`http://localhost${path}/prepare`,post({draftHash:plan.draftHash,explicitRequirementsConfirmation:true})),f.env,executionContext,outputDocumentExecutionBridge);
  assert.equal(response.status,200,await response.clone().text());const state=await response.json();
  const quote=f.sqlite.prepare('SELECT preflight_id,terms_digest,event_id FROM output_preflights ORDER BY created_at DESC LIMIT 1').get();assert.ok(quote,JSON.stringify(state));
  const terms=JSON.parse(f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(quote.event_id).private_json).preflight;
  assert.equal(terms.targets.length,1);assert.equal(terms.targets[0].available,true);const preview=terms.targets[0].settings.costPreview;
  const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(`creative:${actor}`).n;
  const command={documentId:plan.documentId,action:'authorize',expectedRevision:`output:${head}`,clientMutationId:'audio-sponsored-review-only',preflightId:terms.id,
    termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true,audioCostConsent:{...preview,confirmed:true,providerTransferConfirmed:true}};
  const request=new Request(`http://localhost${path}/authorize`,post(command));
  const reloadTrusted=async()=>{const value=await loadOutputTrustedContext(request,f.env,plan.documentId,'request');assert.ok(!(value instanceof Response));return value;};
  const trusted=await reloadTrusted();
  t.after(()=>assert.deepEqual(effects,{media:0,assets:0,detached:0}));
  Object.assign(f,{documentId:plan.documentId,draftId:plan.draftId,plan,terms,command,request,trusted,reloadTrusted,effects});
  assertUnpaid(f);return f;
}
export async function actualEvidence(f){const described=await describeSponsorAudioAdmission(f.trusted,f.command);return{described,actual:await readSponsorAudioTemplateEvidence(f.trusted,f.command,described.recipe)};}
export async function nativeTemplate(actual){
  const [{AUDIO_OUTPUT_POLICY},{OUTPUT_NATIVE_EXECUTION_POLICY},{STABLE_AUDIO_ADAPTER_CONTRACT},{OPENAI_TEXT_PRICING_VERSION,estimateOpenAITextCallMaximumMicrousd}]=await Promise.all([
    import('../src/model/output-audio-contract.ts'),import('../src/model/output-execution-policy.ts'),import('../src/model/audio.ts'),import('../worker/openai-text-cost.ts'),
  ]);
  const calls=actual.offered.settings.calls.map((call,index)=>({...structuredClone(call),optional:index===1,...(index<2?{maximumInputTokens:61000,maximumMicrousd:Math.max(500000,estimateOpenAITextCallMaximumMicrousd(call.model,61000,3000))}:{})}));
  return{version:1,family:'canonical-instrumental-cue@1',appId:'audio',recipeVersion:actual.recipe.recipeVersion,releaseDigest:actual.recipe.releaseDigest,
    outputKind:'audio',inputMode:'authorized-document-text',outputCount:1,durationMs:20000,width:0,height:0,route:'document-audio-timed-music-manual-v1',maximumCalls:3,maximumTokens:128000,
    maximumMicrousd:calls.reduce((sum,call)=>sum+call.maximumMicrousd,0),calls,audioContract:AUDIO_OUTPUT_POLICY,
    mediaRequest:{duration:20,output_format:'mp3',enable_safety_checker:true,negative_prompt:'singing, vocals, spoken dialogue'},sourceFilesTransferred:0,
    pricingVersion:OPENAI_TEXT_PRICING_VERSION,adapterVersion:STABLE_AUDIO_ADAPTER_CONTRACT.adapterVersion,executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY,
    transferDescription:actual.offered.transferDescription};
}

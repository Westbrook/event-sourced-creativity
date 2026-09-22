import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { generateCreativeDirection, generateCreativeImage } from '../worker/openai-adapter.ts';
import { classifyProviderFailure, providerErrorFromResponse, publicFailureDetail, providerFailureOrigin } from '../worker/provider-errors.ts';
import { privateGenerationEvidenceObserver } from '../worker/provider-submission.ts';
import { PAID_PROVIDER_FINANCIAL_FIELDS, hasUnsettledProviderSubmission } from '../src/model/provider-submission.ts';
import { generationOutcomeSummary } from '../src/model/generation-execution-evidence.ts';
import { GENERATION_OUTCOME_SCHEMA } from '../src/model/generation-outcome-evidence.ts';
const env={OPENAI_API_KEY:'offline-only'};
const usage={input_tokens:1,output_tokens:2,total_tokens:3};
const pass=()=>Response.json({id:'mod-id',model:'omni-returned',results:[{flagged:false,categories:{},category_scores:{}}]},{headers:{'x-request-id':'mod-request'}});
const withFetch=async(fn,run)=>{const old=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=old;}};

for(const [status,code,category] of [[401,'invalid_api_key','authentication'],[403,'permission_denied','access'],[429,'rate_limit_exceeded','rate_limit'],[503,'server_error','server'],[400,'invalid_value','provider']])test(`generic rejection preserves ${status} ${category}`,()=>{
  const detail=classifyProviderFailure(new Error('fallback'),new Response(null,{status}),{error:{code,message:'request was rejected'}});
  assert.equal(detail.category,category);
});
for(const stage of ['input','output',undefined])test(`provider safety stage ${stage??'unknown'} stays independent of request scope`,()=>{
  const details=stage?{stage,categories:['synthetic']}:undefined;
  const error=providerErrorFromResponse(new Response(null,{status:400,headers:{'x-request-id':'req'}}),{error:{code:'moderation_blocked',type:'image_error',param:'prompt',message:'Blocked',...(details?{moderation_details:details}:{})}},'fallback',null,'media_result');
  assert.equal(error.detail.scope,'request');assert.equal(providerFailureOrigin(error.detail),'provider');assert.equal(error.detail.providerModerationStage,stage??'unknown');
  assert.deepEqual(error.detail.moderationDetails,details);assert.equal(error.detail.providerError.param,'prompt');assert.equal('providerError' in publicFailureDetail(error.detail),false);
});
test('planner refusal is checkpointed before return and keeps measured usage',async()=>{
  const observations=[],calls=[];
  await withFetch(async()=>Response.json({id:'resp',model:'returned-planner',status:'completed',output:[{content:[{type:'refusal',refusal:'Cannot comply'}]}],usage}),async()=>{
    await assert.rejects(()=>generateCreativeDirection(env,'user',{facts:[]},undefined,undefined,r=>calls.push(r),{onEvidence:e=>observations.push(e)}),e=>e.detail.category==='safety'&&e.detail.pipelineStage==='planner');
  });
  assert.deepEqual(observations.map(e=>e.phase),['request','response']);assert.equal(observations[1].outcome.contentOutcome,'refused');assert.equal(calls.at(-1).accountingState,'usage_recorded');assert.equal(observations[1].operation.returnedModel,'returned-planner');
});
test('incomplete Responses cannot become a usable planner result',async()=>withFetch(async()=>Response.json({id:'incomplete',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:'{"scene":"partial"}',usage}),async()=>{
  await assert.rejects(()=>generateCreativeDirection(env,'user',{facts:[]}),e=>e.detail.code==='provider_response_incomplete');
}));
test('each moderation probe pass survives downstream image safety failure',async()=>{
  const evidence=[],order=[];
  await withFetch(async(url)=>{order.push(String(url));return String(url).endsWith('/moderations')?pass():Response.json({error:{code:'moderation_blocked',moderation_details:{stage:'output'},message:'blocked'}},{status:400,headers:{'x-request-id':'image-request'}});},async()=>{
    await assert.rejects(()=>generateCreativeImage(env,'user',{facts:[]},{},{onEvidence:async e=>{evidence.push(e);order.push(e.phase+':'+e.outcome.pipelineStage);},references:[{bytes:new Uint8Array([1]),mimeType:'image/png',source:'uploaded-reference'}]}));
  });
  const probes=evidence.filter(e=>e.safety);assert.equal(probes.length,2);assert.ok(probes.every(e=>e.safety.verdict==='clear'));assert.equal(evidence.at(-1).outcome.providerModerationStage,'output');assert.equal(evidence.at(-1).outcome.contentOutcome,'refused');assert.equal(evidence.at(-1).operation.requestSha256,null); // multipart boundary not reconstructed
  assert.ok(order.indexOf('response:app_moderation')<order.indexOf('https://api.openai.com/v1/images/edits'));
});
test('local preflight flags stop image dispatch',async()=>{
  let requests=0;await withFetch(async()=>{requests++;return Response.json({results:[{flagged:true,categories:{violence:true}}]});},async()=>{
    await assert.rejects(()=>generateCreativeImage(env,'user',{facts:[]},{},{}),e=>e.detail.pipelineStage==='app_moderation'&&providerFailureOrigin(e.detail)==='application');
  });assert.equal(requests,1);
});
test('streaming structured errors retain code, param and moderation details',async()=>{
  const evidence=[];
  await withFetch(async url=>String(url).endsWith('/moderations')?pass():new Response('data: '+JSON.stringify({type:'error',error:{code:'moderation_blocked',param:'prompt',message:'blocked',moderation_details:{stage:'input'}}})+'\n\n'),async()=>{
    await assert.rejects(()=>generateCreativeImage(env,'user',{facts:[]},{},{partialImages:1,onEvidence:e=>evidence.push(e)}),e=>e.detail.code==='moderation_blocked'&&e.detail.providerError.param==='prompt');
  });assert.equal(evidence.at(-1).outcome.providerModerationStage,'input');
});
test('usable pixels without usage remain unknown accounting, never refusal or zero settlement',async()=>{
  const evidence=[],calls=[];
  await withFetch(async url=>String(url).endsWith('/moderations')?pass():Response.json({data:[{b64_json:btoa('pixels')}]}),async()=>{
    await assert.rejects(()=>generateCreativeImage(env,'user',{facts:[]},{},{onEvidence:e=>evidence.push(e),onProviderSubmission:r=>calls.push(r)}),e=>e.detail.code==='provider_usage_receipt_missing');
  });assert.equal(evidence.at(-1).outcome.contentOutcome,'usable');assert.equal(evidence.at(-1).outcome.accountingState,'unknown');assert.equal(calls.at(-1).inputTokens,undefined);assert.equal(hasUnsettledProviderSubmission({providerSubmissions:{[calls[0].clientRequestId]:calls[0]}}),true);
});
test('private custody is awaited and financial allowlist has no raw evidence',async()=>{
  const checkpoint={},order=[];const observe=privateGenerationEvidenceObserver(async()=>{order.push('retained');return{ref:'private-ref',expiresAt:'2099-01-01'};},checkpoint,async()=>order.push('checkpoint'));
  await observe({schemaVersion:'forma-private-generation-evidence-v1',evidenceId:'e',phase:'response',outcome:{pipelineStage:'planner'},requestBody:'private prompt'});
  assert.deepEqual(order,['retained','checkpoint']);assert.equal(JSON.stringify(checkpoint).includes('private prompt'),false);assert.equal(PAID_PROVIDER_FINANCIAL_FIELDS.includes('requestBody'),false);
});
test('storage failure preserves usable content and measured accounting; historical fields are not invented',()=>{
  const old={generationReceipt:{model:'gpt-image-2',failure_stage:'application'}};assert.equal(generationOutcomeSummary(old),null);
  const generationOutcome={schemaVersion:GENERATION_OUTCOME_SCHEMA,pipelineStage:'media_result',providerModerationStage:'unknown',failureKind:null,correctiveActionScope:'unknown',contentOutcome:'usable',dispatchState:'response_received',accountingState:'usage_recorded'};
  const summary=generationOutcomeSummary({generationOutcome},{category:'server'},'storage');assert.equal(summary.contentOutcome,'usable');assert.equal(summary.failureKind,'storage');assert.equal(summary.accountingState,'usage_recorded');
});
test('schema examples contain orthogonal outcomes and no historical rewrite',async()=>{const fixtures=JSON.parse(await readFile(new URL('../docs/fixtures/generation-outcome-v1.json',import.meta.url)));assert.equal(fixtures.cases.length,7);assert.equal(fixtures.historical.model,'gpt-image-2');});
test('evidence observation leaves JSON image request bytes and paid retry count unchanged',async()=>{
  const requests=[];await withFetch(async(url,init)=>{if(String(url).endsWith('/moderations'))return pass();requests.push(init.body);return Response.json({error:{code:'server_error',message:'request was rejected'}},{status:503});},async()=>{
    for(const onEvidence of [undefined,()=>{}])await assert.rejects(()=>generateCreativeImage(env,'user',{facts:[]},{},{onEvidence}));
  });assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);
});

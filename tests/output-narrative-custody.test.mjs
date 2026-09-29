import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {SHORT_STORY_NARRATIVE_CONTRACT as contract,parseShortStoryNarrativeContract} from '../src/model/output-narrative-contract.ts';
import {OUTPUT_NATIVE_EXECUTION_POLICY} from '../src/model/output-execution-policy.ts';
import {documentRenderTokenReservation} from '../src/model/generation-budget.ts';
import {createOutputNarrativeExecution,OUTPUT_NARRATIVE_MODEL,OUTPUT_NARRATIVE_INSTRUCTIONS,captureOutputNarrativeRequest,outputNarrativeBodyReceipt} from '../worker/output-narrative-request.ts';
import {readOutputNarrativePayload,assertOutputNarrativeAttempt,outputNarrativePlannerCost,verifyOutputNarrativeCompletion} from '../worker/output-narrative-execution.ts';
import {estimateOpenAITextCallMaximumMicrousd} from '../worker/openai-text-cost.ts';
const source=file=>readFileSync(new URL('../worker/'+file,import.meta.url),'utf8');
const preflightSource=source('output-narrative-preflight.ts').slice(source('output-narrative-preflight.ts').indexOf('export async function preflightOutputNarrativeTarget'));
const preflight=new Function('parseShortStoryNarrativeContract','OUTPUT_NATIVE_EXECUTION_POLICY','record','unavailable','createOutputNarrativeExecution','OUTPUT_NARRATIVE_MODEL','estimateOpenAITextCallMaximumMicrousd',stripTypeScriptTypes(preflightSource.replace('export ',''))+';return preflightOutputNarrativeTarget;')(parseShortStoryNarrativeContract,OUTPUT_NATIVE_EXECUTION_POLICY,v=>v??{},(targetId,reasonCode)=>({targetId,reasonCode,available:false}),createOutputNarrativeExecution,OUTPUT_NARRATIVE_MODEL,estimateOpenAITextCallMaximumMicrousd);
const target=()=>({id:'unadmitted-target',narrative_contract:contract,media_kind:'document',quantity:{kind:'exact',unit:'document',value:1},source_scope:{kind:'document'},coverage:{kind:'document_context'},aspect_ratio:null,content_quantity:null,count_policy:null,variant_id:null,member_id:null,selected:true,blocking_issues:[],instruction_text:'1 story · 600–800 words\nEnglish · Fiction'});
const input=()=>({target:target(),env:{OPENAI_API_KEY:'unusable-test-presence-marker',OPENAI_MODEL:OUTPUT_NARRATIVE_MODEL},context:{snapshot:{facts:[{type:'subject',active:true,instruction:'Character'}]}}});
const request=n=>JSON.stringify({model:n.model,instructions:OUTPUT_NARRATIVE_INSTRUCTIONS,input:JSON.stringify({narrative_contract:n.contract,narrative_contract_digest:n.contractDigest}),text:{verbosity:'medium',format:{type:'json_schema',name:'document_short_story',strict:true,schema:{type:'object'}}},reasoning:{effort:'low'},max_output_tokens:6000,store:false,safety_identifier:'unadmitted-user',service_tier:'default',prompt_cache_options:{mode:'explicit'}});

test('actual unadmitted story preflight quotes exactly one existing manual document call',async()=>{
 const quote=await preflight(input());assert.equal(quote.available,true);assert.equal(quote.maximumCalls,1);assert.equal(quote.maximumTokens,128000);assert.equal(quote.settings.kind,'render_document');assert.equal(quote.settings.payload.artifactKind,'short_story');assert.equal(quote.settings.calls.length,1);assert.equal(quote.settings.calls[0].stage,'planning:0:initial');
 assert.deepEqual(await readOutputNarrativePayload(quote.settings.payload),quote.settings.payload.outputNarrative);
 for(const mutate of [v=>v.target.narrative_contract={...contract,language:'ja'},v=>v.target.media_kind='slides',v=>v.target.selected=false,v=>v.target.quantity.value=2,v=>v.target.source_scope.kind='blocks',v=>v.target.variant_id='variant',v=>v.env.OPENAI_MODEL='other',v=>delete v.env.OPENAI_API_KEY,v=>v.context.snapshot.facts=[],v=>v.context.snapshot.large='x'.repeat(30000)]){const value=input();mutate(value);assert.equal((await preflight(value)).available,false);}
});
test('original quote validates exact captured request digest, caps, model and only stage before ledger claim',async()=>{
 const {settings}=await preflight(input()),n=settings.payload.outputNarrative,captured=await captureOutputNarrativeRequest(n,'short_story',request(n),'forma-short_story-unadmitted-test');
 await assertOutputNarrativeAttempt(settings,captured.attempt);
 for(const mutate of [a=>a.requestDigest='0'.repeat(64),a=>a.logicalCallKey='planning:0:repair',a=>a.maximumOutputTokens=6001,a=>a.maximumInputTokens++,a=>a.narrative.execution.maximumInputTokens++,a=>a.narrative.requestBody=a.narrative.requestBody.replace('6000','6001'),a=>a.narrative=undefined]){const changed=structuredClone(captured.attempt);mutate(changed);await assert.rejects(assertOutputNarrativeAttempt(settings,changed));}
 for(const mutate of [s=>s.calls.push({...s.calls[0]}),s=>s.kind='generate',s=>s.calls[0].maximumInputTokens++,s=>s.payload.artifactKind='scene']){const changed=structuredClone(settings);mutate(changed);await assert.rejects(assertOutputNarrativeAttempt(changed,captured.attempt));}
});
test('actual job and direct event seams deny ordinary opt-in; trusted payload must match story contract',async()=>{
 const job=source('document-jobs-api.ts'),from=job.indexOf('  if(!outputPreparation && ['),to=job.indexOf('  let scenePrepared:',from);
 const gate=new Function('readOutputNarrativePayload','return async function(payload,outputPreparation,kind){'+job.slice(from,to)+'return "metadata-only";}')(readOutputNarrativePayload);
 for(const key of ['outputNarrative','narrativeContractDigest','contractDigest'])assert.equal((await gate({[key]:{}},null,'render_document')).status,400);
 const {settings}=await preflight(input());assert.equal(await gate(settings.payload,{},'render_document'),'metadata-only');
 assert.equal((await gate({...settings.payload,outputNarrative:null},{},'render_document')).status,422);
 assert.equal((await gate({...settings.payload,artifactKind:'scene'},{},'render_document')).status,422);
 assert.equal(await readOutputNarrativePayload({...settings.payload,productionMode:'managed'}),null);
 const events=source('events-api.ts'),line=events.split('\n').find(l=>l.includes('if(!execution?.output&&[')&&l.includes('output_execution_server_owned'));
 const direct=new Function('body','execution',line+';return "metadata-only";');assert.equal(direct({outputNarrative:{}},undefined).status,400);assert.equal(direct({narrativeContractDigest:'x'},undefined).status,400);
 const begin=job.indexOf('    const requiredTokens=kind==='),end=job.indexOf('    const scope=user.projectExecution;',begin),allow=new Function('documentRenderTokenReservation','return function(payload,nativeNarrative,outputPreparation,kind,estimatedGenerationCostMicrousd,nativeStoryboard=null,nativeAudio=null,nativeScene=null){'+job.slice(begin,end)+'return "allowance-only";}')(documentRenderTokenReservation);
 const bounds={maximumMicrousd:1000000,maximumTokens:128000,maximumCalls:1};assert.equal(allow(settings.payload,settings.payload.outputNarrative,bounds,'render_document',1000000),'allowance-only');assert.equal(allow(settings.payload,settings.payload.outputNarrative,{...bounds,maximumCalls:2},'render_document',1000000).status,409);
});
// These values exercise pure evidence validation only, not a native job or paid receipt.
async function retained(){
 const {settings}=await preflight(input()),n=settings.payload.outputNarrative,body=Array(600).fill('word').join(' '),proof=await outputNarrativeBodyReceipt(n,'short_story',body);
 const call={clientRequestId:'unadmitted-call',provider:'openai',operation:'planning',status:'completed',model:n.model,effectiveModel:n.model,unitId:n.stage,pricingVersion:n.pricingVersion,costMicrousd:300,textInputCostMicrousd:100,textOutputCostMicrousd:200,validationStatus:'valid',completionStatus:'completed',responseRef:'unadmitted-ref',providerRequestId:'unadmitted-response',requestDigest:'1'.repeat(64)};
 return{n,body,inputReceipt:{...proof,output_narrative:n,provider_calls:[{...call}]},checkpoint:{providerSubmissions:{[call.clientRequestId]:call}},call};
}
test('retained completion demands exact body, complete original call proof and current contract',async()=>{
 const v=await retained();assert.equal((await verifyOutputNarrativeCompletion(v.n,'short_story',v.body,v.inputReceipt,v.checkpoint)).narrative_word_count,600);
 for(const mutate of [v=>v.body+=' extra',v=>v.inputReceipt.narrative_word_count=601,v=>v.inputReceipt.narrative_contract_digest='0'.repeat(64),v=>v.inputReceipt.output_narrative.maximumCalls=2,v=>v.call.validationStatus='invalid',v=>v.call.completionStatus='incomplete',v=>delete v.call.responseRef,v=>delete v.call.requestDigest,v=>v.inputReceipt.provider_calls[0].clientRequestId='different-original']){const x=structuredClone(v);mutate(x);await assert.rejects(verifyOutputNarrativeCompletion(x.n,'short_story',x.body,x.inputReceipt,x.checkpoint));}
});
test('original measured cost is retained; missing amounts and model changes never fall back to repricing',async()=>{
 const v=await retained();assert.equal(outputNarrativePlannerCost(v.checkpoint,v.n).totalMicrousd,300);assert.deepEqual(outputNarrativePlannerCost(v.checkpoint,v.n,150),{textInputMicrousd:0,textOutputMicrousd:150,imageTextInputMicrousd:0,imageInputMicrousd:0,imageOutputMicrousd:0,totalMicrousd:150});
 for(const mutate of [v=>delete v.call.costMicrousd,v=>v.call.effectiveModel='other',v=>v.call.unitId='planning:0:repair',v=>v.call.textInputCostMicrousd=90,v=>v.checkpoint.providerSubmissions={}]){const x=structuredClone(v);mutate(x);assert.throws(()=>outputNarrativePlannerCost(x.checkpoint,x.n));}
});

test('native financial DTO preserves story kind without exposing retained source fields',()=>{
 const code=source('document-jobs-api.ts'),begin=code.indexOf('      const safeArtifactKind='),end=code.indexOf('\n      return Response.json({job:serializeJob(safeRow)',begin),build=new Function('final','safeReceipt','safeDetail',code.slice(begin,end)+';return safeRow;');
 const result=build({kind:'render_document',status:'failed',request_json:'private source',result_json:'private response'},{artifact_kind:'short_story',reservation_status:'executing'},null);
 assert.deepEqual(JSON.parse(result.request_json),{artifactKind:'short_story'});assert.equal(JSON.parse(result.result_json).artifactKind,'short_story');assert.ok(!result.request_json.includes('private'));assert.ok(!result.result_json.includes('private'));
});

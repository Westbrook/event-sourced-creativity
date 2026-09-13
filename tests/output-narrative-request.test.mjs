import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { SHORT_STORY_NARRATIVE_CONTRACT as contract, assessShortStoryBody } from '../src/model/output-narrative-contract.ts';
import { createOutputNarrativeExecution, readOutputNarrativeExecution, captureOutputNarrativeRequest, OUTPUT_NARRATIVE_INSTRUCTIONS, outputNarrativeResponseProblem, outputNarrativeArtifactProblem, outputNarrativeBodyReceipt } from '../worker/output-narrative-request.ts';
const execution=()=>createOutputNarrativeExecution(contract,'gpt-5.6-terra',25000);
const clientId='forma-short_story-unadmitted-test',story=Array(600).fill('word').join(' ');
const request=v=>({model:v.model,instructions:OUTPUT_NARRATIVE_INSTRUCTIONS,input:JSON.stringify({narrative_contract:v.contract,narrative_contract_digest:v.contractDigest,creative_context:{}}),text:{verbosity:'medium',format:{type:'json_schema',name:'document_short_story',strict:true,schema:{type:'object'}}},reasoning:{effort:'low'},max_output_tokens:6000,store:false,safety_identifier:'test-user',service_tier:'default',prompt_cache_options:{mode:'explicit'}});
const adapter=readFileSync(new URL('../worker/openai-adapter.ts',import.meta.url),'utf8');

test('fixed execution binds full canonical contract without locale/model fallback',async()=>{
 const value=await execution(),canonical=obj=>obj&&typeof obj==='object'?'{'+Object.keys(obj).sort().map(key=>JSON.stringify(key)+':'+canonical(obj[key])).join(',')+'}':JSON.stringify(obj);
 assert.equal(value.contractDigest,createHash('sha256').update(canonical(contract)).digest('hex'));
 assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.contract.wordRange));assert.deepEqual(await readOutputNarrativeExecution(structuredClone(value)),value);
 for(const changed of [{...value,contractDigest:'0'.repeat(64)},{...value,model:'other'},{...value,maximumInputTokens:'25000'},{...value,maximumOutputTokens:6001},{...value,maximumCalls:2},{...value,stage:'planning:0:repair'},{...value,additional:true},{...value,contract:{...contract,language:'en-US'}}])assert.equal(await readOutputNarrativeExecution(changed),null);
 let getter=false;const unusual={...value};Object.defineProperty(unusual,'model',{enumerable:true,get(){getter=true;throw Error('getter');}});assert.equal(await readOutputNarrativeExecution(unusual),null);assert.equal(getter,false);
 await assert.rejects(createOutputNarrativeExecution(contract,'other',25000));await assert.rejects(createOutputNarrativeExecution(contract,value.model,122001));
});
test('exact request binds body digest, model, contract, one stage and original caps',async()=>{
 const value=await execution(),body=JSON.stringify(request(value)),captured=await captureOutputNarrativeRequest(value,'short_story',body,clientId);
 assert.equal(captured.body,body);assert.equal(captured.attempt.narrative.requestBody,body);assert.equal(captured.attempt.requestDigest,createHash('sha256').update(body).digest('hex'));assert.equal(captured.attempt.maximumInputTokens,Buffer.byteLength(body)+4096);assert.ok(Object.isFrozen(captured.attempt.narrative));
 for(const mutate of [r=>r.model='other',r=>r.max_output_tokens=6001,r=>r.store=true,r=>r.instructions='Anything',r=>r.input='{}',r=>r.input=JSON.stringify({narrative_contract:{...contract,wordRange:{min:1,max:800}},narrative_contract_digest:value.contractDigest}),r=>r.text.format.name='document_short_story_repair',r=>r.service_tier='flex',r=>r.reasoning.effort='high',r=>r.tools=[],r=>r.prompt_cache_options.mode='auto']){const changed=request(value);mutate(changed);await assert.rejects(captureOutputNarrativeRequest(value,'short_story',JSON.stringify(changed),clientId));}
 await assert.rejects(captureOutputNarrativeRequest(value,'scene',body,clientId));await assert.rejects(captureOutputNarrativeRequest(value,'short_story',body+' ',clientId));
 const small=await createOutputNarrativeExecution(contract,value.model,4096);await assert.rejects(captureOutputNarrativeRequest(small,'short_story',JSON.stringify(request(small)),clientId));
});
test('provider completion/refusal/model metadata wins over parseable 600-word body',()=>{
 const response={id:'unadmitted-response',model:'gpt-5.6-terra',status:'completed',output_text:JSON.stringify({content_markdown:story})};assert.equal(outputNarrativeResponseProblem(response,response.model),null);
 for(const [change,expected] of [[{status:'incomplete'},'narrative_provider_response_incomplete'],[{status:undefined},'narrative_provider_response_incomplete'],[{incomplete_details:{reason:'max_output_tokens'}},'narrative_provider_response_incomplete'],[{output:[{content:[{type:'refusal',refusal:'Refused'}]}]},'narrative_provider_refused'],[{incomplete_details:{reason:'content_filter'}},'narrative_provider_refused'],[{model:'other'},'narrative_effective_model_mismatch'],[{model:undefined},'narrative_effective_model_mismatch'],[{id:''},'narrative_response_identity_missing']])assert.equal(outputNarrativeResponseProblem({...response,...change},response.model),expected);
});
test('final-body receipt counts and hashes exact retained prose without rewriting',async()=>{
 const value=await execution(),body='\n'+story+'\n',receipt=await outputNarrativeBodyReceipt(value,'short_story',body);
 assert.equal(receipt.narrative_word_count,600);assert.equal(receipt.narrative_body_sha256,createHash('sha256').update(body).digest('hex'));assert.notEqual(receipt.narrative_body_sha256,createHash('sha256').update(story).digest('hex'));
 await assert.rejects(outputNarrativeBodyReceipt(value,'short_story',story+' extra '.repeat(201)));await assert.rejects(outputNarrativeBodyReceipt(value,'short_story','# Heading\n'+story));await assert.rejects(outputNarrativeBodyReceipt(value,'scene',body));
});
test('actual adapter requires all original guarded-execution hooks before provider access',async()=>{
 const begin=adapter.indexOf('export async function generateDocumentArtifact('),end=adapter.indexOf('  const started=Date.now();',begin),source=stripTypeScriptTypes(adapter.slice(begin,end).replace('export ','')+'\nreturn "admission-only";\n}');
 const check=new Function('readOutputNarrativeExecution',source+';return generateDocumentArtifact;')(readOutputNarrativeExecution),value=await execution(),all={outputNarrative:value,onBeforeProviderAttempt(){},onBeforeProviderDispatch(){},onProviderSubmission(){},onProviderResponse(){}},env={get OPENAI_API_KEY(){throw Error('provider access');}};
 for(const key of ['onBeforeProviderAttempt','onBeforeProviderDispatch','onProviderSubmission','onProviderResponse']){const options={...all};delete options[key];await assert.rejects(check(env,'test','short_story',{options}),/output_narrative_execution_invalid/);}
 for(const options of [{...all,outputNarrative:undefined},{...all,productionMode:'managed'},{...all,productionPage:{pageIndex:0}}])await assert.rejects(check(env,'test','short_story',{options}),/output_narrative_execution_invalid/);
 await assert.rejects(check(env,'test','scene',{options:all}),/output_narrative_execution_invalid/);
});
test('actual resolved-body assessor rejects invalid prose and skips automatic paid repair',async()=>{
 const start=adapter.indexOf('  const assess=(parsed:DocumentArtifactDraft|null)=>{'),end=adapter.indexOf('\n\n  const first=',start),source=stripTypeScriptTypes(adapter.slice(start,end));
 const assess=new Function('resolveDocumentArtifactContextGroups','groupContracts','sourceContract','audioConstraints','documentArtifactValidationIssues','kind','groupIds','itemCount','assessShortStoryBody','narrative','audioSelection',source+';return assess;')(
 parsed=>({output:parsed,receipt:{unknownAssignments:[],rawAssignments:[]}}),[],null,null,()=>[],'short_story',[],3,assessShortStoryBody,await execution(),null);
 assert.deepEqual(assess({content_markdown:story}).issues,[]);assert.ok(assess({content_markdown:'short'}).issues.length);
 const condition=/if\((initialIssues\.length[^)]*)\)\{\n    repairAttempted=true;/.exec(adapter)[1];assert.equal(Boolean(new Function('initialIssues','narrative','return '+condition)([{code:'invalid'}],await execution())),false);
 const failure=adapter.slice(adapter.indexOf('      code:narrative?'),adapter.indexOf('    },`Document ${kind} instructions:',adapter.indexOf('      code:narrative?')));assert.match(failure,/retryable:!narrative/);assert.match(failure,/action:narrative\|\|kind/);
 assert.ok(adapter.indexOf('outputNarrativeBodyReceipt(narrative,kind,output.content_markdown)')>adapter.indexOf('const finalIssues='));
});

// Execute only the renderer's original run closure against a supplied response.
// No fetch, provider, database, grant, job, reservation, or completed journey is simulated.
test('actual adapter retains raw response and original accounting before metadata refusal; no second call or fabricated price',async()=>{
 const {ProviderRequestError,classifyProviderFailure}=await import('../worker/provider-errors.ts');
 const {readOpenAITextUsage,priceCurrentOpenAITextUsage}=await import('../worker/openai-text-cost.ts');
 const value=await execution(),from=adapter.indexOf('  let narrativeAttempted=false;'),to=adapter.indexOf('  const groupIds=',from),runSource=stripTypeScriptTypes(adapter.slice(from,to));
 const utilities=stripTypeScriptTypes(adapter.slice(adapter.indexOf('const responseText='),adapter.indexOf('\n',adapter.indexOf('const missingUsageReceipt='))));
 const raw=JSON.stringify({content_markdown:story}),usage={input_tokens:40,output_tokens:610,total_tokens:650};
 for(const changes of [{status:'incomplete'},{output:[{type:'refusal'}]},{model:'other'},{model:undefined},{usage:{input_tokens:40,output_tokens:610}},{service_tier:'flex'}]){
  const responseBody={id:'unadmitted-response',status:'completed',model:value.model,usage,output_text:raw,...changes},trace=[],paidResponses=[],paidCalls=[];let transports=0;
  const bindings={narrative:value,page:null,presentationRoutes:null,model:value.model,kind:'short_story',selectedStyle:null,itemCount:3,audioConstraints:null,schemaCountPolicy:undefined,maxOutputTokens:6000,identifier:'test-user',preparation:undefined,env:{},started:Date.now(),paidResponses,paidCalls,MAX_PROVIDER_ARTIFACT_CANDIDATE_BYTES:524288,
   captureOutputNarrativeRequest,outputNarrativeResponseProblem,readOpenAITextUsage,priceCurrentOpenAITextUsage,ProviderRequestError,classifyProviderFailure,
   documentArtifactSchema:()=>({type:'object'}),openAIHeaders:()=>({}),
   paidAccounting:()=>({providerUsage:{inputTokens:40,outputTokens:610,totalTokens:650},providerResponseIds:['unadmitted-response'],providerModel:responseBody.model??value.model,providerCallCount:paidResponses.length}),
   input:{options:{onBeforeProviderAttempt:attempt=>{trace.push('claim');assert.equal(attempt.logicalCallKey,'planning:0:initial');},onProviderSubmission:call=>{trace.push(call.status);},onBeforeProviderDispatch:()=>{trace.push('gate');queueMicrotask(()=>trace.push('microtask'));},onProviderResponse:receipt=>{trace.push('retain');assert.equal(receipt.candidateRaw,raw);return{responseRef:'unadmitted-private-ref'};}}},
   openAIRequest:(_url,init)=>{transports++;trace.push('supplied-response');assert.equal(init.body,JSON.stringify(request(value)));return Promise.resolve({ok:true,headers:new Headers(),json:async()=>responseBody});}
  };
  const run=new Function(...Object.keys(bindings),utilities+'\n'+runSource+'\nreturn run;')(...Object.values(bindings));
  await assert.rejects(run(OUTPUT_NARRATIVE_INSTRUCTIONS,request(value).input,'document_short_story'),error=>{assert.ok(error instanceof ProviderRequestError);assert.equal(error.detail.retryable,false);assert.equal(error.providerCallCount,1);assert.deepEqual(error.providerResponseIds,['unadmitted-response']);return true;});
  assert.equal(transports,1);assert.ok(trace.indexOf('supplied-response')<trace.indexOf('microtask'));assert.ok(trace.indexOf('retain')<trace.indexOf('completed'));assert.equal(paidCalls[0].responseRef,'unadmitted-private-ref');
  if(Object.hasOwn(changes,'model')||changes.usage||changes.service_tier)assert.equal(paidCalls[0].costMicrousd,undefined);
  await assert.rejects(run(OUTPUT_NARRATIVE_INSTRUCTIONS,request(value).input,'document_short_story'),/output_narrative_call_consumed/);assert.equal(transports,1);
 }
});


test('story schema rejects foreign media metadata and any final-body normalization',()=>{
 const item={title:'Movement',body:'Action',notes:'',image_prompt:'',context_group_ids:[]},artifact={title:'Story',summary:'Summary',content_markdown:'\n'+story+'\n',items:[item]};
 assert.equal(outputNarrativeArtifactProblem(JSON.stringify(artifact),artifact.content_markdown),null);
 assert.equal(outputNarrativeArtifactProblem(JSON.stringify(artifact),story),'narrative_body_changed');
 for(const key of ['presentation','audio_revision','video_revision','model3d_revision','media_url'])assert.equal(outputNarrativeArtifactProblem(JSON.stringify({...artifact,[key]:{}}),artifact.content_markdown),'narrative_artifact_invalid');
 for(const key of ['slide','media_url'])assert.equal(outputNarrativeArtifactProblem(JSON.stringify({...artifact,items:[{...item,[key]:{}}]}),artifact.content_markdown),'narrative_artifact_invalid');
 assert.equal(outputNarrativeArtifactProblem('{',story),'narrative_artifact_invalid');
});

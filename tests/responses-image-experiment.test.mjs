import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RESPONSES_IMAGE_GATE, prepareResponsesImageExperiment as prepare, validateResponsesImageCell as validate,
  dispatchResponsesImageExperiment as dispatch, inspectResponsesImageObservation as inspect,
  responsesImageOperationEvidence as operations, responsesImageRecovery as recovery,
  prepareDirectVersusResponsesRecipe as recipe } from '../worker/responses-image-experiment.ts';
import { validateImageExperimentCell } from '../worker/image-operation-capabilities.ts';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/responses-image/observations.json',import.meta.url),'utf8'));
const cell=()=>({mainlineModel:'gpt-5.5',imageModel:'gpt-image-2.5-sunburst',action:'generate',context:{kind:'single-user-brief',text:'Generate one watercolor of an adult botanist beside a greenhouse.\nPreserve the words “FIELD NOTES”.'},assets:[],settings:{quality:'high',size:'1536x1024',outputFormat:'png',background:'opaque',moderation:'auto',stream:false}});
const fixture=name=>structuredClone(fixtures[name]);
const hash=value=>createHash('sha256').update(value).digest('hex');

test('disabled route has no dispatch escape hatch and leaves F qualification blocked',async()=>{
 const old=globalThis.fetch; let calls=0; globalThis.fetch=()=>{calls++;throw new Error('forbidden network');};
 try {
  const plan=await prepare(cell());
  assert.equal(plan.enabled,false);assert.equal(plan.liveDispatchAuthorized,false);assert.equal(plan.maximumCostMicrousd,null);
  for(const supplied of [undefined,true,{enabled:true,authorized:true,apiKey:'not-a-key'}]) assert.throws(()=>dispatch(supplied),/responses_runtime_unqualified/);
  for(const f of Object.values(fixtures)) inspect(f);
  assert.deepEqual(plan.sharedCapabilityIssues.map(x=>x.code),['responses_runtime_unqualified']);
  assert.equal(calls,0);assert.ok(Object.isFrozen(RESPONSES_IMAGE_GATE));
 } finally { globalThis.fetch=old; }
});

test('exact stateless request preserves brief, empty assets, separate model selectors and explicit action',async()=>{
 const c=cell(),plan=await prepare(c),body=JSON.parse(plan.requestBody);
 assert.deepEqual(body,{model:'gpt-5.5',input:[{role:'user',content:[{type:'input_text',text:c.context.text}]}],tools:[{type:'image_generation',model:'gpt-image-2.5-sunburst',action:'generate',quality:'high',size:'1536x1024',output_format:'png',background:'opaque',moderation:'auto'}],tool_choice:{type:'image_generation'},parallel_tool_calls:false,stream:false,store:false});
 assert.equal(plan.requestSha256,hash(plan.requestBody));assert.equal(plan.briefSha256,hash(c.context.text));
 assert.equal(plan.selectedContext.previousResponseId,null);assert.equal(plan.selectedContext.conversationId,null);assert.deepEqual(plan.selectedContext.assets,[]);
 assert.equal(plan.selectedContext.instructions.state,'omitted');
});

test('caller mutation during hashing cannot alter frozen captured context or settings',async()=>{
 const c=cell(),original=structuredClone(c),promise=prepare(c);
 c.context.text='Changed';c.settings.quality='low';c.assets.push('private-url');
 const plan=await promise;assert.deepEqual(plan.cell,original);assert.equal(plan.briefSha256,hash(original.context.text));
});

test('unsupported models, history, references, settings, credentials and authorization booleans fail closed',async()=>{
 const variants=[null,{}, {...cell(),mainlineModel:'gpt-6-astra'},{...cell(),imageModel:'gpt-image-2.5-flare'},
 {...cell(),imageModel:'gpt-image-2.5-sunburst-2026-09-08'}, {...cell(),action:'edit'}, {...cell(),action:'auto'},
 {...cell(),assets:[{id:'ref',url:'https://private.invalid'}]}, {...cell(),context:{...cell().context,previous_response_id:'resp_old'}},
 {...cell(),context:{kind:'single-user-brief',text:' '}},{...cell(),authorized:true},{...cell(),enabled:true}];
 for(const [key,value] of Object.entries({quality:'low',size:'1024x1024',outputFormat:'jpeg',moderation:'low',background:'transparent',stream:true,partialImages:1,outputCompression:100,inputFidelity:'high'})) variants.push({...cell(),settings:{...cell().settings,[key]:value}});
 for(const v of variants) {assert.equal(validate(v).schemaValid,false);await assert.rejects(prepare(v),/responses_image_cell_invalid/);}
});

test('success retains ids and optional revision without claiming decoded usable output or settled cost',async()=>{
 const r=inspect(fixture('success')),p=await prepare(cell()),op=operations(p,r);
 assert.equal(r.outcome,'image_returned');assert.equal(r.evidence.contentOutcome,'unknown');assert.equal(r.evidence.accountingState,'usage_recorded');
 assert.equal(r.requestId,'req_synthetic_success');assert.equal(r.responseId,'resp_synthetic_success');assert.equal(r.calls[0].id,'ig_synthetic_success');
 assert.equal(op.mainline.returnedModel,'gpt-5.5');assert.equal(op.image.returnedModel,null);
 assert.equal(op.image.effectiveModel,'gpt-image-2.5-sunburst');assert.equal(op.image.requestSha256,p.requestSha256);
 assert.equal(r.calls[0].revisedPrompt,'Synthetic rewritten brief, retained privately.');
 assert.equal(r.accounting.state,'unknown');assert.equal(r.accounting.aggregateIncludesImageUsage,'unknown');assert.equal(r.accounting.maximumCostMicrousd,null);assert.equal(r.accounting.settledCostMicrousd,null);
 assert.equal(r.accounting.imageCallTotal,1);assert.equal(r.calls[0].usage.state,'missing');
});

test('missing optional prompt/model/action/settings/usage stays missing, never inferred from a composer or request',async()=>{
 const f=fixture('success');delete f.body.model;delete f.body.usage;
 f.body.output=[{id:'ig_minimal',type:'image_generation_call',status:'completed',result:'iVBORw0KGgo='}];
 const r=inspect(f);assert.equal(r.outcome,'image_returned');assert.equal(r.responseUsage.state,'missing');
 assert.equal(r.evidence.accountingState,'unknown');assert.equal(Object.hasOwn(r.calls[0],'revisedPrompt'),false);
 assert.equal(r.calls[0].returnedAction,null);assert.deepEqual(r.calls[0].settings,{});
 const op=operations(await prepare(cell()),r);assert.equal(op.mainline.returnedModel,null);assert.equal(op.image.returnedModel,null);
});

test('provider-returned image identity and tool usage retained only when supplied; no invented schema requirement',async()=>{
 const f=fixture('success');Object.assign(f.body.output[0],{model:'gpt-image-2.5-sunburst-2026-09-08',usage:{input_tokens:10,output_tokens:20,total_tokens:30}});
 const r=inspect(f);assert.equal(operations(await prepare(cell()),r).image.returnedModel,'gpt-image-2.5-sunburst-2026-09-08');
 assert.equal(r.calls[0].usage.state,'recorded');assert.equal(r.accounting.settledCostMicrousd,null);
});

test('no-tool retains paid mainline tokens and does not count an image or make a replacement purchase',()=>{
 const r=inspect(fixture('noTool'));assert.equal(r.outcome,'no_tool');assert.equal(r.responseUsage.raw.total_tokens,108);
 assert.equal(r.accounting.imageCallTotal,0);assert.equal(r.evidence.accountingState,'usage_recorded');assert.equal(r.automaticReplacementPurchases,0);
 assert.equal(r.accounting.settledCostMicrousd,null);
});

test('refusal and incomplete precede artifact/schema validation and preserve reported usage',()=>{
 for(const [name,outcome] of [['refusal','refusal'],['incomplete','incomplete']]){
  const f=fixture(name);f.body.output.push(...fixture('success').body.output);
  const r=inspect(f);assert.equal(r.outcome,outcome);assert.equal(r.responseUsage.state,'recorded');assert.equal(r.accounting.imageCallTotal,null);
  assert.equal(r.automaticReplacementPurchases,0);
 }
 assert.equal(inspect(fixture('refusal')).evidence.providerModerationStage,'unknown');
});

test('HTTP safety details remain private, stages are only provider-returned, no inferred usage or retry',()=>{
 const r=inspect(fixture('error'));assert.equal(r.outcome,'provider_error');assert.equal(r.evidence.failureKind,'safety');
 assert.equal(r.evidence.providerModerationStage,'output');assert.equal(r.evidence.pipelineStage,'media_result');assert.equal(r.evidence.contentOutcome,'refused');
 assert.equal(r.evidence.accountingState,'unknown');assert.equal(r.responseUsage.state,'missing');
 const f=fixture('error');delete f.body.error.moderation_details;assert.equal(inspect(f).evidence.providerModerationStage,'unknown');
});

test('authentication/access/quota/rate/server errors are not safety claims',()=>{
 for(const [status,code,category] of [[401,'invalid_api_key','authentication'],[403,'model_not_found','access'],[429,'insufficient_quota','quota'],[429,'rate_limit_exceeded','rate_limit'],[500,'server_error','server']]) {
  const r=inspect({kind:'http',status,requestId:'req_error',body:{error:{code,message:'Synthetic failure'}}});
  assert.equal(r.evidence.failureKind,category);assert.equal(r.evidence.contentOutcome,'unknown');assert.equal(r.accounting.settledCostMicrousd,null);
 }
});

test('invalid/missing usage never becomes zero cost, even on successful images',()=>{
 for(const usage of [null,{}, {input_tokens:-1,output_tokens:1,total_tokens:0},{input_tokens:1,output_tokens:2,total_tokens:4},{input_tokens:1,output_tokens:2,total_tokens:3,input_tokens_details:{cached_tokens:2}},{input_tokens:1,output_tokens:2,total_tokens:3,output_tokens_details:{reasoning_tokens:3}}]) {
  const f=fixture('success');f.body.usage=usage;const r=inspect(f);
  assert.equal(r.outcome,'image_returned');assert.equal(r.evidence.accountingState,'unknown');assert.equal(r.accounting.settledCostMicrousd,null);
 }
});

test('multiple tools, model/action/settings drift, corrupt pixels and missing ids are invalid with original evidence retained',()=>{
 for(const change of [f=>f.body.output.push(structuredClone(f.body.output[0])),f=>f.body.output[0].action='edit',f=>f.body.output[0].size='1024x1024',f=>f.body.output[0].model='gpt-image-2.5-flare',f=>f.body.output[0].result='invalid!',f=>delete f.body.output[0].id,f=>delete f.body.output]) {
  const f=fixture('success');change(f);const before=structuredClone(f);const r=inspect(f);
  assert.equal(r.outcome,'invalid');assert.deepEqual(r.privateResponse,before);assert.deepEqual(f,before);assert.equal(r.responseUsage.state,'recorded');
 }
});

test('failed and running image calls are not ordinary success',()=>{
 for(const [status,expected] of [['failed','provider_error'],['generating','incomplete'],['in_progress','incomplete']]) {
  const f=fixture('success');f.body.output[0].status=status;assert.equal(inspect(f).outcome,expected);
 }
});

test('stream fixture is retained but unsupported, partials never qualify success or settlement',()=>{
 const f=fixture('stream'),r=inspect(f);assert.equal(r.outcome,'stream_unsupported');assert.equal(r.responseId,'resp_synthetic_stream');
 assert.equal(r.responseUsage.raw.total_tokens,120);assert.equal(r.calls.length,1);assert.equal(r.accounting.imageCallTotal,null);
 assert.equal(r.evidence.contentOutcome,'unknown');assert.equal(r.accounting.settledCostMicrousd,null);assert.deepEqual(r.privateResponse,f);
 const truncated={...f,events:f.events.slice(0,2)};assert.equal(inspect(truncated).responseUsage.state,'missing');
 const error={...f,events:[...truncated.events,{type:'error',code:'moderation_blocked',message:'Synthetic streamed error'}]};
 assert.equal(inspect(error).outcome,'stream_unsupported');assert.deepEqual(inspect(error).privateResponse,error);
});

test('cancellation before dispatch differs from cancellation/timeout after uncertain submission; recovery preserves ids',()=>{
 for(const kind of ['canceled','transport_error']) for(const dispatch of ['not_dispatched','dispatch_unknown']) {
  const r=inspect({kind,dispatch,requestId:'req_original',responseId:'resp_original'}),next=recovery(r);
  assert.equal(r.evidence.accountingState,dispatch==='not_dispatched'?'not_incurred':'unknown');
  assert.equal(next.requestId,'req_original');assert.equal(next.responseId,'resp_original');assert.equal(next.automaticReplacementPurchases,0);
  assert.equal(next.retrieveAuthorized,false);assert.equal(next.cancelAuthorized,false);
  assert.equal(next.next,dispatch==='not_dispatched'?'review_before_new_authorization':'reconcile_original_only');
 }
});

test('two-arm recipe fixes byte-identical brief/model/shared settings and labels orchestration treatment',async()=>{
 const c=cell(),r=await recipe(c),[direct,responses]=r.arms.map(a=>JSON.parse(a.requestBody));
 assert.equal(direct.prompt,responses.input[0].content[0].text);assert.equal(direct.model,responses.tools[0].model);
 for(const k of ['quality','size','output_format','background','moderation']) assert.equal(direct[k],responses.tools[0][k]);
 assert.equal(direct.stream,false);assert.equal(responses.stream,false);assert.equal(direct.n,1);
 for(const arm of r.arms) assert.equal(arm.requestSha256,hash(arm.requestBody));
 assert.equal(r.pureEndpointEffect,false);assert.equal(r.chatGPTImplementationEvidence,false);assert.equal(r.liveDispatchAuthorized,false);
 assert.equal(r.maximumCostMicrousd,null);assert.equal(r.aliasResolution,'unknown');
 assert.equal(validateImageExperimentCell({model:c.imageModel,endpoint:'/v1/images/generations',referenceCount:0,settings:c.settings}).valid,true);
 await assert.rejects(recipe({...c,imageModel:'gpt-image-2'}),/invalid/);
});

test('source has no production registration, credential lookup, network, automatic retry or private source retrieval',()=>{
 const source=readFileSync(new URL('../worker/responses-image-experiment.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(|process\.env|WorkerEnv|OPENAI_API_KEY|\.retry\s*\(/);
 const adapter=readFileSync(new URL('../worker/openai-adapter.ts',import.meta.url),'utf8');
 const jobs=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
 assert.equal(adapter.includes('responses-image-experiment'),false);assert.equal(jobs.includes('responses-image-experiment'),false);
});

test('unrequested tool output is invalid even alongside an image; usage evidence survives',()=>{
 for(const image of [false,true]){
  const f=fixture(image?'success':'noTool');f.body.output.push({type:'function_call',id:'unrequested',name:'extra_tool'});
  const r=inspect(f);assert.equal(r.outcome,'invalid');assert.equal(r.evidence.failureKind,'validation');assert.equal(r.responseUsage.state,'recorded');
 }
});

test('stage ledger never sums overlapping response/tool usage or hides no-tool overhead',async()=>{
 const {responsesImageStageAccounting:ledger}=await import('../worker/responses-image-experiment.ts');
 const f=fixture('success');f.body.output[0].usage={input_tokens:10,output_tokens:20,total_tokens:30};
 const r=ledger(inspect(f));assert.equal(r.additive,false);assert.equal(r.costQualified,false);assert.equal(r.mainlineImageOverlap,'unknown');
 assert.deepEqual(r.stages.map(s=>s.stage),['mainline_orchestration','image_tool']);
 assert.deepEqual(r.stages.map(s=>s.settledCostMicrousd),[null,null]);
 assert.equal(ledger(inspect(fixture('noTool'))).stages.length,1);assert.equal(ledger(inspect(fixture('noTool'))).noTool,true);
 assert.equal(inspect(f).accounting.mainlineAllocation,'unqualified');
});

test('stream repeated done events do not multiply observed image-call count',()=>{
 const f=fixture('stream');f.events.push(structuredClone(f.events[2]));
 assert.equal(inspect(f).accounting.imageCallsObserved,1);assert.equal(inspect(f).accounting.imageCallTotal,null);
});

test('checked-in synthetic two-arm recipe exactly reproduces from its frozen cell',async()=>{
 const input=JSON.parse(readFileSync(new URL('./fixtures/responses-image/cell.json',import.meta.url),'utf8'));
 const expected=JSON.parse(readFileSync(new URL('../docs/fixtures/responses-image-two-arm-recipe.json',import.meta.url),'utf8'));
 assert.deepEqual(await recipe(input),expected);
});

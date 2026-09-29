import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const sourceHook=registerHooks({resolve(specifier,context,next){return next(specifier.startsWith('.')&&!context.parentURL?.includes('/node_modules/')&&!/\.[a-z0-9]+$/iu.test(specifier)?specifier+'.ts':specifier,context);}}),originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('AUDIO_DISPATCH_TEST_EGRESS_DENIED');};
after(()=>{sourceHook.deregister();globalThis.fetch=originalFetch;});
const [{createAudioOutputContract},{EXPERIENCE_AUDIO_INTENT},{parseAudioMiniAppCostPreview,audioMiniAppCostApprovalMatches},{captureOutputAudioAttempt,assertOutputAudioAttempt,readOutputAudioEnvelope,outputAudioPlannerCost},{serializeAudioRequest},{generateCreativeAudio}]=await Promise.all([
 import('../src/model/output-audio-contract.ts'),import('../src/experiences/contracts.ts'),import('../src/model/audio-mini-app-consent.ts'),import('../worker/output-audio-execution.ts'),import('../worker/audio-adapters/index.ts'),import('../worker/fal-audio-adapter.ts')]);
const contract=createAudioOutputContract({draftId:'experience-draft-'+'d'.repeat(64),draftHash:'sha256:'+'a'.repeat(64),releaseHash:'sha256:'+'b'.repeat(64),requestHash:'sha256:'+'c'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)});
const model='fal-ai/stable-audio-3/medium/text-to-audio';
const preview={version:'audio-mini-app-cost-v1',requestId:'audio-'+'a'.repeat(64),actorUserId:'actor',projectId:'project',documentId:'document',draftId:contract.source.draftId,sourceDigest:'a'.repeat(64),requirementsDigest:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00.000Z',maximumMicrousd:1037600,maximumCalls:3,maximumTokens:128000,planningModel:'gpt-5.6-terra',maximumPlanningCalls:2,maximumOutputTokens:3000,audioModel:model,maximumAudioCalls:1,durationSeconds:20,requireInstrumental:true,sourceFilesTransferred:0};
const payload={artifactKind:'audio',productionMode:'manual',itemCount:1,audioProfile:EXPERIENCE_AUDIO_INTENT,audioProviderModel:model,audioEstimatedCostMicrousd:37600,outputTargetInstructions:'One instrumental track',outputAudio:contract};
test('separate original Audio consent requires both deliberate confirmations and exact current terms',()=>{
 assert.ok(parseAudioMiniAppCostPreview(preview));assert.ok(audioMiniAppCostApprovalMatches({...preview,confirmed:true,providerTransferConfirmed:true},preview));
 for(const value of [{...preview,confirmed:true},{...preview,confirmed:true,providerTransferConfirmed:false},{...preview,documentId:'foreign',confirmed:true,providerTransferConfirmed:true},{...preview,confirmed:true,providerTransferConfirmed:true,extra:1}])assert.equal(audioMiniAppCostApprovalMatches(value,preview),false);
 assert.equal(audioMiniAppCostApprovalMatches({...preview,confirmed:true,providerTransferConfirmed:true},preview,Date.parse(preview.expiresAt)),false);
});
test('exact existing Stable Audio serializer is captured; duration, format and body digest cannot drift',async()=>{
 const body=JSON.stringify(serializeAudioRequest(model,{prompt:'Quiet piano',profile:EXPERIENCE_AUDIO_INTENT}));
 const attempt=await captureOutputAudioAttempt(contract,body,'forma-audio-original','audio:initial');
 const settings={kind:'render_document',payload,calls:[{stage:'audio:initial',provider:'fal',model,maximumMicrousd:37600}]};
 await assertOutputAudioAttempt(settings,attempt);assert.equal(attempt.maximumInputTokens,0);assert.equal(attempt.maximumOutputTokens,0);
 await assert.rejects(()=>captureOutputAudioAttempt(contract,JSON.stringify({...JSON.parse(body),duration:30}),'forma-audio-original','audio:initial'));
 await assert.rejects(()=>assertOutputAudioAttempt(settings,{...attempt,requestDigest:'f'.repeat(64)}));
 await assert.rejects(()=>captureOutputAudioAttempt(contract,body,'forma-audio-original','audio:repair'));
});
test('both bounded planner stages bind original bytes/model and reject tools or changed output cap',async()=>{
 for(const phase of ['initial','repair']){
  const wire={model:'gpt-5.6-terra',store:false,max_output_tokens:3000,input:'Current captured context',instructions:'Compose an instrumental direction',text:{format:{name:'document_audio'+(phase==='repair'?'_repair':''),type:'json_schema',strict:true,schema:{type:'object'}}},service_tier:'default',prompt_cache_options:{mode:'explicit'}};
  const body=JSON.stringify(wire),attempt=await captureOutputAudioAttempt(contract,body,'forma-document-audio-original','planning:0:'+phase);
  await assertOutputAudioAttempt({kind:'render_document',payload,calls:[{stage:'planning:0:'+phase,provider:'openai',model:'gpt-5.6-terra',maximumMicrousd:500000,maximumInputTokens:10000,maximumOutputTokens:3000}]},attempt);
  for(const mutation of [{...wire,tools:[]},{...wire,max_output_tokens:6000},{...wire,model:'foreign'}])await assert.rejects(()=>captureOutputAudioAttempt(contract,JSON.stringify(mutation),'forma-document-audio-original','planning:0:'+phase));
 }
});
test('bounded envelope overflow cancels without awaiting cancellation and releases the actual stream lock',async()=>{
 let cancelled=0;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(262145));},cancel(){cancelled++;return new Promise(()=>{});}});
 const response=new Response(stream);await assert.rejects(()=>readOutputAudioEnvelope(response),/limit/u);assert.equal(cancelled,1);assert.equal(stream.locked,false);
 await assert.rejects(()=>readOutputAudioEnvelope(new Response(new Uint8Array([255]))));
});
test('original measured planner prices are summed; mismatched effective model and unknown price refuse',()=>{
 const call={operation:'planning',provider:'openai',model:'gpt-5.6-terra',effectiveModel:'gpt-5.6-terra',status:'completed',costMicrousd:30,textInputCostMicrousd:10,textOutputCostMicrousd:20};
 assert.equal(outputAudioPlannerCost({providerSubmissions:{a:call,b:call}},15).totalMicrousd,45);
 assert.throws(()=>outputAudioPlannerCost({providerSubmissions:{a:{...call,effectiveModel:'foreign'}}}));
 assert.throws(()=>outputAudioPlannerCost({providerSubmissions:{a:{...call,costMicrousd:undefined}}}));
});
test('actual existing Fal transport claims and privately captures before one POST; completion retains the same original ID',async()=>{
 const log=[],calls=[],old=globalThis.fetch;
 globalThis.fetch=async(input,init={})=>{const url=String(input);calls.push({url,method:init.method??'GET'});log.push(init.method==='POST'?'post':'get');
  if(init.method==='POST'){assert.equal(url,'https://queue.fal.run/'+model);const body=JSON.parse(init.body);assert.equal(body.duration,20);assert.equal(body.enable_safety_checker,true);return Response.json({request_id:'original-audio-1'});}
  if(url.endsWith('/status?logs=1'))return Response.json({status:'COMPLETED',request_id:'original-audio-1'});
  if(url==='https://queue.fal.run/fal-ai/stable-audio-3/requests/original-audio-1')return Response.json({request_id:'original-audio-1',audio:{url:'https://fal.media/original.mp3',content_type:'audio/mpeg',duration:20,file_size:4}});
  assert.equal(url,'https://fal.media/original.mp3');return new Response(new Uint8Array([73,68,51,0]),{headers:{'content-type':'audio/mpeg'}});
 };
 try{
  const receipts=[];const result=await generateCreativeAudio({FAL_KEY:'isolated-not-a-credential'},'Quiet piano',{outputAudio:contract,profile:EXPERIENCE_AUDIO_INTENT,providerModel:model,estimatedCostMicrousd:37600,
   onBeforeProviderAttempt:async()=>{log.push('claim');},onOutputAudioRequest:async request=>{log.push('capture');assert.equal(request.contract.source.draftId,contract.source.draftId);},onBeforeSourceTransmission:async()=>{log.push('source');},onProviderSubmission:async receipt=>{log.push(receipt.status);receipts.push(receipt);},onBeforeProviderDispatch:()=>{log.push('dispatch');}});
  assert.deepEqual(log.slice(0,6),['claim','capture','source','pending','dispatch','post']);assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(result.providerJobId,'original-audio-1');assert.deepEqual(receipts.map(item=>item.status),['pending','accepted','completed']);assert.equal(receipts.at(-1).totalTokens,0);assert.equal(receipts.at(-1).costMicrousd,37600);
 }finally{globalThis.fetch=old;}
});
test('native transport missing custody hooks or a stopped current source sends nothing',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
 try{await assert.rejects(()=>generateCreativeAudio({FAL_KEY:'isolated'},'Quiet piano',{outputAudio:contract,profile:EXPERIENCE_AUDIO_INTENT,providerModel:model}),/hooks/u);
  await assert.rejects(()=>generateCreativeAudio({FAL_KEY:'isolated'},'Quiet piano',{outputAudio:contract,profile:EXPERIENCE_AUDIO_INTENT,providerModel:model,onBeforeProviderAttempt:async()=>{},onOutputAudioRequest:async()=>{},onBeforeSourceTransmission:async()=>{throw Error('source withdrawn');},onProviderSubmission:async()=>{},onBeforeProviderDispatch:()=>{}}),/source withdrawn/u);assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});

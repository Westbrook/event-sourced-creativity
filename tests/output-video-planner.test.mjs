import assert from 'node:assert/strict';
import test from 'node:test';
import {registerOutputSourceImports} from './output-execution-test-helpers.mjs';registerOutputSourceImports();
const {prepareVideoPlannerRequest,generateDocumentArtifact}=await import('../worker/openai-adapter.ts');
const {captureVideoPlannerRequest,readVideoPlannerExecution,assertVideoPlannerAttempt}=await import('../worker/output-video-planner.ts');
const {createVideoOutputContract}=await import('../src/model/output-video-contract.ts');
const contract=createVideoOutputContract({source:{draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)},reference:{version:1,sourceProjectId:'p',sourceDocumentId:'d',sourceBlockId:'b',referenceId:'r',sha256:'f'.repeat(64),permissionAttestation:'i-own-or-have-permission'},frameSize:'720x1280'});
const input=()=>({documentTitle:'Slow pan',snapshot:{document:{id:'d',title:'Slow pan'},facts:[{block_id:'motion',type:'text',active:true,properties:{text:'A slow pan. 水\nKeep the subject still.'}}]},options:{itemCount:1,productionMode:'manual',videoSeconds:4,videoSize:'720x1280',videoAudioMode:'silent',outputTargetInstructions:'1 video · 4 s · 480p · Silent'}});
async function network(fn,run){const previous=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=previous;}}
const offline={get OPENAI_API_KEY(){return assert.fail('credentials read');},get FAL_KEY(){return assert.fail('media provider read');}};
const original=await network(()=>assert.fail('network'),()=>prepareVideoPlannerRequest(offline,'owner',input(),contract));
const execution={contract,requestDigest:original.requestDigest,maximumInputTokens:original.maximumInputTokens};
const plan={title:'Slow pan',summary:'A still subject.',content_markdown:'One continuous four-second silent camera pan across the still subject.',items:[{title:'Pan',body:'The camera moves slowly across the still subject.',notes:'Silent',image_prompt:'Keep the original subject visible.',context_group_ids:[]}]};
function response(content=plan){const raw=JSON.stringify(content);return Response.json({id:'resp_video_1',model:'gpt-5.6-terra',status:'completed',service_tier:'default',output:[{id:'msg_1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:raw}]}],usage:{input_tokens:100,output_tokens:30,total_tokens:130,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}});}
function configured(){const i=input(),attempts=[],receipts=[],submissions=[];i.options={...i.options,outputVideoPlanner:execution,onVideoPlannerEnvelope:async value=>{assert.equal(value.version,"output-video-planner-envelope-v1");},onBeforeProviderAttempt:async value=>{await assertVideoPlannerAttempt(execution,value);attempts.push(value);},onBeforeProviderDispatch:id=>{assert.equal(id,attempts.at(-1).clientRequestId);},onProviderSubmission:value=>{submissions.push(value);},onProviderResponse:value=>{receipts.push(value);return{responseRef:'private-response-1'};}};return{i,attempts,receipts,submissions};}

test('real compiler quote is credential-free, byte-stable, one4sec480p silent clip with explicit default tier/cache',async()=>{
 const second=await network(()=>assert.fail('network'),()=>prepareVideoPlannerRequest(offline,'owner',input(),contract));assert.equal(second.requestBody,original.requestBody);assert.equal(second.requestDigest,original.requestDigest);
 const wire=JSON.parse(original.requestBody),context=JSON.parse(wire.input);assert.equal(wire.model,'gpt-5.6-terra');assert.equal(wire.max_output_tokens,3000);assert.equal(wire.store,false);assert.equal(wire.service_tier,'default');assert.deepEqual(wire.prompt_cache_options,{mode:'explicit'});
 assert.equal(wire.text.format.name,'document_video');assert.equal(wire.text.format.schema.properties.items.minItems,1);assert.equal(wire.text.format.schema.properties.items.maxItems,1);
 assert.equal(context.video.duration_seconds,4);assert.equal(context.video.resolution,'480p');assert.equal(context.video.frame,'portrait');assert.equal(context.video.generate_audio,false);assert.equal(context.video.reference_count,1);
 assert.equal(original.maximumInputTokens,new TextEncoder().encode(original.requestBody).byteLength+4096);assert.ok(readVideoPlannerExecution(execution));
});
test('actual planner dispatch uses the quoted wire once and retains raw response plus exact call accounting',async()=>{
 const f=configured(),requests=[];const result=await network(async(url,init)=>{requests.push({url,init});return response();},()=>generateDocumentArtifact({OPENAI_API_KEY:'synthetic-no-network'},'owner','video',f.i));
 assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.openai.com/v1/responses');assert.equal(requests[0].init.body,original.requestBody);assert.equal(f.attempts.length,1);assert.equal(f.receipts.length,1);assert.equal(typeof f.receipts[0].rawEnvelope,'string');assert.equal(f.receipts[0].call.requestDigest,original.requestDigest);
 assert.equal(result.output.items.length,1);assert.equal(f.submissions.at(-1).validationStatus,'valid');assert.equal(f.submissions.at(-1).effectiveModel,'gpt-5.6-terra');assert.ok(Number.isSafeInteger(f.submissions.at(-1).costMicrousd));
});
test('invalid candidate, malformed response and private persistence failure never invoke a paid repair',async()=>{
 for(const mode of ['candidate','json','storage']){const f=configured();let calls=0;if(mode==='storage')f.i.options.onProviderResponse=()=>{throw Error('private_storage_failure');};
 await network(async()=>{calls++;return mode==='json'?new Response('bad JSON'):response(mode==='candidate'?{}:plan);},()=>assert.rejects(generateDocumentArtifact({OPENAI_API_KEY:'synthetic-no-network'},'owner','video',f.i)));assert.equal(calls,1);assert.ok(!f.attempts.some(a=>a.logicalCallKey.includes('repair')));
 }
});
test('source, policy, body, model and request-digest drift refuse before dispatch',async()=>{
 for(const change of [f=>{f.i.snapshot.facts[0].properties.text='Changed motion';},f=>{f.i.options.videoSeconds=5;},f=>{f.i.options.videoSize='1280x720';},f=>{f.i.options.videoAudioMode='original_ambient';},f=>{f.i.options.outputVideoPlanner={...execution,requestDigest:'0'.repeat(64)};},f=>{f.i.options.productionPlan=undefined;}]){const f=configured();change(f);await network(()=>assert.fail('network'),()=>assert.rejects(generateDocumentArtifact({OPENAI_API_KEY:'synthetic'},'owner','video',f.i)));}
 const wire=JSON.parse(original.requestBody);for(const changed of [{...wire,model:'other'},{...wire,store:true},{...wire,tools:[]},{...wire,max_output_tokens:3001},{...wire,text:{...wire.text,format:{...wire.text.format,name:'document_video_repair'}}}])await assert.rejects(captureVideoPlannerRequest(contract,JSON.stringify(changed),'forma-video-test'));
});

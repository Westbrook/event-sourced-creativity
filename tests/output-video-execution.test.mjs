import assert from 'node:assert/strict';
import test from 'node:test';
import { registerOutputSourceImports } from './output-execution-test-helpers.mjs';
registerOutputSourceImports();
const {generateCreativeVideo}=await import('../worker/openai-adapter.ts');
const {captureOutputVideoSource,captureOutputVideoAttempt,requestOutputVideoResponse,OUTPUT_VIDEO_TRANSPORT}=await import('../worker/output-video-execution.ts');
const {createVideoOutputContract}=await import('../src/model/output-video-contract.ts');
const {VIDEO_ADAPTER_CONTRACT}=await import('../src/model/video-adapter.ts');
const sha=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const bytes=Uint8Array.from([1,2,3,4]);
const contract=createVideoOutputContract({source:{draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)},reference:{version:1,sourceProjectId:'original-project',sourceDocumentId:'original-document',sourceBlockId:'original-block',referenceId:'original-reference',sha256:await sha(bytes),permissionAttestation:'i-own-or-have-permission'},frameSize:'1280x720'});
const base='https://queue.fal.run/bytedance/seedance-2.0/requests/job-1';
function fixture(){
 const calls=[],events=[],attempts=[],prepared=[],receipts=[],envelopes=[],signals=[];
 const options={outputVideo:contract,seconds:4,size:'1280x720',resolution:'480p',audioMode:'silent',generateAudio:false,providerModel:OUTPUT_VIDEO_TRANSPORT.model,endUserId:'test-owner',
 references:[{bytes:bytes.slice(),mimeType:'image/png',blockId:'original-block',referenceId:'original-reference',label:'Owned still',mode:'inspiration',sequence:null,shotDirection:'',cameraDirection:'',framePrompt:'',sourceArtifactId:null,sourceArtifactItemId:null,sourceArtifactKind:null,storyboardTitle:''}],
 onBeforeSourceTransmission(lease){lease.assertCurrent();events.push('source');},onBeforeProviderAttempt(attempt,lease){lease.assertCurrent();events.push('attempt');attempts.push(attempt);},
 onBeforeProviderDispatch(id,lease){lease.assertCurrent();events.push('dispatch');assert.equal(id,attempts[0].clientRequestId);},
 onOutputVideoEnvelope(value,lease){lease.assertCurrent();envelopes.push(value);signals.push(lease.signal);},
 onPrepared(value,lease){lease.assertCurrent();events.push('prepared');prepared.push(value);},onReceipt(value,lease){lease.assertCurrent();events.push('receipt');receipts.push(value);},
 onProviderSubmission(value,lease){lease.assertCurrent();events.push(value.status);},
 };
 const responses=[Response.json({upload_url:'https://v3.fal.media/upload/one',file_url:'https://v3.fal.media/file/one'}),new Response(null,{status:200}),
 Response.json({request_id:'job-1',response_url:'https://queue.fal.run/other-owner/other-job'}),Response.json({status:'COMPLETED',request_id:'job-1'}),
 Response.json({video:{url:'https://v3.fal.media/video/one',content_type:'video/mp4',file_size:4}}),new Response(bytes,{headers:{'content-type':'video/mp4'}})];
 const fetch=async(url,init)=>{calls.push({url,init});events.push('fetch:'+init.method);assert.equal(init.redirect,'manual');assert.ok(init.signal);const r=responses.shift();assert.ok(r,'unexpected outbound attempt');return r;};
 return{options,calls,events,attempts,prepared,receipts,envelopes,signals,responses,fetch};
}
async function fakeNetwork(f,fn){const saved=globalThis.fetch;globalThis.fetch=f;try{return await fn();}finally{globalThis.fetch=saved;}}
const env={FAL_KEY:'synthetic-no-network',FORMA_VIDEO_PROVIDER:'fal'};

test('real native adapter: one exact480p POST, exact source transfer, bounded job GETs, no arbitrary receipt route',async()=>{
 const f=fixture();const result=await fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A slow camera pan.',f.options));
 assert.equal(f.calls.length,6);assert.deepEqual(f.calls.map(c=>c.init.method),['POST','PUT','POST','GET','GET','GET']);
 assert.equal(f.calls[0].url,'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3');
 assert.equal(f.calls[1].init.headers.Authorization,undefined);assert.equal(f.calls[5].init.headers,undefined);
 assert.deepEqual(new Uint8Array(await f.calls[1].init.body.arrayBuffer()),bytes);
 assert.equal(f.calls[3].url,base+'/status');assert.equal(f.calls[4].url,base);
 const wire=JSON.parse(f.calls[2].init.body);assert.equal(wire.duration,4);assert.equal(wire.resolution,'480p');assert.equal(wire.generate_audio,false);assert.deepEqual(wire.image_urls,['https://v3.fal.media/file/one']);assert.equal(wire.end_user_id,await sha(new TextEncoder().encode('test-owner')));
 assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].video.mediaMaximumMicrousd,4*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd['480p']);assert.match(f.attempts[0].pricingVersion,/fal-480p-transport/);assert.equal(f.attempts[0].video.requestBody,f.calls[2].init.body);assert.equal(f.attempts[0].requestDigest,await sha(new TextEncoder().encode(f.calls[2].init.body)));
 assert.deepEqual(f.events,['source','fetch:POST','source','fetch:PUT','attempt','prepared','pending','source','dispatch','fetch:POST','accepted','receipt','source','fetch:GET','source','fetch:GET','completed','source','fetch:GET']);
 assert.equal(result.seconds,4);assert.equal(result.costMicrousd,4*VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd['480p']);assert.equal(result.usedReferencePixels,true);assert.equal(result.providerParameters.resolution,'480p');assert.deepEqual(result.bytes,bytes);
 // Synthetic four bytes are intentionally not claimed as measured/playable video.
 assert.equal(Object.hasOwn(result,'requirementFulfilled'),false);assert.equal(Object.hasOwn(result,'measuredSeconds'),false);
});

test('native invalid shapes and missing hooks fail before any reference or provider transmission',async()=>{
 const changes=[o=>{o.outputVideo=null;},o=>{o.seconds=5;},o=>{o.resolution='720p';},o=>{o.audioMode='original_ambient';},o=>{o.generateAudio=true;},o=>{o.size='720x1280';},o=>{o.providerModel='bytedance/seedance-2.5/reference-to-video';},o=>{o.providerJobId=undefined;},o=>{o.retainedReceipt={};},o=>{o.references.push({...o.references[0]});},o=>{o.references[0].blockId='copied-destination';},o=>{o.references[0].bytes[0]=9;},o=>{o.references[0].sourceArtifactKind='model3d';},o=>{o.references[0].mode='describe';},o=>{o.audioReferences=[{}];},o=>{o.endUserId='';},...['onBeforeSourceTransmission','onBeforeProviderAttempt','onBeforeProviderDispatch','onProviderSubmission','onPrepared','onReceipt','onOutputVideoEnvelope'].map(k=>o=>{delete o[k];})];
 for(const change of changes){const f=fixture();change(f.options);await fakeNetwork(()=>assert.fail('network'),()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options)));}
});

test('source checks fail closed at metadata, pixel transfer and paid dispatch without automatic retries',async()=>{
 for(const stopAt of [1,2,3]){const f=fixture();let checks=0;f.options.onBeforeSourceTransmission=lease=>{lease.assertCurrent();if(++checks===stopAt)throw Error('source_changed');};
 await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options),/source_changed/));assert.equal(f.calls.length,stopAt-1);assert.ok(!f.events.includes('completed'));}
 for(const hook of ['onBeforeProviderAttempt','onPrepared','onBeforeProviderDispatch']){const f=fixture();f.options[hook]=()=>{throw Error('stop');};await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options),/stop/));assert.equal(f.calls.length,2);}
});

test('source bytes and actor are captured across asynchronous source changes',async()=>{
 const f=fixture();f.options.onBeforeSourceTransmission=lease=>{lease.assertCurrent();f.options.references[0].bytes.fill(9);f.options.endUserId='other-owner';};
 await fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A pan',f.options));assert.deepEqual(new Uint8Array(await f.calls[1].init.body.arrayBuffer()),bytes);assert.equal(JSON.parse(f.calls[2].init.body).end_user_id,await sha(new TextEncoder().encode('test-owner')));
 const o=fixture().options,pending=captureOutputVideoSource(contract,o);o.references[0].bytes.fill(7);const captured=await pending;assert.deepEqual(captured.reference.bytes,bytes);
});

test('wire capture refuses drift, extras, multiple images and off-origin or credentialed media URLs',async()=>{
 const wire={prompt:'A pan',aspect_ratio:'16:9',duration:4,resolution:'480p',generate_audio:false,end_user_id:'a'.repeat(64),image_urls:['https://v3.fal.media/file/one']};
 const good=await captureOutputVideoAttempt(contract,JSON.stringify(wire),'forma-video-test');assert.ok(Object.isFrozen(good.video));
 for(const patch of [{duration:5},{resolution:'720p'},{generate_audio:true},{aspect_ratio:'9:16'},{audio_urls:[]},{image_urls:['https://other.invalid/a']},{image_urls:['https://user@v3.fal.media/a']},{image_urls:['https://v3.fal.media:444/a']},{image_urls:['https://v3.fal.media/a#x']},{image_urls:[...wire.image_urls,...wire.image_urls]}])await assert.rejects(captureOutputVideoAttempt(contract,JSON.stringify({...wire,...patch}),'forma-video-test'));
});

test('unknown paid submission outcome never retries or records zero cost',async()=>{
 for(const response of [new Response('broken',{status:502}),new Response('broken',{status:422}),Response.json({},{status:200})]){
  const f=fixture();f.responses[2]=response;await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options)));assert.equal(f.calls.length,3);assert.ok(f.events.includes('pending'));assert.ok(!f.events.includes('rejected'));assert.ok(!f.events.includes('completed'));
 }
 const f=fixture();f.responses[2]=Response.json({detail:'invalid'},{status:422});await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options)));assert.equal(f.calls.length,3);assert.ok(f.events.includes('rejected'));
});

test('accepted job identity and media failures preserve known accounting, never a second paid POST',async()=>{
 const mutations=[f=>{f.responses[3]=Response.json({status:'COMPLETED',request_id:'foreign'});},f=>{f.responses[4]=Response.json({video:{url:'https://evil.invalid/movie'}});},f=>{f.responses[5]=new Response(bytes,{headers:{'content-type':'text/html'}});},f=>{f.responses[5]=new Response(bytes,{headers:{'content-type':'video/mp4','content-length':'999'}});}];
 for(const [index,mutate] of mutations.entries()){
  const f=fixture();mutate(f);await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options)));assert.equal(f.calls.filter(c=>c.url.startsWith('https://queue.fal.run')&&c.init.method==='POST').length,1);assert.ok(f.events.includes('accepted'));assert.equal(f.events.includes('completed'),index>=2);assert.equal(f.receipts[0].providerJobId,'job-1');
 }
});

test('decoded byte limits reject oversized/misdeclared/empty-chunk streams; cancellation cannot block',async()=>{
 for(const response of [new Response('12345'),new Response('1234',{headers:{'content-length':'5'}}),new Response('1234',{headers:{'content-length':'3'}}),new Response('1234',{headers:{'content-length':'no'}}),new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array());},cancel(){return new Promise(()=>{});}}))])await fakeNetwork(async()=>response,()=>assert.rejects(requestOutputVideoResponse('https://fal.media/test',{},()=>{},4)));
 const good=await fakeNetwork(async()=>new Response('1234',{headers:{'content-encoding':'gzip','content-length':'20'}}),()=>requestOutputVideoResponse('https://fal.media/test',{},()=>{},4));assert.equal(await good.text(),'1234');assert.equal(good.headers.get('content-encoding'),null);
});

test('redirect refusal cancels without reading or waiting for a hostile cancellation',async()=>{
 let canceled=0,calls=0;
 const response=new Response(new ReadableStream({cancel(){canceled++;return new Promise(()=>{});}}),{status:307,headers:{location:'https://must-not-follow.invalid/'}});
 await fakeNetwork(async(_url,init)=>{calls++;assert.equal(init.redirect,'manual');return response;},()=>assert.rejects(requestOutputVideoResponse('https://fal.media/test',{},()=>{}),/output_video_redirect_refused/));
 assert.equal(calls,1);assert.equal(canceled,1);assert.equal(response.bodyUsed,true);
});

test('abort retires late response and stalled reader without awaiting cancellation',async()=>{
 const control=new AbortController();let resolveFetch,canceled=0;
 const operation=fakeNetwork(()=>new Promise(resolve=>{resolveFetch=resolve;}),()=>requestOutputVideoResponse('https://fal.media/test',{signal:control.signal},()=>{}));
 while(!resolveFetch)await Promise.resolve();control.abort(Error('stop'));await assert.rejects(operation,/stop/);
 resolveFetch(new Response(new ReadableStream({cancel(){canceled++;return new Promise(()=>{});}})));await new Promise(resolve=>setImmediate(resolve));assert.equal(canceled,1);
 const second=new AbortController();let started=false;
 const pending=fakeNetwork(async()=>{started=true;return new Response(new ReadableStream({cancel(){return new Promise(()=>{});}}));},()=>requestOutputVideoResponse('https://fal.media/test',{signal:second.signal},()=>{}));
 while(!started)await Promise.resolve();second.abort(Error('stop'));await assert.rejects(pending,/stop/);
});

test('finite fetch/body and callback deadlines stop progress even when dependency ignores abort',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let started=false;
 const pending=fakeNetwork(()=>{started=true;return new Promise(()=>{});},()=>requestOutputVideoResponse('https://fal.media/test',{},()=>{}));
 while(!started)await Promise.resolve();t.mock.timers.tick(30000);await assert.rejects(pending,/timeout/);
 const f=fixture();let attempted=false;f.options.onBeforeProviderAttempt=()=>{attempted=true;return new Promise(()=>{});};
 const job=fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A pan',f.options));while(!attempted)await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(30000);await assert.rejects(job,/hook_timeout/);assert.equal(f.calls.length,2);
});

test('generic Video still reaches its original configuration refusal without native hook requirements',async()=>{
 await fakeNetwork(()=>assert.fail('network'),()=>assert.rejects(generateCreativeVideo({},'A pan',{seconds:4,size:'1280x720'}),error=>error.detail?.code==='video_provider_not_configured'));
});

 test('async dispatch gate is refused and its rejection is handled without network',async()=>{
  await fakeNetwork(()=>assert.fail('network'),()=>assert.rejects(requestOutputVideoResponse('https://fal.media/test',{},()=>{},4,()=>Promise.reject(Error('bad hook'))),/dispatch_gate_invalid/));
  await new Promise(resolve=>setImmediate(resolve));
 });

 test('original bounded accepted/status/result envelopes persist before interpretation, with exact bytes and captured request identity',async()=>{
  const f=fixture(),accepted='{ "request_id" : "job-1", "response_url":"https://queue.fal.run/other-job", "provider_extra":{"x":1} }';
  f.responses[2]=new Response(accepted,{headers:{'content-type':'application/json','x-fal-request-id':'job-1'}});
  await fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A pan',f.options));
  assert.deepEqual(f.envelopes.map(e=>e.phase),['submission','status','result']);
  assert.equal(Buffer.from(f.envelopes[0].decodedBodyBase64,'base64').toString(),accepted);
  assert.equal(f.envelopes[0].decodedBodySha256,await sha(new TextEncoder().encode(accepted)));
  assert.deepEqual(f.envelopes[0].headers.find(h=>h[0]==='x-fal-request-id'),['x-fal-request-id','job-1']);
  for(const e of f.envelopes){assert.equal(e.clientRequestId,f.attempts[0].clientRequestId);assert.equal(e.requestDigest,f.attempts[0].requestDigest);assert.ok(Object.isFrozen(e));}
  assert.equal(f.envelopes[0].providerRequestId,null);assert.equal(f.envelopes[1].providerRequestId,'job-1');assert.equal(f.envelopes[2].providerRequestId,'job-1');
  assert.ok(f.signals.every(signal=>signal.aborted));
 });
 test('malformed and non-UTF8 provider envelopes are retained, not replaced by a synthesized response',async()=>{
  for(const body of [new TextEncoder().encode('broken'),Uint8Array.from([255,254])]){
   const f=fixture();f.responses[2]=new Response(body,{status:422});await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options)));
   assert.equal(f.envelopes.length,1);assert.deepEqual(new Uint8Array(Buffer.from(f.envelopes[0].decodedBodyBase64,'base64')),body);assert.equal(f.envelopes[0].httpStatus,422);assert.ok(!f.events.includes('rejected'));assert.ok(f.signals[0].aborted);
  }
 });
 test('private envelope persistence failure stops interpretation and later GETs, preserving unknown paid status',async()=>{
  const f=fixture();let capturedSignal;f.options.onOutputVideoEnvelope=(_e,lease)=>{capturedSignal=lease.signal;throw Error('private_write_failed');};
  await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options),/private_write_failed/));assert.equal(f.calls.length,3);assert.ok(!f.events.includes('accepted'));assert.ok(!f.events.includes('rejected'));assert.ok(capturedSignal.aborted);
 });
 test('late hook resolution after timeout sees retired controller and cannot continue provider work',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture();let release,capturedSignal;
  let writes=0;f.options.onOutputVideoEnvelope=async(_e,lease)=>{capturedSignal=lease.signal;await new Promise(resolve=>{release=resolve;});lease.assertCurrent();writes++;};
  const work=fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A pan',f.options));while(!release)await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(30000);await assert.rejects(work,/hook_timeout/);assert.ok(capturedSignal.aborted);assert.equal(f.calls.length,3);
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,3);assert.ok(!f.events.includes('accepted'));assert.equal(writes,0);
 });

 test('nested result identity is checked before download or completion; ambiguous containers refuse',async()=>{
  for(const result of [{data:{request_id:'foreign-job',video:{url:'https://fal.media/video/one'}}},{video:{url:'https://fal.media/video/one',request_id:'foreign-job'}},{video:{url:'https://fal.media/video/one'},data:{request_id:'foreign-job'}},{video:{url:'https://fal.media/video/one'},data:{video:{url:'https://fal.media/video/other'}}}]){
   const f=fixture();f.responses[4]=Response.json(result);await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options),/mismatch|ambiguous/));assert.equal(f.calls.length,5);assert.ok(!f.events.includes('completed'));assert.equal(f.envelopes.at(-1).phase,'result');
  }
  const f=fixture();f.responses[4]=Response.json({data:{request_id:'job-1',video:{url:'https://fal.media/video/one',content_type:'video/mp4',file_size:4}}});await fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A pan',f.options));assert.ok(f.events.includes('completed'));
 });
 test('every successful native callback must observe its lease; completed hook leases cannot be reused',async()=>{
  for(const name of ['onBeforeSourceTransmission','onBeforeProviderAttempt','onBeforeProviderDispatch','onProviderSubmission','onPrepared','onReceipt','onOutputVideoEnvelope']){
   const f=fixture();f.options[name]=()=>{};await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options),/lease_unobserved/));assert.ok(!f.events.includes('completed'));
  }
  const f=fixture(),leases=[];f.options.onBeforeSourceTransmission=lease=>{lease.assertCurrent();leases.push(lease);};await fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A pan',f.options));
  for(const lease of leases){assert.ok(lease.signal.aborted);assert.throws(()=>lease.assertCurrent(),/hook_retired/);}
 });

 test('contradictory supplied provider request headers refuse and remain in original envelope custody',async()=>{
  for(const index of [2,3,4]){
   const f=fixture(),response=f.responses[index];f.responses[index]=new Response(await response.arrayBuffer(),{status:response.status,headers:{...Object.fromEntries(response.headers),'x-fal-request-id':'foreign-job'}});
   await fakeNetwork(f.fetch,()=>assert.rejects(generateCreativeVideo(env,'A pan',f.options),/receipt_mismatch/));assert.equal(f.calls.length,index+1);assert.ok(!f.events.includes('completed'));assert.deepEqual(f.envelopes.at(-1).headers.find(h=>h[0]==='x-fal-request-id'),['x-fal-request-id','foreign-job']);
  }
 });
 test('initially empty mutable context groups cannot enter source adaptation during source hashing',async()=>{
  const f=fixture();f.options.references[0].contextGroups=[];
  const work=fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A pan',f.options));
  f.options.references[0].contextGroups.push({id:'foreign-group',name:'Injected after capture',target:'change subject',role:'override',application:'global',relativity:1});
  await work;assert.ok(!JSON.parse(f.calls[2].init.body).prompt.includes('Injected after capture'));
  const o=fixture().options;o.references[0].contextGroups=[];const pending=captureOutputVideoSource(contract,o);o.references[0].contextGroups.push({name:'after hash'});assert.deepEqual((await pending).reference.contextGroups,[]);
 });

 test('cooperative source, preparation, attempt, pending and receipt hooks cannot write after their deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  for(const [name,expectedCalls] of [['onBeforeSourceTransmission',0],['onBeforeProviderAttempt',2],['onPrepared',2],['onProviderSubmission',2],['onReceipt',3]]){
   const f=fixture();let release,capturedLease,writes=0;
   f.options[name]=async(...args)=>{capturedLease=args.at(-1);await new Promise(resolve=>{release=resolve;});capturedLease.assertCurrent();writes++;};
   const work=fakeNetwork(f.fetch,()=>generateCreativeVideo(env,'A pan',f.options));while(!release)await new Promise(resolve=>setImmediate(resolve));
   t.mock.timers.tick(30000);await assert.rejects(work,/timeout/);assert.equal(f.calls.length,expectedCalls);assert.ok(capturedLease.signal.aborted);
   release();await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,0);assert.equal(f.calls.length,expectedCalls);
  }
 });

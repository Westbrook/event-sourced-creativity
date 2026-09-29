import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCreativeImage} from '../worker/image-adapter.ts';
import {readImageResponseStream,readBoundedImageResponse} from '../worker/image-response-stream.ts';
import {imagePreviewOptions} from '../worker/image-generation-preview.ts';
import {generationOutcomeSummary} from '../src/model/generation-execution-evidence.ts';
import {unknownGenerationOutcome} from '../src/model/generation-outcome-evidence.ts';
import {memoryMedia} from './helpers/still-media-fixture.mjs';
const encoder=new TextEncoder(),encode=value=>encoder.encode(`data: ${JSON.stringify(value)}\r\n\r\n`);
const final={type:'image_generation.completed',b64_json:btoa('final-pixels'),size:'1536x1024',output_format:'png',usage:{input_tokens:100,output_tokens:500,total_tokens:600,input_tokens_details:{text_tokens:100,image_tokens:0}}};
async function fixture(t,body,options={}){
 const saved=globalThis.fetch,evidence=[],receipts=[],retained=[];let posts=0;
 t.after(()=>{globalThis.fetch=saved;});
 globalThis.fetch=async url=>{
  if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
  posts++;return new Response(body,{headers:{'x-request-id':'req-original','content-type':'text/event-stream'}});
 };
 const run=()=>generateCreativeImage({OPENAI_API_KEY:'fixture-only'},'owner',{}, {title:'Original'}, {quality:'high',partialImages:1,onEvidence:async e=>evidence.push(e),onProviderSubmission:async r=>receipts.push(r),onFinalImage:async image=>retained.push(image),...options});
 return {run,evidence,receipts,retained,posts:()=>posts};
}
for(const trailer of ['open','reset','malformed','duplicate'])test(`terminal image survives ${trailer} stream without another POST`,async t=>{
 let canceled=0;
 const body=new ReadableStream({start(c){c.enqueue(encode(final));if(trailer==='malformed')c.enqueue(encoder.encode('data: invalid\n\n'));if(trailer==='duplicate')c.enqueue(encode({...final,b64_json:btoa('wrong')}));if(trailer==='reset')setTimeout(()=>{try{c.error(new Error('late reset'));}catch{/* Already canceled by the final event. */}},20);},cancel(){canceled++;}});
 const f=await fixture(t,body);const image=await f.run();
 assert.equal(new TextDecoder().decode(image.bytes),'final-pixels');assert.equal(f.posts(),1);assert.equal(f.retained.length,1);
 assert.equal(f.receipts.at(-1).status,'completed');assert.equal(f.receipts.at(-1).providerRequestId,'req-original');assert.equal(canceled,1);
});
test('headers survive truncated body and unknown result never becomes completed',async t=>{
 const f=await fixture(t,new ReadableStream({start(c){c.close();}}));
 await assert.rejects(f.run(),e=>e.detail.requestId==='req-original'&&e.detail.pipelineStage==='media_result');
 assert.equal(f.receipts.at(-1).status,'pending');assert.equal(f.receipts.at(-1).providerRequestId,'req-original');
 assert.ok(f.evidence.some(e=>e.evidenceId.endsWith(':headers')&&e.operation.requestId==='req-original'));
 assert.equal(f.retained.length,0);assert.equal(f.posts(),1);
});
for(const mode of ['stream','json'])test(`finance failure still attempts original ${mode} custody and evidence`,async t=>{
 const body=mode==='stream'?new ReadableStream({start(c){c.enqueue(encode(final));c.close();}}):JSON.stringify({data:[{b64_json:final.b64_json}],usage:final.usage});
 const f=await fixture(t,body,{partialImages:mode==='stream'?1:0,onProviderSubmission:async r=>{if(r.status==='completed')throw new Error('finance unavailable');}});
 await assert.rejects(f.run(),/finance unavailable/);assert.equal(f.retained.length,1);assert.equal(f.posts(),1);
 assert.ok(f.evidence.some(e=>e.outcome.pipelineStage==='media_result'&&e.outcome.contentOutcome==='usable'));
});
test('journal failure preserves known measured financial receipt',async t=>{
 const f=await fixture(t,new ReadableStream({start(c){c.enqueue(encode(final));c.close();}}),{onFinalImage:async()=>{throw new Error('journal unavailable');}});
 await assert.rejects(f.run(),/journal unavailable/);assert.equal(f.receipts.at(-1).status,'completed');assert.equal(f.receipts.at(-1).totalTokens,600);assert.equal(f.posts(),1);
});
test('optional progress DB fault cannot lose the final; authority loss still stops',async t=>{
 const controller=new AbortController();const options=imagePreviewOptions({MEDIA:memoryMedia()},{execution:{signal:controller.signal,progress:async()=>{throw new Error('database unavailable');}},ownerId:'owner',generationId:'original',model:'model',provider:'openai',adapter:'test'});
 const f=await fixture(t,new ReadableStream({start(c){c.enqueue(encode({...final,type:'image_generation.partial_image',partial_image_index:0}));c.enqueue(encode(final));c.close();}}),options);
 assert.equal(new TextDecoder().decode((await f.run()).bytes),'final-pixels');assert.equal(f.posts(),1);
 const denied=imagePreviewOptions({MEDIA:memoryMedia()},{execution:{signal:controller.signal,progress:async()=>{throw new Error('document_job_lease_lost');}},ownerId:'owner',generationId:'original',provider:'openai',model:'model',adapter:'test'});
 await assert.rejects(denied.onPartial({bytes:encoder.encode('partial'),index:0,width:1,height:1,mimeType:'image/png'}),/lease_lost/);
});
test('stream parser preserves split UTF8 and CRLF boundaries and cleans up',async()=>{
 const raw=encoder.encode('data: {"type":"completed","text":"é"}\r\n\r\n');let received;
 await readImageResponseStream(new Response(new ReadableStream({start(c){for(const byte of raw)c.enqueue(Uint8Array.of(byte));c.close();}})),async e=>{received=e;return true;});
 assert.equal(received.text,'é');
});
for(const input of ['data: [DONE]\n\n','data: {}\n\n',''])test(`non-terminal EOF cannot complete: ${JSON.stringify(input)}`,async()=>{
 await assert.rejects(readImageResponseStream(new Response(input),async()=>false),/incomplete/);
});
test('stream read has bounded idle wait and bytes',async()=>{
 await assert.rejects(readImageResponseStream(new Response(new ReadableStream({})),async()=>false,{idleMilliseconds:5}),/idle_timeout/);
 await assert.rejects(readImageResponseStream(new Response('data: {}\n\n'),async()=>false,{maximumBytes:3}),/too_large/);
});
test('pending image evidence overrides stale not-dispatched without borrowing planner proof',()=>{
 const generationOutcome={...unknownGenerationOutcome('media_submission'),dispatchState:'not_dispatched'};
 const pending={clientRequestId:'image-original',provider:'openai',operation:'image',model:'image',status:'pending'};
 const checkpoint={generationOutcome,providerSubmissions:{image:pending,planner:{...pending,clientRequestId:'plan',operation:'planning',status:'completed',providerRequestId:'planner-id'}}};
 assert.equal(generationOutcomeSummary(checkpoint).dispatchState,'dispatch_unknown');
 pending.providerRequestId='image-id';assert.equal(generationOutcomeSummary(checkpoint).dispatchState,'response_received');
 assert.equal(generationOutcome.dispatchState,'not_dispatched');
});

test('absolute stream deadline terminates a trickling response',async()=>{
 let timer;const body=new ReadableStream({start(c){timer=setInterval(()=>c.enqueue(encoder.encode(': heartbeat\n\n')),2);},cancel(){clearInterval(timer);}});
 await assert.rejects(readImageResponseStream(new Response(body),async()=>false,{maximumMilliseconds:20,idleMilliseconds:100}),/deadline/);
});
test('JSON transport shares byte, deadline and abort bounds',async()=>{
 await assert.rejects(readBoundedImageResponse(new Response('large body'),{maximumBytes:3}),/too_large/);
 await assert.rejects(readBoundedImageResponse(new Response(new ReadableStream({})),{maximumMilliseconds:5}),/deadline/);
 const c=new AbortController();c.abort();await assert.rejects(readBoundedImageResponse(new Response('{}'),{signal:c.signal}));
});
test('valid original pixels with absent usage are retained without inventing a zero charge',async t=>{
 const f=await fixture(t,new ReadableStream({start(c){c.enqueue(encode({...final,usage:undefined}));c.close();}}));
 await assert.rejects(f.run(),e=>e.detail.code==='provider_usage_receipt_missing');
 assert.equal(f.retained.length,1);assert.equal(f.receipts.at(-1).accountingState,'unknown');assert.equal(f.receipts.at(-1).costMicrousd,undefined);assert.equal(f.posts(),1);
});
test('unknown completed event names cannot certify a final image',async t=>{
 const f=await fixture(t,new ReadableStream({start(c){c.enqueue(encode({...final,type:'unrelated.completed'}));c.close();}}));
 await assert.rejects(f.run());assert.equal(f.retained.length,0);assert.equal(f.posts(),1);
});

test('invalid terminal payload preserves usage but cannot claim usable pixels',async t=>{
 const f=await fixture(t,new ReadableStream({start(c){c.enqueue(encode({...final,size:'0x1024'}));c.close();}}));
 await assert.rejects(f.run(),/invalid_image/);assert.equal(f.retained.length,0);assert.equal(f.receipts.at(-1).contentOutcome,'invalid');assert.equal(f.receipts.at(-1).totalTokens,600);
 assert.equal(f.evidence.at(-1).outcome.contentOutcome,'invalid');assert.equal(f.posts(),1);
});

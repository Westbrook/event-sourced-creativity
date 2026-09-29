import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_VIDEO_MODEL,DEFAULT_REFERENCE_VIDEO_MODEL,selectVideoModel} from '../src/model/video-adapter.ts';
import {generateCreativeVideo,validateCreativeVideoReferences} from '../worker/openai-adapter.ts';

const env={FAL_KEY:'test-only',FAL_VIDEO_MODEL:DEFAULT_REFERENCE_VIDEO_MODEL,FAL_REFERENCE_VIDEO_MODEL:DEFAULT_REFERENCE_VIDEO_MODEL};
const options={seconds:4,size:'1280x720',audioMode:'silent'};
test('automatic routing follows actual pixel inputs, including legacy production configuration',()=>{
 assert.equal(selectVideoModel({},0),DEFAULT_VIDEO_MODEL);
 assert.equal(selectVideoModel(env,0),DEFAULT_VIDEO_MODEL);
 assert.equal(selectVideoModel(env,1),DEFAULT_REFERENCE_VIDEO_MODEL);
 assert.equal(selectVideoModel(env,0,DEFAULT_REFERENCE_VIDEO_MODEL),DEFAULT_REFERENCE_VIDEO_MODEL);
 assert.equal(validateCreativeVideoReferences(env,[],undefined,'original_ambient'),DEFAULT_VIDEO_MODEL);
 assert.throws(()=>validateCreativeVideoReferences(env,[{}],DEFAULT_VIDEO_MODEL),e=>e.detail.code==='video_reference_provider_unsupported');
});
test('fresh no-reference video submits text endpoint with explicit silence and resolution',async()=>{
 const saved=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{
  calls.push({url:String(url),init});
  if(init?.method==='POST')return Response.json({request_id:'routing-test'});
  if(String(url).includes('/status'))return Response.json({status:'COMPLETED'});
  if(String(url).includes('/requests/'))return Response.json({video:{url:'https://fal.media/test-video.mp4',content_type:'video/mp4'}});
  if(String(url)==='https://fal.media/test-video.mp4')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}});
  assert.fail('Unexpected provider request');
 };
 try {
  const result=await generateCreativeVideo(env,'A red ball rolls across a table.',options);
  const posts=calls.filter(c=>c.init?.method==='POST');assert.equal(posts.length,1);
  assert.equal(posts[0].url,`https://queue.fal.run/${DEFAULT_VIDEO_MODEL}`);
  const input=JSON.parse(posts[0].init.body);
  assert.equal(input.generate_audio,false);assert.equal(input.resolution,'720p');assert.equal(input.duration,'4');assert.equal(input.image_urls,undefined);
  assert.equal(result.model,DEFAULT_VIDEO_MODEL);assert.equal(result.costMicrousd,4*302400);
 }finally{globalThis.fetch=saved;}
});
test('explicit reference endpoint without media fails before any provider request',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=()=>assert.fail('No provider request expected');
 try{await assert.rejects(generateCreativeVideo(env,'A red ball rolls.',{...options,providerModel:DEFAULT_REFERENCE_VIDEO_MODEL}),e=>e.detail.code==='video_reference_required');}
 finally{globalThis.fetch=saved;}
});
test('resuming a reference job pins the retained model even with no local reference inputs',async()=>{
 const stop=new Error('prepared receipt inspected');
 await assert.rejects(generateCreativeVideo(env,'A red ball rolls.',{...options,providerJobId:'existing-job',retainedReceipt:{model:DEFAULT_REFERENCE_VIDEO_MODEL,submittedPrompt:'Original prompt',parameters:{duration:4,resolution:'720p',generate_audio:false},referenceInputs:[],usedReferencePixels:true},onPrepared:receipt=>{assert.equal(receipt.model,DEFAULT_REFERENCE_VIDEO_MODEL);assert.equal(receipt.submittedPrompt,'Original prompt');throw stop;}}),e=>e===stop);
});

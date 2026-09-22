import test from 'node:test';
import assert from 'node:assert/strict';
import { imageGenerationProgress, imageGenerationStatus } from '../src/model/image-generation-progress.ts';
import { generationStatus } from '../src/still/results.ts';
import { imagePreviewOptions } from '../worker/image-generation-preview.ts';
import { generateCreativeImage } from '../worker/openai-adapter.ts';
import { memoryMedia } from './helpers/still-media-fixture.mjs';

const partial = {bytes:new TextEncoder().encode('partial'),index:0,mimeType:'image/png',width:1536,height:1024};
const job = (patch={}) => ({jobId:'job',documentId:'doc',kind:'generate',status:'running',stage:'rendering',imageSize:{width:1536,height:1024},result:{partialMediaUrl:'/api/media/owned%2Fimage.png?partial=0',partialWidth:1536,partialHeight:1024},...patch});

test('shared image presentation follows actual lifecycle and hides terminal or other-document partials',()=>{
  for(const kind of ['generate','preview']) {
    for(const [status,stage,label] of [['queued','queued','Queued'],['running','planning','Preparing…'],['running','provider-submit','Generating…'],['running','rendering','Generating…'],['running','storage','Saving…'],['committing','saving','Saving…']]) {
      const current=job({kind,status,stage});
      assert.equal(imageGenerationStatus(current),label);
      assert.equal(generationStatus(current),label);
      assert.equal(imageGenerationProgress(current,'doc').mediaUrl,status==='queued'?'':current.result.partialMediaUrl);
    }
  }
  for(const status of ['failed','canceled','completed','partial'])assert.equal(imageGenerationProgress(job({status}),'doc'),null);
  assert.equal(imageGenerationProgress(job(),'another-document'),null);
  assert.equal(imageGenerationProgress(job({kind:'render_document'}),'doc'),null);
});

test('a waiting image keeps its requested shape and never embeds untrusted URLs',()=>{
  for(const url of [undefined,'https://external.invalid/image','//external.invalid/image','data:image/png;base64,aaaa','/api/media/../session','/api/media/a\\b']) {
    const progress=imageGenerationProgress(job({result:{partialMediaUrl:url}}),'doc');
    assert.equal(progress.mediaUrl,'');assert.equal(progress.width,1536);assert.equal(progress.height,1024);
  }
  const result=imageGenerationProgress(job({result:{partialMediaUrl:'/api/media/image',partialWidth:0,partialHeight:NaN}}),'doc');
  assert.equal(result.width,1536);assert.equal(result.height,1024);
});

const setup = (patch={}) => {
  const controller=new AbortController(),updates=[];
  const env={MEDIA:memoryMedia()};
  const execution={signal:controller.signal,progress:async(...args)=>updates.push(args),beginCommit:async()=>{}};
  const input={execution,ownerId:'owner',generationId:'generation',model:'gpt-image-2.5-sunburst',provider:'openai',adapter:'openai-image-v5',...patch};
  return {env,execution,controller,updates,input,options:imagePreviewOptions(env,input)};
};

test('one partial is saved on the private media route and updates the existing job',async()=>{
  const f=setup();assert.equal(f.options.partialImages,1);
  await f.options.onPartial(partial);
  assert.equal(f.updates.length,1);
  const [stage,message,checkpoint]=f.updates[0];
  assert.equal(stage,'rendering');assert.equal(message,'Generating…');assert.ok(!message.includes('%'));
  assert.equal(checkpoint.partialWidth,1536);
  const key=decodeURIComponent(checkpoint.partialMediaUrl.split('?')[0].slice('/api/media/'.length));
  assert.deepEqual((await f.env.MEDIA.get(key)).body,partial.bytes);
});

test('optional storage failure keeps generation running; cancellation and authority failures propagate',async()=>{
  const f=setup();f.env.MEDIA.put=async()=>{throw new Error('storage unavailable');};
  await f.options.onPartial(partial);assert.deepEqual(f.updates,[]);
  f.controller.abort();await assert.rejects(f.options.onPartial(partial),{name:'AbortError'});
  const g=setup();g.execution.progress=async()=>{throw new Error('document_job_canceled');};
  await assert.rejects(g.options.onPartial(partial),/document_job_canceled/);
});

test('fixed-price Output routes and providers without previews retain their request contracts',()=>{
  for(const patch of [{provider:'fal'},{execution:undefined},{execution:{output:{}}}])assert.deepEqual(setup(patch).options,{});
});

for(const edit of [false,true])for(const previews of [0,1])test(`high-quality ${edit?'edit':'generation'} streams ${previews} early images before its final receipt`,async()=>{
  const saved=globalThis.fetch,f=setup();let submissions=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
    submissions++;
    assert.equal(url,`https://api.openai.com/v1/images/${edit?'edits':'generations'}`);
    const body=edit?Object.fromEntries(init.body.entries()):JSON.parse(init.body);
    assert.equal(String(body.stream),'true');assert.equal(String(body.partial_images),'1');assert.equal(body.quality,'high');
    const events=[...(previews?[{type:`image_${edit?'edit':'generation'}.partial_image`,b64_json:btoa('partial'),partial_image_index:0,size:'1536x1024',output_format:'png'}]:[]),{type:`image_${edit?'edit':'generation'}.completed`,b64_json:btoa('final'),size:'1536x1024',output_format:'png',usage:{input_tokens:20,output_tokens:1000,total_tokens:1020}}];
    // Arbitrary byte boundaries, including between CR and LF, exercise the SSE parser.
    const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
    return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=13)controller.enqueue(bytes.slice(i,i+13));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
  };
  try {
    const result=await generateCreativeImage({OPENAI_API_KEY:'fixture-only'},'owner',{facts:[]},{title:'Quiet image'},{quality:'high',size:'1536x1024',...f.options,...(edit?{references:[{bytes:new Uint8Array([1]),mimeType:'image/png',source:'uploaded-reference'}]}:{})});
    assert.equal(result.model,'gpt-image-2.5-sunburst');assert.equal(new TextDecoder().decode(result.bytes),'final');
    assert.equal(result.partialCount,previews);assert.equal(f.updates.length,previews);assert.equal(result.usage.totalTokens,1020);assert.equal(submissions,1);
  } finally {globalThis.fetch=saved;}
});

test('a partial followed by a provider error never becomes a completed image or a retry',async()=>{
  const saved=globalThis.fetch,f=setup();let submissions=0;
  globalThis.fetch=async(url)=>{
    if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
    submissions++;
    return new Response([{type:'image_generation.partial_image',b64_json:btoa('partial'),partial_image_index:0,size:'1536x1024'}, {type:'error',error:{message:'Generation stopped'}}].map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  };
  try{await assert.rejects(generateCreativeImage({OPENAI_API_KEY:'fixture-only'},'owner',{facts:[]},{title:'Image'},{...f.options}),/Generation stopped/);assert.equal(f.updates.length,1);assert.equal(submissions,1);}finally{globalThis.fetch=saved;}
});

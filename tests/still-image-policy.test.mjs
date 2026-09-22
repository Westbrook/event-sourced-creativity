import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { stillImageEnvironment } from '../worker/still-image-policy.ts';
import { selectImageAdapter } from '../worker/image-adapter-selection.ts';
import { StillClient } from '../src/still/client.ts';

test('Still pins GPT-image for plain images and reference edits without changing other providers or legacy jobs', () => {
  const env = {FORMA_IMAGE_PROVIDER:'fal-ideogram',FAL_KEY:'test',OPENAI_API_KEY:'test',FAL_AUDIO_MODEL:'audio',FAL_VIDEO_MODEL:'video'};
  const pinned = stillImageEnvironment(env,'still',{stillImageProvider:'openai'});
  for (const references of [[], [{}], [{}, {}]]) {
    assert.equal(selectImageAdapter(pinned,{references}).provider,'openai');
    assert.equal(selectImageAdapter(pinned,{references}).model,'gpt-image-2.5-sunburst');
  }
  assert.equal(pinned.FAL_AUDIO_MODEL,env.FAL_AUDIO_MODEL);
  assert.equal(pinned.FAL_VIDEO_MODEL,env.FAL_VIDEO_MODEL);
  assert.equal(pinned.FAL_KEY,env.FAL_KEY);
  assert.equal(stillImageEnvironment(env,'document',{stillImageProvider:'openai'}),env);
  assert.equal(stillImageEnvironment(env,'still',{}),env,'Existing jobs are not rerouted');
  assert.equal(selectImageAdapter(env).provider,'fal-ideogram');
});

test('Still image availability depends on OpenAI even when Forma selects an unavailable Fal provider', () => {
  const client=new StillClient();
  client.session={user:{role:'creator'},provider:{configured:false,plannerConfigured:true}};
  assert.ok(client.abilities.formats.includes('image'));
  assert.ok(client.abilities.formats.includes('storyboard'));
});

for (const kind of ['generate','preview']) test(`real ${kind} admission and job execution use GPT-image with an Ideogram deployment default`, async () => {
  const f=await createSceneCostFixture(1,'visual'), saved=globalThis.fetch;
  f.env.FORMA_IMAGE_PROVIDER='fal-ideogram';
  // Fal is deliberately unavailable: Still preflight must also use OpenAI.
  const calls=[],imageRequests=[];
  globalThis.fetch=async(url,init)=>{
    const path=String(url);calls.push(path);
    if(path.endsWith('/moderations'))return Response.json({id:'test',results:[{flagged:false,categories:{}}]});
    if(path.endsWith('/responses'))return Response.json({id:'test-direction',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Harbor',rationale:'A quiet setting',scene:'A keeper watches a harbor',palette:['#ffffff','#333333'],next_moves:['Review']}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
    imageRequests.push({url:path,body:JSON.parse(init.body)});
    return Response.json({error:{message:'Simulated definitive rejection',type:'invalid_request_error'}},{status:400});
  };
  try {
    const decision=await f.request('/api/still/decision',f.json({projectId:f.projectId,documentId:f.documentId,view:'choose-format',recentActions:[]}));
    assert.ok((await decision.json()).candidateIds.includes('image'),'Jev can recommend GPT-image without Fal');
    const request={kind,documentId:f.documentId,sourceSurface:'still',payload:{requestKey:`still:${f.documentId}:4:gpt-policy`,paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true,productionMode:'manual',stillImageProvider:'fal-ideogram',requestedImageSize:{width:1,height:1}}};
    const response=await f.request('/api/document-jobs',f.json(request));
    assert.equal(response.status,202,await response.clone().text());
    const {job}=await response.json();
    const row=f.sqlite.prepare('SELECT request_json FROM document_jobs WHERE job_id=?').get(job.jobId);
    assert.equal(JSON.parse(row.request_json).stillImageProvider,'openai');
    if(kind==='generate')assert.ok(job.imageSize?.width>1,'Server resolves dimensions rather than trusting the client hint');
    if(kind==='generate')assert.deepEqual(job.imageSize,JSON.parse(row.request_json).requestedImageSize);
    await f.drainBackground();
    await f.run(job.jobId);
    assert.equal(imageRequests.length,1);
    assert.equal(imageRequests[0].url,'https://api.openai.com/v1/images/generations');
    assert.equal(imageRequests[0].body.model,kind==='preview'?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst');
    if(kind==='generate')assert.equal(imageRequests[0].body.size,`${job.imageSize.width}x${job.imageSize.height}`,'Pending dimensions match the actual provider request');
    const finished=f.sqlite.prepare('SELECT status,result_json FROM document_jobs WHERE job_id=?').get(job.jobId);
    assert.equal(finished.status,'failed');
    assert.match(JSON.stringify(JSON.parse(finished.result_json).errorDetail),/Simulated definitive rejection/);
    assert.ok(calls.some(url=>url.endsWith('/images/generations')),JSON.stringify(calls));
    assert.ok(calls.every(url=>url.startsWith('https://api.openai.com/')));
    if(kind==='generate'){
    const before=calls.length;
    const repeated=await f.request('/api/document-jobs',f.json(request));
    assert.equal((await repeated.json()).job.jobId,job.jobId);
    await f.drainBackground();
    assert.equal(calls.length,before,'Receipt lookup must not purchase another image');
    }
    assert.equal(f.env.FORMA_IMAGE_PROVIDER,'fal-ideogram');
  } finally {await f.drainBackground();globalThis.fetch=saved;f.close();}
});

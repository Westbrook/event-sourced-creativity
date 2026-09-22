import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {memoryMedia} from './helpers/still-media-fixture.mjs';

for(const shared of [false,true])test(`image job exposes a private preview before the final result (${shared?'project':'personal'})`,async()=>{
  const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;
  f.env.MEDIA=memoryMedia();
  f.sqlite.exec(readFileSync(new URL('../db/operations/budget-hold-dispositions.sql',import.meta.url),'utf8'));
  let finishStream,paidImages=0;
  const finalReady=new Promise(resolve=>{finishStream=resolve;});
  const encoder=new TextEncoder(),event=value=>encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
    if(String(url).endsWith('/responses'))return Response.json({id:'planner-preview-fixture',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Quiet image',rationale:'A clear direction',scene:'A lantern beside the harbor',palette:['#fff','#333'],next_moves:['Review']}),usage:{input_tokens:100,output_tokens:100,total_tokens:200}});
    assert.equal(url,'https://api.openai.com/v1/images/generations');paidImages++;
    const body=JSON.parse(init.body);assert.equal(body.stream,true);assert.equal(body.partial_images,1);
    return new Response(new ReadableStream({async start(controller){
      controller.enqueue(event({type:'image_generation.partial_image',b64_json:btoa('preview-pixels'),partial_image_index:0,size:body.size,output_format:'png'}));
      await finalReady;
      controller.enqueue(event({type:'image_generation.completed',b64_json:btoa('final-pixels'),size:body.size,output_format:'png',usage:{input_tokens:100,output_tokens:500,total_tokens:600,input_tokens_details:{text_tokens:100,image_tokens:0}}}));controller.close();
    }}),{headers:{'content-type':'text/event-stream','x-request-id':'preview-image-fixture'}});
  };
  let running;
  try {
    const response=await f.request('/api/document-jobs',f.json({kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{requestKey:'quiet-preview-'+shared,paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true,productionMode:'manual'}}));
    assert.equal(response.status,202,await response.clone().text());const {job}=await response.json();
    running=f.run(job.jobId);
    let checkpoint;
    for(let i=0;i<200;i++){
      const row=f.sqlite.prepare('SELECT status,result_json FROM document_jobs WHERE job_id=?').get(job.jobId);
      checkpoint=JSON.parse(row.result_json??'{}');
      if(checkpoint.partialMediaUrl||row.status==='failed')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.ok(checkpoint.partialMediaUrl,JSON.stringify(checkpoint));
    const observed=await f.request('/api/document-jobs/'+job.jobId);
    assert.equal(observed.status,200,await observed.clone().text());
    assert.equal((await observed.json()).job.result.partialMediaUrl,checkpoint.partialMediaUrl);
    const media=await f.request(checkpoint.partialMediaUrl);
    assert.equal(media.status,200,await media.clone().text());assert.equal(await media.text(),'preview-pixels');
    finishStream();const completed=await running;
    assert.equal(completed.body.job.status,'completed',JSON.stringify(completed.body));
    assert.equal(paidImages,1);
    const final=await f.request(checkpoint.partialMediaUrl.split('?')[0]);
    assert.equal(final.status,200);assert.equal(await final.text(),'final-pixels');
    assert.equal(completed.body.job.result.partialMediaUrl,undefined);
  } finally {finishStream();if(running)await running;await f.drainBackground();globalThis.fetch=saved;f.close();}
});

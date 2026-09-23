import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {memoryMedia} from './helpers/still-media-fixture.mjs';
import {imageQueueRequest} from '../worker/ordinary-image-queue-protocol.ts';
import companion from '../workers/ordinary-image-queue/index.ts';
const secret='mock-companion-secret-with-at-least-32-characters';
async function setup(t,{shared=false,unknown=false}={}){
 const f=await createSceneCostFixture(1,'visual',{shared});f.env.MEDIA=memoryMedia();
 f.sqlite.exec(readFileSync(new URL('../db/operations/ordinary-image-queue.sql',import.meta.url),'utf8'));
 f.sqlite.exec(readFileSync(new URL('../db/operations/budget-hold-dispositions.sql',import.meta.url),'utf8'));
 Object.assign(f.env,{FORMA_ORDINARY_IMAGE_QUEUE_QUALIFIED:'v1',FORMA_ORDINARY_IMAGE_QUEUE_SECRET:secret,FORMA_ORDINARY_IMAGE_QUEUE_USERS:f.owner});
 const saved=globalThis.fetch;let images=0,planning=0;
 t.after(async()=>{await f.drainBackground();globalThis.fetch=saved;f.close();});
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
  if(String(url).endsWith('/responses')){planning++;return Response.json({id:'queue-plan',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Original',scene:'Lantern',palette:['white'],rationale:'Clear',next_moves:[]}),usage:{input_tokens:100,output_tokens:100,total_tokens:200}});}
  assert.ok(String(url).endsWith('/images/generations'));images++;
  if(unknown)throw new TypeError('connection reset after dispatch');
  return new Response('data: '+JSON.stringify({type:'image_generation.completed',b64_json:Buffer.from('original image bytes').toString('base64'),size:JSON.parse(init.body).size,output_format:'png',usage:{input_tokens:100,output_tokens:500,total_tokens:600,input_tokens_details:{text_tokens:100,image_tokens:0}}})+'\n\n',{headers:{'x-request-id':'queue-image'}});
 };
 const admit=()=>f.request('/api/document-jobs',f.json({kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{requestKey:'queue-original',paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true,productionMode:'manual'}}));
 const forward=async request=>f.request(new URL(request.url).pathname,{method:request.method,headers:request.headers,body:await request.text()});
 const invoke=async(action,body={},now)=>forward(await imageQueueRequest('https://fixture.invalid',secret,action,body,now));
 return {...f,admit,invoke,forward,calls:()=>({images,planning})};
}
for(const shared of [false,true])test(`independent admission, lost wakeup, browser observation and duplicate delivery (${shared?'project':'personal'})`,async t=>{
 const f=await setup(t,{shared});const response=await f.admit();assert.equal(response.status,202,await response.clone().text());const {job}=await response.json();
 assert.equal(job.executionOwner,'durable');assert.deepEqual(f.calls(),{images:0,planning:0});
 const browser=await f.run(job.jobId);assert.equal(browser.response.status,202);assert.equal(browser.body.job.status,'queued');
 assert.deepEqual(f.calls(),{images:0,planning:0});
 for(let i=0;i<2;i++)assert.deepEqual((await (await f.invoke('sweep')).json()).jobs,[{jobId:job.jobId}]);
 const run=await f.invoke('run',{jobId:job.jobId});assert.equal(run.status,200,await run.clone().text());assert.equal((await run.json()).status,'completed',JSON.stringify(f.sqlite.prepare('SELECT error_message,result_json FROM document_jobs WHERE job_id=?').get(job.jobId)));
 assert.equal((await (await f.invoke('run',{jobId:job.jobId})).json()).status,'completed');
 assert.deepEqual(f.calls(),{images:1,planning:1});assert.deepEqual((await (await f.invoke('sweep')).json()).jobs,[]);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='GenerationCompleted' AND correlation_id=?").get(job.jobId+':attempt:1').n,1);
});
test('unknown provider outcome closes into resolution without a new purchase on redelivery',async t=>{
 const f=await setup(t,{unknown:true});const {job}=await (await f.admit()).json();
 for(let i=0;i<2;i++){const response=await f.invoke('run',{jobId:job.jobId});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).resolution,'resolution_required');}
 assert.deepEqual(f.calls(),{images:1,planning:1});
 const reservation=f.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE operation='image-generation'").get();assert.equal(reservation.status,'executing');
});
test('rollback keeps browser locked out of an admitted independent job',async t=>{
 const f=await setup(t);const {job}=await (await f.admit()).json();delete f.env.FORMA_ORDINARY_IMAGE_QUEUE_QUALIFIED;
 assert.equal((await f.run(job.jobId)).body.job.status,'queued');assert.deepEqual(f.calls(),{images:0,planning:0});assert.equal((await f.invoke('run',{jobId:job.jobId})).status,404);
});
test('missing outbox schema cannot leave an admitted browser-owned fallback',async t=>{
 const f=await setup(t);f.sqlite.exec('DROP TABLE ordinary_image_outbox');
 await assert.rejects(f.admit(),/ordinary_image_outbox/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);assert.deepEqual(f.calls(),{images:0,planning:0});
});
test('forged or expired ingress and browser enrollment are rejected',async t=>{
 const f=await setup(t);
 assert.equal((await f.request('/api/internal/ordinary-images/run',f.json({jobId:'fake'}))).status,403);
 assert.equal((await f.invoke('run',{jobId:'fake'},Date.now()-120000)).status,403);
 const forged=await imageQueueRequest('https://fixture.invalid',secret,'run',{jobId:'fake'});forged.headers.set('x-image-queue-signature','0'.repeat(64));assert.equal((await f.forward(forged)).status,403);
 const response=await f.request('/api/document-jobs',f.json({kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{ordinaryImageExecution:'queue-v1'}}));assert.equal(response.status,400);
 assert.deepEqual(f.calls(),{images:0,planning:0});
});
test('companion retries a lost queue send and awaits original delivery without a browser',async t=>{
 const f=await setup(t);const {job}=await (await f.admit()).json();let sends=0,queued,acks=0;
 const env={APP:{fetch:f.forward},IMAGE_QUEUE_SECRET:secret,IMAGE_JOBS:{sendBatch:async jobs=>{sends++;if(sends===1)throw new Error('queue unavailable');queued=jobs;}}};
 await assert.rejects(companion.scheduled({},env),/queue unavailable/);await companion.scheduled({},env);assert.deepEqual(queued,[{body:{jobId:job.jobId}}]);
 await companion.queue({messages:[{body:{jobId:job.jobId},ack(){acks++;},retry(){assert.fail('unexpected retry');}}]},env);
 assert.equal(acks,1);assert.deepEqual(f.calls(),{images:1,planning:1});
});

test('closed delivery cannot restart after authorization is restored',async t=>{
 const f=await setup(t);const {job}=await (await f.admit()).json();
 f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.owner);
 const stopped=await f.invoke('run',{jobId:job.jobId});assert.equal(stopped.status,200);assert.equal((await stopped.json()).resolution,'current_authority_unavailable');
 f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('pilot-2026-08-10',f.owner);
 assert.equal((await (await f.invoke('run',{jobId:job.jobId})).json()).resolution,'current_authority_unavailable');assert.deepEqual(f.calls(),{images:0,planning:0});
});

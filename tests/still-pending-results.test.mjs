import test from 'node:test';
import assert from 'node:assert/strict';
import { stillResults, generationPreview, generationResult, generationFormat } from '../src/still/results.ts';
import { StillClient } from '../src/still/client.ts';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
const job=(patch={})=>({jobId:'job-1',documentId:'d',kind:'generate',status:'running',result:null,requestedSequence:2,requestedAt:'2026-09-17T12:00:00Z',...patch});
const p=()=>({documentId:'d',documentTitle:'Harbor',outputs:[],artifacts:[]});
test('running work is listed immediately, scoped to its document, without inventing media',()=>{
 const items=stillResults(p(),[job(),job({jobId:'other',documentId:'e'}),job({kind:'preview'}),job({kind:'chat'})],[]);
 assert.equal(items.length,1);assert.equal(items[0].view,'generation');assert.equal(items[0].title,'Harbor');assert.equal(items[0].url,'');
 for(const kind of ['short_story','scene','slides','storyboard','video','audio','model3d'])assert.equal(generationFormat(job({kind:'render_document',result:{artifactKind:kind}})),kind);
});
test('canonical image publication replaces its pending card even before the next job poll',()=>{
 const projection=p();projection.outputs=[{id:'image',documentId:'d',sourceEventId:'published',sequence:3,mediaUrl:'/api/media/image'}];
 const events=[{eventId:'published',correlationId:'job-1',payload:{}}];
 const items=stillResults(projection,[job()],events);
 assert.equal(items.length,1);assert.equal(items[0].id,'image');assert.equal(generationResult(job(),projection,events),'image');
 projection.outputs[0].discarded=true;
 assert.equal(stillResults(projection,[job({status:'completed'})],events).length,0,'Discarded work must not reappear as a pending card');
 assert.equal(generationResult(job(),projection,events),'');
});
test('artifact and image receipts resolve exact results, never the most recent unrelated result',()=>{
 const projection=p();projection.artifacts=[{id:'a',documentId:'d',kind:'model3d',sequence:4,title:'Object'}];
 assert.equal(generationResult(job({result:{artifactId:'a'}}),projection,[]),'a');
 assert.equal(generationResult(job({result:{artifactId:'foreign'}}),projection,[]),'');
 projection.outputs=[{id:'i',documentId:'d',sourceEventId:'e',sequence:3}];
 assert.equal(generationResult(job({result:{appendedEventIds:['e']}}),projection,[{eventId:'e',payload:{}}]),'i');
 assert.equal(stillResults(projection,[job({status:'failed',dismissedAt:'now'})],[]).length,3);
});
for(const shared of [false,true])test(`pending deep links hydrate through the authorized job API (${shared?'shared':'personal'})`,async()=>{
 const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;
 const now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString();
 const id='pending-result-test';
 f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,requested_at,expires_at,updated_at) VALUES(?,?,?,?,'generate','queued','still',?,1,'{}','{}',?,?,?)`).run(id,f.owner,f.streamId,f.documentId,id,now,expires,now);
 f.sqlite.prepare('UPDATE document_jobs SET request_json=? WHERE job_id=?').run(JSON.stringify({documentRevision:'revision',stillImageProvider:'openai',requestedImageSize:{width:1024,height:1536},snapshot:{facts:[{type:'format',active:true,properties:{image_format:{aspect_ratio:{width:2,height:3}}}}]}}),id);
 if(shared){
  const {appendAuditEvent}=await import('../worker/runtime.ts');const s=f.sharing;
  const e=await appendAuditEvent(f.env,f.streamId,`user:${f.owner}`,'ProjectDocumentJobQueued',{job_id:id,document_id:f.documentId,project_id:f.projectId,organization_id:s.organizationId,project_access_id:s.projectAccessId,history_owner_user_id:f.owner,actor_user_id:f.owner,kind:'generate'});
  f.sqlite.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'job',?,?,?,?,'actor_private',?,?,?)`).run(s.projectAccessId,id,s.organizationId,f.projectId,f.owner,e.eventId,f.owner,now);
 }
 const writes=[];
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith('/'));if(init?.method==='POST')writes.push(String(url));return f.request(url,init);};
 try{
  const c=new StillClient();await c.load({hydrateContent:false});c.position={...c.position,projectId:f.projectId,documentId:f.documentId,view:'generation',outputId:id};
  await c.pollJobs();assert.equal(c.jobsLoaded,true);assert.equal(c.jobs[0].jobId,id);assert.equal(c.jobs[0].status,'queued');assert.deepEqual(c.jobs[0].imageSize,{width:1024,height:1536});assert.deepEqual(generationPreview(c.jobs[0],c.projection,[]).width,1024);
  assert.equal(stillResults(c.projection,c.jobs,c.events).find(r=>r.id===id)?.view,'generation');
  f.sqlite.prepare("UPDATE document_jobs SET status='completed',notified_at=?,completed_at=? WHERE job_id=?").run(now,now,id);
  await c.pollJobs();assert.equal(c.jobs.find(j=>j.jobId===id)?.status,'completed','Direct lookup retains a completed job omitted from recent results');
  c.position.outputId='missing';await c.pollJobs();assert.ok(!c.jobs.some(j=>j.jobId==='missing'));assert.equal(c.jobsError,'');
  assert.deepEqual(writes,[`/api/document-jobs/${id}/run`],'Resume the already-authorized queued attempt once; never admit a replacement during reads');
 }finally{globalThis.fetch=saved;f.close();}
});

test('pending presentation uses known names and requested dimensions without guessing',()=>{
 const j=job({result:{artifactPlan:{title:'Harbor study'}}});
 const request={type:'GenerationRequested',correlationId:j.jobId,payload:{document_id:'d',provider_render_size:'1024x1536'}};
 assert.deepEqual(generationPreview(j,p(),[request]),{title:'Harbor study',width:1024,height:1536});
 assert.deepEqual(generationPreview(job(),p(),[]),{title:'Harbor'});
 assert.deepEqual(generationPreview(job(),p(),[{...request,correlationId:'other'}]),{title:'Harbor'});
});

test('an older jobs response cannot erase a newly accepted generation',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch;
 let release,started;const held=new Promise(resolve=>release=resolve),reading=new Promise(resolve=>started=resolve);
 globalThis.fetch=async(url,init)=>{
  const response=await f.request(url,init);
  if(String(url).startsWith('/api/document-jobs?')){started();await held;}
  return response;
 };
 try{
  const c=new StillClient();await c.load({hydrateContent:false});c.position={...c.position,projectId:f.projectId,documentId:f.documentId,view:'results'};
  const polling=c.pollJobs();await reading;
  c.jobs=[job({documentId:f.documentId,jobId:'just-accepted'})];release();await polling;
  assert.ok(c.jobs.some(j=>j.jobId==='just-accepted'));assert.equal(c.jobsLoaded,true);
  c.position={...c.position,view:'generation',outputId:'older-job'};
  assert.equal(c.jobsLoaded,false,'A different generation link must wait for its own authorized read');
 }finally{release();globalThis.fetch=saved;f.close();}
});

test('pending image size comes from the saved request, never current edits or other jobs',async()=>{
 const {documentJobImageSize}=await import('../worker/document-job-image-size.ts');
 const request={stillImageProvider:'openai',snapshot:{facts:[]}};
 assert.deepEqual(documentJobImageSize('generate',request),{width:1536,height:1024});
 assert.equal(documentJobImageSize('generate',{}),undefined);
 assert.equal(documentJobImageSize('render_document',request),undefined);
 assert.equal(documentJobImageSize('generate',{...request,workflowId:'workflow'}),undefined);
 assert.deepEqual(generationPreview(job({imageSize:{width:800,height:1200}}),p(),[]),{title:'Harbor',width:800,height:1200});
 assert.deepEqual(generationPreview(job({imageSize:{width:-1,height:1200}}),p(),[]),{title:'Harbor'});
});

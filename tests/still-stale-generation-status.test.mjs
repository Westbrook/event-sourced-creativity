import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {appendAuditEvent} from '../worker/runtime.ts';
import {StillClient} from '../src/still/client.ts';

async function fixture(t){const f=await createSceneCostFixture();t.after(async()=>{await f.drainBackground();f.close();});return f;}
function insert(f,id,{status='running',kind='generate',fresh=false,attempt=1,result={}}={}){
 const time=new Date(Date.now()-(fresh?0:600000)).toISOString(),lease=new Date(Date.now()+(fresh?75000:-525000)).toISOString();
 const checkpoint={providerSubmissionProtocol:1,providerSubmissions:{media:{clientRequestId:'media-'+id,provider:'openai',model:'gpt-image-2',operation:'image',status:'pending'}},...result};
 f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,started_at,lease_expires_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,'still',?,1,'{}',?,?,?,?,?,?,?)`).run(id,f.owner,f.streamId,f.documentId,kind,status,id+':attempt:1',JSON.stringify(checkpoint),attempt,time,attempt?time:null,status==='queued'?null:lease,'2099-01-01T00:00:00.000Z',time);
}
const read=(f,id)=>f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(id);
for(const path of ['list','detail'])test('poll closes first expired paid attempt via '+path+' without resubmission',async t=>{
 const f=await fixture(t);insert(f,'stale');insert(f,'queued',{status:'queued',attempt:0,result:{providerSubmissions:{}}});
 const provider=[];t.mock.method(globalThis,'fetch',async url=>{provider.push(url);throw new Error('No provider dispatch during observation');});
 const response=await f.request(path==='list'?'/api/document-jobs?document='+f.documentId:'/api/document-jobs/queued');assert.equal(response.status,200,await response.clone().text());
 const stale=read(f,'stale');assert.equal(stale.status,'failed');assert.equal(stale.attempt_count,1);assert.equal(stale.error_message,'provider_submission_uncertain');assert.equal(stale.correlation_id,'stale:attempt:1');
 assert.equal(JSON.parse(stale.result_json).providerSubmissions['media'].status,'pending');
 assert.equal(read(f,'queued').status,'queued');assert.deepEqual(provider,[]);
 await f.request('/api/document-jobs/stale');assert.equal(read(f,'stale').completed_at,stale.completed_at,'repeat reads preserve the same terminal attempt');
});
test('active lease and newly renewed heartbeat survive status polls',async t=>{
 const f=await fixture(t);insert(f,'live',{fresh:true});const before=read(f,'live');await f.request('/api/document-jobs/live');assert.equal(read(f,'live').status,'running');assert.equal(read(f,'live').result_json,before.result_json);
 insert(f,'racing');f.controls.beforeRun=async statement=>{if(statement.sql.startsWith("UPDATE document_jobs SET status='failed'")){const now=new Date().toISOString();f.sqlite.prepare('UPDATE document_jobs SET updated_at=?,lease_expires_at=? WHERE job_id=?').run(now,new Date(Date.now()+75000).toISOString(),'racing');}};
 await f.request('/api/document-jobs/racing');assert.equal(read(f,'racing').status,'running');
});
test('saved terminal image evidence wins over an expired lease',async t=>{
 const f=await fixture(t);insert(f,'saved',{result:{providerSubmissions:{}}});
 await appendAuditEvent(f.env,f.streamId,'worker:renderer','GenerationCompleted',{document_id:f.documentId,project_id:f.projectId,object_id:'saved-image',media_url:'/api/media/saved'},'saved:attempt:1');
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Recovery must not contact a provider');});
 const response=await f.request('/api/document-jobs/saved');assert.equal(response.status,200,await response.clone().text());assert.equal(read(f,'saved').status,'completed');assert.equal(read(f,'saved').attempt_count,1);
});
const queued={jobId:'q',documentId:'doc',sourceSurface:'still',kind:'generate',status:'queued',attemptCount:0};
test('foreground queue continuation coalesces starts, backs off, and excludes already-started attempts',async()=>{
 const c=new StillClient(),calls=[];let release;c.request=async(path)=>{calls.push(path);return new Promise(resolve=>release=resolve);};
 c.dispatchGeneration(queued);c.dispatchGeneration(queued);assert.equal(calls.length,1);
 release({job:queued});await new Promise(resolve=>setImmediate(resolve));c.dispatchGeneration(queued);assert.equal(calls.length,1);
 c.generationRunAfter.clear();c.dispatchGeneration(queued);assert.equal(calls.length,2);release({job:queued});await new Promise(resolve=>setImmediate(resolve));
 for(const changes of [{jobId:'started',attemptCount:1},{jobId:'failed',status:'failed'},{jobId:'native',executionOwner:'durable'},{jobId:'memory',memoryMode:'recall'},{jobId:'forma',sourceSurface:'document'}])c.dispatchGeneration({...queued,...changes});
 assert.equal(calls.length,2);
});
test('inspection leaves a stale attempt unchanged',async t=>{
 const f=await fixture(t);insert(f,'inspect');const before=read(f,'inspect');
 const response=await f.request('/api/document-jobs/inspect?inspection=1');assert.equal(response.status,200);assert.deepEqual(read(f,'inspect'),before);
});
test('terminal event arriving during stale failure is recovered instead',async t=>{
 const f=await fixture(t);insert(f,'late');let inserted=false;
 f.controls.beforeRun=async statement=>{if(!inserted&&statement.sql.startsWith("UPDATE document_jobs SET status='failed'")){inserted=true;await appendAuditEvent(f.env,f.streamId,'worker:renderer','GenerationCompleted',{document_id:f.documentId,project_id:f.projectId,object_id:'late-image'},'late:attempt:1');}};
 await f.request('/api/document-jobs/late');assert.equal(read(f,'late').status,'completed');assert.equal(read(f,'late').attempt_count,1);
});
test('shared actor polling reconciles without exposing provider receipts',async t=>{
 const f=await createSceneCostFixture(1,'visual',{shared:true});t.after(async()=>{await f.drainBackground();f.close();});insert(f,'shared-stale');
 const s=f.sharing,now=new Date().toISOString();
 const event=await appendAuditEvent(f.env,f.streamId,`user:${f.owner}`,'ProjectDocumentJobQueued',{job_id:'shared-stale',document_id:f.documentId,project_id:f.projectId,organization_id:s.organizationId,project_access_id:s.projectAccessId,history_owner_user_id:f.owner,actor_user_id:f.owner,kind:'generate'});
 f.sqlite.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'job',?,?,?,?,'actor_private',?,?,?)`).run(s.projectAccessId,'shared-stale',s.organizationId,f.projectId,f.owner,event.eventId,f.owner,now);
 const response=await f.request('/api/document-jobs?document='+f.documentId);assert.equal(response.status,200,await response.clone().text());assert.equal(read(f,'shared-stale').status,'failed');const body=await response.json();assert.equal(body.jobs[0].result.providerSubmissions,undefined);
});
test('poll continues only the oldest unstarted Still job after the blocker clears',async()=>{
 const c=new StillClient(),starts=[];c.verifyScope=async()=>()=>{};c.request=async()=>({jobs:[{...queued,requestedAt:'2026-01-02'},{...queued,jobId:'older',requestedAt:'2026-01-01'}]});c.dispatchGeneration=j=>starts.push(j.jobId);
 await c.pollJobs();assert.deepEqual(starts,['older']);
 c.request=async()=>({jobs:[{...queued,requestedAt:'2026-01-01'},{...queued,jobId:'blocker',status:'running'}]});await c.pollJobs();assert.deepEqual(starts,['older']);
});

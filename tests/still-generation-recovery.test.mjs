import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { StillClient } from '../src/still/client.ts';
import { operationJournal } from '../src/still/operation-journal.ts';
import { stillGenerationDigest } from '../worker/still-generation-recovery.ts';
import { appendAuditEvent } from '../worker/runtime.ts';

async function receipt(f,key,{id=crypto.randomUUID(),expired=false,scoped=true}={}){
  const now=new Date().toISOString(),expires=new Date(Date.now()+(expired?-1:1)*86_400_000).toISOString();
  f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,requested_at,completed_at,notified_at,expires_at,updated_at)
    VALUES(?,?,?,?,'generate','completed','still',?,1,?,?, ?,?,?,?,?)`).run(id,f.owner,f.streamId,f.documentId,id,JSON.stringify({requestKey:key,documentRevision:'fixture',promptTechnique:'prose'}),JSON.stringify({artifactKind:'image'}),now,now,now,expires,now);
  if(f.sharing&&scoped){
    const s=f.sharing;
    const event=await appendAuditEvent(f.env,f.streamId,`user:${f.owner}`,'ProjectDocumentJobQueued',{job_id:id,document_id:f.documentId,project_id:f.projectId,organization_id:s.organizationId,project_access_id:s.projectAccessId,history_owner_user_id:f.owner,actor_user_id:f.owner,kind:'generate'});
    f.sqlite.prepare(`INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,visibility,source_event_id,actor_user_id,created_at) VALUES(?,'job',?,?,?,?,'actor_private',?,?,?)`).run(s.projectAccessId,id,s.organizationId,f.projectId,f.owner,event.eventId,f.owner,now);
  }
  return id;
}

for(const shared of [false,true])test(`Still exact receipt recovery and explicit new review (${shared?'shared':'personal'})`,async()=>{
  const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;
  let admissions=0;
  globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith('/'),'No external provider requests');if(url==='/api/document-jobs'&&init?.method==='POST')admissions++;return f.request(url,init);};
  const scope=`${f.owner}:${f.sharing?.projectAccessId??'personal'}`;
  try{
    const c=new StillClient();await c.load();c.position={...c.position,projectId:f.projectId,documentId:f.documentId,view:'document'};
    const key=`still:${f.documentId}:4:lost`,id=await receipt(f,key);
    if(!shared){const recent=await (await f.request(`/api/document-jobs?document=${f.documentId}`)).json();assert.ok(!recent.jobs.some(j=>j.jobId===id),'Acknowledged completion is missing from the recent list');}
    operationJournal.saveGeneration(scope,{documentId:f.documentId,format:'image',requestKey:key});
    const found=await c.generate(c.prepareGeneration('image'));
    assert.equal(found.jobId,id);assert.equal(found.status,'completed');assert.equal(c.pendingGeneration,null);assert.equal(admissions,0);
    const replay=await f.request('/api/document-jobs',f.json({kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{requestKey:key}}));
    assert.equal(replay.status,202,await replay.clone().text());assert.equal((await replay.json()).job.jobId,id);assert.equal(f.counts().document_jobs,1);
    const missing=`still:${f.documentId}:4:never-admitted`;
    operationJournal.saveGeneration(scope,{documentId:f.documentId,format:'image',requestKey:missing});
    const draft=c.prepareGeneration('image');await assert.rejects(c.generate(draft),/Original status unknown/);
    assert.equal(draft.recoveryClosed,true);assert.equal(c.pendingGeneration.closed,true);assert.equal(admissions,0);
    const reopened=c.prepareGeneration('image');assert.equal(reopened.recoveryClosed,true);
    const fresh=c.reviewNewGeneration(reopened);assert.equal(fresh.attempted,undefined);assert.notEqual(c.generationPayload(fresh).payload.requestKey,missing);assert.equal(fresh.acknowledgements,undefined);assert.equal(fresh.previousUnconfirmed,true);assert.equal(admissions,0);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='StillGenerationRequestClosed' AND json_extract(payload,'$.request_digest')=?").get(await stillGenerationDigest(missing)).n,1);
    const expired=`still:${f.documentId}:4:expired`;await receipt(f,expired,{expired:true});
    const response=await f.request('/api/document-jobs/still-reconcile',f.json({documentId:f.documentId,requestKey:expired}));assert.equal(response.status,200);assert.equal((await response.json()).reason,'receipt_expired');
    const bad=await f.request('/api/document-jobs/still-reconcile',f.json({documentId:'another-document',requestKey:missing}));assert.equal(bad.status,400);
    const crossOrigin=await f.request('/api/document-jobs/still-reconcile',{...f.json({documentId:f.documentId,requestKey:missing}),headers:{origin:'https://another.example','content-type':'application/json'}});assert.equal(crossOrigin.status,403);
    if(shared){
      f.setScopedHeaders({});
      const personal=await f.request('/api/document-jobs/still-reconcile',f.json({documentId:f.documentId,requestKey:key}));
      assert.equal(personal.status,200);assert.equal((await personal.json()).job,undefined,'Personal scope cannot disclose the shared receipt');
      f.setScopedHeaders(f.sharing.headers);
      const sharedAgain=await f.request('/api/document-jobs/still-reconcile',f.json({documentId:f.documentId,requestKey:key}));assert.equal((await sharedAgain.json()).job.jobId,id);
    }
    assert.equal(f.counts().budget_reservations,0);assert.equal(f.counts().cost_budget_reservations,0);
  }finally{globalThis.fetch=saved;operationJournal.clearGeneration(scope,f.documentId);await f.drainBackground();f.close();}
});

for(const shared of [false,true])test(`Still closure prevents a delayed image admission (${shared?'shared':'personal'})`,async()=>{
  const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;
  f.env.REVE_API_KEY='in-memory-image-test';
  let intercepted=false,moderations=0;
  globalThis.fetch=async(url)=>{assert.match(String(url),/\/v1\/moderations$/);moderations++;return Response.json({id:'fixture',model:'omni-moderation-latest',results:[{flagged:false,categories:{}}]});};
  try{
    const key=`still:${f.documentId}:4:delayed`;
    const close=async statements=>{
      if(intercepted||!statements.some(s=>/^INSERT(?: OR IGNORE)? INTO document_jobs\b/.test(s.sql)))return;
      intercepted=true;
      const response=await f.request('/api/document-jobs/still-reconcile',f.json({documentId:f.documentId,requestKey:key}));
      assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'closed');
    };
    f.controls.beforeRun=s=>close([s]);f.controls.beforeBatch=close;
    const request={kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{requestKey:key,paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true,productionMode:'manual'}};
    const response=await f.request('/api/document-jobs',f.json(request));
    assert.equal(intercepted,true,await response.clone().text());assert.equal(response.status,409);assert.equal((await response.json()).error,'generation_request_closed');
    assert.equal(f.counts().document_jobs,0);assert.equal(f.counts().budget_reservations,0);assert.equal(f.counts().cost_budget_reservations,0);
    const repeat=await f.request('/api/document-jobs',f.json(request));assert.equal(repeat.status,409);assert.equal(f.counts().document_jobs,0);
    assert.ok(moderations<=1);
  }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});

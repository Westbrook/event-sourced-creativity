import test from 'node:test';
import assert from 'node:assert/strict';
import { failureNotification, canContinueReview } from '../src/still/notifications.ts';
import { generationReview } from '../src/still/generation-review.ts';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { StillClient } from '../src/still/client.ts';

test('safety failures lead to context review; only acknowledgeable admission warnings offer Continue',()=>{
 const job={jobId:'failure',attemptCount:1,kind:'generate',errorDetail:{category:'safety',action:'edit_request',code:'safety_preflight_flagged',message:'Review the prompt.'}};
 assert.equal(failureNotification(job).action,'context');
 assert.equal(canContinueReview(generationReview(409,{error:'generation_preflight_blocked'})),false);
 assert.equal(canContinueReview(generationReview(428,{error:'generation_preflight_review_required'})),true);
 assert.equal(canContinueReview(generationReview(428,{error:'generation_budget_acknowledgement_required'})),true);
 assert.equal(canContinueReview(null),false);
 const transient={...job,errorDetail:{category:'network',action:'retry',code:'provider_network_error',message:'Unavailable.'}};
 assert.equal(failureNotification(transient).action,'generation');
 assert.notEqual(failureNotification(job).key,failureNotification({...job,attemptCount:2}).key);
});

test('dismissing a failed generation persists existing dismissal metadata without retrying or changing its failure',async()=>{
 const f=await createSceneCostFixture(1,'visual'),saved=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).startsWith('/'),'No provider calls');return f.request(url,init);};
 try {
  const now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString(),id='toast-failure';
  f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,requested_at,completed_at,expires_at,updated_at)
   VALUES(?,?,?,?,'generate','failed','still',?,1,'{}',?,?,?,?,?)`).run(id,f.owner,f.streamId,f.documentId,id,JSON.stringify({stage:'failed',errorDetail:{code:'safety_preflight_flagged',category:'safety',action:'edit_request',message:'Review context.',retryable:false}}),now,now,expires,now);
  const client=new StillClient();await client.load();client.position={...client.position,documentId:f.documentId,projectId:f.projectId,view:'document'};await client.pollJobs();
  const job=client.jobs.find(j=>j.jobId===id);assert.ok(job);const before=f.counts();
  await client.dismissJob(job);assert.ok(client.jobs.find(j=>j.jobId===id).dismissedAt);
  await client.pollJobs();assert.ok(client.jobs.find(j=>j.jobId===id).dismissedAt);
  const row=f.sqlite.prepare('SELECT status,attempt_count,result_json FROM document_jobs WHERE job_id=?').get(id);
  assert.equal(row.status,'failed');assert.equal(row.attempt_count,0);assert.equal(JSON.parse(row.result_json).errorDetail.code,'safety_preflight_flagged');
  assert.deepEqual(f.counts(),before);
 } finally {globalThis.fetch=saved;await f.drainBackground();f.close();}
});

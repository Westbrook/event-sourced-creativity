import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneCostFixture} from './helpers/scene-cost-fixture.mjs';
import {memoryMedia} from './helpers/still-media-fixture.mjs';
// Actual valid PNG bytes; providers remain entirely local mocks.
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=','base64'));
async function interrupted(t,{shared=false,fault='publish'}={}){
 const f=await createSceneCostFixture(1,'visual',{shared});f.env.MEDIA=memoryMedia();
 f.sqlite.exec(readFileSync(new URL('../db/operations/budget-hold-dispositions.sql',import.meta.url),'utf8'));
 const saved=globalThis.fetch;let images=0,planning=0,failed=false;
 t.after(async()=>{await f.drainBackground();globalThis.fetch=saved;f.close();});
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
  if(String(url).endsWith('/responses')){planning++;return Response.json({id:'original-planner',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Original image',scene:'A lantern',palette:['white'],rationale:'Clear direction',next_moves:[]}),usage:{input_tokens:100,output_tokens:100,total_tokens:200}});}
  assert.ok(String(url).endsWith('/images/generations'));images++;
  const {size}=JSON.parse(init.body);
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({type:'image_generation.completed',b64_json:Buffer.from(png).toString('base64'),size,output_format:'png',usage:{input_tokens:100,output_tokens:500,total_tokens:600,input_tokens_details:{text_tokens:100,image_tokens:0}}})}\n\n`));}}),{headers:{'x-request-id':'original-image'}});
 };
 const response=await f.request('/api/document-jobs',f.json({kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{requestKey:'image-recovery-'+crypto.randomUUID(),paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true,productionMode:'manual'}}));
 assert.equal(response.status,202,await response.clone().text());const {job}=await response.json();
 f.controls.beforeRun=async statement=>{if(fault!=='finance'||failed||!statement.sql.startsWith('UPDATE document_jobs'))return;let p;try{p=JSON.parse(statement.values[0]);}catch{return;}if(Object.values(p.providerSubmissions??{}).some(c=>c.operation==='image'&&c.status==='completed')){failed=true;throw new Error('fixture finance transaction unavailable');}};
 f.controls.beforeBatch=async statements=>{

  if(fault==='publish'&&!failed&&statements.some(s=>s.values.includes('GenerationCompleted'))){failed=true;throw new Error('fixture completion transaction unavailable');}
 };
 f.controls.afterBatch=async statements=>{if(fault==='journal-ack'&&!failed&&statements.some(s=>s.sql.startsWith('UPDATE document_jobs')&&typeof s.values[0]==='string'&&s.values[0].includes('imageResponseJournal'))){failed=true;throw new Error('journal acknowledgement lost after commit');}};
 const ran=await f.run(job.jobId);f.controls.beforeBatch=null;f.controls.beforeRun=null;f.controls.afterBatch=null;
 assert.equal(ran.body.job.status,'failed',JSON.stringify(ran.body));
 const row=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(job.jobId),checkpoint=JSON.parse(row.result_json);
 assert.equal(checkpoint.imageResultState,'retained',JSON.stringify(checkpoint));assert.ok(checkpoint.imageResponseJournal?.contentRef);assert.equal(ran.body.job.result.imageResponseJournal,undefined);assert.equal(ran.body.job.result.imageRecoveryAvailable,true);
 const journal=JSON.parse(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(checkpoint.imageResponseJournal.contentRef).content);
 return {...f,job:ran.body.job,row,checkpoint,journal,calls:()=>({images,planning})};
}
for(const shared of [false,true])test(`recover original image after publication fault (${shared?'project':'personal'})`,async t=>{
 const f=await interrupted(t,{shared});
 for(let repeat=0;repeat<2;repeat++){
  const response=await f.request(`/api/document-jobs/${f.job.jobId}/recover`,f.json({recoveryOnly:true}));const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.job.status,'completed');
 }
 assert.deepEqual(f.calls(),{images:1,planning:1});
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='GenerationCompleted' AND correlation_id=?").get(f.row.correlation_id).n,1);
 const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(f.checkpoint.costReservationId);
 assert.equal(cost.status,'settled');assert.equal(cost.used_microusd,16900);
 const audits=f.sqlite.prepare("SELECT SUM(json_extract(payload,'$.cost_microusd')) AS amount FROM events WHERE type='GenerationUsageRecorded' AND json_extract(payload,'$.cost_reservation_id')=?").get(f.checkpoint.costReservationId);
 assert.equal(audits.amount,cost.used_microusd);
 const media=await f.request(f.journal.media.url);assert.equal(media.status,200,await media.clone().text());assert.deepEqual(new Uint8Array(await media.arrayBuffer()),png);
 const publicEvents=f.sqlite.prepare("SELECT payload FROM events WHERE type='GenerationCompleted' AND correlation_id=?").all(f.row.correlation_id);
 assert.ok(publicEvents.every(row=>!row.payload.includes('Original image')&&!row.payload.includes('media_url')));
});
test('finance checkpoint failure retains original pixels and settles exactly once during recovery',async t=>{
 const f=await interrupted(t,{fault:'finance'});
 const response=await f.request(`/api/document-jobs/${f.job.jobId}/recover`,f.json({}));
 assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).job.status,'completed');
 assert.deepEqual(f.calls(),{images:1,planning:1});
 const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(f.checkpoint.costReservationId);
 assert.equal(cost.status,'settled');assert.equal(cost.used_microusd,16900);
});
for(const damage of ['expired','tampered','missing-media','preview-media','consent','deleted-document'])test(`recovery refuses ${damage} evidence without new purchase`,async t=>{
 const f=await interrupted(t);
 if(damage==='expired')f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.checkpoint.imageResponseJournal.contentRef);
 if(damage==='tampered')f.sqlite.prepare("UPDATE private_content SET content='{}' WHERE content_id=?").run(f.checkpoint.imageResponseJournal.contentRef);
 if(damage==='missing-media')f.env.MEDIA=memoryMedia();
 if(damage==='preview-media')await f.env.MEDIA.put(f.journal.media.key,new TextEncoder().encode('partial'),{httpMetadata:{contentType:'image/png'},customMetadata:{ownerId:f.owner}});
 if(damage==='deleted-document'){const {appendAuditEvent}=await import('../worker/runtime.ts');await appendAuditEvent(f.env,f.streamId,'user','DocumentRemoved',{document_id:f.documentId,project_id:f.projectId});}
 if(damage==='consent')f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id=?").run(f.owner);
 const response=await f.request(`/api/document-jobs/${f.job.jobId}/recover`,f.json({recoveryOnly:true}));
 assert.ok([403,409,428].includes(response.status),await response.clone().text());assert.deepEqual(f.calls(),{images:1,planning:1});
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='GenerationCompleted' AND correlation_id=?").get(f.row.correlation_id).n,0);
});
test('browser-supplied image journal cannot enter job admission',async t=>{
 const f=await createSceneCostFixture(1,'visual');t.after(async()=>{await f.drainBackground();f.close();});
 const response=await f.request('/api/document-jobs',f.json({kind:'generate',documentId:f.documentId,sourceSurface:'still',payload:{imageResponseJournal:{version:1,contentRef:'forged'}}}));
 assert.equal(response.status,400);
});

test('lost journal acknowledgement preserves committed original custody',async t=>{
 const f=await interrupted(t,{fault:'journal-ack'});const response=await f.request(`/api/document-jobs/${f.job.jobId}/recover`,f.json({}));
 assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).job.status,'completed');assert.deepEqual(f.calls(),{images:1,planning:1});
});
test('concurrent recovery publishes once and a later retry observes the same result',async t=>{
 const f=await interrupted(t);const recover=()=>f.request(`/api/document-jobs/${f.job.jobId}/recover`,f.json({}));
 const results=await Promise.all([recover(),recover()]);assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
 assert.equal((await recover()).status,200);assert.deepEqual(f.calls(),{images:1,planning:1});
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='GenerationCompleted' AND correlation_id=?").get(f.row.correlation_id).n,1);
});
test('retention expiring between recovery read and commit prevents publication',async t=>{
 const f=await interrupted(t);let raced=false;
 f.controls.beforeBatch=async statements=>{if(!raced&&statements.some(s=>s.values.includes('GenerationCompleted'))){raced=true;f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.checkpoint.imageResponseJournal.contentRef);}};
 const response=await f.request(`/api/document-jobs/${f.job.jobId}/recover`,f.json({}));f.controls.beforeBatch=null;
 assert.equal(raced,true);assert.equal(response.status,409);assert.deepEqual(f.calls(),{images:1,planning:1});
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='GenerationCompleted' AND correlation_id=?").get(f.row.correlation_id).n,0);
});
test('revoked project authority cannot restore private original content',async t=>{
 const f=await interrupted(t,{shared:true});f.sqlite.prepare("UPDATE organization_memberships SET status='revoked',revoked_at=? WHERE organization_id=? AND user_id=?").run(new Date().toISOString(),f.sharing.organizationId,f.owner);
 const response=await f.request(`/api/document-jobs/${f.job.jobId}/recover`,f.json({}));assert.ok([403,404,409].includes(response.status),await response.clone().text());
 assert.deepEqual(f.calls(),{images:1,planning:1});assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='GenerationCompleted' AND correlation_id=?").get(f.row.correlation_id).n,0);
});

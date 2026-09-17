import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sponsorReadFixture} from './sponsor-read-fixture.mjs';
const [{handleDocumentJobs},{appendAuditEvent},{identifySponsorImageRead,resolveSponsorImageRead},{reserveSponsorImageReadAttempt}]=await Promise.all([
  import('../worker/document-jobs-api.ts'),import('../worker/runtime.ts'),import('../worker/experience-sponsor-read-image.ts'),import('../worker/experience-sponsor-read-attempts.ts'),
]);
const terms=()=>({version:1,windowMs:60_000,operations:Object.fromEntries(['image-status','image-result','image-media'].map(op=>[op,{maximumBytes:32_000_000,deadlineMs:10_000}])),actor:{maximumRequestsPerWindow:10,maximumBytesPerWindow:320_000_000},campaign:{maximumRequestsPerWindow:20,maximumBytesPerWindow:640_000_000}});
const attempts=f=>f.sqlite.prepare('SELECT * FROM experience_sponsor_read_attempts').all();
const context={waitUntil(){throw Error('Passive GET attempted queue dispatch');}};
async function fixture(t,{policy=terms(),...options}={}){
 const f=await sponsorReadFixture(t,options);if(policy)await f.installReadPolicy(policy);
 f.get=(path=f.jobId,query='')=>handleDocumentJobs(f.readRequest({},'/api/document-jobs/'+path+query),f.env,path,context);
 return f;
}
async function body(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
function ordinary(f,{id='ordinary-job',status='completed',durable=false}={}){
 const row={...f.job,job_id:id,correlation_id:id,status,request_json:JSON.stringify(durable?{outputDurable:{version:1}}:{}),result_json:JSON.stringify({stage:status,ordinaryOnly:'preserved'}),notified_at:null,expires_at:'2099-01-01T00:00:00.000Z',lease_expires_at:status==='running'?'2099-01-01T00:00:00.000Z':null};
 const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO document_jobs(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));return row;
}
for(const completed of [false,true])for(const query of ['', '?inspection=1'])test(`native ${completed?'completed':'pending'} ${query?'inspection':'detail'} is one passive status attempt`,async t=>{
 const f=await fixture(t,{completed});const before=f.snapshotNativeState();const result=await body(await f.get(f.jobId,query));
 assert.equal(result.job.jobId,f.jobId);assert.equal(result.job.status,completed?'completed':'queued');assert.equal(result.job.result,null);
 assert.deepEqual(result.job.sponsoredRead,{version:1,operation:'image-status',passive:true});
 assert.equal(attempts(f).length,1);assert.equal(attempts(f)[0].operation,'image-status');assert.ok(!JSON.stringify(result).includes('plannerInput'));f.noReadSideEffects(before);
});
test('default mixed polls preserve ordinary and durable jobs without disclosing or charging sponsored jobs',async t=>{
 const f=await fixture(t);ordinary(f);ordinary(f,{id:'ordinary-durable',durable:true});const before=f.snapshotNativeState();
 for(const query of ['', '?scope=active', '?document='+encodeURIComponent(f.documentId)]){
  const result=await body(await f.get('',query));assert.deepEqual(result.jobs.map(j=>j.jobId).sort(),['ordinary-durable','ordinary-job']);
  assert.equal(result.jobs.find(j=>j.jobId==='ordinary-durable').executionOwner,'durable');assert.equal(result.jobs[0].result.ordinaryOnly,'preserved');
 }
 assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});
test('explicit one-job list selector shares quota with detail and inspection instead of implicit polling charges',async t=>{
 const policy=terms();policy.actor.maximumRequestsPerWindow=2;const f=await fixture(t,{policy});
 const first=await body(await f.get('','?sponsorJobId='+f.jobId+'&document='+f.documentId));assert.equal(first.jobs.length,1);assert.equal(first.jobs[0].jobId,f.jobId);
 await body(await f.get(f.jobId,'?inspection=1'));await body(await f.get(),429);assert.equal(attempts(f).length,2);f.noReadSideEffects();
});
for(const schemaAbsent of [false,true])test(`missing ${schemaAbsent?'dormant schema':'policy'} refuses only sponsored detail and keeps ordinary lists usable`,async t=>{
 const f=await fixture(t,{policy:null});ordinary(f);
 if(schemaAbsent){f.sqlite.exec('DROP TABLE experience_sponsor_read_attempts; DROP TABLE experience_sponsor_read_policies;');}
 const before=f.snapshotNativeState();await body(await f.get(),403);const result=await body(await f.get(''));assert.deepEqual(result.jobs.map(j=>j.jobId),['ordinary-job']);
 if(!schemaAbsent)assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});
test('selector refuses ordinary jobs, duplicates, conflicting paths and mismatched Document without ordinary fallthrough',async t=>{
 const f=await fixture(t);ordinary(f);const before=f.snapshotNativeState();
 await body(await f.get('','?sponsorJobId=ordinary-job'),404);
 await body(await f.get('','?sponsorJobId='+f.jobId+'&sponsorJobId='+f.jobId),400);
 await body(await f.get(f.jobId,'?sponsorJobId='+f.jobId),400);
 await body(await f.get('','?sponsorJobId='+f.jobId+'&document=wrong-document'),403);assert.equal(attempts(f).length,1);f.noReadSideEffects(before);
});
test('revoked generation authority and expired generation budget leave retained completed status readable',async t=>{
 const f=await fixture(t);f.sqlite.prepare('UPDATE experience_sponsor_campaigns SET enabled=0').run();
 f.sqlite.prepare('UPDATE experience_sponsor_grants SET enabled=0,expires_at_ms=issued_at_ms+1').run();
 f.sqlite.prepare("UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'").run();
 f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1').run();
 const before=f.snapshotNativeState();assert.equal((await body(await f.get())).job.status,'completed');assert.equal(attempts(f).length,1);f.noReadSideEffects(before);
});
for(const change of ['removed Document','expired job','redacted result','lost slot'])test(`${change} cannot fall through to unmetered ordinary reads`,async t=>{
 const f=await fixture(t);
 if(change==='removed Document')await appendAuditEvent(f.env,f.stream,'user','DocumentRemoved',{document_id:f.documentId,project_id:'project-atmosphere'});
 if(change==='expired job')f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(f.jobId);
 if(change==='redacted result')f.sqlite.prepare("UPDATE private_content SET redacted_at='2026-01-01' WHERE content_id=?").run(f.completedPayload.output_ref);
 if(change==='lost slot'){f.sqlite.exec('PRAGMA foreign_keys=OFF');f.sqlite.prepare('DELETE FROM output_operation_slots WHERE job_id=?').run(f.jobId);}
 const before=f.snapshotNativeState();await body(await f.get(),403);f.noReadSideEffects(before);
});
test('job retention expiry is status-only; exact retained original result still follows its own native custody',async t=>{
 const f=await fixture(t);f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(f.jobId);
 const before=f.snapshotNativeState();await body(await f.get(),403);
 const request=f.readRequest(),authority=await identifySponsorImageRead(request,f.env,{jobId:f.jobId});
 const attempt=await reserveSponsorImageReadAttempt(authority,request,f.env,'image-result');const result=await resolveSponsorImageRead(authority,attempt,request,f.env);
 assert.equal(result.original.outputId,f.completedPayload.object_id);assert.ok(Number.isFinite(result.monotonicDeadline));f.noReadSideEffects(before);
});
test('expiry during history traversal is refused by the final atomic proof',async t=>{
 const f=await fixture(t),batch=f.DB.batch.bind(f.DB);let changed=false;
 f.DB.batch=async statements=>{if(!changed&&statements.some(s=>s.sql.includes('page AS MATERIALIZED'))){changed=true;f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(f.jobId);}return batch(statements);};
 await body(await f.get(),403);assert.equal(changed,true);assert.equal(attempts(f).length,1);assert.equal(f.readEffects.fetch,0);
});
test('tiny status byte allowance refuses before expensive native page work and retains charged attempt',async t=>{
 const policy=terms();policy.operations['image-status'].maximumBytes=100;const f=await fixture(t,{policy}),prepare=f.DB.prepare.bind(f.DB);let pages=0;
 f.DB.prepare=sql=>{if(sql.includes('page AS MATERIALIZED'))pages++;return prepare(sql);};await body(await f.get(),403);assert.equal(pages,0);assert.equal(attempts(f).length,1);f.noReadSideEffects();
});
test('slow response consumer cannot extend the already reserved monotonic deadline',async t=>{
 const f=await fixture(t),response=await f.get();assert.equal(response.status,200);
 const current=performance.now();t.mock.method(performance,'now',()=>current+60_000);await assert.rejects(response.text(),/sponsor_read_deadline/);
 assert.equal(attempts(f).length,1);f.noReadSideEffects();
});
test('ordinary detail cannot use a stalled sponsored job as a recovery blocker',async t=>{
 const f=await fixture(t,{completed:false});ordinary(f);f.sqlite.prepare("UPDATE document_jobs SET status='running',lease_expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(f.jobId);
 const before=f.snapshotNativeState();const result=await body(await f.get('ordinary-job'));assert.equal(result.job.jobId,'ordinary-job');assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});
test('aborted status response retains its debit and stops native history continuation',async t=>{
 const f=await fixture(t),controller=new AbortController(),request=new Request(f.readRequest(),{signal:controller.signal});
 const batch=f.DB.batch.bind(f.DB);let aborted=false;
 f.DB.batch=async statements=>{const result=await batch(statements);if(!aborted&&statements.some(s=>s.sql.includes('page AS MATERIALIZED'))){aborted=true;controller.abort();}return result;};
 await body(await handleDocumentJobs(request,f.env,f.jobId,context),403);assert.equal(aborted,true);assert.equal(attempts(f).length,1);f.noReadSideEffects();
});
test('a negative preliminary classifier cannot disclose a newly visible sponsored detail',async t=>{
 const f=await fixture(t),prepare=f.DB.prepare.bind(f.DB);let missed=false;
 f.DB.prepare=sql=>{const statement=prepare(sql);if(!missed&&sql.startsWith('SELECT 1 AS present FROM document_jobs')){
  const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values);bound.first=async()=>{missed=true;return null;};return bound;};
 }return statement;};
 await body(await f.get(),404);assert.equal(missed,true);assert.equal(attempts(f).length,0);f.noReadSideEffects();
});
test('ordinary personal distinct-payer lineage without sponsorship stays ordinary',async t=>{
 const f=await fixture(t),row=ordinary(f),insert=(table,value)=>{const keys=Object.keys(value);f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(value));};
 const event=await appendAuditEvent(f.env,f.stream,'user','OutputExecutionAuthorized',{grant_id:'ordinary-grant',document_id:f.documentId,project_id:'project-atmosphere'});
 const preflight={...f.sqlite.prepare('SELECT * FROM output_preflights LIMIT 1').get(),preflight_id:'ordinary-preflight'};insert('output_preflights',preflight);
 const grant={...f.sqlite.prepare('SELECT * FROM output_execution_grants LIMIT 1').get(),grant_id:'ordinary-grant',preflight_id:preflight.preflight_id,authorization_event_id:event.eventId};insert('output_execution_grants',grant);
 const slot={...f.slot,slot_id:'ordinary-slot',grant_id:grant.grant_id,job_id:row.job_id,cost_reservation_id:'ordinary-cost',token_reservation_id:'ordinary-token',attempt_ordinal:1,previous_slot_id:f.slot.slot_id};insert('output_operation_slots',slot);
 const before=f.snapshotNativeState();const result=await body(await f.get(row.job_id));assert.equal(result.job.jobId,row.job_id);assert.equal(result.job.sponsoredRead,undefined);assert.equal(attempts(f).length,0);f.noReadSideEffects(before);
});
test('ordinary project detail/list keeps its selected owner and actor scope while campaigns coexist',async t=>{
 const {nativeImageReadFixture}=await import('./sponsor-native-image-read-fixture.mjs');
 const f=await nativeImageReadFixture(t,{ordinaryProject:true}),project=f.projectMedia;
 const headers={...project.headers,cookie:'forma_project_context=native-read-project-context'};
 f.sqlite.prepare("INSERT INTO capability_grants(grant_id,user_id,capability,scope_type,organization_id,project_access_id,project_id,status,granted_by_user_id,created_at,updated_at) VALUES(?,?,'project.output.request','project',?,?,?,'active',?,?,?)").run('job-read-project-request',project.editor,project.organizationId,project.projectAccessId,project.projectId,project.ownerUserId,new Date().toISOString(),new Date().toISOString());
 // The media fixture certifies shared media only; Job GET also requires its
 // separate actor-private native job scope. Declare that exact retained scope.
 const anchor=f.sqlite.prepare("SELECT event_id FROM events WHERE type='ProjectDocumentJobQueued' AND json_extract(payload,'$.job_id')=?").get(project.jobId);
 f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,organization_id,project_id,owner_user_id,actor_user_id,resource_kind,resource_id,visibility,source_event_id,created_at) VALUES(?,?,?,?,?,'job',?,'actor_private',?,?)").run(project.projectAccessId,project.organizationId,project.projectId,project.ownerUserId,project.editor,project.jobId,anchor.event_id,new Date().toISOString());
 const before=f.snapshotNativeState();
 for(const path of [project.jobId,'']){
  const response=await handleDocumentJobs(new Request('http://localhost/api/document-jobs/'+path,{headers}),f.env,path,context);
  const result=await body(response);const jobs=path?[result.job]:result.jobs;assert.ok(jobs.some(job=>job.jobId===project.jobId));assert.ok(jobs.every(job=>job.jobId!==f.jobId));
 }
 assert.equal(f.attempts().length,0);f.assertReadOnly(before);
});

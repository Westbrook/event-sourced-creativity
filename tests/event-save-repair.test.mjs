import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {registerOutputSourceImports} from './output-server-test-helpers.mjs';
const imports=registerOutputSourceImports();
const {generationReadiness}=await import('../worker/generation-storage-readiness.ts');
const {ensureSchema}=await import('../worker/runtime.ts');
const {inspectEventSaveRepair,applyEventSaveRepair,inspectEventSaveCompilation,EVENT_SAVE_REPAIR_TABLES,EVENT_SAVE_REPAIR_BARRIERS,EVENT_SAVE_REPAIR_REMOVED,EVENT_SAVE_COMPILE_PROBE}=await import('../worker/event-save-repair.ts');
const {inspectMemorySchemaRepair,applyMemorySchemaRepair}=await import('../worker/memory-schema-repair.ts');
const {nativeMemoryAnswerExclusion}=await import('../worker/memory-native-boundary.ts');
const {preparePrivateContent,storePrivateContent}=await import('../worker/private-content-storage.ts');
const {loadPrivateContent}=await import('../worker/pilot-policy.ts');
const {makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}=await import('../worker/event-write-primitives.ts');
test.after(()=>imports.deregister());
const authority={sql:'1',bindings:[]};
const migrations=readLocalMigrations(new URL('../drizzle/',import.meta.url));
function adapter(sqlite){
 const control={beforeBatch:null,batches:0,failIndex:null};
 class Statement{
  constructor(sql,values=[]){this.sql=sql;this.values=values;}
  bind(...values){return new Statement(this.sql,values);}
  async all(){return{success:true,results:sqlite.prepare(this.sql).all(...this.values)}}
  async first(){return sqlite.prepare(this.sql).get(...this.values)??null;}
  async run(){const r=sqlite.prepare(this.sql).run(...this.values);return{success:true,meta:{changes:Number(r.changes)}};}
 }
 return{control,db:{prepare:q=>new Statement(q),async batch(ss){control.batches++;control.beforeBatch?.(ss);sqlite.exec('BEGIN IMMEDIATE');try{const r=ss.map((s,i)=>{if(i===control.failIndex)throw Error('injected');const statement=sqlite.prepare(s.sql),results=statement.all(...s.values);return{success:true,results,meta:{changes:sqlite.prepare('SELECT changes() AS n').get().n}};});sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
}
const schema=sqlite=>sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());migrateLocalDatabase(sqlite,{migrations:migrations.slice(0,41)});
 const f={sqlite,...adapter(sqlite)};await ensureSchema({DB:f.db});
 await applyMemorySchemaRepair(f.db,(await inspectMemorySchemaRepair(f.db)).proof,authority);
 f.control.batches=0;
 return f;
}
async function save(db,type,index=1){
 const event=makeEvent('creative:save-test',index,'user:save-test','fixture','fixture',type,{project_id:'project',document_id:'document',block_id:'block',name:'Retained name',text:'Retained private text'});
 const values=eventWriteBindings(event);await db.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();
 return event;
}

test('repair preserves existing creative rows, baseline triggers, containment and receipts; new Memory writes fail closed',async t=>{
 const f=await fixture(t),event=await save(f.db,'ProjectCreated');
 const before=f.sqlite.prepare('SELECT * FROM events').all(),privateBefore=f.sqlite.prepare('SELECT * FROM event_private_payloads').all();
 const history=f.sqlite.prepare('SELECT * FROM __forma_local_migrations').all(),catalog=schema(f.sqlite);
 const plan=await inspectEventSaveRepair(f.db);assert.equal(plan.summary.status,'ready');
 const result=await applyEventSaveRepair(f.db,plan.proof,authority);assert.equal(result.applied,true);assert.equal(result.saveProbe,'four-synthetic-events-persisted-and-rolled-back');
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM events').all(),before);assert.deepEqual(f.sqlite.prepare('SELECT * FROM event_private_payloads').all(),privateBefore);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM __forma_local_migrations').all(),history);
 const removed=new Set(EVENT_SAVE_REPAIR_REMOVED.map(r=>r.name));for(const row of catalog)if(!removed.has(row.name))assert.deepEqual(schema(f.sqlite).find(r=>r.name===row.name),row);
 for(const table of EVENT_SAVE_REPAIR_TABLES){assert.throws(()=>f.sqlite.exec(`INSERT INTO ${table} DEFAULT VALUES`),/memory_inactive_save_repair/);assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);}
 assert.throws(()=>f.sqlite.prepare('UPDATE events SET payload=? WHERE event_id=?').run('{}',event.eventId),/append-only/);
 assert.throws(()=>f.sqlite.prepare('DELETE FROM events WHERE event_id=?').run(event.eventId),/append-only/);
 assert.equal((await inspectMemorySchemaRepair(f.db)).summary.status,'blocked','historical installer cannot silently reconnect the graph');
 for(const [index,type] of ['DocumentCreated','BlockCreated','BudgetReservationReconciled'].entries())await save(f.db,type,index+2);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM events').get().n,4);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM event_write_stage').get().n,0);
 assert.deepEqual(await inspectEventSaveCompilation(f.db),{status:'pass'});
 const after=schema(f.sqlite),again=await inspectEventSaveRepair(f.db);
 assert.equal((await applyEventSaveRepair(f.db,again.proof,authority)).applied,false);assert.deepEqual(schema(f.sqlite),after);
});

for(const fault of ['unknown-trigger','populated','changed-trigger','reserved','stale-proof','schema-race','authority','mid-ddl','last-ddl'])test('repair refuses or rolls back '+fault,async t=>{
 const f=await fixture(t);
 if(fault==='unknown-trigger')f.sqlite.exec('CREATE TRIGGER unrecognized_memory_dependency AFTER INSERT ON memory_derivation_results BEGIN SELECT 1; END');
 if(fault==='populated')f.sqlite.exec("INSERT INTO memory_derivation_qualifications VALUES('test','"+'a'.repeat(64)+"','test','test','{}','"+'b'.repeat(64)+"','qualified','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z')");
 if(fault==='changed-trigger'){f.sqlite.exec('DROP TRIGGER memory_derivation_result_events_insert');f.sqlite.exec('CREATE TRIGGER memory_derivation_result_events_insert BEFORE INSERT ON events BEGIN SELECT 1; END');}
 if(fault==='reserved')f.sqlite.exec('CREATE TABLE __forma_event_save_repair_guard(proof INTEGER)');
 const plan=await inspectEventSaveRepair(f.db),before=schema(f.sqlite);
 if(fault==='schema-race')f.control.beforeBatch=ss=>{if(ss.some(s=>s.sql.startsWith('DROP TRIGGER')))f.sqlite.exec('CREATE TABLE unrelated_concurrent_change(id TEXT)');};
 if(fault==='mid-ddl'||fault==='last-ddl')f.control.beforeBatch=ss=>{f.control.failIndex=ss.some(s=>s.sql.startsWith('DROP TRIGGER'))?(fault==='mid-ddl'?80:ss.length-1):null;};
 await assert.rejects(applyEventSaveRepair(f.db,fault==='stale-proof'?'0'.repeat(64):plan.proof,fault==='authority'?{sql:'0',bindings:[]}:authority));
 assert.deepEqual(schema(f.sqlite).filter(r=>r.name!=='unrelated_concurrent_change'),before);
});

test('tampered isolation barrier or new Memory data cannot be certified',async t=>{
 const f=await fixture(t);await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 f.sqlite.exec(`DROP TRIGGER ${EVENT_SAVE_REPAIR_BARRIERS[0].name}`);
 assert.equal((await inspectEventSaveRepair(f.db)).summary.status,'blocked');
 await assert.rejects(applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority),/precondition/);
});

test('full hosted-like schema compiles and saves at trigger depth3 after repair (reference SQLite)',async t=>{
 const f=await fixture(t),before=schema(f.sqlite);
 await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 const input={before,after:schema(f.sqlite),probe:EVENT_SAVE_COMPILE_PROBE.replace(' WHERE 0','')};
 const python=spawnSync('python3',[new URL('../scripts/qualify-event-save-depth.py',import.meta.url).pathname],{input:JSON.stringify(input),encoding:'utf8'});
 assert.equal(python.status,0,python.stderr||python.stdout);t.diagnostic(python.stdout.trim());
});

test('actual local D1 repairs atomically and rolls back all four real event saves', {timeout:120000},async t=>{
 const f=await fixture(t),{Miniflare,Log,LogLevel}=createRequire(import.meta.resolve('wrangler'))('miniflare');
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',host:'127.0.0.1',port:0,d1Databases:['DB'],log:new Log(LogLevel.NONE),script:'export default{fetch(){return new Response("isolated");}}',outboundService(){throw Error('No egress');}});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 const original=schema(f.sqlite).filter(r=>r.name!=='__forma_local_migrations');
 for(const kind of ['table','index','trigger']){const selected=original.filter(r=>r.type===kind);for(let i=0;i<selected.length;i+=40)await db.batch(selected.slice(i,i+40).map(r=>db.prepare(r.sql)));}
 // Install the original receipt because the schema copy intentionally has no rows.
 await db.prepare("INSERT INTO __forma_memory_schema_repair_receipts SELECT ?,?").bind((await inspectMemorySchemaRepair(f.db)).summary.manifest,new Date().toISOString()).run();
 const plan=await inspectEventSaveRepair(db);
 const broken={prepare:q=>db.prepare(q),batch:ss=>ss.length>100?db.batch([...ss,db.prepare('SELECT * FROM missing_final_repair_test')]):db.batch(ss)};
 await assert.rejects(applyEventSaveRepair(broken,plan.proof,authority));assert.equal((await inspectEventSaveRepair(db)).proof,plan.proof);
 const result=await applyEventSaveRepair(db,plan.proof,authority);assert.equal(result.applied,true);assert.equal(result.rollbackQualified,true);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first()).n,0);
 await save(db,'ProjectCreated');assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first()).n,1);
 assert.deepEqual(await inspectEventSaveCompilation(db),{status:'pass'});
 const env={DB:db};const readinessGuard=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});await db.prepare(`SELECT 1 FROM (SELECT '' AS content_id,'' AS kind) private_content WHERE ${readinessGuard.sql}`).bind(...readinessGuard.bindings).first();assert.equal((await generationReadiness(env)).ready,true);
 const content=await storePrivateContent(env,'d1-owner','document-artifact','synthetic delivered result');
 assert.equal((await loadPrivateContent(env,'d1-owner'))[content.contentId],'synthetic delivered result');
 await db.prepare(`DROP TRIGGER ${EVENT_SAVE_REPAIR_BARRIERS[0].name}`).run();
 assert.equal((await generationReadiness(env)).ready,false);
 await assert.rejects(loadPrivateContent(env,'d1-owner'));
});


test('isolated Memory permits ordinary retained input, output and reload without enabling Memory',async t=>{
 const f=await fixture(t),env={DB:f.db};
 await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 const input=await storePrivateContent(env,'ordinary-owner','document-artifact-input','retained input');
 const output=await storePrivateContent(env,'ordinary-owner','document-artifact','validated synthetic image metadata');
 assert.deepEqual(await loadPrivateContent(env,'ordinary-owner'),{[input.contentId]:'retained input',[output.contentId]:'validated synthetic image metadata'});
 assert.deepEqual(await loadPrivateContent(env,'different-owner'),{});
 assert.deepEqual(await inspectEventSaveCompilation(f.db),{status:'pass'});
 for(const table of EVENT_SAVE_REPAIR_TABLES)assert.throws(()=>f.sqlite.exec(`INSERT INTO ${table} DEFAULT VALUES`),/memory_inactive_save_repair/);
 assert.equal((await inspectMemorySchemaRepair(f.db)).summary.status,'blocked');
});

for(const fault of ['barrier','receipt','unknown-trigger','schema-race','populated-race','database-change'])test('ordinary isolated boundary refuses '+fault,async t=>{
 const f=await fixture(t),env={DB:f.db};
 await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 const output=await storePrivateContent(env,'ordinary-owner','document-artifact','private result');
 const guard=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
 if(fault==='barrier')f.sqlite.exec(`DROP TRIGGER ${EVENT_SAVE_REPAIR_BARRIERS[0].name}`);
 if(fault==='receipt')f.sqlite.exec("UPDATE __forma_event_save_repair_receipts SET source_manifest='changed'");
 if(fault==='unknown-trigger')f.sqlite.exec('CREATE TRIGGER unexpected_memory_reader AFTER INSERT ON private_content BEGIN SELECT count(*) FROM memory_derivation_consumers; END');
 if(fault==='schema-race')f.sqlite.exec('CREATE TABLE changed_after_capture(id TEXT)');
 if(fault==='populated-race'){
  const barrier=EVENT_SAVE_REPAIR_BARRIERS.find(r=>r.tbl_name==='memory_derivation_qualifications');
  f.sqlite.exec(`DROP TRIGGER ${barrier.name}`);
  f.sqlite.exec("INSERT INTO memory_derivation_qualifications VALUES('test','"+'a'.repeat(64)+"','test','test','{}','"+'b'.repeat(64)+"','qualified','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z')");
  f.sqlite.exec(barrier.sql);
 }
 if(fault==='database-change'){
  const original=f.db.batch;f.db.batch=async ss=>{const result=await original(ss);env.DB={...f.db};return result;};
  await assert.rejects(preparePrivateContent(env,'ordinary-owner','provider-output','checkpoint'),/database_changed/);return;
 }
 const rows=await f.db.prepare(`SELECT content FROM private_content WHERE content_id=? AND ${guard.sql}`).bind(output.contentId,...guard.bindings).all();
 assert.equal(rows.results.length,0,'stale witness must not authorize content');
 if(fault!=='schema-race')await assert.rejects(loadPrivateContent(env,'ordinary-owner'),/memory_boundary_schema_unavailable/);
});


for (const runtime of ['source','production bundle']) test(`${runtime}: isolated schema delivers one mocked Still generation through readiness, admission, checkpoints, settlement and authorized reload`,async t=>{
 const f=await fixture(t);await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 const {default:worker}=runtime==='source'?await import('../worker/index.ts'):await import('../dist/server/index.js');const media=new Map(),background=[];
 const env={DB:f.db,OPENAI_API_KEY:'offline-sentinel',OPENAI_MODEL:'gpt-5.6-terra',ASSETS:{fetch:async()=>new Response(null,{status:404})},MEDIA:{put:async(key,bytes)=>media.set(key,bytes),get:async()=>null}};
 const request=(path,body)=>worker.fetch(new Request('http://localhost'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil:p=>background.push(p)});
 const original=globalThis.fetch;let planner=0,image=0;
 globalThis.fetch=async(url)=>{
  if(String(url).endsWith('/moderations'))return Response.json({id:'offline-moderation',model:'omni-moderation-latest',results:[{flagged:false,categories:{},category_scores:{}}]});
  if(String(url).endsWith('/responses')){planner++;return Response.json({id:'offline-direction',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Synthetic harbor',rationale:'Preserve the brief',scene:'A quiet harbor',palette:['blue','white','gray'],next_moves:['View result']}),usage:{input_tokens:100,output_tokens:100,total_tokens:200}});}
  assert.equal(String(url),'https://api.openai.com/v1/images/generations');image++;return new Response('data: '+JSON.stringify({type:'image_generation.completed',b64_json:Buffer.from('offline-image-bytes').toString('base64'),size:'1536x1024',output_format:'png',usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{text_tokens:100,image_tokens:0}}})+'\n\n',{headers:{'content-type':'text/event-stream','x-request-id':'offline-image'}});
 };t.after(()=>{globalThis.fetch=original;});
 const session=await (await request('/api/session')).json();f.sqlite.prepare('UPDATE users SET consent_version=?').run('pilot-2026-08-10');
 assert.equal((await request('/api/events?after=0&limit=2000&content=0')).status,200);while(background.length)await Promise.all(background.splice(0));
 const readiness=await request('/api/document-jobs/still-readiness?documentId=doc-atmosphere');
 assert.equal(readiness.status,200);assert.equal((await readiness.json()).ready,true,'the deployed Worker must qualify the isolated storage boundary');
 assert.equal(planner,0);assert.equal(image,0,'readiness must not call a provider');
 const previousId=crypto.randomUUID(),previousTime=new Date().toISOString(),previousExpiry=new Date(Date.now()+86400000).toISOString();
 f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,requested_at,completed_at,expires_at,updated_at) VALUES(?,?,?,'doc-atmosphere','generate','failed','still',?,1,?,'{}',?,?,?,?)`).run(previousId,session.user.userId,'creative:'+session.user.userId,previousId,JSON.stringify({documentRevision:'original-recorded-revision'}),previousTime,previousTime,previousExpiry,previousTime);
 const admitted=await request('/api/document-jobs',{kind:'generate',documentId:'doc-atmosphere',sourceSurface:'still',payload:{requestKey:'still:doc-atmosphere:1:offline-proof',previousAttemptId:previousId,paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true}});
 assert.equal(admitted.status,202,await admitted.clone().text());const {job}=await admitted.json();
 const response=await request(`/api/document-jobs/${job.jobId}/run`,{});assert.equal(response.status,200,await response.clone().text());const result=(await response.json()).job;
 assert.equal(result.status,'completed',JSON.stringify(result.errorDetail));assert.equal(result.result.previousAttemptId,previousId);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(previousId).status,'failed');assert.equal(planner,1);assert.equal(image,1);assert.equal(media.size,1);
 assert.ok(result.result.generationReceipt.settled_cost_microusd>0);assert.equal(result.result.generationReceipt.reservation_status,'settled');
 const retained=await loadPrivateContent(env,session.user.userId);assert.ok(Object.keys(retained).length>0);assert.ok(Object.values(retained).some(value=>value.includes('Synthetic harbor')));
 const detail=await request(`/api/document-jobs/${job.jobId}?inspection=1`);assert.equal((await detail.json()).job.status,'completed');
 await request(`/api/document-jobs/${job.jobId}/run`,{});assert.equal(planner,1);assert.equal(image,1);
 // Original evidence inspection is an independently authenticated observation,
 // including in the exact Worker bundle shipped to production.
 const requested=f.sqlite.prepare("SELECT sequence FROM events WHERE correlation_id=(SELECT correlation_id FROM document_jobs WHERE job_id=?) AND type='GenerationRequested'").get(job.jobId);
 const evidencePath=`/api/generation-evidence?documentId=doc-atmosphere&requestedSequence=${requested.sequence}`;
 const hostedHeaders={'oai-authenticated-user-id':session.user.userId,'oai-authenticated-user-email':session.user.email};
 const inspect=(path=evidencePath,headers=hostedHeaders,method='GET')=>worker.fetch(new Request('https://forma.test'+path,{headers,method}),env,{waitUntil:()=>assert.fail('inspection scheduled background work')});
 const beforeChanges=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
 const evidenceResponse=await inspect();assert.equal(evidenceResponse.status,200,await evidenceResponse.clone().text());
 const evidence=await evidenceResponse.json();assert.equal(evidence.custody.jobExpiresAt,f.sqlite.prepare('SELECT expires_at FROM document_jobs WHERE job_id=?').get(job.jobId).expires_at);assert.equal(evidence.job.job_id,job.jobId);
 assert.ok(evidence.records.some(record=>record.content.includes('Synthetic harbor')));
 assert.ok(evidence.records.some(record=>record.content.includes('requestBody')));
 assert.equal(evidence.unavailable.length,0);assert.equal(evidenceResponse.headers.get('cache-control'),'private, no-store');
 assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,beforeChanges,'inspection must issue no writes');
 const html=await inspect(evidencePath.replace('/api/','/'));assert.equal(html.status,200);assert.match(await html.text(),/id="evidence"/);
 assert.equal((await inspect(evidencePath,{})).status,401);
 assert.equal((await inspect(evidencePath,{...hostedHeaders,'oai-authenticated-user-id':'another-owner'})).status,404);
 assert.equal((await inspect(evidencePath,{...hostedHeaders,cookie:'forma_project_context=selected'})).status,404);
 assert.equal((await inspect(evidencePath,hostedHeaders,'POST')).status,405);
 assert.equal((await inspect(evidencePath+'&contentId=unrelated')).status,400);
 const originalJob=f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(job.jobId);
 for(const fault of ['expired-job','memory','durable']){
   if(fault==='expired-job')f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01' WHERE job_id=?").run(job.jobId);
   else f.sqlite.prepare('UPDATE document_jobs SET request_json=? WHERE job_id=?').run(JSON.stringify({...JSON.parse(originalJob.request_json),[fault==='memory'?'memoryMode':'outputDurable']:true}),job.jobId);
   assert.equal((await inspect()).status,404,fault);
   f.sqlite.prepare('UPDATE document_jobs SET request_json=?,expires_at=? WHERE job_id=?').run(originalJob.request_json,originalJob.expires_at,job.jobId);
 }
 const retainedRecord=evidence.records[0];
 f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01' WHERE content_id=?").run(retainedRecord.content_id);
 const expired=await (await inspect()).json();assert.ok(expired.unavailable.some(row=>row.contentId===retainedRecord.content_id));assert.ok(!expired.records.some(row=>row.content_id===retainedRecord.content_id));
 f.sqlite.prepare('UPDATE private_content SET expires_at=?,redacted_at=? WHERE content_id=?').run(retainedRecord.expires_at,new Date().toISOString(),retainedRecord.content_id);
 assert.ok((await (await inspect()).json()).unavailable.some(row=>row.contentId===retainedRecord.content_id));
 f.sqlite.prepare('UPDATE private_content SET redacted_at=NULL WHERE content_id=?').run(retainedRecord.content_id);
 f.sqlite.prepare('UPDATE private_content SET owner_id=? WHERE content_id=?').run('different-owner',retainedRecord.content_id);
 assert.ok((await (await inspect()).json()).unavailable.some(row=>row.contentId===retainedRecord.content_id));
 f.sqlite.prepare('UPDATE private_content SET owner_id=? WHERE content_id=?').run(session.user.userId,retainedRecord.content_id);
 const scope=(kind,id)=>f.sqlite.prepare("INSERT INTO project_resource_scopes(project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,visibility,created_at) VALUES('fixture-scope',?,?,'fixture-org','fixture-project',?,?,'actor_private',?)").run(kind,id,session.user.userId,session.user.userId,new Date().toISOString());
 scope('content',retainedRecord.content_id);
 assert.ok((await (await inspect()).json()).unavailable.some(row=>row.contentId===retainedRecord.content_id));
 scope('job',job.jobId);assert.equal((await inspect()).status,404,'personal reader refuses shared jobs');
 f.sqlite.prepare("DELETE FROM project_resource_scopes WHERE project_access_id='fixture-scope'").run();
 // Requalification must refuse a catalog whose isolation witness was changed.
 f.sqlite.exec(`DROP TRIGGER ${EVENT_SAVE_REPAIR_BARRIERS[0].name}`);
 assert.equal((await inspect()).status,503);
 assert.equal(planner,1);assert.equal(image,1,'inspection must make no provider call');
 for(const table of EVENT_SAVE_REPAIR_TABLES)assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
});

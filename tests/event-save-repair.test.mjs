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


// Synthetic native approval custody, not a live approval or a mocked verifier.
// This exercises the reader's entire approved-context-proposal producer chain.
async function approvedSourceFixture(f,env,owner){
 const {consentHash}=await import('../worker/consequential-consent.ts');
 const stream='creative:'+owner,now=new Date().toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString();
 const previewId=crypto.randomUUID(),executionId=crypto.randomUUID(),consentId=crypto.randomUUID(),outputId=crypto.randomUUID();
 const blockId='approved-source-proof',proposalId='proposal-proof',sourceHash='synthetic-native-source-hash';
 const binding={actorUserId:owner,streamId:stream,projectId:'project-atmosphere',documentId:'doc-atmosphere',blockId:'block-direction',canvasId:null,scope:null,sourceHash,request:{}};
 const bindingHash=await consentHash(binding),research={id:proposalId,text:'Keep the harbor quiet.',authority:'learned'},edit={text:'Keep the harbor quiet.'};
 const learned={id:'learned-proof',text:'Keep the approved local palette.',authority:'learned'},learnedEdit={text:learned.text};
 const payload={project_id:'project-atmosphere',document_id:'doc-atmosphere',block_id:blockId,scope:'document',type:'direction',position:'a3',properties:{text:edit.text,authority:'authored',weight:1,created_from:'approved-context-proposal',context_detail:true,source_execution_id:executionId,source_proposal_id:proposalId}};
 const learnedPayload={...payload,block_id:'approved-learned-proof',position:'a4',properties:{...payload.properties,text:learnedEdit.text,source_proposal_id:learned.id}};
 const plan={operation:'context-proposal',binding,result:{blockIds:[blockId,learnedPayload.block_id]},events:[{type:'BlockCreated',payload},{type:'BlockCreated',payload:learnedPayload}],review:{selections:[{executionId,proposalId,bindingHash,edit},{executionId,proposalId:learned.id,bindingHash,edit:learnedEdit}],proposals:[{executionId,proposalId,edit,research},{executionId,proposalId:learned.id,edit:learnedEdit,research:learned}]},expiresAt};
 const approvalHash=await consentHash(plan);
 const put=(id,kind,content)=>f.sqlite.prepare('INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)').run(id,owner,kind,JSON.stringify(content),now,expiresAt);
 put(previewId,'authoring-preview',{state:'applied',approvalHash,plan});
 put(consentId,'execution-consent',{binding,preview:{executionId}});
 put(outputId,'context-proposal',{report:{inferred:[],related:[],learned:[research,learned]}});
 f.sqlite.prepare("INSERT INTO consequential_executions(execution_id,actor_user_id,stream_id,project_id,document_id,operation,intent_hash,binding_hash,consent_ref,result_ref,status,created_at,expires_at,updated_at) VALUES(?,?,?,'project-atmosphere','doc-atmosphere','context-research','synthetic-intent',?,?,?,'completed',?,?,?)").run(executionId,owner,stream,bindingHash,consentId,outputId,now,expiresAt,now);
 const head=f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events WHERE stream_id=?').get(stream).head;
 const events=plan.events.map((item,i)=>makeEvent(stream,head+i+1,'user:'+owner,'web:context-approval','authoring:'+owner+':'+previewId,item.type,item.payload));
 for(const event of events){const values=eventWriteBindings(event);await env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();}
 const event=events.at(-1);
 f.sqlite.prepare("INSERT INTO authoring_commits(preview_id,actor_user_id,operation,project_id,document_id,block_id,approval_hash,result_json,last_event_id,verified,created_at) VALUES(?,?,'context-proposal','project-atmosphere','doc-atmosphere','block-direction',?,?,?,1,?)").run(previewId,owner,approvalHash,JSON.stringify(plan.result),event.eventId,now);
 return {previewId,executionId,consentId,outputId,approvalHash,expiresAt,plan,binding,bindingHash,event};
}


for (const runtime of ['source','production bundle']) for (const scopeCase of ['complete','scope observation','historical proof','historical missing project identity','historical recreated','historical rehomed','historical attached','historical census truncation']) test(`${runtime}: isolated schema delivers ${scopeCase} through one mocked Still generation`,async t=>{
 const historicalCase=scopeCase.startsWith('historical ');
 const f=await fixture(t);await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 const {default:worker}=runtime==='source'?await import('../worker/index.ts'):await import('../dist/server/index.js');const media=new Map(),background=[];
 const env={DB:f.db,OPENAI_API_KEY:'offline-sentinel',OPENAI_MODEL:'gpt-5.6-terra',ASSETS:{fetch:async()=>new Response(null,{status:404})},MEDIA:{put:async(key,bytes)=>media.set(key,bytes),get:async()=>null}};
 const request=(path,body)=>worker.fetch(new Request('http://localhost'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil:p=>background.push(p)});
 const original=globalThis.fetch;let planner=0,image=0,providerCalls=0;
 globalThis.fetch=async(url)=>{
  providerCalls++;
  if(String(url).endsWith('/moderations'))return Response.json({id:'offline-moderation',model:'omni-moderation-latest',results:[{flagged:false,categories:{},category_scores:{}}]});
  if(String(url).endsWith('/responses')){planner++;return Response.json({id:'offline-direction',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Synthetic harbor',rationale:'Preserve the brief',scene:'A quiet harbor',palette:['blue','white','gray'],next_moves:['View result']}),usage:{input_tokens:100,output_tokens:100,total_tokens:200}});}
  assert.equal(String(url),'https://api.openai.com/v1/images/generations');image++;return new Response('data: '+JSON.stringify({type:'image_generation.completed',b64_json:Buffer.from('offline-image-bytes').toString('base64'),size:'1536x1024',output_format:'png',usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{text_tokens:100,image_tokens:0}}})+'\n\n',{headers:{'content-type':'text/event-stream','x-request-id':'offline-image'}});
 };t.after(()=>{globalThis.fetch=original;});
 const session=await (await request('/api/session')).json();f.sqlite.prepare('UPDATE users SET consent_version=?').run('pilot-2026-08-10');
 // The historical-proof fixture requires authentic origin envelopes. Enrich
 // the synthetic bootstrap before the real writer and staging trigger persist it.
 const seedPrepare=f.db.prepare;
 if(historicalCase)f.db.prepare=sql=>{
   const statement=seedPrepare(sql);if(!/^INSERT INTO event_write_stage\s*\(/u.test(sql))return statement;
   const bind=statement.bind.bind(statement);statement.bind=(...a)=>{
     if(['BlockCreated','ExtractionCompleted','ReferenceIngested','DocumentCreated'].includes(a[11]) || scopeCase==='historical missing project identity' && a[11]==='ProjectCreated'){
       const e={eventId:a[0],streamId:a[1],sequence:a[2],occurredAt:a[3],recordedAt:a[4],actor:a[5],clientId:a[6],correlationId:a[7],causationId:a[8],compensatesEventId:a[9],schemaVersion:a[10],type:a[11],payload:{...JSON.parse(a[16]),project_id:'project-atmosphere',document_id:'doc-atmosphere'}};
       if(a[11]==='ProjectCreated'){e.payload=JSON.parse(a[16]);delete e.payload.project_id;}
       a=eventWriteBindings(e);
     }
     return bind(...a);
   };return statement;
 };
 assert.equal((await request('/api/events?after=0&limit=2000&content=0')).status,200);while(background.length)await Promise.all(background.splice(0));
 f.db.prepare=seedPrepare;
 // The demo bootstrap predates strict source custody. Give the synthetic seed
 // its explicit document/project identity before this test generates anything.
 if(!historicalCase)for(const row of f.sqlite.prepare("SELECT private_event_id,private_json FROM event_private_payloads WHERE owner_id=? AND private_event_id IN(SELECT event_id FROM events WHERE type IN('BlockCreated','ExtractionCompleted','ReferenceIngested','DocumentCreated'))").all(session.user.userId)){
   f.sqlite.prepare("UPDATE event_private_payloads SET document_id='doc-atmosphere',project_id='project-atmosphere',private_json=? WHERE private_event_id=?").run(JSON.stringify({...JSON.parse(row.private_json),document_id:'doc-atmosphere',project_id:'project-atmosphere'}),row.private_event_id);
 }
 const approval=await approvedSourceFixture(f,env,session.user.userId);
 const opened=makeEvent('creative:'+session.user.userId,f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events').get().head+1,'user:'+session.user.userId,'offline','source-diagnostic','DocumentOpened',{project_id:'project-atmosphere',document_id:'doc-atmosphere'});
 const openedValues=eventWriteBindings(opened);await env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${openedValues.map(()=>'?').join(',')})`).bind(...openedValues).run();
 if(['historical recreated','historical rehomed','historical attached'].includes(scopeCase)){
   const block=f.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated') AND json_extract(private_json,'$.block_id')='block-direction'").get();
   const scoped={block_id:'block-direction',document_id:'doc-atmosphere',project_id:'project-atmosphere',scope:'document'};
   const transitions=scopeCase==='historical recreated'?[['BlockCreated',JSON.parse(block.private_json)]]
     :scopeCase==='historical rehomed'?[['BlockRehomed',{...scoped,project_id:'foreign-project',document_id:'foreign-document'}],['BlockRehomed',scoped]]
     :[['BlockDocumentDetached',scoped],['BlockDocumentAttached',scoped]];
   for(const [type,payload] of transitions){const event=makeEvent('creative:'+session.user.userId,f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events').get().head+1,'user:'+session.user.userId,'offline','historical-refusal',type,payload);const values=eventWriteBindings(event);await env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();}
 }
 const historicalFixtures=[];
 if(historicalCase)for(const [type,payload] of [
   ['ProjectCreated',{project_id:'unrelated-project',name:'Unused A'}],
   ...Array.from({length:6},(_,i)=>['ProjectCreated',{project_id:'census-fixture-'+i,name:'Census private sentinel'}]),
   ['BlockPropertyEdited',{block_id:'block-direction',property_path:'proof_fixture',new_value:'Private original fixture'}],
   ['DocumentRenamed',{document_id:'doc-atmosphere',new_title:'First original rename'}],
   ['DocumentRenamed',{document_id:'doc-atmosphere',new_title:'Second original rename'}],
 ]){
   const event=makeEvent('creative:'+session.user.userId,f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events').get().head+1,'user:'+session.user.userId,'offline','historical-proof',type,payload);
   const values=eventWriteBindings(event);await env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();if(type!=='ProjectCreated')historicalFixtures.push(event);
 }
 const scopeFixtures=[];
 if(scopeCase==='scope observation'){
   const definitions=[
     // Recreated and rehomed subjects must not gain membership from today's fold.
     ['BlockCreated',{project_id:'project-atmosphere',document_id:'doc-atmosphere',block_id:'recreated-subject',type:'direction',scope:'document',properties:{text:'Earlier subject'}},null],
     ['BlockCreated',{project_id:'project-atmosphere',document_id:'doc-atmosphere',block_id:'recreated-subject',type:'direction',scope:'document',properties:{text:'Recreated subject'}},null],
     ['BlockRehomed',{project_id:'different-private-project',document_id:'foreign-document',block_id:'recreated-subject',scope:'document'},'explicit_conflicting_scope'],
     ['BlockRehomed',{project_id:'project-atmosphere',document_id:'doc-atmosphere',block_id:'recreated-subject',scope:'document'},null],
     ['BlockDocumentDetached',{project_id:'project-atmosphere',document_id:'doc-atmosphere',block_id:'recreated-subject'},null],
     ['BlockDocumentAttached',{project_id:'project-atmosphere',document_id:'doc-atmosphere',block_id:'recreated-subject'},null],
     ['BlockPropertyEdited',{block_id:'recreated-subject',property_path:'text',new_value:'Current subject text'},'absent_scope_metadata'],
     ['BlockPropertyEdited',{block_id:'block-direction',property_path:'scope_fixture',new_value:'Private diagnostic sentinel'},'absent_scope_metadata'],
     ['DocumentRenamed',{document_id:'doc-atmosphere',new_title:'Omitted project'},'absent_scope_metadata'],
     ['DocumentRenamed',{document_id:'doc-atmosphere',project_id:'different-private-project',new_title:'Conflicting project'},'explicit_conflicting_scope'],
     ['DocumentRenamed',{document_id:'doc-atmosphere',project_id:null,new_title:'Null project'},'absent_scope_metadata'],
     ['DocumentRenamed',{document_id:'doc-atmosphere',project_id:'',new_title:'Empty project'},'unresolved_scope'],
     ['DocumentOpened',{document_id:'doc-atmosphere'},'unresolved_scope'],
   ];
   for(const [type,payload,classification] of definitions){
     const event=makeEvent('creative:'+session.user.userId,f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events').get().head+1,'user:'+session.user.userId,'offline','scope-observation',type,payload);
     const values=eventWriteBindings(event);await env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();
     if(classification)scopeFixtures.push({event,classification});
   }
 }
 if(scopeCase==='historical census truncation'){
   // Real producer/staging writes exceed the diagnostic cap while staying
   // inside the existing full-history row/byte limits. No post-boundary rows
   // are relabeled as historical inputs.
   const statement=f.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${Array(17).fill('?').join(',')})`);
   const head=f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events').get().head;
   f.sqlite.exec('BEGIN');try{for(let i=1;i<=40001;i++)statement.run(...eventWriteBindings(makeEvent('creative:'+session.user.userId,head+i,'user:'+session.user.userId,'offline','bounded-census','ProjectOpened',{project_id:'unrelated-project'})));f.sqlite.exec('COMMIT');}catch(error){f.sqlite.exec('ROLLBACK');throw error;}
 }
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
 const sourcePath=evidencePath+'&includeSource=1';
 f.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(session.user.userId);
 if(scopeCase==='historical census truncation')f.sqlite.prepare("DELETE FROM event_private_payloads WHERE json_extract(private_json,'$.project_id')='census-fixture-0'").run();
 const sourceBeforeChanges=f.sqlite.prepare('SELECT total_changes() AS n').get().n;


 if(scopeCase==='historical census truncation'){
   const providerBefore=providerCalls,response=await inspect(sourcePath),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));
   assert.equal(body.error,'generation_source_original_events_unavailable');const c=body.diagnostic.historicalCensus;
   assert.equal(c.examined,40000);assert.ok(c.total>40000);assert.equal(c.truncated,true);assert.equal(c.complete,false);assert.equal(c.unexamined,c.total-40000);assert.deepEqual(c.firstFailureCounts,{private_absent:1});
   assert.equal(c.checks.private_presence.notEvaluated,c.unexamined);assert.equal(c.checks.envelope_objects.notEvaluated,c.unexamined+1);
   assert.equal(body.records,undefined);assert.equal(body.sourceEvidence,undefined);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,sourceBeforeChanges);assert.equal(providerCalls,providerBefore);return;
 }
 if(historicalCase&&scopeCase!=='historical proof'){
   const providerBefore=providerCalls,response=await inspect(sourcePath),body=await response.json();assert.equal(response.status,409);assert.equal(body.error,'generation_source_original_events_unavailable');
   const rejected=body.diagnostic.scopeObservations.find(o=>o.eventId===historicalFixtures.find(e=>e.type==='BlockPropertyEdited').eventId);
   assert.equal(rejected.membershipProven,false);assert.equal(rejected.historicalProof.reason,scopeCase==='historical missing project identity'?'historical_origin_scope_unproven':scopeCase==='historical recreated'?'historical_origin_missing_or_recreated':'historical_subject_transition_unsupported');
   if(scopeCase==='historical missing project identity'){
     const origin=f.sqlite.prepare("SELECT e.payload,p.private_json,p.project_id FROM events e JOIN event_private_payloads p ON p.private_event_id=e.event_id WHERE e.type='ProjectCreated' ORDER BY e.sequence LIMIT 1").get();
     assert.equal(origin.project_id,null);assert.equal(Object.hasOwn(JSON.parse(origin.private_json),'project_id'),false);assert.equal(Object.hasOwn(JSON.parse(origin.payload),'project_id'),false);
     for(const event of historicalFixtures){const observation=body.diagnostic.scopeObservations.find(o=>o.eventId===event.eventId);assert.equal(observation.classification,'absent_scope_metadata');assert.equal(observation.membershipProven,false);assert.equal(observation.historicalProof.reason,'historical_origin_scope_unproven');}
   }
   assert.equal(body.sourceEvidence,undefined);assert.equal(body.records,undefined);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,sourceBeforeChanges);assert.equal(providerCalls,providerBefore);
   return;
 }
 if(scopeCase==='scope observation'){
   const beforeProvider=providerCalls;
   const observe=async()=>{
     const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
     const response=await inspect(sourcePath),raw=await response.text();assert.equal(response.status,409,raw);
     const body=JSON.parse(raw);assert.equal(body.error,'generation_source_original_events_unavailable');
     assert.equal(body.diagnostic.eligibility.eligibleForReview,false);assert.equal(body.records,undefined);assert.equal(body.sourceEvidence,undefined);
     assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(providerCalls,beforeProvider);
     assert.ok(!raw.includes('different-private-project'));assert.ok(!raw.includes('Private diagnostic sentinel'));
     return body.diagnostic;
   };
   const diagnostic=await observe();assert.equal(diagnostic.requiredEventCount-diagnostic.availableEventCount,scopeFixtures.length);
   for(const {event,classification} of scopeFixtures){
     const observation=diagnostic.scopeObservations.find(o=>o.eventId===event.eventId);
     assert.equal(observation.classification,classification);assert.equal(observation.membershipProven,false);
     assert.equal(observation.eventIdentityMatches,true);assert.equal(observation.privateBodyMatchesHistory,true);assert.equal(observation.envelope.writerCompatible,true);
     assert.equal(observation.envelope.producerAttribution,'not_established');
   }
   assert.equal(diagnostic.scopeObservations.find(o=>o.eventId===scopeFixtures.find(f=>f.event.type==='BlockPropertyEdited').event.eventId).scopes.document.payload,'missing');
   const event=scopeFixtures.find(f=>f.event.type==='DocumentRenamed').event,originalRow=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(event.eventId);
   // Preserve folded content and metadata while breaking the public envelope.
   f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify({...event.payload,source_surface:'different'}),event.eventId);
   try{assert.equal((await observe()).scopeObservations.find(o=>o.eventId===event.eventId).classification,'inconsistent_producer_envelope');}
   finally{f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(originalRow.private_json,event.eventId);}
   for(const fault of ['claimed-scope','wrong-owner','redacted']){
     if(fault==='claimed-scope')f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify({...event.payload,project_id:'project-atmosphere'}),event.eventId);
     if(fault==='wrong-owner')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign-owner' WHERE private_event_id=?").run(event.eventId);
     if(fault==='redacted')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(event.eventId);
     try{
       const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
       const response=await inspect(sourcePath),body=await response.json();assert.equal(response.status,409);assert.equal(body.diagnostic,undefined);
       assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(providerCalls,beforeProvider);
     }finally{f.sqlite.prepare('UPDATE event_private_payloads SET private_json=?,owner_id=?,redacted_at=? WHERE private_event_id=?').run(originalRow.private_json,originalRow.owner_id,originalRow.redacted_at,event.eventId);}
   }
   // Recheck observation, authority, retention and configuration after capture.
   for(const race of ['scope','authority','expiry','configuration']){
     const originalPrepare=f.db.prepare,jobExpiry=f.sqlite.prepare('SELECT expires_at FROM document_jobs WHERE job_id=?').get(job.jobId).expires_at,model=env.OPENAI_MODEL;
     let reads=0,injectedChanges=0,injected=false;
     f.db.prepare=sql=>{
       const statement=originalPrepare(sql);if(!sql.startsWith('WITH expected(document_id'))return statement;
       const bind=statement.bind.bind(statement);statement.bind=(...args)=>{
         const bound=bind(...args),first=bound.first.bind(bound);bound.first=async()=>{
           if(++reads===scopeFixtures.length+1){
             const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;injected=true;
             if(race==='scope')f.sqlite.prepare("UPDATE event_private_payloads SET project_id='raced' WHERE private_event_id=?").run(event.eventId);
             if(race==='authority')f.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(session.user.userId);
             if(race==='expiry')f.sqlite.prepare("UPDATE document_jobs SET expires_at='2000-01-01' WHERE job_id=?").run(job.jobId);
             if(race==='configuration')env.OPENAI_MODEL='changed-after-capture';
             injectedChanges=f.sqlite.prepare('SELECT total_changes() AS n').get().n-before;
           }
           return first();
         };return bound;
       };return statement;
     };
     try{
       const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
       const response=await inspect(sourcePath),body=await response.json();assert.ok([404,409].includes(response.status),JSON.stringify(body));assert.equal(body.diagnostic,undefined);assert.equal(injected,true);
       if(race==='scope')assert.equal(body.error,'generation_source_producer_changed');
       assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before+injectedChanges);assert.equal(providerCalls,beforeProvider);
     }finally{
       f.db.prepare=originalPrepare;env.OPENAI_MODEL=model;
       f.sqlite.prepare('UPDATE event_private_payloads SET project_id=? WHERE private_event_id=?').run(originalRow.project_id,event.eventId);
       f.sqlite.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(session.user.userId);
       f.sqlite.prepare('UPDATE document_jobs SET expires_at=? WHERE job_id=?').run(jobExpiry,job.jobId);
     }
   }
   return;
 }
 const sourceResponse=await inspect(sourcePath);assert.equal(sourceResponse.status,200,await sourceResponse.clone().text());
 const sourceResult=await sourceResponse.json();
 assert.equal(sourceResult.sourceEvidence.status,'complete');
 if(scopeCase==='historical proof'){
   assert.equal(sourceResult.sourceEvidence.historical.historicalScopeProofs.length,3);
   for(const event of historicalFixtures){
     const proof=sourceResult.sourceEvidence.historical.historicalScopeProofs.find(p=>p.eventId===event.eventId);assert.equal(proof.eventSequence,event.sequence);assert.equal(proof.throughSequenceExclusive,requested.sequence);
     const retained=sourceResult.sourceEvidence.historical.sourceEvents.find(e=>e.event_id===event.eventId);assert.equal(retained.private_project,null);assert.deepEqual(JSON.parse(retained.private_json),event.payload,'scope must not be backfilled into evidence');
   }
 }
 assert.equal(sourceResult.sourceEvidence.historical.producerChains.length,1);
 assert.equal(sourceResult.sourceEvidence.historical.producerChains[0].receipt.preview_id,approval.previewId);
 assert.equal(sourceResult.sourceEvidence.historical.producerChains[0].executions[0].execution.execution_id,approval.executionId);
 assert.equal(sourceResult.sourceEvidence.authority,'current-personal-administrator');
 assert.equal(sourceResult.sourceEvidence.current.matchesHistorical,true);
 assert.equal(sourceResult.sourceEvidence.eligibility.humanReviewed,false);
 assert.equal(sourceResult.sourceEvidence.eligibility.executionAuthorized,false);
 assert.equal(sourceResult.sourceEvidence.configuration.originalAccountBinding,null);
 assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,sourceBeforeChanges,'complete source inspection must issue no writes');
 if(scopeCase==='historical proof'){
   // An unrelated origin changes without a new sequence or byte-count change.
   // It is outside the selected producer list but inside the absence census.
   const unrelated=f.sqlite.prepare("SELECT private_event_id,private_json FROM event_private_payloads WHERE json_extract(private_json,'$.project_id')='unrelated-project'").get();
   const censusRows=f.sqlite.prepare("SELECT * FROM event_private_payloads WHERE json_extract(private_json,'$.project_id') LIKE 'census-fixture-%' ORDER BY project_id").all();
   const restoreCensus=()=>{for(const r of censusRows){const keys=Object.keys(r);f.sqlite.prepare(`INSERT OR REPLACE INTO event_private_payloads(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>r[k]));}};
   const corruptCensus=()=>{
     f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(censusRows[0].private_event_id);
     f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01',owner_id='foreign',private_json='{' WHERE private_event_id=?").run(censusRows[1].private_event_id);
     f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='',private_json='{' WHERE private_event_id=?").run(censusRows[2].private_event_id);
     f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='bad owner',private_json='{' WHERE private_event_id=?").run(censusRows[3].private_event_id);
     f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign',private_json='{' WHERE private_event_id=?").run(censusRows[4].private_event_id);
     f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{' WHERE private_event_id=?").run(censusRows[5].private_event_id);
   };
   for(const race of ['none','metadata','history']){
     corruptCensus();const originalPrepare=f.db.prepare;let metadataReads=0,changed=false,injectedWrites=0;
     f.db.prepare=sql=>{
       const statement=originalPrepare(sql),bind=statement.bind.bind(statement);
       statement.bind=(...args)=>{
         const bound=bind(...args);
         if(sql.includes('SELECT events.*,secret.private_event_id')){const all=bound.all.bind(bound);bound.all=async()=>{const r=await all();for(const row of r.results.filter(r=>censusRows.some(c=>c.private_event_id===r.event_id)))assert.equal(row.private_json,null,'foreign/redacted/malformed private bodies must not cross the DB boundary');return r;};}
         if(sql.startsWith('WITH selected AS')){const first=bound.first.bind(bound);bound.first=async()=>{
           if(++metadataReads===2&&race!=='none'){
             const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
             if(race==='metadata')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=NULL WHERE private_event_id=?").run(censusRows[1].private_event_id);
             else f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(unrelated.private_json.replace('Unused A','Unused B'),unrelated.private_event_id);
             injectedWrites=f.sqlite.prepare('SELECT total_changes() AS n').get().n-before;changed=true;
           }return first();};}
         return bound;
       };return statement;
     };
     try{
       const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n,providerBefore=providerCalls;
       const response=await inspect(sourcePath),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));
       if(race==='none'){
         assert.equal(body.error,'generation_source_original_events_unavailable');const c=body.diagnostic.historicalCensus;
         assert.deepEqual(c.firstFailureCounts,{private_absent:1,private_redacted:1,private_owner_missing:1,private_owner_invalid:1,private_owner_mismatch:1,private_json_malformed:1});
         assert.equal(c.complete,true);assert.equal(c.truncated,false);assert.equal(c.total,c.examined);assert.equal(c.unexamined,0);assert.equal(c.identityChecksPassed+6,c.total);
         assert.equal(c.checks.private_owner_valid.notEvaluated,2);assert.equal(c.checks.private_json_valid.notEvaluated,5);assert.equal(c.checks.envelope_objects.notEvaluated,6);
         for(const o of body.diagnostic.scopeObservations)assert.equal(o.membershipProven,false);
         assert.ok(!JSON.stringify(c).includes('census-fixture'));assert.ok(!JSON.stringify(c).includes('sentinel'));assert.ok(!JSON.stringify(c).includes(censusRows[0].private_event_id));
       }else{assert.equal(changed,true);assert.equal(body.error,race==='metadata'?'generation_source_producer_changed':'generation_source_historical_subject_changed');assert.equal(body.diagnostic,undefined);}
       assert.equal(body.sourceEvidence,undefined);assert.equal(body.records,undefined);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before+injectedWrites);assert.equal(providerCalls,providerBefore);
     }finally{f.db.prepare=originalPrepare;restoreCensus();f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(unrelated.private_json,unrelated.private_event_id);}
   }
   const prepare=f.db.prepare;let injected=false,injectedChanges=0;
   f.db.prepare=sql=>{
     const statement=prepare(sql);if(!sql.startsWith('SELECT * FROM authoring_commits'))return statement;
     const bind=statement.bind.bind(statement);statement.bind=(...args)=>{
       const bound=bind(...args),first=bound.first.bind(bound);bound.first=async()=>{
         if(!injected){injected=true;const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(unrelated.private_json.replace('Unused A','Unused B'),unrelated.private_event_id);injectedChanges=f.sqlite.prepare('SELECT total_changes() AS n').get().n-before;}
         return first();
       };return bound;
     };return statement;
   };
   try{
     const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n,providerBefore=providerCalls;
     const response=await inspect(sourcePath),body=await response.json();assert.equal(response.status,409);assert.equal(body.error,'generation_source_historical_subject_changed');assert.equal(body.sourceEvidence,undefined);assert.equal(injected,true);
     assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before+injectedChanges);assert.equal(providerCalls,providerBefore);
   }finally{f.db.prepare=prepare;f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(unrelated.private_json,unrelated.private_event_id);}
 }
 if(scopeCase==='complete'){
   const e=makeEvent('creative:'+session.user.userId,f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events').get().head+1,'user:'+session.user.userId,'offline','masked-custody','ProjectOpened',{project_id:'unrelated-project'});
   const values=eventWriteBindings(e);await env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();
   const saved=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(e.eventId);
   for(const owner of [session.user.userId,'foreign']){
     f.sqlite.prepare("UPDATE event_private_payloads SET owner_id=?,private_json='{' WHERE private_event_id=?").run(owner,e.eventId);
     const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n,providerBefore=providerCalls,response=await inspect(sourcePath),body=await response.json();
     assert.equal(response.status,409);assert.equal(body.error,'generation_source_historical_envelope_unavailable');assert.equal(body.sourceEvidence,undefined);assert.equal(body.records,undefined);assert.equal(providerCalls,providerBefore);assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before);
   }
   f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=?,private_json=? WHERE private_event_id=?').run(saved.owner_id,saved.private_json,e.eventId);
 }
 const inspectionProviderCalls=providerCalls;
 const expectSourceError=async(code)=>{
   const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
   const response=await inspect(sourcePath);assert.equal(response.status,409,await response.clone().text());
   assert.equal((await response.json()).error,code);
   assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before,'failed source inspection must issue no writes');
   assert.equal(providerCalls,inspectionProviderCalls,'source inspection must make no provider call');
 };
 const sourceFault=async(mutate,code)=>{
   const rows=['users','private_content','authoring_commits','consequential_executions','event_private_payloads','document_jobs'].flatMap(table=>f.sqlite.prepare(`SELECT rowid AS fixture_rowid,* FROM ${table}`).all().map(row=>({table,row})));
   try{mutate();await expectSourceError(code);}finally{
     for(const {table,row} of rows){const current=f.sqlite.prepare(`SELECT rowid AS fixture_rowid,* FROM ${table} WHERE rowid=?`).get(row.fixture_rowid);if(JSON.stringify(current)===JSON.stringify(row))continue;
       const keys=Object.keys(row).filter(key=>key!=='fixture_rowid');f.sqlite.prepare(`UPDATE ${table} SET ${keys.map(key=>key+'=?').join(',')} WHERE rowid=?`).run(...keys.map(key=>row[key]),row.fixture_rowid);
     }
   }
 };
 // Rejected sidecars disclose only failed predicate names after all normal
 // principal/job/source rechecks; no rejected body or actual identity is returned.
 {
   const originalRow=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(opened.eventId);
   // Fault injection: remove private scope while leaving the public claim intact.
   // This is an inconsistent envelope, not a real producer omission.
   const bodyBefore=JSON.parse(originalRow.private_json);delete bodyBefore.project_id;
   f.sqlite.prepare('UPDATE event_private_payloads SET project_id=NULL,private_json=? WHERE private_event_id=?').run(JSON.stringify(bodyBefore),opened.eventId);
   try{
     const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
     const response=await inspect(sourcePath),raw=await response.text();assert.equal(response.status,409,raw);
     const body=JSON.parse(raw);assert.equal(body.error,'generation_source_original_events_unavailable');
     assert.equal(body.diagnostic.status,'unavailable');assert.equal(body.diagnostic.eligibility.eligibleForReview,false);
     assert.deepEqual(body.diagnostic.eventChecks.filter(e=>e.eventId===opened.eventId),[{eventId:opened.eventId,eventType:'DocumentOpened',failedChecks:['private_project_matches']}]);
     assert.equal(body.diagnostic.scopeObservations.find(o=>o.eventId===opened.eventId).classification,'inconsistent_producer_envelope');
     assert.equal(body.diagnostic.requiredEventCount-body.diagnostic.availableEventCount,1+historicalFixtures.length);
     assert.equal(body.records,undefined);assert.equal(body.sourceEvidence,undefined);
     assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before);assert.equal(providerCalls,inspectionProviderCalls);
   }finally{f.sqlite.prepare('UPDATE event_private_payloads SET project_id=?,private_json=? WHERE private_event_id=?').run(originalRow.project_id,originalRow.private_json,opened.eventId);}
 }
 for(const value of ['0','true',''])assert.equal((await inspect(evidencePath+'&includeSource='+value)).status,400,'source inclusion requires literal 1');
 await sourceFault(()=>f.sqlite.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(session.user.userId),'generation_source_administrator_required');
 await sourceFault(()=>f.sqlite.prepare("UPDATE document_jobs SET request_json=json_set(request_json,'$.snapshot.facts[0].properties.rights_expires_at','2000-01-01T00:00:00.000Z') WHERE job_id=?").run(job.jobId),'generation_source_original_rights_expired');
 for(const id of [approval.previewId,approval.consentId,approval.outputId]){
   await sourceFault(()=>f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(id),'generation_source_producer_content_unavailable');
   await sourceFault(()=>f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=?').run(new Date().toISOString(),id),'generation_source_producer_content_unavailable');
 }
 await sourceFault(()=>f.sqlite.prepare("UPDATE authoring_commits SET approval_hash='changed' WHERE preview_id=?").run(approval.previewId),'generation_source_approval_binding_mismatch');
 await sourceFault(()=>f.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.report.learned[0].text','Changed learned result') WHERE content_id=?").run(approval.outputId),'generation_source_selected_proposal_mismatch');
 await sourceFault(()=>f.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.plan.review.selections[1].edit.text','Changed selection') WHERE content_id=?").run(approval.previewId),'generation_source_approval_binding_mismatch');
 await sourceFault(()=>f.sqlite.prepare("UPDATE consequential_executions SET binding_hash='changed' WHERE execution_id=?").run(approval.executionId),'generation_source_execution_binding_mismatch');
 await sourceFault(()=>f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.properties.text','Changed approved event') WHERE private_event_id=?").run(approval.event.eventId),'generation_source_original_history_mismatch');
 await sourceFault(()=>f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(JSON.stringify({oversized:'x'.repeat(2_200_001)}),approval.event.eventId),'generation_source_history_capacity_exceeded');

 // A retained approval can change without advancing the event head. Recheck
 // the private witness after its initial capture instead of trusting the hash.
 const originalPrepare=f.db.prepare,previewBefore=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(approval.previewId).content;
 const headBefore=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events').get().n;
 let receiptReads=0,injectedTamper=false;
 f.db.prepare=sql=>{
   const statement=originalPrepare(sql);if(!sql.startsWith('SELECT * FROM authoring_commits'))return statement;
   const bind=statement.bind.bind(statement);statement.bind=(...args)=>{
     const bound=bind(...args),first=bound.first.bind(bound);bound.first=async()=>{
       if(++receiptReads===2){f.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.state','changed-during-read') WHERE content_id=?").run(approval.previewId);injectedTamper=true;}
       return first();
     };return bound;
   };return statement;
 };
 try{
   const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
   const response=await inspect(sourcePath);assert.equal(response.status,409,await response.clone().text());
   assert.equal((await response.json()).error,'generation_source_producer_changed');assert.equal(injectedTamper,true);
   assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before+1,'only the injected concurrent writer may change data');
   assert.equal(f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events').get().n,headBefore);
 }finally{f.db.prepare=originalPrepare;f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(previewBefore,approval.previewId);}
 assert.equal(providerCalls,inspectionProviderCalls);
 // Preference history is disclosed as an explicit review-ineligibility reason.
 {
   const seq=f.sqlite.prepare('SELECT MAX(sequence) AS head FROM events WHERE stream_id=?').get('creative:'+session.user.userId).head+1;
   const preference=makeEvent('creative:'+session.user.userId,seq,'user:'+session.user.userId,'offline','preference-fixture','PreferenceAuthored',{preference_id:'source-preference',axis:'style',value:'No red logos',polarity:'forbid'});
   const values=eventWriteBindings(preference);await env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();
   const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
   const response=await inspect(sourcePath);assert.equal(response.status,200,await response.clone().text());const body=await response.json();
   assert.equal(body.sourceEvidence.current.preferenceCounts.authored,1);assert.equal(body.sourceEvidence.eligibility.eligibleForReview,false);
   assert.ok(body.sourceEvidence.eligibility.reasons.includes('preference_history_unsupported'));
   assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before);
 }
 assert.equal(providerCalls,inspectionProviderCalls);

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
 assert.equal(planner,1);assert.equal(image,1,'inspection must make no provider call');assert.equal(providerCalls,inspectionProviderCalls,'inspection must not add moderation or any other provider call');
 for(const table of EVENT_SAVE_REPAIR_TABLES)assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
});

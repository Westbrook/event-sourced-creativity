import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readLocalMigrations,migrateLocalDatabase} from '../scripts/lib/local-migrations.mjs';
import {registerOutputSourceImports} from './output-server-test-helpers.mjs';
const imports=registerOutputSourceImports();
const {ensureSchema}=await import('../worker/runtime.ts');
const {inspectEventSaveRepair,applyEventSaveRepair}=await import('../worker/event-save-repair.ts');
const {inspectMemorySchemaRepair,applyMemorySchemaRepair}=await import('../worker/memory-schema-repair.ts');
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
async function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());migrateLocalDatabase(sqlite,{migrations:migrations.slice(0,41)});
 const f={sqlite,...adapter(sqlite)};await ensureSchema({DB:f.db});
 await applyMemorySchemaRepair(f.db,(await inspectMemorySchemaRepair(f.db)).proof,authority);
 f.control.batches=0;
 return f;
}

const {foldEvents}=await import('../src/model/events.ts');
const {serializeEvent}=await import('../worker/event-read-primitives.ts');
const {buildContextApplicationPlan}=await import('../src/model/context-proposal-application.ts');
const {storeAuthoringPreview,commitAuthoringPlan}=await import('../worker/authoring-commits.ts');
const {requireExistingHoldAdministrator,storePrivateContent:putContent}=await import('../worker/pilot-policy.ts');
const {contextSourceHash}=await import('../worker/context-authoring-authority.ts');
const {consentHash}=await import('../worker/consequential-consent.ts');
async function currentFixture(t,runtime='source',options={}){
 const f=await fixture(t);await applyEventSaveRepair(f.db,(await inspectEventSaveRepair(f.db)).proof,authority);
 const {default:worker}=runtime==='source'?await import('../worker/index.ts'):await import('../dist/server/index.js');
 const env={DB:f.db,OPENAI_MODEL:'gpt-5.6-terra',ASSETS:{fetch:async()=>new Response(null,{status:404})},MEDIA:new Proxy({},{get:()=>()=>assert.fail('media read/write')})};
 const background=[];
 const session=await(await worker.fetch(new Request('http://localhost/api/session'),env,{waitUntil:p=>background.push(p)})).json();
 while(background.length)await Promise.all(background.splice(0));
 const owner=session.user.userId;f.sqlite.prepare("UPDATE users SET role='admin',consent_version='pilot-2026-08-10'").run();
 const hosted={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':session.user.email};
 const request=new Request('https://forma.test/api/generation-current-source?documentId=document',{headers:hosted});
 const {user}=await requireExistingHoldAdministrator(request,env);
 const append=async(type,payload,client='web:editor',correlation='current-fixture')=>{
  const head=f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events').get().head;
  const event=makeEvent('creative:'+owner,head+1,'user:'+owner,client,correlation,type,payload),values=eventWriteBindings(event);
  await env.DB.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values).run();return event;
 };
 await append('ProjectCreated',{...(options.missingProjectId?{}:{project_id:'project'}),name:'Private fixture project'});
 await append('DocumentCreated',{project_id:'project',document_id:'document',title:'Private current fixture'});
 await append('BlockCreated',{project_id:'project',document_id:'document',block_id:'direction',type:'direction',scope:'document',properties:{text:'Private harbor scene',authority:'authored'},position:'a1'});
 const sourceEvents=f.sqlite.prepare('SELECT * FROM events JOIN event_private_payloads ON event_id=private_event_id ORDER BY sequence').all().map(serializeEvent);
 const projection=foldEvents(sourceEvents,Infinity,'document','project');
 const now=new Date().toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString(),executionId=crypto.randomUUID();
 const binding={version:'fixture-v1',operation:'context-proposal',intentHash:'fixture-intent',actorUserId:owner,streamId:'creative:'+owner,projectId:'project',documentId:'document',blockId:'direction',canvasId:null,scope:null,contextSessionId:null,pilotCohortId:null,permissionEpoch:user.access.permissionEpoch,sourceHash:await contextSourceHash('project','document',projection.blocks.find(b=>b.id==='direction'),projection,sourceEvents),period:'fixture',steps:[],publicQuery:'',request:{}};
 const executionBinding={...binding,operation:'context-research'},bindingHash=await consentHash(executionBinding);
 const proposalId='proposal',research={id:proposalId,area:'learned',type:'direction',label:'Harbor light',text:'Keep the harbor quiet.',authority:'learned'},edit={label:'Approved harbor light'};
 const proposal={key:'selection',executionId,proposalId,research,edit};
 const built=buildContextApplicationPlan({projection,target:projection.blocks.find(b=>b.id==='direction'),proposals:[proposal]});
 const plan={operation:'context-proposal',binding,sourceHead:3,events:built.events,changes:built.changes,result:{blockIds:built.blockIds,relationCount:built.relationCount},review:{sourceText:'Private harbor scene',proposals:[proposal],selections:[{executionId,proposalId,bindingHash,edit}]},expiresAt};
 const consent=await putContent(env,owner,'execution-consent',JSON.stringify({binding:executionBinding,preview:{executionId,bindingHash}}));
 const output=await putContent(env,owner,'context-proposal',JSON.stringify({executionId,bindingHash,sourceHash:binding.sourceHash,report:{inferred:[],related:[],learned:[research]}}));
 f.sqlite.prepare("INSERT INTO consequential_executions(execution_id,actor_user_id,stream_id,project_id,document_id,operation,intent_hash,binding_hash,consent_ref,result_ref,status,created_at,expires_at,updated_at) VALUES(?,?,?,'project','document','context-research','fixture-intent',?,?,?,'completed',?,?,?)").run(executionId,owner,'creative:'+owner,bindingHash,consent.contentId,output.contentId,now,expiresAt,now);
 const preview=await storeAuthoringPreview(env,user,plan);await commitAuthoringPlan(env,user,binding,null,preview.previewId,preview.approvalHash,plan);
 const approved=plan.result.blockIds[0];
 const edited=await append('BlockPropertyEdited',{block_id:approved,property_path:'text',new_value:'Keep the approved harbor quiet. Later authored edit.'});
 const inspect=async(path='/api/generation-current-source?documentId=document',headers=hosted,method='GET')=>{
  const original=globalThis.fetch;globalThis.fetch=()=>assert.fail('provider call');
  const before=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
  const externalBefore=f.control.externalChanges??0;
  try {const response=await worker.fetch(new Request('https://forma.test'+path,{headers,method}),env,{waitUntil:()=>assert.fail('background write')});
   assert.equal(f.sqlite.prepare('SELECT total_changes() AS n').get().n,before+(f.control.externalChanges??0)-externalBefore,'observation writes');return response;
  }finally{globalThis.fetch=original;}
 };
 return {...f,worker,env,hosted,owner,append,inspect,approved,edited,preview,plan,output,consent,executionId};
}
for(const runtime of ['source','production bundle'])test(runtime+': current reader authentic writer without a generation job',async t=>{
 const f=await currentFixture(t,runtime);assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM document_jobs').get().n,0);
 const response=await f.inspect();const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
 assert.equal(body.schemaVersion,'forma-current-source-evidence-v1');assert.equal(body.approval.bindings.length,1);
 const source=JSON.parse(body.source.json),binding=body.approval.bindings[0];assert.equal(binding.propertiesJson,JSON.stringify(source.facts[binding.factIndex].properties));
 const {projectE2aSource,E2A_COMPILER_VERSION}=await import('../src/model/prompt-provenance-e2a.ts');assert.equal(projectE2aSource(source,{version:E2A_COMPILER_VERSION,bindings:body.approval.bindings}).removed.length,4);
 assert.ok(body.source.json.includes('Later authored edit.'));assert.equal(body.eligibility.executionAuthorized,false);assert.equal(body.configuration.accountBinding,null);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});

for(const runtime of ['source','production bundle']) for(const fault of ['missing','redacted-foreign-malformed','owner-missing','owner-invalid','foreign-malformed','malformed','envelope','unsupported','recreation','rehome','detach','project-id','project-conflict','preferences','reference','private-pointer','inactive-expiry','cleared-expiry','producer-wrong','producer-edited','producer-output-binding','approval-source','producer-expired','no-producer'])test(runtime+': refuses '+fault,async t=>{
 const f=await currentFixture(t,runtime),target=f.edited.eventId;
 const privateRow=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(target);
 const update=patch=>{const r={...privateRow,...patch};f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=?,redacted_at=?,private_json=? WHERE private_event_id=?').run(r.owner_id,r.redacted_at,r.private_json,target);};
 let expected;
 if(fault==='missing'){f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(target);expected='history_custody_unavailable';}
 if(fault==='redacted-foreign-malformed'){update({owner_id:'foreign',redacted_at:'2026-01-01',private_json:'{'});expected='history_custody_unavailable';}
 if(fault==='owner-missing'){update({owner_id:'',private_json:'{'});expected='history_custody_unavailable';}
 if(fault==='owner-invalid'){update({owner_id:'bad owner',private_json:'{'});expected='history_custody_unavailable';}
 if(fault==='foreign-malformed'){update({owner_id:'foreign',private_json:'{'});expected='history_custody_unavailable';}
 if(fault==='malformed'){update({private_json:'{'});expected='history_custody_unavailable';}
 if(fault==='envelope'){update({private_json:JSON.stringify({...JSON.parse(privateRow.private_json),project_id:'foreign-project'})});expected='producer_envelope_mismatch';}
 if(fault==='unsupported')await f.append('BlockFutureUnknown',{block_id:f.approved,private_note:'sentinel'});
 if(fault==='recreation')await f.append('BlockCreated',{project_id:'project',document_id:'document',block_id:f.approved,type:'direction',scope:'document',properties:{text:'replacement'}});
 if(fault==='rehome')await f.append('BlockRehomed',{block_id:f.approved,project_id:'project',document_id:'document'});
 if(fault==='detach')await f.append('BlockDocumentDetached',{block_id:f.approved,project_id:'project',document_id:'document'});
 if(fault==='project-id')await f.append('ProjectCreated',{name:'Missing explicit origin'});
 if(fault==='project-conflict')await f.append('DocumentRenamed',{document_id:'document',project_id:'foreign-project',new_title:'Hidden conflict'});
 if(fault==='preferences')await f.append('PreferenceAuthored',{preference_id:'pref',text:'Private global'});
 if(fault==='reference')await f.append('BlockCreated',{project_id:'project',document_id:'document',block_id:'ref',type:'reference',scope:'document',properties:{text:'Private reference',extraction_status:'ready'}});
 if(fault==='private-pointer')await f.append('BlockPropertyEdited',{block_id:f.approved,property_path:'private_content_ref',new_value:'private-sentinel'});
 if(fault==='inactive-expiry'){
  await f.append('BlockPropertyEdited',{block_id:f.approved,property_path:'weight',new_value:0});
  await f.append('BlockPropertyEdited',{block_id:f.approved,property_path:'source_expires_at',new_value:'2020-01-01T00:00:00.000Z'});
 }
 if(fault==='cleared-expiry'){
  await f.append('BlockPropertyEdited',{block_id:f.approved,property_path:'rights_expires_at',new_value:'2020-01-01T00:00:00.000Z'});
  await f.append('BlockPropertyEdited',{block_id:f.approved,property_path:'rights_expires_at',old_value:'2020-01-01T00:00:00.000Z',new_value:null});expected='retention_expired';
 }
 if(fault==='producer-wrong')f.sqlite.prepare("UPDATE authoring_commits SET approval_hash='wrong' WHERE preview_id=?").run(f.preview.previewId);
 if(fault==='producer-edited'){
  const row=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.output.contentId),v=JSON.parse(row.content);v.report.learned[0].text='Changed proposal';f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(JSON.stringify(v),f.output.contentId);
 }
 if(fault==='producer-output-binding'){
  const row=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.output.contentId),v=JSON.parse(row.content);v.sourceHash='false-source';f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(JSON.stringify(v),f.output.contentId);expected='execution_binding_mismatch';
 }
 if(fault==='approval-source'){
  const row=f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(f.preview.previewId),v=JSON.parse(row.content);v.plan.binding.sourceHash='false-source';v.approvalHash=await consentHash(v.plan);
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(JSON.stringify(v),f.preview.previewId);f.sqlite.prepare('UPDATE authoring_commits SET approval_hash=? WHERE preview_id=?').run(v.approvalHash,f.preview.previewId);expected='approval_source_binding_mismatch';
 }
 if(fault==='producer-expired')f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z' WHERE content_id=?").run(f.output.contentId);
 if(fault==='no-producer')await f.append('BlockPropertyEdited',{block_id:f.approved,property_path:'created_from',new_value:'authored'});
 let bodyLoads=0;const prepare=f.db.prepare;f.db.prepare=sql=>{if(sql.includes('SELECT * FROM admitted'))bodyLoads++;return prepare(sql);};
 const response=await f.inspect(),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));if(expected)assert.equal(body.error,expected);
 assert.equal(body.sourceQualified,false);assert.ok(!JSON.stringify(body).includes('sentinel'));assert.ok(!JSON.stringify(body).includes(target));assert.ok(!JSON.stringify(body).includes('Private harbor'));
 if(expected==='history_custody_unavailable'){
  assert.equal(bodyLoads,0,'failed custody must not hydrate any bodies');assert.equal(body.history.complete,true);assert.equal(Object.values(body.history.firstFailureCounts).reduce((a,b)=>a+b,0),1);
  const first={'redacted-foreign-malformed':'private_redacted','foreign-malformed':'private_owner_mismatch','missing':'private_absent','owner-missing':'private_owner_missing','owner-invalid':'private_owner_invalid','malformed':'envelope_json_invalid'}[fault];assert.equal(body.history.firstFailureCounts[first],1);
 }
});
for(const runtime of ['source','production bundle'])test(runtime+': selector/authentication and no-write boundary',async t=>{
 const f=await currentFixture(t,runtime);
 for(const path of ['/api/generation-current-source','/api/generation-current-source?documentId=document&documentId=document','/api/generation-current-source?documentId=document&owner=x','/api/generation-current-source?documentId=document&requestedSequence=3','/api/generation-current-source?documentId=document&includeSource=1'])assert.equal((await f.inspect(path)).status,400);
 assert.equal((await f.inspect(undefined,undefined,'POST')).status,405);
 assert.equal((await f.inspect(undefined,{})).status,409);
 assert.equal((await f.inspect(undefined,{...f.hosted,cookie:'forma_project_context=x'})).status,409);
 f.sqlite.prepare("UPDATE users SET role='creator'").run();assert.equal((await f.inspect()).status,409);
});

for(const runtime of ['source','production bundle'])for(const race of ['authority','consent','same-head-body','redaction','owner','producer','expiry','configuration','database','custody-refusal','page-growth','late-authority'])test(runtime+': rechecks '+race,async t=>{
 const f=await currentFixture(t,runtime);let injected=false,bodyReads=0;
 if(race==='custody-refusal')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(f.edited.eventId);
 const prepare=f.db.prepare;
 const mutate=()=>{
  const n=f.sqlite.prepare('SELECT total_changes() AS n').get().n;
  if(race==='authority'||race==='late-authority')f.sqlite.prepare("UPDATE users SET role='creator'").run();
  if(race==='consent')f.sqlite.prepare("UPDATE users SET consent_version='revoked'").run();
  if(race==='same-head-body'){
   const r=f.sqlite.prepare('SELECT private_json FROM event_private_payloads WHERE private_event_id=?').get(f.edited.eventId);f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(r.private_json.replace('Later','Other'),f.edited.eventId);
  }
  if(race==='redaction')f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2026-01-01' WHERE private_event_id=?").run(f.edited.eventId);
  if(race==='owner')f.sqlite.prepare("UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id=?").run(f.edited.eventId);
  if(race==='producer')f.sqlite.prepare("UPDATE authoring_commits SET approval_hash='changed' WHERE preview_id=?").run(f.preview.previewId);
  if(race==='expiry')f.sqlite.prepare("UPDATE private_content SET expires_at='2020-01-01T00:00:00.000Z' WHERE content_id=?").run(f.output.contentId);
  if(race==='configuration')f.env.OPENAI_MODEL='different-model';
  if(race==='database')f.env.DB={...f.db};
  if(race==='custody-refusal')f.sqlite.prepare('UPDATE event_private_payloads SET redacted_at=NULL WHERE private_event_id=?').run(f.edited.eventId);
  if(race==='page-growth'){
   const head=f.sqlite.prepare('SELECT max(sequence) AS n FROM events').get().n,event=makeEvent('creative:'+f.owner,head+1,'user:'+f.owner,'fixture','race','ProjectOpened',{project_id:'project'});
   f.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${Array(17).fill('?')})`).run(...eventWriteBindings(event));
  }
  f.control.externalChanges=(f.control.externalChanges??0)+f.sqlite.prepare('SELECT total_changes() AS n').get().n-n;
 };
 let contentReads=0;
 f.db.prepare=sql=>{
  const wrap=s=>{const bind=s.bind.bind(s);s.bind=(...a)=>wrap(bind(...a));const all=s.all.bind(s);s.all=async()=>{
   const result=await all();if(sql.includes('SELECT * FROM admitted'))bodyReads++;
   const custodyPage=sql.includes('SELECT sequence,CASE');
   if(sql.startsWith('SELECT content_id,kind,content'))contentReads++;
   const trigger=race==='custody-refusal'||race==='page-growth'?custodyPage:race==='late-authority'?contentReads===6:sql.startsWith('SELECT * FROM authoring_commits');
   if(!injected&&trigger){injected=true;mutate();}return result;
  };return s;};return wrap(prepare(sql));
 };
 const response=await f.inspect(),body=await response.json();assert.ok(injected,'mutation ran');assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.sourceQualified,false);assert.ok(!JSON.stringify(body).includes('Later authored'));
 if(race==='custody-refusal')assert.equal(bodyReads,0);
 if(['authority','consent','late-authority','same-head-body','custody-refusal'].includes(race))assert.equal(body.history,undefined,'invalidated witnesses disclose no prior census');
});
for(const runtime of ['source','production bundle'])test(runtime+': real writer history pagination and cell capacity',async t=>{
 const f=await currentFixture(t,runtime),head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events').get().n;
 const insert=f.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${Array(17).fill('?')})`);
 f.sqlite.exec('BEGIN');try{for(let i=1;i<=5001;i++)insert.run(...eventWriteBindings(makeEvent('creative:'+f.owner,head+i,'user:'+f.owner,'fixture','pages','ProjectOpened',{project_id:'project'})));f.sqlite.exec('COMMIT');}catch(e){f.sqlite.exec('ROLLBACK');throw e;}
 const response=await f.inspect();assert.equal(response.status,200,await response.clone().text());
 await f.append('BlockPropertyEdited',{block_id:f.approved,property_path:'text',new_value:'x'.repeat(2_200_001)});
 const limited=await(await f.inspect()).json();assert.equal(limited.error,'history_capacity_exceeded');assert.equal(limited.history.examined,0);assert.equal(limited.history.truncated,true);
});
test('read capability rejects writes, unknown helper SQL, foreign statements and statement exhaustion',async()=>{
 const {currentReadSession}=await import('../worker/generation-current-source-session.ts');
 let calls=0;const env={DB:{prepare:()=>({bind(){return this;},all:async()=>{calls++;return{success:true,results:[]};}})}};
 const r=currentReadSession(env);assert.throws(()=>r.helperEnv.DB.prepare('SELECT content FROM private_content'),/helper_query_unsupported/);
 await assert.rejects(r.helperEnv.DB.batch([{all:()=>assert.fail('foreign statement executed')}]),/foreign_statement/);
 await assert.rejects(r.read('DELETE FROM events'),/read_budget_exceeded/);assert.equal(calls,0);
 for(let i=0;i<1024;i++)await r.read('SELECT 1');
 await assert.rejects(r.read('SELECT 1'),/read_budget_exceeded/);assert.equal(calls,1024);
 await assert.rejects(r.recheck(),/read_budget_exceeded/);
});
for(const runtime of ['source','production bundle'])test(runtime+': actual selected project origin requires explicit identity',async t=>{
 const f=await currentFixture(t,runtime,{missingProjectId:true});const r=await(await f.inspect()).json();assert.equal(r.error,'project_origin_unproven');
});
for(const runtime of ['source','production bundle'])test(runtime+': bounded response never discloses a partial source',async t=>{
 const f=await currentFixture(t,runtime);
 for(let i=0;i<4;i++)await f.append('BlockPropertyEdited',{block_id:f.approved,property_path:'large'+i,new_value:'x'.repeat(1_600_000)});
 const r=await f.inspect(),v=await r.json();assert.equal(r.status,409,JSON.stringify(v));assert.equal(v.error,'reply_capacity_exceeded');assert.ok(JSON.stringify(v).length<2000);
});
for(const runtime of ['source','production bundle'])test(runtime+': environment configuration is not inferred account evidence',async t=>{
 const f=await currentFixture(t,runtime);
 f.env.FORMA_PREPARATION_CREDENTIAL_BINDING='fixture-credential-binding';
 f.env.FORMA_PREPARATION_CONFIG={model:'gpt-5.6-terra',modelBasis:'configured OPENAI_MODEL',projectHeader:null,endpoint:'https://api.openai.com/v1/responses',serviceTier:'standard',accountId:'fixture-account',region:'fixture-region',resolutionVersion:'v1',resolutionEvidenceRef:'fixture-evidence',credentialBinding:'fixture-credential-binding',expiresAt:new Date(Date.now()+86400000).toISOString()};
 const r=await f.inspect(),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));assert.equal(v.configuration.evidenceClass,'server-bound-h5-configuration');assert.equal(v.eligibility.eligibleForComparison,false);
 f.env.FORMA_PREPARATION_CONFIG.model='mismatch';assert.equal((await(await f.inspect()).json()).error,'configuration_binding_unavailable');
});
for(const runtime of ['source','production bundle'])test(runtime+': expiry after final SQL still refuses serialization',async t=>{
 const f=await currentFixture(t,runtime),now=Date.now,prepare=f.db.prepare;
 const afterExpiry=Math.max(...f.sqlite.prepare('SELECT expires_at FROM private_content').all().map(r=>Date.parse(r.expires_at)))+86400000;let crossed=false;t.after(()=>{Date.now=now;});
 f.db.prepare=sql=>{const wrap=s=>{const bind=s.bind.bind(s);s.bind=(...v)=>wrap(bind(...v));const all=s.all.bind(s);s.all=async()=>{const r=await all();if(sql.includes('SELECT auth_json FROM authorized\n WHERE EXISTS')){crossed=true;Date.now=()=>afterExpiry;}return r;};return s;};return wrap(prepare(sql));};
 const r=await f.inspect(),v=await r.json();assert.equal(crossed,true);assert.equal(r.status,409);assert.equal(v.error,'retention_expired');assert.ok(!JSON.stringify(v).includes('Private harbor'));
});

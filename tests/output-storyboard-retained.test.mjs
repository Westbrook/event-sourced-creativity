import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {storyboardEvidenceFixture} from './output-storyboard-retained-fixture.mjs';
import {assertStoryboardJobSchema} from './output-storyboard-job-schema.mjs';
const {readRetainedOutputStoryboard}=await import('../worker/output-storyboard-retained.ts');
const {verifyOutputStoryboardCompletion}=await import('../worker/output-storyboard-completion.ts');
const {model3dNativeCheckpoint,MODEL3D_TERMINAL_RESULT_SQL,MODEL3D_PRIVATE_CHECKPOINT_KEYS}=await import('../worker/output-model3d-terminal.ts');
const {recoveredFalImageEventIds}=await import('../worker/output-fal-recovery-policy.ts');
const harnessSource=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
const harnessDeclarations=[...harnessSource.matchAll(/^const OUTPUT_(?:STORYBOARD|VIDEO)_RETAINED_CHECKPOINT_KEYS = [^\n]+/gm)].map(match=>match[0].replace(' as const;',';')).join('\n');
assert.equal(harnessDeclarations.split('\n').length,2,'Use both current native terminal key declarations');
const harnessDependencies={model3dNativeCheckpoint,MODEL3D_TERMINAL_RESULT_SQL,MODEL3D_PRIVATE_CHECKPOINT_KEYS,recoveredFalImageEventIds};
function qualifiedFunction(...args){
 const body=args.pop();
 return new Function(...Object.keys(harnessDependencies),harnessDeclarations+'\nreturn function('+args.join(',')+'){\n'+body+'\n};')(...Object.values(harnessDependencies));
}
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});
test('all eight retained checkpoint fields conserve JSON presence, type and value; invalid original evidence never becomes readable',async()=>{
 const {stripTypeScriptTypes}=await import('node:module');
 const {documentJobCompletionBindings}=await import(process.env.FORMA_SOURCE_ROOT+'/worker/document-job-sql.ts');
 const source=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
 const constant=source.match(/const OUTPUT_STORYBOARD_RETAINED_CHECKPOINT_KEYS = [^\n]+/)?.[0]??'';
 const start=source.indexOf('async function finishDocumentJob('),end=source.indexOf('\nfunction queueRecoveryPresentation',start);
 const finish=qualifiedFunction('parseRequest','parentJobIdFromRequest','documentJobCompletionBindings','prepareOutputJobOutcomeStatements','PRESERVE_ADAPTIVE_RECEIPT_SQL',
  stripTypeScriptTypes(constant+'\n'+source.slice(start,end))+';return finishDocumentJob;')(
   row=>JSON.parse(row.request_json),()=>null,documentJobCompletionBindings,()=>[],'?');
 const keys=['outputExecution','providerSubmissionProtocol','providerSubmissionLegacyUncertain','artifactPlan','renderedItems','outputStoryboardPlannerCheckpoint','outputStoryboardRawEnvelope','outputStoryboardCheckpoints'];
 for(const key of keys)for(const variant of ['original','missing','null','false','true','number','numeric-string','boolean-string','stringified-original','object','array']){
  const f=await fixture();try{
   f.cp.providerSubmissionLegacyUncertain=false;
   const original=structuredClone(f.cp[key]);
   const values={original,missing:undefined,null:null,false:false,true:true,number:1,'numeric-string':'1','boolean-string':'false','stringified-original':JSON.stringify(original),object:{},array:[]};
   const value=values[variant];if(value===undefined)delete f.cp[key];else f.cp[key]=value;f.persist();
   const valid=variant==='original'||key==='providerSubmissionLegacyUncertain'&&(value===undefined||value===false)||key==='providerSubmissionProtocol'&&value===1;
   if(!valid)await assert.rejects(f.read(),key+' '+variant+' must already fail');
   const before=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);
   const beforeType=f.sqlite.prepare('SELECT json_type(result_json,?) type FROM document_jobs').get('$.'+key).type;
   f.sqlite.exec("UPDATE document_jobs SET status='running',completed_at=NULL");
   const job={...f.sqlite.prepare('SELECT * FROM document_jobs').get(),output_slot_id:'slot'};
   await finish({...f.env,DB:f.DB},job,'completed',{artifactId:f.artifactId,artifactKind:'storyboard',appendedEventIds:['completion'],[key]:'replacement-summary'},null);
   const after=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);
   assert.equal(Object.hasOwn(after,key),Object.hasOwn(before,key),key+' '+variant+' presence');
   assert.deepEqual(after[key],before[key],key+' '+variant+' exact value');
   assert.equal(f.sqlite.prepare('SELECT json_type(result_json,?) type FROM document_jobs').get('$.'+key).type,beforeType,key+' '+variant+' JSON type');
   if(valid)await f.read();else await assert.rejects(f.read(),key+' '+variant+' must still fail');
  }finally{f.sqlite.close();}
 }
 // Same explicit terminal-SQL fixture qualification: no-op outcome callback,
 // no hosted admission, provider transport, backfill or generated-success claim.
});
test('actual native terminal SQL preserves exact Storyboard checkpoint before the strict retained reader, without changing authority',async()=>{
 const {stripTypeScriptTypes}=await import('node:module');
 const {documentJobCompletionBindings}=await import(process.env.FORMA_SOURCE_ROOT+'/worker/document-job-sql.ts');
 const source=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
 const constant=source.match(/const OUTPUT_STORYBOARD_RETAINED_CHECKPOINT_KEYS = [^\n]+/)?.[0]??'';
 const start=source.indexOf('async function finishDocumentJob('),end=source.indexOf('\nfunction queueRecoveryPresentation',start);
 let outcomeCalls=0;
 const finish=qualifiedFunction('parseRequest','parentJobIdFromRequest','documentJobCompletionBindings','prepareOutputJobOutcomeStatements','PRESERVE_ADAPTIVE_RECEIPT_SQL',
  stripTypeScriptTypes(constant+'\n'+source.slice(start,end))+';return finishDocumentJob;')(
   row=>JSON.parse(row.request_json),()=>null,documentJobCompletionBindings,()=>{outcomeCalls++;return[];},'?');
 for(const uncertainty of [undefined,false,true,null,'false','true','0',0,1,{nested:null},[]]){const f=await fixture();try{
  outcomeCalls=0;if(uncertainty===undefined)delete f.cp.providerSubmissionLegacyUncertain;else f.cp.providerSubmissionLegacyUncertain=uncertainty;f.persist();
  const before=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);
  f.sqlite.exec("UPDATE document_jobs SET status='running',completed_at=NULL");
  const job={...f.sqlite.prepare('SELECT * FROM document_jobs').get(),output_slot_id:'slot'};
  const keys=['outputExecution','providerSubmissionProtocol','providerSubmissionLegacyUncertain','artifactPlan','renderedItems','outputStoryboardPlannerCheckpoint','outputStoryboardRawEnvelope','outputStoryboardCheckpoints'];
  const result={artifactId:f.artifactId,artifactKind:'storyboard',appendedEventIds:['completion'],stage:'completed',...Object.fromEntries(keys.map(key=>[key,'untrusted-summary']))};
  const original=job.result_json;
  assert.equal((await finish({...f.env,DB:f.DB},{...job,owner_id:'foreign'},'completed',result,null)).meta.changes,0);
  assert.equal(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json,original);
  assert.equal((await finish({...f.env,DB:f.DB},job,'completed',result,null)).meta.changes,1);
  const completed=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);
  for(const key of keys)assert.deepEqual(completed[key],before[key],key);
  assert.equal(Object.hasOwn(completed,'providerSubmissionLegacyUncertain'),Object.hasOwn(before,'providerSubmissionLegacyUncertain'));
  const type=f.sqlite.prepare("SELECT json_type(result_json,'$.providerSubmissionLegacyUncertain') type FROM document_jobs").get().type;
  assert.equal(type,f.sqlite.prepare("SELECT json_type(?,'$.providerSubmissionLegacyUncertain') type").get(JSON.stringify(before)).type);
  if(uncertainty!==undefined&&uncertainty!==false)await assert.rejects(f.read());else{
   const retained=await f.read();assert.equal(retained.expiresAt,f.job.expires_at);
   assert(f.sqlite.prepare('WITH storyboard_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+retained.witness.sql).get(retained.witness.json));
  }
  const completedRaw=f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json;
  assert.equal((await finish({...f.env,DB:f.DB},job,'completed',{artifactId:'replacement'},null)).meta.changes,0);
  assert.equal(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json,completedRaw);
  assert.equal(outcomeCalls,3);
  // This exercises the real terminal function/SQL with no-op outcome statements;
  // publication and admission are not simulated or claimed by this fixture.
 }finally{f.sqlite.close();}}
});

test('Storyboard private checkpoint fields remain private without a derived slot; other outputs unchanged',async()=>{
 const {stripTypeScriptTypes}=await import('node:module');
 const source=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
 const constant=source.match(/const OUTPUT_STORYBOARD_RETAINED_CHECKPOINT_KEYS = [^\n]+/)?.[0]??'';
 const start=source.indexOf('  const privateCheckpointKeys=new Set('),end=source.indexOf('\n  if(sanitizedResult&&request.artifactKind',start);
 const sanitize=qualifiedFunction('row','request','parsed','result',stripTypeScriptTypes(constant+'\n'+source.slice(start,end))+';return sanitizedResult;');
 const privateKeys=['outputExecution','artifactPlan','renderedItems','outputStoryboardPlannerCheckpoint','outputStoryboardRawEnvelope','outputStoryboardCheckpoints'];
 const result={artifactId:'original',stage:'completed',...Object.fromEntries(privateKeys.map(key=>[key,{private:true}]))};
 const native=sanitize({output_slot_id:'slot',kind:'render_document'},{artifactKind:'storyboard'},result,result);
 assert.equal(native.artifactId,'original');assert.equal(native.stage,'completed');for(const key of privateKeys)assert(!Object.hasOwn(native,key),key);
 const cold=sanitize({kind:'render_document'},{artifactKind:'storyboard'},result,result);
 for(const key of privateKeys)assert(!Object.hasOwn(cold,key),key);
 for(const [row,request] of [[{output_slot_id:'slot',kind:'render_document'},{artifactKind:'audio'}],[{output_slot_id:'slot',kind:'generate'},{artifactKind:'image'}]]){
  const unchanged=sanitize(row,request,result,result);for(const key of privateKeys)assert.deepEqual(unchanged[key],result[key]);
 }
});
async function fixture(){
 const f=await storyboardEvidenceFixture();
 assertStoryboardJobSchema(f.sqlite);
 f.sqlite.exec(`ALTER TABLE output_operation_slots ADD COLUMN plan_revision_id TEXT DEFAULT 'revision';
  ALTER TABLE output_operation_slots ADD COLUMN target_id TEXT DEFAULT 'target';
  ALTER TABLE output_operation_slots ADD COLUMN target_contract_digest TEXT DEFAULT 'target-digest';
  ALTER TABLE output_operation_slots ADD COLUMN attempt_ordinal INTEGER DEFAULT 0;
  ALTER TABLE output_operation_slots ADD COLUMN previous_slot_id TEXT;
  ALTER TABLE output_operation_slots ADD COLUMN outcome_event_id TEXT DEFAULT 'completion';
  CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,actor_user_id TEXT,context_id TEXT,status TEXT,expires_at TEXT);
  CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,owner_user_id TEXT,document_id TEXT,project_id TEXT,organization_id TEXT,project_access_id TEXT,scope_kind TEXT);
  CREATE TABLE output_native_storage_writes(scope_key TEXT,slot_id TEXT,storage_key TEXT,content_sha256 TEXT,status TEXT,write_acknowledged INTEGER,publication_event_id TEXT);
  INSERT INTO output_execution_grants VALUES('scope','grant','owner',NULL,'completed','2000-01-01T00:00:00.000Z');
  INSERT INTO output_plan_revisions VALUES('scope','revision','owner','doc','project',NULL,NULL,'personal');`);
 Object.assign(f.scope,{projectId:'project',organizationId:null,projectAccessId:null,contextId:null});
 Object.assign(f.slot,{scopeKey:'scope',planRevisionId:'revision',targetId:'target',targetContractDigest:'target-digest'});
 const result=await f.verify(),receipt=result.receipt,reference={scopeKey:'scope',grantId:'grant',slotId:'slot',planRevisionId:'revision',targetId:'target',targetContractDigest:'target-digest',sourceDigest:'source'};
 f.cp.outputExecution=reference;f.cp.artifactKind='storyboard';f.cp.appendedEventIds=['completion'];f.persist();
 // Match prepareAdmission/buildStatements: reference is checkpoint-only.
 const request={...f.settings,artifactKind:'storyboard',productionMode:'manual',itemCount:4};
 f.sqlite.prepare("UPDATE document_jobs SET status='completed',request_json=?,completed_at=?,lease_expires_at=NULL").run(JSON.stringify(request),new Date().toISOString());
 f.sqlite.exec("UPDATE output_operation_slots SET status='succeeded'");
 const inputBody={schema_version:1,artifact_id:f.artifactId,artifact_kind:'storyboard',document_id:'doc',project_id:'project',
  output_storyboard:receipt,request:{item_count:4,production_mode:'manual',source_surface:'outputs'},planner:{provider:'openai',response_id:receipt.plannerResponseId}};
 f.sqlite.prepare("INSERT INTO private_content VALUES('input','owner','document-artifact-input',?,?,?,NULL)").run(JSON.stringify(inputBody),new Date().toISOString(),f.job.expires_at);
 const payload={document_id:'doc',project_id:'project',artifact_id:f.artifactId,artifact_kind:'storyboard',requested_by_user_id:'owner',
  content_ref:'content',input_ref:'input',source_surface:'outputs',item_count:4,settings:{item_count:4,production_mode:'manual',output_storyboard:receipt},
  items:f.cp.renderedItems.map(frame=>({id:frame.id,media_url:frame.media_url,media_type:frame.media_type,width:frame.width,height:frame.height}))};
 const hash=value=>createHash('sha256').update(value).digest('hex');
 Object.assign(payload.settings,{storyboard_content_sha256:hash(JSON.stringify(f.artifact)),storyboard_input_sha256:hash(JSON.stringify(inputBody))});
 for(const frame of receipt.frames)f.sqlite.prepare("INSERT INTO output_native_storage_writes VALUES('scope','slot',?,?,'written',1,'completion')")
  .run(decodeURIComponent(frame.mediaUrl.slice('/api/media/'.length)),frame.sha256);
 const input={ownerId:'owner',completionId:'completion',documentId:'doc',projectId:'project',artifactId:f.artifactId,contentId:'content',inputId:'input',rawContent:JSON.stringify(f.artifact),contentExpiresAt:f.job.expires_at,completionRaw:JSON.stringify(payload)};
 let beforeRead;
 const env={...f.env,DB:{prepare(sql){assert.match(sql,/^\s*(SELECT|WITH)\b/i);const p=f.env.DB.prepare(sql);const wrap=values=>({bind(...v){return wrap(v);},async first(){await beforeRead?.(sql);return p.bind(...values).first();},async all(){await beforeRead?.(sql);return p.bind(...values).all();}});return wrap([]);},batch(){throw Error('retained read wrote');}}};
 const read=()=>readRetainedOutputStoryboard(env,input);
 return {...f,input,payload,env,read,setBeforeRead:fn=>{beforeRead=fn;}};
}
test('retained completed Storyboard reuses original five settled receipts and reads four private frames after spend expiry, with SELECT-only DB',async()=>{
 const f=await fixture();try{const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
  const result=await f.read();for(const a of result.assertions)assert(f.sqlite.prepare('SELECT 1 WHERE '+a.sql).get(...a.bindings));
  assert(f.sqlite.prepare('WITH storyboard_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+result.witness.sql).get(result.witness.json));
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
  assert.equal(result.expiresAt,f.job.expires_at);
  await assert.rejects(verifyOutputStoryboardCompletion(f.env,f.scope,f.slot,f.job,f.settings,f.artifactId,f.artifact,f.cp.renderedItems));
 }finally{f.sqlite.close();}
});
test('retained read rejects foreign, edited, expired, revoked, unresolved or unpublished evidence without a new call',async()=>{
 const producer=readFileSync(new URL('../worker/output-document-execution.ts',import.meta.url),'utf8');
 const writer=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
 assert(producer.includes('outputExecution:reference,generationReceipt:'));
 assert(writer.includes('JSON.stringify(payload),JSON.stringify({...initialResult,...checkpoint,providerSubmissionProtocol:1})'));
 const mutations=[
  f=>f.sqlite.exec("UPDATE document_jobs SET result_json=json_remove(result_json,'$.outputExecution')"),
  f=>f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputExecution.scopeKey','foreign')"),
  f=>f.sqlite.exec("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputExecution.slotId','foreign')"),
  f=>f.sqlite.exec("UPDATE document_jobs SET request_json=json_set(request_json,'$.outputExecution',NULL)"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET job_id='foreign'"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET scope_key='foreign'"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET slot_id='foreign'"),
  f=>f.sqlite.exec("UPDATE document_jobs SET request_json=json_set(request_json,'$.outputExecution.scopeKey','foreign')"),
  f=>f.sqlite.exec("UPDATE document_jobs SET request_json=json_set(request_json,'$.outputExecution.slotId','foreign')"),
  f=>{f.input.ownerId='foreign';},
  f=>{f.input.rawContent=JSON.stringify({...f.artifact,title:'edited'});},
  f=>f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'"),
  f=>f.sqlite.exec("UPDATE document_jobs SET status='running'"),
  f=>f.sqlite.exec("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'"),
  f=>f.sqlite.exec("UPDATE output_provider_calls SET status='uncertain' WHERE call_key='image:frame:1'"),
  f=>f.sqlite.exec("UPDATE output_native_storage_writes SET publication_event_id=NULL"),
  f=>f.sqlite.exec("UPDATE output_native_storage_writes SET content_sha256='foreign'"),
  f=>f.sqlite.exec("UPDATE private_content SET redacted_at='redacted' WHERE content_id='input'"),
  f=>f.sqlite.exec("UPDATE private_content SET content=json_set(content,'$.document_snapshot','changed') WHERE content_id='input'"),
  f=>f.sqlite.exec("UPDATE output_operation_slots SET outcome_event_id='foreign'"),
  f=>{f.payload.items.reverse();f.input.completionRaw=JSON.stringify(f.payload);},
  f=>{f.media.clear();},
 ];
 for(const change of mutations){const f=await fixture();try{change(f);await assert.rejects(f.read());assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,5);}finally{f.sqlite.close();}}
});
test('retained physical read is abortable and late changed publication evidence cannot pass final SQL witness',async()=>{
 // Existing publication/private-source mutation checks remain unchanged below.
 const f=await fixture();try{
  const verified=await f.read();f.sqlite.exec("UPDATE output_native_storage_writes SET publication_event_id='foreign'");
  assert(verified.assertions.some(a=>!f.sqlite.prepare('SELECT 1 WHERE '+a.sql).get(...a.bindings)));
  assert.equal(f.sqlite.prepare('WITH storyboard_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+verified.witness.sql).get(verified.witness.json),undefined);
  f.sqlite.exec("UPDATE output_native_storage_writes SET publication_event_id='completion'");
  const abort=new AbortController();f.input.signal=abort.signal;const get=f.env.MEDIA.get.bind(f.env.MEDIA);let cancel=0;
  f.env.MEDIA.get=async key=>{const original=await get(key);return {...original,body:new ReadableStream({pull(){abort.abort();return new Promise(()=>{});},cancel(){cancel++;return new Promise(()=>{});}})};};
  await assert.rejects(f.read());assert.equal(cancel,1);
 }finally{f.sqlite.close();}
});
test('actual retained reader attaches Storyboard revalidation to current revision and final auth/content witness',()=>{
 // The full reader fixtures above now use the real checkpoint-only reference.
 const source=readFileSync(new URL('../worker/retained-story-api.ts',import.meta.url),'utf8');
 assert.match(source,/selection\.revision!==0\|\|native\.latestEditId/);
 assert.match(source,/storyboardRead=await readRetainedOutputStoryboard/);
 assert.match(source,/storyboardRead\.witness\.sql/);
 assert.match(source,/storyboardRead\.witness\.json/);
 assert.match(source,/storyboard_witness AS \(SELECT \? AS bindings\)/);
 assert.match(source,/Date\.parse\(storyboardRead\.expiresAt\)<=Date\.now\(\)\|\|request\.signal\.aborted/);
 // This is a source wiring control, not a hosted-principal admission proof.
});

test('retained Storyboard permits only an exact optional legacy reference and pins both JSON bodies through disclosure',async()=>{
 for(const mutation of ['result','request']){
  const f=await fixture();try{
   const row=f.sqlite.prepare('SELECT request_json,result_json FROM document_jobs').get(),request=JSON.parse(row.request_json),reference=JSON.parse(row.result_json).outputExecution;
   assert.equal(Object.hasOwn(request,'outputExecution'),false);
   request.outputExecution=reference;f.sqlite.prepare('UPDATE document_jobs SET request_json=?').run(JSON.stringify(request));
   const read=await f.read();assert(f.sqlite.prepare('WITH storyboard_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+read.witness.sql).get(read.witness.json));
   if(mutation==='result')f.sqlite.exec("UPDATE document_jobs SET result_json=json_remove(result_json,'$.outputExecution')");
   else f.sqlite.exec("UPDATE document_jobs SET request_json=json_set(request_json,'$.outputExecution.grantId','foreign')");
   assert.equal(f.sqlite.prepare('WITH storyboard_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+read.witness.sql).get(read.witness.json),undefined);
   await assert.rejects(f.read());
  }finally{f.sqlite.close();}
 }
});
test('actual hosted retained GET joins SQLite principal, private completion, original evidence and PNGs without writes; final mutation withdraws DTO',async()=>{
 const C=process.env.FORMA_SOURCE_ROOT;
 const {outputTestDatabase}=await import(C+'/tests/output-execution-test-helpers.mjs');
 const {ensureSchema,appendAuditEvent,appendEvents,makeEvent}=await import(C+'/worker/runtime.ts');
 const {handleNativeRetainedOutputRead}=await import('../worker/retained-story-api.ts');
 const {nativeRetainedOutputRequestPath}=await import(C+'/src/model/native-retained-output.ts');
 const f=await fixture(),g=outputTestDatabase();
 try{
  await ensureSchema(g.env);
  const now=new Date().toISOString();
  g.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES('owner','owner@example.test','Owner','creator','pilot-2026-08-10',?,?,?)").run(now,now,now);
  await appendAuditEvent(g.env,'creative:owner','user','DocumentCreated',{document_id:'doc',project_id:'project',title:'Keeper'});
  const completed=makeEvent('creative:owner',0,'worker:renderer','server:document-job:render_document','corr','DocumentRenderCompleted',f.payload);
  await appendEvents(g.env,[completed]);
  f.cp.appendedEventIds=[completed.eventId];f.persist();
  f.sqlite.prepare('UPDATE output_operation_slots SET outcome_event_id=?').run(completed.eventId);
  f.sqlite.prepare('UPDATE output_native_storage_writes SET publication_event_id=?').run(completed.eventId);
  // Copy the explicit offline evidence fixture, not a completed-auth object.
  // The production endpoint executes its own hosted principal query below.
  const defaults={
   output_plan_revisions:{plan_id:'fixture-plan',revision:1,confirmed_event_id:completed.eventId,requirements_digest:'fixture-requirements',source_digest:'source',resolver_version:'fixture',source_head:1,target_count:1,created_at:now},
   output_execution_grants:{plan_revision_id:'revision',payer_user_id:'owner',preflight_id:'fixture-preflight',authorization_event_id:completed.eventId,maximum_microusd:100000,maximum_calls:5,created_at:now},
   output_operation_slots:{provider:'fal',model:'ideogram/v4',cost_reservation_id:'fixture-cost',token_reservation_id:'fixture-tokens',maximum_microusd:100000,maximum_calls:5,maximum_tokens:100000,created_at:now,updated_at:now},
   output_provider_calls:{reserved_microusd:100000,created_at:now,settled_at:now},output_native_storage_writes:{created_at:now,updated_at:now},
  };
  for(const table of ['output_plan_revisions','output_execution_grants','output_operation_slots','output_provider_calls','output_native_storage_writes','private_content']){
   if(!g.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))g.sqlite.exec(f.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql);
   for(const sourceRow of f.sqlite.prepare('SELECT * FROM '+table).all()){
    const row={...(defaults[table]??{}),...sourceRow};
    const keys=Object.keys(row);g.sqlite.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]));
   }
   if(table==='output_plan_revisions'){
    g.sqlite.prepare("INSERT INTO output_plan_targets VALUES('scope','revision','target','target-digest','document',1,1,0)").run();
    g.sqlite.prepare("INSERT INTO output_preflights VALUES('scope','fixture-preflight','revision','owner','fixture-terms',?,?,?)").run(completed.eventId,f.job.expires_at,now);
   }
   if(table==='output_operation_slots')for(const call of f.sqlite.prepare('SELECT * FROM output_provider_calls').all())g.sqlite.prepare("INSERT INTO output_operation_routes VALUES('scope','slot',?,?,?,1)").run(call.stage_key,call.provider,call.model);
  }
  assertStoryboardJobSchema(g.sqlite);
  const job={...f.sqlite.prepare('SELECT * FROM document_jobs').get(),requested_sequence:1,requested_at:now};
  const keys=Object.keys(job);g.sqlite.prepare('INSERT INTO document_jobs('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>job[key]));
  g.sqlite.prepare("INSERT INTO private_content VALUES('content','owner','document-artifact',?,?,?,NULL)").run(f.input.rawContent,now,f.job.expires_at);
  let beforeFinal;
  const env={...g.env,MEDIA:f.env.MEDIA,DB:{prepare(sql){assert.match(sql,/^\s*(WITH|SELECT)\b/i);
   const p=g.DB.prepare(sql),wrap=values=>({bind(...v){return wrap(v);},async first(){if(sql.includes('expected_events AS'))await beforeFinal?.();return p.bind(...values).first();},async all(){return p.bind(...values).all();}});
   return wrap([]);
  },batch(){throw Error('read attempted mutation');}}};
  const selection={documentId:'doc',artifactId:f.artifactId,revision:0,contentSha256:createHash('sha256').update(f.input.rawContent).digest('hex')};
  const request=()=>new Request('https://forma.test'+nativeRetainedOutputRequestPath({output:'storyboard',selection}),{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}});
  const before=g.sqlite.prepare('SELECT total_changes() n').get().n;
  const response=await handleNativeRetainedOutputRead(request(),env);assert.equal(response.status,200,await response.clone().text());
  const dto=await response.json();assert.equal(dto.output,'storyboard');assert.equal(dto.content.frames.length,4);
  assert.deepEqual(dto.content.frames.map(frame=>[frame.title,frame.body,frame.notes,frame.imagePrompt]),f.artifact.items.map(frame=>[frame.title,frame.body,frame.notes,frame.image_prompt]));
  assert(dto.content.frames.every(frame=>frame.image?.mediaType==='image/png'));
  assert.equal(g.sqlite.prepare('SELECT total_changes() n').get().n,before);
  beforeFinal=()=>g.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.document_snapshot','changed') WHERE content_id='input'").run();
  assert.equal((await handleNativeRetainedOutputRead(request(),env)).status,404);
 }finally{f.sqlite.close();g.sqlite.close();}
});
test('actual native terminal construction retains all five Storyboard calls; disabling only its branch reproduces count one',async()=>{
 const {stripTypeScriptTypes}=await import('node:module');
 const {documentJobCompletionBindings}=await import(process.env.FORMA_SOURCE_ROOT+'/worker/document-job-sql.ts');
 const submissions=await import(process.env.FORMA_SOURCE_ROOT+'/src/model/provider-submission.ts');
 const source=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
 const take=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);};
 const safeResult=qualifiedFunction(stripTypeScriptTypes(take('function safeResult(','\n/** Read/recover only retained paid evidence.'))+';return safeResult;')();
 const constructSource=take('    const liveCheckpoint=latestCheckpoint;','\n    const recordedNativeFailure=');
 // Mutation oracle removes only Storyboard while preserving the current Audio,
 // Video and Model3D branches. The actual constructor remains unmodified.
 const oldCondition='outputBinding&&(readOutputAudioPayload(parseRequest(row))||row.kind==="render_document"&&parseRequest(row).artifactKind==="video"||model3dNativeCheckpoint(parseRequest(row)))',newCondition='outputBinding&&(readOutputAudioPayload(parseRequest(row))||row.kind==="render_document"&&["storyboard","video"].includes(String(parseRequest(row).artifactKind))||model3dNativeCheckpoint(parseRequest(row)))';
 assert(constructSource.includes(newCondition));
 const makeConstruct=text=>qualifiedFunction('latestCheckpoint','durableCheckpoint','outputBinding','row','body','safeResult','readOutputAudioPayload','parseRequest','followup','sceneConfiguration','detail','response',
  stripTypeScriptTypes(text)+';return terminalResult;');
 const construct=makeConstruct(constructSource),oldConstruct=makeConstruct(constructSource.replace(newCondition,oldCondition));
 const missing=()=>{throw Error('Unexpected receipt dependency or source/financial read');};
 const deps={requiresForegroundDocumentExecution:row=>['preview','generate','render_document'].includes(row.kind),parseResult:row=>JSON.parse(row.result_json),
  readJob:missing,readCorrelatedEvents:missing,costBudgetReservation:missing,readScenePolicyStopEvidence:missing,readOutputSceneLocalStop:missing,
  providerSubmissions:submissions.providerSubmissions,hasUnresolvedProviderSubmission:submissions.hasUnresolvedProviderSubmission,hasUnsettledProviderSubmission:submissions.hasUnsettledProviderSubmission,definitiveProviderRejection:submissions.definitiveProviderRejection};
 const refresh=qualifiedFunction(...Object.keys(deps),stripTypeScriptTypes(take('async function refreshGenerationReceipt(','\nfunction rowIsStale('))+';return refreshGenerationReceipt;')(...Object.values(deps));
 const constant=source.match(/const OUTPUT_STORYBOARD_RETAINED_CHECKPOINT_KEYS = [^\n]+/)[0];
 const finish=qualifiedFunction('parseRequest','parentJobIdFromRequest','documentJobCompletionBindings','prepareOutputJobOutcomeStatements','PRESERVE_ADAPTIVE_RECEIPT_SQL',
  stripTypeScriptTypes(constant+'\n'+take('async function finishDocumentJob(','\nfunction queueRecoveryPresentation'))+';return finishDocumentJob;')(row=>JSON.parse(row.request_json),()=>null,documentJobCompletionBindings,()=>[],'?');
 for(const useOld of [true,false]){const f=await fixture();try{
  const calls=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();assert.equal(calls.length,5);assert(calls.every(call=>call.status==='settled'));
  const cost=calls.reduce((sum,call)=>sum+call.used_microusd,0),providerMap=structuredClone(f.cp.providerSubmissions);
  f.cp.generationReceipt={artifact_kind:'storyboard',actual_provider_call_count:null,planned_provider_call_count:5,maximum_provider_call_count:5,reservation_microusd:100000,settled_cost_microusd:0,reservation_status:'executing',source_transmission_status:'transmitted',provider_request_status:'submitted'};
  f.cp.plannerResponseIds=[f.cp.plannerResponseId];f.cp.plannerInput={provider_request_count:1};f.persist();
  f.sqlite.exec("UPDATE document_jobs SET status='running',completed_at=NULL");
  const row={...f.sqlite.prepare('SELECT * FROM document_jobs').get(),output_slot_id:'slot'},user={userId:'owner',streamId:row.stream_id};
  const body={artifactId:f.artifactId,artifactKind:'storyboard',providerSubmissions:{forged:{status:'completed'}},appended:[{eventId:'completion',type:'DocumentRenderCompleted',payload:{...f.payload,provider:'fal',model_id:'ideogram/v4'}},{eventId:'usage',type:'GenerationUsageRecorded',payload:{cost_reservation_id:'fixture-cost',cost_microusd:cost,total_tokens:300}}]};
  const build=(fn,live=f.cp,binding={},requestRow=row,audio=()=>null)=>fn(live,{},binding,requestRow,body,safeResult,audio,r=>JSON.parse(r.request_json),null,null,null,{ok:true});
  const result=build(useOld?oldConstruct:construct);
  assert.equal(result.generationReceipt.actual_provider_call_count,1,'one planner observation before generic refresh');
  if(useOld)assert(!Object.hasOwn(result,'providerSubmissions'));else assert.deepEqual(result.providerSubmissions,providerMap);
  const settlement={reservation_id:'fixture-cost',reserved_microusd:100000,used_microusd:cost,status:'settled'};
  const refreshed=await refresh(f.env,user,row,body,null,'',{...row,status:'completed',result_json:JSON.stringify(result)},false,settlement),receipt=JSON.parse(refreshed.result_json).generationReceipt;
  assert.equal(receipt.actual_provider_call_count,useOld?1:5);assert.equal(receipt.settled_cost_microusd,cost);assert.equal(receipt.provider_request_status,'completed');
  assert.equal((await finish({...f.env,DB:f.DB},row,'completed',JSON.parse(refreshed.result_json),null)).meta.changes,1);
  const saved=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json);
  assert.equal(saved.generationReceipt.actual_provider_call_count,useOld?1:5);assert.deepEqual(saved.providerSubmissions,providerMap);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_provider_calls').all(),calls,'receipt refresh/finish does not change or settle any claim');
  await f.read();
  if(!useOld){
   for(const [binding,requestRow,audio] of [[null,row,()=>null],[{}, {...row,kind:'generate'},()=>null],[{}, {...row,request_json:JSON.stringify({artifactKind:'slides'})},()=>null]]){
    const unchanged=build(construct,f.cp,binding,requestRow,audio),old=build(oldConstruct,f.cp,binding,requestRow,audio);assert.deepEqual(unchanged,old);assert(!Object.hasOwn(unchanged,'providerSubmissions'));
   }
   const audioRow={...row,request_json:JSON.stringify({artifactKind:'audio'})};assert.deepEqual(build(construct,f.cp,{},audioRow,()=>({retained:true})),build(oldConstruct,f.cp,{},audioRow,()=>({retained:true})),'existing native Audio branch unchanged');
   const reduced={...f.cp,providerSubmissions:Object.fromEntries(Object.entries(providerMap).slice(0,3))};
   const partial=build(construct,reduced),observed=await refresh(f.env,user,row,body,null,'',{...row,status:'completed',result_json:JSON.stringify(partial)},false,settlement);
   assert.equal(JSON.parse(observed.result_json).generationReceipt.actual_provider_call_count,3,'count actual retained submissions, not a hardcoded five');
  }
 }finally{f.sqlite.close();}}
 // Actual constructor/refresh/SQL and real per-call evidence fixture. Outcome
 // callback is no-op; this is not admission, provider dispatch, or historical backfill.
});

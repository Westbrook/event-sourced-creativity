import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

// Exact actual cleanup bodies and policy SQL, with
// isolated SQLite and metadata-only MEDIA. No full runtime/provider imports.
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const source=read('worker/output-private-execution.ts');
const helper=read('worker/output-model3d-recovery-storage.ts');
const fal=read('worker/output-fal-recovery-policy.ts');
const start=fal.indexOf('export const retainedPersonalFalRecoverySql='),end=fal.indexOf('\n\nconst object=',start);
assert.ok(start>=0&&end>start);
const cleanup=source.slice(source.indexOf('async function cleanupNativeStorageReceipt('));
assert.deepEqual([...cleanup.matchAll(/(?:async )?function (\w+)\(/g)].map(v=>v[1]),['cleanupNativeStorageReceipt','reconcileOutputNativeStorage']);
const guard=source.slice(source.indexOf('export function guardOutputPrivateWrites('),source.indexOf('\ntype NativeStorageReceipt'));
assert.ok(!guard.includes('retainedModel3dRecoveryStorageSql'),'Retention exception must not enter the write/publication guard');
const compiled=stripTypeScriptTypes([fal.slice(start,end),helper,cleanup].join('\n').replace(/^export /gm,''),{mode:'transform'});
const {reconcile}=new Function(compiled+'\nreturn {reconcile:reconcileOutputNativeStorage};')();
const token='12345678-1234-4234-8234-123456789abc',sha='a'.repeat(64),digest='b'.repeat(64);
const primaryKey=`u-6f776e6572/generated/artifact-recovery-${token}.glb`;
const model='fal-ai/hyper3d/rodin/v2.5/text-to-3d';
function fixture({index=0,role='mesh',mime='model/gltf-binary',format='glb',extension='glb'}={}) {
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE output_native_storage_writes(scope_key,slot_id,storage_key,content_sha256,status,write_acknowledged,publication_event_id,created_at,updated_at);
    CREATE TABLE output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,job_id,status,attempt_ordinal,previous_slot_id,provider,model,source_digest,maximum_calls,maximum_tokens);
    CREATE TABLE output_plan_revisions(scope_key,plan_revision_id,scope_kind,owner_user_id,document_id,project_id,organization_id,project_access_id,source_digest);
    CREATE TABLE output_execution_grants(scope_key,grant_id,actor_user_id,payer_user_id,context_id,status,expires_at);
    CREATE TABLE document_jobs(job_id,owner_id,stream_id,document_id,kind,source_surface,status,attempt_count,lease_expires_at,expires_at,request_json,result_json);
    CREATE TABLE output_provider_calls(scope_key,slot_id,call_key,stage_key,provider,model,status,client_request_id,provider_response_id,request_digest);
    CREATE TABLE private_content(content_id,owner_id,kind,redacted_at,expires_at);
    CREATE TABLE project_resource_scopes(resource_kind,resource_id);
    CREATE TABLE private_content_retention_scopes(content_id);
    CREATE TABLE organization_projects(owner_user_id,project_id);
    CREATE TABLE events(stream_id,type,payload);`);
  const insert=(table,row)=>db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  const now=new Date().toISOString(),expiry=new Date(Date.now()+90000).toISOString(),retention=new Date(Date.now()+600000).toISOString();
  const key=`u-6f776e6572/generated/artifact-recovery-${token}${index===0?'':'-'+role+'-'+index}.${extension}`;
  const execution={scopeKey:'scope',slotId:'slot',grantId:'grant',planRevisionId:'plan',sourceDigest:'source'};
  const request={artifactKind:'model3d',outputExecution:execution,outputModel3d:{source:{draftId:'draft'}},model3dCostPreview:{requestId:'job',draftId:'draft'}};
  const file=(at,storageKey,fileRole,fileMime,fileFormat)=>({index:at,token,storageKey,sha256:sha,
    file:{url:'/api/media/'+encodeURIComponent(storageKey),mimeType:fileMime,fileName:'original.glb',fileSize:4,format:fileFormat,role:fileRole,sha256:sha},providerMediaUrl:'https://fal.media/original.glb'});
  const files=[file(0,primaryKey,'mesh','model/gltf-binary','glb')];
  if(index)files.push(file(index,key,role,mime,format));
  const result={artifactId:'artifact',artifactKind:'model3d',outputExecution:execution,model3dInputReceipt:{model,requestDigest:digest},
    outputModel3dRecovery:{version:'output-model3d-recovery-v1',token,expiresAt:expiry,jobId:'job',slotId:'slot',clientRequestId:'forma-model3d-original',providerRequestId:'accepted_original',requestDigest:digest},
    outputModel3dRecoveryFiles:files,providerSubmissions:{'forma-model3d-original':{clientRequestId:'forma-model3d-original',providerRequestId:'accepted_original',provider:'fal',model,operation:'model3d',status:'accepted'}}};
  insert('output_execution_grants',{scope_key:'scope',grant_id:'grant',actor_user_id:'owner',payer_user_id:'owner',context_id:null,status:'active',expires_at:'2000-01-01T00:00:00.000Z'});
  insert('output_operation_slots',{scope_key:'scope',slot_id:'slot',grant_id:'grant',plan_revision_id:'plan',job_id:'job',status:'failed',attempt_ordinal:0,previous_slot_id:null,provider:'fal',model,source_digest:'source',maximum_calls:1,maximum_tokens:1});
  insert('output_plan_revisions',{scope_key:'scope',plan_revision_id:'plan',scope_kind:'personal',owner_user_id:'owner',document_id:'document',project_id:'project',organization_id:null,project_access_id:null,source_digest:'source'});
  insert('document_jobs',{job_id:'job',owner_id:'owner',stream_id:'creative:owner',document_id:'document',kind:'render_document',source_surface:'outputs',status:'failed',attempt_count:1,lease_expires_at:null,expires_at:retention,request_json:JSON.stringify(request),result_json:JSON.stringify(result)});
  insert('output_provider_calls',{scope_key:'scope',slot_id:'slot',call_key:'model3d:initial',stage_key:'model3d:initial',provider:'fal',model,status:'uncertain',client_request_id:'forma-model3d-original',provider_response_id:'accepted_original',request_digest:digest});
  insert('private_content',{content_id:'draft',owner_id:'owner',kind:'experience-draft',redacted_at:null,expires_at:retention});
  insert('output_native_storage_writes',{scope_key:'scope',slot_id:'slot',storage_key:key,content_sha256:sha,status:'written',write_acknowledged:1,publication_event_id:null,created_at:now,updated_at:now});
  let exists=true,deleted=0,forbidden=0;
  class Statement {
    constructor(sql,bindings=[]){this.sql=sql;this.bindings=bindings;}
    bind(...values){return new Statement(this.sql,values);}
    async run(){return{success:true,meta:{changes:Number(db.prepare(this.sql).run(...this.bindings).changes)}};}
    async first(){return db.prepare(this.sql).get(...this.bindings)??null;}
    async all(){return{success:true,results:db.prepare(this.sql).all(...this.bindings)};}
  }
  const denied=()=>{forbidden++;throw Error('storage_grace_has_no_effect_authority');};
  const env={DB:{prepare:sql=>new Statement(sql),batch:denied},MEDIA:{
    async head(requested){assert.equal(requested,key);return exists?{customMetadata:{outputNativeStorage:'1',outputScopeKey:'scope',outputSlotId:'slot',outputOwnerId:'owner',outputDocumentId:'document',outputSha256:sha}}:null;},
    async delete(requested){assert.equal(requested,key);exists=false;deleted++;},put:denied,get:denied}};
  const fixedTables=['document_jobs','output_operation_slots','output_plan_revisions','output_execution_grants','output_provider_calls','private_content','events'];
  const snapshot=()=>Object.fromEntries(fixedTables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));
  return{db,env,insert,result,request,key,expiry,retention,snapshot,save(){db.prepare('UPDATE document_jobs SET result_json=?,request_json=?').run(JSON.stringify(result),JSON.stringify(request));},
    async run(){const before=snapshot();const value=await reconcile(env,{ownerUserId:'owner',personalOnly:true});assert.deepEqual(snapshot(),before);assert.equal(forbidden,0);return value;},
    get deleted(){return deleted;},get status(){return db.prepare('SELECT status FROM output_native_storage_writes').get().status;}};
}

for(const options of [{},{index:1,role:'texture',mime:'image/png',format:null,extension:'png'},{index:1,role:'preview',mime:'image/jpeg',format:null,extension:'jpg'},{index:1,role:'mesh',mime:'application/octet-stream',format:'fbx',extension:'fbx'}])
test('live exact token/file retains expiry-only storage: '+JSON.stringify(options),async()=>{
  const f=fixture(options);try{assert.deepEqual(await f.run(),{reconciled:0,pending:0});assert.equal(f.status,'written');assert.equal(f.deleted,0);}finally{f.db.close();}
});

const mutations={
  revoked:f=>f.db.exec("UPDATE output_execution_grants SET status='revoked'"),
  canceled:f=>f.db.exec("UPDATE document_jobs SET status='canceled'"),
  stopped:f=>{f.result.outputModel3dStop={};f.save();},
  expired:f=>{f.result.outputModel3dRecovery.expiresAt='2000-01-01T00:00:00.000Z';f.save();},
  oversized_lease:f=>{f.result.outputModel3dRecovery.expiresAt=new Date(Date.now()+180000).toISOString();f.save();},
  job_expiry:f=>f.db.exec("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'"),
  draft_expiry:f=>f.db.exec("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z'"),
  redacted:f=>f.db.exec("UPDATE private_content SET redacted_at='2020'"),
  private_owner:f=>f.db.exec("UPDATE private_content SET owner_id='other'"),
  job_owner:f=>f.db.exec("UPDATE document_jobs SET owner_id='other'"),
  grant_payer:f=>f.db.exec("UPDATE output_execution_grants SET payer_user_id='other'"),
  grant_actor:f=>f.db.exec("UPDATE output_execution_grants SET actor_user_id='other'"),
  project_context:f=>f.db.exec("UPDATE output_execution_grants SET context_id='context'"),
  project_draft:f=>f.insert('project_resource_scopes',{resource_kind:'content',resource_id:'draft'}),
  removed:f=>f.insert('events',{stream_id:'creative:owner',type:'DocumentRemoved',payload:'{"document_id":"document"}'}),
  normal_lease:f=>f.db.prepare('UPDATE document_jobs SET lease_expires_at=?').run(f.retention),
  later_attempt:f=>f.db.exec('UPDATE output_operation_slots SET attempt_ordinal=1'),
  predecessor:f=>f.db.exec("UPDATE output_operation_slots SET previous_slot_id='earlier'"),
  slot_canceled:f=>f.db.exec("UPDATE output_operation_slots SET status='canceled'"),
  source_identity:f=>f.db.exec("UPDATE output_plan_revisions SET source_digest='other'"),
  lease_job:f=>{f.result.outputModel3dRecovery.jobId='other';f.save();},
  lease_slot:f=>{f.result.outputModel3dRecovery.slotId='other';f.save();},
  lease_client:f=>{f.result.outputModel3dRecovery.clientRequestId='other';f.save();},
  lease_provider:f=>{f.result.outputModel3dRecovery.providerRequestId='other';f.save();},
  lease_digest:f=>{f.result.outputModel3dRecovery.requestDigest='c'.repeat(64);f.save();},
  prepared_digest:f=>{f.result.model3dInputReceipt.requestDigest='c'.repeat(64);f.save();},
  pending_provider:f=>f.db.exec("UPDATE output_provider_calls SET provider_response_id='pending'"),
  wrong_receipt:f=>{f.result.providerSubmissions['forma-model3d-original'].providerRequestId='other';f.save();},
  original_request:f=>{f.request.model3dCostPreview.requestId='other';f.save();},
  manifest_absent:f=>{delete f.result.outputModel3dRecoveryFiles;f.save();},
  manifest_token:f=>{f.result.outputModel3dRecoveryFiles[0].token='other';f.save();},
  manifest_index:f=>{f.result.outputModel3dRecoveryFiles[0].index=1;f.save();},
  manifest_key:f=>{f.result.outputModel3dRecoveryFiles[0].storageKey='other';f.save();},
  manifest_hash:f=>{f.result.outputModel3dRecoveryFiles[0].sha256='c'.repeat(64);f.save();},
  file_hash:f=>{f.result.outputModel3dRecoveryFiles[0].file.sha256='c'.repeat(64);f.save();},
  file_url:f=>{f.result.outputModel3dRecoveryFiles[0].file.url='/api/media/other';f.save();},
  duplicate_file:f=>{f.result.outputModel3dRecoveryFiles.push(f.result.outputModel3dRecoveryFiles[0]);f.save();},
  old_token_key:f=>{f.result.outputModel3dRecovery.token='87654321-1234-4234-8234-123456789abc';f.result.outputModel3dRecoveryFiles[0].token=f.result.outputModel3dRecovery.token;f.save();},
};
for(const [name,mutate] of Object.entries(mutations))test('grace refuses '+name+' without changing original job/call authority',async()=>{
  const f=fixture();try{mutate(f);assert.deepEqual(await f.run(),{reconciled:1,pending:0});assert.equal(f.status,'deleted');assert.equal(f.deleted,1);}finally{f.db.close();}
});

test('grace never resurrects cleanup_pending or changes completed-publication protection',async()=>{
  for(const published of [false,true]){const f=fixture();try{
    f.db.prepare('UPDATE output_native_storage_writes SET status=?,publication_event_id=?').run('cleanup_pending',published?'completion':null);
    f.db.exec("UPDATE output_execution_grants SET status='revoked'");await f.run();
    assert.equal(f.deleted,published?0:1);assert.equal(f.status,published?'cleanup_pending':'deleted');
  }finally{f.db.close();}}
});

test('expired unknown PUT acknowledgement remains pending after metadata-only deletion',async()=>{
  const f=fixture();try{
    f.db.exec("UPDATE output_native_storage_writes SET status='writing',write_acknowledged=0");
    f.result.outputModel3dRecovery.expiresAt='2000-01-01T00:00:00.000Z';f.save();
    assert.deepEqual(await f.run(),{reconciled:0,pending:1});assert.equal(f.deleted,1);assert.equal(f.status,'cleanup_pending');
  }finally{f.db.close();}
});

test('grace is not a current-source proof: unrelated body changes cannot grant writes or publication',async()=>{
  const f=fixture();try{
    // Explicit limitation: cleanup does not reconstruct current source contents.
    // Publisher live proofs remain responsible for refusing this source drift.
    f.insert('events',{stream_id:'creative:owner',type:'BlockUpdated',payload:'{"changed":true}'});
    await f.run();assert.equal(f.status,'written');assert.equal(f.deleted,0);
    assert.ok(!guard.includes('retainedModel3dRecoveryStorageSql'));
  }finally{f.db.close();}
});

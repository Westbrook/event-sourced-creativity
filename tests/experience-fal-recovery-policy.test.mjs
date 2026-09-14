import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { retainedPersonalFalRecoverySql } from '../worker/output-fal-recovery-policy.ts';
import { readFalRecoveryCheckpoint } from '../worker/output-fal-recovery-policy.ts';
import { compileSqliteExpressionDepth } from './helpers/d1-expression-depth.mjs';

// Isolated SQL policy/lease metadata. No grant is admitted, no provider responds,
// no artifact is created, and these rows are not runtime acceptance evidence.
const future='9999-12-31T23:59:59.999Z',past='2000-01-01T00:00:00.000Z';
function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,actor_user_id TEXT,context_id TEXT,status TEXT,expires_at TEXT);
    CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,grant_id TEXT,plan_revision_id TEXT,job_id TEXT,provider TEXT,model TEXT,attempt_ordinal INTEGER,previous_slot_id TEXT,status TEXT);
    CREATE TABLE output_plan_revisions(scope_key TEXT,plan_revision_id TEXT,scope_kind TEXT,organization_id TEXT,project_access_id TEXT,owner_user_id TEXT,document_id TEXT);
    CREATE TABLE document_jobs(job_id TEXT,owner_id TEXT,document_id TEXT,stream_id TEXT,kind TEXT,status TEXT,expires_at TEXT,result_json TEXT,lease_expires_at TEXT);
    CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,status TEXT,provider_response_id TEXT,client_request_id TEXT,request_digest TEXT);
    CREATE TABLE private_content(content_id TEXT,owner_id TEXT,kind TEXT,redacted_at TEXT,expires_at TEXT);
    CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);`);
  const checkpoint={version:'output-fal-checkpoint-v1',provider:'fal',model:'ideogram/v4',stage:'image:initial',clientRequestId:'original-client',requestDigest:'a'.repeat(64),requestRef:'request',planningRef:'planning',requestSha256:'b'.repeat(64),planningSha256:'c'.repeat(64),expiresAt:future};
  db.prepare('INSERT INTO output_execution_grants VALUES(?,?,?,?,?,?)').run('scope','grant','actor',null,'active',past);
  db.prepare('INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?,?,?,?)').run('scope','slot','grant','plan','job','fal','ideogram/v4',0,null,'uncertain');
  db.prepare('INSERT INTO output_plan_revisions VALUES(?,?,?,?,?,?,?)').run('scope','plan','personal',null,null,'actor','document');
  db.prepare('INSERT INTO document_jobs VALUES(?,?,?,?,?,?,?,?,?)').run('job','actor','document','creative:actor','generate','failed',future,JSON.stringify({outputFalCheckpoint:checkpoint}),null);
  db.prepare('INSERT INTO output_provider_calls VALUES(?,?,?,?,?,?,?,?,?,?)').run('scope','slot','image:initial','image:initial','fal','ideogram/v4','uncertain','recorded-id','original-client','a'.repeat(64));
  for(const [id,kind] of [['request','prompt'],['planning','provider-output']])db.prepare('INSERT INTO private_content VALUES(?,?,?,?,?)').run(id,'actor',kind,null,future);
  return {db,checkpoint};
}
test('expiry cleanup exception matches only the single original personal Fal checkpoint and recorded call',async()=>{
  const source=await readFile(new URL('../worker/output-execution-control.ts',import.meta.url),'utf8');
  const start=source.indexOf('UPDATE output_execution_grants SET status=\'revoked\'');assert.ok(start>=0);
  const end=source.indexOf('`)',start),sql=source.slice(start,end).replace('${retainedPersonalFalRecoverySql}',retainedPersonalFalRecoverySql);
  const modes=[null,"UPDATE output_plan_revisions SET scope_kind='project'","UPDATE output_execution_grants SET context_id='context'",
    "UPDATE output_execution_grants SET status='revoked'","UPDATE output_operation_slots SET provider='openai'","UPDATE output_operation_slots SET model='other'",
    "UPDATE output_operation_slots SET attempt_ordinal=1","UPDATE document_jobs SET kind='render_document'","UPDATE document_jobs SET status='canceled'",
    "UPDATE output_provider_calls SET provider_response_id=NULL","UPDATE output_provider_calls SET provider_response_id='pending'","UPDATE output_provider_calls SET request_digest='changed'",
    "UPDATE private_content SET redacted_at='removed' WHERE content_id='request'",`UPDATE private_content SET expires_at='${past}' WHERE content_id='planning'`,
    "INSERT INTO project_resource_scopes VALUES('content','request')","INSERT INTO output_operation_slots SELECT scope_key,'second',grant_id,plan_revision_id,'second-job',provider,model,0,NULL,status FROM output_operation_slots"];
  for(const mutation of modes){const {db}=fixture();try{if(mutation)db.exec(mutation);db.prepare(sql).run('scope','grant','actor',future);
    assert.equal(db.prepare('SELECT status FROM output_execution_grants').get().status,mutation?'revoked':'active',mutation??'exact');
    // Expired means no paid-dispatch deadline even while the receipt is retained.
    assert.equal(db.prepare("SELECT expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AS dispatch FROM output_execution_grants").get().dispatch,0);
  }finally{db.close();}}
});
test('original checkpoint parser rejects changed identity, missing hashes and extra private fields',()=>{
  const {db,checkpoint}=fixture();db.close();assert.deepEqual(readFalRecoveryCheckpoint(checkpoint),checkpoint);
  for(const changed of [{...checkpoint,model:'other'},{...checkpoint,requestDigest:''},{...checkpoint,planningRef:checkpoint.requestRef},{...checkpoint,rawPrompt:'private'},{...checkpoint,stage:'planning:initial'}])assert.equal(readFalRecoveryCheckpoint(changed),null);
});
test('actual recovery lease SQL is single-flight, rejects stale CAS and active worker, and allows a later expired-lease attempt',async()=>{
  const source=await readFile(new URL('../worker/output-fal-recovery.ts',import.meta.url),'utf8');
  const start=source.indexOf("UPDATE document_jobs SET result_json=json_set(COALESCE(result_json,'{}'),'$.outputFalRecovery',json(?))"),end=source.indexOf('`)',start);assert.ok(start>=0&&end>start);const sql=source.slice(start,end);
  const {db}=fixture();try{
    const original=db.prepare('SELECT result_json FROM document_jobs').get().result_json;
    const lease={version:'output-fal-recovery-v1',token:'first',expiresAt:future};
    assert.equal(db.prepare(sql).run(JSON.stringify(lease),'job','actor',original).changes,1);
    assert.equal(db.prepare(sql).run(JSON.stringify({...lease,token:'second'}),'job','actor',original).changes,0);
    let current=db.prepare('SELECT result_json FROM document_jobs').get().result_json;
    assert.equal(db.prepare(sql).run(JSON.stringify({...lease,token:'second'}),'job','actor',current).changes,0);
    db.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputFalRecovery.expiresAt',?)").run(past);
    current=db.prepare('SELECT result_json FROM document_jobs').get().result_json;
    db.prepare('INSERT INTO document_jobs SELECT ?,owner_id,document_id,stream_id,kind,?,expires_at,?,? FROM document_jobs').run('competitor','running','{}',future);
    assert.equal(db.prepare(sql).run(JSON.stringify({...lease,token:'second'}),'job','actor',current).changes,0);
    db.exec("DELETE FROM document_jobs WHERE job_id='competitor'");
    assert.equal(db.prepare(sql).run(JSON.stringify({...lease,token:'second'}),'job','actor',current).changes,1);
    assert.equal(db.prepare("SELECT status FROM document_jobs WHERE job_id='job'").get().status,'failed');
  }finally{db.close();}
});

test('actual storage cleanup protects only the current recovery storage key, never an older token, expiry or revocation',async()=>{
  const source=await readFile(new URL('../worker/output-private-execution.ts',import.meta.url),'utf8');
  const start=source.indexOf("WITH retained_fal_grants AS MATERIALIZED ("),end=source.indexOf('`)',start);assert.ok(start>=0&&end>start);
  const sql=source.slice(start,end).replace('${retainedPersonalFalRecoverySql}',retainedPersonalFalRecoverySql);
  for(const mode of ['current','older','expired','revoked']){const {db}=fixture();try{
    db.exec("ALTER TABLE document_jobs ADD COLUMN source_surface TEXT; ALTER TABLE document_jobs ADD COLUMN request_json TEXT");
    db.exec("CREATE TABLE output_native_storage_writes(scope_key TEXT,slot_id TEXT,storage_key TEXT,status TEXT,publication_event_id TEXT,updated_at TEXT)");
    const token='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',key=`u-6163746f72/generated/generation-recovery-${token}.png`;
    const oldKey='u-6163746f72/generated/generation-recovery-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.png';
    const recovery={version:'output-fal-recovery-v1',token,storageKey:key,clientRequestId:'original-client',expiresAt:mode==='expired'?past:future};
    db.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.outputFalRecovery',json(?))").run(JSON.stringify(recovery));
    if(mode==='revoked')db.exec("UPDATE output_execution_grants SET status='revoked'");
    db.prepare('INSERT INTO output_native_storage_writes VALUES(?,?,?,?,NULL,?)').run('scope','slot',mode==='older'?oldKey:key,'written','');
    const compiled=compileSqliteExpressionDepth(db,sql);assert.equal(compiled.ok,true,compiled.error);assert.equal(compiled.limit,100);
    db.prepare(sql).run('actor',future,future,'actor','actor',null,null,1);
    assert.equal(db.prepare('SELECT status FROM output_native_storage_writes').get().status,mode==='current'?'written':'cleanup_pending',mode);
  }finally{db.close();}}
});

test('recovered payload uses shared original format, actual contract size and original planning/context provenance',async()=>{
  const {falRecoveryEventProvenance}=await import('../worker/output-fal-recovery-policy.ts');
  const {createOutputFalImageContract}=await import('../src/model/output-fal-image-contract.ts');
  const {imageFormatEventFields}=await import('../src/model/image-format.ts');
  const contract=createOutputFalImageContract('ideogram/v4','1024x1024');
  const render={size:'1024x1024',format:{aspect_ratio:{width:1,height:1},dimensions:{width:1024,height:1024,unit:'px'}}};
  const original={context_hash:'original-context-hash',image_format_block_id:null};
  const fields=falRecoveryEventProvenance(contract,render,original,'provider');
  assert.deepEqual(fields,{...imageFormatEventFields(render.format,'full'),provider_render_size:'1024x1024',size:'1024x1024',context_hash:original.context_hash,planning_source:'provider',planning_cache_hit:false});
  assert.throws(()=>falRecoveryEventProvenance(contract,{...render,size:'1536x1536'},original,'provider'));
  assert.throws(()=>falRecoveryEventProvenance(contract,render,{},'provider'));
  assert.throws(()=>falRecoveryEventProvenance(contract,render,original,'fan-cache'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {outputTestDatabase,registerOutputSourceImports} from './output-server-test-helpers.mjs';
const imports=registerOutputSourceImports();test.after(()=>imports.deregister());
const {handleSession,POLICY_VERSION}=await import('../worker/pilot-policy.ts');
const {handleDocumentJobs}=await import('../worker/document-jobs-api.ts');
const {ensureOutputRequirementsSchema}=await import('../worker/output-requirements-ledger.ts');
async function fixture(t){
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());
 assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
 f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
 await ensureOutputRequirementsSchema(f.env);
 const owner='dev-local-creative',stream='creative:'+owner,now=new Date().toISOString(),expiry=new Date(Date.now()+86400000).toISOString();
 const call={clientRequestId:'client',provider:'openai',operation:'planning',model:'fixture-model',status:'completed',providerRequestId:'response',responseRef:'response-content'};
 const result={providerSubmissions:{client:call},artifactKind:'audio'};
 f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,expires_at,updated_at)
 VALUES(?,?,?,'document','render_document','failed','document','job',0,?,?,1,?,?,?)`).run('job',owner,stream,JSON.stringify({artifactKind:'audio'}),JSON.stringify(result),now,expiry,now);
 const raw={id:'response',model:call.model,status:'completed',output:[{id:'reason',type:'reasoning',summary:[],encrypted_content:null},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'SECRET RESPONSE'}]}]};
 const envelope={job_id:'job',document_id:'document',stream_id:stream,artifact_kind:'audio',response_id:'response',call,raw_envelope:JSON.stringify(raw)};
 const insert=f.sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)');
 insert.run('source-content',owner,'document-artifact-input',JSON.stringify({job_id:'job',document_id:'document',secret:'SECRET SOURCE'}),now,expiry);
 insert.run('response-content',owner,'provider-response',JSON.stringify(envelope),now,expiry);
 const request=()=>handleDocumentJobs(new Request('http://localhost/api/document-jobs/job?inspection=1'),f.env,'job');
 return{...f,request};
}
test('actual personal inspection returns bounded shape only and never mutates receipts',async t=>{
 const f=await fixture(t),before=f.sqlite.prepare('SELECT * FROM document_jobs').get();
 t.mock.method(globalThis,'fetch',()=>{throw Error('No network allowed');});
 const r=await f.request();assert.equal(r.status,200);const body=await r.json();
 assert.deepEqual(body.job.result.plannerResponseDiagnostics,[{responseId:'response',valid:true,issues:[],reasoningEncryptedContent:true}]);
 assert.doesNotMatch(JSON.stringify(body),/SECRET|raw_envelope|response-content/);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM document_jobs').get(),before);
});
for(const [name,sql] of [
 ['response redacted',"UPDATE private_content SET redacted_at='now' WHERE content_id='response-content'"],
 ['source removed',"DELETE FROM private_content WHERE content_id='source-content'"],
 ['response changed',"UPDATE private_content SET content='{}' WHERE content_id='response-content'"],
 ['source changed',"UPDATE private_content SET content='{}' WHERE content_id='source-content'"],
 ['permission revoked',"UPDATE users SET role='viewer',updated_at='changed'"],
 ['job changed',"UPDATE document_jobs SET result_json='{}' WHERE job_id='job'"],
 ['expired',"UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z'"],
])test('final disclosure blocks '+name+' during read',async t=>{
 const f=await fixture(t),prepare=f.DB.prepare.bind(f.DB);let mutated=false;
 f.DB.prepare=(query)=>{if(query.startsWith('WITH candidate_principal')){f.sqlite.exec(sql);mutated=true;}return prepare(query);};
 const r=await f.request();assert.equal(r.status,200);assert.deepEqual((await r.json()).job.result.plannerResponseDiagnostics,[]);assert.equal(mutated,true);
});

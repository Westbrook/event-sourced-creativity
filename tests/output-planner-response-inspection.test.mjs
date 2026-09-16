import test from 'node:test';
import assert from 'node:assert/strict';
import {outputTestDatabase,registerOutputSourceImports} from './output-server-test-helpers.mjs';
const imports=registerOutputSourceImports();test.after(()=>imports.deregister());
const {handleSession,POLICY_VERSION}=await import('../worker/pilot-policy.ts');
const {handleDocumentJobs}=await import('../worker/document-jobs-api.ts');
const {ensureOutputRequirementsSchema}=await import('../worker/output-requirements-ledger.ts');
async function fixture(t,kind='audio'){
 const f=outputTestDatabase();t.after(()=>f.sqlite.close());
 assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
 f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
 await ensureOutputRequirementsSchema(f.env);
 const owner='dev-local-creative',stream='creative:'+owner,now=new Date().toISOString(),expiry=new Date(Date.now()+86400000).toISOString();
 const call={clientRequestId:'client',provider:'openai',operation:'planning',model:'fixture-model',status:'completed',providerRequestId:'response',responseRef:'response-content'};
 const result={providerSubmissions:{client:call},artifactKind:kind};
 f.sqlite.prepare(`INSERT INTO document_jobs(job_id,owner_id,stream_id,document_id,kind,status,source_surface,correlation_id,requested_sequence,request_json,result_json,attempt_count,requested_at,expires_at,updated_at)
 VALUES(?,?,?,'document','render_document','failed','document','job',0,?,?,1,?,?,?)`).run('job',owner,stream,JSON.stringify({artifactKind:kind}),JSON.stringify(result),now,expiry,now);
 const raw={id:'response',model:call.model,status:'completed',output:[{id:'reason',type:'reasoning',summary:[],encrypted_content:null},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'SECRET RESPONSE'}]}]};
 let envelope={job_id:'job',document_id:'document',stream_id:stream,artifact_kind:kind,response_id:'response',call,raw_envelope:JSON.stringify(raw)};
 if(kind==='storyboard'){
  const {createStoryboardOutputContract}=await import('../src/model/output-storyboard-contract.ts');
  call.model='gpt-5.6-terra';
  f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(result));
  const candidate=JSON.stringify({title:'SECRET TITLE',summary:'SECRET SUMMARY',content_markdown:'SECRET STORY',items:Array.from({length:4},()=>({title:'SECRET',body:'SECRET',notes:'SECRET',image_prompt:'SECRET',context_group_ids:[]}))});
  const body={id:'response',model:call.model,status:'completed',output_text:candidate,usage:{input_tokens:1,output_tokens:2,total_tokens:3}};
  const contract=createStoryboardOutputContract({draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(candidate))),n=>n.toString(16).padStart(2,'0')).join('');
  envelope={...envelope,provider_envelope:JSON.stringify(body),output_text:candidate,content_sha256:hash,output_storyboard:contract};delete envelope.raw_envelope;
 }
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
test('Storyboard inspection validates retained raw candidate without revealing creative text or mutating accounting',async t=>{
 const f=await fixture(t,'storyboard'),before=f.sqlite.prepare('SELECT * FROM document_jobs').get();
 t.mock.method(globalThis,'fetch',()=>{throw Error('No network allowed');});
 const response=await f.request();assert.equal(response.status,200);const body=await response.json();
 const [diagnostic]=body.job.result.plannerResponseDiagnostics;
 const {candidateFields,contractValid,planValid,envelopeIssues,...core}=diagnostic;
 assert.deepEqual(core,{responseId:'response',valid:true,issues:[],reasoningEncryptedContent:false,candidateParses:true,frameCount:4,presentationField:'absent',slideFields:['absent','absent','absent','absent']});
 assert.equal(contractValid,true);assert.equal(planValid,true);
 assert.deepEqual(envelopeIssues,['output_missing','message_count_invalid']);
 assert.deepEqual(candidateFields.title,{type:'string',length:12,blank:false});
 assert.equal(candidateFields.extraFieldCount,0);assert.equal(candidateFields.frames.length,4);
 assert.ok(candidateFields.frames.every(frame=>frame.contextGroupCount===0&&frame.extraFieldCount===0));
 assert.doesNotMatch(JSON.stringify(body),/SECRET|provider_envelope|response-content/);assert.deepEqual(f.sqlite.prepare('SELECT * FROM document_jobs').get(),before);
});
test('Storyboard reasoning encryption presence is accurate without exposing opaque bytes',async t=>{
 const f=await fixture(t,'storyboard');
 const row=f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='response-content'").get(),retained=JSON.parse(row.content),envelope=JSON.parse(retained.provider_envelope);
 envelope.output=[{type:'reasoning',id:'reason',summary:[],encrypted_content:'PRIVATE OPAQUE BYTES'},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:retained.output_text}]}];
 retained.provider_envelope=JSON.stringify(envelope);f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id='response-content'").run(JSON.stringify(retained));
 const body=await(await f.request()).json();assert.equal(body.job.result.plannerResponseDiagnostics[0].reasoningEncryptedContent,true);
 assert.equal(body.job.result.plannerResponseDiagnostics[0].valid,true);assert.doesNotMatch(JSON.stringify(body),/PRIVATE|OPAQUE|SECRET/);
});
test('grouped Storyboard diagnostics distinguish missing original-request witness from invalid creative output',async t=>{
 const f=await fixture(t,'storyboard');
 const row=f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='response-content'").get(),retained=JSON.parse(row.content),envelope=JSON.parse(retained.provider_envelope),candidate=JSON.parse(retained.output_text);
 candidate.items[0].context_group_ids=['context_group_1'];
 retained.output_text=JSON.stringify(candidate);envelope.output_text=retained.output_text;retained.provider_envelope=JSON.stringify(envelope);
 retained.content_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(retained.output_text))),n=>n.toString(16).padStart(2,'0')).join('');
 f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id='response-content'").run(JSON.stringify(retained));
 const before=f.sqlite.prepare('SELECT * FROM document_jobs').get();
 t.mock.method(globalThis,'fetch',()=>{throw Error('No network allowed');});
 const body=await(await f.request()).json(),diagnostic=body.job.result.plannerResponseDiagnostics[0];
 assert.equal(diagnostic.valid,false);assert.equal(diagnostic.planValid,null);
 assert.deepEqual(diagnostic.issues,['storyboard_original_request_witness_required']);
 assert.doesNotMatch(JSON.stringify(body),/SECRET|context_group_1/);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM document_jobs').get(),before);
});
for(const sql of ["UPDATE private_content SET content=json_set(content,'$.content_sha256','wrong') WHERE content_id='response-content'","UPDATE private_content SET content=json_set(content,'$.response_id','wrong') WHERE content_id='response-content'"])
test('Storyboard inspection refuses changed hash or response identity '+sql,async t=>{const f=await fixture(t,'storyboard');f.sqlite.exec(sql);assert.deepEqual((await(await f.request()).json()).job.result.plannerResponseDiagnostics,[]);});
for(const [name,sql] of [
 ['response redacted',"UPDATE private_content SET redacted_at='now' WHERE content_id='response-content'"],
 ['source removed',"DELETE FROM private_content WHERE content_id='source-content'"],
 ['response changed',"UPDATE private_content SET content='{}' WHERE content_id='response-content'"],
 ['source changed',"UPDATE private_content SET content='{}' WHERE content_id='source-content'"],
 ['permission revoked',"UPDATE users SET role='viewer',updated_at='changed'"],
 ['job changed',"UPDATE document_jobs SET result_json='{}' WHERE job_id='job'"],
 ['expired',"UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z'"],
])for(const kind of ['audio','storyboard'])test('final disclosure blocks '+name+' during '+kind+' read',async t=>{
 const f=await fixture(t,kind),prepare=f.DB.prepare.bind(f.DB);let mutated=false;
 f.DB.prepare=(query)=>{if(query.startsWith('WITH candidate_principal')){f.sqlite.exec(sql);mutated=true;}return prepare(query);};
 const r=await f.request();assert.equal(r.status,200);assert.deepEqual((await r.json()).job.result.plannerResponseDiagnostics,[]);assert.equal(mutated,true);
});

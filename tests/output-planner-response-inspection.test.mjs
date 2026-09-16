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
async function groupedWitnessFixture(t,groups=['context_group_1']){
 const f=await fixture(t,'storyboard');
 const retained=JSON.parse(f.sqlite.prepare("SELECT content FROM private_content WHERE content_id='response-content'").get().content);
 const {prepareStoryboardPlannerRequest}=await import('../worker/openai-adapter.ts');
 const source={documentTitle:'SECRET TITLE',snapshot:{document:{id:'document',title:'SECRET TITLE'},facts:[{block_id:'keeper',type:'subject',active:true,instruction:'SECRET SOURCE'},{block_id:'style',type:'style',active:true,instruction:'SECRET STYLE'}],relationships:[{from_block_id:'keeper',to_block_id:'style',kind:'context_contains'}]},options:{itemCount:4,productionMode:'manual'}};
 const prepared=await prepareStoryboardPlannerRequest({},'dev-local-creative',source,retained.output_storyboard);
 const candidate=JSON.parse(retained.output_text);for(const frame of candidate.items)frame.context_group_ids=groups;
 retained.output_text=JSON.stringify(candidate);const envelope=JSON.parse(retained.provider_envelope);envelope.output_text=retained.output_text;retained.provider_envelope=JSON.stringify(envelope);
 retained.content_sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(retained.output_text))),n=>n.toString(16).padStart(2,'0')).join('');
 const job=f.sqlite.prepare('SELECT * FROM document_jobs').get(),result=JSON.parse(job.result_json),call=result.providerSubmissions.client;
 call.requestDigest=prepared.requestDigest;retained.call=call;
 result.outputStoryboardPlannerCheckpoint={version:'output-storyboard-planner-checkpoint-v1',clientRequestId:'client',stage:'planning:0:initial',provider:'openai',model:call.model,requestDigest:prepared.requestDigest,requestRef:'original-prompt',contract:retained.output_storyboard,expiresAt:job.expires_at};
 const request={artifactKind:'storyboard',outputStoryboard:retained.output_storyboard,outputStoryboardPlanner:{contract:retained.output_storyboard,requestDigest:prepared.requestDigest,maximumInputTokens:prepared.maximumInputTokens}};
 f.sqlite.prepare('UPDATE document_jobs SET request_json=?,result_json=?').run(JSON.stringify(request),JSON.stringify(result));
 // Use the real derived slot relation, retaining all schema foreign keys.
 const now=job.requested_at,later=job.expires_at,scope='personal:dev-local-creative:fixture';
 f.sqlite.prepare("INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,type,payload) VALUES('inspection-anchor',?,1,?,?,'worker:fixture','fixture','fixture','FixtureRecorded','{}')").run(job.stream_id,now,now);
 f.sqlite.prepare("INSERT INTO output_plan_revisions(scope_key,scope_kind,owner_user_id,project_id,document_id,plan_revision_id,plan_id,revision,confirmed_event_id,requirements_digest,source_digest,resolver_version,source_head,target_count,created_at) VALUES(?,'personal',?,'fixture','document','plan','document',1,'inspection-anchor','req','source','v1',0,1,?)").run(scope,job.owner_id,now);
 f.sqlite.prepare("INSERT INTO output_plan_targets VALUES(?,'plan','target','contract','image',1,1,0)").run(scope);
 f.sqlite.prepare("INSERT INTO output_preflights VALUES(?,'preflight','plan',?,'terms','inspection-anchor',?,?)").run(scope,job.owner_id,later,now);
 f.sqlite.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,context_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,'grant','plan',?,?,NULL,'preflight','inspection-anchor',100,5,'completed',?,?)").run(scope,job.owner_id,job.owner_id,later,now);
 f.sqlite.prepare("INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,status,created_at,updated_at) VALUES(?,'original-slot','grant','plan','target','contract','source','fal','fixture-model','route','job','cost','tokens',100,5,1000,'failed',?,?)").run(scope,now,now);
 f.sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)').run('original-prompt',job.owner_id,'prompt',prepared.requestBody,job.requested_at,job.expires_at);
 f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id='response-content'").run(JSON.stringify(retained));
 return f;
}
for(const [groups,expected] of [[['context_group_1'],null],[['FOREIGN PRIVATE ALIAS'],'context_group_unknown'],[['context_group_1','context_group_1'],'context_group_duplicate']])test('original request witness diagnoses grouped retained plan '+String(expected),async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No network allowed');});
 const f=await groupedWitnessFixture(t,groups),before=f.sqlite.prepare('SELECT * FROM document_jobs').get(),privateBefore=f.sqlite.prepare('SELECT * FROM private_content ORDER BY content_id').all();
 const body=await(await f.request()).json(),diagnostic=body.job.result.plannerResponseDiagnostics[0];
 assert.equal(diagnostic.planValid,expected===null);assert.equal(diagnostic.valid,expected===null);assert.deepEqual(diagnostic.issues,expected?[expected]:[]);
 assert.doesNotMatch(JSON.stringify(body),/SECRET|PRIVATE ALIAS|context_group_1|original-prompt|provider_envelope/);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM document_jobs').get(),before);assert.deepEqual(f.sqlite.prepare('SELECT * FROM private_content ORDER BY content_id').all(),privateBefore);
});
for(const [name,sql] of [
 ['missing',"DELETE FROM private_content WHERE content_id='original-prompt'"],
 ['slot missing',"DELETE FROM output_operation_slots WHERE slot_id='original-slot'"],
 ['changed bytes',"UPDATE private_content SET content=content||' ' WHERE content_id='original-prompt'"],
 ['foreign owner',"UPDATE private_content SET owner_id='other' WHERE content_id='original-prompt'"],
 ['redacted',"UPDATE private_content SET redacted_at='now' WHERE content_id='original-prompt'"],
 ['expired',"UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id='original-prompt'"],
 ['wrong receipt digest',"UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions.client.requestDigest','wrong')"],
 ['wrong execution digest',"UPDATE document_jobs SET request_json=json_set(request_json,'$.outputStoryboardPlanner.requestDigest','wrong')"],
])test('unavailable original witness remains unknown: '+name,async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No network allowed');});
 const f=await groupedWitnessFixture(t);f.sqlite.exec(sql);
 const body=await(await f.request()).json(),diagnostic=body.job.result.plannerResponseDiagnostics[0];
 assert.equal(diagnostic.planValid,null);assert.deepEqual(diagnostic.issues,['storyboard_original_request_witness_required']);assert.doesNotMatch(JSON.stringify(body),/SECRET|context_group_1|original-prompt/);
});
for(const [name,sql] of [
 ['prompt deleted',"DELETE FROM private_content WHERE content_id='original-prompt'"],
 ['slot removed',"DELETE FROM output_operation_slots WHERE slot_id='original-slot'"],
 ['slot reassigned',"UPDATE output_operation_slots SET job_id='another-job' WHERE slot_id='original-slot'"],
 ['prompt changed',"UPDATE private_content SET content=content||' ' WHERE content_id='original-prompt'"],
 ['prompt redacted',"UPDATE private_content SET redacted_at='now' WHERE content_id='original-prompt'"],
 ['prompt expired',"UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id='original-prompt'"],
 ['prompt reassigned',"UPDATE private_content SET owner_id='other' WHERE content_id='original-prompt'"],
 ['checkpoint replaced',"UPDATE document_jobs SET result_json=json_set(result_json,'$.outputStoryboardPlannerCheckpoint.requestRef','other')"],
])test('final grouped diagnostic disclosure refuses '+name,async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No network allowed');});
 const f=await groupedWitnessFixture(t),prepare=f.DB.prepare.bind(f.DB);let mutated=false;
 f.DB.prepare=query=>{if(query.startsWith('WITH candidate_principal')){f.sqlite.exec(sql);mutated=true;}return prepare(query);};
 const response=await f.request();assert.equal(response.status,200);assert.deepEqual((await response.json()).job.result.plannerResponseDiagnostics,[]);assert(mutated);
});
test('inspection starting with a cold DB handle loads durable slot and hides private checkpoints',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No network allowed');});
 const f=await groupedWitnessFixture(t),{outputSchemaIsReady}=await import('../worker/output-schema-state.ts');
 const cold={prepare:f.DB.prepare.bind(f.DB),batch:f.DB.batch.bind(f.DB)};f.env.DB=cold;
 assert.equal(outputSchemaIsReady(cold),false);
 const before=f.sqlite.prepare('SELECT * FROM document_jobs').get(),body=await(await f.request()).json();
 assert.equal(body.job.result.plannerResponseDiagnostics[0].planValid,true);
 assert.doesNotMatch(JSON.stringify(body),/SECRET|original-prompt|outputStoryboardPlannerCheckpoint|context_group_1|provider_envelope/);
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

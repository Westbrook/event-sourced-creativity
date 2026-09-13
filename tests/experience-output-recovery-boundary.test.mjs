import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

test('actual recovery handler rejects GET and paid-Run-shaped bodies before intake, DB or provider work',async()=>{
  const source=await readFile(new URL('../worker/experience-output-api.ts',import.meta.url),'utf8');
  const prelude=source.slice(source.indexOf('const record ='),source.indexOf('async function refused('));
  const handler=source.slice(source.indexOf('export async function handleExperienceOutput(')).replace('export async function','async function');
  const body=stripTypeScriptTypes(prelude+'\n'+handler)+'\n;return handleExperienceOutput;';
  const run=new Function('readExperienceBody',body)(request=>request.json());
  // Undefined execution dependencies deliberately fail if either refusal crosses
  // the real pre-intake method/body boundary. No fake admission chain is supplied.
  const url='https://forma.test/api/experiences/drafts/experience-draft-'+ 'a'.repeat(64)+'/output/recover-result';
  const get=await run(new Request(url),{}, {}, {});assert.equal(get.status,405);assert.equal((await get.json()).error,'method_not_allowed');
  const post=await run(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draftHash:'hash',grantId:'grant',explicitRun:true})}),{}, {}, {});
  assert.equal(post.status,400);assert.equal((await post.json()).error,'experience_output_request_invalid');
});


// Actual handler + recovery driver + SQLite event writer. Auth/intake, command
// receipts and state disclosure are explicit fixture ports, not HTTP admission.
async function videoBoundary(){
 const {videoRecoveryFixture}=await import('./output-video-recovery-fixture.mjs');
 const {executeOutputVideoRecovery}=await import('../worker/output-video-recovery.ts');
 const {outputSourceEpochAssertion}=await import('../worker/output-requirements-ledger.ts');
 const f=await videoRecoveryFixture(),source=await readFile(new URL('../worker/experience-output-api.ts',import.meta.url),'utf8');
 const prelude=source.slice(source.indexOf('const record ='),source.indexOf('async function refused('));
 const handler=source.slice(source.indexOf('export async function handleExperienceOutput(')).replace('export async function','async function');
 const loaded={binding:{output:'video',draftHash:'draft',releaseHash:'release',streamId:f.job.stream_id,documentId:f.job.document_id},retained:{plan:{request:{experienceId:'video'}}},originals:{},trusted:{scope:f.scope,principal:f.user,ownerHead:1,sourceDigest:'source',sourceAssertions:[...f.assertions,
  {sql:'(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?',bindings:[f.job.stream_id,1]},
  {sql:'COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?',bindings:[f.job.stream_id,1]}]}};
 const state={original:{run:{},grantId:'grant',jobId:'job',jobStatus:'failed'},permitted:{recoverResult:true}};
 let recoveryCalls=0;
 const ports={readExperienceBody:r=>r.json(),load:async()=>loaded,state:async()=>state,registeredExperience:async()=>({releaseHash:'release'}),error:(code,status=409)=>{throw Object.assign(Error(code),{code,status});},outputSourceEpochAssertion,
  recoverOutputFalImage:()=>{throw Error('Video must not enter Image recovery');},recoverOutputVideo:async(env,user,job,options)=>{recoveryCalls++;return executeOutputVideoRecovery({...env,FAL_KEY:'offline-test-key'},user,job,f.binding,options);},
  outputExperienceCommands:{disclose:async(_trusted,value)=>Response.json(value)}};
 const run=new Function(...Object.keys(ports),stripTypeScriptTypes(prelude+'\n'+handler)+'\nreturn handleExperienceOutput;')(...Object.values(ports));
 const request=(patch={},action='recover-result')=>new Request('https://forma.test/api/experiences/drafts/experience-draft-'+'a'.repeat(64)+'/output/'+action,{method:'POST',body:JSON.stringify({draftHash:'draft',grantId:'grant',jobId:'job',explicitRecovery:true,...patch})});
 return {...f,loaded,state,request,handle:r=>run(r,f.env,{},{}),calls:()=>recoveryCalls};
}

test('actual Video recovery handler joins the original GET-only driver without paid Run',async()=>{
 const f=await videoBoundary(),priorFetch=globalThis.fetch;let gets=0;
 globalThis.fetch=async(url,init)=>{assert.equal(init.method,'GET');gets++;if(String(url).endsWith('/status'))return Response.json({request_id:'video_original',status:'COMPLETED'});
  if(String(url)==='https://fal.media/original.mp4')return new Response(f.original.bytes,{headers:{'content-type':'video/mp4'}});
  return Response.json({request_id:'video_original',video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:f.original.bytes.length}});};
 try{const response=await f.handle(f.request());assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).recovery,'completed');assert.equal(gets,3);assert.equal(f.calls(),1);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'completed');}
 finally{globalThis.fetch=priorFetch;f.close();}
});

for(const refusal of ['explicit','job','grant','unavailable','head'])test(`actual Video recovery handler refuses ${refusal} before recovery`,async()=>{
 const f=await videoBoundary();try{
  const patch=refusal==='explicit'?{explicitRecovery:false}:refusal==='job'?{jobId:'foreign'}:refusal==='grant'?{grantId:'foreign'}:{};
  if(refusal==='unavailable')f.state.permitted.recoverResult=false;
  if(refusal==='head')f.loaded.trusted.sourceAssertions.at(-1).bindings[1]=2;
  const response=await f.handle(f.request(patch));assert.equal(response.status,403);assert.equal(f.calls(),0);
 }finally{f.close();}
});

for(const condition of ['available','canceled','active_lease','expired','unknown_request','redacted_request'])test(`actual Video recovery availability SQL: ${condition}`,async()=>{
 const f=await videoBoundary();try{
  const source=await readFile(new URL('../worker/experience-output-api.ts',import.meta.url),'utf8');
  const start=source.indexOf('SELECT 1 AS available FROM document_jobs job'),end=source.indexOf('`)\n',start);assert(start>0&&end>start);const sql=source.slice(start,end);
  if(condition==='canceled')f.sqlite.exec("UPDATE document_jobs SET status='canceled'");
  if(condition==='active_lease')f.sqlite.exec("UPDATE document_jobs SET lease_expires_at='2099-01-01T00:00:00.000Z'");
  if(condition==='expired')f.sqlite.exec("UPDATE document_jobs SET expires_at='2000-01-01T00:00:00.000Z'");
  if(condition==='unknown_request')f.sqlite.exec("UPDATE output_provider_calls SET provider_response_id='unknown' WHERE provider='fal'");
  if(condition==='redacted_request')f.sqlite.exec("UPDATE private_content SET redacted_at='2020-01-01' WHERE content_id=(SELECT json_extract(result_json,'$.outputVideoMediaCheckpoint.requestRef') FROM document_jobs)");
  const row=await f.DB.prepare(sql).bind(f.scope.key,f.slot.slotId,f.job.job_id,f.scope.actorUserId).first();assert.equal(Boolean(row),condition==='available');
 }finally{f.close();}
});

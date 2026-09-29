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
 const loaded={lineage:{witnesses:[]},binding:{output:'video',draftHash:'draft',releaseHash:'release',streamId:f.job.stream_id,documentId:f.job.document_id},retained:{plan:{request:{experienceId:'video'}}},originals:{},trusted:{scope:f.scope,principal:f.user,ownerHead:1,sourceDigest:'source',sourceAssertions:[...f.assertions,
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

// Exact handler dispatch/refusal regression only. Original binding/state and DB
// selection are explicit fixture ports; all recovery services throw sentinels,
// never simulate successful publication or establish source authority.
async function recoveryDispatchBoundary(output,jobStatus='failed'){
 const source=await readFile(new URL('../worker/experience-output-api.ts',import.meta.url),'utf8');
 const prelude=source.slice(source.indexOf('const record ='),source.indexOf('async function refused('));
 const handler=source.slice(source.indexOf('export async function handleExperienceOutput(')).replace('export async function','async function');
 const seen=[],epochs=[],row={job_id:'job',owner_id:'owner',stream_id:'creative:owner',document_id:'document',status:jobStatus};
 let dbReads=0;
 const loaded={binding:{output,draftHash:'draft',releaseHash:'release',streamId:row.stream_id,documentId:row.document_id},
  retained:{plan:{request:{experienceId:output}}},lineage:{witnesses:[]},originals:{},trusted:{principal:{userId:'owner'},
   scope:{actorUserId:'owner'},ownerHead:7,sourceDigest:'source',sourceAssertions:[
    {sql:'(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?',bindings:[row.stream_id,7]},
    {sql:'COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?',bindings:[row.stream_id,7]}]}};
 const state={original:{run:{key:'run',eventId:'run-event'},grantId:'grant',jobId:'job',jobStatus},permitted:{recoverResult:jobStatus==='failed'}};
 const stop=name=>async(_env,_user,job,options)=>{seen.push({name,job,options});throw Object.assign(Error('boundary_selected_'+name),{code:'boundary_selected_'+name,status:409});};
 const ports={readExperienceBody:r=>r.json(),load:async()=>loaded,state:async()=>state,registeredExperience:async()=>({releaseHash:'release'}),
  error:(code,status=409)=>{throw Object.assign(Error(code),{code,status});},
  outputSourceEpochAssertion:(scope,epoch)=>{epochs.push({scope,epoch});return{sql:'fixture_current_source_epoch',bindings:[epoch.head,epoch.sourceDigest]};},
  recoverOutputFalImage:stop('image'),recoverOutputVideo:stop('video'),recoverOutputModel3d:stop('model3d')};
 const run=new Function(...Object.keys(ports),stripTypeScriptTypes(prelude+'\n'+handler)+'\nreturn handleExperienceOutput;')(...Object.values(ports));
 const env={DB:{prepare(sql){assert.match(sql,/^SELECT document_jobs\.\*/);return{bind(...args){assert.deepEqual(args,['job','owner','creative:owner','document']);return{async first(){dbReads++;return row;}};}};}}};
 return {loaded,state,seen,epochs,reads:()=>dbReads,handle:(patch={})=>run(new Request('https://forma.test/api/experiences/drafts/experience-draft-'+'a'.repeat(64)+'/output/recover-result',
  {method:'POST',body:JSON.stringify({draftHash:'draft',grantId:'grant',jobId:'job',explicitRecovery:true,...patch})}),env,{}, {})};
}
for(const output of ['image','video','model3d'])for(const status of ['failed','completed'])
test(`exact recovery dispatch: ${output} ${status} selects only its original service`,async()=>{
 const f=await recoveryDispatchBoundary(output,status),response=await f.handle();
 // Unknown diagnostic codes are deliberately redacted at the public boundary.
 assert.equal(response.status,409);assert.equal((await response.json()).error,'experience_output_unavailable');
 assert.equal(f.seen.length,1);assert.equal(f.seen[0].name,output);assert.equal(f.seen[0].job.status,status);assert.equal(f.reads(),1);
 assert.equal(f.epochs.length,output==='image'?1:2);
 assert(f.seen[0].options.signal instanceof AbortSignal);
});
for(const output of ['scene','slides','short_story','audio','storyboard'])for(const status of ['failed','completed'])
test(`unsupported recovery ${output} ${status} never falls through to Image or another service`,async()=>{
 const f=await recoveryDispatchBoundary(output,status),response=await f.handle();
 assert.equal(response.status,['audio','storyboard'].includes(output)?409:403);
 assert.equal(f.seen.length,0);assert.equal(f.reads(),0);assert.equal(f.epochs.length,0);
});
for(const refusal of ['explicit','job','grant','unavailable','missing-run','head'])
test(`Model3D explicit-original dispatch refuses ${refusal} before service or job lookup`,async()=>{
 const f=await recoveryDispatchBoundary('model3d');
 const patch=refusal==='explicit'?{explicitRecovery:false}:refusal==='job'?{jobId:'foreign'}:refusal==='grant'?{grantId:'foreign'}:{};
 if(refusal==='unavailable')f.state.permitted.recoverResult=false;
 if(refusal==='missing-run')f.state.original.run=null;
 if(refusal==='head')f.loaded.trusted.sourceAssertions[1].bindings[1]=8;
 const response=await f.handle(patch);assert.equal(response.status,403);assert.equal(f.seen.length,0);assert.equal(f.reads(),0);
});

test('actual Model3D state keeps expired quote paid flags closed after final permission assignment, but permits original recovery',async()=>{
 const {fixture}=await import('./helpers/model3d-native-execution-fixture.mjs');
 const {canonicalJson}=await import('../src/experiences/compiler.ts');
 const {readOutputModel3dPayload}=await import('../worker/output-model3d-execution.ts');
 const source=await readFile(new URL('../worker/experience-output-api.ts',import.meta.url),'utf8');
 const exact=source.slice(source.indexOf('async function state(loaded:'),source.indexOf('\nasync function execute(loaded:'));
 assert(exact.startsWith('async function state(')&&exact.includes('return result;'));
 for(const phase of ['authorized','queued','failed','completed']){
  const f=await fixture(),future=new Date(Date.now()+3600000).toISOString();
  f.payload.model3dCostPreview.expiresAt='2000-01-01T00:00:00.000Z';
  const payload=await readOutputModel3dPayload(f.payload);assert(payload);const p=payload.preview;
  const plan={revisionId:'plan',sourceDigest:p.sourceDigest,requirementsDigest:p.requirementsDigest,targetContractDigests:{target:'contract'}};
  const preflight={id:'preflight',planRevisionId:'plan',sourceDigest:p.sourceDigest,requirementsDigest:p.requirementsDigest,termsDigest:'terms',expiresAt:future,
   maximumMicrousd:p.maximumMicrousd,maximumCalls:1,targets:[{available:true,targetId:'target',settings:{payload:f.payload}}]};
  const slot={slotId:'slot',grantId:'grant',targetId:'target',planRevisionId:'plan',targetContractDigest:'contract',sourceDigest:p.sourceDigest,
   attemptOrdinal:0,previousSlotId:null,jobId:p.requestId,routeDigest:'route',status:phase==='completed'?'succeeded':phase};
  const grant={id:'grant',status:phase==='completed'?'completed':phase==='authorized'?'authorized':'active',expiresAt:future,planRevisionId:'plan',actorUserId:p.actorUserId,payerUserId:p.actorUserId,
   maximumMicrousd:p.maximumMicrousd,maximumCalls:1,disclosure:preflight,pendingCalls:0,operations:[{id:'slot',jobId:p.requestId,targetId:'target',status:slot.status,pendingCalls:0}]};
  const job={job_id:p.requestId,correlation_id:'correlation',status:phase==='authorized'?'queued':phase,expires_at:future,result_json:JSON.stringify(phase==='completed'?
   {outputModel3dRecovery:{version:'output-model3d-recovery-v1',status:'completed',completionEventId:'completion'}}:{})};
  const originals={preflight:{receipt:{payload:{preflight}},envelope:{planRevisionId:'plan'}},authorize:{receipt:{key:'authorize',eventId:'authorize-event',payload:{grant_id:'grant',authorized_targets:[
   {target_id:'target',operation_slot_id:'slot',job_id:p.requestId,route_digest:'route'}]}},envelope:{preflightId:'preflight',termsDigest:'terms',explicitAuthorization:true,maximumMicrousd:p.maximumMicrousd,
   model3dCostConsent:{...p,confirmed:true,providerTransferConfirmed:true}}}};
  if(phase!=='authorized')originals.run={envelope:{grantId:'grant',explicitRun:true},receipt:{key:'run',eventId:'run-event',payload:{grant_id:'grant',job_ids:[p.requestId],existing_jobs_only:true}}};
  const loaded={binding:{output:'model3d',documentId:p.documentId,projectId:p.projectId,streamId:'creative:'+p.actorUserId},originals,
   recipe:{targetId:'target',spec:{deliverables:[{model3d_contract:payload.contract}]}},trusted:{sourceDigest:p.sourceDigest,requirementsDigest:p.requirementsDigest,
    scope:{actorUserId:p.actorUserId,key:'scope'},sourceAssertions:[],env:{DB:{prepare(){return{bind(){return{async first(){return job;}};}};}}}}};
  const ports={confirmed:async()=>plan,canonicalJson,readOutputModel3dPayload,record:v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)),phases:['save','confirm','preflight','authorize','run'],
   error:(code,status=409)=>{throw Object.assign(Error(code),{code,status});},outputExperienceCommands:{readGrantEvidence:async()=>({slots:[slot],confirmedPlan:plan,preflight,row:{status:grant.status,expires_at:future,deadline_current:1}}),snapshot:async()=>({grants:[grant],permissions:{canRequest:true}})},
   outputModel3dRecoveryAvailable:async()=>phase==='failed'};
  const state=new Function(...Object.keys(ports),stripTypeScriptTypes(exact)+'\nreturn state;')(...Object.values(ports));
  const shown=await state(loaded);assert.equal(shown.permitted.authorize,false);assert.equal(shown.permitted.run,false,phase);assert.equal(shown.permitted.resumeRun,false,phase);
  assert.equal(shown.permitted.recoverResult,phase==='failed');if(phase==='completed')assert.equal(shown.recovery,'completed');
 }
});

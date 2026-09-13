// Isolated composed handler checks. Every scenario creates its own SQLite database.
// All provider transport is locally supplied; no real credentials, spend or egress.
// Run: node --experimental-strip-types tests/output-scene-local-stop.runtime.mjs <scenario>
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { writeFileSync,readFileSync } from 'node:fs';
import { outputTestDatabase,registerOutputSourceImports } from './output-execution-test-helpers.mjs';
const scenario=process.argv[2]??'success';
assert.ok(['success','source-change','missing-usage','unqualified','envelope-erased','expired-lease','changed-lease','changed-call','stop-lost-ack','settlement-interrupted','after-pending-source-change','network-uncertain'].includes(scenario));
let injectSourceChange=false;
const localStops=['source-change','expired-lease','changed-lease','changed-call','stop-lost-ack','settlement-interrupted','after-pending-source-change'];
let blockSettlement=['settlement-interrupted','after-pending-source-change'].includes(scenario);
let lostAck=false;
const root=(process.env.FORMA_SOURCE_ROOT??fileURLToPath(new URL('../',import.meta.url))).replace(/\/$/u,'');
const artifacts=process.env.FORMA_SCENE_TEST_ARTIFACTS??mkdtempSync(join(tmpdir(),'forma-scene-local-stop-'));
process.env.FORMA_SOURCE_ROOT=root;
const hook=registerOutputSourceImports();
const originalFetch=globalThis.fetch;
const receipt={scenario,kind:'isolated SQLite composed Scene handler test',phases:[],providerCalls:[],outbound:0,closed:false};
globalThis.fetch=async (...args)=>{receipt.outbound++;throw Error('No provider transport configured: '+String(args[0]));};
let f;
try{
 const [{handleSession,POLICY_VERSION},{handleEvents},{handleExperienceIntake},{handleExperienceOutput},{outputDocumentExecutionBridge},{ensureOutputRequirementsSchema},{registeredExperience,initialValues},{handleDocumentJobs}]=await Promise.all([
  import(root+'/worker/pilot-policy.ts'),import(root+'/worker/events-api.ts'),import(root+'/worker/experience-intake-api.ts'),import(root+'/worker/experience-output-api.ts'),import(root+'/worker/output-document-execution.ts'),import(root+'/worker/output-requirements-ledger.ts'),import(root+'/src/experiences/intake.ts'),import(root+'/worker/document-jobs-api.ts')]);
 f=outputTestDatabase();
 const rawDB=f.env.DB;receipt.databaseErrors=[];
 const wrap=statement=>new Proxy(statement,{get(target,key){const value=target[key];if(key==='bind')return(...args)=>wrap(value.apply(target,args));if(key==='execute')return(...args)=>{try{return value.apply(target,args);}catch(error){receipt.databaseErrors.push({method:key,sql:target.sql,bindings:target.bindings,error:error.message});throw error;}};if(['first','all','run'].includes(key))return async(...args)=>{try{return await value.apply(target,args);}catch(error){receipt.databaseErrors.push({method:key,sql:target.sql,error:error.message,stack:error.stack});throw error;}};return typeof value==='function'?value.bind(target):value;}});
 f.env.DB={prepare(sql){return wrap(rawDB.prepare(sql));},async batch(statements){try{if(blockSettlement&&statements.some(item=>item.sql.startsWith('UPDATE cost_budget_reservations SET used_microusd='))){receipt.settlementInterruptions=(receipt.settlementInterruptions??0)+1;throw Error('local supplied settlement interruption');}const result=await rawDB.batch(statements);
 if(injectSourceChange&&statements.some(item=>item.sql.startsWith('INSERT INTO output_provider_calls'))){injectSourceChange=false;const row=f.sqlite.prepare("SELECT content_id FROM private_content WHERE kind='experience-draft' LIMIT 1").get();assert.ok(row);f.sqlite.prepare("UPDATE private_content SET redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE content_id=?").run(row.content_id);receipt.sourceChangedAfterOriginalCallClaim=true;
 if(scenario==='expired-lease')f.sqlite.prepare("UPDATE document_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(receipt.original.jobId);
 if(scenario==='changed-lease')f.sqlite.prepare("UPDATE document_jobs SET lease_expires_at='2099-01-01T00:00:00.000Z' WHERE job_id=?").run(receipt.original.jobId);
 if(scenario==='changed-call')f.sqlite.prepare("UPDATE output_provider_calls SET client_request_id='foreign-call' WHERE slot_id=?").run(receipt.original.slotId);
 }
 if(scenario==='after-pending-source-change'&&!receipt.sourceChangedAfterPendingCheckpoint&&receipt.original){
  const j=f.sqlite.prepare('SELECT result_json FROM document_jobs WHERE job_id=?').get(receipt.original.jobId);
  const pending=j&&Object.values(JSON.parse(j.result_json??'{}').providerSubmissions??{}).some(r=>r.status==='pending');
  if(pending){f.sqlite.prepare("UPDATE private_content SET redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE kind='experience-draft'").run();receipt.sourceChangedAfterPendingCheckpoint=true;}
 }
 if(scenario==='stop-lost-ack'&&!lostAck&&statements.some(item=>item.sql.startsWith("UPDATE output_provider_calls SET status='rejected',used_microusd=0"))){lostAck=true;receipt.lostLocalStopAcknowledgement=true;throw Error('local-stop-commit-ack-lost');}
 return result;}catch(error){receipt.databaseErrors.push({method:'batch',sql:statements.map(item=>item.sql),error:error.message,stack:error.stack});throw error;}}};
 Object.assign(f.env,{OPENAI_API_KEY:'local-test-not-a-credential',OPENAI_MODEL:'gpt-5.6-terra'});
 const req=(path,body)=>new Request('http://localhost'+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});
 const check=async(label,response)=>{const data=await response.json();receipt.phases.push({label,status:response.status,data});assert.equal(response.status,200,label+': '+JSON.stringify(data));return data;};
 await check('session',await handleSession(req('/api/session'),f.env));f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
 await check('bootstrap',await handleEvents(req('/api/events'),f.env));await ensureOutputRequirementsSchema(f.env);
 const release=await registeredExperience('scene');
 const intake={intentId:crypto.randomUUID(),experienceId:'scene',releaseHash:release.releaseHash,values:{...initialValues(release),...Object.fromEntries(Object.entries({characterA:'Alex',characterB:'Sam',goalA:'Stay',goalB:'Leave',secret:'The key is outside',location:'Waiting room'}).map(([key,value])=>[key,{value,provenance:'authored'}]))}};
 const saved=await check('save original intake',await handleExperienceIntake(req('/api/experiences/drafts',intake),f.env)),{draftId,draftHash,documentId}=saved.plan;
 await check('commit original intake',await handleExperienceIntake(req('/api/experiences/drafts/'+draftId+'/commit',{draftHash}),f.env));
 if(scenario==='source-change'){
  const forged={version:'scene-local-stop-v1',disposition:'not_submitted'};
  const a=await handleDocumentJobs(req('/api/document-jobs',{kind:'render_document',documentId,payload:{artifactKind:'scene',sceneDispatchStop:forged}}),f.env);
  assert.equal(a.status,400);assert.equal((await a.json()).error,'scene_policy_stop_server_owned');
  const b=await handleEvents(req('/api/events',{action:'render_document',documentId,artifactKind:'scene',sceneDispatchStop:forged}),f.env);
  assert.equal(b.status,428);assert.equal((await b.json()).error,'scene_job_required');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);receipt.forgedHttpWitnessRefusals=2;
 }
 const outputBase='/api/experiences/drafts/'+draftId+'/output';
 const pending=[];const context={waitUntil(promise){pending.push(promise);}};
 const state=await check('prepare original Scene',await handleExperienceOutput(req(outputBase+'/prepare',{draftHash,explicitRequirementsConfirmation:true}),f.env,context,outputDocumentExecutionBridge));
 assert.equal(state.permitted.authorize,true,JSON.stringify(state));
 receipt.prepared=true;
 // Continue only with the real route's own preview and explicit fixture action.
 const authorized=await check('authorize original Scene',await handleExperienceOutput(req(outputBase+'/authorize',{draftHash,termsDigest:state.preflight.termsDigest,maximumMicrousd:state.preflight.maximumMicrousd,explicitAuthorization:true,sceneCostConsent:{...state.sceneCostPreview,confirmed:true}}),f.env,context,outputDocumentExecutionBridge));
 const started=await check('start original job',await handleExperienceOutput(req(outputBase+'/run',{draftHash,grantId:authorized.original.grantId,explicitRun:true}),f.env,context,outputDocumentExecutionBridge));
 receipt.original=started.original;
 await Promise.all(pending);
 receipt.jobs=f.sqlite.prepare('SELECT job_id,status FROM document_jobs WHERE document_id=?').all(documentId);
 injectSourceChange=localStops.includes(scenario)&&scenario!=='after-pending-source-change';
 f.env.ASSETS={async fetch(request){if(scenario==='envelope-erased'){f.sqlite.prepare("UPDATE private_content SET redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE kind='provider-response'").run();receipt.envelopeErasedAfterGuardedRead=true;}assert.equal(new URL(request.url).pathname,'/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf');return new Response(readFileSync(root+'/public/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf'));}};
 globalThis.fetch=async(input,init)=>{
  receipt.outbound++;if(scenario==='network-uncertain')throw Error('local supplied transport failure');assert.equal(String(input),'https://api.openai.com/v1/responses');assert.equal(init.method,'POST');assert.equal(receipt.outbound,1);
  const body=JSON.parse(init.body);assert.equal(body.model,'gpt-5.6-terra');assert.equal(body.text.format.name,'document_scene');
  receipt.providerCalls.push({url:String(input),body,headers:Object.fromEntries(new Headers(init.headers))});
  const screenplay={schemaVersion:1,format:'forma-screenplay@1',heading:{setting:'INT.',location:'location',time:'NIGHT'},blocks:[{kind:'action',text:scenario==='unqualified'?'日本語の動作。':'A hand rests against the door.'},{kind:'dialogue',speaker:'A',parenthetical:null,text:'Stay.'},{kind:'dialogue',speaker:'B',parenthetical:null,text:'I have to go.'}]};
  const response={id:'local-scene-response-1',model:body.model,status:'completed',incomplete_details:null,output:[{id:'local-scene-message-1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({title:'The door',summary:'Two intentions meet.',screenplay})}]}],usage:{input_tokens:100,output_tokens:50,total_tokens:150}};
  if(scenario==='missing-usage')delete response.usage;
  return new Response(JSON.stringify(response),{status:200,headers:{'x-request-id':'local-scene-http-1'}});
 };
 await check('run original job',await handleDocumentJobs(new Request('http://localhost/api/document-jobs/'+started.original.jobId+'/run',{method:'POST'}),f.env,started.original.jobId+'/run',context));
 await Promise.all(pending);
 if(['settlement-interrupted','after-pending-source-change'].includes(scenario)){
  assert.ok(receipt.settlementInterruptions>0);assert.ok(f.sqlite.prepare("SELECT 1 FROM cost_budget_reservations WHERE status='executing'").get());blockSettlement=false;
  const {reconcileKnownOutputProviderReceipts}=await import(root+'/worker/output-execution-control.ts');
  const session=receipt.phases.find(p=>p.label==='session').data;
  const reconciled=await reconcileKnownOutputProviderReceipts(f.env,{...session.user,streamId:'creative:dev-local-creative'},{jobId:receipt.original.jobId});
  assert.equal(reconciled.reconciled,1);receipt.sourceFreeReconciliation=reconciled;
  const repeated=await reconcileKnownOutputProviderReceipts(f.env,{...session.user,streamId:'creative:dev-local-creative'},{jobId:receipt.original.jobId});assert.equal(repeated.reconciled,0);receipt.reconciliationRepeat=repeated;
 }
 receipt.jobs=f.sqlite.prepare('SELECT job_id,status,result_json FROM document_jobs WHERE document_id=?').all(documentId);
 receipt.calls=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();
 receipt.completions=f.sqlite.prepare("SELECT event_id,payload FROM events WHERE type='DocumentRenderCompleted'").all();
 assert.equal(receipt.jobs.length,1);
 receipt.budgets=f.sqlite.prepare('SELECT status,reserved_microusd,used_microusd FROM cost_budget_reservations').all();
 if([...localStops,'missing-usage','envelope-erased','network-uncertain'].includes(scenario)){
  assert.notEqual(receipt.jobs[0].status,'completed');assert.equal(receipt.completions.length,0);assert.equal(receipt.outbound,localStops.includes(scenario)?0:1);
  if(['source-change','stop-lost-ack','settlement-interrupted','after-pending-source-change'].includes(scenario)){assert.equal(receipt.calls.length,1);assert.equal(receipt.calls[0].status,'rejected');assert.equal(receipt.calls[0].used_microusd,0);assert.ok(receipt.budgets.every(row=>row.status!=='executing'&&row.status!=='active'));const stopped=JSON.parse(receipt.jobs[0].result_json).sceneDispatchStop;assert.equal(stopped.disposition,'not_submitted');assert.equal(stopped.clientRequestId,receipt.calls[0].client_request_id);receipt.verifiedLocalStop=stopped;
 const {readOutputSceneLocalStop}=await import(root+'/worker/output-scene-local-stop.ts');
 const originalRow=()=>f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(receipt.original.jobId);
 assert.ok(await readOutputSceneLocalStop(f.env,originalRow(),'dev-local-creative','dev-local-creative'));
 const controls=[
  ["UPDATE output_provider_calls SET request_digest='foreign'"],
  ["UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL"],
  ["UPDATE output_provider_calls SET provider_response_id='response'"],
  ["UPDATE document_jobs SET result_json=json_set(result_json,'$.sceneDispatchStop.leaseExpiresAt','2000-01-01T00:00:00.000Z')"],
  ["UPDATE document_jobs SET result_json=json_set(result_json,'$.sceneDispatchStop.correlationId','foreign')"],
  ["UPDATE document_jobs SET result_json=json_set(result_json,'$.sceneDispatchStop.sceneCostBindingHash','foreign')"],
  ["UPDATE document_jobs SET result_json=json_set(result_json,'$.providerSubmissions.'||?||'.responseRef','foreign')",stopped.clientRequestId],
 ];
 for(const [sql,...bindings] of controls){f.sqlite.exec('SAVEPOINT tamper');f.sqlite.prepare(sql).run(...bindings);assert.equal(await readOutputSceneLocalStop(f.env,originalRow(),'dev-local-creative','dev-local-creative'),null,sql);f.sqlite.exec('ROLLBACK TO tamper; RELEASE tamper');}
 assert.equal(await readOutputSceneLocalStop(f.env,originalRow(),'foreign','dev-local-creative'),null);
 assert.equal(await readOutputSceneLocalStop(f.env,originalRow(),'dev-local-creative','foreign'),null);
 receipt.witnessTamperControls=controls.length+2;
 const ledgerBefore=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();
 const retry=await handleDocumentJobs(new Request('http://localhost/api/document-jobs/'+started.original.jobId+'/run',{method:'POST'}),f.env,started.original.jobId+'/run',context);
 receipt.repeatRunStatus=retry.status;await Promise.all(pending);assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_provider_calls').all(),ledgerBefore);assert.equal(receipt.outbound,0);
 const result=JSON.parse(originalRow().result_json);assert.equal(result.generationReceipt.reservation_status,'released');assert.equal(result.generationReceipt.actual_provider_call_count,0);assert.equal(result.generationReceipt.source_transmission_status,'not_transmitted');
 }
  if(['missing-usage','network-uncertain','expired-lease','changed-lease','changed-call'].includes(scenario)){assert.equal(JSON.parse(receipt.jobs[0].result_json).sceneDispatchStop,undefined);assert.equal(receipt.calls.length,1);assert.equal(receipt.calls[0].used_microusd,null);assert.ok(receipt.budgets.some(row=>row.status==='executing'||row.status==='active'));}
  receipt.controlPassed=true;
 }else{
 assert.equal(receipt.outbound,1);assert.equal(receipt.jobs[0].status,'completed','original job completion');
 const completed=f.sqlite.prepare("SELECT body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.type='DocumentRenderCompleted'").get();
 const settings=JSON.parse(completed.private_json).settings;assert.equal(settings.validation.requirement_fulfilled,scenario==='success');
 receipt.verifiedCompletionSettings=settings;
 const final=await check('read original output state',await handleExperienceOutput(req(outputBase),f.env,context,outputDocumentExecutionBridge));
 receipt.finalState=final;receipt.handlerCompositionComplete=true;
 const databasePath=join(artifacts,scenario+'.sqlite');
 f.sqlite.prepare('VACUUM INTO ?').run(databasePath);receipt.databasePath=databasePath;
 }
}catch(error){receipt.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{f?.sqlite.close();hook.deregister();globalThis.fetch=originalFetch;receipt.closed=true;writeFileSync(join(artifacts,scenario+'-result.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({scenario,phases:receipt.phases.map(({label,status})=>({label,status})),error:receipt.error?.message?.slice(0,300),outbound:receipt.outbound,closed:receipt.closed}));}

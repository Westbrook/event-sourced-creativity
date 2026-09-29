import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {videoRecoveryFixture} from './output-video-recovery-fixture.mjs';
import {finishVideoFixtureJob} from './output-video-completion-fixture.mjs';
import {makeEvent,appendEvents} from '../worker/runtime.ts';
import {reconcileKnownOutputProviderReceipts} from '../worker/output-execution-control.ts';
import {readRetainedOutputVideo} from '../worker/output-video-retained.ts';
import {projectNativeRetainedOutput} from '../src/model/native-retained-output.ts';
import {captureExperienceVideoEvidence,verifyExperienceVideoRead} from '../src/experiences/video-native-result.ts';
import {artifactFocusRoute,artifactFocusOptionsFromRoute} from '../src/model/routes.ts';
import {withExperienceReportFlag} from '../src/experiences/host-route.ts';
import {outputSourceEpochAssertion} from '../worker/output-requirements-ledger.ts';
import {outputDigest} from '../worker/output-requirements-api.ts';
import {estimateOpenAITextCallMaximumMicrousd} from '../worker/openai-text-cost.ts';
import {POLICY_VERSION,storePrivateContent} from '../worker/pilot-policy.ts';
import {storeGeneratedMedia} from '../worker/media-api.ts';
import {createHash} from 'node:crypto';
import {generateOutputVideo,OUTPUT_VIDEO_TRANSPORT} from '../worker/output-video-execution.ts';
import {generateDocumentArtifact} from '../worker/openai-adapter.ts';

// Execute the actual closure with real imports. Only current preflight/source
// resolution are explicit fixture ports while public initial gates remain shut.
// This is not HTTP admission, provider execution or browser acceptance.
async function executionFactory(current,sourceAssertions){
 const url=new URL('../worker/output-execution-control.ts',import.meta.url),source=readFileSync(url,'utf8'),ast=ts.createSourceFile('control.ts',source,ts.ScriptTarget.Latest,true),ports={};
 for(const item of ast.statements){
  if(!ts.isImportDeclaration(item)||item.importClause?.isTypeOnly||!item.importClause?.namedBindings||!ts.isNamedImports(item.importClause.namedBindings))continue;
  const module=await import(new URL(item.moduleSpecifier.text,url));
  for(const name of item.importClause.namedBindings.elements)if(!name.isTypeOnly)ports[name.name.text]=module[name.propertyName?.text??name.name.text];
 }
 ports.parsed=raw=>JSON.parse(raw??'{}');ports.preflightOutputNativeTarget=async()=>current;ports.outputVideoExecutionSourceAssertions=()=>sourceAssertions;
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createOutputEventExecution');assert(node);
 const body=ts.transpile(node.getText(ast).replace(/^export\s+/,''),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None});
 return new Function(...Object.keys(ports),body+'\nreturn createOutputEventExecution;')(...Object.values(ports));
}

for(const scenario of ['complete','source_changed','canceled','grant_revoked'])test(`initial Video adapter/execution/publication/retained/Edit: ${scenario}`,async()=>{
 const still=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK2cAAAAASUVORK5CYII=','base64'));
 const f=await videoRecoveryFixture({published:true,referenceSha256:createHash('sha256').update(still).digest('hex')}),originalFetch=globalThis.fetch;f.media.clear();
 try{
  const original=f.original,planner=original.planner.attempt,media=original.mediaAttempt;
  const plannerMaximum=estimateOpenAITextCallMaximumMicrousd(planner.model,planner.maximumInputTokens,planner.maximumOutputTokens);
  assert(plannerMaximum+538020<=f.slot.maximumMicrousd);
  const settings={kind:'render_document',payload:f.settings,calls:[{stage:'planning:0:initial',provider:'openai',model:planner.model,maximumMicrousd:plannerMaximum},{stage:'video:initial',provider:'fal',model:media.model,maximumMicrousd:538020}]};
  const current={available:true,settings},route=await outputDigest(current),future=new Date(Date.now()+45000).toISOString();
  const cp={artifactId:original.artifactId,artifactPlan:original.artifact,outputExecution:original.cp.outputExecution,providerSubmissionProtocol:1,providerSubmissions:{},reservationId:f.slot.tokenReservationId,costReservationId:f.slot.costReservationId,costReservationPeriod:new Date().toISOString().slice(0,7),costReservationMicrousd:f.slot.maximumMicrousd};
  f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
  f.sqlite.exec("DELETE FROM output_provider_calls;UPDATE output_operation_slots SET status='running';UPDATE cost_budget_reservations SET status='executing'");
  f.sqlite.prepare("UPDATE document_jobs SET status='running',lease_expires_at=?,result_json=?").run(future,JSON.stringify(cp));
  f.sqlite.prepare('UPDATE output_operation_slots SET route_digest=?').run(route);f.slot.status='running';f.slot.routeDigest=route;
  const job={...f.sqlite.prepare('SELECT * FROM document_jobs').get(),output_slot_id:f.slot.slotId};
  f.sqlite.exec('CREATE TABLE initial_video_source(current INTEGER);INSERT INTO initial_video_source VALUES(1)');
  const assertions=[outputSourceEpochAssertion(f.scope,{head:1,sourceDigest:'source'}),...f.assertions,{sql:'(SELECT current FROM initial_video_source)=1'}];
  const create=await executionFactory(current,assertions),proof={target:{video_contract:original.contract},targetPreflight:current,head:1,sourceEpoch:{head:1,sourceDigest:'source'},context:{},events:[],confirmedPlan:{},sourceDigest:'source',requirementsDigest:'requirements',assertions};
  const output=await create(f.env,f.user,job,f.binding,proof),lease=original.lease;
  const hook=work=>output.withVideoLease(lease,work);
  const plannerEnvelope=JSON.parse(original.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(original.cp.outputVideoPlannerEnvelope.responseRef).content);
  let plannerCalls=0;globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(init.method,'POST');plannerCalls++;return new Response(Buffer.from(plannerEnvelope.bodyBase64,'base64'),{headers:{'content-type':'application/json'}});};
  const planned=await generateDocumentArtifact({...f.env,OPENAI_API_KEY:'offline-test-key'},f.user.userId,'video',{documentTitle:'Pan',snapshot:{facts:[]},options:{productionMode:'manual',itemCount:1,videoSeconds:4,videoSize:'1280x720',videoAudioMode:'silent',outputVideoPlanner:f.settings.outputVideoPlanner,
   onProviderResponse:async receipt=>({responseRef:(await storePrivateContent(output.guardedEnvironment,'owner','provider-output',JSON.stringify(receipt))).contentId}),
   onBeforeProviderAttempt:attempt=>hook(()=>output.beforeProviderAttempt(attempt,lease)),onBeforeProviderDispatch:id=>output.beforeProviderDispatch(id),onProviderSubmission:receipt=>hook(()=>output.observeProvider(receipt)),onVideoPlannerEnvelope:envelope=>hook(()=>output.retainVideoPlannerEnvelope(envelope,lease))}});
  assert.equal(plannerCalls,1);assert.deepEqual(planned.output,original.artifact);
  const requests=[],responses=[Response.json({upload_url:'https://v3.fal.media/upload/original',file_url:'https://v3.fal.media/original.png'}),new Response(null,{status:200}),Response.json({request_id:'video_original'}),Response.json({request_id:'video_original',status:'COMPLETED'}),Response.json({request_id:'video_original',video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:original.bytes.length}}),new Response(original.bytes,{headers:{'content-type':'video/mp4'}})];
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),method:init.method});const response=responses.shift();assert(response,'unexpected provider request');
   if(init.method==='PUT'){
    if(scenario==='source_changed')f.sqlite.exec('UPDATE initial_video_source SET current=0');
    if(scenario==='canceled')f.sqlite.exec("UPDATE document_jobs SET status='canceled'");
    if(scenario==='grant_revoked')f.sqlite.exec("UPDATE output_execution_grants SET status='revoked'");
   }return response;};
  const producerSource=readFileSync(new URL('../worker/events-api.ts',import.meta.url),'utf8'),producerAst=ts.createSourceFile('events.ts',producerSource,ts.ScriptTarget.Latest,true),blocks=[];
  function visit(node){if(ts.isIfStatement(node)&&node.expression.getText(producerAst)==='nativeVideo'&&node.thenStatement.getText(producerAst).includes('generateOutputVideo'))blocks.push(node.thenStatement.getText(producerAst));ts.forEachChild(node,visit);}visit(producerAst);assert.equal(blocks.length,1);
  const jobSource=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8'),jobAst=ts.createSourceFile('jobs.ts',jobSource,ts.ScriptTarget.Latest,true);
  const progressNames=new Set(['updateJobProgress','parseResult','parseRequest','requiresForegroundDocumentExecution']);
  const progressSource=jobAst.statements.filter(n=>ts.isFunctionDeclaration(n)&&progressNames.has(n.name?.text)).map(n=>n.getText(jobAst)).join('\n');
  const providerHelpers=await import('../src/model/provider-submission.ts');
  const progressPorts={...providerHelpers};const updateProgress=new Function(...Object.keys(progressPorts),ts.transpile(progressSource,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})+'\nreturn updateJobProgress;')(...Object.values(progressPorts));
  const progress=(stage,message,patch)=>updateProgress(output.guardedEnvironment,job,stage,message,patch);
  const ports={generateOutputVideo,OUTPUT_VIDEO_TRANSPORT,storeGeneratedMedia,env:{...output.guardedEnvironment,FAL_KEY:'offline-test-key'},execution:{output,progress},nativeVideo:original.contract,artifactId:original.artifactId,plan:planned.output,ownerId:'owner',storageOwnerId:'owner',compiledSnapshot:{facts:[]},
   preparedVideoReferences:[{bytes:still,mimeType:'image/png',blockId:original.contract.reference.sourceBlockId,referenceId:original.contract.reference.referenceId,label:'Owned still',mode:'inspiration',sequence:null,shotDirection:'',cameraDirection:'',framePrompt:'',sourceArtifactId:null,sourceArtifactItemId:null,sourceArtifactKind:null,storyboardTitle:'',contextGroups:[]}],
   plannerModel:planned.model,plannerResponseId:planned.responseId,plannerResponseIds:[planned.responseId],plannerLatencyMs:planned.latencyMs,plannerUsage:planned.usage,plannerInput:planned.inputReceipt,
   videoInputReceipt:null,reservationId:f.slot.tokenReservationId,costReservationId:f.slot.costReservationId,costReservationPeriod:cp.costReservationPeriod,costReservationMicrousd:cp.costReservationMicrousd,
   videoSubmissionAttempted:false,activeProviderJobId:'',activeProviderModel:'',activeProviderStatusUrl:'',activeProviderResponseUrl:'',activeProviderCancelUrl:'',providerJobId:'',provider:'',modelId:'',renderLatencyMs:0,videoCostMicrousd:0,mediaUrl:null,mediaType:null,generatedMediaHash:null,renderedItems:[],observePaid:receipt=>output.observeProvider(receipt)};
  const runProducer=new Function(...Object.keys(ports),ts.transpile('return(async()=>'+blocks[0]+')();',{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}));
  if(scenario!=='complete'){
   await assert.rejects(runProducer(...Object.values(ports)));assert.deepEqual(requests.map(r=>r.method),['POST','PUT']);
   assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,1);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM output_provider_calls WHERE provider='openai' AND status='settled'").get().n,1);
   assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM events WHERE type='DocumentRenderCompleted'").get().n,0);assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');return;
  }
  await runProducer(...Object.values(ports));assert.deepEqual(requests.map(r=>r.method),['POST','PUT','POST','GET','GET','GET']);assert.equal(ports.renderedItems.length,1);
  const receipt=await output.verifyVideoCompletion(original.artifactId,original.artifact,{deadlineMs:output.videoMediaDeadlineMs()});
  assert.equal(receipt.jobId,job.job_id);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM output_provider_calls WHERE status='settled'").get().n,2);
  const savedMedia=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json).outputVideoMediaCheckpoint;
  const {captureOutputVideoAttempt}=await import('../worker/output-video-execution.ts');const originalAttempt=await captureOutputVideoAttempt(original.contract,f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(savedMedia.requestRef).content,savedMedia.clientRequestId);
  await assert.rejects(hook(()=>output.beforeProviderAttempt(originalAttempt,lease)));assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM output_provider_calls').get().n,2);
  const raw=JSON.stringify(planned.output),input={schema_version:1,artifact_id:original.artifactId,artifact_kind:'video',document_id:'doc',project_id:'project',output_video:receipt,request:{item_count:1,production_mode:'manual',source_surface:'outputs'},planner:{provider:'openai',response_id:planned.responseId}},rawInput=JSON.stringify(input),hash=value=>createHash('sha256').update(value).digest('hex');
  const content=await storePrivateContent(output.guardedEnvironment,'owner','document-artifact',raw),inputStored=await storePrivateContent(output.guardedEnvironment,'owner','document-artifact-input',rawInput);
  await reconcileKnownOutputProviderReceipts(f.env,f.user,{jobId:job.job_id,assertions});
  const payload={artifact_id:original.artifactId,artifact_kind:'video',document_id:'doc',project_id:'project',requested_by_user_id:'owner',source_surface:'outputs',title:planned.output.title,summary:planned.output.summary,
   content_ref:content.contentId,content_expires_at:content.expiresAt,input_ref:inputStored.contentId,input_expires_at:inputStored.expiresAt,item_count:1,items:ports.renderedItems,
   media_url:receipt.media.mediaUrl,media_type:receipt.media.mediaType,provider:'fal',provider_job_id:receipt.media.providerRequestId,model_id:receipt.media.model,planner_model_id:planned.model,planner_response_id:planned.responseId,
   settings:{item_count:1,production_mode:'manual',output_video:receipt,source_media_sha256:receipt.media.sha256,video_content_sha256:hash(raw),video_input_sha256:hash(rawInput)}};
  const head=f.sqlite.prepare('SELECT MAX(sequence) head FROM events WHERE stream_id=?').get(job.stream_id).head;
  const completed=makeEvent(job.stream_id,head+1,'worker:renderer','server:document-job:render_document',job.correlation_id,'DocumentRenderCompleted',payload),usage=makeEvent(job.stream_id,head+2,'worker:policy','server:document-job:render_document',job.correlation_id,'GenerationUsageRecorded',{document_id:'doc',operation:'document-render:video',cost_reservation_id:f.slot.costReservationId,input_tokens:100,output_tokens:30,total_tokens:130,cost_microusd:538320});
  await appendEvents(output.guardedEnvironment,[completed,usage],{prepareSidecars:events=>output.eventWriteSidecars(events)});
  const terminals=[];function terminalNode(node){if(ts.isVariableDeclaration(node)&&node.name.getText(jobAst)==='terminalResult')terminals.push(node.getText(jobAst));ts.forEachChild(node,terminalNode);}terminalNode(jobAst);assert.equal(terminals.length,1);
  const liveCheckpoint=JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json),body={appended:[completed,usage],artifactId:original.artifactId,artifactKind:'video'};
  const previous={...liveCheckpoint.generationReceipt,artifact_kind:'video',actual_provider_call_count:1,reservation_microusd:f.slot.maximumMicrousd};
  const terminalPorts={durableCheckpoint:{},outputBinding:f.binding,readOutputAudioPayload:()=>null,model3dNativeCheckpoint:()=>false,parseRequest:row=>JSON.parse(row.request_json),row:job,liveCheckpoint,acceptedReceipt:previous,
   safeResult:()=>({artifactId:original.artifactId,artifactKind:'video',appendedEventIds:[completed.eventId,usage.eventId]}),body,followup:null,sceneConfiguration:null,detail:null,response:{ok:true}};
  const terminalResult=new Function(...Object.keys(terminalPorts),ts.transpile('const '+terminals[0]+';',{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})+'return terminalResult;')(...Object.values(terminalPorts));
  const refreshSource=jobAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='refreshGenerationReceipt').getText(jobAst);
  const refreshPorts={...providerHelpers,parseResult:row=>JSON.parse(row.result_json),requiresForegroundDocumentExecution:()=>true,readJob:()=>{throw Error('unexpected job reread');},readCorrelatedEvents:()=>{throw Error('unexpected event reread');},costBudgetReservation:()=>{throw Error('committed original settlement must be reused');}};
  const refresh=new Function(...Object.keys(refreshPorts),ts.transpile(refreshSource,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})+'return refreshGenerationReceipt;')(...Object.values(refreshPorts));
  const settlement=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(f.slot.costReservationId);
  const refreshed=await refresh(f.env,f.user,job,body,null,'',{...job,status:'completed',result_json:JSON.stringify(terminalResult)},false,settlement);
  const finalResult=JSON.parse(refreshed.result_json);assert.equal(finalResult.generationReceipt.actual_provider_call_count,2);
  await finishVideoFixtureJob(output.guardedEnvironment,job,'completed',finalResult,null);
  assert.equal(JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json).generationReceipt.actual_provider_call_count,2);
  assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT result_json FROM document_jobs').get().result_json).outputExecution,original.cp.outputExecution);
  assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'completed');assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'succeeded');
  const read=await readRetainedOutputVideo(f.env,{ownerId:'owner',completionId:completed.eventId,documentId:'doc',projectId:'project',artifactId:original.artifactId,contentId:content.contentId,inputId:inputStored.contentId,rawContent:raw,contentExpiresAt:content.expiresAt,completionRaw:JSON.stringify(payload),currentAssertions:[{sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id='owner' AND kind='document-artifact' AND content=? AND expires_at=? AND redacted_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",bindings:[content.contentId,raw,content.expiresAt],deadlineMs:Date.parse(content.expiresAt)}]});
  assert(f.sqlite.prepare('WITH video_witness AS (SELECT ? AS bindings) SELECT 1 WHERE '+read.witness.sql).get(read.witness.json));
  const selection={documentId:'doc',artifactId:original.artifactId,revision:0,contentSha256:hash(raw)},dto=projectNativeRetainedOutput({output:'video',selection},planned.output,read.expiresAt,null,{videoReceipt:payload}),evidence=captureExperienceVideoEvidence(payload.settings);assert(dto&&evidence);
  const expected={contract:original.contract,documentId:'doc',projectId:'project',artifactId:original.artifactId,ownerId:'owner',jobId:job.job_id,slotId:f.slot.slotId,grantId:f.slot.grantId,targetId:f.slot.targetId,planRevisionId:f.slot.planRevisionId,targetContractDigest:f.slot.targetContractDigest,sourceDigest:f.slot.sourceDigest,correlationId:job.correlation_id};
  assert.equal(await verifyExperienceVideoRead(evidence,raw,rawInput,dto,expected),true);
  const hostSource=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8'),hostAst=ts.createSourceFile('host.ts',hostSource,ts.ScriptTarget.Latest,true),methods=[];
  function editNode(node){if(ts.isMethodDeclaration(node)&&node.name.getText(hostAst)==='#edit')methods.push(node.getText(hostAst));ts.forEachChild(node,editNode);}editNode(hostAst);assert.equal(methods.length,1);
  const routes=[];let depart=false;const navigateInApp=async(host,work)=>{if(depart)host.result=null;return work({current:()=>true,route:(route,options)=>{routes.push({route,options});return true;}});};
  const Host=new Function('artifactFocusRoute','withExperienceReportFlag','navigateInApp',ts.transpile('return class{'+methods[0].replaceAll('#','')+'}',{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}))(artifactFocusRoute,withExperienceReportFlag,navigateInApp),host=new Host();
  const originalResult={output:'video',video:dto,current:()=>true};Object.assign(host,{result:originalResult,binding:{plan:{documentId:'doc'},route:'/document/doc?progress-report'},busy:false,visible:()=>true});
  await host.edit();assert.equal(routes.length,1);assert.equal(new URL(routes[0].route,'https://forma.test').searchParams.get('document'),'doc');
  assert.deepEqual(artifactFocusOptionsFromRoute(routes[0].route),{expectedRevision:0,expectedContentSha256:selection.contentSha256,intent:'inspect'});assert.equal(routes[0].options.documentFocus,false);
  depart=true;host.result=originalResult;await host.edit();assert.equal(routes.length,1,'New ownership prevents a stale Edit route');


 }finally{globalThis.fetch=originalFetch;f.close();}
});

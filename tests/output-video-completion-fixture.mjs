import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {registerOutputSourceImports,outputTestDatabase} from './output-execution-test-helpers.mjs';
import {createStoryboardJobTable,insertStoryboardJob} from './output-storyboard-job-schema.mjs';
registerOutputSourceImports();
const {createVideoOutputContract}=await import('../src/model/output-video-contract.ts');
const {parseDocumentArtifactContent}=await import('../src/model/document-artifacts.ts');
const {prepareVideoPlannerRequest}=await import('../worker/openai-adapter.ts');
const {captureOutputVideoAttempt,outputVideoMediaPrice}=await import('../worker/output-video-execution.ts');
const {captureVideoPlannerEnvelope}=await import('../worker/output-video-planner-envelope.ts');
const {retainOutputVideoRequestCheckpoint,retainOutputVideoMediaEnvelope,retainOutputVideoPlannerEnvelope}=await import('../worker/output-video-checkpoint.ts');
const {readOpenAITextUsage,priceCurrentOpenAITextUsage}=await import('../worker/openai-text-cost.ts');
const {storeGeneratedMedia}=await import('../worker/media-api.ts');
const {verifyOutputVideoCompletion,readOutputVideoCompletion}=await import('../worker/output-video-completion.ts');
const {MODEL3D_TERMINAL_RESULT_SQL,model3dNativeCheckpoint}=await import('../worker/output-model3d-terminal.ts');
const {documentJobCompletionBindings}=await import('../worker/document-job-sql.ts');
const {prepareOutputJobOutcomeStatements}=await import('../worker/output-execution-control.ts');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
// Extract the actual terminal function and its pure helpers; avoid importing
// unrelated scheduler entrypoints. SQL, bindings and outcome projection are real.
const source=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('jobs.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['finishDocumentJob','parseRequest','parentJobIdFromRequest','OUTPUT_STORYBOARD_RETAINED_CHECKPOINT_KEYS','OUTPUT_VIDEO_RETAINED_CHECKPOINT_KEYS','PRESERVE_ADAPTIVE_RECEIPT_SQL']);
const snippets=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.has(d.name.getText(ast)))).map(n=>n.getText(ast));
if(snippets.length!==names.size)throw Error('Terminal source extraction incomplete');
const terminal=new Function('documentJobCompletionBindings','prepareOutputJobOutcomeStatements','MODEL3D_TERMINAL_RESULT_SQL','model3dNativeCheckpoint',ts.transpile(snippets.join('\n'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})+'\nreturn finishDocumentJob;')(documentJobCompletionBindings,prepareOutputJobOutcomeStatements,MODEL3D_TERMINAL_RESULT_SQL,model3dNativeCheckpoint);
export async function videoEvidenceFixture({referenceSha256="f".repeat(64)}={}){
 const f=outputTestDatabase();f.sqlite.exec(`CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1));
 CREATE TABLE private_content(content_id TEXT PRIMARY KEY,owner_id TEXT,kind TEXT,content TEXT NOT NULL,created_at TEXT,expires_at TEXT,redacted_at TEXT);
 CREATE TABLE private_content_retention_scopes(content_id TEXT PRIMARY KEY,organization_id TEXT,project_access_id TEXT,project_id TEXT,actor_user_id TEXT,classification TEXT,policy_version INTEGER,assigned_expires_at TEXT,created_at TEXT);
 CREATE TABLE organization_projects(owner_user_id TEXT,project_id TEXT);
 CREATE TABLE project_resource_scopes(resource_kind TEXT,resource_id TEXT);
 CREATE TABLE events(event_id TEXT,stream_id TEXT,type TEXT,payload TEXT,correlation_id TEXT,sequence INTEGER);
 CREATE TABLE output_operation_slots(scope_key TEXT,slot_id TEXT,job_id TEXT,route_digest TEXT,grant_id TEXT,source_digest TEXT,status TEXT,outcome_event_id TEXT,updated_at TEXT);
 CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,status TEXT);
 CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,stage_key TEXT,provider TEXT,model TEXT,client_request_id TEXT,request_digest TEXT,status TEXT,provider_response_id TEXT,used_microusd INTEGER);`);
 createStoryboardJobTable(f.sqlite);
 const contract=createVideoOutputContract({source:{draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)},reference:{version:1,sourceProjectId:'p',sourceDocumentId:'d',sourceBlockId:'b',referenceId:'r',sha256:referenceSha256,permissionAttestation:'i-own-or-have-permission'},frameSize:'1280x720'});
 const rawPlan={title:'Pan',summary:'A still subject.',content_markdown:'One four-second silent pan.',items:[{title:'Pan',body:'The camera moves across the still subject.',notes:'Silent',image_prompt:'Original subject.',context_group_ids:[]}]};
 const artifact=parseDocumentArtifactContent(JSON.stringify(rawPlan));
 const planner=await prepareVideoPlannerRequest({},'owner',{documentTitle:'Pan',snapshot:{facts:[]},options:{productionMode:'manual',itemCount:1,videoSeconds:4,videoSize:'1280x720',videoAudioMode:'silent'}},contract);
 const mediaAttempt=await captureOutputVideoAttempt(contract,JSON.stringify({prompt:rawPlan.content_markdown,aspect_ratio:'16:9',duration:4,resolution:'480p',generate_audio:false,end_user_id:'a'.repeat(64),image_urls:['https://fal.media/original-still.png']}),'forma-video-media-original');
 const future=new Date(Date.now()+60000).toISOString(),scope={kind:'personal',key:'scope',actorUserId:'owner',ownerUserId:'owner',documentId:'doc'},slot={scopeKey:'scope',slotId:'slot',jobId:'job',routeDigest:'route',grantId:'grant',sourceDigest:'source',attemptOrdinal:0,previousSlotId:null,targetId:'target',planRevisionId:'plan',targetContractDigest:'target-contract'};
 const settings={outputVideo:contract,outputVideoPlanner:{contract,requestDigest:planner.requestDigest,maximumInputTokens:planner.maximumInputTokens}};
 const job={job_id:'job',owner_id:'owner',stream_id:'creative:owner',document_id:'doc',correlation_id:'corr',output_slot_id:'slot',attempt_count:1,kind:'render_document',status:'running',lease_expires_at:future,expires_at:future,result_json:'{}',request_json:JSON.stringify({artifactKind:'video',...settings})};
 insertStoryboardJob(f.sqlite,job);f.sqlite.prepare('INSERT INTO output_operation_slots VALUES(?,?,?,?,?,?,?,NULL,NULL)').run('scope','slot','job','route','grant','source','running');
 f.sqlite.exec("INSERT INTO output_execution_grants VALUES('scope','grant','active')");
 for(const a of [planner.attempt,mediaAttempt])f.sqlite.prepare('INSERT INTO output_provider_calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('scope','slot',a.logicalCallKey,a.logicalCallKey,a===mediaAttempt?'fal':'openai',a.model,a.clientRequestId,a.requestDigest,'pending',null,null);
 const controller=new AbortController(),lease={signal:controller.signal,deadlineMs:Date.now()+30000,assertCurrent(){controller.signal.throwIfAborted();if(Date.now()>=this.deadlineMs)throw Error('lease expired');}};
 await retainOutputVideoRequestCheckpoint(f.env,scope,slot,job,planner.attempt,lease);
 const response={id:'resp_video_original',model:planner.attempt.model,status:'completed',service_tier:'default',output:[{id:'msg_original',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(rawPlan)}]}],usage:{input_tokens:100,output_tokens:30,total_tokens:130,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
 await retainOutputVideoPlannerEnvelope(f.env,scope,slot,job,await captureVideoPlannerEnvelope(Response.json(response),{clientRequestId:planner.attempt.clientRequestId,requestDigest:planner.requestDigest,model:planner.attempt.model}),lease);
 await retainOutputVideoRequestCheckpoint(f.env,scope,slot,job,mediaAttempt,lease);
 const bytes=new Uint8Array(readFileSync(new URL('./fixtures/video-native-four-seconds.mp4',import.meta.url))),providerId='video_original',base='https://queue.fal.run/bytedance/seedance-2.0/requests/'+providerId;
 const envelopes=[['submission',{request_id:providerId},'https://queue.fal.run/'+mediaAttempt.model],['status',{request_id:providerId,status:'COMPLETED'},base+'/status'],['result',{request_id:providerId,video:{url:'https://fal.media/original.mp4',content_type:'video/mp4',file_size:bytes.length}},base]];
 for(const [phase,body,requestUrl] of envelopes){const raw=Buffer.from(JSON.stringify(body));await retainOutputVideoMediaEnvelope(f.env,scope,slot,job,{schemaVersion:1,phase,clientRequestId:mediaAttempt.clientRequestId,requestDigest:mediaAttempt.requestDigest,providerRequestId:phase==='submission'?null:providerId,requestUrl,httpStatus:200,headers:[['content-type','application/json'],['x-fal-request-id',providerId]],decodedByteLength:raw.length,decodedBodySha256:hash(raw),decodedBodyBase64:raw.toString('base64')},lease);}
 const artifactId='artifact-original',stored=await storeGeneratedMedia(f.env,'owner',artifactId,bytes,mediaAttempt.model,'video/mp4',{artifactRole:'document-video',provider:'fal',providerJobId:providerId,providerRequestId:providerId,providerSubmissionId:mediaAttempt.clientRequestId,outputVideoRequestDigest:mediaAttempt.requestDigest});
 const plannerCost=priceCurrentOpenAITextUsage(response.model,readOpenAITextUsage(response.usage,{cachePolicy:'disabled-explicit'}),'default').totalMicrousd;
 const cp={...JSON.parse(job.result_json),artifactId,artifactPlan:artifact,plannerResponseId:response.id,providerSubmissionProtocol:1,providerSubmissions:{[planner.attempt.clientRequestId]:{clientRequestId:planner.attempt.clientRequestId,provider:'openai',operation:'planning',model:response.model,status:'completed',providerRequestId:response.id,costMicrousd:plannerCost,inputTokens:100,outputTokens:30,totalTokens:130},[mediaAttempt.clientRequestId]:{clientRequestId:mediaAttempt.clientRequestId,provider:'fal',operation:'video',model:mediaAttempt.model,status:'completed',providerRequestId:providerId,costMicrousd:outputVideoMediaPrice().maximumMicrousd,totalTokens:0}},outputVideoMediaResult:{artifactId,mediaUrl:stored.url,mediaType:'video/mp4',sha256:stored.contentHash,byteLength:bytes.length,clientRequestId:mediaAttempt.clientRequestId,providerRequestId:providerId,model:mediaAttempt.model,requestDigest:mediaAttempt.requestDigest}};
 function persist(){job.result_json=JSON.stringify(cp);f.sqlite.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=?').run(job.result_json,job.job_id);}
 persist();for(const receipt of Object.values(cp.providerSubmissions))f.sqlite.prepare("UPDATE output_provider_calls SET status='settled',provider_response_id=?,used_microusd=? WHERE client_request_id=?").run(receipt.providerRequestId,receipt.costMicrousd,receipt.clientRequestId);
 const verify=()=>verifyOutputVideoCompletion(f.env,scope,slot,job,settings,artifactId,artifact,lease),read=()=>readOutputVideoCompletion(f.env,scope,slot,job,settings,artifactId,artifact,lease);
 async function finish(status='completed',summary={}) {await terminal(f.env,job,status,{artifactId,artifactKind:'video',stage:status,...summary},status==='completed'?null:'cancelled');Object.assign(job,f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(job.job_id));}
 return {...f,contract,scope,slot,job,settings,artifact,artifactId,planner,mediaAttempt,cp,bytes,stored,lease,controller,persist,verify,read,finish};
}

// Actual terminal implementation shared with connected initial execution controls.
export {terminal as finishVideoFixtureJob};

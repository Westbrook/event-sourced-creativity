import {createHash} from 'node:crypto';
import {videoRecoveryFixture} from './output-video-recovery-fixture.mjs';
const {createAudioOutputContract}=await import('../src/model/output-audio-contract.ts');
const {EXPERIENCE_AUDIO_INTENT}=await import('../src/experiences/contracts.ts');
const {parseDocumentArtifactContent}=await import('../src/model/document-artifacts.ts');
const {outputSlotFromRow}=await import('../worker/output-requirements-ledger.ts');
const {captureOutputAudioAttempt}=await import('../worker/output-audio-execution.ts');
const {claimOutputAudioRecoveryLease}=await import('../worker/output-audio-recovery-lease.ts');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
/** Actual DDL and private writers; original admission remains explicit fixture setup. */
export async function audioRecoveryFixture(){
 const f=await videoRecoveryFixture(),jobId='audio-'+'1'.repeat(64),source={draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)},contract=createAudioOutputContract(source);
 const requestBody=JSON.stringify({prompt:'Quiet original instrumental.',duration:20,output_format:'mp3',enable_safety_checker:true,negative_prompt:'singing, vocals, spoken dialogue'}),attempt=await captureOutputAudioAttempt(contract,requestBody,'forma-audio-original','audio:initial');
 const expiry=new Date(Date.now()+300000).toISOString(),reference={...f.original.cp.outputExecution,targetContractDigest:'2'.repeat(64),sourceDigest:'3'.repeat(64)},providerId='audio_original',model=attempt.model,base='https://queue.fal.run/fal-ai/stable-audio-3/requests/'+providerId;
 const snapshot={facts:[],relationships:[],context_groups:[],pins:[],tail:[]},snapshotHash=hash(JSON.stringify(snapshot));
 const plan=parseDocumentArtifactContent(JSON.stringify({title:'Quiet',summary:'Original instrumental.',content_markdown:'A quiet instrumental.',items:[{title:'Track',body:'A quiet instrumental.',notes:'No singing.',image_prompt:'',context_group_ids:[],slide:null}],presentation:null}));
 const planner={clientRequestId:'forma-document-audio-plan',provider:'openai',operation:'planning',model:'gpt-5.6-terra',effectiveModel:'gpt-5.6-terra',unitId:'planning:0:initial',status:'completed',providerRequestId:'resp_audio',responseRef:'audio-response',costMicrousd:300,textInputCostMicrousd:100,textOutputCostMicrousd:200,inputTokens:100,outputTokens:30,totalTokens:130,cachedInputTokens:0,cacheWriteInputTokens:0,completionStatus:'completed',validationStatus:'valid'};
 const media={clientRequestId:attempt.clientRequestId,provider:'fal',operation:'audio',model,unitId:'audio:initial',status:'accepted',providerRequestId:providerId,requestDigest:attempt.requestDigest};
 const parameters={published_cost_microusd:37600,goal:'timed_music',destination:'standalone',duration_seconds:20,image_reference_count:0,audio_waveform_submitted:false,semantic_audio_reference_count:0,provider_parameters:{duration:20,output_format:'mp3',enable_safety_checker:true,negative_prompt:'singing, vocals, spoken dialogue'}};
 const cp={artifactId:'artifact-audio',artifactPlan:plan,plannerResponseId:planner.providerRequestId,plannerInput:{},plannerUsage:{inputTokens:100,outputTokens:30,totalTokens:130},outputExecution:reference,
  generationReceipt:{input_ref:'audio-source',source_snapshot_sha256:snapshotHash},
  outputAudioRequest:{contract,requestBody,clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest},
  audioInputReceipt:{provider:'fal',model,provider_job_id:providerId,submitted_prompt:'Quiet original instrumental.',parameters,image_reference:null,source_audio_treatment:'none',audio_waveform_submitted:false,source_audio_block_ids:[],queue:{status_url:base+'/status',response_url:base,cancel_url:base+'/cancel'}},
  providerJobId:providerId,providerModel:model,providerStatusUrl:base+'/status',providerResponseUrl:base,providerCancelUrl:base+'/cancel',audioProviderSubmission:'confirmed',providerSubmissions:{[planner.clientRequestId]:planner,[attempt.clientRequestId]:media}};
 const preview={version:'audio-mini-app-cost-v1',requestId:jobId,actorUserId:'owner',projectId:'project',documentId:'doc',draftId:source.draftId,sourceDigest:reference.sourceDigest,requirementsDigest:'4'.repeat(64),expiresAt:expiry,maximumMicrousd:1037600,maximumCalls:3,maximumTokens:128000,planningModel:'gpt-5.6-terra',maximumPlanningCalls:2,maximumOutputTokens:3000,audioModel:model,maximumAudioCalls:1,durationSeconds:20,requireInstrumental:true,sourceFilesTransferred:0};
 const request={artifactKind:'audio',productionMode:'manual',itemCount:1,outputAudio:contract,outputExecution:reference,audioProviderModel:model,audioProfile:EXPERIENCE_AUDIO_INTENT,audioEstimatedCostMicrousd:37600,outputTargetInstructions:'Quiet instrumental.',audioCostConsent:{...preview,confirmed:true,providerTransferConfirmed:true},snapshot,sourceBlockVersions:[]};
 // Convert fixture identity with foreign-key checks restored and verified below.
 f.sqlite.exec('PRAGMA foreign_keys=OFF');
 f.sqlite.prepare("UPDATE document_jobs SET job_id=?,request_json=?,result_json=?,attempt_count=2,correlation_id=?,expires_at=?,lease_expires_at=NULL").run(jobId,JSON.stringify(request),JSON.stringify(cp),jobId+':attempt:2',expiry);
 f.sqlite.prepare("UPDATE output_operation_slots SET job_id=?,model=?,target_contract_digest=?,source_digest=?").run(jobId,model,reference.targetContractDigest,reference.sourceDigest);
 f.sqlite.prepare("UPDATE output_plan_targets SET media_kind='audio',target_contract_digest=?").run(reference.targetContractDigest);
 f.sqlite.prepare("UPDATE output_plan_revisions SET source_digest=?,requirements_digest=?").run(reference.sourceDigest,preview.requirementsDigest);
 for(const table of ['budget_reservations','cost_budget_reservations'])f.sqlite.prepare(`UPDATE ${table} SET correlation_id=?,operation='document-render:audio'`).run(jobId+':attempt:2');
 f.sqlite.exec('PRAGMA foreign_keys=ON');
 if(f.sqlite.prepare('PRAGMA foreign_key_check').all().length)throw Error('Audio fixture foreign keys invalid');
 f.sqlite.prepare("INSERT INTO output_operation_routes(scope_key,slot_id,stage_key,provider,model,maximum_calls) VALUES('scope','slot','audio:initial','fal',?,1)").run(model);
 f.sqlite.prepare("UPDATE output_provider_calls SET call_key='audio:initial',stage_key='audio:initial',model=?,client_request_id=?,request_digest=?,provider_response_id=?,reserved_microusd=37600 WHERE provider='fal'").run(model,attempt.clientRequestId,attempt.requestDigest,providerId);
 f.sqlite.prepare("UPDATE output_provider_calls SET model=?,client_request_id=?,request_digest='planner-digest',provider_response_id=?,used_microusd=300 WHERE provider='openai'").run(planner.model,planner.clientRequestId,planner.providerRequestId);
 f.sqlite.exec("DELETE FROM output_operation_routes WHERE stage_key='video:initial'");
 const text=JSON.stringify(plan),envelope={id:planner.providerRequestId,model:planner.model,status:'completed',error:null,incomplete_details:null,output:[{type:'message',id:'msg_audio',status:'completed',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}],usage:{input_tokens:100,output_tokens:30,total_tokens:130,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
 planner.reasoningTokens=0;cp.providerSubmissions[planner.clientRequestId]=planner;
 const retained={job_id:jobId,document_id:'doc',stream_id:'creative:owner',document_title:'Quiet',artifact_kind:'audio',output_audio:contract,call:planner,raw_envelope:JSON.stringify(envelope),output_text:text,content_sha256:hash(text),response_id:planner.providerRequestId,model:planner.model,candidate_truncated:false,source_snapshot_sha256:snapshotHash,compiled_snapshot_sha256:hash(JSON.stringify({...snapshot,document:{id:'doc',title:'Quiet'}}))};
 const sourceReceipt={schema_version:1,job_id:jobId,document_id:'doc',artifact_kind:'audio',document_snapshot:snapshot,source:{snapshot_sha256:snapshotHash},source_block_versions:[]};
 for(const [id,kind,value] of [['audio-response','provider-response',retained],['audio-source','document-artifact-input',sourceReceipt]])f.sqlite.prepare('INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(id,'owner',kind,JSON.stringify(value),new Date().toISOString(),expiry);
 f.sqlite.prepare('UPDATE document_jobs SET result_json=?').run(JSON.stringify(cp));
 const job=()=>({...f.sqlite.prepare('SELECT * FROM document_jobs').get(),output_slot_id:'slot'}),slot=outputSlotFromRow('scope',f.sqlite.prepare('SELECT * FROM output_operation_slots').get()),binding={...f.binding,slot};
 return{...f,jobId,cp,contract,attempt,request,preview,planner,mediaReceipt:media,job,slot,binding,claim:(signal)=>claimOutputAudioRecoveryLease(f.env,f.scope,slot,job(),{assertions:f.assertions,signal})};
}

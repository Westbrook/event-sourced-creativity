import { outputJobIsDurable, assertOutputDurableLease } from "./output-durable-control.ts";
import { requireSponsorExecution, readSponsorFinancialBinding, sponsorFinancialIdentity, sponsorTerminalReleaseStatement, type SponsorExecutionAuthority, type SponsorFinancialBinding } from "./experience-sponsor-execution.ts";
import { verifyOutputVideoCompletion } from "./output-video-completion.ts";
import { prepareOutputProviderFinancialCheckpoint, retainUnsettledOutputProviderObservation } from "./output-provider-financial-checkpoint.ts";
import { retainOutputVideoRequestCheckpoint, retainOutputVideoMediaEnvelope, retainOutputVideoPlannerEnvelope } from "./output-video-checkpoint.ts";
import { captureOutputVideoAttempt, outputVideoMediaPrice, type OutputVideoHookLease, type OutputVideoRawEnvelope } from "./output-video-execution.ts";
import { assertVideoPlannerAttempt } from "./output-video-planner.ts";
import type { VideoPlannerRawEnvelope } from "./output-video-planner-envelope.ts";
import { readOutputVideoReference } from "./output-video-reference.ts";
import { outputVideoExecutionSourceAssertions } from "./output-video-preflight.ts";
import { model3dPublicationHead } from "./output-model3d-publication-head.ts";
import { readOutputAudioPayload, assertOutputAudioAttempt, requireAudioMiniAppCostApproval } from "./output-audio-execution.ts";
import { projectNativeRetainedModel3d } from "../src/model/native-retained-model3d.ts";
import { captureModel3dComparisonData } from "../src/model/output-model3d-offer.ts";
import { outputAudioPreflightAssertions } from "./output-audio-preflight.ts";
import { parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { recordOutputSceneLocalStop, readOutputSceneLocalStop } from "./output-scene-local-stop.ts";
import { verifyOutputStoryboardCompletion } from "./output-storyboard-completion.ts";
import { outputStoryboardPreflightProof } from "./output-storyboard-preflight.ts";
import { readStoryboardFrameAttempt, storyboardFrameRequest } from "./output-storyboard-fal.ts";
import { readStoryboardPlannerAttempt } from "./output-storyboard-request.ts";
import { retainStoryboardPlannerRequestCheckpoint, retainStoryboardRawEnvelopeCheckpoint } from "./output-storyboard-planner-checkpoint.ts";
import type { StoryboardRawEnvelope } from "./output-storyboard-envelope.ts";
import { retainStoryboardFrameCheckpoint, storyboardFrameSequenceAssertion } from "./output-storyboard-checkpoint.ts";
import type { CapturedStoryboardPlan } from "./output-storyboard-plan.ts";
import { assertOutputSceneAttempt } from "./output-scene-execution.ts";
import { outputScenePreflightProof } from "./output-scene-preflight.ts";
import { outputProofReadStatements } from "./output-disclosure-proof.ts";
import { readSceneJobSourceWitness,sceneJobSourceWitnessAssertions,prepareSceneJobSourceTransition } from './scene-job-source-witness.ts';
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { requireSceneMiniAppCostApproval } from "./scene-mini-app-consent.ts";
import type { PreparedSceneCost } from "./scene-cost-consent.ts";
import { assertOutputNarrativeAttempt } from "./output-narrative-execution.ts";
import { retainedPersonalFalRecoverySql } from "./output-fal-recovery-policy.ts";
import { retainOutputFalImageCheckpoint } from "./output-fal-image-checkpoint.ts";
import type { OutputFalCapturedRequest } from "./output-fal-image-contract.ts";
import { readOutputFalImageContract } from "./output-fal-image-contract.ts";
import { prepareOutputImageProviderHealth } from "./output-image-provider-health.ts";
import { prepareOutputNativeProjectPublicationStatements } from "./output-native-project-publication.ts";
import { guardOutputPrivateWrites, reconcileOutputNativeStorage } from "./output-private-execution.ts";
import type { ProviderFailureDetail } from "./provider-errors.ts";
import type { PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { mergeProviderSubmissions, providerSubmissions } from "../src/model/provider-submission.ts";
import type { ImageFormat } from "../src/model/image-format.ts";
import { eventWriteBindings, type EventRow, type WorkerEnv } from "./runtime.ts";
import { documentJobProjectAuthority, type DocumentJobRow } from "./document-jobs-api.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import { settleBudget, settleCostBudget, settleDocumentGenerationBudgets, type PilotUser } from "./pilot-policy.ts";
import { outputDigest, resolveOutputExecutionAuthority, prepareOutputExecutionProof } from "./output-requirements-api.ts";
import { preflightOutputNativeTarget, type OutputNativeSettings } from "./output-document-execution.ts";
import { claimOutputProviderCall, settleOutputProviderCall, readOutputSlots, outputSlotFromRow, outputScopeAuthority, outputAssertionStatements, OutputConflictError, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import type { authoritativeCreativeContext } from "./context-authority.ts";
import { priceTextUsageBreakdownMicrousd, priceImageUsageBreakdownMicrousd } from "./replay-cost.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import { estimateModel3dCostMicrousd } from "../src/model/model3d.ts";
import { readOutputModel3dPayload, requireModel3dMiniAppCostApproval, verifyModel3dPreparedReceipt, assertModel3dPreparedAttempt, qualifyOutputModel3dCompletion } from "./output-model3d-execution.ts";
import { model3dMiniAppAttemptMatches } from "../src/model/model3d-mini-app-consent.ts";
import { outputModel3dPreflightAssertions } from "./output-model3d-preflight.ts";
import type { Model3dPreparedReceipt, Model3dGeneratedFile } from "./fal-model3d-adapter.ts";
import { outputSourceTransition, type OutputSourceTransition } from "./output-source-transition.ts";

const parsed=(raw:string|null|undefined):Record<string,unknown>=>{try{const value:unknown=JSON.parse(raw??"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}catch{return{};}};
export type OutputJobBinding={scope:OutputScope;slot:OutputOperationSlot;sponsored:boolean;payerUserId:string;retentionPolicy:Record<string,unknown>|null};
export type OutputExecutionProof=ReturnType<typeof prepareOutputExecutionProof>;
export type OutputEventExecution={
 guardedEnvironment:WorkerEnv;
 readonly financialPayerUserId:string;
 readonly financialAssertions?:readonly OutputSqlAssertion[];
 readonly sponsorFinancialBinding?:SponsorFinancialBinding;
 withSourceTransition?:OutputSourceTransition;
 accountSettlement?:{reservation_id:string;reserved_microusd:number;used_microusd:number;status:string};
 sourceEvents:EventRow[];sourceHead:number;
 eventAppendCommitted:(events:EventRow[])=>Promise<boolean>;
 eventWriteSidecars?:(events:EventRow[])=>D1PreparedStatement[];
 eventWriteCommitted?:(results:D1Result[])=>void;
 publicationScopesComplete?:()=>boolean;
 reference:{scopeKey:string;grantId:string;slotId:string;planRevisionId:string;targetId:string;targetContractDigest:string;sourceDigest:string};
 settings:Record<string,unknown>;
 refreshAudio?:()=>Promise<void>;
 model3d?:{
  prepare:(receipt:Model3dPreparedReceipt)=>Promise<void>;
  qualify:(primary:Model3dGeneratedFile,providerRequestId:string)=>Promise<Awaited<ReturnType<typeof qualifyOutputModel3dCompletion>>>;
  complete:(artifactId:string,files:readonly unknown[],receipt:Awaited<ReturnType<typeof qualifyOutputModel3dCompletion>>)=>Promise<Record<string,unknown>>;
 };
 readAudioEnvelope?:(responseRef:string)=>Promise<string>;
 refreshScene?:()=>Promise<PreparedSceneCost>;
 readSceneEnvelope?:(responseRef:string)=>Promise<string>;
 imageRender?:{format:ImageFormat;size:`${number}x${number}`};
 reservations:{reservationId:string;costReservationId:string;costReservationPeriod:string;costReservationMicrousd:number;maximumTokens:number};
 assertContext:(context:ReturnType<typeof authoritativeCreativeContext>)=>Promise<void>;
 retainFalImageRequest:(request:OutputFalCapturedRequest,planning:Record<string,unknown>)=>Promise<void>;
 retainStoryboardFrameRequest?:(request:OutputFalCapturedRequest,plan:CapturedStoryboardPlan,frameIndex:number)=>Promise<void>;
 retainStoryboardEnvelope?:(envelope:StoryboardRawEnvelope)=>Promise<void>;
 verifyStoryboardCompletion?:(artifactId:string,artifact:unknown,frames:unknown,lifetime?:{signal?:AbortSignal;deadlineMs?:number})=>Promise<Record<string,unknown>>;
 storyboardMediaDeadlineMs?:()=>number;
 verifyVideoCompletion:(artifactId:string,artifact:unknown,lifetime:{signal?:AbortSignal;deadlineMs:number})=>Promise<Record<string,unknown>>;
 videoMediaDeadlineMs:()=>number;
 beforeSourceTransmission:()=>Promise<void>;
 beforeProviderAttempt:(attempt:ProviderAttemptPreflight,lease?:OutputVideoHookLease)=>Promise<void>;
 withVideoLease:<T>(lease:OutputVideoHookLease,work:()=>T|Promise<T>)=>Promise<T>;
 readVideoReference:(lease:OutputVideoHookLease)=>Promise<import("./openai-adapter.ts").VideoReference>;
 retainVideoPlannerEnvelope:(envelope:VideoPlannerRawEnvelope,lease:OutputVideoHookLease)=>Promise<void>;
 retainVideoMediaEnvelope:(envelope:OutputVideoRawEnvelope,lease:OutputVideoHookLease)=>Promise<void>;
 beforeProviderDispatch:(clientRequestId:string)=>void;
 providerNotDispatched?:(attempt:ProviderAttemptPreflight)=>Promise<void>;
 dispatchStop:(error:unknown)=>ProviderFailureDetail|null;
 observeProvider:(receipt:PaidProviderSubmission)=>Promise<void>;
};

/** The durable slot, not an expiring request JSON property, determines execution. */
export async function loadOutputJobBinding(env:WorkerEnv,user:PilotUser,job:Pick<DocumentJobRow,"job_id"|"owner_id"|"stream_id"|"document_id"|"request_json"|"output_slot_id">):Promise<OutputJobBinding|null>{
 if(job.output_slot_id===null)return null;
 const row=await env.DB.prepare(`SELECT slot.*,plan.scope_kind,plan.owner_user_id,plan.project_id,plan.document_id,plan.organization_id,plan.project_access_id,grant_row.actor_user_id,grant_row.context_id,grant_row.payer_user_id,
  EXISTS(SELECT 1 FROM event_private_payloads body WHERE body.private_event_id=grant_row.authorization_event_id AND body.owner_id=plan.owner_user_id AND body.project_id=plan.project_id AND body.document_id=plan.document_id AND CASE WHEN body.redacted_at IS NULL AND json_valid(body.private_json) THEN json_type(body.private_json,'$.output_command_envelope.sponsor_entitlement') ELSE NULL END IS NOT NULL) AS sponsor_marker,
  (SELECT json_object('transient_days',policy.transient_days,'evidence_days',policy.evidence_days,'version',policy.version) FROM organization_retention_policies policy WHERE policy.organization_id=plan.organization_id) AS retention_policy_json
  FROM output_operation_slots slot JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id WHERE slot.job_id=?`).bind(job.job_id).first<Record<string,unknown>>();
 if(!row){if(parsed(job.request_json).outputExecution)throw new OutputConflictError("output_job_binding_missing",403);return null;}
 if(job.owner_id!==user.userId||row.actor_user_id!==user.userId||job.stream_id!==`creative:${row.owner_user_id}`||job.document_id!==row.document_id)throw new OutputConflictError("output_job_scope_mismatch",403);
 const scope:OutputScope={kind:row.scope_kind as OutputScope["kind"],key:String(row.scope_key),ownerUserId:String(row.owner_user_id),actorUserId:user.userId,projectId:String(row.project_id),documentId:String(row.document_id),organizationId:row.organization_id===null?null:String(row.organization_id),projectAccessId:row.project_access_id===null?null:String(row.project_access_id),contextId:typeof row.context_id==="string"?row.context_id:null};
 if(scope.kind==="project"&&(!scope.contextId||!user.projectExecution||user.projectExecution.organizationId!==scope.organizationId||user.projectExecution.projectAccessId!==scope.projectAccessId||user.projectExecution.actorUserId!==scope.actorUserId)||scope.kind==="personal"&&user.projectExecution)throw new OutputConflictError("output_job_scope_mismatch",403);
 const slot=outputSlotFromRow(scope.key,row);
 return {scope,slot,payerUserId:String(row.payer_user_id),sponsored:scope.kind==="personal"&&(Boolean(row.sponsor_marker)||row.payer_user_id!==row.actor_user_id),retentionPolicy:typeof row.retention_policy_json==="string"?parsed(row.retention_policy_json):null};
}

/** Current source/target/route eligibility is checked again before each transfer and paid call. */
export async function createOutputEventExecution(env:WorkerEnv,user:PilotUser,job:DocumentJobRow,binding:OutputJobBinding,preparedProof?:OutputExecutionProof,sponsorAuthority?:SponsorExecutionAuthority):Promise<OutputEventExecution>{
 const {scope,slot}=binding;
 if(binding.sponsored&&(user.fictional||user.projectExecution||user.billingUserId&&user.billingUserId!==user.userId))throw new OutputConflictError("sponsor_personal_principal_required",403);
 const sponsor=binding.sponsored?await requireSponsorExecution(sponsorAuthority,env,user.userId,{jobId:job.job_id,grantId:slot.grantId,scopeKey:scope.key}):null;
 const financial=sponsor?sponsorFinancialIdentity(sponsor.financial,env,user.userId,job.job_id):null;
 if(!["queued","running"].includes(slot.status))throw new OutputConflictError("output_operation_not_started",409);
 const authority=preparedProof??prepareOutputExecutionProof(scope,await resolveOutputExecutionAuthority(env,scope,slot));
 let sceneStored=job.scene_source_version_json!=null?await readSceneJobSourceWitness(env,scope,slot,job.correlation_id):null;
 if(Boolean(job.scene_source_protocol===1)!==Boolean(sceneStored))throw new OutputConflictError('output_scene_source_witness_unavailable',409);
 if(sceneStored&&!Object.hasOwn(authority.target,'scene_contract'))throw new OutputConflictError('output_scene_source_witness_unavailable',409);
 let sceneTransition:ReturnType<typeof prepareSceneJobSourceTransition>|null=null;
 const currentInput={env,request:new Request("https://output-execution.invalid"),scope,principal:user,confirmedPlan:authority.confirmedPlan,target:authority.target,context:authority.context,sourceEvents:authority.events,sourceAssertions:authority.assertions,sourceDigest:authority.sourceDigest,requirementsDigest:authority.requirementsDigest,ownerHead:authority.sourceEpoch.head,...(sceneStored?{sceneSourceVersion:sceneStored.witness.successor}:{})};
 const current=await preflightOutputNativeTarget(currentInput);
 if(!current.available||await outputDigest(current)!==slot.routeDigest)throw new OutputConflictError("output_native_route_changed",409);
 const videoSourceAssertions=Object.hasOwn(authority.target,"video_contract")?outputVideoExecutionSourceAssertions(currentInput,current,slot):[];
 const audioProof=Object.hasOwn(authority.target,"audio_contract")?outputAudioPreflightAssertions(current):null;
 if(Object.hasOwn(authority.target,"audio_contract")&&!audioProof)throw new OutputConflictError("output_audio_source_unavailable",403);
 const audioAssertions:OutputSqlAssertion[]=[...(audioProof??[])];
 const model3dProof=Object.hasOwn(authority.target,"model3d_contract")?outputModel3dPreflightAssertions(current):null;
 if(Object.hasOwn(authority.target,"model3d_contract")&&!model3dProof)throw new OutputConflictError("output_model3d_source_unavailable",403);
 const model3dAssertions:OutputSqlAssertion[]=[...(model3dProof??[])];
 const sceneProof=Object.hasOwn(authority.target,"scene_contract")?outputScenePreflightProof(current):null;
 if(Object.hasOwn(authority.target,"scene_contract")&&!sceneProof)throw new OutputConflictError("output_scene_source_unavailable",403);
 const sceneAssertions:OutputSqlAssertion[]=[...(sceneProof?.sourceAssertions??[])];
 const storyboardProof=Object.hasOwn(authority.target,"storyboard_contract")?outputStoryboardPreflightProof(current):null;
 if(Object.hasOwn(authority.target,"storyboard_contract")&&!storyboardProof)throw new OutputConflictError("output_storyboard_source_unavailable",403);
 if(storyboardProof&&(storyboardProof.requestId!==job.job_id||storyboardProof.requestId!==slot.jobId||slot.attemptOrdinal!==0||slot.previousSlotId
  ||Date.parse(storyboardProof.expiresAt)<=Date.now()))throw new OutputConflictError("output_storyboard_original_attempt_required",403);
 const storyboardSourceAssertions:OutputSqlAssertion[]=[...(storyboardProof?.sourceAssertions??[])];
 const sceneEnvelopeAssertions:OutputSqlAssertion[]=[];
 const storyboardCompletionAssertions:OutputSqlAssertion[]=[];
 let storyboardCompletionJson:string|undefined;
 let model3dCompletionJson:string|undefined;
 let model3dPrepared:Model3dPreparedReceipt|null=null;
 let model3dQualified:Awaited<ReturnType<typeof qualifyOutputModel3dCompletion>>|null=null;
 let videoCompletionJson:string|undefined;const videoCompletionAssertions:OutputSqlAssertion[]=[];
 const projectJobAuthority=documentJobProjectAuthority(user,job.document_id,job.job_id);
 const model3dPublication=model3dProof?model3dPublicationHead({jobId:job.job_id,ownerId:job.owner_id,streamId:job.stream_id,correlationId:job.correlation_id}):null;
 let videoHook:OutputVideoHookLease|null=null;
 const videoLifetimeAssertions=():OutputSqlAssertion[]=>{if(!videoHook)return[];videoHook.assertCurrent();return[{sql:"?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",bindings:[new Date(videoHook.deadlineMs).toISOString()],deadlineMs:videoHook.deadlineMs}];};
 const liveAssertions=(recoveredScene?:NonNullable<typeof sceneStored>)=>[...(sponsor?.assertions??[]),...videoLifetimeAssertions(),...authority.assertions,...(recoveredScene?recoveredScene.assertions:[...sceneAssertions,...(sceneStored?.assertions??[])]),...audioAssertions,...(model3dPublication?.assertions(model3dAssertions)??model3dAssertions),...storyboardSourceAssertions,...videoSourceAssertions,...sceneEnvelopeAssertions,...storyboardCompletionAssertions,...videoCompletionAssertions,...(projectJobAuthority?[projectJobAuthority]:[]),outputScopeAuthority(scope,"request"),{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND (status IN('running','committing') AND lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND lease_expires_at>=? OR status='completed'))",bindings:[job.job_id,user.userId,job.stream_id,job.correlation_id,new Date().toISOString(),job.lease_expires_at]},{sql:"EXISTS(SELECT 1 FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND context_id IS ? AND status IN('authorized','active') AND expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now')))",bindings:[scope.key,slot.grantId,scope.actorUserId,scope.contextId,new Date().toISOString()]}];
 const settings=authority.targetPreflight.settings as OutputNativeSettings;
 if(settings.kind!==job.kind)throw new OutputConflictError("output_job_route_mismatch",403);
 const model3dPayload=model3dProof?await readOutputModel3dPayload(settings.payload):null;
 if(model3dProof&&!model3dPayload)throw new OutputConflictError("output_model3d_contract_unsupported",403);
 const refreshModel3d=model3dProof?async()=>{
  const refreshed=await preflightOutputNativeTarget({env,request:new Request("https://output-execution.invalid"),scope,principal:user,confirmedPlan:authority.confirmedPlan,target:authority.target,context:authority.context,ownerHead:authority.sourceEpoch.head,sourceEvents:authority.events,sourceAssertions:authority.assertions,sourceDigest:authority.sourceDigest,requirementsDigest:authority.requirementsDigest});
  const proof=outputModel3dPreflightAssertions(refreshed),payload=refreshed.available?await readOutputModel3dPayload((refreshed.settings as OutputNativeSettings).payload):null;
  if(!proof||!payload||!model3dPayload||scope.kind!=="personal"||scope.contextId||payload.preview.requestId!==job.job_id||slot.jobId!==job.job_id||!model3dMiniAppAttemptMatches(payload.preview,slot)
   ||await outputDigest(refreshed)!==slot.routeDigest)throw new OutputConflictError("output_model3d_original_attempt_required",403);
  requireModel3dMiniAppCostApproval(parsed(job.request_json).model3dCostConsent,model3dPayload.preview,payload.preview);
  model3dAssertions.splice(0,model3dAssertions.length,...proof);
 }:undefined;
 if(refreshModel3d)await refreshModel3d();
 const audioPayload=audioProof?readOutputAudioPayload(settings.payload):null;
 const refreshAudio=audioProof?async()=>{
  const refreshed=await preflightOutputNativeTarget({env,request:new Request("https://output-execution.invalid"),scope,principal:user,confirmedPlan:authority.confirmedPlan,target:authority.target,context:authority.context,ownerHead:authority.sourceEpoch.head,sourceEvents:authority.events,sourceAssertions:authority.assertions,sourceDigest:authority.sourceDigest,requirementsDigest:authority.requirementsDigest});
  const proof=outputAudioPreflightAssertions(refreshed),preview=parseAudioMiniAppCostPreview((refreshed.settings as Record<string,unknown>).costPreview);
  if(!audioPayload||!proof||!preview||preview.requestId!==job.job_id||slot.jobId!==job.job_id||slot.attemptOrdinal!==0||slot.previousSlotId||await outputDigest(refreshed)!==slot.routeDigest)throw new OutputConflictError("output_audio_source_changed",403);
  requireAudioMiniAppCostApproval(parsed(job.request_json).audioCostConsent,(settings as unknown as Record<string,unknown>).costPreview,preview);
  audioAssertions.splice(0,audioAssertions.length,...proof);
 }:undefined;
 if(refreshAudio)await refreshAudio();
 const scenePayload=sceneProof?await readOutputScenePayload(settings.payload):null;
 let scenePreflight=current;
 const refreshScene=sceneProof?async()=>{
  // Request-local custody only: a committed successor requires a new reduction.
  // An unchanged version rechecks every original predicate, never recaptures
  // authority after a failed check or caches consent across requests.
  const captured=outputScenePreflightProof(scenePreflight);
  const reused=Boolean(sceneStored&&captured?.prepared.sourceVersion
    &&JSON.stringify(captured.prepared.sourceVersion)===JSON.stringify(sceneStored.witness.successor));
  const refreshed=reused?scenePreflight:await preflightOutputNativeTarget({env,request:new Request("https://output-execution.invalid"),scope,principal:user,confirmedPlan:authority.confirmedPlan,target:authority.target,context:authority.context,ownerHead:authority.sourceEpoch.head,sourceEvents:authority.events,sourceAssertions:authority.assertions,sourceDigest:authority.sourceDigest,requirementsDigest:authority.requirementsDigest,...(sceneStored?{sceneSourceVersion:sceneStored.witness.successor}:{})});
  const proof=outputScenePreflightProof(refreshed);
  const payload=refreshed.available?await readOutputScenePayload((refreshed.settings as OutputNativeSettings).payload):null;
  if(!proof||!payload||!scenePayload||proof.requestId!==job.job_id||proof.requestId!==slot.jobId||slot.attemptOrdinal!==0||slot.previousSlotId
    ||await outputDigest(refreshed)!==slot.routeDigest)throw new OutputConflictError("output_scene_source_changed",403);
  requireSceneMiniAppCostApproval(parsed(job.request_json).sceneCostConsent,scenePayload.outputScene.costPreview,payload.outputScene.costPreview);
  if(reused){
   const assertions=proof.sourceAssertions;
   const expired=()=>!Number.isFinite(Date.parse(proof.expiresAt))||Date.now()>=Date.parse(proof.expiresAt)
     ||assertions.some(value=>value.deadlineMs!==undefined&&(!Number.isFinite(value.deadlineMs)||Date.now()>=value.deadlineMs));
   if(!assertions.length||expired())throw new OutputConflictError("output_scene_source_changed",409);
   const checked=await env.DB.batch<Record<string,unknown>>(outputProofReadStatements(env,assertions));
   if(!Array.isArray(checked)||checked.length!==assertions.length
     ||Array.from({length:assertions.length},(_,index)=>checked[index]).some(result=>!result||result.success!==true
       ||!Array.isArray(result.results)||result.results.length!==1||result.results[0]?.current!==1)
     ||expired())throw new OutputConflictError("output_scene_source_changed",409);
  }
  scenePreflight=refreshed;
  sceneAssertions.splice(0,sceneAssertions.length,...proof.sourceAssertions);
  return proof.prepared;
 }:undefined;
 if(refreshScene)await refreshScene();
 const billingOwner=financial?.payerUserId??user.billingUserId??user.userId;
 const checkpoint=parsed(job.result_json);
 const period=checkpoint.costReservationPeriod;
 const artifactKind=job.kind==="generate"?"image":String(settings.payload.artifactKind);
 const operation=job.kind==="generate"?"image-generation":`document-render:${artifactKind}`;
 if(typeof period!=="string"||!/^\d{4}-\d{2}$/u.test(period)||checkpoint.reservationId!==slot.tokenReservationId||checkpoint.costReservationId!==slot.costReservationId||checkpoint.costReservationMicrousd!==slot.maximumMicrousd)throw new OutputConflictError("output_admitted_reservations_missing",409);
 const periodDeadline=Date.parse(`${period}-01T00:00:00.000Z`);
 const nextPeriod=Number.isFinite(periodDeadline)?new Date(periodDeadline):null;
 nextPeriod?.setUTCMonth(nextPeriod.getUTCMonth()+1);
 const dispatchDeadline=Math.min(nextPeriod?.getTime()??0,...[...(sponsor?.assertions??[]),...authority.assertions,...sceneAssertions,...audioAssertions,...model3dAssertions,...storyboardSourceAssertions,...videoSourceAssertions].flatMap(assertion=>assertion.deadlineMs===undefined?[]:[Number.isFinite(assertion.deadlineMs)?assertion.deadlineMs:0]));
 let dispatchStopError:OutputConflictError|null=null;
 const assertDispatchDeadline=()=>{if(dispatchStopError)throw dispatchStopError;const leaseDeadline=Date.parse(String(job.lease_expires_at));if(!Number.isFinite(dispatchDeadline)||!Number.isFinite(leaseDeadline)||Date.now()>=Math.min(dispatchDeadline,leaseDeadline)){
  dispatchStopError=new OutputConflictError("output_execution_deadline_expired",403);throw dispatchStopError;
 }};
 const localStops=new Set<string>();
 const claimedCalls=new Map<string,{callKey:string;provider:string;model:string;operation:string;pending:boolean;dispatched:boolean;settled?:boolean;requestDigest:string;storyboardBinding?:string;checkpointed:boolean}>();
 const observedReceipts=new Map(providerSubmissions(checkpoint).map(receipt=>[receipt.clientRequestId,receipt]));
 const reference={scopeKey:slot.scopeKey,grantId:slot.grantId,slotId:slot.slotId,planRevisionId:slot.planRevisionId,targetId:slot.targetId,targetContractDigest:slot.targetContractDigest,sourceDigest:slot.sourceDigest};
 const guardedEnvironment=guardOutputPrivateWrites(env,scope,slot,async()=>liveAssertions(),{retentionPolicy:binding.retentionPolicy,storyboardCompletionJson:()=>storyboardCompletionJson,videoCompletionJson:()=>videoCompletionJson,model3dCompletionJson:()=>model3dCompletionJson});
 let publicationScopesComplete=scope.kind==="personal";
 return {guardedEnvironment,financialPayerUserId:billingOwner,...(financial?{financialAssertions:[financial.assertion],sponsorFinancialBinding:sponsor!.financial}:{}),...(sceneProof?{withSourceTransition:outputSourceTransition()}:{}),...(model3dPayload&&refreshModel3d?{model3d:{
  async prepare(receipt:Model3dPreparedReceipt){
   await refreshModel3d();assertDispatchDeadline();
   model3dPrepared=await verifyModel3dPreparedReceipt(model3dPayload,receipt);
   await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));
   // A resumed adapter performs only original-ID GETs. Restore observation of
   // its one existing durable call, never claim another call or infer rejection.
   const original=await env.DB.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=? LIMIT 2").bind(scope.key,slot.slotId).all<Record<string,unknown>>();
   const retained=[...observedReceipts.values()];
   if(original.success===false)throw new OutputConflictError("output_model3d_original_receipt_unavailable",403);
   if(original.results.length||retained.length){
    const call=original.results[0],saved=retained[0];
    if(original.results.length!==1||retained.length!==1||!call||!saved||call.call_key!=="model3d:initial"||call.stage_key!=="model3d:initial"
     ||call.provider!=="fal"||call.model!==model3dPrepared.model||call.request_digest!==model3dPrepared.requestDigest
     ||call.reserved_microusd!==model3dPayload.preview.maximumMicrousd||!['uncertain','settled'].includes(String(call.status))
     ||saved.provider!=="fal"||saved.operation!=="model3d"||saved.model!==call.model||!['accepted','completed'].includes(saved.status)
     ||!saved.providerRequestId||saved.providerRequestId!==call.provider_response_id||saved.clientRequestId!==call.client_request_id
     ||call.status==='settled'&&(saved.status!=='completed'||saved.costMicrousd!==call.used_microusd||saved.totalTokens!==0))
      throw new OutputConflictError("output_model3d_original_receipt_unavailable",403);
    claimedCalls.set(saved.clientRequestId,{callKey:"model3d:initial",provider:"fal",model:saved.model,operation:"model3d",pending:true,dispatched:true,
     settled:call.status==='settled',requestDigest:model3dPrepared.requestDigest,checkpointed:true});
   }
   await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));
   assertDispatchDeadline();
  },
  async qualify(primary:Model3dGeneratedFile,providerRequestId:string){
   if(!model3dPrepared)throw new OutputConflictError("output_model3d_preparation_missing",403);
   model3dQualified=await qualifyOutputModel3dCompletion({offer:model3dPayload,prepared:model3dPrepared,calls:[...observedReceipts.values()],providerRequestId,primary});
   await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));
   return model3dQualified;
  },
  async complete(artifactId:string,files:readonly unknown[],receipt:Awaited<ReturnType<typeof qualifyOutputModel3dCompletion>>){
   model3dCompletionJson=undefined;
   const captured=projectNativeRetainedModel3d({artifact_kind:"model3d",settings:{model3d_files:captureModel3dComparisonData(files)}});
   if(!model3dQualified||receipt!==model3dQualified||!artifactId||artifactId.length>200||!captured)throw new OutputConflictError("output_model3d_completion_invalid",403);
   const primary=captured.files[0];
   if(!primary||primary.sha256!==receipt.primarySha256||primary.fileSize!==receipt.primaryByteLength||primary.format!=="glb"||primary.role!=="mesh"||primary.mimeType!=="model/gltf-binary"
    ||typeof primary.url!=="string"||!primary.url.startsWith("/api/media/"))throw new OutputConflictError("output_model3d_completion_invalid",403);
   await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));
   const completion={schemaVersion:1,jobId:job.job_id,actorUserId:scope.actorUserId,documentId:scope.documentId,projectId:scope.projectId,artifactId,
    execution:reference,contract:model3dPayload.contract,costPreview:model3dPayload.preview,receipt,files:captured.files};
   model3dCompletionJson=JSON.stringify(completion);
   return completion;
  }
 }}:{}),...(refreshAudio?{refreshAudio,
  async readAudioEnvelope(responseRef:string){
   if(scope.kind!=="personal"||!responseRef)throw new OutputConflictError("output_audio_envelope_unavailable",403);
   const row=await env.DB.prepare("SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)").bind(responseRef,scope.actorUserId).first<{content:string;expires_at:string}>();
   if(!row)throw new OutputConflictError("output_audio_envelope_unavailable",403);
   sceneEnvelopeAssertions.push({sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",bindings:[responseRef,scope.actorUserId,row.content,row.expires_at],deadlineMs:Date.parse(row.expires_at)});
   await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));return row.content;
  }
 }:{}),...(refreshScene?{refreshScene,
  async providerNotDispatched(attempt:ProviderAttemptPreflight){
   if(!scenePayload||claimedCalls.get(attempt.clientRequestId)?.dispatched||localStops.has(attempt.clientRequestId))return;
   await assertOutputSceneAttempt(settings,attempt);
   localStops.add(attempt.clientRequestId);
   await recordOutputSceneLocalStop(env,{job,scope,slot,billingOwner,bindingHash:scenePayload.outputScene.costPreview.bindingHash,attempt});
  },
  async readSceneEnvelope(responseRef:string){
   if(scope.kind!=="personal"||!responseRef)throw new OutputConflictError("output_scene_envelope_unavailable",403);
   const row=await env.DB.prepare("SELECT content,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)").bind(responseRef,scope.actorUserId).first<{content:string;expires_at:string}>();
   if(!row)throw new OutputConflictError("output_scene_envelope_unavailable",403);
   sceneEnvelopeAssertions.push({sql:"EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response' AND content=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id))",bindings:[responseRef,scope.actorUserId,row.content,row.expires_at],deadlineMs:Date.parse(row.expires_at)});
   await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));
   return row.content;
  }}:{}),
  dispatchStop:error=>dispatchStopError!==null&&error===dispatchStopError?{code:"output_execution_deadline_expired",category:"access",scope:"project",action:"check_project",
   message:"The current source or execution authorization expired before this provider call could be sent. Earlier usage and unresolved allowances are retained; check current access before starting other work.",retryable:false,retryAfterMs:null,requestId:null,httpStatus:403}:null,
  sourceEvents:authority.events,sourceHead:authority.head,
  async eventAppendCommitted(events){
   if(!events.length||events.length>8||events.some(event=>event.streamId!==job.stream_id||event.correlationId!==job.correlation_id))return false;
   let recoveredScene:NonNullable<typeof sceneStored>|undefined;
   if(sceneStored){
    try{const candidate=await readSceneJobSourceWitness(env,scope,slot,job.correlation_id);
     if(candidate.witness.phase!=='execution'||JSON.stringify(candidate.witness.predecessor)!==JSON.stringify(sceneStored.witness.successor)
       ||JSON.stringify(candidate.witness.eventIds)!==JSON.stringify(events.map(event=>event.eventId))
       ||JSON.stringify(candidate.witness.eventSequences)!==JSON.stringify(events.map(event=>event.sequence)))return false;
     recoveredScene=candidate;
    }catch{return false;}
   }else if(refreshScene)await refreshScene();
   if(refreshAudio)await refreshAudio();if(refreshModel3d&&!model3dPublication?.hasPublication())await refreshModel3d();
   const checks=events.map(event=>{const values=eventWriteBindings(event);
    return env.DB.prepare(`SELECT 1 AS present FROM events stored LEFT JOIN event_private_payloads body ON body.private_event_id=stored.event_id
      WHERE stored.event_id=? AND stored.stream_id=? AND stored.sequence=? AND stored.occurred_at=? AND stored.recorded_at=?
       AND stored.actor=? AND stored.client_id=? AND stored.correlation_id=? AND stored.causation_id IS ? AND stored.compensates_event_id IS ? AND stored.schema_version=? AND stored.type=? AND stored.payload=?
       AND (? IS NULL AND body.private_event_id IS NULL OR ? IS NOT NULL AND body.owner_id=? AND body.project_id IS ? AND body.document_id IS ? AND body.private_json=? AND body.redacted_at IS NULL)`)
     .bind(...values.slice(0,13),values[16],values[16],values[13],values[14],values[15],values[16]);
   });
   try{const statements=[...liveAssertions(recoveredScene).flatMap(assertion=>outputAssertionStatements(env,assertion)),...checks],results=await env.DB.batch(statements);
    if(!Array.isArray(results)||results.length!==statements.length||Array.from({length:statements.length},(_,i)=>i).some(i=>results[i]?.success!==true)
      ||results.slice(-checks.length).some(result=>!Array.isArray(result.results)||result.results.length!==1||(result.results[0] as {present?:unknown}|undefined)?.present!==1))return false;
    if(recoveredScene){sceneStored=recoveredScene;sceneTransition=null;await refreshScene?.();}return true;}
   catch{return false;}
  },
  eventWriteSidecars:events=>{
   model3dPublication?.capture(events,model3dCompletionJson);
   sceneTransition=sceneStored?prepareSceneJobSourceTransition(env,{scope,slot,correlationId:job.correlation_id,
     predecessor:sceneStored.witness.successor,previousRaw:sceneStored.raw,phase:'execution',events}):null;
   return [
   // Shared publication already checks its entire range in the project
   // sidecars. Personal jobs need the same rollback when a concurrent open
   // advances the head between individual guarded event INSERTs.
   ...(scope.kind==="personal"&&events.length?outputAssertionStatements(env,{sql:`(SELECT COUNT(*) FROM events WHERE event_id IN(SELECT value FROM json_each(?)))=?
     OR (NOT EXISTS(SELECT 1 FROM events WHERE event_id IN(SELECT value FROM json_each(?))) AND (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)<>?)`,
    bindings:[JSON.stringify(events.map(event=>event.eventId)),events.length,JSON.stringify(events.map(event=>event.eventId)),job.stream_id,events[0]!.sequence-1]}):[]),
   ...prepareOutputImageProviderHealth(env,{job,slot,events,routes:settings.calls,claimedCalls,observedReceipts}),...prepareOutputNativeProjectPublicationStatements(env,{scope,slot,job},events),...(sceneTransition?.after??[])];
  },
  eventWriteCommitted:results=>{if(scope.kind==="project")publicationScopesComplete=Number(results.at(-1)?.meta.changes??0)===1;
    if(sceneTransition){const receipt=sceneTransition.acknowledge(results.slice(-sceneTransition.after.length));
      sceneStored=sceneJobSourceWitnessAssertions(scope,slot,job.correlation_id,receipt.raw);sceneTransition=null;}},
  publicationScopesComplete:()=>publicationScopesComplete,reference,settings:settings.payload,...(settings.imageRender?{imageRender:settings.imageRender}:{}),reservations:{reservationId:slot.tokenReservationId,costReservationId:slot.costReservationId,costReservationPeriod:period,costReservationMicrousd:slot.maximumMicrousd,maximumTokens:slot.maximumTokens},
  async assertContext(context){if(context.documentRevision!==authority.context.documentRevision||await outputDigest(context.snapshot)!==await outputDigest(authority.context.snapshot))throw new OutputConflictError("output_source_changed",409);},
  async retainFalImageRequest(request,planning){
   const call=claimedCalls.get(request.attempt.clientRequestId);
   if(!call||call.callKey!=="image:initial"||call.provider!=="fal"||call.model!==request.contract.model||call.pending||call.dispatched)throw new OutputConflictError("output_fal_checkpoint_call_mismatch",403);
   await retainOutputFalImageCheckpoint(guardedEnvironment,user,job,scope,slot,request,planning);
  },
  async retainStoryboardFrameRequest(request,plan,frameIndex){
   const mapped=await storyboardFrameRequest(plan,frameIndex,request),call=claimedCalls.get(request.attempt.clientRequestId);
   if(!call||artifactKind!=="storyboard"||call.callKey!==mapped.attempt.logicalCallKey||call.requestDigest!==mapped.attempt.requestDigest
     ||call.storyboardBinding!==plan.bindingSha256||call.provider!=="fal"||call.model!==request.contract.model||call.pending||call.dispatched||call.checkpointed)throw new OutputConflictError("output_storyboard_checkpoint_call_mismatch",403);
   await retainStoryboardFrameCheckpoint(guardedEnvironment,user,job,scope,slot,request,plan,frameIndex);
   call.checkpointed=true;
  },
  async retainStoryboardEnvelope(envelope){
   const call=claimedCalls.get(envelope.clientRequestId);
   if(artifactKind!=="storyboard"||!call||call.callKey!=="planning:0:initial"||!call.pending||!call.dispatched||!call.checkpointed
    ||call.requestDigest!==envelope.requestDigest||call.provider!==envelope.provider||call.model!==envelope.model)throw new OutputConflictError("output_storyboard_envelope_call_mismatch",403);
   await retainStoryboardRawEnvelopeCheckpoint(guardedEnvironment,scope,slot,job,envelope);
  },
  async verifyStoryboardCompletion(artifactId,artifact,frames,lifetime){
   storyboardCompletionJson=undefined;
   if(artifactKind!=="storyboard")throw new OutputConflictError("output_storyboard_completion_invalid",403);
   const deadlineMs=Math.min(lifetime?.deadlineMs??Infinity,dispatchDeadline,Date.parse(String(job.lease_expires_at)),Date.parse(job.expires_at));
   const verified=await verifyOutputStoryboardCompletion(env,scope,slot,job,settings.payload,artifactId,artifact,frames,{signal:lifetime?.signal,deadlineMs});
   storyboardCompletionAssertions.splice(0,storyboardCompletionAssertions.length,...verified.assertions);
   await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));
   storyboardCompletionJson=JSON.stringify(verified.receipt);
   return verified.receipt;
  },
  storyboardMediaDeadlineMs(){
   // Capture this value once per read. Heartbeats may update the existing lease,
   // but a running read never renews its captured deadline or original source TTL.
   const deadline=Math.min(dispatchDeadline,Date.parse(String(job.lease_expires_at)),Date.parse(job.expires_at));
   return artifactKind==="storyboard"&&Number.isFinite(deadline)?deadline:0;
  },
  videoMediaDeadlineMs(){return artifactKind==="video"?Math.min(dispatchDeadline,Date.parse(String(job.lease_expires_at)),Date.parse(job.expires_at)):0;},
  async verifyVideoCompletion(artifactId,artifact,lifetime){
   videoCompletionJson=undefined;
   if(artifactKind!=="video")throw new OutputConflictError("output_video_completion_invalid",403);
   const deadlineMs=Math.min(lifetime.deadlineMs,dispatchDeadline,Date.parse(String(job.lease_expires_at)),Date.parse(job.expires_at));
   const verified=await verifyOutputVideoCompletion(env,scope,slot,job,settings.payload,artifactId,artifact,{...lifetime,deadlineMs});
   videoCompletionAssertions.splice(0,videoCompletionAssertions.length,...verified.assertions);
   await env.DB.batch(liveAssertions().flatMap(a=>outputAssertionStatements(env,a)));videoCompletionJson=JSON.stringify(verified.receipt);return verified.receipt;
  },
  async withVideoLease(lease,work){
   if(artifactKind!=="video"||videoHook)throw new OutputConflictError("output_video_hook_invalid",403);
   lease.assertCurrent();videoHook=lease;
   try{const value=await work();lease.assertCurrent();return value;}finally{videoHook=null;}
  },
  async readVideoReference(lease){
   if(artifactKind!=="video"||videoHook!==lease)throw new OutputConflictError("output_video_hook_invalid",403);
   return readOutputVideoReference(currentInput,lease,async()=>{await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));});
  },
  async retainVideoPlannerEnvelope(envelope,lease){
   const call=claimedCalls.get(envelope.clientRequestId);
   if(artifactKind!=="video"||videoHook!==lease||!call||call.callKey!=="planning:0:initial"||!call.pending||!call.dispatched||!call.checkpointed||call.requestDigest!==envelope.requestDigest)throw new OutputConflictError("output_video_envelope_call_mismatch",403);
   await retainOutputVideoPlannerEnvelope(guardedEnvironment,scope,slot,job,envelope,lease);
  },
  async retainVideoMediaEnvelope(envelope,lease){
   const call=claimedCalls.get(envelope.clientRequestId);
   if(artifactKind!=="video"||videoHook!==lease||!call||call.callKey!=="video:initial"||!call.pending||!call.dispatched||!call.checkpointed||call.requestDigest!==envelope.requestDigest)throw new OutputConflictError("output_video_envelope_call_mismatch",403);
   await retainOutputVideoMediaEnvelope(guardedEnvironment,scope,slot,job,envelope,lease);
  },
  async beforeSourceTransmission(){if(refreshAudio)await refreshAudio();if(refreshModel3d){await refreshModel3d();assertDispatchDeadline();}await env.DB.batch(liveAssertions().flatMap(assertion=>outputAssertionStatements(env,assertion)));},
  async beforeProviderAttempt(attempt,lease){
   if(artifactKind==="video"&&(!lease||videoHook!==lease))throw new OutputConflictError("output_video_hook_invalid",403);
   lease?.assertCurrent();
   if(refreshAudio)await refreshAudio();if(refreshModel3d)await refreshModel3d();assertDispatchDeadline();
   if(model3dPayload)assertModel3dPreparedAttempt(model3dPayload,model3dPrepared,attempt);
   const callKey=attempt.logicalCallKey;
   const route=settings.calls.find(route=>route.stage===callKey);
   if(!callKey||!route||route.model!==attempt.model||!attempt.requestDigest||!Number.isSafeInteger(attempt.maximumInputTokens)||!Number.isSafeInteger(attempt.maximumOutputTokens)||attempt.maximumInputTokens<0||attempt.maximumOutputTokens<0)throw new OutputConflictError("output_provider_stage_not_authorized",403);
   if(artifactKind==="slides"&&(!route.presentationRoute||!attempt.presentationRoute
    ||!Number.isSafeInteger(route.maximumInputTokens)||attempt.maximumInputTokens>Number(route.maximumInputTokens)
    ||attempt.maximumOutputTokens!==route.maximumOutputTokens
    ||await outputDigest(attempt.presentationRoute)!==await outputDigest(route.presentationRoute)))throw new OutputConflictError("output_provider_route_changed",403);
   if(artifactKind==="short_story"||attempt.narrative!==undefined){try{await assertOutputNarrativeAttempt(settings,attempt);}catch{throw new OutputConflictError("output_narrative_request_not_authorized",403);}}
   if(scenePayload||attempt.scene!==undefined){try{await assertOutputSceneAttempt(settings,attempt);}catch{throw new OutputConflictError("output_scene_request_not_authorized",403);}}
   if(artifactKind==="video"){
    if(callKey==="planning:0:initial")await assertVideoPlannerAttempt(settings.payload.outputVideoPlanner,attempt);
    else if(callKey==="video:initial"&&attempt.video){
     const captured=await captureOutputVideoAttempt(settings.payload.outputVideo,attempt.video.requestBody,attempt.clientRequestId);
     if(await outputDigest(captured)!==await outputDigest(attempt))throw new OutputConflictError("output_video_request_not_authorized",403);
    }else throw new OutputConflictError("output_video_request_not_authorized",403);
    lease!.assertCurrent();
   }else if(attempt.video||attempt.videoPlanning)throw new OutputConflictError("output_video_request_not_authorized",403);
   const storyboardPlanning=artifactKind==="storyboard"&&callKey.startsWith("planning:")||attempt.storyboardPlanning!==undefined?await readStoryboardPlannerAttempt(attempt,settings.payload.outputStoryboardPlanner):null;
   if(storyboardPlanning&&(artifactKind!=="storyboard"||route.provider!=="openai"||scope.kind!=="personal"))throw new OutputConflictError("output_storyboard_planner_not_authorized",403);
   const storyboard=callKey.startsWith("image:frame:")||attempt.storyboard!==undefined?await readStoryboardFrameAttempt(attempt,settings.payload.outputStoryboard,settings.payload.outputStoryboardPlanner):null;
   if(storyboard&&(artifactKind!=="storyboard"||route.provider!=="fal"||scope.kind!=="personal"))throw new OutputConflictError("output_storyboard_request_not_authorized",403);
   if(audioPayload||attempt.audio!==undefined){try{await assertOutputAudioAttempt(settings,attempt);}catch{throw new OutputConflictError("output_audio_request_not_authorized",403);}}
   const fal=route.provider==="fal"&&(callKey==="image:initial"||storyboard)?readOutputFalImageContract(settings.payload.outputFalImage):null;
   if((route.provider==="fal"&&(callKey==="image:initial"||storyboard)||attempt.falImage!==undefined)&&(!fal
     ||await outputDigest(attempt.falImage)!==await outputDigest(fal)||attempt.maximumInputTokens!==0||attempt.maximumOutputTokens!==0))throw new OutputConflictError("output_fal_request_outside_contract",403);
   const priorTokens=[...observedReceipts.values()].filter(receipt=>receipt.status==="completed").reduce((sum,receipt)=>sum+Number(receipt.totalTokens??0),0);
   if(priorTokens+attempt.maximumInputTokens+attempt.maximumOutputTokens>slot.maximumTokens)throw new OutputConflictError("output_token_allowance_exceeded",429);
   const maximumUsage={inputTokens:attempt.maximumInputTokens,outputTokens:attempt.maximumOutputTokens,totalTokens:attempt.maximumInputTokens+attempt.maximumOutputTokens};
   const pricedMaximum=artifactKind==="video"&&callKey==="video:initial"?outputVideoMediaPrice().maximumMicrousd:audioPayload&&callKey==="audio:initial"?Number(settings.payload.audioEstimatedCostMicrousd):fal?fal.estimatedMicrousd:callKey==="model3d:initial"?estimateModel3dCostMicrousd(settings.payload.model3dSettings)
     :route.presentationRoute||artifactKind==="short_story"||scenePayload||audioPayload||storyboardPlanning||artifactKind==="video"?estimateOpenAITextCallMaximumMicrousd(attempt.model,attempt.maximumInputTokens,attempt.maximumOutputTokens)
    :callKey.startsWith("planning")?priceTextUsageBreakdownMicrousd(attempt.model,maximumUsage).totalMicrousd:priceImageUsageBreakdownMicrousd(attempt.model,{...maximumUsage,textInputTokens:attempt.maximumInputTokens,imageInputTokens:0},false).totalMicrousd;
   if(pricedMaximum>route.maximumMicrousd)throw new OutputConflictError("output_call_cost_allowance_exceeded",429);
   const assertions:OutputSqlAssertion[]=[...liveAssertions(),...(storyboard?[storyboardFrameSequenceAssertion(scope,slot,job,storyboard.frameIndex,storyboard.plan.bindingSha256)]:[]),{sql:`EXISTS(SELECT 1 FROM document_jobs live WHERE live.job_id=? AND live.owner_id=? AND live.stream_id=? AND live.correlation_id=? AND live.attempt_count=? AND live.status='running'
      AND live.lease_expires_at>MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND NOT EXISTS(SELECT 1 FROM json_each(COALESCE(json_extract(live.result_json,'$.providerSubmissions'),'{}')) receipt
        WHERE json_extract(receipt.value,'$.status')='completed' AND (COALESCE(json_type(receipt.value,'$.totalTokens'),'')<>'integer' OR json_extract(receipt.value,'$.totalTokens')<0))
      AND (SELECT COALESCE(SUM(CASE WHEN json_extract(receipt.value,'$.status')='completed' THEN json_extract(receipt.value,'$.totalTokens') ELSE 0 END),0)
        FROM json_each(COALESCE(json_extract(live.result_json,'$.providerSubmissions'),'{}')) receipt)+?<=?)`,bindings:[job.job_id,user.userId,job.stream_id,job.correlation_id,job.attempt_count,new Date().toISOString(),attempt.maximumInputTokens+attempt.maximumOutputTokens,slot.maximumTokens]},
    {sql:`EXISTS(SELECT 1 FROM cost_budget_reservations cost JOIN budget_reservations token
      ON token.owner_id=cost.owner_id AND token.stream_id=cost.stream_id AND token.correlation_id=cost.correlation_id AND token.period=cost.period AND token.operation=cost.operation
      WHERE cost.reservation_id=? AND token.reservation_id=? AND cost.owner_id=? AND cost.stream_id=? AND cost.correlation_id=? AND cost.operation=? AND cost.period=?
       AND cost.reserved_microusd=? AND token.reserved_tokens=? AND cost.status='executing' AND token.status='active')`,bindings:[slot.costReservationId,slot.tokenReservationId,billingOwner,job.stream_id,job.correlation_id,operation,period,slot.maximumMicrousd,slot.maximumTokens]}];
   const claim=await claimOutputProviderCall(env,{scope,slotId:slot.slotId,jobId:slot.jobId,callKey,clientRequestId:attempt.clientRequestId,requestDigest:attempt.requestDigest,routeDigest:slot.routeDigest,stageKey:callKey,provider:route.provider,model:route.model,maximumMicrousd:route.maximumMicrousd,expectedHead:authority.head,sourceEpoch:authority.sourceEpoch,sourceDigest:authority.sourceDigest,assertions});
   if(!claim.claimed)throw new OutputConflictError("output_provider_call_already_consumed",409);
   claimedCalls.set(attempt.clientRequestId,{callKey,provider:route.provider,model:route.model,operation:callKey.startsWith("planning:")?"planning":callKey==="audio:initial"?"audio":callKey==="model3d:initial"?"model3d":callKey==="video:initial"?"video":"image",pending:false,dispatched:false,requestDigest:attempt.requestDigest,checkpointed:false,...(storyboard?{storyboardBinding:storyboard.plan.bindingSha256}:{})});
   if(artifactKind==="video"){lease!.assertCurrent();await retainOutputVideoRequestCheckpoint(guardedEnvironment,scope,slot,job,attempt,lease!);claimedCalls.get(attempt.clientRequestId)!.checkpointed=true;}
   if(storyboardPlanning){const claimed=claimedCalls.get(attempt.clientRequestId)!;claimed.storyboardBinding=storyboardPlanning.requestDigest;
    await retainStoryboardPlannerRequestCheckpoint(guardedEnvironment,scope,slot,job,storyboardPlanning);claimed.checkpointed=true;}
  },
  beforeProviderDispatch(clientRequestId){
   if(outputJobIsDurable(job)) assertOutputDurableLease(env,job.job_id);
   const call=claimedCalls.get(clientRequestId);
   if(!call||!call.pending||call.dispatched||localStops.has(clientRequestId)||(call.storyboardBinding||artifactKind==="video")&&!call.checkpointed)throw new OutputConflictError("output_provider_call_missing",403);
   // No await may separate this check from the actual adapter fetch. A denial
   // leaves the existing pending call/holds unresolved; it is not a provider rejection.
   assertDispatchDeadline();call.dispatched=true;
  },
  async observeProvider(receipt){
   const call=claimedCalls.get(receipt.clientRequestId);
   if(!call||receipt.provider!==call.provider||receipt.model!==call.model||receipt.operation!==call.operation)throw new OutputConflictError("output_provider_call_missing",403);
   // The immutable pending call already exists before the adapter's legacy
   // checkpoint. A failed checkpoint keeps that durable exposure reserved.
   if(receipt.status==="pending"){call.pending=true;return;}
   // The independent operational checkpoint contains payment identities/counts only.
   // It remains writable after erasure and never copies an in-memory source/result body.
   const safe:PaidProviderSubmission={clientRequestId:receipt.clientRequestId,provider:receipt.provider,operation:receipt.operation,model:receipt.model,status:receipt.status};
   if(receipt.providerRequestId)safe.providerRequestId=receipt.providerRequestId;
   for(const key of ["costMicrousd","inputTokens","outputTokens","totalTokens"] as const)if(Number.isSafeInteger(receipt[key])&&Number(receipt[key])>=0)safe[key]=receipt[key];
   const observation=Object.fromEntries(Object.entries(receipt).filter(([,value])=>value!==undefined));
   const observations=new Map(Object.entries(mergeProviderSubmissions(Object.fromEntries(observedReceipts),{[receipt.clientRequestId]:observation})));
   const planning=[...observations.values()].filter(value=>value.operation==="planning"&&value.status==="completed");
   const plannerFields=receipt.operation==="planning"&&receipt.status==="completed"?{plannerModel:receipt.model,plannerResponseId:receipt.providerRequestId??"",plannerResponseIds:planning.map(value=>value.providerRequestId).filter(Boolean),plannerUsage:planning.reduce((total,value)=>({inputTokens:total.inputTokens+Number(value.inputTokens??0),outputTokens:total.outputTokens+Number(value.outputTokens??0),totalTokens:total.totalTokens+Number(value.totalTokens??0)}),{inputTokens:0,outputTokens:0,totalTokens:0})}:{};
   const financialPatch={...plannerFields,providerSubmissionProtocol:1,providerSubmissions:{[receipt.clientRequestId]:safe},reservationId:slot.tokenReservationId,costReservationId:slot.costReservationId,costReservationPeriod:period,costReservationMicrousd:slot.maximumMicrousd,
    ...(artifactKind==="slides"?{presentationProviderSubmission:"confirmed"}:{}),
    generationReceipt:{provider:receipt.provider,model:receipt.model,artifact_kind:artifactKind,provider_request_status:"submitted",source_transmission_status:"transmitted",reservation_status:"executing"}};
   if(artifactKind==="video"&&!videoHook)throw new OutputConflictError("output_video_hook_invalid",403);
   const financialCheckpoint=prepareOutputProviderFinancialCheckpoint(env,{scopeKey:scope.key,slotId:slot.slotId,callKey:call.callKey,
    jobId:job.job_id,ownerId:user.userId,streamId:job.stream_id,correlationId:job.correlation_id,receipt:safe,patch:financialPatch});
   const observationAssertions=[...(financial?[financial.assertion]:[]),...(artifactKind==="video"?videoLifetimeAssertions():[])];
   const known=Number.isSafeInteger(receipt.costMicrousd)&&Number(receipt.costMicrousd)>=0;
   try{
    await settleOutputProviderCall(env,{assertions:observationAssertions,financialCheckpoint,scopeKey:scope.key,slotId:slot.slotId,callKey:call.callKey,clientRequestId:receipt.clientRequestId,status:receipt.status==="rejected"?"rejected":receipt.status==="completed"&&known?"settled":"uncertain",usedMicrousd:receipt.status==="rejected"?0:receipt.status==="completed"&&known?Number(receipt.costMicrousd):null,...(receipt.providerRequestId?{providerResponseId:receipt.providerRequestId}:{})});
   }catch(error){
    // Preserve the existing source-free reconciliation witness if a transient
    // ledger/storage fault prevents the combined commit. This is not successful
    // settlement. The same monotonic receipt and canonical call predicates make
    // the fallback refuse conflicting IDs, terminal regressions and stale Video
    // authority; maintenance can settle an exact retained receipt later.
    if(!(error instanceof OutputConflictError))try{
     await retainUnsettledOutputProviderObservation(env,financialCheckpoint,observationAssertions);
    }catch{/* The original failure and pending provider call retain uncertainty. */}
    throw error;
   }
   observedReceipts.set(receipt.clientRequestId,observations.get(receipt.clientRequestId)!);
   call.settled=receipt.status==="completed"&&known;
   // Subsequent private progress/candidate writes carry the same live SQL proof;
   // retaining this monetary witness does not itself authorize any private write.
  },
 };
}

/** Projection only: job/receipt truth wins and never creates a new grant or job. */
export function prepareOutputJobOutcomeStatements(env:WorkerEnv,job:Pick<DocumentJobRow,"job_id"|"stream_id"|"correlation_id">,terminalWitness?:{completedAt:string;resultJson:string}){
 const now=new Date().toISOString();
 const witnessSql=terminalWitness?" AND live.status='failed' AND live.completed_at=? AND live.result_json IS ?":"";
 const witnessBindings=terminalWitness?[terminalWitness.completedAt,terminalWitness.resultJson]:[];
 const slotUpdate=env.DB.prepare(`UPDATE output_operation_slots SET status=CASE
  WHEN EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=output_operation_slots.scope_key AND calls.slot_id=output_operation_slots.slot_id AND calls.status IN('pending','uncertain')) THEN 'uncertain'
  ELSE CASE (SELECT live.status FROM document_jobs live WHERE live.job_id=output_operation_slots.job_id AND live.stream_id=? AND live.correlation_id=?)
   WHEN 'completed' THEN 'succeeded' WHEN 'failed' THEN 'failed' WHEN 'partial' THEN 'failed' WHEN 'canceled' THEN 'cancelled'
   WHEN 'running' THEN 'running' WHEN 'committing' THEN 'running' ELSE status END END,
  outcome_event_id=COALESCE((SELECT event_id FROM events WHERE stream_id=? AND correlation_id=? AND type IN('GenerationCompleted','GenerationFailed','DocumentRenderCompleted','DocumentRenderFailed') ORDER BY sequence DESC LIMIT 1),outcome_event_id),updated_at=? WHERE job_id=?
  AND EXISTS(SELECT 1 FROM document_jobs live WHERE live.job_id=output_operation_slots.job_id AND live.stream_id=? AND live.correlation_id=?${witnessSql})`)
 .bind(job.stream_id,job.correlation_id,job.stream_id,job.correlation_id,now,job.job_id,job.stream_id,job.correlation_id,...witnessBindings);
 const grantUpdate=env.DB.prepare(`UPDATE output_execution_grants SET status='completed' WHERE status IN('authorized','active')
   AND EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.scope_key=output_execution_grants.scope_key AND slot.grant_id=output_execution_grants.grant_id AND slot.job_id=?)
   AND EXISTS(SELECT 1 FROM document_jobs live WHERE live.job_id=? AND live.stream_id=? AND live.correlation_id=?${witnessSql})
   AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.scope_key=output_execution_grants.scope_key AND slot.grant_id=output_execution_grants.grant_id AND slot.status IN('authorized','queued','running','uncertain'))`).bind(job.job_id,job.job_id,job.stream_id,job.correlation_id,...witnessBindings);
 return [slotUpdate,grantUpdate];
}
export async function synchronizeOutputJobOutcome(env:WorkerEnv,job:Pick<DocumentJobRow,"job_id"|"status"|"stream_id"|"correlation_id">,extraStatements:D1PreparedStatement[]=[]){
 await env.DB.batch([...extraStatements,...prepareOutputJobOutcomeStatements(env,job)]);
}

/** Post-erasure reconciliation of work proven never to have been submitted. */
export async function releaseUndispatchedOutputReservations(env:WorkerEnv,filter:{ownerUserId?:string;organizationId?:string;personalOnly?:boolean;limit?:number}){
 if(!filter.ownerUserId&&!filter.organizationId)throw new Error("output_release_scope_required");
 const limit=Number.isSafeInteger(filter.limit)&&Number(filter.limit)>0?Math.min(64,Number(filter.limit)):64;
 const scopeSql=`FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
  JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  JOIN document_jobs job ON job.job_id=slot.job_id
  WHERE slot.status='cancelled' AND grant_row.status='revoked' AND job.status='canceled' AND job.attempt_count=0
   AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)
   AND (? IS NULL OR plan.owner_user_id=?) AND (? IS NULL OR plan.organization_id=?)
   AND (?=0 OR (plan.scope_kind='personal' AND plan.organization_id IS NULL AND plan.project_access_id IS NULL))
   AND (EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=slot.token_reservation_id AND token.status='active')
     OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=slot.cost_reservation_id AND cost.status='active'))`;
 const bindings=[filter.ownerUserId??null,filter.ownerUserId??null,filter.organizationId??null,filter.organizationId??null,Number(filter.personalOnly===true)];
 const rows=await env.DB.prepare(`SELECT slot.token_reservation_id,slot.cost_reservation_id,grant_row.payer_user_id ${scopeSql} ORDER BY slot.created_at,slot.slot_id LIMIT ?`)
  .bind(...bindings,limit).all<{token_reservation_id:string;cost_reservation_id:string;payer_user_id:string}>();
 for(const row of rows.results){await settleCostBudget(env,row.payer_user_id,row.cost_reservation_id,0,{activeOnly:true});await settleBudget(env,row.payer_user_id,row.token_reservation_id,0,"output_revoked_before_dispatch");}
 const remaining=await env.DB.prepare(`SELECT COUNT(*) AS pending ${scopeSql}`).bind(...bindings).first<{pending:number}>();
 return {reconciled:rows.results.length,pending:Number(remaining?.pending??0)};
}

/** Cancel and reconcile only slots whose provider history proves no submission. */
export async function cleanupExpiredOrRevokedOutputWork(env:WorkerEnv,scope:OutputScope,slots:OutputOperationSlot[],at=Date.now(),financialAssertions:OutputSqlAssertion[]=[]) {
 const now=new Date(at).toISOString();
 const owned=slots.filter(slot=>slot.scopeKey===scope.key);
 if(!owned.length)return {reconciled:0};
 const sponsors:{binding:SponsorFinancialBinding;jobId:string}[]=[];
 // Every entry to cleanup, including the public bridge, must reconstruct the
 // original sponsor proof before changing its reservations. Ordinary/personal
 // actor-paid and project grants never consult the dormant sponsor schema.
 if(scope.kind==="personal")for(const slot of owned){
  const grant=await env.DB.prepare("SELECT payer_user_id FROM output_execution_grants WHERE scope_key=? AND grant_id=? AND actor_user_id=?").bind(scope.key,slot.grantId,scope.actorUserId).first<{payer_user_id:string}>();
  if(grant&&grant.payer_user_id!==scope.actorUserId){const binding=await readSponsorFinancialBinding(env,scope.actorUserId,slot.jobId);sponsors.push({binding,jobId:slot.jobId});financialAssertions=[...financialAssertions,sponsorFinancialIdentity(binding,env,scope.actorUserId,slot.jobId).assertion];}
 }
 const releaseTerminal=async()=>{for(const sponsor of sponsors)await sponsorTerminalReleaseStatement(sponsor.binding,env,scope.actorUserId,sponsor.jobId).run();};
 const statements:D1PreparedStatement[]=[];
 for(const slot of owned){
  statements.push(env.DB.prepare(`UPDATE output_execution_grants SET status='revoked'
   WHERE scope_key=? AND grant_id=? AND actor_user_id=? AND status IN('authorized','active') AND expires_at<=?
     AND NOT (${retainedPersonalFalRecoverySql})`)
   .bind(scope.key,slot.grantId,scope.actorUserId,now));
  statements.push(env.DB.prepare(`UPDATE document_jobs SET status='canceled',error_message='output_authorization_expired_or_revoked',completed_at=?,lease_expires_at=NULL,updated_at=?
   WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND status='queued' AND attempt_count=0
    AND EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row
     ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
     WHERE slot.scope_key=? AND slot.slot_id=? AND slot.job_id=document_jobs.job_id
      AND slot.status IN('authorized','queued','cancelled') AND grant_row.actor_user_id=? AND grant_row.status IN('revoked','exceeded','completed')
      AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id))`)
   .bind(now,now,slot.jobId,scope.actorUserId,`creative:${scope.ownerUserId}`,scope.documentId,scope.key,slot.slotId,scope.actorUserId));
  statements.push(env.DB.prepare(`UPDATE output_operation_slots SET status='cancelled',updated_at=? WHERE scope_key=? AND slot_id=?
   AND status IN('authorized','queued') AND EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=output_operation_slots.job_id AND job.owner_id=? AND job.status='canceled' AND job.attempt_count=0)
   AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=output_operation_slots.scope_key AND calls.slot_id=output_operation_slots.slot_id)`)
   .bind(now,scope.key,slot.slotId,scope.actorUserId));
 }
 await env.DB.batch([...financialAssertions.flatMap(proof=>outputAssertionStatements(env,proof)),...statements]);
 // Cancel every still-unsubmitted sibling atomically, but settle only one
 // eligible pair per request. A settled first sibling must not starve the rest.
 const candidate=await env.DB.prepare(`SELECT grant_row.payer_user_id,slot.token_reservation_id,slot.cost_reservation_id FROM output_operation_slots slot
   JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
   JOIN document_jobs job ON job.job_id=slot.job_id WHERE slot.scope_key=? AND slot.slot_id IN(SELECT value FROM json_each(?)) AND slot.status='cancelled'
    AND grant_row.actor_user_id=? AND job.owner_id=? AND job.status='canceled' AND job.attempt_count=0
    AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)
    AND (EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=slot.token_reservation_id AND token.status='active')
      OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=slot.cost_reservation_id AND cost.status='active'))
   ORDER BY slot.updated_at,slot.slot_id LIMIT 1`)
   .bind(scope.key,JSON.stringify(owned.map(slot=>slot.slotId)),scope.actorUserId,scope.actorUserId).first<{payer_user_id:string;token_reservation_id:string;cost_reservation_id:string}>();
 if(!candidate){await releaseTerminal();return {reconciled:0};}
 const settlement=await settleDocumentGenerationBudgets(env,candidate.payer_user_id,{reservationId:candidate.token_reservation_id,costReservationId:candidate.cost_reservation_id,reason:"output_authorization_expired_or_revoked",assertions:financialAssertions});
 await releaseTerminal();
 return {reconciled:Number(settlement.settled)};
}

/** Existing account reconciliation also drains authorizations abandoned before Start. */
export async function reconcileExpiredOutputAuthorizations(env:WorkerEnv,user:PilotUser,now=Date.now()) {
 await reconcileKnownOutputProviderReceipts(env,user);
 const owned=await env.DB.prepare(`SELECT grant_row.scope_key,grant_row.grant_id,grant_row.actor_user_id,grant_row.context_id,grant_row.payer_user_id,
  plan.scope_kind,plan.owner_user_id,plan.project_id,plan.document_id,plan.organization_id,plan.project_access_id
  FROM output_execution_grants grant_row JOIN output_plan_revisions plan ON plan.scope_key=grant_row.scope_key AND plan.plan_revision_id=grant_row.plan_revision_id
  WHERE (grant_row.payer_user_id=? OR (plan.scope_kind='personal' AND grant_row.payer_user_id<>grant_row.actor_user_id)) AND grant_row.actor_user_id=? AND grant_row.expires_at<=?
   AND EXISTS(SELECT 1 FROM output_operation_slots slot JOIN document_jobs job ON job.job_id=slot.job_id
    WHERE slot.scope_key=grant_row.scope_key AND slot.grant_id=grant_row.grant_id AND job.attempt_count=0
    AND slot.status IN('authorized','queued','cancelled') AND NOT EXISTS(SELECT 1 FROM output_provider_calls calls WHERE calls.scope_key=slot.scope_key AND calls.slot_id=slot.slot_id)
    AND (EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=slot.cost_reservation_id AND cost.status='active') OR EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=slot.token_reservation_id AND token.status='active')))
  ORDER BY grant_row.expires_at,grant_row.grant_id LIMIT 1`)
  .bind(user.billingUserId??user.userId,user.userId,new Date(now).toISOString()).all<Record<string,unknown>>();
 let reconciled=0;
 for(const row of owned.results){
  const scope:OutputScope={kind:row.scope_kind as OutputScope["kind"],key:String(row.scope_key),ownerUserId:String(row.owner_user_id),actorUserId:String(row.actor_user_id),projectId:String(row.project_id),documentId:String(row.document_id),organizationId:typeof row.organization_id==="string"?row.organization_id:null,projectAccessId:typeof row.project_access_id==="string"?row.project_access_id:null,contextId:typeof row.context_id==="string"?row.context_id:null};
  const slots=await readOutputSlots(env,scope.key,String(row.grant_id));
  const sponsor=scope.kind==="personal"&&row.payer_user_id!==user.userId&&slots.length===1?await readSponsorFinancialBinding(env,user.userId,slots[0]!.jobId):null;
  const financialAssertions=sponsor?[sponsorFinancialIdentity(sponsor,env,user.userId,slots[0]!.jobId).assertion]:[];
  reconciled+=(await cleanupExpiredOrRevokedOutputWork(env,scope,slots,now,financialAssertions)).reconciled;
  if(sponsor)await sponsorTerminalReleaseStatement(sponsor,env,user.userId,slots[0]!.jobId).run();
 }
 await reconcileOutputNativeStorage(env,{ownerUserId:user.userId,limit:1});
 return {reconciled};
}


/** Recover a known payment witness after a failed ledger write; never contact a provider.
 * One terminal slot per maintenance invocation keeps this bounded and lets unknown
 * receipts retain their exposure without monopolizing later reconciliation. */
export async function reconcileKnownOutputProviderReceipts(env:WorkerEnv,user:PilotUser,options:{jobId?:string;assertions?:OutputSqlAssertion[]}={}){
 const candidate=await env.DB.prepare(`SELECT slot.scope_key,slot.slot_id,slot.token_reservation_id,slot.cost_reservation_id,slot.updated_at,
   job.job_id,job.kind,job.owner_id,job.stream_id,job.document_id,job.status,job.correlation_id,grant_row.payer_user_id,plan.scope_kind,
   json_extract(COALESCE(job.result_json,'{}'),'$.providerSubmissions') AS receipts_json
  FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
  JOIN document_jobs job ON job.job_id=slot.job_id AND job.owner_id=grant_row.actor_user_id
  JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
  WHERE (grant_row.payer_user_id=? OR (plan.scope_kind='personal' AND grant_row.payer_user_id<>grant_row.actor_user_id)) AND grant_row.actor_user_id=? AND job.status IN('completed','partial','failed','canceled')
   AND (? IS NULL OR job.job_id=?)
   AND (slot.status='uncertain' OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=slot.cost_reservation_id AND cost.status IN('active','executing'))
      OR EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=slot.token_reservation_id AND token.status='active'))
  ORDER BY slot.updated_at,slot.slot_id LIMIT 1`).bind(user.billingUserId??user.userId,user.userId,options.jobId??null,options.jobId??null).first<Record<string,unknown>>();
 if(!candidate)return {reconciled:0,status:'not_needed' as const};
 const sponsor=candidate.scope_kind==='personal'&&candidate.payer_user_id!==user.userId?await readSponsorFinancialBinding(env,user.userId,String(candidate.job_id)):null;
 const original=sponsor?sponsorFinancialIdentity(sponsor,env,user.userId,String(candidate.job_id)):null;
 const billingOwner=original?.payerUserId??user.billingUserId??user.userId;
 const financialAssertions=[...(options.assertions??[]),...(original?[original.assertion]:[])];
 const scopeKey=String(candidate.scope_key),slotId=String(candidate.slot_id);
 const attemptedAt=new Date(Math.max(Date.now(),(Date.parse(String(candidate.updated_at))||0)+1)).toISOString();
 const authority=financialAssertions.flatMap(assertion=>outputAssertionStatements(env,assertion));
 const rotate=env.DB.prepare("UPDATE output_operation_slots SET updated_at=? WHERE scope_key=? AND slot_id=?")
  .bind(attemptedAt,scopeKey,slotId);
 if(authority.length)await env.DB.batch([...authority,rotate]);else await rotate.run();
 const calls=await env.DB.prepare("SELECT call_key,client_request_id,provider,model,stage_key,status,used_microusd,provider_response_id FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY created_at,call_key")
  .bind(scopeKey,slotId).all<Record<string,unknown>>();
 const receipts=providerSubmissions({providerSubmissions:parsed(String(candidate.receipts_json??'{}'))});
 const safe:Record<string,PaidProviderSubmission>={};
 for(const call of calls.results){
  const receipt=receipts.find(value=>value.clientRequestId===call.client_request_id);
  const expectedOperation=String(call.stage_key).startsWith('planning:')?'planning':call.stage_key==='model3d:initial'?'model3d':call.stage_key==='video:initial'?'video':call.stage_key==='audio:initial'?'audio':'image';
  if(!receipt||receipt.provider!==call.provider||receipt.model!==call.model||receipt.operation!==expectedOperation
    ||!['completed','rejected'].includes(receipt.status))continue;
  const knownCost=receipt.status==='rejected'?0:receipt.costMicrousd;
  if(!Number.isSafeInteger(knownCost)||Number(knownCost)<0)continue;
  if(receipt.status==='completed'&&(!['inputTokens','outputTokens','totalTokens'].every(key=>Number.isSafeInteger(receipt[key as keyof PaidProviderSubmission])&&Number(receipt[key as keyof PaidProviderSubmission])>=0)))continue;
  const status=receipt.status==='rejected'?'rejected':'settled';
  if(['pending','uncertain'].includes(String(call.status))){
   await settleOutputProviderCall(env,{scopeKey,slotId,callKey:String(call.call_key),clientRequestId:receipt.clientRequestId,status,usedMicrousd:Number(knownCost),...(receipt.providerRequestId?{providerResponseId:receipt.providerRequestId}:{}),assertions:financialAssertions});
   call.status=status;call.used_microusd=Number(knownCost);call.provider_response_id=receipt.providerRequestId??null;
  }
  if(call.status!==status||Number(call.used_microusd)!==Number(knownCost)||call.provider_response_id&&call.provider_response_id!==receipt.providerRequestId)continue;
  safe[receipt.clientRequestId]=receipt;
 }
 if(calls.results.some(call=>!['settled','rejected'].includes(String(call.status)))||Object.keys(safe).length!==calls.results.length)return {reconciled:0,status:'uncertain' as const};
 const actor={...user,streamId:String(candidate.stream_id)};
 const job={job_id:String(candidate.job_id),stream_id:String(candidate.stream_id),correlation_id:String(candidate.correlation_id),status:String(candidate.status) as DocumentJobRow['status']};
 const settlement=await settleDocumentGenerationBudgets(env,billingOwner,{reservationId:String(candidate.token_reservation_id),costReservationId:String(candidate.cost_reservation_id),reason:'output_known_response_reconciled',assertions:financialAssertions});
 if(settlement.status==='uncertain')return {reconciled:0,status:'uncertain' as const};
 // Refresh only operational fields. This remains safe after source erasure and
 // never reconstructs private requests, candidates, outputs, or event bodies.
 const originalJob=await env.DB.prepare("SELECT * FROM document_jobs WHERE job_id=? AND owner_id=?").bind(job.job_id,actor.userId).first<DocumentJobRow>();
 const localStop=originalJob?await readOutputSceneLocalStop(env,originalJob,actor.userId,billingOwner):null;
 const actualCalls=localStop?0:calls.results.length;
 const financial=env.DB.prepare(`UPDATE document_jobs SET result_json=json_patch(COALESCE(result_json,'{}'),json_object('generationReceipt',json_object(
    'reservation_status',(SELECT status FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?),
    'settled_cost_microusd',(SELECT used_microusd FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=?),
    'actual_provider_call_count',?, 'provider_request_status',CASE WHEN ?=0 THEN 'not_submitted' WHEN status='completed' THEN 'completed' ELSE 'submitted' END,
    'source_transmission_status',CASE WHEN ?=0 THEN 'not_transmitted' ELSE 'transmitted' END))),updated_at=?
   WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND status IN('completed','partial','failed','canceled')`)
   .bind(String(candidate.cost_reservation_id),billingOwner,String(candidate.cost_reservation_id),billingOwner,actualCalls,actualCalls,actualCalls,new Date().toISOString(),job.job_id,actor.userId,job.stream_id,job.correlation_id);
 await synchronizeOutputJobOutcome(env,job,[...authority,...(localStop?outputAssertionStatements(env,localStop.guard):[]),financial]);
 if(sponsor)await sponsorTerminalReleaseStatement(sponsor,env,user.userId,job.job_id).run();
 return {reconciled:Number(settlement.settled),status:'known' as const};
}

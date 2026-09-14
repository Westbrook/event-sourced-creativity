import { readOutputModel3dPayload, requireModel3dMiniAppCostApproval } from "./output-model3d-execution.ts";
import { preflightOutputModel3dMiniAppTarget, outputModel3dPreflightAssertions } from "./output-model3d-preflight.ts";
import { readOutputAudioPayload, requireAudioMiniAppCostApproval } from "./output-audio-execution.ts";
import { parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { preflightOutputAudioTarget, outputAudioPreflightAssertions } from "./output-audio-preflight.ts";
import { preflightOutputVideoTarget, requireOutputVideoOriginal } from "./output-video-preflight.ts";
import { preflightOutputStoryboardTarget, outputStoryboardPreflightProof } from "./output-storyboard-preflight.ts";
import { readStoryboardExecutionOffer } from "../src/model/output-storyboard-offer.ts";
import { preflightOutputSceneTarget, outputScenePreflightProof } from "./output-scene-preflight.ts";
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { requireSceneMiniAppCostApproval } from "./scene-mini-app-consent.ts";
import { preflightOutputNarrativeTarget } from "./output-narrative-preflight.ts";
import { createOutputAdmissionReads, outputAdmissionGovernanceAssertions } from "./output-admission-reads.ts";
import type { OutputGovernanceWitness } from "./output-governance-witness.ts";
import { OUTPUT_MODEL3D_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { validateModel3dRequest } from "../src/model/model3d.ts";
import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import { prepareModel3dRequest } from "./model3d-request.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import { sendsReferencePixels } from "../src/model/block-types.ts";
import { prepareOutputDocumentJob, type PreparedOutputDocumentJob } from "./document-jobs-api.ts";
import { prepareBudgetReservation, prepareCostBudgetReservation, type PilotUser } from "./pilot-policy.ts";
import { outputDigest, type OutputBridgeTargetInput, type OutputExecutionBridge, type OutputPreparedAdmission } from "./output-requirements-api.ts";
import { OutputConflictError, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { resolveOutputNativeResult } from "./output-native-result.ts";
import { cleanupExpiredOrRevokedOutputWork } from "./output-execution-control.ts";
import { preflightOutputImageSlidesTarget, outputNativeTargetRefusal, outputNativeRecord as record, outputNativeUnavailable as unavailable, type OutputNativeSettings } from "./output-image-slides-preflight.ts";
export { outputExactImageRender } from "./output-image-slides-preflight.ts";
export type { OutputNativeCallRoute, OutputNativeSettings } from "./output-image-slides-preflight.ts";

type Model3dReferencePreparation = Awaited<ReturnType<typeof prepareModel3dRequest>>;
const model3dReferenceReads = new WeakMap<object, Array<{ env: OutputBridgeTargetInput["env"]; events: OutputBridgeTargetInput["sourceEvents"]; key: string; prepared: Promise<Model3dReferencePreparation> }>>();

/** One read per source set in a single immutable admission context, even for many targets. */
function prepareOutputModel3dReferences(input: OutputBridgeTargetInput, references: Record<string, unknown>[], settings: Model3dReferencePreparation["settings"]) {
 const referenceBlockIds=references.map(fact=>String(fact.block_id??""));
 const key=JSON.stringify([input.scope.key,input.scope.actorUserId,input.scope.contextId,input.sourceDigest,referenceBlockIds]);
 const reads=model3dReferenceReads.get(input.context)??[];
 const previous=reads.find(read=>read.env===input.env&&read.events===input.sourceEvents&&read.key===key);
 if(previous)return previous.prepared;
 const prepared=prepareModel3dRequest({env:input.env,ownerId:input.scope.ownerUserId,snapshot:input.context.snapshot,sourceEvents:input.sourceEvents??[],prompt:input.target.instruction_text,settings,referenceBlockIds,...(input.scope.kind==="project"?{projectScope:{organizationId:input.scope.organizationId!,projectAccessId:input.scope.projectAccessId!,projectId:input.scope.projectId,ownerUserId:input.scope.ownerUserId,actorUserId:input.scope.actorUserId}}:{})});
 reads.push({env:input.env,events:input.sourceEvents,key,prepared});model3dReferenceReads.set(input.context,reads);
 return prepared;
}

export function outputJobUser(principal:PilotUser,scope:OutputScope):PilotUser{
 return scope.kind==="project"?{...principal,streamId:`creative:${scope.ownerUserId}`,projectExecution:{organizationId:scope.organizationId!,projectAccessId:scope.projectAccessId!,projectId:scope.projectId,ownerUserId:scope.ownerUserId,actorUserId:scope.actorUserId}}:principal;
}

export async function preflightOutputNativeTarget(input:OutputBridgeTargetInput):Promise<OutputNativeTargetPreflight>{
 if(Object.hasOwn(input.target,"model3d_contract"))return preflightOutputModel3dMiniAppTarget(input);
 if(Object.hasOwn(input.target,"video_contract"))return preflightOutputVideoTarget(input);
 if(Object.hasOwn(input.target,"audio_contract"))return preflightOutputAudioTarget(input);
 if(Object.hasOwn(input.target,"storyboard_contract"))return preflightOutputStoryboardTarget(input);
 if(Object.hasOwn(input.target,"scene_contract"))return preflightOutputSceneTarget(input);
 if(Object.hasOwn(input.target,"narrative_contract"))return preflightOutputNarrativeTarget(input);
 if(input.target.media_kind==="model3d"){
  const refused=outputNativeTargetRefusal(input);
  if(refused)return refused;
  return preflightOutputModel3dTarget(input);
 }
 return preflightOutputImageSlidesTarget(input);
}

/** The reviewed target wording is the exact provider prompt; no planning rewrite is charged. */
export async function preflightOutputModel3dTarget(input:OutputBridgeTargetInput):Promise<OutputNativeTargetPreflight> {
 const {target,env}=input;
 if(!env.FAL_KEY)return unavailable(target.id,"output_native_model3d_unconfigured","Configure the fal provider before creating a 3D model. Owned GLB adoption remains available.");
 if(target.aspect_ratio||target.content_quantity)return unavailable(target.id,"output_native_model3d_contract_unsupported","A 3D model has no image aspect ratio or slide/duration count. Review these output requirements before creating it.");
 const facts=Array.isArray(input.context.snapshot.facts)?input.context.snapshot.facts.map(record):[];
 const references=facts.filter(fact=>promptFactIsActive(fact)&&["reference","model3d"].includes(String(fact.type))&&sendsReferencePixels(record(fact.properties).pixel_reference_mode));
 const checked=validateModel3dRequest({prompt:target.instruction_text,referenceCount:references.length});
 if(!checked.valid){const problem=checked.issues[0]!;return {...unavailable(target.id,problem.code,problem.message),reasonValues:{promptCharacters:checked.promptCharacters,maximumCharacters:1024}};}
 let prepared:Model3dReferencePreparation;
 try{const referencePreparation=await prepareOutputModel3dReferences(input,references,checked.settings);prepared={...referencePreparation,references:[...referencePreparation.references],referenceBlockIds:[...referencePreparation.referenceBlockIds],prompt:target.instruction_text,settings:checked.settings,model:checked.model,estimatedCostMicrousd:checked.estimatedCostMicrousd};}
 catch(error){return unavailable(target.id,"output_native_model3d_reference_unavailable",error instanceof ProviderRequestError?error.detail.message:"Review the selected reference images and their saved rights before creating this 3D model.");}
 const settings:OutputNativeSettings={kind:"render_document",payload:{productionMode:"manual",artifactKind:"model3d",model3dPrompt:prepared.prompt,model3dSettings:prepared.settings,model3dReferenceBlockIds:prepared.referenceBlockIds,paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true},calls:[{stage:"model3d:initial",provider:"fal",model:prepared.model,maximumMicrousd:prepared.estimatedCostMicrousd}],executionPolicy:OUTPUT_MODEL3D_EXECUTION_POLICY};
 Object.assign(settings,{model3dReferences:prepared.references.map(reference=>({blockId:reference.blockId,label:reference.label,mimeType:reference.mimeType}))});
 return {targetId:target.id,available:true,reasonCode:"output_native_model3d_ready",reason:"One Rodin request creates a GLB using the exact reviewed prompt, ordered reference images, and disclosed settings. Provider content checks apply; acceptance is not guaranteed. Review the mesh and materials before accepting delivery.",reasonValues:{maximumExecutionSeconds:OUTPUT_MODEL3D_EXECUTION_POLICY.maximumMilliseconds/1000},transferCode:"output_transfer_model3d_after_authorization",provider:"fal",model:prepared.model,route:prepared.references.length?"document-model3d-image-manual-v1":"document-model3d-text-manual-v1",maximumMicrousd:prepared.estimatedCostMicrousd,maximumCalls:1,maximumTokens:1,settings,transferDescription:"After authorization and Start, Forma sends the exact displayed prompt, settings, and listed reference images in order to fal.ai / Hyper3D Rodin. The first reference guides materials. Original mesh files are not sent. This preflight sends nothing."};
}

async function prepareAdmission(input:Parameters<OutputExecutionBridge["prepareAdmission"]>[0]&{governanceWitness?:OutputGovernanceWitness}):Promise<OutputPreparedAdmission&{sourceAssertions:OutputSqlAssertion[]}>{
 const readScope=createOutputAdmissionReads({request:input.request,env:input.env,documentId:input.scope.documentId,actorUserId:input.scope.actorUserId,billingUserId:input.principal.billingUserId??input.principal.userId,organizationId:input.scope.organizationId,projectAccessId:input.scope.projectAccessId},
  input.governanceWitness?{witness:input.governanceWitness,source:{ownerUserId:input.scope.ownerUserId,projectId:input.scope.projectId,contextId:input.scope.contextId??"",sourceDigest:input.sourceDigest,contextSnapshotDigest:await outputDigest(input.context.snapshot)}}:undefined);
 const governanceAssertions=outputAdmissionGovernanceAssertions(readScope);
 const sceneAssertions:OutputSqlAssertion[]=[];
 const sceneJobAdmissions:NonNullable<OutputPreparedAdmission['sceneJobAdmissions']>=[];
 const prepared:Array<{slot:OutputOperationSlot;job:PreparedOutputDocumentJob;statements:D1PreparedStatement[];assertions:OutputSqlAssertion[];checkpoint:Record<string,unknown>}> = [];
 for(const slot of input.slots){
  const target=input.confirmedPlan.plan.targets.find(target=>target.id===slot.targetId);
  const frozen=input.preflight.targets.find(target=>target.targetId===slot.targetId);
  if(!target||!frozen?.available)throw new OutputConflictError("output_target_not_admissible");
  const current=await preflightOutputNativeTarget({...input,target});
  if(!current.available||await outputDigest(current)!==slot.routeDigest||await outputDigest(frozen)!==slot.routeDigest)throw new OutputConflictError("output_route_changed");
  const settings=current.settings as OutputNativeSettings;
  const nativeVideo=Object.hasOwn(target,"video_contract")?requireOutputVideoOriginal({...input,target},current,slot).offer:null;
  const refreshVideo=async()=>{
   const refreshed=await preflightOutputVideoTarget({...input,target});
   if(!nativeVideo||await outputDigest(refreshed)!==slot.routeDigest)throw new OutputConflictError("output_video_route_changed",409);
   const {offer,proof}=requireOutputVideoOriginal({...input,target},refreshed,slot);
   sceneAssertions.push(...proof.sourceAssertions);return offer;
  };
  if(nativeVideo)await refreshVideo();
  const nativeModel3d=Object.hasOwn(target,"model3d_contract")?await readOutputModel3dPayload(settings.payload):null;
  if(Object.hasOwn(target,"model3d_contract")&&!nativeModel3d)throw new OutputConflictError("output_model3d_contract_unsupported",403);
  const refreshModel3d=async()=>{
   const refreshed=await preflightOutputModel3dMiniAppTarget({...input,target}),proof=outputModel3dPreflightAssertions(refreshed);
   const offer=refreshed.available?await readOutputModel3dPayload((refreshed.settings as OutputNativeSettings).payload):null;
   if(!nativeModel3d||!proof?.length||!offer||input.scope.kind!=="personal"||input.scope.contextId||await outputDigest(refreshed)!==slot.routeDigest
    ||offer.preview.requestId!==slot.jobId||slot.attemptOrdinal!==0||slot.previousSlotId)throw new OutputConflictError("output_model3d_original_attempt_required",403);
   requireModel3dMiniAppCostApproval(input.model3dCostConsent,nativeModel3d.preview,offer.preview);sceneAssertions.push(...proof);return offer;
  };
  if(nativeModel3d)await refreshModel3d();
  const nativeStoryboard=Object.hasOwn(target,"storyboard_contract")?readStoryboardExecutionOffer(current):null;
  if(Object.hasOwn(target,"storyboard_contract")&&!nativeStoryboard)throw new OutputConflictError("output_storyboard_offer_invalid",409);
  const refreshStoryboard=async()=>{
   const refreshed=await preflightOutputStoryboardTarget({...input,target}),proof=outputStoryboardPreflightProof(refreshed),offer=readStoryboardExecutionOffer(refreshed);
   if(!nativeStoryboard||!proof?.sourceAssertions.length||!offer||input.scope.kind!=="personal"||input.scope.contextId
    ||await outputDigest(refreshed)!==slot.routeDigest||proof.requestId!==slot.jobId||offer.original.requestId!==slot.jobId
    ||Date.parse(proof.expiresAt)<=Date.now()||slot.attemptOrdinal!==0||slot.previousSlotId)throw new OutputConflictError("output_storyboard_original_attempt_required",403);
   sceneAssertions.push(...proof.sourceAssertions);return offer;
  };
  if(nativeStoryboard)await refreshStoryboard();
  const nativeAudio=Object.hasOwn(target,"audio_contract")?readOutputAudioPayload(settings.payload):null;
  if(Object.hasOwn(target,"audio_contract")&&!nativeAudio)throw new OutputConflictError("output_audio_contract_unsupported");
  const refreshAudio=async()=>{
   const refreshed=await preflightOutputAudioTarget({...input,target});const proof=outputAudioPreflightAssertions(refreshed),preview=parseAudioMiniAppCostPreview((refreshed.settings as Record<string,unknown>).costPreview);
   if(!nativeAudio||!proof||!preview||!refreshed.available||await outputDigest(refreshed)!==slot.routeDigest||preview.requestId!==slot.jobId||slot.attemptOrdinal!==0||slot.previousSlotId)throw new OutputConflictError("output_audio_source_changed",403);
   requireAudioMiniAppCostApproval(input.audioCostConsent,(settings as unknown as Record<string,unknown>).costPreview,preview);sceneAssertions.push(...proof);return nativeAudio;
  };
  if(nativeAudio)await refreshAudio();
  const nativeScene=Object.hasOwn(target,"scene_contract")?await readOutputScenePayload(settings.payload):null;
  if(Object.hasOwn(target,"scene_contract")&&!nativeScene)throw new OutputConflictError("output_scene_contract_unsupported");
  const refreshScene=async()=>{
   const refreshed=await preflightOutputSceneTarget({...input,target});
   const proof=outputScenePreflightProof(refreshed);
   const payload=refreshed.available?await readOutputScenePayload((refreshed.settings as OutputNativeSettings).payload):null;
   if(!proof||!payload||!nativeScene||await outputDigest(refreshed)!==slot.routeDigest||proof.requestId!==slot.jobId
     ||slot.attemptOrdinal!==0||slot.previousSlotId)throw new OutputConflictError("output_scene_original_attempt_required");
   requireSceneMiniAppCostApproval(input.sceneCostConsent,nativeScene.outputScene.costPreview,payload.outputScene.costPreview);
   sceneAssertions.push(...proof.sourceAssertions);
   return proof.prepared;
  };
  const scenePrepared=nativeScene?await refreshScene():null;
  if(scenePrepared?.sourceVersion)sceneJobAdmissions.push({slot,version:scenePrepared.sourceVersion});
  const admissionPayload=nativeModel3d?{...settings.payload,model3dCostConsent:input.model3dCostConsent,sourceSurface:"outputs",paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true}:nativeAudio?{...settings.payload,audioCostConsent:input.audioCostConsent,paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true}:nativeScene?{...settings.payload,sceneCostConsent:input.sceneCostConsent}:settings.payload;
  const reference={scopeKey:slot.scopeKey,grantId:slot.grantId,slotId:slot.slotId,planRevisionId:slot.planRevisionId,targetId:slot.targetId,targetContractDigest:slot.targetContractDigest,sourceDigest:slot.sourceDigest};
  const job=await prepareOutputDocumentJob(input.request,input.env,{documentId:input.scope.documentId,kind:settings.kind,payload:admissionPayload},{jobId:slot.jobId,outputExecution:reference,readScope,
   ...(nativeScene&&scenePrepared?{outputScene:{payload:nativeScene,prepared:scenePrepared,refresh:refreshScene}}:{}),
   ...(nativeAudio?{outputAudio:{payload:admissionPayload,refresh:refreshAudio}}:{}),
   ...(nativeVideo?{outputVideo:{payload:admissionPayload,maximumMicrousd:nativeVideo.maximumMicrousd,refresh:refreshVideo}}:{}),
   ...(nativeModel3d?{outputModel3d:{payload:admissionPayload,refresh:refreshModel3d}}:{}),
   ...(nativeStoryboard?{outputStoryboard:{payload:admissionPayload,maximumMicrousd:nativeStoryboard.maximumMicrousd,refresh:refreshStoryboard}}:{}),
   maximumMicrousd:slot.maximumMicrousd,maximumTokens:slot.maximumTokens,maximumCalls:slot.maximumCalls,...(settings.imageRender?{outputImageRender:settings.imageRender}:{}),
   compile:async trusted=>{if(trusted.documentRevision!==input.context.documentRevision||await outputDigest(trusted.snapshot)!==await outputDigest(input.context.snapshot))throw new OutputConflictError("output_source_changed");return admissionPayload;}});
  if(job instanceof Response){const issue=record(await job.json());throw new OutputConflictError(String(issue.error??"output_job_preflight_failed"),job.status);}
  if(job.user.userId!==input.scope.actorUserId||job.user.streamId!==`creative:${input.scope.ownerUserId}`)throw new OutputConflictError("output_job_scope_mismatch",403);
  const billingOwner=job.user.billingUserId??job.user.userId;
  const budgetScope=job.user.projectExecution?{organizationId:job.user.projectExecution.organizationId,projectAccessId:job.user.projectExecution.projectAccessId,actorUserId:job.user.projectExecution.actorUserId}:undefined;
  const budgetContext={streamId:job.user.streamId,correlationId:slot.jobId,operation:job.kind==="generate"?"image-generation":`document-render:${String(settings.payload.artifactKind)}`,...(budgetScope?{projectScope:budgetScope}:{})};
  const token=await prepareBudgetReservation(input.env,billingOwner,slot.maximumTokens,{...budgetContext,reservationId:slot.tokenReservationId,outputAdmissionReads:readScope});
  if(!token.ok)throw new OutputConflictError("output_token_budget_unavailable",429);
  const cost=await prepareCostBudgetReservation(input.env,billingOwner,slot.maximumMicrousd,{...budgetContext,period:token.period,reservationId:slot.costReservationId,outputAdmissionReads:readScope,maximumMicrousd:slot.maximumMicrousd,allowUserOverage:false});
  if(!cost.ok)throw new OutputConflictError("output_cost_budget_unavailable",429);
  const assertions:OutputSqlAssertion[]=[{sql:`EXISTS(SELECT 1 FROM budget_reservations token JOIN cost_budget_reservations cost
   ON cost.owner_id=token.owner_id AND cost.stream_id=token.stream_id AND cost.correlation_id=token.correlation_id AND cost.operation=token.operation AND cost.period=token.period
   WHERE token.reservation_id=? AND cost.reservation_id=? AND token.owner_id=? AND token.stream_id=? AND token.correlation_id=? AND token.reserved_tokens=? AND cost.reserved_microusd=? AND token.status='active' AND cost.status='active')`,bindings:[slot.tokenReservationId,slot.costReservationId,billingOwner,job.user.streamId,slot.jobId,slot.maximumTokens,slot.maximumMicrousd]},
   {sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND document_id=? AND status='queued')",bindings:[slot.jobId,job.user.userId,job.user.streamId,input.scope.documentId]}];
  if(budgetScope)assertions.push({sql:"EXISTS(SELECT 1 FROM project_resource_scopes resource JOIN events anchor ON anchor.event_id=resource.source_event_id WHERE resource.project_access_id=? AND resource.organization_id=? AND resource.resource_kind='job' AND resource.resource_id=? AND resource.actor_user_id=? AND anchor.type='ProjectDocumentJobQueued' AND json_extract(anchor.payload,'$.job_id')=?)",bindings:[budgetScope.projectAccessId,budgetScope.organizationId,slot.jobId,job.user.userId,slot.jobId]});
  prepared.push({slot,job,statements:[...token.statements,...cost.statements],assertions,checkpoint:{reservationId:token.reservationId,costReservationId:cost.reservationId,costReservationPeriod:cost.period,costReservationMicrousd:cost.reservedMicrousd,outputExecution:reference,generationReceipt:{...record(job.initialResult.generationReceipt),reservation_status:"active",reservation_microusd:cost.reservedMicrousd,output_slot_id:slot.slotId,output_grant_id:slot.grantId}}});
 }
 return {sourceAssertions:[...governanceAssertions,...sceneAssertions],sceneJobAdmissions,events:prepared.map(item=>item.job.queueEvent),buildStatements(events){const statements:D1PreparedStatement[]=[],assertions:OutputSqlAssertion[]=[];for(const item of prepared){const event=events.find(event=>event.type===item.job.queueEvent.type&&event.payload.job_id===item.slot.jobId);if(!event)throw new Error("output_job_anchor_missing");statements.push(...item.statements,...item.job.buildStatements(event,item.checkpoint));assertions.push(...item.assertions);}return{statements,assertions};}};
}

export const outputDocumentExecutionBridge:OutputExecutionBridge={
 preflight:preflightOutputNativeTarget,
 prepareAdmission,
 async dispatch(){
  // Run already committed the exact admitted slots as queued. The existing
  // document-jobs client driver starts one job per HTTP request and resumes
  // those same IDs after a lost response; it never drives authorized-only slots.
 },
 async cleanupExpiredOrRevoked({env,scope,slots}){await cleanupExpiredOrRevokedOutputWork(env,scope,slots);},
 resolveResult:resolveOutputNativeResult,
};

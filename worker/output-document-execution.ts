import { createOutputAdmissionReads, outputAdmissionGovernanceAssertions } from "./output-admission-reads.ts";
import type { OutputGovernanceWitness } from "./output-governance-witness.ts";
import { OUTPUT_MODEL3D_EXECUTION_POLICY, OUTPUT_NATIVE_EXECUTION_POLICY, type OutputNativeExecutionPolicy } from "../src/model/output-execution-policy.ts";
import { validateModel3dRequest } from "../src/model/model3d.ts";
import { promptFactIsActive } from "../src/model/prompt-policy.ts";
import { prepareModel3dRequest } from "./model3d-request.ts";
import { ProviderRequestError } from "./provider-errors.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import type { ImageFormat } from "../src/model/image-format.ts";
import { validateProviderImageDimensions } from "../src/model/image-format.ts";
import { sendsReferencePixels } from "../src/model/block-types.ts";
import { minimumPresentationSlideCount } from "../src/model/managed-production.ts";
import { buildPresentationSourceContract } from "../src/model/presentation-source.ts";
import { documentRenderTokenReservation } from "../src/model/generation-budget.ts";
import { manualPresentationMaximumOutputTokens, resolvePresentationCountRequest } from "../src/model/presentation-count-policy.ts";
import { prepareOutputDocumentJob, type PreparedOutputDocumentJob } from "./document-jobs-api.ts";
import { prepareBudgetReservation, prepareCostBudgetReservation, type PilotUser } from "./pilot-policy.ts";
import { selectImageAdapter } from "./image-adapter.ts";
import { outputImageBudget } from "./output-image-budget.ts";
import { hasKnownTextModelPricing, priceTextUsageBreakdownMicrousd } from "./replay-cost.ts";
import { outputDigest, type OutputBridgeTargetInput, type OutputExecutionBridge, type OutputPreparedAdmission } from "./output-requirements-api.ts";
import { OutputConflictError, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { resolveOutputNativeResult } from "./output-native-result.ts";
import { cleanupExpiredOrRevokedOutputWork } from "./output-execution-control.ts";

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const unavailable=(targetId:string,reasonCode:string,reason:string):OutputNativeTargetPreflight=>({targetId,available:false,reasonCode,transferCode:"output_transfer_none_owned_adoption",reason,provider:null,model:null,route:null,maximumMicrousd:0,maximumCalls:0,maximumTokens:0,settings:{},transferDescription:"No source or file is sent by this check. You can use an owned file after inspection and review."});
export type OutputNativeCallRoute={stage:string;provider:string;model:string;maximumMicrousd:number};
export type OutputNativeSettings={
 kind:"generate"|"render_document";payload:Record<string,unknown>;calls:OutputNativeCallRoute[];
 executionPolicy?:OutputNativeExecutionPolicy;
 imageBudget?:NonNullable<ReturnType<typeof outputImageBudget>>;
 imageRender?:{format:ImageFormat;size:`${number}x${number}`};
};
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

/** Exact geometry only. No implicit crop, approximate ratio, resize, or provider fallback. */
export function outputExactImageRender(ratio:{width:number;height:number}):{format:ImageFormat;size:`${number}x${number}`}|null{
 if(!Number.isSafeInteger(ratio.width)||!Number.isSafeInteger(ratio.height)||ratio.width<=0||ratio.height<=0)return null;
 const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
 const divisor=gcd(ratio.width,ratio.height),w=ratio.width/divisor,h=ratio.height/divisor;
 const alignment=(a:number,b:number)=>a*b/gcd(a,b);
 const step=alignment(16/gcd(w,16),16/gcd(h,16));
 const baseWidth=w*step,baseHeight=h*step;
 const multiplier=Math.max(1,Math.ceil(Math.max(1024/Math.min(baseWidth,baseHeight),Math.sqrt(655_360/(baseWidth*baseHeight)))));
 const width=baseWidth*multiplier,height=baseHeight*multiplier;
 if(!validateProviderImageDimensions(width,height).valid)return null;
 return {format:{schema_version:1,aspect_ratio:{width:w,height:h},dimensions:{width,height,unit:"px"}},size:`${width}x${height}`};
}
function providerInputInstructions(input:OutputBridgeTargetInput){
 return [input.target.instruction_text,`Only this deliverable is requested: ${input.target.label}.`,
  `Coverage contract: ${JSON.stringify(input.target.coverage)}.`,
  "The delivery instructions are not evidence. Ground factual claims in the authorized Document sources."].join("\n");
}
export function outputJobUser(principal:PilotUser,scope:OutputScope):PilotUser{
 return scope.kind==="project"?{...principal,streamId:`creative:${scope.ownerUserId}`,projectExecution:{organizationId:scope.organizationId!,projectAccessId:scope.projectAccessId!,projectId:scope.projectId,ownerUserId:scope.ownerUserId,actorUserId:scope.actorUserId}}:principal;
}

export async function preflightOutputNativeTarget(input:OutputBridgeTargetInput):Promise<OutputNativeTargetPreflight>{
 const {target,env}=input;
 if(!target.selected||target.blocking_issues.length)return unavailable(target.id,target.blocking_issues[0]?.code??"output_native_target_not_selected",target.blocking_issues[0]?.message??"Select this resolved target before creating it.");
 if(target.source_scope.kind!=="document")return unavailable(target.id,"output_native_document_scope_required","Native creation currently requires the full authorized Document. Scoped targets can be completed with a verified owned file.");
 if(target.media_kind==="model3d")return preflightOutputModel3dTarget(input);
 if(!["image","slides"].includes(target.media_kind))return unavailable(target.id,"output_native_medium_adoption_only","This medium uses verified owned-file adoption in this release; no provider job will be substituted.");
 if(!env.OPENAI_API_KEY)return unavailable(target.id,"output_native_planner_unconfigured","The planning provider is not configured. Saving and owned-file adoption remain available.");
 const plannerModel=env.OPENAI_MODEL??"gpt-5.6-terra";
 if(!hasKnownTextModelPricing(plannerModel))return unavailable(target.id,"output_native_planner_price_unknown","The configured planning model has no known price contract.");
 const facts=Array.isArray(input.context.snapshot.facts)?input.context.snapshot.facts.map(record):[];
 if(!facts.some(fact=>fact.active!==false&&String(fact.type).toLowerCase()!=="output"&&fact.intent!=="prohibit"&&fact.effect!=="must_not_include"))return unavailable(target.id,"output_native_source_required","Add an active authorized source before creating this target.");
 const common={productionMode:"manual",budgetAcknowledged:true,preflightAcknowledged:true,outputTargetInstructions:providerInputInstructions(input)};
 const maximumInputTokens=new TextEncoder().encode(JSON.stringify(input.context.snapshot)).byteLength*4+25_000;
 let settings:OutputNativeSettings,provider:string,model:string,route:string,maximumTokens:number,maximumMicrousd:number;
 if(target.media_kind==="slides"){
  if(!target.count_policy||target.count_policy.unit!=="slide")return unavailable(target.id,"output_native_slide_count_policy_required","Confirm an exact or flexible slide count policy first.");
  let counts:ReturnType<typeof resolvePresentationCountRequest>;
  try{counts=resolvePresentationCountRequest({slideCountPolicy:target.count_policy,...(target.count_policy.kind!=="flexible"||target.suggested_count===null?{}:{itemCount:target.suggested_count}),productionMode:"manual"},minimumPresentationSlideCount(input.context.snapshot));}
  catch{return unavailable(target.id,"output_native_slide_count_unsupported","The accepted slide count cannot use the native presentation route.");}
  const contract=buildPresentationSourceContract(input.context.snapshot,{itemCount:counts.itemCount,...(counts.requestedSlideCount===undefined?{}:{requestedSlideCount:counts.requestedSlideCount}),slideCountPolicy:counts.slideCountPolicy});
  if(contract.sourceIssues?.length||!contract.sources.some(source=>source.sourceKind==="block"))return unavailable(target.id,contract.sourceIssues?.[0]?.code??"output_native_slide_source_unresolved",contract.sourceIssues?.[0]?.message??"The deck needs an authorized factual source.");
  const maxOutput=manualPresentationMaximumOutputTokens(counts.slideCountPolicy,counts.itemCount);
  const perCall=Math.max(500_000,priceTextUsageBreakdownMicrousd(plannerModel,{inputTokens:maximumInputTokens,outputTokens:maxOutput,totalTokens:maximumInputTokens+maxOutput}).totalMicrousd);
  maximumMicrousd=perCall*2;maximumTokens=documentRenderTokenReservation("slides",counts.itemCount,2);
  settings={kind:"render_document",payload:{...common,artifactKind:"slides",itemCount:counts.itemCount,slideCountPolicy:counts.slideCountPolicy,...(counts.requestedSlideCount===undefined?{}:{requestedSlideCount:counts.requestedSlideCount})},calls:[{stage:"planning:0:initial",provider:"openai",model:plannerModel,maximumMicrousd:perCall},{stage:"planning:0:repair",provider:"openai",model:plannerModel,maximumMicrousd:perCall}]};
  provider="openai";model=plannerModel;route="document-slides-manual-v1";
 }else{
  if(!target.aspect_ratio)return unavailable(target.id,"output_native_image_ratio_required","Confirm the image aspect ratio first.");
  const imageRender=outputExactImageRender(target.aspect_ratio);
  if(!imageRender)return unavailable(target.id,"output_native_image_ratio_unsupported","The provider cannot create this exact ratio within its dimension limits. Adopt a verified file or explicitly revise the requirement.");
  const referenceCount=facts.filter(fact=>fact.type==="reference"&&fact.active!==false&&Number(record(fact.properties).weight??.5)>0&&sendsReferencePixels(record(fact.properties).pixel_reference_mode)).length;
  if(referenceCount)return unavailable(target.id,"output_native_reference_input_unpriced","This bounded image route cannot yet price GPT Image 2 reference-pixel input. No requested reference is omitted: use an inspected owned image or explicitly change the reference requirement.");
  const referenceStubs=Array.from({length:referenceCount},()=>({bytes:new Uint8Array(0),mimeType:"image/png",source:"uploaded-reference" as const}));
  const selected=selectImageAdapter(env,{quality:"high",size:imageRender.size,references:referenceStubs});
  if(selected.providerName!=="openai")return unavailable(target.id,"output_native_image_adapter_unsupported","The current bounded native image route supports the configured OpenAI adapter only. The selected provider must not silently fall back; adopt an owned image instead.");
  if((env.FORMA_IMAGE_PROVIDER??"openai").trim().toLowerCase()!=="openai")return unavailable(target.id,"output_native_image_provider_unavailable","The requested image provider is unavailable for this bounded route; no automatic fallback is authorized.");
  const plannerMaximum=Math.max(100_000,priceTextUsageBreakdownMicrousd(plannerModel,{inputTokens:maximumInputTokens,outputTokens:1200,totalTokens:maximumInputTokens+1200}).totalMicrousd);
  const imageBudget=outputImageBudget(selected.model,imageRender.size);
  if(!imageBudget)return unavailable(target.id,"output_native_image_price_unknown","The configured image model or size has no verified native image pricing contract. No fallback rate or provider will be used.");
  const imageMaximum=Math.max(900_000,imageBudget.maximumMicrousd);
  maximumMicrousd=plannerMaximum+imageMaximum;maximumTokens=128_000;
  settings={kind:"generate",payload:{...common,outputImageFormat:imageRender.format},imageRender,imageBudget,calls:[{stage:"planning:initial",provider:"openai",model:plannerModel,maximumMicrousd:plannerMaximum},{stage:"image:initial",provider:selected.providerName,model:selected.model,maximumMicrousd:imageMaximum}]};
  provider=selected.providerName;model=selected.model;route="document-image-manual-v1";
 }
 settings.executionPolicy=OUTPUT_NATIVE_EXECUTION_POLICY;
 return {targetId:target.id,available:true,reasonValues:{maximumExecutionSeconds:OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds/1000},reasonCode:target.media_kind==="slides"?"output_native_slides_ready":"output_native_image_ready",transferCode:"output_transfer_document_after_authorization",reason:target.media_kind==="slides"?"One initial request and at most one repair. The accepted count policy remains unchanged. Each operation has a four-minute application execution window; a timeout does not prove provider cancellation, and unresolved allowances remain held.":"At most two generation calls: one direction call and one image call at the exact size. After authorization and Start, Forma sends the exact final image prompt as text to OpenAI (omni-moderation-latest) for at most one additional automatic safety check before image creation. This check is not counted as a generation call and is currently free under OpenAI’s pricing. Each operation has a four-minute application execution window; a timeout does not prove provider cancellation, and unresolved allowances remain held.",provider,model,route,maximumMicrousd,maximumCalls:2,maximumTokens,settings,
  transferDescription:"After you authorize and start, the authorized Document source context and selected target instructions go to the disclosed provider. Native image attempts also send the exact final image prompt as text to OpenAI (omni-moderation-latest) for at most one additional automatic safety check before image creation. This check is not counted as a generation call and is currently free under OpenAI’s pricing. If reference pixels are required, native image generation is unavailable. This preflight sends nothing. Account and provider ceilings are separate; the displayed cap bounds application admission, not a guarantee of provider billing."};
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
 const prepared:Array<{slot:OutputOperationSlot;job:PreparedOutputDocumentJob;statements:D1PreparedStatement[];assertions:OutputSqlAssertion[];checkpoint:Record<string,unknown>}> = [];
 for(const slot of input.slots){
  const target=input.confirmedPlan.plan.targets.find(target=>target.id===slot.targetId);
  const frozen=input.preflight.targets.find(target=>target.targetId===slot.targetId);
  if(!target||!frozen?.available)throw new OutputConflictError("output_target_not_admissible");
  const current=await preflightOutputNativeTarget({...input,target});
  if(!current.available||await outputDigest(current)!==slot.routeDigest||await outputDigest(frozen)!==slot.routeDigest)throw new OutputConflictError("output_route_changed");
  const settings=current.settings as OutputNativeSettings;
  const reference={scopeKey:slot.scopeKey,grantId:slot.grantId,slotId:slot.slotId,planRevisionId:slot.planRevisionId,targetId:slot.targetId,targetContractDigest:slot.targetContractDigest,sourceDigest:slot.sourceDigest};
  const job=await prepareOutputDocumentJob(input.request,input.env,{documentId:input.scope.documentId,kind:settings.kind,payload:settings.payload},{jobId:slot.jobId,outputExecution:reference,readScope,
   maximumMicrousd:slot.maximumMicrousd,maximumTokens:slot.maximumTokens,maximumCalls:slot.maximumCalls,...(settings.imageRender?{outputImageRender:settings.imageRender}:{}),
   compile:async trusted=>{if(trusted.documentRevision!==input.context.documentRevision||await outputDigest(trusted.snapshot)!==await outputDigest(input.context.snapshot))throw new OutputConflictError("output_source_changed");return settings.payload;}});
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
 return {sourceAssertions:governanceAssertions,events:prepared.map(item=>item.job.queueEvent),buildStatements(events){const statements:D1PreparedStatement[]=[],assertions:OutputSqlAssertion[]=[];for(const item of prepared){const event=events.find(event=>event.type===item.job.queueEvent.type&&event.payload.job_id===item.slot.jobId);if(!event)throw new Error("output_job_anchor_missing");statements.push(...item.statements,...item.job.buildStatements(event,item.checkpoint));assertions.push(...item.assertions);}return{statements,assertions};}};
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

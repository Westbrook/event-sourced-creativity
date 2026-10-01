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
import { documentGenerationRevision } from "../src/model/document-jobs.ts";
import type { OutputPlanTarget } from "../src/model/output-plan.ts";
import { manualPresentationMaximumOutputTokens, resolvePresentationCountRequest } from "../src/model/presentation-count-policy.ts";
import { prepareOutputDocumentJob, type PreparedOutputDocumentJob } from "./document-jobs-api.ts";
import { prepareBudgetReservation, prepareCostBudgetReservation, type PilotUser } from "./pilot-policy.ts";
import { selectImageAdapter } from "./image-adapter.ts";
import { outputImageBudget } from "./output-image-budget.ts";
import { hasKnownTextModelPricing, priceTextUsageBreakdownMicrousd } from "./replay-cost.ts";
import { estimateOpenAITextCallMaximumMicrousd, OpenAITextAccountingError } from "./openai-text-cost.ts";
import { resolvePresentationModelRoutes, PresentationModelConfigurationError, type PresentationModelRoute } from "./presentation-model-routing.ts";
import { canonicalOutputJson, outputDigest, outputTargetContractDigest, type OutputBridgeTargetInput, type OutputExecutionBridge, type OutputPreparedAdmission } from "./output-requirements-api.ts";
import { prepareNativeInitialShortStoryRequest, type PreparedNativeInitialShortStoryRequest } from "./openai-adapter.ts";
import { OutputConflictError, type OutputOperationSlot, type OutputScope, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { resolveOutputNativeResult } from "./output-native-result.ts";
import { cleanupExpiredOrRevokedOutputWork } from "./output-execution-control.ts";

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const unavailable=(targetId:string,reasonCode:string,reason:string):OutputNativeTargetPreflight=>({targetId,available:false,reasonCode,transferCode:"output_transfer_none_owned_adoption",reason,provider:null,model:null,route:null,maximumMicrousd:0,maximumCalls:0,maximumTokens:0,settings:{},transferDescription:"No source or file is sent by this check. You can use an owned file after inspection and review."});
export type OutputNativeCallRoute={
 stage:string;provider:string;model:string;maximumMicrousd:number;
 presentationRoute?:PresentationModelRoute;maximumInputTokens?:number;maximumOutputTokens?:number;
};
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
function providerInputInstructions(input:Pick<OutputBridgeTargetInput,"target">){
 return [input.target.instruction_text,`Only this deliverable is requested: ${input.target.label}.`,
  `Coverage contract: ${JSON.stringify(input.target.coverage)}.`,
  "The delivery instructions are not evidence. Ground factual claims in the authorized Document sources."].join("\n");
}

const shortStoryPreparationFailure=(code:string):never=>{throw new OutputConflictError("output_native_short_story_"+code);};
function shortStoryOwnData(value:unknown,key:string,optional=false):unknown{
 if(!value||typeof value!=="object"||Array.isArray(value)
  ||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return shortStoryPreparationFailure("input_invalid");
 const descriptor=Object.getOwnPropertyDescriptor(value,key);
 if(!descriptor){if(optional)return undefined;return shortStoryPreparationFailure("input_invalid");}
 if(!descriptor.enumerable||!("value" in descriptor))return shortStoryPreparationFailure("input_invalid");
 return descriptor.value;
}
function shortStoryDenseData(value:unknown):unknown[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return shortStoryPreparationFailure("input_invalid");
 const length=Object.getOwnPropertyDescriptor(value,"length")?.value;
 if(!Number.isSafeInteger(length)||length<0||length>256)return shortStoryPreparationFailure("input_limit");
 const keys=Reflect.ownKeys(value);
 if(keys.length!==length+1)return shortStoryPreparationFailure("input_invalid");
 const result:unknown[]=[];
 for(let index=0;index<length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
  if(!descriptor?.enumerable||!("value" in descriptor))return shortStoryPreparationFailure("input_invalid");
  result.push(descriptor.value);
 }
 return result;
}
/** Copy required server data only. Never visit Request/env/DB or call data accessors. */
function ownShortStoryPreparationData(value:unknown):unknown{
 // The owned copy uses standard prototypes so it can enter the native decoder.
 // Reject inherited serializers by descriptor, without reading or invoking them.
 if(Object.getOwnPropertyDescriptor(Object.prototype,"toJSON")||Object.getOwnPropertyDescriptor(Array.prototype,"toJSON"))
  return shortStoryPreparationFailure("input_invalid");
 let nodes=0,characters=0;
 const active=new Set<object>();
 const copy=(item:unknown,depth:number):unknown=>{
  if(++nodes>16_384||depth>24)return shortStoryPreparationFailure("input_limit");
  if(item===null||typeof item==="boolean")return item;
  if(typeof item==="string"){
   characters+=item.length;
   if(item.length>65_536||characters>131_072)return shortStoryPreparationFailure("input_limit");
   for(let index=0;index<item.length;index++){
    const unit=item.charCodeAt(index);
    if(unit>=0xd800&&unit<=0xdbff){const next=item.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))return shortStoryPreparationFailure("input_invalid");}
    else if(unit>=0xdc00&&unit<=0xdfff)return shortStoryPreparationFailure("input_invalid");
   }
   return item;
  }
  if(typeof item==="number"){if(!Number.isFinite(item))return shortStoryPreparationFailure("input_invalid");return item;}
  if(!item||typeof item!=="object"||active.has(item))return shortStoryPreparationFailure("input_invalid");
  active.add(item);
  let result:unknown;
  if(Array.isArray(item))result=shortStoryDenseData(item).map(entry=>copy(entry,depth+1));
  else{
   if(![Object.prototype,null].includes(Object.getPrototypeOf(item)))return shortStoryPreparationFailure("input_invalid");
   const keys=Reflect.ownKeys(item);
   if(keys.length>256)return shortStoryPreparationFailure("input_limit");
   const entries:Array<[string,unknown]>=[];
   for(const key of keys){
    if(typeof key!=="string"||key.length>200||["__proto__","prototype","constructor","toJSON"].includes(key))return shortStoryPreparationFailure("input_invalid");
    entries.push([key,copy(shortStoryOwnData(item,key),depth+1)]);
   }
   result=Object.fromEntries(entries);
  }
  active.delete(item);
  return Object.freeze(result);
 };
 const captured=copy(value,0);
 if(new TextEncoder().encode(JSON.stringify(captured)).byteLength>262_144)return shortStoryPreparationFailure("input_limit");
 return captured;
}
const shortStoryIdentity=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=200&&value.trim()===value;
const shortStoryTargetIdentity=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);

export type PreparedOutputShortStoryTarget=Readonly<{
 qualification:"native-initial-preparation-only";
 preparation:PreparedNativeInitialShortStoryRequest;
 binding:Readonly<{
  ownerUserId:string;actorUserId:string;streamId:string;projectId:string;documentId:string;scopeKey:string;
  planRevisionId:string;planRevision:number;targetId:string;sourceDigest:string;requirementsDigest:string;
  documentRevision:string;sourceSnapshotDigest:string;documentTitleDigest:string;fullTargetDigest:string;
  targetContractDigest:string;instructionsDigest:string;requestDigest:string;
 }>;
 authorizations:Readonly<{admission:false;dispatch:false;repair:false;settlement:false;publication:false;certifiedRecovery:false}>;
 sourceCustody:false;currentOriginalAuthority:false;liveRequestParity:false;
}>;

/** Read-only preparation evidence, never a grant, job payload or current-authority certificate. */
export async function prepareOutputShortStoryTarget(input:OutputBridgeTargetInput):Promise<PreparedOutputShortStoryTarget>{
 const rawScope=shortStoryOwnData(input,"scope"),rawPrincipal=shortStoryOwnData(input,"principal");
 const rawContext=shortStoryOwnData(input,"context"),rawPlan=shortStoryOwnData(input,"confirmedPlan");
 const rawDefinition=shortStoryOwnData(rawPlan,"plan"),rawProjection=shortStoryOwnData(rawContext,"projection");
 const rawDocumentId=shortStoryOwnData(rawScope,"documentId"),rawProjectId=shortStoryOwnData(rawScope,"projectId");
 const documents=shortStoryDenseData(shortStoryOwnData(rawProjection,"documents")).filter(document=>
  shortStoryOwnData(document,"id")===rawDocumentId&&shortStoryOwnData(document,"projectId")===rawProjectId
   &&shortStoryOwnData(document,"removed")===false);
 if(documents.length!==1)return shortStoryPreparationFailure("document_mismatch");
 const document=documents[0];
 const captured=ownShortStoryPreparationData({
  scope:rawScope,
  principal:{
   userId:shortStoryOwnData(rawPrincipal,"userId"),streamId:shortStoryOwnData(rawPrincipal,"streamId"),
   role:shortStoryOwnData(rawPrincipal,"role"),fictional:shortStoryOwnData(rawPrincipal,"fictional",true)??false,
   projectExecution:shortStoryOwnData(rawPrincipal,"projectExecution",true)??null,
   billingUserId:shortStoryOwnData(rawPrincipal,"billingUserId",true)??shortStoryOwnData(rawPrincipal,"userId"),
  },
  document:{id:shortStoryOwnData(document,"id"),projectId:shortStoryOwnData(document,"projectId"),title:shortStoryOwnData(document,"title")},
  snapshot:shortStoryOwnData(rawContext,"snapshot"),sourceBlockVersions:shortStoryOwnData(rawContext,"sourceBlockVersions"),
  documentRevision:shortStoryOwnData(rawContext,"documentRevision"),target:shortStoryOwnData(input,"target"),
  sourceDigest:shortStoryOwnData(input,"sourceDigest"),requirementsDigest:shortStoryOwnData(input,"requirementsDigest"),
  plan:{
   id:shortStoryOwnData(rawPlan,"id"),revisionId:shortStoryOwnData(rawPlan,"revisionId"),revision:shortStoryOwnData(rawPlan,"revision"),
   sourceDigest:shortStoryOwnData(rawPlan,"sourceDigest"),requirementsDigest:shortStoryOwnData(rawPlan,"requirementsDigest"),
   documentId:shortStoryOwnData(rawDefinition,"document_id"),sourceRevision:shortStoryOwnData(rawDefinition,"source_revision"),
   requirementRevision:shortStoryOwnData(rawDefinition,"requirement_revision"),targets:shortStoryOwnData(rawDefinition,"targets"),
   targetContractDigests:shortStoryOwnData(rawPlan,"targetContractDigests"),
  },
 }) as {
  scope:OutputScope;principal:{userId:string;streamId:string;role:string;fictional:unknown;projectExecution:unknown;billingUserId:string};
  document:{id:string;projectId:string;title:string};snapshot:Record<string,unknown>;sourceBlockVersions:unknown;
  documentRevision:string;target:OutputPlanTarget;sourceDigest:string;requirementsDigest:string;
  plan:{id:string;revisionId:string;revision:number;sourceDigest:string;requirementsDigest:string;documentId:string;
   sourceRevision:string;requirementRevision:string;targets:OutputPlanTarget[];targetContractDigests:Record<string,string>};
 };
 // Everything subsequently read is captured own data. No mutable bridge input is reread after an await.
 const {scope,principal,target,plan,snapshot,sourceDigest,requirementsDigest,documentRevision}=captured;
 if(!scope||typeof scope!=="object"||Array.isArray(scope)||!target||typeof target!=="object"||Array.isArray(target)
  ||!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)||!Array.isArray(plan.targets)
  ||!plan.targetContractDigests||typeof plan.targetContractDigests!=="object"||Array.isArray(plan.targetContractDigests))
  return shortStoryPreparationFailure("input_invalid");
 if(!["key","ownerUserId","actorUserId","projectId","documentId"].every(key=>shortStoryIdentity(scope[key as keyof OutputScope]))
  ||scope.kind!=="personal"||scope.key!=="personal:"+scope.ownerUserId+":"+scope.projectId
  ||scope.organizationId!==null||scope.projectAccessId!==null||scope.contextId!==null
  ||principal.userId!==scope.ownerUserId||scope.actorUserId!==scope.ownerUserId
  ||principal.streamId!=="creative:"+scope.ownerUserId||principal.billingUserId!==scope.ownerUserId
  ||principal.fictional!==false||principal.projectExecution!==null||!["creator","admin"].includes(principal.role))
  return shortStoryPreparationFailure("scope_mismatch");
 if(captured.document.id!==scope.documentId||captured.document.projectId!==scope.projectId
  ||typeof captured.document.title!=="string"||captured.document.title.length>1024)return shortStoryPreparationFailure("document_mismatch");
 if(!shortStoryTargetIdentity(target.id)||target.media_kind!=="document"
  ||canonicalOutputJson(target.artifact_format)!==canonicalOutputJson({kind:"short_story",version:1})
  ||target.selected!==true||!Array.isArray(target.blocking_issues)||target.blocking_issues.length
  ||canonicalOutputJson(target.quantity)!==canonicalOutputJson({kind:"exact",unit:"document",value:1})
  ||canonicalOutputJson(target.source_scope)!==canonicalOutputJson({kind:"document"})
  ||target.aspect_ratio!==null||target.content_quantity!==null||target.count_policy!==null||target.suggested_count!==null
  ||typeof target.label!=="string"||!target.label.trim()||typeof target.instruction_text!=="string"||!target.instruction_text.trim()
  ||!target.coverage||!["document_context","document_outline","topics"].includes(target.coverage.kind))
  return shortStoryPreparationFailure("target_unsupported");
 const retained=plan.targets.filter(candidate=>record(candidate).id===target.id);
 if(retained.length!==1||canonicalOutputJson(retained[0])!==canonicalOutputJson(target))
  return shortStoryPreparationFailure("target_mismatch");
 if(plan.id!==scope.documentId||plan.documentId!==scope.documentId||!shortStoryIdentity(plan.revisionId)
  ||!Number.isSafeInteger(plan.revision)||plan.revision<1
  ||![sourceDigest,requirementsDigest,plan.targetContractDigests[target.id]].every(value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value))
  ||plan.sourceDigest!==sourceDigest||plan.sourceRevision!==sourceDigest||target.source_revision!==sourceDigest
  ||plan.requirementsDigest!==requirementsDigest||plan.requirementRevision!==requirementsDigest||target.requirement_revision!==requirementsDigest
  ||!Array.isArray(captured.sourceBlockVersions)||!Array.isArray(snapshot.facts)
  ||snapshot.facts.some(fact=>record(fact).document_id!==scope.documentId)
  ||documentRevision!==documentGenerationRevision({snapshot,sourceBlockVersions:captured.sourceBlockVersions,documentId:scope.documentId}))
  return shortStoryPreparationFailure("source_mismatch");
 const sourceIds=new Set<string>();
 for(const value of captured.sourceBlockVersions){
  const version=record(value);
  if(Object.keys(version).length!==2||!shortStoryIdentity(version.block_id)||sourceIds.has(version.block_id)
   ||!Number.isSafeInteger(version.version)||Number(version.version)<1)return shortStoryPreparationFailure("source_mismatch");
  sourceIds.add(version.block_id);
 }
 if(snapshot.facts.some(fact=>{const id=record(fact).block_id;return !shortStoryIdentity(id)||!sourceIds.has(id);}))
  return shortStoryPreparationFailure("source_mismatch");
 const instructions=providerInputInstructions({target});
 const targetContractDigest=await outputTargetContractDigest(target,sourceDigest);
 if(targetContractDigest!==plan.targetContractDigests[target.id])return shortStoryPreparationFailure("target_mismatch");
 const [preparation,sourceSnapshotDigest,documentTitleDigest,fullTargetDigest,instructionsDigest]=await Promise.all([
  prepareNativeInitialShortStoryRequest(scope.ownerUserId,{documentTitle:captured.document.title,snapshot,outputTargetInstructions:instructions}),
  outputDigest(snapshot),outputDigest(captured.document.title),outputDigest(target),outputDigest(instructions),
 ]);
 return Object.freeze({
  qualification:"native-initial-preparation-only" as const,preparation,
  binding:Object.freeze({ownerUserId:scope.ownerUserId,actorUserId:scope.actorUserId,streamId:principal.streamId,
   projectId:scope.projectId,documentId:scope.documentId,scopeKey:scope.key,planRevisionId:plan.revisionId,
   planRevision:plan.revision,targetId:target.id,sourceDigest,requirementsDigest,documentRevision,sourceSnapshotDigest,
   documentTitleDigest,fullTargetDigest,targetContractDigest,instructionsDigest,requestDigest:preparation.requestDigest}),
  authorizations:Object.freeze({admission:false as const,dispatch:false as const,repair:false as const,
   settlement:false as const,publication:false as const,certifiedRecovery:false as const}),
  sourceCustody:false as const,currentOriginalAuthority:false as const,liveRequestParity:false as const,
 });
}

async function preflightOutputShortStoryTarget(input:OutputBridgeTargetInput,targetId:string):Promise<OutputNativeTargetPreflight>{
 let reasonCode="output_native_short_story_execution_disabled";
 try{await prepareOutputShortStoryTarget(input);}catch{reasonCode="output_native_short_story_preparation_unavailable";}
 // The ordinary endpoint persists this object; never attach private preparation or error data.
 return {targetId,available:false,reasonCode,reason:"Generation unavailable",transferCode:"output_transfer_none_owned_adoption",
  provider:null,model:null,route:null,maximumMicrousd:0,maximumCalls:0,maximumTokens:0,settings:{},transferDescription:"No transfer"};
}
export function outputJobUser(principal:PilotUser,scope:OutputScope):PilotUser{
 return scope.kind==="project"?{...principal,streamId:`creative:${scope.ownerUserId}`,projectExecution:{organizationId:scope.organizationId!,projectAccessId:scope.projectAccessId!,projectId:scope.projectId,ownerUserId:scope.ownerUserId,actorUserId:scope.actorUserId}}:principal;
}

export async function preflightOutputNativeTarget(input:OutputBridgeTargetInput):Promise<OutputNativeTargetPreflight>{
 const candidate=shortStoryOwnData(input,"target");
 if(shortStoryOwnData(candidate,"media_kind")==="document"){
  const format=shortStoryOwnData(candidate,"artifact_format",true);
  if(format!==undefined&&shortStoryOwnData(format,"kind")==="short_story"&&shortStoryOwnData(format,"version")===1){
   const targetId=shortStoryOwnData(candidate,"id");
   if(!shortStoryTargetIdentity(targetId))return shortStoryPreparationFailure("input_invalid");
   return preflightOutputShortStoryTarget(input,targetId);
  }
 }
 const {target,env}=input;
 if(!target.selected||target.blocking_issues.length)return unavailable(target.id,target.blocking_issues[0]?.code??"output_native_target_not_selected",target.blocking_issues[0]?.message??"Select this resolved target before creating it.");
 if(target.source_scope.kind!=="document")return unavailable(target.id,"output_native_document_scope_required","Native creation currently requires the full authorized Document. Scoped targets can be completed with a verified owned file.");
 if(target.media_kind==="model3d")return preflightOutputModel3dTarget(input);
 if(!["image","slides"].includes(target.media_kind))return unavailable(target.id,"output_native_medium_adoption_only","This medium uses verified owned-file adoption in this release; no provider job will be substituted.");
 if(!env.OPENAI_API_KEY)return unavailable(target.id,"output_native_planner_unconfigured","The planning provider is not configured. Saving and owned-file adoption remain available.");
 const plannerModel=env.OPENAI_MODEL??"gpt-5.6-terra";
 if(target.media_kind!=="slides"&&!hasKnownTextModelPricing(plannerModel))return unavailable(target.id,"output_native_planner_price_unknown","The configured planning model has no known price contract.");
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
  let calls:OutputNativeCallRoute[];
  try{
   const routes=resolvePresentationModelRoutes(env);
   // These exact route fields and caps are included in the persisted quote digest.
   const quotedCall=(stage:string,presentationRoute:PresentationModelRoute):OutputNativeCallRoute=>({
    stage,provider:"openai",model:presentationRoute.model,presentationRoute,maximumInputTokens,maximumOutputTokens:maxOutput,
    maximumMicrousd:Math.max(500_000,estimateOpenAITextCallMaximumMicrousd(presentationRoute.model,maximumInputTokens,maxOutput)),
   });
   calls=[quotedCall("planning:0:initial",routes.composition),quotedCall("planning:0:repair",routes.repair)];
  }catch(error){
   if(error instanceof PresentationModelConfigurationError||error instanceof OpenAITextAccountingError)return unavailable(target.id,error.code,error.message);
   throw error;
  }
  maximumMicrousd=calls.reduce((sum,call)=>sum+call.maximumMicrousd,0);maximumTokens=documentRenderTokenReservation("slides",counts.itemCount,2);
  settings={kind:"render_document",payload:{...common,artifactKind:"slides",itemCount:counts.itemCount,slideCountPolicy:counts.slideCountPolicy,...(counts.requestedSlideCount===undefined?{}:{requestedSlideCount:counts.requestedSlideCount})},calls};
  provider="openai";model=calls[0]!.model;route="document-slides-manual-v1";
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

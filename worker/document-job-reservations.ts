import { normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { AUDIO_ADAPTER_CONTRACT, audioAdapterContractForModel, estimateAudioProviderCostMicrousd, normalizeAudioRequestProfile } from "../src/model/audio.ts";
import { priceFalIdeogramImageBreakdownMicrousd, priceTextUsageBreakdownMicrousd, type FalIdeogramRenderingSpeed, type ProviderCostBreakdown, type ProviderUsage } from "./replay-cost.ts";

type Checkpoint = Record<string, unknown>;
type PlannerUsageEvent = { type?: string; payload: Checkpoint };

export type InterruptedDocumentJobUsage = {
  plannerModel: string;
  plannerResponseId: string;
  plannerUsage: ProviderUsage;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  plannerCostMicrousd: number;
  sceneCostMicrousd: number;
  frameCostMicrousd: number;
  anchorCostMicrousd: number;
  singleVideoCostMicrousd: number;
  singleAudioCostMicrousd: number;
  totalCostMicrousd: number;
  prepaidSceneIds: string[];
};

const positiveInteger = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const validFalRequestId=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value)&&!["pending","submitted","unknown"].includes(value.toLowerCase());

export type StoryboardSafeRecoveryCheckpoint={
  enabled:true;
  failedFrameIndex:number;
  rejectedProviderJobId:string;
  rejectedPromptSha256:string;
  maxAttempts:1;
  attemptedAt:string;
  completedFrameBreakdowns:ProviderCostBreakdown[];
  rejectedFrameBreakdown:ProviderCostBreakdown;
  rejectedFrameCostMicrousd:number;
};

/** Continue only the exact worker-owned terminal rejection; never trust client-supplied pricing or provider identities. */
export function validatedStoryboardSafeRecovery(value:unknown,rejectedValue:unknown,renderedValue:unknown,expectedModel:string):StoryboardSafeRecoveryCheckpoint|null{
  const marker=value&&typeof value==="object"&&!Array.isArray(value)?value as Checkpoint:null;
  const rejected=rejectedValue&&typeof rejectedValue==="object"&&!Array.isArray(rejectedValue)?rejectedValue as Checkpoint:null;
  const rendered=Array.isArray(renderedValue)?renderedValue:null;
  if(!marker||!rejected||!rendered||marker.enabled!==true||marker.maxAttempts!==1||!Number.isSafeInteger(marker.failedFrameIndex)||Number(marker.failedFrameIndex)<0||Number(marker.failedFrameIndex)!==rendered.length||rendered.length>11||!validFalRequestId(marker.rejectedProviderJobId)||rejected.providerJobId!==marker.rejectedProviderJobId||typeof marker.rejectedPromptSha256!=="string"||!/^[a-f0-9]{64}$/u.test(marker.rejectedPromptSha256)||rejected.promptSha256!==marker.rejectedPromptSha256||typeof marker.attemptedAt!=="string"||!Number.isFinite(Date.parse(marker.attemptedAt))||rejected.providerModel!==expectedModel)return null;
  const dimensions=(entry:Checkpoint)=>({width:Math.floor(Number(entry.width??1536)),height:Math.floor(Number(entry.height??1024))});
  const charge=(entry:Checkpoint)=>{
    const {width,height}=dimensions(entry);
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<256||height<256||width>4096||height>4096)return null;
    const model=String(entry.provider_model??entry.providerModel??expectedModel);
    const speed=entry.rendering_speed??entry.renderingSpeed??"BALANCED";
    const expansion=entry.expansion_model??entry.expansionModel??"Medium";
    if(model!==expectedModel||!["TURBO","BALANCED","QUALITY"].includes(String(speed))||!["None","Medium","Large"].includes(String(expansion)))return null;
    return priceFalIdeogramImageBreakdownMicrousd(model,width,height,speed as FalIdeogramRenderingSpeed,expansion as "None"|"Medium"|"Large");
  };
  const completedFrameBreakdowns:ProviderCostBreakdown[]=[];
  const providerIds=new Set<string>();
  for(const value of rendered){
    if(!value||typeof value!=="object"||Array.isArray(value))return null;
    const frame=value as Checkpoint;
    const requestId=frame.provider_request_id;
    if(frame.provider!=="fal"||!validFalRequestId(requestId)||requestId===marker.rejectedProviderJobId||providerIds.has(requestId)||typeof frame.media_url!=="string"||!/^\/api\/media\/[A-Za-z0-9._~%+-]+$/u.test(frame.media_url))return null;
    const breakdown=charge(frame);
    if(!breakdown||Object.hasOwn(frame,"cost_microusd")&&positiveInteger(frame.cost_microusd)!==breakdown.totalMicrousd)return null;
    providerIds.add(requestId);completedFrameBreakdowns.push(breakdown);
  }
  const rejectedFrameBreakdown=charge(rejected);
  if(!rejectedFrameBreakdown||Object.hasOwn(rejected,"estimatedCostMicrousd")&&positiveInteger(rejected.estimatedCostMicrousd)!==rejectedFrameBreakdown.totalMicrousd)return null;
  return{enabled:true,failedFrameIndex:Number(marker.failedFrameIndex),rejectedProviderJobId:marker.rejectedProviderJobId,rejectedPromptSha256:marker.rejectedPromptSha256,maxAttempts:1,attemptedAt:marker.attemptedAt,completedFrameBreakdowns,rejectedFrameBreakdown,rejectedFrameCostMicrousd:rejectedFrameBreakdown.totalMicrousd};
}

/** A definitive pre-acceptance HTTP rejection must not become an imaginary paid Lyria job. */
export function audioProviderSubmissionState(options:{attempted:boolean;providerJobId?:unknown;httpStatus?:number|null}):"not_submitted"|"confirmed"|"rejected"|"unknown"{
  if(String(options.providerJobId??"").trim())return"confirmed";
  if(!options.attempted)return"not_submitted";
  return new Set([400,401,402,403,404,405,413,415,422,429]).has(Number(options.httpStatus??0))?"rejected":"unknown";
}

const usageFrom = (value: unknown): ProviderUsage => {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    inputTokens: positiveInteger(usage.inputTokens),
    outputTokens: positiveInteger(usage.outputTokens),
    totalTokens: positiveInteger(usage.totalTokens),
  };
};

const checkpointReceipts = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.values(value as Record<string, unknown>).filter((receipt): receipt is Checkpoint => Boolean(receipt) && typeof receipt === "object" && !Array.isArray(receipt))
  : [];

/** Token and dollar ledgers settle independently, so neither receipt proves the other was charged. */
export function recordedDocumentPlannerUsage(events: readonly PlannerUsageEvent[], plannerResponseId: string, expectedCostMicrousd=0) {
  let tokensRecorded=false;
  let recordedCostMicrousd=0;
  if(!plannerResponseId)return{tokensRecorded,costRecorded:false,recordedCostMicrousd};
  for(const event of events){
    if(event.type&&event.type!=="GenerationUsageRecorded")continue;
    const payload=event.payload;
    if(String(payload.planner_response_id??"")!==plannerResponseId)continue;
    const plannerTokens=Object.hasOwn(payload,"planner_tokens")?positiveInteger(payload.planner_tokens)
      :payload.planner_usage_previously_recorded===true?0:positiveInteger(payload.total_tokens);
    const recordedCost=positiveInteger(payload.cost_microusd);
    const plannerCost=Object.hasOwn(payload,"planner_cost_microusd")?positiveInteger(payload.planner_cost_microusd)
      :plannerTokens>0?recordedCost:0;
    tokensRecorded||=plannerTokens>0;
    recordedCostMicrousd+=Math.min(recordedCost,plannerCost);
  }
  const expected=positiveInteger(expectedCostMicrousd);
  return{tokensRecorded,costRecorded:expected>0?recordedCostMicrousd>=expected:recordedCostMicrousd>0,recordedCostMicrousd};
}

/** Apply earlier planner payments to input and output pricing without erasing an unpaid remainder. */
export function remainingDocumentPlannerCost(model:string,usage:ProviderUsage,recordedCostMicrousd=0):ProviderCostBreakdown{
  const full=priceTextUsageBreakdownMicrousd(model,usage);
  const paid=Math.min(full.totalMicrousd,positiveInteger(recordedCostMicrousd));
  const paidInput=Math.min(full.textInputMicrousd,paid);
  const paidOutput=Math.min(full.textOutputMicrousd,Math.max(0,paid-paidInput));
  return{...full,textInputMicrousd:full.textInputMicrousd-paidInput,textOutputMicrousd:full.textOutputMicrousd-paidOutput,totalMicrousd:full.totalMicrousd-paid};
}

/** Recover only documented, account-owned work; old anchor receipts retain their historical conservative allowance. */
export function interruptedDocumentJobUsage(
  checkpoint: Checkpoint,
  request: Checkpoint = {},
  options: { plannerAlreadyRecorded?: boolean; plannerTokensAlreadyRecorded?: boolean; plannerCostAlreadyRecorded?: boolean; plannerCostAlreadyRecordedMicrousd?:number } = {},
): InterruptedDocumentJobUsage {
  const plannerUsage = usageFrom(checkpoint.plannerUsage);
  const plannerModel = String(checkpoint.plannerModel ?? "gpt-5.6-terra");
  const plannerResponseId = String(checkpoint.plannerResponseId ?? "");
  const billablePlannerUsage = options.plannerAlreadyRecorded||options.plannerTokensAlreadyRecorded ? usageFrom(null) : plannerUsage;
  const costedPlannerUsage = options.plannerAlreadyRecorded||options.plannerCostAlreadyRecorded ? usageFrom(null) : plannerUsage;
  const prepaidSceneIds = new Set(Array.isArray(checkpoint.productionPrepaidSceneIds) ? checkpoint.productionPrepaidSceneIds.map(String) : []);
  const sceneReceipts = checkpointReceipts(checkpoint.productionSceneReceipts);
  const frameReceipts = checkpointReceipts(checkpoint.productionFrameReceipts);
  const anchor = checkpoint.productionAnchor && typeof checkpoint.productionAnchor === "object" && !Array.isArray(checkpoint.productionAnchor)
    ? checkpoint.productionAnchor as Checkpoint
    : null;
  const prepaidAnchor = checkpoint.productionPrepaidAnchor === true || prepaidSceneIds.size > 0;
  const anchorUsage = anchor && !prepaidAnchor ? usageFrom(anchor.usage) : usageFrom(null);
  const anchorCostMicrousd = anchor && !prepaidAnchor
    ? Object.hasOwn(anchor, "costMicrousd") ? positiveInteger(anchor.costMicrousd) : 500_000
    : 0;

  let inputTokens = billablePlannerUsage.inputTokens + anchorUsage.inputTokens;
  let outputTokens = billablePlannerUsage.outputTokens + anchorUsage.outputTokens;
  let totalTokens = billablePlannerUsage.totalTokens + anchorUsage.totalTokens;
  let frameCostMicrousd = 0;
  for (const frame of frameReceipts) {
    const usage = usageFrom(frame.usage);
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    totalTokens += usage.totalTokens;
    frameCostMicrousd += positiveInteger(frame.costMicrousd);
  }

  const sceneCostMicrousd = sceneReceipts.reduce((total, scene) => {
    if (scene.status !== "submitted" && scene.status !== "completed" || prepaidSceneIds.has(String(scene.sceneId ?? ""))) return total;
    const receipt = scene.videoInputReceipt && typeof scene.videoInputReceipt === "object" ? scene.videoInputReceipt as Checkpoint : {};
    const parameters = receipt.parameters && typeof receipt.parameters === "object" ? receipt.parameters as Checkpoint : {};
    const resolution = parameters.resolution === "480p" || parameters.resolution === "720p"
      ? parameters.resolution
      : VIDEO_ADAPTER_CONTRACT.defaultResolution;
    const estimated = positiveInteger(scene.durationSeconds) * VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[resolution];
    return total + (Object.hasOwn(scene, "costMicrousd") ? positiveInteger(scene.costMicrousd) : estimated);
  }, 0);

  const singleVideoCostMicrousd = checkpoint.providerJobId && !sceneReceipts.length && request.artifactKind === "video"
    ? Math.max(0, normalizeVideoDurationSeconds(request.videoSeconds) * VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd[VIDEO_ADAPTER_CONTRACT.defaultResolution] - positiveInteger(checkpoint.prepaidProviderCostMicrousd))
    : 0;
  let acceptedAudioCostMicrousd=AUDIO_ADAPTER_CONTRACT.publishedCostMicrousd;
  if(checkpoint.providerJobId&&request.artifactKind==="audio"){
    const receipt=checkpoint.audioInputReceipt&&typeof checkpoint.audioInputReceipt==="object"&&!Array.isArray(checkpoint.audioInputReceipt)?checkpoint.audioInputReceipt as Checkpoint:{};
    const parameters=receipt.parameters&&typeof receipt.parameters==="object"&&!Array.isArray(receipt.parameters)?receipt.parameters as Checkpoint:{};
    const model=String(receipt.model??checkpoint.providerModel??request.audioProviderModel??AUDIO_ADAPTER_CONTRACT.model);
    const contract=audioAdapterContractForModel(model);
    if(contract){
      const original=request.audioProfile&&typeof request.audioProfile==="object"&&!Array.isArray(request.audioProfile)?request.audioProfile as Checkpoint:{};
      const profile=normalizeAudioRequestProfile({...original,...(typeof parameters.goal==="string"?{goal:parameters.goal}:{}),...(Number(parameters.duration_seconds)>0?{durationSeconds:Number(parameters.duration_seconds)}:{})});
      const submittedPrompt=String(receipt.submitted_prompt??"");
      acceptedAudioCostMicrousd=estimateAudioProviderCostMicrousd(contract,profile,contract.pricing.mode==="per_1000_characters"&&submittedPrompt?{characterCount:submittedPrompt.length}:undefined);
    }
  }
  const singleAudioCostMicrousd=checkpoint.providerJobId&&request.artifactKind==="audio"
    ?Math.max(0,acceptedAudioCostMicrousd-positiveInteger(checkpoint.prepaidProviderCostMicrousd)):0;
  const plannerCostMicrousd = remainingDocumentPlannerCost(plannerModel,costedPlannerUsage,options.plannerCostAlreadyRecordedMicrousd).totalMicrousd;
  const totalCostMicrousd = plannerCostMicrousd + sceneCostMicrousd + frameCostMicrousd + anchorCostMicrousd + singleVideoCostMicrousd + singleAudioCostMicrousd;

  return {
    plannerModel,
    plannerResponseId,
    plannerUsage: billablePlannerUsage,
    inputTokens,
    outputTokens,
    totalTokens,
    plannerCostMicrousd,
    sceneCostMicrousd,
    frameCostMicrousd,
    anchorCostMicrousd,
    singleVideoCostMicrousd,
    singleAudioCostMicrousd,
    totalCostMicrousd,
    prepaidSceneIds: [...prepaidSceneIds],
  };
}

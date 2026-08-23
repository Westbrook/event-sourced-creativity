import { normalizeVideoDurationSeconds, VIDEO_ADAPTER_CONTRACT } from "../src/model/video-adapter.ts";
import { priceTextUsageBreakdownMicrousd, type ProviderCostBreakdown, type ProviderUsage } from "./replay-cost.ts";

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
  totalCostMicrousd: number;
  prepaidSceneIds: string[];
};

const positiveInteger = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

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
  const plannerCostMicrousd = remainingDocumentPlannerCost(plannerModel,costedPlannerUsage,options.plannerCostAlreadyRecordedMicrousd).totalMicrousd;
  const totalCostMicrousd = plannerCostMicrousd + sceneCostMicrousd + frameCostMicrousd + anchorCostMicrousd + singleVideoCostMicrousd;

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
    totalCostMicrousd,
    prepaidSceneIds: [...prepaidSceneIds],
  };
}

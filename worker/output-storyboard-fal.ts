import { captureOutputStoryboardPlan, outputStoryboardFrameBinding, type CapturedStoryboardPlan } from "./output-storyboard-plan.ts";
import { restoreOutputFalImageRequest, readOutputFalImageContract, type OutputFalCapturedRequest } from "./output-fal-image-contract.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import { parseStoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import {captureStoryboardPlannerRequest,readStoryboardPlannerExecution} from "./output-storyboard-request.ts";

export type StoryboardFrameAttempt = Readonly<{
  contract: CapturedStoryboardPlan["contract"]; planRaw: string; plannerResponseId: string; frameIndex: number; adaptedRequestDigest: string;
  plannerRequestBody?:string;
}>;
const fail = (): never => { throw new Error("output_storyboard_frame_request_invalid"); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Mapping only: the existing Fal adapter still owns the final body capture,
 * safety check and lexical POST boundary. No alternate provider path exists. */
export async function bindStoryboardFrameAttempt(plan: CapturedStoryboardPlan, frameIndex: number, attempt: ProviderAttemptPreflight) {
  const fal = readOutputFalImageContract(attempt.falImage);
  if (!fal || attempt.logicalCallKey !== "image:initial" || attempt.model !== fal.model
    || attempt.maximumInputTokens !== 0 || attempt.maximumOutputTokens !== 0 || !attempt.requestDigest
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(attempt.clientRequestId) || attempt.storyboard !== undefined) return fail();
  const binding = await outputStoryboardFrameBinding(plan, frameIndex, attempt.requestDigest);
  return Object.freeze({ ...attempt, logicalCallKey: binding.stage, requestDigest: binding.requestDigest,
    storyboard: Object.freeze({ contract: plan.contract, planRaw: plan.raw, plannerResponseId: plan.plannerResponseId,
      frameIndex, adaptedRequestDigest: attempt.requestDigest,...(plan.plannerRequestBody?{plannerRequestBody:plan.plannerRequestBody}:{}) }) });
}

/** Reconstruct the exact mapped claim; the source contract still needs the
 * caller's original-intake/owner/slot/lease SQL proof, not just this hash match. */
export async function readStoryboardFrameAttempt(attempt: ProviderAttemptPreflight, expectedContract: unknown, expectedPlanner?:unknown) {
  const value = attempt.storyboard;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = ["contract", "planRaw", "plannerResponseId", "frameIndex", "adaptedRequestDigest",...(Object.hasOwn(value,"plannerRequestBody")?["plannerRequestBody"]:[])];
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key])) return fail();
  const row = value as StoryboardFrameAttempt;
  const expectedSource = parseStoryboardOutputContract(expectedContract);
  if (typeof row.planRaw !== "string" || row.planRaw.length > 262_144 || typeof row.adaptedRequestDigest !== "string" || !expectedSource) return fail();
  if(row.plannerRequestBody!==undefined){
    const execution=readStoryboardPlannerExecution(expectedPlanner);
    if(!execution||typeof row.plannerRequestBody!=="string")return fail();
    const captured=await captureStoryboardPlannerRequest(row.contract,row.plannerRequestBody,attempt.clientRequestId);
    if(captured.requestDigest!==execution.requestDigest||captured.maximumInputTokens!==execution.maximumInputTokens||!same(captured.contract,execution.contract))return fail();
  }
  const plan = await captureOutputStoryboardPlan(JSON.parse(row.planRaw), row.contract, row.plannerResponseId,row.plannerRequestBody);
  if (plan.raw !== row.planRaw || !same(plan.contract, expectedSource)) return fail();
  const original = { ...attempt, logicalCallKey: "image:initial", requestDigest: row.adaptedRequestDigest };
  delete original.storyboard;
  const expected = await bindStoryboardFrameAttempt(plan, row.frameIndex, original);
  if (attempt.logicalCallKey !== expected.logicalCallKey || attempt.requestDigest !== expected.requestDigest) return fail();
  return { plan, frameIndex: row.frameIndex, stage: expected.logicalCallKey, requestDigest: expected.requestDigest };
}

export async function storyboardFrameRequest(plan: CapturedStoryboardPlan, frameIndex: number, request: OutputFalCapturedRequest) {
  const captured = await restoreOutputFalImageRequest(request.contract, request.body, request.attempt.clientRequestId, request.attempt.requestDigest);
  return { captured, attempt: await bindStoryboardFrameAttempt(plan, frameIndex, captured.attempt) };
}

/** Reuse the existing adapter sequence: claim → checkpoint → pending → final
 * synchronous dispatch guard → POST. Neither callback can dispatch or mint a
 * claim by itself. Every checkpoint must match the previously admitted attempt. */
export function storyboardFrameHooks(plan: CapturedStoryboardPlan, frameIndex: number, hooks: {
  beforeAttempt: (attempt: ProviderAttemptPreflight) => Promise<void>;
  checkpoint: (request: OutputFalCapturedRequest, plan: CapturedStoryboardPlan, frameIndex: number) => Promise<void>;
}) {
  let claimed: ProviderAttemptPreflight | null = null;
  return {
    async onBeforeProviderAttempt(attempt: ProviderAttemptPreflight) {
      if (claimed) return fail();
      const mapped = await bindStoryboardFrameAttempt(plan, frameIndex, attempt);
      await hooks.beforeAttempt(mapped); claimed = mapped;
    },
    async onOutputFalRequest(request: OutputFalCapturedRequest) {
      if (!claimed) return fail();
      const mapped = await storyboardFrameRequest(plan, frameIndex, request);
      if (mapped.attempt.clientRequestId !== claimed.clientRequestId || mapped.attempt.requestDigest !== claimed.requestDigest) return fail();
      await hooks.checkpoint(mapped.captured, plan, frameIndex);
    },
  };
}

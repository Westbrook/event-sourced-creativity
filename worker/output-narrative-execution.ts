import { captureOutputNarrativeRequest, outputNarrativeBodyReceipt, readOutputNarrativeExecution, type OutputNarrativeExecution } from "./output-narrative-request.ts";
import { providerSubmissions } from "../src/model/provider-submission.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import type { OutputNativeSettings } from "./output-image-slides-preflight.ts";
import type { ProviderCostBreakdown } from "./replay-cost.ts";

/** Only trusted preparation/settings may select this fixed manual route. */
export async function readOutputNarrativePayload(payload: Record<string, unknown>): Promise<OutputNarrativeExecution | null> {
  if (!Object.hasOwn(payload, "outputNarrative")) return null;
  const narrative = await readOutputNarrativeExecution(payload.outputNarrative);
  return narrative && payload.artifactKind === "short_story" && payload.productionMode === "manual" && payload.itemCount === 3
    && !payload.productionPlan && !payload.productionPage && typeof payload.outputTargetInstructions === "string" ? narrative : null;
}

/** Revalidate actual request bytes against the original quote before its only call is claimed. */
export async function assertOutputNarrativeAttempt(settings: OutputNativeSettings, attempt: ProviderAttemptPreflight): Promise<void> {
  const narrative = await readOutputNarrativePayload(settings.payload), provided = await readOutputNarrativeExecution(attempt.narrative?.execution);
  const route = settings.calls[0];
  if (!narrative || !provided || JSON.stringify(provided) !== JSON.stringify(narrative) || settings.kind !== "render_document" || settings.calls.length !== 1 || !route
    || route.stage !== narrative.stage || route.provider !== "openai" || route.model !== narrative.model || route.maximumInputTokens !== narrative.maximumInputTokens || route.maximumOutputTokens !== narrative.maximumOutputTokens
    || typeof attempt.narrative?.requestBody !== "string") throw new Error("output_narrative_request_not_authorized");
  const captured = await captureOutputNarrativeRequest(narrative, "short_story", attempt.narrative.requestBody, attempt.clientRequestId);
  for (const key of ["model", "logicalCallKey", "requestDigest", "maximumInputTokens", "maximumOutputTokens", "reasoningEffort", "pricingVersion", "cachePolicy"] as const) {
    if (attempt[key] !== captured.attempt[key]) throw new Error("output_narrative_request_not_authorized");
  }
}

/** Use only original measured call amounts. Missing evidence is not a zero-dollar completion. */
export function outputNarrativePlannerCost(checkpoint: Record<string, unknown>, narrative: OutputNarrativeExecution, recordedMicrousd = 0): ProviderCostBreakdown {
  const calls = providerSubmissions(checkpoint).filter(call => call.operation === "planning" && call.status === "completed");
  if (calls.length !== 1) throw new Error("output_narrative_cost_evidence_missing");
  const call = calls[0]!;
  if (call.provider !== "openai" || call.model !== narrative.model || call.effectiveModel !== narrative.model || call.unitId !== narrative.stage || call.pricingVersion !== narrative.pricingVersion
    || ![call.costMicrousd, call.textInputCostMicrousd, call.textOutputCostMicrousd].every(value => Number.isSafeInteger(value) && Number(value) >= 0)
    || Number(call.textInputCostMicrousd) + Number(call.textOutputCostMicrousd) !== call.costMicrousd || !Number.isSafeInteger(recordedMicrousd) || recordedMicrousd < 0) throw new Error("output_narrative_cost_evidence_missing");
  const paid = Math.min(Number(call.costMicrousd), recordedMicrousd), paidInput = Math.min(Number(call.textInputCostMicrousd), paid);
  return { textInputMicrousd: Number(call.textInputCostMicrousd) - paidInput, textOutputMicrousd: Number(call.textOutputCostMicrousd) - (paid - paidInput), imageTextInputMicrousd: 0, imageInputMicrousd: 0, imageOutputMicrousd: 0, totalMicrousd: Number(call.costMicrousd) - paid };
}

/** A server checkpoint can resume saving only the exact already validated body and original call. */
export async function verifyOutputNarrativeCompletion(narrative: OutputNarrativeExecution, kind: string, body: unknown, inputReceipt: Record<string, unknown>, checkpoint: Record<string, unknown>) {
  const retained = await readOutputNarrativeExecution(inputReceipt.output_narrative);
  if (!retained || JSON.stringify(retained) !== JSON.stringify(narrative)) throw new Error("output_narrative_completion_invalid");
  const receipt = await outputNarrativeBodyReceipt(narrative, kind, body);
  for (const key of ["narrative_contract_digest", "narrative_body_sha256", "narrative_word_count", "narrative_word_count_policy"] as const) if (inputReceipt[key] !== receipt[key]) throw new Error("output_narrative_completion_invalid");
  const contract = await readOutputNarrativeExecution({ ...narrative, contract: inputReceipt.narrative_contract });
  if (!contract) throw new Error("output_narrative_completion_invalid");
  const calls = providerSubmissions(checkpoint).filter(call => call.operation === "planning" && call.status === "completed"), call = calls[0];
  if (calls.length !== 1 || !call || call.validationStatus !== "valid" || call.completionStatus !== "completed" || !call.responseRef || !call.providerRequestId || !/^[a-f0-9]{64}$/u.test(call.requestDigest ?? "")) throw new Error("output_narrative_completion_invalid");
  const originalCalls = inputReceipt.provider_calls;
  if (!Array.isArray(originalCalls) || originalCalls.length !== 1 || !originalCalls[0] || typeof originalCalls[0] !== "object") throw new Error("output_narrative_completion_invalid");
  const original = originalCalls[0] as Record<string, unknown>;
  for (const key of ["clientRequestId", "providerRequestId", "requestDigest", "responseRef", "provider", "model", "effectiveModel", "unitId", "validationStatus", "completionStatus", "costMicrousd"] as const) if (original[key] !== call[key]) throw new Error("output_narrative_completion_invalid");
  outputNarrativePlannerCost(checkpoint, narrative);
  return receipt;
}

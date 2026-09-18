import { parseShortStoryNarrativeContract } from "../src/model/output-narrative-contract.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import { outputNativeRecord as record, outputNativeUnavailable as unavailable, type OutputNativeSettings } from "./output-image-slides-preflight.ts";
import { createOutputNarrativeExecution, OUTPUT_NARRATIVE_MODEL } from "./output-narrative-request.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";

/** A fixed story contract adapts the existing manual document job, not a new generator. */
export async function preflightOutputNarrativeTarget(input: OutputBridgeTargetInput): Promise<OutputNativeTargetPreflight> {
  const { target, env } = input;
  const contract = parseShortStoryNarrativeContract(target.narrative_contract);
  if (!contract || target.media_kind !== "document" || target.quantity.kind !== "exact" || target.quantity.unit !== "document" || target.quantity.value !== 1
    || target.source_scope.kind !== "document" || target.coverage.kind !== "document_context" || target.aspect_ratio || target.content_quantity || target.count_policy || target.variant_id || target.member_id)
    return unavailable(target.id, "output_narrative_contract_unsupported", "Story contract unavailable");
  if (!target.selected || target.blocking_issues.length) return unavailable(target.id, "output_native_target_not_selected", "Target unavailable");
  if (!env.OPENAI_API_KEY || (env.OPENAI_MODEL ?? OUTPUT_NARRATIVE_MODEL) !== OUTPUT_NARRATIVE_MODEL) return unavailable(target.id, "output_narrative_provider_unavailable", "Story provider unavailable");
  const facts = Array.isArray(input.context.snapshot.facts) ? input.context.snapshot.facts.map(record) : [];
  if (!facts.some(fact => fact.active !== false && String(fact.type).toLowerCase() !== "output" && fact.intent !== "prohibit" && fact.effect !== "must_not_include")) return unavailable(target.id, "output_native_source_required", "Source required");
  const maximumInputTokens = new TextEncoder().encode(JSON.stringify(input.context.snapshot)).byteLength * 4 + 25000;
  if (maximumInputTokens > 122000) return unavailable(target.id, "output_narrative_context_limit", "Source limit exceeded");
  const outputNarrative = await createOutputNarrativeExecution(contract, OUTPUT_NARRATIVE_MODEL, maximumInputTokens);
  const maximumMicrousd = Math.max(1000000, estimateOpenAITextCallMaximumMicrousd(outputNarrative.model, maximumInputTokens, outputNarrative.maximumOutputTokens));
  const settings: OutputNativeSettings = {
    kind: "render_document",
    payload: { artifactKind: "short_story", productionMode: "manual", itemCount: 3, budgetAcknowledged: true, preflightAcknowledged: true, outputTargetInstructions: target.instruction_text, outputNarrative },
    calls: [{ stage: outputNarrative.stage, provider: "openai", model: outputNarrative.model, maximumMicrousd, maximumInputTokens, maximumOutputTokens: outputNarrative.maximumOutputTokens }],
    executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY,
  };
  return { targetId: target.id, available: true, reasonCode: "output_narrative_ready", reason: "1 story · 600–800 words · English", reasonValues: { maximumExecutionSeconds: OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds / 1000 }, transferCode: "output_transfer_narrative_after_authorization", provider: "openai", model: outputNarrative.model, route: "document-short-story-manual-v1", maximumMicrousd, maximumTokens: 128000, maximumCalls: 1, settings, transferDescription: "OpenAI · Authorized Document context · After authorization and Start" };
}

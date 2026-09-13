import { parseAudioMiniAppCostPreview } from "../src/model/audio-mini-app-consent.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { parseAudioOutputContract } from "../src/model/output-audio-contract.ts";
import { audioAuthoringConflict } from "../src/model/audio.ts";
import { documentRenderTokenReservation } from "../src/model/generation-budget.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import { selectAudioAdapter } from "./audio-selection.ts";
import { audioPreparationConstraints } from "./audio-prompt-adapter.ts";
import { resolveOutputAudioSource } from "./output-audio-source.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import type { OutputSqlAssertion } from "./output-command-core.ts";

const unavailable = (targetId: string, code: string): OutputNativeTargetPreflight => ({
  targetId, available: false, reasonCode: code, reason: "Audio preparation unavailable",
  transferCode: "output_transfer_none_authorized", transferDescription: "No source or media is sent by this check.",
  provider: null, model: null, route: null, maximumMicrousd: 0, maximumCalls: 0, maximumTokens: 0, settings: {},
});
const proofs = new WeakMap<OutputNativeTargetPreflight, readonly OutputSqlAssertion[]>();
/** Only the exact freshly checked server object carries original-source custody. */
export const outputAudioPreflightAssertions = (value: OutputNativeTargetPreflight) => proofs.get(value) ?? null;
function conjunction(assertions: readonly OutputSqlAssertion[]): OutputSqlAssertion {
  if (assertions.length === 1) return assertions[0]!;
  const middle = Math.ceil(assertions.length / 2), left = conjunction(assertions.slice(0, middle)), right = conjunction(assertions.slice(middle));
  return { sql: `(${left.sql}) AND (${right.sql})`, bindings: [...(left.bindings ?? []), ...(right.bindings ?? [])] };
}

/** This read-only quote is not execution authority. The original mini-app join
 * separately verifies explicit cost/transfer approval, source and reservation
 * custody before dispatch enforces these calls and caps against captured bytes. */
export async function preflightOutputAudioTarget(input: OutputBridgeTargetInput): Promise<OutputNativeTargetPreflight> {
  const { target, env } = input;
  if (!parseAudioOutputContract(target.audio_contract) || target.media_kind !== "audio" || !target.selected || target.blocking_issues.length
    || target.quantity.kind !== "exact" || target.quantity.unit !== "episode" || target.quantity.value !== 1
    || target.source_scope.kind !== "document" || target.coverage.kind !== "document_context"
    || target.aspect_ratio || target.content_quantity || target.count_policy || target.variant_id || target.member_id
    || Object.hasOwn(target, "scene_contract") || Object.hasOwn(target, "narrative_contract"))
    return unavailable(target.id, "output_audio_contract_unsupported");
  if (!env.OPENAI_API_KEY?.trim() || !env.FAL_KEY?.trim() || (env.OPENAI_MODEL ?? "gpt-5.6-terra") !== "gpt-5.6-terra")
    return unavailable(target.id, "output_audio_provider_unavailable");
  const source = await resolveOutputAudioSource(input);
  if (Date.parse(source.expiresAt) <= Date.now() || Date.parse(input.confirmedPlan.confirmedAt) > Date.now())
    return unavailable(target.id, "output_audio_original_expired");
  const snapshot = structuredClone(input.context.snapshot);
  const selection = selectAudioAdapter(env, EXPERIENCE_AUDIO_INTENT, { snapshot });
  if (selection.model !== "fal-ai/stable-audio-3/medium/text-to-audio"
    || canonicalJson(selection.profile) !== canonicalJson(EXPERIENCE_AUDIO_INTENT)
    || !Number.isSafeInteger(selection.estimatedCostMicrousd) || selection.estimatedCostMicrousd <= 0)
    return unavailable(target.id, "output_audio_profile_unavailable");
  const conflict = audioAuthoringConflict(snapshot, selection.profile);
  if (conflict) return unavailable(target.id, conflict.code);
  // This is the exact existing pre-planning check, not invented genre/style.
  const constraints = audioPreparationConstraints(snapshot, { profile: selection.profile, model: selection.model });
  const inputBytes = new TextEncoder().encode(canonicalJson(snapshot)).byteLength;
  if (inputBytes > 262_144) return unavailable(target.id, "output_audio_context_limit");
  // Existing timed_music planning allows one bounded repair, then one media
  // request: disclose all three, not the legacy two-planning-call label alone.
  const maximumInputTokens = inputBytes * 4 + 25_000, maximumOutputTokens = 3000;
  if (maximumInputTokens > 61_000) return unavailable(target.id, "output_audio_context_limit");
  const plannerMaximum = Math.max(500_000, estimateOpenAITextCallMaximumMicrousd("gpt-5.6-terra", maximumInputTokens, maximumOutputTokens));
  const calls = ["planning:0:initial", "planning:0:repair"].map(stage => ({
    stage, provider: "openai", model: "gpt-5.6-terra", maximumMicrousd: plannerMaximum, maximumInputTokens, maximumOutputTokens,
  }));
  const maximumMicrousd = 2 * plannerMaximum + selection.estimatedCostMicrousd;
  if (!Number.isSafeInteger(maximumMicrousd)) return unavailable(target.id, "output_audio_price_unavailable");
  const assertions: OutputSqlAssertion[] = [...source.sourceAssertions, { sql: "? > strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [source.expiresAt], deadlineMs: Date.parse(source.expiresAt) }];
  if (!assertions.length) return unavailable(target.id, "output_audio_source_unavailable");
  const guard = conjunction(assertions);
  if (!await env.DB.prepare(`SELECT 1 AS current WHERE ${guard.sql}`).bind(...(guard.bindings ?? [])).first()
    || assertions.some(value => value.deadlineMs !== undefined && Date.now() >= value.deadlineMs))
    return unavailable(target.id, "output_audio_source_changed");
  const costPreview=parseAudioMiniAppCostPreview({version:"audio-mini-app-cost-v1",requestId:source.requestId,expiresAt:source.expiresAt,draftId:source.plan.draftId,actorUserId:input.scope.actorUserId,projectId:input.scope.projectId,documentId:input.scope.documentId,sourceDigest:input.sourceDigest,requirementsDigest:input.requirementsDigest,maximumMicrousd,maximumCalls:3,maximumTokens:128000,planningModel:"gpt-5.6-terra",maximumPlanningCalls:2,maximumOutputTokens:3000,audioModel:selection.model,maximumAudioCalls:1,durationSeconds:20,requireInstrumental:true,sourceFilesTransferred:0});
  if(!costPreview)return unavailable(target.id,"output_audio_quote_unavailable");
  const preflight: OutputNativeTargetPreflight = freeze({
    targetId: target.id, available: true, reasonCode: "output_audio_ready_for_separate_approval",
    reason: "1 instrumental track · 20-second target, not measured duration · review cost and transfer before Start",
    transferCode: "output_transfer_audio_not_yet_authorized",
    transferDescription: "This check sends nothing. A future separately authorized Start would send the current Document text to OpenAI for one planning call and at most one repair, then the adapted musical direction to fal.ai / Stable Audio 3 for one 20-second instrumental request. No reference file, recording, lyrics or spoken script is authorized. No automatic command retry. Prices are published-rate estimates, not provider billing evidence.",
    provider: selection.provider, model: selection.model, route: "document-audio-timed-music-manual-v1",
    maximumMicrousd, maximumCalls: 3, maximumTokens: documentRenderTokenReservation("audio", 1, 2),
    settings: {
      kind: "render_document",
      payload: { productionMode: "manual", artifactKind: "audio", itemCount: 1, audioProfile: selection.profile,
        audioProviderModel: selection.model, audioEstimatedCostMicrousd: selection.estimatedCostMicrousd,
        outputTargetInstructions: target.instruction_text, outputAudio: target.audio_contract },
      calls: [...calls, { stage: "audio:initial", provider: "fal", model: selection.model, maximumMicrousd: selection.estimatedCostMicrousd }],
      preparationOnly: false, explicitCostAndTransferApprovalRequired: true, executionAvailable: true, costPreview,
      executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY,
      original: { requestId: source.requestId, expiresAt: source.expiresAt, draftId: source.plan.draftId,
        actorUserId: input.scope.actorUserId, projectId: input.scope.projectId, documentId: input.scope.documentId,
        sourceDigest: input.sourceDigest, requirementsDigest: input.requirementsDigest },
      constraints, duration: { requestedSeconds: 20, measuredSeconds: null },
    },
  });
  proofs.set(preflight, freeze(assertions.map(value => ({ ...value, bindings: [...(value.bindings ?? [])] }))));
  return preflight;
}

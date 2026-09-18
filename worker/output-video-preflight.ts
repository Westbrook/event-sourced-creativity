import { readVideoExecutionOffer, VIDEO_READY_REASON, VIDEO_TRANSFER } from "../src/model/output-video-offer.ts";
import { canonicalJson, freeze } from "../src/experiences/compiler.ts";
import { parseVideoOutputContract } from "../src/model/output-video-contract.ts";
import { standingConstraints } from "../src/model/taste.ts";
import { documentRenderTokenReservation } from "../src/model/generation-budget.ts";
import { OUTPUT_VIDEO_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { prepareVideoPlannerRequest } from "./openai-adapter.ts";
import { outputVideoMediaPrice } from "./output-video-execution.ts";
import { VIDEO_PLANNER_MODEL } from "./output-video-planner.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import { resolveOutputVideoSource } from "./output-video-source.ts";
import { outputProofReadStatements, assertOutputProofRead } from "./output-disclosure-proof.ts";
import type { OutputBridgeTargetInput } from "./output-requirements-api.ts";
import type { OutputNativeTargetPreflight } from "../src/model/output-delivery-contract.ts";
import { OutputConflictError, type OutputSqlAssertion } from "./output-command-core.ts";
import { outputSourceEpochAssertion } from "./output-requirements-ledger.ts";

const same = (left: unknown, right: unknown) => left !== undefined && canonicalJson(left) === canonicalJson(right);
const unavailable = (targetId: string, reasonCode: string): OutputNativeTargetPreflight => ({ targetId, available: false, reasonCode,
  reason: "Video unavailable", transferCode: "output_transfer_none_authorized", transferDescription: "No transfer",
  provider: null, model: null, route: null, maximumMicrousd: 0, maximumCalls: 0, maximumTokens: 0, settings: {} });
const proofs = new WeakMap<OutputNativeTargetPreflight, Readonly<{ sourceAssertions: readonly OutputSqlAssertion[]; requestId: string; expiresAt: string }>>();
export const outputVideoPreflightProof = (value: OutputNativeTargetPreflight) => proofs.get(value) ?? null;

/** Match manual events-api assembly without inventing authored source. */
export function videoPlanningSnapshot(input: OutputBridgeTargetInput) {
  const authored = standingConstraints([...(input.sourceEvents ?? [])]).map(item => ({ preference_id: item.preferenceId, axis: item.axis,
    value: item.value, polarity: item.polarity, authority: "authored", source_event_refs: item.evidenceRefs, source_claim_ref: item.sourceClaimRef ?? null }));
  const snapshot: Record<string, unknown> = input.context.snapshot;
  const supplied = Array.isArray(snapshot.standing_constraints) ? snapshot.standing_constraints
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
  const constraints = [...new Map([...supplied, ...authored].map(value => [String(value.preference_id ?? `${value.polarity}:${value.axis}:${value.value}`), value])).values()];
  return { ...structuredClone(input.context.snapshot), document: { id: input.scope.documentId, title: input.context.projection.documentTitle },
    ...(constraints.length ? { standing_constraints: constraints } : {}) };
}
/** Read-only exact quote. No grant, slot, private checkpoint or provider transfer.
 * Public activation remains separately fenced until all connected paths pass. */
export async function preflightOutputVideoTarget(input: OutputBridgeTargetInput): Promise<OutputNativeTargetPreflight> {
  const { target, env } = input, contract = parseVideoOutputContract(target.video_contract);
  if (!contract || target.media_kind !== "video" || !target.selected || target.blocking_issues.length
    || !same(target.quantity, { kind: "exact", unit: "video", value: 1 })
    || !same(target.content_quantity, { kind: "exact", unit: "second", value: 4 })
    || !same(target.count_policy, { kind: "exact", unit: "second", value: 4 })
    || target.source_scope.kind !== "document" || target.coverage.kind !== "document_context" || target.aspect_ratio || target.variant_id || target.member_id
    || ["audio_contract", "narrative_contract", "scene_contract", "storyboard_contract", "model3d_contract"].some(key => Object.hasOwn(target, key)))
    return unavailable(target.id, "output_video_contract_unsupported");
  if (!env.OPENAI_API_KEY?.trim() || !env.FAL_KEY?.trim() || (env.OPENAI_MODEL ?? VIDEO_PLANNER_MODEL) !== VIDEO_PLANNER_MODEL || (env.FORMA_VIDEO_PROVIDER ?? "fal") !== "fal")
    return unavailable(target.id, "output_video_provider_unavailable");
  const source = await resolveOutputVideoSource(input), media = outputVideoMediaPrice();
  const snapshot = videoPlanningSnapshot(input);
  const prepared = await prepareVideoPlannerRequest(env, input.principal.userId, { documentTitle: input.context.projection.documentTitle, snapshot,
    options: { itemCount: 1, productionMode: "manual", videoSeconds: 4, videoSize: contract.frameSize, videoAudioMode: "silent", outputTargetInstructions: target.instruction_text } }, contract);
  const plannerMaximum = estimateOpenAITextCallMaximumMicrousd(VIDEO_PLANNER_MODEL, prepared.maximumInputTokens, prepared.maximumOutputTokens);
  const maximumMicrousd = plannerMaximum + media.maximumMicrousd;
  if (![plannerMaximum, maximumMicrousd].every(value => Number.isSafeInteger(value) && value > 0)) return unavailable(target.id, "output_video_price_unavailable");
  const sourceAssertions: OutputSqlAssertion[] = [...source.sourceAssertions, {
    sql: "?>strftime('%Y-%m-%dT%H:%M:%fZ','now')", bindings: [source.expiresAt], deadlineMs: Date.parse(source.expiresAt),
  }];
  // The original-image proof and draft custody can exceed D1's per-statement
  // binding limit when flattened. Reuse the existing bounded read-only batch.
  const checks = await env.DB.batch<Record<string, unknown>>(outputProofReadStatements(env, sourceAssertions));
  try { assertOutputProofRead(checks, sourceAssertions.length); }
  catch (error) { if (error instanceof OutputConflictError && error.code === "output_source_changed_during_read") return unavailable(target.id, "output_video_source_changed"); throw error; }
  if (sourceAssertions.some(assertion => assertion.deadlineMs !== undefined && Date.now() >= assertion.deadlineMs)) return unavailable(target.id, "output_video_source_changed");
  const preflight: OutputNativeTargetPreflight = freeze({ targetId: target.id, available: true, reasonCode: "output_video_ready",
    reason: VIDEO_READY_REASON, transferCode: "output_transfer_video_after_authorization",
    transferDescription: VIDEO_TRANSFER,
    provider: "fal", model: media.model, route: "document-video-owned-still-four-seconds-manual-v1", maximumMicrousd, maximumCalls: 2,
    maximumTokens: documentRenderTokenReservation("video", 1, 1), settings: { kind: "render_document",
      payload: { artifactKind: "video", productionMode: "manual", itemCount: 1, outputVideo: contract,
        outputVideoPlanner: { contract, requestDigest: prepared.requestDigest, maximumInputTokens: prepared.maximumInputTokens },
        videoSeconds: 4, videoSize: contract.frameSize, videoResolution: "480p", videoAudioMode: "silent", outputTargetInstructions: target.instruction_text,
        paidMediaConfirmed: true, budgetAcknowledged: true, preflightAcknowledged: true },
      calls: [{ stage: "planning:0:initial", provider: "openai", model: VIDEO_PLANNER_MODEL, maximumMicrousd: plannerMaximum,
        maximumInputTokens: prepared.maximumInputTokens, maximumOutputTokens: 3000 },
      { stage: "video:initial", provider: "fal", model: media.model, maximumMicrousd: media.maximumMicrousd, maximumInputTokens: 0, maximumOutputTokens: 0 }],
      videoPricingVersion: media.pricingVersion, executionPolicy: OUTPUT_VIDEO_EXECUTION_POLICY, preparationOnly: false,
      executionAvailable: true, explicitCostAndTransferApprovalRequired: true,
      original: { requestId: source.requestId, expiresAt: source.expiresAt, draftId: source.plan.draftId, actorUserId: input.scope.actorUserId,
        projectId: input.scope.projectId, documentId: input.scope.documentId, sourceDigest: input.sourceDigest, requirementsDigest: input.requirementsDigest },
    } });
  if (!readVideoExecutionOffer(preflight)) return unavailable(target.id, "output_video_offer_invalid");
  proofs.set(preflight, freeze({ sourceAssertions, requestId: source.requestId, expiresAt: source.expiresAt }));
  return preflight;
}

/** A parsed or copied offer is never source authority. Every consequential
 * caller supplies a freshly resolved quote and its in-process original proof. */
export function requireOutputVideoOriginal(input: OutputBridgeTargetInput, current: OutputNativeTargetPreflight,
  attempt: { attemptOrdinal: number; previousSlotId: string | null; jobId?: string }) {
  const offer = readVideoExecutionOffer(current), proof = outputVideoPreflightProof(current);
  if (!offer || !proof?.sourceAssertions.length || input.scope.kind !== "personal" || input.scope.contextId
    || input.principal.userId !== input.scope.actorUserId || input.scope.actorUserId !== input.scope.ownerUserId
    || current.targetId !== input.target.id || !same(offer.contract, input.target.video_contract)
    || attempt.attemptOrdinal !== 0 || attempt.previousSlotId !== null
    || attempt.jobId !== undefined && attempt.jobId !== proof.requestId
    || offer.original.actorUserId !== input.scope.actorUserId || offer.original.projectId !== input.scope.projectId
    || offer.original.documentId !== input.scope.documentId || offer.original.sourceDigest !== input.sourceDigest
    || offer.original.requirementsDigest !== input.requirementsDigest || offer.original.requestId !== proof.requestId
    || offer.original.expiresAt !== proof.expiresAt || !Number.isFinite(Date.parse(proof.expiresAt))
    || Date.parse(proof.expiresAt) <= Date.now()) throw new OutputConflictError("output_video_original_attempt_required", 403);
  return { offer, proof };
}

/** Keep original still/private/rights/deadline guards live while permitting
 * only the existing ledger's narrowly scoped nonsemantic execution events. */
export function outputVideoExecutionSourceAssertions(input: OutputBridgeTargetInput, current: OutputNativeTargetPreflight,
  attempt: { attemptOrdinal: number; previousSlotId: string | null; jobId: string }) {
  const { proof } = requireOutputVideoOriginal(input, current, attempt);
  if (!Number.isSafeInteger(input.ownerHead) || Number(input.ownerHead) < 0) throw new OutputConflictError("output_source_epoch_required", 403);
  const epoch = { head: input.ownerHead!, sourceDigest: input.sourceDigest };
  let replaced = 0;
  const assertions = proof.sourceAssertions.map(assertion => {
    if (assertion.sql !== "COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?") return assertion;
    if (assertion.bindings?.length !== 2 || assertion.bindings[0] !== `creative:${input.scope.ownerUserId}` || assertion.bindings[1] !== epoch.head)
      throw new OutputConflictError("output_source_epoch_required", 403);
    replaced++;
    return outputSourceEpochAssertion(input.scope, epoch);
  });
  if (replaced !== 1) throw new OutputConflictError("output_source_epoch_required", 403);
  return assertions;
}

import { canonicalJson, freeze, jsonIssues } from "../experiences/compiler.ts";
import { parseVideoOutputContract } from "./output-video-contract.ts";
import { VIDEO_ADAPTER_CONTRACT } from "./video-adapter.ts";
import { documentRenderTokenReservation } from "./generation-budget.ts";
import { OUTPUT_VIDEO_EXECUTION_POLICY } from "./output-execution-policy.ts";
export const VIDEO_READY_REASON = "1 video · 4 s · 480p · Silent";
export const VIDEO_TRANSFER = "Document text → OpenAI · Selected image and direction → fal.ai · 1 planning call · 1 video call · No automatic retry";
const row = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const same = (a: unknown, b: unknown) => a !== undefined && canonicalJson(a) === canonicalJson(b);
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(v);
/** Closed original offer; its contents grant no permission or source custody. */
export function readVideoExecutionOffer(value: unknown) {
  try {
    if (jsonIssues(value).length) return null;
    const offer: unknown = freeze(structuredClone(value));
    if (!row(offer) || !exact(offer, ["targetId", "available", "reasonCode", "reason", "transferCode", "transferDescription", "provider", "model", "route", "maximumMicrousd", "maximumCalls", "maximumTokens", "settings"])
      || !id(offer.targetId) || offer.available !== true || offer.reasonCode !== "output_video_ready" || offer.reason !== VIDEO_READY_REASON
      || offer.transferCode !== "output_transfer_video_after_authorization" || offer.transferDescription !== VIDEO_TRANSFER || offer.provider !== "fal"
      || offer.model !== VIDEO_ADAPTER_CONTRACT.model || offer.route !== "document-video-owned-still-four-seconds-manual-v1"
      || offer.maximumCalls !== 2 || offer.maximumTokens !== documentRenderTokenReservation("video", 1, 1) || !positive(offer.maximumMicrousd)) return null;
    const settings = offer.settings;
    if (!row(settings) || !exact(settings, ["kind", "payload", "calls", "videoPricingVersion", "executionPolicy", "preparationOnly", "executionAvailable", "explicitCostAndTransferApprovalRequired", "original"])
      || settings.kind !== "render_document" || settings.preparationOnly !== false || settings.executionAvailable !== true || settings.explicitCostAndTransferApprovalRequired !== true
      || !same(settings.executionPolicy, OUTPUT_VIDEO_EXECUTION_POLICY)
      || settings.videoPricingVersion !== `forma.video.fal-480p-transport@1:${VIDEO_ADAPTER_CONTRACT.adapterVersion}:${VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd["480p"]}`) return null;
    const payload = settings.payload, original = settings.original;
    if (!row(payload) || !exact(payload, ["artifactKind", "productionMode", "itemCount", "outputVideo", "outputVideoPlanner", "videoSeconds", "videoSize", "videoResolution", "videoAudioMode", "outputTargetInstructions", "paidMediaConfirmed", "budgetAcknowledged", "preflightAcknowledged"])
      || payload.artifactKind !== "video" || payload.productionMode !== "manual" || payload.itemCount !== 1 || payload.videoSeconds !== 4
      || payload.videoResolution !== "480p" || payload.videoAudioMode !== "silent" || payload.paidMediaConfirmed !== true || payload.budgetAcknowledged !== true || payload.preflightAcknowledged !== true
      || typeof payload.outputTargetInstructions !== "string" || !payload.outputTargetInstructions.trim() || payload.outputTargetInstructions.length > 4096) return null;
    const contract = parseVideoOutputContract(payload.outputVideo), planner = payload.outputVideoPlanner;
    if (!contract || payload.videoSize !== contract.frameSize || !row(planner) || !exact(planner, ["contract", "requestDigest", "maximumInputTokens"])
      || !same(planner.contract, contract) || typeof planner.requestDigest !== "string" || !/^[a-f0-9]{64}$/u.test(planner.requestDigest)
      || !positive(planner.maximumInputTokens) || planner.maximumInputTokens < 4096 || planner.maximumInputTokens > 61000) return null;
    if (!row(original) || !exact(original, ["requestId", "expiresAt", "draftId", "actorUserId", "projectId", "documentId", "sourceDigest", "requirementsDigest"])
      || typeof original.requestId !== "string" || !/^video-[a-f0-9]{64}$/u.test(original.requestId) || original.draftId !== contract.source.draftId
      || !["actorUserId", "projectId", "documentId"].every(key => id(original[key]))
      || !["sourceDigest", "requirementsDigest"].every(key => typeof original[key] === "string" && /^[a-f0-9]{64}$/u.test(original[key] as string))
      || typeof original.expiresAt !== "string" || !Number.isFinite(Date.parse(original.expiresAt)) || new Date(Date.parse(original.expiresAt)).toISOString() !== original.expiresAt) return null;
    const calls = settings.calls;
    if (!Array.isArray(calls) || calls.length !== 2) return null;
    let total = 0;
    for (const [index, call] of calls.entries()) {
      if (!row(call) || !exact(call, ["stage", "provider", "model", "maximumMicrousd", "maximumInputTokens", "maximumOutputTokens"])
        || call.stage !== (index === 0 ? "planning:0:initial" : "video:initial") || call.provider !== (index === 0 ? "openai" : "fal")
        || call.model !== (index === 0 ? "gpt-5.6-terra" : VIDEO_ADAPTER_CONTRACT.model) || !positive(call.maximumMicrousd)
        || call.maximumInputTokens !== (index === 0 ? planner.maximumInputTokens : 0) || call.maximumOutputTokens !== (index === 0 ? 3000 : 0)
        || index === 1 && call.maximumMicrousd !== 4 * VIDEO_ADAPTER_CONTRACT.publishedCostPerSecondMicrousd["480p"]) return null;
      total += call.maximumMicrousd;
    }
    if (!Number.isSafeInteger(total) || total !== offer.maximumMicrousd) return null;
    return Object.freeze({ offer, settings, payload, contract, planner, original, calls, maximumMicrousd: total });
  } catch { return null; }
}

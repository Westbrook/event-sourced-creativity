import { canonicalJson, digest } from "../src/experiences/compiler.ts";
import { validateIntakeRequest } from "../src/experiences/intake.ts";
import { parseSceneOutputContract } from "../src/model/output-scene-contract.ts";
import { parseSceneMiniAppCostPreview, sceneMiniAppCostApprovalMatches } from "../src/model/scene-mini-app-consent.ts";
import { readOutputSceneRequestContract } from "./output-scene-request.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";
import type { PreparedSceneCost } from "./scene-cost-consent.ts";

/** Reuse the current server Scene source/rights/budget proof, not its legacy
 * two-call approval. Only a server caller resolving the original intake may
 * pass this proof; no HTTP route accepts a serialized PreparedSceneCost. */
export async function createSceneMiniAppCostPreview(sourceProof: PreparedSceneCost, rawSceneContract: unknown, rawIntake: unknown,
  rawExecutionContract: unknown, expiresAt: string, now = Date.now()) {
  const contract = parseSceneOutputContract(rawSceneContract), legacy = sourceProof.preview;
  const deadline = Date.parse(expiresAt), sourceDeadline = Date.parse(sourceProof.validUntil);
  if (!contract || !Number.isFinite(now) || !Number.isFinite(deadline) || !Number.isFinite(sourceDeadline)
    || deadline <= now || deadline > now + 15 * 60_000 || deadline > sourceDeadline || new Date(deadline).toISOString() !== expiresAt
    || legacy.version !== "scene-cost-v1" || legacy.sceneMedium !== "visual" || legacy.productionMode !== "manual" || legacy.itemCount !== 1
    || legacy.reusedSourceCount !== 0 || legacy.providerCallCount !== 1 || legacy.maximumProviderCallCount !== 2 || legacy.maximumMicrousd !== 1_000_000
    || legacy.provider !== "openai" || legacy.model !== "gpt-5.6-terra" || legacy.contextSessionId !== null || sourceProof.scope || sourceProof.production
    || sourceProof.binding.actorUserId !== legacy.actorUserId || sourceProof.binding.projectId !== legacy.projectId
    || sourceProof.binding.documentId !== legacy.documentId || sourceProof.binding.permissionEpoch !== legacy.permissionEpoch
    || sourceProof.binding.sourceHash !== legacy.sourceHash || sourceProof.binding.intentHash !== legacy.requestHash
    || sourceProof.binding.period !== legacy.period || legacy.period !== new Date(now).toISOString().slice(0, 7)) return null;
  // Snapshot the source-proof descriptor before request validation/hashing yields.
  const original = { ...legacy };
  const [intake, execution] = await Promise.all([validateIntakeRequest(rawIntake), readOutputSceneRequestContract(rawIntake, rawExecutionContract)]);
  if (!intake || intake.request.experienceId !== "scene" || !execution || execution.model !== original.model) return null;
  const [sceneContractDigest, executionContractDigest, requestDigest] = await Promise.all([digest(contract), digest(execution), digest(intake.request)]);
  if (contract.source.requestHash !== requestDigest || contract.source.releaseHash !== intake.request.releaseHash
    || execution.sourceRequestDigest !== requestDigest
    || estimateOpenAITextCallMaximumMicrousd(execution.model, execution.maximumInputTokens, execution.maximumOutputTokens) > 1_000_000) return null;
  const requestHash = (await digest(["scene-mini-app-cost-v1", original.requestHash, sceneContractDigest, executionContractDigest])).slice(7);
  const bindingHash = (await digest(["scene-mini-app-cost-v1", original.bindingHash, requestHash, expiresAt, 1_000_000, 1, 128000])).slice(7);
  return parseSceneMiniAppCostPreview({ ...original, version: "scene-mini-app-cost-v1", maximumProviderCallCount: 1,
    maximumInputTokens: execution.maximumInputTokens, maximumOutputTokens: 3000, maximumTokens: 128000,
    sceneContractDigest, executionContractDigest, expiresAt, requestHash, bindingHash });
}

/** Use the ORIGINAL stored preflight expiry when rebuilding refreshed. Never
 * adopt a caller's later expiry or mint confirmed:true to satisfy legacy code. */
export function requireSceneMiniAppCostApproval(approval: unknown, retainedPreview: unknown, refreshedPreview: unknown, now = Date.now()): void {
  const original = parseSceneMiniAppCostPreview(retainedPreview), current = parseSceneMiniAppCostPreview(refreshedPreview);
  if (!original || !current || canonicalJson(original) !== canonicalJson(current) || !sceneMiniAppCostApprovalMatches(approval, original, now))
    throw new Error("scene_mini_app_confirmation_required");
}

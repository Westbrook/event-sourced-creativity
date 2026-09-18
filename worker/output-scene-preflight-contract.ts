import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import { validateIntakeRequest } from "../src/experiences/intake.ts";
import { parseSceneOutputContract } from "../src/model/output-scene-contract.ts";
import { parseSceneMiniAppCostPreview } from "../src/model/scene-mini-app-consent.ts";
import { OUTPUT_NATIVE_EXECUTION_POLICY } from "../src/model/output-execution-policy.ts";
import { readOutputSceneRequestContract } from "./output-scene-request.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "./openai-text-cost.ts";

/** Immutable settings grammar shared by preflight/admission/execution. Valid
 * configuration is not source/consent/grant authority. The caller must resolve
 * original private intake/current context before offering this native route. */
export async function readOutputScenePayload(raw: unknown) {
  const fields = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key]);
  };
  const keys = ["artifactKind", "productionMode", "sceneMedium", "itemCount", "budgetAcknowledged", "preflightAcknowledged", "outputTargetInstructions", "sceneRequestId", "outputScene"];
  if (!fields(raw, keys) || raw.artifactKind !== "scene" || raw.productionMode !== "manual" || raw.sceneMedium !== "visual"
    || raw.itemCount !== 1 || raw.budgetAcknowledged !== true || raw.preflightAcknowledged !== true
    || typeof raw.outputTargetInstructions !== "string" || raw.outputTargetInstructions.length > 65536
    || typeof raw.sceneRequestId !== "string" || !fields(raw.outputScene, ["intake", "contract", "sceneContract", "costPreview"])) return null;
  const option = raw.outputScene, sceneContract = parseSceneOutputContract(option.sceneContract), costPreview = parseSceneMiniAppCostPreview(option.costPreview);
  const sceneRequestId = raw.sceneRequestId, instructions = raw.outputTargetInstructions;
  if (!sceneContract || !costPreview || sceneRequestId !== costPreview.requestId) return null;
  // Each helper snapshots before awaiting, preserving one caller revision.
  const [intake, contract] = await Promise.all([validateIntakeRequest(option.intake), readOutputSceneRequestContract(option.intake, option.contract)]);
  if (!intake || intake.request.experienceId !== "scene" || !contract) return null;
  const input = JSON.parse(contract.input), requirement = instructions ? { instructions, source_evidence: false } : undefined;
  if (canonicalJson(input.output_requirements ?? null) !== canonicalJson(requirement ?? null)) return null;
  const [sceneDigest, requestDigest, intakeDigest] = await Promise.all([digest(sceneContract), digest(contract), digest(intake.request)]);
  if (sceneContract.source.requestHash !== intakeDigest || sceneContract.source.releaseHash !== intake.request.releaseHash
    || contract.sourceRequestDigest !== intakeDigest || costPreview.sceneContractDigest !== sceneDigest || costPreview.executionContractDigest !== requestDigest
    || costPreview.maximumInputTokens !== contract.maximumInputTokens || costPreview.maximumOutputTokens !== contract.maximumOutputTokens
    || costPreview.model !== contract.model || contract.maximumCalls !== 1
    || estimateOpenAITextCallMaximumMicrousd(contract.model, contract.maximumInputTokens, contract.maximumOutputTokens) > costPreview.maximumMicrousd) return null;
  return freeze({ artifactKind: "scene" as const, productionMode: "manual" as const, sceneMedium: "visual" as const, itemCount: 1 as const,
    budgetAcknowledged: true as const, preflightAcknowledged: true as const, outputTargetInstructions: instructions, sceneRequestId,
    outputScene: { intake: intake.request, contract, sceneContract, costPreview } });
}

/** Construct only the disclosed route/settings after caller-owned authority
 * checks. No registration, provider invocation, stored preflight or grant here. */
export async function outputScenePreflightConfiguration(targetId: string, rawPayload: unknown, now = Date.now()) {
  if (typeof targetId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(targetId) || !Number.isFinite(now)) return null;
  const payload = await readOutputScenePayload(rawPayload);
  if (!payload || Date.parse(payload.outputScene.costPreview.expiresAt) <= now) return null;
  const { contract, costPreview } = payload.outputScene;
  return freeze({ targetId, available: true, reasonCode: "output_scene_ready", reason: "1 scene · 2 characters · 1 location · 1–2 pages",
    reasonValues: { maximumExecutionSeconds: OUTPUT_NATIVE_EXECUTION_POLICY.maximumMilliseconds / 1000 },
    transferCode: "output_transfer_scene_after_authorization", provider: "openai", model: contract.model,
    route: "document-scene-screenplay-manual-v1", maximumMicrousd: costPreview.maximumMicrousd,
    maximumTokens: costPreview.maximumTokens, maximumCalls: 1,
    settings: { kind: "render_document", payload,
      calls: [{ stage: contract.stage, provider: "openai", model: contract.model, maximumMicrousd: costPreview.maximumMicrousd,
        maximumInputTokens: contract.maximumInputTokens, maximumOutputTokens: contract.maximumOutputTokens }], executionPolicy: OUTPUT_NATIVE_EXECUTION_POLICY },
    transferDescription: "OpenAI · Authorized Document context · After authorization and Start" });
}

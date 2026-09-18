import { canonicalJson } from "../src/experiences/compiler.ts";
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { captureOutputSceneRequest } from "./output-scene-request.ts";
import type { ProviderAttemptPreflight } from "./openai-adapter.ts";
import type { OutputNativeSettings } from "./output-image-slides-preflight.ts";

/** Compare the actual wire request to the original admitted one-call route.
 * The caller still owns current source, grant, slot, lease and budget checks. */
export async function assertOutputSceneAttempt(settings: OutputNativeSettings, attempt: ProviderAttemptPreflight): Promise<void> {
  const payload = await readOutputScenePayload(settings.payload), provided = attempt.scene, route = settings.calls[0];
  if (!payload || !provided || settings.kind !== "render_document" || settings.calls.length !== 1 || !route
    || canonicalJson(provided.contract) !== canonicalJson(payload.outputScene.contract)
    || canonicalJson(provided.intake) !== canonicalJson(payload.outputScene.intake)
    || typeof provided.requestBody !== "string") throw new Error("output_scene_request_not_authorized");
  const { contract } = payload.outputScene;
  if (route.stage !== contract.stage || route.provider !== "openai" || route.model !== contract.model
    || route.maximumMicrousd !== payload.outputScene.costPreview.maximumMicrousd
    || route.maximumInputTokens !== contract.maximumInputTokens || route.maximumOutputTokens !== contract.maximumOutputTokens)
    throw new Error("output_scene_request_not_authorized");
  const body: unknown = JSON.parse(provided.requestBody);
  const safetyIdentifier = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).safety_identifier : null;
  if (typeof safetyIdentifier !== "string") throw new Error("output_scene_request_not_authorized");
  const captured = await captureOutputSceneRequest({ contract, intake: payload.outputScene.intake, body: provided.requestBody,
    clientRequestId: attempt.clientRequestId, safetyIdentifier });
  for (const key of ["model", "logicalCallKey", "requestDigest", "maximumInputTokens", "maximumOutputTokens", "reasoningEffort", "pricingVersion", "cachePolicy"] as const)
    if (attempt[key] !== captured.attempt[key]) throw new Error("output_scene_request_not_authorized");
}

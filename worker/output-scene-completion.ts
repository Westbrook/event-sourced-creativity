import { canonicalJson, digest } from "../src/experiences/compiler.ts";
import { providerSubmissions } from "../src/model/provider-submission.ts";
import { projectExperienceSceneAdapterResponse } from "./experience-scene-adapter-contract.ts";
import { inspectOutputSceneResponse } from "./output-scene-request.ts";
import { readOutputScenePayload } from "./output-scene-preflight-contract.ts";
import { measureOutputSceneLayout } from "./output-scene-layout.ts";
import type { ProviderCostBreakdown } from "./replay-cost.ts";
import { parseSceneScreenplay } from "../src/model/scene-screenplay.ts";
import type { DocumentArtifactDraft } from "../src/model/document-artifacts.ts";

type Payload = NonNullable<Awaited<ReturnType<typeof readOutputScenePayload>>>;
export async function sceneContentSha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, "0")).join("");
}
const fail = (): never => { throw new Error("output_scene_completion_invalid"); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Cache parsing preserves the structured screenplay. Completion below still
 * requires exact equality to the original retained provider projection. */
export function readOutputSceneArtifact(raw: unknown): (DocumentArtifactDraft & { scene_screenplay: NonNullable<ReturnType<typeof parseSceneScreenplay>> }) | null {
  const value = object(raw), screenplay = parseSceneScreenplay(value.scene_screenplay);
  if (!screenplay || Object.keys(value).sort().join(",") !== "content_markdown,items,presentation,scene_screenplay,summary,title"
    || typeof value.title !== "string" || typeof value.summary !== "string" || typeof value.content_markdown !== "string"
    || value.presentation !== null || !Array.isArray(value.items) || value.items.length !== 1) return null;
  const expectedItem = { title: value.title, body: value.content_markdown, notes: "", image_prompt: "", context_group_ids: [], slide: null };
  if (canonicalJson(value.items[0]) !== canonicalJson(expectedItem)) return null;
  return { title: value.title, summary: value.summary, content_markdown: value.content_markdown, presentation: null,
    items: [expectedItem], scene_screenplay: screenplay };
}

/** Measured original call only. An unreadable/uncertain bill stays reserved. */
export function outputScenePlannerCost(checkpoint: Record<string, unknown>, payload: Payload, recordedMicrousd = 0): ProviderCostBreakdown {
  const calls = providerSubmissions(checkpoint).filter(call => call.operation === "planning"), call = calls[0], { contract } = payload.outputScene;
  if (calls.length !== 1 || !call || call.status !== "completed" || call.provider !== "openai" || call.model !== contract.model
    || call.effectiveModel !== contract.model || call.unitId !== contract.stage || call.pricingVersion !== contract.pricingVersion
    || ![call.costMicrousd, call.textInputCostMicrousd, call.textOutputCostMicrousd].every(value => Number.isSafeInteger(value) && Number(value) >= 0)
    || Number(call.textInputCostMicrousd) + Number(call.textOutputCostMicrousd) !== call.costMicrousd
    || !Number.isSafeInteger(recordedMicrousd) || recordedMicrousd < 0) throw new Error("output_scene_cost_evidence_missing");
  const paid = Math.min(Number(call.costMicrousd), recordedMicrousd), paidInput = Math.min(Number(call.textInputCostMicrousd), paid);
  return { textInputMicrousd: Number(call.textInputCostMicrousd) - paidInput,
    textOutputMicrousd: Number(call.textOutputCostMicrousd) - (paid - paidInput), imageTextInputMicrousd: 0, imageInputMicrousd: 0, imageOutputMicrousd: 0,
    totalMicrousd: Number(call.costMicrousd) - paid };
}

/** The caller must load this exact private envelope by the original call's
 * responseRef under current job/source custody. Supplied bytes alone are not
 * authority. Recompute content, usage and layout; never trust checkpoint flags. */
export async function verifyOutputSceneCompletion(payload: Payload, artifact: unknown, inputReceipt: Record<string, unknown>,
  checkpoint: Record<string, unknown>, retainedEnvelope: string, originalReference: Record<string, string>, fontBytes: ArrayBuffer) {
  const { contract, intake, sceneContract, costPreview } = payload.outputScene;
  let envelope: Record<string, unknown>;
  try { envelope = object(JSON.parse(retainedEnvelope)); } catch { return fail(); }
  if (envelope.version !== "output-scene-envelope-v1" || canonicalJson(envelope.outputExecution) !== canonicalJson(originalReference)
    || envelope.jobId !== costPreview.requestId || envelope.documentId !== costPreview.documentId || envelope.actorUserId !== costPreview.actorUserId
    || envelope.sceneCostBindingHash !== costPreview.bindingHash || typeof envelope.rawEnvelope !== "string" || envelope.httpStatus !== 200) return fail();
  const request = object(envelope.request), pending = object(envelope.call);
  if (canonicalJson(request.contract) !== canonicalJson(contract) || canonicalJson(request.intake) !== canonicalJson(intake)
    || typeof request.requestBody !== "string" || typeof pending.clientRequestId !== "string") return fail();
  let safetyIdentifier: unknown;
  try { safetyIdentifier = object(JSON.parse(request.requestBody)).safety_identifier; } catch { return fail(); }
  if (typeof safetyIdentifier !== "string") return fail();
  const response = await inspectOutputSceneResponse({ contract, intake, body: request.requestBody, clientRequestId: pending.clientRequestId, safetyIdentifier }, envelope.rawEnvelope);
  if (response.problem || !response.candidateRaw || !response.cost || !response.usage) return fail();
  const projected = await projectExperienceSceneAdapterResponse(intake, contract.adapterRequestDigest, response.candidateRaw);
  if (!projected || canonicalJson(artifact) !== canonicalJson({ ...projected.artifact, scene_screenplay: projected.screenplay })) return fail();
  const calls = providerSubmissions(checkpoint).filter(call => call.operation === "planning"), call = calls[0];
  if (calls.length !== 1 || !call || call.clientRequestId !== pending.clientRequestId || call.status !== "completed"
    || call.validationStatus !== "valid" || call.completionStatus !== "completed" || !call.responseRef
    || call.providerRequestId !== response.responseId || call.requestDigest !== pending.requestDigest
    || call.costMicrousd !== response.cost.totalMicrousd || call.inputTokens !== response.usage.inputTokens
    || call.outputTokens !== response.usage.outputTokens || call.totalTokens !== response.usage.totalTokens) return fail();
  outputScenePlannerCost(checkpoint, payload);
  const receiptCalls = inputReceipt.provider_calls;
  if (!Array.isArray(receiptCalls) || receiptCalls.length !== 1 || canonicalJson(JSON.parse(JSON.stringify(receiptCalls[0]))) !== canonicalJson(JSON.parse(JSON.stringify(call)))
    || canonicalJson(inputReceipt.output_scene) !== canonicalJson(contract)) return fail();
  const source = JSON.parse(contract.input).scene_intent;
  const displaySource = { characters: source.characters.map((character: { id: string; name: { value: string } }) => ({ id: character.id, name: character.name.value })), location: source.location.value };
  const hashes = { scene_adapter_specification_digest: contract.adapterRequestDigest, scene_source_request_digest: contract.sourceRequestDigest,
    scene_compiled_input_sha256: contract.compiledInputSha256, scene_request_sha256: await sceneContentSha256(request.requestBody),
    scene_envelope_sha256: response.responseSha256, scene_candidate_sha256: projected.responseSha256,
    scene_screenplay_sha256: await sceneContentSha256(canonicalJson(projected.screenplay)), scene_body_sha256: projected.bodySha256 };
  if (Object.entries(hashes).some(([key, value]) => inputReceipt[key] !== value) || pending.requestDigest !== hashes.scene_request_sha256) return fail();
  const layout = await measureOutputSceneLayout(projected.screenplay, displaySource, fontBytes);
  const qualified = layout.status === "layout-candidate" && layout.pageRangeSatisfied;
  const scene_layout = qualified ? { status: "qualified", profile: layout.profile, fontSha256: layout.fontSha256,
    metricsSha256: layout.metricsSha256, policySha256: layout.policySha256, screenplaySha256: layout.screenplaySha256,
    bodySha256: layout.bodySha256, displaySourceSha256: layout.displaySourceSha256, pagesSha256: layout.pagesSha256, pageCount: layout.pagination.pageCount }
    : { status: "unqualified", reason: layout.status === "layout-candidate" ? "page-range" : layout.reason,
      pageCount: layout.status === "layout-candidate" ? layout.pagination.pageCount : null };
  const receipt = { ...hashes, scene_output_contract: sceneContract, scene_output_contract_digest: await digest(sceneContract),
    scene_cost_binding_hash: costPreview.bindingHash, scene_layout,
    validation: { ...object(inputReceipt.validation), status: qualified ? "structure_valid_layout_verified" : "structure_valid_layout_unqualified",
      requirement_fulfilled: qualified, maximum_provider_calls: 1, provider_call_count: 1, provider_response_ids: [response.responseId], repair_attempted: false } };
  return { receipt, inputReceipt: { ...inputReceipt, ...receipt } };
}

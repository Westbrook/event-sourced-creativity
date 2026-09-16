import { canonicalJson, digest, freeze } from "../experiences/compiler.ts";
import { model3dMiniAppCostApprovalMatches, parseModel3dMiniAppCostPreview } from "./model3d-mini-app-consent.ts";
import { RODIN_ADAPTER_VERSION } from "./model3d.ts";
import { captureModel3dAssetBytes, inspectTransferredStaticModel3dAsset } from "./model3d-static-policy.ts";
import type { Model3dPreparedReceipt } from "../../worker/fal-model3d-adapter.ts";
import type { PaidProviderSubmission } from "./provider-submission.ts";
import type { ProviderAttemptPreflight } from "../../worker/openai-adapter.ts";

import { captureModel3dComparisonData as snapshot, readModel3dExecutionPayload, type OutputModel3dPayload } from "./output-model3d-offer.ts";
export type { OutputModel3dPayload } from "./output-model3d-offer.ts";
const row = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
const fail = (): never => { throw Error("output_model3d_request_not_authorized"); };
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Server quote validation additionally hashes the entire immutable envelope. */
export async function readOutputModel3dPayload(value: unknown): Promise<OutputModel3dPayload | null> {
  const offer = readModel3dExecutionPayload(value);
  if (!offer) return null;
  const { preparationDigest, ...original } = offer.description;
  return await digest(original) === preparationDigest ? offer : null;
}
export function requireModel3dMiniAppCostApproval(approval: unknown, original: unknown, current: unknown) {
  const before = parseModel3dMiniAppCostPreview(original), after = parseModel3dMiniAppCostPreview(current);
  if (!before || !after || canonicalJson(before) !== canonicalJson(after) || !model3dMiniAppCostApprovalMatches(approval, after)) return fail();
  return after;
}

/** Matches the existing Rodin adapter's canonical digest (not the different
 * preparationDigest). Called by onPrepared before any image upload or POST. */
export async function verifyModel3dPreparedReceipt(offer: OutputModel3dPayload, value: Model3dPreparedReceipt): Promise<Model3dPreparedReceipt> {
  const receipt = snapshot(value), description = offer.description;
  if (!row(receipt) || !exactKeys(receipt, ["provider", "model", "adapterVersion", "submittedPrompt", "settings", "parameters", "acceptedFields", "referenceInputs", "usedReferencePixels", "estimatedCostMicrousd", "requestDigest"])
    || receipt.provider !== "fal" || receipt.model !== description.model || receipt.adapterVersion !== RODIN_ADAPTER_VERSION
    || receipt.submittedPrompt !== description.prompt || canonicalJson(receipt.settings) !== canonicalJson(description.settings)
    || canonicalJson(receipt.parameters) !== canonicalJson(description.parameters) || canonicalJson(receipt.acceptedFields) !== canonicalJson(description.acceptedFields)
    || receipt.estimatedCostMicrousd !== description.maximumMicrousd || receipt.usedReferencePixels !== Boolean(offer.contract.reference)
    || !hash(receipt.requestDigest) || !Array.isArray(receipt.referenceInputs) || receipt.referenceInputs.length !== description.references.length) return fail();
  for (let index = 0; index < receipt.referenceInputs.length; index++) {
    const actual = receipt.referenceInputs[index], expected = description.references[index]!;
    if (!row(actual) || !exactKeys(actual, ["index", "blockId", "referenceId", "label", "mimeType", "byteLength", "sha256", "transport"])
      || actual.index !== index || actual.label !== null && (typeof actual.label !== "string" || actual.label.length > 2000)
      || ["blockId", "referenceId", "mimeType", "byteLength", "sha256", "transport"].some(key => actual[key] !== expected[key as keyof typeof expected])) return fail();
  }
  const wire = JSON.stringify({ model: receipt.model, parameters: receipt.parameters, referenceInputs: receipt.referenceInputs }, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
  const digestBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wire)));
  if (Array.from(digestBytes, byte => byte.toString(16).padStart(2, "0")).join("") !== receipt.requestDigest) return fail();
  return receipt as Model3dPreparedReceipt;
}

export function assertModel3dPreparedAttempt(offer: OutputModel3dPayload, prepared: Model3dPreparedReceipt | null, attempt: ProviderAttemptPreflight) {
  if (!prepared || attempt.model !== offer.preview.model || attempt.model !== prepared.model || attempt.logicalCallKey !== "model3d:initial"
    || attempt.maximumInputTokens !== 0 || attempt.maximumOutputTokens !== 0 || attempt.requestDigest !== prepared.requestDigest
    || !/^forma-model3d-[A-Za-z0-9._:-]{1,150}$/u.test(attempt.clientRequestId)) return fail();
}

/** The original paid receipt is required even for an unqualified GLB. No
 * refusal is represented as a free provider call or a replacement permission. */
export async function qualifyOutputModel3dCompletion(input: {
  offer: OutputModel3dPayload; prepared: Model3dPreparedReceipt; calls: readonly PaidProviderSubmission[];
  providerRequestId: string; primary: { bytes: Uint8Array; mimeType: string; sha256: string; role: string; format: string | null };
}, ownership: "copy" | "transfer" = "copy") {
  // Capture the caller-owned native byte view before the first await. The
  // qualifier and final custody hash must see exactly the same immutable copy.
  if (Object.getPrototypeOf(input.primary.bytes) !== Uint8Array.prototype) return fail();
  const bytes = captureModel3dAssetBytes(input.primary.bytes, ownership);
  if (!bytes) return fail();
  const primary = snapshot({ mimeType: input.primary.mimeType, sha256: input.primary.sha256,
    role: input.primary.role, format: input.primary.format }) as Record<string, unknown>;
  const calls = snapshot(input.calls), providerRequestId = input.providerRequestId, offer = input.offer;
  const prepared = await verifyModel3dPreparedReceipt(offer, input.prepared);
  if (!Array.isArray(calls) || calls.length !== 1 || !row(calls[0])) return fail();
  const call = calls[0];
  if (call.provider !== "fal" || call.operation !== "model3d" || call.model !== prepared.model || call.status !== "completed"
    || !identifier(call.clientRequestId) || !identifier(call.providerRequestId) || call.providerRequestId !== providerRequestId
    || call.costMicrousd !== offer.preview.maximumMicrousd || call.totalTokens !== 0
    || call.requestDigest !== undefined && call.requestDigest !== prepared.requestDigest || call.unitId !== undefined && call.unitId !== "model3d:initial") return fail();
  if (primary.role !== "mesh" || primary.format !== "glb" || primary.mimeType !== "model/gltf-binary" || !hash(primary.sha256)) return fail();
  const inspected = await inspectTransferredStaticModel3dAsset(bytes, primary.mimeType);
  // Invalid/animated output remains an original paid result, but never acquires
  // this static qualification. A separate exact-byte hash binds both branches.
  if (!inspected || inspected.sha256 !== primary.sha256) return fail();
  return freeze({ schemaVersion: 1, contract: offer.contract, preparationDigest: offer.preview.preparationDigest,
    mediaCallId: call.clientRequestId, providerRequestId: call.providerRequestId, requestDigest: prepared.requestDigest,
    primarySha256: primary.sha256, primaryByteLength: inspected.byteLength, qualification: inspected.qualification,
    semanticObjectCount: "unverified", requirementFulfilled: false });
}

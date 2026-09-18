import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import { MODEL3D_MINI_APP_SETTINGS, model3dOutputModel, parseModel3dOutputContract, type Model3dOutputContract } from "../src/model/output-model3d-contract.ts";
import { serializeRodinInput } from "../src/model/model3d.ts";
import type { PreparedModel3dRequest } from "./model3d-request.ts";

/** Consumes the existing server custody adapter's result. This pure serializer
 * is not ownership evidence and cannot authorize transfer or allocate a job. */
export async function describeModel3dPreparation(contract: Model3dOutputContract, prepared: PreparedModel3dRequest) {
  const captured = parseModel3dOutputContract(contract), selected = captured?.reference;
  if (!captured || prepared.model !== model3dOutputModel(captured)
    || canonicalJson(prepared.settings) !== canonicalJson(MODEL3D_MINI_APP_SETTINGS)
    || prepared.references.length !== (selected ? 1 : 0) || prepared.referenceBlockIds.length !== prepared.references.length
    || !Number.isSafeInteger(prepared.estimatedCostMicrousd) || prepared.estimatedCostMicrousd <= 0)
    throw Error("output_model3d_preparation_changed");
  const references = [];
  for (const reference of prepared.references) {
    if (!selected || reference.blockId !== selected.copiedBlockId || prepared.referenceBlockIds[0] !== reference.blockId
      || reference.referenceId !== selected.selection.referenceId || !(reference.bytes instanceof Uint8Array)
      || !reference.bytes.byteLength || reference.bytes.byteLength > 24 * 1024 * 1024
      || !["image/jpeg", "image/png", "image/webp"].includes(reference.mimeType)) throw Error("output_model3d_reference_changed");
    const bytes = new Uint8Array(reference.bytes);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
    if (sha256 !== selected.selection.sha256) throw Error("output_model3d_reference_changed");
    references.push({ blockId: reference.blockId, referenceId: reference.referenceId, sha256, mimeType: reference.mimeType,
      byteLength: bytes.byteLength, transport: "fal-storage-upload" as const });
  }
  // Only local placeholders discover the existing serializer's accepted keys.
  // They are neither selected reference URLs nor requested network resources.
  const wire = serializeRodinInput(prepared.prompt, prepared.settings, references.map((_, index) => `https://fal.media/reference-${index + 1}`));
  if (wire.model !== prepared.model || wire.estimatedCostMicrousd !== prepared.estimatedCostMicrousd) throw Error("output_model3d_preparation_changed");
  const parameters = Object.fromEntries(Object.entries(wire.input).filter(([key]) => key !== "image_urls"));
  const description = { version: "model3d-mini-app-preparation-v1" as const, contract: captured,
    model: prepared.model, prompt: prepared.prompt, settings: wire.settings, parameters,
    acceptedFields: Object.keys(wire.input), references, adaptation: prepared.adaptation ?? null,
    maximumMicrousd: prepared.estimatedCostMicrousd, maximumCalls: 1, maximumTokens: 1 };
  // This is the reviewed mini-app envelope digest, deliberately not named the
  // provider adapter's different requestDigest or a reusable execution token.
  return freeze({ ...description, preparationDigest: await digest(description) });
}

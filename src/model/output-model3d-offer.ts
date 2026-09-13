import { canonicalJson, freeze } from "../experiences/compiler.ts";
import { MODEL3D_MINI_APP_SETTINGS, model3dOutputModel, parseModel3dOutputContract } from "./output-model3d-contract.ts";
import { parseModel3dMiniAppCostPreview } from "./model3d-mini-app-consent.ts";
import { serializeRodinInput } from "./model3d.ts";
import { OUTPUT_MODEL3D_EXECUTION_POLICY } from "./output-execution-policy.ts";
import type { describeModel3dPreparation } from "../../worker/output-model3d-preparation.ts";

type Description = Awaited<ReturnType<typeof describeModel3dPreparation>>;
const row = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const fail = (): never => { throw Error("output_model3d_request_not_authorized"); };

/** Finite data snapshot: never invokes supplied getters, iterators or toJSON.
 * These are rendering/request comparisons, not a substitute for server custody. */
export function captureModel3dComparisonData(value: unknown): unknown {
  let nodes = 0, characters = 0;
  const active = new Set<object>();
  const visit = (input: unknown, depth: number): unknown => {
    if (++nodes > 16000 || depth > 24) return fail();
    if (input === null || typeof input === "boolean" || typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input === "string" && (characters += input.length) <= 262144) return input;
    if (!input || typeof input !== "object" || active.has(input)) return fail();
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return fail();
    const fields = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(fields);
    active.add(input);
    try {
      if (array) {
        const length = fields.length?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > 16000 || keys.length !== length + 1) return fail();
        const output: unknown[] = [];
        for (let i = 0; i < length; i++) {
          const field = fields[String(i)];
          if (!field?.enumerable || !Object.hasOwn(field, "value")) return fail();
          output.push(visit(field.value, depth + 1));
        }
        return Object.freeze(output);
      }
      const output: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (typeof key !== "string" || key.length > 200 || ["__proto__", "constructor", "prototype"].includes(key)) return fail();
        const field = fields[key]!;
        if (!field.enumerable || !Object.hasOwn(field, "value")) return fail();
        output[key] = visit(field.value, depth + 1);
      }
      return Object.freeze(output);
    } finally { active.delete(input); }
  };
  return visit(value, 0);
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** A closed, immutable comparison envelope. The calling admission/execution
 * layer must additionally own the original source, job, grant and deadline. */
export function readModel3dExecutionPayload(value: unknown) {
  try {
    const payload = captureModel3dComparisonData(value);
    if (!row(payload)) return null;
    const contract = parseModel3dOutputContract(payload.outputModel3d), preview = parseModel3dMiniAppCostPreview(payload.model3dCostPreview);
    const description = payload.model3dPreparation;
    if (!contract || !preview || !row(description) || !exactKeys(description, ["version", "contract", "model", "prompt", "settings", "parameters", "acceptedFields", "references", "adaptation", "maximumMicrousd", "maximumCalls", "maximumTokens", "preparationDigest"])
      || description.version !== "model3d-mini-app-preparation-v1" || canonicalJson(description.contract) !== canonicalJson(contract)
      || description.model !== model3dOutputModel(contract) || preview.model !== description.model
      || description.maximumMicrousd !== preview.maximumMicrousd || description.maximumCalls !== 1 || description.maximumTokens !== 1
      || typeof description.prompt !== "string" || canonicalJson(description.settings) !== canonicalJson(MODEL3D_MINI_APP_SETTINGS)
      || description.preparationDigest !== preview.preparationDigest || preview.draftId !== contract.source.draftId
      || payload.productionMode !== "manual" || payload.artifactKind !== "model3d" || payload.itemCount !== 1
      || payload.model3dPrompt !== description.prompt || payload.model3dPromptSource !== "document"
      || canonicalJson(payload.model3dSettings) !== canonicalJson(MODEL3D_MINI_APP_SETTINGS)
      || canonicalJson(payload.model3dAdaptation) !== canonicalJson(description.adaptation)
      || !Array.isArray(description.references) || description.references.length !== (contract.reference ? 1 : 0)
      || preview.sourceFilesTransferred !== description.references.length
      || canonicalJson(payload.model3dReferenceBlockIds) !== canonicalJson(contract.reference ? [contract.reference.copiedBlockId] : [])
      || ["productionPlan", "productionPage", "outputNarrative", "outputScene", "outputStoryboard", "outputAudio", "outputFalImage", "outputImageFormat"].some(key => Object.hasOwn(payload, key))) return null;
    const reference = description.references[0];
    if (contract.reference && (!row(reference) || !exactKeys(reference, ["blockId", "referenceId", "sha256", "mimeType", "byteLength", "transport"])
      || reference.blockId !== contract.reference.copiedBlockId || reference.referenceId !== contract.reference.selection.referenceId
      || reference.sha256 !== contract.reference.selection.sha256 || reference.sha256 !== preview.referenceSha256
      || reference.byteLength !== preview.referenceBytes || reference.mimeType !== preview.referenceMimeType
      || reference.transport !== "fal-storage-upload" || preview.sourceKind !== contract.reference.selection.kind)) return null;
    const wire = serializeRodinInput(description.prompt, MODEL3D_MINI_APP_SETTINGS, description.references.map((_, index) => `https://fal.media/reference-${index + 1}`));
    const parameters = Object.fromEntries(Object.entries(wire.input).filter(([key]) => key !== "image_urls"));
    if (canonicalJson(description.parameters) !== canonicalJson(parameters) || canonicalJson(description.acceptedFields) !== canonicalJson(Object.keys(wire.input))) return null;
    return freeze({ contract, preview, description: description as Description });
  } catch { return null; }
}
export type OutputModel3dPayload = NonNullable<ReturnType<typeof readModel3dExecutionPayload>>;

/** Closed display projection of the same fixed quote. Never an execution grant. */
export function readModel3dExecutionOffer(value: unknown) {
  try {
    const target = captureModel3dComparisonData(value);
    if (!row(target) || !row(target.settings)) return null;
    const settings = target.settings, parsed = readModel3dExecutionPayload(settings.payload);
    if (!parsed || target.available !== true || target.provider !== "fal" || target.model !== parsed.preview.model
      || target.route !== "model3d-mini-app-static-glb-v1" || target.reasonCode !== "output_model3d_ready_for_separate_approval"
      || target.transferCode !== "output_transfer_model3d_not_yet_authorized"
      || target.maximumMicrousd !== parsed.preview.maximumMicrousd || target.maximumCalls !== 1 || target.maximumTokens !== 1
      || settings.kind !== "render_document" || settings.preparationOnly !== false || settings.executionAvailable !== true
      || settings.explicitCostAndTransferApprovalRequired !== true
      || canonicalJson(settings.executionPolicy) !== canonicalJson(OUTPUT_MODEL3D_EXECUTION_POLICY)
      || canonicalJson(settings.costPreview) !== canonicalJson(parsed.preview) || canonicalJson(settings.description) !== canonicalJson(parsed.description)
      || canonicalJson(settings.calls) !== canonicalJson([{ stage: "model3d:initial", provider: "fal", model: parsed.preview.model, maximumMicrousd: parsed.preview.maximumMicrousd }])
      || canonicalJson(settings.original) !== canonicalJson({ requestId: parsed.preview.requestId, expiresAt: parsed.preview.expiresAt,
        draftId: parsed.preview.draftId, actorUserId: parsed.preview.actorUserId, projectId: parsed.preview.projectId,
        documentId: parsed.preview.documentId, sourceDigest: parsed.preview.sourceDigest, requirementsDigest: parsed.preview.requirementsDigest })) return null;
    return freeze({ ...parsed, target, settings });
  } catch { return null; }
}

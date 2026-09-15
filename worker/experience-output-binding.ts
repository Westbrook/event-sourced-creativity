import { canonicalJson, digest } from "../src/experiences/compiler.ts";
import { scenePreparationCommandKey, scenePreparationCycleMatches, type ScenePreparationCycle } from "./experience-scene-renewal.ts";
import { model3dReplacementCommandKey, model3dReplacementCycleMatches, type Model3dReplacementCycle } from "./experience-model3d-replacement.ts";

/** Pure identity/envelope helpers. No provider, budget, job or authorization is minted here. */
export type ExperienceOutputStage = "save" | "confirm" | "preflight" | "authorize" | "run";
export type ExperienceOutputBinding = Readonly<{
  version: 1; draftId: string; draftHash: string; releaseHash: string; requestHash: string;
  sourceBindingHash: string; output: "image" | "slides" | "short_story" | "scene" | "audio" | "storyboard" | "model3d" | "video"; projectId: string; documentId: string; streamId: string;
  /** Only a server-verified append-only successor may add this. Root v1 bindings
   * and their immutable keys/envelopes retain their exact original shape. */
  preparationCycle?: ScenePreparationCycle;
  /** Additional-risk 3D child; never a renewal of the parent's paid authority. */
  replacementCycle?: Model3dReplacementCycle;
}>;
type PlanIdentity = { draftId: string; draftHash: string; request: unknown; events: readonly unknown[];
  release: { releaseHash: string; output: { output: string } }; projectId: string; documentId: string; streamId: string };
const stages: readonly ExperienceOutputStage[] = ["save", "confirm", "preflight", "authorize", "run"];
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export async function experienceOutputBinding(plan: PlanIdentity): Promise<ExperienceOutputBinding> {
  const output = plan.release.output.output;
  if (output !== "image" && output !== "slides" && output !== "short_story" && output !== "scene" && output !== "audio" && output !== "storyboard" && output !== "model3d" && output !== "video") throw new Error("experience_output_unsupported");
  if (!/^experience-draft-[a-f0-9]{64}$/u.test(plan.draftId) || !plan.streamId.startsWith("creative:")) throw new Error("experience_output_binding_invalid");
  return Object.freeze({ version: 1, draftId: plan.draftId, draftHash: plan.draftHash, releaseHash: plan.release.releaseHash,
    requestHash: await digest(plan.request), sourceBindingHash: await digest({ projectId: plan.projectId, documentId: plan.documentId, events: plan.events }),
    output, projectId: plan.projectId, documentId: plan.documentId, streamId: plan.streamId });
}
export async function experienceOutputCommandKey(binding: ExperienceOutputBinding, stage: ExperienceOutputStage) {
  if (!stages.includes(stage)) throw new Error("experience_output_stage_invalid");
  if (Object.hasOwn(binding, "preparationCycle")) {
    const { preparationCycle: cycle, ...root } = binding;
    if (!["scene", "video", "model3d"].includes(binding.output) || stage === "save" || !cycle
      || !await scenePreparationCycleMatches(root, cycle.predecessor, cycle)) throw new Error("experience_scene_renewal_lineage_unavailable");
    return scenePreparationCommandKey(cycle, stage);
  }
  if (Object.hasOwn(binding, "replacementCycle")) {
    const { replacementCycle: cycle, ...root } = binding;
    if (binding.output !== "model3d" || stage === "save" || !cycle
      || !await model3dReplacementCycleMatches(root, cycle)) throw new Error("experience_model3d_replacement_lineage_unavailable");
    return model3dReplacementCommandKey(cycle, stage);
  }
  // Deliberately omit mutable content, release, quote and client mutation IDs.
  // A changed envelope cannot escape this one logical-intake stage fence.
  const identity = (await digest({ namespace: "experience-output-command@1", streamId: binding.streamId, draftId: binding.draftId })).slice(7);
  return `experience-output-v1:${identity}:${stage}`;
}
export async function experienceOutputEnvelope(binding: ExperienceOutputBinding, stage: ExperienceOutputStage, expectedRevision: number, fields: Record<string, unknown> = {}) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("experience_output_revision_invalid");
  if (Object.keys(fields).some(key => ["documentId", "expectedRevision", "clientMutationId", "action", "experienceBinding"].includes(key))) throw new Error("experience_output_envelope_invalid");
  return { ...structuredClone(fields), action: stage, documentId: binding.documentId, expectedRevision: `output:${expectedRevision}`,
    clientMutationId: await experienceOutputCommandKey(binding, stage), experienceBinding: structuredClone(binding) };
}
export async function validateExperienceOutputEnvelope(value: unknown, binding: ExperienceOutputBinding, stage: ExperienceOutputStage, requestDigest: string) {
  if (!record(value) || value.action !== stage || value.documentId !== binding.documentId
    || value.clientMutationId !== await experienceOutputCommandKey(binding, stage)
    || typeof value.expectedRevision !== "string" || !/^output:(0|[1-9]\d*)$/u.test(value.expectedRevision)
    || !Number.isSafeInteger(Number(value.expectedRevision.slice(7)))
    || canonicalJson(value.experienceBinding) !== canonicalJson(binding)
    || (await digest(value)).slice(7) !== requestDigest) throw new Error("experience_output_original_envelope_unavailable");
  return structuredClone(value);
}
export function experienceOutputAuthorization(confirmation: unknown, terms: { termsDigest: string; maximumMicrousd: number }) {
  if (!record(confirmation) || confirmation.explicitAuthorization !== true
    || confirmation.termsDigest !== terms.termsDigest || confirmation.maximumMicrousd !== terms.maximumMicrousd
    || !Number.isSafeInteger(terms.maximumMicrousd) || terms.maximumMicrousd <= 0)
    throw new Error("experience_output_explicit_authorization_required");
  // This true value comes only from the separately supplied deliberate action.
  return { explicitAuthorization: confirmation.explicitAuthorization, termsDigest: terms.termsDigest, maximumMicrousd: terms.maximumMicrousd };
}

import { createModel3dOutputContract, parseModel3dOutputContract, type Model3dOutputContract } from "../src/model/output-model3d-contract.ts";
import { inspectOutputRequirement, type OutputRequirementSpec } from "../src/model/output-requirements.ts";
import { readModel3dReferenceIntent } from "../src/experiences/model3d-reference.ts";
import type { ExperiencePlan } from "../src/experiences/intake.ts";
import type { ExperienceOutputBinding } from "./experience-output-binding.ts";

/** Pure plan correspondence. The caller must still resolve original private
 * intake, source, permission and owner/currentness; no submitted copy is trusted. */
export function experienceModel3dOutputContract(plan: ExperiencePlan, binding: ExperienceOutputBinding) {
  if (plan.release.output.output !== "model3d" || binding.output !== "model3d") return null;
  let reference = null;
  if (plan.reference) {
    const selection = readModel3dReferenceIntent(plan.reference.selection);
    const copies = plan.events.filter(event => event.type === "BlockCreated" && event.payload.handle === "reference/experience-model3d");
    const copy = copies[0];
    if (!selection || copies.length !== 1 || !copy || copy.payload.project_id !== plan.projectId || copy.payload.document_id !== plan.documentId) return null;
    reference = { selection, sourceDigest: plan.reference.sourceDigest, copiedBlockId: copy.payload.block_id };
  }
  return createModel3dOutputContract({
    draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
    requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash, reference,
  });
}

const origin = (text: string) => ({ kind: "interpreted" as const, text });
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Fixed requested target only; source custody, cost/transfer consent and static
 * retained-byte qualification remain separate original-operation boundaries. */
export function createExperienceModel3dRecipe(input: {
  output: "model3d"; requirementId: string; deliverableId: string; contract: Model3dOutputContract;
}) {
  const keys = ["output", "requirementId", "deliverableId", "contract"];
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw Error("experience_model3d_recipe_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))) throw Error("experience_model3d_recipe_invalid");
  const output = descriptors.output!.value, requirementId = descriptors.requirementId!.value, deliverableId = descriptors.deliverableId!.value;
  const contract = parseModel3dOutputContract(descriptors.contract!.value);
  if (output !== "model3d" || !contract || typeof requirementId !== "string" || typeof deliverableId !== "string") throw Error("experience_model3d_recipe_invalid");
  const wording = "1 static GLB object";
  const spec: OutputRequirementSpec = {
    schema_version: 1, id: requirementId, label: "3D object", original_text: wording,
    deliverables: [{ id: deliverableId, label: "3D object", media_kind: "model3d", required: true,
      quantity: { kind: "exact", unit: "model", value: 1 }, model3d_contract: contract,
      source_scope: { kind: "document" }, coverage: { kind: "document_context" }, original_text: wording,
      value_origins: { media_kind: origin("model3d"), quantity: origin("1 GLB model"), required: origin(wording),
        model3d_contract: origin(contract.id), source_scope: origin("document"), coverage: origin("document_context") } }],
    value_origins: { label: origin("3D object"), deliverables: origin(wording), interpretation_basis: origin(wording) },
  };
  if (inspectOutputRequirement(spec).status !== "valid") throw Error("experience_model3d_recipe_invalid");
  return freeze({ output: "model3d" as const, spec, targetId: `${deliverableId}:target:1`, nativeReadiness: "eligible_for_existing_preflight" as const });
}

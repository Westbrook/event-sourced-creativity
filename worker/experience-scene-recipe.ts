import { parseSceneOutputContract, type SceneOutputContract } from "../src/model/output-scene-contract.ts";
import { inspectOutputRequirement, isOutputRequirementId, type OutputRequirementSpec } from "../src/model/output-requirements.ts";
import { freeze } from "../src/experiences/compiler.ts";

/** Explicit schema only. Native source/consent/job custody is a prerequisite to
 * later activation; this builder cannot authorize a call or adopt a document. */
export function createExperienceSceneRecipe(input: {
  output: "scene"; requirementId: string; deliverableId: string; contract: SceneOutputContract;
}) {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("experience_scene_recipe_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = ["output", "requirementId", "deliverableId", "contract"];
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key])) throw new Error("experience_scene_recipe_invalid");
  const contract = parseSceneOutputContract(input.contract);
  if (input.output !== "scene" || !contract || !isOutputRequirementId(input.requirementId) || !isOutputRequirementId(input.deliverableId)
    || input.requirementId === input.deliverableId) throw new Error("experience_scene_recipe_invalid");
  const label = "Scene", wording = "1 scene · 2 characters · 1 location\n1–2 pages";
  const interpreted = (text: string) => ({ kind: "interpreted" as const, text });
  const spec: OutputRequirementSpec = { schema_version: 1, id: input.requirementId, label, original_text: wording,
    deliverables: [{ id: input.deliverableId, label, media_kind: "document", required: true,
      quantity: { kind: "exact", unit: "document", value: 1 }, scene_contract: contract,
      source_scope: { kind: "document" }, coverage: { kind: "document_context" }, original_text: wording,
      value_origins: { media_kind: interpreted("document"), quantity: interpreted("1 document"), required: interpreted(wording),
        scene_contract: interpreted(contract.id), source_scope: interpreted("document"), coverage: interpreted("document_context") } }],
    value_origins: { label: interpreted(label), deliverables: interpreted(wording), interpretation_basis: interpreted(wording) } };
  if (inspectOutputRequirement(spec).status !== "valid") throw new Error("experience_scene_recipe_invalid");
  return freeze({ output: "scene" as const, spec, targetId: `${input.deliverableId}:target:1`, nativeReadiness: "unavailable" as const });
}

import { parseStoryboardOutputContract, type StoryboardOutputContract } from "../src/model/output-storyboard-contract.ts";
import { inspectOutputRequirement, type OutputRequirementSpec } from "../src/model/output-requirements.ts";

const origin = (text: string) => ({ kind: "interpreted" as const, text });
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Maps only the registered profile. Confirmation and execution remain separate. */
export function createExperienceStoryboardRecipe(input: {
  output: "storyboard"; requirementId: string; deliverableId: string; contract: StoryboardOutputContract;
}) {
  const keys = ["output", "requirementId", "deliverableId", "contract"];
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("experience_storyboard_recipe_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key])) throw new Error("experience_storyboard_recipe_invalid");
  const contract = parseStoryboardOutputContract(input.contract);
  if (input.output !== "storyboard" || !contract) throw new Error("experience_storyboard_recipe_invalid");
  const wording = "4 frames\nPreserve the authored story, visual direction, order and constraints";
  const spec: OutputRequirementSpec = {
    schema_version: 1, id: input.requirementId, label: "Storyboard", original_text: wording,
    deliverables: [{ id: input.deliverableId, label: "Storyboard", media_kind: "document", required: true,
      quantity: { kind: "exact", unit: "document", value: 1 }, storyboard_contract: contract,
      source_scope: { kind: "document" }, coverage: { kind: "document_context" }, original_text: wording,
      value_origins: { media_kind: origin("document"), quantity: origin("1 storyboard"), required: origin(wording),
        storyboard_contract: origin(contract.id), source_scope: origin("document"), coverage: origin("document_context") } }],
    value_origins: { label: origin("Storyboard"), deliverables: origin(wording), interpretation_basis: origin(wording) },
  };
  if (inspectOutputRequirement(spec).status !== "valid") throw new Error("experience_storyboard_recipe_invalid");
  return freeze({ output: "storyboard" as const, spec, targetId: `${input.deliverableId}:target:1`, nativeReadiness: "eligible_for_existing_preflight" as const });
}

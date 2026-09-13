import { parseShortStoryNarrativeContract, type ShortStoryNarrativeContract } from "../src/model/output-narrative-contract.ts";
import { inspectOutputRequirement, type OutputRequirementSpec } from "../src/model/output-requirements.ts";

export type ExperienceNarrativeRecipe = Readonly<{
  output: "short_story";
  spec: OutputRequirementSpec;
  targetId: string;
  nativeReadiness: "unavailable";
}>;
const interpreted = (text: string) => ({ kind: "interpreted" as const, text });
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Separate fixed recipe until the native story bridge is qualified. No existing
 * Image/Slides union, route, binding, entry, release or renderer is widened here. */
export function createExperienceNarrativeRecipe(input: {
  output: "short_story"; requirementId: string; deliverableId: string; contract: ShortStoryNarrativeContract;
}): ExperienceNarrativeRecipe {
  const keys = ["output", "requirementId", "deliverableId", "contract"];
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("experience_narrative_recipe_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key])) throw new Error("experience_narrative_recipe_invalid");
  const contract = parseShortStoryNarrativeContract(input.contract);
  if (input.output !== "short_story" || !contract) throw new Error("experience_narrative_recipe_invalid");
  const label = "Short story", wording = "1 story · 600–800 words\nEnglish · Fiction";
  const spec: OutputRequirementSpec = {
    schema_version: 1, id: input.requirementId, label, original_text: wording,
    deliverables: [{ id: input.deliverableId, label, media_kind: "document", required: true,
      quantity: { kind: "exact", unit: "document", value: 1 }, narrative_contract: contract,
      source_scope: { kind: "document" }, coverage: { kind: "document_context" }, original_text: wording,
      value_origins: { media_kind: interpreted("document"), quantity: interpreted("1 document"), required: interpreted(wording),
        narrative_contract: interpreted(contract.id), source_scope: interpreted("document"), coverage: interpreted("document_context") } }],
    value_origins: { label: interpreted(label), deliverables: interpreted(wording), interpretation_basis: interpreted(wording) },
  };
  if (inspectOutputRequirement(spec).status !== "valid") throw new Error("experience_narrative_recipe_invalid");
  return freeze({ output: "short_story", spec, targetId: `${input.deliverableId}:target:1`, nativeReadiness: "unavailable" });
}

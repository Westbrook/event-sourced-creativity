import { parseAudioOutputContract, type AudioOutputContract } from "../src/model/output-audio-contract.ts";
import { inspectOutputRequirement, type OutputRequirementSpec } from "../src/model/output-requirements.ts";

const origin = (text: string) => ({ kind: "interpreted" as const, text });
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Maps only the registered profile. Confirmation and execution remain separate. */
export function createExperienceAudioRecipe(input: {
  output: "audio"; requirementId: string; deliverableId: string; contract: AudioOutputContract;
}) {
  const keys = ["output", "requirementId", "deliverableId", "contract"];
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("experience_audio_recipe_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key])) throw new Error("experience_audio_recipe_invalid");
  const contract = parseAudioOutputContract(input.contract);
  if (input.output !== "audio" || !contract) throw new Error("experience_audio_recipe_invalid");
  const wording = "1 instrumental track · about 20 seconds\nNo lyrics or spoken voice";
  const spec: OutputRequirementSpec = {
    schema_version: 1, id: input.requirementId, label: "Audio", original_text: wording,
    deliverables: [{ id: input.deliverableId, label: "Audio", media_kind: "audio", required: true,
      quantity: { kind: "exact", unit: "episode", value: 1 }, audio_contract: contract,
      source_scope: { kind: "document" }, coverage: { kind: "document_context" }, original_text: wording,
      value_origins: { media_kind: origin("audio"), quantity: origin("1 track"), required: origin(wording),
        audio_contract: origin(contract.id), source_scope: origin("document"), coverage: origin("document_context") } }],
    value_origins: { label: origin("Audio"), deliverables: origin(wording), interpretation_basis: origin(wording) },
  };
  if (inspectOutputRequirement(spec).status !== "valid") throw new Error("experience_audio_recipe_invalid");
  return freeze({ output: "audio" as const, spec, targetId: `${input.deliverableId}:target:1`, nativeReadiness: "eligible_for_existing_preflight" as const });
}

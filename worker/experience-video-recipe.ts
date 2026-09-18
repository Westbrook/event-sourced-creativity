import { parseVideoOutputContract, type VideoOutputContract } from "../src/model/output-video-contract.ts";
import { inspectOutputRequirement, type OutputRequirementSpec } from "../src/model/output-requirements.ts";
import { freeze } from "../src/experiences/compiler.ts";

const origin = (text: string) => ({ kind: "interpreted" as const, text });
/** Fixed requested deliverable only. Original source must be reread at intake and
 * dispatch; the caller's bound IDs/hashes are not custody evidence. */
export function createExperienceVideoRecipe(input: {
  output: "video"; requirementId: string; deliverableId: string; contract: VideoOutputContract;
}) {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw new Error("experience_output_recipe_invalid");
  const keys = ["output", "requirementId", "deliverableId", "contract"], descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every(key => descriptors[key]?.enumerable && "value" in descriptors[key]))
    throw new Error("experience_output_recipe_invalid");
  const contract = parseVideoOutputContract(input.contract);
  if (input.output !== "video" || !contract) throw new Error("experience_output_recipe_invalid");
  const wording = `1 video · 4 seconds · 480p · Silent\n${contract.frameSize === "1280x720" ? "16:9" : "9:16"} · 1 image`;
  const spec: OutputRequirementSpec = {
    schema_version: 1, id: input.requirementId, label: "Video", original_text: wording,
    deliverables: [{ id: input.deliverableId, label: "Video", media_kind: "video", required: true,
      quantity: { kind: "exact", unit: "video", value: 1 }, content_quantity: { kind: "exact", unit: "second", value: 4 },
      video_contract: contract, source_scope: { kind: "document" }, coverage: { kind: "document_context" }, original_text: wording,
      value_origins: { media_kind: origin("Video"), quantity: origin("1 video"), content_quantity: origin("4 seconds"),
        video_contract: origin(contract.id), source_scope: origin("document"), coverage: origin("document_context") } }],
    value_origins: { label: origin("Video"), deliverables: origin(wording), interpretation_basis: origin(wording) },
  };
  if (inspectOutputRequirement(spec).status !== "valid") throw new Error("experience_output_recipe_invalid");
  return freeze({ output: "video" as const, spec, targetId: `${input.deliverableId}:target:1`, nativeReadiness: "eligible_for_existing_preflight" as const });
}

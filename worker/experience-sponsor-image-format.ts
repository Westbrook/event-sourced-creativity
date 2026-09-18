import { canonicalJson, exactKeys, record } from "../src/experiences/compiler.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { experienceImageFormat, readExperienceImageRatio } from "../src/experiences/image-ratio.ts";

const textTypes = new Set(["subject", "message", "style", "mood", "lighting", "composition", "color", "palette", "medium", "constraint", "detail", "text", "treatment", "negative", "output"]);
const spatial = { schema_version: 1, kind: "document", coordinate_space: "document-normalized", feather: 0, falloff: "hard", polarity: "inside" };

/** Only the two canonical format shapes emitted by registered Image intake
 * join the existing text-only mapping. Matching metadata is not an attestation
 * of the authoring UI. It grants no model, route or spending authority; exact
 * retained preflight and approved template checks still provide those bounds. */
export async function sponsorImageTextSource(facts: readonly unknown[]): Promise<boolean> {
  if (facts.every(fact => record(fact) && textTypes.has(String(fact.type).toLowerCase()))) return true;
  const release = await registeredExperience("image");
  if (!release || release.output.output !== "image") return false;
  const ratioDecision = release.definition.decisions.find(decision => decision.id === "ratio");
  if (!ratioDecision || ratioDecision.interactionRef !== "image-ratio@1"
    || !release.output.bindings.some(binding => binding.decisionId === ratioDecision.id && binding.slot === ratioDecision.bindingSlot && binding.target === "image")) return false;
  return facts.every(fact => {
    if (!record(fact)) return false;
    if (textTypes.has(String(fact.type).toLowerCase())) return true;
    if (fact.type !== "format" || fact.role !== "format" || fact.intent !== "include" || fact.active !== true || fact.effect !== "shape_or_include" || !record(fact.properties)) return false;
    const p = fact.properties;
    if (p.experience_release !== release.releaseHash || p.subtype !== "Aspect ratio" || p.weight !== .8 || canonicalJson(p.spatial_scope) !== canonicalJson(spatial)) return false;
    const common = ["authority", "experience_origin", "experience_release", "subtype", "text", "weight", "spatial_scope"];
    if (fact.handle === "format/experience-deliverable") return exactKeys(p,common) && p.authority === "inferred" && fact.authority === "inferred"
      && p.experience_origin === "default" && p.text === release.output.result;
    if (fact.handle !== "format/experience-ratio" || !exactKeys(p,[...common,"experience_binding","experience_value","image_format"])
      || p.authority !== "authored" || fact.authority !== "authored" || p.experience_origin !== "authored" || p.experience_binding !== ratioDecision.bindingSlot) return false;
    const ratio = readExperienceImageRatio(p.experience_value);
    return Boolean(ratio && p.text === `Ratio: ${ratio.width}:${ratio.height}` && canonicalJson(p.image_format) === canonicalJson(experienceImageFormat(p.experience_value)));
  });
}

import { canonicalJson, compileExperience, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import type { CompiledRelease } from "../src/experiences/contracts.ts";
import { registeredExperience } from "../src/experiences/intake.ts";
import { experienceImageFormat, readExperienceImageRatio } from "../src/experiences/image-ratio.ts";

const textTypes = new Set(["subject", "message", "style", "mood", "lighting", "composition", "color", "palette", "medium", "constraint", "detail", "text", "treatment", "negative", "output"]);
const spatial = { schema_version: 1, kind: "document", coordinate_space: "document-normalized", feather: 0, falloff: "hard", polarity: "inside" };
const fail = (): never => { throw new Error("retained_sponsor_image_format_invalid"); };
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const text = (value: unknown): value is string => typeof value === "string" && value.isWellFormed() && !value.includes("\0");
const nonempty = (value: unknown): value is string => text(value) && value.trim().length > 0;
const shape = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => record(value) && exactKeys(value, keys);
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const releaseKeys = ["schemaVersion", "qualification", "definition", "output", "interactions", "copy", "definitionHash", "releaseHash", "dependencies"];
const definitionKeys = ["schemaVersion", "id", "revision", "outputContractRef", "bindingPackRef", "essentialInteractionRef", "layout", "decisions", "viewerRef", "mobileProfileRef", "copySetRef"];
const decisionKeys = ["id", "interactionRef", "bindingSlot", "labelKey"];
const outputKeys = ["id", "version", "output", "label", "result", "bindingPackRef", "essentialInteractionRef", "viewerRef", "bindings"];
const interactionKeys = ["id", "version", "kind", "renderer", "feedback", "required", "maxLength", "defaultValue"];
const interactionOptional = ["options", "fields", "ratios", "minimum", "maximum"];

function defaultValueShape(value: unknown): boolean {
  if (text(value)) return true;
  if (Array.isArray(value)) return value.every(item => shape(item, ["id", "text"]) && nonempty(item.id) && text(item.text));
  return record(value) && Object.values(value).every(item => text(item) || typeof item === "number" && Number.isFinite(item));
}
function interactionShape(value: unknown) {
  if (!record(value) || !exactKeys(value, [...interactionKeys, ...interactionOptional.filter(key => Object.hasOwn(value, key))])
    || ![value.id, value.renderer, value.feedback].every(nonempty) || value.version !== 1
    || typeof value.kind !== "string" || !["source", "spatial", "order", "treatment", "ratio"].includes(value.kind)
    || typeof value.required !== "boolean" || !Number.isSafeInteger(value.maxLength) || Number(value.maxLength) < 0
    || Number(value.maxLength) > 8192 || !defaultValueShape(value.defaultValue)) return false;
  for (const key of ["minimum", "maximum"]) if (Object.hasOwn(value, key) && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) return false;
  if (Object.hasOwn(value, "options") && (!Array.isArray(value.options) || !value.options.every(item => shape(item, ["value", "label"]) && text(item.value) && text(item.label)))) return false;
  if (Object.hasOwn(value, "fields") && (!Array.isArray(value.fields) || !value.fields.every(item => shape(item, ["id", "label"]) && nonempty(item.id) && text(item.label)))) return false;
  if (Object.hasOwn(value, "ratios") && (!Array.isArray(value.ratios) || !value.ratios.every(item => shape(item, ["width", "height", "label", "dimensions"])
    && positive(item.width) && positive(item.height) && nonempty(item.label) && shape(item.dimensions, ["width", "height"])
    && positive(item.dimensions.width) && positive(item.dimensions.height)))) return false;
  return true;
}
function releaseShape(value: unknown): value is CompiledRelease {
  if (!shape(value, releaseKeys) || value.schemaVersion !== 1 || value.qualification !== "context-authoring"
    || !hash(value.definitionHash) || !hash(value.releaseHash) || !shape(value.definition, definitionKeys)
    || !shape(value.output, outputKeys) || !record(value.interactions) || !record(value.copy) || !record(value.dependencies)) return false;
  const definition = value.definition, output = value.output;
  return definition.schemaVersion === 1 && definition.id === "image" && positive(definition.revision)
    && [definition.outputContractRef, definition.bindingPackRef, definition.essentialInteractionRef, definition.layout,
      definition.viewerRef, definition.mobileProfileRef, definition.copySetRef].every(nonempty)
    && Array.isArray(definition.decisions) && definition.decisions.length >= 2 && definition.decisions.length <= 12
    && definition.decisions.every(item => shape(item, decisionKeys) && Object.values(item).every(nonempty))
    && output.output === "image" && (output.version === 1 || output.version === 2)
    && [output.id, output.label, output.result, output.bindingPackRef, output.essentialInteractionRef, output.viewerRef].every(nonempty)
    && Array.isArray(output.bindings) && output.bindings.length >= 2 && output.bindings.length <= 12
    && output.bindings.every(item => shape(item, ["slot", "decisionId", "interactionRef", "role", "target"])
      && [item.slot, item.decisionId, item.interactionRef].every(nonempty) && item.target === "image"
      && typeof item.role === "string" && ["subject", "direction", "evidence", "constraint"].includes(item.role))
    && Object.keys(value.interactions).length >= 2 && Object.keys(value.interactions).length <= 12
    && Object.values(value.interactions).every(interactionShape)
    && Object.values(value.copy).every(text) && Object.values(value.dependencies).every(hash);
}
function ratioDecisionFor(release: CompiledRelease) {
  const decision = release.definition.decisions.find(item => item.id === "ratio");
  return decision && decision.interactionRef === "image-ratio@1"
    && release.output.bindings.some(binding => binding.decisionId === decision.id && binding.slot === decision.bindingSlot && binding.target === "image") ? decision : null;
}

/** Validated format interpretation only; never execution, publication or custody authority. */
declare const retainedFormat: unique symbol;
export type RetainedSponsorImageFormat = Readonly<{ [retainedFormat]: true }>;
type RetainedFormatData = Readonly<{ release: CompiledRelease; canonicalRelease: string }>;
const retainedFormats = new WeakMap<RetainedSponsorImageFormat, RetainedFormatData>();
export function requireRetainedSponsorImageFormat(token: RetainedSponsorImageFormat): RetainedFormatData {
  const data = token && typeof token === "object" ? retainedFormats.get(token) : undefined;
  return data ?? fail();
}
export async function createRetainedSponsorImageFormat(rawRelease: unknown, expectedHash: string): Promise<RetainedSponsorImageFormat> {
  // Descriptor-safe bounds precede property reads or cloning. Capture every
  // caller-owned byte before the compiler's first asynchronous digest.
  if (!hash(expectedHash) || jsonIssues(rawRelease).length) return fail();
  const canonicalRelease = canonicalJson(rawRelease);
  if (new TextEncoder().encode(canonicalRelease).byteLength > 65536 || !releaseShape(rawRelease)) return fail();
  const captured = freeze(structuredClone(rawRelease));
  if (captured.releaseHash !== expectedHash) return fail();
  const compiled = await compileExperience(captured.definition, { version: "forma-experience-context@2", qualification: "context-authoring",
    interactions: Object.fromEntries(Object.values(captured.interactions).map(interaction => [interaction.id, interaction])),
    outputs: { [captured.output.id]: captured.output }, copy: captured.copy });
  if (!compiled.ok || compiled.release.releaseHash !== expectedHash || canonicalJson(compiled.release) !== canonicalRelease) return fail();
  const ratio = ratioDecisionFor(compiled.release), interaction = ratio && compiled.release.interactions[ratio.id];
  if (!ratio || !interaction || interaction.id !== "image-ratio@1" || interaction.kind !== "ratio" || interaction.renderer !== "image-ratio-choice@1"
    || !compiled.release.output.bindings.some(binding => binding.decisionId === ratio.id && binding.slot === ratio.bindingSlot
      && binding.interactionRef === ratio.interactionRef && binding.role === "constraint" && binding.target === "image")) return fail();
  const token = Object.freeze(Object.create(null)) as RetainedSponsorImageFormat;
  retainedFormats.set(token, freeze({ release: compiled.release, canonicalRelease }));
  return token;
}

/** Only the two canonical format shapes emitted by registered Image intake
 * join the existing text-only mapping. Matching metadata is not an attestation
 * of the authoring UI. It grants no model, route or spending authority; exact
 * retained preflight and approved template checks still provide those bounds. */
export async function sponsorImageTextSource(facts: readonly unknown[]): Promise<boolean> {
  if (facts.every(fact => record(fact) && textTypes.has(String(fact.type).toLowerCase()))) return true;
  const release = await registeredExperience("image");
  if (!release || release.output.output !== "image") return false;
  return sourceForRelease(facts, release);
}
export async function sponsorImageTextSourceForRetainedFormat(facts: readonly unknown[], token: RetainedSponsorImageFormat): Promise<boolean> {
  const { release } = requireRetainedSponsorImageFormat(token);
  // Even all-text facts require a genuine retained token at this named boundary.
  if (facts.every(fact => record(fact) && textTypes.has(String(fact.type).toLowerCase()))) return true;
  return sourceForRelease(facts, release);
}
function sourceForRelease(facts: readonly unknown[], release: CompiledRelease): boolean {
  const ratioDecision = ratioDecisionFor(release);
  if (!ratioDecision) return false;
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

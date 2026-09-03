import { definitions, fixtureCatalog } from "./catalog.ts";
import { canonicalJson, compileExperience, digest, freeze, jsonIssues, own, valueIssues } from "./compiler.ts";
import type { CompiledRelease, DecisionValue, ExperienceValue } from "./contracts.ts";
import type { EventInput } from "../model/events.ts";
import { suggestedSubtype, type BlockKind } from "../model/block-types.ts";
import { documentSlug, withDocumentInRoute } from "../model/routes.ts";

export type IntakeRequest = Readonly<{ intentId: string; experienceId: string; releaseHash: string; values: Readonly<Record<string, DecisionValue>> }>;
export type ExperiencePlan = Readonly<{
  version: 1; draftId: string; request: IntakeRequest; release: CompiledRelease;
  streamId: string; projectId: string; documentId: string; title: string; events: readonly EventInput[]; draftHash: string;
}>;
export const experienceIds = definitions.map(item => item.id);
export const isIntentId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
export const isDraftId = (value: string) => /^experience-draft-[a-f0-9]{64}$/u.test(value);
export const receiptPrefix = (draftId: string) => `experience-intake:v1:${draftId}:`;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => own(value, key));

// This allowlist qualifies context authoring only, never an output provider or spend.
export async function registeredExperience(id: string) {
  const definition = definitions.find(item => item.id === id);
  if (!definition) return null;
  const result = await compileExperience(definition, fixtureCatalog);
  return result.ok ? result.release : null;
}
export const initialValues = (release: CompiledRelease): Record<string, DecisionValue> => Object.fromEntries(release.definition.decisions.map(decision => [decision.id, { value: structuredClone(release.interactions[decision.id].defaultValue), provenance: "default" }]));
export function intakeValueIssues(release: CompiledRelease, values: unknown, complete = true) {
  if (jsonIssues(values).length || !record(values) || !exact(values, release.definition.decisions.map(decision => decision.id))) return [{ code: "values_invalid", path: "$" }];
  return release.definition.decisions.flatMap(decision => {
    const entry = values[decision.id];
    if (!record(entry) || !exact(entry, ["value", "provenance"]) || !["default", "authored"].includes(String(entry.provenance))) return [{ code: "value_invalid", path: decision.id }];
    const interaction = release.interactions[decision.id];
    if (entry.provenance === "default" && canonicalJson(entry.value) !== canonicalJson(interaction.defaultValue)) return [{ code: "provenance_invalid", path: decision.id }];
    return valueIssues(entry.value as ExperienceValue, interaction, decision.id, complete);
  });
}
export async function validateIntakeRequest(value: unknown): Promise<{ request: IntakeRequest; release: CompiledRelease } | null> {
  if (jsonIssues(value).length || !record(value) || !exact(value, ["intentId", "experienceId", "releaseHash", "values"]) || !isIntentId(value.intentId) || typeof value.experienceId !== "string") return null;
  const snapshot = structuredClone(value) as IntakeRequest;
  const release = await registeredExperience(snapshot.experienceId);
  if (!release || snapshot.releaseHash !== release.releaseHash || intakeValueIssues(release, snapshot.values).length) return null;
  return { request: freeze(snapshot), release };
}
export const experienceDraftId = async (ownerId: string, intentId: string) => `experience-draft-${(await digest({ namespace: "experience-intake@1", ownerId, intentId })).slice(7)}`;
async function stableId(draftId: string, slot: string) {
  const hash = (await digest({ draftId, slot })).slice(7);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
// These are text-only musical instructions, not Audio reference assets. The native
// Audio reference/transfer gate stays unchanged and cannot be opted into here.
const kinds: Record<string, BlockKind> = { subject: "subject", character: "subject", object: "subject", claim: "message", evidence: "message", conflict: "action", causality: "action", event: "action", reveal: "message", revealFrame: "composition", composition: "composition", lighting: "lighting", anchor: "composition", camera: "camera", motion: "motion", moment: "direction", energy: "emotion", instrument: "direction", proportions: "scale", surface: "material", knowledge: "direction", tension: "emotion", ending: "direction" };
function decisionText(release: CompiledRelease, id: string, value: ExperienceValue) {
  const interaction = release.interactions[id];
  if (typeof value === "string") {
    const text = interaction.options?.find(item => item.value === value)?.label ?? value.trim();
    const decision = release.definition.decisions.find(item => item.id === id)!;
    return interaction.options ? `${release.copy[decision.labelKey]}: ${id === "knowledge" && text !== "Both" ? "Participant " : ""}${text}` : text;
  }
  if (Array.isArray(value)) return value.map((item, index) => `${index + 1}. ${item.text.trim()}`).join("\n");
  return interaction.fields!.map(field => `${field.label}: ${String(value[field.id]).trim()}`).join("\n");
}
export async function buildExperiencePlan(ownerId: string, request: IntakeRequest, release: CompiledRelease): Promise<ExperiencePlan> {
  request = structuredClone(request);
  if (!isIntentId(request.intentId) || request.releaseHash !== release.releaseHash || intakeValueIssues(release, request.values).length) throw new Error("experience_request_invalid");
  const draftId = await experienceDraftId(ownerId, request.intentId);
  const projectId = await stableId(draftId, "project"), documentId = await stableId(draftId, "document"), title = release.output.label;
  const events: EventInput[] = [
    { type: "ProjectCreated", payload: { project_id: projectId, name: title, state: "active" } },
    { type: "DocumentCreated", payload: { project_id: projectId, document_id: documentId, handle: documentSlug(title), title } },
    { type: "EmptyCanvasChosen", payload: { project_id: projectId, document_id: documentId, source_surface: "experience" } },
  ];
  for (const [index, decision] of release.definition.decisions.entries()) {
    const entry = request.values[decision.id], kind = kinds[decision.id];
    if (!kind) throw new Error("experience_binding_unregistered");
    events.push({ type: "BlockCreated", payload: {
      project_id: projectId, document_id: documentId, block_id: await stableId(draftId, decision.bindingSlot), type: kind,
      handle: `${kind}/experience-${decision.id}`, position: `z${String(index + 1).padStart(4, "0")}`,
      properties: { text: `${release.output.output === "audio" ? `Audio · ${release.interactions[decision.id].options ? "" : `${release.copy[decision.labelKey]}: `}` : ""}${decisionText(release, decision.id, entry.value)}`, subtype: suggestedSubtype(kind), weight: .8,
        authority: entry.provenance === "authored" ? "authored" : "inferred", experience_origin: entry.provenance,
        experience_release: release.releaseHash, experience_binding: decision.bindingSlot,
        // Preserve the typed authored decision as well as its canonical readable context.
        experience_value: structuredClone(entry.value) },
    } });
  }
  events.push({ type: "BlockCreated", payload: { project_id: projectId, document_id: documentId, block_id: await stableId(draftId, "format"), type: "format", handle: "format/experience-deliverable", position: "z0099", properties: { text: release.output.result, subtype: suggestedSubtype("format"), weight: .8, authority: "inferred", experience_origin: "default", experience_release: release.releaseHash } } });
  events.forEach((event, index) => { event.payload.client_event_id = receiptPrefix(draftId) + index; });
  const base = { version: 1 as const, draftId, request, release, streamId: `creative:${ownerId}`, projectId, documentId, title, events };
  return freeze({ ...base, draftHash: await digest(base) });
}
export const experienceDocumentRoute = (plan: Pick<ExperiencePlan, "documentId" | "title">) => withDocumentInRoute("/", plan.documentId, plan.title);

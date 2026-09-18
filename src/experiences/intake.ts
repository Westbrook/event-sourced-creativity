import { readVideoReferenceIntent, type VideoReferenceIntent } from "./video-reference.ts";
import { readVideoReferencePlan, videoReferenceContextProperties, type VideoReferencePlan } from "./video-reference-plan.ts";
import { sceneDecisionText } from "./scene-context.ts";
import { readModel3dReferenceIntent, type Model3dReferenceIntent } from "./model3d-reference.ts";
import { readModel3dReferencePlan, type Model3dReferencePlan } from "./model3d-reference-plan.ts";
import { experienceImageFormat, readExperienceImageRatio } from "./image-ratio.ts";
import { definitions, contextCatalog } from "./catalog.ts";
import { canonicalJson, compileExperience, digest, freeze, jsonIssues, own, valueIssues } from "./compiler.ts";
import type { CompiledRelease, DecisionValue, ExperienceValue, OutputKind } from "./contracts.ts";
type EventInput = { type: string; payload: Record<string, unknown>; compensatesEventId?: string | null };
// Bounded current canonical defaults; no full application model graph is loaded.
const subtypes = { subject: "Hero subject", message: "Single proposition", composition: "Focal hierarchy", lighting: "Direction", format: "Aspect ratio", direction: "Behavioral objective", action: "Individual action", emotion: "Primary affect", environment: "Social setting" } as const;
type BlockKind = keyof typeof subtypes;
const suggestedSubtype = (kind: BlockKind) => subtypes[kind];
const documentSlug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64);

export type ExperienceReferenceIntent = Model3dReferenceIntent | VideoReferenceIntent;
export type ExperienceReferencePlan = Model3dReferencePlan | VideoReferencePlan;
export const readExperienceReferenceIntent = (output: string, value: unknown): ExperienceReferenceIntent | null => output === "video" ? readVideoReferenceIntent(value) : output === "model3d" ? readModel3dReferenceIntent(value) : null;
export type IntakeRequest = Readonly<{ intentId: string; experienceId: string; releaseHash: string; values: Readonly<Record<string, DecisionValue>>; reference?: ExperienceReferenceIntent }>;
export type ExperiencePlan = Readonly<{
  version: 1; draftId: string; request: IntakeRequest; release: CompiledRelease;
  streamId: string; projectId: string; documentId: string; title: string; events: readonly EventInput[]; draftHash: string; reference?: ExperienceReferencePlan;
}>;
export const experienceIds = definitions.map(item => item.id);
/** Context authoring only. Native admission has its own narrower allowlist. */
export const isExperienceContextOutput = (value: unknown): value is OutputKind => value === "image" || value === "slides" || value === "short_story" || value === "scene" || value === "model3d" || value === "storyboard" || value === "audio" || value === "video";
export const isIntentId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
export const isDraftId = (value: string) => /^experience-draft-[a-f0-9]{64}$/u.test(value);
export const receiptPrefix = (draftId: string) => `experience-intake:v1:${draftId}:`;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => own(value, key));

// This allowlist qualifies context authoring only, never an output provider or spend.
export async function registeredExperience(id: string) {
  const definition = definitions.find(item => item.id === id);
  if (!definition) return null;
  const result = await compileExperience(definition, contextCatalog);
  return result.ok ? result.release : null;
}
export const initialValues = (release: CompiledRelease): Record<string, DecisionValue> => Object.fromEntries(release.definition.decisions.map(decision => [decision.id, { value: structuredClone(release.interactions[decision.id].defaultValue), provenance: "default" }]));
export function intakeValueIssues(release: CompiledRelease, values: unknown, complete = true) {
  if (jsonIssues(values).length || !record(values) || !exact(values, release.definition.decisions.map(decision => decision.id))) return [{ code: "values_invalid", path: "$" }];
  return release.definition.decisions.flatMap(decision => {
    const entry = values[decision.id];
    if (!record(entry) || !exact(entry, ["value", "provenance"]) || !["default", "authored"].includes(String(entry.provenance))) return [{ code: "value_invalid", path: decision.id }];
    const interaction = release.interactions[decision.id];
    if (complete && interaction.kind === "ratio" && entry.provenance !== "authored") return [{ code: "required", path: decision.id }];
    if (entry.provenance === "default" && canonicalJson(entry.value) !== canonicalJson(interaction.defaultValue)) return [{ code: "provenance_invalid", path: decision.id }];
    return valueIssues(entry.value as ExperienceValue, interaction, decision.id, complete);
  });
}
export async function validateIntakeRequest(value: unknown): Promise<{ request: IntakeRequest; release: CompiledRelease } | null> {
  if (jsonIssues(value).length || !record(value) || !exact(value, ["intentId", "experienceId", "releaseHash", "values", ...(own(value, "reference") ? ["reference"] : [])]) || !isIntentId(value.intentId) || typeof value.experienceId !== "string") return null;
  if (value.experienceId === "video" && !own(value, "reference") || own(value, "reference") && !readExperienceReferenceIntent(value.experienceId, value.reference)) return null;
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
export { stableId as experienceResourceId };
const kinds: Record<string, BlockKind> = { motion: "direction", frame: "format", story: "message", subject: "subject", direction: "direction", claim: "message", evidence: "message", composition: "composition", lighting: "lighting", ratio: "format", character: "subject", goal: "direction", obstacle: "message", decision: "action", ending: "emotion", detail: "subject", characterA: "subject", characterB: "subject", goalA: "direction", goalB: "direction", secret: "message", knowledge: "message", location: "environment", tension: "emotion" };
function decisionText(release: CompiledRelease, id: string, value: ExperienceValue) {
  const interaction = release.interactions[id];
  if (interaction.kind === "ratio") {
    const ratio = readExperienceImageRatio(value);
    if (!ratio) throw new Error("experience_ratio_required");
    return `Ratio: ${ratio.width}:${ratio.height}`;
  }
  if (typeof value === "string") {
    const text = interaction.options?.find(item => item.value === value)?.label ?? value.trim();
    const decision = release.definition.decisions.find(item => item.id === id)!;
    return interaction.options ? `${release.copy[decision.labelKey]}: ${text}` : text;
  }
  if (Array.isArray(value)) return value.map((item, index) => `${index + 1}. ${item.text.trim()}`).join("\n");
  return interaction.fields!.map(field => `${field.label}: ${String(value[field.id]).trim()}`).join("\n");
}
export async function buildExperiencePlan(ownerId: string, request: IntakeRequest, release: CompiledRelease, referenceValue?: ExperienceReferencePlan): Promise<ExperiencePlan> {
  request = structuredClone(request);
  // Identity controls are intentionally rejected, including ASCII C0 and DEL.
  // eslint-disable-next-line no-control-regex
  if (!ownerId || ownerId.trim() !== ownerId || ownerId.length > 240 || /[\u0000-\u001f\u007f]/u.test(ownerId)) throw new Error("experience_owner_invalid");
  if (request.experienceId !== release.definition.id || !isIntentId(request.intentId) || request.releaseHash !== release.releaseHash || intakeValueIssues(release, request.values).length) throw new Error("experience_request_invalid");
  const videoReference = release.output.output === "video" ? readVideoReferencePlan(referenceValue, request.reference) : null;
  const reference = release.output.output === "video" ? videoReference : release.output.output === "model3d" && request.reference ? readModel3dReferencePlan(referenceValue, request.reference) : null;
  if (release.output.output === "video" && !videoReference || request.reference && !reference || !request.reference && referenceValue !== undefined) throw new Error("experience_reference_invalid");
  const draftId = await experienceDraftId(ownerId, request.intentId);
  const projectId = await stableId(draftId, "project"), documentId = await stableId(draftId, "document"), title = release.output.label;
  const events: EventInput[] = [
    { type: "ProjectCreated", payload: { project_id: projectId, name: title, state: "active" } },
    { type: "DocumentCreated", payload: { project_id: projectId, document_id: documentId, handle: documentSlug(title), title } },
    { type: "EmptyCanvasChosen", payload: { project_id: projectId, document_id: documentId, source_surface: "experience" } },
  ];
  for (const [index, decision] of release.definition.decisions.entries()) {
    const entry = request.values[decision.id], kind = release.output.output === "audio" ? "direction" : kinds[decision.id];
    if (!kind) throw new Error("experience_binding_unregistered");
    const interaction = release.interactions[decision.id];
    if (!interaction.required && typeof entry.value === "string" && !entry.value.trim()) continue;
    events.push({ type: "BlockCreated", payload: {
      project_id: projectId, document_id: documentId, block_id: await stableId(draftId, decision.bindingSlot), type: kind,
      handle: `${kind}/experience-${decision.id}`, position: `z${String(index + 1).padStart(4, "0")}`,
      properties: { text: release.output.output === "scene" ? sceneDecisionText(request.values, decision.id, decisionText(release, decision.id, entry.value)) : decisionText(release, decision.id, entry.value), subtype: release.output.output === "scene" && ["secret", "knowledge"].includes(decision.id) ? "Subtext" : (release.output.output === "short_story" && decision.id === "obstacle" || release.output.output === "storyboard" && decision.id === "story") ? "Narrative beat" : release.output.output === "short_story" && decision.id === "detail" ? "Supporting subject" : suggestedSubtype(kind), weight: .8,
        authority: entry.provenance === "authored" ? "authored" : "inferred", experience_origin: entry.provenance,
        experience_release: release.releaseHash, experience_binding: decision.bindingSlot,
        // Preserve the typed authored decision as well as its canonical readable context.
        experience_value: structuredClone(entry.value),
        ...(release.output.output === "video" && decision.id === "frame" ? { video_frame_size: entry.value === "portrait" ? "720x1280" : "1280x720" } : {}),
        ...(decision.id === "ratio" ? { image_format: experienceImageFormat(entry.value) } : {}) },
    } });
  }
  events.push({ type: "BlockCreated", payload: { project_id: projectId, document_id: documentId, block_id: await stableId(draftId, "format"), type: "format", handle: "format/experience-deliverable", position: "z0099", properties: { text: release.output.result + (release.output.output === "short_story" ? "\nFiction" : release.output.output === "scene" ? "\nScreenplay · Action and dialogue\n1–2 pages" : release.output.output === "audio" ? "\nInstrumental only · no lyrics or spoken voice\n20-second target; duration is not measured" : ""), ...(release.output.output === "video" ? { experience_video_intent: structuredClone(release.output.videoIntent) } : {}), ...(release.output.output === "audio" ? { experience_audio_intent: structuredClone(release.output.audioIntent) } : {}), subtype: ["short_story", "scene", "storyboard", "audio", "video"].includes(release.output.output) ? "Channel" : suggestedSubtype("format"), weight: .8, authority: "inferred", experience_origin: "default", experience_release: release.releaseHash } } });
  if (reference) events.push({ type: "BlockCreated", payload: {
    project_id: projectId, document_id: documentId, block_id: await stableId(draftId, videoReference ? "video-reference" : "model3d-reference"),
    type: "kind" in reference.selection && reference.selection.kind === "saved-model-view" ? "model3d" : "reference", scope: "document",
    handle: videoReference ? "reference/experience-video" : "reference/experience-model3d", position: "z0098",
    // Existing reference/model identities and all authored derivation fields survive.
    // This is not an ingestion or a newly asserted rights receipt.
    properties: videoReference ? videoReferenceContextProperties(videoReference) : { ...structuredClone(reference.properties), experience_reference_source: {
      project_id: reference.selection.sourceProjectId, document_id: reference.selection.sourceDocumentId,
      block_id: reference.selection.sourceBlockId, source_digest: reference.sourceDigest,
    } },
  } });
  events.forEach((event, index) => { event.payload.client_event_id = receiptPrefix(draftId) + index; });
  const base = { version: 1 as const, draftId, request, release, streamId: `creative:${ownerId}`, projectId, documentId, title, events, ...(reference ? { reference } : {}) };
  return freeze({ ...base, draftHash: await digest(base) });
}
export const experienceDocumentRoute = (plan: Pick<ExperiencePlan, "documentId" | "title">) => `/document/${encodeURIComponent(plan.documentId)}/${documentSlug(plan.title)}`;

/** Closed entry selectors. Invalid/ambiguous recovery never silently starts a new draft. */
export function parseExperienceEntryRoute(url: URL): Readonly<{ output?: "image" | "slides" | "short-story" | "scene" | "model3d" | "storyboard" | "audio" | "video"; draftId?: string; intentId?: string }> | null {
  const match = /^\/experiences(?:\/(image|slides|short-story|scene|model3d|storyboard|audio|video))?\/?$/u.exec(url.pathname);
  const allowed = new Set(["draft", "intent", "progress-report"]);
  if (!match || url.hash || [...url.searchParams.keys()].some(key => !allowed.has(key)) || [...allowed].some(key => url.searchParams.getAll(key).length > 1)) return null;
  const draftId = url.searchParams.get("draft"), intentId = url.searchParams.get("intent");
  if (draftId !== null && !isDraftId(draftId) || intentId !== null && !isIntentId(intentId) || draftId !== null && intentId !== null || !match[1] && (draftId !== null || intentId !== null)) return null;
  return Object.freeze({ ...(match[1] ? { output: match[1] as "image" | "slides" | "short-story" | "scene" | "model3d" | "storyboard" | "audio" | "video" } : {}), ...(draftId ? { draftId } : {}), ...(intentId ? { intentId } : {}) });
}

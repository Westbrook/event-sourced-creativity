import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { buildExperiencePlan, validateIntakeRequest, type ExperiencePlan } from "./intake.ts";
import type { ExperienceValue, OutputKind } from "./contracts.ts";
import type { AudioRequestProfile } from "../model/audio.ts";
import { DEFAULT_MODEL3D_SETTINGS, validateModel3dRequest, type Model3dSettings } from "../model/model3d.ts";
import type { SlideCountPolicy } from "../model/presentation-count-policy.ts";
import { normalizePromptTechnique, type PromptTechnique } from "../model/prompt-structures.ts";
import { VIDEO_ADAPTER_CONTRACT, type VideoAudioMode } from "../model/video-adapter.ts";

export const EXPERIENCE_GENERATION_VERSION = "experience-generation@1" as const;
type CommonPayload = { productionMode: "manual"; locale: "en"; requestKey: string };
type PayloadByOutput = {
  image: CommonPayload & { promptTechnique: PromptTechnique };
  short_story: CommonPayload & { artifactKind: "short_story"; itemCount: 1 };
  scene: CommonPayload & { artifactKind: "scene"; itemCount: 1; sceneMedium: "visual" };
  slides: CommonPayload & { artifactKind: "slides"; itemCount: 5; requestedSlideCount: 5; slideCountPolicy: SlideCountPolicy; presentationFidelity: "faithful" };
  storyboard: CommonPayload & { artifactKind: "storyboard"; itemCount: 4 };
  video: CommonPayload & { artifactKind: "video"; videoSeconds: 4; videoAudioMode: VideoAudioMode };
  audio: CommonPayload & { artifactKind: "audio"; audioProfile: AudioRequestProfile };
  model3d: CommonPayload & { artifactKind: "model3d"; itemCount: 1; model3dPrompt: string; model3dSettings: Model3dSettings; model3dReferenceBlockIds: string[] };
};
type GenerationRequest = {
  [K in OutputKind]: Readonly<{ output: K; kind: K extends "image" ? "generate" : "render_document"; payload: Readonly<PayloadByOutput[K]> }>
}[OutputKind];
type ContractIdentity = Readonly<{
  version: typeof EXPERIENCE_GENERATION_VERSION; qualification: "settings-only"; ownerId: string; streamId: string;
  draftId: string; draftHash: string; releaseHash: string; documentId: string; projectId: string;
  generationIntentId: string; sourceSurface: "experience"; contractHash: string;
}>;
export type ExperienceGenerationContract = ContractIdentity & GenerationRequest;
export type ExperienceGenerationBinding = ContractIdentity & Readonly<{ kind: GenerationRequest["kind"]; output: OutputKind }>;

function invalid(): never { throw new Error("experience_generation_contract_invalid"); }
const ownerValid = (ownerId: unknown): ownerId is string => typeof ownerId === "string" && Boolean(ownerId.trim())
  && ownerId === ownerId.trim() && ownerId.length <= 240
  && !Array.from(ownerId).some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);

async function deriveGenerationIntentId(ownerId: string, plan: ExperiencePlan) {
  const hash = (await digest({ namespace: EXPERIENCE_GENERATION_VERSION, ownerId, draftId: plan.draftId,
    draftHash: plan.draftHash, releaseHash: plan.release.releaseHash, intentId: plan.request.intentId })).slice(7);
  // UUIDv8 identifies the settings intent only. Native Output authorization
  // chooses the actual grant, slot, and job IDs; this value is never a job ID.
  const variant = (8 + Number.parseInt(hash[16]!, 16) % 4).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function model3dPrompt(plan: ExperiencePlan) {
  return plan.release.definition.decisions.map(decision => {
    const interaction = plan.release.interactions[decision.id];
    const value: ExperienceValue = plan.request.values[decision.id].value;
    const label = plan.release.copy[decision.labelKey];
    if (typeof value === "string") return `${label}: ${interaction.options?.find(option => option.value === value)?.label ?? value}`;
    if (Array.isArray(value) || !interaction.fields) return invalid();
    // Registered field order, not object-key order; preserve authored text unchanged.
    return `${label}:\n${interaction.fields.map(field => `${field.label}: ${value[field.id]}`).join("\n")}`;
  }).join("\n");
}

function generationRequest(plan: ExperiencePlan, generationIntentId: string): GenerationRequest {
  const common: CommonPayload = { productionMode: "manual", locale: "en", requestKey: `${EXPERIENCE_GENERATION_VERSION}:${generationIntentId}` };
  const output = plan.release.output.output;
  switch (output) {
    case "image": return { output, kind: "generate", payload: { ...common, promptTechnique: normalizePromptTechnique(undefined) } };
    case "short_story": return { output, kind: "render_document", payload: { ...common, artifactKind: output, itemCount: 1 } };
    case "scene": return { output, kind: "render_document", payload: { ...common, artifactKind: output, itemCount: 1, sceneMedium: "visual" } };
    case "slides": return { output, kind: "render_document", payload: { ...common, artifactKind: output, itemCount: 5, requestedSlideCount: 5,
      slideCountPolicy: { kind: "exact", unit: "slide", value: 5 }, presentationFidelity: "faithful" } };
    case "storyboard": return { output, kind: "render_document", payload: { ...common, artifactKind: output, itemCount: 4 } };
    case "video": return { output, kind: "render_document", payload: { ...common, artifactKind: output, videoSeconds: 4, videoAudioMode: VIDEO_ADAPTER_CONTRACT.defaultAudioMode } };
    case "audio": return { output, kind: "render_document", payload: { ...common, artifactKind: output,
      audioProfile: { role: "score", goal: "music", destination: "standalone", requireInstrumental: true } } };
    case "model3d": {
      const prompt = model3dPrompt(plan), settings = structuredClone(DEFAULT_MODEL3D_SETTINGS);
      const checked = validateModel3dRequest({ prompt, settings, referenceCount: 0, mode: "text" });
      if (!checked.valid || settings.geometry_file_format !== "glb") return invalid();
      return { output, kind: "render_document", payload: { ...common, artifactKind: output, itemCount: 1,
        model3dPrompt: prompt, model3dSettings: checked.settings, model3dReferenceBlockIds: [] } };
    }
  }
}

/** Pure server-owned settings/identity draft, not an adapter qualification, admission,
 * consent, provider/cost route proof, or execution grant. Mapping a registered format
 * never qualifies it for the native Output execution protocol.
 * The caller must independently prove retained custody and unchanged canonical source
 * at final insertion. Never compile a caller-selected owner or substitute this for it. */
export async function compileExperienceGeneration(ownerId: string, value: unknown): Promise<ExperienceGenerationContract> {
  if (!ownerValid(ownerId) || jsonIssues(value).length || !record(value)) return invalid();
  const snapshot = structuredClone(value);
  const validated = await validateIntakeRequest(snapshot.request);
  if (!validated) return invalid();
  // A supplied, self-consistent hash is not authority. Rebuild the complete current
  // registered plan to verify release, identities, bindings, values, and native events.
  const plan = await buildExperiencePlan(ownerId, validated.request, validated.release);
  if (canonicalJson(snapshot) !== canonicalJson(plan)) return invalid();
  const generationIntentId = await deriveGenerationIntentId(ownerId, plan);
  const base = { version: EXPERIENCE_GENERATION_VERSION, qualification: "settings-only" as const, ownerId, streamId: plan.streamId,
    draftId: plan.draftId, draftHash: plan.draftHash, releaseHash: plan.release.releaseHash,
    documentId: plan.documentId, projectId: plan.projectId, generationIntentId, sourceSurface: "experience" as const,
    ...generationRequest(plan, generationIntentId) };
  return freeze({ ...base, contractHash: await digest(base) });
}

const bindingKeys = ["version", "qualification", "ownerId", "streamId", "draftId", "draftHash", "releaseHash", "documentId", "projectId", "generationIntentId", "kind", "output", "sourceSurface", "contractHash"] as const;
/** Settings-intent identity only; no source text, approval, native slot, or job ID. */
export function experienceGenerationBinding(contract: ExperienceGenerationContract): ExperienceGenerationBinding {
  return freeze({ version: contract.version, qualification: contract.qualification, ownerId: contract.ownerId, streamId: contract.streamId,
    draftId: contract.draftId, draftHash: contract.draftHash, releaseHash: contract.releaseHash,
    documentId: contract.documentId, projectId: contract.projectId, generationIntentId: contract.generationIntentId,
    kind: contract.kind, output: contract.output, sourceSurface: contract.sourceSurface, contractHash: contract.contractHash });
}

/** Compare with a server-recompiled contract, never with an expected contract from
 * the request. Native slot/job ownership belongs to the separate authorized Output layer. */
export function experienceGenerationBindingMatches(ownerId: string, expected: ExperienceGenerationContract, candidate: unknown): candidate is ExperienceGenerationBinding {
  if (!ownerValid(ownerId) || expected.ownerId !== ownerId || expected.streamId !== `creative:${ownerId}`
    || jsonIssues(candidate).length || !record(candidate) || !exactKeys(candidate, bindingKeys)) return false;
  return bindingKeys.every(key => candidate[key] === expected[key]);
}

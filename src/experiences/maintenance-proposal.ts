import type { Catalog, CompiledRelease } from "./contracts.ts";
import type { ExperienceMaterialSelection } from "./release-contract.ts";
import type { ExperiencePatch, SemanticDiff } from "./patches.ts";
import { canonicalJson, compileExperience, digest, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { compareReleases, proposePatch } from "./patches.ts";

const sourcePaths = ["src/model/model3d.ts", "src/model/model3d-prompt-adapter.ts", "src/experiences/results/registry.ts"] as const;
const observedKeys = ["adapterVersion", "promptAdapterVersion", "textModel", "imageModel", "promptMaxChars", "maxImageReferences", "privateTransferMaxBytes", "formats", "formatMimeTypes", "tiers", "materials", "qualityMeshOptions", "textureModes", "imageMimeTypes", "settingsDefaults", "viewer"] as const;
const selectionKeys = ["releaseHash", "sourceHash", "buildHash", "evaluationHash"] as const;
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
const label = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 64 && value.every(label) && new Set(value).size === value.length;
function settings(value: unknown, observed: Record<string, unknown>) {
  const booleans = ["enable_creative_mode", "hd_texture", "texture_delight", "is_micro", "TAPose", "use_original_alpha", "preview_render"];
  const enums = { tier: "tiers", geometry_file_format: "formats", material: "materials", quality_mesh_option: "qualityMeshOptions", texture_mode: "textureModes" };
  if (!record(value) || !exactKeys(value, [...Object.keys(enums), ...booleans, "seed", "bbox_condition", "addons"])) return false;
  if (booleans.some(key => typeof value[key] !== "boolean") || Object.entries(enums).some(([key, options]) => typeof value[key] !== "string" || !(observed[options] as string[]).includes(value[key]))) return false;
  if (value.seed !== null && (!Number.isSafeInteger(value.seed) || Number(value.seed) < 0 || Number(value.seed) > 65535)) return false;
  if (!record(value.addons) || !exactKeys(value.addons, ["high_pack"]) || typeof value.addons.high_pack !== "boolean") return false;
  return value.bbox_condition === null || record(value.bbox_condition) && exactKeys(value.bbox_condition, ["width", "height", "length"])
    && Object.values(value.bbox_condition).every(item => positive(item) && Number(item) <= 2048);
}
function snapshot(raw: unknown, limit: number): unknown | null {
  if (jsonIssues(raw).length) return null;
  const copy: unknown = structuredClone(raw);
  return new TextEncoder().encode(canonicalJson(copy)).length <= limit ? copy : null;
}
function selection(raw: unknown): raw is ExperienceMaterialSelection {
  return record(raw) && exactKeys(raw, selectionKeys) && selectionKeys.every(key => hash(raw[key]));
}

export type ExperienceContractObservation = Readonly<{
  version: 1;
  scope: "main-app-code-declarations";
  output: "model3d";
  generationAvailable: false;
  sources: readonly Readonly<{ path: typeof sourcePaths[number]; bytes: number; hash: string }>[];
  observed: Readonly<Record<typeof observedKeys[number], unknown>>;
  observationHash: string;
}>;

/** Consistency parser only. A matching hash is not provenance or provider validation.
 * The caller must retain and supply captures from the fixed local capture command. */
export async function readExperienceContractObservation(raw: unknown): Promise<ExperienceContractObservation | null> {
  const value = snapshot(raw, 32768);
  if (!record(value) || !exactKeys(value, ["version", "scope", "output", "generationAvailable", "sources", "observed", "observationHash"])
    || value.version !== 1 || value.scope !== "main-app-code-declarations" || value.output !== "model3d" || value.generationAvailable !== false || !hash(value.observationHash)) return null;
  if (!Array.isArray(value.sources) || value.sources.length !== sourcePaths.length || value.sources.some((item, index) => !record(item)
    || !exactKeys(item, ["path", "bytes", "hash"]) || item.path !== sourcePaths[index] || !positive(item.bytes) || Number(item.bytes) > 262144 || !hash(item.hash))) return null;
  const observed = value.observed;
  if (!record(observed) || !exactKeys(observed, observedKeys)) return null;
  for (const key of ["adapterVersion", "promptAdapterVersion", "textModel", "imageModel"]) if (!label(observed[key])) return null;
  for (const key of ["promptMaxChars", "maxImageReferences", "privateTransferMaxBytes"]) if (!positive(observed[key])) return null;
  for (const key of ["formats", "tiers", "materials", "qualityMeshOptions", "textureModes", "imageMimeTypes"]) if (!strings(observed[key])) return null;
  if (!record(observed.formatMimeTypes) || !exactKeys(observed.formatMimeTypes, observed.formats as string[]) || !Object.values(observed.formatMimeTypes).every(label) || !settings(observed.settingsDefaults, observed)) return null;
  const viewer = observed.viewer;
  if (!record(viewer) || !exactKeys(viewer, ["id", "output", "dtoVersion", "contractRevision", "activation", "qualification"])
    || !label(viewer.id) || viewer.output !== "model3d" || !positive(viewer.dtoVersion) || !positive(viewer.contractRevision)
    || typeof viewer.activation !== "string" || !["ready-result", "explicit-user"].includes(viewer.activation) || viewer.qualification !== "fixture-only") return null;
  const { observationHash, ...body } = value;
  return await digest(body) === observationHash ? freeze(value as ExperienceContractObservation) : null;
}

export type ExperienceMaintenanceRequest = Readonly<{
  version: 1;
  base: ExperienceMaterialSelection;
  baselineObservationHash: string;
  currentObservationHash: string;
  patch: ExperiencePatch | null;
}>;
/** Code-owned caller context, not an HTTP/body envelope. material must come from
 * the existing trusted-material resolver; catalog must be its matching supplier.
 * Baseline is an explicitly retained capture, never reconstructed from releaseHash.
 * This library introduces no storage, approval, registration, or authority. */
export type ExperienceMaintenanceContext = Readonly<{
  material: Readonly<{ selection: ExperienceMaterialSelection; release: CompiledRelease }>;
  catalog: Catalog;
  baseline: ExperienceContractObservation;
  current: ExperienceContractObservation;
}>;
type Bound = Readonly<{
  version: 1; qualification: "fixture"; generationAvailable: false; canPublish: false;
  base: ExperienceMaterialSelection; baselineObservationHash: string; currentObservationHash: string;
}>;
export type ExperienceMaintenanceResult =
  | { ok: false; code: string }
  | (Bound & { ok: true; status: "compatibility-review"; sourceChanges: readonly string[]; contractChanges: readonly string[] })
  | (Bound & { ok: true; status: "unchanged"; diff: SemanticDiff })
  | (Bound & { ok: true; status: "proposal"; candidate: CompiledRelease; diff: SemanticDiff;
      previewRequest: Readonly<{ version: 1; base: ExperienceMaterialSelection; patch: ExperiencePatch }> });

/** Binds an explicitly authored, bounded typed edit. Text, API docs, approval/test
 * claims and provider instructions are not inputs. Results remain preview-only.
 * All caller objects are copied before the first await, including the catalog. */
export async function bindExperienceMaintenanceProposal(raw: unknown, supplied: ExperienceMaintenanceContext): Promise<ExperienceMaintenanceResult> {
  const invalid = (code: string): ExperienceMaintenanceResult => ({ ok: false, code });
  const request = snapshot(raw, 32768);
  const captured = snapshot(supplied, 196608);
  if (!record(request) || !exactKeys(request, ["version", "base", "baselineObservationHash", "currentObservationHash", "patch"])
    || request.version !== 1 || !selection(request.base) || !hash(request.baselineObservationHash) || !hash(request.currentObservationHash)) return invalid("maintenance_request");
  if (!record(captured) || !exactKeys(captured, ["material", "catalog", "baseline", "current"]) || !record(captured.material)
    || !exactKeys(captured.material, ["selection", "release"]) || !selection(captured.material.selection) || !record(captured.material.release) || !record(captured.catalog)) return invalid("maintenance_context");
  const catalog = captured.catalog;
  if (!exactKeys(catalog, ["version", "qualification", "outputs", "interactions", "copy"]) || catalog.version !== "forma-experience-fixture@1" || catalog.qualification !== "fixture"
    || !record(catalog.outputs) || !record(catalog.interactions) || !record(catalog.copy)) return invalid("maintenance_context");
  if (canonicalJson(request.base) !== canonicalJson(captured.material.selection)) return invalid("maintenance_base");
  const context = captured as unknown as ExperienceMaintenanceContext;
  const baseline = await readExperienceContractObservation(context.baseline);
  const current = await readExperienceContractObservation(context.current);
  if (!baseline || !current) return invalid("maintenance_observation");
  if (baseline.observationHash !== request.baselineObservationHash || current.observationHash !== request.currentObservationHash) return invalid("maintenance_observation_pin");
  let checked: Awaited<ReturnType<typeof compileExperience>>;
  try { checked = await compileExperience(context.material.release.definition, context.catalog); }
  // The existing compiler trusts its Catalog; an execution failure is distinct
  // from a mismatched material or ordinary raw-request refusal. No candidate escapes.
  catch { return invalid("maintenance_compilation_unavailable"); }
  if (!checked.ok || checked.release.output.output !== "model3d" || checked.release.releaseHash !== request.base.releaseHash
    || canonicalJson(checked.release) !== canonicalJson(context.material.release)) return invalid("maintenance_material");
  // Validate an offered patch even if drift will prevent offering its candidate.
  let proposed: Awaited<ReturnType<typeof proposePatch>> | null;
  try { proposed = request.patch === null ? null : await proposePatch(checked.release, request.patch, context.catalog); }
  catch { return invalid("maintenance_compilation_unavailable"); }
  if (proposed && !proposed.ok) return invalid("maintenance_patch");
  const bound: Bound = { version: 1, qualification: "fixture", generationAvailable: false, canPublish: false,
    base: request.base, baselineObservationHash: baseline.observationHash, currentObservationHash: current.observationHash };
  const sourceChanges = sourcePaths.filter((_, index) => canonicalJson(baseline.sources[index]) !== canonicalJson(current.sources[index]));
  const contractChanges = observedKeys.filter(key => canonicalJson(baseline.observed[key]) !== canonicalJson(current.observed[key]));
  if (sourceChanges.length || contractChanges.length) return freeze({ ok: true, ...bound, status: "compatibility-review", sourceChanges, contractChanges });
  if (!proposed || !proposed.ok) return freeze({ ok: true, ...bound, status: "unchanged", diff: { risk: "none", changed: [] } });
  const diff = compareReleases(checked.release, proposed.candidate);
  if (diff.risk === "semantic") return invalid("maintenance_semantic_patch");
  if (diff.risk === "none") return freeze({ ok: true, ...bound, status: "unchanged", diff });
  return freeze({ ok: true, ...bound, status: "proposal", candidate: proposed.candidate, diff,
    previewRequest: { version: 1, base: request.base, patch: request.patch as ExperiencePatch } });
}


// Code-owned fixed projections. Unsupported entries name omitted behavior, not failed executions.
const v2Projections = {
  image: {
    paths: ["src/model/image-format.ts", "worker/fal-image-adapter.ts", "worker/output-image-budget.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["formatPresets", "src/model/image-format.ts", "IMAGE_FORMAT_PRESETS", null],
      ["sizeConstraints", "src/model/image-format.ts", "PROVIDER_IMAGE_SIZE_CONSTRAINTS", null],
      ["adapterId", "worker/fal-image-adapter.ts", "FAL_IDEOGRAM_ADAPTER_ID", null],
      ["adapterVersion", "worker/fal-image-adapter.ts", "FAL_IDEOGRAM_ADAPTER_VERSION", null],
      ["referenceStrengths", "worker/fal-image-adapter.ts", "FAL_IDEOGRAM_REFERENCE_STRENGTHS", null],
      ["promptMaxBytes", "worker/output-image-budget.ts", "OUTPUT_IMAGE_MAX_PROMPT_BYTES", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "image"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-routing-and-budget"],
  },
  short_story: {
    paths: ["src/model/native-short-story-generation.ts", "src/model/retained-short-story.ts", "src/model/document-artifacts.ts", "worker/openai-adapter.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["completionMaxBytes", "src/model/native-short-story-generation.ts", "NATIVE_STORY_COMPLETION_MAX_BYTES", null],
      ["retainedJsonMaxBytes", "src/model/retained-short-story.ts", "RETAINED_STORY_JSON_MAX_BYTES", null],
      ["retainedMarkdownMaxBytes", "src/model/retained-short-story.ts", "RETAINED_STORY_MARKDOWN_MAX_BYTES", null],
      ["retainedTitleMaxBytes", "src/model/retained-short-story.ts", "RETAINED_STORY_TITLE_MAX_BYTES", null],
      ["retainedRoute", "src/model/retained-short-story.ts", "RETAINED_STORY_ROUTE", null],
      ["artifactKinds", "src/model/document-artifacts.ts", "DOCUMENT_ARTIFACT_KINDS", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "short_story"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-story-dto", "function-produced-documentArtifactSchema"],
  },
  scene: {
    paths: ["src/model/scene-configuration.ts", "src/model/document-artifacts.ts", "worker/openai-adapter.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["media", "src/model/scene-configuration.ts", "SCENE_MEDIA", null],
      ["artifactKinds", "src/model/document-artifacts.ts", "DOCUMENT_ARTIFACT_KINDS", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "scene"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-scene-configuration", "function-produced-documentArtifactSchema"],
  },
  slides: {
    paths: ["src/model/document-artifacts.ts", "src/model/presentation-count-policy.ts", "src/model/managed-production.ts", "worker/presentation-model-routing.ts", "worker/openai-adapter.ts", "src/model/presentation-source.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["layouts", "src/model/document-artifacts.ts", "SLIDE_LAYOUTS", null],
      ["visualKinds", "src/model/document-artifacts.ts", "SLIDE_VISUAL_KINDS", null],
      ["maxVisualDataPoints", "src/model/document-artifacts.ts", "MAX_SLIDE_VISUAL_DATA_POINTS", null],
      ["stylePresetIds", "src/model/document-artifacts.ts", "SLIDE_STYLE_PRESET_IDS", null],
      ["stylePresets", "src/model/document-artifacts.ts", "SLIDE_STYLE_PRESETS", null],
      ["manualSlideLimit", "src/model/presentation-count-policy.ts", "MAX_MANUAL_PRESENTATION_SLIDES", null],
      ["managedSlideLimit", "src/model/managed-production.ts", "MAX_MANAGED_PRESENTATION_SLIDES", null],
      ["managedBatchSize", "src/model/managed-production.ts", "MANAGED_PRODUCTION_BATCH_SIZE", null],
      ["routingVersion", "worker/presentation-model-routing.ts", "PRESENTATION_MODEL_ROUTING_VERSION", null],
      ["textModels", "worker/presentation-model-routing.ts", "PRESENTATION_TEXT_MODELS", null],
      ["reasoningEfforts", "worker/presentation-model-routing.ts", "PRESENTATION_REASONING_EFFORTS", null],
      ["adapterVersion", "worker/openai-adapter.ts", "PRESENTATION_ADAPTER_VERSION", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "slides"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-documentArtifactSchema", "function-produced-presentation-source-contract", "managed-flexible-count"],
  },
  storyboard: {
    paths: ["src/model/document-artifacts.ts", "src/model/managed-production.ts", "worker/managed-production.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["artifactKinds", "src/model/document-artifacts.ts", "DOCUMENT_ARTIFACT_KINDS", null],
      ["productionBatchSize", "src/model/managed-production.ts", "MANAGED_PRODUCTION_BATCH_SIZE", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "storyboard"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-managed-storyboard-stages", "function-produced-shared-artifact-and-frame-receipts"],
  },
  video: {
    paths: ["src/model/video-adapter.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["adapterContract", "src/model/video-adapter.ts", "VIDEO_ADAPTER_CONTRACT", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "video"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-video-normalization"],
  },
  audio: {
    paths: ["src/model/audio.ts", "src/model/audio-provider-contracts.ts", "worker/audio-selection.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["generationGoals", "src/model/audio.ts", "AUDIO_GENERATION_GOALS", null],
      ["destinations", "src/model/audio.ts", "AUDIO_DESTINATIONS", null],
      ["commonAdapter", "src/model/audio.ts", "commonAudioAdapter", null],
      ["videoReferenceContract", "src/model/audio.ts", "VIDEO_AUDIO_REFERENCE_CONTRACT", null],
      ["providerInputContracts", "src/model/audio-provider-contracts.ts", "AUDIO_PROVIDER_INPUT_CONTRACTS", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "audio"],
    ],
    unsupported: ["runtime-provider-selection", "imported-full-audio-adapter-registry", "function-produced-audio-selection-and-pricing"],
  },
  model3d: {
    paths: ["src/model/model3d.ts", "src/model/model3d-prompt-adapter.ts", "src/experiences/results/registry.ts"],
    roots: [
      ["adapterVersion", "src/model/model3d.ts", "RODIN_ADAPTER_VERSION", null],
      ["textModel", "src/model/model3d.ts", "RODIN_TEXT_MODEL", null],
      ["imageModel", "src/model/model3d.ts", "RODIN_IMAGE_MODEL", null],
      ["promptMaxChars", "src/model/model3d.ts", "RODIN_PROMPT_MAX_CHARS", null],
      ["maxImageReferences", "src/model/model3d.ts", "RODIN_MAX_IMAGE_REFERENCES", null],
      ["privateTransferMaxBytes", "src/model/model3d.ts", "MODEL3D_PRIVATE_TRANSFER_MAX_BYTES", null],
      ["formats", "src/model/model3d.ts", "MODEL3D_FORMATS", null],
      ["formatMimeTypes", "src/model/model3d.ts", "MODEL3D_FORMAT_MIME_TYPES", null],
      ["tiers", "src/model/model3d.ts", "RODIN_TIERS", null],
      ["materials", "src/model/model3d.ts", "RODIN_MATERIALS", null],
      ["qualityMeshOptions", "src/model/model3d.ts", "RODIN_QUALITY_MESH_OPTIONS", null],
      ["textureModes", "src/model/model3d.ts", "RODIN_TEXTURE_MODES", null],
      ["imageMimeTypes", "src/model/model3d.ts", "RODIN_IMAGE_MIME_TYPES", null],
      ["settingsDefaults", "src/model/model3d.ts", "DEFAULT_MODEL3D_SETTINGS", null],
      ["promptAdapterVersion", "src/model/model3d-prompt-adapter.ts", "MODEL3D_PROMPT_ADAPTER_VERSION", null],
      ["viewer", "src/experiences/results/registry.ts", "experienceResultViewers", "model3d"],
    ],
    unsupported: ["runtime-provider-selection", "function-produced-prompt-adaptation"],
  },
} as const;
export type ExperienceContractObservationV2 = Readonly<{
  version: 2; scope: "main-app-code-declarations"; output: keyof typeof v2Projections; profileRef: string;
  generationAvailable: false; canPublish: false; runtimeConfiguration: "unobserved";
  sources: readonly Readonly<{ path: string; bytes: number; hash: string }>[];
  observed: Readonly<Record<string, unknown>>;
  declarations: readonly Readonly<{ path: string; symbol: string; exported: boolean;
    start: number; end: number; hash: string; dependencies: readonly string[] }>[];
  unsupported: readonly string[]; observationHash: string;
}>;

/** Closed v2 consistency only. Source spans are zero-based UTF-8 byte ranges,
 * ending exclusively; their hashes cover complete declarators. Without the
 * independently retained source bytes these are claims, not custody proof.
 * No v2 value is admitted by the existing v1 proposal/adoption readers. */
export async function readExperienceContractObservationV2(raw: unknown): Promise<ExperienceContractObservationV2 | null> {
  const value = snapshot(raw, 32768);
  const strictHash = (item: unknown): item is string => typeof item === "string" && /^sha256:[a-f0-9]{64}(?![\s\S])/.test(item);
  const symbol = (item: unknown): item is string => typeof item === "string" && /^[A-Za-z_$][A-Za-z0-9_$]{0,255}(?![\s\S])/.test(item);
  if (!record(value) || !exactKeys(value, ["version", "scope", "output", "profileRef", "generationAvailable", "canPublish", "runtimeConfiguration", "sources", "observed", "declarations", "unsupported", "observationHash"])
    || value.version !== 2 || value.scope !== "main-app-code-declarations" || typeof value.output !== "string" || !Object.hasOwn(v2Projections, value.output)
    || value.profileRef !== `${value.output}.code-declarations@2` || value.generationAvailable !== false || value.canPublish !== false
    || value.runtimeConfiguration !== "unobserved" || !strictHash(value.observationHash)) return null;
  const output = value.output as keyof typeof v2Projections, projection = v2Projections[output];
  if (!Array.isArray(value.sources) || value.sources.length !== projection.paths.length || value.sources.some((item, index) => !record(item)
    || !exactKeys(item, ["path", "bytes", "hash"]) || item.path !== projection.paths[index] || !positive(item.bytes) || Number(item.bytes) > 262144 || !strictHash(item.hash))) return null;
  if (!record(value.observed) || !exactKeys(value.observed, projection.roots.map(item => item[0]))
    || canonicalJson(value.unsupported) !== canonicalJson(projection.unsupported)) return null;
  let nodes = 0;
  const literal = (item: unknown, depth: number): boolean => {
    if (++nodes > 2048 || depth > 12) return false;
    if (item === null || typeof item === "boolean") return true;
    if (typeof item === "string") return item.length <= 4096;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.length <= 64 && item.every(child => literal(child, depth + 1));
    return record(item) && Object.keys(item).length <= 64 && Object.keys(item).every(key =>
      !["__proto__", "prototype", "constructor"].includes(key) && literal(item[key], depth + 1));
  };
  for (const item of Object.values(value.observed)) if (!literal(item, 0)) return null;
  const viewer = value.observed.viewer;
  if (!record(viewer) || !exactKeys(viewer, ["id", "output", "dtoVersion", "contractRevision", "activation", "qualification"])
    || viewer.id !== `${output}.read-only@1` || viewer.output !== output || viewer.dtoVersion !== 1 || viewer.contractRevision !== 1
    || viewer.activation !== (["video", "audio", "model3d"].includes(output) ? "explicit-user" : "ready-result") || viewer.qualification !== "fixture-only") return null;
  if (!Array.isArray(value.declarations) || value.declarations.length < 1 || value.declarations.length > 128) return null;
  type Declaration = ExperienceContractObservationV2["declarations"][number];
  const declarations = new Map<string, Declaration>();
  let priorPath = -1, priorSymbol = "";
  for (const item of value.declarations) {
    if (!record(item) || !exactKeys(item, ["path", "symbol", "exported", "start", "end", "hash", "dependencies"])
      || typeof item.path !== "string" || !symbol(item.symbol) || typeof item.exported !== "boolean" || !strictHash(item.hash)
      || !Number.isSafeInteger(item.start) || Number(item.start) < 0 || !Number.isSafeInteger(item.end) || Number(item.end) <= Number(item.start)
      || !Array.isArray(item.dependencies) || item.dependencies.length > 128 || item.dependencies.some((name, index, all) => !symbol(name) || index > 0 && name <= all[index - 1])) return null;
    const pathIndex = (projection.paths as readonly string[]).indexOf(item.path);
    if (pathIndex < 0 || pathIndex < priorPath || pathIndex === priorPath && item.symbol <= priorSymbol
      || Number(item.end) > Number(value.sources[pathIndex].bytes)) return null;
    priorPath = pathIndex; priorSymbol = item.symbol;
    declarations.set(`${item.path}:${item.symbol}`, item as unknown as Declaration);
  }
  const reached = new Set<string>(), active = new Set<string>();
  let visits = 0;
  const visit = (path: string, name: string, depth: number): boolean => {
    if (++visits > 2048 || depth > 12) return false;
    const key = `${path}:${name}`, item = declarations.get(key);
    if (!item || active.has(key)) return false;
    active.add(key); reached.add(key);
    const valid = item.dependencies.every(dependency => visit(path, dependency, depth + 1));
    active.delete(key);
    return valid;
  };
  for (const [, path, name] of projection.roots) if (!visit(path, name, 0)) return null;
  if (reached.size !== declarations.size) return null;
  const { observationHash, ...body } = value;
  return await digest(body) === observationHash ? freeze(value as unknown as ExperienceContractObservationV2) : null;
}

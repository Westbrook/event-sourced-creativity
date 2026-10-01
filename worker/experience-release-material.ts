import { compileExperience, digest, exactKeys, freeze, jsonIssues, record, valueIssues } from "../src/experiences/compiler.ts";
import type { Catalog, CompiledRelease, Definition, Interaction } from "../src/experiences/contracts.ts";

type MaterialHash = `sha256:${string}`;
type MaterialFile = Readonly<{ path: string; bytes: number; sha256: MaterialHash }>;
type SourceManifest = Readonly<{
  schemaVersion: 1;
  compiler: "forma-experience-compiler@1";
  catalog: "forma-experience-fixture@1";
  catalogHash: MaterialHash;
  files: readonly MaterialFile[];
}>;
type BuildManifest = Readonly<{
  schemaVersion: 1;
  releaseHash: MaterialHash;
  sourceHash: MaterialHash;
  files: readonly MaterialFile[];
  entrypoints: readonly string[];
}>;
type EvaluationReport = Readonly<{
  schemaVersion: 1;
  qualification: "fixture";
  channel: "managed-fixture";
  generationAvailable: false;
  releaseHash: MaterialHash;
  sourceHash: MaterialHash;
  buildHash: MaterialHash;
  outcome: "passed";
  caseCount: number;
  reports: readonly MaterialFile[];
  reportHash: MaterialHash;
}>;

/**
 * A code-owned artifact sink populated only by the controlled build and qualification
 * producer. There is no browser registration API. The producer retains the actual
 * source, build and case-evidence files identified here; the Worker does not read
 * those files or infer that declared hashes prove custody, execution or a pass.
 */
export type ExperienceReleaseMaterialRegistration = Readonly<{
  schemaVersion: 1;
  channel: "managed-fixture";
  catalog: Catalog;
  definition: Definition;
  sourceManifest: SourceManifest;
  buildManifest: BuildManifest;
  evaluationReport: EvaluationReport;
}>;

export type ExperienceReleaseMaterial = Readonly<{
  channel: "managed-fixture";
  qualification: "fixture";
  generationAvailable: false;
  releaseHash: MaterialHash;
  sourceHash: MaterialHash;
  buildHash: MaterialHash;
  evaluationHash: MaterialHash;
  compiler: "forma-experience-compiler@1";
  catalogVersion: "forma-experience-fixture@1";
  catalogHash: MaterialHash;
  catalog: Catalog;
  release: CompiledRelease;
  sourceManifest: SourceManifest;
  buildManifest: BuildManifest;
  evaluationReport: EvaluationReport;
}>;

/** No material is qualified or activated by this implementation alone. */
export const REGISTERED_EXPERIENCE_MATERIALS: readonly ExperienceReleaseMaterialRegistration[] = Object.freeze([]);

const compilerId = "forma-experience-compiler@1";
const catalogId = "forma-experience-fixture@1";
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const outputKinds = new Set(["image", "short_story", "scene", "slides", "storyboard", "video", "audio", "model3d"]);
const interactionKinds = new Set(["source", "spatial", "relationship", "order", "profile", "treatment", "proportion"]);
const bindingRoles = new Set(["subject", "direction", "evidence", "constraint"]);
const maxRegistrations = 64;
// Bounded fixture slices only: reject larger inventories, never truncate them or
// represent this limit as coverage of the whole application/package source tree.
const maxFiles = 64;
const maxFileBytes = 1024 * 1024 * 1024;
const maxManifestBytes = 2 * maxFileBytes;

function isHash(value: unknown): value is MaterialHash {
  return typeof value === "string" && hashPattern.test(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 8192;
}

function boundedArray(value: unknown, maximum = 64): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && value.length <= maximum;
}

function fields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

function filePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && /^[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)*$/.test(value)
    && value.split("/").every(segment => segment !== "." && segment !== "..");
}

function fileManifest(value: unknown): value is readonly MaterialFile[] {
  if (!boundedArray(value, maxFiles)) return false;
  const paths = new Set<string>();
  let total = 0;
  for (const item of value) {
    if (!record(item) || !exactKeys(item, ["path", "bytes", "sha256"]) || !filePath(item.path) || paths.has(item.path)
      || !Number.isSafeInteger(item.bytes) || Number(item.bytes) < 1 || Number(item.bytes) > maxFileBytes || !isHash(item.sha256)) return false;
    paths.add(item.path);
    total += Number(item.bytes);
    if (total > maxManifestBytes) return false;
  }
  return true;
}

function namedPairs(value: unknown, valueKey: "id" | "value"): boolean {
  if (!boundedArray(value)) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!record(item) || !exactKeys(item, [valueKey, "label"]) || !text(item[valueKey]) || !text(item.label) || ids.has(item[valueKey])) return false;
    ids.add(item[valueKey]);
    return true;
  });
}

/** Closed Catalog shapes supplement the compiler, which intentionally trusts Catalog. */
function catalogShape(value: unknown): value is Catalog {
  if (!record(value) || !exactKeys(value, ["version", "qualification", "interactions", "outputs", "copy"])
    || value.version !== catalogId || value.qualification !== "fixture"
    || !record(value.interactions) || !record(value.outputs) || !record(value.copy)
    || !Object.keys(value.interactions).length || !Object.keys(value.outputs).length || !Object.keys(value.copy).length) return false;
  if (!Object.values(value.copy).every(text)) return false;
  for (const [id, item] of Object.entries(value.interactions)) {
    if (!record(item) || !fields(item, ["id", "version", "kind", "renderer", "feedback", "required", "maxLength", "defaultValue"], ["options", "fields", "minimum", "maximum"])
      || item.id !== id || !text(id) || item.version !== 1 || !text(item.kind) || !interactionKinds.has(item.kind)
      || !text(item.renderer) || !text(item.feedback) || typeof item.required !== "boolean"
      || !Number.isSafeInteger(item.maxLength) || Number(item.maxLength) < 1 || Number(item.maxLength) > 8192
      || (Object.hasOwn(item, "options") && !namedPairs(item.options, "value"))
      || (Object.hasOwn(item, "fields") && !namedPairs(item.fields, "id"))
      || (Object.hasOwn(item, "minimum") && !Number.isSafeInteger(item.minimum))
      || (Object.hasOwn(item, "maximum") && !Number.isSafeInteger(item.maximum))
      || valueIssues(item.defaultValue, item as unknown as Interaction, "$", false).length) return false;
    const options = Object.hasOwn(item, "options");
    const controls = Object.hasOwn(item, "fields");
    const minimum = Object.hasOwn(item, "minimum");
    const maximum = Object.hasOwn(item, "maximum");
    if ((item.kind === "source" || item.kind === "order") && (options || controls || minimum || maximum)) return false;
    if ((item.kind === "spatial" || item.kind === "treatment") && (!options || controls || minimum || maximum)) return false;
    if (item.kind === "relationship" && (options || !controls || minimum || maximum)) return false;
    if ((item.kind === "profile" || item.kind === "proportion")
      && (options || !controls || !minimum || !maximum || Number(item.minimum) > Number(item.maximum))) return false;
  }
  for (const [id, item] of Object.entries(value.outputs)) {
    if (!record(item) || !exactKeys(item, ["id", "version", "output", "label", "result", "bindingPackRef", "essentialInteractionRef", "viewerRef", "bindings"])
      || item.id !== id || !text(id) || item.version !== 1 || !text(item.output) || !outputKinds.has(item.output)
      || ![item.label, item.result, item.bindingPackRef, item.essentialInteractionRef, item.viewerRef].every(text)
      || !boundedArray(item.bindings, 12)) return false;
    const slots = new Set<string>();
    for (const binding of item.bindings) {
      if (!record(binding) || !exactKeys(binding, ["slot", "decisionId", "interactionRef", "role", "target"])
        || !text(binding.slot) || slots.has(binding.slot) || !text(binding.decisionId) || !text(binding.interactionRef)
        || !Object.hasOwn(value.interactions, binding.interactionRef) || !text(binding.role) || !bindingRoles.has(binding.role)
        || binding.target !== item.output) return false;
      slots.add(binding.slot);
    }
  }
  return true;
}

function registrationShape(value: unknown): value is ExperienceReleaseMaterialRegistration {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "channel", "catalog", "definition", "sourceManifest", "buildManifest", "evaluationReport"])
    || value.schemaVersion !== 1 || value.channel !== "managed-fixture" || !catalogShape(value.catalog)) return false;
  const source = value.sourceManifest;
  const build = value.buildManifest;
  const evaluation = value.evaluationReport;
  if (!record(source) || !exactKeys(source, ["schemaVersion", "compiler", "catalog", "catalogHash", "files"])
    || source.schemaVersion !== 1 || source.compiler !== compilerId || source.catalog !== catalogId || !isHash(source.catalogHash) || !fileManifest(source.files)) return false;
  if (!record(build) || !exactKeys(build, ["schemaVersion", "releaseHash", "sourceHash", "files", "entrypoints"])
    || build.schemaVersion !== 1 || !isHash(build.releaseHash) || !isHash(build.sourceHash) || !fileManifest(build.files)
    || !boundedArray(build.entrypoints, 16) || !build.entrypoints.every(filePath) || new Set(build.entrypoints).size !== build.entrypoints.length) return false;
  const buildPaths = new Set(build.files.map(file => file.path));
  if (!build.entrypoints.every(path => buildPaths.has(path))) return false;
  return record(evaluation) && exactKeys(evaluation, ["schemaVersion", "qualification", "channel", "generationAvailable", "releaseHash", "sourceHash", "buildHash", "outcome", "caseCount", "reports", "reportHash"])
    && evaluation.schemaVersion === 1 && evaluation.qualification === "fixture" && evaluation.channel === "managed-fixture" && evaluation.generationAvailable === false
    && isHash(evaluation.releaseHash) && isHash(evaluation.sourceHash) && isHash(evaluation.buildHash)
    && evaluation.outcome === "passed" && Number.isSafeInteger(evaluation.caseCount) && Number(evaluation.caseCount) > 0 && Number(evaluation.caseCount) <= 1_000_000
    && fileManifest(evaluation.reports) && isHash(evaluation.reportHash);
}

/**
 * Snapshot only registered managed-fixture material. Capture every registry entry
 * before the first await so an internal caller cannot change its bindings during
 * compilation. Catalog dependency hashes describe contracts, not implementation
 * bytes; source/build/evaluation manifests remain distinct from the logical release.
 * This return value is not approval, publication, provider or spending authority.
 */
function snapshotRegistrations(registrations: readonly ExperienceReleaseMaterialRegistration[]): readonly ExperienceReleaseMaterialRegistration[] | null {
  if (!Array.isArray(registrations) || registrations.length > maxRegistrations) return null;
  const descriptors = Object.getOwnPropertyDescriptors(registrations);
  if (Reflect.ownKeys(descriptors).length !== registrations.length + 1) return null;
  const snapshots: ExperienceReleaseMaterialRegistration[] = [];
  for (let index = 0; index < registrations.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || jsonIssues(descriptor.value).length) return null;
    const candidate: unknown = structuredClone(descriptor.value);
    if (!registrationShape(candidate)) return null;
    snapshots.push(freeze(candidate));
  }
  return snapshots;
}

async function resolveSnapshot(candidate: ExperienceReleaseMaterialRegistration): Promise<ExperienceReleaseMaterial | null> {
  const { sourceManifest, buildManifest, evaluationReport } = candidate;
  const catalogHash = await digest(candidate.catalog);
  const sourceHash = await digest(sourceManifest);
  const buildHash = await digest(buildManifest);
  const evaluationHash = await digest(evaluationReport);
  if (sourceManifest.catalogHash !== catalogHash || sourceHash !== evaluationReport.sourceHash || buildHash !== evaluationReport.buildHash
    || buildManifest.sourceHash !== sourceHash || buildManifest.releaseHash !== evaluationReport.releaseHash
    || evaluationReport.reportHash !== await digest(evaluationReport.reports)) return null;
  const compiled = await compileExperience(candidate.definition, candidate.catalog);
  if (!compiled.ok || compiled.release.qualification !== "fixture" || compiled.release.releaseHash !== evaluationReport.releaseHash) return null;
  return freeze({
    channel: "managed-fixture", qualification: "fixture", generationAvailable: false,
    releaseHash: compiled.release.releaseHash as MaterialHash, sourceHash: sourceHash as MaterialHash,
    buildHash: buildHash as MaterialHash, evaluationHash: evaluationHash as MaterialHash,
    compiler: compilerId, catalogVersion: catalogId, catalogHash: catalogHash as MaterialHash,
    catalog: candidate.catalog, release: compiled.release, sourceManifest, buildManifest, evaluationReport,
  });
}

/** One immutable registry snapshot and one resolution per entry; never N² lookup. */
export async function listExperienceReleaseMaterials(registrations: readonly ExperienceReleaseMaterialRegistration[]): Promise<readonly ExperienceReleaseMaterial[] | null> {
  try {
    const snapshots = snapshotRegistrations(registrations);
    if (!snapshots) return null;
    const materials: ExperienceReleaseMaterial[] = [], selections = new Set<string>();
    for (const candidate of snapshots) {
      const resolved = await resolveSnapshot(candidate);
      if (!resolved) return null;
      const key = [resolved.releaseHash, resolved.sourceHash, resolved.buildHash, resolved.evaluationHash].join("|");
      if (selections.has(key)) return null;
      selections.add(key); materials.push(resolved);
    }
    return freeze(materials);
  } catch { return null; }
}

export async function resolveExperienceReleaseMaterial(
  registrations: readonly ExperienceReleaseMaterialRegistration[],
  requested: Readonly<{ releaseHash: string; sourceHash: string; buildHash: string; evaluationHash: string }>,
): Promise<ExperienceReleaseMaterial | null> {
  try {
    if (jsonIssues(requested).length || !record(requested) || !exactKeys(requested, ["releaseHash", "sourceHash", "buildHash", "evaluationHash"])
      || !Object.values(requested).every(isHash)) return null;
    const selection = freeze(structuredClone(requested)), snapshots = snapshotRegistrations(registrations);
    if (!snapshots) return null;
    let resolved: ExperienceReleaseMaterial | null = null;
    for (const candidate of snapshots) {
      const evaluation = candidate.evaluationReport;
      if (evaluation.releaseHash !== selection.releaseHash || evaluation.sourceHash !== selection.sourceHash || evaluation.buildHash !== selection.buildHash) continue;
      const material = await resolveSnapshot(candidate);
      if (!material || material.evaluationHash !== selection.evaluationHash) continue;
      // Duplicate registrations are an ambiguous trusted configuration, not fallback.
      if (resolved) return null;
      resolved = material;
    }
    return resolved;
  } catch {
    // Malformed internal data, failed cloning/digesting and compiler failures all close admission.
    return null;
  }
}

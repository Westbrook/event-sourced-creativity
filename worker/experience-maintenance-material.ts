import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { describeExperiencePatch } from "../src/experiences/patches.ts";
import { bindExperienceMaintenanceProposal, readExperienceContractObservation, type ExperienceContractObservation,
  type ExperienceMaintenanceContext, type ExperienceMaintenanceResult } from "../src/experiences/maintenance-proposal.ts";
import { readExperienceMaterialSelection, type ExperienceMaterialSelection } from "../src/experiences/release-contract.ts";
import { readExperienceMaintenancePreviewRequest, type ExperienceMaintenancePreview, type ExperienceMaintenanceReview,
  type ExperienceMaintenanceReviewState, type ExperienceMaintenanceChanges } from "../src/experiences/maintenance-review-contract.ts";
import { listExperienceReleaseMaterials, type ExperienceReleaseMaterialRegistration, type ExperienceReleaseMaterial } from "./experience-release-material.ts";
import { maintenanceAdoptionSnapshot, maintenanceBindingDigest, maintenanceHash, readMaintenanceAdoptionBinding, type MaintenanceBinding } from "../src/experiences/maintenance-adoption-contract.ts";
import { readExperienceMaintenanceCaptureProfile, readExperienceMaintenanceInventory, type ExperienceMaintenanceCaptureProfile,
  type ExperienceMaintenanceInventory } from "../src/experiences/maintenance-inventory.ts";

/** Code-owned sink, never an HTTP or env capability. Baseline/current roles are
 * explicit nominations for this exact material. The controlled artifact producer
 * retains raw captures, source bytes and evidence separately; Worker consistency
 * checks do not prove custody or adopt a passing qualification as a baseline. */
export type ExperienceMaintenanceRegistration = Readonly<{
  version: 1;
  base: ExperienceMaterialSelection;
  baseline: ExperienceContractObservation;
  current: ExperienceContractObservation;
}>;
export const REGISTERED_EXPERIENCE_MAINTENANCE: readonly ExperienceMaintenanceRegistration[] = Object.freeze([]);
type Registry = readonly ExperienceMaintenanceRegistration[];
type Materials = readonly ExperienceReleaseMaterialRegistration[];
type Failure = { ok: false; error: string; status: 400 | 404 | 409 | 503 };
type Result<T> = { ok: true; value: T } | Failure;
const unavailable = (): Failure => ({ ok: false, error: "experience_maintenance_registry_unavailable", status: 503 });
const flags = { version: 1, qualification: "fixture", generationAvailable: false, canPublish: false } as const;
const key = (base: ExperienceMaterialSelection) => canonicalJson(base);
const paths = {
  "src/model/model3d.ts": "model3d-contract",
  "src/model/model3d-prompt-adapter.ts": "model3d-prompt-adapter",
  "src/experiences/results/registry.ts": "model3d-viewer",
} as const;

function snapshot(registrations: Registry): readonly ExperienceMaintenanceRegistration[] | null {
  if (!Array.isArray(registrations) || registrations.length > 64) return null;
  const descriptors = Object.getOwnPropertyDescriptors(registrations);
  if (Reflect.ownKeys(descriptors).length !== registrations.length + 1) return null;
  const result: ExperienceMaintenanceRegistration[] = [], selections = new Set<string>();
  for (let index = 0; index < registrations.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || jsonIssues(descriptor.value).length) return null;
    const value: unknown = structuredClone(descriptor.value);
    if (!record(value) || !exactKeys(value, ["version", "base", "baseline", "current"]) || value.version !== 1
      || !readExperienceMaterialSelection(value.base) || new TextEncoder().encode(canonicalJson(value)).length > 65536) return null;
    const selected = key(value.base as ExperienceMaterialSelection);
    if (selections.has(selected)) return null;
    selections.add(selected); result.push(freeze(value as ExperienceMaintenanceRegistration));
  }
  return result;
}

async function context(materials: Materials, registrations: Registry, rawBase: unknown): Promise<Result<{
  base: ExperienceMaterialSelection; material: ExperienceReleaseMaterial; pair: ExperienceMaintenanceContext | null;
}>> {
  try {
    const base = readExperienceMaterialSelection(rawBase), pairs = snapshot(registrations);
    if (!base) return { ok: false, error: "invalid_experience_maintenance_request", status: 400 };
    if (!pairs) return unavailable();
    // listExperienceReleaseMaterials snapshots every material synchronously before
    // its first await. Both registries and the selection are now captured; no N² lookups.
    const pending = listExperienceReleaseMaterials(materials);
    const resolved = await pending;
    if (!resolved) return unavailable();
    const byMaterial = new Map(resolved.map(material => [key({ releaseHash: material.releaseHash, sourceHash: material.sourceHash,
      buildHash: material.buildHash, evaluationHash: material.evaluationHash }), material]));
    const byPair = new Map<string, ExperienceMaintenanceContext>();
    for (const pair of pairs) {
      const material = byMaterial.get(key(pair.base));
      if (!material || material.release.output.output !== "model3d") return unavailable();
      const baseline = await readExperienceContractObservation(pair.baseline), current = await readExperienceContractObservation(pair.current);
      if (!baseline || !current) return unavailable();
      // Retain the scalar declaration check at this stored-pair boundary even
      // after the shared observation parser has validated the capture.
      if ([baseline, current].some(observation => !record(observation.observed.viewer)
        || typeof observation.observed.viewer.activation !== "string")) return unavailable();
      byPair.set(key(pair.base), freeze({ material: { selection: pair.base, release: material.release }, catalog: material.catalog, baseline, current }));
    }
    const material = byMaterial.get(key(base));
    if (!material) return { ok: false, error: "experience_release_material_unavailable", status: 404 };
    return { ok: true, value: { base, material, pair: byPair.get(key(base)) ?? null } };
  } catch { return unavailable(); }
}

function review(result: Extract<ExperienceMaintenanceResult, { ok: true }>): ExperienceMaintenanceReviewState {
  const changes: ExperienceMaintenanceChanges = result.status === "compatibility-review" ? {
    sources: result.sourceChanges.map(path => {
      if (!Object.hasOwn(paths, path)) throw new Error("maintenance_projection");
      return paths[path as keyof typeof paths];
    }),
    contracts: result.contractChanges as ExperienceMaintenanceChanges["contracts"],
  } : { sources: [], contracts: [] };
  return { baselineObservationHash: result.baselineObservationHash, currentObservationHash: result.currentObservationHash, status: result.status, changes };
}

export async function readExperienceMaintenanceForMaterial(materials: Materials, registrations: Registry, rawBase: unknown): Promise<Result<ExperienceMaintenanceReview>> {
  try {
    const found = await context(materials, registrations, rawBase);
    if (!found.ok) return found;
    const { base, pair } = found.value;
    if (!pair) return { ok: true, value: freeze({ ...flags, base, review: null }) };
    const result = await bindExperienceMaintenanceProposal({ version: 1, base, baselineObservationHash: pair.baseline.observationHash,
      currentObservationHash: pair.current.observationHash, patch: null }, pair);
    if (!result.ok || result.status === "proposal") return unavailable();
    return { ok: true, value: freeze({ ...flags, base, review: review(result) as NonNullable<ExperienceMaintenanceReview["review"]> }) };
  } catch { return unavailable(); }
}

export async function previewExperienceMaintenanceForMaterial(materials: Materials, registrations: Registry, raw: unknown): Promise<Result<ExperienceMaintenancePreview>> {
  try {
    const request = readExperienceMaintenancePreviewRequest(raw);
    if (!request) return { ok: false, error: "invalid_experience_maintenance_request", status: 400 };
    const found = await context(materials, registrations, request.base);
    if (!found.ok) return found;
    const { pair } = found.value;
    if (!pair) return { ok: false, error: "experience_maintenance_pair_unavailable", status: 409 };
    if (request.baselineObservationHash !== pair.baseline.observationHash || request.currentObservationHash !== pair.current.observationHash)
      return { ok: false, error: "experience_maintenance_capture_changed", status: 409 };
    const result = await bindExperienceMaintenanceProposal(request, pair);
    if (!result.ok) return result.code === "maintenance_patch"
      ? { ok: false, error: "invalid_experience_maintenance_patch", status: 400 } : unavailable();
    return { ok: true, value: projectExperienceMaintenancePreview(result, pair) };
  } catch { return unavailable(); }
}

/** Public preview projection shared by deterministic and external-model paths.
 * Captures, catalog, producer paths and model notes never become authority. */
export function projectExperienceMaintenancePreview(result: Extract<ExperienceMaintenanceResult, { ok: true }>,
  pair: ExperienceMaintenanceContext): ExperienceMaintenancePreview {
  const preview = result.status === "proposal" ? { ok: true as const, candidate: result.candidate, diff: result.diff,
    descriptor: describeExperiencePatch(pair.material.release), qualification: "fixture" as const, generationAvailable: false as const, canPublish: false as const } : null;
  return freeze({ ...flags, base: result.base, review: review(result), preview });
}

type AdoptionEvidenceFile = Readonly<{ path: string; bytes: number; sha256: string }>;
type AdoptionCaptureEvidence = Readonly<{
  observationHash: string; sources: ExperienceContractObservation["sources"]; reports: readonly AdoptionEvidenceFile[];
}>;
/** Owner-admitted, controlled-producer evidence references. Hash consistency is
 * not custody. Neither a material evaluation nor an HTTP/LLM claim supplies this
 * distinct eligibility authority; actual captures and reports stay with producer. */
export type ExperienceMaintenanceAdoptionEligibility = Readonly<{
  version: 1; scope: "initial" | "replacement"; experienceId: string; material: ExperienceMaterialSelection;
  reviewed: Readonly<{ baselineObservationHash: string; currentObservationHash: string }>;
  profile: Readonly<{ ref: "model3d.code-declarations@1"; hash: string }>; inventoryHash: string;
  captures: Readonly<{ baseline: AdoptionCaptureEvidence; current: AdoptionCaptureEvidence }>;
  compatibilityReports: readonly AdoptionEvidenceFile[]; eligibilityHash: string;
}>;
export type ExperienceMaintenanceAdoptionRegistration = Readonly<{
  version: 1; base: ExperienceMaterialSelection; baseline: ExperienceContractObservation; current: ExperienceContractObservation;
  inventory: ExperienceMaintenanceInventory; eligibility: ExperienceMaintenanceAdoptionEligibility;
}>;
/** Retain prior immutable eligibility alongside successors. Empty by default;
 * no route, environment input or successful preview may populate this registry. */
export const REGISTERED_EXPERIENCE_MAINTENANCE_ADOPTIONS: readonly ExperienceMaintenanceAdoptionRegistration[] = Object.freeze([]);
type AdoptionRegistry = readonly ExperienceMaintenanceAdoptionRegistration[];
type ResolvedAdoption = Readonly<{
  material: ExperienceReleaseMaterial; context: ExperienceMaintenanceContext; eligibility: ExperienceMaintenanceAdoptionEligibility;
  profile: ExperienceMaintenanceCaptureProfile; inventory: ExperienceMaintenanceInventory;
}>;
const adoptionUnavailable = (): Failure => ({ ok: false, error: "experience_maintenance_adoption_registry_unavailable", status: 503 });
const adoptionMissing = (): Failure => ({ ok: false, error: "experience_maintenance_adoption_eligibility_unavailable", status: 409 });
const adoptionSources = ["src/model/model3d.ts", "src/model/model3d-prompt-adapter.ts", "src/experiences/results/registry.ts"] as const;

function adoptionSelection(raw: unknown): raw is ExperienceMaterialSelection {
  return record(raw) && exactKeys(raw, ["releaseHash", "sourceHash", "buildHash", "evaluationHash"]) && Object.values(raw).every(maintenanceHash);
}
function adoptionSourceRows(raw: unknown): raw is ExperienceContractObservation["sources"] {
  return Array.isArray(raw) && raw.length === adoptionSources.length && raw.every((row, index) => record(row)
    && exactKeys(row, ["path", "bytes", "hash"]) && row.path === adoptionSources[index] && typeof row.bytes === "number"
    && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 262144 && maintenanceHash(row.hash));
}
function adoptionReports(raw: unknown, minimum: number, files: Map<string, AdoptionEvidenceFile>): raw is readonly AdoptionEvidenceFile[] {
  if (!Array.isArray(raw) || raw.length < minimum || raw.length > 64) return false;
  const paths = new Set<string>();
  let bytes = 0;
  for (const row of raw) {
    if (!record(row) || !exactKeys(row, ["path", "bytes", "sha256"]) || typeof row.path !== "string" || row.path.length > 512
      || !/^[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)*(?![\s\S])/u.test(row.path)
      || row.path.split("/").some(segment => segment === "." || segment === "..") || paths.has(row.path)
      || typeof row.bytes !== "number" || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 1073741824
      || !maintenanceHash(row.sha256)) return false;
    bytes += row.bytes;
    if (bytes > 2147483648) return false;
    const previous = files.get(row.path);
    if (previous && canonicalJson(previous) !== canonicalJson(row)) return false;
    paths.add(row.path); files.set(row.path, row as AdoptionEvidenceFile);
  }
  return true;
}
function adoptionEligibilityShape(raw: unknown): raw is ExperienceMaintenanceAdoptionEligibility {
  if (!record(raw) || !exactKeys(raw, ["version", "scope", "experienceId", "material", "reviewed", "profile", "inventoryHash", "captures", "compatibilityReports", "eligibilityHash"])
    || raw.version !== 1 || (raw.scope !== "initial" && raw.scope !== "replacement") || typeof raw.experienceId !== "string"
    || !/^[a-z][a-z0-9-]{1,63}(?![\s\S])/u.test(raw.experienceId) || !adoptionSelection(raw.material)
    || !record(raw.reviewed) || !exactKeys(raw.reviewed, ["baselineObservationHash", "currentObservationHash"])
    || !Object.values(raw.reviewed).every(maintenanceHash) || !record(raw.profile) || !exactKeys(raw.profile, ["ref", "hash"])
    || raw.profile.ref !== "model3d.code-declarations@1" || !maintenanceHash(raw.profile.hash) || !maintenanceHash(raw.inventoryHash)
    || !maintenanceHash(raw.eligibilityHash) || !record(raw.captures) || !exactKeys(raw.captures, ["baseline", "current"])) return false;
  const files = new Map<string, AdoptionEvidenceFile>();
  for (const role of ["baseline", "current"] as const) {
    const capture = raw.captures[role];
    if (!record(capture) || !exactKeys(capture, ["observationHash", "sources", "reports"]) || !maintenanceHash(capture.observationHash)
      || !adoptionSourceRows(capture.sources) || !adoptionReports(capture.reports, 1, files)) return false;
  }
  return adoptionReports(raw.compatibilityReports, 0, files);
}

/** Capture every row before any awaited material/digest work. This is also the
 * internal API snapshot port: it never registers, discovers or qualifies rows. */
export function snapshotMaintenanceAdoptionRegistrations(raw: AdoptionRegistry): AdoptionRegistry | null {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 64) return null;
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(descriptors).length !== raw.length + 1) return null;
    const snapshots: ExperienceMaintenanceAdoptionRegistration[] = [], identities = new Set<string>();
    let bytes = 0;
    for (let index = 0; index < raw.length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      const value = maintenanceAdoptionSnapshot(descriptor.value, 262144);
      if (!record(value) || !exactKeys(value, ["version", "base", "baseline", "current", "inventory", "eligibility"])
        || value.version !== 1 || !adoptionSelection(value.base) || !adoptionEligibilityShape(value.eligibility)
        || !record(value.baseline) || !record(value.current) || !adoptionSourceRows(value.baseline.sources) || !adoptionSourceRows(value.current.sources)) return null;
      bytes += new TextEncoder().encode(canonicalJson(value)).length;
      if (bytes > 4194304 || identities.has(value.eligibility.eligibilityHash)) return null;
      identities.add(value.eligibility.eligibilityHash); snapshots.push(value as ExperienceMaintenanceAdoptionRegistration);
    }
    return freeze(snapshots);
  } catch { return null; }
}

async function adoptionRegistry(materials: Materials, registrations: AdoptionRegistry): Promise<Result<{
  materials: readonly ExperienceReleaseMaterial[]; rows: readonly ResolvedAdoption[];
}>> {
  try {
    const snapshots = snapshotMaintenanceAdoptionRegistrations(registrations);
    if (!snapshots) return adoptionUnavailable();
    // Material list captures its complete code-owned input before its first await.
    const resolvedMaterials = await listExperienceReleaseMaterials(materials);
    if (!resolvedMaterials) return adoptionUnavailable();
    const byMaterial = new Map(resolvedMaterials.map(material => [key({ releaseHash: material.releaseHash, sourceHash: material.sourceHash,
      buildHash: material.buildHash, evaluationHash: material.evaluationHash }), material]));
    const rows: ResolvedAdoption[] = [];
    for (const registration of snapshots) {
      const material = byMaterial.get(key(registration.base)), eligibility = registration.eligibility;
      if (!material || material.release.output.output !== "model3d" || material.release.definition.id !== eligibility.experienceId
        || key(registration.base) !== key(eligibility.material)) return adoptionUnavailable();
      const baseline = await readExperienceContractObservation(registration.baseline), current = await readExperienceContractObservation(registration.current);
      const inventory = await readExperienceMaintenanceInventory(registration.inventory);
      const profile = await readExperienceMaintenanceCaptureProfile(eligibility.profile.ref);
      if (!baseline || !current || !inventory || !profile || profile.profileHash !== eligibility.profile.hash
        || inventory.inventoryHash !== eligibility.inventoryHash || baseline.observationHash !== eligibility.reviewed.baselineObservationHash
        || current.observationHash !== eligibility.reviewed.currentObservationHash) return adoptionUnavailable();
      if (eligibility.scope === "initial" && baseline.observationHash !== current.observationHash) return adoptionUnavailable();
      for (const [role, observation] of [["baseline", baseline], ["current", current]] as const) {
        if (eligibility.captures[role].observationHash !== observation.observationHash
          || canonicalJson(eligibility.captures[role].sources) !== canonicalJson(observation.sources)) return adoptionUnavailable();
      }
      // Current capture implementation is part of this exact selected source
      // manifest. Earlier baseline sources instead join their retained producer
      // capture; replacement also proves that baseline against the durable head.
      if (current.sources.some(source => !material.sourceManifest.files.some(file => file.path === source.path
        && file.bytes === source.bytes && file.sha256 === source.hash))) return adoptionUnavailable();
      const registrySource = current.sources.find(source => source.path === "src/experiences/results/registry.ts");
      const entry = inventory.entries.find(entry => entry.output === material.release.output.output);
      const descriptor = { id: profile.profile.viewerRef, output: "model3d", dtoVersion: profile.profile.dtoVersion,
        contractRevision: profile.profile.contractRevision, activation: profile.profile.activation, qualification: profile.profile.qualification };
      if (!entry || entry.captureProfileRef !== profile.profile.id || entry.status !== "capture-supported"
        || canonicalJson(inventory.source) !== canonicalJson(registrySource) || canonicalJson(entry.viewer) !== canonicalJson(current.observed.viewer)
        || canonicalJson(baseline.observed.viewer) !== canonicalJson(descriptor) || canonicalJson(entry.viewer) !== canonicalJson(descriptor)) return adoptionUnavailable();
      const drift = canonicalJson(baseline.sources) !== canonicalJson(current.sources) || canonicalJson(baseline.observed) !== canonicalJson(current.observed);
      if (drift !== (eligibility.compatibilityReports.length > 0)) return adoptionUnavailable();
      const { eligibilityHash, ...body } = eligibility;
      if (await digest(body) !== eligibilityHash) return adoptionUnavailable();
      rows.push(freeze({ material, context: { material: { selection: registration.base, release: material.release },
        catalog: material.catalog, baseline, current }, eligibility, profile, inventory }));
    }
    return { ok: true, value: freeze({ materials: resolvedMaterials, rows }) };
  } catch { return adoptionUnavailable(); }
}

function rowForBinding(rows: readonly ResolvedAdoption[], binding: MaintenanceBinding): ResolvedAdoption | null {
  const row = rows.find(row => row.eligibility.eligibilityHash === binding.eligibilityHash);
  if (!row || key(row.eligibility.material) !== key(binding.material) || row.eligibility.experienceId !== binding.experienceId
    || row.eligibility.scope !== (binding.expectedAdoption.revision === 0 ? "initial" : "replacement")
    || canonicalJson(row.eligibility.reviewed) !== canonicalJson(binding.reviewed)
    || row.context.current.observationHash !== binding.target.observationHash || row.profile.profile.id !== binding.target.profileRef
    || row.profile.profileHash !== binding.target.profileHash || row.inventory.inventoryHash !== binding.target.inventoryHash) return null;
  return row;
}

/** Eligibility is necessary, not live decision/approval/head authority. The
 * command transaction must still prove every expected prior identity and grant. */
export async function resolveExperienceMaintenanceAdoptionEligibility(materials: Materials, registrations: AdoptionRegistry, rawBinding: unknown): Promise<Result<ResolvedAdoption & { binding: MaintenanceBinding }>> {
  const binding = readMaintenanceAdoptionBinding(rawBinding);
  if (!binding) return { ok: false, error: "invalid_experience_maintenance_adoption_binding", status: 400 };
  const found = await adoptionRegistry(materials, registrations);
  if (!found.ok) return found;
  if (!found.value.materials.some(material => key({ releaseHash: material.releaseHash, sourceHash: material.sourceHash,
    buildHash: material.buildHash, evaluationHash: material.evaluationHash }) === key(binding.material)))
    return { ok: false, error: "experience_release_material_unavailable", status: 404 };
  const row = rowForBinding(found.value.rows, binding);
  return row ? { ok: true, value: freeze({ ...row, binding }) } : adoptionMissing();
}

/** The caller proves the retained head and live actor before and after this
 * await. Selecting a current capture does not invent a successor adoption/CAS.
 * Returned context is private, code-owned input for the deterministic binder. */
export async function resolveAdoptedExperienceMaintenanceContext(materials: Materials, registrations: AdoptionRegistry,
  rawHeadBinding: unknown, rawCurrentObservationHash: unknown): Promise<Result<{
    context: ExperienceMaintenanceContext; baselineEligibilityHash: string; currentEligibilityHash: string;
    profile: ExperienceMaintenanceCaptureProfile; inventory: ExperienceMaintenanceInventory;
  }>> {
  const binding = readMaintenanceAdoptionBinding(rawHeadBinding), currentObservationHash = rawCurrentObservationHash;
  if (!binding || !maintenanceHash(currentObservationHash)) return { ok: false, error: "invalid_experience_maintenance_adoption_context", status: 400 };
  const found = await adoptionRegistry(materials, registrations);
  if (!found.ok) return found;
  const baseline = rowForBinding(found.value.rows, binding);
  if (!baseline) return adoptionMissing();
  let selected: ResolvedAdoption | null = null;
  if (currentObservationHash === binding.target.observationHash) selected = baseline;
  else {
    const candidates = found.value.rows.filter(row => key(row.eligibility.material) === key(binding.material)
      && row.eligibility.experienceId === binding.experienceId && row.eligibility.scope === "replacement"
      && row.context.baseline.observationHash === binding.target.observationHash && row.context.current.observationHash === currentObservationHash
      && row.profile.profile.id === binding.target.profileRef && row.profile.profileHash === binding.target.profileHash);
    // Do not choose among competing provenance records using registry order.
    if (candidates.length === 1) selected = candidates[0];
  }
  if (!selected) return adoptionMissing();
  return { ok: true, value: maintenanceContextValue(baseline, selected) };
}

function maintenanceContextValue(baseline: ResolvedAdoption, selected: ResolvedAdoption) {
  return freeze({ context: { material: baseline.context.material, catalog: baseline.context.catalog,
    baseline: baseline.context.current, current: selected.context.current }, baselineEligibilityHash: baseline.eligibility.eligibilityHash,
    currentEligibilityHash: selected.eligibility.eligibilityHash, profile: selected.profile, inventory: selected.inventory });
}

/** Only a caller that proves durable head absence may use this private context.
 * Initial producer eligibility is explicit: an old nominated/hash-consistent
 * pair alone is insufficient, and registry order never selects provenance. */
export async function resolveRegisteredExperienceMaintenanceContext(materials: Materials, registrations: AdoptionRegistry,
  rawBase: unknown, experienceId: string, rawCurrentObservationHash: unknown): Promise<Result<ReturnType<typeof maintenanceContextValue>>> {
  const base = readExperienceMaterialSelection(maintenanceAdoptionSnapshot(rawBase)), currentObservationHash = rawCurrentObservationHash;
  if (!base || !Object.values(base).every(maintenanceHash) || !maintenanceHash(currentObservationHash))
    return { ok: false, error: "invalid_experience_maintenance_adoption_context", status: 400 };
  const found = await adoptionRegistry(materials, registrations);
  if (!found.ok) return found;
  const material = found.value.materials.find(material => key({ releaseHash: material.releaseHash, sourceHash: material.sourceHash,
    buildHash: material.buildHash, evaluationHash: material.evaluationHash }) === key(base));
  if (!material || material.release.definition.id !== experienceId || material.release.output.output !== "model3d")
    return { ok: false, error: "experience_release_material_unavailable", status: 404 };
  const rows = found.value.rows.filter(row => key(row.eligibility.material) === key(base) && row.eligibility.experienceId === experienceId);
  const contexts: ReturnType<typeof maintenanceContextValue>[] = [];
  for (const baseline of rows.filter(row => row.eligibility.scope === "initial")) {
    const candidates = currentObservationHash === baseline.context.current.observationHash ? [baseline]
      : rows.filter(row => row.eligibility.scope === "replacement" && row.context.baseline.observationHash === baseline.context.current.observationHash
        && row.context.current.observationHash === currentObservationHash && row.profile.profile.id === baseline.profile.profile.id
        && row.profile.profileHash === baseline.profile.profileHash);
    if (candidates.length > 1) return adoptionMissing();
    if (candidates.length === 1) contexts.push(maintenanceContextValue(baseline, candidates[0]));
  }
  return contexts.length === 1 ? { ok: true, value: contexts[0] } : adoptionMissing();
}

/** Safe identities only. The caller supplies a proved current-head expectation;
 * null suppresses nominations for an ineligible/corrupt retained head. This read
 * neither selects a candidate nor exposes producer paths, captures or reports. */
export async function listExperienceMaintenanceAdoptionNominations(materials: Materials, registrations: AdoptionRegistry,
  rawBase: unknown, experienceId: string, rawExpected: MaintenanceBinding["expectedAdoption"] | null): Promise<Result<{
    base: ExperienceMaterialSelection; experienceId: string; nominations: readonly Readonly<{ binding: MaintenanceBinding; bindingHash: string }>[];
  }>> {
  const base = maintenanceAdoptionSnapshot(rawBase), expected = maintenanceAdoptionSnapshot(rawExpected);
  if (!adoptionSelection(base) || typeof experienceId !== "string" || !/^[a-z][a-z0-9-]{1,63}(?![\s\S])/u.test(experienceId)
    || rawExpected !== null && (!record(expected) || !exactKeys(expected, ["revision", "eventId", "baselineObservationHash", "profileRef", "profileHash"])))
    return { ok: false, error: "invalid_experience_maintenance_adoption_nomination", status: 400 };
  const found = await adoptionRegistry(materials, registrations);
  if (!found.ok) return found;
  const material = found.value.materials.find(material => key({ releaseHash: material.releaseHash, sourceHash: material.sourceHash,
    buildHash: material.buildHash, evaluationHash: material.evaluationHash }) === key(base));
  if (!material || material.release.definition.id !== experienceId) return { ok: false, error: "experience_release_material_unavailable", status: 404 };
  const nominations: { binding: MaintenanceBinding; bindingHash: string }[] = [];
  if (expected !== null) {
    for (const row of found.value.rows) {
      if (key(row.eligibility.material) !== key(base) || row.eligibility.experienceId !== experienceId) continue;
      const binding = readMaintenanceAdoptionBinding({ version: 1, operation: "adopt-baseline", channel: "managed-fixture", experienceId,
        material: base, target: { observationHash: row.context.current.observationHash, profileRef: row.profile.profile.id,
          profileHash: row.profile.profileHash, inventoryHash: row.inventory.inventoryHash }, reviewed: row.eligibility.reviewed,
        eligibilityHash: row.eligibility.eligibilityHash, expectedAdoption: expected });
      if (!binding || !rowForBinding(found.value.rows, binding)) continue;
      nominations.push({ binding, bindingHash: await maintenanceBindingDigest(binding) });
    }
  }
  nominations.sort((a, b) => a.bindingHash < b.bindingHash ? -1 : a.bindingHash > b.bindingHash ? 1 : 0);
  if (nominations.some((item, index) => index > 0 && item.bindingHash === nominations[index - 1].bindingHash)) return adoptionUnavailable();
  return { ok: true, value: freeze({ base, experienceId, nominations }) };
}

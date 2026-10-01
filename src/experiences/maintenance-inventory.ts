import type { ResultViewerDescriptor } from "./results/registry.ts";
import { canonicalJson, digest, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";

export const EXPERIENCE_MAINTENANCE_REGISTRY_PATH = "src/experiences/results/registry.ts" as const;
export const EXPERIENCE_MAINTENANCE_SOURCE_LIMIT = 262144;
const inventoryLimit = 32768;
const viewerKeys = ["id", "output", "dtoVersion", "contractRevision", "activation", "qualification"] as const satisfies readonly (keyof ResultViewerDescriptor)[];
const hash = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}(?![\s\S])/.test(value);
const outputName = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}(?![\s\S])/.test(value);
const revision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 999999999;

/** Widen identities/revisions for discovery, not the approved descriptor grammar.
 * New activation/qualification semantics require an explicit reader update. */
export type ExperienceInventoryViewer = Readonly<{
  id: string; output: string; dtoVersion: number; contractRevision: number;
  activation: ResultViewerDescriptor["activation"];
  qualification: ResultViewerDescriptor["qualification"];
}>;
export type ExperienceInventorySource = Readonly<{
  path: typeof EXPERIENCE_MAINTENANCE_REGISTRY_PATH; bytes: number; hash: string;
}>;
export type ExperienceInventoryEntry = Readonly<{
  output: string; viewer: ExperienceInventoryViewer;
  captureProfileRef: "model3d.code-declarations@1" | V2CaptureProfile["id"] | null;
  status: "capture-supported" | "qualification-required";
}>;
export type ExperienceMaintenanceInventory = Readonly<{
  version: 1 | 2; scope: "main-app-viewer-registry-declarations";
  generationAvailable: false; canPublish: false;
  source: ExperienceInventorySource; entries: readonly ExperienceInventoryEntry[];
  inventoryHash: string;
}>;

// A compatibility association for the existing fixed local capture command,
// not a second output inventory, execution dispatch, or generation qualification.
// Discoverable outputs come exclusively from the supplied registry declaration.
const captureProfiles = freeze({
  model3d: {
    id: "model3d.code-declarations@1" as const,
    viewerRef: "model3d.read-only@1", dtoVersion: 1, contractRevision: 1,
    activation: "explicit-user", qualification: "fixture-only",
  },
});

// Explicit v2 associations are capture consistency only, never adoption or execution authority.
const captureProfilesV2 = freeze({
  image: { id: "image.code-declarations@2" as const, viewerRef: "image.read-only@1", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" },
  short_story: { id: "short_story.code-declarations@2" as const, viewerRef: "short_story.read-only@1", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" },
  scene: { id: "scene.code-declarations@2" as const, viewerRef: "scene.read-only@1", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" },
  slides: { id: "slides.code-declarations@2" as const, viewerRef: "slides.read-only@1", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" },
  storyboard: { id: "storyboard.code-declarations@2" as const, viewerRef: "storyboard.read-only@1", dtoVersion: 1, contractRevision: 1, activation: "ready-result", qualification: "fixture-only" },
  video: { id: "video.code-declarations@2" as const, viewerRef: "video.read-only@1", dtoVersion: 1, contractRevision: 1, activation: "explicit-user", qualification: "fixture-only" },
  audio: { id: "audio.code-declarations@2" as const, viewerRef: "audio.read-only@1", dtoVersion: 1, contractRevision: 1, activation: "explicit-user", qualification: "fixture-only" },
  model3d: { id: "model3d.code-declarations@2" as const, viewerRef: "model3d.read-only@1", dtoVersion: 1, contractRevision: 1, activation: "explicit-user", qualification: "fixture-only" },
});
type V2CaptureProfile = typeof captureProfilesV2[keyof typeof captureProfilesV2];
export type ExperienceMaintenanceCaptureProfile = Readonly<{
  profile: typeof captureProfiles.model3d | V2CaptureProfile; profileHash: string;
}>;

/** Identity of the existing fixed capture association, not a registration or an
 * execution capability. Unsupported references cannot nominate another profile. */
export async function readExperienceMaintenanceCaptureProfile(rawRef: unknown): Promise<ExperienceMaintenanceCaptureProfile | null> {
  const profile = rawRef === captureProfiles.model3d.id ? captureProfiles.model3d
    : Object.values(captureProfilesV2).find(item => rawRef === item.id);
  return profile ? freeze({ profile, profileHash: await digest(profile) }) : null;
}

function snapshot(raw: unknown): unknown | null {
  if (jsonIssues(raw).length) return null;
  const value: unknown = structuredClone(raw);
  return new TextEncoder().encode(canonicalJson(value)).length <= inventoryLimit ? value : null;
}
function readSource(raw: unknown): ExperienceInventorySource | null {
  return record(raw) && exactKeys(raw, ["path", "bytes", "hash"])
    && raw.path === EXPERIENCE_MAINTENANCE_REGISTRY_PATH && typeof raw.bytes === "number"
    && Number.isSafeInteger(raw.bytes) && raw.bytes > 0 && raw.bytes <= EXPERIENCE_MAINTENANCE_SOURCE_LIMIT && hash(raw.hash)
    ? raw as ExperienceInventorySource : null;
}
function readViewer(raw: unknown, output: string): ExperienceInventoryViewer | null {
  if (!record(raw) || !exactKeys(raw, viewerKeys) || raw.output !== output
    || typeof raw.id !== "string" || !raw.id.startsWith(`${output}.read-only@`)
    || !/^[1-9][0-9]{0,8}(?![\s\S])/.test(raw.id.slice(`${output}.read-only@`.length))
    || !revision(raw.dtoVersion) || !revision(raw.contractRevision)
    || (raw.activation !== "ready-result" && raw.activation !== "explicit-user") || raw.qualification !== "fixture-only") return null;
  return raw as ExperienceInventoryViewer;
}
function entryFor(viewer: ExperienceInventoryViewer, version: 1 | 2): ExperienceInventoryEntry {
  // Keep model3d's existing inventory association on @1; @2 is explicit opt-in.
  const profile = version === 1
    ? Object.hasOwn(captureProfiles, viewer.output) ? captureProfiles[viewer.output as keyof typeof captureProfiles] : null
    : viewer.output === "model3d" ? captureProfiles.model3d
    : Object.hasOwn(captureProfilesV2, viewer.output) ? captureProfilesV2[viewer.output as keyof typeof captureProfilesV2] : null;
  const supported = profile && viewer.id === profile.viewerRef && viewer.dtoVersion === profile.dtoVersion
    && viewer.contractRevision === profile.contractRevision && viewer.activation === profile.activation && viewer.qualification === profile.qualification;
  return { output: viewer.output, viewer, captureProfileRef: supported ? profile.id : null,
    status: supported ? "capture-supported" : "qualification-required" };
}

/** Local source-process port. Callers cannot nominate profiles, paths, or authority.
 * This builds a consistency record; it does not establish capture provenance. */
export async function createExperienceMaintenanceInventory(rawRegistry: unknown, rawSource: unknown): Promise<ExperienceMaintenanceInventory | null> {
  const registry = snapshot(rawRegistry), source = readSource(snapshot(rawSource));
  if (!record(registry) || !source || Object.keys(registry).length > 64) return null;
  const entries: ExperienceInventoryEntry[] = [];
  for (const output of Object.keys(registry).sort()) {
    if (!outputName(output)) return null;
    const viewer = readViewer(registry[output], output);
    if (!viewer) return null;
    entries.push(entryFor(viewer, 2));
  }
  const body = { version: 2 as const, scope: "main-app-viewer-registry-declarations" as const,
    generationAvailable: false as const, canPublish: false as const, source, entries };
  if (new TextEncoder().encode(canonicalJson(body)).length > inventoryLimit - 100) return null;
  return freeze({ ...body, inventoryHash: await digest(body) });
}

/** Hash consistency only, not custody, baseline selection, provider validation,
 * capability availability, publication authority, or an executable configuration. */
export async function readExperienceMaintenanceInventory(raw: unknown): Promise<ExperienceMaintenanceInventory | null> {
  const value = snapshot(raw);
  if (!record(value) || !exactKeys(value, ["version", "scope", "generationAvailable", "canPublish", "source", "entries", "inventoryHash"])
    || (value.version !== 1 && value.version !== 2) || value.scope !== "main-app-viewer-registry-declarations"
    || value.generationAvailable !== false || value.canPublish !== false || !hash(value.inventoryHash)
    || !readSource(value.source) || !Array.isArray(value.entries) || value.entries.length > 64) return null;
  let previous = "";
  for (const entry of value.entries) {
    if (!record(entry) || !exactKeys(entry, ["output", "viewer", "captureProfileRef", "status"])
      || !outputName(entry.output) || entry.output <= previous) return null;
    const viewer = readViewer(entry.viewer, entry.output);
    if (!viewer) return null;
    const expected = entryFor(viewer, value.version);
    if (entry.captureProfileRef !== expected.captureProfileRef || entry.status !== expected.status) return null;
    previous = entry.output;
  }
  const { inventoryHash, ...body } = value;
  return await digest(body) === inventoryHash ? freeze(value as ExperienceMaintenanceInventory) : null;
}

export type ExperienceInventoryChange = Readonly<{
  output: string; kind: "added" | "changed" | "removed";
  before: ExperienceInventoryEntry | null; after: ExperienceInventoryEntry | null;
}>;
export type ExperienceInventoryComparison =
  | { ok: false; code: "inventory_baseline" | "inventory_current" }
  | Readonly<{ ok: true; version: 1; status: "unchanged" | "review-required";
    generationAvailable: false; canPublish: false; baselineInventoryHash: string; currentInventoryHash: string;
    sourceChanged: boolean; changes: readonly ExperienceInventoryChange[]; unprofiled: readonly string[] }>;

/** Compare explicit retained inventories. Never infer a baseline, execute a
 * capture profile, scaffold a recipe, activate a route, or repair user choices. */
export async function compareExperienceMaintenanceInventories(rawBaseline: unknown, rawCurrent: unknown): Promise<ExperienceInventoryComparison> {
  // Capture both caller values before the first await, including the current one.
  const baselineSnapshot = snapshot(rawBaseline), currentSnapshot = snapshot(rawCurrent);
  const baseline = await readExperienceMaintenanceInventory(baselineSnapshot);
  if (!baseline) return { ok: false, code: "inventory_baseline" };
  const current = await readExperienceMaintenanceInventory(currentSnapshot);
  if (!current) return { ok: false, code: "inventory_current" };
  const before = new Map(baseline.entries.map(entry => [entry.output, entry]));
  const after = new Map(current.entries.map(entry => [entry.output, entry]));
  const changes: ExperienceInventoryChange[] = [];
  for (const output of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const left = before.get(output) ?? null, right = after.get(output) ?? null;
    if (canonicalJson(left) !== canonicalJson(right)) changes.push({ output,
      kind: left === null ? "added" : right === null ? "removed" : "changed", before: left, after: right });
  }
  const sourceChanged = canonicalJson(baseline.source) !== canonicalJson(current.source);
  return freeze({ ok: true, version: 1, status: sourceChanged || changes.length ? "review-required" : "unchanged",
    generationAvailable: false, canPublish: false, baselineInventoryHash: baseline.inventoryHash, currentInventoryHash: current.inventoryHash,
    sourceChanged, changes, unprofiled: current.entries.filter(entry => entry.captureProfileRef === null).map(entry => entry.output) });
}

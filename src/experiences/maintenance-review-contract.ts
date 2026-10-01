import { canonicalJson, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import type { ExperienceMaintenanceRequest } from "./maintenance-proposal.ts";
import { proposePatch } from "./patches.ts";
import { experienceReleaseHash, readExperienceMaterialDetail, readExperienceMaterialPreview, readExperienceMaterialSelection,
  type ExperienceMaterialDetail, type ExperienceMaterialPreview, type ExperienceMaterialSelection } from "./release-contract.ts";

export const EXPERIENCE_MAINTENANCE_SOURCES = ["model3d-contract", "model3d-prompt-adapter", "model3d-viewer"] as const;
export const EXPERIENCE_MAINTENANCE_FIELDS = ["adapterVersion", "promptAdapterVersion", "textModel", "imageModel", "promptMaxChars", "maxImageReferences", "privateTransferMaxBytes", "formats", "formatMimeTypes", "tiers", "materials", "qualityMeshOptions", "textureModes", "imageMimeTypes", "settingsDefaults", "viewer"] as const;
export type ExperienceMaintenanceChanges = Readonly<{
  sources: readonly typeof EXPERIENCE_MAINTENANCE_SOURCES[number][];
  contracts: readonly typeof EXPERIENCE_MAINTENANCE_FIELDS[number][];
}>;
export type ExperienceMaintenanceReviewState = Readonly<{
  baselineObservationHash: string;
  currentObservationHash: string;
  status: "unchanged" | "compatibility-review" | "proposal";
  changes: ExperienceMaintenanceChanges;
}>;
type Envelope = Readonly<{
  version: 1; qualification: "fixture"; generationAvailable: false; canPublish: false;
  base: ExperienceMaterialSelection;
}>;
export type ExperienceMaintenanceReview = Envelope & Readonly<{
  review: (ExperienceMaintenanceReviewState & { status: "unchanged" | "compatibility-review" }) | null;
}>;
export type ExperienceMaintenancePreview = Envelope & Readonly<{
  review: ExperienceMaintenanceReviewState;
  preview: ExperienceMaterialPreview | null;
}>;

function capture(raw: unknown, limit = 32768): unknown | null {
  if (jsonIssues(raw).length) return null;
  const value: unknown = structuredClone(raw);
  return new TextEncoder().encode(canonicalJson(value)).length <= limit ? value : null;
}
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function members(value: unknown, allowed: readonly string[]): boolean {
  return Array.isArray(value) && value.length <= allowed.length && new Set(value).size === value.length
    && value.every(item => typeof item === "string" && allowed.includes(item));
}
function state(value: unknown, proposal: boolean): value is ExperienceMaintenanceReviewState {
  if (!record(value) || !exactKeys(value, ["baselineObservationHash", "currentObservationHash", "status", "changes"])
    || !experienceReleaseHash(value.baselineObservationHash) || !experienceReleaseHash(value.currentObservationHash)
    || typeof value.status !== "string" || !["unchanged", "compatibility-review", ...(proposal ? ["proposal"] : [])].includes(value.status)
    || !record(value.changes) || !exactKeys(value.changes, ["sources", "contracts"])
    || !members(value.changes.sources, EXPERIENCE_MAINTENANCE_SOURCES) || !members(value.changes.contracts, EXPERIENCE_MAINTENANCE_FIELDS)) return false;
  const changed = (value.changes.sources as unknown[]).length + (value.changes.contracts as unknown[]).length;
  return value.status === "compatibility-review" ? changed > 0 && value.baselineObservationHash !== value.currentObservationHash
    : changed === 0 && value.baselineObservationHash === value.currentObservationHash;
}
function envelope(value: unknown, keys: readonly string[], selected: unknown): value is Record<string, unknown> & Envelope {
  return record(value) && exactKeys(value, keys) && value.version === 1 && value.qualification === "fixture"
    && value.generationAvailable === false && value.canPublish === false && Boolean(readExperienceMaterialSelection(value.base))
    && Boolean(readExperienceMaterialSelection(selected)) && same(value.base, selected);
}

/** Closed read projection only. No raw observations, local paths, catalog or
 * custody/approval claims. The comparison capture is nominated, not live API state. */
export function readExperienceMaintenanceReview(raw: unknown, expectedBase: ExperienceMaterialSelection): ExperienceMaintenanceReview | null {
  try {
    const value = capture(raw), selected = capture(expectedBase);
    if (!envelope(value, ["version", "qualification", "generationAvailable", "canPublish", "base", "review"], selected)
      || value.review !== null && !state(value.review, false)) return null;
    return freeze(value as ExperienceMaintenanceReview);
  } catch { return null; }
}

/** Structural patch validation; complete decision membership is still checked
 * against the actual material by the existing proposePatch implementation. */
export function readExperienceMaintenancePreviewRequest(raw: unknown): ExperienceMaintenanceRequest | null {
  try {
    const value = capture(raw);
    if (!record(value) || !exactKeys(value, ["version", "base", "baselineObservationHash", "currentObservationHash", "patch"])
      || value.version !== 1 || !readExperienceMaterialSelection(value.base)
      || !experienceReleaseHash(value.baselineObservationHash) || !experienceReleaseHash(value.currentObservationHash)) return null;
    if (value.patch !== null) {
      const patch = value.patch;
      if (!record(patch) || !exactKeys(patch, ["schemaVersion", "baseReleaseHash", "operations"]) || patch.schemaVersion !== 1
        || patch.baseReleaseHash !== (value.base as ExperienceMaterialSelection).releaseHash || !Array.isArray(patch.operations)
        || patch.operations.length < 1 || patch.operations.length > 12) return null;
      for (const operation of patch.operations) {
        if (!record(operation)) return null;
        if (operation.kind === "set-layout" && exactKeys(operation, ["kind", "layout"]) && typeof operation.layout === "string" && ["stage-and-controls", "stacked-stage"].includes(operation.layout)) continue;
        if (operation.kind === "reorder-decisions" && exactKeys(operation, ["kind", "ids"]) && Array.isArray(operation.ids)
          && operation.ids.length >= 2 && operation.ids.length <= 12 && new Set(operation.ids).size === operation.ids.length
          && operation.ids.every(id => typeof id === "string" && /^[a-z][a-zA-Z0-9-]{0,63}$/.test(id))) continue;
        return null;
      }
    }
    return freeze(value as ExperienceMaintenanceRequest);
  } catch { return null; }
}

/** Bind publication of a read result to the caller's captured material, request,
 * and prior private review. Reuse the existing candidate validator; these checks
 * never adopt a baseline, register a preview or confer approval. */
export async function readExperienceMaintenancePreview(raw: unknown, expected: Readonly<{
  detail: ExperienceMaterialDetail; request: ExperienceMaintenanceRequest; review: ExperienceMaintenanceReview;
}>): Promise<ExperienceMaintenancePreview | null> {
  try {
    // The binder admits a 192 KiB material/catalog/capture context. Leave room
    // for its selected release plus the bounded 32 KiB request and read metadata.
    // Projection/request-only readers retain their smaller 32 KiB limit.
    const value = capture(raw, 262144), saved = capture(expected, 262144);
    if (!record(saved) || !exactKeys(saved, ["detail", "request", "review"])) return null;
    const request = readExperienceMaintenancePreviewRequest(saved.request);
    if (!request || !envelope(value, ["version", "qualification", "generationAvailable", "canPublish", "base", "review", "preview"], request.base)
      || !state(value.review, true)) return null;
    const prior = readExperienceMaintenanceReview(saved.review, request.base);
    if (!prior?.review || prior.review.baselineObservationHash !== request.baselineObservationHash || prior.review.currentObservationHash !== request.currentObservationHash
      || value.review.baselineObservationHash !== request.baselineObservationHash || value.review.currentObservationHash !== request.currentObservationHash
      || !same(value.review.changes, prior.review.changes)) return null;
    const detail = await readExperienceMaterialDetail(saved.detail);
    if (!detail || detail.material.output !== "model3d" || !same(detail.material.selection, request.base)) return null;
    const patchResult = request.patch === null ? null : await proposePatch(detail.release, request.patch, {
      version: "forma-experience-fixture@1", qualification: "fixture", outputs: { [detail.release.output.id]: detail.release.output },
      interactions: Object.fromEntries(Object.values(detail.release.interactions).map(item => [item.id, item])), copy: detail.release.copy,
    });
    if (patchResult && !patchResult.ok) return null;
    if (prior.review.status === "compatibility-review") {
      if (value.review.status !== "compatibility-review" || value.preview !== null) return null;
    } else if (value.review.status === "proposal") {
      if (request.patch === null) return null;
      const preview = await readExperienceMaterialPreview(value.preview, { detail, patch: request.patch });
      if (!preview?.ok || preview.diff.risk !== "presentation") return null;
    } else if (value.review.status === "unchanged" && value.preview === null) {
      // A server no-op claim must actually be a no-op for this exact base/patch.
      if (patchResult?.ok && patchResult.diff.risk !== "none") return null;
    } else return null;
    return freeze(value as ExperienceMaintenancePreview);
  } catch { return null; }
}

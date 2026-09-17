import { contextCatalog } from "./catalog.ts";
import { canonicalJson, compileExperience, exactKeys, freeze, jsonIssues, record } from "./compiler.ts";
import { registeredExperience } from "./intake.ts";
import type { CompiledRelease, Definition, Issue } from "./contracts.ts";

/** Offline review only. This module has no authority, storage, network or activation port. */
export const EXPERIENCE_MAINTENANCE_MAX_BYTES = 16_384;
type Proposal = Readonly<{
  schemaVersion: 1;
  experienceId: string;
  baseReleaseHash: string;
  evidenceRefs: readonly string[];
  changes: Readonly<{ decisionOrder: readonly string[] }>;
}>;
type SemanticDiff = Readonly<{ field: "decisionOrder"; before: readonly string[]; after: readonly string[] }>;
export type ExperienceMaintenanceReview = Readonly<{
  schemaVersion: 1;
  mode: "proposal-only";
  experienceId: string;
  baseReleaseHash: string;
  candidateReleaseHash: string;
  baseDefinition: Definition;
  candidateDefinition: Definition;
  candidateRelease: CompiledRelease;
  semanticDiff: readonly SemanticDiff[];
  evidenceRefs: readonly string[];
  dependencies: Readonly<Record<string, string>>;
  reviewRequired: readonly string[];
}>;

/** Supplies an exact current base and closed operations to either a person or an LLM. */
export async function describeExperienceMaintenance(id: unknown) {
  if (typeof id !== "string") return null;
  const release = await registeredExperience(id);
  if (!release) return null;
  return freeze({
    schemaVersion: 1 as const, mode: "proposal-only" as const, experienceId: id,
    baseReleaseHash: release.releaseHash, definition: release.definition, output: release.output,
    decisions: release.definition.decisions.map(decision => ({
      id: decision.id, label: release.copy[decision.labelKey], bindingSlot: decision.bindingSlot,
      interactionRef: decision.interactionRef,
    })),
    allowedChanges: ["decisionOrder"],
    proposalTemplate: {
      schemaVersion: 1 as const, experienceId: id, baseReleaseHash: release.releaseHash,
      evidenceRefs: ["Replace with the permitted evidence reference"],
      changes: { decisionOrder: release.definition.decisions.map(decision => decision.id) },
    },
  });
}

/** A passing result is review material, never a test attestation or publication permission. */
export async function reviewExperienceMaintenance(raw: unknown): Promise<
  { ok: true; review: ExperienceMaintenanceReview } | { ok: false; issues: readonly Issue[] }
> {
  const rejected = (code: string, path = "$") => ({ ok: false as const, issues: [{ code, path }] });
  try {
    const unsafe = jsonIssues(raw);
    if (unsafe.length) return { ok: false, issues: unsafe };
    if (new TextEncoder().encode(canonicalJson(raw)).byteLength > EXPERIENCE_MAINTENANCE_MAX_BYTES) return rejected("proposal_limit");
    // Snapshot before the first await: a caller cannot alter a proposal during resolution.
    raw = structuredClone(raw);
  } catch {
    // In-process callers may supply proxies or other values that JSON cannot represent.
    return rejected("invalid_json");
  }
  if (!record(raw) || !exactKeys(raw, ["schemaVersion", "experienceId", "baseReleaseHash", "evidenceRefs", "changes"])) return rejected("proposal_shape");
  if (raw.schemaVersion !== 1 || typeof raw.experienceId !== "string" || typeof raw.baseReleaseHash !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(raw.baseReleaseHash)) return rejected("proposal_identity");
  if (!Array.isArray(raw.evidenceRefs) || raw.evidenceRefs.length < 1 || raw.evidenceRefs.length > 8
    || raw.evidenceRefs.some(reference => typeof reference !== "string" || reference.trim() !== reference || !reference.length
      // References are inert labels. Never retrieve their contents or interpret them as instructions.
      // eslint-disable-next-line no-control-regex
      || reference.length > 240 || /[\u0000-\u001f\u007f]/u.test(reference))
    || new Set(raw.evidenceRefs).size !== raw.evidenceRefs.length) return rejected("evidence_refs_invalid", "$.evidenceRefs");
  // The current view consumes decision order, but not Definition.layout. Do not
  // offer a layout mutation that only changes a hash without changing the UI.
  if (!record(raw.changes) || !exactKeys(raw.changes, ["decisionOrder"])) return rejected("changes_invalid", "$.changes");
  if (!Array.isArray(raw.changes.decisionOrder)
    || raw.changes.decisionOrder.some(id => typeof id !== "string")) return rejected("decision_order_invalid", "$.changes.decisionOrder");
  const proposal = raw as unknown as Proposal;
  const base = await registeredExperience(proposal.experienceId);
  if (!base) return rejected("experience_unavailable", "$.experienceId");
  if (base.releaseHash !== proposal.baseReleaseHash) return rejected("base_release_changed", "$.baseReleaseHash");
  const beforeOrder = base.definition.decisions.map(decision => decision.id);
  const order = proposal.changes.decisionOrder;
  if (order.length !== beforeOrder.length || new Set(order).size !== beforeOrder.length || order.some(id => !beforeOrder.includes(id))) return rejected("decision_order_invalid", "$.changes.decisionOrder");
  // The Scene view opens a participant fieldset at its name and appends the next
  // goal to that fieldset. Preserve both pairs rather than merely their IDs.
  if (base.output.output === "scene" && ([['characterA', 'goalA'], ['characterB', 'goalB']] as const)
    .some(([name, goal]) => order.indexOf(goal) !== order.indexOf(name) + 1)) return rejected("decision_dependency_changed", "$.changes.decisionOrder");
  if (canonicalJson(order) === canonicalJson(beforeOrder)) return rejected("proposal_unchanged", "$.changes");
  const semanticDiff: SemanticDiff[] = [{ field: "decisionOrder", before: beforeOrder, after: [...order] }];
  const definition: Definition = {
    ...structuredClone(base.definition), revision: base.definition.revision + 1,
    decisions: order.map(id => structuredClone(base.definition.decisions.find(decision => decision.id === id)!)),
  };
  const candidate = await compileExperience(definition, contextCatalog);
  if (!candidate.ok) return candidate;
  // Only definition presentation may differ. Catalog semantics and every dependency stay fixed.
  if (canonicalJson(candidate.release.dependencies) !== canonicalJson(base.dependencies)
    || canonicalJson(candidate.release.output) !== canonicalJson(base.output)
    || canonicalJson(candidate.release.interactions) !== canonicalJson(base.interactions)
    || canonicalJson(candidate.release.copy) !== canonicalJson(base.copy)) return rejected("candidate_semantics_changed");
  return { ok: true, review: freeze({
    schemaVersion: 1, mode: "proposal-only", experienceId: proposal.experienceId,
    baseReleaseHash: base.releaseHash, candidateReleaseHash: candidate.release.releaseHash,
    baseDefinition: base.definition, candidateDefinition: candidate.release.definition, candidateRelease: candidate.release,
    semanticDiff, evidenceRefs: [...proposal.evidenceRefs], dependencies: base.dependencies,
    reviewRequired: [
      "Verify evidence provenance and the intended change; supplied references are not approval or proof.",
      "Review decision dependencies and essential interaction feedback in the candidate order.",
      "Preview affected mobile, keyboard, localization and accessibility behavior before release.",
      "Check retained draft and original-job compatibility for the exact integrated change.",
      "Use independent source review, CI and the deployment owner's release process; this output cannot activate a candidate.",
    ],
  }) };
}

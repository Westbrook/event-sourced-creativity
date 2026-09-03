import type { Catalog, CompiledRelease, Definition, Issue } from "./contracts.ts";
import { canonicalJson, compileExperience, exactKeys, jsonIssues, record } from "./compiler.ts";

export type ExperiencePatch = Readonly<{
  schemaVersion: 1;
  baseReleaseHash: string;
  operations: readonly (
    | { kind: "reorder-decisions"; ids: readonly string[] }
    | { kind: "set-layout"; layout: Definition["layout"] }
  )[];
}>;
export type SemanticDiff = Readonly<{ risk: "none" | "presentation" | "semantic"; changed: readonly string[] }>;

/** Computed by trusted code. A model's risk label, approval or test claim is never an input. */
export function compareReleases(before: CompiledRelease, after: CompiledRelease): SemanticDiff {
  if (before.releaseHash === after.releaseHash) return { risk: "none", changed: [] };
  const changed: string[] = [];
  const semantic = [
    ["output", before.output, after.output],
    ["interactions", before.interactions, after.interactions],
    ["bindings", [...before.definition.decisions].sort((a, b) => a.id.localeCompare(b.id)), [...after.definition.decisions].sort((a, b) => a.id.localeCompare(b.id))],
    ["dependencies", before.dependencies, after.dependencies],
    ["copy", before.copy, after.copy],
    ["identity", before.definition.id, after.definition.id],
  ] as const;
  for (const [name, a, b] of semantic) if (canonicalJson(a) !== canonicalJson(b)) changed.push(name);
  if (changed.length) return { risk: "semantic", changed };
  if (before.definition.layout !== after.definition.layout) changed.push("layout");
  if (before.definition.decisions.map(item => item.id).join("|") !== after.definition.decisions.map(item => item.id).join("|")) changed.push("decision-order");
  if (before.definition.revision !== after.definition.revision) changed.push("revision");
  return { risk: "presentation", changed };
}

export async function proposePatch(base: CompiledRelease, raw: unknown, catalog: Catalog): Promise<
  { ok: true; candidate: CompiledRelease; diff: SemanticDiff } | { ok: false; issues: readonly Issue[] }
> {
  const invalid = (code: string) => ({ ok: false as const, issues: [{ code, path: "$" }] });
  if (jsonIssues(raw).length || !record(raw) || !exactKeys(raw, ["schemaVersion", "baseReleaseHash", "operations"]) || raw.schemaVersion !== 1) return invalid("patch_shape");
  if (raw.baseReleaseHash !== base.releaseHash) return invalid("patch_base_changed");
  if (!Array.isArray(raw.operations) || raw.operations.length < 1 || raw.operations.length > 12) return invalid("patch_limit");
  const candidate = structuredClone(base.definition) as { -readonly [K in keyof Definition]: Definition[K] };
  for (const operation of raw.operations) {
    if (!record(operation)) return invalid("patch_operation");
    if (operation.kind === "set-layout" && exactKeys(operation, ["kind", "layout"]) && ["stage-and-controls", "stacked-stage"].includes(String(operation.layout))) {
      candidate.layout = operation.layout as Definition["layout"];
    } else if (operation.kind === "reorder-decisions" && exactKeys(operation, ["kind", "ids"]) && Array.isArray(operation.ids)) {
      const ids = operation.ids;
      const oldIds = base.definition.decisions.map(item => item.id);
      if (ids.length !== oldIds.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !oldIds.includes(id))) return invalid("patch_decision_set");
      candidate.decisions = ids.map(id => base.definition.decisions.find(item => item.id === id)!);
    } else return invalid("patch_operation");
  }
  if (canonicalJson(candidate) === canonicalJson(base.definition)) return { ok: true, candidate: base, diff: { risk: "none", changed: [] } };
  candidate.revision += 1;
  const compiled = await compileExperience(candidate, catalog);
  if (!compiled.ok) return compiled;
  return { ok: true, candidate: compiled.release, diff: compareReleases(base, compiled.release) };
}

/** Local compare-and-swap proposal registry. It is deliberately not a publishing service. */
export class CandidateRegistry {
  #base: CompiledRelease;
  constructor(base: CompiledRelease) { this.#base = base; }
  get base() { return this.#base; }
  acceptPreview(expectedBaseHash: string, candidate: CompiledRelease) {
    if (this.#base.releaseHash !== expectedBaseHash) return false;
    if (compareReleases(this.#base, candidate).risk === "semantic") return false;
    this.#base = candidate;
    return true;
  }
}

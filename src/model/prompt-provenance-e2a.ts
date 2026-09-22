import { promptFactIsActive } from "./prompt-policy.ts";
import { buildBoundedPromptRepresentation, type ImagePromptOptions, type PromptReferenceDescriptor, type PromptTechnique } from "./prompt-structures.ts";

export const E2A_COMPILER_VERSION = "e2a-approved-proposal-provenance-v1";

/** Private source mapping from the trusted source compiler, never a permission grant.
 * Bind to the complete properties value so later edits must be reviewed/rebound.
 * Only the producer contract in context-proposal-application.ts is supported in v1.
 * Arbitrary nested objects, names/IDs in authored text, and planner fields are opaque.
 */
export type E2aSourceBinding = {
  kind: "approved-context-proposal-v1";
  factIndex: number;
  blockId: string;
  propertiesJson: string;
};
export type E2aTreatment = { version: typeof E2A_COMPILER_VERSION; bindings: readonly E2aSourceBinding[] };
export type E2aRemoval = { sourcePath: string; value: unknown; blockId: string; contract: E2aSourceBinding["kind"] };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const KEYS = ["context_detail", "source_execution_id", "source_proposal_id", "created_from"] as const;

/** Deliberately not a recursive key/UUID scrubber. Unknown provenance stays visible. */
export function projectE2aSource(source: Record<string, unknown>, treatment?: E2aTreatment) {
  const snapshot = structuredClone(source);
  const removed: E2aRemoval[] = [];
  if (!treatment) return { snapshot, removed, version: null };
  if (treatment.version !== E2A_COMPILER_VERSION) throw new Error("e2a_version_unsupported");
  const seen = new Set<number>();
  for (const binding of treatment.bindings) {
    if (binding.kind !== "approved-context-proposal-v1" || !Number.isSafeInteger(binding.factIndex) || binding.factIndex < 0 || seen.has(binding.factIndex)) throw new Error("e2a_binding_invalid");
    seen.add(binding.factIndex);
    const fact: unknown = Array.isArray(snapshot.facts) ? snapshot.facts[binding.factIndex] : null;
    if (!record(fact) || !binding.blockId || fact.block_id !== binding.blockId || !promptFactIsActive(fact) || !record(fact.properties)) throw new Error("e2a_source_binding_mismatch");
    const properties = fact.properties;
    if (JSON.stringify(properties) !== binding.propertiesJson) throw new Error("e2a_source_edited_rebind_required");
    if (properties.created_from !== "approved-context-proposal" || properties.context_detail !== true || properties.authority !== "authored"
      || typeof properties.source_execution_id !== "string" || !properties.source_execution_id
      || typeof properties.source_proposal_id !== "string" || !properties.source_proposal_id) throw new Error("e2a_producer_contract_mismatch");
    for (const key of KEYS) {
      removed.push({ sourcePath: `/facts/${binding.factIndex}/properties/${key}`, value: properties[key], blockId: binding.blockId, contract: binding.kind });
      delete properties[key];
    }
  }
  return { snapshot, removed, version: E2A_COMPILER_VERSION };
}

/** Experiment-only entry point. No production caller imports this module.
 * Omitted treatment runs the existing compiler exactly. Enabled comparisons reject
 * compaction: it would introduce another treatment and could lose source meaning.
 * The returned mapping contains private values; do not put it in public job results.
 */
export function compileE2aPrompt(
  technique: PromptTechnique, source: Record<string, unknown>, direction: Record<string, unknown>,
  references: PromptReferenceDescriptor[] = [], options: ImagePromptOptions = {}, treatment?: E2aTreatment,
) {
  const projection = projectE2aSource(source, treatment);
  const built = buildBoundedPromptRepresentation(technique, projection.snapshot, direction, references, options);
  if (treatment && (!built.fits || built.compacted)) throw new Error("e2a_requires_uncompacted_prompt");
  return { ...built, privateProjection: projection };
}
